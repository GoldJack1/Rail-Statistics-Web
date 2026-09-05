'use client'

import React, { useId, useState } from 'react'
import dynamic from 'next/dynamic'
import { CaretRight as ChevronRightIcon, Check, MagnifyingGlass } from '@phosphor-icons/react'

import { BUTOperatorChip, BUTWideButton } from '@/components/buttons'
import SidebarDropdownSection from '@/components/misc/SidebarDropdownSection/SidebarDropdownSection'
import CollapsibleSection from '@/components/misc/CollapsibleSection/CollapsibleSection'
import { SidebarPanel } from '@/components/misc/SidebarPanel'
import TXTINPBUTIconWideButtonSearch from '@/components/textInputButtons/special/TXTINPBUTIconWideButtonSearch'
import type { StationAdminDisplayMode } from '@/utils/stationAdminDisplayModeStorage'
import type { StationAdminSidebarSectionsState } from '@/utils/stationAdminSidebarSectionsStorage'
import type { StationAdminSidebarSectionId } from '@/utils/stationAdminSidebarSectionsStorage'
import {
  getStationSearchPlaceholder,
  normalizeStationSearchInput,
  type PassengerSortYear,
  type SortOption,
  type StationFilterSelections,
  type StationSearchMode,
} from '@/utils/stationSearchFiltering'
import type { SupertramLineFilter } from '@/utils/stationsListFiltersStorage'
import {
  isDateOpenedSortOption,
  PASSENGER_SORT_YEAR_LATEST_LABEL,
} from '@/hooks/useStationsBrowseFilters'
import { sortOptionToTableSort } from '@/utils/stationSearchFiltering'
import type { StationsTableSort } from '@/utils/stationsTableColumns'
import StationsCloudSyncCue from '@/components/misc/StationsCloudSyncCue'

const StationAdminControls = dynamic(
  () => import('@/components/cards/StationAdminControls/StationAdminControls'),
  { ssr: false }
)
const StationAdminViewControls = dynamic(
  () => import('@/components/cards/StationAdminControls/StationAdminViewControls'),
  { ssr: false }
)
const BUTDDMList = dynamic(() => import('@/components/buttons/ddm/BUTDDMList'), { ssr: false })
const BUTDDMListActionDual = dynamic(
  () => import('@/components/buttons/ddm/BUTDDMListActionDual'),
  { ssr: false }
)
const TOGToggleVisited = dynamic(
  () => import('@/components/buttons/toggle/TOGToggleVisited'),
  { ssr: false }
)
const StationsLineFilterTabs = dynamic(
  () => import('@/components/stations/StationsLineFilterTabs'),
  { ssr: false }
)

const WHISTLESTOP_KIRKLEES_TOC = 'Whistlestop Valley/Kirklees Light Railway'
const DATE_OPENED_VISIBLE_COUNT = 5

const formatTocFilterDdmLabel = (toc: string) =>
  toc === WHISTLESTOP_KIRKLEES_TOC ? 'Whistlestop Valley/Kirklees Light Rlwy' : toc

export interface StationsBrowseSidebarFilterUniqueValues {
  tocs: string[]
  countries: string[]
  counties: string[]
  allBoroughs: string[]
  provinces: string[]
  dateOpened: string[]
  fareZones: string[]
}

export interface StationsBrowseSidebarProps {
  loading?: boolean
  networkView: string
  sidebarSections: StationAdminSidebarSectionsState
  setSectionExpanded: (section: StationAdminSidebarSectionId, expanded: boolean) => void

  searchTerm: string
  onSearchTermChange: (value: string) => void
  searchMode: StationSearchMode
  onSearchModeChange: (mode: StationSearchMode) => void
  availableSearchModes: StationSearchMode[]
  showSearchModeChips: boolean

  showViewSection?: boolean
  /** When false, hides the Sort sidebar section (e.g. map page). */
  showSortSection?: boolean
  displayMode?: StationAdminDisplayMode
  onDisplayModeChange?: (mode: StationAdminDisplayMode) => void
  onAssignHeaders?: () => void
  onResetTableSort?: () => void
  canResetTableSort?: boolean

  sortOption: SortOption
  onSortOptionChange: (option: SortOption) => void
  onTableSortFromSortOption: (sort: StationsTableSort) => void
  availableSortOptions: Array<{ label: string; value: SortOption }>
  passengerSortYear: PassengerSortYear
  onPassengerSortYearChange: (year: PassengerSortYear) => void
  passengerSortYearOptions: PassengerSortYear[]
  showPassengerYearSortDdm?: boolean
  isSupertramNetworkView: boolean

