# Pocket Advocate: handoff

For a new conversation picking this project up. Read this whole file, then
CLAUDE.md, before touching anything. Written 2026-10-15 at v7.42 by four
agents (one per section below) and assembled in one pass.

## 0. Start here

- **Clone:** `cd /tmp && git clone -q https://github.com/ebleach2010/Pocket-Advocate.git pa-scope && cd pa-scope && git checkout -q -B main-hotfix origin/main`. Push with `git push -u origin main-hotfix:main`. Cloudflare deploys main in 1 to 2 minutes.
- **Before any push:** `node tools/suites/run.mjs` all green, `node tools/blindness-audit.mjs http://127.0.0.1:9377` ALL CLEAR against `node_modules/.bin/wrangler dev --port 9377`, the browser drives for what you touched, VERSION and BUILD_TAG bumped, the added-lines dash scan at 0. Section 4 has the full checklist.
- **Talking to Eric:** short, plain, lead with what changed. He works from an iPhone, is not a developer, and his words land verbatim. Nothing reaches main without his say-so.
- **Recent releases**, newest first:
  - **v7.42** "Preview a case" on the home (a public sandbox case, wiped on Exit); the stats tab came off the home.
  - **v7.41** the admin menu over the case tabs; a + on Clients (Showcase, My own case, Schedule a case from a lead, Family case); invitations a lead confirms and pays for; Delete on his own cases; folder cards that glow by state.
  - **v7.40** the Advocacy Case report is due in 14 days (was 7); the stats tab (now removed).
  - **v7.39** Advocacy Case $2,100; every price set in Settings, Prices.
  - **v7.38** the chat page in his words, a clear cancel, chat search, one black look everywhere, a tightening pass.
- **Commit trailer:** `Co-Authored-By: Claude <noreply@anthropic.com>`, with no model name (CLAUDE.md). The v7.40 and v7.41 commits carry a model name in that line by mistake; history is not rewritten.

## 1. Purpose, the business and the person

### What Pocket Advocate is

Pocket Advocate is a paid patient advocacy service for people with complicated medical cases, mostly neurological, in the **United States and Canada**. It is advocacy, not medical care: no diagnosis, no treatment, no prescriptions, no doctor-patient relationship and no emergency service ("call 911"). This disclaimer carries legal weight and appears in every footer, in the waivers and on every report. The service is not a HIPAA covered entity. Eric receives records as the client's own authorised recipient.

- Live site: **https://thepocketadvocates.com** (a web app that clients can add to their Home Screen).
- The business operates under **Rooted Therapeutics LLC (Idaho)**. The repo never names it and only says "the LLC" (SPEC.md, docs/SETUP.md).
- Eric also runs the TheBroScientist YouTube channel (@the_broscientist), where he talks through cases. The site links to it.

### The three services

The live prices are stored in Firestore (`config/rates`) and served by `/api/rates`. The seeds are in `worker/index.js`. Since v7.39, Eric sets every price himself under **Settings > Prices**. Pages never type a price into markup: `public/js/rates.js` fills the `[data-rate]` spans. The code also has a silent price ratchet, and no client-served file may ever describe it.

1. **Advocacy Case, $2,100 one time.** A recorded call of about an hour (phone or video), Eric's review of every record the client shares (5 to 6 hours of work), and a **written report within 14 days** of the call. The deadline was 7 days until 2026-10-15, and older cases keep 7. Booking goes through `/book.html`. Stripe **authorizes the card and captures nothing** (`worker/charge.js`), and the case stays "held" until Eric decides:
   - If he approves, he captures any amount up to the hold. $0 comps the case.
   - If he declines, the hold is released and the case closes with his reason.
   - Holds last 7 days. After that, approving sends the client a payment link instead.
   - Optional extras: a $325 follow-up session (used within 30 days) and Telehealth Appointment Advocacy at $525 per visit.
   - A case he schedules from a lead (v7.41) is different: the lead confirms on the booking page and pays his price at once, by card; 0 is free.
2. **Full-Service Case Management, $4,400/month, 20 included hours.** Everything in a case, and then Eric works inside it:
   - He calls clinics and insurers, chases records and writes insurance appeals. Appeals are deliberately uncounted.
   - Telehealth advocacy is included.
   - Check-ins happen at least twice a month. This is a 14-day flag on his dashboard, not an automation.
   - Extra hours cost $175 to $225 an hour, agreed in advance.
   - It is billed a month at a time. Clients request it from inside an open case, asking is free, and Eric answers yes or no.
   - A cap on how many can be open at once (default 2, set in his settings) protects his capacity.
3. **24/7 Priority Chat, $50/month.** A private chat line with uploads. At least one message gets a guaranteed same-day reply. It offers priority, not in-depth case work. Clients cancel anytime through Stripe, and their history stays.

### What is open right now (v7.42, 2026-10-15)

