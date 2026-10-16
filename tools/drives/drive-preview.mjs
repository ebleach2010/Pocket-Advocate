// drive-preview.mjs - "Preview a case", from the home to Exit, in a real
// browser at 390px, on the real build (no demo).
//
//   PA_PORT=9377 PA_SHOTS=/some/dir node tools/drives/drive-preview.mjs
//
// Eric, 2026-10-15: "This showcase suite should exhibit every feature and be
// fully interactable. They can even chat and upload documents but they get
// deleted as soon as they exit the showcase suite. This showcase suite will
// be on the top left in the same aesthetic as the waitlist button, but it will
// say 'preview a case' or something similar. So clients can see the features
// before they commit. When they're in the showcase suite, a button of the same
// design is in the top left (make sure it's not blocking any interactable UI
// elements) that say exit. Once they tap this it brings them back to the
// landing page."
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const PORT = process.env.PA_PORT || 8795;
const P = `http://127.0.0.1:${PORT}`;
const SHOTS = process.env.PA_SHOTS || '';
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { c ? (pass++, console.log(`  ok    ${n}${d ? ' (' + d + ')' : ''}`)) : (fail++, console.log(`  FAIL  ${n}${d ? ' (' + d + ')' : ''}`)); };
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errs = [];
const sent = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 300)));
// Every request that would write: none may reach the server from inside the preview.
page.on('request', (r) => { if (r.method() !== 'GET' && /\/api\//.test(r.url())) sent.push(`${r.method()} ${new URL(r.url()).pathname}`); });
const settle = async (ms = 1200) => {
  await page.waitForTimeout(ms);
  for (let i = 0; i < 6; i++) {
    const hit = await page.evaluate(() => { const x = [...document.querySelectorAll('button')].find((e) => e.checkVisibility() && /^(Got it|Not now|Skip|Close|Maybe later|Later)$/i.test((e.textContent || '').trim())); if (x) x.click(); return !!x; });
    await page.waitForTimeout(250); if (!hit) break;
  }
};

console.log('\n--- A. the door on the home ---');
await page.goto(`${P}/`, { waitUntil: 'networkidle' });
await settle();
const door = await page.evaluate(() => {
  const pv = document.querySelector('.pv-bubble');
  const wl = document.querySelector('[data-waitlist-open]');
  const a = pv?.getBoundingClientRect(); const w = wl?.getBoundingClientRect();
  const sa = pv && getComputedStyle(pv); const sw = wl && getComputedStyle(wl);
  return {
    text: (pv?.textContent || '').trim(), href: pv?.getAttribute('href'),
    left: a && Math.round(a.left), topGap: a && w && Math.round(Math.abs(a.top - w.top)), rightOfIt: a && w && w.left > a.right,
    same: !!sa && sa.backgroundImage === sw.backgroundImage && sa.boxShadow.split(')')[0] === sw.boxShadow.split(')')[0],
    h: a && Math.round(a.height),
  };
});
if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview-1-home.png` });
// NEGATIVE CONTROL (run 2026-10-15): the home's Preview bubble moved after the waitlist bubble in the row made this read
//   FAIL  the home carries Preview a case at the top left, the waitlist bubble's twin on the same row, a full tap high
ok('the home carries Preview a case at the top left, the waitlist bubble\'s twin on the same row, a full tap high',
  /Preview a case$/.test(door.text) && door.href === '/case.html?preview=1' && door.left <= 24 && door.topGap <= 4 && door.rightOfIt && door.same && door.h >= 44,
  JSON.stringify(door));

console.log('\n--- B. inside: the case, and Exit covering nothing ---');
await page.click('.pv-bubble');
await page.waitForURL(/\/case(\.html)?\?preview=1/, { timeout: 15000 });
// RE-PINNED 2026-10-15 (v7.45): a first visit opens on the guided tour (walked in drive-tour.mjs); this drive skips it.
await page.waitForSelector('.pv-tour', { timeout: 8000 }).catch(() => {});
await page.click('[data-tour-skip]').catch(() => {});
await settle(2500);
const inside = await page.evaluate(() => {
  const exit = document.querySelector('[data-preview-exit]');
  const r = exit?.getBoundingClientRect();
  const hits = [...document.querySelectorAll('a, button, input, select, textarea, [role="button"], [role="switch"], [tabindex="0"]')]
    .filter((el) => el !== exit && !exit?.contains(el) && el.checkVisibility())
    .filter((el) => { const q = el.getBoundingClientRect(); return r && q.width && q.height && q.left < r.right && q.right > r.left && q.top < r.bottom && q.bottom > r.top; })
    .map((el) => el.outerHTML.slice(0, 80));
  const head = document.querySelector('header.bar')?.getBoundingClientRect();
  return {
    exit: (exit?.textContent || '').trim(), left: r && Math.round(r.left), top: r && Math.round(r.top),
    overlaps: hits, headerBelow: !!head && r && head.top >= r.bottom - 1,
    name: document.querySelector('main')?.innerText.includes('Video call'), tabs: [...document.querySelectorAll('.ftab')].map((t) => t.dataset.page),
  };
});
if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview-2-case.png` });
// NEGATIVE CONTROL (run 2026-10-15): the strip given `position: fixed` with the header's docking class left off made this read
//   FAIL  Exit is top left in the same bubble, in a row of its own: the header docks under it and nothing it could cover sits beneath it
ok('Exit is top left in the same bubble, in a row of its own: the header docks under it and nothing it could cover sits beneath it',
  inside.exit === 'Exit' && inside.left <= 32 && inside.top <= 20 && inside.overlaps.length === 0 && inside.headerBelow, JSON.stringify(inside));
// NEGATIVE CONTROL (run 2026-10-15): the seeded case given another client's uid (so the visitor has no case) made this read
//   FAIL  it is a whole case: progress, chat, documents, enhancements and saved messages
ok('it is a whole case: progress, chat, documents, enhancements and saved messages', inside.name && ['progress', 'chat', 'docs', 'addons', 'saved'].every((t) => inside.tabs.includes(t)), inside.tabs.join(' '));
await page.evaluate(() => window.scrollTo(0, 900));
await page.waitForTimeout(300);
const stuck = await page.evaluate(() => { const r = document.querySelector('.pv-strip').getBoundingClientRect(); const h = document.querySelector('header.bar').getBoundingClientRect(); return { strip: Math.round(r.top), header: Math.round(h.top), h: Math.round(r.height) }; });
// NEGATIVE CONTROL (run 2026-10-15): the strip's `position: sticky` changed to `position: relative` made this read
//   FAIL  scrolled, Exit stays at the top with the header docked right under it
ok('scrolled, Exit stays at the top with the header docked right under it', stuck.strip === 0 && Math.abs(stuck.header - stuck.h) <= 2, JSON.stringify(stuck));
await page.evaluate(() => window.scrollTo(0, 0));

console.log('\n--- C. fully interactable ---');
await page.evaluate(() => document.querySelector('.ftab[data-page="chat"]')?.click());
await page.waitForTimeout(800);
const n0 = await page.evaluate(() => document.querySelectorAll('.msg').length);
await page.fill('.chat-form textarea', 'Hello from the preview');
await page.evaluate(() => document.querySelector('.chat-form button[type=submit]')?.click());
await page.waitForTimeout(3600);
const chat = await page.evaluate(() => [...document.querySelectorAll('.msg')].map((m) => m.innerText.replace(/\s+/g, ' ')));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview-3-chat.png` });
// NEGATIVE CONTROL (run 2026-10-15): the preview's one reply taken out of /api/notify made this read
//   FAIL  the chat carries the whole story, their message lands, and one reply shows what an answer looks like
// RE-PINNED 2026-10-16 (v7.61): Eric, "more friendly and softer toned ... This chat isn't usable in the way a fake
// contractor is": the answer is a warm reply like a real one, never a note about the preview.
// NEGATIVE CONTROL (run 2026-10-16, v7.61): /api/notify's reply put back to the old note about the preview made this read
//   FAIL  the chat carries the whole story, their message lands, and a warm reply comes back like a real one
ok('the chat carries the whole story, their message lands, and a warm reply comes back like a real one',
  n0 >= 50 && chat.some((t) => /Hello from the preview/.test(t)) && /^Thank you for telling me\. I'm really glad you reached out/.test(chat[chat.length - 1] || '')
  && !/preview/i.test(chat[chat.length - 1] || ''), `${n0} then ${chat.length}: ${chat[chat.length - 1]}`);
await page.evaluate(() => document.querySelector('.ftab[data-page="docs"]')?.click());
await page.waitForTimeout(1200);
const docs0 = await page.evaluate(() => [...document.querySelectorAll('[data-files] li')].map((l) => l.innerText.replace(/\s+/g, ' ')));
const input = await page.$('[data-file-input]');
await input.setInputFiles({ name: 'my-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('notes for the preview') });
await page.waitForTimeout(1500);
await page.click('.rename-card [data-skip]', { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(2000);
const docs1 = await page.evaluate(() => [...document.querySelectorAll('[data-files] li')].map((l) => l.innerText.replace(/\s+/g, ' ')));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview-4-docs.png` });
// NEGATIVE CONTROL (run 2026-10-15): the seed's recording file skipped made this read
//   FAIL  the documents are there to open: the report, a form to sign, the recording, uploads and the chat's files
ok('the documents are there to open: the report, a form to sign, the recording, uploads and the chat\'s files',
  ['case-report.pdf', 'appeal-letter.pdf', 'video-call-recording.wav', 'eye-clinic-note.pdf', 'mri-report.pdf'].every((n) => docs0.some((t) => t.includes(n))), `${docs0.length} rows`);
