'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { isLocalDevLoginBypassEnabled } from '@/utils/localDevFlags'
import { getMasterPublishEmail } from '@/utils/masterPublishPolicy'

/**
 * True when catalogue Auth user is a station editor (claim or owner email).
 * Used for footer Admin chrome — not for consumer (UAs) sessions.
 */
export function useIsStationEditor(): { loading: boolean; isEditor: boolean } {
  const { user, loading: authLoading } = useAuth()
  const [loading, setLoading] = useState(true)
  const [isEditor, setIsEditor] = useState(false)

  useEffect(() => {
    if (isLocalDevLoginBypassEnabled()) {
      setIsEditor(true)
      setLoading(false)
      return
    }
    if (authLoading) return
    if (!user) {
      setIsEditor(false)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const firebase = await import('@/services/firebase')
        await firebase.initializeFirebase()
        const auth = firebase.getFirebaseAuth()
        const u = auth?.currentUser
        if (!u) {
          if (!cancelled) {
            setIsEditor(false)
            setLoading(false)
          }
          return
        }
        const emailOk = (u.email?.trim().toLowerCase() ?? '') === getMasterPublishEmail()
        let claim = false
        try {
          const token = await u.getIdTokenResult()
          claim = token.claims.rs_station_editor === true
        } catch {
          claim = false
        }
        if (!cancelled) {
          setIsEditor(claim || emailOk)
          setLoading(false)
        }
      } catch {
        if (!cancelled) {
          setIsEditor(false)
          setLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [user, authLoading])

  if (isLocalDevLoginBypassEnabled()) {
    return { loading: false, isEditor: true }
  }

  return { loading: authLoading || loading, isEditor }
}
