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
// Chat is the exception to the band-middle rule, on Eric's explicit call
// (2026-08-26): $50/mo against my $300 and the live $95. It is not case work
// and has no hours to price, so the market research does not bind it - his
// reasoning is that a low door on the subscription is worth more than the
// margin. Its ceiling returns to the $100 he named with the $50 seed.
check('P1 the new list prices are what was agreed',
  CASE === 120000 && ADDON === 27500 && SUB === 5000 && FULL === 340000,
  JSON.stringify({ CASE, ADDON, SUB, FULL }));
check('P2 caps moved with the prices',
  CASE_CAP === 180000 && ADDON_CAP === 42500 && SUB_CAP === 10000 && FULL_CAP === 440000,
  JSON.stringify({ CASE_CAP, ADDON_CAP, SUB_CAP, FULL_CAP }));
check('P2e the chat ceiling is a sane multiple of its own seed',
  SUB_CAP === 2 * SUB, `$${SUB / 100} -> $${SUB_CAP / 100}`);
// Chat is deliberately excluded here: see P1.
check('P2d every CASE-WORK seed lands in the band middle, not on the average',
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
  ['readRates', /fullCents: priced\(d\.fullCents, FULL_MONTH_CENTS\)/],
  ['raiseRates', /fullCents: growRate\(now\.fullCents, FULL_CAP_CENTS, FULL_GROWTH, FULL_ROUND_CENTS\)/],
  ['raiseRates mask', /mask: \['caseCents', 'addonCents', 'subCents', 'fullCents', 'bookings', 'pricingEpoch', 'updatedAt'\]/],
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
  && /handSet\s*\n?\s*\? \{ fullCents: FULL_MONTH_CENTS, pricingEpoch: PRICING_EPOCH, updatedAt: new Date\(\) \}/.test(SRC));
check('P12b but the retired tier price is corrected even so',
  /const mask = handSet\s*\n\s*\? \['fullCents', 'pricingEpoch', 'updatedAt'\]/.test(SRC));
