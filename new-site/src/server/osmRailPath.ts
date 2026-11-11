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

/**
 * The router walked far outside the gap between the waypoints.
 * A valley curve is longer than the straight chord — Halifax to Brighouse
 * is about one and a half times the chord — and that path is still the railway.
 * Only a route more than twice as long has left the corridor.
 */
export function routeLeavesTheRailway(waypoints: LatLngTuple[], path: LatLngTuple[]): boolean {
  const chain = chainLengthM(waypoints)
  const routed = chainLengthM(path.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1])))
  return chain > 40 && routed > chain * 2.4 && routed - chain > 800
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

const OPENING_M = 2500

function openingOf(run: LatLngTuple[]): { head: LatLngTuple[]; rest: LatLngTuple[] } {
  const head: LatLngTuple[] = [run[0]]
  let walked = 0
  for (let i = 1; i < run.length; i++) {
    walked += haversineM(
      { lat: run[i - 1][0], lng: run[i - 1][1] },
      { lat: run[i][0], lng: run[i][1] },
    )
    head.push(run[i])
    if (walked >= OPENING_M) return { head, rest: run.slice(i) }
  }
  return { head, rest: [] }
}

/**
 * On the way out of a station, cross to the left-hand road at the points.
 * Only the opening of each direction is fetched, so a long journey does not
 * wait on a map of the whole line. The rest of the road stays as routed.
 */
export async function layOnRailway(path: LatLngTuple[], anchors: LatLngTuple[] = []): Promise<LatLngTuple[]> {
  if (path.length < 2) return path
  const finite = path.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
  const runs = splitAtReversals(finite)
  const shaped: LatLngTuple[] = []
  for (const run of runs) {
    const { head, rest } = openingOf(run)
    const ways = await fetchRailWays(head, 120).catch(() => null)
    const crossed = ways && ways.length > 0 ? shapeLeftHandRuns(head, ways, anchors) : head
    const part = crossed.length >= 2 ? crossed : head
    const last = shaped[shaped.length - 1]
    const start = last && Math.abs(last[0] - part[0][0]) < 1e-7 && Math.abs(last[1] - part[0][1]) < 1e-7 ? 1 : 0
    for (let i = start; i < part.length; i++) shaped.push(part[i])
    for (let i = 1; i < rest.length; i++) shaped.push(rest[i])
  }
  return shaped.length >= 2 ? shaped : path
}

/** Railway geometry for a timetable, with no straight cuts. */
export async function railwayRoute(points: LatLngTuple[]): Promise<LatLngTuple[] | null> {
  if (points.length < 2) return null
  const ways = await fetchRailWays(points, 1200)
  if (!ways || ways.length === 0) return null
  return routeOnRailWays(ways, points)
}

/**
 * One OpenStreetMap fetch for the whole journey. The boxes inside that fetch
 * stay short, so a long route is not a series of separate rail-map requests.
 */
