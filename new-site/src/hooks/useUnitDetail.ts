import { useCallback, useEffect, useRef, useState } from 'react'
import type { UnitDetail } from '@/types/darwin'
import { fetchDarwin } from '@/utils/darwinReadyFetch'

export type UnitDetailStatus =
  | 'idle'
  | 'loading'
  | 'ok'
  | 'error'
  | 'not-found'

export interface UseUnitDetailOptions {
  unitId: string
  date?: string
}

export interface UseUnitDetailResult {
  status: UnitDetailStatus
  data: UnitDetail | null
  error: string | null
  refetch: () => void
}

type UnitDetailCacheEntry = {
  detail: UnitDetail
  cachedAtMs: number
}

const unitDetailCache = new Map<string, UnitDetailCacheEntry>()
const UNIT_DETAIL_CACHE_TTL_MS = 5 * 60_000

function unitDetailCacheKey(unitId: string, date?: string): string {
  return `${unitId}|${date || ''}`
}

function userMessageForStatus(status: number): string {
  if (status === 401 || status === 403) return 'Access to unit data is currently restricted.'
  if (status === 404) return 'Unit not found.'
  if (status >= 500) return 'Unit data is temporarily unavailable. Please try again shortly.'
  return `Request failed (${status}).`
}

export function useUnitDetail({ unitId, date }: UseUnitDetailOptions): UseUnitDetailResult {
  const [data, setData] = useState<UnitDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<UnitDetailStatus>('idle')
  const abortRef = useRef<AbortController | null>(null)

  const fetchOnce = useCallback(async () => {
    if (!unitId) {
      setStatus('idle')
      setData(null)
      setError(null)
      return
    }

    const cacheKey = unitDetailCacheKey(unitId, date)
    const cached = unitDetailCache.get(cacheKey)
    if (cached && Date.now() - cached.cachedAtMs <= UNIT_DETAIL_CACHE_TTL_MS) {
      setData(cached.detail)
      setError(null)
      setStatus('ok')
      return
    }

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac
    setStatus((prev) => (prev === 'ok' ? 'ok' : 'loading'))

    try {
      const qs = date ? `?date=${encodeURIComponent(date)}` : ''
      const res = await fetchDarwin(`/api/darwin/unit/${encodeURIComponent(unitId)}${qs}`, { signal: ac.signal })
      if (res.status === 404) {
        const body = await res.json().catch(() => ({}))
        setStatus('not-found')
        setData(null)
        setError(body?.error || userMessageForStatus(404))
        return
      }
      if (!res.ok) throw new Error(userMessageForStatus(res.status))
      const detail: UnitDetail = await res.json()
      unitDetailCache.set(cacheKey, { detail, cachedAtMs: Date.now() })
      setData(detail)
      setError(null)
      setStatus('ok')
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return
      setError((e as Error)?.message || 'Could not load unit detail.')
      setStatus('error')
    }
  }, [unitId, date])

  useEffect(() => {
    fetchOnce()
    return () => abortRef.current?.abort()
  }, [fetchOnce])

  return { status, data, error, refetch: fetchOnce }
}
