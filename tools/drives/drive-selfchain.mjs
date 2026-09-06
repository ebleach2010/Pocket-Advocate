// drive-selfchain.mjs - his own cases in sequence, in a real browser at
// 390px, in the demo.
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-selfchain.mjs
//
// Eric, 2026-09-05: "open more than one case for myself, in sequence. When I
// close one, it confirms the diagnosis that's top of the differential, and
// then opens the new case with that diagnosis and condensed information from
// the previous case... A + -> open new personal cases -> pull information
// from [select other personal cases]." The suite proves the routes and the
// drain; this proves the thumb's path: the card on his case's overview with
// the top of the list already in the box, the walk into the next case, the
// diagnosis carried and the brief landing a few seconds later, then the
// shelf with both cases under MY OWN CASE, the door that is always there,
// and a third case opened from it with the first one ticked.
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
const until = async (fn, tries = 24, ms = 500) => {
  let v = null;
  for (let i = 0; i < tries; i++) { v = await page.evaluate(fn); if (v) return v; await page.waitForTimeout(ms); }
  return v;
};
const overview = () => page.evaluate(() => { document.querySelector('[data-group="case"]')?.click(); document.querySelector('[data-page="overview"]')?.click(); });

console.log('\n--- A. the first case, from the door ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); localStorage.removeItem('pa-demo-store-advocate'); });
await page.reload({ waitUntil: 'networkidle' });
await settle(page);
ok('with no case of his own the door reads plainly', (await page.textContent('[data-open-door="self"]') || '').trim() === 'Open a case for myself');
await page.click('[data-open-door="self"]');
await page.waitForTimeout(300);
ok('and with no earlier case there is nothing to pull from', !(await page.$('[data-open-form="self"] .pull-from')));
await page.fill('[data-of="self:firstName"]', 'Eric');
await page.fill('[data-of="self:lastName"]', 'Bleach');
await page.fill('[data-of="self:dob"]', '1985-02-03');
await page.click('[data-open-go="self"]');
await page.waitForURL(/admin-case(\.html)?\?id=/, { timeout: 15000 });
await settle(page, 2000);
const firstId = new URL(page.url()).searchParams.get('id');
ok('the door opens a case page', !!firstId, firstId);

console.log('\n--- B. the close-and-continue card ---');
await overview();
await page.waitForTimeout(600);
const card = await until(() => {
  const dx = document.querySelector('[data-self-dx]');
  return dx && dx.value ? {
    title: (document.querySelector('.self-next-h')?.textContent || '').trim(),
    dx: dx.value,
    go: !!document.querySelector('[data-self-next-go]'),
    just: !!document.querySelector('[data-self-close]'),
    carried: !!document.querySelector('[data-carried]'),
  } : null;
});
ok('the overview carries the card, with the top of the list already in the box', !!card && card.title === 'Close this case and open the next' && card.dx === 'Autoimmune encephalitis, relapse' && card.go && card.just, JSON.stringify(card));
ok('and nothing carried over yet on a first case', !!card && !card.carried);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/01-close-card.png` });

console.log('\n--- C. into the next case ---');
await page.click('[data-self-next-go]');
// By the id itself, not by substring: the demo names the next case with the
// first one's id as a prefix.
const idOf = (u) => new URL(u.toString()).searchParams.get('id');
await page.waitForURL((u) => /admin-case(\.html)?\?id=/.test(u.toString()) && idOf(u) && idOf(u) !== firstId, { timeout: 15000 });
await settle(page, 2000);
const secondId = new URL(page.url()).searchParams.get('id');
ok('the page walks into a new case', !!secondId && secondId !== firstId, secondId);
await overview();
const carried = await until(() => {
  const c = document.querySelector('[data-carried]');
  return c ? (c.textContent || '').replace(/\s+/g, ' ').trim() : null;
});
ok('CONFIRMED SO FAR names the diagnosis it confirmed at close, with its number', /CONFIRMED SO FAR/.test(carried || '') && /Autoimmune encephalitis, relapse/.test(carried || '') && /55%/.test(carried || ''), carried);
const wait = await until(() => { const h = document.querySelector('[data-handovers]'); return h && /Condensing|From the case/.test(h.textContent) ? h.textContent.replace(/\s+/g, ' ').trim() : null; });
ok('CARRIED OVER says the brief is being written, or has it already', /Condensing your earlier case|From the case opened/.test(wait || ''), (wait || '').slice(0, 80));
// The brief rides the panel's poll, which idles at twelve seconds, so the
// wait here is generous: the demo writes it a few seconds in, the next poll
// carries it.
const brief = await until(() => {
  const d = document.querySelector('details.handover');
  if (!d) return null;
  d.open = true;
  return { summary: (d.querySelector('summary')?.textContent || '').replace(/\s+/g, ' ').trim(), heads: [...d.querySelectorAll('.handover-brief h4')].map((h) => h.textContent.trim()) };
}, 80, 500);
ok('the brief lands, from the case it came from, with the diagnosis confirmed on it', !!brief && /From the case opened/.test(brief.summary) && /confirmed Autoimmune encephalitis, relapse/.test(brief.summary), brief?.summary);
ok('and reads as a brief: confirmed at close, timeline, medications, tests, treatments, ruled out, still open, causes and treatments', !!brief && ['Confirmed at close', 'Timeline', 'Medications', 'Tests and results', 'Treatments tried', 'Ruled out', 'Still open'].every((h) => brief.heads.includes(h)), (brief?.heads || []).join(' | '));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/02-next-case-overview.png`, fullPage: true });