- `public/js/sales.js`: **`SALES_OPEN = false`** (Eric, 2026-10-12: "Stop sales everywhere."). The Worker refuses every route in `SALES_ROUTES`. The case and full-service cards are greyed out with "Not currently offering", and their pages offer the waitlist. Invitations he sends from the Clients + are not sales routes, so they work while sales are closed.
- **`CHAT_OPEN = true`** (2026-10-14: "Unlock priority chat"). The chat is the ringed option at the top of the home page.
- His out-of-remission banner came down on 2026-10-14. The free 15-minute call was removed on 2026-10-12 and stays gone.
- When Eric sends **`/open`**, follow CLAUDE.md exactly. The waitlist button stays.

### Front doors and leads

- **Join the waitlist** (bubble, top right of the home page): name, email, phone and package. Eric gets a push and an email, and the entry appears on his Clients page.
- **Question box** (chat icon, bottom right): "I'll get back to you within two days." Questions are emailed to Eric, and his reply goes straight to the person who asked.
- **Leads tab**: everyone who has given their details by any route, one row each, with a CSV download. The Clients + can schedule a case for any of them.
- **Preview a case** (bubble, top left): `/case.html?preview=1` opens an invented case (Joe Bloe) in the visitor's own tab. It is wiped on Exit. Never call it a "showcase" to clients.
- **Reviews: 5.0 on Google** (5 reviews). Every request for a review links to `https://g.page/r/CUKWU6xlposHEAE/review`. The weekly automatic pull needs a Places API key that does not exist, so do not claim it works.
- **By the numbers** (`/stats.html`, linked from the footer): median reply time, the share of messages answered within an hour, reports delivered on time and hours logged. It shows totals and medians only, updated daily.

### Eric, the person

**Eric Bleach** owns the business and is currently its only advocate. He is a professional patient advocate with five years of experience, a former ophthalmology surgical coordinator and personal trainer, and he survived autoimmune encephalitis after a three-year illness.

He is disabled: he has post-exertional crashes, autoimmune encephalitis relapses and periods of cognitive impairment. He is **currently out of remission and in chemotherapy**, and he has given instructions from a hospital bed in the middle of a relapse. His closed-sales notice read: "Services will be available again once I can cognitively perform to the standard necessary for advocacy."

How to work with him:

- **He is not a developer.** He works from an iPhone with no terminal and no clone. Never ask him to run commands or paste secrets.
- **He is terse and hates walls of text.** Replies must be short and plain, and must lead with what changed (plus the URL and version or build tag).
- **His exact words are law.** Copy he gives lands word for word. The codebase records each decision as `Eric, YYYY-MM-DD: "..."`.
- **Prices change only on his explicit word.**
- **Nothing goes to main until he says so.**
- **"Stop" means stop.** Do nothing more until he says to continue.

### Where it is heading

The plan is to hire **independent contract advocates** in the US and Canada, with subspecialties (cardiology, autoimmune, neurology, oncology, undiagnosed cases), with at least 2 years in a healthcare setting. Each would **set their own prices** for the three services and run their practice on this software under the Pocket Advocate brand and its reputation. A job listing was drafted on 2026-10-15.

The software is not built for that yet. It has one admin account (`ADMIN_UID`), all client copy is in Eric's first-person voice ("I", never "Eric"), and there is a single rates document. Nothing in the repo yet supports more than one advocate.

## 2. Architecture and code map

### Stack at a glance

- **One Cloudflare Worker** is the only server code. `wrangler.jsonc` sets `main: worker/index.js`, serves `public/` through the `ASSETS` binding and sets `run_worker_first: true`, so every request passes the Worker's gates before it reaches a static file. A cron runs every minute. There is no build step: what is in `public/` ships byte for byte, and that includes the comments.
- **Firebase** (`pocket-advocate-f3148`) provides Firestore, Storage and Auth.
  - Browsers use the Firebase JS SDK 10.12.5 from gstatic.
  - The Worker uses REST with the service account. It does not use the admin SDK.
  - The Realtime Database is locked shut (`database.rules.json`) and unused.
- **Stripe, Resend email and native Web Push (VAPID)** are all called from the Worker with plain `fetch`.
- **Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `FIREBASE_SERVICE_ACCOUNT`, `RESEND_API_KEY`, `ADMIN_PIN`, `VAPID_PRIVATE_JWK` and the private reading's API key. Plain vars such as `ADMIN_UID`, `ADMIN_EMAIL` and `PUBLIC_BASE_URL` are in `wrangler.jsonc`.

### worker/ modules

