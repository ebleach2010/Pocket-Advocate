// drive-hue.mjs - three looks (Warm, Blue and green, Black) on a client's phone, buttons that stand off the page,
// and no duty of care note for a contractor (v7.64; the wheel taken out and the buttons raised in v7.66).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-hue.mjs
//
// Eric, 2026-10-17: "Keep the whole color scheme and gradient, but allow it to be adjusted via a color wheel in
// settings ... Include black, though, which just makes things black background white text for simplicity and those
// with eye sensitivity." And "Don't allow other contractors to draft duty of care notes." Then: "The color wheel is
// horrendous. Get rid of it. Have it be either the blue/green from before or this warm look, or just black on white."
// And "Do you notice how the buttons don't look convex at all, and don't stand out compared to normal text? Fix that."
//
// RE-PINNED 2026-10-17 (v7.66): sections A and B drove the wheel; the wheel is gone, so each of their checks now
// drives the three looks in its place, under the same promise (the start, a tap that changes everything at once,
// kept on reload and the next page, Black, the way back, a small phone).
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
  const lit = document.querySelector('.btn.glow') || document.body;
  return {
    hue: root.dataset.hue || '',
    look: root.dataset.look || '',
    scheme: root.dataset.scheme || '',
    ground: getComputedStyle(document.body).backgroundColor,
    ink: getComputedStyle(document.body).color,
    lit: getComputedStyle(lit).backgroundImage.slice(0, 90),
  };
}).catch(() => ({}));
const openSettings = async (page) => {
  await page.evaluate(() => { if (!document.getElementById('pa-settings')) document.querySelector('.cog-btn')?.click(); }).catch(() => {});
  return tryStep(() => page.waitForSelector('#pa-settings [data-scheme]', { timeout: 6000 }));
};
const closeSettings = (page) => page.evaluate(() => document.getElementById('pa-settings')?.remove()).catch(() => {});
const pick = async (page, id) => { await tryStep(() => page.click(`#pa-settings [data-scheme="${id}"]`, { timeout: 3000 })); await page.waitForTimeout(500); };
const WARM_GROUND = 'rgb(30, 21, 25)';
const COOL_GROUND = 'rgb(10, 10, 12)';

console.log('\n--- A. a client picks a look ---');
const cl = await side('client');
await cl.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await settle(cl, 1800);
const first = await paint(cl);
const opened = await openSettings(cl);
const offer = await cl.evaluate(() => {
  const card = document.querySelector('#pa-settings .settings-card');
  return {
    names: [...document.querySelectorAll('#pa-settings .scheme-name')].map((x) => x.textContent.trim()),
    on: [...document.querySelectorAll('#pa-settings [data-scheme].on')].map((x) => x.dataset.scheme).join(),
    wheel: !!document.querySelector('#pa-settings [data-hue-wheel], #pa-settings [role="slider"]'),
    black: (document.querySelector('#pa-settings [data-scheme="contrast"] .scheme-blurb')?.textContent || '').trim(),
    sideways: card ? card.scrollWidth > card.clientWidth + 1 : true,
  };
}).catch(() => ({}));
if (SHOTS) await cl.screenshot({ path: `${SHOTS}/hue-a-settings.png` });
// NEGATIVE CONTROL (run 2026-10-17): settings.js's wheel markup taken out (`data-hue-wheel` renamed) made this read
//   FAIL  the warm look is the start, and Settings offers the wheel, the way back to warm and Black, and nothing else to pick
// RE-PINNED 2026-10-17 (v7.66): the wheel is gone; Settings offers Warm, Blue and green and Black.
// NEGATIVE CONTROL (run 2026-10-17, v7.66): Blue and green taken out of APPEARANCES in theme.js made this read
//   FAIL  the warm look is the start, and Settings offers Warm, Blue and green and Black, and nothing else to pick
// RE-PINNED 2026-10-17 (v7.76): Eric, "Change the standard color for clients and advocates past the main page to
// green/blue that's in settings". Blue and green is the start and is listed first; Warm is a tap away.
// NEGATIVE CONTROL (run 2026-10-17, v7.78): case.html's head line `var cool = localStorage.getItem('pa-look') !== 'warm';` made `=== 'cool'` made this read
//   FAIL  Blue and green is the start, and Settings offers Blue and green, Warm and Black, and nothing else to pick
ok('Blue and green is the start, and Settings offers Blue and green, Warm and Black, and nothing else to pick',
  first.look === 'cool' && first.ground === COOL_GROUND && opened && !offer.wheel && offer.names?.join('|') === 'Blue and green|Warm|Black'
  && offer.on === 'cool' && /^Black background, white text\./.test(offer.black || '') && offer.sideways === false,
  JSON.stringify({ first, opened, offer }));

