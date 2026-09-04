'use client'

import React from 'react'
import { Ticket } from '@phosphor-icons/react'

import { StationDetailField } from '@/components/models/StationDetails/StationDetailField'
import { StationDetailsSubsection } from '@/components/models/StationDetails/StationDetailsSubsection'
import { StationSectionTitle } from '@/components/models/StationDetails/StationSectionTitle'
import type { DPAYGFare, DPAYGScheme, DPAYGStation } from '@/types/dpayg'
import { formatDpaygPence } from '@/types/dpayg'
import '@/components/models/StationModal/StationModal.css'

const ESTIMATE_DISCLAIMER =
  'Please note that the prices shown below are only estimates of what a journey may actually cost. This is because fares for some areas are not publicly available.'

const SHEFFIELD_DONCASTER_DISCLAIMER =
  'Please note that railcard prices may not be exact, but the amounts shown are a rough guide to what a journey may cost.'

const EMR_DYNAMIC_DISCLAIMER =
  'Fares on the Derby/Nottingham to Leicester trial are dynamic and can change. After you tap Start Journey in the EMR app, check the live prices for the most accurate cost.'

type TicketFareResultsProps = {
  scheme: DPAYGScheme | null
  origin: DPAYGStation | null
  dest: DPAYGStation | null
  fare: DPAYGFare | null
  searched: boolean
  /** True while a fare document lookup is in flight — do not show “not found” yet. */
  loading?: boolean
  error?: string | null
}

function TicketFareCard({ children }: { children: React.ReactNode }) {
  return (
    <main className="stations-main station-details-main tickets-main">
      <section className="station-details-card modal-content">
        <div className="modal-body station-details-visible-body">{children}</div>
      </section>
    </main>
  )
}

