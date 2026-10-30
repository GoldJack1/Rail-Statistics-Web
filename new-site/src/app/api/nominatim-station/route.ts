import { NextRequest, NextResponse } from 'next/server'
import { isValidStationCoordinate } from '@/utils/stationCoordinates'

export function nominatimSearchUrl(name: string): string {
  const url = new URL('https://nominatim.openstreetmap.org/search')
  url.searchParams.set('q', `${name} railway station`)
  url.searchParams.set('format', 'jsonv2')
  url.searchParams.set('limit', '1')
  url.searchParams.set('countrycodes', 'gb')
  return url.toString()
}

/** Britain, including a margin for a station pin that sits just inland. */
export function nominatimInBritain(lat: number, lng: number): boolean {
  return lat >= 49 && lat <= 61.1 && lng >= -8.7 && lng <= 2.2
}

export async function GET(request: NextRequest) {
  const name = (request.nextUrl.searchParams.get('q') || '').trim()
  if (name.length < 2 || name.length > 80) {
    return NextResponse.json({ error: 'A station name is required' }, { status: 400 })
  }
  try {
    const upstream = await fetch(nominatimSearchUrl(name), {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk)',
      },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    })
    if (!upstream.ok) return NextResponse.json({ lat: null, lng: null })
    const rows = (await upstream.json()) as Array<{ lat?: string; lon?: string }>
    const lat = Number(rows[0]?.lat)
    const lng = Number(rows[0]?.lon)
    if (!isValidStationCoordinate(lat, lng) || !nominatimInBritain(lat, lng)) {
      return NextResponse.json({ lat: null, lng: null })
    }
    return NextResponse.json({ lat, lng })
  } catch {
    return NextResponse.json({ lat: null, lng: null })
  }
}