await pick(cl, 'warm');
const turned = await paint(cl);
if (SHOTS) await cl.screenshot({ path: `${SHOTS}/hue-b-cool.png` });
// NEGATIVE CONTROL (run 2026-10-17): theme.js's paintHue setting no data-hue made this read
//   FAIL  a tap on the wheel colours the whole look at once: the ground and the gradient both turn, and the knob sits where the finger was
// RE-PINNED 2026-10-17 (v7.66): a tap on Blue and green, in place of a turn of the wheel.
// NEGATIVE CONTROL (run 2026-10-17, v7.66): applyAppearance's `if (id === 'cool') document.documentElement.dataset.look = 'cool';` made `void 0;` made this read
//   FAIL  a tap on Blue and green changes the whole look at once: the ground and the gradient both change, and its swatch is the one on
// RE-PINNED 2026-10-17 (v7.76): Blue and green is the start now, so the tap is on Warm.
// NEGATIVE CONTROL (run 2026-10-17, v7.78): applyAppearance's `else delete document.documentElement.dataset.look;` taken out made this read
//   FAIL  a tap on Warm changes the whole look at once: the ground and the gradient both change, and its swatch is the one on
ok('a tap on Warm changes the whole look at once: the ground and the gradient both change, and its swatch is the one on',
  turned.look === '' && turned.hue === '' && turned.ground === WARM_GROUND && turned.lit && turned.lit !== first.lit
  && await cl.evaluate(() => [...document.querySelectorAll('#pa-settings [data-scheme].on')].map((x) => x.dataset.scheme).join()).catch(() => '') === 'warm',
  JSON.stringify({ turned, first: first.lit }));

await closeSettings(cl);
await cl.reload({ waitUntil: 'networkidle' });
await settle(cl, 1200);
const kept = await paint(cl);
await cl.goto(`${P}/chat.html?demo=1`, { waitUntil: 'networkidle' }).catch(() => {});
await settle(cl, 1200);
const elsewhere = await paint(cl);
// NEGATIVE CONTROL (run 2026-10-17): the head snippet's `document.documentElement.dataset.hue = String(hue);` taken off case.html made this read
//   FAIL  the colour stays after a reload and on the next page, set before the page paints
// RE-PINNED 2026-10-17 (v7.66): the look stays, in place of the wheel's colour.
// NEGATIVE CONTROL (run 2026-10-17, v7.66): the head snippet's `if (cool) document.documentElement.dataset.look = 'cool';` taken off case.html made this read
//   FAIL  the look stays after a reload and on the next page, set before the page paints
// RE-PINNED 2026-10-17 (v7.76): the look kept is Warm, picked over the Blue and green start.
// NEGATIVE CONTROL (run 2026-10-17, v7.78): the head snippet's `if (!cool) delete document.documentElement.dataset.look;` taken off case.html made this read
//   FAIL  the look stays after a reload and on the next page, set before the page paints
ok('the look stays after a reload and on the next page, set before the page paints',
  kept.look === '' && kept.ground === WARM_GROUND && elsewhere.look === '' && elsewhere.ground === WARM_GROUND,
  JSON.stringify({ kept, elsewhere }));

