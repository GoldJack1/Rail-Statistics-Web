'use client'

import { useRouter, useParams } from 'next/navigation'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { useStationDetailsRoute } from '@/hooks/useStationDetailsRoute'
import { useStationCollectionFieldSchema } from '@/hooks/useStationCollectionFieldSchema'
import { useKnowledgebaseStation } from '@/hooks/useKnowledgebaseStation'
import type { SandboxStationDoc } from '@/types'
import {
  buildStationPath,
  getStationNetworkCollectionId,
} from '@/utils/stationAreaSlug'
import { isStationCollectionId } from '@/constants/stationCollections'
import { useStationCollection } from '@/contexts/StationCollectionContext'
import { useAuth } from '@/contexts/AuthContext'
import { usePendingStationChanges } from '@/hooks/usePendingStationChanges'
import { useStationAdminMode } from '@/hooks/useStationAdminMode'
import {
  getPendingFieldChangesForEntry,
  mergeAdditionalDocWithPendingUpdate,
  mergeStationWithPendingUpdate,
} from '@/utils/applyPendingChangesForDisplay'
import {
  EMPTY_STATION_COLLECTION_FIELD_SCHEMA,
  getVisibleStationDetailsTabs,
  inferStationCollectionFieldSchema,
  mergeStationCollectionFieldSchemas,
  stationDetailsShowsAdditionalTab,
  type StationDetailsTab,
} from '@/utils/stationCollectionFieldSchema'
import { getStationDetailsTabSubheaders } from '@/utils/stationDetailsTabSubheaders'
import StationDetailsView from '@/components/models/StationDetails/StationDetailsView'
import StationDetailsSectionNav from '@/components/models/StationDetails/StationDetailsSectionNav'
import {
  StationDetailsHeaderSkeleton,
  StationDetailsHeaderSubtitleSkeleton,
  StationDetailsHeaderEyebrowSkeleton,
  StationDetailsMainSkeleton,
  buildStationDetailsSkeletonTabs,
} from '@/components/models/StationDetails/StationDetailsSkeleton'
import { BUTWideButton } from '@/components/buttons'
import { BUTCircleButton } from '@/components/buttons'
import { BackIcon } from '@/components/icons'
import PageTopHeader from '@/components/misc/PageTopHeader/PageTopHeader'
import AdSlot from '@/components/ads/AdSlot'
import '@/components/models/StationModal/StationModal.css'
import { PencilSimple } from '@phosphor-icons/react'
import { paramAsString } from '@/utils/nextParams'
import { setStationDetailsNavigationState, readStationDetailsNavigationState } from '@/utils/clientNavigationState'
import { formatStationDetailsHeaderManagedByToc, formatStationDetailsHeaderSubtitle, getStationDetailsHeaderToc } from '@/utils/formatStationDetailsHeader'
import { isLightRailStop } from '@/utils/stationCardForNetwork'
import { useTocOperators } from '@/hooks/useTocOperators'
import { resolveTocOperatorDisplayName } from '@/services/tocOperators'
import { parseStationTocValues } from '@/components/models/StationDetails/StationTocChips'
import {
  isKnowledgebaseTabId,
  KNOWLEDGEBASE_OVERVIEW_KEY,
  parseKnowledgebaseTabId,
  toKnowledgebaseTabId,
} from '@/utils/knowledgebaseStationSections'
import '@/components/models/StationDetails/StationKnowledgebasePanel.css'
import {
  readKnowledgebaseSourceCompareEnabled,
  writeKnowledgebaseSourceCompareEnabled,
  SOURCE_COMPARE_CHANGED_EVENT,
} from '@/utils/knowledgebaseSourceCompareStorage'
import './StationDetailsPage.css'

function getStationDetailsReturnPath(state: unknown): string {
  if (state && typeof state === 'object' && 'returnTo' in state) {
    const returnTo = (state as { returnTo?: unknown }).returnTo
    if (typeof returnTo === 'string' && returnTo.startsWith('/')) return returnTo
  }
  return '/stations'
}

/** Desktop left-nav floor: 11 section rows × 64px (matches StationDetailsPage.css). */
const DESKTOP_SECTION_NAV_MIN_HEIGHT_PX = 11 * 64
const DESKTOP_CHART_MEDIA = '(min-width: 1024px)'

