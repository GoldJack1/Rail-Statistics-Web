'use client'

import React, { useEffect, useMemo, useState } from 'react'

import { BUTWideButton } from '@/components/buttons'
import BUTBaseButton from '@/components/buttons/base/BUTBaseButton/BUTBaseButton'
import TXTINPBUTBaseButton from '@/components/textInputButtons/base/TXTINPBUTBaseButton/TXTINPBUTBaseButton'
import TXTINPBUTLabelTopRoundedButton from '@/components/textInputButtons/label/TXTINPBUTLabelTopRoundedButton'
import { TextSkeletonLine } from '@/components/misc/Skeleton/TextSkeletonLine'
import type { DPAYGScheme, DPAYGStation } from '@/types/dpayg'
import { formatPaygZoneLabel } from '@/services/paygMatrixParse'
import { filterDpaygStations, stationPublicCode, stationSearchLabel } from '@/utils/dpaygStationSearch'

type TicketsFareSearchFormProps = {
  scheme: Pick<DPAYGScheme, 'stations'> | null
  originQuery: string
  destQuery: string
  onOriginQueryChange: (value: string) => void
  onDestQueryChange: (value: string) => void
  onSearch: () => void
  searchDisabled?: boolean
  onPickStation: (field: 'origin' | 'dest', station: DPAYGStation) => void
  showStationCodes?: boolean
  skeleton?: boolean
}

type ActiveField = 'origin' | 'dest'

const SUGGESTION_ROW_HEIGHT_PX = 40
const MAX_VISIBLE_SUGGESTIONS = 12
const DEST_SUGGESTION_SHADOW_PAD_PX = 8

function stationPickLabel(station: DPAYGStation, showStationCodes: boolean): string {
  return stationSearchLabel(station, showStationCodes)
}

function suggestionStations(
  stations: DPAYGStation[],
  query: string,
  showStationCodes: boolean
): DPAYGStation[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const matches = filterDpaygStations(stations, trimmed).slice(0, MAX_VISIBLE_SUGGESTIONS)
  if (matches.length === 1 && stationPickLabel(matches[0]!, showStationCodes) === trimmed) {
    return []
  }
  return matches
}

function StationSuggestionPanel({
  field,
  open,
  stations,
  roundLast = false,
  showStationCodes = true,
  onPickStation,
  onOpenChange,
}: {
  field: ActiveField
  open: boolean
  stations: DPAYGStation[]
  roundLast?: boolean
  showStationCodes?: boolean
  onPickStation: (field: ActiveField, station: DPAYGStation) => void
  onOpenChange?: (open: boolean) => void
}) {
  const [renderedStations, setRenderedStations] = useState<DPAYGStation[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (open && stations.length > 0) {
      setRenderedStations(stations)
    }
  }, [open, stations])

  useEffect(() => {
    if (open) {
      setIsClosing(false)
      setIsOpen(false)
      let raf2 = 0
      const raf1 = window.requestAnimationFrame(() => {
        raf2 = window.requestAnimationFrame(() => setIsOpen(true))
      })
      return () => {
        window.cancelAnimationFrame(raf1)
        window.cancelAnimationFrame(raf2)
      }
    }

    setIsOpen((currentlyOpen) => {
      if (currentlyOpen) {
        setIsClosing(true)
      } else {
        setRenderedStations([])
        setIsClosing(false)
      }
      return false
    })
  }, [open])

  const isPanelVisible = isOpen || isClosing || renderedStations.length > 0

  useEffect(() => {
    onOpenChange?.(isPanelVisible && (isOpen || isClosing))
  }, [isPanelVisible, isOpen, isClosing, onOpenChange])

  const handleTransitionEnd = (event: React.TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    if (event.propertyName !== 'max-height') return
    if (!isOpen) {
      setIsClosing(false)
      setRenderedStations([])
    }
  }

  if (!isPanelVisible) return null

  const rowCount = Math.min(Math.max(renderedStations.length, 1), MAX_VISIBLE_SUGGESTIONS)
  const shadowPad = roundLast ? DEST_SUGGESTION_SHADOW_PAD_PX : 0
  const panelMaxHeight = isOpen
    ? `${rowCount * SUGGESTION_ROW_HEIGHT_PX + shadowPad}px`
    : '0px'

  return (
    <div
      className={[
        'tickets-station-suggestions-panel',
        isOpen ? 'tickets-station-suggestions-panel--open' : '',
        roundLast ? 'tickets-station-suggestions-panel--dest' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ maxHeight: panelMaxHeight }}
      onTransitionEnd={handleTransitionEnd}
    >
      <div
        className="tickets-station-suggestions"
        role="listbox"
        aria-label={field === 'origin' ? 'Origin suggestions' : 'Destination suggestions'}
      >
        {renderedStations.map((station, index) => {
          const isLast = index === renderedStations.length - 1
          const shape = roundLast && isLast ? 'bottom-rounded' : 'squared'
          return (
            <BUTBaseButton
              key={`${field}-${station.crs}`}
              type="button"
              variant="wide"
              width="fill"
              shape={shape}
              colorVariant="primary"
              instantAction
              className="tickets-station-suggestion"
              ariaLabel={stationSearchLabel(station, showStationCodes)}
              onClick={() => onPickStation(field, station)}
            >
              <span className="tickets-station-suggestion__label">
                <span className="tickets-station-suggestion__name">{station.name}</span>
                {stationPublicCode(station, showStationCodes) ? (
                  <span className="tickets-station-suggestion__crs">
                    {stationPublicCode(station, showStationCodes)}
                  </span>
                ) : null}
                {station.zone ? (
                  <span className="tickets-station-suggestion__zone">
                    {formatPaygZoneLabel(station.zone)}
                  </span>
                ) : null}
              </span>
            </BUTBaseButton>
          )
        })}
      </div>
    </div>
  )
}

