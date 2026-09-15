import type { Station } from '@/types'
import type { DPAYGStation } from '@/types/dpayg'
import { isValidStationCoordinate } from '@/utils/stationCoordinates'

export type PaygAreaMapPoint = {
  key: string
  name: string
  crs: string
  latitude: number
  longitude: number
}

const NATIONAL_RAIL_CRS = /^[A-Z]{3}$/

export function paygStationLookupCrs(station: DPAYGStation): string | null {
  const display = station.displayCrs?.trim().toUpperCase()
  if (display && NATIONAL_RAIL_CRS.test(display)) return display
  const crs = station.crs.trim().toUpperCase()
  if (NATIONAL_RAIL_CRS.test(crs)) return crs
  return null
}

function preferDatabaseStation(current: Station | undefined, next: Station): Station {
  if (!current) return next
  if (next.sourceCollectionId === 'stations_gbnr' && current.sourceCollectionId !== 'stations_gbnr') {
    return next
  }
  return current
}

export function matchPaygStationsToDatabaseStations(
  paygStations: DPAYGStation[],
  dbStations: Station[]
): Station[] {
  const byCrs = new Map<string, Station>()
  for (const station of dbStations) {
    const code = station.crsCode?.trim().toUpperCase()
    if (!code || !NATIONAL_RAIL_CRS.test(code)) continue
    byCrs.set(code, preferDatabaseStation(byCrs.get(code), station))
  }

  const matched: Station[] = []
  const seen = new Set<string>()
  for (const payg of paygStations) {
    const code = paygStationLookupCrs(payg)
    if (!code) continue
    const db = byCrs.get(code)
    if (!db || !isValidStationCoordinate(db.latitude, db.longitude)) continue
    const key = `${code}:${db.latitude.toFixed(5)}:${db.longitude.toFixed(5)}`
    if (seen.has(key)) continue
    seen.add(key)
    matched.push({
      ...db,
      sourceCollectionId: db.sourceCollectionId ?? 'stations_gbnr',
    })
  }
  return matched
}

export function matchPaygStationsToMapPoints(
  paygStations: DPAYGStation[],
  dbStations: Station[]
): PaygAreaMapPoint[] {
  return matchPaygStationsToDatabaseStations(paygStations, dbStations).map((station) => ({
    key: `${station.crsCode.trim().toUpperCase()}:${station.latitude.toFixed(5)}:${station.longitude.toFixed(5)}`,
    name: station.stationName,
    crs: station.crsCode.trim().toUpperCase(),
    latitude: station.latitude,
    longitude: station.longitude,
  }))
}
