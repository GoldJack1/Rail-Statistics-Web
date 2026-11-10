import {
  locationKey,
  normalizePlatformRef,
  resolvePlatform,
  stationBookedRef,
  type PlatformRequest,
  type PlatformTrack,
} from './platformPosition'

export { parsePlatformQuery } from './platformPosition'

/** A station track from quai: where a train calling there stops. */
export type QuaiTrack = {
  ref: string
  lat: number
  lng: number
  /** A stop position on the rail. False where only the platform gives it. */
  on_track: boolean
}

type Pair = [number, number]

/** A platform as `/api/platforms` returns it. */
export type PlatformCoord = {
  lat: number
  lng: number
  ends: [Pair, Pair]
  bay?: Pair
  stand?: Pair
}

/**
 * Each platform number at the station, at quai's point for it. A point on the
 * rail is also where the train stands, so the route passes it exactly.
 * A measured replacement, such as Huddersfield 1, 2 and 3, is applied afterwards
 * from the query server's platform-fixes file.
 */
export function quaiTrackPoints(
  _anchor: { lat: number; lng: number },
  tracks: QuaiTrack[],
): Record<string, PlatformTrack> {
  const byRef: Record<string, PlatformTrack> = {}
  for (const track of tracks) {
    const ref = normalizePlatformRef(track.ref)
    if (!ref || !Number.isFinite(track.lat) || !Number.isFinite(track.lng)) continue
    if (byRef[ref]?.stand && !track.on_track) continue
    const here = { lat: track.lat, lng: track.lng }
    byRef[ref] = { ...here, ends: [here, here], ...(track.on_track ? { stand: here } : {}) }
  }
  return byRef
}

function encodeTrack(track: PlatformTrack): PlatformCoord {
  const body: PlatformCoord = {
    lat: track.lat,
    lng: track.lng,
    ends: [
      [track.ends[0].lat, track.ends[0].lng],
      [track.ends[1].lat, track.ends[1].lng],
    ],
  }
  if (track.bay) body.bay = [track.bay.lat, track.bay.lng]
  if (track.stand) body.stand = [track.stand.lat, track.stand.lng]
  return body
}

/** `*` returns every platform at the station, keyed `id~ref`. */
export function writePlatformCoords(
  coords: Record<string, PlatformCoord>,
  request: PlatformRequest,
  byRef: Record<string, PlatformTrack>,
): void {
  if (request.platform === '*') {
    for (const [ref, track] of Object.entries(byRef)) coords[`${request.id}~${ref}`] = encodeTrack(track)
    return
  }
  const platform = resolvePlatform(byRef, stationBookedRef(request, request.platform))
  if (platform) coords[request.id] = encodeTrack(platform)
}

/**
 * The platforms asked for, one quai lookup per station. `stationTracks` gives
 * the tracks of the station at a point, or null when quai cannot be reached.
 */
export async function lookupQuaiPlatforms(
  requests: PlatformRequest[],
  stationTracks: (lat: number, lng: number) => Promise<QuaiTrack[] | null>,
): Promise<Record<string, PlatformCoord>> {
  const groups = new Map<string, PlatformRequest[]>()
  for (const request of requests) {
    const key = locationKey(request.lat, request.lng)
    const group = groups.get(key)
    if (group) group.push(request)
    else groups.set(key, [request])
  }
  const coords: Record<string, PlatformCoord> = {}
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const anchor = group[0]
      const tracks = await stationTracks(anchor.lat, anchor.lng)
      if (!tracks) return
      const byRef = quaiTrackPoints(anchor, tracks)
      for (const request of group) writePlatformCoords(coords, request, byRef)
    }),
  )
  return coords
}
