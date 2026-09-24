import type { User } from '@/services/firebase'
import { isMasterPublishUser } from '@/utils/masterPublishPolicy'

/** Signed-in viewers who may use Darwin departures / units / bash / API status, but not station admin. */
export const DARWIN_PREVIEW_EMAILS = [
  'hello@emilychomicz.com',
  '04richwin@gmail.com',
] as const

export function normalizeEmail(email: string | null | undefined): string {
  return String(email || '').trim().toLowerCase()
}

export function isDarwinPreviewUser(user: { email?: string | null } | null | undefined): boolean {
  const email = normalizeEmail(user?.email)
  return email.length > 0 && (DARWIN_PREVIEW_EMAILS as readonly string[]).includes(email)
}

/** Full station/admin UI (owner). */
export function isFullSiteAdmin(user: User | { email?: string | null } | null | undefined): boolean {
  return isMasterPublishUser((user ?? null) as User | null)
}

export function canUseDarwinTools(user: { email?: string | null } | null | undefined): boolean {
  return isFullSiteAdmin(user as User | null) || isDarwinPreviewUser(user)
}

/** After staff login: preview / non-admin users land on departures. */
export function postLoginPath(
  user: { email?: string | null } | null | undefined,
  from?: string | null
): string {
  const dest = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : null
  const preview = isDarwinPreviewUser(user)
  const admin = isFullSiteAdmin(user as User | null)

  if (dest) {
    const isAdminTool =
      dest.startsWith('/admin') &&
      dest !== '/admin/api-status' &&
      !dest.startsWith('/admin/api-status/')
    if (isAdminTool && !admin) {
      return preview || canUseDarwinTools(user) ? '/departures' : dest
    }
    return dest
  }

  if (preview) return '/departures'
  return '/admin/stations'
}
