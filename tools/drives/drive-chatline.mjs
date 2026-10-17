// drive-chatline.mjs - Priority Chat per contractor, on his phone (v7.73).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-chatline.mjs
//
// Eric, 2026-10-17, on the chat tier: "Yes, per contractor", at their price, switched on by him. Driven in the admin
// demo at 390px: Ana's card in Employer mode has a Priority Chat row, off until he turns it on, with her price; once on,
// her booking page offers her chat line at her price, the subscribe page names her and says who "me" is in the terms,
// and the chat line it opens is hers, by name.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const P = `http://127.0.0.1:${process.env.PA_PORT || 9377}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const errs = [];
const tryStep = async (fn) => { try { return await fn(); } catch { return null; } };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
const sheet = 'dialog.tm-sheet[open]';
const ANA = 'demo-advocate';
const settle = async (ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Close|Maybe later|Later)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; }).catch(() => false);
    await page.waitForTimeout(250); if (!hit) break;
  }
};
const openOffers = async () => {
  await page.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
  await settle(1800);
  await tryStep(() => page.click(`.tm-card[data-uid="${ANA}"] [data-face]`, { timeout: 6000 }));
  await tryStep(() => page.waitForSelector(`${sheet} .wz-dot`, { timeout: 8000 }));
  await tryStep(() => page.click(`${sheet} .wz-dot[aria-label="What they offer"]`, { timeout: 4000 }));
  await page.waitForTimeout(400);
};
const offerRow = () => page.evaluate((s) => {
  const box = document.querySelector(`${s} [data-offer="chat"]`);
  return { there: !!box, on: !!box?.checked, price: document.querySelector(`${s} [data-rate="subCents"]`)?.value ?? null, text: document.querySelector(s)?.textContent || '' };
}, sheet).catch(() => ({ there: false }));

console.log('\n--- A. her card in Employer mode ---');
await page.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await openOffers();
const first = await offerRow();
// NEGATIVE CONTROL (run 2026-10-17, v7.73): the chat row's `${st.offers.chat ? ' checked' : ''}` made `' checked'` made this read
//   FAIL  her card has a Priority Chat row with a price, off until he turns it on, and no longer says the chat stays his
ok('her card has a Priority Chat row with a price, off until he turns it on, and no longer says the chat stays his',
  first.there && first.on === false && first.price !== null && !/Priority Chat stays yours/.test(first.text), JSON.stringify({ there: first.there, on: first.on }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/chatline-1-row.png` });
await tryStep(() => page.check(`${sheet} [data-offer="chat"]`, { timeout: 3000 }));
await tryStep(() => page.fill(`${sheet} [data-rate="subCents"]`, '65', { timeout: 3000 }));
await tryStep(() => page.click(`${sheet} [data-save]`, { timeout: 4000 }));
await page.waitForTimeout(1500);
await openOffers();
const saved = await offerRow();
// NEGATIVE CONTROL (run 2026-10-17, v7.73): the wizard's read loop put back to `['case', 'full']` made this read
//   FAIL  turned on at $65, it reads back on at $65
ok('turned on at $65, it reads back on at $65', saved.on === true && saved.price === '65', JSON.stringify({ on: saved.on, price: saved.price }));

console.log('\n--- B. her booking page and the subscribe page ---');
await page.goto(`${P}/book.html?advocate=${ANA}&demo=admin`, { waitUntil: 'networkidle' });
await tryStep(() => page.waitForSelector('[data-adv-chat]', { timeout: 8000 }));
const link = await page.evaluate(() => { const a = document.querySelector('[data-adv-chat] a'); return { text: a?.textContent.trim() || '', href: a?.getAttribute('href') || '' }; });
// NEGATIVE CONTROL (run 2026-10-17, v7.73): the demo rates' `chatOffered` made `false` made this read
//   FAIL  her booking page offers her own chat line, by name, at her price
ok('her booking page offers her own chat line, by name, at her price',
  /^Or start a 24\/7 Priority Chat line with Ana, \$65 a month$/.test(link.text) && link.href === `/subscribe.html?advocate=${ANA}`, JSON.stringify(link));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/chatline-2-booking.png` });
