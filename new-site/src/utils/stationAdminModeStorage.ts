const STATION_ADMIN_MODE_STORAGE_KEY = 'railstatistics-station-admin-mode-v1'

export const STATION_ADMIN_MODE_CHANGED_EVENT = 'railstatistics-station-admin-mode-changed'

export function readStationAdminModeEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(STATION_ADMIN_MODE_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeStationAdminModeEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STATION_ADMIN_MODE_STORAGE_KEY, enabled ? '1' : '0')
    window.dispatchEvent(new Event(STATION_ADMIN_MODE_CHANGED_EVENT))
  } catch {
    /* quota / private mode */
  }
}

/** First local-dev visit: turn admin mode on unless the user already chose off. */
export function ensureStationAdminModeDefaultOn(): void {
  if (typeof window === 'undefined') return
  try {
    if (localStorage.getItem(STATION_ADMIN_MODE_STORAGE_KEY) != null) return
    writeStationAdminModeEnabled(true)
  } catch {
    /* quota / private mode */
  }
}

export function isStationAdminSearchParam(search: string): boolean {
  return new URLSearchParams(search).get('admin') === '1'
}

/** Persisted preference or explicit `?admin=1` in the URL. */
export function isStationAdminModeActive(search: string): boolean {
  return readStationAdminModeEnabled() || isStationAdminSearchParam(search)
}
