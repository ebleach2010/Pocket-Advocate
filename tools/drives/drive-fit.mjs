// The free 15-minute fit call, driven end to end in the demo, the way a
// stranger and then Eric would meet it:
//  A. the landing page: the free call is the first door, the case the second,
//     and the dock and the closing follow.
//  B. /fit: the fit slots and only the fit slots; pick one, say how to talk,
//     book; the confirmation names the time in both zones and offers the case.
//  C. /book: the paid picker never shows a fit slot.
//  D. the advocate side: FREE CALLS on the dashboard with the name and the
//     line they typed; Link on a video call; the calendar wears the fit mark.
//  E. Cancel reopens the time on /fit.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.env.PA_PORT || 9378;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
page.on('dialog', async (d) => {
  if (d.type() === 'prompt') await d.accept('https://meet.example/demo-fit');
  else if (d.type() === 'confirm') await d.accept();
  else await d.dismiss();
});
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' — ' + d : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const settle = async (ms = 1800) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close|Done)$/i.test((e.textContent || '').trim()) && !e.closest('.fit-row')); if (x) x.click(); return !!x; });
    await page.waitForTimeout(250); if (!hit) break;
  }
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false }); };

// Fresh world.
await page.goto(`${P}/?demo=1`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle();

console.log('\n--- A. the landing page ---');
const hero = await page.evaluate(() => {
  const acts = [...document.querySelectorAll('.land-sec.hero a.act')].map((a) => [a.className, a.getAttribute('href'), a.textContent.replace(/\s+/g, ' ').trim()]);
  const dock = document.querySelector('#sticky-book a')?.getAttribute('href');
  const closing = [...document.querySelectorAll('#closing .actions a')].map((a) => a.getAttribute('href'));
  return { acts, dock, closing };
});
ok('the free call is the hero\'s first door, at full weight', hero.acts[0]?.[1] === '/fit.html' && /act-c/.test(hero.acts[0]?.[0]), hero.acts[0]?.[2]);
ok('the case is the second door, at card weight, with its price', hero.acts[1]?.[1] === '/book.html' && /act-m/.test(hero.acts[1]?.[0]) && /\$1,200/.test(hero.acts[1]?.[2]), hero.acts[1]?.[2]);
ok('the dock and the closing follow', hero.dock === '/fit.html' && hero.closing[0] === '/fit.html' && hero.closing[1] === '/book.html');
await shot('01-landing-hero');

console.log('\n--- B. /fit: pick a time, say how, book ---');
await page.evaluate(() => document.querySelector('.land-sec.hero a.act[href="/fit.html"]').click());
await page.waitForURL(/\/fit/, { timeout: 10000 }).catch(() => {});
await page.waitForSelector('.slot', { timeout: 10000 }).catch(() => {});
await settle(800);
const fitSlots = await page.evaluate(() => [...document.querySelectorAll('.slot')].map((s) => s.dataset.id));
ok('the fit slots are listed and only the fit slots', fitSlots.length === 9 && fitSlots.every((id) => id.startsWith('fit-')), `${fitSlots.length} slots`);
ok('the form stays folded until a time is picked', await page.evaluate(() => document.querySelector('#after-times').hidden));
await shot('02-fit-times');
await page.click('.slot');
await settle(400);
ok('picking a time unfolds the form and arms the button', await page.evaluate(() => !document.querySelector('#after-times').hidden && !document.querySelector('#fit-book').disabled));
await page.click('#fit-book');
await settle(500);
ok('booking with nothing filled in is refused on the page', await page.evaluate(() => !document.querySelector('#fit-error').hidden && /name/.test(document.querySelector('#fit-error').textContent)));
await page.fill('#fit-name', 'Riley Test');
await page.fill('#fit-email', 'riley@example.com');
await page.evaluate(() => document.querySelector('input[name=method][value=video]').closest('label').click());
await settle(200);
ok('video hides the phone row and says a link is coming', await page.evaluate(() => document.querySelector('#phone-row').hidden && !document.querySelector('#video-note').hidden));
await page.fill('#fit-note', 'Three neurologists, three answers.');
await page.click('#fit-book');
await settle(500);
ok('the US tick is required', await page.evaluate(() => /United States or Canada/.test(document.querySelector('#fit-error').textContent)));
await page.check('#fit-us');
await shot('03-fit-form');
await page.click('#fit-book');
await page.waitForSelector('h1:has-text("Booked.")', { timeout: 10000 }).catch(() => {});
await settle(600);
const done = await page.evaluate(() => ({
  h1: document.querySelector('h1')?.textContent.trim(),
  mst: /MST, my time/.test(document.body.textContent),
  link: /join link/i.test(document.body.textContent),
  offer: document.querySelector('a[href="/book.html"] [data-rate="case"]')?.textContent,
}));
ok('the confirmation names both zones, says a link is coming, and offers the case', done.h1 === 'Booked.' && done.mst && done.link && done.offer === '$1,200', JSON.stringify(done));
await shot('04-fit-booked');
const taken = fitSlots[0];

console.log('\n--- C. /book never shows a fit slot ---');
await page.goto(`${P}/book.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('.slot', { timeout: 10000 }).catch(() => {});
await settle(800);
const caseSlots = await page.evaluate(() => [...document.querySelectorAll('.slot')].map((s) => s.dataset.id));
ok('the paid picker lists the case slots and not one fit slot', caseSlots.length === 12 && caseSlots.every((id) => id.startsWith('slot-')), `${caseSlots.length} slots`);

console.log('\n--- D. the advocate side ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.waitForSelector('#fit-calls .fit-row', { timeout: 10000 }).catch(() => {});
await settle(800);
const row = await page.evaluate(() => {
  const r = document.querySelector('#fit-calls .fit-row');
  return r ? { text: r.textContent.replace(/\s+/g, ' ').trim(), acts: [...r.querySelectorAll('[data-act]')].map((b) => b.dataset.act) } : null;
});
ok('FREE CALLS lists the call with the name, the method, and the line they typed',
  !!row && /Riley Test/.test(row.text) && /video/.test(row.text) && /Three neurologists/.test(row.text), row?.text?.slice(0, 120));
ok('a video call offers Link, Done, No-show, Cancel', row?.acts.join() === 'join-link,done,no-show,cancel', row?.acts.join());
await shot('05-admin-free-calls');
await page.click('#fit-calls [data-act="join-link"]');
await settle(800);
ok('the link lands and the row says so', await page.evaluate(() => /link sent/.test(document.querySelector('#fit-calls .fit-row')?.textContent || '')));
await page.goto(`${P}/admin-calendar.html`, { waitUntil: 'networkidle' });
await settle(1200);
const marks = await page.evaluate(() => [...document.querySelectorAll('.cal-mark.fit')].map((m) => m.textContent.trim()));
ok('the calendar wears the fit mark with the first name', marks.length >= 1 && marks.some((m) => /free Riley/.test(m)), marks.join(' | '));
if (marks.length) {
  await page.evaluate(() => document.querySelector('.cal-mark.fit').closest('.cal-cell').click());
  await settle(400);
  ok('the day view names the free call', await page.evaluate(() => /free 15-minute call/.test(document.querySelector('#cal-day')?.textContent || '')));
}
await shot('06-admin-calendar');

console.log('\n--- E. cancel reopens the time ---');
await page.goto(`${P}/admin.html`, { waitUntil: 'networkidle' });
await page.waitForSelector('#fit-calls .fit-row', { timeout: 10000 }).catch(() => {});
await settle(600);
await page.click('#fit-calls [data-act="cancel"]');
await settle(800);
ok('the row is gone from FREE CALLS', await page.evaluate(() => !document.querySelector('#fit-calls .fit-row')));
await page.goto(`${P}/fit.html?demo=1`, { waitUntil: 'networkidle' });
await page.waitForSelector('.slot', { timeout: 10000 }).catch(() => {});
await settle(600);
const after = await page.evaluate(() => [...document.querySelectorAll('.slot')].map((s) => s.dataset.id));
ok('the cancelled time is open again on /fit', after.length === 9 && after.includes(taken), `${after.length} slots`);

console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
