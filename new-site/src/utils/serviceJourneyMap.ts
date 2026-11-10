import type { ServiceLocation, ServiceStop } from '../types/darwin'
import platformRulesFile from '../data/platform-rules.json'
import { normalizePlatformRef } from './platformPosition'
import {
  continentalEurostarCoordinate,
  eurostarEndCoordinate,
} from './eurostarContinental'
import { isValidStationCoordinate } from './stationCoordinates'
import { railwayDaySecondsFromClock } from './railwayOperatingDayUk'
import { inferProgressIndex, nextProgressIndex } from './serviceProgress'

export type StationCoordInput = {
  crsCode?: string | null
  tiploc?: string | null
  stationName?: string | null
  latitude: number
  longitude: number
}

export type JourneyPointKind = 'stop' | 'pass' | 'junction'

export type JourneyMapStop = {
  index: number
  lat: number
  lng: number
  name: string
  tpl: string
  crs: string | null
  /** A booked call: origin, intermediate stop, or destination. */
  calling: boolean
  kind: JourneyPointKind
  cancelled: boolean
  /** Booked platform. Used to choose the road through the station. */
  platform: string | null
  /** CIF path at this location. The arrival road. */
  path: string | null
  /** CIF line at this location. The departure road. */
  line: string | null
}

export type LiveJourneyPosition = {
  lat: number
  lng: number
  label: string
  atStation: boolean
  from?: JourneyMapStop
  to?: JourneyMapStop
  t?: number
}

export type LatLngTuple = [number, number]

/**
 * A manual routing tweak. The same list is served from the VPS at
 * `/api/platform-rules`, and that copy wins once the query server has it.
 * `replace` limits the change to a blank platform or the numbers listed.
 * `origin` is the train's first call. `before` and `after` are any call on
 * that side of the station. `direction` `west` is a falling longitude.
 */
export type PlatformRule = {
  id?: string
  toc?: string[]
  at: string[]
  origin?: string[]
  before?: string[]
  after?: string[]
  direction?: 'west' | 'east'
  platform: string
  replace?: string[]
}

export const BUILTIN_PLATFORM_RULES = platformRulesFile.rules as PlatformRule[]

function ruleCodes(codes: string[] | undefined): Set<string> | null {
  if (!codes?.length) return null
  return new Set(codes.map((code) => code.toUpperCase()))
}

function stopCode(stop: JourneyMapStop): string {
  return String(stop.crs || stop.tpl || '').toUpperCase()
}

function matchesCode(stop: JourneyMapStop, codes: Set<string>): boolean {
  return codes.has(stopCode(stop)) || codes.has(String(stop.tpl || '').toUpperCase())
}

function placedOnTheMap(stop: JourneyMapStop): boolean {
  return Number.isFinite(stop.lat) && Number.isFinite(stop.lng) && Math.abs(stop.lat) > 1
}

/**
 * Westbound is towards a smaller longitude: at Morley that is Huddersfield
 * and Manchester, rather than Leeds.
 */
function travellingWest(stops: JourneyMapStop[], here: JourneyMapStop): boolean {
  const placed = stops.filter((stop) => !stop.cancelled && placedOnTheMap(stop))
  const previous = [...placed].reverse().find((stop) => stop.index < here.index)
  const next = placed.find((stop) => stop.index > here.index)
  if (previous && next) return next.lng < previous.lng
  if (next && placedOnTheMap(here)) return next.lng < here.lng
  if (previous && placedOnTheMap(here)) return here.lng < previous.lng
  return false
}

function ruleById(id: string): PlatformRule[] {
  return BUILTIN_PLATFORM_RULES.filter((rule) => rule.id === id)
}

/** Books the platform each matching rule names. Later rules win at the same stop. */
export function applyPlatformRules(
  stops: JourneyMapStop[],
  toc: string | null | undefined,
  rules: readonly PlatformRule[],
): JourneyMapStop[] {
  const serviceToc = String(toc || '').trim().toUpperCase()
  let next = stops
  for (const rule of rules) {
    const at = ruleCodes(rule.at)
    const platform = normalizePlatformRef(rule.platform)
    if (!at || !platform) continue
    const allowedToc = ruleCodes(rule.toc)
    if (allowedToc && !allowedToc.has(serviceToc)) continue
    const here = next.find((stop) => !stop.cancelled && matchesCode(stop, at))
    if (!here) continue
    const originCodes = ruleCodes(rule.origin)
    if (originCodes) {
      const origin = next.find((stop) => stop.calling && !stop.cancelled)
      if (!origin || origin.index >= here.index || !matchesCode(origin, originCodes)) continue
    }
    const before = ruleCodes(rule.before)
    if (before && !next.some((stop) => stop.index < here.index && !stop.cancelled && matchesCode(stop, before))) continue
    const after = ruleCodes(rule.after)
    if (after && !next.some((stop) => stop.index > here.index && !stop.cancelled && matchesCode(stop, after))) continue
    if (rule.direction === 'west' && !travellingWest(next, here)) continue
    if (rule.direction === 'east' && travellingWest(next, here)) continue
    if (rule.replace) {
      const booked = normalizePlatformRef(here.platform)
      const accepted = rule.replace.map((value) => normalizePlatformRef(value))
      if (!accepted.includes(booked)) continue
    }
    next = next.map((stop) => (stop.index === here.index ? { ...stop, platform } : stop))
  }
  return next
}

