'use client'

import React, { useEffect, useMemo, useState } from 'react'
import type {
  CoachLoadingValue,
  ConsistData,
  FormationCoach,
  FormationData,
  PtacVehicle,
  ServiceStop,
} from '../../../types/darwin'
import { BUTOperatorChip } from '../../buttons'
import BUTDDMList from '../../buttons/ddm/BUTDDMList'
import {
  coachLoadFill,
  coachLoadingIsPercent,
  formatCoachLoad,
} from '../../../utils/darwinCoachLoading'
import './CarriageMap.css'

const SHOW_ALL_STOPS = '__all__'

/**
 * Live carriage map: renders one cell per coach, optionally enriched by
 * three complementary data sources:
 *
 *   1. **Darwin `formation`** (passenger-facing coach class, toilets/catering)
 *   2. **PTAC `consist`** (physical reality: actual unit + vehicle IDs,
 *      seat counts, max speed, brake type, open defects)
 *   3. **Per-coach `coachLoading`** (Darwin 1–10, or XR 0–100%), shown on
 *      the unit. Choose a calling point or Show all; station-wide
 *      `loadingPercentage` is never copied onto every coach.
 *
 * The component prefers PTAC consist as its primary axis when available
 * (it groups vehicles by unit, which gives a more accurate physical layout
 * for split-portion services). Falls back to Darwin formation, then to a
 * one-line "no formation data" note.
 *
 * Loading values are keyed by Darwin coach number and shown on the unit
 * they belong to.
 */
export const CarriageMap: React.FC<{
  formation: FormationData | null
  consist?: ConsistData | null
  stops: ServiceStop[]
  reverse: boolean
  initialTpl?: string | null
  onUnitClick?: (unitId: string) => void
  /** Overview / Formation / Loading as separate pages. */
  layout?: 'full' | 'loading-only' | 'stock-only'
}> = ({ formation, consist, stops, reverse, initialTpl, onUnitClick, layout = 'full' }) => {
  const loadingStops = useMemo(
    () => loadingStopsForView(stops, initialTpl),
    [stops, initialTpl],
  )
  const defaultTpl = useMemo(() => {
    if (loadingStops.length > 1) return SHOW_ALL_STOPS
    return loadingStops[0]?.tpl || null
  }, [loadingStops])
  const [selectedTpl, setSelectedTpl] = useState<string | null>(defaultTpl)
  useEffect(() => {
    setSelectedTpl((prev) => {
      if (prev === SHOW_ALL_STOPS && loadingStops.length > 1) return prev
      if (prev && prev !== SHOW_ALL_STOPS && loadingStops.some((s) => s.tpl === prev)) return prev
      return defaultTpl
    })
  }, [defaultTpl, loadingStops])
  const showAllStops = selectedTpl === SHOW_ALL_STOPS && loadingStops.length > 1
  const selectedStop = useMemo(
    () => (showAllStops ? null : loadingStops.find((s) => s.tpl === selectedTpl) || loadingStops[0] || null),
    [loadingStops, selectedTpl, showAllStops],
  )
  const loadingAtItems = useMemo(() => {
    const stops = loadingStops.map((s) => s.name || s.tpl)
    return loadingStops.length > 1 ? ['Show all', ...stops] : stops
  }, [loadingStops])
  const loadingAtSelectedIndex = useMemo(() => {
    if (loadingStops.length === 0) return -1
    if (loadingStops.length > 1 && showAllStops) return 0
    const stopIndex = loadingStops.findIndex((s) => s.tpl === selectedStop?.tpl)
    if (stopIndex < 0) return loadingStops.length > 1 ? 0 : 0
    return loadingStops.length > 1 ? stopIndex + 1 : stopIndex
  }, [loadingStops, showAllStops, selectedStop])

  // Decide which data source drives the layout. PTAC wins when present
  // because it groups vehicles into "stages" (legs of the journey), which
  // is more physically accurate than Darwin's single-formation snapshot.
  const stages    = useMemo(() => collectPtacStages(consist), [consist])
  const havePtac    = stages.length > 0
  const haveDarwin  = !!formation && formation.coaches.length > 0

  // Map TIPLOCs to friendly names for the stage headers.
  const tiplocName = useMemo(() => {
    const m = new Map<string, string>()
    for (const s of stops) if (s.tpl && s.name) m.set(s.tpl, s.name)
    return m
  }, [stops])

  const haveLoading = loadingStops.length > 0
  const showLoading = haveLoading && layout !== 'stock-only'
  const showStock = layout !== 'loading-only'
  if (layout === 'loading-only' && !haveLoading) return null
  if (!havePtac && !haveDarwin && !showLoading) {
    return (
      <div className="cmap-note">
        <strong>No coach formation data for this service.</strong>
        <p>
          Neither Darwin's coach-formation feed nor Network Rail's PTAC feed
          has published a formation for this train yet. Coverage is best
          for SE / XR (Darwin) and SE / NT / TP / SW / GTR / c2c
          (PTAC). Data may arrive as the daemon runs longer.
        </p>
      </div>
    )
  }

  const loadingByCoachNumber = coachLoadingMap(selectedStop)

  // Top-level summary: classes + units present across the whole journey.
  // (Stages may add/remove units en route, but the summary line lists every
  // unit involved at any point — handy for spotting unit swaps at a glance.)
  const summaryBits: Array<{ label: string; value: string }> = []
  if (havePtac) {
    const allUnits  = new Set<string>()
    const allFleets = new Set<string>()
    for (const st of stages) for (const u of st.units) {
      if (u.unitId)  allUnits.add(u.unitId)
      if (u.fleetId) allFleets.add(u.fleetId)
    }
    if (allFleets.size) summaryBits.push({ label: 'Class', value: [...allFleets].join(' + ') })
    if (allUnits.size)  summaryBits.push({ label: 'Unit',  value: [...allUnits].join(' + ') })
    // Hide PTAC-only metadata ("Stages"/"TOC") from the user-facing summary.
  }

  const renderLoadingBar = (stop: ServiceStop | null, byCoach: Map<string, CoachLoadingValue>, asPercent: boolean) => (
    <CoachLoadBar
      coaches={flattenCoachLoads(stages, formation, reverse, byCoach, stop?.loadingPercentage ?? null)}
      asPercent={asPercent}
    />
  )

  const renderStockMap = () =>
    havePtac
      ? renderPtacStages(stages, formation, new Map(), tiplocName, onUnitClick, false, 'stock')
      : renderDarwinOnly(formation!, new Map(), reverse, false, 'stock')

  return (
    <div className="cmap-stack">
      {showLoading && (
        <section className="cmap-loading" aria-label="Loading capacity">
          <div className="cmap-header">
            {layout !== 'loading-only' && (
            <div className="cmap-title-group">
              <h3 className="cmap-title">Loading capacity</h3>
            </div>
            )}
            {loadingStops.length > 1 && (
            <div className="cmap-stop-picker">
              <span className="cmap-stop-picker-label">Loading at</span>
              <BUTDDMList
                items={loadingAtItems}
                filterName="Loading at"
                selectionMode="single"
                selectedPositions={loadingAtSelectedIndex >= 0 ? [loadingAtSelectedIndex] : []}
                onSelectionChanged={(selectedPositions) => {
                  const idx = selectedPositions[0]
                  if (typeof idx !== 'number') return
                  if (loadingStops.length > 1 && idx === 0) {
                    setSelectedTpl(SHOW_ALL_STOPS)
                    return
                  }
                  const stop = loadingStops.length > 1 ? loadingStops[idx - 1] : loadingStops[idx]
                  setSelectedTpl(stop?.tpl || null)
                }}
                colorVariant="primary"
                className="cmap-stop-picker-ddm"
              />
            </div>
            )}
          </div>

          {showAllStops ? (
            loadingStops.map((stop) => (
              <section key={stop.tpl} className="cmap-all-stop">
                <h4 className="cmap-all-stop-title">{stop.name || stop.tpl}</h4>
                {renderLoadingBar(stop, coachLoadingMap(stop), stopLoadAsPercent(stop))}
              </section>
            ))
          ) : (
            renderLoadingBar(selectedStop, loadingByCoachNumber, stopLoadAsPercent(selectedStop))
          )}
        </section>
      )}

      {showStock ? !havePtac && !haveDarwin ? (
        <div className="cmap-note">
          <strong>No coach formation data for this service.</strong>
          <p>
            Neither Darwin&apos;s coach-formation feed nor Network Rail&apos;s PTAC feed
            has published a formation for this train yet. Coverage is best
            for SE / XR (Darwin) and SE / NT / TP / SW / GTR / c2c
            (PTAC). Data may arrive as the daemon runs longer.
          </p>
        </div>
      ) : (
      <section className={`cmap${layout === 'stock-only' ? ' cmap--stock' : ''}`} aria-label="Detailed unit formations">
        {layout !== 'stock-only' && (
        <div className="cmap-header">
          <div className="cmap-title-group">
            <h3 className="cmap-title">Detailed unit formations</h3>
            {reverse && <span className="cmap-tag">↻ Reversed</span>}
          </div>
        </div>
        )}

        {layout !== 'stock-only' && summaryBits.length > 0 && (
          <ul className="cmap-summary">
            {summaryBits.map((b) => (
              <li key={b.label} className="cmap-summary-item">
                <span className="cmap-summary-label">{b.label}</span>
                <span className="cmap-summary-value">{b.value}</span>
              </li>
            ))}
          </ul>
        )}

        {renderStockMap()}
        <CoachClassLegend stages={stages} formation={formation} />
      </section>
      ) : null}
    </div>
  )
}

