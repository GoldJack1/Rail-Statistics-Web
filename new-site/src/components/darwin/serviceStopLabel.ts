import type { ServiceDetail } from '@/types/darwin'
import { publicStationName } from '@/utils/publicStationName'
import { sortStopsByWttTime } from '@/utils/wttOrder'

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

const TIPLOC_DISPLAY_NAMES: Record<string, string> = {
  LINCLNC: 'Lincoln Central',
  LVRPLCH: 'Liverpool Central',
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
    const stationName = publicStationName(station.stationName)
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
  const override = TIPLOC_DISPLAY_NAMES[stop.tpl?.toUpperCase()]
  if (override) return override
  const current = publicStationName(stop.name)
  if (current && !isRawTiplocName(current, stop.tpl)) return current
  const byTiplocName = fallbackNameLookup?.byTiploc.get(stop.tpl.toUpperCase())
  if (byTiplocName) return byTiplocName
  const byCrsName = stop.crs ? fallbackNameLookup?.byCrs.get(stop.crs.toUpperCase()) : null
  if (byCrsName) return byCrsName
  const stationLikeFallback = stationLikeNameFromTiploc(stop.tpl)
  if (stationLikeFallback) return stationLikeFallback
  return stop.tpl
}

/** Working-timetable order, including a morning call filed after the evening terminus. */
export function sortStopsByJourneyTime<T extends NonNullable<ServiceDetail['stops']>[number]>(stops: T[]): T[] {
  return sortStopsByWttTime(stops)
}
