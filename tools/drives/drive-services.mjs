// drive-services.mjs - a contractor's own service, on his phone: he turns it on, a client buys it, it opens a case
// with no time, and she asks for another from her settings (v7.74).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-services.mjs
//
// Eric, 2026-10-17: "Allow me to turn different tiers on and off for each contractor (including new tier types that a
// contractor wants during onboarding)." One-time or monthly: "Either, their choice". A one-time one: "Opens a case, no
// time". Driven in the admin demo at 390px: on Ana's card in Employer mode he adds Records review at $300, ticked;
// her booking page lists it; its own page asks for no time; the payment step names it and holds the card; the case it
// opens runs on its own steps and sits on his shelf under OWN SERVICES; and in her own demo she asks for another one
// from her settings, which waits for him. And a monthly one (v7.75, "Like Full-Service"): on sale a month at a time, its
// case on its own month, another month asked for once it ends, and his yes opening the case again.
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
// The real sign-in module cannot load on a local Worker; every drive passes over that one.
page.on('pageerror', (e) => { const s = String(e); if (!/firebase-real/.test(s)) errs.push(s.slice(0, 200)); });
const sheet = 'dialog.tm-sheet[open]';
const ANA = 'demo-advocate';
const settle = async (ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Close|Maybe later|Later|Skip)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; }).catch(() => false);
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
const rows = () => page.evaluate((s) => [...document.querySelectorAll(`${s} [data-service]`)].map((r) => ({
  on: !!r.querySelector('[data-s-on]')?.checked, label: r.querySelector('[data-s-label]')?.value || '',
  kind: r.querySelector('[data-s-kind]')?.value || '', price: r.querySelector('[data-s-price]')?.value || '',
})), sheet).catch(() => []);
const caseDoc = () => page.evaluate(() => { try { const s = JSON.parse(localStorage.getItem('pa-demo-store') || '{}'); const e = (s.docs || []).find(([p]) => p === 'cases/demo-case-booked'); return e ? e[1] : null; } catch { return null; } });

console.log('\n--- A. he adds it on her card ---');
await page.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await openOffers();
const box = await page.evaluate((s) => ({ there: !!document.querySelector(`${s} [data-services]`), rows: document.querySelectorAll(`${s} [data-service]`).length }), sheet).catch(() => ({}));
await tryStep(() => page.click(`${sheet} [data-add-service]`, { timeout: 4000 }));
await page.waitForTimeout(300);
await tryStep(() => page.fill(`${sheet} [data-service]:last-of-type [data-s-label]`, 'Records review', { timeout: 3000 }));
await tryStep(() => page.fill(`${sheet} [data-service]:last-of-type [data-s-price]`, '300', { timeout: 3000 }));
await tryStep(() => page.fill(`${sheet} [data-service]:last-of-type [data-s-about]`, 'Your records read, sorted and summed up for you.', { timeout: 3000 }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-1-card.png` });
await tryStep(() => page.click(`${sheet} [data-save]`, { timeout: 4000 }));
await page.waitForTimeout(1500);
await openOffers();
const saved = await rows();
// NEGATIVE CONTROL (run 2026-10-17): the wizard's update sending `payout, services }` as `payout }` made this read
//   FAIL  her card has a box for her own services; one he adds is ticked and reads back on at $300
ok('her card has a box for her own services; one he adds is ticked and reads back on at $300',
  box.there === true && box.rows === 0 && saved.length === 1 && saved[0].on === true && saved[0].label === 'Records review' && saved[0].kind === 'once' && saved[0].price === '300',
  JSON.stringify({ box, saved }));

console.log('\n--- B. her booking page lists it ---');
await page.goto(`${P}/book.html?advocate=${ANA}&demo=admin`, { waitUntil: 'networkidle' });
await tryStep(() => page.waitForSelector('[data-adv-service]', { timeout: 8000 }));
const listed = await page.evaluate(() => { const a = document.querySelector('[data-adv-service]'); return { text: (a?.textContent || '').replace(/\s+/g, ' ').trim(), href: a?.getAttribute('href') || '' }; });
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-2-booking.png` });
// NEGATIVE CONTROL (run 2026-10-17): the demo rates' `chatOffered, services }` made `chatOffered, services: [] }` made this read
//   FAIL  her booking page lists it by name and price, with its line, and links to its own page
ok('her booking page lists it by name and price, with its line, and links to its own page',
  /^Records review \$300 Your records read, sorted and summed up for you\.$/.test(listed.text) && new RegExp(`^/book\\.html\\?advocate=${ANA}&service=s[a-z0-9]{8}$`).test(listed.href),
  JSON.stringify(listed));

