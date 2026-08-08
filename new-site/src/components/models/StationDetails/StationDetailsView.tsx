'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { ArrowSquareOut, MapPin } from '@phosphor-icons/react'
import type { Station, SandboxStationDoc } from '../../../types'
import { formatFareZoneDisplay } from '../../../utils/formatFareZone'
import { readStationUrl, resolveStationUrlHref } from '../../../utils/stationUrlField'
import type { StationCollectionFieldSchema } from '../../../utils/stationCollectionFieldSchema'
import { stationDetailsShowsAdditionalTab, STEP_FREE_SECTION_LABEL } from '../../../utils/stationCollectionFieldSchema'
import { useStationFieldSchema } from '../../../hooks/useStationCollectionFieldSchema'
import { useGbnrPassUsageData } from '../../../hooks/useGbnrPassUsageData'
import { useGbnrOdmFlows } from '../../../hooks/useGbnrOdmFlows'
import { BUTBaseButton as Button, BUTOperatorChip, BUTTabButton } from '../../buttons'
import { TOGToggleVisited } from '../../buttons'
import { StationDetailField } from './StationDetailField'
import { StationSectionTitle } from './StationSectionTitle'
import { StationDetailsSubsection } from './StationDetailsSubsection'
import { StationPendingChangesBanner } from './StationPendingChangesBanner'
import { StationDetailsFieldGridSkeleton } from './StationDetailsSkeleton'
import StationKnowledgebaseAlertBanner from './StationKnowledgebaseAlertBanner'
import NetworkMessageAlertBanner from '@/components/stations/NetworkMessageAlertBanner'
import { useNetworkMessages } from '@/hooks/useNetworkMessages'
import { StationUsageAreaChart } from './StationUsageAreaChart'
import { StationOdmFlowsSection } from './StationOdmFlowsSection'
import type { StationFieldChange } from '../../../utils/stationFieldDiffs'
import { LIGHT_RAIL_DOC_FIELDS, readLightRailDocString } from '../../../utils/lightRailStationFields'
import { LightRailLinesServedChips } from './LightRailLinesServedChips'
import {
  getStationDetailsSectionIcon,
} from '../../../utils/stationDetailFieldIcons'
import {
  getYearlyPassengerChartPoints,
  trimLeadingTrailingChartZeros,
} from '../../../utils/yearlyPassengers'
import { DEFAULT_NETWORK_COLLECTION_ID } from '../../../constants/stationCollections'
import './StationPendingChangesBanner.css'
import './StationUsageDataNotice.css'
import './StationKnowledgebasePanel.css'
import './StationUsageAreaChart.css'
import AdSlot from '@/components/ads/AdSlot'
import dynamic from 'next/dynamic'

function KnowledgebaseSourceHint({ label }: { label?: string | null }) {
  const lines = splitStationDetailsSourceHintParagraphs(label ?? '')
  if (lines.length === 0) return null
  return (
    <>
      {lines.map((line, index) => (
        <p
          key={index}
          className={
            index === 0
              ? 'edit-hint kb-source-hint'
              : 'edit-hint kb-source-hint kb-source-hint--continued'
          }
        >
          {line}
        </p>
      ))}
    </>
  )
}

type GbnrUsageMetric = 'entriesExits' | 'interchanges' | 'combined'

const GBNR_USAGE_METRIC_OPTIONS: Array<{ id: GbnrUsageMetric; label: string }> = [
  { id: 'entriesExits', label: 'Entries & exits' },
  { id: 'interchanges', label: 'Interchanges' },
  { id: 'combined', label: 'Combined' },
]

const StationResponsiveLocationMap = dynamic(() => import('./StationResponsiveLocationMap'), {
  ssr: false,
  loading: () => <div className="station-details-location-map-wrap" aria-hidden />,
})


function ModalSection({
  className = '',
  children,
}: {
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={['modal-section', className].filter(Boolean).join(' ')}>
      {children}
      <AdSlot variant="section" className="rs-ad-slot--section-end" />
    </div>
  )
}

const BLANK_DISPLAY = '---'

const isBlankValue = (value: unknown): boolean => {
  if (value === null || value === undefined) return true
  if (typeof value === 'string' && value.trim() === '') return true
  return false
}

const formatOptionalText = (value: string | null | undefined): string => {
  if (isBlankValue(value)) return BLANK_DISPLAY
  return String(value)
}

