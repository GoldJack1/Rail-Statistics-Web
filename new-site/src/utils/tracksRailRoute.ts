import { routeLimited, routedCoordinates, type LatLngTuple } from './brouterRailRoute'
import { resolveDarwinBrowserUrl } from './darwinReadyFetch'
import { removeRouteReversals, type RailVia } from './serviceJourneyMap'
import { followGbRoute, loadGbRailGraph, routeGbLeg } from './tracksGraphLoad'

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

/** A bend this sharp is a junction or a reversal, not a curve the tiles simplified. */
const FILLET_MAX_TURN = (75 * Math.PI) / 180
const ROUTE_FILLET_M = 28

/**
 * Vector tiles and the rail router replace a curve with a few straight pieces,
 * so a bend is a hard corner. A short curve replaces that corner. The line
 * stays on the same track: only a modest bend is rounded, and only by a few metres.
 */
export function filletSharpBend(
  points: Array<[number, number]>,
  maxCut: number,
  minTurn = (8 * Math.PI) / 180,
  maxTurn = FILLET_MAX_TURN,
): Array<[number, number]> {
  if (points.length < 3 || maxCut < 1) return points
  const out: Array<[number, number]> = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const here = points[i]
    const next = points[i + 1]
    const d1 = Math.hypot(here[0] - prev[0], here[1] - prev[1])
    const d2 = Math.hypot(next[0] - here[0], next[1] - here[1])
    if (d1 < 1 || d2 < 1) {
      out.push(here)
      continue
    }
    const v1x = (here[0] - prev[0]) / d1
    const v1y = (here[1] - prev[1]) / d1
    const v2x = (next[0] - here[0]) / d2
    const v2y = (next[1] - here[1]) / d2
    const cos = Math.min(1, Math.max(-1, v1x * v2x + v1y * v2y))
    const turn = Math.acos(cos)
    const cut = Math.min(maxCut, d1 * 0.45, d2 * 0.45)
    if (turn < minTurn || turn > maxTurn || cut < 0.5) {
      out.push(here)
      continue
    }
    const p1: [number, number] = [here[0] - v1x * cut, here[1] - v1y * cut]
    const p2: [number, number] = [here[0] + v2x * cut, here[1] + v2y * cut]
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
  out.push(points[points.length - 1])
  const deduped: Array<[number, number]> = []
  for (const point of out) {
    const last = deduped[deduped.length - 1]
    if (last && Math.round(last[0]) === Math.round(point[0]) && Math.round(last[1]) === Math.round(point[1])) continue
    deduped.push(point)
  }
  return deduped.length >= 2 ? deduped : points
}

