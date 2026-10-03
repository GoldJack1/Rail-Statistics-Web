'use client'

import { useRouter, useSearchParams, useParams } from 'next/navigation'
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowsClockwise, ChartBar, Code, Info, MapPin, Train } from '@phosphor-icons/react'

import { useServiceDetail, useServiceDetails } from '@/hooks/useServiceDetail'
import { useStations } from '@/hooks/useStations'
import { BUTBaseButton, BUTWideButton } from '@/components/buttons'
import { BackIcon } from '@/components/icons'
import { TextCard } from '@/components/cards'
import { CarriageMap } from '@/components/darwin/CarriageMap'
import DataLicenceAttribution from '@/components/darwin/DataLicenceAttribution'
import { DarwinDetailsLayout } from '@/components/darwin/DarwinDetailsLayout'
import { ServiceStopList, slotKind } from '@/components/darwin/ServiceStopList/ServiceStopList'
import { ServiceVehicleDetails } from '@/components/darwin/ServiceVehicleDetails'
import { buildStopNameLookup, displayStopName } from '@/components/darwin/serviceStopLabel'
import { ServiceViewModeToggle } from '@/components/darwin/ServiceViewModeToggle'
import { useServiceViewMode } from '@/components/darwin/serviceViewMode'
import StationDetailField from '@/components/models/StationDetails/StationDetailField'
import StationSectionTitle from '@/components/models/StationDetails/StationSectionTitle'
import type { AccountSection } from '@/components/misc/AccountSectionNav/AccountSectionNav'
import SidebarDropdownSection from '@/components/misc/SidebarDropdownSection/SidebarDropdownSection'
import type { ServiceDetail } from '@/types/darwin'
import { resolveDarwinBrowserUrl } from '@/utils/darwinReadyFetch'
import { railwayOperatingDayIsoFromLondonParts } from '@/utils/railwayOperatingDayUk'
import { formatLmTocName } from '@/utils/formatLmTocName'
import { stopHasPublishedLoading } from '@/utils/darwinCoachLoading'
import {
  consumeLegacyFromParam,
  isServiceSection,
  parseServicePath,
  readServiceReturn,
  replaceServiceUrl,
  serviceHref,
  type ServiceSection,
} from '@/utils/serviceUrl'
import { buildSplitWorking, isPassengerHeadcode, joinStationNames, nextWorkingSentence, previousNextWorkings, previousWorkingSentence, serviceDestinationLabel, splitPortionLabel, splitTogetherLabel } from '@/utils/splitWorking'
import '../ServiceDetailPage.css'

const BASE_SERVICE_SECTIONS: AccountSection[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'formation', label: 'Formation', icon: Train },
  { id: 'calling', label: 'Calling pattern', icon: MapPin },
  { id: 'raw', label: 'Raw data', icon: Code },
]

const LOADING_SECTION: AccountSection = { id: 'loading', label: 'Loading capacity', icon: ChartBar }

/**
 * Phrase a Darwin association into a sentence the passenger can act on.
 * The "main" side of an association is the train that *continues onward* with
 * (most of) the formation; the "associated" side is the joining/leaving
 * portion. From the perspective of *this* RID we tailor the verb:
 *   - VV / divide:     this train splits — the associated portion goes elsewhere.
 *   - JJ / join:       this train joins another — the associated portion will be attached.
 *   - NP / next portion: this train ends and continues *as* the next service.
 */
function describeAssociation(a: NonNullable<ReturnType<typeof useServiceDetail>['data']>['associations'][number]): string {
  const where = a.tiplocName || a.tiploc
  const otherDest = a.otherDestinationName || 'another destination'
  const otherOrig = a.otherOriginName || 'elsewhere'
  const headcode  = a.otherTrainId ? ` (${a.otherTrainId})` : ''
  const time = a.role === 'main' ? a.assocTime : a.mainTime
  const timeText = time ? `${time.replace(/:00$/, '').replace(/(\d{2}:\d{2}).*/, '$1')} ` : ''
  const trainRef = a.otherTrainId || `${a.otherRid}${headcode}`
  switch (a.category) {
    case 'VV':
      return `This train splits at ${where}. The other portion forms ${timeText}to ${otherDest}${headcode}.`
    case 'JJ':
      return `This train joins another at ${where}. The other portion is ${timeText}from ${otherOrig}${headcode}.`
    case 'NP':
      return a.role === 'main'
        ? `This train will then form ${timeText}to ${otherDest} as ${trainRef} from ${where}.`
        : `This train previously ran as ${timeText}from ${otherOrig} as ${trainRef} before ${where}.`
    default:
      return `Associated with ${a.otherTrainId || a.otherRid} at ${where}.`
  }
}

