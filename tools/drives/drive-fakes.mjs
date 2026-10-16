// drive-fakes.mjs - Delete on the folders of invented clients, a real client's delete in Settings, and the
// Clients heading in line (v7.60).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-fakes.mjs
//
// Eric, 2026-10-16, with a screenshot of the sample contractor's invented clients on his shelf: "'Delete' for
// sample fake clients should be on the folders. For real clients it should be in settings". And, with one of
// the heading: "Move the employer mode and + buttons up slightly so they're in line with 'Clients'".
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
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
const settle = (ms = 2000) => page.waitForTimeout(ms);

console.log('\n--- A. invented clients carry Delete on their folders; a real client\'s does not ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await page.reload({ waitUntil: 'networkidle' });
await settle(1500);
// The demo keeps the sample contractor, made through her route, to stand in for the ones still on his real shelf.
await page.evaluate(() => fetch('/api/admin/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"action":"sample-create"}' }));
await page.reload({ waitUntil: 'networkidle' });
await settle();
const shelf = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.drawer .folder')].map((f) => [f.dataset.id, !!f.querySelector('[data-del]')])));
// NEGATIVE CONTROL (run 2026-10-16): admin.js's `deletable: !asUid && !c.clientUid && !!(c.self || c.showcase)` put back to `deletable: !asUid && !c.sample && !!(c.self || c.showcase)` made this read
//   FAIL  each invented client's folder carries Delete, and a real client's folder never does
ok('each invented client\'s folder carries Delete, and a real client\'s folder never does',
  shelf['demo-sample-dana'] === true && shelf['demo-sample-grace'] === true && shelf['demo-case'] === false && shelf['demo-case-ana'] === false,
  JSON.stringify(shelf));
await page.click('.folder[data-id="demo-sample-dana"] [data-del]');
await page.waitForTimeout(400);
await tryStep(() => page.click('dialog.ask-sheet button[value="ok"]', { timeout: 3000 }));
await settle(1800);
const goneDana = await page.evaluate(() => !document.querySelector('.folder[data-id="demo-sample-dana"]') && !!document.querySelector('.folder[data-id="demo-sample-grace"]'));
ok('Delete takes that one invented client and leaves the rest', goneDana);

console.log('\n--- B. a real client\'s case: Settings on their case, their name typed ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(1500);
await page.click('.cog-btn');
await page.waitForTimeout(800);
const onShelf = await page.evaluate(() => !!document.querySelector('.settings-overlay [data-del-case]'));
ok('on the Clients page Settings offers no delete', !onShelf);
await page.keyboard.press('Escape');
await page.goto(`${P}/admin-case.html?id=demo-case-ana&demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
await page.click('.cog-btn');
await page.waitForTimeout(1000);
const row = () => page.evaluate(() => {
  const o = document.querySelector('.settings-overlay');
  const btn = o?.querySelector('[data-del-case]');
  return { head: [...(o?.querySelectorAll('h4') || [])].map((h) => h.textContent.trim()).find((t) => /^Delete /.test(t)) || '', disabled: btn ? btn.disabled : null };
});
const r0 = await row();
await page.fill('.settings-overlay [data-del-confirm]', 'Priya');
const r1 = await row();
await page.fill('.settings-overlay [data-del-confirm]', '  priya   shah ');
const r2 = await row();
if (SHOTS) {
  await page.evaluate(() => document.querySelector('.settings-overlay [data-del-case]')?.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `${SHOTS}/fakes-b-settings-delete.png` });
}
// NEGATIVE CONTROL (run 2026-10-16): admin-settings.js's `box.addEventListener('input', ...)` unlocking on any text (`go.disabled = false`) made this read
//   FAIL  the row is under their name, locked, still locked on part of it, and unlocked on the whole name in any spacing or case
ok('the row is under their name, locked, still locked on part of it, and unlocked on the whole name in any spacing or case',
  r0.head === "Delete Priya Shah's case" && r0.disabled === true && r1.disabled === true && r2.disabled === false, JSON.stringify({ r0, r1, r2 }));
await page.click('.settings-overlay [data-del-case]');
await page.waitForURL(/\/admin(\.html)?$/, { timeout: 10000 }).catch(() => {});
await settle(2000);
const goneReal = await page.evaluate(() => ({ path: location.pathname, priya: !!document.querySelector('.folder[data-id="demo-case-ana"]'), jordan: !!document.querySelector('.folder[data-id="demo-case"]') }));
ok('Delete takes their case and comes home to the shelf without it, and nobody else\'s', /\/admin(\.html)?$/.test(goneReal.path) && !goneReal.priya && goneReal.jordan, JSON.stringify(goneReal));
const refused = await page.evaluate(async () => {
  const r = await fetch('/api/admin/delete-case', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"caseId":"demo-case"}' });
  return { status: r.status, body: await r.json().catch(() => ({})) };
});
ok('a real case posted from anywhere else, without the typed name, is refused', refused.status === 409 && /in Settings on their case/.test(refused.body.error || ''), JSON.stringify(refused));

console.log('\n--- C. the Clients heading ---');
for (const width of [390, 430]) {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
  await settle(1500);
  const m = await page.evaluate(() => {
    const mid = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
    return { h1: mid(document.querySelector('.clients-head h1')), emp: mid(document.querySelector('.clients-head .employer-btn')), add: mid(document.querySelector('.clients-head .add-btn')) };
  });
  // NEGATIVE CONTROL (run 2026-10-16): the heading's `margin: 0` taken out of admin.html made this read
  //   FAIL  Employer mode and the + sit on the same centre line as "Clients"
  ok(`Employer mode and the + sit on the same centre line as "Clients" at ${width}px`,
    m.h1 !== null && m.emp !== null && m.add !== null && Math.abs(m.h1 - m.emp) <= 1 && Math.abs(m.h1 - m.add) <= 1, JSON.stringify(m));
  if (SHOTS && width === 390) await page.screenshot({ path: `${SHOTS}/fakes-c-heading.png`, clip: { x: 0, y: 0, width, height: 320 } });
}

ok('no page errors', !errs.length, errs.join(' | '));
await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
