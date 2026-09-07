import { NextResponse } from 'next/server'
import Stripe from 'stripe'
import type { StripeIntervalKey, StripePlanCard } from '@/services/stripeWebCheckout'

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status })
}

function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  return new Stripe(key)
}

function planIdFromProductName(name: string): 'standard_premium' | 'first_class' | null {
  const n = name.toLowerCase()
  if (n.includes('first class') || n.includes('first_class')) return 'first_class'
  if (n.includes('standard premium') || n.includes('standard_premium') || n.includes('standard')) {
    return 'standard_premium'
  }
  return null
}

function intervalKey(price: Stripe.Price): StripeIntervalKey {
  const rec = price.recurring
  if (!rec) return 'other'
  if (rec.interval === 'month' && rec.interval_count === 1) return 'month'
  if (rec.interval === 'month' && rec.interval_count === 3) return 'quarter'
  if (rec.interval === 'year' && rec.interval_count === 1) return 'year'
  return 'other'
}

function priceRank(price: Stripe.Price): number {
  switch (intervalKey(price)) {
    case 'month':
      return 0
    case 'quarter':
      return 1
    case 'year':
      return 2
    default:
      return 10
  }
}

function periodLabel(price: Stripe.Price): string | null {
  const rec = price.recurring
  if (!rec) return null
  if (rec.interval === 'month' && rec.interval_count === 1) return 'per month'
  if (rec.interval === 'year' && rec.interval_count === 1) return 'per year'
  if (rec.interval === 'month' && rec.interval_count === 3) return 'every 3 months'
  if (rec.interval === 'month') return `every ${rec.interval_count} months`
  if (rec.interval === 'year') return `every ${rec.interval_count} years`
  if (rec.interval === 'week' && rec.interval_count === 1) return 'per week'
  return `every ${rec.interval_count} ${rec.interval}s`
}

function intervalLabel(price: Stripe.Price): string {
  const key = intervalKey(price)
  if (key === 'month') return 'Monthly'
  if (key === 'quarter') return '3 months'
  if (key === 'year') return 'Yearly'
  return periodLabel(price) || 'Other'
}

function formatMoney(amount: number | null, currency: string): string {
  if (amount == null) return 'Price at checkout'
  try {
    return new Intl.NumberFormat('en-GB', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amount / 100)
  } catch {
    return `${(amount / 100).toFixed(2)} ${currency.toUpperCase()}`
  }
}

const PLAN_FEATURES: Record<'standard_premium' | 'first_class', string[]> = {
  standard_premium: ['Ad-free experience in the apps', 'Home-screen widgets'],
  first_class: [
    'Everything in Standard Premium',
    'Ticket Tracking beta access (when available)',
  ],
}

const PLAN_TITLES: Record<'standard_premium' | 'first_class', string> = {
  standard_premium: 'Standard Premium',
  first_class: 'First Class',
}

/** List Standard Premium + First Class prices from Stripe (monthly, 3 months, yearly). */
export async function GET() {
  const stripe = getStripe()
  if (!stripe) {
    return json(200, { configured: false, plans: [] as StripePlanCard[] })
  }

  try {
    const prices = await stripe.prices.list({
      active: true,
      type: 'recurring',
      expand: ['data.product'],
      limit: 100,
    })

    const collected: Array<{ planId: 'standard_premium' | 'first_class'; price: Stripe.Price }> =
      []

    for (const price of prices.data) {
      const product = price.product
      if (!product || typeof product === 'string' || product.deleted) continue
      if (!product.active) continue
      const planId = planIdFromProductName(product.name || '')
      if (!planId) continue
      const key = intervalKey(price)
      // Prefer the three main length tiers; still include other intervals as "other"
      if (key === 'other') continue
      collected.push({ planId, price })
    }

    // Deduplicate by plan + interval (keep lowest unit amount if duplicates)
    const bySlot = new Map<string, { planId: 'standard_premium' | 'first_class'; price: Stripe.Price }>()
    for (const row of collected) {
      const slot = `${row.planId}:${intervalKey(row.price)}`
      const existing = bySlot.get(slot)
      if (
        !existing ||
        (row.price.unit_amount ?? Number.POSITIVE_INFINITY) <
          (existing.price.unit_amount ?? Number.POSITIVE_INFINITY)
      ) {
        bySlot.set(slot, row)
      }
    }

    const plans: StripePlanCard[] = [...bySlot.values()]
      .sort((a, b) => {
        const planOrder =
          (a.planId === 'standard_premium' ? 0 : 1) - (b.planId === 'standard_premium' ? 0 : 1)
        if (planOrder !== 0) return planOrder
        return priceRank(a.price) - priceRank(b.price)
      })
      .map(({ planId, price }) => ({
        planId,
        title: PLAN_TITLES[planId],
        priceId: price.id,
        priceLabel: formatMoney(price.unit_amount, price.currency),
        periodLabel: periodLabel(price),
        intervalLabel: intervalLabel(price),
        intervalKey: intervalKey(price),
        features: PLAN_FEATURES[planId],
      }))

    return json(200, { configured: true, plans })
  } catch (err) {
    console.error('[subscription/plans] Stripe error', err)
    return json(502, {
      configured: true,
      plans: [],
      error: err instanceof Error ? err.message : 'Could not load plans.',
    })
  }
}
