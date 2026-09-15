import { describe, expect, it } from 'vitest'

import { parseBrouterRailGeoJson, straightLineBetween, buildBrouterRailUrl } from './brouterRailRoute'

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
