/** Dev-only: skip catalogue login on `/admin/*` (see ProtectedRoute). */
export function isLocalDevLoginBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_LOCAL_DEV_LOGIN_BYPASS === 'true'
  )
}

/** Show Departures / Units / Bash without requiring a signed-in admin. */
export function areDarwinNavPagesEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DARWIN_PAGES_ENABLED === 'true') return true
  return isLocalDevLoginBypassEnabled()
}
