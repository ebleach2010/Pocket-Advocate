// drive-advocates.mjs - an advocate's own workspace, and his Advocates tab,
// in a real browser at 390px on the demo personas.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-advocates.mjs
//
// Eric, 2026-10-15: "Each advocate gets their own isolated workspace." And:
// "Admin creates advocate accounts from the admin dashboard." The walls are
// the Worker's and the rules' (tools/suites/advocates.mjs, tools/rules/);
// this walks what each side sees: the advocate's shelf, tabs and case page,
// their setup from the first password to Finish, and his tab that adds,
// shares and turns off.
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
async function side(role, width = 390) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${role}: ${String(e).slice(0, 300)}`));
  return page;
}
// The tabs sit in the menu over the page (v7.41), so they are read whether it is open or not.
const tabsOf = (page) => page.evaluate(() => [...document.querySelectorAll('header .tabs a')]
  .filter((a) => getComputedStyle(a).display !== 'none').map((a) => a.textContent.trim()).filter(Boolean));
// The page clips sideways overflow (site.css: overflow-x: clip), so what is
// measured is anything visible that runs past the right edge.
const sideways = (page) => page.evaluate(() => {
  const past = [...document.querySelectorAll('main *')].filter((e) => e.checkVisibility() && e.getBoundingClientRect().right > innerWidth + 1);
  return Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, past.length);
});

console.log('\n--- A. the advocate\'s shelf ---');
const adv = await side('advocate');
await adv.goto(`${P}/admin.html?demo=advocate`, { waitUntil: 'networkidle' });
await adv.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await adv.reload({ waitUntil: 'networkidle' });
await adv.waitForTimeout(2500);
const advTabs = await tabsOf(adv);
// NEGATIVE CONTROL (run 2026-10-15): '/admin-leads.html' taken out of HIS_ALONE in admin-staffnav.js made this read
//   FAIL  the advocate's tabs are their own work and My account; his leads, hours, dictionary, fund and Advocates are not there
ok('the advocate\'s tabs are their own work and My account; his leads, hours, dictionary, fund and Advocates are not there',
  advTabs.includes('My account') && !advTabs.some((t) => /Leads|Availability|Hours|Dictionary|Fund|Advocates|My profile/i.test(t)),
  advTabs.join(' | '));
const shelf = await adv.evaluate(() => ({
  names: [...document.querySelectorAll('#list .folder-name')].map((e) => e.textContent.trim()),
  panels: ['office', 'fit-calls', 'waitlist', 'personal', 'invites'].filter((id) => document.getElementById(id)?.checkVisibility()),
  plus: !!document.querySelector('[data-add-open]')?.checkVisibility(),
  ledger: [...document.querySelectorAll('[data-ledger]')].some((e) => e.checkVisibility()),
}));
if (SHOTS) await adv.screenshot({ path: `${SHOTS}/advocates-1-shelf.png` });
// NEGATIVE CONTROL (run 2026-10-15): the advocate branch's panel removal taken out of admin.js made this read
//   FAIL  their shelf holds their own client alone, with none of his panels, his + or his ledger
// RE-PINNED AND RENAMED 2026-10-15 (v7.46): Eric, "The + sign under all cases should only be there to schedule a
// case from any lead they themselves acquire." Their + is back with that one door (drive-employer F checks the
// door), and the invitations they sent wait under it; every panel of his is still gone.
// NEGATIVE CONTROL (run 2026-10-15, v7.46): the advocate branch's panel removal taken out of admin.js made this read
//   FAIL  their shelf holds their own client alone, with none of his panels or his ledger; their + and their waiting invitations are their own
ok('their shelf holds their own client alone, with none of his panels or his ledger; their + and their waiting invitations are their own',
  shelf.names.length === 1 && /Priya/.test(shelf.names[0]) && shelf.panels.join() === 'invites' && shelf.plus && !shelf.ledger, JSON.stringify(shelf));

console.log('\n--- B. their case ---');
await adv.goto(`${P}/admin-case.html?id=demo-case-ana&demo=advocate`, { waitUntil: 'networkidle' });
await adv.waitForTimeout(2500);
const groupTabs = {};
for (const g of ['Case', 'Mine', 'Act']) {
  const btn = await adv.$(`.folder-groups button:has-text("${g}")`);
  if (!btn) { groupTabs[g] = null; continue; }
  await btn.click();
  await adv.waitForTimeout(700);
  groupTabs[g] = await adv.evaluate(() => [...document.querySelectorAll('.folder-tabs button, .folder-tabs [role="tab"]')].filter((e) => e.checkVisibility()).map((e) => e.textContent.trim()));
}
const groups = await adv.evaluate(() => [...document.querySelectorAll('.folder-groups button')].map((e) => e.textContent.trim()));
// The tab names without their emoji; exactly these, and none of his private pages.
const named = Object.fromEntries(Object.entries(groupTabs).map(([g, t]) => [g, (t || []).map((x) => x.replace(/^[^\p{L}]+/u, '').trim())]));
const WANT = { Case: ['Overview', 'Chat', 'Uploads'], Mine: ['Notes', 'Agenda', 'Saved'], Act: ['Work log', 'Milestones'] };
// NEGATIVE CONTROL (run 2026-10-15): the ADVOCATE_PAGES filter taken off admin-case.js's pages made this read
//   (first run MISSED: the check looked for page names that are not his; now it pins the exact set, then re-run)
//   FAIL  their case opens in three groups, Case, Mine and Act, with the pages that hold their own work and none of his private reading
ok('their case opens in three groups, Case, Mine and Act, with the pages that hold their own work and none of his private reading',
  groups.join('|') === 'Case|Mine|Act' && JSON.stringify(named) === JSON.stringify(WANT),
  JSON.stringify({ groups, named }));
await adv.click('.folder-groups button:has-text("Mine")');
await adv.waitForTimeout(600);
const notesTab = await adv.$('.folder-tabs button:has-text("Notes")');
if (notesTab) { await notesTab.click(); await adv.waitForTimeout(600); }
const paper = await adv.$('[contenteditable="true"]');
if (paper) { await paper.click(); await adv.keyboard.type('Echo report arrived; ask about the holter.'); await adv.waitForTimeout(2600); }
const noteSaved = await adv.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('pa-demo')).some((k) => (localStorage.getItem(k) || '').includes('ask about the holter')));
// NEGATIVE CONTROL (run 2026-10-15): the notes page's /api/notes save for an advocate pointed at a bad route made this read
//   FAIL  their notes on the case save
ok('their notes on the case save', !!paper && noteSaved);
await adv.click('.folder-groups button:has-text("Case")');
await adv.waitForTimeout(500);
await adv.click('.folder-tabs >> text=Chat');
await adv.waitForTimeout(1000);
const box = await adv.$('#chat textarea');
if (box) {
  await box.fill('Thank you, I have your echo report.');
  const send = await adv.$('#chat button:has-text("Send"), #chat button[aria-label="Send"]');
  if (send) await send.click();
  await adv.waitForTimeout(1800);
}
const last = await adv.evaluate(() => { const m = [...document.querySelectorAll('#chat .msg')].pop(); return m ? { cls: m.className, text: m.textContent.trim().slice(0, 80) } : null; });
if (SHOTS) await adv.screenshot({ path: `${SHOTS}/advocates-2-chat.png` });
// NEGATIVE CONTROL (run 2026-10-15): chat.js's own side pinned to his uid (`data.from === 'demo-admin'`) made this read
//   FAIL  their reply lands in the client's chat on their own side
ok('their reply lands in the client\'s chat on their own side', !!last && /echo report/.test(last.text) && /\bme\b/.test(last.cls), JSON.stringify(last));

console.log('\n--- C. their setup ---');
await adv.goto(`${P}/admin-account.html?setup=1&demo=advocate`, { waitUntil: 'networkidle' });
await adv.waitForTimeout(2000);
const pwFirst = await adv.evaluate(() => !!document.querySelector('#pw-form')?.checkVisibility());
await adv.fill('#pw-form input[name="current"]', 'given-password-1');
await adv.fill('#pw-form input[name="next"]', 'my-own-password-22');
await adv.fill('#pw-form input[name="again"]', 'my-own-password-22');
await adv.click('#pw-form button[type="submit"]');
await adv.waitForTimeout(1500);
const pwGone = await adv.evaluate(() => !document.querySelector('#pw-form'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await adv.setInputFiles('[data-photo-input]', { name: 'me.png', mimeType: 'image/png', buffer: png });
await adv.waitForTimeout(1800);
const photo = await adv.evaluate(() => !!document.querySelector('[data-photo] img')?.getAttribute('src'));
await adv.fill('#profile-form input[name="credentials"]', 'RN, BCPA, 9 years in cardiology clinics');
await adv.selectOption('#profile-form select[name="primary"]', 'Cardiology');
await adv.check('#profile-form input[value="Rare Disease"]');
await adv.fill('#profile-form textarea[name="bio"]', 'I help people with heart conditions get answers and keep their care moving.');
await adv.click('#profile-form button[type="submit"]');
await adv.waitForTimeout(1500);
const steps = await adv.evaluate(() => [...document.querySelectorAll('.steps li')].map((l) => ({ done: !!l.className, text: l.textContent.trim() })));
if (SHOTS) await adv.screenshot({ path: `${SHOTS}/advocates-3-setup.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-15): the photo upload's success branch skipping its redraw made this read
//   FAIL  setup asks for their own password first, then takes a photo and a profile, and every step reads done
ok('setup asks for their own password first, then takes a photo and a profile, and every step reads done',
  pwFirst && pwGone && photo && steps.length >= 3 && steps.every((s) => s.done), JSON.stringify({ pwFirst, pwGone, photo, steps }));
