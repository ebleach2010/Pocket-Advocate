# Mobile handoff prompt

Paste the block below into a fresh Claude Code session (mobile, web, or desktop)
to pick up Pocket Advocate work with full context. Replace the last line with
whatever you actually want done.

---

You're working on **Pocket Advocate**, my patient-advocacy web app, live at
https://thepocketadvocates.com. Repo: `ebleach2010/pocket-advocate`.

**Stack.** One Cloudflare Worker (`worker/index.js`) is the only server-side
code. The whole front end is plain ES modules and static HTML in `public/` —
no build step, no framework, no bundler. Data is Firebase Firestore, reached
from the Worker over the REST API (`worker/firestore.js`) and from the browser
via the Firebase SDK. Payments are Stripe.

**How it ships.** Cloudflare Workers Builds is connected to this repo: merging
to `main` deploys the Worker *and* the static assets together, in about a
minute. Do not run `wrangler deploy` — I have no local clone and no terminal.
Work on a branch, open a PR, merge it, then confirm the deploy landed by
polling `GET https://thepocketadvocates.com/api/version` until the `tag` matches
the `BUILD_TAG` constant you set in `worker/index.js`. Bump `BUILD_TAG` on every
meaningful change so I can tell a cached page from a real one. If you change
`public/css/site.css`, also bump the `?v=` query string on every `<link>` that
points at it, or browsers will serve the old file.

**Things that will bite you if you don't know them:**

- Prices live as cents constants at the top of `worker/index.js`
  (`CASE_PRICE_CENTS`, `ADDON_PRICE_CENTS`, `SUB_PRICE_CENTS`). Stripe uses
  inline `price_data` — there are no Product or Price objects in the Stripe
  dashboard — so the Worker is the single source of what actually gets charged.
  Three browser files mirror those constants for display: `public/js/book.js`,
  `public/js/subscribe.js` and `public/js/admin-case.js`. Change a rate in all
  four. Never type a price into markup — derive it from the constant, because
  a hardcoded "$150" in the pay button survived a rate change and quoted the
  wrong total at checkout for weeks. Current: $125 case, $50 follow-up add-on,
  $24.99/mo subscription. Plain-English prices also appear in `public/index.html`,
  `public/about.html` and `public/js/waivers.js` — grep for the figure.
- All times are Mountain Standard, anchored as a fixed UTC-7 via the IANA zone
  `Etc/GMT+7` (the sign is inverted on purpose — that's not a bug). There is no
  daylight-saving handling anywhere and that's deliberate.
- `worker/schedule.js` holds the booking rules: 72h lead time, 252h horizon,
  8am–6pm. Those bind **clients** booking themselves. Admin scheduling
  (`/api/admin/schedule`) deliberately ignores all of them — I can book a
  client at any hour, any day, including times that aren't on the calendar at
  all. Slots created that way are marked `adminCreated: true` so they never
  leak into public inventory. Don't "fix" that asymmetry.
- A cron in `scheduled()` sweeps open, unbookable slots out of Firestore every
  15 minutes. It only ever touches `state === 'open'` — booked and held
  appointments are never deleted.
- `PROTOTYPE.html` at the repo root is a standalone duplicate of the site that a
  GitHub Pages workflow publishes separately. It does not share code with
  `public/`. If you change the client-facing look, change it there too or the
  two will diverge.

**Voice and look.** Client-facing copy is first person — "chat with me," "I
typically reply within a few days" — never third-person "Eric." The site is
neon on near-black (`--bg: #07090F`). There is exactly one look: the theme
picker, the alternate stylesheets and the `pa-theme` localStorage key were all
deleted on purpose. Don't reintroduce them.

**How I work.** I'm not a developer. I do everything through Claude sessions —
no local checkout, no terminal, no editor. So: don't tell me to run commands,
don't ask me to paste API tokens or secrets into chat (those go in Cloudflare's
environment variables or GitHub's secrets UI), and don't schedule recurring
check-ins. Make the change, ship it, and tell me the URL and build tag so I can
confirm I'm not looking at a cached page.

**What I want done:** <describe the change here>

---

## Second project, if you need it

There's also `ebleach2010/Pocket-Webhooks` — a Node.js + TypeScript service that
receives signed webhooks from Pockey (heypocketai.com) and turns dictated
appointments into Google Calendar events. It's unrelated to Pocket Advocate;
open a separate session for it rather than mixing the two.
