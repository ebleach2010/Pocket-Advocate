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
ok('the card is named, badged TRADE DESK and carries its standing under its cover', !!shelf && shelf.name === 'Trade desk' && shelf.pill === 'TRADE DESK' && /pts under 2% a day/.test(shelf.meta || '') && /stops go missing/.test(shelf.dx || ''), `${shelf?.meta} | ${shelf?.dx}`);
const outline = await green('.folder.trade', 'outlineColor');
// The desk is self AND trade, so the card carries both classes; the green is
// declared after the purple and is what paints.
const purpleWant = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--self').trim());
ok('and it wears the green, not the purple', !!outline && outline.got === hex2rgb(outline.want) && outline.got !== hex2rgb(purpleWant), outline ? `${outline.got} vs ${outline.want}` : '');
await shot('01-shelf');

console.log('\n--- B. the case: the masthead, the groups, the overview and its Scan ---');
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
ok('three groups, no Act and no Track', head.groups.join() === 'case,read,mine', head.groups.join(','));
// ERIC, 2026-09-22, the screenshot: every medical page swept into the Case row, the Appeal form
// on top, the clock in the masthead. The desk gets its own furniture and nothing else.
const furniture = await page.evaluate(() => ({
  on: document.querySelector('a[data-page].on')?.dataset.page || '',
  caseRow: [...document.querySelectorAll('a[data-page]')].filter((a) => !a.hidden).map((a) => a.dataset.page).join(),
  all: document.querySelectorAll('a[data-page]').length,
  head: !!document.querySelector('[data-work-head]'), clock: !!document.querySelector('[data-workclock]'), pick: !!document.querySelector('[data-status-pick]'),
}));
ok('the Case row is Overview, Chat and Uploads with nothing medical swept in, fourteen tabs in all, and the folder opened on Overview', furniture.caseRow === 'overview,chat,files' && furniture.all === 14 && furniture.on === 'overview', JSON.stringify(furniture));
ok('no clock button in the masthead, no clock row and no Working on dropdown anywhere on the desk', !furniture.head && !furniture.clock && !furniture.pick, JSON.stringify(furniture));
await page.evaluate(() => document.querySelector('[data-group="read"]')?.click());
await page.waitForTimeout(400);
const deskRow = await page.evaluate(() => [...document.querySelectorAll('a[data-page]')].filter((a) => !a.hidden).map((a) => a.dataset.page).join());
ok('the Desk row is Read, Plays, Trades, Calc, Ask, Terms, Stats and Desk', deskRow === 'advisor,dx,trades,calc,advisor-chat,education,stats,desk', deskRow);
await show('case', 'overview');
const ov = await until(() => {
  const k = [...document.querySelectorAll('.fact-k')].map((x) => x.textContent.trim());
  const st = document.querySelector('[data-trade-standing]')?.textContent.trim();
  if (!st || /no reading yet/.test(st)) return null;
  return { k, st, next: document.querySelector('[data-trade-next]')?.textContent.trim(), note: document.querySelector('[data-self-note]')?.textContent.trim(), today: document.querySelector('[data-trade-today]')?.textContent.trim(), scan: document.querySelector('[data-trade-scan]')?.textContent.trim(), close: !!document.querySelector('[data-self-close]'), del: !!document.querySelector('[data-delete-case]') };
});
// NOTHING RUNS BUT HIS TAP (Eric, 2026-09-22): "I manually update either scan individually. No
// automatic." No next read to announce, no Pause to offer: the fact says when the last scan ran.
ok('the overview carries CASE, STANDING, LAST SCAN and a TODAY that already says where the day stands against his rules, the desk\'s note, and Scan, close and Delete', !!ov && ov.k.join() === 'CASE,STANDING,LAST SCAN,TODAY' && /pts under 2% a day/.test(ov.st) && /^Realized \$0\.00, under the floor\. Aim is \$47\.60\./.test(ov.today || '') && /2 setups$/.test(ov.next || '') && /trade log/.test(ov.note || '') && ov.scan === 'Scan for new entries' && ov.close && ov.del, JSON.stringify(ov));
ok('and the desk\'s note says nothing runs on a clock', /Nothing runs on a clock: Scan looks for new entries, Update reads the whole desk, and both wait for your tap\./.test(ov?.note || ''), (ov?.note || '').slice(0, 80));
await shot('02-overview');

