'use client'

import { useParams } from 'next/navigation'
import React, { useCallback, useEffect, useMemo, useState } from 'react'

import { BUTWideButton } from '@/components/buttons'
import TOGToggleVisited from '@/components/buttons/toggle/TOGToggleVisited'
import { BackIcon } from '@/components/icons'
import { PageTopHeader } from '@/components/misc'
import TXTINPWideButton from '@/components/textInputs/plain/TXTINPWideButton'
import TXTINPWideButtonPrice from '@/components/textInputs/special/TXTINPWideButtonPrice'
import {
  cloneDpaygFares,
  cloneDpaygScheme,
  faresEqual,
  getScheme,
  listFares,
  publishSchemeAndFares,
  schemesEqual
} from '@/services/dpaygSchemes'
import type { DPAYGFare, DPAYGScheme, DPAYGStation } from '@/types/dpayg'
import { dpaygFareDocId, penceToPoundsInput, parseDpaygPoundsToPence } from '@/types/dpayg'
import { estimateRailcardPence } from '@/utils/dpaygRailcardEstimate'
import DpaygFaresEditor, { type FareAmountKey } from './DpaygFaresEditor'
import '../DpaygAdminPage.css'

const CapPenceField: React.FC<{
  id: string
  label: string
  pence: number
  onChange: (pence: number) => void
}> = ({ id, label, pence, onChange }) => {
  const [text, setText] = useState(() => penceToPoundsInput(pence))
  useEffect(() => {
    setText(penceToPoundsInput(pence))
  }, [pence])

  const commit = () => {
    const parsed = parseDpaygPoundsToPence(text)
    if (parsed == null) {
      setText(penceToPoundsInput(pence))
      return
    }
    setText(penceToPoundsInput(parsed))
    if (parsed !== pence) onChange(parsed)
  }

  return (
    <div className="dpayg-field">
      <span className="dpayg-field__label" id={`${id}-label`}>
        {label}
      </span>
      <TXTINPWideButtonPrice
        id={id}
        aria-labelledby={`${id}-label`}
        value={text}
        onChange={setText}
        onBlur={commit}
        onSubmit={commit}
        colorVariant="secondary"
        showClear={false}
      />
    </div>
  )
}

