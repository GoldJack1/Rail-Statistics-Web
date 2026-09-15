import { ADSENSE_CLIENT, isAdSenseEnabled } from './adsenseConfig'

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
    <>
      <script dangerouslySetInnerHTML={{ __html: ADSENSE_BLOCK_DETECT_SCRIPT }} />
      <script
        id="adsense-loader"
        async
        src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE_CLIENT}`}
        crossOrigin="anonymous"
      />
    </>
  )
}
