/**
 * Departures name search: GB National Rail stations, plus the Eurostar
 * cities that are not in that dataset.
 */

export type DepartureNameStation = {
  stationName: string
  crsCode: string
  tiploc: string | null
  sourceCollectionId?: string | null
  stnarea?: string | null
}

export type DepartureNameHit = {
  name: string
  crs: string
  tiploc: string
}

type EurostarPlace = {
  label: string
  crs: string
  tiploc: string
  crsCodes: readonly string[]
  tiplocs: readonly string[]
  /** Full names. A one-word alias matches a catalogue row only when the names are equal. */
  aliases: readonly string[]
}

const EUROSTAR_PLACES: readonly EurostarPlace[] = [
  {
    label: 'Brussels Midi',
    crs: 'BXS',
    tiploc: 'BRUXMID',
    crsCodes: ['BXS'],
    tiplocs: ['BRUXMID'],
    aliases: ['BRUSSELS MIDI', 'BRUXELLES MIDI', 'BRUSSELS MIDI ZUID', 'BRUXELLES MIDI ZUID'],
  },
  {
    label: 'Lille Europe',
    crs: 'LIU',
    tiploc: 'LILLE',
    crsCodes: ['LIU'],
    tiplocs: ['LILLE'],
    aliases: ['LILLE', 'LILLE EUROPE', 'LILLE NORD EUROPE', 'LILLE NORD-EUROPE'],
  },
  {
    label: 'Rotterdam Centraal',
    crs: 'ROT',
    tiploc: 'ROTTCS',
    crsCodes: ['ROT'],
    tiplocs: ['ROTTCS'],
    aliases: ['ROTTERDAM', 'ROTTERDAM CS', 'ROTTERDAM CENTRAAL', 'ROTTERDAM CENTRAL'],
  },
  {
    label: 'Antwerp Central',
    crs: '',
    tiploc: '',
    crsCodes: [],
    tiplocs: [],
    aliases: ['ANTWERP', 'ANTWERP CENTRAL', 'ANTWERPEN', 'ANTWERPEN CENTRAAL', 'ANVERS', 'ANVERS CENTRAL'],
  },
  {
    label: 'Amsterdam Centraal',
    crs: 'AMS',
    tiploc: 'AMSTDAM',
    crsCodes: ['AMS'],
    tiplocs: ['AMSTDAM'],
    aliases: ['AMSTERDAM', 'AMSTERDAM CS', 'AMSTERDAM CENTRAAL', 'AMSTERDAM CENTRAL'],
  },
  {
    label: 'Paris Gare du Nord',
    crs: 'PBN',
    tiploc: 'PARISND',
    crsCodes: ['PBN'],
    tiplocs: ['PARISND'],
    aliases: ['PARIS NORD', 'PARIS GARE DU NORD', 'PARIS NORD RAIL STATION'],
  },
]

const NAME_LIMIT = 20

export function normDepartureSearchText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/** Name searches for these cities also need catalogue rows that have no CRS. */
export function departureNameQueryNeedsFullCatalog(query: string): boolean {
  const q = normDepartureSearchText(query)
  if (q.length < 2) return false
  return EUROSTAR_PLACES.some((place) => place.aliases.some((alias) => alias.includes(q)))
}

function aliasMatchesCatalogName(alias: string, name: string): boolean {
  if (name === alias) return true
  const words = alias.split(' ').filter(Boolean)
  if (words.length < 2) return false
  return name.includes(alias)
}

function catalogMatchesPlace(row: DepartureNameHit, place: EurostarPlace): boolean {
  const crs = row.crs.trim().toUpperCase()
  const tiploc = row.tiploc.trim().toUpperCase()
  const name = normDepartureSearchText(row.name)
  if (name.includes('SCHIPHOL') || name.includes('FLANDRES') || name.includes('DELIVERANCE')) return false
  if (crs && place.crsCodes.includes(crs)) return true
  if (tiploc && place.tiplocs.includes(tiploc)) return true
  return place.aliases.some((alias) => aliasMatchesCatalogName(alias, name))
}

function placeMatchesQuery(place: EurostarPlace, query: string): boolean {
  return place.aliases.some((alias) => alias.includes(query))
}

function hitKey(row: DepartureNameHit): string {
  return row.tiploc || row.crs || normDepartureSearchText(row.name)
}

/** Ireland, Northern Ireland, heritage and light rail stay out of this search. */
function isGbNationalRailStation(station: DepartureNameStation): boolean {
  const collection = station.sourceCollectionId
  const area = String(station.stnarea || '').trim().toUpperCase()
  if (!collection && !area) return true
  return collection === 'stations_gbnr' || area === 'GBNR'
}

function rankName(name: string, query: string): number {
  const n = normDepartureSearchText(name)
  if (n.startsWith(query)) return 0
  if (n.includes(` ${query}`)) return 1
  return 2
}

export function filterDepartureNameResults(
  query: string,
  stations: readonly DepartureNameStation[],
  catalog: readonly DepartureNameHit[],
  datasetReady: boolean,
): DepartureNameHit[] {
  const q = normDepartureSearchText(query)
  if (q.length < 2) return []

  const hits: DepartureNameHit[] = []
  const seen = new Set<string>()
  const add = (row: DepartureNameHit) => {
    const key = hitKey(row)
    if (!key || seen.has(key)) return
    if (row.crs && seen.has(`crs:${row.crs}`)) return
    seen.add(key)
    if (row.crs) seen.add(`crs:${row.crs}`)
    hits.push(row)
  }

  if (datasetReady) {
    const matched = stations
      .filter((station) => isGbNationalRailStation(station) && normDepartureSearchText(station.stationName).includes(q))
      .sort((a, b) => {
        const rank = rankName(a.stationName, q) - rankName(b.stationName, q)
        if (rank !== 0) return rank
        return a.stationName.localeCompare(b.stationName, undefined, { sensitivity: 'base' })
      })
    for (const station of matched) {
      if (hits.length >= NAME_LIMIT) break
      add({
        name: station.stationName,
        crs: String(station.crsCode || '').trim().toUpperCase(),
        tiploc: String(station.tiploc || '').trim().toUpperCase(),
      })
    }
  }

  for (const row of catalog) {
    const place = EUROSTAR_PLACES.find((candidate) => catalogMatchesPlace(row, candidate))
    if (!place || !placeMatchesQuery(place, q)) continue
    add({
      name: row.name || place.label,
      crs: row.crs.trim().toUpperCase() || place.crs,
      tiploc: row.tiploc.trim().toUpperCase() || place.tiploc,
    })
  }

  for (const place of EUROSTAR_PLACES) {
    if (!place.tiploc && !place.crs) continue
    if (!placeMatchesQuery(place, q)) continue
    add({ name: place.label, crs: place.crs, tiploc: place.tiploc })
  }

  return hits.slice(0, NAME_LIMIT)
}
