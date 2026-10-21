import type { LatLngTuple } from '@/utils/brouterRailRoute'
import { removeRouteReversals } from '@/utils/serviceJourneyMap'

type Point = { lat: number; lng: number }

const PAD_M = 1000
const MAX_CHAIN_M = 12000

function haversineM(a: Point, b: Point): number {
  const R = 6371000
  const lat1 = (a.lat * Math.PI) / 180
  const lat2 = (b.lat * Math.PI) / 180
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function chainLengthM(points: LatLngTuple[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += haversineM({ lat: points[i - 1][0], lng: points[i - 1][1] }, { lat: points[i][0], lng: points[i][1] })
  }
  return total
}

/** The router walked far outside the gap between the waypoints. */
export function routeLeavesTheRailway(waypoints: LatLngTuple[], path: LatLngTuple[]): boolean {
  const chain = chainLengthM(waypoints)
  const routed = chainLengthM(path.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])))
  return chain > 40 && routed > chain * 1.6 && routed - chain > 800
}

function nodeKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

const railLegs = new WeakMap<Point[][], (from: Point, to: Point) => Point[] | null>()

function joinLegs(
  leg: (from: Point, to: Point) => Point[] | null,
  points: LatLngTuple[],
): LatLngTuple[] | null {
  const joined: LatLngTuple[] = []
  for (let i = 1; i < points.length; i++) {
    const part = leg(
      { lat: points[i - 1][0], lng: points[i - 1][1] },
      { lat: points[i][0], lng: points[i][1] },
    )
    if (!part) return null
    const start = joined.length > 0 ? 1 : 0
    for (let j = start; j < part.length; j++) joined.push([part[j].lat, part[j].lng])
  }
  return joined.length >= 2 ? joined : null
}

/**
 * Shortest path along railway ways. Shared OSM nodes meet when rounded to
 * about a metre, which joins the ways into one network.
 */
export function railPathFromWays(ways: Point[][], points: LatLngTuple[]): LatLngTuple[] | null {
  if (points.length < 2) return null
  const cached = railLegs.get(ways)
  if (cached) return joinLegs(cached, points)
  const at = new Map<string, Point>()
  const next = new Map<string, { id: string; metres: number }[]>()
  const link = (from: string, to: string, metres: number) => {
    const list = next.get(from)
    if (list) list.push({ id: to, metres })
    else next.set(from, [{ id: to, metres }])
  }
  for (const way of ways) {
    let prev: string | null = null
    for (const point of way) {
      if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) continue
      const id = nodeKey(point.lat, point.lng)
      at.set(id, point)
      if (prev && prev !== id) {
        const metres = haversineM(at.get(prev) || point, point)
        link(prev, id, metres)
        link(id, prev, metres)
      }
      prev = id
    }
  }
  // A way that stops a few metres short of the next way is the same railway.
  // Join those ends so the path does not loop back to the last place they meet.
  const dangling: string[] = []
  for (const [id, edges] of next) if (edges.length === 1) dangling.push(id)
  const cell = 0.0003
  const buckets = new Map<string, string[]>()
  for (const id of dangling) {
    const point = at.get(id)
    if (!point) continue
    const key = `${Math.floor(point.lat / cell)}:${Math.floor(point.lng / cell)}`
    const list = buckets.get(key)
    if (list) list.push(id)
    else buckets.set(key, [id])
  }
  for (const id of dangling) {
    const point = at.get(id)
    if (!point) continue
    const cx = Math.floor(point.lat / cell)
    const cy = Math.floor(point.lng / cell)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const other of buckets.get(`${cx + dx}:${cy + dy}`) || []) {
          if (other <= id) continue
          const there = at.get(other)
          if (!there) continue
          const metres = haversineM(point, there)
          if (metres > 20) continue
          link(id, other, metres)
          link(other, id, metres)
        }
      }
    }
  }
  if (at.size < 2) return null

  const nearest = (point: Point): string | null => {
    let best: string | null = null
    let bestM = 80
    for (const [id, node] of at) {
      if (Math.abs(node.lat - point.lat) > 0.002 || Math.abs(node.lng - point.lng) > 0.003) continue
      const metres = haversineM(node, point)
      if (metres < bestM) {
        bestM = metres
        best = id
      }
    }
    return best
  }

  const leg = (from: Point, to: Point): Point[] | null => {
    const start = nearest(from)
    const goal = nearest(to)
    if (!start || !goal) return null
    if (start === goal) return [at.get(start) || from]
    const cost = new Map<string, number>([[start, 0]])
    const geo = new Map<string, number>([[start, 0]])
    const prev = new Map<string, string>()
    const queue: { id: string; cost: number }[] = [{ id: start, cost: 0 }]
    const shapeCost = (metres: number) => metres * (1 + Math.max(0, metres - 80) / 400)
    while (queue.length) {
      let pick = 0
      for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[pick].cost) pick = i
      const current = queue.splice(pick, 1)[0]
      if (current.id === goal) break
      if (current.cost !== cost.get(current.id)) continue
      for (const edge of next.get(current.id) || []) {
        const walked = (geo.get(current.id) ?? 0) + edge.metres
        const price = current.cost + shapeCost(edge.metres)
        if (price >= (cost.get(edge.id) ?? Infinity)) continue
        cost.set(edge.id, price)
        geo.set(edge.id, walked)
        prev.set(edge.id, current.id)
        queue.push({ id: edge.id, cost: price })
      }
    }
    const walked = geo.get(goal)
    const straight = haversineM(from, to)
    if (walked == null || walked > straight * 1.8 + 400) return null
    const out: Point[] = []
    let cursor: string | undefined = goal
    while (cursor) {
      const point = at.get(cursor)
      if (point) out.push(point)
      cursor = prev.get(cursor)
    }
    out.reverse()
    return out.length >= 2 ? out : null
  }

  railLegs.set(ways, leg)
  return joinLegs(leg, points)
}

