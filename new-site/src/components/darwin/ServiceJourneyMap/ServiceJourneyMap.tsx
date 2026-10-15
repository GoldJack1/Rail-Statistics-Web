'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import '../../maps/leafletDarkTiles.css'
import { MapZoomControls } from '../../maps/MapZoomControls'
import { useTheme, readThemeFromDocument } from '../../../hooks/useTheme'
import { addThemeTileLayersToMap, swapThemeTileLayers, type MapTileLayerRefs } from '../../../utils/mapTileLayers'
import { railwayDaySecondsFromClock } from '../../../utils/railwayOperatingDayUk'
import type { LatLngTuple } from '../../../utils/brouterRailRoute'
import { isValidStationCoordinate } from '../../../utils/stationCoordinates'
import {
  journeyMapStops,
  liveJourneyPosition,
  mappedRouteWaypoints,
  snapLiveToRailPath,
} from '../../../utils/serviceJourneyMap'
import type { ServiceDetail } from '../../../types/darwin'
import type { Station } from '../../../types'
import './ServiceJourneyMap.css'

const CALLING_MARKER: L.CircleMarkerOptions = {
  radius: 7,
  fillColor: '#2563eb',
  color: '#fff',
  weight: 2,
  fillOpacity: 0.95,
}

const PASS_MARKER: L.CircleMarkerOptions = {
  radius: 4,
  fillColor: '#64748b',
  color: '#fff',
  weight: 1.5,
  fillOpacity: 0.85,
}

const LIVE_MARKER: L.CircleMarkerOptions = {
  radius: 11,
  fillColor: '#ea580c',
  color: '#fff',
  weight: 3,
  fillOpacity: 1,
}

const ROUTE_CHUNK = 10

async function fetchOneRailRoute(points: LatLngTuple[], signal: AbortSignal): Promise<LatLngTuple[] | null> {
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
  const payload = (await response.json()) as { coordinates?: LatLngTuple[] }
  if (!payload.coordinates || payload.coordinates.length < 2) return null
  return payload.coordinates
}

async function fetchRailRouteAlongTrack(points: LatLngTuple[], signal: AbortSignal): Promise<LatLngTuple[]> {
  if (points.length < 2) return points
  const chunks: LatLngTuple[][] = []
  for (let i = 0; i < points.length - 1; i += ROUTE_CHUNK - 1) {
    const slice = points.slice(i, i + ROUTE_CHUNK)
    if (slice.length < 2) break
    chunks.push(slice)
  }
  const parts = await Promise.all(chunks.map((chunk) => fetchOneRailRoute(chunk, signal)))
  const joined: LatLngTuple[] = []
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] || chunks[i]
    if (!part?.length) continue
    const start = joined.length && i > 0 ? 1 : 0
    for (let j = start; j < part.length; j++) joined.push(part[j])
  }
  return joined.length >= 2 ? joined : points
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

function validLatLngs(points: LatLngTuple[]): L.LatLngTuple[] {
  return points.filter((p) => Array.isArray(p) && p.length >= 2 && isValidStationCoordinate(p[0], p[1]))
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
  const { theme } = useTheme()
  const themeKey = theme === 'dark' ? 'dark' : 'light'

  const mapped = useMemo(() => journeyMapStops(service.stops || [], stations), [service.stops, stations])
  const routeKey = useMemo(
    () => mapped.map((p) => `${p.tpl}:${p.lat.toFixed(5)}:${p.lng.toFixed(5)}`).join('|'),
    [mapped],
  )
  const waypoints = useMemo(() => mappedRouteWaypoints(mapped), [mapped])
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
    if (waypoints.length < 2) return
    const controller = new AbortController()
    let cancelled = false
    void fetchRailRouteAlongTrack(waypoints, controller.signal)
      .then((path) => {
        if (!cancelled) setTrackPath(path)
      })
      .catch(() => {
        if (!cancelled) setTrackPath(waypoints)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [routeKey, waypoints])

  useEffect(() => {
    if (!mapRef.current || !hasPoints || startLat == null || startLng == null) return
    const map = L.map(mapRef.current, { zoomControl: false, scrollWheelZoom: true }).setView(
      [startLat, startLng],
      7,
    )
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
  }, [hasPoints, startLat, startLng])

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
      L.polyline(latlngs, {
        color: '#2563eb',
        weight: 5,
        opacity: 0.72,
        lineJoin: 'round',
        lineCap: 'round',
      }).addTo(group)
    }

    for (const p of mapped) {
      if (!isValidStationCoordinate(p.lat, p.lng)) continue
      const marker = L.circleMarker([p.lat, p.lng], p.calling ? CALLING_MARKER : PASS_MARKER)
      marker.bindTooltip(p.name, { direction: 'top', opacity: 0.95 })
      marker.addTo(group)
    }

    if (fittedKeyRef.current !== routeKey) {
      fittedKeyRef.current = routeKey
      window.requestAnimationFrame(() => {
        if (!mapStillMounted(mapInstanceRef.current, mapRef.current)) return
        fitJourneyBounds(mapInstanceRef.current, latlngs)
      })
    }
  }, [routeKey, railPath, mapped])

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
  }, [hasPoints])

  if (mapped.length < 1) {
    return (
      <p className="edit-hint kb-source-hint">
        No mapped stations yet for this working. Station coordinates load from the stations catalogue.
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
        .
      </p>
    </div>
  )
}
