'use client'

import { useEffect, useMemo, useState } from 'react'
import { PageTopHeader } from '@/components/misc'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import './PerformancePage.css'

type Rag = 'good' | 'medium' | 'poor' | ''

type OperatorRow = {
  name: string
  code: string
  ppm: string
  rag: Rag
  rolling: string
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function unwrapRtppm(raw: unknown): Record<string, unknown> | null {
  const root = asRecord(raw)
  if (!root) return null
  const v1 = asRecord(root.RTPPMDataMsgV1)
  return asRecord(v1?.RTPPMData) || asRecord(root.RTPPMData) || root
}

function ragOf(value: unknown): Rag {
  const s = String(value || '').toLowerCase()
  if (s === 'green' || s === 'good' || s === 'g') return 'good'
  if (s === 'amber' || s === 'medium' || s === 'a' || s === 'yellow') return 'medium'
  if (s === 'red' || s === 'poor' || s === 'r') return 'poor'
  return ''
}

function ppmText(node: unknown): { text: string; rag: Rag } {
  const rec = asRecord(node)
  if (!rec) return { text: '—', rag: '' }
  const ppm = asRecord(rec.PPM) || rec
  const text = String(ppm.text ?? ppm.Total ?? rec.text ?? '—')
  return { text, rag: ragOf(ppm.rag ?? rec.rag) }
}

function listOf(node: unknown): unknown[] {
  if (!node) return []
  return Array.isArray(node) ? node : [node]
}

function parseOperators(data: Record<string, unknown>): OperatorRow[] {
  const national = asRecord(data.NationalPage)
  const pages = [
    ...listOf(national?.Operator),
    ...listOf(national?.Operators),
    ...listOf(data.OperatorPage),
    ...listOf(asRecord(data.OperatorPage)?.Operator),
  ]
  const rows: OperatorRow[] = []
  for (const item of pages) {
    const rec = asRecord(item)
    if (!rec) continue
    const op = asRecord(rec.Operator) || rec
    const name = String(op.name ?? op.Name ?? rec.name ?? '')
    if (!name) continue
    const ppm = ppmText(rec)
    const rolling = ppmText(asRecord(rec.RollingPPM) || asRecord(op.RollingPPM))
    rows.push({
      name,
      code: String(op.code ?? op.Code ?? rec.code ?? ''),
      ppm: ppm.text,
      rag: ppm.rag,
      rolling: rolling.text,
    })
  }
  const seen = new Set<string>()
  return rows.filter((row) => {
    const key = `${row.code}|${row.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export default function PerformancePage() {
  const [body, setBody] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchDarwin('/api/darwin/rtppm')
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setBody(await res.json())
      })
      .catch((e: Error) => setError(e.message))
  }, [])

  const parsed = useMemo(() => {
    const data = unwrapRtppm(body)
    if (!data) return null
    const national = asRecord(data.NationalPage)
    const nationalPpm = ppmText(national?.NationalPPM || data.NationalPPM)
    const snapshot = String(data.snapshotTStamp || data.timestamp || '')
    return {
      nationalPpm,
      operators: parseOperators(data),
      snapshot,
    }
  }, [body])

  return (
    <div className="container perf-page">
      <PageTopHeader
        title="Performance"
        subtitle="National TOC punctuality from Network Rail RTPPM"
      />
      {error ? <p className="perf-error">{error}</p> : null}
      {!error && !parsed ? <p className="perf-updated">Loading…</p> : null}
      {parsed ? (
        <>
          {parsed.snapshot ? <p className="perf-updated">Snapshot {parsed.snapshot}</p> : null}
          <div className="perf-hero">
            <div className={`perf-stat${parsed.nationalPpm.rag ? ` perf-stat--${parsed.nationalPpm.rag}` : ''}`}>
              <span className="perf-stat__label">National PPM</span>
              <span className="perf-stat__value">{parsed.nationalPpm.text}</span>
            </div>
            <div className="perf-stat">
              <span className="perf-stat__label">Operators</span>
              <span className="perf-stat__value">{parsed.operators.length}</span>
            </div>
          </div>
          <div className="perf-table-wrap">
            <table className="perf-table">
              <thead>
                <tr>
                  <th>Operator</th>
                  <th>PPM</th>
                  <th>Rolling PPM</th>
                </tr>
              </thead>
              <tbody>
                {parsed.operators.length ? (
                  parsed.operators.map((row) => (
                    <tr key={`${row.code}-${row.name}`}>
                      <td>
                        {row.name}
                        {row.code ? <span style={{ opacity: 0.5 }}> · {row.code}</span> : null}
                      </td>
                      <td>
                        <span className={`perf-rag${row.rag ? ` perf-rag--${row.rag}` : ''}`}>{row.ppm}</span>
                      </td>
                      <td>{row.rolling}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={3}>No operator rows in the latest snapshot yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </div>
  )
}