/** Rounds the elbows in a rail route without moving it onto the next track. */
export function filletRailRoute(path: LatLngTuple[]): LatLngTuple[] {
  if (path.length < 3) return path
  const origin = path[0]
  const cos = Math.cos((origin[0] * Math.PI) / 180)
  if (cos < 0.2) return path
  const xy = path.map((point): [number, number] => [
    (point[1] - origin[1]) * 111_320 * cos,
    (point[0] - origin[0]) * 111_320,
  ])
  return filletSharpBend(xy, ROUTE_FILLET_M).map(([east, north]): LatLngTuple => [
    origin[0] + north / 111_320,
    origin[1] + east / (111_320 * cos),
  ])
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

function bearing(a: LatLngTuple, b: LatLngTuple): number {
  const rad = Math.PI / 180
  const y = Math.sin((b[1] - a[1]) * rad) * Math.cos(b[0] * rad)
  const x = Math.cos(a[0] * rad) * Math.sin(b[0] * rad)
    - Math.sin(a[0] * rad) * Math.cos(b[0] * rad) * Math.cos((b[1] - a[1]) * rad)
  return Math.atan2(y, x) / rad
}

/** The path every `step` metres, each with its distance along. */
function resample(path: LatLngTuple[], step: number): { at: number; point: LatLngTuple }[] {
  const out = [{ at: 0, point: path[0] }]
  let along = 0
  let next = step
  for (let i = 1; i < path.length; i++) {
    const length = metresBetween(path[i - 1], path[i])
    while (length > 0 && next <= along + length) {
      const t = (next - along) / length
      out.push({
        at: next,
        point: [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * t, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * t],
      })
      next += step
    }
    along += length
  }
  return out
}

/** How far along the path each point is reached, in order. */
function distanceAlong(path: LatLngTuple[], points: LatLngTuple[]): number[] {
  const along = [0]
  for (let i = 1; i < path.length; i++) along.push(along[i - 1] + metresBetween(path[i - 1], path[i]))
  let from = 0
  return points.map((point) => {
    let best = from
    let bestAway = Infinity
    for (let i = from; i < path.length; i++) {
      const away = metresBetween(point, path[i])
      if (away < bestAway) {
        bestAway = away
        best = i
      }
    }
    from = best
    return along[best]
  })
}

const TIP_M = 100
const TURN_BACK_M = 1500
/** The longest out-and-back to a crossover: South Elmsall to Adwick Junction is 6 km each way. */
const DETOUR_M = 15_000

/**
 * Points the route reverses at: the heading flips by more than 150 degrees.
 * A point on the wrong track sits at the tip of the out-and-back, so a flip
 * blames the point it touches. The far end of the detour is a crossover, and
 * only blames a point when no point is at the tip. A correct platform beside
 * that crossover stays exact.
 */
function turnedBackAt(path: LatLngTuple[], points: LatLngTuple[]): Set<number> {
  const samples = resample(path, 20)
  const flips: { at: number; point: LatLngTuple }[] = []
  for (let i = 2; i < samples.length; i++) {
    const before = bearing(samples[i - 2].point, samples[i - 1].point)
    const after = bearing(samples[i - 1].point, samples[i].point)
    const turn = Math.abs(((after - before + 540) % 360) - 180)
    if (turn > 150) flips.push(samples[i - 1])
  }
  const reached = distanceAlong(path, points)
  const nearest = (flip: { at: number; point: LatLngTuple }, within: number): number | null => {
    let best: number | null = null
    let bestGap = Infinity
    points.forEach((point, index) => {
      const gap = Math.abs(reached[index] - flip.at)
      if (gap > within || metresBetween(point, flip.point) > within) return
      if (gap < bestGap) {
        bestGap = gap
        best = index
      }
    })
    return best
  }
  const atTip = flips.map((flip) => nearest(flip, TIP_M))
  const wrong = new Set<number>()
  flips.forEach((flip, i) => {
    const tip = atTip[i]
    if (tip !== null) {
      wrong.add(tip)
      return
    }
    const crossover = flips.some((other, j) => atTip[j] !== null && Math.abs(other.at - flip.at) <= DETOUR_M)
    if (crossover) return
    const near = nearest(flip, TURN_BACK_M)
    if (near !== null) wrong.add(near)
  })
  return wrong
}

const RECHECKS = 3

/**
 * The rail-map line, placed the way Trainlog places a journey. Each platform's
 * stopping mark is an exact point; a station with no platform found is an
 * approximate one. Where the route reverses beside a point, that point alone
 * is wrong: a platform point falls back to its station and a bare station is
 * left out, and the route is asked again. An intermediate call stays: the
 * train is booked to stop, and the reverse there is the onward working, as
 * at Leeds for Bradford, Skipton and Harrogate. The other platforms stay
 * exact, so one bad point never moves the whole line onto the station pins.
 */
export async function fetchPlatformRailRoute(
  vias: RailVia[],
  signal: AbortSignal,
  onProgress?: (path: LatLngTuple[]) => void,
): Promise<LatLngTuple[] | null> {
  if (vias.length < 2) return null
  const loosened = new Set<number>()
  const dropped = new Set<number>()
  const last = vias.length - 1
  const pointsNow = () => {
    const kept: { index: number; point: LatLngTuple }[] = []
    vias.forEach((via, index) => {
      if (dropped.has(index)) return
      const point: LatLngTuple = !loosened.has(index)
        ? [via.lat, via.lng]
        : [via.loose.lat, via.loose.lng]
      kept.push({ index, point })
    })
    return kept
  }
  const draw = async (raw: LatLngTuple[]): Promise<LatLngTuple[]> => {
    const followed = await followGbRoute(raw, signal)
    return filletRailRoute(followed && followed.length >= 2 ? followed : raw)
  }
  let kept = pointsNow()
  let path = await requestRailRoute(kept.map((row) => row.point), signal)
  if (path) onProgress?.(await draw(path))
  for (let round = 0; path && round < RECHECKS; round++) {
    const wrong = turnedBackAt(path, kept.map((row) => row.point))
    let changed = false
    for (const n of wrong) {
      const index = kept[n].index
      const via = vias[index]
      // Origin and destination stay eligible: a reverse there is the route
      // arriving from the wrong direction. An intermediate call is kept.
      if (via.call && index !== 0 && index !== last) continue
      const onPlatform = via.lat !== via.loose.lat || via.lng !== via.loose.lng
      if (onPlatform && !loosened.has(index)) {
        loosened.add(index)
        changed = true
      } else if (index !== 0 && index !== last && !dropped.has(index)) {
        dropped.add(index)
        changed = true
      }
    }
    if (!changed) break
    kept = pointsNow()
    const next = await requestRailRoute(kept.map((row) => row.point), signal)
    if (!next) break
    path = next
    onProgress?.(await draw(path))
  }
  if (path) return draw(path)
  const loose = await requestRailRoute(vias.map((via): LatLngTuple => [via.loose.lat, via.loose.lng]), signal)
  return loose ? draw(loose) : null
}

/** One OpenRailRouting request through every point. A miss is empty. */
async function requestRailRoute(
  points: LatLngTuple[],
  signal: AbortSignal,
): Promise<LatLngTuple[] | null> {
  if (points.length < 2) return null
  const params = new URLSearchParams({
    fromLat: String(points[0][0]),
    fromLng: String(points[0][1]),
    toLat: String(points[points.length - 1][0]),
    toLng: String(points[points.length - 1][1]),
    strict: '1',
  })
  if (points.length > 2) {
    params.set('via', points.slice(1, -1).map(([lat, lng]) => `${lat},${lng}`).join('|'))
  }
  const response = await fetch(`/api/rail-route?${params.toString()}`, { signal })
  if (!response.ok) return null
  const payload: unknown = await response.json()
  if (routeLimited(payload)) return null
  return routedCoordinates(payload)
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
