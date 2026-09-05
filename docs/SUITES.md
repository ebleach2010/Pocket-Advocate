# The test suites

Where the drivable demo lives and how to reach it. Written down because
building and re-finding this once cost a full day.

## The static battery (runs anywhere, gates every push to main)

    node tools/suites/run.mjs

Twenty suites assert against the real Worker and page sources: pricing
constants, the tier window and closure rules, the maintenance gate, the
acknowledgment flow, the authority documents, the hold model, the check-in
cadence, the work log and what a client sees of it, document types and
sending forms, renaming and filing a file, what the advisor is allowed to
ask for, and the defect regressions.
No server, no browser, no network.

The count in this sentence goes stale the moment a suite is added, so
`run.mjs` prints its own total on every run. If the two disagree, the run is
right and this line needs editing.
Eric's rule (2026-08-25): this battery runs and passes before ANYTHING is
pushed to main. See CLAUDE.md.

### The one that carries his money

`tools/suites/advisor-acts.mjs` is the gate on the advisor's authority over
settings. It IMPORTS `worker/advisor-acts.js` and calls it, LIFTS
`handleClientAlert` out of the Worker and runs it, and LIFTS `actDispatch`
out of the panel and runs it over every action at once. A regex cannot tell
3500 from 35000, cannot tell a real refusal from a validator that refuses
everything, and cannot tell an action that shows a confirm card from one
that does not, so none of it is pattern matched.

Its browser half is `tools/drives/drive-act.mjs` (390px and 320px), which
proves the confirm card is on the page, shows BOTH figures before money
moves, shows the exact sentence a client will read before it is sent, and
posts what he read.

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

### The free 15-minute call (2026-09-02)

`/fit` on the landing page's first door. In the demo the seeded free-call
slots (kind `fit`, fifteen minutes) list there and nowhere else; booking one
takes a name, an email, phone or video, one line, and the US/Canada tick, and
lands on the advocate dashboard under FREE CALLS with Link, Done, No-show and
Cancel. `tools/drives/drive-fit.mjs` walks it end to end at 390px, and
`tools/suites/fitcall.mjs` lifts the Worker's two routes and drives them over
the in-memory Firestore: the person never lands on the world-readable slot,
the lost race is a 409 with nothing written, the honeypot writes nothing, the
throttle, the closed books, and the cancel that reopens the time.

### By the numbers (2026-09-02)

`/stats`, and a four-tile strip on the landing page. Every figure is a total
or a median across every case, computed once a day by the cron
(`computePublicStats` in worker/index.js) into `stats/public` and served by a
public, cached `GET /api/stats`; the demo answers with the mock's sample
figures. `tools/suites/stats.mjs` lifts the computation and runs it over
fixture cases: the reply median and the within-an-hour share, a run of client
messages counted as one question, the 7-day promise measured against the
call, the floor of three, the view that never carries a per-case field, and
the rule about paused cases that lives in code and appears nowhere in copy.
`tools/drives/drive-stats.mjs` checks the strip and the page at 390px.

### The landing page, Look A (2026-09)

`/` in the Clinic Note look Eric picked, every sentence from the copy deck he
approved word for word. `tools/suites/landing.mjs` holds two of his sentences
hostage, pins the nine slots in order, the two doors and their weights, the
Google header off the same list as the cards, the three theme lines, the
distinct card anchors on services.html, the sprite file and every `<use>`
that points into it, the dead CSS that must stay gone, one desktop width,
and no dashes. `tools/drives/drive-landing.mjs` walks the page at 390px and
320px in the demo and in all four colour schemes.

### Personal Uploads (2026-09-03)

Eric's own documents, on the Clients page (every case) and on a case's Mine
tab. Every byte goes through the Worker into a `personal/{uid}/` prefix that
storage.rules deny to every browser; only the service account reaches it,
behind requireAdmin. A file opens through a link the Worker signs for ten
minutes (the list and the upload hand one back per file); no cookie is read
on that route. `tools/suites/personal.mjs` lifts the two routes and drives
them: strangers and clients get 404, a path outside the caller's own prefix
is refused, no request field can choose the prefix, an expired or forged
link is the site's 404, SVG downloads rather than rendering, the advisor's
file walks never name it, storage.rules carry no rule for it, and no client
module imports the shelf. Two reviewers crosschecked the build for breaches
and a third compiled them (2026-09-03); every finding is closed in the
hardening commit. `tools/drives/drive-personal.mjs` uploads, lists, opens
and deletes on both shelves in the demo and checks the client's case page
never shows the word.

