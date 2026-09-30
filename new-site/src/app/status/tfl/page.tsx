'use client'

import { useEffect, useState } from 'react'
import { PageTopHeader } from '@/components/misc'
import { BUTWideButton } from '@/components/buttons'
import './TflStatusPage.css'

const MODES = [
  { id: 'tube', label: 'Tube' },
  { id: 'dlr', label: 'DLR' },
  { id: 'overground', label: 'Overground' },
  { id: 'elizabeth-line', label: 'Elizabeth line' },
  { id: 'tram', label: 'Tram' },
  { id: 'national-rail', label: 'National Rail (London)' },
] as const

type LineStatus = {
  name?: string
  lineStatuses?: Array<{ statusSeverityDescription?: string; reason?: string }>
}

export default function TflStatusPage() {
  const [mode, setMode] = useState<(typeof MODES)[number]['id']>('tube')
  const [lines, setLines] = useState<LineStatus[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    setLines([])
    void fetch(`/api/tfl?mode=${mode}`)
      .then(async (res) => {
        const body = await res.json()
        if (!res.ok) throw new Error(body?.message || body?.error || `HTTP ${res.status}`)
        setLines(Array.isArray(body) ? body : [])
      })
      .catch((e: Error) => setError(e.message))
  }, [mode])

  return (
    <div className="container tfl-status-page">
      <PageTopHeader title="TfL status" subtitle="Live Unified API line status for London rail modes" />
      <div className="tfl-mode-row">
        {MODES.map((m) => (
          <BUTWideButton
            key={m.id}
            type="button"
            colorVariant={mode === m.id ? 'green-action' : 'primary'}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </BUTWideButton>
        ))}
      </div>
      {error ? <p className="tfl-error">{error}</p> : null}
      <ul className="tfl-line-list">
        {lines.map((line) => {
          const status = line.lineStatuses?.[0]
          return (
            <li key={line.name}>
              <strong>{line.name}</strong>
              <span>{status?.statusSeverityDescription || 'Unknown'}</span>
              {status?.reason ? <p>{status.reason}</p> : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
