// The seamless demo, driven exactly the way Eric described it:
//  A. start at the LANDING page with the demo on; tap the normal Book button;
//     demo mode survives the navigation (sessionStorage, no params needed).
//  B. book like normal: slot, consent, four agreement parts read to the end,
//     Pay — no email step (the demo user is already signed in), no Stripe.
//  C. the booking becomes a REAL case in the store; return.html lands on it;
//     the normal client case view renders with the Add-ons tab.
//  D. buy the follow-up add-on; the case doc records it.
//  E. the ADVOCATE side sees all of it: the new case on the shelf, the
//     purchase on the chart.
//  F. the call-notes panel on the Full Access case: draft, revise via the
//     overlay (never prompt()), discard.
import { chromium } from 'playwright';
// PA_PORT overrides the default, so a drive can be pointed at a server
// serving THIS tree. A shared 8795 that another session has repointed at a
// frozen checkout is how a drive reports on code that is not the code.
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
page.on('dialog', async (d) => { d.type() === 'confirm' ? await d.accept() : await d.dismiss(); });
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' — ' + d : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
const settle = async (ms = 2200) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => /^(Got it|Not now|Skip|Close|Done)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await page.waitForTimeout(250); if (!hit) break;
  }
};

// Fresh world.
await page.goto(`${P}/?demo=1`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(2200);

console.log('\n--- A. the landing page is the door ---');
ok('demo banner is on the landing page', await page.evaluate(() => !!document.querySelector('.demo-bar')));
ok('no maintenance scrim in the demo', await page.evaluate(() => !document.querySelector('.pa-maint')));
const bookHref = await page.evaluate(() => {
  const a = [...document.querySelectorAll('a')].find((x) => /^\/book(\.html)?$/.test(x.getAttribute('href') || ''));
  return a ? a.getAttribute('href') : '';
});
ok('the normal Book button is live', !!bookHref, bookHref);
await page.evaluate(() => {
  [...document.querySelectorAll('a')].find((x) => /^\/book(\.html)?$/.test(x.getAttribute('href') || ''))?.click();
});
await page.waitForURL(/book/, { timeout: 10000 }).catch(() => {});
await settle(2600);
ok('landed on booking WITHOUT a demo param, still in demo', await page.evaluate(() =>
  /book/.test(location.pathname) && !/demo=/.test(location.search) && !!document.querySelector('.demo-bar')));

console.log('\n--- B. book like normal ---');
ok('no email card: the demo user is already signed in', await page.evaluate(() =>
  !document.querySelector('#email-form') && !!document.querySelector('.slot')));
await page.locator('.slot').first().click();
await page.waitForTimeout(400);
await page.evaluate(() => {
  const p = document.querySelector('#phone'); if (p) p.value = '+1 555 0100';
  const c = document.querySelector('#phone-consent');
  if (c) { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); }
});
await page.evaluate(() => document.querySelector('#continue')?.click());
await settle(1500);
const parts = await page.evaluate(() => document.querySelectorAll('details.agreement').length);
ok('step 2: the four agreement parts', parts === 4, `${parts}`);
for (let i = 0; i < parts; i++) {
  await page.evaluate((idx) => {
    const d = document.querySelectorAll('details.agreement')[idx];
    d.open = true;
    const body = d.querySelector('.agreement-body');
    if (body) { body.scrollTop = body.scrollHeight; body.dispatchEvent(new Event('scroll')); }
  }, i);
  await page.waitForTimeout(350);
  await page.evaluate((idx) => {
    const box = document.querySelectorAll('details.agreement')[idx].querySelector('.agreement-check input');
    if (box && !box.checked) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
  }, i);
  await page.waitForTimeout(200);
}
await page.evaluate(() => document.querySelector('#continue')?.click());
await settle(1500);
ok('step 3: the payment step with the pay button', await page.evaluate(() => !!document.querySelector('#pay')));
await page.evaluate(() => document.querySelector('#pay')?.click());

console.log('\n--- C. the booking becomes a real case ---');
await page.waitForURL(/case\.html\?id=demo-case-booked/, { timeout: 20000 }).catch(() => {});
await settle(2600);
ok('return.html landed on the BOOKED case, not the fixture', await page.evaluate(() =>
  /id=demo-case-booked/.test(location.search)));
const caseView = await page.evaluate(() => ({
  tabs: document.querySelectorAll('.ftab').length,
  addons: [...document.querySelectorAll('.ftab, [role="tab"], a, button')].some((t) => /Enhance/.test(t.textContent || '')),
  banner: !!document.querySelector('.demo-bar'),
  store: JSON.parse(localStorage.getItem('pa-demo-store') || '{}').docs?.some?.((d) => d[0] === 'cases/demo-case-booked') || false,
}));
ok('the normal client case view renders', caseView.tabs > 0 && caseView.banner, `${caseView.tabs} tabs`);
ok('the case doc is really in the demo store', caseView.store);
ok('the Case Enhancements tab is there (pill reads "Enhance")', caseView.addons);

