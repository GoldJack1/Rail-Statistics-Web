import { NextRequest, NextResponse } from 'next/server'

const MODES = new Set(['tube', 'dlr', 'overground', 'elizabeth-line', 'tram', 'national-rail'])

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status })
}

/**
 * TfL Unified API proxy (app key server-side). Rail modes only as listed in the rebuild plan.
 */
export async function GET(request: NextRequest) {
  const appKey = process.env.TFL_APP_KEY || ''
  if (!appKey) {
    return json(500, { error: 'not_configured', message: 'TFL_APP_KEY is not set' })
  }
  const mode = request.nextUrl.searchParams.get('mode') || 'tube'
  if (!MODES.has(mode)) {
    return json(400, { error: 'bad_mode', modes: [...MODES] })
  }
  const path = request.nextUrl.searchParams.get('path') || `Line/Mode/${mode}/Status`
  const url = new URL(`https://api.tfl.gov.uk/${path.replace(/^\//, '')}`)
  url.searchParams.set('app_key', appKey)
  for (const [k, v] of request.nextUrl.searchParams) {
    if (k === 'path' || k === 'mode' || k === 'app_key') continue
    url.searchParams.set(k, v)
  }
  const upstream = await fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 30 } })
  const body = await upstream.json().catch(() => ({}))
  return NextResponse.json(body, {
    status: upstream.status,
    headers: { 'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=60' },
  })
}
