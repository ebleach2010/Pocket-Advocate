// drive-employer.mjs - employer mode, payroll, the temporary chat, a quiet
// look at a contractor's work, the two-column shelf and a contractor's own +,
// in a real browser on the demo personas.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-employer.mjs
//
// Eric, 2026-10-15: "Next to the big 'clients' on the all cases page, I (and
// only I) need a button to enter employer mode ... I should then be able to
// tap in to each client and see everything they see without them knowing
// I'm there ... send them a message as admin that appears as a temporary chat
// box at the top of their screen with a white background. I can close the
// chat at any time and it removes the chat completely and deletes all
// messages. I also need to be able to run payroll through this page ... I
// would also like to reorient the 'all cases' page so the files are in a
// 2xinfinity grid." And: "The + sign under all cases should only be there to
// schedule a case from any lead they themselves acquire."
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' (' + d + ')' : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' (' + d + ')' : ''}`)); };
const errs = [];
const tryStep = async (fn) => { try { return await fn(); } catch { return null; } };
async function side(role, width = 390) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${role}: ${String(e).slice(0, 300)}`));
  return page;
}
// A tap the way a thumb does it: the control brought to the middle of the
// screen first (the demo strip is fixed over the top), then pressed.
const tap = (page, sel) => tryStep(async () => {
  await page.waitForSelector(sel, { state: 'visible', timeout: 8000 });
  await page.evaluate((q) => document.querySelector(q)?.scrollIntoView({ block: 'center' }), sel);
  await page.click(sel, { timeout: 8000 });
});
const settle = async (page, ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Close|Maybe later|Later)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await page.waitForTimeout(250); if (!hit) break;
  }
};

console.log('\n--- A. his Clients page ---');
const adm = await side('admin');
await adm.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await adm.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await adm.reload({ waitUntil: 'networkidle' });
await settle(adm, 2500);
const head = await adm.evaluate(() => {
  const h1 = document.querySelector('.clients-head h1');
  const btn = document.querySelector('[data-employer]');
  const r1 = h1?.getBoundingClientRect(); const r2 = btn?.getBoundingClientRect();
  return { text: btn?.textContent.trim(), href: btn?.getAttribute('href'), sameRow: !!r1 && !!r2 && Math.abs((r1.top + r1.bottom) / 2 - (r2.top + r2.bottom) / 2) < 30,
    plus: [...document.querySelectorAll('#add-menu [role="menuitem"]')].map((x) => x.textContent.trim()) };
});
// NEGATIVE CONTROL (run 2026-10-15): mountEmployerDoor() taken out of his branch in admin.js made this read
//   FAIL  beside the big Clients sits his Employer mode, and his + keeps all four doors
ok('beside the big Clients sits his Employer mode, and his + keeps all four doors',
  /^Employer mode/.test(head.text || '') && head.href === '/admin-employer.html' && head.sameRow && head.plus.length === 4, JSON.stringify(head));
const grid = await adm.evaluate(() => {
  const d = [...document.querySelectorAll('.drawer')].find((x) => x.querySelectorAll('.folder').length >= 2);
  if (!d) return null;
  const [a, c] = [...d.querySelectorAll('.folder')].map((f) => f.getBoundingClientRect());
  const name = d.querySelector('.folder-name').getBoundingClientRect(); const clock = d.querySelector('.folder-clock')?.getBoundingClientRect();
  return { cols: getComputedStyle(d).gridTemplateColumns.split(' ').length, side: Math.abs(a.top - c.top) < 2 && c.left > a.right, clockClear: !clock || clock.top >= name.bottom };
});
if (SHOTS) await adm.screenshot({ path: `${SHOTS}/employer-1-shelf.png`, fullPage: false });
// NEGATIVE CONTROL (run 2026-10-15): the drawer's grid-template-columns taken out of admin.css made this read
//   FAIL  Clients is a grid of two: folders side by side, the clock clear of the name
ok('Clients is a grid of two: folders side by side, the clock clear of the name', !!grid && grid.cols === 2 && grid.side && grid.clockClear, JSON.stringify(grid));

