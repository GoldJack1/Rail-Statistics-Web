'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  NETWORK_COLLECTION_IDS,
  NETWORK_LABELS,
  isNetworkCollection,
  isStationIncludedInAllNetworkView,
  type NetworkCollectionId,
  type NetworkViewFilter,
} from '../../constants/stationCollections'
import {
  NETWORK_MAP_COLORS,
  NETWORK_MAP_FALLBACK_COLOR,
  PENDING_NEW_STATION_MAP_COLOR,
  SELECTED_MARKER_BORDER_COLOR,
} from '../../constants/stationNetworkMapColors'
import { useTheme, readThemeFromDocument } from '../../hooks/useTheme'
import { getStationNetworkCollectionId, getStationMapKey } from '../../utils/stationAreaSlug'
import { isValidStationCoordinate } from '../../utils/stationCoordinates'
import {
  createSuperTramMapDivIcon,
  isSuperTramMapStop,
} from '../../utils/superTramMapMarker'
import { getMarkerHitRadius, getMarkerVisualRadius, MARKER_STROKE } from '../../utils/mapMarkerSizing'
import { addThemeTileLayersToMap, swapThemeTileLayers, type MapTileLayerRefs } from '../../utils/mapTileLayers'
import { guardLeafletCanvasRenderer } from '../../utils/leafletCanvasRendererGuard'
import {
  isStationVisibleInTimelineStep,
  type SuperTramTimelineCutoff,
} from '../../utils/superTramTimeline'
import {
  loadSuperTramTrackGraph,
  pointAlongTrackPath,
  shortestTrackPathBetweenLatLngs,
  trackFollowDurationSeconds,
  trackPathLengthMeters,
  type LatLngTuple,
} from '../../utils/superTramTrackPath'
import { LIGHTRAIL_COLLECTION_ID } from '../../utils/lightRailStationFields'
import {
  getMapViewportMarkerLimit,
  getStationsForViewportMarkers,
  shouldCullStationsMapMarkers,
} from '../../utils/mapsViewportMarkers'
import {
  readMapsMapViewSessionState,
  writeMapsMapViewSessionState,
  registerActiveStationsMap,
  unregisterActiveStationsMap,
  setActiveStationsMapNetwork,
  snapshotActiveStationsMapView,
  clearMapsMapViewSessionState,
} from '../../utils/mapsMapViewStorage'
import {
  STATIONS_MAP_DEFAULT_CHROME,
  STATIONS_MAP_TIMELINE_BOTTOM_CHROME,
  STATIONS_MAP_EMPTY_CENTER,
  STATIONS_MAP_EMPTY_ZOOM,
  isNearEmptyDefaultMapView,
  fitPaddingToLeafletOptions,
  minUsableZoomForStations,
  planStationsMapFit,
  shouldRestoreSavedMapView,
  type MapPixelSize,
  type StationsMapFitPaddingOptions,
} from '../../utils/mapsFitBounds'
import type { Station } from '../../types'
import {
  MapAddStationContextMenu,
  type MapAddStationContextMenuState,
} from './MapAddStationContextMenu'
import { MapZoomControls } from './MapZoomControls'
import './StationsOsmMap.css'
import './leafletDarkTiles.css'

guardLeafletCanvasRenderer(L)

const MOBILE_MAP_MEDIA = '(max-width: 639px)'
/** Above ORM rails (overlay 400), below station circle blobs. */
const JOURNEY_LINE_PANE = 'stationsJourney'
const JOURNEY_LINE_PANE_Z = '450'
/** Circle pins sit above the journey overlay. */
const STATION_CIRCLE_PANE = 'stationCircles'
const STATION_CIRCLE_PANE_Z = '550'
/** Origin / destination pins sit above other station blobs. */
const STATION_HIGHLIGHT_PANE = 'stationHighlightCircles'
const STATION_HIGHLIGHT_PANE_Z = '580'
const VIEWPORT_MOVEEND_DEBOUNCE_MS = 150
const PROGRAMMATIC_MOVE_MS = 300
/** Close-up on the stop that just appeared. */
const TIMELINE_FOLLOW_SINGLE_ZOOM = 16
/** Keep the pin slightly below true centre; timeline float sits top-right. */
const TIMELINE_FOLLOW_BOTTOM_BIAS_PX = 36
/** Approximate floating timeline card width when the side panel is collapsed. */
const TIMELINE_FOLLOW_FLOAT_RIGHT_CHROME_PX = 380
const SCROLL_ZOOM_HINT_MS = 2200

/**
 * The stop that just opened at this timeline step (prologue → empty).
 */
function getTimelineFollowFocusStation(
  stations: Station[],
  cutoff: SuperTramTimelineCutoff,
  visibleStationIds: ReadonlySet<string> | null,
  showUndatedAtMax: boolean
): Station | null {
  if (cutoff.stationId == null) return null

  const focus = stations.find((station) => {
    if (station.id !== cutoff.stationId) return false
    if (station.sourceCollectionId !== LIGHTRAIL_COLLECTION_ID) return false
    if (!isValidStationCoordinate(station.latitude, station.longitude)) return false
    return isStationVisibleInTimelineStep(station, {
      cutoff,
      visibleStationIds,
      showIncompleteAtMax: showUndatedAtMax,
    })
  })

  return focus ?? null
}

type MapFollowChrome = { top: number; right: number; bottom: number; left: number }

/**
 * Centre a stop in the padded map viewport (accounts for timeline chrome).
 * Tiny bounds + padding is more reliable than project/unproject bias.
 */
function flyToStationCentered(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  duration: number,
  chrome: MapFollowChrome
) {
  const pad = 1e-5
  const bounds = L.latLngBounds(
    [lat - pad, lng - pad],
    [lat + pad, lng + pad]
  )
  map.flyToBounds(bounds, {
    paddingTopLeft: [chrome.left, chrome.top],
    paddingBottomRight: [chrome.right, chrome.bottom],
    maxZoom: zoom,
    animate: duration > 0,
    duration,
    easeLinearity: 0.25,
  })
}

/** Map centre so `lat/lng` sits in the padded viewport (chrome-aware). */
function mapCenterForPinnedPoint(
  map: L.Map,
  lat: number,
  lng: number,
  zoom: number,
  chrome: MapFollowChrome
): L.LatLng {
  const size = map.getSize()
  const viewW = Math.max(1, size.x - chrome.left - chrome.right)
  const viewH = Math.max(1, size.y - chrome.top - chrome.bottom)
  const targetScreen = L.point(chrome.left + viewW / 2, chrome.top + viewH / 2)
  const mapCenterScreen = L.point(size.x / 2, size.y / 2)
  const pointProjected = map.project([lat, lng], zoom)
  const centerProjected = pointProjected.add(mapCenterScreen.subtract(targetScreen))
  return map.unproject(centerProjected, zoom)
}

/**
 * Ground-level pan along a track path. Returns a cancel function.
 */
function animateCameraAlongTrackPath(
  map: L.Map,
  path: LatLngTuple[],
  zoom: number,
  durationSec: number,
  chrome: MapFollowChrome,
  onFrame: (fn: () => void) => void,
  onDone: () => void
): () => void {
  if (path.length === 0) {
    onDone()
    return () => {}
  }

  if (durationSec <= 0 || path.length === 1) {
    const end = path[path.length - 1]
    onFrame(() => {
      map.setView(mapCenterForPinnedPoint(map, end[0], end[1], zoom, chrome), zoom, {
        animate: false,
      })
    })
    onDone()
    return () => {}
  }

  const totalMeters = trackPathLengthMeters(path)
  let rafId = 0
  let cancelled = false
  const startedAt = performance.now()

  const tick = (now: number) => {
    if (cancelled) return
    // Linear in time → constant metres/second along the path (no ease-in/out).
    const t = Math.min(1, (now - startedAt) / (durationSec * 1000))
    const point = pointAlongTrackPath(path, totalMeters * t)
    onFrame(() => {
      map.setView(mapCenterForPinnedPoint(map, point[0], point[1], zoom, chrome), zoom, {
        animate: false,
      })
    })
    if (t < 1) {
      rafId = window.requestAnimationFrame(tick)
      return
    }
    onDone()
  }

  rafId = window.requestAnimationFrame(tick)
  return () => {
    if (cancelled) return
    cancelled = true
    if (rafId) window.cancelAnimationFrame(rafId)
    onDone()
  }
}

