// drive-contact.mjs - the CONTACT row on the overview card, the pencil on a
// work log entry, and the booking form that now asks for the number, in a
// real browser at 390px, in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-contact.mjs
//
// Eric, 2026-09-03: "patient's home address and telephone number should be
// visible on this screen by the rest of his info" and "Edit pencil top right
// of each log. I misspelled his name, for example, so need to edit to fix
// that." The suites prove the route and the markup; this proves what a thumb
// meets: the row is on the card, the number is a call, the Edit saves and the
// links change with no reload, the pencil is where he said, and a tap on it
// opens the entry rather than folding it.
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

await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
const caseIds = await page.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="admin-case.html?id="]')]
  .map((a) => (a.getAttribute('href') || '').replace(/.*id=/, '').replace(/&.*/, '')).filter(Boolean))]);
ok('the dashboard lists the demo cases', caseIds.length > 0, caseIds.join(', '));

console.log('\n--- A. the card ---');
// The page remembers the last tab, and every pane is built at mount and
// merely hidden, so the card is reached the way he reaches it: the group,
// then the page. Without this the button resolves and cannot be tapped.
const toOverview = async () => {
  await page.evaluate(() => {
    document.querySelector('[data-group="case"]')?.click();
    document.querySelector('[data-page="overview"]')?.click();
  });
  await page.waitForTimeout(500);
};
await page.goto(`${P}/admin-case.html?id=${caseIds[0]}`, { waitUntil: 'networkidle' });
await settle(page);
await toOverview();
const card = () => page.evaluate(() => {
  const ks = [...document.querySelectorAll('.fact-k')];
  const k = ks.find((x) => (x.textContent || '').trim() === 'CONTACT');
  const v = k?.nextElementSibling;
  const tel = v?.querySelector('a[data-contact-phone]');
  const map = v?.querySelector('a[data-contact-address]');
  const edit = v?.querySelector('[data-contact-edit]');
  return {
    found: !!k,
    underClient: !!k && ks.findIndex((x) => (x.textContent || '').trim() === 'CLIENT') === ks.indexOf(k) - 1,
    tel: tel?.getAttribute('href') || '', telText: (tel?.textContent || '').trim(),
    map: map?.getAttribute('href') || '', mapText: (map?.textContent || '').trim(),
    formHidden: v?.querySelector('[data-contact-form]')?.hidden,
    editH: Math.round(edit?.getBoundingClientRect().height || 0),
  };
});
const c0 = await card();
ok('the CONTACT row is on the card, right under CLIENT', c0.found && c0.underClient);
ok('the number is a tap-to-call link', c0.tel === 'tel:+12085550142' && /555 0142/.test(c0.telText), c0.tel);
ok('the address opens in Maps', /^https:\/\/maps\.apple\.com\/\?q=/.test(c0.map) && /Hawthorne/.test(c0.mapText), c0.mapText);
ok('the edit form is folded until asked', c0.formHidden === true);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-card.png` });
await page.click('[data-contact-edit]');
await page.waitForTimeout(300);
ok('Edit unfolds the two inputs', (await card()).formHidden === false);
await page.fill('[data-contact-in="phone"]', '+1 208 555 0199');
await page.fill('[data-contact-in="address"]', 'Apt 2, 418 Hawthorne Ave, Boise, ID 83702');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-card-edit.png` });
await page.click('[data-contact-save]');
await page.waitForTimeout(1500);
const said = await page.evaluate(() => (document.querySelector('[data-contact-said]')?.textContent || '').trim());
ok('Save says so, on the card', /^Saved\./.test(said), said);
const c1 = await card();
ok('the links changed with no reload', c1.tel === 'tel:+12085550199' && /Apt 2/.test(c1.mapText), `${c1.tel} | ${c1.mapText}`);
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
await toOverview();
const c2 = await card();
ok('and they are still there after a reload', c2.tel === 'tel:+12085550199' && /Apt 2/.test(c2.mapText), `${c2.tel} | ${c2.mapText}`);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-card-saved.png` });

console.log('\n--- B. the pencil ---');
// The seeded log lives on whichever demo case carries clinic calls; walk the
// cases until a pencil turns up.
let pen = null;
for (const id of caseIds) {
  await page.goto(`${P}/admin-case.html?id=${id}`, { waitUntil: 'networkidle' });
  await settle(page);
  await page.evaluate(() => { document.querySelector('[data-group="act"]')?.click(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { document.querySelector('[data-page="log"]')?.click(); });
  await settle(page, 1200);
  pen = await page.evaluate(() => {
    // The log shows one day and keeps the others behind it, so the first
    // pencil in the DOM can sit on a hidden day page. Take one that is
    // actually laid out, the way a thumb would find it.
    const btn = [...document.querySelectorAll('[data-call-edit]')].find((x) => x.offsetParent !== null);
    if (!btn) return null;
    const row = btn.closest('.log-row');
    const r = btn.getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    const pill = row.querySelector('.kind-pill')?.getBoundingClientRect();
    return {
      id: btn.dataset.callEdit,
      fromRight: Math.round(rr.right - r.right),
      sameLine: pill ? Math.abs(pill.top - r.top) < 14 : false,
      h: Math.round(r.height),
      visible: !!btn.closest('.fpage') && btn.closest('.fpage').hidden === false,
    };
  });
  if (pen) break;
}
ok('an entry wears a pencil, on the page he is looking at', !!pen && pen.visible);
ok('top right: on the first line, at the right edge', !!pen && pen.sameLine && pen.fromRight <= 8, pen ? `${pen.fromRight}px from the edge, same line ${pen.sameLine}` : 'no pencil');
ok('a thumb can hit it', !!pen && pen.h >= 32, pen ? `${pen.h}px` : '');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/04-log.png` });
if (pen) {
  await page.click(`[data-call-edit="${pen.id}"]`);
  await page.waitForTimeout(400);
  const opened = await page.evaluate((id) => {
    const f = document.querySelector(`[data-call-edit-form="${id}"]`);
    return { open: f?.closest('details')?.open, hidden: f?.hidden, who: f?.querySelector('[data-e="clinic"]')?.value || '' };
  }, pen.id);
  ok('the tap opens the entry and unfolds the form, prefilled', opened.open === true && opened.hidden === false && opened.who.length > 0, opened.who);
  await page.fill(`[data-call-edit-form="${pen.id}"] [data-e="clinic"]`, 'Valley Neurology, spelled right');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/05-log-edit.png` });
  await page.click(`[data-call-edit-save="${pen.id}"]`);
  await settle(page, 1500);
  const after = await page.evaluate((id) => (document.querySelector(`[data-k="call-${id}"] .log-row-t`)?.textContent || '').trim(), pen.id);
  ok('the row reads the correction', /Valley Neurology, spelled right/.test(after), after);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/06-log-saved.png` });
}