const DpaygSchemeEditorPage: React.FC = () => {
  const { schemeId: schemeIdParam } = useParams<{ schemeId?: string }>()
  const schemeId = typeof schemeIdParam === 'string' ? schemeIdParam : ''

  const [snapshotScheme, setSnapshotScheme] = useState<DPAYGScheme | null>(null)
  const [snapshotFares, setSnapshotFares] = useState<DPAYGFare[]>([])
  const [draftScheme, setDraftScheme] = useState<DPAYGScheme | null>(null)
  const [draftFares, setDraftFares] = useState<DPAYGFare[]>([])
  const [deletedFareIds, setDeletedFareIds] = useState<string[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)
  const [publishing, setPublishing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!schemeId) return
    setLoading(true)
    setError(null)
    try {
      const [scheme, fares] = await Promise.all([getScheme(schemeId), listFares(schemeId)])
      if (!scheme) {
        setError('Scheme not found.')
        setSnapshotScheme(null)
        setDraftScheme(null)
        setSnapshotFares([])
        setDraftFares([])
        return
      }
      setSnapshotScheme(cloneDpaygScheme(scheme))
      setDraftScheme(cloneDpaygScheme(scheme))
      setSnapshotFares(cloneDpaygFares(fares))
      setDraftFares(cloneDpaygFares(fares))
      setDeletedFareIds([])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load scheme.')
    } finally {
      setLoading(false)
    }
  }, [schemeId])

  useEffect(() => {
    setNotice(null)
    void load()
  }, [load])

  const snapshotById = useMemo(() => {
    const map = new Map<string, DPAYGFare>()
    for (const f of snapshotFares) map.set(f.id, f)
    return map
  }, [snapshotFares])

  const schemeDirty = useMemo(() => {
    if (!snapshotScheme || !draftScheme) return false
    return !schemesEqual(snapshotScheme, draftScheme)
  }, [snapshotScheme, draftScheme])

  const changedFareIds = useMemo(() => {
    const ids: string[] = []
    for (const fare of draftFares) {
      const snap = snapshotById.get(fare.id)
      if (!snap || !faresEqual(snap, fare)) ids.push(fare.id)
    }
    return ids
  }, [draftFares, snapshotById])

  const dirty = schemeDirty || changedFareIds.length > 0 || deletedFareIds.length > 0

  const patchScheme = (patch: Partial<DPAYGScheme>) => {
    setDraftScheme((prev) => (prev ? { ...prev, ...patch } : prev))
    setNotice(null)
  }

  const updateStation = (index: number, patch: Partial<DPAYGStation>) => {
    setDraftScheme((prev) => {
      if (!prev) return prev
      const stations = prev.stations.map((s, i) => (i === index ? { ...s, ...patch } : s))
      return { ...prev, stations }
    })
    setNotice(null)
  }

  const addStation = () => {
    setDraftScheme((prev) => {
      if (!prev) return prev
      return { ...prev, stations: [...prev.stations, { crs: '', name: '' }] }
    })
    setNotice(null)
  }

  const removeStation = (index: number) => {
    if (!draftScheme) return
    const station = draftScheme.stations[index]
    if (!station) return
    const crs = station.crs.trim().toUpperCase()
    if (crs) {
      const linked = draftFares.filter((f) => f.originCrs === crs || f.destCrs === crs)
      if (linked.length > 0) {
        const ok = window.confirm(
          `Remove ${station.name || crs}? ${linked.length} fare row(s) use this CRS. Delete those OD rows too?`
        )
        if (!ok) return
        const removeIds = new Set(linked.map((f) => f.id))
        setDraftFares((prev) => prev.filter((f) => !removeIds.has(f.id)))
        setDeletedFareIds((prev) => {
          const next = new Set(prev)
          for (const id of removeIds) {
            if (snapshotById.has(id)) next.add(id)
          }
          return Array.from(next)
        })
      }
    }
    setDraftScheme((prev) => {
      if (!prev) return prev
      return { ...prev, stations: prev.stations.filter((_, i) => i !== index) }
    })
    setNotice(null)
  }

  const updateOperator = (index: number, name: string) => {
    setDraftScheme((prev) => {
      if (!prev) return prev
      const operators = prev.operators.map((o, i) => (i === index ? { name } : o))
      return { ...prev, operators }
    })
    setNotice(null)
  }

  const addOperator = () => {
    setDraftScheme((prev) => {
      if (!prev) return prev
      return { ...prev, operators: [...prev.operators, { name: '' }] }
    })
    setNotice(null)
  }

  const removeOperator = (index: number) => {
    setDraftScheme((prev) => {
      if (!prev) return prev
      return { ...prev, operators: prev.operators.filter((_, i) => i !== index) }
    })
    setNotice(null)
  }

  const onFareAmountChange = (fareId: string, key: FareAmountKey, pence: number) => {
    setDraftFares((prev) =>
      prev.map((f) => (f.id === fareId ? { ...f, fares: { ...f.fares, [key]: pence } } : f))
    )
    setNotice(null)
  }

  const onDeleteFare = (fareId: string) => {
    const fare = draftFares.find((f) => f.id === fareId)
    if (!fare) return
    const ok = window.confirm(`Delete ${fare.originCrs} → ${fare.destCrs}?`)
    if (!ok) return
    setDraftFares((prev) => prev.filter((f) => f.id !== fareId))
    if (snapshotById.has(fareId)) {
      setDeletedFareIds((prev) => (prev.includes(fareId) ? prev : [...prev, fareId]))
    }
    setNotice(null)
  }

  const onRecalcRailcard = () => {
    const ok = window.confirm(
      'Recalculate Peak RC and Off-Peak RC for all rows from standard fares (⅔ + snap rule)?'
    )
    if (!ok) return
    setDraftFares((prev) =>
      prev.map((f) => ({
        ...f,
        fares: {
          ...f.fares,
          peakRailcardEstPence: estimateRailcardPence(f.fares.peakStandardPence),
          offPeakRailcardEstPence: estimateRailcardPence(f.fares.offPeakStandardPence)
        }
      }))
    )
    setNotice('Railcard estimates recalculated in draft — Publish to save.')
  }

  const discard = () => {
    if (!snapshotScheme) return
    if (dirty && !window.confirm('Discard unsaved changes?')) return
    setDraftScheme(cloneDpaygScheme(snapshotScheme))
    setDraftFares(cloneDpaygFares(snapshotFares))
    setDeletedFareIds([])
    setError(null)
    setNotice('Draft reset to last loaded snapshot.')
  }

  const publish = async () => {
    if (!draftScheme || !dirty) return
    setPublishing(true)
    setError(null)
    setNotice(null)
    try {
      const normalizedFares = draftFares.map((f) => {
        const origin = f.originCrs.trim().toUpperCase()
        const dest = f.destCrs.trim().toUpperCase()
        return {
          ...f,
          schemeId: draftScheme.id,
          originCrs: origin,
          destCrs: dest,
          id: dpaygFareDocId(draftScheme.id, origin, dest)
        }
      })

      await publishSchemeAndFares({
        scheme: {
          ...draftScheme,
          stations: draftScheme.stations.map((s) => ({
            crs: s.crs.trim().toUpperCase(),
            name: s.name.trim()
          })),
          operators: draftScheme.operators
            .map((o) => ({ name: o.name.trim() }))
            .filter((o) => o.name)
        },
        fares: normalizedFares,
        deletedFareIds,
        schemeChanged: schemeDirty,
        changedFareIds
      })

      setNotice('Published.')
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed.')
    } finally {
      setPublishing(false)
    }
  }

  const isDynamic = draftScheme?.pricingModel === 'dynamic'

  return (
    <div className="dpayg-admin-page-shell">
      <PageTopHeader
        title="D-PAYG"
        subtitle={draftScheme?.shortName || schemeId || 'Scheme'}
        actionButton={{
          to: '/admin/d-payg',
          label: 'Back',
          mode: 'iconText',
          icon: <BackIcon />
        }}
      />
      <div className="dpayg-admin-page">
        {error ? (
          <p className="dpayg-banner dpayg-banner--error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? <p className="dpayg-banner dpayg-banner--ok">{notice}</p> : null}

        {loading ? <p className="dpayg-muted">Loading…</p> : null}

        {!loading && draftScheme ? (
          <>
            <div className="dpayg-toolbar">
              <div className="dpayg-toolbar__title">
                <h1>{draftScheme.shortName || draftScheme.name}</h1>
                <span className={`dpayg-dirty-pill${dirty ? ' dpayg-dirty-pill--dirty' : ''}`}>
                  {dirty ? 'Unsaved changes' : 'Up to date'}
                </span>
              </div>
              <div className="dpayg-toolbar__actions">
                <BUTWideButton
                  width="hug"
                  colorVariant="secondary"
                  instantAction
                  disabled={!dirty || publishing}
                  onClick={discard}
                >
                  Discard
                </BUTWideButton>
                <BUTWideButton
                  width="hug"
                  colorVariant="green-action"
                  instantAction
                  disabled={!dirty || publishing}
                  onClick={() => void publish()}
                >
                  {publishing ? 'Publishing…' : 'Publish'}
                </BUTWideButton>
              </div>
            </div>

            <section className="dpayg-scheme-panel" aria-label="Scheme details">
              <div className="dpayg-scheme-section">
                <h2 className="dpayg-scheme-section__title">Basics</h2>
                <div className="dpayg-form-grid">
                  <div className="dpayg-field dpayg-field--full">
                    <span className="dpayg-field__label" id="dpayg-short-name-label">
                      Short name
                    </span>
                    <TXTINPWideButton
                      id="dpayg-short-name"
                      aria-labelledby="dpayg-short-name-label"
                      value={draftScheme.shortName}
                      onInputChange={(e) => patchScheme({ shortName: e.target.value })}
                      colorVariant="secondary"
                    />
                  </div>
                  <div className="dpayg-field dpayg-field--full">
                    <span className="dpayg-field__label" id="dpayg-pricing-note-label">
                      Pricing note
                    </span>
                    <TXTINPWideButton
                      id="dpayg-pricing-note"
                      aria-labelledby="dpayg-pricing-note-label"
                      value={draftScheme.pricingNote ?? ''}
                      onInputChange={(e) => patchScheme({ pricingNote: e.target.value })}
                      placeholder={
                        isDynamic ? 'Shown for dynamic schemes (e.g. EMR)' : undefined
                      }
                      colorVariant="secondary"
                    />
                  </div>
                  <div className="dpayg-field dpayg-field--full dpayg-field--toggle">
                    <span className="dpayg-field__label">Railcard estimates</span>
                    <TOGToggleVisited
                      checked={draftScheme.railcardEstimates}
                      onChange={(checked) => patchScheme({ railcardEstimates: checked })}
                      ariaLabel="Railcard estimates enabled"
                    />
                  </div>
                </div>
              </div>

              <div className="dpayg-scheme-section">
                <h2 className="dpayg-scheme-section__title">Caps</h2>
                <div className="dpayg-form-grid">
                  <CapPenceField
                    id="dpayg-daily-cap"
                    label="Daily amount"
                    pence={draftScheme.caps.dailyPence}
                    onChange={(dailyPence) =>
                      patchScheme({ caps: { ...draftScheme.caps, dailyPence } })
                    }
                  />
                  <CapPenceField
                    id="dpayg-weekly-cap"
                    label="Weekly amount"
                    pence={draftScheme.caps.weeklyPence}
                    onChange={(weeklyPence) =>
                      patchScheme({ caps: { ...draftScheme.caps, weeklyPence } })
                    }
                  />
                  <div className="dpayg-field dpayg-field--full">
                    <span className="dpayg-field__label" id="dpayg-daily-label-label">
                      Daily label
                    </span>
                    <TXTINPWideButton
                      id="dpayg-daily-label"
                      aria-labelledby="dpayg-daily-label-label"
                      value={draftScheme.caps.dailyLabel ?? ''}
                      onInputChange={(e) =>
                        patchScheme({
                          caps: { ...draftScheme.caps, dailyLabel: e.target.value }
                        })
                      }
                      colorVariant="secondary"
                    />
                  </div>
                  <div className="dpayg-field dpayg-field--full">
                    <span className="dpayg-field__label" id="dpayg-weekly-label-label">
                      Weekly label
                    </span>
                    <TXTINPWideButton
                      id="dpayg-weekly-label"
                      aria-labelledby="dpayg-weekly-label-label"
                      value={draftScheme.caps.weeklyLabel ?? ''}
                      onInputChange={(e) =>
                        patchScheme({
                          caps: { ...draftScheme.caps, weeklyLabel: e.target.value }
                        })
                      }
                      colorVariant="secondary"
                    />
                  </div>
                </div>
              </div>

              <div className="dpayg-scheme-section">
                <div className="dpayg-scheme-section__head">
                  <h2 className="dpayg-scheme-section__title">
                    Operators ({draftScheme.operators.length})
                  </h2>
                  <BUTWideButton width="hug" instantAction onClick={addOperator}>
                    Add operator
                  </BUTWideButton>
                </div>
                <div className="dpayg-field dpayg-field--full">
                  <span className="dpayg-field__label" id="dpayg-default-op-label">
                    Default operator
                  </span>
                  <TXTINPWideButton
                    id="dpayg-default-op"
                    aria-labelledby="dpayg-default-op-label"
                    value={draftScheme.defaultOperator}
                    onInputChange={(e) => patchScheme({ defaultOperator: e.target.value })}
                    colorVariant="secondary"
                  />
                </div>
                <div className="dpayg-list-rows">
                  {draftScheme.operators.length === 0 ? (
                    <p className="dpayg-muted">No operators yet.</p>
                  ) : null}
                  {draftScheme.operators.map((op, index) => (
                    <div className="dpayg-list-row" key={`op-${index}`}>
                      <TXTINPWideButton
                        value={op.name}
                        onInputChange={(e) => updateOperator(index, e.target.value)}
                        ariaLabel={`Operator ${index + 1}`}
                        colorVariant="secondary"
                      />
                      <BUTWideButton
                        width="hug"
                        colorVariant="red-action"
                        instantAction
                        onClick={() => removeOperator(index)}
                      >
                        Remove
                      </BUTWideButton>
                    </div>
                  ))}
                </div>
              </div>

              <div className="dpayg-scheme-section">
                <div className="dpayg-scheme-section__head">
                  <h2 className="dpayg-scheme-section__title">
                    Stations ({draftScheme.stations.length})
                  </h2>
                  <BUTWideButton width="hug" instantAction onClick={addStation}>
                    Add station
                  </BUTWideButton>
                </div>
                <div className="dpayg-list-rows">
                  {draftScheme.stations.length === 0 ? (
                    <p className="dpayg-muted">No stations yet.</p>
                  ) : null}
                  {draftScheme.stations.map((station, index) => (
                    <div className="dpayg-list-row dpayg-list-row--station" key={`stn-${index}`}>
                      <TXTINPWideButton
                        value={station.crs}
                        onInputChange={(e) =>
                          updateStation(index, { crs: e.target.value.toUpperCase() })
                        }
                        ariaLabel={`Station ${index + 1} CRS`}
                        placeholder="CRS"
                        maxLength={3}
                        uppercase
                        colorVariant="secondary"
                        className="dpayg-station-crs"
                      />
                      <TXTINPWideButton
                        value={station.name}
                        onInputChange={(e) => updateStation(index, { name: e.target.value })}
                        ariaLabel={`Station ${index + 1} name`}
                        placeholder="Name"
                        colorVariant="secondary"
                      />
                      <BUTWideButton
                        width="hug"
                        colorVariant="red-action"
                        instantAction
                        onClick={() => removeStation(index)}
                      >
                        Remove
                      </BUTWideButton>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            {isDynamic ? (
              <p className="dpayg-dynamic-note">
                This scheme uses dynamic in-app pricing
                {draftScheme.pricingNote ? ` — ${draftScheme.pricingNote}` : ''}. There is no
                published fare table to edit. Station, cap, and operator changes above can still be
                published.
              </p>
            ) : (
              <DpaygFaresEditor
                fares={draftFares}
                snapshotById={snapshotById}
                filter={filter}
                onFilterChange={setFilter}
                onFareAmountChange={onFareAmountChange}
                onDeleteFare={onDeleteFare}
                onRecalcRailcard={onRecalcRailcard}
                railcardEstimates={draftScheme.railcardEstimates}
              />
            )}
          </>
        ) : null}
      </div>
    </div>
  )
}

export default DpaygSchemeEditorPage
