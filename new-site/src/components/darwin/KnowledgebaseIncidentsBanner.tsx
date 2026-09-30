'use client'

import { useEffect, useState } from 'react'

export function KnowledgebaseIncidentsBanner() {
  const [text, setText] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/knowledgebase/incidents')
      .then(async (res) => {
        if (!res.ok) return
        const body = await res.json() as { xml?: string }
        const xml = body.xml || ''
        const match = xml.match(/<(?:Incident|Clearance|Description)[^>]*>([^<]{20,280})/i)
        if (!cancelled && match) setText(match[1].replace(/\s+/g, ' ').trim())
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  if (!text) return null
  return (
    <p role="status" style={{ margin: '0 0 12px', fontSize: 14 }}>
      Network incident: {text}
    </p>
  )
}
