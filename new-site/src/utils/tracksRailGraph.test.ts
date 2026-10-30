import { describe, expect, it } from 'vitest'
import { buildRailGraph, linesFromNetwork, routeOnGraph } from './tracksRailGraph'
import { nominatimInBritain, nominatimSearchUrl } from '../app/api/nominatim-station/route'
import { tracksDarkStyle, tracksFlavor, tracksMapStyle } from './tracksDarkStyle'
import { JOERD_TERRAIN_CREDIT, TRACKS_RELIEF } from './tracksCredits'

describe('tracks rail graph', () => {
  it('follows the bend instead of the straight chord', () => {
    const graph = buildRailGraph([
      [
        [-0.1, 51],
        [0, 51],
        [0, 51.1],
      ],
    ])
    const path = routeOnGraph(graph, { lat: 51, lng: -0.1 }, { lat: 51.1, lng: 0 })
    expect(path).not.toBeNull()
    const corner = path!.some((point) => Math.abs(point[0] - 51) < 0.01 && Math.abs(point[1]) < 0.01)
    expect(corner).toBe(true)
  })

  it('still reaches a stop when the only line reverses', () => {
    // The return sits just beside the way up, far enough that a weld cannot skip the tip.
    const graph = buildRailGraph([
      [
        [0, 51],
        [0, 51.01],
      ],
      [
        [0, 51.01],
        [0.0036, 51.0055],
      ],
    ])
    const path = routeOnGraph(graph, { lat: 51, lng: 0 }, { lat: 51.0055, lng: 0.0036 })
    expect(path).not.toBeNull()
    expect(Math.max(...path!.map((point) => point[0]))).toBeGreaterThan(51.007)
  })

  it('prefers a longer gentle line over a shorter reversal', () => {
    const graph = buildRailGraph([
      [
        [0, 51],
        [0, 51.01],
      ],
      [
        [0, 51.01],
        [0.0036, 51.0055],
        [0.02, 51.0055],
      ],
      [
        [0, 51],
        [0, 51.03],
        [0.02, 51.03],
        [0.02, 51.0055],
      ],
    ])
    const path = routeOnGraph(graph, { lat: 51, lng: 0 }, { lat: 51.0055, lng: 0.02 })
    expect(path).not.toBeNull()
    expect(path!.some((point) => point[0] > 51.02)).toBe(true)
  })

  it('leaves a pin that is nowhere near the railway', () => {
    const graph = buildRailGraph([
      [
        [0, 51],
        [0.01, 51],
      ],
    ])
    expect(routeOnGraph(graph, { lat: 53, lng: 0 }, { lat: 51, lng: 0.01 })).toBeNull()
  })

  it('reads the compact network file', () => {
    expect(linesFromNetwork({ lines: [[[-1, 53], [-1.1, 53.1]]] })).toEqual([[[-1, 53], [-1.1, 53.1]]])
    expect(linesFromNetwork({})).toEqual([])
  })
})

describe('tracks dark style', () => {
  it('uses the dark land, water, and rose is not a basemap colour', () => {
    const flavor = tracksFlavor()
    expect(flavor.background).toBe('#111920')
    expect(flavor.earth).toBe('#2c2925')
    expect(flavor.water).toBe('#111920')
    expect(flavor.railway).toBe('#6b655c')
    expect(flavor.city_label).toBe('#d6cfc3')
    const style = tracksDarkStyle()
    expect(style.sprite).toContain('/dark')
    expect(style.sources.protomaps).toMatchObject({ type: 'vector' })
    const rail = style.layers?.find((layer) => layer.id === 'roads_rail')
    expect(rail && 'paint' in rail && rail.paint).toMatchObject({
      'line-color': '#6b655c',
      'line-opacity': 0.5,
    })
    const light = tracksMapStyle('light')
    expect(light.sprite).toContain('/light')
    expect(light.layers?.some((layer) => layer.id === 'roads_rail')).toBe(true)
  })
})

describe('tracks credits', () => {
  it('keeps relief off and holds the Joerd credit for later', () => {
    expect(TRACKS_RELIEF).toBe(false)
    expect(JOERD_TERRAIN_CREDIT).toContain('EU-DEM')
    expect(JOERD_TERRAIN_CREDIT).toContain('Geological Survey')
  })
})

describe('nominatim station lookup', () => {
  it('asks Nominatim for one British railway station', () => {
    const url = new URL(nominatimSearchUrl('York'))
    expect(url.hostname).toBe('nominatim.openstreetmap.org')
    expect(url.searchParams.get('countrycodes')).toBe('gb')
    expect(url.searchParams.get('limit')).toBe('1')
    expect(nominatimInBritain(53.96, -1.09)).toBe(true)
    expect(nominatimInBritain(48.8, 2.3)).toBe(false)
  })
})
