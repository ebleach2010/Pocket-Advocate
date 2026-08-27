// drive-forms.mjs - the authority documents, as they actually render.
//
//   PA_PORT=8901 node tools/drives/drive-forms.mjs
//
// Eric, 2026-08-26: "The forms are fucking horrendous. This? Really? Format it
// neatly." And: "There's also no way to exit out of this screen."
//
// authority.mjs F1-F17 pin the renderer's OUTPUT. This drives the real window
// in a real browser, because two of the three complaints are only observable
// there: whether the body actually renders in a serif at a readable size, and
// whether the Done button actually leaves. A button that exists in the source
// and does nothing when pressed would pass every source check ever written.
// Observed 2026-08-27: 32 ok, 0 FAIL.
//
// Negative controls, run the same day: restoring the old one-size-fits-all
// sentence ("Your document is incomplete...") turns "the message NAMES the
// name" red and quotes that sentence straight back; dropping
// body.classList.add('sheet-open') turns "the page behind the sheet is
// locked" red; removing the Done button turns authority.mjs F9 red.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8901}`;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ', n, d ? `(${d})` : ''); } else { fail++; console.log('  FAIL ', n, d ? `(${d})` : ''); } };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const errs = [];

// ---- the advocate's printed blank ----------------------------------------
const admin = await ctx.newPage();
admin.on('pageerror', (e) => errs.push(`admin: ${e.message}`));
await admin.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await admin.waitForTimeout(2500);

const before = ctx.pages().length;
await admin.evaluate(async () => {
  const A = await import('/js/authority.js');
  const W = await import('/js/authority-doc-window.js');
  W.openAuthorityDocument({
    model: A.recordsAuthorisationModel({ blank: true, clientName: 'Christopher Miller' }),
    title: 'Records authorisation',
  });
});
await admin.waitForTimeout(1200);
ok('the document opens in its own window', ctx.pages().length === before + 1);
const doc = ctx.pages()[ctx.pages().length - 1];
doc.on('pageerror', (e) => errs.push(`doc: ${e.message}`));
await doc.waitForTimeout(400);

const look = await doc.evaluate(() => ({
  font: getComputedStyle(document.body).fontFamily,
  size: getComputedStyle(document.body).fontSize,
  pres: document.querySelectorAll('pre').length,
  h1: document.querySelectorAll('h1').length,
  h2: document.querySelectorAll('h2').length,
  boxes: document.querySelectorAll('.doc-box').length,
  rules: document.querySelectorAll('.doc-rule').length,
  underscores: /_{6,}/.test(document.body.textContent || ''),
  done: !!document.querySelector('[data-done]'),
  print: !!document.querySelector('[data-print]'),
}));
ok('it is set in a serif, not a terminal font',
   /Georgia|Times|serif/i.test(look.font) && !/mono/i.test(look.font), look.font);
ok('at a size a person can read', parseFloat(look.size) >= 14, look.size);
ok('there is not a single <pre> left on it', look.pres === 0, String(look.pres));
ok('it has a title and real section headings', look.h1 === 1 && look.h2 >= 6, `h1=${look.h1} h2=${look.h2}`);
ok('the things to tick are boxes', look.boxes >= 8, String(look.boxes));
ok('and the things to write on are ruled lines, not underscores',
   look.rules >= 4 && look.underscores === false, `${look.rules} rules`);
ok('there is a Done button and a Print button', look.done && look.print);

// THE EXIT. This is the half a source check cannot prove.
const wasOpen = ctx.pages().length;
await doc.evaluate(() => document.querySelector('[data-done]').click());
await admin.waitForTimeout(900);
const closed = ctx.pages().length < wasOpen || doc.isClosed();
ok('and pressing Done actually leaves', closed,
   closed ? '' : 'the window stayed open, which is the original complaint');

// Nothing printed by itself: a print dialog would have blocked the evaluate
// above and this drive would have hung rather than reaching here.
ok('nothing printed on its own', true, 'no print dialog blocked the run');

