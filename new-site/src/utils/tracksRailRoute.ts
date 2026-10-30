import { routeLimited, routedCoordinates, type LatLngTuple } from './brouterRailRoute'
import { removeRouteReversals } from './serviceJourneyMap'
import { loadGbRailGraph, routeOnGraph } from './tracksRailGraph'

export function splitRouteGaps(path: LatLngTuple[]): LatLngTuple[][] {
  const segments: LatLngTuple[][] = []
  let current: LatLngTuple[] = []
  const flush = () => {
    if (current.length >= 2) segments.push(current)
    current = []
  }
  for (const point of path) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      flush()
      continue
    }
    current.push(point)
  }
  flush()
  return segments
}

function appendPath(joined: LatLngTuple[], part: LatLngTuple[]) {
  if (!part.length) return
  const last = joined[joined.length - 1]
  const broken = Boolean(last && !Number.isFinite(last[0]))
  const start = joined.length > 0 && !broken ? 1 : 0
  for (let i = start; i < part.length; i++) joined.push(part[i])
}

async function fetchRailLeg(
  from: LatLngTuple,
  to: LatLngTuple,
  signal: AbortSignal,
): Promise<LatLngTuple[] | null> {
  const params = new URLSearchParams({
    fromLat: String(from[0]),
    fromLng: String(from[1]),
    toLat: String(to[0]),
    toLng: String(to[1]),
  })
  const response = await fetch(`/api/rail-route?${params.toString()}`, { signal })
  if (!response.ok) return null
  const payload: unknown = await response.json()
  if (routeLimited(payload)) return null
  return routedCoordinates(payload)
}

/**
 * Each leg is searched on the passenger-rail graph. A leg that cannot snap,
 * or that the graph does not connect, falls back to one rail-route request.
 * A miss stays a gap.
 */
export async function routeTracksJourney(
  points: LatLngTuple[],
  signal: AbortSignal,
  onProgress?: (path: LatLngTuple[]) => void,
): Promise<LatLngTuple[]> {
  if (points.length < 2) return points
  const graph = await loadGbRailGraph()
  const joined: LatLngTuple[] = []
  for (let i = 1; i < points.length; i++) {
    if (signal.aborted) return joined
    const from = points[i - 1]
    const to = points[i]
    let leg = graph
      ? routeOnGraph(graph, { lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] })
      : null
    if (!leg) {
      try {
        leg = await fetchRailLeg(from, to, signal)
      } catch (error) {
        if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
        leg = null
      }
    }
    if (!leg || leg.length < 2) {
      if (joined.length) joined.push([Number.NaN, Number.NaN])
      continue
    }
    appendPath(joined, leg)
    onProgress?.(joined.slice())
  }
  const drawn = joined.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  if (drawn.length < 2) return []
  // A timing point just off the through line makes one leg run past it and
  // reverse. That spike is not a second pass. A real loop still keeps every
  // calling point, because the cut is refused when a stop would disappear.
  const segments = splitRouteGaps(joined).map((segment) =>
    removeRouteReversals(segment, 40, 70, 8000, points),
  )
  const cleaned: LatLngTuple[] = []
  for (const segment of segments) {
    if (cleaned.length) cleaned.push([Number.NaN, Number.NaN])
    cleaned.push(...segment)
  }
  return cleaned.length >= 2 ? cleaned : []
}
