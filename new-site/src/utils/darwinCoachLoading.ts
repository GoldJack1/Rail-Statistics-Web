import type { CoachLoadingValue, DepartureRow, ServiceDetail, ServiceStop } from '@/types/darwin'

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

export function coachCountFromRow(row: DepartureRow): number | null {
  if (row.trainLength && row.trainLength > 0) return row.trainLength
  const formationCoaches = row.formation?.coaches?.length
  if (formationCoaches && formationCoaches > 0) return formationCoaches
  const loadingCoaches = row.coachLoading?.length
  if (loadingCoaches && loadingCoaches > 0) return loadingCoaches
  return null
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

export function coachLoadUsesPercent(row: DepartureRow, values: Array<number | null>): boolean {
  if (row.loadingPercentage != null && !(row.coachLoading && row.coachLoading.length)) return true
  return values.some((value) => value != null && value > 10)
}

/** Green → amber → red fill matching CarriageMap loading grades. */
export function rowHasCoachLoading(row: DepartureRow): boolean {
  return Boolean(row.coachLoading && row.coachLoading.length > 0) || row.loadingPercentage != null
}

function stopHasCoachLoading(stop: ServiceStop): boolean {
  return Boolean(stop.coachLoading && stop.coachLoading.length > 0) || stop.loadingPercentage != null
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

export function coachLoadTone(value: number | null, asPercent: boolean): CoachLoadTone | null {
  if (value == null || !Number.isFinite(value)) return null
  const t = asPercent ? clamp01(value / 100) : clamp01(value <= 0 ? 0 : (value - 1) / 9)
  if (t < 1 / 3) return 'ontime'
  if (t < 2 / 3) return 'delayed'
  return 'cancelled'
}
