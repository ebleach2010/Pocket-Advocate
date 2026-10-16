// drive-nostuck.mjs - "Signing you in…" never sits there forever, and the home page can be reached (v7.58).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-nostuck.mjs
//
// Eric, 2026-10-16, 9:56 AM, a screenshot of the sign-in page on "Signing you in…": "There are
// glitches where you get stuck on a loading screen. I'm not sure it's even possible to hit the
// landing page." The sign-in page's resume had no time limit, and on his phone the home page sends
// him to sign in, so the logo on that page went home and came straight back. Here the server's
// answer is held the way a phone just woken holds it, and the home page is opened both ways: fresh,
// and from a page of the site. About a minute, most of it the page's own waits.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || '9377';
const SHOTS = process.env.PA_SHOTS || '';
const P = `http://127.0.0.1:${PORT}`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const TOKEN = 'ab'.repeat(32);

// A device that has signed in before: its email and its trusted-device token. `hold` keeps the
// server's answer to the device sign-in from ever arriving (until the page gives up on it);
// `refuse` answers 401, the way an expired or revoked device is told. The demo answers the
// sign-in itself, so the hold wraps whatever fetch the page ends up with.
const open = async ({ hold = false, refuse = false, door = false, demo = 'admin' } = {}) => {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  if (demo) await ctx.addCookies([{ name: 'pa_demo', value: demo, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  await page.addInitScript(({ hold, refuse, door, TOKEN }) => {
    try {
      if (!sessionStorage.getItem('drive-seeded')) {
        sessionStorage.setItem('drive-seeded', '1');
        localStorage.setItem('pa-signin-email', 'eric@example.com');
        localStorage.setItem('pa-device-token', TOKEN);
        if (door) localStorage.setItem('pa-admin-door', '1');
      }
    } catch { /* none */ }
    window.__drive = { hold, refuse, asked: 0 };
    let f = window.fetch;
    const wrap = (fn) => (input, init = {}) => {
      const u = typeof input === 'string' ? input : input?.url || '';
      if (/\/api\/auth\/device-signin/.test(u)) {
        window.__drive.asked += 1;
        if (window.__drive.refuse) return Promise.resolve(new Response('{"error":"This device needs a code."}', { status: 401, headers: { 'content-type': 'application/json' } }));
        if (window.__drive.hold) {
          return new Promise((res, rej) => {
            init.signal?.addEventListener('abort', () => rej(new DOMException('The operation was aborted.', 'AbortError')));
          });
        }
      }
      return fn(input, init);
    };
    Object.defineProperty(window, 'fetch', { configurable: true, get() { return wrap(f); }, set(v) { f = v; } });
  }, { hold, refuse, door, TOKEN });
  return { ctx, page, errs };
};
const read = (page) => page.evaluate(() => {
  const vis = (id) => { const el = document.getElementById(id); return !!el && !el.hidden && !!el.offsetParent; };
  return {
    resuming: vis('resuming'), slow: vis('resume-slow'),
    slowText: document.getElementById('resume-slow')?.textContent.replace(/\s+/g, ' ').trim() || '',
    pin: vis('pin-form'), email: vis('email-form'),
    token: localStorage.getItem('pa-device-token') || '',
    home: document.getElementById('resume-home')?.getAttribute('href') || '',
    stalls: (window.__paDemoStalls || []).map((x) => `${x.kind}:${x.stage}:${x.page}`),
    wide: document.documentElement.scrollWidth > window.innerWidth + 1,
    path: location.pathname,
  };
});

console.log('\n--- A. the server never answers: at ten seconds it says so, with a way on ---');
{
  const { ctx, page, errs } = await open({ hold: true, door: true });
  await page.goto(`${P}/signin.html?to=%2Fadmin.html&demo=admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const early = await read(page);
  ok('it starts on Signing you in, with nothing else yet', early.resuming && !early.slow && !early.pin && !early.email, JSON.stringify(early));
  await page.waitForTimeout(9000);
  const at12 = await read(page);
  // NEGATIVE CONTROL (run 2026-10-16): the ten-second timer's `.hidden = false` made `.hidden = true` made this read
  //   FAIL  at ten seconds it says it is taking longer, with Try again, another way in and the home page, on a phone screen
  ok('at ten seconds it says it is taking longer, with Try again, another way in and the home page, on a phone screen',
    at12.resuming && at12.slow && /^This is taking longer than it should\. A phone that just woke can take up to a minute\. Try again Sign in another way Go to the home page$/.test(at12.slowText)
    && at12.home === '/' && !at12.wide, JSON.stringify(at12));
  ok('the slow sign-in is reported once, as waiting on the server', JSON.stringify(at12.stalls) === JSON.stringify(['slow:device:signin']), JSON.stringify(at12.stalls));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/nostuck-slow-390.png` });
  await page.waitForTimeout(9500);
  const at21 = await read(page);
  // NEGATIVE CONTROL (run 2026-10-16): the catch's `if (err?.refused)` taken out, so every failure untrusts the device, made this read
  //   FAIL  at twenty seconds it stops waiting, shows his PIN pad, and this device stays trusted
  ok('at twenty seconds it stops waiting, shows his PIN pad, and this device stays trusted',
    !at21.resuming && at21.pin && !at21.email && at21.token === TOKEN, JSON.stringify(at21));
  ok('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

console.log('\n--- B. the buttons: another way in, and Try again ---');
{
  const { ctx, page, errs } = await open({ hold: true });
  await page.goto(`${P}/signin.html?to=%2Fadmin.html&demo=admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(11_000);
  await page.click('#resume-other');
  await page.waitForTimeout(400);
  const other = await read(page);
  // NEGATIVE CONTROL (run 2026-10-16): Sign in another way's listener taken out made this read
  //   FAIL  Sign in another way puts the usual door up at once
  ok('Sign in another way puts the usual door up at once', !other.resuming && other.email && !other.pin, JSON.stringify(other));
  // Try again starts over: the page loads anew and asks the server again.
  const { ctx: ctx2, page: p2, errs: errs2 } = await open({ hold: true });
  await p2.goto(`${P}/signin.html?to=%2Fadmin.html&demo=admin`, { waitUntil: 'domcontentloaded' });
  await p2.waitForTimeout(11_000);
  await p2.evaluate(() => { sessionStorage.setItem('drive-reloaded', '1'); });
  // Bounded, so a Try again that does nothing reads FAIL here rather than stalling the drive.
  await Promise.all([p2.waitForEvent('load', { timeout: 6000 }).catch(() => {}), p2.click('#resume-retry')]);
  await p2.waitForTimeout(1500);
  // NEGATIVE CONTROL (run 2026-10-16): Try again's listener taken out made this read
  //   FAIL  Try again starts the sign-in over
  const again = await p2.evaluate(() => ({ reloaded: sessionStorage.getItem('drive-reloaded'), asked: window.__drive.asked, slow: !document.getElementById('resume-slow').hidden, resuming: !document.getElementById('resuming').hidden }));
  ok('Try again starts the sign-in over', again.asked === 1 && again.resuming && !again.slow, JSON.stringify(again));
  ok('no page errors', !errs.length && !errs2.length, [...errs, ...errs2].join(' | '));
  await ctx.close(); await ctx2.close();
}

console.log('\n--- C. a refused device is untrusted; one that answers signs straight in ---');
{
  const { ctx, page, errs } = await open({ refuse: true });
  await page.goto(`${P}/signin.html?to=%2Fadmin.html&demo=admin`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const r = await read(page);
  // NEGATIVE CONTROL (run 2026-10-16): the 401 read as `refused: false` made this read
  //   FAIL  told the device needs a code, it forgets the token and shows the usual door
  ok('told the device needs a code, it forgets the token and shows the usual door', !r.resuming && r.email && r.token === '', JSON.stringify(r));
  const { ctx: ctx2, page: p2, errs: errs2 } = await open();
  await p2.goto(`${P}/signin.html?to=%2Fadmin.html&demo=admin`, { waitUntil: 'domcontentloaded' });
  await p2.waitForURL(/\/admin(\.html)?/, { timeout: 15_000 }).catch(() => {});
  ok('answered, it goes straight on to the Clients page', /\/admin(\.html)?$/.test(new URL(p2.url()).pathname), p2.url());
  ok('no page errors', !errs.length && !errs2.length, [...errs, ...errs2].join(' | '));
  await ctx.close(); await ctx2.close();
}

console.log('\n--- D. the home page on his phone: opened fresh it goes to his work, from the site it stays ---');
{
  // No demo here: the demo never redirects, and this is the real page's own script.
  const { ctx, page } = await open({ demo: '' });
  await page.addInitScript(() => { try { localStorage.setItem('pa-admin-device', '1'); } catch { /* none */ } });
  await page.goto(`${P}/`, { waitUntil: 'commit' });
  await page.waitForURL(/\/signin/, { timeout: 8000 }).catch(() => {});
  ok('opened fresh, as the app opens, it goes on through sign-in to his work', /\/signin(\.html)?\?to=%2Fadmin\.html$/.test(page.url().replace(P, '')), page.url());
  await page.goto(`${P}/about.html`, { waitUntil: 'domcontentloaded' });
  await Promise.all([page.waitForURL(`${P}/`, { timeout: 8000 }).catch(() => {}), page.click('header .brand')]);
  await page.waitForTimeout(1500);
  const home = await page.evaluate(() => ({ path: location.pathname, hero: !!document.querySelector('.hero-face') }));
  // NEGATIVE CONTROL (run 2026-10-16): the referrer guard's `return` taken out made this read
  //   FAIL  tapping the logo on another page of the site shows the home page and stays there
  ok('tapping the logo on another page of the site shows the home page and stays there', home.path === '/' && home.hero, JSON.stringify(home));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/nostuck-home-390.png` });
  await ctx.close();
}

console.log('\n--- E. on the home page, his menu has the way back to his work ---');
{
  const { ctx, page, errs } = await open({ demo: 'admin' });
  await page.goto(`${P}/?demo=admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const nav = await page.evaluate(() => {
    const a = document.querySelector('[data-nav-auth] [data-nav-work]');
    return { href: a?.getAttribute('href') || '', text: a?.textContent.trim() || '', out: !!document.querySelector('[data-nav-auth] [data-signout]') };
  });
  // NEGATIVE CONTROL (run 2026-10-16): hydrateNav's Clients link taken out made this read
  //   FAIL  his menu on the home page offers Clients, then Sign out
  ok('his menu on the home page offers Clients, then Sign out', nav.href === '/admin.html' && nav.text === 'Clients' && nav.out, JSON.stringify(nav));
  await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const there = await page.evaluate(() => document.querySelectorAll('[data-nav-work]').length);
  ok('on his working pages it is not added twice', there === 0, String(there));
  ok('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