function CapsSubsection({ scheme }: { scheme?: DPAYGScheme | null }) {
  if (!scheme) return null

  return (
    <StationDetailsSubsection title="Caps">
      <div className="modal-details-grid modal-facilities-grid">
        <StationDetailField
          label="Daily"
          value={formatDpaygPence(scheme.caps.dailyPence)}
        />
        <StationDetailField
          label="Weekly"
          value={formatDpaygPence(scheme.caps.weeklyPence)}
        />
      </div>
    </StationDetailsSubsection>
  )
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

function OperatorsValidOn({ scheme }: { scheme?: DPAYGScheme | null }) {
  if (!scheme) return null
  const operatorsLabel = operatorsValidOnLabel(scheme)
  if (!operatorsLabel) return null
  return (
    <p className="tickets-trial-meta__operators">
      Operators valid on: {operatorsLabel}
    </p>
  )
}

function JourneyRouteHeading({
  scheme,
  origin,
  dest,
}: {
  scheme: DPAYGScheme
  origin: DPAYGStation
  dest: DPAYGStation
}) {
  return (
    <div className="tickets-journey-heading">
      <OperatorsValidOn scheme={scheme} />
      <p className="tickets-results-route">
        <span className="tickets-results-route__station">
          {origin.name}{' '}
          <span className="tickets-results-route__crs">({origin.crs})</span>
        </span>
        <span className="tickets-results-route__arrow" aria-hidden="true">
          →
        </span>
        <span className="tickets-results-route__station">
          {dest.name}{' '}
          <span className="tickets-results-route__crs">({dest.crs})</span>
        </span>
      </p>
    </div>
  )
}

function isMidlandsTrial(scheme: DPAYGScheme): boolean {
  return scheme.pricingModel === 'dynamic' || scheme.id === 'emr-midlands'
}

function FareDisclaimer({ scheme }: { scheme: DPAYGScheme }) {
  let text = ESTIMATE_DISCLAIMER
  if (isMidlandsTrial(scheme)) {
    text = EMR_DYNAMIC_DISCLAIMER
  } else if (scheme.id === 'northern-shf-don') {
    text = SHEFFIELD_DONCASTER_DISCLAIMER
  }
  return <p className="tickets-results-disclaimer">{text}</p>
}

function TrialInfoSection({
  scheme,
  showOperators = false,
  showDisclaimer = true,
}: {
  scheme: DPAYGScheme
  showOperators?: boolean
  showDisclaimer?: boolean
}) {
  return (
    <div className="tickets-trial-meta">
      {showOperators ? <OperatorsValidOn scheme={scheme} /> : null}
      {showDisclaimer ? <FareDisclaimer scheme={scheme} /> : null}
      <CapsSubsection scheme={scheme} />
    </div>
  )
}

function trialAreaHeading(scheme: DPAYGScheme | null): string {
  if (!scheme) return 'D-PAYG Trial Area'
  const areaName = scheme.shortName || scheme.name
  return `${areaName} Trial Area`
}

const TicketFareResults: React.FC<TicketFareResultsProps> = ({
  scheme,
  origin,
  dest,
  fare,
  searched,
  loading = false,
  error,
}) => {
  const pageTitle = trialAreaHeading(scheme)

  if (error && !searched) {
    return (
      <TicketFareCard>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading />
          <p className="tickets-results-error" role="alert">
            {error}
          </p>
        </div>
      </TicketFareCard>
    )
  }

  if (!searched) {
    return (
      <TicketFareCard>
        <div className="modal-section tickets-empty-state">
          <p className="tickets-results-muted tickets-empty-state__intro">
            Choose a trial area, enter origin and destination, then tap Find fares to see
            published single fares for that journey.
          </p>
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading />
          {scheme ? (
            <div className="tickets-empty-state__meta">
              <OperatorsValidOn scheme={scheme} />
              {isMidlandsTrial(scheme) ? <FareDisclaimer scheme={scheme} /> : null}
              <CapsSubsection scheme={scheme} />
            </div>
          ) : null}
        </div>
      </TicketFareCard>
    )
  }

  if (error) {
    return (
      <TicketFareCard>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading />
          <p className="tickets-results-error" role="alert">
            {error}
          </p>
          {scheme ? <TrialInfoSection scheme={scheme} /> : null}
        </div>
      </TicketFareCard>
    )
  }

  if (!scheme || !origin || !dest) {
    return (
      <TicketFareCard>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading />
          <p className="tickets-results-muted">
            Check the station name or CRS code matches a stop in this trial corridor.
          </p>
          {scheme ? <TrialInfoSection scheme={scheme} /> : null}
        </div>
      </TicketFareCard>
    )
  }

  if (loading && !fare) {
    return (
      <TicketFareCard>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading />
          <div className="tickets-results-header">
            <JourneyRouteHeading scheme={scheme} origin={origin} dest={dest} />
            <p className="tickets-results-muted" aria-live="polite">
              Looking up fare…
            </p>
          </div>
        </div>
      </TicketFareCard>
    )
  }

  if (isMidlandsTrial(scheme) && !fare) {
    return (
      <TicketFareCard>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading />
          <div className="tickets-results-header">
            <JourneyRouteHeading scheme={scheme} origin={origin} dest={dest} />
          </div>
          <TrialInfoSection scheme={scheme} />
        </div>
      </TicketFareCard>
    )
  }

  if (!fare) {
    return (
      <TicketFareCard>
        <div className="modal-section">
          <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading />
          <div className="tickets-results-header">
            <JourneyRouteHeading scheme={scheme} origin={origin} dest={dest} />
            <p className="tickets-results-muted">
              No published fare for {origin.crs} → {dest.crs} in this trial.
            </p>
          </div>
          <TrialInfoSection scheme={scheme} />
        </div>
      </TicketFareCard>
    )
  }

  return (
    <TicketFareCard>
      <div className="modal-section">
        <StationSectionTitle title={pageTitle} icon={Ticket} pageHeading />
        <div className="tickets-results-header">
          <JourneyRouteHeading scheme={scheme} origin={origin} dest={dest} />
        </div>

        <StationDetailsSubsection title="Peak">
          <div className="modal-details-grid modal-facilities-grid">
            <StationDetailField
              label="Standard single"
              value={formatDpaygPence(fare.fares.peakStandardPence)}
            />
            {scheme.railcardEstimates ? (
              <StationDetailField
                label="Railcard"
                value={formatDpaygPence(fare.fares.peakRailcardEstPence)}
              />
            ) : null}
          </div>
        </StationDetailsSubsection>

        <StationDetailsSubsection title="Off-Peak">
          <div className="modal-details-grid modal-facilities-grid">
            <StationDetailField
              label="Standard single"
              value={formatDpaygPence(fare.fares.offPeakStandardPence)}
            />
            {scheme.railcardEstimates ? (
              <StationDetailField
                label="Railcard"
                value={formatDpaygPence(fare.fares.offPeakRailcardEstPence)}
              />
            ) : null}
          </div>
        </StationDetailsSubsection>

        <TrialInfoSection scheme={scheme} />
      </div>
    </TicketFareCard>
  )
}

export default TicketFareResults