console.log('\n--- C. its own page asks for no time ---');
await page.goto(`${P}${listed.href || '/book.html'}&demo=admin`, { waitUntil: 'networkidle' });
await tryStep(() => page.waitForSelector('[data-svc-pick]', { timeout: 8000 }));
await page.waitForTimeout(400);
const own = await page.evaluate(() => ({
  h1: document.querySelector('#step h1, h1')?.textContent.trim() || '',
  intro: document.getElementById('time-intro')?.textContent.replace(/\s+/g, ' ').trim() || '',
  pick: document.querySelector('[data-svc-pick]')?.textContent.trim() || '',
  chips: !!document.getElementById('chips'), slots: document.querySelectorAll('#days .slot[data-id]').length,
  reach: [...document.querySelectorAll('h2')].some((h) => h.textContent.trim() === 'How to reach you'),
  cont: document.getElementById('continue')?.disabled === false,
  sideways: document.documentElement.scrollWidth > innerWidth + 1,
}));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-3-own-page.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-17): showService's `el.querySelector('#chips')?.remove();` taken out made this read
//   FAIL  its own page names it at its price, asks for no call time or call kind, and can go on at once, nothing sideways
ok('its own page names it at its price, asks for no call time or call kind, and can go on at once, nothing sideways',
  own.h1 === 'Records review' && own.pick === 'Records review, $300' && /There is no call time to pick: once Ana takes it on, you plan the next step together in your case chat\./.test(own.intro)
  && !own.chips && own.slots === 0 && own.reach && own.cont && !own.sideways,
  JSON.stringify(own));

console.log('\n--- D. the details, the agreement, and the payment step ---');
if (await page.$('#pf-first')) {
  await tryStep(() => page.fill('#pf-first', 'Jordan')); await tryStep(() => page.fill('#pf-last', 'Avery')); await tryStep(() => page.fill('#pf-dob', '1980-04-02'));
}
await tryStep(() => page.fill('#phone', '+1 208 555 0100', { timeout: 3000 }));
await tryStep(() => page.check('#phone-consent', { timeout: 3000 }));
await tryStep(() => page.click('#continue', { timeout: 3000 }));
await page.waitForTimeout(1500);
await page.evaluate(async () => {
  for (const d of document.querySelectorAll('#step details')) {
    d.open = true;
    await new Promise((r) => setTimeout(r, 120));
    const body = [...d.querySelectorAll('*')].find((e) => e.scrollHeight > e.clientHeight + 8) || d;
    body.scrollTop = body.scrollHeight;
    body.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
  }
}).catch(() => {});
const boxes = await page.locator('#step input[type="checkbox"]').count();
for (let i = 0; i < boxes; i++) await page.locator('#step input[type="checkbox"]').nth(i).check().catch(() => {});
await page.waitForTimeout(500);
await tryStep(() => page.click('#continue', { timeout: 3000 }));
await page.waitForTimeout(1500);
const pay = await page.evaluate(() => ({
  name: document.querySelector('[data-svc-name]')?.textContent.trim() || '',
  price: document.querySelector('[data-case-price]')?.textContent.trim() || '',
  btn: document.getElementById('pay')?.textContent.trim() || '',
  hold: document.querySelector('[data-hold-line-svc]')?.textContent.replace(/\s+/g, ' ').trim() || '',
  body: document.getElementById('step')?.textContent.replace(/\s+/g, ' ') || '',
  sideways: document.documentElement.scrollWidth > innerWidth + 1,
}));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-4-payment.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-17): renderPayment's `if (state.service) return renderServicePayment();` taken out made this read
//   FAIL  the payment step names it at $300 with no call time, and says her name on the card hold
ok('the payment step names it at $300 with no call time, and says her name on the card hold',
  pay.name === 'Records review' && pay.price === '$300' && pay.btn === 'Pay $300 and book' && /No call time: you plan the next step together in your case chat\./.test(pay.body)
  && /^Your card is held today, not charged\. Ana reads every new case before taking it on/.test(pay.hold) && !pay.sideways,
  JSON.stringify({ ...pay, body: pay.body.slice(0, 160) }));
