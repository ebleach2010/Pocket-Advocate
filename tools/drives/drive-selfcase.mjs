// drive-selfcase.mjs - his own case, in a real browser at 390px, in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-selfcase.mjs
//
// Eric, 2026-09-03: "Open an admin case file highlighted purple. Same
// controls, only I enter data/information into the chat and there's NOONE on
// the other end." The suite proves the route and the guards; this proves the
// thumb's path: the purple button on the shelf, the case it opens, the
// purple masthead, the overview that says what this is, a note typed into
// the chat that lands as his own, the uploads page that asks for records and
// not categories, and the shelf afterwards with the case on its own row.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.env.PA_PORT || 9377;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
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
    const hit = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await pg.waitForTimeout(250); if (!hit) break;
  }
};
const purple = async (pg, sel) => pg.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const want = getComputedStyle(document.documentElement).getPropertyValue('--self').trim();
  const cs = getComputedStyle(el);
  return { want, color: cs.color, outline: cs.outlineColor, border: cs.borderColor };
}, sel);
const hex2rgb = (h) => { const n = parseInt(h.replace('#', ''), 16); return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`; };

console.log('\n--- A. the shelf, before ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
const before = await page.evaluate(() => ({
  button: !!document.querySelector('[data-self-open]'),
  text: (document.querySelector('[data-self-open]')?.textContent || '').trim(),
  shelf: [...document.querySelectorAll('h2')].some((h) => /MY OWN CASE/.test(h.textContent)),
  count: (document.body.textContent.match(/(\d+) cases?, every one backed/) || [])[1],
}));
ok('with no case of his own, the shelf offers the purple button', before.button && before.text === 'Open a case for myself' && !before.shelf, before.text);
const btnColor = await purple(page, '[data-self-open]');
ok('and the button is the purple', !!btnColor && btnColor.color === hex2rgb(btnColor.want), btnColor ? `${btnColor.color} vs ${btnColor.want}` : '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-shelf-button.png` });

console.log('\n--- B. opening it ---');
await page.click('[data-self-open]');
// The Worker canonicalises /admin-case.html to /admin-case on the way in.
await page.waitForURL(/admin-case(\.html)?\?id=/, { timeout: 15000 });
await settle(page, 2000);
const caseId = new URL(page.url()).searchParams.get('id');
ok('the button opens a case page', !!caseId, caseId);
const head = await page.evaluate(() => ({
  cls: document.querySelector('.case-head')?.className || '',
  pill: (document.querySelector('[data-status]')?.textContent || '').trim(),
  name: (document.querySelector('[data-client]')?.textContent || '').trim(),
  tabs: [...document.querySelectorAll('[data-group]')].map((t) => t.dataset.group),
}));
ok('the masthead says MY OWN CASE, in purple', /\bself\b/.test(head.cls) && head.pill === 'MY OWN CASE', `${head.pill} / ${head.cls}`);
const pillColor = await purple(page, '[data-status]');
ok('and the pill and the name wear the purple', !!pillColor && pillColor.color === hex2rgb(pillColor.want), pillColor ? `${pillColor.color} vs ${pillColor.want}` : '');
ok('same tabs as any case', ['case', 'read', 'track', 'mine', 'act'].every((g) => head.tabs.includes(g)), head.tabs.join(','));
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); });
await page.waitForTimeout(600);
const ov = await page.evaluate(() => ({
  note: (document.querySelector('[data-self-note]')?.textContent || '').trim(),
  who: [...document.querySelectorAll('.fact-k')].map((k) => k.textContent.trim()),
  noCall: ![...document.querySelectorAll('.fact-k')].some((k) => /^(CALL|PAID|REPORT|FOLLOW-UP)$/.test(k.textContent.trim())),
  close: !!document.querySelector('[data-self-close]'),
}));
ok('the overview says what this case is and carries no call, payment or report furniture', /Nobody is on the other end/.test(ov.note) && ov.noCall && ov.who.includes('WHO') && ov.close, ov.who.join(','));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-case-overview.png` });

console.log('\n--- C. the chat is his own notes ---');
await page.evaluate(() => { document.querySelector('[data-page="chat"]')?.click(); });
await settle(page, 800);
const composer = await page.evaluate(() => ({
  box: !!document.querySelector('textarea, [contenteditable="true"]'),
  makers: document.querySelectorAll('.composer-extra, [data-composer-button], .cmp-btn').length,
  duty: /Duty of care draft|full message/.test(document.body.textContent),
}));
ok('the composer is there and the two message makers are not', composer.box && !composer.duty, `makers ${composer.makers}`);
const note = 'Day 3 of the relapse: right hand tremor is back, slept 4 hours, no fever.';
// The composer's own box, by its handle: every pane is built at mount and
// merely hidden, so the first textarea on the page is somebody else's.
const typed = await page.evaluate((t) => {
  const box = document.querySelector('[data-form] [data-input]');
  if (!box) return false;
  box.value = t; box.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}, note);
ok('a note can be typed', typed);
// Submit the form the way the thumb does, then wait for the demo's
// invented latency and the repaint, polling rather than guessing a delay.
await page.evaluate(() => {
  const form = document.querySelector('[data-form]');
  if (form) form.requestSubmit();
});
let landed = { found: false, mine: false };
for (let i = 0; i < 16 && !landed.found; i++) {
  await page.waitForTimeout(500);
  landed = await page.evaluate((t) => {
    const m = [...document.querySelectorAll('.msg')].find((x) => x.textContent.includes(t));
    return { found: !!m, mine: !!m && m.classList.contains('me') };
  }, note);
}
ok('and it lands in the thread as his own', landed.found && landed.mine, JSON.stringify(landed));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-chat.png` });

