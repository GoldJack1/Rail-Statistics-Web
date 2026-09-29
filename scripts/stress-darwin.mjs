#!/usr/bin/env node
/**
 * Closed-loop load test for Darwin (web + app).
 *
 * Models many users polling live boards, with a smaller share opening
 * historical days and service pages. Staggered starts avoid a fake stampede.
 *
 * Direct at the VPS (what the app uses):
 *   INTERNAL_API_KEY=… node scripts/stress-darwin.mjs \
 *     --origin https://api-raildata.railstatistics.co.uk \
 *     --users 450 --seconds 60
 *
 * Through the website proxy (what the browser uses; no API key):
 *   node scripts/stress-darwin.mjs --origin http://127.0.0.1:3000 --proxy --users 80 --seconds 30
 *
 * Safe defaults: 40 users, 20s. Pass --users 450 only when you mean it.
 */

const STATIONS = [
  'LDS', 'KGX', 'PAD', 'MAN', 'EDB', 'BHM', 'GLC', 'BRI',
  'EUS', 'NCL', 'YRK', 'LIV', 'SHF', 'NOT', 'RDG', 'DEW',
]

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1 || i === process.argv.length - 1) return fallback
  return process.argv[i + 1]
}

function flag(name) {
  return process.argv.includes(`--${name}`)
}

function pctile(sorted, p) {
  if (!sorted.length) return 0
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[i]
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function todayLondonYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

const origin = String(arg('origin', 'https://api-raildata.railstatistics.co.uk')).replace(/\/$/, '')
const viaProxy = flag('proxy')
const users = Math.max(1, Number(arg('users', '40')))
const seconds = Math.max(5, Number(arg('seconds', '20')))
const pollMs = Math.max(250, Number(arg('poll-ms', '10000')))
const liveShare = Math.min(1, Math.max(0, Number(arg('live-share', '0.80'))))
const histShare = Math.min(1, Math.max(0, Number(arg('hist-share', '0.15'))))
const key = process.env.INTERNAL_API_KEY || process.env.DARWIN_API_KEY || ''

if (!viaProxy && !key) {
  console.error('Set INTERNAL_API_KEY (or DARWIN_API_KEY), or pass --proxy for the Next /api/darwin path.')
  process.exit(1)
}

const today = todayLondonYmd()
const histDays = [addDays(today, -3), addDays(today, -2), addDays(today, -1)].filter((d) => d < today)

function urlFor(kind, crs, rid) {
  const root = viaProxy ? `${origin}/api/darwin` : `${origin}/api`
  if (kind === 'live') return `${root}/departures/${crs}?hours=1`
  if (kind === 'hist') return `${root}/departures/${crs}?hours=1&date=${pick(histDays.length ? histDays : [addDays(today, -1)])}`
  return `${root}/service/${encodeURIComponent(rid)}`
}

function chooseKind() {
  const r = Math.random()
  if (r < liveShare) return 'live'
  if (r < liveShare + histShare) return 'hist'
  return 'service'
}

const stats = {
  ok: 0,
  err: 0,
  byStatus: {},
  byKind: { live: [], hist: [], service: [] },
  bytes: 0,
}

let lastRidByCrs = new Map()
let stopping = false

async function oneRequest(kind, crs) {
  let rid = lastRidByCrs.get(crs)
  if (kind === 'service' && !rid) kind = 'live'
  const url = urlFor(kind, crs, rid)
  const headers = { accept: 'application/json' }
  if (!viaProxy) headers['X-API-Key'] = key
  const t0 = performance.now()
  try {
    const res = await fetch(url, { headers, cache: 'no-store' })
    const buf = await res.arrayBuffer()
    const ms = performance.now() - t0
    stats.bytes += buf.byteLength
    stats.byStatus[res.status] = (stats.byStatus[res.status] || 0) + 1
    if (res.ok) {
      stats.ok += 1
      stats.byKind[kind].push(ms)
      if (kind !== 'service') {
        try {
          const body = JSON.parse(Buffer.from(buf).toString('utf8'))
          const row = (body.departures || body.arrivals || [])[0]
          if (row?.rid) lastRidByCrs.set(crs, row.rid)
        } catch {
          /* ignore parse for timing */
        }
      }
    } else {
      stats.err += 1
      stats.byKind[kind].push(ms)
    }
  } catch {
    stats.err += 1
    stats.byStatus.network = (stats.byStatus.network || 0) + 1
    stats.byKind[kind].push(performance.now() - t0)
  }
}

async function virtualUser(id, deadline) {
  const stagger = (id / users) * Math.min(pollMs, 4000)
  await new Promise((r) => setTimeout(r, stagger))
  const crsHome = STATIONS[id % STATIONS.length]
  while (!stopping && Date.now() < deadline) {
    const kind = chooseKind()
    const crs = Math.random() < 0.7 ? crsHome : pick(STATIONS)
    await oneRequest(kind, crs)
    const jitter = pollMs * (0.8 + Math.random() * 0.4)
    await new Promise((r) => setTimeout(r, jitter))
  }
}

function summarise(label, samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  if (!sorted.length) return `${label}: n=0`
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length
  return `${label}: n=${sorted.length} avg=${avg.toFixed(0)}ms p50=${pctile(sorted, 50).toFixed(0)}ms p95=${pctile(sorted, 95).toFixed(0)}ms p99=${pctile(sorted, 99).toFixed(0)}ms max=${sorted[sorted.length - 1].toFixed(0)}ms`
}

const deadline = Date.now() + seconds * 1000
console.log(
  `stress-darwin origin=${origin} proxy=${viaProxy} users=${users} seconds=${seconds} pollMs=${pollMs} live=${liveShare} hist=${histShare} stations=${STATIONS.length}`,
)
const tRun = Date.now()
await Promise.all(Array.from({ length: users }, (_, i) => virtualUser(i, deadline)))
stopping = true
const elapsed = (Date.now() - tRun) / 1000
const total = stats.ok + stats.err
console.log(`elapsed=${elapsed.toFixed(1)}s ok=${stats.ok} err=${stats.err} rps=${(total / elapsed).toFixed(1)} bytes=${(stats.bytes / 1024 / 1024).toFixed(1)}MB`)
console.log(`status ${JSON.stringify(stats.byStatus)}`)
console.log(summarise('live', stats.byKind.live))
console.log(summarise('hist', stats.byKind.hist))
console.log(summarise('service', stats.byKind.service))
if (stats.err / Math.max(1, total) > 0.05) process.exit(2)
