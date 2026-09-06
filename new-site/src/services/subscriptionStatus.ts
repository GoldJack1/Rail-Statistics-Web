/** Active subscription status for Account Settings (account-linked billing status via server route). */

import { ANDROID_APP_URL, IOS_APP_URL } from '@/utils/appDownload'

export type SubscriptionPurchaseStore = 'app_store' | 'play_store' | 'other'

export type AccountSubscriptionStatus = {
  configured: boolean
  hasActiveSubscription: boolean
  planName: string | null
  productId: string | null
  entitlementId: string | null
  store: SubscriptionPurchaseStore | null
  storeLabel: string | null
  manageMessage: string | null
  manageUrl: string | null
  manageCtaLabel: string | null
}

export function storeLabelFor(store: SubscriptionPurchaseStore): string {
  switch (store) {
    case 'app_store':
      return 'App Store'
    case 'play_store':
      return 'Google Play'
    default:
      return 'Another store'
  }
}

export function manageMessageFor(store: SubscriptionPurchaseStore): string {
  switch (store) {
    case 'app_store':
      return 'This subscription was purchased on the App Store. Manage or cancel it in Apple ID subscription settings on an iPhone or iPad — not on this website.'
    case 'play_store':
      return 'This subscription was purchased on Google Play. Open the Play Store on an Android device to manage or cancel it — not on this website.'
    default:
      return 'Manage or cancel this subscription in the store where it was originally purchased — not on this website.'
  }
}

/** Deep link / store page for managing the purchase platform. */
export function manageUrlFor(store: SubscriptionPurchaseStore): string | null {
  switch (store) {
    case 'app_store':
      return 'https://apps.apple.com/account/subscriptions'
    case 'play_store':
      return 'https://play.google.com/store/account/subscriptions'
    default:
      return null
  }
}

export function manageCtaLabelFor(store: SubscriptionPurchaseStore): string | null {
  switch (store) {
    case 'app_store':
      return 'Open App Store'
    case 'play_store':
      return 'Open Play Store'
    default:
      return null
  }
}

/** App listing fallback when subscriptions deep link is unavailable. */
export function storeListingUrlFor(store: SubscriptionPurchaseStore): string | null {
  switch (store) {
    case 'app_store':
      return IOS_APP_URL
    case 'play_store':
      return ANDROID_APP_URL
    default:
      return null
  }
}


export type DevOverrideFlags = {
  overrideStandardPremium?: boolean
  overrideFirstClass?: boolean
}

/** User-facing note when cloud/local developer subscription overrides are on. */
export function devOverrideMessageFromPrefs(prefs: DevOverrideFlags | null | undefined): string | null {
  if (!prefs) return null
  const overrideStandard = Boolean(prefs.overrideStandardPremium)
  const overrideFirst = Boolean(prefs.overrideFirstClass)
  if (overrideStandard && overrideFirst) {
    return 'Developer overrides enabled: Standard Premium and First Class.'
  }
  if (overrideStandard) return 'Developer override enabled: Standard Premium.'
  if (overrideFirst) return 'Developer override enabled: First Class.'
  return null
}

export async function fetchAccountSubscriptionStatus(
  idToken: string
): Promise<AccountSubscriptionStatus> {
  const res = await fetch('/api/account/subscription', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
      Accept: 'application/json',
    },
    cache: 'no-store',
  })
  const body = (await res.json().catch(() => null)) as AccountSubscriptionStatus | { error?: string } | null
  if (!res.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body && body.error
        ? String(body.error)
        : `Could not load subscription (${res.status}).`
    throw new Error(message)
  }
  return body as AccountSubscriptionStatus
}
