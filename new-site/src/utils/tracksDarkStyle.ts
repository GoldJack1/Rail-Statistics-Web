import { layers, namedFlavor, type Flavor } from '@protomaps/basemaps'
import type { StyleSpecification } from 'maplibre-gl'

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

/** Light companion to the dark Tracks basemap. */
export function tracksMapStyle(theme: TracksMapTheme): StyleSpecification {
  const dark = theme === 'dark'
  const painted = layers('protomaps', dark ? tracksFlavor() : namedFlavor('light'), { lang: 'en' }).map((layer) => {
    if (layer.id !== 'roads_rail' || layer.type !== 'line') return layer
    return {
      ...layer,
      paint: {
        ...layer.paint,
        'line-color': dark ? '#6b655c' : '#8d8680',
        'line-opacity': 0.5,
      },
    }
  })
  return {
    version: 8,
    glyphs: GLYPHS,
    sprite: SPRITE[theme],
    sources: {
      protomaps: {
        type: 'vector',
        url: tracksTileUrl(),
        attribution:
          '<a href="https://github.com/protomaps/basemaps">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
    },
    layers: painted as StyleSpecification['layers'],
  }
}

/** Town labels the basemap should hide where the route already names the stop. */
export const TRACKS_PLACE_LAYERS = ['places_locality', 'places_subplace'] as const
