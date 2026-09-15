'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { CreditCard, IdentificationCard, Train } from '@phosphor-icons/react'

import { TextCard } from '@/components/cards'
import AdSlot from '@/components/ads/AdSlot'
import {
  AccountContentShell,
} from '@/components/misc/AccountPageShell/AccountPageShell'
import {
  AccountSectionNav,
  type AccountSection,
} from '@/components/misc/AccountSectionNav/AccountSectionNav'
import { listSchemes, type DPAYGSchemeListItem } from '@/services/dpaygSchemes'
import { CONTACTLESS_PAYG_AREAS, SMARTCARD_PAYG_AREAS, visiblePaygAreas } from '@/types/paygMatrix'
import { useStationAdminMode } from '@/hooks/useStationAdminMode'
import { paramAsString } from '@/utils/nextParams'
import {
  buildFaresHubPath,
  getDpaygAreaSlug,
  isFaresHubSectionId,
  type FaresHubSectionId,
} from '@/utils/dpaygUrl'

import '@/app/account/account.css'
import './FaresHubPage.css'

type HubNetworkCard = {
  id: string
  title: string
  description: string
  href: string
}

const SECTION_META: Record<
  FaresHubSectionId,
  {
    label: string
    title: string
    copy: string
    icon: AccountSection['icon']
  }
> = {
  contactless: {
    label: 'Contactless',
    title: 'Contactless networks',
    copy: 'Choose a contactless PAYG area to look up singles and caps.',
    icon: CreditCard,
  },
  smartcards: {
    label: 'Smartcards',
    title: 'Smartcard networks',
    copy: 'Choose a smartcard PAYG area to look up singles and caps.',
    icon: IdentificationCard,
  },
  'd-payg': {
    label: 'D-PAYG',
    title: 'Digital PAYG networks',
    copy: 'Choose a Digital PAYG trial corridor to look up published singles.',
    icon: Train,
  },
}

function hubCardsForAreas(
  areas: ReturnType<typeof visiblePaygAreas>,
  basePath: '/contactless-fares' | '/smartcard-fares'
): HubNetworkCard[] {
  return areas.map((area) => ({
    id: area.id,
    title: area.shortName,
    description: area.name,
    href: `${basePath}/${area.slug}`,
  }))
}

function dpaygCards(rows: DPAYGSchemeListItem[]): HubNetworkCard[] {
  return rows.map((scheme) => {
    const slug = getDpaygAreaSlug(scheme)
    const stationCount = scheme.stations.length
    const parts = [
      scheme.operatorBrand,
      stationCount > 0 ? `${stationCount} stations` : '',
    ].filter((part) => Boolean(part && part.trim()))
    return {
      id: scheme.id,
      title: scheme.shortName || scheme.name || scheme.id,
      description: parts.join(' · ') || scheme.name,
      href: `/d-payg-fares/${slug}`,
    }
  })
}

const FaresHubPageClient: React.FC = () => {
  const router = useRouter()
  const isAdminMode = useStationAdminMode()
  const sectionParam = paramAsString(useParams().section)
  const section: FaresHubSectionId = isFaresHubSectionId(sectionParam)
    ? sectionParam
    : 'contactless'
  const meta = SECTION_META[section]

  const [dpaygRows, setDpaygRows] = useState<DPAYGSchemeListItem[]>([])
  const [dpaygLoading, setDpaygLoading] = useState(() => section === 'd-payg')
  const [dpaygError, setDpaygError] = useState<string | null>(null)

  useEffect(() => {
    if (!sectionParam || isFaresHubSectionId(sectionParam)) return
    router.replace(buildFaresHubPath())
  }, [router, sectionParam])

  useEffect(() => {
    if (section !== 'd-payg') return
    let cancelled = false
    setDpaygLoading(true)
    setDpaygError(null)
    void (async () => {
      try {
        const rows = await listSchemes()
        const trials = rows.filter((row) => row.status === 'trial' || rows.length <= 3)
        if (!cancelled) setDpaygRows(trials.length > 0 ? trials : rows)
      } catch (err) {
        if (!cancelled) {
          setDpaygError(err instanceof Error ? err.message : 'Failed to load D-PAYG networks.')
        }
      } finally {
        if (!cancelled) setDpaygLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [section])

  const sections = useMemo(
    (): AccountSection[] =>
      (Object.keys(SECTION_META) as FaresHubSectionId[]).map((id) => ({
        id,
        label: SECTION_META[id].label,
        icon: SECTION_META[id].icon,
      })),
    []
  )

  const cards = useMemo(() => {
    if (section === 'contactless') {
      return hubCardsForAreas(visiblePaygAreas(CONTACTLESS_PAYG_AREAS, isAdminMode), '/contactless-fares')
    }
    if (section === 'smartcards') {
      return hubCardsForAreas(visiblePaygAreas(SMARTCARD_PAYG_AREAS, isAdminMode), '/smartcard-fares')
    }
    return dpaygCards(dpaygRows)
  }, [dpaygRows, isAdminMode, section])

  return (
    <AccountContentShell
      title="Fares"
      detailsLayout
      trailingContent={<AdSlot variant="banner" />}
    >
      <div className="account-page fares-hub-page">
        <div
          className="account-layout station-details-layout"
          style={{ ['--station-details-min-section-count' as string]: 3 }}
        >
          <AccountSectionNav
            sections={sections}
            activeSectionId={section}
            onSelect={(sectionId) => {
              if (!isFaresHubSectionId(sectionId) || sectionId === section) return
              router.push(buildFaresHubPath(sectionId))
            }}
            ariaLabel="Fare products"
          />

          <main className="account-main station-details-main">
            <AdSlot variant="section" className="station-details-ad-slot--section" />
            <div className="account-card fares-hub-main">
              <section className="rs-account-section fares-hub-section" aria-labelledby="fares-hub-title">
                <h2 id="fares-hub-title" className="rs-account-section__title">
                  {meta.title}
                </h2>
                <div className="rs-account-section__body">
                  <p className="rs-account-section__copy">{meta.copy}</p>
                  {section === 'd-payg' && dpaygError ? (
                    <p className="rs-account-error" role="alert">
                      {dpaygError}
                    </p>
                  ) : null}
                  {section === 'd-payg' && dpaygLoading ? (
                    <p className="rs-account-info">Loading networks…</p>
                  ) : null}
                  {section === 'd-payg' && !dpaygLoading && cards.length === 0 && !dpaygError ? (
                    <p className="rs-account-info">No D-PAYG networks found in the catalogue.</p>
                  ) : null}
                  {cards.length > 0 ? (
                    <div className="fares-hub-network-grid">
                      {cards.map((card) => (
                        <TextCard
                          key={card.id}
                          to={card.href}
                          title={card.title}
                          description={card.description}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              </section>
            </div>
          </main>
        </div>
      </div>
    </AccountContentShell>
  )
}

export default FaresHubPageClient
