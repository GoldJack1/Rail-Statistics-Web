'use client'

import { useRouter, useSearchParams, useParams } from 'next/navigation'
import React, { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { ChartBar, Info, MapPin, MapTrifold } from '@phosphor-icons/react'

import { useServiceDetail, useServiceDetails } from '@/hooks/useServiceDetail'
import { useStations } from '@/hooks/useStations'
import { BUTTwoButtonBar, BUTWideButton } from '@/components/buttons'
import { BackIcon } from '@/components/icons'
import { TextCard } from '@/components/cards'
import { CarriageMap } from '@/components/darwin/CarriageMap'
import { DarwinDetailsLayout } from '@/components/darwin/DarwinDetailsLayout'
import { ServiceSchedulePanel } from '@/components/darwin/ServiceSchedulePanel'
import { ServiceStopList } from '@/components/darwin/ServiceStopList/ServiceStopList'
import { buildStopNameLookup, displayStopName } from '@/components/darwin/serviceStopLabel'
import { ServiceDetailKey } from '@/components/darwin/ServiceDetailKey/ServiceDetailKey'
import { SidePane } from '@/components/darwin/SidePane/SidePane'
import { ServiceViewModeToggle } from '@/components/darwin/ServiceViewModeToggle'
import { useServiceViewMode } from '@/components/darwin/serviceViewMode'
import StationSectionTitle from '@/components/models/StationDetails/StationSectionTitle'
import type { AccountSection } from '@/components/misc/AccountSectionNav/AccountSectionNav'
import SidebarDropdownSection from '@/components/misc/SidebarDropdownSection/SidebarDropdownSection'
import type { ServiceDetail } from '@/types/darwin'
import { railwayOperatingDayIsoFromLondonParts } from '@/utils/railwayOperatingDayUk'
import { formatLmTocName } from '@/utils/formatLmTocName'
import { coachCountFromConsist, coachCountFromUnitIds, stopHasPublishedLoading, unitIdsFromConsist } from '@/utils/darwinCoachLoading'
import {
  consumeLegacyFromParam,
  isServiceSection,
  parseServicePath,
  readServiceReturn,
  replaceServiceUrl,
  serviceHref,
  type ServiceSection,
} from '@/utils/serviceUrl'
import { advertisedTime, buildSplitWorking, isPassengerHeadcode, joinStationNames, nextWorkingSentence, previousNextWorkings, previousWorkingSentence, serviceDestinationLabel, splitMapStopLists, splitPortionLabel, splitTogetherLabel } from '@/utils/splitWorking'
import '../ServiceDetailPage.css'

const loadServiceJourneyMap = () =>
  import('@/components/darwin/ServiceJourneyMap/ServiceJourneyMap').then((mod) => mod.ServiceJourneyMap)

const ServiceJourneyMap = dynamic(loadServiceJourneyMap, {
  ssr: false,
  loading: () => <p className="edit-hint kb-source-hint">Loading map…</p>,
})

const BASE_SERVICE_SECTIONS: AccountSection[] = [
  { id: 'calling', label: 'Calling pattern', icon: MapPin },
  { id: 'map', label: 'Map', icon: MapTrifold },
]

const HIDDEN_SERVICE_SECTIONS = new Set<ServiceSection>(['overview', 'formation', 'raw'])

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
): string | undefined {
  const id = a.otherRid || a.otherUid
  if (!date || !id) return undefined
  return serviceHref({
    id,
    date,
    section: 'calling',
    mode: viewMode,
  })
}

function serviceUnitIds(data: ServiceDetail): string[] {
  const fromConsist = unitIdsFromConsist(data.consist)
  if (fromConsist?.length) return fromConsist
  const listed = (data.schedule?.units?.length ? data.schedule.units : data.units) || []
  return listed.map((unit) => String(unit || '').trim()).filter(Boolean)
}

