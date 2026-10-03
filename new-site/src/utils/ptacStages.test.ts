import { describe, expect, it } from 'vitest'
import { classifyStageBoundary, collectPtacStages } from './ptacStages'
import type { ConsistData } from '../types/darwin'

function loc(tiploc: string) {
  return { tiploc, primaryCode: null, country: 'GB' }
}

function alloc(
  seq: number,
  orig: string,
  dest: string,
  start: string,
  end: string,
  pos: number,
  unitId: string,
  extra: { reversed?: boolean; trainOrigin?: string; trainDest?: string } = {},
) {
  return {
    sequenceNumber: seq,
    trainOrigin: loc(extra.trainOrigin || 'EDINBUR'),
    trainOriginDateTime: '2026-10-02T13:05:00',
    trainDest: loc(extra.trainDest || 'CRDFCEN'),
    trainDestDateTime: '2026-10-02T20:06:00',
    resourceGroupPosition: pos,
    diagramDate: '2026-10-02',
    diagramNo: null,
    allocationOrigin: loc(orig),
    allocationOriginDateTime: start,
    allocationOriginMiles: null,
    allocationDestination: loc(dest),
    allocationDestinationDateTime: end,
    allocationDestinationMiles: null,
    reversed: Boolean(extra.reversed),
    resourceGroups: [{ unitId, typeOfResource: null, typeOfResourceLabel: null, fleetId: '220', status: null, endOfDayMiles: null, preassignment: null, vehicles: [] }],
  }
}

describe('collectPtacStages', () => {
  it('keeps a detached unit off the onward portion', () => {
    const consist: ConsistData = {
      parsedAt: '',
      company: null,
      companyDarwin: 'XC',
      core: null,
      diagramDate: '2026-10-02',
      allocations: [
        alloc(1, 'EDINBUR', 'BHAMNWS', '2026-10-02T13:05:00', '2026-10-02T18:07:00', 2, '220008'),
        alloc(2, 'EDINBUR', 'BHAMNWS', '2026-10-02T13:05:00', '2026-10-02T18:07:00', 1, '220033'),
        alloc(3, 'BHAMNWS', 'GLOSTER', '2026-10-02T18:12:00', '2026-10-02T18:59:30', 2, '220008'),
        alloc(4, 'BHAMNWS', 'GLOSTER', '2026-10-02T18:12:00', '2026-10-02T18:59:30', 1, '220033'),
        alloc(5, 'GLOSTER', 'CRDFCEN', '2026-10-02T19:12:00', '2026-10-02T20:06:00', 1, '220033'),
      ],
    }
    const stages = collectPtacStages(consist)
    expect(stages).toHaveLength(2)
    expect(stages[0].startTpl).toBe('EDINBUR')
    expect(stages[0].endTpl).toBe('GLOSTER')
    expect(stages[0].units.map((u) => u.unitId).sort()).toEqual(['220008', '220033'])
    expect(stages[1].startTpl).toBe('GLOSTER')
    expect(stages[1].endTpl).toBe('CRDFCEN')
    expect(stages[1].units.map((u) => u.unitId)).toEqual(['220033'])
    expect(classifyStageBoundary(stages[0], stages[1])).toBe('divide')
  })

  it('treats a mid-journey replacement as a swap and a later reverse as a reversal', () => {
    const tpe = { trainOrigin: 'SCARBRO', trainDest: 'MNCRIAP' }
    const consist: ConsistData = {
      parsedAt: '',
      company: null,
      companyDarwin: 'TP',
      core: null,
      diagramDate: '2026-10-03',
      allocations: [
        alloc(1, 'SCARBRO', 'YORK', '2026-10-03T19:53:00', '2026-10-03T20:46:00', 1, '185103', tpe),
        alloc(2, 'YORK', 'LEEDS', '2026-10-03T20:57:00', '2026-10-03T21:37:00', 1, '185118', { ...tpe, reversed: true }),
        alloc(3, 'LEEDS', 'MNCRIAP', '2026-10-03T21:45:00', '2026-10-03T23:14:00', 1, '185118', tpe),
      ],
    }
    const stages = collectPtacStages(consist)
    expect(stages).toHaveLength(3)
    expect(classifyStageBoundary(stages[0], stages[1])).toBe('swap')
    expect(classifyStageBoundary(stages[1], stages[2])).toBe('reversal')
  })
})
