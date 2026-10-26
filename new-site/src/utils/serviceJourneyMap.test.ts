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
  pointsOnTheLeg,
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

  it('keeps a shared CRS code on the calling point, not the other network', () => {
    const shared = [
      { crsCode: 'BNA', tiploc: '', stationName: 'Bellarena', latitude: 55.1269, longitude: -6.95136 },
      { crsCode: 'BNA', tiploc: 'BAGE', stationName: 'Burnage', latitude: 53.4219, longitude: -2.2151 },
    ]
    const burnage = stop('BAGE', 'Burnage', 'PP', { crs: 'BNA', lat: 53.42088, lng: -2.21419 })
    expect(matchStationCoord(burnage, shared)?.stationName).toBe('Burnage')
    expect(journeyMapStops([burnage], shared)[0]).toMatchObject({ lat: 53.4219, lng: -2.2151 })
    const onlyElsewhere = [shared[0]]
    expect(matchStationCoord(burnage, onlyElsewhere)).toBeNull()
    expect(journeyMapStops([burnage], onlyElsewhere)[0]).toMatchObject({ lat: 53.42088, lng: -2.21419 })
  })

  it('uses the calling TIPLOC when the catalogue CRS pin is the other lines', () => {
    const dc = [
      { crsCode: 'BSH', tiploc: 'BUSHYDC', stationName: 'Bushey', latitude: 51.64575, longitude: -0.38532 },
    ]
    const bushey = stop('BUSHEY', 'Bushey', 'PP', { crs: 'BSH', lat: 51.64508, lng: -0.38315, platform: '3' })
    expect(tiplocsNeedingCoordinates([bushey], dc)).toEqual(['BUSHEY'])
    expect(journeyMapStops([bushey], dc, { BUSHEY: { lat: 51.64558, lng: -0.38475 } })[0]).toMatchObject({
      lat: 51.64558,
      lng: -0.38475,
    })
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

  it('routes through a station pass that is still ahead and leaves the junction as a marker', () => {
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

  it('leaves Ardwick East Junction off the route to Longsight', () => {
    const mapped = journeyMapStops(
      [
        stop('MNCRLRD', 'Manchester London Road', 'PP', { lat: 53.47434, lng: -2.22032 }),
        stop('ARDWCKJ', 'Ardwick Junction', 'PP', { lat: 53.47254, lng: -2.21573 }),
        stop('ARDWKEJ', 'Ardwick East Junction', 'PP', { lat: 53.47087, lng: -2.20739 }),
        stop('LNGSTN', 'Longsight North', 'PP', { lat: 53.46727, lng: -2.2065 }),
      ],
      [],
    )
    expect(mapped.find((point) => point.tpl === 'ARDWKEJ')?.kind).toBe('junction')
    expect(mappedRouteWaypoints(mapped)).toEqual([
      [53.47434, -2.22032],
      [53.46727, -2.2065],
    ])
  })

  it('routes the dogleg through the junctions that leave the straight chord', () => {
    const mapped = journeyMapStops(
      [
        stop('LEEDS', 'Leeds', 'OR', { lat: 53.79537, lng: -1.54644 }),
        stop('STRTJN', 'Stourton Junction', 'PP', { lat: 53.76683, lng: -1.4986 }),
        stop('METHLYJ', 'Methley Junction', 'PP', { lat: 53.72982, lng: -1.40092 }),
        stop('ALTFTJN', 'Altofts Junction', 'PP', { lat: 53.70958, lng: -1.41324 }),
        stop('WKFLDKG', 'Wakefield Kirkgate', 'IP', { lat: 53.67839, lng: -1.48698 }),
      ],
      [],
    )
    expect(mapped.filter((point) => point.kind === 'junction')).toHaveLength(3)
    expect(mappedRouteWaypoints(mapped)).toEqual([
      [53.79537, -1.54644],
      [53.76683, -1.4986],
      [53.72982, -1.40092],
      [53.67839, -1.48698],
    ])
  })

  it('drops a pass whose pin is not between the stops either side', () => {
    const kept = pointsOnTheLeg(
      [
        stop('LOWMOOR', 'Low Moor', 'IP', { lat: 53.74968, lng: -1.75184 }),
        stop('MLLNJN', 'Mill Lane Junction', 'PP', { lat: 53.70662, lng: -1.88997 }),
        stop('BRADIN', 'Bradford Interchange', 'DT', { lat: 53.79083, lng: -1.74803 }),
      ],
      (point) => point.slot === 'PP',
    )
    expect(kept.map((point) => point.tpl)).toEqual(['LOWMOOR', 'BRADIN'])

    const curved = pointsOnTheLeg(
      [
        stop('BRHOUSE', 'Brighouse', 'IP', { lat: 53.69794, lng: -1.77789 }),
        stop('GRTLNDJ', 'Greetland Junction', 'PP', { lat: 53.69356, lng: -1.85603 }),
        stop('DYCLJN', 'Dryclough Junction', 'PP', { lat: 53.70858, lng: -1.85366 }),
      ],
      (point) => point.slot === 'PP',
    )
    expect(curved.map((point) => point.tpl)).toEqual(['BRHOUSE', 'GRTLNDJ', 'DYCLJN'])
  })

  it('leaves a junction off the route when it is not on the leg', () => {
    const mapped = journeyMapStops(
      [
        stop('LVRPLSH', 'Liverpool Lime Street', 'OR', { lat: 53.407, lng: -2.976 }),
        stop('SIDEJN', 'Side Junction', 'PP', { lat: 53.55, lng: -2.6 }),
        stop('MNCROXR', 'Manchester Oxford Road', 'IP', { lat: 53.474, lng: -2.242 }),
      ],
      [],
    )
    expect(mappedRouteWaypoints(mapped)).toEqual([
      [53.407, -2.976],
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

  it('runs a pass along the booked platform in the direction of travel', () => {
    const mapped = journeyMapStops(
      [
        stop('HROW', 'Harrow', 'PP', { lat: 51.592, lng: -0.335 }),
        stop('BUSHEY', 'Bushey', 'PP', { lat: 51.64558, lng: -0.38475, platform: '3' }),
        stop('KLGL', 'Kings Langley', 'PP', { lat: 51.706, lng: -0.438 }),
      ],
      [],
    )
    expect(mappedRouteWaypoints(mapped, {
      1: {
        lat: 51.6455342,
        lng: -0.3849352,
        ends: [
          { lat: 51.6455342, lng: -0.3849352 },
          { lat: 51.6451057, lng: -0.3850758 },
        ],
      },
    })).toEqual([
      [51.592, -0.335],
      [51.6451057, -0.3850758],
      [51.6455342, -0.3849352],
      [51.706, -0.438],
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

  it('drops a retrace when the line reaches that station again, and keeps a real reversal', () => {
    const through: [number, number][] = []
    for (let i = 0; i <= 8; i++) through.push([53.48 - i * 0.004, -2.2])
    const spur: [number, number][] = []
    for (let i = 1; i <= 6; i++) spur.push([53.464 + i * 0.003, -2.19])
    for (let i = 5; i >= 0; i--) spur.push([53.464 + i * 0.003, -2.1904])
    const path = [...through.slice(0, 5), ...spur, ...through.slice(4)]
    const station: [number, number] = [53.464, -2.2]
    const cleaned = removeRouteReversals(path, 40, 70, 8000, [through[0], station, through[8]])
    expect(Math.max(...cleaned.map((point) => point[1]))).toBeLessThan(-2.195)
    expect(cleaned.some((point) => Math.abs(point[0] - station[0]) < 0.002)).toBe(true)

    const reversal: [number, number][] = []
    for (let i = 0; i <= 6; i++) reversal.push([53.4 + i * 0.004, -1.46])
    for (let i = 5; i >= 0; i--) reversal.push([53.4 + i * 0.004, -1.4603])
    const terminus: [number, number] = [53.424, -1.46]
    const kept = removeRouteReversals(reversal, 40, 70, 8000, [reversal[0], terminus])
    expect(Math.max(...kept.map((point) => point[0]))).toBeGreaterThan(53.42)
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

  it('moves from the last report toward the next stop as time passes', () => {
    const stops = [
      stop('LEEDS', 'Leeds', 'OR', { crs: 'LDS', ptd: '12:00', atd: '12:00', liveKind: 'actual' }),
      stop('YORK', 'York', 'DT', { crs: 'YRK', pta: '12:20' }),
    ]
    const mapped = journeyMapStops(stops, stations)
    const location = {
      phase: 'between' as const,
      last: { tiploc: 'LEEDS', crs: 'LDS', kind: 'stop' as const, at: '12:00' },
      next: { tiploc: 'YORK', crs: 'YRK', kind: 'stop' as const },
      label: 'Between Leeds and York',
    }
    const halfway = liveJourneyPosition(stops, mapped, location, 12 * 3600 + 10 * 60 + 30)
    const later = liveJourneyPosition(stops, mapped, location, 12 * 3600 + 18 * 60)
    expect(halfway?.atStation).toBe(false)
    expect(halfway?.t).toBeCloseTo(0.525, 5)
    expect(halfway?.lat).toBeGreaterThan(53.795)
    expect(halfway?.lat).toBeLessThan(53.958)
    expect(later?.t).toBeCloseTo(0.9, 5)
    expect(later?.lat).toBeGreaterThan(halfway?.lat ?? 0)
    expect(halfway?.label).toBe('Between Leeds and York')
    expect(halfway?.to?.name).toBe('York')
  })

  it('moves on the live forecast rather than the public arrival', () => {
    const stops = [
      stop('LEEDS', 'Leeds', 'OR', { crs: 'LDS', ptd: '12:00', atd: '12:10', liveKind: 'actual', liveTime: '12:10' }),
      stop('YORK', 'York', 'DT', { crs: 'YRK', pta: '12:20', liveKind: 'est-arr', liveTime: '12:30' }),
    ]
    const mapped = journeyMapStops(stops, stations)
    const location = {
      phase: 'between' as const,
      last: { tiploc: 'LEEDS', crs: 'LDS', kind: 'stop' as const, at: '12:10' },
      next: { tiploc: 'YORK', crs: 'YRK', kind: 'stop' as const },
      label: 'Between Leeds and York',
    }
    const atPublicArrival = liveJourneyPosition(stops, mapped, location, 12 * 3600 + 20 * 60)
    const atForecast = liveJourneyPosition(stops, mapped, location, 12 * 3600 + 30 * 60)
    expect(atPublicArrival?.t).toBeCloseTo(0.5, 5)
    expect(atForecast?.t).toBeCloseTo(1, 5)
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
