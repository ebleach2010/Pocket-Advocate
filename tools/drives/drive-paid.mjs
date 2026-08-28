// drive-paid.mjs - correcting what a client actually paid, in a real browser.
//
//   PA_PORT=8799 node tools/drives/drive-paid.mjs
//
// His dashboard said $175 and the client had paid $3,400. The route worked and
// the field existed; what did not work was everything a person can see. The
// suite proves the arithmetic. This proves the part a suite cannot: that he
// can FIND the control, that pressing it says something back, and that the
// numbers on the page he is looking at change WITHOUT A RELOAD.
//
// That last one is the bug that started this. startWorkClock is called once,
// from render(), and closed over the case document as it stood then; load()
// re-reads the case and deliberately does not re-render the Chat pane, so the
// pill went on printing the pre-save hourly for as long as the page stayed
// open. A save that landed and a dead button looked identical.
//
// Driven at 390x844 and again at 320px, because the control is a row in an
// overlay and 320 is the width where rows stop fitting.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8799}`;
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass += 1; console.log('  ok   ', n, d ? `(${d})` : ''); }
  else { fail += 1; console.log('  FAIL ', n, d ? `(${d})` : ''); }
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const width of [390, 320]) {
  console.log(`\n--- ${width}px ---`);
  const ctx = await b.newContext({ viewport: { width, height: 844 } });
  await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  // The Chat page is where the rate pill lives. Two taps: the group, then the
  // page, the same way he gets there.
  // The tabs are <a data-page>, not buttons, and every pane is built at mount
  // and merely hidden - so a selector that misses still lets every assertion
  // below read a pane nobody can see. Click the real tab, by id.
  const toChat = () => page.evaluate(() => {
    document.querySelector('[data-group="case"]')?.click();
    const t = document.querySelector('[data-page="chat"]');
    if (t) t.click();
    return !!t;
  });
  await toChat();
  await page.waitForTimeout(800);

  const pill = () => page.evaluate(() => {
    const el = document.querySelector('[data-work-rate]');
    if (!el) return null;
    return {
      text: (el.textContent || '').trim(),
      hidden: el.hidden,
      unknown: el.classList.contains('unknown'),
      under: el.classList.contains('under'),
      // Not merely present: on the page the browser is actually showing.
      visible: !!el.closest('.fpage') && el.closest('.fpage').hidden === false,
      clickable: getComputedStyle(el).cursor === 'pointer',
    };
  });
  const paidRow = () => page.evaluate(() => {
    const ks = [...document.querySelectorAll('.fact-k')];
    const k = ks.find((x) => (x.textContent || '').trim() === 'PAID');
    return k ? (k.nextElementSibling?.textContent || '').replace(/\s+/g, ' ').trim() : '';
  });

  const before = await pill();
  ok('the rate pill is on screen at all',
    !!before && before.hidden === false && before.visible === true,
    before ? `${before.text}${before.visible ? '' : ' (on a hidden page)'}` : '(no pill)');
  ok('and it is a readout, not something dressed up as a button',
    before?.clickable === false, `cursor: ${before?.clickable ? 'pointer' : 'default'}`);

  // Overview first, so there is a PAID row to compare against.
  const toOverview = () => page.evaluate(() => {
    document.querySelector('[data-group="case"]')?.click();
    const t = document.querySelector('[data-page="overview"]');
    if (t) t.click();
    return !!t;
  });
  await toOverview();
  await page.waitForTimeout(500);
  const paidBefore = await paidRow();
  ok('Overview starts on the booking figure', /\$1,200/.test(paidBefore), paidBefore || '(no PAID row)');

  // THE CONTROL. Through the cog, the way he would.
  const cogOpened = await page.evaluate(() => {
    const c = document.querySelector('.cog-btn');
    if (c) c.click();
    return !!c;
  });
  ok('the settings cog is where it always is', cogOpened);
  await page.waitForSelector('[data-paid-amount]', { timeout: 10000 }).catch(() => {});

  const row = await page.evaluate(() => {
    const card = document.querySelector('#pa-settings .settings-card');
    const input = card?.querySelector('[data-paid-amount]');
    const btn = card?.querySelector('[data-paid-save]');
    const head = [...(card?.querySelectorAll('h4') || [])]
      .map((h) => h.textContent.trim()).find((t) => /actually paid/.test(t)) || '';
    return {
      found: !!input && !!btn,
      head,
      verb: btn?.textContent.trim() || '',
      tall: btn ? Math.round(btn.getBoundingClientRect().height) : 0,
      enabled: input ? !input.disabled : false,
      placeholder: input?.placeholder || '',
      // Nothing may run off the side of the card at 320.
      overflow: card ? Math.round(card.scrollWidth - card.clientWidth) : -1,
    };
  });
  ok('there is a labelled money row in the cog', row.found);
  ok('and it names the client, so it cannot be about the wrong case',
    /^What .+ actually paid$/.test(row.head) && !/this client/.test(row.head),
    row.head || '(no heading)');
  ok('the button carries the verb', row.verb === 'Record', row.verb);
  ok('and it is a real 44px target', row.tall >= 44, `${row.tall}px`);
  ok('it enabled itself only after reading the case', row.enabled === true);
  ok('with nothing recorded yet, it says so rather than showing an empty box',
    /Nothing recorded yet/.test(row.placeholder), row.placeholder);
  ok('the card does not scroll sideways', row.overflow <= 1, `${row.overflow}px over`);

  // Type it and press it. No reload anywhere below this line.
  await page.evaluate(() => {
    const el = document.querySelector('[data-paid-amount]');
    el.value = '3400';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.evaluate(() => document.querySelector('[data-paid-save]').click());
  await page.waitForTimeout(2000);

  const said = await page.evaluate(() =>
    (document.querySelector('[data-paid-said]')?.textContent || '').trim());
  ok('it says what happened, in a spot that is actually on the screen',
    /Recorded\./.test(said) && /\$3,400/.test(said), said || '(said nothing)');
  ok('and it says what the CLIENT now sees, not merely that a write succeeded',
    /their page/i.test(said), said.slice(0, 120));

  // Close the overlay and look at the page underneath. Nothing has reloaded.
  await page.evaluate(() => document.querySelector('#pa-settings [data-close]')?.click());
  await page.waitForTimeout(1200);

  const paidAfter = await paidRow();
  // THE BUG THAT STARTED THIS, in the two places it showed.
  ok('the Overview PAID row changed with no reload',
    /\$3,400/.test(paidAfter) && !/\$1,200/.test(paidAfter), paidAfter || '(no PAID row)');
  ok('and it says the figure is his own',
    /recorded by you/i.test(paidAfter), paidAfter.slice(0, 90));

  await toChat();
  await page.waitForTimeout(600);
  const after = await pill();
  ok('the rate pill changed with no reload',
    !!after && after.text !== before?.text, `${before?.text} -> ${after?.text}`);
  // $3,400 against about twelve hours of demo clock is a three-figure hourly,
  // comfortably over his $75 floor, so the amber "under" state goes with it.
  ok('and the hourly it now shows is worked out from the recorded figure',
    /^\$\d{3}\.\d\d\/hr$/.test(after?.text || ''), after?.text || '');
  ok('and the amber under-the-floor state cleared with it',
    after?.under === false, after?.under ? 'still amber' : '');

  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await page.screenshot({ path: `/tmp/pa-paid-${width}.png`, fullPage: false });
  await ctx.close();
}

await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
