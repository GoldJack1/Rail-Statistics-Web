import { describe, expect, it } from 'vitest'
import { railPathFromWays, routeLeavesTheRailway } from './osmRailPath'

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