function serviceCoachCount(data: ServiceDetail): number | null {
  const formationCount = data.formation?.coaches?.length || 0
  if (formationCount > 0) return formationCount
  const consistCount = coachCountFromConsist(data.consist)
  if (consistCount) return consistCount
  return coachCountFromUnitIds(serviceUnitIds(data))
}

function ServiceFormationStrip({ data }: { data: ServiceDetail }) {
  const count = serviceCoachCount(data)
  const units = serviceUnitIds(data)
  if (count == null && !units.length) return null
  const visible = count != null ? Math.min(count, 12) : 0
  const prefix = data.cancelled ? 'Was formed of' : 'Formed of'
  const carriagePhrase = count != null ? `${count} carriage${count === 1 ? '' : 's'}` : ''
  const title = [prefix, carriagePhrase, units.length ? `by ${units.join(' + ')}` : '']
    .filter(Boolean)
    .join(' ')
  return (
    <TextCard
      static
      trailingIcon={null}
      className="svc-formation-card"
      title={title}
      ariaLabel={title}
      description={visible > 0 ? (
        <span className="svc-formation-strip__coaches">
          {Array.from({ length: visible }, (_, index) => {
            const place = visible === 1 ? 'solo' : index === 0 ? 'front' : index === visible - 1 ? 'rear' : 'mid'
            return <span key={index} className={`svc-formation-strip__coach svc-formation-strip__coach--${place}`} />
          })}
        </span>
      ) : undefined}
    />
  )
}

