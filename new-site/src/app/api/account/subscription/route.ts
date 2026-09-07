import { NextRequest, NextResponse } from 'next/server'
import Stripe from 'stripe'
import { verifyUasFirebaseIdToken } from '@/app/api/account/_lib/verifyUasFirebaseIdToken'
import { revenueCatKeyForSubscriberLookup } from '@/services/revenueCatApiKeys'
import {
  manageCtaLabelFor,
  manageMessageFor,
  manageUrlFor,
  storeLabelFor,
  type AccountSubscriptionStatus,
  type SubscriptionPurchaseStore,
} from '@/services/subscriptionStatus'

const ENTITLEMENT_FIRST_CLASS = 'first_class'
const ENTITLEMENT_STANDARD_PREMIUM = 'standard_premium'
const ENTITLEMENT_PRIORITY = [ENTITLEMENT_FIRST_CLASS, ENTITLEMENT_STANDARD_PREMIUM] as const

type RcEntitlement = {
  expires_date?: string | null
  product_identifier?: string | null
  purchase_date?: string | null
}

type RcSubscription = {
  store?: string | null
  expires_date?: string | null
}

type RcSubscriberResponse = {
  subscriber?: {
    entitlements?: Record<string, RcEntitlement>
    subscriptions?: Record<string, RcSubscription>
    management_url?: string | null
  }
}

function json(status: number, body: unknown) {
  return NextResponse.json(body, { status })
}

function mapStore(raw: string | null | undefined): SubscriptionPurchaseStore {
  const store = String(raw || '')
    .trim()
    .toLowerCase()
  if (store === 'app_store' || store === 'mac_app_store') return 'app_store'
  if (store === 'play_store') return 'play_store'
  if (store === 'stripe') return 'stripe'
  return 'other'
}

function planNameFor(entitlementId: string, productId: string | null): string {
  if (entitlementId === ENTITLEMENT_FIRST_CLASS) return 'First Class'
  if (entitlementId === ENTITLEMENT_STANDARD_PREMIUM) return 'Standard Premium'
  if (productId) return productId
  return 'Active plan'
}

function planIdFromProductName(name: string): string | null {
  const n = name.toLowerCase()
  if (n.includes('first class') || n.includes('first_class')) return ENTITLEMENT_FIRST_CLASS
  if (n.includes('standard premium') || n.includes('standard_premium') || n.includes('standard')) {
    return ENTITLEMENT_STANDARD_PREMIUM
  }
  return null
}

function isEntitlementActive(ent: RcEntitlement, nowMs: number): boolean {
  const expires = ent.expires_date
  if (expires == null || expires === '') return true
  const ms = Date.parse(expires)
  if (Number.isNaN(ms)) return true
  return ms > nowMs
}

function emptyStatus(configured: boolean): AccountSubscriptionStatus {
  return {
    configured,
    hasActiveSubscription: false,
    planName: null,
    productId: null,
    entitlementId: null,
    store: null,
    storeLabel: null,
    manageMessage: null,
    manageUrl: null,
    manageCtaLabel: null,
    manageViaPortalSession: false,
  }
}

function finalizeStripeManage(status: AccountSubscriptionStatus): AccountSubscriptionStatus {
  if (status.store !== 'stripe') return status
  const manageViaPortalSession = Boolean(process.env.STRIPE_SECRET_KEY?.trim())
  status.manageViaPortalSession = manageViaPortalSession
  if (!status.manageUrl && !manageViaPortalSession) {
    status.manageCtaLabel = null
  }
  if (manageViaPortalSession) {
    status.manageUrl = null
    status.manageCtaLabel = manageCtaLabelFor('stripe')
  }
  return status
}

