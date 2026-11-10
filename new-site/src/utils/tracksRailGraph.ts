import type { LatLngTuple } from './brouterRailRoute'

/** About 12 m. Close enough to weld a shared junction, fine enough to keep a curve. */
const GRAPH_CELL = 0.00012
const DENSIFY_M = 60
const WELD_M = 200
/** Buckets for finding a line end's neighbour. About 200 m. */
const WELD_CELL = 0.002
/** About 55 m. A step from one running line to the line beside it. */
const CORRIDOR_M = 55
const CORRIDOR_CELL = 0.0008
/** 25 degrees. The two lines are the same corridor, not a flyover. */
const PARALLEL_AXIS = 4_360
/** 50 degrees. The step runs across the tracks, not along them. */
const LATERAL_MIN = 8_720
/** A loose end may join the rail ahead of it, not every node in a 200 m circle. */
const WELD_AHEAD = 8_720
const SNAP_MAX_M = 1500
/** Nodes closer than this are the same snap. The next one is another line. */
const SNAP_SPREAD_M = 120
/** One snap for each direction away from the pin, so one line cannot fill the list. */
const SNAP_BUCKETS = 12
const SNAP_CHOICES = 8
/**
 * A pin on one line at a crossing can sit nearer the other line. Leave the
 * nearest line only when the other one saves a real detour, not a station loop.
 */
const LINE_SWITCH_M = 8_000
const REVERSAL_PENALTY_M = 10_000
/** 150 degrees, in the heading units below. */
const TURN_SHARP = 26_180
const HEADING_PI = 31_416
const NO_HEADING = 32_767

/** Bump when the graph's shape changes, so a saved copy is rebuilt. */
export const RAIL_GRAPH_REVISION = 4

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

function angleBetween(hIn: number, hOut: number): number {
  let d = Math.abs(hIn - hOut)
  if (d > HEADING_PI) d = HEADING_PI * 2 - d
  return d
}

function sharpTurn(hIn: number, hOut: number): boolean {
  return angleBetween(hIn, hOut) > TURN_SHARP
}

/** Same track or the opposite direction on it. */
function sameAxis(hIn: number, hOut: number): boolean {
  const d = angleBetween(hIn, hOut)
  return d < PARALLEL_AXIS || d > HEADING_PI - PARALLEL_AXIS
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
 * split, and a loose end welds once, onward along its own heading.
 * Tracks that run side by side are stepped across, so a parallel pair in
 * London does not send the train out via the tube.
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
  const onlyNeigh = new Int32Array(lons.length)
  onlyNeigh.fill(-1)
  for (let i = 0; i < lineCount; i++) {
    onlyNeigh[linkA[i]] = linkB[i]
    onlyNeigh[linkB[i]] = linkA[i]
  }
  for (let id = 0; id < lons.length; id++) {
    if (degree[id] !== 1) continue
    const prev = onlyNeigh[id]
    if (prev < 0) continue
    const here = { lon: lons[id], lat: lats[id] }
    const forward = heading({ lon: lons[prev], lat: lats[prev] }, here)
    const cx = Math.round(lons[id] / WELD_CELL)
    const cy = Math.round(lats[id] / WELD_CELL)
    let best = -1
    let bestD = WELD_M
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const ids = buckets.get(nodeKey(cx + dx, cy + dy))
        if (!ids) continue
        for (const other of ids) {
          if (other === id || other === prev) continue
          const there = { lon: lons[other], lat: lats[other] }
          const d = metres(here, there)
          if (d >= bestD) continue
          if (angleBetween(forward, heading(here, there)) > WELD_AHEAD) continue
          best = other
          bestD = d
        }
      }
    }
    if (best >= 0) addLink(id, best, bestD)
  }

  // A fast line and the slow line beside it often never share a node. The
  // only other join can be a flyover or the tube corridor, and the route
  // leaves the railway it is on. Each point steps to the nearest parallel
  // line. A bridge crosses on a different heading, so it stays unconnected.
  const head0 = new Int16Array(lons.length)
  const head1 = new Int16Array(lons.length)
  head0.fill(NO_HEADING)
  head1.fill(NO_HEADING)
  const remember = (id: number, h: number) => {
    if (head0[id] === NO_HEADING) head0[id] = h
    else if (head1[id] === NO_HEADING && !sameAxis(head0[id], h)) head1[id] = h
  }
  for (let i = 0; i < lineCount; i++) {
    const h = heading(
      { lon: lons[linkA[i]], lat: lats[linkA[i]] },
      { lon: lons[linkB[i]], lat: lats[linkB[i]] },
    )
    remember(linkA[i], h)
    remember(linkB[i], reverseHeading(h))
  }
  const headsOf = (id: number): number[] => {
    if (head0[id] === NO_HEADING) return []
    return head1[id] === NO_HEADING ? [head0[id]] : [head0[id], head1[id]]
  }
  const corridorBuckets = new Map<number, number[]>()
  for (let id = 0; id < lons.length; id++) {
    if (head0[id] === NO_HEADING) continue
    const key = nodeKey(Math.round(lons[id] / CORRIDOR_CELL), Math.round(lats[id] / CORRIDOR_CELL))
    const bucket = corridorBuckets.get(key)
    if (bucket) bucket.push(id)
    else corridorBuckets.set(key, [id])
  }
  for (let id = 0; id < lons.length; id++) {
    const mine = headsOf(id)
    if (mine.length === 0) continue
    const cx = Math.round(lons[id] / CORRIDOR_CELL)
    const cy = Math.round(lats[id] / CORRIDOR_CELL)
    const here = { lon: lons[id], lat: lats[id] }
    let best = -1
    let bestD = CORRIDOR_M
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const ids = corridorBuckets.get(nodeKey(cx + dx, cy + dy))
        if (!ids) continue
        for (const other of ids) {
          if (other === id) continue
          const there = { lon: lons[other], lat: lats[other] }
          const d = metres(here, there)
          if (d >= bestD) continue
          const linkH = heading(here, there)
          const theirs = headsOf(other)
          let across = false
          for (const h1 of mine) {
            const acrossTrack = angleBetween(h1, linkH)
            if (acrossTrack < LATERAL_MIN || acrossTrack > HEADING_PI - LATERAL_MIN) continue
            for (const h2 of theirs) {
              if (sameAxis(h1, h2)) {
                across = true
                break
              }
            }
            if (across) break
          }
          if (!across) continue
          best = other
          bestD = d
        }
      }
    }
    if (best >= 0) addLink(id, best, bestD)
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

