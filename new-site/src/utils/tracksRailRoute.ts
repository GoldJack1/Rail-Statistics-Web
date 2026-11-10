import { routeLimited, routedCoordinates, type LatLngTuple } from './brouterRailRoute'
import { resolveDarwinBrowserUrl } from './darwinReadyFetch'
import { removeRouteReversals } from './serviceJourneyMap'
import { loadGbRailGraph, routeGbLeg } from './tracksGraphLoad'

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

/** A corner sharper than this is rounded. Gentler railway curves stay as drawn. */
const SHARP_TURN = (22 * Math.PI) / 180
/** How far a rounded corner may leave the vertex, in metres. */
const FILLET_M = 110

function metresBetween(a: LatLngTuple, b: LatLngTuple): number {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180)
  const dy = (b[0] - a[0]) * 111_320
  const dx = (b[1] - a[1]) * 111_320 * Math.cos(lat)
  return Math.hypot(dx, dy)
}

/**
 * The graph joins straight pieces, so a change of direction is a sharp elbow.
 * A short curve replaces that elbow. The rest of the line stays on the rails.
 */
export function roundSharpCorners(path: LatLngTuple[]): LatLngTuple[] {
  if (path.length < 3) return path
  const cuts = new Array<number>(path.length).fill(0)
  for (let i = 1; i < path.length - 1; i++) {
    const prev = path[i - 1]
    const here = path[i]
    const next = path[i + 1]
    const d1 = metresBetween(prev, here)
    const d2 = metresBetween(here, next)
    if (d1 < 12 || d2 < 12) continue
    const lat = (here[0] * Math.PI) / 180
    const v1x = (here[1] - prev[1]) * Math.cos(lat)
    const v1y = here[0] - prev[0]
    const v2x = (next[1] - here[1]) * Math.cos(lat)
    const v2y = next[0] - here[0]
    const n1 = Math.hypot(v1x, v1y)
    const n2 = Math.hypot(v2x, v2y)
    if (n1 === 0 || n2 === 0) continue
    const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (n1 * n2)))
    if (Math.acos(cos) < SHARP_TURN) continue
    cuts[i] = Math.min(FILLET_M, d1 * 0.45, d2 * 0.45)
  }
  for (let i = 1; i < path.length - 1; i++) {
    const room = metresBetween(path[i], path[i + 1]) * 0.45
    const share = cuts[i] + cuts[i + 1]
    if (share > room && share > 0) {
      cuts[i] *= room / share
      cuts[i + 1] *= room / share
    }
  }
  const out: LatLngTuple[] = [path[0]]
  for (let i = 1; i < path.length - 1; i++) {
    const cut = cuts[i]
    const here = path[i]
    if (cut < 18) {
      out.push(here)
      continue
    }
    const prev = path[i - 1]
    const next = path[i + 1]
    const d1 = metresBetween(prev, here)
    const d2 = metresBetween(here, next)
    const t1 = cut / d1
    const t2 = cut / d2
    const p1: LatLngTuple = [here[0] + (prev[0] - here[0]) * t1, here[1] + (prev[1] - here[1]) * t1]
    const p2: LatLngTuple = [here[0] + (next[0] - here[0]) * t2, here[1] + (next[1] - here[1]) * t2]
    out.push(p1)
    for (let step = 1; step <= 4; step++) {
      const t = step / 5
      const u = 1 - t
      out.push([
        u * u * p1[0] + 2 * u * t * here[0] + t * t * p2[0],
        u * u * p1[1] + 2 * u * t * here[1] + t * t * p2[1],
      ])
    }
    out.push(p2)
  }
  out.push(path[path.length - 1])
  return out
}

function smoothGaps(path: LatLngTuple[]): LatLngTuple[] {
  const smoothed: LatLngTuple[] = []
  for (const segment of splitRouteGaps(path)) {
    if (smoothed.length) smoothed.push([Number.NaN, Number.NaN])
    smoothed.push(...roundSharpCorners(segment))
  }
  return smoothed
}

/**
 * A gap in the passenger graph makes the shortest path set off away from the
 * next timing point and return by a much longer railway. That is a false
 * reversal. A real way round still gets closer within the first few kilometres.
 */