function distanceToPath(path: LatLngTuple[], point: LatLngTuple): number {
  const here = { lat: point[0], lng: point[1] }
  let best = Infinity
  for (let i = 0; i < path.length; i++) {
    const at = { lat: path[i][0], lng: path[i][1] }
    best = Math.min(best, haversineM(here, at))
    if (i === 0) continue
    const from = { lat: path[i - 1][0], lng: path[i - 1][1] }
    const ab = localMetres(from, at)
    const len = Math.hypot(ab.x, ab.y)
    if (len < 1) continue
    const ap = localMetres(from, here)
    const t = Math.min(1, Math.max(0, (ap.x * ab.x + ap.y * ab.y) / (len * len)))
    const proj = fromMetres(from, ab.x * t, ab.y * t)
    best = Math.min(best, haversineM(here, proj))
  }
  return best
}

/**
 * The drawn line is the railway between the timetable points. A point the
 * rails already pass stays on the path. A short step onto another line is
 * left out. A dogleg the timetable names, where the direct rails miss it by
 * a long way, stays in.
 */
export function routeOnRailWays(ways: Point[][], points: LatLngTuple[]): LatLngTuple[] | null {
  if (points.length < 2 || ways.length === 0) return null
  const kept: LatLngTuple[] = [points[0]]
  for (let i = 1; i < points.length - 1; i++) {
    const via = points[i]
    const from = kept[kept.length - 1]
    const next = points[i + 1]
    const direct = railPathFromWays(ways, [from, next])
    const through = railPathFromWays(ways, [from, via, next])
    if (!through || through.length < 2) continue
    if (!direct || direct.length < 2) {
      kept.push(via)
      continue
    }
    const miss = distanceToPath(direct, via)
    const extra = chainLengthM(through) - chainLengthM(direct)
    if (miss < 80 || extra > 500) kept.push(via)
  }
  kept.push(points[points.length - 1])
  const walked = railPathFromWays(ways, kept)
  if (!walked || walked.length < 2) return null
  const dense = densifyAlongWays(walked, ways)
  const walkedM = chainLengthM(walked)
  const denseM = chainLengthM(dense.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])))
  const drawn = denseM > walkedM * 1.25 + 500 ? walked : dense
  return shapeLeftHandRuns(drawn, ways, points)
}

/** Railway geometry for a timetable, with no straight cuts. */
export async function railwayRoute(points: LatLngTuple[]): Promise<LatLngTuple[] | null> {
  if (points.length < 2) return null
  const ways = await fetchRailWays(points, 1200)
  if (!ways || ways.length === 0) return null
  return routeOnRailWays(ways, points)
}

/**
 * One continuous line for the whole journey. Short sections keep each graph
 * small, and they are joined before anything is returned.
 */
export async function railwayRouteJoined(points: LatLngTuple[]): Promise<LatLngTuple[] | null> {
  if (points.length < 2) return null
  const sectionSize = 4
  if (points.length <= sectionSize) return railwayRoute(points)
  const sections: LatLngTuple[][] = []
  for (let i = 0; i < points.length - 1; i += sectionSize - 1) {
    const slice = points.slice(i, i + sectionSize)
    if (slice.length >= 2) sections.push(slice)
  }
  const parts: Array<LatLngTuple[] | null> = new Array(sections.length)
  let cursor = 0
  async function worker() {
    while (cursor < sections.length) {
      const index = cursor
      cursor += 1
      let path = await railwayRoute(sections[index]).catch(() => null)
      if (!path || path.length < 2) path = await railwayRoute(sections[index]).catch(() => null)
      parts[index] = path
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, sections.length) }, () => worker()))
  const joined: LatLngTuple[] = []
  for (const part of parts) {
    if (!part || part.length < 2) return null
    const start = joined.length > 0 ? 1 : 0
    for (let i = start; i < part.length; i++) joined.push(part[i])
  }
  return joined.length >= 2 ? joined : null
}

