import { describe, expect, it } from 'vitest'
import type { ServiceStop } from '../types/darwin'
import {
  interpolateAlongPath,
  interpolateLatLng,
  journeyMapStops,
  liveJourneyPosition,
  matchStationCoord,
  snapLiveToRailPath,
} from './serviceJourneyMap'

function stop(tpl: string, name: string, slot: string, extra: Partial<ServiceStop> = {}): ServiceStop {
  return {
    tpl,
    name,
    crs: extra.crs ?? null,
    slot,
    pta: null,
    ptd: null,
    wta: null,
    wtd: null,
    wtp: null,
    ata: null,
    atd: null,
    atp: null,
    platform: null,
    livePlatform: null,
    activity: null,
    liveTime: null,
    liveKind: 'scheduled',
    cancelledAtStop: false,
    cancelReasonAtStop: null,
    loadingPercentage: null,
    coachLoading: null,
    actualSource: null,
    ...extra,
  }
}

const stations = [
  { crsCode: 'LDS', tiploc: 'LEEDS', stationName: 'Leeds', latitude: 53.795, longitude: -1.548 },
  { crsCode: 'YRK', tiploc: 'YORK', stationName: 'York', latitude: 53.958, longitude: -1.093 },
  { crsCode: 'XXX', tiploc: 'NOWHERE', stationName: 'Nowhere', latitude: 0, longitude: 0 },
]

describe('serviceJourneyMap', () => {
  it('matches stations by CRS then TIPLOC and skips 0,0', () => {
    expect(matchStationCoord({ crs: 'YRK', tpl: 'YORK' }, stations)?.stationName).toBe('York')
    expect(matchStationCoord({ crs: null, tpl: 'LEEDS' }, stations)?.crsCode).toBe('LDS')
    expect(matchStationCoord({ crs: 'XXX', tpl: 'NOWHERE' }, stations)).toBeNull()
  })

  it('builds mapped calling points in journey order', () => {
    const mapped = journeyMapStops(
      [
        stop('LEEDS', 'Leeds', 'OR', { crs: 'LDS', ptd: '12:00', atd: '12:00' }),
        stop('HOLBJCN', 'Holbeck Jn', 'PP', { wtp: '12:01' }),
        stop('YORK', 'York', 'DT', { crs: 'YRK', pta: '12:25' }),
      ],
      stations,
    )
    expect(mapped.map((p) => p.tpl)).toEqual(['LEEDS', 'YORK'])
  })

  it('interpolates a midpoint', () => {
    expect(interpolateLatLng({ lat: 0, lng: 0 }, { lat: 10, lng: 20 }, 0.5)).toEqual({ lat: 5, lng: 10 })
  })

  it('places the live marker at the last reported station', () => {
    const stops = [
      stop('LEEDS', 'Leeds', 'OR', { crs: 'LDS', ptd: '12:00', atd: '12:00', ata: '12:00', liveKind: 'actual' }),
      stop('YORK', 'York', 'DT', { crs: 'YRK', pta: '12:25' }),
    ]
    const mapped = journeyMapStops(stops, stations)
    const live = liveJourneyPosition(
      stops,
      mapped,
      {
        phase: 'at_station',
        last: { tiploc: 'LEEDS', crs: 'LDS', kind: 'stop', at: '12:00' },
        next: { tiploc: 'YORK', crs: 'YRK', kind: 'stop' },
        label: 'At Leeds',
      },
      12 * 3600 + 5 * 60,
    )
    expect(live?.atStation).toBe(true)
    expect(live?.lat).toBe(53.795)
    expect(live?.label).toBe('At Leeds')
  })

  it('places the live marker between stations after departure', () => {
    const stops = [
      stop('LEEDS', 'Leeds', 'OR', { crs: 'LDS', ptd: '12:00', atd: '12:00', liveKind: 'actual' }),
      stop('YORK', 'York', 'DT', { crs: 'YRK', pta: '12:20' }),
    ]
    const mapped = journeyMapStops(stops, stations)
    const live = liveJourneyPosition(
      stops,
      mapped,
      {
        phase: 'between',
        last: { tiploc: 'LEEDS', crs: 'LDS', kind: 'stop', at: '12:00' },
        next: { tiploc: 'YORK', crs: 'YRK', kind: 'stop' },
        label: 'Between Leeds and York',
      },
      12 * 3600 + 10 * 60 + 30,
    )
    expect(live?.atStation).toBe(false)
    expect(live?.t).toBeCloseTo(10.5 / 20, 5)
    expect(live?.lat).toBeCloseTo(53.795 + (53.958 - 53.795) * (10.5 / 20), 5)
    expect(live?.label).toBe('Between Leeds and York')
  })

  it('walks a rail path by distance instead of a straight line', () => {
    const path: [number, number][] = [
      [0, 0],
      [0, 1],
      [1, 1],
    ]
    const mid = interpolateAlongPath(path, 0.5)
    expect(mid.lat).toBeCloseTo(0, 5)
    expect(mid.lng).toBeCloseTo(1, 5)
  })

  it('snaps a between-stations live point onto the rail path', () => {
    const from = { index: 0, lat: 0, lng: 0, name: 'A', tpl: 'A', crs: 'AAA', calling: true, cancelled: false }
    const to = { index: 1, lat: 1, lng: 1, name: 'B', tpl: 'B', crs: 'BBB', calling: true, cancelled: false }
    const snapped = snapLiveToRailPath(
      { lat: 0.5, lng: 0.5, label: 'Between', atStation: false, from, to, t: 0.5 },
      [
        [0, 0],
        [0, 1],
        [1, 1],
      ],
    )
    expect(snapped.lat).toBeCloseTo(0, 5)
    expect(snapped.lng).toBeCloseTo(1, 5)
  })
})
