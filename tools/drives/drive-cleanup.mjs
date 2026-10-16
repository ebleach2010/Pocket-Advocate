// drive-cleanup.mjs - the staff side, cleaned up for a new contractor, in a real browser.
//
// Eric, 2026-10-15: "It's confusing as fuck to a new contractor." Three audits
// came back and the plan ships in five pushes; this drive grows with them.
//   A. (v7.52) as Ana, the demo's contractor: her Uploads name no Advisor, the
//      picker waits for a choice, a report before the call is refused, her
//      statuses carry her name, her + is her one door, and her case shows no
//      dead review panel and none of his slots or his calendar
//   B. (v7.52) as him: the alerts card leaves the + on the screen, and a push's
//      ?page=chat opens Chat
//   C. no page threw
//   D. (v7.53) each case matches what was bought: his shelf by purchase, a
//      Full-Service case with its consult and no report, an Advocacy Case
//      leading with its meeting link, and their Full-Service page
//   E. (v7.54) the doubles cut: four groups, Agenda under Mine, one Log with
//      a filter, Saved under Notes, the PDF on Uploads, one clock switch, and
//      About you in the Voice study fold
//
// Run: PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-cleanup.mjs
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
const tryStep = async (fn) => { try { return await fn(); } catch { return null; } };
async function side(role, width = 390) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  await ctx.addCookies([{ name: 'pa_demo', value: role, domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${role}: ${String(e).slice(0, 300)}`));
  return page;
}
const settle = async (page, ms = 1500) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 5; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Close|Maybe later|Later)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await page.waitForTimeout(250); if (!hit) break;
  }
};
// A folder tab is a link carrying its page id (folder.js).
const group = async (page, g, pageId) => {
  await tryStep(() => page.click(`.folder-groups button:has-text("${g}")`, { timeout: 5000 }));
  await page.waitForTimeout(500);
  if (pageId) await tryStep(() => page.click(`.folder-tabs [data-page="${pageId}"]`, { timeout: 5000 }));
  await page.waitForTimeout(900);
};

console.log('\n--- A. as Ana ---');
const ana = await side('advocate');
await ana.goto(`${P}/admin.html?demo=advocate`, { waitUntil: 'networkidle' });
await ana.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('pa-demo')) localStorage.removeItem(k); });
await ana.reload({ waitUntil: 'networkidle' });
await settle(ana, 2500);
const shelf = await ana.evaluate(() => ({
  calendar: [...document.querySelectorAll('header a[href]')].some((a) => /admin-calendar/.test(a.getAttribute('href'))),
  haspopup: document.querySelector('[data-add-open]')?.getAttribute('aria-haspopup'),
}));
await tryStep(() => ana.click('[data-add-open]', { timeout: 5000 }));
await ana.waitForTimeout(1200);
const plus = await ana.evaluate(() => ({
  menuOpen: document.getElementById('add-menu') ? !document.getElementById('add-menu').hidden : false,
  form: !!document.querySelector('[data-lf="price"]') && document.querySelector('[data-lf="price"]').checkVisibility(),
}));
// NEGATIVE CONTROL (run 2026-10-15, v7.52): wireAddMenu's one-door shortcut taken out made this read
//   FAIL  her + opens her one door, the lead form, with no one-line menu first, and her menu has no Calendar
ok('her + opens her one door, the lead form, with no one-line menu first, and her menu has no Calendar',
  !plus.menuOpen && plus.form && !shelf.calendar && shelf.haspopup == null, JSON.stringify({ shelf, plus }));

await ana.goto(`${P}/admin-case.html?id=demo-case-ana&demo=advocate`, { waitUntil: 'networkidle' });
await settle(ana, 2500);
await group(ana, 'Case', 'files');
const up = await ana.evaluate(() => {
  const pane = document.querySelector('#up-cat')?.closest('.panel');
  return {
    advisor: /advisor/i.test(pane?.textContent || ''),
    reviewBtns: document.querySelectorAll('[data-review]').length,
    first: document.querySelector('#up-cat')?.value,
    firstLabel: document.querySelector('#up-cat option')?.textContent.trim(),
    fileOff: document.querySelector('#up-report')?.disabled === true,
    due: !!document.querySelector('#up-cat') && true,
  };
});
if (SHOTS) await ana.screenshot({ path: `${SHOTS}/cleanup-1-ana-uploads.png` });
// NEGATIVE CONTROL (run 2026-10-15, v7.52): the picker's "Choose what this is" option taken out made this read
//   FAIL  her Uploads name no Advisor, and the picker opens on a question with the file field waiting for the answer
ok('her Uploads name no Advisor, and the picker opens on a question with the file field waiting for the answer',
  !up.advisor && up.reviewBtns === 0 && up.first === '' && up.firstLabel === 'Choose what this is' && up.fileOff, JSON.stringify(up));

// A report picked on a case whose call has not happened: refused before anything moves.
let said = '';
ana.once('dialog', async (dlg) => { said = dlg.message(); await dlg.dismiss().catch(() => {}); });
await tryStep(() => ana.selectOption('#up-cat', 'report'));
await ana.waitForTimeout(300);
await tryStep(() => ana.setInputFiles('#up-report', { name: 'echo-report.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 demo') }));
await ana.waitForTimeout(1500);
const fileShown = await ana.evaluate(() => document.querySelector('#up-cat')?.checkVisibility() === true);
// The case as it stands after a reload: its status pill, read from the page.
await ana.reload({ waitUntil: 'networkidle' });
await settle(ana, 2000);
const pill = await ana.evaluate(() => document.querySelector('.status-pill, [data-status-pill]')?.textContent.trim() || '');
// NEGATIVE CONTROL (run 2026-10-15, v7.52): the page's `!data.reportDueAt` stop before the upload taken out made this read
//   FAIL  a report picked before the call is stopped with "Mark the call done first", and the case is not delivered
ok('a report picked before the call is stopped with "Mark the call done first", and the case is not delivered',
  fileShown && /^Mark the call done first\./.test(said) && /CONFIRMED/.test(pill), JSON.stringify({ fileShown, said, pill }));

await group(ana, 'Case', 'chat');
const opts = await ana.evaluate(() => [...document.querySelectorAll('[data-status-pick] option')].map((o) => o.textContent.trim()).filter(Boolean));
// NEGATIVE CONTROL (run 2026-10-15, v7.52): admin-case.js's setStatusName call taken out made this read
//   FAIL  her "what I'm doing" list says Ana, never Eric
ok('her "what I\'m doing" list says Ana, never Eric', opts.length >= 6 && opts.some((t) => /Ana is reading/.test(t)) && !opts.some((t) => /Eric/.test(t)), JSON.stringify(opts.slice(0, 4)));

await group(ana, 'Case', 'overview');
const ov = await ana.evaluate(() => ({
  review: !!document.querySelector('[data-k="review"]'),
  slots: [...document.querySelectorAll('#sched-slot option')].map((o) => o.textContent.trim()),
}));
// NEGATIVE CONTROL (run 2026-10-15, v7.52): the review panel's `advocate ? '' :` taken out made this read
//   FAIL  her Overview has no review panel she cannot use, and her schedule offers her own time, none of his slots
ok('her Overview has no review panel she cannot use, and her schedule offers her own time, none of his slots',
  !ov.review && ov.slots.length === 1 && /not on the calendar/.test(ov.slots[0]), JSON.stringify(ov));

console.log('\n--- B. as him ---');
const eric = await side('admin');
await eric.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(eric, 2500);
const head = await eric.evaluate(() => {
  const plusBtn = document.querySelector('[data-add-open]')?.getBoundingClientRect();
  const card = [...document.querySelectorAll('[data-push]')].find((x) => x.checkVisibility());
  const row = document.querySelector('.clients-head');
  return {
    card: !!card,
    cardInRow: !!(card && row && row.contains(card)),
    plusRight: plusBtn ? Math.round(plusBtn.right) : null,
    width: innerWidth,
  };
});
if (SHOTS) await eric.screenshot({ path: `${SHOTS}/cleanup-2-eric-shelf.png` });
// NEGATIVE CONTROL (run 2026-10-15, v7.52): push.js putting the card back after the h1 (`const under = h1;`) made this read
//   FAIL  the alerts card sits under the Clients row, and the + stays on a phone's screen
ok('the alerts card sits under the Clients row, and the + stays on a phone\'s screen',
  !head.cardInRow && head.plusRight !== null && head.plusRight <= head.width, JSON.stringify(head));

await eric.goto(`${P}/admin-case.html?id=demo-case&demo=admin&page=chat`, { waitUntil: 'networkidle' });
await settle(eric, 2500);
const landed = await eric.evaluate(() => ({
  chat: !!document.querySelector('#chat') && document.querySelector('#chat').checkVisibility(),
  url: location.search,
}));
// NEGATIVE CONTROL (run 2026-10-15, v7.52): the ?page= reader made blind (`const asked = '';`) made this read
//   FAIL  a push's ?page=chat opens the case on Chat, and the address forgets it
ok('a push\'s ?page=chat opens the case on Chat, and the address forgets it', landed.chat && !/page=/.test(landed.url), JSON.stringify(landed));

console.log('\n--- D. each case matches what was bought (v7.53) ---');
await eric.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(eric, 2500);
const shelf2 = await eric.evaluate(() => {
  const heads = [...document.querySelectorAll('#list h2')].map((h) => h.textContent.trim());
  const fullHead = [...document.querySelectorAll('#list h2')].find((h) => h.textContent.trim() === 'FULL-SERVICE');
  const fullNames = fullHead ? [...fullHead.nextElementSibling.querySelectorAll('a')].map((a) => a.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean) : [];
  const attention = [...document.querySelectorAll('.cmd-row')].map((a) => a.textContent.replace(/\s+/g, ' ').trim());
  return { heads, fullNames: fullNames.slice(0, 3), attention };
});
if (SHOTS) await eric.screenshot({ path: `${SHOTS}/cleanup-3-shelf-by-purchase.png`, fullPage: true });
// NEGATIVE CONTROL (run 2026-10-15, v7.53): the FULL-SERVICE section taken off the shelf (fullOpen read as []) made this read
//   FAIL  his shelf has a Full-Service shelf of its own, the Advocacy Cases under REPORT PHASE, and nothing calls a Full-Service case's report overdue
ok('his shelf has a Full-Service shelf of its own, the Advocacy Cases under REPORT PHASE, and nothing calls a Full-Service case\'s report overdue',
  shelf2.heads.includes('FULL-SERVICE') && !shelf2.heads.includes('CURRENT CLIENTS: REPORT PHASE')
  && shelf2.fullNames.some((t) => /FULL-SERVICE/.test(t)) && !shelf2.attention.some((t) => /Report overdue/.test(t) && /FULL/.test(t))
  && !shelf2.fullNames.some((t) => /OVERDUE|REPORT DUE/.test(t)), JSON.stringify(shelf2));

await eric.goto(`${P}/admin-case.html?id=demo-case-full&demo=admin`, { waitUntil: 'networkidle' });
await settle(eric, 2500);
await group(eric, 'Case', 'overview');
const full = await eric.evaluate(() => ({
  pill: document.querySelector('[data-status]')?.textContent.trim(),
  chips: [...document.querySelectorAll('.loop-chip')].map((x) => x.textContent.trim()),
  next: document.querySelector('.case-next')?.textContent.replace(/\s+/g, ' ').trim() || '',
  consult: /CONSULT/.test(document.body.innerText) && !/\bREPORT\s+(due|OVERDUE)/.test(document.body.innerText),
  report: !!document.querySelector('#up-cat option[value="report"]'),
}));
// NEGATIVE CONTROL (run 2026-10-15, v7.53): the CONSULT row's branch taken out made this read
//   FAIL  a Full-Service case says FULL-SERVICE and shows its consult, with no report due, overdue or to file
ok('a Full-Service case says FULL-SERVICE and shows its consult, with no report due, overdue or to file',
  full.pill === 'FULL-SERVICE' && !full.chips.some((t) => /Report/.test(t)) && !/Report due/.test(full.next) && full.consult && !full.report, JSON.stringify(full));

await eric.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await settle(eric, 2500);
await group(eric, 'Case', 'overview');
const levers = await eric.evaluate(() => {
  const before = [...document.querySelectorAll('.mgmt-when')].find((e) => e.textContent.trim() === 'Before the call');
  const ending = [...document.querySelectorAll('.mgmt-when')].find((e) => e.textContent.trim() === 'Ending it');
  return { first: before?.nextElementSibling?.dataset?.k || '', beforeEnd: ending?.previousElementSibling?.dataset?.k || '' };
});
// NEGATIVE CONTROL (run 2026-10-15, v7.53): the Advocacy Case reorder taken out (`if (!c.fullAccess)` made `if (false)`) made this read
//   FAIL  an Advocacy Case leads with its meeting link, and its forms wait at the bottom
ok('an Advocacy Case leads with its meeting link, and its forms wait at the bottom', levers.first === 'link' && levers.beforeEnd === 'auth', JSON.stringify(levers));

const client = await side('client');
await client.goto(`${P}/case.html?id=demo-case-full&demo=1`, { waitUntil: 'networkidle' });
await settle(client, 2500);
const theirs = await client.evaluate(() => ({
  pill: document.querySelector('[data-status-pill]')?.textContent.trim(),
  eyebrow: document.querySelector('[data-status-pill]')?.parentElement?.textContent.replace(/\s+/g, ' ').trim(),
  onItsWay: /report is on its way/i.test(document.body.innerText),
}));
if (SHOTS) await client.screenshot({ path: `${SHOTS}/cleanup-4-client-full.png` });
// NEGATIVE CONTROL (run 2026-10-15, v7.53): case.js's statusWord back to STATUS_LABEL alone made this read
//   FAIL  their Full-Service page says Full-Service Case Management, never REPORT DUE or a report on its way
ok('their Full-Service page says Full-Service Case Management, never REPORT DUE or a report on its way',
  theirs.pill === 'FULL-SERVICE' && /Full-Service Case Management/.test(theirs.eyebrow || '') && !theirs.onItsWay, JSON.stringify(theirs));

console.log('\n--- E. the doubles cut (v7.54) ---');
await eric.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await settle(eric, 2500);
const strip = await eric.evaluate(() => [...document.querySelectorAll('.folder-groups button')].map((b) => b.textContent.trim()));
await group(eric, 'Mine', 'agenda');
const mine = await eric.evaluate(() => ({
  tabs: [...document.querySelectorAll('.folder-tabs [data-page]')].filter((e) => e.checkVisibility()).map((e) => e.dataset.page),
  agenda: !!document.querySelector('[data-agenda-host] [data-alist]'),
  waitingHost: !!document.querySelector('[data-waiting-host]'),
}));
await group(eric, 'Act', 'log');
const log = await eric.evaluate(() => ({
  tabs: [...document.querySelectorAll('.folder-tabs [data-page]')].filter((e) => e.checkVisibility()).map((e) => e.dataset.page),
  filter: [...document.querySelectorAll('[data-log-filter] button')].map((b) => b.textContent.trim()),
  both: !!document.querySelector('[data-log-work] [data-calls-root]') && !!document.querySelector('[data-log-miles] [data-mile-root]'),
}));
await tryStep(() => eric.click('[data-log-filter] [data-show="miles"]', { timeout: 4000 }));
await eric.waitForTimeout(300);
const onlyMiles = await eric.evaluate(() => ({ work: document.querySelector('[data-log-work]')?.hidden, miles: document.querySelector('[data-log-miles]')?.hidden }));
await group(eric, 'Mine', 'notes');
const notesHasSaved = await eric.evaluate(() => !!document.querySelector('.fpage:not([hidden]) [data-saved-host]') || !!document.querySelector('[data-saved-host]'));
await group(eric, 'Case', 'files');
const uploadsPdf = await eric.evaluate(() => /Every file on this case in one PDF\./.test(document.querySelector('.compile-card')?.textContent || ''));
await group(eric, 'Case', 'chat');
const chatStart = await eric.evaluate(() => [...document.querySelectorAll('button')].some((b) => b.checkVisibility() && /Start working/.test(b.textContent)));
if (SHOTS) await eric.screenshot({ path: `${SHOTS}/cleanup-5-one-log.png` });
// NEGATIVE CONTROL (run 2026-10-16, v7.54): his Track group put back (`{ id: 'track', label: 'Track', icon: 'i-doc', pages: ['agenda'] },` after Advisor) made this read
//   FAIL  his case has four groups, Agenda under Mine, one Log with its filter under Act, Saved under Notes, the PDF on Uploads, and no second Start
ok('his case has four groups, Agenda under Mine, one Log with its filter under Act, Saved under Notes, the PDF on Uploads, and no second Start',
  strip.join('|') === 'Case|Advisor|Mine|Act' && mine.tabs.includes('agenda') && mine.agenda && mine.waitingHost
  && log.tabs.join() === 'log' && log.filter.join('|') === 'Everything|Work|Milestones' && log.both
  && onlyMiles.work === true && onlyMiles.miles === false && notesHasSaved && uploadsPdf && !chatStart,
  JSON.stringify({ strip, mine, log, onlyMiles, notesHasSaved, uploadsPdf, chatStart }));

await eric.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await settle(eric, 2500);
const about = await eric.evaluate(() => {
  const box = document.querySelector('[data-about-you]');
  return { found: !!box, heads: box ? [...box.querySelectorAll('h4')].map((h) => h.textContent.trim()) : [], inFold: !!box?.closest('details') };
});
// NEGATIVE CONTROL (run 2026-10-16, v7.54): the voice block's `${aboutHtml(voice.about)}` taken out made this read
//   FAIL  About you sits in the Voice study fold on Clients, all three parts
ok('About you sits in the Voice study fold on Clients, all three parts',
  about.found && about.inFold && about.heads.join('|') === 'How you write|Where you stand|Strong suits, and things to work on', JSON.stringify(about));

console.log('\n--- C. errors ---');
// NEGATIVE CONTROL (run 2026-10-15, v7.52): a `null.x` put first in wireAddMenu's + click made this read
//   FAIL  no page threw
ok('no page threw', !errs.length, JSON.stringify(errs.slice(0, 3)));

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
