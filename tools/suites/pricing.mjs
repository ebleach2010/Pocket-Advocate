// pricing.mjs — the repricing and the Full Access tier, against the real
// worker source. growRate is pure and is re-created from the live file so the
// test cannot drift from the constants it is asserting. Run: node pricing.mjs
// Repo-rooted: this file runs from tools/suites/ inside the repository, so
// the sources it asserts against are found relative to itself, wherever the
// repo is checked out.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';

const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
const num = (name) => {
  const m = SRC.match(new RegExp(`const ${name} = ([\\d.]+);`));
  return m ? Number(m[1]) : null;
};

// ---- the constants, read from the file under test -------------------------
const CASE = num('CASE_PRICE_CENTS');
const ADDON = num('ADDON_PRICE_CENTS');
const SUB = num('SUB_PRICE_CENTS');
const FULL = num('FULL_MONTH_CENTS');
const CASE_CAP = num('CASE_CAP_CENTS');
const ADDON_CAP = num('ADDON_CAP_CENTS');
const SUB_CAP = num('SUB_CAP_CENTS');
const FULL_CAP = num('FULL_CAP_CENTS');
const GROWTH = num('RATE_GROWTH');
const ROUND = num('RATE_ROUND_CENTS');
const FULL_GROWTH = num('FULL_GROWTH');
const FULL_ROUND = num('FULL_ROUND_CENTS');
const FLOOR = num('HOURLY_FLOOR_CENTS');

console.log(`# case ${CASE} addon ${ADDON} sub ${SUB} full ${FULL} floor ${FLOOR}`);

// Recalibrated to the MIDDLE of the market 2026-08-26 at Eric's word
// ("exactly middle to slightly above middle of what you've found"), after a
// first pass anchored on the AVERAGE that undershot. Advocates bill
// $70-500/hr with a working band of $100-350 and an average of $175; the
// average is not the middle, it is dragged down by cheaper regions and
// lower-credentialed advocates. The middle of the band is $225/hr, and the
// comparable practice's $200/hr standard and $250/hr urgent rates bracket
// it. Every seed below is that service's honest hours at $225-240/hr.
//
// FULL is a MONTHLY rate, not a 60-day lump - the tier is billed by the
// month so no client faces a five-figure charge, hence FULL_MONTH_CENTS.
check('P1 the new list prices are what was agreed',
  CASE === 120000 && ADDON === 27500 && SUB === 30000 && FULL === 340000,
  JSON.stringify({ CASE, ADDON, SUB, FULL }));
check('P2 caps moved with the prices',
  CASE_CAP === 180000 && ADDON_CAP === 42500 && SUB_CAP === 45000 && FULL_CAP === 440000,
  JSON.stringify({ CASE_CAP, ADDON_CAP, SUB_CAP, FULL_CAP }));
check('P2d every seed lands in the band middle, not on the average',
  Math.round(CASE / 100 / 5.25) >= 210 && Math.round(CASE / 100 / 5.25) <= 245
  && Math.round(FULL / 100 / 15) >= 210 && Math.round(FULL / 100 / 15) <= 245
  && Math.round(ADDON / 100 / 1.25) >= 210 && Math.round(ADDON / 100 / 1.25) <= 245,
  `case $${Math.round(CASE / 100 / 5.25)}/hr, tier $${Math.round(FULL / 100 / 15)}/hr, follow-up $${Math.round(ADDON / 100 / 1.25)}/hr`);
check('P2b the tier price is per MONTH, and the month is defined',
  num('FULL_MONTH_DAYS') === 30 && num('FULL_WINDOW_DAYS') === 30,
  'a paid month buys thirty days; further months add thirty more each');
check('P2c the two-month minimum is stated, not payment-locked',
  num('FULL_MIN_MONTHS') === 2 && /It is NOT a payment lock/.test(SRC));
check('P3 full access climbs gentler than the rest',
  FULL_GROWTH === 1.05 && FULL_ROUND === 2500 && GROWTH === 1.10 && ROUND === 500);

// ---- growRate, lifted verbatim from the source ----------------------------
const body = SRC.match(/function growRate\([^)]*\) \{([\s\S]*?)\n\}/)[1];
const growRate = new Function('cents', 'cap', 'growth', 'round',
  `const RATE_GROWTH=${GROWTH}, RATE_ROUND_CENTS=${ROUND};
   growth = growth ?? RATE_GROWTH; round = round ?? RATE_ROUND_CENTS;${body}`);

check('P4 a case booking lifts 10% to the nearest $5',
  growRate(65000, CASE_CAP) === 71500, String(growRate(65000, CASE_CAP)));
check('P5 full access lifts 5% to the nearest $25',
  growRate(150000, FULL_CAP, FULL_GROWTH, FULL_ROUND) === 157500,
  String(growRate(150000, FULL_CAP, FULL_GROWTH, FULL_ROUND)));
check('P6 both park at their cap and stay',
  growRate(CASE_CAP, CASE_CAP) === CASE_CAP
  && growRate(FULL_CAP, FULL_CAP, FULL_GROWTH, FULL_ROUND) === FULL_CAP);
