/**
 * Consumer account + Stripe web billing (pricing, checkout, portal, leaderboards).
 * Set `NEXT_PUBLIC_ACCOUNT_ENABLED=true` to show Account in the nav and enable routes.
 * Unset / any other value keeps the system off (safe default for production).
 */
export const isAccountSystemEnabled = process.env.NEXT_PUBLIC_ACCOUNT_ENABLED === 'true'
