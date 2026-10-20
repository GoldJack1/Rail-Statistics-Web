'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../../maps/leafletDarkTiles.css'
import { MapZoomControls } from '../../maps/MapZoomControls'
import { useTheme, readThemeFromDocument } from '../../../hooks/useTheme'
import { addThemeTileLayersToMap, swapThemeTileLayers, type MapTileLayerRefs } from '../../../utils/mapTileLayers'
import { railwayDaySecondsFromClock } from '../../../utils/railwayOperatingDayUk'
import { routeLimited, routedCoordinates, type LatLngTuple } from '../../../utils/brouterRailRoute'
import { isValidStationCoordinate } from '../../../utils/stationCoordinates'
import {
  journeyMapStops,
  liveJourneyPosition,
  mappedRouteWaypoints,
  removeRouteReversals,
  replaceInflatedLegs,
  snapLiveToRailPath,
  snapMarkerToPath,
  tiplocsNeedingCoordinates,
  type RoutePlatform,
} from '../../../utils/serviceJourneyMap'
import { useTocOperators } from '../../../hooks/useTocOperators'
import { resolveTocRouteColor } from '../../../utils/tocOperatorMap'
import type { ServiceDetail } from '../../../types/darwin'
import type { Station } from '../../../types'
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

const ROUTE_CHUNK = 8
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
  const start = joined.length > 0 ? 1 : 0
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

