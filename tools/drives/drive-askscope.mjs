// drive-askscope.mjs - what an Advisor question searches: the chip, the wheel, the hold on Ask (v7.80).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-askscope.mjs
//
// Eric, 2026-10-17: "a toggle of some sort that has the advisor read your question against the case as of today, the
// past week, or all time. As well as 'search the chat' 'search uploads'. In as compact as possible. Possibly a press
// and hold that opens a wheel like counterstrike when you're purchasing a gun". Driven in the demo at 390px.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const P = `http://127.0.0.1:${process.env.PA_PORT || 9377}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const errs = [];
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => { const s = String(e); if (!/firebase-real/.test(s)) errs.push(s.slice(0, 200)); });
const tap = (sel) => page.click(sel, { timeout: 3000 }).catch(() => {});
const settle = async (ms = 1800) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Close|Maybe later|Later|Skip)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; }).catch(() => false);
    await page.waitForTimeout(250); if (!hit) break;
  }
};
// The demo keeps the advocate-only half, questions included, under its own key.
const rows = () => page.evaluate(() => (JSON.parse(localStorage.getItem('pa-demo-store-advocate') || '{"docs":[]}').docs || [])
  .filter(([k]) => /^cases\/demo-case\/advisor\/state\/qa\//.test(k)).map(([, v]) => v));

await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
// To the question box, wherever the case keeps it.
for (let i = 0; i < 12; i++) {
  const seen = await page.evaluate(() => { const t = document.querySelector('[data-ask] [data-q]'); return !!(t && t.offsetParent !== null); });
  if (seen) break;
  await page.evaluate((n) => { const g = [...document.querySelectorAll('[data-group]')]; const p = [...document.querySelectorAll('[data-page]')]; (n % 2 ? p : g)[Math.floor(n / 2)]?.click(); }, i);
  await page.waitForTimeout(500);
}

console.log('\n--- A. the chip and the wheel ---');
const chip0 = await page.evaluate(() => { const c = document.querySelector('[data-ask] [data-scope]'); const a = document.querySelector('[data-ask] .btn'); const q = document.querySelector('[data-ask] [data-q]'); return c ? { text: c.textContent.trim(), left: c.getBoundingClientRect().left < q.getBoundingClientRect().left, oneRow: Math.abs(c.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom) < 4, fits: document.documentElement.scrollWidth <= innerWidth } : null; });
await tap('[data-ask] [data-scope]');
await page.waitForTimeout(300);
const wheel = await page.evaluate(() => [...document.querySelectorAll('.scope-wheel [data-slice]')].map((x) => { const r = x.getBoundingClientRect(); return { id: x.dataset.slice, t: x.textContent.trim(), inside: r.left >= 0 && r.right <= innerWidth }; }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/askscope-1-wheel.png` });
await tap('.scope-wheel [data-slice="week"]');
const afterWeek = await page.evaluate(() => document.querySelector('[data-scope]')?.textContent.trim());
await tap('.scope-wheel [data-slice="uploads"]');
const afterUploads = await page.evaluate(() => document.querySelector('[data-scope]')?.textContent.trim());
await page.mouse.click(10, 10);
await page.waitForTimeout(200);
const closed = await page.evaluate(() => !document.querySelector('.scope-wheel'));
// NEGATIVE CONTROL (run 2026-10-17): the chip's `scopeBtn?.addEventListener('click', () => openWheel(scopeBtn, false));` taken out made this read
//   FAIL  a chip left of the box reads Memory; a tap opens the wheel of six on the phone; Past week then Search uploads read Week · chat + uploads; a tap outside closes it
ok('a chip left of the box reads Memory; a tap opens the wheel of six on the phone; Past week then Search uploads read Week · chat + uploads; a tap outside closes it',
  chip0?.text === 'Memory' && chip0.left && chip0.oneRow && chip0.fits
  && wheel.map((w) => w.t).join('|') === 'Today|Past week|All time|Search uploads|Search chat|Memory' && wheel.every((w) => w.inside)
  && afterWeek === 'Week · chat' && afterUploads === 'Week · chat + uploads' && closed,
  JSON.stringify({ chip0, wheel: wheel.map((w) => w.t), afterWeek, afterUploads, closed }));

console.log('\n--- B. the question goes with it, then back to memory ---');
const before = (await rows()).length;
await page.fill('[data-ask] [data-q]', 'What did the last scan show?');
await tap('[data-ask] button');
await page.waitForTimeout(1500);
const asked = (await rows()).find((r) => r.question === 'What did the last scan show?');
const chipAfter = await page.evaluate(() => document.querySelector('[data-scope]')?.textContent.trim());
await page.waitForTimeout(5000);
const line = await page.evaluate(() => [...document.querySelectorAll('.advisor-turn')].find((r) => /last scan show/.test(r.textContent))?.querySelector('[data-scope-line]')?.textContent.trim() || '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/askscope-2-asked.png` });
// NEGATIVE CONTROL (run 2026-10-17): submitAsk's `if (out) setScope(...)` taken out made this read
//   FAIL  the question carries what it searched, says so under it, and the chip goes back to Memory
ok('the question carries what it searched, says so under it, and the chip goes back to Memory',
  (await rows()).length === before + 1 && JSON.stringify(asked?.scope) === '{"time":"week","chat":true,"uploads":true}'
  && chipAfter === 'Memory' && line === 'Searched chat and uploads, the past week',
  JSON.stringify({ scope: asked?.scope, chipAfter, line }));

console.log('\n--- C. hold Ask for the wheel ---');
const n0 = (await rows()).length;
await page.evaluate(() => document.querySelector('[data-ask] .btn')?.scrollIntoView({ block: 'center' }));
await page.waitForTimeout(300);
const box = await page.evaluate(() => { const r = document.querySelector('[data-ask] .btn').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
await page.fill('[data-ask] [data-q]', 'Held, not asked');
await page.mouse.move(box.x, box.y);
await page.mouse.down();
await page.waitForTimeout(650);
const heldOpen = await page.evaluate(() => !!document.querySelector('.scope-wheel'));
const target = await page.evaluate(() => { const r = document.querySelector('.scope-wheel [data-slice="all"]')?.getBoundingClientRect(); return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null; });
if (target) { await page.mouse.move(target.x, target.y, { steps: 6 }); }
if (SHOTS) await page.screenshot({ path: `${SHOTS}/askscope-3-held.png` });
await page.mouse.up();
await page.waitForTimeout(800);
const held = await page.evaluate(() => ({ chip: document.querySelector('[data-scope]')?.textContent.trim(), gone: !document.querySelector('.scope-wheel'), box: document.querySelector('[data-ask] [data-q]')?.value }));
const n1 = (await rows()).length;
await tap('[data-ask] button');
await page.waitForTimeout(1200);
const n2 = (await rows()).length;
// NEGATIVE CONTROL (run 2026-10-17): the held wheel's release `if (b) pick(b.dataset.slice);` taken out made this read
//   FAIL  holding Ask opens the wheel there, sliding to All time and letting go picks it without asking, and the next tap asks
ok('holding Ask opens the wheel there, sliding to All time and letting go picks it without asking, and the next tap asks',
  heldOpen && !!target && held.chip === 'All · chat' && held.gone && held.box === 'Held, not asked' && n1 === n0 && n2 === n0 + 1,
  JSON.stringify({ heldOpen, held, n0, n1, n2 }));

// NEGATIVE CONTROL (run 2026-10-17): a `throw new Error('control')` put in a timer at the top of advisor.js's openWheel made this read
//   FAIL  no page threw
ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
