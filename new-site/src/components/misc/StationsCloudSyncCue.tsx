'use client'

import { useEffect, useMemo, useRef } from 'react'
import Link from 'next/link'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import { getDiaryVisitedCount } from '@/services/stationDiaryStore'

/**
 * On stations browse: keep diary in sync with cloud, and explain when visits
 * cannot show (signed out / vault locked / empty cloud).
 */
export default function StationsCloudSyncCue() {
  const { user, vaultUnlocked, loading, syncStatus, diaryRevision, syncNow } = useConsumerAuth()
  const pulledOnceRef = useRef(false)

  useEffect(() => {
    if (loading || !user || !vaultUnlocked) {
      pulledOnceRef.current = false
      return
    }
    if (pulledOnceRef.current) return
    pulledOnceRef.current = true
    void syncNow()
  }, [loading, user, vaultUnlocked, syncNow])

  const visited = useMemo(() => getDiaryVisitedCount(), [diaryRevision])

  if (loading) return null

  let body: React.ReactNode
  let tone: 'default' | 'error' = 'default'

  if (!user) {
    body = (
      <>
        <Link href="/account/sign-in">Sign in</Link> to see your visits
      </>
    )
  } else if (!vaultUnlocked) {
    body = (
      <>
        <Link href="/account">Unlock cloud sync</Link> to load visits
      </>
    )
  } else if (syncStatus.lastError) {
    body = syncStatus.lastError
    tone = 'error'
  } else if (visited > 0) {
    body = `Cloud sync on · ${visited} visited`
  } else if (syncStatus.isSyncing) {
    body = 'Loading visits…'
  } else {
    body = 'Cloud sync on · no visits loaded'
  }

  return (
    <div
      className={[
        'stations-cloud-sync-capsule',
        tone === 'error' ? 'stations-cloud-sync-capsule--error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="status"
    >
      {body}
    </div>
  )
}
