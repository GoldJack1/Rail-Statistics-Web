'use client'

import React, { useEffect, useId, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { ActivityPill } from '@/components/darwin/ActivityPill'
import { ChevronRightIcon } from '@/components/icons'
import AutoAnimateCollapse from '@/components/misc/AutoAnimateCollapse/AutoAnimateCollapse'
import { TextCard } from '@/components/cards'
import { useStations } from '@/hooks/useStations'
import type { ServiceAssociation, ServiceStop } from '@/types/darwin'
import { buildStopNameLookup, displayStopName, sortStopsByJourneyTime } from '@/components/darwin/serviceStopLabel'
import type { ServiceViewMode } from '@/components/darwin/serviceViewMode'
import { delayMinutesTone, type CallingPatternTone } from '@/components/darwin/callingPatternTone'
import { betweenStationsLabel, inferProgressIndex } from '@/utils/serviceProgress'
import { railwayDayMinutesFromHhmm } from '@/utils/railwayOperatingDayUk'
import '@/components/cards/StationsTableView/StationsTableView.css'
import './ServiceStopList.css'

export type StopKind = 'origin' | 'stop' | 'pass' | 'destination'

const SLOT_KIND: Record<string, StopKind> = {
  OR: 'origin', OPOR: 'origin',
  IP: 'stop', OPIP: 'stop',
  PP: 'pass', OPPP: 'pass',
  DT: 'destination', OPDT: 'destination',
}

const SLOT_KIND_LABEL: Record<StopKind, string> = {
  origin: 'Origin',
  stop: 'Stop',
  pass: 'Pass',
  destination: 'Dest',
}

export function slotKind(slot: string): StopKind {
  return SLOT_KIND[slot] || 'stop'
}

function trimSeconds(t: string | null | undefined): string {
  return t ? t.slice(0, 5) : ''
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
  if (diff > 720) diff -= 1440
  if (diff < -720) diff += 1440
  return diff
}

function departuresAnchorTime(stop: ServiceStop, kind: StopKind): string | null {
  if (kind === 'pass') return trimSeconds(stop.wtp || stop.wtd || stop.wta || stop.pta || stop.ptd || null) || null
  return trimSeconds(stop.ptd || stop.pta || stop.wtd || stop.wta || stop.wtp || null) || null
}

function primaryTime(stop: ServiceStop, kind: StopKind): { label: string; value: string } {
  const wArr = trimSeconds(stop.wta)
  const wDep = trimSeconds(stop.wtd)
  const wPass = trimSeconds(stop.wtp)
  if (kind === 'pass') return { label: 'Pass', value: wPass || wDep || wArr || '—' }
  if (kind === 'destination') return { label: 'Arr', value: stop.pta || wArr || stop.ptd || wDep || '—' }
  return { label: 'Dep', value: stop.ptd || wDep || stop.pta || wArr || '—' }
}

function formatDelayLabel(delta: number | null): string {
  if (delta == null) return ''
  if (delta >= 1) return `(+${delta}m L)`
  if (delta <= -1) return `(${Math.abs(delta)}m E)`
  return '(0 L)'
}

type StopTone = CallingPatternTone

type StopStatus = {
  verb: string
  time: string
  delay: string
  tone: StopTone
  note?: string
  eta?: string | null
}

function delayReasonText(delayReason?: string | null, alertText?: string | null): string {
  return (delayReason || alertText || '').replace(/\s+/g, ' ').trim()
}

/** Exported for unit tests — densify-only passes must not inherit bare "Delayed". */
export function buildStopStatus(
  stop: ServiceStop,
  kind: StopKind,
  deltaMinutes: number | null,
  scheduledTime: string,
  historical: boolean,
  delayReason?: string | null,
  alertText?: string | null,
  /** True when a later tipoc already has a live report — this pass was skipped. */
  passedBeyond = false,
): StopStatus {
  if (stop.cancelledAtStop) return { verb: 'Cancelled', time: '', delay: '', tone: 'cancelled' }

  const live = trimSeconds(stop.liveTime)
  const hasActual = stop.liveKind === 'actual' || stop.liveKind === 'actual-arr' || Boolean(trimSeconds(stop.atd || stop.ata || stop.atp))
  const hasEst =
    stop.liveKind === 'est' ||
    stop.liveKind === 'est-arr' ||
    stop.liveKind === 'working' ||
    Boolean(trimSeconds(stop.etd || stop.eta || stop.etp))
  const bookedTime = scheduledTime !== '—' ? scheduledTime : ''
  // Working/densify passes with a booked clock but no live feed: never bare "Delayed".
  // Ahead of the train → Due + wtp; already passed without a report → No report.
  if (kind === 'pass' && !hasActual && !hasEst && !live) {
    if (passedBeyond) {
      return { verb: 'No report', time: bookedTime, delay: '', tone: 'ontime' }
    }
    if (bookedTime) {
      return { verb: historical ? '' : 'Due', time: bookedTime, delay: '', tone: 'ontime' }
    }
    if (!historical) {
      return { verb: 'No report', time: '', delay: '', tone: 'ontime' }
    }
  }

  const reason = delayReasonText(delayReason, alertText)
  const delayedOngoing =
    !hasActual &&
    !historical &&
    !live &&
    (Boolean(stop.unknownDelay) || Boolean(reason) || (deltaMinutes != null && deltaMinutes >= 1))

  if (delayedOngoing) {
    return {
      verb: 'Delayed',
      time: '',
      delay: '',
      tone: deltaMinutes != null && deltaMinutes >= 1 ? delayMinutesTone(deltaMinutes) : 'delay-16',
      note: reason || undefined,
      eta: live || null,
    }
  }

  const eventTime = live || bookedTime

  if (!eventTime) {
    return { verb: historical ? '—' : 'Due', time: '', delay: '', tone: 'ontime' }
  }

  let verb = 'Due'
  if (historical && !hasActual && !hasEst) {
    verb = ''
  } else if (hasEst && !hasActual) verb = 'Expected'
  else if (hasActual && kind === 'pass') verb = 'Passed'
  else if (hasActual && kind === 'destination') verb = 'Arrived'
  else if (hasActual && stop.liveKind === 'actual-arr') verb = 'Stopped'
  else if (hasActual) verb = 'Departed'

  const delay = (hasActual || hasEst) ? formatDelayLabel(deltaMinutes) : ''
  const tone: StopTone =
    deltaMinutes != null && deltaMinutes >= 1 ? delayMinutesTone(deltaMinutes)
      : deltaMinutes != null && deltaMinutes <= -1 ? 'early'
        : 'ontime'
  return { verb, time: eventTime, delay, tone }
}

function isActualLiveKind(kind?: string | null): boolean {
  return kind === 'actual' || kind === 'actual-arr'
}

function londonNowRailwayMinutes(): number | null {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(new Date())
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '00'
  return railwayDayMinutesFromHhmm(`${pick('hour')}:${pick('minute')}`)
}

function isPublicCall(stop: ServiceStop): boolean {
  return slotKind(stop.slot) !== 'pass'
}

function reportedIndex(stops: ServiceStop[], locationTpl?: string | null): number | null {
  if (locationTpl) {
    const i = stops.findIndex((stop) => stop.tpl === locationTpl)
    if (i >= 0) return i
  }
  return inferProgressIndex(stops, null)
}

function simpleProgressLabel(
  stops: ServiceStop[],
  reported: number,
  nameAt: (index: number) => string,
): string | null {
  return betweenStationsLabel(stops, reported, nameAt)
}

function delayFromStop(stop: ServiceStop, kind: StopKind): number | null {
  if (stop.unknownDelay) return null
  const clocks = rowClocks(kind, stop)
  const real = clocks.real || trimSeconds(stop.liveTime)
  if (!clocks.booked || !real) return null
  return computeDeltaMinutes(clocks.booked, real)
}

function rowClocks(kind: StopKind, stop: ServiceStop): { booked: string | null; real: string | null; estimated: boolean } {
  if (kind === 'pass') {
    const actual = trimSeconds(stop.atp)
    const estimate = trimSeconds(stop.etp)
    return {
      booked: trimSeconds(stop.wtp || stop.wtd || stop.wta),
      real: actual || estimate,
      estimated: !actual && Boolean(estimate),
    }
  }
  const actual = trimSeconds(kind === 'destination' ? (stop.ata || stop.atd) : (stop.atd || stop.ata))
  const estimate = trimSeconds(kind === 'destination' ? (stop.eta || stop.etd) : (stop.etd || stop.eta))
  const booked = trimSeconds(
    kind === 'destination'
      ? (stop.pta || stop.wta || stop.ptd || stop.wtd)
      : (stop.ptd || stop.wtd || stop.pta || stop.wta),
  )
  return { booked, real: actual || estimate, estimated: !actual && Boolean(estimate) }
}

function ServiceStopRow({
  stop,
  index,
  stopCount,
  label,
  viewMode,
  boardDate,
  historical,
  returnTo,
  stripeIndex,
  delayReason,
  alertText,
  progressText,
  delayMinutes: delayMinutesProp,
  passedBeyond = false,
}: {
  stop: ServiceStop
  index: number
  stripeIndex: number
  stopCount: number
  label: string
  viewMode: ServiceViewMode
  boardDate: string | null
  historical: boolean
  returnTo: string
  delayReason?: string | null
  alertText?: string | null
  progressText?: string | null
  delayMinutes?: number | null
  passedBeyond?: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const kind = slotKind(stop.slot)
  const pArr = stop.pta || null
  const pDep = stop.ptd || null
  const wArr = trimSeconds(stop.wta) || null
  const wDep = trimSeconds(stop.wtd) || null
  const wPass = trimSeconds(stop.wtp)
  const platformRaw = stop.livePlatform || stop.platform || ''
  const platformValue =
    platformRaw && typeof platformRaw === 'object'
      ? ''
      : String(platformRaw) === '[object Object]'
        ? ''
        : String(platformRaw)
  const platformSource = platformSourceLabel(stop.platformSource)
  const clocks = rowClocks(kind, stop)
  const deltaMinutes = delayMinutesProp ?? delayFromStop(stop, kind)
  const time = primaryTime(stop, kind)
  const status = buildStopStatus(
    stop,
    kind,
    deltaMinutes,
    time.value,
    historical,
    delayReason,
    alertText,
    passedBeyond,
  )
  const code = (stop.tpl || stop.crs || '').toUpperCase()
  const detailed = viewMode === 'detailed'

  const openDepartures = () => {
    if (!code) return
    const next = new URLSearchParams()
    next.set('hours', '1')
    if (historical && boardDate) {
      next.set('date', boardDate)
      const anchor = departuresAnchorTime(stop, kind)
      if (anchor) next.set('at', anchor)
    }
    if (returnTo) next.set('from', returnTo)
    next.set('label', label)
    router.push(`/departures/${encodeURIComponent(code)}?${next.toString()}`)
  }

  const colCount = detailed ? 6 : 4

  return (
    <>
      <tr
        className={[
          'stations-table__row',
          stripeIndex % 2 === 1 ? 'stations-table__row--striped' : '',
          `svc-stop--${kind}`,
          `svc-stop--${status.tone}`,
          detailed && open ? 'svc-stop-row--open' : '',
        ].filter(Boolean).join(' ')}
        onClick={code ? openDepartures : undefined}
      >
        {detailed && (
          <td className="svc-stops-table__kind">{SLOT_KIND_LABEL[kind]}</td>
        )}
        <td className="svc-stops-table__crs">{stop.crs || ''}</td>
        <td className="stations-table__name">
          <button
            type="button"
            className="svc-stops-table__name-btn"
            onClick={(event) => {
              event.stopPropagation()
              openDepartures()
            }}
            disabled={!code}
            aria-label={`Open departures at ${label}`}
          >
            <span className="svc-stop-name-lockup">
              <span className="svc-stop-name-text">{label}</span>
              {stop.crs ? <span className="svc-stop-name-crs">{stop.crs}</span> : null}
              {kind !== 'pass' && <ActivityPill activity={stop.activity} />}
              {detailed && stop.legMiles != null && Number.isFinite(stop.legMiles) ? (
                <span className="svc-stop-leg-miles" title={stop.cumMiles != null ? `${stop.cumMiles} mi from origin` : undefined}>
                  +{stop.legMiles.toFixed(1)} mi
                </span>
              ) : null}
            </span>
          </button>
        </td>
        <td className="svc-stops-table__plat">
          <span className="svc-stop-row__platform">
            <span className="svc-mono">{platformValue}</span>
          </span>
        </td>
        <td className={`svc-stops-table__status${status.note || status.eta ? ' svc-stops-table__status--note' : ''}`}>
          {status.time ? (
            <>
              {status.verb ? (
                <span className="svc-stops-table__status-main">
                  {status.verb}
                  <span className="svc-stops-table__status-at"> at</span>
                </span>
              ) : null}
              {' '}
              <span className="svc-stops-table__status-meta">
                {status.time}
                {status.delay ? <span className="svc-stops-table__status-delay">{status.delay}</span> : null}
              </span>
            </>
          ) : status.note || status.eta ? (
            <span
              className="svc-stops-table__status-line"
              title={[status.verb, status.note, status.eta ? `Expected at ${status.eta}` : ''].filter(Boolean).join(' | ')}
            >
              <span className="svc-stops-table__status-main">{status.verb}</span>
              <span className="svc-stops-table__status-sep" aria-hidden="true">|</span>
              <span className="svc-stops-table__status-note">
                {status.note ? <span>{status.note}</span> : null}
                {status.note && status.eta ? <span aria-hidden="true"> · </span> : null}
                {status.eta ? (
                  <>
                    <span className="svc-eta-full">Expected at {status.eta}</span>
                    <span className="svc-eta-short">exp {status.eta}</span>
                  </>
                ) : null}
              </span>
            </span>
          ) : (
            <span className="svc-stops-table__status-main">{status.verb}</span>
          )}
        </td>
        {detailed && (
          <td className="svc-stops-table__expand-cell">
            <button
              type="button"
              className="svc-stop-row__expand"
              aria-expanded={open}
              aria-label={`${open ? 'Hide' : 'Show'} working times for ${label}`}
              onClick={(event) => {
                event.stopPropagation()
                setOpen((current) => !current)
              }}
            >
              <ChevronRightIcon className="svc-stop-row__chevron" aria-hidden />
            </button>
          </td>
        )}
      </tr>
      {progressText ? (
        <tr className={[
          'svc-stops-table__progress',
          stripeIndex % 2 === 1 ? 'stations-table__row--striped' : '',
          `svc-stop--${status.tone}`,
        ].filter(Boolean).join(' ')}>
          <td colSpan={colCount}>{progressText}</td>
        </tr>
      ) : null}
      {detailed && (
        <tr className={[
          'svc-stops-table__detail-row',
          `svc-stop--${status.tone}`,
          open ? 'svc-stops-table__detail-row--open' : '',
        ].filter(Boolean).join(' ')}>
          <td colSpan={colCount}>
            <AutoAnimateCollapse isOpen={open} className="svc-stop-row__collapse">
              <div className="svc-stop-detail">
                <div className="svc-stop-detail__field">
                  <span className="svc-allocation-label">PTA</span>
                  <span className="svc-allocation-value svc-mono">{kind === 'pass' ? '—' : (pArr || '—')}</span>
                </div>
                <div className="svc-stop-detail__field">
                  <span className="svc-allocation-label">PTD</span>
                  <span className="svc-allocation-value svc-mono">{kind === 'pass' ? '—' : (pDep || '—')}</span>
                </div>
                <div className="svc-stop-detail__field">
                  <span className="svc-allocation-label">WTA</span>
                  <span className="svc-allocation-value svc-mono">{kind === 'pass' ? '—' : (wArr || '—')}</span>
                </div>
                <div className="svc-stop-detail__field">
                  <span className="svc-allocation-label">WTD/WTP</span>
                  <span className="svc-allocation-value svc-mono">{kind === 'pass' ? (wPass || '—') : (wDep || '—')}</span>
                </div>
                <div className="svc-stop-detail__field">
                  <span className="svc-allocation-label">Platform source</span>
                  <span className="svc-allocation-value">
                    {platformSource ? (
                      <span className={`svc-platform-badge ${platformSourceClass(platformSource)}`}>{platformSource}</span>
                    ) : '—'}
                  </span>
                </div>
                <div className="svc-stop-detail__field">
                  <span className="svc-allocation-label">Confirmed</span>
                  <span className="svc-allocation-value">{stop.platformConfirmed ? 'Yes' : 'No'}</span>
                </div>
                <div className="svc-stop-detail__field svc-stop-detail__field--wide">
                  <span className="svc-allocation-label">Activity</span>
                  <span className="svc-allocation-value">
                    <ActivityPill activity={stop.activity} showAll />
                    {!stop.activity ? '—' : null}
                  </span>
                </div>
              </div>
            </AutoAnimateCollapse>
          </td>
        </tr>
      )}
    </>
  )
}

const CALLING_COLOUR_KEY: { tone: string; label: string }[] = [
  { tone: 'early', label: 'Early' },
  { tone: 'ontime', label: 'On time' },
  { tone: 'delay-1', label: '1–15 min late' },
  { tone: 'delay-16', label: '16–29 min late' },
  { tone: 'delay-30', label: '30–59 min late' },
  { tone: 'delay-60', label: '60+ min late' },
  { tone: 'cancelled', label: 'Cancelled' },
]

function CallingColourKey() {
  return (
    <ul className="svc-stops-key" aria-label="Calling pattern colour key">
      {CALLING_COLOUR_KEY.map((item) => (
        <li
          key={item.tone}
          className={`svc-stops-key__item svc-stops-key__item--${item.tone}`}
        >
          {item.label}
        </li>
      ))}
    </ul>
  )
}

export function ServiceStopList({
  stops,
  viewMode,
  boardDate,
  historical = false,
  returnTo,
  delayReason,
  alertText,
  location,
  associations = [],
  associationHref,
  showLegend = true,
  showAssociations = true,
  preserveOrder = false,
  heading = null,
}: {
  stops: ServiceStop[]
  viewMode: ServiceViewMode
  boardDate?: string | null
  historical?: boolean
  returnTo: string
  delayReason?: string | null
  alertText?: string | null
  location?: { last?: { tiploc?: string } | null; label?: string } | null
  associations?: ServiceAssociation[]
  associationHref?: (a: ServiceAssociation) => string
  showLegend?: boolean
  showAssociations?: boolean
  preserveOrder?: boolean
  heading?: string | null
}) {
  const { stations } = useStations()
  const lookup = useMemo(() => buildStopNameLookup(stations), [stations])
  const orderedStops = useMemo(
    () => (preserveOrder ? stops : sortStopsByJourneyTime(stops)),
    [preserveOrder, stops],
  )
  const [nowMins, setNowMins] = useState<number | null>(() => londonNowRailwayMinutes())
  useEffect(() => {
    if (historical) return
    const tick = () => setNowMins(londonNowRailwayMinutes())
    tick()
    const id = window.setInterval(tick, 15_000)
    return () => window.clearInterval(id)
  }, [historical, orderedStops])
  const showPasses = viewMode === 'detailed'
  const visible = orderedStops
    .map((stop, index) => ({ stop, index }))
    .filter(({ stop }) => showPasses || slotKind(stop.slot) !== 'pass')

  if (visible.length === 0) {
    return <p className="unit-muted">No calling points on this service.</p>
  }

  const reportedFull = historical
    ? null
    : inferProgressIndex(orderedStops, nowMins) ?? reportedIndex(orderedStops, location?.last?.tiploc)
  const livePublicFull =
    reportedFull == null
      ? -1
      : orderedStops.findLastIndex(
          (stop, i) => i <= reportedFull && isPublicCall(stop) && !stop.cancelledAtStop,
        )
  const liveMatch =
    reportedFull == null
      ? -1
      : viewMode === 'simple'
        ? visible.findIndex(({ index }) => index === livePublicFull)
        : visible.findIndex(({ index }) => index === reportedFull)
  const liveIdx = liveMatch >= 0 ? liveMatch : null
  const liveVisible = liveIdx != null ? visible[liveIdx]?.stop : null
  const arrivedAtDestination = Boolean(
    liveVisible &&
      slotKind(liveVisible.slot) === 'destination' &&
      (trimSeconds(liveVisible.ata) ||
        liveVisible.liveKind === 'actual-arr' ||
        trimSeconds(liveVisible.atd) ||
        liveVisible.liveKind === 'actual'),
  )
  const liveHighlightIdx = arrivedAtDestination ? null : liveIdx
  const progressText =
    viewMode === 'simple' &&
    reportedFull != null &&
    liveHighlightIdx != null &&
    liveHighlightIdx >= 0
      ? simpleProgressLabel(orderedStops, reportedFull, (index) =>
          displayStopName(orderedStops, index, lookup),
        )
      : null
  const [headingOpen, setHeadingOpen] = useState(true)
  const headingPanelId = useId()
  let carriedDelay: number | null = null
  const delayMinutesByStripe = visible.map(({ stop }) => {
    const kind = slotKind(stop.slot)
    const own = delayFromStop(stop, kind)
    if (own != null) carriedDelay = own
    const upcoming = !isActualLiveKind(stop.liveKind)
    if (own != null) return own
    if (upcoming && carriedDelay != null && carriedDelay >= 1) return carriedDelay
    return null
  })

  const table = (
      <div className="stations-table-wrap">
        <table className={`stations-table svc-stops-table svc-stops-table--${viewMode}`}>
          <thead>
            <tr>
              {viewMode === 'detailed' && (
                <th className="svc-stops-table__kind" scope="col">
                  <span className="stations-table__sort-button">Stop</span>
                </th>
              )}
              <th className="svc-stops-table__crs" scope="col">
                <span className="stations-table__sort-button">CRS</span>
              </th>
              <th className="stations-table__name" scope="col">
                <span className="stations-table__sort-button">Station</span>
              </th>
              <th className="svc-stops-table__plat" scope="col"><span className="stations-table__sort-button">Plt</span></th>
              <th className="svc-stops-table__status" scope="col"><span className="stations-table__sort-button">Status</span></th>
              {viewMode === 'detailed' && (
                <th scope="col" className="svc-stops-table__expand-head">
                  <span className="visually-hidden">Details</span>
                </th>
              )}
            </tr>
          </thead>
          {visible.map(({ stop, index }, stripeIndex) => (
            <tbody
              key={`${stop.tpl}-${stop.slot}-${index}`}
              className={liveHighlightIdx === stripeIndex ? 'svc-stop--live-group' : undefined}
            >
              <ServiceStopRow
                stop={stop}
                index={index}
                stripeIndex={stripeIndex}
                stopCount={stops.length}
                label={displayStopName(orderedStops, index, lookup)}
                viewMode={viewMode}
                boardDate={boardDate || null}
                historical={historical}
                returnTo={returnTo}
                delayReason={delayReason}
                alertText={alertText}
                progressText={viewMode === 'simple' && liveHighlightIdx === stripeIndex ? progressText : null}
                delayMinutes={delayMinutesByStripe[stripeIndex]}
                passedBeyond={reportedFull != null && index < reportedFull}
              />
              {showAssociations
                ? associations
                .filter((a) => a.tiploc && a.tiploc === stop.tpl && a.category !== 'NP')
                .map((a) => {
                  const href = associationHref?.(a) || `/services/${encodeURIComponent(a.otherUid || a.otherRid)}`
                  const dest = a.otherDestinationName || 'another destination'
                  const orig = a.otherOriginName || 'elsewhere'
                  const head = a.otherTrainId ? ` ${a.otherTrainId}` : ''
                  const text =
                    a.category === 'VV' && a.role === 'main'
                      ? `${head.trim() || 'Portion'} towards ${dest}`
                      : a.category === 'VV'
                        ? `Formed from${head} from ${orig}`
                        : `Associated${head}`
                  return (
                    <tr key={`${a.category}-${a.otherRid}`} className="svc-stop-assoc">
                      <td colSpan={viewMode === 'detailed' ? 6 : 4}>
                        <a className="svc-stop-assoc-link" href={href}>
                          {text}
                        </a>
                      </td>
                    </tr>
                  )
                })
                : null}
            </tbody>
          ))}
        </table>
      </div>
  )

  return (
    <div className="stations-table-panel svc-stops-table-panel">
      {showLegend ? (
      <div className="svc-stops-key-wrap">
        <CallingColourKey />
      </div>
      ) : null}
      {heading ? (
        <>
          <div className={`svc-stops-heading-wrap${headingOpen ? ' svc-stops-heading-wrap--open' : ''}`}>
            <TextCard
              title={heading}
              className="svc-stops-heading-card"
              onClick={() => setHeadingOpen((open) => !open)}
              ariaLabel={`${headingOpen ? 'Collapse' : 'Expand'} ${heading}`}
            />
          </div>
          <AutoAnimateCollapse
            isOpen={headingOpen}
            id={headingPanelId}
            className="svc-stops-heading-panel"
          >
            {table}
          </AutoAnimateCollapse>
        </>
      ) : table}
    </div>
  )
}

export default ServiceStopList
