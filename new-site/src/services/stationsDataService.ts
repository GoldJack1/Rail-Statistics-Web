import {
  DEFAULT_NETWORK_COLLECTION_ID,
  NETWORK_COLLECTION_IDS,
  type NetworkCollectionId,
  type NetworkViewFilter,
  type StationCollectionId,
} from '@/constants/stationCollections'
import type { StationFetchDetailLevel } from '@/services/stationFirestoreMapper'
import {
  readDeviceCapabilityFromBrowser,
  resolveDevicePerformanceTier,
} from '@/utils/deviceCapability'
import {
  fetchCollectionFromCdn,
  fetchMergedNetworkStationsFromCdn,
  fetchStationsCdnManifest,
  invalidateStationsCdnManifestCache,
  isCdnBackedCollection,
  isStationCdnEnabled,
  shouldUseFirestoreForCollection,
  splitMergedStationsByCollection,
} from '@/services/stationsCdnService'
import { fetchLocalStations } from '@/services/localData'
import {
  isIndexedDbEntryFresh,
  readStationsFromIndexedDb,
  writeManifestVersionToIndexedDb,
  writeStationsToIndexedDb,
  type StationsIndexedDbEntry,
} from '@/services/stationsIndexedDb'
import type { Station } from '@/types'
import { isLightRailStop } from '@/utils/stationCardForNetwork'
import { LIGHTRAIL_COLLECTION_ID } from '@/utils/lightRailStationFields'
import { mergeNetworkCollections, toMapLeanStation, buildFullStationIndex } from '@/utils/mapLeanStation'
import { getStationMapKey, getStationNetworkCollectionId } from '@/utils/stationAreaSlug'

const FIREBASE_TIMEOUT_MS = 12_000

type CollectionLoadState = {
  full: Station[]
  list: Station[]
  lean: Station[]
  loading: boolean
  refreshing: boolean
  error: string | null
  fetchedAt: number | null
}

type Listener = () => void

const listeners = new Set<Listener>()
const collectionState = new Map<StationCollectionId, CollectionLoadState>()
const inflightLoads = new Map<string, Promise<void>>()
const inflightMergedBundleLoads = new Map<StationFetchDetailLevel, Promise<boolean>>()
let storeRevision = 0
let initialSyncPending = typeof window !== 'undefined'
let notifyScheduled = false

function createEmptyState(): CollectionLoadState {
  return {
    full: [],
    list: [],
    lean: [],
    loading: false,
    refreshing: false,
    error: null,
    fetchedAt: null,
  }
}

function resolveCollectionStations(
  state: CollectionLoadState,
  detailLevel: StationFetchDetailLevel
): Station[] {
  if (detailLevel === 'full') {
    return state.full.length > 0 ? state.full : state.list.length > 0 ? state.list : state.lean
  }
  if (detailLevel === 'list') {
    return state.list.length > 0 ? state.list : state.full.length > 0 ? state.full : state.lean
  }
  return state.lean.length > 0 ? state.lean : state.list.length > 0 ? state.list : state.full
}

function hasLoadedDetailLevel(
  state: CollectionLoadState,
  detailLevel: StationFetchDetailLevel
): boolean {
  if (detailLevel === 'full') return state.full.length > 0
  if (detailLevel === 'list') return state.list.length > 0
  return state.lean.length > 0
}

export function stationHasLocaleDetail(station: Station): boolean {
  return Boolean(
    station.county?.trim() ||
      station.country?.trim() ||
      station.borough?.trim() ||
      station.province?.trim()
  )
}

export function shouldReplaceFullWithList(full: Station[], list: Station[]): boolean {
  if (full.length === 0) return true
  const fullHasLocale = full.some(stationHasLocaleDetail)
  const listHasLocale = list.some(stationHasLocaleDetail)
  return listHasLocale && !fullHasLocale
}

/**
 * Older list CDN/IDB rows included SuperTram linesServed but omitted platforms.
 * Detect that shape so we can upgrade to full detail for the table Platforms column.
 */
export function lightRailStationsMissingPlatforms(stations: Station[]): boolean {
  const lightRail = stations.filter(isLightRailStop)
  if (lightRail.length === 0) return false
  if (lightRail.some((station) => Boolean(station.platforms?.trim()))) return false
  return lightRail.some((station) => Boolean(station.linesServed?.trim()))
}

