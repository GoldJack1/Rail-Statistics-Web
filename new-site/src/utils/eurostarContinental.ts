import type { ServiceStop } from '../types/darwin'
import { isValidStationCoordinate } from './stationCoordinates'

type LatLng = { lat: number; lng: number }
export type LatLngTuple = [number, number]

/**
 * WGS84 for Eurostar stations that the UK TIPLOC file does not locate.
 * Paris Nord, Brussels Midi and Marne-la-Vallée are present, but only as the
 * NaPTAN placeholder at Folkestone. Lille, Rotterdam and Amsterdam are absent.
 * Figures are the railmap positions in rail-core/tt/ref/tiplocs-merged.csv.
 */
const CONTINENTAL: ReadonlyArray<{
  tiplocs: readonly string[]
  crs: readonly string[]
  names: readonly string[]
  lat: number
  lng: number
}> = [
  {
    tiplocs: ['PARISND'],
    crs: ['PBN'],
    names: ['PARIS NORD', 'PARIS GARE DU NORD', 'PARIS NORD RAIL STATION'],
    lat: 48.8805227,
    lng: 2.3547846,
  },
  {
    tiplocs: ['LILLE'],
    crs: ['LIU'],
    names: ['LILLE EUROPE', 'LILLE NORD EUROPE'],
    lat: 50.6360451,
    lng: 3.0712488,
  },
  {
    tiplocs: ['BRUXMID'],
    crs: ['BXS'],
    names: ['BRUXELLES MIDI', 'BRUSSELS MIDI', 'BRUSSELS MIDI ZUID', 'BRUXELLES MIDI ZUID'],
    lat: 50.8359803,
    lng: 4.3361404,
  },
  {
    tiplocs: ['ROTTCS'],
    crs: ['ROT'],
    names: ['ROTTERDAM CS', 'ROTTERDAM CENTRAAL', 'ROTTERDAM CENTRAL'],
    lat: 51.9250583,
    lng: 4.4692308,
  },
  {
    tiplocs: ['AMSTDAM'],
    crs: ['AMS'],
    names: ['AMSTERDAM CS', 'AMSTERDAM CENTRAAL', 'AMSTERDAM CENTRAL'],
    lat: 52.3791235,
    lng: 4.9007656,
  },
  {
    tiplocs: ['MARNELV'],
    crs: ['MCK'],
    names: ['MARNE LA VALLEE', 'MARNE LA VALLEE CHESSY'],
    lat: 48.8697031,
    lng: 2.7826439,
  },
]

/** UK ends of the high-speed line, used only when no catalogue or TIPLOC pin exists. */
const NETWORK_ENDS: ReadonlyArray<{
  tiplocs: readonly string[]
  names: readonly string[]
  lat: number
  lng: number
}> = [
  { tiplocs: ['STPANCI'], names: ['LONDON ST PANCRAS INTL', 'ST PANCRAS INTERNATIONAL'], lat: 51.53253, lng: -0.1269 },
  { tiplocs: ['EBSFLTI', 'EBSFEJN'], names: ['EBBSFLEET INTCIV', 'EBBSFLEET INTERNATIONAL'], lat: 51.44298, lng: 0.32092 },
  { tiplocs: ['ASHFKI'], names: ['ASHFORD INTL CIV'], lat: 51.14459, lng: 0.87511 },
  { tiplocs: ['CHUNUKP'], names: ['CHANNEL TUNNEL PORTAL GB'], lat: 51.09688, lng: 1.15456 },
  { tiplocs: ['CHUNFRP'], names: ['CHANNEL TUNNEL PORTAL F'], lat: 50.92286, lng: 1.78016 },
  { tiplocs: ['CHUNCTR'], names: ['EUROTUNNEL BOUNDARY CTRL'], lat: 51.09421, lng: 1.12965 },
]

const METRES_PER_MILE = 1609.344

function normName(value: string | null | undefined): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

function tipKey(value: string | null | undefined): string {
  const tip = String(value || '').trim().toUpperCase()
  if (tip.startsWith('9100') && tip.length > 4) return tip.slice(4)
  return tip
}

type PlaceStop = { tpl?: string | null; crs?: string | null; name?: string | null }

function matchesPlace(
  stop: PlaceStop,
  place: { tiplocs: readonly string[]; crs?: readonly string[]; names: readonly string[] },
): boolean {
  const tip = tipKey(stop.tpl)
  if (tip && place.tiplocs.includes(tip)) return true
  const crs = String(stop.crs || '').trim().toUpperCase()
  if (crs && place.crs?.includes(crs)) return true
  const name = normName(stop.name)
  return Boolean(name) && place.names.includes(name)
}

/** Real continental station position. Null for ordinary UK timing points. */
export function continentalEurostarCoordinate(stop: PlaceStop): LatLng | null {
  for (const place of CONTINENTAL) {
    if (!matchesPlace(stop, place)) continue
    return { lat: place.lat, lng: place.lng }
  }
  return null
}

export function isContinentalEurostarStop(stop: PlaceStop): boolean {
  return continentalEurostarCoordinate(stop) != null
}

/** St Pancras, Ebbsfleet, Ashford and the Channel Tunnel, when nothing else has a pin. */
export function eurostarEndCoordinate(stop: PlaceStop): LatLng | null {
  for (const place of NETWORK_ENDS) {
    if (!matchesPlace(stop, place)) continue
    return { lat: place.lat, lng: place.lng }
  }
  return null
}

