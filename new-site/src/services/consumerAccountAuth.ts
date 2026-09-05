/**
 * Consumer account Auth/Firestore operations on rail-statistics-uas.
 */
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  verifyPasswordResetCode,
  confirmPasswordReset,
  updatePassword,
  reload,
  EmailAuthProvider,
  reauthenticateWithCredential,
  verifyBeforeUpdateEmail,
  getMultiFactorResolver,
  multiFactor,
  TotpMultiFactorGenerator,
  type User,
  type MultiFactorResolver,
  type TotpSecret,
} from 'firebase/auth'
import { SITE_URL } from '@/lib/site'
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  Timestamp,
  type Firestore,
} from 'firebase/firestore'
import {
  CURRENT_TERMS_VERSION,
  isValidUsername,
  normalizeUsername,
  type UserAccountProfile,
} from '@/services/accountModels'
import {
  ensureUserAccountsFirebase,
  ensureUasAppCheck,
  getUasAuth,
} from '@/services/userAccountsFirebase'
import {
  generateRecoveryKeyDisplayString,
  generateVaultKeyBytes,
  wrapVaultKey,
  unwrapVaultKey,
  bytesToBase64,
  base64ToBytes,
} from '@/services/vaultCrypto'
import {
  isVaultUnlocked,
  lockVaultKey,
  setUnlockedVaultKey,
} from '@/services/vaultKeyStore'
import {
  isMultiFactorAuthRequiredError,
  mapTotpMfaError,
  TOTP_ISSUER_NAME,
  userHasEnrolledTotpMfa,
  userMustEnrollTotpMfaOnFirebase,
} from '@/services/firebaseTotpMfa'
import { handleSignedOutSync, reconcileAfterUnlock } from '@/services/encryptedVaultSync'

export class ConsumerAccountError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'ConsumerAccountError'
  }
}

function tsToDate(value: unknown): Date {
  if (value instanceof Timestamp) return value.toDate()
  if (value instanceof Date) return value
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value)
    if (!Number.isNaN(d.getTime())) return d
  }
  return new Date(0)
}

export function encodeProfile(p: UserAccountProfile): Record<string, unknown> {
  return {
    email: p.email,
    displayName: p.displayName,
    username: p.username,
    usernameLower: p.usernameLower,
    acceptedAgeGateAt: Timestamp.fromDate(p.acceptedAgeGateAt),
    acceptedTermsAt: Timestamp.fromDate(p.acceptedTermsAt),
    termsVersion: p.termsVersion,
    recoveryKeyWrappedVaultKeyBase64: p.recoveryKeyWrappedVaultKeyBase64,
    avatarURL: p.avatarURL,
    leaderboardsOptIn: p.leaderboardsOptIn,
    leaderboardsShowOnAllNetworks: p.leaderboardsShowOnAllNetworks,
    leaderboardsEnabledNetworkIDs: p.leaderboardsEnabledNetworkIDs,
    leaderboardsShowDisplayName: p.leaderboardsShowDisplayName,
    createdAt: Timestamp.fromDate(p.createdAt),
  }
}

export function decodeProfile(uid: string, data: Record<string, unknown>): UserAccountProfile {
  return {
    uid,
    email: String(data.email ?? ''),
    displayName: String(data.displayName ?? ''),
    username: String(data.username ?? ''),
    usernameLower: String(data.usernameLower ?? ''),
    acceptedAgeGateAt: tsToDate(data.acceptedAgeGateAt),
    acceptedTermsAt: tsToDate(data.acceptedTermsAt),
    termsVersion: String(data.termsVersion ?? ''),
    recoveryKeyWrappedVaultKeyBase64:
      typeof data.recoveryKeyWrappedVaultKeyBase64 === 'string'
        ? data.recoveryKeyWrappedVaultKeyBase64
        : null,
    avatarURL: typeof data.avatarURL === 'string' ? data.avatarURL : null,
    leaderboardsOptIn: Boolean(data.leaderboardsOptIn),
    leaderboardsShowOnAllNetworks: Boolean(data.leaderboardsShowOnAllNetworks),
    leaderboardsEnabledNetworkIDs: Array.isArray(data.leaderboardsEnabledNetworkIDs)
      ? data.leaderboardsEnabledNetworkIDs.map(String)
      : [],
    leaderboardsShowDisplayName: Boolean(data.leaderboardsShowDisplayName),
    createdAt: tsToDate(data.createdAt),
  }
}

const PROFILE_LOAD_TIMEOUT_MS = 8_000

