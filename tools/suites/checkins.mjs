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
  /mask: \['status', 'closedAt', 'closedBy', 'closedReason', 'hold', 'pendingExtend'\]/.test(SRC));
check('C15b closing a case also kills any open extension checkout',
  (SRC.match(/pendingExtend: null,\n\s*\}, \{ mask: \['status'/g) || []).length >= 1
  || /'closedReason', 'pendingExtend'\]/.test(SRC),
  'an open Stripe session on a closed case was still payable');
check('C16 the old private closedNote write is gone',
  !/closedNote:/.test(SRC));
check('C17 the legacy reasonless close action is retired, not silently kept',
  /Closing moved: use the Pause \/ close card/.test(SRC));
// The refusal sentence lost its em dash and became two sentences (2026-08-26,
// the no-em-dash rule). Same words, same two claims: write it, and the client
// reads it. Pinned as two halves so the punctuation between them can move
// again without this going red over something nobody cares about.
check('C18 the admin form says the client reads it, and refuses empty',
  /the client reads this, word for word/i.test(ADMIN)
  && /Write the reason first[.:,]?\s+[Tt]he client reads it word for word\./.test(ADMIN));
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
// $250 -> $450 in the 2026-08-26 market recalibration: 1.5-2h of prep, visit
// and debrief priced against the $250/hr URGENT rate, because he attends live.
check('T3 a standard case pays the flat constant, off the ratchet',
  /const TELEHEALTH_PRICE_CENTS = 45000;/.test(SRC)
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
check('E2 the webhook stacks a month, idempotent by sessionId',
  /async function confirmExtensionPurchase/.test(SRC)
  && /fullAccessExtraDays: newDays/.test(SRC)
  && /fullAccessMonths: months/.test(SRC)
  && /\(Number\(c\.data\.fullAccessExtraDays\) \|\| 0\) \+ lapsedDays \+ FULL_MONTH_DAYS/.test(SRC)
  && /payments\.some\(\(x\) => x\.sessionId === session\.id\)\) return;/.test(SRC));
check('E2b a lapsed window is credited first, so 30 days really is 30 days',
  /const lapsedDays = prevEnd/.test(SRC)
  && /Math\.ceil\(\(Date\.now\(\) - prevEnd\.getTime\(\)\) \/ 86_400_000\)/.test(SRC));
check('E3 an abandoned extension checkout clears itself',
  /kind === 'extend' && session\.metadata\.caseId/.test(SRC)
  && /pendingExtend: null/.test(SRC));
check('E4 the card lives under Case Enhancements, states and all',
  /data-extend/.test(CASE) && /function extendOffer/.test(CASE)
  && /data-buy-extend/.test(CASE) && /extended=1/.test(SRC));
// UPDATED 2026-08-26, not deleted. This check's intent is that a bought
// extension really stretches the window the CLIENT is shown, and that still
// holds and is still checked below. What it ALSO pinned, by accident, was the
// literal `60 +`. The mirror hardcoded sixty days for every case while the
// Worker gives a case bought after the monthly reshape thirty, so a client on
// the current tier was shown an end date a month later than the close sweep
// actually enforces. Pinning the source text of a number is how a wrong
// number acquires a guard.
//
// The base now comes from the same rule the Worker uses. The real check is
// U1 to U6 in pricing.mjs, which RUNS all three implementations of this window
// against the same cases instead of reading them.
// UPDATED AGAIN 2026-08-26, and this is the second time, which is the tell.
// Its intent is one thing: whatever the base window is, days a client BOUGHT
// stack on top of it. That is checked below and has never changed. What keeps
// breaking is the half that pinned the source text of how the base is chosen,
// which has now moved twice: first when the hardcoded sixty became the
// Worker's rule, and now because an agreed length (fullAccessDays) wins over
// both. So that half is dropped rather than re-pinned to a third spelling.
//
// The base itself is covered where it belongs, by checks that RUN all three
// window helpers against the same cases: pricing.mjs U1-U6 for the rule and
// A1-A7 for the agreed length. A regex cannot tell 14 from 30 from 60.
check('E5 the client window mirror adds the bought days on top of the base',
  /function windowEndOf/.test(CASE)
  && /const days = base \+ \(Number\(c\.fullAccessExtraDays\) \|\| 0\);/.test(CASE));
