import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps'
import type { ExpressionSpecification, StyleSpecification } from 'maplibre-gl'

/**
 * Same-origin proxy. The public planet archive does not send CORS headers,
 * so the browser cannot read it directly.
 */
export function tracksTileUrl(): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin
  return `pmtiles://${origin}/api/basemap-pmtiles`
}
const GLYPHS = 'https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf'
const SPRITE = {
  dark: 'https://protomaps.github.io/basemaps-assets/sprites/v4/dark',
  light: 'https://protomaps.github.io/basemaps-assets/sprites/v4/light',
} as const

export type TracksMapTheme = 'light' | 'dark'

/** Everyday maps, elevation, and satellite. Classic posters and the other space views are not offered. */
export type TracksBasemap =
  | 'clean'
  | 'detailed'
  | 'dark'
  | 'relief'
  | 'atlas'
  | 'signal'
  | 'lms'
  | 'sj'
  | 'rheingold'
  | 'satellite'
  | 'night'
  | 'live'
  | 'railway'

const BASEMAP_IDS = new Set<string>([
  'clean',
  'detailed',
  'dark',
  'relief',
  'atlas',
  'signal',
  'lms',
  'sj',
  'rheingold',
  'satellite',
  'night',
  'live',
  'railway',
])

/** The OpenRailwayMap standard overlay is drawn through zoom 19. */
export const OPENRAILWAYMAP_MAX_ZOOM = 19

const SATELLITE_TILES =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
const NIGHT_TILES =
  'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_CityLights_2012/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpg'

export function isTracksBasemap(value: string | null | undefined): value is TracksBasemap {
  return value != null && BASEMAP_IDS.has(value)
}

/** Older visits stored "light" for the daylight map. That is Detailed now. */
export function canonicalTracksBasemap(value: string | null | undefined): TracksBasemap | null {
  if (value === 'light') return 'detailed'
  if (value === 'night' || value === 'live') return 'satellite'
  if (value === 'lms' || value === 'sj' || value === 'rheingold') return 'detailed'
  // The rail overlay is a test mode, not a saved map style.
  if (value === 'railway') return null
  return isTracksBasemap(value) ? value : null
}

export type TracksBasemapChoice = {
  id: TracksBasemap
  label: string
}

export const TRACKS_BASEMAP_GROUPS: Array<{ title: string; styles: TracksBasemapChoice[] }> = [
  {
    title: 'Everyday',
    styles: [
      { id: 'clean', label: 'Clean' },
      { id: 'detailed', label: 'Detailed' },
      { id: 'dark', label: 'Dark' },
      { id: 'satellite', label: 'Satellite' },
    ],
  },
  {
    title: 'Elevation',
    styles: [
      { id: 'relief', label: 'Relief' },
      { id: 'atlas', label: 'Atlas' },
      { id: 'signal', label: 'Signal' },
    ],
  },
]

const PAPER_LAYERS = new Set([
  'background',
  'earth',
  'water',
  'water_stream',
  'water_river',
  'boundaries',
  'boundaries_country',
  'water_label_ocean',
  'water_label_lakes',
  'earth_label_islands',
  'places_subplace',
  'places_region',
  'places_locality',
  'places_country',
])

const ELEVATION = new Set<TracksBasemap>(['relief', 'atlas', 'signal'])
const SPACE = new Set<TracksBasemap>(['satellite', 'night', 'live'])

export function tracksRouteOnDark(basemap: TracksBasemap): boolean {
  return basemap === 'dark' || basemap === 'night'
}

export function tracksRouteCasing(basemap: TracksBasemap): boolean {
  return SPACE.has(basemap)
}

export function tracksBasemapCredit(basemap: TracksBasemap): string | null {
  if (basemap === 'satellite') return 'Imagery © Esri, Maxar, Earthstar Geographics'
  if (basemap === 'night') return 'Night lights © NASA Earth Observatory'
  if (basemap === 'live') return 'Imagery © NASA EOSDIS'
  if (ELEVATION.has(basemap)) return 'Terrain © Mapzen, USGS, NOAA'
  return null
}

