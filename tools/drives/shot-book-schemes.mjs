// The same three steps in all four colour schemes. Every colour in
// booking.css is mixed from a token, so a scheme swap has to leave the flow
// coherent; this is the check that it does.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || 8812;
const P = `http://127.0.0.1:${PORT}`;
const OUT = process.env.PA_OUT || '/tmp/book-schemes';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

for (const scheme of ['neon', 'calm', 'paper', 'contrast']) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2,
    isMobile: true, hasTouch: true,
  });
  await ctx.addInitScript((s) => {
    try { localStorage.setItem('pa-scheme', s); } catch { /* storage blocked */ }
  }, scheme);
  const page = await ctx.newPage();
  await page.goto(`${P}/book.html?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    document.querySelectorAll('.demo-bar, .pa-demo-bar').forEach((e) => e.remove());
    document.querySelector('[data-suite-go]')?.closest('#step + div')?.remove();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${scheme}-1.png` });

  // Refuse on purpose, so the danger colours get photographed too.
  const slot = page.locator('#step button').filter({ hasText: /AM|PM/ }).first();
  if (await slot.count()) { await slot.click(); await page.waitForTimeout(700); }
  await page.check('#phone-consent').catch(() => {});
  await page.locator('#continue').click().catch(() => {});
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${scheme}-1-refused.png` });

  if (await page.locator('#phone').isVisible().catch(() => false))
    await page.fill('#phone', '+1 555 555 5555');
  await page.locator('#continue').click().catch(() => {});
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${scheme}-2.png` });

  await page.evaluate(async () => {
    for (const d of document.querySelectorAll('#step details.agreement')) {
      d.open = true;
      await new Promise((r) => setTimeout(r, 90));
      const body = d.querySelector('.agreement-body');
      if (body) {
        body.scrollTop = body.scrollHeight;
        body.dispatchEvent(new Event('scroll', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 90));
      const box = d.querySelector('.agreement-check input');
      if (box && !box.disabled) { box.checked = true; box.dispatchEvent(new Event('change', { bubbles: true })); }
      d.open = false;
    }
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: `${OUT}/${scheme}-2-done.png` });
  await page.locator('#continue').click().catch(() => {});
  await page.waitForTimeout(1400);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/${scheme}-3.png` });
  console.log(`  ${scheme} shot`);
  await ctx.close();
}
await b.close();
