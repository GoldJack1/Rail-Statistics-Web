import { isValidStationCoordinate } from './stationCoordinates'

/** How far a returned platform may sit from the calling point before it is dropped. */
export const PLATFORM_APPLY_M = 800

export type PlatformRequest = {
  id: string
  lat: number
  lng: number
  platform: string
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

export function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
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

/** Map pin for Huddersfield. The override only applies at this station. */
const HUDDERSFIELD = { lat: 53.64843, lng: -1.78515 }

export function atHuddersfield(anchor: { lat: number; lng: number }): boolean {
  return haversineM(anchor, HUDDERSFIELD) <= 500
}

/**
 * A booking of 4, 4A, or 4B at Huddersfield is platform 3. 1 and 2 are
 * already stored under the new numbers.
 */
export function stationBookedRef(anchor: { lat: number; lng: number }, platform: string): string {
  const ref = normalizePlatformRef(platform)
  if (!ref || !atHuddersfield(anchor)) return platform
  if (ref === '4' || ref === '4A' || ref === '4B') return '3'
  return platform
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
