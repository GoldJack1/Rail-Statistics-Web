import type { ServiceLocation, ServiceStop } from '../types/darwin'
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

/**
 * How far a point sits to the side of the straight line between two places.
 * A negative distance means it does not fall between them.
 */
function chordOffsetM(from: MapPoint, point: MapPoint, next: MapPoint): number {
  const east = next.lng - from.lng
  const north = next.lat - from.lat
  const length = east * east + north * north
  if (length < 1e-12) return -1
  const along = ((point.lng - from.lng) * east + (point.lat - from.lat) * north) / length
  if (along <= 0.05 || along >= 0.95) return -1
  return haversineM(point, { lat: from.lat + along * north, lng: from.lng + along * east })
}

/**
 * Station-to-station routing takes the shortest railway, which from Leeds is
 * the line through Outwood rather than the booked line through Methley.
 * A junction well off that chord is the dogleg the train actually takes, so
 * it is sent as a via. One sitting on the chord is left as a marker: that
 * pin is often the other branch at the same diamond.
 */
function junctionSteersTheRoute(from: MapPoint, point: MapPoint, next: MapPoint): boolean {
  const offset = chordOffsetM(from, point, next)
  return offset >= 1_500 && offset <= 9_000
}

/**
 * Route between stations. Calling stops and passing stations are vias when
 * they still lie ahead. A junction on the straight chord is not sent: its
 * pin often sits on the other branch. A junction off to the side, such as
 * Methley between Leeds and Wakefield Kirkgate, is sent, because otherwise
 * the router takes a shorter railway. A point listed back behind the train
 * is left out, because sending the router there and back draws a spur. A
 * booked platform moves that via onto the rail beside the platform. One
 * point per place: a bay starts at the buffer, and a call stands on the
 * stopping mark. A second point on the same platform makes the line reverse.
 */
export function mappedRouteWaypoints(
  mapped: JourneyMapStop[],
  platformAt?: Readonly<Record<string, RoutePlatform>>,
): LatLngTuple[] {
  const placed = mapped.filter((stop) => !stop.cancelled)
  const calls = placed.filter((stop) => stop.calling)
  const placeAt = (stop: JourneyMapStop): MapPoint =>
    platformAt?.[String(stop.index)] ?? { lat: stop.lat, lng: stop.lng }

  const chosen: JourneyMapStop[] = []
  if (calls.length < 2) {
    chosen.push(...placed.filter((stop) => stop.kind !== 'junction'))
  } else {
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
        if (!junctionSteersTheRoute(placeAt(from), placeAt(stop), placeAt(next))) continue
        chosen.push(stop)
        continue
      }
      if (!stillAhead(placeAt(from), placeAt(stop), placeAt(next))) continue
      chosen.push(stop)
    }
  }

  const points: LatLngTuple[] = []
  const push = (lat: number, lng: number) => {
    const prev = points[points.length - 1]
    if (prev && Math.abs(prev[0] - lat) < 1e-6 && Math.abs(prev[1] - lng) < 1e-6) return
    points.push([lat, lng])
  }
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
export function journeyPointKind(stop: Pick<ServiceStop, 'slot' | 'name'>): JourneyPointKind {
  if (!isPassSlot(stop.slot)) return 'stop'
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
  if (location?.phase === 'not_started') {
    const first = path[0]
    return { lat: first.lat, lng: first.lng, label: location.label || `At ${first.name}`, atStation: true, from: first, to: first, t: 0 }
  }
  if (location?.phase === 'finished') {
    const last = path[path.length - 1]
    return { lat: last.lat, lng: last.lng, label: location.label || `Arrived ${last.name}`, atStation: true, from: last, to: last, t: 1 }
  }

  const locLast = indexOfTiploc(stops, location?.last?.tiploc)
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
