import type { ServiceStop } from '../types/darwin'

function trimSeconds(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : ''
}

function isPassSlot(slot: string | null | undefined): boolean {
  return slot === 'PP' || slot === 'OPPP'
}

function hasActual(stop: ServiceStop): boolean {
  return Boolean(trimSeconds(stop.atd || stop.ata || stop.atp)) ||
    stop.liveKind === 'actual' ||
    stop.liveKind === 'actual-arr'
}

export function lastActualIndex(stops: ServiceStop[]): number | null {
  let last = -1
  for (let i = 0; i < stops.length; i++) {
    if (hasActual(stops[i]) && !stops[i].cancelledAtStop) last = i
  }
  return last >= 0 ? last : null
}

export function nextOpenIndex(stops: ServiceStop[], from: number): number | null {
  for (let i = from + 1; i < stops.length; i++) {
    if (!stops[i].cancelledAtStop) return i
  }
  return null
}

function isUnreportedOrmPass(stop: ServiceStop): boolean {
  return isPassSlot(stop.slot) && String(stop.actualSource || '') === 'orm' && !hasActual(stop)
}

/** Next row that should count for live progress (skip densify ghosts). */
export function nextProgressIndex(stops: ServiceStop[], from: number): number | null {
  for (let i = from + 1; i < stops.length; i++) {
    if (stops[i].cancelledAtStop) continue
    if (isUnreportedOrmPass(stops[i])) continue
    return i
  }
  return null
}

/**
 * Last calling-pattern row the train has actually reported.
 * Booked or working times do not move the live position — it stays on the
 * last point with an arrival, departure, or pass report.
 */
export function inferProgressIndex(stops: ServiceStop[], _nowMins: number | null): number | null {
  return lastActualIndex(stops)
}

export function betweenStationsLabel(
  stops: ServiceStop[],
  reported: number,
  nameAt: (index: number) => string,
): string | null {
  const at = stops[reported]
  if (!at || at.cancelledAtStop) return null
  const publicCall = !isPassSlot(at.slot)
  const departed = Boolean(trimSeconds(at.atd)) || at.liveKind === 'actual'
  const next = nextOpenIndex(stops, reported)
  if (publicCall && !departed) {
    if (next == null) return null
    return `Arrived at ${nameAt(reported)}`
  }
  if (next == null) return publicCall ? `Just departed ${nameAt(reported)}` : null
  return `Between ${nameAt(reported)} and ${nameAt(next)}`
}
