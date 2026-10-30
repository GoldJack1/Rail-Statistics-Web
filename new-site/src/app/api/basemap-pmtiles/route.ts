import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Public planet archive. It has no CORS headers, so the map reads it through here. */
const UPSTREAM = 'https://latest.protomaps.com/v4.pmtiles'

const FORWARDED = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']

async function proxy(request: NextRequest, method: 'GET' | 'HEAD') {
  const headers = new Headers()
  const range = request.headers.get('range')
  if (range) headers.set('Range', range)
  const upstream = await fetch(UPSTREAM, { method, headers, cache: 'no-store' })
  const out = new Headers()
  for (const key of FORWARDED) {
    const value = upstream.headers.get(key)
    if (value) out.set(key, value)
  }
  out.set('Cache-Control', 'public, max-age=86400')
  return new NextResponse(method === 'HEAD' ? null : upstream.body, {
    status: upstream.status,
    headers: out,
  })
}

export function GET(request: NextRequest) {
  return proxy(request, 'GET')
}

export function HEAD(request: NextRequest) {
  return proxy(request, 'HEAD')
}
