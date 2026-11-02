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

function nextIndex(
  stops: ServiceStop[],
  from: number,
  publicOnly: boolean,
): number | null {
  for (let i = from + 1; i < stops.length; i++) {
    if (stops[i].cancelledAtStop) continue
    if (publicOnly && isPassSlot(stops[i].slot)) continue
    return i
  }
  return null
}

/**
 * Where the train is, named from the calling pattern.
 * Simple view names the public stations either side. The full pattern names
 * the next timing point, including a junction the train is passing.
 */
export function betweenStationsLabel(
  stops: ServiceStop[],
  reported: number,
  nameAt: (index: number) => string,
  options?: { publicOnly?: boolean },
): string | null {
  const publicOnly = Boolean(options?.publicOnly)
  let from = reported
  if (publicOnly) {
    while (from >= 0 && (isPassSlot(stops[from]?.slot) || stops[from]?.cancelledAtStop)) from -= 1
  }
  const at = stops[from]
  if (!at || at.cancelledAtStop) return null
  const publicCall = !isPassSlot(at.slot)
  const departed = Boolean(trimSeconds(at.atd)) || at.liveKind === 'actual'
  const next = nextIndex(stops, from, publicOnly)
  if (publicCall && !departed) {
    if (next == null) return null
    return `Arrived at ${nameAt(from)}`
  }
  if (next == null) return publicCall ? `Just departed ${nameAt(from)}` : null
  return `Between ${nameAt(from)} and ${nameAt(next)}`
}
