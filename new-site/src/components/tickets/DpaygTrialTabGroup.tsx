'use client'

import React from 'react'

import { BUTTabButton } from '@/components/buttons'
import type { DPAYGScheme } from '@/types/dpayg'
import '@/components/cards/NetworkStationTabGroup/NetworkStationTabGroup.css'

type DpaygTrialTabGroupProps = {
  schemes: DPAYGScheme[]
  value: string
  onChange: (schemeId: string) => void
  className?: string
}

const DpaygTrialTabGroup: React.FC<DpaygTrialTabGroupProps> = ({
  schemes,
  value,
  onChange,
  className = '',
}) => {
  const tabs = schemes.map((scheme) => ({
    id: scheme.id,
    label: scheme.shortName || scheme.name,
  }))

  return (
    <div
      className={['network-station-tab-group', className].filter(Boolean).join(' ')}
      role="tablist"
      aria-label="D-PAYG trial area"
    >
      {tabs.map((tab) => {
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
            onClick={() => onChange(tab.id)}
          >
            <span className="network-station-tab-group__label">{tab.label}</span>
          </BUTTabButton>
        )
      })}
    </div>
  )
}

export default DpaygTrialTabGroup