type SnapChoice = { id: number; d: number }

/** Nearest node, then other lines inside the snap radius, closest first. */
function snapChoices(graph: RailGraph, lon: number, lat: number): SnapChoice[] {
  const cx = Math.round(lon / 0.01)
  const cy = Math.round(lat / 0.01)
  const found: SnapChoice[] = []
  for (let dx = -2; dx <= 2; dx++) {
    for (let dy = -2; dy <= 2; dy++) {
      const ids = graph.snap.get(snapKey(cx + dx, cy + dy))
      if (!ids) continue
      for (const id of ids) {
        const d = metres({ lon, lat }, { lon: graph.lons[id], lat: graph.lats[id] })
        if (d < SNAP_MAX_M) found.push({ id, d })
      }
    }
  }
  found.sort((a, b) => a.d - b.d)
  const kept: SnapChoice[] = []
  const used = new Array<boolean>(SNAP_BUCKETS).fill(false)
  const cosLat = Math.cos((lat * Math.PI) / 180)
  for (const cand of found) {
    const here = { lon: graph.lons[cand.id], lat: graph.lats[cand.id] }
    const sameSpot = kept.some(
      (have) => metres(here, { lon: graph.lons[have.id], lat: graph.lats[have.id] }) < SNAP_SPREAD_M,
    )
    if (sameSpot) continue
    if (kept.length > 0) {
      const dx = (here.lon - lon) * cosLat
      const dy = here.lat - lat
      const bucket = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * SNAP_BUCKETS) % SNAP_BUCKETS
      if (used[bucket]) continue
      used[bucket] = true
    }
    kept.push(cand)
    if (kept.length >= SNAP_CHOICES) break
  }
  return kept
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

type Routed = { path: LatLngTuple[]; cost: number; rail: number }

/**
 * Shortest path from any source line to any target line. The snap distance is
 * part of the cost, so a nearer line wins when the rail lengths match.
 */
