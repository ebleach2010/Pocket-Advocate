// drive-apikey.mjs - the spot for the ChatGPT key, in a real browser.
//
//   PA_PORT=8901 node tools/drives/drive-apikey.mjs
//
// Eric, 2026-08-27: "Give me a fucking spot for a ChatGPT API token to take
// over the SOAPS creation."
//
// apikey.mjs proves the server never hands the key back. It cannot prove the
// row reaches the screen, that the box is reachable with a thumb, or that the
// key he just typed is gone from the page afterwards. Those are DOM facts and
// they need a browser.
//
// Observed 2026-08-27: see the tail of this file's run.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8901}`;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ', n, d ? `(${d})` : ''); } else { fail++; console.log('  FAIL ', n, d ? `(${d})` : ''); } };

const KEY = 'sk-proj-driveTESTkey0123456789abcdefghijklmnopQRST';

// Before the browser: the real route, asked by a stranger. The demo mirror
// answers the panel, so nothing else here touches the Worker's own handler,
// and the one thing that handler must never do is admit it exists. Node's
// fetch, not the page's, because the demo replaces window.fetch outright.
{
  const paths = ['/api/admin/openai-key', '/api/admin/effort',
                 '/api/admin/not-a-real-route', '/api/admin/zzz'];
  const seen = [];
  for (const path of paths) {
    const r = await fetch(`${P}${path}`).catch(() => null);
    seen.push(r ? `${r.status} ${await r.text()}` : 'no answer');
  }
  // Negative control run 2026-08-27: make the route answer 403 "Admins only"
  // and both of these go red, printing the 403 beside the three 404s.
  ok('a stranger gets 404 from the key route', seen[0].startsWith('404'), seen[0]);
  ok('byte for byte what a made-up route gives, so it admits nothing',
    new Set(seen).size === 1, seen.join(' | '));
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('dialog', (d) => d.accept());   // the Remove confirmation

await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// Open Settings the way he does: tap the cog.
const cog = page.locator('.cog-btn').first();
ok('the settings cog is on the admin dashboard', await cog.count() > 0);
const cogBox = await cog.boundingBox().catch(() => null);
ok('and it is a real touch target', !!cogBox && cogBox.width >= 40 && cogBox.height >= 40,
  cogBox ? `${Math.round(cogBox.width)}x${Math.round(cogBox.height)}` : 'missing');
await cog.click();
// The advocate rows arrive by dynamic import, so they are not there on the
// first frame. Wait for the row itself rather than a fixed pause.
await page.waitForSelector('[data-oa-key]', { timeout: 8000 }).catch(() => {});

const row = await page.evaluate(() => {
  const box = document.querySelector('[data-oa-key]');
  const st = document.querySelector('[data-oa-state]');
  const clear = document.querySelector('[data-oa-clear]');
  const r = box?.getBoundingClientRect();
  return {
    present: !!box,
    type: box?.getAttribute('type') || '',
    h: r ? Math.round(r.height) : 0,
    w: r ? Math.round(r.width) : 0,
    right: r ? Math.round(r.right) : 0,
    state: st?.textContent.trim() || '',
    clearHidden: clear ? clear.hidden : null,
    heading: [...document.querySelectorAll('h4')].some((x) => /ChatGPT key/.test(x.textContent)),
  };
});
ok('the ChatGPT key row is on the screen', row.present && row.heading);
ok('the key box is a password field', row.type === 'password');
ok('it is tall enough to tap', row.h >= 40, `${row.h}px`);
ok('and it does not run off a 390px screen', row.right <= 390, `right edge ${row.right}px`);
ok('it starts by saying no key is saved', /No key saved yet/i.test(row.state), row.state);
ok('Remove is hidden while there is nothing to remove', row.clearHidden === true);

// A bad paste is refused, and the row does not pretend otherwise.
await page.fill('[data-oa-key]', 'hunter2');
await page.click('[data-oa-save]');
await page.waitForTimeout(700);
const bad = await page.evaluate(() => ({
  msg: document.querySelector('[data-oa-msg]')?.textContent.trim() || '',
  hidden: document.querySelector('[data-oa-msg]')?.hidden,
  state: document.querySelector('[data-oa-state]')?.textContent.trim() || '',
}));
ok('a bad paste is refused out loud', !bad.hidden && /does not look like one/i.test(bad.msg), bad.msg);
ok('and the row still says no key is saved', /No key saved yet/i.test(bad.state), bad.state);

// A good one is accepted.
await page.fill('[data-oa-key]', KEY);
await page.click('[data-oa-save]');
await page.waitForTimeout(900);
const good = await page.evaluate((k) => ({
  msg: document.querySelector('[data-oa-msg]')?.textContent.trim() || '',
  state: document.querySelector('[data-oa-state]')?.textContent.trim() || '',
  boxValue: document.querySelector('[data-oa-key]')?.value || '',
  clearHidden: document.querySelector('[data-oa-clear]')?.hidden,
  // The whole claim, asked of the rendered page: is the key anywhere on it.
  inDom: document.documentElement.outerHTML.includes(k),
  inStorage: Object.keys(localStorage).some((x) => (localStorage.getItem(x) || '').includes(k)),
}), KEY);
ok('a good key is accepted', /accepted it/i.test(good.msg), good.msg);
ok('the row now names its last four', good.state.includes(KEY.slice(-4)), good.state);
// It read "Key ending QRST is saved, saved Aug 27." the first time this ran.
ok('and says saved once, not twice', (good.state.match(/saved/gi) || []).length === 1, good.state);
ok('THE BOX IS EMPTIED', good.boxValue === '', JSON.stringify(good.boxValue));
ok('THE KEY IS NOWHERE IN THE PAGE', !good.inDom);
ok('and nowhere in local storage', !good.inStorage);
ok('Remove has appeared', good.clearHidden === false);

// And it can be taken away again.
await page.click('[data-oa-clear]');
await page.waitForTimeout(900);
const gone = await page.evaluate(() => ({
  state: document.querySelector('[data-oa-state]')?.textContent.trim() || '',
  clearHidden: document.querySelector('[data-oa-clear]')?.hidden,
}));
ok('Remove takes it away', /No key saved yet/i.test(gone.state), gone.state);
ok('and Remove hides itself again', gone.clearHidden === true);

ok('no page errors', errs.length === 0, errs.join(' | '));
await page.screenshot({ path: '/tmp/pa-apikey-row.png' });
await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
