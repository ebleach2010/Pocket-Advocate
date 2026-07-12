# Setup — Phase 1

One-time wiring to take the Phase 1 code live. Everything here is config, not code.

## 1. Firebase project

1. Create a project at console.firebase.google.com (US region for Firestore/Storage).
2. **Auth** → enable the **Email link (passwordless)** sign-in provider. Add your
   domains (localhost:8787 and **thepocketadvocates.com**) to authorized domains.
2b. **Realtime Database** → create an instance (any US location); paste its URL
   into `databaseURL` in `public/js/firebase-config.js`. It powers Eric's
   online-status dot; its rules deploy with the command below.
3. **Firestore** → create the database, then deploy rules:
   `npx firebase deploy --only firestore:rules,storage:rules,database` (uses `firebase.json`).
4. **Web app** → register one, copy the config object into
   `public/js/firebase-config.js`.
5. **Service account** → Project settings → Service accounts → generate a key.
   Save as `service-account.json` locally (gitignored). This powers the Worker
   and the scripts below.

## 2. Worker config

- `wrangler.jsonc` vars: set `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_API_KEY`
  (the same apiKey as the web config), `PUBLIC_BASE_URL` (production origin),
  `ADMIN_EMAIL` (where Eric's chat nudges go), and `EMAIL_FROM` (a sender on
  your verified Resend domain).
- Secrets:
  ```
  wrangler secret put STRIPE_SECRET_KEY
  wrangler secret put STRIPE_WEBHOOK_SECRET
  wrangler secret put FIREBASE_SERVICE_ACCOUNT   # paste the JSON on one line
  wrangler secret put RESEND_API_KEY
  ```
- Local dev: copy `.dev.vars.example` → `.dev.vars`, fill in, then `npm run dev`.

## 3. Stripe

1. In the Stripe dashboard (start in test mode), grab the secret key.
2. Add a webhook endpoint: `https://thepocketadvocates.com/api/stripe/webhook`, subscribed to
   `checkout.session.completed`, `checkout.session.expired`,
   `customer.subscription.updated`, `customer.subscription.deleted`, and
   `invoice.payment_failed`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
3. No products need to be created — prices are defined inline ($100 case,
   $50 add-on, $20/mo subscription) in `worker/index.js`. Enable the
   **customer portal** (Settings → Billing → Customer portal) so subscribers
   can cancel themselves.
4. Local testing: `stripe listen --forward-to localhost:8787/api/stripe/webhook`.

## 4. Admin account

```
npm install
GOOGLE_APPLICATION_CREDENTIALS=service-account.json npm run set-admin -- pocketadvocate.eric@gmail.com
```

Then open **/admin-availability.html** signed in as that account to open booking
slots (the old `seed-slots` script still works but the editor replaces it).
Admin pages: `/admin.html` (case list + report-due counters),
`/admin-case.html?id=…` (files, join link, milestones, close),
`/admin-availability.html` (slots).

## 4b. Resend (email)

1. Sign up at resend.com, verify **thepocketadvocates.com** as the sending
   domain (Resend shows the DNS records; add them in the Cloudflare DNS panel —
   same account as the domain), and create an API key → `RESEND_API_KEY` secret.
2. `EMAIL_FROM` in `wrangler.jsonc` is already `no-reply@thepocketadvocates.com`.
3. Emails no-op gracefully until both exist, so this can wait — but the
   report-ready ping and chat nudges depend on it.

## 5. Deploy

`npm run deploy` — the Worker serves both the static app (from `public/`) and
the API. Then attach the domain: Cloudflare dashboard → Workers & Pages →
pocket-advocate → Settings → **Custom Domains** → add `thepocketadvocates.com`
(and `www.thepocketadvocates.com` if wanted). Since the domain is registered
in the same Cloudflare account, DNS and certificates are automatic.

## Notes / deliberate choices

- **Slot hold is 30 minutes, not the spec's ~15** — Stripe Checkout sessions
  cannot expire sooner than 30 minutes, and the hold must outlive the session
  so a paid checkout can never lose its slot. The `checkout.session.expired`
  webhook releases the hold the moment checkout is abandoned.
- **MST is fixed UTC-7 year-round** (Eric's decision, 2026-07-11) — implemented
  as the IANA zone `Etc/GMT+7`, which is UTC-7 (the sign is inverted by design).
  Bookable hours never shift with daylight saving.
- **Case creation is webhook-only.** The browser never writes to `cases` or
  `availability` (see `firestore.rules`); it only reads. The Worker's service
  account bypasses rules by design.
- **Waiver copy is signed off.** Eric waived a fresh lawyer pass (2026-07-12) —
  he has been through legal review for this business before and has safeguard
  documents plus the LLC in place.
