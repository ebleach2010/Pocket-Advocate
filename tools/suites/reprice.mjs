// reprice.mjs — run the tier reprice migration for real, both ways.
// Regex assertions cannot tell you what a hand-set doc actually ends up
// holding. This runs the function.
// Repo-rooted: this file runs from tools/suites/ inside the repository, so
// the sources it asserts against are found relative to itself, wherever the
// repo is checked out.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';
const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

const body = SRC.match(/async function restructureRates\(env\)[\s\S]*?\n\}/)[0];
const num = (n) => Number((SRC.match(new RegExp(`const ${n} = (\\d+)`)) || [])[1]);
const CONST = {
  CASE_PRICE_CENTS: num('CASE_PRICE_CENTS'), ADDON_PRICE_CENTS: num('ADDON_PRICE_CENTS'),
  SUB_PRICE_CENTS: num('SUB_PRICE_CENTS'), FULL_MONTH_CENTS: num('FULL_MONTH_CENTS'),
  HOURLY_FLOOR_CENTS: num('HOURLY_FLOOR_CENTS'), RATES_PATH: 'config/rates',
};

// Read the marker out of the source rather than typing it: it changes every
// time the rates doc changes shape, and a suite asserting a stale one passes
// while testing nothing.
const MARKER = SRC.match(/MARKER = '(migrations\/reprice-[^']+)'/)[1];

async function run(rates) {
  const docs = new Map([['config/rates', { ...rates }]]);
  const deps = {
    getDoc: async (env, p) => (docs.has(p) ? { data: { ...docs.get(p) }, updateTime: '1' } : null),
    patchDoc: async (env, p, data, opts = {}) => {
      const cur = docs.get(p) || {};
      if (opts.mustNotExist && docs.has(p)) return false;
      const next = { ...cur };
      for (const k of (opts.mask || Object.keys(data))) if (k in data) next[k] = data[k];
      docs.set(p, next);
      return true;
    },
    console: { error: () => {} },
  };
  const fn = new Function(...Object.keys(deps), ...Object.keys(CONST),
    `${body}; return restructureRates;`)(...Object.values(deps), ...Object.values(CONST));
  await fn({});
  return { rates: docs.get('config/rates'), marker: docs.get(MARKER) };
}

console.log(`constants: month=${CONST.FULL_MONTH_CENTS} case=${CONST.CASE_PRICE_CENTS}\n`);

// 1. Untouched doc: everything is restructured.
let out = await run({ caseCents: 26500, addonCents: 7500, subCents: 5000, fullCents: 350000 });
check('R1 a doc nobody has touched gets the full restructure',
  out.rates.caseCents === CONST.CASE_PRICE_CENTS && out.rates.fullCents === CONST.FULL_MONTH_CENTS,
  JSON.stringify(out.rates));

// 2. THE ONE THAT MATTERS. He fixed the chat price on his dashboard, which
//    stamps setByHand. His numbers must survive; the dead tier price must not.
out = await run({ caseCents: 65000, addonCents: 17500, subCents: 5000, fullCents: 350000, setByHand: true });
check('R2 his hand-set chat price survives', out.rates.subCents === 5000, `subCents=${out.rates.subCents}`);
check('R3 his hand-set case price survives', out.rates.caseCents === 65000, `caseCents=${out.rates.caseCents}`);
check('R4 his hand-set follow-up survives', out.rates.addonCents === 17500, `addonCents=${out.rates.addonCents}`);
// Now more important than ever: fullCents used to be the price of SIXTY DAYS
// and is now the price of ONE MONTH. A hand-set number chosen for the old
// unit is not a choice worth preserving - left alone it would read as a
// monthly rate and charge nearly double.
check('R5 a tier price chosen for the OLD unit is corrected anyway',
  out.rates.fullCents === CONST.FULL_MONTH_CENTS, `fullCents=${out.rates.fullCents}`);
check('R6 setByHand is not cleared behind his back', out.rates.setByHand === true);
check('R7 the marker records what it did', /only the retired tier price moved/.test(out.marker?.result || ''),
  out.marker?.result || '(none)');
check('R7b the marker in the source is the one this suite drives',
  /reprice-2026-08-26-monthly/.test(MARKER), MARKER);

// 3. Idempotent: a finished marker means it never runs twice.
{
  const docs = new Map([
    ['config/rates', { fullCents: 999 }],
    [MARKER, { finishedAt: new Date(), result: 'done' }],
  ]);
  const deps = {
    getDoc: async (e, p) => (docs.has(p) ? { data: { ...docs.get(p) }, updateTime: '1' } : null),
    patchDoc: async (e, p, d, o = {}) => { const c = docs.get(p) || {}; const n = { ...c };
      for (const k of (o.mask || Object.keys(d))) if (k in d) n[k] = d[k]; docs.set(p, n); return true; },
    console: { error: () => {} },
  };
  const fn = new Function(...Object.keys(deps), ...Object.keys(CONST),
    `${body}; return restructureRates;`)(...Object.values(deps), ...Object.values(CONST));
  await fn({});
  check('R8 a finished marker means it never fires again', docs.get('config/rates').fullCents === 999);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
