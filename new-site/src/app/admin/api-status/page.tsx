'use client'

import React, { useEffect, useMemo, useState } from 'react'
import { collection, getCountFromServer } from 'firebase/firestore'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { PageTopHeader } from '@/components/misc'
import { BUTWideButton } from '@/components/buttons'
import {
  NETWORK_COLLECTION_IDS,
  NETWORK_LABELS,
  SANDBOX_COLLECTION_ID,
} from '@/constants/stationCollections'
import { GBNR_PASS_USAGE_DATA_COLLECTION } from '@/constants/gbnrPassUsageData'
import { GBNR_ODM_FLOWS_COLLECTION } from '@/constants/gbnrOdmFlows'
import { TOC_OPERATORS_COLLECTION } from '@/utils/tocOperatorMap'
import { NETWORK_MESSAGES_COLLECTION } from '@/types/networkMessages'
import { SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION } from '@/services/firebase'
import { getInAppMessagesCollectionName } from '@/services/messageCentre'
import { ApiStatusSparkline, type SparkPoint } from './ApiStatusSparkline'
import './ApiStatusPage.css'

type HostPayload = {
  hostname?: string
  cores?: number
  loadAvg?: number[]
  cpuPercent?: number | null
  processCpuPercent?: number | null
  memory?: {
    totalMB?: number
    freeMB?: number
    usedMB?: number
    usedPercent?: number | null
  }
  disk?: {
    path?: string
    totalBytes?: number
    freeBytes?: number
    usedBytes?: number
    usedPercent?: number | null
  }
  osUptimeSec?: number
}

type HealthPayload = {
  ok: boolean
  mode?: string
  liveCachesReady?: boolean
  heavyReloadBusy?: boolean
  heavyReloadReason?: string
  clientReadsAllowed?: boolean
  loadedDate?: string
  startedAt?: string
  processStartedAt?: string
  uptimeSec?: number
  uptimeMs?: number
  journeysLoaded?: number
  tiplocsIndexed?: number
  timetableFile?: string
  memoryMB?: { heap?: number; rss?: number }
  host?: HostPayload
  kafka?: {
    consumed?: number
    updates?: number
    startedAt?: string
    lastKafkaMsgAt?: string
    sinceProcessStart?: boolean
    processStartedAt?: string
  }
  ptac?: {
    enabled?: boolean
    consumed?: number
    matched?: number
    unmatched?: number
    errors?: number
    lastMessageAt?: string
    unitsOnLoadedDate?: number
    consistsOnLoadedDate?: number
    topic?: string
  }
  overlaySize?: {
    live?: number
    cancelled?: number
    delayed?: number
    formations?: number
    consists?: number
    units?: number
    unmatchedConsists?: number
    stationsWithMessages?: number
    messages?: number
    ridsWithAssociations?: number
    ridsWithAlerts?: number
  }
  persistence?: {
    intervalSec?: number
    lastPersistAt?: string
    stateFile?: string
    fileSizeBytes?: number
    overlayDiffLog?: boolean
  }
  unitCatalog?: {
    size?: number
    lastPersistAt?: string
    store?: 'sqlite'
    sqlite?: {
      path?: string
      bytes?: number | null
      blobBytes?: number | null
      units?: number
      savedAt?: string | null
      exists?: boolean
      error?: string | null
    }
    lastLoad?: { source?: string | null; ms?: number | null; at?: string | null }
  }
  warmup?: {
    enabled?: boolean
    days?: number
    startedAt?: string | null
    finishedAt?: string | null
    current?: string | null
    done?: number
    skipped?: number
    errors?: number
  }
  history?: { retentionDays?: number; dates?: string[] }
}

type HistoryDatesPayload = {
  count: number
  retentionDays: number
  totalBytes?: number
  dates: Array<{
    date: string
    hasState: boolean
    hasTimetable: boolean
    snapshots: string[]
    bytes?: number
    historyBytes?: number
    timetableBytes?: number
    historyFiles?: number
    timetableFiles?: number
  }>
}

