import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { verifyUasFirebaseIdToken } from '@/app/api/account/_lib/verifyUasFirebaseIdToken'
import { revenueCatKeyForStripeReceipts } from '@/services/revenueCatApiKeys'

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status })
}

type SyncBody = {
  sessionId?: string
}

/**
 * After Stripe Checkout success, register the purchase with RevenueCat
 * so entitlements unlock for the same Firebase UID used on mobile.
 */
export async function POST(request: NextRequest) {
  const auth = request.headers.get('authorization') || ''
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!idToken) {
    return json(401, { error: 'Sign in required.' })
  }

  let uid: string
  try {
    ;({ uid } = await verifyUasFirebaseIdToken(idToken))
  } catch (err) {
    return json(401, { error: err instanceof Error ? err.message : 'Unauthorized.' })
  }

  const body = (await request.json().catch(() => null)) as SyncBody | null
  const sessionId = body?.sessionId?.trim() || ''
  if (!sessionId.startsWith('cs_')) {
    return json(400, { error: 'A Stripe Checkout session id is required.' })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeKey) {
    return json(503, { error: 'Stripe is not configured on this deployment.' })
  }

  const stripe = new Stripe(stripeKey)
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  if (session.client_reference_id && session.client_reference_id !== uid) {
    return json(403, { error: 'This checkout session does not belong to your account.' })
  }
  if (session.metadata?.firebase_uid && session.metadata.firebase_uid !== uid) {
    return json(403, { error: 'This checkout session does not belong to your account.' })
  }
  if (session.status !== 'complete' && session.payment_status !== 'paid') {
    return json(409, { error: 'Checkout is not complete yet.' })
  }

  const fetchToken = session.subscription
    ? typeof session.subscription === 'string'
      ? session.subscription
      : session.subscription.id
    : sessionId

  const { key: rcKey, reason } = revenueCatKeyForStripeReceipts()
  if (!rcKey) {
    return json(200, {
      synced: false,
      reason: reason || 'RevenueCat Stripe public API key not configured.',
    })
  }

  try {
    const rcRes = await fetch('https://api.revenuecat.com/v1/receipts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${rcKey}`,
        'Content-Type': 'application/json',
        'X-Platform': 'stripe',
      },
      body: JSON.stringify({
        app_user_id: uid,
        fetch_token: fetchToken,
      }),
      cache: 'no-store',
    })
    if (!rcRes.ok) {
      const detail = await rcRes.text().catch(() => '')
      console.error('[subscription/sync] RevenueCat error', rcRes.status, detail.slice(0, 400))
      return json(502, {
        synced: false,
        error: 'Could not sync purchase to RevenueCat yet. Status may update shortly.',
      })
    }
    return json(200, { synced: true })
  } catch (err) {
    console.error('[subscription/sync] error', err)
    return json(502, {
      synced: false,
      error: err instanceof Error ? err.message : 'Sync failed.',
    })
  }
}
