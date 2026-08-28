// drive-act.mjs - the advisor's confirm card, in a real browser.
//
//   PA_PORT=8788 node tools/drives/drive-act.mjs
//
// The suite proves the validator, the tiers and the route. It cannot prove the
// part a suite never can: that the card is actually ON THE PAGE, that it shows
// him BOTH figures before he commits money, that the exact sentence a client
// will read is on screen before it is sent, and that none of it runs off the
// side of a phone.
//
// Driven at 390x844 and again at 320px, because the card is a stack of full
// width rows and 320 is the width where rows stop fitting.
//
// How the proposal gets in: the demo replaces window.fetch at module init, so
// playwright's route interception never sees these calls. This wraps
// window.fetch AGAIN, after the demo has, and merges a parked proposal into
// the state the panel polls. Everything below that is the SHIPPED panel code
// rendering the SHIPPED card.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8788}`;
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass += 1; console.log('  ok   ', n, d ? `(${d})` : ''); }
  else { fail += 1; console.log('  FAIL ', n, d ? `(${d})` : ''); }
};

const MONEY_ACT = {
  actId: 'drive-1', name: 'set-paid', tier: 'confirm', via: 'route', scoped: true,
  path: '/api/admin/case-update',
  args: { action: 'set-paid', paidCents: 350000, by: 'advisor' },
  summary: 'Record that this client has paid $3,500 for the case.',
  before: 'This case records $175 paid.',
  after: 'It would record $3,500 paid.',
  at: new Date().toISOString(),
};
const ALERT_ACT = {
  actId: 'drive-2', name: 'client-alert', tier: 'confirm', via: 'route', scoped: true,
  path: '/api/admin/client-alert',
  args: { text: 'Your insurance form is time sensitive. Please open your case today.' },
  summary: 'Your insurance form is time sensitive. Please open your case today.',
  before: null, after: null, at: new Date().toISOString(),
};

