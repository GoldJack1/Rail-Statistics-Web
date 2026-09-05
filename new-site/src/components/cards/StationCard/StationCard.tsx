'use client'

import React from 'react'
import type { Station } from '../../../types'
import StationCardActionBar from '../StationCardActionBar/StationCardActionBar'
import './StationCard.css'

interface StationCardProps {
  station: Station
  locationDisplay: string
  onCardClick: () => void
  onInfoClick: () => void
  /** Reserve SuperTram line-strip height so mixed All-tab grids align. */
  reserveLineStripSpace?: boolean
  /** When Show Date Opened is on, grow the line-strip spacer by 10px to match light-rail cards. */
  reserveOpenedOnSpace?: boolean
  /** Disable detail actions when a card is displaying placeholder data. */
  actionsDisabled?: boolean
}

const StationCard: React.FC<StationCardProps> = ({
  station,
  locationDisplay,
  onCardClick,
  onInfoClick,
  reserveLineStripSpace = false,
  reserveOpenedOnSpace = false,
  actionsDisabled = false,
}) => {
  return (
    <article className="rs-station-card-stack">
      <section
        className={[
          'rs-station-text-card',
          reserveLineStripSpace ? 'rs-station-text-card--line-strip-space' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        onClick={onCardClick}
      >
        <p className="rs-station-operator">{station.toc || 'Unknown Operator'}</p>
        <h2 className="rs-station-name">{station.stationName || 'Unknown Station'}</h2>
        <p className="rs-station-location">{locationDisplay}</p>
        {reserveLineStripSpace ? (
          <div
            className={[
              'rs-station-line-strip-spacer',
              reserveOpenedOnSpace ? 'rs-station-line-strip-spacer--with-opened-on' : '',
            ]
              .filter(Boolean)
              .join(' ')}
            aria-hidden="true"
          />
        ) : null}
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

export default StationCard
