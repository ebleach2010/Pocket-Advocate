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

### Three answers, not two (2026-09-09, v4.3)

The audit behind v4.2 hunted one pattern: `getDoc(...).catch(() => null)`
followed by a write or a delete. That idiom folds "the database would not
answer" into "there is no such document", and while reads were refused and
writes were not, the fold is the whole hazard. Every alarming case was masked
that afternoon by an earlier uncaught read killing the job first. In a
partial outage, at the edges when an allowance runs out or comes back mid
request, or under a per-minute limit, they are live.

`worker/firestore.js` gains `READ_FAILED`, `tryGet` and `tryQuery`: a read
that fails is a third answer, distinct from null. Every site where a write
or a delete followed the guess now stops on it:

- `withCasePolicy` throws rather than run a turn on an unreadable case as
  though it were a client's, which would file his own stance onto the global
  profile.
- `markPending` and `sweepOne` never rewrite a queue row they could not read;
  the full replace was what rewound the give-up counter.
- The five rescue branches in `runQueuedAnalyses` leave the row alone on a
  failed state read, instead of deleting the only record a job is owed.
- `pollAskFlight` never deletes the marker on a failed row read, so a paid
  answer is still collected.
- `diagLog` keeps its thirty entries rather than rebuilding the ring from a
  read that did not happen.
- `fileOverride` never rewrites the stances over a prior nobody could read;
  the stance stays on the qa row, which loadQa pins.
- `runHandover` throws rather than overwrite the briefs already on a new case.
- `onIntentCanceled` and `activateSubscription` throw, which is a 503, which
  Stripe retries, instead of acknowledging a lapse or an activation on a guess.
- `runWorkClockNudges` never stops a clock whose case could not be read.
- `computePublicStats` skips rather than treat an unreadable gate as never
  computed.
- `handleFitCall`'s one-call-per-person guard has no catch at all now.

Left as it was and noted: `readOfficeHours` falls back to the schedule on a
failed read, so the client's door sign can say "In office" during an outage.
Display only, no write; fixing it honestly means teaching the client pill an
"unknown" state, for a calmer day.

    node tools/suites/defects.mjs

The check lifts `tryGet` and `tryQuery` and RUNS them against a stub that
throws, a stub that answers null, and a stub that answers a document: the
three answers have to be three different values. Then it counts the guards
at the sites above. Six harnesses (charge, clock, stats, queue twice,
selfcase twice) were taught the same two-line shim on their own stubs, so
every existing check kept its meaning.

### The day the reads ran out (2026-09-09, v3.9 to v4.2)

Eric, from a hospital bed, mid relapse: "I'm getting internal errors at a
critical moment for this case. patch asap." Then: "the whole app is fucking
failing." Then: "Every aspect of the app but chat is failing."

What it was. The Google Cloud billing account was already disabled that
morning (storage writes refused, `The billing account for the owning project
is disabled in state delinquent`). A disabled billing account puts the
Firestore project on the free daily read allowance, and the app spent it by
lunchtime. Every read, from the service account and from an anonymous caller
with the public web key alike, answered `429 Quota exceeded`. Writes still
landed. Nothing in this repository restores a spent allowance: a current
billing account (or a fresh one linked to the project) lifts the cap at once,
and otherwise it resets at midnight Pacific.

Why chat looked fine: the phone shows its own messages from the SDK's local
cache and his sends still go through, because writes work. Nothing new from a
client was reaching him.

What shipped, in order:

`do=firestore-probe` (v3.9) asks for a token, one read and one write,
uncaught, and reports each. Every call site catches a database failure and
degrades to a default, which is right on a client's page and leaves nothing
to go on when the whole thing goes quiet at once; the diag itself had gone
blank, cron and all.

Fewer reads (v4.0): the case panel fetched twenty question rows to paint
three, plus the whole dictionary and the style profile, every two and a half
seconds while anything ran and every twelve when nothing did. One tab left
open was the biggest reader in the app. Five rows now, the two slow documents
held a minute per isolate, idle at thirty seconds; busy is untouched. The
stranded-case sweep, which reads every open case, moved from every five
minutes to every fifteen.

