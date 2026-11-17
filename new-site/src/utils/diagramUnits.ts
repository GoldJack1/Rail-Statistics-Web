import type { DiagramUnit, DiagramVehicle } from '@/components/darwin/CarriageMap'
import type { ConsistData, PtacVehicle } from '@/types/darwin'
import { collectPtacStages } from './ptacStages'

/**
 * Cars a unit of a class can have, largest first, for classes that run in more than one fixed
 * length. Used to split a coupled train: "220 + 221, 9 vehicles" is a 4-car and a 5-car.
 * Voyagers (220) are always 4-car; Super Voyagers (221) run as 4- or 5-car sets.
 */
const UNIT_CAR_COUNTS: Record<string, number[]> = {
  '220': [4],
  '221': [5, 4],
}

/** Class from a six-digit unit number (221107 gives 221). */
function classOfUnit(unitId: string): string | null {
  return /^\s*(\d{3})\d{3}\s*$/.exec(unitId)?.[1] ?? null
}

/** First combination of per-unit sizes (each unit's sizes tried in order) that adds up to `total`. */
function solveSizes(options: number[][], total: number): number[] | null {
  const pick = (i: number, left: number): number[] | null => {
    if (i === options.length) return left === 0 ? [] : null
    for (const size of options[i]) {
      if (size > left) continue
      const rest = pick(i + 1, left - size)
      if (rest) return [size, ...rest]
    }
    return null
  }
  return pick(0, total)
}

/**
 * Split a train's vehicles across its unit numbers for the drawing.
 *  - Classes with known lengths (220/221) are solved exactly, so 220 + 221 = 9 draws 4 + 5, in the
 *    order the units are listed; two 221s with 9 vehicles draw 5 + 4 (a guess: the data does not
 *    say which is which).
 *  - Otherwise an even split, and when that is not possible one set of the first unit's class.
 */
export function diagramUnitsForTrain(unitIds: ReadonlyArray<string | null | undefined>, total: number | null | undefined): DiagramUnit[] {
  const ids = unitIds.map((u) => String(u || '').trim()).filter(Boolean).slice(0, 4)
  if (!total || total <= 0 || ids.length === 0) return []

  if (ids.length > 1) {
    const options = ids.map((id) => UNIT_CAR_COUNTS[classOfUnit(id) || ''])
    if (options.every(Boolean)) {
      const sizes = solveSizes(options as number[][], total)
      if (sizes) return ids.map((unitId, i) => ({ unitId, vehicleCount: sizes[i] }))
    }
    if (total % ids.length === 0) {
      return ids.map((unitId) => ({ unitId, vehicleCount: total / ids.length }))
    }
  }
  return [{ unitId: ids[0], vehicleCount: total }]
}

/** A unit's PTAC vehicles as drawing vehicles, front first: a reversed formation runs the other way. */
export function diagramVehiclesFromPtac(vehicles: ReadonlyArray<PtacVehicle>, reversed: boolean): DiagramVehicle[] {
  const ordered = reversed ? [...vehicles].reverse() : [...vehicles]
  return ordered.map((v) => ({
    lengthMm: v.lengthMm,
    cabs: v.cabs,
    isLoco: String(v.typeOfVehicle || '').trim().toUpperCase() === 'L',
    id: v.vehicleId,
  }))
}

/** One leg of a journey for the drawings: where it runs and the units drawn from their own vehicles. */
export interface DiagramStage {
  startTpl: string | null
  endTpl: string | null
  startDt: string | null
  endDt: string | null
  units: DiagramUnit[]
}

/**
 * The formation of each leg, taken from the consist's own vehicles, so the order and the direction are
 * the ones the consist gives (a locomotive-hauled set can lead with the driving trailer, then reverse
 * so the locomotive leads). Empty when there is no consist, or a unit in it lists no vehicles.
 */
export function diagramStagesFromConsist(consist: ConsistData | null | undefined): DiagramStage[] {
  const stages = collectPtacStages(consist)
  if (stages.length === 0) return []
  const out: DiagramStage[] = []
  for (const stage of stages) {
    if (stage.units.length === 0 || stage.units.some((u) => u.vehicles.length === 0)) return []
    out.push({
      startTpl: stage.startTpl,
      endTpl: stage.endTpl,
      startDt: stage.startDt,
      endDt: stage.endDt,
      units: stage.units.map((u) => ({
        fleetId: u.fleetId,
        unitId: u.unitId,
        vehicleCount: u.vehicles.length,
        vehicles: diagramVehiclesFromPtac(u.vehicles, u.reversed),
      })),
    })
  }
  return out
}

/**
 * How a locomotive-hauled set is described, as Realtime Trains does: the coaches between the locomotive and the
 * driving trailer, the locomotive number and the set. Null when the consist has no locomotive.
 */
export function hauledSetSummary(
  consist: ConsistData | null | undefined,
): { coaches: number; locomotives: string[]; sets: string[] } | null {
  const stages = collectPtacStages(consist)
  const locomotives: string[] = []
  const sets: string[] = []
  let coaches = 0
  for (const stage of stages) {
    for (const unit of stage.units) {
      const locos = unit.vehicles.filter((v) => String(v.typeOfVehicle || '').trim().toUpperCase() === 'L')
      if (locos.length === 0) continue
      // An InterCity 125 has a power car at each end, so a set can name two locomotives.
      for (const loco of locos) {
        const id = String(loco.vehicleId || '').trim()
        if (id && !locomotives.includes(id)) locomotives.push(id)
      }
      if (unit.unitId && !sets.includes(unit.unitId)) sets.push(unit.unitId)
      const here = unit.vehicles.filter((v) => String(v.typeOfVehicle || '').trim().toUpperCase() !== 'L' && !(v.cabs && v.cabs > 0)).length
      coaches = Math.max(coaches, here)
    }
  }
  return locomotives.length > 0 ? { coaches, locomotives, sets } : null
}
