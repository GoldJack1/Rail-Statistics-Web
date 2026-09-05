'use client'

import React from 'react'
import type { Station } from '../../../types'
import { NETWORK_LABELS } from '../../../constants/stationCollections'
import { LIGHTRAIL_COLLECTION_ID } from '../../../utils/lightRailStationFields'
import { formatLightRailOpenedOnLabel } from '../../../utils/lightRailOpenedOnLabel'
import { LightRailLineStrip } from '../../chips/LightRailLineStrip'
import StationCardActionBar from '../StationCardActionBar/StationCardActionBar'
import '../StationCard/StationCard.css'
import './LightRailStopCard.css'

interface LightRailStopCardProps {
  station: Station
  locationDisplay: string
  onCardClick: () => void
  onInfoClick: () => void
  showOpenedOn?: boolean
  /** When true, appends `(order)` after the opened-on date (admin-only). */
  showOrderOfOpening?: boolean
  /** Disable detail actions when a card is displaying placeholder data. */
  actionsDisabled?: boolean
}

const LightRailStopCard: React.FC<LightRailStopCardProps> = ({
  station,
  locationDisplay,
  onCardClick,
  onInfoClick,
  showOpenedOn = false,
  showOrderOfOpening = false,
  actionsDisabled = false,
}) => {
  const operatorLabel = station.toc || NETWORK_LABELS[LIGHTRAIL_COLLECTION_ID]
  const openedOnLabel = showOpenedOn
    ? formatLightRailOpenedOnLabel(station, { includeOrderOfOpening: showOrderOfOpening })
    : null

  return (
    <article className="rs-station-card-stack rs-station-card-stack--light-rail">
      <section className="rs-station-text-card rs-station-text-card--light-rail" onClick={onCardClick}>
        {openedOnLabel ? <p className="rs-station-opened-on">{openedOnLabel}</p> : null}
        <h2 className="rs-station-name">{station.stationName || 'Unknown Stop'}</h2>
        <p className="rs-station-location">{locationDisplay}</p>
        {!openedOnLabel ? (
          <p
            className="rs-station-operator rs-station-operator--light-rail-hidden"
            aria-hidden="true"
          >
            {operatorLabel}
          </p>
        ) : (
          <div className="rs-station-light-rail-opened-on-spacer" aria-hidden="true" />
        )}
        <LightRailLineStrip linesServed={station.linesServed} />
      </section>
      <StationCardActionBar
        onInfoClick={onInfoClick}
        disabled={actionsDisabled}
        stationId={station.id}
        stnarea={station.stnarea ?? ''}
      />
    </article>
  )
}

export default LightRailStopCard
