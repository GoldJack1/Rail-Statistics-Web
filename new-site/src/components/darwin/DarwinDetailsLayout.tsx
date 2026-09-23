'use client'

import type { ReactNode } from 'react'
import { PageTopHeader } from '@/components/misc'
import {
  AccountSectionNav,
  type AccountSection,
} from '@/components/misc/AccountSectionNav/AccountSectionNav'
import '@/app/stations/[network]/[stationSlug]/StationDetailsPage.css'
import '@/components/models/StationModal/StationModal.css'
import '@/components/cards/StationsTableView/StationsTableView.css'
import './DarwinDetailsLayout.css'

export type DarwinDetailsLayoutProps = {
  title: ReactNode
  subtitle?: ReactNode
  headerClassName?: string
  actionContent?: ReactNode
  sidebarHeader?: ReactNode
  sections: AccountSection[]
  activeSectionId: string
  onSelect: (sectionId: string) => void
  ariaLabel: string
  children: ReactNode
  minSectionCount?: number
}

/**
 * Station-details chrome for Darwin service / unit pages: full-bleed header,
 * left section nav (hamburger on small screens), main content card.
 */
export function DarwinDetailsLayout({
  title,
  subtitle,
  headerClassName,
  actionContent,
  sidebarHeader,
  sections,
  activeSectionId,
  onSelect,
  ariaLabel,
  children,
  minSectionCount = 5,
}: DarwinDetailsLayoutProps) {
  return (
    <div className="container container--station-details">
      <PageTopHeader
        className={headerClassName}
        title={title}
        subtitle={subtitle}
        actionContent={actionContent}
      />
      <div className="station-details-page darwin-details-page">
        <div
          className="station-details-layout"
          style={{ ['--station-details-min-section-count' as string]: minSectionCount }}
        >
          <AccountSectionNav
            sections={sections}
            activeSectionId={activeSectionId}
            onSelect={onSelect}
            ariaLabel={ariaLabel}
            headerContent={sidebarHeader}
          />
          <main className="station-details-main">
            <section className="station-details-card modal-content">
              <div className="modal-body station-details-visible-body darwin-details-body">
                {children}
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}

export default DarwinDetailsLayout