/* ===========================================================================
 *  Layout helpers — stage-based grouping
 *
 *  PTAC's `Allocation` element describes ONE LEG of the journey (one
 *  contiguous sub-section between split/join/swap points). A train can
 *  have many allocations, in two different shapes:
 *
 *    1. *Coupled working*  — multiple units running together over the
 *       same time range, distinguished by ResourceGroupPosition
 *       (1 = leading, 2 = trailing). All allocations share the same
 *       (allocationOriginDateTime, allocationDestinationDateTime).
 *
 *    2. *Sequential working* / unit swaps — different units operate
 *       different sub-sections, e.g. TPE 1M65: 397008 Edinburgh→Preston
 *       then 397005 Preston→Manchester. Allocations have non-overlapping
 *       time ranges.
 *
 *  We bucket allocations into "stages" by time-overlap. Each stage gets
 *  rendered as one block in the UI, with a "swap at X" separator between
 *  stages so the user can see when the train changes formation en route.
 * ========================================================================= */

interface PtacUnitView {
  unitId: string | null
  fleetId: string | null
  position: number | null
  reversed: boolean
  vehicles: PtacVehicle[]
}

interface PtacStage {
  /** Earliest origin-time across all units in this stage. */
  startDt: string | null
  /** Latest destination-time across all units in this stage. */
  endDt:   string | null
  /** Geographic boundary of this stage (TIPLOCs). */
  startTpl: string | null
  endTpl:   string | null
  /** All units running together over this stage, sorted by leading→trailing. */
  units: PtacUnitView[]
}

/**
 * Bucket the consist's allocations into stages. Two allocations are in the
 * same stage if their time ranges overlap (touch or intersect). Within a
 * stage, units are coupled and sorted by ResourceGroupPosition.
 */
