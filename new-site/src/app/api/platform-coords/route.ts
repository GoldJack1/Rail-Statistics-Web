import { NextRequest, NextResponse } from 'next/server'

import { lookupPlatformCoords } from '@/server/platformCoords'
import { parsePlatformQuery } from '@/utils/platformPosition'

export const maxDuration = 30

export async function GET(request: NextRequest) {
  const requests = parsePlatformQuery(request.nextUrl.searchParams.get('at') || '')
  if (requests.length === 0) {
    return NextResponse.json({ coords: {} }, { headers: { 'Cache-Control': 'public, max-age=3600' } })
  }
  const coords = await lookupPlatformCoords(requests)
  const complete = requests.every((item) => coords[item.id])
  return NextResponse.json(
    { coords },
    { headers: { 'Cache-Control': complete ? 'public, max-age=86400' : 'private, max-age=120' } },
  )
}
