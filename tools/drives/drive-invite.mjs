// drive-invite.mjs - the + on the Clients screen, a case scheduled from a
// lead end to end, the menu over the case page's tabs, and the cards by
// state, in a real browser at 390px, in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-invite.mjs
//
// Eric, 2026-10-15, with two screenshots: "This menu is blocked. Also, let me
// delete my own cases. Lastly, there should be an example case I can open and
// shut... It will be a + at the top of my 'all cases' screen and then a drop
// down that says 'showcase', 'my own case' and 'schedule a case from a lead'.
// Once a lead is scheduled they are prompted to fill out the forms and
// confirm the time and date. Closed files should look like Chris's current
// aesthetic. But open ones should be highlighted in that ease in ease out
// blue/purple. Paused will be the same sort of aesthetic only yellow."
// His answer on money: "Pay when they confirm".
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' (' + d + ')' : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' (' + d + ')' : ''}`)); };
const errs = [];
async function side(role) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${role}: ${String(e).slice(0, 300)}`));
  return { ctx, page };
}
const settle = async (pg, ms = 1500) => {
  await pg.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await pg.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Skip|Close)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await pg.waitForTimeout(250); if (!hit) break;
  }
};

const { page } = await side('admin');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page, 2500);

console.log('\n--- A. the menu over the case page\'s tabs ---');
{
  await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
  await settle(page, 2500);
  // Scrolled, so the tab rail is stuck right under the bar, which is where he hit it.
  await page.evaluate(() => window.scrollTo(0, 600));
  await page.waitForTimeout(300);
  await page.click('.nav-toggle');
  await page.waitForTimeout(400);
  const hit = await page.evaluate(() => [...document.querySelectorAll('.bar-inner.collapsed .tabs.open a')].map((a) => {
    const r = a.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!top && (top === a || a.contains(top));
  }));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/invite-a-menu.png` });
  // NEGATIVE CONTROL (run 2026-10-15): look.css's `header.bar { z-index: 20; }` taken out made this read
  //   FAIL  every item in the open menu is on top and takes the tap, over the case page's tab rail
  ok('every item in the open menu is on top and takes the tap, over the case page\'s tab rail', hit.length >= 4 && hit.every(Boolean), JSON.stringify(hit));
  await page.keyboard.press('Escape');
}

console.log('\n--- B. the + and its menu ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(page, 2500);
{
  const closed = await page.evaluate(() => document.getElementById('add-menu').hidden);
  await page.click('[data-add-open]');
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => !document.getElementById('add-menu').hidden && document.querySelector('[data-add-open]').getAttribute('aria-expanded') === 'true');
  const items = await page.evaluate(() => [...document.querySelectorAll('#add-menu [role="menuitem"]')].filter((e) => e.checkVisibility()).map((e) => e.textContent.trim()));
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/invite-b-plus.png` });
  // NEGATIVE CONTROL (run 2026-10-15): wireAddMenu's + listening for 'dblclick' instead of 'click' made this read
  //   FAIL  a tap on the + opens his menu: Showcase, My own case, Schedule a case from a lead, then the family case
  // RE-PINNED 2026-10-16 (v7.60): no Showcase door (Eric, "Remove both": Demo mode replaces Joe Bloe).
  // NEGATIVE CONTROL (run 2026-10-16, v7.60): the Showcase door put back in admin.html's + menu made this read
  //   FAIL  a tap on the + opens his menu: My own case, Schedule a case from a lead, then the family case
  ok('a tap on the + opens his menu: My own case, Schedule a case from a lead, then the family case',
    closed && opened && items.join('|') === 'My own case|Schedule a case from a lead|Family case', items.join('|'));
  await page.click('.clients-head h1');
  await page.waitForTimeout(300);
  ok('a tap anywhere else puts it away', await page.evaluate(() => document.getElementById('add-menu').hidden));
  await page.click('[data-add-open]');
  await page.click('[data-open-door="self"]');
  await page.waitForTimeout(500);
  ok('My own case opens his own form, the menu folded behind it', await page.evaluate(() =>
    !document.querySelector('[data-open-form="self"]').hidden && document.querySelector('[data-open-form="family"]').hidden
    && document.getElementById('add-menu').hidden));
}

