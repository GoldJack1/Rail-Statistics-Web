'use client'

import React from 'react'
import { Info, Star } from '@phosphor-icons/react'
import { BUTBaseButton as Button } from '../../buttons'
import VisitButton from '../../buttons/other/BUTVisitStatusButton'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import { getStationLocalData, upsertStationLocalData } from '@/services/stationDiaryStore'
import './StationCardActionBar.css'

interface StationCardActionBarProps {
  onInfoClick: () => void
  disabled?: boolean
  stationId?: string
  stnarea?: string
}

const StationCardActionBar: React.FC<StationCardActionBarProps> = ({
  onInfoClick,
  disabled = false,
  stationId,
  stnarea = '',
}) => {
  const { user, vaultUnlocked, diaryRevision, noteDiaryChanged } = useConsumerAuth()
  const liveMode = Boolean(user && vaultUnlocked && stationId)

  // Read diary whenever auth/diary revision changes (avoid stale memoized visit state).
  const local = liveMode && stationId ? getStationLocalData(stationId, stnarea) : null
  void diaryRevision

  const isVisited = Boolean(local?.isVisited)
  const isFavorite = Boolean(local?.isFavorite)
  const visitDate = local?.visitedDates?.[local.visitedDates.length - 1]

  const StarIcon = (
    <Star size={16} weight={isFavorite ? 'fill' : 'regular'} aria-hidden />
  )

  const InfoIcon = <Info size={16} weight="regular" aria-hidden />

  return (
    <section
      className="rs-station-card-action-bar"
      aria-label="Station card actions"
      onClick={(event) => event.stopPropagation()}
    >
      <VisitButton
        visited={isVisited}
        date={isVisited && visitDate ? visitDate.slice(0, 10) : undefined}
        onToggle={() => {
          if (!liveMode || !stationId) return
          upsertStationLocalData(stationId, stnarea, { isVisited: !isVisited })
          noteDiaryChanged()
        }}
        disabled={!liveMode || disabled}
        className="rs-station-card-action-bar__visit"
      />
      <Button
        variant="square"
        shape="squared"
        width="hug"
        colorVariant={isFavorite ? 'fav-action' : 'primary'}
        ariaLabel={isFavorite ? 'Remove favorite' : 'Add favorite'}
        icon={StarIcon}
        disabled={!liveMode || disabled}
        onClick={(event) => {
          event.stopPropagation()
          if (!liveMode || !stationId) return
          upsertStationLocalData(stationId, stnarea, { isFavorite: !isFavorite })
          noteDiaryChanged()
        }}
      />
      <Button
        variant="square"
        shape="squared"
        width="hug"
        colorVariant="primary"
        ariaLabel="View station details"
        icon={InfoIcon}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation()
          onInfoClick()
        }}
      />
    </section>
  )
}

export default StationCardActionBar