console.log('\n--- C. the chat is the trade log ---');
await show('case', 'chat');
await settle(page, 800);
const chat = await page.evaluate(() => ({
  h3: (document.querySelector('.chat-head h3')?.textContent || '').trim(),
  ph: document.querySelector('[data-form] [data-input]')?.getAttribute('placeholder') || '',
  q: document.querySelectorAll('.msg.q').length,
  reply: !!document.querySelector('.msg.q .reply-btn'),
  aim: /Where I want this going: 3% a day on the account/.test(document.body.textContent),
  makers: /Duty of care draft|full message/.test(document.body.textContent),
}));
// NOBODY WRITES IN HIS LOG BUT HIM (Eric, 2026-09-22): "Questions in the chat are unnecessary. The
// chat is just for me to dump information." Not one question row, not one Reply, and his own line of
// direction sits in it.
ok('the heading is Trade log, the box asks for a trade and why, not one question row and no Reply, his line of direction is in the log, and no message maker', chat.h3 === 'Trade log' && /Log a trade and why, or what you want the desk aiming at/.test(chat.ph) && chat.q === 0 && !chat.reply && chat.aim && !chat.makers, JSON.stringify(chat));
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
  return { h3, sub, scan: document.querySelector('#advisor [data-desk-scan]')?.textContent.trim(), update: document.querySelector('#advisor [data-refresh]')?.textContent.trim(), prep: !!document.querySelector('#advisor [data-prep]') };
});
ok('the head reads Trade desk with Scan beside Update, the line under it says nothing runs but his tap and when the last scan was, and no Prepare a response', !!read && read.h3 === '📈 Trade desk' && /^Nothing runs but your tap\. Scan looks for new entries; Update reads the whole desk\. Last scan .*, 2 setups filed\./.test(read.sub) && read.scan === 'Scan' && read.update === 'Update' && !read.prep, JSON.stringify(read));
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
// THE DESK MAKES A PDF (Eric, 2026-09-22: "generate PDFs just like LLM in a chat"): asked for a document,
// the answer lands with a link to real PDF bytes, and the Uploads page lists the file without a reload.
await page.fill('#advisor-chat [data-q]', 'Make me a one page PDF of my rules to hold');
await page.click('#advisor-chat [data-ask] button');
const docRow = await until(() => {
  const t = [...document.querySelectorAll('#advisor-chat .advisor-turn')].find((x) => /one page PDF of my rules/.test(x.textContent));
  const a = t?.querySelector('.ask-doc a');
  return a ? { text: a.textContent.trim(), href: a.getAttribute('href') || '', answer: t.querySelector('.advisor-a')?.textContent || '' } : null;
}, 30000);
ok('the answer lands with a 📄 link named for the document and says it was filed on Uploads', !!docRow && docRow.text === '📄 Rules to hold.pdf' && /^data:application\/pdf;base64,/.test(docRow.href) && /Filed as Rules to hold\.pdf on Uploads\./.test(docRow.answer), JSON.stringify(docRow && { text: docRow.text, href: docRow.href.slice(0, 30) }));
const magic = docRow ? await page.evaluate(async (href) => {
  const b = new Uint8Array(await (await fetch(href)).arrayBuffer());
  return { head: String.fromCharCode(...b.subarray(0, 8)), size: b.length, tail: String.fromCharCode(...b.subarray(b.length - 6)) };
}, docRow.href) : null;
ok('the link is real PDF bytes, %PDF-1.4 header to %%EOF trailer', !!magic && magic.head === '%PDF-1.4' && magic.tail === '%%EOF\n' && magic.size > 1000, JSON.stringify(magic));
await show('case', 'files');
const listed = await until(() => { const t = document.querySelector('[data-page-id="files"], #files')?.textContent || ''; return /Rules to hold\.pdf/.test(t) ? 'listed' : null; }, 15000);
ok('the Uploads page lists the file without a reload', listed === 'listed');
await shot('06b-doc');

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
ok('one SVG with two polylines, the target in its token, a dot per entry, and the sentence against the 2% a day line', !!chart && chart.lines === 2 && chart.target && chart.dots >= 6 && /(below|above) the 2% a day line/.test(chart.sentence), JSON.stringify(chart));
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
// The Readings switch went with the clock (2026-09-22): what is left is the push, and it still
// paints from the server's answer rather than from its own tap.
const wasOn = await until(() => document.querySelector('[data-sw="pushOn"]')?.getAttribute('aria-pressed') === 'true' && !document.querySelector('[data-sw="pushOn"]').disabled ? 'on' : null, 10000);
await page.click('[data-sw="pushOn"]');
const flipped = await until(() => (document.querySelector('[data-sw="pushOn"]')?.getAttribute('aria-pressed') === 'false' ? 'off' : null), 10000);
const noReadings = await page.evaluate(() => !document.querySelector('[data-sw="scansOn"]') && !/Readings/.test(document.body.textContent));
ok('the push switch paints off only once the server has answered, and there is no Readings switch left to pause', wasOn === 'on' && flipped === 'off' && noReadings);
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

