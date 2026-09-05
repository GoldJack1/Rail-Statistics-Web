'use client'

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { usePathname } from 'next/navigation'
import { onAuthStateChanged, type User } from 'firebase/auth'
import type { UserAccountProfile } from '@/services/accountModels'
import type { MultiFactorResolver, TotpSecret } from '@/services/consumerAccountAuth'
import {
  changeConsumerPassword,
  completeConsumerMfaSignIn,
  consumerHasTotp,
  consumerNeedsEmailVerify,
  consumerNeedsTotpEnroll,
  finalizeTotpEnrollment,
  loadProfile,
  reloadConsumerUser,
  requestConsumerEmailChange,
  resendConsumerEmailVerification,
  saveProfile,
  sendConsumerPasswordReset,
  verifyConsumerPasswordResetCode,
  confirmConsumerPasswordReset,
  signInConsumer,
  signOutConsumer,
  signUpConsumer,
  startTotpEnrollment,
  unlockVaultWithRecovery,
  updateDisplayNameAndUsername,
  updateLeaderboardPrefs,
  type SignUpInput,
} from '@/services/consumerAccountAuth'
import {
  getVaultSyncStatus,
  handleSignedOutSync,
  resolveConflict,
  scheduleDebouncedUpload,
  subscribeVaultSync,
  syncAfterRestore,
  syncNow,
  type SyncConflictContext,
  type SyncStatus,
} from '@/services/encryptedVaultSync'
import { subscribeStationDiary } from '@/services/stationDiaryStore'
import { ensureUserAccountsFirebase, getUasAuth } from '@/services/userAccountsFirebase'
import { isVaultUnlocked, lockVaultKey, restoreRememberedVaultKey, forgetRememberedVaultKey, hasRememberedVaultKey } from '@/services/vaultKeyStore'
import { isConsumerAuthCriticalPath } from '@/utils/coldVisitorPerf'
import type { AccountSyncConflictResolution } from '@/services/accountModels'

const CONSUMER_SESSION_HINT = 'rs-uas-auth-session-hint'

function readConsumerHint(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(CONSUMER_SESSION_HINT) === '1'
  } catch {
    return false
  }
}

function writeConsumerHint(active: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (active) window.localStorage.setItem(CONSUMER_SESSION_HINT, '1')
    else window.localStorage.removeItem(CONSUMER_SESSION_HINT)
  } catch {
    /* ignore */
  }
}

type ConsumerAuthContextValue = {
  user: User | null
  profile: UserAccountProfile | null
  loading: boolean
  vaultUnlocked: boolean
  vaultRememberedOnDevice: boolean
  needsEmailVerify: boolean
  needsTotpEnroll: boolean
  hasTotp: boolean
  syncStatus: SyncStatus
  diaryRevision: number
  pendingMfaResolver: MultiFactorResolver | null
  signUp: (input: SignUpInput) => Promise<string>
  signIn: (email: string, password: string) => Promise<'ok' | 'mfa'>
  completeMfa: (code: string) => Promise<void>
  signOut: () => Promise<void>
  unlockVault: (recoveryKey: string, options?: { rememberDevice?: boolean }) => Promise<void>
  forgetDeviceVault: () => void
  resendVerification: () => Promise<void>
  refreshUser: () => Promise<void>
  beginTotpEnroll: () => Promise<{ secret: TotpSecret; qrUrl: string; secretKey: string }>
  finishTotpEnroll: (secret: TotpSecret, code: string) => Promise<void>
  sendPasswordReset: (email: string) => Promise<void>
  verifyPasswordResetCode: (oobCode: string) => Promise<string>
  confirmPasswordReset: (oobCode: string, newPassword: string) => Promise<void>
  changePassword: (current: string, next: string) => Promise<void>
  requestEmailChange: (password: string, newEmail: string) => Promise<void>
  updateNameUsername: (displayName: string, username: string) => Promise<void>
  updateBoardPrefs: (
    prefs: Pick<
      UserAccountProfile,
      | 'leaderboardsOptIn'
      | 'leaderboardsShowOnAllNetworks'
      | 'leaderboardsEnabledNetworkIDs'
      | 'leaderboardsShowDisplayName'
    >
  ) => Promise<void>
  saveProfileFields: (profile: UserAccountProfile) => Promise<void>
  syncNow: () => Promise<void>
  resolveSyncConflict: (resolution: AccountSyncConflictResolution) => Promise<void>
  noteDiaryChanged: () => void
  pendingConflict: SyncConflictContext | null
}

