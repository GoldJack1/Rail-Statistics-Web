'use client'

import { useRouter } from 'next/navigation'
import React, { useEffect, useMemo, useState } from 'react'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import { PageTopHeader } from '@/components/misc'
import { BUTWideButton } from '@/components/buttons'
import './ApiStatusPage.css'

type HealthPayload = {
  ok: boolean
  loadedDate?: string
  startedAt?: string
  uptimeSec?: number
  uptimeMs?: number
  memoryMB?: { heap?: number; rss?: number }
  kafka?: { consumed?: number; updates?: number; startedAt?: string; lastKafkaMsgAt?: string }
  ptac?: { enabled?: boolean; consumed?: number; matched?: number; unmatched?: number; errors?: number; lastMessageAt?: string }
  overlaySize?: { live?: number; formations?: number; consists?: number; units?: number; unmatchedConsists?: number }
  persistence?: {
    intervalSec?: number
    lastPersistAt?: string
    stateFile?: string
    fileSizeBytes?: number
    stateFileBytes?: number
  }
  unitCatalog?: {
    size?: number
    lastPersistAt?: string
    file?: string
    fileSizeBytes?: number
    fileBytes?: number
  }
  history?: { retentionDays?: number; dates?: string[] }
}

type HistoryDatesPayload = {
  count: number
  retentionDays: number
  dates: Array<{
    date: string
    hasState: boolean
    hasTimetable: boolean
    snapshots: string[]
  }>
}

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