export function applyMirfieldPlatformOverride(
  stops: JourneyMapStop[],
  toc: string | null | undefined,
): JourneyMapStop[] {
  return applyPlatformRules(stops, toc, ruleById('mirfield-tpe'))
}

export function applyMorleyPlatformOverride(stops: JourneyMapStop[]): JourneyMapStop[] {
  return applyPlatformRules(stops, null, ruleById('morley-west'))
}

export function applyShipleyPlatformOverride(
  stops: JourneyMapStop[],
  toc: string | null | undefined,
): JourneyMapStop[] {
  return applyPlatformRules(stops, toc, ruleById('shipley-to-leeds').concat(ruleById('shipley-to-bradford')))
}

/** Where a booked platform sits, including the two ends of that road and a buffer. */
export type RoutePlatform = {
  lat: number
  lng: number
  ends?: [{ lat: number; lng: number }, { lat: number; lng: number }]
  bay?: { lat: number; lng: number }
  /** Where a calling train stands, when the platform has a stopping mark. */
  stand?: { lat: number; lng: number }
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lng - a.lng) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

type MapPoint = { lat: number; lng: number }

/**
 * A pass is kept when it lies on the way between the places either side.
 * Two kilometres of extra path is a curve. Mill Lane's pin, west of Halifax
 * between Low Moor and Bradford, adds several kilometres and is left out.
 */
export function pointsOnTheLeg<T extends { lat?: number | null; lng?: number | null }>(
  points: T[],
  isPass: (point: T) => boolean,
  slackM = 2000,
): T[] {
  const placed = (point: T | undefined): point is T & MapPoint =>
    Boolean(point && isValidStationCoordinate(Number(point.lat), Number(point.lng)))
  return points.filter((point, index) => {
    if (!isPass(point) || !placed(point)) return true
    let prevIndex = index - 1
    while (prevIndex >= 0 && !placed(points[prevIndex])) prevIndex -= 1
    let nextIndex = index + 1
    while (nextIndex < points.length && !placed(points[nextIndex])) nextIndex += 1
    const prev = points[prevIndex]
    const next = points[nextIndex]
    if (!placed(prev) || !placed(next)) return true
    const extra = haversineM(prev, point) + haversineM(point, next) - haversineM(prev, next)
    return extra <= slackM
  })
}

/** A timing point has to be further along towards the next call than the line already is. */
function stillAhead(from: MapPoint, point: MapPoint, next: MapPoint): boolean {
  if (haversineM(from, point) < 25) return false
  return haversineM(point, next) < haversineM(from, next) - 15
}

/** Where a point sits along, and beside, the straight line between two places. */
function chordProgress(
  from: MapPoint,
  point: MapPoint,
  next: MapPoint,
): { along: number; offset: number } | null {
  const east = next.lng - from.lng
  const north = next.lat - from.lat
  const length = east * east + north * north
  if (length < 1e-12) return null
  const along = ((point.lng - from.lng) * east + (point.lat - from.lat) * north) / length
  const offset = haversineM(point, { lat: from.lat + along * north, lng: from.lng + along * east })
  return { along, offset }
}

/**
 * Station-to-station routing takes the shortest railway, which from Leeds is
 * the line through Outwood rather than the booked line through Methley.
 * A junction on the way to the next call is sent, including one near the
 * chord: that is the booked divergence. A pin behind the train, past the
 * call, or many kilometres off the line stays a marker. So does one listed
 * before a pass it has already gone beyond, because that pin is the other
 * branch and sending it would skip the pass.
 */
function junctionSteersTheRoute(
  from: MapPoint,
  point: MapPoint,
  next: MapPoint,
  later?: MapPoint | null,
): boolean {
  const here = chordProgress(from, point, next)
  if (!here || here.along <= 0 || here.along >= 1 || here.offset > 9_000) return false
  if (!stillAhead(from, point, next)) return false
  if (!later) return true
  const after = chordProgress(from, later, next)
  if (after && after.along < here.along - 0.01) return false
  return true
}

/**
 * Calling stops, passing stations that still lie ahead, and a junction only
 * when it steers the booked line. A junction behind the train, past the call,
 * or listed ahead of a pass already passed is left out.
 */
function chosenRouteStops(
  mapped: JourneyMapStop[],
  platformAt?: Readonly<Record<string, RoutePlatform>>,
): JourneyMapStop[] {
  const placed = mapped.filter((stop) => !stop.cancelled)
  const calls = placed.filter((stop) => stop.calling)
  const placeAt = (stop: JourneyMapStop): MapPoint =>
    platformAt?.[String(stop.index)] ?? { lat: stop.lat, lng: stop.lng }

  const chosen: JourneyMapStop[] = []
  if (calls.length < 2) {
    chosen.push(...placed.filter((stop) => stop.kind !== 'junction'))
    return chosen
  }
  let nextCall = 0
  for (const stop of placed) {
    if (stop.calling) {
      chosen.push(stop)
      nextCall += 1
      continue
    }
    const next = calls[nextCall]
    const from = chosen[chosen.length - 1]
    if (!next || !from) continue
    if (stop.kind === 'junction') {
      let later: JourneyMapStop | null = null
      for (let j = placed.indexOf(stop) + 1; j < placed.length; j++) {
        if (placed[j].kind !== 'junction') {
          later = placed[j]
          break
        }
      }
      if (!junctionSteersTheRoute(placeAt(from), placeAt(stop), placeAt(next), later && placeAt(later))) continue
      chosen.push(stop)
      continue
    }
    if (!stillAhead(placeAt(from), placeAt(stop), placeAt(next))) continue
    chosen.push(stop)
  }
  return chosen
}

