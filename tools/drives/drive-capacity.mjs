// drive-capacity.mjs - how many Hands-Off cases at once, set from his phone.
//
//   PA_PORT=8799 node tools/drives/drive-capacity.mjs
//
// Eric, 2026-08-27: "remove limitations on how many hand off cases I can have.
// Or at least put that in an admin settings cog."
//
// FULL_MAX_OPEN_DEFAULT carried a comment saying "one tap on his dashboard
// changes it". There was no tap: settings/fullAccess.maxOpen was read in one
// place and written by nothing, ever.
//
// The suite runs the arithmetic. This proves the row exists, that it paints
// what is stored rather than what was assumed, that "No limit" survives being
// read back (the whole reason a stored zero could not stay falsy), and that
// nothing on a client page names a number.
//
// 390x844 and 320px, because five buttons in a row is exactly the sort of
// thing that fits at one width and not the other.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 8799}`;
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => {
  if (c) { pass += 1; console.log('  ok   ', n, d ? `(${d})` : ''); }
  else { fail += 1; console.log('  FAIL ', n, d ? `(${d})` : ''); }
};

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const width of [390, 320]) {
  console.log(`\n--- ${width}px ---`);
  const ctx = await b.newContext({ viewport: { width, height: 844 } });
  await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));

  await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3000);

  const openCog = async () => {
    await page.evaluate(() => document.querySelector('.cog-btn')?.click());
    await page.waitForSelector('[data-cap-picks]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(900);
  };
  await openCog();

  const row = () => page.evaluate(() => {
    const picks = document.querySelector('[data-cap-picks]');
    const btns = [...(picks?.querySelectorAll('[data-cap]') || [])];
    return {
      found: !!picks,
      labels: btns.map((x) => x.textContent.trim()),
      on: btns.filter((x) => x.classList.contains('on')).map((x) => x.dataset.cap),
      disabled: btns.filter((x) => x.disabled).length,
      tall: btns.length ? Math.min(...btns.map((x) => Math.round(x.getBoundingClientRect().height))) : 0,
      said: document.querySelector('[data-cap-said]')?.textContent.trim() || '',
      // Five buttons in a row, on the narrowest phone he might use.
      overflow: Math.round(picks ? picks.scrollWidth - picks.clientWidth : -1),
    };
  });

  const start = await row();
  ok('there is a row for it in the cog', start.found);
  ok('with presets, not a keyboard', start.labels.join(' ') === '1 2 3 5 No limit',
    start.labels.join(' '));
  ok('every one of them a real 44px target', start.tall >= 44, `${start.tall}px`);
  ok('the row does not scroll sideways', start.overflow <= 1, `${start.overflow}px over`);
  // It painted from the SERVER, not from an assumption, and enabled itself
  // only afterwards.
  ok('it enabled itself only after the server answered', start.disabled === 0);
  ok('and it shows which one is set, from what is stored',
    start.on.join() === '2', `on: ${start.on.join() || 'none'}`);
  ok('with his current load beside it', /open right now/.test(start.said), start.said);

  // NO LIMIT. The one that could not survive a round trip before, because a
  // stored zero read as "unset".
  await page.evaluate(() => document.querySelector('[data-cap="0"]').click());
  await page.waitForTimeout(1500);
  const off = await row();
  ok('No limit takes, and the row says so', off.on.join() === '0', `on: ${off.on.join() || 'none'}`);
  ok('and it STILL tells him how many he is carrying',
    /No limit\. You are carrying \d+ right now\./.test(off.said), off.said);

  // Read back from the server on a fresh open, which is the half a local
  // toggle would fake.
  await page.evaluate(() => document.querySelector('#pa-settings [data-close]')?.click());
  await page.waitForTimeout(400);
  await openCog();
  const again = await row();
  ok('a stored zero survives being read back, rather than reverting to two',
    again.on.join() === '0', `on: ${again.on.join() || 'none'}`);

  await page.screenshot({ path: `/tmp/pa-cap-${width}.png` });

  // Put a real cap back and check it holds.
  await page.evaluate(() => document.querySelector('[data-cap="3"]').click());
  await page.waitForTimeout(1500);
  const three = await row();
  ok('and a real number takes just as well', three.on.join() === '3', `on: ${three.on.join()}`);
  ok('no page errors', errs.length === 0, errs.slice(0, 2).join(' | '));

  await ctx.close();
}

// ---- what a client is told ----------------------------------------------
// Four client-read places used to promise "two at a time". The suite scans the
// source; this reads the rendered page, because the services copy is inside
// HTML and the about sheet is built by JS at open time.
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(`${P}/services.html`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);
  const NUM = /(carry|take|handle|take on|run)\s+(one|two|three|four|five|1|2|3|4|5)\b[^.]{0,60}?(at (a|one) time|at once)/i;
  const services = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('the services page names no number of cases he carries at once',
    !NUM.test(services), (services.match(NUM) || ['ok'])[0]);
  ok('and it still says there IS a limit, so the personal answer makes sense',
    /a limited number of these at a time/.test(services));

  // The about sheet, opened the way a buyer opens it.
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('[data-about]')]
      .find((x) => x.dataset.about === 'handsOff');
    if (btn) btn.click();
  });
  await page.waitForTimeout(1200);
  const sheet = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  ok('the About sheet names no number either',
    !NUM.test(sheet), (sheet.match(NUM) || ['ok'])[0]);
  ok('and it says he answers personally because he cannot take everyone',
    /I carry a limited number of these at a time/.test(sheet));
  await page.screenshot({ path: '/tmp/pa-cap-about-390.png' });
  await ctx.close();
}

await b.close();
console.log(`\n${pass} ok, ${fail} FAIL`);
process.exit(fail ? 1 : 0);
