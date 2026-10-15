// drive-tour.mjs - the preview's guided tour, its warm look, and Eric in
// office, in a real browser at 390px and 320px.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-tour.mjs
//
// Eric, 2026-10-15: "Fix the client side suite. Have it go step by step
// through what each tab means by starting with a short welcome to the
// preview ... Highlighting each section one at a time with a small window
// explaining what it is. Then hit next for the next section of the
// tutorial/overview until they can browse the suite. Then, make me 'in
// office,' make a couple file uploads per day, highlight the progress section
// with a celebratory icon, fix the chat aesthetic so it doesn't look so
// black/dead."
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' (' + d + ')' : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' (' + d + ')' : ''}`)); };
const errs = [];
const open = async (width = 390) => {
  // Joe lives in Idaho, so the page reads his days on his clock.
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, timezoneId: 'America/Boise' });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  await page.goto(`${P}/case.html?preview=1`, { waitUntil: 'networkidle' });
  return page;
};
const tourState = (page) => page.evaluate(() => {
  const t = document.querySelector('.pv-tour');
  if (!t) return null;
  const spot = t.querySelector('.pv-tour-spot').getBoundingClientRect();
  const card = t.querySelector('.pv-tour-card').getBoundingClientRect();
  return {
    title: t.querySelector('[data-tour-t]').textContent, n: t.querySelector('[data-tour-n]').textContent,
    lit: t.classList.contains('lit'), center: t.classList.contains('center'),
    spot: { top: Math.round(spot.top), left: Math.round(spot.left), w: Math.round(spot.width), h: Math.round(spot.height) },
    card: { top: Math.round(card.top), bottom: Math.round(card.bottom), left: Math.round(card.left), right: Math.round(card.right) },
    tab: document.querySelector('.ftab.on')?.dataset.page || '', next: t.querySelector('[data-tour-next]').textContent,
    intro: !!document.getElementById('pa-intro'),
  };
});

console.log('\n--- A. the tour ---');
const page = await open(390);
await page.waitForSelector('.pv-tour', { timeout: 10000 }).catch(() => {});
const first = await tourState(page);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-1-welcome.png` });
// NEGATIVE CONTROL (run 2026-10-15): store.js's tour import taken out made this read
//   FAIL  a first visit opens on the welcome, centred, with nothing else stacked on it
ok('a first visit opens on the welcome, centred, with nothing else stacked on it',
  first?.title === 'Welcome to the preview' && first.center && !first.lit && first.next === 'Show me around' && !first.intro, JSON.stringify(first));
const walked = [];
for (let k = 0; k < 20; k++) {
  await page.click('[data-tour-next]');
  await page.waitForTimeout(900);
  const st = await tourState(page);
  if (!st) break;
  walked.push(st);
  if (SHOTS && ['Every step, celebrated 🎉', 'Chat', 'Docs: add anything', 'Exit any time'].includes(st.title)) {
    await page.screenshot({ path: `${SHOTS}/tour-2-${st.n.replace(/\s/g, '')}.png` });
  }
  if (st.next === 'Start exploring') break;
}
const sections = walked.filter((s) => s.lit);
const inView = sections.every((s) => s.spot.w > 20 && s.spot.h > 20 && s.spot.left >= 0 && s.spot.left + s.spot.w <= 390 && s.spot.top >= 0 && s.spot.top + s.spot.h <= s.card.top);
const tabsSeen = [...new Set(walked.map((s) => s.tab))];
// NEGATIVE CONTROL (run 2026-10-15): the tour's tab switch (`tab.click()`) taken out made this read
//   FAIL  Next lights one section at a time above the card, opening each tab in turn: Progress, Chat, Docs, Enhance, Saved
ok('Next lights one section at a time above the card, opening each tab in turn: Progress, Chat, Docs, Enhance, Saved',
  sections.length >= 11 && inView && JSON.stringify(tabsSeen) === JSON.stringify(['progress', 'chat', 'docs', 'addons', 'saved']),
  JSON.stringify({ n: sections.length, tabsSeen, bad: sections.filter((s) => !(s.spot.w > 20 && s.spot.h > 20 && s.spot.top + s.spot.h <= s.card.top)).map((s) => [s.title, s.spot, s.card.top]) }));
