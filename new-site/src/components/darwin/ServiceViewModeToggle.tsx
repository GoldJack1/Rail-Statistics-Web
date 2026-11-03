'use client'

import { TOGToggleVisited } from '@/components/buttons'
import type { ServiceViewMode } from '@/components/darwin/serviceViewMode'

export type ServiceViewModeToggleProps = {
  viewMode: ServiceViewMode
  onChange: (mode: ServiceViewMode) => void
  className?: string
  disabled?: boolean
}

export function ServiceViewModeToggle({
  viewMode,
  onChange,
  className = '',
  disabled = false,
}: ServiceViewModeToggleProps) {
  return (
    <div className={['svc-viewmode-switch', disabled ? 'svc-viewmode-switch--disabled' : '', className].filter(Boolean).join(' ')}>
      <span className="svc-viewmode-switch__label">Simple view</span>
      <span className="svc-viewmode-switch__spacer" aria-hidden="true" />
      <TOGToggleVisited
        checked={viewMode === 'simple'}
        disabled={disabled}
        onChange={(next) => onChange(next ? 'simple' : 'detailed')}
        ariaLabel="Simple view"
        className="svc-viewmode-switch__control"
      />
    </div>
  )
}

export default ServiceViewModeToggle
