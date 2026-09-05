/**
 * Leaderboard read/publish against UAs `leaderboardEntries` (iOS LeaderboardService parity).
 */
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  setDoc,
  where,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore'
import {
  LEADERBOARD_FAIR_NETWORK_IDS,
  type UserAccountProfile,
} from '@/services/accountModels'
import { getLocalStationsMap } from '@/services/stationDiaryStore'
import { ensureUserAccountsFirebase } from '@/services/userAccountsFirebase'
import { normalizeStnarea } from '@/services/accountModels'

const LAST_PUBLISH_KEY = 'rs-uas-leaderboard-last-publish-at'
const HOUR_MS = 60 * 60 * 1000

export type LeaderboardEntry = {
  uid: string
  username: string
  displayName: string
  showDisplayName: boolean
  avatarURL: string | null
  showOnAllNetworks: boolean
  enabledNetworkIDs: string[]
  visitedCountAll: number
  totalAll: number
  percentAll: number
  byNetwork: Record<string, { visitedCount: number; total: number; percent: number }>
  optedIn: boolean
  updatedAt: Date
}

export type StationCatalogueRow = {
  id: string
  stnarea: string
}

function readLastPublish(): number {
  if (typeof localStorage === 'undefined') return 0
  try {
    return Number(localStorage.getItem(LAST_PUBLISH_KEY) || 0)
  } catch {
    return 0
  }
}

function writeLastPublish(ms: number): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LAST_PUBLISH_KEY, String(ms))
  } catch {
    /* ignore */
  }
}

function countsForNetworks(
  catalogue: StationCatalogueRow[],
  local: ReturnType<typeof getLocalStationsMap>,
  networkIds: Set<string>
): { visited: number; total: number; percent: number } {
  let total = 0
  let visited = 0
  for (const station of catalogue) {
    const area = normalizeStnarea(station.stnarea)
    if (!networkIds.has(area)) continue
    total += 1
    const key = `${station.id}|${area}`
    if (local[key]?.isVisited) visited += 1
  }
  const percent = total > 0 ? Math.round((visited / total) * 1000) / 10 : 0
  return { visited, total, percent }
}

export function buildLeaderboardStats(catalogue: StationCatalogueRow[]) {
  const local = getLocalStationsMap()
  const fair = new Set<string>(LEADERBOARD_FAIR_NETWORK_IDS)
  const all = countsForNetworks(catalogue, local, fair)
  const byNetwork: LeaderboardEntry['byNetwork'] = {}
  for (const id of LEADERBOARD_FAIR_NETWORK_IDS) {
    byNetwork[id] = (() => {
      const c = countsForNetworks(catalogue, local, new Set([id]))
      return { visitedCount: c.visited, total: c.total, percent: c.percent }
    })()
  }
  return {
    visitedCountAll: all.visited,
    totalAll: all.total,
    percentAll: all.percent,
    byNetwork,
  }
}

export async function fetchLeaderboardEntries(mode: 'all' | 'network'): Promise<LeaderboardEntry[]> {
  const { db } = await ensureUserAccountsFirebase()
  const q = query(
    collection(db, 'leaderboardEntries'),
    where('optedIn', '==', true),
    orderBy('visitedCountAll', 'desc'),
    limit(200)
  )
  const snap = await getDocs(q)
  const rows: LeaderboardEntry[] = []
  snap.forEach((docSnap) => {
    const d = docSnap.data() as Record<string, unknown>
    const byNetworkRaw = (d.byNetwork ?? {}) as Record<string, Record<string, unknown>>
    const byNetwork: LeaderboardEntry['byNetwork'] = {}
    for (const [k, v] of Object.entries(byNetworkRaw)) {
      byNetwork[k] = {
        visitedCount: Number(v.visitedCount ?? 0),
        total: Number(v.total ?? 0),
        percent: Number(v.percent ?? 0),
      }
    }
    rows.push({
      uid: String(d.uid ?? docSnap.id),
      username: String(d.username ?? ''),
      displayName: String(d.displayName ?? ''),
      showDisplayName: Boolean(d.showDisplayName),
      avatarURL: typeof d.avatarURL === 'string' ? d.avatarURL : null,
      showOnAllNetworks: Boolean(d.showOnAllNetworks ?? d.showOnByNetwork),
      enabledNetworkIDs: Array.isArray(d.enabledNetworkIDs) ? d.enabledNetworkIDs.map(String) : [],
      visitedCountAll: Number(d.visitedCountAll ?? 0),
      totalAll: Number(d.totalAll ?? 0),
      percentAll: Number(d.percentAll ?? 0),
      byNetwork,
      optedIn: Boolean(d.optedIn),
      updatedAt:
        d.updatedAt && typeof (d.updatedAt as { toDate?: () => Date }).toDate === 'function'
          ? (d.updatedAt as { toDate: () => Date }).toDate()
          : new Date(0),
    })
  })

  if (mode === 'network') {
    // Caller filters by selected network for display ranking
    return rows
  }
  return rows.filter((r) => r.showOnAllNetworks || r.visitedCountAll > 0)
}

export async function publishLeaderboardIfNeeded(params: {
  profile: UserAccountProfile
  catalogue: StationCatalogueRow[]
  force?: boolean
}): Promise<void> {
  const { profile, catalogue, force } = params
  const { db } = await ensureUserAccountsFirebase()
  const ref = doc(db, 'leaderboardEntries', profile.uid)

  if (!profile.leaderboardsOptIn) {
    try {
      await deleteDoc(ref)
    } catch {
      /* may not exist */
    }
    return
  }

  const now = Date.now()
  if (!force && now - readLastPublish() < HOUR_MS) return

  const stats = buildLeaderboardStats(catalogue)
  const showAll = profile.leaderboardsShowOnAllNetworks
  const enabled = showAll
    ? [...LEADERBOARD_FAIR_NETWORK_IDS]
    : profile.leaderboardsEnabledNetworkIDs.filter((id) =>
        (LEADERBOARD_FAIR_NETWORK_IDS as readonly string[]).includes(id)
      )

  if (!showAll && enabled.length === 0) {
    await deleteDoc(ref)
    writeLastPublish(now)
    return
  }

  await setDoc(ref, {
    uid: profile.uid,
    username: profile.username,
    displayName: profile.leaderboardsShowDisplayName ? profile.displayName : '',
    showDisplayName: profile.leaderboardsShowDisplayName,
    avatarURL: profile.avatarURL,
    showOnAllNetworks: showAll,
    enabledNetworkIDs: enabled,
    visitedCountAll: showAll ? stats.visitedCountAll : 0,
    totalAll: showAll ? stats.totalAll : 0,
    percentAll: showAll ? stats.percentAll : 0,
    byNetwork: Object.fromEntries(
      enabled.map((id) => [
        id,
        stats.byNetwork[id] ?? { visitedCount: 0, total: 0, percent: 0 },
      ])
    ),
    optedIn: true,
    updatedAt: Timestamp.now(),
  })
  writeLastPublish(now)
}