await page.goto(`${P}/subscribe.html?advocate=${ANA}&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
// The practice account has no name on file yet, so the page asks first, the way it asks any new client.
if (await page.$('#pf-first')) {
  await page.fill('#pf-first', 'Jordan'); await page.fill('#pf-last', 'Avery'); await page.fill('#pf-dob', '1980-04-02');
  await tryStep(() => page.click('#pf-save', { timeout: 3000 }));
}
await tryStep(() => page.waitForSelector('.agreement summary', { timeout: 8000 }));
await tryStep(() => page.click('.agreement summary', { timeout: 5000 }));
await page.waitForTimeout(300);
const sub = await page.evaluate(() => ({
  pitch: document.getElementById('pitch')?.textContent.replace(/\s+/g, ' ').trim() || '',
  who: document.querySelector('[data-terms-theirs]')?.textContent || '',
  go: document.getElementById('go')?.textContent.trim() || '',
  sideways: document.documentElement.scrollWidth > innerWidth + 1,
}));
// NEGATIVE CONTROL (run 2026-10-17, v7.73): subscribe.js's `${advFirst ? `, with ${esc(advFirst)}` : ''}` taken out made this read
//   FAIL  the subscribe page names her, quotes her price, and her terms name her where his say me, at her price
// RE-PINNED 2026-10-17 (v7.73): Eric, "Simply replace 'me' with the advocate's name": the terms name her, no line above them.
// NEGATIVE CONTROL (run 2026-10-17, v7.73): termsFor's price replacement taken out made this read FAIL too.
ok('the subscribe page names her, quotes her price, and her terms name her where his say me, at her price',
  /\$65 a month, with Ana\./.test(sub.pitch) && /chat line to Ana Rivera, with Ana's live online status visible\. Ana replies on their own time/.test(sub.who)
  && /\$65 per month through Stripe/.test(sub.who) && sub.go === 'Subscribe, $65/mo' && !sub.sideways,
  JSON.stringify(sub));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/chatline-3-subscribe.png` });

console.log('\n--- C. the line it opens is hers ---');
const bought = await page.evaluate(async (adv) => {
  const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer demo' }, body: JSON.stringify({ termsAckAt: Date.now(), advocate: adv, quotedCents: 6500 }) });
  return { status: r.status, out: await r.json().catch(() => ({})) };
}, ANA);
await page.goto(`${P}/subscription.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
const line = await page.evaluate(() => ({ h1: document.querySelector('#page h1')?.textContent.trim() || '' }));
// NEGATIVE CONTROL (run 2026-10-17, v7.73): subscription.js's heading made `'Your chat with me'` always made this read
//   FAIL  the chat line it opens is hers: her name on it
ok('the chat line it opens is hers: her name on it', bought.status === 200 && line.h1 === 'Your chat with Ana', JSON.stringify({ bought: bought.status, line }));
const elsewhere = await page.evaluate(async () => {
  const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer demo' }, body: JSON.stringify({ termsAckAt: Date.now() }) });
  return { status: r.status, out: await r.json().catch(() => ({})) };
});
// NEGATIVE CONTROL (run 2026-10-17, v7.73): the demo's history refusal taken out made this read
//   FAIL  her history never moves to someone else: a line with him is refused, in words
ok('her history never moves to someone else: a line with him is refused, in words', elsewhere.status === 409 && /stays private to them/.test(elsewhere.out.error || ''), JSON.stringify(elsewhere));

// NEGATIVE CONTROL (run 2026-10-17, v7.73): `throw new Error('control');` added at the end of subscribe.js made this read
//   FAIL  no page threw
ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