console.log('\n--- B. employer mode ---');
await adm.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(adm, 2000);
const team = () => adm.evaluate(() => [...document.querySelectorAll('.tm-card')].map((c) => ({ name: c.querySelector('.tm-name')?.textContent.trim(), brief: c.querySelector('.tm-brief')?.textContent.trim(), money: c.querySelector('.tm-money strong')?.textContent.trim(), acts: [...c.querySelectorAll('.tm-acts a, .tm-acts button')].map((x) => x.textContent.trim()) })));
const before = await team();
await tryStep(() => adm.click('[data-sample="create"]', { timeout: 3000 }));
await adm.waitForTimeout(1500);
const after = await team();
const maya = after.find((t) => /Maya Torres/.test(t.name || ''));
if (SHOTS) await adm.screenshot({ path: `${SHOTS}/employer-2-team.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-15): teamSummary's kinds left out of the brief (brief() returning '') made this read
//   FAIL  his team: him first, each with their clients by kind and what they stand to earn; a sample contractor arrives with three clients, marked SAMPLE
ok('his team: him first, each with their clients by kind and what they stand to earn; a sample contractor arrives with three clients, marked SAMPLE',
  /YOU/.test(before[0]?.name || '') && before.some((t) => /Ana Rivera/.test(t.name) && /1 client: 1 Advocacy Case/.test(t.brief) && /\$\d/.test(t.money))
  && !!maya && /SAMPLE/.test(maya.name) && /^3 clients/.test(maya.brief) && maya.acts.includes('See what they see'),
  JSON.stringify({ before, maya }));

console.log('\n--- C. the temporary chat ---');
// The demo keeps each side's store in the browser, so his tab and theirs share
// one browser here, the way two tabs would; a second browser would never see
// what the first one wrote.
const ana = await adm.context().newPage();
ana.on('pageerror', (e) => errs.push(`advocate: ${String(e).slice(0, 300)}`));
await ana.goto(`${P}/admin.html?demo=advocate`, { waitUntil: 'networkidle' });
await settle(ana, 2500);
const fab = await ana.evaluate(() => { const f = document.querySelector('.sc-fab'); const r = f?.getBoundingClientRect(); return f ? { right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom) } : null; });
const anaCard = adm.locator('.tm-card', { hasText: 'Ana Rivera' });
await tryStep(() => anaCard.locator('[data-msg]').click({ timeout: 3000 }));
await adm.waitForTimeout(800);
await tryStep(() => adm.fill('dialog.sc-sheet [data-sc-input]', 'Quick check on Priya: did the echo report come in?', { timeout: 3000 }));
await tryStep(() => adm.click('dialog.sc-sheet .sc-form button[type="submit"]', { timeout: 3000 }));
await adm.waitForTimeout(800);
await ana.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await ana.waitForTimeout(1800);
const box = await ana.evaluate(() => {
  const x = document.querySelector('.sc-box');
  if (!x || x.hidden) return null;
  const r = x.getBoundingClientRect();
  return { top: Math.round(r.top), bg: getComputedStyle(x).backgroundColor, text: x.querySelector('.sc-log')?.textContent.trim() };
});
if (SHOTS) await ana.screenshot({ path: `${SHOTS}/employer-3-their-box.png` });
// NEGATIVE CONTROL (run 2026-10-15): the advocate poll no longer opening the box on a new message from him made this read
//   FAIL  his message appears at the top of their screen in a white box, and they have the chat icon at the bottom right
ok('his message appears at the top of their screen in a white box, and they have the chat icon at the bottom right',
  !!fab && fab.right <= 24 && fab.bottom <= 24 && !!box && box.top < 200 && box.bg === 'rgb(255, 255, 255)' && /echo report/.test(box.text || ''),
  JSON.stringify({ fab, box }));
await tryStep(() => ana.fill('.sc-box [data-sc-input]', 'Yes, it came in this morning.', { timeout: 3000 }));
await tryStep(() => ana.click('.sc-box .sc-form button[type="submit"]', { timeout: 3000 }));
await adm.waitForTimeout(9000);
const hisLog = await adm.evaluate(() => document.querySelector('dialog.sc-sheet .sc-log')?.textContent || '');
await tryStep(() => adm.click('dialog.sc-sheet [data-sc-all]', { timeout: 3000 }));
await adm.waitForTimeout(800);
await ana.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
await ana.waitForTimeout(1800);
const gone = await ana.evaluate(() => ({ box: !document.querySelector('.sc-box') || document.querySelector('.sc-box').hidden, left: JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith('pa-demo')) || 'null') || '{}') }));
const leftover = JSON.stringify(gone.left).includes('came in this morning');
// NEGATIVE CONTROL (run 2026-10-15): close clearing the counts instead of deleting the thread made this read
//   FAIL  their reply reaches him; when he closes the chat it leaves their screen and every message is deleted
ok('their reply reaches him; when he closes the chat it leaves their screen and every message is deleted',
  /came in this morning/.test(hisLog) && gone.box && !leftover, JSON.stringify({ hisLog: hisLog.slice(0, 120), box: gone.box, leftover }));

// Their tab polls the chat and writes the demo's store back each time; left
// open, a write of theirs can land over one of his from the other tab.
await ana.goto('about:blank');

console.log('\n--- D. a quiet look ---');
const sent = [];
adm.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url())) sent.push(`${r.method()} ${new URL(r.url()).pathname}`); });
await adm.goto(`${P}/admin.html?as=demo-advocate&demo=admin`, { waitUntil: 'networkidle' });
await settle(adm, 2500);
const shelf = await adm.evaluate(() => ({
  bar: document.querySelector('.quiet-bar')?.textContent.replace(/\s+/g, ' ').trim(),
  names: [...document.querySelectorAll('#list .folder-name')].map((e) => e.textContent.trim()),
  plus: !!document.querySelector('[data-add-open]'), clocks: document.querySelectorAll('.folder-clock').length,
  link: document.querySelector('#list a.folder')?.getAttribute('href') || '',
}));
await adm.goto(`${P}/admin-case.html?id=demo-case-ana&as=demo-advocate&demo=admin`, { waitUntil: 'networkidle' });
await settle(adm, 2500);
const before2 = sent.length;
await tryStep(() => adm.click('.folder-groups button:has-text("Mine")', { timeout: 3000 }));
await adm.waitForTimeout(600);
const paper = await adm.$('[contenteditable="true"]');
if (paper) { await tryStep(() => paper.click({ timeout: 2000 })); await adm.keyboard.type('should not land'); await adm.waitForTimeout(2600); }
await tryStep(() => adm.click('.folder-groups button:has-text("Case")', { timeout: 3000 }));
await tryStep(() => adm.click('.folder-tabs >> text=Chat', { timeout: 3000 }));
await adm.waitForTimeout(900);
const inCase = await adm.evaluate(() => ({
  bar: !!document.querySelector('.quiet-bar'), composer: !!document.querySelector('#chat .chat-form textarea'),
  mine: [...document.querySelectorAll('#chat .msg.me')].length, theirs: [...document.querySelectorAll('#chat .msg.them')].length,
}));
if (SHOTS) await adm.screenshot({ path: `${SHOTS}/employer-4-quiet-case.png` });
// NEGATIVE CONTROL (run 2026-10-15): the case chat's `disabled: c.status === 'closed' || !!asUid` made `c.status === 'closed'` in admin-case.js made this read
//   FAIL  See what they see: their shelf and their case as they have them, read only, with nothing written anywhere
ok('See what they see: their shelf and their case as they have them, read only, with nothing written anywhere',
  /They cannot tell you are here/.test(shelf.bar || '') && shelf.names.length === 1 && /Priya/.test(shelf.names[0]) && !shelf.plus && shelf.clocks === 0
  && /as=demo-advocate/.test(shelf.link) && inCase.bar && !inCase.composer && inCase.mine >= 1 && sent.length === before2,
  JSON.stringify({ shelf, inCase, sent: sent.slice(before2) }));

console.log('\n--- E. payroll ---');
await adm.goto(`${P}/admin-employer.html?demo=admin#payroll`, { waitUntil: 'networkidle' });
await settle(adm, 1500);
const presets = await adm.evaluate(() => {
  const f = document.getElementById('pr-form');
  const out = {};
  for (const p of ['week', 'twoweeks', 'month']) { f.querySelector(`input[value="${p}"]`).click(); out[p] = [f.start.value, f.end.value]; }
  return out;
});
const span = (s, e) => Math.round((new Date(e) - new Date(s)) / 86_400_000) + 1;
// NEGATIVE CONTROL (run 2026-10-15): presetRange's last week counting eight days made this read
//   FAIL  the periods: last week is seven days, Monday to Sunday; two weeks fourteen; last month the whole of it
ok('the periods: last week is seven days, Monday to Sunday; two weeks fourteen; last month the whole of it',
  span(...presets.week) === 7 && new Date(`${presets.week[0]}T12:00:00`).getDay() === 1 && span(...presets.twoweeks) === 14
  && presets.month[0].endsWith('-01') && span(...presets.month) >= 28, JSON.stringify(presets));
const from = new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10);
const to = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
await adm.evaluate(([s, e]) => { const f = document.getElementById('pr-form'); f.querySelector('input[value="custom"]').checked = true; f.start.value = s; f.end.value = e; }, [from, to]);
await tryStep(() => adm.click('#pr-form button[type="submit"]', { timeout: 3000 }));
await adm.waitForTimeout(1500);
const report = await adm.evaluate(() => {
  const heads = [...document.querySelectorAll('table.pr thead th')].map((t) => t.textContent.trim());
  const rows = [...document.querySelectorAll('table.pr tbody tr[data-row]')].map((r) => ({ uid: r.dataset.row, cells: [...r.children].map((c) => c.textContent.replace(/\s+/g, ' ').trim()) }));
  return { heads, rows, total: document.querySelector('table.pr tr.pr-total')?.textContent.replace(/\s+/g, ' ').trim() };
});
if (SHOTS) await adm.screenshot({ path: `${SHOTS}/employer-5-payroll.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-15): the report's Pay adjustments column taken out of showRun made this read
//   FAIL  Run report lays it out the Mangomint way: Cases, Client sales, Deductions, Commission, Tips, Pay adjustments, Total and how each is paid, a row for each person, him included, and a total
ok('Run report lays it out the Mangomint way: Cases, Client sales, Deductions, Commission, Tips, Pay adjustments, Total and how each is paid, a row for each person, him included, and a total',
  report.heads.join('|') === 'Staff|Cases|Client sales|Deductions|Commission|Tips|Pay adjustments|Total|Payout method'
  && report.rows.some((r) => r.uid === 'demo-admin') && report.rows.some((r) => r.uid === 'demo-advocate') && /^Total/.test(report.total || ''),
  JSON.stringify(report).slice(0, 400));
// The local Worker now and then holds a request for half a minute, so the
// correction waits for its sheet and is tried twice before it is judged.
let anaTotal = '';
for (let attempt = 0; attempt < 2 && anaTotal !== '$1,234.50'; attempt++) {
  await adm.evaluate(() => document.querySelector('[data-set="demo-advocate"]')?.scrollIntoView({ block: 'center' }));
  await tryStep(() => adm.click('[data-set="demo-advocate"]', { timeout: 10000 }));
  await tryStep(() => adm.waitForSelector('dialog.ask-sheet[open] [name="amount"]', { timeout: 10000 }));
  await tryStep(() => adm.fill('dialog.ask-sheet [name="amount"]', '1234.50', { timeout: 3000 }));
  await tryStep(() => adm.fill('dialog.ask-sheet [name="note"]', 'Agreed', { timeout: 3000 }));
  await tryStep(() => adm.click('dialog.ask-sheet button[value="ok"]', { timeout: 3000 }));
  await tryStep(() => adm.waitForFunction(() => document.querySelector('[data-set="demo-advocate"]')?.textContent.trim() === '$1,234.50', null, { timeout: 8000 }));
  anaTotal = await adm.evaluate(() => document.querySelector('[data-set="demo-advocate"]')?.textContent.trim());
}
// The demo strip is fixed over the top of the page, so the button is brought
// to the middle of the screen before it is tapped.
await adm.evaluate(() => document.querySelector('[data-dl]')?.scrollIntoView({ block: 'center' }));
const dl = adm.waitForEvent('download', { timeout: 10000 }).catch(() => null);
await tryStep(() => adm.click('[data-dl]', { timeout: 8000 }));
const file = await dl;
const csv = file ? readFileSync(await file.path(), 'utf8') : '';
// NEGATIVE CONTROL (run 2026-10-15): the correction sending `typed` instead of `typed - r.totalCents` made this read
//   FAIL  a tap on a total sets what they are owed, and the spreadsheet carries the summary, every line and every adjustment
ok('a tap on a total sets what they are owed, and the spreadsheet carries the summary, every line and every adjustment',
  anaTotal === '$1,234.50' && /^Payroll,/.test(csv) && /Staff,Share %,Cases,Client sales,Deductions,Commission,Tips,Pay adjustments,Total owed,Payout method/.test(csv)
  && /Correction/.test(csv) && /Agreed/.test(csv) && /Staff,Date,Client,Item,Amount,Their pay/.test(csv),
  JSON.stringify({ anaTotal, csv: csv.slice(0, 160) }));
adm.on('dialog', (d) => d.accept());
await tap(adm, '[data-confirm]');
await tap(adm, 'dialog.ask-sheet[open] button[value="ok"]');
await tryStep(() => adm.waitForSelector('[data-confirm]', { state: 'detached', timeout: 8000 }));
await adm.waitForTimeout(600);
await adm.evaluate(([s, e]) => { const f = document.getElementById('pr-form'); f.querySelector('input[value="custom"]').checked = true; f.start.value = s; f.end.value = e; }, [from, from]);
await tap(adm, '#pr-form button[type="submit"]');
await tryStep(() => adm.waitForSelector('[data-del]', { state: 'visible', timeout: 8000 }));
await tap(adm, '[data-del]');
await tap(adm, 'dialog.ask-sheet[open] button[value="ok"]');
await tryStep(() => adm.waitForSelector('[data-del]', { state: 'detached', timeout: 8000 }));
await tap(adm, '[data-emp-tab="history"]');
await adm.waitForTimeout(1200);
const hist = await adm.evaluate(() => ({ months: [...document.querySelectorAll('.pr-month')].map((m) => m.textContent.trim()), items: document.querySelectorAll('#pr-history .pr-item').length, drafts: document.querySelectorAll('#pr-drafts .pr-item').length }));
// NEGATIVE CONTROL (run 2026-10-15): confirm leaving the run a draft made this read
//   FAIL  Confirm moves it to Pay history under its month; a draft deletes and leaves nothing behind
ok('Confirm moves it to Pay history under its month; a draft deletes and leaves nothing behind',
  hist.months.length === 1 && hist.items === 1 && hist.drafts === 0, JSON.stringify(hist));

console.log('\n--- F. a contractor\'s own + and pay ---');
await ana.goto(`${P}/admin.html?demo=advocate`, { waitUntil: 'networkidle' });
await settle(ana, 2000);
const plus = await ana.evaluate(() => ({ btn: !!document.querySelector('[data-add-open]'), items: [...document.querySelectorAll('#add-menu [role="menuitem"]')].map((x) => x.textContent.trim()) }));
await tryStep(() => ana.click('[data-add-open]', { timeout: 3000 }));
await tryStep(() => ana.click('#add-menu [data-open-door="lead"]', { timeout: 3000 }));
await ana.waitForTimeout(800);
const day = new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);
await tryStep(() => ana.fill('[data-lf="email"]', 'sam.lead@example.demo', { timeout: 3000 }));
await tryStep(() => ana.fill('[data-lf="name"]', 'Sam Lead', { timeout: 3000 }));
await tryStep(() => ana.fill('[data-lf="date"]', day, { timeout: 3000 }));
await tryStep(() => ana.fill('[data-lf="time"]', '11:00', { timeout: 3000 }));
await tryStep(() => ana.click('[data-lead-go]', { timeout: 3000 }));
await ana.waitForTimeout(1800);
const theirList = await ana.evaluate(() => [...document.querySelectorAll('.inv-row strong')].map((x) => x.textContent.trim()));
// NEGATIVE CONTROL (run 2026-10-15): the advocate branch keeping every item of the + menu made this read
//   FAIL  a contractor's + holds one door, a case from a lead of their own, and what they send is listed as theirs
ok('a contractor\'s + holds one door, a case from a lead of their own, and what they send is listed as theirs',
  plus.btn && plus.items.join('|') === 'Schedule a case from a lead' && theirList.includes('Sam Lead'), JSON.stringify({ plus, theirList }));
await ana.goto(`${P}/admin-account.html?demo=advocate`, { waitUntil: 'networkidle' });
await settle(ana, 2000);
await tryStep(() => ana.selectOption('#payout-form select[name="method"]', 'zelle', { timeout: 3000 }));
await tryStep(() => ana.fill('#payout-form [name="f-name"]', 'Ana Rivera', { timeout: 3000 }));
await tryStep(() => ana.fill('#payout-form [name="f-handle"]', 'ana@example.demo', { timeout: 3000 }));
await tryStep(() => ana.click('#payout-form button[type="submit"]', { timeout: 3000 }));
await ana.waitForTimeout(1200);
const payNow = await ana.evaluate(() => document.querySelector('[data-payout-now]')?.textContent.trim());
await adm.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(adm, 1500);
// NEGATIVE CONTROL (run 2026-10-15): the account page's payout form taken out made this read
//   FAIL  they set how they get paid on My account and see it back masked
ok('they set how they get paid on My account and see it back masked', /^Now: Zelle, Zelle to an…mo\.$/.test(payNow || ''), payNow || '');

console.log('\n--- G. narrow screens ---');
const n1 = await side('admin', 320);
await n1.goto(`${P}/admin-employer.html?demo=admin#payroll`, { waitUntil: 'networkidle' });
await settle(n1, 1500);
await tryStep(() => n1.click('#pr-form button[type="submit"]', { timeout: 3000 }));
await n1.waitForTimeout(1500);
const narrow = await n1.evaluate(() => {
  const frame = document.querySelector('.pr-scroll');
  return {
    past: [...document.querySelectorAll('main *')].filter((e) => e.checkVisibility() && !e.closest('.pr-scroll') && e.getBoundingClientRect().right > innerWidth + 1).map((e) => e.tagName + '.' + e.className).slice(0, 4),
    // The table is wider than the phone, so it has to scroll inside its frame.
    framed: !!frame && /auto|scroll/.test(getComputedStyle(frame).overflowX) && frame.scrollWidth > frame.clientWidth && frame.getBoundingClientRect().right <= innerWidth + 1,
  };
});
// NEGATIVE CONTROL (run 2026-10-15): `.pr-scroll { overflow-x: auto }` made `visible` made this read
//   FAIL  at 320px nothing runs off the screen; the table scrolls inside its own frame
ok('at 320px nothing runs off the screen; the table scrolls inside its own frame', !narrow.past.length && narrow.framed, JSON.stringify(narrow));
// NEGATIVE CONTROL (run 2026-10-15): a `null.x` put at the top of admin-employer.js made this read
//   FAIL  no page threw
ok('no page threw', !errs.length, JSON.stringify(errs.slice(0, 3)));

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
