// closure.mjs — the books-closed window, against the real worker functions.
// Run: node closure.mjs
// Repo-rooted: this file runs from tools/suites/ inside the repository, so
// the sources it asserts against are found relative to itself, wherever the
// repo is checked out.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';

const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
function fn(name, kind = 'async function') {
  const m = SRC.match(new RegExp(`\\n${kind} ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}

const LIFTED = [
  fn('readBookingClosure'), fn('closedMessage', 'function'),
  fn('handleBookingClosure'), fn('closeBookingsAug2026'),
].join('\n');

let docs, NOW;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const deps = {
  getDoc: async (env, path) => (docs.has(path) ? { data: clone(docs.get(path)), updateTime: '1' } : null),
  patchDoc: async (env, path, patch, opts = {}) => {
    const next = { ...(docs.get(path) || {}) };
    for (const k of opts.mask || Object.keys(patch)) next[k] = clone(patch[k]);
    docs.set(path, next);
    return true;
  },
  json: (data, status = 200) => ({ status, body: data }),
  requireAdmin: async () => ({ uid: 'eric' }),
};
class FakeDate extends Date {
  constructor(...a) { if (!a.length) super(NOW); else super(...a); }
  static now() { return NOW; }
}
const W = new Function(...Object.keys(deps), 'Date',
  `${LIFTED}
   return { readBookingClosure, closedMessage, handleBookingClosure, closeBookingsAug2026 };`,
)(...Object.values(deps), FakeDate);

const env = {};
const req = (body, method = 'POST') => ({ json: async () => body, method });
const reset = (now = '2026-08-23T20:00:00Z') => { docs = new Map(); NOW = Date.parse(now); };

// ---- the one-shot ---------------------------------------------------------
reset();
await W.closeBookingsAug2026(env);
const until = await W.readBookingClosure(env);
check('K1 the deploy shuts the books', until > 0);
check('K2 through the 6th, reopening midnight MST on the 7th',
  new Date(until).toISOString() === '2026-09-07T07:00:00.000Z', new Date(until).toISOString());
check('K3 that is two weeks and a bit, not two weeks minus today',
  (until - NOW) / 86_400_000 > 13.5 && (until - NOW) / 86_400_000 < 15,
  String((until - NOW) / 86_400_000));

// Idempotent: a second firing must not re-close books he has since reopened.
await W.handleBookingClosure(req({ weeks: 0 }), env);
await W.closeBookingsAug2026(env);
check('K4 a later cron firing does not re-close books he reopened',
  (await W.readBookingClosure(env)) === 0);

// And a hand-set date is never overwritten, even by a first run.
reset();
docs.set('settings/booking', { closedUntil: '2026-08-25T07:00:00Z', setByHand: true });
await W.closeBookingsAug2026(env);
check('K5 a date he set by hand wins over the migration',
  docs.get('settings/booking').closedUntil === '2026-08-25T07:00:00Z',
  JSON.stringify(docs.get('settings/booking')));

// ---- the control ----------------------------------------------------------
reset();
const two = await W.handleBookingClosure(req({ weeks: 2 }), env);
check('K6 two weeks from the control lands on a midnight MST boundary',
  new Date(two.body.closedUntil).toISOString().endsWith('T07:00:00.000Z'),
  new Date(two.body.closedUntil).toISOString());
check('K7 and is 14 days past the end of today, not 14 days from this instant',
  (new Date(two.body.closedUntil).getTime() - Date.parse('2026-08-24T07:00:00Z')) === 14 * 86_400_000,
  new Date(two.body.closedUntil).toISOString());
check('K8 it says the date out loud, in his zone',
  /Monday, September 7/.test(two.body.message), two.body.message);
check('K9 anything he sets is stamped so no deploy overrules it',
  docs.get('settings/booking').setByHand === true);

const open = await W.handleBookingClosure(req({ weeks: 0 }), env);
check('K10 zero weeks reopens immediately',
  open.body.closedUntil === null && (await W.readBookingClosure(env)) === 0);

check('K11 a nonsense span is refused rather than stored',
  (await W.handleBookingClosure(req({ weeks: -1 }), env)).status === 400
  && (await W.handleBookingClosure(req({ weeks: 99 }), env)).status === 400
  && (await W.handleBookingClosure(req({ weeks: 'soon' }), env)).status === 400);

// ---- expiry ---------------------------------------------------------------
reset();
await W.closeBookingsAug2026(env);
NOW = Date.parse('2026-09-08T16:00:00Z');
check('K12 the window lets go of itself when the date passes, with no cron',
  (await W.readBookingClosure(env)) === 0);

// ---- the guards, as they read in the source -------------------------------
const slotGuard = /closedUntil && new Date\(slot\.data\.start\)\.getTime\(\) < closedUntil/.test(SRC);
const reqGuard = /closedUntil && start\.getTime\(\) < closedUntil/.test(SRC);
check('K13 the calendar path refuses a closed slot', slotGuard);
check('K14 the requested-time path refuses one too - it never reads a slot, '
  + 'so hiding slots does nothing to it', reqGuard);
// BOTH ENDS HAVE TO BE FOUND, or this passes on a guard that is GONE:
// indexOf returns -1 for a missing string and -1 is less than every real
// index, so deleting the closed-slot refusal entirely would have read green
// here. Measured 2026-08-28: renaming closedMessage in the shipped Worker
// passed before, fails after.
const refuseAt = SRC.indexOf('closedMessage(closedUntil)');
const holdAt = SRC.indexOf("{ state: 'held'");
check('K15 the slot check happens BEFORE the hold, so a refused booking does '
  + 'not take a time off the calendar for half an hour',
  refuseAt >= 0 && holdAt >= 0 && refuseAt < holdAt,
  refuseAt < 0 ? 'the closed-slot refusal is not there at all'
    : holdAt < 0 ? 'the hold is not there at all'
      : `${refuseAt} vs ${holdAt}`);
check('K16 the closure lands within a minute of deploy, not on the 15 minute gate',
  /ctx\.waitUntil\(unparkAdvisor\(env\)\);[\s\S]{0,500}?ctx\.waitUntil\(closeBookingsAug2026\(env\)\)/.test(SRC)
  || /ctx\.waitUntil\(runWorkClockNudges\(env\)\);[\s\S]{0,500}?ctx\.waitUntil\(closeBookingsAug2026\(env\)\)/.test(SRC));

// The client half is a courtesy; prove it is there but never the only lock.
const BOOK = readFileSync(__j(__REPO, 'public/js/book.js'), 'utf8');
check('K17 the booking page raises its own floor to the closure',
  /Math\.max\(Date\.now\(\) \+ LEAD_TIME_MS, closedUntil\)/.test(BOOK));
check('K18 and fences the request picker to it as well',
  /reqDate\.min = localDay\(Math\.max\(Date\.now\(\) \+ LEAD_TIME_MS, closedUntil\)\)/.test(BOOK));
check('K19 an empty calendar says WHY and when he is back',
  /I have closed my books for now/.test(BOOK) && /I open again/.test(BOOK));
check('K20 and takes away the request picker it cannot wire',
  /#request-box'\)\?\.remove\(\)/.test(BOOK));
check('K21 existing clients are told they are unaffected',
  /nothing about your\s*\n?\s*case changes/.test(BOOK));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const f of failed) console.log(`  FAILED: ${f.name}`); process.exit(1); }