function waysFromOverpass(payload: unknown): Point[][] {
  if (!payload || typeof payload !== 'object') return []
  const elements = (payload as { elements?: unknown }).elements
  if (!Array.isArray(elements)) return []
  const ways: Point[][] = []
  for (const element of elements) {
    if (!element || typeof element !== 'object') continue
    const geometry = (element as { geometry?: unknown }).geometry
    if (!Array.isArray(geometry)) continue
    const way: Point[] = []
    for (const point of geometry) {
      if (!point || typeof point !== 'object') continue
      const lat = Number((point as { lat?: unknown }).lat)
      const lng = Number((point as { lon?: unknown }).lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue
      way.push({ lat, lng })
    }
    if (way.length >= 2) ways.push(way)
  }
  return ways
}

type RailBox = { south: number; west: number; north: number; east: number }

const BOX_CACHE_MS = 30 * 60 * 1000
const OVERPASS_URL = 'https://overpass.openstreetmap.fr/api/interpreter'
const boxCache = new Map<string, { at: number; ways: Point[][] }>()
const UNION_LIMIT = 3
let unionActive = 0
const unionWaiters: Array<() => void> = []

function boxKey(box: RailBox): string {
  return `${box.south.toFixed(5)},${box.west.toFixed(5)},${box.north.toFixed(5)},${box.east.toFixed(5)}`
}

function withUnionSlot<T>(job: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      unionActive += 1
      job().then(resolve, reject).finally(() => {
        unionActive -= 1
        const next = unionWaiters.shift()
        if (next) next()
      })
    }
    if (unionActive < UNION_LIMIT) run()
    else unionWaiters.push(run)
  })
}

function wayHitsBox(way: Point[], box: RailBox): boolean {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const point of way) {
    south = Math.min(south, point.lat)
    north = Math.max(north, point.lat)
    west = Math.min(west, point.lng)
    east = Math.max(east, point.lng)
  }
  return north >= box.south && south <= box.north && east >= box.west && west <= box.east
}

/** One request for several short stretches. Separate calls queue the rail map and the line fills late. */
async function loadRailUnion(boxes: RailBox[]): Promise<Point[][]> {
  if (boxes.length === 0) return []
  const clauses = boxes
    .map((box) => `way["railway"="rail"](${box.south.toFixed(5)},${box.west.toFixed(5)},${box.north.toFixed(5)},${box.east.toFixed(5)});`)
    .join('')
  const query = `[out:json][timeout:8];(${clauses});out geom;`
  try {
    const response = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk); rail route',
      },
      body: new URLSearchParams({ data: query }).toString(),
      signal: AbortSignal.timeout(8000),
      cache: 'no-store',
    })
    if (!response.ok) return []
    return waysFromOverpass(await response.json())
  } catch {
    return []
  }
}

async function fetchRailBounds(boxes: RailBox[]): Promise<Point[][]> {
  const seen = new Set<string>()
  const ways: Point[][] = []
  const add = (part: Point[][]) => {
    for (const way of part) {
      const key = wayKey(way)
      if (seen.has(key)) continue
      seen.add(key)
      ways.push(way)
    }
  }
  const missing: RailBox[] = []
  const now = Date.now()
  for (const box of boxes) {
    const cached = boxCache.get(boxKey(box))
    if (cached && now - cached.at < BOX_CACHE_MS) {
      add(cached.ways)
      continue
    }
    missing.push(box)
  }
  const slices: RailBox[][] = []
  for (let i = 0; i < missing.length; i += 8) slices.push(missing.slice(i, i + 8))
  const loadedParts = await Promise.all(slices.map((slice) => withUnionSlot(() => loadRailUnion(slice))))
  loadedParts.forEach((loaded, index) => {
    const slice = slices[index]
    if (loaded.length > 0) {
      const at = Date.now()
      for (const box of slice) {
        boxCache.set(boxKey(box), { at, ways: loaded.filter((way) => wayHitsBox(way, box)) })
      }
    }
    add(loaded)
  })
  return ways
}

function wayKey(way: Point[]): string {
  const first = way[0]
  const last = way[way.length - 1]
  return `${first.lat.toFixed(5)},${first.lng.toFixed(5)}|${last.lat.toFixed(5)},${last.lng.toFixed(5)}|${way.length}`
}

/** Small boxes answer quickly. One box around a whole journey often times out, and the line then leaves the rails. */
async function fetchRailWays(points: LatLngTuple[], padM = PAD_M): Promise<Point[][] | null> {
  if (points.length === 0) return null
  const samples: LatLngTuple[] = [points[0]]
  for (let i = 1; i < points.length; i++) {
    const from = { lat: points[i - 1][0], lng: points[i - 1][1] }
    const to = { lat: points[i][0], lng: points[i][1] }
    const dist = haversineM(from, to)
    const steps = Math.floor(dist / 4000)
    for (let s = 1; s <= steps; s++) {
      const t = (s * 4000) / dist
      if (t >= 1) break
      samples.push([from.lat + (to.lat - from.lat) * t, from.lng + (to.lng - from.lng) * t])
    }
    samples.push(points[i])
  }
  const boxes: LatLngTuple[][] = []
  let batch: LatLngTuple[] = [samples[0]]
  const span = (group: LatLngTuple[]) => {
    let south = Infinity
    let north = -Infinity
    let west = Infinity
    let east = -Infinity
    for (const [lat, lng] of group) {
      south = Math.min(south, lat)
      north = Math.max(north, lat)
      west = Math.min(west, lng)
      east = Math.max(east, lng)
    }
    const mid = (south + north) / 2
    const height = (north - south) * 110540
    const width = (east - west) * 111320 * Math.cos((mid * Math.PI) / 180)
    return Math.hypot(height, width)
  }
  for (let i = 1; i < samples.length; i++) {
    const trial = batch.concat([samples[i]])
    if (span(trial) > 4500 && batch.length > 1) {
      boxes.push(batch)
      batch = [batch[batch.length - 1], samples[i]]
    } else {
      batch = trial
    }
  }
  boxes.push(batch)
  const bounds: RailBox[] = boxes.map((group) => {
    let south = Infinity
    let north = -Infinity
    let west = Infinity
    let east = -Infinity
    for (const [lat, lng] of group) {
      south = Math.min(south, lat)
      north = Math.max(north, lat)
      west = Math.min(west, lng)
      east = Math.max(east, lng)
    }
    const mid = (south + north) / 2
    const padLat = padM / 110540
    const padLng = padM / (111320 * Math.cos((mid * Math.PI) / 180))
    return {
      south: south - padLat,
      west: west - padLng,
      north: north + padLat,
      east: east + padLng,
    }
  })
  const ways = await fetchRailBounds(bounds)
  return ways.length > 0 ? ways : null
}

