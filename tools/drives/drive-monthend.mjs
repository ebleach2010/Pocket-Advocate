// drive-monthend.mjs - the end of a Full-Service month on both sides, and the pace flag (v7.63).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-monthend.mjs
//
// Eric, 2026-10-17: "Close, with a heads up. If they pass closing, under [Case Enhancements] there's a shining
// upgrade for an additional month request. This goes to the advocate he accepts or declines." While sales are
// off: "No, keep it off". And "Pacing flags".
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || '9377';
const SHOTS = process.env.PA_SHOTS || '';
const P = `http://127.0.0.1:${PORT}`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const errs = [];
const tryStep = async (fn) => { try { await fn(); return true; } catch { return false; } };
async function side(role) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${role}: ${String(e).slice(0, 200)}`));
  return page;
}
// Reshape one case in this tab's demo store, then load again.
const reshape = (page, id, patch) => page.evaluate(([cid, p]) => {
  const raw = JSON.parse(localStorage.getItem('pa-demo-store') || 'null');
  if (!raw?.docs) return false;
  const at = raw.docs.findIndex(([k]) => k === `cases/${cid}`);
  if (at < 0) return false;
  const now = Date.now();
  const fill = (v) => (typeof v === 'string' && /^-?\d+d$/.test(v) ? new Date(now - Number(v.slice(0, -1)) * 86_400_000).toISOString() : v);
  const deep = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, deep(v)])) : fill(o));
  raw.docs[at][1] = { ...raw.docs[at][1], ...deep(p) };
  localStorage.setItem('pa-demo-store', JSON.stringify(raw));
  return true;
}, [id, patch]);
// The first-run card and any notes card, out of the way.
const settle = async (page, ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => {
      const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Close|Maybe later|Later|Skip|Not now)$/i.test((e.textContent || '').trim()));
      if (x) x.click();
      return !!x;
    });
    await page.waitForTimeout(250);
    if (!hit) break;
  }
};
const MONTH_OVER = { status: 'closed', closedBy: 'automatic', closedFromStatus: 'awaiting_report', monthEndedAt: '1d', closedReason: 'The month of Full-Service reached its end, so the case wrapped up on schedule.' };

console.log('\n--- A. the client: the ask waits with their advocate, theirs to withdraw, and no new ask while sales are off ---');
const cl = await side('client');
await cl.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await cl.waitForTimeout(1500);
const shaped = await reshape(cl, 'demo-case-full', { ...MONTH_OVER, extendRequest: { state: 'pending', at: '0d', monthCents: 440000 } });
await cl.reload({ waitUntil: 'networkidle' });
await settle(cl, 1800);
await tryStep(() => cl.click('.ftab[data-page="addons"]', { timeout: 5000 }));
await cl.waitForTimeout(800);
const asking = await cl.evaluate(() => {
  const card = document.querySelector('[data-month-ask]');
  return { state: card?.dataset.monthAsk || '', text: (card?.textContent || '').replace(/\s+/g, ' ').trim(), shine: !!document.getElementById('pa-month-ask'), withdraw: !!card?.querySelector('[data-month-withdraw]') };
});
if (SHOTS) await cl.screenshot({ path: `${SHOTS}/monthend-a-pending.png` });
// NEGATIVE CONTROL (run 2026-10-17): case.js's pending card heading changed to 'Your request is pending.' made this read
//   FAIL  a month-closed case shows the ask waiting with their advocate, shining, with Withdraw
ok('a month-closed case shows the ask waiting with their advocate, shining, with Withdraw',
  shaped && asking.state === 'pending' && /^Your request is with \S+\./.test(asking.text) && /Nothing is charged unless they say yes\./.test(asking.text) && asking.shine && asking.withdraw,
  JSON.stringify(asking));
await tryStep(() => cl.click('[data-month-withdraw]', { timeout: 3000 }));
await cl.waitForTimeout(1200);
const after = await cl.evaluate(() => ({
  card: document.querySelector('[data-month-ask]')?.dataset.monthAsk || '',
  ask: !!document.querySelector('[data-request-month]'),
  closedLine: (document.querySelector('[data-addons-closed]')?.textContent || '').trim(),
}));
// NEGATIVE CONTROL (run 2026-10-17): `[data-request-month]` taken out of case.js's SELLING made this read
//   FAIL  withdrawn, nothing new can be asked while sales are off, and the page says so
// RE-PINNED 2026-10-17 (v7.71): Eric, "For now, open up all my tier options." Sales are open, so once withdrawn the ask
// is offered again; the closed form is kept below as a record, never run.
// NEGATIVE CONTROL (run 2026-10-17, v7.71): SALES_OPEN set back to false in sales.js made this read
//   FAIL  withdrawn, the ask for another month is offered again while sales are open, with no closed sentence
ok('withdrawn, the ask for another month is offered again while sales are open, with no closed sentence',
  after.card === 'offer' && after.ask && !after.closedLine, JSON.stringify(after));
false && ok('(retired 2026-10-17) withdrawn, nothing new can be asked while sales are off, and the page says so',
  after.card === '' && !after.ask && /not currently offering/i.test(after.closedLine), JSON.stringify(after));

console.log('\n--- B. their advocate: the ask on the case and the shelf, and a yes opens it again ---');
const ad = await side('admin');
await ad.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await ad.waitForTimeout(1500);
await reshape(ad, 'demo-case-full', { ...MONTH_OVER, extendRequest: { state: 'pending', at: '0d', monthCents: 440000 } });
await ad.reload({ waitUntil: 'networkidle' });
await settle(ad, 1800);
const shelf = await ad.evaluate(() => (document.body.innerText.match(/Asking for another month/g) || []).length);
// NEGATIVE CONTROL (run 2026-10-17): admin.js's Needs attention loop over former cases taken out made this read
//   FAIL  the shelf lists the ask under Needs attention
ok('the shelf lists the ask under Needs attention', shelf >= 1, String(shelf));
await ad.goto(`${P}/admin-case.html?id=demo-case-full&demo=admin&page=overview`, { waitUntil: 'networkidle' });
await settle(ad, 2000);
const card = await ad.evaluate(() => {
  const p = document.querySelector('div[data-month-request]');
  return { text: (p?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160), approve: !!p?.querySelector('button[data-month-request="approve"]'), decline: !!p?.querySelector('button[data-month-request="decline"]') };
});
if (SHOTS) {
  await ad.evaluate(() => document.querySelector('div[data-month-request]')?.scrollIntoView({ block: 'center' }));
  await ad.screenshot({ path: `${SHOTS}/monthend-b-advocate.png` });
}
// NEGATIVE CONTROL (run 2026-10-17): admin-case.js's card condition changed to `c.extendRequest?.state === 'waiting'` made this read
//   FAIL  the case shows Another month: your call, with Approve and Can't take it
ok('the case shows Another month: your call, with Approve and Can\'t take it',
  /^Another month: your call/.test(card.text) && /quoted \$4,400/.test(card.text) && card.approve && card.decline, JSON.stringify(card));
await ad.evaluate(() => document.querySelector('button[data-month-request="approve"]')?.scrollIntoView({ block: 'center' }));
await tryStep(() => ad.click('button[data-month-request="approve"]', { timeout: 3000 }));
await ad.waitForTimeout(500);
await tryStep(() => ad.click('dialog.ask-sheet button[value="ok"]', { timeout: 3000 }));
await ad.waitForTimeout(2500);
const reopened = await ad.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('pa-demo-store') || 'null');
  const c = (raw?.docs || []).find(([k]) => k === 'cases/demo-case-full')?.[1] || {};
  return { status: c.status, req: c.extendRequest?.state, pill: document.querySelector('[data-status]')?.textContent.trim() || '' };
});
// NEGATIVE CONTROL (run 2026-10-17): the demo's yes leaving the case closed (`status: c.closedFromStatus || 'confirmed'` taken out) made this read
//   FAIL  Approve at the quoted price opens the case again as it was
ok('Approve at the quoted price opens the case again as it was',
  reopened.status === 'awaiting_report' && reopened.req === 'started' && reopened.pill === 'FULL-SERVICE', JSON.stringify(reopened));

console.log('\n--- C. the pace ---');
await reshape(ad, 'demo-case-full', { status: 'awaiting_report', fullAccessAt: '20d', staffMsgAt: '10d', lastMessage: { role: 'client', text: 'Any news?', ts: '10d' }, work: { seconds: 36000, updatedAt: '10d', startedAt: null } });
await ad.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await ad.waitForTimeout(1800);
const pace = await ad.evaluate(() => ({
  folder: !!document.querySelector('.folder[data-id="demo-case-full"] .fld-alert') && /CHECK THE PACE/.test(document.querySelector('.folder[data-id="demo-case-full"]')?.textContent || ''),
  quiet: /No work logged in 10 days/.test(document.body.innerText), unheard: /No update to the client in 10 days/.test(document.body.innerText),
}));
if (SHOTS) await ad.screenshot({ path: `${SHOTS}/monthend-c-pace.png`, fullPage: false });
// NEGATIVE CONTROL (run 2026-10-17): admin.js's folder flag `CHECK THE PACE` taken out made this read
//   FAIL  a quiet Full-Service case says CHECK THE PACE on its folder, and why under Needs attention
ok('a quiet Full-Service case says CHECK THE PACE on its folder, and why under Needs attention',
  pace.folder && pace.quiet && pace.unheard, JSON.stringify(pace));

ok('no page errors', !errs.length, errs.join(' | '));
await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
