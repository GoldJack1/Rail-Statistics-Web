'use client'

import { useRouter, usePathname, useSearchParams, useParams } from 'next/navigation'
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowsClockwise, ChartBar, Code, Info, MapPin, Train } from '@phosphor-icons/react'

import { useServiceDetail } from '@/hooks/useServiceDetail'
import { useStations } from '@/hooks/useStations'
import { BUTBaseButton, BUTCircleButton, BUTWideButton } from '@/components/buttons'
import { BackIcon } from '@/components/icons'
import { TextCard } from '@/components/cards'
import { CarriageMap } from '@/components/darwin/CarriageMap'
import DataLicenceAttribution from '@/components/darwin/DataLicenceAttribution'
import { DarwinDetailsLayout } from '@/components/darwin/DarwinDetailsLayout'
import { ServiceStopList, slotKind } from '@/components/darwin/ServiceStopList/ServiceStopList'
import { ServiceVehicleDetails } from '@/components/darwin/ServiceVehicleDetails'
import { buildStopNameLookup, displayStopName } from '@/components/darwin/serviceStopLabel'
import { ServiceViewModeToggle } from '@/components/darwin/ServiceViewModeToggle'
import { readServiceViewMode, writeServiceViewMode, type ServiceViewMode } from '@/components/darwin/serviceViewMode'
import StationDetailField from '@/components/models/StationDetails/StationDetailField'
import StationSectionTitle from '@/components/models/StationDetails/StationSectionTitle'
import type { AccountSection } from '@/components/misc/AccountSectionNav/AccountSectionNav'
import SidebarDropdownSection from '@/components/misc/SidebarDropdownSection/SidebarDropdownSection'
import type { ServiceDetail } from '@/types/darwin'
import { railwayOperatingDayIsoFromLondonParts } from '@/utils/railwayOperatingDayUk'
import { paramAsString } from '@/utils/nextParams'
import { formatLmTocName } from '@/utils/formatLmTocName'
import { stopHasPublishedLoading } from '@/utils/darwinCoachLoading'
import './ServiceDetailPage.css'

type ServiceSection = 'overview' | 'loading' | 'formation' | 'calling' | 'raw'

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

function formatAge(ms: number | null): string {
  if (ms == null) return '—'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  return `${h}h ago`
}