// A reversible setting on his own desk. He asked for these to just happen: a
// card in front of "I'm back" is a card he learns to dismiss without reading.
const DESK_ACT = {
  actId: 'drive-3', name: 'office-hours', tier: 'desk', via: 'route', scoped: false,
  path: '/api/admin/office-hours',
  args: { manual: 'out' },
  summary: 'Your door sign will show you OUT of the office.',
  before: null, after: null, at: new Date().toISOString(),
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
  await page.waitForTimeout(2500);

  // Wrap the demo's own fetch, so the state route answers with a parked
  // proposal and nothing else changes. Also record what the card POSTs when he
  // taps, because "it looked like it worked" is the failure this exists to
  // catch.
  await page.evaluate(() => {
    const prev = window.fetch;
    window.__posted = [];
    window.__act = null;
    window.fetch = async (input, init = {}) => {
      const url = String(input?.url || input || '');
      if (/\/api\/advisor$/.test(url) && init.body) {
        const body = JSON.parse(init.body);
        window.__posted.push(body);
        if (body.action === 'act-done') window.__act = null;
      }
      if (!/\/api\/advisor\/state/.test(url)) {
        if (init.body && !/\/api\/advisor$/.test(url)) window.__posted.push({ url, body: JSON.parse(init.body) });
        return prev(input, init);
      }
      const res = await prev(input, init);
      const out = await res.json();
      out.state = { ...(out.state || {}), pendingAct: window.__act };
      return new Response(JSON.stringify(out), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  });

  // The panel lives on the Advisor group. Two taps, the way he gets there.
  await page.evaluate(() => {
    document.querySelector('[data-group="advisor"]')?.click();
    document.querySelector('[data-page="advisor"]')?.click();
  });
  await page.waitForTimeout(600);
  ok('the panel is on the page and its act slot exists',
    await page.evaluate(() => !!document.querySelector('[data-act-card]')));

  // ---- THE MONEY CARD -------------------------------------------------
  await page.evaluate((a) => { window.__act = a; }, MONEY_ACT);
  await page.waitForTimeout(13000);        // the panel's idle poll is 12s

  const card = await page.evaluate(() => {
    const el = document.querySelector('[data-act-card]');
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return {
      text: el.innerText.replace(/\s+/g, ' ').trim(),
      right: Math.round(r.right), width: Math.round(r.width),
      buttons: [...el.querySelectorAll('button')].map((x) => ({
        label: x.textContent.trim(),
        h: Math.round(x.getBoundingClientRect().height),
        w: Math.round(x.getBoundingClientRect().width),
      })),
    };
  });
  ok('the money proposal paints a card', !!card, card ? '' : 'no card');
  if (card) {
    ok('it says what it would do', /paid \$3,500 for the case/.test(card.text), card.text.slice(0, 70));
    // THE ONE THAT MATTERS. 3500 and 35000 are one keystroke apart and this
    // is the only thing in the world that can tell them apart.
    ok('and it shows BOTH figures, what it is now and what it would become',
      /records \$175 paid/.test(card.text) && /would record \$3,500 paid/.test(card.text),
      card.text.slice(0, 140));
    ok('nothing is sent until a button', /Do it/.test(card.text) && /Not now/.test(card.text));
    ok('the card fits the screen', card.right <= width, `right edge ${card.right} of ${width}`);
    const small = card.buttons.filter((x) => x.h < 30);
    ok('both buttons are big enough to hit', !small.length,
      small.map((x) => `${x.label} ${x.h}px`).join(', '));
  }
  ok('and no horizontal scroll anywhere on the page',
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    await page.evaluate(() => `${document.documentElement.scrollWidth} vs ${window.innerWidth}`));
  // The card brings ITSELF into view; this only proves it landed there.
  const seen = await page.evaluate(() => {
    const r = document.querySelector('[data-act-card]').getBoundingClientRect();
    return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: window.innerHeight };
  });
  ok('and the card scrolled itself into view rather than hiding below the fold',
    seen.top < seen.h && seen.bottom > 0, `top ${seen.top} of ${seen.h}`);
  await page.screenshot({ path: `/tmp/act-money-${width}.png`, fullPage: false });

  // He taps. It should POST to the real route with the real body.
  await page.evaluate(() => [...document.querySelectorAll('[data-act-card] button')]
    .find((x) => /Do it/.test(x.textContent))?.click());
  await page.waitForTimeout(1500);
  const sent = await page.evaluate(() => window.__posted.slice());
  const call = sent.find((x) => x.url === '/api/admin/case-update');
  ok('the tap posts to the route that already does that job', !!call,
    JSON.stringify(sent.map((x) => x.url || x.action)).slice(0, 120));
  if (call) ok('with the figure he read, to the cent, marked as the advisor\'s',
    call.body.paidCents === 350000 && call.body.action === 'set-paid' && call.body.by === 'advisor',
    JSON.stringify(call.body));
  ok('and the proposal is cleared afterwards, not offered twice',
    sent.some((x) => x.action === 'act-done'));
  await page.screenshot({ path: `/tmp/act-money-done-${width}.png` });

  // ---- THE URGENT NOTIFICATION ----------------------------------------
  await page.evaluate((a) => { window.__act = a; window.__posted = []; }, ALERT_ACT);
  await page.waitForTimeout(13000);
  const alertCard = await page.evaluate(() => {
    const el = document.querySelector('[data-act-card]');
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect();
    return { text: el.innerText.replace(/\s+/g, ' ').trim(), right: Math.round(r.right) };
  });
  ok('the urgent notification paints its own card', !!alertCard);
  if (alertCard) {
    // The EXACT words, before anything sends. Not a paraphrase of them.
    ok('and it shows the exact sentence the client will read',
      alertCard.text.includes('Your insurance form is time sensitive. Please open your case today.'),
      alertCard.text.slice(0, 130));
    ok('the button says what it does', /Send it/.test(alertCard.text));
    ok('it fits the screen too', alertCard.right <= width, `right edge ${alertCard.right}`);
  }
  await page.evaluate(() => document.querySelector('[data-act-card]')
    ?.scrollIntoView({ block: 'center' }));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `/tmp/act-alert-${width}.png` });

  // ---- THE DESK SETTING, which gets no card ---------------------------
  await page.evaluate(() => {
    document.querySelector('[data-act-card] button')?.click();   // Not now
  });
  await page.waitForTimeout(600);
  await page.evaluate((a) => { window.__act = a; window.__posted = []; }, DESK_ACT);
  await page.waitForTimeout(13000);
  const desk = await page.evaluate(() => {
    const el = document.querySelector('[data-act-card]');
    return {
      text: el && !el.hidden ? el.innerText.replace(/\s+/g, ' ').trim() : '',
      buttons: el ? el.querySelectorAll('button').length : -1,
      posted: window.__posted.slice(),
    };
  });
  ok('a desk setting happens without asking, and says so',
    /Done/.test(desk.text) && /OUT of the office/.test(desk.text), desk.text.slice(0, 90));
  ok('and offers no button, because there is nothing left to decide',
    desk.buttons === 0, `${desk.buttons} button(s)`);
  ok('it called the ordinary settings route with the value it validated',
    desk.posted.some((x) => x.url === '/api/admin/office-hours' && x.body.manual === 'out'),
    JSON.stringify(desk.posted.map((x) => x.url || x.action)));
  await page.evaluate(() => document.querySelector('[data-act-card]')
    ?.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: `/tmp/act-desk-${width}.png` });

  ok('no page errors while any of that happened', !errs.length, errs.slice(0, 2).join(' | '));
  await ctx.close();
}

await b.close();
console.log(`\n${pass} ok, ${fail} FAILED`);
process.exit(fail ? 1 : 0);
