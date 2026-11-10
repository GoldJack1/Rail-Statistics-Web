import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Matches OPENRAILWAYMAP_MAX_ZOOM in the map style. */
const MAX_ZOOM = 19

type RouteContext = {
  params: Promise<{ z: string; x: string; y: string }>
}

/** OpenRailwayMap standard tiles have no CORS header. MapLibre reads them through here. */
const TILE = 'https://tiles.openrailwaymap.org/standard'

function tileIndex(z: string, x: string, y: string): { z: number; x: number; y: number } | null {
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) return null
  const zi = Number(z)
  const xi = Number(x)
  const yi = Number(y)
  if (zi > MAX_ZOOM) return null
  const limit = 2 ** zi
  if (xi >= limit || yi >= limit) return null
  return { z: zi, x: xi, y: yi }
}

export async function GET(_request: Request, context: RouteContext) {
  const { z, x, y } = await context.params
  const tile = tileIndex(z, x, y)
  if (!tile) return new NextResponse('Bad tile', { status: 400 })
  const upstream = await fetch(`${TILE}/${tile.z}/${tile.x}/${tile.y}.png`, {
    headers: { 'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk); OpenRailwayMap overlay' },
    next: { revalidate: 86400 },
  })
  if (!upstream.ok) return new NextResponse(null, { status: upstream.status })
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': upstream.headers.get('Content-Type') || 'image/png',
      'Cache-Control': 'public, max-age=86400',
    },
  })
}
