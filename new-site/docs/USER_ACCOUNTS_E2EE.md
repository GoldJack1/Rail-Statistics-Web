# User accounts (E2EE) — separate Firebase project

Branch: `experiment/useraccountalt`

Long-term design: **admin/catalogues stay on `rail-statistics`**. App user accounts, profiles, and **encrypted** travel vaults live in **Rail-Statistics-UAs** (`rail-statistics-uas`).

v1 plaintext sync on the catalogue project is **not** supported on this branch.

## Architecture

| Concern | Where |
|--------|--------|
| Admin Google / Identity Platform | Existing `rail-statistics` project |
| Station catalogues, public reads | Existing project |
| App email/password + TOTP MFA | **Rail-Statistics-UAs** (`rail-statistics-uas`) |
| Display name, username, 13+ / legal ack | Firestore `profiles` / `usernames` in UAs project |
| Stations + tickets sync | E2EE ciphertext in UAs project (`vault/{uid}/…`) |
| RevenueCat | `logIn(userProjectUid)` |
| Vault key | Random; wrapped by **recovery key**; session copy in **Keychain** (biometrics). Not derived from email/password/TOTP |

### Password reset

Firebase email reset restores **login** only. The vault still needs the **recovery key** (or an already-unlocked device Keychain). That is intentional for true E2EE.

## User accounts Firebase project (Rail-Statistics-UAs)

Project id: **`rail-statistics-uas`**. iOS config is already in:

`Railstats/GoogleService-Info-UserAccounts.plist`

Still required in Console for that project:

1. Enable **Authentication → Email/Password**.
2. Enable **Authentication → MFA → TOTP** (Authenticator app).
3. Create **Firestore** (production / Standard / Native). Database id: **`useraccounts`** (not `(default)`). Then publish rules from [`firestore.rules.user-accounts`](../firestore.rules.user-accounts) to **that database in this project only**.

   ```bash
   npx -y firebase-tools@latest deploy --only firestore --project rail-statistics-uas --config firebase.user-accounts.json
   ```

4. (Optional) App Check for the UAs iOS app — register debug tokens as needed.

The iOS client uses `Firestore.firestore(app:database: "useraccounts")`.

## Local crypto (app)

- Vault payload: AES-GCM (CryptoKit), key = 256-bit random.
- Recovery key: 128-bit entropy, shown once as base32; used to wrap the vault key (HKDF + AES-GCM).
- After unlock: vault key stored in Keychain (`WhenUnlockedThisDeviceOnly`, access control with biometry when available).
- Passkey **PRF** wrap can be added later; recovery + Keychain is the durable portable path.

## Sign-up fields

- Display name, email, password, username (unique)
- Checkbox: 13 or older
- Links: Privacy + EULA
- Then: show recovery key (must confirm saved) → **verify email** (Firebase requirement for MFA) → **required** TOTP enroll (cannot skip) → permissions / app

## Leaderboards (client-published)

Diary visit flags stay in the **E2EE vault**, so rankings cannot be computed on the server. Opted-in users publish **aggregates only** to `leaderboardEntries/{uid}` on the UAs `useraccounts` database:

- `visitedCountAll` / `percentAll` — all standard networks (excludes admin-only GB Heritage)
- `byNetwork/{networkId}` — per-network visited / total / percent for the same fair set
- Username / display name denormalized from `profiles`

UI: **All networks** / **By network** via `BUTTwoButtonBar`, with network tab pills when filtering by network.

Opt-in prefs (**Account Settings**): **All networks** publishes the combined total **and** every per-network board. When All is off, per-network toggles choose which By-network boards to join. Optional **display name**; **@username is always shown.** Profile photo always shows (placeholder if none).

Profile photos live in UAs Storage (`avatars/{uid}/profile.jpg`).

## Account hub vs Account Settings

- **Account** hub: profile card, enable cloud sync (recovery key), Account Settings, View Leaderboard, Sign out.
- **Account Settings**: photo, display name, username, password, 2FA status, email, leaderboard prefs, cloud sync / Sync Now, restore subscription.

User-facing copy uses **cloud sync** (not “vault”). Internals still use vault crypto/Keychain.

Leaderboard visit stats publish at most **once per hour** (forced immediately when leaderboard prefs / opt-in / name / username change, or avatar URL refresh while opted in).

Cloud sync uploads automatically (debounced) when stations or tickets change while signed in and unlocked.

## Web Stripe subscriptions

Website checkout (Stripe Billing via RevenueCat Web SDK) is documented in [`WEB_STRIPE_REVENUECAT.md`](WEB_STRIPE_REVENUECAT.md). Same Firebase UID → RevenueCat App User ID as mobile.

## Cross-platform plans

- Android: [`ANDROID_USER_ACCOUNTS_IMPLEMENTATION_PLAN.md`](ANDROID_USER_ACCOUNTS_IMPLEMENTATION_PLAN.md)
- Website (consumer + **hidden** admin login): [`WEBSITE_USER_ACCOUNTS_IMPLEMENTATION_PLAN.md`](WEBSITE_USER_ACCOUNTS_IMPLEMENTATION_PLAN.md)

