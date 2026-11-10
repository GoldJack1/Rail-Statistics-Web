'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { railwayDaySecondsFromClock } from '../../../utils/railwayOperatingDayUk'
import { platformSitsAtStation } from '../../../utils/platformPosition'
import { resolveDarwinBrowserUrl } from '../../../utils/darwinReadyFetch'
import { isValidStationCoordinate } from '../../../utils/stationCoordinates'
import {
  applyPlatformRules,
  BUILTIN_PLATFORM_RULES,
  type PlatformRule,
  journeyMapStops,
  liveJourneyPosition,
  mappedRouteWaypoints,
  pointsOnTheLeg,
  tiplocsNeedingCoordinates,
  type RoutePlatform,
} from '../../../utils/serviceJourneyMap'
import { useTocOperators } from '../../../hooks/useTocOperators'
import { resolveTocRouteColor } from '../../../utils/tocOperatorMap'
import type { ServiceDetail, ServiceStop } from '../../../types/darwin'
import type { Station } from '../../../types'
import { mapLocationBanner, portionBannerTitle, type MapLocationBanner } from './mapLocationBanner'
import { loadGbRailGraph } from '../../../utils/tracksGraphLoad'
import { ServiceTracksMap, type BranchTrack } from './ServiceTracksMap'
import type { ServiceViewMode } from '../serviceViewMode'
import '@/components/darwin/callingPatternTones.css'
import './ServiceJourneyMap.css'

if (typeof window !== 'undefined') void loadGbRailGraph()

const tiplocCoordCache = new Map<string, { lat: number; lng: number } | null>()

const NO_PLATFORMS: Record<string, RoutePlatform> = {}
const NO_ROADS: Record<string, Record<string, RoutePlatform>> = {}

/** The query server's list wins where it has the same rule. A rule only in the site copy still applies. */
function mergePlatformRules(remote: PlatformRule[] | null): PlatformRule[] {
  if (!remote) return BUILTIN_PLATFORM_RULES
  const known = new Set(remote.map((rule) => rule.id).filter((id): id is string => Boolean(id)))
  return [
    ...remote,
    ...BUILTIN_PLATFORM_RULES.filter((rule): rule is PlatformRule & { id: string } =>
      typeof rule.id === 'string' && !known.has(rule.id),
    ),
  ]
}

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

