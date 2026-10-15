// By the numbers, driven in the demo at 390px:
//  A. the home's pull-up tab: the brief, the arrow's motion, the pull that opens every figure.
//  B. /stats: the four tiles, the ledger, the stamp, the two doors out.
//  C. nothing a client reads mentions why a window might be missing.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.env.PA_PORT || 9379;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' — ' + d : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const settle = async (ms = 1600) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close|Done)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await page.waitForTimeout(250); if (!hit) break;
  }
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

await page.goto(`${P}/?demo=1`, { waitUntil: 'networkidle' });
// The demo signs a client in, whose first-run guide would sit over the page; the home's own sheet has a Close
// button of its own, so the guide is marked as seen rather than hunted for by its words (2026-10-15).
await page.evaluate(() => localStorage.setItem('pa-intro-done', '1'));
await page.reload({ waitUntil: 'networkidle' });
await settle();
// RE-PINNED 2026-10-15 (v7.40): Eric, "put my stats at the bottom of the landing page in brief; it will be a tab
// with an arrow that glows like the waitlist button and softly eases up and down in an ease in, ease out fashion
// every 1.5 seconds. When they grab it and swipe up it shows all of my stats." The strip behind the menu, which
// nobody could reach, became a pull-up tab; it is grabbed and pulled here, not read from markup.
console.log('\n--- A. the pull-up tab ---');
const tabNow = await page.evaluate(() => {
  const t = document.querySelector('[data-stats-tab]');
  const a = getComputedStyle(t.querySelector('.stats-arrow'));
  return { hidden: t.hidden, brief: t.querySelector('[data-stats-brief]').textContent, anim: a.animationName, dur: a.animationDuration, timing: a.animationTimingFunction };
});
ok('the tab is at the foot of the home with the brief on it', !tabNow.hidden && tabNow.brief === '3 min median reply \u00b7 84% within an hour', tabNow.brief);
ok('its arrow eases up and down every 1.5 seconds and glows on the bubble\'s beat', /^stats-bob, wl-glow$/.test(tabNow.anim) && /^1\.5s, 3s$/.test(tabNow.dur) && /^ease-in-out, ease-in-out$/.test(tabNow.timing), `${tabNow.anim} / ${tabNow.dur} / ${tabNow.timing}`);
await shot('01-landing-tab');
const box = await page.locator('[data-stats-tab]').boundingBox();
const gx = box.x + box.width / 2; const gy = box.y + 18;
await page.mouse.move(gx, gy);
await page.mouse.down();
for (let i = 1; i <= 6; i++) { await page.mouse.move(gx, gy - i * 18); await page.waitForTimeout(20); }
const midway = await page.evaluate(() => ({ shown: !document.querySelector('[data-stats-sheet]').hidden, y: Math.round(document.querySelector('[data-stats-card]').getBoundingClientRect().top) }));
for (let i = 7; i <= 14; i++) { await page.mouse.move(gx, gy - i * 18); await page.waitForTimeout(20); }
await page.mouse.up();
await page.waitForTimeout(600);
// NEGATIVE CONTROL (run 2026-10-15): the pointermove handler's `place(drag.h - up);` taken out made this read
//   FAIL  grabbed and pulled up, the sheet rises under the finger and settles open
ok('grabbed and pulled up, the sheet rises under the finger and settles open', midway.shown && midway.y > 300
  && await page.evaluate(() => document.querySelector('[data-stats-sheet]').classList.contains('open') && Math.round(document.querySelector('[data-stats-card]').getBoundingClientRect().bottom) === innerHeight), JSON.stringify(midway));
const sheet = await page.evaluate(() => {
  const s = document.querySelector('[data-stats-sheet]');
  return { figs: [...s.querySelectorAll('.numbers [data-stat]')].map((e) => e.textContent), ledger: [...s.querySelectorAll('.ledger [data-stat]:not(span)')].map((e) => e.textContent), ledgerShown: !s.querySelector('[data-ledger]').hidden };
});
ok('it shows every figure: the four tiles and the ledger', sheet.figs.join('|') === '3 min|84%|4 of 4|61 hrs' && sheet.ledgerShown && sheet.ledger.join('|') === '412|9|33|6', `${sheet.figs.join('|')} / ${sheet.ledger.join('|')}`);
await shot('02-landing-sheet');
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const shut = await page.evaluate(() => document.querySelector('[data-stats-sheet]').hidden && document.querySelector('[data-stats-tab]').getAttribute('aria-expanded') === 'false');
await page.click('[data-stats-tab]');
await page.waitForTimeout(600);
const tapped = await page.evaluate(() => document.querySelector('[data-stats-sheet]').classList.contains('open'));
ok('Escape puts it away, and a plain tap opens it too', shut && tapped);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
{
  const still = await b.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await still.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
  const sp = await still.newPage();
  await sp.goto(`${P}/?demo=1`, { waitUntil: 'networkidle' });
  await sp.waitForTimeout(1500);
  const anim = await sp.evaluate(() => getComputedStyle(document.querySelector('.stats-arrow')).animationName);
  ok('for anyone who asked for less motion the arrow holds still', anim === 'none', anim);
  await still.close();
}

console.log('\n--- B. the page ---');
await page.goto(`${P}/stats.html`, { waitUntil: 'networkidle' });
await settle();
const pg = await page.evaluate(() => ({
  tiles: [...document.querySelectorAll('.numbers [data-stat]')].map((e) => e.textContent),
  ledger: [...document.querySelectorAll('.ledger b')].map((e) => e.textContent),
  milestones: document.querySelector('[data-stat="milestonesLine"]').textContent,
  cases: document.querySelector('[data-stat="casesLine"]').textContent,
  stamp: document.querySelector('[data-stat="stamp"]').textContent,
  ledgerHidden: document.querySelector('[data-ledger]').hidden,
  doors: [...document.querySelectorAll('main .actions a')].map((a) => a.getAttribute('href')),
  body: document.body.textContent,
}));
ok('the four tiles', pg.tiles.join('|') === '3 min|84%|4 of 4|61 hrs', pg.tiles.join('|'));
ok('the ledger: messages, milestones, actions logged, cases', pg.ledger.join('|') === '412|9|33|6' && !pg.ledgerHidden, pg.ledger.join('|'));
ok('milestones by type in one line', pg.milestones === 'milestones reached: 4 appointments scheduled, 3 referrals out, 2 authorizations approved', pg.milestones);
ok('cases since the first month', pg.cases === 'cases taken since July 2026', pg.cases);
ok('the stamp names the month and the last update', /since July 2026\. Updated daily; last updated 5 hours ago\./.test(pg.stamp), pg.stamp);
// RE-PINNED 2026-10-15 (v7.38): the free call was removed on 2026-10-12, so one door is left, the case. The demo
// keeps it; outside the demo nav-menu.js hides every Book link while cases are closed (tighten.mjs T1).
ok('one door out: the case', pg.doors.join() === '/book.html', pg.doors.join());
await shot('02-stats-top');
await page.evaluate(() => document.querySelector('.ledger').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
await shot('03-stats-ledger');

console.log('\n--- C. the words ---');
ok('nothing on the page says why a window might be missing', !/paus|crash|out of office|unavailab/i.test(pg.body));

console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
