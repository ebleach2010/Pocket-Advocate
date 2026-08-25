// defects.mjs — the defects the three-agent sweep found, pinned so they cannot
// come back. Behavioural where the logic can be lifted; source-pinned where the
// fix is a shape rather than a function. Run: node defects.mjs
// Repo-rooted: this file runs from tools/suites/ inside the repository, so
// the sources it asserts against are found relative to itself, wherever the
// repo is checked out.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';
const R = __REPO;
const W = readFileSync(`${R}/worker/index.js`, 'utf8');
const ADV = readFileSync(`${R}/worker/advisor.js`, 'utf8');
const f = (p) => readFileSync(`${R}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ck = (n, c, d = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, d); } };

// ---- 1. the appeal ladder can reach every rung --------------------------
const DAYS = JSON.parse(W.match(/const APPEAL_WARN_DAYS = (\[[^\]]+\]);/)[1]);
const rungFor = new Function('daysLeft', 'APPEAL_WARN_DAYS',
  `return ${W.match(/const rung = (APPEAL_WARN_DAYS[^;]+);/)[1]};`);
for (const [left, want] of [[14, 14], [4, 14], [3, 3], [0, 3], [-5, 3]]) {
  ck(`appeal ladder: ${left} days left picks the ${want}-day rung`,
     rungFor(left, DAYS) === want, String(rungFor(left, DAYS)));
}
// and the guard must let a lower rung through after a higher one has fired
const guard = (warnedAt, rung) => !(Number(warnedAt) && Number(warnedAt) <= rung);
ck('appeal ladder: the 3-day warning survives the 14-day one', guard(14, 3));
ck('appeal ladder: a rung never fires twice', !guard(3, 3));

// ---- 2. the filing deadline is a whole MST day --------------------------
const dueOf = new Function('meta', `
  ${W.match(/(\/\/ dueAt is a bare[\s\S]*?const due = [\s\S]*?;\n)/)[1]}
  return due;`);
const due = dueOf({ dueAt: '2027-01-28' });
ck('deadline: a bare date means end of day MST, not UTC midnight',
   due === Date.parse('2027-01-28T23:59:59-07:00'), new Date(due).toISOString());
ck('deadline: it is no longer a day early',
   new Date(due).toLocaleDateString('en-US', { timeZone: 'Etc/GMT+7' }) === '1/28/2027',
   new Date(due).toLocaleDateString('en-US', { timeZone: 'Etc/GMT+7' }));

// ---- 3. firstName is never empty ----------------------------------------
const firstName = new Function('v', W.match(/function firstName\(v\) \{([\s\S]*?)\n\}/)[1]);
for (const [input, label] of [[null, 'null'], ['', 'empty'], ['   ', 'blank'], [undefined, 'undefined']]) {
  const out = firstName(input);
  ck(`firstName: ${label} still yields a name`, !!out && out.trim().length > 0, JSON.stringify(out));
}
ck('firstName: a real name is untouched', firstName('Jordan Avery') === 'Jordan');
ck('firstName: an email never reaches a lock screen whole',
   firstName('jordan@example.com') === 'jordan');

// ---- 4. no Infinity, and the clause is dropped when unknown -------------
ck('nudge: awayMin is null rather than Infinity when there is no beacon',
   /const awayMin = Number\.isFinite\(seenAt\) && seenAt > 0/.test(W)
   && !/: Infinity;/.test(W));
ck('nudge: the body omits the closed-for clause it cannot fill',
   /awayMin === null \? '' : ` and the app has been closed for/.test(W));
ck('nudge: an unknown absence starts at the first rung, not the loudest',
   /awayMin === null\n\s*\? WORK_NUDGE_MINUTES\[0\]/.test(W));

// ---- 5. the upgrade payment is not counted twice ------------------------
ck("paid sums: Eric's chart excludes the settled tier row",
   /kind !== 'tip' && x\.kind !== 'fullaccess'/.test(f('public/js/admin-case.js')));
ck('paid sums: the advisor economics note excludes it too',
   /else if \(p\?\.kind !== 'fullaccess'\) paidCents \+= cents;/.test(ADV));

// ---- 5b. the tip jar is gone, everywhere -------------------------------
const CASEJS = f('public/js/case.js');
ck('tip jar: nothing on the client case page asks for one',
   !/data-tip|tipJarHtml|TIP_QUOTE|sendTip|totalPaidCents/.test(CASEJS));
ck('tip jar: the update flow no longer ends on a copy of it',
   !/jarSrc|data-tip-jar/.test(f('public/js/changelog.js')));
ck('tip jar: the switch is gone from the dashboard',
   !/tip-jar-on|tipToggle|settings', 'tipJar/.test(f('public/js/admin.js')));
ck('tip jar: the route is closed rather than left live',
   /\/api\/tip' && request\.method === 'POST'\)\n\s*return json\(\{ error: 'Not found' \}, 404\);/.test(W)
   && !/async function handleTip/.test(W));
ck('tip jar: the ledger still reconciles tips already received',
   /kind === 'tip'/.test(W));

// ---- 6. economicsNote cannot emit 1h 60m --------------------------------
const spentOf = new Function('econ', 'hours', `
  return ${ADV.match(/const spent = hours >= 1\n([\s\S]*?);\n/)[0].replace(/^\s*const spent = /, '').replace(/;\n$/, '')};`);
