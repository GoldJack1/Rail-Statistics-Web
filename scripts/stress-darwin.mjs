#!/usr/bin/env node
/**
 * Darwin site-surface load test (web proxy or direct API).
 *
 * Covers: live/historical boards, arrivals, hours windows, service pages,
 * formation-style extra /service calls, units catalog + unit diagram,
 * bash planner, health, history/dates.
 *
 * Not covered (by request): station search, fares, maps, accounts, Stripe.
 *
 * Mixes (--mix):
 *   balanced  default Darwin site mix
 *   live-app  mostly live boards + some service (typical app users)
 *   history   mostly dated boards/services
 *   pages     departures, arrivals, service detail, units catalog, unit detail, bash
 *
 * Website:
 *   node scripts/stress-darwin.mjs --site --origin https://railstatistics.co.uk --mix history --users 450 --seconds 40
 */

const STATIONS = [
  'LDS', 'KGX', 'PAD', 'MAN', 'EDB', 'BHM', 'GLC', 'BRI',
  'EUS', 'NCL', 'YRK', 'LIV', 'SHF', 'NOT', 'RDG', 'DEW',
]

const HOURS = [1, 1, 1, 3, 6]
const BASH_PLANS = [
  { start: 'LDS', end: 'YRK', visit: ['DEW'] },
  { start: 'KGX', end: 'NCL', visit: ['YRK'] },
  { start: 'PAD', end: 'RDG', visit: ['BRI'] },
  { start: 'MAN', end: 'LDS', visit: ['SHF'] },
]

const MIXES = {
  balanced: [
    ['live', 0.34],
    ['arrivals', 0.08],
    ['detailed', 0.12],
    ['hist', 0.14],
    ['serviceLive', 0.10],
    ['units', 0.08],
    ['bash', 0.04],
    ['meta', 0.10],
  ],
  'live-app': [
    ['live', 0.58],
    ['arrivals', 0.12],
    ['detailed', 0.05],
    ['hist', 0.04],
    ['serviceLive', 0.14],
    ['units', 0.02],
    ['bash', 0.01],
    ['meta', 0.04],
  ],
  history: [
    ['live', 0.10],
    ['arrivals', 0.04],
    ['detailed', 0.04],
    ['hist', 0.48],
    ['serviceLive', 0.06],
    ['units', 0.08],
    ['bash', 0.02],
    ['meta', 0.18],
  ],
  pages: [
    ['live', 0.28],
    ['arrivals', 0.15],
    ['serviceLive', 0.22],
    ['units', 0.18],
    ['bash', 0.17],
  ],
  heavy: [
    ['live', 0.12],
    ['arrivals', 0.04],
    ['detailed', 0.28],
    ['hist', 0.10],
    ['serviceLive', 0.08],
    ['units', 0.22],
    ['bash', 0.12],
    ['meta', 0.04],
  ],
}

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

function assignRole(id, n, shares) {
  const t = (id + 0.5) / n
  let acc = 0
  for (const [role, share] of shares) {
    acc += share
    if (t <= acc) return role
  }
  return 'live'
}

const origin = String(arg('origin', 'https://api-raildata.railstatistics.co.uk')).replace(/\/$/, '')
const viaProxy = flag('proxy') || flag('site')
const mixName = String(arg('mix', 'balanced'))
const ROLE_SHARES = MIXES[mixName]
if (!ROLE_SHARES) {
  console.error(`Unknown --mix ${mixName}. Use: ${Object.keys(MIXES).join(', ')}`)
  process.exit(1)
}
const users = Math.max(1, Number(arg('users', '40')))
const seconds = Math.max(5, Number(arg('seconds', '20')))
const pollMs = Math.max(250, Number(arg('poll-ms', '10000')))
const key = process.env.INTERNAL_API_KEY || process.env.DARWIN_API_KEY || ''

if (!viaProxy && !key) {
  console.error('Set INTERNAL_API_KEY (or DARWIN_API_KEY), or pass --site / --proxy.')
  process.exit(1)
}

const today = todayLondonYmd()
const histDays = [addDays(today, -3), addDays(today, -2), addDays(today, -1)].filter((d) => d < today)
const root = viaProxy ? `${origin}/api/darwin` : `${origin}/api`

