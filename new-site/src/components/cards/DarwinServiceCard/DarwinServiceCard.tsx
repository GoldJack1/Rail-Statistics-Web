'use client'

import React from 'react'
import type { ButtonColorVariant } from '@/components/buttons'
import type { DepartureRow } from '@/types/darwin'
import { formatLmTocName } from '@/utils/formatLmTocName'
import {
  coachCountFromRow,
  coachLoadTone,
  coachLoadUsesPercent,
  coachLoadValues,
  formatCoachLoad,
} from '@/utils/darwinCoachLoading'
import '../StationCard/StationCard.css'
import '../StationCardActionBar/StationCardActionBar.css'
import '@/components/buttons/base/BUTBaseButton/BUTBaseButton.css'
import './DarwinServiceCard.css'

type DarwinServiceCardProps = {
  row: DepartureRow
  historicalMode: boolean
  detailedInfo?: boolean
  showFormation?: boolean
  onClick: () => void
  ariaLabel: string
}

type StatusTone = 'ontime' | 'delayed' | 'cancelled' | 'snapshot'

const STATUS_COLOR: Record<StatusTone, ButtonColorVariant> = {
  ontime: 'green-action',
  delayed: 'fav-action',
  cancelled: 'red-action',
  snapshot: 'primary',
}

function formatDelayAbs(minutes: number): string {
  return `${Math.abs(minutes)}m`
}

function carriageCount(row: DepartureRow): number | null {
  return coachCountFromRow(row)
}

function formatOperatorLabel(row: DepartureRow): string {
  return formatLmTocName(row.tocName, row.toc, row.originCrs, row.destinationCrs)
}
function formatUnitList(unitIds: string[]): string {
  if (unitIds.length <= 2) return unitIds.join(' & ')
  const head = unitIds.slice(0, -1).join(', ')
  return `${head} & ${unitIds[unitIds.length - 1]}`
}

function unitLabel(row: DepartureRow): string | null {
  if (!row.unitIds || row.unitIds.length === 0) return null
  return `(${formatUnitList(row.unitIds)})`
}

function buildHeadline(row: DepartureRow): string {
  const time = row.scheduledTime || ''
  if (row.movement === 'arrival') {
    return `${time} from ${row.originName || row.origin}`
  }
  return `${time} to ${row.destinationName || row.destination}`
}

function platformNumber(row: DepartureRow): string | null {
  const live = row.livePlatform?.trim()
  if (live) return live
  const scheduled = row.platform?.trim()
  if (scheduled) return scheduled
  return null
}

function buildPlatformLabel(row: DepartureRow, historicalMode: boolean): string {
  if (row.serviceType === 'rail-replacement') return 'Bus Stop outside the Station'
  const number = platformNumber(row)
  if (number) return `Platform ${number}`
  if (historicalMode) return 'Platform NA'
  return 'Platform TBC'
}

function buildMeta(row: DepartureRow, detailedInfo: boolean, historicalMode: boolean): string | null {
  const platLabel = buildPlatformLabel(row, historicalMode)
  if (!detailedInfo) return platLabel
  const origin = row.originName || row.origin
  const headcode = row.trainId?.trim()
  const route = headcode
    ? row.cancelled
      ? `Was ${headcode} starting at ${origin}`
      : `${headcode} starting at ${origin}`
    : null
  const parts = [platLabel, route].filter(Boolean)
  return parts.length > 0 ? parts.join(' | ') : null
}

function buildFormation(row: DepartureRow): string | null {
  const count = carriageCount(row)
  const units = unitLabel(row)
  if (count == null) return null
  const carriagePhrase = `${count} carriage${count === 1 ? '' : 's'}`
  if (row.cancelled) {
    return units
      ? `Was formed of ${carriagePhrase} by ${units}`
      : `Was formed of ${carriagePhrase}`
  }
  return units ? `Formed of ${carriagePhrase} by ${units}` : `Formed of ${carriagePhrase}`
}