console.log('\n--- D. uploads ask for records, not categories ---');
await page.evaluate(() => { document.querySelector('[data-page="files"]')?.click(); });
await settle(page, 800);
const up = await page.evaluate(() => ({
  picker: document.querySelector('#up-cat')?.closest('label')?.hidden,
  note: (document.querySelector('#up-cat-note')?.textContent || '').trim(),
  input: !!document.querySelector('#up-report'),
}));
ok('the category picker is folded away and the sentence says where records go', up.picker === true && /Your own records/.test(up.note) && up.input, up.note);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-uploads.png` });

console.log('\n--- E. the shelf, after ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(page);
const after = await page.evaluate((id) => {
  const heads = [...document.querySelectorAll('h2')];
  const shelf = heads.find((h) => /MY OWN CASE/.test(h.textContent));
  const clients = heads.find((h) => /CURRENT CLIENTS|BOOKED|FORMER CLIENTS/.test(h.textContent));
  const card = document.querySelector(`.folder[data-id="${id}"]`);
  return {
    shelf: !!shelf,
    // First of the shelves: above every client shelf, whatever sits above
    // the shelves themselves (the attention list, the day's calls).
    first: !!shelf && (!clients || heads.indexOf(shelf) < heads.indexOf(clients)),
    card: !!card, self: card?.classList.contains('self'),
    badge: (card?.querySelector('.status-pill')?.textContent || '').trim(),
    button: !!document.querySelector('[data-self-open]'),
    count: (document.body.textContent.match(/(\d+) cases?, every one backed/) || [])[1],
    inOtherShelf: [...document.querySelectorAll('h2')].filter((h) => !/MY OWN CASE/.test(h.textContent))
      .some((h) => h.nextElementSibling?.querySelector?.(`.folder[data-id="${id}"]`)),
  };
}, caseId);
ok('his case sits on its own shelf, first, purple, badged, and the button is gone',
  after.shelf && after.first && after.card && after.self && after.badge === 'MY OWN CASE' && !after.button && !after.inOtherShelf,
  JSON.stringify(after));
ok('the revenue line does not count it', after.count === before.count, `${before.count} -> ${after.count}`);
const cardColor = await purple(page, `.folder[data-id="${caseId}"]`);
ok('the folder wears the purple outline', !!cardColor && cardColor.outline === hex2rgb(cardColor.want), cardColor ? `${cardColor.outline} vs ${cardColor.want}` : '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-shelf-after.png` });

console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
