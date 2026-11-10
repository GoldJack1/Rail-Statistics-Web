import { followRailway } from './followRailway'
import { buildRailGraph, linesFromNetwork, RAIL_GRAPH_REVISION, routeOnGraph } from './tracksRailGraph'
import type { LatLngTuple } from './brouterRailRoute'

type ReadyMessage = { type: 'ready'; ok: boolean }
type RouteMessage = { type: 'route'; id: number; path: LatLngTuple[] | null }

type Router = {
  route: (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    signal: AbortSignal,
  ) => Promise<LatLngTuple[] | null>
  follow: (path: LatLngTuple[], signal: AbortSignal) => Promise<LatLngTuple[] | null>
}

let routerPromise: Promise<Router | null> | null = null
let localGraph: Promise<Awaited<ReturnType<typeof buildRailGraph>> | null> | null = null

function graphOnThisThread() {
  if (!localGraph) {
    localGraph = fetch(`/data/gb-passenger-rail.json?v=${RAIL_GRAPH_REVISION}`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null
        const lines = linesFromNetwork(await response.json())
        if (lines.length < 1) return null
        return buildRailGraph(lines)
      })
      .catch(() => null)
  }
  return localGraph
}

function workerRouter(): Promise<Router | null> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./tracksGraph.worker.ts', import.meta.url))
    const pending = new Map<number, (path: LatLngTuple[] | null) => void>()
    let nextId = 1
    worker.onmessage = (event: MessageEvent<ReadyMessage | RouteMessage>) => {
      const message = event.data
      if (message.type === 'ready') {
        if (!message.ok) {
          worker.terminate()
          resolve(null)
          return
        }
        const ask = (body: Record<string, unknown>, signal: AbortSignal) =>
          new Promise<LatLngTuple[] | null>((done) => {
            if (signal.aborted) {
              done(null)
              return
            }
            const id = nextId++
            const finish = (path: LatLngTuple[] | null) => {
              signal.removeEventListener('abort', onAbort)
              done(signal.aborted ? null : path)
            }
            const onAbort = () => {
              pending.delete(id)
              finish(null)
            }
            pending.set(id, finish)
            signal.addEventListener('abort', onAbort, { once: true })
            worker.postMessage({ ...body, id })
          })
        resolve({
          route: (from, to, signal) => ask({ type: 'route', from, to }, signal),
          follow: (path, signal) => ask({ type: 'follow', path }, signal),
        })
        return
      }
      pending.get(message.id)?.(message.path)
      pending.delete(message.id)
    }
    worker.onerror = () => {
      worker.terminate()
      reject(new Error('rail graph worker failed'))
    }
  })
}

function ensureRouter(): Promise<Router | null> {
  if (!routerPromise) {
    routerPromise = (typeof Worker === 'undefined' ? Promise.resolve(null) : workerRouter()).catch(() => null)
  }
  return routerPromise
}

/** Starts the network early. The map can draw while it is still being built. */
export function loadGbRailGraph(): Promise<void> {
  return ensureRouter().then(() => undefined)
}

/** Long straights in a routed line are redrawn along the railway. */
export async function followGbRoute(
  path: LatLngTuple[],
  signal: AbortSignal,
): Promise<LatLngTuple[] | null> {
  const router = await ensureRouter()
  if (signal.aborted) return null
  if (router) return router.follow(path, signal)
  const graph = await graphOnThisThread()
  if (signal.aborted || !graph) return null
  return followRailway(path, (from, to) =>
    routeOnGraph(graph, { lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] }),
  )
}

/** One leg, searched off the page thread. A failed worker searches here instead. */
export async function routeGbLeg(
  from: LatLngTuple,
  to: LatLngTuple,
  signal: AbortSignal,
): Promise<LatLngTuple[] | null> {
  const ends = { from: { lat: from[0], lng: from[1] }, to: { lat: to[0], lng: to[1] } }
  const router = await ensureRouter()
  if (signal.aborted) return null
  if (router) return router.route(ends.from, ends.to, signal)
  const graph = await graphOnThisThread()
  if (signal.aborted || !graph) return null
  return routeOnGraph(graph, ends.from, ends.to)
}
