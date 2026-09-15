import type { DPAYGStation } from '@/types/dpayg'

const QUERY_ALIASES: Array<[RegExp, string]> = [
  [/\bstanstead\b/g, 'stansted'],
  [/\baiport\b/g, 'airport'],
  [/\bkings x\b/g, 'kings cross'],
  [/\bst pancras\b/g, 'pancras'],
]

function normalizePaygSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[./(),+\-–—]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function applySearchAliases(value: string): string {
  let next = value
  for (const [pattern, replacement] of QUERY_ALIASES) {
    next = next.replace(pattern, replacement)
  }
  return next
}

function searchTokens(query: string): string[] {
  const normalized = applySearchAliases(normalizePaygSearchText(query))
  return normalized.split(' ').filter(Boolean)
}

function stationHaystack(station: DPAYGStation): string {
  return normalizePaygSearchText(
    `${station.name} ${station.crs} ${station.displayCrs ?? ''} ${station.zone ?? ''}`
  )
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true
  const delta = Math.abs(a.length - b.length)
  if (delta > 1) return false
  if (a.length > b.length) return editDistanceAtMostOne(b, a)
  let skips = 0
  let ai = 0
  for (let bi = 0; bi < b.length; bi += 1) {
    if (ai < a.length && a[ai] === b[bi]) {
      ai += 1
      continue
    }
    skips += 1
    if (skips > 1) return false
    if (a.length === b.length) ai += 1
  }
  return true
}

function tokenMatchesHaystack(token: string, hay: string, hayWords: string[]): boolean {
  if (hay.includes(token)) return true
  if (token.length < 4) return false
  return hayWords.some((word) => word.length >= 4 && editDistanceAtMostOne(token, word))
}

function stationMatchesTokens(station: DPAYGStation, tokens: string[]): boolean {
  if (tokens.length === 0) return true
  const hay = stationHaystack(station)
  const hayWords = hay.split(' ').filter(Boolean)
  return tokens.every((token) => tokenMatchesHaystack(token, hay, hayWords))
}

function stationKindBoost(station: DPAYGStation): number {
  const name = station.name.toLowerCase()
  const crs = station.crs.trim().toUpperCase()
  const wordCount = station.name.trim().split(/\s+/).filter(Boolean).length
  let score = 0
  if (name.includes('underground') || crs.startsWith('940')) score -= 50
  if (name.includes('rail station')) score += 80
  else if (name.startsWith('london ')) score += 25
  else if (crs.startsWith('910')) score += 20
  if (wordCount <= 2) score -= 45
  return score
}

function stationMatchScore(station: DPAYGStation, tokens: string[]): number {
  const hay = stationHaystack(station)
  const hayWords = hay.split(' ').filter(Boolean)
  const joined = tokens.join(' ')
  const nameWithoutLondon = hay.replace(/^london /, '')
  let score = stationKindBoost(station)
  if (hay.startsWith(joined) || nameWithoutLondon.startsWith(joined)) score += 200
  if (hayWords[0] && tokens[0] && hayWords[0].startsWith(tokens[0])) score += 80
  if (hay.includes(` ${joined}`) || hay.startsWith(joined) || nameWithoutLondon.startsWith(joined)) {
    score += 40
  }
  score -= Math.min(station.name.length, 80)
  return score
}

function stationsWithPublicCode(stations: DPAYGStation[], code: string): DPAYGStation[] {
  const needle = code.trim().toUpperCase()
  if (!needle) return []
  return stations.filter(
    (station) =>
      station.crs.trim().toUpperCase() === needle ||
      station.displayCrs?.trim().toUpperCase() === needle
  )
}

/** When several stops share a CRS (NR / Elizabeth line / Tube), keep mainline NR. */
function preferNationalRail(stations: DPAYGStation[]): DPAYGStation {
  return [...stations].sort((a, b) => {
    const rank = (station: DPAYGStation) => {
      const name = station.name.toLowerCase()
      const crs = station.crs.trim().toUpperCase()
      let score = 0
      if (crs.startsWith('910')) score += 3
      if (name.includes('rail station')) score += 4
      if (name.startsWith('london ')) score += 2
      if (name.includes('underground') || crs.startsWith('940')) score -= 6
      return score
    }
    return rank(b) - rank(a) || a.name.localeCompare(b.name)
  })[0]!
}

function rankedMatches(stations: DPAYGStation[], tokens: string[]): DPAYGStation[] {
  return stations
    .filter((station) => stationMatchesTokens(station, tokens))
    .sort((a, b) => stationMatchScore(b, tokens) - stationMatchScore(a, tokens) || a.name.localeCompare(b.name))
}

/** Label shown in search inputs after a station is picked. */
export function stationSearchLabel(station: DPAYGStation, showStationCodes: boolean): string {
  const code = stationPublicCode(station, showStationCodes)
  if (!code) return station.name
  return `${station.name} (${code})`
}

export function stationPublicCode(station: DPAYGStation, showStationCodes: boolean): string {
  return (station.displayCrs || (showStationCodes ? station.crs : '') || '').trim()
}

export function matchDpaygStation(
  stations: DPAYGStation[],
  query: string
): DPAYGStation | null {
  const trimmed = query.trim()
  if (!trimmed) return null

  const parenMatch = trimmed.match(/^(.*)\(([A-Za-z]{3})\)\s*$/)
  const parenCode = parenMatch?.[2]?.toUpperCase()
  const namePart = (parenMatch?.[1] ?? '').trim()

  if (parenCode) {
    const coded = stationsWithPublicCode(stations, parenCode)
    if (namePart) {
      const normalizedName = applySearchAliases(normalizePaygSearchText(namePart))
      const exactNamed = coded.filter(
        (station) => applySearchAliases(normalizePaygSearchText(station.name)) === normalizedName
      )
      if (exactNamed.length === 1) return exactNamed[0]!
      if (exactNamed.length > 1) return preferNationalRail(exactNamed)
      const rankedNamed = rankedMatches(coded, searchTokens(namePart))
      if (rankedNamed[0]) return rankedNamed[0]
    }
    if (coded.length === 1) return coded[0]!
    if (coded.length > 1) return preferNationalRail(coded)
  }

  const byCrs = stationsWithPublicCode(stations, trimmed)
  if (byCrs.length === 1) return byCrs[0]!
  if (byCrs.length > 1) return preferNationalRail(byCrs)

  const tokens = searchTokens(trimmed)
  const normalizedNeedle = applySearchAliases(normalizePaygSearchText(trimmed))
  const exactName = stations.find(
    (s) => applySearchAliases(normalizePaygSearchText(s.name)) === normalizedNeedle
  )
  if (exactName) return exactName

  const partial = rankedMatches(stations, tokens)
  if (partial.length === 1) return partial[0]!
  return null
}

/** Stations matching a partial query for suggestion lists. */
export function filterDpaygStations(stations: DPAYGStation[], query: string): DPAYGStation[] {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return stations
  return rankedMatches(stations, tokens)
}
