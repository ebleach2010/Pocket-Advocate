import { chromium } from 'playwright';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
for (const p of ['/signin', '/book?demo=1', '/subscribe', '/return', '/reviews']) {
  await page.goto('http://127.0.0.1:8901' + p, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(1500);
  const small = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('a,button,input,select,textarea,[role=button]')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden' || !el.offsetParent) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1) continue;
      // The real hit area can be bigger than the paint: a ::after overlay or a
      // wrapping label both count. Probe the point, do not trust the box.
      const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      const box = hit ? hit.getBoundingClientRect() : r;
      const w = Math.max(r.width, box.width), h = Math.max(r.height, box.height);
      if (w < 24 || h < 24)
        out.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''} ${Math.round(w)}x${Math.round(h)}`);
    }
    return out;
  });
  console.log(`${p.padEnd(14)} ${small.length ? small.join('  |  ') : 'nothing under 24px'}`);
}
await b.close();
