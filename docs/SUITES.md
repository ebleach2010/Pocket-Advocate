# The test suites

Where the drivable demo lives and how to reach it. Written down because
building and re-finding this once cost a full day.

## The static battery (runs anywhere, gates every push to main)

    node tools/suites/run.mjs

Nine suites assert against the real Worker and page sources: pricing
constants, the tier window and closure rules, the maintenance gate, the
acknowledgment flow, the authority documents, the hold model, the check-in
cadence, and the defect regressions. No server, no browser, no network.
Eric's rule (2026-08-25): this battery runs and passes before ANYTHING is
pushed to main. See CLAUDE.md.

## Where the drivable demo runs

Preview hosts only. The demo host allowlist (`DEMO_HOST` in
`worker/index.js`, mirrored in the page host checks) accepts versioned
Workers Builds previews (`<hex>-pocket-advocate.<subdomain>.workers.dev`)
and localhost. On thepocketadvocates.com every demo file answers 404, on
purpose: the fixtures carry advisor output, and clients are blind to all of
it.

Every push builds a preview. The per-commit preview URL is posted by the
cloudflare-workers-and-pages bot on the commit's pull request, so the link
changes with every build; the entries below are the stable part.

## The seamless demo (Eric, 2026-08-25: "No weird 4 room suites")

**One door: `/?demo=1` — the landing page with the demo on.** From there the
whole thing runs as one flow, which is how Eric drives it:

1. Land on the front page, tap the normal Book button. Demo mode rides
   sessionStorage, so no more demo params are ever needed in that tab.
2. Book like normal. There is no email step — the demo user is already
   signed in — and Pay skips Stripe entirely.
3. **The booking becomes a real case in the demo store**
   (`demo-case-booked`): the return page lands on it, the normal client case
   view renders, and add-ons are purchasable from its Add-ons tab (the
   follow-up correctly waits for the report; telehealth and the upgrade
   offer immediately).
4. The demo banner's **Advocate side / Client side** buttons switch sides
   both ways. The new case is on the shelf, and anything bought client-side
   (a telehealth request, the upgrade) is already on the chart. Start over
   reseeds the world.

`book.html` and `signin.html` on a preview host show the **▶ Start the
demo** button, which is this door.

### Side doors, by typed code

The old rooms still answer, as codes typed into either sign-in box - useful
for jumping straight to a fixture:

| where | url | code |
|---|---|---|
| Booking step 1 | `/book.html?demo=1` | 3456 |
| Client, standard case | `/case.html?demo=1&tour=1` | 1234 |
| Client, Full Access case | `/case.html?demo=1&id=demo-case-full` | 4567 |
| Advocate | `/admin.html?demo=admin&tour=1` | 2345 |

No email is sent anywhere in the demo. Drop `&tour=1` to skip the update
tour.

## What each one is for

**Booking.** The three steps, then the payment step where the two services
sit side by side. On step 1, the continuity-of-care phone consent is a
required tick - Continue refuses without it. Step 2 is the one agreement in
FOUR read-to-the-end parts. On the payment step, pick Full Access and the
price, the button and the included-line all change, the scope note appears,
and the pay button stays disabled until it has been opened, scrolled to the
end and ticked; "Add-ons, once your case starts" previews the follow-up,
telehealth advocacy and the upgrade with prices, nothing purchasable. That
gate is the point of the screen: nobody should be able to buy a four figure
engagement without seeing where it stops.

**Client, standard case.** A delivered case. The **Add-ons tab** (➕) now
holds everything purchasable: telehealth appointment advocacy at $250 (fill
the time, clinic and provider; the attestation tick is required; the refund
promise is stated before paying), the follow-up card, and the upgrade card
priced at the difference rather than the list price. The work clock reads
about 12 hours, which against $650 is the below-floor number his margin
badge is meant to catch.

**Client, Full Access case.** The authorisations, under the timeline on
Progress: one clinic signed, the insurer form signed, both with View and
Withdraw. Sign another and it appears; the form previews itself as you type,
and the whole document is readable before anything is signed. Progress also
carries the tier's cadence line - the next check-in call once one is booked
from the advocate side, or the standing every-two-weeks promise. On the
Add-ons tab, telehealth advocacy shows **Included** instead of a price, and
a request goes straight to the advocate with no payment.

**Advocate.** The shelf shows both cases and today's rate. Each card carries
its **work clock** on the folder tab, top right: tap to start or stop that
client's clock without opening the case, and start both at once to see them
keep separate totals. The clock is **manual, both directions** (Eric,
2026-08-25) - it never starts or stops itself, and it has three linked
switches: the shelf card, the **⏱ beside the status pill** at the top of the
chart, and the row above the chat. Flip any one and the others repaint. The Full Access card wears **CHECK-IN DUE** while its
cadence is stale; book a check-in from the chart's scheduler (the new radio,
tier-only, no charge - a date past the 60-day window is refused) and the
flag clears, the client's Progress page shows the call. Request telehealth
advocacy from a client suite first and the chart grows the confirm/deny
card - denying pings the refund. The **Pause / close** card requires the
closing reason and says, before you type, that the client reads it word for
word; close with one and the client's page shows "Why this case closed."
Open the Full Access case and there is a fifth tab group, **Act**, holding
Appeals and Clinic calls, plus the authority status card on Overview and the
margin badge beside the work clock. The appeal is drafted and sitting
against a live deadline; Write, Revise, Print and Mark it filed all work
against the local store. On the **Drafts** page, **📞 Notes for the call**
drafts the reference sheet for the next call - action plan first, then the
pitch, then nearby resources - revises through the overlay, and Sends to
PDF with every `[bracketed]` line rendered as a framed visual placeholder.
Above the chat, the **▾ What I'm doing** button posts a status line onto the
newest message - his own included - and the same list rides the long-press
menu.

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
