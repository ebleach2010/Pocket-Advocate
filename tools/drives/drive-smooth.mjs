// drive-smooth.mjs - smooth scrolling, no sideways scroll, and Blue and green past the home (v7.76).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-smooth.mjs
//
// Eric, 2026-10-17: "The app is having some hitching when scrolling in areas, and the landing page has side scroll",
// and "Change the standard color for clients and advocates past the main page to green/blue that's in settings. This
// includes the preview in the main page. Landing page is untouched." Measured in a real browser at phone sizes: the
// look each page opens in, the shelf's moving light holding still while it scrolls (and the drawing work that saves),
// and the home's card rows never running past their cards.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const P = `http://127.0.0.1:${process.env.PA_PORT || 9377}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const errs = [];
const watch = (page) => page.on('pageerror', (e) => { const s = String(e); if (!/firebase-real/.test(s)) errs.push(s.slice(0, 200)); });

console.log('\n--- A. the look each page opens in ---');
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage(); watch(page);
  const look = async (path) => { await page.goto(`${P}${path}`, { waitUntil: 'domcontentloaded' }); return page.evaluate(() => ({ look: document.documentElement.dataset.look || '', meta: document.querySelector('meta[name="theme-color"]')?.content || '' })); };
  const fresh = { casePage: await look('/case.html?preview=1'), book: await look('/book.html'), home: await look('/'), svc: await look('/full-service.html') };
  if (SHOTS) { await page.goto(`${P}/case.html?preview=1`, { waitUntil: 'networkidle' }); await page.waitForTimeout(1200); await page.screenshot({ path: `${SHOTS}/smooth-1-preview.png` }); }
  await page.evaluate(() => localStorage.setItem('pa-look', 'warm'));
  const warm = await look('/case.html?preview=1');
  await page.evaluate(() => localStorage.setItem('pa-look', 'cool'));
  const coolHome = await look('/');
  // NEGATIVE CONTROL (run 2026-10-17): case.html's `var cool = localStorage.getItem('pa-look') !== 'warm';` made `=== 'cool'` and its first line taken out made this read
  //   FAIL  past the home a page opens in Blue and green, the preview included; the home and the service pages open as before; a chosen look wins either way
  ok('past the home a page opens in Blue and green, the preview included; the home and the service pages open as before; a chosen look wins either way',
    fresh.casePage.look === 'cool' && fresh.casePage.meta === '#0A0A0C' && fresh.book.look === 'cool' && fresh.home.look === '' && fresh.svc.look === ''
    && warm.look === '' && coolHome.look === 'cool',
    JSON.stringify({ fresh, warm, coolHome }));
  await ctx.close();
}

console.log('\n--- B. his shelf holds its light still while it scrolls ---');
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 560 }, deviceScaleFactor: 3 });
  await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage(); watch(page);
  await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  await page.mouse.move(195, 300);
  const cdp = await ctx.newCDPSession(page);
  const events = [];
  cdp.on('Tracing.dataCollected', (d) => events.push(...d.value));
  const done = new Promise((r) => cdp.once('Tracing.tracingComplete', r));
  await cdp.send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
  const during = [];
  for (let i = 0; i < 24; i++) {
    await page.mouse.wheel(0, 40); await page.waitForTimeout(16);
    if (i % 6 === 5) during.push(await page.evaluate(() => ({ cls: document.documentElement.classList.contains('pa-scrolling'), state: [...document.getAnimations()].map((a) => a.playState) })));
  }
  for (let i = 0; i < 24; i++) { await page.mouse.wheel(0, -40); await page.waitForTimeout(16); }
  await cdp.send('Tracing.end'); await done;
  const paints = events.filter((e) => e.name === 'Paint').length;
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ cls: document.documentElement.classList.contains('pa-scrolling'), state: [...document.getAnimations()].map((a) => a.playState) }));
  // NEGATIVE CONTROL (run 2026-10-17): nav-menu.js's `import './smooth.js';` taken out made this read
  //   FAIL  while his shelf scrolls its glows and shine hold still and almost nothing is drawn again; a moment after, they move again
  ok('while his shelf scrolls its glows and shine hold still and almost nothing is drawn again; a moment after, they move again',
    during.length === 4 && during.every((d) => d.cls && d.state.length > 0 && d.state.every((s) => s === 'paused'))
    && paints < 150 && !after.cls && after.state.some((s) => s === 'running'),
    JSON.stringify({ during: during.map((d) => [d.cls, d.state.join('|')]), paints, after: [after.cls, after.state.join('|')] }));
  await ctx.close();
}

console.log('\n--- C. the home never runs sideways ---');
{
  const rows = [];
  for (const w of [320, 360, 375, 390, 393, 402, 414, 430]) {
    const ctx = await b.newContext({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage(); watch(page);
    await page.goto(`${P}/`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);
    rows.push(await page.evaluate((width) => {
      const st = document.createElement('style'); st.textContent = 'html, body, body > main { overflow-x: visible !important; }'; document.head.appendChild(st);
      const past = [...document.querySelectorAll('.opt-acts')].flatMap((r) => { const card = r.closest('.opt').getBoundingClientRect(); return [...r.children].filter((k) => k.getBoundingClientRect().right > card.right + 0.5).map(() => 1); }).length;
      return { width, past, sw: document.documentElement.scrollWidth - innerWidth };
    }, w));
    if (SHOTS && w === 375) await page.screenshot({ path: `${SHOTS}/smooth-2-home-375.png` });
    await ctx.close();
  }
  // NEGATIVE CONTROL (run 2026-10-17): the card row's `flex-wrap: wrap;` put back to `flex-wrap: nowrap;` made this read
  //   FAIL  at every phone width from 320 to 430 nothing on the home runs past its card or the screen, even with the clipping taken off
  ok('at every phone width from 320 to 430 nothing on the home runs past its card or the screen, even with the clipping taken off',
    rows.every((r) => r.past === 0 && r.sw <= 0), JSON.stringify(rows));
}

// NEGATIVE CONTROL (run 2026-10-17): `throw new Error('control');` added at the end of admin.js made this read
//   FAIL  no page threw
ok('no page threw', errs.length === 0, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