Say what is wrong (v4.1): the Worker's top-level catch recognises a refusal
for want of allowance and answers 503 with the fact and the remedy on his
routes and a plain reassurance on a client's, instead of "Internal error" on
every screen at once. `quotaFault` is lifted and RUN in defects.mjs on both
audiences and on an unrelated failure.

Whose screen (v4.2): his screenshot showed the client wording on an admin
page, because the split keyed on the `/api/admin/` prefix and most admin
routes sit outside it. It keys on his signed admin cookie now, one HMAC and no
read. Same push: the browser gate read "cannot read your profile" as "not the
admin", wiped `pa-admin-device` and `pa-admin-door` and bounced him to the
front page; `isAdmin` answers null on a failed read and a device carrying the
hint stays. And `slowRead` no longer remembers a failure for a minute.

The audit. A five-surface workflow hunted the dangerous pattern, a caught
read whose null is then written on: `getDoc(...).catch(() => null)` followed
by a create, an overwrite, a delete or a notification. It was cut off by an
interrupt after all five sweeps and six verdicts; the results were recovered
from its journal. Nearly every alarming finding was refuted on reachability:
an EARLIER, UNCAUGHT read kills the route or the cron job before the caught
read is reached. The run-once migrations read their marker uncaught; the
queue drain lists the queue uncaught; the stats walk lists cases uncaught;
the clock nudge reads the clock document caught, gets null, and returns
before the loop. All fail closed today. The two that were real and reachable
from the phone are the two fixed in v4.2. The rest are latent, for a PARTIAL
outage where one read fails and its neighbour succeeds, and are listed in
the session's notes for a calmer day.

    node tools/suites/defects.mjs     the quota message, run; the browser gate
    node tools/suites/personal.mjs    H5 the database probe
    node tools/suites/dictionary.mjs  K1, re-pinned twice with dated notes

### The top setting on every case (2026-09-09)

Eric, 2026-09-09: "make sure we're using opus max with the API key for all
cases, including personal."

What it was: his own case ran at max, every client case ran at high, and a
routine automatic reading with no new files dropped to medium. That trade was
made on 2026-08-22, in his words at the time, because he was watching a read
take more than five minutes with his own eyes. What changed since is where the
turn runs: a reading has been submitted to the Batches API rather than carried
inside an invocation since 2026-08-24, and a question since 2026-09-07, so
nothing he is looking at holds a clock open while it thinks.

So `CASE_EFFORT` is max, and it is pinned on the POLICY rather than passed by
each caller, for the reason the policy exists at all: ten call sites build
turns, and threading a setting through every one is the change that misses one.
`withCasePolicy` now returns a policy for every case and every subscription,
not only his own, and `turnRequest` sends it. That covers the reading, a
question, a draft, an appeal, call notes, the call document, a handover and a
day summary. The nightly study of how he writes is deliberately left at low:
it reads his old messages rather than a case, and paying max for it nightly
would buy nothing.

The Deep read switch went with it, from the Settings panel, the Worker route
and the demo. It chose between the two settings this replaces, so leaving it
would have meant a switch reading "Off" while every case ran at the top
setting, and this app does not get to lie to him about itself.

    node tools/suites/selfcase.mjs      S2, S3, S10, S61, S64

S64 is the one that keeps it true: it collects every `effort:` the advisor
module actually asks for, sorts them into the turns a case buys and the ones
it does not, and holds that the only ones still written as a word are the
three turns of the nightly study. A new turn added at high fails it.

S3, S10 and S61 moved with the change and carry dated notes. The stale control
for the old S3 was replaced rather than kept: with every case carrying a
policy, the mutation it described no longer breaks the check it was written
for.

### The name that was too long (2026-09-09)

Eric, 2026-09-09: "I restarted my claude subscription and since then
everything, including ask the advisor, is down. everything but chat". It was
neither his account nor the provider. The flight recorder had it in one line:
`requests.0.custom_id: String should have at most 64 characters`. The ask's
batch name, added on 2026-09-07, came to 72 characters with a real case id in
it, so every question was refused the moment it was asked; the reading's name,
at 59, kept working, which is exactly the half of the app he could still see
running. A reading landed twenty two minutes before the failed question, which
is what ruled his key and his credits out.

