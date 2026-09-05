'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import React, { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef } from 'react'
import dynamic from 'next/dynamic'
import { CaretLeft as ChevronLeftIcon, CaretRight as ChevronRightIcon, WarningCircle } from '@phosphor-icons/react'

import { useStations } from '@/hooks/useStations'
import { useStationsBrowseFilters, isPassengersSortOption } from '@/hooks/useStationsBrowseFilters'
import {
  BUTLeftRoundedCircleButton,
  BUTRightRoundedCircleButton,
  BUTSquareButton,
  BUTTextNumberSquareButton,
  BUTWideButton,
} from '@/components/buttons'
import PageTopHeader from '@/components/misc/PageTopHeader/PageTopHeader'
import AdSlot from '@/components/ads/AdSlot'
import NetworkMessageAlertBanner from '@/components/stations/NetworkMessageAlertBanner'
import StationsBrowseSidebar from '@/components/stations/StationsBrowseSidebar'
import { useNetworkMessages } from '@/hooks/useNetworkMessages'
import StationCard from '@/components/cards/StationCard/StationCard'
import LightRailStopCard from '@/components/cards/LightRailStopCard/LightRailStopCard'
import StationsCardGridSkeleton from '@/components/cards/StationsCardGridSkeleton/StationsCardGridSkeleton'
import { isLightRailStop } from '@/utils/stationCardForNetwork'
import { collectYearlyPassengerYears } from '@/utils/yearlyPassengers'
import NetworkStationTabGroup from '@/components/cards/NetworkStationTabGroup/NetworkStationTabGroup'
import { formatStationLocationDisplay } from '@/utils/formatStationLocation'
import { DEFAULT_NETWORK_VIEW, ALL_VIEW_NETWORK_COLLECTION_IDS } from '@/constants/stationCollections'
import type { NetworkViewFilter } from '@/constants/stationCollections'
import { countPendingChangesForCollection } from '@/utils/pendingChangesByCollection'
import { useStationCollection } from '@/contexts/StationCollectionContext'
import { usePendingStationChanges } from '@/hooks/usePendingStationChanges'
import { buildStationPath, getStationMapKey } from '@/utils/stationAreaSlug'
import { pathnameForReviewPendingSource } from '@/utils/reviewPendingNavigation'
import { setStationDetailsNavigationState } from '@/utils/clientNavigationState'
import { useStationAdminMode } from '@/hooks/useStationAdminMode'
import {
  useStationAdminDisplayMode,
} from '@/hooks/useStationAdminDisplayMode'
import { useStationAdminSidebarSections } from '@/hooks/useStationAdminSidebarSections'
import { getStationNetworkView } from '@/utils/stationCollectionStorage'
import {
  writeStationAdminDisplayMode,
  type StationAdminDisplayMode,
} from '@/utils/stationAdminDisplayModeStorage'
import {
  readStationCardShowOpenedOn,
  writeStationCardShowOpenedOn,
} from '@/utils/stationCardShowOpenedOnStorage'
import type { StationAdminSidebarSectionsState } from '@/utils/stationAdminSidebarSectionsStorage'
import { DEFAULT_STATION_ADMIN_SIDEBAR_SECTIONS } from '@/utils/stationAdminSidebarSectionsStorage'
import {
  filterTableColumnSlotsToAllowedKeys,
  getAvailableTableColumnKeys,
  getDefaultTableColumnSlots,
  getTableFieldSchemaForNetworkView,
  type StationsTableColumnSlot,
} from '@/utils/stationsTableColumnCatalog'
import { tableSortToSortOption } from '@/utils/stationSearchFiltering'
import { markStationsListFiltersForRestore } from '@/utils/stationsListFiltersStorage'
import './StationsPageRefactored.css'

const StationsTableView = dynamic(
  () => import('@/components/cards/StationsTableView/StationsTableView'),
  { ssr: false }
)
const StationsTableColumnsModal = dynamic(
  () => import('@/components/cards/StationsTableView/StationsTableColumnsModal'),
  { ssr: false }
)

