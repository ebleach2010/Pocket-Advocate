// drive-days.mjs - the day of the service beside the hours, report past due in red, and the contractor marked (v7.77).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-days.mjs
//
// Eric, 2026-10-17: "Next to hours should be the day we're on of the service ... For advocacy case, it's up to the
// point of the meeting, and then it resets for the 14 days to deliver. Days past that flag that in a red highlight
// with 'report past due'. For chat this can be simply by month." Asked where: "Both, and if a contractor has missed
// the due date the app alerts me and marks the contractor in employment mode". Driven in the demo at 390px.
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
const DAY = 86_400_000;
const settle = async (ms = 1800) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Close|Maybe later|Later|Skip)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; }).catch(() => false);
    await page.waitForTimeout(250); if (!hit) break;
  }
};

console.log('\n--- A. the client sees the day beside the hours ---');
// The preview keeps its own store for the tab, so it gets a tab of its own.
const previewTab = await ctx.newPage();
previewTab.on('pageerror', (e) => { const s = String(e); if (!/firebase-real/.test(s)) errs.push(s.slice(0, 200)); });
await previewTab.goto(`${P}/case.html?preview=1`, { waitUntil: 'networkidle' });
await previewTab.waitForTimeout(2000);
const client = await previewTab.evaluate(() => ({
  hours: document.querySelector('[data-hours-card] .eyebrow')?.textContent.replace(/\s+/g, ' ').trim() || '',
  chip: document.querySelector('[data-hours-card] [data-day-chip]')?.textContent.trim() || '',
}));
if (SHOTS) await previewTab.screenshot({ path: `${SHOTS}/days-1-client.png` });
await previewTab.close();
// NEGATIVE CONTROL (run 2026-10-17): the hours card's `${dayChip(caseDay(c))}` taken out made this read
//   FAIL  a Full-Service client reads the day of their month beside their hours
ok('a Full-Service client reads the day of their month beside their hours', /^Day ([1-9]|[12]\d|30) of 30$/.test(client.chip) && /^YOUR MONTH'S HOURS Day \d+ of 30$/.test(client.hours), JSON.stringify(client));

console.log('\n--- B. a report past due, on his shelf, his case page and Employer mode ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate((D) => {
  for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k);
}, DAY);
await page.reload({ waitUntil: 'networkidle' });
await settle(1500);
await page.evaluate((D) => {
  const s = JSON.parse(localStorage.getItem('pa-demo-store') || '{"docs":[]}');
  s.docs = s.docs || [];
  const base = { status: 'awaiting_report', createdAt: new Date(Date.now() - 20 * D).toISOString(), reportDueAt: new Date(Date.now() - 2.4 * D).toISOString(),
    appointment: { start: new Date(Date.now() - 16.4 * D).toISOString(), method: 'video' }, forms: {}, files: [] };
  s.docs.push(['cases/late-his', { ...base, advocateId: 'demo-admin', clientName: 'Dana Reyes' }]);
  s.docs.push(['cases/late-ana', { ...base, advocateId: 'demo-advocate', clientName: 'Lee Park' }]);
  localStorage.setItem('pa-demo-store', JSON.stringify(s));
}, DAY);
await page.reload({ waitUntil: 'networkidle' });
await settle(2000);
const shelf = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a.folder')].find((x) => /Dana Reyes/.test(x.textContent));
  return { tag: a?.querySelector('[data-day-tag]')?.textContent.trim() || '', badge: a?.querySelector('.status-pill')?.textContent.trim() || '', red: !!a?.querySelector('.status-pill.due') };
});
if (SHOTS) await page.screenshot({ path: `${SHOTS}/days-2-shelf.png`, fullPage: true });
await page.goto(`${P}/admin-case.html?id=late-his&demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
const head = await page.evaluate(() => { const e = document.querySelector('[data-day-chip]'); return { text: e?.textContent.trim() || '', red: /255,\s*90,\s*90/.test(e?.getAttribute('style') || '') }; });
await page.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
const team = await page.evaluate(() => ({ ana: document.querySelector('.tm-card[data-uid="demo-advocate"] [data-tm-late]')?.textContent.trim() || '', his: !!document.querySelector('.tm-card[data-uid="demo-admin"] [data-tm-late]') }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/days-3-employer.png` });
// NEGATIVE CONTROL (run 2026-10-17): caseDay's `late: true` made `late: false` made this read
//   FAIL  a report past due reads so in red on his shelf and his case page, and marks the contractor whose it is in Employer mode
ok('a report past due reads so in red on his shelf and his case page, and marks the contractor whose it is in Employer mode',
  shelf.tag === 'REPORT PAST DUE, 3 DAYS' && /^REPORT PAST DUE \dd$/.test(shelf.badge) && shelf.red
  && head.text === 'Report past due, 3 days' && head.red && team.ana === '1 report past due' && !team.his,
  JSON.stringify({ shelf, head, team }));

console.log('\n--- C. a chat line, by the month ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const bought = await page.evaluate(async () => {
  const r = await fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer demo' }, body: JSON.stringify({ termsAckAt: Date.now() }) });
  return r.status;
});
await page.waitForTimeout(1000);
await page.goto(`${P}/subscription.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
await page.waitForSelector('[data-chat-months]', { timeout: 6000 }).catch(() => {});
const mine = await page.evaluate(() => document.querySelector('[data-chat-months]')?.textContent.trim() || document.querySelector('#page')?.textContent.replace(/\s+/g, ' ').slice(0, 160) || '');
// NEGATIVE CONTROL (run 2026-10-17): subscription.js's `data-chat-months` line taken out made this read
//   FAIL  a chat line reads 1 month of chatting
ok('a chat line reads 1 month of chatting', bought === 200 && mine === '1 month of chatting', JSON.stringify({ bought, mine }));

// NEGATIVE CONTROL (run 2026-10-17): `throw new Error('control');` added at the end of admin.js made this read
//   FAIL  no page threw
ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
