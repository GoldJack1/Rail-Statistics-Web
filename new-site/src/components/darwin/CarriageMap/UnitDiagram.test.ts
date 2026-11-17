import { describe, expect, it } from 'vitest'
import { carsFromVehicles, chooseOperatorKey, classSlug, joinOverlapUnits, mk4CoachKind } from './UnitDiagram'

const slug = (fleetId: string | null, unitId: string | null = null) =>
  classSlug({ fleetId, unitId, vehicleCount: 1 })

describe('classSlug', () => {
  it('maps the ScotRail HST sets to the IC125 drawing, by fleet or by set number', () => {
    expect(classSlug({ fleetId: '253/5', vehicleCount: 7 })).toBe('ic125')
    expect(classSlug({ unitId: 'HA18', vehicleCount: 0 })).toBe('ic125')
  })

  it('reads the named drawings (IC125, IC225, 555) straight from the fleet id', () => {
    expect(classSlug({ fleetId: 'ic125', vehicleCount: 6 })).toBe('ic125')
    expect(classSlug({ fleetId: 'IC225', vehicleCount: 9 })).toBe('ic225')
    expect(classSlug({ fleetId: 't-w-555', vehicleCount: 5 })).toBe('t-w-555')
  })

  it('reads the class from a plain fleet id', () => {
    expect(slug('800/1')).toBe('800')
    expect(slug('444/0')).toBe('444')
    expect(slug('158')).toBe('158')
  })

  it('reads the class from a zero-padded fleet id', () => {
    expect(slug('087/2')).toBe('87')
    expect(slug('005/0')).toBe('5')
  })

  it('reads class 91 from the locomotive + coach fleet and maps it to the IC225 art', () => {
    expect(slug('G91/M')).toBe('ic225')
  })

  it('finds the IC225 art from an NL set number when a board has no fleet id', () => {
    expect(slug(null, 'NL16')).toBe('ic225')
    expect(slug(null, 'nl08')).toBe('ic225')
  })

  it('reads the class from a six-digit unit number', () => {
    expect(slug(null, '800033')).toBe('800')
    expect(slug(null, '399201')).toBe('399')
  })

  it('maps class 555 to the Tyne and Wear slug', () => {
    expect(slug('555/0')).toBe('t-w-555')
    expect(slug(null, '555001')).toBe('t-w-555')
  })

  it('returns null when nothing identifies a class', () => {
    expect(slug(null, null)).toBeNull()
    expect(slug(null, 'ABC')).toBeNull()
  })
})

describe('chooseOperatorKey', () => {
  const f = (n: number) => ({ formations: { standard: Array.from({ length: n }, () => ({ car: 'END', flip: false })) } })
  const ops = { base: { formations: { standard: f(2).formations.standard, '3car': f(3).formations.standard } }, northern: f(2), emr: f(2) }

  it('uses the operator livery when it is drawn at the right length', () => {
    expect(chooseOperatorKey(ops, 'northern', 2)).toBe('northern')
    expect(chooseOperatorKey(ops, 'emr', 2)).toBe('emr')
  })

  it('uses the generic art when only it is drawn at the right length (3-car 170)', () => {
    expect(chooseOperatorKey(ops, 'northern', 3)).toBe('base')
  })

  it('keeps the operator when nothing is drawn at that length', () => {
    expect(chooseOperatorKey(ops, 'northern', 4)).toBe('northern')
  })

  it('does not switch when the length is unknown, or the operator has no art', () => {
    expect(chooseOperatorKey(ops, 'northern', 0)).toBe('northern')
    expect(chooseOperatorKey(ops, 'tfw', 2)).toBe('base')
    expect(chooseOperatorKey({ emr: f(2) }, 'tfw', 2)).toBe('emr')
  })
})

