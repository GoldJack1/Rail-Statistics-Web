import type { DiagramUnit } from '@/components/darwin/CarriageMap'

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
