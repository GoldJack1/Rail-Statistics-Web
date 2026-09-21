import { useCallback, useEffect, useRef, useState } from 'react'
import type { ServiceDetail } from '@/types/darwin'
import { fetchDarwin } from '@/utils/darwinReadyFetch'

export type ServiceDetailStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'stale'
  | 'error'
  | 'not-found'

export interface UseServiceDetailOptions {
  rid: string
  pollMs?: number
  staleAfterMs?: number
  date?: string
  at?: string
}

export interface UseServiceDetailResult {
  status: ServiceDetailStatus
  data: ServiceDetail | null
  error: string | null
  ageMs: number | null
  refetch: () => void
}

const DEFAULT_POLL_MS  = 15_000
const DEFAULT_STALE_MS = 60_000
const MAX_NETWORK_RETRIES = 2
const RETRY_BASE_DELAY_MS = 500
const LIVE_SERVICE_CACHE_TTL_MS = 15_000
const HIST_SERVICE_CACHE_TTL_MS = 6 * 60 * 60_000
const SERVICE_CACHE_MAX = 200

type ServiceCacheEntry = { detail: ServiceDetail; cachedAtMs: number; ttlMs: number }
const serviceDetailCache = new Map<string, ServiceCacheEntry>()
const prefetchInflight = new Set<string>()

function serviceCacheKey(rid: string, date?: string, at?: string): string {
  return `${rid}|${date || ''}|${at || ''}`
}

function cacheTtlMs(date?: string): number {
  return date ? HIST_SERVICE_CACHE_TTL_MS : LIVE_SERVICE_CACHE_TTL_MS
}

function getCachedService(key: string): ServiceDetail | null {
  const hit = serviceDetailCache.get(key)
  if (!hit) return null
  if (Date.now() - hit.cachedAtMs > hit.ttlMs) {
    serviceDetailCache.delete(key)
    return null
  }
  return hit.detail
}

function putCachedService(key: string, detail: ServiceDetail, ttlMs: number) {
  serviceDetailCache.set(key, { detail, cachedAtMs: Date.now(), ttlMs })
  if (serviceDetailCache.size <= SERVICE_CACHE_MAX) return
  const oldest = [...serviceDetailCache.entries()]
    .sort((a, b) => a[1].cachedAtMs - b[1].cachedAtMs)
    .slice(0, serviceDetailCache.size - SERVICE_CACHE_MAX)
  for (const [k] of oldest) serviceDetailCache.delete(k)
}

function applyCachedDetail(
  detail: ServiceDetail,
  staleAfterMs: number,
  setData: (d: ServiceDetail) => void,
  setError: (e: string | null) => void,
  setAgeMs: (n: number) => void,
  setStatus: (s: ServiceDetailStatus) => void,
) {
  setData(detail)
  setError(null)
  const age = Date.now() - Date.parse(detail.updatedAt)
  setAgeMs(age)
  setStatus(age > staleAfterMs ? 'stale' : 'ok')
}

