// hue.mjs - three looks: Warm, Blue and green, Black (v7.66; the color wheel of v7.64 is gone).
//
// Eric, 2026-10-17: "Keep the whole color scheme and gradient, but allow it to be adjusted via a color wheel in
// settings. I don't think it's too complicated to do more than that for color options. Include black, though,
// which just makes things black background white text for simplicity and those with eye sensitivity."
// Then, the same day: "The color wheel is horrendous. Get rid of it. Have it be either the blue/green from before
// or this warm look, or just black on white."
//
// RE-PINNED 2026-10-17 (v7.66): every check below read the wheel (its generated block, its guards, the hue
// before paint, applyHue, the slider). The wheel is gone, so each one now proves the part of its promise that
// still stands, under the same id: H1 the wheel's block and its generator are gone, H2 the warm sheets still
// stand down for the other two looks, H3 Black is black background and white text, H4 nothing leans on a hue
// and the sheets carry no dash, H5 every page sets the look before paint and no page sets a hue, H6 theme.js
// keeps each look and Black takes over at once, H7 Settings offers the three looks and nothing else, H8 a
// gradient written into text keeps its clip.
//
//   H1 no sheet carries the wheel's block, and its generator is gone
//   H2 every rule in the warm sheets that sets a colour token keeps the warm look's guards
//   H3 Black is black background, white text, and its swatch shows that
//   H4 nothing leans on a chosen hue, and the sheets carry no dash
//   H5 every page sets the look before paint, and none sets a hue
//   H6 theme.js: each look is kept, takes effect at once, and an old hue is ignored
//   H7 Settings offers Warm, Blue and green and Black, and nothing else
//   H8 a gradient written into text keeps its clip
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
const SHEETS = ['public/css/warm.css', 'public/css/landing-warm.css'];
const WARM_ROOT = ':root:not([data-scheme="contrast"]):not([data-look="cool"])';
/** Every rule as [selector, body], @supports and @media opened. */
function rules(css) {
  const out = [];
  const walk = (s) => {
    let k = 0;
    while (k < s.length) {
      const open = s.indexOf('{', k);
      if (open < 0) break;
      const sel = s.slice(k, open).trim();
      let depth = 1; let m = open + 1;
      while (m < s.length && depth) { if (s[m] === '{') depth++; else if (s[m] === '}') depth--; m++; }
      const body = s.slice(open + 1, m - 1);
      if (/^@(media|supports)/.test(sel)) walk(body); else if (!sel.startsWith('@')) out.push([sel, body]);
      k = m;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''));
  return out;
}
const top = (sel) => { const out = []; let d = 0; let cur = ''; for (const ch of sel) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((x) => x.trim()).filter(Boolean); };
const CSS = Object.fromEntries(SHEETS.map((p) => [p, f(p)]));
const ALL_CSS = readdirSync(join(ROOT, 'public/css')).filter((n) => n.endsWith('.css')).map((n) => [`public/css/${n}`, f(`public/css/${n}`)]);

