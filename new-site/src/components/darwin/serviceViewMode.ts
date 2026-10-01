import { useCallback, useEffect, useState } from 'react'

export type ServiceViewMode = 'detailed' | 'simple'

const SERVICE_VIEW_MODE_KEY = 'rs.darwin.serviceViewMode'
const LEGACY_DETAILED_INFO_KEY = 'rs.darwin.showDetailedInfo'
const VIEW_MODE_EVENT = 'rs-darwin-view-mode'

function parseMode(raw: string | null): ServiceViewMode | null {
  if (raw === 'simple' || raw === 'detailed') return raw
  return null
}

export function readServiceViewMode(): ServiceViewMode {
  if (typeof window === 'undefined') return 'detailed'
  try {
    const stored = parseMode(window.localStorage.getItem(SERVICE_VIEW_MODE_KEY))
    if (stored) return stored
    const legacy = window.localStorage.getItem(LEGACY_DETAILED_INFO_KEY)
    if (legacy === '1') return 'detailed'
    if (legacy === '0') return 'simple'
    return 'detailed'
  } catch {
    return 'detailed'
  }
}

export function writeServiceViewMode(mode: ServiceViewMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SERVICE_VIEW_MODE_KEY, mode)
    window.localStorage.removeItem(LEGACY_DETAILED_INFO_KEY)
    window.dispatchEvent(new Event(VIEW_MODE_EVENT))
  } catch {
    /* quota / private mode */
  }
}

export function useServiceViewMode(): [ServiceViewMode, (mode: ServiceViewMode) => void] {
  const [viewMode, setViewMode] = useState<ServiceViewMode>('detailed')

  useEffect(() => {
    const apply = () => setViewMode(readServiceViewMode())
    apply()
    const onStorage = (event: StorageEvent) => {
      if (event.key === SERVICE_VIEW_MODE_KEY || event.key === LEGACY_DETAILED_INFO_KEY) apply()
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener(VIEW_MODE_EVENT, apply)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener(VIEW_MODE_EVENT, apply)
    }
  }, [])

  const selectViewMode = useCallback((mode: ServiceViewMode) => {
    setViewMode(mode)
    writeServiceViewMode(mode)
  }, [])

  return [viewMode, selectViewMode]
}
