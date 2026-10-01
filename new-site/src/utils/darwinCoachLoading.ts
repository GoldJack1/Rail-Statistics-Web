import type { CoachLoadingValue, ConsistData, DepartureRow, ServiceDetail, ServiceStop } from '@/types/darwin'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function coachCountFromConsist(consist: ConsistData | null | undefined): number | null {
  if (!consist?.allocations?.length) return null
  const ids = new Set<string>()
  let maxGroup = 0
  for (const allocation of consist.allocations) {
    for (const group of allocation.resourceGroups || []) {
      const vehicles = group.vehicles || []
      maxGroup = Math.max(maxGroup, vehicles.length)
      for (const vehicle of vehicles) {
        const id = vehicle.vehicleId?.trim()
        if (id) ids.add(id)
      }
    }
  }
  if (ids.size > 0) return ids.size
  return maxGroup > 0 ? maxGroup : null
}

export function unitIdsFromConsist(consist: ConsistData | null | undefined): string[] | null {
  if (!consist?.allocations?.length) return null
  const ids: string[] = []
  const seen = new Set<string>()
  for (const allocation of consist.allocations) {
    for (const group of allocation.resourceGroups || []) {
      const unitId = group.unitId?.trim()
      if (!unitId || seen.has(unitId)) continue
      seen.add(unitId)
      ids.push(unitId)
    }
  }
  return ids.length ? ids : null
}

/** Typical vehicles per TOPS class, used when Darwin has no trainLength. */
function carsForClassNumber(n: number): number {
  if (n === 139 || n === 153) return 1
  if (n === 159 || n === 166 || n === 185 || n === 195 || n === 196 || n === 197) return 3
  if (n === 180) return 5
  if (n === 220) return 4
  if (n === 221 || n === 222) return 5
  if (n === 331 || n === 334 || n === 380 || n === 385) return 3
  if (n === 333 || n === 350 || n === 357 || n === 360 || n === 365 || n === 379 || n === 387) return 4
  if (n === 345) return 9
  if (n === 378) return 5
  if (n === 390) return 9
  if (n === 397) return 5
  if (n === 700) return 8
  if (n === 707) return 5
  if (n === 717) return 6
  if (n === 720) return 5
  if (n === 730) return 3
  if (n === 745) return 12
  if (n === 755 || n === 756) return 3
  if (n === 800 || n === 801 || n === 802 || n === 803 || n === 805 || n === 810) return 5
  if (n === 807) return 7
  if (n >= 100 && n < 200) return 2
  if (n >= 300 && n < 400) return 4
  if (n >= 700 && n < 900) return 5
  return 2
}

export function coachCountFromUnitIds(unitIds: string[] | null | undefined): number | null {
  if (!unitIds?.length) return null
  let total = 0
  for (const raw of unitIds) {
    const match = String(raw).match(/^(\d{3})/)
    if (!match) continue
    total += carsForClassNumber(Number(match[1]))
  }
  return total > 0 ? total : null
}

export function coachCountFromRow(row: DepartureRow): number | null {
  if (row.trainLength && row.trainLength > 0) return row.trainLength
  const formationCoaches = row.formation?.coaches?.length
  if (formationCoaches && formationCoaches > 0) return formationCoaches
  const loadingCoaches = row.coachLoading?.length
  if (loadingCoaches && loadingCoaches > 0) return loadingCoaches
  return coachCountFromUnitIds(row.unitIds)
}

export function coachLoadValues(row: DepartureRow, count: number): Array<number | null> {
  const values: Array<number | null> = Array.from({ length: count }, () => null)
  const loads = row.coachLoading
  if (loads && loads.length > 0) {
    const ordered = row.reverseFormation ? [...loads].reverse() : loads
    const coaches = row.formation?.coaches
    if (coaches && coaches.length === count) {
      const byNumber = new Map(ordered.map((coach) => [coach.number, coach.value]))
      coaches.forEach((coach, index) => {
        const value = byNumber.get(coach.number)
        values[index] = typeof value === 'number' && Number.isFinite(value) ? value : null
      })
      return values
    }
    ordered.forEach((coach, index) => {
      if (index < count && Number.isFinite(coach.value)) values[index] = coach.value
    })
    return values
  }
  if (row.loadingPercentage != null && Number.isFinite(row.loadingPercentage)) {
    return values.map(() => row.loadingPercentage)
  }
  return values
}