function WorkingFooter({
  previous,
  next,
  date,
  viewMode,
}: {
  previous: ReturnType<typeof previousNextWorkings>['previous']
  next: ReturnType<typeof previousNextWorkings>['next']
  date: string | null | undefined
  viewMode: ReturnType<typeof useServiceViewMode>[0]
}) {
  const cells = [...previous, ...next]
  if (!cells.length) return null
  return (
    <div className={`svc-working-bar${cells.length === 1 ? ' svc-working-bar--single' : ''}`}>
      {cells.map((w) => {
        const label = w.kind === 'previous' ? previousWorkingSentence(w) : nextWorkingSentence(w)
        const href = workingServiceHref(w.association, date, viewMode)
        return (
          <TextCard
            key={`${w.kind}-${w.association.otherRid}-${w.association.tiploc}`}
            title={label}
            to={href}
            static={!href}
            trailingIcon={href ? undefined : null}
            ariaLabel={label}
          />
        )
      })}
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

function cancellationDescription(
  reason: { reason?: string | null; code?: string | null } | null | undefined,
): string | undefined {
  if (!reason?.reason || isScheduleDeactivatedReason(reason.reason)) return undefined
  return `${reason.reason}${reason.code ? ` (code ${reason.code})` : ''}`
}

function originDepartureClock(data: ServiceDetail): string | null {
  const origin = data.stops.find((stop) => stop.slot === 'OR')
    || data.stops.find((stop) => stop.tpl === data.origin)
    || data.stops[0]
  if (!origin) return null
  const clock = advertisedTime(origin.ptd, [origin.wtd, origin.wta, origin.wtp])
    || String(origin.wtd || origin.ptd || '').trim()
  const hhmm = clock.slice(0, 5)
  return /^\d{2}:\d{2}$/.test(hhmm) && hhmm !== '00:00' ? hhmm : null
}

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
  const urlSection: ServiceSection = HIDDEN_SERVICE_SECTIONS.has(parsed.section) ? 'calling' : parsed.section
  const sectionKey = `${parsed.id}|${parsed.date || ''}|${parsed.section}`
  const [sectionKeySeen, setSectionKeySeen] = useState(sectionKey)
  const [section, setSection] = useState<ServiceSection>(urlSection)
  const [overviewOpen, setOverviewOpen] = useState(false)
  const [mapNominatim, setMapNominatim] = useState(false)
  if (sectionKeySeen !== sectionKey) {
    setSectionKeySeen(sectionKey)
    setSection(urlSection)
    setMapNominatim(false)
  }
  const [viewMode, selectViewMode] = useServiceViewMode()

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
    if (!serviceId) return
    if (section === 'map') {
      // Overlap the rail-network download with the map code. The worker reads the same file.
      void fetch('/data/gb-passenger-rail.json').then((response) => response.arrayBuffer()).catch(() => {})
    }
    void loadServiceJourneyMap()
  }, [serviceId, section])

  const { status, data, error, ageMs } = useServiceDetail({
    rid: serviceId,
    date: historicalDate,
    at: historicalAt,
    pollMs: historicalMode || futureTimetableMode ? 0 : 3_000,
  })
  const { stations } = useStations()
  const pageSection: ServiceSection = HIDDEN_SERVICE_SECTIONS.has(section) ? 'calling' : section

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [pageSection])
  const canonicalId = data?.uid || serviceId
  const canonicalHref = serviceHref({
    id: canonicalId,
    date: data?.ssd || date,
    section: pageSection,
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
  const siblingIds = useMemo(() => {
    const known = new Set<string>(partnerIds.map((id) => id.toUpperCase()))
    if (data?.rid) known.add(data.rid.toUpperCase())
    if (data?.uid) known.add(data.uid.toUpperCase())
    const ids = new Set<string>()
    for (const svc of partnerMap.values()) {
      for (const a of svc.associations || []) {
        if (a.isDeleted || (a.category !== 'VV' && a.category !== 'JJ')) continue
        if (!isPassengerHeadcode(a.otherTrainId)) continue
        const id = a.otherRid || a.otherUid
        if (!id || known.has(id.toUpperCase())) continue
        ids.add(id)
      }
    }
    return [...ids]
  }, [partnerMap, partnerIds, data?.rid, data?.uid])
  const siblingMap = useServiceDetails(siblingIds, historicalDate, historicalAt)
  const partners = useMemo(() => {
    const seen = new Set<string>()
    const list: ServiceDetail[] = []
    for (const svc of [...partnerMap.values(), ...siblingMap.values()]) {
      if (seen.has(svc.rid) || svc.rid === data?.rid) continue
      seen.add(svc.rid)
      list.push(svc)
    }
    return list
  }, [partnerMap, siblingMap, data?.rid])
  const splitWorking = useMemo(
    () => (data ? buildSplitWorking(data, partners) : null),
    [data, partners],
  )
  const portionWorkings = useMemo(
    () => previousNextWorkings(data?.associations, partnerMap),
    [data?.associations, partnerMap],
  )
  const destinationLabel = splitWorking
    ? splitWorking.kind === 'join'
      ? splitWorking.splitName
      : joinStationNames(splitWorking.portions.map((p) => p.destinationName))
    : data
      ? serviceDestinationLabel(data)
      : ''
  const mapBranches = useMemo(
    () => (splitWorking && data ? splitMapStopLists(splitWorking, data.stops) : []),
    [splitWorking, data],
  )
  const liveBranches = useMemo(() => {
    if (!splitWorking || !data) return []
    const want = new Set(splitWorking.portions.map((portion) => portion.rid))
    return partners.filter((svc) => want.has(svc.rid))
  }, [splitWorking, partners, data])
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
    const [calling, ...rest] = BASE_SERVICE_SECTIONS
    return [calling, LOADING_SECTION, ...rest]
  }, [hasLoading])

  useEffect(() => {
    if (section === 'loading' && !hasLoading) setSection('calling')
  }, [section, hasLoading])

  const fallbackStopNameLookup = useMemo(() => buildStopNameLookup(stations), [stations])

  const title = useMemo(() => {
    if (!data) return status === 'error' || status === 'not-found' ? serviceId : 'Loading'
    const dest = destinationLabel || data.destinationName || data.destination
    const origin = data.originName || data.origin
    const departs = originDepartureClock(data)
    const route = `${departs ? `${departs} ` : ''}${origin} → ${dest}`
    if (viewMode === 'simple') return route
    return `${data.trainId} · ${route}`
  }, [data, serviceId, destinationLabel, status, viewMode])

  const subtitle = useMemo(() => {
    const serviceDate = data?.ssd ? formatDateOnly(data.ssd) : null
    const histDate = data?.historicalDate ? formatDateOnly(data.historicalDate) : null
    const dateText = histDate && histDate !== serviceDate ? `Snapshot ${histDate}` : ''
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
    const withFailure = (line: string) => (error ? `${line}\n${error}` : line)
    if (status === 'ok')        return withFailure(`${liveLine}${dateText ? `\n${dateText}` : ''}`)
    if (status === 'stale')     return withFailure(`${staleLine}${dateText ? `\n${dateText}` : ''}`)
    if (status === 'loading')   return `Loading…${dateText ? `\n${dateText}` : ''}`
    if (status === 'error')     return error ? `Error: ${error}` : 'Service unavailable'
    if (status === 'not-found') return 'Service not found'
    return dateText
  }, [status, error, ageMs, historicalMode, futureTimetableMode, data])

  const renderServiceOverview = () => {
    if (!data) return null
    return (
      <div className="svc-overview-dropdown__body">
        {data.cancelled && (
          <TextCard
            static
            state="redAction"
            title="Cancelled"
            description={cancellationDescription(data.cancellation)}
          />
        )}
        {!data.cancelled && data.partiallyCancelled && (() => {
          const cancelledStops = data.stops.filter((s) => s.cancelledAtStop && s.slot !== 'PP' && s.slot !== 'OPPP')
          const names = cancelledStops.map((s) => {
            const i = data.stops.findIndex((x) => x.tpl === s.tpl && x.slot === s.slot)
            return i >= 0 ? displayStopName(data.stops, i, fallbackStopNameLookup) : (s.name || s.tpl)
          }).filter(Boolean)
          const summary = names.length === 0
            ? 'Some calling points are not being served.'
            : names.length <= 4
              ? `Not calling at: ${names.join(', ')}.`
              : `Not calling at ${names.length} stops including ${names.slice(0, 3).join(', ')}.`
          const distinctReason = cancellationDescription(
            cancelledStops.find((s) => s.cancelReasonAtStop)?.cancelReasonAtStop,
          )
          return (
            <TextCard
              static
              state="redAction"
              title="Partial cancellation"
              description={[summary, distinctReason].filter(Boolean).join(' ')}
            />
          )
        })()}
        {!data.cancelled && !data.partiallyCancelled && data.delayReason && (
          <TextCard
            static
            state="accent"
            title="Delay reason"
            description={`${data.delayReason.reason}${data.delayReason.code ? ` (code ${data.delayReason.code})` : ''}`}
          />
        )}
        {data.alerts?.map((al) => (
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
            const id = a.otherRid || a.otherUid
            const href = id
              ? serviceHref({
                  id,
                  date: data.ssd || date,
                  section: 'calling',
                  mode: viewMode,
                })
              : undefined
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
        <ServiceSchedulePanel
          data={data}
          operator={formatLmTocName(
            data.tocName,
            data.toc,
            data.stops[0]?.crs,
            data.stops[data.stops.length - 1]?.crs,
          )}
        />
      </div>
    )
  }

  return (
    <DarwinDetailsLayout
      className="service-detail-layout"
      title={title}
      subtitle={subtitle}
      headerClassName={`service-detail-header service-detail-header--${status}`}
      sidebarHeader={(
        <>
          <div className="svc-mobile-section-bar">
            <BUTTwoButtonBar
              className="svc-section-bar"
              colorVariant="primary"
              selectedIndex={pageSection === 'map' ? 1 : pageSection === 'calling' ? 0 : null}
              buttons={[
                { label: 'Calling pattern', value: 'calling', disabled: !data },
                { label: 'Map', value: 'map', disabled: !data },
              ]}
              onChange={(_, value) => {
                if (value === 'calling' || value === 'map') setSection(value)
              }}
            />
            {hasLoading ? (
              <button
                type="button"
                className={pageSection === 'loading' ? 'svc-mobile-loading svc-mobile-loading--on' : 'svc-mobile-loading'}
                aria-pressed={pageSection === 'loading'}
                onClick={() => setSection('loading')}
              >
                Loading capacity
              </button>
            ) : null}
          </div>
          <ServiceViewModeToggle
            className="svc-viewmode-switch--sidebar"
            viewMode={viewMode}
            disabled={!data}
            onChange={selectViewMode}
          />
          {data && (
            <SidebarDropdownSection title="Overview" icon={Info} className="svc-overview-dropdown" defaultExpanded>
              {renderServiceOverview()}
            </SidebarDropdownSection>
          )}
        </>
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
            <ServiceDetailKey disabled={!data} />
            <span className="svc-overview-launch">
              <BUTWideButton
                type="button"
                width="hug"
                instantAction
                disabled={!data}
                icon={<Info size={16} weight="bold" aria-hidden />}
                ariaLabel="Overview"
                pressed={overviewOpen}
                onClick={() => setOverviewOpen(true)}
              >
                Overview
              </BUTWideButton>
              <SidePane open={overviewOpen && Boolean(data)} title="Overview" onClose={() => setOverviewOpen(false)}>
                {renderServiceOverview()}
              </SidePane>
            </span>
          </div>
          <ServiceViewModeToggle
            className="svc-viewmode-switch--header"
            viewMode={viewMode}
            disabled={!data}
            onChange={selectViewMode}
          />
        </div>
      )}
      sections={serviceSections}
      activeSectionId={pageSection === 'loading' && !hasLoading ? 'calling' : pageSection}
      onSelect={(id) => {
        if (!isServiceSection(id)) return
        if (id === 'loading' && !hasLoading) return
        if (HIDDEN_SERVICE_SECTIONS.has(id)) return
        setSection(id)
      }}
      ariaLabel="Service sections"
      minSectionCount={3}
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
            <StationSectionTitle title="Calling pattern" icon={MapPin} pageHeading />
            <p className="edit-hint kb-source-hint">Loading actual times…</p>
          </section>
        )}

        {data && pageSection === 'loading' && hasLoading && (
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

        {data && pageSection === 'calling' && (
            <section className="modal-section svc-pattern-card" aria-label="Calling pattern">
              <div className="svc-calling-stack">
              <ServiceFormationStrip data={data} />
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
                preserveOrder
                associations={(data.associations || []).filter((a) => a.category !== 'NP')}
                associationHref={(a) =>
                  serviceHref({
                    id: a.otherRid || a.otherUid || '',
                    date: data.ssd || date,
                    section: 'calling',
                    mode: viewMode,
                  })
                }
              />
              )}
              <WorkingFooter
                previous={portionWorkings.previous}
                next={portionWorkings.next}
                date={data.ssd || date}
                viewMode={viewMode}
              />
              </div>
            </section>
        )}

        {data && pageSection === 'map' && (
          <section className="modal-section svc-map-section" aria-label="Journey map">
            <ServiceFormationStrip data={data} />
            <ServiceJourneyMap
              service={data}
              stations={stations}
              extraStops={mapBranches}
              branches={liveBranches}
              onNominatimUsed={() => setMapNominatim(true)}
            />
          </section>
        )}

        {data && (
          <footer className="svc-footer">
            <p>
              Live times, platforms and the calling pattern come from the Network Rail Darwin Push Port.
              Signalling actuals come from Network Rail TRUST, where shown.
            </p>
            <p>Contains public sector information licensed under the Open Government Licence v3.0.</p>
            <p>
              Map data ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>
              , via{' '}
              <a href="https://protomaps.com/" target="_blank" rel="noreferrer">
                Protomaps
              </a>
              . Rail geometry ©{' '}
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
                OpenStreetMap
              </a>
              . Stations from Rail Statistics
              {mapNominatim ? (
                <>
                  {' '}
                  and{' '}
                  <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">
                    Nominatim
                  </a>
                </>
              ) : null}
              .
            </p>
          </footer>
        )}

    </DarwinDetailsLayout>
  )
}

export default ServiceDetailPage