/** Railway geometry from OpenStreetMap when the router has left the corridor. */
export async function osmRailPath(points: LatLngTuple[]): Promise<LatLngTuple[] | null> {
  if (chainLengthM(points) > MAX_CHAIN_M) return null
  const ways = await fetchRailWays(points)
  if (!ways || ways.length === 0) return null
  return railPathFromWays(ways, points)
}

const LEFT_TRACK_M = 5.5
const LEFT_SHIFT_M = 2.2
const STAY_ON_TRACK_M = 16
const JUNCTION_M = 80
/** A crossover is shorter than this. It is not a running line. */
const RUNNING_LINE_M = 40

function localMetres(origin: Point, point: Point): { x: number; y: number } {
  const lat = (origin.lat * Math.PI) / 180
  return {
    x: (point.lng - origin.lng) * 111320 * Math.cos(lat),
    y: (point.lat - origin.lat) * 110540,
  }
}

function pointAlong(path: LatLngTuple[], index: number, metres: number): Point | null {
  const origin = path[index]
  if (!origin || !Number.isFinite(origin[0])) return null
  let left = Math.abs(metres)
  const step = metres >= 0 ? 1 : -1
  let cursor: Point = { lat: origin[0], lng: origin[1] }
  let i = index
  while (left > 0) {
    const nextIndex = i + step
    const next = path[nextIndex]
    if (!next || !Number.isFinite(next[0])) return cursor
    const there = { lat: next[0], lng: next[1] }
    const dist = haversineM(cursor, there)
    if (dist >= left) {
      const t = dist > 0 ? left / dist : 0
      return {
        lat: cursor.lat + (there.lat - cursor.lat) * t,
        lng: cursor.lng + (there.lng - cursor.lng) * t,
      }
    }
    left -= dist
    cursor = there
    i = nextIndex
  }
  return cursor
}

/** Arrival and departure point the same way: the train has reversed. */
function isReverseApex(path: LatLngTuple[], index: number): boolean {
  const back = pointAlong(path, index, -80)
  const fore = pointAlong(path, index, 80)
  const origin = path[index]
  if (!back || !fore || !origin) return false
  const here = { lat: origin[0], lng: origin[1] }
  const bd = localMetres(here, back)
  const fd = localMetres(here, fore)
  const bl = Math.hypot(bd.x, bd.y)
  const fl = Math.hypot(fd.x, fd.y)
  if (bl < 40 || fl < 40) return false
  return (bd.x / bl) * (fd.x / fl) + (bd.y / bl) * (fd.y / fl) > 0.5
}

export function splitAtReversals(path: LatLngTuple[]): LatLngTuple[][] {
  if (path.length < 3) return [path]
  const cuts = [0]
  let last = 0
  for (let i = 1; i < path.length - 1; i++) {
    if (i - last < 2 || !isReverseApex(path, i)) continue
    cuts.push(i)
    last = i
  }
  cuts.push(path.length - 1)
  const runs: LatLngTuple[][] = []
  for (let c = 1; c < cuts.length; c++) {
    const slice = path.slice(cuts[c - 1], cuts[c] + 1)
    if (slice.length >= 2) runs.push(slice)
  }
  return runs.length > 0 ? runs : [path]
}

