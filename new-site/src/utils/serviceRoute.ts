import type { LatLngTuple } from './brouterRailRoute'
import { resolveDarwinBrowserUrl } from './darwinReadyFetch'
import type { RoutePlatform } from './serviceJourneyMap'
import { isValidStationCoordinate } from './stationCoordinates'

/**
 * The rail-map line for one service, as the query service draws it. The
 * platform rules, the road through each station and the line itself are all
 * decided there, so the site and the app show the same route.
 */
export type ServiceRoute = {
  path: LatLngTuple[] | null
  /** False for the first answer, before a point on the wrong track is corrected. */
  complete: boolean
  /** The platform a routing rule booked, by stop index. */
  booked: Record<string, string>
  /** Where each booked platform sits, by stop index. */
  platforms: Record<string, RoutePlatform>
  /** The point each call and pass is routed through, by stop index. */
  marks: Record<string, { lat: number; lng: number }>
}

export const NO_SERVICE_ROUTE: ServiceRoute = { path: null, complete: false, booked: {}, platforms: {}, marks: {} }

function readPair(value: unknown): { lat: number; lng: number } | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const lat = Number(value[0])
  const lng = Number(value[1])
  return isValidStationCoordinate(lat, lng) ? { lat, lng } : null
}

function readPlatform(value: unknown): RoutePlatform | null {
  if (!value || typeof value !== 'object') return null
  const row = value as { lat?: unknown; lng?: unknown; ends?: unknown; bay?: unknown; stand?: unknown; guess?: unknown }
  const lat = Number(row.lat)
  const lng = Number(row.lng)
  if (!isValidStationCoordinate(lat, lng)) return null
  const place: RoutePlatform = { lat, lng }
  if (Array.isArray(row.ends) && row.ends.length >= 2) {
    const first = readPair(row.ends[0])
    const second = readPair(row.ends[1])
    if (first && second) place.ends = [first, second]
  }
  const bay = readPair(row.bay)
  if (bay) place.bay = bay
  const stand = readPair(row.stand)
  if (stand) place.stand = stand
  if (row.guess === true) place.guess = true
  return place
}

function entries(value: unknown): [string, unknown][] {
  return value && typeof value === 'object' ? Object.entries(value as Record<string, unknown>) : []
}

export function readServiceRoute(payload: unknown): ServiceRoute | null {
  if (!payload || typeof payload !== 'object') return null
  const doc = payload as Record<string, unknown>
  let path: LatLngTuple[] | null = null
  if (Array.isArray(doc.path)) {
    path = []
    for (const pair of doc.path) {
      const point = readPair(pair)
      if (!point) return null
      path.push([point.lat, point.lng])
    }
    if (path.length < 2) path = null
  }
  const booked: Record<string, string> = {}
  for (const [id, platform] of entries(doc.booked)) {
    if (typeof platform === 'string' && platform) booked[id] = platform
  }
  const platforms: Record<string, RoutePlatform> = {}
  for (const [id, value] of entries(doc.platforms)) {
    const place = readPlatform(value)
    if (place) platforms[id] = place
  }
  const marks: Record<string, { lat: number; lng: number }> = {}
  for (const [id, value] of entries(doc.marks)) {
    const point = readPair(value)
    if (point) marks[id] = point
  }
  return { path, complete: doc.complete !== false, booked, platforms, marks }
}

/** The query service holds an unfinished request for about six seconds, so a retry only re-joins the same job. */
const RETRY_MS = 250
/** A line that is still not drawn after this long is given up on. */
const GIVE_UP_MS = 90_000
/** Network errors and server errors are tried again this many times before a miss. */
const MAX_FAILURES = 3
const CLIENT_CACHE_MS = 10 * 60 * 1000
const CLIENT_CACHE_MAX = 40

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve()
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

