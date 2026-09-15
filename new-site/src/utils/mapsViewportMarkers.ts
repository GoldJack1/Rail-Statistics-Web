import type { NetworkViewFilter } from '@/constants/stationCollections'
import { getStationMapKey } from '@/utils/stationAreaSlug'
import {
  FULL_MAP_VIEWPORT_MAX_MARKERS,
  LITE_MAP_MAX_MARKERS,
  MAP_VIEWPORT_CULL_MIN_STATIONS,
} from '@/utils/deviceCapability'
import type { Station } from '@/types'

export type MapViewportBounds = {
  contains(latlng: [number, number]): boolean
  pad(bufferRatio: number): MapViewportBounds
}

/** Soft edge so markers aren't created/destroyed on every tiny pan. */
export const MAP_VIEWPORT_CULL_PAD = 0.2

export function shouldCullStationsMapMarkers(
  stationCount: number,
  networkView: NetworkViewFilter | string,
  liteMode: boolean
): boolean {
  if (liteMode) return true
  if (networkView === 'all') return true
  return stationCount >= MAP_VIEWPORT_CULL_MIN_STATIONS
}

export function getMapViewportMarkerLimit(liteMode: boolean): number {
  return liteMode ? LITE_MAP_MAX_MARKERS : FULL_MAP_VIEWPORT_MAX_MARKERS
}

/**
 * Stations to draw for the current camera. Always keeps the selected pin when set.
 * Caps count so dense networks (especially All) stay interactive.
 */
export function getStationsForViewportMarkers(
  stations: Station[],
  bounds: MapViewportBounds,
  options: {
    selectedStationId: string | null
    keepStationIds?: ReadonlyArray<string | null | undefined>
    maxMarkers: number
    pad?: number
  }
): Station[] {
  const pad = options.pad ?? MAP_VIEWPORT_CULL_PAD
  const queryBounds = pad > 0 ? bounds.pad(pad) : bounds
  const inView = stations.filter((station) =>
    queryBounds.contains([station.latitude, station.longitude])
  )

  const keepIds = [
    options.selectedStationId,
    ...(options.keepStationIds ?? []),
  ].filter((id): id is string => Boolean(id))

  for (const keepId of keepIds) {
    const keep = stations.find((station) => getStationMapKey(station) === keepId)
    if (keep && !inView.some((station) => getStationMapKey(station) === keepId)) {
      inView.unshift(keep)
    }
  }

  if (inView.length <= options.maxMarkers) return inView
  return inView.slice(0, options.maxMarkers)
}
