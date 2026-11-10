import { describe, expect, it } from 'vitest'
import type { LatLngTuple } from './brouterRailRoute'
import { followRailway, railwayLegFits } from './followRailway'
import { buildRailGraph, routeOnGraph } from './tracksRailGraph'

describe('followRailway', () => {
  it('replaces a long straight with the bend it jumps across', () => {
    const straight: LatLngTuple[] = [[51, -0.1], [51.1, 0]]
    const bend: LatLngTuple[] = [[51, -0.1], [51, 0], [51.1, 0]]
    const followed = followRailway(straight, () => bend)
    expect(followed.some((point) => point[0] === 51 && point[1] === 0)).toBe(true)
  })

  it('leaves a short step on the line it is already on', () => {
    const path: LatLngTuple[] = [[51, -0.1], [51.001, -0.1]]
    const followed = followRailway(path, () => {
      throw new Error('a short step is not a jump')
    })
    expect(followed).toEqual(path)
  })

  it('refuses a leg that has left for a much shorter line', () => {
    const from: LatLngTuple = [51, -0.1]
    const to: LatLngTuple = [51.05, -0.1]
    const other: LatLngTuple[] = [[51.01, -0.1], [51.02, -0.1]]
    expect(railwayLegFits(other, from, to)).toBe(false)
    expect(followRailway([from, to], () => other)).toEqual([from, to])
  })

  it('refuses a leg that wanders off the corridor', () => {
    const from: LatLngTuple = [51, -0.1]
    const to: LatLngTuple = [51.02, -0.1]
    const detour: LatLngTuple[] = [from, [52, -0.1], to]
    expect(railwayLegFits(detour, from, to)).toBe(false)
    expect(followRailway([from, to], () => detour)).toEqual([from, to])
  })

  it('follows the graph around a corner instead of the chord', () => {
    const graph = buildRailGraph([
      [
        [-0.1, 51],
        [0, 51],
        [0, 51.1],
      ],
    ])
    const followed = followRailway([[51, -0.1], [51.1, 0]], (from, to) =>
      routeOnGraph(graph, { lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] }),
    )
    expect(followed.some((point) => Math.abs(point[0] - 51) < 0.01 && Math.abs(point[1]) < 0.01)).toBe(true)
  })
})
