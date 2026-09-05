/**
 * Encode/decode AccountSyncSnapshot for AES-GCM payload (iOS Codable JSON parity).
 * Ticket fields are base64 of raw JSON Data bytes (Swift Data Codable → base64 in JSON).
 *
 * Dates must match Swift `JSONDecoder.dateDecodingStrategy = .iso8601`, which rejects
 * date-only values like `2026-09-05`. Never store bare calendar dates or `toISOString()`
 * fractional seconds in the vault without normalizing.
 *
 * Web ignores `devPreferences` (iOS-only). Encode may pass the cloud JSON through
 * untouched; decode always returns empty defaults and never surfaces prefs to web UI.
 */
import {
  EMPTY_DEV_PREFERENCES,
  type AccountSyncSnapshot,
  type StationLocalData,
} from '@/services/accountModels'
import { ACCOUNT_SYNC_SCHEMA_VERSION, base64ToBytes, bytesToBase64 } from '@/services/vaultCrypto'

const FRACTIONAL_ISO_RE = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z/
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/
const TICKET_KEYS = [
  'singlesJSON',
  'returnsJSON',
  'rangersJSON',
  'roversJSON',
  'travelcardsJSON',
  'dpaygJSON',
] as const

/** Opaque empty prefs object for first-time vault creates (Codable shape only). */
export const EMPTY_DEV_PREFERENCES_JSON = {
  enableDevMode: false,
  overrideStandardPremium: false,
  overrideFirstClass: false,
} as const

