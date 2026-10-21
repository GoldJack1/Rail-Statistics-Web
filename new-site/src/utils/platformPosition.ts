import { isValidStationCoordinate } from './stationCoordinates'

/** A platform further than this from the station pin belongs to somewhere else. */
export const PLATFORM_MATCH_M = 450

/** How far a returned platform may sit from the calling point before it is dropped. */
export const PLATFORM_APPLY_M = 800

export type PlatformRequest = {
  id: string
  lat: number
  lng: number
  platform: string
}

export type OsmPlatform = {
  lat: number
  lng: number
  refs: string[]
  geometry?: { lat: number; lng: number }[]
}

export type OsmRail = {
  geometry: { lat: number; lng: number }[]
}

export type PlatformTrack = {
  lat: number
  lng: number
  /** The two ends of this platform along the rail beside it. */
  ends: [{ lat: number; lng: number }, { lat: number; lng: number }]
  /** Buffer end, when a buffer stop sits at one end of this platform. */
  bay?: { lat: number; lng: number }
  /** Where a train stands on this platform. */
  stand?: { lat: number; lng: number }
}

export type OsmStand = {
  lat: number
  lng: number
  refs: string[]
}

/** "Platform 02A" and "2a" both become "2A". "15B" stays distinct from "15". */
export function normalizePlatformRef(value: string | null | undefined): string {
  const raw = String(value || '')
    .trim()
    .toUpperCase()
    .replace(/^PLATFORM\s+/, '')
    .replace(/\s+/g, '')
  if (!raw) return ''
  return raw.replace(/^0+(?=\d)/, '')
}

export function platformRefParts(value: string | null | undefined): string[] {
  const parts = String(value || '')
    .split(/[;,/|]+/)
    .map((part) => normalizePlatformRef(part))
    .filter(Boolean)
  return [...new Set(parts)]
}

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function parsePlatformQuery(raw: string): PlatformRequest[] {
  const out: PlatformRequest[] = []
  const seen = new Set<string>()
  for (const part of String(raw || '').split('|')) {
    if (!part) continue
    const [idRaw, latRaw, lngRaw, platformRaw] = part.split('~')
    const id = String(idRaw || '').trim()
    const lat = Number(latRaw)
    const lng = Number(lngRaw)
    let platform = ''
    try {
      platform = decodeURIComponent(String(platformRaw || ''))
    } catch {
      platform = String(platformRaw || '')
    }
    platform = platform.trim()
    if (!id || seen.has(id) || !platform || !isValidStationCoordinate(lat, lng)) continue
    seen.add(id)
    if (out.length >= 40) break
    out.push({ id, lat, lng, platform })
  }
  return out
}

export function osmPlatformsFromOverpass(payload: unknown): OsmPlatform[] {
  if (!payload || typeof payload !== 'object') return []
  const elements = (payload as { elements?: unknown }).elements
  if (!Array.isArray(elements)) return []
  const out: OsmPlatform[] = []
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    const row = element as {
      lat?: unknown
      lon?: unknown
      center?: { lat?: unknown; lon?: unknown }
      tags?: { railway?: unknown; ref?: unknown; local_ref?: unknown }
    }
    if (row.tags?.railway !== 'platform') continue
    const geometry = readWayGeometry(element)
    const center = geometry.length ? centroid(geometry) : null
    const lat = center?.lat ?? Number(row.center?.lat ?? row.lat)
    const lng = center?.lng ?? Number(row.center?.lon ?? row.lon)
    if (!isValidStationCoordinate(lat, lng)) continue
    const refs = [
      ...platformRefParts(typeof row.tags?.ref === 'string' ? row.tags.ref : ''),
      ...platformRefParts(typeof row.tags?.local_ref === 'string' ? row.tags.local_ref : ''),
    ]
    const unique = [...new Set(refs)]
    if (!unique.length) continue
    out.push({ lat, lng, refs: unique, geometry: geometry.length ? geometry : undefined })
  }
  return out
}

