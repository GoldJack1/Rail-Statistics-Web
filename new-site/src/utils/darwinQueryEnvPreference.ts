import { isBetaSite } from '@/utils/localDevFlags'

export type DarwinQueryEnv = 'live' | 'dev'

export const DARWIN_QUERY_ENV_COOKIE = 'rs-darwin-query-env'
export const PUBLIC_DARWIN_LIVE_ORIGIN = 'https://api-raildata.railstatistics.co.uk'
export const PUBLIC_DARWIN_DEV_ORIGIN = 'https://api-dev.railstatistics.co.uk'

export function parseDarwinQueryEnv(raw: string | undefined | null): DarwinQueryEnv | null {
  const value = String(raw || '').trim().toLowerCase()
  if (value === 'live' || value === 'dev') return value
  return null
}

export function defaultDarwinQueryEnvForSite(): DarwinQueryEnv {
  return isBetaSite() ? 'dev' : 'live'
}

export function readDarwinQueryEnvFromCookieHeader(cookieHeader: string | undefined | null): DarwinQueryEnv | null {
  if (!cookieHeader) return null
  const parts = cookieHeader.split(';')
  for (const part of parts) {
    const [name, ...rest] = part.trim().split('=')
    if (name === DARWIN_QUERY_ENV_COOKIE) {
      return parseDarwinQueryEnv(rest.join('='))
    }
  }
  return null
}

export function readDarwinQueryEnvPreference(): DarwinQueryEnv {
  const fallback = defaultDarwinQueryEnvForSite()
  if (!isBetaSite()) return fallback
  if (typeof document === 'undefined') return fallback
  return readDarwinQueryEnvFromCookieHeader(document.cookie) || fallback
}

export function writeDarwinQueryEnvPreference(env: DarwinQueryEnv) {
  if (typeof document === 'undefined') return
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${DARWIN_QUERY_ENV_COOKIE}=${env}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`
}
