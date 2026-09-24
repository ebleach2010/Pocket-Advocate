// drive-nohang.mjs - the Clients page never sits on "Loading…" forever (v7.11).
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-nohang.mjs
//
// Eric, 2026-09-24, 12:09 AM, a screenshot of the Clients page on Loading:
// "It's stuck loading in the client case menu on launch." The net in
// admin.html is driven for real here: a normal load never trips it; a page
// whose code never arrives reloads once, then says which step stopped with
// Try again; and Try again brings the shelf once the code can load. At 2:03 AM
// the same page said "Stuck on: checking your sign-in" (v7.16): section C holds
// sign-in with Google, the way a phone just woken does, and the page must say
// so and wait rather than reload. About seventy seconds, most of it the net's
// own waits.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const PORT = process.env.PA_PORT || '9377';
const SHOTS = process.env.PA_SHOTS || '';
const P = `http://127.0.0.1:${PORT}`;
const PAGE = `${P}/admin.html?demo=admin`;
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.PA_CHROMIUM || '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log(`  ok    ${n}${d ? ` (${d})` : ''}`); } else { fail += 1; console.log(`  FAIL  ${n}${d ? ` (${d})` : ''}`); } };
const open = async (width = 390) => {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  // A held module holds the page's load events too, so each load is counted from inside the page, as
  // every new document starts.
  await page.addInitScript(() => { try { sessionStorage.setItem('drive-loads', String(Number(sessionStorage.getItem('drive-loads') || 0) + 1)); } catch { /* none */ } });
  const loads = () => page.evaluate(() => Number(sessionStorage.getItem('drive-loads') || 0));
  return { ctx, page, errs, loads };
};
const read = (page) => page.evaluate(() => ({
  stage: window.__paStage || '',
  list: document.getElementById('list')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 160) || '',
  retry: !!document.getElementById('list-retry'),
  flag: (() => { try { return sessionStorage.getItem('pa-list-retry'); } catch { return 'blocked'; } })(),
  wide: document.documentElement.scrollWidth > window.innerWidth + 1,
}));

console.log('\n--- A. a normal load paints the shelf and the net never trips ---');
{
  const { ctx, page, errs, loads } = await open();
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(13_500);
  const s = await read(page);
  ok('the shelf paints, the step reads done and the flag is clear', s.stage === 'done' && !/Loading…|taking too long/.test(s.list) && s.flag === null, JSON.stringify(s));
  const n = await loads();
  ok('past the twelve seconds it never reloaded and never showed the stuck line', n === 1 && !s.retry, `loads ${n}`);
  ok('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

console.log('\n--- B. the page\'s code never arrives: one reload, then the step and Try again ---');
{
  const { ctx, page, errs, loads } = await open(320);
  let hold = true;
  await page.route('**/js/admin.js', (route) => { if (!hold) route.continue(); });
  await page.goto(PAGE, { waitUntil: 'commit' });
  await page.waitForTimeout(1500);
  const before = await read(page);
  ok('it starts on Loading, on the first step', /Loading…/.test(before.list) && before.stage === 'code', JSON.stringify(before));
  await page.waitForTimeout(13_000);
  const n1 = await loads();
  ok('after twelve seconds it reloaded itself once and marked it', n1 === 2 && (await read(page)).flag === '1', `loads ${n1}`);
  await page.waitForTimeout(13_000);
  const stuck = await read(page);
  const n2 = await loads();
  ok('a second stall says which step stopped, with Try again, and no third load', /This is taking too long\. Stuck on: loading the app's code\./.test(stuck.list) && stuck.retry && n2 === 2, JSON.stringify({ ...stuck, loads: n2 }));
  ok('the stuck line fits a 320px screen', !stuck.wide, JSON.stringify(stuck));
  // A page whose code is held never finishes loading, so Playwright's screenshot would wait on it: the
  // browser's own capture takes the picture as it stands.
  if (SHOTS) {
    const cdp = await ctx.newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/nohang-stuck-320.png`, Buffer.from(data, 'base64'));
  }
  hold = false;
  await page.click('#list-retry');
  await page.waitForTimeout(4000);
  const back = await read(page);
  ok('Try again, with the code able to arrive, paints the shelf and clears the flag', back.stage === 'done' && !/Loading…|taking too long/.test(back.list) && back.flag === null, JSON.stringify(back));
  ok('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}

console.log('\n--- C. sign-in held with Google, as on a phone just woken: a note and a wait, never a reload ---');
{
  const { ctx, page, errs, loads } = await open(320);
  // auth.js says where sign-in is; here it is held at Google until the drive lets it go.
  await page.addInitScript(() => {
    let stage = 'code';
    window.__holdGoogle = true;
    Object.defineProperty(window, '__paStage', { configurable: true, get() { return window.__holdGoogle ? 'signin' : stage; }, set(v) { stage = v; } });
    Object.defineProperty(window, '__paSignin', { configurable: true, get() { return window.__holdGoogle ? 'google' : 'ok'; }, set() { /* held */ } });
  });
  await page.goto(PAGE, { waitUntil: 'networkidle' });
  const noteNow = () => page.evaluate(() => { const n = document.getElementById('signin-note'); return n ? { shown: !n.hidden, text: n.textContent.trim(), wide: document.documentElement.scrollWidth > window.innerWidth + 1 } : null; });
  ok('before twelve seconds there is no note', (await noteNow())?.shown === false);
  await page.waitForTimeout(13_000);
  const at13 = await noteNow();
  const told = await page.evaluate(() => (window.__paDemoStalls || []).map((x) => `${x.kind}:${x.signin}:${x.page}`));
  ok('at twelve seconds the page says it is still checking with Google, and fits a 320px screen', !!at13 && at13.shown && /^Still checking your sign-in with Google\. Right after the phone wakes this can take up to a minute\. No need to tap anything\.$/.test(at13.text) && !at13.wide, JSON.stringify(at13));
  ok('the slow sign-in is reported once, as Google\'s', JSON.stringify(told) === JSON.stringify(['slow-google:google:clients']), JSON.stringify(told));
  if (SHOTS) {
    const cdp = await ctx.newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(`${SHOTS}/nohang-google-320.png`, Buffer.from(data, 'base64'));
  }
  await page.waitForTimeout(14_000);
  const at27 = await read(page);
  ok('at twenty-seven seconds it has still not reloaded or called it stuck', (await loads()) === 1 && !at27.retry && (await noteNow())?.shown === true, JSON.stringify({ loads: await loads(), at27 }));
  await page.evaluate(() => { window.__holdGoogle = false; });
  await page.waitForTimeout(3_000);
  const after = await read(page);
  ok('once Google answers, the note goes and the shelf stands, with no reload', (await noteNow())?.shown === false && after.stage === 'done' && !after.retry && (await loads()) === 1, JSON.stringify({ after, loads: await loads() }));
  ok('no page errors', !errs.length, errs.join(' | '));
  await ctx.close();
}
// The report's route, on the real Worker: without the admin cookie it is a path that is not there.
{
  const res = await fetch(`${P}/api/admin/stall`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"page":"clients"}' });
  ok('the stall report answers 404 to anyone without the admin cookie', res.status === 404, String(res.status));
}

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
if (fail) process.exit(1);