await tryStep(() => page.click('#pay', { timeout: 3000 }));
await page.waitForURL(/return\.html|case\.html/, { timeout: 15000 }).catch(() => {});
await page.waitForTimeout(1200);

console.log('\n--- E. the case it opens ---');
const made = await caseDoc();
await page.goto(`${P}/case.html?id=demo-case-booked&demo=1`, { waitUntil: 'networkidle' });
await settle(2500);
const client = await page.evaluate(() => ({
  pill: document.querySelector('[data-status-pill]')?.textContent.trim() || '',
  body: (document.body.textContent || '').replace(/\s+/g, ' '),
  chips: [...document.querySelectorAll('[data-case]')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()),
  sideways: document.documentElement.scrollWidth > innerWidth + 1,
}));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-5-case.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-17): stepsOf's `c?.service && !c.fullAccess ? SERVICE_STEPS : ` taken out made this read
//   FAIL  it opens her case with no call time and the card held; the client's page calls it by name and runs on its own steps
ok('it opens her case with no call time and the card held; the client\'s page calls it by name and runs on its own steps',
  made?.appointment === null && made.service?.label === 'Records review' && made.service.cents === 30000 && made.advocateId === ANA && made.charge?.state === 'held'
  && client.pill === 'AWAITING APPROVAL' && /Records review/.test(client.body) && /Taken on\. Plan the next step together in your case chat/.test(client.body)
  && !/Report delivered|Call (held|booked)/.test(client.body) && !client.sideways
  // RE-PINNED 2026-10-17 (first run): the progress card said "Your call is booked." and the switcher said "Case"; the page
  // also offered a video join link. A service has no call.
  // NEGATIVE CONTROL (run 2026-10-17): cheerCard's `c.service && !closed ? CHEER.service : ` taken out made this read FAIL.
  && /Your case is open\. Plan the next step together in your case chat\. \d of 4 steps done/.test(client.body) && !/Your call is booked|join link/.test(client.body)
  && client.chips.includes('Records review'),
  JSON.stringify({ made: made && { appointment: made.appointment, service: made.service, charge: made.charge?.state }, pill: client.pill }));

console.log('\n--- F. his shelf ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
const shelf = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a[href*="admin-case"]')].find((x) => /demo-case-booked/.test(x.getAttribute('href') || ''));
  const sec = [...document.querySelectorAll('h2, h3, .shelf-head, [data-section]')].map((h) => h.textContent.replace(/\s+/g, ' ').trim()).filter((t) => /OWN SERVICES/.test(t));
  return { row: (a?.closest('li, .row, .case-row, div')?.textContent || '').replace(/\s+/g, ' ').trim(), heads: sec };
});
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-6-shelf.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-17): the shelf's section('OWN SERVICES' made section('OWN SERVICEZ' made this read
//   FAIL  his shelf files it under OWN SERVICES by its name, asking him to approve or decline the hold
ok('his shelf files it under OWN SERVICES by its name, asking him to approve or decline the hold',
  shelf.heads.length > 0 && /APPROVE OR DECLINE/.test(shelf.row) && /Records review/.test(shelf.row),
  JSON.stringify(shelf));

