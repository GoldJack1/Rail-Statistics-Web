import type { LatLngTuple } from '@/utils/brouterRailRoute'

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
  const routed = chainLengthM(path)
  return chain > 40 && chain < MAX_CHAIN_M && routed > chain * 2.2 && routed - chain > 800
}

function nodeKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`
}

/**
 * Shortest path along railway ways. Shared OSM nodes meet when rounded to
 * about a metre, which joins the ways into one network.
 */
export function railPathFromWays(ways: Point[][], points: LatLngTuple[]): LatLngTuple[] | null {
  if (points.length < 2) return null
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
    const dist = new Map<string, number>([[start, 0]])
    const prev = new Map<string, string>()
    const queue: { id: string; metres: number }[] = [{ id: start, metres: 0 }]
    while (queue.length) {
      let pick = 0
      for (let i = 1; i < queue.length; i++) if (queue[i].metres < queue[pick].metres) pick = i
      const current = queue.splice(pick, 1)[0]
      if (current.id === goal) break
      if (current.metres !== dist.get(current.id)) continue
      for (const edge of next.get(current.id) || []) {
        const metres = current.metres + edge.metres
        if (metres >= (dist.get(edge.id) ?? Infinity)) continue
        dist.set(edge.id, metres)
        prev.set(edge.id, current.id)
        queue.push({ id: edge.id, metres })
      }
    }
    const walked = dist.get(goal)
    const straight = haversineM(from, to)
    if (walked == null || walked > straight * 2.2 + 400) return null
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

async function fetchRailWays(points: LatLngTuple[]): Promise<Point[][] | null> {
  let south = Infinity
  let north = -Infinity
  let west = Infinity
  let east = -Infinity
  for (const [lat, lng] of points) {
    south = Math.min(south, lat)
    north = Math.max(north, lat)
    west = Math.min(west, lng)
    east = Math.max(east, lng)
  }
  const midLat = (south + north) / 2
  const padLat = PAD_M / 110540
  const padLng = PAD_M / (111320 * Math.cos((midLat * Math.PI) / 180))
  const query = `[out:json][timeout:20];way["railway"="rail"](${(south - padLat).toFixed(5)},${(west - padLng).toFixed(5)},${(north + padLat).toFixed(5)},${(east + padLng).toFixed(5)});out geom;`
  const body = new URLSearchParams({ data: query })
  try {
    const response = await fetch('https://overpass.openstreetmap.fr/api/interpreter', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk); rail route',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(18000),
      cache: 'no-store',
    })
    if (!response.ok) return null
    return waysFromOverpass(await response.json())
  } catch {
    return null
  }
}

/** Railway geometry from OpenStreetMap when the router has left the corridor. */
export async function osmRailPath(points: LatLngTuple[]): Promise<LatLngTuple[] | null> {
  if (chainLengthM(points) > MAX_CHAIN_M) return null
  const ways = await fetchRailWays(points)
  if (!ways || ways.length === 0) return null
  return railPathFromWays(ways, points)
}
