// drive-bookable.mjs - a contractor's available hours are their bookable times, with a buffer around paid
// appointments, on his phone (v7.70).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-bookable.mjs
//
// Eric, 2026-10-17: "Not weekly hours. Available hours. This is where clients can see they can be booked." Then: "Yes,
// with an adjustable buffer block around it. A scheduled time automatically blocks off 3 hours before and after around
// the appointment. This is baseline for everyone. But can be adjusted per contractor in employer mode." Free calls make
// no buffer, but cannot land inside one.
//
// One browser, one demo world: his demo sets Ana's hours and buffer, her booking link is opened in the same world
// (a client's demo tab keeps no advocate records, so the link is opened on his side), and the bookings are made through
// the demo's own checkout.
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
const tryStep = async (fn) => { try { return await fn(); } catch { return null; } };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
const sheet = 'dialog.tm-sheet[open]';
const ANA = 'demo-advocate';
const ACKS = { disclaimer: 1, privacy: 1, recording: 1, service: 1, phoneConsent: 1 };
const settle = async (ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Close|Maybe later|Later)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; }).catch(() => false);
    await page.waitForTimeout(250); if (!hit) break;
  }
};
const toHours = async () => {
  await tryStep(() => page.waitForSelector(`${sheet} .wz-dot`, { timeout: 8000 }));
  await tryStep(() => page.click(`${sheet} .wz-dot[aria-label="Available hours"]`, { timeout: 4000 }));
  await page.waitForTimeout(400);
};
const openCard = async (uid) => {
  await page.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
  await settle(1800);
  await tryStep(() => page.click(`.tm-card[data-uid="${uid}"] [data-face]`, { timeout: 6000 }));
  await toHours();
};
const save = async () => {
  await tryStep(() => page.click(`${sheet} [data-save]`, { timeout: 4000 }));
  await page.waitForTimeout(1200);
};
/** Her open times, as the booking page draws them: ISO starts, plus what the page says about her. */
const herCalendar = async () => {
  await page.goto(`${P}/book.html?advocate=${ANA}&demo=admin`, { waitUntil: 'networkidle' });
  await tryStep(() => page.waitForSelector('#days .slot, [data-adv-none], [data-adv-closed]', { timeout: 10000 }));
  await page.waitForTimeout(600);
  return page.evaluate(() => ({
    who: document.querySelector('[data-adv-who]')?.textContent.replace(/\s+/g, ' ').trim() || '',
    times: [...document.querySelectorAll('#days .slot')].map((x) => x.dataset.id),
    request: !!document.querySelector('#request-box'),
    mst: !!document.querySelector('#days .slot .local'),
    sideways: document.documentElement.scrollWidth > innerWidth + 1,
    closed: document.querySelector('[data-adv-closed]')?.textContent || '',
  })).catch(() => ({ times: [] }));
};
const checkout = (body) => page.evaluate(async (b) => {
  const r = await fetch('/api/checkout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer demo' }, body: JSON.stringify(b) });
  return { status: r.status, out: await r.json().catch(() => ({})) };
}, body).catch((e) => ({ status: 0, out: { error: String(e) } }));
const boiseHour = (iso) => Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', hour: 'numeric', hourCycle: 'h23' }).format(new Date(iso))) % 24;
const boiseMin = (iso) => new Date(iso).getUTCMinutes();

