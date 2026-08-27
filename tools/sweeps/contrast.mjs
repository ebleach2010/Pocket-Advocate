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
const P = `http://127.0.0.1:${process.env.PA_PORT || 8901}`;
// EVERY scheme, not just whichever one the browser happens to open in.
// This ran single-scheme for its whole life and reported "0 low-contrast
// runs" while never once loading paper or contrast, which is where a
// white-alpha gradient or a dark-ground token actually fails.
const SCHEMES = (process.env.PA_SCHEMES || 'neon,calm,paper,contrast').split(',');
const PAGES = ['/', '/services', '/faq', '/contact', '/about', '/reviews',
  '/book?demo=1', '/case.html?id=demo-case&demo=1',
  '/admin-case.html?id=demo-case&demo=admin', '/admin.html?demo=admin'];
/** The rendered truth for one element: clip it, read the pixels, and take the
 *  extreme against the most common colour. No DOM, so a gradient, a pseudo
 *  element or a stacking context cannot mislead it. */
async function ratioFromPixels(page, clip) {
  const buf = await page.screenshot({ clip });
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const lum = (r, gg, bb) => {
      const f = [r, gg, bb].map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      return .2126 * f[0] + .7152 * f[1] + .0722 * f[2];
    };
    const seen = new Map();
    let lo = 2, hi = -1;
    for (let i = 0; i < d.length; i += 4) {
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      seen.set(k, (seen.get(k) || 0) + 1);
      const L = lum(d[i], d[i + 1], d[i + 2]);
      if (L < lo) lo = L;
      if (L > hi) hi = L;
    }
    let best = 0, bg = 0;
    for (const [k, n] of seen) if (n > best) { best = n; bg = k; }
    const bl = lum((bg >> 16) & 255, (bg >> 8) & 255, bg & 255);
    // Ink is whichever extreme is furthest from the ground.
    const ink = Math.abs(hi - bl) > Math.abs(bl - lo) ? hi : lo;
    return (Math.max(ink, bl) + .05) / (Math.min(ink, bl) + .05);
  }, buf.toString('base64'));
}

