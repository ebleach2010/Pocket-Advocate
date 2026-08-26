// Step 1 at the narrow end. 390 is an iPhone 14; 360 is most Androids; 320 is
// an iPhone SE and the point at which two times to a row stop being two
// targets and start being two slivers.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const PORT = process.env.PA_PORT || 8812;
const P = `http://127.0.0.1:${PORT}`;
const OUT = process.env.PA_OUT || '/tmp/book-widths';
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const width of [320, 360, 390, 430]) {
  const ctx = await b.newContext({ viewport: { width, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  await page.goto(`${P}/book.html?demo=1`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2600);
  await page.evaluate(() => {
    document.querySelectorAll('.demo-bar, .pa-demo-bar').forEach((e) => e.remove());
    document.querySelector('[data-suite-go]')?.closest('#step + div')?.remove();
    window.scrollTo({ top: 0, behavior: 'instant' });
  });
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => {
    const s = document.querySelector('.slot');
    const r = s?.getBoundingClientRect();
    return {
      doc: document.documentElement.scrollHeight,
      slotW: r ? Math.round(r.width) : 0,
      slotH: r ? Math.round(r.height) : 0,
      // Nothing may push the page sideways.
      sideways: document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
  console.log(`  ${width}px  doc ${m.doc}px  slot ${m.slotW}x${m.slotH}  sideways-scroll ${m.sideways}`);
  await page.screenshot({ path: `${OUT}/w${width}.png` });
  await ctx.close();
}
await b.close();
