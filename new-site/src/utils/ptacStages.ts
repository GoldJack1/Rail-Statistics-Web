import type { ConsistData, PtacVehicle } from '../types/darwin'

export interface PtacUnitView {
  unitId: string | null
  fleetId: string | null
  position: number | null
  reversed: boolean
  vehicles: PtacVehicle[]
}

export interface PtacStage {
  startDt: string | null
  endDt: string | null
  startTpl: string | null
  endTpl: string | null
  units: PtacUnitView[]
}

export type StageBoundary = 'reversal' | 'swap' | 'divide' | 'join'

function unitConfigKey(units: PtacUnitView[]): string {
  return [...units]
    .map((u) => `${u.unitId}|${u.position ?? ''}|${u.reversed ? 'R' : 'F'}`)
    .sort()
    .join(';')
}

function dedupeUnits(units: PtacUnitView[]): PtacUnitView[] {
  const seen = new Map<string, PtacUnitView>()
  for (const u of units) {
    if (!u.unitId) continue
    const existing = seen.get(u.unitId)
    if (!existing || u.vehicles.length > existing.vehicles.length) seen.set(u.unitId, u)
  }
  return [...seen.values()].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
}

/**
 * Group PTAC allocations into formation stages by allocation origin/destination
 * (not by overlapping unit journeys). A unit that continues past a divide must
 * not pull the detached unit into the onward stage.
 */
export function collectPtacStages(consist: ConsistData | null | undefined): PtacStage[] {
  if (!consist?.allocations?.length) return []

  const byKey = new Map<string, PtacStage>()
  const stages: PtacStage[] = []
  for (const a of consist.allocations) {
    const startDt = a.allocationOriginDateTime ?? null
    const endDt = a.allocationDestinationDateTime ?? null
    const startTpl = a.allocationOrigin?.tiploc ?? null
    const endTpl = a.allocationDestination?.tiploc ?? null
    const key = `${startDt}|${endDt}|${startTpl}|${endTpl}`
    let stage = byKey.get(key)
    if (!stage) {
      stage = { startDt, endDt, startTpl, endTpl, units: [] }
      byKey.set(key, stage)
      stages.push(stage)
    }
    for (const rg of a.resourceGroups || []) {
      stage.units.push({
        unitId: rg.unitId,
        fleetId: rg.fleetId,
        position: a.resourceGroupPosition,
        reversed: a.reversed,
        vehicles: [...(rg.vehicles || [])].sort((x, y) => (x.position ?? 99) - (y.position ?? 99)),
      })
    }
  }

  stages.sort((a, b) => (a.startDt || '').localeCompare(b.startDt || ''))
  for (const s of stages) s.units = dedupeUnits(s.units)

  let i = 0
  while (i < stages.length - 1) {
    const curr = stages[i]
    const next = stages[i + 1]
    if (unitConfigKey(curr.units) === unitConfigKey(next.units)) {
      if ((next.endDt || '') > (curr.endDt || '')) {
        curr.endDt = next.endDt
        curr.endTpl = next.endTpl
      }
      curr.units = dedupeUnits([...curr.units, ...next.units])
      stages.splice(i + 1, 1)
    } else {
      i += 1
    }
  }
  return stages
}

export function classifyStageBoundary(prev: PtacStage, next: PtacStage): StageBoundary {
  const a = new Set(prev.units.map((u) => u.unitId).filter(Boolean) as string[])
  const b = new Set(next.units.map((u) => u.unitId).filter(Boolean) as string[])
  if (a.size === 0 || b.size === 0) return 'swap'
  let aInB = true
  let bInA = true
  for (const id of a) if (!b.has(id)) aInB = false
  for (const id of b) if (!a.has(id)) bInA = false
  if (bInA && !aInB) return 'divide'
  if (aInB && !bInA) return 'join'
  if (!aInB || !bInA) return 'swap'

  const prevConfig = new Map<string, { position: number | null; reversed: boolean }>()
  for (const u of prev.units) {
    if (u.unitId) prevConfig.set(u.unitId, { position: u.position, reversed: u.reversed })
  }
  for (const u of next.units) {
    if (!u.unitId) continue
    const other = prevConfig.get(u.unitId)
    if (!other || other.position !== u.position || other.reversed !== u.reversed) return 'reversal'
  }
  return 'swap'
}

export function stageBoundaryLabel(kind: StageBoundary, place: string): string {
  if (kind === 'reversal') return `Reverses at ${place}`
  if (kind === 'divide') return `Divides at ${place}`
  if (kind === 'join') return `Joins at ${place}`
  return `Unit change at ${place}`
}
