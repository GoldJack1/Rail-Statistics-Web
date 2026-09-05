# Website — User accounts implementation plan

Parity target: iOS `experiment/useraccountalt` (`rail-statistics-uas` E2EE)  
Grounded in: **`New-Rail Statistics Web/new-site`** as it exists today  
Design source: iOS [`USER_ACCOUNTS_E2EE.md`](USER_ACCOUNTS_E2EE.md)

---

## 0. What the website is today (read first)

| Fact | Detail |
|------|--------|
| Stack | **Next.js 16** (App Router) + **React 19** + TypeScript under `new-site/` |
| Host | Netlify (`netlify.toml`, base `new-site/`) |
| Firebase | **One** project: **`rail-statistics`** (env `NEXT_PUBLIC_FIREBASE_*`) |
| Client | `src/services/firebase.ts`, lean Auth `firebaseAuthBootstrap.ts`, `AuthContext.tsx` |
| Firestore | `(default)` catalogues/messages + named DB **`railstatisticstickets`** |
| Consumer accounts | **None** — no `/account`, no user vault, no leaderboards |
| Staff admin auth | **Email/password + email verify + TOTP MFA** on **catalogue** project (not Google-only UI) |
| Admin entry | **Soft-hidden**: footer © **triple-tap** → `/log-in`; no header link |
| Admin routes | `/admin/*` behind `ProtectedRoute` (signed-in + verified + MFA) |
| Write authority | Firestore rules: claim `rs_station_editor` **or** owner email — UI currently does **not** require the claim |
| Footer when logged in | Shows Admin links (Messages, D-PAYG, etc.) + Log out |
| Sitemap | **`/log-in` is in sitemap** — remove when hardening; `/admin` disallowed in robots |

Google/Apple helpers exist on Auth context but are **unused** on the login page.

---

## 1. Dual login model (required)

Two **separate** logins. Prefer **two Firebase apps/projects** so consumer Auth cannot open admin tools by accident.

| Login | Audience | Firebase | Auth UX today / target | Visibility |
|-------|----------|----------|------------------------|------------|
| **Admin (staff)** | Catalogue editors | **`rail-statistics`** (existing) | Keep email/password + verify + TOTP | **Hidden** — triple-tap / direct `/log-in` only; not in public nav |
| **Consumer (app users)** | Cloud sync / profile / boards | **`rail-statistics-uas`** (new web app) | Email/password + verify + **required** TOTP + recovery key (match iOS) | Public: `/account` / `/sign-in` |

### Why not put consumers on `rail-statistics` Auth?

Today `ProtectedRoute` only checks “signed in + verified + MFA”. A consumer on the **same** Auth project could browse `/admin/*` UI (writes still blocked by rules, but shells/leak surface). Options:

1. **Preferred (aligns with iOS):** consumers on **`rail-statistics-uas`**; admin stays on **`rail-statistics`**.  
2. **Same-project fallback:** before any public sign-up, harden admin to require `rs_station_editor` (and hide footer Admin chrome for non-editors). Still weaker isolation than (1).

This plan assumes **(1)**.

---

## 2. Goals

### Consumer (public)

- Sign up / sign in / MFA / recovery unlock against UAs  
- Account settings + leaderboards  
- Optional later: full diary edit + conflict UI in browser  

### Admin (hidden — keep behaviour, tighten discoverability)

- Keep existing `/log-in` + MFA staff flow on catalogue Firebase  
- Remove `/log-in` from **sitemap**  
- Keep robots disallow `/admin/`  
- Tighten `ProtectedRoute` + footer to **editors only** (`rs_station_editor` / owner), even with dual project (defence in depth)  
- Do **not** add a public “Admin” nav item  

---

## 3. Concrete plug-in points (existing code)

| Area | Path | Change |
|------|------|--------|
| Dual Firebase init | `src/services/firebase.ts` | Second `initializeApp` for UAs; export `uasAuth`, `uasDb` (`useraccounts`), `uasStorage` |
| Auth context | `src/contexts/AuthContext.tsx` | Split **AdminAuth** vs **ConsumerAuth** (or two contexts) — do not overload one `user` for both |
| Staff login | `src/app/log-in/*`, `ProtectedRoute` | Stay on catalogue Auth; add claim check |
| Footer | `src/components/misc/Footer/Footer.tsx` | Triple-tap → staff login only; Admin links only if editor; never link consumer account here as “admin” |
| New routes | `src/app/account/*`, `src/app/sign-in/*` (names TBD) | Consumer UAs flows |
| Sitemap / robots | `src/app/sitemap.ts`, `robots.ts` | Drop `/log-in` from sitemap; disallow `/account` only if you want private — usually allow sign-in |
| Cold load | `coldVisitorPerf.ts` | Eager Auth init for `/account*` as well as `/log-in` + `/admin*` |
| Legal | privacy / eula pages | Mention web consumer accounts when shipping |