function buildStatus(row: DepartureRow, historicalMode: boolean, detailedInfo: boolean): {
  tone: StatusTone
  label: string
  mode: string | null
} {
  const mode = detailedInfo ? (row.isPassing ? '(Passing)' : '(Stopping)') : null
  const delayMinutes = typeof row.delayMinutes === 'number' ? row.delayMinutes : null
  const isArrivalEvent = row.movement === 'arrival' || row.liveKind === 'actual-arr'
  const verb = row.isPassing ? 'Passed' : isArrivalEvent ? 'Arrived' : 'Departed'

  if (row.cancelled) {
    return { tone: 'cancelled', label: 'Cancelled', mode }
  }

  const isActual = row.liveKind === 'actual' || row.liveKind === 'actual-arr'
  if (isActual) {
    if (delayMinutes != null && delayMinutes < 0) {
      return { tone: 'ontime', label: `${verb} ${formatDelayAbs(delayMinutes)} early`, mode }
    }
    if (delayMinutes != null && delayMinutes > 0) {
      return { tone: 'delayed', label: `${verb} ${formatDelayAbs(delayMinutes)} late`, mode }
    }
    return { tone: 'ontime', label: 'On Time', mode }
  }

  if (row.unknownDelay || row.manualUnknownDelay) {
    return { tone: 'delayed', label: 'Delayed', mode }
  }

  if (historicalMode && (row.liveKind === 'scheduled' || row.liveKind === 'working')) {
    const scheduledAt = Date.parse(row.scheduledAt)
    const alreadyRun = Number.isFinite(scheduledAt) && scheduledAt < Date.now() - 60_000
    if (alreadyRun) {
      return { tone: 'ontime', label: verb, mode }
    }
  }

  const expectedOffSchedule =
    (delayMinutes != null && delayMinutes > 0) ||
    ((row.liveKind === 'est' || row.liveKind === 'est-arr') &&
      Boolean(row.liveTime) &&
      row.liveTime !== row.scheduledTime)

  if (expectedOffSchedule) {
    const expected = row.liveTime ? `Delayed | Expected at ${row.liveTime}` : 'Delayed'
    return { tone: 'delayed', label: expected, mode }
  }

  return { tone: 'ontime', label: 'On Time', mode }
}

const MAX_COACH_PILLS = 24
const FIXED_COACH_LIMIT = 9

function coachClassName(index: number, count: number): string {
  if (count <= 1) return 'rs-service-card__coach rs-service-card__coach--solo'
  if (index === 0) return 'rs-service-card__coach rs-service-card__coach--front'
  if (index === count - 1) return 'rs-service-card__coach rs-service-card__coach--rear'
  return 'rs-service-card__coach'
}

const DarwinServiceCard: React.FC<DarwinServiceCardProps> = ({
  row,
  historicalMode,
  detailedInfo = false,
  showFormation = true,
  onClick,
  ariaLabel,
}) => {
  const operator = formatOperatorLabel(row)
  const headline = buildHeadline(row)
  const meta = buildMeta(row, detailedInfo, historicalMode)
  const formation = buildFormation(row)
  const status = buildStatus(row, historicalMode, detailedInfo)
  const coachCount = carriageCount(row)
  const visibleCoaches = coachCount != null ? Math.min(coachCount, MAX_COACH_PILLS) : 0
  const loadValues = visibleCoaches > 0 ? coachLoadValues(row, visibleCoaches) : []
  const loadAsPercent = coachLoadUsesPercent(row, loadValues)

  return (
    <article
      className="rs-station-card-stack rs-service-card"
      role="button"
      tabIndex={0}
      aria-label={ariaLabel}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onClick()
        }
      }}
    >
      <section className="rs-station-text-card">
        <p className="rs-station-operator">{operator}</p>
        <h2 className="rs-station-name">{headline}</h2>
        {meta ? <p className="rs-station-location">{meta}</p> : null}
      </section>
      <section className="rs-station-card-action-bar" aria-hidden="true">
        <div
          className={[
            'rs-button',
            'rs-button--wide',
            'rs-button--squared',
            'rs-button--active',
            'rs-button--width-fill',
            `rs-button--color-${STATUS_COLOR[status.tone]}`,
            'rs-station-card-action-bar__visit',
            'rs-service-card__status',
          ].join(' ')}
        >
          <span className="rs-service-card__status-label">{status.label}</span>
          {status.mode ? <span className="rs-service-card__status-mode">{status.mode}</span> : null}
          <div className="rs-button__inner-shadow" />
        </div>
      </section>
      {showFormation ? (
        <section className="rs-station-text-card rs-service-card__formation-bar" aria-hidden="true">
          <div
            className={[
              'rs-service-card__coaches',
              visibleCoaches > 0 ? '' : 'rs-service-card__coaches--empty',
              visibleCoaches > 0 && visibleCoaches <= FIXED_COACH_LIMIT
                ? 'rs-service-card__coaches--fixed'
                : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {visibleCoaches > 0
              ? Array.from({ length: visibleCoaches }, (_, index) => {
                  const tone = coachLoadTone(loadValues[index] ?? null, loadAsPercent)
                  return (
                    <span
                      key={index}
                      className={[
                        coachClassName(index, visibleCoaches),
                        tone
                          ? `rs-service-card__coach--load-${tone} rs-button--color-${STATUS_COLOR[tone]}`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      title={
                        loadValues[index] != null
                          ? `Coach ${index + 1} · ${formatCoachLoad(loadValues[index]!, loadAsPercent)} loaded`
                          : undefined
                      }
                    />
                  )
                })
              : <span className="rs-service-card__coach" />}
          </div>
          {detailedInfo ? (
            <p className="rs-service-card__formation">{formation || '\u00a0'}</p>
          ) : null}
        </section>
      ) : null}
    </article>
  )
}

export default DarwinServiceCard
