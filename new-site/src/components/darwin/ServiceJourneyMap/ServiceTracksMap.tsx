'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornersIn, CornersOut, Minus, NavigationArrow, Plus, Stack } from '@phosphor-icons/react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BUTCircleButton } from '../../buttons'
import { SidePane } from '../SidePane/SidePane'
import '../../maps/MapZoomControls.css'
import '../../maps/MapUserLocation.css'
import { railwayDaySecondsFromClock } from '../../../utils/railwayOperatingDayUk'
import type { LatLngTuple } from '../../../utils/brouterRailRoute'
import {
  liveJourneyPosition,
  platformRouteWaypoints,
  railStopMarks,
  snapLiveToRailPath,
  snapMarkerToPath,
  type JourneyMapStop,
  type RoutePlatform,
} from '../../../utils/serviceJourneyMap'
import {
  canonicalTracksBasemap,
  OPENRAILWAYMAP_MAX_ZOOM,
  TRACKS_BASEMAP_GROUPS,
  TRACKS_RAIL_CREDIT,
  tracksBasemapCredit,
  tracksMapStyle,
  tracksRouteCasing,
  type TracksBasemap,
} from '../../../utils/tracksDarkStyle'
import { ensureOrmSmoothProtocol } from '../../../utils/ormSmoothTiles'
import { fetchPlatformRailRoute, routeTracksJourney, splitRouteGaps } from '../../../utils/tracksRailRoute'
import type { ServiceDetail, ServiceStop } from '../../../types/darwin'

export type BranchTrack = {
  rid: string
  trainId: string
  stops: ServiceStop[]
  mapped: JourneyMapStop[]
  waypoints: LatLngTuple[]
  location: ServiceDetail['location']
}

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }
const NO_ROADS: Record<string, Record<string, RoutePlatform>> = {}

let pmtilesReady = false
function ensurePmtiles() {
  if (pmtilesReady) return
  maplibregl.setWorkerUrl('/maplibre-gl-worker.js')
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  pmtilesReady = true
}

function frameJourney(map: MapLibreMap, stops: JourneyMapStop[]) {
  const pts = stops.filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
  if (pts.length < 2) return
  let west = Infinity
  let south = Infinity
  let east = -Infinity
  let north = -Infinity
  for (const stop of pts) {
    west = Math.min(west, stop.lng)
    east = Math.max(east, stop.lng)
    south = Math.min(south, stop.lat)
    north = Math.max(north, stop.lat)
  }
  if (![west, south, east, north].every(Number.isFinite)) return
  try {
    map.fitBounds(
      [[west, south], [east, north]],
      { padding: 48, maxZoom: 10, duration: 0 },
    )
  } catch {
    // A map with no size yet cannot fit a camera.
  }
}

function londonNowRailwaySeconds(): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date())
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '0'
  return railwayDaySecondsFromClock(`${pick('hour')}:${pick('minute')}:${pick('second')}`) ?? 0
}

function lineCollection(path: LatLngTuple[]): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = splitRouteGaps(path).map((segment) => ({
    type: 'Feature',
    properties: {},
    geometry: {
      type: 'LineString',
      coordinates: segment.map(([lat, lng]) => [lng, lat]),
    },
  }))
  return { type: 'FeatureCollection', features }
}

function shownStops(stops: JourneyMapStop[], callsOnly: boolean): JourneyMapStop[] {
  return callsOnly ? stops.filter((stop) => stop.calling) : stops
}