function collectPtacStages(consist: ConsistData | null | undefined): PtacStage[] {
  if (!consist || !consist.allocations?.length) return []

  // Step 1 — flatten to one entry per (allocation × resourceGroup) so we
  // can reason about each unit-leg independently.
  type Leg = {
    unit: PtacUnitView
    startDt: string | null
    endDt:   string | null
    startTpl: string | null
    endTpl:   string | null
  }
  const legs: Leg[] = []
  for (const a of consist.allocations) {
    for (const rg of a.resourceGroups || []) {
      legs.push({
        unit: {
          unitId:   rg.unitId,
          fleetId:  rg.fleetId,
          position: a.resourceGroupPosition,
          reversed: a.reversed,
          vehicles: [...rg.vehicles].sort((x, y) => (x.position ?? 99) - (y.position ?? 99)),
        },
        startDt:  a.allocationOriginDateTime,
        endDt:    a.allocationDestinationDateTime,
        startTpl: a.allocationOrigin?.tiploc      ?? null,
        endTpl:   a.allocationDestination?.tiploc ?? null,
      })
    }
  }

  // Step 2 — collapse same-unit *consecutive* legs (e.g. an allocation
  // broken into Edinburgh→Carlisle, Carlisle→Lancaster, Lancaster→Preston
  // is logically one leg "Edinburgh→Preston" for layout purposes).
  //
  // Important: we must group by (unitId, position, reversed) FIRST and
  // merge within each group. A naive "look at previous entry" approach
  // misses merges when another unit's leg interleaves in start-time
  // order — e.g. Avanti 1A38: 805002@12:32, 805013@12:32, 805002@12:55,
  // where 805002's two legs would never merge because 805013 sits
  // between them in the sorted order.
  const byUnit = new Map<string, Leg[]>()
  for (const leg of legs) {
    const k = `${leg.unit.unitId}|${leg.unit.position}|${leg.unit.reversed ? 'R' : 'F'}`
    let arr = byUnit.get(k)
    if (!arr) { arr = []; byUnit.set(k, arr) }
    arr.push(leg)
  }
  const merged: Leg[] = []
  for (const arr of byUnit.values()) {
    arr.sort((a, b) => (a.startDt || '').localeCompare(b.startDt || ''))
    let acc: Leg | null = null
    for (const leg of arr) {
      if (
        acc &&
        acc.endDt &&
        leg.startDt &&
        // contiguous: previous leg's end is within 5 minutes of this leg's start
        Math.abs(new Date(leg.startDt).getTime() - new Date(acc.endDt).getTime()) <= 5 * 60_000
      ) {
        acc.endDt  = leg.endDt
        acc.endTpl = leg.endTpl
      } else {
        if (acc) merged.push(acc)
        acc = { ...leg }
      }
    }
    if (acc) merged.push(acc)
  }
  merged.sort((a, b) => (a.startDt || '').localeCompare(b.startDt || ''))

  // Step 3 — group merged legs into stages by time-overlap. Two legs share
  // a stage if their (start, end) ranges intersect.
  const stages: PtacStage[] = []
  for (const leg of merged) {
    const ls = new Date(leg.startDt || 0).getTime()
    const le = new Date(leg.endDt   || 0).getTime()
    let target = stages.find((st) => {
      const ss = new Date(st.startDt || 0).getTime()
      const se = new Date(st.endDt   || 0).getTime()
      return Math.max(ss, ls) <= Math.min(se, le)  // overlap
    })
    if (!target) {
      target = {
        startDt:  leg.startDt,
        endDt:    leg.endDt,
        startTpl: leg.startTpl,
        endTpl:   leg.endTpl,
        units: [],
      }
      stages.push(target)
    } else {
      // Stretch the stage to cover this leg too (in case start/end differ slightly)
      if ((leg.startDt || '') < (target.startDt || '\uffff')) { target.startDt = leg.startDt; target.startTpl = leg.startTpl }
      if ((leg.endDt   || '') > (target.endDt   || '')) { target.endDt = leg.endDt; target.endTpl = leg.endTpl }
    }
    target.units.push(leg.unit)
  }

  // Step 4 — merge stages whose time ranges now overlap after expansion.
  // Necessary because Step 3 only checks against pre-expansion ranges, so
  // two stages can end up overlapping if a later leg expands an earlier
  // stage's window. Repeated until no more overlaps remain.
  let merging = true
  while (merging) {
    merging = false
    outer: for (let i = 0; i < stages.length; i++) {
      for (let j = i + 1; j < stages.length; j++) {
        const a = stages[i], b = stages[j]
        const as = new Date(a.startDt || 0).getTime()
        const ae = new Date(a.endDt   || 0).getTime()
        const bs = new Date(b.startDt || 0).getTime()
        const be = new Date(b.endDt   || 0).getTime()
        if (Math.max(as, bs) <= Math.min(ae, be)) {
          if ((b.startDt || '') < (a.startDt || '\uffff')) { a.startDt = b.startDt; a.startTpl = b.startTpl }
          if ((b.endDt   || '') > (a.endDt   || '')) { a.endDt = b.endDt; a.endTpl = b.endTpl }
          a.units.push(...b.units)
          stages.splice(j, 1)
          merging = true
          break outer
        }
      }
    }
  }

  // Step 5 — within each stage, dedupe units that appear more than once
  // (e.g. the same physical unit was published with two different reversed
  // flags or positions because of an internal Allocation split). Prefer
  // the entry whose vehicles list is the longest (most informative).
  for (const s of stages) {
    const seen = new Map<string, PtacUnitView>()
    for (const u of s.units) {
      if (!u.unitId) continue
      const existing = seen.get(u.unitId)
      if (!existing || (u.vehicles.length > existing.vehicles.length)) seen.set(u.unitId, u)
    }
    s.units = [...seen.values()]
  }

  // Sort stages chronologically; within each stage, sort units by position
  // (1 = leading on the left).
  stages.sort((a, b) => (a.startDt || '').localeCompare(b.startDt || ''))
  for (const s of stages) s.units.sort((a, b) => (a.position ?? 99) - (b.position ?? 99))

  // Step 6 — merge consecutive stages that have identical unit configurations.
  // This handles cases where PTAC publishes allocations with time gaps but
  // the formation hasn't actually changed (same units in same positions/reversed).
  let i = 0
  while (i < stages.length - 1) {
    const curr = stages[i]
    const next = stages[i + 1]

    // Build config maps for comparison
    const currConfig = new Map<string, { position: number | null; reversed: boolean }>()
    for (const u of curr.units) {
      if (u.unitId) currConfig.set(u.unitId, { position: u.position, reversed: u.reversed })
    }
    const nextConfig = new Map<string, { position: number | null; reversed: boolean }>()
    for (const u of next.units) {
      if (u.unitId) nextConfig.set(u.unitId, { position: u.position, reversed: u.reversed })
    }

    // Check if configurations are identical
    let configsMatch = currConfig.size === nextConfig.size
    if (configsMatch) {
      for (const [id, cfg] of currConfig) {
        const other = nextConfig.get(id)
        if (!other || other.position !== cfg.position || other.reversed !== cfg.reversed) {
          configsMatch = false
          break
        }
      }
    }

    if (configsMatch) {
      // Merge: stretch time range to cover both, combine units (deduped later)
      if ((next.startDt || '') < (curr.startDt || '\uffff')) { curr.startDt = next.startDt; curr.startTpl = next.startTpl }
      if ((next.endDt   || '') > (curr.endDt   || '')) { curr.endDt = next.endDt; curr.endTpl = next.endTpl }
      curr.units.push(...next.units)
      stages.splice(i + 1, 1)
      // Don't increment i — re-check the new merged stage against its next neighbor
    } else {
      i += 1
    }
  }

  // Re-dedupe units after merging (in case same unit appeared in both stages)
  for (const s of stages) {
    const seen = new Map<string, PtacUnitView>()
    for (const u of s.units) {
      if (!u.unitId) continue
      const existing = seen.get(u.unitId)
      if (!existing || (u.vehicles.length > existing.vehicles.length)) seen.set(u.unitId, u)
    }
    s.units = [...seen.values()]
    // Re-sort by position after deduping
    s.units.sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  }

  return stages
}

