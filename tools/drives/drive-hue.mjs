// drive-hue.mjs - the color wheel and Black on a client's phone, and no duty of care note for a contractor (v7.64).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-hue.mjs
//
// Eric, 2026-10-17: "Keep the whole color scheme and gradient, but allow it to be adjusted via a color wheel in
// settings ... Include black, though, which just makes things black background white text for simplicity and those
// with eye sensitivity." And "Don't allow other contractors to draft duty of care notes."
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
async function side(role, width = 390) {
  const ctx = await b.newContext({ viewport: { width, height: 844 } });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${role}: ${String(e).slice(0, 200)}`));
  return page;
}
// The first-run card and any notes card, out of the way.
const settle = async (page, ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => {
      const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Close|Maybe later|Later|Skip|Not now)$/i.test((e.textContent || '').trim()));
      if (x) x.click();
      return !!x;
    }).catch(() => false);
    await page.waitForTimeout(250);
    if (!hit) break;
  }
};
const paint = (page) => page.evaluate(() => {
  const root = document.documentElement;
  const lit = document.querySelector('.btn:not(.quiet):not(.ghost)') || document.body;
  return {
    hue: root.dataset.hue || '',
    prop: root.style.getPropertyValue('--pa-hue'),
    scheme: root.dataset.scheme || '',
    ground: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.body).color,
    lit: getComputedStyle(lit).backgroundImage.slice(0, 90),
  };
}).catch(() => ({}));
const openSettings = async (page) => {
  await page.evaluate(() => { if (!document.getElementById('pa-settings')) document.querySelector('.cog-btn')?.click(); }).catch(() => {});
  return tryStep(() => page.waitForSelector('#pa-settings [data-hue-wheel]', { timeout: 6000 }));
};
const closeSettings = (page) => page.evaluate(() => document.getElementById('pa-settings')?.remove()).catch(() => {});
// A tap on the wheel at this hue (degrees, 0 at the top, clockwise), on its ring.
const tapHue = async (page, hue) => {
  const box = await page.locator('#pa-settings [data-hue-wheel]').boundingBox().catch(() => null);
  if (!box) return false;
  const a = (hue * Math.PI) / 180; const r = box.width * 0.42;
  await page.mouse.click(box.x + box.width / 2 + Math.sin(a) * r, box.y + box.height / 2 - Math.cos(a) * r);
  await page.waitForTimeout(500);
  return true;
};
const WARM_GROUND = 'rgb(30, 21, 25)';

console.log('\n--- A. a client turns the wheel ---');
const cl = await side('client');
await cl.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await settle(cl, 1800);
const first = await paint(cl);
const opened = await openSettings(cl);
const offer = await cl.evaluate(() => {
  const card = document.querySelector('#pa-settings .settings-card');
  return {
    names: [...document.querySelectorAll('#pa-settings .scheme-name')].map((x) => x.textContent.trim()),
    wheel: !!document.querySelector('#pa-settings [data-hue-wheel][role="slider"]'),
    reset: (document.querySelector('#pa-settings [data-hue-reset]')?.textContent || '').trim(),
    black: (document.querySelector('#pa-settings [data-black]')?.textContent || '').replace(/\s+/g, ' ').trim(),
    sideways: card ? card.scrollWidth > card.clientWidth + 1 : true,
  };
}).catch(() => ({}));
if (SHOTS) await cl.screenshot({ path: `${SHOTS}/hue-a-settings.png` });
// NEGATIVE CONTROL (run 2026-10-17): settings.js's wheel markup taken out (`data-hue-wheel` renamed) made this read
//   FAIL  the warm look is the start, and Settings offers the wheel, the way back to warm and Black, and nothing else to pick
ok('the warm look is the start, and Settings offers the wheel, the way back to warm and Black, and nothing else to pick',
  first.hue === '' && first.ground === WARM_GROUND && opened && offer.wheel && offer.names?.join('|') === 'Black'
  && offer.reset === 'Back to the warm look' && /Black background, white text\./.test(offer.black || '') && offer.sideways === false,
  JSON.stringify({ first, opened, offer }));

await tapHue(cl, 200);
const turned = await paint(cl);
const knob = await cl.evaluate(() => Number(document.querySelector('#pa-settings [data-hue-wheel]')?.getAttribute('aria-valuenow'))).catch(() => NaN);
if (SHOTS) await cl.screenshot({ path: `${SHOTS}/hue-b-turned.png` });
// NEGATIVE CONTROL (run 2026-10-17): theme.js's paintHue setting no data-hue made this read
//   FAIL  a tap on the wheel colours the whole look at once: the ground and the gradient both turn, and the knob sits where the finger was
ok('a tap on the wheel colours the whole look at once: the ground and the gradient both turn, and the knob sits where the finger was',
  turned.hue === '144' && turned.prop === '144' && turned.ground !== WARM_GROUND && /^oklch|^rgb|^color/.test(turned.ground || '')
  && turned.lit && turned.lit !== first.lit && Math.abs(knob - 200) <= 6,
  JSON.stringify({ turned, first: first.lit, knob }));

await closeSettings(cl);
await cl.reload({ waitUntil: 'networkidle' });
await settle(cl, 1200);
const kept = await paint(cl);
await cl.goto(`${P}/chat.html?demo=1`, { waitUntil: 'networkidle' }).catch(() => {});
await settle(cl, 1200);
const elsewhere = await paint(cl);
// NEGATIVE CONTROL (run 2026-10-17): the head snippet's `document.documentElement.dataset.hue = String(hue);` taken off case.html made this read
//   FAIL  the colour stays after a reload and on the next page, set before the page paints
ok('the colour stays after a reload and on the next page, set before the page paints',
  kept.hue === '144' && kept.ground === turned.ground && elsewhere.hue === '144' && elsewhere.ground !== WARM_GROUND,
  JSON.stringify({ kept, elsewhere }));

console.log('\n--- B. Black ---');
await cl.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await settle(cl, 1200);
await openSettings(cl);
await tryStep(() => cl.click('#pa-settings [data-black]', { timeout: 3000 }));
await cl.waitForTimeout(500);
const black = await paint(cl);
const dimmed = await cl.evaluate(() => document.querySelector('#pa-settings [data-hue-pick]')?.classList.contains('is-off')).catch(() => false);
if (SHOTS) await cl.screenshot({ path: `${SHOTS}/hue-c-black.png` });
await closeSettings(cl);
await cl.reload({ waitUntil: 'networkidle' });
await settle(cl, 1200);
const blackKept = await paint(cl);
// NEGATIVE CONTROL (run 2026-10-17): the head snippet's `s !== 'contrast' && ` taken off case.html made this read
//   FAIL  Black is a black background with white text, no colour turned into it, and it stays after a reload
ok('Black is a black background with white text, no colour turned into it, and it stays after a reload',
  black.scheme === 'contrast' && black.ground === 'rgb(0, 0, 0)' && /^rgb\((2[3-5]\d), \1, \1\)$/.test(black.ink || '') && black.hue === '' && dimmed
  && blackKept.scheme === 'contrast' && blackKept.ground === 'rgb(0, 0, 0)' && blackKept.hue === '',
  JSON.stringify({ black, dimmed, blackKept }));

await openSettings(cl);
await tapHue(cl, 300);
const outOfBlack = await paint(cl);
await tryStep(() => cl.click('#pa-settings [data-hue-reset]', { timeout: 3000 }));
await cl.waitForTimeout(500);
const warmAgain = await paint(cl);
await closeSettings(cl);
await cl.reload({ waitUntil: 'networkidle' });
await settle(cl, 1200);
const warmKept = await paint(cl);
// NEGATIVE CONTROL (run 2026-10-17): applyHue's `applyScheme('calm');` taken out made this read
//   FAIL  a turn of the wheel leaves Black for that colour, and Back to the warm look is the warm look, kept
ok('a turn of the wheel leaves Black for that colour, and Back to the warm look is the warm look, kept',
  outOfBlack.scheme === 'calm' && outOfBlack.hue === '244' && outOfBlack.ground !== 'rgb(0, 0, 0)'
  && warmAgain.hue === '' && warmAgain.ground === WARM_GROUND && warmKept.hue === '' && warmKept.ground === WARM_GROUND,
  JSON.stringify({ outOfBlack, warmAgain, warmKept }));

const narrow = await side('client', 320);
await narrow.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await settle(narrow, 1500);
await openSettings(narrow);
const fit = await narrow.evaluate(() => {
  const card = document.querySelector('#pa-settings .settings-card');
  const wheel = document.querySelector('#pa-settings [data-hue-wheel]')?.getBoundingClientRect();
  return { sideways: card ? card.scrollWidth > card.clientWidth + 1 : true, wheelIn: !!wheel && wheel.left >= 0 && wheel.right <= innerWidth && wheel.width >= 120 };
}).catch(() => ({}));
if (SHOTS) await narrow.screenshot({ path: `${SHOTS}/hue-d-320.png` });
// NEGATIVE CONTROL (run 2026-10-17): the wheel's width set to 24rem made this read
//   FAIL  on a small phone the wheel fits whole and nothing runs sideways
ok('on a small phone the wheel fits whole and nothing runs sideways', fit.sideways === false && fit.wheelIn, JSON.stringify(fit));

console.log('\n--- C. no duty of care note for a contractor ---');
const ct = await side('advocate');
await ct.goto(`${P}/admin-case.html?id=demo-case-ana&demo=advocate&page=drafts`, { waitUntil: 'networkidle' });
await settle(ct, 2000);
const duty = await ct.evaluate(() => ({
  // The case itself, on screen: a sign-in page would pass every test below.
  onCase: /\/admin-case(\.html)?$/.test(location.pathname) && [...document.querySelectorAll('.ftab[data-page="overview"]')].length > 0,
  tabs: [...document.querySelectorAll('.ftab[data-page]')].map((x) => x.dataset.page).join(' '),
  button: [...document.querySelectorAll('[data-duty]')].some((x) => x.checkVisibility()),
  built: !!document.querySelector('[data-duty]'),
  composer: [...document.querySelectorAll('button')].some((x) => x.checkVisibility() && /⚕/.test(x.textContent || '')),
  drafts: [...document.querySelectorAll('[data-page="drafts"], [data-tab="drafts"]')].some((x) => x.checkVisibility()),
})).catch(() => ({}));
await tryStep(() => ct.click('.ftab[data-page="chat"]', { timeout: 4000 }));
await ct.waitForTimeout(800);
const inChat = await ct.evaluate(() => [...document.querySelectorAll('button')].some((x) => x.checkVisibility() && /⚕/.test(x.textContent || ''))).catch(() => true);
if (SHOTS) await ct.screenshot({ path: `${SHOTS}/hue-e-contractor.png` });
// NEGATIVE CONTROL (run 2026-10-17): admin-case.js's `.filter((p) => !advocate || ADVOCATE_PAGES.has(p.id))` taken off its pages made this read
//   FAIL  a contractor has no duty of care note: not on their strip, not by typing the address, not in the chat composer
ok('a contractor has no duty of care note: not on their strip, not by typing the address, not in the chat composer',
  duty.onCase && !/drafts/.test(duty.tabs) && !duty.button && !duty.built && !duty.composer && !duty.drafts && !inChat, JSON.stringify({ duty, inChat }));

const own = await side('admin');
await own.goto(`${P}/admin-case.html?id=demo-case-ana&demo=admin&page=drafts`, { waitUntil: 'networkidle' });
await settle(own, 2000);
const his = await own.evaluate(() => [...document.querySelectorAll('[data-duty]')].some((x) => x.checkVisibility())).catch(() => false);
// NEGATIVE CONTROL (run 2026-10-17): the Duty of care panel taken off the Drafts page for everyone made this read
//   FAIL  and Eric still has his, one tap from the address
ok('and Eric still has his, one tap from the address', his);

ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
