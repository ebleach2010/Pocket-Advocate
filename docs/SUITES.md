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

_Retired 2026-09-13 in v4.5 ("Nothing reads but his tap", below). Kept as the
record of what ran from 2026-09-05 to 2026-09-13._

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

### The reason rides, and a read tries again (v4.4)

Eric, 2026-09-09, after restoring the billing account: "I paid. still internal
errors." Two things were true at once. Google was letting reads through one in
three, then two in three, as it noticed the account, so a screen that makes
five reads failed if any one of them did. And the honest line written in 4.1
for a refused read was not what he saw: 4.3 taught the sites that stop on a
failed read to throw, and the throw reached the top of the Worker as "The case
could not be read", with no 429 in it for the catch to recognise, so it came
out as "Internal error". The state poll behind the Ask page runs under the case
policy, and that was the one on his screen.

`readFailedError` in `worker/firestore.js` builds the thrown error with the
failed read's own reason on the message (and as its cause), so `quotaFault`
tells a refused read from a broken app again. The four throwing sites use it.
And `readFetch` retries a read refused with 429 three times, after 250 ms,
750 ms and 1.5 s, before it counts as refused; writes are never retried, because a refused write
is refused for a reason that will not change in a second, and a write repeated
is a write doubled. The quota line no longer promises that a restored billing
account clears it "straight away", because it did not.

defects.mjs: the lift behind the three-answers check now carries
`lastReadError` and `readFailedError`, and its four throw pins moved with a
dated note. One new check RUNS `readFailedError` after a 429 and passes the
result through the lifted `quotaFault`, and pins the four sites and the
reworded line. Another RUNS `readFetch` against a fetch that answers 429, 429,
200 and one that never stops answering 429 (four tries, then the 429), and
pins which calls retry and which never do. Both proven able to fail with their controls recorded. The
three harness shims that lift a throwing site (charge, and the policy and
handover harnesses in selfcase) gained `readFailedError`.

### Preview a case, and the numbers tab off (2026-10-15, v7.42)

Eric: "This showcase suite should exhibit every feature and be fully
interactable. They can even chat and upload documents but they get deleted
as soon as they exit the showcase suite. This showcase suite will be on the
top left in the same aesthetic as the waitlist button, but it will say
'preview a case' or something similar... When they're in the showcase suite,
a button of the same design is in the top left (make sure it's not blocking
any interactable UI elements) that say exit." And: "remove the stats tab on
the landing page." The home's top row is Preview a case (left) and the
waitlist (right). It opens /case.html?preview=1, where firebase.js mounts
`public/js/preview/`: a client-only stand-in for the database, the files and
the routes, seeded with Joe Bloe's whole case and kept in sessionStorage.
Chat, uploads, the next-call list, permissions and a telehealth request all
work; purchases say it is a preview; nothing reaches the server. Exit, at the
top left in a strip of its own, wipes it and goes home, and arriving home
wipes it too. Joe Bloe's story moved to `public/js/preview/joe.js`, so the
showcase on Eric's side and the preview build from one story; both gained the
next check-in and the call's recording.

