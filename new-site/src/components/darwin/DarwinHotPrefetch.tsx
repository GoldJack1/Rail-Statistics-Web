'use client'

import { useEffect } from 'react'
import { startDarwinHotCache } from '@/utils/darwinHotCache'

export default function DarwinHotPrefetch() {
  useEffect(() => {
    startDarwinHotCache()
  }, [])
  return null
}