/** Keeps the selected-station overlay inside the visible map stage while the page scrolls. */
function MapSelectedCardDock({
  stageRef,
  children,
}: {
  stageRef: RefObject<HTMLDivElement | null>
  children: ReactNode
}) {
  const dockRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const dock = dockRef.current
    const stage = stageRef.current
    if (!dock || !stage) return

    const readSpacingPx = (varName: string, fallback: number) => {
      const probe = document.createElement('div')
      probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;height:var(${varName});`
      document.body.appendChild(probe)
      const px = probe.getBoundingClientRect().height
      probe.remove()
      return px > 0 ? px : fallback
    }

    const readSafeAreaBottomPx = () => {
      const probe = document.createElement('div')
      probe.style.cssText =
        'position:absolute;visibility:hidden;pointer-events:none;height:env(safe-area-inset-bottom, 0px);'
      document.body.appendChild(probe)
      const px = probe.getBoundingClientRect().height
      probe.remove()
      return px > 0 ? px : 0
    }

    /** Visual viewport when available — accounts for mobile browser bottom chrome. */
    const readViewBox = () => {
      const vv = window.visualViewport
      if (vv) {
        return {
          top: vv.offsetTop,
          left: vv.offsetLeft,
          width: vv.width,
          height: vv.height,
          bottom: vv.offsetTop + vv.height,
        }
      }
      return {
        top: 0,
        left: 0,
        width: window.innerWidth,
        height: window.innerHeight,
        bottom: window.innerHeight,
      }
    }

    let spacingSm = readSpacingPx('--space-sm', 8)
    let spacingMd = readSpacingPx('--space-md', 12)
    let chromeInset = readSpacingPx('--stations-map-chrome-inset', 16)
    let safeAreaBottom = readSafeAreaBottomPx()
    let rafId = 0

    const update = () => {
      const rect = stage.getBoundingClientRect()
      const view = readViewBox()
      const isMobile = window.matchMedia(MOBILE_MAP_MEDIA).matches
      const spacing = isMobile ? spacingSm : spacingMd
      const layoutHeight = window.innerHeight

      const visibleTop = Math.max(rect.top, view.top)
      const visibleBottom = Math.min(rect.bottom, view.bottom)
      const visibleLeft = Math.max(rect.left, view.left)
      const visibleRight = Math.min(rect.right, view.left + view.width)
      const visibleHeight = visibleBottom - visibleTop
      const visibleWidth = visibleRight - visibleLeft

      if (visibleHeight < 48 || visibleWidth < 48) {
        dock.style.visibility = 'hidden'
        dock.style.pointerEvents = 'none'
        return
      }

      dock.style.visibility = 'visible'
      dock.style.pointerEvents = 'auto'
      // fixed `bottom` is relative to the layout viewport; lift by any browser chrome
      // below the visual viewport, plus safe-area (home indicator) on phone.
      const bottomChrome = Math.max(0, layoutHeight - view.bottom)
      const stageBottomGap = Math.max(0, layoutHeight - visibleBottom)
      const bottomPad = isMobile ? spacing + safeAreaBottom : spacing
      dock.style.bottom = `${Math.max(bottomChrome, stageBottomGap) + bottomPad}px`
      dock.style.maxHeight = ''

      if (isMobile) {
        const inset = Math.max(chromeInset, 0)
        dock.style.left = `${visibleLeft + inset}px`
        dock.style.right = `${Math.max(0, window.innerWidth - visibleRight) + inset}px`
        dock.style.width = 'auto'
        dock.style.maxWidth = 'none'
        dock.style.transform = 'none'
      } else {
        dock.style.left = 'auto'
        dock.style.right = `${Math.max(0, window.innerWidth - visibleRight) + spacing}px`
        dock.style.width = ''
        dock.style.maxWidth = ''
        dock.style.transform = 'none'
      }
    }

    const scheduleUpdate = () => {
      if (rafId !== 0) return
      rafId = window.requestAnimationFrame(() => {
        rafId = 0
        update()
      })
    }

    const onResize = () => {
      spacingSm = readSpacingPx('--space-sm', 8)
      spacingMd = readSpacingPx('--space-md', 12)
      chromeInset = readSpacingPx('--stations-map-chrome-inset', 16)
      safeAreaBottom = readSafeAreaBottomPx()
      scheduleUpdate()
    }

    update()
    window.addEventListener('scroll', scheduleUpdate, { capture: true, passive: true })
    window.addEventListener('resize', onResize)
    const vv = window.visualViewport
    vv?.addEventListener('resize', scheduleUpdate)
    vv?.addEventListener('scroll', scheduleUpdate)
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(scheduleUpdate) : null
    observer?.observe(stage)

    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId)
      window.removeEventListener('scroll', scheduleUpdate, true)
      window.removeEventListener('resize', onResize)
      vv?.removeEventListener('resize', scheduleUpdate)
      vv?.removeEventListener('scroll', scheduleUpdate)
      observer?.disconnect()
    }
  }, [stageRef, children])

  return (
    <div ref={dockRef} className="stations-map-selected-dock">
      {children}
    </div>
  )
}

function getMapFitPaddingOptions(
  networkView: NetworkViewFilter,
  mobile: boolean,
  mapSize?: MapPixelSize
): StationsMapFitPaddingOptions {
  return {
    mobile,
    useSuperTramMarkers: networkView === LIGHTRAIL_COLLECTION_ID,
    mapSize,
    chrome: { ...STATIONS_MAP_DEFAULT_CHROME },
  }
}

type StationMarkerPair =
  | {
      kind: 'circle'
      hit: L.CircleMarker
      visual: L.CircleMarker
    }
  | {
      kind: 'supertram-logo'
      hit: L.Marker
      visual: L.Marker
    }

function isMobileMapViewport(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(MOBILE_MAP_MEDIA).matches
}

function getMarkerRadii(isSelected: boolean, mobile: boolean) {
  return {
    visual: getMarkerVisualRadius(isSelected, mobile),
    hit: getMarkerHitRadius(isSelected, mobile),
  }
}

interface StationsOsmMapProps {
  stations: Station[]
  /** Published Firestore stations only — used for map bounds (excludes pending new). */
  publishedStations: Station[]
  pendingNewStationKeys?: ReadonlySet<string>
  networkView: NetworkViewFilter
  selectedStationId: string | null
  onStationSelect: (station: Station) => void
  onStationClear: () => void
  allowAddStation?: boolean
  addStationMode?: boolean
  onAddStationAtLocation?: (latitude: number, longitude: number) => void
  onAddStationModeChange?: (enabled: boolean) => void
  /** SuperTram opening timeline — null disables timeline filtering (visibility only). */
  timelineCutoff?: SuperTramTimelineCutoff | null
  /** When set, pin visibility follows the slider step list instead of re-comparing cutoffs. */
  timelineVisibleStationIds?: ReadonlySet<string> | null
  timelineShowUndatedAtMax?: boolean
  /** Slowly fly the camera to the currently visible timeline stops as they appear. */
  timelineFollowAppearing?: boolean
  /**
   * When true, reserve space for the floating timeline card (side panel closed)
   * so follow-camera centres in the clear map area.
   */
  timelineFollowReserveFloatChrome?: boolean
  liteMode?: boolean
  /**
   * Increment when the user changes network tabs to fit the map to that network.
   * Remounts (e.g. back from a station) should keep the previous value.
   */
  fitNonce?: number
  /**
   * False while the current network’s station set is still loading.
   * Parent should pass empty station lists until ready so pins appear together.
   */
  dataReady?: boolean
  /**
   * When false, skip the main map’s saved camera and do not write session view.
   * Used for embedded maps (PAYG area map).
   */
  persistCamera?: boolean
  /** Extra pins to draw in the selected style (e.g. fare origin and destination). */
  highlightedStationIds?: readonly string[]
  /** OSM railway-following line to overlay (OpenRailwayMap-style journey). */
  journeyPath?: Array<[number, number]> | null
  /** Multiple journey overlays (e.g. Queen Street and City Line into Cardiff). */
  journeyPaths?: Array<Array<[number, number]>> | null
  /** Overlay content positioned over the map stage (not the attribution bar). */
  children?: ReactNode
  /** Fires once the camera has fitted and visible tiles have loaded (or timed out). */
  onReady?: () => void
  /** When false, onReady fires after camera fit without waiting for OSM tiles. */
  waitForTiles?: boolean
}

function isLayerOnMap(layer: L.Layer): boolean {
  return Boolean((layer as L.Layer & { _map?: L.Map | null })._map)
}

function getStationLegendCollectionId(
  station: Station,
  networkView: NetworkViewFilter
): NetworkCollectionId | null {
  const collectionId =
    station.sourceCollectionId && isNetworkCollection(station.sourceCollectionId)
      ? station.sourceCollectionId
      : getStationNetworkCollectionId(station, networkView !== 'all' ? networkView : undefined)

  return collectionId && isNetworkCollection(collectionId) ? collectionId : null
}

function getStationMarkerColor(
  station: Station,
  networkView: NetworkViewFilter,
  pendingNewStationKeys: ReadonlySet<string>
): string {
  if (pendingNewStationKeys.has(getStationMapKey(station))) {
    return PENDING_NEW_STATION_MAP_COLOR
  }

  const collectionId = getStationLegendCollectionId(station, networkView)
  if (collectionId) {
    return NETWORK_MAP_COLORS[collectionId]
  }
  return NETWORK_MAP_FALLBACK_COLOR
}

function setMarkerTimelineVisibility(
  marker: StationMarkerPair,
  visible: boolean,
  options?: { animateAppear?: boolean }
): void {
  const opacity = visible ? 1 : 0
  const animateAppear = Boolean(options?.animateAppear && visible)

  if (marker.kind === 'supertram-logo') {
    const iconMarker = marker.visual as L.Marker
    iconMarker.setOpacity(opacity)
    const element = iconMarker.getElement()
    if (element) {
      element.style.pointerEvents = visible ? 'auto' : 'none'
      const inner = element.querySelector(
        '.stations-osm-map__supertram-marker'
      ) as HTMLElement | null
      if (inner) {
        inner.classList.remove('stations-osm-map__supertram-marker--appear')
        if (!visible) {
          inner.style.transform = ''
        } else if (animateAppear) {
          // Force a reflow so the grow animation retriggers each time a stop opens.
          void inner.offsetWidth
          inner.classList.add('stations-osm-map__supertram-marker--appear')
        }
      }
    }
    return
  }

  marker.hit.setStyle({
    fillOpacity: visible ? 0.001 : 0,
    interactive: visible,
  })

  const circleMarker = marker.visual as L.CircleMarker
  const fullRadius = circleMarker.options.radius ?? getMarkerVisualRadius(false, false)
  if (!visible) {
    circleMarker.setStyle({
      fillOpacity: 0,
      opacity: 0,
      radius: fullRadius,
    })
    return
  }

  if (animateAppear) {
    circleMarker.setStyle({
      fillOpacity: 0.95,
      opacity: 1,
      radius: Math.max(1, fullRadius * 0.15),
    })
    window.requestAnimationFrame(() => {
      circleMarker.setStyle({
        fillOpacity: 0.95,
        opacity: 1,
        radius: fullRadius,
      })
    })
    return
  }

  circleMarker.setStyle({
    fillOpacity: 0.95,
    opacity: 1,
    radius: fullRadius,
  })
}

function applyMarkerStyle(
  marker: StationMarkerPair,
  station: Station,
  networkView: NetworkViewFilter,
  pendingNewStationKeys: ReadonlySet<string>,
  isSelected: boolean,
  mobile: boolean
): void {
  const { visual, hit } = getMarkerRadii(isSelected, mobile)
  const isPendingNew = pendingNewStationKeys.has(getStationMapKey(station))

  if (marker.kind === 'supertram-logo') {
    const iconMarker = marker.visual as L.Marker
    iconMarker.setIcon(createSuperTramMapDivIcon(isSelected, mobile, isPendingNew))
    iconMarker.setZIndexOffset(isSelected ? 1000 : 0)
    return
  }

  marker.hit.setStyle({
    radius: hit,
    fillOpacity: 0.001,
    stroke: false,
    weight: 0,
  })

  const circleMarker = marker.visual as L.CircleMarker
  circleMarker.setStyle({
    radius: visual,
    fillColor: getStationMarkerColor(station, networkView, pendingNewStationKeys),
    color: isSelected ? MARKER_STROKE.color.selected : MARKER_STROKE.color.normal,
    weight: isSelected ? MARKER_STROKE.weight.selected : MARKER_STROKE.weight.normal,
    fillOpacity: 0.95,
  })
}

export function StationsOsmMap({
  stations,
  publishedStations,
  pendingNewStationKeys = new Set<string>(),
  networkView,
  selectedStationId,
  onStationSelect,
  onStationClear,
  allowAddStation = false,
  addStationMode = false,
  onAddStationAtLocation,
  onAddStationModeChange,
  timelineCutoff = null,
  timelineVisibleStationIds = null,
  timelineShowUndatedAtMax = true,
  timelineFollowAppearing = false,
  timelineFollowReserveFloatChrome = false,
  liteMode = false,
  fitNonce = 0,
  dataReady = true,
  persistCamera = true,
  highlightedStationIds = [],
  journeyPath = null,
  journeyPaths = null,
  children,
  onReady,
  waitForTiles = true,
}: StationsOsmMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapStageRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const [mapInstance, setMapInstance] = useState<L.Map | null>(null)
  const tileLayersRef = useRef<MapTileLayerRefs | null>(null)
  const markersLayerRef = useRef<L.LayerGroup | null>(null)
  const journeyLayerRef = useRef<L.LayerGroup | null>(null)
  const stationCircleRendererRef = useRef<L.SVG | null>(null)
  const stationHighlightRendererRef = useRef<L.SVG | null>(null)
  const journeyRendererRef = useRef<L.SVG | null>(null)
  const markersByIdRef = useRef<Map<string, StationMarkerPair>>(new Map())
  const onStationSelectRef = useRef(onStationSelect)
  const onStationClearRef = useRef(onStationClear)
  const allowAddStationRef = useRef(allowAddStation)
  const addStationModeRef = useRef(addStationMode)
  const onAddStationAtLocationRef = useRef(onAddStationAtLocation)
  const onAddStationModeChangeRef = useRef(onAddStationModeChange)
  const networkViewRef = useRef(networkView)
  const mobileMarkersRef = useRef(isMobileMapViewport())
  const publishedStationsRef = useRef(publishedStations)
  const [addStationMenu, setAddStationMenu] = useState<MapAddStationContextMenuState | null>(null)
  const [mobileMarkers, setMobileMarkers] = useState(isMobileMapViewport)
  const [visibleLegendNetworks, setVisibleLegendNetworks] = useState<NetworkCollectionId[]>([])
  const [viewportBounds, setViewportBounds] = useState<L.LatLngBounds | null>(null)
  /** Plain wheel zooms only after the map is clicked/dragged (Google Maps–style). */
  const wheelZoomArmedRef = useRef(false)
  const [wheelZoomArmed, setWheelZoomArmed] = useState(false)
  const [showScrollZoomHint, setShowScrollZoomHint] = useState(false)
  const scrollZoomHintTimerRef = useRef<number | null>(null)
  const showUnarmedScrollHintRef = useRef<() => void>(() => {})
  const viewportMoveEndTimerRef = useRef<number | null>(null)
  const previousFitNonceRef = useRef(fitNonce)
  const programmaticMoveRef = useRef(false)
  const programmaticClearTimerRef = useRef<number | null>(null)
  /** True after user pan/zoom or a successful saved-camera restore. */
  const userCameraRef = useRef(false)
  /** Camera apply succeeded for the current dataReady + fitNonce generation. */
  const didFitForReadyRef = useRef(false)
  const dataReadyRef = useRef(dataReady)
  const stationsByKeyRef = useRef<Map<string, Station>>(new Map())
  /** Previous rendered timeline visibility per marker key. */
  const timelineVisibilityPrevRef = useRef<Map<string, boolean>>(new Map())
  /** Station ids held hidden until the follow camera finishes flying to them. */
  const followDeferredHiddenIdsRef = useRef<Set<string>>(new Set())
  /** Station ids that have finished their follow reveal (committed on the map). */
  const followCommittedVisibleIdsRef = useRef<Set<string>>(new Set())
  const followRevealTimerRef = useRef<number | null>(null)
  const followRevealGenerationRef = useRef(0)
  /** Detects timeline step / follow-mode changes vs style-only re-renders. */
  const followStepKeyRef = useRef('')
  /** Last stop the follow camera settled on — used to route along tracks. */
  const followLastFocusRef = useRef<LatLngTuple | null>(null)
  const followTrackCancelRef = useRef<(() => void) | null>(null)
  const persistCameraRef = useRef(persistCamera)
  const journeyPathRef = useRef<Array<[number, number]> | null>(null)
  const onReadyRef = useRef(onReady)
  const waitForTilesRef = useRef(waitForTiles)
  const readyNotifiedRef = useRef(false)
  const readyTimeoutRef = useRef<number | null>(null)
  const { theme } = useTheme()
  const themeKey = theme === 'dark' ? 'dark' : 'light'

  const resolvedJourneyPaths = useMemo(() => {
    if (journeyPaths && journeyPaths.some((path) => path.length >= 2)) {
      return journeyPaths.filter((path) => path.length >= 2)
    }
    if (journeyPath && journeyPath.length >= 2) return [journeyPath]
    return [] as Array<Array<[number, number]>>
  }, [journeyPath, journeyPaths])

  onStationSelectRef.current = onStationSelect
  onStationClearRef.current = onStationClear
  allowAddStationRef.current = allowAddStation
  addStationModeRef.current = addStationMode
  onAddStationAtLocationRef.current = onAddStationAtLocation
  onAddStationModeChangeRef.current = onAddStationModeChange
  networkViewRef.current = networkView
  mobileMarkersRef.current = mobileMarkers
  publishedStationsRef.current = publishedStations
  dataReadyRef.current = dataReady
  persistCameraRef.current = persistCamera
  journeyPathRef.current = resolvedJourneyPaths.flat()
  onReadyRef.current = onReady
  waitForTilesRef.current = waitForTiles

  useEffect(() => {
    setActiveStationsMapNetwork(networkView)
  }, [networkView])

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_MAP_MEDIA)
    const onChange = () => setMobileMarkers(mediaQuery.matches)
    mediaQuery.addEventListener('change', onChange)
    return () => mediaQuery.removeEventListener('change', onChange)
  }, [])

  const mapStations = useMemo(
    () =>
      stations.filter((station) => {
        if (!isValidStationCoordinate(station.latitude, station.longitude)) return false
        if (networkView === 'all') {
          return isStationIncludedInAllNetworkView(station.sourceCollectionId)
        }
        return station.sourceCollectionId === networkView
      }),
    [stations, networkView]
  )
  const mapStationsRef = useRef(mapStations)
  mapStationsRef.current = mapStations

  const emphasizedStationIds = useMemo(() => {
    const ids = new Set(highlightedStationIds)
    if (selectedStationId) ids.add(selectedStationId)
    return ids
  }, [highlightedStationIds, selectedStationId])

  const cullViewport = shouldCullStationsMapMarkers(mapStations.length, networkView, liteMode)

  const markerStations = useMemo(() => {
    if (!cullViewport) return mapStations
    // Wait for the first bounds sample so All / GB NR don't mount every pin once.
    if (!viewportBounds) return []
    return getStationsForViewportMarkers(mapStations, viewportBounds, {
      selectedStationId,
      keepStationIds: highlightedStationIds,
      maxMarkers: getMapViewportMarkerLimit(liteMode),
    })
  }, [cullViewport, liteMode, mapStations, viewportBounds, selectedStationId, highlightedStationIds])

  stationsByKeyRef.current = new Map(
    mapStations.map((station) => [getStationMapKey(station), station])
  )

  const hasVisiblePendingNew = useMemo(
    () => mapStations.some((station) => pendingNewStationKeys.has(getStationMapKey(station))),
    [mapStations, pendingNewStationKeys]
  )

  const updateVisibleLegendNetworks = useCallback(
    (map: L.Map) => {
      if (networkView !== 'all') {
        setVisibleLegendNetworks([])
        return
      }

      const bounds = map.getBounds()
      const visible = new Set<NetworkCollectionId>()

      for (const station of mapStations) {
        if (!bounds.contains([station.latitude, station.longitude])) continue
        const collectionId = getStationLegendCollectionId(station, networkView)
        if (collectionId) visible.add(collectionId)
      }

      setVisibleLegendNetworks(NETWORK_COLLECTION_IDS.filter((id) => visible.has(id)))
    },
    [mapStations, networkView]
  )

  const withProgrammaticMove = useCallback((fn: () => void, holdMs = PROGRAMMATIC_MOVE_MS) => {
    programmaticMoveRef.current = true
    if (programmaticClearTimerRef.current !== null) {
      window.clearTimeout(programmaticClearTimerRef.current)
    }
    try {
      fn()
    } finally {
      programmaticClearTimerRef.current = window.setTimeout(() => {
        programmaticClearTimerRef.current = null
        programmaticMoveRef.current = false
      }, holdMs)
    }
  }, [])

  const setWheelZoomArmedState = useCallback((armed: boolean) => {
    wheelZoomArmedRef.current = armed
    setWheelZoomArmed(armed)
    const map = mapRef.current
    if (map) {
      if (armed) map.scrollWheelZoom.enable()
      else map.scrollWheelZoom.disable()
    }
    if (armed) {
      setShowScrollZoomHint(false)
      if (scrollZoomHintTimerRef.current !== null) {
        window.clearTimeout(scrollZoomHintTimerRef.current)
        scrollZoomHintTimerRef.current = null
      }
    }
  }, [])

  showUnarmedScrollHintRef.current = () => {
    if (wheelZoomArmedRef.current) return
    setShowScrollZoomHint(true)
    if (scrollZoomHintTimerRef.current !== null) {
      window.clearTimeout(scrollZoomHintTimerRef.current)
    }
    scrollZoomHintTimerRef.current = window.setTimeout(() => {
      scrollZoomHintTimerRef.current = null
      setShowScrollZoomHint(false)
    }, SCROLL_ZOOM_HINT_MS)
  }

  const persistCurrentMapView = useCallback(
    (map: L.Map, nextNetworkView: NetworkViewFilter, options?: { pinned?: boolean }) => {
      const size = map.getSize()
      if (size.x <= 0 || size.y <= 0) return
      const center = map.getCenter()
      const mapSize: MapPixelSize = { x: size.x, y: size.y }
      const paddingOptions = getMapFitPaddingOptions(
        networkViewRef.current,
        mobileMarkersRef.current,
        mapSize
      )
      writeMapsMapViewSessionState(
        nextNetworkView,
        {
          lat: center.lat,
          lng: center.lng,
          zoom: map.getZoom(),
        },
        {
          minZoom: minUsableZoomForStations(publishedStationsRef.current, mapSize, paddingOptions),
          pinned: options?.pinned,
        }
      )
    },
    []
  )

  const fitMapToStations = useCallback((map: L.Map, nextStations: Station[]): boolean => {
    const size = map.getSize()
    const mapSize: MapPixelSize | undefined =
      size.x > 0 && size.y > 0 ? { x: size.x, y: size.y } : undefined
    const plan = planStationsMapFit(
      nextStations,
      getMapFitPaddingOptions(networkViewRef.current, mobileMarkersRef.current, mapSize)
    )

    if (plan.kind === 'empty') {
      map.setView(STATIONS_MAP_EMPTY_CENTER, STATIONS_MAP_EMPTY_ZOOM, { animate: false })
      return false
    }

    if (plan.kind === 'single') {
      map.setView([plan.lat, plan.lng], plan.zoom, { animate: false })
      return true
    }

    map.fitBounds(plan.bounds, {
      ...fitPaddingToLeafletOptions(plan.padding),
      maxZoom: plan.maxZoom,
      animate: false,
    })
    return true
  }, [])

  const notifyViewportReady = useCallback((map: L.Map) => {
    if (readyNotifiedRef.current || !onReadyRef.current) return

    const finish = () => {
      if (readyNotifiedRef.current) return
      readyNotifiedRef.current = true
      if (readyTimeoutRef.current != null) {
        window.clearTimeout(readyTimeoutRef.current)
        readyTimeoutRef.current = null
      }
      map.off('load', finish)
      onReadyRef.current?.()
    }

    let tilesLoading = false
    if (waitForTilesRef.current) {
      map.eachLayer((layer) => {
        if (layer instanceof L.GridLayer && layer.isLoading()) tilesLoading = true
      })
    }

    if (!tilesLoading) {
      finish()
      return
    }

    map.once('load', finish)
    readyTimeoutRef.current = window.setTimeout(finish, 800)
  }, [])

  /**
   * Restore pinned session camera or fit pins once the canvas has a real size.
   * Returns false when size is 0 so callers can retry (do not consume the one-shot).
   */
  const tryApplyMapCamera = useCallback((): boolean => {
    const map = mapRef.current
    if (!map) return false

    let size = map.getSize()
    if (size.x <= 0 || size.y <= 0) {
      withProgrammaticMove(() => {
        map.invalidateSize({ pan: false })
      })
      size = map.getSize()
      if (size.x <= 0 || size.y <= 0) return false
    }

    const mapSize: MapPixelSize = { x: size.x, y: size.y }
    const paddingOptions = getMapFitPaddingOptions(
      networkViewRef.current,
      mobileMarkersRef.current,
      mapSize
    )
    const saved = persistCameraRef.current
      ? readMapsMapViewSessionState(networkViewRef.current)
      : null
    const stations = publishedStationsRef.current

    if (
      saved &&
      shouldRestoreSavedMapView(saved, mapSize, stations, paddingOptions)
    ) {
      // Always re-assert center/zoom once size is known (deep zooms can be lost on
      // the size-0 mount setView). Skip only when already exact after a prior apply.
      const center = map.getCenter()
      const zoomMatches = Math.abs(map.getZoom() - saved.zoom) < 0.05
      const centerMatches =
        Math.abs(center.lat - saved.lat) < 1e-6 && Math.abs(center.lng - saved.lng) < 1e-6
      if (!didFitForReadyRef.current || !zoomMatches || !centerMatches) {
        withProgrammaticMove(() => {
          map.setView([saved.lat, saved.lng], saved.zoom, { animate: false })
        })
      }
      userCameraRef.current = true
      didFitForReadyRef.current = true
      return true
    }

    if (didFitForReadyRef.current) return true

    // Pinned leave-map camera exists but wasn't applied (should be rare). Wait —
    // do not auto-fit and overwrite it with a national Northern England overview.
    // Near-empty “pinned” cameras are invalid and must fall through to fit.
    if (saved?.pinned && !isNearEmptyDefaultMapView(saved)) return false

    // Wait for pins before auto-fitting.
    if (!dataReadyRef.current || stations.length === 0) return false

    // Ignore spurious “user camera” from invalidateSize while still on the empty default.
    const center = map.getCenter()
    const onEmptyDefault = isNearEmptyDefaultMapView({
      lat: center.lat,
      lng: center.lng,
      zoom: map.getZoom(),
    })
    if (userCameraRef.current && !onEmptyDefault) {
      didFitForReadyRef.current = true
      return true
    }
    if (onEmptyDefault) {
      userCameraRef.current = false
    }

    withProgrammaticMove(() => {
      const journey = journeyPathRef.current
      if (journey && journey.length >= 2) {
        const size = map.getSize()
        const mapSize: MapPixelSize | undefined =
          size.x > 0 && size.y > 0 ? { x: size.x, y: size.y } : undefined
        const plan = planStationsMapFit(
          journey.map(([latitude, longitude]) => ({ latitude, longitude })),
          getMapFitPaddingOptions(networkViewRef.current, mobileMarkersRef.current, mapSize)
        )
        if (plan.kind === 'bounds') {
          map.fitBounds(plan.bounds, {
            ...fitPaddingToLeafletOptions(plan.padding),
            maxZoom: plan.maxZoom,
            animate: false,
          })
        } else if (plan.kind === 'single') {
          map.setView([plan.lat, plan.lng], plan.zoom, { animate: false })
        } else {
          fitMapToStations(map, stations)
        }
      } else {
        const persistable = fitMapToStations(map, stations)
        if (
          persistCameraRef.current &&
          persistable &&
          !readMapsMapViewSessionState(networkViewRef.current)?.pinned
        ) {
          persistCurrentMapView(map, networkViewRef.current)
        }
        return
      }
      if (
        persistCameraRef.current &&
        !readMapsMapViewSessionState(networkViewRef.current)?.pinned
      ) {
        persistCurrentMapView(map, networkViewRef.current)
      }
    })
    didFitForReadyRef.current = true
    return true
  }, [withProgrammaticMove, fitMapToStations, persistCurrentMapView])

  const tryApplyMapCameraAndNotify = useCallback((): boolean => {
    const applied = tryApplyMapCamera()
    const map = mapRef.current
    if (!map) return applied
    if (applied || (dataReadyRef.current && publishedStationsRef.current.length === 0)) {
      notifyViewportReady(map)
    }
    return applied
  }, [notifyViewportReady, tryApplyMapCamera])

  const tryApplyMapCameraRef = useRef(tryApplyMapCameraAndNotify)
  tryApplyMapCameraRef.current = tryApplyMapCameraAndNotify

  const removeMarkerPair = useCallback((layerGroup: L.LayerGroup, marker: StationMarkerPair) => {
    layerGroup.removeLayer(marker.hit)
    if (marker.kind === 'circle' && marker.visual !== marker.hit) {
      layerGroup.removeLayer(marker.visual)
    }
  }, [])

  const createStationMarker = useCallback(
    (station: Station, layerGroup: L.LayerGroup, isSelected: boolean): StationMarkerPair => {
      const key = getStationMapKey(station)
      const { hit, visual } = getMarkerRadii(isSelected, mobileMarkers)
      const latLng: L.LatLngTuple = [station.latitude, station.longitude]
      const isPendingNew = pendingNewStationKeys.has(key)
      const useSuperTramLogo = isSuperTramMapStop(station, networkView)

      const selectStation = (event: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(event)
        const current = stationsByKeyRef.current.get(key)
        if (current) onStationSelectRef.current(current)
      }

      if (useSuperTramLogo) {
        const logoMarker = L.marker(latLng, {
          icon: createSuperTramMapDivIcon(isSelected, mobileMarkers, isPendingNew),
          interactive: true,
          keyboard: false,
        })
        logoMarker.on('click', selectStation)
        if (isSelected) logoMarker.setZIndexOffset(1000)
        layerGroup.addLayer(logoMarker)
        return {
          hit: logoMarker,
          visual: logoMarker,
          kind: 'supertram-logo',
        }
      }

      const circlePane = isSelected ? STATION_HIGHLIGHT_PANE : STATION_CIRCLE_PANE
      const renderer = isSelected
        ? stationHighlightRendererRef.current
        : stationCircleRendererRef.current
      const hitMarker = L.circleMarker(latLng, {
        radius: hit,
        fillColor: '#000000',
        fillOpacity: 0.001,
        stroke: false,
        weight: 0,
        pane: circlePane,
        renderer: renderer ?? undefined,
        className: 'stations-osm-map__hit-target',
      })

      const visualMarker = L.circleMarker(latLng, {
        radius: visual,
        fillColor: getStationMarkerColor(station, networkView, pendingNewStationKeys),
        color: isSelected ? MARKER_STROKE.color.selected : MARKER_STROKE.color.normal,
        weight: isSelected ? MARKER_STROKE.weight.selected : MARKER_STROKE.weight.normal,
        fillOpacity: 0.95,
        interactive: false,
        pane: circlePane,
        renderer: renderer ?? undefined,
        className: 'stations-osm-map__visual-target',
      })

      hitMarker.on('click', selectStation)
      layerGroup.addLayer(hitMarker)
      layerGroup.addLayer(visualMarker)
      return {
        hit: hitMarker,
        visual: visualMarker,
        kind: 'circle',
      }
    },
    [mobileMarkers, networkView, pendingNewStationKeys]
  )

  const syncMarkers = useCallback(
    (map: L.Map) => {
      if (!map.getContainer() || !map.getPane(STATION_CIRCLE_PANE)) return
      let layerGroup = markersLayerRef.current
      if (!layerGroup) {
        layerGroup = L.layerGroup().addTo(map)
        markersLayerRef.current = layerGroup
      }

      const nextKeys = new Set(markerStations.map((station) => getStationMapKey(station)))

      markersByIdRef.current.forEach((marker, key) => {
        if (nextKeys.has(key)) return
        removeMarkerPair(layerGroup!, marker)
        markersByIdRef.current.delete(key)
      })

      if (markerStations.length === 0) return

      markerStations.forEach((station) => {
        const key = getStationMapKey(station)
        const existing = markersByIdRef.current.get(key)
        const useSuperTramLogo = isSuperTramMapStop(station, networkView)
        const desiredKind = useSuperTramLogo ? 'supertram-logo' : 'circle'
        const isSelected = emphasizedStationIds.has(key)

        if (existing && existing.kind === desiredKind) {
          const desiredPane = isSelected ? STATION_HIGHLIGHT_PANE : STATION_CIRCLE_PANE
          const currentPane = existing.visual.options.pane
          if (existing.kind === 'circle' && currentPane !== desiredPane) {
            removeMarkerPair(layerGroup!, existing)
            markersByIdRef.current.delete(key)
            markersByIdRef.current.set(key, createStationMarker(station, layerGroup!, isSelected))
            return
          }
          const current = existing.visual.getLatLng()
          if (
            Math.abs(current.lat - station.latitude) > 1e-9 ||
            Math.abs(current.lng - station.longitude) > 1e-9
          ) {
            const latLng: L.LatLngTuple = [station.latitude, station.longitude]
            existing.visual.setLatLng(latLng)
            if (existing.kind === 'circle' && existing.hit !== existing.visual) {
              existing.hit.setLatLng(latLng)
            }
          }
          if (isSelected && isLayerOnMap(existing.visual)) {
            existing.visual.bringToFront()
            if (existing.hit !== existing.visual && isLayerOnMap(existing.hit)) {
              existing.hit.bringToFront()
            }
            if (existing.kind === 'supertram-logo') {
              existing.visual.setZIndexOffset(1000)
            }
          }
          return
        }

        if (existing) {
          removeMarkerPair(layerGroup!, existing)
          markersByIdRef.current.delete(key)
        }

        markersByIdRef.current.set(key, createStationMarker(station, layerGroup!, isSelected))
      })

      emphasizedStationIds.forEach((key) => {
        const marker = markersByIdRef.current.get(key)
        if (!marker || !isLayerOnMap(marker.visual)) return
        marker.visual.bringToFront()
        if (marker.hit !== marker.visual && isLayerOnMap(marker.hit)) {
          marker.hit.bringToFront()
        }
        if (marker.kind === 'supertram-logo') {
          marker.visual.setZIndexOffset(1000)
        }
      })
    },
    [markerStations, networkView, emphasizedStationIds, createStationMarker, removeMarkerPair]
  )

  // Mount map once — restore saved camera if possible; otherwise wait for dataReady fit.
  useEffect(() => {
    if (!mapContainerRef.current) return

    const initialNetwork = networkViewRef.current
    const savedOnMount = persistCameraRef.current
      ? readMapsMapViewSessionState(initialNetwork)
      : null
    const restoreOnMount =
      savedOnMount != null &&
      shouldRestoreSavedMapView(
        savedOnMount,
        { x: 1, y: 1 },
        [],
        getMapFitPaddingOptions(initialNetwork, mobileMarkersRef.current)
      )

    const map = L.map(mapContainerRef.current, {
      zoomControl: false,
      attributionControl: false,
      // Plain wheel scrolls the page until the map is armed (click/drag). Ctrl/Cmd+wheel
      // and trackpad pinch (usually reported as ctrl+wheel) always zoom via onWheel.
      scrollWheelZoom: false,
      preferCanvas: true,
      maxZoom: 19,
      minZoom: 3,
    }).setView(
      restoreOnMount
        ? [savedOnMount.lat, savedOnMount.lng]
        : STATIONS_MAP_EMPTY_CENTER,
      restoreOnMount ? savedOnMount.zoom : STATIONS_MAP_EMPTY_ZOOM
    )
    const journeyPane = map.createPane(JOURNEY_LINE_PANE)
    journeyPane.style.zIndex = JOURNEY_LINE_PANE_Z
    journeyPane.style.pointerEvents = 'none'
    const stationCirclePane = map.createPane(STATION_CIRCLE_PANE)
    stationCirclePane.style.zIndex = STATION_CIRCLE_PANE_Z
    const stationHighlightPane = map.createPane(STATION_HIGHLIGHT_PANE)
    stationHighlightPane.style.zIndex = STATION_HIGHLIGHT_PANE_Z
    stationCircleRendererRef.current = L.svg({ pane: STATION_CIRCLE_PANE }).addTo(map)
    stationHighlightRendererRef.current = L.svg({ pane: STATION_HIGHLIGHT_PANE }).addTo(map)
    journeyRendererRef.current = L.svg({ pane: JOURNEY_LINE_PANE }).addTo(map)
    tileLayersRef.current = addThemeTileLayersToMap(map, readThemeFromDocument())
    mapRef.current = map
    setMapInstance(map)
    registerActiveStationsMap(map, initialNetwork)
    if (restoreOnMount) {
      // Mark user ownership now, but do NOT lock didFit yet — the canvas often has
      // size 0 on the first setView, which can drop a deep zoom. tryApplyMapCamera
      // re-applies the exact saved zoom once layout/invalidateSize has a real size.
      userCameraRef.current = true
    }

    map.on('click', (event) => {
      if (addStationModeRef.current && onAddStationAtLocationRef.current) {
        onAddStationAtLocationRef.current(event.latlng.lat, event.latlng.lng)
        return
      }
      onStationClearRef.current()
      setAddStationMenu(null)
    })

    map.on('contextmenu', (event) => {
      L.DomEvent.preventDefault(event.originalEvent)
      if (!allowAddStationRef.current || !onAddStationAtLocationRef.current) return

      setAddStationMenu({
        x: event.originalEvent.clientX,
        y: event.originalEvent.clientY,
        latitude: event.latlng.lat,
        longitude: event.latlng.lng,
      })
    })

    let cancelled = false

    const onWheel = (event: WheelEvent) => {
      if (cancelled) return

      // Armed: Leaflet scrollWheelZoom owns plain wheel (and pinch).
      if (wheelZoomArmedRef.current) return

      // Unarmed: Ctrl/Cmd+wheel (and trackpad pinch) still zoom; plain wheel scrolls the page.
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        event.stopPropagation()

        const delta = L.DomEvent.getWheelDelta(event)
        if (delta === 0) return

        const nextZoom = map.getZoom() + delta
        const point = map.mouseEventToContainerPoint(event)
        const latLng = map.containerPointToLatLng(point)
        map.setZoomAround(latLng, nextZoom)
        return
      }

      showUnarmedScrollHintRef.current()
    }

    const mapContainer = map.getContainer()
    mapContainer.addEventListener('wheel', onWheel, { passive: false })

    const onUserCameraChange = () => {
      if (programmaticMoveRef.current || cancelled) return
      const center = map.getCenter()
      // invalidateSize on the empty default must not claim user ownership.
      if (
        isNearEmptyDefaultMapView({
          lat: center.lat,
          lng: center.lng,
          zoom: map.getZoom(),
        })
      ) {
        return
      }
      userCameraRef.current = true
      if (persistCameraRef.current) {
        persistCurrentMapView(map, networkViewRef.current, { pinned: true })
      }
    }

    map.on('dragend', onUserCameraChange)
    map.on('zoomend', onUserCameraChange)

    const refreshSize = () => {
      if (!mapRef.current || cancelled) return
      withProgrammaticMove(() => {
        map.invalidateSize({ pan: false })
      })
      tryApplyMapCameraRef.current()
    }
    window.addEventListener('resize', refreshSize)

    // Size may be 0 on first paint — invalidate once the canvas has layout.
    const rafId = window.requestAnimationFrame(() => {
      window.requestAnimationFrame(refreshSize)
    })

    let observer: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined' && mapContainerRef.current) {
      observer = new ResizeObserver(() => {
        if (cancelled) return
        window.requestAnimationFrame(refreshSize)
      })
      observer.observe(mapContainerRef.current)
    }

    // Prefer pinned session camera immediately (return from station details).
    tryApplyMapCameraRef.current()

    return () => {
      cancelled = true
      snapshotActiveStationsMapView()
      unregisterActiveStationsMap(map)
      window.cancelAnimationFrame(rafId)
      window.removeEventListener('resize', refreshSize)
      mapContainer.removeEventListener('wheel', onWheel)
      if (scrollZoomHintTimerRef.current !== null) {
        window.clearTimeout(scrollZoomHintTimerRef.current)
        scrollZoomHintTimerRef.current = null
      }
      if (programmaticClearTimerRef.current !== null) {
        window.clearTimeout(programmaticClearTimerRef.current)
        programmaticClearTimerRef.current = null
      }
      if (viewportMoveEndTimerRef.current !== null) {
        window.clearTimeout(viewportMoveEndTimerRef.current)
        viewportMoveEndTimerRef.current = null
      }
      if (readyTimeoutRef.current !== null) {
        window.clearTimeout(readyTimeoutRef.current)
        readyTimeoutRef.current = null
      }
      observer?.disconnect()
      map.off('dragend', onUserCameraChange)
      map.off('zoomend', onUserCameraChange)
      if (markersLayerRef.current && mapRef.current) {
        mapRef.current.removeLayer(markersLayerRef.current)
      }
      if (journeyLayerRef.current && mapRef.current) {
        mapRef.current.removeLayer(journeyLayerRef.current)
      }
      markersLayerRef.current = null
      journeyLayerRef.current = null
      markersByIdRef.current.clear()
      stationCircleRendererRef.current = null
      stationHighlightRendererRef.current = null
      journeyRendererRef.current = null
      setMapInstance(null)
      map.remove()
      mapRef.current = null
      tileLayersRef.current = null
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- mount only

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    let layer = journeyLayerRef.current
    if (!layer) {
      layer = L.layerGroup().addTo(map)
      journeyLayerRef.current = layer
    }
    layer.clearLayers()
    for (const path of resolvedJourneyPaths) {
      const casing = L.polyline(path, {
        color: '#ffffff',
        weight: 8,
        opacity: 0.9,
        lineJoin: 'round',
        lineCap: 'round',
        interactive: false,
        pane: JOURNEY_LINE_PANE,
        renderer: journeyRendererRef.current ?? undefined,
        className: 'stations-osm-map__journey-line-casing',
      })
      const line = L.polyline(path, {
        color: SELECTED_MARKER_BORDER_COLOR,
        weight: 5,
        opacity: 0.95,
        lineJoin: 'round',
        lineCap: 'round',
        interactive: false,
        pane: JOURNEY_LINE_PANE,
        renderer: journeyRendererRef.current ?? undefined,
        className: 'stations-osm-map__journey-line',
      })
      casing.addTo(layer)
      line.addTo(layer)
    }
  }, [mapInstance, resolvedJourneyPaths])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    if (!cullViewport) {
      setViewportBounds(null)
      return
    }

    setViewportBounds(map.getBounds())

    const onMoveEnd = () => {
      if (viewportMoveEndTimerRef.current !== null) {
        window.clearTimeout(viewportMoveEndTimerRef.current)
      }
      viewportMoveEndTimerRef.current = window.setTimeout(() => {
        viewportMoveEndTimerRef.current = null
        setViewportBounds(map.getBounds())
      }, VIEWPORT_MOVEEND_DEBOUNCE_MS)
    }

    map.on('moveend', onMoveEnd)
    map.on('zoomend', onMoveEnd)

    return () => {
      if (viewportMoveEndTimerRef.current !== null) {
        window.clearTimeout(viewportMoveEndTimerRef.current)
        viewportMoveEndTimerRef.current = null
      }
      map.off('moveend', onMoveEnd)
      map.off('zoomend', onMoveEnd)
    }
  }, [cullViewport, mapInstance])

  useEffect(() => {
    if (!cullViewport || !mapRef.current) return
    setViewportBounds(mapRef.current.getBounds())
  }, [cullViewport, networkView, mapInstance])

  useEffect(() => {
    if (!mapRef.current) return
    syncMarkers(mapRef.current)
  }, [syncMarkers])

  // Network tab: clear saved camera and require a fresh fit when data is ready.
  useEffect(() => {
    if (fitNonce === previousFitNonceRef.current) return
    previousFitNonceRef.current = fitNonce
    if (fitNonce === 0) return

    if (persistCameraRef.current) {
      clearMapsMapViewSessionState(networkViewRef.current)
    }
    userCameraRef.current = false
    didFitForReadyRef.current = false
    readyNotifiedRef.current = false
    tryApplyMapCameraAndNotify()
  }, [fitNonce, tryApplyMapCameraAndNotify])

  // Restore pinned camera ASAP; otherwise fit once pins are ready. Retries while size is 0.
  useEffect(() => {
    if (!dataReady) {
      // Keep a successful pinned restore; only clear auto-fit so we can fit when pins arrive.
      if (!userCameraRef.current) {
        didFitForReadyRef.current = false
      }
      readyNotifiedRef.current = false
      tryApplyMapCameraAndNotify()
      return
    }
    tryApplyMapCameraAndNotify()
  }, [dataReady, publishedStations, networkView, fitNonce, tryApplyMapCameraAndNotify])

  useEffect(() => {
    if (!timelineFollowAppearing) return
    void loadSuperTramTrackGraph().catch(() => {
      /* follow falls back to flyTo when the graph is unavailable */
    })
  }, [timelineFollowAppearing])

  useEffect(() => {
    const clearFollowRevealTimer = () => {
      if (followRevealTimerRef.current !== null) {
        window.clearTimeout(followRevealTimerRef.current)
        followRevealTimerRef.current = null
      }
    }

    const clearFollowTrackAnimation = () => {
      followTrackCancelRef.current?.()
      followTrackCancelRef.current = null
    }

    const buildFollowChrome = (): MapFollowChrome => {
      const rightChrome = timelineFollowReserveFloatChrome
        ? TIMELINE_FOLLOW_FLOAT_RIGHT_CHROME_PX
        : STATIONS_MAP_DEFAULT_CHROME.right
      return {
        top: STATIONS_MAP_DEFAULT_CHROME.top + TIMELINE_FOLLOW_BOTTOM_BIAS_PX,
        right: rightChrome,
        bottom: STATIONS_MAP_DEFAULT_CHROME.bottom + STATIONS_MAP_TIMELINE_BOTTOM_CHROME,
        left: STATIONS_MAP_DEFAULT_CHROME.left,
      }
    }

    const scheduleReveal = (
      appearingIds: string[],
      committed: Set<string>,
      revealGeneration: number,
      delayMs: number,
      applyTimelineVisibility: (animateStationIds?: ReadonlySet<string>) => void
    ) => {
      clearFollowRevealTimer()
      followRevealTimerRef.current = window.setTimeout(() => {
        followRevealTimerRef.current = null
        if (revealGeneration !== followRevealGenerationRef.current) return
        appearingIds.forEach((id) => {
          followDeferredHiddenIdsRef.current.delete(id)
          committed.add(id)
        })
        applyTimelineVisibility(new Set(appearingIds))
      }, delayMs)
    }

    /**
     * Pan along SuperTram tracks when possible; otherwise fly straight.
     * Resolves with the camera move duration in seconds.
     */
    const moveFollowCamera = async (
      map: L.Map,
      focusStation: { latitude: number; longitude: number },
      prefersReducedMotion: boolean,
      revealGeneration: number
    ): Promise<number> => {
      const chrome = buildFollowChrome()
      const to: LatLngTuple = [focusStation.latitude, focusStation.longitude]
      const from = followLastFocusRef.current
      followLastFocusRef.current = to

      if (prefersReducedMotion) {
        withProgrammaticMove(() => {
          flyToStationCentered(map, to[0], to[1], TIMELINE_FOLLOW_SINGLE_ZOOM, 0, chrome)
        }, PROGRAMMATIC_MOVE_MS)
        return 0
      }

      let path: LatLngTuple[] | null = null
      if (from) {
        try {
          const graph = await loadSuperTramTrackGraph()
          if (revealGeneration !== followRevealGenerationRef.current) return 0
          path = shortestTrackPathBetweenLatLngs(graph, from, to)
        } catch {
          path = null
        }
      }

      if (revealGeneration !== followRevealGenerationRef.current) return 0

      // Always prefer a path of at least the two endpoints (track or straight).
      const movePath = path && path.length > 0 ? path : from ? [from, to] : [to]
      const duration = trackFollowDurationSeconds(trackPathLengthMeters(movePath))

      if (movePath.length === 1 || duration <= 0) {
        withProgrammaticMove(() => {
          flyToStationCentered(map, to[0], to[1], TIMELINE_FOLLOW_SINGLE_ZOOM, 0, chrome)
        }, PROGRAMMATIC_MOVE_MS)
        return 0
      }

      clearFollowTrackAnimation()
      await new Promise<void>((resolve) => {
        followTrackCancelRef.current = animateCameraAlongTrackPath(
          map,
          movePath,
          TIMELINE_FOLLOW_SINGLE_ZOOM,
          duration,
          chrome,
          (fn) => withProgrammaticMove(fn, 80),
          () => {
            followTrackCancelRef.current = null
            resolve()
          }
        )
      })
      return duration
    }

    const applyTimelineVisibility = (animateStationIds?: ReadonlySet<string>) => {
      markersByIdRef.current.forEach((marker, stationKey) => {
        const station = stationsByKeyRef.current.get(stationKey)
        if (!station) return

        applyMarkerStyle(
          marker,
          station,
          networkView,
          pendingNewStationKeys,
          emphasizedStationIds.has(stationKey),
          mobileMarkers
        )

        if (timelineCutoff === null || station.sourceCollectionId !== LIGHTRAIL_COLLECTION_ID) {
          followDeferredHiddenIdsRef.current.delete(station.id)
          timelineVisibilityPrevRef.current.set(stationKey, true)
          setMarkerTimelineVisibility(marker, true)
          return
        }

        const timelineVisible = isStationVisibleInTimelineStep(station, {
          cutoff: timelineCutoff,
          visibleStationIds: timelineVisibleStationIds,
          showIncompleteAtMax: timelineShowUndatedAtMax,
        })
        const visible =
          timelineVisible && !followDeferredHiddenIdsRef.current.has(station.id)
        const animateAppear = Boolean(animateStationIds?.has(station.id) && visible)
        timelineVisibilityPrevRef.current.set(stationKey, visible)
        setMarkerTimelineVisibility(marker, visible, { animateAppear })
      })
    }

    const visibleIdsKey = timelineVisibleStationIds
      ? [...timelineVisibleStationIds].sort().join('|')
      : ''
    const followStepKey = [
      timelineFollowAppearing ? '1' : '0',
      timelineCutoff?.stationId ?? '',
      timelineCutoff?.dateMs ?? '',
      timelineShowUndatedAtMax ? '1' : '0',
      visibleIdsKey,
    ].join(':')
    const followStepChanged = followStepKey !== followStepKeyRef.current

    // Style-only update (selection, etc.): keep deferred pins hidden, don't re-fly.
    if (!followStepChanged && timelineFollowAppearing && timelineCutoff !== null) {
      applyTimelineVisibility()
      // Do not clear the in-flight reveal timer from this path.
      return
    }
    followStepKeyRef.current = followStepKey

    // Follow off / timeline off: show pins immediately (grow on newly revealed).
    if (!timelineFollowAppearing || timelineCutoff === null) {
      clearFollowRevealTimer()
      clearFollowTrackAnimation()
      followRevealGenerationRef.current += 1
      followDeferredHiddenIdsRef.current.clear()
      followLastFocusRef.current = null

      const animateIds = new Set<string>()
      if (timelineCutoff !== null) {
        markersByIdRef.current.forEach((_marker, stationKey) => {
          const station = stationsByKeyRef.current.get(stationKey)
          if (!station || station.sourceCollectionId !== LIGHTRAIL_COLLECTION_ID) return
          const willShow = isStationVisibleInTimelineStep(station, {
            cutoff: timelineCutoff,
            visibleStationIds: timelineVisibleStationIds,
            showIncompleteAtMax: timelineShowUndatedAtMax,
          })
          const wasShown = timelineVisibilityPrevRef.current.get(stationKey) === true
          if (willShow && !wasShown) animateIds.add(station.id)
        })
      }

      followCommittedVisibleIdsRef.current = new Set(
        timelineVisibleStationIds ? [...timelineVisibleStationIds] : []
      )
      applyTimelineVisibility(animateIds)
      return () => {
        clearFollowRevealTimer()
        clearFollowTrackAnimation()
      }
    }

    const targetVisibleIds = timelineVisibleStationIds
      ? new Set(timelineVisibleStationIds)
      : new Set<string>()
    const committed = followCommittedVisibleIdsRef.current
    const appearingIds: string[] = []
    targetVisibleIds.forEach((id) => {
      if (!committed.has(id)) appearingIds.push(id)
    })
    committed.forEach((id) => {
      if (!targetVisibleIds.has(id)) committed.delete(id)
    })

    appearingIds.forEach((id) => followDeferredHiddenIdsRef.current.add(id))
    applyTimelineVisibility()

    const focusStation = getTimelineFollowFocusStation(
      mapStationsRef.current,
      timelineCutoff,
      timelineVisibleStationIds,
      timelineShowUndatedAtMax
    )

    const map = mapRef.current
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    clearFollowRevealTimer()
    clearFollowTrackAnimation()
    followRevealGenerationRef.current += 1
    const revealGeneration = followRevealGenerationRef.current

    if (!focusStation) {
      return () => {
        clearFollowRevealTimer()
        clearFollowTrackAnimation()
      }
    }

    if (!map) {
      if (appearingIds.length > 0) {
        appearingIds.forEach((id) => {
          followDeferredHiddenIdsRef.current.delete(id)
          committed.add(id)
        })
        applyTimelineVisibility(new Set(appearingIds))
      }
      followLastFocusRef.current = [focusStation.latitude, focusStation.longitude]
      return () => {
        clearFollowRevealTimer()
        clearFollowTrackAnimation()
      }
    }

    void (async () => {
      await moveFollowCamera(map, focusStation, prefersReducedMotion, revealGeneration)
      if (revealGeneration !== followRevealGenerationRef.current) return
      if (appearingIds.length === 0) return
      // Camera has already arrived — reveal the stop immediately.
      scheduleReveal(appearingIds, committed, revealGeneration, 0, applyTimelineVisibility)
    })()

    return () => {
      clearFollowRevealTimer()
      clearFollowTrackAnimation()
    }
  }, [
    selectedStationId,
    emphasizedStationIds,
    networkView,
    mobileMarkers,
    pendingNewStationKeys,
    timelineCutoff,
    timelineVisibleStationIds,
    timelineShowUndatedAtMax,
    timelineFollowAppearing,
    timelineFollowReserveFloatChrome,
    withProgrammaticMove,
  ])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const refreshLegend = () => updateVisibleLegendNetworks(map)
    refreshLegend()
    map.on('moveend', refreshLegend)
    map.on('zoomend', refreshLegend)

    return () => {
      map.off('moveend', refreshLegend)
      map.off('zoomend', refreshLegend)
    }
  }, [updateVisibleLegendNetworks])

  useEffect(() => {
    if (!mapRef.current || !tileLayersRef.current) return
    tileLayersRef.current = swapThemeTileLayers(mapRef.current, tileLayersRef.current, themeKey)
  }, [themeKey])

  useEffect(() => {
    if (!mapInstance) return

    const arm = () => setWheelZoomArmedState(true)

    const onPointerDownCapture = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (mapStageRef.current?.contains(target)) {
        arm()
        return
      }
      setWheelZoomArmedState(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setWheelZoomArmedState(false)
    }

    document.addEventListener('pointerdown', onPointerDownCapture, true)
    window.addEventListener('keydown', onKeyDown)
    mapInstance.on('dragstart', arm)

    return () => {
      document.removeEventListener('pointerdown', onPointerDownCapture, true)
      window.removeEventListener('keydown', onKeyDown)
      mapInstance.off('dragstart', arm)
    }
  }, [mapInstance, setWheelZoomArmedState])

  useEffect(() => {
    if (!addStationMode) return

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onAddStationModeChangeRef.current?.(false)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addStationMode])

  return (
    <div
      className={[
        'stations-osm-map',
        addStationMode ? 'stations-osm-map--add-station-mode' : '',
        allowAddStation ? 'stations-osm-map--admin-add' : '',
        wheelZoomArmed ? 'stations-osm-map--wheel-zoom-armed' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div ref={mapStageRef} className="stations-osm-map__stage">
        <div ref={mapContainerRef} className="stations-osm-map__canvas" aria-label="Map" />
        <MapZoomControls map={mapInstance} />
        {addStationMode && (
          <p className="stations-osm-map__add-mode-hint" role="status">
            Click the map to add a station · Esc to exit
          </p>
        )}
        {showScrollZoomHint && !addStationMode && (
          <p className="stations-osm-map__scroll-zoom-hint" role="status">
            Click the map to enable zoom
          </p>
        )}
        {allowAddStation && !addStationMode && (
          <MapAddStationContextMenu
            menu={addStationMenu}
            onClose={() => setAddStationMenu(null)}
            onAddStation={(latitude, longitude) => onAddStationAtLocation?.(latitude, longitude)}
          />
        )}
        {((networkView === 'all' && visibleLegendNetworks.length > 0) || hasVisiblePendingNew) && (
          <ul className="stations-osm-map__legend" aria-label="Map marker colours">
            {networkView === 'all' &&
              visibleLegendNetworks.map((collectionId) => (
                <li key={collectionId} className="stations-osm-map__legend-item">
                  <span
                    className="stations-osm-map__legend-dot"
                    style={{ backgroundColor: NETWORK_MAP_COLORS[collectionId] }}
                    aria-hidden="true"
                  />
                  <span className="stations-osm-map__legend-label">{NETWORK_LABELS[collectionId]}</span>
                </li>
              ))}
            {hasVisiblePendingNew && (
              <li className="stations-osm-map__legend-item">
                <span
                  className="stations-osm-map__legend-dot"
                  style={{ backgroundColor: PENDING_NEW_STATION_MAP_COLOR }}
                  aria-hidden="true"
                />
                <span className="stations-osm-map__legend-label">Unsaved new station</span>
              </li>
            )}
          </ul>
        )}
        {children ? (
          <MapSelectedCardDock stageRef={mapStageRef}>{children}</MapSelectedCardDock>
        ) : null}
      </div>
      <p className="stations-osm-map__attribution">
        <a href="https://leafletjs.com" target="_blank" rel="noreferrer">
          Leaflet
        </a>
        {' · '}
        ©{' '}
        <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
          OpenStreetMap
        </a>
        {' · '}
        Style:{' '}
        <a href="https://creativecommons.org/licenses/by-sa/2.0/" target="_blank" rel="noreferrer">
          CC-BY-SA 2.0
        </a>{' '}
        <a href="https://www.openrailwaymap.org/" target="_blank" rel="noreferrer">
          OpenRailwayMap
        </a>
      </p>
    </div>
  )
}

export default StationsOsmMap