/** Follow the railway. A failed chunk is split so one miss does not draw a long chord. */
async function routeAlong(points: LatLngTuple[], signal: AbortSignal): Promise<LatLngTuple[]> {
  if (points.length < 2) return points
  if (signal.aborted) return points
  let routed: LatLngTuple[] | 'limited' | null = null
  try {
    routed = await fetchOneRailRoute(points, signal)
  } catch (error) {
    if (signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error
    routed = null
  }
  if (routed === 'limited') return points
  if (routed && routed.length >= 2) return routed
  if (points.length <= 2 || signal.aborted) return points
  const mid = Math.ceil(points.length / 2)
  const left = await routeAlong(points.slice(0, mid), signal)
  const right = await routeAlong(points.slice(mid - 1), signal)
  const joined: LatLngTuple[] = []
  appendPath(joined, left)
  appendPath(joined, right)
  return joined.length >= 2 ? joined : points
}

async function fetchRailRouteAlongTrack(points: LatLngTuple[], signal: AbortSignal): Promise<LatLngTuple[]> {
  if (points.length < 2) return points
  const chunks: LatLngTuple[][] = []
  for (let i = 0; i < points.length - 1; i += ROUTE_CHUNK - 1) {
    const slice = points.slice(i, i + ROUTE_CHUNK)
    if (slice.length >= 2) chunks.push(slice)
  }
  const parts: LatLngTuple[][] = new Array(chunks.length)
  let cursor = 0
  async function worker() {
    while (cursor < chunks.length) {
      if (signal.aborted) return
      const index = cursor
      cursor += 1
      parts[index] = await routeAlong(chunks[index], signal)
    }
  }
  const workers = Math.min(3, chunks.length)
  await Promise.all(Array.from({ length: workers }, () => worker()))
  const joined: LatLngTuple[] = []
  for (const part of parts) appendPath(joined, part || [])
  return joined.length >= 2 ? joined : points
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

function fitJourneyBounds(map: L.Map, points: LatLngTuple[]) {
  const latlngs = validLatLngs(points)
  if (latlngs.length < 1) return
  try {
    map.invalidateSize({ pan: false, debounceMoveend: true })
    const size = map.getSize()
    if (!size || size.x < 8 || size.y < 8) return
    if (latlngs.length === 1) {
      map.setView(latlngs[0], 10, { animate: false })
      return
    }
    const bounds = L.latLngBounds(latlngs)
    if (!bounds.isValid()) return
    map.fitBounds(bounds.pad(0.18), { animate: false, maxZoom: 12 })
  } catch {
    /* Leaflet throws bounds.min when the map has no pixel origin yet. */
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
  const fittedKeyRef = useRef('')
  const liveInputRef = useRef({
    stops: service.stops,
    mapped: [] as ReturnType<typeof journeyMapStops>,
    location: service.location,
    railPath: null as LatLngTuple[] | null,
  })
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const [liveLabel, setLiveLabel] = useState<string | null>(null)
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
  const routeKey = useMemo(
    () => mapped.map((p) => `${p.tpl}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`).join('|'),
    [mapped],
  )
  const platformQuery = useMemo(
    () =>
      mapped
        .filter((point) => point.platform)
        .map((point) => `${point.index}~${point.lat.toFixed(5)}~${point.lng.toFixed(5)}~${encodeURIComponent(point.platform || '')}`)
        .join('|'),
    [mapped],
  )
  const activePlatforms = platformQueryReady === platformQuery ? platformCoords : NO_PLATFORMS
  const waypoints = useMemo(
    () => mappedRouteWaypoints(mapped, activePlatforms),
    [mapped, activePlatforms],
  )
  const waypointKey = useMemo(
    () => waypoints.map((point) => `${point[0].toFixed(5)},${point[1].toFixed(5)}`).join('|'),
    [waypoints],
  )
  const waypointsRef = useRef(waypoints)
  waypointsRef.current = waypoints
  const railPath = waypoints.length < 2 ? null : trackPath
  const hasPoints = mapped.length >= 1
  const startLat = mapped[0]?.lat
  const startLng = mapped[0]?.lng

  useEffect(() => {
    liveInputRef.current = {
      stops: service.stops,
      mapped,
      location: service.location,
      railPath,
    }
  }, [service.stops, mapped, service.location, railPath])

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

  useEffect(() => {
    const points = waypointsRef.current
    if (!geoReady || platformQueryReady !== platformQuery || points.length < 2) return
    const controller = new AbortController()
    let cancelled = false
    void fetchRailRouteAlongTrack(points, controller.signal)
      .then((path) => {
        // Drop a short out-and-back. A real reversal, such as Sheffield, is longer
        // than this and stays. A leg the router has inflated is still straightened.
        if (!cancelled) setTrackPath(replaceInflatedLegs(removeRouteReversals(path, 30, 45, 350), points))
      })
      .catch(() => {
        if (!cancelled) setTrackPath(points)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [geoReady, platformQuery, platformQueryReady, waypointKey])

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
    if (!geoReady || !mapRef.current || !hasPoints || startLat == null || startLng == null) return
    const map = L.map(mapRef.current, { zoomControl: false, scrollWheelZoom: true }).setView(
      [startLat, startLng],
      7,
    )
    ensureJourneyPanes(map)
    tileLayersRef.current = addThemeTileLayersToMap(map, readThemeFromDocument())
    layersRef.current = L.layerGroup().addTo(map)
    const liveMarker = L.circleMarker([startLat, startLng], LIVE_MARKER)
    liveMarker.bindTooltip('', { direction: 'top', opacity: 0.95 })
    liveMarker.addTo(map)
    liveMarkerRef.current = liveMarker
    mapInstanceRef.current = map
    const ready = window.requestAnimationFrame(() => setMapInstance(map))
    return () => {
      window.cancelAnimationFrame(ready)
      map.remove()
      mapInstanceRef.current = null
      layersRef.current = null
      liveMarkerRef.current = null
      tileLayersRef.current = null
      fittedKeyRef.current = ''
      shownRef.current = null
      setMapInstance(null)
    }
  }, [geoReady, hasPoints, startLat, startLng])

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

    const latlngs = validLatLngs(
      railPath && railPath.length >= 2
        ? railPath
        : mapped.map((p) => [p.lat, p.lng] as LatLngTuple),
    )
    if (latlngs.length >= 2) {
      const lineOptions = {
        lineJoin: 'round' as const,
        lineCap: 'round' as const,
        interactive: false,
        smoothFactor: 0,
        pane: ROUTE_LINE_PANE,
      }
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
          : onPlatform ?? (placeOnTrack ? snapMarkerToPath(p, railPath) : p)
      const marker = L.circleMarker(
        [at.lat, at.lng],
        markerOptions(POINT_COLOR[p.kind], p.kind === 'stop' ? 7 : 5, ROUTE_MARKER_PANE),
      )
      const label = onPlatform && p.platform ? `${p.name} · Platform ${p.platform}` : p.name
      marker.bindTooltip(label, { direction: 'top', opacity: 0.95 })
      marker.addTo(group)
    }

    if (fittedKeyRef.current !== routeKey) {
      fittedKeyRef.current = routeKey
      window.requestAnimationFrame(() => {
        if (!mapStillMounted(mapInstanceRef.current, mapRef.current)) return
        fitJourneyBounds(mapInstanceRef.current, latlngs)
      })
    }
  }, [routeKey, railPath, mapped, routeColor, platformCoords])

  useEffect(() => {
    let raf = 0
    let lastTs = performance.now()
    let lastCaptionAt = 0
    const tick = (ts: number) => {
      raf = window.requestAnimationFrame(tick)
      const dt = Math.min(0.08, Math.max(0, (ts - lastTs) / 1000))
      lastTs = ts
      const marker = liveMarkerRef.current
      const { stops, mapped: pts, location, railPath: path } = liveInputRef.current
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
      if (ts - lastCaptionAt > 400) {
        lastCaptionAt = ts
        setLiveLabel(live.label)
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
    <div className="svc-journey-map">
      <div
        ref={mapRef}
        className="location-map-preview location-map-preview-osm svc-journey-map__canvas"
        aria-label="Service journey map"
      />
      <MapZoomControls map={mapInstance} />
      {liveLabel ? <p className="svc-journey-map__caption">{liveLabel}</p> : null}
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
