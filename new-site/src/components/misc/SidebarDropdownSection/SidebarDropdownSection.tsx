'use client'

import React, { useId, useState } from 'react'
import { ChevronRightIcon } from '@/components/icons'
import AutoAnimateCollapse from '@/components/misc/AutoAnimateCollapse/AutoAnimateCollapse'
import { Skeleton } from '@/components/misc/Skeleton/Skeleton'
import { TextSkeletonLine } from '@/components/misc/Skeleton/TextSkeletonLine'
import './SidebarDropdownSection.css'

interface SidebarDropdownSectionProps {
  title: string
  children: React.ReactNode
  defaultExpanded?: boolean
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  className?: string
  headerAction?: React.ReactNode
  /** Redact title/chevron with text skeleton bars while parent content loads. */
  skeleton?: boolean
}

const SidebarDropdownSection: React.FC<SidebarDropdownSectionProps> = ({
  title,
  children,
  defaultExpanded = true,
  expanded,
  onExpandedChange,
  className = '',
  headerAction,
  skeleton = false,
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultExpanded)
  const isControlled = expanded !== undefined
  const isOpen = isControlled ? expanded : internalOpen
  const panelId = useId()

  const setIsOpen = (next: boolean | ((current: boolean) => boolean)) => {
    const resolved = typeof next === 'function' ? next(isOpen) : next
    if (isControlled) {
      onExpandedChange?.(resolved)
      return
    }
    setInternalOpen(resolved)
  }

  return (
    <section
      className={[
        'sidebar-dropdown',
        isOpen ? 'sidebar-dropdown--open' : 'sidebar-dropdown--closed',
        skeleton ? 'sidebar-dropdown--skeleton' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="sidebar-dropdown__header-row">
        <button
          type="button"
          className="sidebar-dropdown__header"
          aria-expanded={isOpen}
          aria-controls={panelId}
          disabled={skeleton}
          onClick={() => {
            if (skeleton) return
            setIsOpen((current) => !current)
          }}
        >
          <span className="sidebar-dropdown__title">
            {skeleton ? <TextSkeletonLine>{title}</TextSkeletonLine> : title}
          </span>
          {skeleton ? (
            <Skeleton className="station-details-nav-skeleton-icon" style={{ width: 16, height: 16 }} />
          ) : (
            <ChevronRightIcon className="sidebar-dropdown__chevron" aria-hidden />
          )}
        </button>
        {isOpen && headerAction ? (
          <div className="sidebar-dropdown__header-action" onClick={(event) => event.stopPropagation()}>
            {headerAction}
          </div>
        ) : null}
      </div>

      <AutoAnimateCollapse
        isOpen={isOpen}
        id={panelId}
        className="sidebar-dropdown__panel-host"
        itemClassName="sidebar-dropdown__panel"
      >
        <div className="sidebar-dropdown__panel-inner">{children}</div>
      </AutoAnimateCollapse>
    </section>
  )
}

export default SidebarDropdownSection
