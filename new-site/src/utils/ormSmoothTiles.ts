import { VectorTile } from '@mapbox/vector-tile'
import { fromVectorTileJs } from '@maplibre/vt-pbf'
import * as maplibregl from 'maplibre-gl'
import Pbf from 'pbf'
import { filletSharpBend } from './tracksRailRoute'

const EARTH_M = 40_075_016.686
/** Same curve the route line uses, so the tracks and the journey bend together. */
const TRACK_FILLET_M = 28

type TilePoint = { x: number; y: number }
type LineFeature = {
  type: number
  loadGeometry: () => TilePoint[][]
}

let ready = false

function tileLatitude(z: number, y: number): number {
  const n = 2 ** z
  return Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n)))
}

function filletTile(buffer: ArrayBuffer, z: number, y: number): Uint8Array {
  const tile = new VectorTile(new Pbf(buffer))
  for (const layer of Object.values(tile.layers)) {
    const extent = layer.extent || 4096
    const tileMetres = (EARTH_M * Math.cos(tileLatitude(z, y))) / 2 ** z
    const maxCut = (TRACK_FILLET_M * extent) / tileMetres
    for (let index = 0; index < layer.length; index += 1) {
      const feature = layer.feature(index) as LineFeature
      if (feature.type !== 2) continue
      const rings = feature.loadGeometry().map((ring) => {
        const smoothed = filletSharpBend(ring.map((point) => [point.x, point.y] as [number, number]), maxCut)
        return smoothed.map(([x, yPoint]) => ({ x: Math.round(x), y: Math.round(yPoint) }))
      })
      feature.loadGeometry = () => rings
    }
  }
  return fromVectorTileJs(tile)
}

function emptyTile(): Uint8Array {
  return fromVectorTileJs({
    layers: {
      empty: { version: 2, name: 'empty', extent: 4096, length: 0, feature: () => null },
    },
  })
}

function parseSmoothTile(url: string): { upstream: string; z: number; y: number } | null {
  const path = url.replace(/^smoothorm:\/\//, '').split('?')[0]
  const parts = path.split('/')
  const y = Number(parts.at(-1))
  const z = Number(parts.at(-3))
  if (!Number.isInteger(z) || !Number.isInteger(y) || z < 0) return null
  return { upstream: `https://openrailwaymap.app/${path}`, z, y }
}

/** Fetches OpenRailwayMap tiles and rounds the hard corners the tiles leave in a curve. */
export function ensureOrmSmoothProtocol() {
  if (ready || typeof window === 'undefined') return
  ready = true
  maplibregl.addProtocol('smoothorm', async (params, abortController) => {
    const tile = parseSmoothTile(params.url)
    if (!tile) return { data: emptyTile().buffer }
    const response = await fetch(tile.upstream, {
      signal: abortController.signal,
      headers: { Accept: 'application/x-protobuf' },
    })
    if (!response.ok || response.status === 204) return { data: emptyTile().buffer }
    const raw = await response.arrayBuffer()
    if (raw.byteLength === 0) return { data: emptyTile().buffer }
    try {
      const smoothed = filletTile(raw, tile.z, tile.y)
      return { data: smoothed.buffer.slice(smoothed.byteOffset, smoothed.byteOffset + smoothed.byteLength) }
    } catch {
      return { data: raw }
    }
  })
}
