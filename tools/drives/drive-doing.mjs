// The doing line, driven in the demo at 390px:
//  A. his side: start the clock on a case, the presets appear under it, tap one.
//  B. the client's side: the chat header and the progress line read it.
//  C. stop the clock: the line is gone on both sides.
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
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' — ' + d : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' — ' + d : ''}`)); };
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
const caseId = await page.evaluate(() => (document.querySelector('a[href*="admin-case.html?id="]')?.getAttribute('href') || '').replace(/.*id=/, '').replace(/&.*/, ''));

console.log('\n--- A. his side ---');
await page.goto(`${P}/admin-case.html?id=${caseId}`, { waitUntil: 'networkidle' });
await settle(page);
ok('the row is folded while the clock is stopped', await page.evaluate(() => document.querySelector('[data-doing-row]')?.hidden === true));
await page.click('[data-work-head]');
await settle(page, 900);
const pills = await page.evaluate(() => ({
  shown: document.querySelector('[data-doing-row]')?.hidden === false,
  labels: [...document.querySelectorAll('[data-doing-pills] [data-doing]')].map((b) => b.dataset.doing),
}));
ok('starting the clock unfolds six presets', pills.shown && pills.labels.length === 6 && pills.labels[0] === 'on the phone with a clinic department', pills.labels.join(' | '));
await page.click('[data-doing-pills] [data-doing="on the phone with a clinic department"]');
await settle(page, 700);
ok('the tapped preset lights up', await page.evaluate(() => document.querySelector('[data-doing-pills] [data-doing="on the phone with a clinic department"]')?.classList.contains('on')));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-admin-doing.png` });

console.log('\n--- B. the client reads it ---');
const client = await ctx.newPage();
await client.goto(`${P}/case.html?id=${caseId}&demo=1`, { waitUntil: 'networkidle' });
await settle(client, 2000);
const seen = await client.evaluate(() => ({
  chat: document.querySelector('[data-doing]')?.textContent.trim() || '',
  hours: /on the phone with a clinic department right now/.test(document.body.textContent),
}));
ok('the chat header says what he is doing', seen.chat === 'Eric is on the phone with a clinic department right now.', seen.chat);
ok('the hours line says it too', seen.hours);
if (SHOTS) await client.screenshot({ path: `${SHOTS}/02-client-doing.png` });

console.log('\n--- C. stop ---');
await page.click('[data-work-head]');
await settle(page, 900);
ok('his row folds on stop', await page.evaluate(() => document.querySelector('[data-doing-row]')?.hidden === true));
await client.reload({ waitUntil: 'networkidle' });
await settle(client, 2000);
const after = await client.evaluate(() => ({
  line: !!document.querySelector('[data-doing]'),
  phrase: /on the phone with a clinic department/.test(document.body.textContent),
  working: /working on it right now/.test(document.body.textContent),
}));
ok('the client\'s line is gone, and so is the bare "working on it"', !after.line && !after.phrase && !after.working, JSON.stringify(after));
await client.close();

console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
await b.close();
process.exit(fail || errs.length ? 1 : 0);