export function graphLegGoesBackwards(path: LatLngTuple[], from: LatLngTuple, to: LatLngTuple): boolean {
  if (path.length < 2) return false
  const goal = metresBetween(from, to)
  if (goal < 4_000) return false
  let along = 0
  let closest = goal
  const limit = Math.min(3_000, goal)
  for (let i = 1; i < path.length; i++) {
    along += metresBetween(path[i - 1], path[i])
    const remain = metresBetween(path[i], to)
    if (remain < closest) closest = remain
    if (along >= limit) break
  }
  if (closest < goal - 800) return false
  let rail = 0
  for (let i = 1; i < path.length; i++) rail += metresBetween(path[i - 1], path[i])
  return rail > goal * 2.2 && rail - goal > 8_000
}

function appendPath(joined: LatLngTuple[], part: LatLngTuple[]) {
  if (!part.length) return
  const last = joined[joined.length - 1]
  const broken = Boolean(last && !Number.isFinite(last[0]))
  const start = joined.length > 0 && !broken ? 1 : 0
  for (let i = start; i < part.length; i++) joined.push(part[i])
}

/** The query service draws the line. A miss keeps the graph bundled with the site. */
export async function fetchJourneyRoute(
  points: LatLngTuple[],
  signal: AbortSignal,
): Promise<LatLngTuple[] | null> {
  if (points.length < 2) return null
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), 12_000)
  const onAbort = () => timeout.abort()
  signal.addEventListener('abort', onAbort)
  let response: Response
  try {
    response = await fetch(resolveDarwinBrowserUrl('/api/darwin/journey-route'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ points }),
      signal: timeout.signal,
      cache: 'no-store',
    })
  } catch (error) {
    if (signal.aborted) throw error
    return null
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', onAbort)
  }
  if (!response.ok) return null
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object') return null
  const doc = payload as { ready?: unknown; segments?: unknown }
  if (doc.ready === false) return null
  const segments = doc.segments
  if (!Array.isArray(segments)) return null
  const joined: LatLngTuple[] = []
  for (const segment of segments) {
    if (!Array.isArray(segment) || segment.length < 2) continue
    if (joined.length) joined.push([Number.NaN, Number.NaN])
    for (const pair of segment) {
      if (!Array.isArray(pair) || pair.length < 2) continue
      const lat = Number(pair[0])
      const lng = Number(pair[1])
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      joined.push([lat, lng])
    }
  }
  return joined.length >= 2 ? joined : null
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
 * The query service draws the line. When it is unreachable, each leg is
 * searched on the passenger-rail graph shipped with the site. A leg that
 * cannot snap, that the graph does not connect, or that sets off backwards
 * around a gap, falls back to one rail-route request. A miss stays a gap.
 */
export async function routeTracksJourney(
  points: LatLngTuple[],
  signal: AbortSignal,
  onProgress?: (path: LatLngTuple[]) => void,
): Promise<LatLngTuple[]> {
  if (points.length < 2) return points
  try {
    const remote = await fetchJourneyRoute(points, signal)
    if (remote && remote.length >= 2) {
      onProgress?.(remote)
      return remote
    }
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
  }
  void loadGbRailGraph()
  const joined: LatLngTuple[] = []
  for (let i = 1; i < points.length; i++) {
    if (signal.aborted) return joined
    const from = points[i - 1]
    const to = points[i]
    let leg: LatLngTuple[] | null = null
    try {
      leg = await routeGbLeg(from, to, signal)
    } catch (error) {
      if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
      leg = null
    }
    if (signal.aborted) return joined
    if (leg && graphLegGoesBackwards(leg, from, to)) leg = null
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
    onProgress?.(smoothGaps(joined))
  }
  const drawn = joined.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  if (drawn.length < 2) return []
  // A timing point just off the through line makes one leg run past it and
  // reverse. That spike is not a second pass. A real loop still keeps every
  // calling point, because the cut is refused when a stop would disappear.
  const segments = splitRouteGaps(joined).map((segment) =>
    roundSharpCorners(removeRouteReversals(segment, 40, 70, 8000, points)),
  )
  const cleaned: LatLngTuple[] = []
  for (const segment of segments) {
    if (cleaned.length) cleaned.push([Number.NaN, Number.NaN])
    cleaned.push(...segment)
  }
  return cleaned.length >= 2 ? cleaned : []
}
