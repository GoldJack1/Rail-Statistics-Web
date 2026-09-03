'use client'

import React from 'react'

import { BUTTabButton } from '@/components/buttons'
import { TextSkeletonLine } from '@/components/misc/Skeleton/TextSkeletonLine'
import type { DPAYGScheme } from '@/types/dpayg'
import '@/components/cards/NetworkStationTabGroup/NetworkStationTabGroup.css'

type DpaygTrialTabGroupProps = {
  schemes: DPAYGScheme[]
  value: string
  onChange: (schemeId: string) => void
  /** Keep the tab strip mounted and redact labels while schemes load. */
  loading?: boolean
  className?: string
}

/** Placeholder tabs so the toolbar keeps its height while Firestore loads. */
const SKELETON_PLACEHOLDER_TABS = [
  { id: '__skeleton-1', label: 'Sheffield–Doncaster' },
  { id: '__skeleton-2', label: 'EMR Midlands' },
  { id: '__skeleton-3', label: 'Trial Area' },
] as const

type TabItem = { id: string; label: string }

const DpaygTrialTabGroup: React.FC<DpaygTrialTabGroupProps> = ({
  schemes,
  value,
  onChange,
  loading = false,
  className = '',
}) => {
  const tabs: TabItem[] =
    schemes.length > 0
      ? schemes.map((scheme) => ({
          id: scheme.id,
          label: scheme.shortName || scheme.name,
        }))
      : loading
        ? SKELETON_PLACEHOLDER_TABS.map((tab) => ({ id: tab.id, label: tab.label }))
        : []

  return (
    <div
      className={[
        'network-station-tab-group',
        loading ? 'network-station-tab-group--loading' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      role="tablist"
      aria-label="D-PAYG trial area"
      aria-busy={loading || undefined}
    >
      {tabs.map((tab) => {
        const isSelected = !loading && value === tab.id
        return (
          <BUTTabButton
            key={tab.id}
            type="button"
            width="hug"
            role="tab"
            instantAction
            pressed={isSelected}
            ariaSelected={isSelected}
            disabled={loading}
            onClick={() => {
              if (loading || tab.id.startsWith('__skeleton-')) return
              onChange(tab.id)
            }}
          >
            <span className="network-station-tab-group__label">
              {loading ? (
                <TextSkeletonLine>{tab.label}</TextSkeletonLine>
              ) : (
                tab.label
              )}
            </span>
          </BUTTabButton>
        )
      })}
    </div>
  )
}

export default DpaygTrialTabGroup