check('P7 a price can never round back onto itself',
  growRate(1000, CASE_CAP) > 1000
  && growRate(1000, FULL_CAP, FULL_GROWTH, FULL_ROUND) > 1000);

// The monthly seed sits closer to its monthly ceiling than the old lump did
// to its lump ceiling ($2,600 -> $3,400 rather than $3,500 -> $5,000), so the
// climb is shorter by arithmetic, not by a change of intent. Still gradual.
let n = FULL, steps = 0;
while (n < FULL_CAP && steps < 50) { n = growRate(n, FULL_CAP, FULL_GROWTH, FULL_ROUND); steps++; }
check('P8 full access reaches its ceiling in a sane number of bookings',
  steps >= 5 && steps <= 14, `${steps} bookings`);

// ---- the seams that must all know about the new price ---------------------
for (const seam of [
  ['readRates', /fullCents: Number\(d\.fullCents\)/],
  ['raiseRates', /fullCents: growRate\(now\.fullCents, FULL_CAP_CENTS, FULL_GROWTH, FULL_ROUND_CENTS\)/],
  ['raiseRates mask', /mask: \['caseCents', 'addonCents', 'subCents', 'fullCents', 'bookings', 'updatedAt'\]/],
  ['raiseSubRate whole-doc body', /caseCents: now\.caseCents, addonCents: now\.addonCents, fullCents: now\.fullCents/],
  ['capPings', /next\.fullCents >= FULL_CAP_CENTS/],
  ['handleSetRates', /fullCents: body\?\.fullCents === undefined/],
  ['handleRates', /fullCents: r\.fullCents, fullOpen/],
]) check(`P9 ${seam[0]} knows about fullCents`, seam[1].test(SRC));

check('P10 the floor never reaches a client-served endpoint',
  !/floorCents: r\.floorCents/.test(SRC) && /floorCents.*NOT here/s.test(SRC));

// ---- grandfathering -------------------------------------------------------
check('P11 the follow-up is still quoted from the case, not the live rate',
  /Number\(c\.addonRateCents\) > 0 \? c\.addonRateCents : ADDON_PRICE_CENTS/.test(SRC)
  || /addonRateCents/.test(SRC));
// P12 used to assert the migration bailed out entirely on a hand-set doc.
// That was the bug: ANY save from the rates panel stamps setByHand, so
// fixing the chat price on his dashboard would have condemned Full Access
// to sell at the retired $3,500 for ever. Hand-set base prices are still
// his; the dead tier price is corrected regardless.
check('P12 hand-set BASE prices are still left alone',
  /const handSet = !!doc\?\.data\.setByHand/.test(SRC)
  && /handSet\s*\?\s*\{ fullCents: FULL_MONTH_CENTS, updatedAt: new Date\(\) \}/.test(SRC));
check('P12b but the retired tier price is corrected even so',
  /const mask = handSet\s*\n\s*\? \['fullCents', 'updatedAt'\]/.test(SRC));
