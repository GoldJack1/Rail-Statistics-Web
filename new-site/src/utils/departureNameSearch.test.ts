import { describe, expect, it } from 'vitest'
import { filterDepartureNameResults, type DepartureNameHit, type DepartureNameStation } from './departureNameSearch'

const stations: DepartureNameStation[] = [
  { stationName: 'Leeds', crsCode: 'LDS', tiploc: 'LEEDS' },
  { stationName: 'Leeds Bradford Airport', crsCode: '', tiploc: null },
  { stationName: 'Headingley', crsCode: 'HDY', tiploc: 'HDINGLY' },
]

function catalog(...rows: DepartureNameHit[]): DepartureNameHit[] {
  return rows
}

describe('filterDepartureNameResults', () => {
  it('keeps dataset stations and drops other catalogue locations', () => {
    const hits = filterDepartureNameResults('lee', stations, catalog(
      { name: 'Leeds', crs: 'LDS', tiploc: 'LEEDS' },
      { name: 'Leeds West Junction', crs: 'LWJ', tiploc: 'LEEDSWJ' },
    ), true)
    expect(hits.map((hit) => hit.name)).toEqual(['Leeds', 'Leeds Bradford Airport'])
  })

  it('adds the Eurostar cities even though they are not in the dataset', () => {
    const hits = filterDepartureNameResults('paris', stations, catalog(
      { name: 'Paris Nord', crs: 'PBN', tiploc: 'PARISND' },
    ), true)
    expect(hits).toEqual([{ name: 'Paris Nord', crs: 'PBN', tiploc: 'PARISND' }])
  })

  it('recognises Antwerp from the catalogue name', () => {
    const hits = filterDepartureNameResults('antwerp', [], catalog(
      { name: 'Antwerpen Centraal', crs: 'ANR', tiploc: 'ANTWCEN' },
      { name: 'Antwerp Sidings', crs: '', tiploc: 'ANTWSDG' },
    ), true)
    expect(hits).toEqual([{ name: 'Antwerpen Centraal', crs: 'ANR', tiploc: 'ANTWCEN' }])
  })

  it('does not treat Lille Flandres as the Eurostar stop', () => {
    const hits = filterDepartureNameResults('lille', [], catalog(
      { name: 'Lille Flandres', crs: 'LIL', tiploc: 'LILLEFL' },
      { name: 'Lille Europe', crs: 'LIU', tiploc: 'LILLE' },
    ), true)
    expect(hits.map((hit) => hit.tiploc)).toEqual(['LILLE'])
  })

  it('ignores Ireland, Northern Ireland and other networks', () => {
    const hits = filterDepartureNameResults('lee', [
      { stationName: 'Leeds', crsCode: 'LDS', tiploc: 'LEEDS', sourceCollectionId: 'stations_gbnr' },
      { stationName: 'Leeds Irish Rail', crsCode: 'DUB', tiploc: 'DUBLIN', sourceCollectionId: 'stations_roiirerail' },
      { stationName: 'Leeds Translink', crsCode: 'BFP', tiploc: 'BELFAST', sourceCollectionId: 'stations_nitranslink' },
      { stationName: 'Leeds Supertram', crsCode: 'SUP', tiploc: 'SUPTRAM', sourceCollectionId: 'lightrail_GBSHEFFSUPERTRAM' },
    ], [], true)
    expect(hits).toEqual([{ name: 'Leeds', crs: 'LDS', tiploc: 'LEEDS' }])
  })

  it('waits for the dataset before listing ordinary stations', () => {
    const hits = filterDepartureNameResults('leeds', stations, [], false)
    expect(hits).toEqual([])
  })
})
