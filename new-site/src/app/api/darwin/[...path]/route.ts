import { Agent, fetch as undiciFetch } from 'undici'
import { NextRequest, NextResponse } from 'next/server'
import { requireDarwinAdmin } from '@/app/api/darwin/_lib/requireDarwinAdmin'
import { isLocalDarwinOrigin, resolveDarwinApiOrigin, resolveDarwinHeavyOrigin, shouldUseDirectHeavyOrigin } from '@/utils/darwinApiOrigin'

/** Reuse TLS to the VPS across warm Netlify isolates (Ohio→Germany was ~8s per live board). */
const darwinUpstreamAgent = new Agent({
  keepAliveTimeout: 30_000,
  keepAliveMaxTimeout: 60_000,
  connections: 32,
})

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status })
}

function boolEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function londonYmdNow(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function isPastBoardDate(request: NextRequest): boolean {
  const date = request.nextUrl.searchParams.get('date') || ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  return date < londonYmdNow()
}

function resolveUpstreamOrigin(request: NextRequest, pathSegments: string[]): string {
  const origin = resolveDarwinApiOrigin()
  const heavy = resolveDarwinHeavyOrigin(origin)
  if (!shouldUseDirectHeavyOrigin(origin, heavy)) return origin
  const kind = pathSegments[0]
  if (kind === 'units' || kind === 'unit' || kind === 'history' || kind === 'plan') {
    return heavy
  }
  if ((kind === 'departures' || kind === 'service') && isPastBoardDate(request)) return heavy
  return origin
}

function applyDarwinCacheHeaders(
  responseHeaders: Headers,
  request: NextRequest,
  pathSegments: string[],
  ok: boolean,
) {
  const noStore = () => {
    responseHeaders.set('Cache-Control', 'private, no-store')
    responseHeaders.set('CDN-Cache-Control', 'no-store')
    responseHeaders.set('Netlify-CDN-Cache-Control', 'no-store')
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    noStore()
    return
  }
  if (!ok) {
    noStore()
    return
  }
  const kind = pathSegments[0]
  const date = request.nextUrl.searchParams.get('date') || ''
  const past = /^\d{4}-\d{2}-\d{2}$/.test(date) && date < londonYmdNow()
  // Historical boards must never hit the CDN: Netlify reused date-only bodies for ?at=.
  if ((kind === 'departures' || kind === 'service') && past) {
    noStore()
    return
  }
  if (kind === 'departures' && !date) {
    const live = 'public, s-maxage=3, stale-while-revalidate=15'
    responseHeaders.set('Cache-Control', live)
    responseHeaders.set('CDN-Cache-Control', live)
    responseHeaders.set('Netlify-CDN-Cache-Control', live)
    return
  }
  const list = listCacheControl(request, pathSegments)
  if (list) {
    responseHeaders.set('Cache-Control', list)
    responseHeaders.set('CDN-Cache-Control', list)
    responseHeaders.set('Netlify-CDN-Cache-Control', list)
  }
}

function listCacheControl(request: NextRequest, pathSegments: string[]): string | null {
  if (request.method !== 'GET' && request.method !== 'HEAD') return null
  const kind = pathSegments[0]
  const sub = pathSegments[1]
  if (kind === 'window' || kind === 'health') return 'public, s-maxage=30, stale-while-revalidate=60'
  if (kind === 'history' && sub === 'dates') return 'public, s-maxage=60, stale-while-revalidate=300'
  if (kind === 'units' && (sub === 'catalog' || sub === 'fleets' || sub === 'days')) {
    return 'public, s-maxage=45, stale-while-revalidate=180'
  }
  return null
}

function darwinUpstreamTimeoutMs(request: NextRequest, pathSegments: string[]): number {
  const kind = pathSegments[0]
  if (kind === 'plan') return 90_000
  if (kind === 'health' || kind === 'units' || kind === 'unit' || kind === 'history') return 45_000
  const date = request.nextUrl.searchParams.get('date') || ''
  if ((kind === 'departures' || kind === 'service') && /^\d{4}-\d{2}-\d{2}$/.test(date)) return 45_000
  return 12_000
}

function detectCountryCode(request: NextRequest): string | null {
  const candidates = [
    request.headers.get('x-country'),
    request.headers.get('cf-ipcountry'),
    request.headers.get('vercel-ip-country'),
    request.headers.get('x-nf-geo-country'),
  ]
  for (const raw of candidates) {
    const code = String(raw || '').trim().toUpperCase()
    if (code) return code
  }
  return null
}

async function proxyDarwin(request: NextRequest, pathSegments: string[]): Promise<NextResponse> {
  const origin = resolveUpstreamOrigin(request, pathSegments)
  const apiKey = process.env.DARWIN_API_KEY || ''
  const liveOrigin = resolveDarwinApiOrigin()
  const ukOnly = boolEnv(process.env.DARWIN_UK_ONLY)
  const ukAllowedCountries = new Set(['GB', 'UK'])

  if (!apiKey && !isLocalDarwinOrigin(origin) && !isLocalDarwinOrigin(liveOrigin)) {
    return json(500, { error: 'DARWIN_API_KEY is not configured' })
  }

  if (ukOnly) {
    const country = detectCountryCode(request)
    // Localhost never receives Cloudflare/Netlify geo headers. Production still
    // fails closed when the country is missing or not the UK.
    const allowMissingCountry = process.env.NODE_ENV !== 'production' && !country
    if (!allowMissingCountry && (!country || !ukAllowedCountries.has(country))) {
      return json(451, {
        error: 'regional_restriction',
        message: 'Darwin realtime API is only available in the UK.',
        country: country || 'unknown',
      })
    }
  }

  const splat = pathSegments.length > 0 ? pathSegments.join('/') : 'health'
  const isAdminPath = pathSegments[0] === 'admin'
  if (isAdminPath) {
    const gate = await requireDarwinAdmin(request)
    if (gate && !gate.ok) {
      return json(401, { error: 'unauthorized', message: gate.error })
    }
  }
  const upstream = new URL(`${origin}/api/${splat}${request.nextUrl.search}`)

  const headers = new Headers()
  if (apiKey) headers.set('X-API-Key', apiKey)
  const accept = request.headers.get('accept')
  if (accept) headers.set('Accept', accept)
  const contentType = request.headers.get('content-type')
  if (contentType) headers.set('Content-Type', contentType)

  try {
    headers.set('Accept-Encoding', 'identity')
    const method = request.method
    const hasBody = method !== 'GET' && method !== 'HEAD'
    const upstreamRes = await undiciFetch(upstream, {
      method,
      headers,
      body: hasBody ? (request.body as never) : undefined,
      signal: AbortSignal.timeout(darwinUpstreamTimeoutMs(request, pathSegments)),
      dispatcher: darwinUpstreamAgent,
      ...(hasBody ? { duplex: 'half' as const } : {}),
    })

    const responseHeaders = new Headers()
    const contentType = upstreamRes.headers.get('content-type')
    if (contentType) responseHeaders.set('content-type', contentType)
    applyDarwinCacheHeaders(responseHeaders, request, pathSegments, upstreamRes.ok)
    const retryAfter = upstreamRes.headers.get('retry-after')
    if (retryAfter) responseHeaders.set('Retry-After', retryAfter)

    return new NextResponse(upstreamRes.body as BodyInit | null, {
      status: upstreamRes.status,
      headers: responseHeaders,
    })
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return json(504, { error: 'upstream_timeout', message: 'Darwin upstream timed out' })
    }
    const cause = err instanceof Error ? err.cause : null
    const code = cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code?: string }).code) : ''
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
      return json(503, {
        error: 'starting',
        retryAfterSec: 3,
        message: 'Darwin daemon is not reachable',
      })
    }
    const message = err instanceof Error ? err.message : 'Darwin upstream fetch failed'
    return json(500, { error: 'upstream_fetch_failed', message })
  }
}

export const maxDuration = 60

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  return proxyDarwin(request, path ?? [])
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  return proxyDarwin(request, path ?? [])
}

export async function HEAD(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params
  return proxyDarwin(request, path ?? [])
}