### The doing line (2026-09-03)

What Eric is doing while the clock runs, in his words, read by the client
in place of "working on it right now": six presets and a free line under the
⏱ on a case (`DOING_PRESETS` in admin-case.js), carried on `work.doing`
through `/api/work`, cleared by every stop. `tools/suites/clock.mjs` C60-C67
lift `handleWork` and pin the start, the change, the cap, the clear, the
refusal without a clock, and the three client surfaces; `tools/drives/
drive-doing.mjs` walks both sides in the demo. The same push carries the
advisor's flight fix (queue.mjs Q18-Q19): a manual Update takes over a
batch in flight, and a flight the provider cannot be reached for is
abandoned after thirty polls.

**Collecting a read without the cron (2026-09-04.** Eric: "It still keeps
stalling even with app open." A read runs as a batch on the provider's side
and only a poll brings it home, and the only thing that polled was
`runQueuedAnalyses`, whose only caller is `scheduled()`. Production's cron
trigger is not reliable (`diag/cron` carrying `watchdog: true` means the
heartbeat came from a request standing in), so a finished read was never
collected: it sat on "thinking" until he tapped Update, and the tap
cancelled it and bought another nobody would collect either. An hour of the
flight recorder is that loop, every entry a takeover and a resubmit and not
one landing. Now `pollCaseFlight` collects one case's flight and
`pollFlightsNow` walks the queue: the panel's own state poll awaits the
first before it answers, so the poll that finds the answer is the one that
paints it, and any `/api/` request runs the second once a minute per
isolate. His tap polls a flight younger than `TAKEOVER_AFTER_MS` instead of
throwing it away. And the run that buys a turn now CLAIMS the state document
conditionally, because two triggers passing the read-then-decide guards in
the same second were both buying one: the recorder caught two submits 321
milliseconds apart, only one of which anything would ever collect. queue.mjs
Q20-Q25 run the pollers against fakes and pin the wiring, the age gate and
the claim; Q18 was re-pinned with a dated note because the takeover now sits
behind that gate.

**The clock automatic reads run on (2026-09-05).** Eric: "Expand advisor's
automatic reads by one hour each time there is no new information. If there
is new information, keep it at 30min." Two fields on the state document
carry it, `autoGapMin` and `nextAutoAt`. A read that lands books the next
automatic look thirty minutes out (`finishAnalysis`); a look that finds
nothing new costs no turn (the nothing-new bail) and moves the clock an hour
further, up to once a day (`nextAutoGap`); a new note or file puts it back
to thirty minutes counted from the last read (`markPending`, non-force). The
drain leaves a row alone until its clock comes, judged before the attempt is
counted so waiting never spends the three tries; `runAnalysis` refuses an
early automatic run before the claim; the sweep books the scheduled look
when the clock comes due, flag or no flag, on any case that has been read
once; a forced row (his tap, a retry, a read's own leftovers) is due now,
and only a note that arrived mid-flight keeps the clock its read just set
(`due: false`). The panel volunteers a read only when the clock says so and
tells him when the next one is due. The same push claims the FINISH of a
landed batch conditionally (`finishingAt` on the flight, `ifUpdateTime` on
the state document): the recorder had shown two `end` events two seconds
apart on one batch, which was `finishAnalysis` running twice. queue.mjs
Q26-Q35 run the drain, `markPending`, `pollFlight` and `sweepOne` lifted
against fakes and pin the helpers, the bail, the finish and the panel; the
diag route shows each open case's gap and how far off its next look is.

### The contact row and the log pencil (2026-09-03)

The client's phone and home address on the case overview, tap to call or
open in Maps, with an Edit beside them; booking asks every client for the
number and offers the address line, and the webhook copies both onto the
case. A pencil at the top right of every work log entry corrects who it was
with, when, the number, who was on it, and the type, and tells the client
nothing. `tools/suites/contact.mjs` lifts and runs the Worker's cleaners,
the contact branch of case-update and the card's link maker, and pins the
booking form, the metadata, the webhook, the pencil's markup and the
Worker's edit branch; `tools/suites/worklog.mjs` L63-L66 run the correction
through the route's harness. `tools/drives/drive-contact.mjs` walks the
card, the pencil and the booking form in the demo at 390px.

### His own case (2026-09-03)

Eric as the patient: a purple button on the Clients page opens one case
with `self: true`, no client uid and no client email, on its own purple shelf
and with a purple masthead. Same tabs and controls; the chat is his own
notes, uploads go to the intake folders, and nothing on the case pings,
emails, counts or bills anyone: the Worker checks the flag wherever a
client would otherwise be told or counted (the chat notice and digest, the
work log notice, the upload actions, the included hours, the delivered-case
sweep, the chat-open notice, the scheduler, the capacity, the ledger, the
public stats). Every reading on it runs at the top effort, with one more
system block saying who it is reading about, carried by an AsyncLocalStorage
policy from each run's entry, and it takes the hand-pressed token ceilings
because that effort spends most of a ceiling on thinking. A refused model id
falls back to the default and says so in the diag log, at submit time and
(since 2026-09-04) at result time too: a batch create accepts params the run
itself will not honour, so the failure only surfaces when the result lands,
and the read now re-runs on the default instead of parking as an error his
next note buys again. The stamp that remembers a refusal NAMES the id it
refused (`modelRefusedId`), so changing the pinned id clears its own
history: his own case was moved to the default while the stalling was still
unexplained and moved back on his word once reads were landing, and a
leftover stamp would otherwise have held it on the default silently and for
ever. The stalling was never the pinned id; it was that nothing collected a
finished read, which is the paragraph above.

His own register (Eric, 2026-09-05: "just as intelligent but speak in my
own voice. He sometimes throws out weird phrases I don't understand that
aren't even medical jargon"). Both standing briefs said "the way a sharp
colleague would", which is a licence for idiom, metaphor and the clever turn
of phrase. They say plain words now, his words, nothing he would have to
stop and decode, with the thinking left as sharp as it was. And the profile
of how he writes, which the nightly study keeps and which was used only for
the two sections that leave a client case as his message, is now the
register for everything addressed to him (`registerNote`): the assessment,
the answer to a question, the call notes and the call document, on every
case including his own. Safe there because the readers describe habits and
are forbidden to quote anyone's clinical detail (`READER_RULES`). The appeal
letter and the client draft are left alone: one goes to an insurer, the
other already writes as him. `selfcase.mjs` S52 runs the note bare and
voiced, counts the four sites, and pins both briefs; S40 re-pinned with a
dated note. `tools/suites/selfcase.mjs`
lifts and runs the policy, the request builder, the fallback and the route,
and pins every guard and the purple; `tools/suites/worklog.mjs` L67 runs the
silence through the work log harness. `tools/drives/drive-selfcase.mjs`
opens the case in the demo at 390px and walks the shelf, the masthead, the
chat and the uploads.

Later the same day: the own-case door asks for his details first (name,
date of birth, phone, home address), and a second door opens a **family
case**: an ordinary case on their side, free (no fees, no Stripe record, no
rate moves), chat open from the first day, and the email he types is the
login. If that address already has an account the case is theirs at once;
otherwise the sign-in code step (`claimFamilyCases`) attaches the uid the
first time that address signs in, and one email tells them where to sign
in. The card and the case page carry a purple "family, free" flag, the
money lines leave it out, and their own page shows no paid extras.
`selfcase.mjs` S22-S26 run both routes, the details validation and the
claim; the drive fills both forms. An Edit beside the name on his own
overview (case-update action `details`, his own case and a family case
only) corrects the four details in place; S27-S28 run and pin it.

Oriented to him (Eric, 2026-09-03: "It's asking me to fax shit like I'm
working for a client... An entirely different set of instructions. If it
has questions it wants answered it can ask in the chat. I can press reply
to that question to answer it."): every turn on his own case opens with its
own brief (`SELF_VOICE`, picked by `voice()` from the turn policy where the
turn is built) and the assessment runs on `SELF_ASSESSMENT`, whole, in place
of the client one: same machine-read tail, a middle addressed to him about
himself, no advocacy chores, and a "Questions for you" section. When a pass
finishes, `askInChat` puts those questions into his chat as Worker-only
question rows (`role: 'question'`, `from: 'reading'`), once each; the chat
paints them on the other side with a purple rule and a Reply; Reply puts the
question over the box and Send goes through `POST /api/chat/reply`, which
writes his answer with `replyTo` and the quoted question (the browser rules
allow a message five fields and no more), stamps the question answered, and
wakes the read. The transcript names the questions it asked (`YOU ASKED
[id=...]`) and which one an answer answers, the Unanswered page on his case
lists the questions he has not answered yet (from the chat, not the model),
and a note of his wakes the read the way a client's message does. S29-S38
lift and run the brief, the transcript, the harvest, the ask, the reply
route and the notify branch, and pin the chat, the panel, the demo and the
styles; the drive taps Update, sees the two questions arrive, presses Reply,
answers, and reads the answer back with the question quoted above it.

Walled off (Eric, 2026-09-03: "make sure there's no crossover instructions
or breach between my personal case and a clients"): two audit sweeps, one
over every model turn and the learned material, one over every data,
notification, email, export, stats and rules path. Patched: the voice study
and the draft writer skip his own case (`voiceCorpus`), an override typed
there strips its stance instead of filing it globally, the standing
positions and his client voice stay off his own turns, the feedback route
and the distill teach the profile nothing from it, the draft route refuses
it (409) and the panel drops Prepare a response, the Workflow entry runs
under the case policy, the notify route refuses anyone but him on it, a
reaction cannot land on a question row, the reply route takes only plain
ids, the digest masks one field, the CSV, the saved shelf, the chats list
and the day summary name a question as one, the saved shelf on his case is
his, the duty of care panel and the agenda's Send to client are gone there,
the appeal is written for himself and the call notes carry no pitch, and a
family case for an address that already owns a case here is refused once
with a confirm button (`confirmExisting`). S39-S47 lift and run the corpus,
the reply and family routes, and pin the rest; the drive types the demo
client's address into the family door and reads the refusal.

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

**Client, Full Access case.** **What I have been doing**, under the timeline
on Progress: the work log, newest first, one dated row per entry with its
category on a pill. Only entries the advocate wrote a client line on are here;
the seeded case has one of each so the difference is visible. Under it,
**Permissions you have given me**: one clinic signed, the insurer form signed,
both with View and Withdraw. There is no Sign button any more (Eric,
2026-08-27: "Remove the release of records and park that"), and on a case that
has signed nothing the whole permissions panel renders nothing at all. Progress
also carries the tier's cadence line - the next check-in call once one is
booked from the advocate side, or the standing every-two-weeks promise. On the
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
Pausing has two reasons since 2026-09-03: a note **for the client** (they
read it word for word at the top of their paused notice, and it reaches them
as a push and an email; `hold.note` on the case document) and his own reason
(`caseMeta.holdReason`, Worker-only, no longer on the client-readable case
document). `tools/suites/hold.mjs` lifts and runs the route for both, and
`tools/drives/drive-hold.mjs` pauses a demo case with a note and reads it
back on the client's page.
The **Work log** is the fourth page of the Case group, on EVERY case: pick one
of his four categories, say who it was with, and write the one line the client
sees, or leave that box empty and the entry stays his. Each row says which it
is. Open the Full Access case and there is a fifth tab group, **Act**, holding
Appeals, plus the authority status card on Overview and the margin badge
beside the work clock. The appeal is drafted and sitting
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
(two cases, chat, advisor state, agenda, authorisations, the work log, and a
drafted appeal). The work log is seeded twice over: the record itself under
`private/`, which the client half of the store never loads, and the four-field
projection under `caseLog/`, which is what a client-side tab reads. That split
is the demo standing in for what the Worker does in production, where the
browser never holds the record at all. State persists in the browser
(`pa-demo-store`, plus `pa-demo-store-advocate` for the admin-only half so a
client-side tab never holds admin material); the Start over button in the
demo banner reseeds it.
