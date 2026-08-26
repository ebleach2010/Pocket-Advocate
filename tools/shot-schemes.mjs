// The add-ons and progress pages in all four schemes. Working tool, not shipped.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || 8813;
const P = `http://127.0.0.1:${PORT}`;
const OUT = process.env.OUT || '/tmp/shots';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const scheme of ['neon', 'calm', 'paper', 'contrast']) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem('pa-scheme', s); } catch (e) { /* blocked */ }
  }, scheme);
  const page = await ctx.newPage();
  await page.goto(`${P}/case.html?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(3500);
  for (const btn of await page.locator('button').all()) {
    const t = (await btn.textContent().catch(() => '')) || '';
    if (/not now|done/i.test(t) && await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(250);
    }
  }
  await page.evaluate(() => {
    document.querySelector('.demo-bar')?.remove();
    document.getElementById('pa-intro')?.remove();
    document.querySelector('.settings-overlay')?.remove();
    document.querySelector('[data-hint-ok]')?.click();
  });
  for (const p of ['progress', 'addons']) {
    await page.evaluate((id) => {
      document.querySelector(`.folder-tabs .ftab[data-page="${id}"]`)?.click();
    }, p);
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `${OUT}/${scheme}-${p}.png`, fullPage: true });
  }
  console.log('shot', scheme, await page.evaluate(() => document.documentElement.dataset.scheme || 'neon'));
  await ctx.close();
}
await b.close();
