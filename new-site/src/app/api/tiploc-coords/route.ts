import { NextRequest, NextResponse } from 'next/server'

import { lookupTiplocCoords } from '@/server/tiplocGeo'

export function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get('tpl') || ''
  const tiplocs = raw.split('|')
  const coords = lookupTiplocCoords(tiplocs)
  // Netlify's edge cache varies route handlers on __nextDataReq and _rsc only,
  // so a public Cache-Control header serves one TIPLOC payload for every train.
  return NextResponse.json(
    { coords },
    {
      headers: {
        'Cache-Control': 'private, no-store',
        'CDN-Cache-Control': 'no-store',
        'Netlify-CDN-Cache-Control': 'no-store',
      },
    },
  )
}