| File | Role |
|---|---|
| `index.js` (about 11.5k lines) | Router (`fetch`), nearly every handler, asset gates, `scheduled()`, `BUILD_TAG` and `VERSION` |
| `firestore.js` | Firestore REST client: `getDoc`, `patchDoc` (with `mask`, `mustNotExist`, `ifUpdateTime`), `queryDocs`, `listDocs`, batch create and delete. Reads retry on 429 |
| `google-auth.js` | Service-account OAuth token (WebCrypto, cached per isolate) and `mintCustomToken` |
| `firebase-auth.js` | `requireUser`: checks the browser's ID token through Identity Toolkit |
| `storage.js` | Storage with the service account: list, fetch, put, delete, metadata. Holds `BUCKET` |
| `stripe.js` | `stripePost`, `stripeGet`, webhook signature check |
| `charge.js` | Card holds: the held charge record and the decision table (captured, comped, declined, lapsed, invoiced). Capture and cancel calls. `HOLD_DAYS = 7` |
| `schedule.js` | Booking rules: 72h lead time, 252h horizon, 8am to 7pm fixed MST (`Etc/GMT+7`), office hours |
| `email.js` | Resend sender. Bodies carry no health content. Includes the sign-in code email |
| `push.js` and `webpush.js` | `notifyUser` sends to `users/{uid}.pushSubs`. `webpush.js` does the RFC 8291/8292 encryption and signing |
| `showcase.js` | Builds and wipes the Joe Bloe showcase case (`showcase: true`) from the shared story in `public/js/preview/joe.js` |
| `fund.js` | Everything under `/api/fund/*` and `/api/admin/fund/*`, plus `drainFundNotices` |
| `advisor.js`, `advisor-acts.js` | The private case-reading module (admin only, see below) |

### Routing (worker/index.js)

- **Where the truth is.** The comment at the top of the file lists routes but is incomplete. The `if` chain inside `fetch()` is the real list.
- **Gates that run first:**
  - A maintenance gate on `/api/checkout`.
  - `SALES_ROUTES` answer 409 while `SALES_OPEN` is false.
  - `/api/subscribe` follows `CHAT_OPEN`. Today it is true.
  - Both switches are in `public/js/sales.js`, and the Worker imports them from there. Preview and localhost hosts skip these gates.
  - `PAUSE_GATED` refuses client writes on a paused case.
- **Admin routes answer 404 to non-admins.** An unknown `/api/` path also does a token check before its 404, so response timing cannot reveal which gated routes exist.

| Area | Routes |
|---|---|
| Booking and payment | `/api/checkout` (card held, not charged), `/api/case-for-session`, `/api/subscribe`, `/api/portal`, `/api/stripe/webhook`, `/api/upgrade`, `/api/followup`, `/api/extend`, `/api/telehealth`, `/api/chat-unlock`, `/api/admin/case-charge` (approve at any amount including zero, or decline), `/api/admin/full-request`, `/api/admin/schedule`, `/api/admin/slots`, `/api/availability` |
| Sign-in | `/api/auth/request-code`, `/api/auth/verify-code`, `/api/auth/device-signin`, `/api/admin/login`, `/api/admin/pin`, `/api/admin/session` |
| Cases and chat | `/api/notify`, `/api/chat/react`, `/api/chat/edit`, `/api/chat/pass`, `/api/agenda`, `/api/authority`, `/api/case-log`, `/api/milestones`, `/api/clinic-calls`, `/api/saved`, `/api/uploaded`, `/api/file/*`, `/api/work` |
| Admin | `/api/admin/case-update`, `client-alert`, `close-case`, `hold`, `self-case`, `family-case`, `showcase-case`, `delete-case`, `booking-closure`, `office-hours`, `ledger`, `personal` |
| Invitations (case scheduled from a lead) | `/api/admin/lead-invite`, `/api/admin/lead-invites`, `/api/admin/lead-invite/cancel`, then the client calls `/api/invite` and `/api/invite/confirm` |
| Rates, stats, reviews | `GET /api/rates`, `POST /api/admin/rates`, `GET /api/stats`, `POST /api/admin/stats`, `/api/review`, `/api/reviews`, `/api/reviews/admin` |
| Waitlist and leads | `/api/waitlist`, `/api/admin/waitlist`, `/api/question`, `/api/admin/leads`, `/api/admin/fit-calls`. `/api/fit-call` is retired and answers 410 |
| Fund | `/api/fund/*`, `/api/admin/fund/*`. `FUND_OPEN` (in `public/js/fund-rules.js`) is false |
| Ops | `/api/version`, `/api/changelog`, `/api/diag` (needs a key) |

**Webhook.** `checkout.session.completed` calls `createCaseFromSession`. It will not create the same case twice: it checks `stripe.sessionId`, and creation fails if the document already exists (`mustNotExist`). A paid invitation creates its case under the invitation's own id, so one invitation is one case. The webhook also handles subscription updated and deleted, `invoice.payment_failed`, and expired or canceled sessions and intents.

### Static asset gates