function stopCollection(
  stops: JourneyMapStop[],
  path: LatLngTuple[] | null,
  platforms: Record<string, RoutePlatform>,
  marks: Record<string, { lat: number; lng: number }> = {},
): GeoJSON.FeatureCollection {
  const placeOnTrack = Boolean(path && path.filter((point) => Number.isFinite(point[0])).length > stops.length + 2)
  const first = stops[0]?.index
  const last = stops[stops.length - 1]?.index
  return {
    type: 'FeatureCollection',
    features: stops
      .filter((stop) => Number.isFinite(stop.lat) && Number.isFinite(stop.lng))
      .map((stop) => {
        const onPlatform = platforms[String(stop.index)]
        const terminal = stop.index === first || stop.index === last
        const at = stop.kind === 'junction'
          ? stop
          : onPlatform?.stand
            ? onPlatform.stand
            : (terminal && onPlatform?.bay)
              ? onPlatform.bay
              : marks[String(stop.index)] ?? onPlatform ?? (placeOnTrack ? snapMarkerToPath(stop, path, 250) : stop)
        return {
          type: 'Feature' as const,
          properties: {
            kind: stop.kind,
            label: onPlatform && stop.platform ? `${stop.name} · Platform ${stop.platform}` : stop.name,
          },
          geometry: { type: 'Point' as const, coordinates: [at.lng, at.lat] },
        }
      }),
  }
}

function pointCollection(lat: number, lng: number, label = '', id = ''): GeoJSON.FeatureCollection {
  return liveCollection([{ lat, lng, label, id }])
}

function liveCollection(points: Array<{ lat: number; lng: number; label: string; id: string }>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: points
      .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
      .map((point) => ({
        type: 'Feature' as const,
        properties: { label: point.label, id: point.id },
        geometry: { type: 'Point' as const, coordinates: [point.lng, point.lat] },
      })),
  }
}

function withHeadcode(trainId: string, label: string): string {
  const head = trainId.trim()
  if (!head || label.startsWith(head)) return label
  return `${head} · ${label}`
}

/** Same stroke width as the Leaflet service line, in the operator colour. */
const ROUTE_LINE_WIDTH = 5
const ROUTE_LINE_OPACITY = 1
const BASEMAP_KEY = 'rs.service-map.basemap'
type RouteMode = 'ours' | 'rail'

function storedBasemap(): TracksBasemap | null {
  try {
    return canonicalTracksBasemap(localStorage.getItem(BASEMAP_KEY))
  } catch {
    return null
  }
}

function tipHtml(label: string): string {
  const text = label.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] ?? ch
  ))
  return `<div class="leaflet-tooltip leaflet-tooltip-top">${text}</div>`
}

function markerTip(): maplibregl.Popup {
  return new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    closeOnMove: false,
    anchor: 'bottom',
    offset: 0,
    className: 'svc-journey-map__tip',
    maxWidth: 'none',
  })
}

function tipClearance(layerId: string | undefined, kind: string | undefined): number {
  if (layerId === 'tracks-live') return 22
  if (layerId === 'tracks-user') return 19
  return kind === 'stop' ? 17 : 15
}

function placeTip(
  map: MapLibreMap,
  tip: maplibregl.Popup,
  lngLat: [number, number],
  label: string,
  layerId: string | undefined,
  kind: string | undefined,
) {
  map.getCanvas().style.cursor = 'pointer'
  tip.setOffset(tipClearance(layerId, kind))
  tip.setLngLat(lngLat).setHTML(tipHtml(label)).addTo(map)
}

function setSource(map: MapLibreMap, id: string, data: GeoJSON.FeatureCollection) {
  const source = map.getSource(id) as GeoJSONSource | undefined
  source?.setData(data)
}

