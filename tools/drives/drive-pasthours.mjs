// drive-pasthours.mjs - past a Full-Service month's 20 hours: the pop up, the three choices, and the bill (v7.78).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-pasthours.mjs
//
// Eric, 2026-10-17: "The full service clients should get a notification and a pop up when opening the app once 20
// hours have passed. 'To continue, select one of the three: continue up to the full 30 days for [$/hour] | Purchase
// an addition month at [fulll case price] | end case (all information is kept for your reference)'". Asked the rate:
// "$200 an hour". Asked how it is paid: "Advocate bills hours used". Driven in the demo at 390px.
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
const page = await ctx.newPage();
page.on('pageerror', (e) => { const s = String(e); if (!/firebase-real/.test(s)) errs.push(s.slice(0, 200)); });
const DAY = 86_400_000;
const H = 3600;
// A tap that gives up in three seconds, so a missing button reads as a failed check, not a stalled drive.
const tap = (sel) => page.click(sel, { timeout: 3000 }).catch(() => {});
const as = (role) => ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
// Clears first-run notes, never the hours question itself.
const settle = async (ms = 1800) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => !e.closest('dialog.hours-ask') && e.checkVisibility() && /^(Got it|Close|Maybe later|Later|Skip)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; }).catch(() => false);
    await page.waitForTimeout(250); if (!hit) break;
  }
};
const seed = (id, extra) => page.evaluate(({ id, extra, D, H }) => {
  const s = JSON.parse(localStorage.getItem('pa-demo-store') || '{"docs":[]}');
  s.docs = (s.docs || []).filter(([k]) => k !== `cases/${id}`);
  s.docs.push([`cases/${id}`, {
    fullAccess: true, status: 'confirmed', clientUid: 'demo-client', clientName: 'Jordan Avery', clientEmail: 'jordan@example.demo',
    advocateId: 'demo-admin', fullAccessAt: new Date(Date.now() - 10 * D).toISOString(), fullAccessMonths: 1,
    createdAt: new Date(Date.now() - 12 * D).toISOString(), appointment: { start: new Date(Date.now() - 10 * D).toISOString(), method: 'video' },
    work: { seconds: 2 * H + 21.5 * H, tierMark: 2 * H }, forms: {}, files: [], ...extra,
  }]);
  localStorage.setItem('pa-demo-store', JSON.stringify(s));
}, { id, extra, D: DAY, H });
const stored = (id) => page.evaluate((id) => (JSON.parse(localStorage.getItem('pa-demo-store') || '{"docs":[]}').docs || []).find(([k]) => k === `cases/${id}`)?.[1] || null, id);
const dialog = () => page.evaluate(() => {
  const d = document.querySelector('dialog.hours-ask[open]');
  if (!d) return null;
  const r = d.getBoundingClientRect();
  return {
    h2: d.querySelector('h2')?.textContent.trim() || '',
    picks: [...d.querySelectorAll('[data-pick]')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
    capital: [...d.querySelectorAll('[data-pick]')].every((x) => getComputedStyle(x, '::first-letter').textTransform === 'uppercase'),
    fits: r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth,
  };
});

await as('admin');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await page.reload({ waitUntil: 'networkidle' });
await settle(1500);
await seed('past-a', {});
await seed('past-b', {});
await seed('past-c', {});

console.log('\n--- A. opening the app past the hours ---');
await as('client');
await page.goto(`${P}/case.html?id=past-a&demo=1`, { waitUntil: 'networkidle' });
await settle(2500);
await page.waitForSelector('dialog.hours-ask[open]', { timeout: 6000 }).catch(() => {});
const first = await dialog();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/pasthours-1-ask.png` });
// NEGATIVE CONTROL (run 2026-10-17): the `askHoursIfDue();` after watchCase() and the one in the live watch taken out made this read
//   FAIL  opening the case past the month's 20 hours asks in his words: the three choices, the rate, the month's price, each starting with a capital, on a phone
ok('opening the case past the month\'s 20 hours asks in his words: the three choices, the rate, the month\'s price, each starting with a capital, on a phone',
  !!first && first.h2 === 'To continue, select one of the three:'
  && first.picks.join(' | ') === 'continue up to the full 30 days for $200 an hour | Purchase an additional month at $4,400 | end case (all information is kept for your reference)'
  && first.capital && first.fits,
  JSON.stringify(first));

await tap('dialog.hours-ask [data-later]');
await page.waitForTimeout(400);
const later = await page.evaluate(() => ({
  gone: !document.querySelector('dialog.hours-ask'),
  card: document.querySelector('[data-hours-card]')?.textContent.replace(/\s+/g, ' ').trim() || '',
  button: !!document.querySelector('[data-hours-card] [data-hours-choose]'),
}));
await page.reload({ waitUntil: 'networkidle' });
await settle(2500);
await page.waitForSelector('dialog.hours-ask[open]', { timeout: 6000 }).catch(() => {});
const back = await dialog();
// NEGATIVE CONTROL (run 2026-10-17): the hours card's `${needsChoice(c) ? '<p ...data-hours-choose...' : ''}` taken out made this read
//   FAIL  Not now closes it, the hours card keeps a way to choose and says all 20 are delivered, never at no extra charge, and it asks again next time
ok('Not now closes it, the hours card keeps a way to choose and says all 20 are delivered, never at no extra charge, and it asks again next time',
  later.gone && later.button && /All 20 hours of your month are delivered\./.test(later.card) && !/no extra charge/.test(later.card) && !!back,
  JSON.stringify({ later, back: !!back }));

console.log('\n--- B. by the hour, and his bill ---');
await tap('dialog.hours-ask [data-pick="hourly"]');
await page.waitForSelector('dialog.hours-ask [data-done]', { timeout: 6000 }).catch(() => {});
const done = await page.evaluate(() => document.querySelector('dialog.hours-ask')?.textContent.replace(/\s+/g, ' ').trim() || '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/pasthours-2-hourly.png` });
await tap('dialog.hours-ask [data-done]');
const chose = (await stored('past-a'))?.hoursChoice;
await page.reload({ waitUntil: 'networkidle' });
await settle(2500);
const after = await page.evaluate(() => ({ ask: !!document.querySelector('dialog.hours-ask'), note: document.querySelector('[data-hours-card] .hours-note')?.textContent.trim() || '' }));
// NEGATIVE CONTROL (run 2026-10-17): the demo's hours-choice keeping `hoursChoice: picked` dropped (the case written back unchanged) made this read
//   FAIL  choosing by the hour says so, is kept for the month, and the question does not come back
ok('choosing by the hour says so, is kept for the month, and the question does not come back',
  /^Done\./.test(done) && /\$200 an hour/.test(done) && chose?.kind === 'hourly' && chose.month === 1 && !after.ask
  && after.note === 'You chose to continue to the end of the month at $200 an hour for the time past them.',
  JSON.stringify({ done: done.slice(0, 120), chose, after }));

