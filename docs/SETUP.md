# Setup — Phase 1

One-time wiring to take the Phase 1 code live. Everything here is config, not code.

## 1. Firebase project

1. Create a project at console.firebase.google.com (US region for Firestore/Storage).
2. **Auth** → enable the **Email link (passwordless)** sign-in provider. Add your
   domains (localhost:8787 and the production domain) to authorized domains.
3. **Firestore** → create the database, then deploy rules:
   `npx firebase deploy --only firestore:rules,storage:rules,database` (uses `firebase.json`).
4. **Web app** → register one, copy the config object into
   `public/js/firebase-config.js`.
5. **Service account** → Project settings → Service accounts → generate a key.
   Save as `service-account.json` locally (gitignored). This powers the Worker
   and the scripts below.

## 2. Worker config

- `wrangler.jsonc` vars: set `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`
  (the same apiKey as the web config), and `PUBLIC_BASE_URL` (production origin).
- Secrets:
  ```
  wrangler secret put STRIPE_SECRET_KEY
  wrangler secret put STRIPE_WEBHOOK_SECRET
  wrangler secret put FIREBASE_SERVICE_ACCOUNT   # paste the JSON on one line
  ```
- Local dev: copy `.dev.vars.example` → `.dev.vars`, fill in, then `npm run dev`.

## 3. Stripe

1. In the Stripe dashboard (start in test mode), grab the secret key.
2. Add a webhook endpoint: `https://<domain>/api/stripe/webhook`, subscribed to
   `checkout.session.completed` and `checkout.session.expired`. Copy the signing
   secret into `STRIPE_WEBHOOK_SECRET`.
3. No products need to be created — prices are defined inline ($100 case,
   $50 add-on) in `worker/index.js`.
4. Local testing: `stripe listen --forward-to localhost:8787/api/stripe/webhook`.

## 4. Seed data & admin

```
npm install
GOOGLE_APPLICATION_CREDENTIALS=service-account.json npm run set-admin -- eric@example.com
GOOGLE_APPLICATION_CREDENTIALS=service-account.json npm run seed-slots -- 2026-07-20 2026-08-15
```

The availability editor (Phase 2) replaces the seed script.

## 5. Deploy

`npm run deploy` — the Worker serves both the static app (from `public/`) and
the API. Point the domain's DNS at the Worker route.

## Notes / deliberate choices

- **Slot hold is 30 minutes, not the spec's ~15** — Stripe Checkout sessions
  cannot expire sooner than 30 minutes, and the hold must outlive the session
  so a paid checkout can never lose its slot. The `checkout.session.expired`
  webhook releases the hold the moment checkout is abandoned.
- **"MST" is implemented as America/Denver** (Mountain local time, DST-aware).
  If Eric truly wants fixed UTC-7 year-round, change `MOUNTAIN_TZ` in
  `worker/schedule.js` and the two client files.
- **Case creation is webhook-only.** The browser never writes to `cases` or
  `availability` (see `firestore.rules`); it only reads. The Worker's service
  account bypasses rules by design.
- **Waiver copy is draft.** Lawyer pass is the Phase 4 launch gate.
