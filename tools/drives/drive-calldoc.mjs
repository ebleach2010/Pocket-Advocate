// The call document tab, driven end to end. Eric, 2026-08-26.
import { chromium } from 'playwright';
// PA_PORT overrides the default, so a drive can be pointed at a server
// serving THIS tree. A shared 8795 that another session has repointed at a
// frozen checkout is how a drive reports on code that is not the code.
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
let pass=0, fail=0; const errs=[];
const ok=(n,c,d='')=>{ if(c){pass++;console.log('  ok   ',n,d?`— ${d}`:'');} else {fail++;console.log('  FAIL ',n,d?`— ${d}`:'');} };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport:{width:1280,height:900} });
await ctx.addCookies([{name:'pa_demo',value:'1',domain:'127.0.0.1',path:'/'}]);
const page = await ctx.newPage();
page.on('pageerror', e => errs.push(e.message));
await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, {waitUntil:'networkidle'});
await page.waitForTimeout(3500);

const tabs = await page.evaluate(() => [...document.querySelectorAll('.folder-tabs .ftab')].map(t=>t.dataset.page));
ok('there is a Call doc tab', tabs.includes('calldoc'), tabs.join(' '));
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="calldoc"]')?.click());
await page.waitForTimeout(1500);

const start = await page.evaluate(() => {
  const h=document.querySelector('[data-calldoc-host]');
  return { mounted: !!h?.querySelector('[data-cd-root]'),
    hasUpload: !!h?.querySelector('[data-cd-files]'),
    hasBuild: !!h?.querySelector('[data-cd-build]'),
    explains: /spine/.test(h?.textContent||''),
    starExplained: /worth checking/.test(h?.textContent||'') };
});
ok('the panel mounts', start.mounted, JSON.stringify(start));
ok('it offers an upload', start.hasUpload);
ok('and a build button', start.hasBuild);
ok('it says his document stays the spine', start.explains);
ok('and explains the asterisk before he uses it', start.starExplained);

console.log('\n--- building with nothing chosen ---');
await page.evaluate(() => document.querySelector('[data-cd-build]')?.click());
await page.waitForTimeout(600);
ok('it refuses and says what to do', await page.evaluate(() => {
  const e=document.querySelector('[data-cd-err]');
  return !!e && !e.hidden && /Choose your document first/.test(e.textContent);
}));

console.log('\n--- choose a document and build ---');
await page.setInputFiles('[data-cd-files]', {
  name:'prep-notes.pdf', mimeType:'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>'),
});
await page.waitForTimeout(700);
ok('the chosen file shows before he commits', await page.evaluate(() =>
  /prep-notes\.pdf/.test(document.querySelector('[data-calldoc-host]')?.textContent||'')));
await page.evaluate(() => document.querySelector('[data-cd-build]')?.click());
// The panel repaints off the advisor's state poll, which ticks every 2.5s
// when busy. Wait for the document rather than for a stopwatch: a fixed
// 3.5s beat the poll and reported a working feature as broken.
await page.waitForFunction(() => !!document.querySelector('[data-cd-text]'), null, { timeout: 25000 })
  .catch(() => {});
await page.waitForTimeout(600);

const built = await page.evaluate(() => {
  const h=document.querySelector('[data-calldoc-host]');
  const t=h?.querySelector('[data-cd-text]')?.value || '';
  return { text:t, chrome:h?.textContent||'' };
});
ok('a document comes back', built.text.length > 200, `${built.text.length} chars`);
for (const [n,re] of [
  ['the flagged lines are gathered at the top', /^REVIEW BEFORE YOU CALL/],
  ['his document is reformatted into call order', /THE CALL, IN ORDER/],
  ['missing questions are named', /QUESTIONS THAT ARE MISSING/],
  ['the case adds what his document lacks', /FROM THE CASE, NOT IN YOUR DOCUMENT/],
  ['and every claim is sourced', /SOURCES/],
]) ok(n, re.test(built.text));
ok('things to check are starred', (built.text.match(/\*/g)||[]).length >= 3,
  `${(built.text.match(/\*/g)||[]).length} asterisks`);
