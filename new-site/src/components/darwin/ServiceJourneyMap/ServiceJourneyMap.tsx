'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornersIn, CornersOut } from '@phosphor-icons/react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../../maps/leafletDarkTiles.css'
import { MapZoomControls } from '../../maps/MapZoomControls'
import { MapUserLocation } from '../../maps/MapUserLocation'
import { BUTCircleButton } from '../../buttons'
import { useTheme, readThemeFromDocument } from '../../../hooks/useTheme'
import { addThemeTileLayersToMap, swapThemeTileLayers, type MapTileLayerRefs } from '../../../utils/mapTileLayers'
import { railwayDaySecondsFromClock } from '../../../utils/railwayOperatingDayUk'
import { routeLimited, routedCoordinates, type LatLngTuple } from '../../../utils/brouterRailRoute'
import { platformSitsAtStation } from '../../../utils/platformPosition'
import { isValidStationCoordinate } from '../../../utils/stationCoordinates'
import {
  journeyMapStops,
  liveJourneyPosition,
  mappedRouteWaypoints,
  routeWaypointsDiffer,
  snapLiveToRailPath,
  snapMarkerToPath,
  tiplocsNeedingCoordinates,
  type RoutePlatform,
} from '../../../utils/serviceJourneyMap'
import { useTocOperators } from '../../../hooks/useTocOperators'
import { resolveTocRouteColor } from '../../../utils/tocOperatorMap'
import type { ServiceDetail } from '../../../types/darwin'
import type { Station } from '../../../types'
import { mapLocationBanner, type MapLocationBanner } from './mapLocationBanner'
import '@/components/darwin/callingPatternTones.css'
import './ServiceJourneyMap.css'

const ROUTE_LINE_PANE = 'svcJourneyLine'
const ROUTE_MARKER_PANE = 'svcJourneyMarkers'
const ROUTE_LIVE_PANE = 'svcJourneyLive'

const tiplocCoordCache = new Map<string, { lat: number; lng: number } | null>()

const POINT_COLOR = {
  stop: '#16a34a',
  pass: '#2563eb',
  junction: '#111827',
} as const

function markerOptions(fill: string, radius: number, pane: string): L.CircleMarkerOptions {
  return {
    radius,
    fillColor: fill,
    color: '#ffffff',
    weight: 2,
    fillOpacity: 1,
    pane,
  }
}

const LIVE_MARKER: L.CircleMarkerOptions = {
  radius: 11,
  fillColor: '#ea580c',
  color: '#fff',
  weight: 3,
  fillOpacity: 1,
  pane: ROUTE_LIVE_PANE,
}

const NO_PLATFORMS: Record<string, RoutePlatform> = {}

function readCoordPair(value: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const lat = Number(value[0])
  const lng = Number(value[1])
  if (!isValidStationCoordinate(lat, lng)) return null
  return { lat, lng }
}

function readPlatformPlacement(value: unknown): RoutePlatform | null {
  if (Array.isArray(value)) {
    const point = readCoordPair(value)
    return point ? { lat: point.lat, lng: point.lng } : null
  }
  if (!value || typeof value !== 'object') return null
  const row = value as { lat?: unknown; lng?: unknown; ends?: unknown; bay?: unknown; stand?: unknown }
  const lat = Number(row.lat)
  const lng = Number(row.lng)
  if (!isValidStationCoordinate(lat, lng)) return null
  const place: RoutePlatform = { lat, lng }
  if (Array.isArray(row.ends) && row.ends.length >= 2) {
    const first = readCoordPair(row.ends[0])
    const second = readCoordPair(row.ends[1])
    if (first && second) place.ends = [first, second]
  }
  const bay = readCoordPair(row.bay)
  if (bay) place.bay = bay
  const stand = readCoordPair(row.stand)
  if (stand) place.stand = stand
  return place
}

