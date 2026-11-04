import { afterEach, describe, expect, it } from 'vitest'
import {
  clearDeparturesBoardFilters,
  narrowSelection,
  readDeparturesBoardFilters,
  selectionFromDropdown,
  writeDeparturesBoardFilters,
  type DeparturesBoardFilters,
} from './departuresBoardFiltersStorage'

const stored: DeparturesBoardFilters = {
  code: 'LDS',
  boardMode: 'arrivals',
  toc: ['LNER'],
  serviceTypes: null,
  platforms: [],
  statuses: ['delayed'],
  places: null,
  stopModes: ['calling'],
}

describe('departures board filter selection', () => {
  it('treats null as every option and an empty list as none', () => {
    expect(narrowSelection(null, ['A', 'B'])).toEqual(['A', 'B'])
    expect(narrowSelection([], ['A', 'B'])).toEqual([])
    expect(narrowSelection(['A', 'C'], ['A', 'B'])).toEqual(['A'])
  })

  it('keeps Clear All empty and collapses Select All', () => {
    expect(selectionFromDropdown([], ['A', 'B'])).toEqual([])
    expect(selectionFromDropdown(['A', 'B'], ['A', 'B'])).toBeNull()
    expect(selectionFromDropdown(['B'], ['A', 'B'])).toEqual(['B'])
  })
})

describe('departuresBoardFiltersStorage', () => {
  afterEach(() => {
    clearDeparturesBoardFilters()
  })

  it('restores filters only for the same station', () => {
    writeDeparturesBoardFilters(stored)
    expect(readDeparturesBoardFilters('LDS')).toEqual(stored)
    expect(readDeparturesBoardFilters('YRK')).toBeNull()
  })

  it('drops the saved board after a new search', () => {
    writeDeparturesBoardFilters(stored)
    clearDeparturesBoardFilters()
    expect(readDeparturesBoardFilters('LDS')).toBeNull()
  })
})
