import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { verifyUasFirebaseIdToken } from '@/app/api/account/_lib/verifyUasFirebaseIdToken'
import type { StripePlanCard } from '@/services/stripeWebCheckout'

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status })
}

function siteOrigin(request: NextRequest): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, '')
  if (configured) return configured
  const proto = request.headers.get('x-forwarded-proto') || 'https'
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host')
  if (host) return `${proto}://${host}`
  return 'https://railstatistics.co.uk'
}

type CheckoutBody = {
  priceId?: string
  planId?: 'standard_premium' | 'first_class'
}

/** Create a Stripe-hosted Checkout Session (subscription) and return its URL. */
export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') || ''
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!idToken) {
    return json(401, { error: 'Sign in required.' })
  }

  let uid: string
  let email: string | null
  try {
    ;({ uid, email } = await verifyUasFirebaseIdToken(idToken))
  } catch (err) {
    return json(401, { error: err instanceof Error ? err.message : 'Unauthorized.' })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeKey) {
    return json(503, { error: 'Stripe is not configured on this deployment.' })
  }
  const stripe = new Stripe(stripeKey)

  const body = (await request.json().catch(() => null)) as CheckoutBody | null
  let priceId = body?.priceId?.trim() || ''

  if (!priceId && body?.planId) {
    const plansUrl = new URL('/api/account/subscription/plans', request.url)
    const plansRes = await fetch(plansUrl, { cache: 'no-store' })
    const plansBody = (await plansRes.json().catch(() => null)) as
      | { plans?: StripePlanCard[] }
      | null
    const match = plansBody?.plans?.find((p) => p.planId === body.planId)
    priceId = match?.priceId || ''
  }

  if (!priceId.startsWith('price_')) {
    return json(400, { error: 'A valid Stripe price is required.' })
  }

  const origin = siteOrigin(request)
  const successUrl = `${origin}/account/settings?topic=subscription&checkout=success&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = `${origin}/account/settings?topic=subscription&checkout=cancelled`

  try {
    let customerId: string | undefined
    if (email) {
      const existing = await stripe.customers.list({ email, limit: 1 })
      customerId = existing.data[0]?.id
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: uid,
      ...(customerId
        ? { customer: customerId }
        : email
          ? { customer_email: email }
          : {}),
      metadata: {
        firebase_uid: uid,
        app_user_id: uid,
      },
      subscription_data: {
        metadata: {
          firebase_uid: uid,
          app_user_id: uid,
        },
      },
      allow_promotion_codes: true,
    })

    if (!session.url) {
      return json(502, { error: 'Stripe did not return a checkout URL.' })
    }

    return json(200, { url: session.url, sessionId: session.id })
  } catch (err) {
    console.error('[subscription/checkout] Stripe error', err)
    return json(502, {
      error: err instanceof Error ? err.message : 'Could not start checkout.',
    })
  }
}
