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
