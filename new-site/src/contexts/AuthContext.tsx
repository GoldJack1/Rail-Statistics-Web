'use client'

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import type { User } from '@/services/firebaseAuthBootstrap'
import { isAuthCriticalPath, isColdVisitorDeferPath } from '@/utils/coldVisitorPerf'

interface AuthContextValue {
  user: User | null
  loading: boolean
  login: (email: string, password: string) => Promise<void>
  loginWithGoogle: () => Promise<void>
  loginWithApple: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

const AUTH_SESSION_HINT_KEY = 'rs-auth-session-hint'

function readAuthSessionHint(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1'
  } catch {
    return false
  }
}

function writeAuthSessionHint(active: boolean): void {
  if (typeof window === 'undefined') return
  try {
    if (active) {
      window.localStorage.setItem(AUTH_SESSION_HINT_KEY, '1')
    } else {
      window.localStorage.removeItem(AUTH_SESSION_HINT_KEY)
    }
  } catch {
    // ignore storage errors
  }
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const pathname = usePathname() ?? '/'

  useEffect(() => {
    let unsubscribe: (() => void) | undefined
    let cancelled = false
    let idleHandle: number | undefined
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined

    const authIsRouteCritical = isAuthCriticalPath(pathname)

    const init = async (options?: { deferAppCheck?: boolean }) => {
      // Lean auth-only module — must not pull Firestore into the Header/Auth chunk.
      const authBootstrap = await import('@/services/firebaseAuthBootstrap')
      await authBootstrap.ensureFirebaseAuthApp()
      if (authIsRouteCritical) {
        if (options?.deferAppCheck) {
          const scheduleAppCheck = () => {
            void authBootstrap.ensureFirebaseAppCheck()
          }
          if (typeof window.requestIdleCallback === 'function') {
            window.requestIdleCallback(scheduleAppCheck, { timeout: 4_000 })
          } else {
            window.setTimeout(scheduleAppCheck, 1_500)
          }
        } else {
          await authBootstrap.ensureFirebaseAppCheck()
        }
      }
      await authBootstrap.tryDevAutoSignInFromEnv()
      if (cancelled) return

      try {
        const result = await authBootstrap.handleRedirectResult()
        if (result?.user) {
          setUser(result.user)
          setLoading(false)
        }
      } catch (err) {
        console.warn('Redirect result error:', err)
      }
      if (cancelled) return
      unsubscribe = authBootstrap.subscribeAuthState((u) => {
        setUser(u)
        writeAuthSessionHint(Boolean(u))
        setLoading(false)
      })
    }

    if (authIsRouteCritical) {
      void init({ deferAppCheck: readAuthSessionHint() && pathname !== '/log-in' })
    } else if (isColdVisitorDeferPath(pathname) && !readAuthSessionHint()) {
      // Anonymous public visit — never load Auth/App Check/reCAPTCHA on cold PSI.
      setLoading(false)
    } else if (isColdVisitorDeferPath(pathname)) {
      // Signed-in catalogue admin: restore auth now so Departures/Bash/Units nav can show.
      void init({ deferAppCheck: true })
    } else if (typeof window.requestIdleCallback === 'function') {
      idleHandle = window.requestIdleCallback(() => void init(), { timeout: 5_000 })
    } else {
      timeoutHandle = setTimeout(() => void init(), 3_000)
    }

    return () => {
      cancelled = true
      if (unsubscribe) unsubscribe()
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle)
      if (timeoutHandle !== undefined) clearTimeout(timeoutHandle)
    }
  }, [pathname])

  const login = useCallback(async (email: string, password: string) => {
    const authBootstrap = await import('@/services/firebaseAuthBootstrap')
    await authBootstrap.loginWithEmail(email, password)
  }, [])

  const loginWithGoogle = useCallback(async () => {
    const authBootstrap = await import('@/services/firebaseAuthBootstrap')
    await authBootstrap.loginWithGoogle()
  }, [])

  const loginWithApple = useCallback(async () => {
    const authBootstrap = await import('@/services/firebaseAuthBootstrap')
    await authBootstrap.loginWithApple()
  }, [])

  const logout = useCallback(async () => {
    const authBootstrap = await import('@/services/firebaseAuthBootstrap')
    await authBootstrap.logout()
    writeAuthSessionHint(false)
  }, [])

  const value: AuthContextValue = { user, loading, login, loginWithGoogle, loginWithApple, logout }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = (): AuthContextValue => {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
