import { delayMinutesTone, type CallingPatternTone } from '@/components/darwin/callingPatternTone'
import { colourDelay, delayMinutesAlong, movementDelays, slotKind } from '@/components/darwin/ServiceStopList/ServiceStopList'
import type { ServiceStop } from '@/types/darwin'
import type { LiveJourneyPosition } from '@/utils/serviceJourneyMap'

export type MapLocationBanner = {
  text: string
  tone: CallingPatternTone
}

function hm(value: string | null | undefined): string {
  if (!value) return ''
  const match = /^(\d{1,2}:\d{2})(½|:30)?/.exec(String(value).trim())
  if (!match) return ''
  return match[2] ? `${match[1]}½` : match[1]
}

function minutesLate(booked: string, real: string): number | null {
  const toMins = (clock: string) => {
    const match = /^(\d{1,2}):(\d{2})/.exec(clock)
    if (!match) return null
    return Number(match[1]) * 60 + Number(match[2])
  }
  const scheduled = toMins(booked)
  const live = toMins(real)
  if (scheduled == null || live == null) return null
  let diff = live - scheduled
  if (diff > 720) diff -= 1440
  if (diff < -720) diff += 1440
  return diff
}

/** On Time, 3 min late, or 2 min early. Unknown lateness stays blank. */
function lateness(minutes: number | null | undefined): string {
  if (minutes == null) return ''
  if (minutes === 0) return 'On Time'
  if (minutes > 0) return `${minutes} min late`
  return `${Math.abs(minutes)} min early`
}

function withLateness(time: string, minutes: number | null | undefined): string {
  const word = lateness(minutes)
  return word ? `${time} ${word}` : time
}

function carriedAt(stops: ServiceStop[], index: number): number | null {
  return delayMinutesAlong(stops)[index] ?? null
}

/** A point already behind the train. */
function pastClause(stop: ServiceStop, carried: number | null): string {
  const kind = slotKind(stop.slot)
  const delays = movementDelays(stop, kind)
  if (kind === 'pass') {
    const actual = hm(stop.atp)
    const time = actual || hm(stop.etp) || hm(stop.wtp || stop.wtd || stop.wta)
    if (!time) return ''
    const delay = delays.departure ?? carried
    return actual ? `Passed at ${withLateness(time, delay)}` : `Expected at ${withLateness(time, delay)}`
  }
  const actual = hm(stop.atd)
  const time = actual || hm(stop.etd) || hm(stop.wtd || stop.ptd)
  if (!time) return ''
  const delay = delays.departure ?? carried
  return actual ? `Departed at ${withLateness(time, delay)}` : `Expected at ${withLateness(time, delay)}`
}

/** The next point, still ahead. */
function aheadClause(stop: ServiceStop, carried: number | null): string {
  const kind = slotKind(stop.slot)
  const delays = movementDelays(stop, kind)
  if (kind === 'pass') {
    const actual = hm(stop.atp)
    const time = actual || hm(stop.etp) || hm(stop.wtp || stop.wtd || stop.wta)
    if (!time) return ''
    const delay = delays.departure ?? carried
    return actual ? `Passed at ${withLateness(time, delay)}` : `Expected at ${withLateness(time, delay)}`
  }
  const arrived = hm(stop.ata)
  const time = arrived || hm(stop.eta) || hm(stop.wta || stop.pta) || hm(stop.etd) || hm(stop.wtd || stop.ptd)
  if (!time) return ''
  if (arrived) return `Arrived at ${withLateness(time, delays.arrival ?? carried)}`
  return `Expected at ${withLateness(time, delays.arrival ?? delays.departure ?? carried)}`
}

function departureDelay(stop: ServiceStop): number | null {
  const kind = slotKind(stop.slot)
  const reported = movementDelays(stop, kind).departure
  if (reported != null) return reported
  if (hm(stop.atd)) return null
  const estimate = hm(stop.etd)
  const booked = hm(stop.wtd || stop.ptd)
  if (!estimate || !booked) return null
  return minutesLate(booked, estimate)
}

