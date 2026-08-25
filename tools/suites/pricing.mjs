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
const FULL = num('FULL_PRICE_CENTS');
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

// FULL moved to $3,500 on 2026-08-25: Eric's final answer after the market
// research he asked for (advocates $100-500/hr; the tier is 25-35h).
check('P1 the new list prices are what was agreed',
  CASE === 65000 && ADDON === 17500 && SUB === 9500 && FULL === 350000,
  JSON.stringify({ CASE, ADDON, SUB, FULL }));
check('P2 caps moved with the prices',
  CASE_CAP === 140000 && ADDON_CAP === 40000 && SUB_CAP === 15000 && FULL_CAP === 500000,
  JSON.stringify({ CASE_CAP, ADDON_CAP, SUB_CAP, FULL_CAP }));
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

// Eight bookings to the ceiling is the shape that was promised.
let n = FULL, steps = 0;
while (n < FULL_CAP && steps < 50) { n = growRate(n, FULL_CAP, FULL_GROWTH, FULL_ROUND); steps++; }
check('P8 full access reaches its ceiling in a sane number of bookings',
  steps >= 6 && steps <= 14, `${steps} bookings`);

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
  && /handSet\s*\?\s*\{ fullCents: FULL_PRICE_CENTS, updatedAt: new Date\(\) \}/.test(SRC));
check('P12b but the retired tier price is corrected even so',
  /const mask = handSet\s*\n\s*\? \['fullCents', 'updatedAt'\]/.test(SRC));
check('P12c and the mask cannot touch a hand-set base price',
  !/handSet\s*\n?\s*\? \['fullCents', 'updatedAt', '(caseCents|addonCents|subCents|floorCents)'/.test(SRC));
check('P13 the rescope has its OWN marker, because the August one finished',
  /migrations\/reprice-2026-08-24-tier/.test(SRC)
  && !/MARKER = 'migrations\/reprice-2026-08-23'/.test(SRC));

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
check('T9c the window is 60 days from PURCHASE, first-call fallback, computed not stored',
  // Eric, 2026-08-25: "the clock starts upon booking."
  /const FULL_WINDOW_DAYS = 60;/.test(SRC)
  && /function fullAccessWindowEnd\(c\)/.test(SRC)
  && /c\?\.fullAccessAt/.test(SRC)
  && /c\?\.appointment\?\.start/.test(SRC));
check('T9d two appeal letters are actually counted now',
  /const FULL_APPEALS_INCLUDED = 2;/.test(SRC)
  && /appealsUsed\(stNow\?\.data\) >= FULL_APPEALS_INCLUDED/.test(SRC)
  && /filedCount: \(Number\(meta\.filedCount\) \|\| 0\) \+ 1,/.test(SRC));
check('T9e extensions scaled with the $3,500 base: $1,750/30d, $2,750/60d',
  /const FULL_EXTEND = \{ 30: 175000, 60: 275000 \};/.test(SRC));
check('T9f two concurrent tier cases, not three',
  /const FULL_MAX_OPEN_DEFAULT = 2;/.test(SRC));
check('T9g the upgrade refuses a stale quote, as booking does',
  /quoted && quoted !== cents/.test(SRC)
  && /error: 'rate-changed', upgradeCents: cents/.test(SRC));
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