const advSideways = await sideways(adv);
await adv.click('[data-finish]');
await adv.waitForTimeout(2500);
// NEGATIVE CONTROL (run 2026-10-15): Finish's redirect pointed at /admin-account.html made this read
//   FAIL  Finish takes them to their shelf
ok('Finish takes them to their shelf', /\/admin(\.html)?(\?|$)/.test(adv.url()), adv.url());

console.log('\n--- D. his Advocates tab ---');
const adm = await side('admin');
await adm.goto(`${P}/admin-advocates.html?demo=admin`, { waitUntil: 'networkidle' });
await adm.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await adm.reload({ waitUntil: 'networkidle' });
await adm.waitForTimeout(2500);
const admTabs = await tabsOf(adm);
// NEGATIVE CONTROL (run 2026-10-15): mountStaffNav's Advocates tab for him taken out made this read
//   FAIL  his tabs gain Advocates and My profile
ok('his tabs gain Advocates and My profile', admTabs.includes('Advocates') && admTabs.includes('My profile'), admTabs.join(' | '));
const cards = () => adm.evaluate(() => [...document.querySelectorAll('.adv-card')].map((c) => ({ name: c.querySelector('h3').textContent.trim(), st: c.querySelector('.status-pill').textContent.trim() })));
const before = await cards();
await adm.fill('#adv-add input[name="name"]', 'Marcus Lee');
await adm.fill('#adv-add input[name="email"]', 'marcus@advocate.demo');
await adm.fill('#adv-add input[name="password"]', 'first-pass-123');
await adm.click('#adv-add button[type="submit"]');
await adm.waitForTimeout(2200);
const said = (await adm.textContent('#adv-said')) || '';
const after = await cards();
const marcus = after.find((c) => c.name === 'Marcus Lee');
// NEGATIVE CONTROL (run 2026-10-15): the demo's create answering 409 made this read
//   FAIL  he adds an advocate: the card appears, setting up, and the password never shows on the page
ok('he adds an advocate: the card appears, setting up, and the password never shows on the page',
  before.some((c) => c.st === 'YOU') && marcus?.st === 'SETTING UP' && /^Done\./.test(said)
  && !(await adm.evaluate(() => document.body.innerText.includes('first-pass-123'))), JSON.stringify({ before, after, said }));
