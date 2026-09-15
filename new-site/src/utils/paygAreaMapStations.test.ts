import { describe, expect, it } from 'vitest'

import type { Station } from '@/types'
import {
  matchPaygStationsToDatabaseStations,
  matchPaygStationsToMapPoints,
  paygStationLookupCrs,
} from './paygAreaMapStations'

function dbStation(partial: Partial<Station> & Pick<Station, 'id' | 'stationName' | 'crsCode'>): Station {
  return {
    tiploc: null,
    latitude: 51.5,
    longitude: -0.1,
    country: 'England',
    county: null,
    toc: null,
    stnarea: null,
    yearlyPassengers: null,
    sourceCollectionId: 'stations_gbnr',
    ...partial,
  }
}

describe('paygStationLookupCrs', () => {
  it('prefers a 3-letter display CRS over a Naptan matrix id', () => {
    expect(
      paygStationLookupCrs({
        crs: '910GEUSTON',
        name: 'London Euston Rail Station',
        displayCrs: 'EUS',
      })
    ).toBe('EUS')
  })

  it('uses the matrix CRS when it is already National Rail', () => {
    expect(paygStationLookupCrs({ crs: 'trr', name: 'Truro' })).toBe('TRR')
  })

  it('skips Naptan-only stops', () => {
    expect(
      paygStationLookupCrs({
        crs: '940GZZLUKSX',
        name: "King's Cross St. Pancras Underground Station",
      })
    ).toBeNull()
  })
})

describe('matchPaygStationsToMapPoints', () => {
  it('joins PAYG stops to the stations database by CRS', () => {
    const points = matchPaygStationsToMapPoints(
      [
        { crs: 'TRR', name: 'Truro' },
        { crs: '910GPADTON', name: 'London Paddington Rail Station', displayCrs: 'PAD' },
        { crs: '940GZZLUKSX', name: "King's Cross St. Pancras Underground Station" },
      ],
      [
        dbStation({ id: 'trr', stationName: 'Truro', crsCode: 'TRR', latitude: 50.27, longitude: -5.06 }),
        dbStation({ id: 'pad', stationName: 'London Paddington', crsCode: 'PAD', latitude: 51.52, longitude: -0.18 }),
      ]
    )
    expect(points.map((point) => point.crs).sort()).toEqual(['PAD', 'TRR'])
  })

  it('keeps one marker when several PAYG rows share a CRS', () => {
    const points = matchPaygStationsToMapPoints(
      [
        { crs: '910GLIVST', name: 'London Liverpool Street Rail Station', displayCrs: 'LST' },
        { crs: '940GZZLULVT', name: 'Liverpool Street Underground Station', displayCrs: 'LST' },
      ],
      [dbStation({ id: 'lst', stationName: 'London Liverpool Street', crsCode: 'LST' })]
    )
    expect(points).toHaveLength(1)
    expect(points[0]?.crs).toBe('LST')
  })

  it('returns database stations for the main map markers', () => {
    const matched = matchPaygStationsToDatabaseStations(
      [{ crs: 'TRR', name: 'Truro' }],
      [dbStation({ id: 'trr', stationName: 'Truro', crsCode: 'TRR', latitude: 50.27, longitude: -5.06 })]
    )
    expect(matched).toEqual([
      expect.objectContaining({
        id: 'trr',
        crsCode: 'TRR',
        sourceCollectionId: 'stations_gbnr',
      }),
    ])
  })
})
