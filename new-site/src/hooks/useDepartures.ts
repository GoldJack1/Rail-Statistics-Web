import { useCallback, useEffect, useRef, useState } from 'react'
import type { DeparturesSnapshot } from '@/types/darwin'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { recallBoard, rememberBoard, rememberRecentCrs } from '@/utils/darwinHotCache'

export type DeparturesStatus =
  | 'idle'
  | 'loading'         // initial fetch in flight, no data yet
  | 'ok'              // fresh data, < STALE_AFTER_MS old
  | 'stale'           // data exists but updatedAt is too old (daemon may be down)
  | 'error'           // latest fetch failed
  | 'not-found'       // station code returned 404

export interface UseDeparturesOptions {
  /** CRS or TIPLOC. Empty string disables fetching. */
  code: string
  /** Look-ahead window passed to the daemon. */
  hours?: number
  /** Poll interval in ms. Defaults to 10 000. */
  pollMs?: number
  /** Mark data as 'stale' once updatedAt is older than this. Defaults to 30 000. */
  staleAfterMs?: number
  date?: string
  at?: string
  /** Board fetched on the server so the first paint is not a loading spinner. */
  initialSnapshot?: DeparturesSnapshot | null
}

export interface UseDeparturesResult {
  status: DeparturesStatus
  data: DeparturesSnapshot | null
  /** Last error message when status === 'error'. */
  error: string | null
  /** ms since data.updatedAt (computed only when data exists). */
  ageMs: number | null
  /** Force an immediate refetch (e.g. on user action). */
  refetch: () => void
}

const DEFAULT_POLL_MS  = 10_000
const DEFAULT_STALE_MS = 30_000
const MAX_NETWORK_RETRIES = 3
const RETRY_BASE_DELAY_MS = 500
const CACHE_MAX_ENTRIES = 200

interface DeparturesCacheEntry {
  key: string
  data: DeparturesSnapshot
  cachedAtMs: number
}

const departuresSWRCache = new Map<string, DeparturesCacheEntry>()

function userMessageForStatus(status: number): string {
  if (status === 401 || status === 403) return 'Access to live data is currently restricted. Please try again shortly.'
  if (status === 404) return 'Station not found.'
  if (status >= 500) return 'Live departures are temporarily unavailable. Please try again in a minute.'
  return `Request failed (${status}).`
}

function userMessageForNetworkFailure(): string {
  return 'Darwin API did not respond in time. Retrying failed — please try again shortly.'
}

function isTransientNetworkError(err: Error): boolean {
  if (err.name === 'AbortError') return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('timed out') ||
    msg.includes('network') ||
    msg.includes('fetch failed') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('failed to fetch')
  )
}

function createAbortError(): Error {
  const abortErr = new Error('Aborted')
  abortErr.name = 'AbortError'
  return abortErr
}