`batchCustomId(prefix, id, stamp)` now builds every batch name in one place:
the stamp goes on in base 36, the id is trimmed to whatever room is left under
`BATCH_ID_MAX`, and the part that varies is never the part that gets cut. Both
callers use it. A name that somehow got past it is refused at the submit with
its own length in the message, never quietly trimmed, because a trimmed name
is one no result can be matched against.

askflight.mjs AF8 lifts the shipped builder and RUNS it over the longest input
either caller can hand it, then measures what comes out: both land on 64
exactly, and a real question comes to 47.

### The shelf says why, and a selection holds (2026-09-09)

Two from the same morning. A screenshot of his own Personal Uploads reading
"Christopher_Miller_UCHealth_Record_Packet.pdf: Internal error": `putFile`
threw, nothing caught it, and the Worker's top-level catch turned every
possible cause into one word. The list route has caught its own failures since
the day the shelf shipped; the upload never did. It answers 502 with what
storage actually said and the size of the file now, and a body that stops
partway says that instead. `do=personal-probe&bytes=N` puts one throwaway
object under his own prefix the same way, reports what came back and deletes
it, so the size a real records packet fails at can be found without asking him
to try it over and over.

And: "when I go to select text from the advisor, it only selects it for maybe
two seconds, making it extremely difficult to copy to paste". The answers were
rewritten whole on every poll, and the panel polls every two and a half
seconds while anything runs, so a selection was taken away about as fast as he
could make one. The reading has had a redraw guard since it was written, in
those words: a poll that changed nothing must not take his place away. The
answers now paint row by row, and an unchanged answer keeps its own node.

    node tools/suites/personal.mjs      H1, H1b, H2, H3, H4
    node tools/suites/askflight.mjs     AF7
    PA_PORT=9377 node tools/drives/drive-selection.mjs

The drive is the one that matters for the selection: it selects a whole answer
while a second question is still running under it, holds it through several
polls and through the second answer landing. Run against the old paint it
failed three steps with the selection at zero characters; against this one it
passes eight of eight.

The probe answered on the first try, and it was not the file and not its
size: every write comes back `403 The billing account for the owning project
is disabled in state delinquent`. Nothing in this repository can fix that, so
personalWhy names it, ahead of the plain 403 branch it would otherwise be
mistaken for, and says that fixing the billing account is the whole of the
work. 1 KB, 1 MB and 5 MB all fail identically, which is what rules the file
out.

### An answer rides the batch (2026-09-07)

Eric, 2026-09-07: "now when asking the advisor something: The server answered
with something this page could not read", with a desktop screenshot of three
questions sitting on "thinking". The question route carried its model turn
inside the HTTP invocation, streamed, and a streamed turn inside any
invocation burns the CPU budget this plan cannot raise (measured 2026-08-24;
the limits key and the workflows key were both rejected at deploy on
2026-08-23, and the limits key again on 2026-09-07 as 3.2 and 3.3). A short
answer landed; a long one died near four minutes with the stream cut and the
row left on running, which is what the page reported.

So a question is built and SUBMITTED, exactly as a read is: one small POST to
the Batches API, the batch on the qa row (`batch: { batchId, customId,
submittedAt, model, self, override, pollFails }`), a marker on the queue
(`advisorQueue/ask_<kind>_<id>_<qaId>`), and the answer collected by whoever
polls first: the per-minute drain, any API request through `pollFlightsNow`,
or the panel's own state poll, each under the case policy and throttled to
one provider GET a quarter minute per question. `finishQuestion` reads the
landed message exactly as the live path did (the tool_use blocks written
down and never run, the dictionary harvest with the person's material,
mastered and forgotten, the override, the parked proposal after the answer,
the stale flag). `askFlightNext` is the pure verdict on one poll: finish,
wait with the unreachable count, or fail (thirty unreachable polls, or two
hours, cancel the batch and say ask again). A refused stronger model at
result time is stamped and the question sent once more on the default, never
twice. The panel judges a question by its heartbeat, not its age: five quiet
minutes say no answer came back, and after a minute and a half the row says
a long answer takes a few minutes and lands on its own. The demo mirrors the
ask and lands it four seconds later.

    node tools/suites/askflight.mjs