const formatValue = (v: unknown): string => {
  if (isBlankValue(v)) return BLANK_DISPLAY
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** Get borough from station or raw doc (tries common field names). */
const getBorough = (station: Station | null, doc: Record<string, unknown> | null | undefined): string | null => {
  if (station?.borough) return station.borough
  if (!doc) return null
  let v: unknown =
    doc.borough ??
    doc.Borough ??
    doc.londonBorough ??
    doc['London Borough'] ??
    doc.LondonBorough ??
    doc.london_borough
  if (v == null || v === '') {
    const addr = doc.address
    if (typeof addr === 'object' && addr !== null) {
      const a = addr as Record<string, unknown>
      v = a.borough ?? a.Borough
    }
  }
  if (v == null || v === '') return null
  return String(v)
}

/** Get fare zone from station or raw doc (tries common field names). */
const getFareZone = (station: Station | null, doc: Record<string, unknown> | null | undefined): string | null => {
  if (station?.fareZone) return station.fareZone
  if (!doc) return null
  const v = doc.fareZone ?? doc.fare_zone ?? doc.FareZone ?? doc['Fare Zone'] ?? doc.farezone
  if (v == null || v === '') return null
  return String(v)
}

const getYearlyPassengerEntries = (
  passengers: Record<string, number> | number | string | null | Record<string, number | null>
): Array<{ year: string; value: string }> => {
  if (!passengers) return []

  if (typeof passengers === 'number') {
    return [{ year: 'Total', value: passengers.toLocaleString() }]
  }

  if (typeof passengers === 'object') {
    const years = Object.keys(passengers).filter((k) => /^\d{4}$/.test(k))
    if (years.length > 0) {
      const sortedYears = years.sort((a, b) => parseInt(b, 10) - parseInt(a, 10))
      return sortedYears.flatMap((year) => {
        const raw = (passengers as Record<string, number | null | string>)[year]
        const count =
          typeof raw === 'number'
            ? raw
            : typeof raw === 'string'
              ? Number(String(raw).replace(/,/g, '').trim())
              : Number.NaN
        if (!Number.isFinite(count)) return []
        return [{ year, value: count.toLocaleString() }]
      })
    }

    const possibleKeys = ['value', 'count', 'total', 'passengers', 'number']
    for (const key of possibleKeys) {
      const val = (passengers as Record<string, unknown>)[key]
      if (val !== undefined && typeof val === 'number') {
        return [{ year: key, value: val.toLocaleString() }]
      }
    }

    return []
  }

  if (typeof passengers === 'string') {
    const num = parseFloat(passengers)
    if (!isNaN(num)) return [{ year: 'Total', value: num.toLocaleString() }]
    return [{ year: 'Total', value: passengers }]
  }

  return []
}

import type { StationDetailsTab } from '../../../utils/stationCollectionFieldSchema'
import StationKnowledgebasePanel from './StationKnowledgebasePanel'
import type { KbJson } from '../../../utils/knowledgebaseStationXml'
import { isKnowledgebaseTabId, KNOWLEDGEBASE_OVERVIEW_KEY } from '../../../utils/knowledgebaseStationSections'
import {
  getStationDetailsNetworkSourceHint,
  splitStationDetailsSourceHintParagraphs,
  STATION_DETAILS_USAGE_SOURCE_HINT,
} from '../../../utils/stationDetailsSourceHint'
import { getStationNetworkCollectionId } from '../../../utils/stationAreaSlug'
import { isNetworkCollection } from '../../../constants/stationCollections'
import { useStationCollection } from '../../../contexts/StationCollectionContext'

interface StationDetailsViewProps {
  station: Station
  additionalDoc: SandboxStationDoc | null
  additionalLoading?: boolean
  /** When undefined (e.g. in modal), all sections are shown. When set, only that tab's content is shown. */
  activeTab?: StationDetailsTab
  /** Per-network field visibility; inferred from Firestore when omitted. */
  fieldSchema?: StationCollectionFieldSchema
  /** Staged unpublished edits for this station (highlights fields + banner). */
  pendingFieldChanges?: StationFieldChange[]
  isPendingNew?: boolean
  /** Active Knowledgebase section payload (one left-nav KB tab). */
  knowledgebaseSection?: { key: string; label: string; value: KbJson } | null
  knowledgebaseStatus?: 'idle' | 'loading' | 'ready' | 'error'
  knowledgebaseError?: string
  knowledgebaseCrs?: string
  knowledgebaseFetchedAt?: string
  /** NRE ChangeHistory last-updated line for KB source hint. */
  knowledgebaseLastUpdatedLabel?: string | null
  /** Details-tab source hint (Firebase + KB mix). */
  knowledgebaseDetailsSourceHint?: string | null
  /** When showAll (modal), render every KB section. */
  knowledgebaseSections?: Array<{ key: string; label: string; value: KbJson }>
  /** KB StationOperator for Details (replaces Firebase operator code on GBNR). */
  knowledgebaseStationOperator?: string | null
  /** KB NationalLocationCode for Details (replaces Firebase NLC on GBNR). */
  knowledgebaseNlc?: string | null
  /** KB postal address for Location (multi-line, shown under the map). */
  knowledgebasePostalAddress?: string | null
  /** KB StationAlerts text for the top-of-page banner. */
  knowledgebaseStationAlert?: string | null
  /** Admin: highlight Firebase (green) vs Knowledgebase (red) sources. */
  sourceCompareEnabled?: boolean
  onSourceCompareChange?: (enabled: boolean) => void
  /**
   * GBNR: reports whether ORR Table 1415 usage data is available for this station.
   * `null` while loading / waiting for codes; `false` when confirmed missing.
   */
  onGbnrUsageAvailabilityChange?: (available: boolean | null) => void
}

const StationDetailsView: React.FC<StationDetailsViewProps> = ({
  station,
  additionalDoc,
  additionalLoading,
  activeTab,
  fieldSchema: fieldSchemaProp,
  pendingFieldChanges,
  isPendingNew = false,
  knowledgebaseSection = null,
  knowledgebaseStatus = 'idle',
  knowledgebaseError,
  knowledgebaseCrs,
  knowledgebaseFetchedAt,
  knowledgebaseLastUpdatedLabel = null,
  knowledgebaseDetailsSourceHint = null,
  knowledgebaseSections = [],
  knowledgebaseStationOperator = null,
  knowledgebaseNlc = null,
  knowledgebasePostalAddress = null,
  knowledgebaseStationAlert = null,
  sourceCompareEnabled = false,
  onSourceCompareChange,
  onGbnrUsageAvailabilityChange,
}) => {
  const { fieldSchema } = useStationFieldSchema(station, fieldSchemaProp)
  const { collectionId: contextCollectionId } = useStationCollection()
  const stationNetworkId = useMemo(() => {
    const id = getStationNetworkCollectionId(station, contextCollectionId ?? undefined)
    return id && isNetworkCollection(id) ? id : null
  }, [station, contextCollectionId])
  const { messages: networkMessages } = useNetworkMessages(stationNetworkId)
  const [gbnrUsageMetric, setGbnrUsageMetric] = useState<GbnrUsageMetric>('entriesExits')
  const showAdditionalFields = stationDetailsShowsAdditionalTab(fieldSchema)
  const hasCoordinates = station.latitude !== 0 && station.longitude !== 0
  const googleMapsUrl = hasCoordinates ? `https://www.google.com/maps?q=${station.latitude},${station.longitude}` : null

  // GeoPoint from Firestore can be { _latitude, _longitude } or { latitude, longitude }
  const locationFromDoc = additionalDoc?.location as
    | { _latitude?: number; _longitude?: number; latitude?: number; longitude?: number }
    | undefined
  const geoLat = locationFromDoc && (locationFromDoc._latitude ?? locationFromDoc.latitude)
  const geoLng = locationFromDoc && (locationFromDoc._longitude ?? locationFromDoc.longitude)

  const showLocation = hasCoordinates || (geoLat != null && geoLng != null)

  const showAll = activeTab === undefined
  const showDetails = showAll || activeTab === 'details'
  const showLocationTab = showAll || activeTab === 'location'
  const showUsage = fieldSchema.showUsageTab && (showAll || activeTab === 'usage')
  const showAdditional = showAdditionalFields && (showAll || activeTab === 'additional')
  const showStepFree = fieldSchema.showStepFreeTab && (showAll || activeTab === 'stepFree')
  const showService = fieldSchema.showServiceTab && (showAll || activeTab === 'service')
  const showFacilities = fieldSchema.showFacilitiesTab && (showAll || activeTab === 'facilities')
  const showKnowledgebaseContent =
    fieldSchema.showKnowledgebaseTab &&
    (showAll || (typeof activeTab === 'string' && isKnowledgebaseTabId(activeTab)))
  const showAdmin = fieldSchema.showAdminTab && (showAll || activeTab === 'admin')

  const isGbnrStation =
    station.sourceCollectionId === DEFAULT_NETWORK_COLLECTION_ID ||
    (!station.sourceCollectionId && fieldSchema.showKnowledgebaseTab)

  const yearlyPassengersSource =
    (additionalDoc?.yearlyPassengers as Record<string, number> | number | null) ??
    (station.yearlyPassengers as Record<string, number> | number | null)
  const yearlyPassengerEntries = getYearlyPassengerEntries(yearlyPassengersSource)
  const yearlyPassengerChartPoints = getYearlyPassengerChartPoints(yearlyPassengersSource)
  const hasLimitedPassengerData = yearlyPassengerEntries.length < 5

  const resolvedPassUsageNlc = useMemo(() => {
    const fromKb = knowledgebaseNlc?.trim()
    if (fromKb) return fromKb
    const fromDoc = additionalDoc?.nlc ?? (additionalDoc as Record<string, unknown> | null | undefined)?.NLC
    if (fromDoc == null || fromDoc === '') return null
    return String(fromDoc).trim() || null
  }, [knowledgebaseNlc, additionalDoc])

  const passUsageState = useGbnrPassUsageData(
    station.crsCode,
    resolvedPassUsageNlc,
    isGbnrStation
  )
  const odmFlowsState = useGbnrOdmFlows(resolvedPassUsageNlc, isGbnrStation)

  const orrEntriesExits = passUsageState.status === 'ready' ? passUsageState.doc.entriesExits : null
  const orrInterchanges = passUsageState.status === 'ready' ? passUsageState.doc.interchanges : null
  const orrEntryEntries = getYearlyPassengerEntries(orrEntriesExits)
  const orrEntryChartPoints = getYearlyPassengerChartPoints(orrEntriesExits)
  const orrInterchangeEntries = getYearlyPassengerEntries(orrInterchanges)
  const orrInterchangeChartPoints = trimLeadingTrailingChartZeros(
    getYearlyPassengerChartPoints(orrInterchanges)
  )
  const hasMeaningfulInterchanges = Object.values(orrInterchanges ?? {}).some(
    (value) => typeof value === 'number' && Number.isFinite(value) && value > 0
  )
  const visibleGbnrUsageMetricOptions = hasMeaningfulInterchanges
    ? GBNR_USAGE_METRIC_OPTIONS
    : GBNR_USAGE_METRIC_OPTIONS.filter((option) => option.id === 'entriesExits')

  useEffect(() => {
    if (!hasMeaningfulInterchanges && gbnrUsageMetric !== 'entriesExits') {
      setGbnrUsageMetric('entriesExits')
    }
  }, [hasMeaningfulInterchanges, gbnrUsageMetric])

  const hasGbnrPassUsageData =
    passUsageState.status === 'ready' &&
    (orrEntryEntries.length > 0 || orrInterchangeEntries.length > 0)

  useEffect(() => {
    if (!onGbnrUsageAvailabilityChange) return
    if (!isGbnrStation) {
      onGbnrUsageAvailabilityChange(null)
      return
    }
    if (
      passUsageState.status === 'loading' ||
      passUsageState.status === 'waiting_codes' ||
      passUsageState.status === 'idle'
    ) {
      onGbnrUsageAvailabilityChange(null)
      return
    }
    onGbnrUsageAvailabilityChange(hasGbnrPassUsageData)
  }, [
    isGbnrStation,
    passUsageState.status,
    hasGbnrPassUsageData,
    onGbnrUsageAvailabilityChange,
  ])

  const orrUsageStationName =
    passUsageState.status === 'ready'
      ? passUsageState.doc.stationName || station.stationName
      : station.stationName
  const isCombinedUsageMetric = gbnrUsageMetric === 'combined'
  const activeOrrEntries =
    gbnrUsageMetric === 'interchanges' ? orrInterchangeEntries : orrEntryEntries
  const activeOrrChartPoints =
    gbnrUsageMetric === 'interchanges' ? orrInterchangeChartPoints : orrEntryChartPoints
  const activeOrrChartName =
    gbnrUsageMetric === 'interchanges'
      ? `${orrUsageStationName} interchanges`
      : orrUsageStationName
  const showOrrUsageChart = isCombinedUsageMetric
    ? orrEntryChartPoints.length >= 2 || orrInterchangeChartPoints.length >= 2
    : activeOrrChartPoints.length >= 2
  const hasLimitedOrrPassengerData = isCombinedUsageMetric
    ? Math.max(orrEntryEntries.length, orrInterchangeEntries.length) < 5
    : activeOrrEntries.length < 5
  const activeOrrEmptyHint =
    gbnrUsageMetric === 'interchanges'
      ? 'No interchange figures for this station.'
      : gbnrUsageMetric === 'combined'
        ? 'No usage figures for this station.'
        : 'No entries and exits figures for this station.'
  const combinedOrrDataYears = (() => {
    if (!isCombinedUsageMetric) return [] as Array<{
      year: string
      entriesExits?: string
      interchanges?: string
    }>
    const byYear = new Map<string, { entriesExits?: string; interchanges?: string }>()
    for (const entry of orrEntryEntries) {
      byYear.set(entry.year, { ...byYear.get(entry.year), entriesExits: entry.value })
    }
    for (const entry of orrInterchangeEntries) {
      byYear.set(entry.year, { ...byYear.get(entry.year), interchanges: entry.value })
    }
    return [...byYear.entries()]
      .sort((a, b) => parseInt(b[0], 10) - parseInt(a[0], 10))
      .map(([year, values]) => ({ year, ...values }))
  })()

  const knowledgebaseOverviewSection =
    knowledgebaseSections.find((section) => section.key === KNOWLEDGEBASE_OVERVIEW_KEY) ?? null
  const knowledgebaseSidebarSections = knowledgebaseSections.filter(
    (section) => section.key !== KNOWLEDGEBASE_OVERVIEW_KEY
  )
  const resolvedCollectionId =
    getStationNetworkCollectionId(station, contextCollectionId) ?? contextCollectionId
  const networkCollectionId = isNetworkCollection(resolvedCollectionId) ? resolvedCollectionId : null
  const networkSourceHint = getStationDetailsNetworkSourceHint(networkCollectionId)
  /**
   * Shown on every section except Details, Location and Station Usage when KB is enabled.
   * Non-KB networks use the network-specific Rail Statistics attribution line instead.
   */
  const kbSourceHint = fieldSchema.showKnowledgebaseTab
    ? knowledgebaseLastUpdatedLabel
    : networkSourceHint
  /** Details: mixed Firebase + KB line on GBNR; otherwise network attribution. */
  const detailsSourceHint = fieldSchema.showKnowledgebaseTab
    ? knowledgebaseDetailsSourceHint
    : networkSourceHint
  const locationSourceHint = networkSourceHint
  const usageSourceHint = STATION_DETAILS_USAGE_SOURCE_HINT
  const panelLastUpdatedLabel = knowledgebaseLastUpdatedLabel
  /** Heritage / Irish / NI: omit empty CRS·TIPLOC·NLC chips instead of showing ---. */
  const hideEmptyStationCodeChips =
    networkCollectionId === 'stations_gbheritage' ||
    networkCollectionId === 'stations_nitranslink' ||
    networkCollectionId === 'stations_roiirerail'
  const crsCodePresent = !isBlankValue(station.crsCode)
  const tiplocPresent = !isBlankValue(station.tiploc)
  const firebaseNlcPresent = !isBlankValue(additionalDoc?.nlc)
  const showCrsCodeChip = !hideEmptyStationCodeChips || crsCodePresent
  const showTiplocCodeChip = fieldSchema.showTiploc && (!hideEmptyStationCodeChips || tiplocPresent)
  const showNlcCodeChip = fieldSchema.showKnowledgebaseTab
    ? true
    : fieldSchema.showNlc && (!hideEmptyStationCodeChips || firebaseNlcPresent)
  const showStationCodeChips =
    !fieldSchema.isLightRail && (showCrsCodeChip || showTiplocCodeChip || showNlcCodeChip)

  const stationUrlValue = readStationUrl(
    additionalDoc ?? ({ url: station.stationUrl, urlSlug: station.urlSlug } as Partial<SandboxStationDoc>)
  )
  const stationUrlHref = resolveStationUrlHref(stationUrlValue)
  const routingUrlSlug = String(
    additionalDoc?.urlSlug ?? station.urlSlug ?? ''
  ).trim()
  const lightRailDoc = fieldSchema.isLightRail ? (additionalDoc as Record<string, unknown> | null) : null

  return (
    <>
      {showDetails ? <NetworkMessageAlertBanner messages={networkMessages} /> : null}
      {showDetails && knowledgebaseStationAlert ? (
        <StationKnowledgebaseAlertBanner alertText={knowledgebaseStationAlert} />
      ) : null}
      {(pendingFieldChanges?.length || isPendingNew) && (
        <StationPendingChangesBanner changes={pendingFieldChanges ?? []} isNew={isPendingNew} />
      )}
      {showDetails && (
        <>
        <ModalSection>
          <StationSectionTitle title="Details" icon={getStationDetailsSectionIcon('details')} pageHeading />
          {showStationCodeChips && (
            <div className="station-details-code-chips" role="list" aria-label="Station codes">
              {showCrsCodeChip && (
                <BUTOperatorChip
                  instantAction
                  colorVariant="primary"
                  width="hug"
                  className="station-details-code-chip"
                  ariaLabel={`CRS: ${formatOptionalText(station.crsCode)}`}
                >
                  {`CRS: ${formatOptionalText(station.crsCode)}`}
                </BUTOperatorChip>
              )}
              {showTiplocCodeChip && (
                <BUTOperatorChip
                  instantAction
                  colorVariant="primary"
                  width="hug"
                  className="station-details-code-chip"
                  ariaLabel={`TIPLOC: ${formatOptionalText(station.tiploc?.toUpperCase())}`}
                >
                  {`TIPLOC: ${formatOptionalText(station.tiploc?.toUpperCase())}`}
                </BUTOperatorChip>
              )}
              {fieldSchema.showKnowledgebaseTab ? (
                <BUTOperatorChip
                  instantAction
                  colorVariant="primary"
                  width="hug"
                  className="station-details-code-chip station-details-code-chip--kb"
                  ariaLabel={`NLC: ${
                    knowledgebaseStatus === 'loading' || knowledgebaseStatus === 'idle'
                      ? '…'
                      : formatOptionalText(knowledgebaseNlc)
                  }`}
                >
                  {`NLC: ${
                    knowledgebaseStatus === 'loading' || knowledgebaseStatus === 'idle'
                      ? '…'
                      : formatOptionalText(knowledgebaseNlc)
                  }`}
                </BUTOperatorChip>
              ) : showNlcCodeChip ? (
                <BUTOperatorChip
                  instantAction
                  colorVariant="primary"
                  width="hug"
                  className="station-details-code-chip"
                  ariaLabel={`NLC: ${formatValue(additionalDoc?.nlc)}`}
                >
                  {`NLC: ${formatValue(additionalDoc?.nlc)}`}
                </BUTOperatorChip>
              ) : null}
            </div>
          )}

          <StationDetailsSubsection title="Place">
            <div className="modal-details-grid modal-facilities-grid">
              <StationDetailField label="Country" value={formatOptionalText(station.country)} pendingFieldChanges={pendingFieldChanges} />
              <StationDetailField label="County" value={formatOptionalText(station.county)} pendingFieldChanges={pendingFieldChanges} />
              {fieldSchema.showBorough && (
                <StationDetailField
                  label="Borough"
                  value={formatOptionalText(getBorough(station, additionalDoc as Record<string, unknown> | null))}
                  pendingFieldChanges={pendingFieldChanges}
                />
              )}
              {fieldSchema.showFareZone && (
                <StationDetailField
                  label="Fare zone"
                  value={(() => {
                    const z = getFareZone(station, additionalDoc as Record<string, unknown> | null)
                    if (isBlankValue(z)) return BLANK_DISPLAY
                    return formatFareZoneDisplay(z!) || z || BLANK_DISPLAY
                  })()}
                  pendingFieldChanges={pendingFieldChanges}
                />
              )}
            </div>
          </StationDetailsSubsection>

          {(
            fieldSchema.showLinesServed ||
            fieldSchema.showPlatforms ||
            fieldSchema.showGauge ||
            (fieldSchema.foldAdditionalIntoDetails && fieldSchema.showOperatorCode) ||
            (fieldSchema.foldAdditionalIntoDetails && fieldSchema.showMinConnectionTime) ||
            (fieldSchema.foldAdditionalIntoDetails && fieldSchema.showProvince) ||
            (fieldSchema.foldAdditionalIntoDetails && fieldSchema.showPostEirCode && !fieldSchema.postEirCodeInLocation)
          ) ? (
            <div className="station-details-subsection">
              <div className="modal-details-grid modal-facilities-grid">
                {fieldSchema.showLinesServed && (
                  <LightRailLinesServedChips
                    linesServed={readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.linesServed)}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
                {fieldSchema.showPlatforms && (
                  <StationDetailField
                    label="Platforms"
                    value={formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.platforms))}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
                {fieldSchema.showGauge && (
                  <StationDetailField label="Gauge" value={formatValue(additionalDoc?.guage)} pendingFieldChanges={pendingFieldChanges} />
                )}
                {fieldSchema.foldAdditionalIntoDetails && fieldSchema.showOperatorCode && (
                  <StationDetailField
                    label="Operator code"
                    value={formatValue(additionalDoc?.operatorCode)}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
                {fieldSchema.foldAdditionalIntoDetails && fieldSchema.showMinConnectionTime && (
                  <StationDetailField
                    label="Min connection time"
                    value={formatValue(additionalDoc?.['min-connection-time'])}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
                {fieldSchema.foldAdditionalIntoDetails && fieldSchema.showProvince && (
                  <StationDetailField
                    label="Province"
                    value={formatValue(additionalDoc?.province)}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
                {fieldSchema.foldAdditionalIntoDetails && fieldSchema.showPostEirCode && !fieldSchema.postEirCodeInLocation && (
                  <StationDetailField
                    label="Post / Eircode"
                    value={formatValue(additionalDoc?.['post-eir_code'])}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
              </div>
            </div>
          ) : null}
          {fieldSchema.showUrl && stationUrlHref && (
            <StationDetailsSubsection title="Station information" className="station-details-subsection--station-url">
              <Button
                type="button"
                variant="wide"
                width="hug"
                className="modal-map-link"
                onClick={() => window.open(stationUrlHref, '_blank', 'noopener,noreferrer')}
                icon={<ArrowSquareOut size={16} aria-hidden />}
              >
                View Station Information
              </Button>
            </StationDetailsSubsection>
          )}
          {!(fieldSchema.showStepFreeSection && fieldSchema.stepFreeInDetails) ? (
            <KnowledgebaseSourceHint label={detailsSourceHint} />
          ) : null}
        </ModalSection>

        {fieldSchema.showStepFreeSection && fieldSchema.stepFreeInDetails && (
          <ModalSection>
            <StationSectionTitle
              title={STEP_FREE_SECTION_LABEL}
              icon={getStationDetailsSectionIcon('stepFree', { label: STEP_FREE_SECTION_LABEL })}
            />
            <StationDetailsSubsection title="Access">
              <div className="modal-details-grid modal-facilities-grid">
                <StationDetailField
                  label="Step Free Status"
                  value={
                    fieldSchema.isLightRail
                      ? formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.isStepFree))
                      : formatValue(additionalDoc?.stepFree?.stepFreeCode)
                  }
                  pendingFieldChanges={pendingFieldChanges}
                  showIcon
                  iconKey="stepFree"
                />
                {fieldSchema.showStepFreeNote && (
                  <StationDetailField
                    label="Note"
                    value={formatValue(additionalDoc?.stepFree?.stepFreeNote)}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
              </div>
            </StationDetailsSubsection>
            <KnowledgebaseSourceHint label={detailsSourceHint} />
          </ModalSection>
        )}
        </>
      )}

      {showLocationTab && showLocation && (
        <ModalSection className="modal-section--location">
          <StationSectionTitle title="Location" icon={getStationDetailsSectionIcon('location')} pageHeading />
          {(() => {
            const showKbAddress =
              fieldSchema.showKnowledgebaseTab &&
              (knowledgebaseStatus === 'loading' ||
                knowledgebaseStatus === 'idle' ||
                Boolean(knowledgebasePostalAddress))
            return (
              <div
                className={[
                  'location-place-row',
                  showKbAddress ? 'location-place-row--with-address' : 'location-place-row--coords-only',
                ].join(' ')}
              >
                {showKbAddress && (
                  <StationDetailsSubsection title="Address" className="location-place-row__address">
                    <div className="modal-detail-item kb-detail-item kb-address-block">
                      <span className="modal-detail-value kb-address-lines">
                        {knowledgebaseStatus === 'loading' || knowledgebaseStatus === 'idle'
                          ? '…'
                          : knowledgebasePostalAddress}
                      </span>
                    </div>
                  </StationDetailsSubsection>
                )}
                <StationDetailsSubsection title="Coordinates" className="location-place-row__coords">
                  <div className="modal-details-grid modal-facilities-grid location-coords-grid">
                    <StationDetailField
                      label="Latitude"
                      value={(geoLat ?? station.latitude).toFixed(6)}
                      pendingFieldChanges={pendingFieldChanges}
                    />
                    <StationDetailField
                      label="Longitude"
                      value={(geoLng ?? station.longitude).toFixed(6)}
                      pendingFieldChanges={pendingFieldChanges}
                    />
                    {fieldSchema.showPostEirCode && fieldSchema.postEirCodeInLocation && (
                      <StationDetailField
                        label="Post / Eircode"
                        value={formatValue(additionalDoc?.['post-eir_code'])}
                        pendingFieldChanges={pendingFieldChanges}
                      />
                    )}
                  </div>
                </StationDetailsSubsection>
              </div>
            )
          })()}
          {(googleMapsUrl || (geoLat != null && geoLng != null)) && (() => {
            const lat = geoLat ?? station.latitude
            const lng = geoLng ?? station.longitude
            const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}&zoom=17`
            const googleUrl = `https://www.google.com/maps?q=${lat},${lng}`
            const appleUrl = `https://maps.apple.com/?ll=${lat},${lng}&q=${lat},${lng}`
            return (
              <StationDetailsSubsection title="Map">
                <div className="modal-map-links">
                  <Button
                    type="button"
                    variant="wide"
                    width="hug"
                    className="modal-map-link"
                    onClick={() => window.open(osmUrl, '_blank', 'noopener,noreferrer')}
                    icon={<MapPin size={16} aria-hidden />}
                  >
                    OpenStreetMap
                  </Button>
                  <Button
                    type="button"
                    variant="wide"
                    width="hug"
                    className="modal-map-link"
                    onClick={() => window.open(googleUrl, '_blank', 'noopener,noreferrer')}
                    icon={<MapPin size={16} aria-hidden />}
                  >
                    Google Maps
                  </Button>
                  <Button
                    type="button"
                    variant="wide"
                    width="hug"
                    className="modal-map-link"
                    onClick={() => window.open(appleUrl, '_blank', 'noopener,noreferrer')}
                    icon={<MapPin size={16} aria-hidden />}
                  >
                    Apple Maps
                  </Button>
                </div>
                <div className="station-details-location-map-wrap">
                  <StationResponsiveLocationMap
                    latitude={lat}
                    longitude={lng}
                  />
                </div>
              </StationDetailsSubsection>
            )
          })()}
          <KnowledgebaseSourceHint label={locationSourceHint} />
        </ModalSection>
      )}

      {showAdditional && additionalLoading && (
        <ModalSection>
          <StationDetailsFieldGridSkeleton rows={6} />
        </ModalSection>
      )}

      {showAdditional && !additionalLoading && !additionalDoc && (
        <ModalSection>
          <p className="modal-sandbox-loading">No additional details found for this station.</p>
        </ModalSection>
      )}

      {showAdditional && additionalDoc && (
        <ModalSection>
          <StationSectionTitle title="Additional details" icon={getStationDetailsSectionIcon('additional')} pageHeading />
          <StationDetailsSubsection title="Identifiers">
            <div className="modal-details-grid modal-facilities-grid">
              {fieldSchema.showOperatorCode && (
                <StationDetailField
                  label="Operator code"
                  value={formatValue(additionalDoc.operatorCode)}
                  pendingFieldChanges={pendingFieldChanges}
                />
              )}
              {fieldSchema.showMinConnectionTime && (
                <StationDetailField
                  label="Min connection time"
                  value={formatValue(additionalDoc['min-connection-time'])}
                  pendingFieldChanges={pendingFieldChanges}
                />
              )}
              {fieldSchema.showProvince && (
                <StationDetailField
                  label="Province"
                  value={formatValue(additionalDoc.province)}
                  pendingFieldChanges={pendingFieldChanges}
                />
              )}
              {fieldSchema.showPostEirCode && !fieldSchema.postEirCodeInLocation && (
                <StationDetailField
                  label="Post / Eircode"
                  value={formatValue(additionalDoc['post-eir_code'])}
                  pendingFieldChanges={pendingFieldChanges}
                />
              )}
            </div>
          </StationDetailsSubsection>
          <KnowledgebaseSourceHint label={kbSourceHint} />
        </ModalSection>
      )}

      {showFacilities && fieldSchema.showToiletsSection && additionalDoc?.toilets && (
        <ModalSection>
          <StationSectionTitle title="Toilets" icon={getStationDetailsSectionIcon('facilities', { label: 'Toilets' })} />
          <StationDetailsSubsection title="Facilities">
            <div className="modal-details-grid modal-facilities-grid">
              <StationDetailField
                label="Accessible"
                value={formatValue(additionalDoc.toilets.toiletsAccessible)}
                pendingFieldChanges={pendingFieldChanges}
                showIcon
                iconKey="accessible"
              />
              <StationDetailField
                label="Changing Place"
                value={formatValue(additionalDoc.toilets.toiletsChangingPlace)}
                pendingFieldChanges={pendingFieldChanges}
                showIcon
                iconKey="toilets"
              />
              <StationDetailField
                label="Baby changing"
                value={formatValue(additionalDoc.toilets.toiletsBabyChanging)}
                pendingFieldChanges={pendingFieldChanges}
                showIcon
                iconKey="babyChange"
              />
            </div>
          </StationDetailsSubsection>
          {!(fieldSchema.facilityKeys.length > 0 && additionalDoc?.facilities) ? (
            <KnowledgebaseSourceHint label={kbSourceHint} />
          ) : null}
        </ModalSection>
      )}

      {showStepFree &&
        ((fieldSchema.showStepFreeSection && !fieldSchema.stepFreeInDetails) ||
          fieldSchema.showLiftSection) && (
        <ModalSection>
          <StationSectionTitle
            title={STEP_FREE_SECTION_LABEL}
            icon={getStationDetailsSectionIcon('stepFree', { label: STEP_FREE_SECTION_LABEL })}
            pageHeading
          />
          {fieldSchema.showStepFreeSection && !fieldSchema.stepFreeInDetails ? (
            <StationDetailsSubsection title="Access">
              <div className="modal-details-grid modal-facilities-grid">
                <StationDetailField
                  label="Step Free Status"
                  value={
                    fieldSchema.isLightRail
                      ? formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.isStepFree))
                      : formatValue(additionalDoc?.stepFree?.stepFreeCode)
                  }
                  pendingFieldChanges={pendingFieldChanges}
                  showIcon
                  iconKey="stepFree"
                />
                {fieldSchema.showStepFreeNote && (
                  <StationDetailField
                    label="Note"
                    value={formatValue(additionalDoc?.stepFree?.stepFreeNote)}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
                {fieldSchema.showLiftSection && fieldSchema.isLightRail ? (
                  <StationDetailField
                    label="Has lift"
                    value={formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.hasLift))}
                    pendingFieldChanges={pendingFieldChanges}
                    showIcon
                    iconKey="lift"
                  />
                ) : null}
              </div>
            </StationDetailsSubsection>
          ) : null}
          {fieldSchema.showLiftSection && !fieldSchema.isLightRail ? (
            <StationDetailsSubsection title="Availability">
              <div className="modal-details-grid modal-facilities-grid">
                <StationDetailField
                  label="Available"
                  value={formatValue(additionalDoc?.lift?.liftAvailable)}
                  pendingFieldChanges={pendingFieldChanges}
                  showIcon
                  iconKey="lift"
                />
                <StationDetailField
                  label="Notes"
                  value={formatValue(additionalDoc?.lift?.liftNotes)}
                  pendingFieldChanges={pendingFieldChanges}
                />
                <StationDetailField
                  label="Details"
                  value={formatValue(additionalDoc?.lift?.liftDetails)}
                  pendingFieldChanges={pendingFieldChanges}
                />
              </div>
            </StationDetailsSubsection>
          ) : null}
          {fieldSchema.showLiftSection &&
          fieldSchema.isLightRail &&
          !(fieldSchema.showStepFreeSection && !fieldSchema.stepFreeInDetails) ? (
            <StationDetailsSubsection title="Access">
              <div className="modal-details-grid modal-facilities-grid">
                <StationDetailField
                  label="Has lift"
                  value={formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.hasLift))}
                  pendingFieldChanges={pendingFieldChanges}
                  showIcon
                  iconKey="lift"
                />
              </div>
            </StationDetailsSubsection>
          ) : null}
          <KnowledgebaseSourceHint label={kbSourceHint} />
        </ModalSection>
      )}

      {showService && fieldSchema.isLightRail && (
        <ModalSection>
          <StationSectionTitle title="Service & Connections" icon={getStationDetailsSectionIcon('service')} pageHeading />
          <StationDetailsSubsection title="Service">
            <div className="modal-details-grid modal-facilities-grid">
              {fieldSchema.showDateOpened && (
                <StationDetailField
                  label="Date opened"
                  value={formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.dateOpened))}
                  pendingFieldChanges={pendingFieldChanges}
                />
              )}
              {fieldSchema.showLimitedService && (
                <StationDetailField
                  label="Limited service"
                  value={formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.isLimitedService))}
                  pendingFieldChanges={pendingFieldChanges}
                />
              )}
              {fieldSchema.showStaffingLevel && (
                <StationDetailField
                  label="Staffed"
                  value={formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.isStaffed))}
                  pendingFieldChanges={pendingFieldChanges}
                  showIcon
                  iconKey="staffing"
                />
              )}
            </div>
          </StationDetailsSubsection>
          {(fieldSchema.showConnectionBus || fieldSchema.showConnectionTrain) && (
            <StationDetailsSubsection title="Connections">
              <div className="modal-details-grid modal-facilities-grid">
                {fieldSchema.showConnectionBus && (
                  <StationDetailField
                    label="Bus"
                    value={formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.bus))}
                    pendingFieldChanges={pendingFieldChanges}
                    showIcon
                    iconKey="bus"
                  />
                )}
                {fieldSchema.showConnectionTrain && (
                  <StationDetailField
                    label="Train"
                    value={formatValue(readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.train))}
                    pendingFieldChanges={pendingFieldChanges}
                    showIcon
                    iconKey="train"
                  />
                )}
              </div>
            </StationDetailsSubsection>
          )}
          <KnowledgebaseSourceHint label={kbSourceHint} />
        </ModalSection>
      )}

      {showService &&
        !fieldSchema.isLightRail &&
        additionalDoc?.connections &&
        (fieldSchema.showConnectionBus ||
          fieldSchema.showConnectionTaxi ||
          fieldSchema.showConnectionUnderground) && (
        <ModalSection>
          <StationSectionTitle title="Connections" icon={getStationDetailsSectionIcon('service', { label: 'Connections' })} />
          <StationDetailsSubsection title="Modes">
            <div className="modal-details-grid modal-facilities-grid">
              {fieldSchema.showConnectionBus && (
                <StationDetailField
                  label="Bus"
                  value={formatValue(additionalDoc.connections.connectionBus)}
                  pendingFieldChanges={pendingFieldChanges}
                  showIcon
                  iconKey="bus"
                />
              )}
              {fieldSchema.showConnectionTaxi && (
                <StationDetailField
                  label="Taxi"
                  value={formatValue(additionalDoc.connections.connectionTaxi)}
                  pendingFieldChanges={pendingFieldChanges}
                  showIcon
                  iconKey="taxi"
                />
              )}
              {fieldSchema.showConnectionUnderground && (
                <StationDetailField
                  label="Underground"
                  value={formatValue(additionalDoc.connections.connectionUnderground)}
                  pendingFieldChanges={pendingFieldChanges}
                  showIcon
                  iconKey="underground"
                />
              )}
            </div>
          </StationDetailsSubsection>
          <KnowledgebaseSourceHint label={kbSourceHint} />
        </ModalSection>
      )}

      {showService &&
        !fieldSchema.isLightRail &&
        (fieldSchema.showStationStatusSection ||
          fieldSchema.showStaffingLevel ||
          fieldSchema.showRequestStop ||
          fieldSchema.showLimitedService) && (
        <ModalSection>
          <StationSectionTitle title="Service" icon={getStationDetailsSectionIcon('service')} />
          {fieldSchema.showStationStatusSection && (
            <StationDetailsSubsection title="Status">
              <div className="modal-details-grid modal-facilities-grid">
                <StationDetailField
                  label="Status"
                  value={formatOptionalText(additionalDoc?.stationstatus?.status)}
                  pendingFieldChanges={pendingFieldChanges}
                />
                <StationDetailField
                  label="Operational period"
                  value={formatOptionalText(additionalDoc?.stationstatus?.operationalperiod)}
                  pendingFieldChanges={pendingFieldChanges}
                />
              </div>
            </StationDetailsSubsection>
          )}
          {(fieldSchema.showStaffingLevel ||
            fieldSchema.showRequestStop ||
            fieldSchema.showLimitedService) && (
            <StationDetailsSubsection title="Operations">
              <div className="modal-details-grid modal-facilities-grid">
                {fieldSchema.showStaffingLevel && (
                  <StationDetailField
                    label="Staffing level"
                    value={formatValue(additionalDoc?.staffingLevel)}
                    pendingFieldChanges={pendingFieldChanges}
                    showIcon
                    iconKey="staffing"
                  />
                )}
                {fieldSchema.showRequestStop && (
                  <StationDetailField
                    label="Request stop"
                    value={formatValue(additionalDoc?.is?.isrequeststop)}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
                {fieldSchema.showLimitedService && (
                  <StationDetailField
                    label="Limited service"
                    value={formatValue(additionalDoc?.is?.Islimitedservice)}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
              </div>
            </StationDetailsSubsection>
          )}
          {!(
            additionalDoc?.connections &&
            (fieldSchema.showConnectionBus ||
              fieldSchema.showConnectionTaxi ||
              fieldSchema.showConnectionUnderground)
          ) ? (
            <KnowledgebaseSourceHint label={kbSourceHint} />
          ) : null}
        </ModalSection>
      )}

      {showFacilities && fieldSchema.facilityKeys.length > 0 && additionalDoc?.facilities && (
        <ModalSection>
          <StationSectionTitle title="Facilities" icon={getStationDetailsSectionIcon('facilities')} pageHeading />
          <StationDetailsSubsection title="Amenities">
            <div className="modal-details-grid modal-facilities-grid">
              {fieldSchema.facilityKeys.map((key) => (
                <StationDetailField
                  key={key}
                  label={key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
                  value={formatValue((additionalDoc.facilities as Record<string, unknown> | undefined)?.[key])}
                  pendingFieldChanges={pendingFieldChanges}
                  showIcon
                  iconKey={key}
                />
              ))}
            </div>
          </StationDetailsSubsection>
          <KnowledgebaseSourceHint label={kbSourceHint} />
        </ModalSection>
      )}

      {showKnowledgebaseContent && (
        <>
          {showAll
            ? knowledgebaseSidebarSections.map((section) => (
                <StationKnowledgebasePanel
                  key={section.key}
                  sectionKey={section.key}
                  label={section.label}
                  value={section.value}
                  crs={knowledgebaseCrs}
                  fetchedAt={knowledgebaseFetchedAt}
                  lastUpdatedLabel={panelLastUpdatedLabel}
                  status={knowledgebaseStatus}
                  errorMessage={knowledgebaseError}
                />
              ))
            : knowledgebaseSection &&
              knowledgebaseSection.key !== KNOWLEDGEBASE_OVERVIEW_KEY && (
                <StationKnowledgebasePanel
                  sectionKey={knowledgebaseSection.key}
                  label={knowledgebaseSection.label}
                  value={knowledgebaseSection.value}
                  crs={knowledgebaseCrs}
                  fetchedAt={knowledgebaseFetchedAt}
                  lastUpdatedLabel={panelLastUpdatedLabel}
                  status={knowledgebaseStatus}
                  errorMessage={knowledgebaseError}
                />
              )}
          {!showAll &&
            !knowledgebaseSection &&
            (knowledgebaseStatus === 'loading' ||
              knowledgebaseStatus === 'idle' ||
              knowledgebaseStatus === 'error') && (
              <StationKnowledgebasePanel
                label="Knowledgebase"
                value={{}}
                crs={knowledgebaseCrs}
                status={knowledgebaseStatus}
                errorMessage={knowledgebaseError}
              />
            )}
        </>
      )}

      {showUsage && isGbnrStation && hasGbnrPassUsageData && (
        <ModalSection>
          <StationSectionTitle title="Station Usage" icon={getStationDetailsSectionIcon('usage')} pageHeading />
          <>
              {visibleGbnrUsageMetricOptions.length > 1 ? (
                <div className="station-details-network-tabs-wrap">
                  <div
                    className="network-station-tab-group station-usage-metric-tabs"
                    role="tablist"
                    aria-label="Usage metric"
                  >
                    {visibleGbnrUsageMetricOptions.map((option) => (
                      <BUTTabButton
                        key={option.id}
                        type="button"
                        width="hug"
                        role="tab"
                        pressed={gbnrUsageMetric === option.id}
                        ariaSelected={gbnrUsageMetric === option.id}
                        onClick={() => setGbnrUsageMetric(option.id)}
                      >
                        {option.label}
                      </BUTTabButton>
                    ))}
                  </div>
                </div>
              ) : null}
              {showOrrUsageChart ? (
                <StationDetailsSubsection title="Graph view">
                  <StationUsageAreaChart
                    data={
                      isCombinedUsageMetric || gbnrUsageMetric === 'entriesExits'
                        ? orrEntryChartPoints
                        : orrInterchangeChartPoints
                    }
                    secondaryData={
                      isCombinedUsageMetric ? orrInterchangeChartPoints : null
                    }
                    primarySeriesLabel="Entries & exits"
                    secondarySeriesLabel="Interchanges"
                    stationName={
                      isCombinedUsageMetric ? orrUsageStationName : activeOrrChartName
                    }
                  />
                </StationDetailsSubsection>
              ) : null}
              <StationDetailsSubsection title="Data view">
                <div className="modal-details-grid modal-facilities-grid station-usage-data-grid">
                  {isCombinedUsageMetric ? (
                    combinedOrrDataYears.length > 0 ? (
                      combinedOrrDataYears.map((row) => (
                        <div
                          key={`orr-combined-${row.year}`}
                          className="modal-detail-item station-usage-combined-year"
                        >
                          <div className="modal-detail-label-row">
                            <span className="modal-detail-label">{row.year}</span>
                          </div>
                          <span className="modal-detail-value">
                            {row.entriesExits ?? BLANK_DISPLAY}
                          </span>
                          {row.interchanges != null ? (
                            <span className="station-usage-combined-year__interchanges">
                              {row.interchanges}
                            </span>
                          ) : null}
                        </div>
                      ))
                    ) : (
                      <p className="edit-hint">{activeOrrEmptyHint}</p>
                    )
                  ) : activeOrrEntries.length > 0 ? (
                    activeOrrEntries.map((entry) => (
                      <StationDetailField
                        key={`orr-${gbnrUsageMetric}-${entry.year}`}
                        label={entry.year}
                        value={entry.value}
                      />
                    ))
                  ) : (
                    <p className="edit-hint">{activeOrrEmptyHint}</p>
                  )}
                </div>
              </StationDetailsSubsection>
              <p className="station-usage-data-notice">
                {hasLimitedOrrPassengerData ? (
                  <>* This is a new station, so usage data for it will be limited.</>
                ) : (
                  <>
                    * New data added once a year, usually in November.
                    <br />
                    ** Please note we show usage data by the year it was released, as the data period ranges
                    from April to March (for example, April 2024 to March 2025).
                    <br />
                    *** Please note that no data was released for 2003–2004, so those years are not shown.
                  </>
                )}
              </p>
          </>
          <KnowledgebaseSourceHint label={usageSourceHint} />
        </ModalSection>
      )}

      {showUsage && isGbnrStation && odmFlowsState.status === 'ready' && (
        <StationOdmFlowsSection state={odmFlowsState} />
      )}

      {showUsage &&
        !isGbnrStation &&
        (station.yearlyPassengers || additionalDoc?.yearlyPassengers) && (
        <ModalSection>
          <StationSectionTitle title="Station Usage" icon={getStationDetailsSectionIcon('usage')} pageHeading />
          {yearlyPassengerChartPoints.length >= 2 ? (
            <StationDetailsSubsection title="Graph view">
              <StationUsageAreaChart
                data={yearlyPassengerChartPoints}
                stationName={station.stationName}
              />
            </StationDetailsSubsection>
          ) : null}
          <StationDetailsSubsection title="Data view">
            <div className="modal-details-grid modal-facilities-grid station-usage-data-grid">
              {yearlyPassengerEntries.map((entry) => (
                <StationDetailField
                  key={entry.year}
                  label={entry.year}
                  value={entry.value}
                  pendingFieldChanges={pendingFieldChanges}
                />
              ))}
            </div>
          </StationDetailsSubsection>
          <p className="station-usage-data-notice">
            {hasLimitedPassengerData ? (
              <>* This is a new station, so usage data for it will be limited.</>
            ) : (
              <>
                * New data added once a year, usually in November.
                <br />
                ** Please note we show usage data by the year it was released, as the data period ranges
                from April to March (for example, April 2024 to March 2025).
                <br />
                *** Please note that no data was released for 2003–2004, so those years are not shown.
              </>
            )}
          </p>
          <KnowledgebaseSourceHint label={usageSourceHint} />
        </ModalSection>
      )}

      {showAdmin && (
        <>
          <ModalSection>
            <StationSectionTitle title="Admin" icon={getStationDetailsSectionIcon('admin')} pageHeading />
            <StationDetailsSubsection title="Identifiers">
              <div className="modal-details-grid modal-facilities-grid">
                <StationDetailField
                  label="ID"
                  value={formatOptionalText(station.id)}
                  pendingFieldChanges={pendingFieldChanges}
                />
                <StationDetailField
                  label="STNAREA"
                  value={formatOptionalText(station.stnarea)}
                  pendingFieldChanges={pendingFieldChanges}
                />
                {fieldSchema.isLightRail && fieldSchema.showOrderOfOpening && (
                  <StationDetailField
                    label="Order of opening"
                    value={formatValue(
                      readLightRailDocString(lightRailDoc, LIGHT_RAIL_DOC_FIELDS.orderOfOpening)
                    )}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
                {fieldSchema.showAdminUrlSlug && (
                  <StationDetailField
                    label="URL slug"
                    value={formatOptionalText(routingUrlSlug)}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
                {fieldSchema.showUrl && (
                  <StationDetailField
                    label={fieldSchema.urlFieldLabel}
                    value={formatOptionalText(stationUrlValue)}
                    pendingFieldChanges={pendingFieldChanges}
                  />
                )}
              </div>
            </StationDetailsSubsection>
            {fieldSchema.showKnowledgebaseTab && onSourceCompareChange ? (
              <StationDetailsSubsection title="Display">
                <div className="station-details-source-compare-toggle">
                  <span className="station-details-source-compare-toggle__label">
                    Highlight data sources (Firebase vs Knowledgebase)
                  </span>
                  <TOGToggleVisited
                    checked={sourceCompareEnabled}
                    onChange={onSourceCompareChange}
                    ariaLabel="Highlight data sources Firebase versus Knowledgebase"
                  />
                </div>
              </StationDetailsSubsection>
            ) : null}
            <KnowledgebaseSourceHint label={kbSourceHint} />
          </ModalSection>
          {fieldSchema.showKnowledgebaseTab && knowledgebaseOverviewSection && (
            <StationKnowledgebasePanel
              sectionKey={knowledgebaseOverviewSection.key}
              label={knowledgebaseOverviewSection.label}
              value={knowledgebaseOverviewSection.value}
              crs={knowledgebaseCrs}
              fetchedAt={knowledgebaseFetchedAt}
              lastUpdatedLabel={panelLastUpdatedLabel}
              status={knowledgebaseStatus}
              errorMessage={knowledgebaseError}
            />
          )}
          {fieldSchema.showKnowledgebaseTab &&
            !knowledgebaseOverviewSection &&
            (knowledgebaseStatus === 'loading' || knowledgebaseStatus === 'idle') && (
              <StationKnowledgebasePanel
                label="KB not-used"
                value={{}}
                status={knowledgebaseStatus}
              />
            )}
        </>
      )}
    </>
  )
}

export type { StationDetailsTab } from '../../../utils/stationCollectionFieldSchema'
export default StationDetailsView

