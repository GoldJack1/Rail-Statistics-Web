/** RevenueCat Web SDK helpers for Stripe Billing purchases on the website. */

import {
  ErrorCode,
  Purchases,
  PurchasesError,
  type Offering,
  type Package,
  type PurchaseResult,
} from '@revenuecat/purchases-js'

export const ENTITLEMENT_FIRST_CLASS = 'first_class'
export const ENTITLEMENT_STANDARD_PREMIUM = 'standard_premium'

export type WebPlanId = typeof ENTITLEMENT_STANDARD_PREMIUM | typeof ENTITLEMENT_FIRST_CLASS

export type WebPlanCard = {
  planId: WebPlanId
  title: string
  priceLabel: string
  periodLabel: string | null
  description: string | null
  features: string[]
  package: Package
}

const PLAN_FEATURES: Record<WebPlanId, string[]> = {
  [ENTITLEMENT_STANDARD_PREMIUM]: [
    'Ad-free experience in the apps',
    'Home-screen widgets',
  ],
  [ENTITLEMENT_FIRST_CLASS]: [
    'Everything in Standard Premium',
    'Ticket Tracking beta access (when available)',
  ],
}

let configuredForUid: string | null = null

export function isRevenueCatWebConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY?.trim())
}

export function configureRevenueCatWeb(appUserId: string): Purchases {
  const apiKey = process.env.NEXT_PUBLIC_REVENUECAT_WEB_API_KEY?.trim()
  if (!apiKey) {
    throw new Error('Web subscriptions are not configured on this deployment.')
  }
  const uid = appUserId.trim()
  if (!uid) throw new Error('Sign in required.')

  if (configuredForUid === uid) {
    try {
      return Purchases.getSharedInstance()
    } catch {
      configuredForUid = null
    }
  }

  const purchases = Purchases.configure({
    apiKey,
    appUserId: uid,
  })
  configuredForUid = uid
  return purchases
}

function classifyPackage(pkg: Package): WebPlanId | null {
  const product = pkg.webBillingProduct
  const haystack = [
    pkg.identifier,
    product.identifier,
    product.title,
    product.displayName,
  ]
    .join(' ')
    .toLowerCase()

  if (haystack.includes('first_class') || haystack.includes('first class')) {
    return ENTITLEMENT_FIRST_CLASS
  }
  if (
    haystack.includes('standard_premium') ||
    haystack.includes('standard premium') ||
    haystack.includes('standard')
  ) {
    return ENTITLEMENT_STANDARD_PREMIUM
  }
  return null
}

function periodLabelFromDuration(duration: string | null): string | null {
  if (!duration) return null
  const normalized = duration.trim().toUpperCase()
  // ISO-8601 durations from Stripe/RC, e.g. P1M, P1Y
  if (normalized === 'P1M' || normalized === 'P1MT') return 'per month'
  if (normalized === 'P1Y') return 'per year'
  if (normalized === 'P1W') return 'per week'
  if (/^P\d+M$/.test(normalized)) {
    const months = Number(normalized.slice(1, -1))
    return months === 1 ? 'per month' : `every ${months} months`
  }
  if (/^P\d+Y$/.test(normalized)) {
    const years = Number(normalized.slice(1, -1))
    return years === 1 ? 'per year' : `every ${years} years`
  }
  return null
}

function titleForPlan(planId: WebPlanId, productTitle: string): string {
  if (planId === ENTITLEMENT_FIRST_CLASS) return 'First Class'
  if (planId === ENTITLEMENT_STANDARD_PREMIUM) return 'Standard Premium'
  return productTitle || 'Plan'
}

function periodRank(duration: string | null): number {
  const normalized = (duration || '').trim().toUpperCase()
  if (normalized === 'P1M' || normalized === 'P1MT') return 0 // prefer monthly
  if (normalized === 'P1Y') return 1
  if (normalized === 'P3M') return 2
  if (/^P\d+M$/.test(normalized)) return 3
  if (/^P\d+Y$/.test(normalized)) return 4
  return 5
}

/** Map offering packages to Standard Premium / First Class plan cards. */
export function planCardsFromOffering(offering: Offering | null | undefined): WebPlanCard[] {
  if (!offering) return []
  const byPlan = new Map<WebPlanId, WebPlanCard>()

  for (const pkg of offering.availablePackages) {
    const planId = classifyPackage(pkg)
    if (!planId) continue
    const product = pkg.webBillingProduct
    const card: WebPlanCard = {
      planId,
      title: titleForPlan(planId, product.title || product.displayName),
      priceLabel: product.currentPrice.formattedPrice,
      periodLabel: periodLabelFromDuration(product.normalPeriodDuration),
      description: product.description,
      features: PLAN_FEATURES[planId],
      package: pkg,
    }
    const existing = byPlan.get(planId)
    if (
      !existing ||
      periodRank(product.normalPeriodDuration) <
        periodRank(existing.package.webBillingProduct.normalPeriodDuration)
    ) {
      byPlan.set(planId, card)
    }
  }

  const ordered: WebPlanCard[] = []
  const standard = byPlan.get(ENTITLEMENT_STANDARD_PREMIUM)
  const firstClass = byPlan.get(ENTITLEMENT_FIRST_CLASS)
  if (standard) ordered.push(standard)
  if (firstClass) ordered.push(firstClass)
  return ordered
}