function pushDistinct(points: LatLngTuple[], lat: number, lng: number) {
  const prev = points[points.length - 1]
  if (prev && Math.abs(prev[0] - lat) < 1e-6 && Math.abs(prev[1] - lng) < 1e-6) return
  points.push([lat, lng])
}

/**
 * Route between stations. Calling stops and passing stations are vias when
 * they still lie ahead. Junction markers are not vias: sending one pulls the
 * line off the through road onto the junction pin. A booked platform moves
 * that via onto the rail beside the platform. One point per place: a bay
 * starts at the buffer, and a call stands on the stopping mark. A second
 * point on the same platform makes the line reverse.
 */
export function mappedRouteWaypoints(
  mapped: JourneyMapStop[],
  platformAt?: Readonly<Record<string, RoutePlatform>>,
): LatLngTuple[] {
  const chosen = chosenRouteStops(mapped, platformAt).filter((stop) => stop.kind !== 'junction')
  const placeAt = (stop: JourneyMapStop): MapPoint =>
    platformAt?.[String(stop.index)] ?? { lat: stop.lat, lng: stop.lng }

  const points: LatLngTuple[] = []
  const push = (lat: number, lng: number) => pushDistinct(points, lat, lng)
  for (let i = 0; i < chosen.length; i++) {
    const stop = chosen[i]
    const place = platformAt?.[String(stop.index)]
    const here = placeAt(stop)
    if (i === 0 && place?.bay) {
      push(place.bay.lat, place.bay.lng)
      continue
    }
    if (stop.calling && place?.stand) {
      push(place.stand.lat, place.stand.lng)
      continue
    }
    if (i === chosen.length - 1 && place?.bay) {
      push(place.bay.lat, place.bay.lng)
      continue
    }
    if (place?.ends) {
      const prev = i > 0 ? placeAt(chosen[i - 1]) : null
      const next = i + 1 < chosen.length ? placeAt(chosen[i + 1]) : null
      const [a, b] = place.ends
      let first = a
      if (prev) first = haversineM(prev, a) <= haversineM(prev, b) ? a : b
      else if (next) first = haversineM(a, next) >= haversineM(b, next) ? a : b
      const second = first === a ? b : a
      push(first.lat, first.lng)
      push(second.lat, second.lng)
      continue
    }
    push(here.lat, here.lng)
  }
  return points
}

function metresEastNorth(origin: MapPoint, point: MapPoint): { x: number; y: number } {
  const lat = (origin.lat * Math.PI) / 180
  return {
    x: (point.lng - origin.lng) * 111320 * Math.cos(lat),
    y: (point.lat - origin.lat) * 110540,
  }
}

/** Metres to the left of the direction from `from` to `to`, measured at `origin`. */
function leftOfDirection(from: MapPoint, to: MapPoint, origin: MapPoint, point: MapPoint): number {
  const axis = metresEastNorth(from, to)
  const offset = metresEastNorth(origin, point)
  const length = Math.hypot(axis.x, axis.y)
  if (length < 1) return 0
  return (axis.x * offset.y - axis.y * offset.x) / length
}

function roadFace(place: RoutePlatform): MapPoint {
  if (place.ends) {
    return {
      lat: (place.ends[0].lat + place.ends[1].lat) / 2,
      lng: (place.ends[0].lng + place.ends[1].lng) / 2,
    }
  }
  return { lat: place.lat, lng: place.lng }
}

const COMPASS_STEP: Record<'E' | 'W' | 'N' | 'S', MapPoint> = {
  E: { lat: 0, lng: 0.002 },
  W: { lat: 0, lng: -0.002 },
  N: { lat: 0.002, lng: 0 },
  S: { lat: -0.002, lng: 0 },
}

function compassCode(value: string | null | undefined): 'E' | 'W' | 'N' | 'S' | null {
  const code = String(value || '').trim().toUpperCase()
  if (code === 'E' || code === 'EB' || code === 'EAST') return 'E'
  if (code === 'W' || code === 'WB' || code === 'WEST') return 'W'
  if (code === 'N' || code === 'NB' || code === 'NORTH') return 'N'
  if (code === 'S' || code === 'SB' || code === 'SOUTH') return 'S'
  return null
}

function namedRoad(value: string | null | undefined, roads: Readonly<Record<string, RoutePlatform>>): string | null {
  const ref = normalizePlatformRef(value)
  return ref && roads[ref] ? ref : null
}

/** Fast lines often have no platform, as at Huntingdon. */
const FAST_LINE = /^(FL|UF|DF|F)$/
/** Platforms further off the line between the stops either side are another route, as Retford low level is. */
const ON_LINE_M = 40

/**
 * A pass with no booked platform. The path, then the line, names the road when
 * either is a platform number. A compass code names the direction of that road.
 * A fast line with no platform named passes no platform. Otherwise the train
 * takes the left-hand face of the through pair on its own line, which is how a
 * westbound train at Mirfield runs via platform 2 rather than platform 1.
 */