await as('admin');
await page.goto(`${P}/admin-case.html?id=past-a&demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); });
await page.waitForTimeout(600);
const panel = await page.evaluate(() => { const p = document.querySelector('[data-past-hours]'); return { text: p?.textContent.replace(/\s+/g, ' ').trim() || '', bill: !!p?.querySelector('[data-bill-hours]') }; });
if (SHOTS) await page.screenshot({ path: `${SHOTS}/pasthours-3-bill.png` });
await tap('[data-bill-hours]');
await page.waitForSelector('dialog.ask-sheet [value="ok"]', { timeout: 5000 }).catch(() => {});
const sheet = await page.evaluate(() => document.querySelector('dialog.ask-sheet')?.textContent.replace(/\s+/g, ' ').trim() || '');
await tap('dialog.ask-sheet [value="ok"]');
await page.waitForTimeout(1800);
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); });
await page.waitForTimeout(600);
const billed = await page.evaluate(() => document.querySelector('[data-past-hours]')?.textContent.replace(/\s+/g, ' ').trim() || '');
const paid = await stored('past-a');
// NEGATIVE CONTROL (run 2026-10-17): admin-case.js's `${pastHoursPanel(c)}` taken out made this read
//   FAIL  his case page shows their choice and the time past the hours, and Bill extra hours bills every minute of it at $200 an hour
ok('his case page shows their choice and the time past the hours, and Bill extra hours bills every minute of it at $200 an hour',
  /Past the month's hours: by the hour/.test(panel.text) && /Past the hours, not yet billed: 1h 30m, \$300\./.test(panel.text) && panel.bill
  && /1h 30m past the month's 20 hours, at \$200 an hour: \$300\./.test(sheet)
  && paid?.hoursBilledSec === 1.5 * H && paid.extraPayments?.some((x) => x.kind === 'hours' && x.amountCents === 30000)
  && /Extra hours paid for so far: 1h 30m\./.test(billed) && /Nothing past the hours is left to bill/.test(billed),
  JSON.stringify({ panel, sheet: sheet.slice(0, 120), billed: billed.slice(0, 200), billedSec: paid?.hoursBilledSec }));

console.log('\n--- C. ending the case, everything kept ---');
await as('client');
await page.goto(`${P}/case.html?id=past-b&demo=1`, { waitUntil: 'networkidle' });
await settle(2500);
await page.waitForSelector('dialog.hours-ask[open]', { timeout: 6000 }).catch(() => {});
await tap('dialog.hours-ask [data-pick="end"]');
await page.waitForSelector('dialog.hours-ask [data-end-yes]', { timeout: 4000 }).catch(() => {});
const confirmText = await page.evaluate(() => document.querySelector('dialog.hours-ask')?.textContent.replace(/\s+/g, ' ').trim() || '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/pasthours-4-end.png` });
await tap('dialog.hours-ask [data-end-yes]');
await page.waitForTimeout(1500);
const endedDoc = await stored('past-b');
await page.reload({ waitUntil: 'networkidle' });
await settle(2500);
const endedPage = await page.evaluate(() => ({ ask: !!document.querySelector('dialog.hours-ask'), text: document.body.textContent.replace(/\s+/g, ' ') }));
// NEGATIVE CONTROL (run 2026-10-17): the pop up's end case ending at once from the first view (its `() => show('end')` made `async () => { await post('end'); close(); }`) made this read
//   FAIL  end case asks once more, then closes it with the reason in their words and everything still on the page
ok('end case asks once more, then closes it with the reason in their words and everything still on the page',
  /End your case now\?/.test(confirmText) && /stays here for your reference/.test(confirmText)
  && endedDoc?.status === 'closed' && endedDoc.hoursChoice?.kind === 'end' && !endedPage.ask
  && /You ended the case after your month's 20 hours\. Everything in it stays here for your reference\./.test(endedPage.text),
  JSON.stringify({ confirm: confirmText.slice(0, 100), status: endedDoc?.status, ask: endedPage.ask }));

