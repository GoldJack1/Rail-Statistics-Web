import { NextRequest, NextResponse } from 'next/server'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const appKey = process.env.TFL_APP_KEY || ''
  if (!appKey) {
    return NextResponse.json({ error: 'not_configured' }, { status: 500 })
  }
  const { path } = await context.params
  const splat = (path || []).join('/')
  const url = new URL(`https://api.tfl.gov.uk/${splat}`)
  url.searchParams.set('app_key', appKey)
  request.nextUrl.searchParams.forEach((v, k) => {
    if (k !== 'app_key') url.searchParams.set(k, v)
  })
  const upstream = await fetch(url, { headers: { Accept: 'application/json' }, next: { revalidate: 20 } })
  const body = await upstream.json().catch(() => ({}))
  return NextResponse.json(body, {
    status: upstream.status,
    headers: { 'Cache-Control': 'public, s-maxage=20, stale-while-revalidate=40' },
  })
}
