# Rail Statistics — Next.js site

Next.js port of the Rail Statistics web app (migrated from the Vite/React SPA).

## Commands

```bash
npm ci
npm run dev      # http://localhost:3000
npm run build
npm run start
npm test
```

## Environment

Copy `.env.local.example` → `.env.local` and fill in Firebase + feature flags.

Netlify is **one site**, two builds:
- Production (`main`) → `https://railstatistics.co.uk` — see `netlify.env.live.example`
- Branch `beta` → `https://beta.railstatistics.co.uk` — see `netlify.env.beta.example`

Darwin origin and `NEXT_PUBLIC_BETA_SITE` are set per context in `netlify.toml`. Secrets go in the Netlify UI (All scopes).

Required for full functionality:

- `NEXT_PUBLIC_FIREBASE_*` — Auth, Firestore, Storage
- `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` — App Check (production)
- `DARWIN_API_KEY` (+ optional `DARWIN_API_ORIGIN`) — departures, units, services, API status
- `KB_STATIONS_API_KEY` (+ optional `KB_STATIONS_API_ORIGIN`) — GBNR station Knowledgebase tab (NRE Stations XML)

## Deploy

Netlify config at monorepo root (`netlify.toml`). Build base: `new-site/`. One site:

1. Production branch = live (`railstatistics.co.uk`).
2. Site configuration → Build & deploy → Continuous Deployment → **Branch deploys**:
   let Netlify deploy the `beta` branch (or “all branches”, then ignore unused ones).
3. Domain management → add `beta.railstatistics.co.uk` and set it as a **branch subdomain** for branch **`beta`** (not a production domain alias). If it is only an alias of the live site, `https://beta.railstatistics.co.uk` will serve production; `https://beta--railstatistics.netlify.app` is the real beta deploy.
4. Push `beta`; Netlify builds with `[context.beta.environment]` (api-dev + `NEXT_PUBLIC_BETA_SITE=true`).

Firebase rules/indexes: `firestore.rules`, `storage.rules`, `firestore.indexes.json` (deploy separately via Firebase CLI).

## Route map

Public: `/`, `/stations`, `/stations/map`, `/stations/:network/:slug`, `/migration`, `/departures`, `/units`, `/privacy`, `/eula`

Protected (`/admin/*`): stations admin list, stations CRUD, map editing, design system, messages, API status

Legacy URLs redirect via `next.config.ts` (e.g. `/stations/new` → `/admin/stations/new`).

PWA: `public/sw.js` registers in production. SEO: `/sitemap.xml`, `/robots.txt`, OpenGraph metadata.
