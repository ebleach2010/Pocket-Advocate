// drive-warmlanding.mjs - the warm look on the public pages, in a real browser.
//
// Eric, 2026-10-15: "try adding the same warm style from the preview suite to
// the landing page. Something I can easily undo." With his switch unset (on),
// the Worker lays landing-warm.css over the home and the package pages:
//   A. the home: the warm ground, the warm pop on the bubbles, his gold card kept, the wordmark's cyan kept
//   B. a package page wears it too; a page that does not wear landing.css does not
//   C. High contrast, chosen for somebody's eyes, is left alone
//   D. 320px, and no page threw
//
// Run: PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-warmlanding.mjs
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
async function page(width = 390, scheme = '') {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  if (scheme) await ctx.addInitScript((s) => { try { localStorage.setItem('pa-scheme', s); } catch {} }, scheme);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
  return p;
}
const look = (p) => p.evaluate(() => {
  const css = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : null; };
  return {
    warm: !!document.querySelector('link[href^="/css/landing-warm.css"]'),
    after: document.querySelector('link[href^="/css/landing-warm.css"]')?.previousElementSibling?.getAttribute('href') || '',
    bg: getComputedStyle(document.body).backgroundColor,
    bubble: css('.wl-bubble', 'backgroundImage'),
    spark: css('.brand .spark', 'color'),
    gold: !!document.querySelector('.opt-gold'),
    scheme: document.documentElement.dataset.scheme,
  };
});

console.log('\n--- A. the home ---');
const home = await page();
await home.goto(`${P}/`, { waitUntil: 'networkidle' });
await home.waitForTimeout(1200);
const h = await look(home);
if (SHOTS) await home.screenshot({ path: `${SHOTS}/warmlanding-1-home.png`, fullPage: false });
// NEGATIVE CONTROL (run 2026-10-15): warmLook returning the page untouched (`return res;` first) made this read
//   FAIL  the home wears the warm look: the plum ground, the warm pop on the bubbles, the gold card and the wordmark's cyan kept
ok('the home wears the warm look: the plum ground, the warm pop on the bubbles, the gold card and the wordmark\'s cyan kept',
  h.warm && /^\/css\/landing\.css/.test(h.after) && h.bg === 'rgb(30, 21, 25)' && /255, 196, 138/.test(h.bubble || '') && h.gold && h.spark === 'rgb(61, 220, 245)',
  JSON.stringify(h));

console.log('\n--- B. where it reaches ---');
const pkg = await page();
await pkg.goto(`${P}/priority-chat.html`, { waitUntil: 'networkidle' });
await pkg.waitForTimeout(800);
const k = await look(pkg);
if (SHOTS) await pkg.screenshot({ path: `${SHOTS}/warmlanding-2-package.png`, fullPage: false });
// A page that answers and does not wear landing.css, read as the server sent it.
const o = await pkg.evaluate(async () => {
  const res = await fetch('/signin.html');
  const text = await res.text();
  return { status: res.status, warm: /landing-warm\.css/.test(text), wears: /\/css\/landing\.css/.test(text) };
});
// NEGATIVE CONTROL (run 2026-10-15): the rewrite keyed on every stylesheet made this read
//   FAIL  a package page wears it too, and a page without landing.css does not
ok('a package page wears it too, and a page without landing.css does not', k.warm && k.bg === 'rgb(30, 21, 25)' && o.status === 200 && !o.wears && !o.warm, JSON.stringify({ k: k.bg, o }));

console.log('\n--- C. High contrast ---');
const hc = await page(390, 'contrast');
await hc.goto(`${P}/`, { waitUntil: 'networkidle' });
await hc.waitForTimeout(800);
const c = await look(hc);
// NEGATIVE CONTROL (run 2026-10-15): the warm ground's guard taken off (`body.landing {` for the first block) made this read
//   FAIL  High contrast keeps its own colours under the warm look
ok('High contrast keeps its own colours under the warm look', c.scheme === 'contrast' && c.bg !== 'rgb(30, 21, 25)', JSON.stringify(c));

console.log('\n--- D. narrow screens ---');
const n = await page(320);
await n.goto(`${P}/`, { waitUntil: 'networkidle' });
await n.waitForTimeout(800);
const past = await n.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => e.checkVisibility() && e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.tagName + '.' + e.className).slice(0, 4));
if (SHOTS) await n.screenshot({ path: `${SHOTS}/warmlanding-3-320.png`, fullPage: false });
// NEGATIVE CONTROL (run 2026-10-15): landing-warm.css's bubble rule given `min-width: 400px` made this read
//   FAIL  at 320px nothing runs off the screen
ok('at 320px nothing runs off the screen', !past.length, JSON.stringify(past));
// NEGATIVE CONTROL (run 2026-10-15): the package page swapped for /signin.html, whose sign-in library cannot load here, made this read
//   FAIL  no page threw
ok('no page threw', !errs.length, JSON.stringify(errs.slice(0, 3)));

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
