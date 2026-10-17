// drive-steps.mjs - a team member's add-ons, the appeal asked for and answered, Act is Log, nothing sold while sales are off (v7.65).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-steps.mjs
//
// Eric, 2026-10-17: "With full case management, attending appointments and writing insurance appeals are
// enhancements." "When I add a contractor into the app it will be a simple toggle with a price input. I can go into
// their profile and change this at any time by pressing on their profile picture." "Get rid of the specific
// 'appeals' tab in 'act'. So just replace that whole tab with simply 'log'". His prices: "$350", "$525".
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || '9377';
const SHOTS = process.env.PA_SHOTS || '';
const P = `http://127.0.0.1:${PORT}`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const errs = [];
const tryStep = async (fn) => { try { await fn(); return true; } catch { return false; } };
async function side(role) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${role}: ${String(e).slice(0, 200)}`));
  return page;
}
// Reshape one case in this tab's demo store, then load again.
const reshape = (page, id, patch) => page.evaluate(([cid, p]) => {
  const raw = JSON.parse(localStorage.getItem('pa-demo-store') || 'null');
  if (!raw?.docs) return false;
  const at = raw.docs.findIndex(([k]) => k === `cases/${cid}`);
  if (at < 0) return false;
  raw.docs[at][1] = { ...raw.docs[at][1], ...p };
  localStorage.setItem('pa-demo-store', JSON.stringify(raw));
  return true;
}, [id, patch]).catch(() => false);
const caseDoc = (page, id) => page.evaluate((cid) => {
  const raw = JSON.parse(localStorage.getItem('pa-demo-store') || 'null');
  return (raw?.docs || []).find(([k]) => k === `cases/${cid}`)?.[1] || null;
}, id).catch(() => null);
// The first-run card and any notes card, out of the way.
const settle = async (page, ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => {
      const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Close|Maybe later|Later|Skip|Not now)$/i.test((e.textContent || '').trim()));
      if (x) x.click();
      return !!x;
    }).catch(() => false);
    await page.waitForTimeout(250);
    if (!hit) break;
  }
};
// RE-PINNED 2026-10-17 (v7.68): adding a team member, and their photo, open the page by page wizard; its add-ons
// page has the same rows. A dot names each page, so a change jumps straight to it.
const toPage = async (page, title) => {
  await tryStep(() => page.waitForSelector('dialog.tm-sheet[open] .wz-dot', { timeout: 8000 }));
  await tryStep(() => page.click(`dialog.tm-sheet[open] .wz-dot[aria-label="${title}"]`, { timeout: 4000 }));
  await page.waitForTimeout(300);
};
const closeSheet = async (page) => { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(300); await page.evaluate(() => document.querySelectorAll('dialog').forEach((d) => d.remove())).catch(() => {}); };
const sheetRows = (page) => page.evaluate(() => {
  const d = document.querySelector('dialog.tm-sheet[open], dialog[open] form#adv-add')?.closest('dialog') || document.querySelector('dialog[open]');
  return [...(d?.querySelectorAll('.addon-row') || [])].map((r) => ({
    label: (r.querySelector('label')?.textContent || '').trim(),
    on: !!r.querySelector('[data-addon-on]')?.checked,
    price: r.querySelector('[data-addon-price]')?.value || '',
    priceOff: !!r.querySelector('[data-addon-price]')?.disabled,
  }));
}).catch(() => []);

console.log('\n--- A. Employer mode: their add-ons, set when added and changed from their photo ---');
const ad = await side('admin');
await ad.goto(`${P}/admin-employer.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(ad, 1800);
await tryStep(() => ad.click('[data-add-adv]', { timeout: 5000 }));
await tryStep(() => ad.fill('#adv-add input[name="name"]', 'Page Test', { timeout: 6000 }));
await tryStep(() => ad.fill('#adv-add input[name="email"]', 'page.test@advocate.demo', { timeout: 3000 }));
await tryStep(() => ad.fill('#adv-add input[name="password"]', 'first-pass-123', { timeout: 3000 }));
for (let i = 0; i < 2; i++) { await tryStep(() => ad.click('#adv-add [data-next]', { timeout: 4000 })); await ad.waitForTimeout(300); }
await tryStep(() => ad.waitForSelector('dialog[open] .addon-row', { timeout: 6000 }));
const addRows = await sheetRows(ad);
if (SHOTS) await ad.screenshot({ path: `${SHOTS}/steps-a-add.png` });
// NEGATIVE CONTROL (run 2026-10-17): Add an advocate's `${addonFields({})}` taken out made this read
// NEGATIVE CONTROL (run 2026-10-17, v7.68): the wizard's add-ons page `${addonFields(st.addons)}` taken out made this read FAIL.
//   FAIL  adding a team member asks for their add-ons: a toggle and a price for each, the price waiting on its toggle
ok('adding a team member asks for their add-ons: a toggle and a price for each, the price waiting on its toggle',
  addRows.map((r) => r.label).join('|') === 'Attending an appointment|Writing an insurance appeal' && addRows.every((r) => !r.on && r.priceOff),
  JSON.stringify(addRows));
