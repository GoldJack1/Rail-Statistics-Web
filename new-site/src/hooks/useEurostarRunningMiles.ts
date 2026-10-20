'use client'

import { useEffect, useMemo, useState } from 'react'

import type { ServiceStop } from '@/types/darwin'
import { routedCoordinates } from '@/utils/brouterRailRoute'
import {
  applyEurostarRailMiles,
  eurostarLegCoordinate,
  eurostarRailChains,
  isContinentalEurostarStop,
  metresAlongWaypoints,
  type LatLngTuple,
} from '@/utils/eurostarContinental'
import { isValidStationCoordinate } from '@/utils/stationCoordinates'

type LatLng = { lat: number; lng: number }

const tiplocCache = new Map<string, LatLng | null>()
const pathCache = new Map<string, number[]>()

function chainKey(stops: readonly ServiceStop[], chains: readonly (readonly number[])[]): string {
  return chains
    .map((chain) => chain.map((index) => {
      const stop = stops[index]
      return `${stop?.tpl || ''}:${stop?.name || ''}:${stop?.lat ?? ''}:${stop?.lng ?? ''}`
    }).join('>'))
    .join('|')
}

async function lookupTiplocs(tiplocs: string[], signal: AbortSignal): Promise<void> {
  const missing = tiplocs.filter((tip) => tip && !tiplocCache.has(tip))
  if (!missing.length) return
  const response = await fetch(`/api/tiploc-coords?tpl=${encodeURIComponent(missing.join('|'))}`, { signal })
  if (!response.ok) {
    for (const tip of missing) tiplocCache.set(tip, null)
    return
  }
  const payload = (await response.json()) as { coords?: Record<string, [number, number]> }
  for (const tip of missing) {
    const hit = payload.coords?.[tip]
    tiplocCache.set(
      tip,
      hit && isValidStationCoordinate(hit[0], hit[1]) ? { lat: hit[0], lng: hit[1] } : null,
    )
  }
}

async function cumulativeMetres(points: LatLng[], signal: AbortSignal): Promise<number[] | null> {
  if (points.length < 2) return null
  const key = points.map((point) => `${point.lat.toFixed(5)},${point.lng.toFixed(5)}`).join('|')
  const cached = pathCache.get(key)
  if (cached) return cached
  const params = new URLSearchParams({
    fromLat: String(points[0].lat),
    fromLng: String(points[0].lng),
    toLat: String(points[points.length - 1].lat),
    toLng: String(points[points.length - 1].lng),
  })
  if (points.length > 2) {
    params.set('via', points.slice(1, -1).map((point) => `${point.lat},${point.lng}`).join('|'))
  }
  const response = await fetch(`/api/rail-route?${params.toString()}`, { signal })
  if (!response.ok) return null
  const path = routedCoordinates(await response.json())
  if (!path) return null
  const waypoints: LatLngTuple[] = points.map((point) => [point.lat, point.lng])
  const cumulative = metresAlongWaypoints(path, waypoints)
  if (!cumulative) return null
  pathCache.set(key, cumulative)
  return cumulative
}

/**
 * Replace continental published miles with the length of the rail path.
 * UK calling points keep the track miles already on the stop.
 */
export function useEurostarRunningMiles(stops: ServiceStop[], enabled: boolean): ServiceStop[] {
  const active = enabled && stops.some((stop) => isContinentalEurostarStop(stop))
  const chains = useMemo(() => (active ? eurostarRailChains(stops) : []), [active, stops])
  const key = useMemo(() => (active ? chainKey(stops, chains) : ''), [active, stops, chains])
  const [legMetres, setLegMetres] = useState<Record<string, number>>({})
  const [readyKey, setReadyKey] = useState('')

  useEffect(() => {
    if (!active || !key) return
    const controller = new AbortController()
    let cancelled = false
    const tips = new Set<string>()
    for (const chain of chains) {
      for (const index of chain) {
        const stop = stops[index]
        if (!stop || isContinentalEurostarStop(stop)) continue
        const tip = String(stop.tpl || '').trim().toUpperCase()
        if (tip) tips.add(tip)
      }
    }
    void lookupTiplocs([...tips], controller.signal)
      .then(async () => {
        const next: Record<string, number> = {}
        for (const chain of chains) {
          const points: LatLng[] = []
          for (const index of chain) {
            const stop = stops[index]
            const tip = String(stop?.tpl || '').trim().toUpperCase()
            const place = stop ? eurostarLegCoordinate(stop, tip ? tiplocCache.get(tip) : null) : null
            if (!place) return
            points.push(place)
          }
          const cumulative = await cumulativeMetres(points, controller.signal)
          if (!cumulative) return
          for (let i = 1; i < chain.length; i++) {
            const from = cumulative[i - 1]
            const to = cumulative[i]
            if (from == null || to == null || to < from) return
            next[`${chain[i - 1]}:${chain[i]}`] = to - from
          }
        }
        if (!cancelled) {
          setLegMetres(next)
          setReadyKey(key)
        }
      })
      .catch((error: unknown) => {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        if (!cancelled) {
          setLegMetres({})
          setReadyKey(key)
        }
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [active, chains, key, stops])

  return useMemo(() => {
    if (!active) return stops
    return applyEurostarRailMiles(stops, readyKey === key ? legMetres : {})
  }, [active, key, legMetres, readyKey, stops])
}
