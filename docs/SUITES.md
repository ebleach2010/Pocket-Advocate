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

## The suites

On any preview host:

| suite | url | code |
|---|---|---|
| **Booking** | `/book.html?demo=1` | 3456 |
| **Client**, standard case | `/case.html?demo=1&tour=1` | 1234 |
| **Client**, Full Access case | `/case.html?demo=1&id=demo-case-full` | 4567 |
| **Advocate** | `/admin.html?demo=admin&tour=1` | 2345 |

Or the human doors, same host: `book.html` and `signin.html` show the
buttons, and typing the code above into either sign-in box goes to the same
place. No email is sent anywhere in the demo.

Drop `&tour=1` to skip the update tour.

## What each one is for

**Booking.** The three steps, then the payment step where the two services
sit side by side. Pick Full Access and the price, the button and the
included-line all change, the scope note appears, and the pay button stays
disabled until it has been opened, scrolled to the end and ticked. That gate
is the point of the screen: nobody should be able to buy a four figure
engagement without seeing where it stops.

**Client, standard case.** A delivered case with the upgrade card in Docs,
priced at the difference rather than the list price, and the follow-up card
under it. The work clock reads about 12 hours, which against $650 is the
below-floor number his margin badge is meant to catch.

**Client, Full Access case.** The authorisations, under the timeline on
Progress: one clinic signed, the insurer form signed, both with View and
Withdraw. Sign another and it appears; the form previews itself as you type,
and the whole document is readable before anything is signed.

**Advocate.** The shelf shows both cases and today's rate. Each card carries
its **work clock** on the folder tab, top right: tap to start or stop that
client's clock without opening the case, and start both at once to see them
keep separate totals. Open the Full Access case and there is a fifth tab
group, **Act**, holding Appeals and Clinic calls, plus the authority status
card on Overview and the margin badge beside the work clock ($134/hr on that
case, amber $56/hr on the other). The appeal is drafted and sitting against a
live deadline; Write, Revise, Print and Mark it filed all work against the
local store.

## What is invented

Everything. Jordan Avery, both cases, the denial, the appeal letter and the
clinic calls are fixtures. The appeal letter is written in the shape the real
one comes out in, `[NEEDS: ]` markers included, so the thing he has to check
before filing is visible in the demo too.

## What it is

UI, not AI: `public/js/demo/api.js` answers every Worker call locally and
nothing touches a model or Stripe. Fixtures live in `public/js/demo/seed.js`
(two cases, chat, advisor state, agenda, authorisations, clinic calls, and a
drafted appeal). State persists in the browser
(`pa-demo-store`, plus `pa-demo-store-advocate` for the admin-only half so a
client-side tab never holds admin material); the Start over button in the
demo banner reseeds it.