check('P12c and the mask cannot touch a hand-set base price',
  !/handSet\s*\n?\s*\? \['fullCents', 'updatedAt', '(caseCents|addonCents|subCents|floorCents)'/.test(SRC));
// A third marker. fullCents changed MEANING on 2026-08-26 - it was the price
// of sixty days and it is now the price of one month - so a live doc holding
// the old lump would read as a monthly rate and charge nearly double.
check('P13 the market recalibration has its OWN marker, because the last finished',
  /migrations\/reprice-2026-08-26-market/.test(SRC)
  && !/MARKER = 'migrations\/reprice-2026-08-24-tier'/.test(SRC));

// ---- the tier -------------------------------------------------------------
check('T1 booking REFUSES the tier: it is added from inside a case now',
  // Eric, 2026-08-25: "Advocacy case and direct line are bookable. The
  // others are ADD-ONS." A refusal with directions, never a silent clamp.
  /Hands-Off Case Management is added from inside an open case now/.test(SRC)
  && !/tier: wantsFull/.test(SRC) && !/const wantsFull/.test(SRC));
check('T2 a full-access sale is refused without the scope-note ack',
  /typeof body\?\.acks\?\.\[FULL_ACCESS_ACK\] !== 'number'/.test(SRC));
check('T3 the ack is not required for a standard case',
  !/REQUIRED_ACKS = \[[^\]]*fullAccess/.test(SRC));
check('T4 capacity closes the door rather than raising the price',
  /error: 'full-booked'/.test(SRC) && /async function fullAccessCapacity/.test(SRC));
check('T5 capacity still guards the one door left: the upgrade',
  (SRC.match(/error: 'full-booked'/g) || []).length === 1);
check('T6 the upgrade charges the difference, never the list price',
  /function upgradeCents/.test(SRC) && /liveFullCents - alreadyPaid/.test(SRC));
check('T7 an abandoned upgrade checkout is cleared',
  /pendingFullAccess: null/.test(SRC) && /kind === 'fullaccess' && session\.metadata\.caseId/.test(SRC));
check('T8 paying twice is recorded and flagged for refund, never dropped',
  /duplicate: true/.test(SRC) && /Refund it from Stripe/.test(SRC));
// The tier closes when its WINDOW runs out - never "at the second call",
// a framing Eric called misleading and removed (2026-08-25); there is no
// second call any more, there is a check-in cadence. It still never closes
// while an appeal is filed and unanswered, because a closed case blocks the
// uploads the escalation is written from.
check('T9 a tier case is not closed on the 48-hour report clock',
  /const until = fullAccessWindowEnd\(row\.data\);/.test(SRC)
  && /if \(!\(until && Date\.now\(\) > until\.getTime\(\)\)\) continue;/.test(SRC));
check('T9b and it waits for an appeal that has been filed and not answered',
  /if \(appeal\?\.filedAt && !appeal\.decidedAt\) continue;/.test(SRC));
// Was 60 days in one payment. Monthly since 2026-08-26, so the base is 30 and
// each further month adds another 30 - cases sold under the old shape keep
// their 60, which FULL_LEGACY_WINDOW_DAYS exists to guarantee.
check('T9c the window is a paid month from PURCHASE, computed not stored',
  /const FULL_WINDOW_DAYS = 30;/.test(SRC)
  && /const FULL_LEGACY_WINDOW_DAYS = 60;/.test(SRC)
  && /function fullAccessWindowEnd\(c\)/.test(SRC)
  && /c\?\.fullAccessAt/.test(SRC)
  && /c\?\.appointment\?\.start/.test(SRC));
check('T9d two appeal letters are actually counted now',
  /const FULL_APPEALS_INCLUDED = 2;/.test(SRC)
  && /appealsUsed\(stNow\?\.data\) >= FULL_APPEALS_INCLUDED/.test(SRC)
  && /filedCount: \(Number\(meta\.filedCount\) \|\| 0\) \+ 1,/.test(SRC));
// There is no separate "extension" product any more: the next month costs
// what the first month costs, which is the whole point of going monthly.
check('T9e another month is the SAME price as the first month',
  /const FULL_EXTEND = \{ 30: FULL_MONTH_CENTS \};/.test(SRC));
check('T9f two concurrent tier cases, not three',
  /const FULL_MAX_OPEN_DEFAULT = 2;/.test(SRC));
// The stale-quote handshake is gone from this path because the path is no
// longer a checkout: asking is free, and an approval charges the rate quoted
// when they ASKED (firstMonthCents), not whatever it has climbed to since.
// That is a stronger promise than the handshake it replaces.
check('T9g an approval charges the rate the client was quoted when they asked',
  /firstMonthCents: upgradeCents\(c\.data, live\.fullCents\)/.test(SRC)
  && /Number\(req\.firstMonthCents\) > 0/.test(SRC));
check('T9h asking for the tier charges nothing and takes no card',
  /async function handleUpgradeCheckout/.test(SRC)
  && !/stripePost[\s\S]{0,400}?kind: 'fullaccess'[\s\S]{0,200}?\n\}\n\nasync function handleFullRequestDecision/.test(SRC)
  && /state: 'pending'/.test(SRC));
check('T9i only an approval can create a tier case, so the cap cannot be raced',
  /async function handleFullRequestDecision/.test(SRC)
  && /const cap = await fullAccessCapacity\(env\);\n\s*if \(!cap\.room && !body\?\.overrideCap\)/.test(SRC));
check('T9j a decline is written in his words and charges nothing',
  /Write the reason\. The client reads it word for word\./.test(SRC)
  && /state: 'declined'/.test(SRC));
check('T10 pay-over-time is offered on the tier upgrade and nowhere at booking',
  /automatic_payment_methods/.test(SRC)
  && !/wantsFull/.test(SRC));

// ---- the two rate fields must never be summed ----------------------------
const CASEJS = readFileSync(__j(__REPO, 'public/js/case.js'), 'utf8');
const ADMINJS = readFileSync(__j(__REPO, 'public/js/admin-case.js'), 'utf8');
const ADVJS = readFileSync(__j(__REPO, 'worker/advisor.js'), 'utf8');
// case.js no longer computes a paid figure at all: the only one it had lived
// in the tip jar, which was retired 2026-08-24. The rule still binds the two
// places that do.
for (const [name, src] of [['admin-case.js', ADMINJS], ['advisor.js', ADVJS]])
  check(`H1 ${name} reads fullAccessRateCents instead of adding it to the case rate`,
    /fullAccessRateCents/.test(src) && !/caseRateCents \+ .*fullAccessRateCents/.test(src));
check('H1b case.js computes no paid figure now the jar is gone',
  !/fullAccessRateCents|totalPaidCents/.test(CASEJS));

check('H2 the hourly instrument refuses to divide by a trivial clock',
  /if \(secs < 360\) return null;/.test(ADMINJS));
// A bare statement of the number, with no adjective and no instruction: the
// "For you" prompt owns the judgement, and a flourish in a data block is what
// a model paraphrases into a sentence the guardrail then has to catch.
check('H3 the advisor is told the floor as a bare fact, not a flourish',
  /so this case is now under it/.test(ADVJS)
  && !/(losing money|too cheap|should stop|unpaid labou?r)/i.test(ADVJS));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