AF1 the submit and never the carried turn, AF2 the pure verdict run over
every branch, AF3 the three pollers and the one finish per flight, AF4 the
finish's learning protocol and its failure line, AF5 the panel's heartbeat
rule and the demo, AF6 the version note and the config comment. Every one
proven able to fail with its control recorded beside it.

### A seasoned colleague (2026-09-07)

Eric: "the advisor's language is driving me insane. Some turns of phrase
make no sense. He needs personality, and some of his direct 'orders' are
not advisor language. He'll say things like 'Two things: this and this,
faxed today.' It's fucking annoying." The 2026-09-05 register made the read
imitate his own sentences ("Short sentences. One idea each. The point
first... Nothing before the point and no cushion after it... Say the thing,
then stop."), on top of both briefs' "Short bits, never essays. Five short
lines beat twenty long ones", and that is a recipe for telegrams and orders.
Asked how it should sound, he chose a seasoned colleague. Both briefs
(`VOICE`, `SELF_VOICE`) now describe one: twenty years at this, dry, warm,
direct, opinions with their reasons, a little humor; whole sentences; "You
advise; he decides", every recommendation in the first person with its
reason ("I'd get the records request faxed today, because the clinic takes
ten days and the appointment is in twelve", never "Fax the records request
today"); "Two things: this and this, faxed today." named as the shape never
written; "Brief, and whole: short paragraphs of complete sentences, never a
telegram." `registerNote` says the same, keeps the banned document phrases,
drops the imitation (his own sentences no longer ride; `ERIC_LINES` is gone;
the study's profile rides "so you read him right and meet him where he is,
not so you imitate him"), and ends every turn with a read-back that turns
any fragment into a sentence and any order into advice with its reason. The
bullets in the capped sections are whole sentences now. Plain words and the
dash ban stand. `tools/suites/register.mjs` R1-R3 hold the briefs, the note
and the bullets, and the version note; `selfcase.mjs` S52, S53 and S55
re-pinned with dated notes.

### Only what came up (2026-09-07)

Eric: "I'm not sure why the dictionary has that many terms. We have by no
means spoken about all of those, either with the advisor or client. It
seems to just be pulling related terms, not ones always discussed." It was:
every reading and every answer asked for up to five terms "central to THIS
read", which is the reading's own vocabulary, and 585 of them piled up. He
chose to start from scratch (the keyed diag door `do=wipe-terms` deletes
every term, no backup, at his word) and a rule for what counts: a word a
person wrote (the client's chat, his messages, his questions), a word in an
answer he got, or a word in a document the reading read. The three prompts
say so and end each term with where it came up (`| From: chat`, `question`,
`answer`, `document <name>`); `harvestKeyTerms` now takes the material
(`personMaterial`: the chat as people wrote it, never the reading's own
questions, plus the questions and answers) and the names of the documents
read, keeps a term only when `termMentioned` finds it as whole words
(plurals and a parenthesised acronym allowed) or the From names a document
on the list, and strips the section either way. The panel paints only terms
the dictionary holds, so a tap always lands, and the dictionary page's
not-found line says how a term gets in. Two more things from the same
message: the draft failure from the bug fixed in 2.99 sat on its case as
`draftStatus: 'error'` and repainted on every poll ("I get Draft failed:
voice2 is not a function still"), so the state route clears that one
failure once and the panel repaints a failure for a day and no longer; and
a question that answered "The server answered with something this page
could not read" is the keepalive stream ending without its JSON, which the
rows left on "thinking" say is the Worker dying mid-answer. The flight
recorder now logs `ask-start` and `ask-end` (ok, ms, or the error), the diag
carries each case's newest question (status, age, error), and the panel
treats a 200 with no JSON as work still going and keeps polling. A CPU
limit of five minutes in `wrangler.jsonc` was tried and withdrawn the same
day: the two builds that carried it never deployed (v3.4). `tools/suites/dictionary.mjs` K6 lifts the harvester and
runs it; K7 pins the prompts, lifts the wipe door, and pins the paint and
the page; K8 pins the recorder, the diag, the clear and the cut stream.

### Charge on approval (2026-09-06)

Eric: "I would like to be able to comp somebody or change charges. So they
purchase a tier, but only once I approve their case do the get charged, and
on the approval/denial screen I can tap on the amount charged and change it
to any value." A purchase now AUTHORIZES the card and captures nothing: the
three checkouts that open something he decides on (a case off a slot, a
case at a requested time, a telehealth request) carry Stripe's manual
capture and a hold flag; the subscription does not. The webhook reads the
intent back rather than trusting payment_status (unpaid on a completed
hold) and opens the case with a `charge` record in state held; a case paid
outright, or an intent captured by hand, opens as before. `worker/charge.js`
holds the record a hold opens with, the decision table (`chargeDecision`:
approve captures the amount he set up to the hold, zero releases and comps,
decline needs the reason and releases; a lapsed hold invoices or comps; an
open link blocks; a decided case refuses), the booking figure the ledger and
the case page read (`caseBookingCents`, what was captured and nothing else),
the client's words, and the three Stripe calls. `POST /api/admin/case-charge`
does it in the order that keeps money and record together: capture then
write (a refusal reads the intent back: gone marks lapsed and says so,
captured already counts as done), write then release, a link for a lapsed
hold. Approving raises the rate the way a booking used to; declining closes
the case with his reason and gives the slot back. The sweep on the quarter
hour reminds him two days before a hold runs out and, past seven days, makes
the record say what Stripe says; `payment_intent.canceled` does the same the
moment it arrives. On his overview the first card under Waiting on you is
the approval screen: the amount tappable, the two buttons; the shelf row
says APPROVE OR DECLINE. The client's pill reads AWAITING APPROVAL, a card
under it says the Worker's exact words, the booking page says the card is
held before the button and the return page after, and a declined case says
nothing was charged under the reason. Telehealth confirms ask what to
charge up to the hold and declines release it; Full-Service approvals take
the first month figure he types, and zero opens the month at no charge
through the same landing a paid link has. `tools/suites/charge.mjs` CH1-CH8
run the decision table whole, lift the route, the held branch, the lapse and
the sweep against fakes, and pin the checkouts, the halves, the pages, the
money lines, the demo and the drive; `tools/drives/drive-approval.mjs` books
in the demo, reads AWAITING APPROVAL, opens his card, types 900 and
approves, declines a second booking with a reason the client reads with
"nothing was charged", and takes a third at no charge.

### Joe gone, the dictionary whole (2026-09-06)

Eric: "Get rid of Joe bloe. Since his implementation some things have
broken. Drafting has stopped working. Tapping on a term does not bring me
to it in the dictionary." The keyed diag gained `do=unshowcase`, which asks
for every case flagged showcase and wipes each one whole through `wipeCase`;
that is how Joe left production. The term: the reading paints every
`[[term]]` it wrote, but the dictionary page read ONE page of three hundred
terms by slug, so once the dictionary grew past that (a fifty-message
rare-disease read logs a lot of words) every term past the three hundredth
was not on the page he was sent to, and the page landed at the top without
a word. Now the dictionary route, the panel's glossary and the diag's count
all walk every page, and a term the page does not hold says so at the top,
with the word he tapped: "is not in your dictionary yet. Terms arrive a
little after the reading that first used them." The draft: the diag now
carries each case's draft status, age and error, the dictionary's size and
which rows are his own or the showcase, and reading it after v2.98 went
live showed the real fault: two cases with the last draft in error, "voice2
is not a function". The draft writer builds its system block from `voice()`,
the shared block that picks the register by case, inside a function that
already held a local `voice`, the thread's sample of his messages; the local
shadowed the function, and every draft since the own-case push on
2026-09-03 died the moment it started. v2.99 renames the local to
`hisVoice`, and `dictionary.mjs` K5 scans every function in the file for
the same shadow: a body that calls `voice()` must not bind a local named
`voice`. On his own case the Ask page offers no Prepare a response, the
chat carries no message maker, and the route refuses a draft asked for
straight with "Your own case has nobody to write to." The demo used to
answer Prepare a response with a bare ok and
nothing landed; it now marks the run and lands the draft on the next poll,
serves the dictionary page the same terms the reading paints, and refuses
his own case the way the Worker does. `tools/suites/dictionary.mjs` K1-K5
pin the reads, the page, the demo, the diag and the draft writer's
bindings; `tools/suites/showcase.mjs`
X7 lifts the unshowcase door and runs it against fakes;
`tools/drives/drive-terms.mjs` taps a painted term and the Key terms link
into a lit dictionary row, reads the "not yet" line, lands a draft from
Prepare a response and from the chat's message maker, and finds his own
case offering neither and refusing a draft asked for straight, with why.

### Joe Bloe, the showcase, and Delete (2026-09-06)

Eric: "Create a completely fake case for me to show off on YouTube. Enter a
chat log of maybe 50 back and forth messages, fake name, address, phone
number, rare disease, fake document uploads, everything to make it an
interactable environment where I can show how the system works without
exposing patient information. You can push it to the app as a personal
case. For personal cases, let me be able to delete it, next to the
pause/close buttons. Name the guy Joe Bloe." `worker/showcase.js` holds
the man (a 555 number, an address at example.com that `email.js` now
refuses to send to, no uid), a fifty-message chat both ways over three
weeks (Susac syndrome: brain, eye and ear, first called migraine), ten
documents written as real text PDFs by a hand-rolled writer (ER discharge,
MRI, labs, audiogram, eye and ENT notes, a medication list, the denial, the
appeal and the case report), six milestones and seven log entries, and the
builder: a client-shaped case flagged `showcase: true`, Full-Service by
hand, the PDFs put in the case's own folders with download tokens so the
chat and the Documents tab open them, the chat dot set, and the first read
flagged. One per app; the one that exists is handed back. It can be built
from a door on the Clients page (`/api/admin/showcase-case`) or from the
keyed diag door (`do=showcase`), which is how it was pushed to production.
The parts that tell, count or bill a client skip the showcase the way they
skip his own case (the auto-close sweep, the digest, the ledger, the
chat-open notice, the public figures). Delete (`/api/admin/delete-case`,
`wipeCase`) takes a case with nobody real behind it whole (his own or the
showcase, never one with a uid): chat, reading and questions, notes,
milestones, log, authority, agenda, meta, every queue row waiting on it,
every file in its folders, the document last, and the profile's pointer;
the button sits under Pause or close and on his own case's card.
`tools/suites/showcase.mjs` X1-X6 hold the story, run the PDF writer, the
builder, the wipe and the delete route against fakes, and pin the guards,
the page, the shelf and the demo; `tools/drives/drive-delete.mjs` builds
Joe from the door in the demo, deletes him under Pause or close, and
deletes his own case from its card.

### His own cases in sequence (2026-09-05)

Eric: "I would like to open more than one case for myself, in sequence. When
I close one, it confirms the diagnosis that's top of the differential, and
then opens the new case with that diagnosis and condensed information from
the previous case so it can transfer information in general over to my new
personal case... A + -> open new personal cases -> pull information from
[select other personal cases]." Two routes: `/api/admin/self-case` no longer
bounces to the open case; every call opens a new one, and `pullFrom` names
the personal cases (his only, or the call is refused) whose information
hands over. `/api/admin/self-case/next` stamps `confirmedDx` (the top of the
case's differential, or the name he typed over it) on the case, closes it
with "Continued in the next case.", opens the next one from it and links
the two (`continuedIn`). `createSelfCase` carries every confirmed diagnosis
down the chain as `carriedDx` (oldest first, each name once), seeds the new
case's advisor state and queues a `handover_case_*` row; the drain
condenses one source per firing (`runHandover`: log, last read, the three
ranked lists, the files read, and the briefs that case itself started from,
into a fixed-heading brief under 900 words, facts and dates only), marks
the state ready when the last one lands, and flags the first read, because
the briefs are material (the empty-thread bail counts them). Every read and
every question on a case with priors gets `priorCasesNote`: the confirmed
diagnoses are established, this case's differential is about now, never
re-derive, never ask for a fact a brief carries. The overview of his own
case carries CONFIRMED SO FAR, the briefs (CARRIED OVER, off the panel's
poll, "Condensing…" until they land), and the close-and-continue card with
the top of the list in an editable box; the shelf's purple door is always
there as "+ Open another case for myself" with a pull-from picker, and
closed own cases sit under MY OWN CASE with what was confirmed. The demo
mirrors both routes and writes an invented brief a few seconds after.
selfcase.mjs S59-S64 run the lifted routes and the drain branch against
fakes and pin the prompt, the note, the page and the demo; S14 and S20 were
re-pinned with dated notes (a second call now opens a second case; the demo
names its cases by count). `tools/drives/drive-selfchain.mjs` closes a case
into the next in the demo and opens a third from the door with a pick.

### Causes and treatments on his own case (2026-09-05)

Eric: "a new separate confidence interval underneath the diagnosis for
personal cases only... By causes I don't mean contributors. I mean
underlying major mechanistic causes. And likely best next treatments." His
own read carries two more machine-read sections after the Differential,
`## Causes` and `## Treatments`, in the differential's own row shape;
`harvestRanked` reads any such list (cap, fail-safes for a missing heading
and for format drift, an honest "- none yet" clears), `finishAnalysis`
harvests and strips both on every case and stores `causes`, `treatments`
and their slim histories on his own case only, the state route returns
them, and the panel's 🧬 page paints them under the differential with the
same bars, on his own case only whatever the payload carries. The demo's
own case seeds invented rows so the page has something to paint. selfcase.mjs
S56-S58 pin the prompt (and that the client read has neither section), run
the lifted harvester over a sample read, and pin the route, the panel gate
and the demo.

### His own sentences (2026-09-05)

Eric, after the register push: "the advisor still doesn't sound like me at
all. He sounds like Claude autism 3000." A description of a voice is
imitated badly; the voice itself is imitated well. `ERIC_LINES` in
advisor.js holds thirteen of his sentences word for word, from his story,
the questions page and the front page (his own approved words, so no
client's material rides with them), and `registerNote` quotes them on
everything he reads, bans the document habits by name ("it's worth noting",
"clinical picture", "consistent with", "further evaluation" and the rest),
says how he actually talks (short, the point first, plain verbs, an opinion
stated as one, say the thing then stop), and ends every turn with a
read-back in his voice. His own case gets hard length caps in
`SELF_ASSESSMENT` (over means cut, never squeezed into jargon). The nightly
study gains an own-register reader that looks only at how he talks to his
own tools and writes a fourth profile section, `selfVoice`, which
`registerNote` reads on his own case only. selfcase.mjs S53-S55 hold every
line against the page it came from, run the note bare and with a profile,
and pin the reader, the merge section, the mask and the caps.

### No pinch, no sideways (2026-09-05)

Eric: "The app has side to side scroll, particularly if zoomed in. I'd
prefer you can't use your fingers to zoom in at all and prevent side to side
scroll altogether." Zoom is refused three ways, because no one of them
reaches every browser: the viewport meta on all 22 pages (`maximum-scale=1,
user-scalable=no`, honoured by the home-screen app and by Android), the
gesture guard in `nav-menu.js` (`refuseZoom`: Safari's gesture events and a
two-finger touchmove cancelled non-passively, since Safari in the browser
ignores the meta), and `touch-action: pan-y` on the root in site.css, which
also stops a sideways drag of the page and the double tap, while boxes that
scroll sideways on purpose keep their own pan. Then the content itself: a
Playwright sweep of every page and tab at 390px and 320px in both demos
found three things sticking out past the right edge (the about page's door
pills, the office fold's reason line, the work clock's readout on the chat
page), each fixed to wrap. `tools/suites/nosideways.mjs` N1-N4 pin the meta
on every page, run the lifted guard against a fake document, and pin the
root rule and the three fixes; `tools/drives/drive-nosideways.mjs` is the
sweep, failing on the first offender, and runs CLEAN.

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
