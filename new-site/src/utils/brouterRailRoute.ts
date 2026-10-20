export type LatLngTuple = [number, number]

type GeoJsonGeometry = {
  type?: string
  coordinates?: unknown
}

type GeoJsonFeature = {
  geometry?: GeoJsonGeometry
}

type GeoJsonFeatureCollection = {
  type?: string
  features?: GeoJsonFeature[]
  geometry?: GeoJsonGeometry
}

function isLngLatPair(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    Number.isFinite(value[0]) &&
    Number.isFinite(value[1])
  )
}

function lngLatToLatLng(pair: [number, number]): LatLngTuple {
  return [pair[1], pair[0]]
}

function flattenLineCoordinates(coordinates: unknown): LatLngTuple[] {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return []
  if (isLngLatPair(coordinates[0])) {
    return coordinates.filter(isLngLatPair).map(lngLatToLatLng)
  }
  const nested = coordinates.flatMap((part) => flattenLineCoordinates(part))
  return nested
}

/** Pull a [lat, lng] line from BRouter GeoJSON (LineString or MultiLineString). */
export function parseBrouterRailGeoJson(payload: unknown): LatLngTuple[] {
  if (!payload || typeof payload !== 'object') return []
  const doc = payload as GeoJsonFeatureCollection
  const geometries: GeoJsonGeometry[] = []
  if (doc.geometry) geometries.push(doc.geometry)
  for (const feature of doc.features ?? []) {
    if (feature.geometry) geometries.push(feature.geometry)
  }
  for (const geometry of geometries) {
    const type = geometry.type ?? ''
    if (type !== 'LineString' && type !== 'MultiLineString') continue
    const path = flattenLineCoordinates(geometry.coordinates)
    if (path.length >= 2) return path
  }
  return []
}

export function straightLineBetween(from: LatLngTuple, to: LatLngTuple): LatLngTuple[] {
  return [from, to]
}

/** The public router asked us to back off. Splitting the request would make that worse. */
export function routeLimited(payload: unknown): boolean {
  return Boolean(payload && typeof payload === 'object' && (payload as { limited?: unknown }).limited === true)
}

/** A rail-router path, or null when the proxy fell back to a straight chord. */
export function routedCoordinates(payload: unknown): LatLngTuple[] | null {
  if (!payload || typeof payload !== 'object') return null
  const doc = payload as { coordinates?: unknown; fallback?: unknown }
  if (doc.fallback === true || !Array.isArray(doc.coordinates) || doc.coordinates.length < 2) return null
  const path: LatLngTuple[] = []
  for (const point of doc.coordinates) {
    if (!Array.isArray(point) || point.length < 2) return null
    const lat = Number(point[0])
    const lng = Number(point[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    path.push([lat, lng])
  }
  return path
}

const OPEN_RAIL_ROUTE = 'https://routing.openrailrouting.org/route'

/** Standard-gauge tracks, including the branches a working timetable actually uses. */
export function buildOpenRailRouteUrl(points: LatLngTuple[]): string {
  const url = new URL(OPEN_RAIL_ROUTE)
  for (const [lat, lng] of points) url.searchParams.append('point', `${lat},${lng}`)
  url.searchParams.set('profile', 'all_tracks_1435')
  url.searchParams.set('points_encoded', 'false')
  url.searchParams.set('instructions', 'false')
  url.searchParams.set('elevation', 'false')
  return url.toString()
}

/** GraphHopper-style rail route: points.coordinates are [lng, lat]. */
export function parseOpenRailRoute(payload: unknown): LatLngTuple[] {
  if (!payload || typeof payload !== 'object') return []
  const paths = (payload as { paths?: unknown }).paths
  if (!Array.isArray(paths) || paths.length === 0) return []
  const first = paths[0]
  if (!first || typeof first !== 'object') return []
  const points = (first as { points?: unknown }).points
  if (!points || typeof points !== 'object') return []
  const coordinates = (points as { coordinates?: unknown }).coordinates
  if (!Array.isArray(coordinates)) return []
  const path: LatLngTuple[] = []
  for (const pair of coordinates) {
    if (!Array.isArray(pair) || pair.length < 2) return []
    const lng = Number(pair[0])
    const lat = Number(pair[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return []
    path.push([lat, lng])
  }
  return path
}

export function buildBrouterRailUrl(points: LatLngTuple[]): string {
  const url = new URL('https://brouter.de/brouter')
  url.searchParams.set(
    'lonlats',
    points.map(([lat, lng]) => `${lng},${lat}`).join('|')
  )
  url.searchParams.set('profile', 'rail')
  url.searchParams.set('alternativeidx', '0')
  url.searchParams.set('format', 'geojson')
  return url.toString()
}