function passingRoad(
  stop: JourneyMapStop,
  prev: JourneyMapStop | null,
  next: JourneyMapStop | null,
  roads: Readonly<Record<string, RoutePlatform>> | undefined,
): RoutePlatform | null {
  if (!roads) return null
  const faces = Object.entries(roads)
  if (!faces.length) return null
  const named = namedRoad(stop.path, roads) || namedRoad(stop.line, roads) || namedRoad(prev?.line ?? null, roads)
  if (named) return roads[named]
  if (FAST_LINE.test(String(stop.path || stop.line || '').trim().toUpperCase())) return null

  const compass = compassCode(stop.path) || compassCode(stop.line) || compassCode(prev?.line ?? null)
  const origin = { lat: stop.lat, lng: stop.lng }
  let from: MapPoint | null = prev ? { lat: prev.lat, lng: prev.lng } : null
  let to: MapPoint | null = next ? { lat: next.lat, lng: next.lng } : null
  if (compass) {
    const step = COMPASS_STEP[compass]
    from = origin
    to = { lat: origin.lat + step.lat, lng: origin.lng + step.lng }
  } else if (!from && to) {
    from = origin
  } else if (from && !to) {
    to = origin
  }
  if (!from || !to) return faces[0][1]

  const offLine = faces.map(([, place]) => Math.abs(leftOfDirection(from, to, from, roadFace(place))))
  const closest = Math.min(...offLine)
  const onLine = faces.filter((_, i) => compass || offLine[i] - closest <= ON_LINE_M)

  const scored = onLine.map(([, place]) => {
    const left = leftOfDirection(from, to, origin, roadFace(place))
    return { place, left }
  }).sort((a, b) => a.left - b.left)
  let pairStart = 0
  let pairGap = Infinity
  for (let i = 1; i < scored.length; i++) {
    const gap = scored[i].left - scored[i - 1].left
    if (gap <= 12 && gap < pairGap) {
      pairGap = gap
      pairStart = i - 1
    }
  }
  const side = pairGap <= 12 ? scored.slice(pairStart, pairStart + 2) : scored
  const chosen = side.reduce((best, row) => (row.left > best.left ? row : best), side[0])
  return chosen.place
}

/**
 * One rail-map point per call and pass, as Trainlog places a timetable's stops.
 * Exact: the stopping mark of the booked platform, on its track. Approximate:
 * the platform, or the station. `loose` is where an exact point goes when the
 * route shows it is on the wrong track.
 */
export type RailVia = {
  lat: number
  lng: number
  exact: boolean
  loose: MapPoint
  /** The train calls here, so the route may reverse rather than pass through. */
  call: boolean
}

type RoadsAt = Readonly<Record<string, Readonly<Record<string, RoutePlatform>>>>

/**
 * Each call and pass with the point it is routed through, in order.
 * Junctions are only a reference and are left out. A platform's stopping mark
 * is exact, whether the train calls or passes; the platform alone is
 * approximate. A pass with no booked platform takes the road its path or line
 * names, else the left-hand through road. A pass with no road found is left
 * out of the rail-map points.
 */
function railStops(
  mapped: JourneyMapStop[],
  platformAt?: Readonly<Record<string, RoutePlatform>>,
  roadsAt?: RoadsAt,
): { stop: JourneyMapStop; via: RailVia }[] {
  const chosen = chosenRouteStops(mapped, platformAt).filter((stop) => stop.kind !== 'junction')
  return chosen.map((stop, index) => {
    const pin = { lat: stop.lat, lng: stop.lng }
    const place = platformAt?.[String(stop.index)]
      ?? (stop.kind === 'pass'
        ? passingRoad(stop, chosen[index - 1] ?? null, chosen[index + 1] ?? null, roadsAt?.[String(stop.index)])
        : null)
    const call = stop.calling
    if (place?.stand) return { stop, via: { ...place.stand, exact: true, loose: pin, call } }
    if (place) return { stop, via: { lat: place.lat, lng: place.lng, exact: false, loose: pin, call } }
    return { stop, via: { ...pin, exact: false, loose: pin, call } }
  })
}

export function platformRouteWaypoints(
  mapped: JourneyMapStop[],
  platformAt?: Readonly<Record<string, RoutePlatform>>,
  roadsAt?: RoadsAt,
): RailVia[] {
  const vias: RailVia[] = []
  for (const { stop, via } of railStops(mapped, platformAt, roadsAt)) {
    // A bare pin snaps to whichever track is nearest, often the right-hand one.
    if (stop.kind === 'pass' && via.lat === stop.lat && via.lng === stop.lng) continue
    const prev = vias[vias.length - 1]
    if (prev && Math.abs(prev.lat - via.lat) < 1e-6 && Math.abs(prev.lng - via.lng) < 1e-6) continue
    vias.push(via)
  }
  return vias
}

/**
 * Where each call and pass marker sits: on the platform it is routed through,
 * by stop index. Stops with no platform found are absent.
 */
export function railStopMarks(
  mapped: JourneyMapStop[],
  platformAt?: Readonly<Record<string, RoutePlatform>>,
  roadsAt?: RoadsAt,
): Record<string, MapPoint> {
  const marks: Record<string, MapPoint> = {}
  for (const { stop, via } of railStops(mapped, platformAt, roadsAt)) {
    if (via.lat === stop.lat && via.lng === stop.lng) continue
    marks[String(stop.index)] = { lat: via.lat, lng: via.lng }
  }
  return marks
}

/** A platform via has moved far enough that the track should be routed again. */
export function routeWaypointsDiffer(a: LatLngTuple[], b: LatLngTuple[], metres = 8): boolean {
  if (a.length !== b.length) return true
  for (let i = 0; i < a.length; i++) {
    const moved = haversineM(
      { lat: a[i][0], lng: a[i][1] },
      { lat: b[i][0], lng: b[i][1] },
    )
    if (moved > metres) return true
  }
  return false
}