function stopTplFromBackLink(from: string, stops: ServiceDetail['stops'], origin: string | null | undefined): string | null {
  const match = /\/departures\/([^/?#]+)/i.exec(from)
  const code = match?.[1] ? decodeURIComponent(match[1]).trim().toUpperCase() : ''
  if (code) {
    const byCrs = stops.find((s) => (s.crs || '').toUpperCase() === code)
    if (byCrs) return byCrs.tpl
    const byTpl = stops.find((s) => s.tpl === code)
    if (byTpl) return byTpl.tpl
  }
  return origin || null
}

function workingServiceHref(
  a: { otherUid: string | null; otherRid: string },
  date: string | null | undefined,
  viewMode: ReturnType<typeof useServiceViewMode>[0],
) {
  return serviceHref({
    id: a.otherUid || a.otherRid,
    date,
    section: 'calling',
    mode: viewMode,
  })
}

function WorkingLinkCards({
  workings,
  date,
  viewMode,
}: {
  workings: ReturnType<typeof previousNextWorkings>['previous']
  date: string | null | undefined
  viewMode: ReturnType<typeof useServiceViewMode>[0]
}) {
  if (!workings.length) return null
  return (
    <div className="svc-working-cards">
      {workings.map((w) => (
        <TextCard
          key={`${w.kind}-${w.association.otherRid}-${w.association.tiploc}`}
          title={w.kind === 'previous' ? previousWorkingSentence(w) : nextWorkingSentence(w)}
          to={workingServiceHref(w.association, date, viewMode)}
          ariaLabel={w.kind === 'previous' ? previousWorkingSentence(w) : nextWorkingSentence(w)}
        />
      ))}
    </div>
  )
}

function formatAge(ms: number | null): string {
  if (ms == null) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 5) return 'just now'
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return m === 1 ? '1 min ago' : `${m} min ago`
  const h = Math.floor(m / 60)
  return h === 1 ? '1 hr ago' : `${h} hr ago`
}

function formatDateOnly(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function getCurrentRailwayDayIsoUk(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(now)

  const pick = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value || '00'

  const year = Number(pick('year'))
  const month = Number(pick('month'))
  const day = Number(pick('day'))
  const hour = Number(pick('hour'))
  const minute = Number(pick('minute'))

  return railwayOperatingDayIsoFromLondonParts(year, month, day, hour, minute)
}

function isScheduleDeactivatedReason(reason: string | null | undefined): boolean {
  if (!reason) return false
  return reason.trim().toLowerCase().includes('schedule deactivated')
}

/**
 * Collapsible "raw data" panel rendered at the bottom of the service detail
 * page. Shows the full ServiceDetail payload as pretty-printed JSON, plus a
 * couple of summary chips so power users can see at a glance which feeds
 * contributed which sections. Two convenience buttons: copy-to-clipboard
 * and open-raw-API in a new tab.
 *
 * Defined inline (rather than as its own component file) because it's only
 * used on this one page and depends on the local layout tokens.
 */
const RawDataDump: React.FC<{ data: ServiceDetail }> = ({ data }) => {
  const [open, setOpen] = useState(false)
  // Quick "what's populated" summary so the user can see whether a missing
  // section is "feed didn't publish" vs "field doesn't exist". Cheap to
  // render even on every poll, so we leave it always-on.
  const present: Array<[string, boolean | number]> = [
    ['Darwin formation',  !!data.formation],
    ['PTAC consist',      !!data.consist],
    ['Reverse formation', data.reverseFormation],
    ['Cancellation',      data.cancelled],
    ['Partial cancel',    data.partiallyCancelled],
    ['Delay reason',      !!data.delayReason],
    ['Associations',      data.associations?.length || 0],
    ['Alerts',            data.alerts?.length || 0],
    ['Stops',             data.stops?.length || 0],
    ['Stops with loading', (data.stops || []).filter((s: ServiceDetail['stops'][number]) => s.coachLoading || s.loadingPercentage != null).length],
  ]
  const qp = new URLSearchParams()
  if (data.historicalDate) qp.set('date', data.historicalDate)
  if (data.historicalAt) qp.set('at', data.historicalAt)
  const apiUrl = resolveDarwinBrowserUrl(
    `/api/darwin/service/${encodeURIComponent(data.rid)}${qp.toString() ? `?${qp.toString()}` : ''}`,
  )
  return (
    <details className="svc-rawdump" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="svc-rawdump-summary">
        <span className="svc-rawdump-title">Raw data</span>
        <span className="svc-rawdump-hint">{open ? 'click to collapse' : 'click to expand the full daemon payload'}</span>
      </summary>
      <div className="modal-details-grid svc-rawdump-meta">
        {present.map(([label, val]) => (
          <StationDetailField
            key={label}
            label={label}
            value={typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}
          />
        ))}
      </div>
      <div className="svc-rawdump-actions">
        <BUTBaseButton
          variant="chip"
          width="hug"
          colorVariant="accent"
          className="svc-rawdump-btn svc-rawdump-btn--link"
          href={apiUrl}
          target="_blank"
          rel="noopener"
        >
          Open API URL ↗
        </BUTBaseButton>
      </div>
      {/* Heavy JSON stringification + DOM is gated behind `open` so the
       * service-detail page doesn't pay the cost on every poll while the
       * panel is collapsed. The body is also memoised by RID + updatedAt
       * so polls that return the same data don't trigger re-stringify. */}
      {open && <RawDataBody data={data} />}
    </details>
  )
}

/**
 * The expensive part of the raw-data dump — only mounts when the parent
 * `<details>` is open. Memoised on `(rid, updatedAt)` so a fresh data ref
 * with identical content (common with polling hooks) doesn't re-stringify.
 */
const RawDataBody: React.FC<{ data: ServiceDetail }> = React.memo(
  ({ data }) => {
    const json = useMemo(() => JSON.stringify(data, null, 2), [data])
    return (
      <>
        <div className="svc-rawdump-actions">
          <BUTBaseButton
            variant="chip"
            width="hug"
            colorVariant="accent"
            instantAction
            className="svc-rawdump-btn"
            onClick={() => navigator.clipboard?.writeText(json).catch(() => {})}
          >
            Copy JSON
          </BUTBaseButton>
          <span className="svc-rawdump-bytes">{(json.length / 1024).toFixed(1)} KB</span>
        </div>
        <pre className="svc-rawdump-pre"><code>{json}</code></pre>
      </>
    )
  },
  (prev, next) =>
    prev.data.rid === next.data.rid && prev.data.updatedAt === next.data.updatedAt
)

const ServiceDetailPage: React.FC = () => {
  const params   = useParams()
  const searchParams = useSearchParams()
  const router = useRouter()
  const parts = useMemo(() => {
    const raw = params.parts
    if (Array.isArray(raw)) return raw.map((p) => String(p))
    if (typeof raw === 'string') return [raw]
    return []
  }, [params.parts])
  const parsed = useMemo(() => parseServicePath(parts), [parts])
  const [viewMode, selectViewMode] = useServiceViewMode()
  const [section, setSection] = useState<ServiceSection>(parsed.section)

  const query = useMemo(() => new URLSearchParams(searchParams.toString()), [searchParams])
  const todayIsoDate = useMemo(() => getCurrentRailwayDayIsoUk(), [])
  const date = parsed.date || query.get('date') || todayIsoDate
  const serviceId = parsed.id
  const from = useMemo(
    () => consumeLegacyFromParam(query.get('from'), serviceId, date) || readServiceReturn(serviceId, date),
    [query, serviceId, date],
  )
  const historicalAt = from.includes('/departures/') ? undefined : query.get('at') || undefined
  const historicalDate = date
  const historicalMode = !!historicalDate && historicalDate < todayIsoDate
  const futureTimetableMode = !!historicalDate && historicalDate > todayIsoDate

  useEffect(() => {
    if (parsed.mode) selectViewMode(parsed.mode)
  }, [parsed.mode, selectViewMode])

  useEffect(() => {
    setSection(parsed.section)
  }, [parsed.section])

  const { status, data, error, ageMs, refetch } = useServiceDetail({
    rid: serviceId,
    date: historicalDate,
    at: historicalAt,
    pollMs: historicalMode || futureTimetableMode ? 0 : 3_000,
  })
  const { stations } = useStations()
  const canonicalId = data?.uid || serviceId
  const canonicalHref = serviceHref({
    id: canonicalId,
    date: data?.ssd || date,
    section,
    mode: viewMode,
    at: historicalAt,
  })

  useEffect(() => {
    if (!serviceId) return
    replaceServiceUrl(canonicalHref)
  }, [canonicalHref, serviceId])

  const partnerIds = useMemo(() => {
    const ids = new Set<string>()
    for (const a of data?.associations || []) {
      if (a.isDeleted) continue
      if (a.category !== 'VV' && a.category !== 'JJ' && a.category !== 'NP') continue
      if (!isPassengerHeadcode(a.otherTrainId)) continue
      if (a.otherRid) ids.add(a.otherRid)
      else if (a.otherUid) ids.add(a.otherUid)
    }
    return [...ids]
  }, [data])
  const partnerMap = useServiceDetails(partnerIds, historicalDate, historicalAt)
  const partners = useMemo(() => {
    const seen = new Set<string>()
    const list: ServiceDetail[] = []
    for (const svc of partnerMap.values()) {
      if (seen.has(svc.rid) || svc.rid === data?.rid) continue
      seen.add(svc.rid)
      list.push(svc)
    }
    return list
  }, [partnerMap, data?.rid])
  const splitWorking = useMemo(
    () => (data ? buildSplitWorking(data, partners) : null),
    [data, partners],
  )
  const portionWorkings = useMemo(
    () => previousNextWorkings(data?.associations, partnerMap),
    [data?.associations, partnerMap],
  )
  const destinationLabel = splitWorking
    ? joinStationNames(splitWorking.portions.map((p) => p.destinationName))
    : data
      ? serviceDestinationLabel(data)
      : ''
  const loadingTpl = useMemo(
    () => (data ? stopTplFromBackLink(from, data.stops, data.origin) : null),
    [data, from],
  )
  const hasLoading = useMemo(
    () => Boolean(data?.stops?.some(stopHasPublishedLoading)),
    [data],
  )
  const serviceSections = useMemo(() => {
    if (!hasLoading) return BASE_SERVICE_SECTIONS
    const [overview, ...rest] = BASE_SERVICE_SECTIONS
    return [overview, LOADING_SECTION, ...rest]
  }, [hasLoading])

  useEffect(() => {
    if (section === 'loading' && !hasLoading) setSection('overview')
  }, [section, hasLoading])

  const fallbackStopNameLookup = useMemo(() => buildStopNameLookup(stations), [stations])

  const title = useMemo(() => {
    if (!data) return serviceId
    const dest = destinationLabel || data.destinationName || data.destination
    return `${data.trainId} · ${data.originName || data.origin} → ${dest}`
  }, [data, serviceId, destinationLabel])

  const subtitle = useMemo(() => {
    const serviceDate = data?.ssd ? formatDateOnly(data.ssd) : null
    const uidLine = data?.uid ? `UID ${data.uid}` : ''
    const histDate = data?.historicalDate ? formatDateOnly(data.historicalDate) : null
    const running = serviceDate ? `Runs ${serviceDate}` : ''
    const dateText = [uidLine, running, histDate && histDate !== serviceDate ? `Snapshot ${histDate}` : '']
      .filter(Boolean)
      .join(' · ')
    const liveLine = historicalMode
      ? 'Snapshot'
      : futureTimetableMode
        ? 'Timetable'
        : `Live · ${formatAge(ageMs)}`
    const staleLine = historicalMode
      ? 'Snapshot'
      : futureTimetableMode
        ? 'Timetable'
        : `Last update ${formatAge(ageMs)}`
    if (status === 'ok')        return `${liveLine}${dateText ? `\n${dateText}` : ''}`
    if (status === 'stale')     return `${staleLine}${dateText ? `\n${dateText}` : ''}`
    if (status === 'loading')   return `Loading…${dateText ? `\n${dateText}` : ''}`
    if (status === 'error')     return error ? `Error: ${error}` : 'Service unavailable'
    if (status === 'not-found') return 'Service not found'
    return dateText
  }, [status, error, ageMs, historicalMode, futureTimetableMode, data])

  const callingCount = data ? data.stops.filter((s) => slotKind(s.slot) !== 'pass').length : 0
  const passingCount = data ? data.stops.length - callingCount : 0

  return (
    <DarwinDetailsLayout
      title={title}
      subtitle={subtitle}
      headerClassName={`service-detail-header service-detail-header--${status}`}
      sidebarHeader={(
        <ServiceViewModeToggle
          className="svc-viewmode-switch--sidebar"
          viewMode={viewMode}
          onChange={selectViewMode}
        />
      )}
      actionContent={(
        <div className="station-details-header-actions service-detail-header-actions">
          <div className="station-details-header-actions__controls">
            <BUTWideButton
              width="hug"
              icon={<BackIcon />}
              onClick={() => {
                if (from) { router.push(from); return }
                if (window.history.length > 1) { router.back(); return }
                router.push('/departures')
              }}
            >
              Back
            </BUTWideButton>
            <BUTWideButton
              width="hug"
              instantAction
              colorVariant="primary"
              onClick={refetch}
              icon={<ArrowsClockwise size={16} aria-hidden />}
              ariaLabel="Refresh service detail"
            >
              Refresh
            </BUTWideButton>
          </div>
          <ServiceViewModeToggle
            className="svc-viewmode-switch--header"
            viewMode={viewMode}
            onChange={selectViewMode}
          />
        </div>
      )}
      sections={serviceSections}
      activeSectionId={section}
      onSelect={(id) => {
        if (!isServiceSection(id)) return
        if (id === 'loading' && !hasLoading) return
        setSection(id)
      }}
      ariaLabel="Service sections"
      minSectionCount={hasLoading ? 5 : 4}
    >
        {status === 'not-found' && (
          <section className="modal-section">
            <StationSectionTitle title="Service not found" icon={Info} pageHeading />
            <p className="edit-hint kb-source-hint">
              RID <code>{serviceId}</code> was not found for {historicalDate || 'this date'}.
              The live API may still be on the previous build, or that day’s timetable is not imported yet.
            </p>
          </section>
        )}

        {status === 'error' && !data && (
          <section className="modal-section">
            <StationSectionTitle title="Service unavailable" icon={Info} pageHeading />
            <p className="edit-hint kb-source-hint">{error}</p>
          </section>
        )}

        {status === 'loading' && !data && (
          <section className="modal-section">
            <StationSectionTitle title="Overview" icon={Info} pageHeading />
            <p className="edit-hint kb-source-hint">Loading actual times…</p>
          </section>
        )}

        {data && section === 'overview' && (
          <section className="modal-section">
            <StationSectionTitle title="Overview" icon={Info} pageHeading />
            <section
              className={`svc-summary-card ${data.cancelled ? 'svc-summary-card--cancelled' : ''}`}
              aria-label="Service summary"
            >
              {data.cancelled && data.cancellation && (
                <TextCard
                  static
                  state="redAction"
                  title="Cancelled"
                  description={
                    isScheduleDeactivatedReason(data.cancellation.reason)
                      ? undefined
                      : `${data.cancellation.reason}${data.cancellation.code ? ` (code ${data.cancellation.code})` : ''}`
                  }
                />
              )}
              {!data.cancelled && data.partiallyCancelled && (() => {
                const cancelledStops = data.stops.filter((s) => s.cancelledAtStop && s.slot !== 'PP' && s.slot !== 'OPPP');
                const names = cancelledStops.map((s) => {
                  const i = data.stops.findIndex((x) => x.tpl === s.tpl && x.slot === s.slot)
                  return i >= 0 ? displayStopName(data.stops, i, fallbackStopNameLookup) : (s.name || s.tpl)
                }).filter(Boolean);
                const summary = names.length === 0
                  ? 'Some calling points are not being served.'
                  : names.length <= 4
                    ? `Not calling at: ${names.join(', ')}.`
                    : `Not calling at ${names.length} stops including ${names.slice(0, 3).join(', ')}.`;
                const distinctReason = cancelledStops.find((s) => s.cancelReasonAtStop)?.cancelReasonAtStop?.reason;
                return (
                  <TextCard
                    static
                    state="redAction"
                    title="Partial cancellation"
                    description={[summary, distinctReason].filter(Boolean).join(' ')}
                  />
                );
              })()}
              {!data.cancelled && !data.partiallyCancelled && data.delayReason && (
                <TextCard
                  static
                  state="accent"
                  title="Delay reason"
                  description={`${data.delayReason.reason}${data.delayReason.code ? ` (code ${data.delayReason.code})` : ''}`}
                />
              )}

              {data.alerts && data.alerts.length > 0 && data.alerts.map((al) => (
                <TextCard
                  key={al.id}
                  static
                  state="accent"
                  title={al.source ? `Alert · ${al.source}` : 'Alert'}
                  description={al.text}
                />
              ))}

              {(splitWorking?.associations || data.associations || [])
                .filter((a) => a.category !== 'NP' && isPassengerHeadcode(a.otherTrainId))
                .map((a) => {
                const href = serviceHref({
                  id: a.otherUid || a.otherRid,
                  date: data.ssd || date,
                  section: 'overview',
                  mode: viewMode,
                })
                const kind = a.category === 'VV' ? 'Divides' : a.category === 'JJ' ? 'Joins' : 'Portion'
                return (
                  <TextCard
                    key={`${a.category}-${a.otherRid}-${a.tiploc}`}
                    title={`${kind} · ${a.otherTrainId || a.otherUid || 'other portion'}`}
                    description={describeAssociation(a)}
                    state={a.isCancelled ? 'redAction' : 'default'}
                    to={href}
                    ariaLabel={`Open associated service ${a.otherTrainId || a.otherRid}`}
                  />
                )
              })}

              <div className="modal-details-grid">
                <StationDetailField
                  label="Operator"
                  value={formatLmTocName(
                    data.tocName,
                    data.toc,
                    data.stops[0]?.crs,
                    data.stops[data.stops.length - 1]?.crs,
                  )}
                />
                <StationDetailField label="Headcode" value={data.trainId} />
                <StationDetailField label="Origin" value={data.originName || data.origin} />
                <StationDetailField label="Destination" value={destinationLabel || data.destinationName || data.destination} />
              </div>
            </section>
            {viewMode === 'detailed' && (
              <SidebarDropdownSection
                title="Service identity"
                defaultExpanded
                className="svc-content-dropdown"
              >
                <div className="modal-details-grid">
                  <StationDetailField label="UID" value={data.uid} />
                  <StationDetailField label="Service date" value={data.ssd} />
                  <StationDetailField
                    label="Calling pattern"
                    value={`${callingCount} calling · ${passingCount} passing`}
                  />
                  <StationDetailField
                    label="Type"
                    value={`${data.isPassenger ? 'Passenger' : 'Non-passenger'}${data.trainCat ? ` · ${data.trainCat}` : ''}`}
                  />
                </div>
              </SidebarDropdownSection>
            )}
            <p className="edit-hint kb-source-hint svc-footer">
              <span>Source: Network Rail Darwin Push Port</span>
              <span className="svc-footer-sep" aria-hidden="true">·</span>
              <DataLicenceAttribution />
              <span className="svc-footer-sep" aria-hidden="true">·</span>
              <span>RID {data.rid}</span>
              <span className="svc-footer-sep" aria-hidden="true">·</span>
              <span>Updated {new Date(data.updatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London', hourCycle: 'h23', hour12: false })}</span>
            </p>
          </section>
        )}

        {data && section === 'loading' && hasLoading && (
          <section className="modal-section svc-formation-section" aria-label="Loading capacity">
            <StationSectionTitle title="Loading capacity" icon={ChartBar} pageHeading />
            <CarriageMap
              formation={data.formation}
              consist={data.consist}
              stops={data.stops}
              reverse={data.reverseFormation}
              initialTpl={loadingTpl}
              layout="loading-only"
            />
          </section>
        )}

        {data && section === 'formation' && (
            <section className="modal-section svc-formation-section" aria-label="Formation">
              <StationSectionTitle title="Formation" icon={Train} pageHeading />
              {splitWorking ? (
                <div className="svc-split-portions">
                  <SidebarDropdownSection title={splitTogetherLabel(splitWorking)} defaultExpanded>
                    <CarriageMap
                      formation={data.formation}
                      consist={splitWorking.togetherConsist}
                      stops={splitWorking.togetherStops}
                      reverse={data.reverseFormation}
                      initialTpl={loadingTpl}
                      layout="stock-only"
                      onUnitClick={(unitId) => {
                        const qp = new URLSearchParams()
                        if (historicalDate) qp.set('unitDay', historicalDate)
                        router.push(`/units/${encodeURIComponent(unitId)}${qp.toString() ? `?${qp.toString()}` : ''}`)
                      }}
                    />
                  </SidebarDropdownSection>
                  {splitWorking.portions.map((portion) => (
                    <SidebarDropdownSection
                      key={portion.rid}
                      title={splitPortionLabel(portion, splitWorking.splitName)}
                      defaultExpanded
                    >
                      <CarriageMap
                        formation={portion.rid === data.rid ? data.formation : null}
                        consist={portion.consist}
                        stops={portion.stops}
                        reverse={false}
                        layout="stock-only"
                        onUnitClick={(unitId) => {
                          const qp = new URLSearchParams()
                          if (historicalDate) qp.set('unitDay', historicalDate)
                          router.push(`/units/${encodeURIComponent(unitId)}${qp.toString() ? `?${qp.toString()}` : ''}`)
                        }}
                      />
                    </SidebarDropdownSection>
                  ))}
                  <ServiceVehicleDetails consist={data.consist} />
                </div>
              ) : (
              <div className="svc-formation-panel">
              <SidebarDropdownSection title="Coach map" defaultExpanded>
              <CarriageMap
                formation={data.formation}
                consist={data.consist}
                stops={data.stops}
                reverse={data.reverseFormation}
                initialTpl={loadingTpl}
                layout="stock-only"
                onUnitClick={(unitId) => {
                  const qp = new URLSearchParams()
                  if (historicalDate) qp.set('unitDay', historicalDate)
                  router.push(`/units/${encodeURIComponent(unitId)}${qp.toString() ? `?${qp.toString()}` : ''}`)
                }}
              />
              </SidebarDropdownSection>
              <ServiceVehicleDetails consist={data.consist} />
              </div>
              )}
            </section>
        )}

        {data && section === 'calling' && (
            <section className="modal-section svc-pattern-card" aria-label="Calling pattern">
              <div className="svc-calling-stack">
              <WorkingLinkCards workings={portionWorkings.previous} date={data.ssd || date} viewMode={viewMode} />
              {splitWorking ? (
                <div className="svc-split-portions">
                  <ServiceStopList
                    stops={splitWorking.togetherStops}
                    viewMode={viewMode}
                    boardDate={historicalMode || futureTimetableMode ? historicalDate || null : null}
                    historical={historicalMode || futureTimetableMode}
                    returnTo={canonicalHref}
                    delayReason={data.delayReason?.reason}
                    alertText={data.alerts?.[0]?.text}
                    location={data.location}
                    showAssociations={false}
                    preserveOrder
                    heading={splitTogetherLabel(splitWorking)}
                  />
                  {splitWorking.portions.map((portion) => (
                    <ServiceStopList
                      key={portion.rid}
                      stops={portion.stops}
                      viewMode={viewMode}
                      boardDate={historicalMode || futureTimetableMode ? historicalDate || null : null}
                      historical={historicalMode || futureTimetableMode}
                      returnTo={canonicalHref}
                      delayReason={portion.rid === data.rid ? data.delayReason?.reason : null}
                      location={portion.rid === data.rid ? data.location : null}
                      showLegend={false}
                      showAssociations={false}
                      preserveOrder
                      heading={splitPortionLabel(portion, splitWorking.splitName)}
                    />
                  ))}
                </div>
              ) : (
              <ServiceStopList
                stops={data.stops}
                viewMode={viewMode}
                boardDate={historicalMode || futureTimetableMode ? historicalDate || null : null}
                historical={historicalMode || futureTimetableMode}
                returnTo={canonicalHref}
                delayReason={data.delayReason?.reason}
                alertText={data.alerts?.[0]?.text}
                location={data.location}
                associations={(data.associations || []).filter((a) => a.category !== 'NP')}
                associationHref={(a) =>
                  serviceHref({
                    id: a.otherUid || a.otherRid,
                    date: data.ssd || date,
                    section: 'overview',
                    mode: viewMode,
                  })
                }
              />
              )}
              <WorkingLinkCards workings={portionWorkings.next} date={data.ssd || date} viewMode={viewMode} />
              </div>
            </section>
        )}


        {data && section === 'raw' && (
          <section className="modal-section">
            <StationSectionTitle title="Raw data" icon={Code} pageHeading />
            <RawDataDump data={data} />
          </section>
        )}
    </DarwinDetailsLayout>
  )
}

export default ServiceDetailPage