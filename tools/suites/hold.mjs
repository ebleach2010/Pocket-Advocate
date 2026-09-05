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
  // The cutover constant is READ from the Worker, not typed here: if it ever
  // moves, these checks move with it rather than quietly asserting a date the
  // product no longer uses.
  // Both cutovers are READ from the Worker, never typed here: if either date
  // moves, these checks move with it rather than asserting a rule the product
  // no longer follows.
  const readAt = (name) => {
    const m = W.match(new RegExp(`${name} = Date\\.parse\\('([^']+)'\\)`));
    const t = m ? Date.parse(m[1]) : NaN;
    if (!Number.isFinite(t)) throw new Error(`could not read ${name}`);
    return t;
  };
  const readNum = (name) => {
    const m = W.match(new RegExp(`const ${name} = (\\d+);`));
    if (!m) throw new Error(`could not read ${name}`);
    return Number(m[1]);
  };
  return new Function('Date', 'FULL_WINDOW_DAYS', 'FOLLOWUP_EXPIRY_DAYS',
    'FULL_WINDOW_FROM_PURCHASE_AT', 'FULL_MONTHLY_FROM_AT', 'FULL_LEGACY_WINDOW_DAYS',
    `${src}\n return { ${names.filter((n) => !n.includes('=')).join(', ')} };`)(
    FakeDate, readNum('FULL_WINDOW_DAYS'), 30,
    readAt('FULL_WINDOW_FROM_PURCHASE_AT'), readAt('FULL_MONTHLY_FROM_AT'),
    readNum('FULL_LEGACY_WINDOW_DAYS'));
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
// The window runs from PURCHASE for anything bought on or after the cutover
// (Eric, 2026-08-25). A case bought BEFORE it keeps the first-call window its
// scope note sold, because every full case carries a fullAccessAt stamp - so
// a naive "prefer the purchase date" would have taken days off live clients
// rather than falling back to anything. Both sides are pinned here.
const call = '2026-09-05T17:00:00Z';
const bought = '2026-08-30T17:00:00Z';           // after BOTH cutovers
const plain = { fullAccessAt: bought, appointment: { start: call } };
const held = { fullAccessAt: bought, appointment: { start: call }, hold: { pausedAt: null, totalMs: 11 * DAY } };
// A month at a time now (Eric, 2026-08-25): month one at approval, every
// further month adding another thirty days through fullAccessExtraDays.
ck('one paid month is 30 days from the purchase',
   fullAccessWindowEnd(plain).getTime() === Date.parse(bought) + 30 * DAY);
const oldCall = '2026-08-01T17:00:00Z';
const oldBought = '2026-07-28T17:00:00Z';        // before the cutover
ck('a case bought before the cutover keeps the 60-day first-call window it was sold',
   fullAccessWindowEnd({ fullAccessAt: oldBought, appointment: { start: oldCall } }).getTime()
     === Date.parse(oldCall) + 60 * DAY);
ck('a legacy case with no purchase stamp falls back to the first call',
   fullAccessWindowEnd({ appointment: { start: oldCall } }).getTime() === Date.parse(oldCall) + 60 * DAY);
ck('a post-cutover case with no first call still runs from purchase',
   fullAccessWindowEnd({ fullAccessAt: bought }).getTime() === Date.parse(bought) + 30 * DAY);
ck('a second month doubles the window and nothing else does',
   fullAccessWindowEnd({ ...plain, fullAccessExtraDays: 30 }).getTime()
     === Date.parse(bought) + 60 * DAY);
ck('a third month makes it ninety days',
   fullAccessWindowEnd({ ...plain, fullAccessExtraDays: 60 }).getTime()
     === Date.parse(bought) + 90 * DAY);
ck('an 11-day pause puts 11 days back on the tier window',
   fullAccessWindowEnd(held).getTime() - fullAccessWindowEnd(plain).getTime() === 11 * DAY);