console.log('\n--- D. an additional month ---');
await page.goto(`${P}/case.html?id=past-c&demo=1`, { waitUntil: 'networkidle' });
await settle(2500);
await page.waitForSelector('dialog.hours-ask[open]', { timeout: 6000 }).catch(() => {});
await Promise.all([page.waitForURL(/extended=1/, { timeout: 8000 }).catch(() => {}), tap('dialog.hours-ask [data-pick="month"]')]);
await settle(2500);
const month = await stored('past-c');
const monthPage = await page.evaluate(() => ({ ask: !!document.querySelector('dialog.hours-ask'), card: document.querySelector('[data-hours-card]')?.textContent.replace(/\s+/g, ' ').trim() || '' }));
// NEGATIVE CONTROL (run 2026-10-17): the pop up's month choice posting to '/api/extend-request' instead of '/api/extend' made this read
//   FAIL  an additional month goes through the month checkout, adds its 20 hours, and the question goes away
ok('an additional month goes through the month checkout, adds its 20 hours, and the question goes away',
  month?.fullAccessMonths === 2 && !monthPage.ask && /Hours so far: 21 of up to 40\./.test(monthPage.card),
  JSON.stringify({ months: month?.fullAccessMonths, monthPage }));

// NEGATIVE CONTROL (run 2026-10-17): a `throw new Error('control')` put in a timer at the top of admin-case.js's pastHoursPanel made this read
//   FAIL  no page threw
ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