console.log('\n--- B. Black ---');
await cl.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await settle(cl, 1200);
await openSettings(cl);
await pick(cl, 'contrast');
const black = await paint(cl);
if (SHOTS) await cl.screenshot({ path: `${SHOTS}/hue-c-black.png` });
await closeSettings(cl);
await cl.reload({ waitUntil: 'networkidle' });
await settle(cl, 1200);
const blackKept = await paint(cl);
// NEGATIVE CONTROL (run 2026-10-17): the head snippet's `s !== 'contrast' && ` taken off case.html made this read
//   FAIL  Black is a black background with white text, no colour turned into it, and it stays after a reload
// RE-PINNED 2026-10-17 (v7.66): picked from its swatch.
// NEGATIVE CONTROL (run 2026-10-17, v7.66): the head snippet's `=== 'contrast' ? 'contrast' : 'calm'` made `=== 'x' ? 'contrast' : 'calm'` on case.html made this read
//   FAIL  Black is a black background with white text, and it stays after a reload
ok('Black is a black background with white text, and it stays after a reload',
  black.scheme === 'contrast' && black.ground === 'rgb(0, 0, 0)' && /^rgb\((2[3-5]\d), \1, \1\)$/.test(black.ink || '')
  && blackKept.scheme === 'contrast' && blackKept.ground === 'rgb(0, 0, 0)',
  JSON.stringify({ black, blackKept }));

await openSettings(cl);
await pick(cl, 'warm');
const warmAgain = await paint(cl);
await closeSettings(cl);
await cl.reload({ waitUntil: 'networkidle' });
await settle(cl, 1200);
const warmKept = await paint(cl);
// NEGATIVE CONTROL (run 2026-10-17): applyHue's `applyScheme('calm');` taken out made this read
//   FAIL  a turn of the wheel leaves Black for that colour, and Back to the warm look is the warm look, kept
// RE-PINNED 2026-10-17 (v7.66): a tap on Warm, in place of the wheel and its Back to the warm look.
// NEGATIVE CONTROL (run 2026-10-17, v7.66, by hand: the runner's run came back empty): applyAppearance's `applyScheme('calm');` taken out made this read
//   FAIL  a tap on Warm leaves Black for the warm look, kept
ok('a tap on Warm leaves Black for the warm look, kept',
  warmAgain.scheme === 'calm' && warmAgain.look === '' && warmAgain.ground === WARM_GROUND
  && warmKept.scheme === 'calm' && warmKept.look === '' && warmKept.ground === WARM_GROUND,
  JSON.stringify({ warmAgain, warmKept }));

const narrow = await side('client', 320);
await narrow.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await settle(narrow, 1500);
await openSettings(narrow);
const fit = await narrow.evaluate(() => {
  const card = document.querySelector('#pa-settings .settings-card');
  const sw = [...document.querySelectorAll('#pa-settings [data-scheme]')].map((x) => x.getBoundingClientRect());
  return { sideways: card ? card.scrollWidth > card.clientWidth + 1 : true, swatches: sw.length, allIn: sw.length === 3 && sw.every((r) => r.left >= 0 && r.right <= innerWidth && r.width >= 80) };
}).catch(() => ({}));
if (SHOTS) await narrow.screenshot({ path: `${SHOTS}/hue-d-320.png` });
// NEGATIVE CONTROL (run 2026-10-17): the wheel's width set to 24rem made this read
//   FAIL  on a small phone the wheel fits whole and nothing runs sideways
// RE-PINNED 2026-10-17 (v7.66): the three swatches, in place of the wheel.
// NEGATIVE CONTROL (run 2026-10-17, v7.66): `.scheme-swatch { min-width: 24rem; }` added to site.css made this read
//   FAIL  on a small phone the three looks fit whole and nothing runs sideways
ok('on a small phone the three looks fit whole and nothing runs sideways', fit.sideways === false && fit.allIn, JSON.stringify(fit));

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