function chunkPlatformQuery(query: string, size = 40): string[] {
  const parts = query.split('|').filter(Boolean)
  const chunks: string[] = []
  for (let i = 0; i < parts.length; i += size) chunks.push(parts.slice(i, i + size).join('|'))
  return chunks
}

function appendPath(joined: LatLngTuple[], part: LatLngTuple[]) {
  if (!part.length) return
  const last = joined[joined.length - 1]
  const broken = Boolean(last && !Number.isFinite(last[0]))
  const start = joined.length > 0 && !broken ? 1 : 0
  for (let i = start; i < part.length; i++) joined.push(part[i])
}

async function fetchOneRailRoute(
  points: LatLngTuple[],
  signal: AbortSignal,
): Promise<LatLngTuple[] | 'limited' | null> {
  if (points.length < 2) return null
  const from = points[0]
  const to = points[points.length - 1]
  const via = points.slice(1, -1)
  const params = new URLSearchParams({
    fromLat: String(from[0]),
    fromLng: String(from[1]),
    toLat: String(to[0]),
    toLng: String(to[1]),
  })
  if (via.length > 0) {
    params.set('via', via.map(([lat, lng]) => `${lat},${lng}`).join('|'))
  }
  const response = await fetch(`/api/rail-route?${params.toString()}`, { signal })
  if (!response.ok) return null
  const payload: unknown = await response.json()
  if (routeLimited(payload)) return 'limited'
  return routedCoordinates(payload)
}

/** Follow the railway. A miss stays a gap. It is never filled with a straight line. */
async function routeAlong(points: LatLngTuple[], signal: AbortSignal): Promise<LatLngTuple[]> {
  if (points.length < 2 || signal.aborted) return []
  let routed: LatLngTuple[] | 'limited' | null = null
  try {
    routed = await fetchOneRailRoute(points, signal)
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
    routed = null
  }
  if (routed === 'limited') return []
  if (routed && routed.length >= 2) return routed
  if (points.length <= 2 || signal.aborted) return []
  const mid = Math.ceil(points.length / 2)
  const left = await routeAlong(points.slice(0, mid), signal)
  const right = await routeAlong(points.slice(mid - 1), signal)
  const joined: LatLngTuple[] = []
  appendPath(joined, left)
  if (!left.length || !right.length) joined.push([Number.NaN, Number.NaN])
  appendPath(joined, right)
  const drawn = joined.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  return drawn.length >= 2 ? joined : []
}

function routeSpan(path: LatLngTuple[]): number {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  let count = 0
  for (const [lat, lng] of path) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
    count += 1
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  if (count < 2) return 0
  return (north - south) + (east - west)
}

/** The whole journey, drawn once it is on the railway from end to end. */
async function fetchRailRouteAlongTrack(
  points: LatLngTuple[],
  signal: AbortSignal,
): Promise<LatLngTuple[]> {
  if (points.length < 2) return points
  return routeAlong(points, signal)
}

async function fetchTiplocCoords(
  tpls: string[],
  signal: AbortSignal,
): Promise<Record<string, { lat: number; lng: number }>> {
  const missing = tpls.filter((tpl) => !tiplocCoordCache.has(tpl))
  if (missing.length > 0) {
    const params = new URLSearchParams({ tpl: missing.join('|') })
    const response = await fetch(`/api/tiploc-coords?${params.toString()}`, { signal })
    if (!response.ok) throw new Error('tiploc coords')
    const payload = (await response.json()) as { coords?: Record<string, [number, number]> }
    for (const tpl of missing) {
      const hit = payload.coords?.[tpl]
      tiplocCoordCache.set(
        tpl,
        hit && isValidStationCoordinate(hit[0], hit[1]) ? { lat: hit[0], lng: hit[1] } : null,
      )
    }
  }
  const out: Record<string, { lat: number; lng: number }> = {}
  for (const tpl of tpls) {
    const hit = tiplocCoordCache.get(tpl)
    if (hit) out[tpl] = hit
  }
  return out
}

