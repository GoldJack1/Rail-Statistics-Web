'use client'

import { findPendingFieldChange } from '../../../utils/applyPendingChangesForDisplay'
import type { StationFieldChange } from '../../../utils/stationFieldDiffs'
import { TextSkeletonLine } from '@/components/misc/Skeleton/TextSkeletonLine'

interface StationDetailFieldProps {
  label: string
  value: string
  pendingFieldChanges?: StationFieldChange[]
  /** Kept for call-site compatibility; field captions no longer show icons. */
  iconKey?: string | null
  /** Kept for call-site compatibility; field captions no longer show icons. */
  showIcon?: boolean
  skeleton?: boolean
}

export function StationDetailField({
  label,
  value,
  pendingFieldChanges,
  skeleton = false,
}: StationDetailFieldProps) {
  const pending = findPendingFieldChange(label, pendingFieldChanges ?? [])

  return (
    <div className={`modal-detail-item${pending ? ' modal-detail-item--pending' : ''}`}>
      <div className="modal-detail-label-row">
        <span className="modal-detail-label">
          {skeleton ? <TextSkeletonLine>{label}</TextSkeletonLine> : label}
        </span>
      </div>
      <span className="modal-detail-value">
        {skeleton ? <TextSkeletonLine>{value}</TextSkeletonLine> : value}
      </span>
      {pending && <span className="modal-detail-pending-from">{pending.from}</span>}
    </div>
  )
}

export default StationDetailField
