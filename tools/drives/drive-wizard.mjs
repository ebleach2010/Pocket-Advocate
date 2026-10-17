// drive-wizard.mjs - Add an advocate, page by page, on his phone (v7.68).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-wizard.mjs
//
// Eric, 2026-10-17: "When I add an advocate, it should go page by page through everything I asked I could toggle on
// or off, their pricing, their initial schedule, profile picture, bio, any extra tiers or add-ons and their pricing,
// their pay preferences and if ACH their routing # and account # (assuming this is encrypted enough for that info to
// be safe) etc"
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
const where = () => page.evaluate(() => {
  const f = document.querySelector('dialog[open] form[data-wizard]');
  const d = document.querySelector('dialog[open]');
  return { step: f?.dataset.wizard || '', title: document.querySelector('dialog[open] .wz-title')?.textContent.trim() || '', err: document.querySelector('dialog[open] [data-err]:not([hidden])')?.textContent.trim() || '', sideways: d ? d.scrollWidth > d.clientWidth + 1 : true };
}).catch(() => ({}));
const next = async () => { await tryStep(() => page.click(`${sheet} [data-next]`, { timeout: 4000 })); await page.waitForTimeout(300); };

await page.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1800);

console.log('\n--- A. page by page ---');
await tryStep(() => page.click('[data-add-adv]', { timeout: 5000 }));
await tryStep(() => page.waitForSelector(`${sheet} form#adv-add`, { timeout: 8000 }));
const seen = [];
const sideways = [];
seen.push(await where());
// Next on an empty first page stays, and says why.
await next();
const stayed = await where();
await tryStep(() => page.fill(`${sheet} [name="name"]`, 'Jordan Park'));
await tryStep(() => page.fill(`${sheet} [name="email"]`, 'jordan.park@advocate.demo'));
await tryStep(() => page.fill(`${sheet} [name="password"]`, 'first-pass-123'));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/wizard-1-who.png` });
await next();
seen.push(await where());
// What they offer: Full-Service off, their own Advocacy Case price, at most 4 at once.
await tryStep(() => page.uncheck(`${sheet} [data-offer="full"]`));
await tryStep(() => page.fill(`${sheet} [data-rate="caseCents"]`, '1950'));
await tryStep(() => page.fill(`${sheet} [data-cap]`, '4'));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/wizard-2-offer.png` });
await next();
seen.push(await where());
// Add-ons: attending at $450, and one of his own.
await tryStep(() => page.check(`${sheet} [data-addon-on="attend"]`));
await tryStep(() => page.fill(`${sheet} [data-addon-price="attend"]`, '450'));
await tryStep(() => page.click(`${sheet} [data-add-custom]`));
await tryStep(() => page.fill(`${sheet} [data-custom] [data-c-label]`, 'Medicare paperwork'));
await tryStep(() => page.fill(`${sheet} [data-custom] [data-c-price]`, '150'));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/wizard-3-addons.png` });
await next();
seen.push(await where());
// Their week: Friday off, Saturday morning on; Eastern.
await tryStep(() => page.uncheck(`${sheet} [data-day="fri"]`));
await tryStep(() => page.check(`${sheet} [data-day="sat"]`));
await tryStep(() => page.fill(`${sheet} [data-from="sat"]`, '09:00'));
await tryStep(() => page.fill(`${sheet} [data-to="sat"]`, '12:00'));
await tryStep(() => page.selectOption(`${sheet} [data-tz]`, 'America/New_York'));
await tryStep(() => page.fill(`${sheet} [data-response]`, 'I reply within one business day'));
sideways.push((await where()).sideways);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/wizard-4-hours.png` });
await next();
seen.push(await where());
await tryStep(() => page.fill(`${sheet} [name="credentials"]`, 'RN, BCPA'));
await tryStep(() => page.fill(`${sheet} [name="bio"]`, 'Ten years in neurology clinics.'));
await next();
seen.push(await where());
// Pay: their share, then a bad routing number stays on the page.
await tryStep(() => page.fill(`${sheet} [name="commissionPct"]`, '58'));
await tryStep(() => page.selectOption(`${sheet} [data-pay-method]`, 'ach'));
await tryStep(() => page.fill(`${sheet} [data-pf="name"]`, 'Jordan Park'));
await tryStep(() => page.fill(`${sheet} [data-pf="routing"]`, '12345'));
await tryStep(() => page.fill(`${sheet} [data-pf="account"]`, '000123456789'));
await next();
const badBank = await where();
await tryStep(() => page.fill(`${sheet} [data-pf="routing"]`, '021000021'));
const safeNote = await page.evaluate(() => document.querySelector('dialog[open] .wz-safe')?.textContent.trim() || '').catch(() => '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/wizard-6-pay.png` });
await next();
seen.push(await where());
const review = await page.evaluate(() => [...document.querySelectorAll('dialog[open] .wz-review li')].map((li) => li.textContent.replace(/\s+/g, ' ').trim())).catch(() => []);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/wizard-7-review.png` });
// NEGATIVE CONTROL (run 2026-10-17): the pay page's `routing.length !== 9` made `routing.length < 4` (a five digit routing number let through) made this read
//   FAIL  seven pages in order on his phone, none running sideways; a page with a gap or a bad number stays put and says why; the bank note is plain
ok('seven pages in order on his phone, none running sideways; a page with a gap or a bad number stays put and says why; the bank note is plain',
  seen.map((s) => s.step).join() === 'who,offer,addons,hours,profile,pay,review' && seen.every((s) => s.sideways === false) && !sideways.some(Boolean)
  && stayed.step === 'who' && /name/i.test(stayed.err) && badBank.step === 'pay' && /9 digit routing/.test(badBank.err)
  && /encrypted before they are stored/.test(safeNote),
  JSON.stringify({ seen: seen.map((s) => s.step), stayed, badBank: badBank.err }));
// NEGATIVE CONTROL (run 2026-10-17): the review's offer summary (`if (id === 'offer') {`) made to return '' made this read
//   FAIL  the last page reads back every page before he adds them
ok('the last page reads back every page before he adds them',
  review.length === 6 && /No Full-Service/.test(review[1]) && /\$1,950/.test(review[1]) && /attending \$450/.test(review[2]) && /Medicare paperwork \$150/.test(review[2])
  && /Sat 09:00 to 12:00/.test(review[3]) && /Eastern/.test(review[3]) && /58% share\. Direct deposit \(ACH\)/.test(review[5]),
  JSON.stringify(review));

console.log('\n--- B. added, and open again from their photo ---');
await tryStep(() => page.click(`${sheet} [data-finish]`, { timeout: 4000 }));
await tryStep(() => page.waitForSelector('dialog.tm-sheet', { state: 'detached', timeout: 8000 }));
await page.waitForTimeout(1200);
const said = (await page.textContent('#adv-said').catch(() => '')) || '';
const card = await page.evaluate(() => [...document.querySelectorAll('.tm-card')].find((c) => /Jordan Park/.test(c.textContent))?.dataset.uid || '').catch(() => '');
const stored = await page.evaluate(async (uid) => {
  const out = await fetch('/api/admin/advocates', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'get', uid }) }).then((r) => r.json()).catch(() => ({}));
  return out;
}, card).catch(() => ({}));
await tryStep(() => page.click(`.tm-card[data-uid="${card}"] [data-face]`, { timeout: 4000 }));
await tryStep(() => page.waitForSelector(`${sheet} .wz-dot`, { timeout: 8000 }));
await tryStep(() => page.click(`${sheet} .wz-dot[aria-label="Their share and pay"]`, { timeout: 4000 }));
await page.waitForTimeout(300);
const payPage = await page.evaluate(() => ({ text: document.querySelector('dialog[open] .wz-body')?.textContent.replace(/\s+/g, ' ') || '', change: !!document.querySelector('dialog[open] [data-pay-change]'), fields: document.querySelectorAll('dialog[open] [data-pf]').length })).catch(() => ({}));
await tryStep(() => page.click(`${sheet} .wz-dot[aria-label="What they offer"]`, { timeout: 4000 }));
await page.waitForTimeout(300);
const offerPage = await page.evaluate(() => ({ full: document.querySelector('dialog[open] [data-offer="full"]')?.checked, caseP: document.querySelector('dialog[open] [data-rate="caseCents"]')?.value })).catch(() => ({}));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/wizard-8-again.png` });
await page.keyboard.press('Escape').catch(() => {});
// NEGATIVE CONTROL (run 2026-10-17): the demo's create leaving out `settings: set.value,` made this read
//   FAIL  adding them keeps every page, and their photo opens the same pages with it all, the bank numbers only as their last four
ok('adding them keeps every page, and their photo opens the same pages with it all, the bank numbers only as their last four',
  /^Done\./.test(said) && !!card && stored.settings?.offers?.full === false && stored.settings?.rates?.caseCents === 195000 && stored.settings?.fullCap === 4
  && stored.settings?.hours?.sat?.from === '09:00' && stored.settings?.hours?.fri === null && stored.advocate?.tz === 'America/New_York'
  && stored.addons?.attend?.cents === 45000 && stored.addons?.custom?.[0]?.label === 'Medicare paperwork' && stored.payout?.hint === 'Checking ending 6789'
  && !JSON.stringify(stored).includes('021000021') && /Checking ending 6789/.test(payPage.text) && payPage.change && payPage.fields === 0
  && offerPage.full === false && offerPage.caseP === '1950',
  JSON.stringify({ said, card, settings: stored.settings, payout: stored.payout, payPage, offerPage }));

