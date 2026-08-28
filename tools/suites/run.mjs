// The full suite battery, one command:  node tools/suites/run.mjs
//
// ERIC'S RULE (2026-08-25, his words): "I want full suites before being
// pushed to main." So this is the gate. Every suite in this directory runs,
// every one must pass, and a single red line means NOTHING is pushed to
// main - not a hotfix, not a one-liner, not a copy change. The rule exists
// because a one-line hotfix broke his dashboard once and nothing caught it.
//
// What the battery is NOT: browser drives and the blindness audit need a
// running server and a real browser, so they cannot live in this runner.
// They are run per-change from the working session (docs/SUITES.md), and
// the blindness audit is tools/blindness-audit.mjs against a local server.
// This runner is the floor, not the ceiling.
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const suites = readdirSync(here)
  .filter((f) => f.endsWith('.mjs') && f !== 'run.mjs')
  .sort();

// THE GATE HAS TO KNOW HOW MANY SUITES THERE SHOULD BE.
//
// It counted whatever it discovered and reported success against that count,
// so on a tree with no suites in it at all this printed
//
//   0/0 suites green
//   Battery clear.        exit 0
//
// A partial checkout is likelier and worse: three suites of twenty reads
// "3/3 suites green, Battery clear" in exactly the same voice as a full run,
// and anything shaped `node tools/suites/run.mjs && <ship>` ships on it. This
// is the gate CLAUDE.md names as the reason the battery exists, and it was the
// one tool here that could bless nothing at all.
//
// The floor sits BELOW the current count on purpose. It is a guard against a
// tree that is not really there, not a pin on the number of suites, and a pin
// would go stale every time somebody adds one. Raise it when the count grows
// enough that the gap stops meaning anything.
const FLOOR = 18;
if (suites.length < FLOOR) {
  console.log(`Found ${suites.length} suite${suites.length === 1 ? '' : 's'} in ${here},`
    + ` expected at least ${FLOOR}.`);
  console.log('That is not a battery, it is a partial tree. Nothing goes to main like this.');
  process.exit(1);
}

let failed = 0;
const rows = [];
for (const f of suites) {
  let tail = '';
  let ok = true;
  try {
    const out = execFileSync(process.execPath, [join(here, f)], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120_000,
    });
    tail = out.trim().split('\n').pop() || '';
  } catch (err) {
    ok = false;
    failed += 1;
    const out = `${err.stdout || ''}${err.stderr || ''}`.trim();
    tail = out.split('\n').filter((l) => /FAIL|Error/.test(l)).slice(0, 4).join(' | ')
      || out.split('\n').pop() || String(err.message);
  }
  rows.push(`${ok ? 'PASS' : 'FAIL'}  ${f.padEnd(16)} ${tail}`);
  console.log(rows[rows.length - 1]);
}

console.log(`\n${suites.length - failed}/${suites.length} suites green`);
if (failed) {
  console.log('RED. Nothing goes to main like this.');
  process.exit(1);
}
console.log('Battery clear.');