check('E6 the demo drives the purchase and the days really stack',
  /'\/api\/extend'/.test(DEMO)
  && /fullAccessExtraDays: \(Number\(c\.fullAccessExtraDays\) \|\| 0\) \+ 30/.test(DEMO));

// ---- the About sheets + the readiness checklist (Eric, 2026-08-25) ----
const ABOUT = readFileSync(`${ROOT}/public/js/service-about.js`, 'utf8');
const READY = readFileSync(`${ROOT}/public/js/readiness.js`, 'utf8');
const { SERVICE_ABOUT } = await import(`${ROOT}/public/js/service-about.js`);
check('AB1 the About module carries all six services, each fully shaped',
  ['case', 'chat', 'handsOff', 'extension', 'followup', 'telehealth']
    .every((k) => {
      const a = SERVICE_ABOUT[k];
      return a && a.title && a.tldr && a.paragraphs?.length && a.bullets?.length;
    }));
check('AB2 Hands-Off says he does the legwork, in those words',
  /I do the legwork/.test(ABOUT));
check('AB3 and that he writes appeals when a doctor will not cooperate',
  /If a doctor will not cooperate/.test(ABOUT) && /I write the appeal/.test(ABOUT));
// WHY THIS CHECK IS SHAPED THIS WAY (2026-08-26).
// It used to end in /addAbout\(/ against case.js, which proved only that a
// particular short name still appeared somewhere in the file. It would have
// passed on a page whose About buttons all opened nothing.
//
// It now asserts the thing that matters: each of the four enhancement cards
// must ask for an About sheet BY NAME, and every name it asks for must be a
// sheet the About module actually carries. A typo'd id now fails here instead
// of shipping a button that opens an empty panel.
//
// Anchored on the CALL SITES, with their arguments. An earlier draft matched
// the bare function name and passed against a renamed call, because the same
// pattern also matches the function's own DECLARATION on the line
// `function addAboutButton(host, id)` - it was reading the definition and
// reporting it as the wiring. A declaration carries no string argument, so
// requiring one cannot make that mistake again.
check('AB4 the About buttons are wired on the services page and every enhancement card',
  (() => {
    // MOVED 2026-08-26 with the site split: the three service About buttons
    // were cut out of index.html and now live on services.html, beside the
    // packs they explain. wireAboutButtons has to be on that same page or the
    // buttons render and open nothing, which is the exact failure this line
    // exists to catch.
    const idx = readFileSync(`${ROOT}/public/services.html`, 'utf8');
    const onLanding = /data-about="case"/.test(idx) && /data-about="handsOff"/.test(idx)
      && /data-about="chat"/.test(idx) && /wireAboutButtons/.test(idx);
    // Every id handed to an About call, however the call is spelled.
    const asked = [...CASE.matchAll(/addAbout(?:Button)?\([^,]+,\s*'([^']+)'\)/g)]
      .map((m) => m[1]);
    const need = ['telehealth', 'followup', 'handsOff', 'extension'];
    const wired = need.every((k) => asked.includes(k))
      && asked.every((k) => SERVICE_ABOUT[k]);
    return onLanding && wired;
  })());
check('AB5 the readiness checklist is DERIVED on both sides, never stored',
  /export function handsOffReadiness/.test(READY)
  && /from '\.\/readiness\.js'/.test(CASE)
  && /from '\.\/readiness\.js'/.test(ADMIN)
  && !/handsOffChecklist/.test(SRC));
// The em dash before it became a full stop (2026-08-26, the no-dash rule), so
// the sentence now starts with a capital. Same words; the article is matched
// either way so punctuation can move again without this going red.
check('AB6 the client reads the honest clock sentence beside the checklist',
  /[Tt]he clock runs whether or not this list is done/.test(CASE));

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
// The tier went MONTHLY on 2026-08-26 and the seed moved to market. There is
// no lump price any more, so there is no FULL_PRICE_CENTS to pin - the unit
// is a month, and another month costs exactly what the first one did.
check('W5 the worker constants match the monthly decision',
  /const FULL_MONTH_CENTS = 340000;/.test(SRC)
  && /const FULL_CAP_CENTS = 440000;/.test(SRC)
  && /const FULL_EXTEND = \{ 30: FULL_MONTH_CENTS \};/.test(SRC)
  && !/FULL_PRICE_CENTS/.test(SRC));
check('W6 the one client fallback left moved with it; booking compiles no tier price',
  // Booking sells one service now, so the tier price lives only where the
  // tier is sold: the request card on the case page. A MONTHLY number since
  // 2026-08-26, matching FULL_MONTH_CENTS in the Worker.
  /let fullAccessCents = 340000;/.test(CASE)
  && !/FULL_PRICE_CENTS/.test(BOOK));
// WHY THIS CHECK MOVED (2026-08-26, with the split into a real site).
// It read all three of these off index.html, because until now index.html WAS
// the whole marketing site: one page, eight screens, eight topics. Eric asked
// for "more website like territory", so Services, Questions and Contact each
// got their own page and the pricing blocks were cut out of the landing and
// moved to services.html VERBATIM.
//
// So the check follows the copy rather than being deleted or loosened to "is
// this string anywhere on the site". It still names which page each thing must
// be on, which is the stronger assertion: his own line has to survive on the
// page a stranger lands on, and the value math has to survive on the page that
// actually sells. A move to the wrong page still fails here.
check('W7 the landing sells with his phrase, and the value math is on the services page',
  (() => {
    const idx = readFileSync(`${ROOT}/public/index.html`, 'utf8');
    const svc = readFileSync(`${ROOT}/public/services.html`, 'utf8');
    // His words, on the page a stranger arrives at.
    const hisPhrase = /5 years' worth of boots on the ground experience/.test(idx);
    // The comparison that justifies the tier price, where the tier is sold.
    const valueMath = /per appeal<\/em> elsewhere/.test(svc) && /data-rate="full"/.test(svc);
    // And the landing still has to NAME the tier and its live price, or the
    // split would have quietly hidden the most expensive thing he sells.
    const onLanding = /data-rate="full"/.test(idx) && /Hands-Off Case Management/.test(idx);
    return hisPhrase && valueMath && onLanding;
  })());

// ---- X1-X6: a cadence cannot be overdue before the month begins ---------
// Eric, 2026-08-26, opening Hands-Off by hand for a client whose month starts
// later: "This one is going to be delayed slightly."
//
// Both copies of the cadence anchored on c.appointment.start, the original
// advocacy call, which on a hand-opened case is usually weeks old. So the
// moment he pressed the button, the shelf painted CHECK-IN DUE and pulled the
// case into the overview list, and it stayed there for the entire wait,
// telling him to book a check-in for an engagement that had not started.
//
// LIFTED AND RUN, both copies, against the same cases. The rule lives in two
// files and a regex cannot tell whether they agree.
{
  const TO_DATE = 'function toDate(v){ if(!v) return new Date(0); if(v.toDate) return v.toDate(); return new Date(v); }';
  const lift = (src, sig) => {
    const m = src.match(new RegExp(`${sig}[\\s\\S]*?\\n\\}`));
    return m ? m[0] : '';
  };
  let shelf = null, chart = null;
  try {
    shelf = new Function(`${TO_DATE}\n${lift(SHELF, 'function checkInDue\\(c\\) \\{')}\nreturn checkInDue;`)();
    chart = new Function(`${TO_DATE}\nconst CHECKIN_DAYS = 14;\n${lift(ADMIN, 'function checkInState\\(c\\) \\{')}\nreturn checkInState;`)();
  } catch (e) { /* W1 reports it */ }
  check('X1 both copies of the cadence lift and run',
    typeof shelf === 'function' && typeof chart === 'function');

  if (shelf && chart) {
    const DAY = 86_400_000;
    const base = {
      fullAccess: true, status: 'awaiting_report', checkIns: [],
      appointment: { start: new Date(Date.now() - 20 * DAY) },
    };
    // The case he is actually opening: agreed today, month starts in a
    // fortnight, one advocacy call three weeks back.
    const notYet = { ...base, fullAccessAt: new Date(Date.now() + 14 * DAY) };
    check('X2 the shelf does not flag a month that has not started',
      shelf(notYet) === false, String(shelf(notYet)));
    check('X3 and neither does the chart',
      chart(notYet)?.due === false, JSON.stringify(chart(notYet)));

    // Once it HAS started and run two weeks with no check-in, it is due, or
    // the fix would have turned the flag off altogether.
    const running = { ...base, fullAccessAt: new Date(Date.now() - 20 * DAY) };
    check('X4 a month that has run a fortnight with no check-in IS due',
      shelf(running) === true, String(shelf(running)));
    check('X5 and the two copies agree about that',
      chart(running)?.due === true, JSON.stringify(chart(running)));

    // A booked check-in in the future still silences it, on both.
    const booked = { ...running, checkIns: [{ start: new Date(Date.now() + 3 * DAY) }] };
    check('X6 a booked check-in silences both copies',
      shelf(booked) === false && chart(booked)?.due === false,
      `${shelf(booked)} / ${JSON.stringify(chart(booked))}`);
  }
}

// ---- X7: the signed form prints WITH the signature ----------------------
// public/js/admin-case.js asked the Worker for the ink with
// `encodeURIComponent(id)`. `id` is declared nowhere in that module; the
// binding is `caseId` (:145). It is an ES module, so that threw a
// ReferenceError before the fetch was ever made, EVERY time, and the catch
// below it swallowed the throw under a comment about printing without the
// mark. So every signed authority form printed with a blank signature and
// nothing said so. The sibling call fifty lines up had it right all along.
{
  check('X7 the print handler asks for the ink with a binding that exists',
    !/caseId=\$\{encodeURIComponent\(id\)\}/.test(ADMIN)
    && /caseId=\$\{encodeURIComponent\(caseId\)\}&id=\$\{encodeURIComponent\(item\.id\)\}/.test(ADMIN));
  // And it no longer fails silently, which is the half that let it live.
  check('X7b and a failure to fetch the ink is said out loud, not swallowed',
    /Printing without the signature/.test(ADMIN));
}

// ---- Z1-Z9: the renewal offer, and the notice the tier never had ---------
// Eric, 2026-08-26, on the "Keep going another month?" card: "Shouldn't that
// show maybe three days before their month ends?"
//
// It showed for the WHOLE month, from day one, with a four-figure price under
// it, and on a case opened for a delayed start it showed before the month had
// begun. But three days on its own would have cost him renewals, because
// there was NO warning email when a Hands-Off month ended: the card was the
// only notice and it worked by never going away. The follow-up session has
// had a week's warning all along; the most expensive thing he sells had none.
//
// So both halves are pinned together, and the card is LIFTED AND RUN at four
// points in the month rather than pattern matched, because "three days" is
// arithmetic and a regex cannot check arithmetic.
{
  const DAY = 86_400_000;
  const fn = (CASE.match(/function extendOffer\(c\) \{[\s\S]*?\n\}/) || [''])[0];
  check('Z1 the renewal card lifts out of the shipped file', fn.length > 0);
  let offer = null;
  try {
    offer = new Function(`
      const EXTEND_PRICE_CENTS = 340000;
      const EXTEND_OFFER_WITHIN_DAYS = 3;
      const esc = (x) => String(x);
      const toDate = (v) => (v && v.toDate ? v.toDate() : new Date(v));
      const livePendingExtend = (c) => c.pendingExtend || null;
      let extendJustPaid = false;
      const windowEndOf = (c) => (c.__end ? new Date(c.__end) : null);
      ${fn}
      return extendOffer;`)();
  } catch (e) { /* Z2 reports it */ }
  check('Z2 and runs', typeof offer === 'function');

  if (offer) {
    const at = (days, extra = {}) => offer({
      fullAccess: true, status: 'awaiting_report',
      __end: Date.now() + days * DAY, ...extra,
    });
    const shows = (html) => /Keep going another month\?/.test(html);
    check('Z3 twenty days out, the client is not being sold anything',
      !shows(at(20)), at(20).slice(0, 60));
    check('Z4 three days out, the offer is there',
      shows(at(3)), at(3).slice(0, 60) || '(nothing rendered)');
    // A delayed month has 44 days left, so his own rule hides it before the
    // month has begun. No separate rule needed for that case.
    check('Z5 a month that has not started yet shows nothing either',
      !shows(at(44)));
    // Renewing LATE has to keep working: the extension credits the lapsed
    // days, so a month bought after the end is still a full thirty days.
    check('Z6 after the window ends it is still offered, until the case closes',
      shows(at(-2)), at(-2).slice(0, 60) || '(nothing rendered)');
    // Fails OPEN: no computable end must never silently hide a renewal.
    check('Z7 a case with no end date still gets the offer',
      shows(offer({ fullAccess: true, status: 'awaiting_report' })));
    // A checkout in flight is a real thing happening and outranks the gate.
    check('Z8 a checkout already in flight still renders, twenty days out',
      /Finish checkout/.test(at(20, { pendingExtend: { url: 'https://x.invalid' } })));
  }
}

// ---- Z9-Z13: the week's notice itself ------------------------------------
{
  const DAY = 86_400_000;
  const fn = (SRC.match(/export async function runWindowWarnings[\s\S]*?\n\}/) || [''])[0];
  check('Z9 the warning pass exists', fn.length > 0);
  check('Z10 and is registered on the cron, beside its sibling',
    /ctx\.waitUntil\(runFollowUpWarnings\(env\)\);\s*\n\s*ctx\.waitUntil\(runWindowWarnings\(env\)\);/.test(SRC));
  // A once-only flag that is never cleared warns the FIRST month and no other.
  check('Z11 a renewal clears the flag, so every month gets its own notice',
    /windowEndWarned: null,/.test(SRC) && /'pendingExtend', 'windowEndWarned', 'extraPayments'\]/.test(SRC));

  const run = async (caseDoc) => {
    const sent = [], wrote = [];
    const harness = `
      const FULL_WINDOW_WARN_DAYS = 7;
      const queryDocs = async () => [{ id: 'c1', data: ${JSON.stringify(caseDoc)} }];
      const fullAccessWindowEnd = (c) => (c.__end ? new Date(c.__end) : null);
      const whenHtml = (d) => '<p>' + d.toISOString() + '</p>';
      const sendEmail = async (env, m) => { __sent.push(m); };
      const patchDoc = async (env, path, fields) => { __wrote.push(fields); };
      ${fn.replace('export async function', 'async function')}
      return runWindowWarnings;`;
    const f = new Function('__sent', '__wrote', harness)(sent, wrote);
    await f({ PUBLIC_BASE_URL: 'https://x.invalid' });
    return { sent, wrote };
  };
  const base = { status: 'awaiting_report', clientEmail: 'c@x.invalid' };
  const due = await run({ ...base, __end: Date.now() + 5 * DAY });
  check('Z12 a month five days out is warned, once, with the real end date',
    due.sent.length === 1 && /Hands-Off month ends next week/.test(due.sent[0].subject)
    && due.wrote.some((w) => w.windowEndWarned === true),
    `${due.sent.length} email(s)`);
  const early = await run({ ...base, __end: Date.now() + 20 * DAY });
  check('Z13 a month twenty days out is not warned yet', early.sent.length === 0);
  const gone = await run({ ...base, __end: Date.now() - DAY });
  check('Z14 a month already over gets no email after the fact', gone.sent.length === 0);
  const held = await run({ ...base, __end: Date.now() + 5 * DAY, hold: { pausedAt: new Date() } });
  check('Z15 a paused case is not running down, so it is not warned', held.sent.length === 0);
  const mid = await run({ ...base, __end: Date.now() + 5 * DAY, pendingExtend: { url: 'x' } });
  check('Z16 somebody mid-renewal is not told their month is ending', mid.sent.length === 0);
  const already = await run({ ...base, __end: Date.now() + 5 * DAY, windowEndWarned: true });
  check('Z17 and nobody is told twice', already.sent.length === 0);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