export async function railwayRouteJoined(points: LatLngTuple[]): Promise<LatLngTuple[] | null> {
  if (points.length < 2) return null
  return railwayRoute(points)
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

const LEFT_SHIFT_M = 2.2
const STAY_ON_TRACK_M = 16
/** A timing point this close to a rail is on that road. */
const NAMED_ROAD_M = 2
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

/** A point further than this from every rail is a station pin, not a place on a track. */
const ON_RAIL_M = 5

type RailGap = (from: Point, to: Point) => number | null

const railGaps = new WeakMap<Point[][], RailGap>()

/**
 * Metres along the rails between two places that are each on a track. Null
 * when either is off the rails, so there is nothing to compare. Infinity when
 * the rails do not join them within a short walk: the two are on different
 * roads with no points between them.
 */
function railGapOf(ways: Point[][]): RailGap {
  const cached = railGaps.get(ways)
  if (cached) return cached
  const at = new Map<string, Point>()
  const next = new Map<string, { id: string; metres: number }[]>()
  const link = (from: string, to: string, metres: number) => {
    const list = next.get(from)
    if (list) list.push({ id: to, metres })
    else next.set(from, [{ id: to, metres }])
  }
  const segments: { a: Point; b: Point; aId: string; bId: string; way: number }[] = []
  ways.forEach((way, w) => {
    for (let i = 1; i < way.length; i++) {
      const a = way[i - 1]
      const b = way[i]
      const aId = nodeKey(a.lat, a.lng)
      const bId = nodeKey(b.lat, b.lng)
      at.set(aId, a)
      at.set(bId, b)
      if (aId === bId) continue
      const metres = haversineM(a, b)
      link(aId, bId, metres)
      link(bId, aId, metres)
      segments.push({ a, b, aId, bId, way: w })
    }
  })
  const snap = (here: Point) => {
    let best: { way: number; ends: { id: string; metres: number }[] } | null = null
    let bestM = ON_RAIL_M
    for (const segment of segments) {
      const { a, b } = segment
      if (Math.min(a.lat, b.lat) - here.lat > 0.0002 || here.lat - Math.max(a.lat, b.lat) > 0.0002) continue
      if (Math.min(a.lng, b.lng) - here.lng > 0.0003 || here.lng - Math.max(a.lng, b.lng) > 0.0003) continue
      const ab = localMetres(a, b)
      const len = Math.hypot(ab.x, ab.y)
      if (len < 0.5) continue
      const ap = localMetres(a, here)
      const t = Math.min(1, Math.max(0, (ap.x * ab.x + ap.y * ab.y) / (len * len)))
      const distance = Math.hypot(ap.x - ab.x * t, ap.y - ab.y * t)
      if (distance >= bestM) continue
      bestM = distance
      best = {
        way: segment.way,
        ends: [{ id: segment.aId, metres: len * t }, { id: segment.bId, metres: len * (1 - t) }],
      }
    }
    return best
  }
  const gap: RailGap = (from, to) => {
    const start = snap(from)
    const goal = snap(to)
    if (!start || !goal) return null
    const straight = haversineM(from, to)
    if (start.way === goal.way) return straight
    const limit = straight * 2 + 200
    const goalAt = new Map(goal.ends.map((end) => [end.id, end.metres]))
    const cost = new Map<string, number>()
    const queue: { id: string; cost: number }[] = []
    for (const end of start.ends) {
      if (end.metres < (cost.get(end.id) ?? Infinity)) {
        cost.set(end.id, end.metres)
        queue.push({ id: end.id, cost: end.metres })
      }
    }
    let best = Infinity
    while (queue.length) {
      let pick = 0
      for (let i = 1; i < queue.length; i++) if (queue[i].cost < queue[pick].cost) pick = i
      const current = queue.splice(pick, 1)[0]
      if (current.cost !== cost.get(current.id)) continue
      if (current.cost >= best || current.cost > limit) break
      const tail = goalAt.get(current.id)
      if (tail != null) best = Math.min(best, current.cost + tail)
      for (const edge of next.get(current.id) || []) {
        const price = current.cost + edge.metres
        if (price >= (cost.get(edge.id) ?? Infinity)) continue
        cost.set(edge.id, price)
        queue.push({ id: edge.id, cost: price })
      }
    }
    return best
  }
  railGaps.set(ways, gap)
  return gap
}

/** The rails between two places are much longer than the step: the line has changed road with no points. */
function crossesWithoutPoints(gap: RailGap, from: Point, to: Point): boolean {
  const along = gap(from, to)
  if (along == null) return false
  return along > haversineM(from, to) * 1.5 + 40
}

/** How many steps of a line change road where the rails do not join. */
export function roadChangesWithoutPoints(path: LatLngTuple[], ways: Point[][]): number {
  const gap = railGapOf(ways)
  let count = 0
  for (let i = 1; i < path.length; i++) {
    const from = { lat: path[i - 1][0], lng: path[i - 1][1] }
    const to = { lat: path[i][0], lng: path[i][1] }
    if (!Number.isFinite(from.lat) || !Number.isFinite(to.lat)) continue
    if (crossesWithoutPoints(gap, from, to)) count += 1
  }
  return count
}

/**
 * Move a running line onto the left-hand track in the direction of travel.
 * The train changes road only where the rails join, which is a set of
 * points, and only points the train can take in its direction of travel. A
 * parallel road that never meets this one is left alone. A timing point that
 * names its own road stays where it is.
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
  const CELL = 200
  const cellKey = (lat: number, lng: number) => {
    const latM = lat * 110540
    const lngM = lng * 111320 * Math.cos((lat * Math.PI) / 180)
    return `${Math.round(latM / CELL)},${Math.round(lngM / CELL)}`
  }
  const wayCells = new Map<string, number[]>()
  const addCell = (key: string, way: number) => {
    const list = wayCells.get(key)
    if (!list) wayCells.set(key, [way])
    else if (!list.includes(way)) list.push(way)
  }
  for (let w = 0; w < usable.length; w++) {
    const way = usable[w]
    for (let i = 0; i < way.length; i++) {
      addCell(cellKey(way[i].lat, way[i].lng), w)
      if (i === 0) continue
      const dist = haversineM(way[i - 1], way[i])
      const steps = Math.floor(dist / (CELL / 2))
      for (let s = 1; s <= steps; s++) {
        const t = s / (steps + 1)
        addCell(
          cellKey(
            way[i - 1].lat + (way[i].lat - way[i - 1].lat) * t,
            way[i - 1].lng + (way[i].lng - way[i - 1].lng) * t,
          ),
          w,
        )
      }
    }
  }
  const nearWays = (here: Point): number[] => {
    const latM = here.lat * 110540
    const lngM = here.lng * 111320 * Math.cos((here.lat * Math.PI) / 180)
    const row = Math.round(latM / CELL)
    const col = Math.round(lngM / CELL)
    const found: number[] = []
    const seen = new Set<number>()
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const way of wayCells.get(`${row + dy},${col + dx}`) ?? []) {
          if (seen.has(way)) continue
          seen.add(way)
          found.push(way)
        }
      }
    }
    return found
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
    for (const w of nearWays(here)) {
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
  const railGap = railGapOf(usable)
  const held = anchors.map(([lat, lng]) => ({ lat, lng }))
  // A timing point that sits on a rail is a platform's stopping mark. The
  // train is on that road there, whichever side of the pair it is.
  const onRoad = held.map((anchor) => {
    for (const w of nearWays(anchor)) {
      const hit = projectOnWay(usable[w], anchor, null)
      if (hit && hit.distance <= NAMED_ROAD_M) return true
    }
    return false
  })
  const namesRoad = (here: Point) => held.some((anchor, n) => onRoad[n] && haversineM(anchor, here) <= 30)
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
    // A platform's stopping mark is on its own road. Only where roads meet
    // at that mark is there a left-hand one to choose.
    const reach = namesRoad({ lat: path[0][0], lng: path[0][1] }) ? NAMED_ROAD_M : 3
    const openDir = { x: openingTravel.x / openingSpan, y: openingTravel.y / openingSpan }
    const openLeft = { x: -openDir.y, y: openDir.x }
    const origin = { lat: path[0][0], lng: path[0][1] }
    let bestScore = -Infinity
    for (let w = 0; w < usable.length; w++) {
      const hit = projectOnWay(usable[w], origin, openDir)
      if (!hit || hit.distance > reach || hit.forward < 0.7) continue
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
      // At a platform the line is on that platform's own road, and follows
      // it to the points. The road at the start of a run is already chosen.
      if (!onCurrent || onCurrent.distance > 8 || (i > 0 && namesRoad(here))) {
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
    const wayMetres = (way: number) => chainLengthM(usable[way].map((point) => [point.lat, point.lng]))
    const runsForward = (way: number, from: Point, need: number, seen: Set<number>): boolean => {
      if (!dir || seen.has(way)) return false
      seen.add(way)
      if (wayRunsForward(usable[way], from, dir, need)) return true
      if (!wayRunsForward(usable[way], from, dir, 8)) return false
      for (const other of links[way]) {
        const joint = joinNear(way, other, from, 100)
        if (!joint) continue
        const step = localMetres(from, joint)
        if (step.x * dir.x + step.y * dir.y < -8) continue
        if (runsForward(other, joint, need, seen)) return true
      }
      return false
    }
    if (alongside && current != null && dir && left && stay) {
      let hopWay = -1
      let hopThrough: Point[] = []
      let hopAlong = Infinity
      const queue: { way: number; from: Point }[] = [{ way: current, from: here }]
      const seen = new Set<number>([current])
      let guard = 0
      while (queue.length && guard < 8) {
        const scan = queue.shift()
        if (!scan) break
        guard += 1
        for (const other of links[scan.way]) {
          const joint = joinAhead(scan.way, other, scan.from, dir)
          if (!joint) continue
          const offset = localMetres(here, joint)
          const ahead = offset.x * dir.x + offset.y * dir.y
          if (ahead < -80 || ahead > 300 || ahead >= hopAlong) continue
          const lands: { way: number; through: Point[] }[] = []
          if (wayMetres(other) <= 90) {
            for (const id of wayNodes[other]) {
              const end = at.get(id)
              if (!end || haversineM(end, joint) < 3) continue
              for (const beyond of nodeWays.get(id) || []) {
                if (beyond === other || beyond === current || beyond === leftFrom) continue
                const landing = joinNear(other, beyond, joint, 40)
                if (landing) lands.push({ way: beyond, through: [joint, landing] })
              }
            }
          } else {
            if (other !== current && other !== leftFrom) lands.push({ way: other, through: [joint] })
            if (!seen.has(other)) {
              seen.add(other)
              queue.push({ way: other, from: joint })
            }
          }
          for (const land of lands) {
            const nose = pointAheadOnWay(usable[land.way], joint, dir, 20)
            if (!nose || !runsForward(land.way, nose, RUNNING_LINE_M, new Set())) continue
            const stayNose = pointAheadOnWay(usable[current], joint, dir, 20) || joint
            if (scoreOf(nose) - scoreOf(stayNose) < LEFT_SHIFT_M) continue
            // Trailing points join the two roads behind the train. Taking
            // them would mean stepping across and running back.
            if (crossesWithoutPoints(railGap, stay.point, nose)) continue
            hopWay = land.way
            hopThrough = land.through
            hopAlong = ahead
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
    if (placed && current != null && placed.distance <= (alongside ? STAY_ON_TRACK_M : 40)) {
      const previous = out[out.length - 1]
      const from = previous ? { lat: previous[0], lng: previous[1] } : placed.point
      const start = projectHit(usable[current], from)
      const end = projectHit(usable[current], placed.point)
      const sameWay = start && end && start.distance <= 25 && end.distance <= 25
      const forward = Boolean(sameWay && (start.index < end.index || (start.index === end.index && start.t <= end.t)))
      if (forward && start && end) {
        for (let v = start.index; v < end.index; v++) emit(usable[current][v], dir)
      }
      emit(placed.point, dir)
    } else emit(here)
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
    for (const run of splitAtReversals(piece)) {
      const shaped = keepLeftHandTrack(run, ways, anchors)
      // The router's line follows the rails. A shaped line that steps across
      // to another road where there are no points is wrong, so it is not used.
      const crossed = roadChangesWithoutPoints(shaped, ways) > roadChangesWithoutPoints(run, ways)
      appendRun(joined, crossed ? run : shaped)
    }
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

const LEFT_RAIL_M = 6.5

/**
 * Move each point sideways onto the parallel rail to its left. The point
 * stays on the road it is already on when that is the left-hand one, and a
 * step that would turn the line around is refused. Nothing is added ahead
 * or back along a track.
 */
export function slideOntoLeftHandTrack(
  path: LatLngTuple[],
  ways: Point[][],
  anchors: LatLngTuple[] = [],
): LatLngTuple[] {
  const usable = ways.filter((way) => way.length >= 2)
  if (path.length < 2 || usable.length === 0) return path
  const held = anchors.map(([lat, lng]) => ({ lat, lng }))
  const CELL = 250
  const cellKey = (lat: number, lng: number) => {
    const latM = lat * 110540
    const lngM = lng * 111320 * Math.cos((lat * Math.PI) / 180)
    return `${Math.round(latM / CELL)},${Math.round(lngM / CELL)}`
  }
  const cells = new Map<string, number[]>()
  const addCell = (key: string, way: number) => {
    const list = cells.get(key)
    if (!list) cells.set(key, [way])
    else if (!list.includes(way)) list.push(way)
  }
  for (let w = 0; w < usable.length; w++) {
    const way = usable[w]
    for (let i = 0; i < way.length; i++) {
      addCell(cellKey(way[i].lat, way[i].lng), w)
      if (i === 0) continue
      const dist = haversineM(way[i - 1], way[i])
      const steps = Math.floor(dist / (CELL / 2))
      for (let s = 1; s <= steps; s++) {
        const t = s / (steps + 1)
        addCell(
          cellKey(
            way[i - 1].lat + (way[i].lat - way[i - 1].lat) * t,
            way[i - 1].lng + (way[i].lng - way[i - 1].lng) * t,
          ),
          w,
        )
      }
    }
  }
  const nearWays = (here: Point): Point[][] => {
    const latM = here.lat * 110540
    const lngM = here.lng * 111320 * Math.cos((here.lat * Math.PI) / 180)
    const row = Math.round(latM / CELL)
    const col = Math.round(lngM / CELL)
    const found: Point[][] = []
    const seen = new Set<number>()
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        for (const way of cells.get(`${row + dy},${col + dx}`) ?? []) {
          if (seen.has(way)) continue
          seen.add(way)
          found.push(usable[way])
        }
      }
    }
    return found
  }
  const out: LatLngTuple[] = []
  for (let i = 0; i < path.length; i++) {
    const here = { lat: path[i][0], lng: path[i][1] }
    if (held.some((anchor) => haversineM(anchor, here) <= 20)) {
      out.push([here.lat, here.lng])
      continue
    }
    const back = path[Math.max(0, i - 1)]
    const fore = path[Math.min(path.length - 1, i + 1)]
    const travel = localMetres({ lat: back[0], lng: back[1] }, { lat: fore[0], lng: fore[1] })
    const span = Math.hypot(travel.x, travel.y)
    let chosen = here
    if (span >= 8) {
      const dir = { x: travel.x / span, y: travel.y / span }
      const left = { x: -dir.y, y: dir.x }
      let nearest = 8
      let nearestPoint: Point | null = null
      let bestSide = 0
      let bestPoint: Point | null = null
      for (const way of nearWays(here)) {
        const hit = projectOnWay(way, here, dir)
        if (!hit || hit.distance > LEFT_RAIL_M || hit.forward < 0.85) continue
        if (hit.distance < nearest) {
          nearest = hit.distance
          nearestPoint = hit.point
        }
        const offset = localMetres(here, hit.point)
        const side = offset.x * left.x + offset.y * left.y
        if (side < LEFT_SHIFT_M || side > LEFT_RAIL_M || side <= bestSide) continue
        bestSide = side
        bestPoint = hit.point
      }
      chosen = bestPoint ?? nearestPoint ?? here
    }
    const last = out[out.length - 1]
    if (last && span >= 8) {
      const step = localMetres({ lat: last[0], lng: last[1] }, chosen)
      const dir = { x: travel.x / span, y: travel.y / span }
      if (step.x * dir.x + step.y * dir.y < -2) chosen = here
    }
    out.push([chosen.lat, chosen.lng])
  }
  return out.length >= 2 ? out : path
}

/** Put the routed line on the left-hand rail. The route itself is not redrawn. */
export async function shapeOntoLeftHandTrack(
  anchors: LatLngTuple[],
  path: LatLngTuple[],
): Promise<LatLngTuple[]> {
  if (path.length < 2) return path
  const ways = await fetchRailWays(path, 80)
  if (!ways || ways.length === 0) return path
  return slideOntoLeftHandTrack(path, ways, anchors)
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
