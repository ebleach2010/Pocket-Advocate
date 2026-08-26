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

// --- ERIC'S PRIVATE SHELF --------------------------------------------------
// Eric, 2026-08-26: "I can't just upload my precall document for him to see.
// There needs to be an uploads section under Mine that only me and the
// advisor see." cases/{id}/prep/ is that shelf, and it is client-denied by a
// storage rule that already existed - the one whose own comment says "one
// manual upload of working notes or a prep sheet into that prefix and it
// would be on their screen".
console.log('\n--- his own shelf ---');
const shelf0 = await page.evaluate(() => ({
  block: !!document.querySelector('[data-cd-prep]'),
  add: !!document.querySelector('[data-prep-add]'),
  says: /between you and the advisor/.test(
    (document.querySelector('[data-cd-prep]')?.textContent || '').replace(/\s+/g, ' ')),
}));
ok('the shelf is on the Call doc page', shelf0.block, JSON.stringify(shelf0));
ok('with a way to add to it', shelf0.add);
ok('and it says plainly that the client cannot see it', shelf0.says);

await page.setInputFiles('[data-prep-add]', {
  name: 'my-precall-sheet.pdf', mimeType: 'application/pdf',
  buffer: Buffer.from('%PDF-1.4 Eric private prep sheet'),
});
await page.waitForFunction(() => [...document.querySelectorAll('[data-prep-file]')]
  .some((c) => /my-precall-sheet/.test(c.value)), null, { timeout: 15000 }).catch(() => {});
const shelf1 = await page.evaluate(() => ({
  rows: [...document.querySelectorAll('[data-prep-file]')].map((c) => c.value),
  removable: !!document.querySelector('[data-prep-del]'),
}));
ok('an uploaded document appears on the shelf', shelf1.rows.some((v) => /my-precall-sheet/.test(v)),
  shelf1.rows.join(' '));
ok('it lands under prep/, not anywhere a client can read',
  shelf1.rows.every((v) => /\/prep\//.test(v)), shelf1.rows.join(' '));
ok('and he can take it off again', shelf1.removable);

// It must NOT show up on the case's own Uploads page either: that page is
// what the client's Files view mirrors, and the two listings are separate on
// purpose.
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="files"]')?.click());
await page.waitForTimeout(2500);
ok('and it is NOT on the case Uploads page', await page.evaluate(() =>
  !/my-precall-sheet/.test(document.getElementById('files')?.textContent || '')));
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="calldoc"]')?.click());
await page.waitForTimeout(1500);

// --- THE CASE'S OWN FILES -------------------------------------------------
// Section 4 is "FROM THE CASE, NOT IN YOUR DOCUMENT", and it needs two
// documents in the room. Until this existed there was one - his - so the
// section restated the assessment he had already read.
console.log('\n--- the case files it can read across ---');
const caseFiles = await page.evaluate(() => ({
  block: !!document.querySelector('[data-cd-case]'),
  boxes: [...document.querySelectorAll('[data-cd-case-file]')].map((c) => c.value),
  // Whitespace-normalised: the copy wraps across lines in the template, so
  // a literal match against raw textContent fails on the newline.
  says: /read across them/.test(
    (document.querySelector('[data-cd-case]')?.textContent || '').replace(/\s+/g, ' ')),
}));
ok('the case files are offered beside the device upload', caseFiles.block);
ok('and it says why they are worth ticking', caseFiles.says);
ok('the seeded case files are listed', caseFiles.boxes.length >= 3, caseFiles.boxes.join(' '));
ok('including the rash photographs the assessment leans on',
  caseFiles.boxes.some((v) => /hand-rash/.test(v)), caseFiles.boxes.join(' '));
ok('and the discharge summary',
  caseFiles.boxes.some((v) => /discharge-summary/.test(v)), caseFiles.boxes.join(' '));