const fu = { addOnFollowUpAt: '2026-08-20T17:00:00Z' };
const fuHeld = { ...fu, hold: { pausedAt: null, totalMs: 11 * DAY } };
ck('the follow-up month is 30 days from purchase',
   followUpExpiry(fu).getTime() === Date.parse(fu.addOnFollowUpAt) + 30 * DAY);
ck('and it moves by the same pause',
   followUpExpiry(fuHeld).getTime() - followUpExpiry(fu).getTime() === 11 * DAY);
ck('resuming really is the same timestamp: nothing is lost',
   fullAccessWindowEnd(held).getTime() - Date.parse(bought) === 30 * DAY + 11 * DAY);

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

// ---- the note for the client (Eric, 2026-09-03) --------------------------
// "I would like to have a spot to put a pause reason for the client and they
// get a notification with the reason for pausing." The route is lifted and
// run: the client's note lands on the case document, cleaned, and rides the
// push and an email; his private reason lands on caseMeta and nowhere the
// client can read; his own case tells nobody.
const holdSrc = W.match(/\nasync function handleHold\(request, env\) \{[\s\S]*?\n\}/)[0];
const runHold = ({ caseData, body }) => {
  const written = []; const pushes = []; const mails = [];
  const deps = {
    requireAdmin: async () => ({ uid: 'eric' }),
    json: (obj, code = 200) => ({ code, obj }),
    getDoc: async (env, path) => (path === 'cases/c1' ? { id: 'c1', data: caseData } : null),
    patchDoc: async (env, path, data, opts) => { written.push({ path, data, opts }); return true; },
    notifyUser: async (env, uid, msg) => { pushes.push({ uid, ...msg }); },
    sendEmail: async (env, m) => { mails.push(m); },
    escHtml: (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])),
    MT_FMT: { format: () => 'Monday, September 7' },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('deps', `const { requireAdmin, json, getDoc, patchDoc, notifyUser, sendEmail, escHtml, MT_FMT } = deps;${holdSrc}\n return handleHold;`)(deps);
  return { post: () => fn({ json: async () => ({ caseId: 'c1', on: true, ...body }) }, { PUBLIC_BASE_URL: 'https://x' }), written, pushes, mails };
};
const client = { clientUid: 'u1', clientEmail: 'jordan@example.com', hold: {} };
const P1 = runHold({ caseData: client, body: { note: ' Out for a  procedure until Monday <3 ', reason: 'migraine week', backBy: '2026-09-07T12:00:00-07:00' } });
const p1 = await P1.post();
const caseW = P1.written.find((w) => w.path === 'cases/c1');
const metaW = P1.written.find((w) => w.path === 'caseMeta/c1');
// NEGATIVE CONTROL (run 2026-09-03): the case write carrying `reason` again instead of '' made this read
//   FAIL  the note for the client is cleaned and stored on the case, and his own reason goes to caseMeta and not to the case
ck('the note for the client is cleaned and stored on the case, and his own reason goes to caseMeta and not to the case',
   p1.code === 200 && !!caseW && caseW.data.hold.note === 'Out for a procedure until Monday <3' && caseW.data.hold.reason === ''
   && (caseW.opts?.mask || []).join(',') === 'hold'
   && !!metaW && metaW.data.holdReason === 'migraine week' && (metaW.opts?.mask || []).join(',') === 'holdReason,holdReasonAt'
   && !JSON.stringify(caseW.data).includes('migraine'),
   JSON.stringify({ hold: caseW?.data.hold, meta: metaW?.data }).slice(0, 200));
// NEGATIVE CONTROL (run 2026-09-03): the push body flattened to 'Eric has paused your case.' made this read
//   FAIL  the push carries the note and the email carries it word for word, escaped, with the date he expects to be back
ck('the push carries the note and the email carries it word for word, escaped, with the date he expects to be back',
   P1.pushes.length === 1 && P1.pushes[0].uid === 'u1' && P1.pushes[0].body === 'Eric has paused your case: Out for a procedure until Monday <3'
   && P1.mails.length === 1 && P1.mails[0].to === 'jordan@example.com'
   && /Out for a procedure until Monday &lt;3/.test(P1.mails[0].html) && /Monday, September 7/.test(P1.mails[0].html)
   && /case\.html\?id=c1/.test(P1.mails[0].html),
   `${P1.pushes[0]?.body} | ${P1.mails[0]?.html?.slice(0, 80)}`);