console.log('\n--- K. Trades: the day, his cards, a trade entered, priced, sized and sold ---');
// THE CALCULATOR (Eric, 2026-09-22): "I just update the total in my portfolio nightly and input any
// active trades. Once I sell, I can log it and leave a note if I want otherwise it disappears."
// The account is the $2,450.00 he typed in G, so his 1% is $24.50 and every figure below comes off it.
await page.goto(`${P}/admin-case.html?id=demo-case-trade&demo=admin`, { waitUntil: 'networkidle' });
await settle(page, 2000);
await show('case', 'chat');
await page.waitForTimeout(500);
await show('read', 'trades');
const strip = await until(() => {
  const el = document.querySelector('[data-day-strip]');
  if (!el) return null;
  return { realized: el.querySelector('[data-day-realized]')?.textContent || '', state: el.querySelector('[data-day-state]')?.textContent || '', foot: el.lastElementChild?.textContent || '' };
}, 15000);
ok('the day opens at nothing realized and under the floor, with his four lines in dollars off the account', !!strip && strip.realized === '$0.00' && /^Realized \$0\.00, under the floor\. Aim is \$49\.00\./.test(strip.state) && /Floor \$24\.50 · Aim \$49\.00 · Stop at -\$73\.50 or \$245\.00/.test(strip.foot), JSON.stringify(strip));
const mine = await until(() => {
  const c = [...document.querySelectorAll('[data-pos-list] [data-pos]')];
  if (c.length < 2) return null;
  const row = (card, k) => { const d = [...card.querySelectorAll('dt')].find((x) => x.textContent.trim() === k); return d?.nextElementSibling?.textContent.trim() || ''; };
  return c.map((x) => ({ ticker: x.querySelector('.play-ticker')?.textContent.trim(), kind: x.querySelector('.pos-badge')?.textContent.trim(), risk: row(x, 'Risk'), ladder: row(x, 'Ladder') }));
}, 15000);
ok('his two open trades stand in kind order, the intraday NVDA over the swing SPY, each badged for its kind', !!mine && mine.length === 2 && mine[0].ticker === 'NVDA' && mine[0].kind === 'Intraday' && mine[1].ticker === 'SPY' && mine[1].kind === 'Swing', JSON.stringify(mine?.map((m) => `${m.ticker}/${m.kind}`)));
ok('NVDA carries its risk against his rule and the R ladder around the entry', !!mine && mine[0].risk === '$15.00 (0.61%), your rule allows $24.50' && mine[0].ladder === 'stop 646.9 · breakeven 648.4 · 1R 649.9 · 2R 651.4 · 3R 652.9', JSON.stringify(mine && mine[0]));
await shot('10-trades');

