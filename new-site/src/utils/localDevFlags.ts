/** Dev-only: skip catalogue login on `/admin/*` (see ProtectedRoute). */
export function isLocalDevLoginBypassEnabled(): boolean {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_LOCAL_DEV_LOGIN_BYPASS === 'true'
  )
}
