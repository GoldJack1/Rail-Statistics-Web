/**
 * Download Great Britain route=train ways from OpenStreetMap and write the
 * compact line file the Tracks map routes on.
 *
 *   node scripts/fetch-gb-rail-graph.mjs
 */
import fs from 'node:fs'

const boxes = [
  ['ni', 54.0, -8.2, 55.4, -5.3],
  ['scotland-n', 57.2, -7.6, 60.9, -0.6],
  ['scotland-s', 54.8, -6.0, 57.4, -1.4],
  ['north', 53.6, -3.6, 55.2, 0.2],
  ['northwest', 53.2, -3.6, 54.6, -1.4],
  ['wales', 51.3, -5.6, 53.4, -2.8],
  ['midlands', 52.2, -2.6, 53.6, 0.4],
  ['east', 51.6, -0.6, 53.2, 1.8],
  ['southwest', 49.9, -6.4, 51.6, -2.2],
  ['south', 50.6, -2.3, 51.6, 1.5],
  ['london', 51.2, -0.6, 51.9, 0.4],
]

const headers = {
  'Content-Type': 'application/x-www-form-urlencoded',
  'User-Agent': 'RailStatisticsWebsite/1.0 (+https://railstatistics.co.uk)',
}
const url = 'https://overpass.openstreetmap.fr/api/interpreter'
const byId = new Map()

for (const [name, s, w, n, e] of boxes) {
  const query = `[out:json][timeout:90];
relation["route"="train"](${s},${w},${n},${e});
way(r)["railway"="rail"];
out geom;`
  let ok = false
  for (let attempt = 1; attempt <= 3 && !ok; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: 'data=' + encodeURIComponent(query),
      signal: AbortSignal.timeout(120000),
    })
    if (!res.ok) {
      console.log(name, res.status)
      await new Promise((resolve) => setTimeout(resolve, 4000 * attempt))
      continue
    }
    const json = await res.json()
    for (const el of json.elements || []) {
      if (el.type === 'way' && el.id) byId.set(el.id, el)
    }
    console.log(name, (json.elements || []).length)
    ok = true
  }
  if (!ok) throw new Error(`Overpass failed for ${name}`)
}

const raw = 'public/data/gb-passenger-rail.overpass.json'
fs.mkdirSync('public/data', { recursive: true })
fs.writeFileSync(raw, JSON.stringify({ elements: [...byId.values()] }))
console.log('ways', byId.size)
await import('./build-gb-rail-graph.mjs')
