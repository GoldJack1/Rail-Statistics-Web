import geo from '../data/tiploc-geo.json'
import { isValidStationCoordinate } from '@/utils/stationCoordinates'

/** TIPLOC → [lat, lng], built from rail-core/tt/ref/tiplocs-merged*.csv. */
const TIPLOC_GEO = geo as Record<string, number[]>

const TIPLOC_KEY = /^[A-Z0-9]{2,12}$/

export function lookupTiplocCoords(tiplocs: readonly string[]): Record<string, [number, number]> {
  const coords: Record<string, [number, number]> = {}
  const seen = new Set<string>()
  for (const raw of tiplocs) {
    const tip = String(raw || '').trim().toUpperCase()
    if (!TIPLOC_KEY.test(tip) || seen.has(tip)) continue
    seen.add(tip)
    if (seen.size > 800) break
    const hit = TIPLOC_GEO[tip]
    const lat = hit?.[0]
    const lng = hit?.[1]
    if (lat === undefined || lng === undefined || !isValidStationCoordinate(lat, lng)) continue
    coords[tip] = [lat, lng]
  }
  return coords
}