const lightRailPlatformsUpgradeAttempted = new Set<StationCollectionId>()

function maybeUpgradeLightRailListForPlatforms(
  collectionId: StationCollectionId,
  stations: Station[]
): void {
  if (collectionId !== LIGHTRAIL_COLLECTION_ID) return
  if (!lightRailStationsMissingPlatforms(stations)) return
  if (lightRailPlatformsUpgradeAttempted.has(collectionId)) return
  lightRailPlatformsUpgradeAttempted.add(collectionId)
  void ensureCollectionLoaded(collectionId, {
    detailLevel: 'full',
    force: true,
    preferCache: false,
  })
}

function patchListCollectionState(
  collectionId: StationCollectionId,
  stations: Station[],
  fetchedAt: number
): void {
  const state = getState(collectionId)
  const missingPlatforms = lightRailStationsMissingPlatforms(stations)
  patchState(collectionId, {
    list: stations,
    lean: stations.map(toMapLeanStation),
    ...(shouldReplaceFullWithList(state.full, stations) && !missingPlatforms
      ? { full: stations }
      : {}),
    fetchedAt,
    error: null,
  })
  maybeUpgradeLightRailListForPlatforms(collectionId, stations)
}

function getState(collectionId: StationCollectionId): CollectionLoadState {
  const existing = collectionState.get(collectionId)
  if (existing) return existing
  const next = createEmptyState()
  collectionState.set(collectionId, next)
  return next
}

function notify(): void {
  // Coalesce rapid patchState bursts (progressive CDN loads) into one React update per frame.
  if (notifyScheduled) return
  notifyScheduled = true
  const flush = () => {
    notifyScheduled = false
    storeRevision += 1
    listeners.forEach((listener) => listener())
  }
  if (typeof queueMicrotask === 'function') {
    queueMicrotask(flush)
  } else {
    Promise.resolve().then(flush)
  }
}

export function getStationsStoreRevision(): number {
  return storeRevision
}

function patchState(
  collectionId: StationCollectionId,
  patch: Partial<CollectionLoadState>
): void {
  const current = getState(collectionId)
  collectionState.set(collectionId, { ...current, ...patch })
  notify()
}

export function subscribeStationsData(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function isStationsInitialSyncPending(): boolean {
  return initialSyncPending
}

export function beginStationsInitialSync(): void {
  if (initialSyncPending) return
  initialSyncPending = true
  notify()
}

export function endStationsInitialSync(): void {
  if (!initialSyncPending) return
  initialSyncPending = false
  notify()
}

export function getFetchConcurrency(): number {
  if (typeof navigator === 'undefined') return 3
  if (resolveDevicePerformanceTier(readDeviceCapabilityFromBrowser()) === 'lite') return 1
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection
  if (connection?.saveData) return 1
  const cores = navigator.hardwareConcurrency ?? 4
  return cores <= 4 ? 2 : 3
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return 'Unknown error'
  }
}

function inflightKey(collectionId: StationCollectionId, detailLevel: StationFetchDetailLevel, force: boolean): string {
  return `${collectionId}:${detailLevel}:${force ? 'force' : 'normal'}`
}

async function fetchWithDevTimeout<T>(promise: Promise<T>): Promise<T> {
  if (process.env.NODE_ENV !== 'development') {
    return promise
  }
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Firebase request timed out')), FIREBASE_TIMEOUT_MS)
  )
  return Promise.race([promise, timeoutPromise])
}

async function fetchCollectionFromNetwork(
  collectionId: StationCollectionId,
  detailLevel: StationFetchDetailLevel,
  force: boolean
): Promise<Station[]> {
  if (!shouldUseFirestoreForCollection(collectionId, force) && isCdnBackedCollection(collectionId)) {
    try {
      return await fetchWithDevTimeout(
        fetchCollectionFromCdn(collectionId, detailLevel)
      )
    } catch (error) {
      console.warn(`CDN fetch failed for ${collectionId}, falling back to Firestore:`, error)
    }
  }

  const { fetchStationsFromFirebase } = await import('@/services/firebase')
  return fetchWithDevTimeout(fetchStationsFromFirebase(collectionId, { detailLevel }))
}

