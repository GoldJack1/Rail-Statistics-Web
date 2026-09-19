'use client'

import React from 'react'
import '../StationCard/StationCard.css'

type UnitCatalogCardProps = {
  unitId: string
  fleetId: string
  subtitle: string
  onClick: () => void
}

const UnitCatalogCard: React.FC<UnitCatalogCardProps> = ({
  unitId,
  fleetId,
  subtitle,
  onClick,
}) => {
  return (
    <article className="rs-station-card-stack">
      <section
        className="rs-station-text-card"
        onClick={onClick}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onClick()
          }
        }}
        aria-label={`Open unit ${unitId}`}
      >
        <p className="rs-station-operator">Class {fleetId}</p>
        <h2 className="rs-station-name">{unitId}</h2>
        <p className="rs-station-location">{subtitle}</p>
      </section>
    </article>
  )
}

export default UnitCatalogCard