/**
 * Decide whether the boundary between stage `prev` and stage `next` is a
 * full unit swap (different physical units) or just a *reversal* (same
 * units, but their leading positions / reversed flags swapped). The label
 * shown to the user differs between the two cases — reversals stay on the
 * same train, swaps don't.
 */
function classifyStageBoundary(prev: PtacStage, next: PtacStage): 'reversal' | 'swap' {
  const a = new Set(prev.units.map((u) => u.unitId).filter(Boolean) as string[])
  const b = new Set(next.units.map((u) => u.unitId).filter(Boolean) as string[])
  if (a.size === 0 || b.size === 0) return 'swap'
  // If any unit changed → swap
  for (const id of a) if (!b.has(id)) return 'swap'
  for (const id of b) if (!a.has(id)) return 'swap'

  // All units are the same — check if their configuration actually changed.
  // Build a map of unitId -> (position, reversed) for both stages.
  const prevConfig = new Map<string, { position: number | null; reversed: boolean }>()
  for (const u of prev.units) {
    if (u.unitId) prevConfig.set(u.unitId, { position: u.position, reversed: u.reversed })
  }
  const nextConfig = new Map<string, { position: number | null; reversed: boolean }>()
  for (const u of next.units) {
    if (u.unitId) nextConfig.set(u.unitId, { position: u.position, reversed: u.reversed })
  }

  // Check if any unit's position or reversed flag changed
  let configChanged = false
  for (const [id, cfg] of prevConfig) {
    const other = nextConfig.get(id)
    if (!other || other.position !== cfg.position || other.reversed !== cfg.reversed) {
      configChanged = true
      break
    }
  }

  // Only call it a reversal if the configuration actually changed.
  // Same units in same configuration = no meaningful change (treat as swap).
  return configChanged ? 'reversal' : 'swap'
}

/**
 * Render PTAC stages chronologically. A stage is one leg of the journey
 * (e.g. Edinburgh → Preston) and contains all units coupled together for
 * that section. Multiple stages indicate unit swaps en route — between
 * stages we render a "Unit swap at X" separator so the user understands
 * the formation changes mid-journey.
 *
 * Darwin's formation (if present) is overlaid by 1-based running position
 * across the *first* stage only — that's the most useful slice because
 * Darwin's coach numbering is published once per service, not per stage.
 */
function coachLoadingMap(stop: ServiceStop | null | undefined): Map<string, CoachLoadingValue> {
  const map = new Map<string, CoachLoadingValue>()
  for (const c of stop?.coachLoading || []) map.set(c.number, c)
  return map
}

function stopLoadAsPercent(stop: ServiceStop | null | undefined): boolean {
  const values = (stop?.coachLoading || []).map((c) => c.value)
  return coachLoadingIsPercent(values, null, values.length > 0)
}

/**
 * Board cards at an intermediate stop (e.g. Farringdon) reuse the latest
 * Darwin formationLoading from earlier on the journey. Keep that stop in
 * the picker so details match the board.
 */
function loadingStopsForView(stops: ServiceStop[], initialTpl?: string | null): ServiceStop[] {
  const published = stops.filter(
    (s) =>
      Boolean(s.coachLoading && s.coachLoading.length > 0) ||
      (s.loadingPercentage != null && Number.isFinite(s.loadingPercentage)),
  )
  const needle = (initialTpl || '').toUpperCase()
  if (!needle || published.length === 0) return published
  const idx = stops.findIndex(
    (s) => s.tpl === needle || (s.crs || '').toUpperCase() === needle,
  )
  if (idx < 0) return published
  const current = stops[idx]
  if (current.coachLoading && current.coachLoading.length > 0) return published
  for (let i = idx; i >= 0; i -= 1) {
    const prior = stops[i]
    if (!prior.coachLoading || prior.coachLoading.length === 0) continue
    const inherited: ServiceStop = { ...current, coachLoading: prior.coachLoading }
    return [inherited, ...published.filter((s) => s.tpl !== inherited.tpl)]
  }
  return published
}

function loadBarCoachClass(index: number, count: number): string {
  if (count <= 1) return 'cmap-loading-coach cmap-loading-coach--solo'
  if (index === 0) return 'cmap-loading-coach cmap-loading-coach--front'
  if (index === count - 1) return 'cmap-loading-coach cmap-loading-coach--rear'
  return 'cmap-loading-coach'
}

