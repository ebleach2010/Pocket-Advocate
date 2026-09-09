// drive-selection.mjs - a selection inside an answer survives the poll.
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-selection.mjs
//
// Eric, 2026-09-09: "when I go to select text from the advisor, it only
// selects it for maybe two seconds, making it extremely difficult to copy to
// paste". The answers were repainted whole on every poll, and the panel polls
// every two and a half seconds while anything is running. This drives the
// exact case: an answer selected while a second question is still being
// answered, held through several polls.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || '9377';
const SHOTS = process.env.PA_SHOTS || '';
const P = `http://127.0.0.1:${PORT}`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' (' + d + ')' : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' (' + d + ')' : ''}`)); };
const settle = async (pg, ms = 1500) => {
  await pg.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await pg.waitForTimeout(250); if (!hit) break;
  }
};
const show = async (group, pg) => {
  await page.evaluate(([g, p]) => { document.querySelector(`[data-group="${g}"]`)?.click(); document.querySelector(`[data-page="${p}"]`)?.click(); }, [group, pg]);
  await page.waitForTimeout(600);
};
const until = async (fn, ms = 30000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(400);
  }
};
// What the browser currently has selected, trimmed.
const selected = () => page.evaluate(() => (window.getSelection()?.toString() || '').trim());

console.log('\n--- A. an answer on the page, and a second question still running under it ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
const caseHref = await page.evaluate(() => [...document.querySelectorAll('a[href*="admin-case"]')]
  .map((a) => a.getAttribute('href')).find((h) => !/mine|showcase/.test(h || '')));
const caseUrl = /^https?:/.test(caseHref || '') ? caseHref : `${P}${caseHref}`;
await page.goto(caseUrl, { waitUntil: 'networkidle' });
await settle(page, 2000);
await show('read', 'advisor-chat');
await until(() => { const t = document.querySelector('[data-ask] [data-q]'); return !!(t && t.offsetParent !== null); });
await page.fill('[data-ask] [data-q]', 'What is the cleanest way to word the appeal?');
await page.click('[data-ask] button');
const landed = await until(() => {
  const a = document.querySelector('[data-qa] .advisor-turn .advisor-a');
  const t = a?.textContent || '';
  return t && !/thinking/.test(t) ? t : null;
});
ok('the first answer has landed', !!landed, (landed || '').slice(0, 60));

// A second question, so a row under it stays running and the panel keeps
// polling at its busy cadence. This is his case exactly.
await page.fill('[data-ask] [data-q]', 'And who signs it?');
await page.click('[data-ask] button');
const running = await until(() => {
  const rows = [...document.querySelectorAll('[data-qa] .advisor-turn')];
  return rows.length >= 2 && /thinking/.test(rows[rows.length - 1].textContent || '') ? rows.length : null;
}, 10000);
ok('a second question sits under it, still being answered', !!running, String(running));

console.log('\n--- B. select the first answer, and keep it ---');
// Select the whole of the first answer, the way a long press does.
const wanted = await page.evaluate(() => {
  const a = document.querySelector('[data-qa] .advisor-turn .advisor-a');
  const r = document.createRange();
  r.selectNodeContents(a);
  const s = window.getSelection();
  s.removeAllRanges();
  s.addRange(r);
  return (s.toString() || '').trim();
});
ok('the answer is selected', wanted.length > 40, `${wanted.length} chars`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-selected.png` });

// Two and a half seconds is one poll. Hold it through several.
const marks = [];
for (const wait of [3000, 3000, 3000]) {
  await page.waitForTimeout(wait);
  marks.push((await selected()).length);
}
ok('the selection is still there nine seconds and several polls later', marks.every((n) => n === wanted.length), marks.join(', '));
const still = await selected();
ok('and it is the same words, so a copy would take the whole answer', still === wanted, `${still.length} of ${wanted.length}`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-still-selected.png` });

console.log('\n--- C. the second answer still lands while the first is held ---');
const second = await until(() => {
  const rows = [...document.querySelectorAll('[data-qa] .advisor-turn')];
  const last = rows[rows.length - 1]?.querySelector('.advisor-a')?.textContent || '';
  return last && !/thinking/.test(last) ? last : null;
}, 30000);
ok('the second answer lands', !!second, (second || '').slice(0, 50));
const after = await selected();
ok('and the first answer keeps its selection through that landing', after === wanted, `${after.length} of ${wanted.length}`);

ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
