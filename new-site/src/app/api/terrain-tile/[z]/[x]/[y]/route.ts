import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{ z: string; x: string; y: string }>
}

/** Mapzen Terrarium has no CORS headers. The elevation styles read it through here. */
const TILE = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium'

function tileIndex(z: string, x: string, y: string): { z: number; x: number; y: number } | null {
  if (!/^\d+$/.test(z) || !/^\d+$/.test(x) || !/^\d+$/.test(y)) return null
  const zi = Number(z)
  const xi = Number(x)
  const yi = Number(y)
  if (zi > 15) return null
  const limit = 2 ** zi
  if (xi >= limit || yi >= limit) return null
  return { z: zi, x: xi, y: yi }
}

export async function GET(_request: Request, context: RouteContext) {
  const { z, x, y } = await context.params
  const tile = tileIndex(z, x, y)
  if (!tile) return new NextResponse('Bad tile', { status: 400 })
  const upstream = await fetch(`${TILE}/${tile.z}/${tile.x}/${tile.y}.png`, { cache: 'no-store' })
  if (!upstream.ok) return new NextResponse(null, { status: upstream.status })
  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=604800',
    },
  })
}
