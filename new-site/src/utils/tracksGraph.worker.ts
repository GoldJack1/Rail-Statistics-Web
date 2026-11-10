import { followRailway } from './followRailway'
import {
  buildRailGraph,
  linesFromNetwork,
  RAIL_GRAPH_REVISION,
  routeOnGraph,
  type RailGraph,
} from './tracksRailGraph'
import type { LatLngTuple } from './brouterRailRoute'

type StoredGraph = {
  lons: Float64Array
  lats: Float64Array
  adjStart: Uint32Array
  adjTo: Int32Array
  adjD: Float32Array
  adjH: Int16Array
  adjWeld: Uint8Array
  snap: Array<[number, number[]]>
}

type RouteRequest = {
  type: 'route'
  id: number
  from: { lat: number; lng: number }
  to: { lat: number; lng: number }
}

type FollowRequest = {
  type: 'follow'
  id: number
  path: LatLngTuple[]
}

type GraphRequest = RouteRequest | FollowRequest

let graph: RailGraph | null = null
const pending: GraphRequest[] = []

function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open('rs-rail-graph', 1)
    opening.onupgradeneeded = () => {
      if (!opening.result.objectStoreNames.contains('graphs')) opening.result.createObjectStore('graphs')
    }
    opening.onerror = () => reject(opening.error)
    opening.onsuccess = () => {
      const store = opening.result.transaction('graphs', mode).objectStore('graphs')
      run(store).then(resolve, reject)
    }
  })
}

function readCache(): Promise<RailGraph | null> {
  return withStore('readonly', (store) => new Promise((resolve, reject) => {
    const request = store.get(RAIL_GRAPH_REVISION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const row = request.result as StoredGraph | undefined
      if (!row?.lons || !row.adjTo) {
        resolve(null)
        return
      }
      const snap = new Map<number, number[]>()
      for (const [key, ids] of row.snap) snap.set(key, ids)
      resolve({ ...row, snap })
    }
  }))
}

function writeCache(built: RailGraph): Promise<void> {
  const snap: Array<[number, number[]]> = []
  built.snap.forEach((ids, key) => snap.push([key, ids]))
  return withStore('readwrite', (store) => new Promise((resolve, reject) => {
    const request = store.put({ ...built, snap }, RAIL_GRAPH_REVISION)
    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve()
  }))
}

function answer(message: GraphRequest) {
  if (message.type === 'follow') {
    const path = graph
      ? followRailway(message.path, (from, to) =>
          routeOnGraph(graph as RailGraph, { lat: from[0], lng: from[1] }, { lat: to[0], lng: to[1] }),
        )
      : message.path
    self.postMessage({ type: 'route', id: message.id, path })
    return
  }
  const path = graph ? routeOnGraph(graph, message.from, message.to) : null
  self.postMessage({ type: 'route', id: message.id, path })
}

function flushPending() {
  const queued = pending.splice(0)
  for (const message of queued) answer(message)
}

self.onmessage = (event: MessageEvent<GraphRequest>) => {
  if (graph) answer(event.data)
  else pending.push(event.data)
}

async function main() {
  try {
    graph = await readCache()
  } catch {
    graph = null
  }
  if (!graph) {
    const response = await fetch(`/data/gb-passenger-rail.json?v=${RAIL_GRAPH_REVISION}`, { cache: 'no-store' })
    if (!response.ok) {
      self.postMessage({ type: 'ready', ok: false })
      flushPending()
      return
    }
    const lines = linesFromNetwork(await response.json())
    graph = lines.length > 0 ? buildRailGraph(lines) : null
    if (graph) void writeCache(graph).catch(() => {})
  }
  self.postMessage({ type: 'ready', ok: graph != null })
  flushPending()
}

void main().catch(() => {
  self.postMessage({ type: 'ready', ok: false })
  flushPending()
})
