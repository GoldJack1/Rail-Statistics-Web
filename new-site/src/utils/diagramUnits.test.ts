import { describe, expect, it } from 'vitest'
import { diagramUnitsForTrain } from './diagramUnits'

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