for (const secs of [7170, 3599, 3600, 7199]) {
  const out = spentOf({ seconds: secs }, secs / 3600);
  ck(`economics: ${secs}s never renders 60m`, !/\b60m\b/.test(out), out);
}

// ---- 7. ceilings quote the constants in force ---------------------------
ck('ceilings: every ping interpolates its own constant, none are typed',
   /CASE_CAP_CENTS \/ 100/.test(W) && /ADDON_CAP_CENTS \/ 100/.test(W)
   && /SUB_CAP_CENTS \/ 100/.test(W) && /FULL_CAP_CENTS \/ 100/.test(W)
   && !/its \$1,000 ceiling/.test(W) && !/its \$500 ceiling/.test(W));

// ---- 8. the work clock ---------------------------------------------------
const AC = f('public/js/admin-case.js');
const liveOf = new Function('clock', 'now',
  `const Date = { now: () => now };
   ${AC.match(/const live = \(\) => Math\.max\(0, clock\.seconds[\s\S]*?\);\n/)[0]}
   return live();`);
ck('clock: a phone behind the server never renders a negative',
   liveOf({ seconds: 0, startedAt: 1000 }, 995) === 0, String(liveOf({ seconds: 0, startedAt: 1000 }, 995)));
ck('clock: one stretch banks at most twelve hours on his screen too',
   liveOf({ seconds: 0, startedAt: 0 + 1 }, 1 + 64 * 3600 * 1000) === 12 * 3600);
ck('clock: nothing may start on a closed case',
   /doc\.data\.status === 'closed' && body\?\.on === true/.test(W));
ck('clock: a closed case gets no badge on the shelf',
   /clock: c\.status === 'closed' \? null : \{/.test(f('public/js/admin.js')));
ck('clock: the shelf badge always carries a word',
   /: \(started \? '0m' : 'Start'\)/.test(f('public/js/admin.js')));
ck('clock: the badge carries the state its ticker reads',
   /data-started="\$\{Number\(clock\.startedAt\) \|\| 0\}"/.test(f('public/js/drawer.js'))
   && /data-banked="\$\{Number\(clock\.banked\) \|\| 0\}"/.test(f('public/js/drawer.js')));
ck('clock: the shelf tap no longer depends on listener order',
   !/\[data-clock\]'\)\) \{\n\s*e\.preventDefault\(\);\n\s*e\.stopPropagation\(\);/.test(f('public/js/drawer.js')));
ck('clock: a hand stop survives walking out and back',
   /function suppressAuto\(on\)/.test(AC) && /if \(!autoSuppressed\(\) && data\?\.status !== 'closed'\)/.test(AC));
ck('clock: auto-start runs after the case loads, not racing it',
   /if \(!autoClockTried\) \{/.test(AC) && !/load\(\); autoClockOn\(\); \}/.test(AC));
ck('clock: the "still working?" card outlives the render it used to sit in',
   /const el = document\.querySelector\('main'\) \|\| document\.body;/.test(AC));

// ---- 9. purchases are not stolen or dead --------------------------------
const CJ = f('public/js/case.js');
ck('purchase: a poll repaint leaves an in-progress pane alone',
   /if \(progress && !busyInside\(progress\)\)/.test(CJ) && /function busyInside\(pane\)/.test(CJ));
ck('purchase: the upgrade card and its POST quote one number',
   /function upgradeQuoteCents\(c\)/.test(CJ)
   && /quotedCents: upgradeQuoteCents\(c\)/.test(CJ)
   && /Math\.round\(upgradeQuoteCents\(c\) \/ 100\)/.test(CJ));
ck('purchase: the card repaints when the live price lands',
   /ratesReady\.then\(\(\) => \{/.test(CJ));
const BK = f('public/js/book.js');
ck('booking: both early returns strip the controls they cannot wire',
   (BK.match(/\n {4}stripUnwiredStep1\(el/g) || []).length === 2
   && /function stripUnwiredStep1\(el/.test(BK));
ck('booking: a failed calendar read says what to do next',
   /Reload the page and it usually comes back/.test(BK));

// ---- 10. legal records carry one date -----------------------------------
const AU = f('public/js/authority.js');
ck('authority: dates are MST, so one signature is one date',
   /timeZone: 'Etc\/GMT\+7', year: 'numeric'/.test(AU));
ck('authority: a missing stamp says so instead of "Invalid Date"',
   /return '\(not yet signed\)';/.test(AU));

// ---- 11. the scope note only claims what the code counts ----------------
const TT = f('public/js/tier-terms.js');
for (const gone of ['90 days', 'up to <strong>five</strong>', 'three three-way']) {
  ck(`scope note: "${gone}" is gone`, !TT.includes(gone));
}
ck('scope note: it promises 60 days and two letters, both enforced',
   /<strong>60 days<\/strong>/.test(TT) && /<strong>Two insurance appeal letters<\/strong>/.test(TT));
ck('scope note: it says the second letter outlives the window',
   /second appeal letter does not expire with the window/.test(TT));
ck('scope note: it says the clock runs from the first call regardless',
   /the 60 days runs from our first call whether or not you have signed/.test(TT));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
