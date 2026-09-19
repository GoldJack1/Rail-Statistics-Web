import Script from 'next/script'
import { ADSENSE_CLIENT, isAdSenseHeadTagsEnabled } from './adsenseConfig'

/**
 * Capture-phase listener must run before adsbygoogle.js so a content-blocker
 * `error` on that tag is not missed.
 */
const ADSENSE_BLOCK_DETECT_SCRIPT = `
window.addEventListener('error', function (event) {
  var target = event.target;
  if (!target || target.tagName !== 'SCRIPT') return;
  var src = target.src || '';
  if (src.indexOf('adsbygoogle.js') === -1) return;
  try { target.setAttribute('data-blocked', '1'); } catch (e) {}
  window.__RS_ADSENSE_BLOCKED = true;
  try { window.dispatchEvent(new Event('rs-adsense-blocked')); } catch (e) {}
}, true);
`.trim()

/**
 * Parser-inserted AdSense loader (`beforeInteractive` is in the initial HTML).
 * Native `<script>` tags inside a React `<head>` hydrate against Google’s
 * injected managed ads script and throw a mismatch.
 * Consent Mode defaults in layout must remain above this component.
 */
export default function AdSenseScript() {
  if (!isAdSenseHeadTagsEnabled) return null

  return (
    <>
      <Script id="rs-adsense-block-detect" strategy="beforeInteractive">
        {ADSENSE_BLOCK_DETECT_SCRIPT}
      </Script>
      <Script
        id="adsense-loader"
        strategy="beforeInteractive"
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
      />
    </>
  )
}