/** Minimum time the loading skeleton stays visible so fast cache hits do not flash. */
const MIN_SKELETON_MS = 1500
/** Minimum skeleton time when switching network tabs. */
const MIN_NETWORK_TAB_SKELETON_MS = 1000

/**
 * In-feed ad cadence by grid width (station cards between ads).
 * Intervals are multiples of column count so ads always land on complete rows:
 * - 4 wide → 12 stations then an ad
 * - 3 wide → 9 stations then an ad
 * - 2 wide → 6 stations then an ad
 * - 1 wide → 8 stations then an ad
 */
function getInFeedAdEveryNStations(columnCount: number): number {
  if (columnCount >= 4) return 12
  if (columnCount === 3) return 9
  if (columnCount === 2) return 6
  return 8
}

/** Matches `.stations-page-grid` auto-fill min track (`minmax(min(100%, 350px), 1fr)`). */
const STATION_CARD_MIN_WIDTH_PX = 350

function estimateStationCardColumnsFromWidth(grid: HTMLElement): number {
  const width = grid.clientWidth
  if (width <= 0) return 1
  const gap = parseFloat(window.getComputedStyle(grid).columnGap) || 0
  const minTrack = Math.min(width, STATION_CARD_MIN_WIDTH_PX)
  return Math.max(1, Math.floor((width + gap) / (minTrack + gap)))
}

/**
 * Column count for ad cadence / page size.
 * Prefer computed grid tracks (auto-fill includes empty tracks = real column count).
 * Card offsetTop is unreliable once full-width ads are in the grid.
 */
function countStationCardColumns(grid: HTMLElement): number {
  const template = window.getComputedStyle(grid).gridTemplateColumns.trim()
  if (template && template !== 'none') {
    // Resolved tracks look like "360px 360px 360px" (not minmax() source text).
    const tracks = template.split(/\s+/).filter((track) => track.length > 0)
    if (tracks.length > 0) return tracks.length
  }
  return estimateStationCardColumnsFromWidth(grid)
}

interface StationsPageProps {
  /** Public list defers auth/table/admin chunks; admin keeps full editing surface. */
  surface?: 'public' | 'admin'
  initialMode?: 'view' | 'edit'
  initialDisplayMode?: StationAdminDisplayMode
  initialNetworkView?: NetworkViewFilter
  initialSidebarSections?: StationAdminSidebarSectionsState
}

