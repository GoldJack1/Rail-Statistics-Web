/**
 * Working-timetable order. The journey starts after the longest gap on the
 * clock, unless that rotation is only marginally smoother than the railway
 * day (02:00–01:59). A morning call filed after an evening terminus stays
 * on the morning it is booked.
 */

const DAY_SECONDS = 24 * 3600
const RAIL_START_SECONDS = 2 * 3600
const ROTATION_MARGIN_SECONDS = 90 * 60

export type WttTimed = {
  wta?: string | null
  wtd?: string | null
  wtp?: string | null
  pta?: string | null
  ptd?: string | null
  ata?: string | null
  atd?: string | null
  atp?: string | null
  eta?: string | null
  etd?: string | null
  etp?: string | null
}

function clockSeconds(value: string | null | undefined): number | null {
  if (value == null || value === '') return null
  const text = String(value).trim()
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text)
  if (!match) return null
  const hh = Number(match[1])
  const mm = Number(match[2])
  const ss = match[3] != null ? Number(match[3]) : /½/.test(text) ? 30 : 0
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || !Number.isFinite(ss) || hh > 47 || mm > 59 || ss > 59) {
    return null
  }
  return (hh % 24) * 3600 + mm * 60 + ss
}

function earliest(values: Array<number | null>): number | null {
  const found = values.filter((value): value is number => value != null)
  if (!found.length) return null
  return Math.min(...found)
}

/** Booked working time, then the public time. A live clock does not move a booked call. */
export function wttStopSeconds(stop: WttTimed | null | undefined): number | null {
  if (!stop) return null
  const working = earliest([clockSeconds(stop.wta), clockSeconds(stop.wtd), clockSeconds(stop.wtp)])
  if (working != null) return working
  return earliest([clockSeconds(stop.pta), clockSeconds(stop.ptd)])
}

function liveStopSeconds(stop: WttTimed): number | null {
  return earliest([
    clockSeconds(stop.ata),
    clockSeconds(stop.atd),
    clockSeconds(stop.atp),
    clockSeconds(stop.eta),
    clockSeconds(stop.etd),
    clockSeconds(stop.etp),
  ])
}

function normaliseSeconds(seconds: number): number {
  return ((seconds % DAY_SECONDS) + DAY_SECONDS) % DAY_SECONDS
}

function offsetFromStart(seconds: number, start: number): number {
  return (normaliseSeconds(seconds) - start + DAY_SECONDS) % DAY_SECONDS
}

function railwayStartSeconds(times: number[]): number {
  let best = times[0]
  let bestKey = Infinity
  for (const time of times) {
    const key = time < RAIL_START_SECONDS ? time + DAY_SECONDS : time
    if (key < bestKey) {
      bestKey = key
      best = time
    }
  }
  return best
}

function maxInteriorGap(times: number[], start: number): number {
  const ordered = [...times].sort((a, b) => offsetFromStart(a, start) - offsetFromStart(b, start))
  let max = 0
  for (let i = 1; i < ordered.length; i++) {
    const gap = offsetFromStart(ordered[i], start) - offsetFromStart(ordered[i - 1], start)
    if (gap > max) max = gap
  }
  return max
}

export function journeyStartSeconds(clocks: Array<number | null | undefined>): number {
  const times = [...new Set(clocks.filter((value): value is number => value != null).map(normaliseSeconds))]
  if (!times.length) return RAIL_START_SECONDS
  if (times.length === 1) return railwayStartSeconds(times)
  const sorted = [...times].sort((a, b) => a - b)
  let maxGap = -1
  let after = sorted[0]
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i]
    const b = sorted[(i + 1) % sorted.length]
    let gap = b - a
    if (gap <= 0) gap += DAY_SECONDS
    if (gap > maxGap) {
      maxGap = gap
      after = b
    }
  }
  const rail = railwayStartSeconds(sorted)
  if (after === rail) return rail
  if (maxInteriorGap(sorted, rail) - maxInteriorGap(sorted, after) > ROTATION_MARGIN_SECONDS) return after
  return rail
}

export function sortStopsByWttTime<T extends WttTimed>(stops: T[]): T[] {
  const list = stops || []
  const start = journeyStartSeconds(list.map(wttStopSeconds))
  const rank = (seconds: number | null) => (seconds == null ? null : offsetFromStart(seconds, start))
  const booked: Array<{ stop: T; index: number }> = []
  const floating: Array<{ stop: T; index: number }> = []
  list.forEach((stop, index) => {
    if (wttStopSeconds(stop) != null) booked.push({ stop, index })
    else floating.push({ stop, index })
  })
  const ordered = booked
    .sort((a, b) => {
      const left = rank(wttStopSeconds(a.stop))
      const right = rank(wttStopSeconds(b.stop))
      if (left == null && right == null) return a.index - b.index
      if (left == null) return 1
      if (right == null) return -1
      if (left !== right) return left - right
      return a.index - b.index
    })
    .map((item) => item.stop)
  floating.sort((a, b) => (rank(liveStopSeconds(a.stop)) ?? 1e15) - (rank(liveStopSeconds(b.stop)) ?? 1e15) || a.index - b.index)
  for (const item of floating) {
    const at = rank(liveStopSeconds(item.stop))
    if (at == null) {
      ordered.push(item.stop)
      continue
    }
    let index = ordered.length
    for (let i = 0; i < ordered.length; i++) {
      const ref = rank(liveStopSeconds(ordered[i]) ?? wttStopSeconds(ordered[i]))
      if (ref == null) continue
      if (ref > at) {
        index = i
        break
      }
    }
    ordered.splice(index, 0, item.stop)
  }
  return ordered
}