const KINDS = [
  'live', 'arrivals', 'hist', 'service', 'formation',
  'catalog', 'unit', 'bash', 'health', 'historyDates', 'station',
]

const stats = {
  ok: 0,
  err: 0,
  byStatus: {},
  byKind: Object.fromEntries(KINDS.map((k) => [k, []])),
  bytes: 0,
}

const lastRidsByCrs = new Map()
let unitIds = []
let stopping = false

function headers(jsonBody) {
  const h = { accept: 'application/json' }
  if (!viaProxy) h['X-API-Key'] = key
  if (jsonBody) h['Content-Type'] = 'application/json'
  return h
}

function rememberRids(crs, body) {
  const rows = [...(body.departures || []), ...(body.arrivals || [])]
  const rids = rows.map((row) => row?.rid).filter(Boolean).slice(0, 8)
  if (rids.length) lastRidsByCrs.set(crs, rids)
}

function ridsFor(crs) {
  return lastRidsByCrs.get(crs) || []
}

async function request(kind, url, init = {}) {
  const t0 = performance.now()
  try {
    const res = await fetch(url, { cache: 'no-store', ...init })
    const buf = await res.arrayBuffer()
    const ms = performance.now() - t0
    stats.bytes += buf.byteLength
    stats.byStatus[res.status] = (stats.byStatus[res.status] || 0) + 1
    const samples = stats.byKind[kind] || (stats.byKind[kind] = [])
    samples.push(ms)
    if (res.ok) {
      stats.ok += 1
      let body = null
      try {
        body = JSON.parse(Buffer.from(buf).toString('utf8'))
      } catch {
        body = null
      }
      return { ok: true, status: res.status, body, ms }
    }
    stats.err += 1
    return { ok: false, status: res.status, body: null, ms }
  } catch {
    stats.err += 1
    stats.byStatus.network = (stats.byStatus.network || 0) + 1
    const samples = stats.byKind[kind] || (stats.byKind[kind] = [])
    samples.push(performance.now() - t0)
    return { ok: false, status: 0, body: null, ms: 0 }
  }
}

async function hitLive(crs, hours = pick(HOURS)) {
  const res = await request('live', `${root}/departures/${crs}?hours=${hours}`, { headers: headers() })
  if (res.ok && res.body) rememberRids(crs, res.body)
  return res
}

async function hitArrivals(crs) {
  const res = await request('arrivals', `${root}/departures/${crs}?hours=1`, { headers: headers() })
  if (res.ok && res.body) rememberRids(crs, res.body)
  return res
}

async function hitHist(crs) {
  const date = pick(histDays.length ? histDays : [addDays(today, -1)])
  const withAt = Math.random() < 0.35
  const qs = withAt ? `hours=1&date=${date}&at=12:00` : `hours=1&date=${date}`
  const res = await request('hist', `${root}/departures/${crs}?${qs}`, { headers: headers() })
  if (res.ok && res.body) rememberRids(crs, res.body)
  return res
}

async function hitService(crs, historical) {
  let rid = ridsFor(crs)[0]
  if (!rid) {
    await (historical ? hitHist(crs) : hitLive(crs, 1))
    rid = ridsFor(crs)[0]
  }
  if (!rid) return
  const date = historical ? pick(histDays.length ? histDays : [addDays(today, -1)]) : ''
  const qs = date ? `?date=${date}` : ''
  await request('service', `${root}/service/${encodeURIComponent(rid)}${qs}`, { headers: headers() })
}

async function hitFormation(crs) {
  await hitLive(crs, 1)
  const rids = ridsFor(crs).slice(0, 4)
  for (const rid of rids) {
    await request('formation', `${root}/service/${encodeURIComponent(rid)}`, { headers: headers() })
  }
}

async function hitCatalog() {
  const res = await request('catalog', `${root}/units/catalog`, { headers: headers() })
  const units = res.body?.units
  if (Array.isArray(units) && units.length) {
    unitIds = units
      .map((u) => (Array.isArray(u) ? u[0] : u?.unitId || u?.id))
      .filter(Boolean)
      .slice(0, 80)
  }
}

async function hitUnit() {
  if (!unitIds.length) await hitCatalog()
  const id = pick(unitIds.length ? unitIds : ['390001'])
  const dated = Math.random() < 0.4 && histDays.length
  const qs = dated ? `?date=${pick(histDays)}` : ''
  await request('unit', `${root}/unit/${encodeURIComponent(id)}${qs}`, { headers: headers() })
}

