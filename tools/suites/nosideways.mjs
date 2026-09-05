// nosideways.mjs - no pinch zoom, no side-to-side scroll (Eric, 2026-09-05).
//
//   node tools/suites/nosideways.mjs
//
// Eric: "The app has side to side scroll, particularly if zoomed in. I'd
// prefer you can't use your fingers to zoom in at all and prevent side to
// side scroll altogether." Three layers, because no one of them reaches
// every browser: the viewport meta (the home-screen app and Android honour
// it), the gesture guard in nav-menu.js (Safari in the browser ignores the
// meta and honours this), and the root's touch-action in site.css. Then the
// three things the phone-width sweep found sticking out past the right edge,
// pinned so they cannot come back. The sweep itself is
// tools/drives/drive-nosideways.mjs, run against a local server.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f(import.meta.url)), '..', '..');
const read = (p) => readFileSync(j(ROOT, p), 'utf8');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

const PAGES = readdirSync(j(ROOT, 'public')).filter((x) => x.endsWith('.html')).sort();
const META = '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">';

// NEGATIVE CONTROL (run 2026-09-05): `,user-scalable=no` dropped from about.html's meta made this read
//   FAIL  N1 every page tells the browser the app does not zoom: one viewport meta, scale locked at one, not user scalable
{
  const bad = PAGES.filter((p) => { const s = read(`public/${p}`); return s.split(META).length !== 2 || (s.match(/name="viewport"/g) || []).length !== 1; });
  check('N1 every page tells the browser the app does not zoom: one viewport meta, scale locked at one, not user scalable',
    PAGES.length >= 20 && bad.length === 0, `${PAGES.length} pages; wrong: ${bad.join(', ') || 'none'}`);
}

// The guard, lifted from nav-menu.js and run against a fake document: a
// pinch (Safari's gesture events, or two fingers moving) is cancelled, one
// finger scrolling is not.
{
  const NAV = read('public/js/nav-menu.js');
  const carriers = PAGES.filter((p) => /src="\/js\/nav-menu\.js[^"]*"/.test(read(`public/${p}`)));
  const start = NAV.indexOf('export function refuseZoom(');
  const end = NAV.indexOf('\n}\n', start) + 3;
  const src = start >= 0 ? NAV.slice(start, end).replace(/^export /, '') : '';
  const listeners = {};
  const fakeDoc = { addEventListener: (ev, fn, opts) => { listeners[ev] = { fn, opts }; } };
  let ran = false;
  try { new Function(`${src}\n return refuseZoom;`)()(fakeDoc); ran = true; } catch { /* reported below */ }
  const fire = (ev, e) => { let prevented = false; listeners[ev]?.fn({ ...e, preventDefault: () => { prevented = true; } }); return prevented; };
  // NEGATIVE CONTROL (run 2026-09-05): the two-finger touchmove test changed to `if (false)` made this read
  //   FAIL  N2 the guard rides on every page and refuses a pinch, in Safari's words and in everyone else's, while one finger still scrolls
  check('N2 the guard rides on every page and refuses a pinch, in Safari\'s words and in everyone else\'s, while one finger still scrolls',
    carriers.length === PAGES.length && ran && /^refuseZoom\(\);$/m.test(NAV)
    && ['gesturestart', 'gesturechange', 'gestureend', 'touchmove'].every((ev) => listeners[ev] && listeners[ev].opts?.passive === false)
    && fire('gesturestart', {}) && fire('gesturechange', {}) && fire('gestureend', {})
    && fire('touchmove', { touches: [1, 2] }) && fire('touchmove', { touches: [1], scale: 1.4 })
    && !fire('touchmove', { touches: [1] }) && !fire('touchmove', { touches: [1], scale: 1 }),
    `carriers ${carriers.length}/${PAGES.length}, ran ${ran}, listeners ${Object.keys(listeners).join(',')}`);
}

const SITE = read('public/css/site.css');
// NEGATIVE CONTROL (run 2026-09-05): `touch-action: pan-y;` dropped from the root rule made this read
//   FAIL  N3 the root lets a finger move the page up and down only, never sideways and never into a zoom, and clips anything wider than the screen
check('N3 the root lets a finger move the page up and down only, never sideways and never into a zoom, and clips anything wider than the screen',
  /^html \{ touch-action: pan-y; overscroll-behavior-x: none; \}$/m.test(SITE)
  && /^body \{ overscroll-behavior-x: none; \}$/m.test(SITE)
  && /^html, body \{ overflow-x: hidden; overflow-x: clip; \}$/m.test(SITE));

const GLOW = read('public/css/glowup.css');
const ADM = read('public/css/admin.css');
// NEGATIVE CONTROL (run 2026-09-05): the `p > .pill` rule removed from glowup.css made this read
//   FAIL  N4 the three things the sweep found past the right edge wrap now: the about page's door pills, the office fold's reason, the work clock's readout
check('N4 the three things the sweep found past the right edge wrap now: the about page\'s door pills, the office fold\'s reason, the work clock\'s readout',
  /^p > \.pill \{ max-width: 100%; white-space: normal; \}$/m.test(GLOW)
  && /^\.office-fold > summary \.dim:not\(\.office-why\) \{ flex: 0 0 auto; \}$/m.test(ADM)
  && /\.office-fold > summary \{\n  display: flex;\n(?:\s*\/\*[\s\S]*?\*\/\n)?  flex-wrap: wrap;/.test(ADM)
  && /^\.office-fold \.office-why \{ flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; \}$/m.test(ADM)
  && /^\.btn\.work-total-btn \{ white-space: normal; text-align: left; max-width: 100%; \}$/m.test(ADM));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