/** The road itself keeps going in the direction of travel, rather than ending as a crossover. */
function wayRunsForward(way: Point[], here: Point, dir: { x: number; y: number }, metres: number): boolean {
  let bestI = 1
  let bestD = Infinity
  let bestT = 0
  for (let i = 1; i < way.length; i++) {
    const a = way[i - 1]
    const b = way[i]
    const ab = localMetres(a, b)
    const abLen = Math.hypot(ab.x, ab.y)
    if (abLen < 1) continue
    const ap = localMetres(a, here)
    const raw = (ap.x * ab.x + ap.y * ab.y) / (abLen * abLen)
    const t = Math.min(1, Math.max(0, raw))
    const proj = fromMetres(a, ab.x * t, ab.y * t)
    const distance = haversineM(here, proj)
    if (distance < bestD) {
      bestD = distance
      bestI = i
      bestT = t
    }
  }
  if (bestD > 12) return false
  const a = way[bestI - 1]
  const b = way[bestI]
  const ab = localMetres(a, b)
  const sign = ab.x * dir.x + ab.y * dir.y >= 0 ? 1 : -1
  let walked = 0
  let cursor = fromMetres(a, ab.x * bestT, ab.y * bestT)
  const toward = sign > 0 ? b : a
  walked += haversineM(cursor, toward)
  if (walked >= metres) return true
  cursor = toward
  for (let i = sign > 0 ? bestI + 1 : bestI - 2; sign > 0 ? i < way.length : i >= 0; i += sign) {
    const next = way[i]
    const step = localMetres(cursor, next)
    const len = Math.hypot(step.x, step.y)
    if (len < 1) continue
    if ((step.x / len) * dir.x + (step.y / len) * dir.y < 0.34) break
    walked += len
    if (walked >= metres) return true
    cursor = next
  }
  return walked >= metres
}

function pointAheadOnWay(way: Point[], here: Point, dir: { x: number; y: number }, metres: number): Point | null {
  let bestI = 1
  let bestD = Infinity
  let bestT = 0
  for (let i = 1; i < way.length; i++) {
    const a = way[i - 1]
    const b = way[i]
    const ab = localMetres(a, b)
    const abLen = Math.hypot(ab.x, ab.y)
    if (abLen < 1) continue
    const ap = localMetres(a, here)
    const raw = (ap.x * ab.x + ap.y * ab.y) / (abLen * abLen)
    const t = Math.min(1, Math.max(0, raw))
    const proj = fromMetres(a, ab.x * t, ab.y * t)
    const distance = haversineM(here, proj)
    if (distance < bestD) {
      bestD = distance
      bestI = i
      bestT = t
    }
  }
  if (bestD > 12) return null
  const a = way[bestI - 1]
  const b = way[bestI]
  const ab = localMetres(a, b)
  const sign = ab.x * dir.x + ab.y * dir.y >= 0 ? 1 : -1
  let left = metres
  let cursor = fromMetres(a, ab.x * bestT, ab.y * bestT)
  const toward = sign > 0 ? b : a
  const first = haversineM(cursor, toward)
  if (first >= left) {
    const t = first > 0 ? left / first : 0
    return { lat: cursor.lat + (toward.lat - cursor.lat) * t, lng: cursor.lng + (toward.lng - cursor.lng) * t }
  }
  left -= first
  cursor = toward
  for (let i = sign > 0 ? bestI + 1 : bestI - 2; sign > 0 ? i < way.length : i >= 0; i += sign) {
    const next = way[i]
    const dist = haversineM(cursor, next)
    if (dist >= left) {
      const t = dist > 0 ? left / dist : 0
      return { lat: cursor.lat + (next.lat - cursor.lat) * t, lng: cursor.lng + (next.lng - cursor.lng) * t }
    }
    left -= dist
    cursor = next
  }
  return cursor
}

function fromMetres(origin: Point, x: number, y: number): Point {
  const lat = (origin.lat * Math.PI) / 180
  return {
    lat: origin.lat + y / 110540,
    lng: origin.lng + x / (111320 * Math.cos(lat)),
  }
}

type WayHit = { point: Point; distance: number; pastEnd: boolean; forward: number }

function projectOnWay(way: Point[], here: Point, dir: { x: number; y: number } | null): WayHit | null {
  let best: WayHit | null = null
  for (let i = 1; i < way.length; i++) {
    const a = way[i - 1]
    const b = way[i]
    const ab = localMetres(a, b)
    const abLen = Math.hypot(ab.x, ab.y)
    if (abLen < 1) continue
    const ap = localMetres(a, here)
    const raw = (ap.x * ab.x + ap.y * ab.y) / (abLen * abLen)
    const t = Math.min(1, Math.max(0, raw))
    const proj = fromMetres(a, ab.x * t, ab.y * t)
    const distance = haversineM(here, proj)
    const ux = ab.x / abLen
    const uy = ab.y / abLen
    const forward = dir ? Math.abs(ux * dir.x + uy * dir.y) : 1
    const pastEnd = (i === way.length - 1 && raw > 1) || (i === 1 && raw < 0)
    if (!best || distance < best.distance) best = { point: proj, distance, pastEnd, forward }
  }
  return best
}

/**
 * Move a running line onto the left-hand track in the direction of travel.
 * It stays on that road. A move onto another road is kept only where the two
 * ways join, and a timing point that names its own road is left where it is.
 */
