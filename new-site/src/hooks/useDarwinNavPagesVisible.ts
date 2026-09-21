'use client'

import { useAuth } from '@/contexts/AuthContext'
import { areDarwinNavPagesEnabled } from '@/utils/localDevFlags'

/**
 * Departures / Bash / Units in header and footer: env flag, local login
 * bypass, or a signed-in catalogue (web admin) user.
 */
export function useDarwinNavPagesVisible(): boolean {
  const { user } = useAuth()
  if (areDarwinNavPagesEnabled()) return true
  return Boolean(user)
}
