'use client'

import { useRouter, usePathname, useSearchParams, useParams } from 'next/navigation'
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowsClockwise, ChartBar, Code, Info, MapPin, Train } from '@phosphor-icons/react'

import { useServiceDetail } from '@/hooks/useServiceDetail'
import { useStations } from '@/hooks/useStations'
import { BUTBaseButton, BUTCircleButton, BUTTwoButtonBar, BUTWideButton } from '@/components/buttons'
import { BackIcon } from '@/components/icons'
import { ActivityPill } from '@/components/darwin/ActivityPill'
import { CarriageMap } from '@/components/darwin/CarriageMap'
import DataLicenceAttribution from '@/components/darwin/DataLicenceAttribution'
import { DarwinDetailsLayout } from '@/components/darwin/DarwinDetailsLayout'
import { ServiceVehicleDetails } from '@/components/darwin/ServiceVehicleDetails'
import StationDetailField from '@/components/models/StationDetails/StationDetailField'
import StationSectionTitle from '@/components/models/StationDetails/StationSectionTitle'
import type { AccountSection } from '@/components/misc/AccountSectionNav/AccountSectionNav'
import type { ServiceDetail } from '@/types/darwin'
import { railwayOperatingDayIsoFromLondonParts } from '@/utils/railwayOperatingDayUk'
import { paramAsString } from '@/utils/nextParams'
import { stopHasPublishedLoading } from '@/utils/darwinCoachLoading'
import './ServiceDetailPage.css'

const SLOT_KIND: Record<string, 'origin' | 'stop' | 'pass' | 'destination'> = {
  OR:   'origin', OPOR: 'origin',
  IP:   'stop',   OPIP: 'stop',
  PP:   'pass',   OPPP: 'pass',
  DT:   'destination', OPDT: 'destination',
}
const SLOT_KIND_LABEL: Record<'origin' | 'stop' | 'pass' | 'destination', string> = {
  origin: 'Origin',
  stop: 'Calling',
  pass: 'Passing',
  destination: 'Destination',
}
type ViewMode = 'detailed' | 'simple'
type ServiceSection = 'overview' | 'loading' | 'formation' | 'calling' | 'raw'

const BASE_SERVICE_SECTIONS: AccountSection[] = [
  { id: 'overview', label: 'Overview', icon: Info },
  { id: 'formation', label: 'Formation', icon: Train },
  { id: 'calling', label: 'Calling pattern', icon: MapPin },
  { id: 'raw', label: 'Raw data', icon: Code },
]

const LOADING_SECTION: AccountSection = { id: 'loading', label: 'Loading capacity', icon: ChartBar }

function StationsTableHead({ label, sticky }: { label: string; sticky?: boolean }) {
  return (
    <th className={sticky ? 'stations-table__name' : undefined}>
      <span className="stations-table__sort-button">{label}</span>
    </th>
  )
}

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