// The client's own saved shelf is outside the advisor's fence and must never
// be offered here.
ok('but never the client\'s private saved shelf',
  !caseFiles.boxes.some((v) => /\/saved\//.test(v)), caseFiles.boxes.join(' '));

console.log('\n--- choose a document and build ---');
await page.setInputFiles('[data-cd-files]', {
  name:'prep-notes.pdf', mimeType:'application/pdf',
  buffer: Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>'),
});
await page.waitForTimeout(700);
ok('the chosen file shows before he commits', await page.evaluate(() =>
  /prep-notes\.pdf/.test(document.querySelector('[data-calldoc-host]')?.textContent||'')));
// Tick two of the case's own files, so the build carries his document AND
// something to read it against.
await page.evaluate(() => {
  for (const cb of [...document.querySelectorAll('[data-cd-case-file]')].slice(0, 2)) {
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
  }
});
await page.waitForTimeout(300);
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
ok('and the case files went with it, so section 4 has something to read across',
  /discharge-summary|hand-rash|advocacy-case-review/.test(built.chrome),
  (built.chrome.match(/Built from: [^.]*/) || [])[0] || 'no source line');
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

// --- IT HAS TO SAY IT FINISHED --------------------------------------------
// The panel says "you can leave the page; it keeps going" - and until now,
// when it landed, nothing anywhere lit up. Leave the tab, let one land, come
// back to the strip: the Call doc tab must be wearing a dot.
console.log('\n--- and it says so when it lands ---');
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="chat"]')?.click());
// Wait for the POLL, not a stopwatch. The dot is set from the advisor's state
// broadcast, which is up to a full interval away; a fixed 1.2s beat it and
// reported a working badge as missing.
await page.waitForFunction(() => {
  const d = document.querySelector('.folder-tabs .ftab[data-page="calldoc"] [data-dot]');
  return !!d && !d.hidden;
}, null, { timeout: 20000 }).catch(() => {});
// A dot is hidden on the page you are ON, which is why we left first.
const dot = await page.evaluate(() => {
  const tab = document.querySelector('.folder-tabs .ftab[data-page="calldoc"]');
  const d = tab?.querySelector('[data-dot]');
  return { tab: !!tab, dot: !!d, shown: !!d && !d.hidden };
});
ok('the Call doc tab carries a dot once a document is ready', dot.shown, JSON.stringify(dot));
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="calldoc"]')?.click());
await page.waitForTimeout(1200);
ok('and opening it clears the dot', await page.evaluate(() => {
  const d = document.querySelector('.folder-tabs .ftab[data-page="calldoc"] [data-dot]');
  return !d || d.hidden;
}));

console.log('\n--- revise, and discard ---');
ok('revise opens an overlay, not a prompt()', await page.evaluate(async () => {
  document.querySelector('[data-cd-revise]')?.click();
  await new Promise(r=>setTimeout(r,400));
  return !!document.getElementById('pa-cd-revise');
}));
await page.evaluate(() => document.querySelector('#pa-cd-revise [data-x]')?.click());
await page.waitForTimeout(300);
ok('discard is offered', await page.evaluate(() => !!document.querySelector('[data-cd-discard]')));

// --- THE PRINTED DOCUMENT NEEDS A WAY OUT ----------------------------------
// Eric, 2026-08-26: "when I open the prep document there's no way to exit
// out." He runs this as a Home Screen app, where the print window has no
// address bar and no back arrow, so once the print sheet is dismissed the
// document owned the screen until he force-quit. Both features print through
// the one function, so this covers the call notes too.
console.log('\n--- the print window has to let him out ---');
const [sheet] = await Promise.all([
  page.waitForEvent('popup', { timeout: 15000 }),
  page.evaluate(() => document.querySelector('[data-cd-print]')?.click()),
]);
// Errors inside the print window count too: the exit is wired by a script in
// that document, and a throw there is exactly the failure this guards.
sheet.on('pageerror', (e) => errs.push(`print window: ${e.message}`));
// Past the 350ms auto-print beat, so this is the state he is actually left in.
await sheet.waitForTimeout(1500);
ok('the print window is still open after it prints', !sheet.isClosed());
const exit = await sheet.evaluate(() => {
  const btn = document.querySelector('[data-pa-close]');
  const r = btn?.getBoundingClientRect();
  return { found: !!btn, label: (btn?.textContent || '').trim(),
    top: r?.top ?? -1, h: r?.height ?? 0, w: r?.width ?? 0,
    doc: !!document.querySelector('pre'), scroll: window.scrollY };
});
ok('there is a close control in it', exit.found, JSON.stringify(exit));
ok('and it says so in words, not just a glyph', /close/i.test(exit.label), exit.label);
ok('it is reachable without scrolling', exit.found && exit.top >= 0 && exit.top < 700,
  `top ${exit.top}`);
