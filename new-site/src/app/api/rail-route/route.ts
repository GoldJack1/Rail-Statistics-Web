import { NextRequest, NextResponse } from 'next/server'

import { osmRailPath, railwayRouteJoined, routeLeavesTheRailway, shapeOntoLeftHandTrack } from '@/server/osmRailPath'
import { isValidStationCoordinate } from '@/utils/stationCoordinates'
import {
  buildOpenRailRouteUrl,
  parseOpenRailRoute,
  straightLineBetween,
  type LatLngTuple,
} from '@/utils/brouterRailRoute'

export const maxDuration = 30

const routeCache = new Map<string, { at: number; coordinates: LatLngTuple[] }>()
const ROUTE_CACHE_MS = 30 * 60 * 1000

function routeCacheKey(points: LatLngTuple[]): string {
  return `geom12|${points.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join('|')}`
}

function readCoord(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

function parseViaPoints(value: string | null): LatLngTuple[] {
  if (!value) return []
  const points: LatLngTuple[] = []
  for (const part of value.split('|')) {
    const [latRaw, lngRaw] = part.split(',')
    const lat = readCoord(latRaw ?? null)
    const lng = readCoord(lngRaw ?? null)
    if (lat == null || lng == null || !isValidStationCoordinate(lat, lng)) continue
    points.push([lat, lng])
  }
  return points
}

export async function GET(request: NextRequest) {
  const fromLat = readCoord(request.nextUrl.searchParams.get('fromLat'))
  const fromLng = readCoord(request.nextUrl.searchParams.get('fromLng'))
  const toLat = readCoord(request.nextUrl.searchParams.get('toLat'))
  const toLng = readCoord(request.nextUrl.searchParams.get('toLng'))
  if (
    fromLat == null ||
    fromLng == null ||
    toLat == null ||
    toLng == null ||
    !isValidStationCoordinate(fromLat, fromLng) ||
    !isValidStationCoordinate(toLat, toLng)
  ) {
    return NextResponse.json({ error: 'Valid fromLat, fromLng, toLat and toLng are required' }, { status: 400 })
  }

  const from: LatLngTuple = [fromLat, fromLng]
  const to: LatLngTuple = [toLat, toLng]
  const vias = parseViaPoints(request.nextUrl.searchParams.get('via'))
  const points: LatLngTuple[] = [from, ...vias, to]
  const fallback = straightLineBetween(from, to)
  const cacheKey = routeCacheKey(points)
  const cached = routeCache.get(cacheKey)
  if (cached && Date.now() - cached.at < ROUTE_CACHE_MS) {
    return NextResponse.json(
      { coordinates: cached.coordinates, fallback: false },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  }

  const respond = async (coordinates: LatLngTuple[]) => {
    let shaped = coordinates
    try {
      shaped = await shapeOntoLeftHandTrack(points, coordinates)
    } catch {
      shaped = coordinates
    }
    // Shaping is optional. These coordinates are already a rail path. Substituting
    // the straight chord made the map drop the line and ask for the route again.
    if (shaped === coordinates || shaped.length < 2) {
      if (routeLeavesTheRailway(points, coordinates)) {
        return NextResponse.json({ coordinates: fallback, fallback: true })
      }
      routeCache.set(cacheKey, { at: Date.now(), coordinates })
      return NextResponse.json(
        { coordinates, fallback: false },
        { headers: { 'Cache-Control': 'private, max-age=300' } },
      )
    }
    routeCache.set(cacheKey, { at: Date.now(), coordinates: shaped })
    return NextResponse.json(
      { coordinates: shaped, fallback: false },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  }

  const alongTracksOr = async (routed: LatLngTuple[]): Promise<LatLngTuple[] | null> => {
    if (routed.length >= 2 && !routeLeavesTheRailway(points, routed)) return routed
    const alongTracks = await osmRailPath(points)
    if (alongTracks && alongTracks.length >= 2 && !routeLeavesTheRailway(points, alongTracks)) return alongTracks
    return null
  }

  const alongRails = await railwayRouteJoined(points).catch(() => null)
  if (alongRails && alongRails.length >= 2 && !routeLeavesTheRailway(points, alongRails)) {
    routeCache.set(cacheKey, { at: Date.now(), coordinates: alongRails })
    return NextResponse.json(
      { coordinates: alongRails, fallback: false },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  }

  try {
    const upstream = await fetch(buildOpenRailRouteUrl(points), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk); rail route proxy',
      },
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!upstream.ok) {
      const limited = upstream.status === 403 || upstream.status === 429 || upstream.status >= 500
      if (limited) return NextResponse.json({ coordinates: fallback, fallback: true, limited })
      const alongTracks = await osmRailPath(points)
      if (alongTracks && alongTracks.length >= 2) return respond(alongTracks)
      return NextResponse.json({ coordinates: fallback, fallback: true })
    }
    const payload: unknown = await upstream.json()
    const coordinates = await alongTracksOr(parseOpenRailRoute(payload))
    if (!coordinates) return NextResponse.json({ coordinates: fallback, fallback: true })
    return respond(coordinates)
  } catch {
    try {
      const alongTracks = await osmRailPath(points)
      if (alongTracks && alongTracks.length >= 2) return respond(alongTracks)
    } catch {
      /* The railway graph is optional. A straight chord stays marked as a fallback. */
    }
    return NextResponse.json({ coordinates: fallback, fallback: true })
  }
}
