'use client'

import { useEffect, useState } from 'react'
import { PageTopHeader } from '@/components/misc'

const MODES = ['tube', 'dlr', 'overground', 'elizabeth-line', 'tram'] as const

export default function TflStatusPage() {
  const [mode, setMode] = useState<(typeof MODES)[number]>('tube')
  const [body, setBody] = useState<unknown>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    void fetch(`/api/tfl?mode=${mode}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        setBody(await res.json())
      })
      .catch((e: Error) => setError(e.message))
  }, [mode])

  return (
    <div className="container">
      <PageTopHeader title="TfL rail status" subtitle="Unified API line status for London rail modes" />
      <p>
        {MODES.map((m) => (
          <button key={m} type="button" onClick={() => setMode(m)} style={{ marginRight: 8 }}>
            {m}
          </button>
        ))}
      </p>
      {error ? <p>{error}</p> : null}
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
        {body ? JSON.stringify(body, null, 2).slice(0, 20_000) : 'Loading…'}
      </pre>
    </div>
  )
}