await closeSheet(ad);

// His own card first: his prices, on his word.
await tryStep(() => ad.click('.tm-card [data-face]', { timeout: 5000 }));
await toPage(ad, 'Add-ons on Full-Service');
await tryStep(() => ad.waitForSelector('dialog.tm-sheet[open] .addon-row', { timeout: 6000 }));
const hisRows = await sheetRows(ad);
await closeSheet(ad);
// NEGATIVE CONTROL (run 2026-10-17): the demo's own add-ons for him set attend to 45000 made this read
//   FAIL  his photo opens his profile, with his add-ons: attending $525, an appeal $350
ok('his photo opens his profile, with his add-ons: attending $525, an appeal $350',
  hisRows.length === 2 && hisRows[0].on && hisRows[0].price === '525' && hisRows[1].on && hisRows[1].price === '350',
  JSON.stringify(hisRows));

// Theirs: off until he sets them; an appeal at $300, kept.
await tryStep(() => ad.click('.tm-card[data-uid="demo-advocate"] [data-face]', { timeout: 5000 }));
await toPage(ad, 'Add-ons on Full-Service');
await tryStep(() => ad.waitForSelector('dialog.tm-sheet[open] .addon-row', { timeout: 6000 }));
const anaBefore = await sheetRows(ad);
await tryStep(() => ad.check('dialog.tm-sheet[open] [data-addon-on="appeal"]', { timeout: 3000 }));
await tryStep(() => ad.fill('dialog.tm-sheet[open] [data-addon-price="appeal"]', '300', { timeout: 3000 }));
if (SHOTS) await ad.screenshot({ path: `${SHOTS}/steps-b-profile.png` });
await tryStep(() => ad.click('dialog.tm-sheet[open] [data-save]', { timeout: 3000 }));
await tryStep(() => ad.waitForSelector('dialog.tm-sheet', { state: 'detached', timeout: 8000 }));
await ad.waitForTimeout(800);
const saved = await ad.evaluate(async () => {
  const team = await fetch('/api/admin/team').then((r) => r.json()).catch(() => ({}));
  return (team.team || []).find((p) => p.uid === 'demo-advocate')?.addons || null;
}).catch(() => null);
await tryStep(() => ad.click('.tm-card[data-uid="demo-advocate"] [data-face]', { timeout: 5000 }));
await toPage(ad, 'Add-ons on Full-Service');
await tryStep(() => ad.waitForSelector('dialog.tm-sheet[open] .addon-row', { timeout: 6000 }));
const anaAfter = await sheetRows(ad);
await closeSheet(ad);
// NEGATIVE CONTROL (run 2026-10-17): the profile sheet's save leaving out its add-ons made this read
// NEGATIVE CONTROL (run 2026-10-17, v7.68): the wizard's update leaving out `addons,` made this read FAIL.
//   FAIL  a team member's add-ons are off until he sets them, and a toggle and price he sets from their photo are kept
ok('a team member\'s add-ons are off until he sets them, and a toggle and price he sets from their photo are kept',
  anaBefore.length === 2 && anaBefore.every((r) => !r.on) && saved?.appeal?.on === true && saved.appeal.cents === 30000 && saved.attend?.on === false
  && anaAfter[1]?.on && anaAfter[1]?.price === '300',
  JSON.stringify({ anaBefore, saved, anaAfter }));

console.log('\n--- B. Act is Log, for him and for a team member ---');
await ad.goto(`${P}/admin-case.html?id=demo-case-full&demo=admin`, { waitUntil: 'networkidle' });
await settle(ad, 2000);
const hisStrip = await ad.evaluate(() => ({
  groups: [...document.querySelectorAll('button[data-group]')].map((x) => (x.textContent || '').trim()).join('|'),
  appeals: !!document.querySelector('[data-page="appeals"]'),
})).catch(() => ({}));
const ct = await side('advocate');
await ct.goto(`${P}/admin-case.html?id=demo-case-ana&demo=advocate`, { waitUntil: 'networkidle' });
await settle(ct, 2000);
const theirStrip = await ct.evaluate(() => [...document.querySelectorAll('button[data-group]')].map((x) => (x.textContent || '').trim()).join('|')).catch(() => '');
// NEGATIVE CONTROL (run 2026-10-17): his strip's Log group labelled 'Act' again made this read
//   FAIL  the Act group is Log, and there is no Appeals page, for him and for a team member
ok('the Act group is Log, and there is no Appeals page, for him and for a team member',
  /Log/.test(hisStrip.groups || '') && !/Act/.test(hisStrip.groups || '') && hisStrip.appeals === false && /Log/.test(theirStrip) && !/Act/.test(theirStrip),
  JSON.stringify({ hisStrip, theirStrip }));

