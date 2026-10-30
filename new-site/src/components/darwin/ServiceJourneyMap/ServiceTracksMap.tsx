'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornersIn, CornersOut, Minus, NavigationArrow, Plus } from '@phosphor-icons/react'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl'
import { Protocol } from 'pmtiles'
import 'maplibre-gl/dist/maplibre-gl.css'
import { BUTCircleButton } from '../../buttons'
import '../../maps/MapZoomControls.css'
import '../../maps/MapUserLocation.css'
import { railwayDaySecondsFromClock } from '../../../utils/railwayOperatingDayUk'
import type { LatLngTuple } from '../../../utils/brouterRailRoute'
import {
  liveJourneyPosition,
  snapLiveToRailPath,
  snapMarkerToPath,
  type JourneyMapStop,
  type RoutePlatform,
} from '../../../utils/serviceJourneyMap'
import {
  tracksMapStyle,
  type TracksMapTheme,
} from '../../../utils/tracksDarkStyle'
import { routeTracksJourney, splitRouteGaps } from '../../../utils/tracksRailRoute'
import { liftRouteColorForDarkBasemap } from '../../../utils/tocOperatorMap'
import type { ServiceDetail } from '../../../types/darwin'

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

let pmtilesReady = false
function ensurePmtiles() {
  if (pmtilesReady) return
  maplibregl.setWorkerUrl('/maplibre-gl-worker.js')
  const protocol = new Protocol()
  maplibregl.addProtocol('pmtiles', protocol.tile)
  pmtilesReady = true
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

function stopCollection(
  stops: JourneyMapStop[],
  path: LatLngTuple[] | null,
  platforms: Record<string, RoutePlatform>,
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
        const at = (terminal && onPlatform?.bay)
          ? onPlatform.bay
          : (stop.calling && onPlatform?.stand)
            ? onPlatform.stand
            : onPlatform ?? (placeOnTrack ? snapMarkerToPath(stop, path, stop.kind === 'junction' ? 220 : 250) : stop)
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

function pointCollection(lat: number, lng: number, label = ''): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { label },
        geometry: { type: 'Point', coordinates: [lng, lat] },
      },
    ],
  }
}