  uniqueValues: StationsBrowseSidebarFilterUniqueValues
  effectiveSelections: StationFilterSelections
  updateFilterSelection: (key: keyof StationFilterSelections, selectedItems: string[]) => void
  updateCountySelection: (selectedCounties: string[]) => void
  getSelectedPositions: (items: string[], selectedItems: string[]) => number[]
  disabledBoroughPositions: number[]
  londonBoroughFilterEnabled: boolean
  toggleLondonBoroughFilter: () => void
  showLondonBoroughToggle: boolean
  showTocFilter: boolean
  showCountryFilter: boolean
  showProvinceFilterInline: boolean
  showIrishNiSection: boolean
  showSupertramOnlyFilters: boolean
  /** Public stations: cloud-sync status capsule above Search. */
  showCloudSyncCue?: boolean
  supertramLineFilter: SupertramLineFilter
  onSupertramLineFilterChange: (value: SupertramLineFilter) => void
  supertramFiltersExpanded: boolean
  onSupertramFiltersExpandedChange: (expanded: boolean) => void
  irishNiFiltersExpanded: boolean
  onIrishNiFiltersExpandedChange: (expanded: boolean) => void
  dateOpenedCounts: Map<string, number>
  hasUserInteractedWithFilters: boolean
  resetAllFilters: () => void
  /** List cards only: Show Date Opened toggle inside SuperTram filters. */
  showOpenedOnToggle?: boolean
  showOpenedOn?: boolean
  onShowOpenedOnChange?: (show: boolean) => void

  showAdminSection?: boolean
  /** List: view/edit controls. Map: add-station mode toggle. */
  adminVariant?: 'list' | 'map'
  isEditMode?: boolean
  pendingChangesCount?: number
  onEditModeChange?: (mode: 'view' | 'edit') => void
  onOpenPendingChanges?: () => void
  onAddStation?: () => void
  isAddStationMode?: boolean
  onAddStationModeChange?: (active: boolean) => void
  isAdminMode?: boolean
  /** Map + SuperTram: show Follow stops under Admin. */
  showTimelineFollow?: boolean
  timelineFollowAppearing?: boolean
  onTimelineFollowAppearingChange?: (enabled: boolean) => void
  timelineShowOrderOfOpening?: boolean
  onTimelineShowOrderOfOpeningChange?: (enabled: boolean) => void
  /** When true, panel is off-screen (map desktop collapse) — hide from AT / focus. */
  collapsed?: boolean
  /** Map page: SuperTram timeline controls when the side panel is open. */
  timelineContent?: React.ReactNode
}

