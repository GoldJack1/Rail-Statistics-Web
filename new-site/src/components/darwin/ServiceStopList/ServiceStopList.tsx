'use client'

import React, { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'

import { ActivityPill } from '@/components/darwin/ActivityPill'
import { ChevronRightIcon } from '@/components/icons'
import AutoAnimateCollapse from '@/components/misc/AutoAnimateCollapse/AutoAnimateCollapse'
import { useStations } from '@/hooks/useStations'
import type { ServiceStop } from '@/types/darwin'
import { buildStopNameLookup, displayStopName } from '@/components/darwin/serviceStopLabel'
import type { ServiceViewMode } from '@/components/darwin/serviceViewMode'
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

function trimSeconds(t: string | null): string {
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
  const live = trimSeconds(stop.liveTime)
  if (live) return live
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

type StopTone = 'ontime' | 'early' | 'delayed' | 'cancelled'

type StopStatus = {
  verb: string
  time: string
  delay: string
  tone: StopTone
}

function buildStopStatus(
  stop: ServiceStop,
  kind: StopKind,
  deltaMinutes: number | null,
  scheduledTime: string,
  historical: boolean,
): StopStatus {
  if (stop.cancelledAtStop) return { verb: 'Cancelled', time: '', delay: '', tone: 'cancelled' }
  if (stop.unknownDelay) return { verb: 'Delayed', time: '', delay: '', tone: 'delayed' }

  const live = trimSeconds(stop.liveTime)
  const hasActual = stop.liveKind === 'actual' || stop.liveKind === 'actual-arr'
  const hasEst = stop.liveKind === 'est' || stop.liveKind === 'est-arr'
  const eventTime = live || (scheduledTime !== '—' ? scheduledTime : '')

  if (!eventTime) {
    return { verb: historical ? '—' : 'Due', time: '', delay: '', tone: 'ontime' }
  }

  let verb = 'Due'
  if (hasEst && !hasActual) verb = 'Expected'
  else if (hasActual && kind === 'pass') verb = 'Passed'
  else if (hasActual && (kind === 'destination' || stop.liveKind === 'actual-arr')) verb = 'Stopped'
  else if (hasActual) verb = 'Departed'

  const delay = (hasActual || hasEst) ? formatDelayLabel(deltaMinutes) : ''
  const tone: StopTone =
    deltaMinutes != null && deltaMinutes >= 1 ? 'delayed'
      : deltaMinutes != null && deltaMinutes <= -1 ? 'early'
        : 'ontime'
  return { verb, time: eventTime, delay, tone }
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
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const kind = slotKind(stop.slot)
  const pArr = stop.pta || null
  const pDep = stop.ptd || null
  const wArr = trimSeconds(stop.wta) || null
  const wDep = trimSeconds(stop.wtd) || null
  const wPass = stop.wtp ? trimSeconds(stop.wtp) : null
  const platformValue = stop.livePlatform || stop.platform || ''
  const platformSource = platformSourceLabel(stop.platformSource)
  const scheduledForDelta = kind === 'pass'
    ? (wPass || wDep || wArr || null)
    : (pDep || pArr || wDep || wArr || null)
  const deltaMinutes = stop.unknownDelay ? null : computeDeltaMinutes(scheduledForDelta, stop.liveTime)
  const time = primaryTime(stop, kind)
  const status = buildStopStatus(stop, kind, deltaMinutes, time.value, historical)
  const code = (stop.crs || stop.tpl || '').toUpperCase()
  const detailed = viewMode === 'detailed'

  const openDepartures = () => {
    if (!code) return
    const next = new URLSearchParams()
    next.set('hours', '1')
    if (boardDate) next.set('date', boardDate)
    const anchor = departuresAnchorTime(stop, kind)
    if (anchor && boardDate) next.set('at', anchor)
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
        {detailed && (
          <td className="svc-stops-table__plat">
            <span className="svc-stop-row__platform">
              <span className="svc-mono">{platformValue}</span>
            </span>
          </td>
        )}
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
            </span>
          </button>
        </td>
        {!detailed && (
          <td className="svc-stops-table__plat">
            <span className="svc-stop-row__platform">
              <span className="svc-mono">{platformValue}</span>
            </span>
          </td>
        )}
        <td className="svc-stops-table__status">
          {status.time ? (
            <>
              <span className="svc-stops-table__status-main">
                {status.verb}
                <span className="svc-stops-table__status-at"> at</span>
              </span>
              {' '}
              <span className="svc-stops-table__status-meta">
                {status.time}
                {status.delay ? <span className="svc-stops-table__status-delay">{status.delay}</span> : null}
              </span>
            </>
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

export function ServiceStopList({
  stops,
  viewMode,
  boardDate,
  historical = false,
  returnTo,
}: {
  stops: ServiceStop[]
  viewMode: ServiceViewMode
  /** Date sent to the departures board. Null keeps the board on live today. */
  boardDate?: string | null
  /** True for a saved historical snapshot, which changes the scheduled pill. */
  historical?: boolean
  returnTo: string
}) {
  const { stations } = useStations()
  const lookup = useMemo(() => buildStopNameLookup(stations), [stations])
  const visible = stops
    .map((stop, index) => ({ stop, index }))
    .filter(({ stop }) => viewMode === 'detailed' || slotKind(stop.slot) !== 'pass')

  if (visible.length === 0) {
    return <p className="unit-muted">No calling points on this service.</p>
  }

  return (
    <div className="stations-table-panel svc-stops-table-panel">
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
              {viewMode === 'detailed' && (
                <th className="svc-stops-table__plat" scope="col"><span className="stations-table__sort-button">Plt</span></th>
              )}
              <th className="stations-table__name" scope="col">
                <span className="stations-table__sort-button">Station</span>
              </th>
              {viewMode !== 'detailed' && (
                <th className="svc-stops-table__plat" scope="col"><span className="stations-table__sort-button">Plt</span></th>
              )}
              <th className="svc-stops-table__status" scope="col"><span className="stations-table__sort-button">Status</span></th>
              {viewMode === 'detailed' && (
                <th scope="col" className="svc-stops-table__expand-head">
                  <span className="visually-hidden">Details</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map(({ stop, index }, stripeIndex) => (
              <ServiceStopRow
                key={`${stop.tpl}-${stop.slot}-${index}`}
                stop={stop}
                index={index}
                stripeIndex={stripeIndex}
                stopCount={stops.length}
                label={displayStopName(stops, index, lookup)}
                viewMode={viewMode}
                boardDate={boardDate || null}
                historical={historical}
                returnTo={returnTo}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ServiceStopList
