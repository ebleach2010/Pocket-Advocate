// By the numbers, driven in the demo at 390px:
//  A. the landing strip paints four measured figures and every tile opens the ledger.
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
await settle();
console.log('\n--- A. the landing strip ---');
const strip = await page.evaluate(() => {
  const s = document.querySelector('#numbers');
  return { hidden: s.hidden, figs: [...s.querySelectorAll('[data-stat]')].map((e) => e.textContent), hrefs: [...s.querySelectorAll('a.tile')].map((a) => a.getAttribute('href')) };
});
ok('the strip is on and painted with the four figures', !strip.hidden && strip.figs.join('|') === '3 min|84%|4 of 4|61 hrs', strip.figs.join('|'));
ok('every tile opens the ledger', strip.hrefs.length === 4 && strip.hrefs.every((h) => h === '/stats.html'));
await page.evaluate(() => document.querySelector('#numbers').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
await shot('01-landing-strip');

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
ok('two doors out: the free call and the case', pg.doors[0] === '/fit.html' && pg.doors[1] === '/book.html');
await shot('02-stats-top');
await page.evaluate(() => document.querySelector('.ledger').scrollIntoView({ block: 'center' }));
await page.waitForTimeout(400);
await shot('03-stats-ledger');

console.log('\n--- C. the words ---');
ok('nothing on the page says why a window might be missing', !/paus|crash|out of office|unavailab/i.test(pg.body));

console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
