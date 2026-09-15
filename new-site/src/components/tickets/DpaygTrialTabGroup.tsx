'use client'

import React from 'react'

import { BUTTabButton } from '@/components/buttons'
import type { DPAYGScheme } from '@/types/dpayg'
import { TextSkeletonLine } from '@/components/misc/Skeleton/TextSkeletonLine'
import '@/components/cards/NetworkStationTabGroup/NetworkStationTabGroup.css'

type DpaygTrialTabGroupProps = {
  schemes?: DPAYGScheme[]
  tabs?: { id: string; label: string }[]
  value: string
  onChange: (schemeId: string) => void
  className?: string
  ariaLabel?: string
  skeleton?: boolean
}

const DpaygTrialTabGroup: React.FC<DpaygTrialTabGroupProps> = ({
  schemes = [],
  tabs,
  value,
  onChange,
  className = '',
  ariaLabel = 'D-PAYG trial area',
  skeleton = false,
}) => {
  const resolvedTabs =
    tabs ??
    schemes.map((scheme) => ({
      id: scheme.id,
      label: scheme.shortName || scheme.name,
    }))

  return (
    <div
      className={['network-station-tab-group', className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label={ariaLabel}
    >
      {resolvedTabs.map((tab) => {
        const isSelected = value === tab.id
        return (
          <BUTTabButton
            key={tab.id}
            type="button"
            width="hug"
            role="tab"
            instantAction
            pressed={isSelected}
            ariaSelected={isSelected}
            onClick={() => {
              if (!skeleton) onChange(tab.id)
            }}
          >
            <span className="network-station-tab-group__label">
              {skeleton ? <TextSkeletonLine>{tab.label}</TextSkeletonLine> : tab.label}
            </span>
          </BUTTabButton>
        )
      })}
    </div>
  )
}

export default DpaygTrialTabGroup