- **`ADMIN_ASSET`** covers `/admin*.html`, `/js/admin*.js`, `js/advisor`, `notes`, `duty`, `prep`, `drawer`, `seen` and `panel-bridge` (`.js`), and `css/admin.css`. These need the `pa_adm` HMAC cookie. It lasts 14 days, is minted at admin login and is renewed whenever an admin page is served. Without it the visitor gets a real, byte-identical asset-server 404, matched on `canonicalPath()`. **Any new admin-only file must be named `admin-*.js` or added to this regex in the same commit.**
- **`DEMO_ASSET`** (`/js/demo/`) is served only on `DEMO_HOST` hosts (versioned `<hash>-pocket-advocate.<sub>.workers.dev` previews and localhost) after `?demo=1` or `?demo=admin` sets the `pa_demo` cookie. It is never served in production.

### Auth

- **Clients** sign in on `signin.html`, or through `inline-auth.js` inside the book and subscribe pages:
  1. `request-code` emails a 6-digit code (stored in `authCodes/`, valid 10 minutes).
  2. `verify-code` returns a custom token, and the browser calls `signInWithCustomToken`.
  3. A trusted-device token (`trustedDevices/{sha256}`) skips the code on later visits.
- **Admin** signs in with email plus password, or with the PIN. Either way he gets a custom token, a device token and the asset cookie. Rules check `users/{uid}.role == 'admin'`.

### public/ pages and shared modules