// NEGATIVE CONTROL (run 2026-10-15): the preview store's upload never saying it finished made this read
//   FAIL  and an upload lands on the list, as theirs
ok('and an upload lands on the list, as theirs', docs1.some((t) => /^UPLOAD .*my-notes\.txt/.test(t)), docs1.filter((t) => /notes/.test(t)).join(' | '));
await page.evaluate(() => document.querySelector('.ftab[data-page="addons"]')?.click());
await page.waitForTimeout(800);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/preview-5-enhance.png` });
// Every way a client page could spend money, asked from inside the preview: each one says so, and none goes out.
const buys = await page.evaluate(async () => Promise.all(['/api/extend', '/api/upgrade', '/api/followup', '/api/chat-unlock', '/api/checkout']
  .map(async (p) => { const r = await fetch(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"caseId":"preview-case"}' }); return [p, r.status, (await r.json()).error]; })));
// NEGATIVE CONTROL (run 2026-10-15): '/api/extend' taken out of the preview's SHOP list made this read
//   FAIL  every purchase says it is a preview and charges nothing
ok('every purchase says it is a preview and charges nothing',
  buys.every(([, st, e]) => st === 409 && e === 'This is a preview, so nothing in it can be bought or booked. Everything else on this case works.'), JSON.stringify(buys));

console.log('\n--- D. Exit ---');
await page.evaluate(() => window.scrollTo(0, 0));
await page.click('[data-preview-exit]');
await page.waitForURL((u) => new URL(u).pathname === '/', { timeout: 10000 }).catch(() => {});
await settle();
const out = await page.evaluate(() => ({ path: location.pathname, flag: sessionStorage.getItem('pa-preview'), store: sessionStorage.getItem('pa-preview-store'), strip: !!document.querySelector('.pv-strip') }));
// Exit wipes, and so does arriving home: either alone leaves nothing, by design. What this holds is where Exit goes.
// NEGATIVE CONTROL (run 2026-10-15): bar.js's Exit sent to '/faq.html' instead of home made this read
//   FAIL  Exit lands on the home with everything they did gone
ok('Exit lands on the home with everything they did gone', out.path === '/' && !out.flag && !out.store && !out.strip, JSON.stringify(out));
await page.goto(`${P}/case.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const back = await page.evaluate(() => ({ strip: !!document.querySelector('.pv-strip'), joe: document.body.innerText.includes('angiography') }));
// NEGATIVE CONTROL (run 2026-10-15): firebase.js's preview switch answering yes to every client page made this read
//   FAIL  and the case page is the real one again, with no trace of Joe
ok('and the case page is the real one again, with no trace of Joe', !back.strip && !back.joe, JSON.stringify(back));
// NEGATIVE CONTROL (run 2026-10-15): the preview's fetch letting '/api/notify' through to the server made this read
//   FAIL  nothing done in the preview reached the server
ok('nothing done in the preview reached the server', sent.length === 0, sent.join(', '));