/** Present railway lines, recoloured the way the stations map does. */
export const TRACKS_RAIL_CREDIT = 'Rail lines © OpenRailwayMap © OpenStreetMap contributors'

/** Black on a light map, light gray on a dark map or on imagery. */
export function tracksRailInk(basemap: TracksBasemap): string {
  if (basemap === 'dark' || basemap === 'night' || basemap === 'satellite' || basemap === 'live') return '#cccccc'
  return '#000000'
}

export const TRACKS_NAME_HALO = '#1e1c19'
export const TRACKS_TOWN = '#a39b8f'
export const TRACKS_TOWN_HALO = '#2a2723'

/** Trainmap's dark palette, on Protomaps basemap layers. */
export function tracksFlavor(): Flavor {
  const dark = namedFlavor('dark')
  return {
    ...dark,
    background: '#111920',
    earth: '#2c2925',
    park_a: '#32362b',
    park_b: '#32362b',
    wood_a: '#31352a',
    wood_b: '#31352a',
    scrub_a: '#32332a',
    scrub_b: '#32332a',
    glacier: '#3a3d3d',
    sand: '#36322b',
    beach: '#36322b',
    water: '#111920',
    hospital: '#36302c',
    industrial: '#32302b',
    school: '#33302b',
    aerodrome: '#322f29',
    runway: '#3d3932',
    military: '#30342a',
    zoo: '#30342a',
    pedestrian: '#302d28',
    pier: '#36332e',
    buildings: '#1a1816',
    minor_service_casing: '#332f2a',
    minor_casing: '#332f2a',
    link_casing: '#332f2a',
    major_casing_late: '#332f2a',
    major_casing_early: '#332f2a',
    highway_casing_late: '#332f2a',
    highway_casing_early: '#332f2a',
    other: '#3a362f',
    minor_service: '#3a362f',
    minor_a: '#3a362f',
    minor_b: '#3a362f',
    link: '#4a443b',
    major: '#4a443b',
    highway: '#4a443b',
    railway: '#6b655c',
    boundaries: '#6a6258',
    tunnel_other_casing: '#141414',
    tunnel_minor_casing: '#141414',
    tunnel_link_casing: '#141414',
    tunnel_major_casing: '#141414',
    tunnel_highway_casing: '#141414',
    tunnel_other: '#3a362f',
    tunnel_minor: '#3a362f',
    tunnel_link: '#3a362f',
    tunnel_major: '#4a443b',
    tunnel_highway: '#4a443b',
    bridges_other_casing: '#2b2b2b',
    bridges_minor_casing: '#1f1f1f',
    bridges_link_casing: '#1f1f1f',
    bridges_major_casing: '#1f1f1f',
    bridges_highway_casing: '#1f1f1f',
    bridges_other: '#3a362f',
    bridges_minor: '#3a362f',
    bridges_link: '#3a362f',
    bridges_major: '#4a443b',
    bridges_highway: '#4a443b',
    ocean_label: '#6a8a92',
    subplace_label: '#a39b8f',
    subplace_label_halo: '#2a2723',
    city_label: '#d6cfc3',
    city_label_halo: '#2a2723',
    state_label: '#8b8479',
    state_label_halo: '#2a2723',
    country_label: '#ece6da',
    roads_label_minor: '#a39b8f',
    roads_label_minor_halo: '#2a2723',
    roads_label_major: '#d6cfc3',
    roads_label_major_halo: '#2a2723',
    address_label: '#a39b8f',
    address_label_halo: '#2a2723',
    landcover: dark.landcover
      ? {
          ...dark.landcover,
          grassland: '#32332a',
          forest: '#31352a',
          scrub: '#32332a',
          urban_area: '#2c2925',
          glacier: '#3a3d3d',
          farmland: '#32332a',
          barren: '#36322b',
        }
      : undefined,
  }
}