const cheerStep = walked.find((s) => /celebrated/.test(s.title));
const exitStep = walked.find((s) => s.title === 'Exit any time');
const exitBtn = await page.evaluate(() => { const r = document.querySelector('.pv-exit').getBoundingClientRect(); return { top: Math.round(r.top), left: Math.round(r.left) }; });
// NEGATIVE CONTROL (run 2026-10-15): the Exit step's target changed to '.pv-what' made this read
//   FAIL  the progress card and the Exit button each get their own step, ringed where they are
ok('the progress card and the Exit button each get their own step, ringed where they are',
  !!cheerStep?.lit && !!exitStep?.lit && Math.abs(exitStep.spot.left - (exitBtn.left - 8)) <= 6 && exitStep.spot.top <= exitBtn.top,
  JSON.stringify({ cheerStep: cheerStep?.spot, exitStep: exitStep?.spot, exitBtn }));
const last = walked[walked.length - 1];
await page.click('[data-tour-next]');
await page.waitForTimeout(800);
const after = await page.evaluate(() => ({ tour: !!document.querySelector('.pv-tour'), tab: document.querySelector('.ftab.on')?.dataset.page, y: Math.round(scrollY) }));
// NEGATIVE CONTROL (run 2026-10-15): end() leaving the overlay in the page made this read
//   FAIL  the last card hands it over with Start exploring, back on Progress at the top, free to browse
ok('the last card hands it over with Start exploring, back on Progress at the top, free to browse',
  last?.next === 'Start exploring' && !last.lit && !after.tour && after.tab === 'progress' && after.y === 0, JSON.stringify({ last: last?.title, after }));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
const again = await page.evaluate(() => !!document.querySelector('.pv-tour'));
// NEGATIVE CONTROL (run 2026-10-15): startTour ignoring seen() made this read
//   FAIL  once seen, it stays away for the rest of the visit
ok('once seen, it stays away for the rest of the visit', !again);

console.log('\n--- B. warm, in office, busy, celebrated ---');
const progress = await page.evaluate(() => {
  const c = document.querySelector('[data-cheer]');
  return c ? { text: c.textContent.replace(/\s+/g, ' ').trim(), border: getComputedStyle(c).backgroundImage.slice(0, 60) } : null;
});
// NEGATIVE CONTROL (run 2026-10-15): `${cheerCard(c, rank, closed)}` taken out of the Progress page made this read
//   FAIL  Progress cheers with a party popper and the steps done
ok('Progress cheers with a party popper and the steps done', !!progress && /🎉/.test(progress.text) && /Your report is ready\./.test(progress.text) && /6 of 7 steps done/.test(progress.text), JSON.stringify(progress));
const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
await page.click('.ftab[data-page="chat"]');
await page.waitForTimeout(1500);
const chat = await page.evaluate(() => {
  const pill = document.querySelector('.office-cue');
  const me = document.querySelector('.msg.me');
  const them = document.querySelector('.msg-row .msg.them');
  return {
    pill: (pill?.textContent || '').trim(), who: document.querySelector('.chat-who .who-name')?.textContent,
    whoPhoto: document.querySelector('.chat-who img')?.naturalWidth || 0,
    avatars: document.querySelectorAll('.msg-ava:not(.gap)').length,
    avatarLoaded: document.querySelector('.msg-ava:not(.gap)')?.naturalWidth || 0,
    days: [...document.querySelectorAll('.chat-day')].map((d) => d.textContent),
    meBg: me ? getComputedStyle(me).backgroundImage.slice(0, 40) : '', meInk: me ? getComputedStyle(me).color : '',
    themBg: them ? getComputedStyle(them).backgroundImage.slice(0, 40) : '',
  };
});
if (SHOTS) await page.screenshot({ path: `${SHOTS}/tour-3-chat.png` });
// NEGATIVE CONTROL (run 2026-10-15): the preview's availability answer back to `inOffice: false` made this read
//   FAIL  in the chat Eric is in office, his face and name at the top
ok('in the chat Eric is in office, his face and name at the top', /IN OFFICE/i.test(chat.pill) && chat.who === 'Eric, your advocate' && chat.whoPhoto > 0, JSON.stringify(chat));
// NEGATIVE CONTROL (run 2026-10-15): warm.css's link taken off case.html made this read
//   FAIL  the chat is warm, not black: a plum ground, the client's words in the warm pop, his on a warm card with his photo, and a line for each day
ok('the chat is warm, not black: a plum ground, the client\'s words in the warm pop, his on a warm card with his photo, and a line for each day',
  ground === 'rgb(30, 21, 25)' && /linear-gradient/.test(chat.meBg) && chat.meInk === 'rgb(43, 18, 7)' && /linear-gradient/.test(chat.themBg)
  && chat.avatars >= 5 && chat.avatarLoaded > 0 && chat.days.length >= 5 && chat.days.some((x) => x === 'Today' || x === 'Yesterday'),
  JSON.stringify({ ground, ...chat, days: chat.days.length }));