const StationsBrowseSidebar: React.FC<StationsBrowseSidebarProps> = ({
  loading = false,
  networkView,
  sidebarSections,
  setSectionExpanded,
  searchTerm,
  onSearchTermChange,
  searchMode,
  onSearchModeChange,
  availableSearchModes,
  showSearchModeChips,
  showViewSection = false,
  showSortSection = true,
  displayMode,
  onDisplayModeChange,
  onAssignHeaders,
  onResetTableSort,
  canResetTableSort = false,
  sortOption,
  onSortOptionChange,
  onTableSortFromSortOption,
  availableSortOptions,
  passengerSortYear,
  onPassengerSortYearChange,
  passengerSortYearOptions,
  showPassengerYearSortDdm = false,
  isSupertramNetworkView,
  uniqueValues,
  effectiveSelections,
  updateFilterSelection,
  updateCountySelection,
  getSelectedPositions,
  disabledBoroughPositions,
  londonBoroughFilterEnabled,
  toggleLondonBoroughFilter,
  showLondonBoroughToggle,
  showTocFilter,
  showCountryFilter,
  showProvinceFilterInline,
  showIrishNiSection,
  showSupertramOnlyFilters,
  showCloudSyncCue = false,
  supertramLineFilter,
  onSupertramLineFilterChange,
  supertramFiltersExpanded,
  onSupertramFiltersExpandedChange,
  irishNiFiltersExpanded,
  onIrishNiFiltersExpandedChange,
  dateOpenedCounts,
  hasUserInteractedWithFilters,
  resetAllFilters,
  showOpenedOnToggle = false,
  showOpenedOn = true,
  onShowOpenedOnChange,
  showAdminSection = false,
  adminVariant = 'list',
  isEditMode = false,
  pendingChangesCount = 0,
  onEditModeChange,
  onOpenPendingChanges,
  onAddStation,
  isAddStationMode = false,
  onAddStationModeChange,
  isAdminMode = false,
  showTimelineFollow = false,
  timelineFollowAppearing = false,
  onTimelineFollowAppearingChange,
  timelineShowOrderOfOpening = false,
  onTimelineShowOrderOfOpeningChange,
  collapsed = false,
  timelineContent,
}) => {
  const supertramFiltersPanelId = useId()
  const irishNiFiltersPanelId = useId()
  const [dateOpenedExpanded, setDateOpenedExpanded] = useState(false)

  const passengerSortYearLabels = passengerSortYearOptions.map((year) =>
    year === 'latest' ? PASSENGER_SORT_YEAR_LATEST_LABEL : year
  )

  const allDateOpenedSelected =
    uniqueValues.dateOpened.length > 0 &&
    uniqueValues.dateOpened.every((date) => effectiveSelections.dateOpened.includes(date))
  const allDateOpenedCount = uniqueValues.dateOpened.reduce(
    (sum, date) => sum + (dateOpenedCounts.get(date) ?? 0),
    0
  )
  const dateOpenedNeedsCollapse = uniqueValues.dateOpened.length > DATE_OPENED_VISIBLE_COUNT
  const visibleDateOpened = dateOpenedExpanded
    ? uniqueValues.dateOpened
    : uniqueValues.dateOpened.slice(0, DATE_OPENED_VISIBLE_COUNT)

  const renderProvinceFilter = () =>
    uniqueValues.provinces.length > 0 ? (
      <div className="filter-group">
        <label className="filter-label">Province</label>
        <BUTDDMListActionDual
          items={uniqueValues.provinces}
          filterName="Provinces"
          selectionMode="multi"
          selectedPositions={getSelectedPositions(uniqueValues.provinces, effectiveSelections.provinces)}
          onSelectionChanged={(_, selectedItems) => updateFilterSelection('provinces', selectedItems)}
          colorVariant="primary"
        />
      </div>
    ) : null

  const supertramFilterBody = (
    <>
      <div className="filter-group">
        <label className="filter-label">Line</label>
        <StationsLineFilterTabs
          value={supertramLineFilter}
          onChange={onSupertramLineFilterChange}
          isVisible={isSupertramNetworkView || supertramFiltersExpanded}
        />
      </div>

      {showOpenedOnToggle && onShowOpenedOnChange && (
        <div className="filter-group">
          <div className="county-london-toggle">
            <span className="filter-label county-london-toggle__label">Show Date Opened</span>
            <TOGToggleVisited
              checked={showOpenedOn}
              onChange={() => onShowOpenedOnChange(!showOpenedOn)}
              ariaLabel="Show Date Opened on SuperTram cards"
              className="county-london-toggle__control"
            />
          </div>
        </div>
      )}

      {uniqueValues.dateOpened.length > 0 && (
        <div className="filter-group">
          <label className="filter-label" id="stations-date-opened-filter-label">
            Date Opened
          </label>
          <div
            className="stations-date-opened-checklist"
            role="group"
            aria-labelledby="stations-date-opened-filter-label"
          >
            <label className="stations-date-opened-checklist__item stations-date-opened-checklist__item--all">
              <span className="stations-date-opened-checklist__control">
                <input
                  type="checkbox"
                  checked={allDateOpenedSelected}
                  onChange={() => {
                    updateFilterSelection(
                      'dateOpened',
                      allDateOpenedSelected ? [] : [...uniqueValues.dateOpened]
                    )
                  }}
                />
                <span className="stations-date-opened-checklist__box" aria-hidden>
                  <Check
                    className="stations-date-opened-checklist__check"
                    size={12}
                    weight="bold"
                  />
                </span>
              </span>
              <span>All ({allDateOpenedCount})</span>
            </label>
            {visibleDateOpened.map((date) => {
              const checked = effectiveSelections.dateOpened.includes(date)
              const count = dateOpenedCounts.get(date) ?? 0
              return (
                <label key={date} className="stations-date-opened-checklist__item">
                  <span className="stations-date-opened-checklist__control">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => {
                        const current = effectiveSelections.dateOpened
                        const next = checked
                          ? current.filter((value) => value !== date)
                          : [...current, date]
                        updateFilterSelection('dateOpened', next)
                      }}
                    />
                    <span className="stations-date-opened-checklist__box" aria-hidden>
                      <Check
                        className="stations-date-opened-checklist__check"
                        size={12}
                        weight="bold"
                      />
                    </span>
                  </span>
                  <span>
                    {date} ({count})
                  </span>
                </label>
              )
            })}
            {dateOpenedNeedsCollapse && (
              <button
                type="button"
                className="stations-date-opened-checklist__more"
                aria-expanded={dateOpenedExpanded}
                onClick={() => setDateOpenedExpanded((current) => !current)}
              >
                {dateOpenedExpanded
                  ? 'Show less'
                  : `Show more (${uniqueValues.dateOpened.length - DATE_OPENED_VISIBLE_COUNT})`}
              </button>
            )}
          </div>
        </div>
      )}
    </>
  )

  const sortControls = (
    <div className="sort-section">
      <BUTDDMList
        items={availableSortOptions.map((option) => option.label)}
        filterName="Sort"
        selectionMode="single"
        selectedPositions={[
          Math.max(0, availableSortOptions.findIndex((option) => option.value === sortOption)),
        ]}
        onSelectionChanged={(selectedPositions) => {
          const selectedIndex = selectedPositions[0]
          if (typeof selectedIndex !== 'number') return
          const selectedSortOption = availableSortOptions[selectedIndex]
          if (selectedSortOption) {
            onSortOptionChange(selectedSortOption.value)
            onTableSortFromSortOption(sortOptionToTableSort(selectedSortOption.value))
          }
        }}
        colorVariant="primary"
      />
      {showPassengerYearSortDdm && (
        <BUTDDMList
          items={passengerSortYearLabels}
          filterName="Year"
          selectionMode="single"
          selectedPositions={[
            Math.max(0, passengerSortYearOptions.findIndex((year) => year === passengerSortYear)),
          ]}
          onSelectionChanged={(selectedPositions) => {
            const selectedIndex = selectedPositions[0]
            if (typeof selectedIndex !== 'number') return
            const selectedYear = passengerSortYearOptions[selectedIndex]
            if (selectedYear) onPassengerSortYearChange(selectedYear)
          }}
          colorVariant="primary"
        />
      )}
      {availableSortOptions.some((option) => isDateOpenedSortOption(option.value)) &&
        !isSupertramNetworkView && (
          <p className="sort-section__footnote">* SuperTram stops only</p>
        )}
    </div>
  )

  const filterControls = (
    <div className="filters-panel">
      {!isSupertramNetworkView && (
        <>
          {showTocFilter && (
            <div className="filter-group">
              <label className="filter-label">TOC</label>
              <BUTDDMListActionDual
                items={uniqueValues.tocs}
                filterName="TOCs"
                selectionMode="multi"
                selectedPositions={getSelectedPositions(uniqueValues.tocs, effectiveSelections.tocs)}
                onSelectionChanged={(_, selectedItems) => updateFilterSelection('tocs', selectedItems)}
                formatItemLabel={formatTocFilterDdmLabel}
                colorVariant="primary"
              />
            </div>
          )}

          {showCountryFilter && (
            <div className="filter-group">
              <label className="filter-label">Country</label>
              <BUTDDMListActionDual
                items={uniqueValues.countries}
                filterName="Countries"
                selectionMode="multi"
                selectedPositions={getSelectedPositions(
                  uniqueValues.countries,
                  effectiveSelections.countries
                )}
                onSelectionChanged={(_, selectedItems) =>
                  updateFilterSelection('countries', selectedItems)
                }
                colorVariant="primary"
              />
            </div>
          )}

          <div className="filter-group">
            <label className="filter-label">County</label>
            <BUTDDMListActionDual
              items={uniqueValues.counties}
              filterName="Counties"
              selectionMode="multi"
              selectedPositions={getSelectedPositions(
                uniqueValues.counties,
                effectiveSelections.counties
              )}
              onSelectionChanged={(_, selectedItems) => updateCountySelection(selectedItems)}
              colorVariant="primary"
            />
          </div>

          {showProvinceFilterInline ? renderProvinceFilter() : null}
        </>
      )}

      {uniqueValues.allBoroughs.length > 0 && (
        <div className="filter-group">
          <label className="filter-label">Borough</label>
          <BUTDDMListActionDual
            items={uniqueValues.allBoroughs}
            filterName="Boroughs"
            selectionMode="multi"
            selectedPositions={getSelectedPositions(
              uniqueValues.allBoroughs,
              effectiveSelections.boroughs
            )}
            disabledPositions={disabledBoroughPositions}
            preferCountWhenAllSelected={londonBoroughFilterEnabled}
            onSelectionChanged={(_, selectedItems) => updateFilterSelection('boroughs', selectedItems)}
            colorVariant="primary"
          />
        </div>
      )}

      {showLondonBoroughToggle && (
        <div className="filter-group filter-group--london-borough">
          <div className="county-london-toggle">
            <span className="filter-label county-london-toggle__label">London Borough Filter</span>
            <TOGToggleVisited
              checked={londonBoroughFilterEnabled}
              onChange={() => toggleLondonBoroughFilter()}
              ariaLabel="London Borough Filter"
              className="county-london-toggle__control"
            />
          </div>
        </div>
      )}

      {isSupertramNetworkView && supertramFilterBody}

      {networkView === 'all' && showSupertramOnlyFilters && (
        <section
          className={[
            'filters-panel__section',
            'filters-panel__section--supertram',
            supertramFiltersExpanded
              ? 'filters-panel__section--expanded'
              : 'filters-panel__section--collapsed',
          ].join(' ')}
        >
          <button
            type="button"
            className="filters-panel__section-toggle"
            aria-expanded={supertramFiltersExpanded}
            aria-controls={supertramFiltersPanelId}
            onClick={() => onSupertramFiltersExpandedChange(!supertramFiltersExpanded)}
          >
            <span className="filters-panel__section-title" id="stations-supertram-filters-heading">
              South Yorkshire SuperTram
            </span>
            <ChevronRightIcon className="filters-panel__section-chevron" aria-hidden />
          </button>

          <CollapsibleSection
            isExpanded={supertramFiltersExpanded}
            className="filters-panel__section-panel-host"
            innerClassName="filters-panel__section-panel"
            ariaHidden={!supertramFiltersExpanded}
          >
            <div className="filters-panel__section-body" id={supertramFiltersPanelId}>
              {supertramFilterBody}
            </div>
          </CollapsibleSection>
        </section>
      )}

      {showIrishNiSection && (
        <section
          className={[
            'filters-panel__section',
            'filters-panel__section--irish-ni',
            irishNiFiltersExpanded
              ? 'filters-panel__section--expanded'
              : 'filters-panel__section--collapsed',
          ].join(' ')}
        >
          <button
            type="button"
            className="filters-panel__section-toggle"
            aria-expanded={irishNiFiltersExpanded}
            aria-controls={irishNiFiltersPanelId}
            onClick={() => onIrishNiFiltersExpandedChange(!irishNiFiltersExpanded)}
          >
            <span className="filters-panel__section-title" id="stations-irish-ni-filters-heading">
              Irish Rail & NI Translink
            </span>
            <ChevronRightIcon className="filters-panel__section-chevron" aria-hidden />
          </button>

          <CollapsibleSection
            isExpanded={irishNiFiltersExpanded}
            className="filters-panel__section-panel-host"
            innerClassName="filters-panel__section-panel"
            ariaHidden={!irishNiFiltersExpanded}
          >
            <div className="filters-panel__section-body" id={irishNiFiltersPanelId}>
              {renderProvinceFilter()}
            </div>
          </CollapsibleSection>
        </section>
      )}

      <div className="filters-panel__footer">
        <BUTWideButton
          type="button"
          width="fill"
          className="stations-reset-filters-button"
          onClick={resetAllFilters}
          disabled={!hasUserInteractedWithFilters}
        >
          Reset all
        </BUTWideButton>
      </div>
    </div>
  )

  return (
    <aside
      className={['stations-sidebar', loading ? 'stations-sidebar--loading' : '']
        .filter(Boolean)
        .join(' ')}
      aria-busy={loading}
      aria-disabled={loading}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      <SidebarPanel className="stations-sidebar-panel">
        {showCloudSyncCue ? <StationsCloudSyncCue /> : null}
        <SidebarDropdownSection
          title="Search"
          expanded={sidebarSections.search}
          onExpandedChange={(expanded) => setSectionExpanded('search', expanded)}
        >
          <div className="search-container">
            <TXTINPBUTIconWideButtonSearch
              id="stations-search"
              name="station-search"
              icon={<MagnifyingGlass size={16} aria-hidden />}
              value={searchTerm}
              onChange={(value) =>
                onSearchTermChange(normalizeStationSearchInput(value, searchMode))
              }
              onClear={() => onSearchTermChange('')}
              className="search-input-shell"
              placeholder={getStationSearchPlaceholder(searchMode)}
              autoComplete="off"
              colorVariant="primary"
              showClear
            />
          </div>
          {showSearchModeChips && (
            <div className="stations-search-mode-chips-reveal">
              <div className="stations-search-mode-chips" role="group" aria-label="Search by">
                {availableSearchModes.map((mode) => (
                  <BUTOperatorChip
                    key={mode}
                    instantAction
                    colorVariant="primary"
                    width="hug"
                    state={searchMode === mode ? 'pressed' : 'active'}
                    onClick={() => onSearchModeChange(mode)}
                    aria-label={
                      mode === 'name'
                        ? 'Search by station name'
                        : mode === 'crs'
                          ? 'Search by CRS code'
                          : 'Search by TIPLOC code'
                    }
                  >
                    {mode === 'name' ? 'Name' : mode === 'crs' ? 'CRS' : 'TIPLOC'}
                  </BUTOperatorChip>
                ))}
              </div>
            </div>
          )}
        </SidebarDropdownSection>

        {showViewSection && displayMode && onDisplayModeChange && (
          <SidebarDropdownSection
            title="View"
            className="stations-sidebar-view-section"
            expanded={sidebarSections.view}
            onExpandedChange={(expanded) => setSectionExpanded('view', expanded)}
          >
            <StationAdminViewControls
              displayMode={displayMode}
              onDisplayModeChange={onDisplayModeChange}
              onAssignHeaders={onAssignHeaders}
              onResetTableSort={onResetTableSort}
              canResetTableSort={canResetTableSort}
              className="station-admin-controls-card--sidebar"
            />
          </SidebarDropdownSection>
        )}

        {showSortSection && (
          <SidebarDropdownSection
            title="Sort"
            expanded={sidebarSections.sort}
            onExpandedChange={(expanded) => setSectionExpanded('sort', expanded)}
          >
            {sortControls}
          </SidebarDropdownSection>
        )}

        <SidebarDropdownSection
          title="Filters"
          expanded={sidebarSections.filters}
          onExpandedChange={(expanded) => setSectionExpanded('filters', expanded)}
        >
          {filterControls}
        </SidebarDropdownSection>

        {timelineContent != null && (
          <SidebarDropdownSection
            title="Timeline"
            expanded={sidebarSections.timeline}
            onExpandedChange={(expanded) => setSectionExpanded('timeline', expanded)}
          >
            {timelineContent}
          </SidebarDropdownSection>
        )}

        {showAdminSection &&
          onOpenPendingChanges &&
          (adminVariant === 'map'
            ? Boolean(onEditModeChange && onAddStationModeChange)
            : Boolean(onEditModeChange && onAddStation)) && (
          <SidebarDropdownSection
            title="Admin"
            expanded={sidebarSections.admin}
            onExpandedChange={(expanded) => setSectionExpanded('admin', expanded)}
          >
            <StationAdminControls
              variant={adminVariant}
              isEditMode={isEditMode}
              pendingChangesCount={pendingChangesCount}
              onModeChange={onEditModeChange}
              onOpenPendingChanges={onOpenPendingChanges}
              onAddStation={onAddStation}
              isAddStationMode={isAddStationMode}
              onAddStationModeChange={onAddStationModeChange}
              showTimelineFollow={showTimelineFollow}
              timelineFollowAppearing={timelineFollowAppearing}
              onTimelineFollowAppearingChange={onTimelineFollowAppearingChange}
              timelineShowOrderOfOpening={timelineShowOrderOfOpening}
              onTimelineShowOrderOfOpeningChange={onTimelineShowOrderOfOpeningChange}
              fareZoneOptions={
                adminVariant === 'list' && isAdminMode ? uniqueValues.fareZones : undefined
              }
              selectedFareZonePositions={
                adminVariant === 'list' && isAdminMode
                  ? getSelectedPositions(uniqueValues.fareZones, effectiveSelections.fareZones)
                  : []
              }
              onFareZoneSelectionChange={
                adminVariant === 'list' && isAdminMode
                  ? (selectedItems) => updateFilterSelection('fareZones', selectedItems)
                  : undefined
              }
              className="station-admin-controls-card--sidebar"
            />
          </SidebarDropdownSection>
        )}
      </SidebarPanel>
    </aside>
  )
}

export default StationsBrowseSidebar
