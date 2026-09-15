import { NextRequest, NextResponse } from 'next/server'

import { isValidStationCoordinate } from '@/utils/stationCoordinates'
import {
  buildBrouterRailUrl,
  parseBrouterRailGeoJson,
  straightLineBetween,
  type LatLngTuple,
} from '@/utils/brouterRailRoute'

export const maxDuration = 30

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

  try {
    const upstream = await fetch(buildBrouterRailUrl(points), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk); rail route proxy',
      },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!upstream.ok) {
      return NextResponse.json({ coordinates: fallback, fallback: true })
    }
    const payload: unknown = await upstream.json()
    const coordinates = parseBrouterRailGeoJson(payload)
    if (coordinates.length < 2) {
      return NextResponse.json({ coordinates: fallback, fallback: true })
    }
    return NextResponse.json(
      { coordinates, fallback: false },
      { headers: { 'Cache-Control': 'private, max-age=300' } }
    )
  } catch {
    return NextResponse.json({ coordinates: fallback, fallback: true })
  }
}
