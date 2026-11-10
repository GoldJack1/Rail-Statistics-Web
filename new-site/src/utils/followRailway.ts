import type { LatLngTuple } from './brouterRailRoute'

/**
 * A single straight longer than this is a simplified graph edge. The railway
 * underneath it bends, so the straight jumps across the curve.
 */
export const RAIL_JUMP_M = 400

function metres(a: LatLngTuple, b: LatLngTuple): number {
  const lat = ((a[0] + b[0]) / 2) * (Math.PI / 180)
  const dy = (b[0] - a[0]) * 111_320
  const dx = (b[1] - a[1]) * 111_320 * Math.cos(lat)
  return Math.hypot(dx, dy)
}

/**
 * The replacement is the same railway. A much longer path has left the
 * corridor, and a much shorter one has cut across to a different line.
 * Two points the same length as the straight are still the jump.
 */
export function railwayLegFits(leg: LatLngTuple[], from: LatLngTuple, to: LatLngTuple): boolean {
  if (leg.length < 2) return false
  const chord = metres(from, to)
  if (chord < 1) return false
  let rail = 0
  let longest = 0
  for (let i = 1; i < leg.length; i++) {
    const step = metres(leg[i - 1], leg[i])
    rail += step
    if (step > longest) longest = step
  }
  if (rail > chord * 1.8 + 400) return false
  if (rail < chord * 0.85) return false
  if (leg.length < 3 && longest >= RAIL_JUMP_M) return false
  return true
}

/**
 * Replace each long straight with the railway between its ends. A leg that
 * would leave the corridor is refused, and the straight stays until a path
 * on the tracks is found.
 */
export function followRailway(
  path: LatLngTuple[],
  routeLeg: (from: LatLngTuple, to: LatLngTuple) => LatLngTuple[] | null,
): LatLngTuple[] {
  if (path.length < 2) return path
  const out: LatLngTuple[] = []
  const push = (point: LatLngTuple) => {
    const last = out[out.length - 1]
    if (
      last
      && Number.isFinite(last[0])
      && Number.isFinite(point[0])
      && Math.abs(last[0] - point[0]) < 1e-7
      && Math.abs(last[1] - point[1]) < 1e-7
    ) return
    out.push(point)
  }
  for (let i = 0; i < path.length; i++) {
    const point = path[i]
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
      push(point)
      continue
    }
    const prev = i > 0 ? path[i - 1] : null
    if (!prev || !Number.isFinite(prev[0]) || !Number.isFinite(prev[1])) {
      push(point)
      continue
    }
    if (metres(prev, point) < RAIL_JUMP_M) {
      push(point)
      continue
    }
    const leg = routeLeg(prev, point)
    if (!leg || !railwayLegFits(leg, prev, point)) {
      push(point)
      continue
    }
    for (const step of leg) push(step)
    push(point)
  }
  return out.length >= 2 ? out : path
}