/** Strip seconds from working times so HH:MM:30 reads as HH:MM. */
function trimSeconds(t: string | null): string {
  return t ? t.slice(0, 5) : ''
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

function isRawTiplocName(name: string | null | undefined, tpl: string): boolean {
  if (!name) return true
  const trimmedName = name.trim()
  const trimmedTpl = tpl.trim()
  // Treat as "raw TIPLOC label" only when it is literally the TIPLOC, or a
  // fully-uppercase TIPLOC-style form. This avoids false positives like
  // station names such as "Ash" being mistaken for TIPLOC "ASH".
  if (trimmedName === trimmedTpl) return true
  return trimmedName === trimmedName.toUpperCase()
    && trimmedName.toUpperCase() === trimmedTpl.toUpperCase()
}

function titleCaseWord(word: string): string {
  if (!word) return word
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
}

function stationLikeNameFromTiploc(tpl: string): string | null {
  const raw = (tpl || '').trim().toUpperCase()
  if (!raw) return null
  // Humanise common TIPLOC forms for stations/passing/junction points.
  // Examples:
  //   FAREHAM   -> Fareham
  //   EASTLEGHJN -> Eastlegh JN
  //   BSKTBPSS  -> Bskt B Pss
  if (/^[A-Z0-9]{4,}$/.test(raw)) {
    const expanded = raw
      .replace(/JNCT$/g, ' JNCT')
      .replace(/JCN$/g, ' JCN')
      .replace(/JN$/g, ' JN')
      .replace(/PASS$/g, ' PASS')
      .replace(/PSS$/g, ' PSS')
      .replace(/HALT$/g, ' HALT')
      .replace(/(?:\d)(?=[A-Z])/g, '$& ')
      .replace(/([A-Z])([0-9])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim()
    const words = expanded.split(' ')
    return words.map((w) => {
      if (w === 'JN' || w === 'JCN' || w === 'JNCT' || w === 'PSS') return w
      return titleCaseWord(w)
    }).join(' ')
  }
  return null
}

function displayStopName(
  stops: NonNullable<ServiceDetail['stops']>,
  idx: number,
  fallbackNameLookup?: {
    byTiploc: Map<string, string>
    byCrs: Map<string, string>
  }
): string {
  const stop = stops[idx]
  if (!stop) return ''
  const current = stop.name?.trim()
  if (current && !isRawTiplocName(current, stop.tpl)) return current
  const byTiplocName = fallbackNameLookup?.byTiploc.get(stop.tpl.toUpperCase())
  if (byTiplocName) return byTiplocName
  const byCrsName = stop.crs ? fallbackNameLookup?.byCrs.get(stop.crs.toUpperCase()) : null
  if (byCrsName) return byCrsName
  const stationLikeFallback = stationLikeNameFromTiploc(stop.tpl)
  if (stationLikeFallback) return stationLikeFallback
  return stop.tpl
}

function isScheduleDeactivatedReason(reason: string | null | undefined): boolean {
  if (!reason) return false
  return reason.trim().toLowerCase().includes('schedule deactivated')
}

function platformSourceLabel(src: string | null | undefined): string | null {
  if (!src) return null
  if (src === 'A') return 'auto'
  if (src === 'M') return 'manual'
  if (src === 'P') return 'planned'
  return src
}

function platformSourceClass(label: string): string {
  if (label === 'auto') return 'svc-platform-badge--auto'
  if (label === 'manual') return 'svc-platform-badge--manual'
  if (label === 'planned') return 'svc-platform-badge--planned'
  return 'svc-platform-badge--default'
}

function parseHmToMinutes(value: string | null | undefined): number | null {
  if (!value) return null
  const m = /^(\d{1,2}):(\d{2})/.exec(value.trim())
  if (!m) return null
  const hh = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

function computeDeltaMinutes(
  scheduled: string | null | undefined,
  live: string | null | undefined
): number | null {
  const schedMins = parseHmToMinutes(scheduled)
  const liveMins = parseHmToMinutes(live)
  if (schedMins == null || liveMins == null) return null
  let diff = liveMins - schedMins
  // Prefer the shortest overnight-adjusted distance.
  if (diff > 720) diff -= 1440
  if (diff < -720) diff += 1440
  return diff
}

function buildDeparturesAnchorTime(
  stop: NonNullable<ServiceDetail['stops']>[number],
  kind: 'origin' | 'stop' | 'pass' | 'destination'
): string | null {
  // Prefer live time, then public times, then working times. Keep HH:MM only.
  const live = trimSeconds(stop.liveTime)
  if (live) return live
  if (kind === 'pass') return trimSeconds(stop.wtp || stop.wtd || stop.wta || stop.pta || stop.ptd || null) || null
  return trimSeconds(stop.ptd || stop.pta || stop.wtd || stop.wta || stop.wtp || null) || null
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
  const [viewMode, setViewMode] = useState<ViewMode>('detailed')
  const [section, setSection] = useState<ServiceSection>('overview')

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

  const fallbackStopNameLookup = useMemo(() => {
    const byTiploc = new Map<string, string>()
    const byCrs = new Map<string, string>()
    for (const station of stations) {
      const stationName = station.stationName?.trim()
      if (!stationName) continue
      const tiploc = station.tiploc?.trim().toUpperCase()
      const crsCode = station.crsCode?.trim().toUpperCase()
      if (tiploc && !byTiploc.has(tiploc)) byTiploc.set(tiploc, stationName)
      if (crsCode && !byCrs.has(crsCode)) byCrs.set(crsCode, stationName)
    }
    return { byTiploc, byCrs }
  }, [stations])

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

  const viewModeSelectedIndex = viewMode === 'detailed' ? 0 : 1

  return (
    <DarwinDetailsLayout
      title={title}
      subtitle={subtitle}
      headerClassName={`service-detail-header service-detail-header--${status}`}
      actionContent={(
        <div className="station-details-header-actions">
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
            <section className="svc-viewmode-card" aria-label="View mode">
              <BUTTwoButtonBar
                className="svc-viewmode-toggle"
                colorVariant="accent"
                selectedIndex={viewModeSelectedIndex}
                buttons={[
                  { label: 'Detailed', value: 'detailed' },
                  { label: 'Simple', value: 'simple' },
                ]}
                onChange={(index) => {
                  if (index === 0) setViewMode('detailed')
                  if (index === 1) setViewMode('simple')
                }}
              />
            </section>

            <section
              className={`svc-summary-card ${data.cancelled ? 'svc-summary-card--cancelled' : ''}`}
              aria-label="Service summary"
            >
              <div className="modal-details-grid">
                <StationDetailField label="Operator" value={data.tocName || data.toc} />
                <StationDetailField label="Headcode" value={data.trainId} />
                {viewMode === 'detailed' ? (
                  <StationDetailField label="UID" value={data.uid} />
                ) : null}
                {viewMode === 'detailed' ? (
                  <StationDetailField label="Service date" value={data.ssd} />
                ) : null}
                <StationDetailField label="Origin" value={data.originName || data.origin} />
                <StationDetailField label="Destination" value={data.destinationName || data.destination} />
                {viewMode === 'detailed' ? (
                  <StationDetailField
                    label="Calling pattern"
                    value={`${data.stops.filter((s) => SLOT_KIND[s.slot] !== 'pass').length} calling · ${data.stops.filter((s) => SLOT_KIND[s.slot] === 'pass').length} passing`}
                  />
                ) : null}
                {viewMode === 'detailed' ? (
                  <StationDetailField
                    label="Type"
                    value={`${data.isPassenger ? 'Passenger' : 'Non-passenger'}${data.trainCat ? ` · ${data.trainCat}` : ''}`}
                  />
                ) : null}
              </div>

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

              {/* Per-service text alerts (e.g. SN bus replacement notes). */}
              {data.alerts && data.alerts.length > 0 && data.alerts.map((al) => (
                <div key={al.id} className="svc-banner svc-banner--alert">
                  <span className="svc-banner-label">Alert</span>
                  {al.source && <span className="svc-banner-source">{al.source}</span>}{' '}
                  {al.text}
                </div>
              ))}

            </section>
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
              {/* Service associations: joins (JJ), divides (VV), next portions (NP).
               * Rendered beneath coach formation so unit/portion context sits
               * next to consist information. */}
              <ServiceVehicleDetails consist={data.consist} />
              {data.associations && data.associations.length > 0 && data.associations.map((a) => (
                <div key={`${a.category}-${a.otherRid}-${a.tiploc}`} className={`svc-banner svc-banner--assoc${a.isCancelled ? ' svc-banner--assoc-cancelled' : ''}`}>
                  {a.category !== 'NP' && (
                    <span className="svc-banner-label">
                      {a.category === 'VV' ? 'Splits' : a.category === 'JJ' ? 'Joins' : 'Associated'}
                      {a.isCancelled ? ' (cancelled)' : ''} —
                    </span>
                  )}{' '}
                  {describeAssociation(a)}
                  <BUTBaseButton
                    variant="chip"
                    width="hug"
                    colorVariant="accent"
                    instantAction
                    className="svc-banner-link"
                    onClick={() => {
                      const next = new URLSearchParams()
                      if (historicalDate) next.set('date', historicalDate)
                      if (historicalAt) next.set('at', historicalAt)
                      if (from) next.set('from', from)
                      router.push(`/services/${encodeURIComponent(a.otherRid)}${next.toString() ? `?${next.toString()}` : ''}`)
                    }}
                  >
                    View service
                  </BUTBaseButton>
                </div>
              ))}
            </section>
        )}

        {data && section === 'calling' && (
            <section className="modal-section svc-pattern-card" aria-label="Calling pattern">
              <StationSectionTitle title="Calling pattern" icon={MapPin} pageHeading />
              <section className="svc-viewmode-card" aria-label="View mode">
                <BUTTwoButtonBar
                  className="svc-viewmode-toggle"
                  colorVariant="accent"
                  selectedIndex={viewModeSelectedIndex}
                  buttons={[
                    { label: 'Detailed', value: 'detailed' },
                    { label: 'Simple', value: 'simple' },
                  ]}
                  onChange={(index) => {
                    if (index === 0) setViewMode('detailed')
                    if (index === 1) setViewMode('simple')
                  }}
                />
              </section>
              <div className="stations-table-panel">
                <div className="stations-table-wrap">
                <table className="stations-table svc-calling-table">
                  <thead>
                    <tr>
                      <StationsTableHead label="Type" />
                      <StationsTableHead label="Location" sticky />
                      {viewMode === 'detailed' && <StationsTableHead label="PTA" />}
                      {viewMode === 'detailed' && <StationsTableHead label="PTD" />}
                      <StationsTableHead label="WTA" />
                      <StationsTableHead label="WTD/WTP" />
                      <StationsTableHead label="Δ min" />
                      <StationsTableHead label="Platform" />
                      <StationsTableHead label="Live" />
                    </tr>
                  </thead>
                  <tbody>
                {data.stops.flatMap((s, idx) => {
                  const stopLabel = displayStopName(data.stops, idx, fallbackStopNameLookup)
                  const kind = SLOT_KIND[s.slot] || 'stop'
                  if (viewMode === 'simple' && kind === 'pass') return []
                  const kindLabel = SLOT_KIND_LABEL[kind]
                  const pArr = s.pta || null
                  const pDep = s.ptd || null
                  const wArr = trimSeconds(s.wta) || null
                  const wDep = trimSeconds(s.wtd) || null
                  const wPass = s.wtp ? trimSeconds(s.wtp) : null
                  const platformValue = s.livePlatform || s.platform || '—'
                  const showLive = !!s.liveTime && (s.liveKind === 'actual' || s.liveKind === 'est' || s.liveKind === 'actual-arr' || s.liveKind === 'est-arr')
                  const showExpectedDeparture =
                    !s.cancelledAtStop
                    && showLive
                    && s.liveKind === 'est'
                    && kind !== 'pass'
                    && (viewMode === 'simple' || s.liveTime !== pDep)
                  const passFallback = kind === 'pass' ? (wPass || wDep || null) : null
                  const platformSource = platformSourceLabel(s.platformSource)
                  const scheduledForDelta = kind === 'pass'
                    ? (wPass || wDep || wArr || null)
                    : (pDep || pArr || wDep || wArr || null)
                  const deltaMinutes = s.unknownDelay ? null : computeDeltaMinutes(scheduledForDelta, s.liveTime)
                  const isLate = showLive && (
                    (s.liveKind?.startsWith('actual') && s.liveTime !== (pDep || pArr || wPass || wDep || wArr)) ||
                    (s.liveKind?.startsWith('est')    && s.liveTime !== (pDep || pArr || wPass || wDep || wArr))
                  )
                  const departuresTargetCode = (s.crs || s.tpl || '').toUpperCase()
                  const departuresAnchorTime = buildDeparturesAnchorTime(s, kind)
                  const onNavigateToDepartures = () => {
                    if (!departuresTargetCode) return
                    const next = new URLSearchParams()
                    next.set('hours', '1')
                    // `at` is honored by departures only when `date` is present.
                    const targetDate = historicalDate || data.ssd || null
                    if (targetDate) next.set('date', targetDate)
                    if (departuresAnchorTime && targetDate) next.set('at', departuresAnchorTime)
                    next.set('from', `/services/${encodeURIComponent(data.rid)}${location.search || ''}`)
                    next.set('label', stopLabel)
                    router.push(`/departures/${encodeURIComponent(departuresTargetCode)}${next.toString() ? `?${next.toString()}` : ''}`)
                  }
                  return [(
                    <tr
                      key={`${s.tpl}-${idx}`}
                      className={[
                        'stations-table__row',
                        idx % 2 === 1 ? 'stations-table__row--striped' : '',
                        'svc-stop',
                        'svc-stop--jump',
                        `svc-stop--${kind}`,
                        s.cancelledAtStop ? 'svc-stop--cancelled' : '',
                        isLate ? 'svc-stop--late' : '',
                      ].filter(Boolean).join(' ')}
                      role="button"
                      tabIndex={0}
                      onClick={onNavigateToDepartures}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          onNavigateToDepartures()
                        }
                      }}
                    >
                      <td><span className={`svc-kind-badge svc-kind-badge--${kind}`}>{kindLabel}</span></td>
                      <td className="stations-table__name">
                        <div className="svc-stop-name">
                          <span className="svc-stop-name-text">{stopLabel}</span>
                          {s.crs ? <span className="svc-stop-crs">{s.crs}</span> : null}
                          {kind !== 'pass' && <ActivityPill activity={s.activity} />}
                        </div>
                      </td>
                      {viewMode === 'detailed' && <td className="svc-mono stations-table__id">{kind === 'pass' ? '—' : (pArr || '—')}</td>}
                      {viewMode === 'detailed' && <td className="svc-mono stations-table__id">{kind === 'pass' ? '—' : (pDep || '—')}</td>}
                      <td className="svc-mono stations-table__id">{kind === 'pass' ? '—' : (wArr || '—')}</td>
                      <td className="svc-mono stations-table__id">{kind === 'pass' ? (wPass || '—') : (wDep || '—')}</td>
                      <td
                        className={[
                          'svc-mono',
                          'stations-table__id',
                          deltaMinutes == null
                            ? ''
                            : deltaMinutes > 0
                              ? 'svc-delta svc-delta--late'
                              : deltaMinutes < 0
                                ? 'svc-delta svc-delta--early'
                                : 'svc-delta svc-delta--ontime',
                        ].filter(Boolean).join(' ')}
                      >
                        {deltaMinutes == null ? '—' : (deltaMinutes > 0 ? `+${deltaMinutes}` : String(deltaMinutes))}
                      </td>
                      <td className="svc-mono stations-table__id">
                        <span className="svc-platform-cell">
                          <span>{platformValue}</span>
                          {platformValue !== '—' && viewMode === 'detailed' && (
                            <span className="svc-platform-meta">
                              {platformSource && (
                                <span className={`svc-platform-badge ${platformSourceClass(platformSource)}`}>
                                  {platformSource}
                                </span>
                              )}
                              {s.platformConfirmed && (
                                <span className="svc-platform-badge svc-platform-badge--confirmed">
                                  confirmed
                                </span>
                              )}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="stations-table__live">
                        <div className="svc-stop-live">
                          {s.cancelledAtStop && <span className="svc-pill svc-pill--cancelled">Cancelled</span>}
                          {!s.cancelledAtStop && s.unknownDelay && <span className="svc-pill svc-pill--late">Delayed{s.liveSource ? ` (${s.liveSource})` : ''}</span>}
                          {!s.cancelledAtStop && showLive && s.liveKind === 'actual'      && kind !== 'pass' && <span className="svc-pill svc-pill--actual">Departed {s.liveTime}</span>}
                          {!s.cancelledAtStop && showLive && s.liveKind === 'actual'      && kind === 'pass' && <span className="svc-pill svc-pill--actual">Passed {s.liveTime}</span>}
                          {!s.cancelledAtStop && showLive && s.liveKind === 'actual-arr'  && <span className="svc-pill svc-pill--actual">Arrived {s.liveTime}</span>}
                          {showExpectedDeparture && <span className="svc-pill svc-pill--late">Expected {s.liveTime}</span>}
                          {!s.cancelledAtStop && showLive && s.liveKind === 'est'         && kind === 'pass' && <span className="svc-pill svc-pill--late">Expected pass {s.liveTime}</span>}
                          {!s.cancelledAtStop && showLive && s.liveKind === 'est-arr'     && <span className="svc-pill">Expected arr {s.liveTime}</span>}
                          {!s.cancelledAtStop && !showLive && kind === 'pass' && passFallback && (
                            <span className="svc-pill">Scheduled pass {passFallback}</span>
                          )}
                          {!s.cancelledAtStop && !showLive && kind !== 'pass' && (idx === 0 || idx === data.stops.length - 1) && !data.historicalDate && (
                            <span className="svc-pill svc-pill--ontime">Scheduled</span>
                          )}
                          {!s.cancelledAtStop && !showLive && kind !== 'pass' && data.historicalDate && (
                            <span className="svc-pill">---</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )]
                })}
                  </tbody>
                </table>
                </div>
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