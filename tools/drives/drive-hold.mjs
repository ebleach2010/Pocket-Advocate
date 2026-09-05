// drive-hold.mjs - pausing a case with a note for the client, in a real
// browser at 390px, in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-hold.mjs
//
// Eric, 2026-09-03: "I would like to have a spot to put a pause reason for
// the client and they get a notification with the reason for pausing." The
// suite runs the route; this proves the thumb's path: the spot on the Pause
// or close card, the pause, his note echoed back to him, and the client's own
// page opening on the note word for word.
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
const NOTE = 'I am out for a procedure until Monday. Nothing on your case runs down while I am away.';

console.log('\n--- A. the spot on the card ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
const firstCase = await page.evaluate(() => document.querySelector('a[href*="admin-case"]')?.getAttribute('href') || '');
ok('the shelf has a case to open', !!firstCase, firstCase);
await page.goto(`${P}${firstCase}${firstCase.includes('?') ? '&' : '?'}demo=admin`, { waitUntil: 'networkidle' });
await settle(page, 2000);
const caseId = new URL(page.url()).searchParams.get('id');
await page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); });
await page.waitForTimeout(600);
const card = await page.evaluate(() => {
  const d = document.querySelector('details[data-k="hold"]');
  if (!d) return null;
  d.open = true;
  const note = d.querySelector('[data-hold-note]');
  const why = d.querySelector('[data-hold-why]');
  const label = note?.closest('label')?.textContent.replace(/\s+/g, ' ').trim() || '';
  return { note: !!note, why: !!why, label, order: note && why ? note.compareDocumentPosition(why) & Node.DOCUMENT_POSITION_FOLLOWING : 0, dash: /[—–]/.test(d.textContent) };
});
ok('the Pause or close card has the spot for the client, above his private one, and says they read it and get a notification',
  !!card && card.note && card.why && card.order > 0 && /they read this word for word, and it comes to them as a notification/.test(card.label), card?.label.slice(0, 80));
ok('and the card carries no dash anywhere a person reads', !!card && !card.dash);
await page.fill('[data-hold-note]', NOTE);
await page.fill('[data-hold-why]', 'migraine week');
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-pause-form.png` });

console.log('\n--- B. pausing ---');
await page.click('[data-hold-on]');
let paused = null;
for (let i = 0; i < 16 && !paused; i++) {
  await page.waitForTimeout(500);
  paused = await page.evaluate(() => {
    const d = document.querySelector('details[data-k="hold"]');
    const s = (d?.querySelector('summary')?.textContent || '').trim();
    if (!/Paused$/.test(s)) return null;
    d.open = true;
    return { summary: s, body: (d.querySelector('.mgmt-body')?.textContent || '').replace(/\s+/g, ' ') };
  });
}
ok('the card flips to Paused and echoes his note to them', !!paused && paused.body.includes('Your note to them:') && paused.body.includes('out for a procedure'), paused?.summary);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-paused.png` });

console.log('\n--- C. the client\'s page ---');
await ctx.addCookies([{ name: 'pa_demo', value: 'client', domain: '127.0.0.1', path: '/' }]);
await page.goto(`${P}/case.html?id=${encodeURIComponent(caseId)}&demo=1`, { waitUntil: 'networkidle' });
await settle(page, 2000);
const theirs = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h3')].find((x) => /Your case is paused/.test(x.textContent));
  const panel = h?.closest('.panel');
  const text = (panel?.textContent || '').replace(/\s+/g, ' ').trim();
  return { found: !!panel, text, first: (panel?.querySelector('p')?.textContent || '').replace(/\s+/g, ' ').trim(), reason: /migraine/.test(document.body.textContent) };
});
ok('their page opens on the paused notice with his note word for word, first', theirs.found && theirs.first.startsWith('From Eric: ' + NOTE), theirs.first.slice(0, 80));
ok('and nothing of his private reason is on their page', theirs.found && !theirs.reason);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-client-paused.png` });

await b.close();
console.log(`\n${pass} ok, ${fail} failed${errs.length ? '\n' + errs.join('\n') : ''}`);
process.exit(fail || errs.length ? 1 : 0);
