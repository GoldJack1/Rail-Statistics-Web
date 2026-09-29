/**
 * Darwin daemon may return 503 { error: 'starting' } while caches restore after restart.
 * This wrapper waits with backoff instead of hammering the VM or surfacing a hard error.
 *
 * Off localhost the production site calls api-raildata (Cloudflare → Caddy). Local `next dev`
 * still uses same-origin `/api/darwin`. Admin routes stay on the Next proxy.
 */

const MAX_STARTUP_WAIT_MS = Math.max(
  60_000,
  Number(process.env.NEXT_PUBLIC_DARWIN_STARTUP_MAX_WAIT_MS || 600_000),
)

const GATEWAY_RETRY_DELAY_MS = 1_500
const MAX_GATEWAY_RETRIES = 5

export const PUBLIC_DARWIN_ORIGIN = 'https://api-raildata.railstatistics.co.uk'

function isLocalHostname(host: string): boolean {
  return host === 'localhost' || host === '127.0.0.1' || host === '::1'
}

function abortError(): Error {
  const e = new Error('Aborted')
  e.name = 'AbortError'
  return e
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError())
    const t = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(t)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function shouldUseDirectDarwinHost(): boolean {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (isLocalHostname(host)) return false
    if (host === 'railstatistics.co.uk' || host === 'www.railstatistics.co.uk') return true
    return Boolean((process.env.NEXT_PUBLIC_DARWIN_BROWSER_ORIGIN || '').trim())
  }
  return process.env.NODE_ENV === 'production'
}

function isHeavyDarwinBrowserPath(input: string): boolean {
  const qIndex = input.indexOf('?')
  const path = qIndex >= 0 ? input.slice(0, qIndex) : input
  const query = qIndex >= 0 ? input.slice(qIndex) : ''
  if (
    path.includes('/history') ||
    path.includes('/units') ||
    path.includes('/unit/') ||
    path.includes('/plan/')
  ) {
    return true
  }
  return /(?:^|[?&])date=/.test(query)
}

/** Map `/api/darwin/...` to the public Darwin host (Cloudflare) off localhost. */
export function resolveDarwinBrowserUrl(input: string): string {
  if (!input.startsWith('/api/darwin')) return input
  if (input.startsWith('/api/darwin/admin')) return input
  // Dated/heavy boards: stay on the Next proxy. Safari surfaces Caddy 504s
  // (no CORS headers) as TypeError "Load failed" instead of a readable 504.
  if (isHeavyDarwinBrowserPath(input)) return input
  if (!shouldUseDirectDarwinHost()) return input
  const origin = (process.env.NEXT_PUBLIC_DARWIN_BROWSER_ORIGIN || PUBLIC_DARWIN_ORIGIN).replace(/\/$/, '')
  return origin + input.replace(/^\/api\/darwin(?=\/|$)/, '/api')
}

function isTransientFetchFailure(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name === 'AbortError') return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('load failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error')
  )
}

/**
 * GET helper for `/api/darwin/*`. Retries on 503 starting until deadline or signal abort.
 */
export async function fetchDarwin(input: string, init?: RequestInit): Promise<Response> {
  const url = resolveDarwinBrowserUrl(input)
  const dated = isHeavyDarwinBrowserPath(input)
  const deadline = Date.now() + MAX_STARTUP_WAIT_MS
  const softDeadline = Date.now() + 20_000
  let lastRes: Response | null = null

  let gatewayRetries = 0

  while (Date.now() < deadline) {
    if (init?.signal?.aborted) throw abortError()

    let res: Response
    try {
      res = await fetch(url, dated ? { ...init, cache: 'no-store' } : init)
    } catch (err) {
      if (init?.signal?.aborted) throw abortError()
      if (dated && gatewayRetries < MAX_GATEWAY_RETRIES && isTransientFetchFailure(err)) {
        gatewayRetries += 1
        await sleep(GATEWAY_RETRY_DELAY_MS, init?.signal ?? undefined)
        continue
      }
      throw err
    }
    lastRes = res

    // Caddy kills slow overlay rebuilds at ~25s TTFB. The daemon often finishes
    // shortly after; retry like Realtime Trains waiting on a cold day board.
    if (res.status === 504 && gatewayRetries < MAX_GATEWAY_RETRIES) {
      gatewayRetries += 1
      await sleep(GATEWAY_RETRY_DELAY_MS, init?.signal ?? undefined)
      continue
    }

    if (res.status !== 503 && res.status !== 429) return res

    let retryMs = 3000
    let kind: 'startup' | 'soft' | 'other' = 'other'
    try {
      const body = await res.clone().json() as { error?: string; retryAfterSec?: number }
      const err = body?.error || ''
      if (err === 'starting' || err === 'reloading') kind = 'startup'
      else if (err === 'overlay_busy' || err === 'rate_limited') kind = 'soft'
      else return res
      if (typeof body.retryAfterSec === 'number' && Number.isFinite(body.retryAfterSec)) {
        retryMs = Math.min(15_000, Math.max(800, body.retryAfterSec * 1000))
      } else if (kind === 'soft') {
        retryMs = 2000
      }
    } catch {
      return res
    }

    if (kind === 'soft' && Date.now() >= softDeadline) return res

    await sleep(retryMs, init?.signal ?? undefined)
  }

  return lastRes ?? fetch(url, init)
}
