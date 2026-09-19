'use client'

import { useCallback, useSyncExternalStore } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { isLocalDevLoginBypassEnabled } from '@/utils/localDevFlags'
import {
  isStationAdminModeActive,
  STATION_ADMIN_MODE_CHANGED_EVENT,
} from '@/utils/stationAdminModeStorage'

/** True when a signed-in user has admin mode enabled (persisted or `?admin=1`). */
export function useStationAdminMode(): boolean {
  const { user, loading } = useAuth()
  const searchParams = useSearchParams()
  const search = searchParams.toString() ? `?${searchParams}` : ''
  const bypass = isLocalDevLoginBypassEnabled()

  const subscribe = useCallback((onStoreChange: () => void) => {
    window.addEventListener(STATION_ADMIN_MODE_CHANGED_EVENT, onStoreChange)
    return () => window.removeEventListener(STATION_ADMIN_MODE_CHANGED_EVENT, onStoreChange)
  }, [])

  const getSnapshot = useCallback(() => isStationAdminModeActive(search), [search])

  const adminActive = useSyncExternalStore(subscribe, getSnapshot, () => false)

  if (!bypass && (loading || !user)) return false
  return adminActive
}