async function getActiveManifestVersion(): Promise<string | null> {
  if (!isStationCdnEnabled()) return null
  const manifest = await fetchStationsCdnManifest()
  return manifest?.version ?? null
}

async function hydrateAllNetworkCollectionsFromIndexedDb(): Promise<void> {
  await Promise.all(NETWORK_COLLECTION_IDS.map((collectionId) => hydrateFromIndexedDb(collectionId)))
}

async function refreshCollectionIfStale(
  collectionId: StationCollectionId,
  detailLevel: StationFetchDetailLevel,
  entry: StationsIndexedDbEntry
): Promise<void> {
  try {
    const remoteVersion = await getActiveManifestVersion()
    const versionChanged = Boolean(
      remoteVersion && entry.manifestVersion && remoteVersion !== entry.manifestVersion
    )
    const ttlExpired = !isIndexedDbEntryFresh(entry, undefined, remoteVersion)
    if (!versionChanged && !ttlExpired) return

    const stations = await fetchCollectionFromNetwork(collectionId, detailLevel, false)
    if (stations.length === 0) return
    await persistCollection(collectionId, stations, detailLevel, remoteVersion)
  } catch (error) {
    console.warn(`Background station refresh failed for ${collectionId}:`, error)
  } finally {
    patchState(collectionId, { refreshing: false })
  }
}

async function loadMergedBundleIntoCollections(detailLevel: StationFetchDetailLevel): Promise<boolean> {
  if (!isStationCdnEnabled()) return false

  const existing = inflightMergedBundleLoads.get(detailLevel)
  if (existing) return existing

  const task = (async () => {
    try {
      const manifest = await fetchStationsCdnManifest()
      if (!manifest?.bundles.all) return false

      const merged = await fetchMergedNetworkStationsFromCdn(detailLevel, manifest)
      if (merged.length === 0) return false

      const grouped = splitMergedStationsByCollection(merged)
      const fetchedAt = Date.now()
      let loadedCollections = 0

      for (const collectionId of NETWORK_COLLECTION_IDS) {
        const stations = grouped.get(collectionId) ?? []
        if (stations.length === 0) continue
        loadedCollections += 1

        if (detailLevel === 'full') {
          patchState(collectionId, {
            full: stations,
            list: stations,
            lean: stations.map(toMapLeanStation),
            fetchedAt,
            error: null,
          })
        } else if (detailLevel === 'list') {
          patchListCollectionState(collectionId, stations, fetchedAt)
        } else {
          patchState(collectionId, {
            lean: stations,
            fetchedAt,
            error: null,
          })
        }
      }

      if (loadedCollections === 0) return false

      if (detailLevel !== 'lean') {
        await Promise.all(
          NETWORK_COLLECTION_IDS.map(async (collectionId) => {
            const stations = grouped.get(collectionId) ?? []
            if (stations.length === 0) return
            await writeStationsToIndexedDb(collectionId, stations, fetchedAt, manifest.version)
          })
        )
      }

      await writeManifestVersionToIndexedDb(manifest.version)
      return true
    } catch (error) {
      console.warn('Failed to load merged CDN station bundle:', error)
      return false
    }
  })()

  inflightMergedBundleLoads.set(detailLevel, task)
  try {
    return await task
  } finally {
    inflightMergedBundleLoads.delete(detailLevel)
  }
}

export function getCollectionStations(
  collectionId: StationCollectionId,
  detailLevel: StationFetchDetailLevel = 'full'
): Station[] {
  return resolveCollectionStations(getState(collectionId), detailLevel)
}

export function isCollectionLoading(collectionId: StationCollectionId): boolean {
  return getState(collectionId).loading
}

export function isCollectionRefreshing(collectionId: StationCollectionId): boolean {
  return getState(collectionId).refreshing
}

export function getCollectionError(collectionId: StationCollectionId): string | null {
  return getState(collectionId).error
}

export function getMergedNetworkStations(detailLevel: StationFetchDetailLevel = 'full'): Station[] {
  return mergeNetworkCollections(
    NETWORK_COLLECTION_IDS.map((collectionId) => ({
      collectionId,
      stations: getCollectionStations(collectionId, detailLevel),
    }))
  )
}

/** Prefer list rows for card/table locale fields; avoids stale lean rows cached in `full`. */
export function getMergedNetworkStationsForDisplay(): Station[] {
  const list = getMergedNetworkStations('list')
  if (list.length > 0) return list
  const full = getMergedNetworkStations('full')
  if (full.length > 0) return full
  return getMergedNetworkStations('lean')
}