export function osmStandsFromOverpass(payload: unknown): OsmStand[] {
  if (!payload || typeof payload !== 'object') return []
  const elements = (payload as { elements?: unknown }).elements
  if (!Array.isArray(elements)) return []
  const out: OsmStand[] = []
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    const row = element as {
      lat?: unknown
      lon?: unknown
      tags?: { public_transport?: unknown; ref?: unknown }
    }
    if (row.tags?.public_transport !== 'stop_position') continue
    const lat = Number(row.lat)
    const lng = Number(row.lon)
    if (!isValidStationCoordinate(lat, lng)) continue
    const refs = platformRefParts(typeof row.tags.ref === 'string' ? row.tags.ref : '')
    if (!refs.length) continue
    out.push({ lat, lng, refs })
  }
  return out
}

export function osmBuffersFromOverpass(payload: unknown): { lat: number; lng: number }[] {
  if (!payload || typeof payload !== 'object') return []
  const elements = (payload as { elements?: unknown }).elements
  if (!Array.isArray(elements)) return []
  const out: { lat: number; lng: number }[] = []
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    const row = element as { lat?: unknown; lon?: unknown; tags?: { railway?: unknown } }
    if (row.tags?.railway !== 'buffer_stop') continue
    const lat = Number(row.lat)
    const lng = Number(row.lon)
    if (!isValidStationCoordinate(lat, lng)) continue
    out.push({ lat, lng })
  }
  return out
}

export function osmRailsFromOverpass(payload: unknown): OsmRail[] {
  if (!payload || typeof payload !== 'object') return []
  const elements = (payload as { elements?: unknown }).elements
  if (!Array.isArray(elements)) return []
  const out: OsmRail[] = []
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    const tags = (element as { tags?: { railway?: unknown } }).tags
    if (tags?.railway !== 'rail') continue
    const geometry = readWayGeometry(element)
    if (geometry.length < 2) continue
    out.push({ geometry })
  }
  return out
}

function readWayGeometry(element: object): { lat: number; lng: number }[] {
  const geometry = (element as { geometry?: unknown }).geometry
  if (!Array.isArray(geometry)) return []
  const out: { lat: number; lng: number }[] = []
  for (const point of geometry) {
    if (!point || typeof point !== 'object') continue
    const lat = Number((point as { lat?: unknown }).lat)
    const lng = Number((point as { lon?: unknown }).lon)
    if (!isValidStationCoordinate(lat, lng)) continue
    out.push({ lat, lng })
  }
  return out
}

function centroid(points: { lat: number; lng: number }[]): { lat: number; lng: number } {
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length
  const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length
  return { lat, lng }
}

function localMetres(origin: { lat: number; lng: number }, point: { lat: number; lng: number }) {
  const lat = (origin.lat * Math.PI) / 180
  return {
    x: (point.lng - origin.lng) * 111320 * Math.cos(lat),
    y: (point.lat - origin.lat) * 110540,
  }
}

function nearestOnLine(
  point: { lat: number; lng: number },
  line: { lat: number; lng: number }[],
): { lat: number; lng: number; distance: number } | null {
  let best: { lat: number; lng: number; distance: number } | null = null
  for (let i = 1; i < line.length; i++) {
    const a = localMetres(point, line[i - 1])
    const b = localMetres(point, line[i])
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (-a.x * dx + -a.y * dy) / len2))
    const lat = line[i - 1].lat + (line[i].lat - line[i - 1].lat) * t
    const lng = line[i - 1].lng + (line[i].lng - line[i - 1].lng) * t
    const distance = haversineM(point, { lat, lng })
    if (!best || distance < best.distance) best = { lat, lng, distance }
  }
  return best
}

function refOrder(ref: string): number {
  const match = /^(\d+)/.exec(ref)
  return match ? Number(match[1]) : 9999
}

type RailHit = { lat: number; lng: number; distance: number; rail: OsmRail }

function longAxis(shape: { lat: number; lng: number }[]): [{ lat: number; lng: number }, { lat: number; lng: number }] {
  let endA = shape[0]
  let endB = shape[shape.length - 1]
  let span = -1
  for (const a of shape) {
    for (const b of shape) {
      const distance = haversineM(a, b)
      if (distance > span) {
        span = distance
        endA = a
        endB = b
      }
    }
  }
  return [endA, endB]
}

