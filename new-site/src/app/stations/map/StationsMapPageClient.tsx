'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { WarningCircle } from '@phosphor-icons/react'

import { PageTopHeader } from '@/components/misc'
import AdSlot from '@/components/ads/AdSlot'
import { BUTWideButton } from '@/components/buttons'
import NetworkStationTabGroup from '@/components/cards/NetworkStationTabGroup/NetworkStationTabGroup'
import MapLiteModeGate from '@/components/maps/MapLiteModeGate'
import StationsMapSelectedCardFloat from '@/components/maps/StationsMapSelectedCardFloat'
import StationsMapTimeline from '@/components/maps/StationsMapTimeline'
import StationsMapTimelineFloat from '@/components/maps/StationsMapTimelineFloat'
import StationsBrowseSidebar from '@/components/stations/StationsBrowseSidebar'
import { LIGHTRAIL_COLLECTION_ID } from '@/utils/lightRailStationFields'
import { buildSuperTramTimelineSteps, getTimelineVisibleStationIds } from '@/utils/superTramTimeline'
import { isSupertramLineFilterAll } from '@/utils/stationsListFiltersStorage'
import { useStationCollection } from '@/contexts/StationCollectionContext'
import { usePendingStationChanges } from '@/hooks/usePendingStationChanges'
import { useStationsMap } from '@/hooks/useStations'
import { useStationsBrowseFilters } from '@/hooks/useStationsBrowseFilters'
import {
  ensureCollectionLoaded,
  mapStationDetailsUpgraded,
  resolveMapStationDetails,
} from '@/services/stationsDataService'
import { getStationMapKey, getStationNetworkCollectionId } from '@/utils/stationAreaSlug'
import { mergePendingNewStationsForMap } from '@/utils/pendingMapStations'
import { isValidStationCoordinate } from '@/utils/stationCoordinates'
import { countPendingChangesForCollection } from '@/utils/pendingChangesByCollection'
import { pathnameForReviewPendingSource } from '@/utils/reviewPendingNavigation'
import { useStationAdminMode } from '@/hooks/useStationAdminMode'
import { useStationAdminSidebarSections } from '@/hooks/useStationAdminSidebarSections'
import { useMapsTimelineSession } from '@/hooks/useMapsTimelineSession'
import { useMapPageChromeScrollSnap } from '@/hooks/useMapPageChromeScrollSnap'
import { useRestoreMapsSelectedStation } from '@/hooks/useRestoreMapsSelectedStation'
import { useDevicePerformanceTier } from '@/hooks/useDevicePerformanceTier'
import { writeMapsSelectedStationKey } from '@/utils/mapsSelectedStationStorage'
import { readMapsBrowseMode, writeMapsBrowseMode } from '@/utils/mapsBrowseModeStorage'
import {
  DEFAULT_STATION_ADMIN_SIDEBAR_SECTIONS,
  type StationAdminSidebarSectionsState,
} from '@/utils/stationAdminSidebarSectionsStorage'
import {
  isNetworkCollection,
  NETWORK_COLLECTION_IDS,
  type NetworkViewFilter,
} from '@/constants/stationCollections'
import type { NewStationNavigationState } from '@/types/newStationNavigation'
import type { Station } from '@/types'
import { setNewStationNavigationState } from '@/utils/clientNavigationState'
import '../../admin/stations/StationsPageRefactored.css'
import './StationsMapPage.css'
import './StationsMapTimeline.css'

const StationsOsmMap = dynamic(() => import('@/components/maps/StationsOsmMap'), {
  ssr: false,
  loading: () => (
    <div className="stations-osm-map stations-osm-map--loading" aria-busy="true" aria-label="Loading map" />
  ),
})

interface StationsMapPageClientProps {
  initialSidebarSections?: StationAdminSidebarSectionsState
}

