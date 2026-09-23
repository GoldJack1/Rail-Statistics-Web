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

function isRawTiplocName(name: string | null | undefined, tpl: string): boolean {
  if (!name) return true
  const trimmedName = name.trim()
  const trimmedTpl = tpl.trim()
  if (trimmedName === trimmedTpl) return true
  return trimmedName === trimmedName.toUpperCase()
    && trimmedName.toUpperCase() === trimmedTpl.toUpperCase()
}

function titleCaseWord(word: string): string {
  if (!word) return word
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

function stationLikeNameFromTiploc(tpl: string): string | null {
  const raw = (tpl || '').trim().toUpperCase()
  if (!raw) return null
  if (/^[A-Z0-9]{4,}$/.test(raw)) {
    const expanded = raw
      .replace(/JNCT$/g, ' JNCT')
      .replace(/JCN$/g, ' JCN')
      .replace(/JN$/g, ' JN')
      .replace(/PASS$/g, ' PASS')
      .replace(/PSS$/g, ' PSS')
      .replace(/HALT$/g, ' HALT')
      .replace(/(?:\d)(?=[A-Z])/g, '$& ')
      .replace(/([A-Z])([0-9])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
    const words = expanded.split(' ')
    return words.map((w) => {
      if (w === 'JN' || w === 'JCN' || w === 'JNCT' || w === 'PSS') return w
      return titleCaseWord(w)
    }).join(' ')
  }
  return null
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