console.log('\n--- D. buy an enhancement (telehealth on the fresh case) ---');
// The follow-up card correctly waits for the report; on a case that has not
// had its first call, the purchasable add-ons are telehealth and the upgrade.
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.ftab')].find((a) => /Enhance/.test(a.textContent));
  t?.click();
});
await page.waitForTimeout(1200);
const addons = await page.evaluate(() => ({
  telehealth: !!document.querySelector('[data-th-request]'),
  followupHidden: !document.querySelector('[data-buy-followup]'),
  upgrade: !!document.querySelector('[data-upgrade] button, [data-upgrade-buy]'),
}));
ok('telehealth card offers on the new case', addons.telehealth);
ok('the follow-up correctly waits for the report', addons.followupHidden);
await page.evaluate(() => {
  const d = new Date(Date.now() + 5 * 86400_000);
  const pad = (n) => String(n).padStart(2, '0');
  document.querySelector('[data-th-when]').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T14:30`;
  document.querySelector('[data-th-clinic]').value = 'Riverside Neurology';
  document.querySelector('[data-th-provider]').value = 'Dr. Alvarez';
  const a = document.querySelector('[data-th-attest]'); if (a) a.checked = true;
});
await page.evaluate(() => document.querySelector('[data-th-request]')?.click());
await page.waitForURL(/telehealth=1/, { timeout: 15000 }).catch(() => {});
await settle(2200);
ok('telehealth request written to the BOOKED case', await page.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('pa-demo-store') || '{}').docs || [];
  const c = rows.find((d) => d[0] === 'cases/demo-case-booked')?.[1];
  return c?.pendingTelehealth?.state === 'requested';
}));

console.log('\n--- E. the advocate side sees it ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(3000);
const shelf = await page.evaluate(() => ({
  booked: !!document.querySelector('a[href*="demo-case-booked"]')
    || /demo-case-booked/.test(document.body.innerHTML),
  cards: document.body.innerHTML.match(/admin-case\.html\?id=/g)?.length || 0,
}));
ok('the new case is on the shelf', shelf.booked, `${shelf.cards} case links`);
await page.goto(`${P}/admin-case.html?id=demo-case-booked&demo=admin`, { waitUntil: 'networkidle' });
await settle(3000);
const chart = await page.evaluate(() => ({
  name: /Jordan/.test(document.body.textContent),
  status: /CONFIRMED/i.test(document.body.textContent),
  thCard: !!document.querySelector('[data-telehealth="confirm"]'),
}));
ok('the chart opens on the booked case', chart.name && chart.status, JSON.stringify(chart));
ok('the telehealth confirm card followed the client purchase over', chart.thCard);

console.log('\n--- F. the call-notes workbench (Full Access fixture) ---');
await page.goto(`${P}/admin-case.html?id=demo-case-full&demo=admin`, { waitUntil: 'networkidle' });
await settle(3000);
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.ftab')].find((a) => /Drafts/.test(a.textContent));
  t?.click();
});
await page.waitForTimeout(1200);
ok('the panel renders with the draft button', await page.evaluate(() =>
  !!document.querySelector('[data-cn-root]') && !!document.querySelector('[data-cn-write]')));
await page.evaluate(() => document.querySelector('[data-cn-write]')?.click());
// The state poll repaints on its own clock; give it a full cycle.
let drafted = false;
for (let i = 0; i < 18 && !drafted; i++) {
  await page.waitForTimeout(1000);
  drafted = await page.evaluate(() => /ACTION PLAN/.test(document.querySelector('[data-cn-text]')?.value || ''));
}
ok('the notes draft lands with ACTION PLAN first', drafted);
ok('the bracket visual line is in the draft', await page.evaluate(() =>
  /\[Line chart:/.test(document.querySelector('[data-cn-text]')?.value || '')));
// Revise through the overlay — never prompt().
await page.evaluate(() => document.querySelector('[data-cn-revise]')?.click());
await page.waitForTimeout(500);
ok('the revise OVERLAY opens (no prompt())', await page.evaluate(() => !!document.querySelector('#pa-cn-revise')));
await page.evaluate(() => {
  const t = document.querySelector('#pa-cn-revise [data-inst]');
  if (t) t.value = 'Make the pitch shorter';
  document.querySelector('#pa-cn-revise [data-go]')?.click();
});
let revised = false;
for (let i = 0; i < 18 && !revised; i++) {
  await page.waitForTimeout(1000);
  revised = await page.evaluate(() => /Revised for the demo/.test(document.querySelector('[data-cn-text]')?.value || ''));
}
ok('revision builds on the box text', revised);
ok('print + discard buttons present', await page.evaluate(() =>
  !!document.querySelector('[data-cn-print]') && !!document.querySelector('[data-cn-discard]')));
await page.evaluate(() => document.querySelector('[data-cn-discard]')?.click());
let cleared = false;
for (let i = 0; i < 16 && !cleared; i++) {
  await page.waitForTimeout(1000);
  cleared = await page.evaluate(() => !document.querySelector('[data-cn-text]')
    && /Draft notes for call/.test(document.querySelector('[data-cn-write]')?.textContent || ''));
}
ok('discard clears back to the draft button', cleared);

// G REWRITTEN 2026-08-25. It drove a "▾ What I'm doing" button floating above
// the log at 0.72rem, right-aligned, which Eric never found - "There is still
// no react that I asked for." The statuses now live in a dropdown beside the
// heading, where a standing state belongs. Same write, same chip, same words
// pushed to the client; a different and findable door. Checks updated rather
// than dropped, and G1 is new: WHERE it sits is the whole point of the change.
console.log('\n--- G. the status dropdown beside "Chat with the client" ---');
await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await settle(2600);
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.ftab')].find((a) => /Chat/.test(a.textContent));
  t?.click();
});
await page.waitForTimeout(1500);
const g = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h3')].find((x) => /Chat with the client/.test(x.textContent));
  const sel = document.querySelector('[data-status-pick]');
  if (!h || !sel) return { present: false };
  const hr = h.getBoundingClientRect(); const sr = sel.getBoundingClientRect();
  const clock = document.querySelector('[data-workclock]');
  return {
    present: true,
    // It must sit between the heading and the clock row, wrapped or not.
    beforeClock: !!clock && sr.bottom <= clock.getBoundingClientRect().top + 2
      && sr.top >= hr.top - 2,
    labels: [...sel.options].map((o) => o.textContent.trim()),
  };
});
// This drive runs at 390px. Side by side there would squeeze a sentence-long
// label into nothing, so the row WRAPS on a phone and the dropdown lands
// directly under the heading - which is still "beside the heading" in the
// sense that matters: same block, immediately adjacent, nowhere near the log.
// Eric's PC is proved separately in drive-status.mjs at 1280px, where it does
// sit to the right. Asserting `right` here would be asserting a squeeze.
ok('the status dropdown is in the heading block, above the clock row',
  g.present && g.beforeClock, JSON.stringify({ present: g.present, beforeClock: g.beforeClock }));
ok('G1 the old ▾ button is gone, so there is one door and not two',
  await page.evaluate(() => !document.querySelector('[data-status-arrow]')));
ok('it lists the new lines', !!g.labels && g.labels.some((l) => /local resources/.test(l)),
  (g.labels || []).length + ' options');
await page.selectOption('[data-status-pick]', 'local');
await page.waitForTimeout(1800);
ok('the status lands on the newest message as a RECORD (own message allowed)', await page.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('pa-demo-store') || '{}').docs || [];
  return rows.some(([k, v]) => /^cases\/demo-case\/chat\//.test(k)
    && v.reaction?.id === 'local' && v.reaction?.kind === 'status');
}));
ok('and the chip actually RENDERS in the log', await page.evaluate(() => {
  const t = document.body.textContent;
  return /Eric is looking into local resources/.test(t);
}));

console.log('\n--- H. the manual clock: three switches, one truth ---');
// The FULL fixture: its seeded clock is STOPPED (the standard case's is
// seeded running on purpose, to show the live state on the shelf).
const workOf = () => page.evaluate(() => {
  const rows = JSON.parse(localStorage.getItem('pa-demo-store') || '{}').docs || [];
  return rows.find((d) => d[0] === 'cases/demo-case-full')?.[1]?.work || {};
});
await page.goto(`${P}/admin-case.html?id=demo-case-full&demo=admin`, { waitUntil: 'networkidle' });
await settle(2600);
ok('the header switch sits beside the status pill', await page.evaluate(() =>
  !!document.querySelector('[data-work-head]')));
ok('nothing auto-started on chart entry (manual only)', !(await workOf()).startedAt);
await page.evaluate(() => document.querySelector('[data-work-head]')?.click());
await page.waitForTimeout(1200);
ok('tapping it clocks in (glow + running in the store)', await page.evaluate(() =>
  document.querySelector('[data-work-head]')?.classList.contains('glow'))
  && !!(await workOf()).startedAt);
await page.evaluate(() => {
  const t = [...document.querySelectorAll('.ftab')].find((a) => /Chat/.test(a.textContent));
  t?.click();
});
await page.waitForTimeout(1200);
ok('the chat row switch shows the SAME clock running', await page.evaluate(() =>
  /Stop working/.test(document.querySelector('[data-work-toggle]')?.textContent || '')));
await page.evaluate(() => document.querySelector('[data-work-toggle]')?.click());
await page.waitForTimeout(1200);
ok('stopping from the chat row repaints the header switch too', await page.evaluate(() =>
  !document.querySelector('[data-work-head]')?.classList.contains('glow'))
  && !(await workOf()).startedAt);
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(2600);
ok('the shelf card still carries its own clock switch', await page.evaluate(() =>
  !!document.querySelector('[data-clock]')));

console.log(`\n${pass} ok, ${fail} FAIL`);
if (errs.length) console.log('page errors:\n' + errs.join('\n'));
await b.close();
process.exit(fail || errs.length ? 1 : 0);
