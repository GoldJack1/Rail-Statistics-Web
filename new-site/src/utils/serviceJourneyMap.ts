import type { ServiceLocation, ServiceStop } from '../types/darwin'
import {
  continentalEurostarCoordinate,
  eurostarEndCoordinate,
} from './eurostarContinental'
import { isValidStationCoordinate } from './stationCoordinates'
import { inferProgressIndex, nextProgressIndex } from './serviceProgress'
import { railwayDaySecondsFromClock } from './railwayOperatingDayUk'

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

/** A timing point has to be further along towards the next call than the line already is. */
function stillAhead(from: MapPoint, point: MapPoint, next: MapPoint): boolean {
  if (haversineM(from, point) < 25) return false
  return haversineM(point, next) < haversineM(from, next) - 15
}

/**
 * Route through the timetable. Stops and station passes are vias when they
 * still lie ahead. Junction markers stay on the map, but they are not vias:
 * a junction coordinate pulls the router off the through line. A point listed
 * back behind the train is left out, because sending the router there and
 * back draws a spur. A booked platform moves that via onto the rail beside
 * the platform. One point per place: a bay starts at the buffer, and a call
 * stands on the stopping mark. A second point on the same platform makes the
 * line reverse.
 */
export function mappedRouteWaypoints(
  mapped: JourneyMapStop[],
  platformAt?: Readonly<Record<string, RoutePlatform>>,
): LatLngTuple[] {
  const active = mapped.filter((stop) => !stop.cancelled && stop.kind !== 'junction')
  const calls = active.filter((stop) => stop.calling)
  const placeAt = (stop: JourneyMapStop): MapPoint =>
    platformAt?.[String(stop.index)] ?? { lat: stop.lat, lng: stop.lng }

  const chosen: JourneyMapStop[] = []
  if (calls.length < 2) {
    chosen.push(...active)
  } else {
    let nextCall = 0
    for (const stop of active) {
      if (stop.calling) {
        chosen.push(stop)
        nextCall += 1
        continue
      }
      const next = calls[nextCall]
      const from = chosen[chosen.length - 1]
      if (!next || !from) continue
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
    push(here.lat, here.lng)
  }
  return points
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
 */
export function removeRouteReversals(
  path: LatLngTuple[],
  closeM = 40,
  minLoopM = 70,
  maxLoopM = 8000,
): LatLngTuple[] {
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
        if (j >= i + 2 && walked >= minLoopM && haversineM(origin, { lat: pts[j][0], lng: pts[j][1] }) <= closeM) {
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
export function snapMarkerToPath(
  point: { lat: number; lng: number },
  path: LatLngTuple[] | null,
  maxM = 250,
): { lat: number; lng: number } {
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
  if (!railPath || railPath.length < 2) return live
  if (live.atStation || live.from == null || live.to == null) {
    const i = nearestPathIndex(railPath, live.lat, live.lng)
    return { ...live, lat: railPath[i][0], lng: railPath[i][1] }
  }
  let i0 = nearestPathIndex(railPath, live.from.lat, live.from.lng)
  let i1 = nearestPathIndex(railPath, live.to.lat, live.to.lng)
  if (i1 < i0) {
    const swap = i0
    i0 = i1
    i1 = swap
  }
  const slice = railPath.slice(i0, i1 + 1)
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

function stopClock(stop: ServiceStop, role: 'from' | 'to'): string {
  if (isPassSlot(stop.slot)) {
    if (role === 'from') return String(stop.atp || stop.etp || stop.wtp || stop.wtd || stop.wta || '')
    return String(stop.etp || stop.atp || stop.wtp || stop.eta || stop.wta || '')
  }
  if (role === 'from') return String(stop.atd || stop.ata || stop.etd || stop.ptd || stop.wtd || stop.wta || '')
  return String(stop.eta || stop.etd || stop.pta || stop.ptd || stop.wta || stop.wtd || '')
}

export function matchStationCoord(
  stop: Pick<ServiceStop, 'crs' | 'tpl'>,
  stations: StationCoordInput[],
): StationCoordInput | null {
  const crs = String(stop.crs || '').trim().toUpperCase()
  if (crs.length === 3) {
    const byCrs = stations.find(
      (s) =>
        String(s.crsCode || '').trim().toUpperCase() === crs &&
        isValidStationCoordinate(s.latitude, s.longitude),
    )
    if (byCrs) return byCrs
  }
  const tpl = String(stop.tpl || '').trim().toUpperCase()
  if (!tpl) return null
  return (
    stations.find(
      (s) =>
        String(s.tiploc || '').trim().toUpperCase() === tpl &&
        isValidStationCoordinate(s.latitude, s.longitude),
    ) || null
  )
}

export type TiplocCoordMap = Readonly<Record<string, { lat: number; lng: number }>>

function coordFromStop(stop: ServiceStop): { lat: number; lng: number } | null {
  const lat = stop.lat
  const lng = stop.lng
  if (typeof lat !== 'number' || typeof lng !== 'number' || !isValidStationCoordinate(lat, lng)) return null
  return { lat, lng }
}

function coordFromLookup(stop: ServiceStop, extra?: TiplocCoordMap): { lat: number; lng: number } | null {
  const tpl = String(stop.tpl || '').trim().toUpperCase()
  const hit = tpl && extra ? extra[tpl] : undefined
  if (!hit || !isValidStationCoordinate(hit.lat, hit.lng)) return null
  return hit
}

/**
 * TIPLOCs with no station-catalogue pin. The schedule's own lat/lng is an
 * OSGB conversion that sits off the rail, so these still need the track fix.
 */
export function tiplocsNeedingCoordinates(
  stops: ServiceStop[],
  stations: StationCoordInput[] = [],
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const stop of stops || []) {
    if (continentalEurostarCoordinate(stop)) continue
    if (matchStationCoord(stop, stations)) continue
    const tpl = String(stop.tpl || '').trim().toUpperCase()
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
    // Paris, Lille, Brussels, Rotterdam and Amsterdam are not on the UK grid.
    // The bundled TIPLOC pin for some of them is the Folkestone NaPTAN
    // placeholder, so the continental table wins for those stations only.
    // Everywhere else, catalogue pins beat the TIPLOC file, and the TIPLOC
    // file beats the schedule's OS grid conversion.
    const coord = continentalEurostarCoordinate(stop)
      || (stn ? { lat: stn.latitude, lng: stn.longitude } : null)
      || coordFromLookup(stop, extra)
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

function fractionAlong(from: ServiceStop, to: ServiceStop, nowSecs: number | null): number {
  const a = railwayDaySecondsFromClock(stopClock(from, 'from'))
  const b = railwayDaySecondsFromClock(stopClock(to, 'to'))
  if (a != null && b != null && b > a && nowSecs != null) {
    return Math.min(1, Math.max(0, (nowSecs - a) / (b - a)))
  }
  return 0.45
}

function indexOfTiploc(stops: ServiceStop[], tiploc: string | null | undefined): number | null {
  const u = String(tiploc || '').trim().toUpperCase()
  if (!u) return null
  const i = stops.findIndex((s) => String(s.tpl || '').toUpperCase() === u)
  return i >= 0 ? i : null
}

export function liveJourneyPosition(
  stops: ServiceStop[],
  mapped: JourneyMapStop[],
  location: ServiceLocation | null | undefined,
  nowSecs: number | null,
): LiveJourneyPosition | null {
  const path = mapped.filter((p) => !p.cancelled)
  if (!path.length) return null
  const nowMins = nowSecs == null ? null : nowSecs / 60
  if (location?.phase === 'not_started') {
    const first = path[0]
    return { lat: first.lat, lng: first.lng, label: location.label || `At ${first.name}`, atStation: true, from: first, to: first, t: 0 }
  }
  if (location?.phase === 'finished') {
    const last = path[path.length - 1]
    return { lat: last.lat, lng: last.lng, label: location.label || `Arrived ${last.name}`, atStation: true, from: last, to: last, t: 1 }
  }

  const locLast = indexOfTiploc(stops, location?.last?.tiploc)
  const reported = locLast ?? inferProgressIndex(stops, nowMins)
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
  const fromStop = stops[here.index]
  const toStop = stops[nextPt.index]
  const t = fractionAlong(fromStop, toStop, nowSecs)
  const pos = interpolateLatLng(here, nextPt, t)
  return {
    lat: pos.lat,
    lng: pos.lng,
    label: location?.label || `Between ${here.name} and ${nextPt.name}`,
    atStation: false,
    from: here,
    to: nextPt,
    t,
  }
}
