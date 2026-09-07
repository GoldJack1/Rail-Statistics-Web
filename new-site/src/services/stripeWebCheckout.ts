/** Stripe subscription plan cards for Account Settings / pricing. */

export type StripeWebPlanId = 'standard_premium' | 'first_class'

export type StripeIntervalKey = 'month' | 'quarter' | 'year' | 'other'

export type StripePlanCard = {
  planId: StripeWebPlanId
  title: string
  priceId: string
  priceLabel: string
  periodLabel: string | null
  /** Short chip label e.g. "Monthly", "3 months", "Yearly". */
  intervalLabel: string
  intervalKey: StripeIntervalKey
  features: string[]
}

export async function fetchStripeSubscriptionPlans(): Promise<{
  configured: boolean
  plans: StripePlanCard[]
  error?: string
}> {
  const res = await fetch('/api/account/subscription/plans', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  })
  const body = (await res.json().catch(() => null)) as
    | { configured?: boolean; plans?: StripePlanCard[]; error?: string }
    | null
  if (!res.ok) {
    throw new Error(body?.error || `Could not load plans (${res.status}).`)
  }
  return {
    configured: Boolean(body?.configured),
    plans: body?.plans || [],
    error: body?.error,
  }
}

export async function startStripeCheckoutSession(params: {
  idToken: string
  priceId: string
  planId?: StripeWebPlanId
}): Promise<string> {
  const res = await fetch('/api/account/subscription/checkout', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      priceId: params.priceId,
      planId: params.planId,
    }),
    cache: 'no-store',
  })
  const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null
  if (!res.ok || !body?.url) {
    throw new Error(body?.error || `Could not start checkout (${res.status}).`)
  }
  return body.url
}

export async function syncStripeCheckoutToRevenueCat(params: {
  idToken: string
  sessionId: string
}): Promise<{ synced: boolean; error?: string }> {
  const res = await fetch('/api/account/subscription/sync', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${params.idToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sessionId: params.sessionId }),
    cache: 'no-store',
  })
  const body = (await res.json().catch(() => null)) as
    | { synced?: boolean; error?: string; reason?: string }
    | null
  if (!res.ok) {
    return { synced: false, error: body?.error || `Sync failed (${res.status}).` }
  }
  return { synced: Boolean(body?.synced), error: body?.error || body?.reason }
}

/** Group flat price cards by plan tier for UI. */
export function groupStripePlansByTier(plans: StripePlanCard[]): Array<{
  planId: StripeWebPlanId
  title: string
  features: string[]
  intervals: StripePlanCard[]
}> {
  const order: StripeWebPlanId[] = ['standard_premium', 'first_class']
  return order
    .map((planId) => {
      const intervals = plans.filter((p) => p.planId === planId)
      if (intervals.length === 0) return null
      return {
        planId,
        title: intervals[0].title,
        features: intervals[0].features,
        intervals,
      }
    })
    .filter((g): g is NonNullable<typeof g> => Boolean(g))
}