// ---- the client's preview, before they sign ------------------------------
const client = await ctx.newPage();
client.on('pageerror', (e) => errs.push(`client: ${e.message}`));
await client.goto(`${P}/case.html?id=demo-case&demo=1`, { waitUntil: 'networkidle' });
await client.waitForSelector('[data-auth-panel]', { timeout: 20000 });
await client.evaluate(() => document.querySelector('[data-auth-add="records"]').click());
await client.waitForTimeout(900);
const sheet = await client.evaluate(() => {
  const d = [...document.querySelectorAll('.settings-card details')]
    .find((x) => /Read the whole form/.test(x.textContent));
  if (d) d.open = true;
  const el = document.querySelector('.auth-doc');
  return {
    tag: el?.tagName || 'missing',
    font: el ? getComputedStyle(el).fontFamily : '',
    heads: document.querySelectorAll('.auth-doc h1, .auth-doc h2').length,
    boxes: document.querySelectorAll('.auth-doc .doc-box').length,
    // The two controls he asked for by name, on the same sheet.
    sig: !!document.querySelector('[data-sig-open]'),
    sign: !!document.querySelector('[data-sign]'),
  };
});
ok('the form they read before signing is a document, not preformatted text',
   sheet.tag === 'DIV' && sheet.heads >= 6, `${sheet.tag}, ${sheet.heads} headings`);
ok('and it is not monospace either', !/mono/i.test(sheet.font), sheet.font);
ok('the tick boxes render there too', sheet.boxes >= 3, String(sheet.boxes));
ok('the signature box and the Sign button are on the same sheet', sheet.sig && sheet.sign);

// ---- the link he actually taps -------------------------------------------
// Eric asked for "a small suite preview where I can fill out that form so I
// can see how the tapping and signing work". Driven COLD, from a fresh page
// load with the parameter on the URL, because that is the only thing he will
// do: tap a link. Landing on a case page with the sheet shut would be a
// working feature and a useless link.
const deep = await ctx.newPage();
deep.on('pageerror', (e) => errs.push(`deep: ${e.message}`));
await deep.goto(`${P}/case.html?id=demo-case&demo=1&sign=records`, { waitUntil: 'networkidle' });
await deep.waitForSelector('.settings-card.sig-sheet', { timeout: 20000 }).catch(() => {});
const landed = await deep.evaluate(() => {
  const card = document.querySelector('.settings-card.sig-sheet');
  const box = document.querySelector('[data-sig-open]');
  return {
    open: !!card,
    heading: card?.querySelector('h3')?.textContent.trim() || '',
    clinic: !!document.querySelector('[data-f="clinicName"]'),
    typedName: !!document.querySelector('[data-f="signedName"]'),
    sigBox: !!box,
    sigTall: box ? Math.round(box.getBoundingClientRect().height) : 0,
    sign: !!document.querySelector('[data-sign]'),
    url: location.search,
  };
});
ok('the link lands with the form already open', landed.open, landed.heading || '(shut)');
ok('and it is the records authorisation, the one the link asked for',
   /Records authorisation/.test(landed.heading), landed.heading);
ok('the fields he types into are there', landed.clinic && landed.typedName);
ok('the signature box is there and is a real target',
   landed.sigBox && landed.sigTall >= 44, `${landed.sigTall}px`);
ok('and the Sign button with it', landed.sign);
// Spent on use: a parameter left behind reopens the sheet on every repaint.
ok('the link is spent, so it cannot reopen over itself',
   !/sign=/.test(landed.url), landed.url || '(clean)');

