import { describe, expect, it } from 'vitest'
import { diagramStagesFromConsist, diagramUnitsForTrain, hauledSetSummary } from './diagramUnits'

const counts = (ids: string[], total: number) => diagramUnitsForTrain(ids, total).map((u) => `${u.unitId}:${u.vehicleCount}`)

describe('diagramUnitsForTrain', () => {
  it('draws a single 220 or 221 as one set', () => {
    expect(counts(['220001'], 4)).toEqual(['220001:4'])
    expect(counts(['221107'], 5)).toEqual(['221107:5'])
    expect(counts(['221107'], 4)).toEqual(['221107:4'])
  })

  it('splits a coupled 220 + 221 into a 4-car and a 5-car, in listed order', () => {
    expect(counts(['220001', '221107'], 9)).toEqual(['220001:4', '221107:5'])
    expect(counts(['221107', '220001'], 9)).toEqual(['221107:5', '220001:4'])
  })

  it('splits two 220s into 2 x 4', () => {
    expect(counts(['220001', '220002'], 8)).toEqual(['220001:4', '220002:4'])
  })

  it('splits two 221s into 2 x 5 or 2 x 4 by total, and 5 + 4 when it is odd', () => {
    expect(counts(['221107', '221108'], 10)).toEqual(['221107:5', '221108:5'])
    expect(counts(['221107', '221108'], 8)).toEqual(['221107:4', '221108:4'])
    expect(counts(['221107', '221108'], 9)).toEqual(['221107:5', '221108:4'])
  })

  it('splits a 221 + 220 pair with 8 vehicles into 4 + 4', () => {
    expect(counts(['221107', '220001'], 8)).toEqual(['221107:4', '220001:4'])
  })

  it('keeps splitting other classes evenly, as before', () => {
    expect(counts(['800001', '800002'], 10)).toEqual(['800001:5', '800002:5'])
    expect(counts(['387107', '387112'], 8)).toEqual(['387107:4', '387112:4'])
  })

  it('falls back to one set of the first unit when nothing fits', () => {
    expect(counts(['800001', '800002'], 11)).toEqual(['800001:11'])
    expect(counts(['220001', '221107'], 7)).toEqual(['220001:7'])
  })

  it('returns nothing without units or a count', () => {
    expect(diagramUnitsForTrain([], 4)).toEqual([])
    expect(diagramUnitsForTrain(['220001'], 0)).toEqual([])
    expect(diagramUnitsForTrain(['220001'], null)).toEqual([])
  })

  it('ignores blank ids and caps at four units', () => {
    expect(counts(['', '220001', null as unknown as string], 4)).toEqual(['220001:4'])
    expect(diagramUnitsForTrain(['220001', '220002', '220003', '220004', '220005'], 16)).toHaveLength(4)
  })
})

describe('diagramStagesFromConsist', () => {
  const veh = (position: number, type: string, length: number, cabs: number | null = null) =>
    ({ vehicleId: `v${position}`, typeOfVehicle: type, position, lengthMm: length, cabs }) as never
  const vehicles = [
    veh(1, 'C', 18590, 1), veh(2, 'C', 23400), veh(3, 'C', 23400), veh(4, 'C', 23400),
    veh(5, 'C', 23400), veh(6, 'C', 23400), veh(7, 'C', 23400), veh(8, 'C', 23400), veh(9, 'L', 19400, 2),
  ]
  const alloc = (from: string, to: string, reversed: boolean) => ({
    allocationOrigin: { tiploc: from }, allocationOriginDateTime: `2026-11-17T${from === 'BRADFS' ? '11:37' : '12:10'}:00`,
    allocationDestination: { tiploc: to }, allocationDestinationDateTime: `2026-11-17T${to === 'LEEDS' ? '11:58' : '14:21'}:00`,
    resourceGroupPosition: 1, reversed,
    resourceGroups: [{ unitId: 'NL12', fleetId: 'G91/M', vehicles }],
  })
  const consist = { allocations: [alloc('BRADFS', 'LEEDS', false), alloc('LEEDS', 'KNGX', true)] } as never

  it('gives each leg its own order: the trailer leads out of Bradford, the locomotive leads from Leeds', () => {
    const stages = diagramStagesFromConsist(consist)
    expect(stages).toHaveLength(2)
    const front = (i: number) => stages[i].units[0].vehicles![0]
    const rear = (i: number) => stages[i].units[0].vehicles!.at(-1)!
    expect(front(0).isLoco).toBe(false) // Bradford to Leeds: trailer first
    expect(rear(0).isLoco).toBe(true)
    expect(front(1).isLoco).toBe(true) // Leeds to King's Cross: reversed, locomotive first
    expect(rear(1).isLoco).toBe(false)
    expect(stages[0].units[0].vehicleCount).toBe(9)
    expect(stages[1].startTpl).toBe('LEEDS')
  })

  it('returns nothing without a consist or when a unit lists no vehicles', () => {
    expect(diagramStagesFromConsist(null)).toEqual([])
    const empty = { allocations: [{ ...alloc('BRADFS', 'LEEDS', false), resourceGroups: [{ unitId: 'X', fleetId: '1', vehicles: [] }] }] } as never
    expect(diagramStagesFromConsist(empty)).toEqual([])
  })
})

describe('hauledSetSummary', () => {
  const vehicles = [
    { vehicleId: '82205', typeOfVehicle: 'C', position: 1, lengthMm: 18590, cabs: 1 },
    ...[2, 3, 4, 5, 6, 7, 8].map((p) => ({ vehicleId: `v${p}`, typeOfVehicle: 'C', position: p, lengthMm: 23400, cabs: null })),
    { vehicleId: '91130', typeOfVehicle: 'L', position: 9, lengthMm: 19400, cabs: 2 },
  ]
  const consist = {
    allocations: [{
      allocationOrigin: { tiploc: 'BRADFS' }, allocationOriginDateTime: '2026-11-17T11:37:00',
      allocationDestination: { tiploc: 'KNGX' }, allocationDestinationDateTime: '2026-11-17T14:21:00',
      resourceGroupPosition: 1, reversed: false,
      resourceGroups: [{ unitId: 'NL12', fleetId: 'G91/M', vehicles }],
    }],
  } as never

  it('counts the coaches between the locomotive and the driving trailer, and names both', () => {
    expect(hauledSetSummary(consist)).toEqual({ coaches: 7, locomotives: ['91130'], sets: ['NL12'] })
  })

  it('is null for a multiple unit or no consist', () => {
    const emu = { allocations: [{ ...(consist as { allocations: object[] }).allocations[0], resourceGroups: [{ unitId: '800001', fleetId: '800', vehicles: vehicles.slice(0, 5) }] }] } as never
    expect(hauledSetSummary(emu)).toBeNull()
    expect(hauledSetSummary(null)).toBeNull()
  })
})
