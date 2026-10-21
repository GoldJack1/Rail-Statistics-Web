import { NextRequest, NextResponse } from 'next/server'

import { lookupPlatformCoords } from '@/server/platformCoords'
import { parsePlatformQuery } from '@/utils/platformPosition'

export const maxDuration = 30

function json(body: unknown) {
  // Netlify's edge cache varies route handlers on __nextDataReq and _rsc only,
  // so a public Cache-Control header serves one platform payload for every train.
  return NextResponse.json(body, {
    headers: {
      'Cache-Control': 'private, no-store',
      'CDN-Cache-Control': 'no-store',
      'Netlify-CDN-Cache-Control': 'no-store',
    },
  })
}

export async function GET(request: NextRequest) {
  const requests = parsePlatformQuery(request.nextUrl.searchParams.get('at') || '')
  if (requests.length === 0) return json({ coords: {} })
  const coords = await lookupPlatformCoords(requests)
  return json({ coords })
}
