'use client'

import { useEffect } from 'react'
import { useDarwinNavPagesVisible } from '@/hooks/useDarwinNavPagesVisible'
import { startDarwinHotCache } from '@/utils/darwinHotCache'

export default function DarwinHotPrefetch() {
  const showDarwinNav = useDarwinNavPagesVisible()
  useEffect(() => {
    if (!showDarwinNav) return
    startDarwinHotCache()
  }, [showDarwinNav])
  return null
}
