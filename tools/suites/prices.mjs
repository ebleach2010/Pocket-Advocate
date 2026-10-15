// prices.mjs - his prices, from his settings, live at once.
//
// Eric, 2026-10-15: "Change the price of the mid tier to $2000. In the
// settings tab for admin let me adjust price for each effective immediately."
// Then: "*2100".
//
// The Worker's setter, the climb and the settings parser are lifted and RUN.
// The copy is read for any price typed where a live one belongs, because a
// typed price is the one that goes stale the moment he saves a new one.
//
// Run: node prices.mjs
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync } from 'node:fs';
import { SERVICE_ABOUT, PRICE_SEEDS, priced } from '../../public/js/service-about.js';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const W = f('worker/index.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
function fn(src, name, isAsync = false) {
  const m = src.match(new RegExp(`\\n(?:export )?${isAsync ? 'async ' : ''}function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0].replace('export ', '');
}
const konst = (name) => (W.match(new RegExp(`\\nconst ${name} = [^;]+;`)) || [''])[0];
const num = (name) => Number((konst(name).match(/= ([\d_]+);/) || [])[1]?.replace(/_/g, ''));

// ---------------------------------------------------------------------------
console.log('\n--- A. the case is $2,100, live on deploy ---');
{
  // NEGATIVE CONTROL (run 2026-10-15): PRICING_EPOCH left at '2026-09-02-cap-and-raise' made this read
  //   FAIL  A1 the case seed is $2,100 under a new pricing stamp, so the deploy itself moves the price
  check('A1 the case seed is $2,100 under a new pricing stamp, so the deploy itself moves the price',
    num('CASE_PRICE_CENTS') === 210000 && /const PRICING_EPOCH = '2026-10-15-case-2100';/.test(W)
    && num('ADDON_PRICE_CENTS') === 32500 && num('SUB_PRICE_CENTS') === 5000 && num('FULL_MONTH_CENTS') === 440000);

  const pages = ['public/advocacy-case.html', 'public/index.html', 'public/stats.html', 'public/services.html', 'public/js/fit.js'];
  const spots = pages.flatMap((p) => [...f(p).matchAll(/data-rate="case">([^<]*)</g)].map((m) => `${p}:${m[1]}`));
  // NEGATIVE CONTROL (run 2026-10-15): the home card's case spot left at $1,200 made this read
  //   FAIL  A2 every case price spot ships $2,100, and the two pages that hold a fallback copy hold 210000
  check('A2 every case price spot ships $2,100, and the two pages that hold a fallback copy hold 210000',
    spots.length >= 5 && spots.every((s) => s.endsWith(':$2,100'))
    && /const CASE_PRICE_CENTS = 210000;/.test(f('public/js/book.js'))
    && /const CASE_PRICE_CENTS = 210000;/.test(f('public/js/admin-case.js')),
    spots.join(' | '));
}

// ---------------------------------------------------------------------------
console.log('\n--- B. a price he sets stays his ---');
{
  const consts = ['RATE_GROWTH', 'RATE_ROUND_CENTS', 'CASE_CAP_CENTS', 'ADDON_CAP_CENTS', 'SUB_STEP_CENTS', 'SUB_CAP_CENTS']
    .map(konst).join('\n');
  const { growRate, subStep, CASE_CAP_CENTS } = new Function(`${consts}\n${fn(W, 'growRate')}\n${fn(W, 'subStep')}\nreturn { growRate, subStep, CASE_CAP_CENTS };`)();
  // NEGATIVE CONTROL (run 2026-10-15): growRate's `if (cents >= cap) return cents;` taken out made this read
  //   FAIL  B1 a booking never pulls a price down: one set above its ceiling stays put, one below still climbs, and the chat climb does the same
  check('B1 a booking never pulls a price down: one set above its ceiling stays put, one below still climbs, and the chat climb does the same',
    growRate(210000, CASE_CAP_CENTS) === 210000 && growRate(180000, CASE_CAP_CENTS) === 180000
    && growRate(120000, CASE_CAP_CENTS) === 132000 && growRate(175000, CASE_CAP_CENTS) === 180000
    && subStep(5000) === 5500 && subStep(10000) === 10000 && subStep(15000) === 15000,
    JSON.stringify([growRate(210000, CASE_CAP_CENTS), growRate(120000, CASE_CAP_CENTS), subStep(15000)]));
  // NEGATIVE CONTROL (run 2026-10-15): raiseSubRate's step put back to `Math.min(SUB_CAP_CENTS, now.subCents + SUB_STEP_CENTS)` made this read
  //   FAIL  B2 both climbs use the guarded steps
  check('B2 both climbs use the guarded steps',
    /subCents: subStep\(now\.subCents\),/.test(W) && /const subCents = subStep\(now\.subCents\);/.test(W)
    && !/Math\.min\(SUB_CAP_CENTS, now\.subCents \+ SUB_STEP_CENTS\)/.test(W));
}

// ---------------------------------------------------------------------------
console.log('\n--- C. the setter takes his numbers ---');
{
  // handleSetRates, run against a stand-in for the database.
  const consts = ['RATE_MIN_CENTS', 'RATE_MAX_CENTS', 'SUB_RAIL_MAX_CENTS', 'SUB_CAP_CENTS', 'CASE_CAP_CENTS', 'ADDON_CAP_CENTS',
    'FULL_CAP_CENTS', 'PRICING_EPOCH', 'RATES_PATH', 'TELEHEALTH_PRICE_CENTS', 'FULL_INCLUDED_HOURS'].map(konst).join('\n');
  const run = async (body, admin = true) => {
    const writes = [];
    const set = new Function('requireAdmin', 'readRates', 'patchDoc', 'json', `${consts}\n${fn(W, 'handleSetRates', true)}\nreturn handleSetRates;`)(
      async () => admin,
      async () => ({ caseCents: 210000, addonCents: 32500, subCents: 5000, fullCents: 440000, floorCents: 7500, bookings: 3 }),
      async (_env, path, data, opts) => { writes.push({ path, data, opts }); return true; },
      (data, status = 200) => ({ status, data }));
    const res = await set({ json: async () => body }, {});
    return { res, writes };
  };
  const high = await run({ caseCents: 250000, fullCents: 600000, subCents: 15000, addonCents: 40000, floorCents: 8000 });
  const low = await run({ caseCents: 4000 });
  const same = await run({ caseCents: 210000 });
  const stranger = await run({ caseCents: 250000 }, false);
  // NEGATIVE CONTROL (run 2026-10-15): RATE_MAX_CENTS put back to 440000 made this read
  //   FAIL  C1 he can set any of the five above the old limits, a typo still bounces, an unchanged save writes nothing, and a stranger finds no route
  check('C1 he can set any of the five above the old limits, a typo still bounces, an unchanged save writes nothing, and a stranger finds no route',
    high.res.status === 200 && high.res.data.changed === true && high.writes.length === 1
    && high.writes[0].path === 'config/rates' && high.writes[0].data.caseCents === 250000 && high.writes[0].data.fullCents === 600000
    && high.writes[0].data.subCents === 15000 && high.writes[0].data.pricingEpoch === '2026-10-15-case-2100' && high.writes[0].data.setByHand === true
    && low.res.status === 400 && /caseCents has to be a whole number of cents between 5000 and 2000000\./.test(low.res.data.error) && low.writes.length === 0
    && same.res.data.changed === false && same.writes.length === 0
    && stranger.res.status === 404 && stranger.writes.length === 0,
    JSON.stringify({ high: high.res.status, low: low.res.data, same: same.res.data.changed, stranger: stranger.res.status }));
}

// ---------------------------------------------------------------------------
console.log('\n--- D. the settings cog ---');
{
  const S = f('public/js/admin-settings.js');
  const toCents = new Function(`${fn(S, 'toCents')}\nreturn toCents;`)();
  // NEGATIVE CONTROL (run 2026-10-15): toCents' decimal limit widened to `\d+` made this read
  //   FAIL  D1 a price typed the way he would type it reads as whole cents, and anything else is refused
  check('D1 a price typed the way he would type it reads as whole cents, and anything else is refused',
    toCents('2,100') === 210000 && toCents('$2100.00') === 210000 && toCents(' 50 ') === 5000 && toCents('21.5') === 2150
    && Number.isNaN(toCents('abc')) && Number.isNaN(toCents('1.234')) && Number.isNaN(toCents('')) && Number.isNaN(toCents('-50')));
  const keys = [...S.matchAll(/data-price="(\w+)"/g)].map((m) => m[1]);
  const wire = fn(S, 'wirePrices', true);
  // NEGATIVE CONTROL (run 2026-10-15): wirePrices' first read (`paint(await call());`) taken out made this read
  //   FAIL  D2 the cog has the five prices, disabled until the server has said what they are, saved to the same route and painted from its answer
  check('D2 the cog has the five prices, disabled until the server has said what they are, saved to the same route and painted from its answer',
    keys.join() === 'subCents,caseCents,fullCents,addonCents,floorCents'
    && keys.every((k) => new RegExp(`data-price="${k}" disabled>`).test(S))
    && /<h4 style="margin:1\.2rem 0 \.1rem;">Prices<\/h4>/.test(S) && /data-prices-save disabled/.test(S)
    && /wirePrices\(overlay, user\);/.test(S)
    && /try \{\s*paint\(await call\(\)\);/.test(wire) && /const r = await call\(want\);\s*paint\(r\);/.test(wire)
    && /fetch\('\/api\/admin\/rates'/.test(wire) && /paint\(confirmed\);/.test(wire)
    && /Live the moment you save/.test(S) && /keeps the\s+price they paid/.test(S));
  const A = f('public/js/admin.js');
  // NEGATIVE CONTROL (run 2026-10-15): an `id="rate-save"` button put back on the Clients page made this read
  //   FAIL  D3 prices live in one place: the Clients page no longer carries or reads them, and the ceiling ping points at settings
  check('D3 prices live in one place: the Clients page no longer carries or reads them, and the ceiling ping points at settings',
    !/rate-save|rateBlock|\/api\/admin\/rates/.test(A)
    && /It stays parked there until you set the next move under Prices in your settings\./.test(W)
    && !/rates card on your dashboard/.test(W));
}

// ---------------------------------------------------------------------------
console.log('\n--- E. no price typed where a live one belongs ---');
{
  const typed = /\$(?:1,200|2,100|4,400|325)\b|\$50\/mo/;
  const strings = Object.values(SERVICE_ABOUT).flatMap((a) => [a.price, a.tldr, ...a.paragraphs, ...a.bullets]).filter(Boolean);
  const found = strings.filter((t) => typed.test(t));
  const seeds = { case: num('CASE_PRICE_CENTS'), sub: num('SUB_PRICE_CENTS'), full: num('FULL_MONTH_CENTS'), addon: num('ADDON_PRICE_CENTS') };
  const fmt = (c) => `$${(c / 100).toLocaleString('en-US')}`;
  // NEGATIVE CONTROL (run 2026-10-15): the case sheet's price typed back as '$2,100, once' made this read
  //   FAIL  E1 the About copy carries its prices as live spots, seeded with the Worker's own seeds, and both renderers fill them
  check('E1 the About copy carries its prices as live spots, seeded with the Worker\'s own seeds, and both renderers fill them',
    found.length === 0
    && SERVICE_ABOUT.case.price === '{case}, once' && SERVICE_ABOUT.chat.price === '{sub}/mo'
    && Object.entries(seeds).every(([k, c]) => PRICE_SEEDS[k] === fmt(c))
    && priced('One flat {case}.') === 'One flat <span data-rate="case">$2,100</span>.'
    && /import\('\.\/rates\.js'\)\.then\(\(m\) => m\.paintRates\(overlay\)\)/.test(f('public/js/service-about.js'))
    && /import\('\.\/rates\.js'\)\.then\(\(m\) => m\.paintRates\(body\)\)/.test(f('public/js/package-page.js'))
    && (f('public/js/service-about.js').match(/priced\(esc\(/g) || []).length === 4
    && (f('public/js/package-page.js').match(/priced\(esc\(/g) || []).length === 3,
    found.join(' | '));
  const D = f('public/js/demo/api.js');
  // NEGATIVE CONTROL (run 2026-10-15): the demo's store write (`store.docs.set('config/rates', want)`) taken out made this read
  //   FAIL  E2 the demo keeps a saved price and every page reads it back, with the Worker's rails and words
  check('E2 the demo keeps a saved price and every page reads it back, with the Worker\'s rails and words',
    /const SEEDS = \{ caseCents: 210000, addonCents: 32500, subCents: 5000, fullCents: 440000, floorCents: 7500 \};/.test(D)
    && /if \(changed\) \{ store\.docs\.set\('config\/rates', want\); store\.persist\?\.\(\); \}/.test(D)
    && /\.\.\.\(store\.docs\.get\('config\/rates'\) \|\| \{\}\)/.test(D)
    && /: \[5000, 2000000\];/.test(D) && /has to be a whole number of cents between \$\{min\} and \$\{max\}\./.test(D));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const r of failed) console.log(`  FAILED: ${r.name}`);
  process.exit(1);
}
