import { NextRequest, NextResponse } from 'next/server'

import { lookupTiplocCoords } from '@/server/tiplocGeo'

export function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('tpl') || ''
  const tiplocs = raw.split('|')
  const coords = lookupTiplocCoords(tiplocs)
  return NextResponse.json(
    { coords },
    { headers: { 'Cache-Control': 'public, max-age=86400' } },
  )
}