export function tracksDarkStyle(): StyleSpecification {
  return tracksMapStyle('dark')
}

function siteOrigin(): string {
  return typeof window === 'undefined' ? '' : window.location.origin
}

function paperFlavor(earth: string, water: string, ink: string, halo: string): Flavor {
  const base = namedFlavor('white')
  return {
    ...base,
    background: water,
    earth,
    water,
    boundaries: ink,
    city_label: ink,
    city_label_halo: halo,
    subplace_label: ink,
    subplace_label_halo: halo,
    state_label: ink,
    state_label_halo: halo,
    country_label: ink,
    ocean_label: ink,
  }
}

function detailedFlavor(): Flavor {
  const light = namedFlavor('light')
  return {
    ...light,
    background: '#efe9dc',
    earth: '#f7f3ea',
    water: '#cfdcdb',
    park_a: '#e2e4cf',
    park_b: '#e2e4cf',
    wood_a: '#d5d8c4',
    wood_b: '#d5d8c4',
    railway: '#a7a59b',
    boundaries: '#b3a794',
  }
}

function flavorFor(basemap: TracksBasemap): Flavor {
  if (basemap === 'dark' || basemap === 'night') return tracksFlavor()
  if (basemap === 'detailed' || basemap === 'satellite' || basemap === 'live') return detailedFlavor()
  if (basemap === 'relief') return paperFlavor('#f4f2ec', '#cedae0', '#3a4038', '#f7f6f1')
  if (basemap === 'atlas') return paperFlavor('#b2ca99', '#92b6c3', '#1d3a4a', '#e7f0e4')
  if (basemap === 'signal') return paperFlavor('#f5e962', '#8ecfea', '#1c1c1c', '#f8f3a4')
  if (basemap === 'lms') return paperFlavor('#e3c98f', '#a7c3b8', '#3a3428', '#f3e6c4')
  if (basemap === 'sj') return paperFlavor('#e78a3a', '#4d7fb3', '#1b2430', '#f6e3cf')
  if (basemap === 'rheingold') return paperFlavor('#cea259', '#3f7f8a', '#142226', '#f0e2c4')
  return paperFlavor('#f7f3ea', '#cfdcdb', '#3c3832', '#f7f4ee')
}

const RELIEF_RAMP: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['elevation'],
  -12000, '#b2c3cc',
  -200, '#cedae0',
  -5, '#f4f2ec',
  200, '#ebe7de',
  500, '#e0dacd',
  1000, '#d3cbbb',
  2000, '#c3b9a6',
  3000, '#b2a692',
]
const ATLAS_RAMP: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['elevation'],
  -12000, '#b2ca99',
  200, '#d7e0c7',
  500, '#d0c3b4',
  1000, '#b48f78',
  2000, '#97684f',
  3000, '#cfc2b8',
]
const SIGNAL_RAMP: ExpressionSpecification = [
  'interpolate',
  ['linear'],
  ['elevation'],
  -12000, '#f5e962',
  200, '#efdf5a',
  500, '#e1d252',
  1000, '#cbbe4f',
  2000, '#b0a44a',
  3000, '#968c44',
]

function elevationRamp(basemap: TracksBasemap): ExpressionSpecification {
  if (basemap === 'atlas') return ATLAS_RAMP
  if (basemap === 'signal') return SIGNAL_RAMP
  return RELIEF_RAMP
}

function liveTiles(): string {
  const day = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString().slice(0, 10)
  return `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/${day}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`
}

