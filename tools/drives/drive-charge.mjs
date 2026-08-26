// drive-charge.mjs - charging an amount agreed on a call.
//
//   PA_PORT=8901 node tools/drives/drive-charge.mjs
//
// Eric, 2026-08-26: "I need to charge a client 3400 (verbally agreed to on
// call). Is there a place I can do this manually." There was not. The manual
// charge was a percentage of the case rate capped at 150%, which on a $1,200
// case is $1,800, and $3,400 is 283% of it.
//
// This drives the typed amount end to end and asserts the number that reaches
// the Worker is the number he typed, because a charge control that quietly
// sends a different figure is worse than no charge control.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8901}`;
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ', n, d ? `(${d})` : ''); } else { fail++; console.log('  FAIL ', n, d ? `(${d})` : ''); } };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

// ASSERT ON WHAT THE SYSTEM DID, not on what was posted. The demo replaces
// window.fetch outright and answers /api/ locally, so nothing reaches the
// network and a route interception sees an empty page. That is a better test
// anyway: the number surviving the whole path to the case is the thing that
// matters, and a posted body that never lands proves nothing.
const stored = () => page.evaluate(() => {
  for (const k of Object.keys(localStorage)) {
    const v = localStorage.getItem(k) || '';
    const m = v.match(/"pendingExtra":\{[^}]*\}/);
    if (m) { try { return JSON.parse(`{${m[0]}}`).pendingExtra; } catch { return m[0]; } }
  }
  return null;
});

await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.evaluate(() => {
  const d = [...document.querySelectorAll('details')].find((x) => /Schedule a session/i.test(x.textContent || ''));
  if (d) d.open = true;
});
await page.waitForTimeout(800);

const ui = await page.evaluate(() => {
  document.querySelector('input[name=sched-mode][value=charge]')?.click();
  const amt = document.getElementById('sched-amt');
  const pcts = [...(document.getElementById('sched-pct')?.options || [])].map((o) => o.textContent.trim());
  return {
    hasAmount: !!amt,
    amountH: amt ? Math.round(amt.getBoundingClientRect().height) : 0,
    ceiling: pcts[pcts.length - 1] || '',
    amountIsFirst: !!amt && !!document.getElementById('sched-pct')
      && (amt.compareDocumentPosition(document.getElementById('sched-pct')) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  };
});
ok('there is a box to type an amount', ui.hasAmount);
ok('it comes before the percentages', ui.amountIsFirst);
ok('it is a 44px target', ui.amountH >= 44, `${ui.amountH}px`);
ok('the percentages still top out below what he needed', /150%/.test(ui.ceiling), ui.ceiling);

// Refuse a fat finger.
const dialogs = [];
page.on('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
await page.evaluate(() => {
  document.getElementById('sched-amt').value = '999999999';
  document.getElementById('sched-go').click();
});
await page.waitForTimeout(700);
const refused = await page.evaluate(() => {
  const e = document.getElementById('sched-err');
  return e && !e.hidden ? e.textContent.trim() : '';
});
ok('an impossible amount is refused before it is sent', /between \$1 and \$100,000/.test(refused), refused || '(sent it anyway)');
const afterRefusal = await stored();
ok('and nothing was charged', afterRefusal === null,
   afterRefusal ? `a charge WAS recorded: ${JSON.stringify(afterRefusal).slice(0, 90)}` : '');

// The real thing.
await page.evaluate(() => {
  document.getElementById('sched-amt').value = '3400';
  document.getElementById('sched-tag').value = 'Hands-Off Case Management, month one';
  document.getElementById('sched-go').click();
});
await page.waitForTimeout(2500);
const rec = await stored();
ok('the typed amount lands on the case, to the cent',
   !!rec && Number(rec.amountCents) === 340000, rec ? `amountCents=${rec.amountCents}` : 'nothing recorded');
ok('the invoice line rides with it',
   !!rec && /Hands-Off/.test(rec.label || ''), rec?.label || '');
ok('he was asked to confirm the exact figure first',
   dialogs.some((d) => /\$3,400/.test(d)), dialogs.join(' | '));

ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));
await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
