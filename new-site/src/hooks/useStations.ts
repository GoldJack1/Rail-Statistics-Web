import { useCallback, useEffect, useMemo, useState, useDeferredValue, useSyncExternalStore } from 'react'
import { useStationCollection } from '@/contexts/StationCollectionContext'
import {
  bootstrapStationsData,
  ensureMapStationDetailsLoaded,
  getCollectionError,
  getMergedNetworkStations,
  getMergedNetworkStationsForDisplay,
  getMergedNetworkStationDetails,
  invalidateStationsCache,
  isAnyNetworkCollectionLoading,
  isAnyNetworkCollectionRefreshing,
  isCollectionLoading,
  isCollectionRefreshing,
  isStationsInitialSyncPending,
  beginStationsInitialSync,
  endStationsInitialSync,
  loadAllNetworkStationsProgressive,
  resolveMapStationDetails,
  getStationsStoreRevision,
  subscribeStationsData,
} from '@/services/stationsDataService'
import type { Station, StationStats, UseStationsReturn } from '@/types'
import { buildFullStationIndex } from '@/utils/mapLeanStation'
import { isNetworkCollection } from '@/constants/stationCollections'

const SERVER_STATION_SNAPSHOT = {
  stations: [] as Station[],
  loading: true,
  isRefreshing: false,
  error: null as string | null,
  stats: {
    totalStations: 0,
    withCoordinates: 0,
    withTOC: 0,
    withPassengers: 0,
  } satisfies StationStats,
}

function buildStationsError(): string | null {
  for (const message of [
    getCollectionError('stations_gbnr'),
    getCollectionError('stations_nitranslink'),
    getCollectionError('stations_roiirerail'),
    getCollectionError('stations_gbheritage'),
    getCollectionError('lightrail_GBSHEFFSUPERTRAM'),
  ]) {
    if (message) return message
  }
  return null
}

export interface UseStationsMapReturn {
  stations: Station[]
  loading: boolean
  isRefreshing: boolean
  /** True while the active network's station set may still be growing. */
  stationsLoading: boolean
  error: string | null
  dataRevision: number
  refetch: () => void
  resolveStation: (station: Station) => Station
  loadStationDetails: (station: Station) => Promise<void>
}

export const useStations = (options?: { defer?: boolean }): UseStationsReturn => {
  const deferStations = options?.defer !== false
  const { networkView } = useStationCollection()
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  const revision = useSyncExternalStore(
    subscribeStationsData,
    getStationsStoreRevision,
    () => 0
  )

  const snapshot = useMemo(() => {
    if (!hydrated) return SERVER_STATION_SNAPSHOT
    const stations = getMergedNetworkStationsForDisplay()
    // Once IndexedDB (or network) has rows, clear the page skeleton even if
    // initial sync is still waiting on freshness/network for other collections.
    // Min-skeleton timing in the page UI covers the fast-cache flash case.
    const loading =
      stations.length === 0 &&
      (isStationsInitialSyncPending() || isAnyNetworkCollectionLoading())
    const isRefreshing = isAnyNetworkCollectionRefreshing()
    const error = stations.length === 0 ? buildStationsError() : null
    return { stations, loading, isRefreshing, error }
  }, [hydrated, revision])

  const deferredStations = useDeferredValue(snapshot.stations)
  // Stats are unused by the stations list UI; skip scanning thousands of rows on every update.
  const stats = SERVER_STATION_SNAPSHOT.stats
  const stations = deferStations ? deferredStations : snapshot.stations

  const refetch = useCallback(() => {
    invalidateStationsCache()
    beginStationsInitialSync()
    void bootstrapStationsData({ networkView, detailLevel: 'lean', force: true })
      .then(() => loadAllNetworkStationsProgressive({ detailLevel: 'list', force: true }))
      .then(() => loadAllNetworkStationsProgressive({ detailLevel: 'full', force: true }))
      .finally(() => endStationsInitialSync())
  }, [networkView])

  return useMemo(
    () => ({
      stations,
      loading: snapshot.loading,
      isRefreshing: snapshot.isRefreshing,
      error: snapshot.error,
      stats,
      refetch,
    }),
    [stations, snapshot.loading, snapshot.isRefreshing, snapshot.error, stats, refetch]
  )
}

export const useStationsMap = (): UseStationsMapReturn => {
  const { networkView } = useStationCollection()
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    setHydrated(true)
  }, [])

  const revision = useSyncExternalStore(
    subscribeStationsData,
    getStationsStoreRevision,
    () => 0
  )

  const snapshot = useMemo(() => {
    if (!hydrated) {
      return {
        stations: SERVER_STATION_SNAPSHOT.stations,
        fullById: new Map<string, Station>(),
        loading: true,
        isRefreshing: false,
        stationsLoading: true,
        error: null,
      }
    }
    // Prefer list rows so TOC/county/borough/province filters match the stations list.
    // Fall back to lean (fast first paint) then detail rows.
    const displayStations = getMergedNetworkStationsForDisplay()
    const leanStations = getMergedNetworkStations('lean')
    const fullStations = getMergedNetworkStationDetails()
    const stations =
      displayStations.length > 0
        ? displayStations
        : leanStations.length > 0
          ? leanStations
          : fullStations
    const loading =
      stations.length === 0 &&
      (isStationsInitialSyncPending() || isAnyNetworkCollectionLoading())
    const isRefreshing = isAnyNetworkCollectionRefreshing()
    const stationsLoading =
      (stations.length === 0 && isStationsInitialSyncPending()) ||
      (networkView === 'all'
        ? isAnyNetworkCollectionLoading() || isAnyNetworkCollectionRefreshing()
        : isNetworkCollection(networkView)
          ? isCollectionLoading(networkView) || isCollectionRefreshing(networkView)
          : isAnyNetworkCollectionLoading() || isAnyNetworkCollectionRefreshing())
    const error = stations.length === 0 ? buildStationsError() : null
    return {
      stations,
      fullById: buildFullStationIndex(fullStations),
      loading,
      isRefreshing,
      stationsLoading,
      error,
    }
  }, [hydrated, revision, networkView])

  const refetch = useCallback(() => {
    invalidateStationsCache()
    beginStationsInitialSync()
    void bootstrapStationsData({ networkView, detailLevel: 'lean', force: true })
      .then(() => loadAllNetworkStationsProgressive({ detailLevel: 'list', force: true }))
      .then(() => loadAllNetworkStationsProgressive({ detailLevel: 'full', force: true }))
      .finally(() => endStationsInitialSync())
  }, [networkView])

  const resolveStation = useCallback(
    (station: Station) => resolveMapStationDetails(station),
    [revision]
  )

  const loadStationDetails = useCallback(async (station: Station) => {
    await ensureMapStationDetailsLoaded(station)
  }, [])

  return useMemo(
    () => ({
      stations: snapshot.stations,
      loading: snapshot.loading,
      isRefreshing: snapshot.isRefreshing,
      stationsLoading: snapshot.stationsLoading,
      error: snapshot.error,
      dataRevision: revision,
      refetch,
      resolveStation,
      loadStationDetails,
    }),
    [snapshot, revision, refetch, resolveStation, loadStationDetails]
  )
}

export { SERVER_STATION_SNAPSHOT }