function flattenCoachLoads(
  stages: PtacStage[],
  formation: FormationData | null,
  reverse: boolean,
  loadingByCoachNumber: Map<string, CoachLoadingValue>,
  overallPct: number | null,
): Array<{ label: string; value: number | null }> {
  const overall =
    overallPct != null && Number.isFinite(overallPct) ? overallPct : null
  const withOverallFallback = (items: Array<{ label: string; value: number | null }>) => {
    if (items.some((item) => item.value != null)) return items
    if (overall == null) return items
    if (items.length > 0) return items.map((item) => ({ ...item, value: overall }))
    return [{ label: '1', value: overall }]
  }
  if (stages.length > 0) {
    const darwinByPosition = new Map<number, FormationCoach>()
    formation?.coaches.forEach((c, i) => darwinByPosition.set(i + 1, c))
    const vehicleCoachLabelById = new Map<string, string>()
    const items: Array<{ label: string; value: number | null }> = []
    let running = 0
    for (const g of stages[0].units) {
      const vehicles = g.reversed ? [...g.vehicles].reverse() : g.vehicles
      for (const v of vehicles) {
        running += 1
        const darwinCoach = darwinByPosition.get(running)
        const mappedLabel = v.vehicleId ? vehicleCoachLabelById.get(v.vehicleId) : undefined
        const label = mappedLabel ?? darwinCoach?.number ?? String(running)
        if (!mappedLabel && v.vehicleId) vehicleCoachLabelById.set(v.vehicleId, label)
        const loadingVal = loadingByCoachNumber.get(label) ?? loadingByCoachNumber.get(String(running))
        const value = loadingVal && Number.isFinite(loadingVal.value) ? loadingVal.value : null
        items.push({ label, value })
      }
    }
    return withOverallFallback(items)
  }
  if (formation?.coaches?.length) {
    const coaches = reverse ? [...formation.coaches].reverse() : formation.coaches
    return withOverallFallback(coaches.map((coach) => {
      const loadingVal = loadingByCoachNumber.get(coach.number)
      return {
        label: coach.number,
        value: loadingVal && Number.isFinite(loadingVal.value) ? loadingVal.value : null,
      }
    }))
  }
  const fromFeed = [...loadingByCoachNumber.values()]
    .filter((coach) => coach.number)
    .sort((a, b) => Number(a.number) - Number(b.number) || a.number.localeCompare(b.number))
  return withOverallFallback(fromFeed.map((coach) => ({
    label: coach.number,
    value: Number.isFinite(coach.value) ? coach.value : null,
  })))
}

function CoachLoadBar({
  coaches,
  asPercent,
}: {
  coaches: Array<{ label: string; value: number | null }>
  asPercent: boolean
}) {
  const count = coaches.length
  if (count === 0) return null
  return (
    <div
      className="cmap-loading-bar"
      role="list"
      aria-label="Coach loading"
    >
      {coaches.map((coach, index) => (
        <span
          key={`${coach.label}-${index}`}
          role="listitem"
          className={[
            loadBarCoachClass(index, count),
            coach.value == null ? 'cmap-loading-coach--unknown' : '',
          ].filter(Boolean).join(' ')}
          style={{ backgroundColor: coachLoadFill(coach.value, asPercent) }}
          title={
            coach.value != null
              ? `Coach ${coach.label} · ${formatCoachLoad(coach.value, asPercent)} loaded`
              : `Coach ${coach.label} · no loading data`
          }
        >
          <span className="cmap-loading-text">
            <span className="cmap-loading-num">{coach.label}</span>
            <span className="cmap-loading-pct">
              {coach.value == null ? '—' : formatCoachLoad(coach.value, asPercent)}
            </span>
          </span>
        </span>
      ))}
    </div>
  )
}