console.log('\n--- C. the booking form ---');
const client = await ctx.newPage();
client.on('pageerror', (e) => errs.push('PAGEERROR ' + String(e).slice(0, 300)));
await client.goto(`${P}/book.html?demo=1`, { waitUntil: 'networkidle' });
await client.waitForTimeout(2500);
const slot = client.locator('#step button').filter({ hasText: /AM|PM/ }).first();
if (await slot.count()) { await slot.click(); await client.waitForTimeout(1200); }
await client.evaluate(() => {
  const v = document.querySelector('input[name=method][value=video]');
  if (v) { v.checked = true; v.dispatchEvent(new Event('change', { bubbles: true })); }
});
await client.waitForTimeout(300);
const form = await client.evaluate(() => ({
  video: document.querySelector('input[name=method][value=video]')?.checked === true,
  phoneShown: !!document.querySelector('#phone-row') && !document.querySelector('#phone-row').hidden,
  label: (document.querySelector('label[for="phone"]')?.textContent || '').trim(),
  address: !!document.querySelector('#address'),
  addrLabel: (document.querySelector('label[for="address"]')?.textContent || '').replace(/\s+/g, ' ').trim(),
}));
ok('a video booking still asks for the number', form.video && form.phoneShown && /Best number to reach you/.test(form.label), form.label);
ok('and offers the address line, marked optional', form.address && /Home address \(optional\)/.test(form.addrLabel), form.addrLabel);
if (SHOTS) await client.screenshot({ path: `${SHOTS}/07-booking.png` });
await client.close();

console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