await page.evaluate(() => { document.querySelector('[data-pos-new]').open = true; });
await page.fill('[data-pos-form] [name="ticker"]', 'AAPL');
await page.click('[data-quote-btn]');
const priced = await until(() => { const t = document.querySelector('[data-quote-said]')?.textContent || ''; return /AAPL/.test(t) ? t : null; }, 15000);
ok('Get the price fetches the live quote and prints the last with today\'s range', priced === 'AAPL 232.6, today 230.6 to 233.2.', priced || '');
await page.fill('[data-pos-form] [name="qty"]', '40');
await page.fill('[data-pos-form] [name="entry"]', '231.10');
await page.fill('[data-pos-form] [name="stop"]', '230.40');
await page.fill('[data-pos-form] [name="target"]', '233');
const prev = await until(() => { const t = document.querySelector('[data-pos-preview]')?.textContent || ''; return /Risk \$28\.00/.test(t) ? t : null; }, 10000);
// 40 shares, seventy cents to the stop: $28.00, over the $24.50 his rule allows, which is why it
// says so and why the size it would have taken is 35.
ok('the preview does the arithmetic as he types: the risk, the rule, the size it would take and the ladder', !!prev && /Risk \$28\.00 \(1\.14%\), your rule allows \$24\.50\./.test(prev) && /sizes this at 35 shares/.test(prev) && /Breakeven 231\.1 · 1R 231\.8 · 2R 232\.5 · 3R 233\.2/.test(prev) && /target 233 is 2\.71R/.test(prev) && /Risk is over your rule for one trade\./.test(prev), (prev || '').slice(0, 180));
await page.click('[data-pos-form] button[type="submit"]');
const aapl = await until(() => {
  const card = [...document.querySelectorAll('[data-pos-list] [data-pos]')].find((x) => x.querySelector('.play-ticker')?.textContent.trim() === 'AAPL');
  if (!card) return null;
  const row = (k) => { const d = [...card.querySelectorAll('dt')].find((x) => x.textContent.trim() === k); return d?.nextElementSibling?.textContent.trim() || ''; };
  const last = row('Last');
  if (!last) return null;
  return { id: card.dataset.pos, first: card === document.querySelector('[data-pos-list] [data-pos]'), risk: row('Risk'), ladder: row('Ladder'), last, today: row('Today'), count: document.querySelectorAll('[data-pos-list] [data-pos]').length };
}, 20000);
ok('the saved trade takes the top card with its risk, its ladder, the live price and what it is up', !!aapl && aapl.first && aapl.count === 3 && aapl.risk === '$28.00 (1.14%), your rule allows $24.50' && aapl.ladder === 'stop 230.4 · breakeven 231.1 · 1R 231.8 · 2R 232.5 · 3R 233.2' && aapl.last === '232.6 · up $60.00' && aapl.today === '230.6 to 233.2', JSON.stringify(aapl));
await shot('11-trade-entered');

await page.click(`[data-pos="${aapl.id}"] [data-act="sold"]`);
await page.fill(`[data-pos="${aapl.id}"] [data-exit]`, '232.60');
await page.fill(`[data-pos="${aapl.id}"] [data-close-note]`, 'Took the whole thing at the target.');
await page.click(`[data-pos="${aapl.id}"] [data-act="close"]`);
const sold = await until((id) => {
  if (document.querySelector(`[data-pos-list] [data-pos="${id}"]`)) return null;
  const cl = document.querySelector('[data-closed-list]')?.textContent || '';
  if (!/AAPL/.test(cl)) return null;
  const el = document.querySelector('[data-day-strip]');
  return { closed: cl.trim(), realized: el?.querySelector('[data-day-realized]')?.textContent || '', state: el?.querySelector('[data-day-state]')?.textContent || '', good: el?.classList.contains('good') === true, open: document.querySelectorAll('[data-pos-list] [data-pos]').length };
}, 20000, aapl.id);
ok('Sold at 232.60 takes the card off the page, lands it under Closed today at +$60.00 and moves the day to the aim', !!sold && sold.open === 2 && /AAPL long \+\$60\.00 Took the whole thing at the target\./.test(sold.closed) && sold.realized === '+$60.00' && /^Realized \+\$60\.00, at the aim\./.test(sold.state) && sold.good, JSON.stringify(sold));
await shot('12-sold');
await show('case', 'chat');
const logged2 = await until(() => { const m = [...document.querySelectorAll('.msg.me')].map((x) => x.textContent || ''); return m.some((t) => /AAPL long 40 shares at 231\.1, stop 230\.4\. Out at 232\.6, plus 60\.00\./.test(t)) ? 'logged' : null; }, 15000);
ok('and the ticked box wrote the sale into his log in his own words', logged2 === 'logged');
await show('case', 'overview');
const todayFact = await until(() => { const t = document.querySelector('[data-trade-today]')?.textContent.trim() || ''; return /Realized/.test(t) ? t : null; }, 10000);
ok('the overview\'s TODAY carries the same day without a reload', !!todayFact && /^Realized \+\$60\.00, at the aim\./.test(todayFact), todayFact || '');

