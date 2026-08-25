// maintenance.mjs — the front-door maintenance window.
// Run: node maintenance.mjs
//
// The one that matters is M1. If the page says "back at 1PM" while the Worker
// still answers /api/checkout, somebody gets charged inside a window that was
// supposed to be shut, and the notice is what convinced them it was safe to
// try. The two timestamps are pinned to each other here.
// Repo-rooted: this file runs from tools/suites/ inside the repository, so
// the sources it asserts against are found relative to itself, wherever the
// repo is checked out.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';

const ROOT = __REPO;
const SRC = readFileSync(`${ROOT}/worker/index.js`, 'utf8');
const CLIENT = readFileSync(`${ROOT}/public/js/maintenance.js`, 'utf8');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

const workerUntil = (SRC.match(/const MAINTENANCE_UNTIL = '([^']+)'/) || [])[1];
const clientUntil = (CLIENT.match(/MAINTENANCE_UNTIL = '([^']+)'/) || [])[1];

check('M1 the Worker and the page name the SAME instant',
  !!workerUntil && workerUntil === clientUntil, `worker=${workerUntil} client=${clientUntil}`);
check('M2 that instant is 1PM MST on 2026-08-25 (MST is a fixed UTC-7)',
  workerUntil === '2026-08-25T20:00:00Z', workerUntil);

// The gate itself.
check('M3 the Worker refuses checkout during the window',
  /maintenanceUntil\(\)[\s\S]{0,200}'\/api\/checkout'/.test(SRC));
check('M4 and subscribe too',
  /maintenanceUntil\(\)[\s\S]{0,200}'\/api\/subscribe'/.test(SRC));
check('M5 it answers 503, not a silent 200',
  /maintenanceMessage\(\), maintenanceUntil: MAINTENANCE_UNTIL \}, 503\)/.test(SRC));

// Ordering: the guard has to sit ABOVE the real handlers or it never runs.
const guardAt = SRC.indexOf('maintenanceUntil()\n');
const checkoutAt = SRC.indexOf("if (url.pathname === '/api/checkout' && request.method === 'POST')");
check('M6 the guard is above the checkout route, so it actually fires',
  guardAt > 0 && checkoutAt > 0 && guardAt < checkoutAt, `guard@${guardAt} route@${checkoutAt}`);

// The window opens and closes on its own.
const fn = SRC.match(/function maintenanceUntil\(\)[\s\S]*?\n\}/)[0];
const until = Date.parse(workerUntil);
const run = (now) => {
  const f = new Function('Date', 'MAINTENANCE_UNTIL', `${fn}; return maintenanceUntil();`);
  return f(Object.assign(class extends Date {}, { parse: Date.parse, now: () => now }), workerUntil);
};
check('M7 shut one second before the deadline', run(until - 1000) === until);
check('M8 open again one second after — it lifts itself', run(until + 1000) === 0);
check('M9 shut well inside the window', run(until - 6 * 3600_000) === until);

// The words Eric asked for, exactly.
check('M10 the page carries his sentence verbatim',
  CLIENT.includes("'Under Maintenance Until 1PM MST 8/25/26'"));

// Wired to the front door, and NOWHERE a current client goes.
const has = (f) => readFileSync(`${ROOT}/public/${f}`, 'utf8').includes('/js/maintenance.js');
check('M11 on the landing page', has('index.html'));
check('M12 on the booking page', has('book.html'));
check('M13 on the subscribe page', has('subscribe.html'));
for (const f of ['case.html', 'chat.html', 'signin.html', 'subscription.html'])
  check(`M14 NOT on ${f} — existing clients are unaffected`, !has(f));

// The overlay must not wall a current client out of their own case.
check('M15 the notice keeps a live route to sign in',
  /href="\/signin\.html"/.test(CLIENT));
check('M16 and says plainly that current clients are unaffected',
  /already a client, nothing has changed/i.test(CLIENT));

// Only the money routes. A blanket block would take the whole app down.
check('M17 the guard names exactly two routes, both of them purchases',
  (SRC.match(/maintenanceUntil\(\)\n\s*&& \(url\.pathname === '\/api\/checkout' \|\| url\.pathname === '\/api\/subscribe'\)/) || []).length === 1);

// The demo drives booking end to end; a scrim would turn a real failure green.
check('M18 the demo is exempt', /pa-demo|demo/.test(CLIENT.split('export function initMaintenance')[1] || ''));

// Purchase links are neutered for keyboard and screen-reader users too.
check('M19 book/subscribe links lose their href, not just their clicks',
  /removeAttribute\('href'\)/.test(CLIENT) && /aria-disabled/.test(CLIENT));

// The filter must sit on the overlay's SIBLINGS. On an ancestor it would
// become the containing block for position:fixed and move the notice.
check('M20 the grey is applied to siblings, not an ancestor',
  /body > \*:not\(\.pa-maint\)[\s\S]{0,120}grayscale/.test(CLIENT));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
