import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { accountSystemDisabledResponse } from '@/app/api/account/_lib/accountSystemGuard'
import { verifyUasFirebaseIdToken } from '@/app/api/account/_lib/verifyUasFirebaseIdToken'

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

export async function POST(request: NextRequest) {
  const disabled = accountSystemDisabledResponse()
  if (disabled) return disabled

  const auth = request.headers.get('authorization') || ''
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!idToken) {
    return json(401, { error: 'Sign in required.' })
  }

  let email: string | null
  try {
    ;({ email } = await verifyUasFirebaseIdToken(idToken))
  } catch (err) {
    return json(401, { error: err instanceof Error ? err.message : 'Unauthorized.' })
  }

  if (!email) {
    return json(400, { error: 'Your account email is required to open the billing portal.' })
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeKey) {
    return json(503, {
      error: 'Stripe Customer Portal is not configured on this deployment.',
    })
  }

  const stripe = new Stripe(stripeKey)

  try {
    const customers = await stripe.customers.list({ email, limit: 5 })
    const customer =
      customers.data.find((c) => !c.deleted) || customers.data[0] || null
    if (!customer) {
      return json(404, {
        error: 'No Stripe customer was found for this account email.',
      })
    }

    const returnUrl = `${siteOrigin(request)}/account/settings?topic=subscription`
    const configuration = process.env.STRIPE_BILLING_PORTAL_CONFIGURATION_ID?.trim()
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: returnUrl,
      ...(configuration ? { configuration } : {}),
    })

    if (!session.url) {
      return json(502, { error: 'Stripe did not return a portal URL.' })
    }

    return json(200, { url: session.url })
  } catch (err) {
    console.error('[subscription/portal] Stripe error', err)
    return json(502, {
      error: err instanceof Error ? err.message : 'Could not open billing portal.',
    })
  }
}