/**
 * `request` is the JSON body: the service's operator and its placed timing
 * points. A long line takes the query service a while the first time, and it
 * answers `pending` until the line is ready, so the request is sent again.
 * A dropped connection or a server error is tried again a few times, so one
 * bad reply does not leave the map without a line.
 * `onFirst` is given the first line while the corrected one is still coming.
 * Null on a miss.
 */
export async function fetchServiceRoute(
  request: string,
  draft: boolean,
  signal: AbortSignal,
  onFirst?: (route: ServiceRoute) => void,
): Promise<ServiceRoute | null> {
  const body = draft ? `${request.slice(0, -1)},"draft":true}` : request
  const deadline = Date.now() + GIVE_UP_MS
  let failures = 0
  while (Date.now() < deadline) {
    if (signal.aborted) return null
    let payload: unknown = null
    let failed = false
    try {
      const response = await fetch(resolveDarwinBrowserUrl('/api/darwin/service-route'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body,
        signal,
        cache: 'no-store',
      })
      // The proxy in front of the query service gives up on a slow answer. The line is still being drawn.
      if (response.status === 504 || response.status === 502) payload = { pending: true }
      else if (response.status === 429 || response.status === 503 || response.status >= 500) failed = true
      else if (!response.ok) return null
      else payload = await response.json()
    } catch {
      if (signal.aborted) return null
      failed = true
    }
    if (failed) {
      failures += 1
      if (failures >= MAX_FAILURES) return null
      await pause(500 * 2 ** (failures - 1), signal)
      continue
    }
    if (!(payload as { pending?: unknown } | null)?.pending) return readServiceRoute(payload)
    const first = readServiceRoute(payload)
    if (first?.path) onFirst?.({ ...first, complete: false })
    await pause(RETRY_MS, signal)
  }
  return null
}

type RouteListener = (route: ServiceRoute | null, final: boolean) => void

type RouteJob = {
  at: number
  first: ServiceRoute | null
  /** undefined while the corrected line is still coming; null on a miss. */
  full: ServiceRoute | null | undefined
  listeners: Set<RouteListener>
}

const jobs = new Map<string, RouteJob>()

function startJob(request: string): RouteJob {
  const job: RouteJob = { at: Date.now(), first: null, full: undefined, listeners: new Set() }
  const controller = new AbortController()
  const emit = (route: ServiceRoute | null, final: boolean) => {
    for (const listener of [...job.listeners]) listener(route, final)
  }
  const early = (route: ServiceRoute) => {
    if (job.full !== undefined || !route.path) return
    job.first = route
    emit(route, false)
  }
  // The job belongs to the request, not to the page that asked first, so a line
  // started while the calling pattern is open is ready when the map is.
  void fetchServiceRoute(request, true, controller.signal).then((first) => {
    if (first) early(first)
  })
  void fetchServiceRoute(request, false, controller.signal, early).then((full) => {
    job.full = full ?? null
    // A miss is not kept, so the next visit asks again. The first line stays on screen.
    if (!full?.path) jobs.delete(request)
    emit(job.full, true)
  })
  jobs.set(request, job)
  if (jobs.size > CLIENT_CACHE_MAX) jobs.delete(jobs.keys().next().value as string)
  return job
}

function jobFor(request: string): RouteJob {
  const kept = jobs.get(request)
  if (kept && Date.now() - kept.at < CLIENT_CACHE_MS) return kept
  return startJob(request)
}

/** Starts drawing a line now, with nobody waiting for it yet. */
export function warmServiceRoute(request: string): void {
  jobFor(request)
}

/**
 * Follows the line for one request. The current state is given at once, then
 * each update. `final` is the corrected line, or null on a miss.
 * Returns the function that stops listening.
 */
export function watchServiceRoute(request: string, listener: RouteListener): () => void {
  const job = jobFor(request)
  job.listeners.add(listener)
  if (job.full !== undefined) listener(job.full, true)
  else if (job.first) listener(job.first, false)
  return () => {
    job.listeners.delete(listener)
  }
}
