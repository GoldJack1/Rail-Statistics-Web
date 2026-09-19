import { useEffect, useMemo, useRef, useState } from 'react'
import type { CoachLoadingValue, DepartureRow, ServiceDetail } from '@/types/darwin'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { pickCoachLoadingFromService, rowHasCoachLoading } from '@/utils/darwinCoachLoading'

type LoadingOverlay = {
  coachLoading: CoachLoadingValue[] | null
  loadingPercentage: number | null
}

const FETCH_CONCURRENCY = 4
const POLL_MS = 15_000

function serviceUrl(rid: string, date?: string, at?: string): string {
  const qs = new URLSearchParams()
  if (date) qs.set('date', date)
  if (at) qs.set('at', at)
  const suffix = qs.toString() ? `?${qs.toString()}` : ''
  return `/api/darwin/service/${encodeURIComponent(rid)}${suffix}`
}

function shouldEnrich(row: DepartureRow): boolean {
  if (rowHasCoachLoading(row)) return false
  return Boolean(
    row.hasFormation ||
      (row.formation?.coaches && row.formation.coaches.length > 0) ||
      (row.trainLength && row.trainLength > 0) ||
      (row.unitIds && row.unitIds.length > 0),
  )
}

export function useBoardCoachLoading(
  rows: DepartureRow[],
  enabled: boolean,
  date?: string,
  at?: string,
): Map<string, LoadingOverlay> {
  const [detailsByRid, setDetailsByRid] = useState<Record<string, ServiceDetail>>({})
  const inflightRef = useRef(new Set<string>())

  const ridsNeedingFetch = useMemo(() => {
    if (!enabled) return []
    const seen = new Set<string>()
    const rids: string[] = []
    for (const row of rows) {
      if (!row.rid || seen.has(row.rid) || !shouldEnrich(row)) continue
      seen.add(row.rid)
      rids.push(row.rid)
    }
    return rids
  }, [enabled, rows])

  const ridsRef = useRef(ridsNeedingFetch)
  ridsRef.current = ridsNeedingFetch

  useEffect(() => {
    if (!enabled) return undefined
    let cancelled = false

    const fetchRids = async (rids: string[]) => {
      const queue = rids.filter((rid) => !inflightRef.current.has(rid))
      const workers = Array.from({ length: Math.min(FETCH_CONCURRENCY, queue.length) }, async () => {
        while (!cancelled && queue.length > 0) {
          const rid = queue.shift()
          if (!rid) break
          inflightRef.current.add(rid)
          try {
            const res = await fetchDarwin(serviceUrl(rid, date, at))
            if (!res.ok) continue
            const detail = (await res.json()) as ServiceDetail
            if (cancelled) return
            setDetailsByRid((prev) => ({ ...prev, [rid]: detail }))
          } catch {
            /* keep board usable if a single RID fails */
          } finally {
            inflightRef.current.delete(rid)
          }
        }
      })
      await Promise.all(workers)
    }

    void fetchRids(ridsNeedingFetch)
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || cancelled) return
      void fetchRids(ridsRef.current)
    }, POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(poll)
    }
  }, [enabled, ridsNeedingFetch, date, at])

  return useMemo(() => {
    const overlays = new Map<string, LoadingOverlay>()
    if (!enabled) return overlays
    for (const row of rows) {
      if (rowHasCoachLoading(row) || !row.rid) continue
      const detail = detailsByRid[row.rid]
      if (!detail) continue
      const picked = pickCoachLoadingFromService(detail, row)
      if (picked) overlays.set(`${row.rid}:${row.movement ?? 'departure'}`, picked)
    }
    return overlays
  }, [detailsByRid, enabled, rows])
}
