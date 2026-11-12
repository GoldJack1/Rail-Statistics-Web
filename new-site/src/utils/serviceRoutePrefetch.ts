import { isValidStationCoordinate } from './stationCoordinates'
import {
  journeyMapStops,
  pointsOnTheLeg,
  tiplocsNeedingCoordinates,
} from './serviceJourneyMap'
import { warmServiceRoute } from './serviceRoute'
import type { ServiceDetail } from '../types/darwin'

type Coords = Record<string, { lat: number; lng: number }>
type Stations = Parameters<typeof journeyMapStops>[1]

const tiplocCoordCache = new Map<string, { lat: number; lng: number } | null>()

async function requestTiplocs(missing: string[], signal: AbortSignal): Promise<void> {
  const params = new URLSearchParams({ tpl: missing.join('|') })
  const response = await fetch(`/api/tiploc-coords?${params.toString()}`, { signal })
  if (!response.ok) throw new Error('tiploc coords')
  const payload = (await response.json()) as { coords?: Record<string, [number, number]> }
  for (const tpl of missing) {
    const hit = payload.coords?.[tpl]
    tiplocCoordCache.set(
      tpl,
      hit && isValidStationCoordinate(hit[0], hit[1]) ? { lat: hit[0], lng: hit[1] } : null,
    )
  }
}

/** Coordinates for timing points with no station pin. One failed lookup is tried again. */
export async function fetchTiplocCoords(tpls: string[], signal: AbortSignal): Promise<Coords> {
  const missing = tpls.filter((tpl) => !tiplocCoordCache.has(tpl))
  if (missing.length > 0) {
    try {
      await requestTiplocs(missing, signal)
    } catch (error) {
      if (signal.aborted) throw error
      await new Promise((resolve) => setTimeout(resolve, 400))
      await requestTiplocs(missing, signal)
    }
  }
  const out: Coords = {}
  for (const tpl of tpls) {
    const hit = tiplocCoordCache.get(tpl)
    if (hit) out[tpl] = hit
  }
  return out
}

/** The timing points the line is drawn through: calls, and passes with a place. */
export function placedRouteStops(
  stops: ServiceDetail['stops'],
  stations: Stations,
  extraCoords: Coords,
) {
  return pointsOnTheLeg(
    journeyMapStops(stops || [], stations, extraCoords),
    (point) => !point.calling && !String(point.crs || '').trim(),
  )
}

/** The body sent to the query service. It changes only when a timing point moves or its booking does. */
export function routeRequestBody(
  placed: ReturnType<typeof placedRouteStops>,
  toc: string | null | undefined,
): string {
  return JSON.stringify({
    toc: toc || null,
    stops: placed.map((point) => ({
      index: point.index,
      lat: Number(point.lat.toFixed(6)),
      lng: Number(point.lng.toFixed(6)),
      crs: point.crs,
      tpl: point.tpl,
      calling: point.calling,
      kind: point.kind,
      cancelled: point.cancelled,
      platform: point.platform,
      path: point.path,
      line: point.line,
    })),
  })
}

/**
 * Starts the map line for a service while its calling pattern is still on
 * screen. The map asks for the same request, so it joins the line already
 * being drawn instead of starting it.
 */
export async function prefetchServiceRoute(
  service: ServiceDetail,
  stations: Stations,
  signal: AbortSignal,
): Promise<void> {
  const needed = tiplocsNeedingCoordinates(service.stops || [], stations)
  let coords: Coords = {}
  if (needed.length > 0) {
    try {
      coords = await fetchTiplocCoords(needed, signal)
    } catch {
      return
    }
  }
  if (signal.aborted) return
  const placed = placedRouteStops(service.stops, stations, coords)
  if (placed.length < 2) return
  warmServiceRoute(routeRequestBody(placed, service.toc))
}
