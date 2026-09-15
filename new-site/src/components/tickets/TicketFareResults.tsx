'use client'

import React from 'react'
import { MapTrifold, Ticket } from '@phosphor-icons/react'

import { BUTWideButton } from '@/components/buttons'

import { StationDetailField } from '@/components/models/StationDetails/StationDetailField'
import { StationDetailsSubsection } from '@/components/models/StationDetails/StationDetailsSubsection'
import { StationSectionTitle } from '@/components/models/StationDetails/StationSectionTitle'
import type { DPAYGFare, DPAYGScheme, DPAYGStation } from '@/types/dpayg'
import { formatDpaygPence } from '@/types/dpayg'
import type { PaygZoneCapBand } from '@/services/paygMatrixCatalog'
import { formatPaygZoneLabel } from '@/services/paygMatrixParse'
import { stationPublicCode } from '@/utils/dpaygStationSearch'
import { TextSkeletonLine } from '@/components/misc/Skeleton/TextSkeletonLine'
import '@/components/models/StationModal/StationModal.css'
import '@/components/cards/StationsTableView/StationsTableView.css'

const ESTIMATE_DISCLAIMER =
  'Please note that the prices shown below are only estimates of what a journey may actually cost. This is because fares for some areas are not publicly available.'

const SHEFFIELD_DONCASTER_DISCLAIMER =
  'Please note that railcard prices may not be exact, but the amounts shown are a rough guide to what a journey may cost.'

const EMR_DYNAMIC_DISCLAIMER =
  'Please note fares shown above are only estimates of what the actual fare may be. This is due to the Derby/Nottingham to Leicester trial area using a dynamic pricing system and therefore fares can change. After you tap Start Journey in the EMR app, check the live prices for the most accurate cost.'

type TicketFareResultsProps = {
  scheme: DPAYGScheme | null
  origin: DPAYGStation | null
  dest: DPAYGStation | null
  fare: DPAYGFare | null
  searched: boolean
  /** True while a fare document lookup is in flight — do not show “not found” yet. */
  loading?: boolean
  error?: string | null
  areaKind?: 'trial' | 'payg'
  emptyIntro?: string
  showStationCodes?: boolean
  /** Skip the details card chrome when nested in the lookup page card. */
  framed?: boolean
  skeleton?: boolean
  onViewRouteOnMap?: () => void
}

function ViewRouteOnMapButton({
  onClick,
  skeleton = false,
}: {
  onClick?: () => void
  skeleton?: boolean
}) {
  if (!onClick) return null
  return (
    <BUTWideButton
      type="button"
      width="fill"
      colorVariant="primary"
      instantAction
      disabled={skeleton}
      className="tickets-view-route-button"
      icon={<MapTrifold size={16} aria-hidden />}
      onClick={onClick}
    >
      View route on map
    </BUTWideButton>
  )
}

function skelText(text: string, skeleton: boolean) {
  return skeleton ? <TextSkeletonLine>{text}</TextSkeletonLine> : text
}

function StandardFareFields({
  standardPence,
  railcardPence,
  showRailcard,
  skeleton = false,
}: {
  standardPence: number
  railcardPence: number
  showRailcard: boolean
  skeleton?: boolean
}) {
  return (
    <div className="modal-details-grid tickets-fare-amounts">
      <StationDetailField
        label="Standard single"
        value={formatDpaygPence(standardPence)}
        skeleton={skeleton}
      />
      {showRailcard ? (
        <StationDetailField
          label="Railcard"
          value={formatDpaygPence(railcardPence)}
          skeleton={skeleton}
        />
      ) : null}
    </div>
  )
}

function TicketFareCard({
  children,
  framed = true,
}: {
  children: React.ReactNode
  framed?: boolean
}) {
  if (!framed) return <>{children}</>
  return (
    <main className="stations-main station-details-main tickets-main">
      <section className="station-details-card modal-content">
        <div className="modal-body station-details-visible-body">{children}</div>
      </section>
    </main>
  )
}

