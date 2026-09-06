/** Consumer account + vault snapshot models (iOS AccountSyncModels / UserAccountModels parity). */

export const CURRENT_TERMS_VERSION = '2026-03-eula-privacy'

export const LEADERBOARD_FAIR_NETWORK_IDS = [
  'GBNR',
  'NITRANSLINK',
  'ROIIRERAIL',
  'GBSHEFFSUPERTRAM',
] as const

export type LeaderboardFairNetworkId = (typeof LEADERBOARD_FAIR_NETWORK_IDS)[number]

/** Match iOS `StationFirestoreCollections.networkDisplayNames` for fair board networks. */
export const LEADERBOARD_NETWORK_DISPLAY_NAMES: Record<string, string> = {
  GBNR: 'GB National Rail',
  NITRANSLINK: 'NI Translink',
  ROIIRERAIL: 'Irish Rail',
  GBSHEFFSUPERTRAM: 'South Yorkshire Supertram',
}

export function leaderboardNetworkDisplayName(id: string): string {
  return LEADERBOARD_NETWORK_DISPLAY_NAMES[id] ?? id
}

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase()
}

export function isValidUsername(raw: string): boolean {
  const n = normalizeUsername(raw)
  if (n.length < 3 || n.length > 24) return false
  return /^[a-z0-9_]+$/.test(n)
}

export type UserAccountProfile = {
  uid: string
  email: string
  displayName: string
  username: string
  usernameLower: string
  acceptedAgeGateAt: Date
  acceptedTermsAt: Date
  termsVersion: string
  recoveryKeyWrappedVaultKeyBase64: string | null
  avatarURL: string | null
  leaderboardsOptIn: boolean
  leaderboardsShowOnAllNetworks: boolean
  leaderboardsEnabledNetworkIDs: string[]
  leaderboardsShowDisplayName: boolean
  createdAt: Date
}

export type StationLocalData = {
  id: string
  isVisited: boolean
  visitedDates: string[]
  isFavorite: boolean
  notes?: string | null
}

export type AccountDevPreferences = {
  enableDevMode: boolean
  overrideStandardPremium: boolean
  overrideFirstClass: boolean
}

export const EMPTY_DEV_PREFERENCES: AccountDevPreferences = {
  enableDevMode: false,
  overrideStandardPremium: false,
  overrideFirstClass: false,
}

export function mergeDevPreferences(
  local: AccountDevPreferences,
  cloud: AccountDevPreferences
): AccountDevPreferences {
  return {
    enableDevMode: local.enableDevMode || cloud.enableDevMode,
    overrideStandardPremium: local.overrideStandardPremium || cloud.overrideStandardPremium,
    overrideFirstClass: local.overrideFirstClass || cloud.overrideFirstClass,
  }
}

export type AccountSyncSnapshot = {
  schemaVersion: number
  updatedAt: Date
  stationsLocal: Record<string, StationLocalData>
  singlesJSON: Uint8Array
  returnsJSON: Uint8Array
  rangersJSON: Uint8Array
  roversJSON: Uint8Array
  travelcardsJSON: Uint8Array
  dpaygJSON: Uint8Array
  devPreferences: AccountDevPreferences
}

export function emptySnapshot(now = new Date()): AccountSyncSnapshot {
  const emptyArr = new TextEncoder().encode('[]')
  return {
    schemaVersion: 2,
    updatedAt: now,
    stationsLocal: {},
    singlesJSON: emptyArr.slice(),
    returnsJSON: emptyArr.slice(),
    rangersJSON: emptyArr.slice(),
    roversJSON: emptyArr.slice(),
    travelcardsJSON: emptyArr.slice(),
    dpaygJSON: emptyArr.slice(),
    devPreferences: { ...EMPTY_DEV_PREFERENCES },
  }
}

export function snapshotIsEmpty(snap: AccountSyncSnapshot): boolean {
  const ticketCount =
    countJsonArray(snap.singlesJSON) +
    countJsonArray(snap.returnsJSON) +
    countJsonArray(snap.rangersJSON) +
    countJsonArray(snap.roversJSON) +
    countJsonArray(snap.travelcardsJSON) +
    countJsonArray(snap.dpaygJSON)
  return (
    Object.keys(snap.stationsLocal).length === 0 &&
    ticketCount === 0 &&
    snap.devPreferences.enableDevMode === false &&
    snap.devPreferences.overrideStandardPremium === false &&
    snap.devPreferences.overrideFirstClass === false
  )
}

function countJsonArray(data: Uint8Array): number {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(data))
    return Array.isArray(parsed) ? parsed.length : 0
  } catch {
    return 0
  }
}

export function visitedStationCount(snap: AccountSyncSnapshot): number {
  return Object.values(snap.stationsLocal).filter((s) => s.isVisited).length
}

export function ticketCount(snap: AccountSyncSnapshot): number {
  return (
    countJsonArray(snap.singlesJSON) +
    countJsonArray(snap.returnsJSON) +
    countJsonArray(snap.rangersJSON) +
    countJsonArray(snap.roversJSON) +
    countJsonArray(snap.travelcardsJSON) +
    countJsonArray(snap.dpaygJSON)
  )
}

/** Local tracking key: `{stationId}|{NORMALIZED_STNAREA}` — must match iOS `StationFirestoreCollections.localTrackingKey`. */
export function stationLocalTrackingKey(stationId: string, stnarea: string): string {
  return `${stationId}|${normalizeStnarea(stnarea)}`
}

/**
 * Match iOS `StationFirestoreCollections.normalizedStnarea`:
 * trim + uppercase; empty / missing → `GBNR`.
 */
export function normalizeStnarea(stnarea: string | null | undefined): string {
  const trimmed = (stnarea ?? '').trim().toUpperCase()
  return trimmed === '' ? 'GBNR' : trimmed
}

export type AccountSyncConflictResolution = 'keepDevice' | 'useCloud' | 'merge'

export type CloudVaultDoc = {
  schemaVersion: number
  updatedAt: Date
  ciphertextBase64: string
  alg: string
}
