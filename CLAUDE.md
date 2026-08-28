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

## Full suites before main (Eric, 2026-08-25: "I want full suites before
## being pushed to main")

Before ANY push to main — a feature, a hotfix, a one-liner, a copy change —
run the whole battery and get it green:

    node tools/suites/run.mjs

Every suite must pass; one red line blocks the push, full stop. For
behavioral changes, also run the blindness audit
(`node tools/blindness-audit.mjs` against a local server of `public/`) and
drive the changed surfaces in a browser before pushing. The rule exists
because a one-line hotfix once broke the admin dashboard and nothing caught
it. When a suite fails because the DESIGN changed on Eric's word, update the
suite's expectation in the same commit and say so — never delete the check.

## A drivable demo before anything major ships (Eric, 2026-08-27)

His words: **"full dummy suites as if I were a dummy client before major
things (like forms and filling forms/new pipelines) get pushed."**

Green suites are not the same as him having seen it. Before a MAJOR change
reaches main, he gets a preview URL and drives the whole thing himself as a
client would: the demo case, the real screens, filling the real forms. Major
means anything a client touches or signs, anything that changes a pipeline,
and any new flow. A copy tweak or an advocate-side panel does not need one.

This replaces an idea he floated and then cancelled the same day: a permanent
dummy CLIENT account with real credentials in production. It was dropped once
two things were verified. A permanent dummy Hands-Off case would occupy one of
the two concurrency slots counted by `fullAccessCapacity()`, which feeds
`fullOpen` on the PUBLIC `/api/rates`, so it would have told real buyers the
tier was full. And creating a case the ordinary way fires `raiseRates()`, which
would have moved the live published price for real clients. Do not revive the
idea without solving both.

## Eric's working defaults (2026-08-25, his words — commit to memory)

- **"Build suites" means the seamless demo, always.** One flow, not four
  rooms: start at the landing page, book like normal, "Next" skips the email
  requirement, "Pay" skips payment, the booking becomes a real case in the
  demo store, normal client case view, add-ons purchasable. The ADMIN side
  updates live from it — the new case populates the shelf, add-ons populate
  the chart, and the demo banner switches sides both ways. He drives it
  himself and checks for bugs manually.
- **"Run agents for X" means four agents** unless he says a number.
- **Nothing is pushed to main until he says so.** No exceptions for
  hotfixes; ask, or hold.

## Iron rules (long-standing, do not relax)

- Clients must be completely blind to admin information and tools. Admin
  pages 404 byte-identically to strangers.
- Never mention AI on any client surface. ONE ordered exception
  (Eric, 2026-08-25): the AI note-taking consent clause in
  `public/js/service-terms.js` — the blindness audit carries a documented
  allowance for that clause alone, and nothing else may lean on it.
- The advisor never uses em or en dashes in its output.
- `public/js/waivers.js` is frozen. It still contains the reschedule-refund
  clause ("If I reschedule your discussion more than once, you are entitled
  to a full refund on request"); Eric's answers about removing it conflicted
  (2026-08-25), so it stays until he decides — flag it, never fudge it, and
  never discuss internal deliberation like this in comments of files that
  are SERVED to clients (service-terms.js once did; the blindness rule
  covers prose comments too).
- Prices only change on Eric's explicit word; the +$10 booking ratchet is
  silent and its description stays out of client-served files.
- No model identifiers in anything pushed to the repo.
- The demo/test suites run on preview hosts only (`docs/SUITES.md`).

## Open flags on the tier copy (kept OUT of the served files)

These were written as comment headers in `public/js/tier-terms.js`,
`service-about.js` and `readiness.js` and moved here on 2026-08-25: those
three files are downloaded by every client, so a client reading the source
of the agreement they are about to sign was being told it was unreviewed
and which of its promises are unenforced. The blindness rule covers prose
comments; this is the same breach `service-terms.js` had.

- **`tier-terms.js` has not had a legal review.** It is a NEW file rather
  than a fourth entry in the frozen `waivers.js`, and it is PENDING ERIC'S
  SIGN-OFF. Flagged on the PR; do not treat it as settled copy.
- **Two hard constraints carry over from `waivers.js` and may not be
  contradicted:** (1) "This service is not a HIPAA covered entity" stays
  true — Eric receives records as the client's own authorised recipient,
  never as a provider, plan, clearinghouse or business associate; (2) the
  framing is advocacy only, never diagnosis, treatment plan or medical
  advice. The tier widens what Eric DOES, never what he claims to be.
- **Every number in the agreement must drive a real limit.** An audit once
  caught it promising five clinics, three calls, two appeals and ninety
  days with not one of them counted anywhere. Two survive because the code
  enforces them: the 60-day window (`fullAccessWindowEnd()`) and the two
  appeal letters (`appealsUsed()`).
- **"Every two weeks" is a FLAG, not an automation.** Eric schedules each
  check-in himself; the dashboard marks any tier case 14 days without one
  (`CHECKIN_DAYS`, `checkInDue`). The copy says "runs on a rhythm" for that
  reason. "As many calls as the case needs" is deliberately uncounted.
- **About-sheet prices are compiled-in against a live ratchet.** The sheets
  in `service-about.js` state prices as text while the case price ratchets
  +$10 a booking; they need re-checking whenever the ratchet moves.