async function hitBash() {
  const plan = pick(BASH_PLANS)
  const body = JSON.stringify({
    date: today,
    at: '12:00',
    start: plan.start,
    end: plan.end,
    visit: plan.visit,
  })
  await request('bash', `${root}/plan/bash`, { method: 'POST', headers: headers(true), body })
}

async function hitMeta(crs) {
  const roll = Math.random()
  if (roll < 0.4) await request('health', `${root}/health`, { headers: headers() })
  else if (roll < 0.75) await request('historyDates', `${root}/history/dates`, { headers: headers() })
  else await request('station', `${root}/station/${crs}`, { headers: headers() })
}

async function tick(role, crs) {
  switch (role) {
    case 'live':
      await hitLive(crs)
      break
    case 'arrivals':
      await hitArrivals(crs)
      break
    case 'detailed':
      await hitFormation(crs)
      break
    case 'hist':
      await hitHist(crs)
      if (Math.random() < 0.5) await hitService(crs, true)
      break
    case 'serviceLive':
      await hitService(crs, false)
      break
    case 'units':
      if (Math.random() < 0.35 || !unitIds.length) await hitCatalog()
      else await hitUnit()
      break
    case 'bash':
      await hitBash()
      break
    default:
      await hitMeta(crs)
  }
}

function rolePollMs(role) {
  if (role === 'bash') return pollMs * 3
  if (role === 'units') return pollMs * 2
  if (role === 'detailed') return pollMs * 1.2
  if (role === 'meta') return pollMs * 1.8
  return pollMs
}

async function virtualUser(id, deadline) {
  const role = assignRole(id, users, ROLE_SHARES)
  const stagger = (id / users) * Math.min(pollMs, 5000)
  await new Promise((r) => setTimeout(r, stagger))
  const crsHome = STATIONS[id % STATIONS.length]
  const interval = rolePollMs(role)
  while (!stopping && Date.now() < deadline) {
    const crs = Math.random() < 0.7 ? crsHome : pick(STATIONS)
    await tick(role, crs)
    await new Promise((r) => setTimeout(r, interval * (0.8 + Math.random() * 0.4)))
  }
}

function summarise(label, samples) {
  const sorted = [...samples].sort((a, b) => a - b)
  if (!sorted.length) return `${label}: n=0`
  const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length
  return `${label}: n=${sorted.length} avg=${avg.toFixed(0)}ms p50=${pctile(sorted, 50).toFixed(0)}ms p95=${pctile(sorted, 95).toFixed(0)}ms p99=${pctile(sorted, 99).toFixed(0)}ms max=${sorted[sorted.length - 1].toFixed(0)}ms`
}

const deadline = Date.now() + seconds * 1000
const roleCounts = {}
for (let i = 0; i < users; i++) {
  const role = assignRole(i, users, ROLE_SHARES)
  roleCounts[role] = (roleCounts[role] || 0) + 1
}
console.log(
  `stress-darwin mix=${mixName} origin=${origin} proxy=${viaProxy} users=${users} seconds=${seconds} pollMs=${pollMs}`,
)
console.log(`roles ${JSON.stringify(roleCounts)}`)
const tRun = Date.now()
await Promise.all(Array.from({ length: users }, (_, i) => virtualUser(i, deadline)))
stopping = true
const elapsed = (Date.now() - tRun) / 1000
const total = stats.ok + stats.err
console.log(`elapsed=${elapsed.toFixed(1)}s ok=${stats.ok} err=${stats.err} rps=${(total / elapsed).toFixed(1)} bytes=${(stats.bytes / 1024 / 1024).toFixed(1)}MB`)
console.log(`status ${JSON.stringify(stats.byStatus)}`)
for (const kind of Object.keys(stats.byKind)) {
  console.log(summarise(kind, stats.byKind[kind]))
}
const hard = (stats.byStatus['500'] || 0) + (stats.byStatus['502'] || 0) + (stats.byStatus['503'] || 0) + (stats.byStatus['504'] || 0) + (stats.byStatus.network || 0)
if (hard / Math.max(1, total) > 0.05) process.exit(2)