/** Best available station rows for map side-panel detail (full, else list). */
export function getMergedNetworkStationDetails(): Station[] {
  const full = getMergedNetworkStations('full')
  if (full.length > 0) return full
  return getMergedNetworkStations('list')
}

export function buildMergedNetworkStationDetailIndex(): Map<string, Station> {
  return buildFullStationIndex(getMergedNetworkStationDetails())
}

export function resolveMapStationDetails(
  station: Station,
  detailByKey: Map<string, Station> = buildMergedNetworkStationDetailIndex()
): Station {
  const cached = detailByKey.get(getStationMapKey(station))
  if (cached) return cached

  const collectionId = getStationNetworkCollectionId(station)
  if (collectionId) {
    const fromStore = getFullStationById(station.id, collectionId)
    if (fromStore) return fromStore
  }

  return station
}

function mapStationDetailsFingerprint(station: Station): string {
  return [
    station.county ?? '',
    station.country ?? '',
    station.borough ?? '',
    station.province ?? '',
    station.tiploc ?? '',
    station.linesServed ?? '',
    station.yearlyPassengers ? 'p' : '',
  ].join('|')
}

export function mapStationDetailsUpgraded(before: Station, after: Station): boolean {
  return mapStationDetailsFingerprint(after) !== mapStationDetailsFingerprint(before)
}

export function hasUsableMapStationDetails(station: Station): boolean {
  const resolved = resolveMapStationDetails(station)
  if (mapStationDetailsUpgraded(station, resolved)) return true
  if (isLightRailStop(resolved)) {
    return Boolean(resolved.linesServed?.trim() || resolved.borough?.trim() || resolved.county?.trim())
  }
  return Boolean(
    resolved.county?.trim() ||
      resolved.country?.trim() ||
      resolved.borough?.trim() ||
      resolved.tiploc?.trim() ||
      resolved.yearlyPassengers
  )
}

export async function ensureMapStationDetailsLoaded(station: Station): Promise<void> {
  const collectionId = getStationNetworkCollectionId(station)
  if (!collectionId) return
  if (hasUsableMapStationDetails(station)) return

  await ensureCollectionLoaded(collectionId, { detailLevel: 'list', force: false })
  if (hasUsableMapStationDetails(station)) return

  await ensureCollectionLoaded(collectionId, { detailLevel: 'full', force: false })
}

export function isAnyNetworkCollectionLoading(): boolean {
  return NETWORK_COLLECTION_IDS.some((id) => getState(id).loading)
}

export function isAnyNetworkCollectionRefreshing(): boolean {
  return NETWORK_COLLECTION_IDS.some((id) => getState(id).refreshing)
}

export function hasAnyNetworkStations(detailLevel: StationFetchDetailLevel = 'full'): boolean {
  return NETWORK_COLLECTION_IDS.some((id) => getCollectionStations(id, detailLevel).length > 0)
}

async function hydrateFromIndexedDb(collectionId: StationCollectionId): Promise<boolean> {
  const entry = await readStationsFromIndexedDb(collectionId)
  if (!entry || entry.stations.length === 0) return false

  const missingPlatforms = lightRailStationsMissingPlatforms(entry.stations)
  patchState(collectionId, {
    // Avoid treating incomplete list-shaped SuperTram rows as full detail —
    // that blocked platform upgrades from the full CDN/Firestore payload.
    ...(missingPlatforms ? {} : { full: entry.stations }),
    list: entry.stations,
    lean: entry.stations.map(toMapLeanStation),
    fetchedAt: entry.fetchedAt,
    error: null,
  })
  maybeUpgradeLightRailListForPlatforms(collectionId, entry.stations)
  return true
}

async function persistCollection(
  collectionId: StationCollectionId,
  stations: Station[],
  detailLevel: StationFetchDetailLevel,
  manifestVersion: string | null = null,
  fetchedAt: number = Date.now()
): Promise<void> {
  if (detailLevel === 'full') {
    await writeStationsToIndexedDb(collectionId, stations, fetchedAt, manifestVersion)
    patchState(collectionId, {
      full: stations,
      list: stations,
      lean: stations.map(toMapLeanStation),
      fetchedAt,
      error: null,
    })
    return
  }

  if (detailLevel === 'list') {
    await writeStationsToIndexedDb(collectionId, stations, fetchedAt, manifestVersion)
    patchListCollectionState(collectionId, stations, fetchedAt)
    return
  }

  patchState(collectionId, {
    lean: stations,
    fetchedAt,
    error: null,
  })
}