ok('and it is a 44px tap target at least', exit.h >= 44 && exit.w >= 44,
  `${Math.round(exit.w)}x${Math.round(exit.h)}`);
ok('playwright agrees it is visible', await sheet.locator('[data-pa-close]').isVisible());

// The saved PDF and the paper copy must carry no button. Ask the page what it
// lays out under print media rather than trusting the stylesheet by eye, and
// count boxes rather than reading display: a button inside a display:none bar
// still reports its own inline-block, so only the rects say what is on paper.
await sheet.emulateMedia({ media: 'print' });
const onPaper = await sheet.evaluate(() => {
  const bar = document.getElementById('pa-exit');
  const btn = document.querySelector('[data-pa-close]');
  const pre = document.querySelector('pre');
  // Reported, not thrown: a missing control has to read as a FAIL line, not
  // as a stack trace that takes the rest of the drive down with it.
  return { bar: bar ? getComputedStyle(bar).display : 'no bar',
    btnBoxes: btn ? btn.getClientRects().length : -1,
    docBoxes: pre ? pre.getClientRects().length : 0 };
});
await sheet.emulateMedia({ media: 'screen' });
ok('the control does NOT print', onPaper.bar === 'none' && onPaper.btnBoxes === 0,
  JSON.stringify(onPaper));
ok('but the document still does', onPaper.docBoxes > 0, `${onPaper.docBoxes} boxes`);

// window.close() on a script-opened window usually works. When it does not,
// he must not be left staring at a document he cannot leave. Stub it out and
// prove the fallback: a plain page, and the control still under his thumb.
const stuck = await sheet.evaluate(async () => {
  Object.defineProperty(window, 'close', { value() {}, configurable: true });
  document.querySelector('[data-pa-close]')?.click();
  await new Promise((r) => setTimeout(r, 1200));
  return { text: document.body.textContent.trim(),
    stillThere: !!document.querySelector('[data-pa-close]') };
});
ok('and if the window refuses to close he is told he can leave',
  /can close this tab/i.test(stuck.text), stuck.text.slice(0, 80));
ok('with the control still on screen to try again', stuck.stillThere);

// Now the real thing, on a fresh window: a tap closes it.
const [sheet2] = await Promise.all([
  page.waitForEvent('popup', { timeout: 15000 }),
  page.evaluate(() => document.querySelector('[data-cd-print]')?.click()),
]);
await sheet2.waitForTimeout(1200);
await sheet2.locator('[data-pa-close]').click().catch(() => {});
await page.waitForTimeout(1200);
ok('tapping close actually closes the print window', sheet2.isClosed());
if (!sheet.isClosed()) await sheet.close();

console.log('\n--- and a client can never see it ---');
const client = await ctx.newPage();
await client.goto(`${P}/case.html?demo=1`, {waitUntil:'networkidle'});
await client.waitForTimeout(3000);
const leak = await client.evaluate(() => {
  const t=document.body.innerText;
  return { calldoc: /REVIEW BEFORE YOU CALL|QUESTIONS THAT ARE MISSING/.test(t),
    tab: !!document.querySelector('[data-page="calldoc"]'),
    // The private shelf, by the name of the file that was put on it.
    prep: /my-precall-sheet/.test(t) };
});
ok('the client page shows no call document', !leak.calldoc);
ok('and has no Call doc tab', !leak.tab);
ok('and NOTHING from his private shelf reaches the client page', !leak.prep);

console.log(`\n${pass} ok, ${fail} FAIL`);
if (errs.length) console.log('page errors:\n  ' + errs.join('\n  '));
await b.close();
process.exit(fail||errs.length ? 1 : 0);
