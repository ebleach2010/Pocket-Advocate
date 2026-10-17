// drive-delete.mjs - the showcase door and Delete, in a real browser at
// 390px, in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-delete.mjs
//
// Eric, 2026-09-06: "Create a completely fake case for me to show off on
// YouTube... For personal cases, let me be able to delete it, next to the
// pause/close buttons." The suite proves the builder, the wipe and the
// routes; this proves the thumb's path: the door on the shelf, Joe Bloe's
// case with the showcase mark, Delete under Pause or close, the confirm, the
// shelf without him and the door back; then his own case deleted from its
// own card the same way.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
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
const idOf = (u) => new URL(u.toString()).searchParams.get('id');

console.log('\n--- A. the door builds Joe Bloe ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
// RE-PINNED 2026-10-15 (v7.41): Eric, "a + at the top of my 'all cases' screen and then a drop down that says
// 'showcase'". The door is the + menu's first item, and it is always there: it builds him or walks into him.
// RE-PINNED 2026-10-16 (v7.60): the door is gone (Eric, "Remove both": Demo mode replaces Joe Bloe). He is built
// through the route the door used, so the delete below still has a case with nobody behind it.
// NEGATIVE CONTROL (run 2026-10-16, v7.60): the Showcase door put back in admin.html's + menu made this read
//   FAIL  the + offers no showcase door
await page.click('[data-add-open]');
ok('the + offers no showcase door', !(await page.$('[data-showcase-door]')) && !!(await page.$('[data-open-door="self"]')));
await page.keyboard.press('Escape');
await page.evaluate(() => fetch('/api/admin/showcase-case', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
await page.goto(`${P}/admin-case.html?id=demo-case-showcase&demo=admin`, { waitUntil: 'networkidle' });
await settle(page, 2000);
const showId = idOf(page.url());
ok('and walks into his case', showId === 'demo-case-showcase', showId);
const head = await page.evaluate(() => ({
  name: (document.querySelector('[data-client]')?.textContent || '').trim(),
  chat: document.querySelectorAll('.msg').length,
}));
ok('the case is Joe Bloe, with a chat on it', /Joe Bloe/.test(head.name), JSON.stringify(head));

console.log('\n--- B. Delete, under Pause or close ---');
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); });
await page.waitForTimeout(600);
const card = await page.evaluate(() => {
  const d = document.querySelector('details[data-k="hold"]');
  if (!d) return null;
  d.open = true;
  return {
    summary: (d.querySelector('summary')?.textContent || '').trim(),
    pause: !!d.querySelector('[data-hold-on]'),
    close: !!d.querySelector('[data-close-case]'),
    del: (d.querySelector('[data-delete-case]')?.textContent || '').trim(),
    note: (d.textContent || '').replace(/\s+/g, ' '),
  };
});
// RE-PINNED 2026-10-16 (v7.60): the note says the case is invented end to end; there is no door to rebuild it from.
// NEGATIVE CONTROL (run 2026-10-16, v7.60): the note's 'This case is invented from end to end' changed to 'Invented.' made this read
//   FAIL  the Pause or close card carries Pause, Close and Delete, and says what this case is
ok('the Pause or close card carries Pause, Close and Delete, and says what this case is', !!card && card.pause && card.close && card.del === 'Delete this case' && /This case is invented from end to end/.test(card.note), JSON.stringify(card && { pause: card.pause, close: card.close, del: card.del }));
if (SHOTS) { await page.evaluate(() => document.querySelector('details[data-k="hold"]')?.scrollIntoView()); await page.screenshot({ path: `${SHOTS}/01-delete-card.png` }); }
await page.click('[data-delete-case]');
// RE-PINNED 2026-10-15 (v7.41): Delete asks in the app's own sheet now, not the browser's confirm().
await page.click('dialog.ask-sheet button[value="ok"]');
await page.waitForURL(/admin(\.html)?(\?|$)/, { timeout: 15000 });
await settle(page);
const after = await page.evaluate((id) => ({
  door: (document.querySelector('[data-showcase-door]')?.textContent || '').trim(),
  // His folder, not his name: the door itself names him.
  listed: [...document.querySelectorAll('a[href*="admin-case"]')].some((a) => a.href.includes(`id=${id}`)),
}), showId);
// RE-PINNED 2026-10-16 (v7.60): no door to build him again.
// NEGATIVE CONTROL (run 2026-10-16, v7.60): the Showcase door put back in admin.html's + menu made this read
//   FAIL  the shelf comes back without him, and no door builds him again
ok('the shelf comes back without him, and no door builds him again', after.door === '' && !after.listed, JSON.stringify(after));

console.log('\n--- C. his own case, deleted from its own card ---');
await page.click('[data-add-open]');
await page.click('[data-open-door="self"]');
await page.waitForTimeout(300);
await page.fill('[data-of="self:firstName"]', 'Eric');
await page.fill('[data-of="self:lastName"]', 'Leach');
await page.click('[data-open-go="self"]');
await page.waitForURL((u) => /admin-case(\.html)?\?id=/.test(u.toString()), { timeout: 15000 });
await settle(page, 2000);
const ownId = idOf(page.url());
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); });
await page.waitForTimeout(600);
// RE-PINNED 2026-10-15 (v7.41): Eric, "let me delete my own cases". Delete is the first thing on his own
// case's Overview now, open or closed; the close buttons stay where they were.
const ownCard = await page.evaluate(() => ({
  del: (document.querySelector('.self-del-row [data-delete-case]')?.textContent || '').trim(),
  first: document.querySelector('[data-page-body="overview"], .fpage[data-page="overview"]')?.querySelector('[data-delete-case]') === document.querySelector('[data-delete-case]'),
  count: document.querySelectorAll('[data-delete-case]').length,
  next: !!document.querySelector('[data-self-next-go]'),
  just: !!document.querySelector('[data-self-close]'),
}));
ok('his own case carries Delete at the top of its Overview, once, and the close buttons stay', ownCard.del === 'Delete this case' && ownCard.count === 1 && ownCard.next && ownCard.just, JSON.stringify(ownCard));
await page.click('.self-del-row [data-delete-case]');
await page.click('dialog.ask-sheet button[value="ok"]');
await page.waitForURL(/admin(\.html)?(\?|$)/, { timeout: 15000 });
await settle(page);
const ownAfter = await page.evaluate((id) => ({
  gone: ![...document.querySelectorAll('a[href*="admin-case"]')].some((a) => a.href.includes(`id=${id}`)),
  door: (document.querySelector('[data-open-door="self"]')?.textContent || '').trim(),
}), ownId);
ok('and the shelf no longer lists it', ownAfter.gone && ownAfter.door === 'My own case', JSON.stringify(ownAfter));

await b.close();
console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
if (fail || errs.length) process.exit(1);
