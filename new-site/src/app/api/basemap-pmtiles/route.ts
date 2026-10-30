import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/** Public planet archive. It has no CORS headers, so the map reads it through here. */
const UPSTREAM = 'https://latest.protomaps.com/v4.pmtiles'

const FORWARDED = ['content-type', 'content-length', 'content-range', 'accept-ranges', 'etag']

async function proxy(request: NextRequest, method: 'GET' | 'HEAD') {
  const headers = new Headers()
  const range = request.headers.get('range')
  if (range) headers.set('Range', range)
  // Next's fetch cache keys on the URL and ignores Range, so a cached body
  // would be the wrong tile. The CDN cache does honour Vary: Range.
  const upstream = await fetch(UPSTREAM, { method, headers, cache: 'no-store' })
  const out = new Headers()
  for (const key of FORWARDED) {
    const value = upstream.headers.get(key)
    if (value) out.set(key, value)
  }
  out.set('Vary', 'Range')
  out.set('Cache-Control', 'public, max-age=86400')
  out.set('Netlify-CDN-Cache-Control', 'public, s-maxage=86400, durable')
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
