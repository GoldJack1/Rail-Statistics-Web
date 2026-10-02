import { describe, expect, it } from 'vitest'
import { classifyStageBoundary, collectPtacStages } from './ptacStages'
import type { ConsistData } from '../types/darwin'

function loc(tiploc: string) {
  return { tiploc, primaryCode: null, country: 'GB' }
}

function alloc(seq: number, orig: string, dest: string, start: string, end: string, pos: number, unitId: string) {
  return {
    sequenceNumber: seq,
    trainOrigin: loc('EDINBUR'),
    trainOriginDateTime: '2026-10-02T13:05:00',
    trainDest: loc('CRDFCEN'),
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
    reversed: false,
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
})