const P2 = runHold({ caseData: client, body: { reason: 'private only' } });
await P2.post();
// NEGATIVE CONTROL (run 2026-09-03): the email guard dropping its `note &&` made this read
//   FAIL  with no note the push is the plain line and no email goes
ck('with no note the push is the plain line and no email goes',
   P2.pushes.length === 1 && /paused for a short while/.test(P2.pushes[0].body) && !/Eric has paused/.test(P2.pushes[0].body)
   && P2.mails.length === 0 && P2.written.find((w) => w.path === 'cases/c1')?.data.hold.note === '');
const P3 = runHold({ caseData: { self: true, clientUid: null, clientEmail: null, hold: {} }, body: { note: 'resting', reason: 'r' } });
await P3.post();
// NEGATIVE CONTROL (run 2026-09-03): the push guard loosened to `!doc.data.clientUid || !doc.data.self` made this read
//   FAIL  his own case pauses with nobody to tell
ck('his own case pauses with nobody to tell', P3.pushes.length === 0 && P3.mails.length === 0
   && P3.written.find((w) => w.path === 'cases/c1')?.data.hold.note === 'resting');
{
  const live = f('public/js/case.js').replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  // NEGATIVE CONTROL (run 2026-09-03): the client page painting hold.reason instead of hold.note made this read
//   FAIL  the client page shows his note at the top of the paused notice, word for word, and nothing of his own reason
ck('the client page shows his note at the top of the paused notice, word for word, and nothing of his own reason',
     /From Eric:<\/strong> \$\{esc\(c\.hold\.note\)\}/.test(live) && !/hold\?\.reason|hold\.reason/.test(live));
}
{
  const ADMIN = f('public/js/admin-case.js');
  // NEGATIVE CONTROL (run 2026-09-03): the form posting the private Why as the note made this read
//   FAIL  the pause form has the spot for their note, says they read it and get a notification, posts it, and the close label carries no dash
ck('the pause form has the spot for their note, says they read it and get a notification, posts it, and the close label carries no dash',
     /data-hold-note maxlength="400"/.test(ADMIN)
     && /they read this word for word, and it comes to them as a notification/.test(ADMIN)
     && /note: pane\.querySelector\('\[data-hold-note\]'\)\?\.value \|\| '',/.test(ADMIN)
     && /Your note to them: <em>\$\{esc\(c\.hold\.note\)\}<\/em>/.test(ADMIN)
     && !/Why — /.test(ADMIN) && !/required — /.test(ADMIN)
     && /note: String\(body\.note \|\| ''\)\.trim\(\)\.slice\(0, 400\)/.test(f('public/js/demo/api.js')));
}

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
// The first anchor is covered by the regex above it; the SECOND was not.
// indexOf returns -1 for a string that is gone and every real index beats -1,
// so losing renderReview entirely would have left this green. Measured
// 2026-08-28: renaming it in the shipped page passed before, fails after.
const noticeAt = CJ.indexOf('Your case is closed, and this stays open');
const renderAt = CJ.indexOf('function renderReview');
ck('a closed case still shows the review card',
   /Your case is closed, and this stays open/.test(CJ)
   && noticeAt >= 0 && renderAt >= 0 && noticeAt > renderAt,
   renderAt < 0 ? 'renderReview is not in the page at all'
     : `notice at ${noticeAt}, renderReview at ${renderAt}`);
ck('the 48-hour warning is only shown where it is true',
   /delivered && c\.status !== 'closed' && !c\.fullAccess/.test(CJ));
ck('there is exactly one review card on the page',
   (CJ.match(/renderReview\(/g) || []).length === 2, 'one definition, one call');

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
