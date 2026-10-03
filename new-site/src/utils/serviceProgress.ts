import type { ServiceStop } from '../types/darwin'
import { railwayDayMinutesFromHhmm } from './railwayOperatingDayUk'

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

function bookedClock(stop: ServiceStop): string {
  if (isPassSlot(stop.slot)) {
    return trimSeconds(stop.atp || stop.etp || stop.wtp || stop.wtd || stop.wta || stop.pta || stop.ptd)
  }
  return trimSeconds(stop.atd || stop.ata || stop.etd || stop.eta || stop.ptd || stop.pta || stop.wtd || stop.wta || stop.wtp)
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

/**
 * Last calling-pattern row the train has reached: Darwin actuals, then
 * working pass times that have already elapsed since the last departure.
 * Never invents an arrival at a public station.
 */
export function inferProgressIndex(stops: ServiceStop[], nowMins: number | null): number | null {
  const lastActual = lastActualIndex(stops)
  if (lastActual == null) return null
  const at = stops[lastActual]
  const atStation = !isPassSlot(at.slot) && Boolean(trimSeconds(at.ata)) && !trimSeconds(at.atd)
  if (atStation) return lastActual
  if (nowMins == null) return lastActual
  let i = lastActual
  while (true) {
    const next = nextOpenIndex(stops, i)
    if (next == null) return i
    const nxt = stops[next]
    if (hasActual(nxt)) {
      i = next
      continue
    }
    if (!isPassSlot(nxt.slot)) return i
    const booked = railwayDayMinutesFromHhmm(bookedClock(nxt))
    if (booked != null && nowMins >= booked) {
      i = next
      continue
    }
    return i
  }
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
  if (publicCall && !departed) return `Arrived at ${nameAt(reported)}`
  const next = nextOpenIndex(stops, reported)
  if (next == null) return publicCall ? `Just departed ${nameAt(reported)}` : null
  return `Between ${nameAt(reported)} and ${nameAt(next)}`
}