// EXPECTATION UPDATED 2026-08-26, and made stricter. This used to accept any
// "N lines flagged with *", which the panel produced by counting every line
// containing an asterisk. Every flag appears TWICE by design - gathered in
// REVIEW BEFORE YOU CALL and marked in place - so the number came out roughly
// double: the shipped fixture has 3 real concerns and the panel said 5. The
// count now comes from the numbered list in REVIEW, and this pins the VALUE
// rather than the wording, so an off-by-double cannot pass again.
const flagged = (built.chrome.match(/(\d+) things? to check/) || [])[1];
ok('and the count is shown before he opens it', !!flagged,
  flagged ? `${flagged} to check` : 'no count');
ok('and it counts real concerns, not doubled lines', flagged === '3',
  `panel says ${flagged}; the fixture carries 3 numbered flags`);
ok('it says which document it was built from', /Built from: prep-notes\.pdf/.test(built.chrome));
ok('the document is editable by hand', await page.evaluate(() =>
  document.querySelector('[data-cd-text]')?.tagName === 'TEXTAREA'));

// --- THE DOCUMENT MUST SURVIVE A REBUILD -----------------------------------
// He has a good sheet and ninety seconds before the call. Tapping "Build a
// new one" used to remove it from the page for the whole multi-minute run,
// because one flag gated both the controls and the text. This is the case
// that could not be driven at all until the demo learned to pass through
// 'running' - it used to jump straight to 'ready'.
console.log('\n--- a rebuild must not take away the sheet he is reading ---');
const before = await page.evaluate(() => document.querySelector('[data-cd-text]')?.value || '');
ok('he has a document to start with', before.length > 200, `${before.length} chars`);
// Choose again, because a build now requires a pick - which is the other half
// of this fix: with no picker on screen, "Build a new one" used to post an
// EMPTY source list and spend a max-effort turn inventing a replacement.
await page.setInputFiles('[data-cd-files]', {
  name: 'prep-notes-v2.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 second draft'),
});
await page.waitForTimeout(400);
await page.evaluate(() => document.querySelector('[data-cd-build]')?.click());
await page.waitForTimeout(3000); // mid-run: past one poll, before the demo's beat lands
const during = await page.evaluate(() => {
  const ta = document.querySelector('[data-cd-text]');
  const b = document.querySelector('[data-cd-build]');
  return { text: ta?.value || '', readonly: !!ta?.readOnly, label: (b?.textContent || '').trim() };
});
ok('the build is actually running', /Building|Reading/.test(during.label), during.label);
ok('and his current document is STILL on the page', during.text.length > 200,
  `${during.text.length} chars while building`);
ok('shown read-only, so a stray keystroke cannot edit it mid-call', during.readonly);
await page.waitForFunction(() => !/Building|Reading/.test(
  document.querySelector('[data-cd-build]')?.textContent || ''), null, { timeout: 20000 });
await page.waitForTimeout(500);
ok('and the new one replaces it when it lands', await page.evaluate(() =>
  (document.querySelector('[data-cd-text]')?.value || '').length > 200));

console.log('\n--- revise, and discard ---');
ok('revise opens an overlay, not a prompt()', await page.evaluate(async () => {
  document.querySelector('[data-cd-revise]')?.click();
  await new Promise(r=>setTimeout(r,400));
  return !!document.getElementById('pa-cd-revise');
}));
await page.evaluate(() => document.querySelector('#pa-cd-revise [data-x]')?.click());
await page.waitForTimeout(300);
ok('discard is offered', await page.evaluate(() => !!document.querySelector('[data-cd-discard]')));

console.log('\n--- and a client can never see it ---');
const client = await ctx.newPage();
await client.goto(`${P}/case.html?demo=1`, {waitUntil:'networkidle'});
await client.waitForTimeout(3000);
const leak = await client.evaluate(() => {
  const t=document.body.innerText;
  return { calldoc: /REVIEW BEFORE YOU CALL|QUESTIONS THAT ARE MISSING/.test(t),
    tab: !!document.querySelector('[data-page="calldoc"]') };
});
ok('the client page shows no call document', !leak.calldoc);
ok('and has no Call doc tab', !leak.tab);

console.log(`\n${pass} ok, ${fail} FAIL`);
if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
await b.close();
process.exit(fail||errs.length ? 1 : 0);
