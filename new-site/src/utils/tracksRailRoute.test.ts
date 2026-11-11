import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RailVia } from './serviceJourneyMap'
import { fetchPlatformRailRoute } from './tracksRailRoute'

type Point = [number, number]

function via(point: Point, call = true, extra: Partial<RailVia> = {}): RailVia {
  return { lat: point[0], lng: point[1], exact: false, loose: { lat: point[0], lng: point[1] }, call, ...extra }
}

/** Answers each rail-route request from the points it was asked to pass. */
function routeWith(answer: (points: Point[]) => Point[]): Point[][] {
  const asked: Point[][] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string) => {
    const params = new URL(input, 'https://example.test').searchParams
    const points: Point[] = [[Number(params.get('fromLat')), Number(params.get('fromLng'))]]
    for (const part of (params.get('via') || '').split('|').filter(Boolean)) {
      const [lat, lng] = part.split(',').map(Number)
      points.push([lat, lng])
    }
    points.push([Number(params.get('toLat')), Number(params.get('toLng'))])
    asked.push(points)
    return new Response(JSON.stringify({ coordinates: answer(points), fallback: false }))
  }))
  return asked
}

function sharpTurns(path: Point[]): number {
  let turns = 0
  for (let i = 1; i < path.length - 1; i++) {
    const a = [path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]]
    const b = [path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]]
    if (a[0] * b[0] + a[1] * b[1] < 0) turns += 1
  }
  return turns
}

const THIRSK: Point = [54.228474, -1.373245]
const PIN: Point = [54.3330789, -1.441275691]
const YARM: Point = [54.49377475, -1.353090201]
const THROUGH: Point[] = [THIRSK, [54.32963, -1.43969], [54.33515, -1.44299], [54.33572, -1.44328], [54.34136, -1.44223], YARM]
const SHUNT: Point[] = [
  THIRSK, [54.32963, -1.43969], [54.33515, -1.44299], [54.33572, -1.44328],
  [54.33302, -1.44166],
  [54.33572, -1.44328], [54.34136, -1.44223], YARM,
]

afterEach(() => vi.unstubAllGlobals())

describe('platform rail route', () => {
  it('leaves out a pin the route shunts back to when the line still serves the station', async () => {
    const asked = routeWith((points) => (points.length === 3 ? SHUNT : THROUGH))
    const path = await fetchPlatformRailRoute([via(THIRSK), via(PIN), via(YARM)], new AbortController().signal)
    expect(asked.map((points) => points.length)).toEqual([3, 2])
    expect(path && sharpTurns(path)).toBe(0)
  })

  it('keeps a call whose reverse is the booked working', async () => {
    // Without the call the line runs nowhere near the station.
    const bypass: Point[] = [THIRSK, [54.3, -1.3], YARM]
    const asked = routeWith((points) => (points.length === 3 ? SHUNT : bypass))
    const path = await fetchPlatformRailRoute([via(THIRSK), via(PIN), via(YARM)], new AbortController().signal)
    expect(asked.map((points) => points.length)).toEqual([3, 2, 3])
    expect(path?.some((point) => Math.abs(point[0] - 54.33302) < 1e-4)).toBe(true)
  })

  it('keeps a reverse at a booked platform', async () => {
    const asked = routeWith(() => SHUNT)
    const booked = via([54.332818, -1.441544], true, { exact: true, loose: { lat: PIN[0], lng: PIN[1] } })
    await fetchPlatformRailRoute([via(THIRSK), booked, via(YARM)], new AbortController().signal)
    expect(asked).toHaveLength(1)
  })
})