const StationsMapPageClient: React.FC<StationsMapPageClientProps> = ({
  initialSidebarSections,
}) => {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routerLocation = { pathname, search: searchParams.toString() ? `?${searchParams}` : '' }
  const isAdminMode = useStationAdminMode()
  const isAdminMapRoute = pathname.startsWith('/admin/')
  const { collectionId, networkView, setNetworkView } = useStationCollection()
  const { pendingChanges } = usePendingStationChanges()
  const { stations, stationsLoading, error, refetch, resolveStation, loadStationDetails, dataRevision } =
    useStationsMap()
  const { shouldGateAllNetworks, isLiteMode, enableFullMapOverride } =
    useDevicePerformanceTier(networkView)
  const { sections: sidebarSections, setSectionExpanded } = useStationAdminSidebarSections(
    initialSidebarSections ?? DEFAULT_STATION_ADMIN_SIDEBAR_SECTIONS
  )
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  // sessionStorage must restore after mount to avoid SSR hydration mismatches
  const [isEditMode, setIsEditMode] = useState(false)
  const [isAddStationMode, setIsAddStationMode] = useState(false)
  const [stationDetailsLoading, setStationDetailsLoading] = useState(false)
  const [mapFitNonce, setMapFitNonce] = useState(0)
  const [sidebarVisible, setSidebarVisible] = useState(true)
  useMapPageChromeScrollSnap(true)

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
    handleNetworkViewChange: handleBrowseNetworkViewChange,
    updateFilterSelection,
    getSelectedPositions,
    updateCountySelection,
    toggleLondonBoroughFilter,
    resetAllFilters,
    debouncedSearchTerm,
  } = useStationsBrowseFilters({
    loadedStations: stations,
    pendingChanges,
    networkView,
    setNetworkView,
    isAdminMode,
    adminDisplayMode: 'cards',
    managePagination: false,
  })

  const showSuperTramTimeline = networkView === LIGHTRAIL_COLLECTION_ID
  const lineFilterActive = !isSupertramLineFilterAll(supertramLineFilter)
  const dateOpenedFilterActive =
    effectiveSelections.dateOpened.length !== uniqueValues.dateOpened.length
  const timelineFilterBlocked = lineFilterActive || dateOpenedFilterActive
  const timelineAvailable = showSuperTramTimeline && !timelineFilterBlocked
  const timelineDisabledMessage = lineFilterActive && dateOpenedFilterActive
    ? 'This feature does not work when filtering by line or date opened. Select All on both to view the timeline.'
    : lineFilterActive
      ? 'This feature does not work when filtering by line. Select All to view the timeline.'
      : 'This feature does not work when filtering by date opened. Select All to view the timeline.'
  const timelineDisabledAriaLabel = lineFilterActive && dateOpenedFilterActive
    ? 'Network timeline unavailable while line or date opened filters are selected'
    : lineFilterActive
      ? 'Network timeline unavailable while a line filter is selected'
      : 'Network timeline unavailable while a date opened filter is selected'

  const handleNetworkViewChange = useCallback(
    (view: NetworkViewFilter) => {
      if (view === networkView) return
      handleBrowseNetworkViewChange(view)
      setMapFitNonce((nonce) => nonce + 1)
    },
    [networkView, handleBrowseNetworkViewChange]
  )

  const wasAdminModeRef = useRef(false)
  useEffect(() => {
    if (isAdminMode) {
      if (!wasAdminModeRef.current) {
        setIsEditMode(readMapsBrowseMode() === 'edit')
      }
      wasAdminModeRef.current = true
      return
    }
    if (!wasAdminModeRef.current) return
    wasAdminModeRef.current = false
    setIsEditMode(false)
    setIsAddStationMode(false)
    writeMapsBrowseMode('view')
  }, [isAdminMode])

  const handleEditModeChange = useCallback((mode: 'view' | 'edit') => {
    const nextEdit = mode === 'edit'
    setIsEditMode(nextEdit)
    writeMapsBrowseMode(mode)
    if (!nextEdit) {
      setIsAddStationMode(false)
    }
  }, [])

  const loadStations = useCallback(() => {
    refetch()
  }, [refetch])

  useEffect(() => {
    if (!selectedStation) return
    const resolved = resolveStation(selectedStation)
    if (mapStationDetailsUpgraded(selectedStation, resolved)) {
      setSelectedStation(resolved)
    }
  }, [dataRevision, selectedStation, resolveStation])

  useEffect(() => {
    if (networkView === 'all') return
    if (!isNetworkCollection(networkView)) return
    void ensureCollectionLoaded(networkView, { detailLevel: 'list', force: false })
  }, [networkView])

  useEffect(() => {
    if (!selectedStation) return
    if (networkView === 'all') return
    const stationNetwork = getStationNetworkCollectionId(
      selectedStation,
      isNetworkCollection(networkView) ? networkView : undefined
    )
    if (stationNetwork !== networkView) {
      writeMapsSelectedStationKey(null)
      setSelectedStation(null)
    }
  }, [networkView, selectedStation])

  const handleStationSelect = useCallback(
    (station: Station) => {
      const selectionKey = getStationMapKey(station)
      writeMapsSelectedStationKey(selectionKey)
      setSelectedStation(resolveStation(station))
      setStationDetailsLoading(true)
      void loadStationDetails(station).finally(() => {
        setStationDetailsLoading(false)
        setSelectedStation((current) => {
          if (!current || getStationMapKey(current) !== selectionKey) return current
          return resolveMapStationDetails(current)
        })
      })
    },
    [loadStationDetails, resolveStation]
  )

  const handleStationClear = useCallback(() => {
    writeMapsSelectedStationKey(null)
    setSelectedStation(null)
  }, [])

  const handleAddStationAtLocation = useCallback(
    (latitude: number, longitude: number) => {
      const returnTo = isAdminMapRoute ? '/admin/map' : '/stations/map'

      const state: NewStationNavigationState = {
        latitude,
        longitude,
        returnTo,
        ...(isNetworkCollection(networkView) ? { targetCollectionId: networkView } : {}),
      }

      setNewStationNavigationState(state)
      router.push('/admin/stations/new')
    },
    [router, networkView, isAdminMapRoute]
  )

  const firestoreMapStations = useMemo(
    () =>
      visibleStations.filter((station) =>
        isValidStationCoordinate(station.latitude, station.longitude)
      ),
    [visibleStations]
  )

  const { stations: mapStations, pendingNewKeys } = useMemo(
    () => mergePendingNewStationsForMap(firestoreMapStations, pendingChanges, networkView),
    [firestoreMapStations, pendingChanges, networkView]
  )

  // Refit when the user changes search/filters — not on remount (return from details)
  // and not when defaultSelections hydrate before any interaction.
  const filterCameraKey = useMemo(
    () =>
      JSON.stringify({
        debouncedSearchTerm,
        searchMode,
        supertramLineFilter,
        hasUserInteractedWithFilters,
        selections: hasUserInteractedWithFilters ? effectiveSelections : null,
      }),
    [
      debouncedSearchTerm,
      searchMode,
      supertramLineFilter,
      hasUserInteractedWithFilters,
      effectiveSelections,
    ]
  )
  const prevFilterCameraKeyRef = useRef<string | null>(null)
  useEffect(() => {
    if (prevFilterCameraKeyRef.current === null) {
      prevFilterCameraKeyRef.current = filterCameraKey
      return
    }
    if (prevFilterCameraKeyRef.current === filterCameraKey) return
    prevFilterCameraKeyRef.current = filterCameraKey
    setMapFitNonce((nonce) => nonce + 1)
  }, [filterCameraKey])

  useEffect(() => {
    if (!selectedStation) return
    const key = getStationMapKey(selectedStation)
    const stillVisible = mapStations.some((station) => getStationMapKey(station) === key)
    if (!stillVisible) {
      writeMapsSelectedStationKey(null)
      setSelectedStation(null)
    }
  }, [mapStations, selectedStation])

  useRestoreMapsSelectedStation({
    dataReady: !stationsLoading,
    mapStations,
    selectedStation,
    onRestore: handleStationSelect,
  })

  const superTramTimelineStations = useMemo(
    () =>
      showSuperTramTimeline
        ? mapStations.filter((station) => station.sourceCollectionId === LIGHTRAIL_COLLECTION_ID)
        : [],
    [mapStations, showSuperTramTimeline]
  )

  const superTramTimelineSteps = useMemo(
    () => buildSuperTramTimelineSteps(superTramTimelineStations),
    [superTramTimelineStations]
  )

  const {
    timelineModeEnabled,
    setTimelineModeEnabled,
    timelineStepIndex,
    setTimelineStepIndex,
    timelinePlaying,
    setTimelinePlaying,
    timelineFollowAppearing,
    setTimelineFollowAppearing,
    timelineShowOrderOfOpening,
    setTimelineShowOrderOfOpening,
  } = useMapsTimelineSession(showSuperTramTimeline, superTramTimelineSteps.length)

  useEffect(() => {
    if (!timelineFilterBlocked) return
    setTimelinePlaying(false)
    setTimelineModeEnabled(false)
  }, [timelineFilterBlocked, setTimelineModeEnabled, setTimelinePlaying])

  const timelineCutoff = useMemo(() => {
    if (!timelineAvailable || superTramTimelineSteps.length === 0) return null
    const maxIndex = superTramTimelineSteps.length - 1
    const clamped = Math.max(0, Math.min(timelineStepIndex, maxIndex))
    return superTramTimelineSteps[clamped].cutoff
  }, [timelineAvailable, superTramTimelineSteps, timelineStepIndex])

  const timelineShowUndatedAtMax = useMemo(() => {
    if (!timelineAvailable || superTramTimelineSteps.length === 0) return true
    const maxIndex = superTramTimelineSteps.length - 1
    return timelineStepIndex >= maxIndex
  }, [timelineAvailable, superTramTimelineSteps, timelineStepIndex])

  const activeTimelineCutoff = timelineModeEnabled && timelineAvailable ? timelineCutoff : null
  const activeTimelineShowUndatedAtMax =
    timelineModeEnabled && timelineAvailable ? timelineShowUndatedAtMax : true
  const activeTimelineVisibleStationIds = useMemo(() => {
    if (!(timelineModeEnabled && timelineAvailable)) return null
    return getTimelineVisibleStationIds(superTramTimelineSteps, timelineStepIndex)
  }, [timelineModeEnabled, timelineAvailable, superTramTimelineSteps, timelineStepIndex])
  const activeTimelineFollowAppearing = Boolean(
    timelineModeEnabled && timelineAvailable && timelineFollowAppearing
  )

  const selectedStationIsPending = Boolean(
    selectedStation && pendingNewKeys.has(getStationMapKey(selectedStation))
  )

  const pendingChangesCount = useMemo(() => {
    if (networkView === 'all') {
      return NETWORK_COLLECTION_IDS.reduce(
        (sum, id) => sum + countPendingChangesForCollection(pendingChanges, id),
        0
      )
    }
    return countPendingChangesForCollection(pendingChanges, collectionId)
  }, [pendingChanges, collectionId, networkView])

  const handleOpenPendingChanges = useCallback(() => {
    router.push(
      `/admin/stations/pending-review?from=${encodeURIComponent(pathnameForReviewPendingSource(routerLocation))}`
    )
  }, [router, routerLocation])

  if (error) {
    return (
      <div
        className={[
          'stations-page',
          'stations-map-page',
          sidebarVisible ? 'stations-map-page--sidebar-open' : 'stations-map-page--sidebar-collapsed',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <div className="stations-error">
          <WarningCircle className="error-icon" aria-hidden />
          <h2>Failed to load stations</h2>
          <p>{error}</p>
          <BUTWideButton onClick={loadStations} width="hug">
            Try Again
          </BUTWideButton>
        </div>
      </div>
    )
  }

  const dataReady = !stationsLoading
  const visibleMapStations = dataReady ? mapStations : []
  const visiblePublishedStations = dataReady ? firestoreMapStations : []

  return (
    <div
      className={[
        'stations-page',
        'stations-map-page',
        sidebarVisible ? 'stations-map-page--sidebar-open' : 'stations-map-page--sidebar-collapsed',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <PageTopHeader
        title="Map"
        subtitle={stationsLoading ? 'Loading stations…' : '\u00a0'}
      />
      {!isAdminMapRoute ? (
        <div className="stations-map-page__header-ad">
          <AdSlot variant="banner" className="stations-map-ad-slot--banner" />
        </div>
      ) : null}
      <div className="stations-toolbar-band">
        <div className="stations-network-tabs-wrap stations-network-tabs-wrap--toolbar">
          <NetworkStationTabGroup
            value={networkView}
            onChange={handleNetworkViewChange}
            sidebarVisible={sidebarVisible}
            onSidebarVisibleChange={setSidebarVisible}
          />
        </div>
      </div>
      <div
        className={[
          'stations-content',
          'stations-map-page__content',
          sidebarVisible ? '' : 'stations-content--sidebar-collapsed',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <StationsBrowseSidebar
          loading={stationsLoading}
          networkView={networkView}
          sidebarSections={sidebarSections}
          setSectionExpanded={setSectionExpanded}
          searchTerm={searchTerm}
          onSearchTermChange={setSearchTerm}
          searchMode={searchMode}
          onSearchModeChange={setSearchMode}
          availableSearchModes={availableSearchModes}
          showSearchModeChips={showSearchModeChips}
          showViewSection={false}
          showSortSection={false}
          sortOption={sortOption}
          onSortOptionChange={setSortOption}
          onTableSortFromSortOption={(sort) => {
            setTableSort(sort)
          }}
          availableSortOptions={availableSortOptions}
          passengerSortYear={passengerSortYear}
          onPassengerSortYearChange={setPassengerSortYear}
          passengerSortYearOptions={passengerSortYearOptions}
          showPassengerYearSortDdm={false}
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
          supertramLineFilter={supertramLineFilter}
          onSupertramLineFilterChange={setSupertramLineFilter}
          supertramFiltersExpanded={supertramFiltersExpanded}
          onSupertramFiltersExpandedChange={setSupertramFiltersExpanded}
          irishNiFiltersExpanded={irishNiFiltersExpanded}
          onIrishNiFiltersExpandedChange={setIrishNiFiltersExpanded}
          dateOpenedCounts={dateOpenedCounts}
          hasUserInteractedWithFilters={hasUserInteractedWithFilters}
          resetAllFilters={resetAllFilters}
          showAdminSection={isAdminMode}
          adminVariant="map"
          isEditMode={isEditMode}
          pendingChangesCount={pendingChangesCount}
          onEditModeChange={handleEditModeChange}
          onOpenPendingChanges={handleOpenPendingChanges}
          isAddStationMode={isAddStationMode}
          onAddStationModeChange={setIsAddStationMode}
          isAdminMode={isAdminMode}
          showTimelineFollow={showSuperTramTimeline && timelineAvailable}
          timelineFollowAppearing={timelineFollowAppearing}
          onTimelineFollowAppearingChange={setTimelineFollowAppearing}
          timelineShowOrderOfOpening={timelineShowOrderOfOpening}
          onTimelineShowOrderOfOpeningChange={setTimelineShowOrderOfOpening}
          collapsed={!sidebarVisible}
          timelineContent={
            showSuperTramTimeline && !shouldGateAllNetworks && sidebarVisible ? (
              <StationsMapTimeline
                stations={superTramTimelineStations}
                stepIndex={timelineStepIndex}
                onStepIndexChange={setTimelineStepIndex}
                isPlaying={timelinePlaying}
                onPlayingChange={setTimelinePlaying}
                modeEnabled={timelineModeEnabled}
                onModeEnabledChange={setTimelineModeEnabled}
                followAppearing={timelineFollowAppearing}
                onFollowAppearingChange={setTimelineFollowAppearing}
                showOrderOfOpening={timelineShowOrderOfOpening}
                modeDisabled={timelineFilterBlocked}
                modeDisabledMessage={timelineDisabledMessage}
                modeDisabledAriaLabel={timelineDisabledAriaLabel}
                embedded
              />
            ) : null
          }
        />
        <div className="stations-map-page__layout">
          <main className="stations-main">
            {shouldGateAllNetworks ? (
              <MapLiteModeGate
                onSelectNetwork={handleNetworkViewChange}
                onUseFullMap={enableFullMapOverride}
              />
            ) : (
              <StationsOsmMap
                stations={visibleMapStations}
                publishedStations={visiblePublishedStations}
                pendingNewStationKeys={pendingNewKeys}
                networkView={networkView}
                selectedStationId={selectedStation ? getStationMapKey(selectedStation) : null}
                onStationSelect={handleStationSelect}
                onStationClear={handleStationClear}
                allowAddStation={isAdminMode && isEditMode}
                addStationMode={isAddStationMode}
                onAddStationModeChange={setIsAddStationMode}
                onAddStationAtLocation={handleAddStationAtLocation}
                timelineCutoff={activeTimelineCutoff}
                timelineVisibleStationIds={activeTimelineVisibleStationIds}
                timelineShowUndatedAtMax={activeTimelineShowUndatedAtMax}
                timelineFollowAppearing={activeTimelineFollowAppearing}
                timelineFollowReserveFloatChrome={
                  showSuperTramTimeline && !sidebarVisible
                }
                liteMode={isLiteMode}
                fitNonce={mapFitNonce}
                dataReady={dataReady}
              >
                <StationsMapSelectedCardFloat
                  station={selectedStation}
                  isPendingNew={selectedStationIsPending}
                  detailsLoading={stationDetailsLoading}
                  isEditMode={isAdminMode && isEditMode}
                />
              </StationsOsmMap>
            )}
          </main>
          {!shouldGateAllNetworks && (
            <StationsMapTimelineFloat
              active={showSuperTramTimeline && !sidebarVisible}
              stations={superTramTimelineStations}
              stepIndex={timelineStepIndex}
              onStepIndexChange={setTimelineStepIndex}
              isPlaying={timelinePlaying}
              onPlayingChange={setTimelinePlaying}
              modeEnabled={timelineModeEnabled}
              onModeEnabledChange={setTimelineModeEnabled}
              followAppearing={timelineFollowAppearing}
              onFollowAppearingChange={setTimelineFollowAppearing}
              showOrderOfOpening={timelineShowOrderOfOpening}
              modeDisabled={timelineFilterBlocked}
              modeDisabledMessage={timelineDisabledMessage}
              modeDisabledAriaLabel={timelineDisabledAriaLabel}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default StationsMapPageClient
