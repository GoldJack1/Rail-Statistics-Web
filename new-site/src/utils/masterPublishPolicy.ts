import type { User } from '@/services/firebase'

/**
 * Default owner email for publish/schedule UI gating. Override with `NEXT_PUBLIC_MASTER_PUBLISH_EMAIL`.
 *
 * **Firestore:** writes are enforced in `firestore.rules` via the same default email OR custom claim
 * `rs_station_editor` (see `docs/SECURITY_FIRESTORE.md`). Changing only this env var does not update rules.
 */
const DEFAULT_MASTER_PUBLISH_EMAIL = 'wingatejack2021@gmail.com'

export function getMasterPublishEmail(): string {
  const raw = process.env.NEXT_PUBLIC_MASTER_PUBLISH_EMAIL ?? DEFAULT_MASTER_PUBLISH_EMAIL
  return String(raw).trim().toLowerCase()
}

function tokenHasStationEditorClaim(user: User | null): boolean {
  if (!user) return false
  const token = user as User & { accessToken?: string }
  // Prefer decoded claims from getIdTokenResult when callers pass them via (user as any).__claims
  const claims = (user as User & { rsStationEditorClaim?: boolean }).rsStationEditorClaim
  if (typeof claims === 'boolean') return claims
  void token
  return false
}

/** True if email matches the configured master publish owner. */
export function isMasterPublishEmailUser(user: User | null): boolean {
  const expected = getMasterPublishEmail()
  if (!expected) return false
  const email = user?.email?.trim().toLowerCase() ?? ''
  return email.length > 0 && email === expected
}

/**
 * True if this signed-in user may use admin chrome / publish.
 * Matches Firestore rules: custom claim `rs_station_editor` OR owner email.
 */
export function isStationEditorUser(
  user: User | null,
  options?: { hasEditorClaim?: boolean }
): boolean {
  if (!user) return false
  if (options?.hasEditorClaim === true) return true
  if (tokenHasStationEditorClaim(user)) return true
  return isMasterPublishEmailUser(user)
}

/** @deprecated Prefer isStationEditorUser — kept for publish/schedule call sites. */
export function isMasterPublishUser(user: User | null): boolean {
  return isStationEditorUser(user)
}

export const MASTER_PUBLISH_DENIED_MESSAGE =
  'Only the site owner can publish or schedule changes to the database. Sign in with the owner account.'

export const STATION_EDITOR_DENIED_MESSAGE =
  'This account is signed in but is not a station editor. Contact the site owner if you need access.'
