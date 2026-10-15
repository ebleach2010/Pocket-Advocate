// drive-prices.mjs - his prices, from the settings cog, live at once.
//
//   PA_PORT=9377 PA_SHOTS=/tmp/shots node tools/drives/drive-prices.mjs
//
// Eric, 2026-10-15: "Change the price of the mid tier to $2000. In the
// settings tab for admin let me adjust price for each effective immediately."
// Then "*2100". Driven in the admin demo at 390px: the cog shows his five
// prices read from the server, a save is said back, a bad entry is refused and
// put back, and the home, the case's own page and its About copy show the new
// price on their next load without anything else happening.
import { chromium } from 'playwright';
const P = `http://127.0.0.1:${process.env.PA_PORT || 9377}`;
const SHOTS = process.env.PA_SHOTS || '';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let pass = 0; let fail = 0;
const ok = (n, c, d = '') => { if (c) { pass += 1; console.log('  ok   ', n, d ? `-- ${d}` : ''); } else { fail += 1; console.log('  FAIL ', n, d ? `-- ${d}` : ''); } };

const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
const errs = []; page.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));

console.log('\n--- A. the case is $2,100 out of the box ---');
await page.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.removeItem('pa-demo-store'); });
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
ok('the Clients page no longer carries a rate panel', await page.evaluate(() => !document.querySelector('#rate-save') && !/Today's rate/.test(document.body.textContent)));
const home0 = await ctx.newPage();
await home0.goto(`${P}/?demo=admin`, { waitUntil: 'networkidle' });
await home0.waitForTimeout(1200);
ok('the home card reads $2,100', await home0.evaluate(() => document.querySelector('#options [data-rate="case"]')?.textContent) === '$2,100');
await home0.close();

console.log('\n--- B. the cog ---');
await page.click('.cog-btn');
await page.waitForSelector('[data-prices-save]:not([disabled])', { timeout: 8000 }).catch(() => {});
const read = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-price]')].map((i) => [i.dataset.price, [i.value, i.disabled]])));
ok('his five prices are read from the server and only then editable',
  read.subCents?.[0] === '50' && read.caseCents?.[0] === '2100' && read.fullCents?.[0] === '4400' && read.addonCents?.[0] === '325' && read.floorCents?.[0] === '75'
  && Object.values(read).every(([, d]) => d === false), JSON.stringify(read));
await page.evaluate(() => document.querySelector('[data-prices]').scrollIntoView({ block: 'center' }));
if (SHOTS) await page.screenshot({ path: `${SHOTS}/prices-1-cog.png` });

await page.fill('[data-price="caseCents"]', 'abc');
await page.click('[data-prices-save]');
await page.waitForTimeout(400);
const refused = await page.evaluate(() => ({ said: document.querySelector('[data-prices-said]').textContent, box: document.querySelector('[data-price="caseCents"]').value }));
// NEGATIVE CONTROL (run 2026-10-15): wirePrices' paint(confirmed) after a bad entry taken out made this read
//   FAIL  a bad entry is refused in words and the box goes back to the price on file
ok('a bad entry is refused in words and the box goes back to the price on file', /did not look like an amount/.test(refused.said) && refused.box === '2100', JSON.stringify(refused));

await page.fill('[data-price="caseCents"]', '2,250');
await page.fill('[data-price="subCents"]', '55');
await page.click('[data-prices-save]');
await page.waitForFunction(() => /Saved and live/.test(document.querySelector('[data-prices-said]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
const saved = await page.evaluate(() => ({ said: document.querySelector('[data-prices-said]').textContent, box: document.querySelector('[data-price="caseCents"]').value }));
ok('a save says what is live now, in dollars', /Saved and live: chat \$55 a month, a case \$2,250, Full-Service \$4,400 a month, a follow-up \$325\./.test(saved.said) && saved.box === '2250', saved.said);
if (SHOTS) await page.screenshot({ path: `${SHOTS}/prices-2-saved.png` });

console.log('\n--- C. live everywhere on the next load ---');
const home = await ctx.newPage();
await home.goto(`${P}/?demo=admin`, { waitUntil: 'networkidle' });
await home.waitForTimeout(1200);
const homeCase = await home.evaluate(() => document.querySelector('#options [data-rate="case"]')?.textContent);
await home.goto(`${P}/advocacy-case.html?demo=admin`, { waitUntil: 'networkidle' });
await home.waitForTimeout(1500);
const pkg = await home.evaluate(() => ({ head: document.querySelector('.pkg-price [data-rate="case"]')?.textContent, tldr: document.querySelector('.pkg-tldr')?.textContent || '' }));
await home.goto(`${P}/priority-chat.html?demo=admin`, { waitUntil: 'networkidle' });
await home.waitForTimeout(1500);
const chat = await home.evaluate(() => [...document.querySelectorAll('[data-rate="sub"]')].map((e) => e.textContent));
// NEGATIVE CONTROL (run 2026-10-15): the demo's store write taken out made this read
//   FAIL  the new case price shows on the home, its own page and in its About copy, on their next load
// and so did rates.js asking the real route without waiting for the demo (demoReady() taken out).
ok('the new case price shows on the home, its own page and in its About copy, on their next load',
  homeCase === '$2,250' && pkg.head === '$2,250' && /One flat \$2,250\./.test(pkg.tldr), JSON.stringify({ homeCase, pkg: pkg.head, tldr: pkg.tldr.slice(0, 40) }));
ok('and the chat page reads the new chat price in every spot', chat.length >= 2 && chat.every((t) => t === '$55'), chat.join());

console.log('\n--- D. the phone ---');
const small = await b.newContext({ viewport: { width: 320, height: 700 } });
await small.addCookies([{ name: 'pa_demo', value: 'admin', domain: '127.0.0.1', path: '/' }]);
const sp = await small.newPage();
await sp.goto(`${P}/admin.html?demo=admin`, { waitUntil: 'networkidle' });
await sp.waitForTimeout(2000);
await sp.click('.cog-btn');
await sp.waitForSelector('[data-prices-save]:not([disabled])', { timeout: 8000 }).catch(() => {});
const over = await sp.evaluate(() => {
  const card = document.querySelector('.settings-card');
  return [...card.querySelectorAll('[data-prices] input, [data-prices-save]')].filter((el) => el.getBoundingClientRect().right > card.getBoundingClientRect().right + 1).length;
});
ok('at 320px every price box and the save button fit inside the card', over === 0, `${over} past the edge`);
ok('no page errors', errs.length === 0, errs.join(' | '));
await small.close();

await b.close();
console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
