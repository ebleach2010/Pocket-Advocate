// Eric, 2026-08-25, with two screenshots: "After selecting a new option" ->
// "That did not save. Try again."
//
// THE THEORY: the dropdown hangs a status on the NEWEST message in the thread,
// whoever wrote it (chat.js:150). handleChatReact refuses any reaction to your
// own message (worker/index.js:2344) and has no carve-out for an admin setting
// a STATUS. So the moment Eric has sent the last message - which, working a
// case, is most of the time - his own dropdown refuses him.
//
// This drives the real UI: send a message AS ERIC so his is newest, then pick
// a status, and read what comes back.
import { chromium } from 'playwright';
const P = process.env.PA_PORT ? `http://127.0.0.1:${process.env.PA_PORT}` : 'http://127.0.0.1:8795';
let pass = 0, fail = 0;
const ok = (n, c, d = '') => { if (c) { pass++; console.log('  ok   ', n, d ? `— ${d}` : ''); } else { fail++; console.log('  FAIL ', n, d ? `— ${d}` : ''); } };

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();

// Every alert() is captured, not dismissed blind: the words in it are the
// evidence. post()'s failMsg path and the new direct-fetch path both alert.
const alerts = [];
page.on('dialog', async (d) => { alerts.push(d.message()); await d.accept(); });

await page.goto(`${P}/admin-case.html?id=demo-case&demo=admin`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="chat"]')?.click());
await page.waitForTimeout(2500);

// --- 1. the thread as it opens ---------------------------------------------
// I expected this to open on a CLIENT message and it does not: the seeded
// thread ends on one of Eric's, the same way a real thread he is working ends
// on one of his. That is the reproduction condition, so it gets pinned rather
// than worked around - if the fixture ever changes, the rest of this drive
// stops testing what it says it tests.
const before = await page.evaluate(() => {
  const log = document.querySelector('[data-log]');
  const msgs = [...log.querySelectorAll('.msg')];
  const last = msgs[msgs.length - 1];
  return { count: msgs.length, lastIsMine: !!last?.classList.contains('me'),
           lastText: (last?.textContent || '').slice(0, 40) };
});
console.log('--- the thread as it opens ---');
ok('it already ends on a message of ERIC\'s, before he types anything',
   before.lastIsMine, before.lastText);

await page.selectOption('[data-status-pick]', 'documents');
await page.waitForTimeout(1500);
const onClientMsg = await page.evaluate(() => document.querySelector('[data-status-pick]').value);
ok('so this pick is ALREADY the failing case, and it now saves',
   onClientMsg === 'documents', `select = "${onClientMsg}"`);
ok('and nothing was alerted', alerts.length === 0, alerts.join(' | '));

// clear it again so the second half starts from nothing
await page.selectOption('[data-status-pick]', '');
await page.waitForTimeout(1200);
alerts.length = 0;

// --- 2. THE BUG: Eric sends, so HIS message is now newest -------------------
console.log('\n--- now Eric sends a message, so his is the newest ---');
await page.fill('[data-input]', 'Calling the clinic this afternoon.');
await page.click('form button[type="submit"]');
await page.waitForTimeout(2500);

const mid = await page.evaluate(() => {
  const msgs = [...document.querySelectorAll('[data-log] .msg')];
  const last = msgs[msgs.length - 1];
  return { lastIsMine: !!last?.classList.contains('me'),
           lastText: (last?.textContent || '').slice(0, 50) };
});
ok('his message is now the newest in the thread', mid.lastIsMine, mid.lastText);

await page.selectOption('[data-status-pick]', 'documents');
await page.waitForTimeout(2000);

const after = await page.evaluate(() => {
  const s = document.querySelector('[data-status-pick]');
  const chips = [...document.querySelectorAll('[data-log] .msg .msg-react')]
    .map((c) => c.textContent.trim());
  return { value: s.value, chips };
});

console.log(`  alert text: ${alerts.length ? alerts.map((a) => `"${a}"`).join(' | ') : '(none)'}`);
console.log(`  dropdown afterwards: "${after.value}"   chips on thread: ${JSON.stringify(after.chips)}`);

ok('the status SAVES on his own message', after.value === 'documents', `select = "${after.value}"`);
ok('nothing is alerted at him', alerts.length === 0, alerts.join(' | '));
ok('and the status shows on the thread', after.chips.some((c) => /prepping documents/.test(c)),
   JSON.stringify(after.chips));

// --- 3. it must survive a reload, same as on a client message ---------------
console.log('\n--- and it is still a state ---');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await page.evaluate(() => document.querySelector('.folder-tabs .ftab[data-page="chat"]')?.click());
await page.waitForTimeout(2500);
const back = await page.evaluate(() => document.querySelector('[data-status-pick]')?.value);
ok('reopening shows the status still set', back === 'documents', `select = "${back}"`);

console.log(`\n${pass} ok, ${fail} FAIL`);
await b.close();
process.exit(fail ? 1 : 0);
