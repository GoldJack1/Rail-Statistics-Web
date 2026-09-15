'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { MapPin } from '@phosphor-icons/react'

import StationsMapSelectedCardFloat from '@/components/maps/StationsMapSelectedCardFloat'
import { Skeleton } from '@/components/misc/Skeleton/Skeleton'
import { TextSkeletonLine } from '@/components/misc/Skeleton/TextSkeletonLine'
import { StationSectionTitle } from '@/components/models/StationDetails/StationSectionTitle'
import { useStationsMap } from '@/hooks/useStations'
import {
  beginStationsInitialSync,
  bootstrapStationsData,
  endStationsInitialSync,
  resolveMapStationDetails,
} from '@/services/stationsDataService'
import type { Station } from '@/types'
import type { DPAYGStation } from '@/types/dpayg'
import { straightLineBetween, type LatLngTuple } from '@/utils/brouterRailRoute'
import { paygStationLookupCrs, matchPaygStationsToDatabaseStations } from '@/utils/paygAreaMapStations'
import { getStationMapKey } from '@/utils/stationAreaSlug'
import { isValidStationCoordinate } from '@/utils/stationCoordinates'
import {
  isTfwSouthWalesPaygArea,
  planTfwSouthWalesValleyJourney,
} from '@/utils/tfwSouthWalesValleyMapRoutes'

const loadStationsOsmMap = () => import('@/components/maps/StationsOsmMap')

const StationsOsmMap = dynamic(loadStationsOsmMap, {
  ssr: false,
  loading: () => <PaygAreaMapSkeleton />,
})

const MAP_SKELETON_PINS = [
  { left: '18%', top: '28%' },
  { left: '34%', top: '46%' },
  { left: '48%', top: '38%' },
  { left: '61%', top: '57%' },
  { left: '72%', top: '33%' },
  { left: '27%', top: '68%' },
  { left: '79%', top: '62%' },
] as const

