'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, usePathname, useRouter } from 'next/navigation'
import { MagnifyingGlass, MapTrifold } from '@phosphor-icons/react'

import AdSlot from '@/components/ads/AdSlot'
import DpaygTrialTabGroup from '@/components/tickets/DpaygTrialTabGroup'
import PaygAreaStationsMap from '@/components/tickets/PaygAreaStationsMap'
import TicketFareResults, { TicketFareCapsInline } from '@/components/tickets/TicketFareResults'
import TicketsFareSearchForm from '@/components/tickets/TicketsFareSearchForm'
import StationsDataBoundary from '@/contexts/StationsDataBoundary'
import {
  AccountContentShell,
} from '@/components/misc/AccountPageShell/AccountPageShell'
import {
  AccountSectionNav,
  type AccountSection,
} from '@/components/misc/AccountSectionNav/AccountSectionNav'
import type { DPAYGFare, DPAYGScheme, DPAYGStation } from '@/types/dpayg'
import type { PaygZoneCapBand } from '@/services/paygMatrixCatalog'
import type { OysterFareTypeDef } from '@/types/paygMatrix'
import { findPaygAreaDefBySlug } from '@/types/paygMatrix'
import { useStationAdminMode } from '@/hooks/useStationAdminMode'
import {
  buildDpaygOdSlug,
  buildPaygFaresPath,
  findSchemeByAreaSlug,
  getDpaygAreaSlug,
  hubPathForSearchBase,
  parseDpaygOdSlug,
} from '@/utils/dpaygUrl'
import { matchDpaygStation, stationSearchLabel } from '@/utils/dpaygStationSearch'

import '@/app/account/account.css'
import '@/app/stations/[network]/[stationSlug]/StationDetailsPage.css'
import '@/app/d-payg-fares/TicketsPage.css'

export type PaygLookupArea = DPAYGScheme & {
  zoneCapBands?: PaygZoneCapBand[]
  hideStationCodes?: boolean
  oysterFareTypes?: OysterFareTypeDef[]
  collectionId?: string
}

export type PaygLookupFareResult = {
  fare: DPAYGFare | null
  dailyCapPence?: number
  weeklyCapPence?: number
  originZone?: string
  destZone?: string
}

export type PaygFareLookupClientProps = {
  basePath: string
  title: string
  subtitle: string
  areaKind: 'trial' | 'payg'
  emptyIntro: string
  hubPath?: string
  loadAreas: () => Promise<PaygLookupArea[]>
  hydrateArea?: (
    area: PaygLookupArea,
    collectionId?: string
  ) => Promise<PaygLookupArea>
  getFare: (
    area: PaygLookupArea,
    originCrs: string,
    destCrs: string,
    collectionId?: string
  ) => Promise<PaygLookupFareResult>
}

const MIN_LOOKUP_SKELETON_MS = 500

function lookupPageSubtitle(
  scheme: PaygLookupArea | null,
  areaKind: 'trial' | 'payg',
  fallback: string
): string {
  if (!scheme) return fallback
  const area = scheme.shortName || scheme.name
  return areaKind === 'trial'
    ? `Look up published Digital PAYG singles and caps for ${area}.`
    : `Look up published singles and caps for ${area}.`
}

type LookupDisplay = {
  scheme: PaygLookupArea | null
  oysterTypeId: string
  origin: DPAYGStation | null
  dest: DPAYGStation | null
  fare: DPAYGFare | null
  searched: boolean
  journeyDailyCapPence?: number
  journeyWeeklyCapPence?: number
  error: string | null
}

