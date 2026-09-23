'use client'

import { TOGToggleVisited } from '@/components/buttons'
import type { ServiceViewMode } from '@/components/darwin/serviceViewMode'

export type ServiceViewModeToggleProps = {
  viewMode: ServiceViewMode
  onChange: (mode: ServiceViewMode) => void
  className?: string
}

export function ServiceViewModeToggle({
  viewMode,
  onChange,
  className = '',
}: ServiceViewModeToggleProps) {
  return (
    <div className={['svc-viewmode-switch', className].filter(Boolean).join(' ')}>
      <span className="svc-viewmode-switch__label">Simple view</span>
      <span className="svc-viewmode-switch__spacer" aria-hidden="true" />
      <TOGToggleVisited
        checked={viewMode === 'simple'}
        onChange={(next) => onChange(next ? 'simple' : 'detailed')}
        ariaLabel="Simple view"
        className="svc-viewmode-switch__control"
      />
    </div>
  )
}

export default ServiceViewModeToggle
