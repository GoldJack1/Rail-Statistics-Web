import { NextRequest, NextResponse } from 'next/server'

import { osmRailPath, routeLeavesTheRailway } from '@/server/osmRailPath'
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
  return points.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join('|')
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

  try {
    const upstream = await fetch(buildOpenRailRouteUrl(points), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk); rail route proxy',
      },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!upstream.ok) {
      const limited = upstream.status === 403 || upstream.status === 429 || upstream.status >= 500
      return NextResponse.json({ coordinates: fallback, fallback: true, limited })
    }
    const payload: unknown = await upstream.json()
    let coordinates = parseOpenRailRoute(payload)
    if (coordinates.length < 2) {
      return NextResponse.json({ coordinates: fallback, fallback: true })
    }
    if (routeLeavesTheRailway(points, coordinates)) {
      const alongTracks = await osmRailPath(points)
      if (alongTracks && alongTracks.length >= 2) coordinates = alongTracks
    }
    routeCache.set(cacheKey, { at: Date.now(), coordinates })
    return NextResponse.json(
      { coordinates, fallback: false },
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    )
  } catch {
    return NextResponse.json({ coordinates: fallback, fallback: true })
  }
}
