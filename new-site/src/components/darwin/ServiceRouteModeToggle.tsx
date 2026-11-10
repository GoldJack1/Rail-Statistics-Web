'use client'

export type ServiceRouteMode = 'ours' | 'rail'

const ROUTE_MODE_KEY = 'rs.service-map.route'

export function storedServiceRouteMode(): ServiceRouteMode {
  try {
    return sessionStorage.getItem(ROUTE_MODE_KEY) === 'rail' ? 'rail' : 'ours'
  } catch {
    return 'ours'
  }
}

export function rememberServiceRouteMode(mode: ServiceRouteMode) {
  try {
    sessionStorage.setItem(ROUTE_MODE_KEY, mode)
  } catch {
    /* The choice still applies for this visit. */
  }
}

export function ServiceRouteModeToggle({
  mode,
  onChange,
  className = '',
  disabled = false,
}: {
  mode: ServiceRouteMode
  onChange: (mode: ServiceRouteMode) => void
  className?: string
  disabled?: boolean
}) {
  return (
    <div className={['svc-viewmode-switch', 'svc-route-switch-row', disabled ? 'svc-viewmode-switch--disabled' : '', className].filter(Boolean).join(' ')}>
      <div className="svc-route-switch" role="radiogroup" aria-label="Route">
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'ours'}
          disabled={disabled}
          onClick={() => onChange('ours')}
        >
          Our route
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={mode === 'rail'}
          disabled={disabled}
          onClick={() => onChange('rail')}
        >
          Rail map
        </button>
      </div>
    </div>
  )
}