function PaygAreaMapSkeleton({ fading = false }: { fading?: boolean }) {
  return (
    <div
      className={[
        'tickets-area-map__loading',
        'stations-osm-map',
        'stations-osm-map--loading',
        fading ? 'tickets-area-map__loading--fading' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-busy="true"
      aria-label="Loading map"
    >
      {MAP_SKELETON_PINS.map((pin) => (
        <Skeleton
          key={`${pin.left}-${pin.top}`}
          className="tickets-area-map__skeleton-pin skeleton--circle"
          style={pin}
        />
      ))}
    </div>
  )
}

type PaygAreaStationsMapProps = {
  paygStations: DPAYGStation[]
  areaName: string
  areaId?: string | null
  origin?: DPAYGStation | null
  dest?: DPAYGStation | null
  searched?: boolean
}

function stationForPaygStop(mapped: Station[], stop: DPAYGStation | null | undefined): Station | null {
  const crs = stop ? paygStationLookupCrs(stop) : null
  if (!crs) return null
  return mapped.find((station) => station.crsCode.trim().toUpperCase() === crs) ?? null
}

function coordsByCrs(dbStations: Station[]): Map<string, LatLngTuple> {
  const coords = new Map<string, LatLngTuple>()
  for (const station of dbStations) {
    const crs = station.crsCode?.trim().toUpperCase()
    if (!crs || !isValidStationCoordinate(station.latitude, station.longitude)) continue
    if (!coords.has(crs) || station.sourceCollectionId === 'stations_gbnr') {
      coords.set(crs, [station.latitude, station.longitude])
    }
  }
  return coords
}

function pointsForCrsRoute(route: string[], coords: Map<string, LatLngTuple>): LatLngTuple[] {
  const points: LatLngTuple[] = []
  for (const crs of route) {
    const point = coords.get(crs)
    if (!point) continue
    const previous = points[points.length - 1]
    if (previous && previous[0] === point[0] && previous[1] === point[1]) continue
    points.push(point)
  }
  return points
}

async function fetchRailRoute(
  points: LatLngTuple[],
  signal: AbortSignal
): Promise<LatLngTuple[] | null> {
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
  if (!response.ok) return straightLineBetween(from, to)
  const payload = (await response.json()) as { coordinates?: LatLngTuple[] }
  if (!payload.coordinates || payload.coordinates.length < 2) return straightLineBetween(from, to)
  return payload.coordinates
}

export function PaygAreaStationsMap({
  paygStations,
  areaName,
  areaId = null,
  origin = null,
  dest = null,
  searched = false,
}: PaygAreaStationsMapProps) {
  const { stations, loading, stationsLoading, resolveStation, loadStationDetails } = useStationsMap()
  const [selectedStation, setSelectedStation] = useState<Station | null>(null)
  const [detailsLoading, setDetailsLoading] = useState(false)
  const [fitNonce, setFitNonce] = useState(0)
  const [journeyPaths, setJourneyPaths] = useState<LatLngTuple[][] | null>(null)
  const [journeyResolved, setJourneyResolved] = useState(false)
  const [viewportReady, setViewportReady] = useState(false)
  const [mapMounted, setMapMounted] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(true)

  useEffect(() => {
    beginStationsInitialSync()
    void bootstrapStationsData({
      networkView: 'stations_gbnr',
      detailLevel: 'list',
    }).finally(() => endStationsInitialSync())
  }, [])

  const mapStations = useMemo(
    () => matchPaygStationsToDatabaseStations(paygStations, stations),
    [paygStations, stations]
  )

  const originStation = useMemo(
    () => (searched ? stationForPaygStop(mapStations, origin) : null),
    [mapStations, origin, searched]
  )
  const destStation = useMemo(
    () => (searched ? stationForPaygStop(mapStations, dest) : null),
    [mapStations, dest, searched]
  )

  const valleyPlan = useMemo(() => {
    if (!searched || !isTfwSouthWalesPaygArea(areaId)) return null
    const originCrs = origin ? paygStationLookupCrs(origin) : null
    const destCrs = dest ? paygStationLookupCrs(dest) : null
    if (!originCrs || !destCrs) return null
    return planTfwSouthWalesValleyJourney(originCrs, destCrs)
  }, [areaId, dest, origin, searched])

  const highlightedStationIds = useMemo(() => {
    const ids: string[] = []
    if (originStation) ids.push(getStationMapKey(originStation))
    if (destStation) ids.push(getStationMapKey(destStation))
    return ids
  }, [destStation, originStation])

  const areaKey = useMemo(
    () => mapStations.map((station) => getStationMapKey(station)).join('|'),
    [mapStations]
  )
  const originKey = originStation ? getStationMapKey(originStation) : null
  const destKey = destStation ? getStationMapKey(destStation) : null
  const waitingForStations = (loading || stationsLoading) && stations.length === 0
  const stationsRef = useRef(stations)
  stationsRef.current = stations

  useEffect(() => {
    if (!areaKey) return
    setFitNonce((value) => value + 1)
  }, [areaKey])

  useEffect(() => {
    if (waitingForStations) {
      setJourneyPaths(null)
      setJourneyResolved(false)
      return
    }
    if (!originStation || !destStation || !originKey || !destKey) {
      setJourneyPaths(null)
      setJourneyResolved(true)
      return
    }
    if (originKey === destKey) {
      setJourneyPaths(null)
      setJourneyResolved(true)
      return
    }

    const from: LatLngTuple = [originStation.latitude, originStation.longitude]
    const to: LatLngTuple = [destStation.latitude, destStation.longitude]
    const fallback = [straightLineBetween(from, to)]
    const controller = new AbortController()
    setJourneyPaths(null)
    setJourneyResolved(false)

    const coords = coordsByCrs(stationsRef.current)
    const routes = valleyPlan
      ? valleyPlan.routes.map((route) => pointsForCrsRoute(route, coords)).filter((points) => points.length >= 2)
      : [[from, to]]

    void Promise.all(routes.map((points) => fetchRailRoute(points, controller.signal)))
      .then((paths) => {
        if (controller.signal.aborted) return
        const resolved = paths.filter((path): path is LatLngTuple[] => Boolean(path && path.length >= 2))
        setJourneyPaths(resolved.length > 0 ? resolved : fallback)
        setJourneyResolved(true)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setJourneyPaths(fallback)
        setJourneyResolved(true)
      })

    return () => controller.abort()
  }, [destKey, destStation, originKey, originStation, valleyPlan, waitingForStations])

  useEffect(() => {
    if (!journeyPaths || journeyPaths.every((path) => path.length < 2)) return
    setFitNonce((value) => value + 1)
  }, [journeyPaths])

  useEffect(() => {
    if (!selectedStation) return
    const key = getStationMapKey(selectedStation)
    if (!mapStations.some((station) => getStationMapKey(station) === key)) {
      setSelectedStation(null)
    }
  }, [mapStations, selectedStation])

  const handleStationSelect = useCallback(
    (station: Station) => {
      const selectionKey = getStationMapKey(station)
      setSelectedStation(resolveStation(station))
      setDetailsLoading(true)
      void loadStationDetails(station).finally(() => {
        setDetailsLoading(false)
        setSelectedStation((current) => {
          if (!current || getStationMapKey(current) !== selectionKey) return current
          return resolveMapStationDetails(current)
        })
      })
    },
    [loadStationDetails, resolveStation]
  )

  const handleStationClear = useCallback(() => {
    setSelectedStation(null)
  }, [])

  const mappedCount = mapStations.length
  const areaCount = paygStations.length
  const mapPending = !journeyResolved || !viewportReady
  const status = mapPending
    ? 'Loading map…'
    : mappedCount === 0
      ? 'No stations in this area matched the stations database yet.'
      : originStation && destStation
        ? `Showing the searched journey from ${originStation.stationName} to ${destStation.stationName}, and all other stations in the network area. (Please note routing may not be correct)`
        : mappedCount < areaCount
          ? `${mappedCount} of ${areaCount} stations in ${areaName} with coordinates in the stations database.`
          : `${mappedCount} stations in ${areaName}.`

  useEffect(() => {
    if (!waitingForStations) setMapMounted(true)
    else setViewportReady(false)
  }, [waitingForStations])

  useEffect(() => {
    if (mapPending) {
      setOverlayVisible(true)
      return
    }
    const fadeId = window.setTimeout(() => setOverlayVisible(false), 180)
    return () => window.clearTimeout(fadeId)
  }, [mapPending])

  return (
    <div className="tickets-area-map">
      <StationSectionTitle
        title="Area Map"
        icon={MapPin}
        pageHeading
        skeleton={overlayVisible}
      />
      <p className="tickets-area-map__status">
        {overlayVisible ? <TextSkeletonLine>{status}</TextSkeletonLine> : status}
      </p>
      <div
        className={[
          'tickets-area-map__canvas-wrap',
          overlayVisible ? 'tickets-area-map__canvas-wrap--loading' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        {mapMounted ? (
          <StationsOsmMap
            stations={mapStations}
            publishedStations={mapStations}
            networkView="stations_gbnr"
            selectedStationId={selectedStation ? getStationMapKey(selectedStation) : null}
            highlightedStationIds={highlightedStationIds}
            journeyPaths={journeyPaths}
            persistCamera={false}
            onStationSelect={handleStationSelect}
            onStationClear={handleStationClear}
            fitNonce={fitNonce}
            dataReady={!waitingForStations}
            waitForTiles={false}
            onReady={() => setViewportReady(true)}
          >
            <StationsMapSelectedCardFloat
              station={selectedStation}
              detailsLoading={detailsLoading}
            />
          </StationsOsmMap>
        ) : null}
        {overlayVisible ? <PaygAreaMapSkeleton fading={!mapPending} /> : null}
      </div>
    </div>
  )
}

export default PaygAreaStationsMap