function renderPtacStages(
  stages: PtacStage[],
  darwinFormation: FormationData | null,
  loadingByCoachNumber: Map<string, CoachLoadingValue>,
  tiplocName: Map<string, string>,
  onUnitClick: ((unitId: string) => void) | undefined,
  asPercent: boolean,
  purpose: 'loading' | 'stock',
): React.ReactNode {
  const darwinByPosition = new Map<number, FormationCoach>()
  if (darwinFormation) {
    darwinFormation.coaches.forEach((c, i) => darwinByPosition.set(i + 1, c))
  }
  // Stable PTAC vehicle -> coach-number mapping. We seed this from the first
  // rendered stage so a vehicle keeps its number if the formation reverses
  // later (e.g. 123 becomes 321, rather than being renumbered 123 again).
  const vehicleCoachLabelById = new Map<string, string>()
  return (
    <div className={purpose === 'stock' ? 'cmap-stages cmap-stages--stock' : 'cmap-stages'}>
      {stages.map((stage, sIdx) => {
        const startName = stage.startTpl ? (tiplocName.get(stage.startTpl) || stage.startTpl) : null
        const endName   = stage.endTpl   ? (tiplocName.get(stage.endTpl)   || stage.endTpl)   : null
        const startTime = stage.startDt?.slice(11, 16) || null
        const endTime   = stage.endDt?.slice(11, 16)   || null
        const showStageHeader = stages.length > 1
        const prevUnitKey = sIdx > 0
          ? stages[sIdx - 1].units.map((u) => u.unitId || '').join('|')
          : ''
        const thisUnitKey = stage.units.map((u) => u.unitId || '').join('|')
        const sameUnitsAsPrevious = purpose === 'stock' && prevUnitKey !== '' && prevUnitKey === thisUnitKey
        let running = 0
        return (
          <React.Fragment key={`stage-${sIdx}`}>
            {sIdx > 0 && (() => {
              const kind = classifyStageBoundary(stages[sIdx - 1], stage)
              return (
                <p className={`cmap-stage-swap cmap-stage-swap--${kind}${purpose === 'stock' ? ' cmap-stage-swap--quiet' : ''}`}>
                  <span className="cmap-stage-swap-icon" aria-hidden="true">
                    {kind === 'reversal' ? '↻' : '↔'}
                  </span>
                  <span className="cmap-stage-swap-text">
                    {kind === 'reversal'
                      ? <>Reverses at <strong>{startName || stage.startTpl}</strong></>
                      : <>Unit change at <strong>{startName || stage.startTpl}</strong></>}
                    {startTime ? ` · ${startTime}` : ''}
                  </span>
                </p>
              )
            })()}
            <section className="cmap-stage" aria-label={`Stage ${sIdx + 1}`}>
              {showStageHeader && (
                <header className="cmap-stage-header">
                  <span className="cmap-stage-route">
                    {startName || stage.startTpl || '?'}
                    <span className="cmap-stage-arrow"> → </span>
                    {endName || stage.endTpl || '?'}
                  </span>
                  {(startTime || endTime) && (
                    <span className="cmap-stage-times">{startTime} – {endTime}</span>
                  )}
                </header>
              )}
              <div className="cmap-units">
                {stage.units.map((g, idx) => (
                  <div
                    className={`cmap-unit${g.reversed ? ' cmap-unit--reversed' : ''}`}
                    key={`${g.unitId}-${g.position}-${idx}`}
                  >
                    {purpose === 'stock' && !sameUnitsAsPrevious && (
                    <div className="cmap-unit-header">
                      <span className="cmap-unit-name">{g.unitId || '—'}</span>
                      {g.fleetId && <span className="cmap-unit-fleet">{g.fleetId}</span>}
                      {g.unitId && onUnitClick && (
                        <button
                          type="button"
                          className="cmap-unit-text-link"
                          onClick={() => onUnitClick(g.unitId!)}
                        >
                          View unit
                        </button>
                      )}
                    </div>
                    )}
                    {purpose === 'loading' && (
                    <div className="cmap-unit-header">
                      <span className="cmap-unit-name">{g.unitId || '—'}</span>
                      {g.fleetId && <span className="cmap-unit-fleet">{g.fleetId}</span>}
                      {g.reversed && <span className="cmap-unit-reversed-chip">Runs in Reverse Formation</span>}
                      {g.unitId && onUnitClick && (
                        <BUTOperatorChip
                          width="hug"
                          instantAction
                          colorVariant="primary"
                          className="cmap-unit-link-btn"
                          onClick={() => onUnitClick(g.unitId!)}
                        >
                          View unit
                        </BUTOperatorChip>
                      )}
                    </div>
                    )}
                    {purpose === 'stock' ? (
                    <div className="cmap-loading-bar" role="list" aria-label={`${g.unitId || 'Unit'} coaches`}>
                      {(g.reversed ? [...g.vehicles].reverse() : g.vehicles).map((v, vIdx, list) => {
                        running += 1
                        const darwinCoach = sIdx === 0 ? darwinByPosition.get(running) : undefined
                        const mappedLabel = v.vehicleId ? vehicleCoachLabelById.get(v.vehicleId) : undefined
                        const coachLabel = mappedLabel ?? darwinCoach?.number ?? String(running)
                        if (!mappedLabel && sIdx === 0 && v.vehicleId) {
                          vehicleCoachLabelById.set(v.vehicleId, coachLabel)
                        }
                        return renderVehicleCell(
                          v,
                          coachLabel,
                          darwinCoach,
                          loadingByCoachNumber,
                          running,
                          asPercent,
                          purpose,
                          vIdx,
                          list.length,
                        )
                      })}
                    </div>
                    ) : (
                    <ol className="cmap-row cmap-row--unit" role="list">
                      {(g.reversed ? [...g.vehicles].reverse() : g.vehicles).map((v) => {
                        running += 1
                        const darwinCoach = sIdx === 0 ? darwinByPosition.get(running) : undefined
                        const mappedLabel = v.vehicleId ? vehicleCoachLabelById.get(v.vehicleId) : undefined
                        const coachLabel = mappedLabel ?? darwinCoach?.number ?? String(running)
                        if (!mappedLabel && sIdx === 0 && v.vehicleId) {
                          vehicleCoachLabelById.set(v.vehicleId, coachLabel)
                        }
                        return renderVehicleCell(
                          v,
                          coachLabel,
                          darwinCoach,
                          loadingByCoachNumber,
                          running,
                          asPercent,
                          purpose,
                        )
                      })}
                    </ol>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </React.Fragment>
        )
      })}
    </div>
  )
}

/** Fallback Darwin-only rendering for the rare case where Darwin published
 *  formation but PTAC hasn't joined a consist for this RID yet. */
function renderDarwinOnly(
  formation: FormationData,
  loadingByCoachNumber: Map<string, CoachLoadingValue>,
  reverseFormation: boolean,
  asPercent: boolean,
  purpose: 'loading' | 'stock',
): React.ReactNode {
  const coaches = reverseFormation ? [...formation.coaches].reverse() : formation.coaches
  if (purpose === 'stock') {
    const count = coaches.length
    return (
      <div className="cmap-loading-bar" role="list" aria-label="Coaches">
        {coaches.map((coach, index) => {
          const coachClass = (() => {
            const c = (coach.class || '').toLowerCase()
            if (c.startsWith('first')) return 'first'
            if (c.startsWith('standard')) return 'standard'
            if (c.includes('composite') || c.includes('mixed')) return 'composite'
            if (c.includes('catering') || c.includes('buffet')) return 'kitchen'
            return 'unknown'
          })()
          return (
            <span
              key={coach.number}
              role="listitem"
              className={`${loadBarCoachClass(index, count)} cmap-coach--class-${coachClass}`}
              title={`Coach ${coach.number} (${coach.class || 'unknown class'})`}
            >
              <span className="cmap-loading-text">
                <span className="cmap-loading-num">{coach.number}</span>
                <span className="cmap-loading-pct">{classAbbrev(coach.class || '?')}</span>
              </span>
            </span>
          )
        })}
      </div>
    )
  }
  return (
    <ol className="cmap-row" role="list">
      {coaches.map((coach) => {
        const v = loadingByCoachNumber.get(coach.number)
        const loadVal =
          purpose === 'loading' && v && Number.isFinite(v.value) ? v.value : null
        const showLoad = purpose === 'loading'
        return (
          <li
            key={coach.number}
            className={`cmap-coach${showLoad && loadVal == null ? ' cmap-coach--unknown' : ''}`}
            style={showLoad ? { backgroundColor: coachLoadFill(loadVal, asPercent) } : undefined}
            title={
              purpose === 'loading'
                ? describeCoach(coach.number, coach.class, loadVal, asPercent)
                : `Coach ${coach.number} (${coach.class || 'unknown class'})`
            }
          >
            <span className="cmap-coach-num">{coach.number}</span>
            {coach.class && <span className="cmap-coach-class" title={coach.class}>{classAbbrev(coach.class)}</span>}
            {showLoad && (
              <span className="cmap-coach-load">{loadVal == null ? '—' : formatCoachLoad(loadVal, asPercent)}</span>
            )}
          </li>
        )
      })}
    </ol>
  )
}

/**
 * One vehicle cell. Pulls loading by Darwin coach number when we have a
 * matching one, else by stringified PTAC running position.
 */
function renderVehicleCell(
  v: PtacVehicle,
  coachLabel: string,
  darwinCoach: FormationCoach | undefined,
  loadingByCoachNumber: Map<string, CoachLoadingValue>,
  runningPosition: number,
  asPercent: boolean,
  purpose: 'loading' | 'stock',
  barIndex?: number,
  barCount?: number,
): React.ReactNode {
  const cls        = darwinCoach?.class ?? null
  const loadingVal = loadingByCoachNumber.get(coachLabel) ?? loadingByCoachNumber.get(String(runningPosition))
  const fromCoach = loadingVal && Number.isFinite(loadingVal.value) ? loadingVal.value : null
  const loadVal = purpose === 'loading' ? fromCoach : null
  const seats   = v.numberOfSeats
  const defects = v.defects?.length || 0
  const coachClass = inferCoachClass(v, cls)
  const classMeta  = COACH_CLASS_META[coachClass]
  const showLoad = purpose === 'loading'
  const title = [
        `Coach ${coachLabel}`,
        purpose === 'stock' && v.vehicleId ? `Vehicle ${v.vehicleId}` : null,
        purpose === 'stock' && v.specificType ? `(${v.specificType})` : null,
        `class: ${classMeta.label}`,
        purpose === 'stock' && seats != null ? `${seats} seats` : null,
        purpose === 'stock' && v.maximumSpeedMph != null ? `${v.maximumSpeedMph} mph` : null,
        purpose === 'stock' && v.trainBrakeTypeLabel ? `brake: ${v.trainBrakeTypeLabel}` : null,
        showLoad && loadVal != null ? `loading: ${formatCoachLoad(loadVal, asPercent)}` : null,
        showLoad && loadVal == null ? 'no loading data' : null,
        purpose === 'stock' && defects > 0 ? `${defects} open defect${defects === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ')

  if (purpose === 'stock' && barCount != null && barIndex != null) {
    return (
      <span
        key={(v.vehicleId || '') + '-' + runningPosition}
        role="listitem"
        className={[
          loadBarCoachClass(barIndex, barCount),
          `cmap-coach--class-${coachClass}`,
          defects > 0 ? 'cmap-coach--defect' : '',
        ].filter(Boolean).join(' ')}
        title={title}
      >
          <span className="cmap-loading-text">
            <span className="cmap-loading-num">{coachLabel}</span>
            <span className="cmap-loading-pct">{classMeta.abbrev}</span>
          </span>
      </span>
    )
  }

  return (
    <li
      key={(v.vehicleId || '') + '-' + runningPosition}
      className={[
        'cmap-coach',
        purpose === 'stock' ? 'cmap-coach--ptac' : 'cmap-coach--load',
        `cmap-coach--class-${coachClass}`,
        showLoad && loadVal == null ? 'cmap-coach--unknown' : '',
        purpose === 'stock' && defects > 0 ? 'cmap-coach--defect' : '',
      ].filter(Boolean).join(' ')}
      style={showLoad ? { backgroundColor: coachLoadFill(loadVal, asPercent) } : undefined}
      title={title}
    >
      <span className="cmap-coach-num">{coachLabel}</span>
      {purpose === 'stock' && <span className="cmap-coach-vid">{v.vehicleId}</span>}
      <span className={`cmap-coach-class cmap-coach-class--${coachClass}`} title={classMeta.label}>
        {classMeta.abbrev}
      </span>
      {showLoad && (
        <span className="cmap-coach-load">{loadVal == null ? '—' : formatCoachLoad(loadVal, asPercent)}</span>
      )}
      {purpose === 'stock' && seats != null && (
        <span className="cmap-coach-seats">{seats}s</span>
      )}
      {purpose === 'stock' && defects > 0 && (
        <span className="cmap-coach-defects" title={v.defects.map((d) => `${d.code}: ${d.description}`).join('\n')}>
          ⚠ {defects}
        </span>
      )}
    </li>
  )
}

/* ===========================================================================
 *  Small visual helpers
 * ========================================================================= */

function classAbbrev(cls: string): string {
  const c = cls.toLowerCase()
  if (c.startsWith('first'))    return 'F'
  if (c.startsWith('standard')) return 'S'
  if (c.includes('composite') || c.includes('mixed')) return 'M'
  return cls.slice(0, 1).toUpperCase()
}

/* ===========================================================================
 *  Coach class detection from PTAC SpecificType + Darwin overlay
 *
 *  PTAC's `SpecificType` field is a TOC-issued code like `DC1030A` or
 *  `EM2300A`. Reverse-engineering across the 21 TOCs we see, the encoding
 *  is consistent enough to mine class info reliably:
 *
 *    Position 1-2 (letters)  — coach role:
 *      DC = Driving Composite (cab + mixed First/Standard)
 *      DM = Driving Motor          DT = Driving Trailer
 *      DD = Driving (intermediate)
 *      DV / DP = Driving Power (DMU)
 *      EC = Electric Composite     EM = Electric Motor
 *      EL = Electric Leading       EA = Electric Articulated
 *      EH = Electric (Trailer Std) ER = Electric (Trailer)
 *      EQ = Electric Driving Std   ES = Electric Standard
 *      EK = Electric Kitchen / catering
 *
 *    Position 3 (digit)      — class capacity hint:
 *      1 = First-class only
 *      2 = Standard
 *      3 = Standard with reduced capacity (accessible / wheelchair)
 *
 *  Composite coaches (mixed First+Standard) are detected when 1-2 = `XC`
 *  AND seat count is in the "mostly Standard with First section" range
 *  (≈40-70 seats). When 1-2 = `XK` it's a kitchen / buffet, often with a
 *  small First class section.
 *
 *  Darwin's formation `class` field, when present (XR / SE only), takes
 *  precedence — it's the authoritative passenger-facing class.
 * ========================================================================= */

type CoachClass = 'first' | 'composite' | 'kitchen' | 'standard' | 'accessible' | 'unknown'

const COACH_CLASS_META: Record<CoachClass, { label: string; shortLabel: string; abbrev: string }> = {
  first:      { label: 'First class',                       shortLabel: 'First',       abbrev: 'F' },
  composite:  { label: 'Composite (First + Standard)',      shortLabel: 'Mixed',       abbrev: 'M' },
  kitchen:    { label: 'Catering / buffet',                 shortLabel: 'Catering',    abbrev: 'K' },
  standard:   { label: 'Standard class',                    shortLabel: 'Standard',    abbrev: 'S' },
  accessible: { label: 'Standard (accessible / wheelchair)', shortLabel: 'Accessible',  abbrev: 'A' },
  unknown:    { label: 'Class unknown',                     shortLabel: 'Unknown',     abbrev: '?' },
}

function inferCoachClass(v: PtacVehicle, darwinClass: string | null): CoachClass {
  // 1) Trust Darwin first when it has spoken.
  if (darwinClass) {
    const c = darwinClass.toLowerCase()
    if (c.startsWith('first'))                        return 'first'
    if (c.startsWith('standard'))                     return 'standard'
    if (c.includes('composite') || c.includes('mixed')) return 'composite'
    if (c.includes('catering') || c.includes('buffet')) return 'kitchen'
  }
  // 2) Fall back to PTAC SpecificType pattern matching.
  const sp = (v.specificType || '').toUpperCase()
  const m  = sp.match(/^([A-Z])([A-Z])(\d)/)
  if (!m) return 'unknown'
  const [, p1, p2, digit] = m
  // 3rd char "1" is unambiguous First class across all observed TOCs.
  if (digit === '1') return 'first'
  // 3rd char "3" + 2nd char DC/DD/EM/EL etc → reduced-capacity Standard,
  // which is almost always the accessible/wheelchair coach.
  if (digit === '3') return 'accessible'
  // 2nd char K = Kitchen / buffet across IETs, GTR Class 387, XR Class 345.
  // Often has a small First section but not always; flag distinctly so
  // the UI can show "K".
  if (p2 === 'K') return 'kitchen'
  // 2nd char C with 3rd char 2 = Composite Standard side. The fully-First
  // composite ends are caught by digit === '1' above. So a `XC2…` with
  // ≤ 60 seats is a Composite (mostly Standard with a small First section);
  // ≥ 60 is "Driving Composite Standard" = standard for our purposes.
  if (p2 === 'C' && digit === '2') {
    const seats = v.numberOfSeats ?? 999
    return seats <= 60 ? 'composite' : 'standard'
  }
  // Driving cabs (often the front of an IET / Voyager) sometimes report
  // very low seat counts; without other signal default to standard.
  // Use `p1` to silence the unused-variable warning while keeping it as
  // a documented pivot in case we need TOC-specific overrides later.
  if (p1) return 'standard'
  return 'standard'
}

/**
 * Compact legend showing what each class abbreviation means. Renders only
 * the classes that actually appear in the current formation so we don't
 * pad the UI with irrelevant entries (e.g. no need to explain K on an
 * all-Standard 158 service). Drawn at the bottom of the map, between the
 * coach grid and the loading-summary line.
 */
const CoachClassLegend: React.FC<{
  stages: PtacStage[]
  formation: FormationData | null
}> = ({ stages, formation }) => {
  // Walk every rendered cell to determine which classes are in play.
  const present = new Set<CoachClass>()
  for (const stage of stages) {
    let darwinIdx = 0
    for (const u of stage.units) {
      for (const v of u.vehicles) {
        const darwinCoach = stages[0] === stage ? formation?.coaches[darwinIdx++] : undefined
        present.add(inferCoachClass(v, darwinCoach?.class ?? null))
      }
    }
  }
  // Darwin-only path (no PTAC consist): map the formation's class strings.
  if (stages.length === 0 && formation?.coaches.length) {
    for (const c of formation.coaches) {
      const lc = (c.class || '').toLowerCase()
      if (lc.startsWith('first'))                          present.add('first')
      else if (lc.includes('composite') || lc.includes('mixed')) present.add('composite')
      else if (lc.includes('catering') || lc.includes('buffet')) present.add('kitchen')
      else                                                  present.add('standard')
    }
  }
  // Always include Standard as the baseline so the legend isn't empty for
  // single-class fleets, and stable order: F → M → K → A → S → ?
  const ORDER: CoachClass[] = ['first', 'composite', 'kitchen', 'accessible', 'standard', 'unknown']
  const items = ORDER.filter((k) => present.has(k))
  if (items.length <= 1) return null   // single class — legend adds no value
  return (
    <ul className="cmap-legend" aria-label="Coach class key">
      {items.map((k) => (
        <li key={k} className="cmap-legend-item">
          <span className={`cmap-coach-class cmap-coach-class--${k}`}>{COACH_CLASS_META[k].abbrev}</span>
          <span className="cmap-legend-label">{COACH_CLASS_META[k].shortLabel}</span>
        </li>
      ))}
    </ul>
  )
}

function describeCoach(number: string, cls: string | null, loadVal: number | null, asPercent: boolean): string {
  if (loadVal == null) return `Coach ${number} (${cls || 'unknown class'}) — no loading data`
  return `Coach ${number} (${cls || 'unknown class'}) — loading ${formatCoachLoad(loadVal, asPercent)}`
}

export default CarriageMap