export function keepLeftHandTrack(
  path: LatLngTuple[],
  ways: Point[][],
  anchors: LatLngTuple[] = [],
): LatLngTuple[] {
  const usable = ways.filter((way) => way.length >= 2)
  if (path.length < 2 || usable.length === 0) return path
  const at = new Map<string, Point>()
  const nodeWays = new Map<string, number[]>()
  const wayNodes: string[][] = usable.map(() => [])
  for (let w = 0; w < usable.length; w++) {
    for (const point of usable[w]) {
      const id = nodeKey(point.lat, point.lng)
      if (!at.has(id)) at.set(id, point)
      wayNodes[w].push(id)
      const list = nodeWays.get(id)
      if (list) {
        if (!list.includes(w)) list.push(w)
      } else nodeWays.set(id, [w])
    }
  }
  const links: number[][] = usable.map(() => [])
  for (const list of nodeWays.values()) {
    if (list.length < 2) continue
    for (const a of list) {
      for (const b of list) {
        if (a !== b && !links[a].includes(b)) links[a].push(b)
      }
    }
  }
  const nearestWay = (here: Point): number | null => {
    let best: number | null = null
    let bestM = 20
    for (let w = 0; w < usable.length; w++) {
      const hit = projectOnWay(usable[w], here, null)
      if (hit && hit.distance < bestM) {
        bestM = hit.distance
        best = w
      }
    }
    return best
  }
  const joinNear = (way: number, other: number, here: Point, maxM = JUNCTION_M): Point | null => {
    let best: Point | null = null
    let bestM = maxM
    for (const id of wayNodes[way]) {
      if (!nodeWays.get(id)?.includes(other)) continue
      const point = at.get(id)
      if (!point) continue
      const distance = haversineM(here, point)
      if (distance <= bestM) {
        bestM = distance
        best = point
      }
    }
    return best
  }
  const joinAhead = (way: number, other: number, here: Point, dir: { x: number; y: number }): Point | null => {
    let best: Point | null = null
    let bestM = 220
    for (const id of wayNodes[way]) {
      if (!nodeWays.get(id)?.includes(other)) continue
      const point = at.get(id)
      if (!point) continue
      const offset = localMetres(here, point)
      const along = offset.x * dir.x + offset.y * dir.y
      if (along < -120 || along > 250) continue
      const distance = Math.hypot(offset.x, offset.y)
      if (distance < bestM) {
        bestM = distance
        best = point
      }
    }
    return best
  }
  const held = anchors.map(([lat, lng]) => ({ lat, lng }))
  const out: LatLngTuple[] = []
    const emit = (point: Point, dir: { x: number; y: number } | null = null) => {
    const last = out[out.length - 1]
    if (!last) {
      out.push([point.lat, point.lng])
      return
    }
    const lastPoint = { lat: last[0], lng: last[1] }
    if (haversineM(lastPoint, point) < 3) return
    if (dir) {
      const step = localMetres(lastPoint, point)
      if (step.x * dir.x + step.y * dir.y < -8) return
    }
    out.push([point.lat, point.lng])
  }
  let current = nearestWay({ lat: path[0][0], lng: path[0][1] })
  let leftFrom = -1
  const opening = pointAlong(path, 0, 120)
  const openingTravel = opening ? localMetres({ lat: path[0][0], lng: path[0][1] }, opening) : { x: 0, y: 0 }
  const openingSpan = Math.hypot(openingTravel.x, openingTravel.y)
  if (openingSpan >= 8) {
    const openDir = { x: openingTravel.x / openingSpan, y: openingTravel.y / openingSpan }
    const openLeft = { x: -openDir.y, y: openDir.x }
    const origin = { lat: path[0][0], lng: path[0][1] }
    let bestScore = -Infinity
    for (let w = 0; w < usable.length; w++) {
      const hit = projectOnWay(usable[w], origin, openDir)
      if (!hit || hit.distance > 3 || hit.forward < 0.7) continue
      if (!wayRunsForward(usable[w], hit.point, openDir, RUNNING_LINE_M)) continue
      const ahead = pointAheadOnWay(usable[w], origin, openDir, 30) || hit.point
      const offset = localMetres(origin, ahead)
      const score = offset.x * openLeft.x + offset.y * openLeft.y
      if (score > bestScore) {
        bestScore = score
        current = w
      }
    }
  }
  for (let i = 0; i < path.length; i++) {
    const here = { lat: path[i][0], lng: path[i][1] }
    if (held.some((anchor) => haversineM(anchor, here) <= 30)) {
      emit(here)
      const onCurrent = current == null ? null : projectOnWay(usable[current], here, null)
      if (!onCurrent || onCurrent.distance > 8) {
        const named = nearestWay(here)
        if (named != null) current = named
      }
      continue
    }
    const behind = pointAlong(path, i, -40)
    const ahead = pointAlong(path, i, 120)
    const travel = behind && ahead
      ? localMetres(behind, ahead)
      : { x: 0, y: 0 }
    const span = Math.hypot(travel.x, travel.y)
    const dir = span >= 8 ? { x: travel.x / span, y: travel.y / span } : null
    const left = dir ? { x: -dir.y, y: dir.x } : null
    const stay = current == null ? null : projectOnWay(usable[current], here, dir)
    const alongside = Boolean(stay && stay.distance <= STAY_ON_TRACK_M && !stay.pastEnd)
    const scoreOf = (point: Point) => {
      if (!left) return 0
      const offset = localMetres(here, point)
      return offset.x * left.x + offset.y * left.y
    }
    const lefter = (way: number): { score: number } | null => {
      if (!dir || !left || !stay || way === leftFrom) return null
      const hit = projectOnWay(usable[way], here, dir)
      if (!hit || hit.distance > LEFT_TRACK_M || hit.forward < 0.82) return null
      if (!wayRunsForward(usable[way], hit.point, dir, RUNNING_LINE_M)) return null
      const gain = scoreOf(hit.point) - scoreOf(stay.point)
      if (gain < LEFT_SHIFT_M) return null
      return { score: gain }
    }
    if (alongside && current != null && dir) {
      let hopWay = -1
      let hopThrough: Point[] = []
      let hopScore = -Infinity
      const takeHop = (way: number, through: Point[]) => {
        const candidate = lefter(way)
        if (!candidate || candidate.score <= hopScore) return
        hopWay = way
        hopThrough = through
        hopScore = candidate.score
      }
      for (const other of links[current]) {
        const joint = joinAhead(current, other, here, dir)
        if (!joint) continue
        takeHop(other, [joint])
        if (chainLengthM(usable[other].map((point) => [point.lat, point.lng])) > 90) continue
        for (const id of wayNodes[other]) {
          const end = at.get(id)
          if (!end || haversineM(end, joint) < 3) continue
          for (const beyond of nodeWays.get(id) || []) {
            if (beyond === other || beyond === current) continue
            const landing = joinNear(other, beyond, joint, 40)
            if (landing) takeHop(beyond, [joint, landing])
          }
        }
      }
      if (hopWay >= 0) {
        leftFrom = current
        for (const point of hopThrough) emit(point, dir)
        current = hopWay
      }
    } else if (current != null && dir) {
      let follow: { way: number; joint: Point; distance: number } | null = null
      for (const other of links[current]) {
        const joint = joinNear(current, other, here, 200)
        if (!joint) continue
        const hit = projectOnWay(usable[other], here, dir)
        if (!hit || hit.distance > STAY_ON_TRACK_M || hit.forward < 0.55) continue
        if (!follow || hit.distance < follow.distance) follow = { way: other, joint, distance: hit.distance }
      }
      if (follow) {
        emit(follow.joint, dir)
        current = follow.way
      } else if (stay && stay.distance > 40) {
        const near = nearestWay(here)
        if (near != null) current = near
      }
    }
    const placed = current == null ? null : projectOnWay(usable[current], here, dir)
    if (placed && placed.distance <= (alongside ? STAY_ON_TRACK_M : 40)) emit(placed.point)
    else emit(here)
  }
  return out.length >= 2 ? out : path
}

