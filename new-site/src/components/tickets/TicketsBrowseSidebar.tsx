'use client'

import React, { useEffect, useMemo, useState } from 'react'

import { BUTWideButton } from '@/components/buttons'
import BUTBaseButton from '@/components/buttons/base/BUTBaseButton/BUTBaseButton'
import SidebarDropdownSection from '@/components/misc/SidebarDropdownSection/SidebarDropdownSection'
import { SidebarPanel } from '@/components/misc/SidebarPanel'
import TXTINPBUTBaseButton from '@/components/textInputButtons/base/TXTINPBUTBaseButton/TXTINPBUTBaseButton'
import TXTINPBUTLabelTopRoundedButton from '@/components/textInputButtons/label/TXTINPBUTLabelTopRoundedButton'
import type { DPAYGScheme, DPAYGStation } from '@/types/dpayg'
import { filterDpaygStations } from '@/utils/dpaygStationSearch'

type TicketsBrowseSidebarProps = {
  scheme: DPAYGScheme | null
  collapsed?: boolean
  originQuery: string
  destQuery: string
  onOriginQueryChange: (value: string) => void
  onDestQueryChange: (value: string) => void
  onSearch: () => void
  searchDisabled?: boolean
  onPickStation: (field: 'origin' | 'dest', station: DPAYGStation) => void
}

type ActiveField = 'origin' | 'dest'

const SUGGESTION_ROW_HEIGHT_PX = 40
const MAX_VISIBLE_SUGGESTIONS = 8
/** Bottom pad on destination suggestions so the last row’s drop shadow isn’t clipped. */
const DEST_SUGGESTION_SHADOW_PAD_PX = 8

function stationPickLabel(station: DPAYGStation): string {
  return `${station.name} (${station.crs})`
}

function suggestionStations(stations: DPAYGStation[], query: string): DPAYGStation[] {
  const trimmed = query.trim()
  if (!trimmed) return []
  const matches = filterDpaygStations(stations, trimmed).slice(0, MAX_VISIBLE_SUGGESTIONS)
  if (matches.length === 1 && stationPickLabel(matches[0]!) === trimmed) return []
  return matches
}

/** Accordion panel — same max-height / opacity motion as BUTDDM list panels. */
function StationSuggestionPanel({
  field,
  open,
  stations,
  roundLast = false,
  onPickStation,
  onOpenChange,
}: {
  field: ActiveField
  open: boolean
  stations: DPAYGStation[]
  /** When true, the last visible row uses bottom-rounded corners (DDM footer style). */
  roundLast?: boolean
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
              ariaLabel={`${station.name} ${station.crs}`}
              onClick={() => onPickStation(field, station)}
            >
              <span className="tickets-station-suggestion__label">
                <span className="tickets-station-suggestion__name">{station.name}</span>
                <span className="tickets-station-suggestion__crs">{station.crs}</span>
              </span>
            </BUTBaseButton>
          )
        })}
      </div>
    </div>
  )
}

const TicketsBrowseSidebar: React.FC<TicketsBrowseSidebarProps> = ({
  scheme,
  collapsed = false,
  originQuery,
  destQuery,
  onOriginQueryChange,
  onDestQueryChange,
  onSearch,
  searchDisabled = false,
  onPickStation,
}) => {
  const [journeyExpanded, setJourneyExpanded] = useState(true)
  const [activeField, setActiveField] = useState<ActiveField>('origin')
  const [destPanelExpanded, setDestPanelExpanded] = useState(false)

  const originSuggestions = useMemo(() => {
    if (!scheme || activeField !== 'origin') return []
    return suggestionStations(scheme.stations, originQuery)
  }, [scheme, activeField, originQuery])

  const destSuggestions = useMemo(() => {
    if (!scheme || activeField !== 'dest') return []
    return suggestionStations(scheme.stations, destQuery)
  }, [scheme, activeField, destQuery])

  const toInputShape = destPanelExpanded ? 'squared' : 'bottom-rounded'

  return (
    <aside
      className="stations-sidebar"
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      <SidebarPanel className="stations-sidebar-panel">
        <SidebarDropdownSection
          title="Journey"
          expanded={journeyExpanded}
          onExpandedChange={setJourneyExpanded}
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
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              showClear
            />

            <StationSuggestionPanel
              field="origin"
              open={originSuggestions.length > 0}
              stations={originSuggestions}
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
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              showClear
              onSubmit={onSearch}
            />

            <StationSuggestionPanel
              field="dest"
              open={destSuggestions.length > 0}
              stations={destSuggestions}
              roundLast
              onPickStation={onPickStation}
              onOpenChange={setDestPanelExpanded}
            />
          </div>

          <BUTWideButton
            width="fill"
            colorVariant="accent"
            instantAction
            disabled={searchDisabled}
            onClick={onSearch}
            className="tickets-search-button"
          >
            Find fares
          </BUTWideButton>
        </SidebarDropdownSection>
      </SidebarPanel>
    </aside>
  )
}

export default TicketsBrowseSidebar
