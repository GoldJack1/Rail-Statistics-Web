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

/** Map `/api/darwin/...` to the public Darwin host (Cloudflare) off localhost. */
export function resolveDarwinBrowserUrl(input: string): string {
  if (!input.startsWith('/api/darwin')) return input
  if (input.startsWith('/api/darwin/admin')) return input
  if (!shouldUseDirectDarwinHost()) return input
  const origin = (process.env.NEXT_PUBLIC_DARWIN_BROWSER_ORIGIN || PUBLIC_DARWIN_ORIGIN).replace(/\/$/, '')
  return origin + input.replace(/^\/api\/darwin(?=\/|$)/, '/api')
}

/**
 * GET helper for `/api/darwin/*`. Retries on 503 starting until deadline or signal abort.
 */
export async function fetchDarwin(input: string, init?: RequestInit): Promise<Response> {
  const url = resolveDarwinBrowserUrl(input)
  const deadline = Date.now() + MAX_STARTUP_WAIT_MS
  /** overlay_busy/429 used to retry for 20s and felt like 10s per historical click. */
  const softDeadline = Date.now() + 800
  let lastRes: Response | null = null

  while (Date.now() < deadline) {
    if (init?.signal?.aborted) throw abortError()

    const res = await fetch(url, init)
    lastRes = res

    if (res.status !== 503 && res.status !== 429) return res

    let retryMs = 3000
    let kind: 'startup' | 'soft' | 'other' = 'other'
    try {
      const body = await res.clone().json() as { error?: string; retryAfterSec?: number }
      const err = body?.error || ''
      if (err === 'starting' || err === 'reloading') kind = 'startup'
      else if (err === 'overlay_busy' || err === 'rate_limited') kind = 'soft'
      else return res
      if (kind === 'soft') {
        retryMs = 400
      } else if (typeof body.retryAfterSec === 'number' && Number.isFinite(body.retryAfterSec)) {
        retryMs = Math.min(15_000, Math.max(800, body.retryAfterSec * 1000))
      }
    } catch {
      return res
    }

    if (kind === 'soft' && Date.now() >= softDeadline) return res

    await sleep(retryMs, init?.signal ?? undefined)
  }

  return lastRes ?? fetch(url, init)
}