console.log('\n--- C. a small phone ---');
await page.setViewportSize({ width: 320, height: 640 });
await tryStep(() => page.click('[data-add-adv]', { timeout: 5000 }));
await tryStep(() => page.waitForSelector(`${sheet} form#adv-add`, { timeout: 8000 }));
const small = [];
await tryStep(() => page.fill(`${sheet} [name="name"]`, 'Small Screen'));
await tryStep(() => page.fill(`${sheet} [name="email"]`, 'small@advocate.demo'));
await tryStep(() => page.fill(`${sheet} [name="password"]`, 'first-pass-123'));
for (let i = 0; i < 6; i++) {
  const w2 = await page.evaluate(() => {
    const d = document.querySelector('dialog[open]');
    return { step: document.querySelector('dialog[open] form[data-wizard]')?.dataset.wizard, wide: d ? d.scrollWidth > d.clientWidth + 1 : true, page: document.documentElement.scrollWidth > innerWidth + 1, foot: !!document.querySelector('dialog[open] [data-next], dialog[open] [data-finish]') };
  }).catch(() => ({}));
  small.push(w2);
  await next();
}
if (SHOTS) await page.screenshot({ path: `${SHOTS}/wizard-9-320.png` });
await page.keyboard.press('Escape').catch(() => {});
// NEGATIVE CONTROL (run 2026-10-17): `.wz-day { grid-template-columns: 7.5rem minmax(0, 1fr); }` made `22rem 1fr` made this read
//   FAIL  on a small phone every page fits, nothing runs sideways, and Next is always there
ok('on a small phone every page fits, nothing runs sideways, and Next is always there',
  small.length === 6 && small.every((s) => s.wide === false && s.page === false && s.foot), JSON.stringify(small));

ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
