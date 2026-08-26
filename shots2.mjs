import { chromium } from 'playwright';
const P = 'http://127.0.0.1:8901';
const SHOTS = [
  ['landing', '/'], ['services', '/services'], ['book', '/book?demo=1'],
  ['case', '/case.html?id=demo-case&demo=1'],
  ['admin', '/admin.html?demo=admin'],
];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
for (const scheme of ['neon', 'calm', 'paper', 'contrast']) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
  const page = await ctx.newPage();
  await page.addInitScript((s) => {
    try { localStorage.setItem('pa-scheme', s); } catch { /* blocked */ }
  }, scheme);
  for (const [name, path] of SHOTS) {
    await page.goto(P + path, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(2200);
    const got = await page.evaluate(() => document.documentElement.dataset.scheme || 'neon');
    await page.screenshot({ path: `/tmp/shots/${scheme}-${name}.png`, fullPage: name !== 'landing' });
    if (got !== scheme) console.log(`  !! ${scheme}/${name} rendered as ${got}`);
  }
  await ctx.close();
  console.log(`${scheme} shot`);
}
await b.close();
