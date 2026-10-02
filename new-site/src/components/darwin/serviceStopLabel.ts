import type { ServiceDetail } from '@/types/darwin'

export type StopNameLookup = {
  byTiploc: Map<string, string>
  byCrs: Map<string, string>
}

type NamedStation = {
  stationName?: string | null
  tiploc?: string | null
  crsCode?: string | null
}

function alnumUpper(value: string): string {
  return value.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
}

function isRawTiplocName(name: string | null | undefined, tpl: string): boolean {
  if (!name) return true
  const trimmedName = name.trim()
  const trimmedTpl = tpl.trim()
  if (!trimmedName) return true
  if (trimmedName === trimmedTpl) return true
  if (alnumUpper(trimmedName) === alnumUpper(trimmedTpl)) return true
  return trimmedName === trimmedName.toUpperCase()
    && trimmedName.toUpperCase() === trimmedTpl.toUpperCase()
}

const PLACE_STEMS: Record<string, string> = {
  ARML: 'Armley',
  APERLY: 'Apperley',
  SHPYD: 'Shipley',
  SHPY: 'Shipley',
  MALTK: 'Malton',
  SEAMW: 'Seamer',
}

function stationLikeNameFromTiploc(tpl: string): string | null {
  const raw = (tpl || '').trim().toUpperCase()
  if (!raw) return null
  const suffixes: Array<[RegExp, string]> = [
    [/WESTJN$/, ' West Junction'],
    [/EASTJN$/, ' East Junction'],
    [/SOUTHJN$/, ' South Junction'],
    [/NORTHJN$/, ' North Junction'],
    [/WJ$/, ' West Junction'],
    [/EJ$/, ' East Junction'],
    [/SJ$/, ' South Junction'],
    [/NJ$/, ' North Junction'],
    [/DJN$/, ' Junction'],
    [/UJN$/, ' Junction'],
    [/JNCT$/, ' Junction'],
    [/JCN$/, ' Junction'],
    [/JN$/, ' Junction'],
  ]
  let rest = raw
  let suffix = ''
  for (const [re, label] of suffixes) {
    if (re.test(rest)) {
      suffix = label
      rest = rest.replace(re, '')
      break
    }
  }
  if (!suffix && /J$/.test(rest) && rest.length >= 6) {
    suffix = ' Junction'
    rest = rest.slice(0, -1)
  }
  if (!rest) return suffix.trim() || raw
  const stem = PLACE_STEMS[rest] || Object.entries(PLACE_STEMS).find(([k]) => rest.startsWith(k) && k.length >= 4)?.[1]
  const place =
    stem ||
    rest
      .toLowerCase()
      .replace(/(^|\s)\S/g, (ch) => ch.toUpperCase())
  return `${place}${suffix}`
}

export function buildStopNameLookup(stations: NamedStation[]): StopNameLookup {
  const byTiploc = new Map<string, string>()
  const byCrs = new Map<string, string>()
  for (const station of stations) {
    const stationName = station.stationName?.trim()
    if (!stationName) continue
    const tiploc = station.tiploc?.trim().toUpperCase()
    const crsCode = station.crsCode?.trim().toUpperCase()
    if (tiploc && !byTiploc.has(tiploc)) byTiploc.set(tiploc, stationName)
    if (crsCode && !byCrs.has(crsCode)) byCrs.set(crsCode, stationName)
  }
  return { byTiploc, byCrs }
}

export function displayStopName(
  stops: NonNullable<ServiceDetail['stops']>,
  idx: number,
  fallbackNameLookup?: StopNameLookup
): string {
  const stop = stops[idx]
  if (!stop) return ''
  const current = stop.name?.trim()
  if (current && !isRawTiplocName(current, stop.tpl)) return current
  const byTiplocName = fallbackNameLookup?.byTiploc.get(stop.tpl.toUpperCase())
  if (byTiplocName) return byTiplocName
  const byCrsName = stop.crs ? fallbackNameLookup?.byCrs.get(stop.crs.toUpperCase()) : null
  if (byCrsName) return byCrsName
  const stationLikeFallback = stationLikeNameFromTiploc(stop.tpl)
  if (stationLikeFallback) return stationLikeFallback
  return stop.tpl
}

const RAILWAY_DAY_START_MINUTES = 2 * 60

function parseHmMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null
  return (hh % 24) * 60 + mm
}

function stopScheduledMinutes(stop: NonNullable<ServiceDetail['stops']>[number]): number | null {
  return parseHmMinutes(stop.ptd || stop.pta || stop.wtd || stop.wta || stop.wtp)
}

function railwayDayMinutes(clockMins: number, overnightLong = false): number {
  if (overnightLong) return clockMins < 12 * 60 ? clockMins + 1440 : clockMins;
  return clockMins < RAILWAY_DAY_START_MINUTES ? clockMins + 1440 : clockMins
}

/** Start of the run → end of the run on the 02:00–01:59 railway day. */
export function sortStopsByJourneyTime<T extends NonNullable<ServiceDetail['stops']>[number]>(stops: T[]): T[] {
  let seenEvening = false
  const overnightLong = stops.some((stop, i, list) => {
    const m = stopScheduledMinutes(stop)
    if (m == null) return false
    if (m >= 18 * 60) seenEvening = true
    return seenEvening && m < 12 * 60 && i > 0
  })
  return stops.map((stop, index) => ({ stop, index })).sort((a, b) => {
    const am = stopScheduledMinutes(a.stop)
    const bm = stopScheduledMinutes(b.stop)
    if (am == null && bm == null) return a.index - b.index
    if (am == null) return 1
    if (bm == null) return -1
    const d = railwayDayMinutes(am, overnightLong) - railwayDayMinutes(bm, overnightLong)
    return d || a.index - b.index
  }).map((row) => row.stop)
}
