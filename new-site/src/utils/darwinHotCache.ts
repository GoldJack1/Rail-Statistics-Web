import type { DeparturesSnapshot } from '@/types/darwin'
import { fetchDarwin } from '@/utils/darwinReadyFetch'

const RECENT_CRS_KEY = 'rs-darwin-recent-crs'
const BOARD_KEY_PREFIX = 'rs-darwin-board:'
const MAX_RECENT = 8
const BOARD_MAX_AGE_MS = 60_000
const HIST_BOARD_MAX_AGE_MS = 30 * 60_000

type HistoryDatesResponse = {
  dates?: Array<{ date: string; hasState: boolean; hasTimetable: boolean }>
}

type UnitsCatalogResponse = {
  units: unknown[]
  updatedAt?: string
}

const memoryBoards = new Map<string, { snap: DeparturesSnapshot; at: number }>()
let healthPayload: { timetableWindow?: { maxDate?: string } } | null = null
let historyDates: string[] | null = null
let unitsCatalog: UnitsCatalogResponse | null = null
let started = false

export function boardCacheKey(code: string, hours?: number, date?: string, at?: string): string {
  return `${code}|${hours ?? ''}|${date ?? ''}|${at ?? ''}`
}

function boardMaxAgeMs(key: string): number {
  const parts = key.split('|')
  return parts[2] ? HIST_BOARD_MAX_AGE_MS : BOARD_MAX_AGE_MS
}

export function rememberBoard(key: string, snap: DeparturesSnapshot) {
  memoryBoards.set(key, { snap, at: Date.now() })
  try {
    sessionStorage.setItem(BOARD_KEY_PREFIX + key, JSON.stringify({ snap, at: Date.now() }))
  } catch {
    /* quota */
  }
}

export function recallBoard(key: string): DeparturesSnapshot | null {
  const maxAge = boardMaxAgeMs(key)
  const mem = memoryBoards.get(key)
  if (mem && Date.now() - mem.at <= maxAge) return mem.snap
  try {
    const raw = sessionStorage.getItem(BOARD_KEY_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { snap?: DeparturesSnapshot; at?: number }
    if (!parsed?.snap || Date.now() - (parsed.at || 0) > maxAge) return null
    memoryBoards.set(key, { snap: parsed.snap, at: parsed.at || Date.now() })
    return parsed.snap
  } catch {
    return null
  }
}

export function rememberRecentCrs(code: string) {
  const crs = code.trim().toUpperCase()
  if (!/^[A-Z]{3}$/.test(crs)) return
  try {
    const prev = JSON.parse(localStorage.getItem(RECENT_CRS_KEY) || '[]') as string[]
    const next = [crs, ...prev.filter((c) => c !== crs)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_CRS_KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
}

function recentCrs(): string[] {
  try {
    const prev = JSON.parse(localStorage.getItem(RECENT_CRS_KEY) || '[]') as string[]
    return prev.filter((c) => /^[A-Z]{3}$/.test(c)).slice(0, MAX_RECENT)
  } catch {
    return []
  }
}

export function peekHotHealth(): { timetableWindow?: { maxDate?: string } } | null {
  return healthPayload
}

export function peekHotHistoryDates(): string[] | null {
  return historyDates
}

export function peekHotUnitsCatalog(): UnitsCatalogResponse | null {
  return unitsCatalog
}

async function prefetchJson<T>(url: string): Promise<T | null> {
  const res = await fetchDarwin(url)
  if (!res.ok) return null
  return (await res.json()) as T
}

export async function prefetchBoard(code: string, hours = 1, date?: string, at?: string) {
  const crs = code.trim().toUpperCase()
  if (!crs) return
  const key = boardCacheKey(crs, hours, date, at)
  if (recallBoard(key)) return
  const qs = new URLSearchParams()
  qs.set('hours', String(hours))
  if (date) qs.set('date', date)
  if (date && at) qs.set('at', at)
  const snap = await prefetchJson<DeparturesSnapshot>(
    `/api/darwin/departures/${encodeURIComponent(crs)}?${qs.toString()}`,
  )
  if (snap?.updatedAt) rememberBoard(key, snap)
}

/** Warm health, history dates, units catalog, and recently viewed boards. */
export function startDarwinHotCache() {
  if (started || typeof window === 'undefined') return
  started = true
  const run = async () => {
    try {
      for (const crs of recentCrs()) {
        await prefetchBoard(crs, 1)
      }
      const [windowBody, dates] = await Promise.all([
        prefetchJson<{ timetableWindow?: { maxDate?: string } }>('/api/darwin/window'),
        prefetchJson<HistoryDatesResponse>('/api/darwin/history/dates'),
      ])
      if (windowBody) healthPayload = windowBody
      if (dates?.dates) {
        historyDates = dates.dates
          .filter((d) => d.hasState && d.hasTimetable)
          .map((d) => d.date)
          .sort((a, b) => b.localeCompare(a))
      }
    } catch {
      started = false
    }
  }
  const idle = window.requestIdleCallback || ((cb: () => void) => window.setTimeout(cb, 1))
  idle(() => { void run() })
}