function TicketsStationsTable({
  columns,
  rows,
  skeleton = false,
}: {
  columns: string[]
  rows: { key: string; cells: string[]; matched?: boolean }[]
  skeleton?: boolean
}) {
  return (
    <div className="stations-table-panel tickets-fares-table-panel">
      <div className="stations-table-wrap">
        <table className="stations-table tickets-fares-table">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col">
                  <span className="stations-table__sort-button">
                    {skelText(column, skeleton)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr
                key={row.key}
                className={[
                  'stations-table__row',
                  index % 2 === 1 ? 'stations-table__row--striped' : '',
                  row.matched ? 'tickets-fares-table__row--match' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {row.cells.map((cell, cellIndex) => (
                  <td
                    key={`${row.key}-${cellIndex}`}
                    className={cellIndex === 0 ? undefined : 'stations-table__id'}
                  >
                    {skelText(cell, skeleton)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function capNoteAddsContext(label: string | undefined, pence: number): boolean {
  const text = label?.trim()
  if (!text) return false
  const amount = formatDpaygPence(pence).toLowerCase()
  const normalised = text.toLowerCase().replace(/\s+/g, '')
  if (normalised.includes(amount.replace(/\s+/g, ''))) return false
  if (pence > 0 && normalised.includes((pence / 100).toFixed(2))) return false
  return true
}

function DailyWeeklyCapFields({
  dailyPence,
  weeklyPence,
  dailyLabel,
  weeklyLabel,
  skeleton = false,
}: {
  dailyPence: number
  weeklyPence: number
  dailyLabel?: string
  weeklyLabel?: string
  skeleton?: boolean
}) {
  return (
    <div className="tickets-caps-simple">
      <div className="modal-details-grid tickets-fare-amounts">
        {dailyPence > 0 ? (
          <StationDetailField
            label="Daily"
            value={formatDpaygPence(dailyPence)}
            skeleton={skeleton}
          />
        ) : null}
        {weeklyPence > 0 ? (
          <StationDetailField
            label="Weekly"
            value={formatDpaygPence(weeklyPence)}
            skeleton={skeleton}
          />
        ) : null}
      </div>
      {capNoteAddsContext(dailyLabel, dailyPence) ? (
        <p className="tickets-cap-note">{skelText(dailyLabel!, skeleton)}</p>
      ) : null}
      {capNoteAddsContext(weeklyLabel, weeklyPence) ? (
        <p className="tickets-cap-note">{skelText(weeklyLabel!, skeleton)}</p>
      ) : null}
    </div>
  )
}

function CapsSubsection({
  scheme,
  zoneCapBands,
  journeyDailyCapPence,
  journeyWeeklyCapPence,
  emptyMessage,
  sectionTitle,
  skeleton = false,
}: {
  scheme?: DPAYGScheme | null
  zoneCapBands?: PaygZoneCapBand[]
  journeyDailyCapPence?: number
  journeyWeeklyCapPence?: number
  emptyMessage?: string
  sectionTitle?: string
  skeleton?: boolean
}) {
  const bands = zoneCapBands ?? []
  const hasJourneyCaps =
    (journeyDailyCapPence != null && journeyDailyCapPence > 0) ||
    (journeyWeeklyCapPence != null && journeyWeeklyCapPence > 0)
  const hasSchemeCaps =
    !!scheme && (scheme.caps.dailyPence > 0 || scheme.caps.weeklyPence > 0)

  if (bands.length === 0 && !hasJourneyCaps && !hasSchemeCaps) {
    if (!emptyMessage) return null
    const empty = <p className="tickets-results-muted">{skelText(emptyMessage, skeleton)}</p>
    if (sectionTitle) {
      return (
        <StationDetailsSubsection title={sectionTitle} skeleton={skeleton}>
          {empty}
        </StationDetailsSubsection>
      )
    }
    return empty
  }

  const showJourneyRow = hasJourneyCaps && bands.length > 0
  const useSimpleFields = !showJourneyRow && bands.length <= 1

  const body = useSimpleFields ? (
    <DailyWeeklyCapFields
      dailyPence={
        hasJourneyCaps
          ? journeyDailyCapPence ?? 0
          : bands[0]
            ? bands[0].dailyCapPence
            : scheme?.caps.dailyPence ?? 0
      }
      weeklyPence={
        hasJourneyCaps
          ? journeyWeeklyCapPence ?? 0
          : bands[0]
            ? bands[0].weeklyCapPence
            : scheme?.caps.weeklyPence ?? 0
      }
      dailyLabel={!hasJourneyCaps && bands.length === 0 ? scheme?.caps.dailyLabel : undefined}
      weeklyLabel={!hasJourneyCaps && bands.length === 0 ? scheme?.caps.weeklyLabel : undefined}
      skeleton={skeleton}
    />
  ) : (
    <TicketsStationsTable
      columns={['Cap', 'Daily', 'Weekly']}
      rows={[
        ...(showJourneyRow
          ? [
              {
                key: 'this-journey',
                matched: true,
                cells: [
                  'This journey',
                  journeyDailyCapPence && journeyDailyCapPence > 0
                    ? formatDpaygPence(journeyDailyCapPence)
                    : '—',
                  journeyWeeklyCapPence && journeyWeeklyCapPence > 0
                    ? formatDpaygPence(journeyWeeklyCapPence)
                    : '—',
                ],
              },
            ]
          : []),
        ...bands.map((band) => ({
          key: band.id,
          matched: false,
          cells: [
            band.title,
            band.dailyCapPence > 0 ? formatDpaygPence(band.dailyCapPence) : '—',
            band.weeklyCapPence > 0 ? formatDpaygPence(band.weeklyCapPence) : '—',
          ],
        })),
      ]}
      skeleton={skeleton}
    />
  )

  if (sectionTitle) {
    return (
      <StationDetailsSubsection title={sectionTitle} skeleton={skeleton}>
        {body}
      </StationDetailsSubsection>
    )
  }
  return body
}

function formatOperatorsList(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} & ${names[1]}`
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`
}

function operatorsValidOnLabel(scheme: DPAYGScheme): string {
  const operatorNames = scheme.operators.map((op) => op.name).filter(Boolean)
  return (
    formatOperatorsList(operatorNames) ||
    scheme.operatorBrand ||
    scheme.defaultOperator
  )
}

function OperatorsValidOn({
  scheme,
  skeleton = false,
}: {
  scheme?: DPAYGScheme | null
  skeleton?: boolean
}) {
  if (!scheme) return null
  const operatorsLabel = operatorsValidOnLabel(scheme)
  if (!operatorsLabel) return null
  return (
    <p className="tickets-trial-meta__operators">
      {skelText(`Operators valid on: ${operatorsLabel}`, skeleton)}
    </p>
  )
}

function JourneyZonesLine({
  originZone,
  destZone,
  skeleton = false,
}: {
  originZone?: string
  destZone?: string
  skeleton?: boolean
}) {
  const originLabel = formatPaygZoneLabel(originZone)
  const destLabel = formatPaygZoneLabel(destZone)
  if (!originLabel && !destLabel) return null
  return (
    <p className="tickets-results-zones">
      <span>{skelText(originLabel || 'Zone unknown', skeleton)}</span>
      <span className="tickets-results-route__arrow" aria-hidden="true">
        →
      </span>
      <span>{skelText(destLabel || 'Zone unknown', skeleton)}</span>
    </p>
  )
}

function JourneyRouteHeading({
  scheme,
  origin,
  dest,
  showStationCodes = true,
  skeleton = false,
}: {
  scheme: DPAYGScheme
  origin: DPAYGStation
  dest: DPAYGStation
  showStationCodes?: boolean
  skeleton?: boolean
}) {
  const originCode = stationPublicCode(origin, showStationCodes)
  const destCode = stationPublicCode(dest, showStationCodes)
  const originLabel = originCode ? `${origin.name} (${originCode})` : origin.name
  const destLabel = destCode ? `${dest.name} (${destCode})` : dest.name
  return (
    <div className="tickets-journey-heading">
      <OperatorsValidOn scheme={scheme} skeleton={skeleton} />
      <p className="tickets-results-route">
        <span className="tickets-results-route__station">{skelText(originLabel, skeleton)}</span>
        <span className="tickets-results-route__arrow" aria-hidden="true">
          →
        </span>
        <span className="tickets-results-route__station">{skelText(destLabel, skeleton)}</span>
      </p>
      <JourneyZonesLine originZone={origin.zone} destZone={dest.zone} skeleton={skeleton} />
    </div>
  )
}

function isMidlandsTrial(scheme: DPAYGScheme): boolean {
  return scheme.pricingModel === 'dynamic' || scheme.id === 'emr-midlands'
}

function FareDisclaimer({
  scheme,
  areaKind = 'trial',
  skeleton = false,
}: {
  scheme: DPAYGScheme
  areaKind?: 'trial' | 'payg'
  skeleton?: boolean
}) {
  if (areaKind === 'payg') return null
  let text = ESTIMATE_DISCLAIMER
  if (isMidlandsTrial(scheme)) {
    text = EMR_DYNAMIC_DISCLAIMER
  } else if (scheme.id === 'northern-shf-don') {
    text = SHEFFIELD_DONCASTER_DISCLAIMER
  }
  return <p className="tickets-results-disclaimer">{skelText(text, skeleton)}</p>
}

function TrialInfoSection({
  scheme,
  showOperators = false,
  showDisclaimer = true,
  areaKind = 'trial',
  skeleton = false,
}: {
  scheme: DPAYGScheme
  showOperators?: boolean
  showDisclaimer?: boolean
  areaKind?: 'trial' | 'payg'
  skeleton?: boolean
}) {
  return (
    <div className="tickets-trial-meta">
      {showOperators ? <OperatorsValidOn scheme={scheme} skeleton={skeleton} /> : null}
      {showDisclaimer ? (
        <FareDisclaimer scheme={scheme} areaKind={areaKind} skeleton={skeleton} />
      ) : null}
    </div>
  )
}

export function TicketFareCapsInline({
  scheme,
  zoneCapBands,
  journeyDailyCapPence,
  journeyWeeklyCapPence,
  skeleton = false,
}: {
  scheme: DPAYGScheme | null
  zoneCapBands?: PaygZoneCapBand[]
  journeyDailyCapPence?: number
  journeyWeeklyCapPence?: number
  skeleton?: boolean
}) {
  return (
    <CapsSubsection
      scheme={scheme}
      zoneCapBands={zoneCapBands}
      journeyDailyCapPence={journeyDailyCapPence}
      journeyWeeklyCapPence={journeyWeeklyCapPence}
      sectionTitle="Fare Caps"
      skeleton={skeleton}
    />
  )
}

function trialAreaHeading(scheme: DPAYGScheme | null, areaKind: 'trial' | 'payg'): string {
  if (!scheme) return areaKind === 'payg' ? 'PAYG Area' : 'D-PAYG Trial Area'
  const areaName = scheme.shortName || scheme.name
  return areaKind === 'payg' ? `${areaName} PAYG Area` : `${areaName} Trial Area`
}

const TicketFareResults: React.FC<TicketFareResultsProps> = ({
  scheme,
  origin,
  dest,
  fare,
  searched,
  loading: _loading = false,
  error,
  areaKind = 'trial',
  emptyIntro,
  showStationCodes = true,
  framed = true,
  skeleton = false,
  onViewRouteOnMap,
}) => {
  const pageTitle = trialAreaHeading(scheme, areaKind)
  const intro =
    emptyIntro ??
    'Enter origin and destination, then tap Find fares to see published single fares for that journey.'
  const missingCorridorCopy =
    areaKind === 'payg'
      ? 'Check the station name or CRS code matches a stop in this PAYG area.'
      : 'Check the station name or CRS code matches a stop in this trial corridor.'
  const noFareCopy = origin && dest
    ? areaKind === 'payg'
      ? `No published fare for ${origin.crs} → ${dest.crs} in this area.`
      : `No published fare for ${origin.crs} → ${dest.crs} in this trial.`
    : ''

  if (error && !searched) {
    return (
      <TicketFareCard framed={framed}>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading skeleton={skeleton} />
          <p className="tickets-results-error" role="alert">
            {skelText(error, skeleton)}
          </p>
        </div>
      </TicketFareCard>
    )
  }

  if (!searched) {
    return (
      <TicketFareCard framed={framed}>
        <div className="modal-section tickets-empty-state">
          {framed ? (
            <p className="tickets-results-muted tickets-empty-state__intro">
              {skelText(intro, skeleton)}
            </p>
          ) : null}
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading skeleton={skeleton} />
          {scheme ? (
            <div className="tickets-empty-state__meta">
              <OperatorsValidOn scheme={scheme} skeleton={skeleton} />
              {isMidlandsTrial(scheme) ? (
                <FareDisclaimer scheme={scheme} areaKind={areaKind} skeleton={skeleton} />
              ) : null}
            </div>
          ) : null}
        </div>
      </TicketFareCard>
    )
  }

  if (error) {
    return (
      <TicketFareCard framed={framed}>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading skeleton={skeleton} />
          <p className="tickets-results-error" role="alert">
            {skelText(error, skeleton)}
          </p>
          {scheme ? (
            <TrialInfoSection scheme={scheme} areaKind={areaKind} skeleton={skeleton} />
          ) : null}
        </div>
      </TicketFareCard>
    )
  }

  if (!scheme || !origin || !dest) {
    return (
      <TicketFareCard framed={framed}>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading skeleton={skeleton} />
          <p className="tickets-results-muted">{skelText(missingCorridorCopy, skeleton)}</p>
          {scheme ? (
            <TrialInfoSection scheme={scheme} areaKind={areaKind} skeleton={skeleton} />
          ) : null}
        </div>
      </TicketFareCard>
    )
  }

  if (isMidlandsTrial(scheme) && !fare) {
    return (
      <TicketFareCard framed={framed}>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading skeleton={skeleton} />
          <div className="tickets-results-header">
            <JourneyRouteHeading
              scheme={scheme}
              origin={origin}
              dest={dest}
              showStationCodes={showStationCodes}
              skeleton={skeleton}
            />
          </div>
          <ViewRouteOnMapButton onClick={onViewRouteOnMap} skeleton={skeleton} />
          <TrialInfoSection scheme={scheme} areaKind={areaKind} skeleton={skeleton} />
        </div>
      </TicketFareCard>
    )
  }

  if (!fare) {
    return (
      <TicketFareCard framed={framed}>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading skeleton={skeleton} />
          <div className="tickets-results-header">
            <JourneyRouteHeading
              scheme={scheme}
              origin={origin}
              dest={dest}
              showStationCodes={showStationCodes}
              skeleton={skeleton}
            />
            <p className="tickets-results-muted">{skelText(noFareCopy, skeleton)}</p>
          </div>
          <ViewRouteOnMapButton onClick={onViewRouteOnMap} skeleton={skeleton} />
          <TrialInfoSection scheme={scheme} areaKind={areaKind} skeleton={skeleton} />
        </div>
      </TicketFareCard>
    )
  }

  return (
    <TicketFareCard framed={framed}>
      <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading skeleton={skeleton} />
        <div className="tickets-results-header">
          <JourneyRouteHeading
            scheme={scheme}
            origin={origin}
            dest={dest}
            showStationCodes={showStationCodes}
            skeleton={skeleton}
          />
        </div>

        {fare.hasOffPeak === false ? (
          <StationDetailsSubsection title="Standard" skeleton={skeleton}>
            <StandardFareFields
              standardPence={fare.fares.peakStandardPence}
              railcardPence={fare.fares.peakRailcardEstPence}
              showRailcard={scheme.railcardEstimates}
              skeleton={skeleton}
            />
          </StationDetailsSubsection>
        ) : (
          <>
            <StationDetailsSubsection title="Peak" skeleton={skeleton}>
              <StandardFareFields
                standardPence={fare.fares.peakStandardPence}
                railcardPence={fare.fares.peakRailcardEstPence}
                showRailcard={scheme.railcardEstimates}
                skeleton={skeleton}
              />
            </StationDetailsSubsection>

            <StationDetailsSubsection title="Off-Peak" skeleton={skeleton}>
              <StandardFareFields
                standardPence={fare.fares.offPeakStandardPence}
                railcardPence={fare.fares.offPeakRailcardEstPence}
                showRailcard={scheme.railcardEstimates}
                skeleton={skeleton}
              />
            </StationDetailsSubsection>
          </>
        )}

        <ViewRouteOnMapButton onClick={onViewRouteOnMap} skeleton={skeleton} />
        <TrialInfoSection scheme={scheme} areaKind={areaKind} skeleton={skeleton} />
      </div>
    </TicketFareCard>
  )
}

export default TicketFareResults