function pickOffering(offerings: Awaited<ReturnType<Purchases['getOfferings']>>): Offering | null {
  if (offerings.current && offerings.current.availablePackages.length > 0) {
    return offerings.current
  }
  for (const offering of Object.values(offerings.all)) {
    if (offering.availablePackages.length > 0) return offering
  }
  return offerings.current
}

export type WebPlansFetchResult = {
  configured: boolean
  cards: WebPlanCard[]
  managementUrl: string | null
  /** Human-readable hint when cards are empty but the SDK is configured. */
  emptyReason: string | null
}

export async function fetchWebPlanCards(appUserId: string): Promise<WebPlansFetchResult> {
  if (!isRevenueCatWebConfigured()) {
    return { configured: false, cards: [], managementUrl: null, emptyReason: null }
  }
  const purchases = configureRevenueCatWeb(appUserId)
  const [offerings, customerInfo] = await Promise.all([
    purchases.getOfferings(),
    purchases.getCustomerInfo().catch(() => null),
  ])
  const offering = pickOffering(offerings)
  const cards = planCardsFromOffering(offering)
  const packageCount = offering?.availablePackages.length ?? 0
  const offeringIds = Object.keys(offerings.all)

  let emptyReason: string | null = null
  if (cards.length === 0) {
    if (offeringIds.length === 0) {
      emptyReason =
        'RevenueCat returned no offerings. In RevenueCat → Product Catalog → Offerings, create an offering, add Standard Premium and First Class packages from your Stripe import, and mark it Current.'
    } else if (!offering || packageCount === 0) {
      emptyReason =
        `RevenueCat has offering(s) (${offeringIds.join(', ')}) but no packages. Import Stripe products, then add packages for Standard Premium and First Class to the current offering.`
    } else {
      const labels = offering.availablePackages.map((pkg) => {
        const product = pkg.webBillingProduct
        return `${pkg.identifier} / ${product.identifier} (“${product.title || product.displayName || 'untitled'}”)`
      })
      emptyReason =
        `Found ${packageCount} package(s) but none matched Standard Premium / First Class. Rename package or product identifiers/titles to include “standard_premium” / “first_class” (or “Standard Premium” / “First Class”). Saw: ${labels.join('; ')}.`
    }
  }

  return {
    configured: true,
    cards,
    managementUrl: customerInfo?.managementURL ?? null,
    emptyReason,
  }
}

export async function purchaseWebPlan(params: {
  appUserId: string
  rcPackage: Package
  htmlTarget: HTMLElement
  customerEmail?: string | null
}): Promise<PurchaseResult> {
  const purchases = configureRevenueCatWeb(params.appUserId)
  return purchases.purchase({
    rcPackage: params.rcPackage,
    htmlTarget: params.htmlTarget,
    customerEmail: params.customerEmail?.trim() || undefined,
    skipSuccessPage: true,
  })
}

export function isUserCancelledPurchase(err: unknown): boolean {
  return err instanceof PurchasesError && err.errorCode === ErrorCode.UserCancelledError
}

export function purchaseErrorMessage(err: unknown): string {
  if (isUserCancelledPurchase(err)) return 'Purchase cancelled.'
  if (err instanceof PurchasesError) return err.message || 'Purchase failed.'
  if (err instanceof Error) return err.message
  return 'Purchase failed.'
}

/** Static feature copy for the public pricing page when offerings cannot load. */
export const PRICING_PAGE_PLANS: Array<{
  planId: WebPlanId
  title: string
  features: string[]
  appOnlyNote: string
}> = [
  {
    planId: ENTITLEMENT_STANDARD_PREMIUM,
    title: 'Standard Premium',
    features: PLAN_FEATURES[ENTITLEMENT_STANDARD_PREMIUM],
    appOnlyNote: 'Premium app features unlock after you subscribe on the web or in the apps.',
  },
  {
    planId: ENTITLEMENT_FIRST_CLASS,
    title: 'First Class',
    features: PLAN_FEATURES[ENTITLEMENT_FIRST_CLASS],
    appOnlyNote: 'Includes Standard Premium benefits plus First Class exclusives in the apps.',
  },
]
