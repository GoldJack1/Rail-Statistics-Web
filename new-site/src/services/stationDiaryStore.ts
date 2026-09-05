/**
 * Browser-local station diary (stationsLocal) for consumer live data mode.
 * Keys match iOS: `{stationId}|{NORMALIZED_STNAREA}`.
 */
import {
  EMPTY_DEV_PREFERENCES,
  emptySnapshot,
  stationLocalTrackingKey,
  type AccountSyncSnapshot,
  type StationLocalData,
} from '@/services/accountModels'
import { normalizeVaultDateString, toSwiftCompatibleIso8601 } from '@/services/accountSnapshotCodec'

const DIARY_STORAGE_KEY = 'rs-uas-station-diary-v1'
const LOCAL_UPDATED_AT_KEY = 'rs-uas-diary-updated-at'
const LOCAL_DIRTY_KEY = 'rs-uas-diary-dirty'
const LAST_SYNCED_AT_KEY = 'rs-uas-diary-last-synced-at'

type DiaryListener = () => void
const listeners = new Set<DiaryListener>()

function notify(): void {
  for (const l of listeners) l()
}

export function subscribeStationDiary(listener: DiaryListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* ignore */
  }
}

export function getLocalStationsMap(): Record<string, StationLocalData> {
  const raw = readJson<Record<string, StationLocalData>>(DIARY_STORAGE_KEY, {})
  return migrateDiaryKeysIfNeeded(raw)
}

/**
 * Older web builds keyed empty stnarea as `id|` instead of iOS `id|GBNR`.
 * Also rebuild keys from each record's `id` so card lookups match after cloud pull.
 */
function migrateDiaryKeysIfNeeded(
  map: Record<string, StationLocalData>
): Record<string, StationLocalData> {
  let changed = false
  const out: Record<string, StationLocalData> = {}
  for (const [key, value] of Object.entries(map)) {
    if (!value || typeof value !== 'object') {
      changed = true
      continue
    }
    const pipe = key.indexOf('|')
    const idFromKey = pipe >= 0 ? key.slice(0, pipe) : key
    const areaFromKey = pipe >= 0 ? key.slice(pipe + 1) : ''
    const looksLikeIndex = /^\d+$/.test(key)
    const id = (value.id && String(value.id).trim()) || (looksLikeIndex ? '' : idFromKey)
    if (!id) {
      changed = true
      continue
    }
    const fixedKey = stationLocalTrackingKey(id, areaFromKey)
    const record: StationLocalData = {
      ...value,
      id,
      visitedDates: Array.isArray(value.visitedDates)
        ? value.visitedDates.map((d) => normalizeVaultDateString(String(d)))
        : [],
    }
    if (fixedKey !== key) changed = true
    const prev = out[fixedKey]
    out[fixedKey] = prev ? mergeOneStation(prev, record) : record
  }
  if (changed || Object.keys(out).length !== Object.keys(map).length) {
    writeJson(DIARY_STORAGE_KEY, out)
    queueMicrotask(() => notify())
  }
  return out
}

function mergeOneStation(a: StationLocalData, b: StationLocalData): StationLocalData {
  return {
    id: a.id || b.id,
    isVisited: a.isVisited || b.isVisited,
    isFavorite: a.isFavorite || b.isFavorite,
    visitedDates: Array.from(
      new Set([...a.visitedDates, ...b.visitedDates].map(normalizeVaultDateString))
    ).sort(),
    notes: (a.notes && a.notes.trim()) || b.notes || null,
  }
}

export function getStationLocalData(
  stationId: string,
  stnarea: string
): StationLocalData | null {
  const map = getLocalStationsMap()
  const exact = stationLocalTrackingKey(stationId, stnarea)
  if (map[exact]) return map[exact]!

  // Fallbacks for older / mismatched cloud keys (numeric keys, missing area, id-only).
  const prefix = `${stationId}|`
  for (const [key, value] of Object.entries(map)) {
    if (key === stationId || key.startsWith(prefix)) return value
    if (value?.id && value.id === stationId) return value
  }
  return null
}

export function replaceAllStationLocalData(map: Record<string, StationLocalData>): void {
  writeJson(DIARY_STORAGE_KEY, map)
  markLocalDirty()
  notify()
}

export function upsertStationLocalData(
  stationId: string,
  stnarea: string,
  patch: Partial<StationLocalData>
): StationLocalData {
  const key = stationLocalTrackingKey(stationId, stnarea)
  const map = getLocalStationsMap()
  const prev = map[key] ?? {
    id: stationId,
    isVisited: false,
    visitedDates: [],
    isFavorite: false,
    notes: null,
  }
  const next: StationLocalData = {
    ...prev,
    ...patch,
    id: stationId,
    visitedDates: (patch.visitedDates ?? prev.visitedDates).map(normalizeVaultDateString),
  }
  if (patch.isVisited === true && prev.isVisited !== true) {
    const today = toSwiftCompatibleIso8601(new Date())
    if (!next.visitedDates.some((d) => d.startsWith(today.slice(0, 10)))) {
      next.visitedDates = [...next.visitedDates, today]
    }
  }
  map[key] = next
  writeJson(DIARY_STORAGE_KEY, map)
  markLocalDirty()
  notify()
  return next
}

export function markLocalDirty(): void {
  writeJson(LOCAL_DIRTY_KEY, true)
  writeJson(LOCAL_UPDATED_AT_KEY, new Date().toISOString())
}