console.log('\n--- D. buttons that stand off the page (v7.66) ---');
// Eric, 2026-10-17: "Do you notice how the buttons don't look convex at all, and don't stand out compared to normal
// text? Fix that." Each thing a finger lands on: a lit fill lighter than the page, a highlight along its top, a
// shadow under it, full-strength words; the tab you are on pressed in; pressed, it sinks. Black stays plain.
const rgb = (s) => (String(s).match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);
const lum = (c) => { const [r, g, bl] = rgb(c).map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
const LIT = /0px 1px 0px 0px inset/;
// The shadows a box-shadow lists, split on the commas between them (not those inside rgba()).
const shadowsOf = (v) => String(v).split(/,(?![^(]*\))/).map((x) => x.trim());
const casts = (v) => shadowsOf(v).some((x) => !/inset/.test(x) && /0px [1-9]\d*px [1-9]\d*px/.test(x));
const buttons = (page) => page.evaluate(() => {
  const ground = getComputedStyle(document.body).backgroundColor;
  const ink = getComputedStyle(document.body).color;
  const read = (e) => { const cs = getComputedStyle(e); return { k: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`, img: cs.backgroundImage, shadow: cs.boxShadow, color: cs.color, transform: cs.transform }; };
  const vis = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.checkVisibility());
  return {
    ground, ink,
    plain: vis('.cog-btn, .nav-toggle, .btn.ghost.tiny, .btn.quiet').map(read),
    tabs: vis('.case-folder .folder-tabs > a:not(.on), .case-folder .fgrp:not(.on)').map(read),
    on: vis('.case-folder .folder-tabs > a.on, .case-folder .fgrp.on').map(read),
  };
}).catch(() => ({ plain: [], tabs: [], on: [] }));
/** A plain button stands off the page: a lit fill both of whose ends are lighter than the ground, lit along its top, a shadow under it, the page's own ink. */
const standsOff = (r, x) => {
  const ends = String(x.img).match(/rgb\([^)]*\)/g) || [];
  return /linear-gradient/.test(x.img) && ends.length === 2 && ends.every((e) => lum(e) > lum(r.ground) * 1.4) && lum(ends[0]) > lum(ends[1])
    && LIT.test(x.shadow) && casts(x.shadow) && x.color === r.ink;
};
const lookPage = async (role, url, set) => {
  const page = await side(role);
  if (set) await page.context().addInitScript((kv) => { for (const [k, v] of kv) localStorage.setItem(k, v); }, set);
  await page.goto(`${P}${url}`, { waitUntil: 'networkidle' }).catch(() => {});
  await settle(page, 1800);
  return page;
};
// RE-PINNED 2026-10-17 (v7.76): Blue and green is the start, so the warm page picks Warm first.
const warmPage = await lookPage('client', '/case.html?id=demo-case-full&demo=1', [['pa-look', 'warm']]);
const warmB = await buttons(warmPage);
const warmLit = warmB.plain.filter((x) => standsOff(warmB, x));
if (SHOTS) await warmPage.screenshot({ path: `${SHOTS}/hue-f-raised-warm.png` });
// NEGATIVE CONTROL (run 2026-10-17): look.css's plain buttons' `background: linear-gradient(180deg, var(--raise-top), var(--raise-bot));` taken out made this read
//   FAIL  in the warm look a plain button is a lit shape off the page: a fill lighter than the ground, lit along its top, a shadow under it, full-strength words
ok('in the warm look a plain button is a lit shape off the page: a fill lighter than the ground, lit along its top, a shadow under it, full-strength words',
  warmB.ground === WARM_GROUND && warmB.plain.length >= 4 && warmLit.length === warmB.plain.length
  && warmLit.some((x) => /cog-btn/.test(x.k)) && warmLit.some((x) => /nav-toggle/.test(x.k)),
  JSON.stringify({ ground: warmB.ground, n: warmB.plain.length, off: warmB.plain.filter((x) => !standsOff(warmB, x)).slice(0, 2) }));

const coolPage = await lookPage('client', '/case.html?id=demo-case-full&demo=1', [['pa-look', 'cool']]);
const coolB = await buttons(coolPage);
const coolLit = coolB.plain.filter((x) => standsOff(coolB, x));
if (SHOTS) await coolPage.screenshot({ path: `${SHOTS}/hue-g-raised-cool.png` });
// NEGATIVE CONTROL (run 2026-10-17): look.css's `--raise-bot: #23232B;` made `--raise-bot: #0A0A0C;` (the page itself) made this read
//   FAIL  in Blue and green a plain button stands off the page the same way
ok('in Blue and green a plain button stands off the page the same way',
  coolB.ground === COOL_GROUND && coolB.plain.length >= 4 && coolLit.length === coolB.plain.length,
  JSON.stringify({ ground: coolB.ground, n: coolB.plain.length, off: coolB.plain.filter((x) => !standsOff(coolB, x)).slice(0, 2) }));

const hisCase = await lookPage('admin', '/admin-case.html?id=demo-case-ana&demo=admin', null);
const tabB = await buttons(hisCase);
const pressedIn = (x) => shadowsOf(x.shadow).every((s) => /inset/.test(s) || /^rgba?\([^)]*\) 0px 0px 0px 1px$/.test(s)) && /inset/.test(x.shadow);
if (SHOTS) await hisCase.screenshot({ path: `${SHOTS}/hue-h-raised-tabs.png` });
// NEGATIVE CONTROL (run 2026-10-17): warm.css's tab you are on given `box-shadow: 0 0 0 1px rgba(255, 178, 122, .45);` without the press made this read
//   FAIL  on his case the tabs you can go to stand up, and the one you are on is pressed in
ok('on his case the tabs you can go to stand up, and the one you are on is pressed in',
  tabB.tabs.length >= 4 && tabB.tabs.every((x) => standsOff(tabB, x)) && tabB.on.length >= 2 && tabB.on.every(pressedIn),
  JSON.stringify({ up: tabB.tabs.filter((x) => !standsOff(tabB, x)).slice(0, 2), on: tabB.on.map((x) => x.shadow.slice(0, 80)) }));

// Pressed, it sinks: a finger held down on a tab you can go to.
const tabBox = await hisCase.locator('.case-folder .folder-tabs > a:not(.on)').first().boundingBox().catch(() => null);
let held = {};
if (tabBox) {
  await hisCase.mouse.move(tabBox.x + tabBox.width / 2, tabBox.y + tabBox.height / 2);
  await hisCase.mouse.down();
  await hisCase.waitForTimeout(150);
  held = await hisCase.evaluate(() => { const e = document.querySelector('.case-folder .folder-tabs > a:active'); if (!e) return { none: true }; const cs = getComputedStyle(e); return { shadow: cs.boxShadow, transform: cs.transform }; }).catch(() => ({}));
  await hisCase.mouse.up();
}
// NEGATIVE CONTROL (run 2026-10-17): look.css's pressed `transform: translateY(1px);` made `transform: none;` made this read
//   FAIL  pressed, it sinks: a pixel down, its shadow inside it
ok('pressed, it sinks: a pixel down, its shadow inside it',
  !!tabBox && held.transform === 'matrix(1, 0, 0, 1, 0, 1)' && shadowsOf(held.shadow).every((x) => /inset/.test(x)),
  JSON.stringify(held));

const blackPage = await lookPage('admin', '/admin-case.html?id=demo-case-ana&demo=admin', [['pa-scheme', 'contrast']]);
const blackB = await buttons(blackPage);
const raisedInBlack = [...blackB.plain, ...blackB.tabs, ...blackB.on].filter((x) => LIT.test(x.shadow) || /gradient/.test(x.img));
// (Black's own marks on the tab you are on, an inset line along its bottom and the card's soft shadow, are not a raise.)
if (SHOTS) await blackPage.screenshot({ path: `${SHOTS}/hue-i-black-plain.png` });
// NEGATIVE CONTROL (run 2026-10-17): `.cog-btn { box-shadow: inset 0 1px 0 #fff, 0 5px 12px #000; }` added to the end of look.css made this read
//   FAIL  Black stays plain: black background, white words, no raise
ok('Black stays plain: black background, white words, no raise',
  blackB.ground === 'rgb(0, 0, 0)' && blackB.plain.length >= 2 && blackB.tabs.length >= 3 && !raisedInBlack.length,
  JSON.stringify({ ground: blackB.ground, raised: raisedInBlack.slice(0, 2) }));

// The other things a finger lands on: the case chips and the chat's small buttons, Employer mode's tabs, and the
// home's Start chatting under its glow.
const kinds = async (page, sel, chosenSel) => page.evaluate(([a, c]) => {
  const ground = getComputedStyle(document.body).backgroundColor;
  const ink = getComputedStyle(document.body).color;
  const read = (e) => { const cs = getComputedStyle(e); return { k: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`, img: cs.backgroundImage, shadow: cs.boxShadow, color: cs.color }; };
  const vis = (q) => (q ? [...document.querySelectorAll(q)].filter((e) => e.checkVisibility()).map(read) : []);
  return { ground, ink, plain: vis(a), on: vis(c) };
}, [sel, chosenSel]).catch(() => ({ plain: [], on: [] }));
const chatPage = await lookPage('client', '/chat.html?demo=1', null);
const chatK = await kinds(chatPage, '.chip-label:not(.selected), .chat-search-btn, .attach-btn, .help-dot', '.chip-label.selected');
const empPage = await lookPage('admin', '/admin-employer.html?demo=admin', null);
const empK = await kinds(empPage, '.emp-tabs > button:not(.on)', '.emp-tabs > button.on');
const homePage = await lookPage('client', '/', null);
const homeGo = await homePage.evaluate(() => { const e = [...document.querySelectorAll('.opt-go')].find((x) => x.checkVisibility()); return e ? getComputedStyle(e).boxShadow : ''; }).catch(() => '');
if (SHOTS) await chatPage.screenshot({ path: `${SHOTS}/hue-j-raised-chat.png` });
const kindsOff = [...chatK.plain.filter((x) => !standsOff(chatK, x)), ...empK.plain.filter((x) => !standsOff(empK, x))];
// NEGATIVE CONTROL (run 2026-10-17): the chosen rule's `:not(:disabled)` taken off (so the raise outweighed it, the bug
// found while building this) made this read FAIL.
// NEGATIVE CONTROL (run 2026-10-17): `.chip-label, ` taken out of look.css's plain buttons' list made this read
//   FAIL  the case chips, the chat's small buttons and Employer mode's tabs stand off the page too, a chosen one is pressed in, and the home's Start chatting is raised under its glow
ok('the case chips, the chat\'s small buttons and Employer mode\'s tabs stand off the page too, a chosen one is pressed in, and the home\'s Start chatting is raised under its glow',
  chatK.plain.length >= 4 && chatK.plain.some((x) => /chip-label/.test(x.k)) && chatK.plain.some((x) => /attach-btn/.test(x.k)) && empK.plain.length >= 2 && !kindsOff.length
  && chatK.on.length >= 1 && empK.on.length === 1 && [...chatK.on, ...empK.on].every(pressedIn)
  && LIT.test(homeGo) && casts(homeGo),
  JSON.stringify({ off: kindsOff.slice(0, 2), on: [...chatK.on, ...empK.on].map((x) => x.shadow.slice(0, 60)), homeGo: homeGo.slice(0, 80) }));

ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
