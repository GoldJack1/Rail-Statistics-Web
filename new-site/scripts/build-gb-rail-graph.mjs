/**
 * Turn an Overpass `out geom` download of GB route=train ways into the compact
 * line file the service map routes on. Run after saving the Overpass JSON:
 *
 *   node scripts/build-gb-rail-graph.mjs public/data/gb-passenger-rail.overpass.json
 */
import fs from 'node:fs'

const source = process.argv[2] || 'public/data/gb-passenger-rail.overpass.json'
const target = 'public/data/gb-passenger-rail.json'
const MIN_M = 40

function metres(a, b) {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLon = (b[0] - a[0]) * rad
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2
  return 12742000 * Math.asin(Math.min(1, Math.sqrt(x)))
}

function thin(coords) {
  if (coords.length < 2) return []
  const out = [coords[0]]
  for (let i = 1; i < coords.length - 1; i++) {
    if (metres(out[out.length - 1], coords[i]) >= MIN_M) out.push(coords[i])
  }
  const last = coords[coords.length - 1]
  if (metres(out[out.length - 1], last) > 1) out.push(last)
  return out.length >= 2 ? out : []
}

const raw = JSON.parse(fs.readFileSync(source, 'utf8'))
const lines = []
for (const el of raw.elements || []) {
  if (!el.geometry || el.geometry.length < 2) continue
  const coords = []
  for (const point of el.geometry) {
    if (!Number.isFinite(point.lon) || !Number.isFinite(point.lat)) continue
    coords.push([Math.round(point.lon * 1e5) / 1e5, Math.round(point.lat * 1e5) / 1e5])
  }
  const kept = thin(coords)
  if (kept.length >= 2) lines.push(kept)
}

fs.writeFileSync(target, JSON.stringify({ lines }))
const bytes = fs.statSync(target).size
console.log(`${lines.length} lines, ${(bytes / 1e6).toFixed(1)} MB -> ${target}`)
