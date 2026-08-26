// Photographs every client case page at phone width. Working tool, not shipped.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || 8813;
const P = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT || '/tmp/shots';
const CASE = process.env.CASE || '';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
});
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));

await page.goto(`${P}/case.html?demo=1${CASE ? `&id=${CASE}` : ''}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3500);

// The install popup, then the demo bar: both are furniture, not the page.
for (const b of await page.locator('button').all()) {
  const t = (await b.textContent().catch(() => '')) || '';
  if (/not now|done/i.test(t) && await b.isVisible().catch(() => false)) {
    await b.click().catch(() => {});
    await page.waitForTimeout(300);
  }
}
await page.evaluate(() => {
  document.querySelector('.demo-bar')?.remove();
  document.getElementById('pa-intro')?.remove();
  document.querySelector('.settings-overlay')?.remove();
});
await page.waitForTimeout(400);

const pages = ['progress', 'chat', 'docs', 'addons', 'saved'];
for (const p of pages) {
  await page.evaluate((id) => {
    document.querySelector(`.folder-tabs .ftab[data-page="${id}"]`)?.click();
  }, p);
  await page.waitForTimeout(1600);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${OUT}/${p}${CASE ? '-full' : ''}.png`, fullPage: true });
  console.log('shot', p);
}
if (errs.length) console.log('page errors:', errs.slice(0, 4));
await b.close();
