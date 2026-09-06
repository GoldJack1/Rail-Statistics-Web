import { NextRequest, NextResponse } from 'next/server'
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
  return 'other'
}

function planNameFor(entitlementId: string, productId: string | null): string {
  if (entitlementId === ENTITLEMENT_FIRST_CLASS) return 'First Class'
  if (entitlementId === ENTITLEMENT_STANDARD_PREMIUM) return 'Standard Premium'
  if (productId) return productId
  return 'Active plan'
}

function isEntitlementActive(ent: RcEntitlement, nowMs: number): boolean {
  const expires = ent.expires_date
  if (expires == null || expires === '') return true
  const ms = Date.parse(expires)
  if (Number.isNaN(ms)) return true
  return ms > nowMs
}

async function verifyFirebaseIdToken(idToken: string): Promise<string> {
  const apiKey = process.env.NEXT_PUBLIC_UAS_FIREBASE_API_KEY?.trim()
  if (!apiKey || apiKey === 'placeholder') {
    throw new Error('User accounts Firebase is not configured.')
  }
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
      cache: 'no-store',
    }
  )
  const data = (await res.json().catch(() => null)) as
    | { users?: Array<{ localId?: string }>; error?: { message?: string } }
    | null
  if (!res.ok) {
    throw new Error(data?.error?.message || 'Invalid or expired sign-in.')
  }
  const uid = data?.users?.[0]?.localId?.trim()
  if (!uid) throw new Error('Invalid or expired sign-in.')
  return uid
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
  }
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get('authorization') || ''
  const idToken = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!idToken) {
    return json(401, { error: 'Sign in required.' })
  }

  let uid: string
  try {
    uid = await verifyFirebaseIdToken(idToken)
  } catch (err) {
    return json(401, { error: err instanceof Error ? err.message : 'Unauthorized.' })
  }

  const rcKey = process.env.REVENUECAT_API_KEY?.trim()
  if (!rcKey) {
    return json(200, emptyStatus(false))
  }

  const rcRes = await fetch(
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
    }
  )

  if (!rcRes.ok) {
    const detail = await rcRes.text().catch(() => '')
    console.error('[subscription] RevenueCat error', rcRes.status, detail.slice(0, 300))
    return json(502, { error: 'Could not load subscription status.' })
  }

  const payload = (await rcRes.json()) as RcSubscriberResponse
  const entitlements = payload.subscriber?.entitlements || {}
  const subscriptions = payload.subscriber?.subscriptions || {}
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

  if (!chosenId || !chosen) {
    return json(200, emptyStatus(true))
  }

  const productId = chosen.product_identifier?.trim() || null
  const storeRaw = productId ? subscriptions[productId]?.store : null
  const store = mapStore(storeRaw)

  const status: AccountSubscriptionStatus = {
    configured: true,
    hasActiveSubscription: true,
    planName: planNameFor(chosenId, productId),
    productId,
    entitlementId: chosenId,
    store,
    storeLabel: storeLabelFor(store),
    manageMessage: manageMessageFor(store),
    manageUrl: manageUrlFor(store),
    manageCtaLabel: manageCtaLabelFor(store),
  }

  return json(200, status)
}
