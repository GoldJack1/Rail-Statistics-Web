import { NextRequest, NextResponse } from 'next/server'

import { layOnRailway, railwayRouteJoined, routeLeavesTheRailway } from '@/server/osmRailPath'
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

function routeCacheKey(points: LatLngTuple[], strict: boolean): string {
  return `geom23|${strict ? 'left|' : ''}${points.map(([lat, lng]) => `${lat.toFixed(5)},${lng.toFixed(5)}`).join('|')}`
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
  const strict = request.nextUrl.searchParams.get('strict') === '1'
  const fallback = straightLineBetween(from, to)
  const cacheKey = routeCacheKey(points, strict)
  const cached = routeCache.get(cacheKey)
  if (cached && Date.now() - cached.at < ROUTE_CACHE_MS) {
    return NextResponse.json(
      { coordinates: cached.coordinates, fallback: false },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  }

  const publish = (coordinates: LatLngTuple[]) => {
    routeCache.set(cacheKey, { at: Date.now(), coordinates })
    return NextResponse.json(
      { coordinates, fallback: false },
      { headers: { 'Cache-Control': 'private, max-age=300' } },
    )
  }

  // The rail router answers in one request. The OpenStreetMap graph is only
  // for a route that leaves the tracks, because that graph is several map queries.
  // A strict request is the platform test: a miss stays empty, so the passenger
  // line is not drawn in its place.
  try {
    const upstream = await fetch(buildOpenRailRouteUrl(points, strict), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk); rail route proxy',
      },
      signal: AbortSignal.timeout(strict ? 20000 : 6000),
      cache: 'no-store',
    })
    if (upstream.ok) {
      const routed = parseOpenRailRoute(await upstream.json())
      if (routed.length >= 2 && !routeLeavesTheRailway(points, routed)) {
        // A simplified edge cuts across the curve. Lay those edges on the
        // mapped rails, and give up if that lookup does not answer quickly.
        let usedRouter = false
        const laid = await Promise.race([
          layOnRailway(routed, points).catch(() => routed),
          new Promise<LatLngTuple[]>((resolve) => setTimeout(() => {
            usedRouter = true
            resolve(routed)
          }, 8000)),
        ])
        const coordinates = !usedRouter && laid.length >= 2 && !routeLeavesTheRailway(points, laid) ? laid : routed
        if (usedRouter) {
          return NextResponse.json(
            { coordinates, fallback: false },
            { headers: { 'Cache-Control': 'private, max-age=0' } },
          )
        }
        return publish(coordinates)
      }
    } else if (!strict && (upstream.status === 403 || upstream.status === 429 || upstream.status >= 500)) {
      return NextResponse.json({ coordinates: fallback, fallback: true, limited: true })
    }
  } catch {
    /* The router timed out. The map graph below still draws the line. */
  }

  if (strict) return NextResponse.json({ coordinates: [], fallback: true })

  const alongRails = await railwayRouteJoined(points).catch(() => null)
  if (alongRails && alongRails.length >= 2 && !routeLeavesTheRailway(points, alongRails)) {
    return publish(alongRails)
  }
  return NextResponse.json({ coordinates: fallback, fallback: true })
}