export function nearestPathIndex(path: LatLngTuple[], lat: number, lng: number): number {
  let best = 0
  let bestD = Infinity
  const here = { lat, lng }
  for (let i = 0; i < path.length; i++) {
    const d = haversineM(here, { lat: path[i][0], lng: path[i][1] })
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  return best
}

export function interpolateAlongPath(path: LatLngTuple[], t: number): { lat: number; lng: number } {
  if (path.length === 0) return { lat: 0, lng: 0 }
  if (path.length === 1) return { lat: path[0][0], lng: path[0][1] }
  const u = Math.min(1, Math.max(0, t))
  const segs: number[] = [0]
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += haversineM(
      { lat: path[i - 1][0], lng: path[i - 1][1] },
      { lat: path[i][0], lng: path[i][1] },
    )
    segs.push(total)
  }
  if (total <= 0) return { lat: path[0][0], lng: path[0][1] }
  const target = total * u
  for (let i = 1; i < segs.length; i++) {
    if (target <= segs[i]) {
      const span = segs[i] - segs[i - 1]
      const f = span > 0 ? (target - segs[i - 1]) / span : 0
      return interpolateLatLng(
        { lat: path[i - 1][0], lng: path[i - 1][1] },
        { lat: path[i][0], lng: path[i][1] },
        f,
      )
    }
  }
  const last = path[path.length - 1]
  return { lat: last[0], lng: last[1] }
}

/**
 * Drop out-and-back spikes. A junction coordinate that sits off the through
 * line makes the router run up to it and reverse; that spur is not the route.
 * A loop that is the only visit to a timing point stays: that is a real
 * reversal, such as a train that arrives and leaves back the way it came.
 */
export function removeRouteReversals(
  path: LatLngTuple[],
  closeM = 40,
  minLoopM = 70,
  maxLoopM = 8000,
  keepNear?: LatLngTuple[],
): LatLngTuple[] {
  const loopStillServesStops = (pts: LatLngTuple[], from: number, to: number): boolean => {
    if (!keepNear?.length) return true
    for (const stop of keepNear) {
      const here = { lat: stop[0], lng: stop[1] }
      let onLoop = false
      for (let k = from + 1; k < to; k++) {
        if (haversineM(here, { lat: pts[k][0], lng: pts[k][1] }) <= closeM) {
          onLoop = true
          break
        }
      }
      if (!onLoop) continue
      let onKept = haversineM(here, { lat: pts[from][0], lng: pts[from][1] }) <= 80
        || haversineM(here, { lat: pts[to][0], lng: pts[to][1] }) <= 80
      for (let k = 0; k < pts.length && !onKept; k++) {
        if (k > from && k < to) continue
        if (haversineM(here, { lat: pts[k][0], lng: pts[k][1] }) <= 80) onKept = true
      }
      if (!onKept) return false
    }
    return true
  }
  let pts = path
  for (let pass = 0; pass < 8; pass++) {
    if (pts.length < 4) break
    const drop = new Array<boolean>(pts.length).fill(false)
    let changed = false
    let i = 0
    while (i < pts.length) {
      let walked = 0
      let cut = -1
      const origin = { lat: pts[i][0], lng: pts[i][1] }
      for (let j = i + 1; j < pts.length; j++) {
        walked += haversineM(
          { lat: pts[j - 1][0], lng: pts[j - 1][1] },
          { lat: pts[j][0], lng: pts[j][1] },
        )
        if (walked > maxLoopM) break
        if (
          j >= i + 2 &&
          walked >= minLoopM &&
          haversineM(origin, { lat: pts[j][0], lng: pts[j][1] }) <= closeM &&
          loopStillServesStops(pts, i, j)
        ) {
          cut = j
        }
      }
      if (cut > i) {
        for (let k = i + 1; k < cut; k++) drop[k] = true
        changed = true
        i = cut
      } else {
        i += 1
      }
    }
    if (!changed) break
    const next = pts.filter((_, index) => !drop[index])
    if (next.length < 2 || next.length === pts.length) break
    pts = next
  }
  return pts
}

/**
 * Replace a leg whose routed length is far longer than the gap between its
 * two timing points. That is a router detour (a via snapped onto the wrong
 * branch), not the train's route. The chord between those points stays in
 * corridor; an out-and-back of several kilometres does not.
 */
export function replaceInflatedLegs(
  path: LatLngTuple[],
  waypoints: LatLngTuple[],
  ratio = 2.8,
  extraM = 900,
): LatLngTuple[] {
  if (path.length < 2 || waypoints.length < 2) return path
  const indexAt: number[] = []
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
    indexAt.push(best)
    from = best
  }
  const out: LatLngTuple[] = []
  const push = (point: LatLngTuple) => {
    const prev = out[out.length - 1]
    if (prev && prev[0] === point[0] && prev[1] === point[1]) return
    out.push(point)
  }
  for (let leg = 0; leg < waypoints.length - 1; leg++) {
    const start = indexAt[leg]
    const end = indexAt[leg + 1]
    const straight = haversineM(
      { lat: waypoints[leg][0], lng: waypoints[leg][1] },
      { lat: waypoints[leg + 1][0], lng: waypoints[leg + 1][1] },
    )
    let along = 0
    for (let i = start + 1; i <= end; i++) {
      along += haversineM(
        { lat: path[i - 1][0], lng: path[i - 1][1] },
        { lat: path[i][0], lng: path[i][1] },
      )
    }
    const inflated = end <= start || (along > straight * ratio && along - straight > extraM)
    if (inflated) {
      push(waypoints[leg])
      push(waypoints[leg + 1])
      continue
    }
    if (out.length === 0) push(path[start])
    for (let i = start + 1; i <= end; i++) push(path[i])
  }
  return out.length >= 2 ? out : path
}