const STATIC_STATION_DETAILS_TAB_IDS = new Set<string>([
  'details',
  'location',
  'usage',
  'additional',
  'stepFree',
  'service',
  'facilities',
  'admin',
])

function parseStationDetailsTabHash(hash: string): StationDetailsTab | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  if (!raw) return null
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    // Keep the raw hash if it is not URI-encoded.
  }
  if (STATIC_STATION_DETAILS_TAB_IDS.has(decoded) || decoded.startsWith('kb:')) {
    return decoded as StationDetailsTab
  }
  return null
}

function readStationDetailsTabFromHash(): StationDetailsTab | null {
  if (typeof window === 'undefined') return null
  return parseStationDetailsTabHash(window.location.hash)
}

/** Persist section in the URL so refresh keeps the active left-nav tab. */
function writeStationDetailsTabHash(tab: StationDetailsTab): void {
  if (typeof window === 'undefined') return
  const nextHash = tab === 'details' ? '' : `#${encodeURIComponent(tab)}`
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`
  const next = `${window.location.pathname}${window.location.search}${nextHash}`
  if (current === next) return
  window.history.replaceState(window.history.state, '', next)
}

/** Minimum time the loading skeleton stays visible so fast cache hits do not flash. */
const MIN_SKELETON_MS = 1500

function StationDetailsPage() {
  const router = useRouter()
  const backPath = getStationDetailsReturnPath(readStationDetailsNavigationState())
  const navigationState = readStationDetailsNavigationState()
  const params = useParams()
  const network = paramAsString(params.network)
  const stationSlug = paramAsString(params.stationSlug)
  const { collectionId } = useStationCollection()
  const { user, loading: authLoading } = useAuth()
  const canEdit = !authLoading && Boolean(user)
  const isAdminMode = useStationAdminMode()
  const { station, loading, error, routeCollectionId } = useStationDetailsRoute(network, stationSlug)
  const [additionalDoc, setAdditionalDoc] = useState<SandboxStationDoc | null>(null)
  const [additionalLoading, setAdditionalLoading] = useState(true)
  /** Null until the URL hash is read — avoids painting Details then snapping to the real section. */
  const [activeTab, setActiveTab] = useState<StationDetailsTab | null>(null)
  const [maxTabContentHeight, setMaxTabContentHeight] = useState(0)
  const [sourceCompareEnabled, setSourceCompareEnabled] = useState(false)
  const [minSkeletonElapsed, setMinSkeletonElapsed] = useState(false)
  /** GBNR: null while ORR usage lookup is pending; false when no Table 1415 data. */
  const [gbnrUsageAvailable, setGbnrUsageAvailable] = useState<boolean | null>(null)
  const visibleBodyRef = useRef<HTMLDivElement | null>(null)
  const tabMeasureRefs = useRef<Partial<Record<StationDetailsTab, HTMLDivElement | null>>>({})

  const selectTab = useCallback((tab: StationDetailsTab) => {
    setActiveTab(tab)
    writeStationDetailsTabHash(tab)
  }, [])

  // Resolve section from URL hash before paint (refresh / shared links).
  useLayoutEffect(() => {
    setActiveTab(readStationDetailsTabFromHash() ?? 'details')
  }, [network, stationSlug])

  useEffect(() => {
    const onHashChange = () => {
      setActiveTab(readStationDetailsTabFromHash() ?? 'details')
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    setGbnrUsageAvailable(null)
  }, [station?.id])

  useEffect(() => {
    if (typeof window === 'undefined') return
    setMinSkeletonElapsed(false)
    const timer = window.setTimeout(() => setMinSkeletonElapsed(true), MIN_SKELETON_MS)
    return () => window.clearTimeout(timer)
  }, [station?.id, network, stationSlug])

  useEffect(() => {
    const sync = () => setSourceCompareEnabled(readKnowledgebaseSourceCompareEnabled())
    sync()
    window.addEventListener(SOURCE_COMPARE_CHANGED_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(SOURCE_COMPARE_CHANGED_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const { pendingChanges } = usePendingStationChanges()
  const pendingEntry = station ? pendingChanges[station.id] : undefined
  const pendingFieldChanges = useMemo(
    () => getPendingFieldChangesForEntry(pendingEntry, { additionalDocFallback: additionalDoc }),
    [pendingEntry, additionalDoc]
  )
  const displayStation = useMemo(
    () => (station ? mergeStationWithPendingUpdate(station, pendingEntry) : null),
    [station, pendingEntry]
  )
  const displayAdditionalDoc = useMemo(
    () => mergeAdditionalDocWithPendingUpdate(additionalDoc, pendingEntry),
    [additionalDoc, pendingEntry]
  )
  const showPendingOverlay = canEdit && Boolean(pendingEntry) && pendingFieldChanges.length > 0

  const schemaCollectionId = useMemo(() => {
    if (station) {
      const resolved = getStationNetworkCollectionId(station, routeCollectionId ?? collectionId)
      return resolved && isStationCollectionId(resolved) ? resolved : null
    }
    return routeCollectionId && isStationCollectionId(routeCollectionId) ? routeCollectionId : null
  }, [station, routeCollectionId, collectionId])
  const catalogFieldSchema = useMemo(
    () =>
      schemaCollectionId
        ? inferStationCollectionFieldSchema([], schemaCollectionId)
        : EMPTY_STATION_COLLECTION_FIELD_SCHEMA,
    [schemaCollectionId]
  )
  // Collection sample restores which tabs exist for the network; the station's own doc
  // restores sections that catalog defaults hide (Usage, Facilities, Service, etc.).
  const { fieldSchema: sampledFieldSchema } = useStationCollectionFieldSchema(schemaCollectionId)
  const fieldSchema = useMemo(() => {
    // Hook already paints catalog (or cache) immediately — never swap back to a thinner schema
    // while the collection sample loads (that was flashing empty optional rows).
    const base =
      sampledFieldSchema.defaultStnarea !== '' ? sampledFieldSchema : catalogFieldSchema
    if (!additionalDoc || !schemaCollectionId) return base
    const fromStationDoc = inferStationCollectionFieldSchema(
      [additionalDoc as Record<string, unknown>],
      schemaCollectionId
    )
    return mergeStationCollectionFieldSchemas(base, fromStationDoc)
  }, [catalogFieldSchema, sampledFieldSchema, additionalDoc, schemaCollectionId])
  const showAdditionalTab = stationDetailsShowsAdditionalTab(fieldSchema)
  const showAdminSection = fieldSchema.showAdminTab && isAdminMode
  const visibleTabs = useMemo(
    () =>
      getVisibleStationDetailsTabs(fieldSchema).filter(
        (tab) => tab !== 'admin' || showAdminSection
      ),
    [fieldSchema, showAdminSection]
  )

  const knowledgebase = useKnowledgebaseStation(
    station?.crsCode,
    fieldSchema.showKnowledgebaseTab
  )

  // Measuring the location tab mounts Leaflet/ORM tiles — skip it for height measurement.
  // Knowledgebase section tabs are skipped (content height varies / already prefetched).
  const measureTabs = useMemo(
    () => visibleTabs.filter((tab) => tab !== 'location' && !isKnowledgebaseTabId(tab)),
    [visibleTabs]
  )

  const sectionTabs = useMemo(() => {
    const showKnowledgebaseAddress =
      fieldSchema.showKnowledgebaseTab &&
      (knowledgebase.status === 'loading' ||
        knowledgebase.status === 'idle' ||
        (knowledgebase.status === 'ready' && Boolean(knowledgebase.postalAddress)))

    const subheadersFor = (id: StationDetailsTab) =>
      getStationDetailsTabSubheaders(id, fieldSchema, {
        showKnowledgebaseAddress,
        showSourceCompare: fieldSchema.showKnowledgebaseTab && canEdit,
      })

    const tabs: Array<{
      id: StationDetailsTab
      label: string
      knowledgebase?: boolean
      sectionKey?: string
      subheaders?: string[]
    }> = [{ id: 'details', label: 'Details', subheaders: subheadersFor('details') }]
    if (showAdditionalTab) {
      tabs.push({
        id: 'additional',
        label: 'Additional details',
        subheaders: subheadersFor('additional'),
      })
    }
    if (fieldSchema.showServiceTab) {
      tabs.push({
        id: 'service',
        label: 'Service & Connections',
        subheaders: subheadersFor('service'),
      })
    }
    tabs.push({ id: 'location', label: 'Location', subheaders: subheadersFor('location') })
    const showUsageNavTab =
      fieldSchema.showUsageTab &&
      (!fieldSchema.showKnowledgebaseTab || gbnrUsageAvailable === true)
    if (showUsageNavTab) {
      tabs.push({ id: 'usage', label: 'Station Usage', subheaders: subheadersFor('usage') })
    }
    if (fieldSchema.showStepFreeTab) {
      tabs.push({
        id: 'stepFree',
        label: fieldSchema.stepFreeTabLabel,
        subheaders: subheadersFor('stepFree'),
      })
    }
    if (fieldSchema.showFacilitiesTab) {
      tabs.push({
        id: 'facilities',
        label: 'Facilities',
        subheaders: subheadersFor('facilities'),
      })
    }
    if (fieldSchema.showKnowledgebaseTab && knowledgebase.status === 'ready') {
      for (const section of knowledgebase.sections) {
        if (section.key === KNOWLEDGEBASE_OVERVIEW_KEY) continue
        tabs.push({
          id: toKnowledgebaseTabId(section.key),
          label: section.label,
          knowledgebase: true,
          sectionKey: section.key,
          subheaders: [],
        })
      }
    }
    if (showAdminSection) {
      tabs.push({ id: 'admin', label: 'Admin', subheaders: subheadersFor('admin') })
    }
    return tabs
  }, [
    showAdditionalTab,
    fieldSchema,
    knowledgebase,
    canEdit,
    showAdminSection,
    gbnrUsageAvailable,
  ])

  const activeKnowledgebaseSection = useMemo(() => {
    if (!activeTab || !isKnowledgebaseTabId(activeTab) || knowledgebase.status !== 'ready') {
      return null
    }
    const key = parseKnowledgebaseTabId(activeTab)
    if (!key || key === KNOWLEDGEBASE_OVERVIEW_KEY) return null
    return knowledgebase.sections.find((section) => section.key === key) ?? null
  }, [activeTab, knowledgebase])

  const knowledgebaseStationOperator =
    knowledgebase.status === 'ready' ? knowledgebase.stationOperator : null
  const knowledgebaseNlc = knowledgebase.status === 'ready' ? knowledgebase.nlc : null
  const knowledgebasePostalAddress =
    knowledgebase.status === 'ready' ? knowledgebase.postalAddress : null
  const knowledgebaseStationAlert =
    knowledgebase.status === 'ready' ? knowledgebase.stationAlert : null
  const knowledgebaseLastUpdatedLabel =
    knowledgebase.status === 'ready' ? knowledgebase.lastUpdatedLabel : null
  const knowledgebaseDetailsSourceHint =
    knowledgebase.status === 'ready' ? knowledgebase.detailsSourceHint : null

  const headerDisplayStation = displayStation ?? station
  const headerIsLightRail = Boolean(headerDisplayStation && isLightRailStop(headerDisplayStation))
  const headerTocRaw = headerDisplayStation ? getStationDetailsHeaderToc(headerDisplayStation) : ''
  const headerTocPrimary = parseStationTocValues(headerTocRaw)[0] ?? headerTocRaw
  const tocOperators = useTocOperators(Boolean(headerDisplayStation) && !headerIsLightRail && Boolean(headerTocPrimary))
  const headerManagedByToc = useMemo(() => {
    if (!headerDisplayStation || headerIsLightRail) return ''
    const displayName = headerTocPrimary
      ? resolveTocOperatorDisplayName(tocOperators.operators, headerTocPrimary)
      : ''
    const tocCode = !fieldSchema.showKnowledgebaseTab
      ? null
      : knowledgebase.status === 'loading' || knowledgebase.status === 'idle'
        ? '…'
        : knowledgebaseStationOperator
    return formatStationDetailsHeaderManagedByToc(displayName || headerTocPrimary, tocCode)
  }, [
    headerDisplayStation,
    headerIsLightRail,
    headerTocPrimary,
    tocOperators.operators,
    fieldSchema.showKnowledgebaseTab,
    knowledgebase.status,
    knowledgebaseStationOperator,
  ])

  const headerEyebrow = useMemo(() => {
    if (!headerDisplayStation) return undefined
    if (headerIsLightRail) {
      if (!headerTocRaw) return undefined
      return <span className="station-details-header-toc">{headerTocRaw}</span>
    }
    if (!headerManagedByToc) return undefined
    return (
      <span className="station-details-header-managed-by">
        <span className="station-details-header-managed-by__label">Station Managed by:</span>
        <span className="station-details-header-managed-by__toc">{headerManagedByToc}</span>
      </span>
    )
  }, [headerDisplayStation, headerIsLightRail, headerTocRaw, headerManagedByToc])

  const kbPending =
    fieldSchema.showKnowledgebaseTab &&
    (knowledgebase.status === 'idle' || knowledgebase.status === 'loading')
  const dataPending = loading || !station || additionalLoading || kbPending
  const sectionPending = activeTab === null
  const showContentSkeleton = !error && (sectionPending || dataPending || !minSkeletonElapsed)

  useEffect(() => {
    // Wait until the hash is applied and tab availability is known — otherwise a thin
    // early schema briefly forces Details and clears the restored section.
    if (activeTab === null || dataPending || !minSkeletonElapsed) return
    if (activeTab === 'additional' && !showAdditionalTab) selectTab('details')
    if (activeTab === 'service' && !fieldSchema.showServiceTab) selectTab('details')
    if (activeTab === 'usage' && !fieldSchema.showUsageTab) selectTab('details')
    if (
      activeTab === 'usage' &&
      fieldSchema.showKnowledgebaseTab &&
      gbnrUsageAvailable === false
    ) {
      selectTab('details')
    }
    if (activeTab === 'stepFree' && !fieldSchema.showStepFreeTab) selectTab('details')
    if (activeTab === 'facilities' && !fieldSchema.showFacilitiesTab) selectTab('details')
    if (isKnowledgebaseTabId(activeTab) && !fieldSchema.showKnowledgebaseTab) selectTab('details')
    if (
      isKnowledgebaseTabId(activeTab) &&
      parseKnowledgebaseTabId(activeTab) === KNOWLEDGEBASE_OVERVIEW_KEY
    ) {
      selectTab(showAdminSection ? 'admin' : 'details')
    }
    if (
      isKnowledgebaseTabId(activeTab) &&
      knowledgebase.status === 'ready' &&
      !activeKnowledgebaseSection &&
      parseKnowledgebaseTabId(activeTab) !== '__loading__' &&
      parseKnowledgebaseTabId(activeTab) !== KNOWLEDGEBASE_OVERVIEW_KEY
    ) {
      selectTab('details')
    }
    if (activeTab === 'admin' && !showAdminSection) selectTab('details')
  }, [
    activeTab,
    dataPending,
    minSkeletonElapsed,
    showAdditionalTab,
    fieldSchema.showServiceTab,
    fieldSchema.showUsageTab,
    fieldSchema.showStepFreeTab,
    fieldSchema.showFacilitiesTab,
    fieldSchema.showKnowledgebaseTab,
    showAdminSection,
    knowledgebase.status,
    activeKnowledgebaseSection,
    gbnrUsageAvailable,
    selectTab,
  ])

  useEffect(() => {
    if (!station) return
    document.title = `${station.stationName || 'Station'} | Rail Statistics`
  }, [station])

  useEffect(() => {
    // Full station document (usage, facilities, connections, location, etc.). Firebase is
    // imported dynamically so it stays off the initial parse, but it loads for every station
    // so all tabs have their data.
    if (!station) return
    let cancelled = false
    setAdditionalLoading(true)
    setAdditionalDoc(null)
    void import('@/services/firebase')
      .then(({ fetchStationDocumentById }) =>
        fetchStationDocumentById(
          station.id,
          getStationNetworkCollectionId(station, routeCollectionId ?? collectionId) ?? collectionId
        )
      )
      .then((data) => {
        if (cancelled) return
        setAdditionalDoc((data as SandboxStationDoc) ?? null)
      })
      .finally(() => {
        if (!cancelled) setAdditionalLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [station?.id, station?.sourceCollectionId, collectionId, routeCollectionId])

  useLayoutEffect(() => {
    const measureHeights = () => {
      const heights = measureTabs
        .map((tab) => {
          const pane = tabMeasureRefs.current[tab]
          if (!pane) return 0
          return Math.ceil(pane.getBoundingClientRect().height)
        })
        .filter((height) => height > 0)

      const visibleHeight = Math.ceil(visibleBodyRef.current?.getBoundingClientRect().height ?? 0)
      const desktopFloor = window.matchMedia(DESKTOP_CHART_MEDIA).matches
        ? DESKTOP_SECTION_NAV_MIN_HEIGHT_PX
        : 0
      const nextMax = Math.max(desktopFloor, visibleHeight, ...(heights.length > 0 ? heights : [0]))
      if (nextMax <= 0) return
      setMaxTabContentHeight((current) => (current === nextMax ? current : nextMax))
    }

    measureHeights()
    const frameA = window.requestAnimationFrame(measureHeights)
    const frameB = window.requestAnimationFrame(measureHeights)
    window.addEventListener('resize', measureHeights)
    return () => {
      window.cancelAnimationFrame(frameA)
      window.cancelAnimationFrame(frameB)
      window.removeEventListener('resize', measureHeights)
    }
  }, [station?.id, additionalDoc, additionalLoading, measureTabs])

  useEffect(() => {
    setMaxTabContentHeight(0)
  }, [station?.id])

  const skeletonTabs = buildStationDetailsSkeletonTabs(
    sectionTabs,
    fieldSchema.showKnowledgebaseTab
  )
  const navTabs = showContentSkeleton ? skeletonTabs : sectionTabs

  const headerActions = (
    <div className="station-details-header-actions">
      <div className="station-details-header-actions__controls">
        <BUTWideButton
          type="button"
          width="hug"
          icon={<BackIcon />}
          onClick={() => router.push(backPath)}
        >
          Back
        </BUTWideButton>
        {station && isAdminMode ? (
          <BUTCircleButton
            type="button"
            ariaLabel="Edit station"
            onClick={() => {
              setStationDetailsNavigationState(navigationState)
              router.push(`/admin/stations/${buildStationPath(station, collectionId)}/edit`)
            }}
            icon={<PencilSimple size={16} aria-hidden />}
          />
        ) : null}
      </div>
    </div>
  )

  const headerBannerAd = <AdSlot variant="banner" />

  if (error && !station) {
    return (
      <div className="container container--station-details">
        <PageTopHeader
          title="Failed to load station"
          subtitle={error}
          actionContent={headerActions}
          trailingContent={headerBannerAd}
        />
        <AdSlot variant="section" />
      </div>
    )
  }

  if (!loading && (!network || !stationSlug || !station)) {
    return (
      <div className="container container--station-details">
        <PageTopHeader
          title="Station not found"
          subtitle="We couldn’t find that station in the current data source."
          actionContent={headerActions}
          trailingContent={headerBannerAd}
        />
        <AdSlot variant="section" />
      </div>
    )
  }

  const stationName = station
    ? (displayStation ?? station).stationName || 'Station'
    : null
  const headerTitle = stationName ?? <StationDetailsHeaderSkeleton />
  const headerEyebrowNode = station
    ? headerEyebrow
    : fieldSchema.showKnowledgebaseTab
      ? <StationDetailsHeaderEyebrowSkeleton />
      : undefined
  const headerSubtitleNode = station
    ? formatStationDetailsHeaderSubtitle(displayStation ?? station, {
        pendingSuffix: showPendingOverlay ? 'Unpublished changes' : null,
      })
    : <StationDetailsHeaderSubtitleSkeleton />

  return (
    <div className="container container--station-details">
      <PageTopHeader
        eyebrow={headerEyebrowNode}
        title={headerTitle}
        subtitle={headerSubtitleNode}
        actionContent={headerActions}
        trailingContent={headerBannerAd}
      />
      <div
        className={[
          'station-details-page',
          fieldSchema.showKnowledgebaseTab && sourceCompareEnabled
            ? 'station-details--source-compare'
            : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="station-details-layout">
          <StationDetailsSectionNav
            tabs={navTabs}
            activeTab={activeTab}
            onSelect={selectTab}
            ariaLabel="Station sections"
            markFirebaseTabs={fieldSchema.showKnowledgebaseTab}
            loading={showContentSkeleton}
          />

          <main className="station-details-main" aria-busy={showContentSkeleton}>
            <AdSlot variant="section" className="station-details-ad-slot--section" />
            <section className="station-details-card modal-content">
              <div
                className="modal-body station-details-visible-body"
                ref={station ? visibleBodyRef : undefined}
                style={
                  showContentSkeleton || !station
                    ? { minHeight: `${DESKTOP_SECTION_NAV_MIN_HEIGHT_PX}px` }
                    : maxTabContentHeight > 0
                      ? { minHeight: `${maxTabContentHeight}px` }
                      : undefined
                }
              >
                {showContentSkeleton || !station || !activeTab ? (
                  <StationDetailsMainSkeleton
                    showCodeChips={!fieldSchema.isLightRail}
                    showKnowledgebase={fieldSchema.showKnowledgebaseTab}
                    isLightRail={fieldSchema.isLightRail}
                  />
                ) : (
                  <>
                    <StationDetailsView
                      station={displayStation ?? station}
                      additionalDoc={displayAdditionalDoc}
                      additionalLoading={additionalLoading}
                      activeTab={activeTab}
                      fieldSchema={fieldSchema}
                      pendingFieldChanges={showPendingOverlay ? pendingFieldChanges : undefined}
                      isPendingNew={pendingEntry?.isNew === true}
                      knowledgebaseSection={activeKnowledgebaseSection}
                      knowledgebaseSections={
                        knowledgebase.status === 'ready' ? knowledgebase.sections : []
                      }
                      knowledgebaseStatus={knowledgebase.status}
                      knowledgebaseError={
                        knowledgebase.status === 'error' ? knowledgebase.message : undefined
                      }
                      knowledgebaseCrs={
                        knowledgebase.status === 'ready' ? knowledgebase.crs : station.crsCode
                      }
                      knowledgebaseFetchedAt={
                        knowledgebase.status === 'ready' ? knowledgebase.fetchedAt : undefined
                      }
                      knowledgebaseLastUpdatedLabel={knowledgebaseLastUpdatedLabel}
                      knowledgebaseDetailsSourceHint={knowledgebaseDetailsSourceHint}
                      knowledgebaseStationOperator={knowledgebaseStationOperator}
                      knowledgebaseNlc={knowledgebaseNlc}
                      knowledgebasePostalAddress={knowledgebasePostalAddress}
                      knowledgebaseStationAlert={knowledgebaseStationAlert}
                      sourceCompareEnabled={sourceCompareEnabled}
                      onSourceCompareChange={(enabled) => {
                        writeKnowledgebaseSourceCompareEnabled(enabled)
                        setSourceCompareEnabled(enabled)
                      }}
                      onGbnrUsageAvailabilityChange={setGbnrUsageAvailable}
                    />
                    <div className="station-details-measure-layer" aria-hidden="true">
                      {measureTabs.map((tab) => (
                        <div
                          key={tab}
                          className="station-details-measure-pane"
                          ref={(el) => {
                            tabMeasureRefs.current[tab] = el
                          }}
                        >
                          <StationDetailsView
                            station={displayStation ?? station}
                            additionalDoc={displayAdditionalDoc}
                            additionalLoading={additionalLoading}
                            activeTab={tab}
                            fieldSchema={fieldSchema}
                            pendingFieldChanges={
                              showPendingOverlay ? pendingFieldChanges : undefined
                            }
                            isPendingNew={pendingEntry?.isNew === true}
                            knowledgebaseStatus={knowledgebase.status}
                            knowledgebasePostalAddress={knowledgebasePostalAddress}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>
          </main>
        </div>
      </div>
    </div>
  )
}

export default StationDetailsPage