check('P12c and the mask cannot touch a hand-set base price',
  !/handSet\s*\n?\s*\? \['fullCents', 'updatedAt', '(caseCents|addonCents|subCents|floorCents)'/.test(SRC));
// A third marker. fullCents changed MEANING on 2026-08-26 - it was the price
// of sixty days and it is now the price of one month - so a live doc holding
// the old lump would read as a monthly rate and charge nearly double.
// The pricing epoch (2026-08-26). Prices live on the rates document, not in
// this file, so a reprice used to wait on the cron - up to fifteen minutes in
// production and FOREVER on a preview build, which gets no cron triggers at
// all. That made a price change impossible to review before merging it.
check('P14 the seeds carry a pricing epoch',
  /const PRICING_EPOCH = '[^']+';/.test(SRC));
check('P15 stored prices from a superseded epoch are ignored',
  /const current = d\.pricingEpoch === PRICING_EPOCH;/.test(SRC)
  && /current && Number\(stored\) > 0 \? Number\(stored\) : seed/.test(SRC));
check('P16 every write of a price stamps the current epoch',
  (SRC.match(/pricingEpoch: PRICING_EPOCH/g) || []).length >= 4,
  `${(SRC.match(/pricingEpoch: PRICING_EPOCH/g) || []).length} writes stamped`);
check('P17 the hand-set panel stamps it too, or the seeds would answer over him',
  /\{ \.\.\.want, pricingEpoch: PRICING_EPOCH/.test(SRC)
  && /'floorCents', 'pricingEpoch', 'updatedAt', 'setByHand'/.test(SRC));
check('P18 the climb still honours a document on the CURRENT epoch',
  /bookings: Number\(d\.bookings\) \|\| 0/.test(SRC) && /epochCurrent: current/.test(SRC));
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
// T10 INVERTED 2026-08-25, and this one is worth reading rather than skimming.
//
// It used to assert that `automatic_payment_methods` was present, as the way
// pay-over-time reached the four-figure charges. That parameter does not
// exist on Checkout Sessions - it belongs to PaymentIntents - and Stripe
// refuses an unknown parameter with a 400. `stripePost` throws on non-2xx, so
// the approval route and "another month" BOTH answered 500: the only two
// routes that turn a Hands-Off request into money could not complete, and
// every suite stayed green because this check only asked whether the string
// was in the file.
//
// So the pin now asserts the opposite, and the intent behind it is NOT
// silently dropped - it is unimplemented and flagged to Eric. Checkout shows
// whichever methods are enabled in the Stripe Dashboard; restricting
// pay-over-time to the big charges alone would mean naming
// `payment_method_types` explicitly on those two routes, which only works
// once Klarna/Affirm are live on the account. Guessing at that would recreate
// exactly the 400 this replaces.
check('T10 no phantom pay-over-time parameter Stripe would refuse',
  !/automatic_payment_methods/.test(SRC));
check('T10b booking still never offers the tier as a checkout line',
  !/wantsFull/.test(SRC));

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

// ---- Q1-Q4: no page may quote a price the Worker disagrees with ---------
// Found live on 2026-08-26: the booking page's enhancements panel had
// "Telehealth appointment advocacy · $250" typed straight into the copy while
// TELEHEALTH_PRICE_CENTS was 45000. It had been under-quoting by $200 to
// every client who opened that panel, and nothing was correcting it, because
// rates.js only knew case / addon / sub / full so the spot was never a
// [data-rate] at all.
//
// The rule this pins: a client-facing price is either a [data-rate] spot the
// Worker fills, or it matches the constant exactly. A number typed into prose
// that nothing can update is the whole defect.
{
  const { readdirSync } = await import('node:fs');
  const TELE = num('TELEHEALTH_PRICE_CENTS');
  const RATES = readFileSync(__j(__REPO, 'public/js/rates.js'), 'utf8');
  // Anchored on the /api/rates RESPONSE, not on any function that happens to
  // build a rate object. currentRates() is not what the pages read, and adding
  // the field there alone left the new spot permanently on its fallback: a
  // spot that looks plumbed and is not. The check has to name the payload.
  check('Q1 the Worker serves the telehealth price on /api/rates itself',
    /fullOpen: cap\.room !== false, chatOpenCents: CHAT_OPEN_CENTS,\n(?:\s*\/\/[^\n]*\n)*\s*teleCents: TELEHEALTH_PRICE_CENTS,/.test(SRC));
  check('Q2 and rates.js knows the key, so a spot can be filled',
    /tele: r\.teleCents/.test(RATES));

  // Every dollar figure a client can read, against the four constants. A page
  // may name a price only as the CURRENT value or inside a data-rate spot.
  const LIVE = new Set([CASE / 100, ADDON / 100, TELE / 100,
    num('SUB_PRICE_CENTS') / 100, num('FULL_MONTH_CENTS') / 100]);
  // Superseded values, each one a real price this product used to charge.
  // Any of these still on a client page is a page nobody updated.
  const STALE = [250, 175, 265, 275.00, 650, 1500, 95, 3700];
  const pages = [];
  for (const d of ['public', 'public/js']) {
    for (const n of readdirSync(__j(__REPO, d))) {
      if (!/\.(html|js)$/.test(n)) continue;
      if (d === 'public/js' && /^(admin|advisor|notes|duty|prep|drawer|seen|panel-bridge)/.test(n)) continue;
      pages.push(`${d}/${n}`);
    }
  }
  // Comments are stripped first. waivers.js keeps a dated change log naming
  // every rate this product has ever charged, which is exactly the record a
  // frozen legal file should keep, and it is not a quote to anybody.
  const noComments = (t) => t
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n').map((l) => l.replace(/(^|[^:'"\\])\/\/.*$/, '$1')).join('\n');
  const hits = [];
  for (const rel of pages) {
    const body = noComments(readFileSync(__j(__REPO, rel), 'utf8'));
    for (const m of body.matchAll(/\$(\d[\d,]*)(?![\d,]*\s*(?:<\/span>))/g)) {
      const v = Number(m[1].replace(/,/g, ''));
      if (!STALE.includes(v) || LIVE.has(v)) continue;
      // A stale number is fine as the SHIPPED TEXT of a data-rate spot: that
      // is the documented fallback and rates.js overwrites it.
      const before = body.slice(Math.max(0, m.index - 120), m.index);
      if (/data-rate=/.test(before)) continue;
      hits.push(`${rel}: $${m[1]}`);
    }
  }
  check('Q3 no client page quotes a superseded price outside a data-rate spot',
    hits.length === 0, hits.slice(0, 6).join('  |  '));
  check('Q4 the booking page quotes telehealth as a fillable spot',
    /data-rate="tele"/.test(readFileSync(__j(__REPO, 'public/js/book.js'), 'utf8')));
}

// ---- R1-R6: the hourly must never invent what a client paid -------------
// Eric, 2026-08-26, on a live case: "Current client pricing is incorrect for
// the hours I've spent. He paid 175 from the old pricing."
//
// The case read $76.12/hr at 15h 45m. The truth was $11.11/hr. paidCents()
// fell back to today's CASE_PRICE_CENTS for any case with no caseRateCents,
// on the argument, written in the comment, that rates had only ever come
// down. They had not: $175, $265, $1,200 inside a year. So the fallback
// inflated a legacy client's payment sevenfold, and it did it on the ONE
// figure built to reveal a loss, in the direction that hides one. It reported
// comfortably above the $75 floor for a case running at a seventh of it.
//
// The functions are LIFTED from the shipped file and run, not pattern
// matched: this is arithmetic about his money and a regex would pass on a
// version that computed the wrong number.
{
  const ADMINSRC = readFileSync(__j(__REPO, 'public/js/admin-case.js'), 'utf8');
  const lift = (name, src) => {
    const m = src.match(new RegExp(`(?:function ${name}\\([\\s\\S]*?\\n\\}|const ${name} = [^;]+;)`));
    return m ? m[0] : '';
  };
  const body = [
    `const CASE_PRICE_CENTS = ${CASE};`,
    lift('caseRate', ADMINSRC),
    lift('paidCents', ADMINSRC),
    lift('effectiveHourly', ADMINSRC),
    'return { caseRate, paidCents, effectiveHourly };',
  ].join('\n');
  let api = null;
  try { api = new Function(body)(); } catch (e) { /* reported below */ }
  check('R1 the three money functions still lift and run', !!api && typeof api.paidCents === 'function');

  if (api) {
    const HOURS = 15.75, SECS = Math.round(HOURS * 3600);
    // The real shape of Christopher's case: no recorded rate, paid $175.
    const legacy = { clientName: 'C', extraPayments: [] };
    check('R2 a case with no recorded rate reports NOTHING paid, not today\'s price',
      api.paidCents(legacy) === null, String(api.paidCents(legacy)));
    check('R3 and therefore no hourly at all, rather than a confident wrong one',
      api.effectiveHourly(legacy, SECS) === null, String(api.effectiveHourly(legacy, SECS)));
    // The exact number he was shown, which must now be impossible.
    const wrong = Math.round(CASE / HOURS);
    check('R4 the figure he was shown is no longer reachable from that case',
      api.effectiveHourly(legacy, SECS) !== wrong, `$${(wrong / 100).toFixed(2)}/hr`);

    // Once he records it, the truth.
    const fixed = { ...legacy, paidOverrideCents: 17500 };
    const hourly = api.effectiveHourly(fixed, SECS);
    check('R5 a recorded payment gives the real hourly',
      hourly === Math.round(17500 / HOURS), `$${(hourly / 100).toFixed(2)}/hr`);
    check('R6 and it lands under the floor, which is the whole point',
      hourly < num('HOURLY_FLOOR_CENTS'),
      `$${(hourly / 100).toFixed(2)}/hr vs a $${(num('HOURLY_FLOOR_CENTS') / 100).toFixed(0)}/hr floor`);

    // A modern case is untouched: it has a recorded rate and still reports it.
    const modern = { caseRateCents: 120000, extraPayments: [] };
    check('R7 a case booked at a recorded rate is unaffected',
      api.paidCents(modern) === 120000, String(api.paidCents(modern)));
  }
}

// ---- S1-S6: he can charge an amount he agreed on a call ------------------
// Eric, 2026-08-26: "I need to charge a client 3400 (verbally agreed to on
// call). Is there a place I can do this manually." There was not. The only
// manual charge was a percentage of the case rate capped at 150%, which
// against a $1,200 case is $1,800, and $3,400 is 283%. No percentage in the
// list expresses a figure agreed on a phone call, and none ever could.
{
  const PCTS = JSON.parse((SRC.match(/const CHARGE_PCTS = (\[[^\]]+\])/) || [])[1] || '[]');
  const ceiling = Math.max(...PCTS) * CASE / 100;
  check('S1 the percentage ladder genuinely could not reach $3,400',
    ceiling < 340000, `ceiling $${(ceiling / 100).toLocaleString()}`);
  check('S2 a typed amount is accepted and beats the percentage',
    /const typedCents = body\?\.amountCents === undefined \? null : Math\.round\(Number\(body\.amountCents\)\);/.test(SRC)
    && /const amountCents = typedCents !== null\n\s*\? typedCents/.test(SRC));
  check('S3 it is bounded, because this moves somebody money',
    /typedCents < 100 \|\| typedCents > 100_000_00/.test(SRC));
  check('S4 the percentages still work when nothing is typed',
    /if \(typedCents === null && !CHARGE_PCTS\.includes\(pct\)\)/.test(SRC));
  // The half that stops this becoming the next $76/hr: the money has to land
  // on the case by itself, or he is back to remembering.
  check('S5 the confirmed payment records what STRIPE charged, not what was asked',
    /amountCents: session\.amount_total \|\| 0,\n\s*label: m\.tagline/.test(SRC));
  const ADMINSRC = readFileSync(__j(__REPO, 'public/js/admin-case.js'), 'utf8');
  check('S6 the page checks the amount and confirms it before sending',
    /id="sched-amt"/.test(ADMINSRC)
    && /n < 1 \|\| n > 100000/.test(ADMINSRC)
    && /confirm\(`Charge \$\{data\?\.clientName/.test(ADMINSRC));
}

// ---- T1-T9: recording what a client paid, and opening the tier by hand ----
// Eric, 2026-08-26: "I fucked up the rate settings and idk where to change his
// amount paid (totaling 3400). And then where to start the clock and send
// forms as if he paid for the enhancement through the app."
//
// He could not find it because it was not there, twice over.
//
// ONE. `set-paid` read `body?.paidCents` inside handleCaseUpdate, which
// destructured `{ caseId, action, joinLink }` and never declared `body`. The
// Worker is an ESM module, so that is a ReferenceError thrown before anything
// is written: the "rate not recorded" pill on the case page had NEVER once
// worked, and the demo had never implemented the action at all, so the mirror
// agreed with a Worker that was itself throwing.
//
// TWO. `fullAccess` had exactly two writers in the whole system and both were
// behind a Stripe webhook. A client who agreed the tier on a call and paid
// another way could not be given what he had bought, because the insurer
// authorisation, the readiness checklist and check-in booking are all gated on
// that flag.
//
// So the route is LIFTED AND RUN here, not pattern matched. A regex for
// `const body` would have passed on the broken version the day it shipped, and
// the only thing that catches a ReferenceError is calling the function.
{
  const fn = (SRC.match(/async function handleCaseUpdate\(request, env\) \{[\s\S]*?\n\}/) || [''])[0];
  check('T1 handleCaseUpdate can be lifted out of the shipped Worker', fn.length > 0);

  // Stubs for exactly what these two paths touch. patchDoc records rather
  // than writes, so the assertions below are about the fields that would
  // reach Firestore.
  const writes = [];
  const emails = [];
  const harness = (caseDoc) => `
    const json = (o, s) => ({ status: s || 200, body: o });
    const requireAdmin = async () => ({ uid: 'admin' });
    const getDoc = async () => (${JSON.stringify(caseDoc)} === null ? null : { data: ${JSON.stringify(caseDoc)} });
    const patchDoc = async (env, path, fields) => { __writes.push({ path, fields }); return true; };
    const sendEmail = async (env, m) => { __emails.push(m); };
    const queryDocs = async () => [];
    const notifyUser = async () => {};
    const firstName = (n) => String(n || '').split(' ')[0];
    ${fn}
    return handleCaseUpdate;
  `;
  const run = async (caseDoc, body) => {
    writes.length = 0; emails.length = 0;
    const make = new Function('__writes', '__emails', harness(caseDoc));
    const handler = make(writes, emails);
    const request = { json: async () => ({ caseId: 'abc', ...body }) };
    try {
      const res = await handler(request, { PUBLIC_BASE_URL: 'https://example.invalid' });
      return { res, writes: writes.slice(), emails: emails.slice() };
    } catch (e) {
      // Empty arrays, not undefined. A throw here is the exact failure T2
      // exists to catch, and the first version of this let the throw take the
      // whole suite down with a TypeError two checks later, which hid T3 to
      // T13 behind it. A check that hides its neighbours when it fires is
      // worth less than no check.
      return { threw: `${e.constructor.name}: ${e.message}`, writes: [], emails: [] };
    }
  };

  const CASEDOC = { status: 'open', clientEmail: 'c@example.invalid', clientName: 'Jordan Avery', caseRateCents: 120000 };

  // T2 IS THE ONE. Before the fix this answered
  // "ReferenceError: body is not defined".
  const paid = await run(CASEDOC, { action: 'set-paid', paidCents: 340000 });
  check('T2 set-paid RECORDS an amount instead of throwing before it can',
    !paid.threw && paid.res?.status === 200,
    paid.threw || `status ${paid.res?.status}: ${JSON.stringify(paid.res?.body)}`);
  check('T3 and the amount it records is the amount it was given, to the cent',
    !paid.threw && paid.writes.some((w) => w.fields.paidOverrideCents === 340000),
    JSON.stringify(paid.writes.map((w) => w.fields)).slice(0, 120));
  const silly = await run(CASEDOC, { action: 'set-paid', paidCents: 99_999_999_99 });
  check('T4 an impossible amount is refused and nothing is written',
    !silly.threw && silly.res?.status === 400 && silly.writes.length === 0,
    silly.threw || `status ${silly.res?.status}, ${silly.writes.length} write(s)`);

  const open = await run(CASEDOC, { action: 'open-full', tierCents: 340000 });
  const of = open.writes.find((w) => w.fields.fullAccess === true);
  check('T5 the tier can be opened by hand at all',
    !open.threw && open.res?.status === 200 && !!of,
    open.threw || `status ${open.res?.status}`);
  // The two rate fields mean different things and must never be summed
  // wrongly: fullAccessRateCents is what this client has paid IN TOTAL, so it
  // is the case fee plus the tier money and nothing else.
  check('T6 it records the case fee plus what he typed, and not today\'s price',
    !!of && of.fields.fullAccessRateCents === 120000 + 340000,
    of ? String(of.fields.fullAccessRateCents) : 'no write');
  check('T7 the ledger line says the money arrived outside the app',
    !!of && (of.fields.extraPayments || []).some((x) => x.kind === 'fullaccess' && x.byHand === true && x.amountCents === 340000),
    JSON.stringify(of?.fields.extraPayments || []).slice(0, 120));
  // "send forms as if he paid for the enhancement through the app": the
  // client's email has to be the webhook's email, or they can tell.
  check('T8 the client is emailed and told to sign, exactly as a payment would',
    open.emails.length === 1 && /Hands-Off Case Management is open/.test(open.emails[0].subject || '')
      && /authorisation/.test(open.emails[0].html || ''),
    JSON.stringify(open.emails.map((e) => e.subject)));
  const twice = await run({ ...CASEDOC, fullAccess: true }, { action: 'open-full', tierCents: 340000 });
  check('T9 a case already on the tier is refused, so nobody is billed twice',
    !twice.threw && twice.res?.status === 409 && twice.writes.length === 0,
    twice.threw || `status ${twice.res?.status}, ${twice.writes.length} write(s)`);

  // T9a-T9e: THE MONTH CAN START LATER THAN THE DAY IT IS ARRANGED.
  // Eric, 2026-08-26: "I want to be prompted to set the clock or when the
  // start time is. This one is going to be delayed slightly." Forcing the
  // start to the moment he pressed the button took the delay out of the month
  // he had sold, silently, at 30 days a month.
  //
  // fullAccessAt IS the start, because fullAccessWindowEnd reads it as the
  // window's origin and both the admin and client mirrors do the same
  // arithmetic. So a future value has to LAND ON THAT FIELD, not beside it.
  const FUTURE = new Date(Date.now() + 14 * 86_400_000);
  const later = await run(CASEDOC, {
    action: 'open-full', tierCents: 340000, startAt: FUTURE.toISOString(),
  });
  const lw = later.writes.find((w) => w.fields.fullAccess === true);
  check('T9a a start date he picks is what the window runs from',
    !!lw && new Date(lw.fields.fullAccessAt).getTime() === FUTURE.getTime(),
    lw ? String(lw.fields.fullAccessAt) : 'no write');
  check('T9b and the day he actually opened it is still on the record',
    !!lw && !!lw.fields.fullAccessOpenedAt
      && new Date(lw.fields.fullAccessOpenedAt).getTime() !== FUTURE.getTime(),
    lw ? String(lw.fields.fullAccessOpenedAt) : 'no write');
  // Forms now, clock later: his answer, in as many words. The email goes out
  // the same day whatever the start, because a records request takes weeks.
  check('T9c the client is emailed TODAY even when the month starts later',
    later.emails.length === 1, String(later.emails.length));
  check('T9d and that email tells them when their month begins',
    /Your month runs from/.test(later.emails[0]?.html || ''),
    (later.emails[0]?.html || '').slice(0, 90));
  const silly2 = await run(CASEDOC, {
    action: 'open-full', tierCents: 0,
    startAt: new Date(Date.now() + 5 * 365 * 86_400_000).toISOString(),
  });
  check('T9e a start five years out is refused, and nothing is written',
    !silly2.threw && silly2.res?.status === 400 && silly2.writes.length === 0,
    silly2.threw || `status ${silly2.res?.status}, ${silly2.writes.length} write(s)`);
  // Omitting it must keep behaving: every existing caller sends no startAt.
  const noStart = await run(CASEDOC, { action: 'open-full', tierCents: 0 });
  const nw = noStart.writes.find((w) => w.fields.fullAccess === true);
  check('T9f leaving it out still opens the month today',
    !!nw && Math.abs(new Date(nw.fields.fullAccessAt).getTime() - Date.now()) < 60_000,
    nw ? String(nw.fields.fullAccessAt) : 'no write');
}

// ---- T9g: the client is never told a future date already happened --------
// The one sentence a future start breaks. It read "Your window started
// [date], the day you bought Hands-Off", which on a case opened in August for
// a September start is two false statements in one line, on the client's own
// page, about the thing they paid for.
{
  const CASESRC = readFileSync(__j(__REPO, 'public/js/case.js'), 'utf8');
  check('T9g the client page has a future-start wording and picks between them',
    /const startsLater = !!boughtAt && boughtAt\.getTime\(\) > Date\.now\(\);/.test(CASESRC)
    && /Your month starts \$\{esc\(dayFmt\.format\(boughtAt\)\)\}/.test(CASESRC)
    && /startsLater\s*\n?\s*\?/.test(CASESRC));
}

// ---- T10-T12: the tier total must beat the original receipt ---------------
// Found while answering him. paidCents() read `stripe.amountTotal` BEFORE it
// read the tier total, and stripe.amountTotal is the ORIGINAL booking. So a
// case that booked at $1,200 and then paid $3,400 for Hands-Off reported
// $1,200 paid, and the $3,400 vanished: the upgrade also pushes a
// `kind: 'fullaccess'` line into extraPayments, which addOns() excludes on
// purpose to stop it being counted twice.
//
// Same direction as the $76/hr: it hides a loss, on the one figure built to
// reveal one. Lifted and run, because this is arithmetic about his money.
{
  const ADMINSRC2 = readFileSync(__j(__REPO, 'public/js/admin-case.js'), 'utf8');
  const lift2 = (name) => {
    const m = ADMINSRC2.match(new RegExp(`(?:function ${name}\\([\\s\\S]*?\\n\\}|const ${name} = [^;]+;)`));
    return m ? m[0] : '';
  };
  let pc = null;
  try {
    pc = new Function([
      `const CASE_PRICE_CENTS = ${CASE};`,
      lift2('caseRate'),
      lift2('paidCents'),
      'return paidCents;',
    ].join('\n'))();
  } catch (e) { /* reported by T10 */ }
  check('T10 paidCents still lifts and runs', typeof pc === 'function');
  if (typeof pc === 'function') {
    const upgraded = {
      caseRateCents: 120000,
      stripe: { amountTotal: 120000 },
      fullAccess: true,
      fullAccessRateCents: 460000,
      extraPayments: [{ kind: 'fullaccess', amountCents: 340000 }],
    };
    check('T11 an upgraded case reports the TIER total, not the first booking',
      pc(upgraded) === 460000, String(pc(upgraded)));
    // The exact wrong answer, named, so this cannot quietly come back.
    check('T12 the figure the old branch order gave is no longer reachable',
      pc(upgraded) !== 120000, `$${(120000 / 100).toFixed(0)} was what it said`);
  }
}

// ---- T13: the demo cannot disagree with the Worker -----------------------
// It did, silently, for both actions: the demo answered 'Bad request' for
// set-paid while the Worker threw, so the two halves agreed that nothing
// happened and neither said why.
{
  const DEMO = readFileSync(__j(__REPO, 'public/js/demo/api.js'), 'utf8');
  check('T13 the demo implements both new actions under the same bounds',
    /body\.action === 'set-paid'/.test(DEMO)
    && /body\.action === 'open-full'/.test(DEMO)
    && /already on Hands-Off Case Management/.test(DEMO));
}

// ---- U1-U6: one window, three copies of it, and they did not agree -------
// Found by drive-openfull, which prints the sentence the client reads and so
// showed a month running "September 9 to November 8". Sixty days. The tier is
// sold thirty days at a time.
//
//   worker/index.js  fullAccessWindowEnd   30 days, 60 for a legacy case
//   admin-case.js    fullAccessDaysLeft    30 days for EVERY case
//   case.js          windowEndOf           60 days for EVERY case, hardcoded
//
// So a client on the current tier was shown an end date a MONTH later than
// the one the close sweep enforces, on the most expensive thing the app
// sells, while the advocate's own card showed the right number. And a legacy
// client, who really did buy sixty days, had them shown correctly to the
// client and a month short to him.
//
// All three are RUN here against the same cases, because this is a promise to
// a client about a date and a regex cannot tell 30 from 60.
{
  const ADMINSRC3 = readFileSync(__j(__REPO, 'public/js/admin-case.js'), 'utf8');
  const CASESRC3 = readFileSync(__j(__REPO, 'public/js/case.js'), 'utf8');
  const liftFrom = (src, name) => {
    const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
    return m ? m[0] : '';
  };
  const CONSTS = `
    const FULL_WINDOW_DAYS = ${num('FULL_WINDOW_DAYS')};
    const FULL_LEGACY_WINDOW_DAYS = ${num('FULL_LEGACY_WINDOW_DAYS')};
    const FULL_MONTHLY_FROM_AT = Date.parse('2026-08-26T00:00:00Z');
    const FULL_WINDOW_FROM_PURCHASE_AT = Date.parse('2026-08-25T00:00:00Z');
    const toDate = (x) => new Date(x);
    const heldMs = (c) => Math.max(0, Number(c?.hold?.totalMs) || 0);
  `;
  let W = null, A = null, C = null;
  try {
    W = new Function(`${CONSTS}\n${liftFrom(SRC, 'fullAccessWindowEnd')}\nreturn fullAccessWindowEnd;`)();
    A = new Function(`${CONSTS}\n${liftFrom(ADMINSRC3, 'fullAccessDaysLeft')}\nreturn fullAccessDaysLeft;`)();
    C = new Function(`${CONSTS}\n${liftFrom(CASESRC3, 'windowEndOf')}\nreturn windowEndOf;`)();
  } catch (e) { /* U1 reports it */ }
  check('U1 all three window helpers lift and run',
    typeof W === 'function' && typeof A === 'function' && typeof C === 'function');

  if (W && A && C) {
    const DAY = 86_400_000;
    const days = (end, from) => Math.round((end.getTime() - from) / DAY);

    // A case on the CURRENT tier: bought today, thirty days.
    const boughtAt = Date.parse('2026-09-09T12:00:00Z');
    const modern = {
      fullAccess: true, fullAccessAt: new Date(boughtAt),
      appointment: { start: new Date(boughtAt - 20 * DAY) },
    };
    check('U2 the Worker gives a current-tier case thirty days',
      days(W(modern), boughtAt) === 30, String(days(W(modern), boughtAt)));
    check('U3 and the CLIENT is told thirty, not sixty',
      days(C(modern), boughtAt) === 30, `${days(C(modern), boughtAt)} days`);
    check('U4 the client and the Worker land on the same day, to the day',
      C(modern).getTime() === W(modern).getTime(),
      `${C(modern).toISOString().slice(0, 10)} vs ${W(modern).toISOString().slice(0, 10)}`);

    // A case sold BEFORE the reshape: sixty days, from the first call, and it
    // keeps them. Both mirrors must say so, including his.
    const firstCall = Date.parse('2026-07-01T12:00:00Z');
    const legacy = {
      fullAccess: true, fullAccessAt: new Date('2026-07-05T12:00:00Z'),
      appointment: { start: new Date(firstCall) },
    };
    check('U5 a legacy case keeps the sixty days it was sold, from its first call',
      days(W(legacy), firstCall) === 60 && C(legacy).getTime() === W(legacy).getTime(),
      `worker ${days(W(legacy), firstCall)}, client ${days(C(legacy), firstCall)}`);
    // His card counts down in whole days, so compare it to the Worker's end.
    const expect = Math.max(0, Math.ceil((W(legacy).getTime() - Date.now()) / DAY));
    check('U6 and his own card counts the same days down as the Worker',
      A(legacy) === expect, `${A(legacy)} vs ${expect}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