console.log('\n--- A. her hours and her buffer, on her card ---');
await page.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await openCard(ANA);
const herPage = await page.evaluate(() => ({
  buffer: document.querySelector('dialog[open] [data-buffer]')?.value,
  link: document.querySelector('dialog[open] [data-book-link] a')?.getAttribute('href') || '',
  days: document.querySelectorAll('dialog[open] [data-day]').length,
})).catch(() => ({}));
// Every day, eight to eight on her clock, so the drive finds times whatever hour it runs.
for (const d of ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']) {
  await tryStep(() => page.check(`${sheet} [data-day="${d}"]`, { timeout: 2000 }));
  await tryStep(() => page.fill(`${sheet} [data-from="${d}"]`, '08:00', { timeout: 2000 }));
  await tryStep(() => page.fill(`${sheet} [data-to="${d}"]`, '20:00', { timeout: 2000 }));
}
await tryStep(() => page.selectOption(`${sheet} [data-tz]`, 'America/Boise'));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/bookable-a-her-hours.png` });
await save();
await openCard('demo-admin');
const hisPage = await page.evaluate(() => ({
  buffer: document.querySelector('dialog[open] [data-buffer]')?.value,
  days: document.querySelectorAll('dialog[open] [data-day]').length,
  says: document.querySelector('dialog[open] .wz-body')?.textContent.replace(/\s+/g, ' ').trim() || '',
})).catch(() => ({}));
await tryStep(() => page.keyboard.press('Escape'));
// NEGATIVE CONTROL (run 2026-10-17): the wizard's `${editing && uid ? `<p class="small" ... data-book-link>` taken out made this read
//   FAIL  her card and his carry the buffer, three to start; her hours page gives her booking link; his says his Calendar
ok('her card and his carry the buffer, three to start; her hours page gives her booking link; his says his Calendar',
  herPage.buffer === '3' && herPage.link === `/book.html?advocate=${ANA}` && herPage.days === 7
  && hisPage.buffer === '3' && hisPage.days === 0 && /the ones you open in your Calendar/.test(hisPage.says),
  JSON.stringify({ herPage, hisPage }));

console.log('\n--- B. her booking link ---');
const first = await herCalendar();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/bookable-b-her-calendar.png` });
// NEGATIVE CONTROL (run 2026-10-17): the demo's /api/advocate-times answering 404 for everyone made this read
//   FAIL  her link shows her name and her times on his phone, no request box, no MST line, nothing sideways
ok('her link shows her name and her times on his phone, no request box, no MST line, nothing sideways',
  /With Ana Rivera\./.test(first.who) && first.times.length > 20 && !first.request && !first.mst && first.sideways === false,
  JSON.stringify({ ...first, times: first.times.length }));

console.log('\n--- C. a booking takes the hours around it ---');
// The third day's one o'clock on her clock: four hours either side stay inside her eight to eight.
const ones = first.times.filter((t) => boiseHour(t) === 13 && boiseMin(t) === 0);
const T = ones[1] || ones[0] || '';
const booked = await checkout({ advocate: ANA, start: T, method: 'video', phone: '+1 555 555 5555', acks: ACKS });
const after3 = await herCalendar();
const H = 3600_000;
const at = (h) => new Date(Date.parse(T) + h * H).toISOString();
const gone3 = after3.times.filter((t) => Math.abs(Date.parse(t) - Date.parse(T)) < 4 * H);
// NEGATIVE CONTROL (run 2026-10-17): the demo's `if (!inDemoBuffer(paid, buf, t, t + 3_600_000))` made `if (true)` made this read
//   FAIL  a booked time takes itself and the three hours around it off her calendar, and nothing further
ok('a booked time takes itself and the three hours around it off her calendar, and nothing further',
  !!T && booked.status === 200 && gone3.length === 0 && after3.times.includes(at(-4)) && after3.times.includes(at(4))
  && after3.times.length < first.times.length,
  JSON.stringify({ T, booked: booked.status, gone3, minus4: after3.times.includes(at(-4)), plus4: after3.times.includes(at(4)) }));

console.log('\n--- D. he changes her buffer ---');
await openCard(ANA);
await tryStep(() => page.fill(`${sheet} [data-buffer]`, '1', { timeout: 3000 }));
await save();
const after1 = await herCalendar();
const gone1 = after1.times.filter((t) => Math.abs(Date.parse(t) - Date.parse(T)) < 2 * H);
// NEGATIVE CONTROL (run 2026-10-17): the demo's update leaving out `next.bufferHours = b;` made this read
//   FAIL  set to one hour on her card, her calendar opens up to two hours either side at once
ok('set to one hour on her card, her calendar opens up to two hours either side at once',
  gone1.length === 0 && after1.times.includes(at(-2)) && after1.times.includes(at(2)) && !after1.times.includes(at(-1.5))
  && after1.times.length > after3.times.length,
  JSON.stringify({ gone1, minus2: after1.times.includes(at(-2)), plus2: after1.times.includes(at(2)) }));

console.log('\n--- E. his own calendar and his free calls ---');
// His one o'clock on the fourth day (slot-2): his ten and three that day (slot-1, slot-3) sit inside his three hours,
// and so do his free calls at half past twelve and four (fit-2, fit-3); the nine o'clock free call (fit-1) does not.
const hisBooked = await checkout({ slotId: 'slot-2', method: 'video', phone: '+1 555 555 5555', acks: ACKS });
await page.goto(`${P}/book.html?demo=admin`, { waitUntil: 'networkidle' });
await tryStep(() => page.waitForSelector('#days .slot', { timeout: 10000 }));
await page.waitForTimeout(600);
const hisSlots = await page.evaluate(() => [...document.querySelectorAll('#days .slot')].map((x) => x.dataset.id)).catch(() => []);
// The free-call page is shut while sales are closed (it sends people home), so its list is read where fit.js reads it.
const fitBlocked = await page.evaluate(async () => (await (await fetch('/api/slots/buffered?kind=fit')).json()).blocked || []).catch(() => null);
// NEGATIVE CONTROL (run 2026-10-17): book.js's `if (blocked.length) slots = slots.filter((s) => !blocked.includes(s.id));` taken out made this read
//   FAIL  his own booking hides his times and free calls inside his three hours, and nothing outside them
ok('his own booking hides his times and free calls inside his three hours, and nothing outside them',
  hisBooked.status === 200 && !hisSlots.includes('slot-1') && !hisSlots.includes('slot-2') && !hisSlots.includes('slot-3')
  && hisSlots.includes('slot-4') && JSON.stringify((fitBlocked || []).sort()) === JSON.stringify(['fit-2', 'fit-3']),
  JSON.stringify({ hisBooked: hisBooked.status, hisSlots, fitBlocked }));

console.log('\n--- F. her own settings ---');
await page.context().addCookies([{ name: 'pa_demo', value: 'advocate', domain: '127.0.0.1', path: '/' }]);
await page.goto(`${P}/admin.html?demo=advocate`, { waitUntil: 'networkidle' });
await settle(2500);
await tryStep(async () => { await page.evaluate(() => document.querySelector('.cog-btn')?.scrollIntoView({ block: 'center' })); await page.click('.cog-btn', { timeout: 6000 }); });
await tryStep(() => page.waitForSelector('#pa-settings [data-ssh-link]:not([hidden])', { timeout: 8000 }));
const mine = await page.evaluate(() => ({
  link: document.querySelector('#pa-settings [data-ssh-href]')?.getAttribute('href') || '',
  shown: !document.querySelector('#pa-settings [data-ssh-link]')?.hidden,
  buffer: document.querySelector('#pa-settings [data-ssh-buffer]')?.textContent.trim() || '',
})).catch(() => ({}));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/bookable-f-her-settings.png` });
// NEGATIVE CONTROL (run 2026-10-17): admin-staffsettings.js's `q('[data-ssh-link]').hidden = false;` taken out made this read
//   FAIL  her own settings give her booking link and say the buffer he set, in her own words
ok('her own settings give her booking link and say the buffer he set, in her own words',
  mine.shown && mine.link === `/book.html?advocate=${ANA}` && /within 1 hour before or after another paid appointment of yours\. Eric sets this\./.test(mine.buffer),
  JSON.stringify(mine));

ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