export async function loadProfile(uid: string): Promise<UserAccountProfile | null> {
  const { db } = await ensureUserAccountsFirebase()
  const snap = await Promise.race([
    getDoc(doc(db, 'profiles', uid)),
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error('Profile load timed out')), PROFILE_LOAD_TIMEOUT_MS)
    }),
  ])
  if (!snap.exists()) return null
  return decodeProfile(uid, snap.data() as Record<string, unknown>)
}

export async function saveProfile(profile: UserAccountProfile): Promise<void> {
  const { db } = await ensureUserAccountsFirebase()
  await setDoc(doc(db, 'profiles', profile.uid), encodeProfile(profile), { merge: true })
}

export type SignUpInput = {
  displayName: string
  email: string
  password: string
  username: string
  isOver13: boolean
  acceptedLegal: boolean
}

export async function signUpConsumer(input: SignUpInput): Promise<{ recoveryKey: string; user: User }> {
  await ensureUserAccountsFirebase()
  await ensureUasAppCheck()
  const auth = getUasAuth()
  if (!auth) throw new ConsumerAccountError('User accounts are not configured.', 'not-configured')

  if (!input.isOver13) throw new ConsumerAccountError('You must be 13 or older to create an account.')
  if (!input.acceptedLegal) throw new ConsumerAccountError('Accept the Privacy Policy and EULA to continue.')
  const email = input.email.trim()
  const displayName = input.displayName.trim()
  const username = input.username.trim()
  if (!displayName) throw new ConsumerAccountError('Enter a display name.')
  if (!isValidUsername(username)) {
    throw new ConsumerAccountError('Username must be 3–24 characters: letters, numbers, and underscores only (no spaces).')
  }
  if (input.password.length < 8) throw new ConsumerAccountError('Password must be at least 8 characters.')

  const { db } = await ensureUserAccountsFirebase()
  const usernameLower = normalizeUsername(username)
  const usernameRef = doc(db, 'usernames', usernameLower)

  const result = await createUserWithEmailAndPassword(auth, email, input.password)
  await result.user.getIdToken()

  const vaultKey = generateVaultKeyBytes()
  const recoveryDisplay = generateRecoveryKeyDisplayString()
  const wrapped = await wrapVaultKey(vaultKey, recoveryDisplay)
  const now = new Date()
  const profile: UserAccountProfile = {
    uid: result.user.uid,
    email,
    displayName,
    username,
    usernameLower,
    acceptedAgeGateAt: now,
    acceptedTermsAt: now,
    termsVersion: CURRENT_TERMS_VERSION,
    recoveryKeyWrappedVaultKeyBase64: bytesToBase64(wrapped),
    avatarURL: null,
    leaderboardsOptIn: false,
    leaderboardsShowOnAllNetworks: false,
    leaderboardsEnabledNetworkIDs: [],
    leaderboardsShowDisplayName: false,
    createdAt: now,
  }

  try {
    const existing = await getDoc(usernameRef)
    if (existing.exists()) {
      await result.user.delete()
      throw new ConsumerAccountError('That username is already taken.', 'username-taken')
    }
    await setDoc(usernameRef, { uid: result.user.uid, username })
    await setDoc(doc(db, 'profiles', result.user.uid), encodeProfile(profile))
  } catch (e) {
    if (e instanceof ConsumerAccountError && e.code === 'username-taken') throw e
    try {
      await result.user.delete()
    } catch {
      /* ignore */
    }
    throw e instanceof ConsumerAccountError
      ? e
      : new ConsumerAccountError(e instanceof Error ? e.message : 'Could not create account.')
  }

  setUnlockedVaultKey(vaultKey, { uid: result.user.uid, rememberDevice: true })
  try {
    await sendEmailVerification(result.user)
  } catch {
    /* continue — user can resend */
  }
  return { recoveryKey: recoveryDisplay, user: result.user }
}

export type SignInResult =
  | { kind: 'signedIn'; user: User }
  | { kind: 'mfaRequired'; resolver: MultiFactorResolver }

export async function signInConsumer(email: string, password: string): Promise<SignInResult> {
  await ensureUserAccountsFirebase()
  await ensureUasAppCheck()
  const auth = getUasAuth()
  if (!auth) throw new ConsumerAccountError('User accounts are not configured.')

  try {
    const result = await signInWithEmailAndPassword(auth, email.trim(), password)
    return { kind: 'signedIn', user: result.user }
  } catch (err) {
    if (isMultiFactorAuthRequiredError(err)) {
      const resolver = getMultiFactorResolver(auth, err as Parameters<typeof getMultiFactorResolver>[1])
      return { kind: 'mfaRequired', resolver }
    }
    throw new ConsumerAccountError(friendlyAuthError(err))
  }
}