const ApiStatusPage: React.FC = () => {
  const [health, setHealth] = useState<HealthPayload | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)
  const [available, setAvailable] = useState<HistoryDatesPayload | null>(null)

  const runFetch = async (isInitial = false) => {
    if (isInitial) setStatus('loading')
    try {
      const res = await fetch('/api/darwin/health')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const next: HealthPayload = await res.json()
      setHealth(next)
      setLastUpdatedAt(new Date().toISOString())
      setStatus('ok')
      setError(null)
    } catch (e) {
      setStatus('error')
      const msg = (e as Error)?.message || 'Failed to load health.'
      setError(msg)
    }
  }

  const fetchAvailable = async () => {
    try {
      const res = await fetchDarwin('/api/darwin/history/dates?snapshots=1')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const payload: HistoryDatesPayload = await res.json()
      setAvailable(payload)
    } catch {}
  }

  useEffect(() => {
    runFetch(true)
    fetchAvailable()
    const t = window.setInterval(() => void runFetch(false), 15000)
    const a = window.setInterval(() => void fetchAvailable(), 120000)
    return () => {
      window.clearInterval(t)
      window.clearInterval(a)
    }
  }, [])

  const summary = useMemo(() => {
    const stateBytes = pickNumber(health?.persistence?.fileSizeBytes, health?.persistence?.stateFileBytes)
    const unitCatalogBytes = pickNumber(health?.unitCatalog?.fileSizeBytes, health?.unitCatalog?.fileBytes)
    const totalCacheBytes = stateBytes !== null && unitCatalogBytes !== null
      ? stateBytes + unitCatalogBytes
      : null
    const uptimeFromNumericMs = pickNumber(
      health?.uptimeMs,
      typeof health?.uptimeSec === 'number' ? health.uptimeSec * 1000 : null
    )
    const startedAtIso = health?.startedAt || health?.kafka?.startedAt
    const derivedFromStartedAtMs = startedAtIso
      ? Math.max(0, Date.now() - new Date(startedAtIso).getTime())
      : null
    const uptimeMs = uptimeFromNumericMs ?? (Number.isFinite(derivedFromStartedAtMs) ? derivedFromStartedAtMs : null)

    return {
    daemonStatus: health?.ok ? 'Healthy' : 'Unavailable',
    loadedDate: health?.loadedDate || '-',
    uptime: formatUptimeFromMs(uptimeMs),
    kafkaConsumed: formatNum(health?.kafka?.consumed),
    kafkaUpdates: formatNum(health?.kafka?.updates),
    formations: formatNum(health?.overlaySize?.formations),
    consists: formatNum(health?.overlaySize?.consists),
    units: formatNum(health?.overlaySize?.units),
    unitCatalog: formatNum(health?.unitCatalog?.size),
    heap: formatNum(health?.memoryMB?.heap),
    rss: formatNum(health?.memoryMB?.rss),
    persistEvery: `${formatNum(health?.persistence?.intervalSec)}s`,
    lastPersist: health?.persistence?.lastPersistAt || '-',
    ptac: health?.ptac?.enabled ? 'Enabled' : 'Disabled',
    ptacErrors: formatNum(health?.ptac?.errors),
    ptacMatched: formatNum(health?.ptac?.matched),
    ptacUnmatched: formatNum(health?.ptac?.unmatched),
    kafkaLastMessageAt: health?.kafka?.lastKafkaMsgAt || '-',
    stateCacheFileName: health?.persistence?.stateFile || '-',
    unitCatalogFileName: health?.unitCatalog?.file || '-',
    stateCacheFileSize: formatBytes(stateBytes),
    unitCatalogFileSize: formatBytes(unitCatalogBytes),
    totalCacheSize: formatBytes(totalCacheBytes),
    }
  }, [health])

  const historyTotals = useMemo(() => {
    const rows = available?.dates || []
    const snapshots = rows.reduce((total, row) => total + row.snapshots.length, 0)
    const withState = rows.filter((row) => row.hasState).length
    const withTimetable = rows.filter((row) => row.hasTimetable).length
    return { snapshots, withState, withTimetable }
  }, [available])

  return (
    <div className="api-status-shell">
      <PageTopHeader
        title="API Status"
        subtitle={status === 'ok' ? 'Live Darwin daemon health and cache telemetry' : 'Connecting to API health...'}
      />
      <div className="api-status-page">
        <section className="api-status-controls">
          <BUTWideButton width="hug" instantAction onClick={() => void runFetch(false)}>
            Refresh now
          </BUTWideButton>
          {status === 'error' && <p className="api-status-error">{error}</p>}
          {status === 'ok' && <p className="api-status-meta">Last update: {lastUpdatedAt ? displayDateTime(lastUpdatedAt) : '-'}</p>}
        </section>

        <section className="api-status-grid" aria-label="API health summary">
          <article className="api-status-card"><h3>Daemon status</h3><p>{summary.daemonStatus}</p></article>
          <article className="api-status-card"><h3>Loaded date</h3><p>{summary.loadedDate}</p></article>
          <article className="api-status-card"><h3>Uptime</h3><p>{summary.uptime}</p></article>
          <article className="api-status-card"><h3>Kafka consumed</h3><p>{summary.kafkaConsumed}</p></article>
          <article className="api-status-card"><h3>Kafka updates</h3><p>{summary.kafkaUpdates}</p></article>
          <article className="api-status-card"><h3>Formations</h3><p>{summary.formations}</p></article>
          <article className="api-status-card"><h3>Consists</h3><p>{summary.consists}</p></article>
          <article className="api-status-card"><h3>Units</h3><p>{summary.units}</p></article>
          <article className="api-status-card"><h3>Unit catalog</h3><p>{summary.unitCatalog}</p></article>
          <article className="api-status-card"><h3>PTAC</h3><p>{summary.ptac}</p></article>
          <article className="api-status-card"><h3>Heap MB</h3><p>{summary.heap}</p></article>
          <article className="api-status-card"><h3>RSS MB</h3><p>{summary.rss}</p></article>
          <article className="api-status-card"><h3>Persist</h3><p>{summary.persistEvery} · {summary.lastPersist}</p></article>
          <article className="api-status-card"><h3>PTAC errors</h3><p>{summary.ptacErrors}</p></article>
          <article className="api-status-card"><h3>PTAC matched</h3><p>{summary.ptacMatched}</p></article>
          <article className="api-status-card"><h3>PTAC unmatched</h3><p>{summary.ptacUnmatched}</p></article>
          <article className="api-status-card"><h3>Kafka last message</h3><p>{summary.kafkaLastMessageAt === '-' ? '-' : displayDateTime(summary.kafkaLastMessageAt)}</p></article>
        </section>

        <section className="api-panel" aria-label="Cache file details">
          <h2>Cache Files</h2>
          <p className="api-panel-subtitle">Cache filenames and total on-disk footprint.</p>
          <div className="api-status-grid">
            <article className="api-status-card"><h3>State cache filename</h3><p>{summary.stateCacheFileName}</p></article>
            <article className="api-status-card"><h3>Unit catalog filename</h3><p>{summary.unitCatalogFileName}</p></article>
            <article className="api-status-card"><h3>State cache file</h3><p>{summary.stateCacheFileSize}</p></article>
            <article className="api-status-card"><h3>Unit catalog file</h3><p>{summary.unitCatalogFileSize}</p></article>
            <article className="api-status-card"><h3>Total cache size</h3><p>{summary.totalCacheSize}</p></article>
          </div>
        </section>

        <section className="api-panel" aria-label="Available historical data">
          <h2>Available Data</h2>
          <p className="api-panel-subtitle">
            {available
              ? `${available.count} date(s) · retention ${available.retentionDays} days`
              : 'Loading available history dates...'}
          </p>
          <div className="api-status-grid">
            <article className="api-status-card"><h3>Total snapshots</h3><p>{formatNum(historyTotals.snapshots)}</p></article>
            <article className="api-status-card"><h3>Dates with state</h3><p>{formatNum(historyTotals.withState)}</p></article>
            <article className="api-status-card"><h3>Dates with timetable</h3><p>{formatNum(historyTotals.withTimetable)}</p></article>
            <article className="api-status-card"><h3>History dates listed</h3><p>{formatNum(available?.count)}</p></article>
          </div>
          <div className="api-available-list">
            {(available?.dates || []).slice(0, 10).map((d) => (
              <article key={d.date} className="api-available-item">
                <div>
                  <strong>{d.date}</strong>
                  <div className="api-available-meta">
                    <span>state: {d.hasState ? 'yes' : 'no'}</span>
                    <span>timetable: {d.hasTimetable ? 'yes' : 'no'}</span>
                    <span>snapshots: {d.snapshots.length}</span>
                  </div>
                </div>
                <span className="api-available-last">
                  {d.snapshots.length > 0
                    ? new Date(d.snapshots[d.snapshots.length - 1]).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
                    : '-'}
                </span>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

export default ApiStatusPage