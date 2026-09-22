// drive-trade.mjs - the trade desk as a case file, driven in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-trade.mjs
//
// Eric, 2026-09-22: "Make it a case file highlighted green ... Just like
// with medical cases I can pause it or manually update. I can also ask the
// advisor questions and send him screenshots of my positions and portfolio
// total, which get added the portfolio metrics ... There's also a chat
// where I can essentially track each trade and the logic."
//
// The demo seeds the desk (a green case with a trade log, a reading in the
// desk's sections, two plays, typed balances, a key on file) and the mirror
// lands a question four seconds after it is asked, which is the shape
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
page.on('dialog', async (d) => { if (d.type() === 'confirm') await d.accept(); else await d.dismiss(); });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' (' + d + ')' : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' (' + d + ')' : ''}`)); };
const settle = async (pg, ms = 1500) => {
  await pg.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim()) && !e.closest('.play-card')); if (x) x.click(); return !!x; });
    await pg.waitForTimeout(250); if (!hit) break;
  }
};
const until = async (fn, ms = 20000, arg = null) => {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn, arg);
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await page.waitForTimeout(400);
  }
};
const show = async (group, pg) => {
  await page.evaluate(([g, p]) => { document.querySelector(`[data-group="${g}"]`)?.click(); document.querySelector(`[data-page="${p}"]`)?.click(); }, [group, pg]);
  await page.waitForTimeout(700);
};
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); };
const hex2rgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };
const green = async (sel, prop = 'color') => page.evaluate(([s, p]) => {
  const el = document.querySelector(s);
  if (!el) return null;
  return { want: getComputedStyle(document.documentElement).getPropertyValue('--trade').trim(), got: getComputedStyle(el)[p] };
}, [sel, prop]);

console.log('\n--- A. the shelf: the green desk under his own case, no door while it is open ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
const shelf = await until(() => {
  const h2 = [...document.querySelectorAll('h2')].map((h) => h.textContent.trim());
  const card = document.querySelector('.folder.trade');
  if (!card) return null;
  return {
    section: h2.includes('TRADE DESK'), mine: h2.includes('MY OWN CASE'),
    order: h2.indexOf('TRADE DESK') < h2.indexOf('CURRENT CLIENTS: REPORT PHASE'),
    name: card.querySelector('.folder-name')?.textContent.trim(), pill: card.querySelector('.status-pill')?.textContent.trim(),
    meta: card.querySelector('.folder-meta')?.textContent.trim(), dx: card.querySelector('.folder-dx')?.textContent.trim(),
    door: !!document.querySelector('[data-open-trade]'), self: card.classList.contains('self'),
  };
});
ok('the TRADE DESK shelf sits above the client shelves with the desk on it and no door', !!shelf && shelf.section && shelf.order && !shelf.door, JSON.stringify(shelf));
ok('the card is named, badged TRADE DESK and carries its standing under its cover', !!shelf && shelf.name === 'Trade desk' && shelf.pill === 'TRADE DESK' && /pts under 3% a day/.test(shelf.meta || '') && /stops go missing/.test(shelf.dx || ''), `${shelf?.meta} | ${shelf?.dx}`);
const outline = await green('.folder.trade', 'outlineColor');
// The desk is self AND trade, so the card carries both classes; the green is
// declared after the purple and is what paints.
const purpleWant = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--self').trim());
ok('and it wears the green, not the purple', !!outline && outline.got === hex2rgb(outline.want) && outline.got !== hex2rgb(purpleWant), outline ? `${outline.got} vs ${outline.want}` : '');
await shot('01-shelf');

console.log('\n--- B. the case: the masthead, the groups, the overview with Pause ---');
await page.click('.folder.trade');
await page.waitForURL(/admin-case(\.html)?\?id=demo-case-trade/, { timeout: 15000 });
await settle(page, 2000);
const head = await page.evaluate(() => ({
  cls: document.querySelector('.case-head')?.className || '',
  pill: (document.querySelector('[data-status]')?.textContent || '').trim(),
  name: (document.querySelector('[data-client]')?.textContent || '').trim(),
  groups: [...document.querySelectorAll('[data-group]')].map((t) => t.dataset.group),
}));
ok('the masthead says TRADE DESK in green with the desk\'s name', /\btrade\b/.test(head.cls) && !/\bself\b/.test(head.cls) && head.pill === 'TRADE DESK' && head.name === 'Trade desk', `${head.pill} / ${head.cls}`);
const pillColor = await green('[data-status]');
ok('and the pill is the green', !!pillColor && pillColor.got === hex2rgb(pillColor.want), pillColor ? `${pillColor.got} vs ${pillColor.want}` : '');
ok('four groups, no Act', head.groups.join() === 'case,read,mine,track', head.groups.join(','));
// ERIC, 2026-09-22, the screenshot: every medical page swept into the Case row, the Appeal form
// on top, the clock in the masthead. The desk gets its own furniture and nothing else.
const furniture = await page.evaluate(() => ({
  on: document.querySelector('a[data-page].on')?.dataset.page || '',
  caseRow: [...document.querySelectorAll('a[data-page]')].filter((a) => !a.hidden).map((a) => a.dataset.page).join(),
  all: document.querySelectorAll('a[data-page]').length,
  head: !!document.querySelector('[data-work-head]'), clock: !!document.querySelector('[data-workclock]'), pick: !!document.querySelector('[data-status-pick]'),
}));
ok('the Case row is Overview, Chat and Uploads with nothing medical swept in, thirteen tabs in all, and the folder opened on Overview', furniture.caseRow === 'overview,chat,files' && furniture.all === 13 && furniture.on === 'overview', JSON.stringify(furniture));
ok('no clock button in the masthead, no clock row and no Working on dropdown anywhere on the desk', !furniture.head && !furniture.clock && !furniture.pick, JSON.stringify(furniture));
await page.evaluate(() => document.querySelector('[data-group="read"]')?.click());
await page.waitForTimeout(400);
const deskRow = await page.evaluate(() => [...document.querySelectorAll('a[data-page]')].filter((a) => !a.hidden).map((a) => a.dataset.page).join());
ok('the Desk row is Read, Plays, Ask, Terms, Stats and Desk', deskRow === 'advisor,dx,advisor-chat,education,stats,desk', deskRow);
await show('case', 'overview');
const ov = await until(() => {
  const k = [...document.querySelectorAll('.fact-k')].map((x) => x.textContent.trim());
  const st = document.querySelector('[data-trade-standing]')?.textContent.trim();
  if (!st || /no reading yet/.test(st)) return null;
  return { k, st, next: document.querySelector('[data-trade-next]')?.textContent.trim(), note: document.querySelector('[data-self-note]')?.textContent.trim(), pause: document.querySelector('[data-trade-pause]')?.textContent.trim(), close: !!document.querySelector('[data-self-close]'), del: !!document.querySelector('[data-delete-case]') };
});
ok('the overview carries CASE, STANDING and NEXT READ, the desk\'s note, and Pause, close and Delete', !!ov && ov.k.join() === 'CASE,STANDING,NEXT READ' && /pts under 3% a day/.test(ov.st) && /MT$/.test(ov.next || '') && /trade log/.test(ov.note || '') && ov.pause === 'Pause the readings' && ov.close && ov.del, JSON.stringify(ov));
await page.click('[data-trade-pause]');
const paused = await until(() => (document.querySelector('[data-trade-pause]')?.textContent.trim() === 'Resume the readings' ? 'resumeable' : null), 10000);
const pausedNext = await until(() => (/^Paused$/.test(document.querySelector('[data-trade-next]')?.textContent.trim() || '') ? 'paused' : null), 10000);
ok('Pause posts the setting and paints Resume and Paused from the answer', paused === 'resumeable' && pausedNext === 'paused');
await page.click('[data-trade-pause]');
const resumed = await until(() => (document.querySelector('[data-trade-pause]')?.textContent.trim() === 'Pause the readings' ? 'paused-again' : null), 10000);
ok('Resume puts it back', resumed === 'paused-again');
await shot('02-overview');

console.log('\n--- C. the chat is the trade log ---');
await show('case', 'chat');
await settle(page, 800);
const chat = await page.evaluate(() => ({
  h3: (document.querySelector('.chat-head h3')?.textContent || '').trim(),
  ph: document.querySelector('[data-form] [data-input]')?.getAttribute('placeholder') || '',
  q: document.querySelectorAll('.msg.q').length,
  reply: !!document.querySelector('.msg.q .reply-btn'),
  makers: /Duty of care draft|full message/.test(document.body.textContent),
}));
ok('the heading is Trade log, the box asks for a trade and why, the reading\'s question sits in the log with a Reply, and no message maker', chat.h3 === 'Trade log' && /Log a trade and why/.test(chat.ph) && chat.q >= 1 && chat.reply && !chat.makers, JSON.stringify(chat));
const line = 'AAPL long 40 shares at 231.10, stop 230.40, target 233. Opening range break on volume. Out at 232.60, plus 60.';
await page.evaluate((t) => { const box = document.querySelector('[data-form] [data-input]'); box.value = t; box.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-form]')?.requestSubmit(); }, line);
const logged = await until((t) => { const m = [...document.querySelectorAll('.msg.me')].find((x) => (x.textContent || '').includes(t.slice(0, 30))); return m ? 'logged' : null; }, 12000, line);
ok('a trade typed into the box lands as his own line', logged === 'logged');
await shot('03-log');

console.log('\n--- D. the Read page: the desk\'s head, the next read, the sections ---');
await show('read', 'advisor');
const read = await until(() => {
  const h3 = document.querySelector('#advisor .advisor-head h3')?.textContent.trim();
  const sub = document.querySelector('#advisor [data-desk-sub]')?.textContent.trim();
  if (!sub) return null;
  return { h3, sub, pause: document.querySelector('#advisor [data-desk-pause]')?.textContent.trim(), update: document.querySelector('#advisor [data-refresh]')?.textContent.trim(), prep: !!document.querySelector('#advisor [data-prep]') };
});
ok('the head reads Trade desk with Pause beside Update, the line under it names the next read, and no Prepare a response', !!read && read.h3 === '📈 Trade desk' && /^Next read /.test(read.sub) && read.pause === 'Pause' && read.update === 'Update' && !read.prep, JSON.stringify(read));
const titles = [];
for (let i = 0; i < 12; i++) {
  const t = await page.evaluate(() => document.querySelector('#advisor .advisor-page-head h4')?.textContent.trim() || '');
  if (t) titles.push(t);
  const more = await page.evaluate(() => { const n = document.querySelector('#advisor [data-pg="1"]'); if (!n || n.disabled) return false; n.click(); return true; });
  if (!more) break;
  await page.waitForTimeout(250);
}
ok('the pages are the desk\'s sections, Your trades and Rules to hold among them, and none of the medical ones', titles.some((t) => /Your trades/.test(t)) && titles.some((t) => /Rules to hold/.test(t)) && titles.some((t) => /Setups/.test(t)) && !titles.some((t) => /Plain English|Ruled out|Causes/.test(t)), titles.join(' | '));
await shot('04-read');

console.log('\n--- E. the Plays page: cards, Took it, Close ---');
await show('read', 'dx');
const cards = await until(() => { const c = document.querySelectorAll('[data-page-id="dx"] .play-card, .play-card'); return c.length >= 2 ? c.length : null; });
const playsPage = await page.evaluate(() => ({
  tab: [...document.querySelectorAll('[data-page]')].find((t) => t.dataset.page === 'dx')?.textContent.trim() || '',
  chance: document.querySelector('.play-card .play-chance')?.textContent || '',
  rows: [...(document.querySelector('.play-card')?.querySelectorAll('dt') || [])].map((d) => d.textContent.trim()),
  disclaimer: /Ideas, not orders\. Every trade is your decision\./.test(document.body.textContent),
  medical: /Next treatments|confidence levels, not clinical/.test(document.body.textContent),
}));
ok('the tab is Plays, two cards with the chance as a range and the six setup rows, the disclaimer, and none of the medical lists', cards >= 2 && /Plays/.test(playsPage.tab) && /55 to 65% chance of profit/.test(playsPage.chance) && ['Current picture', 'Bull case', 'Bear case', 'Levels', 'Risk', 'What to watch next'].every((k) => playsPage.rows.includes(k)) && playsPage.disclaimer && !playsPage.medical, JSON.stringify({ tab: playsPage.tab, rows: playsPage.rows.length }));
await page.click('.play-card[data-play="p-demo-1"] [data-act="took"]');
const taken = await until(() => { const c = document.querySelector('.play-card[data-play="p-demo-1"]'); return c && /Taken/.test(c.textContent || '') && c.querySelector('[data-outcome]') ? 'taken' : null; }, 10000);
ok('Took it repaints the card taken with Closed at', taken === 'taken');
await page.fill('.play-card[data-play="p-demo-1"] [data-outcome]', '45');
await page.click('.play-card[data-play="p-demo-1"] [data-act="closed"]');
const closed = await until(() => { const c = document.querySelector('.play-card[data-play="p-demo-1"]'); return c && /Closed \+\$45\.00/.test(c.textContent || '') ? 'closed' : null; }, 10000);
ok('Close with +45 reads Closed +$45.00', closed === 'closed');
await shot('05-plays');

console.log('\n--- F. Ask with a screenshot: the file on the row, the answer, the balance it logged ---');
await show('read', 'advisor-chat');
await settle(page, 600);
const askHead = await page.evaluate(() => (document.querySelector('#advisor-chat h3')?.textContent || '').trim());
ok('the Ask page is the desk\'s', askHead === '📈 Ask the desk', askHead);
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
await page.setInputFiles('#advisor-chat [data-ask-file]', { name: 'portfolio-total.png', mimeType: 'image/png', buffer: png });
const chip = await until(() => { const c = document.querySelector('#advisor-chat [data-ask-chip]'); return c && !c.hidden && /portfolio-total\.png/.test(c.textContent) ? 'chip' : null; }, 5000);
ok('the 📷 shows the file by name before it is sent', chip === 'chip');
await page.fill('#advisor-chat [data-q]', 'Here is my portfolio total. Anything to do with the SPY position?');
await page.click('#advisor-chat [data-ask] button');
const rowFile = await until(() => { const q = [...document.querySelectorAll('#advisor-chat .advisor-q')].find((x) => /Here is my portfolio total/.test(x.textContent)); return q && /📎 portfolio-total\.png/.test(q.textContent) ? 'row' : null; }, 15000);
ok('the question row carries the file by name', rowFile === 'row');
const answered = await until(() => { const t = [...document.querySelectorAll('#advisor-chat .advisor-turn')].find((x) => /Here is my portfolio total/.test(x.textContent)); const a = t?.querySelector('.advisor-a')?.textContent || ''; return /Logged \$2,410\.00 as the balance for \d{4}-\d{2}-\d{2}\./.test(a) ? a : null; }, 30000);
ok('the answer lands on its own and ends with the Logged sentence', !!answered, (answered || '').slice(-60));
await shot('06-ask');

console.log('\n--- G. Stats: the screenshot\'s balance, a typed one over it, the chart and the line ---');
await show('read', 'stats');
const big = await until(() => (document.querySelector('.trade-big')?.textContent === '$2,410.00' ? 'shot' : null), 10000);
const shotRow = await page.evaluate(() => /📷 from a screenshot/.test(document.querySelector('[data-acct-list]')?.textContent || ''));
ok('the balance the screenshot logged is the current one and its row says where it came from', big === 'shot' && shotRow);
await page.fill('[data-acct-form] input[name="dollars"]', '2450');
await page.fill('[data-acct-form] input[name="note"]', 'after close');
await page.click('[data-acct-form] button[type="submit"]');
const typedBig = await until(() => (document.querySelector('.trade-big')?.textContent === '$2,450.00' ? 'typed' : null), 10000);
const typedRow = await page.evaluate(() => { const t = document.querySelector('[data-acct-list]')?.textContent || ''; return /\$2,450\.00/.test(t) && /after close/.test(t) && !/📷 from a screenshot/.test(t.split('$2,450.00')[1]?.split('$')[0] || ''); });
ok('a balance he types for the same day wins over the screenshot and moves the big number', typedBig === 'typed' && typedRow);
const chart = await page.evaluate(() => { const s = document.querySelector('[data-stats] svg[role="img"]'); return s ? { lines: s.querySelectorAll('polyline').length, target: !!s.querySelector('polyline[stroke="var(--target)"]'), dots: s.querySelectorAll('circle').length, sentence: document.querySelector('[data-stats] p strong')?.textContent || '' } : null; });
ok('one SVG with two polylines, the target in its token, a dot per entry, and the sentence against the 3% a day line', !!chart && chart.lines === 2 && chart.target && chart.dots >= 6 && /(below|above) the 3% a day line/.test(chart.sentence), JSON.stringify(chart));
await shot('07-stats');

console.log('\n--- H. Desk: the key tail, the start, a switch that waits for the answer ---');
await show('read', 'desk');
const keySaid = await until(() => { const t = document.querySelector('[data-key-said]')?.textContent || ''; return /Key on file, ends in 1234/.test(t) ? t : null; });
ok('the key row says it is on file and ends in 1234, never the key', !!keySaid && !/demo-finnhub-key/.test(await page.evaluate(() => document.body.textContent)), keySaid || '');
const startVal = await page.evaluate(() => document.querySelector('[data-start-dollars]')?.value || '');
ok('the starting amount paints from the server', startVal === '2000', startVal);
await page.fill('[data-start-dollars]', '2500');
await page.click('[data-start-save]');
const startSaved = await until(() => (document.querySelector('[data-set-said]')?.textContent === 'Saved.' ? 'saved' : null), 10000);
await show('read', 'stats');
const legend = await until(() => { const t = document.querySelector('.trade-legend')?.textContent || ''; return /from \$2,500\.00/.test(t) ? t : null; }, 10000);
ok('a changed starting amount moves the target line', startSaved === 'saved' && !!legend, legend || '');
await show('read', 'desk');
const wasOn = await until(() => document.querySelector('[data-sw="scansOn"]')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('[data-sw="scansOn"]').disabled ? 'on' : null, 10000);
await page.click('[data-sw="scansOn"]');
const flipped = await until(() => (document.querySelector('[data-sw="scansOn"]')?.getAttribute('aria-pressed') === 'false' ? 'off' : null), 10000);
ok('the readings switch paints off only once the server has answered', wasOn === 'on' && flipped === 'off');
await show('read', 'advisor');
const pausedSub = await until(() => (/^Paused\./.test(document.querySelector('#advisor [data-desk-sub]')?.textContent || '') && document.querySelector('#advisor [data-desk-pause]')?.textContent.trim() === 'Resume' ? 'paused' : null), 12000);
ok('the Read page then says Paused and offers Resume', pausedSub === 'paused');
await shot('08-desk');

console.log('\n--- I. Terms: the trading half here, and not on a medical case ---');
await show('read', 'education');
const terms = await until(() => { const t = document.querySelector('[data-page-id="education"], #education, .folder-page')?.textContent || document.body.textContent; return /VWAP/.test(t) && /Opening range/.test(t) ? 'terms' : null; }, 10000);
ok('the desk\'s Terms page carries VWAP and Opening range', terms === 'terms');
await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await settle(page, 2000);
const medFurniture = await page.evaluate(() => ({
  head: !!document.querySelector('[data-work-head]'), clock: !!document.querySelector('[data-workclock]'), pick: !!document.querySelector('[data-status-pick]'),
  all: document.querySelectorAll('a[data-page]').length,
}));
// Eighteen on the demo's medical case: no Appeals without Full-Service, and Stats and Desk are the desk's own.
ok('a medical case keeps its clock button, its clock row, its Working on dropdown and every one of its pages', medFurniture.head && medFurniture.clock && medFurniture.pick && medFurniture.all === 18, JSON.stringify(medFurniture));
await show('read', 'education');
const medTerms = await until(() => { const t = document.body.textContent; return /Ferritin|Serology/.test(t) ? (/VWAP/.test(t) ? 'leak' : 'clean') : null; }, 10000);
ok('a medical case\'s Terms page carries its own terms and not the desk\'s', medTerms === 'clean', medTerms || '');

console.log('\n--- J. Delete, the door back on the shelf, a new desk from it ---');
await page.goto(`${P}/admin-case.html?id=demo-case-trade&demo=admin`, { waitUntil: 'networkidle' });
await settle(page, 2000);
await show('case', 'overview');
await page.click('[data-delete-case]');
await page.waitForURL(/admin(\.html)?(\?|$)/, { timeout: 15000 });
await settle(page, 1500);
const after = await until(() => ({ door: !!document.querySelector('[data-open-trade]'), section: [...document.querySelectorAll('h2')].some((h) => /TRADE DESK/.test(h.textContent)), card: !!document.querySelector('.folder.trade') }));
ok('after Delete the shelf shows the green door and no desk', !!after && after.door && !after.section && !after.card, JSON.stringify(after));
const doorColor = await green('[data-open-trade]');
ok('and the door is the green', !!doorColor && doorColor.got === hex2rgb(doorColor.want), doorColor ? `${doorColor.got} vs ${doorColor.want}` : '');
await page.click('[data-open-trade]');
await page.waitForURL(/admin-case(\.html)?\?id=demo-case-trade/, { timeout: 15000 });
await settle(page, 2000);
const fresh = await page.evaluate(() => ({ pill: (document.querySelector('[data-status]')?.textContent || '').trim(), cls: document.querySelector('.case-head')?.className || '' }));
ok('the door opens a new desk and walks into it', fresh.pill === 'TRADE DESK' && /\btrade\b/.test(fresh.cls), JSON.stringify(fresh));
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(page);
const again = await until(() => ({ door: !!document.querySelector('[data-open-trade]'), card: !!document.querySelector('.folder.trade'), meta: document.querySelector('.folder.trade .folder-meta')?.textContent.trim() }));
ok('the shelf shows the new desk and no door, with no reading yet on its line', !!again && again.card && !again.door && /no reading yet/.test(again.meta || ''), JSON.stringify(again));
await shot('09-shelf-after');

ok('no page errors', errs.length === 0, errs.join(' | ').slice(0, 200));
await b.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