console.log('\n--- L. Calc: his six rules in dollars, and a stop changed on a trade ---');
await show('read', 'calc');
const rules = await until(() => {
  const g = document.querySelector('[data-rules-grid]');
  if (!g || !g.querySelector('input')) return null;
  return {
    vals: [...g.querySelectorAll('input')].map((i) => `${i.name}=${i.value}`).join(','),
    risk: g.querySelector('[data-rule-dollars="riskPct"]')?.textContent || '',
    aim: g.querySelector('[data-rule-dollars="dayAimPct"]')?.textContent || '',
    cap: g.querySelector('[data-rule-dollars="dayCapPct"]')?.textContent || '',
    targetR: g.querySelector('[data-rule-dollars="targetR"]')?.textContent || '',
  };
}, 15000);
ok('the six rules read 1, 3, 1, 2, 10 and 2R, each with what it is worth on his account beside it', !!rules && rules.vals === 'riskPct=1,dayLossPct=3,dayFloorPct=1,dayAimPct=2,dayCapPct=10,targetR=2' && rules.risk === '$24.50' && rules.aim === '$49.00' && rules.cap === '$245.00' && rules.targetR === '', JSON.stringify(rules));
const nvda = await until(() => {
  const c = [...document.querySelectorAll('[data-calc-pos]')].find((x) => x.querySelector('.play-ticker')?.textContent.trim() === 'NVDA');
  return c ? { id: c.dataset.calcPos, risk: c.querySelector('[data-calc-risk]')?.textContent || '', line: c.querySelector('[data-calc-line]')?.textContent || '', stop: c.querySelector('[data-edit="stop"]')?.value || '' } : null;
}, 15000);
ok('every open trade sits here with its editable stop, target and quantity, and one sentence of arithmetic', !!nvda && nvda.stop === '646.9' && nvda.risk === '$15.00' && /^Risk \$15\.00 \(0\.61%\), your rule allows \$24\.50, which sizes at 16\. Target 652 is 2\.4R\.$/.test(nvda.line), JSON.stringify(nvda));
await page.fill(`[data-calc-pos="${nvda.id}"] [data-edit="stop"]`, '646.50');
await page.click(`[data-calc-pos="${nvda.id}"] [data-act="save"]`);
const saved = await until((id) => { const c = document.querySelector(`[data-calc-pos="${id}"]`); const s = c?.querySelector('[data-calc-said]')?.textContent || ''; return s === 'Saved.' ? { risk: c.querySelector('[data-calc-risk]')?.textContent || '', line: c.querySelector('[data-calc-line]')?.textContent || '' } : null; }, 15000, nvda.id);
ok('a wider stop saved here repaints the risk and the sentence from the answer', !!saved && saved.risk === '$19.00' && /^Risk \$19\.00 \(0\.78%\), your rule allows \$24\.50, which sizes at 12\. Target 652 is 1\.89R\.$/.test(saved.line), JSON.stringify(saved));
await shot('13-calc');
await show('read', 'trades');
const followed = await until(() => {
  const card = [...document.querySelectorAll('[data-pos-list] [data-pos]')].find((x) => x.querySelector('.play-ticker')?.textContent.trim() === 'NVDA');
  if (!card) return null;
  const row = (k) => { const d = [...card.querySelectorAll('dt')].find((x) => x.textContent.trim() === k); return d?.nextElementSibling?.textContent.trim() || ''; };
  return /646\.5/.test(row('Stop')) ? { stop: row('Stop'), risk: row('Risk'), ladder: row('Ladder') } : null;
}, 15000);
ok('and the Trades card follows it: the new stop, the new risk and a ladder measured from it', !!followed && /^646\.5 /.test(followed.stop) && followed.risk === '$19.00 (0.78%), your rule allows $24.50' && followed.ladder === 'stop 646.5 · breakeven 648.4 · 1R 650.3 · 2R 652.2 · 3R 654.1', JSON.stringify(followed));