/** Darwin formationLoading is 1–10; XR (and overall loadingPercentage) is 0–100. */
export function coachLoadUsesPercent(row: DepartureRow, values: Array<number | null>): boolean {
  if (row.loadingPercentage != null && !(row.coachLoading && row.coachLoading.length)) return true
  return values.some((value) => value != null && value > 10)
}

export function coachLoadingIsPercent(
  values: Array<number | null | undefined>,
  overallPercent?: number | null,
  hasPerCoach?: boolean,
): boolean {
  if (overallPercent != null && !hasPerCoach) return true
  return values.some((value) => value != null && value > 10)
}

/** Normalise Darwin 1–10 occupancy onto a 0–100 scale. XR/GTR % stays as-is. */
export function loadPercentValue(value: number, asPercent: boolean): number {
  if (asPercent || value > 10) return value
  return value * 10
}

export function formatCoachLoad(value: number, asPercent = true): string {
  return `${Math.round(loadPercentValue(value, asPercent))}%`
}

/** Green → amber → red fill matching CarriageMap loading grades. */
export function coachLoadFill(value: number | null, asPercent = true): string {
  if (value == null || !Number.isFinite(value)) return 'var(--bg-secondary)'
  const t = clamp01(loadPercentValue(value, asPercent) / 100)
  const hue = Math.round(120 - 120 * t)
  const intensity = 20 + Math.round(t * 50)
  return `color-mix(in srgb, hsl(${hue} 70% 50%) ${intensity}%, var(--bg-secondary))`
}

export function rowHasCoachLoading(row: DepartureRow): boolean {
  return Boolean(row.coachLoading && row.coachLoading.length > 0) || row.loadingPercentage != null
}

export function stopHasPublishedLoading(stop: { coachLoading?: unknown[] | null; loadingPercentage?: number | null }): boolean {
  return (
    Boolean(stop.coachLoading && stop.coachLoading.length > 0) ||
    (stop.loadingPercentage != null && Number.isFinite(stop.loadingPercentage))
  )
}

function stopHasCoachLoading(stop: ServiceStop): boolean {
  return stopHasPublishedLoading(stop)
}

/**
 * Prefer loading at the board's current stop; otherwise use the latest published
 * loading further up the journey (Elizabeth Line often only sends it at origin).
 */
export function pickCoachLoadingFromService(
  detail: ServiceDetail,
  row: DepartureRow,
): { coachLoading: CoachLoadingValue[] | null; loadingPercentage: number | null } | null {
  const stops = detail.stops || []
  if (stops.length === 0) return null

  const currentIndex = stops.findIndex((stop) => {
    if (row.sourceTiploc && stop.tpl === row.sourceTiploc) return true
    if (row.scheduledTime && (stop.ptd === row.scheduledTime || stop.pta === row.scheduledTime)) return true
    return false
  })

  const searchFrom = currentIndex >= 0 ? currentIndex : stops.length - 1
  for (let index = searchFrom; index >= 0; index -= 1) {
    const stop = stops[index]
    if (stopHasCoachLoading(stop)) {
      return {
        coachLoading: stop.coachLoading,
        loadingPercentage: stop.loadingPercentage,
      }
    }
  }

  const published = stops.find(stopHasCoachLoading)
  if (!published) return null
  return {
    coachLoading: published.coachLoading,
    loadingPercentage: published.loadingPercentage,
  }
}

export type CoachLoadTone = 'ontime' | 'delayed' | 'cancelled'

export function coachLoadTone(value: number | null, asPercent = true): CoachLoadTone | null {
  if (value == null || !Number.isFinite(value)) return null
  const t = clamp01(loadPercentValue(value, asPercent) / 100)
  if (t < 1 / 3) return 'ontime'
  if (t < 2 / 3) return 'delayed'
  return 'cancelled'
}