/** Move a marker onto the rail line when it sits just off the through route. */
function onRailPath(path: LatLngTuple[] | null): LatLngTuple[] | null {
  if (!path) return null
  const finite = path.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  return finite.length >= 2 ? finite : null
}

export function snapMarkerToPath(
  point: { lat: number; lng: number },
  path: LatLngTuple[] | null,
  maxM = 250,
): { lat: number; lng: number } {
  path = onRailPath(path)
  if (!path || path.length < 2) return point
  let best = { lat: path[0][0], lng: path[0][1] }
  let bestD = Infinity
  for (let i = 1; i < path.length; i++) {
    const lat1 = path[i - 1][0]
    const lng1 = path[i - 1][1]
    const lat2 = path[i][0]
    const lng2 = path[i][1]
    const dy = lat2 - lat1
    const dx = lng2 - lng1
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((point.lng - lng1) * dx + (point.lat - lat1) * dy) / len2))
    const lat = lat1 + dy * t
    const lng = lng1 + dx * t
    const distance = haversineM(point, { lat, lng })
    if (distance < bestD) {
      bestD = distance
      best = { lat, lng }
    }
  }
  if (bestD > maxM) return point
  return best
}

export function snapLiveToRailPath(
  live: LiveJourneyPosition,
  railPath: LatLngTuple[] | null,
): LiveJourneyPosition {
  const rail = onRailPath(railPath)
  if (!rail || rail.length < 2) return live
  if (live.atStation || live.from == null || live.to == null) {
    const i = nearestPathIndex(rail, live.lat, live.lng)
    return { ...live, lat: rail[i][0], lng: rail[i][1] }
  }
  let i0 = nearestPathIndex(rail, live.from.lat, live.from.lng)
  let i1 = nearestPathIndex(rail, live.to.lat, live.to.lng)
  if (i1 < i0) {
    const swap = i0
    i0 = i1
    i1 = swap
  }
  const slice = rail.slice(i0, i1 + 1)
  const pos = interpolateAlongPath(slice, live.t ?? 0.45)
  return { ...live, lat: pos.lat, lng: pos.lng }
}

function isPassSlot(slot: string | null | undefined): boolean {
  return slot === 'PP' || slot === 'OPPP'
}

const JUNCTION_NAME = /junction|\bjn\b|\bjcn\b/i

/** Calling points are stops. A pass whose name is a junction stays a junction; other non-calls are passes. */
function clockMinutes(value: string | null | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value || '').trim())
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** A working dwell of a few minutes, or a working arrival, is where the train stops. */
function workingDwellStop(stop: { wta?: string | null; wtd?: string | null; wtp?: string | null }): boolean {
  if (String(stop.wtp || '').trim()) return false
  const arr = clockMinutes(stop.wta)
  const dep = clockMinutes(stop.wtd)
  if (arr != null && dep == null) return true
  if (arr == null || dep == null) return false
  let gap = dep - arr
  if (gap < 0) gap += 24 * 60
  return gap >= 2 && gap < 12 * 60
}

export function journeyPointKind(stop: Pick<ServiceStop, 'slot' | 'name' | 'wta' | 'wtd' | 'wtp'>): JourneyPointKind {
  if (!isPassSlot(stop.slot) || workingDwellStop(stop)) return 'stop'
  if (JUNCTION_NAME.test(String(stop.name || ''))) return 'junction'
  return 'pass'
}

/**
 * A pin further than this from the calling point is a different station.
 * TIPLOC and catalogue fixes of a few kilometres stay; another network's
 * station that shares the CRS code does not.
 */
const CATALOGUE_MATCH_M = 20_000

function catalogueNear(
  candidates: StationCoordInput[],
  near: { lat: number; lng: number } | null,
): StationCoordInput | null {
  if (!candidates.length) return null
  if (!near) return candidates[0]
  let best = candidates[0]
  let bestD = Infinity
  for (const station of candidates) {
    const distance = haversineM(near, { lat: station.latitude, lng: station.longitude })
    if (distance < bestD) {
      bestD = distance
      best = station
    }
  }
  return bestD <= CATALOGUE_MATCH_M ? best : null
}

export function matchStationCoord(
  stop: Pick<ServiceStop, 'crs' | 'tpl' | 'lat' | 'lng'>,
  stations: StationCoordInput[],
): StationCoordInput | null {
  const schedule = coordFromStop(stop)
  const crs = String(stop.crs || '').trim().toUpperCase()
  if (crs.length === 3) {
    const byCrs = stations.filter(
      (s) =>
        String(s.crsCode || '').trim().toUpperCase() === crs &&
        isValidStationCoordinate(s.latitude, s.longitude),
    )
    const hit = catalogueNear(byCrs, schedule)
    if (hit) return hit
  }
  const tpl = String(stop.tpl || '').trim().toUpperCase()
  if (!tpl) return null
  const byTpl = stations.filter(
    (s) =>
      String(s.tiploc || '').trim().toUpperCase() === tpl &&
      isValidStationCoordinate(s.latitude, s.longitude),
  )
  return catalogueNear(byTpl, schedule)
}

