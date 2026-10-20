import {
  locationKey,
  osmBuffersFromOverpass,
  osmPlatformsFromOverpass,
  osmStandsFromOverpass,
  osmRailsFromOverpass,
  platformTrackPoints,
  resolvePlatform,
  type OsmPlatform,
  type OsmRail,
  type PlatformRequest,
} from '@/utils/platformPosition'

const CACHE_MS = 24 * 60 * 60 * 1000
const ENDPOINTS = [
  'https://overpass.openstreetmap.fr/api/interpreter',
  'https://overpass-api.de/api/interpreter',
]

type CachedStation = {
  at: number
  byRef: ReturnType<typeof platformTrackPoints>
}

type PlatformCoord = {
  lat: number
  lng: number
  ends: [[number, number], [number, number]]
  bay?: [number, number]
  stand?: [number, number]
}

const cache = new Map<string, CachedStation>()

function overpassQuery(points: { lat: number; lng: number }[]): string {
  const clauses = points
    .map(
      (point) =>
        `way["railway"="platform"](around:450,${point.lat.toFixed(5)},${point.lng.toFixed(5)});
node["railway"="platform"](around:450,${point.lat.toFixed(5)},${point.lng.toFixed(5)});
way["railway"="rail"](around:160,${point.lat.toFixed(5)},${point.lng.toFixed(5)});
node["railway"="buffer_stop"](around:450,${point.lat.toFixed(5)},${point.lng.toFixed(5)});
node["public_transport"="stop_position"]["ref"](around:450,${point.lat.toFixed(5)},${point.lng.toFixed(5)});`,
    )
    .join('\n')
  return `[out:json][timeout:20];(\n${clauses}\n);out tags geom;`
}

function encodeTrack(track: { lat: number; lng: number; ends: [{ lat: number; lng: number }, { lat: number; lng: number }]; bay?: { lat: number; lng: number }; stand?: { lat: number; lng: number } }): PlatformCoord {
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

async function fetchOsmPlatforms(
  points: { lat: number; lng: number }[],
): Promise<{ platforms: OsmPlatform[]; rails: OsmRail[]; buffers: { lat: number; lng: number }[]; stands: { lat: number; lng: number; refs: string[] }[] } | null> {
  const body = new URLSearchParams({ data: overpassQuery(points) })
  for (const endpoint of ENDPOINTS) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk); platform positions',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(12000),
        cache: 'no-store',
      })
      if (!response.ok) continue
      const payload: unknown = await response.json()
      return {
        platforms: osmPlatformsFromOverpass(payload),
        rails: osmRailsFromOverpass(payload),
        buffers: osmBuffersFromOverpass(payload),
        stands: osmStandsFromOverpass(payload),
      }
    } catch {
      continue
    }
  }
  return null
}

export async function lookupPlatformCoords(
  requests: PlatformRequest[],
): Promise<Record<string, PlatformCoord>> {
  const now = Date.now()
  const coords: Record<string, PlatformCoord> = {}
  const pending = new Map<string, { lat: number; lng: number; requests: PlatformRequest[] }>()

  for (const request of requests) {
    const key = locationKey(request.lat, request.lng)
    const hit = cache.get(key)
    if (hit && now - hit.at < CACHE_MS) {
      const platform = resolvePlatform(hit.byRef, request.platform)
      if (platform) coords[request.id] = encodeTrack(platform)
      continue
    }
    const group = pending.get(key)
    if (group) group.requests.push(request)
    else pending.set(key, { lat: request.lat, lng: request.lng, requests: [request] })
  }

  if (pending.size === 0) return coords

  const anchors = [...pending.values()]
  const fetched = await fetchOsmPlatforms(anchors)
  if (!fetched) return coords

  for (const anchor of anchors) {
    const byRef = platformTrackPoints(anchor, fetched.platforms, fetched.rails, fetched.buffers, fetched.stands)
    cache.set(locationKey(anchor.lat, anchor.lng), { at: now, byRef })
    for (const request of anchor.requests) {
      const platform = resolvePlatform(byRef, request.platform)
      if (platform) coords[request.id] = encodeTrack(platform)
    }
  }
  return coords
}
