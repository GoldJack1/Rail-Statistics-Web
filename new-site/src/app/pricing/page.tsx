'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { BUTWideButton } from '@/components/buttons'
import { PageTopHeader } from '@/components/misc'
import { useConsumerAuth } from '@/contexts/ConsumerAuthContext'
import { PRICING_PAGE_PLANS } from '@/services/revenueCatWeb'
import {
  fetchStripeSubscriptionPlans,
  groupStripePlansByTier,
  type StripePlanCard,
} from '@/services/stripeWebCheckout'
import '../account/account.css'
import './PricingPage.css'

const SUBSCRIBE_PATH = '/account/settings?topic=subscription'
const SIGN_IN_FROM_PRICING = `/account/sign-in?from=${encodeURIComponent(SUBSCRIBE_PATH)}`

export default function PricingPage() {
  const { user, loading } = useConsumerAuth()
  const [cards, setCards] = useState<StripePlanCard[]>([])
  const [plansNote, setPlansNote] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void fetchStripeSubscriptionPlans()
      .then((result) => {
        if (cancelled) return
        setCards(result.plans)
        if (!result.configured) {
          setPlansNote('Stripe checkout is not configured on this deployment yet.')
        } else if (result.plans.length === 0) {
          setPlansNote(
            result.error ||
              'Prices will appear once Standard Premium and First Class products exist in Stripe.'
          )
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPlansNote('Could not load live prices. You can still open Account Settings to subscribe.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  const ctaHref = !loading && user ? SUBSCRIBE_PATH : SIGN_IN_FROM_PRICING
  const ctaLabel = !loading && user ? 'Subscribe in Account Settings' : 'Sign in to subscribe'
  const tiers = groupStripePlansByTier(cards)

  return (
    <div className="container container--station-details">
      <PageTopHeader
        title="Pricing"
        subtitle="Standard Premium and First Class — monthly, 3 months, or yearly via Stripe Checkout. App Store / Google Play plans stay managed in those stores."
        actionButton={{ to: '/', label: 'Back to home' }}
      />

      <div className="pricing-page">
        <p className="pricing-page__intro rs-account-section__copy">
          Website checkout redirects to Stripe. Premium app features unlock for the same Rail
          Statistics account. Ad-free, widgets, and Ticket Tracking remain app features.
        </p>

        {plansNote ? <p className="rs-account-section__meta">{plansNote}</p> : null}

        <div className="pricing-page__grid rs-subscription-plans">
          {PRICING_PAGE_PLANS.map((plan) => {
            const tier = tiers.find((t) => t.planId === plan.planId)
            return (
              <article key={plan.planId} className="rs-subscription-plan pricing-page__card">
                <h2 className="rs-subscription-plan__title">{plan.title}</h2>
                {tier && tier.intervals.length > 0 ? (
                  <ul className="rs-subscription-plan__price-list">
                    {tier.intervals.map((interval) => (
                      <li key={interval.priceId}>
                        <span className="rs-subscription-plan__interval-name">
                          {interval.intervalLabel}
                        </span>
                        <span className="rs-subscription-plan__interval-price">
                          {interval.priceLabel}
                          {interval.periodLabel ? (
                            <span className="rs-subscription-plan__period">
                              {' '}
                              {interval.periodLabel}
                            </span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="rs-subscription-plan__price">
                    <span className="rs-subscription-plan__period">Price shown at checkout</span>
                  </p>
                )}
                <ul className="rs-subscription-plan__features">
                  {plan.features.map((feature) => (
                    <li key={feature}>{feature}</li>
                  ))}
                </ul>
                <p className="rs-subscription-plan__desc">{plan.appOnlyNote}</p>
              </article>
            )
          })}
        </div>

        <div className="pricing-page__cta rs-account-section__actions">
          <BUTWideButton type="button" width="fill" colorVariant="accent" to={ctaHref}>
            {ctaLabel}
          </BUTWideButton>
          <p className="rs-account-section__meta">
            Already subscribed in the apps? Manage that plan in the App Store or Google Play, or open{' '}
            <Link href={SUBSCRIBE_PATH}>Account Settings → Subscription</Link> while signed in.
          </p>
        </div>
      </div>
    </div>
  )
}