export function eurostarLegCoordinate(
  stop: PlaceStop & { lat?: number | null; lng?: number | null },
  tiplocHit?: LatLng | null,
): LatLng | null {
  const continental = continentalEurostarCoordinate(stop)
  if (continental) return continental
  const lat = stop.lat
  const lng = stop.lng
  if (typeof lat === 'number' && typeof lng === 'number' && isValidStationCoordinate(lat, lng)) {
    return { lat, lng }
  }
  if (tiplocHit && isValidStationCoordinate(tiplocHit.lat, tiplocHit.lng)) return tiplocHit
  return eurostarEndCoordinate(stop)
}

function haversineM(a: LatLng, b: LatLng): number {
  const R = 6371000
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function pathLengthMetres(path: LatLngTuple[]): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += haversineM({ lat: path[i - 1][0], lng: path[i - 1][1] }, { lat: path[i][0], lng: path[i][1] })
  }
  return total
}

/**
 * Cumulative metres along a routed line at each waypoint, walking forward so
 * a later stop cannot snap back onto an earlier part of the path.
 */
export function metresAlongWaypoints(path: LatLngTuple[], waypoints: LatLngTuple[]): number[] | null {
  if (path.length < 2 || waypoints.length < 2) return null
  const walked: number[] = [0]
  for (let i = 1; i < path.length; i++) {
    walked.push(
      walked[i - 1] + haversineM(
        { lat: path[i - 1][0], lng: path[i - 1][1] },
        { lat: path[i][0], lng: path[i][1] },
      ),
    )
  }
  const at: number[] = []
  let from = 0
  for (const point of waypoints) {
    let best = from
    let bestD = Infinity
    const here = { lat: point[0], lng: point[1] }
    for (let i = from; i < path.length; i++) {
      const distance = haversineM(here, { lat: path[i][0], lng: path[i][1] })
      if (distance < bestD) {
        bestD = distance
        best = i
      }
    }
    at.push(walked[best] ?? 0)
    from = best
  }
  if ((at[at.length - 1] ?? 0) <= (at[0] ?? 0)) return null
  return at
}

/** Index runs that touch a continental station, including the UK stop on either side. */
export function eurostarRailChains(stops: readonly PlaceStop[]): number[][] {
  const chains: number[][] = []
  let current: number[] | null = null
  for (let i = 1; i < stops.length; i++) {
    const crosses = isContinentalEurostarStop(stops[i]) || isContinentalEurostarStop(stops[i - 1])
    if (!crosses) {
      current = null
      continue
    }
    if (!current) {
      current = [i - 1, i]
      chains.push(current)
    } else {
      current.push(i)
    }
  }
  return chains
}

type MileStop = {
  tpl?: string | null
  crs?: string | null
  name?: string | null
  cumMiles?: number | null
  cumM?: number | null
}

function publishedMetres(stop: MileStop): number | null {
  const metres = stop.cumM
  if (typeof metres === 'number' && Number.isFinite(metres) && metres >= 0) return metres
  const miles = stop.cumMiles
  if (typeof miles === 'number' && Number.isFinite(miles) && miles >= 0) return miles * METRES_PER_MILE
  return null
}

function withMetres<T extends MileStop>(stop: T, metres: number): T {
  return {
    ...stop,
    cumM: metres,
    cumMiles: Math.round((metres / METRES_PER_MILE) * 100) / 100,
  }
}

/**
 * Keep UK track miles, then add rail-path metres for every leg that touches a
 * continental station. A missing rail length clears the published continental
 * figure so a Folkestone chord is not shown as the distance to Paris.
 * `legMetres` is keyed `${fromIndex}:${toIndex}`.
 */
export function applyEurostarRailMiles<T extends MileStop>(
  stops: readonly T[],
  legMetres: Readonly<Record<string, number>>,
): T[] {
  if (!stops.some((stop) => isContinentalEurostarStop(stop))) return stops.slice()
  const out = stops.map((stop) => ({ ...stop }))
  let cum = publishedMetres(stops[0]) ?? 0
  let rail = isContinentalEurostarStop(stops[0])
  if (rail) {
    cum = 0
    out[0] = withMetres(out[0], 0)
  }
  for (let i = 1; i < stops.length; i++) {
    const crosses = isContinentalEurostarStop(stops[i]) || isContinentalEurostarStop(stops[i - 1])
    if (!crosses && !rail) {
      const published = publishedMetres(stops[i])
      if (published != null) cum = published
      continue
    }
    rail = true
    if (!Number.isFinite(cum)) {
      out[i] = { ...out[i], cumM: null, cumMiles: null }
      continue
    }
    if (!crosses) {
      const earlier = publishedMetres(stops[i - 1])
      const here = publishedMetres(stops[i])
      if (earlier != null && here != null && here >= earlier) {
        cum += here - earlier
        out[i] = withMetres(out[i], cum)
        continue
      }
    }
    const metres = legMetres[`${i - 1}:${i}`]
    if (typeof metres !== 'number' || !Number.isFinite(metres) || metres < 0) {
      out[i] = { ...out[i], cumM: null, cumMiles: null }
      cum = Number.NaN
      continue
    }
    cum += metres
    out[i] = withMetres(out[i], cum)
  }
  return out
}
