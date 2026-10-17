// smooth.mjs - smooth scrolling, no sideways scroll, and Blue and green past the home (v7.76).
//
// Eric, 2026-10-17: "The app is having some hitching when scrolling in areas, and the landing page has side scroll".
// And: "Change the standard color for clients and advocates past the main page to green/blue that's in settings.
// This includes the preview in the main page. Landing page is untouched."
//
//   M1 the moving light holds still while a page scrolls: smooth.js pauses every animation on html.pa-scrolling, set on
//      the first scroll (the page's or a panel's) and cleared 180ms after the last, and every page loads it
//   M2 the home's card rows wrap rather than run past the card, and the page body clips anything that still would
//   M3 past the home every page sets Blue and green before it paints and stands down only for a chosen Warm; the home
//      and the three service pages keep theirs
import { readFileSync, readdirSync } from 'node:fs';
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

// ---- M1: run smooth.js against a stand-in page -------------------------------------------------------------------
{
  const classes = new Set();
  const listeners = [];
  const timers = new Map(); let tid = 0;
  const head = []; const byId = new Map();
  globalThis.document = {
    documentElement: { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } },
    getElementById: (id) => byId.get(id) || null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (el) => { head.push(el); if (el.id) byId.set(el.id, el); } },
    addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }),
  };
  globalThis.setTimeout = (fn, ms) => { tid += 1; timers.set(tid, { fn, ms }); return tid; };
  globalThis.clearTimeout = (id) => timers.delete(id);
  await import(pathToFileURL(join(ROOT, 'public/js/smooth.js')).href);
  const scroll = listeners.find((l) => l.type === 'scroll');
  scroll?.fn(); const afterFirst = classes.has('pa-scrolling');
  scroll?.fn(); const pending = timers.size;
  const last = [...timers.values()].pop();
  last?.fn(); const afterStop = classes.has('pa-scrolling');
  const pages = readdirSync(join(ROOT, 'public')).filter((n) => n.endsWith('.html') && n !== 'fund.html');
  const NAV = f('public/js/nav-menu.js');
  // NEGATIVE CONTROL (run 2026-10-17): smooth.js's `capture: true` made `capture: false` made this read
  //   FAIL  M1 the moving light holds still while a page scrolls: paused on the first scroll, the page's or a panel's, and moving again 180ms after the last, on every page
  check('M1 the moving light holds still while a page scrolls: paused on the first scroll, the page\'s or a panel\'s, and moving again 180ms after the last, on every page',
    head[0]?.id === 'pa-smooth' && head[0].textContent === 'html.pa-scrolling *, html.pa-scrolling *::before, html.pa-scrolling *::after { animation-play-state: paused !important; }'
    && scroll?.opts?.passive === true && scroll.opts.capture === true
    && afterFirst && pending === 1 && last?.ms === 180 && !afterStop
    && /^\/\/ The pages' moving light holds still while they scroll \(2026-10-17\)\.\nimport '\.\/smooth\.js';$/m.test(NAV)
    && pages.every((n) => /<script type="module" src="\/js\/nav-menu\.js"><\/script>/.test(f(`public/${n}`)))
    && !DASH.test(f('public/js/smooth.js')),
    JSON.stringify({ afterFirst, pending, ms: last?.ms, afterStop, opts: scroll?.opts }));
}

// ---- M2 ------------------------------------------------------------------------------------------------------------
{
  const CSS = f('public/css/landing.css');
  // NEGATIVE CONTROL (run 2026-10-17): the row's `flex-wrap: wrap;` put back to `flex-wrap: nowrap;` made this read
  //   FAIL  M2 the home's card rows wrap rather than run past the card, and the page body clips anything that still would
  check('M2 the home\'s card rows wrap rather than run past the card, and the page body clips anything that still would',
    /body\.landing \.opt-acts \{ flex-wrap: wrap; margin-top: \.2rem; gap: \.3rem \.7rem; \}/.test(CSS)
    && /body\.landing > main \{ overflow-x: clip; \}/.test(CSS)
    && !/body\.landing \.opt-acts \{[^}]*nowrap/.test(CSS.slice(CSS.indexOf('NO SIDEWAYS SCROLL'))));
}

// ---- M3 ------------------------------------------------------------------------------------------------------------
{
  const PUBLIC = ['index.html', 'advocacy-case.html', 'full-service.html', 'priority-chat.html'];
  const pages = readdirSync(join(ROOT, 'public')).filter((n) => n.endsWith('.html') && n !== 'fund.html');
  const app = pages.filter((n) => !PUBLIC.includes(n));
  const appOk = app.every((n) => {
    const h = f(`public/${n}`);
    const first = h.indexOf("document.documentElement.dataset.look = 'cool';");
    return first >= 0 && first < h.indexOf('try {')
      && /var cool = localStorage\.getItem\('pa-look'\) !== 'warm';\n\s+if \(!cool\) delete document\.documentElement\.dataset\.look;/.test(h);
  });
  const pubOk = PUBLIC.every((n) => /var cool = localStorage\.getItem\('pa-look'\) === 'cool';\n\s+if \(cool\) document\.documentElement\.dataset\.look = 'cool';/.test(f(`public/${n}`)));
  // NEGATIVE CONTROL (run 2026-10-17): case.html's first line `document.documentElement.dataset.look = 'cool';` taken out made this read
  //   FAIL  M3 past the home every page sets Blue and green before it paints and stands down only for a chosen Warm; the home and the three service pages keep theirs
  check('M3 past the home every page sets Blue and green before it paints and stands down only for a chosen Warm; the home and the three service pages keep theirs',
    app.length >= 26 && appOk && pubOk && app.includes('case.html') && app.includes('admin.html'),
    JSON.stringify({ bad: app.filter((n) => !/var cool = localStorage\.getItem\('pa-look'\) !== 'warm';/.test(f(`public/${n}`))) }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