console.log('\n--- C. an appeal asked for: the client, then his yes ---');
const cl = await side('client');
await cl.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await cl.waitForTimeout(1500);
const offerOff = await cl.evaluate(() => !!document.querySelector('[data-request-appeal]')).catch(() => true);
await reshape(cl, 'demo-case-full', { addonRequest: { kind: 'appeal', state: 'pending', at: new Date().toISOString(), cents: 35000, note: 'The MRI denial' } });
await cl.reload({ waitUntil: 'networkidle' });
await settle(cl, 1800);
await tryStep(() => cl.click('.ftab[data-page="addons"]', { timeout: 5000 }));
await cl.waitForTimeout(1200);
const asking = await cl.evaluate(() => {
  const card = document.querySelector('[data-appeal-state]');
  return { state: card?.dataset.appealState || '', text: (card?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140), withdraw: !!card?.querySelector('[data-appeal-withdraw]'), offer: !!document.querySelector('[data-request-appeal]') };
}).catch(() => ({}));
if (SHOTS) await cl.screenshot({ path: `${SHOTS}/steps-c-client.png` });
// NEGATIVE CONTROL (run 2026-10-17): appealCard's pending state taken out made this read
//   FAIL  with sales off nothing new is offered, and an appeal already asked for waits with their advocate, theirs to withdraw
ok('with sales off nothing new is offered, and an appeal already asked for waits with their advocate, theirs to withdraw',
  offerOff === false && asking.state === 'pending' && /Your appeal request is with \S+\./.test(asking.text) && asking.withdraw && !asking.offer,
  JSON.stringify({ offerOff, asking }));

await ad.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await ad.waitForTimeout(1500);
await reshape(ad, 'demo-case-full', { addonRequest: { kind: 'appeal', state: 'pending', at: new Date().toISOString(), cents: 35000, note: 'The MRI denial' } });
await ad.reload({ waitUntil: 'networkidle' });
await settle(ad, 1800);
const shelf = await ad.evaluate(() => ({ loops: (document.body.innerText.match(/Asking for an insurance appeal/g) || []).length, tag: /ENHANCEMENT ASKED FOR/.test(document.body.innerText) })).catch(() => ({}));
await ad.goto(`${P}/admin-case.html?id=demo-case-full&demo=admin&page=overview`, { waitUntil: 'networkidle' });
await settle(ad, 2000);
const panel = await ad.evaluate(() => {
  const p = document.querySelector('[data-addon-request]');
  return { text: (p?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200), approve: !!p?.querySelector('[data-addon-decide="approve"]'), decline: !!p?.querySelector('[data-addon-decide="decline"]') };
}).catch(() => ({}));
await ad.evaluate(() => document.querySelector('[data-addon-decide="approve"]')?.scrollIntoView({ block: 'center' })).catch(() => {});
await tryStep(() => ad.click('[data-addon-decide="approve"]', { timeout: 3000 }));
await tryStep(() => ad.waitForSelector('dialog.ask-sheet[open]', { timeout: 4000 }));
const typed = await ad.evaluate(() => document.querySelector('dialog.ask-sheet[open] input')?.value || '').catch(() => '');
await tryStep(() => ad.click('dialog.ask-sheet button[value="ok"]', { timeout: 3000 }));
await ad.waitForTimeout(1500);
const after = await caseDoc(ad, 'demo-case-full');
const panelGone = await ad.evaluate(() => !document.querySelector('[data-addon-request]')).catch(() => false);
if (SHOTS) await ad.screenshot({ path: `${SHOTS}/steps-d-yes.png` });
// NEGATIVE CONTROL (run 2026-10-17): admin.js's Needs attention line for an add-on request taken out made this read
//   FAIL  his shelf flags the appeal, his case asks yes or no with their note, and his yes at the quoted $350 puts it on the case
ok('his shelf flags the appeal, his case asks yes or no with their note, and his yes at the quoted $350 puts it on the case',
  shelf.loops >= 1 && shelf.tag && /An insurance appeal: your call/.test(panel.text) && /\$350/.test(panel.text) && /The MRI denial/.test(panel.text) && panel.approve && panel.decline
  && typed === '350' && after?.addonsBought?.length === 1 && after.addonsBought[0].cents === 35000 && after.addonRequest?.state === 'started' && panelGone,
  JSON.stringify({ shelf, panel, typed, bought: after?.addonsBought, state: after?.addonRequest?.state }));

console.log('\n--- D. the chat line, while sales are off ---');
// A renewing chat line first, the demo's way (its checkout lands straight on the subscription).
await cl.evaluate(() => fetch('/api/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ termsAckAt: Date.now() }) })).catch(() => {});
await cl.goto(`${P}/subscription.html?demo=1`, { waitUntil: 'networkidle' }).catch(() => {});
await settle(cl, 2000);
const chatPage = await cl.evaluate(() => ({
  line: /Your chat with me/.test(document.body.innerText),
  card: (() => { const h = document.querySelector('[data-step-up]'); return !!h && !h.hidden && h.textContent.trim().length > 0; })(),
})).catch(() => ({ line: false, card: true }));
// NEGATIVE CONTROL (run 2026-10-17): subscription.js's `SALES_OPEN &&` taken off the step-up card made this read
//   FAIL  a subscriber's chat page offers no step up while sales are off
ok('a subscriber\'s chat page offers no step up while sales are off', chatPage.line && chatPage.card === false, JSON.stringify(chatPage));

ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