const PaygFareLookupClient: React.FC<PaygFareLookupClientProps> = ({
  basePath,
  title,
  subtitle,
  areaKind,
  emptyIntro,
  hubPath,
  loadAreas,
  hydrateArea,
  getFare,
}) => {
  const router = useRouter()
  const pathname = usePathname() ?? basePath
  const resolvedHubPath = hubPath ?? hubPathForSearchBase(basePath)
  const isAdminMode = useStationAdminMode()
  const params = useParams()
  const slugParts = useMemo(() => {
    const raw = params.slug
    if (Array.isArray(raw)) return raw.map((part) => String(part).toLowerCase())
    if (typeof raw === 'string' && raw) return [raw.toLowerCase()]
    return [] as string[]
  }, [params.slug])
  const areaSlug = slugParts[0] ?? ''
  const publicBlockedArea =
    !isAdminMode && findPaygAreaDefBySlug(areaSlug)?.adminOnly === true
  const secondSlug = slugParts[1] ?? ''
  const fareTypeSlug =
    secondSlug && !parseDpaygOdSlug(secondSlug) ? secondSlug : ''
  const odSlug = fareTypeSlug ? slugParts[2] ?? '' : secondSlug
  const urlOd = useMemo(() => (odSlug ? parseDpaygOdSlug(odSlug) : null), [odSlug])

  const [schemes, setSchemes] = useState<PaygLookupArea[]>([])
  const [selectedSchemeId, setSelectedSchemeId] = useState('')
  const [oysterTypeId, setOysterTypeId] = useState('')
  const [scheme, setScheme] = useState<PaygLookupArea | null>(null)
  const [loadingSchemes, setLoadingSchemes] = useState(true)
  const [loadingScheme, setLoadingScheme] = useState(false)
  const [loadingFare, setLoadingFare] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  const [originQuery, setOriginQuery] = useState('')
  const [destQuery, setDestQuery] = useState('')
  const [origin, setOrigin] = useState<DPAYGStation | null>(null)
  const [dest, setDest] = useState<DPAYGStation | null>(null)
  const [fare, setFare] = useState<DPAYGFare | null>(null)
  const [journeyDailyCapPence, setJourneyDailyCapPence] = useState<number | undefined>()
  const [journeyWeeklyCapPence, setJourneyWeeklyCapPence] = useState<number | undefined>()
  const [searched, setSearched] = useState(false)
  const [sectionId, setSectionId] = useState<'search' | 'area-map'>('search')
  const [display, setDisplay] = useState<LookupDisplay>({
    scheme: null,
    oysterTypeId: '',
    origin: null,
    dest: null,
    fare: null,
    searched: false,
    error: null,
  })

  const appliedOdPathRef = useRef<string | null>(null)
  const searchGenerationRef = useRef(0)
  const hydratedCollectionRef = useRef<string | null>(null)

  useEffect(() => {
    void import('@/components/maps/StationsOsmMap')
  }, [])

  const syncPath = useCallback(
    (
      nextAreaSlug: string,
      nextOdSlug?: string | null,
      mode: 'push' | 'replace' = 'replace',
      nextFareType?: string | null
    ) => {
      const nextPath = buildPaygFaresPath(basePath, nextAreaSlug, nextOdSlug, nextFareType)
      if (nextPath === pathname) return
      if (mode === 'push') router.push(nextPath)
      else router.replace(nextPath)
    },
    [basePath, pathname, router]
  )

  const resetSearch = useCallback(() => {
    searchGenerationRef.current += 1
    setSearched(false)
    setOrigin(null)
    setDest(null)
    setFare(null)
    setJourneyDailyCapPence(undefined)
    setJourneyWeeklyCapPence(undefined)
    setSearchError(null)
    setLoadingFare(false)
  }, [])

  useEffect(() => {
    if (!publicBlockedArea) return
    router.replace(resolvedHubPath)
  }, [publicBlockedArea, resolvedHubPath, router])

  useEffect(() => {
    void (async () => {
      setLoadingSchemes(true)
      setLoadError(null)
      try {
        const rows = await loadAreas()
        setSchemes(rows)
      } catch (err) {
        setLoadError(err instanceof Error ? err.message : 'Failed to load fare areas.')
      } finally {
        setLoadingSchemes(false)
      }
    })()
  }, [loadAreas])

  useEffect(() => {
    if (loadingSchemes || schemes.length === 0) return
    if (!areaSlug) return

    const fromUrl = findSchemeByAreaSlug(schemes, areaSlug)
    if (!fromUrl) {
      router.replace(resolvedHubPath)
      return
    }

    const canonicalArea = getDpaygAreaSlug(fromUrl)
    if (areaSlug !== canonicalArea) {
      syncPath(canonicalArea, urlOd ? odSlug : null, 'replace', fareTypeSlug || null)
    }

    if (!oysterTypeId && fromUrl.oysterFareTypes?.length) {
      const fromSlug = fromUrl.oysterFareTypes.find((type) => type.id === fareTypeSlug)?.id
      setOysterTypeId(fromSlug ?? fromUrl.oysterFareTypes[0]!.id)
    }

    if (selectedSchemeId === fromUrl.id) return

    appliedOdPathRef.current = null
    if (!urlOd) {
      resetSearch()
      setOriginQuery('')
      setDestQuery('')
    }
    setSelectedSchemeId(fromUrl.id)
  }, [
    loadingSchemes,
    schemes,
    areaSlug,
    odSlug,
    urlOd,
    syncPath,
    selectedSchemeId,
    resetSearch,
    fareTypeSlug,
    oysterTypeId,
    router,
    resolvedHubPath,
  ])

  useEffect(() => {
    if (!selectedSchemeId) {
      setScheme(null)
      setLoadingScheme(false)
      return
    }

    const fromList = schemes.find((row) => row.id === selectedSchemeId) ?? null
    if (!fromList) {
      setLoadingScheme(false)
      return
    }
    if (fromList.oysterFareTypes?.length && !oysterTypeId) {
      return
    }

    const collectionId =
      fromList.oysterFareTypes?.find((type) => type.id === oysterTypeId)?.collectionId ??
      fromList.collectionId

    if (hydratedCollectionRef.current === collectionId) {
      setLoadingScheme(false)
      return
    }

    if (!hydrateArea) {
      setScheme(fromList)
      setLoadingScheme(false)
      setLoadError(null)
      hydratedCollectionRef.current = collectionId ?? null
      return
    }

    let cancelled = false
    setLoadingScheme(true)
    void (async () => {
      try {
        const hydrated = await hydrateArea(fromList, collectionId)
        if (cancelled) return
        hydratedCollectionRef.current = collectionId ?? null
        setScheme(hydrated)
        setLoadError(null)
        if (fromList.oysterFareTypes?.length && oysterTypeId) {
          const nextPath = buildPaygFaresPath(
            basePath,
            getDpaygAreaSlug(hydrated),
            urlOd ? odSlug : null,
            oysterTypeId
          )
          if (nextPath !== pathname) router.replace(nextPath)
        }
      } catch (err) {
        if (cancelled) return
        setScheme(fromList)
        setLoadError(err instanceof Error ? err.message : 'Failed to load this area.')
      } finally {
        if (!cancelled) setLoadingScheme(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [selectedSchemeId, schemes, hydrateArea, oysterTypeId, urlOd, odSlug, basePath, pathname, router])

  const handleOriginQueryChange = (value: string) => {
    setOriginQuery(value)
    if (!value.trim()) resetSearch()
  }

  const handleDestQueryChange = (value: string) => {
    setDestQuery(value)
    if (!value.trim()) resetSearch()
  }

  const handlePickStation = (field: 'origin' | 'dest', station: DPAYGStation) => {
    const label = stationSearchLabel(station, scheme?.hideStationCodes !== true)
    if (field === 'origin') setOriginQuery(label)
    else setDestQuery(label)
  }

  const runSearch = useCallback(
    async (opts?: {
      originCrs?: string
      destCrs?: string
      originQueryOverride?: string
      destQueryOverride?: string
      updateUrl?: boolean
    }) => {
      if (!scheme) return
      const generation = ++searchGenerationRef.current
      setLoadingFare(true)
      setSearchError(null)

      const matchedOrigin = opts?.originCrs
        ? scheme.stations.find((s) => s.crs.toUpperCase() === opts.originCrs!.toUpperCase()) ??
          null
        : matchDpaygStation(scheme.stations, opts?.originQueryOverride ?? originQuery)
      const matchedDest = opts?.destCrs
        ? scheme.stations.find((s) => s.crs.toUpperCase() === opts.destCrs!.toUpperCase()) ?? null
        : matchDpaygStation(scheme.stations, opts?.destQueryOverride ?? destQuery)

      if (!matchedOrigin || !matchedDest) {
        if (generation !== searchGenerationRef.current) return
        setOrigin(matchedOrigin)
        setDest(matchedDest)
        setFare(null)
        setJourneyDailyCapPence(undefined)
        setJourneyWeeklyCapPence(undefined)
        setSearched(true)
        if (matchedOrigin) {
          setOriginQuery(stationSearchLabel(matchedOrigin, scheme.hideStationCodes !== true))
        }
        if (matchedDest) {
          setDestQuery(stationSearchLabel(matchedDest, scheme.hideStationCodes !== true))
        }
        setLoadingFare(false)
        return
      }

      if (matchedOrigin.crs === matchedDest.crs) {
        if (generation !== searchGenerationRef.current) return
        setOrigin(matchedOrigin)
        setDest(matchedDest)
        setFare(null)
        setJourneyDailyCapPence(undefined)
        setJourneyWeeklyCapPence(undefined)
        setSearchError('Origin and destination must be different stations.')
        setSearched(true)
        setOriginQuery(stationSearchLabel(matchedOrigin, scheme.hideStationCodes !== true))
        setDestQuery(stationSearchLabel(matchedDest, scheme.hideStationCodes !== true))
        setLoadingFare(false)
        return
      }

      const nextOd = buildDpaygOdSlug(matchedOrigin.crs, matchedDest.crs)
      const fareType = scheme.oysterFareTypes?.length ? oysterTypeId || scheme.oysterFareTypes[0]!.id : null
      if (opts?.updateUrl !== false) {
        appliedOdPathRef.current = buildPaygFaresPath(
          basePath,
          getDpaygAreaSlug(scheme),
          nextOd,
          fareType
        )
        syncPath(getDpaygAreaSlug(scheme), nextOd, 'replace', fareType)
      }

      try {
        const collectionId =
          scheme.oysterFareTypes?.find((type) => type.id === oysterTypeId)?.collectionId ??
          scheme.collectionId
        const loaded = await getFare(scheme, matchedOrigin.crs, matchedDest.crs, collectionId)
        if (generation !== searchGenerationRef.current) return
        setOrigin(
          loaded.originZone ? { ...matchedOrigin, zone: loaded.originZone } : matchedOrigin
        )
        setDest(loaded.destZone ? { ...matchedDest, zone: loaded.destZone } : matchedDest)
        setFare(loaded.fare)
        setJourneyDailyCapPence(loaded.dailyCapPence)
        setJourneyWeeklyCapPence(loaded.weeklyCapPence)
        setSearched(true)
        setOriginQuery(stationSearchLabel(matchedOrigin, scheme.hideStationCodes !== true))
        setDestQuery(stationSearchLabel(matchedDest, scheme.hideStationCodes !== true))
      } catch (err) {
        if (generation !== searchGenerationRef.current) return
        setOrigin(matchedOrigin)
        setDest(matchedDest)
        setSearchError(err instanceof Error ? err.message : 'Failed to load fare.')
        setFare(null)
        setJourneyDailyCapPence(undefined)
        setJourneyWeeklyCapPence(undefined)
        setSearched(true)
        setOriginQuery(stationSearchLabel(matchedOrigin, scheme.hideStationCodes !== true))
        setDestQuery(stationSearchLabel(matchedDest, scheme.hideStationCodes !== true))
      } finally {
        if (generation === searchGenerationRef.current) setLoadingFare(false)
      }
    },
    [scheme, originQuery, destQuery, syncPath, getFare, basePath, oysterTypeId]
  )

  useEffect(() => {
    if (!scheme || !urlOd || loadingScheme) return
    const pathKey = buildPaygFaresPath(
      basePath,
      getDpaygAreaSlug(scheme),
      odSlug,
      scheme.oysterFareTypes?.length ? oysterTypeId : null
    )
    if (appliedOdPathRef.current === pathKey) return
    appliedOdPathRef.current = pathKey
    void runSearch({
      originCrs: urlOd.originCrs,
      destCrs: urlOd.destCrs,
      updateUrl: false,
    })
  }, [scheme, urlOd, odSlug, areaSlug, loadingScheme, runSearch, basePath, oysterTypeId])

  const lookupBusy = loadingSchemes || loadingScheme || loadingFare
  const [holdSkeleton, setHoldSkeleton] = useState(true)

  useEffect(() => {
    if (lookupBusy) {
      setHoldSkeleton(true)
      return
    }
    const timer = window.setTimeout(() => setHoldSkeleton(false), MIN_LOOKUP_SKELETON_MS)
    return () => window.clearTimeout(timer)
  }, [lookupBusy])

  const panelBusy = lookupBusy || holdSkeleton

  useEffect(() => {
    if (panelBusy) return
    setDisplay({
      scheme,
      oysterTypeId,
      origin,
      dest,
      fare,
      searched,
      journeyDailyCapPence,
      journeyWeeklyCapPence,
      error: searchError ?? loadError,
    })
  }, [
    panelBusy,
    scheme,
    oysterTypeId,
    origin,
    dest,
    fare,
    searched,
    journeyDailyCapPence,
    journeyWeeklyCapPence,
    searchError,
    loadError,
  ])

  const searchDisabled = useMemo(
    () => !display.scheme || !originQuery.trim() || !destQuery.trim() || panelBusy,
    [display.scheme, originQuery, destQuery, panelBusy]
  )

  const sections = useMemo(
    (): AccountSection[] => [
      { id: 'search', label: 'Search Fares', icon: MagnifyingGlass },
      { id: 'area-map', label: 'Area Map', icon: MapTrifold },
    ],
    []
  )

  if (publicBlockedArea) return null

  if (!loadingSchemes && schemes.length > 0 && !findSchemeByAreaSlug(schemes, areaSlug)) {
    return null
  }

  const areaFromList = areaSlug ? findSchemeByAreaSlug(schemes, areaSlug) : null
  const oysterFareTypes =
    areaFromList?.oysterFareTypes ?? display.scheme?.oysterFareTypes ?? scheme?.oysterFareTypes
  const oysterTabValue =
    display.oysterTypeId || oysterTypeId || fareTypeSlug || oysterFareTypes?.[0]?.id || ''
  const oysterTabs =
    oysterFareTypes && oysterFareTypes.length > 0 ? (
      <div className="tickets-lookup-oyster-tabs">
        <DpaygTrialTabGroup
          tabs={oysterFareTypes.map((type) => ({
            id: type.id,
            label: type.label,
          }))}
          value={oysterTabValue}
          skeleton={panelBusy}
          onChange={(nextType) => {
            if (panelBusy) return
            setOysterTypeId(nextType)
            setLoadingScheme(true)
            appliedOdPathRef.current = null
          }}
          ariaLabel="Oyster ticket type"
        />
      </div>
    ) : null

  return (
    <AccountContentShell
      title={title}
      subtitle={lookupPageSubtitle(
        display.scheme ?? areaFromList ?? scheme,
        areaKind,
        subtitle
      )}
      actionButton={{ to: resolvedHubPath, label: 'Back' }}
      trailingContent={<AdSlot variant="banner" />}
      detailsLayout
    >
      <div className="account-page tickets-page tickets-lookup-page">
        <div
          className="account-layout station-details-layout"
          style={{
            ['--station-details-min-section-count' as string]: sections.length,
          }}
        >
          <AccountSectionNav
            sections={sections}
            activeSectionId={sectionId}
            onSelect={(nextId) => {
              if (nextId === 'search' || nextId === 'area-map') setSectionId(nextId)
            }}
            ariaLabel="Fare sections"
          />

          <main className="account-main station-details-main">
            <AdSlot variant="section" className="station-details-ad-slot--section" />
            <div
              className={[
                'account-card tickets-lookup-card',
                sectionId === 'area-map' ? 'tickets-lookup-card--map' : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {sectionId === 'area-map' ? (
                <StationsDataBoundary>
                  <PaygAreaStationsMap
                    paygStations={
                      (display.scheme ?? areaFromList ?? scheme)?.stations ?? []
                    }
                    areaName={
                      (display.scheme ?? areaFromList ?? scheme)?.shortName ||
                      (display.scheme ?? areaFromList ?? scheme)?.name ||
                      title
                    }
                    areaId={
                      (display.scheme ?? areaFromList ?? scheme)?.id ??
                      (display.scheme ?? areaFromList ?? scheme)?.collectionId
                    }
                    origin={display.origin}
                    dest={display.dest}
                    searched={display.searched}
                  />
                </StationsDataBoundary>
              ) : (
              <div
                className="tickets-lookup-search"
                aria-busy={panelBusy || undefined}
              >
                  {oysterTabs}
                  <div className="tickets-lookup-body">
                    <div className="tickets-lookup-main">
                      <TicketsFareSearchForm
                        scheme={display.scheme}
                        originQuery={originQuery}
                        destQuery={destQuery}
                        onOriginQueryChange={handleOriginQueryChange}
                        onDestQueryChange={handleDestQueryChange}
                        onSearch={() => void runSearch()}
                        searchDisabled={searchDisabled}
                        onPickStation={handlePickStation}
                        showStationCodes={display.scheme?.hideStationCodes !== true}
                        skeleton={panelBusy}
                      />
                      <div className="tickets-lookup-fares">
                        <TicketFareResults
                          scheme={display.scheme}
                          origin={display.origin}
                          dest={display.dest}
                          fare={display.fare}
                          searched={display.searched}
                          loading={panelBusy}
                          error={display.error}
                          areaKind={areaKind}
                          emptyIntro={emptyIntro}
                          showStationCodes={display.scheme?.hideStationCodes !== true}
                          framed={false}
                          skeleton={panelBusy}
                          onViewRouteOnMap={
                            display.searched && display.origin && display.dest
                              ? () => setSectionId('area-map')
                              : undefined
                          }
                        />
                      </div>
                    </div>
                    <div className="tickets-lookup-caps">
                      <TicketFareCapsInline
                        scheme={display.scheme}
                        zoneCapBands={display.scheme?.zoneCapBands}
                        journeyDailyCapPence={display.journeyDailyCapPence}
                        journeyWeeklyCapPence={display.journeyWeeklyCapPence}
                        skeleton={panelBusy}
                      />
                    </div>
                  </div>
              </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </AccountContentShell>
  )
}

export default PaygFareLookupClient