/** The rail that runs beside the platform, not one that only crosses the throat. */
function railAlongside(shape: { lat: number; lng: number }[], rails: OsmRail[]): OsmRail | null {
  const [endA, endB] = longAxis(shape)
  const axisLen = haversineM(endA, endB) || 1
  let best: { rail: OsmRail; distance: number } | null = null
  for (const rail of rails) {
    let cover = 0
    let weighted = 0
    for (let i = 1; i < shape.length; i++) {
      const step = haversineM(shape[i - 1], shape[i])
      if (step <= 0) continue
      const mid = {
        lat: (shape[i - 1].lat + shape[i].lat) / 2,
        lng: (shape[i - 1].lng + shape[i].lng) / 2,
      }
      const hit = nearestOnLine(mid, rail.geometry)
      if (!hit || hit.distance > 22) continue
      cover += step
      weighted += hit.distance * step
    }
    if (cover < Math.min(25, axisLen * 0.35)) continue
    const distance = weighted / cover
    if (!best || distance < best.distance) best = { rail, distance }
  }
  return best?.rail ?? null
}

function projectEnd(
  point: { lat: number; lng: number },
  rail: OsmRail,
): { lat: number; lng: number } | null {
  const hit = nearestOnLine(point, rail.geometry)
  if (!hit || hit.distance > 50) return null
  return { lat: hit.lat, lng: hit.lng }
}

function distanceToShape(point: { lat: number; lng: number }, shape: { lat: number; lng: number }[]): number {
  if (shape.length < 2) return shape.length ? haversineM(point, shape[0]) : Infinity
  return nearestOnLine(point, shape)?.distance ?? Infinity
}

/** A buffer on the next platform must not turn this through road into a bay. */
function bufferEnd(
  ends: [{ lat: number; lng: number }, { lat: number; lng: number }],
  buffers: { lat: number; lng: number }[],
  ownShape: { lat: number; lng: number }[],
  others: { lat: number; lng: number }[][],
): { lat: number; lng: number } | undefined {
  const nearest = (end: { lat: number; lng: number }) => {
    let best = Infinity
    for (const buffer of buffers) {
      const own = distanceToShape(buffer, ownShape)
      if (own > 22) continue
      const closerOther = others.some((shape) => distanceToShape(buffer, shape) + 8 <= own)
      if (closerOther) continue
      best = Math.min(best, haversineM(end, buffer))
    }
    return best
  }
  const left = nearest(ends[0])
  const right = nearest(ends[1])
  if (left <= 22 && left + 20 < right) return ends[0]
  if (right <= 22 && right + 20 < left) return ends[1]
  return undefined
}

function standOnRail(
  ref: string,
  stands: OsmStand[],
  axis: [{ lat: number; lng: number }, { lat: number; lng: number }],
  rail: OsmRail | null,
): { lat: number; lng: number } | undefined {
  const want = normalizePlatformRef(ref)
  let best: { lat: number; lng: number; distance: number } | null = null
  for (const stand of stands) {
    if (!stand.refs.includes(want)) continue
    const along = nearestOnLine(stand, axis)
    if (!along || along.distance > 30) continue
    const onRail = rail ? nearestOnLine(stand, rail.geometry) : along
    if (!onRail || onRail.distance > 18) continue
    if (!best || onRail.distance < best.distance) best = onRail
  }
  return best ? { lat: best.lat, lng: best.lng } : undefined
}