const ConsumerAuthContext = createContext<ConsumerAuthContextValue | null>(null)

export const ConsumerAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const pathname = usePathname() ?? '/'
  const [user, setUser] = useState<User | null>(null)
  const [profile, setProfile] = useState<UserAccountProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [vaultUnlocked, setVaultUnlocked] = useState(false)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>(getVaultSyncStatus())
  const [diaryRevision, setDiaryRevision] = useState(0)
  const [pendingMfaResolver, setPendingMfaResolver] = useState<MultiFactorResolver | null>(null)

  const consumerCritical = isConsumerAuthCriticalPath(pathname)

  useEffect(() => {
    const unsubSync = subscribeVaultSync(setSyncStatus)
    const unsubDiary = subscribeStationDiary(() => setDiaryRevision((n) => n + 1))
    return () => {
      unsubSync()
      unsubDiary()
    }
  }, [])

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false

    const init = async () => {
      try {
        const { auth: uasAuth } = await ensureUserAccountsFirebase()
        if (cancelled) return
        if (!uasAuth) {
          setLoading(false)
          return
        }

        // Wait for persistence restore so we never leave the hub stuck on "Loading…"
        await uasAuth.authStateReady()
        if (cancelled) return

        const applyUser = async (u: User | null) => {
          setUser(u)
          writeConsumerHint(Boolean(u))
          if (u) {
            const restored = restoreRememberedVaultKey(u.uid)
            setVaultUnlocked(restored || isVaultUnlocked())
            if (restored) {
              void syncAfterRestore(u.uid).catch((err) => {
                console.warn('Vault sync after restore failed:', err)
              })
            }
            try {
              const p = await loadProfile(u.uid)
              if (!cancelled) setProfile(p)
            } catch (profileErr) {
              console.warn('Consumer profile load failed:', profileErr)
              if (!cancelled) setProfile(null)
            }
          } else {
            // Session only — keep localStorage “remember this device” for next sign-in.
            lockVaultKey()
            setProfile(null)
            handleSignedOutSync()
            setVaultUnlocked(false)
          }
        }

        await applyUser(uasAuth.currentUser)
        if (!cancelled) setLoading(false)

        unsubscribe = onAuthStateChanged(uasAuth, (u) => {
          void (async () => {
            try {
              await applyUser(u)
            } finally {
              if (!cancelled) setLoading(false)
            }
          })()
        })
      } catch (e) {
        console.warn('Consumer Auth init failed:', e)
        if (!cancelled) setLoading(false)
      }
    }

    if (consumerCritical || readConsumerHint()) {
      void init()
    } else {
      setLoading(false)
    }

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [consumerCritical])

  const signUp = useCallback(async (input: SignUpInput) => {
    const { recoveryKey, user: u } = await signUpConsumer(input)
    setUser(u)
    setVaultUnlocked(true)
    const p = await loadProfile(u.uid)
    setProfile(p)
    writeConsumerHint(true)
    return recoveryKey
  }, [])

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await signInConsumer(email, password)
    if (result.kind === 'mfaRequired') {
      setPendingMfaResolver(result.resolver)
      return 'mfa'
    }
    setPendingMfaResolver(null)
    setUser(result.user)
    const restored = restoreRememberedVaultKey(result.user.uid)
    setVaultUnlocked(restored || isVaultUnlocked())
    if (restored) {
      void syncAfterRestore(result.user.uid).catch((err) => {
        console.warn('Vault sync after sign-in failed:', err)
      })
    }
    writeConsumerHint(true)
    setLoading(false)
    try {
      const p = await loadProfile(result.user.uid)
      setProfile(p)
    } catch (profileErr) {
      console.warn('Consumer profile load failed after sign-in:', profileErr)
    }
    return 'ok'
  }, [])

  const completeMfa = useCallback(
    async (code: string) => {
      if (!pendingMfaResolver) throw new Error('Authenticator session expired. Sign in again.')
      const u = await completeConsumerMfaSignIn(pendingMfaResolver, code)
      // Ensure enrolled-factor metadata is present before hub MFA checks.
      try {
        await reloadConsumerUser(u)
      } catch {
        /* continue with signed-in user */
      }
      const fresh = getUasAuth()?.currentUser ?? u
      setPendingMfaResolver(null)
      setUser(fresh)
      const restored = restoreRememberedVaultKey(fresh.uid)
      setVaultUnlocked(restored || isVaultUnlocked())
      if (restored) {
        void syncAfterRestore(fresh.uid).catch((err) => {
          console.warn('Vault sync after MFA failed:', err)
        })
      }
      writeConsumerHint(true)
      setLoading(false)
      // Profile is best-effort — never block leaving the MFA step on Firestore.
      try {
        const p = await loadProfile(fresh.uid)
        setProfile(p)
      } catch (profileErr) {
        console.warn('Consumer profile load failed after MFA:', profileErr)
      }
    },
    [pendingMfaResolver]
  )

  const signOut = useCallback(async () => {
    await signOutConsumer()
    setUser(null)
    setProfile(null)
    setVaultUnlocked(false)
    writeConsumerHint(false)
  }, [])

  const unlockVault = useCallback(
    async (recoveryKey: string, options?: { rememberDevice?: boolean }) => {
      let p = profile
      if (!p && user) {
        p = await loadProfile(user.uid)
        if (p) setProfile(p)
      }
      if (!p) throw new Error('Sign in first.')
      await unlockVaultWithRecovery(p, recoveryKey, options)
      setVaultUnlocked(true)
    },
    [profile, user]
  )

  const forgetDeviceVault = useCallback(() => {
    if (!user) return
    forgetRememberedVaultKey(user.uid)
    setVaultUnlocked(false)
  }, [user])

  const resendVerification = useCallback(async () => {
    if (!user) return
    await resendConsumerEmailVerification(user)
  }, [user])

  const refreshUser = useCallback(async () => {
    if (!user) return
    const u = await reloadConsumerUser(user)
    setUser(u)
    const p = await loadProfile(u.uid)
    setProfile(p)
  }, [user])

  const beginTotpEnroll = useCallback(async () => {
    if (!user) throw new Error('Sign in first.')
    return startTotpEnrollment(user)
  }, [user])

  const finishTotpEnroll = useCallback(
    async (secret: TotpSecret, code: string) => {
      if (!user) throw new Error('Sign in first.')
      await finalizeTotpEnrollment(user, secret, code)
      await refreshUser()
    },
    [user, refreshUser]
  )

  const sendPasswordReset = useCallback(async (email: string) => {
    await sendConsumerPasswordReset(email)
  }, [])

  const verifyPasswordResetCodeFn = useCallback(async (oobCode: string) => {
    return verifyConsumerPasswordResetCode(oobCode)
  }, [])

  const confirmPasswordResetFn = useCallback(async (oobCode: string, newPassword: string) => {
    await confirmConsumerPasswordReset(oobCode, newPassword)
  }, [])

  const changePassword = useCallback(
    async (current: string, next: string) => {
      if (!user) throw new Error('Sign in first.')
      await changeConsumerPassword(user, current, next)
    },
    [user]
  )

  const requestEmailChange = useCallback(
    async (password: string, newEmail: string) => {
      if (!user) throw new Error('Sign in first.')
      await requestConsumerEmailChange(user, password, newEmail)
    },
    [user]
  )

  const updateNameUsername = useCallback(
    async (displayName: string, username: string) => {
      if (!profile) throw new Error('Sign in first.')
      const next = await updateDisplayNameAndUsername(profile, displayName, username)
      setProfile(next)
    },
    [profile]
  )

  const updateBoardPrefs = useCallback(
    async (
      prefs: Pick<
        UserAccountProfile,
        | 'leaderboardsOptIn'
        | 'leaderboardsShowOnAllNetworks'
        | 'leaderboardsEnabledNetworkIDs'
        | 'leaderboardsShowDisplayName'
      >
    ) => {
      if (!profile) throw new Error('Sign in first.')
      const next = await updateLeaderboardPrefs(profile, prefs)
      setProfile(next)
    },
    [profile]
  )

  const saveProfileFields = useCallback(async (next: UserAccountProfile) => {
    await saveProfile(next)
    setProfile(next)
  }, [])

  const doSyncNow = useCallback(async () => {
    if (!user) return
    await syncNow(user.uid)
  }, [user])

  const resolveSyncConflict = useCallback(
    async (resolution: AccountSyncConflictResolution) => {
      if (!user) return
      await resolveConflict(user.uid, resolution)
    },
    [user]
  )

  const noteDiaryChanged = useCallback(() => {
    if (user && isVaultUnlocked()) scheduleDebouncedUpload(user.uid)
  }, [user])

  const value = useMemo<ConsumerAuthContextValue>(
    () => ({
      user,
      profile,
      loading,
      vaultUnlocked,
      vaultRememberedOnDevice: user ? hasRememberedVaultKey(user.uid) : false,
      needsEmailVerify: user ? consumerNeedsEmailVerify(user) : false,
      needsTotpEnroll: user ? consumerNeedsTotpEnroll(user) : false,
      hasTotp: user ? consumerHasTotp(user) : false,
      syncStatus,
      diaryRevision,
      pendingMfaResolver,
      signUp,
      signIn,
      completeMfa,
      signOut,
      unlockVault,
      forgetDeviceVault,
      resendVerification,
      refreshUser,
      beginTotpEnroll,
      finishTotpEnroll,
      sendPasswordReset,
      verifyPasswordResetCode: verifyPasswordResetCodeFn,
      confirmPasswordReset: confirmPasswordResetFn,
      changePassword,
      requestEmailChange,
      updateNameUsername,
      updateBoardPrefs,
      saveProfileFields,
      syncNow: doSyncNow,
      resolveSyncConflict,
      noteDiaryChanged,
      pendingConflict: syncStatus.pendingConflict,
    }),
    [
      user,
      profile,
      loading,
      vaultUnlocked,
      syncStatus,
      diaryRevision,
      pendingMfaResolver,
      signUp,
      signIn,
      completeMfa,
      signOut,
      unlockVault,
      forgetDeviceVault,
      resendVerification,
      refreshUser,
      beginTotpEnroll,
      finishTotpEnroll,
      sendPasswordReset,
      verifyPasswordResetCodeFn,
      confirmPasswordResetFn,
      changePassword,
      requestEmailChange,
      updateNameUsername,
      updateBoardPrefs,
      saveProfileFields,
      doSyncNow,
      resolveSyncConflict,
      noteDiaryChanged,
    ]
  )

  return <ConsumerAuthContext.Provider value={value}>{children}</ConsumerAuthContext.Provider>
}

export function useConsumerAuth(): ConsumerAuthContextValue {
  const ctx = useContext(ConsumerAuthContext)
  if (!ctx) throw new Error('useConsumerAuth must be used within ConsumerAuthProvider')
  return ctx
}
