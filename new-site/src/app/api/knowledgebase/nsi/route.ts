import { NextResponse } from 'next/server'

export async function GET() {
  const apiKey = process.env.KB_STATIONS_API_KEY || process.env.KB_STATIONS_CONSUMER_KEY || ''
  const origin = (process.env.KB_INCIDENTS_API_ORIGIN || process.env.KB_STATIONS_API_ORIGIN || '').replace(/\/$/, '')
  if (!apiKey || !origin) {
    return NextResponse.json({ kind: 'nsi', xml: '' }, { status: 200 })
  }
  const upstream = await fetch(`${origin}/nsi.xml`, {
    headers: { 'x-apikey': apiKey, Accept: 'application/xml' },
    next: { revalidate: 300 },
  })
  const xml = await upstream.text()
  return NextResponse.json(
    { kind: 'nsi', xml: xml.slice(0, 500_000) },
    { status: upstream.status, headers: { 'Cache-Control': 'public, s-maxage=300' } },
  )
}