/** Same stroke width as the Leaflet service line, in the operator colour. */
const ROUTE_LINE_WIDTH = 5
const ROUTE_LINE_OPACITY = 1

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
  mapped,
  stops,
  location,
  platforms,
  routeColor,
  theme,
  fullscreen,
  onToggleFullscreen,
}: {
  waypoints: LatLngTuple[]
  mapped: JourneyMapStop[]
  stops: ServiceDetail['stops']
  location: ServiceDetail['location']
  platforms: Record<string, RoutePlatform>
  routeColor: string
  theme: TracksMapTheme
  fullscreen: boolean
  onToggleFullscreen: () => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const [mapReady, setMapReady] = useState<MapLibreMap | null>(null)
  const [zoom, setZoom] = useState(8)
  const pathRef = useRef<LatLngTuple[] | null>(null)
  const inputRef = useRef({ stops, mapped, location, platforms })
  const shownRef = useRef<{ lat: number; lng: number } | null>(null)
  const viewLockedRef = useRef(false)
  const lineColor = theme === 'dark' ? liftRouteColorForDarkBasemap(routeColor) : routeColor
  const routeColorRef = useRef(lineColor)
  const appliedTheme = useRef(theme)
  const tipRef = useRef<maplibregl.Popup | null>(null)
  const tipLiveRef = useRef(false)
  const waypointKey = waypoints.map((point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).join('|')

  useLayoutEffect(() => {
    inputRef.current = { stops, mapped, location, platforms }
    routeColorRef.current = lineColor
  })

  useEffect(() => {
    const container = containerRef.current
    if (!container || mapped.length < 1) return
    const raw = liveJourneyPosition(stops || [], mapped, location, londonNowRailwaySeconds())
    const live = raw && Number.isFinite(raw.lat) ? raw : null
    const center = live ? [live.lng, live.lat] : [mapped[0].lng, mapped[0].lat]
    ensurePmtiles()
    const map = new maplibregl.Map({
      container,
      style: tracksMapStyle(theme),
      center: center as [number, number],
      zoom: live ? 13 : 8,
      minZoom: 4,
      maxZoom: 16,
      maxCanvasSize: [8192, 8192],
      attributionControl: false,
      fadeDuration: 0,
    })
    viewLockedRef.current = Boolean(live)
    mapRef.current = map
    const onZoom = () => setZoom(map.getZoom())
    map.on('zoom', onZoom)
    const addRouteLayers = () => {
      if (map.getSource('tracks-route')) return
      map.addSource('tracks-route', { type: 'geojson', data: EMPTY })
      map.addSource('tracks-stops', { type: 'geojson', data: EMPTY })
      map.addSource('tracks-live', { type: 'geojson', data: EMPTY })
      map.addSource('tracks-user', { type: 'geojson', data: EMPTY })
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
      const tip = markerTip()
      tipRef.current = tip
      const tipLayers = ['tracks-live', 'tracks-stops', 'tracks-user'] as const
      for (const layer of tipLayers) {
        map.on('mouseenter', layer, (event) => {
          const feature = event.features?.[0]
          const label = feature?.properties?.label
          const coords = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null
          if (!label || !coords) return
          tipLiveRef.current = layer === 'tracks-live'
          placeTip(map, tip, coords as [number, number], String(label), layer, feature?.properties?.kind)
        })
        map.on('mouseleave', layer, (event) => {
          const hit = map.queryRenderedFeatures(event.point, { layers: [...tipLayers] })[0]
          const label = hit?.properties?.label
          const coords = hit?.geometry?.type === 'Point' ? hit.geometry.coordinates : null
          if (!hit || !label || !coords) {
            tipLiveRef.current = false
            map.getCanvas().style.cursor = ''
            tip.remove()
            return
          }
          tipLiveRef.current = hit.layer?.id === 'tracks-live'
          placeTip(map, tip, coords as [number, number], String(label), hit.layer?.id, hit.properties?.kind)
        })
      }
      if (pathRef.current) setSource(map, 'tracks-route', lineCollection(pathRef.current))
      setSource(map, 'tracks-stops', stopCollection(inputRef.current.mapped, pathRef.current, inputRef.current.platforms))
      setMapReady(map)
      onZoom()
    }
    if (map.isStyleLoaded()) addRouteLayers()
    else map.on('style.load', addRouteLayers)
    return () => {
      map.remove()
      mapRef.current = null
      setMapReady(null)
      viewLockedRef.current = false
      shownRef.current = null
    }
    // The map is created once per mount. Route and stop updates go through sources.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map || appliedTheme.current === theme) return
    appliedTheme.current = theme
    map.setStyle(tracksMapStyle(theme))
  }, [theme])

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
  }, [lineColor, mapReady])

  useEffect(() => {
    if (waypoints.length < 2) return
    const controller = new AbortController()
    let gone = false
    void routeTracksJourney(waypoints, controller.signal)
      .then((path) => {
        if (gone) return
        pathRef.current = path
        const map = mapRef.current
        if (map && map.getSource('tracks-route')) {
          setSource(map, 'tracks-route', lineCollection(path))
          setSource(map, 'tracks-stops', stopCollection(inputRef.current.mapped, path, inputRef.current.platforms))
        }
      })
      .catch(() => {
        /* A replaced journey aborts the search. */
      })
    return () => {
      gone = true
      controller.abort()
    }
    // waypointKey is the content of waypoints. The array identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waypointKey])

  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map?.getSource('tracks-stops')) return
    setSource(map, 'tracks-stops', stopCollection(mapped, pathRef.current, platforms))
  }, [mapped, platforms, mapReady])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (ts: number) => {
      raf = window.requestAnimationFrame(tick)
      const map = mapRef.current
      if (!map || !map.getSource('tracks-live')) return
      const dt = Math.min(0.08, Math.max(0, (ts - last) / 1000))
      last = ts
      const { stops: liveStops, mapped: pts, location: liveLocation } = inputRef.current
      if (!pts.length) return
      const raw = liveJourneyPosition(liveStops || [], pts, liveLocation, londonNowRailwaySeconds())
      const live = raw ? snapLiveToRailPath(raw, pathRef.current) : null
      if (!live || !Number.isFinite(live.lat)) return
      if (!shownRef.current) {
        shownRef.current = { lat: live.lat, lng: live.lng }
      } else {
        const jump = Math.abs(live.lat - shownRef.current.lat) + Math.abs(live.lng - shownRef.current.lng)
        if (jump > 0.35) {
          shownRef.current = { lat: live.lat, lng: live.lng }
        } else {
          const ease = 1 - Math.exp(-dt / 0.28)
          shownRef.current.lat += (live.lat - shownRef.current.lat) * ease
          shownRef.current.lng += (live.lng - shownRef.current.lng) * ease
        }
      }
      setSource(map, 'tracks-live', pointCollection(shownRef.current.lat, shownRef.current.lng, live.label))
      if (tipLiveRef.current && tipRef.current) {
        tipRef.current.setLngLat([shownRef.current.lng, shownRef.current.lat]).setHTML(tipHtml(live.label))
      }
      if (!viewLockedRef.current) {
        map.jumpTo({ center: [shownRef.current.lng, shownRef.current.lat], zoom: 13 })
        viewLockedRef.current = true
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
              </div>
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