New suite `preview.mjs` (10 checks: the store, seed and routes imported and
run against a stand-in tab, the switch in firebase.js lifted and run, and the
preview's files scanned against the blindness list). New drive
`drive-preview.mjs` (13 checks, home to Exit, counting every request that
would write). Every new check has its control recorded. Re-pinned with dated
notes and controls: `numbers-tab.mjs` (all six, now holding the removal),
`stats.mjs` D2, `waitlist.mjs` D3 and D7, `landing.mjs` and `packages.mjs`
stylesheet stamps (b9), `showcase.mjs` X3 (eleven files) and its harness,
`opencases.mjs` E1 and its harness, release R1, and the drives
`drive-stats` (section A) and `drive-landing`. The short-phone rule that gives
the headline two lines keeps the home on one screen with the second bubble.

### His face, a green door, their profiles (2026-10-15, v7.50)

Eric: "I'd like my profile picture to be on the landing page. It can scroll.
Have it just below and to the left of 'Go into your...'" And: "Under employer
mode (which should be green shine), I should be able to upload a bio and
profile picture for each [contractor] when they submit it to me." The home
carries `.hero-face` under the h1 (styled inline in index.html so the shared
landing sheet's stamp holds), its image `/api/advocates/headshot?uid=owner`,
which is his uploaded photo or, until there is one, the shipped
`/img/eric-headshot.jpg`, shown whole. Employer mode's button is green with a
sweeping shine (admin.css, stamp stat136). Each team card has Photo and bio:
the photo goes through `/api/admin/advocates/headshot?uid=` (his alone, the
same checks as their own upload) and the words through the update action,
which now refuses an empty name and keeps the sign-in profile's name in step.

`advocates.mjs` grew G16 and re-pinned H4; charge CH7 is stat136;
drive-employer grew two checks; drive-landing's size check is re-pinned and
renamed (the home scrolls now). Every new check has its control recorded.
Release R1.

### Two things off (2026-10-15, v7.51)

Eric: "Remove the fund queue, one day summary." The Clients page no longer
links the Fund queue; like the public fund page since v7.30, the queue's page,
its routes and the applications already sent are kept, reachable only by
address. The Summary tab (one day of a thread, read back) is gone from his
Track group, with its page code, its styles (admin.css, stamp stat137), the
demo's route, and the Worker's `/api/summary` route, `handleDaySummary` and
`runDaySummary`. Summaries already made stay where they were stored.

Re-pinned, each with its control recorded: advocates D3 (the his-alone list
loses handleDaySummary), selfcase S9 and S45 (renamed: the day summary is gone),
opencases C2, tighten W3 (renamed: nothing under the shelf but the quiet
tools), fund F19 (renamed: no door, the queue kept), charge CH7 (stat137),
drive-fund B10 (renamed: no door to the queue), release R1.

### Payroll: all of it, and Paid (2026-10-15, v7.49)

Eric: "Payroll chart should not be cut off. The whole spreadsheet should be
visible once run. When I press 'paid,' the spreadsheet gets put in a folder
for that month. It can still be edited if needed but with a warning prompt of
(are you sure you want to edit this paid payroll?)". Under 760px the report is
a card a person (every cell carries `data-label`), the totals the last card;
wider, the spreadsheet. Confirm is Paid, and Pay history is a manila folder a
month (the month the period ends in), the newest open. A paid run takes an
adjust or unadjust only with `editPaid: true`, which the page sends after his
yes to "Are you sure you want to edit this paid payroll?"; each edit is kept
on the run (`edits`, `editedAt`) and it shows EDITED. It is never paid twice or
deleted.

`employer.mjs` grew E5. `drive-employer.mjs` grew two checks (the whole report
on his phone; a paid payroll locked until Edit asks) and re-pinned with dated
notes and controls its Paid-to-folder and 320px checks. Release R1.

### Warm public pages (2026-10-15, v7.48)

Eric: "try adding the same warm style from the preview suite to the landing
page. Something I can easily undo." `public/css/landing-warm.css` is linked
from no page: the Worker (`warmLook`) lays it after landing.css on the four
pages that wear it (the home and the three package pages) while his switch is
on (`config/look`, `landingWarm`, on until he turns it off), read at most once
a minute. The switch is the Warm public pages row in his settings
(`/api/admin/look`, his alone). Off, the pages are byte for byte as in the
repository. Every rule in the sheet sits under
`:root:not([data-scheme="contrast"])`.

New suite `landingwarm.mjs` (5) and drive `drive-warmlanding.mjs` (5), every
check with its control recorded. Re-pinned and renamed with a dated note and
control: drive-landing's "on black" check. Release R1.

### Contractors' own settings (2026-10-15, v7.47)

Eric: "Contractors have controls in settings just like me." His settings are
the business's; a contractor gets the same three for their own clients, kept on
their own record (`advocates/{uid}.settings`) through `worker/staffsettings.js`
(`/api/staff/settings`, their own record only, the 404 for him): in or out of
office and a response line, their prices (Advocacy Case, follow-up,
Full-Service month) and how many Full-Service clients they take at once.
`/api/availability` and `/api/rates` take `?advocate=`; a case's pages name
their advocate (`officeFor`, `readCaseRates`). A contractor's case is sold at
their prices (`ratesForCase`), never climbs his (`raiseRatesFor`), and counts
against their own limit (`fullAccessCapacity(env, contractor)`); his limit now
counts only his clients. A Full-Service request pings the case's own advocate.

New suite `staffsettings.mjs` (14). `availability.mjs` grew a check for a
contractor's door sign. New drive `drive-staffsettings.mjs`. Every new check
has its control recorded. Re-pinned with dated notes and controls: capacity
(both lifts and C15), pricing T9i, selfcase S17, charge CH3 and its harness,
invites harness, release R1.

### Employer mode and payroll (2026-10-15, v7.46)

Eric: "Next to the big 'clients' on the all cases page, I (and only I) need a
button to enter employer mode ... I should then be able to tap in to each
client and see everything they see without them knowing I'm there. This is
strictly for quality control and safety." And: "I also need to be able to run
payroll through this page. And that includes myself ... I want it to be
EXACTLY how mangomint runs payroll." And: "Remove the ability to make their
own case or family case for contractors. The + sign under all cases should
only be there to schedule a case from any lead they themselves acquire."

`worker/employer.js` holds the team (`/api/admin/team`: everyone who works
cases, him first, their open cases by kind and what they stand to earn), the
temporary chat (`/api/staff/chat`, one Worker-only `staffChats/{uid}` doc that
closing deletes) and the sample contractor (Maya Torres, `sample: true`, her
three cases `showcase: true` so every count and email skips them).
`worker/payroll.js` holds the runs (`/api/admin/payroll`: generate, adjust,
unadjust, delete a draft, confirm into the history) and each person's way to
be paid (`/api/staff/payout`, AES-GCM sealed; only the method and a masked
hint are in the clear, and a run never stores the details). His quiet view is
`?as=<uid>` on admin.html and admin-case.html: their shelf read the way they
read it, no clock, no +, no Delete, every non-GET to /api/ refused in the
browser. The invitation routes take staff now, each seeing only their own.

Money typed in by hand (`set-paid`, and `open-full` with a payment) is his
alone now, since payroll pays a share of it.

Eric, the same day: "The website currently loads a blank white page"
(opening the site). A refused working page answered with an empty 404, which
a phone paints white. Every miss is the dark `public/404.html` now
(`not_found_handling` in wrangler.jsonc, one page for every path), and a
working page refused to someone carrying our cookie, or sent there by the
sign-in page, is noted in the flight recorder (`gate-refused`, with why).
`defects.mjs` grew two checks for it.

New suite `employer.mjs` (20). `advocates.mjs` grew I1 to I4. New drive
`drive-employer.mjs` (14, both sides in one browser so the demo's two tabs
share a store). Every new check has its control recorded. Re-pinned with dated
notes and controls: advocates D1 and D3, charge CH7 (stat135), defects (the
shelf clock and the cases read), invites (the harness takes requireStaff),
opencases B2 and C2, selfcase S37 (viewAs), release R1.

### Warm, guided, tan (2026-10-15, v7.45)

Eric, with a screenshot of the preview: "Revert to the old file look in 'all
cases' for admin" (asked which: "Tan, keep the glow"). And: "Have it go step
by step through what each tab means by starting with a short welcome to the
preview ... Highlighting each section one at a time with a small window
explaining what it is." And: "make me 'in office,' make a couple file uploads
per day, highlight the progress section with a celebratory icon, fix the chat
aesthetic so it doesn't look so black/dead. I'd like the client side to look
warm and engaging." (Asked: the warm look goes on all client pages; the tour
is the preview's alone.)

`public/css/warm.css` loads after the look on the four pages a client lives
in (case, chat, subscription, return) and nowhere else: a plum brown ground,
peach and rose light, the client's bubbles in the warm pop, his on a warm
card. `chat.js` takes `otherAvatar`, `otherName` and `dayLines` from the
client's mounts only: his photo beside the first of each run of his words,
and a line for each day. `public/img/eric-headshot.jpg` and
`eric-avatar.jpg` are his photo; the Worker's headshot route sends his cases
there until he uploads one. Progress gets `cheerCard` (a party popper, the
case's line, the steps done). The preview answers `/api/availability` in
office, seeds two of Joe's own uploads a day for nine days, and opens on
`public/js/preview/tour.js`: a welcome, then each section ringed one at a
time with a card at the foot of the screen, once per visit (the flag is on
the preview store, so Exit gives the next visitor the tour). The shelf's
folders are manila again (tokens set on `.drawer` only), with the open and
paused rims kept.

New suite `warm.mjs` (14). `preview.mjs` grew A3, B4 and F1 to F4,
`advocates.mjs` G15. New drive `drive-tour.mjs` (11). Every new check has its
control recorded. Re-pinned with dated notes and controls: cancelsearch C1,
charge CH7 (stat134), preview A1 (22 uploads) and E1 (six files), selfcase
S37, release R1; drive-preview skips the tour.

### Advocate accounts (2026-10-15, v7.44)

Eric: "Admin creates advocate accounts from the admin dashboard." And:
"Passwords are never logged." And: "Each advocate gets their own isolated
workspace." `worker/advocates.js` holds his Advocates tab (create, list,
update, turn off and on, reset a password), the advocate's own page (profile,
password, finish setup), the headshot upload and its public route, and the
advocate's password door. Passwords are PBKDF2-SHA256 at 100,000 rounds with
a 16-byte salt in `staffSecrets/{sha256(email)}`; a miss hashes as hard as a
hit. The working pages' cookie is signed for him and for active advocates
only; the fund page asks for his uid on it. The work clock is every
advocate's, on their own clock doc. Case notes for an advocate go through
`/api/notes`. The security rules know advocates (isAdvocate, isAdvocateOf,
worksThread) and the Worker publishes them itself (`worker/rules-release.js`).

`advocates.mjs` grew to 48: section G evaluates the accounts module whole on a
stand-in store (the password never lands anywhere, one account per address,
the door, the profile whitelist, the opt-in rule, the photo's magic bytes,
setup's two guards, reset, turn off, the share), section H reads the doors,
cookie and router, B7 runs the presence beat. New suite `rulesync.mjs` (6):
the Worker carries both rules files byte for byte, and the release runs
against a stand-in Rules API (publish on change only, a refusal waits six
hours). `tools/rules/rules-check.mjs` runs 16 checks against the Firestore and
Storage emulators (an advocate reads and writes their own case, chat and
files, and never another's). New drive `drive-advocates.mjs` (14). Every new
check has its control recorded. Re-pinned with dated notes and controls:
clock C43b, fund F27, defects, filing F13b, prep-shelf P4/P5, selfcase S45,
tighten W3, uploads U10b, worklog L28, advocates D3, release R1; drive-invite
picks Jordan by address (the advocate persona's client is newer in his leads).

### Many advocates, the groundwork (2026-10-15, v7.43)

Eric: "We are expanding Pocket Advocate from a single-advocate platform into
a multi-advocate platform for independent 1099 patient advocates." And:
"Advocates must never be able to access another advocate's cases or data.
Enforce this server-side, not just in the UI." And: "My existing account
should remain the admin account and also become the first advocate account."
`worker/staff.js` decides who works a case: Eric (role admin, pinned to
ADMIN_UID) sees every case; an advocate (role advocate, advocates/{uid}
active) sees only cases whose `advocateId` is theirs; a missing advocateId is
Eric's. Twelve case routes now take `requireStaff` and check `staffSees` on
the loaded case before reading anything private or writing anything; the
shared chat and file helpers ask `worksThread`; a client's message or upload
pings that case's own advocate. Not theirs is the same 404 as a case that is
not there (the helpers used to answer 403). A run-once cron migration
(`stampAdvocates`, minute 7 of each quarter hour) writes Eric's
advocates/{uid} record (owner, no commission, off the payroll) and stamps his
uid on every case, chat subscription, invitation, slot and waitlist entry
that has none, batched, nothing moved or overwritten. New cases, invitations,
slots and chat lines say whose they are.

New suite `advocates.mjs` (29 checks): the staff module imported and run;
every route that takes an advocate lifted and RUN through a proxy harness in
which any outside call is recorded, as advocate B on advocate A's case (404,
nothing read or written), as a stranger, as A and as Eric; the order of the
ownership check read off each route's source; the router's set of routes
that take an advocate pinned equal to the checked set; the migration run on a
stand-in store, twice; and every creation site. Every new check has its
control recorded. Re-pinned with dated notes and controls: advisor-acts A23b,
defects (the pause gate), hold (pause/resume, close), worklog L13b, selfcase
S17/S36/S42 (the 404), release R1. Harness shims gained requireStaff and
staffSees in charge, contact, filing, invites, pricing, selfcase, stats and
uploads.

### The +, and the cards by state (2026-10-15, v7.41)

Eric, with two screenshots: "This menu is blocked. Also, let me delete my own
cases. Lastly, there should be an example case I can open and shut. Every time
we add something seeable from the client side, it gets secretly added to this.
It will be a + at the top of my 'all cases' screen and then a drop down that
says 'showcase', 'my own case' and 'schedule a case from a lead'. Once a lead
is scheduled they are prompted to fill out the forms and confirm the time and
date." And: "Closed files should look like Chris's current aesthetic. But open
ones should be highlighted in that ease in ease out blue/purple. Paused will be
the same sort of aesthetic only yellow." His answer on money: "Pay when they
confirm". The bar is above the case page's tab rail (look.css); Delete is on
his own cards and the showcase's and at the top of his case, through the app's
sheet; the + opens Showcase, My own case, Schedule a case from a lead and the
family case; an invitation is one email to one address for one time at his
price, confirmed on the booking page and charged then (never a hold), or
opened at once when free; open cards wear a cyan to violet rim that breathes,
paused ones gold. The showcase gained the next-call list and a confirmed
telehealth visit, and CLAUDE.md now says every client-visible feature joins him
in the same push.

New suites `opencases.mjs` (10 checks: the layer, Delete, the +, the card
states run on fixtures, and the showcase's coverage list run against its
builder) and `invites.mjs` (11 checks: the five routes and the invitation
branch of `createCaseFromSession` lifted and run against stand-ins, the
wiring, and his form's arithmetic imported and run). New drive
`drive-invite.mjs` (19 checks) walks the menu over the tabs, the +, an
invitation from his side to theirs and back, the cards by state and Delete.
Every new check has its control recorded. Re-pinned with dated notes and fresh
controls: `availability.mjs` H, `charge.mjs` CH3, CH7 and CH8, `showcase.mjs`
X6 (its harness passes the two new constants), `selfcase.mjs` S18, S26 and
S63, `tighten.mjs` W3, release R1, and the drives `drive-delete`,
`drive-selfcase`, `drive-selfchain` and `drive-terms`, which open the + first,
and `drive-approval`, whose demo booking now holds the live $2,100.

### Two weeks, and the numbers pulled up (2026-10-15, v7.40)

Eric: "Make the advocacy case two weeks to deliver and update that timeframe
anywhere else it's noted, including the agreement when they sign up." The
Worker's report clock is one constant, REPORT_DAYS = 14, and every sentence
about the report names 14 days, the booking page's line under the agreement
included (the agreement text itself never stated a timeframe). The stats
judge each report by the promise its case was given: 7 days for a call before
the change, 14 after. And: "put my stats at the bottom of the landing page in
brief; it will be a tab with an arrow that glows like the waitlist button and
softly eases up and down ... every 1.5 seconds. When they grab it and swipe up
it shows all of my stats." The strip behind the menu became a pull-up tab
(stats-tab.js) and a sheet with every figure.

New suites `twoweeks.mjs` (3 checks: the clock and the email read off the
Worker; every timeframe sentence; nothing anywhere still says 7) and
`numbers-tab.mjs` (6 checks: the brief and the pull's settle rule imported and
run; the motion and glow read against the waitlist bubble's own rules). New
check `stats.mjs` A5b runs the per-case promise. Re-pinned with dated notes and
fresh controls: `stats.mjs` D2 and D6 (and its harness lifts the new rule),
`landing.mjs` A4, A6, B1 and the stylesheet stamp, `packages.mjs` C1,
`waitlist.mjs` D7, release R1, and `drive-stats.mjs` section A, which now
grabs and pulls the tab.

### His prices, from his settings (2026-10-15, v7.39)

Eric: "Change the price of the mid tier to $2000. In the settings tab for
admin let me adjust price for each effective immediately." Then "*2100". The
case seed is 210000 under a new pricing stamp, so the deploy moves it. The
setter that sat folded at the foot of the Clients page is a Prices section in
the settings cog (chat, case, Full-Service, follow-up, and the hourly warning
line), read from the server before it can be edited and painted from the
server's answer after a save. Its rails were widened (the old max was the
Full-Service price), and the climb after a booking never pulls a price he set
above its ceiling back down. Prices typed into the About copy became live
spots, so nothing on a page goes stale when he saves. On a demo host rates.js
waits for the shim, so a demo save reads back on every page.

New suite `prices.mjs` (10 checks: the setter, the climb and the settings
parser lifted and run; no typed price where a live one belongs) and new drive
`drive-prices.mjs` (the cog end to end at 390 and 320px). Re-pinned with dated
notes and fresh controls: `pricing.mjs` P1 and P2d, `packages.mjs` B2 (and its
harness hands in `priced`), `landing.mjs` D8, `defects.mjs` (the Clients page
reads one extra, not two), `tighten.mjs` W3, and release R1. Every new check
proven able to fail with its control recorded.

### His letter, a clear cancel, chat search, one look, tightened (2026-10-15, v7.38)

Five asks in one release. The chat page is Eric's letter word for word, with
the guarantee above it ("They are guaranteed same day turn around for at
least one message ... their expectation is priority, not in depth case
work"). A client's menu offers "Cancel subscription" while there is one to
cancel, and it opens Stripe's own cancel step. Every chat, his and the
client's, has a search: hits in a pop-out with the words marked, a tap jumps
there, a down arrow goes back to the newest, and a tap anywhere off it
cancels. `look.css` loads last on every page but the hidden fund form and
carries the home's black, cyan and violet everywhere (three agents: two
finders, one judge, 36 fixes). Then a second three-agent pass, the tighten
audit, after his screenshot of the foot of Services: 42 fixes, mostly
deletions of the same thing said twice, plus hiding everything that sells
what is closed.

New suite `cancelsearch.mjs` (18 checks: the cancel rule, the portal route
and the subscription sync lifted and run; the search's matching run; the
look's tokens compared value for value). New suite `tighten.mjs` (20 checks:
the Book-link hider, the Enhance tab's card filter, the Needs-attention
grouping and the Leads column order lifted and run; a dash scan over every
page and script but the frozen waivers). Every new check proven able to fail
with its control recorded. New drive `drive-chatsearch.mjs`. Re-pinned with
dated notes and fresh controls: `landing.mjs` A4, A7, B1, B5, B9, D4,
`leads.mjs` C2, `packages.mjs` B1, B3, `capacity.mjs` C16b, `checkins.mjs`
W7, `fitcall.mjs` F15, `fund.mjs` F26, `pricing.mjs` H1, `charge.mjs` CH5,
CH6, `worklog.mjs` L28, `maintenance.mjs` M25, and release R1; stylesheet
stamps in `waitlist.mjs` D7 and `charge.mjs` CH7.

Every drive was run. Re-pinned with dated notes: approval (the decline reason
is asked in the app's sheet), buy and seamless (no add-on is offered while
sales are closed), capacity (the limit is read off the Full-Service page),
doing (the client-reads chips are on the Chat page), filing (its Docs-tab
regex had silently required half of the old emoji), joinlink (no button after
the call, the button once the call is ahead), landing (six headings, five
menu screens, the chat page is his letter), stats (one door), summary
(Recording after his types) and fund B10 (the Leads tab, missed in v7.36).
Two real defects the drives found were fixed, not re-pinned: file inputs ran
past 320px under the new look, and the join button was hidden for a call
still ahead on a case past its report. act, calldoc, fit, forms, hours,
nudge, openfull, worklog and the notes section of seamless fail identically
on v7.37 and are untouched here.

### One package, one page (2026-10-15, v7.37)

Eric: "When you tap on 'what's included' with the chat it describes an
advocacy case. Keep the shiny blue/purple aesthetic throughout. But it should
go to a page dedicated to what the chat is. Same with the other two options.
They should never commingle information." `priority-chat.html`,
`advocacy-case.html` and `full-service.html` each name one package on
`<body data-package>`; `package-page.js` paints that package's approved About
copy and its way in (`packageOpen`, now in `sales.js`). The home's chat card
opens the chat page and each closed card is a door to its own page; the
services cards do the same, its About sheets are gone, and the case's
after-booking steps moved to the case page. New suite `packages.mjs` (9
checks, the painters lifted and run against every package and both switch
positions, every check with its control); the landing drive taps each door;
`landing.mjs` B2, B6, B9, `sales.mjs` B2 and B2b, `checkins.mjs` AB4,
`waitlist.mjs` D7 and release R1 re-pinned with dated notes.

### Chat open, one screen, questions, Leads (2026-10-14, v7.36)

Eric: "Unlock priority chat and remove banner. Have a yellow shiny outline
around it with an animated ease in ease out bright spot circling around the
line. Reorient everything so everything on the main page fits without
scrolling. Then add a hamburger menu symbol at the top right where tabs for
every other section appears. Have a chat box icon at the bottom right of the
screen and it opens up a window that says 'questions? Type them down below
and I'll get back to you within two days.' ... Once the admin side, any
person who has submitted their information through any route gets added to
a 'leads' tab. This is a simple exportable csv that goes row by row for each
potential client." Then: the ring is "the same gradient and effect as the
waitlist button". `CHAT_OPEN` in `sales.js` opens `/api/subscribe` on its own
switch; `sales-closed.js` works package by package. The notice is gone; the
chat card leads, ringed (`.opt-gold`, a registered `--pa-ring` angle on the
bubble's 3.6s ease-in-out). The home is the hero and the options, stepped down
by height; every other section is a `:target` screen opened from the menu
(`data-always-menu`), with `landing-tabs.js` adding Back. The question box is
`question.js` to `POST /api/question` (Reply-To the person, kept in
`questions/`); `GET /api/admin/leads` merges the waitlist, questions, free
calls, cases and subscriptions by email; `admin-leads.html` shows it and
saves the CSV. New suite `leads.mjs` (19 checks, routes and the CSV lifted
and run, every check with its control); the landing drive measures the home
at nine sizes and opens every menu screen; `sales.mjs`, `landing.mjs`,
`waitlist.mjs`, `fitcall.mjs`, `fund.mjs` F26 and release R1 re-pinned with
dated notes and controls.

### Sales closed, free call gone (2026-10-12, v7.35)

Eric: "Remove free call. Stop sales everywhere. There are no chat
subscribers. /open means open up all packages, remove the banner saying I'm
sick. But leave the waitlist button for if my schedule is blocked off." And
the waitlist email's subject: "NEW CLIENT ON WAITLIST FOR [service type]".
One switch, `SALES_OPEN` in `public/js/sales.js`: while it is false the
router refuses every client purchase route (`SALES_ROUTES`) with a 409 and
his message, and `sales-closed.js` puts "Not currently offering" and a
waitlist button on book, subscribe and services (the first two hide their
flow). `/fit` sends everyone home and `/api/fit-call` answers 410. `/open`
is written down in CLAUDE.md. New suite `sales.mjs` (12 checks, the gate
lifted and run, every check with its control); `fitcall.mjs` F3, F8 to F10,
`landing.mjs` A4, B2, B4, B5, `waitlist.mjs` A3, A4, D5 (and new A3b),
`maintenance.mjs` M4 and M13 names, release R1 and the landing drive
re-pinned with dated notes.

### The waitlist (2026-10-12, v7.34)

Eric: "Create a small 'join the waitlist' that's in a shining text bubble at
the top right of the screen. Have them fill out their first and last name,
email, and phone number and desired package in a dropdown. Once submitted, a
short message that I'll get back to them soon." The bubble leads the
landing's main (`.wl-row`, `landing.css` now v=b4) and opens a native dialog;
`public/js/waitlist.js` posts to the new public `POST /api/waitlist`, which
throttles per connection, keeps a honeypot, writes one row per email to
Worker-only `waitlist/`, and sends Eric a push and an email with the details.
`GET/POST /api/admin/waitlist` feeds the new list on his Clients page
(`admin-waitlist.js`, gated in the audit). New suite `waitlist.mjs` lifts the
handlers and runs them: 21 checks, every one with its control recorded.
`landing.mjs` B9 and release R1 re-pinned.

### Semibold type (2026-10-11, v7.33)

Eric: "And change the font to something semibold. You tend to use the same
font for everything." The landing alone now sets Sora (headings, 600) and
Manrope (text, 500; buttons, badges and his notice 600), self-hosted in
`public/fonts/` and declared in `landing.css` (now v=b3). `landing.mjs` B9
re-pinned and new B11 pins the pair and the weights, both with controls;
`drive-landing.mjs` checks the headline renders in Sora; release R1 moved to
7.33.

### Out of service (2026-10-11, v7.32)

Eric: "Mark chat out of service as well. Banner at the top that's highlighted:
'I am currently out of remission and going through chemo. Services will be
available again once I can cognitively perform to the standard necessary for
advocacy. - Eric'". His notice is the first thing in main (`.out-banner`, in
`landing.css`, now v=b2); all three option cards are greyed with "Not currently
offering"; the dock, the About sheet button and every Start chatting link are
gone from the landing. `landing.mjs` B2, B4 to B7, B9 and `fitcall.mjs` F9
re-pinned with controls; `drive-landing.mjs` checks the notice comes first and
clears 4.5:1.

### The landing, black, chat first (2026-10-10, v7.31)

Eric: "Reorganize the landing page so all three options are at the top. Have
it be a more sleek black style with some color pop." Then: "make sure that
even if my schedule is blocked off 24/7 chat is always available. In fact make
the chat the highlight option. Put 'not currently offering' and gray out the
two options outside of chat." `index.html` leads with the hero and `#options`
(chat first and lit, the case and the full service greyed with his badge and
no links); `public/css/landing.css`, loaded by the landing alone, makes it
black with a cyan accent (High contrast still wins). The maintenance gate now
refuses only `/api/checkout`; the notice keeps chat links live and offers
Start chatting; `subscribe.html` no longer loads it. The demo's `/api/subscribe`
opens the subscription and lands on `/subscription.html`, as the Worker's
success_url does.

`landing.mjs` A6, B1, B2, B4 to B7, B9, `fitcall.mjs` F8 and F9, and
`maintenance.mjs` M4, M13, M17 are re-pinned; new M23 (the notice keeps chat
open) and M24 (the demo's chat sign-up lands on the chat), each with a recorded
negative control. `drive-landing.mjs` checks the black ground, the option
cards and their contrast. Two checker agents and a reviewing agent then went
over the landing and the payment code: Stripe is unchanged since v7.21, chat is
always open, and their three fixes landed with M25 (the Chat tab's empty state
starts the chat line), B10 (the landing's only door to booking is the shared
Book tab) and corrected comments.

### Patient advocacy only (2026-10-06, v7.30)

Eric: "Revert back to PR 1. Remove PR 420. Patient advocacy only." He chose to
hide the fund and keep what was submitted, and to send old fund links to the
advocacy landing. The v7.22 public pages, sign-in and Clients page are back
(PR 1, word for word, is `index.html` again); the PR 1 hub and its parked copy
are deleted; the parking gate is gone. `FUND_OPEN` in `fund-rules.js` is
false: `FUND_PAGE` in `worker/index.js` sends strangers from `/fund` to `/`,
and the applicant's routes answer 404, while his queue and the data stay.
PR 420 was already deleted in v7.21.

The landing pins in landing, checkins, defects, fitcall, maintenance and stats
read `index.html` again (E3, D8 re-pinned); CH7 moves to stat131. `fund.mjs`
F16 to F19, F26, F27, F29, F31 to F33 are re-pinned; the route checks run the
fund open through `world()`, and new F34 runs it closed (34 checks). The audit
crawls the form as a hidden page and asserts the 302. `drive-fund.mjs` B10, D1
and D2 re-pinned; `drive-landing.mjs` and `drive-nosideways.mjs` are back to
their v7.22 lists.

### The documents' rule (2026-10-05, v7.29)

Eric: "The medical document must demonstrate disability due to illness as well
as match the full name on the ID type". `DOC_RULE` is read on the landing and
on Steps 2 and 3; Verify and Reverify need `checks: { disability, nameMatch }`
(`VERIFY_CHECKS` in `fund-rules.js`), refused by the Worker after the
self-verification refusal, recorded in the history. `fund.mjs` F33 RUNS it (33
checks); the verify calls carry `CHECKS`. `drive-fund.mjs` B5a (37 checks).

### Discord is mandatory (2026-10-04, v7.28)

Eric: "Discord usernames are mandatory. They have to join." Step 1 asks for
the Discord username (not a display name) with the invite beside it; Step 4
keeps the membership box and adds a required tick that the username is
published before payout if approved (`usernamePublicConsent`, enforced by
`submitGaps`, stamped `usernameConsentAt` by the Worker, shown to the
reviewer). `fund.mjs` F32 RUNS an application missing only the tick (32
checks); F31 and the fixtures are re-pinned. `drive-fund.mjs` A2 and the new
A6b (36 checks).

### The fund's totals, and what Eric's post says (2026-10-04, v7.26)

Eric: "I also need to input Net GoFundMe proceeds so far, Zazzle creator
earnings being added, Combined total in the fund", with his Reddit post. The
pool takes `gofundmeCents` and `zazzleCents` (totals so far; `fundTotals()` in
`fund-rules.js` reads an old single total as GoFundMe alone); each
participant's share so far is the running total of their payout, and
`sentAndOwed()` gives what was mailed and what is still owed. The queue copies
the Friday post for Discord and the approved usernames. `chaseLine()` names the
10th of the month for a check that has not come. The GoFundMe link is set.

`fund.mjs` F17, F18, F22 and F25 are re-pinned; F30 RUNS two Friday posts with
a check between them and lifts the Discord post; F31 holds the post's
sentences on the landing and the form and RUNS `chaseLine` (31 checks).
`drive-fund.mjs` posts the two totals, copies the Friday post and opens the
landing's GoFundMe button (35 checks).

### The fund is home, everything else parked in PR 1 (2026-10-04, v7.25)

Eric: "I want everything but information about the fundraiser and applicants
HIDDEN in a parked PR 1. And be sure I receive notifications for
applications." Then: "Fundraiser runs through Christmas Eve with monthly
payout distributions. With first payout November 1. Also, payout should be
check only." His sign-in and his device's landing open the Fund queue, whose
nav is Fund and PR 1. `admin-pr1.html` is the hub; the old landing moved to
`admin-pr1-landing.html`. The ten old public pages (`PARKED_PUBLIC` in
`worker/index.js`) send anyone but him to `/` with a 302. Every submit pushes
to him and emails `ADMIN_EMAIL`, and `POST /api/admin/fund/test-alert` proves
both. Payout dates are `PAYOUTS` in `fund-rules.js` (Nov 1, Dec 1, Jan 1).

`fund.mjs` F11, F17 to F19, F21 to F23 and F25 are re-pinned to check only,
Christmas Eve, monthly and the hub; F26 his home, F27 the parked gate (its
regex and the gate itself RUN), F28 the alerts (submit, resubmit, the test
route), F29 the payout dates RUN at fixed instants (29 checks). The old-landing
pins in landing, checkins, defects, fitcall, maintenance, selfcase and stats
read `admin-pr1-landing.html`. The audit crawls the parked pages through the
admin demo and asserts the 302 for a stranger in both spellings.
`drive-fund.mjs` adds the alerts card, the hub and a client sent from
`/services.html` to the fund page (32 checks); `drive-landing.mjs` opens the
parked landing.

### The fund, paid out (2026-10-04, v7.24)

Eric's next list: the Discord invite and membership, a required reason they
are in need (1500 characters), approve or deny with the decision and the
reason emailed, a check in the mail with the address (Mercury, 7 to 10
business days, no tracking number), the weekly pool with each participant's
equal share and Eric never in it, money marked sent with an ID number, and
notifications for all of it (push when turned on, email otherwise), with the
Home Screen steps on the status page.

`fund.mjs` F7 and F10 are re-pinned to the emailed decision; F20 the need
statement, F21 the check, F22 the pool and its share and the queued notices,
F23 the payouts, F24 the cron drain claiming before telling and calling no
model, F25 the page wiring. `drive-fund.mjs` walks the check, the pool, a
payout and what the applicant then sees (29 checks).

### The landing, in isolation, and PR 1 (2026-10-04, v7.23)

Eric: "take what's on the landing page and park it as PR 1; hidden from view.
So this landing page will be simple and in isolation." `index.html` is the
fund's card alone, the ways to give, the help email and a quiet sign-in; the
old landing is `admin-pr1.html`, word for word behind the admin gate, without
the redirect that would send its only reader away. Every pin on the old
landing (landing.mjs, checkins W7, stats D2/D3/D9, fitcall F8 to F10, defects'
advocate door, maintenance M11) reads PR 1 now, each with a dated note.
`fund.mjs` F17 holds the new landing's words and doors, F18 RUNS the support
block at either side of the end of November 2 in Mountain time and with and
without a GoFundMe link (`GOFUNDME_URL` in `public/js/fund-landing.js`, empty
until Eric sends it), and F19 holds PR 1 parked.

### The Community Assistance Fund's verification (2026-10-04, v7.22)

Eric's brief: verify that applicants are real community members with
reasonable documentation of eligibility, asking for as little sensitive
information as possible, never ranking anyone, never deciding who is "sick
enough". Six steps at `/fund.html`, a reviewer's queue at `/admin-fund.html`.

`worker/fund.js` holds every route and `public/js/fund-rules.js` every rule
(what is kept, what each status allows, what each side sees), shared with the
demo mirror in `public/js/demo/fund.js`. Data is Worker-only by construction:
`fundApplications/{uid}`, `fundPayments/{uid}`, and files under `fund/{uid}/`
by random id, never by their names.

`fund.mjs` F1 to F16 RUN the Worker module against fakes with Firestore's own
write rules: nobody reaches anybody else's (F1), a sent application is locked
(F2), nothing incomplete is sent (F3), a file is what it says (F4), a reviewer
opens one through the Worker with no caching (F5), nobody verifies their own
(F6), a decline or a request needs an internal reason that only reviewers read
(F7), six months to reverification (F8), the history (F9), notifications name
no one (F10), payment details live apart and refuse card and account numbers
(F11), the GoFundMe photo needs its own consent (F12), the minimal record is
ready and unreachable (F13), Eric's words land word for word (F14), the pages
keep it private (F15), and the routes, gate, lists and demo agree (F16).
`drive-fund.mjs` walks it all in the demo at 390px.

### PR 420 deleted (2026-10-04, v7.21)

Eric: "Delete the trading desk folder and contents in code. I won't be
using it." The desk's Worker modules (`trade.js`, `trade-desk.js`,
`desk-run.js`), its page and its three modules, `trade-math.js`, its demo
fixtures and seed, its stylesheet rules, its diagnostics, its suites
(`desk.mjs`, `trade.mjs`) and its drive (`drive-trade.mjs`) are gone, and
the cron runs the queued-read drain on every firing again.

What stays, on purpose: `LEGACY_TRADE_CATEGORIES` in `worker/advisor.js`
keeps the trading terms the desk saved out of every glossary and off the
dictionary page; a case document marked `trade` stays off every shelf and
an old link to it lands back on the shelf; the version and changelog pins
that trade.mjs T36 carried live in `release.mjs` now. The documents the desk
wrote to Firestore are untouched.

### A blank block is refused (2026-09-22, v4.9)

Eric, the desk's Read page on his phone: "Analysis failed: system: text
content blocks must contain non-whitespace text". Four dead reads in the
ring, all at submit. The reading's second system block falls back to one
space when the knowledge note has nothing to say, and the API refuses a
whitespace-only text block; the desk had no trading terms yet, so every
reading since v4.7 died that way. turnRequest now drops any text block
with no visible character before the breakpoints are placed, where every
request is built. trade.mjs T38 RUNS turnRequest with a one-space block
and an empty block on the desk, on his own case and outside any policy,
with the real breakpoint helper lifted into the harness, and proves both
are dropped while the flagged block and the today block keep their
breakpoints. T36 re-pinned to 4.9; advisor-acts A39 re-pinned with a
note. Controls recorded.

### Nothing reads but his tap (2026-09-13, v4.5)

Eric: "Stop automatic updates. I'll manually press update so it doesn't burn
through tokens." Since 2026-09-05 a clock had booked a look at every case:
thirty minutes after a read, an hour further for every look that found
nothing new, back to thirty the moment a message or a file landed; the panel
fired the look itself while the case was open and the cron while it was not.
Every look was a turn at the top effort, and most of them read a case he was
not asking about.

Gone whole, in one push: the constants and helpers (`AUTO_GAP_*`,
`nextAutoGap`, `autoWaitMs`), the two fields on the state document
(`autoGapMin`, `nextAutoAt`), the wait in the drain and in `runAnalysis`,
the sweep's scheduled look, the flag a message or an upload raised
(`refreshAdvisor` and the upload route's `markPending`), the panel's
auto-fire and its "next automatic read" line, and Pause, which had nothing
left to pause (the button, the route action, the `paused` guards).
`markPending` takes no options now: every call is owed work, due now, and it
no longer reads the state at all. What the cron still does is look after the
read he tapped: a pass that died, a pass that errored, and the files a pass
could not fit, plus the nothing-new exit for a drain-run rescue that finds
nothing to read.

queue.mjs Q26 to Q35 keep their names and were re-pointed on 2026-09-13,
each with a fresh control: the drain carries no clock and runs a row whatever
stale clock its state still carries (Q26, Q27, RUN); no clock word survives
in the module, the Worker, the panel or the demo (Q28); `markPending` RUN
stamps `pendingAt` alone, queues once, never rewrites a row and reads nothing
(Q29, Q30); the nothing-new exit and a landed read book nothing (Q31, Q32);
`sweepOne` RUN books an owed tap and never a look of its own, a stale clock
or an old `paused` flag changing nothing (Q34); the panel volunteers nothing,
has nothing to pause, and the route behind Update runs a tap as a tap (Q35).
S48, S61 and the three-answers check in defects.mjs moved with `markPending`'s
signature, each with a dated note.

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

### What was wrong today (2026-10-15, v7.52)

Eric: "It's confusing as fuck to a new contractor." Three audits came back
(redundancy, flow, icons) and the plan ships in five pushes; this is the
first. A contractor's statuses carry their own first name, stored and pushed
(`statusLabelFor` in the Worker, `setStatusName`/`statusLabel` in
msg-actions.js); his stay word for word. Forms from a contractor's case name
them (`/api/advocates/name?uid=`, public like the photo, null for him and for
anyone unknown or off); his print his legal name. A report is refused before
the call (no `reportDueAt`), the Uploads picker opens on "Choose what this is"
with the file field disabled, and both report paths ask first; a later
recording no longer restarts the clock. A contractor's Uploads name no
reading tool, their opt-in for it keeps the price with Eric's caveat ("only an
aid, not a diagnostic tool") on its own line, their + opens the lead form
straight away, and they no longer get the review panel, his open slots, or
the empty Calendar. The alerts card sits under the Clients row; message
pushes carry `&page=chat`; a subscriber's upload push opens `?sub=`; the
inbox survives an unreadable time.

New: `cleanup.mjs` (A1 to A6) and `drive-cleanup.mjs` (8), every control
recorded. Re-pinned with controls: authority S27 to S34's harness
(caseAdvocateName), filing's row harness (advocate), selfcase S17's two
guards, tighten W4 (the picker's first option), uploads U16 (renamed: after
the call, refused before), drive-summary (the picker opens on its question), release R1.

### What they bought (2026-10-15, v7.53)

Eric: "be sure that the admin case actually matches what they purchased";
asked which package needs only the first consult, "Full-Service"; asked
whether an upgrade before the report still gets it, "No, Full-Service
replaces it." The Worker's `reportReplaced` drops a report still owed when
Full-Service switches on (both doors), a Full-Service recording stamps
`consultDoneAt` with no report clock and no report email, and a report upload
on Full-Service is refused. Clients groups by purchase (ADVOCACY CASES:
REPORT PHASE, FULL-SERVICE, BOOKED, CLOSED; booked and closed cards say
which), Full-Service is never REPORT DUE or OVERDUE, a call nobody marked done
and a Priority Chat client waiting on a reply are reminders. The case page
shows CONSULT on Full-Service, hides Report as an upload type, offers "Consult
done", and on an Advocacy Case leads with the meeting link and puts the forms
last. The client's Full-Service page says Full-Service Case Management, its
steps end in the work, and the agreement and package bullet say the work
replaces the report. The demo's Full-Service case carries no report clock.

New: cleanup.mjs B1 to B5 and drive-cleanup section D (4), controls recorded.
Re-pinned with controls: cleanup A3, charge CH7 (statusWord, three shelf
tags), pricing's open-full harness (reportReplaced), selfcase S17, S18, S45,
twoweeks B1, warm C1's harness, drive-employer's grid (a copy beside a lone folder), drive-hours (the Full-Service case by id), release R1.

Also in v7.53: the preview's and the showcase's date helper (`at` in
public/js/preview/joe.js) takes the MST day first. Taking the UTC date put
"today" a day ahead between midnight and 7am UTC, so the preview's newest
messages and files sat in the future (preview A3 and drive-preview's chat
check failed at that hour, on the base too). New preview A3b, control recorded.

### The doubles cut (2026-10-16, v7.54)

Eric: "remove redundancy", and yes to "Retire Track, Merge logs, One work
clock, PDF to Uploads". His case strip is Case, Advisor, Mine, Act: Track is
gone, Agenda is in Mine with what is still waiting on the client on top
(the old Unanswered, titled "Waiting on them", hidden when nothing waits), and
About you is in the Voice study fold on Clients (the voice route answers with
`about` from advisorStyle/profile, `aboutYou`). The work log and milestones are
one Log page with an Everything / Work / Milestones filter (the two records
are unchanged). Saved is mounted under Notes, the whole-file PDF is a one-line
card at the top of Uploads, and the Chat row's Start button is gone (the
switch by the name is the clock; the time in Chat still opens the fix sheet).
The Overview drops the TELEHEALTH and ALERT fact rows (the header chips and
Waiting on you cards carry them), NEXT names a report date only while it is
ahead, and the long explanations are one line. Admin sheet stamp stat138.

New: cleanup C1 to C4, drive-cleanup section E (2), controls recorded.
Re-pinned with controls: charge CH7 (stat138), cleanup B4, defects' group
names (four), paid M19's slab, personal G2, tighten W4 (renamed: the PDF on
Uploads), uploads U10b, worklog L28, L28b, M42, drive-advocates, drive-compile (renamed: the card at the top of Uploads), drive-seamless (renamed: no second switch), drive-selfcase, release R1.

### One Team page, one Calendar (2026-10-16, v7.55)

Eric: "remove redundancy". Advocates and Employer mode listed the same
people; Employer mode's Team page now holds Add an advocate (top) and each
card's Account (share, Advisor switch for one who opted in, reset password,
turn off), with anyone turned off listed under the team to turn back on
(public/js/admin-accounts.js, on the audit's gated list). The Advocates tab is
gone from his menu, admin-advocates.js is deleted, and its address forwards to
Employer mode; the finished-setup push links there. Availability's tools are
folds under the Calendar's month (Taking new cases, Open new slots with the
corrected "8am to 7pm", Open slots by day), mounted by admin-calendar.js
(mountAvailability); its address forwards and no menu names it. In or out is
one switch, under Your status on Clients.

New: cleanup D1, D2 and drive-cleanup section F, controls recorded.
Re-pinned with controls: advocates G14 (admin-accounts.js), fitcall F15, fund
F26, tighten V2, drive-advocates section D (Employer mode), drive-fund B10,
drive-nosideways (Employer mode in, the forwarder out), release R1.

Then (same version) Eric: "The sample contractor should have income and tips
so I can run payroll and see numbers beyond zero. And I should be able to tap
on that team member and see their cases". worker/payroll.js sampleLines makes
her sales and tips for whatever period is run (a case every week, a tip most
weeks, a Full-Service month every four weeks, the same lines for the same
days), marked sample, so the Total and Paid still leave her out; caseLines
skips her cases' own dated payments; the demo mirrors it. The report's note
says what the run would be with her. Each team card's name, photo and
clients are one link to their shelf (/admin.html?as=uid, his own for him),
and the button is Their cases.

New: employer D6, E6, drive-cleanup section G (two), controls recorded.
Re-pinned with controls: employer D2 (her cases give no line of their own),
drive-employer's team check (Their cases).

Then his screenshot of the live Team page: Maya read "No clients right now"
and $0 (the diag showed only his two open cases: her three were gone, most
likely deleted one by one from his shelf, where a showcase-flagged case was
deletable), and "the buttons are dark. They should have some contrast."
teamRoute now puts her three back when she has none (batchCreate, so only
where nothing is), the delete route refuses a sample case, neither his shelf
nor the case page offers Delete on one (they go only with her, from
Employer mode), and the demo mirrors all of it. Employer mode's quiet
buttons get a cyan edge, a tinted fill and light words.

New: employer C3, showcase X8, drive-cleanup's contrast check, controls
recorded. Re-pinned with controls: showcase X6 (the case page's delete gate
leaves the sample out), opencases B2 (deletable leaves the sample out).

Then: "It says the fake team member made sales but when I run the report
it's zero's across the board". The Total leaves her out by design, so a run
with nobody real in it read $0. A second total under it counts her ("With
Maya Torres", in her gold), and a draft's card says what it comes to with
her (summary() carries sampleCents; the demo mirrors it). Paid still drops
her row. New: drive-cleanup's "never reads all zeros" (two controls).
Re-pinned with a control: drive-employer's phone check (one totals card, or
two when the sample is on the run).

### Four audits (2026-10-16, v7.56)

Eric: "Send out four agents to look for any errors in the UI, onboarding
process, and functionality of new contractors once onboarded, and
encryption/data security to be fixed". And: "Why is my name gg gg here".

Security: every diag `do` but the rules line needs his session (the key is
in a public repository) and the plain read is cached a minute; an unverified
Firebase account under someone's address is never matched (lookupUidByEmail
asks emailVerified); a session that began before a reset or a turn-off is
refused by requireStaff, worksThread and the rules (authTime from the token,
sessionsFrom on the record); a contractor's own password change ends other
sessions and devices and hands this one a fresh token; a booking never takes
another advocate's slot; a turned-off advocate's pushes go to him; the
payroll sheet writes a formula-like name as text; a chat opens only files
this app stored (render and rules); clients add files and never replace or
label them; only open slots are public.

Onboarding: setup first (staffFrom's setup flag, requireStaff's { setup },
the rules, and auth.js's redirect); a client's address is refused for an
advocate account; payout and time zone are setup steps; typed text survives
a redraw; the primary plus six others are kept; the home page sends a
contractor's device to their workspace; the demo mirrors all of it (Ana is
seeded set up; drive-advocates resets her to walk setup).

A contractor's cases: the case's own advocate gets its pushes (caseRecipients,
pingCase; refunds stay his); their client reads their name and photo; a
turned-off contractor keeps a payroll row; the Advisor fee is paused while
it cannot serve a contractor; his duty draft, his Leads, Calendar and Terms
are his alone; forms say them for a contractor; his own name is put right
once from "Gg Gg".

New: hardening.mjs (S1 to S8, O1 to O5, F1, F2, U1 to U5, X1), advocates
G18 to G20, employer C4 and D7, showcase X8 (earlier, v7.55), drive-cleanup
H, drive-advocates' setup-first check; each with a recorded control.
Re-pinned with controls: advocates D2, G10, H4; cancelsearch B3; charge
CH3; hold's From line; clock C65; defects' paused check; employer D4;
landing E3; prep-shelf P7; selfcase S42, S45; staffsettings E2; release R1;
drive-advocates' setup steps. Fixtures updated: advocates' working
advocates are set up; the hold, charge, invites and uploads harnesses carry
the new helpers.

### Warm everywhere, Blue and purple in Settings (2026-10-16, v7.57)

Eric: "Warm gradient we have going on should be default everywhere, with the
blue/purple being in settings". warm.css now loads after look.css on every
page but the home and the package pages (landing-warm.css, still behind his
public switch) and the hidden fund form; both warm sheets stand down for
data-look="cool", which the head snippet on every page sets before paint
from pa-look. Settings' Appearance offers Warm (the default), Blue and purple,
and High contrast (theme.js APPEARANCES, applyAppearance). His hand-painted
cyan (the +, an open case's rim, the chat bubble, Employer mode's money,
initials and buttons) follows the look. The theme-color is the warm ground
unless Blue and purple is chosen.

New: warm E1, E2, drive-cleanup I, each with a recorded control. Re-pinned
with controls: cancelsearch C1, C3; warm A1, A4; landingwarm B2;
staffsettings E4 (the v7.56 demo gate, caught here); drive-cleanup's button
contrast check (a bright edge in the look's own accent); drive-invite's open
card rim (now the warm peach to pink); release R1.

### Never stuck signing in, the home page reachable (2026-10-16, v7.58)

Eric, with a screenshot of the sign-in page on "Signing you in…": "There are
glitches where you get stuck on a loading screen. I'm not sure it's even
possible to hit the landing page." The sign-in page's resume of a trusted
device had no time limit, and his phone is sent from the home page to sign in,
so the logo on that page went home and came straight back. Now the resume
says so at ten seconds, with Try again, Sign in another way and the home page,
and gives up on the server at twenty; only a 401 untrusts the device, so a
slow network no longer costs him his PIN-free sign-in. A page Safari restores
by Back mid sign-in starts again. The home page sends a staff device on only
when it was opened fresh (no referrer from this site), and a staff menu off
the working pages carries Clients, the way back.

New: drive-nostuck (16 checks, about a minute; seven recorded controls);
landing E4, E5, each with a recorded control. Re-pinned with a control:
release R1.

### His three acts on a team member's case (2026-10-16, v7.59)

Eric: "I should be able to tap on the employee and see things from their
perspective without being able to interact with their client. I can still
delete uploads and chats for real employees if I think they're dangerous, as
well as hit the ⚕️ icon to send them suicide prevention resources with the
prewritten message." His choices the same day: the crisis message is from
him, and a removal leaves "Removed by Eric" for both sides. The quiet view
(admin-case.html?as=) stays read-only except POST /api/admin/oversee
(worker/oversee.js, his alone): remove-message strips the words and the file
(only this case's chat-files) and marks it removed; remove-file deletes from
this case's four shared folders only and adds a nameless removedFiles entry
to the case, stripping a chat file's message with it; crisis writes his
message with byName 'Eric' and tells the client and the advocate without
quoting it. chat.js paints removed and byName for every side; both upload
lists say what was removed, never its name. The demo mirrors the route.

New: oversee.mjs (15 checks, 11 recorded controls), drive-oversee (9 checks,
five recorded controls). Re-pinned with a control: release R1; selfcase S37
(chat's messageTools option); warm B3 (his message wears his name, not their
face); filing's advocate-row harness (asUid, for F25 to F27).

### Invented clients off his shelf, two ways to delete (2026-10-16, v7.60)

Eric: "Remove both" (Joe Bloe and the sample contractor, now that Demo mode
does what they did); then, with a screenshot of her invented clients on his
shelf, "'Delete' for sample fake clients should be on the folders. For real
clients it should be in settings"; and "Move the employer mode and + buttons
up slightly so they're in line with 'Clients'". worker/retire.js wipes every
case that says showcase and her three records once, from the cron (minute
13), behind config/once.samplesRetired. The + has no Showcase door and
Employer mode no sample box. handleDeleteCase takes any case with nobody
real behind it (no clientUid, self or showcase) from its folder, and a real
client's case only with real: true and their name or email typed, which
only Settings on their case sends (admin-settings.js). The Clients heading
carries no margin of its own, so the row centres the buttons on its letters.

New: fakes.mjs (6 checks, six recorded controls); showcase X9; drive-fakes (9
checks, three recorded controls). Re-pinned with controls: showcase X5, X6,
X8; opencases B2, C1, C2; drive-invite's showcase delete; drive-delete's
door, card and shelf checks; drive-employer's and drive-invite's + menu; release
R1. drive-cleanup and drive-employer
now make the demo's sample through her route (their setup, no check changed).

### Demo mode, his practice copy (2026-10-16, v7.61)

Eric: "There should also be a button at the top called 'demo mode' where you
press it and 4 of these clients appear. You can do a fake update with the
advisor, the chat sends basic questions back when asked, you can upload
documents and photos, start the time, and even within there start employer
mode with the four 'employees' who each have done a different service and
have made different amounts of money." His choice: a separate copy, his real
clients hidden until Exit. Then: "allow me to adjust each fake contractor's
amount of clients and type before I run fake payroll". The button on Clients
sets sessionStorage pa-demo-live and reloads; firebase.js opens the demo
store on his working pages (on the live host only with that switch, falling
back to the real app if the files will not load), and the Worker serves
/js/demo/* on the live host to his signed cookie alone. The store keeps its
own key and seeds js/demo/live.js: the demo's seed reshaped to four clients
worked by Ana, Marcus, Grace and Luis (Advocacy Case, Full-Service, a
follow-up call and a tip, Priority Chat), paid last month so the payroll's
default shows them. In it the chat answers back (/api/notify), every folder
deletes, Priority Chat counts in the team and the payroll (demoInvoices), and
the payroll tab mounts js/demo/practice.js, which sets each person's clients
and kind, paid inside the form's dates (/api/demo/practice). The strip says
Demo mode with Start over and Exit.

The public preview's chat (js/preview/joe.js) is warmer in his lines, and
every message a visitor sends gets an answer in turn (PREVIEW_REPLIES), never
a note about the preview (Eric: "more friendly and softer toned").

New: demomode.mjs (16 checks, run against the shipped demo files under node);
drive-demomode. Re-pinned with controls: opencases B2; preview B3;
drive-preview's chat; release R1.


### The three audits' errors (2026-10-17, v7.62)

Eric, after Demo mode shipped: "send three agents to look for errors in the
suite, errors in UI, and a third glance at overall aesthetic vs what would
best sell". Their errors, fixed; the look's taste calls (palette, type,
portrait, motion, the folders) wait for his word and are not in this.

The real site: payroll names a Full-Service case's first charge Full-Service
month (worker/payroll.js and the demo mirror), and on a phone each line is a
small card; the case header's refresh keeps the FULL-SERVICE rule after a
filing; Clients shows one alerts card however often it reloads, and none in a
quiet view; the quiet view's line answers his own tap only; the notes toolbar
docks under the group row (admin.css stat139); a team photo that will not load
becomes initials; the first-run card scrolls on a short screen; the client's
chat page sizes the conversation so the box shows (chat-page.js fitChat); a
Priority Chat link from a team member's shelf keeps their read-only view; the
Chats inbox says You only for his own word and names the rest; signing out
leaves Demo mode; the services card and the preview's Exit wear the warm look
(warm.css v3), and the cards' titles and prices share a row; the tour's Chat
step sits at the top; Settings keeps Done in reach; the client's case card and
next-call box hold at 320; the running clock reads on the stock; the Leads
table says it scrolls; About's Call is a full button; Reviews has no strip.

Demo mode: Priya and Jordan read their own cases and a case with no read gets a
first one on Update (live.js firstRead); private notes are kept; Dana's
follow-up is under start, and her call and Priya's are on the calendar; every
thread carries its last word; a Priority Chat subscriber asks a chat's
questions; no practice name is on two books; prepared replies and answers
vary; the practice panel repaints when Payroll opens.

New: auditfix.mjs (25 checks, every one controlled); drive-tour's Chat step
check. Re-pinned with controls: charge CH7; cleanup B5; demomode D5; oversee
E1; release R1; drive-ask (any of the three answers); drive-cleanup (the
Full-Service eyebrow reads once); drive-employer (the photo by its saved
record, the card's initials when the picture will not load); drive-tour (each
ring clear of its card).

### The end of a Full-Service month, its pace, up to 20 hours (2026-10-17, v7.63)

Eric, asked what happens when a month of Full-Service runs out: "Close, with a
heads up. If they pass closing, under [Case Enhancements] there's a shining
upgrade for an additional month request. This goes to the advocate he accepts
or declines. All case requests get accepted or declined by the advocate they
choose." While sales are off: "No, keep it off". Asked how to keep a contractor
from doing a week and stopping: "Pacing flags", and "Yes, 'up to 20 hours'".

worker/monthend.js, from the cron at minute%15===3: three days before a
month's end the client is told (push and mail, the words for sales on or off)
and so is their advocate, once an end date (monthNotice); at the end the case
closes on schedule (closedFromStatus, monthEndedAt), waiting on a filed,
undecided appeal or a month in checkout, never on a held case, his own or a
delivered one. Then POST /api/extend-request (a SALES_ROUTE) asks the case's
own advocate, at the case's own month price; POST /api/admin/extend-request
answers: a reason on a no, a link (or no charge) on a yes, their Full-Service
limit asked about. Paying reopens only an approved month
(confirmExtensionPurchase, metadata reopen). case.js shows the shining ask in
four states and hides it with sales off; the advocate's card and Needs
attention carry it; the demo mirrors both routes.

admin-pacing.js: a Full-Service case is flagged after a week with no work
logged (the clock, or a work log entry: work.loggedAt), no word to the client
(staffMsgAt, stamped by /api/notify and the chat reply), or most of the
month's hours in its first week (from work.monthStartSeconds on a later
month). On the folder, under Needs attention and on the case.

Clients read "up to 20 hours" everywhere the month's hours are named.

The app icon is the PA tile again (Eric: "Pocket advocate icon reverted to old
one. I want the icon to be the PA one"): /img/pa-icon-*.png on every page's
apple-touch-icon and icon links, in the manifest (a maskable 512 among them),
and at /apple-touch-icon.png. New addresses, so a phone fetches it fresh.

New: monthend.mjs (22 checks, every one controlled); drive-monthend (7, six
controlled); cancelsearch D5 (controlled). Re-pinned with controls: pricing H1;
landing A6; defects scope note; worklog L18, L39, L42, L67; clock C51c, C51d,
C51e; tighten T3; charge CH6; selfcase S35; hardening F2; release R1.

### The color wheel and Black (2026-10-17, v7.64)

Eric: "Keep the whole color scheme and gradient, but allow it to be adjusted
via a color wheel in settings. I don't think it's too complicated to do more
than that for color options. Include black, though, which just makes things
black background white text for simplicity and those with eye sensitivity."
And: "Don't allow other contractors to draft duty of care notes."

tools/build-hue.mjs writes a block at the end of warm.css and landing-warm.css
from their own rules: every paint declaration again, each colour as
oklch(from <colour> l c calc(h + var(--pa-hue)) / alpha), behind @supports for
relative colour and the warm look's own guards plus :where([data-hue]), so the
default is the warm look byte for byte and no rule changes weight. Success,
error and warning colours stay put. `node tools/build-hue.mjs` rebuilds;
`--check` says whether a sheet is stale (hue.mjs H1 runs it). Edit the rules
above the block, never the block. Every page's head snippet sets data-hue and
--pa-hue before paint, never in Black or Blue and purple. theme.js: applyHue,
currentHue, turnFor, WARM_HUE (56, the accent's hue). Settings: the wheel (a
slider: finger or arrow keys), Back to the warm look, and Black (the High
contrast scheme). Stamps: warm.css v=4, landing-warm.css v=3.

A contractor's case never builds the Drafts page (ADVOCATE_PAGES), so neither
the strip nor ?page=drafts nor the chat composer offers the duty of care note;
drive-hue proves it from their side.

New: hue.mjs (8 checks, every one controlled); drive-hue (9, every one
controlled; the Black-to-colour control run by hand, the runner tripping on a
two-line edit). Re-pinned with controls: warm A4, E1; landingwarm B2, B3;
auditfix A10; cancelsearch C3; drive-cleanup's wheel check; release R1.

### Every step up an enhancement, a team member's add-ons, Act is Log (2026-10-17, v7.65)

Eric: "No voice study for contractors besides myself. Also, make every step up an
enhancement. From chat, they can enhance to advocacy case or full case
management and just pay the month's difference. Advocacy case to full
management, same thing but if they upgrade they don't get that document report.
Also, if the document has been delivered they should be notified that they have
a new enhancement. ... With full case management, attending appointments and
writing insurance appeals are enhancements. When I add a contractor into the app
it will be a simple toggle with a price input. I can go into their profile and
change this at any time by pressing on their profile picture ... Get rid of the
specific 'appeals' tab in 'act'. So just replace that whole tab with simply
'log'". His answers: "Credit $50, end chat", "$350" (an appeal), "$525"
(attending), "The full month" (after the report), "$4,400" (another month),
"Yes, up to 20" (the chat pages).

- The voice study, the draft writer's sample and the profile read only messages
  Eric sent by his own uid (advisor.js ericWrote).
- Act is Log for him and for a contractor; the Appeals page and its workbench
  are gone.
- upgradeCents: before the report is delivered the first month is the month less
  the case fee (and Full-Service replaces the report); after it, the full month.
  case.js mirrors it. A delivered report stamps enhancementAt and pushes "You
  have a new enhancement" (opening on Enhance) while sales are open; the Enhance
  tab wears a dot until opened (remembered per device in pa-enhance-seen; seen.js
  is staff-only and must never be imported by a client module, steps G1).
- worker/addons.js: advocates/{uid}.addons, attend and appeal, each { on, cents };
  his default $525 and $350, a contractor's off. Set in Add an advocate
  (admin-addons.js), changed from the profile sheet their photo opens. Attending
  on Full-Service is the telehealth request at the advocate's price (refused if
  off); an appeal is POST /api/addon-request (a sales route), answered by POST
  /api/admin/addon-request (a link, or 0 at no charge, or no with a reason), paid
  through Stripe kind 'addon' into addonsBought. The case card, the shelf flag
  and Needs attention carry the ask; the client's card has four states.
- worker/stepup.js: a renewing chat line books an Advocacy Case, or a first
  Full-Service month (scope note acknowledged), $50 off (GET /api/step-up quotes
  it). The booking is the ordinary hold; accepting it (capacity checked for
  Full-Service) stops the chat line renewing, once per line. The chat page and
  book.html?step= offer it while sales are open.
- Another month is the case's own month price, on the card and at checkout.
- Package words: appeals and attending are enhancements on top (scope note,
  service-about, book.js); the chat pages say up to 20 hours.

New: steps.mjs (13 checks, every one controlled); drive-steps (8, seven
controlled, plus no page errors). Re-pinned with controls: dictionary K5;
packages B5; uploads U16 (harness), U28k; defects groups, scope note; worklog
L28; cleanup C2; selfcase S17, S39; authority S30; cancelsearch D3; checkins
T10, AB3; charge CH5, CH7; invites E2; monthend C1, D1; pricing T5, T6, Q5;
staffsettings D2; tighten T3, T4, T5; release R1; drive-employer's profile
check; drive-advocates' and drive-cleanup's groups (Act is Log). Harnesses given the add-on helpers: employer.mjs, advocates.mjs.

### Three looks, raised buttons (2026-10-17, v7.66)

Eric: "Do you notice how the buttons don't look convex at all, and don't stand
out compared to normal text? Fix that. ... The color wheel is horrendous. Get
rid of it. Have it be either the blue/green from before or this warm look, or
just black on white."

- The wheel is gone: tools/build-hue.mjs, the generated blocks at the end of
  warm.css and landing-warm.css, the head snippets' hue lines, and applyHue and
  its friends in theme.js. Settings offers three swatches again: Warm, Blue and
  green (the black look with the cyan glow, data-look="cool"), and Black (the
  High contrast scheme: black background, white text). The storage keys did not
  change, so a device that chose Blue and purple before reads Blue and green.
- look.css RAISED BUTTONS: tokens --raise-top, --raise-bot, --raise-edge,
  --raise-hi, --raise, --raise-cta and --press on the not-Black root. A plain
  button (.btn that is not glow, danger or secondary; the menu and the cog) gets
  a lit fill from --raise-top to --raise-bot and the page's ink; every button,
  call to action and case tab wears --raise (lit along the top, shaded along the
  bottom, a shadow under it), the ones that act wear --raise-cta; the tab you
  are on is pressed in (--press); pressed, anything sinks a pixel. The shadows
  sit over whatever colour a button already has. warm.css and landing-warm.css
  set the fill in plum under the warm guard. Black is left plain.
- The same raise reaches the case and chat chips (.chip-label), booking times
  (.slot), the chat's small buttons (search, attach, help, pass) and Employer
  mode's tabs; a chosen one (.selected or .on) is pressed in. That rule carries
  :not(:disabled) to match the raise's weight, since :is() weighs as its
  heaviest argument. The home's buttons that act wear the raise under their warm
  glow. Employer mode's quiet buttons keep their accent edge and tint (his
  "They should have some contrast") with the raise's shadows over them: the
  page's rule is written to outweigh the plain lit fill.
- Stamps: look.css v=8, site.css sp17, warm.css v=5, landing-warm.css v=4.

New: raised.mjs (6 checks, every one controlled); drive-hue section D (6, every
one controlled; the Warm-from-Black control run by hand, the runner's run coming
back empty). Re-pinned with controls: hue H1 to H8 (now: the wheel gone,
the three looks); drive-hue sections A and B (the three looks in the wheel's
place); warm A4, E1, E2; landingwarm B2, B3; auditfix A10; cancelsearch C3;
opencases A1; drive-cleanup's look check and its team card control; release R1.
