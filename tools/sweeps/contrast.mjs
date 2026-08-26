// contrast.mjs - every run of text on every page, against what is painted
// behind it. Run a local Worker first, then:
//
//   node tools/sweeps/contrast.mjs
//
// WHAT IT CATCHES. The class of bug where a later stylesheet takes an
// element's ink but not its background. Two shipped this way: the demo
// banner's buttons went to var(--ink) on gold (1.3:1) because glowup.css's
// .btn.ghost loads after site.css's .demo-bar .btn at equal specificity; and
// the dashboard painted dark-ground tokens onto light manila card stock, so
// CHECK-IN DUE, a flag whose whole job is to be noticed, measured 1.28:1.
//
// WHAT IT GETS WRONG, so nobody chases a ghost. getComputedStyle() reports
// backgroundColor `transparent` for any surface painted with a gradient or a
// pseudo-element, so the walk up the tree finds the wrong ancestor. On the
// manila shelf it reports the tab band #A98F5F where the text actually sits
// on the stock #DEC791, which reads about 3 points of ratio too low. And an
// emoji takes its colour from the font, so its CSS `color` means nothing.
//
// When a number here looks wrong, do not argue with it: clip a screenshot to
// the element and read the painted pixels. That is how the stock colour above
// was established, and how CHECK-IN DUE was confirmed at 5.9:1 after the fix
// while this script still called it 2.79.
import { chromium } from 'playwright';
const P = 'http://127.0.0.1:8901';
const PAGES = ['/', '/services', '/faq', '/contact', '/about', '/reviews',
  '/book?demo=1', '/case.html?id=demo-case&demo=1',
  '/admin-case.html?id=demo-case&demo=admin', '/admin.html?demo=admin'];
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
let bad = 0;
for (const path of PAGES) {
  await page.goto(P + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const hits = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, bl] = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      return .2126 * r + .7152 * g + .0722 * bl;
    };
    const parse = (s) => (s.match(/[\d.]+/g) || []).slice(0, 4).map(Number);
    // The real background: walk up until something is not transparent.
    const behind = (el) => {
      for (let n = el; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.length >= 3 && (c[3] === undefined || c[3] > .5)) return c;
      }
      return [0, 0, 0];
    };
    const out = [];
    for (const el of document.querySelectorAll('*')) {
      const txt = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      if (!txt || txt.length < 2) continue;
      // An emoji takes its colour from the font, not from CSS, so the `color`
      // this script reads has nothing to do with what is painted. Reporting it
      // is worse than useless: a permanent 1.07:1 at the bottom of every run
      // is where a real hit goes to hide. Skip anything with no letters or
      // digits in it at all.
      if (!/[\p{L}\p{N}]/u.test(txt)) continue;
      const s = getComputedStyle(el);
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < .1) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue;
      const fg = parse(s.color);
      if (fg[3] !== undefined && fg[3] < .5) continue;
      const bg = behind(el);
      const l1 = lum(fg.slice(0, 3)), l2 = lum(bg.slice(0, 3));
      const ratio = (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
      if (ratio < 3) out.push({ txt: txt.slice(0, 46), ratio: Number(ratio.toFixed(2)), fg: s.color, bg: `rgb(${bg.slice(0, 3).join(',')})` });
    }
    return out;
  });
  console.log(`${path}  ${hits.length ? `${hits.length} under 3:1` : 'all text at 3:1 or better'}`);
  for (const h of hits.slice(0, 6)) console.log(`    ${h.ratio}:1  "${h.txt}"  ${h.fg} on ${h.bg}`);
  bad += hits.length;
}
await b.close();
console.log(`\n${bad} low-contrast runs total`);