function trackOnRail(
  centre: { lat: number; lng: number },
  axis: [{ lat: number; lng: number }, { lat: number; lng: number }],
  rail: OsmRail | null,
  buffers: { lat: number; lng: number }[],
  ownShape: { lat: number; lng: number }[],
  others: { lat: number; lng: number }[][],
  stand?: { lat: number; lng: number },
): PlatformTrack {
  const projectedA = rail ? projectEnd(axis[0], rail) : null
  const projectedB = rail ? projectEnd(axis[1], rail) : null
  const ends: PlatformTrack['ends'] = projectedA && projectedB ? [projectedA, projectedB] : axis
  const mid = rail ? nearestOnLine(centre, rail.geometry) : null
  const point = stand
    ?? (mid && mid.distance <= 30
      ? { lat: mid.lat, lng: mid.lng }
      : { lat: (ends[0].lat + ends[1].lat) / 2, lng: (ends[0].lng + ends[1].lng) / 2 })
  const bay = bufferEnd(ends, buffers, ownShape, others) ?? bufferEnd(axis, buffers, ownShape, others)
  return {
    lat: point.lat,
    lng: point.lng,
    ends,
    ...(bay ? { bay } : {}),
    ...(stand ? { stand } : {}),
  }
}

/**
 * Put each platform number on the rail beside that platform. A shared island
 * such as "1;2" gets one point per face, with the lower number on the side
 * nearer the lower-numbered platform. A buffer stop marks the bay end.
 */
export function platformTrackPoints(
  anchor: { lat: number; lng: number },
  platforms: OsmPlatform[],
  rails: OsmRail[],
  buffers: { lat: number; lng: number }[] = [],
  stands: OsmStand[] = [],
): Record<string, PlatformTrack> {
  const nearby = platforms.filter((platform) => haversineM(anchor, platform) <= PLATFORM_MATCH_M)
  const byRef: Record<string, PlatformTrack> = {}
  const bestD: Record<string, number> = {}
  const remember = (ref: string, track: PlatformTrack, distance: number) => {
    if (byRef[ref] && distance >= bestD[ref]) return
    byRef[ref] = track
    bestD[ref] = distance
  }

  for (const platform of nearby) {
    const refs = [...platform.refs].sort((a, b) => refOrder(a) - refOrder(b) || a.localeCompare(b))
    const centre = { lat: platform.lat, lng: platform.lng }
    const shape = platform.geometry && platform.geometry.length >= 2 ? platform.geometry : [centre, centre]
    const axis = longAxis(shape)
    const beside = railAlongside(shape, rails)
    const others = nearby
      .filter((other) => other !== platform)
      .map((other) => (other.geometry && other.geometry.length >= 2 ? other.geometry : [{ lat: other.lat, lng: other.lng }]))
    const placed = (rail: OsmRail | null, ref: string) =>
      trackOnRail(centre, axis, rail, buffers, shape, others, standOnRail(ref, stands, axis, rail))
    if (refs.length < 2 || rails.length < 2) {
      for (const ref of refs) remember(ref, placed(beside, ref), haversineM(anchor, centre))
      continue
    }
    const axisMetres = localMetres(axis[0], axis[1])
    const axisLen = Math.hypot(axisMetres.x, axisMetres.y) || 1
    const sides = { neg: null as RailHit | null, pos: null as RailHit | null }
    for (const rail of rails) {
      const hit = nearestOnLine(centre, rail.geometry)
      if (!hit || hit.distance > 40) continue
      const offset = localMetres(centre, hit)
      const side = (axisMetres.x * offset.y - axisMetres.y * offset.x) / axisLen
      const key = side < 0 ? 'neg' : 'pos'
      if (!sides[key] || hit.distance < sides[key].distance) sides[key] = { ...hit, rail }
    }
    if (!sides.neg || !sides.pos) {
      for (const ref of refs) remember(ref, placed(beside, ref), haversineM(anchor, centre))
      continue
    }
    const lowerNeighbour = nearby
      .filter((other) => other !== platform && other.refs.some((ref) => refOrder(ref) < refOrder(refs[0])))
      .sort((a, b) => haversineM(centre, a) - haversineM(centre, b))[0]
    const negIsLower = lowerNeighbour
      ? haversineM(lowerNeighbour, sides.neg) <= haversineM(lowerNeighbour, sides.pos)
      : true
    const ordered = negIsLower ? [sides.neg, sides.pos] : [sides.pos, sides.neg]
    refs.forEach((ref, index) => {
      const side = ordered[Math.min(index, ordered.length - 1)]
      remember(ref, placed(side.rail, ref), haversineM(anchor, centre))
    })
  }
  return byRef
}