function ensureJourneyPanes(map: L.Map) {
  const line = map.getPane(ROUTE_LINE_PANE) || map.createPane(ROUTE_LINE_PANE)
  line.style.zIndex = '450'
  const markers = map.getPane(ROUTE_MARKER_PANE) || map.createPane(ROUTE_MARKER_PANE)
  markers.style.zIndex = '460'
  const live = map.getPane(ROUTE_LIVE_PANE) || map.createPane(ROUTE_LIVE_PANE)
  live.style.zIndex = '470'
}

function londonNowRailwaySeconds(): number | null {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    hour12: false,
  }).formatToParts(new Date())
  const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value || '00'
  return railwayDaySecondsFromClock(`${pick('hour')}:${pick('minute')}:${pick('second')}`)
}

function mapStillMounted(map: L.Map | null, container: HTMLElement | null): map is L.Map {
  if (!map || !container) return false
  if (!container.isConnected) return false
  if (!(container as HTMLElement & { _leaflet_id?: number })._leaflet_id) return false
  return map.getContainer() === container
}

function railSegments(path: LatLngTuple[] | null): LatLngTuple[][] {
  if (!path) return []
  const segments: LatLngTuple[][] = []
  let current: LatLngTuple[] = []
  const flush = () => {
    if (current.length >= 2) segments.push(current)
    current = []
  }
  for (const point of path) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      flush()
      continue
    }
    current.push(point)
  }
  flush()
  return segments
}

function validLatLngs(points: Array<LatLngTuple | L.LatLngTuple>): LatLngTuple[] {
  const out: LatLngTuple[] = []
  for (const p of points) {
    if (!Array.isArray(p) || p.length < 2) continue
    const lat = p[0]
    const lng = p[1]
    if (!isValidStationCoordinate(lat, lng)) continue
    out.push([lat, lng])
  }
  return out
}

const LIVE_OPEN_ZOOM = 13

/** Open on the train. A later movement of that marker does not move the map. */
function openingView(input: {
  stops: ServiceDetail['stops']
  mapped: ReturnType<typeof journeyMapStops>
  location: ServiceDetail['location']
  railPath: LatLngTuple[] | null
}): { center: LatLngTuple; zoom: number; locked: boolean } {
  const raw = liveJourneyPosition(input.stops || [], input.mapped, input.location, londonNowRailwaySeconds())
  const live = raw ? snapLiveToRailPath(raw, input.railPath) : null
  if (live && isValidStationCoordinate(live.lat, live.lng)) {
    return { center: [live.lat, live.lng], zoom: LIVE_OPEN_ZOOM, locked: true }
  }
  const first = input.mapped[0]
  return {
    center: [first?.lat ?? 54.5, first?.lng ?? -2],
    zoom: 8,
    locked: false,
  }
}

