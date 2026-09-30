'use client'

import { useEffect, useState } from 'react'
import { PageTopHeader } from '@/components/misc'
import { fetchDarwin } from '@/utils/darwinReadyFetch'

export default function RtppmPage() {
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

  return (
    <div className="container">
      <PageTopHeader title="RTPPM" subtitle="National TOC performance (Network Rail Open Data)" />
      {error ? <p>{error}</p> : null}
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>
        {body ? JSON.stringify(body, null, 2).slice(0, 20_000) : 'Loading…'}
      </pre>
    </div>
  )
}
