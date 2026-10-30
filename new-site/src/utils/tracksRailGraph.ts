import type { LatLngTuple } from './brouterRailRoute'

/** About 12 m. Close enough to weld a shared junction, fine enough to keep a curve. */
const GRAPH_CELL = 0.00012
const DENSIFY_M = 60
const WELD_M = 200
/** Buckets for finding a line end's neighbour. About 200 m. */
const WELD_CELL = 0.002
const SNAP_MAX_M = 1500
const REVERSAL_PENALTY_M = 10_000
/** 150 degrees, in the heading units below. */
const TURN_SHARP = 26_180
const HEADING_PI = 31_416
const NO_HEADING = 32_767

export type LngLat = [number, number]

export type RailGraph = {
  lons: Float64Array
  lats: Float64Array
  adjStart: Uint32Array
  adjTo: Int32Array
  adjD: Float32Array
  adjH: Int16Array
  /** 1 when the link is a weld. A weld keeps the heading the train already had. */
  adjWeld: Uint8Array
  snap: Map<number, number[]>
}

type Point = { lon: number; lat: number }

function metres(a: Point, b: Point): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLon = (b.lon - a.lon) * rad
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2
  return 12_742_000 * Math.asin(Math.min(1, Math.sqrt(x)))
}

function heading(a: Point, b: Point): number {
  const dx = (b.lon - a.lon) * Math.cos(((a.lat + b.lat) * Math.PI) / 360)
  return Math.round(Math.atan2(b.lat - a.lat, dx) * 10_000)
}

function reverseHeading(h: number): number {
  return h > 0 ? h - HEADING_PI : h + HEADING_PI
}

function sharpTurn(hIn: number, hOut: number): boolean {
  let d = Math.abs(hIn - hOut)
  if (d > HEADING_PI) d = HEADING_PI * 2 - d
  return d > TURN_SHARP
}

function nodeKey(gx: number, gy: number): number {
  return gx * 1_000_000 + gy
}

function snapKey(cx: number, cy: number): number {
  return cx * 100_000 + cy
}

function densify(line: LngLat[]): Point[] {
  if (line.length === 0) return []
  const pts: Point[] = [{ lon: line[0][0], lat: line[0][1] }]
  for (let i = 1; i < line.length; i++) {
    const a = pts[pts.length - 1]
    const b = { lon: line[i][0], lat: line[i][1] }
    const n = Math.floor(metres(a, b) / DENSIFY_M)
    for (let k = 1; k <= n; k++) {
      pts.push({
        lon: a.lon + ((b.lon - a.lon) * k) / (n + 1),
        lat: a.lat + ((b.lat - a.lat) * k) / (n + 1),
      })
    }
    pts.push(b)
  }
  return pts
}

/**
 * Passenger-rail lines become one network. Shared cells meet, long edges are
 * split, and ends within 200 m are welded so a corridor join stays routable.
 */