export type TiplocCoordMap = Readonly<Record<string, { lat: number; lng: number }>>

function coordFromStop(stop: Pick<ServiceStop, 'lat' | 'lng'>): { lat: number; lng: number } | null {
  const lat = stop.lat
  const lng = stop.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isValidStationCoordinate(lat, lng)) return null
  return { lat, lng }
}

function coordFromLookup(stop: ServiceStop, extra?: TiplocCoordMap): { lat: number; lng: number } | null {
  const tpl = String(stop.tpl || '').trim().toUpperCase()
  const hit = tpl && extra ? extra[tpl] : undefined
  if (!hit || !isValidStationCoordinate(hit.lat, hit.lng)) return null
  const schedule = coordFromStop(stop)
  if (schedule && haversineM(schedule, hit) > CATALOGUE_MATCH_M) return null
  return hit
}

function stopTiploc(stop: { tpl?: string | null }): string {
  return String(stop.tpl || '').trim().toUpperCase()
}

function catalogueTiploc(station: StationCoordInput | null): string {
  return String(station?.tiploc || '').trim().toUpperCase()
}

/**
 * The catalogue row is this calling point. A different TIPLOC on the same CRS
 * code is the other network at that station, such as the DC lines at Bushey.
 */
function catalogueIsThisStop(station: StationCoordInput | null, stop: { tpl?: string | null }): boolean {
  const catalogue = catalogueTiploc(station)
  const tip = stopTiploc(stop)
  return Boolean(catalogue && tip && catalogue === tip)
}

function catalogueIsOtherStop(station: StationCoordInput | null, stop: { tpl?: string | null }): boolean {
  const catalogue = catalogueTiploc(station)
  const tip = stopTiploc(stop)
  return Boolean(catalogue && tip && catalogue !== tip)
}

/**
 * TIPLOCs whose catalogue pin is missing or belongs to a different location
 * on the same CRS code. The schedule's own lat/lng is an OSGB conversion that
 * sits off the rail, so these still need the track fix.
 */
export function tiplocsNeedingCoordinates(
  stops: ServiceStop[],
  stations: StationCoordInput[] = [],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const stop of stops || []) {
    if (continentalEurostarCoordinate(stop)) continue
    const station = matchStationCoord(stop, stations)
    if (station && catalogueIsThisStop(station, stop)) continue
    if (station && !catalogueIsOtherStop(station, stop)) continue
    const tpl = stopTiploc(stop)
    if (!tpl || seen.has(tpl)) continue
    seen.add(tpl)
    out.push(tpl)
  }
  return out
}

export function journeyMapStops(
  stops: ServiceStop[],
  stations: StationCoordInput[],
  extra?: TiplocCoordMap,
): JourneyMapStop[] {
  const out: JourneyMapStop[] = []
  for (let i = 0; i < (stops || []).length; i++) {
    const stop = stops[i]
    const stn = matchStationCoord(stop, stations)
    const lookup = coordFromLookup(stop, extra)
    const catalogue = stn ? { lat: stn.latitude, lng: stn.longitude } : null
    // A catalogue pin for this TIPLOC wins. A pin for another TIPLOC on the
    // same CRS code is a different set of lines, so the calling TIPLOC is used.
    let placed = catalogue
    if (lookup && catalogue && catalogueIsOtherStop(stn, stop)) placed = lookup
    else if (!catalogue) placed = lookup
    const coord = continentalEurostarCoordinate(stop)
      || placed
      || coordFromStop(stop)
      || eurostarEndCoordinate(stop)
    if (!coord) continue
    const kind = journeyPointKind(stop)
    const platform = String(stop.platform || '').trim()
    out.push({
      index: i,
      lat: coord.lat,
      lng: coord.lng,
      name: stop.name || stn?.stationName || stop.tpl,
      tpl: stop.tpl,
      crs: stop.crs,
      calling: kind === 'stop',
      kind,
      cancelled: Boolean(stop.cancelledAtStop),
      platform: platform || null,
      path: String(stop.path || '').trim() || null,
      line: String(stop.line || '').trim() || null,
    })
  }
  return out
}

export function interpolateLatLng(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
  t: number,
): { lat: number; lng: number } {
  const u = Math.min(1, Math.max(0, t))
  return {
    lat: a.lat + (b.lat - a.lat) * u,
    lng: a.lng + (b.lng - a.lng) * u,
  }
}

function mappedAtOrBefore(mapped: JourneyMapStop[], stopIndex: number): JourneyMapStop | null {
  let found: JourneyMapStop | null = null
  for (const p of mapped) {
    if (p.cancelled) continue
    if (p.index <= stopIndex) found = p
    else break
  }
  return found
}

function mappedAtOrAfter(mapped: JourneyMapStop[], stopIndex: number): JourneyMapStop | null {
  return mapped.find((p) => !p.cancelled && p.index >= stopIndex) || null
}

function indexOfTiploc(stops: ServiceStop[], tiploc: string | null | undefined): number | null {
  const u = String(tiploc || '').trim().toUpperCase()
  if (!u) return null
  const i = stops.findIndex((s) => String(s.tpl || '').toUpperCase() === u)
  return i >= 0 ? i : null
}

function lastIndexOfTiploc(stops: ServiceStop[], tiploc: string | null | undefined): number | null {
  const u = String(tiploc || '').trim().toUpperCase()
  if (!u) return null
  let found = -1
  for (let i = 0; i < stops.length; i++) {
    if (String(stops[i].tpl || '').toUpperCase() === u) found = i
  }
  return found >= 0 ? found : null
}

