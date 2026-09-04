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
  button: !!document.querySelector('[data-open-door="self"]'),
  text: (document.querySelector('[data-open-door="self"]')?.textContent || '').trim(),
  family: !!document.querySelector('[data-open-door="family"]'),
  formHidden: document.querySelector('[data-open-form="self"]')?.hidden,
  shelf: [...document.querySelectorAll('h2')].some((h) => /MY OWN CASE/.test(h.textContent)),
  count: (document.body.textContent.match(/(\d+) cases?, every one backed/) || [])[1],
}));
ok('with no case of his own, the shelf offers the two purple doors, forms folded', before.button && before.text === 'Open a case for myself' && before.family && before.formHidden === true && !before.shelf, before.text);
const btnColor = await purple(page, '[data-open-door="self"]');
ok('and the button is the purple', !!btnColor && btnColor.color === hex2rgb(btnColor.want), btnColor ? `${btnColor.color} vs ${btnColor.want}` : '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-shelf-button.png` });

console.log('\n--- B. opening it, with his own details ---');
await page.click('[data-open-door="self"]');
await page.waitForTimeout(300);
ok('the door unfolds the form', await page.evaluate(() => document.querySelector('[data-open-form="self"]')?.hidden === false));
await page.fill('[data-of="self:firstName"]', 'Eric');
await page.fill('[data-of="self:lastName"]', 'Bleach');
await page.fill('[data-of="self:dob"]', '1985-02-03');
await page.fill('[data-of="self:phone"]', '+1 208 555 0100');
await page.fill('[data-of="self:address"]', '12 Elm St, Boise, ID 83702');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01b-self-form.png` });
await page.click('[data-open-go="self"]');
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
  whoText: (() => { const k = [...document.querySelectorAll('.fact-k')].find((x) => x.textContent.trim() === 'WHO'); return (k?.nextElementSibling?.textContent || '').replace(/\s+/g, ' ').trim(); })(),
  tel: document.querySelector('a[data-contact-phone]')?.getAttribute('href') || '',
  noCall: ![...document.querySelectorAll('.fact-k')].some((k) => /^(CALL|PAID|REPORT|FOLLOW-UP)$/.test(k.textContent.trim())),
  close: !!document.querySelector('[data-self-close]'),
}));
ok('the overview says what this case is and carries no call, payment or report furniture', /Nobody is on the other end/.test(ov.note) && ov.noCall && ov.who.includes('WHO') && ov.close, ov.who.join(','));
ok('and it carries the details he typed', /Eric Bleach/.test(ov.whoText) && /1985-02-03/.test(ov.whoText) && ov.tel === 'tel:+12085550100', `${ov.whoText} | ${ov.tel}`);
// The Edit beside the name: a case opened under the wrong name (his was
// "Gg Gg", off a test profile) is corrected in place.
await page.click('[data-self-edit]');
await page.waitForTimeout(300);
await page.fill('[data-self-in="name"]', 'Eric J. Bleach');
await page.click('[data-self-save]');
await settle(page, 2500);
const renamed = await page.evaluate(() => ({
  head: (document.querySelector('[data-client]')?.textContent || '').trim(),
  who: (() => { const k = [...document.querySelectorAll('.fact-k')].find((x) => x.textContent.trim() === 'WHO'); return (k?.nextElementSibling?.textContent || '').replace(/\s+/g, ' ').trim(); })(),
}));
ok('Edit beside the name corrects it in place, masthead and card alike', renamed.head === 'Eric J. Bleach' && /Eric J\. Bleach/.test(renamed.who), `${renamed.head} | ${renamed.who.slice(0, 40)}`);
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
// The read's questions come to the chat (Eric, 2026-09-03: "If it has
// questions it wants answered it can ask in the chat. I can press reply to
// that question to answer it."). Update on the Read page runs the demo's
// read, which seeds two question rows; Reply on one puts the strip over the
// box; Send carries the answer through the reply route, and it comes back
// on his side with the question quoted above it.
await page.evaluate(() => { document.querySelector('[data-group="read"]')?.click(); document.querySelector('[data-page="advisor"]')?.click(); });
await page.waitForTimeout(500);
const refreshBtn = await page.$('[data-refresh]');
ok('the Read page has its Update', !!refreshBtn);
if (refreshBtn) await refreshBtn.click();
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="chat"]')?.click(); });
let qRows = 0;
for (let i = 0; i < 24 && qRows < 2; i++) {
  await page.waitForTimeout(500);
  qRows = await page.evaluate(() => document.querySelectorAll('.msg.q').length);
}
const qShape = await page.evaluate(() => {
  const q = document.querySelector('.msg.q');
  return q ? {
    them: q.classList.contains('them'),
    reply: !!q.querySelector('.reply-btn'),
    text: (q.querySelector('.msg-text')?.textContent || '').trim(),
    placeholder: document.querySelector('[data-form] [data-input]')?.getAttribute('placeholder') || '',
  } : null;
});
ok('two questions arrive in the chat as bubbles on the other side, each with a Reply', qRows === 2 && !!qShape && qShape.them && qShape.reply && /\?$/.test(qShape.text), JSON.stringify(qShape));
ok('and the box says it takes notes and answers', /answer a question/.test(qShape?.placeholder || ''), qShape?.placeholder);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03b-questions.png` });
await page.click('.msg.q .reply-btn');
await page.waitForTimeout(300);
const strip = await page.evaluate(() => {
  const s = document.querySelector('[data-reply-strip]');
  return { shown: !!s && !s.hidden, text: (s?.textContent || '').replace(/\s+/g, ' ').trim() };
});
ok('Reply puts the question over the box', strip.shown && /^Answering: /.test(strip.text), strip.text.slice(0, 80));
const answer = 'About 6am, right hand only, worse after the stairs.';
await page.evaluate((t) => {
  const box = document.querySelector('[data-form] [data-input]');
  box.value = t; box.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-form]')?.requestSubmit();
}, answer);
let answered = null;
for (let i = 0; i < 16 && !answered; i++) {
  await page.waitForTimeout(500);
  answered = await page.evaluate((t) => {
    const m = [...document.querySelectorAll('.msg.me')].find((x) => (x.querySelector('.msg-text')?.textContent || '').includes(t));
    if (!m) return null;
    return { quote: (m.querySelector('.msg-quote')?.textContent || '').trim(), stripHidden: !!document.querySelector('[data-reply-strip]')?.hidden };
  }, answer);
}
ok('the answer lands on his side with the question quoted above it, and the strip clears', !!answered && /\?$/.test(answered.quote) && answered.stripHidden, JSON.stringify(answered));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03c-answered.png` });
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

console.log('\n--- F. a family case ---');
ok('the own-case door is gone and the family door stays', await page.evaluate(() => !document.querySelector('[data-open-door="self"]') && !!document.querySelector('[data-open-door="family"]')));
await page.click('[data-open-door="family"]');
await page.waitForTimeout(300);
await page.fill('[data-of="family:firstName"]', 'Ann');
await page.fill('[data-of="family:lastName"]', 'Bleach');
// An address that already belongs to a client here is refused once, with a
// button to confirm it really is them (audit, 2026-09-03). The demo's client
// owns jordan@example.demo; typing it must not open a case straight away.
await page.fill('[data-of="family:email"]', 'jordan@example.demo');
await page.click('[data-open-go="family"]');
let refusal = { text: '', button: false };
for (let i = 0; i < 12 && !refusal.button; i++) {
  await page.waitForTimeout(400);
  refusal = await page.evaluate(() => {
    const said = document.querySelector('[data-open-said="family"]');
    return { text: (said?.textContent || '').trim(), button: !!said?.querySelector('[data-open-confirm]') };
  });
}
ok('an address that already has a case here is refused once, with a confirm button', /already belongs to a client/.test(refusal.text) && refusal.button && /admin(\.html)?/.test(page.url()) && !/admin-case/.test(page.url()), refusal.text.slice(0, 80));
await page.fill('[data-of="family:email"]', 'ann@example.com');
await page.fill('[data-of="family:relation"]', 'my mother');
await page.fill('[data-of="family:dob"]', '1950-01-02');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-family-form.png` });
await page.click('[data-open-go="family"]');
await page.waitForURL(/admin-case(\.html)?\?id=demo-case-family/, { timeout: 15000 });
await settle(page, 2000);
const famId = new URL(page.url()).searchParams.get('id');
const famHead = await page.evaluate(() => ({
  name: (document.querySelector('[data-client]')?.textContent || '').trim(),
  pill: (document.querySelector('[data-status]')?.textContent || '').trim(),
  chip: [...document.querySelectorAll('.loop-chip')].map((x) => x.textContent.trim()).find((t) => /Family, free/.test(t)) || '',
  selfHead: /\bself\b/.test(document.querySelector('.case-head')?.className || ''),
}));
ok('their case opens as an ordinary case with the family chip', famHead.name === 'Ann Bleach' && famHead.pill === 'CONFIRMED' && /Family, free: my mother/.test(famHead.chip) && !famHead.selfHead, `${famHead.name} / ${famHead.pill} / ${famHead.chip}`);
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="chat"]')?.click(); });
await settle(page, 800);
const famRate = await page.evaluate(() => document.querySelector('[data-work-rate]')?.hidden);
ok('and no money line beside their clock', famRate === true);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/07-family-case.png` });
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(page);
const famShelf = await page.evaluate((id) => {
  const card = document.querySelector(`.folder[data-id="${id}"]`);
  return {
    card: !!card, self: card?.classList.contains('self'),
    flag: (card?.querySelector('.fld-family')?.textContent || '').trim(),
    count: (document.body.textContent.match(/(\d+) cases?, every one backed/) || [])[1],
  };
}, famId);
ok('on the shelf it is an ordinary folder wearing the family flag, and the revenue line leaves it out', famShelf.card && !famShelf.self && /FAMILY · FREE, my mother/.test(famShelf.flag) && famShelf.count === before.count, JSON.stringify(famShelf));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/08-shelf-family.png` });

console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