console.log('\n--- the sheets ---');
{
  const marked = ALL_CSS.filter(([, c]) => /THE COLOR WHEEL|oklch\(from /.test(c)).map(([p]) => p);
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): `/* ==== THE COLOR WHEEL ==== */` added to the end of warm.css made this read
  //   FAIL  H1 no sheet carries the color wheel's block, and its generator is gone
  check('H1 no sheet carries the color wheel\'s block, and its generator is gone',
    !marked.length && !existsSync(join(ROOT, 'tools/build-hue.mjs')) && rules(CSS[SHEETS[0]]).length > 40, marked.join(' '));

  // The warm sheets' colours are tokens set on the root (the plum ground, the peach to rose pop, the raised
  // buttons' plum fill), and every rule that sets one waits for neither Black nor Blue and green.
  const tokenRules = SHEETS.flatMap((p) => rules(CSS[p]).filter(([, b]) => /(^|;)\s*--[\w-]+\s*:/.test(b)).flatMap(([s]) => top(s)));
  const loose = tokenRules.filter((s) => !s.startsWith(WARM_ROOT));
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): `:root { --raise-top: #4C3742; }` added to the end of warm.css made this read
  //   FAIL  H2 every rule in the warm sheets that sets a colour token keeps the warm look's guards, so Black and Blue and green are never warmed
  check('H2 every rule in the warm sheets that sets a colour token keeps the warm look\'s guards, so Black and Blue and green are never warmed',
    tokenRules.length >= 3 && !loose.length && tokenRules.filter((s) => /--raise|:has\(body\.landing\)|^:root[^ ]*$/.test(s)).length >= 2, JSON.stringify({ n: tokenRules.length, loose: loose.slice(0, 3) }));

  const SITE = f('public/css/site.css');
  const black = rules(SITE).filter(([s]) => s === ':root[data-scheme="contrast"]').map(([, b]) => b).join(';');
  const tok = (name) => (black.match(new RegExp(`--${name}:\\s*([^;]+);`)) || [])[1]?.trim();
  const chip = (n) => (SITE.match(new RegExp(`\\.sc-contrast i:nth-child\\(${n}\\) \\{ background: ([^;]+); \\}`)) || [])[1];
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): Black's swatch dots put back to the old colours (`.sc-contrast i:nth-child(1) { background: #79C2FF; }`) made this read
  //   FAIL  H3 Black is black background and white text, and its swatch in Settings shows exactly that
  check('H3 Black is black background and white text, and its swatch in Settings shows exactly that',
    tok('bg') === '#000000' && tok('ink') === '#FFFFFF' && /\.sc-contrast \{ background: #000;/.test(SITE)
    && chip(1) === '#FFF' && chip(3) === '#FFF' && chip(2) === '#8A8A8A',
    JSON.stringify({ bg: tok('bg'), ink: tok('ink'), dots: [chip(1), chip(2), chip(3)] }));

  const lean = ALL_CSS.filter(([, c]) => /data-hue|--pa-hue/.test(c)).map(([p]) => p);
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): `:root[data-hue] body { color: red; }` added to warm.css made this read
  //   FAIL  H4 nothing leans on a chosen hue, and the warm sheets carry no dash
  check('H4 nothing leans on a chosen hue, and the warm sheets carry no dash',
    !lean.length && SHEETS.every((p) => !DASH.test(CSS[p])), lean.join(' '));
}

console.log('\n--- before paint ---');
{
  const pages = readdirSync(join(ROOT, 'public')).filter((n) => n.endsWith('.html'));
  // RE-PINNED 2026-10-17 (v7.76): past the home a page sets Blue and green first and stands down for a chosen Warm; the
  // public pages read it as before. Either snippet counts, each in its own words.
  // NEGATIVE CONTROL (run 2026-10-17, v7.76): case.html's `if (!cool) delete document.documentElement.dataset.look;` taken out made H5 read FAIL.
  const SNIP2 = /document\.documentElement\.dataset\.look = 'cool';\n\s+try \{\n[\s\S]*?var cool = localStorage\.getItem\('pa-look'\) !== 'warm';\n\s+if \(!cool\) delete document\.documentElement\.dataset\.look;\n\s+var m = document\.querySelector/;
  const withLook = pages.filter((n) => /if \(cool\) document\.documentElement\.dataset\.look = 'cool';|var cool = localStorage\.getItem\('pa-look'\)/.test(f(`public/${n}`)));
  const hued = pages.filter((n) => /pa-hue|data-hue|dataset\.hue/.test(f(`public/${n}`)));
  const SNIP = /var cool = localStorage\.getItem\('pa-look'\) === 'cool';\n\s+if \(cool\) document\.documentElement\.dataset\.look = 'cool';\n\s+var m = document\.querySelector/;
  const bad = withLook.filter((n) => !SNIP.test(f(`public/${n}`)) && !SNIP2.test(f(`public/${n}`)));
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): the v7.64 hue line (`var hue = parseInt(localStorage.getItem('pa-hue'), 10);`) put back into index.html's snippet made this read
  //   FAIL  H5 every page with the look sets it before paint, and no page sets a hue
  check('H5 every page with the look sets it before paint, and no page sets a hue',
    withLook.length >= 30 && !bad.length && !hued.length, JSON.stringify({ bad, hued }));
}

