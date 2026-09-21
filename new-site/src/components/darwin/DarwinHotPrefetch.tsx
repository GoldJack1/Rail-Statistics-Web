'use client'

import { useEffect } from 'react'
import { areDarwinNavPagesEnabled } from '@/utils/localDevFlags'
import { startDarwinHotCache } from '@/utils/darwinHotCache'

export default function DarwinHotPrefetch() {
  useEffect(() => {
    if (!areDarwinNavPagesEnabled()) return
    startDarwinHotCache()
  }, [])
  return null
}