console.log('\n--- E. the phone\'s narrowest width ---');
{
  const c2 = await b.newContext({ viewport: { width: 320, height: 640 } });
  const p2 = await c2.newPage();
  await p2.goto(`${P}/case.html?preview=1`, { waitUntil: 'networkidle' });
  await p2.waitForSelector('.pv-tour', { timeout: 8000 }).catch(() => {});
  await p2.click('[data-tour-skip]').catch(() => {});
  await p2.waitForTimeout(2500);
  // The page clips sideways overflow, so the strip is measured itself: its words wrap inside it and nothing in it
  // runs past the screen's edge.
  const w = await p2.evaluate(() => {
    const s = document.querySelector('.pv-strip');
    const past = [...s.children].some((el) => el.getBoundingClientRect().right > innerWidth + 0.5);
    return (s.scrollWidth - s.clientWidth) + (past ? 1000 : 0) + Math.max(0, document.documentElement.scrollWidth - innerWidth);
  });
  const home = await (async () => { await p2.goto(`${P}/`, { waitUntil: 'networkidle' }); return p2.evaluate(() => document.documentElement.scrollWidth - innerWidth); })();
  // NEGATIVE CONTROL (run 2026-10-15): the strip's line set `white-space: nowrap` made this read
  //   FAIL  nothing runs past the edge at 320px: the preview's strip and the home
  ok('nothing runs past the edge at 320px: the preview\'s strip and the home', w <= 0 && home <= 0, `${w} / ${home}`);
  await c2.close();
}

// The real case page, after Exit, loads Firebase from Google's servers, which a sandboxed run cannot reach;
// that one failure is the environment, not the page.
const pageErrs = errs.filter((e) => !/firebase-real\.js/.test(e));
ok('no page errors', pageErrs.length === 0, pageErrs.join(' | '));
console.log(`\n${pass} ok, ${fail} failed`);
await b.close();
process.exit(fail ? 1 : 0);
