/**
 * Site-wide cold-visitor performance routing.
 *
 * Auth / App Check / gtag stay eager only where sign-in is required.
 * Everything else defers third-party JS until a real user gesture (or idle footer).
 */

/** Routes that must initialize catalogue Auth + App Check immediately. */
export function isAuthCriticalPath(pathname: string): boolean {
  return pathname === '/log-in' || pathname.startsWith('/admin')
}

/** Routes that must initialize consumer (UAs) Auth immediately. */
export function isConsumerAuthCriticalPath(pathname: string): boolean {
  return (
    pathname.startsWith('/account') ||
    pathname.startsWith('/leaderboards') ||
    pathname.startsWith('/stations')
  )
}

/** Public marketing + product pages — keep reCAPTCHA / gtag off the LCP path. */
export function isColdVisitorDeferPath(pathname: string): boolean {
  return !isAuthCriticalPath(pathname) && !isConsumerAuthCriticalPath(pathname)
}

/** Exact public stations browse list. */
export function isPublicStationsListPath(pathname: string): boolean {
  return pathname === '/stations'
}

/**
 * Public station detail: `/stations/{network}/{slug}`
 * Excludes list, map, and edit redirects.
 */
export function isPublicStationDetailPath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  if (parts[0] !== 'stations') return false
  if (parts.length !== 3) return false
  if (parts[1] === 'map') return false
  return true
}

/** @deprecated Prefer isColdVisitorDeferPath — kept for stations-specific CDN bootstrap. */
export function isPublicStationsBrowsePath(pathname: string): boolean {
  return isPublicStationsListPath(pathname) || isPublicStationDetailPath(pathname)
}
