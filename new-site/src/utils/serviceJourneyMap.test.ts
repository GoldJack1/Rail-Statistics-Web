import { describe, expect, it } from 'vitest'
import type { ServiceStop } from '../types/darwin'
import {
  applyEurostarRailMiles,
  continentalEurostarCoordinate,
  eurostarRailChains,
  metresAlongWaypoints,
  pathLengthMetres,
} from './eurostarContinental'
import { formatMilesAndChains } from './milesAndChains'
import {
  interpolateAlongPath,
  interpolateLatLng,
  journeyMapStops,
  journeyPointKind,
  liveJourneyPosition,
  mappedRouteWaypoints,
  matchStationCoord,
  removeRouteReversals,
  replaceInflatedLegs,
  snapLiveToRailPath,
  snapMarkerToPath,
  tiplocsNeedingCoordinates,
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

  it('routes through a station pass that is still ahead and does not use a junction as a via', () => {
    const mapped = journeyMapStops(
      [
        stop('LVRPLSH', 'Liverpool Lime Street', 'OR', { lat: 53.407, lng: -2.976 }),
        stop('TRFDPEJ', 'Trafford Park East Junction', 'PP', { lat: 53.463, lng: -2.288 }),
        stop('URMSTON', 'Urmston', 'PP', { lat: 53.448, lng: -2.353 }),
        stop('MNCROXR', 'Manchester Oxford Road', 'IP', { lat: 53.474, lng: -2.242 }),
      ],
      [],
    )
    expect(mapped.map((point) => point.tpl)).toEqual(['LVRPLSH', 'TRFDPEJ', 'URMSTON', 'MNCROXR'])
    expect(mapped.find((point) => point.tpl === 'TRFDPEJ')?.kind).toBe('junction')
    expect(mappedRouteWaypoints(mapped)).toEqual([
      [53.407, -2.976],
      [53.448, -2.353],
      [53.474, -2.242],
    ])
  })

  it('stands a Doncaster call at the stopping mark, not the platform entrance', () => {
    const mapped = journeyMapStops(
      [
        stop('LEEDS', 'Leeds', 'OR', { lat: 53.795, lng: -1.548 }),
        stop('DONC', 'Doncaster', 'DT', { lat: 53.522, lng: -1.14, platform: '6' }),
      ],
      [],
    )
    const route = mappedRouteWaypoints(mapped, {
      1: {
        lat: 53.5229,
        lng: -1.1401,
        ends: [
          { lat: 53.52341, lng: -1.14001 },
          { lat: 53.52237, lng: -1.14017 },
        ],
        stand: { lat: 53.52249, lng: -1.1401 },
      },
    })
    expect(route).toEqual([
      [53.795, -1.548],
      [53.52249, -1.1401],
    ])
  })

  it('starts a bay at the buffer and leaves along the platform', () => {
    const mapped = journeyMapStops(
      [
        stop('LEEDS', 'Leeds', 'OR', { lat: 53.794, lng: -1.549, platform: '13' }),
        stop('LEEDSWJ', 'Leeds West Junction', 'PP', { lat: 53.79259, lng: -1.55573 }),
        stop('WIGAN', 'Wigan Wallgate', 'DT', { lat: 53.544, lng: -2.632 }),
      ],
      [],
    )
    expect(mapped.find((point) => point.tpl === 'LEEDSWJ')?.kind).toBe('junction')
    expect(
      mappedRouteWaypoints(mapped, {
        0: {
          lat: 53.7939,
          lng: -1.5491,
          ends: [
            { lat: 53.7939, lng: -1.5482 },
            { lat: 53.7939, lng: -1.55 },
          ],
          bay: { lat: 53.7939, lng: -1.5482 },
        },
      }),
    ).toEqual([
      [53.7939, -1.5482],
      [53.544, -2.632],
    ])
  })

  it('aims a call at its booked platform so the line can take that road', () => {
    const mapped = journeyMapStops(
      [
        stop('MNCROXR', 'Manchester Oxford Road', 'IP', { lat: 53.474, lng: -2.242, platform: '4' }),
        stop('STKP', 'Stockport', 'IP', { lat: 53.40556, lng: -2.16301, platform: '0' }),
        stop('SHEFFLD', 'Sheffield', 'IP', { lat: 53.378, lng: -1.462, platform: '5A' }),
      ],
      [],
    )
    const stockport = mapped.find((point) => point.tpl === 'STKP')
    expect(stockport?.index).toBe(1)
    expect(
      mappedRouteWaypoints(mapped, { 1: { lat: 53.40584, lng: -2.1627 } }),
    ).toEqual([
      [53.474, -2.242],
      [53.40584, -2.1627],
      [53.378, -1.462],
    ])
  })

  it('routes a pass along its platform and skips a platform back behind the train', () => {
    const mapped = journeyMapStops(
      [
        stop('MNCROXR', 'Manchester Oxford Road', 'IP', { lat: 53.474, lng: -2.243 }),
        stop('STKP', 'Stockport', 'PP', { lat: 53.40556, lng: -2.163, platform: '0' }),
        stop('SHEFFLD', 'Sheffield', 'IP', { lat: 53.378, lng: -1.462 }),
        stop('BACK', 'Back', 'PP', { lat: 53.47, lng: -2.24, platform: '2' }),
      ],
      [],
    )
    // Back is listed after Stockport, so the next call is already Sheffield and Back is not on that leg.
    const ordered = journeyMapStops(
      [
        stop('MNCROXR', 'Manchester Oxford Road', 'IP', { lat: 53.474, lng: -2.243 }),
        stop('STKP', 'Stockport', 'IP', { lat: 53.4056, lng: -2.163 }),
        stop('BACK', 'Back', 'PP', { lat: 53.47, lng: -2.24, platform: '2' }),
        stop('SHEFFLD', 'Sheffield', 'IP', { lat: 53.378, lng: -1.462 }),
      ],
      [],
    )
    expect(mappedRouteWaypoints(mapped, { 1: { lat: 53.40584, lng: -2.1627 } })).toEqual([
      [53.474, -2.243],
      [53.40584, -2.1627],
      [53.378, -1.462],
    ])
    expect(mappedRouteWaypoints(ordered, { 2: { lat: 53.47, lng: -2.24 } })).toEqual([
      [53.474, -2.243],
      [53.4056, -2.163],
      [53.378, -1.462],
    ])
  })

  it('plots a junction from the TIPLOC file ahead of the schedule coordinate', () => {
    const holbeck = stop('HOLBJCN', 'Holbeck Jn', 'PP', { wtp: '12:01', lat: 53.8, lng: -1.5 })
    expect(journeyMapStops([holbeck], []).map((p) => p.tpl)).toEqual(['HOLBJCN'])
    expect(tiplocsNeedingCoordinates([holbeck])).toEqual(['HOLBJCN'])
    const mapped = journeyMapStops([holbeck], [], { HOLBJCN: { lat: 53.789, lng: -1.555 } })
    expect(mapped[0]).toMatchObject({ tpl: 'HOLBJCN', lat: 53.789, lng: -1.555, calling: false, kind: 'junction' })
    const fromSchedule = journeyMapStops([holbeck], [], {})
    expect(fromSchedule[0]).toMatchObject({ lat: 53.8, lng: -1.5 })
  })

  it('uses the station catalogue ahead of a TIPLOC lookup', () => {
    const mapped = journeyMapStops(
      [stop('LEEDS', 'Leeds', 'OR', { crs: 'LDS' })],
      stations,
      { LEEDS: { lat: 51, lng: -1 } },
    )
    expect(mapped[0]).toMatchObject({ lat: 53.795, lng: -1.548, kind: 'stop' })
  })

  it('keeps a booked platform on a call and on a pass', () => {
    const mapped = journeyMapStops(
      [
        stop('LEEDS', 'Leeds', 'OR', { crs: 'LDS', platform: '15' }),
        stop('HOLBJCN', 'Holbeck Jn', 'PP', { platform: '1', lat: 53.79, lng: -1.55 }),
      ],
      stations,
    )
    expect(mapped.find((point) => point.tpl === 'LEEDS')?.platform).toBe('15')
    expect(mapped.find((point) => point.tpl === 'HOLBJCN')?.platform).toBe('1')
  })

  it('drops a multi-kilometre out-and-back and straightens a detour between timing points', () => {
    const path: [number, number][] = []
    for (let i = 0; i <= 4; i++) path.push([53.49, -2.24 + i * 0.008])
    for (let i = 1; i <= 25; i++) path.push([53.49 + i * 0.0014, -2.208])
    for (let i = 24; i >= 0; i--) path.push([53.49 + i * 0.0014, -2.2077])
    for (let i = 5; i <= 8; i++) path.push([53.49, -2.24 + i * 0.008])
    const cleaned = removeRouteReversals(path)
    expect(Math.max(...cleaned.map((p) => p[0]))).toBeLessThan(53.5)
    const waypoints: [number, number][] = [
      [53.4963, -2.2126],
      [53.4954, -2.2043],
    ]
    const detour: [number, number][] = [
      [53.4963, -2.2126],
      [53.51, -2.19],
      [53.518, -2.173],
      [53.51, -2.195],
      [53.4954, -2.2043],
    ]
    const shortened = replaceInflatedLegs(detour, waypoints)
    expect(Math.max(...shortened.map((p) => p[0]))).toBeLessThan(53.5)
    expect(shortened[0]).toEqual(waypoints[0])
    expect(shortened[shortened.length - 1]).toEqual(waypoints[waypoints.length - 1])
  })

  it('drops a reversal spur and snaps a nearby marker onto the through line', () => {
    const path: [number, number][] = [
      [53.49633, -2.2126],
      [53.496, -2.214],
      [53.49523, -2.21551],
      [53.496, -2.214],
      [53.49633, -2.2126],
      [53.4967, -2.2105],
      [53.4954, -2.20431],
    ]
    const cleaned = removeRouteReversals(path)
    expect(cleaned[0]).toEqual(path[0])
    expect(cleaned[cleaned.length - 1]).toEqual(path[path.length - 1])
    expect(cleaned.some((p) => p[0] === 53.49523)).toBe(false)
    const snapped = snapMarkerToPath({ lat: 53.49523, lng: -2.21551 }, cleaned, 800)
    expect(snapped.lng).toBeGreaterThan(-2.213)
  })

  it('colours stops, passes and junctions as separate kinds', () => {
    expect(journeyPointKind(stop('LEEDS', 'Leeds', 'OR', { crs: 'LDS' }))).toBe('stop')
    expect(journeyPointKind(stop('SBYD', 'Stalybridge', 'PP', { crs: 'SYB' }))).toBe('pass')
    expect(journeyPointKind(stop('MILESPL', 'Miles Platting Junction', 'PP', { crs: 'MLP' }))).toBe('junction')
    expect(journeyPointKind(stop('HOLBJCN', 'Holbeck Jn', 'PP'))).toBe('junction')
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

  it('keeps Eurostar junction markers off the route and plots Paris Nord on the continent', () => {
    const mapped = journeyMapStops(
      [
        stop('STPANCI', 'St Pancras International', 'OR', { crs: 'SPX', lat: 51.53253, lng: -0.1269 }),
        stop('YWAYSJN', 'York Way South Junction', 'PP', { lat: 51.54064, lng: -0.12388 }),
        stop('WENGTNX', 'Wennington Crossovers', 'PP', { lat: 51.50631, lng: 0.2075 }),
        stop('PARISND', 'Paris Nord', 'DT', { crs: 'PBN', lat: 51.07401, lng: 1.39385 }),
      ],
      [],
      { PARISND: { lat: 51.07401, lng: 1.39385 } },
    )
    expect(mapped.find((point) => point.tpl === 'YWAYSJN')?.kind).toBe('junction')
    expect(mapped.find((point) => point.tpl === 'WENGTNX')?.kind).toBe('pass')
    expect(mapped.find((point) => point.tpl === 'PARISND')).toMatchObject({
      lat: 48.8805227,
      lng: 2.3547846,
      kind: 'stop',
    })
    expect(mappedRouteWaypoints(mapped)).toEqual([
      [51.53253, -0.1269],
      [51.50631, 0.2075],
      [48.8805227, 2.3547846],
    ])
    expect(tiplocsNeedingCoordinates([
      stop('PARISND', 'Paris Nord', 'DT', { crs: 'PBN' }),
      stop('CHUNCTR', 'Eurotunnel Boundary (Ctrl)', 'PP'),
    ])).toEqual(['CHUNCTR'])
    expect(continentalEurostarCoordinate({ tpl: 'LILLE', name: 'Lille Europe', crs: 'LIU' })?.lat).toBeCloseTo(50.636, 3)
  })

  it('uses the continental pin for Paris even when the station catalogue says Folkestone', () => {
    const mapped = journeyMapStops(
      [stop('PARISND', 'Paris Nord', 'DT', { crs: 'PBN' })],
      [{ crsCode: 'PBN', tiploc: 'PARISND', stationName: 'Paris Nord', latitude: 51.074, longitude: 1.394 }],
    )
    expect(mapped[0]).toMatchObject({ lat: 48.8805227, lng: 2.3547846 })
  })

  it('extends Eurostar running miles along the rail path and drops the Folkestone chord', () => {
    const calls = [
      stop('STPANCI', 'St Pancras International', 'OR', { crs: 'SPX', cumMiles: 0 }),
      stop('YWAYSJN', 'York Way South Junction', 'PP', { cumMiles: 0.96 }),
      stop('CHUNCTR', 'Eurotunnel Boundary (Ctrl)', 'PP', { cumMiles: 68.94 }),
      stop('PARISND', 'Paris Nord', 'DT', { crs: 'PBN', cumMiles: 80.7 }),
    ]
    expect(eurostarRailChains(calls)).toEqual([[2, 3]])
    const pending = applyEurostarRailMiles(calls, {})
    expect(pending[0].cumMiles).toBe(0)
    expect(pending[1].cumMiles).toBe(0.96)
    expect(pending[2].cumMiles).toBe(68.94)
    expect(pending[3].cumMiles).toBeNull()
    expect(pending[3].cumM).toBeNull()
    const railMetres = 300_000
    const routed = applyEurostarRailMiles(calls, { '2:3': railMetres })
    const parisMetres = 68.94 * 1609.344 + railMetres
    expect(routed[3].cumM).toBeCloseTo(parisMetres, 3)
    expect(routed[3].cumMiles).toBeGreaterThan(200)
    expect(formatMilesAndChains({ metres: routed[3].cumM })).not.toBe('80m 56ch')
    const chord: [number, number][] = [
      [51.09421, 1.12965],
      [48.8805227, 2.3547846],
    ]
    const viaLille: [number, number][] = [
      [51.09421, 1.12965],
      [50.6360451, 3.0712488],
      [48.8805227, 2.3547846],
    ]
    expect(pathLengthMetres(viaLille)).toBeGreaterThan(pathLengthMetres(chord))
    const along = metresAlongWaypoints(viaLille, [viaLille[0], viaLille[2]])
    expect(along?.[1]).toBeCloseTo(pathLengthMetres(viaLille), 3)
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
