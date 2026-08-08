# AdSense implementation status

Last updated: 2026-08-08

Publisher: `ca-pub-6542256831244601`  
Live ads.txt: `https://railstatistics.co.uk/ads.txt` (matches publisher)

Env toggle: `NEXT_PUBLIC_ADSENSE_ENABLED=true` enables script + slots. Unset or any other value → off.

Local testing: `.env.local` currently has `NEXT_PUBLIC_ADSENSE_ENABLED=true` (restart `next dev` after changing).

Consent: Consent Mode v2 defaults run in root layout `<head>` (`consentModeDefaults.ts`). Banner UI comes from AdSense Privacy & messaging once published in the console (see below).

---

## Done

- [x] `public/ads.txt` committed and live
- [x] Config: publisher ID, banner / section / in-feed slot IDs, in-feed layout key (`adsenseConfig.ts`)
- [x] `AdSenseScript` — loads `adsbygoogle.js` from root layout
- [x] `AdSlot` — labelled TextCard wrapper, push + width guard, 72px height lock
- [x] Responsive rules: banner ≥1024px (header trailing); section ≤1023px only; in-feed full grid row
- [x] Public stations browse: header banner, section top, in-feed every N cards
- [x] Admin stations: ads gated off (`surface === 'public'` only)
- [x] Station details: header banner + section placements
- [x] Public map: desktop header overlay banner; admin map off
- [x] `PageTopHeader` `trailingContent` slot
- [x] Env-based on/off (`NEXT_PUBLIC_ADSENSE_ENABLED`)
- [x] Privacy policy updated for website AdSense (+ AdMob app section retained)
- [x] Ad units created in AdSense console (IDs in `adsenseConfig.ts`)
- [x] Consent Mode v2 defaults in `<head>` (UK/EEA/CH denied; elsewhere granted)
- [x] Privacy copy notes Google consent message for UK/EEA/CH

## Needs doing

### Ship

- [ ] Commit ads components + page wiring + privacy + consent defaults
- [ ] Deploy; set `NEXT_PUBLIC_ADSENSE_ENABLED=true` in Netlify (production)
- [ ] Confirm ads fill on production (not localhost)

### Google AdSense console

- [ ] Site `railstatistics.co.uk` approved (currently in review)
- [ ] ads.txt verified in AdSense
- [ ] Publish Privacy & messaging European regulations message (see checklist below)
- [ ] Monitor policy / invalid-traffic warnings after go-live

### Legal / consent

- [ ] Publish European regulations message + enable Consent Mode Advanced in AdSense (code is ready; banner will not appear until this is done)

### Product / polish (optional)

- [ ] Thin station-details section density (`ModalSection` adds a unit per subsection on ≤1023px)
- [ ] Map: tablet/mobile section ad (desktop banner only today)
- [ ] Ads on other public pages (home, departures, units, services) — decide later
- [ ] Gate `AdSenseScript` to public routes only (script currently loads app-wide when enabled)
- [ ] Local `.env.local` note: leave unset or `false` while developing

---

## AdSense Privacy & messaging — publish checklist

Code alone does not show a consent UI. Complete this in [AdSense](https://www.adsense.google.com):

1. Open **Privacy & messaging** → **European regulations** (GDPR).
2. Create a message for site `railstatistics.co.uk`.
3. Prefer **3-button** choices where offered: Consent / Do not consent / Manage options.
4. On the message settings, enable **Consent Mode** → choose **Advanced**.
5. **Publish** the message.
6. Verify on a UK/EEA IP (or VPN). Visitors outside UK/EEA/CH will not see the message; Consent Mode defaults grant ads/analytics storage for those regions.

Help: [About European regulations messages](https://support.google.com/adsense/answer/10961068)

---

## Slot reference

| Variant | Slot ID | Where |
|---------|---------|--------|
| `banner` | `1150960364` | Desktop `PageTopHeader` trailing / map overlay |
| `section` | `8717359110` | Tablet/mobile section tops / ends |
| `inFeed` | `7033842431` | Stations card grid (fluid; layout key `-fb+5y+3y-dx+b1`) |
