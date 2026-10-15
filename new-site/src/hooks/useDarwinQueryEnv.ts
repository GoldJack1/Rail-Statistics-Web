'use client'

import { useEffect, useState } from 'react'
import { fetchDarwin } from '@/utils/darwinReadyFetch'
import type { DarwinQueryEnv } from '@/utils/darwinQueryEnvPreference'

export type { DarwinQueryEnv }

export function darwinQueryEnvLabel(env: DarwinQueryEnv): string {
  return env === 'dev' ? 'THIS IS THE DEV API' : 'THIS IS THE LIVE API'
}

export function useDarwinQueryEnv(): DarwinQueryEnv | null {
  const [env, setEnv] = useState<DarwinQueryEnv | null>(null)

  useEffect(() => {
    const ac = new AbortController()
    fetchDarwin('/api/darwin/health', { signal: ac.signal })
      .then(async (res) => {
        const header = res.headers.get('x-rail-query-env')?.trim().toLowerCase()
        let bodyEnv = ''
        try {
          const body = (await res.json()) as { queryEnv?: string }
          bodyEnv = String(body?.queryEnv || '').trim().toLowerCase()
        } catch {
          /* header only */
        }
        const raw = bodyEnv || header
        if (raw === 'dev' || raw === 'live') setEnv(raw)
      })
      .catch(() => {})
    return () => ac.abort()
  }, [])

  return env
}
