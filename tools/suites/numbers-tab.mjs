// numbers-tab.mjs - his numbers on the home: pulled up, then taken off.
//
// Eric, 2026-10-15: "Go ahead and put my stats at the bottom of the landing
// page in brief; it will be a tab with an arrow that glows like the waitlist
// button and softly eases up and down in an ease in, ease out fashion every
// 1.5 seconds. When they grab it and swipe up it shows all of my stats."
// Then, the same day: "Once you've drafted my listing remove the stats tab on
// the landing page."
//
// RE-PINNED 2026-10-15 (v7.42): every check now holds the removal. The tab,
// its sheet, its script and its rules are gone from the home; the numbers
// keep their own page (stats.html), linked from the footer.
//
// Run: node numbers-tab.mjs
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const IDX = f('public/index.html');
const CSS = f('public/css/landing.css');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

console.log('\n--- A. the brief ---');
{
  // RE-PINNED 2026-10-15 (v7.42): the brief's module is gone with the tab.
  // NEGATIVE CONTROL (run 2026-10-15, v7.42): the script tag put back in index.html made this read
  //   FAIL  A1 the home loads no numbers tab: its module is gone and nothing on the home asks for it
  check('A1 the home loads no numbers tab: its module is gone and nothing on the home asks for it',
    !existsSync(__j(__REPO, 'public/js/stats-tab.js')) && !/stats-tab\.js/.test(IDX) && !/import\('\/js\/stats\.js'\)/.test(IDX));
  // RE-PINNED 2026-10-15 (v7.42): no tab, hidden or shown.
  // NEGATIVE CONTROL (run 2026-10-15, v7.42): the tab's button put back in index.html made this read
  //   FAIL  A2 there is no tab on the home, hidden or shown
  check('A2 there is no tab on the home, hidden or shown', !/data-stats-tab|class="stats-tab"/.test(IDX));
}

console.log('\n--- B. the pull ---');
{
  // RE-PINNED 2026-10-15 (v7.42): no sheet to pull up.
  // NEGATIVE CONTROL (run 2026-10-15, v7.42): the sheet put back in index.html made this read
  //   FAIL  B1 there is no sheet to pull up, and the figures live on their own page, linked from the footer
  check('B1 there is no sheet to pull up, and the figures live on their own page, linked from the footer',
    !/data-stats-sheet|id="stats-sheet"/.test(IDX) && /<a href="\/stats\.html">By the numbers<\/a>/.test(IDX));
  // RE-PINNED 2026-10-15 (v7.42): nothing left to wire.
  // NEGATIVE CONTROL (run 2026-10-15, v7.42): `touch-action: none;` left in a stats-tab rule in landing.css made this read
  //   FAIL  B2 the stylesheet carries none of the tab's or the sheet's rules
  check('B2 the stylesheet carries none of the tab\'s or the sheet\'s rules', !/stats-tab|stats-sheet|stats-card|stats-grab/.test(CSS));
}

console.log('\n--- C. the arrow ---');
{
  // RE-PINNED 2026-10-15 (v7.42): the arrow and its motion went with the tab.
  // NEGATIVE CONTROL (run 2026-10-15, v7.42): the stats-bob keyframes put back in landing.css made this read
  //   FAIL  C1 no arrow, no bob, and the waitlist bubble keeps its own glow untouched
  check('C1 no arrow, no bob, and the waitlist bubble keeps its own glow untouched',
    !/stats-bob|stats-arrow/.test(CSS) && /body\.landing \.wl-bubble \{ animation: wl-glow 3\.6s ease-in-out infinite; \}/.test(CSS));
  // RE-PINNED 2026-10-15 (v7.42): the room the tab took at the foot of the page is given back.
  // NEGATIVE CONTROL (run 2026-10-15, v7.42): the `padding-bottom: 96px` rule put back made this read
  //   FAIL  C2 the page no longer keeps room at its foot for a tab
  check('C2 the page no longer keeps room at its foot for a tab', !/padding-bottom: 96px/.test(CSS));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const r of failed) console.log(`  FAILED: ${r.name}`);
  process.exit(1);
}