const StationsPageClient: React.FC<StationsPageProps> = ({
  surface = 'admin',
  initialMode = 'view',
  initialDisplayMode = 'cards',
  initialNetworkView = DEFAULT_NETWORK_VIEW,
  initialSidebarSections,
}) => {
  const { stations: loadedStations, loading, error, refetch } = useStations()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routerLocation = { pathname, search: searchParams.toString() ? `?${searchParams}` : '' }
  const [isEditMode, setIsEditMode] = useState<boolean>(initialMode === 'edit')
  const [isTableColumnsModalOpen, setIsTableColumnsModalOpen] = useState(false)
  const [viewportWidth, setViewportWidth] = useState(0)
  const [viewportMeasured, setViewportMeasured] = useState(false)
  const [minSkeletonElapsed, setMinSkeletonElapsed] = useState(false)
  const [networkTabSkeletonActive, setNetworkTabSkeletonActive] = useState(false)
  const [showOpenedOn, setShowOpenedOn] = useState(() =>
    typeof window !== 'undefined' ? readStationCardShowOpenedOn() : true
  )
  const [sidebarVisible, setSidebarVisible] = useState(true)
  const isInitialNetworkViewRef = useRef(true)
  const { collectionId, networkView, setNetworkView } = useStationCollection()
  const effectiveNetworkView = useMemo(() => {
    if (networkView !== DEFAULT_NETWORK_VIEW) {
      return networkView
    }
    return typeof window !== 'undefined' ? getStationNetworkView() : initialNetworkView
  }, [networkView, initialNetworkView])
  const [tableColumnSlots, setTableColumnSlots] = useState<StationsTableColumnSlot[]>(() =>
    getDefaultTableColumnSlots(
      typeof window !== 'undefined' ? getStationNetworkView() : initialNetworkView
    )
  )
  const { pendingChanges } = usePendingStationChanges()
  const isAdminMode = useStationAdminMode()
  const tableHeaderFieldSchemaForModal = useMemo(
    () => getTableFieldSchemaForNetworkView(networkView),
    [networkView]
  )
  const effectiveTableColumnSlots = useMemo(() => {
    const slots =
      networkView === effectiveNetworkView
        ? tableColumnSlots
        : getDefaultTableColumnSlots(effectiveNetworkView)
    if (isAdminMode) return slots
    const allowedKeys = getAvailableTableColumnKeys(
      effectiveNetworkView,
      getTableFieldSchemaForNetworkView(effectiveNetworkView),
      { isAdminMode: false }
    )
    return filterTableColumnSlotsToAllowedKeys(slots, allowedKeys)
  }, [networkView, effectiveNetworkView, tableColumnSlots, isAdminMode])
  const adminDisplayMode = useStationAdminDisplayMode(initialDisplayMode)
  const { sections: sidebarSections, setSectionExpanded } = useStationAdminSidebarSections(
    initialSidebarSections ?? DEFAULT_STATION_ADMIN_SIDEBAR_SECTIONS
  )
  const isMobileStationsLayout = viewportMeasured && viewportWidth < 640
  const showSidebarViewSection = viewportMeasured && viewportWidth >= 640
  const effectiveDisplayMode: StationAdminDisplayMode = isMobileStationsLayout ? 'cards' : adminDisplayMode
  const handleDisplayModeChange = useCallback((mode: StationAdminDisplayMode) => {
    if (isMobileStationsLayout && mode === 'table') return
    writeStationAdminDisplayMode(mode)
  }, [isMobileStationsLayout])
  const handleShowOpenedOnChange = useCallback((show: boolean) => {
    setShowOpenedOn(show)
    writeStationCardShowOpenedOn(show)
  }, [])
  const pendingChangesCount = useMemo(() => {
    if (networkView === 'all') {
      return ALL_VIEW_NETWORK_COLLECTION_IDS.reduce(
        (sum, id) => sum + countPendingChangesForCollection(pendingChanges, id),
        0
      )
    }
    return countPendingChangesForCollection(pendingChanges, collectionId)
  }, [pendingChanges, collectionId, networkView])
  const isAdminPanelVisible =
    surface === 'admin' ? initialMode === 'edit' || isAdminMode : isAdminMode
  // Catalog defaults only — avoid Firestore sample fetch on the list page critical path.

  useEffect(() => {
    if (initialMode === 'edit') {
      setIsEditMode(true)
      return
    }
    if (!isAdminMode) {
      setIsEditMode(false)
    }
  }, [initialMode, isAdminMode])

  const {
    searchTerm,
    setSearchTerm,
    searchMode,
    setSearchMode,
    hasUserInteractedWithFilters,
    sortOption,
    setSortOption,
    passengerSortYear,
    setPassengerSortYear,
    supertramLineFilter,
    setSupertramLineFilter,
    supertramFiltersExpanded,
    setSupertramFiltersExpanded,
    irishNiFiltersExpanded,
    setIrishNiFiltersExpanded,
    currentPage,
    setCurrentPage,
    tableSort,
    setTableSort,
    availableSearchModes,
    showSearchModeChips,
    uniqueValues,
    effectiveSelections,
    visibleStations,
    disabledBoroughPositions,
    londonBoroughFilterEnabled,
    isSupertramNetworkView,
    showLondonBoroughToggle,
    showCountryFilter,
    showTocFilter,
    showProvinceFilterInline,
    showIrishNiSection,
    showSupertramOnlyFilters,
    availableSortOptions,
    dateOpenedCounts,
    passengerSortYearOptions,
    handleNetworkViewChange,
    handleResetTableSort,
    updateFilterSelection,
    getSelectedPositions,
    updateCountySelection,
    toggleLondonBoroughFilter,
    resetAllFilters,
    persistFiltersState,
  } = useStationsBrowseFilters({
    loadedStations,
    pendingChanges,
    networkView: effectiveNetworkView,
    setNetworkView,
    isAdminMode,
    adminDisplayMode: effectiveDisplayMode,
    managePagination: true,
    paginationResetDeps: [],
  })

  const canResetTableSort =
    tableSort.column !== 'name' || tableSort.direction !== 'asc'

  const CARD_ITEMS_PER_PAGE = 24
  const CARD_ROWS_AT_THREE_COLUMNS = CARD_ITEMS_PER_PAGE / 3
  const CARD_EXTRA_ROWS_AT_THREE_COLUMNS = 5
  const TABLE_ITEMS_PER_PAGE = 100
  // Enough ghost rows to fill the viewport without rendering a full 100-row page.
  const TABLE_SKELETON_ROW_COUNT = 25
  // Fewer skeleton cards on narrow viewports — less style/layout work on mobile LCP.
  // Use 18 before viewport measure so desktop does not flash 8 → full count.
  const cardSkeletonCount = !viewportMeasured
    ? 18
    : isMobileStationsLayout
      ? 6
      : viewportWidth < 1024
        ? 12
        : 18
  const showPublicAds = surface === 'public'
  const stationsPageGridRef = useRef<HTMLDivElement>(null)
  const [cardColumnCount, setCardColumnCount] = useState(1)
  /** True after at least one successful measure (skeleton or live grid). */
  const [cardColumnsMeasured, setCardColumnsMeasured] = useState(false)

  const updateCardColumnCount = useCallback(() => {
    const grid = stationsPageGridRef.current
    if (!grid) return
    const columnCount = countStationCardColumns(grid)
    setCardColumnCount((current) => {
      const next = Math.max(1, columnCount)
      return current === next ? current : next
    })
    setCardColumnsMeasured(true)
  }, [])

  // Declared early so column-measure effects can re-run when skeleton ↔ content swaps.
  const showMainSkeleton =
    !error && (loading || !minSkeletonElapsed || networkTabSkeletonActive)

  useLayoutEffect(() => {
    if (effectiveDisplayMode !== 'cards') return
    updateCardColumnCount()
  }, [
    effectiveDisplayMode,
    updateCardColumnCount,
    visibleStations.length,
    currentPage,
    showPublicAds,
    showMainSkeleton,
  ])

  useEffect(() => {
    if (effectiveDisplayMode !== 'cards') return

    updateCardColumnCount()
    const grid = stationsPageGridRef.current
    if (!grid) return

    const observer = new ResizeObserver(() => {
      updateCardColumnCount()
    })
    observer.observe(grid)
    window.addEventListener('resize', updateCardColumnCount)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', updateCardColumnCount)
    }
  }, [effectiveDisplayMode, updateCardColumnCount, showPublicAds, showMainSkeleton])

  const cardItemsPerPage = useMemo(() => {
    if (cardColumnCount === 3) {
      return (CARD_ROWS_AT_THREE_COLUMNS + CARD_EXTRA_ROWS_AT_THREE_COLUMNS) * 3
    }
    return CARD_ITEMS_PER_PAGE
  }, [cardColumnCount])

  // cardItemsPerPage is derived from measured grid layout after mount, so its
  // page-reset lives in its own effect rather than the hook's managed deps.
  const skipInitialCardItemsPerPageResetRef = useRef(true)
  useEffect(() => {
    if (skipInitialCardItemsPerPageResetRef.current) {
      skipInitialCardItemsPerPageResetRef.current = false
      return
    }
    setCurrentPage(1)
  }, [cardItemsPerPage, setCurrentPage])

  const itemsPerPage = effectiveDisplayMode === 'table' ? TABLE_ITEMS_PER_PAGE : cardItemsPerPage
  const totalPages = Math.ceil(visibleStations.length / itemsPerPage)
  const paginatedStations = visibleStations.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  )
  const inFeedAdEveryNStations = getInFeedAdEveryNStations(cardColumnCount)
  const tableStations = paginatedStations
  const passengerYears = useMemo(
    () => collectYearlyPassengerYears(visibleStations),
    [visibleStations]
  )
  const showPassengerYearSortDdm =
    effectiveDisplayMode === 'cards' &&
    isPassengersSortOption(sortOption) &&
    passengerSortYearOptions.length > 1
  const showOpenedOnToggle = effectiveDisplayMode === 'cards'
  const handleStationNavigate = useCallback(
    (station: (typeof visibleStations)[number]) => {
      const returnTo = `${pathname}${routerLocation.search}`
      persistFiltersState()
      markStationsListFiltersForRestore()
      setStationDetailsNavigationState({ returnTo: returnTo || '/admin/stations' })
      router.push(
        isEditMode
          ? `/admin/stations/${buildStationPath(station, collectionId)}/edit`
          : `/stations/${buildStationPath(station, collectionId)}`
      )
    },
    [router, collectionId, isEditMode, pathname, routerLocation.search, persistFiltersState]
  )
  const visiblePaginationItems = useMemo(() => {
    const windowSize = viewportWidth < 640 ? 3 : viewportWidth < 1024 ? 5 : 7
    const trailingPagesCount = 3

    if (totalPages <= windowSize + trailingPagesCount) {
      return Array.from({ length: totalPages }, (_, index) => index + 1)
    }

    const halfWindow = Math.floor(windowSize / 2)
    let start = Math.max(1, currentPage - halfWindow)
    let end = Math.min(totalPages, start + windowSize - 1)

    if (end - start + 1 < windowSize) {
      start = Math.max(1, end - windowSize + 1)
    }

    const currentWindow = Array.from({ length: end - start + 1 }, (_, index) => start + index)
    const lastPagesStart = Math.max(1, totalPages - trailingPagesCount + 1)
    const lastThreePages = Array.from(
      { length: totalPages - lastPagesStart + 1 },
      (_, index) => lastPagesStart + index
    )
    const mergedPages = Array.from(new Set([...currentWindow, ...lastThreePages])).sort((a, b) => a - b)

    const items: Array<number | 'ellipsis'> = []
    mergedPages.forEach((page, index) => {
      const prev = mergedPages[index - 1]
      if (typeof prev === 'number' && page - prev > 1) {
        items.push('ellipsis')
      }
      items.push(page)
    })

    return items
  }, [currentPage, totalPages, viewportWidth])

  useLayoutEffect(() => {
    setTableColumnSlots(getDefaultTableColumnSlots(getStationNetworkView()))
    setViewportWidth(window.innerWidth)
    setViewportMeasured(true)
  }, [])

  useEffect(() => {
    setTableColumnSlots(getDefaultTableColumnSlots(networkView))
  }, [networkView])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleResize = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const timer = window.setTimeout(() => setMinSkeletonElapsed(true), MIN_SKELETON_MS)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    if (isInitialNetworkViewRef.current) {
      isInitialNetworkViewRef.current = false
      return
    }

    setNetworkTabSkeletonActive(true)
    const timer = window.setTimeout(
      () => setNetworkTabSkeletonActive(false),
      MIN_NETWORK_TAB_SKELETON_MS
    )
    return () => window.clearTimeout(timer)
  }, [effectiveNetworkView])

  const showMainError = Boolean(error)
  const showMainContent = !showMainSkeleton && !showMainError
  const { messages: networkMessages } = useNetworkMessages(effectiveNetworkView)

  return (
    <div
      className={[
        'stations-page',
        effectiveDisplayMode === 'table' ? 'stations-page--table-mode' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <PageTopHeader
        title="Stations & Light Rail Database"
        subtitle={
          isEditMode
            ? 'View or edit station fields and prepare changes for publishing'
            : 'Explore all Railway Stations, Metro and Tram Stops.'
        }
        trailingContent={
          showPublicAds ? <AdSlot variant="banner" className="stations-ad-slot--banner" /> : null
        }
      />
      <div className="stations-toolbar-band">
        <div className="stations-network-tabs-wrap stations-network-tabs-wrap--toolbar">
          <NetworkStationTabGroup
            value={effectiveNetworkView}
            onChange={handleNetworkViewChange}
            sidebarVisible={sidebarVisible}
            onSidebarVisibleChange={setSidebarVisible}
          />
        </div>
      </div>

      {/* Main Content */}
      <div
        className={[
          'stations-content',
          sidebarVisible ? '' : 'stations-content--sidebar-collapsed',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <StationsBrowseSidebar
          loading={showMainSkeleton}
          networkView={effectiveNetworkView}
          sidebarSections={sidebarSections}
          setSectionExpanded={setSectionExpanded}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          searchMode={searchMode}
          onSearchModeChange={setSearchMode}
          availableSearchModes={availableSearchModes}
          showSearchModeChips={showSearchModeChips}
          showViewSection={showSidebarViewSection}
          displayMode={effectiveDisplayMode}
          onDisplayModeChange={handleDisplayModeChange}
          onAssignHeaders={() => setIsTableColumnsModalOpen(true)}
          onResetTableSort={handleResetTableSort}
          canResetTableSort={canResetTableSort}
          sortOption={sortOption}
          onSortOptionChange={setSortOption}
          onTableSortFromSortOption={setTableSort}
          availableSortOptions={availableSortOptions}
          passengerSortYear={passengerSortYear}
          onPassengerSortYearChange={setPassengerSortYear}
          passengerSortYearOptions={passengerSortYearOptions}
          showPassengerYearSortDdm={showPassengerYearSortDdm}
          isSupertramNetworkView={isSupertramNetworkView}
          uniqueValues={uniqueValues}
          effectiveSelections={effectiveSelections}
          updateFilterSelection={updateFilterSelection}
          updateCountySelection={updateCountySelection}
          getSelectedPositions={getSelectedPositions}
          disabledBoroughPositions={disabledBoroughPositions}
          londonBoroughFilterEnabled={londonBoroughFilterEnabled}
          toggleLondonBoroughFilter={toggleLondonBoroughFilter}
          showLondonBoroughToggle={showLondonBoroughToggle}
          showTocFilter={showTocFilter}
          showCountryFilter={showCountryFilter}
          showProvinceFilterInline={showProvinceFilterInline}
          showIrishNiSection={showIrishNiSection}
          showSupertramOnlyFilters={showSupertramOnlyFilters}
          showCloudSyncCue={showPublicAds}
          supertramLineFilter={supertramLineFilter}
          onSupertramLineFilterChange={setSupertramLineFilter}
          supertramFiltersExpanded={supertramFiltersExpanded}
          onSupertramFiltersExpandedChange={setSupertramFiltersExpanded}
          irishNiFiltersExpanded={irishNiFiltersExpanded}
          onIrishNiFiltersExpandedChange={setIrishNiFiltersExpanded}
          dateOpenedCounts={dateOpenedCounts}
          hasUserInteractedWithFilters={hasUserInteractedWithFilters}
          resetAllFilters={resetAllFilters}
          showOpenedOnToggle={showOpenedOnToggle}
          showOpenedOn={showOpenedOn}
          onShowOpenedOnChange={handleShowOpenedOnChange}
          showAdminSection={isAdminPanelVisible}
          isEditMode={isEditMode}
          pendingChangesCount={pendingChangesCount}
          onEditModeChange={(mode) => setIsEditMode(mode === 'edit')}
          onOpenPendingChanges={() =>
            router.push(
              `/admin/stations/pending-review?from=${encodeURIComponent(pathnameForReviewPendingSource(routerLocation))}`
            )
          }
          onAddStation={() => router.push('/admin/stations/new')}
          isAdminMode={isAdminMode}
        />

        {/* Main Content */}
        <main className="stations-main" aria-busy={showMainSkeleton}>
          {showPublicAds ? (
            <AdSlot variant="section" className="stations-ad-slot--section" />
          ) : null}
          <NetworkMessageAlertBanner messages={networkMessages} />
          {showMainError ? (
            <div className="stations-main-error" role="alert">
              <WarningCircle className="stations-main-error__icon" aria-hidden />
              <h2 className="stations-main-error__title">Failed to load stations</h2>
              <p className="stations-main-error__message">{error}</p>
              <BUTWideButton onClick={() => refetch()} width="hug">
                Try Again
              </BUTWideButton>
            </div>
          ) : showMainSkeleton ? (
            effectiveDisplayMode === 'table' ? (
              <StationsTableView
                stations={[]}
                sort={tableSort}
                onSortChange={setTableSort}
                onRowClick={() => {}}
                columnSlots={effectiveTableColumnSlots}
                passengerYears={passengerYears}
                isLoading
                skeletonRowCount={TABLE_SKELETON_ROW_COUNT}
              />
            ) : (
              <StationsCardGridSkeleton count={cardSkeletonCount} gridRef={stationsPageGridRef} />
            )
          ) : effectiveDisplayMode === 'table' ? (
            <StationsTableView
              stations={tableStations}
              sort={tableSort}
              onSortChange={(sort) => {
                setTableSort(sort)
                const mappedSortOption = tableSortToSortOption(sort)
                if (mappedSortOption) {
                  setSortOption(mappedSortOption)
                }
              }}
              onRowClick={handleStationNavigate}
              columnSlots={effectiveTableColumnSlots}
              passengerYears={passengerYears}
            />
          ) : (
            <div className="stations-page-grid" ref={stationsPageGridRef}>
              {paginatedStations.flatMap((station, index) => {
                const cardProps = {
                  station,
                  locationDisplay: formatStationLocationDisplay(station),
                  onCardClick: () => handleStationNavigate(station),
                  onInfoClick: () => handleStationNavigate(station),
                }
                const card = isLightRailStop(station) ? (
                  <LightRailStopCard
                    key={getStationMapKey(station)}
                    {...cardProps}
                    showOpenedOn={showOpenedOn}
                    showOrderOfOpening={isAdminMode}
                  />
                ) : (
                  <StationCard
                    key={getStationMapKey(station)}
                    {...cardProps}
                    reserveLineStripSpace={effectiveNetworkView === 'all'}
                    reserveOpenedOnSpace={effectiveNetworkView === 'all' && showOpenedOn}
                  />
                )

                const stationNumber = index + 1
                const shouldInsertAd =
                  showPublicAds &&
                  cardColumnsMeasured &&
                  stationNumber % inFeedAdEveryNStations === 0 &&
                  // No trailing ad after the last card on the page.
                  stationNumber < paginatedStations.length

                if (!shouldInsertAd) {
                  return [card]
                }

                return [
                  card,
                  <AdSlot
                    key={`in-feed-ad-${currentPage}-${index}`}
                    variant="inFeed"
                    className="stations-ad-slot--in-feed"
                  />,
                ]
              })}
            </div>
          )}

          {/* Pagination */}
          {showMainContent && totalPages > 1 && (
            <div className="stations-pagination">
              <div className="pagination-control-row">
                <BUTLeftRoundedCircleButton
                  type="button"
                  disabled={currentPage === 1}
                  onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                  ariaLabel="Previous page"
                  icon={<ChevronLeftIcon />}
                />
                <div className="pagination-page-buttons">
                  {visiblePaginationItems.map((item, index) => (
                    item === 'ellipsis' ? (
                      <BUTSquareButton
                        key={`ellipsis-${index}`}
                        type="button"
                        ariaLabel="More pages"
                      >
                        ...
                      </BUTSquareButton>
                    ) : (
                      <BUTTextNumberSquareButton
                        key={item}
                        type="button"
                        text={String(item)}
                        pressed={item === currentPage}
                        onClick={() => setCurrentPage(item)}
                        ariaLabel={`Go to page ${item}`}
                      />
                    )
                  ))}
                </div>
                <BUTRightRoundedCircleButton
                  type="button"
                  disabled={currentPage === totalPages}
                  onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                  ariaLabel="Next page"
                  icon={<ChevronRightIcon />}
                />
              </div>
            </div>
          )}
        </main>
      </div>

      {isTableColumnsModalOpen ? (
        <StationsTableColumnsModal
          open={isTableColumnsModalOpen}
          slots={effectiveTableColumnSlots}
          networkView={networkView}
          fieldSchema={tableHeaderFieldSchemaForModal}
          isAdminMode={isAdminMode}
          onApply={setTableColumnSlots}
          onClose={() => setIsTableColumnsModalOpen(false)}
        />
      ) : null}
    </div>
  )
}

export default StationsPageClient
