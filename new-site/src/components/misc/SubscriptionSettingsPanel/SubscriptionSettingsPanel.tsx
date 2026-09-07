'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { BUTWideButton } from '@/components/buttons'
import {
  fetchStripeSubscriptionPlans,
  groupStripePlansByTier,
  startStripeCheckoutSession,
  syncStripeCheckoutToRevenueCat,
  type StripePlanCard,
  type StripeWebPlanId,
} from '@/services/stripeWebCheckout'
import {
  openStripeCustomerPortal,
  type AccountSubscriptionStatus,
} from '@/services/subscriptionStatus'

type Props = {
  getIdToken: () => Promise<string>
  status: AccountSubscriptionStatus | null
  statusLoading: boolean
  statusError: string | null
  devOverrideNote: string | null
  onStatusRefresh: () => Promise<void>
}

export default function SubscriptionSettingsPanel({
  getIdToken,
  status,
  statusLoading,
  statusError,
  devOverrideNote,
  onStatusRefresh,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const handledCheckoutRef = useRef<string | null>(null)
  const getIdTokenRef = useRef(getIdToken)
  const onStatusRefreshRef = useRef(onStatusRefresh)
  getIdTokenRef.current = getIdToken
  onStatusRefreshRef.current = onStatusRefresh

  const [plansLoading, setPlansLoading] = useState(false)
  const [plansConfigured, setPlansConfigured] = useState(false)
  const [planCards, setPlanCards] = useState<StripePlanCard[]>([])
  const [selectedPriceByPlan, setSelectedPriceByPlan] = useState<
    Partial<Record<StripeWebPlanId, string>>
  >({})
  const [plansError, setPlansError] = useState<string | null>(null)
  const [checkoutPlanId, setCheckoutPlanId] = useState<string | null>(null)
  const [purchaseBusy, setPurchaseBusy] = useState(false)
  const [purchaseError, setPurchaseError] = useState<string | null>(null)
  const [purchaseInfo, setPurchaseInfo] = useState<string | null>(null)
  const [portalBusy, setPortalBusy] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)

  const loadPlans = useCallback(async () => {
    setPlansLoading(true)
    setPlansError(null)
    try {
      const result = await fetchStripeSubscriptionPlans()
      setPlansConfigured(result.configured)
      setPlanCards(result.plans)
      setSelectedPriceByPlan((prev) => {
        const next: Partial<Record<StripeWebPlanId, string>> = { ...prev }
        for (const planId of ['standard_premium', 'first_class'] as const) {
          const intervals = result.plans.filter((p) => p.planId === planId)
          if (intervals.length === 0) continue
          const stillValid = intervals.some((p) => p.priceId === next[planId])
          if (!stillValid) {
            const monthly = intervals.find((p) => p.intervalKey === 'month')
            next[planId] = (monthly || intervals[0]).priceId
          }
        }
        return next
      })
      if (result.configured && result.plans.length === 0) {
        setPlansError(
          result.error ||
            'No Stripe subscription prices found for Standard Premium / First Class. Check product names in the Stripe sandbox.'
        )
      }
      if (!result.configured) {
        setPlansError('Stripe is not configured on this deployment (missing STRIPE_SECRET_KEY).')
      }
    } catch (err) {
      setPlansError(err instanceof Error ? err.message : 'Could not load plans.')
      setPlanCards([])
    } finally {
      setPlansLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const checkoutFlag = searchParams.get('checkout')
  const sessionId = searchParams.get('session_id')

  useEffect(() => {
    if (checkoutFlag === 'cancelled') {
      setPurchaseInfo('Checkout cancelled — no charge was made.')
      router.replace('/account/settings?topic=subscription', { scroll: false })
      return
    }

    if (checkoutFlag !== 'success' || !sessionId) return
    // Guard against duplicate syncs (Strict Mode remount / query-param churn).
    // Do not abort in-flight work on cleanup — that left the UI stuck on "Confirming…".
    if (handledCheckoutRef.current === sessionId) return
    handledCheckoutRef.current = sessionId

    setPurchaseInfo('Confirming your subscription…')

    void (async () => {
      try {
        const token = await getIdTokenRef.current()
        const sync = await syncStripeCheckoutToRevenueCat({ idToken: token, sessionId })
        if (sync.synced) {
          setPurchaseInfo('Subscription confirmed. Refreshing status…')
        } else {
          setPurchaseInfo(
            sync.error ||
              'Payment received. Entitlements may take a moment to appear — refreshing status…'
          )
        }
        await onStatusRefreshRef.current()
        setPurchaseInfo(
          'Subscription updated. You can manage billing below when status shows active.'
        )
      } catch (err) {
        setPurchaseError(err instanceof Error ? err.message : 'Could not confirm checkout.')
        setPurchaseInfo(null)
      } finally {
        // Clear success query params so this path never re-enters.
        router.replace('/account/settings?topic=subscription', { scroll: false })
      }
    })()
  }, [checkoutFlag, sessionId, router])

  const handleSubscribe = async (planId: StripeWebPlanId) => {
    const priceId = selectedPriceByPlan[planId]
    const card = planCards.find((p) => p.priceId === priceId)
    if (!card) {
      setPurchaseError('Choose a billing length first.')
      return
    }
    setPurchaseBusy(true)
    setPurchaseError(null)
    setPurchaseInfo(null)
    setCheckoutPlanId(planId)
    try {
      const token = await getIdToken()
      const url = await startStripeCheckoutSession({
        idToken: token,
        priceId: card.priceId,
        planId: card.planId,
      })
      window.location.assign(url)
    } catch (err) {
      setPurchaseError(err instanceof Error ? err.message : 'Could not start checkout.')
      setPurchaseBusy(false)
      setCheckoutPlanId(null)
    }
  }

  const handleManage = async () => {
    setPortalError(null)
    if (status?.manageUrl) {
      window.open(status.manageUrl, '_blank', 'noopener,noreferrer')
      return
    }
    if (!status?.manageViaPortalSession && status?.store !== 'stripe') {
      setPortalError('Billing management is not available for this subscription yet.')
      return
    }
    setPortalBusy(true)
    try {
      const token = await getIdToken()
      const url = await openStripeCustomerPortal(token)
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      setPortalError(err instanceof Error ? err.message : 'Could not open billing portal.')
    } finally {
      setPortalBusy(false)
    }
  }

  const showPurchaseUiRelaxed =
    !statusLoading &&
    !status?.hasActiveSubscription &&
    (status?.configured !== false || (plansConfigured && planCards.length > 0))

  const canManage =
    Boolean(status?.hasActiveSubscription) &&
    (Boolean(status?.manageUrl) ||
      Boolean(status?.manageViaPortalSession) ||
      status?.store === 'stripe')

  return (
    <div className="rs-account-section__copy-stack rs-subscription-panel">
      {statusLoading ? <p className="rs-account-section__meta">Loading subscription…</p> : null}

      {!statusLoading && statusError ? <p className="rs-account-error">{statusError}</p> : null}

      {!statusLoading && status && !status.configured ? (
        <p className="rs-account-section__copy">
          Subscription status lookup is unavailable (RevenueCat server key). You can still subscribe
          via Stripe below if plans load. See <Link href="/pricing">pricing</Link>.
        </p>
      ) : null}

      {!statusLoading && status?.hasActiveSubscription ? (
        <>
          <p className="rs-account-section__meta">Plan: {status.planName ?? 'Active plan'}</p>
          <p className="rs-account-section__meta">
            Purchased via: {status.storeLabel ?? 'Unknown store'}
          </p>
          {status.manageMessage ? (
            <p className="rs-account-section__copy">{status.manageMessage}</p>
          ) : null}
          {canManage ? (
            <div className="rs-account-section__actions">
              <BUTWideButton
                type="button"
                width="fill"
                colorVariant="accent"
                disabled={portalBusy}
                onClick={() => void handleManage()}
              >
                {portalBusy ? 'Opening…' : status.manageCtaLabel || 'Manage billing'}
              </BUTWideButton>
            </div>
          ) : null}
          {portalError ? <p className="rs-account-error">{portalError}</p> : null}
        </>
      ) : null}

      {showPurchaseUiRelaxed ? (
        <>
          <p className="rs-account-section__copy">
            Subscribe with Stripe Checkout (hosted by Stripe). The same Standard Premium and First
            Class entitlements unlock in the apps when you are signed in with this account.
          </p>
          <p className="rs-account-section__meta">
            Prefer a full plan comparison? See <Link href="/pricing">pricing</Link>.
          </p>

          {plansLoading ? <p className="rs-account-section__meta">Loading plans…</p> : null}
          {plansError ? <p className="rs-account-error">{plansError}</p> : null}

          {!plansLoading && planCards.length > 0 ? (
            <div className="rs-subscription-plans">
              {groupStripePlansByTier(planCards).map((tier) => {
                const selectedId = selectedPriceByPlan[tier.planId]
                const selected =
                  tier.intervals.find((i) => i.priceId === selectedId) || tier.intervals[0]
                return (
                  <article key={tier.planId} className="rs-subscription-plan">
                    <h3 className="rs-subscription-plan__title">{tier.title}</h3>
                    <div className="rs-subscription-plan__intervals" role="group" aria-label={`${tier.title} billing length`}>
                      {tier.intervals.map((interval) => {
                        const active = interval.priceId === selected.priceId
                        return (
                          <button
                            key={interval.priceId}
                            type="button"
                            className={
                              active
                                ? 'rs-subscription-plan__interval rs-subscription-plan__interval--active'
                                : 'rs-subscription-plan__interval'
                            }
                            aria-pressed={active}
                            onClick={() =>
                              setSelectedPriceByPlan((prev) => ({
                                ...prev,
                                [tier.planId]: interval.priceId,
                              }))
                            }
                          >
                            <span className="rs-subscription-plan__interval-name">
                              {interval.intervalLabel}
                            </span>
                            <span className="rs-subscription-plan__interval-price">
                              {interval.priceLabel}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                    <p className="rs-subscription-plan__price">
                      {selected.priceLabel}
                      {selected.periodLabel ? (
                        <span className="rs-subscription-plan__period"> {selected.periodLabel}</span>
                      ) : null}
                    </p>
                    <ul className="rs-subscription-plan__features">
                      {tier.features.map((feature) => (
                        <li key={feature}>{feature}</li>
                      ))}
                    </ul>
                    <div className="rs-account-section__actions">
                      <BUTWideButton
                        type="button"
                        width="fill"
                        colorVariant="accent"
                        disabled={purchaseBusy}
                        onClick={() => void handleSubscribe(tier.planId)}
                      >
                        {purchaseBusy && checkoutPlanId === tier.planId
                          ? 'Redirecting to Stripe…'
                          : `Subscribe to ${tier.title}`}
                      </BUTWideButton>
                    </div>
                  </article>
                )
              })}
            </div>
          ) : null}
        </>
      ) : null}

      {purchaseInfo ? <p className="rs-account-info">{purchaseInfo}</p> : null}
      {purchaseError ? <p className="rs-account-error">{purchaseError}</p> : null}

      {!statusLoading && !status && !statusError ? (
        <p className="rs-account-section__meta">Unable to load subscription status.</p>
      ) : null}

      {devOverrideNote ? <p className="rs-account-section__copy">{devOverrideNote}</p> : null}
    </div>
  )
}
