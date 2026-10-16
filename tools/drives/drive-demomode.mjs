// drive-demomode.mjs - Demo mode, his practice copy, driven (v7.61).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-demomode.mjs
//
// Eric, 2026-10-16: "There should also be a button at the top called 'demo mode' where you press it and 4 of
// these clients appear. You can do a fake update with the advisor, the chat sends basic questions back when
// asked, you can upload documents and photos, start the time, and even within there start employer mode with
// the four 'employees' who each have done a different service and have made different amounts of money." And:
// "allow me to adjust each fake contractor's amount of clients and type before I run fake payroll". Driven from
// his demo here (the live site serves the same files to his cookie alone): in, around, and out again.
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
const folders = () => page.evaluate(() => [...document.querySelectorAll('.drawer .folder')].map((f) => ({
  id: f.dataset.id, name: f.querySelector('.folder-name, .tab-name, h3')?.textContent.trim() || f.textContent.trim().slice(0, 24), del: !!f.querySelector('[data-del]'),
})));
const tab = async (group, pageName) => {
  await page.evaluate(([g, p]) => { document.querySelector(`[data-group="${g}"]`)?.click(); document.querySelector(`[data-page="${p}"]`)?.click(); }, [group, pageName]);
  await page.waitForTimeout(700);
};

console.log('\n--- A. Demo mode from Clients: four clients, a strip that says so ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await page.reload({ waitUntil: 'networkidle' });
await settle(1500);
const door = await page.evaluate(() => (document.querySelector('[data-demo-mode]')?.textContent || '').trim());
await Promise.all([page.waitForEvent('load', { timeout: 8000 }).catch(() => {}), page.click('[data-demo-mode]', { timeout: 3000 }).catch(() => {})]);
await settle(2500);
const strip = await page.evaluate(() => ({
  text: document.querySelector('.demo-bar .demo-what')?.textContent.replace(/\s+/g, ' ').trim() || '',
  acts: [...document.querySelectorAll('.demo-bar .demo-acts button, .demo-bar .demo-acts a')].map((x) => x.textContent.trim()),
  door: !!document.querySelector('[data-demo-mode]'),
}));
const four = await folders();
if (SHOTS) await page.screenshot({ path: `${SHOTS}/demomode-a-shelf.png` });
// NEGATIVE CONTROL (run 2026-10-16): store.js's `const SEED = LIVE ? seedLive : seed;` made `const SEED = seed;` made this read
//   FAIL  the Demo mode button opens four clients under a strip that says Demo mode, with Start over and Exit, and every folder deletes
ok('the Demo mode button opens four clients under a strip that says Demo mode, with Start over and Exit, and every folder deletes',
  door === 'Demo mode' && /^Demo mode\. A practice copy\./.test(strip.text) && JSON.stringify(strip.acts) === JSON.stringify(['Start over', 'Exit']) && !strip.door
  && four.length === 4 && JSON.stringify(four.map((x) => x.id).sort()) === JSON.stringify(['demo-case', 'demo-case-ana', 'demo-case-full', 'demo-case-sam'])
  && four.every((x) => x.del), JSON.stringify({ door, strip, four }));

console.log('\n--- B. the chat answers back, a file goes up, the time starts ---');
await page.goto(`${P}/admin-case.html?id=demo-case-ana&demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
await tab('case', 'chat');
const n0 = await page.evaluate(() => document.querySelectorAll('#chat .msg').length);
await page.fill('#chat [data-input]', 'How did the echo go?');
await page.click('#chat .chat-form button[type="submit"]');
let reply = null;
for (let i = 0; i < 16 && !reply; i++) {
  await page.waitForTimeout(500);
  reply = await page.evaluate((n) => {
    const msgs = [...document.querySelectorAll('#chat .msg')];
    const last = msgs[msgs.length - 1];
    return msgs.length >= n + 2 && last?.classList.contains('them') ? (last.querySelector('.msg-text')?.textContent || '').trim() : null;
  }, n0);
}
// NEGATIVE CONTROL (run 2026-10-16): api.js's answer-back `setTimeout` taken out made this read
//   FAIL  a message to Priya is answered a moment later with a basic question from her
ok('a message to Priya is answered a moment later with a basic question from her', !!reply && /\?$/.test(reply), String(reply));
await page.setInputFiles('#chat [data-attach]', { name: 'insurance-card.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
await settle(2000);
await tab('case', 'files');
await settle(1200);
const up = await page.evaluate(() => [...document.querySelectorAll('#files [data-frow]')].map((li) => li.textContent.replace(/\s+/g, ' ').trim()));
// NEGATIVE CONTROL (run 2026-10-16): the demo store's listAll skipping chat-files made this read
//   FAIL  a photo shared in her chat lands in her uploads
ok('a photo shared in her chat lands in her uploads', up.some((x) => /insurance-card\.png/.test(x)), JSON.stringify(up));
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(1500);
await tryStep(() => page.click('.folder[data-id="demo-case-sam"] .folder-clock', { timeout: 3000 }));
await settle(1200);
const clock = await page.evaluate(() => document.querySelector('.folder[data-id="demo-case-sam"] .folder-clock')?.classList.contains('on') || false);
// NEGATIVE CONTROL (run 2026-10-16): the demo's `/api/work` route renamed so the clock is never answered made this read
//   FAIL  the time starts on Sam's folder
ok('the time starts on Sam\'s folder', clock);
await tryStep(() => page.click('.folder[data-id="demo-case-sam"] .folder-clock', { timeout: 3000 }));

console.log('\n--- C. a practice update ---');
await page.goto(`${P}/admin-case.html?id=demo-case-sam&demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
await tab('read', 'advisor');
const hadUpdate = !!(await page.$('[data-refresh]'));
await tryStep(() => page.click('[data-refresh]', { timeout: 3000 }));
let running = false;
for (let i = 0; i < 6 && !running; i++) { await page.waitForTimeout(300); running = await page.evaluate(() => /Reading|running|Working/i.test(document.querySelector('[data-updated]')?.textContent || '')); }
await page.waitForTimeout(5000);
const read = await page.evaluate(() => ({ line: document.querySelector('[data-updated]')?.textContent.trim() || '', body: (document.querySelector('.advisor')?.textContent || '').includes('19 of the last 30') }));
// NEGATIVE CONTROL (run 2026-10-16): live.js's Sam read written as `analysis: ''` made this read
//   FAIL  Update on Sam's read runs and settles, the read still there
ok('Update on Sam\'s read runs and settles, the read still there', hadUpdate && read.body && !/Reading the case/.test(read.line), JSON.stringify({ hadUpdate, running, read }));

console.log('\n--- D. Employer mode: four team members, four amounts, their side read only ---');
await page.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
const team = await page.evaluate(() => [...document.querySelectorAll('.tm-card')].map((c) => ({ uid: c.dataset.uid, name: c.querySelector('.tm-name')?.textContent.trim(), money: c.querySelector('.tm-money strong')?.textContent.trim() })));
const four2 = team.filter((t) => ['demo-advocate', 'demo-marcus', 'demo-grace', 'demo-luis'].includes(t.uid));
// NEGATIVE CONTROL (run 2026-10-16): Grace Kim's uid in live.js's LIVE_TEAM changed to one no case is handed to made this read
//   FAIL  Employer mode shows the four, each with a different amount
ok('Employer mode shows the four, each with a different amount', four2.length === 4 && new Set(four2.map((t) => t.money)).size === 4, JSON.stringify(team));
await page.goto(`${P}/admin.html?as=demo-marcus&demo=admin`, { waitUntil: 'networkidle' });
await settle(2000);
const theirs = await page.evaluate(() => ({ bar: !!document.querySelector('.quiet-bar'), ids: [...document.querySelectorAll('.drawer .folder')].map((f) => f.dataset.id) }));
// NEGATIVE CONTROL (run 2026-10-16): live.js's `hand(id, 'demo-marcus', 'Marcus')` for Jordan's case taken out made this read
//   FAIL  tapping Marcus shows his side, read only: Jordan alone
ok('tapping Marcus shows his side, read only: Jordan alone', theirs.bar && JSON.stringify(theirs.ids) === JSON.stringify(['demo-case-full']), JSON.stringify(theirs));

console.log('\n--- E. the practice team, set before a practice payroll ---');
await page.goto(`${P}/admin-employer.html?demo=admin#payroll`, { waitUntil: 'networkidle' });
await settle(1500);
await tryStep(() => page.click('[data-emp-tab="payroll"]', { timeout: 2000 }));
await settle(1200);
const panel = await page.evaluate(() => ({
  shown: !document.getElementById('practice')?.hidden,
  rows: [...document.querySelectorAll('#practice [data-practice]')].map((r) => r.dataset.practice),
  wide: document.documentElement.scrollWidth > window.innerWidth + 1,
}));
// NEGATIVE CONTROL (run 2026-10-16): admin-employer.js mounting the panel on `=== '2'` made this read
//   FAIL  the payroll screen opens with the practice team: four rows, on a phone screen
ok('the payroll screen opens with the practice team: four rows, on a phone screen', panel.shown && panel.rows.length === 4 && !panel.wide, JSON.stringify(panel));
await page.fill('#practice [data-practice="demo-advocate"] [data-practice-n]', '3');
await page.selectOption('#practice [data-practice="demo-advocate"] [data-practice-kind]', 'full');
await page.click('#practice [data-practice-set]');
await settle(1200);
const said = await page.evaluate(() => document.querySelector('#practice [data-practice-said]')?.textContent.trim() || '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/demomode-e-practice.png`, fullPage: true });
await page.click('#pr-form button[type="submit"]', { timeout: 3000 }).catch(() => {});
await settle(2000);
const ana = await page.evaluate(() => {
  const row = [...document.querySelectorAll('table.pr tr')].find((tr) => /Ana Rivera/.test(tr.textContent));
  return row ? row.textContent.replace(/\s+/g, ' ').trim() : '';
});
// NEGATIVE CONTROL (run 2026-10-16): practice.js sending `kind: 'case'` whatever was chosen made this read
//   FAIL  three Full-Service clients for Ana, then Run payroll, pays her exactly that: $7,920
ok('three Full-Service clients for Ana, then Run payroll, pays her exactly that: $7,920', /^Set\. /.test(said) && /\b3 \$13,200 /.test(ana) && /\+ \$7,920(\.00)? /.test(ana), JSON.stringify({ said, ana }));

console.log('\n--- F. Exit ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(1500);
await Promise.all([page.waitForEvent('load', { timeout: 8000 }).catch(() => {}), page.click('.demo-bar [data-demo-exit]', { timeout: 3000 }).catch(() => {})]);
await settle(2500);
const out = await page.evaluate(() => ({
  flag: sessionStorage.getItem('pa-demo-live'), door: !!document.querySelector('[data-demo-mode]'),
  strip: document.querySelector('.demo-bar .demo-what')?.textContent.replace(/\s+/g, ' ').trim() || '',
  sam: !!document.querySelector('.folder[data-id="demo-case-sam"]'),
}));
// NEGATIVE CONTROL (run 2026-10-16): banner.js's Exit leaving the switch on made this read
//   FAIL  Exit turns the switch off and lands back outside the copy, with the Demo mode button there again
ok('Exit turns the switch off and lands back outside the copy, with the Demo mode button there again',
  out.flag === null && out.door && !/^Demo mode\./.test(out.strip) && !out.sam, JSON.stringify(out));

ok('no page errors', !errs.length, errs.join(' | '));
await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