function vectorBase(basemap: TracksBasemap): StyleSpecification {
  const dark = basemap === 'dark' || basemap === 'night'
  const paper = basemap !== 'dark' && basemap !== 'detailed'
  const painted = layers('protomaps', flavorFor(basemap), { lang: 'en' })
    .filter((layer) => !paper || PAPER_LAYERS.has(layer.id))
    .map((layer) => {
      if (layer.id !== 'roads_rail' || layer.type !== 'line') return layer
      return {
        ...layer,
        paint: {
          ...layer.paint,
          'line-color': dark ? '#6b655c' : '#a7a59b',
          'line-opacity': 0.5,
        },
      }
    })
  const sources: StyleSpecification['sources'] = {
    protomaps: {
      type: 'vector',
      url: tracksTileUrl(),
      attribution:
        '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    },
  }
  let styleLayers = painted as StyleSpecification['layers']
  if (ELEVATION.has(basemap)) {
    sources.terrain = {
      type: 'raster-dem',
      tiles: [`${siteOrigin()}/api/terrain-tile/{z}/{x}/{y}`],
      encoding: 'terrarium',
      tileSize: 256,
      maxzoom: 15,
      attribution: 'Terrain: Mapzen Terrarium (USGS, NOAA)',
    }
    const relief = [
      {
        id: 'tracks-relief',
        type: 'color-relief' as const,
        source: 'terrain',
        paint: { 'color-relief-color': elevationRamp(basemap) },
      },
      {
        id: 'tracks-hillshade',
        type: 'hillshade' as const,
        source: 'terrain',
        paint: {
          'hillshade-exaggeration': 0.35,
          'hillshade-shadow-color': basemap === 'signal' ? '#45422a' : '#6f6556',
          'hillshade-highlight-color': '#fffdf8',
        },
      },
    ]
    const at = (styleLayers ?? []).findIndex((layer) => layer.id === 'water')
    const next = [...(styleLayers ?? [])]
    next.splice(at < 0 ? next.length : at, 0, ...(relief as StyleSpecification['layers']))
    styleLayers = next
  }
  return {
    version: 8,
    glyphs: GLYPHS,
    sprite: SPRITE[dark ? 'dark' : 'light'],
    sources,
    layers: styleLayers,
  }
}

function spaceStyle(basemap: 'satellite' | 'night' | 'live'): StyleSpecification {
  const base = vectorBase(basemap)
  const labels = (base.layers ?? []).filter((layer) => layer.type === 'symbol')
  if (basemap === 'satellite') {
    return {
      version: 8,
      glyphs: GLYPHS,
      sprite: SPRITE.light,
      sources: {
        ...base.sources,
        satellite: {
          type: 'raster',
          tiles: [SATELLITE_TILES],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        },
      },
      layers: [{ id: 'satellite', type: 'raster', source: 'satellite' }, ...labels],
    }
  }
  if (basemap === 'night') {
    return {
      version: 8,
      glyphs: GLYPHS,
      sprite: SPRITE.dark,
      sources: {
        ...base.sources,
        night: {
          type: 'raster',
          tiles: [NIGHT_TILES],
          tileSize: 256,
          maxzoom: 8,
          attribution: 'Night lights: NASA Earth Observatory',
        },
      },
      layers: [
        { id: 'background', type: 'background', paint: { 'background-color': '#081829' } },
        { id: 'night', type: 'raster', source: 'night' },
        ...labels,
      ],
    }
  }
  return {
    version: 8,
    glyphs: GLYPHS,
    sprite: SPRITE.light,
    sources: {
      ...base.sources,
      live: {
        type: 'raster',
        tiles: [liveTiles()],
        tileSize: 256,
        maxzoom: 9,
        attribution: 'Imagery: NASA EOSDIS GIBS',
      },
    },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#17406a' } },
      { id: 'live', type: 'raster', source: 'live' },
      ...labels,
    ],
  }
}

const RAIL_FEATURES = ['rail', 'light_rail', 'tram', 'subway', 'narrow_gauge', 'funicular', 'miniature']
/** South Yorkshire Supertram, matching the stations map. */
const SUPERTRAM_BOX: GeoJSON.Polygon = {
  type: 'Polygon',
  coordinates: [[[-1.68, 53.305], [-1.28, 53.305], [-1.28, 53.525], [-1.68, 53.525], [-1.68, 53.305]]],
}

