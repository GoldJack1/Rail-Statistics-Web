import { describe, expect, it } from 'vitest'

import { filterDpaygStations, matchDpaygStation } from './dpaygStationSearch'

const londonStations = [
  { crs: '910GPADTON', name: 'London Paddington Rail Station' },
  { crs: '940GZZLUKSX', name: "King's Cross St. Pancras Underground Station" },
  { crs: '910GEUSTON', name: 'London Euston Rail Station' },
  { crs: '910GSTANAIR', name: 'Stansted Airport Rail Station' },
  { crs: '910GLIVST', name: 'London Liverpool Street Rail Station' },
  { crs: 'ABA', name: 'Aberdare' },
]

describe('dpaygStationSearch', () => {
  it('matches kings cross despite the apostrophe', () => {
    const matches = filterDpaygStations(londonStations, 'kings cross')
    expect(matches.map((s) => s.crs)).toContain('940GZZLUKSX')
  })

  it('matches the common Stanstead misspelling and airport typo', () => {
    const matches = filterDpaygStations(londonStations, 'stanstead aiport')
    expect(matches).toEqual([
      expect.objectContaining({ crs: '910GSTANAIR', name: 'Stansted Airport Rail Station' }),
    ])
  })

  it('still matches TfW CRS codes', () => {
    expect(matchDpaygStation(londonStations, 'aba')?.name).toBe('Aberdare')
    expect(matchDpaygStation(londonStations, 'Aberdare (ABA)')?.crs).toBe('ABA')
  })

  it('ranks Paddington above weaker substring hits', () => {
    const matches = filterDpaygStations(londonStations, 'paddington')
    expect(matches[0]?.crs).toBe('910GPADTON')
  })

  it('matches National Rail CRS when the matrix key is a Naptan id', () => {
    const stations = [
      { crs: '910GEUSTON', name: 'London Euston Rail Station', displayCrs: 'EUS' },
    ]
    expect(matchDpaygStation(stations, 'eus')?.crs).toBe('910GEUSTON')
    expect(filterDpaygStations(stations, 'eus')[0]?.crs).toBe('910GEUSTON')
  })

  it('keeps London Liverpool Street mainline instead of collapsing onto Tube', () => {
    const stations = [
      { crs: '940GZZLULVT', name: 'Liverpool Street Underground Station', displayCrs: 'LST' },
      { crs: '910GLIVSTLL', name: 'Liverpool Street', displayCrs: 'LST' },
      { crs: '910GLIVST', name: 'London Liverpool Street Rail Station', displayCrs: 'LST' },
    ]
    expect(
      matchDpaygStation(stations, 'London Liverpool Street Rail Station (LST)')?.crs
    ).toBe('910GLIVST')
    expect(matchDpaygStation(stations, 'LST')?.crs).toBe('910GLIVST')
    expect(filterDpaygStations(stations, 'liverpool street')[0]?.crs).toBe('910GLIVST')
    expect(filterDpaygStations(stations, 'london liverpool street')[0]?.crs).toBe('910GLIVST')
  })
})