export function ServiceJourneyMap({
  service,
  stations,
}: {
  service: ServiceDetail
  stations: Station[]
}) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<L.Map | null>(null)
  const tileLayersRef = useRef<MapTileLayerRefs | null>(null)
  const layersRef = useRef<L.LayerGroup | null>(null)
  const liveMarkerRef = useRef<L.CircleMarker | null>(null)
  const shownRef = useRef<{ lat: number; lng: number } | null>(null)
  const viewLockedRef = useRef(false)
  const liveInputRef = useRef({
    stops: service.stops,
    mapped: [] as ReturnType<typeof journeyMapStops>,
    location: service.location,
    railPath: null as LatLngTuple[] | null,
    cancelled: service.cancelled,
  })
  const bannerKeyRef = useRef('')
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const [banner, setBanner] = useState<MapLocationBanner | null>(null)
  const [trackPath, setTrackPath] = useState<LatLngTuple[] | null>(null)
  const [extraCoords, setExtraCoords] = useState<Record<string, { lat: number; lng: number }>>({})
  const [platformCoords, setPlatformCoords] = useState<Record<string, RoutePlatform>>({})
  const [platformQueryReady, setPlatformQueryReady] = useState<string | null>(null)
  const [geoReady, setGeoReady] = useState(false)
  const { theme } = useTheme()
  const { operators } = useTocOperators()
  const themeKey = theme === 'dark' ? 'dark' : 'light'
  const routeColor = useMemo(
    () => resolveTocRouteColor(operators, service.toc, service.tocName),
    [operators, service.toc, service.tocName],
  )
  const neededKey = useMemo(
    () => tiplocsNeedingCoordinates(service.stops || [], stations).join('|'),
    [service.stops, stations],
  )

  const mapped = useMemo(
    () => journeyMapStops(service.stops || [], stations, extraCoords),
    [service.stops, stations, extraCoords],
  )
  const platformQuery = useMemo(
    () =>
      mapped
        .filter((point) => point.platform)
        .map((point) => `${point.index}~${point.lat.toFixed(5)}~${point.lng.toFixed(5)}~${encodeURIComponent(point.platform || '')}`)
        .join('|'),
    [mapped],
  )
  const activePlatforms = useMemo(() => {
    if (platformQueryReady !== platformQuery) return NO_PLATFORMS
    const next: Record<string, RoutePlatform> = {}
    for (const [id, place] of Object.entries(platformCoords)) {
      const stop = mapped.find((point) => String(point.index) === id)
      if (!stop || !platformSitsAtStation(stop, place)) continue
      next[id] = place
    }
    return next
  }, [mapped, platformCoords, platformQuery, platformQueryReady])
  const stationWaypoints = useMemo(() => mappedRouteWaypoints(mapped), [mapped])
  const waypoints = useMemo(
    () => mappedRouteWaypoints(mapped, activePlatforms),
    [mapped, activePlatforms],
  )
  const stationWaypointKey = useMemo(
    () => stationWaypoints.map((point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).join('|'),
    [stationWaypoints],
  )
  const waypointKey = useMemo(
    () => waypoints.map((point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).join('|'),
    [waypoints],
  )
  const stationWaypointsRef = useRef(stationWaypoints)
  stationWaypointsRef.current = stationWaypoints
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints
  const routeEpochRef = useRef(0)
  const fineRouteDoneRef = useRef(false)
  const [stationRouteSettledKey, setStationRouteSettledKey] = useState<string | null>(null)
  const railPath = waypoints.length < 2 ? null : trackPath
  const hasPoints = mapped.length >= 1

  useEffect(() => {
    liveInputRef.current = {
      stops: service.stops,
      mapped,
      location: service.location,
      railPath,
      cancelled: service.cancelled,
    }
  }, [service.stops, mapped, service.location, railPath, service.cancelled])

  useEffect(() => {
    if (!neededKey) {
      setExtraCoords({})
      setGeoReady(true)
      return
    }
    const controller = new AbortController()
    let cancelled = false
    setGeoReady(false)
    void fetchTiplocCoords(neededKey.split('|'), controller.signal)
      .then((coords) => {
        if (cancelled) return
        setExtraCoords(coords)
        setGeoReady(true)
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        setExtraCoords({})
        setGeoReady(true)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [neededKey])

  const applyRoutedPath = (path: LatLngTuple[]) => {
    if (railSegments(path).length < 1) return
    setTrackPath((current) => {
      if (!current) return path
      // A section that has just arrived must not wipe a line that already
      // runs further along the journey.
      if (routeSpan(path) + 0.02 < routeSpan(current)) return current
      return path
    })
  }

  useEffect(() => {
    // Snap onto the tracks from the station pins immediately. Platform vias
    // refine this afterwards; they must not hold the first snap.
    const points = stationWaypointsRef.current
    if (!geoReady || points.length < 2) return
    const epoch = routeEpochRef.current + 1
    routeEpochRef.current = epoch
    fineRouteDoneRef.current = false
    setStationRouteSettledKey(null)
    const controller = new AbortController()
    let cancelled = false
    const publish = (path: LatLngTuple[]) => {
      if (cancelled || routeEpochRef.current !== epoch || fineRouteDoneRef.current) return
      applyRoutedPath(path)
    }
    void fetchRailRouteAlongTrack(points, controller.signal)
      .then(publish)
      .catch(() => {
        if (cancelled || routeEpochRef.current !== epoch || fineRouteDoneRef.current) return
      })
      .finally(() => {
        if (cancelled || routeEpochRef.current !== epoch) return
        setStationRouteSettledKey(stationWaypointKey)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [geoReady, stationWaypointKey])

  useEffect(() => {
    if (!geoReady || stationRouteSettledKey !== stationWaypointKey || platformQueryReady !== platformQuery) return
    const points = waypointsRef.current
    const base = stationWaypointsRef.current
    if (points.length < 2 || !routeWaypointsDiffer(base, points)) return
    const epoch = routeEpochRef.current
    const controller = new AbortController()
    let cancelled = false
    void fetchRailRouteAlongTrack(points, controller.signal)
      .then((path) => {
        if (cancelled || routeEpochRef.current !== epoch) return
        if (railSegments(path).length < 1) return
        fineRouteDoneRef.current = true
        applyRoutedPath(path)
      })
      .catch(() => {
        /* Keep the station line. A failed refinement must not block it. */
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [geoReady, platformQuery, platformQueryReady, waypointKey, stationRouteSettledKey, stationWaypointKey])

  useEffect(() => {
    if (!platformQuery) {
      setPlatformCoords(NO_PLATFORMS)
      setPlatformQueryReady('')
      return
    }
    const controller = new AbortController()
    let cancelled = false
    const chunks = chunkPlatformQuery(platformQuery)
    void Promise.all(
      chunks.map(async (chunk) => {
        const response = await fetch(`/api/platform-coords?at=${encodeURIComponent(chunk)}`, {
          signal: controller.signal,
        })
        if (!response.ok) return {}
        const payload = (await response.json()) as { coords?: Record<string, unknown> }
        return payload.coords || {}
      }),
    )
      .then((parts) => {
        if (cancelled) return
        const next: Record<string, RoutePlatform> = {}
        for (const part of parts) {
          for (const [id, value] of Object.entries(part)) {
            const place = readPlatformPlacement(value)
            if (place) next[id] = place
          }
        }
        setPlatformCoords(next)
        setPlatformQueryReady(platformQuery)
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        setPlatformCoords(NO_PLATFORMS)
        setPlatformQueryReady(platformQuery)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [platformQuery])

  useEffect(() => {
    if (!geoReady || !mapRef.current || !hasPoints) return
    const opened = openingView(liveInputRef.current)
    const map = L.map(mapRef.current, { zoomControl: false, scrollWheelZoom: true }).setView(
      opened.center,
      opened.zoom,
      { animate: false },
    )
    viewLockedRef.current = opened.locked
    ensureJourneyPanes(map)
    tileLayersRef.current = addThemeTileLayersToMap(map, readThemeFromDocument())
    layersRef.current = L.layerGroup().addTo(map)
    const liveMarker = L.circleMarker(opened.center, LIVE_MARKER)
    liveMarker.bindTooltip('', { direction: 'top', opacity: 0.95 })
    liveMarker.addTo(map)
    liveMarkerRef.current = liveMarker
    shownRef.current = { lat: opened.center[0], lng: opened.center[1] }
    mapInstanceRef.current = map
    const redrawRoute = () => {
      layersRef.current?.eachLayer((layer) => {
        const path = layer as L.Path
        if (typeof path.redraw === 'function') path.redraw()
      })
      liveMarkerRef.current?.redraw()
    }
    map.on('zoomend', redrawRoute)
    const ready = window.requestAnimationFrame(() => setMapInstance(map))
    return () => {
      window.cancelAnimationFrame(ready)
      map.off('zoomend', redrawRoute)
      map.remove()
      mapInstanceRef.current = null
      layersRef.current = null
      liveMarkerRef.current = null
      tileLayersRef.current = null
      viewLockedRef.current = false
      shownRef.current = null
      setMapInstance(null)
    }
  }, [geoReady, hasPoints])

  useEffect(() => {
    if (!mapInstanceRef.current || !tileLayersRef.current) return
    tileLayersRef.current = swapThemeTileLayers(mapInstanceRef.current, tileLayersRef.current, themeKey)
  }, [themeKey])

  useEffect(() => {
    const map = mapInstanceRef.current
    const group = layersRef.current
    const container = mapRef.current
    if (!mapStillMounted(map, container) || !group) return
    group.clearLayers()
    if (mapped.length < 1) return

    const lineOptions = {
      lineJoin: 'round' as const,
      lineCap: 'round' as const,
      interactive: false,
      smoothFactor: 0,
      pane: ROUTE_LINE_PANE,
    }
    for (const segment of railSegments(railPath)) {
      const latlngs = validLatLngs(segment)
      if (latlngs.length < 2) continue
      L.polyline(latlngs, { ...lineOptions, color: '#ffffff', weight: 8, opacity: 0.92 }).addTo(group)
      L.polyline(latlngs, { ...lineOptions, color: routeColor, weight: 5, opacity: 0.95 }).addTo(group)
    }

    const placeOnTrack = Boolean(railPath && railPath.length > mapped.length + 2)
    for (const p of mapped) {
      if (!isValidStationCoordinate(p.lat, p.lng)) continue
      const onPlatform = activePlatforms[String(p.index)]
      const terminal = p.index === mapped[0]?.index || p.index === mapped[mapped.length - 1]?.index
      const at = (terminal && onPlatform?.bay)
        ? onPlatform.bay
        : (p.calling && onPlatform?.stand)
          ? onPlatform.stand
          : onPlatform ?? (placeOnTrack ? snapMarkerToPath(p, railPath, p.kind === 'junction' ? 80 : 250) : p)
      const marker = L.circleMarker(
        [at.lat, at.lng],
        markerOptions(POINT_COLOR[p.kind], p.kind === 'stop' ? 7 : 5, ROUTE_MARKER_PANE),
      )
      const label = onPlatform && p.platform ? `${p.name} · Platform ${p.platform}` : p.name
      marker.bindTooltip(label, { direction: 'top', opacity: 0.95 })
      marker.addTo(group)
    }
    const frame = window.requestAnimationFrame(() => {
      if (!mapStillMounted(map, container)) return
      group.eachLayer((layer) => {
        const path = layer as L.Path
        if (typeof path.redraw === 'function') path.redraw()
      })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [railPath, mapped, routeColor, platformCoords, mapInstance])

  useEffect(() => {
    let raf = 0
    let lastTs = performance.now()
    let lastCaptionAt = 0
    const tick = (ts: number) => {
      raf = window.requestAnimationFrame(tick)
      const dt = Math.min(0.08, Math.max(0, (ts - lastTs) / 1000))
      lastTs = ts
      const marker = liveMarkerRef.current
      const { stops, mapped: pts, location, railPath: path, cancelled } = liveInputRef.current
      if (!marker || !pts.length) return
      const raw = liveJourneyPosition(stops || [], pts, location, londonNowRailwaySeconds())
      const live = raw ? snapLiveToRailPath(raw, path) : null
      if (!live) return
      if (!shownRef.current) {
        shownRef.current = { lat: live.lat, lng: live.lng }
      } else {
        const jump =
          Math.abs(live.lat - shownRef.current.lat) + Math.abs(live.lng - shownRef.current.lng)
        if (jump > 0.35) {
          shownRef.current = { lat: live.lat, lng: live.lng }
        } else {
          const ease = 1 - Math.exp(-dt / 0.28)
          shownRef.current.lat += (live.lat - shownRef.current.lat) * ease
          shownRef.current.lng += (live.lng - shownRef.current.lng) * ease
        }
      }
      marker.setLatLng([shownRef.current.lat, shownRef.current.lng])
      marker.setTooltipContent(live.label)
      const map = mapInstanceRef.current
      if (!viewLockedRef.current && map) {
        map.setView([shownRef.current.lat, shownRef.current.lng], LIVE_OPEN_ZOOM, { animate: false })
        viewLockedRef.current = true
      }
      if (ts - lastCaptionAt > 400) {
        lastCaptionAt = ts
        const next = mapLocationBanner(stops || [], raw, { cancelled })
        const key = next ? `${next.tone}|${next.text}` : ''
        if (key !== bannerKeyRef.current) {
          bannerKeyRef.current = key
          setBanner(next)
        }
      }
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const map = mapInstanceRef.current
    const container = mapRef.current
    if (!mapStillMounted(map, container)) return
    const refresh = () => {
      try {
        map.invalidateSize({ pan: false, debounceMoveend: true })
        layersRef.current?.eachLayer((layer) => {
          const path = layer as L.Path
          if (typeof path.redraw === 'function') path.redraw()
        })
        liveMarkerRef.current?.redraw()
      } catch {
        /* layout race */
      }
    }
    const t = window.setTimeout(refresh, 80)
    window.addEventListener('resize', refresh)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', refresh)
    }
  }, [geoReady, hasPoints])

  const shellRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const sync = () => {
      setFullscreen(document.fullscreenElement === shell)
      const map = mapInstanceRef.current
      if (!map) return
      window.requestAnimationFrame(() => {
        try {
          map.invalidateSize({ pan: false, debounceMoveend: true })
        } catch {
          /* layout race */
        }
      })
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [geoReady, hasPoints])

  const toggleFullscreen = () => {
    const shell = shellRef.current
    if (!shell) return
    if (document.fullscreenElement === shell) {
      void document.exitFullscreen()
      return
    }
    void shell.requestFullscreen()
  }

  if (!geoReady) {
    return <p className="edit-hint kb-source-hint">Plotting the route…</p>
  }

  if (mapped.length < 1) {
    return (
      <p className="edit-hint kb-source-hint">
        No mapped locations yet for this working.
      </p>
    )
  }

  return (
    <div className="svc-journey-map" ref={shellRef}>
      {banner ? (
        <p className={`svc-journey-map__where svc-journey-map__where--${banner.tone}`} role="status">
          {banner.text}
        </p>
      ) : null}
      <div
        ref={mapRef}
        className="location-map-preview location-map-preview-osm svc-journey-map__canvas"
        aria-label="Service journey map"
      />
      <MapZoomControls map={mapInstance} />
      <MapUserLocation map={mapInstance} />
      {mapInstance
        ? createPortal(
            <div className="svc-journey-map__fullscreen">
              <BUTCircleButton
                type="button"
                ariaLabel={fullscreen ? 'Exit full screen' : 'Full screen'}
                icon={
                  fullscreen
                    ? <CornersIn size={16} weight="bold" aria-hidden />
                    : <CornersOut size={16} weight="bold" aria-hidden />
                }
                onClick={toggleFullscreen}
              />
            </div>,
            mapInstance.getContainer(),
          )
        : null}
      <p className="svc-journey-map__caption svc-journey-map__caption--licence">
        Railway tracks from{' '}
        <a href="https://www.openrailwaymap.org/" target="_blank" rel="noreferrer">
          OpenRailwayMap
        </a>
        . Platforms from{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
        .
      </p>
    </div>
  )
}