- **Client pages:** `index.html` (landing, waitlist, question box, "Preview a case"); package pages through `package-page.js`; `book.html` with `book.js` (also the invitation page on `?invite=`), and `return.html`; `case.html` with `case.js` (progress, chat, documents, built on `folder.js`); `chat.html` with `chat-page.js`; `subscribe.html` and `subscription.html` (Priority Chat); `stats.html`, `reviews.html`, `signin.html`.
- **Admin pages:** `admin.html` with `admin.js` (the shelf of folder cards from `drawer.js`, the +, the waitlist, free calls, `admin-invites.js` and `admin-personal.js`); `admin-case.html` with `admin-case.js` (flip pages for Overview, Chat, the private reading pages, Files, Notes and Drafts); `admin-chats`, `admin-calendar`, `admin-availability`, `admin-leads`, `admin-dictionary`, `admin-fund`. Every admin page loads `admin-presence.js`.
- **Shared modules:** `chat.js` runs chat for both sides and loads `panel-bridge.js` only on admin pages; `auth.js` (sign-in state, `requireUser`, `requireAdmin`, nav); `firebase.js`, `firebase-real.js`, `firebase-config.js`; `changelog.js` (the release card, whose `VERSION` must match the Worker's); `sheet.js` (the in-app `ask()` sheet that replaces `prompt` and `confirm`); `rates.js`, `office.js`, `textpdf.js` (the Worker also uses it), `settings.js` (client) and `admin-settings.js` (gated).
- **CSS:** `site.css` (base, every page), `glowup.css` (design tokens), `look.css` (the black and cyan look, loaded last), `landing.css` (home and package pages), `admin.css` (gated).

### Three alternate data layers (public/js/firebase.js)

All three export the same API, so pages run unchanged on any of them.

| Layer | When | Files |
|---|---|---|
| Real Firebase | Default | `firebase-real.js` |
| Demo | `?demo=`, never on thepocketadvocates.com (the Worker and `firebase.js` each refuse it) | `public/js/demo/` (store, seed, api, banner, suite, fund) |
| Preview sandbox | `/case.html?preview=1` from "Preview a case". Works on any host, production included, but never on `/admin` paths | `public/js/preview/` |

- **How the preview works:** `store.js` keeps an in-memory store in `sessionStorage` (`pa-preview-store`). `api.js` replaces `fetch` inside the tab: public reads (rates, reviews, version, stats) go through to the real server, purchases get a 409, `/api/admin*` gets a 404, and everything else is answered locally. `bar.js` draws the Exit strip; Exit calls `wipePreview()`, and arriving on the home clears it too.
- **Joe Bloe's story lives only in `public/js/preview/joe.js`.** `preview/seed.js` builds it into the visitor's tab, and `worker/showcase.js` imports the same module to build the admin showcase. Anything new a client can see gets added to `joe.js` and to `SHOWCASE_COVERS`. That file is public, so it must never name a private tool.

### Private case-reading tools (admin only)

- **Server:** `worker/advisor.js` handles reads, questions, drafts, the queue drain and the dictionary. `worker/advisor-acts.js` is the allowlist: the reading can propose an action but never runs one. Routes: `/api/advisor`, `/api/advisor/state`, `/api/advisor/covers`, `/api/advisor/dictionary`, `/api/chat/reply`, `/api/summary`, `/api/admin/voice`.
- **Browser:** `public/js/advisor.js`, `panel-bridge.js`, `prep.js`, `duty.js`, `notes.js`, `drawer.js`, `seen.js`, `admin-dictionary.js`, `css/admin.css`.
- **Data:** `cases/{id}/advisor/**`, `advisorQueue`, `advisorKnowledge`, `advisorStyle`, `caseMeta`.
- **Clients must never see this or be able to infer it exists.** That covers client-served JS, CSS and HTML, emails and `joe.js`. `tools/blindness-audit.mjs` fetches the real URLs anonymously to prove it. Nothing starts a reading on its own: every reading begins with Eric's tap.

### Data model highlights

- **`users/{uid}`:** `role`, name, dob, email, `pushSubs`.
- **`cases/{id}`:** client details (`clientUid`, `clientEmail`, `clientName`, `clientPhone`, `clientAddress`, `clientTz`); `status` (from `forms` or `confirmed` through to `closed`); `appointment {start, durationMin, method, joinLink, requested}` and `forms` (acknowledgement times); pricing (`caseRateCents`, `addonRateCents`, `fullAccess`, `fullAccessRateCents`); payment (`stripe {sessionId, paymentIntentId, amountTotal}` and `charge {state, authorizedCents, capturedCents, expiresAt}`); `invite {id, priceCents}`; `hold {pausedAt, totalMs}` for a paused case; `work` for the work clock; `checkIns`, `telehealthVisits`; flags `self` (Eric's own case), `showcase`, `family`. `lastMessage` is the only field a browser may write.
- **Under each case:** `chat/{msgId}` (`{from, role, text, ts, attachment}`; the browser creates messages under the rules and they cannot be changed afterwards; reactions, edits and passes go through the Worker); `agenda/` (next-call items); `private/**` (notes, `milestones/items`, `clinicCalls/items`, `authority/items`; only the Worker can read or write these, and clients see filtered views through `/api/case-log` and `/api/authority`).
- **`subscriptions/{uid}`:** Priority Chat, with `currentPeriodEnd` and its own `chat/`.
- **`invites/{id}`:** `{email, name, start, priceCents, state: sent|confirmed|canceled, by, caseId}`. The case takes the invite's id. A free invite opens the case at once. A paid one goes through Stripe and is charged immediately, not held.
- **`config/rates`:** `caseCents`, `addonCents`, `subCents`, `fullCents`, `floorCents`, `bookings`, `pricingEpoch`. If the stored epoch is older than the one in `index.js`, the seed prices are used instead. `settings/` is world-readable and holds public text only. Everything else under `config/` belongs to the Worker.
- **`stats/public`:** computed by the cron and served by `/api/stats` with an hour's cache.
- **Storage:** clients can read `cases/{id}/{report,recording,uploads,chat-files}`. Everything else under a case is admin only. Only the Worker can reach `personal/` and `fund/`.

### Cron (`scheduled()`)

- **Every minute:** a heartbeat to `diag/cron`; one queued private reading (the cron waits for it); work-clock nudges and fund notices.
- **Every 15 minutes:** chat email digests, follow-up and appeal warnings; stale slot cleanup and public stats; the hold sweep (a reminder two days before a 7-day card hold lapses); run-once migrations; re-queueing any reading that got stuck.
- **Watchdog:** ordinary API traffic runs a check that stands in for the cron if it goes quiet.

### Deploy and checks

- Pushing `main-hotfix` to `origin main` deploys through Workers Builds in 1 to 2 minutes. Other branches get preview hostnames. `.github/workflows/deploy.yml` is only a manual fallback.
- Every push to `main` bumps `VERSION` in `worker/index.js` and `public/js/changelog.js` together, with a new `BUILD_TAG`.
- Confirm a deploy by polling `https://thepocketadvocates.com/api/version` until `tag` matches the new `BUILD_TAG`. The response also shows `cronLastFiredAt`.
- The diag URL is in the session notes, not here.
- Checks live in `tools/suites/`, `tools/drives/`, `tools/sweeps/` and `tools/blindness-audit.mjs`.

## 3. Design system and copy rules

### The look

There is one look, black, on every page. Eric, 2026-10-15: "Remember, everywhere should have this same aesthetic including the chat box, the files, everything." Every page paints on the Night scheme (`data-scheme="calm"`, labelled "Standard" in `public/js/theme.js`), and `public/css/look.css` turns it black. The only other choice is High contrast. Every look rule is scoped `:root:not([data-scheme="contrast"])` so it never touches that scheme. Write new rules the same way.

**Load order.**
- Client pages load `site.css?v=sp16`, then `glowup.css?v=sp9`, then `look.css?v=7`.
- Admin pages load `site.css`, then `admin.css?v=stat133`, then `look.css`.
- The home (`index.html`) and the three package pages also load `landing.css?v=b9` after look.css. It carries the same token set, and `tools/suites/packages.mjs` keeps the two identical.
- The hidden `fund.html` is the only page that skips look.css.
- `opencases.mjs` pins this order.

**Version stamps.** When a stylesheet changes, bump its `?v=` stamp in every HTML file that links it. Several suites pin the stamps (`waitlist.mjs`, `packages.mjs`, `landing.mjs`, `charge.mjs` CH7, `opencases.mjs`). Re-pin them in the same commit with a dated note. site.css uses the `spNN` series and admin.css the `statNN` series.

| Token | Value | Use |
|---|---|---|
| `--bg` | `#0A0A0C` | page ground, with faint cyan and violet light |
| `--sur-base`, `--sur-lit` | `#131317`, `#1B1B21` | cards, raised rows |
| `--ink`, `--soft`, `--dim` | `#F5F5F7`, `#D2D2D9`, `#9C9CA8` | text |
| `--cyan` | `#3DDCF5` | the pop, focus ring, primary button (ink `#02161A`) |
| `--magenta` | `#B9A6FF` | violet end |
| the gradient | `110deg, #3DDCF5 0%, #9BEBFA 48%, #B9A6FF 100%` | bubbles, rings, prices, progress, search hits |
| open rim | `135deg, #3DDCF5` to `#B57BFF` | open folders, the + button |
| paused rim | `#F6D77A` to `#E9B949` | paused folders only |
| `--gold` | `#F2C14E` | demo strip, free-call marker |
| `--green` | `#4FD69C` | running work clock |
| `--self` | `#C4A6FF` (Night value) | his own case, family flag, questions in his chat |
| `--danger` | `#FF7A7A` | delete, failures |

**Type.** Sora at 600 weight, letter-spacing `-.02em`, for h1 to h4, the wordmark and prices. Manrope for body text at 500, and 600 to 700 for anything pressed or labelled. Both fonts are self-hosted in `/fonts/`.

**Components**
- **Buttons** are pills (`border-radius: 999px`). A disabled button has a dashed edge and dim ink, so it reads as "not yet" rather than missing.
- **Waitlist bubble** (`.wl-bubble`, `landing.css`): the gradient with a cyan glow; a white sheen that crosses it every 3.6s; a twinkling ✦; a 12px tail at the bottom right (radius `20px 20px 4px 20px`).
- **"Preview a case"** (`.wl-bubble.pv-bubble`) is its twin. Its tail is on the left in `#3DDCF5`, and it links to `/case.html?preview=1`. Preview sits top left and the waitlist top right, both in `.hero-top`, with the eyebrow line under both. Inside the preview, `.pv-exit` (in `public/js/preview/bar.js`) is the same bubble saying Exit, in a strip of its own that the header docks under.
- **Chat card ring** (`.opt-gold`): now the cyan to violet gradient with a white spot circling it every 3.6s (Eric asked for "the same gradient and effect as the waitlist button"). The class name and a comment in `index.html` still say gold.
- **Question bubble** (`.ask-fab`): a 54px round gradient button at the bottom right of the home. It opens a sheet shaped like the waitlist sheet.
- **Folder cards** on the admin Clients shelf: the manila geometry is in `site.css` `.folder` (a 3px back-cover rim, a clip-path tab stepped at 0, 12% and 24%, two peeking sheets); look.css retints it for black. The state rims are in `admin.css` (Eric, 2026-10-15: "open ones should be highlighted in that ease in ease out blue/purple. Paused will be the same sort of aesthetic only yellow"): `.st-open` breathes cyan to violet on a 3s cycle, `.st-paused` breathes gold, closed folders are left alone. A running work clock (`.working`, green outline) and his own case (`.self`, purple) keep their own light.
- **Sheets**: `public/js/sheet.js` exports `ask({ title, body, okLabel, cancelLabel, danger, input })`. Never use `confirm()` or `prompt()`; `prompt()` does nothing inside a Home Screen app. Some bare `confirm()` calls survive in admin modules, mostly `admin-case.js`.
- **One-screen home**: the hero and the three options only. Lines drop out, or the headline takes two lines, under max-height media queries so a phone never scrolls. Every other section opens as a `:target` overlay from the hamburger menu; `landing-tabs.js` adds the Back links.

**Accessibility floors**
- **Motion.** Every animation sits under `prefers-reduced-motion: no-preference` or is cancelled under `reduce`. Admin pages do not load glowup.css's global kill switch, so admin animations need their own guard.
- **Touch targets** are at least 44px (Eric, 2026-08-27). Primary buttons are 48px.
- **Width.** Every page fits 320px with no sideways scroll (html and body clip sideways overflow, so measure elements, not the page). The drives walk pages at 390px and 320px.
- **Focus** is a 2px cyan outline.

### Copy rules

- **Eric's words land word for word.** Suites pin his sentences. The chat package page is his letter, unedited.
- **First person as Eric** on client pages: "I'll get back to you soon", "Three ways to work with me". Client copy never talks about him in the third person.
- **Plain, short sentences.** A changelog entry says what changed and where to find it. Client notes never describe admin machinery.
- **No em or en dash anywhere a person reads.** Use a comma, a period, a colon, or "to" for ranges. `tighten.mjs` V3 scans every `public/js` module and every public HTML page (comments stripped; frozen `waivers.js` exempt). `defects.mjs` section 15 scans visible page text. In any diff, the added-lines dash scan must be 0, comments included.
- **"Patient advocacy, not medical care."** Copy never offers diagnosis, a treatment plan or medical advice.
- **Client blindness.** Bytes served to clients must contain no blindness term, comments included: every client page and every module it imports; `site.css` and `look.css`; `changelog.js` and `auth.js`, which every page loads; everything under `public/js/preview/`, which is public. The canonical list is `HARD` in `tools/blindness-audit.mjs` (advisor, differential, working diagnos, dxOverride, workingDx, AI, artificial intelligence, LLM, language model, chatbot, system prompt, machine generated, auto generated, "the model", "a model", "from a model", and the vendor's company, product and model family names spelled out in the file). In `.js` and `.css` the audit also forbids the internal identifiers in `CODE_ONLY`. `preview.mjs`, `fund.mjs` and `release.mjs` add one more model family name; treat it as part of the list. One allowance: the AI note-taking clause in `service-terms.js`, counted per occurrence.
- **How the audit runs:** `node tools/blindness-audit.mjs [origin]` against a running Worker. It confirms the server is serving this tree, crawls as an anonymous visitor through `src`, `href`, `import` and `import()` and scans every byte, checks admin pages and assets 404 to a stranger, and checks `chat.js` renders no recap. Gated admin files may contain internal words.

### Where decisions are recorded

- **`CLAUDE.md`** holds the standing rules, each with Eric's words and the date.
- **`docs/SUITES.md`** records each release: his words and what each suite pins.
- **Comments** quote him at the rule his words caused: `(Eric, 2026-10-15: "his exact words")`. Suites add `RE-PINNED <date> (vX.YY)` and `NEGATIVE CONTROL` notes. In served files, quote only words that pass the blindness list, and never put internal deliberation in a served file's comments.
- **`changelog.js`** holds his versioning rule. `tools/copy-deck.mjs` builds the copy deck he edits from.

## 4. How work is done here

### 4.1 The working setup

- **Clone:** `/tmp/pa-scope`, on branch `main-hotfix`, tracking `origin/main`. Push with `git push -u origin main-hotfix:main`. If missing: `cd /tmp && git clone -q https://github.com/ebleach2010/Pocket-Advocate.git pa-scope && cd pa-scope && git checkout -q -B main-hotfix origin/main`.
- **Pushes to main don't use PRs.** PR #57 and PR #58 stay parked and are merged only when Eric says so.
- **Nothing reaches main until Eric says so.** If he hasn't said, ask or hold.
- **Push modes:** "push as full update" is a loud release; "push as silent update" is quiet; a plain "push to main" is treated as silent.
- **Major changes need a preview first** (anything a client touches or signs, any new pipeline or flow). The demo runs only on preview hosts and localhost.
- **Several agents:** every brief lists the other agents; they reconcile before reporting; "Run agents for X" means four agents unless Eric gives a number.

### 4.2 Versioning and commits

- [ ] Bump `VERSION` in `public/js/changelog.js` AND in `worker/index.js` (both `'7.42'` today).
- [ ] Set a new `BUILD_TAG` in `worker/index.js` (today `'v2026-10-15-preview'`, pattern `v<date>-<slug>`).
- [ ] Add a CHANGELOG entry at the top: a capitalised title comment quoting Eric; `quiet: true`, `client: []`, `admin: [...]` in his words; no dashes and no blindness word.
- [ ] Re-pin `tools/suites/release.mjs` R1 to the new version and tag, with a dated RE-PINNED note and a fresh NEGATIVE CONTROL. R1 also requires every entry from 4.6 on to be quiet with an empty client list; a loud release needs R1 changed, only on Eric's word.
- [ ] Bump stylesheet `?v=` stamps for any CSS change and re-pin the suites that pin them.
- **Commit identity:** authored `Claude <noreply@anthropic.com>` (git config already does this; never pass `--author`). Trailer `Co-Authored-By: Claude <noreply@anthropic.com>` with no model name; a `Claude-Session:` link line is fine. No model identifier in commits, PR bodies, code or comments.
- **House style:** subject `vX.YY: <plain summary>`; body of Eric's quotes each followed by bullets; then the new suites, drives and re-pins; end with "Quiet release."

### 4.3 Iron rules (CLAUDE.md, never relaxed)

- **Clients are blind to the admin side.** Admin pages 404 to strangers, byte for byte. No admin information or deliberation in served files, comments included.
- **AI is never mentioned on a client surface**, except the one note-taking consent clause in `service-terms.js`.
- **No dashes** in copy, changelog entries or advisor output.
- **`public/js/waivers.js` is frozen.** It keeps the reschedule-refund clause until Eric decides.
- **Prices change only on Eric's explicit word.** The +$10 booking ratchet is silent and its description stays out of client-served files.
- **No automatic token spend.** Nothing reads a case except his tap.
- **Demo and test suites run on preview hosts only.**
- **The app signs nothing on his side.** `OFFER_AUTHORITY_SIGNING` stays false; paperwork is recorded by his "Forms submitted" tick.
- **The showcase rule** (2026-10-15): every client-visible feature joins Joe Bloe in the same push. His story lives once in `public/js/preview/joe.js` and feeds `buildShowcase` (`worker/showcase.js`), the public preview (`public/js/preview/seed.js`) and the demo (`public/js/demo/api.js`). Add the feature to `SHOWCASE_COVERS` (12 entries today); `opencases.mjs` and `preview.mjs` check it. Nothing under `public/js/preview/` may carry a blindness word. The showcase is never named to a client.

### 4.4 Tests

- **The battery:** `node tools/suites/run.mjs`. All 46 suites green; one red line blocks the push. A suite counts as red if any line starts with FAIL or its "N/M passed" summary disagrees. If a suite fails because the design changed on Eric's word, re-pin it in the same commit; never delete a check.
- **The blindness audit:** `node tools/blindness-audit.mjs http://127.0.0.1:<port>` must end with **ALL CLEAR**.
- **Browser drives** (`tools/drives/*.mjs`, Playwright): local worker `node_modules/.bin/wrangler dev --port 9377` (stop an old one first with `pkill -f "wrangler dev"`); run `PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-<name>.mjs` (always set PA_PORT); chromium at `/opt/pw-browsers/chromium`; the demo cookie `pa_demo` on `127.0.0.1` (`1` for the client demo, `admin` for Eric's side). `drive-preview.mjs` runs on the real build with no demo. Drive every surface you changed.
- **Negative controls and re-pins:** every NEW check gets a recorded control directly above it:
  ```
  // NEGATIVE CONTROL (run YYYY-MM-DD): <the mutation> made this read
  //   FAIL  <exact check name>
  ```
  A broken pin is re-pinned, never deleted: `// RE-PINNED YYYY-MM-DD (vX.YY): Eric, "<his words>". <what moved>` plus a fresh control. A retired check is kept as `false && check('X (retired YYYY-MM-DD) ...')`. A control that makes a drive crash instead of printing FAIL is not a control: read state before the next tap so the check prints.
- **Known drive failures, already there before the v7.38 to v7.42 work. Leave them alone:** act, calldoc, fit, forms, hours, openfull, worklog, and section F (notes) of seamless. nudge fails intermittently.

### 4.5 Deploy check

- [ ] Poll `https://thepocketadvocates.com/api/version` until `tag` equals the new `BUILD_TAG`.
- [ ] Take several hits; a rolling deploy can still answer with the old tag.
- The sandbox cannot reach production in a browser, so screenshot the local server instead.

### 4.6 Platform limits

- **Eric cannot deploy Firestore or Storage rules himself.** Route new reads through the Worker rather than relying on a rules change.
- **Google reviews:** the weekly pull needs a Places API key the Worker does not have. The review link works; don't promise the pull.

### 4.7 Open items waiting on Eric

- [ ] **24/7 Priority Chat: $45 or $50?** His letter on `priority-chat.html` says $45; the seed is 5000. He can set it in Settings, Prices.
- [ ] **"update terms":** `waivers.js` still says "$50 per month" and "Response timing is never guaranteed", which conflicts with the same-day guarantee on the chat page. Frozen until he decides.
- [ ] **Automatic price raises after bookings are still on** (`raiseRates`). He can say "stop raises".
- [ ] **The footer version note shows an old version**, because every entry since 4.6 has an empty client list.
- [ ] **The hiring plan for contract advocates** (a listing was drafted 2026-10-15; the software is still single-advocate).
- [ ] **The reschedule-refund clause in `waivers.js`** (his answers conflicted, 2026-08-25).
- [ ] **When he sends `/open`:** restore the home's "How it works" screen and About's "How a case runs" section from the v7.37 history; keep the waitlist; do not bring back the free call.

**Open flags from CLAUDE.md:** `tier-terms.js` has had no legal review and is pending his sign-off. Never contradict "not a HIPAA covered entity" or "advocacy only". Every number in the agreement must drive a real limit; appeals stay uncounted (`defects.mjs` and `pricing.mjs` T9d pin that). Refunds are by agreement only; never add automatic refund triggers. "Every two weeks" is a dashboard flag, not an automation. Re-check any price typed into the About sheets whenever the ratchet moves.