await page.goto(`${P}/admin-case.html?id=demo-case-booked&demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); }).catch(() => {});
await page.waitForTimeout(600);
const card = await page.evaluate(() => ({
  text: (document.body.innerText || '').replace(/\s+/g, ' '),
  approve: !!document.querySelector('[data-charge-card]'),
}));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-6b-his-case.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-17): the overview's `if (c.service && !start) row('SERVICE', ...); else ` taken out made this read
//   FAIL  his case page names the service where the call would be, owes no report, and opens on approve or decline
ok('his case page names the service where the call would be, owes no report, and opens on approve or decline',
  /SERVICE Records review · no call time/.test(card.text) && /REPORT none owed: their own service/.test(card.text) && !/no appointment|clock starts at/.test(card.text) && card.approve,
  card.text.slice(card.text.indexOf('CONTACT'), card.text.indexOf('CONTACT') + 220));

console.log('\n--- G. she asks for another from her settings ---');
await page.context().addCookies([{ name: 'pa_demo', value: 'advocate', domain: '127.0.0.1', path: '/' }]);
await page.goto(`${P}/admin.html?demo=advocate`, { waitUntil: 'networkidle' });
await settle(2500);
await tryStep(async () => { await page.evaluate(() => document.querySelector('.cog-btn')?.scrollIntoView({ block: 'center' })); await page.click('.cog-btn', { timeout: 6000 }); });
await tryStep(() => page.waitForSelector('#pa-settings [data-svc-save]:not([disabled])', { timeout: 8000 }));
await tryStep(() => page.click('#pa-settings [data-svc-add]', { timeout: 3000 }));
await tryStep(() => page.fill('#pa-settings [data-svc]:last-of-type [data-svc-label]', 'Appeal letter', { timeout: 3000 }));
await tryStep(() => page.fill('#pa-settings [data-svc]:last-of-type [data-svc-price]', '450', { timeout: 3000 }));
await tryStep(() => page.click('#pa-settings [data-svc-save]', { timeout: 3000 }));
await page.waitForTimeout(1500);
const asked = await page.evaluate(() => ({
  said: document.querySelector('#pa-settings [data-svc-said]')?.textContent.trim() || '',
  rows: [...document.querySelectorAll('#pa-settings [data-svc]')].map((r) => ({ label: r.querySelector('[data-svc-label]')?.value, state: r.querySelector('[data-svc-state]')?.textContent.trim() })),
  sideways: document.documentElement.scrollWidth > innerWidth + 1,
}));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-7-asked.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-17): the demo settings' `services = sv.value;` taken out made this read
//   FAIL  she asks for one from her settings: it is saved, waits for him, and the page says he is told
ok('she asks for one from her settings: it is saved, waits for him, and the page says he is told',
  asked.rows.some((r) => r.label === 'Appeal letter' && r.state === 'Waiting for Eric to turn it on.')
  && asked.said === 'Saved. Eric is told, and turns it on before clients can buy it.' && !asked.sideways,
  JSON.stringify(asked));

console.log('\n--- H. a monthly one, a month at a time (v7.75) ---');
// Eric, 2026-10-17, on a monthly one: "Like Full-Service". Back on his side: he adds Monthly check-ins at $900 a month.
await page.context().addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
await openOffers();
await tryStep(() => page.click(`${sheet} [data-add-service]`, { timeout: 4000 }));
await page.waitForTimeout(300);
await tryStep(() => page.fill(`${sheet} [data-service]:last-of-type [data-s-label]`, 'Monthly check-ins', { timeout: 3000 }));
await tryStep(() => page.selectOption(`${sheet} [data-service]:last-of-type [data-s-kind]`, 'month', { timeout: 3000 }));
await tryStep(() => page.fill(`${sheet} [data-service]:last-of-type [data-s-price]`, '900', { timeout: 3000 }));
const laterLine = await page.evaluate((s2) => !!document.querySelector(`${s2} [data-s-later]`), sheet).catch(() => true);
await tryStep(() => page.click(`${sheet} [data-save]`, { timeout: 4000 }));
await page.waitForTimeout(1500);
await page.goto(`${P}/book.html?advocate=${ANA}&demo=admin`, { waitUntil: 'networkidle' });
await tryStep(() => page.waitForSelector('[data-adv-service]', { timeout: 8000 }));
const monthly = await page.evaluate(() => { const a = [...document.querySelectorAll('[data-adv-service]')].find((x) => /Monthly check-ins/.test(x.textContent)); return { text: (a?.textContent || '').replace(/\s+/g, ' ').trim(), href: a?.getAttribute('href') || '' }; });
await page.goto(`${P}${monthly.href || '/book.html'}&demo=admin`, { waitUntil: 'networkidle' });
await tryStep(() => page.waitForSelector('[data-svc-pick]', { timeout: 8000 }));
const monthPage = await page.evaluate(() => ({ intro: document.getElementById('time-intro')?.textContent.replace(/\s+/g, ' ').trim() || '', pick: document.querySelector('[data-svc-pick]')?.textContent.trim() || '' }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-8-monthly-page.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-17, v7.75): the demo rates' `['once', 'month'].includes(x.kind)` made `x.kind === 'once'` made this read
//   FAIL  a monthly one goes on sale: his card keeps no not-yet line, her booking page lists it a month at a time, and its page says how its months run
ok('a monthly one goes on sale: his card keeps no not-yet line, her booking page lists it a month at a time, and its page says how its months run',
  !laterLine && /^Monthly check-ins \$900 a month$/.test(monthly.text) && monthPage.pick === 'Monthly check-ins, $900 a month'
  && /It runs a month at a time, from the day Ana takes it on\. When the month ends your case closes, and you can ask for another\./.test(monthPage.intro),
  JSON.stringify({ laterLine, monthly, monthPage }));

// Bought through the demo's own checkout, taken on, and its month run out (what the sweep does at its end).
const svcId = (monthly.href.match(/service=(s[a-z0-9]{8})/) || [])[1] || '';
const boughtM = await page.evaluate(async (b) => {
  const r = await fetch('/api/service-checkout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer demo' }, body: JSON.stringify(b) });
  return { status: r.status, out: await r.json().catch(() => ({})) };
}, { advocate: ANA, service: svcId, quotedCents: 90000, phone: '+1 208 555 0100', acks: { disclaimer: 1, privacy: 1, recording: 1, service: 1, phoneConsent: 1 } });
const madeM = await caseDoc();
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('pa-demo-store') || '{}');
  const e = (s.docs || []).find(([p]) => p === 'cases/demo-case-booked');
  if (e) {
    const past = new Date(Date.now() - 31 * 86_400_000).toISOString();
    e[1] = { ...e[1], charge: { ...e[1].charge, state: 'captured', capturedCents: 90000, decidedAt: past, capturedAt: past },
      status: 'closed', closedFromStatus: 'confirmed', monthEndedAt: new Date().toISOString(), closedAt: new Date().toISOString(), closedReason: 'The month of Monthly check-ins reached its end, so the case wrapped up on schedule.' };
  }
  localStorage.setItem('pa-demo-store', JSON.stringify(s));
});
await page.goto(`${P}/case.html?id=demo-case-booked&demo=1`, { waitUntil: 'networkidle' });
await settle(2500);
await page.evaluate(() => { const t = [...document.querySelectorAll('button, a, [role="tab"]')].find((x) => /^Enhance$/.test((x.textContent || '').trim())); t?.click(); }).catch(() => {});
await page.waitForTimeout(800);
const askCard = await page.evaluate(() => { const c = document.querySelector('[data-month-ask]'); return { state: c?.dataset.monthAsk || '', text: (c?.textContent || '').replace(/\s+/g, ' ').trim(), report: /read your report/.test(document.body.textContent || '') }; });
await tryStep(() => page.click('[data-request-month]', { timeout: 4000 }));
await page.waitForTimeout(1200);
const askedM = await page.evaluate(() => document.querySelector('[data-month-ask]')?.dataset.monthAsk || '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-9-month-ask.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-17, v7.75): extendOffer's `(c.fullAccess || c.serviceMonthly)` made `c.fullAccess` made this read
//   FAIL  bought, it opens a case on its own month; when the month ends the client is offered another of it, in its name, and asking sends it to her
ok('bought, it opens a case on its own month; when the month ends the client is offered another of it, in its name, and asking sends it to her',
  boughtM.status === 200 && madeM?.serviceMonthly === true && madeM.service?.kind === 'month' && madeM.serviceMonths === 1
  // The advocate's first name comes from the live lookup, which a client's demo tab answers with his; the words around it are checked.
  && askCard.state === 'offer' && /Your month of Monthly check-ins has ended\. Ask \w+ for another: the same work and the same file/.test(askCard.text) && askedM === 'pending'
  // RE-PINNED 2026-10-17 (first run): the Enhance tab also offered a follow-up "once you've had time to read your report"; a service has none.
  // NEGATIVE CONTROL (run 2026-10-17, v7.75): followUpOffer's `if (c.service) return '';` taken out made this read FAIL.
  && !askCard.report,
  JSON.stringify({ boughtM: boughtM.status, made: madeM && { monthly: madeM.serviceMonthly, kind: madeM.service?.kind }, askCard, askedM }));

await page.goto(`${P}/admin-case.html?id=demo-case-booked&demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); }).catch(() => {});
await page.waitForTimeout(600);
const hisCard = await page.evaluate(() => ({ req: (document.querySelector('[data-month-request]')?.textContent || '').replace(/\s+/g, ' ').trim(), body: (document.body.innerText || '').replace(/\s+/g, ' ') }));
const yesM = await page.evaluate(async () => {
  const r = await fetch('/api/admin/extend-request', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer demo' }, body: JSON.stringify({ caseId: 'demo-case-booked', decision: 'approve' }) });
  return { status: r.status, out: await r.json().catch(() => ({})) };
});
const openAgain = await caseDoc();
await page.goto(`${P}/case.html?id=demo-case-booked&demo=1`, { waitUntil: 'networkidle' });
await settle(2500);
const clientAgain = await page.evaluate(() => (document.body.textContent || '').replace(/\s+/g, ' '));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/services-10-month-again.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-17, v7.75): the demo decision's `if (c.serviceMonthly === true) {` branch taken out made this read
//   FAIL  his case page asks him about another month of it by name; his yes opens the case again on its second month, and the client reads when it runs through
ok('his case page asks him about another month of it by name; his yes opens the case again on its second month, and the client reads when it runs through',
  /Their month of Monthly check-ins ended and they are asking for another, quoted \$900\./.test(hisCard.req) && /SERVICE Monthly check-ins · month 1, ended/.test(hisCard.body)
  && yesM.status === 200 && openAgain?.status === 'confirmed' && openAgain.serviceMonths === 2 && openAgain.serviceExtraDays >= 30
  && /Your month runs through \w+ \d+\. Plan the next step together in your case chat\./.test(clientAgain),
  JSON.stringify({ req: hisCard.req.slice(0, 160), yesM: yesM.status, open: openAgain && { status: openAgain.status, months: openAgain.serviceMonths } }));

// NEGATIVE CONTROL (run 2026-10-17): `throw new Error('control');` added at the end of book.js made this read
// (one at the end of admin-staffsettings.js is caught by the settings loader, so it reaches no page error)
//   FAIL  no page threw
ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
