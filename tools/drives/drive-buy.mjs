// The client's journey, end to end, as a client actually walks it.
//
// Eric, 2026-08-26: "act like a client booking from beginning all the way to
// adding add ons."
//
// Every other drive in here starts already signed in and already holding a
// case. This one starts on the front door with nothing, and it is the only
// test in the repo that answers "can a stranger get from the landing page to
// a paid add-on without getting stuck." Run at PHONE WIDTH, because that is
// where his clients are and where a step that needs scrolling is a step that
// does not get taken.
//
// It also DUMPS EACH SCREEN it passes through, rendered, so the same run that
// proves the journey works produces the material for restyling it. Pass
// PA_DUMP=<dir> to write them.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const DUMP = process.env.PA_DUMP || '';
if (DUMP) mkdirSync(DUMP, { recursive: true });

let pass = 0, fail = 0;
const errs = [];
const ok = (n, c, d = '') => {
  if (c) { pass++; console.log('  ok   ', n, d ? `— ${d}` : ''); }
  else { fail++; console.log('  FAIL ', n, d ? `— ${d}` : ''); }
};
const screens = [];

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
// A real phone, not a narrow desktop: 390x844 is an iPhone 14/15.
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(e.message));

/** Record what the client is looking at right now. */
async function capture(name) {
  const shot = await page.evaluate(() => ({
    title: document.title,
    url: location.pathname + location.search,
    html: document.body.innerHTML,
    text: document.body.innerText,
    scrollH: document.documentElement.scrollHeight,
  }));
  screens.push({ name, ...shot, viewport: '390x844' });
  if (DUMP) {
    writeFileSync(`${DUMP}/${screens.length}-${name}.html`, shot.html);
    await page.screenshot({ path: `${DUMP}/${screens.length}-${name}.png`, fullPage: true });
  }
  return shot;
}