/** Where a finished train stands. A timing point filed after the arrival is not the train. */
function finishedMapStop(
  stops: ServiceStop[],
  path: JourneyMapStop[],
  location: ServiceLocation,
): JourneyMapStop {
  const arrived = lastIndexOfTiploc(stops, location.last?.tiploc)
  if (arrived != null) {
    const exact = path.find((point) => point.index === arrived) || mappedAtOrBefore(path, arrived)
    if (exact) return exact
  }
  const reported = inferProgressIndex(stops, null)
  if (reported != null) {
    const atReport = path.find((point) => point.index === reported) || mappedAtOrBefore(path, reported)
    if (atReport) return atReport
  }
  return path[path.length - 1]
}

function clockSeconds(raw: string | null | undefined): number | null {
  if (!raw) return null
  return railwayDaySecondsFromClock(raw)
}

function firstClock(values: Array<string | null | undefined>): number | null {
  for (const value of values) {
    const secs = clockSeconds(value)
    if (secs != null) return secs
  }
  return null
}

/** Darwin's live clock, when it is a forecast or an actual rather than the timetable. */
function liveReportClock(stop: ServiceStop | undefined): string | null {
  if (!stop?.liveTime) return null
  const kind = stop.liveKind
  if (kind === 'est' || kind === 'est-arr' || kind === 'actual' || kind === 'actual-arr') return stop.liveTime
  return null
}

/**
 * How far the train is from the last report toward the next point.
 * Actuals and forecasts come before the working and public timetable,
 * so a late train stays on the real-time clock.
 */
function legProgress(from: ServiceStop | undefined, to: ServiceStop | undefined, nowSecs: number | null): number {
  if (nowSecs == null || !from || !to) return 0
  const depart = firstClock([
    from.atd,
    from.atp,
    from.etd,
    from.etp,
    liveReportClock(from),
    from.wtd,
    from.wtp,
    from.ptd,
  ])
  const arrive = firstClock([
    to.eta,
    to.etp,
    to.etd,
    to.ata,
    to.atp,
    liveReportClock(to),
    to.wta,
    to.wtp,
    to.pta,
  ])
  if (depart == null || arrive == null || arrive <= depart) return 0
  return Math.min(1, Math.max(0, (nowSecs - depart) / (arrive - depart)))
}

export function liveJourneyPosition(
  stops: ServiceStop[],
  mapped: JourneyMapStop[],
  location: ServiceLocation | null | undefined,
  nowSecs: number | null,
): LiveJourneyPosition | null {
  const path = mapped.filter((p) => !p.cancelled)
  if (!path.length) return null
  const origin = path[0]
  const originStop = stops[origin.index]
  const originLeft = Boolean(String(originStop?.atd || originStop?.ata || originStop?.atp || '').slice(0, 5))
  const originBooked = railwayDaySecondsFromClock(String(originStop?.ptd || originStop?.wtd || ''))
  const stillToDepart =
    !originLeft &&
    originBooked != null &&
    nowSecs != null &&
    nowSecs < originBooked &&
    !(originBooked >= 12 * 3600 && nowSecs < 12 * 3600)
  if (stillToDepart || location?.phase === 'not_started') {
    const first = path[0]
    return { lat: first.lat, lng: first.lng, label: location?.label || `At ${first.name}`, atStation: true, from: first, to: first, t: 0 }
  }
  let place = location
  if (location?.phase === 'finished') {
    if (originLeft) {
      const arrived = finishedMapStop(stops, path, location)
      return {
        lat: arrived.lat,
        lng: arrived.lng,
        label: location.label || `Arrived ${arrived.name}`,
        atStation: true,
        from: arrived,
        to: arrived,
        t: 1,
      }
    }
    place = null
  }

  const locLast = indexOfTiploc(stops, place?.last?.tiploc)
  const reported = locLast ?? inferProgressIndex(stops, null)
  if (reported == null) {
    const first = path[0]
    return { lat: first.lat, lng: first.lng, label: location?.label || first.name, atStation: true }
  }

  const at = stops[reported]
  const atStation =
    location?.phase === 'at_station' ||
    (!isPassSlot(at?.slot) && Boolean(String(at?.ata || '').slice(0, 5)) && !String(at?.atd || '').slice(0, 5))
  const here = mappedAtOrBefore(path, reported) || path[0]
  if (atStation) {
    const exact = path.find((p) => p.index === reported) || here
    return {
      lat: exact.lat,
      lng: exact.lng,
      label: location?.label || `At ${exact.name}`,
      atStation: true,
      from: exact,
      to: exact,
      t: 0,
    }
  }

  const nextIdx = indexOfTiploc(stops, location?.next?.tiploc) ?? nextProgressIndex(stops, reported)
  const nextPt = nextIdx != null ? mappedAtOrAfter(path, nextIdx) : null
  if (!nextPt || nextPt.index === here.index) {
    return { lat: here.lat, lng: here.lng, label: location?.label || here.name, atStation: false, from: here, to: here, t: 0 }
  }
  const t = legProgress(stops[here.index], stops[nextPt.index], nowSecs)
  const along = interpolateLatLng(here, nextPt, t)
  return {
    lat: along.lat,
    lng: along.lng,
    label: location?.label || `Between ${here.name} and ${nextPt.name}`,
    atStation: false,
    from: here,
    to: nextPt,
    t,
  }
}
