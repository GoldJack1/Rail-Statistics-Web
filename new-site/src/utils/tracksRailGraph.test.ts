import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { roundSharpCorners } from './tracksRailRoute'
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

  it('crosses to the parallel track instead of leaving the corridor', () => {
    // Two tracks side by side only meet by a long loop. The route steps across
    // rather than taking that loop, which in London is the tube corridor.
    const graph = buildRailGraph([
      [
        [0, 51],
        [0, 51.02],
      ],
      [
        [0.0006, 51],
        [0.0006, 51.02],
      ],
      [
        [0, 51],
        [0.02, 51],
        [0.02, 51.02],
        [0.0006, 51.02],
      ],
    ])
    const path = routeOnGraph(graph, { lat: 51.002, lng: 0 }, { lat: 51.018, lng: 0.0006 })
    expect(path).not.toBeNull()
    expect(Math.max(...path!.map((point) => point[1]))).toBeLessThan(0.005)
  })

  it('does not chord across a bend from a loose rail end', () => {
    // A siding end within 200 m of the far side used to weld to every node
    // in that circle, and the route cut straight across the land.
    const graph = buildRailGraph([
      [
        [0, 51],
        [0.0012, 51.0012],
        [0.0024, 51],
      ],
      [
        [0.00015, 51.00015],
        [0.0004, 51.00005],
      ],
    ])
    const path = routeOnGraph(graph, { lat: 51, lng: 0 }, { lat: 51, lng: 0.0024 })
    expect(path).not.toBeNull()
    expect(path!.some((point) => point[0] > 51.0008)).toBe(true)
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

  it('uses the other line when the pin sits on a line that does not connect', () => {
    const graph = buildRailGraph([
      [
        [0, 51],
        [0.3, 51],
      ],
      [
        [0, 51.008],
        [0.3, 51.008],
      ],
    ])
    const path = routeOnGraph(graph, { lat: 51.008, lng: 0.02 }, { lat: 51, lng: 0.25 })
    expect(path).not.toBeNull()
    expect(path!.every((point) => point[0] > 51.005)).toBe(true)
  })

  it('keeps a short branch when a bypass is only a little shorter', () => {
    const graph = buildRailGraph([
      [
        [0, 51],
        [0.12, 51],
      ],
      [
        [0.076, 51],
        [0.08, 51.004],
        [0.084, 51],
      ],
    ])
    const path = routeOnGraph(graph, { lat: 51, lng: 0.01 }, { lat: 51.004, lng: 0.08 })
    expect(path).not.toBeNull()
    expect(Math.max(...path!.map((point) => point[0]))).toBeGreaterThan(51.003)
  })

  it('takes the Dryclough chord from Halifax to Brighouse', () => {
    const file = `${process.cwd()}/public/data/gb-passenger-rail.json`
    const lines = linesFromNetwork(JSON.parse(fs.readFileSync(file, 'utf8'))).filter((line) =>
      line.some((point) => point[1] > 53.68 && point[1] < 53.74 && point[0] > -1.92 && point[0] < -1.75),
    )
    const graph = buildRailGraph(lines)
    const halifax = { lat: 53.72039, lng: -1.85398 }
    const greetland = { lat: 53.69388, lng: -1.85756 }
    const brighouse = { lat: 53.69821, lng: -1.77944 }
    const path = routeOnGraph(graph, halifax, brighouse)
    const viaGreetland = [
      routeOnGraph(graph, halifax, greetland),
      routeOnGraph(graph, greetland, brighouse),
    ]
    expect(path).not.toBeNull()
    // Milner Royd sits west of -1.87. The booked line leaves at Dryclough and stays east of it.
    expect(Math.min(...path!.map((point) => point[1]))).toBeGreaterThan(-1.87)
    for (const leg of viaGreetland) {
      expect(leg).not.toBeNull()
      expect(Math.min(...leg!.map((point) => point[1]))).toBeGreaterThan(-1.87)
    }
  })

  it('keeps a CrossCountry call at Tamworth on the high level line', () => {
    const file = `${process.cwd()}/public/data/gb-passenger-rail.json`
    const lines = linesFromNetwork(JSON.parse(fs.readFileSync(file, 'utf8'))).filter((line) =>
      line.some((point) => point[1] > 52.45 && point[1] < 52.85 && point[0] > -1.95 && point[0] < -1.55),
    )
    const graph = buildRailGraph(lines)
    const birmingham = { lat: 52.47782, lng: -1.90021 }
    const tamworth = { lat: 52.63747, lng: -1.68645 }
    const burton = { lat: 52.80582, lng: -1.64246 }
    const toTamworth = routeOnGraph(graph, birmingham, tamworth)
    const toBurton = routeOnGraph(graph, tamworth, burton)
    for (const path of [toTamworth, toBurton]) {
      expect(path).not.toBeNull()
      expect(path!.some((point) => point[0] > 52.58 && point[1] < -1.78)).toBe(false)
    }
    expect(toTamworth!.some((point) => point[0] > 52.55 && point[0] < 52.62 && point[1] > -1.75 && point[1] < -1.66)).toBe(true)
    expect(toBurton!.some((point) => point[0] > 52.7 && point[0] < 52.76 && point[1] < -1.69)).toBe(true)
  })
})

describe('route corner rounding', () => {
  it('replaces a right angle with a curve inside the corner', () => {
    const corner: [number, number] = [51, -1.49]
    const rounded = roundSharpCorners([
      [51, -1.5],
      corner,
      [51.01, -1.49],
    ])
    expect(rounded.some((point) => point[0] === corner[0] && point[1] === corner[1])).toBe(false)
    expect(rounded.some((point) => point[0] > 51 && point[1] < -1.49)).toBe(true)
    expect(rounded[0]).toEqual([51, -1.5])
    expect(rounded[rounded.length - 1]).toEqual([51.01, -1.49])
  })

  it('leaves a gentle bend alone', () => {
    const path: [number, number][] = [
      [51, -1.5],
      [51.001, -1.49],
      [51.002, -1.48],
    ]
    expect(roundSharpCorners(path)).toEqual(path)
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
    const satellite = tracksMapStyle('satellite')
    expect(satellite.sources.satellite).toMatchObject({ type: 'raster' })
    expect(satellite.layers?.some((layer) => layer.id === 'satellite')).toBe(true)
    const clean = tracksMapStyle('clean')
    expect(clean.layers?.some((layer) => layer.id === 'roads_rail')).toBe(false)
    expect(clean.layers?.some((layer) => layer.id === 'earth')).toBe(true)
    const atlas = tracksMapStyle('atlas')
    expect(atlas.sources.terrain).toMatchObject({ type: 'raster-dem' })
    expect(atlas.layers?.some((layer) => layer.id === 'tracks-relief')).toBe(true)
    const lms = tracksMapStyle('lms')
    const earth = lms.layers?.find((layer) => layer.id === 'earth')
    expect(earth && 'paint' in earth && earth.paint).toMatchObject({ 'fill-color': '#e3c98f' })
    const night = tracksMapStyle('night')
    expect(night.sources.night).toMatchObject({ type: 'raster' })
    const live = tracksMapStyle('live')
    expect(String((live.sources.live as { tiles?: string[] }).tiles?.[0])).toContain('MODIS_Terra')
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