async function statusFromStripe(email: string | null): Promise<AccountSubscriptionStatus | null> {
  const stripeKey = process.env.STRIPE_SECRET_KEY?.trim()
  if (!stripeKey || !email) return null

  const stripe = new Stripe(stripeKey)
  const customers = await stripe.customers.list({ email, limit: 5 })
  const customer = customers.data.find((c) => !c.deleted) || customers.data[0]
  if (!customer) return null

  // Stripe allows at most 4 expand levels; `data.items.data.price.product` is 5.
  const subs = await stripe.subscriptions.list({
    customer: customer.id,
    status: 'all',
    limit: 20,
    expand: ['data.items.data.price'],
  })

  const active = subs.data.find((s) => s.status === 'active' || s.status === 'trialing')
  if (!active) return null

  const item = active.items.data[0]
  const price = item?.price
  const productRef = price?.product
  const productId =
    typeof productRef === 'string'
      ? productRef
      : productRef && !productRef.deleted
        ? productRef.id
        : null

  let productName = ''
  if (productRef && typeof productRef !== 'string' && !productRef.deleted) {
    productName = productRef.name || ''
  } else if (productId) {
    try {
      const product = await stripe.products.retrieve(productId)
      if (!product.deleted) productName = product.name || ''
    } catch {
      // Name is only used for plan labeling; fall back below.
    }
  }

  const entitlementId = planIdFromProductName(productName) || ENTITLEMENT_STANDARD_PREMIUM

  return finalizeStripeManage({
    configured: true,
    hasActiveSubscription: true,
    planName: planNameFor(entitlementId, productId),
    productId,
    entitlementId,
    store: 'stripe',
    storeLabel: storeLabelFor('stripe'),
    manageMessage: manageMessageFor('stripe'),
    manageUrl: null,
    manageCtaLabel: manageCtaLabelFor('stripe'),
    manageViaPortalSession: true,
  })
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

export async function GET(request: NextRequest) {
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

  const rcKey = revenueCatKeyForSubscriberLookup()
  const stripeConfigured = Boolean(process.env.STRIPE_SECRET_KEY?.trim())

  if (rcKey) {
    try {
      const rcRes = await fetchWithTimeout(
        `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${rcKey}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Platform': 'web',
          },
          cache: 'no-store',
        },
        8000
      )

      if (rcRes.ok) {
        const payload = (await rcRes.json()) as RcSubscriberResponse
        const entitlements = payload.subscriber?.entitlements || {}
        const subscriptions = payload.subscriber?.subscriptions || {}
        const managementUrlFromRc = payload.subscriber?.management_url?.trim() || null
        const nowMs = Date.now()

        let chosenId: string | null = null
        let chosen: RcEntitlement | null = null
        for (const id of ENTITLEMENT_PRIORITY) {
          const ent = entitlements[id]
          if (ent && isEntitlementActive(ent, nowMs)) {
            chosenId = id
            chosen = ent
            break
          }
        }

        if (!chosenId || !chosen) {
          for (const [id, ent] of Object.entries(entitlements)) {
            if (ent && isEntitlementActive(ent, nowMs)) {
              chosenId = id
              chosen = ent
              break
            }
          }
        }

        if (chosenId && chosen) {
          const productId = chosen.product_identifier?.trim() || null
          const storeRaw = productId ? subscriptions[productId]?.store : null
          const store = mapStore(storeRaw)
          const storeManageUrl = manageUrlFor(store)
          const manageUrl =
            store === 'stripe'
              ? managementUrlFromRc || storeManageUrl
              : storeManageUrl || managementUrlFromRc

          return json(
            200,
            finalizeStripeManage({
              configured: true,
              hasActiveSubscription: true,
              planName: planNameFor(chosenId, productId),
              productId,
              entitlementId: chosenId,
              store,
              storeLabel: storeLabelFor(store),
              manageMessage: manageMessageFor(store),
              manageUrl,
              manageCtaLabel: manageCtaLabelFor(store),
              manageViaPortalSession: false,
            })
          )
        }
      } else {
        const detail = await rcRes.text().catch(() => '')
        console.error('[subscription] RevenueCat error', rcRes.status, detail.slice(0, 300))
      }
    } catch (err) {
      console.error('[subscription] RevenueCat fetch failed', err)
    }
  }

  // Fallback: active Stripe subscription for this account email (covers post-checkout before RC sync).
  try {
    const fromStripe = await statusFromStripe(email)
    if (fromStripe) return json(200, fromStripe)
  } catch (err) {
    console.error('[subscription] Stripe fallback failed', err)
  }

  return json(200, emptyStatus(Boolean(rcKey) || stripeConfigured))
}
