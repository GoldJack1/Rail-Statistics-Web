import type { LatLngTuple } from './brouterRailRoute'
import { resolveDarwinBrowserUrl } from './darwinReadyFetch'
import type { RoutePlatform } from './serviceJourneyMap'
import { isValidStationCoordinate } from './stationCoordinates'

/**
 * The rail-map line for one service, as the query service draws it. The
 * platform rules, the road through each station and the line itself are all
 * decided there, so the site and the app show the same route.
 */
export type ServiceRoute = {
  path: LatLngTuple[] | null
  /** False for the first answer, before a point on the wrong track is corrected. */
  complete: boolean
  /** The platform a routing rule booked, by stop index. */
  booked: Record<string, string>
  /** Where each booked platform sits, by stop index. */
  platforms: Record<string, RoutePlatform>
  /** The point each call and pass is routed through, by stop index. */
  marks: Record<string, { lat: number; lng: number }>
}

export const NO_SERVICE_ROUTE: ServiceRoute = { path: null, complete: false, booked: {}, platforms: {}, marks: {} }

function readPair(value: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const lat = Number(value[0])
  const lng = Number(value[1])
  return isValidStationCoordinate(lat, lng) ? { lat, lng } : null
}

function readPlatform(value: unknown): RoutePlatform | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { lat?: unknown; lng?: unknown; ends?: unknown; bay?: unknown; stand?: unknown; guess?: unknown }
  const lat = Number(row.lat)
  const lng = Number(row.lng)
  if (!isValidStationCoordinate(lat, lng)) return null
  const place: RoutePlatform = { lat, lng }
  if (Array.isArray(row.ends) && row.ends.length >= 2) {
    const first = readPair(row.ends[0])
    const second = readPair(row.ends[1])
    if (first && second) place.ends = [first, second]
  }
  const bay = readPair(row.bay)
  if (bay) place.bay = bay
  const stand = readPair(row.stand)
  if (stand) place.stand = stand
  if (row.guess === true) place.guess = true
  return place
}

function entries(value: unknown): [string, unknown][] {
  return value && typeof value === 'object' ? Object.entries(value as Record<string, unknown>) : []
}

export function readServiceRoute(payload: unknown): ServiceRoute | null {
  if (!payload || typeof payload !== 'object') return null
  const doc = payload as Record<string, unknown>
  let path: LatLngTuple[] | null = null
  if (Array.isArray(doc.path)) {
    path = []
    for (const pair of doc.path) {
      const point = readPair(pair)
      if (!point) return null
      path.push([point.lat, point.lng])
    }
    if (path.length < 2) path = null
  }
  const booked: Record<string, string> = {}
  for (const [id, platform] of entries(doc.booked)) {
    if (typeof platform === 'string' && platform) booked[id] = platform
  }
  const platforms: Record<string, RoutePlatform> = {}
  for (const [id, value] of entries(doc.platforms)) {
    const place = readPlatform(value)
    if (place) platforms[id] = place
  }
  const marks: Record<string, { lat: number; lng: number }> = {}
  for (const [id, value] of entries(doc.marks)) {
    const point = readPair(value)
    if (point) marks[id] = point
  }
  return { path, complete: doc.complete !== false, booked, platforms, marks }
}

const RETRY_MS = 2000
const RETRIES = 20

/**
 * `request` is the JSON body: the service's operator and its placed timing
 * points. A long line takes the query service a while the first time, and it
 * answers `pending` until the line is ready, so the request is sent again.
 * `onFirst` is given the first line while the corrected one is still coming.
 * Null on a miss.
 */
export async function fetchServiceRoute(
  request: string,
  draft: boolean,
  signal: AbortSignal,
  onFirst?: (route: ServiceRoute) => void,
): Promise<ServiceRoute | null> {
  const body = draft ? `${request.slice(0, -1)},"draft":true}` : request
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    if (signal.aborted) return null
    let payload: unknown
    try {
      const response = await fetch(resolveDarwinBrowserUrl('/api/darwin/service-route'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
        signal,
        cache: 'no-store',
      })
      // The proxy in front of the query service gives up on a slow answer. The line is still being drawn.
      if (response.status === 504 || response.status === 502) payload = { pending: true }
      else if (!response.ok) return null
      else payload = await response.json()
    } catch {
      return null
    }
    if (!(payload as { pending?: unknown } | null)?.pending) return readServiceRoute(payload)
    const first = readServiceRoute(payload)
    if (first?.path) onFirst?.({ ...first, complete: false })
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
  }
  return null
}
