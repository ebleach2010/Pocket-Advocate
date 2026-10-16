// twoweeks.mjs - the Advocacy Case report, in two weeks.
//
// Eric, 2026-10-15: "Make the advocacy case two weeks to deliver and update
// that timeframe anywhere else it's noted, including the agreement when they
// sign up."
//
// The clock the Worker starts is read off its one constant; every sentence a
// client or Eric reads about the report names the same 14 days; and nothing
// anywhere still promises 7. The agreement itself never stated a timeframe;
// the line under it on the booking page did, and it is pinned here.
//
// Run: node twoweeks.mjs
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const W = f('worker/index.js');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

console.log('\n--- A. the clock ---');
{
  const rec = W.slice(W.indexOf("} else if (action === 'recording-uploaded') {"), W.indexOf("} else if (action === 'summary-uploaded') {"));
  // NEGATIVE CONTROL (run 2026-10-15): the report clock put back to `now.getTime() + 7 * 86_400_000` made this read
  //   FAIL  A1 the call ends and the clock runs REPORT_DAYS, which is 14, and the client's email says the same number with no dash
  check('A1 the call ends and the clock runs REPORT_DAYS, which is 14, and the client\'s email says the same number with no dash',
    /\nconst REPORT_DAYS = 14;/.test(W)
    && /const fields = \{ reportDueAt: new Date\(now\.getTime\(\) \+ REPORT_DAYS \* 86_400_000\) \};/.test(rec)
    && /Expect it within\s+<strong>\$\{REPORT_DAYS\} days<\/strong>\. Some reports take slightly longer/.test(rec)
    && /subject: 'Great meeting\. Your report is on the way',/.test(rec)
    && !/[\u2014\u2013]/.test(rec.slice(rec.indexOf('sendEmail'))));
}

console.log('\n--- B. the words ---');
{
  const SAYS = [
    ['public/index.html', 'and a written report within 14 days.</span>'],
    ['public/advocacy-case.html', 'and a written report within 14 days.'],
    ['public/advocacy-case.html', '<li>Within 14 days, I send you a written case report'],
    ['public/services.html', 'and a written report within 14 days that organizes'],
    ['public/js/service-about.js', 'and within two weeks of our call you hold a written plan'],
    ['public/js/service-about.js', "'After the call you get a written report within 14 days."],
    ['public/js/service-about.js', "'A written report within 14 days of the call, next steps first',"],
    ['public/js/book.js', 'This includes our call and your written report within 14 days.'],
    ['public/js/case.js', "['delivered', 'Report, within 14 days of the call'],"],
    ['public/js/help.js', '<li><strong>Your written report</strong>, within 14 days of the call.</li>'],
    ['public/js/admin-case.js', 'Call done: start the 14-day report clock'],
    // RE-PINNED 2026-10-15 (v7.53): a Full-Service recording marks the consult instead (it owes no report); the
    // Advocacy Case's sentence is unchanged.
    // NEGATIVE CONTROL (run 2026-10-15, v7.53): that sentence put back to "Starts the 7-day report clock." made B1 read FAIL.
    ['public/js/admin-case.js', "note.textContent = data.fullAccess ? 'Marks the consult done.' : 'Starts the 14-day report clock.';"],
    ['public/js/admin-case.js', "and the 14 days are running.'"],
    ['public/stats.html', '<span>reports delivered within the time promised</span>'],
    ['public/js/demo/api.js', 'reportDueAt: new Date(now.getTime() + 14 * 86400000)'],
  ];
  const missing = SAYS.filter(([p, t]) => !f(p).includes(t)).map(([p, t]) => `${p}: ${t.slice(0, 40)}`);
  // NEGATIVE CONTROL (run 2026-10-15): the booking page's line put back to "within 7 days" made this read
  //   FAIL  B1 every place the report's timeframe is named says 14 days, the booking page's line under the agreement included
  check('B1 every place the report\'s timeframe is named says 14 days, the booking page\'s line under the agreement included',
    missing.length === 0, missing.join(' | '));

  // Nowhere a person reads still promises the old 7. The release notes keep their history.
  const OLD = /within 7 days|7-day report|7-day promise|within a week of our call|7 business days|seven days are running|7 days promised/;
  const files = [
    ...readdirSync(__j(__REPO, 'public/js')).filter((n) => n.endsWith('.js') && n !== 'changelog.js').map((n) => `public/js/${n}`),
    ...readdirSync(__j(__REPO, 'public')).filter((n) => n.endsWith('.html')).map((n) => `public/${n}`),
    'worker/index.js',
  ];
  const stale = files.filter((p) => OLD.test(f(p)));
  // NEGATIVE CONTROL (run 2026-10-15): "within 7 days of the call" put back in help.js made this read
  //   FAIL  B2 no page, script or email still promises the old 7 days
  check('B2 no page, script or email still promises the old 7 days', stale.length === 0, stale.join(', '));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const r of failed) console.log(`  FAILED: ${r.name}`);
  process.exit(1);
}
