export type ServiceViewMode = 'detailed' | 'simple'

const SERVICE_VIEW_MODE_KEY = 'rs.darwin.serviceViewMode'

export function readServiceViewMode(): ServiceViewMode {
  if (typeof window === 'undefined') return 'detailed'
  try {
    return window.localStorage.getItem(SERVICE_VIEW_MODE_KEY) === 'simple' ? 'simple' : 'detailed'
  } catch {
    return 'detailed'
  }
}

export function writeServiceViewMode(mode: ServiceViewMode): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SERVICE_VIEW_MODE_KEY, mode)
  } catch {
    /* quota / private mode */
  }
}