/** UTC ISO-8601 without fractional seconds — Swift `.iso8601` compatible. */
export function toSwiftCompatibleIso8601(date: Date): string {
  const t = Number.isNaN(date.getTime()) ? new Date() : date
  return t.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Normalize a date string for vault JSON (always full Swift-safe ISO-8601). */
export function normalizeVaultDateString(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return toSwiftCompatibleIso8601(new Date())
  if (DATE_ONLY_RE.test(trimmed)) {
    return `${trimmed}T00:00:00Z`
  }
  const d = new Date(trimmed)
  if (Number.isNaN(d.getTime())) return toSwiftCompatibleIso8601(new Date())
  return toSwiftCompatibleIso8601(d)
}

export function plaintextNeedsIosCompatibilityRewrite(plain: Uint8Array): boolean {
  try {
    const text = new TextDecoder().decode(plain)
    if (FRACTIONAL_ISO_RE.test(text)) return true
    // Date-only strings anywhere Swift will decode as Date (updatedAt / visitedDates).
    if (/\"(?:updatedAt|visitedDates)\"[^\n]{0,80}\"\d{4}-\d{2}-\d{2}\"/.test(text)) return true
    if (/\"visitedDates\"\s*:\s*\[[^\]]*"\d{4}-\d{2}-\d{2}"/.test(text)) return true
    const raw = JSON.parse(text) as Record<string, unknown>
    if (typeof raw.updatedAt === 'string' && DATE_ONLY_RE.test(raw.updatedAt.trim())) return true
    for (const key of TICKET_KEYS) {
      const v = raw[key]
      if (v == null) continue
      // Swift Data Codable expects a base64 string, never a JSON array/object.
      if (typeof v !== 'string') return true
      try {
        base64ToBytes(v)
      } catch {
        return true
      }
    }
    return false
  } catch {
    return true
  }
}

/** Pull opaque `devPreferences` JSON from vault plaintext (web does not interpret it). */
export function extractDevPreferencesJson(plain: Uint8Array): unknown {
  try {
    const raw = JSON.parse(new TextDecoder().decode(plain)) as Record<string, unknown>
    if (raw.devPreferences && typeof raw.devPreferences === 'object') {
      return raw.devPreferences
    }
  } catch {
    /* ignore */
  }
  return { ...EMPTY_DEV_PREFERENCES_JSON }
}

function bytesToJsonBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
}

function jsonBase64ToBytes(value: unknown): Uint8Array {
  if (typeof value === 'string') {
    try {
      return base64ToBytes(value)
    } catch {
      if (value.startsWith('[') || value.startsWith('{')) {
        return new TextEncoder().encode(value)
      }
      return new TextEncoder().encode('[]')
    }
  }
  // Web bug / older builds: ticket field stored as a JSON array/object.
  if (value && typeof value === 'object') {
    return new TextEncoder().encode(JSON.stringify(value))
  }
  return new TextEncoder().encode('[]')
}

export type EncodeSnapshotOptions = {
  /**
   * Opaque cloud `devPreferences` JSON to pass through unchanged.
   * Web never authors this field — omit only for brand-new vaults.
   */
  passThroughDevPreferences?: unknown
}

export function encodeSnapshotToJsonBytes(
  snap: AccountSyncSnapshot,
  options?: EncodeSnapshotOptions
): Uint8Array {
  const stations: Record<string, StationLocalData> = {}
  for (const [k, v] of Object.entries(snap.stationsLocal)) {
    stations[k] = {
      id: v.id,
      isVisited: v.isVisited,
      visitedDates: v.visitedDates.map(normalizeVaultDateString),
      isFavorite: v.isFavorite,
      notes: v.notes ?? null,
    }
  }
  const payload = {
    schemaVersion: snap.schemaVersion,
    updatedAt: toSwiftCompatibleIso8601(snap.updatedAt),
    stationsLocal: stations,
    singlesJSON: bytesToJsonBase64(snap.singlesJSON),
    returnsJSON: bytesToJsonBase64(snap.returnsJSON),
    rangersJSON: bytesToJsonBase64(snap.rangersJSON),
    roversJSON: bytesToJsonBase64(snap.roversJSON),
    travelcardsJSON: bytesToJsonBase64(snap.travelcardsJSON),
    dpaygJSON: bytesToJsonBase64(snap.dpaygJSON),
    // Never take prefs from snap.devPreferences (web ignores that field).
    devPreferences:
      options?.passThroughDevPreferences !== undefined
        ? options.passThroughDevPreferences
        : { ...EMPTY_DEV_PREFERENCES_JSON },
  }
  return new TextEncoder().encode(JSON.stringify(payload))
}

export function decodeSnapshotFromJsonBytes(bytes: Uint8Array): AccountSyncSnapshot {
  const raw = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>
  const stationsLocal: Record<string, StationLocalData> = {}

  const stationsRaw = raw.stationsLocal
  const stationEntries: [string, Record<string, unknown>][] = Array.isArray(stationsRaw)
    ? stationsRaw.map((item, index) => {
        const rec = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
        const id = String(rec.id ?? index)
        return [id, rec]
      })
    : Object.entries((stationsRaw ?? {}) as Record<string, Record<string, unknown>>)

  for (const [k, v] of stationEntries) {
    if (!v || typeof v !== 'object') continue
    stationsLocal[k] = {
      id: String(v.id ?? (k.includes('|') ? k.split('|')[0] : k) ?? ''),
      isVisited: Boolean(v.isVisited),
      visitedDates: Array.isArray(v.visitedDates)
        ? v.visitedDates.map((d) => {
            if (typeof d === 'string') return normalizeVaultDateString(d)
            if (typeof d === 'number') {
              return toSwiftCompatibleIso8601(new Date(d * (d < 1e12 ? 1000 : 1)))
            }
            return normalizeVaultDateString(String(d))
          })
        : [],
      isFavorite: Boolean(v.isFavorite),
      notes: typeof v.notes === 'string' ? v.notes : null,
    }
  }
  const updatedAt = new Date(String(raw.updatedAt ?? Date.now()))
  return {
    schemaVersion: typeof raw.schemaVersion === 'number' ? raw.schemaVersion : ACCOUNT_SYNC_SCHEMA_VERSION,
    updatedAt: Number.isNaN(updatedAt.getTime()) ? new Date() : updatedAt,
    stationsLocal,
    singlesJSON: jsonBase64ToBytes(raw.singlesJSON),
    returnsJSON: jsonBase64ToBytes(raw.returnsJSON),
    rangersJSON: jsonBase64ToBytes(raw.rangersJSON),
    roversJSON: jsonBase64ToBytes(raw.roversJSON),
    travelcardsJSON: jsonBase64ToBytes(raw.travelcardsJSON),
    dpaygJSON: jsonBase64ToBytes(raw.dpaygJSON),
    // Web ignores iOS devPreferences — never surface cloud values to the browser model.
    devPreferences: { ...EMPTY_DEV_PREFERENCES },
  }
}

export { EMPTY_DEV_PREFERENCES }