/** Open lines only. Proposed, under construction, and closed roads stay off the map. */
function presentRailFilter(): ExpressionSpecification {
  return [
    'all',
    ['in', ['get', 'feature'], ['literal', RAIL_FEATURES]],
    ['==', ['coalesce', ['get', 'state'], 'present'], 'present'],
  ]
}

function railLineColor(ink: string): ExpressionSpecification {
  return [
    'case',
    ['in', ['get', 'feature'], ['literal', ['light_rail', 'tram', 'subway']]],
    '#5ec269',
    ink,
  ]
}

function railLineWidth(): ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], 4, 1, 8, 2, 10, 3, 16, 2.2, 19, 3]
}

function railLine(id: string, source: string, sourceLayer: string, ink: string, minzoom: number, maxzoom: number) {
  return {
    id,
    type: 'line' as const,
    source,
    'source-layer': sourceLayer,
    minzoom,
    maxzoom,
    filter: presentRailFilter(),
    paint: {
      'line-color': railLineColor(ink),
      'line-width': railLineWidth(),
      'line-opacity': 1,
    },
    layout: { 'line-cap': 'round' as const, 'line-join': 'round' as const },
  }
}

/**
 * Present railway tracks on top of a basemap and under the place names.
 * Closed lines stay off, as they do on the stations map. The ink follows the
 * basemap so a dark map and satellite keep the tracks visible.
 */
function withRailwayOverlay(base: StyleSpecification, ink: string): StyleSpecification {
  const layers = (base.layers ?? []).map((layer) => {
    if (layer.id !== 'roads_rail' || layer.type !== 'line') return layer
    return { ...layer, paint: { ...layer.paint, 'line-opacity': 0 } }
  })
  const overlay = [
    railLine('orm-tracks-low', 'orm-low', 'standard_railway_line_low', ink, 0, 7),
    railLine('orm-tracks', 'orm-high', 'railway_line_high', ink, 7, 22),
    {
      ...railLine('orm-supertram', 'orm-high', 'railway_line_high', '#ff5700', 7, 22),
      filter: [
        'all',
        ['in', ['get', 'feature'], ['literal', ['light_rail', 'tram']]],
        ['==', ['coalesce', ['get', 'state'], 'present'], 'present'],
        ['within', SUPERTRAM_BOX],
      ] as ExpressionSpecification,
      paint: {
        'line-color': '#ff5700',
        'line-width': railLineWidth(),
        'line-opacity': 1,
      },
    },
  ]
  const names = layers.findIndex((layer) => layer.type === 'symbol')
  layers.splice(names < 0 ? layers.length : names, 0, ...overlay)
  return {
    ...base,
    sources: {
      ...base.sources,
      'orm-low': {
        type: 'vector',
        tiles: ['smoothorm://standard_railway_line_low/{z}/{x}/{y}'],
        minzoom: 0,
        maxzoom: 7,
        attribution: '<a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> © OpenStreetMap',
      },
      'orm-high': {
        type: 'vector',
        tiles: ['smoothorm://railway_line_high,railway_text_km/{z}/{x}/{y}'],
        minzoom: 7,
        maxzoom: OPENRAILWAYMAP_MAX_ZOOM,
        attribution: '<a href="https://www.openrailwaymap.org/">OpenRailwayMap</a> © OpenStreetMap',
      },
    },
    layers,
  }
}

/** One MapLibre style for each entry in the service-map picker. `rails` draws the track overlay. */
export function tracksMapStyle(basemap: TracksBasemap | TracksMapTheme, rails = false): StyleSpecification {
  const id: TracksBasemap = basemap === 'light' || basemap === 'railway' ? 'detailed' : basemap
  const base = id === 'satellite' || id === 'night' || id === 'live' ? spaceStyle(id) : vectorBase(id)
  if (!rails && basemap !== 'railway') return base
  return withRailwayOverlay(base, tracksRailInk(id))
}

/** Town labels the basemap should hide where the route already names the stop. */
export const TRACKS_PLACE_LAYERS = ['places_locality', 'places_subplace'] as const