console.log('\n--- M. Scan: his tap, the note it writes and the setups it files ---');
// NOTHING RUNS BUT HIS TAP (Eric, 2026-09-22): "I manually update either scan individually. No
// automatic." The demo lands a scan four seconds after the tap, which is the shape production has.
await show('read', 'dx');
await settle(page, 600);
const before = await until(() => {
  const bar = document.querySelector('.scan-bar');
  if (!bar) return null;
  return {
    btn: bar.querySelector('[data-scan-now]')?.textContent.trim(),
    said: bar.querySelector('[data-scan-said]')?.textContent.trim(),
    note: document.querySelector('.scan-note')?.textContent.trim() || '',
    open: [...document.querySelectorAll('.play-card')].filter((c) => !/Expired|Closed|Skipped/.test(c.textContent || '')).length,
  };
}, 15000);
ok('the Plays page opens with the last scan\'s note above the cards and a button to buy another', !!before && before.btn === 'Scan for new entries' && /^Last scan /.test(before.said || '') && /indexes opened into yesterday/i.test(before.note) && before.open >= 1, JSON.stringify({ btn: before?.btn, said: before?.said, open: before?.open }));
await page.click('[data-scan-now]');
const scanning = await until(() => {
  const b = document.querySelector('[data-scan-now]');
  return b && b.disabled && /Scanning/.test(b.textContent || '') ? document.querySelector('[data-scan-said]')?.textContent.trim() : null;
}, 10000);
ok('the tap disables the button at once and says a scan is in the air', scanning === 'Looking at the tape now. It lands on its own.', scanning || '');
const landed = await until(() => {
  const b = document.querySelector('[data-scan-now]');
  if (!b || b.disabled) return null;
  const cards = [...document.querySelectorAll('.play-card')];
  const qqq = cards.find((c) => /QQQ/.test(c.querySelector('.play-ticker')?.textContent || ''));
  return qqq ? { said: document.querySelector('[data-scan-said]')?.textContent.trim(), note: document.querySelector('.scan-note')?.textContent.trim() || '', expired: cards.filter((c) => /Expired/.test(c.textContent || '')).length } : null;
}, 25000);
ok('the scan lands on its own: a new note, the setup it filed, and the ones the last scan left expired', !!landed && /^Last scan /.test(landed.said || '') && /holding their opening ranges/i.test(landed.note) && landed.expired >= 1, JSON.stringify({ said: landed?.said, expired: landed?.expired }));
await shot('14-scan');
await show('read', 'advisor');
const headScan = await until(() => {
  const sub = document.querySelector('#advisor [data-desk-sub]')?.textContent || '';
  return /1 setup filed/.test(sub) ? sub : null;
}, 15000);
ok('the Read page\'s line follows the same scan without a reload', !!headScan && /^Nothing runs but your tap\./.test(headScan), (headScan || '').slice(0, 90));
await show('case', 'overview');
const factScan = await until(() => { const t = document.querySelector('[data-trade-next]')?.textContent.trim() || ''; return /1 setup$/.test(t) ? t : null; }, 15000);
ok('and the overview\'s LAST SCAN says when it ran and what it filed', !!factScan, factScan || '');

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
