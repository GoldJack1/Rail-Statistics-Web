'use client'

import { darwinQueryEnvLabel, useDarwinQueryEnv } from '@/hooks/useDarwinQueryEnv'
import './DarwinQueryEnvBanner.css'

export default function DarwinQueryEnvBanner() {
  const env = useDarwinQueryEnv()
  if (!env) return null
  return (
    <p
      className={`darwin-query-env-banner darwin-query-env-banner--${env}`}
      role="status"
    >
      {darwinQueryEnvLabel(env)}
    </p>
  )
}