export async function ensureCollectionLoaded(
  collectionId: StationCollectionId,
  options?: {
    detailLevel?: StationFetchDetailLevel
    force?: boolean
    preferCache?: boolean
  }
): Promise<void> {
  const detailLevel = options?.detailLevel ?? 'full'
  const force = options?.force ?? false
  const preferCache = options?.preferCache ?? true
  const key = inflightKey(collectionId, detailLevel, force)

  const existing = inflightLoads.get(key)
  if (existing) {
    await existing
    return
  }

  const task = (async () => {
    const state = getState(collectionId)
    const hasTargetData = hasLoadedDetailLevel(state, detailLevel)
    const hasFullData = state.full.length > 0
    const hasListData = state.list.length > 0
    const hadData = hasTargetData || hasFullData || hasListData

    if (preferCache && !force && !hadData) {
      const hydrated = await hydrateFromIndexedDb(collectionId)
      if (hydrated) {
        patchState(collectionId, { loading: false })
        const entry = await readStationsFromIndexedDb(collectionId)
        if (entry && isIndexedDbEntryFresh(entry, undefined, entry.manifestVersion ?? null)) {
          patchState(collectionId, { refreshing: true })
          void refreshCollectionIfStale(collectionId, detailLevel, entry)
          return
        }
        patchState(collectionId, { refreshing: true })
      }
    }

    const manifestVersion = await getActiveManifestVersion()

    if (
      !force &&
      detailLevel === 'lean' &&
      (hasFullData || hasListData) &&
      state.fetchedAt != null &&
      isIndexedDbEntryFresh(
        {
          collectionId,
          stations: state.full.length > 0 ? state.full : state.list,
          fetchedAt: state.fetchedAt,
          version: 1,
        },
        undefined,
        manifestVersion
      )
    ) {
      const source = state.full.length > 0 ? state.full : state.list
      patchState(collectionId, { lean: source.map(toMapLeanStation) })
      return
    }

    if (
      !force &&
      detailLevel === 'list' &&
      hasFullData &&
      state.fetchedAt != null &&
      isIndexedDbEntryFresh(
        {
          collectionId,
          stations: state.full,
          fetchedAt: state.fetchedAt,
          version: 1,
        },
        undefined,
        manifestVersion
      )
    ) {
      patchState(collectionId, { list: state.full })
      return
    }

    if (
      !force &&
      hasLoadedDetailLevel(state, detailLevel) &&
      state.fetchedAt != null &&
      isIndexedDbEntryFresh(
        {
          collectionId,
          stations: state.full.length > 0 ? state.full : state.list.length > 0 ? state.list : state.lean,
          fetchedAt: state.fetchedAt,
          version: 1,
        },
        undefined,
        manifestVersion
      )
    ) {
      return
    }

    const hadDataAfterChecks = hasTargetData || hasFullData || hasListData

    if (!hadDataAfterChecks) {
      patchState(collectionId, { loading: true, error: null })
    } else if (!force) {
      patchState(collectionId, { refreshing: true, error: null })
    }

    try {
      const stations = await fetchCollectionFromNetwork(collectionId, detailLevel, force)
      if (stations.length === 0) {
        throw new Error(`No data available for ${collectionId}`)
      }
      await persistCollection(collectionId, stations, detailLevel, manifestVersion)
    } catch (err) {
      if (!hadDataAfterChecks) {
        patchState(collectionId, {
          error: `Unable to fetch station data. (${getErrorMessage(err)})`,
        })
      }
      console.error(`Failed to load stations for ${collectionId}:`, err)
    } finally {
      patchState(collectionId, { loading: false, refreshing: false })
    }
  })()

  inflightLoads.set(key, task)
  try {
    await task
  } finally {
    inflightLoads.delete(key)
  }
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  let index = 0
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index]
      index += 1
      await worker(current)
    }
  })
  await Promise.all(runners)
}

