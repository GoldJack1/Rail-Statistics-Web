'use client'

import { useEffect } from 'react'
import { useDarwinPublicPagesVisible } from '@/hooks/useDarwinNavPagesVisible'
import { startDarwinHotCache } from '@/utils/darwinHotCache'

export default function DarwinHotPrefetch() {
  const showDarwinPublic = useDarwinPublicPagesVisible()
  useEffect(() => {
    if (!showDarwinPublic) return
    startDarwinHotCache()
  }, [showDarwinPublic])
  return null
}