export function buildRailGraph(lines: LngLat[][]): RailGraph {
  const index = new Map<number, number>()
  const lons: number[] = []
  const lats: number[] = []
  const nodeAt = (p: Point): number => {
    const gx = Math.round(p.lon / GRAPH_CELL)
    const gy = Math.round(p.lat / GRAPH_CELL)
    const key = nodeKey(gx, gy)
    const existing = index.get(key)
    if (existing !== undefined) return existing
    const id = lons.length
    index.set(key, id)
    lons.push(p.lon)
    lats.push(p.lat)
    return id
  }

  const linkA: number[] = []
  const linkB: number[] = []
  const linkD: number[] = []
  const linked = new Set<string>()
  const addLink = (a: number, b: number, d: number) => {
    if (a === b) return
    const key = a < b ? `${a}:${b}` : `${b}:${a}`
    if (linked.has(key)) return
    linked.add(key)
    linkA.push(a)
    linkB.push(b)
    linkD.push(d)
  }

  for (const line of lines) {
    const pts = densify(line)
    let prev = -1
    for (const pt of pts) {
      if (!Number.isFinite(pt.lon) || !Number.isFinite(pt.lat)) continue
      const id = nodeAt(pt)
      if (prev !== -1) {
        addLink(prev, id, metres({ lon: lons[prev], lat: lats[prev] }, { lon: lons[id], lat: lats[id] }))
      }
      prev = id
    }
  }

  const degree = new Uint16Array(lons.length)
  for (let i = 0; i < linkA.length; i++) {
    degree[linkA[i]]++
    degree[linkB[i]]++
  }
  const buckets = new Map<number, number[]>()
  for (let id = 0; id < lons.length; id++) {
    const key = nodeKey(Math.round(lons[id] / WELD_CELL), Math.round(lats[id] / WELD_CELL))
    const bucket = buckets.get(key)
    if (bucket) bucket.push(id)
    else buckets.set(key, [id])
  }

  const lineCount = linkA.length
  for (let id = 0; id < lons.length; id++) {
    if (degree[id] !== 1) continue
    const cx = Math.round(lons[id] / WELD_CELL)
    const cy = Math.round(lats[id] / WELD_CELL)
    const here = { lon: lons[id], lat: lats[id] }
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const ids = buckets.get(nodeKey(cx + dx, cy + dy))
        if (!ids) continue
        for (const other of ids) {
          if (other === id) continue
          const d = metres(here, { lon: lons[other], lat: lats[other] })
          if (d < WELD_M) addLink(id, other, d)
        }
      }
    }
  }

  const weldFrom = lineCount
  const links = linkA.length
  const nodeCount = lons.length
  const adjStart = new Uint32Array(nodeCount + 1)
  for (let i = 0; i < links; i++) {
    adjStart[linkA[i] + 1]++
    adjStart[linkB[i] + 1]++
  }
  for (let v = 0; v < nodeCount; v++) adjStart[v + 1] += adjStart[v]
  const cursor = adjStart.slice(0, nodeCount)
  const adjTo = new Int32Array(links * 2)
  const adjD = new Float32Array(links * 2)
  const adjH = new Int16Array(links * 2)
  const adjWeld = new Uint8Array(links * 2)
  for (let i = 0; i < links; i++) {
    const a = linkA[i]
    const b = linkB[i]
    const h = heading({ lon: lons[a], lat: lats[a] }, { lon: lons[b], lat: lats[b] })
    const weld = i >= weldFrom ? 1 : 0
    let k = cursor[a]++
    adjTo[k] = b
    adjD[k] = linkD[i]
    adjH[k] = h
    adjWeld[k] = weld
    k = cursor[b]++
    adjTo[k] = a
    adjD[k] = linkD[i]
    adjH[k] = reverseHeading(h)
    adjWeld[k] = weld
  }

  const snap = new Map<number, number[]>()
  for (let id = 0; id < nodeCount; id++) {
    const cell = snapKey(Math.round(lons[id] / 0.01), Math.round(lats[id] / 0.01))
    const bucket = snap.get(cell)
    if (bucket) bucket.push(id)
    else snap.set(cell, [id])
  }

  return {
    lons: Float64Array.from(lons),
    lats: Float64Array.from(lats),
    adjStart,
    adjTo,
    adjD,
    adjH,
    adjWeld,
    snap,
  }
}

function snapToGraph(graph: RailGraph, lon: number, lat: number): number | null {
  const cx = Math.round(lon / 0.01)
  const cy = Math.round(lat / 0.01)
  let best: number | null = null
  let bestD = SNAP_MAX_M
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const ids = graph.snap.get(snapKey(cx + dx, cy + dy))
      if (!ids) continue
      for (const id of ids) {
        const d = metres({ lon, lat }, { lon: graph.lons[id], lat: graph.lats[id] })
        if (d < bestD) {
          bestD = d
          best = id
        }
      }
    }
  }
  return best
}

function heapPush(key: number[], val: number[], d: number, k: number) {
  let i = key.length
  key.push(d)
  val.push(k)
  while (i > 0) {
    const p = (i - 1) >> 1
    if (key[p] <= d) break
    key[i] = key[p]
    val[i] = val[p]
    i = p
  }
  key[i] = d
  val[i] = k
}

function heapPop(key: number[], val: number[]): { id: number; score: number } | null {
  if (key.length === 0) return null
  const top = val[0]
  const score = key[0]
  const d = key.pop() as number
  const k = val.pop() as number
  if (key.length > 0) {
    let i = 0
    for (;;) {
      const left = 2 * i + 1
      const right = left + 1
      let m = left
      if (left >= key.length) break
      if (right < key.length && key[right] < key[left]) m = right
      if (key[m] >= d) break
      key[i] = key[m]
      val[i] = val[m]
      i = m
    }
    key[i] = d
    val[i] = k
  }
  return { id: top, score }
}

