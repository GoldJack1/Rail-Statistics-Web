import { describe, expect, it } from 'vitest'
import { densifyAlongWays, keepLeftHandTrack, railPathFromWays, routeLeavesTheRailway, routeOnRailWays } from './osmRailPath'

describe('osm rail path', () => {
  it('follows the railway curve instead of the chord when the router has left the corridor', () => {
    const curve = [
      { lat: 51.5045, lng: -0.0862 },
      { lat: 51.5032, lng: -0.095 },
      { lat: 51.5066, lng: -0.1032 },
    ]
    const path = railPathFromWays([curve], [
      [51.5045, -0.0862],
      [51.5066, -0.1032],
    ])
    expect(path?.some((point) => Math.abs(point[0] - 51.5032) < 0.0001)).toBe(true)
    expect(routeLeavesTheRailway(
      [[51.5045, -0.0862], [51.5066, -0.1032]],
      [[51.5045, -0.0862], [51.55, -0.2], [51.5066, -0.1032]],
    )).toBe(true)
  })

  it('stays on its own track when the parallel road never joins', () => {
    const on = [
      { lat: 53.4, lng: -2.2 },
      { lat: 53.42, lng: -2.2 },
    ]
    const beside = [
      { lat: 53.4, lng: -2.20008 },
      { lat: 53.42, lng: -2.20008 },
    ]
    const path: [number, number][] = [
      [53.402, -2.2],
      [53.408, -2.2],
      [53.414, -2.2],
    ]
    const shaped = keepLeftHandTrack(path, [on, beside], [path[0]])
    for (const point of shaped) expect(point[1]).toBeCloseTo(-2.2, 5)
  })

  it('crosses to the left-hand track where the roads join', () => {
    const right = [
      { lat: 53.4, lng: -2.2 },
      { lat: 53.409, lng: -2.2 },
      { lat: 53.42, lng: -2.2 },
    ]
    const left = [
      { lat: 53.409, lng: -2.2 },
      { lat: 53.4094, lng: -2.20008 },
      { lat: 53.42, lng: -2.20008 },
    ]
    const path: [number, number][] = [
      [53.402, -2.2],
      [53.406, -2.2],
      [53.4094, -2.2],
      [53.416, -2.2],
    ]
    const shaped = keepLeftHandTrack(path, [right, left], [path[0]])
    expect(shaped[0][1]).toBeCloseTo(-2.2, 5)
    expect(shaped.some((point) => Math.abs(point[0] - 53.409) < 0.0003 && point[1] < -2.1999)).toBe(true)
    expect(shaped[shaped.length - 1][1]).toBeLessThan(-2.20004)
  })

  it('uses the left-hand road at a junction when the train is running south', () => {
    const west = [
      { lat: 53.42, lng: -2.20008 },
      { lat: 53.408, lng: -2.20008 },
      { lat: 53.4, lng: -2.20008 },
    ]
    const east = [
      { lat: 53.408, lng: -2.20008 },
      { lat: 53.4076, lng: -2.2 },
      { lat: 53.4, lng: -2.2 },
    ]
    const path: [number, number][] = [
      [53.416, -2.20008],
      [53.411, -2.20008],
      [53.4076, -2.20008],
      [53.402, -2.20008],
    ]
    const shaped = keepLeftHandTrack(path, [west, east], [path[0]])
    expect(shaped[shaped.length - 1][1]).toBeGreaterThan(-2.20004)
  })

  it('follows the rails through a bend instead of the straight gap', () => {
    const bend = [
      { lat: 53.6752, lng: -1.656 },
      { lat: 53.6746, lng: -1.6589 },
      { lat: 53.6743, lng: -1.661 },
    ]
    const filled = densifyAlongWays(
      [[53.6752, -1.656], [53.6743, -1.661]],
      [bend],
    )
    expect(filled.some((point) => Math.abs(point[0] - 53.6746) < 0.0002)).toBe(true)
  })

  it('leaves a segment that already lies on the rail', () => {
    const rail = [
      { lat: 53.6752, lng: -1.656 },
      { lat: 53.6749, lng: -1.657 },
      { lat: 53.6746, lng: -1.658 },
    ]
    const filled = densifyAlongWays(
      [[53.6752, -1.656], [53.6749, -1.657]],
      [rail],
    )
    expect(filled).toEqual([[53.6752, -1.656], [53.6749, -1.657]])
  })

  it('uses the bent Huddersfield line instead of the coarse edge', () => {
    const coarse = [
      { lat: 53.6749, lng: -1.65784 },
      { lat: 53.67431, lng: -1.66011 },
    ]
    const full = [
      [53.67632, -1.6498], [53.67626, -1.65045], [53.67616, -1.65128], [53.67606, -1.65203],
      [53.67593, -1.65291], [53.67575, -1.65392], [53.67555, -1.65484], [53.67536, -1.65574],
      [53.67515, -1.65666], [53.67486, -1.6578], [53.67449, -1.65924], [53.67427, -1.66006],
      [53.67387, -1.66131], [53.67326, -1.66319], [53.67304, -1.66393], [53.67258, -1.66573],
      [53.67238, -1.6665], [53.67215, -1.66753], [53.67166, -1.66985], [53.67131, -1.67166],
      [53.67111, -1.67296], [53.67095, -1.67413], [53.6709, -1.6746],
    ].map(([lat, lng]) => ({ lat, lng }))
    const filled = densifyAlongWays([[53.6749, -1.65784], [53.67431, -1.66011]], [coarse, full])
    expect(filled.some((point) => Math.abs(point[0] - 53.67449) < 0.00005)).toBe(true)
  })

  it('uses the bent rail instead of the long straight edge beside it', () => {
    const coarse = [
      { lat: 53.6749, lng: -1.65784 },
      { lat: 53.67431, lng: -1.66011 },
    ]
    const bent = [
      { lat: 53.67486, lng: -1.6578 },
      { lat: 53.67449, lng: -1.65924 },
      { lat: 53.67427, lng: -1.66006 },
    ]
    const filled = densifyAlongWays(
      [[53.6749, -1.65784], [53.67431, -1.66011]],
      [coarse, bent],
    )
    expect(filled.some((point) => Math.abs(point[0] - 53.67449) < 0.00005)).toBe(true)
  })

  it('follows the junction instead of the diagonal across it', () => {
    const west = [
      { lat: 53.675, lng: -1.66 },
      { lat: 53.674, lng: -1.66 },
      { lat: 53.672, lng: -1.66 },
    ]
    const through = [
      { lat: 53.674, lng: -1.66 },
      { lat: 53.6735, lng: -1.6585 },
      { lat: 53.673, lng: -1.657 },
    ]
    const filled = densifyAlongWays(
      [[53.6748, -1.66], [53.6732, -1.6572]],
      [west, through],
    )
    expect(filled.some((point) => Math.abs(point[0] - 53.674) < 0.0002 && Math.abs(point[1] + 1.66) < 0.0002)).toBe(true)
    expect(filled.some((point) => !Number.isFinite(point[0]))).toBe(false)
  })

  it('uses the mapped curve when the straight edge is only a simplification', () => {
    const start = { lat: 53.15614, lng: -1.39227 }
    const end = { lat: 53.14123, lng: -1.38267 }
    const curve = []
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      curve.push({
        lat: start.lat + (end.lat - start.lat) * t + Math.sin(Math.PI * t) * 0.008,
        lng: start.lng + (end.lng - start.lng) * t,
      })
    }
    const filled = densifyAlongWays(
      [[start.lat, start.lng], [end.lat, end.lng]],
      [[start, end], curve],
    )
    expect(filled.some((point) => point[0] > 53.1565)).toBe(true)
  })

  it('does not replace a rail edge with a different route that wanders off', () => {
    const start = { lat: 53.15614, lng: -1.39227 }
    const end = { lat: 53.14123, lng: -1.38267 }
    const detour = []
    for (let i = 0; i <= 20; i++) {
      const t = i / 20
      detour.push({
        lat: start.lat + (end.lat - start.lat) * t + Math.sin(Math.PI * t) * 0.02,
        lng: start.lng + (end.lng - start.lng) * t,
      })
    }
    const filled = densifyAlongWays(
      [[start.lat, start.lng], [end.lat, end.lng]],
      [[start, end], detour],
    )
    expect(filled.some((point) => point[0] > 53.162)).toBe(false)
  })

  it('follows the bend instead of the long straight edge', () => {
    const start = { lat: 53.6749, lng: -1.65784 }
    const end = { lat: 53.67431, lng: -1.66011 }
    const mid = { lat: 53.67449, lng: -1.65924 }
    const path = railPathFromWays(
      [[start, end], [start, mid, end]],
      [[start.lat, start.lng], [end.lat, end.lng]],
    )
    expect(path?.some((point) => Math.abs(point[0] - mid.lat) < 0.00005)).toBe(true)
  })

  it('stays on the through rail when a junction is a short step off it', () => {
    const through = [
      { lat: 53.4728, lng: -2.2172 },
      { lat: 53.4702, lng: -2.212 },
      { lat: 53.4675, lng: -2.208 },
    ]
    const spur = [
      { lat: 53.4702, lng: -2.212 },
      { lat: 53.47115, lng: -2.2089 },
      { lat: 53.4702, lng: -2.212 },
    ]
    const path = routeOnRailWays(
      [through, spur],
      [[53.4728, -2.2172], [53.47115, -2.2089], [53.4675, -2.208]],
    )
    expect(path?.some((point) => Math.abs(point[0] - 53.47115) < 0.0002)).toBe(false)
    expect(path?.some((point) => Math.abs(point[0] - 53.4702) < 0.0002)).toBe(true)
  })

  it('keeps a dogleg when that is the railway between the timing points', () => {
    const dogleg = [
      { lat: 53.7668, lng: -1.4986 },
      { lat: 53.748, lng: -1.45 },
      { lat: 53.7298, lng: -1.4009 },
      { lat: 53.718, lng: -1.41 },
      { lat: 53.7096, lng: -1.4132 },
    ]
    const path = routeOnRailWays(
      [dogleg],
      [[53.7668, -1.4986], [53.7298, -1.4009], [53.7096, -1.4132]],
    )
    expect(path?.some((point) => Math.abs(point[0] - 53.7298) < 0.0002)).toBe(true)
  })

  it('does not draw a straight across rails that do not join', () => {
    const filled = densifyAlongWays(
      [[51.5, -0.1], [51.6, -0.2]],
      [
        [{ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.1 }],
        [{ lat: 51.6, lng: -0.2 }, { lat: 51.61, lng: -0.2 }],
      ],
    )
    expect(filled.some((point) => !Number.isFinite(point[0]))).toBe(true)
  })

  it('does not invent a line where the tracks do not connect', () => {
    expect(railPathFromWays(
      [
        [{ lat: 51.5, lng: -0.1 }, { lat: 51.51, lng: -0.1 }],
        [{ lat: 51.6, lng: -0.2 }, { lat: 51.61, lng: -0.2 }],
      ],
      [[51.5, -0.1], [51.6, -0.2]],
    )).toBeNull()
  })
})
