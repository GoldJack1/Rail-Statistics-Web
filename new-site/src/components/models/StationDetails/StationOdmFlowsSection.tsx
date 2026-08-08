'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { BUTTabButton, BUTTwoButtonBar } from '../../buttons'
import { StationSectionTitle } from './StationSectionTitle'
import { getStationDetailsSectionIcon } from '../../../utils/stationDetailFieldIcons'
import { stationDetailsSubsectionId } from '@/utils/stationDetailsTabSubheaders'
import type { GbnrOdmDestination, GbnrOdmFlowsDoc } from '../../../services/gbnrOdmFlows'
import type { GbnrOdmFlowsState } from '../../../hooks/useGbnrOdmFlows'
import '../../cards/NetworkStationTabGroup/NetworkStationTabGroup.css'
import './StationUsageDataNotice.css'
import './StationOdmFlowsSection.css'
import AdSlot from '@/components/ads/AdSlot'

const ODM_SOURCE_HINT =
  'View the top and bottom 50 destinations by estimated journeys from this origin, using ORR Origin–Destination Matrix data.'

type OdmRangeId = 'top' | 'bottom'

function KnowledgebaseSourceHint({ label }: { label?: string | null }) {
  const text = label?.trim()
  if (!text) return null
  return <p className="edit-hint kb-source-hint">{text}</p>
}

function formatJourneys(value: number): string {
  return value.toLocaleString()
}

function OdmDestinationRows({
  rows,
  emptyLabel,
}: {
  rows: GbnrOdmDestination[]
  emptyLabel: string
}) {
  if (rows.length === 0) {
    return <p className="edit-hint">{emptyLabel}</p>
  }

  return (
    <ol className="station-odm-flows-list" aria-label="Destinations">
      {rows.map((row) => (
        <li key={`${row.rank}-${row.nlc}`} className="station-odm-flows-list__item">
          <span className="station-odm-flows-list__rank" aria-label={`Rank ${row.rank}`}>
            {row.rank}
          </span>
          <div className="station-odm-flows-list__body">
            <span className="station-odm-flows-list__dest">
              {row.crsCode ? (
                <span className="station-odm-flows-list__crs">({row.crsCode})</span>
              ) : null}
              <span className="station-odm-flows-list__name">{row.stationName || '—'}</span>
            </span>
            <span className="station-odm-flows-list__journeys">
              {formatJourneys(row.journeys)}
              <span className="station-odm-flows-list__journeys-label"> journeys</span>
            </span>
          </div>
        </li>
      ))}
    </ol>
  )
}

export type StationOdmFlowsSectionProps = {
  state: GbnrOdmFlowsState
}

export function StationOdmFlowsSection({ state }: StationOdmFlowsSectionProps) {
  const doc: GbnrOdmFlowsDoc | null = state.status === 'ready' ? state.doc : null
  const years = useMemo(
    () => (doc ? Object.keys(doc.years).sort((a, b) => parseInt(b, 10) - parseInt(a, 10)) : []),
    [doc]
  )
  const [selectedYear, setSelectedYear] = useState<string>('')
  const [selectedRange, setSelectedRange] = useState<OdmRangeId>('top')

  useEffect(() => {
    if (years.length === 0) {
      setSelectedYear('')
      return
    }
    setSelectedYear((prev) => (prev && years.includes(prev) ? prev : years[0]))
  }, [years])

  const yearBucket = doc && selectedYear ? doc.years[selectedYear] : null
  const rangeRows =
    yearBucket == null
      ? []
      : selectedRange === 'top'
        ? yearBucket.topDestinations
        : yearBucket.bottomDestinations
  const rangeEmptyLabel =
    selectedRange === 'top'
      ? 'No top destinations for this year.'
      : 'No bottom destinations for this year.'
  const rangeSubsectionTitle =
    selectedRange === 'top' ? 'Top 50 destinations' : 'Bottom 50 destinations'

  return (
    <div className="modal-section station-odm-flows">
      <StationSectionTitle
        title="Most & Least Popular destinations from this station"
        icon={getStationDetailsSectionIcon('usage')}
        pageHeading
      />

      {state.status === 'waiting_nlc' && (
        <p className="edit-hint">Waiting for NLC to match ODM destination flows…</p>
      )}
      {state.status === 'loading' && (
        <p className="edit-hint">Loading ODM destination flows…</p>
      )}
      {state.status === 'error' && <p className="edit-hint">{state.message}</p>}
      {state.status === 'not_found' && (
        <p className="edit-hint">No GBNR-ODM-FLOWS document for NLC {state.nlc}.</p>
      )}

      {state.status === 'ready' && doc && (
        <>
          {years.length > 0 ? (
            <div className="station-odm-flows-control">
              <p className="station-odm-flows-control__caption">Financial year</p>
              <div className="station-details-network-tabs-wrap">
                <div
                  className="network-station-tab-group station-usage-metric-tabs station-odm-flows-year-tabs"
                  role="tablist"
                  aria-label="ODM financial year"
                >
                  {years.map((year) => (
                    <BUTTabButton
                      key={year}
                      type="button"
                      width="hug"
                      role="tab"
                      pressed={selectedYear === year}
                      ariaSelected={selectedYear === year}
                      onClick={() => setSelectedYear(year)}
                    >
                      {year}
                    </BUTTabButton>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <p className="edit-hint">No yearly ODM data for this station.</p>
          )}

          {yearBucket && (
            <>
              <div className="station-odm-flows-control">
                <p className="station-odm-flows-control__caption">Destinations</p>
                <BUTTwoButtonBar
                  className="station-odm-flows-range-tabs"
                  colorVariant="primary"
                  selectedIndex={selectedRange === 'top' ? 0 : 1}
                  buttons={[
                    { label: 'Top 50', value: 'top' },
                    { label: 'Bottom 50', value: 'bottom' },
                  ]}
                  onChange={(index) => {
                    if (index === 0) setSelectedRange('top')
                    if (index === 1) setSelectedRange('bottom')
                  }}
                />
              </div>

              <div
                className="station-details-subsection station-odm-flows-range-panel"
                id={stationDetailsSubsectionId(rangeSubsectionTitle)}
              >
                <OdmDestinationRows rows={rangeRows} emptyLabel={rangeEmptyLabel} />
              </div>

              <p className="station-usage-data-notice">
                * ODM journey counts are estimates from ticket origin–destination pairs and will not
                match entries and exits totals above.
                <br />
                ** Year labels use the ending year of each April–March period (for example, 2025 =
                April 2024 to March 2025).
                <br />
                *** Bottom ranks often include many destinations tied at 1 journey.
              </p>
            </>
          )}
        </>
      )}
      <KnowledgebaseSourceHint label={ODM_SOURCE_HINT} />
      <AdSlot variant="section" className="rs-ad-slot--section-end" />
    </div>
  )
}

export default StationOdmFlowsSection