export async function completeConsumerMfaSignIn(
  resolver: MultiFactorResolver,
  code: string
): Promise<User> {
  const trimmed = code.trim()
  if (trimmed.length < 6) throw new ConsumerAccountError('Enter the 6-digit authenticator code.')
  const hint =
    resolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) ?? resolver.hints[0]
  if (!hint) throw new ConsumerAccountError('No authenticator is enrolled on this account.')
  try {
    const assertion = TotpMultiFactorGenerator.assertionForSignIn(hint.uid, trimmed)
    const cred = await resolver.resolveSignIn(assertion)
    return cred.user
  } catch (err) {
    throw new ConsumerAccountError(mapTotpMfaError(err))
  }
}

export async function signOutConsumer(): Promise<void> {
  await ensureUserAccountsFirebase()
  const auth = getUasAuth()
  lockVaultKey()
  handleSignedOutSync()
  if (auth) await signOut(auth)
}

export async function unlockVaultWithRecovery(
  profile: UserAccountProfile,
  recoveryKey: string,
  options?: { rememberDevice?: boolean }
): Promise<void> {
  let wrappedB64 = profile.recoveryKeyWrappedVaultKeyBase64
  if (!wrappedB64) {
    // Profile may have been skipped on a timed-out load — fetch fresh.
    const fresh = await loadProfile(profile.uid)
    wrappedB64 = fresh?.recoveryKeyWrappedVaultKeyBase64 ?? null
  }
  if (!wrappedB64) throw new ConsumerAccountError('No cloud sync recovery data on this account.')
  const vaultKey = await unwrapVaultKey(base64ToBytes(wrappedB64), recoveryKey)
  setUnlockedVaultKey(vaultKey, {
    uid: profile.uid,
    rememberDevice: Boolean(options?.rememberDevice),
  })
  await reconcileAfterUnlock(profile.uid)
}

export async function resendConsumerEmailVerification(user: User): Promise<void> {
  await sendEmailVerification(user)
}

export async function reloadConsumerUser(user: User): Promise<User> {
  await reload(user)
  return user
}

export async function startTotpEnrollment(user: User): Promise<{ secret: TotpSecret; qrUrl: string; secretKey: string }> {
  if (!user.emailVerified) {
    throw new ConsumerAccountError('Verify your email before you can set up an authenticator.')
  }
  const session = await multiFactor(user).getSession()
  const secret = await TotpMultiFactorGenerator.generateSecret(session)
  const accountLabel = user.email?.trim() || user.uid
  const qrUrl = secret.generateQrCodeUrl(accountLabel, TOTP_ISSUER_NAME)
  return { secret, qrUrl, secretKey: secret.secretKey }
}

export async function finalizeTotpEnrollment(
  user: User,
  secret: TotpSecret,
  code: string
): Promise<void> {
  try {
    const assertion = TotpMultiFactorGenerator.assertionForEnrollment(secret, code.trim())
    await multiFactor(user).enroll(assertion, 'Authenticator')
  } catch (err) {
    throw new ConsumerAccountError(mapTotpMfaError(err))
  }
}

function passwordResetContinueUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/account/sign-in`
  }
  return `${SITE_URL}/account/sign-in`
}

/** Prefer this action URL in Firebase Console → Authentication → Templates → Password reset. */
export function passwordResetActionUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/account/reset-password`
  }
  return `${SITE_URL}/account/reset-password`
}

export async function sendConsumerPasswordReset(email: string): Promise<void> {
  await ensureUserAccountsFirebase()
  const auth = getUasAuth()
  if (!auth) throw new ConsumerAccountError('User accounts are not configured.')
  try {
    await sendPasswordResetEmail(auth, email.trim(), {
      url: passwordResetContinueUrl(),
      handleCodeInApp: false,
    })
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
    if (code === 'auth/invalid-email') throw new ConsumerAccountError('Enter a valid email address.', code)
    if (code === 'auth/user-not-found') {
      // Don't reveal whether the email exists.
      return
    }
    throw new ConsumerAccountError(
      err instanceof Error ? err.message : 'Could not send password reset email.',
      code || undefined
    )
  }
}