function userMessageForStatus(status: number): string {
  if (status === 401 || status === 403) return 'Access to live service detail is currently restricted.'
  if (status === 404) return 'Service not found.'
  if (status >= 500) return 'Service detail is temporarily unavailable. Please try again shortly.'
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

function serviceUrl(rid: string, date?: string, at?: string): string {
  const qs = new URLSearchParams()
  if (date) qs.set('date', date)
  if (at) qs.set('at', at)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return `/api/darwin/service/${encodeURIComponent(rid)}${suffix}`
}

/** Warm the in-memory cache from a historical board hover/click so detail opens from RAM. */
export function prefetchDarwinService(rid: string, date?: string, at?: string) {
  if (!rid) return
  const key = serviceCacheKey(rid, date, at)
  if (getCachedService(key) || prefetchInflight.has(key)) return
  prefetchInflight.add(key)
  void fetchDarwin(serviceUrl(rid, date, at))
    .then((res) => (res.ok ? res.json() : null))
    .then((detail) => {
      if (detail) putCachedService(key, detail as ServiceDetail, cacheTtlMs(date))
    })
    .catch(() => undefined)
    .finally(() => prefetchInflight.delete(key))
}

/**
 * Polls /api/darwin/service/:rid every `pollMs` ms while the tab is visible.
 * Mirrors the shape and behaviour of `useDepartures`.
 */
export function useServiceDetail({
  rid,
  pollMs = DEFAULT_POLL_MS,
  staleAfterMs = DEFAULT_STALE_MS,
  date,
  at,
}: UseServiceDetailOptions): UseServiceDetailResult {
  const [data, setData]     = useState<ServiceDetail | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [status, setStatus] = useState<ServiceDetailStatus>('idle')
  const [ageMs, setAgeMs]   = useState<number | null>(null)

  const abortRef = useRef<AbortController | null>(null)
  const pollRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ageTickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchOnce = useCallback(async () => {
    if (!rid) return
    const cacheKey = serviceCacheKey(rid, date, at)
    const cached = getCachedService(cacheKey)
    if (date && cached) {
      applyCachedDetail(cached, staleAfterMs, setData, setError, setAgeMs, setStatus)
      return
    }
    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    try {
      const url = serviceUrl(rid, date, at)
      let res: Response | null = null
      for (let attempt = 0; attempt <= MAX_NETWORK_RETRIES; attempt += 1) {
        if (ac.signal.aborted) throw createAbortError()
        try {
          res = await fetchDarwin(url, { signal: ac.signal })
          break
        } catch (rawErr) {
          const err = rawErr as Error
          if (ac.signal.aborted) throw createAbortError()
          if (attempt === MAX_NETWORK_RETRIES) {
            throw new Error(err.message || userMessageForNetworkFailure())
          }
          if (!isTransientNetworkError(err)) throw err
          await delay(RETRY_BASE_DELAY_MS * (attempt + 1), ac.signal)
        }
      }
      if (!res) throw new Error(userMessageForNetworkFailure())
      if (res.status === 404) {
        const body = await res.json().catch(() => ({}))
        setData(null)
        setError(body?.error || userMessageForStatus(404))
        setStatus('not-found')
        return
      }
      if (!res.ok) throw new Error(userMessageForStatus(res.status))
      const detail: ServiceDetail = await res.json()
      putCachedService(cacheKey, detail, cacheTtlMs(date))
      applyCachedDetail(detail, staleAfterMs, setData, setError, setAgeMs, setStatus)
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setError((e as Error)?.message || 'Could not load service detail.')
      setStatus(prev => (prev === 'idle' || prev === 'loading' ? 'error' : prev))
    }
  }, [rid, staleAfterMs, date, at])

  const schedulePoll = useCallback(() => {
    if (pollRef.current) clearTimeout(pollRef.current)
    if (!rid || pollMs <= 0) return
    pollRef.current = setTimeout(async () => {
      if (document.visibilityState === 'visible') await fetchOnce()
      schedulePoll()
    }, pollMs)
  }, [rid, fetchOnce, pollMs])

  useEffect(() => {
    if (!rid) { setStatus('idle'); setData(null); setError(null); return }
    const cached = getCachedService(serviceCacheKey(rid, date, at))
    if (cached) {
      applyCachedDetail(cached, staleAfterMs, setData, setError, setAgeMs, setStatus)
      if (date) {
        return () => {
          abortRef.current?.abort()
        }
      }
    } else {
      setStatus(prev => (data ? prev : 'loading'))
    }
    fetchOnce()
    schedulePoll()
    return () => {
      pollRef.current && clearTimeout(pollRef.current)
      abortRef.current?.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rid, pollMs, date, at])

  useEffect(() => {
    if (date) return
    const onVis = () => {
      if (document.visibilityState === 'visible' && rid) fetchOnce()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [rid, fetchOnce, date])

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
    return () => { ageTickRef.current && clearInterval(ageTickRef.current) }
  }, [data, staleAfterMs])

  return { status, data, error, ageMs, refetch: fetchOnce }
}