export function ServiceTracksMap({
  waypoints,
  extraWaypoints = [],
  branches = [],
  trainId = '',
  mapped,
  extraMapped = [],
  stops,
  location,
  platforms,
  platformRoads = NO_ROADS,
  routeColor,
  fullscreen,
  onToggleFullscreen,
  callsOnly = false,
  routeMode,
}: {
  waypoints: LatLngTuple[]
  extraWaypoints?: LatLngTuple[][]
  branches?: BranchTrack[]
  trainId?: string
  mapped: JourneyMapStop[]
  extraMapped?: JourneyMapStop[]
  stops: ServiceDetail['stops']
  location: ServiceDetail['location']
  platforms: Record<string, RoutePlatform>
  /** Every platform face at a pass that has no booked platform. */
  platformRoads?: Record<string, Record<string, RoutePlatform>>
  routeColor: string
  fullscreen: boolean
  onToggleFullscreen: () => void
  /** Simple view: passenger calls only, matching the calling list. */
  callsOnly?: boolean
  routeMode: RouteMode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState<MapLibreMap | null>(null)
  const [zoom, setZoom] = useState(8)
  const pathRef = useRef<LatLngTuple[] | null>(null)
  const branchPathsRef = useRef<Map<string, LatLngTuple[]>>(new Map())
  const userPointRef = useRef<{ lat: number; lng: number } | null>(null)
  const [styleEpoch, setStyleEpoch] = useState(0)
  const stopMarks = useMemo(
    () => railStopMarks(mapped, platforms, platformRoads),
    [mapped, platforms, platformRoads],
  )
  const inputRef = useRef({ stops, mapped, extraMapped, location, platforms, stopMarks, trainId, branches, callsOnly })
  const shownRef = useRef<{ lat: number; lng: number } | null>(null)
  const shownBranchesRef = useRef<Map<string, { lat: number; lng: number }>>(new Map())
  const userMovedRef = useRef(false)
  const framedCountRef = useRef(0)
  const [basemap, setBasemap] = useState<TracksBasemap>('detailed')
  const [layersOpen, setLayersOpen] = useState(false)
  const basemapChosen = useRef(false)
  const basemapRef = useRef(basemap)
  const routeModeRef = useRef(routeMode)
  const lineColor = routeColor
  const routeColorRef = useRef(lineColor)
  const appliedStyle = useRef<string | null>(null)
  const savedRouteRef = useRef<{ key: string; path: LatLngTuple[] } | null>(null)
  const railWaypoints = platformRouteWaypoints(mapped, platforms, platformRoads)
  const railWaypointKey = railWaypoints
    .map((via) => `${via.lat.toFixed(5)},${via.lng.toFixed(5)}${via.exact ? '!' : ''}`)
    .join('|')
  const tipRef = useRef<maplibregl.Popup | null>(null)
  const tipLiveRef = useRef<string | null>(null)
  // Four decimal places is about 10 m. A platform on the next road over, such
  // as Huddersfield 2 beside 3, still changes the key and the route is drawn
  // again. A finer key restarts the search on every chunk.
  const waypointKey = waypoints.map((point) => `${point[0].toFixed(4)},${point[1].toFixed(4)}`).join('|')
  const extraKey = extraWaypoints
    .map((route) => route.map((point) => `${point[0].toFixed(3)},${point[1].toFixed(3)}`).join('|'))
    .join('||')
  const branchKey = branches
    .map((branch) => `${branch.rid}:${branch.waypoints.map((point) => `${point[0].toFixed(3)},${point[1].toFixed(3)}`).join('|')}`)
    .join('||')
  const frameStops = extraMapped.length ? [...mapped, ...extraMapped] : mapped

  useLayoutEffect(() => {
    inputRef.current = { stops, mapped, extraMapped, location, platforms, stopMarks, trainId, branches, callsOnly }
    routeColorRef.current = lineColor
    basemapRef.current = basemap
    routeModeRef.current = routeMode
  })

  useEffect(() => {
    const stored = storedBasemap()
    if (stored) {
      basemapChosen.current = true
      setBasemap(stored)
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapped.length < 1) return
    const center = [mapped[0].lng, mapped[0].lat]
    ensurePmtiles()
    ensureOrmSmoothProtocol()
    const rails = routeModeRef.current === 'rail'
    appliedStyle.current = `${basemapRef.current}:${routeModeRef.current}`
    const map = new maplibregl.Map({
      container,
      style: tracksMapStyle(basemapRef.current, rails),
      center: center as [number, number],
      zoom: 5,
      minZoom: 4,
      maxZoom: rails ? OPENRAILWAYMAP_MAX_ZOOM : 16,
      maxCanvasSize: [8192, 8192],
      attributionControl: false,
      fadeDuration: 0,
    })
    mapRef.current = map
    const onZoom = () => setZoom(map.getZoom())
    map.on('zoom', onZoom)
    map.on('movestart', (event) => {
      if (event.originalEvent) userMovedRef.current = true
    })
    let tipsBound = false
    const addRouteLayers = () => {
      if (map.getSource('tracks-route')) return
      map.addSource('tracks-route', { type: 'geojson', data: EMPTY })
      map.addSource('tracks-extra-route', { type: 'geojson', data: EMPTY })
      map.addSource('tracks-stops', { type: 'geojson', data: EMPTY })
      map.addSource('tracks-extra-stops', { type: 'geojson', data: EMPTY })
      map.addSource('tracks-live', { type: 'geojson', data: EMPTY })
      map.addSource('tracks-user', { type: 'geojson', data: EMPTY })
      map.addLayer({
        id: 'tracks-route-casing',
        type: 'line',
        source: 'tracks-route',
        paint: {
          'line-color': '#ffffff',
          'line-width': 8,
          'line-opacity': tracksRouteCasing(basemapRef.current) ? 0.9 : 0,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      map.addLayer({
        id: 'tracks-extra-line',
        type: 'line',
        source: 'tracks-extra-route',
        paint: {
          'line-color': routeColorRef.current,
          'line-width': ROUTE_LINE_WIDTH,
          'line-opacity': ROUTE_LINE_OPACITY,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      map.addLayer({
        id: 'tracks-route-line',
        type: 'line',
        source: 'tracks-route',
        paint: {
          'line-color': routeColorRef.current,
          'line-width': ROUTE_LINE_WIDTH,
          'line-opacity': ROUTE_LINE_OPACITY,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      })
      map.addLayer({
        id: 'tracks-extra-stops',
        type: 'circle',
        source: 'tracks-extra-stops',
        paint: {
          'circle-radius': ['match', ['get', 'kind'], 'stop', 7, 5],
          'circle-color': ['match', ['get', 'kind'], 'stop', '#16a34a', 'pass', '#2563eb', '#111827'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: 'tracks-stops',
        type: 'circle',
        source: 'tracks-stops',
        paint: {
          'circle-radius': ['match', ['get', 'kind'], 'stop', 7, 5],
          'circle-color': ['match', ['get', 'kind'], 'stop', '#16a34a', 'pass', '#2563eb', '#111827'],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      })
      map.addLayer({
        id: 'tracks-user',
        type: 'circle',
        source: 'tracks-user',
        paint: {
          'circle-radius': 8,
          'circle-color': '#2563eb',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      })
      map.addLayer({
        id: 'tracks-live',
        type: 'circle',
        source: 'tracks-live',
        paint: {
          'circle-radius': 11,
          'circle-color': '#ea580c',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      })
      const restyle = tipsBound
      const tipLayers = ['tracks-live', 'tracks-stops', 'tracks-extra-stops', 'tracks-user'] as const
      if (!tipsBound) {
        tipsBound = true
        const tip = markerTip()
        tipRef.current = tip
        for (const layer of tipLayers) {
          map.on('mouseenter', layer, (event) => {
            const feature = event.features?.[0]
            const label = feature?.properties?.label
            const coords = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null
            if (!label || !coords) return
            tipLiveRef.current = layer === 'tracks-live' ? String(feature?.properties?.id || label) : null
            placeTip(map, tip, coords as [number, number], String(label), layer, feature?.properties?.kind)
          })
          map.on('mouseleave', layer, (event) => {
            const hit = map.queryRenderedFeatures(event.point, { layers: [...tipLayers] })[0]
            const label = hit?.properties?.label
            const coords = hit?.geometry?.type === 'Point' ? hit.geometry.coordinates : null
            if (!hit || !label || !coords) {
              tipLiveRef.current = null
              map.getCanvas().style.cursor = ''
              tip.remove()
              return
            }
            tipLiveRef.current = hit.layer?.id === 'tracks-live' ? String(hit.properties?.id || label) : null
            placeTip(map, tip, coords as [number, number], String(label), hit.layer?.id, hit.properties?.kind)
          })
        }
      }
      if (pathRef.current) setSource(map, 'tracks-route', lineCollection(pathRef.current))
      setSource(map, 'tracks-stops', stopCollection(
        shownStops(inputRef.current.mapped, inputRef.current.callsOnly),
        pathRef.current,
        inputRef.current.platforms,
        inputRef.current.stopMarks,
      ))
      const user = userPointRef.current
      if (user) setSource(map, 'tracks-user', pointCollection(user.lat, user.lng, 'Your location'))
      setMapReady(map)
      if (restyle) setStyleEpoch((epoch) => epoch + 1)
      onZoom()
    }
    if (map.isStyleLoaded()) addRouteLayers()
    else map.on('style.load', addRouteLayers)
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(null)
      shownRef.current = null
    }
    // The map is created once per mount. Route and stop updates go through sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const key = `${basemap}:${routeMode}`
    if (!map || appliedStyle.current === key) return
    appliedStyle.current = key
    map.setMaxZoom(routeMode === 'rail' ? OPENRAILWAYMAP_MAX_ZOOM : 16)
    map.setStyle(tracksMapStyle(basemap, routeMode === 'rail'))
  }, [basemap, routeMode])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const frame = window.requestAnimationFrame(() => map.resize())
    return () => window.cancelAnimationFrame(frame)
  }, [fullscreen])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.getLayer('tracks-route-line')) return
    map.setPaintProperty('tracks-route-line', 'line-color', lineColor)
    if (map.getLayer('tracks-extra-line')) map.setPaintProperty('tracks-extra-line', 'line-color', lineColor)
    if (map.getLayer('tracks-route-casing')) {
      map.setPaintProperty('tracks-route-casing', 'line-opacity', tracksRouteCasing(basemap) ? 0.9 : 0)
    }
  }, [lineColor, basemap, mapReady])

  useEffect(() => {
    if ((routeMode === 'rail' ? railWaypoints : waypoints).length < 2) return
    const controller = new AbortController()
    let gone = false
    const paint = (path: LatLngTuple[]) => {
      if (gone || path.length < 2) return
      pathRef.current = path
      const map = mapRef.current
      if (!map?.getSource('tracks-route')) return
      setSource(map, 'tracks-route', lineCollection(path))
      setSource(map, 'tracks-stops', stopCollection(
        shownStops(inputRef.current.mapped, inputRef.current.callsOnly),
        path,
        inputRef.current.platforms,
        inputRef.current.stopMarks,
      ))
    }
    const clearRailLine = () => {
      pathRef.current = null
      const map = mapRef.current
      if (!map?.getSource('tracks-route')) return
      setSource(map, 'tracks-route', EMPTY)
      setSource(map, 'tracks-stops', stopCollection(
        shownStops(inputRef.current.mapped, inputRef.current.callsOnly),
        null,
        inputRef.current.platforms,
        inputRef.current.stopMarks,
      ))
    }
    if (routeMode === 'rail') {
      clearRailLine()
    } else if (savedRouteRef.current?.key === waypointKey) {
      paint(savedRouteRef.current.path)
    }
    const request = routeMode === 'rail'
      ? fetchPlatformRailRoute(railWaypoints, controller.signal, paint)
      : routeTracksJourney(waypoints, controller.signal, (path) => {
          savedRouteRef.current = { key: waypointKey, path }
          paint(path)
        })
    void request
      .then((path) => {
        if (gone) return
        if (!path || path.length < 2) {
          if (routeMode === 'rail') clearRailLine()
          return
        }
        if (routeMode === 'ours') savedRouteRef.current = { key: waypointKey, path }
        paint(path)
      })
      .catch(() => {
        if (!gone && routeMode === 'rail') clearRailLine()
      })
    return () => {
      gone = true
      controller.abort()
    }
    // waypointKey and railWaypointKey are the point lists. Array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMode, waypointKey, railWaypointKey])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.getSource('tracks-extra-route')) return
    if (!extraWaypoints.length) {
      setSource(map, 'tracks-extra-route', EMPTY)
      setSource(map, 'tracks-extra-stops', EMPTY)
      return
    }
    const controller = new AbortController()
    let gone = false
    const paint = (paths: LatLngTuple[][]) => {
      if (gone) return
      const features = paths.flatMap((path) => lineCollection(path).features)
      setSource(map, 'tracks-extra-route', { type: 'FeatureCollection', features })
      setSource(map, 'tracks-extra-stops', stopCollection(
        shownStops(extraMapped, inputRef.current.callsOnly),
        null,
        {},
      ))
    }
    void Promise.all(
      extraWaypoints.map((route) => routeTracksJourney(route, controller.signal).catch(() => [] as LatLngTuple[])),
    ).then(paint)
    return () => {
      gone = true
      controller.abort()
    }
    // extraKey is the content of the branch routes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraKey, mapReady, styleEpoch])

  useEffect(() => {
    if (!mapReady) return
    if (!branches.length) {
      branchPathsRef.current = new Map()
      return
    }
    const controller = new AbortController()
    let gone = false
    void Promise.all(
      branches.map(async (branch) => {
        const path = await routeTracksJourney(branch.waypoints, controller.signal).catch(() => [] as LatLngTuple[])
        return [branch.rid, path] as const
      }),
    ).then((rows) => {
      if (gone) return
      branchPathsRef.current = new Map(rows.filter(([, path]) => path.length >= 2))
    })
    return () => {
      gone = true
      controller.abort()
    }
    // branchKey is the content of the other services' routes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchKey, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.getSource('tracks-stops')) return
    const current = inputRef.current
    setSource(map, 'tracks-stops', stopCollection(
      shownStops(current.mapped, current.callsOnly),
      pathRef.current,
      current.platforms,
      current.stopMarks,
    ))
    if (map.getSource('tracks-extra-stops')) {
      setSource(map, 'tracks-extra-stops', stopCollection(shownStops(current.extraMapped, current.callsOnly), null, {}))
    }
  }, [mapped, extraMapped, platforms, stopMarks, callsOnly, mapReady])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || userMovedRef.current) return
    if (frameStops.length < 2 || frameStops.length === framedCountRef.current) return
    frameJourney(map, frameStops)
    framedCountRef.current = frameStops.length
  }, [frameStops, mapReady])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (ts: number) => {
      raf = window.requestAnimationFrame(tick)
      const map = mapRef.current
      if (!map || !map.getSource('tracks-live')) return
      const dt = Math.min(0.08, Math.max(0, (ts - last) / 1000))
      last = ts
      const now = londonNowRailwaySeconds()
      const current = inputRef.current
      const place = (
        shown: { lat: number; lng: number } | undefined,
        lat: number,
        lng: number,
      ) => {
        if (!shown) return { lat, lng }
        const jump = Math.abs(lat - shown.lat) + Math.abs(lng - shown.lng)
        if (jump > 0.35) return { lat, lng }
        const ease = 1 - Math.exp(-dt / 0.28)
        return {
          lat: shown.lat + (lat - shown.lat) * ease,
          lng: shown.lng + (lng - shown.lng) * ease,
        }
      }
      const points: Array<{ lat: number; lng: number; label: string; id: string }> = []
      const primary = liveJourneyPosition(current.stops || [], current.mapped, current.location, now)
      const primaryLive = primary ? snapLiveToRailPath(primary, pathRef.current) : null
      if (primaryLive && Number.isFinite(primaryLive.lat)) {
        const label = current.branches.length ? withHeadcode(current.trainId, primaryLive.label) : primaryLive.label
        const at = place(shownRef.current || undefined, primaryLive.lat, primaryLive.lng)
        shownRef.current = at
        points.push({ ...at, label, id: 'self' })
      }
      for (const branch of current.branches) {
        const raw = liveJourneyPosition(branch.stops, branch.mapped, branch.location, now)
        const live = raw ? snapLiveToRailPath(raw, branchPathsRef.current.get(branch.rid) || null) : null
        if (!live || !Number.isFinite(live.lat)) continue
        const at = place(shownBranchesRef.current.get(branch.rid), live.lat, live.lng)
        shownBranchesRef.current.set(branch.rid, at)
        points.push({ ...at, label: withHeadcode(branch.trainId, live.label), id: branch.rid })
      }
      if (!points.length) return
      setSource(map, 'tracks-live', liveCollection(points))
      const followed = tipLiveRef.current ? points.find((point) => point.id === tipLiveRef.current) : null
      if (followed && tipRef.current) {
        tipRef.current.setLngLat([followed.lng, followed.lat]).setHTML(tipHtml(followed.label))
      }
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [])

  const askLocation = () => {
    const map = mapRef.current
    if (!map || !navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        userPointRef.current = { lat, lng }
        if (!map.getSource('tracks-user')) return
        setSource(map, 'tracks-user', pointCollection(lat, lng, 'Your location'))
        map.flyTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 13) })
      },
      () => {
        /* The button stays. A refusal leaves the map where it is. */
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    )
  }

  return (
    <>
      <div ref={containerRef} className="svc-journey-map__canvas svc-journey-map__canvas--tracks" aria-label="Service journey map" />
      <SidePane open={layersOpen} title="Map style" onClose={() => setLayersOpen(false)}>
        {TRACKS_BASEMAP_GROUPS.map((group) => (
          <section key={group.title} className="svc-journey-map__layer-group" aria-label={group.title}>
            <h3 className="svc-journey-map__layer-title">{group.title}</h3>
            <div className="svc-journey-map__layer-grid" role="radiogroup" aria-label={group.title}>
              {group.styles.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={basemap === item.id}
                  className={
                    basemap === item.id
                      ? 'svc-journey-map__layer-option svc-journey-map__layer-option--on'
                      : 'svc-journey-map__layer-option'
                  }
                  onClick={() => {
                    basemapChosen.current = true
                    try {
                      localStorage.setItem(BASEMAP_KEY, item.id)
                    } catch {
                      /* The choice still applies for this visit. */
                    }
                    setBasemap(item.id)
                    setLayersOpen(false)
                  }}
                >
                  <img
                    className="svc-journey-map__layer-swatch"
                    src={`/map-styles/${item.id}.jpg`}
                    alt=""
                  />
                  {item.label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </SidePane>
      {mapReady
        ? createPortal(
            <>
              <div className="map-zoom-control">
                <BUTCircleButton
                  type="button"
                  ariaLabel="Zoom in"
                  icon={<Plus size={16} weight="bold" aria-hidden />}
                  disabled={zoom >= mapReady.getMaxZoom()}
                  onClick={() => mapReady.zoomIn()}
                />
                <BUTCircleButton
                  type="button"
                  ariaLabel="Zoom out"
                  icon={<Minus size={16} weight="bold" aria-hidden />}
                  disabled={zoom <= mapReady.getMinZoom()}
                  onClick={() => mapReady.zoomOut()}
                />
                <div className="svc-journey-map__layer">
                  <BUTCircleButton
                    type="button"
                    ariaLabel="Map style"
                    pressed={layersOpen}
                    instantAction
                    icon={<Stack size={16} weight="bold" aria-hidden />}
                    onClick={() => setLayersOpen(true)}
                  />
                </div>
              </div>
              {tracksBasemapCredit(basemap) || routeMode === 'rail' ? (
                <p className="svc-journey-map__imagery">
                  {[tracksBasemapCredit(basemap), routeMode === 'rail' ? TRACKS_RAIL_CREDIT : null]
                    .filter((line): line is string => Boolean(line))
                    .join('\n')}
                </p>
              ) : null}
              <div className="map-user-location">
                <BUTCircleButton
                  type="button"
                  ariaLabel="Show my location"
                  icon={<NavigationArrow size={16} weight="bold" aria-hidden />}
                  onClick={askLocation}
                />
              </div>
              <div className="svc-journey-map__fullscreen">
                <BUTCircleButton
                  type="button"
                  ariaLabel={fullscreen ? 'Exit full screen' : 'Full screen'}
                  icon={
                    fullscreen
                      ? <CornersIn size={16} weight="bold" aria-hidden />
                      : <CornersOut size={16} weight="bold" aria-hidden />
                  }
                  onClick={onToggleFullscreen}
                />
              </div>
            </>,
            mapReady.getContainer(),
          )
        : null}
    </>
  )
}
