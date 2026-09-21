'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { areDarwinNavPagesEnabled } from '@/utils/localDevFlags'

const AUTH_SESSION_HINT_KEY = 'rs-auth-session-hint'

/**
 * Departures / Bash / Units in header and footer: env flag, local login
 * bypass, or a signed-in catalogue (web admin) user.
 */
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

  if (areDarwinNavPagesEnabled()) return true
  return Boolean(user) || sessionHint
}
