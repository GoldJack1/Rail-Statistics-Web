import { NextResponse } from 'next/server'

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status })
}

async function kbGet(kind: 'incidents' | 'nsi') {
  const apiKey = process.env.KB_STATIONS_API_KEY || process.env.KB_STATIONS_CONSUMER_KEY || ''
  const origin = (process.env.KB_INCIDENTS_API_ORIGIN || process.env.KB_STATIONS_API_ORIGIN || '').replace(/\/$/, '')
  if (!apiKey || !origin) {
    return json(200, { kind, xml: '' })
  }
  const path = kind === 'nsi' ? '/nsi.xml' : '/incidents.xml'
  const upstream = await fetch(`${origin}${path}`, {
    headers: { 'x-apikey': apiKey, Accept: 'application/xml' },
    next: { revalidate: 300 },
  })
  const xml = await upstream.text()
  return new NextResponse(JSON.stringify({ kind, xml: xml.slice(0, 500_000) }), {
    status: upstream.status,
    headers: {
      'content-type': 'application/json',
      'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
    },
  })
}

export async function GET() {
  return kbGet('incidents')
}
