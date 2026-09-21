'use client'

import { useEffect } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import { areDarwinNavPagesEnabled } from '@/utils/localDevFlags'
import { startDarwinHotCache } from '@/utils/darwinHotCache'

export default function DarwinHotPrefetch() {
  const { user } = useAuth()
  useEffect(() => {
    if (!areDarwinNavPagesEnabled() && !user) return
    startDarwinHotCache()
  }, [user])
  return null
}
