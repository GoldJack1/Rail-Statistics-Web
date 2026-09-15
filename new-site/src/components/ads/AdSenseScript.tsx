import { ADSENSE_CLIENT, isAdSenseEnabled } from './adsenseConfig'

/**
 * Parser-inserted AdSense loader for the document head.
 *
 * Must stay a server component with a native <script> — `next/script` injects
 * after hydration and adds `data-nscript`, which Safari’s tracker blocking
 * treats as a late third-party tracker instead of the publisher tag.
 * Consent Mode defaults in layout must remain above this tag.
 */
export default function AdSenseScript() {
  if (!isAdSenseEnabled) return null

  return (
    <script
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
      crossOrigin="anonymous"
    />
  )
}
