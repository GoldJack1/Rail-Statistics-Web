'use client'

import { useCallback, useEffect, useState } from 'react'
import { isBetaSite } from '@/utils/localDevFlags'
import {
  readDarwinQueryEnvPreference,
  writeDarwinQueryEnvPreference,
  type DarwinQueryEnv,
} from '@/utils/darwinQueryEnvPreference'

export function useBetaDarwinApiToggle() {
  const show = isBetaSite()
  const [env, setEnv] = useState<DarwinQueryEnv>('dev')
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!show) return
    setEnv(readDarwinQueryEnvPreference())
    setReady(true)
  }, [show])

  const setUseBetaApi = useCallback((useBeta: boolean) => {
    const next: DarwinQueryEnv = useBeta ? 'dev' : 'live'
    writeDarwinQueryEnvPreference(next)
    window.location.reload()
  }, [])

  return { show, ready, env, setUseBetaApi }
}
