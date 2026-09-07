# Web Stripe billing via RevenueCat

Experiment branch setup for selling **Standard Premium** and **First Class** on the website with Stripe Billing, while RevenueCat remains the entitlement hub (same `standard_premium` / `first_class` IDs as the apps).

If you already sell those plans via **App Store / Google Play** on the live apps, keep that. Web Stripe is an **additional** purchase path into the **same entitlements**.

---

## A. Stripe Dashboard (live or sandbox)

You already have a Stripe account. Complete these product/billing pieces:

### 1. Products & prices
Create **two recurring subscription products** (Billing → Products):

| Product name (display) | Suggested Stripe product name | Recurring price |
|------------------------|-------------------------------|-----------------|
| Standard Premium | `Standard Premium` | Your monthly/yearly amount |
| First Class | `First Class` | Your monthly/yearly amount |

Notes:
- Use **one price per product** if possible (RevenueCat imports one price per product cleanly).
- Prefer the same currency you want on the website (e.g. GBP).
- You do **not** reuse App Store / Play product IDs here — these are new Stripe Price IDs (`price_…`).

### 2. Customer Portal
1. Stripe → **Settings → Billing → Customer portal**
2. Enable: cancel subscription, update payment method, view invoices (as you want)
3. Default return URL (production):  
   `https://railstatistics.co.uk/account/settings?topic=subscription`
4. Add localhost/preview return URLs when testing

### 3. Payment methods / wallets (optional but recommended)
- Enable card (+ Link if you want)
- For Apple Pay / Google Pay on **your** domain: Stripe → Settings → Payment methods → add domain `railstatistics.co.uk` (and preview domains)

### 4. Keys you’ll need later
- **Secret key** `sk_live_…` or `sk_test_…` → optional website env `STRIPE_SECRET_KEY` (portal fallback)
- Publishable key is **not** required by our current code (RevenueCat Web SDK talks to Stripe via RC)

---

## B. RevenueCat Dashboard (same project as the apps)

Your live app subscriptions already use entitlements **`standard_premium`** and **`first_class`**. Do **not** create different entitlement IDs for web — map Stripe products into those.

### 1. Connect Stripe
1. RevenueCat → Account settings → **Connect Stripe** (project **owner** only)
2. Install the **RevenueCat** app from the Stripe App Marketplace on the correct Stripe account (sandbox for testing, live for production)
3. Finish linking so the Stripe account appears in RevenueCat

Use a **Sandbox** Stripe connection first for testing, then a separate live config.

### 2. Create a Stripe **Web** config
1. Project → **Web** (lower sidebar) → create config
2. Provider: **Stripe Billing**
3. Select the connected Stripe account
4. Appearance: logo + brand colours (site accent `#B20016`, neutrals)
5. **Subscription management**: paste/configure Customer Portal URL so `management_url` is returned for Stripe subscribers
6. Leave Managed Payments off unless you specifically want Stripe MoR later

### 3. Import Stripe products
1. Product Catalog → Products → select your **Stripe** web config → **Import**
2. Import Standard Premium + First Class (pick the correct price if a product has more than one)

### 4. Attach to entitlements (critical)
For each imported Stripe product:
- Attach to entitlement **`standard_premium`** or **`first_class`** (same as App Store / Play products)

Apps and web then unlock the same premium status.

### 5. Offering + packages
1. Product Catalog → **Offerings** → create or edit the **current** offering used for web
2. Add packages for both plans
3. Prefer package / product identifiers that include `standard_premium` and `first_class`  
   (the website maps plans by those strings in the identifier/title)

### 6. API keys
From RevenueCat → Project → API keys:

| Key | Website env var | Used for |
|-----|-----------------|----------|
| **Web Billing** public key (often looks like `rcb_…` / web key) | `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY` | Checkout / offerings in the browser |
| Secret `sk_…` (or existing server key you already use) | `REVENUECAT_API_KEY` | Account Settings status via `GET /v1/subscribers` |

App Store public keys (`appl_…`) are **not** a substitute for the Web Billing public key for purchases-js.

---

## C. Website / Netlify env

Set in **Netlify** (and `.env.local` for local):

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY` | **Yes** for checkout | Web SDK |
| `REVENUECAT_API_KEY` | **Yes** for status | Already used for Account Settings subscription status |
| `STRIPE_SECRET_KEY` | **Yes** for checkout + portal | Stripe API |
| `STRIPE_BILLING_PORTAL_CONFIGURATION_ID` | Recommended | Customer Portal config (`bpc_…`). Sandbox: `bpc_1UD7cgDxpXAfNVfBLYV5gpwG` |
| `REVENUECAT_API_KEY` | **Yes** for status/sync | Account Settings status + post-checkout sync |
| `NEXT_PUBLIC_UAS_FIREBASE_API_KEY` (+ other UAS vars) | Yes (already) | Auth for status/portal APIs |
| `NEXT_PUBLIC_SITE_URL` | Recommended | Portal return URL origin (`https://railstatistics.co.uk`) |

After changing env vars, redeploy Netlify.

---

## D. What you do **not** need to change (for web-only launch)

- Existing App Store / Play products and IAP in the apps
- Existing mobile RevenueCat `logIn(firebaseUid)` (web uses the same UID)
- Migrating current live subscribers off stores

Store subscribers keep managing in App Store / Play. New web subscribers manage via Stripe Customer Portal.

---

## E. Smoke test order

1. Sandbox Stripe + RC Stripe web config  
2. Sign in on the website with a test UAs account  
3. **Account Settings → Subscription** → see plan cards with prices  
4. Complete test Checkout  
5. Confirm status shows **First Class** / **Standard Premium** and **Website (Stripe)**  
6. **Manage billing** opens Customer Portal  
7. Sign in on the app with the same account → premium entitlements active  
8. Repeat with live Stripe config + live keys when ready  

---

## Website checkout (Stripe-hosted)

The site no longer embeds Checkout. Flow:

1. Account Settings loads plans from Stripe (`GET /api/account/subscription/plans`) — prefers **monthly** prices named Standard Premium / First Class.
2. Subscribe redirects to **Stripe Checkout** (`POST /api/account/subscription/checkout`).
3. On return, `POST /api/account/subscription/sync` sends the session/subscription to RevenueCat so app entitlements unlock.
4. Manage billing uses Stripe Customer Portal sessions.

Required env: `STRIPE_SECRET_KEY`. Optional: `REVENUECAT_API_KEY` for status + sync. `NEXT_PUBLIC_REVENUECAT_WEB_API_KEY` is no longer required for web checkout.

