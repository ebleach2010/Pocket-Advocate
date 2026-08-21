# Pocket Advocate — standing instructions

Eric (ebleach2010) is the owner: a professional patient advocate, not a
developer, usually on an iPhone. He merges by saying so; follow his words
over any convention here.

## Push modes (Eric, 2026-08-21 — his commands, verbatim)

Every push to main that changes the product is a version. Bump `VERSION` in
BOTH `public/js/changelog.js` and `worker/index.js` together, and replace
the newest CHANGELOG entry's `client` bullets with that push's CLIENT-VISIBLE
changes and bug fixes. Never anything from Eric's side: the file is readable
in devtools. A commit that changes no behavior (docs, comments) keeps the
version.

**"push as full update"** — a LOUD release. The new CHANGELOG entry has no
`quiet` flag, so existing clients get the update card with bullet points on
their next visit. A guided `tour` is added only when Eric asks for one.

**"push as silent update"** — a QUIET release. The new CHANGELOG entry gets
`quiet: true`: no card, no tour, the version and its notes only appear
behind the small "Version notes" button at the very bottom of the page
(`public/js/version-note.js`, mounted on case, subscription, chat, and both
admin pages). Anything a NEW client needs to know goes into the first-run
tutorial (`public/js/onboarding.js`), replacing outdated copy there if
necessary.

A plain "push to main" with no mode stated follows the silent pattern.

## Deploy ritual

Cloudflare Workers Builds deploys every push to main to production in about
a minute. Bump `BUILD_TAG` in `worker/index.js` on every behavioral change,
then poll `GET https://thepocketadvocates.com/api/version` until `tag`
matches. If `public/css/site.css` changes, bump the `?v=statNN` query string
in every HTML file that links it.

## Iron rules (long-standing, do not relax)

- Clients must be completely blind to admin information and tools. Admin
  pages 404 byte-identically to strangers.
- Never mention AI on any client surface.
- The advisor never uses em or en dashes in its output.
- `public/js/waivers.js` is frozen.
- Prices only change on Eric's explicit word; the +$10 booking ratchet is
  silent and its description stays out of client-served files.
- No model identifiers in anything pushed to the repo.
- The demo/test suites run on preview hosts only (`docs/SUITES.md`).