function appendRun(joined: LatLngTuple[], part: LatLngTuple[]) {
  if (!part.length) return
  const last = joined[joined.length - 1]
  const start = last && Number.isFinite(last[0]) ? 1 : 0
  for (let i = start; i < part.length; i++) joined.push(part[i])
}

/**
 * One left-hand road for each direction of travel. A reverse at a station
 * starts a new direction, so the train leaves on the left-hand road of the
 * way back rather than the road it arrived on.
 */
export function shapeLeftHandRuns(
  path: LatLngTuple[],
  ways: Point[][],
  anchors: LatLngTuple[] = [],
): LatLngTuple[] {
  const joined: LatLngTuple[] = []
  let piece: LatLngTuple[] = []
  const flush = () => {
    if (piece.length < 2) {
      piece = []
      return
    }
    for (const run of splitAtReversals(piece)) appendRun(joined, keepLeftHandTrack(run, ways, anchors))
    piece = []
  }
  for (const point of path) {
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      flush()
      if (joined.length > 0) joined.push([Number.NaN, Number.NaN])
      continue
    }
    piece.push(point)
  }
  flush()
  while (joined.length > 0 && !Number.isFinite(joined[joined.length - 1][0])) joined.pop()
  if (joined.length < 2) return path
  // A ladder spur runs up a road and back. A reverse that is the only visit
  // to a station stays, because that is the train turning round.
  return removeRouteReversals(joined, 40, 30, 8000, anchors)
}

/** Put the routed line on the rails. A straight that leaves the track is replaced by the ways that join its ends. */
export async function shapeOntoLeftHandTrack(
  anchors: LatLngTuple[],
  path: LatLngTuple[],
): Promise<LatLngTuple[]> {
  if (path.length < 2) return path
  const ways = await fetchRailWays(path, 160)
  if (!ways || ways.length === 0) return path
  return shapeLeftHandRuns(densifyAlongWays(path, ways), ways, anchors)
}

/**
 * The straight follows the railway only when every sample sits on the same
 * rail. Passing near a succession of different tracks is a cut across them.
 */
function segmentFollowsRail(ways: Point[][], from: LatLngTuple, to: LatLngTuple): boolean {
  const a = { lat: from[0], lng: from[1] }
  const b = { lat: to[0], lng: to[1] }
  const gap = haversineM(a, b)
  if (gap < 8) return true
  const steps = Math.max(2, Math.ceil(gap / 25))
  const samples: Point[] = []
  for (let s = 0; s <= steps; s++) {
    const t = s / steps
    samples.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t })
  }
  for (const way of ways) {
    let onWay = true
    for (const sample of samples) {
      const hit = projectOnWay(way, sample, null)
      if (!hit || hit.distance > 4) {
        onWay = false
        break
      }
    }
    if (onWay) return true
  }
  return false
}