function formatDateOnly(date: string): string {
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
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
  const apiUrl = `/api/darwin/service/${encodeURIComponent(data.rid)}${qp.toString() ? `?${qp.toString()}` : ''}`
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
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const location = { pathname, search: searchParams.toString() ? `?${searchParams}` : '', state: null as unknown }
  const router = useRouter()
  const rid = paramAsString(params.rid)
  const [viewMode, setViewMode] = useState<ServiceViewMode>('detailed')
  const [section, setSection] = useState<ServiceSection>('overview')

  useEffect(() => {
    setViewMode(readServiceViewMode())
  }, [])

  const selectViewMode = (mode: ServiceViewMode) => {
    setViewMode(mode)
    writeServiceViewMode(mode)
  }

  const query = useMemo(() => new URLSearchParams(location.search), [location.search])
  const historicalDate = query.get('date') || undefined
  const historicalAt = query.get('at') || undefined
  const from = query.get('from') || ''
  const todayIsoDate = useMemo(() => getCurrentRailwayDayIsoUk(), [])
  const historicalMode = !!historicalDate && historicalDate < todayIsoDate
  const futureTimetableMode = !!historicalDate && historicalDate > todayIsoDate

  const { status, data, error, ageMs, refetch } = useServiceDetail({
    rid,
    date: historicalDate,
    at: historicalAt,
    pollMs: historicalMode || futureTimetableMode ? 0 : 15_000,
  })
  const { stations } = useStations()
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
    if (!data) return rid
    const dest = data.destinationName || data.destination
    return `${data.trainId} · ${data.originName || data.origin} → ${dest}`
  }, [data, rid])

  const subtitle = useMemo(() => {
    const serviceDate = data?.ssd ? formatDateOnly(data.ssd) : null
    const histDate = data?.historicalDate ? formatDateOnly(data.historicalDate) : null
    const dateText = histDate
      ? `Service date ${serviceDate || '—'} · Viewing ${histDate}`
      : serviceDate
        ? `Service date ${serviceDate}`
        : ''
    if (status === 'ok')        return `${historicalMode ? 'Historical snapshot' : (futureTimetableMode ? 'Timetable view' : `Live · updated ${formatAge(ageMs)}`)}${dateText ? `\n${dateText}` : ''}`
    if (status === 'stale')     return `${historicalMode ? 'Historical snapshot' : (futureTimetableMode ? 'Timetable view' : `Stale · ${formatAge(ageMs)}`)}${dateText ? `\n${dateText}` : ''}`
    if (status === 'loading')   return `Loading service detail…${dateText ? `\n${dateText}` : ''}`
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
            <BUTCircleButton
              ariaLabel="Refresh service detail"
              instantAction
              colorVariant="primary"
              onClick={refetch}
              icon={<ArrowsClockwise size={16} aria-hidden />}
            />
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
        if (id === 'overview' || id === 'loading' || id === 'formation' || id === 'calling' || id === 'raw') {
          if (id === 'loading' && !hasLoading) return
          setSection(id)
        }
      }}
      ariaLabel="Service sections"
      minSectionCount={hasLoading ? 5 : 4}
    >
        {status === 'not-found' && (
          <section className="modal-section">
            <StationSectionTitle title="Service not found" icon={Info} pageHeading />
            <p className="edit-hint kb-source-hint">
              RID <code>{rid}</code> isn’t in today’s timetable. It may have already run, or the daemon may be using yesterday’s file.
            </p>
          </section>
        )}

        {status === 'error' && !data && (
          <section className="modal-section">
            <StationSectionTitle title="Service unavailable" icon={Info} pageHeading />
            <p className="edit-hint kb-source-hint">{error}</p>
            <p className="edit-hint kb-source-hint kb-source-hint--continued">
              Is the daemon running? Start it with <code>npm run devdarwin</code> from the repo root.
            </p>
          </section>
        )}

        {status === 'loading' && !data && (
          <section className="modal-section">
            <StationSectionTitle title="Overview" icon={Info} pageHeading />
            <p className="edit-hint kb-source-hint">Loading service detail…</p>
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
                <div className="svc-banner svc-banner--cancel">
                  {isScheduleDeactivatedReason(data.cancellation.reason) ? (
                    <span className="svc-banner-label">Cancelled</span>
                  ) : (
                    <>
                      <span className="svc-banner-label">Cancelled —</span> {data.cancellation.reason}
                      {data.cancellation.code && <span className="svc-banner-code"> (code {data.cancellation.code})</span>}
                    </>
                  )}
                </div>
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
                  <div className="svc-banner svc-banner--cancel">
                    <span className="svc-banner-label">Partial cancellation —</span> {summary}
                    {distinctReason && <> {distinctReason}</>}
                  </div>
                );
              })()}
              {!data.cancelled && !data.partiallyCancelled && data.delayReason && (
                <div className="svc-banner svc-banner--delay">
                  <span className="svc-banner-label">Delay reason —</span> {data.delayReason.reason}
                  {data.delayReason.code && <span className="svc-banner-code"> (code {data.delayReason.code})</span>}
                </div>
              )}

              {data.alerts && data.alerts.length > 0 && data.alerts.map((al) => (
                <div key={al.id} className="svc-banner svc-banner--alert">
                  <span className="svc-banner-label">Alert</span>
                  {al.source && <span className="svc-banner-source">{al.source}</span>}{' '}
                  {al.text}
                </div>
              ))}

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
                <StationDetailField label="Destination" value={data.destinationName || data.destination} />
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
              <span>Updated {new Date(data.updatedAt).toLocaleString('en-GB', { timeZone: 'Europe/London' })}</span>
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
              {data.associations && data.associations.length > 0 && (
                <div className="svc-association-list">
                  {data.associations.map((a) => {
                    const next = new URLSearchParams()
                    if (historicalDate) next.set('date', historicalDate)
                    if (historicalAt) next.set('at', historicalAt)
                    if (from) next.set('from', from)
                    const href = `/services/${encodeURIComponent(a.otherRid)}${next.toString() ? `?${next.toString()}` : ''}`
                    return (
                      <TextCard
                        key={`${a.category}-${a.otherRid}-${a.tiploc}`}
                        title={describeAssociation(a)}
                        description={a.isCancelled ? 'Cancelled' : undefined}
                        state={a.isCancelled ? 'redAction' : 'default'}
                        to={href}
                        ariaLabel={`Open associated service ${a.otherTrainId || a.otherRid}`}
                      />
                    )
                  })}
                </div>
              )}
            </section>
        )}

        {data && section === 'calling' && (
            <section className="modal-section svc-pattern-card" aria-label="Calling pattern">
              <ServiceStopList
                stops={data.stops}
                viewMode={viewMode}
                boardDate={historicalDate || data.ssd || null}
                historical={!!data.historicalDate}
                returnTo={`/services/${encodeURIComponent(data.rid)}${location.search || ''}`}
              />
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