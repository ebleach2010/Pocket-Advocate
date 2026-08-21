# The test suites

Where the drivable demo lives and how to reach it. Written down because
building and re-finding this once cost a full day.

## Where they run

Preview hosts only. The demo host allowlist (`DEMO_HOST` in
`worker/index.js`, mirrored in the page host checks) accepts versioned
Workers Builds previews (`<hex>-pocket-advocate.<subdomain>.workers.dev`)
and localhost. On thepocketadvocates.com every demo file answers 404, on
purpose: the fixtures carry advisor output, and clients are blind to all of
it.

Every push builds a preview. The per-commit preview URL is posted by the
cloudflare-workers-and-pages bot on the commit's pull request, so the link
changes with every build; the entries below are the stable part.

## The two suites

On any preview host:

- **Client suite**: `/case.html?demo=1&tour=1`
- **Advocate suite**: `/admin.html?demo=admin&tour=1`

Or the human doors, same host:

- `book.html` and `signin.html` show two buttons (Client suite / Admin
  suite) that go to the same places.
- Typing **1234** as the sign-in code opens the client side, **2345** the
  advocate side. No email is sent anywhere in the demo.

Drop `&tour=1` to skip the update tour.

## What it is

UI, not AI: `public/js/demo/api.js` answers every Worker call locally and
nothing touches a model or Stripe. Fixtures live in `public/js/demo/seed.js`
(case, chat, advisor state, agenda). State persists in the browser
(`pa-demo-store`, plus `pa-demo-store-advocate` for the admin-only half so a
client-side tab never holds admin material); the Start over button in the
demo banner reseeds it.