const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
let bad = 0;
let unsure = 0;
for (const scheme of SCHEMES) {
const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
await ctx.addCookies([{ name: 'pa_demo', value: '1', domain: '127.0.0.1', path: '/' }]);
const page = await ctx.newPage();
// Stamped before first paint, the same way the app's own head snippet does it,
// so the page never renders one scheme and gets measured in another.
await page.addInitScript((sc) => {
  try { localStorage.setItem('pa-scheme', sc); } catch { /* storage blocked */ }
}, scheme);
console.log(`\n== ${scheme} ==`);
for (const path of PAGES) {
  await page.goto(P + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2200);
  const hits = await page.evaluate(() => {
    const lum = (c) => {
      const [r, g, bl] = c.map((v) => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
      return .2126 * r + .7152 * g + .0722 * bl;
    };
    // THROUGH A CANVAS, because a regex over the serialisation is wrong for
    // half of what Chrome emits. getComputedStyle returns color-mix() results
    // as `color(srgb 0.92 0.89 0.85)`, whose channels are 0 to 1: read as 0 to
    // 255 that near-white parsed as near-black, and this script reported 93
    // false failures on the paper scheme while missing real ones. A canvas
    // normalises every colour syntax the browser supports, including the ones
    // that do not exist yet.
    const probe = document.createElement('canvas');
    probe.width = 1; probe.height = 1;
    const pctx = probe.getContext('2d', { willReadFrequently: true });
    const parse = (s) => {
      if (!s || s === 'transparent') return [0, 0, 0, 0];
      // Alpha has to survive, and canvas premultiplies against what is already
      // there, so it is read from the string and applied separately.
      const nums = (s.match(/[\d.]+/g) || []).map(Number);
      const alpha = /rgba?\(/.test(s) && nums.length >= 4 ? nums[3]
        : /\/\s*[\d.]+\s*\)/.test(s) ? Number(s.match(/\/\s*([\d.]+)\s*\)/)[1]) : 1;
      pctx.clearRect(0, 0, 1, 1);
      pctx.fillStyle = '#000';
      pctx.fillStyle = s;
      // An unparseable value leaves fillStyle at #000; that is a visible
      // failure rather than a silent wrong number.
      pctx.fillRect(0, 0, 1, 1);
      const d = pctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], alpha];
    };
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
      if (ratio < 3) {
        // Tagged so the pixel pass can clip this exact element back out.
        const id = `s${out.length}`;
        el.setAttribute('data-sweep', id);
        out.push({ id, txt: txt.slice(0, 46), ratio: Number(ratio.toFixed(2)), fg: s.color, bg: `rgb(${bg.slice(0, 3).join(',')})` });
      }
    }
    return out;
  });
  // EVERY HIT IS CONFIRMED AGAINST PAINTED PIXELS BEFORE IT IS REPORTED.
  //
  // The DOM walk finds the first ancestor with an opaque background, and that
  // is the wrong element whenever the real surface is painted with a gradient
  // or a pseudo element. On the manila folder it lands on the tab band rather
  // than the card stock, and it reported black-on-black at 1:1 for text that
  // measures 18.64:1 in the rendered pixels. Nine of the seventeen hits in the
  // first honest run were that artifact.
  //
  // A tool that cries wolf on the same page every run is how a real hit gets
  // ignored, so the walk is a CANDIDATE FINDER now and the screenshot is the
  // verdict. Same reasoning that made it skip emoji.
  const confirmed = [];
  const unconfirmed = [];
  for (const h of hits) {
    let px = null;
    try {
      const box = await page.evaluate((id) => {
        const el = document.querySelector(`[data-sweep="${id}"]`);
        if (!el) return null;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        return r.width > 2 && r.height > 2 && r.y >= 0
          ? { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
          : null;
      }, h.id);
      // The scroll has to settle or the clip lands outside the viewport, which
      // is what made most of these unconfirmable on the first pass.
      if (box) { await page.waitForTimeout(120); px = await ratioFromPixels(page, box); }
    } catch { /* falls through to unconfirmed */ }
    if (px === null) {
      // COULD NOT CLIP IT, so there is no verdict. Reporting the DOM number
      // here would be reporting the very thing that is unreliable, which is
      // how nine false failures got into the last run. It is listed, loudly,
      // and counted apart: an unconfirmed candidate is a gap in the tool, not
      // a defect in the page, and conflating the two is what made this script
      // untrustworthy in the first place.
      unconfirmed.push(h);
      continue;
    }
    if (px < 3) confirmed.push({ ...h, ratio: Number(px.toFixed(2)), how: 'pixels' });
  }
  const got = await page.evaluate(() => document.documentElement.dataset.scheme || 'neon');
  const tag = got === scheme ? '' : `  !! rendered as ${got}`;
  const dropped = hits.length - confirmed.length;
  console.log(`${path}  ${confirmed.length ? `${confirmed.length} under 3:1` : 'all text at 3:1 or better'}`
    + `${dropped ? ` (${dropped} candidate${dropped === 1 ? '' : 's'} cleared by pixels)` : ''}${tag}`);
  for (const h of confirmed.slice(0, 6)) console.log(`    ${h.ratio}:1  "${h.txt}"  ${h.fg}`);
  for (const h of unconfirmed.slice(0, 4)) console.log(`    ?  could not clip "${h.txt}" to confirm (DOM guessed ${h.ratio}:1)`);
  bad += confirmed.length;
  unsure += unconfirmed.length;
  if (got !== scheme) bad += 1;
}
await ctx.close();
}
await b.close();
console.log(`\n${bad} low-contrast runs confirmed in pixels`
  + `${unsure ? `, ${unsure} candidate${unsure === 1 ? '' : 's'} could not be clipped and were not judged` : ''}`);
