'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { isBetaSite, isLocalDevLoginBypassEnabled } from '@/utils/localDevFlags'

const AUTH_SESSION_HINT_KEY = 'rs-auth-session-hint'

/** Catalogue web-admin login (or local bypass). Hidden from public visitors. */
export function useDarwinNavPagesVisible(): boolean {
  const { user } = useAuth()
  const [sessionHint, setSessionHint] = useState(false)

  useEffect(() => {
    try {
      setSessionHint(window.localStorage.getItem(AUTH_SESSION_HINT_KEY) === '1')
    } catch {
      setSessionHint(false)
    }
  }, [user])

  if (isLocalDevLoginBypassEnabled()) return true
  return Boolean(user) || sessionHint
}

/** Departures + Units in the public header: logged-in on live, everyone on the beta site. */
export function useDarwinPublicPagesVisible(): boolean {
  const loggedIn = useDarwinNavPagesVisible()
  return isBetaSite() || loggedIn
}