function routeSearch(
  graph: RailGraph,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  sources: SnapChoice[],
  targets: SnapChoice[],
): Routed | null {
  if (sources.length === 0 || targets.length === 0) return null
  const { lons, lats, adjStart, adjTo, adjD, adjH, adjWeld } = graph
  const targetSnap = new Map<number, number>()
  for (const target of targets) {
    const prev = targetSnap.get(target.id)
    if (prev === undefined || target.d < prev) targetSnap.set(target.id, target.d)
  }
  if (sources.length === 1 && targetSnap.size === 1 && targetSnap.has(sources[0].id)) {
    const id = sources[0].id
    return {
      path: [
        [lats[id], lons[id]],
        [lats[id], lons[id]],
      ],
      cost: sources[0].d + (targetSnap.get(id) ?? 0),
      rail: sources[0].d + (targetSnap.get(id) ?? 0),
    }
  }

  let best = Infinity
  let bestRail = Infinity
  let bestNode = -1

  const linkCount = adjTo.length
  const cost = new Float64Array(linkCount)
  const rail = new Float64Array(linkCount)
  cost.fill(Infinity)
  rail.fill(Infinity)
  const prev = new Int32Array(linkCount)
  prev.fill(-1)
  const head = new Int16Array(linkCount)
  const startAt = new Int32Array(linkCount)
  startAt.fill(-1)
  const goal = targets.map((target) => ({ lon: lons[target.id], lat: lats[target.id] }))
  const est = (id: number) => {
    const here = { lon: lons[id], lat: lats[id] }
    let nearest = Infinity
    for (const point of goal) {
      const d = metres(here, point)
      if (d < nearest) nearest = d
    }
    return nearest
  }
  const chord = metres({ lon: from.lng, lat: from.lat }, { lon: to.lng, lat: to.lat })
  const limit = chord * 3 + REVERSAL_PENALTY_M + 20_000

  const heapKey: number[] = []
  const heapVal: number[] = []
  const relax = (k: number, d: number, along: number, fromLink: number, h: number, start: number) => {
    const weld = adjWeld[k] === 1
    let nd = d + adjD[k]
    const nr = along + adjD[k]
    if (!weld && h !== NO_HEADING && sharpTurn(h, adjH[k])) nd += REVERSAL_PENALTY_M
    if (nd >= cost[k]) return
    cost[k] = nd
    rail[k] = nr
    prev[k] = fromLink
    head[k] = weld ? h : adjH[k]
    startAt[k] = start
    heapPush(heapKey, heapVal, nd + est(adjTo[k]), k)
  }
  for (const source of sources) {
    for (let k = adjStart[source.id]; k < adjStart[source.id + 1]; k++) {
      relax(k, source.d, source.d, -1, NO_HEADING, source.id)
    }
  }

  let last = -1
  while (heapKey.length) {
    const popped = heapPop(heapKey, heapVal)
    if (!popped) break
    const u = adjTo[popped.id]
    const d = cost[popped.id]
    if (popped.score > d + est(u)) continue
    if (popped.score > limit) break
    const snap = targetSnap.get(u)
    if (snap !== undefined) {
      const total = d + snap
      if (total < best) {
        best = total
        bestRail = rail[popped.id] + snap
        bestNode = u
        last = popped.id
      }
    }
    if (popped.score >= best) break
    for (let k = adjStart[u]; k < adjStart[u + 1]; k++) {
      relax(k, d, rail[popped.id], popped.id, head[popped.id], startAt[popped.id])
    }
  }
  if (bestNode < 0 || !Number.isFinite(best)) return null
  if (last < 0) {
    return {
      path: [
        [lats[bestNode], lons[bestNode]],
        [lats[bestNode], lons[bestNode]],
      ],
      cost: best,
      rail: bestRail,
    }
  }

  const ids: number[] = []
  let first = last
  for (let s = last; s >= 0; s = prev[s]) {
    ids.push(adjTo[s])
    first = s
  }
  ids.push(startAt[first])
  ids.reverse()
  const path: LatLngTuple[] = ids.map((id) => [lats[id], lons[id]])
  return path.length >= 2 ? { path, cost: best, rail: bestRail } : null
}

/**
 * Shortest rail path. A turn sharper than about 150 degrees costs 10 km, so a
 * parallel-track out-and-back stops being free. A terminus with no other way
 * still reverses. A pin that lands on the wrong line at a crossing can use
 * another line within the snap radius when that saves the detour.
 */
export function routeOnGraph(
  graph: RailGraph,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): LatLngTuple[] | null {
  const sources = snapChoices(graph, from.lng, from.lat)
  const targets = snapChoices(graph, to.lng, to.lat)
  if (sources.length === 0 || targets.length === 0) return null
  const nearest = routeSearch(graph, from, to, [sources[0]], [targets[0]])
  if (sources.length === 1 && targets.length === 1) return nearest?.path ?? null
  const alt = routeSearch(graph, from, to, sources, targets)
  if (!nearest) return alt?.path ?? null
  if (!alt) return nearest.path
  if (nearest.rail - alt.rail > LINE_SWITCH_M) return alt.path
  return nearest.path
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

