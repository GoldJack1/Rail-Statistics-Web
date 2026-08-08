'use client'

import Script from 'next/script'
import { ADSENSE_CLIENT, isAdSenseEnabled } from './adsenseConfig'

/**
 * Loads the AdSense library once for the app.
 * Individual units call `(adsbygoogle = window.adsbygoogle || []).push({})`.
 * No-op unless `NEXT_PUBLIC_ADSENSE_ENABLED=true`.
 */
export default function AdSenseScript() {
  if (!isAdSenseEnabled) return null

  return (
    <Script
      id="adsense-loader"
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      crossOrigin="anonymous"
      strategy="afterInteractive"
    />
  )
}