/** Standing at a call: arrival, then the departure still to come. */
function atStationText(name: string, stop: ServiceStop): string {
  if (stop.cancelledAtStop) return `Cancelled at ${name}`
  const kind = slotKind(stop.slot)
  if (kind === 'pass') {
    const clause = hm(stop.atp) ? pastClause(stop, null) : aheadClause(stop, null)
    return clause ? `${name} (${clause})` : name
  }
  const delays = movementDelays(stop, kind)
  const arrivedAt = hm(stop.ata)
  const arrTime = arrivedAt || hm(stop.eta) || hm(stop.wta || stop.pta)
  const leftAt = hm(stop.atd)
  const depTime = leftAt || hm(stop.etd) || hm(stop.wtd || stop.ptd)
  const parts: string[] = []
  if (arrTime && kind !== 'origin') {
    const word = lateness(delays.arrival)
    if (arrivedAt) {
      parts.push(word ? `Arrived at ${name} ${word} at ${arrivedAt}` : `Arrived at ${name} at ${arrivedAt}`)
    } else {
      parts.push(word ? `Expected at ${name} ${word} at ${arrTime}` : `Expected at ${name} at ${arrTime}`)
    }
  }
  if (depTime && kind !== 'destination') {
    const word = lateness(departureDelay(stop))
    if (leftAt) {
      parts.push(word === 'On Time' ? `Departed On Time at ${leftAt}` : word ? `Departed at ${leftAt} ${word}` : `Departed at ${leftAt}`)
    } else if (!word || word === 'On Time') {
      parts.push(`Expected to Depart at ${depTime}`)
    } else {
      parts.push(`Expected to Depart at ${depTime} ${word}`)
    }
  }
  if (!parts.length) return name
  if (!parts.some((part) => part.includes(` ${name} `) || part.startsWith(`Cancelled at ${name}`))) {
    return `At ${name}, ${parts.join(', ')}`
  }
  return parts.join(', ')
}

function toneFor(
  stops: ServiceStop[],
  fromIdx: number,
  toIdx: number | null,
  atStation: boolean,
  cancelled: boolean,
): CallingPatternTone {
  if (cancelled) return 'cancelled'
  const from = stops[fromIdx]
  const ahead = !atStation && toIdx != null && toIdx !== fromIdx ? stops[toIdx] : null
  const aheadDelay = ahead ? colourDelay(ahead, slotKind(ahead.slot)) : null
  const target = ahead && aheadDelay != null ? ahead : from
  if (!target || target.cancelledAtStop) return target?.cancelledAtStop ? 'cancelled' : 'ontime'
  const kind = slotKind(target.slot)
  const standingDeparture = atStation && kind !== 'destination' ? departureDelay(target) : null
  const own = standingDeparture ?? colourDelay(target, kind)
  const delay = own ?? delayMinutesAlong(stops)[stops.indexOf(target)] ?? null
  if (target.unknownDelay && (delay == null || delay < 1)) return 'delay-16'
  if (delay == null || delay === 0) return 'ontime'
  if (delay <= -1) return 'early'
  return delayMinutesTone(delay)
}

export function mapLocationBanner(
  stops: ServiceStop[],
  live: LiveJourneyPosition | null,
  options?: { cancelled?: boolean },
): MapLocationBanner | null {
  if (!live?.label) return null
  const fromIdx = live.from?.index
  if (fromIdx == null || !stops[fromIdx]) {
    return { text: live.label, tone: options?.cancelled ? 'cancelled' : 'ontime' }
  }
  const toIdx = live.to?.index ?? null
  const from = stops[fromIdx]
  const fromName = live.from?.name || from.name || from.tpl
  const same = live.atStation || toIdx == null || toIdx === fromIdx || !stops[toIdx]
  const text = same
    ? atStationText(fromName, from)
    : (() => {
        const to = stops[toIdx]
        const toName = live.to?.name || to.name || to.tpl
        const left = pastClause(from, carriedAt(stops, fromIdx))
        const right = aheadClause(to, carriedAt(stops, toIdx))
        const leftText = left ? `${fromName} (${left})` : fromName
        const rightText = right ? `${toName} (${right})` : toName
        return `Between ${leftText} and ${rightText}`
      })()
  return {
    text,
    tone: toneFor(stops, fromIdx, toIdx, live.atStation, Boolean(options?.cancelled)),
  }
}