/** A platform placement has to sit at this calling point, not at another station. */
export function platformSitsAtStation(
  anchor: { lat: number; lng: number },
  place: {
    lat: number
    lng: number
    ends?: [{ lat: number; lng: number }, { lat: number; lng: number }]
    bay?: { lat: number; lng: number }
    stand?: { lat: number; lng: number }
  },
): boolean {
  const points = [place, ...(place.ends ?? []), place.bay, place.stand].filter(
    (point): point is { lat: number; lng: number } => Boolean(point),
  )
  return points.every((point) => haversineM(anchor, point) <= PLATFORM_APPLY_M)
}

/** Exact ref match, nearest platform to the station pin, within the station area. */
export function matchPlatforms(
  requests: PlatformRequest[],
  platforms: OsmPlatform[],
): Record<string, { lat: number; lng: number }> {
  const out: Record<string, { lat: number; lng: number }> = {}
  for (const request of requests) {
    const hit = resolvePlatform(indexPlatformsAt(request, platforms), request.platform)
    if (hit) out[request.id] = { lat: hit.lat, lng: hit.lng }
  }
  return out
}

export function locationKey(lat: number, lng: number): string {
  return `${lat.toFixed(3)},${lng.toFixed(3)}`
}

function asTrack(point: { lat: number; lng: number; ends?: PlatformTrack['ends']; bay?: PlatformTrack['bay']; stand?: PlatformTrack['stand'] }): PlatformTrack {
  const here = { lat: point.lat, lng: point.lng }
  return {
    lat: point.lat,
    lng: point.lng,
    ends: point.ends ?? [here, here],
    ...(point.bay ? { bay: point.bay } : {}),
    ...(point.stand ? { stand: point.stand } : {}),
  }
}

/** Exact ref, or the middle of 15a/15b when the timetable only says 15. */
export function resolvePlatform(
  byRef: Record<string, { lat: number; lng: number; ends?: PlatformTrack['ends']; bay?: PlatformTrack['bay'] }>,
  platform: string,
): PlatformTrack | null {
  const want = normalizePlatformRef(platform)
  if (!want) return null
  if (byRef[want]) return asTrack(byRef[want])
  if (!/^\d+$/.test(want)) return null
  const faces = Object.entries(byRef).filter(
    ([ref]) => ref.startsWith(want) && ref.length === want.length + 1 && /[A-Z]$/.test(ref),
  )
  if (!faces.length) return null
  const tracks = faces.map(([, point]) => asTrack(point))
  const tips = tracks.flatMap((track) => track.ends)
  let endA = tips[0]
  let endB = tips[tips.length - 1]
  let span = -1
  for (const a of tips) {
    for (const b of tips) {
      const distance = haversineM(a, b)
      if (distance > span) {
        span = distance
        endA = a
        endB = b
      }
    }
  }
  const bays = tracks.flatMap((track) => (track.bay ? [track.bay] : []))
  return {
    lat: tracks.reduce((sum, track) => sum + track.lat, 0) / tracks.length,
    lng: tracks.reduce((sum, track) => sum + track.lng, 0) / tracks.length,
    ends: [endA, endB],
    ...(bays.length === 1 ? { bay: bays[0] } : {}),
  }
}

/** Keep the platform closest to the station when several ways share a ref. */
export function indexPlatformsAt(
  anchor: { lat: number; lng: number },
  platforms: OsmPlatform[],
): Record<string, { lat: number; lng: number }> {
  const byRef: Record<string, { lat: number; lng: number }> = {}
  const bestD: Record<string, number> = {}
  for (const platform of platforms) {
    const distance = haversineM(anchor, platform)
    if (distance > PLATFORM_MATCH_M) continue
    for (const ref of platform.refs) {
      const key = normalizePlatformRef(ref)
      if (!key) continue
      if (byRef[key] && distance >= bestD[key]) continue
      byRef[key] = { lat: platform.lat, lng: platform.lng }
      bestD[key] = distance
    }
  }
  return byRef
}
