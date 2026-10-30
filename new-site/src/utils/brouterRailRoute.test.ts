import { describe, expect, it } from 'vitest'

import {
  parseBrouterRailGeoJson,
  parseOpenRailRoute,
  straightLineBetween,
  buildBrouterRailUrl,
  buildOpenRailRouteUrl,
  routeLimited,
  routedCoordinates,
} from './brouterRailRoute'

describe('parseBrouterRailGeoJson', () => {
  it('reads a LineString as lat/lng points', () => {
    expect(
      parseBrouterRailGeoJson({
        type: 'FeatureCollection',
        features: [
          {
            geometry: {
              type: 'LineString',
              coordinates: [
                [-0.1, 51.5],
                [-0.12, 51.52],
              ],
            },
          },
        ],
      })
    ).toEqual([
      [51.5, -0.1],
      [51.52, -0.12],
    ])
  })

  it('reads a MultiLineString', () => {
    const path = parseBrouterRailGeoJson({
      geometry: {
        type: 'MultiLineString',
        coordinates: [
          [
            [-5.06, 50.27],
            [-5.07, 50.28],
          ],
        ],
      },
    })
    expect(path).toEqual([
      [50.27, -5.06],
      [50.28, -5.07],
    ])
  })

  it('returns an empty path for unusable payloads', () => {
    expect(parseBrouterRailGeoJson(null)).toEqual([])
    expect(parseBrouterRailGeoJson({ type: 'FeatureCollection', features: [] })).toEqual([])
  })
})

describe('straightLineBetween', () => {
  it('joins the two stations', () => {
    expect(straightLineBetween([51.4, -0.1], [51.5, -0.2])).toEqual([
      [51.4, -0.1],
      [51.5, -0.2],
    ])
  })
})

describe('routedCoordinates', () => {
  it('keeps a routed line and drops a straight-line fallback', () => {
    expect(routedCoordinates({ coordinates: [[53.1, -1.5], [53.2, -1.4]], fallback: false })).toEqual([
      [53.1, -1.5],
      [53.2, -1.4],
    ])
    expect(routedCoordinates({ coordinates: [[53.1, -1.5], [53.2, -1.4]], fallback: true })).toBeNull()
    expect(routeLimited({ fallback: true, limited: true })).toBe(true)
    expect(routeLimited({ fallback: true })).toBe(false)
  })
})

describe('parseOpenRailRoute', () => {
  it('reads GraphHopper coordinates as lat/lng', () => {
    expect(
      parseOpenRailRoute({
        paths: [{ points: { coordinates: [[-2.24, 53.48], [-2.21, 53.49]] } }],
      }),
    ).toEqual([
      [53.48, -2.24],
      [53.49, -2.21],
    ])
    expect(parseOpenRailRoute({ message: 'no path' })).toEqual([])
  })
})

describe('buildOpenRailRouteUrl', () => {
  it('sends every timing point in lat,lng order on the heavy-rail profile', () => {
    const url = buildOpenRailRouteUrl([
      [53.48748, -2.2426],
      [53.49631, -2.21258],
    ])
    expect(url).toContain('https://routing.openrailrouting.org/route?')
    expect(url).toContain('point=53.48748%2C-2.2426')
    expect(url).toContain('point=53.49631%2C-2.21258')
    expect(url).toContain('profile=non_tgv')
    expect(url).toContain('points_encoded=false')
  })
})

describe('buildBrouterRailUrl', () => {
  it('encodes intermediate waypoints in lon,lat order', () => {
    const url = buildBrouterRailUrl([
      [51.7, -3.4],
      [51.5, -3.19],
      [51.48, -3.18],
    ])
    expect(url).toContain('lonlats=-3.4%2C51.7%7C-3.19%2C51.5%7C-3.18%2C51.48')
    expect(url).toContain('profile=rail')
  })
})
