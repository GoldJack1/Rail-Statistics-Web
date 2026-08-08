export const ADSENSE_CLIENT = 'ca-pub-6542256831244601'

export const ADSENSE_SLOTS = {
  /** Header desktop (PageTopHeader trailing) */
  banner: '1150960364',
  /** Section tablet/mobile */
  section: '8717359110',
  /** In-feed stations grid (fluid) */
  inFeed: '7033842431',
} as const

/** Fluid in-feed layout key from AdSense unit settings. */
export const ADSENSE_IN_FEED_LAYOUT_KEY = '-fb+5y+3y-dx+b1'

/**
 * Master switch for AdSense script + slots.
 * Set `NEXT_PUBLIC_ADSENSE_ENABLED=true` in Netlify (or `.env.local`) to serve ads.
 * Unset / any other value keeps ads off (safe default for local/dev).
 */
export const isAdSenseEnabled = process.env.NEXT_PUBLIC_ADSENSE_ENABLED === 'true'