console.log('\n--- D. the shelf, and a third case from the door with a pick ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(page);
const shelf = await page.evaluate(() => {
  const h = [...document.querySelectorAll('h2')].find((x) => /MY OWN CASE/.test(x.textContent));
  const sec = h?.closest('section') || h?.parentElement;
  return {
    section: !!h,
    text: (sec?.textContent || '').replace(/\s+/g, ' ').trim(),
    door: (document.querySelector('[data-open-door="self"]')?.textContent || '').trim(),
  };
});
ok('MY OWN CASE lists the open case and the closed one with what was confirmed', shelf.section && /closed/.test(shelf.text) && /confirmed Autoimmune encephalitis, relapse/.test(shelf.text), shelf.text.slice(0, 160));
ok('and the door is always there, as a plus', shelf.door === '+ Open another case for myself', shelf.door);
await page.click('[data-open-door="self"]');
await page.waitForTimeout(300);
const picker = await page.evaluate(() => ({
  legend: (document.querySelector('[data-open-form="self"] .pull-from legend')?.textContent || '').trim(),
  rows: [...document.querySelectorAll('[data-open-form="self"] [data-pull]')].map((i) => ({ id: i.dataset.pull, label: (i.parentElement?.textContent || '').replace(/\s+/g, ' ').trim() })),
}));
ok('the form offers every personal case to pull from, each with its state', picker.legend === 'Pull information from' && picker.rows.length === 2 && picker.rows.some((r) => /closed, confirmed Autoimmune encephalitis, relapse/.test(r.label)) && picker.rows.some((r) => /open/.test(r.label)), JSON.stringify(picker.rows));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/03-door-picker.png` });
await page.check(`[data-open-form="self"] [data-pull="${firstId}"]`);
await page.click('[data-open-go="self"]');
await page.waitForURL((u) => /admin-case(\.html)?\?id=/.test(u.toString()) && idOf(u) && ![firstId, secondId].includes(idOf(u)), { timeout: 15000 });
await settle(page, 2000);
const thirdId = new URL(page.url()).searchParams.get('id');
ok('a blank form with a pick opens a third case, named from the case it pulls from', !!thirdId, thirdId);
await overview();
const third = await until(() => {
  const c = document.querySelector('[data-carried]');
  const who = [...document.querySelectorAll('.fact-k')].find((k) => k.textContent.trim() === 'WHO');
  return c ? { carried: (c.textContent || '').replace(/\s+/g, ' ').trim(), who: (who?.nextElementSibling?.textContent || '').replace(/\s+/g, ' ').trim() } : null;
});
ok('it carries the confirmed diagnosis and his name from the case it pulled from', !!third && /Autoimmune encephalitis, relapse/.test(third.carried) && /Eric Bleach/.test(third.who), JSON.stringify(third));
const third2 = await until(() => { const d = document.querySelector('details.handover'); return d ? (d.querySelector('summary')?.textContent || '').replace(/\s+/g, ' ').trim() : null; }, 80, 500);
ok('and its brief arrives from the first case', /From the case opened/.test(third2 || ''), third2);

await b.close();
console.log(`\n${pass} ok, ${fail} failed${errs.length ? `\n${errs.join('\n')}` : ''}`);
if (fail || errs.length) process.exit(1);