type SamplePoint = {
  t: number
  cpu: number | null
  ram: number | null
  heap: number | null
  rss: number | null
  kafkaPerMin: number | null
  kafkaConsumed: number | null
}

type FirebaseCounts = {
  stations: Array<{ id: string; label: string; count: number | null }>
  other: Array<{ id: string; label: string; count: number | null }>
  uas: Array<{ id: string; label: string; count: number | null; error?: string }>
}

const SAMPLE_KEY = 'rs-api-status-samples-v2'
const MAX_SAMPLES = 48

function formatNum(v: unknown): string {
  return typeof v === 'number' ? v.toLocaleString('en-GB') : '-'
}

function displayDateTime(isoLike: string): string {
  const d = new Date(isoLike)
  if (Number.isNaN(d.getTime())) return isoLike
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function formatBytes(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return '-'
  if (v < 1024) return `${Math.round(v)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = v / 1024
  let idx = 0
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024
    idx += 1
  }
  const rounded = size >= 100 ? Math.round(size) : Number(size.toFixed(1))
  return `${rounded.toLocaleString('en-GB')} ${units[idx]}`
}

function pickNumber(...values: Array<unknown>): number | null {
  for (const v of values) {
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
  }
  return null
}

function formatUptimeFromMs(v: unknown): string {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return '-'
  const totalSec = Math.floor(v / 1000)
  const days = Math.floor(totalSec / 86_400)
  const hours = Math.floor((totalSec % 86_400) / 3600)
  const mins = Math.floor((totalSec % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h ${mins}m`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

function pct(v: unknown): string {
  return typeof v === 'number' && Number.isFinite(v) ? `${v.toFixed(1)}%` : '-'
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="api-status-card">
      <h3>{title}</h3>
      <p>{children}</p>
    </article>
  )
}

function Gauge({ label, value }: { label: string; value: number | null }) {
  const clamped = typeof value === 'number' ? Math.max(0, Math.min(100, value)) : 0
  return (
    <div className="api-gauge">
      <div className="api-gauge-head">
        <span>{label}</span>
        <strong>{pct(value)}</strong>
      </div>
      <div className="api-gauge-track" aria-hidden>
        <div className="api-gauge-fill" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  )
}

function loadSamples(): SamplePoint[] {
  try {
    const raw = sessionStorage.getItem(SAMPLE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SamplePoint[]
    return Array.isArray(parsed) ? parsed.slice(-MAX_SAMPLES) : []
  } catch {
    return []
  }
}

function saveSamples(samples: SamplePoint[]) {
  try {
    sessionStorage.setItem(SAMPLE_KEY, JSON.stringify(samples.slice(-MAX_SAMPLES)))
  } catch {
    /* ignore quota */
  }
}

async function countCollection(
  db: import('firebase/firestore').Firestore,
  name: string
): Promise<number | null> {
  try {
    const snap = await getCountFromServer(collection(db, name))
    return snap.data().count
  } catch {
    return null
  }
}

const ApiStatusPage: React.FC = () => {
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [available, setAvailable] = useState<HistoryDatesPayload | null>(null)
  const [samples, setSamples] = useState<SamplePoint[]>([])
  const [firebaseCounts, setFirebaseCounts] = useState<FirebaseCounts | null>(null)
  const [firebaseError, setFirebaseError] = useState<string | null>(null)

  const runFetch = async (isInitial = false) => {
    if (isInitial) setStatus('loading')
    try {
      const res = await fetchDarwin('/api/darwin/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const next: HealthPayload = await res.json()
      setHealth(next)
      const now = Date.now()
      setLastUpdatedAt(new Date(now).toISOString())
      setStatus('ok')
      setError(null)
      setSamples((prev) => {
        const last = prev[prev.length - 1]
        const consumed = pickNumber(next.kafka?.consumed)
        let kafkaPerMin: number | null = null
        if (last && typeof consumed === 'number' && typeof last.kafkaConsumed === 'number') {
          const dtMin = (now - last.t) / 60_000
          if (dtMin > 0) kafkaPerMin = Math.max(0, (consumed - last.kafkaConsumed) / dtMin)
        }
        const point: SamplePoint = {
          t: now,
          cpu: pickNumber(next.host?.cpuPercent),
          ram: pickNumber(next.host?.memory?.usedPercent),
          heap: pickNumber(next.memoryMB?.heap),
          rss: pickNumber(next.memoryMB?.rss),
          kafkaPerMin,
          kafkaConsumed: consumed,
        }
        const nextSamples = [...prev, point].slice(-MAX_SAMPLES)
        saveSamples(nextSamples)
        return nextSamples
      })
    } catch (e) {
      setStatus('error')
      const msg = (e as Error)?.message || 'Failed to load health.'
      setError(msg)
    }
  }

  const fetchAvailable = async () => {
    try {
      const res = await fetchDarwin('/api/darwin/history/dates?snapshots=1&sizes=1')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const payload: HistoryDatesPayload = await res.json()
      setAvailable(payload)
    } catch {}
  }

  const fetchFirebase = async () => {
    try {
      const firebase = await import('@/services/firebase')
      await firebase.initializeFirebase()
      const db = firebase.getFirebaseDB()
      if (!db) throw new Error('Firestore not initialised')

      const stationRows = await Promise.all(
        [...NETWORK_COLLECTION_IDS, SANDBOX_COLLECTION_ID].map(async (id) => ({
          id,
          label: id === SANDBOX_COLLECTION_ID ? 'Sandbox' : NETWORK_LABELS[id],
          count: await countCollection(db, id),
        }))
      )
      const other = await Promise.all(
        [
          { id: TOC_OPERATORS_COLLECTION, label: 'TOC operators' },
          { id: SCHEDULED_STATION_PUBLISH_JOBS_COLLECTION, label: 'Scheduled publish jobs' },
          { id: NETWORK_MESSAGES_COLLECTION, label: 'Network messages' },
          { id: getInAppMessagesCollectionName(), label: 'In-app messages' },
          { id: GBNR_PASS_USAGE_DATA_COLLECTION, label: 'GBNR passenger usage rows' },
          { id: GBNR_ODM_FLOWS_COLLECTION, label: 'GBNR ODM flows' },
        ].map(async (row) => ({ ...row, count: await countCollection(db, row.id) }))
      )

      let uas: FirebaseCounts['uas'] = []
      try {
        const uasMod = await import('@/services/userAccountsFirebase')
        const { db: uasDb } = await uasMod.ensureUserAccountsFirebase()
        const profileCount = await countCollection(uasDb, 'profiles')
        const boardCount = await countCollection(uasDb, 'leaderboardEntries')
        uas = [
          { id: 'profiles', label: 'User profiles', count: profileCount },
          { id: 'leaderboardEntries', label: 'Leaderboard entries', count: boardCount },
        ]
      } catch (e) {
        uas = [
          {
            id: 'profiles',
            label: 'User profiles',
            count: null,
            error: (e as Error)?.message || 'UAs unavailable',
          },
        ]
      }

      setFirebaseCounts({ stations: stationRows, other, uas })
      setFirebaseError(null)
    } catch (e) {
      setFirebaseError((e as Error)?.message || 'Failed to load Firebase counts')
    }
  }

  useEffect(() => {
    setSamples(loadSamples())
    runFetch(true)
    fetchAvailable()
    fetchFirebase()
    const t = window.setInterval(() => void runFetch(false), 15000)
    const a = window.setInterval(() => void fetchAvailable(), 120000)
    const f = window.setInterval(() => void fetchFirebase(), 300000)
    return () => {
      window.clearInterval(t)
      window.clearInterval(a)
      window.clearInterval(f)
    }
  }, [])

  const summary = useMemo(() => {
    const stateBytes = pickNumber(health?.persistence?.fileSizeBytes)
    const sqliteBytes = pickNumber(health?.unitCatalog?.sqlite?.bytes)
    const uptimeFromNumericMs = pickNumber(
      health?.uptimeMs,
      typeof health?.uptimeSec === 'number' ? health.uptimeSec * 1000 : null
    )
    const startedAtIso = health?.processStartedAt || health?.startedAt || health?.kafka?.startedAt
    const derivedFromStartedAtMs = startedAtIso
      ? Math.max(0, Date.now() - new Date(startedAtIso).getTime())
      : null
    const uptimeMs = uptimeFromNumericMs ?? (Number.isFinite(derivedFromStartedAtMs) ? derivedFromStartedAtMs : null)

    return {
      daemonStatus: health?.ok ? (health.heavyReloadBusy ? 'Reloading' : health.mode || 'Healthy') : 'Unavailable',
      loadedDate: health?.loadedDate || '-',
      uptime: formatUptimeFromMs(uptimeMs),
      processStartedAt: startedAtIso || '-',
      kafkaConsumed: formatNum(health?.kafka?.consumed),
      kafkaUpdates: formatNum(health?.kafka?.updates),
      journeys: formatNum(health?.journeysLoaded),
      tiplocs: formatNum(health?.tiplocsIndexed),
      timetableFile: health?.timetableFile || '-',
      live: formatNum(health?.overlaySize?.live),
      cancelled: formatNum(health?.overlaySize?.cancelled),
      formations: formatNum(health?.overlaySize?.formations),
      consists: formatNum(health?.overlaySize?.consists),
      units: formatNum(health?.overlaySize?.units),
      unitCatalog: formatNum(health?.unitCatalog?.size),
      messages: formatNum(health?.overlaySize?.messages),
      stationsWithMessages: formatNum(health?.overlaySize?.stationsWithMessages),
      associations: formatNum(health?.overlaySize?.ridsWithAssociations),
      alerts: formatNum(health?.overlaySize?.ridsWithAlerts),
      unmatchedConsists: formatNum(health?.overlaySize?.unmatchedConsists),
      heap: formatNum(health?.memoryMB?.heap),
      rss: formatNum(health?.memoryMB?.rss),
      persistEvery: `${formatNum(health?.persistence?.intervalSec)}s`,
      lastPersist: health?.persistence?.lastPersistAt || '-',
      overlayLog: health?.persistence?.overlayDiffLog ? 'On' : 'Off',
      ptac: health?.ptac?.enabled ? 'Enabled' : 'Disabled',
      ptacConsumed: formatNum(health?.ptac?.consumed),
      ptacErrors: formatNum(health?.ptac?.errors),
      ptacMatched: formatNum(health?.ptac?.matched),
      ptacUnmatched: formatNum(health?.ptac?.unmatched),
      ptacUnitsToday: formatNum(health?.ptac?.unitsOnLoadedDate),
      ptacConsistsToday: formatNum(health?.ptac?.consistsOnLoadedDate),
      kafkaLastMessageAt: health?.kafka?.lastKafkaMsgAt || '-',
      stateCacheFileName: health?.persistence?.stateFile?.split('/').pop() || '-',
      stateCacheFileSize: formatBytes(stateBytes),
      sqliteFileSize: formatBytes(sqliteBytes),
      lastLoadSource: health?.unitCatalog?.lastLoad?.source || '-',
      lastLoadMs: health?.unitCatalog?.lastLoad?.ms != null ? `${health.unitCatalog.lastLoad.ms} ms` : '-',
      liveCachesReady: health?.liveCachesReady ? 'Yes' : 'No',
      clientReads: health?.clientReadsAllowed ? 'Yes' : 'No',
      hostName: health?.host?.hostname || '-',
      cores: formatNum(health?.host?.cores),
      loadAvg: health?.host?.loadAvg?.map((n) => n.toFixed(2)).join(' / ') || '-',
      cpu: pct(health?.host?.cpuPercent ?? null),
      processCpu: pct(health?.host?.processCpuPercent ?? null),
      ramUsed: formatNum(health?.host?.memory?.usedMB),
      ramTotal: formatNum(health?.host?.memory?.totalMB),
      ramPct: health?.host?.memory?.usedPercent ?? null,
      cpuPct: health?.host?.cpuPercent ?? null,
      diskPct: health?.host?.disk?.usedPercent ?? null,
      diskUsed: formatBytes(health?.host?.disk?.usedBytes),
      diskTotal: formatBytes(health?.host?.disk?.totalBytes),
      osUptime: formatUptimeFromMs(
        typeof health?.host?.osUptimeSec === 'number' ? health.host.osUptimeSec * 1000 : null
      ),
      warmup: health?.warmup?.enabled
        ? `${formatNum(health.warmup.done)} done / ${formatNum(health.warmup.skipped)} skipped / ${formatNum(health.warmup.errors)} errors`
        : 'Disabled',
    }
  }, [health])

  const historyTotals = useMemo(() => {
    const rows = available?.dates || []
    const withState = rows.filter((row) => row.hasState).length
    const withTimetable = rows.filter((row) => row.hasTimetable).length
    const totalBytes = pickNumber(available?.totalBytes, rows.reduce((sum, row) => sum + (row.bytes || 0), 0))
    const maxBytes = rows.reduce((max, row) => Math.max(max, row.bytes || 0), 0)
    return { withState, withTimetable, totalBytes, maxBytes }
  }, [available])

  const spark = (key: keyof Pick<SamplePoint, 'cpu' | 'ram' | 'heap' | 'rss' | 'kafkaPerMin'>): SparkPoint[] =>
    samples.map((s) => ({ t: s.t, v: s[key] }))

  const hasHost = Boolean(health?.host)

  return (
    <div className="api-status-shell">
      <PageTopHeader
        title="API Status"
        subtitle={status === 'ok' ? 'Darwin VPS, process health, Kafka, and Firebase' : 'Connecting to API health...'}
      />
      <div className="api-status-page">
        <section className="api-status-controls">
          <BUTWideButton width="hug" instantAction onClick={() => void runFetch(false)}>
            Refresh now
          </BUTWideButton>
          {status === 'error' && <p className="api-status-error">{error}</p>}
          {status === 'ok' && error && <p className="api-status-error">{error}</p>}
          {status === 'ok' && <p className="api-status-meta">Last update: {lastUpdatedAt ? displayDateTime(lastUpdatedAt) : '-'}</p>}
        </section>

        <section className="api-panel" aria-label="VPS host">
          <h2>VPS host</h2>
          {hasHost ? (
            <>
              <p className="api-panel-subtitle">
                {summary.hostName} · {summary.cores} cores · load {summary.loadAvg} · OS up {summary.osUptime}
              </p>
              <div className="api-gauges">
                <Gauge label="CPU" value={summary.cpuPct} />
                <Gauge label="RAM" value={summary.ramPct} />
                <Gauge label="Disk /" value={summary.diskPct} />
              </div>
              <div className="api-status-grid">
                <Card title="CPU">{summary.cpu}</Card>
                <Card title="Darwin CPU">{summary.processCpu}</Card>
                <Card title="RAM used">{summary.ramUsed} / {summary.ramTotal} MB</Card>
                <Card title="Disk">{summary.diskUsed} / {summary.diskTotal}</Card>
                <Card title="Heap MB">{summary.heap}</Card>
                <Card title="RSS MB">{summary.rss}</Card>
              </div>
              <div className="api-charts">
                <div>
                  <h3>CPU %</h3>
                  <ApiStatusSparkline data={spark('cpu')} color="var(--accent-base)" unit="%" />
                </div>
                <div>
                  <h3>RAM %</h3>
                  <ApiStatusSparkline data={spark('ram')} color="var(--text-primary)" unit="%" />
                </div>
                <div>
                  <h3>Heap MB</h3>
                  <ApiStatusSparkline data={spark('heap')} color="var(--text-secondary)" unit=" MB" />
                </div>
                <div>
                  <h3>RSS MB</h3>
                  <ApiStatusSparkline data={spark('rss')} color="var(--text-secondary)" unit=" MB" />
                </div>
                <div>
                  <h3>Kafka msgs / min</h3>
                  <ApiStatusSparkline data={spark('kafkaPerMin')} color="var(--accent-base)" unit="/min" />
                </div>
              </div>
            </>
          ) : (
            <>
              <p className="api-panel-subtitle">
                Host CPU, RAM, and disk appear after Darwin is restarted with the health `host` payload.
                Heap and RSS below are from the Node process only.
              </p>
              <div className="api-status-grid">
                <Card title="Heap MB">{summary.heap}</Card>
                <Card title="RSS MB">{summary.rss}</Card>
              </div>
              <div className="api-charts">
                <div>
                  <h3>Heap MB</h3>
                  <ApiStatusSparkline data={spark('heap')} color="var(--text-secondary)" unit=" MB" />
                </div>
                <div>
                  <h3>RSS MB</h3>
                  <ApiStatusSparkline data={spark('rss')} color="var(--text-secondary)" unit=" MB" />
                </div>
                <div>
                  <h3>Kafka msgs / min</h3>
                  <ApiStatusSparkline data={spark('kafkaPerMin')} color="var(--accent-base)" unit="/min" />
                </div>
              </div>
            </>
          )}
        </section>

        <section className="api-panel" aria-label="Firebase">
          <h2>Firebase</h2>
          <p className="api-panel-subtitle">
            Live document counts from catalogue Firestore
            {firebaseCounts?.uas?.length ? ' and user-accounts Firestore' : ''}.
          </p>
          {firebaseError && <p className="api-status-error">{firebaseError}</p>}
          <h3 className="api-subhead">Station collections</h3>
          <div className="api-status-grid">
            {(firebaseCounts?.stations || []).map((row) => (
              <Card key={row.id} title={row.label}>{formatNum(row.count)}</Card>
            ))}
            {!firebaseCounts && <Card title="Loading">…</Card>}
          </div>
          <h3 className="api-subhead">Catalogue</h3>
          <div className="api-status-grid">
            {(firebaseCounts?.other || []).map((row) => (
              <Card key={row.id} title={row.label}>{formatNum(row.count)}</Card>
            ))}
          </div>
          <h3 className="api-subhead">User accounts</h3>
          <div className="api-status-grid">
            {(firebaseCounts?.uas || []).map((row) => (
              <Card key={row.id} title={row.label}>
                {row.error ? row.error : formatNum(row.count)}
              </Card>
            ))}
          </div>
        </section>

        <section className="api-panel" aria-label="Daemon">
          <h2>Darwin daemon</h2>
          <div className="api-status-grid">
            <Card title="Daemon status">{summary.daemonStatus}</Card>
            <Card title="Live caches ready">{summary.liveCachesReady}</Card>
            <Card title="Client reads">{summary.clientReads}</Card>
            <Card title="Loaded date">{summary.loadedDate}</Card>
            <Card title="Uptime">{summary.uptime}</Card>
            <Card title="Process started">{summary.processStartedAt === '-' ? '-' : displayDateTime(summary.processStartedAt)}</Card>
            <Card title="Journeys">{summary.journeys}</Card>
            <Card title="TIPLOCs">{summary.tiplocs}</Card>
            <Card title="Timetable">{summary.timetableFile}</Card>
            <Card title="Warmup">{summary.warmup}</Card>
          </div>
        </section>

        <section className="api-panel" aria-label="Unit catalog">
          <h2>Unit catalog</h2>
          <p className="api-panel-subtitle">SQLite only. JSON catalog files are no longer used.</p>
          <div className="api-status-grid">
            <Card title="Store">SQLite</Card>
            <Card title="Last load source">{summary.lastLoadSource}</Card>
            <Card title="Last load time">{summary.lastLoadMs}</Card>
            <Card title="SQLite file">{summary.sqliteFileSize}</Card>
            <Card title="Catalog units">{summary.unitCatalog}</Card>
          </div>
        </section>

        <section className="api-panel" aria-label="Kafka">
          <h2>Kafka</h2>
          <p className="api-panel-subtitle">
            Consumed and updates count from this process only. They reset to zero on every Darwin restart.
          </p>
          <div className="api-status-grid">
            <Card title="Consumed">{summary.kafkaConsumed}</Card>
            <Card title="Updates">{summary.kafkaUpdates}</Card>
            <Card title="Last message">{summary.kafkaLastMessageAt === '-' ? '-' : displayDateTime(summary.kafkaLastMessageAt)}</Card>
            <Card title="PTAC">{summary.ptac}</Card>
            <Card title="PTAC consumed">{summary.ptacConsumed}</Card>
            <Card title="PTAC matched">{summary.ptacMatched}</Card>
            <Card title="PTAC unmatched">{summary.ptacUnmatched}</Card>
            <Card title="PTAC errors">{summary.ptacErrors}</Card>
            <Card title="PTAC units today">{summary.ptacUnitsToday}</Card>
            <Card title="PTAC consists today">{summary.ptacConsistsToday}</Card>
          </div>
        </section>

        <section className="api-panel" aria-label="In-memory caches">
          <h2>In-memory caches</h2>
          <div className="api-status-grid">
            <Card title="Live overlays">{summary.live}</Card>
            <Card title="Cancelled">{summary.cancelled}</Card>
            <Card title="Formations">{summary.formations}</Card>
            <Card title="Consists">{summary.consists}</Card>
            <Card title="Units (today)">{summary.units}</Card>
            <Card title="Unmatched consists">{summary.unmatchedConsists}</Card>
            <Card title="Messages">{summary.messages}</Card>
            <Card title="Stations with messages">{summary.stationsWithMessages}</Card>
            <Card title="Associations">{summary.associations}</Card>
            <Card title="Alerts">{summary.alerts}</Card>
            <Card title="Persist">{summary.persistEvery} · {summary.lastPersist === '-' ? '-' : displayDateTime(summary.lastPersist)}</Card>
            <Card title="Overlay log">{summary.overlayLog}</Card>
          </div>
        </section>

        <section className="api-panel" aria-label="Cache file details">
          <h2>On-disk state</h2>
          <p className="api-panel-subtitle">Live core JSON plus SQLite catalog. Historical days use overlay logs, not the old JSON catalog dump.</p>
          <div className="api-status-grid">
            <Card title="State cache filename">{summary.stateCacheFileName}</Card>
            <Card title="State cache file">{summary.stateCacheFileSize}</Card>
            <Card title="SQLite catalog">{summary.sqliteFileSize}</Card>
          </div>
        </section>

        <section className="api-panel" aria-label="Available historical data">
          <h2>Available data</h2>
          <p className="api-panel-subtitle">
            {available
              ? `${available.count} date(s) · retention ${available.retentionDays} days · sizes from VPS history + timetable dirs`
              : 'Loading available history dates...'}
          </p>
          <div className="api-status-grid">
            <Card title="On-disk total">{formatBytes(historyTotals.totalBytes)}</Card>
            <Card title="Dates with state">{formatNum(historyTotals.withState)}</Card>
            <Card title="Dates with timetable">{formatNum(historyTotals.withTimetable)}</Card>
            <Card title="History dates listed">{formatNum(available?.count)}</Card>
          </div>
          <div className="api-available-list">
            {(available?.dates || []).map((d) => {
              const pct = historyTotals.maxBytes > 0 ? Math.round(((d.bytes || 0) / historyTotals.maxBytes) * 100) : 0
              return (
                <article key={d.date} className="api-available-item">
                  <div className="api-available-main">
                    <strong>{d.date}</strong>
                    <div className="api-available-meta">
                      <span>history: {formatBytes(d.historyBytes)}</span>
                      <span>timetable: {formatBytes(d.timetableBytes)}</span>
                      <span>state: {d.hasState ? 'yes' : 'no'}</span>
                    </div>
                    <div className="api-day-size-track" aria-hidden>
                      <div className="api-day-size-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <span className="api-available-last">{formatBytes(d.bytes)}</span>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}

export default ApiStatusPage