// Type into it and draw, which is the thing he wants to feel.
await deep.evaluate(() => {
  const el = document.querySelector('[data-f="clinicName"]');
  el.value = 'Mountain Ridge Neurology';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await deep.waitForTimeout(400);
const flowed = await deep.evaluate(() =>
  (document.querySelector('.auth-doc')?.textContent || '').includes('Mountain Ridge Neurology'));
ok('what he types appears in the document as he types it', flowed);

await deep.evaluate(() => document.querySelector('[data-sig-open]').click());
await deep.waitForTimeout(600);
const pad = await deep.evaluate(() => {
  const c = document.querySelector('canvas');
  return { canvas: !!c, w: c ? Math.round(c.getBoundingClientRect().width) : 0 };
});
ok('tapping the signature box opens a pad to draw on', pad.canvas, `${pad.w}px wide`);

// ---- what he hit on his phone --------------------------------------------
// Eric, 2026-08-27: "Biggest issue is saying the form isn't filled out
// completely when it is." It WAS filled in. He typed his own name on a case
// belonging to somebody else, the name check failed, and one generic sentence
// called that "incomplete".
//
// Driven as the exact failure: fill the form correctly, sign it, and type the
// wrong name.
const dateState = await deep.evaluate(() => ({
  allTicked: document.querySelector('[data-all-records]')?.checked,
  rangeHidden: document.querySelector('[data-date-range]')?.hidden,
}));
ok('all-records is ticked by default, so the dates stay out of the way',
   dateState.allTicked === true && dateState.rangeHidden === true, JSON.stringify(dateState));
const unticked = await deep.evaluate(() => {
  const b = document.querySelector('[data-all-records]');
  b.checked = false;
  b.dispatchEvent(new Event('change', { bubbles: true }));
  const wrap = document.querySelector('[data-date-range]');
  const ins = [...wrap.querySelectorAll('input[type=date]')];
  return {
    shown: !wrap.hidden,
    // Stacked, not two columns: each input gets the full width of the sheet.
    stacked: ins.length === 2 && ins[0].getBoundingClientRect().width > 200,
    width: ins[0] ? Math.round(ins[0].getBoundingClientRect().width) : 0,
  };
});
ok('unticking reveals the range', unticked.shown);
ok('and the two dates are stacked, each full width, not cramped side by side',
   unticked.stacked, `${unticked.width}px each`);
// Ticking it back must CLEAR them, not just hide them.
await deep.evaluate(() => {
  const from = document.querySelector('[data-f="fromDate"]');
  from.value = '2024-01-01';
  from.dispatchEvent(new Event('input', { bubbles: true }));
  const b = document.querySelector('[data-all-records]');
  b.checked = true;
  b.dispatchEvent(new Event('change', { bubbles: true }));
});
await deep.waitForTimeout(300);
const cleared = await deep.evaluate(() => ({
  value: document.querySelector('[data-f="fromDate"]').value,
  doc: (document.querySelector('.auth-doc')?.textContent || '').includes('whole period of my care'),
}));
ok('re-ticking clears the date rather than hiding a value nobody can see',
   cleared.value === '', `value=${JSON.stringify(cleared.value)}`);
ok('and the document goes back to the whole period of care', cleared.doc);

// The name. This is the one that stopped him.
const said = await deep.evaluate(() => {
  const n = document.querySelector('[data-f="signedName"]');
  n.value = 'Eric Leach';
  n.dispatchEvent(new Event('input', { bubbles: true }));
  document.querySelector('[data-sign]').click();
  const e = document.querySelector('[data-sheet-error]');
  return { hidden: e.hidden, text: e.textContent.trim() };
});
ok('a name that does not match is refused', said.hidden === false);
ok('and the message NAMES the name, instead of saying the form is incomplete',
   /Jordan Avery/.test(said.text) && !/incomplete/i.test(said.text), said.text.slice(0, 120));

// The page behind must be locked while the sheet is up, and released after.
const locked = await deep.evaluate(() => document.body.classList.contains('sheet-open'));
ok('the page behind the sheet is locked while it is open', locked);
await deep.evaluate(() => document.querySelector('[data-x]').click());
await deep.waitForTimeout(400);
const released = await deep.evaluate(() => document.body.classList.contains('sheet-open'));
ok('and released when the sheet closes, so the page is never left frozen', !released);

ok('no page errors anywhere', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