/**
 * Shortest rail path. A turn sharper than about 150 degrees costs 10 km, so a
 * parallel-track out-and-back stops being free. A terminus with no other way
 * still reverses.
 */
export function routeOnGraph(
  graph: RailGraph,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): LatLngTuple[] | null {
  const src = snapToGraph(graph, from.lng, from.lat)
  const dst = snapToGraph(graph, to.lng, to.lat)
  if (src == null || dst == null) return null
  if (src === dst) return [
    [graph.lats[src], graph.lons[src]],
    [graph.lats[dst], graph.lons[dst]],
  ]

  const { lons, lats, adjStart, adjTo, adjD, adjH, adjWeld } = graph
  const linkCount = adjTo.length
  const cost = new Float64Array(linkCount)
  cost.fill(Infinity)
  const prev = new Int32Array(linkCount)
  prev.fill(-1)
  const head = new Int16Array(linkCount)
  const goal = { lon: lons[dst], lat: lats[dst] }
  const est = (id: number) => metres({ lon: lons[id], lat: lats[id] }, goal)
  const chord = metres({ lon: from.lng, lat: from.lat }, { lon: to.lng, lat: to.lat })
  const limit = chord * 3 + REVERSAL_PENALTY_M + 20_000

  const heapKey: number[] = []
  const heapVal: number[] = []
  const relax = (k: number, d: number, fromLink: number, h: number) => {
    const weld = adjWeld[k] === 1
    let nd = d + adjD[k]
    if (!weld && h !== NO_HEADING && sharpTurn(h, adjH[k])) nd += REVERSAL_PENALTY_M
    if (nd >= cost[k]) return
    cost[k] = nd
    prev[k] = fromLink
    head[k] = weld ? h : adjH[k]
    heapPush(heapKey, heapVal, nd + est(adjTo[k]), k)
  }
  for (let k = adjStart[src]; k < adjStart[src + 1]; k++) relax(k, 0, -1, NO_HEADING)

  let last = -1
  while (heapKey.length) {
    const popped = heapPop(heapKey, heapVal)
    if (!popped) break
    const u = adjTo[popped.id]
    const d = cost[popped.id]
    if (popped.score > d + est(u)) continue
    if (popped.score > limit) break
    if (u === dst) {
      last = popped.id
      break
    }
    for (let k = adjStart[u]; k < adjStart[u + 1]; k++) relax(k, d, popped.id, head[popped.id])
  }
  if (last < 0) return null

  const ids: number[] = []
  for (let s = last; s >= 0; s = prev[s]) ids.push(adjTo[s])
  ids.push(src)
  ids.reverse()
  const path: LatLngTuple[] = ids.map((id) => [lats[id], lons[id]])
  return path.length >= 2 ? path : null
}

export function linesFromNetwork(payload: unknown): LngLat[][] {
  if (!payload || typeof payload !== 'object') return []
  const lines = (payload as { lines?: unknown }).lines
  if (!Array.isArray(lines)) return []
  const out: LngLat[][] = []
  for (const line of lines) {
    if (!Array.isArray(line) || line.length < 2) continue
    const coords: LngLat[] = []
    for (const pair of line) {
      if (!Array.isArray(pair) || pair.length < 2) continue
      const lon = Number(pair[0])
      const lat = Number(pair[1])
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue
      coords.push([lon, lat])
    }
    if (coords.length >= 2) out.push(coords)
  }
  return out
}

let graphPromise: Promise<RailGraph | null> | null = null

/** One shared graph for every service page. A missing file routes each leg elsewhere. */
export function loadGbRailGraph(): Promise<RailGraph | null> {
  if (!graphPromise) {
    graphPromise = fetch('/data/gb-passenger-rail.json')
      .then(async (response) => {
        if (!response.ok) return null
        const lines = linesFromNetwork(await response.json())
        if (lines.length < 1) return null
        return buildRailGraph(lines)
      })
      .catch(() => null)
  }
  return graphPromise
}
