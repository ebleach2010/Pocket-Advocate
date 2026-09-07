// drive-ask.mjs - a question rides the batch, and the panel waits for it honestly.
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-ask.mjs
//
// Eric, 2026-09-07: "now when asking the advisor something: The server
// answered with something this page could not read". In the demo the ask
// route writes the row running with a batch on it and the state route lands
// the answer four seconds later, which is the shape production has now: the
// page shows the question at once as thinking, keeps polling, and paints the
// answer when it lands. Nothing here talks to a model.
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
const until = async (fn, ms = 20000) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(400);
  }
};
const QUESTION = 'Where is his timeline of symptoms, the one he filled out? I am not seeing it anywhere.';

console.log('\n--- A. the question shows at once as thinking, and the page does not call it dead ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
const caseHref = await page.evaluate(() => [...document.querySelectorAll('a[href*="admin-case"]')]
  .map((a) => a.getAttribute('href')).find((h) => !/mine|showcase/.test(h || '')));
ok('the shelf lists a client\'s case', !!caseHref, caseHref || '');
const caseUrl = /^https?:/.test(caseHref || '') ? caseHref : `${P}${caseHref}`;
await page.goto(caseUrl, { waitUntil: 'networkidle' });
await settle(page, 2000);
await show('read', 'advisor-chat');
const boxSeen = await until(() => { const t = document.querySelector('[data-ask] [data-q]'); return !!(t && t.offsetParent !== null); });
ok('the Ask page shows the question box', !!boxSeen);
await page.fill('[data-ask] [data-q]', QUESTION);
await page.click('[data-ask] button');
const early = await until(() => { const r = [...document.querySelectorAll('.advisor-turn')].find((r) => /Where is his timeline/.test(r.textContent || '')); return r ? (r.querySelector('.advisor-a')?.textContent || '') : null; }, 10000);
ok('the question shows at once and says thinking', !!early && /thinking/.test(early), (early || '').slice(0, 80));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-thinking.png` });
await page.waitForTimeout(2000);
const mid = await page.evaluate(() => [...document.querySelectorAll('.advisor-turn')].find((r) => /Where is his timeline/.test(r.textContent || ''))?.querySelector('.advisor-a')?.textContent || '');
ok('two seconds in it is still thinking, not "No answer came back"', /thinking/.test(mid) && !/No answer/.test(mid), mid.slice(0, 80));

console.log('\n--- B. the answer lands on its own, painted by the poll ---');
const late = await until(() => { const r = [...document.querySelectorAll('.advisor-turn')].find((r) => /Where is his timeline/.test(r.textContent || '')); const a = r?.querySelector('.advisor-a')?.textContent || ''; return a && !/thinking/.test(a) ? a : null; }, 30000);
ok('the answer lands without a tap', !!late && /give the clinic until Thursday/.test(late), (late || '').slice(0, 100));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-landed.png` });
const err = await page.evaluate(() => { const e = document.querySelector('[data-err]'); return e && !e.hidden ? e.textContent : ''; });
ok('no error line for the ask', !/could not read|refused|failed/i.test(err || ''), (err || '').slice(0, 100));
const stored = await page.evaluate(() => {
  try {
    const s = JSON.parse(localStorage.getItem('pa-demo-store-advocate') || localStorage.getItem('pa-demo-store') || '{}');
    return (s.docs || []).filter(([p]) => p.includes('/advisor/state/qa/')).map(([, d]) => ({ status: d.status, batch: d.batch || null, hasAnswer: !!d.answer }));
  } catch { return null; }
});
ok('the landed row is done with the batch cleared', Array.isArray(stored) && stored.some((r) => r.status === 'done' && r.batch === null && r.hasAnswer), JSON.stringify(stored));

console.log('\n--- C. a second question keeps the first answer on screen ---');
await page.fill('[data-ask] [data-q]', 'And is the referral actually in?');
await page.click('[data-ask] button');
const both = await until(() => { const rows = [...document.querySelectorAll('.advisor-turn')]; return rows.length >= 2 && /thinking/.test(rows[rows.length - 1].textContent || '') ? rows.length : null; }, 10000);
ok('the second question sits under the first, thinking, with the first answer still painted', !!both && /give the clinic until Thursday/.test(await page.evaluate(() => document.querySelector('[data-qa]')?.textContent || '')), String(both));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-second.png` });

ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