export async function verifyConsumerPasswordResetCode(oobCode: string): Promise<string> {
  await ensureUserAccountsFirebase()
  const auth = getUasAuth()
  if (!auth) throw new ConsumerAccountError('User accounts are not configured.')
  try {
    return await verifyPasswordResetCode(auth, oobCode)
  } catch {
    throw new ConsumerAccountError('This reset link is invalid or has expired. Request a new one.')
  }
}

export async function confirmConsumerPasswordReset(
  oobCode: string,
  newPassword: string
): Promise<void> {
  if (newPassword.length < 8) throw new ConsumerAccountError('Password must be at least 8 characters.')
  await ensureUserAccountsFirebase()
  const auth = getUasAuth()
  if (!auth) throw new ConsumerAccountError('User accounts are not configured.')
  try {
    await confirmPasswordReset(auth, oobCode, newPassword)
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
    if (code === 'auth/weak-password') {
      throw new ConsumerAccountError('Choose a stronger password (at least 8 characters).', code)
    }
    if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
      throw new ConsumerAccountError('This reset link is invalid or has expired. Request a new one.', code)
    }
    throw new ConsumerAccountError(
      err instanceof Error ? err.message : 'Could not reset password.',
      code || undefined
    )
  }
}

export async function changeConsumerPassword(
  user: User,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  if (newPassword.length < 8) throw new ConsumerAccountError('Password must be at least 8 characters.')
  const email = user.email
  if (!email) throw new ConsumerAccountError('Your account has no email on file.')
  const cred = EmailAuthProvider.credential(email, currentPassword)
  await reauthenticateWithCredential(user, cred)
  await updatePassword(user, newPassword)
}

export async function requestConsumerEmailChange(
  user: User,
  password: string,
  newEmail: string
): Promise<void> {
  const email = user.email
  if (!email) throw new ConsumerAccountError('Your account has no email on file.')
  const cred = EmailAuthProvider.credential(email, password)
  await reauthenticateWithCredential(user, cred)
  await verifyBeforeUpdateEmail(user, newEmail.trim())
}

export async function updateDisplayNameAndUsername(
  profile: UserAccountProfile,
  displayName: string,
  username: string
): Promise<UserAccountProfile> {
  const { db } = await ensureUserAccountsFirebase()
  const name = displayName.trim()
  const user = username.trim()
  if (!name) throw new ConsumerAccountError('Enter a display name.')
  if (!isValidUsername(user)) {
    throw new ConsumerAccountError('Username must be 3–24 characters: letters, numbers, and underscores only (no spaces).')
  }
  const newLower = normalizeUsername(user)
  const oldLower = profile.usernameLower
  if (newLower !== oldLower) {
    const newRef = doc(db, 'usernames', newLower)
    const existing = await getDoc(newRef)
    if (existing.exists() && existing.data()?.uid !== profile.uid) {
      throw new ConsumerAccountError('That username is already taken.', 'username-taken')
    }
    await setDoc(newRef, { uid: profile.uid, username: user })
  }
  const next: UserAccountProfile = {
    ...profile,
    displayName: name,
    username: user,
    usernameLower: newLower,
  }
  await setDoc(doc(db, 'profiles', profile.uid), encodeProfile(next), { merge: true })
  if (newLower !== oldLower && oldLower) {
    try {
      await deleteDoc(doc(db, 'usernames', oldLower))
    } catch {
      /* best-effort */
    }
  }
  return next
}

export async function updateLeaderboardPrefs(
  profile: UserAccountProfile,
  prefs: Pick<
    UserAccountProfile,
    | 'leaderboardsOptIn'
    | 'leaderboardsShowOnAllNetworks'
    | 'leaderboardsEnabledNetworkIDs'
    | 'leaderboardsShowDisplayName'
  >
): Promise<UserAccountProfile> {
  const next = { ...profile, ...prefs }
  await saveProfile(next)
  return next
}

export function consumerNeedsEmailVerify(user: User): boolean {
  return !user.emailVerified
}

export function consumerNeedsTotpEnroll(user: User): boolean {
  return userMustEnrollTotpMfaOnFirebase(user)
}

export function consumerHasTotp(user: User): boolean {
  return userHasEnrolledTotpMfa(user)
}

export function consumerVaultUnlocked(): boolean {
  return isVaultUnlocked()
}

function friendlyAuthError(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    const code = String((err as { code: string }).code)
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/user-not-found') {
      return 'Email or password is incorrect.'
    }
    if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later.'
    if (code === 'auth/email-already-in-use') return 'An account already exists with that email.'
  }
  return err instanceof Error ? err.message : 'Sign-in failed.'
}

export type { Firestore, TotpSecret, MultiFactorResolver, User }
