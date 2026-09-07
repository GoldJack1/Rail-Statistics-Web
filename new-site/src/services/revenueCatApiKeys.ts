/**
 * RevenueCat key selection for our server routes.
 *
 * Important:
 * - POST /v1/receipts (Stripe) requires the Stripe/Web **public** key (`strp_` / `strp_sb_`).
 * - New dashboard **secret** keys (`sk_`) are API **v2 only** and return 7723 on v1.
 * - Apple/Google public keys (`appl_` / `goog_`) cannot be used with X-Platform: stripe (7810).
 */

export function revenueCatKeyForStripeReceipts(): {
  key: string | null
  reason: string | null
} {
  const web = process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY?.trim() || ''
  const dedicated = process.env.REVENUECAT_STRIPE_PUBLIC_API_KEY?.trim() || ''
  const secret = process.env.REVENUECAT_API_KEY?.trim() || ''

  if (dedicated.startsWith('strp_')) {
    return { key: dedicated, reason: null }
  }
  if (web.startsWith('strp_')) {
    return { key: web, reason: null }
  }
  if (secret.startsWith('strp_')) {
    return { key: secret, reason: null }
  }
  if (secret.startsWith('sk_')) {
    return {
      key: null,
      reason:
        'REVENUECAT_API_KEY is a v2 secret key and cannot call API v1 /receipts. Set NEXT_PUBLIC_REVENUECAT_WEB_API_KEY (or REVENUECAT_STRIPE_PUBLIC_API_KEY) to your Stripe public key (strp_ / strp_sb_).',
    }
  }
  if (secret.startsWith('appl_') || secret.startsWith('goog_')) {
    return {
      key: null,
      reason:
        'App Store/Play SDK keys cannot sync Stripe purchases. Use your Stripe public key (strp_ / strp_sb_).',
    }
  }
  return {
    key: null,
    reason:
      'No Stripe public RevenueCat key configured. Set NEXT_PUBLIC_REVENUECAT_WEB_API_KEY to strp_ / strp_sb_.',
  }
}

/** @deprecated Use revenueCatKeyForStripeReceipts */
export const revenueCatKeyForStripePlatform = revenueCatKeyForStripeReceipts

/**
 * Key for GET /v1/subscribers.
 * Prefer platform public keys; v2 secret keys are incompatible with API v1.
 */
export function revenueCatKeyForSubscriberLookup(): string | null {
  const secret = process.env.REVENUECAT_API_KEY?.trim() || ''
  const web = process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY?.trim() || ''
  const stripePublic = process.env.REVENUECAT_STRIPE_PUBLIC_API_KEY?.trim() || ''

  // Never use v2-only secret keys against v1 subscribers.
  if (secret && !secret.startsWith('sk_')) return secret
  if (stripePublic.startsWith('strp_')) return stripePublic
  if (web.startsWith('strp_') || web.startsWith('appl_') || web.startsWith('goog_')) return web
  if (web) return web
  return null
}
