import dns from 'node:dns'

dns.setDefaultResultOrder('ipv4first')

export function resolveDarwinApiOrigin(): string {
  const fromEnv = (process.env.DARWIN_API_ORIGIN || '').trim()
  let origin = fromEnv
    || (process.env.NODE_ENV !== 'production'
      ? 'http://127.0.0.1:4001'
      : 'https://api-raildata.railstatistics.co.uk')
  origin = origin.replace(/\/$/, '')
  try {
    const url = new URL(origin)
    if (url.hostname === 'localhost' || url.hostname === '::1') {
      url.hostname = '127.0.0.1'
      origin = url.origin
    }
  } catch {
    /* keep as-is */
  }
  return origin
}

export function isLocalDarwinOrigin(origin: string): boolean {
  return /127\.0\.0\.1|localhost|::1/.test(origin)
}

export function resolveDarwinHeavyOrigin(liveOrigin = resolveDarwinApiOrigin()): string {
  const fromEnv = (process.env.DARWIN_HEAVY_ORIGIN || '').trim().replace(/\/$/, '')
  if (fromEnv) return fromEnv
  return liveOrigin
}

export function shouldUseDirectHeavyOrigin(liveOrigin: string, heavyOrigin: string): boolean {
  return Boolean(heavyOrigin && heavyOrigin !== liveOrigin)
}