// ---- 1. the front door ----------------------------------------------------
console.log('--- the front door ---');
await page.goto(`${P}/index.html?demo=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const home = await capture('landing');
ok('the landing page loads', home.text.length > 400, `${home.text.length} chars`);
ok('and offers a way to book', await page.evaluate(() =>
  !!document.querySelector('a[href*="book.html"]')));
// The maintenance scrim stands down for the demo on purpose; if it ever did
// not, every check below would fail for a reason that has nothing to do with
// booking.
ok('no maintenance scrim is in the way', !(await page.evaluate(() =>
  !!document.querySelector('.pa-maint'))));

// ---- 2. step 1: your time -------------------------------------------------
console.log('\n--- step 1: your time ---');
await page.goto(`${P}/book.html?demo=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
const s1 = await capture('book-1-time');
const rail = await page.evaluate(() =>
  [...document.querySelectorAll('#crumbs *')].map((e) => e.textContent.trim())
    .filter((t) => /Your time|One agreement|Payment/.test(t)));
ok('the three steps are named up front', rail.length >= 3, rail.join(' / '));
const stepText = await page.evaluate(() => document.getElementById('step')?.innerText || '');
ok('step 1 asks for a time', /when should we talk|times|appointment/i.test(stepText),
  stepText.slice(0, 80).replace(/\n/g, ' '));

// FINDING, NOT A FAILURE, and it is Eric's call rather than mine: there is no
// price ANYWHERE on step 1. A client chooses a time before learning what it
// costs, and first sees the number at Payment, two steps in. That may be a
// deliberate commitment ladder or it may be an oversight; either way a test
// should not quietly assert whichever one I happened to assume. So it is
// reported as a note, and what IS asserted below is the thing that must be
// true whatever he decides: the price is on screen before the card is.
const step1Prices = (s1.text.match(/\$[\d,]+/g) || []);
console.log(`  note  prices shown on step 1: ${step1Prices.length ? step1Prices.join(' ') : 'NONE'}`);
console.log(`  note  step 1 is ${s1.scrollH}px tall on a 844px screen, so ${(s1.scrollH / 844).toFixed(1)} screens of scrolling`);

// ---- 3. pick a time, and walk the rest of the flow -----------------------
console.log('\n--- picking a time and moving on ---');
// A time slot is a button inside the step, not a generic Continue. Clicking
// through page.evaluate tore the execution context down mid-call when the
// step re-rendered; Playwright's own click waits for that properly.
const slot = page.locator('#step button').filter({ hasText: /AM|PM/ }).first();
ok('there are times to choose from', await slot.count() > 0);
if (await slot.count()) {
  await slot.click();
  await page.waitForTimeout(1200);
}

// Step 1 is not just a calendar: Continue stays disabled until he has also
// given his real name and date of birth and ticked phone consent. A first
// pass clicked a slot, saw the step unchanged and called it broken; it was
// not broken, it was waiting for the rest of the form. This is what a client
// actually has to do.
const cont = page.locator('#continue');
console.log(`  note  Continue disabled after picking a time alone: ${await cont.isDisabled()}`);
if (await page.locator('#pf-first').count()) {
  await page.fill('#pf-first', 'Jordan');
  await page.fill('#pf-last', 'Avery');
  await page.fill('#pf-dob', '1988-03-14');
}
// The call method, and the phone number it needs. This is where the drive
// first got stuck, and it got stuck the way a client would: Continue was
// ENABLED, tapping it did nothing visible, and the reason ("Enter a valid
// phone number so I can reach you for the call.") was an error element on a
// page 3.2 screens tall. Worth Eric knowing: the button does not disable
// itself for a missing phone number the way it does for a missing time.
if (await page.locator('#phone-row').count()) {
  const hidden = await page.locator('#phone-row').isHidden();
  if (hidden) {
    // A method selector decides whether the number is even asked for.
    const sel = page.locator('#step select, #step input[type="radio"]').first();
    if (await sel.count()) { await sel.selectOption({ label: /phone/i }).catch(() => {}); }
  }
  if (await page.locator('#phone').isVisible().catch(() => false)) {
    await page.fill('#phone', '+1 555 555 5555');
  }
}
if (await page.locator('#phone-consent').count()) {
  await page.check('#phone-consent');
}
await page.waitForTimeout(600);
const blockedStill = await cont.isDisabled();
ok('Continue is open once the form is complete', !blockedStill,
  blockedStill ? 'still disabled' : 'enabled');
await cont.click();
await page.waitForTimeout(2500);
const stuckOn = await page.evaluate(() => [...document.querySelectorAll('.error')]
  .filter((e) => !e.hidden).map((e) => e.textContent.trim().slice(0, 90)));
if (stuckOn.length) console.log(`  note  refused with: ${stuckOn.join(' | ')}`);
ok('and tapping it actually moves him off step 1', stuckOn.length === 0,
  stuckOn.join(' | '));
const s2 = await capture('book-2-agreement');
const step2 = await page.evaluate(() => document.getElementById('step')?.innerText || '');
ok('choosing a time moves him on', step2 !== stepText, step2.slice(0, 70).replace(/\n/g, ' '));
ok('and step 2 is the agreement', /agree|terms|consent|sign/i.test(step2),
  step2.slice(0, 70).replace(/\n/g, ' '));
console.log(`  note  the agreement is ${s2.scrollH}px tall, ${(s2.scrollH / 844).toFixed(1)} screens`);
console.log(`  note  and about ${step2.split(/\s+/).filter(Boolean).length} words to read`);

// Everything an agreement step can gate on: a checkbox, a scroll, a signature.
const gates = await page.evaluate(() => ({
  checkboxes: document.querySelectorAll('#step input[type="checkbox"]').length,
  canvas: document.querySelectorAll('#step canvas').length,
  disabled: [...document.querySelectorAll('#step button')]
    .filter((x) => x.disabled).map((x) => x.textContent.trim().slice(0, 30)),
}));
console.log(`  note  agreement gates: ${gates.checkboxes} checkbox(es), ${gates.canvas} signature pad(s), blocked: ${gates.disabled.join(' / ') || 'nothing'}`);
ok('the page did not break getting here', errs.length === 0, errs.slice(0, 2).join(' | '));
ok('and Continue is BLOCKED until he has actually agreed', gates.disabled.length > 0,
  'nothing gates the agreement');

// ---- 3b. read the agreement, then pay ------------------------------------
console.log('\n--- signing it, and reaching payment ---');
// Four parts, four ticks. Each may need its section opened first, which is
// the point of the design: he cannot tick what he has not unfolded.
// THE REAL GATE, which is not the tick box: each part's checkbox stays
// DISABLED until that part's body has been scrolled to its end (book.js:552).
// So a client has to open all four and read to the bottom of each. That is
// deliberate, and it is also the single most abandonable thing in the flow,
// so the drive does exactly what a client must and reports what it costs.
const nBoxes = await page.locator('#step input[type="checkbox"]').count();
const gate = await page.evaluate(async () => {
  const out = { opened: 0, scrolled: 0, words: 0 };
  const parts = [...document.querySelectorAll('#step details')];
  for (const d of parts) {
    d.open = true;
    out.opened++;
    await new Promise((r) => setTimeout(r, 120));
    // Whatever inside it actually scrolls.
    const body = [...d.querySelectorAll('*')]
      .find((e) => e.scrollHeight > e.clientHeight + 8) || d;
    out.words += (body.innerText || '').split(/\s+/).filter(Boolean).length;
    body.scrollTop = body.scrollHeight;
    body.dispatchEvent(new Event('scroll', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 120));
    const box = d.querySelector('.agreement-check input');
    if (box && !box.disabled) out.scrolled++;
  }
  return out;
});
console.log(`  note  ${gate.opened} parts, ${gate.words} words to read to the end`);
ok(`reading to the end of each part unlocks its tick box`,
  gate.scrolled === gate.opened, `${gate.scrolled}/${gate.opened} unlocked`);
for (let i = 0; i < nBoxes; i++) {
  await page.locator('#step input[type="checkbox"]').nth(i).check().catch(() => {});
}
await page.waitForTimeout(700);
const cont2 = page.locator('#continue');
const stillBlocked = await cont2.isDisabled().catch(() => true);
ok(`ticking all ${nBoxes} parts unlocks Continue`, !stillBlocked,
  stillBlocked ? 'still blocked' : 'unlocked');
if (!stillBlocked) { await cont2.click(); await page.waitForTimeout(2500); }

const s3 = await capture('book-3-payment');
const step3 = await page.evaluate(() => document.getElementById('step')?.innerText || '');
ok('he reaches the payment step', /pay|card|checkout|total/i.test(step3),
  step3.slice(0, 70).replace(/\n/g, ' '));
// THE CHECK THAT MATTERS whatever Eric decides about step 1: the number is on
// screen before the card is.
const payPrices = (step3.match(/\$[\d,]+/g) || []);
ok('and the price is on screen BEFORE the card is', payPrices.length > 0,
  payPrices.join(' ') || 'no price anywhere on the payment step');
console.log(`  note  payment step shows: ${payPrices.join(' ') || 'NO PRICE'}`);

// ---- 4. the case a client ends up with ------------------------------------
console.log('\n--- the case they end up with ---');
await page.goto(`${P}/case.html?demo=1`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
const cs = await capture('case');
ok('the case page loads for a client', cs.text.length > 300, `${cs.text.length} chars`);
const tabs = await page.evaluate(() =>
  [...document.querySelectorAll('.folder-tabs .ftab')].map((t) => t.dataset.page));
ok('and it has its tabs', tabs.length > 0, tabs.join(' '));
ok('including the add-ons page he sells from', tabs.includes('addons'), tabs.join(' '));

// ---- 5. the add-ons -------------------------------------------------------
console.log('\n--- add-ons ---');
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="addons"]')?.click());
await page.waitForTimeout(2500);
const ad = await capture('addons');
ok('the add-ons page renders', /add|follow|upgrade|extend/i.test(ad.text), ad.text.slice(0, 100));
const buys = await page.evaluate(() =>
  [...document.querySelectorAll('[data-buy-followup],[data-buy-upgrade],[data-buy-extend]')]
    .map((x) => ({ what: x.dataset.buyFollowup !== undefined ? 'follow-up'
      : x.dataset.buyUpgrade !== undefined ? 'upgrade' : 'extend',
      label: (x.textContent || '').trim(), disabled: x.disabled })));
ok('there is something to buy', buys.length > 0, JSON.stringify(buys));
console.log(`  note  offers: ${buys.map((x) => `${x.what}${x.disabled ? ' (disabled)' : ''}`).join(', ') || 'none'}`);
ok('and each offer says its price', /\$[\d,]+/.test(ad.text),
  (ad.text.match(/\$[\d,]+/g) || []).slice(0, 5).join(' '));

// ---- 6. nothing admin leaked along the way -------------------------------
console.log('\n--- and none of it showed him anything of Eric\'s ---');
const all = screens.map((s) => s.text).join('\n');
for (const [what, re] of [
  ['no call document', /REVIEW BEFORE YOU CALL|QUESTIONS THAT ARE MISSING/],
  ['no working diagnosis', /working diagnosis|differential/i],
  ['nothing from the private shelf', /precall|prep sheet/i],
]) ok(what, !re.test(all));

if (DUMP) {
  writeFileSync(`${DUMP}/screens.json`, JSON.stringify(screens, null, 2));
  console.log(`\n  dumped ${screens.length} screens to ${DUMP}`);
}
console.log(`\n${pass} ok, ${fail} FAIL`);
if (errs.length) console.log('page errors:', errs.slice(0, 3));
await b.close();
process.exit(fail ? 1 : 0);
