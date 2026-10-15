// drive-staffsettings.mjs - a contractor's own settings, in a real browser.
//
// Eric, 2026-10-15: "Contractors have controls in settings just like me."
// Walks the demo as Ana Rivera (the demo's contractor) and as him:
//   A. her cog holds her own rows (in office, her prices, her limit); his holds his
//   B. she sets herself out with a line, her prices and her limit, and they read back after a reload
//   C. her client's door sign and prices follow hers; his stay his
//   D. her invitation starts at her own case price
//   E. 320px, and no page threw
//
// Run: PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-staffsettings.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' (' + d + ')' : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' (' + d + ')' : ''}`)); };
const errs = [];
const tryStep = async (fn) => { try { return await fn(); } catch { return null; } };
async function side(role, width = 390) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${role}: ${String(e).slice(0, 300)}`));
  return page;
}
const settle = async (page, ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Close|Maybe later|Later)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await page.waitForTimeout(250); if (!hit) break;
  }
};
// The control brought to the middle of the screen first (the demo strip is fixed over the top), then pressed.
const tap = (page, sel) => tryStep(async () => {
  await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
  await page.evaluate((q) => document.querySelector(q)?.scrollIntoView({ block: 'center' }), sel);
  await page.click(sel, { timeout: 8000 });
});
const openCog = async (page) => {
  await tap(page, '.cog-btn');
  await tryStep(() => page.waitForSelector('#pa-settings', { timeout: 8000 }));
  await page.waitForTimeout(1200);
};
const cogRows = (page) => page.evaluate(() => ({
  heads: [...document.querySelectorAll('#pa-settings h4')].map((h) => h.textContent.trim()),
  staffRows: !!document.querySelector('#pa-settings [data-staff-rows]'),
  adminRows: !!document.querySelector('#pa-settings [data-admin-rows]'),
}));

console.log('\n--- A. her cog, and his ---');
const ana = await side('advocate');
await ana.goto(`${P}/admin.html?demo=advocate`, { waitUntil: 'networkidle' });
await ana.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await ana.reload({ waitUntil: 'networkidle' });
await settle(ana, 2500);
await openCog(ana);
const hers = await cogRows(ana);
if (SHOTS) await ana.screenshot({ path: `${SHOTS}/staffsettings-1-her-cog.png`, fullPage: false });
const adm = await side('admin');
await adm.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(adm, 2500);
await openCog(adm);
const his = await cogRows(adm);
// NEGATIVE CONTROL (run 2026-10-15): settings.js giving the contractor rows to nobody (`isContractor ?` made `false ?`) made this read
//   FAIL  her cog holds her own rows, In office, Your prices and her Full-Service limit; his holds his and not hers
ok('her cog holds her own rows, In office, Your prices and her Full-Service limit; his holds his and not hers',
  hers.staffRows && !hers.adminRows && ['In office', 'Your prices', 'Full-Service clients at once'].every((h) => hers.heads.includes(h))
  && his.adminRows && !his.staffRows && his.heads.includes('Prices') && !his.heads.includes('Your prices'),
  JSON.stringify({ hers, his }));

console.log('\n--- B. she sets her own ---');
await tap(ana, '#pa-settings [data-sso="out"]');
await ana.waitForTimeout(800);
await tryStep(() => ana.fill('#pa-settings [data-sso-line]', 'I reply by the next morning.', { timeout: 5000 }));
await tap(ana, '#pa-settings [data-sso-line-save]');
await ana.waitForTimeout(800);
await tryStep(() => ana.fill('#pa-settings [data-ssp-price="caseCents"]', '1750', { timeout: 5000 }));
await tryStep(() => ana.fill('#pa-settings [data-ssp-price="fullCents"]', '3900', { timeout: 5000 }));
await tap(ana, '#pa-settings [data-ssp-save]');
await ana.waitForTimeout(800);
await tap(ana, '#pa-settings [data-ssc="2"]');
await ana.waitForTimeout(800);
await ana.reload({ waitUntil: 'networkidle' });
await settle(ana, 2000);
await openCog(ana);
const back = await ana.evaluate(() => ({
  out: document.querySelector('#pa-settings [data-sso="out"]')?.getAttribute('aria-pressed'),
  said: document.querySelector('#pa-settings [data-sso-said]')?.textContent.trim(),
  line: document.querySelector('#pa-settings [data-sso-line]')?.value,
  cas: document.querySelector('#pa-settings [data-ssp-price="caseCents"]')?.value,
  full: document.querySelector('#pa-settings [data-ssp-price="fullCents"]')?.value,
  addon: document.querySelector('#pa-settings [data-ssp-price="addonCents"]')?.value,
  addonStd: document.querySelector('#pa-settings [data-ssp-price="addonCents"]')?.placeholder,
  cap: document.querySelector('#pa-settings [data-ssc="2"]')?.getAttribute('aria-pressed'),
}));
if (SHOTS) await ana.screenshot({ path: `${SHOTS}/staffsettings-2-her-settings.png`, fullPage: false });
// NEGATIVE CONTROL (run 2026-10-15): the demo's settings route never storing the record (store.docs.set taken out) made this read
//   FAIL  out of office with her line, her two prices, the standard follow-up shown as a hint, and a limit of two, all read back after a reload
ok('out of office with her line, her two prices, the standard follow-up shown as a hint, and a limit of two, all read back after a reload',
  back.out === 'true' && /Out of office, set by you/.test(back.said || '') && back.line === 'I reply by the next morning.'
  && back.cas === '1,750' && back.full === '3,900' && back.addon === '' && /^Standard: /.test(back.addonStd || '') && back.cap === 'true',
  JSON.stringify(back));
await tap(ana, '#pa-settings [data-close]');

console.log('\n--- C. whose door sign and prices a client reads ---');
const reads = await ana.evaluate(async () => {
  const j = async (u) => (await fetch(u)).json();
  return {
    door: await j('/api/availability?advocate=demo-advocate'),
    hisDoor: await j('/api/availability'),
    rates: await j('/api/rates?advocate=demo-advocate'),
    hisRates: await j('/api/rates'),
  };
});
// NEGATIVE CONTROL (run 2026-10-15): the demo's /api/rates ignoring ?advocate= made this read
//   FAIL  her client reads her door sign, her line and her prices; his clients still read his
ok('her client reads her door sign, her line and her prices; his clients still read his',
  reads.door.inOffice === false && reads.door.responseTime === 'I reply by the next morning.'
  && reads.rates.caseCents === 175000 && reads.rates.fullCents === 390000 && reads.rates.addonCents === reads.hisRates.addonCents
  && reads.hisRates.caseCents !== 175000 && reads.hisDoor.responseTime !== 'I reply by the next morning.',
  JSON.stringify(reads));

console.log('\n--- D. her invitation starts at her price ---');
await tap(ana, '[data-add-open]');
await tap(ana, '#add-menu [data-open-door="lead"]');
await ana.waitForTimeout(1500);
const price = await ana.evaluate(() => document.querySelector('[data-lf="price"]')?.value);
// NEGATIVE CONTROL (run 2026-10-15): admin.js's ratesPath back to '/api/rates' for her made this read
//   FAIL  the price on her invitation starts at her own case price
ok('the price on her invitation starts at her own case price', price === '1750', String(price));

console.log('\n--- E. narrow screens ---');
const n1 = await side('advocate', 320);
await n1.goto(`${P}/admin.html?demo=advocate`, { waitUntil: 'networkidle' });
await settle(n1, 2000);
await openCog(n1);
const past = await n1.evaluate(() => [...document.querySelectorAll('#pa-settings *')].filter((e) => e.checkVisibility() && e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.tagName + '.' + e.className).slice(0, 4));
if (SHOTS) await n1.screenshot({ path: `${SHOTS}/staffsettings-3-320.png`, fullPage: false });
// NEGATIVE CONTROL (run 2026-10-15): the response-line input given `width: 400px` made this read
//   FAIL  at 320px nothing in her settings runs off the screen
ok('at 320px nothing in her settings runs off the screen', !past.length, JSON.stringify(past));
// NEGATIVE CONTROL (run 2026-10-15): a `null.x` put first in the In office buttons' click handler made this read
//   FAIL  no page threw
ok('no page threw', !errs.length, JSON.stringify(errs.slice(0, 3)));

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