console.log('\n--- C. a case scheduled from a lead ---');
let inviteId = '';
let startIso = '';
{
  await page.click('[data-add-open]');
  await page.click('[data-open-door="lead"]');
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => ({
    open: !document.querySelector('[data-open-form="lead"]').hidden,
    leads: [...document.querySelectorAll('[data-lead-pick] option')].map((o) => o.textContent.trim()),
    price: document.querySelector('[data-lf="price"]').value,
  }));
  ok('the lead form opens with his leads to pick from and the live case price filled in',
    before.open && before.leads.some((t) => /jordan@example\.demo/.test(t)) && before.price === '2100', JSON.stringify(before));
  // RE-PINNED 2026-10-15 (v7.44): the demo now holds the advocate persona's client, Priya Shah, whose newer
  // case puts her first in his leads, so Jordan is picked by address rather than by place in the list.
  const jordan = await page.evaluate(() => [...document.querySelectorAll('[data-lead-pick] option')].find((o) => /jordan@example\.demo/.test(o.textContent))?.value ?? '0');
  await page.selectOption('[data-lead-pick]', jordan);
  const day = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  await page.fill('[data-lf="date"]', day);
  await page.fill('[data-lf="time"]', '10:00');
  startIso = new Date(`${day}T10:00:00-07:00`).toISOString();
  await page.click('[data-lead-go]');
  await page.waitForTimeout(1800);
  const said = (await page.textContent('[data-lead-said]')) || '';
  ok('Send the invite says who it went to, the time on his clock and the price', /^Sent to jordan@example\.demo: .*10:00 AM MST, \$2,100\. They confirm from the link\.$/.test(said.trim()), said.trim());
  const waiting = await page.evaluate(() => [...document.querySelectorAll('#invites [data-inv]')].map((r) => ({ id: r.dataset.inv, text: r.innerText.replace(/\s+/g, ' ') })));
  inviteId = waiting[0]?.id || '';
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/invite-c-sent.png` });
  ok('and it is listed as waiting on them, with Cancel', waiting.length === 1 && /Jordan Avery .*10:00 AM MST · \$2,100 Cancel/.test(waiting[0].text), JSON.stringify(waiting));
}

console.log('\n--- D. their side: the link, the forms, the confirm ---');
{
  const store = await page.evaluate(() => localStorage.getItem('pa-demo-store'));
  const { page: cp } = await side('client');
  await cp.goto(`${P}/book.html?invite=${inviteId}&demo=client`, { waitUntil: 'networkidle' });
  await cp.evaluate((s) => localStorage.setItem('pa-demo-store', s), store);
  await cp.reload({ waitUntil: 'networkidle' });
  await settle(cp, 2500);
  const s1 = await cp.evaluate(() => ({
    h1: document.querySelector('#step h1')?.textContent.trim(),
    time: document.querySelector('[data-invite-time]')?.innerText.replace(/\s+/g, ' ') || '',
    calendar: document.querySelectorAll('button.slot').length,
    request: !!document.getElementById('request-box'),
    details: !document.getElementById('after-times').hidden,
    rail: [...document.querySelectorAll('#crumbs .t')].map((t) => t.textContent),
    closed: !!document.querySelector('.pa-closed'),
  }));
  if (SHOTS) await cp.screenshot({ path: `${SHOTS}/invite-d-step1.png` });
  // NEGATIVE CONTROL (run 2026-10-15): renderTime's `if (state.invite) {` branch taken out made this read
  //   FAIL  the link opens on his time, set: no calendar, no request, the details below it, and the last step is Confirm
  ok('the link opens on his time, set: no calendar, no request, the details below it, and the last step is Confirm',
    s1.h1 === 'Your call is set' && /10:00 AM MST my time/.test(s1.time) && s1.calendar === 0 && !s1.request && s1.details
    && s1.rail.join('|') === 'Your time|One agreement|Confirm' && !s1.closed, JSON.stringify(s1));
  await cp.click('#continue');
  await cp.waitForTimeout(300);
  ok('Continue still asks for a number and the consent first', await cp.evaluate(() => !document.getElementById('method-error').hidden && /phone number/.test(document.getElementById('method-error').textContent)));
  await cp.fill('#phone', '+1 555 555 0100');
  await cp.check('#phone-consent');
  await cp.evaluate(() => {
    for (const [id, v] of [['pf-first', 'Jordan'], ['pf-last', 'Avery'], ['pf-dob', '1985-04-02']]) { const el = document.getElementById(id); if (el) el.value = v; }
  });
  await cp.click('#continue');
  await cp.waitForTimeout(1200);
  await cp.evaluate(async () => {
    for (const d of document.querySelectorAll('#step details.agreement')) {
      d.open = true;
      await new Promise((r) => setTimeout(r, 120));
      const body = d.querySelector('.agreement-body');
      body.scrollTop = body.scrollHeight;
      body.dispatchEvent(new Event('scroll'));
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  const boxes = await cp.locator('#step .agreement-check input').count();
  for (let i = 0; i < boxes; i++) await cp.locator('#step .agreement-check input').nth(i).check();
  await cp.click('#continue');
  await cp.waitForTimeout(1200);
  const s3 = await cp.evaluate(() => ({
    price: document.querySelector('[data-case-price]')?.textContent.trim(),
    button: document.getElementById('pay')?.textContent.trim(),
    line: document.querySelector('[data-invite-line]')?.textContent.trim() || '',
    hold: !!document.querySelector('[data-hold-line]'),
  }));
  if (SHOTS) await cp.screenshot({ path: `${SHOTS}/invite-d-confirm.png` });
  // NEGATIVE CONTROL (run 2026-10-15): repaintPrice's invitation branch taken out made this read
  //   FAIL  the last step is his price, charged on confirm, never a hold: "Confirm and pay $2,100"
  ok('the last step is his price, charged on confirm, never a hold: "Confirm and pay $2,100"',
    s3.price === '$2,100' && s3.button === 'Confirm and pay $2,100' && /charged when you confirm/.test(s3.line) && !s3.hold, JSON.stringify(s3));
  await cp.click('#pay');
  await cp.waitForURL((u) => /\/(return|case)(\.html)?/.test(u.toString()), { timeout: 15000 }).catch(() => {});
  await settle(cp, 3000);
  const made = await cp.evaluate((id) => {
    const raw = JSON.parse(localStorage.getItem('pa-demo-store') || '{}');
    const docs = new Map(raw.docs || []);
    const c = docs.get(`cases/${id}`);
    const inv = docs.get(`invites/${id}`);
    return { url: location.pathname, c: c && { status: c.status, start: new Date(c.appointment.start).toISOString(), requested: c.appointment.requested, rate: c.caseRateCents, paid: c.stripe?.amountTotal, charge: c.charge, invite: c.invite }, inv: inv && { state: inv.state, caseId: inv.caseId } };
  }, inviteId);
  // NEGATIVE CONTROL (run 2026-10-15): the demo confirm writing `requested: true` on the invited case's appointment made this read
  //   FAIL  confirmed, their case exists at his time and his price, paid, not a request and not a hold, and the invitation says so
  ok('confirmed, their case exists at his time and his price, paid, not a request and not a hold, and the invitation says so',
    made.c && made.c.status === 'confirmed' && made.c.start === startIso && made.c.requested === false && made.c.rate === 210000
    && made.c.paid === 210000 && !made.c.charge && made.c.invite?.id === inviteId && made.inv?.state === 'confirmed' && made.inv?.caseId === inviteId,
    JSON.stringify(made));
  await cp.goto(`${P}/book.html?invite=${inviteId}&demo=client`, { waitUntil: 'networkidle' });
  await settle(cp, 2000);
  const again = await cp.evaluate(() => ({ said: document.querySelector('[data-invite-said]')?.textContent || '', open: document.querySelector('#step a.btn.cta')?.getAttribute('href') || '' }));
  ok('the same link again says it is confirmed and opens the case', /already confirmed/.test(again.said) && again.open === `/case.html?id=${inviteId}`, JSON.stringify(again));
  // Back to his side with what the client did.
  const after = await cp.evaluate(() => localStorage.getItem('pa-demo-store'));
  await page.evaluate((s) => localStorage.setItem('pa-demo-store', s), after);
}

console.log('\n--- E. his side again: the list empties, the cards by state, Delete ---');
{
  await page.reload({ waitUntil: 'networkidle' });
  await settle(page, 2500);
  ok('the waiting list is empty once they confirm', await page.evaluate(() => !document.querySelector('#invites [data-inv]')));
  // RE-PINNED 2026-10-16 (v7.60): the + has no Showcase door (Eric, "Remove both": Demo mode replaces Joe Bloe), so the
  // demo builds him through the route the door used, for the cards below.
  const built = await page.evaluate(async () => (await (await fetch('/api/admin/showcase-case', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()).id || '');
  ok('Showcase walks into Joe Bloe', built === 'demo-case-showcase', built);
  await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
  await settle(page, 2500);
  // A paused case, for the gold.
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('pa-demo-store') || '{}');
    const docs = new Map(raw.docs || []);
    const c = docs.get('cases/demo-case');
    docs.set('cases/demo-case', { ...c, work: { ...(c.work || {}), startedAt: null }, hold: { pausedAt: new Date().toISOString(), periods: [] } });
    localStorage.setItem('pa-demo-store', JSON.stringify({ ...raw, docs: [...docs.entries()] }));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await settle(page, 2500);
  const cards = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.drawer .folder')].map((f) => [f.dataset.id, {
    cls: f.className, del: !!f.querySelector('[data-del]'),
    rim: getComputedStyle(f).backgroundImage, anim: getComputedStyle(f).animationName,
  }])));
  if (SHOTS) {
    await page.evaluate(() => document.querySelector('.drawer')?.scrollIntoView());
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${SHOTS}/invite-e-cards.png` });
  }
  const sc = cards['demo-case-showcase']; const paused = cards['demo-case']; const invited = cards[inviteId];
  // NEGATIVE CONTROL (run 2026-10-15): rowFor passing no `state` made this read
  //   FAIL  open cards wear the cyan to violet rim and breathe, a paused one the gold, and only his own and the showcase carry Delete
  // RE-PINNED 2026-10-16 (v7.57, warm is the look everywhere): his open folders now wear the warm
  // peach to pink rim and its own breath, so the cyan rim and st-open-glow are read as warm ones.
  // NEGATIVE CONTROL (run 2026-10-16): warm.css's open folder rim taken back to #3DDCF5 made this read
  //   FAIL  open cards wear the warm rim and breathe, a paused one the gold, and only his own and the showcase carry Delete
  // RE-PINNED 2026-10-17 (v7.76): Blue and green is the start past the home, so his open folders wear the cyan to violet
  // rim and its breath again, unless Warm is picked in Settings.
  // NEGATIVE CONTROL (run 2026-10-17, v7.78): admin.html's head line `var cool = localStorage.getItem('pa-look') !== 'warm';` made `=== 'cool'` made this read
  //   FAIL  open cards wear the Blue and green rim and breathe, a paused one the gold, and only his own and the showcase carry Delete
  ok('open cards wear the Blue and green rim and breathe, a paused one the gold, and only his own and the showcase carry Delete',
    /st-open/.test(sc?.cls) && /rgb\(61, 220, 245\)/.test(sc?.rim) && sc?.anim === 'st-open-glow'
    && /st-paused/.test(paused?.cls) && /rgb\(233, 185, 73\)/.test(paused?.rim) && paused?.anim === 'st-paused-glow'
    && /st-open/.test(invited?.cls) && sc?.del && !paused?.del && !invited?.del, JSON.stringify({ sc, paused, invited }));
  // Delete from the card: the sheet asks, Keep it keeps it. Each step is read before the next tap, so a
  // broken one reads FAIL here rather than stalling on a tap that cannot land.
  await page.click('.folder[data-id="demo-case-showcase"] [data-del]');
  await page.waitForTimeout(600);
  const sheet = await page.evaluate(() => ({ title: document.querySelector('dialog.ask-sheet h2')?.textContent || '', url: location.pathname })).catch(() => ({ title: '', url: 'navigated away' }));
  // NEGATIVE CONTROL (run 2026-10-15): wireFolderOpen's `[data-del]` early return taken out made this read
  //   FAIL  Delete on the card asks first in the app's own sheet and never opens the case
  ok('Delete on the card asks first in the app\'s own sheet and never opens the case', /^Delete Joe Bloe\?$/.test(sheet.title) && /admin(\.html)?$/.test(sheet.url), JSON.stringify(sheet));
  await page.click('dialog.ask-sheet [data-no]', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  // NEGATIVE CONTROL (run 2026-10-15): the sheet's Keep it answering `finish(true)` made this read
  //   FAIL  Keep it keeps him
  ok('Keep it keeps him', await page.evaluate(() => !!document.querySelector('.folder[data-id="demo-case-showcase"]')).catch(() => false));
  await page.click('.folder[data-id="demo-case-showcase"] [data-del]', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.click('dialog.ask-sheet button[value="ok"]', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1800);
  // NEGATIVE CONTROL (run 2026-10-15): wireShelfDelete's `load();` after a delete taken out made this read
  //   FAIL  Delete it takes the showcase off the shelf, and the + can open him fresh
  // RE-PINNED 2026-10-16 (v7.60): and the + has no door to build him again; Demo mode replaces him.
  // NEGATIVE CONTROL (run 2026-10-16, v7.60): the Showcase door put back in admin.html's + menu made this read
  //   FAIL  Delete it takes the showcase off the shelf, and the + has no door to build him again
  ok('Delete it takes the showcase off the shelf, and the + has no door to build him again', /admin(\.html)?$/.test(new URL(page.url()).pathname)
    && await page.evaluate(() => !document.querySelector('.folder[data-id="demo-case-showcase"]') && !document.querySelector('[data-showcase-door]')).catch(() => false));
}

ok('no page errors', errs.length === 0, errs.join(' | '));
console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
