// drive-trade.mjs - the Trade portal, driven in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-trade.mjs
//
// Eric, 2026-09-21: "Essentially a mini app within the app just for me."
// The demo seeds his desk (a key on file, a scan with two plays, a note, an
// answered question, fifteen trading days of balances) and the mirror lands
// a question or a scan four seconds after it is asked, which is the shape
// production has. Nothing here talks to a market or a model.
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
    const hit = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim()) && !e.closest('.play-card')); if (x) x.click(); return !!x; });
    await pg.waitForTimeout(250); if (!hit) break;
  }
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
const tab = async (name) => { await page.click(`[data-tab="${name}"]`); await page.waitForTimeout(500); };
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };

console.log('\n--- A. the page, its five tabs, and the seeded desk ---');
await page.goto(`${P}/admin-trade.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); localStorage.removeItem('pa-trade-tab'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
const tabs = await until(() => { const t = [...document.querySelectorAll('[data-tab]')].map((b) => b.dataset.tab); return t.length === 5 ? t.join() : null; });
ok('five tabs', tabs === 'desk,plays,account,stats,settings', tabs || '');
const seeded = await until(() => { const f = document.querySelector('[data-feed]'); return f && /Scan 09:30/.test(f.textContent || '') && /2 plays, see Plays/.test(f.textContent || '') ? f.textContent.slice(0, 80) : null; });
ok('the seeded scan row shows with its plays link', !!seeded, seeded || '');
const next = await page.evaluate(() => document.querySelector('[data-next]')?.textContent || '');
ok('the next scan line reads', /Next scan/.test(next), next);
await shot('01-desk');

console.log('\n--- B. a question lands on its own ---');
await page.fill('[data-ask] [data-q]', 'Is NVDA a long here or am I late?');
await page.click('[data-ask] .btn');
const thinking = await until(() => { const r = [...document.querySelectorAll('[data-feed] .panel')].find((x) => /Is NVDA a long here/.test(x.textContent || '')); return r && /Thinking/.test(r.textContent) ? 'thinking' : null; }, 10000);
ok('the question shows at once as thinking', thinking === 'thinking');
const landed = await until(() => { const r = [...document.querySelectorAll('[data-feed] .panel')].find((x) => /Is NVDA a long here/.test(x.textContent || '')); const a = r?.querySelector('.trade-a')?.textContent || ''; return a && !/Thinking/.test(a) ? a : null; }, 30000);
ok('the answer lands without a tap', !!landed && /call debit spread/.test(landed), (landed || '').slice(0, 80));
await shot('02-answer');

console.log('\n--- C. the balance he types moves the number and the list ---');
await tab('account');
const before = await page.evaluate(() => document.querySelector('.trade-big')?.textContent || '');
ok('the current balance reads from the seed', before === '$2,380.00', before);
const proj = await page.evaluate(() => document.querySelector('[data-acct-top]')?.textContent || '');
ok('the projections show after fifteen trading days', /Projected year/.test(proj) && /a year/.test(proj), proj.slice(0, 60));
await page.fill('[data-acct-form] input[name="dollars"]', '2410');
await page.fill('[data-acct-form] input[name="note"]', 'after close');
await page.click('[data-acct-form] button[type="submit"]');
const after = await until(() => { const v = document.querySelector('.trade-big')?.textContent || ''; return v === '$2,410.00' ? v : null; }, 10000);
ok('the big number moves to what he typed', after === '$2,410.00', after || '');
const listed = await page.evaluate(() => document.querySelector('[data-acct-list]')?.textContent || '');
ok('the list carries the entry with its note', /\$2,410\.00/.test(listed) && /after close/.test(listed));
await shot('03-account');

console.log('\n--- D. the chart and the target line ---');
await tab('stats');
const chart = await until(() => { const s = document.querySelector('[data-stats] svg[role="img"]'); return s ? { lines: s.querySelectorAll('polyline').length, target: !!s.querySelector('polyline[stroke="var(--target)"]'), dots: s.querySelectorAll('circle').length } : null; });
ok('one SVG with two polylines, the target in its token, a dot per entry', !!chart && chart.lines === 2 && chart.target && chart.dots >= 6, JSON.stringify(chart));
const sentence = await page.evaluate(() => document.querySelector('[data-stats] p strong')?.textContent || '');
ok('the sentence says how far off the 3% a day line he is', /(below|above) the 3% a day line/.test(sentence), sentence);
await shot('04-stats');

console.log('\n--- E. a play taken, then closed ---');
await tab('plays');
const cards = await until(() => { const c = document.querySelectorAll('.play-card'); return c.length >= 2 ? c.length : null; });
ok('the two seeded plays are cards under Trade differential', cards >= 2 && /Trade differential/.test(await page.evaluate(() => document.querySelector('[data-pane="plays"] h2')?.textContent || '')), String(cards));
const chance = await page.evaluate(() => document.querySelector('.play-card .play-chance')?.textContent || '');
ok('a card reads its chance of profit as a range', /55 to 65% chance of profit/.test(chance), chance);
await page.click('.play-card[data-play="p-demo-1"] [data-act="took"]');
const taken = await until(() => { const c = document.querySelector('.play-card[data-play="p-demo-1"]'); return c && /Taken/.test(c.textContent || '') && c.querySelector('[data-outcome]') ? 'taken' : null; }, 10000);
ok('Took it marks the card taken and offers Closed at', taken === 'taken');
await page.fill('.play-card[data-play="p-demo-1"] [data-outcome]', '45');
await page.click('.play-card[data-play="p-demo-1"] [data-act="closed"]');
const closed = await until(() => { const c = document.querySelector('.play-card[data-play="p-demo-1"]'); return c && /Closed \+\$45\.00/.test(c.textContent || '') ? 'closed' : null; }, 10000);
ok('Close with +45 reads Closed +$45.00', closed === 'closed');
await shot('05-plays');

console.log('\n--- F. settings paint from the server and a switch waits for the answer ---');
await tab('settings');
const keySaid = await until(() => { const t = document.querySelector('[data-key-said]')?.textContent || ''; return /Key on file, ends in 1234/.test(t) ? t : null; });
ok('the key row says it is on file and ends in 1234, never the key', !!keySaid && !/demo-finnhub-key/.test(await page.evaluate(() => document.body.textContent)), keySaid || '');
const startVal = await page.evaluate(() => document.querySelector('[data-start-dollars]')?.value || '');
ok('the starting amount paints from the server', startVal === '2000', startVal);
await page.fill('[data-start-dollars]', '2500');
await page.click('[data-start-save]');
const startSaved = await until(() => (document.querySelector('[data-set-said]')?.textContent === 'Saved.' ? 'saved' : null), 10000);
await tab('stats');
const legend = await until(() => { const t = document.querySelector('.trade-legend')?.textContent || ''; return /from \$2,500\.00/.test(t) ? t : null; }, 10000);
ok('a changed starting amount moves the target line', startSaved === 'saved' && !!legend, legend || '');
await tab('settings');
const wasOn = await page.evaluate(() => document.querySelector('[data-sw="scansOn"]')?.getAttribute('aria-pressed'));
await page.click('[data-sw="scansOn"]');
const flipped = await until(() => (document.querySelector('[data-sw="scansOn"]')?.getAttribute('aria-pressed') === 'false' ? 'off' : null), 10000);
ok('the scans switch paints off only once the server has answered', wasOn === 'true' && flipped === 'off');
await tab('desk');
const offLine = await until(() => { const t = document.querySelector('[data-next]')?.textContent || ''; return /Scans are off/.test(t) ? t : null; }, 10000);
ok('the desk says the scans are off', !!offLine, offLine || '');
await shot('06-settings');

ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
