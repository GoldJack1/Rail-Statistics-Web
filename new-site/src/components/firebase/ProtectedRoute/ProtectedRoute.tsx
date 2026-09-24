'use client'

import React, { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { userMustEnrollTotpMfaOnFirebase } from '@/services/firebaseTotpMfa'
import {
  getMasterPublishEmail,
  isMasterPublishEmailUser,
  STATION_EDITOR_DENIED_MESSAGE,
} from '@/utils/masterPublishPolicy'
import { isLocalDevLoginBypassEnabled } from '@/utils/localDevFlags'
import { canUseDarwinTools, isDarwinPreviewUser } from '@/utils/darwinPreviewAccess'

interface ProtectedRouteProps {
  children: React.ReactNode
  /**
   * Render page content while auth resolves (e.g. stations skeleton) instead of a
   * blocking loader. Redirects still run once auth state is known.
   */
  showShellWhileChecking?: boolean
  /** Owner or Darwin preview emails — skip station-editor requirement. */
  requireDarwinTools?: boolean
}

type ProfileCheck =
  | 'idle'
  | 'checking'
  | 'ok'
  | 'need-email-verify'
  | 'need-totp-enroll'
    | 'need-editor'
    | 'need-darwin-tools'

/**
 * Requires a signed-in catalogue user with verified email, TOTP MFA, and station-editor
 * authority (`rs_station_editor` claim or owner email).
 * Pass `requireDarwinTools` for API status / Darwin tools (preview emails allowed).
 */
const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  showShellWhileChecking = false,
  requireDarwinTools = false,
}) => {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const [profileCheck, setProfileCheck] = useState<ProfileCheck>('idle')

  useEffect(() => {
    if (isLocalDevLoginBypassEnabled()) return
    if (loading) return

    if (!user) {
      setProfileCheck('idle')
      return
    }

    let cancelled = false
    setProfileCheck('checking')

    void (async () => {
      try {
        const firebase = await import('@/services/firebase')
        await firebase.initializeFirebase()
        const auth = await import('firebase/auth')
        const u = firebase.getFirebaseAuth()?.currentUser
        if (cancelled) return
        if (!u) {
          setProfileCheck('need-email-verify')
          return
        }
        try {
          await auth.reload(u)
        } catch {
          /* still check with cached user */
        }
        if (cancelled) return

        if (!u.emailVerified) {
          setProfileCheck('need-email-verify')
          return
        }
        if (userMustEnrollTotpMfaOnFirebase(u)) {
          setProfileCheck('need-totp-enroll')
          return
        }

        let hasEditorClaim = false
        try {
          const token = await u.getIdTokenResult(true)
          hasEditorClaim = token.claims.rs_station_editor === true
        } catch {
          hasEditorClaim = false
        }

        const isEditor =
          hasEditorClaim ||
          isMasterPublishEmailUser({
            ...u,
            email: u.email,
          } as Parameters<typeof isMasterPublishEmailUser>[0])

        // Also allow when email matches master even if User type differs
        const emailOk =
          (u.email?.trim().toLowerCase() ?? '') === getMasterPublishEmail()

        if (requireDarwinTools) {
          if (!canUseDarwinTools(u)) {
            setProfileCheck('need-darwin-tools')
            return
          }
          setProfileCheck('ok')
          return
        }

        if (!isEditor && !emailOk && !hasEditorClaim) {
          setProfileCheck('need-editor')
          return
        }

        setProfileCheck('ok')
      } catch {
        if (!cancelled) setProfileCheck('need-email-verify')
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, loading, requireDarwinTools])

  useEffect(() => {
    if (isLocalDevLoginBypassEnabled()) return
    if (loading || (user && profileCheck === 'checking')) return

    if (!user) {
      const from = encodeURIComponent(pathname)
      router.replace(`/log-in?from=${from}`)
      return
    }

    if (profileCheck === 'need-email-verify') {
      router.replace('/log-in?reason=verify-email')
      return
    }

    if (profileCheck === 'need-totp-enroll') {
      router.replace('/log-in?reason=enroll-totp')
      return
    }

    if (profileCheck === 'need-editor') {
      router.replace('/log-in?reason=not-editor')
      return
    }

    if (profileCheck === 'need-darwin-tools') {
      router.replace(isDarwinPreviewUser(user) ? '/departures' : '/log-in?reason=not-editor')
    }
  }, [user, loading, profileCheck, pathname, router])

  if (isLocalDevLoginBypassEnabled()) {
    return <>{children}</>
  }

  const isRedirecting =
    !loading &&
    (!user ||
      profileCheck === 'need-email-verify' ||
      profileCheck === 'need-totp-enroll' ||
      profileCheck === 'need-editor' ||
      profileCheck === 'need-darwin-tools')

  if (!showShellWhileChecking && (loading || isRedirecting)) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '200px',
          fontSize: '18px',
          color: 'var(--text-secondary)',
        }}
      >
        {profileCheck === 'need-editor' ? STATION_EDITOR_DENIED_MESSAGE : 'Loading…'}
      </div>
    )
  }

  return <>{children}</>
}

export default ProtectedRoute
