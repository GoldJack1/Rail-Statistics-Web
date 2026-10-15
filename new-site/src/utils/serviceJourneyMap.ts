import type { ServiceLocation, ServiceStop } from '../types/darwin'
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

export type JourneyMapStop = {
  index: number
  lat: number
  lng: number
  name: string
  tpl: string
  crs: string | null
  calling: boolean
  cancelled: boolean
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

export function mappedRouteWaypoints(mapped: JourneyMapStop[]): LatLngTuple[] {
  const points: LatLngTuple[] = []
  for (const p of mapped) {
    if (p.cancelled) continue
    const prev = points[points.length - 1]
    if (prev && prev[0] === p.lat && prev[1] === p.lng) continue
    points.push([p.lat, p.lng])
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

export function journeyMapStops(stops: ServiceStop[], stations: StationCoordInput[]): JourneyMapStop[] {
  const out: JourneyMapStop[] = []
  for (let i = 0; i < (stops || []).length; i++) {
    const stop = stops[i]
    const stn = matchStationCoord(stop, stations)
    if (!stn) continue
    out.push({
      index: i,
      lat: stn.latitude,
      lng: stn.longitude,
      name: stop.name || stn.stationName || stop.tpl,
      tpl: stop.tpl,
      crs: stop.crs,
      calling: !isPassSlot(stop.slot),
      cancelled: Boolean(stop.cancelledAtStop),
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