async function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw createAbortError()
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(createAbortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function peekCache(key: string): DeparturesSnapshot | null {
  return departuresSWRCache.get(key)?.data ?? null
}

function seedCache(key: string, snap: DeparturesSnapshot) {
  departuresSWRCache.set(key, { key, data: snap, cachedAtMs: Date.now() })
}

export function useDepartures(opts: UseDeparturesOptions): UseDeparturesResult {
  const {
    code,
    hours,
    pollMs = DEFAULT_POLL_MS,
    staleAfterMs = DEFAULT_STALE_MS,
    date,
    at,
    initialSnapshot = null,
  } = opts
  const effectivePollMs = date ? 0 : pollMs
  const cacheKey = `${code}|${hours ?? ''}|${date ?? ''}|${at ?? ''}`

  const [data, setData]     = useState<DeparturesSnapshot | null>(() => {
    if (!code) return null
    if (initialSnapshot) {
      seedCache(cacheKey, initialSnapshot)
      return initialSnapshot
    }
    const cached = peekCache(cacheKey)
    if (cached) {
      seedCache(cacheKey, cached)
      return cached
    }
    return null
  })
  const [error, setError]   = useState<string | null>(null)
  const [status, setStatus] = useState<DeparturesStatus>(() => {
    if (!code) return 'idle'
    return (initialSnapshot || peekCache(cacheKey)) ? 'ok' : 'loading'
  })
  const [ageMs, setAgeMs]   = useState<number | null>(null)

  const pollRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ageTickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const inflightKeyRef = useRef<string | null>(null)

  const applySnapshot = useCallback((snap: DeparturesSnapshot) => {
    setData(snap)
    setError(null)
    const age = Date.now() - Date.parse(snap.updatedAt)
    setAgeMs(age)
    setStatus(age > staleAfterMs ? 'stale' : 'ok')
  }, [staleAfterMs])

  const putCache = useCallback((key: string, snap: DeparturesSnapshot) => {
    departuresSWRCache.set(key, { key, data: snap, cachedAtMs: Date.now() })
    if (departuresSWRCache.size <= CACHE_MAX_ENTRIES) return
    const oldest = [...departuresSWRCache.entries()]
      .sort((a, b) => a[1].cachedAtMs - b[1].cachedAtMs)
      .slice(0, departuresSWRCache.size - CACHE_MAX_ENTRIES)
    for (const [k] of oldest) departuresSWRCache.delete(k)
  }, [])

  const fetchOnce = useCallback(async (signal: AbortSignal, key: string) => {
    if (!code) return
    if (inflightKeyRef.current === key) return
    inflightKeyRef.current = key
    try {
      const sp = new URLSearchParams()
      if (hours != null) sp.set('hours', String(hours))
      if (date) sp.set('date', date)
      if (at) sp.set('at', at)
      const qs = sp.toString()
      const url = `/api/darwin/departures/${encodeURIComponent(code)}${qs ? `?${qs}` : ''}`
      let res: Response | null = null
      for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt += 1) {
        if (signal.aborted) throw createAbortError()
        try {
          res = await fetchDarwin(url, { signal })
          break
        } catch (rawErr) {
          const err = rawErr as Error
          if (signal.aborted) throw createAbortError()
          if (attempt === MAX_NETWORK_RETRIES) {
            throw new Error(err.message || userMessageForNetworkFailure())
          }
          if (!isTransientNetworkError(err)) throw err
          await delay(RETRY_BASE_DELAY_MS * (attempt + 1), signal)
        }
      }
      if (!res) throw new Error(userMessageForNetworkFailure())
      if (res.status === 404) {
        const body = await res.json().catch(() => ({}))
        departuresSWRCache.delete(key)
        setData(null)
        setError(body?.error || userMessageForStatus(404))
        setStatus('not-found')
        return
      }
      if (!res.ok) throw new Error(userMessageForStatus(res.status))
      const snap: DeparturesSnapshot = await res.json()
      putCache(key, snap)
      rememberBoard(key, snap)
      rememberRecentCrs(code)
      applySnapshot(snap)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setError((e as Error)?.message || 'Could not load live departures.')
      setStatus(prev => (prev === 'idle' || prev === 'loading' ? 'error' : prev))
    } finally {
      if (inflightKeyRef.current === key) inflightKeyRef.current = null
    }
  }, [applySnapshot, at, code, date, hours, putCache])

  const refetch = useCallback(() => {
    if (!code) return
    const ac = new AbortController()
    void fetchOnce(ac.signal, cacheKey)
  }, [cacheKey, code, fetchOnce])

  useEffect(() => {
    if (!code) {
      setStatus('idle')
      setData(null)
      setError(null)
      return
    }

    const cached = peekCache(cacheKey) || recallBoard(cacheKey)
    if (cached) {
      applySnapshot(cached)
    } else {
      setData(null)
      setError(null)
      setStatus('loading')
    }

    const ac = new AbortController()
    void fetchOnce(ac.signal, cacheKey)

    if (pollRef.current) clearTimeout(pollRef.current)
    const schedulePoll = () => {
      if (effectivePollMs <= 0) return
      pollRef.current = setTimeout(() => {
        if (document.visibilityState === 'visible' && inflightKeyRef.current !== cacheKey) {
          void fetchOnce(ac.signal, cacheKey)
        }
        schedulePoll()
      }, effectivePollMs)
    }
    schedulePoll()

    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
      ac.abort()
      if (inflightKeyRef.current === cacheKey) inflightKeyRef.current = null
    }
  }, [applySnapshot, cacheKey, code, effectivePollMs, fetchOnce])

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'visible' && code && inflightKeyRef.current !== cacheKey) {
        refetch()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [cacheKey, code, refetch])

  useEffect(() => {
    if (!data) { setAgeMs(null); return }
    if (ageTickRef.current) clearInterval(ageTickRef.current)
    ageTickRef.current = setInterval(() => {
      const age = Date.now() - Date.parse(data.updatedAt)
      setAgeMs(age)
      setStatus(prev => {
        if (prev === 'error' || prev === 'not-found') return prev
        return age > staleAfterMs ? 'stale' : 'ok'
      })
    }, 1000)
    return () => { if (ageTickRef.current) clearInterval(ageTickRef.current) }
  }, [data, staleAfterMs])

  return { status, data, error, ageMs, refetch }
}
