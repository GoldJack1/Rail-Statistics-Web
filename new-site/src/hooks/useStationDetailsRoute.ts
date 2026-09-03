'use client'

import { useMemo } from 'react'
import { useStationCollection } from '@/contexts/StationCollectionContext'
import { useStations } from '@/hooks/useStations'
import {
  getCollectionError,
  getCollectionStations,
  isAnyNetworkCollectionLoading,
  isCollectionLoading,
  isStationsInitialSyncPending,
} from '@/services/stationsDataService'
import type { Station } from '@/types'
import {
  findStationByRoute,
  getCollectionIdFromNetworkUrlSlug,
} from '@/utils/stationAreaSlug'

/**
 * Resolves a station detail route without the list-page deferred stations lag,
 * and keeps "not found" gated until the route's network collection has settled.
 */
export function useStationDetailsRoute(network: string, stationSlug: string) {
  const { collectionId } = useStationCollection()
  // Detail lookup must not use deferred stations — that briefly looks like "not found".
  const { stations, loading, error, refetch } = useStations({ defer: false })
  const routeCollectionId = getCollectionIdFromNetworkUrlSlug(network)

  const station: Station | null = useMemo(() => {
    if (!network || !stationSlug) return null
    return findStationByRoute(stations, network, stationSlug, collectionId)
  }, [stations, network, stationSlug, collectionId])

  const routeStillSettling = useMemo(() => {
    if (station) return false
    if (!network || !stationSlug) return false

    if (routeCollectionId) {
      if (isCollectionLoading(routeCollectionId)) return true
      const hasRows =
        getCollectionStations(routeCollectionId, 'list').length > 0 ||
        getCollectionStations(routeCollectionId, 'lean').length > 0 ||
        getCollectionStations(routeCollectionId, 'full').length > 0
      if (hasRows) return false
      // Empty collection: wait while anything is still loading, unless this route failed.
      if (getCollectionError(routeCollectionId)) return false
      return (
        loading ||
        isStationsInitialSyncPending() ||
        isAnyNetworkCollectionLoading()
      )
    }

    return loading || isStationsInitialSyncPending() || isAnyNetworkCollectionLoading()
  }, [station, network, stationSlug, loading, routeCollectionId, stations])

  return {
    station,
    stations,
    loading: loading || routeStillSettling,
    error,
    routeCollectionId,
    refetch,
  }
}