// A step that cannot happen (no card, no sheet) reads as that check's failure,
// never as a crash that hides the checks after it.
const tryStep = async (fn) => { try { return await fn(); } catch { return null; } };
const card = adm.locator('.adv-card', { hasText: 'Marcus Lee' });
await tryStep(() => card.locator('[data-pct]').fill('55', { timeout: 3000 }));
await tryStep(() => card.locator('[data-save-pct]').click({ timeout: 3000 }));
await adm.waitForTimeout(600);
const pctSaid = (await tryStep(() => card.locator('[data-said]').textContent({ timeout: 3000 }))) || '';
await adm.waitForTimeout(1200);
const pctNow = await tryStep(() => adm.locator('.adv-card', { hasText: 'Marcus Lee' }).locator('[data-pct]').inputValue({ timeout: 3000 }));
// NEGATIVE CONTROL (run 2026-10-15): the share button sending `commissionPct: pct / 100` made this read
//   FAIL  he sets their share and it holds
ok('he sets their share and it holds', /55%/.test(pctSaid) && pctNow === '55', JSON.stringify({ pctSaid, pctNow }));
await tryStep(() => adm.locator('.adv-card', { hasText: 'Marcus Lee' }).locator('[data-active="off"]').click({ timeout: 3000 }));
await adm.waitForTimeout(500);
const sheet = await adm.evaluate(() => { const d = document.querySelector('dialog.ask-sheet'); return d ? { title: d.querySelector('h2')?.textContent, danger: !!d.querySelector('.btn.danger') } : null; });
await tryStep(() => adm.click('dialog.ask-sheet button[value="ok"]', { timeout: 3000 }));
await adm.waitForTimeout(2200);
const offNow = (await cards()).find((c) => c.name === 'Marcus Lee');
if (SHOTS) await adm.screenshot({ path: `${SHOTS}/advocates-4-his-tab.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-15): Turn off's ask sheet answered without `danger: off` made this read
//   FAIL  turning one off asks first, in red, and the card reads OFF
ok('turning one off asks first, in red, and the card reads OFF', !!sheet && /Turn off Marcus Lee/.test(sheet.title) && sheet.danger && offNow?.st === 'OFF', JSON.stringify({ sheet, offNow }));
await adm.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await adm.waitForTimeout(2500);
const hisNames = await adm.evaluate(() => [...document.querySelectorAll('#list .folder-name')].map((e) => e.textContent.trim()));
// NEGATIVE CONTROL (run 2026-10-15): staffCasesQuery scoping him to his own advocateId made this read
//   FAIL  his shelf still holds every case, the advocate's client included
ok('his shelf still holds every case, the advocate\'s client included', hisNames.length > 1 && hisNames.some((n) => /Priya/.test(n)), hisNames.join(', '));

console.log('\n--- E. narrow screens ---');
const narrow = { adv: await side('advocate', 320), adm: await side('admin', 320) };
await narrow.adv.goto(`${P}/admin-account.html?demo=advocate`, { waitUntil: 'networkidle' });
await narrow.adv.waitForTimeout(2000);
await narrow.adm.goto(`${P}/admin-advocates.html?demo=admin`, { waitUntil: 'networkidle' });
await narrow.adm.waitForTimeout(2000);
const wide = { setup390: advSideways, account320: await sideways(narrow.adv), advocates320: await sideways(narrow.adm) };
// NEGATIVE CONTROL (run 2026-10-15): `.adv-add input { min-width: 400px }` put in the page's style made this read
//   (first run MISSED: the page clips instead of scrolling, so scrollWidth never moved; now the edges are measured, then re-run)
//   FAIL  at 320px neither page scrolls sideways
ok('at 320px neither page scrolls sideways', Object.values(wide).every((v) => v <= 0), JSON.stringify(wide));
// NEGATIVE CONTROL (run 2026-10-15): a `null.x` put at the top of admin-advocates.js made this read
//   (first run, the throw inside the un-awaited load(), MISSED: a rejected promise is not a page error; the second
//   crashed the drive on the missing card, so the card steps are guarded now, then re-run)
//   FAIL  no page threw
ok('no page threw', !errs.length, JSON.stringify(errs.slice(0, 4)));

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
