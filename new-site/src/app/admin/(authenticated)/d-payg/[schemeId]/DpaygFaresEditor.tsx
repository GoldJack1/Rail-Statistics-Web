'use client'

import React, { useMemo } from 'react'
import { MagnifyingGlass } from '@phosphor-icons/react'

import TXTINPBUTIconWideButtonSearch from '@/components/textInputButtons/special/TXTINPBUTIconWideButtonSearch'
import TXTINPWideButtonPrice from '@/components/textInputs/special/TXTINPWideButtonPrice'
import type { DPAYGFare, DPAYGFareAmounts } from '@/types/dpayg'
import { parseDpaygPoundsToPence, penceToPoundsInput } from '@/types/dpayg'
import '@/components/cards/StationsTableView/StationsTableView.css'

export type FareAmountKey = keyof DPAYGFareAmounts

type DpaygFaresEditorProps = {
  fares: DPAYGFare[]
  snapshotById: Map<string, DPAYGFare>
  filter: string
  onFilterChange: (value: string) => void
  onFareAmountChange: (fareId: string, key: FareAmountKey, pence: number) => void
  onDeleteFare: (fareId: string) => void
  onRecalcRailcard: () => void
  railcardEstimates: boolean
}

const AMOUNT_COLUMNS: Array<{ key: FareAmountKey; label: string }> = [
  { key: 'peakStandardPence', label: 'Peak £' },
  { key: 'peakRailcardEstPence', label: 'Peak RC £' },
  { key: 'offPeakStandardPence', label: 'Off-Peak £' },
  { key: 'offPeakRailcardEstPence', label: 'Off-Peak RC £' }
]

function stationMatches(fare: DPAYGFare, needle: string): boolean {
  if (!needle) return true
  const n = needle.trim().toLowerCase()
  if (!n) return true
  const hay = [fare.originCrs, fare.destCrs, fare.originName, fare.destName]
    .join(' ')
    .toLowerCase()
  return hay.includes(n)
}

const FarePriceInput: React.FC<{
  valuePence: number
  dirty: boolean
  ariaLabel: string
  onCommit: (pence: number) => void
}> = ({ valuePence, dirty, ariaLabel, onCommit }) => {
  const [text, setText] = React.useState(() => penceToPoundsInput(valuePence))

  React.useEffect(() => {
    setText(penceToPoundsInput(valuePence))
  }, [valuePence])

  const commit = () => {
    const parsed = parseDpaygPoundsToPence(text)
    if (parsed == null) {
      setText(penceToPoundsInput(valuePence))
      return
    }
    setText(penceToPoundsInput(parsed))
    if (parsed !== valuePence) onCommit(parsed)
  }

  return (
    <TXTINPWideButtonPrice
      value={text}
      onChange={setText}
      onBlur={commit}
      onSubmit={commit}
      ariaLabel={ariaLabel}
      colorVariant="secondary"
      showClear={false}
      className={['dpayg-fare-price', dirty ? 'dpayg-fare-price--dirty' : '']
        .filter(Boolean)
        .join(' ')}
    />
  )
}

const DpaygFaresEditor: React.FC<DpaygFaresEditorProps> = ({
  fares,
  snapshotById,
  filter,
  onFilterChange,
  onFareAmountChange,
  onDeleteFare,
  onRecalcRailcard,
  railcardEstimates
}) => {
  const filtered = useMemo(
    () => fares.filter((f) => stationMatches(f, filter)),
    [fares, filter]
  )

  return (
    <section className="dpayg-fares-panel" aria-label="Fares table">
      <div className="dpayg-fares-panel__header">
        <h2>Fares</h2>
        <div className="dpayg-fares-toolbar">
          <TXTINPBUTIconWideButtonSearch
            id="dpayg-fares-search"
            icon={<MagnifyingGlass size={16} aria-hidden />}
            value={filter}
            onChange={onFilterChange}
            placeholder="Filter CRS / name…"
            className="dpayg-fares-search"
            colorVariant="secondary"
          />
          {railcardEstimates ? (
            <button type="button" className="dpayg-linkish" onClick={onRecalcRailcard}>
              Recalc RC estimates
            </button>
          ) : null}
        </div>
      </div>

      {filtered.length === 0 ? (
        <p className="dpayg-empty-fares">
          {fares.length === 0 ? 'No fare rows for this scheme.' : 'No fares match this filter.'}
        </p>
      ) : (
        <div className="stations-table-panel dpayg-fares-table-panel">
          <div className="stations-table-wrap stations-table-wrap--virtualized">
            <table className="stations-table">
              <thead>
                <tr>
                  <th scope="col">
                    <span className="stations-table__sort-button">Origin</span>
                  </th>
                  <th scope="col">
                    <span className="stations-table__sort-button">Dest</span>
                  </th>
                  {AMOUNT_COLUMNS.map((col) => (
                    <th key={col.key} scope="col">
                      <span className="stations-table__sort-button">{col.label}</span>
                    </th>
                  ))}
                  <th scope="col">
                    <span className="stations-table__sort-button"> </span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((fare, index) => {
                  const snap = snapshotById.get(fare.id)
                  const striped = index % 2 === 1
                  return (
                    <tr
                      key={fare.id}
                      className={[
                        'stations-table__row',
                        'dpayg-fares-table__row',
                        striped ? 'stations-table__row--striped' : ''
                      ]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      <td
                        className="stations-table__id"
                        title={`${fare.originName} (${fare.originCrs})`}
                      >
                        {fare.originCrs}
                      </td>
                      <td
                        className="stations-table__id"
                        title={`${fare.destName} (${fare.destCrs})`}
                      >
                        {fare.destCrs}
                      </td>
                      {AMOUNT_COLUMNS.map((col) => {
                        const dirty =
                          snap == null || snap.fares[col.key] !== fare.fares[col.key]
                        return (
                          <td key={col.key}>
                            <FarePriceInput
                              valuePence={fare.fares[col.key]}
                              dirty={dirty}
                              ariaLabel={`${fare.originCrs}→${fare.destCrs} ${col.label}`}
                              onCommit={(pence) => onFareAmountChange(fare.id, col.key, pence)}
                            />
                          </td>
                        )
                      })}
                      <td>
                        <button
                          type="button"
                          className="dpayg-linkish"
                          onClick={() => onDeleteFare(fare.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="dpayg-muted">
        Showing {filtered.length} of {fares.length} OD rows
      </p>
    </section>
  )
}

export default DpaygFaresEditor