export async function loadAllNetworkStationsProgressive(options?: {
  priorityCollectionId?: NetworkCollectionId
  detailLevel?: StationFetchDetailLevel
  force?: boolean
}): Promise<void> {
  const detailLevel = options?.detailLevel ?? 'full'
  const force = options?.force ?? false
  const priority = options?.priorityCollectionId ?? DEFAULT_NETWORK_COLLECTION_ID

  if (
    !force &&
    detailLevel === 'full' &&
    NETWORK_COLLECTION_IDS.every((id) => getCollectionStations(id, 'full').length > 0)
  ) {
    return
  }

  // Prefer per-collection progressive loads for list/lean so the priority network can paint
  // before downloading the merged all.*.json.gz bundle (~480 KiB). Use merged only for full.
  if (!force && isStationCdnEnabled() && detailLevel === 'full') {
    const loadedMerged = await loadMergedBundleIntoCollections(detailLevel)
    if (loadedMerged) return
  }

  const ordered: NetworkCollectionId[] = [
    priority,
    ...NETWORK_COLLECTION_IDS.filter((id) => id !== priority),
  ]

  await ensureCollectionLoaded(priority, { detailLevel, force })

  const remaining = ordered.slice(1)
  await runWithConcurrency(remaining, getFetchConcurrency(), async (collectionId) => {
    await ensureCollectionLoaded(collectionId, { detailLevel, force: false })
  })
}

export async function bootstrapStationsData(options: {
  networkView: NetworkViewFilter
  detailLevel?: StationFetchDetailLevel
  force?: boolean
  /** When true, only load the priority network — skip background progressive loads. */
  priorityOnly?: boolean
}): Promise<void> {
  const { networkView, detailLevel = 'list', force = false, priorityOnly = false } = options

  if (process.env.NEXT_PUBLIC_USE_LOCAL_DATA_ONLY === 'true') {
    const localStations = await fetchLocalStations()
    if (localStations.length > 0) {
      patchState(DEFAULT_NETWORK_COLLECTION_ID, {
        full: localStations,
        list: localStations,
        lean: localStations.map(toMapLeanStation),
        loading: false,
        refreshing: false,
        fetchedAt: Date.now(),
        error: null,
      })
    } else {
      patchState(DEFAULT_NETWORK_COLLECTION_ID, {
        error: 'No local data. Add public/data/stations.json or set NEXT_PUBLIC_USE_LOCAL_DATA_ONLY=false.',
        loading: false,
        refreshing: false,
      })
    }
    return
  }

  if (!force) {
    await hydrateAllNetworkCollectionsFromIndexedDb()
  }

  if (networkView !== 'all') {
    await ensureCollectionLoaded(networkView, { detailLevel, force })
    if (!priorityOnly) {
      void loadAllNetworkStationsProgressive({
        priorityCollectionId: networkView,
        detailLevel,
        force: false,
      })
    }
    return
  }

  if (priorityOnly) {
    await ensureCollectionLoaded(DEFAULT_NETWORK_COLLECTION_ID, { detailLevel, force })
    return
  }

  // Load the default network first so the UI can paint; remaining networks continue
  // in the background. Waiting on every collection here kept initialSyncPending (and
  // the page skeleton) stuck on refresh even after IndexedDB already had rows.
  await ensureCollectionLoaded(DEFAULT_NETWORK_COLLECTION_ID, { detailLevel, force })
  void loadAllNetworkStationsProgressive({
    priorityCollectionId: DEFAULT_NETWORK_COLLECTION_ID,
    detailLevel,
    force: false,
  })
}

export function invalidateStationsCache(): void {
  collectionState.clear()
  inflightLoads.clear()
  inflightMergedBundleLoads.clear()
  lightRailPlatformsUpgradeAttempted.clear()
  invalidateStationsCdnManifestCache()
  beginStationsInitialSync()
  notify()
}

export function getFullStationById(
  stationId: string,
  collectionId?: StationCollectionId | null
): Station | null {
  const searchOrder: StationCollectionId[] = collectionId
    ? [collectionId]
    : [...NETWORK_COLLECTION_IDS]

  for (const id of searchOrder) {
    const state = getState(id)
    const match =
      state.full.find((station) => station.id === stationId) ??
      state.list.find((station) => station.id === stationId)
    if (match) return match
  }
  return null
}
