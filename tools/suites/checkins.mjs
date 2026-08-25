// checkins.mjs — the reshaped tier: check-in cadence, window-only closure,
// phone consent, closure reasons, and telehealth appointment advocacy.
// Run: node checkins.mjs
// Repo-rooted: this file runs from tools/suites/ inside the repository, so
// the sources it asserts against are found relative to itself, wherever the
// repo is checked out.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';

const ROOT = __REPO;
const SRC = readFileSync(`${ROOT}/worker/index.js`, 'utf8');
const ADMIN = readFileSync(`${ROOT}/public/js/admin-case.js`, 'utf8');
const SHELF = readFileSync(`${ROOT}/public/js/admin.js`, 'utf8');
const CASE = readFileSync(`${ROOT}/public/js/case.js`, 'utf8');
const BOOK = readFileSync(`${ROOT}/public/js/book.js`, 'utf8');
const TIER = readFileSync(`${ROOT}/public/js/tier-terms.js`, 'utf8');
const TERMS = readFileSync(`${ROOT}/public/js/service-terms.js`, 'utf8');
const DEMO = readFileSync(`${ROOT}/public/js/demo/api.js`, 'utf8');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

// ---- the cadence ----
check('C1 the checkin scheduler mode exists and is tier-only',
  // Renamed with the tier (Eric, 2026-08-25): Hands-Off Case Management.
  /'checkin'/.test(SRC) && /if \(!c\.fullAccess\) return json\(\{ error: 'Check-ins are part of Hands-Off Case Management/.test(SRC));
check('C2 a check-in past the window is refused, pointing at extensions',
  /That lands after the window ends[\s\S]{0,80}Extend the case first/.test(SRC));
check('C3 check-ins are an append-only ARRAY, never the single followUp object',
  /checkIns: \[\.\.\.checkIns, \{ start, durationMin, slotId, scheduledAt: now \}\]/.test(SRC));
check('C4 a closed case cannot take a check-in',
  /if \(mode === 'checkin'\)[\s\S]{0,600}status === 'closed'.{0,60}This case is closed/.test(SRC.replace(/\n/g, ' ')) ||
  /'checkin'[\s\S]{0,900}This case is closed/.test(SRC));
check('C5 the admin scheduler offers the radio only on tier cases',
  /c\.fullAccess \? `<label[\s\S]{0,120}value="checkin"/.test(ADMIN));
check('C6 the shelf flags CHECK-IN DUE at 14 days',
  /function checkInDue\(c\)/.test(SHELF) && /14 \* 86_400_000/.test(SHELF)
  && /CHECK-IN DUE/.test(SHELF));
check('C7 the flag respects a pause and a booked future check-in',
  /c\.hold\?\.pausedAt\) return false/.test(SHELF)
  && /some\(\(x\) => toDate\(x\.start\)\.getTime\(\) > now\)\) return false/.test(SHELF));
check('C8 the chart mirrors the same rule (two copies, kept in step)',
  /function checkInState\(c\)/.test(ADMIN) && /const CHECKIN_DAYS = 14/.test(ADMIN));
check('C9 the client sees the next check-in, or the standing promise',
  // "minimum biweekly (twice a month) meaning THEY don't get to go without
  // checking in" (Eric, 2026-08-25) - the phrase moved with the promise.
  /function checkInLine\(c/.test(CASE) && /check-in calls at least twice a month/.test(CASE));

// ---- closure ----
check('C10 the "closes at the second call" clause is GONE from the sweep',
  // The clause was `const wrapped = !!row.data.followUp?.start && ... + 48h`.
  // ("wrapped up on schedule" in the closedReason strings is a different word
  // doing honest work.)
  !/const wrapped =/.test(SRC) && !/followUp\?\.start[\s\S]{0,120}48 \* 3600_000/.test(SRC));
check('C11 a tier case auto-closes on windowOver alone',
  /if \(!\(until && Date\.now\(\) > until\.getTime\(\)\)\) continue;/.test(SRC));
check('C12 an undecided appeal still blocks the close',
  /appeal\?\.filedAt && !appeal\.decidedAt\) continue;/.test(SRC));
check('C13 every auto-close writes a closedReason the client reads',
  /closedBy: 'automatic', closedReason/.test(SRC)
  && /wrapped up on schedule/.test(SRC));
check('C14 a hand close REQUIRES the reason',
  /if \(!reason\)\s*\n\s*return json\(\{ error: 'Write the reason for closing\. The client reads it word for word\.' \}, 400\);/.test(SRC));
check('C15 the reason lands on the case doc, in the write mask',
  /mask: \['status', 'closedAt', 'closedBy', 'closedReason', 'hold'\]/.test(SRC));
check('C16 the old private closedNote write is gone',
  !/closedNote:/.test(SRC));
check('C17 the legacy reasonless close action is retired, not silently kept',
  /Closing moved: use the Pause \/ close card/.test(SRC));
check('C18 the admin form says the client reads it, and refuses empty',
  /the client reads this, word for word/i.test(ADMIN)
  && /Write the reason first — the client reads it word for word\./.test(ADMIN));
check('C19 the client page renders the reason on a closed case',
  /function closedNotice\(c\)/.test(CASE) && /Why this case closed/.test(CASE)
  && /esc\(c\.closedReason\)/.test(CASE));
check('C20 the PAUSE reason stays private (only closure changed)',
  /Why, for your record only/.test(ADMIN));
check('C21 the demo mirrors the required reason',
  /no reason, no close|Write the reason for closing/i.test(DEMO));

// ---- phone consent ----
check('C22 phoneConsent is in REQUIRED_ACKS',
  /const REQUIRED_ACKS = \['disclaimer', 'privacy', 'recording', 'service', 'phoneConsent'\];/.test(SRC));
check('C23 the booking page gates step 1 on the tick',
  /Tick the consent box so I can call you between sessions\./.test(BOOK));
check('C24 the tick is a timestamped ack like the agreement boxes',
  /state\.acks\.phoneConsent = Date\.now\(\)/.test(BOOK));
check('C25 the row dies with the other step-1 nodes on a failed calendar',
  /'#phone-consent-row'/.test(BOOK));
check('C26 the demo checkout refuses without all five',
  /'phoneConsent'\]\s*\n\s*\.every/.test(DEMO));

// ---- telehealth ----
check('T1 the request route validates when/clinic/provider/attestation',
  /Name the clinic\.'/.test(SRC) && /Name the provider we'll be seeing\./.test(SRC)
  && /Tick the box confirming you are inviting me into your appointment\./.test(SRC));
check('T2 tier requests charge nothing and go straight to pending',
  /if \(c\.data\.fullAccess\) \{[\s\S]{0,400}state: 'requested', paidCents: 0/.test(SRC));
check('T3 a standard case pays the flat constant, off the ratchet',
  /const TELEHEALTH_PRICE_CENTS = 25000;/.test(SRC)
  && !/growRate\([^)]*TELEHEALTH/.test(SRC));
check('T4 the webhook rebuilds the request from session metadata',
  /kind === 'telehealth'/.test(SRC) && /confirmTelehealthPurchase/.test(SRC)
  && /session\.metadata\.when/.test(SRC));
check('T5 money is written into extraPayments the moment it lands',
  /payments\.push\(\{ kind: 'telehealth', amountCents: paid/.test(SRC));
check('T6 confirm appends to telehealthVisits and clears the pending',
  /telehealthVisits: \[\.\.\.visits/.test(SRC));
check('T7 deny pings the refund when money moved, quoting the promise',
  /Refund the \$\$\{\(p\.paidCents \/ 100\)\.toFixed\(0\)\} from Stripe - the copy promises it in full\./.test(SRC));
check('T8 a duplicate webhook is idempotent by sessionId',
  /payments\.some\(\(x\) => x\.sessionId === session\.id\)\) return;/.test(SRC));
check('T9 an abandoned checkout clears itself like the other kinds',
  /pendingTelehealth\?\.sessionId === session\.id/.test(SRC));
check('T10 the client card promises the refund BEFORE they pay',
  /you get every dollar back/.test(CASE));
check('T11 and says he never records the provider\'s visit',
  /never record your provider's visit/.test(CASE));
check('T12 the Case Enhancements tab exists and hosts all three cards',
  // The pill stays short for the 390px strip; the pane h2 carries the name.
  /id: 'addons', title: 'Enhance'/.test(CASE)
  && /<h2 class="case-sec-h">Case Enhancements<\/h2>/.test(CASE)
  && /function renderAddons/.test(CASE)
  && /data-telehealth/.test(CASE) && /data-followup/.test(CASE) && /data-upgrade/.test(CASE));
check('T13 Docs no longer hosts the purchase cards',
  !/renderDocs[\s\S]{0,900}data-upgrade/.test(CASE.match(/function renderDocs[\s\S]*?\n\}/)[0]));
check('T14 the booking flow previews the enhancements without selling them',
  /Case Enhancements, once your case starts/.test(BOOK) && /Nothing to decide\s+now/.test(BOOK));
check('T15 the admin card carries confirm and deny, wired to the route',
  /data-telehealth="confirm"/.test(ADMIN) && /\/api\/admin\/telehealth/.test(ADMIN));
check('T16 the demo drives the whole loop',
  /'\/api\/telehealth'/.test(DEMO) && /'\/api\/admin\/telehealth'/.test(DEMO));

// ---- extensions: 30 days at a time, finally purchasable ----
// (Eric, 2026-08-25: "Once THIS is booked, they can choose to add 30 days
// at a time under the same tab." Until this round FULL_EXTEND was a priced
// constant with no route and fullAccessExtraDays had no writer.)
check('E1 the extend route exists and is tier-only',
  /async function handleExtendCheckout/.test(SRC)
  && /Extensions are part of Hands-Off Case Management\./.test(SRC));
check('E2 the webhook stacks 30 days, idempotent by sessionId',
  /async function confirmExtensionPurchase/.test(SRC)
  && /fullAccessExtraDays: newDays/.test(SRC)
  && /\(Number\(c\.data\.fullAccessExtraDays\) \|\| 0\) \+ 30/.test(SRC)
  && /payments\.some\(\(x\) => x\.sessionId === session\.id\)\) return;/.test(SRC));
check('E3 an abandoned extension checkout clears itself',
  /kind === 'extend' && session\.metadata\.caseId/.test(SRC)
  && /pendingExtend: null/.test(SRC));
check('E4 the card lives under Case Enhancements, states and all',
  /data-extend/.test(CASE) && /function extendOffer/.test(CASE)
  && /data-buy-extend/.test(CASE) && /extended=1/.test(SRC));
check('E5 the client window mirror adds the bought days',
  /function windowEndOf/.test(CASE)
  && /60 \+ \(Number\(c\.fullAccessExtraDays\) \|\| 0\)/.test(CASE));
check('E6 the demo drives the purchase and the days really stack',
  /'\/api\/extend'/.test(DEMO)
  && /fullAccessExtraDays: \(Number\(c\.fullAccessExtraDays\) \|\| 0\) \+ 30/.test(DEMO));

// ---- the copy that had to change ----
check('W1 tier terms no longer close the case at any call',
  !/which is where we close the case/.test(TIER) && !/closes the case/.test(TIER));
check('W2 tier terms promise the cadence and make it unskippable',
  // Eric, 2026-08-25: minimum twice a month, the client does not get to
  // skip them, and a missed one is never a refund basis.
  /Check-in calls, at least twice a month/.test(TIER)
  && /you do not get to go without checking in/.test(TIER)
  && /never a basis for a refund/.test(TIER));
check('W3 the agreement says guarantees are not part of it, verbatim',
  /Guarantees of any sort are not part of this agreement\./.test(TERMS)
  && /fulfilled to the best of my ability/.test(TERMS));
check('W4 the agreement says the closure reason is written into the case',
  /the reason is written into your case/.test(TERMS));
check('W5 the worker constants match the $3,500 decision',
  /const FULL_PRICE_CENTS = 350000;/.test(SRC)
  && /const FULL_CAP_CENTS = 500000;/.test(SRC)
  && /const FULL_EXTEND = \{ 30: 175000, 60: 275000 \};/.test(SRC));
check('W6 the one client fallback left moved with it; booking compiles no tier price',
  // Booking sells one service now, so the tier price lives only where the
  // tier is sold: the upgrade card on the case page.
  /let fullAccessCents = 350000;/.test(CASE)
  && !/FULL_PRICE_CENTS/.test(BOOK));
check('W7 the landing page sells with the value math and his phrase',
  (() => {
    const idx = readFileSync(`${ROOT}/public/index.html`, 'utf8');
    return /5 years' worth of boots on the ground experience/.test(idx)
      && /per appeal<\/em> elsewhere/.test(idx)
      && /data-rate="full"/.test(idx);
  })());

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