type RailSliceHit = { index: number; t: number; point: Point; distance: number }

function projectHit(way: Point[], here: Point): RailSliceHit | null {
  let best: RailSliceHit | null = null
  for (let i = 1; i < way.length; i++) {
    const a = way[i - 1]
    const b = way[i]
    const ab = localMetres(a, b)
    const abLen = Math.hypot(ab.x, ab.y)
    if (abLen < 1) continue
    const ap = localMetres(a, here)
    const raw = (ap.x * ab.x + ap.y * ab.y) / (abLen * abLen)
    const t = Math.min(1, Math.max(0, raw))
    const point = fromMetres(a, ab.x * t, ab.y * t)
    const distance = haversineM(here, point)
    if (!best || distance < best.distance) best = { index: i, t, point, distance }
  }
  return best
}

function offsetFromChord(a: Point, b: Point, point: Point): number {
  const ab = localMetres(a, b)
  const len = Math.hypot(ab.x, ab.y)
  if (len < 1) return haversineM(a, point)
  const ap = localMetres(a, point)
  const t = Math.min(1, Math.max(0, (ap.x * ab.x + ap.y * ab.y) / (len * len)))
  return haversineM(point, fromMetres(a, ab.x * t, ab.y * t))
}

/**
 * A long OSM edge is often a simplified straight, with the real bend mapped
 * as another way between the same places. Use that bend. A way that leaves
 * the corridor for a different route is left alone.
 */
function richerRail(ways: Point[][], from: LatLngTuple, to: LatLngTuple): LatLngTuple[] | null {
  const a = { lat: from[0], lng: from[1] }
  const b = { lat: to[0], lng: to[1] }
  const gap = haversineM(a, b)
  if (gap < 40) return null
  const bowLimit = Math.max(150, gap * 0.6)
  let best: LatLngTuple[] | null = null
  let bestNodes = 0
  for (const way of ways) {
    const start = projectHit(way, a)
    const end = projectHit(way, b)
    if (!start || !end || start.distance > 40 || end.distance > 40) continue
    const forward = start.index < end.index || (start.index === end.index && start.t <= end.t)
    const fromHit = forward ? start : end
    const toHit = forward ? end : start
    if (fromHit.index === toHit.index) continue
    const points: Point[] = [fromHit.point]
    for (let i = fromHit.index; i < toHit.index; i++) points.push(way[i])
    points.push(toHit.point)
    let length = 0
    for (let i = 1; i < points.length; i++) length += haversineM(points[i - 1], points[i])
    if (length > gap * 2.2 + 80) continue
    if (points.some((point) => offsetFromChord(a, b, point) > bowLimit)) continue
    const nodes = points.length
    if (nodes <= bestNodes) continue
    bestNodes = nodes
    best = points.map((point) => [point.lat, point.lng])
  }
  return best && bestNodes >= 3 ? best : null
}

/**
 * Every drawn step stays on railway geometry. A straight that cuts across a
 * junction or a field is replaced by the rails joining its ends. Where those
 * rails do not connect, the straight is not drawn.
 */
export function densifyAlongWays(path: LatLngTuple[], ways: Point[][]): LatLngTuple[] {
  if (path.length < 2 || ways.length === 0) return path
  const out: LatLngTuple[] = []
  const push = (point: LatLngTuple) => {
    const prev = out[out.length - 1]
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      if (prev && Number.isFinite(prev[0])) out.push(point)
      return
    }
    if (prev && Math.abs(prev[0] - point[0]) < 1e-7 && Math.abs(prev[1] - point[1]) < 1e-7) return
    out.push(point)
  }
  let cursor = path[0]
  push(cursor)
  for (let i = 1; i < path.length; i++) {
    const to = path[i]
    if (!Number.isFinite(to[0]) || !Number.isFinite(to[1])) {
      push(to)
      cursor = path[i + 1] && Number.isFinite(path[i + 1][0]) ? path[i + 1] : to
      continue
    }
    if (!Number.isFinite(cursor[0]) || !Number.isFinite(cursor[1])) {
      push(to)
      cursor = to
      continue
    }
    const detailed = richerRail(ways, cursor, to)
    if (detailed) {
      for (let j = 1; j < detailed.length; j++) push(detailed[j])
      push(to)
      cursor = to
      continue
    }
    const gap = haversineM({ lat: cursor[0], lng: cursor[1] }, { lat: to[0], lng: to[1] })
    if (gap < 30 || segmentFollowsRail(ways, cursor, to)) {
      push(to)
      cursor = to
      continue
    }
    const along = railPathFromWays(ways, [cursor, to])
    if (!along || along.length < 2) {
      push([Number.NaN, Number.NaN])
      push(to)
      cursor = to
      continue
    }
    for (let j = 1; j < along.length; j++) push(along[j])
    cursor = along[along.length - 1]
  }
  return out.length >= 2 ? out : path
}