describe('carsFromVehicles', () => {
  // The IC225 art as drawn: locomotive at the left (END3), seven Mk4 (MID8..), driving trailer at the right (END4, mirrored).
  // GB Trains drew the coaches in the real order from the locomotive end: Standard end, three Standard,
  // buffet, then two First (MID8, MID9-11, MID12, MID13-14).
  const drawn = [
    { car: 'END3', flip: false },
    ...[8, 9, 10, 11, 12, 13, 14].map((n) => ({ car: `MID${n}`, flip: false })),
    { car: 'END4', flip: true },
  ]
  const sizes: Record<string, number> = { END3: 194, END4: 186, ...Object.fromEntries([8, 9, 10, 11, 12, 13, 14].map((n) => [`MID${n}`, 234])) }
  const dvt = { lengthMm: 18590, cabs: 1, id: '82205' }
  const loco = { lengthMm: 19400, cabs: 2, isLoco: true, id: '91130' }
  // NL12, front to rear as the consist lists it (positions 2-8): two First, buffet, three Standard, Standard end.
  const ids = ['11312', '11284', '10333', '12330', '12426', '12404', '12212']
  const coach = (id: string) => ({ lengthMm: 23400, cabs: null, id })
  const coaches = ids.map(coach)
  const codes = (cars: Array<{ car: string; flip: boolean }>) => cars.map((c) => `${c.car}${c.flip ? '~' : ''}`)

  it('draws the leg with the trailer leading: the art is turned and the coach kinds land in consist order', () => {
    const cars = carsFromVehicles(drawn, [dvt, ...coaches, loco], sizes)
    // trailer, First, First, buffet, Standard x3, Standard end, locomotive (the art reversed and mirrored)
    expect(codes(cars)).toEqual(['END4', 'MID14~', 'MID13~', 'MID12~', 'MID11~', 'MID10~', 'MID9~', 'MID8~', 'END3~'])
  })

  it('draws the reversed leg with the locomotive leading, as the art is drawn', () => {
    const cars = carsFromVehicles(drawn, [loco, ...[...coaches].reverse(), dvt], sizes)
    expect(codes(cars)).toEqual(['END3', 'MID8', 'MID9', 'MID10', 'MID11', 'MID12', 'MID13', 'MID14', 'END4~'])
  })

  it('places the buffet and First coaches by their vehicle numbers, not by position', () => {
    // A set with the buffet next to the locomotive: it must still be the buffet car.
    const odd = ['12212', '10333', '11312', '12330', '12426', '12404', '11284'].map(coach)
    const cars = carsFromVehicles(drawn, [loco, ...odd, dvt], sizes)
    expect(cars[1].car).toBe('MID8') // Standard end
    expect(cars[2].car).toBe('MID12') // buffet
    expect(cars[3].car).toBe('MID13') // First
    expect(cars[7].car).toBe('MID14') // the second First
  })

  it('falls back to the art order when coach numbers are missing', () => {
    const noIds = Array.from({ length: 7 }, () => ({ lengthMm: 23400, cabs: null }))
    const cars = carsFromVehicles(drawn, [{ lengthMm: 18590, cabs: 1 }, ...noIds, { lengthMm: 19400, cabs: 2, isLoco: true }], sizes)
    expect(codes(cars)[0]).toBe('END4')
    expect(codes(cars)[8]).toBe('END3~')
    expect(codes(cars).slice(1, 8)).toEqual(['MID14~', 'MID13~', 'MID12~', 'MID11~', 'MID10~', 'MID9~', 'MID8~'])
  })

  it('chooses the end car by length, so a locomotive and a trailer are never swapped', () => {
    expect(carsFromVehicles(drawn, [loco, ...coaches, dvt], sizes)[0].car).toBe('END3')
    expect(carsFromVehicles(drawn, [dvt, ...coaches, loco], sizes)[8].car).toBe('END3')
  })

  it('uses a unit with a cab at each end as drawn', () => {
    const cab = { lengthMm: 23000, cabs: 1 }
    const cars = carsFromVehicles(
      [{ car: 'END', flip: false }, { car: 'MID', flip: false }, { car: 'END2', flip: true }],
      [cab, { lengthMm: 23000, cabs: null }, cab],
      { END: 230, MID: 230, END2: 230 },
    )
    expect(codes(cars)).toEqual(['END', 'MID', 'END2~'])
  })

  it('handles a single vehicle and a unit with no middle cars', () => {
    expect(codes(carsFromVehicles(drawn, [{ lengthMm: 19400, cabs: 1 }], sizes))).toEqual(['END3'])
    const twoCar = [{ car: 'END', flip: false }, { car: 'END2', flip: true }]
    const cars = carsFromVehicles(twoCar, [{ cabs: 1 }, { cabs: null }, { cabs: 1 }], { END: 200, END2: 200 })
    expect(cars).toHaveLength(3)
  })

  it('returns nothing for no vehicles or no art', () => {
    expect(carsFromVehicles(drawn, [], sizes)).toEqual([])
    expect(carsFromVehicles([], [dvt], sizes)).toEqual([])
  })
})

describe('mk4CoachKind', () => {
  it('tells the Mk4 coach types apart by vehicle number', () => {
    expect(mk4CoachKind('11312')).toBe('tfo')
    expect(mk4CoachKind('10333')).toBe('rsb')
    expect(mk4CoachKind('12212')).toBe('tsoe')
    expect(mk4CoachKind('12330')).toBe('tso')
    expect(mk4CoachKind('82205')).toBeNull()
    expect(mk4CoachKind(null)).toBeNull()
  })
})

describe('joinOverlapUnits', () => {
  const car = (insetLeft: number, insetRight: number, flip = false) => ({ car: 'X', flip, size: 200, insetLeft, insetRight })

  it('keeps the minimum overlap when the cars butt exactly', () => {
    expect(joinOverlapUnits(car(0, 0), car(0, 0))).toBe(4)
    expect(joinOverlapUnits(car(0, 1), car(0.5, 0))).toBe(4)
  })

  it('closes the whole gap between tapered ends: the right end of the first plus the left end of the next', () => {
    expect(joinOverlapUnits(car(0, 15.5), car(15.5, 0))).toBe(32) // 15.5 + 15.5 + 1 (a 777)
    expect(joinOverlapUnits(car(0, 0), car(18, 0))).toBe(19) // a FLIRT's articulated end
  })

  it('swaps the ends of a mirrored car', () => {
    // the first car is mirrored, so its drawn-left inset is now on the right; the second is mirrored, so its right inset is on the left
    expect(joinOverlapUnits(car(12, 0, true), car(0, 9, true))).toBe(22)
    expect(joinOverlapUnits(car(12, 0), car(0, 9))).toBe(4)
  })

  it('is capped, and falls back to the minimum when a car is unknown', () => {
    expect(joinOverlapUnits(car(0, 60), car(60, 0))).toBe(40)
    expect(joinOverlapUnits(undefined, car(0, 0))).toBe(4)
    expect(joinOverlapUnits(car(0, 0), undefined)).toBe(4)
  })

  it('uses the fixed joint overlap of a class', () => {
    const a = { car: 'a', flip: false, size: 100, insetLeft: 0, insetRight: 15, fixedOverlap: 1.75 }
    const b = { car: 'b', flip: false, size: 100, insetLeft: 15, insetRight: 0, fixedOverlap: 1.75 }
    expect(joinOverlapUnits(a, b)).toBe(1.75)
    expect(joinOverlapUnits(a, { ...b, fixedOverlap: undefined })).toBe(31)
  })
})