const TicketsFareSearchForm: React.FC<TicketsFareSearchFormProps> = ({
  scheme,
  originQuery,
  destQuery,
  onOriginQueryChange,
  onDestQueryChange,
  onSearch,
  searchDisabled = false,
  onPickStation,
  showStationCodes = true,
  skeleton = false,
}) => {
  const [activeField, setActiveField] = useState<ActiveField>('origin')
  const [destPanelExpanded, setDestPanelExpanded] = useState(false)

  const originSuggestions = useMemo(() => {
    if (!scheme || activeField !== 'origin') return []
    return suggestionStations(scheme.stations, originQuery, showStationCodes)
  }, [scheme, activeField, originQuery, showStationCodes])

  const destSuggestions = useMemo(() => {
    if (!scheme || activeField !== 'dest') return []
    return suggestionStations(scheme.stations, destQuery, showStationCodes)
  }, [scheme, activeField, destQuery, showStationCodes])

  const toInputShape = destPanelExpanded ? 'squared' : 'bottom-rounded'

  return (
    <form
      className="tickets-search-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSearch()
      }}
    >
      <div className="tickets-od-stack">
        <TXTINPBUTLabelTopRoundedButton
          label="From:"
          colorVariant="primary"
          className="tickets-od-input"
          value={originQuery}
          onChange={(value) => {
            setActiveField('origin')
            onOriginQueryChange(value)
          }}
          onFocus={() => setActiveField('origin')}
          placeholder="Origin station or CRS"
          ariaLabel="Origin station"
          disabled={skeleton}
          skeleton={skeleton}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          showClear
        />

        <StationSuggestionPanel
          field="origin"
          open={!skeleton && originSuggestions.length > 0}
          stations={originSuggestions}
          showStationCodes={showStationCodes}
          onPickStation={onPickStation}
        />

        <TXTINPBUTBaseButton
          shape={toInputShape}
          prefixType="label"
          label="To:"
          colorVariant="primary"
          className="tickets-od-input"
          value={destQuery}
          onChange={(value) => {
            setActiveField('dest')
            onDestQueryChange(value)
          }}
          onFocus={() => setActiveField('dest')}
          placeholder="Destination station or CRS"
          ariaLabel="Destination station"
          disabled={skeleton}
          skeleton={skeleton}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          showClear
          onSubmit={onSearch}
        />

        <StationSuggestionPanel
          field="dest"
          open={!skeleton && destSuggestions.length > 0}
          stations={destSuggestions}
          roundLast
          showStationCodes={showStationCodes}
          onPickStation={onPickStation}
          onOpenChange={setDestPanelExpanded}
        />
      </div>

      <BUTWideButton
        type="submit"
        width="fill"
        colorVariant="accent"
        instantAction
        disabled={searchDisabled || skeleton}
        className="tickets-search-button"
      >
        {skeleton ? <TextSkeletonLine>Find fares</TextSkeletonLine> : 'Find fares'}
      </BUTWideButton>
    </form>
  )
}

export default TicketsFareSearchForm