await page.click('.ftab[data-page="docs"]');
await page.waitForTimeout(1500);
const perDay = await page.evaluate(() => {
  const out = {};
  for (const li of document.querySelectorAll('[data-files] li')) {
    const t = li.textContent.replace(/\s+/g, ' ');
    if (!/UPLOAD/i.test(t)) continue;
    const day = (t.match(/([A-Z][a-z]{2} \d{1,2}) ·/) || [])[1];
    if (day) out[day] = (out[day] || 0) + 1;
  }
  return out;
});
const busyDays = Object.values(perDay).filter((n) => n >= 2).length;
// NEGATIVE CONTROL (run 2026-10-15): the preview seed's daily uploads loop taken out made this read
//   FAIL  Docs shows a couple of Joe's own uploads a day
ok('Docs shows a couple of Joe\'s own uploads a day', busyDays >= 9, JSON.stringify(perDay));

console.log('\n--- C. Back, Escape and a small phone ---');
const small = await open(320);
await small.waitForSelector('.pv-tour', { timeout: 10000 }).catch(() => {});
await small.click('[data-tour-next]'); await small.waitForTimeout(800);
await small.click('[data-tour-next]'); await small.waitForTimeout(800);
const two = await tourState(small);
await small.click('[data-tour-back]'); await small.waitForTimeout(800);
const back = await tourState(small);
const fits = await small.evaluate(() => {
  const c = document.querySelector('.pv-tour-card').getBoundingClientRect();
  return c.left >= 0 && c.right <= innerWidth && [...document.querySelectorAll('.pv-tour-acts button')].every((x) => x.getBoundingClientRect().height >= 44);
});
await small.keyboard.press('Escape');
await small.waitForTimeout(500);
const gone = await small.evaluate(() => !document.querySelector('.pv-tour'));
if (SHOTS) await small.screenshot({ path: `${SHOTS}/tour-4-320.png` });
// NEGATIVE CONTROL (run 2026-10-15): the tour's Escape branch taken out made this read
//   FAIL  Back steps back, Escape ends it, and at 320px the card fits with full size buttons
ok('Back steps back, Escape ends it, and at 320px the card fits with full size buttons',
  two?.title === 'Progress, at a glance' && back?.title === 'Five tabs' && fits && gone, JSON.stringify({ two: two?.title, back: back?.title, fits, gone }));
// NEGATIVE CONTROL (run 2026-10-15): a `null.x` put in tour.js's show() made this read
//   FAIL  no page threw
ok('no page threw', !errs.length, JSON.stringify(errs.slice(0, 3)));

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