console.log('\n--- theme.js and Settings ---');
{
  const store = new Map([['pa-hue', '144']]);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const meta = { content: '#1E1519', setAttribute(k, v) { this.content = v; } };
  const style = new Map();
  globalThis.document = { documentElement: { dataset: { scheme: 'calm' }, style: { setProperty: (k, v) => style.set(k, v), removeProperty: (k) => style.delete(k) } }, querySelector: () => meta, dispatchEvent: () => true };
  globalThis.CustomEvent = class { constructor(n, o) { this.type = n; this.detail = o?.detail; } };
  const T = await import(pathToFileURL(join(ROOT, 'public/js/theme.js')).href);
  const root = document.documentElement;
  const snap = () => ({ hue: root.dataset.hue, prop: style.get('--pa-hue'), scheme: root.dataset.scheme, look: root.dataset.look, stored: store.get('pa-look'), app: T.currentAppearance(), meta: meta.content });
  const first = snap();
  T.applyAppearance('cool');
  const cool = snap();
  T.applyAppearance('contrast');
  const black = snap();
  T.applyAppearance('warm');
  const warm = snap();
  T.applyAppearance('purple');
  const junk = snap();
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): applyAppearance's `else delete document.documentElement.dataset.look;` taken out made this read
  //   FAIL  H6 each look is kept and takes effect at once, Black takes over and leaving it brings the look back, and an old wheel colour is ignored
  check('H6 each look is kept and takes effect at once, Black takes over and leaving it brings the look back, and an old wheel colour is ignored',
    // RE-PINNED 2026-10-17 (v7.76): past the home a device that has chosen nothing is in Blue and green (the harness has no
    // address, so it reads as a page past the home); warm.mjs E1 runs the home and a service page.
    // NEGATIVE CONTROL (run 2026-10-17, v7.76): currentLook's fallback made `'warm'` for every page made H6 read FAIL.
    first.app === 'cool' && first.hue === undefined && first.prop === undefined && !('applyHue' in T) && !('currentHue' in T)
    && cool.look === 'cool' && cool.stored === 'cool' && cool.scheme === 'calm' && cool.app === 'cool' && cool.meta === '#0A0A0C'
    && black.scheme === 'contrast' && black.app === 'contrast' && black.meta === '#000000'
    && warm.look === undefined && warm.stored === 'warm' && warm.scheme === 'calm' && warm.app === 'warm' && warm.meta === '#1E1519'
    && junk.app === 'warm' && junk.stored === 'warm',
    JSON.stringify({ first, cool, black, warm, junk }));

  const SET = f('public/js/settings.js');
  const ids = T.APPEARANCES.map((x) => `${x.id}:${x.label}`);
  const sheet = SET.slice(SET.indexOf('>Appearance</h4>'), SET.indexOf('data-admin-rows'));
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): Blue and green taken out of APPEARANCES in theme.js made this read
  //   FAIL  H7 Settings offers Warm, Blue and green and Black as three swatches, Black is black background and white text, and there is no wheel
  check('H7 Settings offers Warm, Blue and green and Black as three swatches, Black is black background and white text, and there is no wheel',
    // RE-PINNED 2026-10-17 (v7.76): Blue and green is offered first, as the standard look past the home.
    // NEGATIVE CONTROL (run 2026-10-17, v7.76): APPEARANCES put back to Warm first made H7 read FAIL.
    ids.join('|') === 'cool:Blue and green|warm:Warm|contrast:Black'
    && /Black background, white text\. Easiest on sensitive eyes\./.test(T.APPEARANCES[2].blurb)
    && /APPEARANCES\.map\(\(x\) => `/.test(sheet) && /class="scheme-swatch/.test(sheet) && /applyAppearance\(b\.dataset\.scheme\);/.test(SET)
    && !/hue|wheel|slider|Blue and purple|High contrast/i.test(sheet) && !/applyHue|turnFor|WARM_HUE/.test(SET),
    JSON.stringify({ ids }));
}

console.log('\n--- a gradient in text ---');
{
  // A `background` shorthand after background-clip resets the clip, so a price painted in the gradient fills its box.
  const clipped = SHEETS.flatMap((p) => rules(CSS[p]).filter(([, b]) => /background-clip: text/.test(b)).map(([s, b]) => [p, s, b]));
  const lost = clipped.filter(([, , b]) => b.search(/(^|;)\s*background-clip: text/) < b.search(/(^|;)\s*background(-image)?:/))
    .map(([p, s]) => `${p}: ${s.slice(0, 80)}`);
  // NEGATIVE CONTROL (run 2026-10-17, v7.66): warm.css's price rule written clip first (`-webkit-background-clip: text; background-clip: text; background: var(--warm-pop);`) made this read
  //   FAIL  H8 a gradient written into text keeps its clip
  check('H8 a gradient written into text keeps its clip', clipped.length >= 3 && !lost.length, JSON.stringify({ clipped: clipped.length, lost }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
