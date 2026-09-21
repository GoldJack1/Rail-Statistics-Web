import { useEffect, useMemo, useRef, useState } from 'react'
import type { CoachLoadingValue, DepartureRow, FormationData, ServiceDetail } from '@/types/darwin'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import {
  coachCountFromConsist,
  coachCountFromRow,
  pickCoachLoadingFromService,
  rowHasCoachLoading,
  unitIdsFromConsist,
} from '@/utils/darwinCoachLoading'

export type BoardFormationOverlay = {
  coachLoading: CoachLoadingValue[] | null
  loadingPercentage: number | null
  formation: FormationData | null
  trainLength: number | null
  unitIds: string[] | null
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

function rowHasDisplayStock(row: DepartureRow): boolean {
  const count = coachCountFromRow(row)
  return Boolean((row.unitIds && row.unitIds.length > 0) || (count != null && count > 0))
}

/** Fetch service when the board is missing unit numbers or live coach loading. */
function shouldEnrich(row: DepartureRow): boolean {
  if (!row.rid) return false
  const missingStock = Boolean(row.hasConsist || row.hasFormation) && !rowHasDisplayStock(row)
  const missingLoad =
    !rowHasCoachLoading(row) &&
    Boolean(
      row.hasConsist ||
        row.hasFormation ||
        (row.formation?.coaches && row.formation.coaches.length > 0) ||
        (row.trainLength && row.trainLength > 0) ||
        (row.unitIds && row.unitIds.length > 0),
    )
  return missingStock || missingLoad
}

function trainLengthFromDetail(detail: ServiceDetail, row: DepartureRow): number | null {
  const stops = detail.stops || []
  const current =
    stops.find((stop) => row.sourceTiploc && stop.tpl === row.sourceTiploc) ||
    stops.find((stop) =>
      Boolean(row.scheduledTime && (stop.ptd === row.scheduledTime || stop.pta === row.scheduledTime)),
    )
  if (current?.trainLength && current.trainLength > 0) return current.trainLength
  const published = stops.find((stop) => stop.trainLength && stop.trainLength > 0)
  if (published?.trainLength && published.trainLength > 0) return published.trainLength
  return coachCountFromConsist(detail.consist)
}

export function overlayKeyForRow(row: DepartureRow): string {
  return `${row.rid}:${row.movement ?? 'departure'}`
}

export function applyBoardFormationOverlay(
  row: DepartureRow,
  overlay: BoardFormationOverlay | undefined,
): DepartureRow {
  if (!overlay) return row
  return {
    ...row,
    coachLoading: overlay.coachLoading ?? row.coachLoading,
    loadingPercentage: overlay.loadingPercentage ?? row.loadingPercentage,
    formation: overlay.formation ?? row.formation,
    trainLength: overlay.trainLength ?? row.trainLength,
    unitIds: overlay.unitIds ?? row.unitIds,
    hasFormation: Boolean(overlay.formation || row.hasFormation),
  }
}

export function useBoardCoachLoading(
  rows: DepartureRow[],
  enabled: boolean,
  date?: string,
  at?: string,
): Map<string, BoardFormationOverlay> {
  const [detailsByRid, setDetailsByRid] = useState<Record<string, ServiceDetail>>({})
  const detailsByRidRef = useRef(detailsByRid)
  detailsByRidRef.current = detailsByRid
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

    const fetchRids = async (rids: string[], refresh: boolean) => {
      const queue = rids.filter((rid) => {
        if (inflightRef.current.has(rid)) return false
        if (!refresh && detailsByRidRef.current[rid]) return false
        return true
      })
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

    void fetchRids(ridsNeedingFetch, false)
    const poll = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || cancelled) return
      void fetchRids(ridsRef.current, true)
    }, POLL_MS)

    return () => {
      cancelled = true
      window.clearInterval(poll)
    }
  }, [enabled, ridsNeedingFetch, date, at])

  return useMemo(() => {
    const overlays = new Map<string, BoardFormationOverlay>()
    if (!enabled) return overlays
    for (const row of rows) {
      if (!row.rid) continue
      const detail = detailsByRid[row.rid]
      if (!detail) continue
      const picked = rowHasCoachLoading(row) ? null : pickCoachLoadingFromService(detail, row)
      overlays.set(overlayKeyForRow(row), {
        coachLoading: picked?.coachLoading ?? row.coachLoading ?? null,
        loadingPercentage: picked?.loadingPercentage ?? row.loadingPercentage ?? null,
        formation: detail.formation || row.formation || null,
        trainLength: row.trainLength || trainLengthFromDetail(detail, row),
        unitIds: (row.unitIds && row.unitIds.length ? row.unitIds : unitIdsFromConsist(detail.consist)),
      })
    }
    return overlays
  }, [detailsByRid, enabled, rows])
}