Suggested new modules:

```text
src/services/userAccountsFirebase.ts
src/services/vaultCrypto.ts
src/services/encryptedVaultSync.ts
src/contexts/ConsumerAuthContext.tsx
src/app/account/...
src/app/sign-in/...   // or under /account/sign-in
```

---

## 4. Consumer Firebase + crypto

Register a **Web** app on `rail-statistics-uas`. Use Firestore DB **`useraccounts`** and existing iOS rules/indexes/storage rules.

Match iOS `VaultCrypto`:

- AES-GCM combined = CryptoKit sealed box  
- HKDF salt `railstats.vault.recovery.v1`, info `vault-wrap`  
- Snapshot `vault/{uid}/data/snapshot`, `alg: "AES-GCM-256"`, schemaVersion **2**  
- Issuer string for TOTP QR: **`Rail Statistics`**

Unlock vault in the **browser** with Web Crypto; never POST recovery keys to your Netlify/Functions backend.

v1 tip: unlock + leaderboards + account settings first; full web diary editing later (conflict complexity).

---

## 5. Route sketch

```text
Public
  /                         marketing
  /sign-in or /account/...  consumer (UAs)
  /leaderboards             consumer boards
  /stations, /d-payg-fares  catalogue (unchanged)

Hidden staff
  /log-in                   catalogue Auth (triple-tap)
  /admin/*                  editors only
```

Session isolation: signing out of consumer must not clear admin (and vice versa) unless you explicitly offer “sign out everywhere”.

---

## 6. Phased delivery

| Phase | Work | Exit criteria |
|-------|------|----------------|
| **0** | Dual Firebase shell + split auth contexts | Admin still works; UAs Auth instance separate |
| **0b** | Harden admin: claim check + remove `/log-in` from sitemap + footer only for editors | Random MFA user cannot usefully use admin chrome |
| **1** | Consumer sign-up/sign-in/verify/TOTP (+ QR) | UAs user creatable from web |
| **2** | Recovery unlock + decrypt iOS snapshot | Interop proof |
| **3** | Account settings + avatar | Core parity |
| **4** | Leaderboards read + opt-in publish if unlocked | Same boards as apps |
| **5** | (Optional) vault write + conflict UI | Safe multi-client edits |
| **6** | CSP / App Check / staging | Public launch |

---

## 7. Testing checklist

### Consumer

- [ ] Sign-up path with recovery + MFA  
- [ ] Unlock vault created on iOS/Android  
- [ ] Password reset ≠ vault unlock  
- [ ] No access to `/admin` with only UAs session  

### Admin (hidden)

- [ ] Triple-tap still reaches `/log-in`  
- [ ] `/log-in` not in sitemap  
- [ ] Non-editor catalogue Auth user blocked from admin UI  
- [ ] Editors can still publish stations / D-PAYG  
- [ ] Network: admin → `rail-statistics`; consumer → `rail-statistics-uas`  

---

## 8. Ops checklist

- [ ] Web app on `rail-statistics-uas` + Auth authorised domains  
- [ ] Env vars for second Firebase config on Netlify (do not overwrite catalogue keys)  
- [ ] TOTP MFA enabled on UAs  
- [ ] Rules deployed to DB `useraccounts`  
- [ ] Restore/document `rs_station_editor` claim script (referenced but missing in tree)  

---

## 9. Reference

**Website:** `new-site/src/services/firebase.ts`, `AuthContext.tsx`, `ProtectedRoute.tsx`, `app/log-in/*`, `app/admin/**`, `Footer.tsx`, `firestore.rules`  
**iOS:** `Railstats/Account/*`, `Docs/USER_ACCOUNTS_E2EE.md`  
**Android plan:** [`ANDROID_USER_ACCOUNTS_IMPLEMENTATION_PLAN.md`](ANDROID_USER_ACCOUNTS_IMPLEMENTATION_PLAN.md)
