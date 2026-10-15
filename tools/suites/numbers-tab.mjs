// numbers-tab.mjs - his numbers, pulled up from the foot of the home.
//
// Eric, 2026-10-15: "Go ahead and put my stats at the bottom of the landing
// page in brief; it will be a tab with an arrow that glows like the waitlist
// button and softly eases up and down in an ease in, ease out fashion every
// 1.5 seconds. When they grab it and swipe up it shows all of my stats."
//
// The brief and the pull's settle rule are imported and RUN; the motion and
// the glow are read off the sheet against the waitlist bubble's own rules.
// The pull itself is driven in a browser by drive-stats.mjs.
//
// Run: node numbers-tab.mjs
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync } from 'node:fs';
import { briefText, settles } from '../../public/js/stats-tab.js';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const IDX = f('public/index.html');
const CSS = f('public/css/landing.css');
const JS = f('public/js/stats-tab.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

console.log('\n--- A. the brief ---');
{
  const live = briefText({ replies: 116, replyMedianMin: 7, withinHourPct: 72, floor: true });
  const long = briefText({ replies: 40, replyMedianMin: 80, withinHourPct: 55 });
  // NEGATIVE CONTROL (run 2026-10-15): briefText's `s.replies > 0` test taken out made this read
  //   FAIL  A1 the tab's brief is the two reply figures, measured from the first message, and nothing at all before there are any
  check('A1 the tab\'s brief is the two reply figures, measured from the first message, and nothing at all before there are any',
    live === '7 min median reply · 72% within an hour' && long === '1 hr 20 min median reply · 55% within an hour'
    && briefText({ replies: 0, replyMedianMin: null }) === '' && briefText({ replies: 0, replyMedianMin: 0, withinHourPct: 0 }) === ''
    && briefText(null) === '',
    JSON.stringify([live, long]));
  // NEGATIVE CONTROL (run 2026-10-15): the tab unhidden before the brief was checked (`tab.hidden = false;` moved above `if (!brief) return;`) made this read
  //   FAIL  A2 the tab stays hidden until there is a brief to show, so a fresh deploy never shows a tab of ellipses
  check('A2 the tab stays hidden until there is a brief to show, so a fresh deploy never shows a tab of ellipses',
    /<button type="button" class="stats-tab" data-stats-tab aria-controls="stats-sheet" aria-expanded="false" hidden>/.test(IDX)
    && /const brief = briefText\(s\);\s*if \(!brief\) return;\s*tab\.querySelector\('\[data-stats-brief\]'\)\.textContent = brief;\s*tab\.hidden = false;/.test(JS));
}

console.log('\n--- B. the pull ---');
{
  // NEGATIVE CONTROL (run 2026-10-15): the flick half (`|| (pulledPx > 12 && pxPerMs > 0.5)`) taken out of settles made this read
  //   FAIL  B1 a pull past 60px or a quick flick opens it; a short slow pull or a nudge settles back
  check('B1 a pull past 60px or a quick flick opens it; a short slow pull or a nudge settles back',
    settles(70, 0.1) === true && settles(20, 0.8) === true && settles(30, 0.2) === false && settles(6, 2) === false);
  // NEGATIVE CONTROL (run 2026-10-15): the tab's click listener deleted made this read
  //   FAIL  B2 the sheet follows the finger up, a tap opens it too, and a pull down, the backdrop, Close or Escape put it away
  check('B2 the sheet follows the finger up, a tap opens it too, and a pull down, the backdrop, Close or Escape put it away',
    /tab\.addEventListener\('pointermove'[\s\S]*?place\(drag\.h - up\);/.test(JS)
    && /tab\.addEventListener\('click', \(\) => \{[\s\S]*?open\(\);\s*\}\);/.test(JS)
    && /if \(pulled > 80\) close\(\); else place\(null\);/.test(JS)
    && /sheet\.addEventListener\('click', \(e\) => \{ if \(e\.target === sheet\) close\(\); \}\);/.test(JS)
    && /\[data-stats-close\]'\)\?\.addEventListener\('click', close\);/.test(JS)
    && /if \(e\.key === 'Escape'\) close\(\);/.test(JS)
    && /touch-action: none;/.test(CSS.slice(CSS.indexOf('body.landing .stats-tab {'))));
}

console.log('\n--- C. the arrow ---');
{
  const tab = CSS.slice(CSS.indexOf('/* ---- BY THE NUMBERS, PULLED UP'));
  const bubble = CSS.slice(CSS.indexOf('body.landing .wl-bubble {'), CSS.indexOf('body.landing .wl-bubble::after'));
  const grad = (bubble.match(/background: (linear-gradient\([^;]+\));/) || [])[1];
  // NEGATIVE CONTROL (run 2026-10-15): stats-bob's duration set to 2s made this read
  //   FAIL  C1 the arrow wears the waitlist bubble's gradient, glow and sheen, and eases up and down once every 1.5 seconds, only for people who have not asked for less motion
  check('C1 the arrow wears the waitlist bubble\'s gradient, glow and sheen, and eases up and down once every 1.5 seconds, only for people who have not asked for less motion',
    !!grad && tab.includes(`background: ${grad};`)
    && /@media \(prefers-reduced-motion: no-preference\) \{\s*body\.landing \.stats-arrow \{ animation: stats-bob 1\.5s ease-in-out infinite, wl-glow 3s ease-in-out infinite; \}\s*body\.landing \.stats-arrow::before \{ animation: wl-shine 3\.6s ease-in-out infinite; \}/.test(tab)
    && /@keyframes stats-bob \{\s*0%, 100% \{ transform: translateY\(0\); \}\s*50% \{ transform: translateY\(-6px\); \}/.test(tab)
    && !/\.stats-arrow \{[^}]*animation/.test(tab.slice(0, tab.indexOf('@media (prefers-reduced-motion'))),
    grad || 'no bubble gradient');
  // NEGATIVE CONTROL (run 2026-10-15): the main padding rule taken out made this read
  //   FAIL  C2 the tab sits left of the question bubble, never covers a button on the page, and steps aside while a menu screen is open
  check('C2 the tab sits left of the question bubble, never covers a button on the page, and steps aside while a menu screen is open',
    /right: calc\(max\(16px, env\(safe-area-inset-right\)\) \+ 66px\);/.test(tab)
    && /body\.landing:has\(\.stats-tab:not\(\[hidden\]\)\) main \{ padding-bottom: 96px; \}/.test(tab)
    && /body\.landing:has\(main > \.land-sec\.ruled:target, \.site-foot:target\) \.stats-tab \{ display: none; \}/.test(tab)
    && /<use href="\/img\/icons\.svg#i-chev"\/>/.test(IDX) && /\.stats-arrow svg \{[^}]*transform: rotate\(-90deg\);/.test(tab));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const r of failed) console.log(`  FAILED: ${r.name}`);
  process.exit(1);
}
