// hold.mjs — pausing a case, closing one, and the clock a pause must NOT move.
// Run: node hold.mjs
// Repo-rooted: this file runs from tools/suites/ inside the repository, so
// the sources it asserts against are found relative to itself, wherever the
// repo is checked out.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';
const R = __REPO;
const W = readFileSync(`${R}/worker/index.js`, 'utf8');
const f = (p) => readFileSync(`${R}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ck = (n, c, d = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, d); } };

let NOW = Date.parse('2026-09-01T17:00:00Z');
class FakeDate extends Date {
  constructor(...a) { if (!a.length) super(NOW); else super(...a); }
  static now() { return NOW; }
}
const lift = (names) => {
  const src = names.map((n) => {
    const m = W.match(new RegExp(`\\n(?:async )?function ${n}\\([\\s\\S]*?\\n\\}`))
      || W.match(new RegExp(`\\nconst ${n} = [^;]+;`));
    if (!m) throw new Error(`could not lift ${n}`);
    return m[0];
  }).join('\n');
  return new Function('Date', 'FULL_WINDOW_DAYS', 'FOLLOWUP_EXPIRY_DAYS',
    `${src}\n return { ${names.filter((n) => !n.includes('=')).join(', ')} };`)(FakeDate, 60, 30);
};
const { heldMs, onHold, fullAccessWindowEnd, followUpBase, followUpExpiry } =
  lift(['heldMs', 'onHold', 'fullAccessWindowEnd', 'followUpBase', 'followUpExpiry']);

const DAY = 86_400_000;

// ---- heldMs -------------------------------------------------------------
ck('a case with no hold has banked nothing', heldMs({}) === 0);
ck('a resumed case keeps its banked total',
   heldMs({ hold: { pausedAt: null, totalMs: 11 * DAY } }) === 11 * DAY);
ck('a case paused right now counts the stretch so far',
   heldMs({ hold: { pausedAt: new Date(NOW - 3 * DAY), totalMs: DAY } }) === 4 * DAY,
   String(heldMs({ hold: { pausedAt: new Date(NOW - 3 * DAY), totalMs: DAY } }) / DAY));
ck('a clock skew backwards can never bank negative time',
   heldMs({ hold: { pausedAt: new Date(NOW + 5000), totalMs: 0 } }) === 0);
ck('onHold reads the pause, not the bank',
   onHold({ hold: { pausedAt: new Date(NOW) } }) === true
   && onHold({ hold: { pausedAt: null, totalMs: 9 * DAY } }) === false);

// ---- his clocks move ----------------------------------------------------
const call = '2026-08-01T17:00:00Z';
const plain = { appointment: { start: call } };
const held = { appointment: { start: call }, hold: { pausedAt: null, totalMs: 11 * DAY } };
ck('the tier window is 60 days from the first call',
   fullAccessWindowEnd(plain).getTime() === Date.parse(call) + 60 * DAY);
ck('an 11-day pause puts 11 days back on the tier window',
   fullAccessWindowEnd(held).getTime() - fullAccessWindowEnd(plain).getTime() === 11 * DAY);
const fu = { addOnFollowUpAt: '2026-08-20T17:00:00Z' };
const fuHeld = { ...fu, hold: { pausedAt: null, totalMs: 11 * DAY } };
ck('the follow-up month is 30 days from purchase',
   followUpExpiry(fu).getTime() === Date.parse(fu.addOnFollowUpAt) + 30 * DAY);
ck('and it moves by the same pause',
   followUpExpiry(fuHeld).getTime() - followUpExpiry(fu).getTime() === 11 * DAY);
ck('resuming really is the same timestamp: nothing is lost',
   fullAccessWindowEnd(held).getTime() - Date.parse(call) === 60 * DAY + 11 * DAY);

// ---- the clock a pause must NOT move ------------------------------------
const appealFn = W.match(/async function runAppealWarnings\(env\) \{[\s\S]*?\n\}/)[0];
ck('an insurance appeal deadline is NOT moved by a pause',
   !/heldMs/.test(appealFn),
   'runAppealWarnings must never consult heldMs - that clock is the plan\'s');
ck('and the code says why, so nobody adds it later',
   /IT DOES NOT MOVE A CLOCK SOMEBODY ELSE OWNS/.test(W));
ck('the client is told the same thing on their own page',
   /One thing does not\n\s*pause/.test(f('public/js/case.js')));
ck('and in the agreement they tick before paying',
   /One clock does not pause/.test(f('public/js/service-terms.js')));

// ---- the routes ---------------------------------------------------------
ck('pause and resume are admin-only and 404 to anyone else',
   /async function handleHold\(request, env\) \{\n\s*const admin = await requireAdmin\(request, env\);\n\s*if \(!admin\) return json\(\{ error: 'Not found' \}, 404\);/.test(W));
ck('closing a case is admin-only too',
   /async function handleCloseCase\(request, env\) \{\n\s*const admin = await requireAdmin\(request, env\);\n\s*if \(!admin\) return json\(\{ error: 'Not found' \}, 404\);/.test(W));
ck('resuming banks the stretch rather than discarding it',
   /totalMs: \(Math\.max\(0, Number\(hold\.totalMs\) \|\| 0\)\) \+ stretch,/.test(W));
ck('the stored report deadline is moved on resume',
   /patch\.reportDueAt = new Date\(new Date\(doc\.data\.reportDueAt\)\.getTime\(\) \+ stretch\);/.test(W));
ck('a held case is never auto-closed out from under him',
   /if \(onHold\(row\.data\)\) continue;/.test(W));
{
  // Strip comments before looking: case.js mentions hold.reason only to say it
  // is never sent, and a naive grep would trip on its own documentation.
  const live = f('public/js/case.js').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // Eric reversed HALF of this on 2026-08-25: the CLOSING reason is now
  // documented in the case for both parties and rendered on the client's
  // page. The PAUSE reason stays his alone. The test asserts the split.
  ck('the pause reason never reaches a client surface; the closing reason does',
     !/hold\?\.reason|hold\.reason/.test(live)
     && !/closedNote/.test(live)
     && /closedReason/.test(live));
}
ck('closing stops any running hold, so nothing keeps banking',
   /hold: \{ pausedAt: null, totalMs: Math\.max\(0, Number\(doc\.data\.hold\?\.totalMs\) \|\| 0\)/.test(W));

// ---- the terms ----------------------------------------------------------
const ST = f('public/js/service-terms.js');
ck('there is a no-guarantees clause, and it says what IS promised',
   /<h3>No guarantees<\/h3>/.test(ST) && /You are paying for effort and judgement/.test(ST));
ck('he reserves the right to close a case for any reason',
   /I reserve the right to end a case at my discretion, for any reason/.test(ST));
ck('a closed case keeps everything, and the review stays open',
   /everything in it stays yours/.test(ST) && /You can still leave a review/.test(ST));
ck('the pause clause promises the time is put back',
   /every deadline on your case stops with it/.test(ST) && /all of that time is put back/.test(ST));
ck('the terms are a required acknowledgment, enforced by the Worker',
   /REQUIRED_ACKS = \['disclaimer', 'privacy', 'recording', 'service', 'phoneConsent'\]/.test(W));
ck('and the page cannot continue without all four',
   /AGREEMENT_PARTS\.every\(\(w\) => state\.acks\[w\.id\]\)/.test(f('public/js/book.js')));
// The flag MOVED (2026-08-25 audit): service-terms.js is served to clients
// byte for byte, and a comment discussing a refund right Eric wants removed
// was internal deliberation published to the person it is adverse to. The
// flag lives in CLAUDE.md now; the served file must neither carry the
// deliberation NOR write a sentence contradicting the frozen waiver.
ck('the reschedule-refund contradiction is flagged in CLAUDE.md, not fudged',
   /reschedule-refund/.test(f('CLAUDE.md'))
   && !/full refund on request/.test(ST)
   && !/waivers\.js still/.test(ST));

// ---- the review outlives the close --------------------------------------
const CJ = f('public/js/case.js');
ck('a closed case still shows the review card',
   /Your case is closed, and this stays open/.test(CJ)
   && CJ.indexOf('Your case is closed, and this stays open') > CJ.indexOf('function renderReview'));
ck('the 48-hour warning is only shown where it is true',
   /delivered && c\.status !== 'closed' && !c\.fullAccess/.test(CJ));
ck('there is exactly one review card on the page',
   (CJ.match(/renderReview\(/g) || []).length === 2, 'one definition, one call');

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
