'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTheme } from '../../../hooks/useTheme'
import { railwayDaySecondsFromClock } from '../../../utils/railwayOperatingDayUk'
import { platformSitsAtStation } from '../../../utils/platformPosition'
import { isValidStationCoordinate } from '../../../utils/stationCoordinates'
import {
  journeyMapStops,
  liveJourneyPosition,
  mappedRouteWaypoints,
  pointsOnTheLeg,
  tiplocsNeedingCoordinates,
  type RoutePlatform,
} from '../../../utils/serviceJourneyMap'
import { useTocOperators } from '../../../hooks/useTocOperators'
import { resolveTocRouteColor } from '../../../utils/tocOperatorMap'
import type { ServiceDetail } from '../../../types/darwin'
import type { Station } from '../../../types'
import { mapLocationBanner, type MapLocationBanner } from './mapLocationBanner'
import { ServiceTracksMap } from './ServiceTracksMap'
import { JOERD_TERRAIN_CREDIT, TRACKS_RELIEF } from '../../../utils/tracksCredits'
import '@/components/darwin/callingPatternTones.css'
import './ServiceJourneyMap.css'

const tiplocCoordCache = new Map<string, { lat: number; lng: number } | null>()

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

export function ServiceJourneyMap({
  service,
  stations,
}: {
  service: ServiceDetail
  stations: Station[]
}) {
  const [banner, setBanner] = useState<MapLocationBanner | null>(null)
  const [extraCoords, setExtraCoords] = useState<Record<string, { lat: number; lng: number }>>({})
  const [platformCoords, setPlatformCoords] = useState<Record<string, RoutePlatform>>({})
  const [platformQueryReady, setPlatformQueryReady] = useState<string | null>(null)
  const [geoReady, setGeoReady] = useState(false)
  const [nominatimUsed, setNominatimUsed] = useState(false)
  const nominatimTriedRef = useRef<string | null>(null)
  const bannerKeyRef = useRef('')
  const liveInputRef = useRef({
    stops: service.stops,
    mapped: [] as ReturnType<typeof journeyMapStops>,
    location: service.location,
    cancelled: service.cancelled,
  })
  const shellRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [immersive, setImmersive] = useState(false)
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
    () => pointsOnTheLeg(
      journeyMapStops(service.stops || [], stations, extraCoords),
      (point) => !point.calling && !String(point.crs || '').trim(),
    ),
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
  const waypoints = useMemo(
    () => mappedRouteWaypoints(mapped, activePlatforms),
    [mapped, activePlatforms],
  )

  const missingStop = useMemo(() => {
    const placed = new Set(mapped.map((stop) => stop.index))
    return (service.stops || []).find((stop, index) => !placed.has(index) && stop.name && stop.tpl) ?? null
  }, [mapped, service.stops])

  useEffect(() => {
    liveInputRef.current = {
      stops: service.stops,
      mapped,
      location: service.location,
      cancelled: service.cancelled,
    }
  }, [service.stops, mapped, service.location, service.cancelled])

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
    let raf = 0
    let lastCaptionAt = 0
    const tick = (ts: number) => {
      raf = window.requestAnimationFrame(tick)
      if (ts - lastCaptionAt < 400) return
      lastCaptionAt = ts
      const { stops, mapped: pts, location, cancelled } = liveInputRef.current
      if (!pts.length) return
      const raw = liveJourneyPosition(stops || [], pts, location, londonNowRailwaySeconds())
      const next = mapLocationBanner(stops || [], raw, { cancelled })
      const key = next ? `${next.tone}|${next.text}` : ''
      if (key !== bannerKeyRef.current) {
        bannerKeyRef.current = key
        setBanner(next)
      }
    }
    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [])

  useEffect(() => {
    const shell = shellRef.current
    if (!shell) return
    const sync = () => setFullscreen(document.fullscreenElement === shell)
    document.addEventListener('fullscreenchange', sync)
    document.addEventListener('webkitfullscreenchange', sync)
    return () => {
      document.removeEventListener('fullscreenchange', sync)
      document.removeEventListener('webkitfullscreenchange', sync)
    }
  }, [geoReady])

  useEffect(() => {
    document.documentElement.classList.toggle('svc-map-immersive', immersive)
    return () => document.documentElement.classList.remove('svc-map-immersive')
  }, [immersive])

  const missingName = missingStop?.name?.trim() ?? ''
  const missingKey = missingStop && missingName ? `${missingStop.tpl.trim().toUpperCase()}|${missingName}` : ''

  useEffect(() => {
    if (!geoReady || !missingKey) return
    const [tpl, name] = missingKey.split('|')
    if (!tpl || !name || nominatimTriedRef.current === tpl) return
    nominatimTriedRef.current = tpl
    const controller = new AbortController()
    let settled = false
    void fetch(`/api/nominatim-station?q=${encodeURIComponent(name)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return null
        return (await response.json()) as { lat?: number | null; lng?: number | null }
      })
      .then((body) => {
        settled = true
        if (!body || body.lat == null || body.lng == null) return
        setNominatimUsed(true)
        setExtraCoords((current) => ({ ...current, [tpl]: { lat: body.lat as number, lng: body.lng as number } }))
      })
      .catch(() => {
        /* One lookup. A miss leaves the stop off the map. */
      })
    return () => {
      controller.abort()
      if (!settled) nominatimTriedRef.current = ''
    }
  }, [geoReady, missingKey])

  const expanded = fullscreen || immersive

  const toggleFullscreen = () => {
    const shell = shellRef.current
    if (!shell) return
    if (document.fullscreenElement === shell || immersive) {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
      const webkitExit = (document as Document & { webkitExitFullscreen?: () => void }).webkitExitFullscreen
      webkitExit?.call(document)
      setImmersive(false)
      return
    }
    const webkitRequest = (shell as HTMLElement & { webkitRequestFullscreen?: () => void }).webkitRequestFullscreen
    let pending: Promise<void> | undefined = undefined
    try {
      if (typeof shell.requestFullscreen === 'function') pending = shell.requestFullscreen()
      else if (typeof webkitRequest === 'function') webkitRequest.call(shell)
      else {
        setImmersive(true)
        return
      }
    } catch {
      setImmersive(true)
      return
    }
    if (pending && typeof pending.then === 'function') {
      void pending.catch(() => setImmersive(true))
      return
    }
    window.setTimeout(() => {
      if (document.fullscreenElement !== shell) setImmersive(true)
    }, 80)
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
    <div className={immersive ? 'svc-journey-map svc-journey-map--immersive' : 'svc-journey-map'} ref={shellRef}>
      {banner ? (
        <p className={`svc-journey-map__where svc-journey-map__where--${banner.tone}`} role="status">
          {banner.text}
        </p>
      ) : null}
      <div className="svc-journey-map__stage">
        <ServiceTracksMap
          waypoints={waypoints}
          mapped={mapped}
          stops={service.stops}
          location={service.location}
          platforms={activePlatforms}
          routeColor={routeColor}
          theme={themeKey}
          fullscreen={expanded}
          onToggleFullscreen={toggleFullscreen}
        />
      </div>
      <p className="svc-journey-map__caption svc-journey-map__caption--licence">
        Map data ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
        , via{' '}
        <a href="https://protomaps.com/" target="_blank" rel="noreferrer">
          Protomaps
        </a>
        . Rail geometry ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
        . Stations from Rail Statistics
        {nominatimUsed ? (
          <>
            {' '}
            and{' '}
            <a href="https://nominatim.openstreetmap.org/" target="_blank" rel="noreferrer">
              Nominatim
            </a>
          </>
        ) : null}
        .
        {TRACKS_RELIEF ? ` ${JOERD_TERRAIN_CREDIT}` : null}
      </p>
    </div>
  )
}
