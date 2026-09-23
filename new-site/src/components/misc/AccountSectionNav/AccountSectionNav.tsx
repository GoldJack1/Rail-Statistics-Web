'use client'

import React, { useEffect, useId, useState, type ReactNode } from 'react'
import type { Icon } from '@phosphor-icons/react'
import {
  MobileHeaderMenu,
  MobileHeaderPanel,
  MobileHeaderToggle,
} from '@/components/misc/Header/MobileHeader'
import { SidebarPanel, SidebarPanelNav, SidebarPanelNavItem } from '@/components/misc/SidebarPanel'
import './AccountLayout.css'

export type AccountSection = {
  id: string
  label: string
  icon?: Icon | null
  /** Destructive actions (e.g. Sign out) — uses red-action button colours. */
  danger?: boolean
  /**
   * Content sections stay selected in the left panel.
   * Action / navigation items fire `onSelect` but do not become the active section.
   */
  selectable?: boolean
  /** Extra space above this row (px). */
  spacerAbove?: number
}

type AccountSectionNavProps = {
  sections: AccountSection[]
  activeSectionId: string
  onSelect: (sectionId: string) => void
  ariaLabel?: string
  headerContent?: ReactNode
}

function DesktopSectionTabs({
  sections,
  activeSectionId,
  onSelect,
  ariaLabel,
  headerContent,
}: AccountSectionNavProps) {
  return (
    <aside className="station-details-sidebar account-sidebar">
      <SidebarPanel className="station-details-sidebar-panel">
        {headerContent}
        <SidebarPanelNav className="station-details-tabs" aria-label={ariaLabel}>
          {sections.map((section) => {
            const isSelectable = section.selectable !== false
            const isActive = isSelectable && activeSectionId === section.id
            const IconComponent = section.icon ?? null
            return (
              <React.Fragment key={section.id}>
                {section.spacerAbove ? (
                  <div
                    className="account-section-spacer"
                    style={{ height: section.spacerAbove }}
                    aria-hidden
                  />
                ) : null}
                <SidebarPanelNavItem
                  label={section.label}
                  selected={isActive}
                  onSelect={() => onSelect(section.id)}
                  icon={IconComponent}
                  className={[
                    'station-details-tab',
                    section.danger ? 'rs-button--color-red-action' : 'rs-button--color-primary',
                    section.danger ? 'account-section-tab--danger' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                />
              </React.Fragment>
            )
          })}
        </SidebarPanelNav>
      </SidebarPanel>
    </aside>
  )
}

/**
 * Desktop: station-details-style left sidebar.
 * Mobile (≤1023px): header menu (hamburger + collapsible panel).
 */
export function AccountSectionNav({
  sections,
  activeSectionId,
  onSelect,
  ariaLabel = 'Account sections',
  headerContent,
}: AccountSectionNavProps) {
  const navId = useId()
  const [menuOpen, setMenuOpen] = useState(false)
  const activeSection =
    sections.find((section) => section.selectable !== false && section.id === activeSectionId) ??
    sections.find((section) => section.selectable !== false)
  const activeLabel = activeSection?.label ?? 'Sections'
  const ActiveIcon = activeSection?.icon ?? null

  useEffect(() => {
    setMenuOpen(false)
  }, [activeSectionId])

  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  const closeMenu = () => setMenuOpen(false)

  return (
    <>
      <DesktopSectionTabs
        sections={sections}
        activeSectionId={activeSectionId}
        onSelect={onSelect}
        ariaLabel={ariaLabel}
        headerContent={headerContent}
      />

      <div className="station-details-mobile-sections account-mobile-sections">
        <MobileHeaderMenu
          menuOpen={menuOpen}
          className="station-details-mobile-sections__menu"
        >
          <div className="station-details-mobile-sections__bar">
            <span className="station-details-mobile-sections__title">
              {ActiveIcon ? (
                <ActiveIcon
                  className="station-details-tab__icon"
                  size={16}
                  weight="bold"
                  aria-hidden
                />
              ) : null}
              <span className="station-details-mobile-sections__title-text">{activeLabel}</span>
            </span>
            <MobileHeaderToggle
              menuOpen={menuOpen}
              navId={navId}
              onMenuOpenChange={setMenuOpen}
              ariaLabelOpen="Open section menu"
              ariaLabelClose="Close section menu"
            />
          </div>
          <MobileHeaderPanel menuOpen={menuOpen} navId={navId} onClose={closeMenu}>
            <nav className="header-nav header-nav--mobile" aria-label={ariaLabel}>
              <ul className="header-mobile-nav-list">
                {sections.map((section) => {
                  const isSelectable = section.selectable !== false
                  const isActive = isSelectable && activeSectionId === section.id
                  const IconComponent = section.icon ?? null
                  return (
                    <React.Fragment key={section.id}>
                      {section.spacerAbove ? (
                        <li className="account-section-spacer-item" aria-hidden>
                          <div
                            className="account-section-spacer"
                            style={{ height: section.spacerAbove }}
                          />
                        </li>
                      ) : null}
                      <li>
                        <button
                          type="button"
                          className={[
                            'header-nav-link',
                            isActive ? 'header-nav-link--active' : '',
                            section.danger ? 'account-section-tab--danger' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => {
                            onSelect(section.id)
                            closeMenu()
                          }}
                        >
                          {IconComponent ? (
                            <IconComponent
                              className="station-details-tab__icon"
                              size={16}
                              weight="bold"
                              aria-hidden
                            />
                          ) : null}
                          <span className="header-nav-link__label">{section.label}</span>
                        </button>
                      </li>
                    </React.Fragment>
                  )
                })}
              </ul>
            </nav>
          </MobileHeaderPanel>
        </MobileHeaderMenu>
      </div>
    </>
  )
}

export default AccountSectionNav
