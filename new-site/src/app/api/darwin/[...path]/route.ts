import { NextRequest, NextResponse } from 'next/server'
import { requireDarwinAdmin } from '@/app/api/darwin/_lib/requireDarwinAdmin'
import { isLocalDarwinOrigin, resolveDarwinApiOrigin } from '@/utils/darwinApiOrigin'

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status })
}

function boolEnv(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
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
  const origin = resolveDarwinApiOrigin()
  const apiKey = process.env.DARWIN_API_KEY || ''
  const ukOnly = boolEnv(process.env.DARWIN_UK_ONLY)
  const ukAllowedCountries = new Set(['GB', 'UK'])

  if (!apiKey && !isLocalDarwinOrigin(origin)) {
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
    const upstreamRes = await fetch(upstream, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
      // @ts-expect-error duplex required for streaming bodies in Node 18+
      duplex: 'half',
    })

    // Node decompresses the body. Do not forward hop-by-hop / encoding headers
    // (Caddy gzip + transfer-encoding made Safari show "Load failed").
    const responseHeaders = new Headers()
    const contentType = upstreamRes.headers.get('content-type')
    if (contentType) responseHeaders.set('content-type', contentType)
    const cacheControl = upstreamRes.headers.get('cache-control')
    if (cacheControl) responseHeaders.set('cache-control', cacheControl)

    return new NextResponse(upstreamRes.body, {
      status: upstreamRes.status,
      headers: responseHeaders,
    })
  } catch (err) {
    const cause = err instanceof Error ? err.cause : null
    const code = cause && typeof cause === 'object' && 'code' in cause ? String((cause as { code?: string }).code) : ''
    if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT') {
      return json(503, {
        error: 'starting',
        retryAfterSec: 3,
        message: 'Darwin daemon is not reachable on :4001',
      })
    }
    throw err
  }
}

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