/** Matches the 40 stops `/api/platforms` reads per request. */
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
  extraStops = [],
  branches = [],
  onNominatimUsed,
  viewMode = 'detailed',
  routeMode = 'rail',
}: {
  service: ServiceDetail
  stations: Station[]
  extraStops?: ServiceStop[][]
  /** Other portions of a split, each with its own live position. */
  branches?: ServiceDetail[]
  /** A station coordinate was filled in from Nominatim. */
  onNominatimUsed?: () => void
  viewMode?: ServiceViewMode
  routeMode?: 'ours' | 'rail'
}) {
  const [banners, setBanners] = useState<MapLocationBanner[]>([])
  const [extraCoords, setExtraCoords] = useState<Record<string, { lat: number; lng: number }>>({})
  const [platformCoords, setPlatformCoords] = useState<Record<string, RoutePlatform>>({})
  const [platformQueryReady, setPlatformQueryReady] = useState<string | null>(null)
  const [geoReady, setGeoReady] = useState(false)
  const nominatimTriedRef = useRef<string | null>(null)
  const bannerKeyRef = useRef('')
  const liveInputRef = useRef({
    self: {
      title: '',
      stops: service.stops || [],
      mapped: [] as ReturnType<typeof journeyMapStops>,
      location: service.location,
      cancelled: service.cancelled,
    },
    others: [] as Array<{
      title: string
      stops: ServiceStop[]
      mapped: ReturnType<typeof journeyMapStops>
      location: ServiceDetail['location']
      cancelled: boolean
    }>,
  })
  const shellRef = useRef<HTMLDivElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [immersive, setImmersive] = useState(false)
  const { operators } = useTocOperators()
  const routeColor = useMemo(
    () => resolveTocRouteColor(operators, service.toc, service.tocName),
    [operators, service.toc, service.tocName],
  )
  const neededKey = useMemo(
    () => tiplocsNeedingCoordinates(
      [...(service.stops || []), ...extraStops.flat(), ...branches.flatMap((branch) => branch.stops || [])],
      stations,
    ).join('|'),
    [service.stops, stations, extraStops, branches],
  )

  const [platformRules, setPlatformRules] = useState<PlatformRule[] | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(resolveDarwinBrowserUrl('/api/darwin/platform-rules'), { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { rules?: PlatformRule[] } | null) => {
        if (Array.isArray(body?.rules)) setPlatformRules(body.rules)
      })
      .catch(() => undefined)
    return () => controller.abort()
  }, [])
  const mapped = useMemo(
    () => applyPlatformRules(
      pointsOnTheLeg(
        journeyMapStops(service.stops || [], stations, extraCoords),
        (point) => !point.calling && !String(point.crs || '').trim(),
      ),
      service.toc,
      mergePlatformRules(platformRules),
    ),
    [service.stops, service.toc, stations, extraCoords, platformRules],
  )
  const platformQuery = useMemo(
    () =>
      mapped
        .filter((point) => point.kind !== 'junction' && (point.platform || point.kind === 'pass'))
        .map((point) => {
          const place = `${point.lat.toFixed(5)}~${point.lng.toFixed(5)}`
          if (point.platform) return `${point.index}~${place}~${encodeURIComponent(point.platform)}`
          return `roads${point.index}~${place}~*`
        })
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
  const platformRoads = useMemo(() => {
    if (platformQueryReady !== platformQuery) return NO_ROADS
    const roads: Record<string, Record<string, RoutePlatform>> = {}
    for (const [id, place] of Object.entries(platformCoords)) {
      const match = /^roads(\d+)~(.+)$/.exec(id)
      if (!match) continue
      const stop = mapped.find((point) => String(point.index) === match[1])
      if (!stop || !platformSitsAtStation(stop, place)) continue
      const at = roads[match[1]] ?? {}
      at[match[2]] = place
      roads[match[1]] = at
    }
    return roads
  }, [mapped, platformCoords, platformQuery, platformQueryReady])
  const extraRoutes = useMemo(
    () => extraStops
      .map((stops) => pointsOnTheLeg(
        journeyMapStops(stops, stations, extraCoords),
        (point) => !point.calling && !String(point.crs || '').trim(),
      ))
      .filter((points) => points.length >= 2),
    [extraStops, stations, extraCoords],
  )
  const extraMapped = useMemo(() => extraRoutes.flat(), [extraRoutes])
  const waypoints = useMemo(
    () => mappedRouteWaypoints(mapped, activePlatforms),
    [mapped, activePlatforms],
  )
  const extraWaypoints = useMemo(
    () => extraRoutes.map((points) => mappedRouteWaypoints(points)),
    [extraRoutes],
  )
  const branchTracks = useMemo<BranchTrack[]>(
    () => branches.flatMap((branch) => {
      const points = pointsOnTheLeg(
        journeyMapStops(branch.stops || [], stations, extraCoords),
        (point) => !point.calling && !String(point.crs || '').trim(),
      )
      if (points.length < 2) return []
      return [{
        rid: branch.rid,
        trainId: branch.trainId,
        stops: branch.stops || [],
        mapped: points,
        waypoints: mappedRouteWaypoints(points),
        location: branch.location,
      }]
    }),
    [branches, stations, extraCoords],
  )

  const missingStop = useMemo(() => {
    const placed = new Set(mapped.map((stop) => stop.index))
    return (service.stops || []).find((stop, index) => !placed.has(index) && stop.name && stop.tpl) ?? null
  }, [mapped, service.stops])

  useEffect(() => {
    liveInputRef.current = {
      self: {
        title: portionBannerTitle(service.trainId, service.stops || []),
        stops: service.stops || [],
        mapped,
        location: service.location,
        cancelled: service.cancelled,
      },
      others: branchTracks.flatMap((track) => {
        const branch = branches.find((svc) => svc.rid === track.rid)
        if (!branch) return []
        return [{
          title: portionBannerTitle(branch.trainId, branch.stops || []),
          stops: track.stops,
          mapped: track.mapped,
          location: track.location,
          cancelled: branch.cancelled,
        }]
      }),
    }
  }, [service, mapped, branchTracks, branches])

  useEffect(() => {
    if (!neededKey) {
      setExtraCoords({})
      setGeoReady(true)
      return
    }
    const controller = new AbortController()
    let cancelled = false
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
    const merged: Record<string, RoutePlatform> = {}
    const queue = [...chunks]
    const worker = async () => {
      while (queue.length > 0 && !cancelled) {
        const chunk = queue.shift()
        if (!chunk) return
        try {
          const response = await fetch(resolveDarwinBrowserUrl(`/api/darwin/platforms?at=${encodeURIComponent(chunk)}`), {
            signal: controller.signal,
          })
          if (!response.ok || cancelled) continue
          const payload = (await response.json()) as { coords?: Record<string, unknown> }
          for (const [id, value] of Object.entries(payload.coords || {})) {
            const place = readPlatformPlacement(value)
            if (place) merged[id] = place
          }
          if (!cancelled) {
            setPlatformCoords({ ...merged })
            setPlatformQueryReady(platformQuery)
          }
        } catch (error: unknown) {
          if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        }
      }
    }
    void Promise.all(Array.from({ length: Math.min(3, chunks.length) }, () => worker())).then(() => {
      if (cancelled) return
      setPlatformCoords({ ...merged })
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
      const { self, others } = liveInputRef.current
      const rows = [self, ...others]
      const now = londonNowRailwaySeconds()
      const next = rows.flatMap((row) => {
        if (!row.mapped.length) return []
        const raw = liveJourneyPosition(row.stops, row.mapped, row.location, now)
        const banner = mapLocationBanner(row.stops, raw, { cancelled: row.cancelled })
        if (!banner) return []
        return [{ ...banner, title: rows.length > 1 ? row.title : undefined }]
      })
      const key = next.map((banner) => `${banner.title || ''}|${banner.tone}|${banner.text}`).join('\n')
      if (key !== bannerKeyRef.current) {
        bannerKeyRef.current = key
        setBanners(next)
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
        onNominatimUsed?.()
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

  if (!geoReady && mapped.length < 1) {
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
      {banners.length ? (
        <div className="svc-journey-map__wheres">
          {banners.map((banner) => (
            <p
              key={banner.title || banner.text}
              className={`svc-journey-map__where svc-journey-map__where--${banner.tone}`}
              role="status"
            >
              {banner.title ? <span className="svc-journey-map__where-route">{banner.title}</span> : null}
              <span>{banner.text}</span>
            </p>
          ))}
        </div>
      ) : null}
      <div className="svc-journey-map__stage">
        <ServiceTracksMap
          waypoints={waypoints}
          extraWaypoints={extraWaypoints}
          branches={branchTracks}
          trainId={service.trainId}
          mapped={mapped}
          extraMapped={extraMapped}
          stops={service.stops}
          location={service.location}
          platforms={activePlatforms}
          platformRoads={platformRoads}
          routeColor={routeColor}
          fullscreen={expanded}
          onToggleFullscreen={toggleFullscreen}
          callsOnly={viewMode === 'simple'}
          routeMode={routeMode}
        />
      </div>
    </div>
  )
}