export function markLocalClean(matchingUpdatedAt?: Date): void {
  writeJson(LOCAL_DIRTY_KEY, false)
  if (matchingUpdatedAt) {
    writeJson(LOCAL_UPDATED_AT_KEY, matchingUpdatedAt.toISOString())
  }
  writeJson(LAST_SYNCED_AT_KEY, new Date().toISOString())
}

export function isLocalDirty(): boolean {
  return Boolean(readJson<boolean>(LOCAL_DIRTY_KEY, false))
}

export function getLocalUpdatedAt(): Date | null {
  const raw = readJson<string | null>(LOCAL_UPDATED_AT_KEY, null)
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export function getLastSyncedAt(): Date | null {
  const raw = readJson<string | null>(LAST_SYNCED_AT_KEY, null)
  if (!raw) return null
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? null : d
}

export function buildLocalSnapshotFromDiary(): AccountSyncSnapshot {
  const snap = emptySnapshot(getLocalUpdatedAt() ?? new Date())
  snap.stationsLocal = getLocalStationsMap()
  return snap
}

export function applySnapshotStationsToDiary(snap: AccountSyncSnapshot): void {
  // Rebuild keys as `{id}|{stnarea}` from each record so card lookups match iOS,
  // even if cloud used bare ids, empty areas, or odd dictionary keys.
  const normalized: Record<string, StationLocalData> = {}
  const entries = Object.entries(snap.stationsLocal)
  for (const [key, value] of entries) {
    if (!value || typeof value !== 'object') continue
    const pipe = key.indexOf('|')
    const idFromKey = pipe >= 0 ? key.slice(0, pipe) : key
    const areaFromKey = pipe >= 0 ? key.slice(pipe + 1) : ''
    // Skip pure array-index keys like "0"/"12" when the record has a real id.
    const looksLikeIndex = /^\d+$/.test(key)
    const id = (value.id && String(value.id).trim()) || (looksLikeIndex ? '' : idFromKey)
    if (!id) continue
    const fixedKey = stationLocalTrackingKey(id, areaFromKey)
    const record: StationLocalData = {
      id,
      isVisited: Boolean(value.isVisited),
      isFavorite: Boolean(value.isFavorite),
      visitedDates: Array.isArray(value.visitedDates)
        ? value.visitedDates.map((d) => normalizeVaultDateString(String(d)))
        : [],
      notes: typeof value.notes === 'string' ? value.notes : null,
    }
    const prev = normalized[fixedKey]
    normalized[fixedKey] = prev ? mergeOneStation(prev, record) : record
  }
  writeJson(DIARY_STORAGE_KEY, normalized)
  notify()
}

export function getDiaryStationCount(): number {
  return Object.keys(getLocalStationsMap()).length
}

export function getDiaryVisitedCount(): number {
  return Object.values(getLocalStationsMap()).filter((s) => s.isVisited).length
}

export function mergeStationMaps(
  local: Record<string, StationLocalData>,
  cloud: Record<string, StationLocalData>
): Record<string, StationLocalData> {
  const keys = new Set([...Object.keys(local), ...Object.keys(cloud)])
  const out: Record<string, StationLocalData> = {}
  for (const key of keys) {
    const a = local[key]
    const b = cloud[key]
    if (!a) {
      out[key] = b!
      continue
    }
    if (!b) {
      out[key] = a
      continue
    }
    const dates = Array.from(
      new Set([...a.visitedDates, ...b.visitedDates].map(normalizeVaultDateString))
    ).sort()
    out[key] = {
      id: a.id || b.id,
      isVisited: a.isVisited || b.isVisited,
      isFavorite: a.isFavorite || b.isFavorite,
      visitedDates: dates,
      notes: (a.notes && a.notes.trim()) || b.notes || null,
    }
  }
  return out
}

export function mergeSnapshots(
  local: AccountSyncSnapshot,
  cloud: AccountSyncSnapshot
): AccountSyncSnapshot {
  return {
    schemaVersion: Math.max(local.schemaVersion, cloud.schemaVersion),
    updatedAt: new Date(),
    stationsLocal: mergeStationMaps(local.stationsLocal, cloud.stationsLocal),
    // Ticket blobs: prefer local non-empty overwrite by id is complex; for web v1 keep local if non-empty else cloud
    singlesJSON: pickTicketBlob(local.singlesJSON, cloud.singlesJSON),
    returnsJSON: pickTicketBlob(local.returnsJSON, cloud.returnsJSON),
    rangersJSON: pickTicketBlob(local.rangersJSON, cloud.rangersJSON),
    roversJSON: pickTicketBlob(local.roversJSON, cloud.roversJSON),
    travelcardsJSON: pickTicketBlob(local.travelcardsJSON, cloud.travelcardsJSON),
    dpaygJSON: pickTicketBlob(local.dpaygJSON, cloud.dpaygJSON),
    // Web ignores devPreferences — keep empty defaults on any local merge.
    devPreferences: { ...EMPTY_DEV_PREFERENCES },
  }
}

function pickTicketBlob(local: Uint8Array, cloud: Uint8Array): Uint8Array {
  try {
    const l = JSON.parse(new TextDecoder().decode(local))
    if (Array.isArray(l) && l.length > 0) return local
  } catch {
    /* fall through */
  }
  return cloud
}

export function clearStationDiary(): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(DIARY_STORAGE_KEY)
    localStorage.removeItem(LOCAL_DIRTY_KEY)
  } catch {
    /* ignore */
  }
  notify()
}
