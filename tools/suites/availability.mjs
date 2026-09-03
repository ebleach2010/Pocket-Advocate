// availability.mjs - in office / out of office, driven against the REAL code.
//
// Eric, 2026-08-27: scheduled hours Monday to Friday, 8:00 to 19:00 Mountain;
// a switch he can flip either way from his phone that ALWAYS beats the
// schedule, both directions; a noticeable cue for clients; and never a
// response time promised unless he has set one by hand.
//
// WHY THIS LIFTS AND RUNS RATHER THAN GREPS: a regex cannot tell 08:00 from
// 09:00, and the whole risk in this feature is an off-by-one hour or an
// off-by-one boundary. So the hours predicate is IMPORTED from the shipped
// module and executed against real instants, and the Worker handlers are
// lifted out of worker/index.js and driven over an in-memory Firestore, the
// same harness closure.mjs and clock.mjs use.
//
// Run: node availability.mjs
// Repo-rooted: this file runs from tools/suites/ inside the repository, so the
// sources it asserts against are found relative to itself, wherever the repo
// is checked out.
//
// ===========================================================================
// NEGATIVE CONTROLS - what was broken on purpose, and what went red
//
// A check nobody has watched fail is not evidence. Every one below was run by
// editing the real source, running this file, reading the output, and putting
// the source back. The right-hand column is what was OBSERVED, not what was
// expected.
//
//   the break                                        what went red
//   ---------------------------------------------------------------------
//   >= OPEN_HOUR becomes >                           A Mon 08:00, both months
//   < CLOSE_HOUR becomes <=                          A Mon 19:00, both months
//   the Sat/Sun guard is dropped                     A all four weekend rows
//   OFFICE_TZ put back to Etc/GMT+7                  A all six August rows on
//                                                      the clock reading alone,
//                                                      2 January/August pairs,
//                                                      3 zone rows, D "the demo
//                                                      agrees", E "his own
//                                                      clock" and E "office.js
//                                                      converts from the same
//                                                      zone" - 14 red
//   CLOSE_HOUR moves to 18                           A Mon 18:59 x2, the
//                                                      constants row, and
//                                                      E "the hours the copy
//                                                      states are the hours
//                                                      the code enforces"
//   the override stops winning                       B, 6 rows
//   only 'out' overrides, 'in' does not              B, 4 rows
//   the response line stops being normalised         C, 4 rows
//   the admin write loses its mask                   C both "does not wipe"
//   only the switch is masked                        C "does not wipe the
//                                                      response line"
//   a bad status is stored, not refused              C "nonsense status"
//   handleAvailability calls requireAdmin            C "never asks for an
//                                                      admin"
//   the route is renamed                             C "routed as a public GET"
//   the doc moves back under settings/               C 8 rows incl. "no document
//                                                      is under a world-readable
//                                                      prefix" and every row
//                                                      that reads the document
//   a match /config/ block is added to the rules     C "opens no path under
//                                                      config/"
//   `by` is put back on the public answer            C "only the keys a
//                                                      stranger may see", and
//                                                      "will not say WHICH"
//   an em dash goes back into his copy               E 4 rows
//   one word of his copy is reworded                 E "block 5", plus the
//                                                      whole-body row
//   the copy says 9:00 AM, code still says 8         E "block 1" + whole body
//   the emphasis is taken off his sentence           E "the sentence he asked
//                                                      to emphasise"
//   the "?" goes back to 40px                        F "a true 44px"
//   the hours kind is unwired                        F "wireHelp knows the
//                                                      hours kind"
//   office.js grows an import                        F "imports nothing"
//   the cue builder stops emitting the "?"           F "built in one place"
//   chat-page stops using the shared builder         F "chat-page.js uses that
//                                                      one builder"
//   the banned promise returns, double-quoted        F "no built-in reply-time
//                                                      promise left in
//                                                      subscription.js"
//   .office-cue.out is emptied to `{ }`              F "visibly different look
//                                                      in each state"
//   .office-cue.unknown is made to match .out        F "we do not know yet does
//                                                      not look like he is out"
//   watchPresence(el) commented out in case.js       F "case.js starts the
//                                                      painter"
//   the lp CLEAR is removed from the folder press    H "clears any stale mark
//                                                      when the next press
//                                                      begins"
//   `auto: false` flipped to `auto: true`            H "nothing starts a clock
//                                                      without him"
//   the presence write and its open rule return      G 3 rows: the write, the
//                                                      rule, and "no client
//                                                      module names it"
//   admin-hours.js dropped from the audit list       G "every admin- module is
//                                                      in the audit's list"
//   the emergency line is dimmed and shrunk again    E "not dimmer than the
//                                                      prose" + "not smaller"
//   the no-store is dropped from the status fetch    F "never read from the
//                                                      browser cache"
//   the admin gate stops matching admin-*            G "admin-hours.js is 404"
//   the control is mounted on one page only          G "mounted on BOTH"
//   the long press posts to /api/work itself         H "runs the card toggle"
//   the menu ROW is renamed                          H "says exactly what he
//                                                      asked", + "the way back"
//   the glow stops following the clock               H "the glow is the running
//                                                      clock"
//   the toggle stops repainting the folder           H "every path that moves
//                                                      the clock"
//   wireFolderClocks stops returning its toggle      H "keeps handing it back"
//   the press loses its lp mark                      H "leaves the same lp mark"
//   the press invents its own 90ms                   H "app-wide press length"
//   the press stops excluding the dx line            H "keeps its hands off"
//   the demo schedule drifts an hour                 D "the demo agrees"
//   the demo forgets the weekend                     D "the demo agrees"
//
// THREE PASSED SILENTLY ON THE FIRST BUILD and were rewritten until they did
// not. Each rewrite carries its own note at the check:
//   - the in-memory patchDoc merged whether or not a mask was given, so
//     deleting the mask from the shipped handler broke nothing here;
//   - "mounted on BOTH advocate pages" matched the call inside a `//` comment;
//   - "leaves the same lp mark" matched wireDxLongPress's mark, not the new
//     one, so deleting the new one stayed green.
// A fourth was a crash rather than a pass: one check dereferenced a null and
// threw, which prints no FAIL line at all. It is optional-chained now.
//
// ===========================================================================
// SIX MORE PASSED SILENTLY AND WERE FOUND BY REVIEW ON 2026-08-27. The pattern
// behind all six is one thing: this file has a strong half that RUNS the code
// and a weak half that GREPS it, and a grep over raw source cannot tell live
// code from a comment. Each is fixed and each fix was watched going red.
//
//   what stayed green while broken                   what it reads now
//   ---------------------------------------------------------------------
//   the route registration matched the COMMENTED-OUT   comment-stripped source,
//   registration. With GET /api/availability           and the handler it names
//   commented out the route 404s, every client's       asserted to exist.
//   pill sits on "Checking" for ever, and the          THE HEADLINE: the suite
//   battery stayed 115/115.                            did not check that the
//                                                      feature was switched on.
//   the no-store check matched a commented-out         comment-stripped source
//   `cache: 'no-store'`
//   the lp-mark check matched a commented-out line     comment-stripped source
//   AND PRINTED PASS BY NAME
//   the reply-time ban was syntax-shaped:              the words of the promise,
//   `!/expectation = '(?!')/` caught one variable      in any quoting, anywhere
//   name in single quotes. The exact banned            in the file, across five
//   sentence written back double-quoted stayed green.  client files
//   "office.js imports nothing" missed                 the word `import`, so a
//   `await import('./firebase.js')`                    dynamic one counts too
//   "visibly different in each state" passed on        the DECLARATIONS in each
//   an empty `.office-cue.out { }`                     rule, required to differ
//
// So: EVERY whole-file grep in this suite now reads code(), which strips
// comments. The two deliberate exceptions are named where they sit - the dash
// rules, which are about the served bytes and must see comments, and
// "office.js never invents a response time", which is stricter with them in.
//
// Two checks also used to CRASH rather than fail: `SRC.match(...)[1]` on a
// rename threw a TypeError, exiting 1 with no FAIL line, no tail and no count,
// which reads to anything scanning the output as a clean run. Both report a
// red line now and let the checks downstream of them fail too.
//
// One check was VACUOUS: `!/auto: true/` pinned the absence of a string that
// has never existed in drawer.js and could not go red for any edit. It reads
// the flags that are really there now and requires every one to say false.
//
// And one check was MISSING ENTIRELY: nothing asserted that a client surface
// starts the painter. Commenting out watchPresence(el) in case.js froze the
// pill on every client's chat and the battery stayed 115/115. Both the suite
// and the drive check it now, the drive by looking at the page.
// ===========================================================================
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';

// The real thing, imported rather than copied. If this import ever fails the
// suite dies loudly, which is the correct outcome: there is nothing to test.
import {
  scheduledOpen, officeStatus, OPEN_HOUR, CLOSE_HOUR, MOUNTAIN_TZ, OFFICE_TZ,
} from '../../worker/schedule.js';
// office.js is import-free by design, which means node can load it and this
// suite can RUN the client-side timezone arithmetic instead of grepping at it.
import { localHoursNote, officeLabel, officeCueHtml, officeLineHtml } from '../../public/js/office.js';

const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

/**
 * A file with its comments taken out.
 *
 * EVERY WHOLE-FILE GREP IN THIS SUITE GOES THROUGH THIS, and that is the single
 * biggest change the 2026-08-27 review forced. A grep over raw source cannot
 * tell live code from a comment, so six checks here passed while the feature
 * they guard was commented out: the route registration, the no-store on the
 * status fetch, the long-press mark, and three more. One of them printed PASS
 * by name for a line that was not running.
 *
 * It removes line comments and block comments that OPEN AT THE START OF A
 * LINE, which is every comment in this repo's style. A block comment opened
 * mid-line is left alone deliberately: eating one of those could swallow a
 * regex literal and quietly delete real code from what a check is reading.
 *
 * The exceptions are named where they are used, and there are two kinds: the
 * dash rules, which are about the served BYTES and so must see comments, and
 * the checks that assert a comment says something. Every other grep uses this.
 */
const strip = (s) => s
  .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const code = (p) => strip(f(p));
const CODE = strip(SRC);

// ---------------------------------------------------------------------------
// 1. THE SCHEDULE, RUN AGAINST REAL INSTANTS
//
// THE EXPECTATION IN THE AUGUST ROWS MOVED ON 2026-08-27, AND WHY IS THE POINT.
//
// It used to read: the office hours are anchored to MOUNTAIN_TZ, a fixed UTC-7
// with no daylight saving, so the same wall-clock hour is the same UTC instant
// in January and in August, and the August rows pinned that sameness. Which it
// did, faithfully - including the part where his in-office light came on an
// hour after he started work for eight months of every year.
//
// Eric, 2026-08-27, ruling on it in his own words: "I live in Boise, ID, MST.
// Booking can be done anytime. The only thing it does is says I'm out of office
// if it's 7am MST. Or 11pm MST. This is not a complicated concept. If there's
// something getting in the way of that, override it."
//
// So scheduledOpen now reads OFFICE_TZ, America/Boise, which keeps daylight
// saving. NOT ONE CHECK WAS DELETED. Every row below is still here and still
// runs; what changed is the UTC instant each August row is built from, because
// 8:00 on his wall clock in August is 14:00Z rather than 15:00Z. The answers
// are unchanged, which is the new truth stated as an assertion: the same
// wall-clock time means the same thing to him in both months.
//
// The booking calendar is NOT changed and MOUNTAIN_TZ is still asserted below.
// He said booking can be done anytime; those slots stay on the fixed offset.
//
// The weekday and wall time of each instant are asserted alongside the answer,
// in his zone, so a mistyped date cannot make a check pass for the wrong
// reason - and putting Etc/GMT+7 back turns all six August rows red on the
// clock reading alone, before the predicate is even consulted.
// ---------------------------------------------------------------------------
const wallFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: OFFICE_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
// Commas stripped: ICU has spelled this "Mon, 08:00" and "Mon 08:00" in
// different versions, and the suite is testing the office hours, not the
// punctuation of a date formatter.
const wall = (iso) => wallFmt.format(new Date(iso)).replace(/,/g, '');

// [iso, what it should read on HIS clock, expected in-office]
const SCHEDULE_CASES = [
  // January. Boise is on MST, UTC-7, so these instants are unchanged.
  ['2026-01-05T14:59:00Z', 'Mon, 07:59', false],
  ['2026-01-05T15:00:00Z', 'Mon, 08:00', true],
  ['2026-01-06T01:59:00Z', 'Mon, 18:59', true],
  ['2026-01-06T02:00:00Z', 'Mon, 19:00', false],
  ['2026-01-10T19:00:00Z', 'Sat, 12:00', false],
  ['2026-01-11T19:00:00Z', 'Sun, 12:00', false],
  // Friday joined the weekend 2026-08-29 ("Fri-Sun out of office").
  // NEGATIVE CONTROLS (run 2026-08-29): reopening Friday in the predicate
  // made both Friday rows and the demo-parity check red; sliding the sheet
  // sentence back to "Monday to Friday" made both E copy checks red.
  ['2026-01-09T19:00:00Z', 'Fri, 12:00', false],
  // August. Same six wall-clock readings, same six answers, an hour earlier in
  // UTC because Boise is on MDT, UTC-6. THIS IS THE MOVED EXPECTATION: these
  // six instants used to be 15:00Z, 02:00Z and so on, pinning a fixed offset
  // that put his light an hour behind him all summer.
  ['2026-08-03T13:59:00Z', 'Mon, 07:59', false],
  ['2026-08-03T14:00:00Z', 'Mon, 08:00', true],
  ['2026-08-04T00:59:00Z', 'Mon, 18:59', true],
  ['2026-08-04T01:00:00Z', 'Mon, 19:00', false],
  ['2026-08-08T18:00:00Z', 'Sat, 12:00', false],
  ['2026-08-09T18:00:00Z', 'Sun, 12:00', false],
  ['2026-08-07T18:00:00Z', 'Fri, 12:00', false],
];

for (const [iso, expectWall, expectOpen] of SCHEDULE_CASES) {
  const month = iso.slice(0, 7);
  check(`A: ${expectWall} in ${month} is ${expectOpen ? 'IN office' : 'OUT of office'}`,
    wall(iso) === expectWall.replace(/,/g, '') && scheduledOpen(new Date(iso)) === expectOpen,
    `clock read ${wall(iso)}, predicate said ${scheduledOpen(new Date(iso))}`);
}

// The two halves of each pair must give the SAME answer. That used to be the
// fixed offset stated as an assertion; it is now daylight saving stated as one.
// Same reading on his wall, same answer, whatever month it is.
for (let i = 0; i < 7; i += 1) {
  const [janIso, w] = SCHEDULE_CASES[i];
  const [augIso] = SCHEDULE_CASES[i + 7];
  check(`A: ${w} answers the same in January and August (his clock, not an offset)`,
    scheduledOpen(new Date(janIso)) === scheduledOpen(new Date(augIso)),
    `${scheduledOpen(new Date(janIso))} vs ${scheduledOpen(new Date(augIso))}`);
}

check('A: the predicate reads the hours off the shipped constants, 8 and 19',
  OPEN_HOUR === 8 && CLOSE_HOUR === 19, `${OPEN_HOUR}..${CLOSE_HOUR}`);
// TWO ZONES, AND THEY ARE NOT THE SAME ZONE. Both are pinned, because the whole
// of the 2026-08-27 decision is that one of them moved and the other did not.
check('A: the office light is on HIS clock, America/Boise, on his explicit word',
  OFFICE_TZ === 'America/Boise', OFFICE_TZ);
check('A: the booking calendar is still anchored to the fixed UTC-7 it always was',
  MOUNTAIN_TZ === 'Etc/GMT+7', MOUNTAIN_TZ);
check('A: and they are deliberately different, which is the whole change',
  OFFICE_TZ !== MOUNTAIN_TZ, `${OFFICE_TZ} vs ${MOUNTAIN_TZ}`);
// The property that made the change worth making, asserted rather than assumed:
// his zone really does shift, and the booking anchor really does not.
{
  const off = (iso, tz) => new Intl.DateTimeFormat('en-US', {
    timeZone: tz, timeZoneName: 'longOffset',
  }).formatToParts(new Date(iso)).find((p) => p.type === 'timeZoneName').value;
  const janO = off('2026-01-15T18:00:00Z', OFFICE_TZ);
  const augO = off('2026-08-15T18:00:00Z', OFFICE_TZ);
  check('A: his zone observes daylight saving, so 8am tracks him all year',
    janO !== augO, `${janO} in January, ${augO} in August`);
  check('A: and the booking anchor still does not move, in either month',
    off('2026-01-15T18:00:00Z', MOUNTAIN_TZ) === off('2026-08-15T18:00:00Z', MOUNTAIN_TZ),
    `${off('2026-01-15T18:00:00Z', MOUNTAIN_TZ)} / ${off('2026-08-15T18:00:00Z', MOUNTAIN_TZ)}`);
}
check('A: rubbish in is OUT, not a crash and not a silent yes',
  scheduledOpen(new Date('not a date')) === false);

// ---------------------------------------------------------------------------
// 2. THE OVERRIDE BEATS THE SCHEDULE, BOTH DIRECTIONS, BY RUNNING IT
//
// "Manual override ALWAYS beats the schedule, both directions. Out during
// normal hours shows out. In outside normal hours shows in."
// ---------------------------------------------------------------------------
const MID_WEEK_DAY = '2026-08-05T18:00:00Z';    // Wed 11:00 MST, inside hours
const MID_WEEK_NIGHT = '2026-08-06T04:00:00Z';  // Wed 21:00 MST, outside hours
const WEEKEND = '2026-08-08T19:00:00Z';         // Sat noon MST

check('B: the schedule alone says IN at Wed 11am and OUT at Wed 9pm',
  scheduledOpen(new Date(MID_WEEK_DAY)) === true
  && scheduledOpen(new Date(MID_WEEK_NIGHT)) === false);

const outInHours = officeStatus('out', new Date(MID_WEEK_DAY));
check('B: OUT during office hours shows out (he is with his daughter)',
  outInHours.inOffice === false, JSON.stringify(outInHours));
check('B: and says so is a standing override, not the clock',
  outInHours.manual === 'out' && outInHours.scheduled === true && outInHours.overriding === true,
  JSON.stringify(outInHours));

const inAfterHours = officeStatus('in', new Date(MID_WEEK_NIGHT));
check('B: IN outside office hours shows in (he is pulling overtime)',
  inAfterHours.inOffice === true, JSON.stringify(inAfterHours));
check('B: and that is flagged as overriding too',
  inAfterHours.overriding === true, JSON.stringify(inAfterHours));

check('B: IN on a Saturday shows in - the weekend is a schedule, not a wall',
  officeStatus('in', new Date(WEEKEND)).inOffice === true);

const agreeing = officeStatus('in', new Date(MID_WEEK_DAY));
check('B: an override that AGREES with the hours is not flagged as overriding',
  agreeing.inOffice === true && agreeing.manual === 'in' && agreeing.overriding === false,
  JSON.stringify(agreeing));

for (const junk of [null, undefined, '', 'IN', 'away', 0, true, {}]) {
  check(`B: ${JSON.stringify(junk)} is not an override and the schedule decides`,
    officeStatus(junk, new Date(MID_WEEK_DAY)).inOffice === true
    && officeStatus(junk, new Date(MID_WEEK_NIGHT)).inOffice === false
    && officeStatus(junk, new Date(MID_WEEK_DAY)).manual === null);
}

// ---------------------------------------------------------------------------
// 3. THE WORKER, LIFTED AND DRIVEN OVER AN IN-MEMORY FIRESTORE
// ---------------------------------------------------------------------------
function fn(name, kind = 'async function') {
  const m = SRC.match(new RegExp(`\\n${kind} ${name}\\([\\s\\S]*?\\n\\}`));
  // A LOUD RED LINE, NOT A THROW. A rename used to take this out with an
  // uncaught exception: exit code 1, no FAIL line, no tail, no count - which
  // reads to anything scanning the output as a suite that found nothing wrong.
  // The bad lift is reported as a failure and an empty body is returned, so the
  // checks that depend on it fail too and say which.
  if (!m) {
    check(`C: ${name} can still be found in worker/index.js to lift and run`, false,
      'renamed, moved, or no longer an async function declaration');
    return `async function ${name}() { return json({ lifted: false }, 500); }`;
  }
  return m[0];
}
const LIFTED = [
  fn('readOfficeHours'), fn('handleAvailability'), fn('handleOfficeHoursControl'),
].join('\n');

let docs;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
let ADMIN = true;
const deps = {
  getDoc: async (env, path) => (docs.has(path) ? { data: clone(docs.get(path)), updateTime: '1' } : null),
  patchDoc: async (env, path, patch, opts = {}) => {
    // MASKED IS A MERGE, UNMASKED IS A REPLACE. That is what worker/firestore.js
    // actually does: `updateMask.fieldPaths` is only sent when opts.mask is
    // given, and a Firestore PATCH with no updateMask overwrites the whole
    // document with the fields in the body.
    //
    // The fakes in closure.mjs and clock.mjs merge either way. That is a
    // SILENT-PASS TRAP and it caught this suite first time out: with a merging
    // fake, deleting the mask from the real handler broke nothing here and the
    // "flipping the switch does not wipe the response line" check stayed green
    // while the shipped code had exactly the defect it was written to catch.
    // Modelling the real semantics is what makes that check evidence.
    if (!opts.mask) { docs.set(path, clone(patch)); return true; }
    const next = { ...(docs.get(path) || {}) };
    for (const k of opts.mask) next[k] = clone(patch[k]);
    docs.set(path, next);
    return true;
  },
  json: (data, status = 200) => ({ status, body: data }),
  requireAdmin: async () => (ADMIN ? { uid: 'eric' } : null),
  officeStatus,
};
const W = new Function(...Object.keys(deps),
  `${LIFTED}
   return { readOfficeHours, handleAvailability, handleOfficeHoursControl };`,
)(...Object.values(deps));

const env = {};
const req = (body, method = 'POST') => ({ json: async () => body, method });
const reset = () => { docs = new Map(); ADMIN = true; };

const DOC = 'config/officeHours';

reset();
const fresh = await W.handleAvailability(env);
check('C: with no document at all, the schedule decides and nothing throws',
  fresh.status === 200 && typeof fresh.body.inOffice === 'boolean',
  JSON.stringify(fresh.body));
check('C: and no response time is promised', fresh.body.responseTime === null,
  JSON.stringify(fresh.body));

// WHAT A STRANGER MAY SEE, AS A CLOSED LIST.
//
// THE EXPECTATION MOVED, 2026-08-27. This route is anonymous, uncached and
// cheap to poll once a minute, and it used to also return `by`: 'manual' or
// 'schedule', saying whether the clock or his own hand had decided. Nothing on
// the client side ever read it (office.js stored it and never used it). What it
// gave anybody keeping the log was the shape of his week - which afternoons he
// takes off, which evenings he works late. So `by` is gone from the public
// answer, the two checks below that used to pin `by === 'manual'` now pin the
// state itself and its absence, and the key list is asserted as a whole so the
// next field somebody adds has to be argued for rather than merely added.
const PUBLIC_KEYS = ['inOffice', 'responseTime'];
check('C: the public answer carries only the keys a stranger may see',
  Object.keys(fresh.body).sort().join(',') === PUBLIC_KEYS.join(','),
  Object.keys(fresh.body).sort().join(','));

await W.handleOfficeHoursControl(req({ manual: 'out' }), env);
const afterOut = await W.handleAvailability(env);
check('C: setting OUT is read back as out (was: and by his hand rather than '
  + 'the clock, until `by` was taken off the public answer)',
  afterOut.body.inOffice === false,
  JSON.stringify(afterOut.body));
check('C: and the public answer still will not say WHICH of the two it was',
  Object.keys(afterOut.body).sort().join(',') === PUBLIC_KEYS.join(',')
  && !JSON.stringify(afterOut.body).includes('manual'),
  JSON.stringify(afterOut.body));
check('C: and is stamped setByHand, the same stamp settings/booking carries',
  docs.get(DOC)?.setByHand === true,
  JSON.stringify(docs.get(DOC)));
// The stamp is the reason the document moved out of settings/. It records the
// exact minute of his last flip, and settings/ is world-readable.
check('C: the stamp that made the move necessary is really stored',
  !!docs.get(DOC)?.setAt, JSON.stringify(docs.get(DOC)));
check('C: and never leaves the building on the public answer',
  !('setAt' in afterOut.body) && !('setByHand' in afterOut.body),
  JSON.stringify(afterOut.body));

// The advocate route keeps every field, because he is entitled to know why his
// own door sign says what it says, and that route is behind requireAdmin.
const mine = await W.handleOfficeHoursControl(req(undefined, 'GET'), env);
check('C: his own route still tells him it is his hand and not the clock',
  mine.body.manual === 'out' && typeof mine.body.scheduled === 'boolean'
  && typeof mine.body.overriding === 'boolean',
  JSON.stringify(mine.body));

await W.handleOfficeHoursControl(req({ manual: null }), env);
// Both halves read off ONE call, so nothing here can flake on the one second a
// day when the office opens between two reads of the clock.
const cleared = await W.handleOfficeHoursControl(req(undefined, 'GET'), env);
check('C: clearing it hands the answer back to the schedule',
  cleared.body.manual === null && cleared.body.inOffice === cleared.body.scheduled
  && cleared.body.overriding === false,
  JSON.stringify(cleared.body));
check('C: and the public answer is still two keys and a boolean',
  typeof (await W.handleAvailability(env)).body.inOffice === 'boolean'
  && Object.keys((await W.handleAvailability(env)).body).sort().join(',') === PUBLIC_KEYS.join(','),
  JSON.stringify((await W.handleAvailability(env)).body));

// The masked-write property, which is the thing a bare setDoc would have
// broken - see the same defect fixed in admin-chats.js in this commit.
reset();
await W.handleOfficeHoursControl(req({ responseTime: 'I answer most messages the same day.' }), env);
await W.handleOfficeHoursControl(req({ manual: 'out' }), env);
check('C: flipping the switch does not wipe the response line he typed',
  docs.get(DOC)?.responseTime === 'I answer most messages the same day.',
  JSON.stringify(docs.get(DOC)));
await W.handleOfficeHoursControl(req({ responseTime: 'Back Monday.' }), env);
check('C: and saving the line does not wipe the switch',
  docs.get(DOC)?.manual === 'out',
  JSON.stringify(docs.get(DOC)));

// NEVER PROMISE A RESPONSE TIME UNLESS ONE HAS BEEN SET BY HAND.
reset();
docs.set(DOC, { responseTime: '   ' });
check('C: a blank line is no line, not an empty promise on a client screen',
  (await W.handleAvailability(env)).body.responseTime === null);
docs.set(DOC, { responseTime: '  Usually within a day.  ' });
check('C: a real line comes back trimmed',
  (await W.handleAvailability(env)).body.responseTime === 'Usually within a day.');
docs.set(DOC, { responseTime: 'x'.repeat(400) });
// Optional-chained on purpose. An earlier version read `.length` off the
// answer directly, and when a broken build returned null the SUITE threw a
// TypeError instead of printing a red line - which reads to anything parsing
// the output as no failures at all rather than as a failure.
check('C: and is capped rather than shipped whole',
  (await W.handleAvailability(env)).body.responseTime?.length === 160,
  String((await W.handleAvailability(env)).body.responseTime).slice(0, 40));

reset();
check('C: a nonsense status is refused rather than stored',
  (await W.handleOfficeHoursControl(req({ manual: 'maybe' }), env)).status === 400
  && (await W.handleOfficeHoursControl(req({ manual: 7 }), env)).status === 400
  && !docs.has(DOC));
check('C: a response time that is not text is refused too',
  (await W.handleOfficeHoursControl(req({ responseTime: 42 }), env)).status === 400);

reset();
ADMIN = false;
const stranger = await W.handleOfficeHoursControl(req({ manual: 'in' }), env);
check('C: a stranger gets 404 from the control, like every other admin route',
  stranger.status === 404 && stranger.body.error === 'Not found', JSON.stringify(stranger));
check('C: and changed nothing', !docs.has(DOC));
ADMIN = true;

// The public read is public: it must NOT be behind requireAdmin, or the pill
// on a client's chat says "Checking" for ever.
//
// A LOUD RED LINE, NOT A CRASH. This used to be `.exec(SRC)[0]`, which threw a
// TypeError the moment the handler was renamed: exit 1 with no FAIL line and no
// tail, which reads as a clean run to anything scanning the output.
{
  const body = /async function handleAvailability\([\s\S]*?\n\}/.exec(CODE);
  check('C: handleAvailability is still there to read', !!body,
    'renamed, moved, or commented out');
  check('C: the public read never asks for an admin',
    !!body && !body[0].includes('requireAdmin'));
}

// IS THE FEATURE REACHABLE AT ALL. THIS IS THE HEADLINE OF THE 2026-08-27
// REVIEW AND THE WORST SILENT PASS IN THE FILE.
//
// The route-registration check used to read the RAW source, so it matched the
// registration whether it was live or commented out. With `/api/availability`
// commented out the route 404s, office.js keeps whatever it last knew (which is
// nothing), every client's pill sits on "Checking" for ever, and the whole
// battery stayed 115/115. The suite did not verify that the feature was
// switched on. Both route checks now read comment-stripped source, and the
// handlers they name are asserted to exist beside them.
check('C: the public read is routed as a live public GET, beside /api/rates',
  /url\.pathname === '\/api\/availability' && request\.method === 'GET'/.test(CODE)
  && /return await handleAvailability\(/.test(CODE),
  'no LIVE registration of GET /api/availability in worker/index.js');
check('C: the control is routed too, and to its own handler',
  /url\.pathname === '\/api\/admin\/office-hours'/.test(CODE)
  && /return await handleOfficeHoursControl\(/.test(CODE),
  'no LIVE registration of /api/admin/office-hours');

// WHERE THE DOCUMENT LIVES, AND WHY IT MOVED.
//
// THE EXPECTATION MOVED, 2026-08-27. It used to read: this lives under
// settings/, which firestore.rules already makes public-read, so no rules
// change is needed. That was true and it was the defect. The document carries
// setAt, the minute of his last flip, and world-readable meant a browser could
// read that stamp straight out of Firestore however carefully the Worker
// stripped it from the answer. It is on config/officeHours now, which has no
// rule of its own and so falls to the catch-all deny at the bottom of the file,
// the same place config/advisor and config/rates sit. The checks below are the
// same checks pointed at the new truth: nothing was dropped.
{
  const RULES = strip(f('firestore.rules'));
  const paths = [...LIFTED.matchAll(/(?:getDoc|patchDoc)\(env, '([^']+)'/g)].map((m) => m[1]);
  check('C: the handlers name a document at all, so the checks below mean something',
    paths.length > 0, 'no document paths found in the lifted handlers');
  check('C: and no document this feature touches is under a world-readable prefix',
    paths.length > 0 && paths.every((x) => !x.startsWith('settings/')),
    paths.join(', '));
  check('C: they are all under config/, which no rule opens',
    paths.length > 0 && paths.every((x) => x.startsWith('config/')),
    paths.join(', '));
  // The prefix is only safe because nothing grants it. If somebody ever adds a
  // match block for config/, this is the line that goes red.
  check('C: firestore.rules opens no path under config/ to any browser',
    !/match\s+\/config\//.test(RULES),
    (RULES.match(/match\s+\/config\/.*/) || [''])[0]);
  check('C: and the catch-all that denies it is still the last word',
    /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/.test(RULES));
  // settings/ is still world-readable and still correct for what is left there.
  // Pinned so that its being open stays a stated decision rather than a habit.
  check('C: settings/ is still public-read and admin-write for the public copy',
    /match \/settings\/\{doc\}[\s\S]*?allow read: if true;[\s\S]*?allow write: if isAdmin\(\);/.test(RULES));
}

// ---------------------------------------------------------------------------
// 4. THE DEMO MIRRORS THE REAL RULE, RUN SIDE BY SIDE
//
// The demo never reaches a Worker, so its copy of the schedule is the one
// place in the app where this rule is written twice. Rather than trust it,
// lift the demo's own expression and run it against the same twelve instants
// as the real one. A drift of one hour anywhere shows up here.
// ---------------------------------------------------------------------------
{
  // Comment-stripped: an expression sitting inside a commented-out block is
  // not the demo's schedule, and lifting one would compare the real predicate
  // against code that never runs.
  const DEMO = code('public/js/demo/api.js');
  const m = DEMO.match(/const wd = new Intl[\s\S]*?const scheduled = [^;]+;/);
  check('D: the demo schedule can be lifted at all', !!m);
  if (m) {
    const demoOpen = new Function('now', `${m[0]}\n return scheduled;`);
    let same = true;
    let firstBad = '';
    for (const [iso, w] of SCHEDULE_CASES) {
      const real = scheduledOpen(new Date(iso));
      const fake = demoOpen(new Date(iso));
      if (real !== fake) { same = false; firstBad = firstBad || `${w} ${iso}: real ${real}, demo ${fake}`; }
    }
    check('D: the demo agrees with the real predicate on all twelve instants',
      same, firstBad);
  }
}

// ---------------------------------------------------------------------------
// 5. THE COPY IN THE SHEET IS HIS, WORD FOR WORD
//
// The only permitted change to what he wrote is the dash rule, and that change
// is spelled out here rather than left to somebody's eye: "Monday-Friday" and
// "8:00 AM-7:00 PM" become "to", and the em dash before "not simply the order"
// becomes a comma. Everything else is compared character for character.
// ---------------------------------------------------------------------------
// Comment-stripped, like every other whole-file grep here. The doc comment
// above openHoursHelp quotes his rules about the copy, and a check reading the
// raw file could go green on the quotation after the copy itself had changed.
// The dash rule below deliberately reads the raw bytes instead; it is about
// what is served, comments included.
const HELP = code('public/js/help.js');
const ERICS_WORDS = [
  // UPDATED 2026-08-29, on Eric's word: "we're now doing Fri-Sun out of
  // office unless I manually turn it back on." Friday left the sentence the
  // same day it left the schedule, so the copy and the predicate cannot
  // disagree about what a Friday is.
  'Standard advocacy hours are Monday to Thursday, 8:00 AM to 7:00 PM Mountain Time, unless my current status shows otherwise.',
  'I check messages throughout the day, but responses are triaged based on urgency, time sensitivity, and what each case needs, not simply the order messages arrive.',
  'A time-sensitive issue, such as an appointment happening soon, a problem accessing care, a deadline, or an important change in your situation, may be prioritized ahead of a routine question or update.',
  "If I haven't responded yet, that doesn't necessarily mean I'm not working on your case.",
  'A significant part of advocacy happens behind the scenes. I may be reviewing your records, researching your case, preparing for an appointment, working through next steps, contacting or preparing communication for your care team, or handling something that indirectly moves your case forward.',
  'Some messages also deserve more than a quick answer. If I need to review information or do additional work before giving you a useful response, I may intentionally wait to respond until I can give the question the attention it deserves.',
  "You're always welcome to send messages outside office hours. I'll see them when I'm back in office.",
  'This chat is not an emergency or real-time medical service. If something requires immediate medical attention, use the appropriate emergency or medical resources available to you.',
];
// HIS FIRST SENTENCE IS NOW A NAMED CONSTANT, and that is deliberate: the
// paragraph a client reads and the string the local-time line is computed from
// have to be the same string, or the two halves of "8:00 AM to 7:00 PM
// Mountain, which is X to Y where you are" could come to state two different
// windows. The suite reads the constant and splices it back in where a client
// reads it, so the comparison below is still against the rendered order.
const SENTENCE = HELP.match(/^const HOURS_LINE = '(.+)';$/m);
check('E: his hours sentence is one named constant, so the Mountain half and '
  + 'the local half cannot state different times',
  !!SENTENCE, 'no `const HOURS_LINE = ...` in help.js');

// The prose block only: from his first sentence to his last. Everything before
// it is the live status line, which is markup rather than copy.
//
// The two interpolations inside it are the sentence itself and the computed
// local-time line. Both are named, and both are replaced by hand here rather
// than stripped by a wildcard, so ANY OTHER interpolation or added prose breaks
// the comparison instead of vanishing from it.
const block = HELP.slice(
  HELP.indexOf('<p>${HOURS_LINE}'),
  HELP.indexOf('available to you.') + 'available to you.'.length,
);
const prose = block
  .replace('${HOURS_LINE}', SENTENCE ? SENTENCE[1] : '(no HOURS_LINE)')
  .replace('${localLine}', '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

check('E: the sheet body is his eight blocks and nothing else',
  prose === ERICS_WORDS.join(' '),
  `got: ${prose.slice(0, 160)}...`);
check('E: and the computed local-time line really is in it, right under his hours',
  /\$\{HOURS_LINE\}<\/p>\s*\$\{localLine\}/.test(block),
  block.slice(0, 90));
for (const [i, want] of ERICS_WORDS.entries()) {
  check(`E: block ${i + 1} is word for word what he wrote`, prose.includes(want),
    want.slice(0, 60));
}

// The stated hours must be the constants the predicate uses. This is the check
// that catches somebody moving CLOSE_HOUR and leaving the sentence saying 7pm,
// or rewriting the sentence and leaving the code at 19.
{
  const said = ERICS_WORDS[0].match(/(\d+):00 AM to (\d+):00 PM/);
  check('E: the hours the copy states are the hours the code enforces',
    !!said && Number(said[1]) === OPEN_HOUR && Number(said[2]) + 12 === CLOSE_HOUR,
    said ? `copy says ${said[1]}am to ${said[2]}pm, code says ${OPEN_HOUR} to ${CLOSE_HOUR}` : 'no hours in the copy');
  check('E: and it names the zone the code is anchored to',
    /Mountain Time/.test(ERICS_WORDS[0]));
}

// ---------------------------------------------------------------------------
// BOTH CLOCKS. Eric asked for the reader's own timezone beside his.
//
// RUN, NOT GREPPED. office.js has no imports, so node can load it and the
// arithmetic is executed against named zones at fixed instants rather than
// eyeballed. The two fallbacks are executed too: a check that a thing degrades
// gracefully is worth nothing until the degrading has been watched.
{
  const SAY = SENTENCE ? SENTENCE[1] : '';
  const AUG = new Date('2026-08-05T18:00:00Z');   // a Wednesday, Boise on MDT
  const JAN = new Date('2026-01-07T18:00:00Z');   // a Wednesday, Boise on MST

  // Whitespace normalised, for the same reason wall() strips commas above: ICU
  // has put a plain space and a narrow no-break space before AM in different
  // versions, and the office hours are what is being tested, not the width of
  // a space character.
  const said = (zone, now) => localHoursNote(SAY, { zone, now }).replace(/\s/g, ' ');

  const east = said('America/New_York', AUG);
  check('E: a reader in New York is told his hours in their own clock',
    east === '10:00 AM to 9:00 PM your time', east || '(nothing printed)');
  check('E: and gets the same answer in January, because both clocks move',
    said('America/New_York', JAN) === east, said('America/New_York', JAN));
  const tokyo = said('Asia/Tokyo', AUG);
  check('E: a reader far enough away is told a time on the other side of midnight',
    tokyo === '11:00 PM to 10:00 AM your time', tokyo || '(nothing printed)');

  // The three ways it declines to guess. Mountain alone is the fallback, and
  // the fallback is an empty string that renders no line at all.
  check('E: a browser that reports no timezone gets Mountain alone, not nonsense',
    localHoursNote(SAY, { zone: '', now: AUG }) === '',
    localHoursNote(SAY, { zone: '', now: AUG }));
  check('E: a browser that reports an unusable timezone gets Mountain alone too',
    localHoursNote(SAY, { zone: 'Nowhere/Atlantis', now: AUG }) === '',
    localHoursNote(SAY, { zone: 'Nowhere/Atlantis', now: AUG }));
  check('E: and a sentence with no clock times in it prints nothing rather than guessing',
    localHoursNote('Standard advocacy hours are whenever I am about.',
      { zone: 'America/New_York', now: AUG }) === '');
  // A reader already on his clock would be shown his hours twice. Nothing is
  // said rather than something said pointlessly.
  check('E: a reader on his own clock is not told his hours a second time',
    localHoursNote(SAY, { zone: OFFICE_TZ, now: AUG }) === '',
    localHoursNote(SAY, { zone: OFFICE_TZ, now: AUG }));

  // The numbers it converts are read out of his sentence, not written down a
  // second time. Change the sentence, the conversion follows it.
  const moved = localHoursNote(
    'Standard advocacy hours are Monday to Friday, 9:00 AM to 5:00 PM Mountain Time.',
    { zone: 'America/New_York', now: AUG }).replace(/\s/g, ' ');
  check('E: the local line is computed FROM his sentence, so it cannot state '
    + 'different hours from the ones beside it',
    moved === '11:00 AM to 7:00 PM your time', moved || '(nothing printed)');

  // The zone office.js converts from must be the zone the Worker decides with.
  const zoneInOffice = code('public/js/office.js').match(/OFFICE_ZONE = '([^']+)'/);
  check('E: office.js converts from the same zone the shipped predicate uses',
    !!zoneInOffice && zoneInOffice[1] === OFFICE_TZ,
    `${zoneInOffice ? zoneInOffice[1] : 'no OFFICE_ZONE in office.js'} vs ${OFFICE_TZ}`);
  check('E: and help.js actually renders the line rather than only computing it',
    /localHoursNote\(HOURS_LINE\)/.test(code('public/js/help.js'))
    && /class="hours-local"/.test(code('public/js/help.js')));
  check('E: the local line is not dimmed or shrunk, being the half most '
    + 'clients will use',
    /\.help-card p\.hours-local \{[^}]*\}/.test(code('public/css/site.css'))
    && !/\.help-card p\.hours-local \{[^}]*(var\(--dim\)|font-size)/.test(code('public/css/site.css')),
    (code('public/css/site.css').match(/\.help-card p\.hours-local \{[^}]*\}/) || [''])[0]);
}

check('E: the sentence he asked to emphasise is the emphasised one',
  new RegExp(`class="hours-key"[^>]*>\\s*${ERICS_WORDS[3].slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    .test(HELP.replace(/\s+/g, ' ')),
  'the .hours-key block does not open with "If I haven\'t responded yet"');
check('E: and .hours-key is actually styled to stand out',
  /\.help-card p\.hours-key \{[^}]*font-weight: 700/.test(code('public/css/site.css')));

// THE SAFETY LINE IS NOT THE QUIETEST THING ON THE PAGE.
//
// THE EXPECTATION MOVED, 2026-08-27. It was var(--dim) at .88rem: fainter and
// smaller than every other paragraph in a sheet 1576px tall on a phone, with
// that line sitting about two screens down. The one sentence telling somebody
// to call for real medical help was the softest ink on it, and nobody had asked
// for that. It keeps Eric's position, last, and it keeps the rule above it that
// sets it apart; what it does not keep is the whisper.
{
  const safety = (code('public/css/site.css')
    .match(/\.help-card p\.hours-safety \{([^}]*)\}/) || [, ''])[1];
  check('E: the emergency line is styled at all, so this check has something to read',
    safety.trim().length > 0, 'no .help-card p.hours-safety rule');
  check('E: it is not dimmer than the prose around it',
    /color: var\(--soft\)/.test(safety) && !/var\(--dim\)/.test(safety),
    safety.replace(/\s+/g, ' ').trim());
  check('E: and not smaller either - no font-size at all, so it inherits',
    !/font-size/.test(safety), safety.replace(/\s+/g, ' ').trim());
  check('E: while keeping the rule that separates it from his copy',
    /border-top/.test(safety));
  // Position is his. The emergency note is the last thing he wrote and it stays
  // the last thing on the sheet.
  // BOTH ANCHORS HAVE TO BE FOUND. indexOf returns -1 for a string that is
  // gone, and every real index is greater than -1, so losing `hours-key`
  // entirely would have left this green. Measured 2026-08-28: renaming it in
  // the shipped sheet passed before, fails after.
  const safetyAt = HELP.indexOf('hours-safety');
  const keyAt = HELP.indexOf('hours-key');
  check('E: and its position in his order is unchanged, still last',
    ERICS_WORDS[ERICS_WORDS.length - 1].startsWith('This chat is not an emergency')
    && safetyAt >= 0 && keyAt >= 0 && safetyAt > keyAt,
    keyAt < 0 ? 'hours-key is not on the sheet at all'
      : safetyAt < 0 ? 'hours-safety is not on the sheet at all'
        : `safety at ${safetyAt}, key at ${keyAt}`);
}

// THE DASH RULE, on the copy this commit adds.
//
// Scope, stated honestly: the hours sheet, office.js and the office cue - the
// text this feature puts in front of a client, plus the module that paints it.
// A repo-wide scan of public/js would light up 39 files of PRE-EXISTING
// comments and is a separate job; defects.mjs section 15 covers the static
// pages, and this covers the new copy.
{
  const DASH = /[—–]|&(?:mdash|ndash|#8212|#8211|#x2014|#x2013);/i;
  check('E: no em or en dash anywhere in the hours copy',
    !DASH.test(block), (block.match(DASH) || [''])[0]);
  for (const w of ERICS_WORDS)
    check('E: no dash survives in his blocks either', !DASH.test(w));
  check('E: office.js is dash-free, comments included',
    !DASH.test(f('public/js/office.js')));
  check('E: and so is the whole of help.js, which is served to every client',
    !DASH.test(f('public/js/help.js')),
    (f('public/js/help.js').match(DASH) || [''])[0]);
}

// ---------------------------------------------------------------------------
// 6. THE CUE, THE "?", AND WHERE THEY ARE
//
// EVERY GREP BELOW READS code(), NOT f(). Three of the checks in this section
// were proved to pass with the line they guard commented out: the no-store on
// the status fetch, the "visibly different in each state" rule, and the import
// ban. The exceptions are named where they sit, and there are two: the dash
// rules above, which are about the served BYTES, and "never invents a response
// time", which is stricter with comments left in.
// ---------------------------------------------------------------------------
const OFFICE = code('public/js/office.js');
const CSS = code('public/css/site.css');
check('F: the cue and its "?" are built in one place, so the three chat '
  + 'surfaces cannot end up with three versions of it',
  /export function officeCueHtml/.test(OFFICE)
  && /data-help="hours"/.test(OFFICE));
// RUN, not grepped: the builder is imported and its output inspected, so a
// version of it that returns the wrong markup fails here rather than passing a
// grep for its own name.
{
  const html = officeCueHtml();
  check('F: what the builder actually returns is a pill and a "?"',
    /class="office-cue[^"]*"/.test(html) && /data-office/.test(html)
    && /data-help="hours"/.test(html), html);
  check('F: and it starts in the third state, not silently in "out"',
    /class="office-cue unknown"/.test(html) && />Checking</.test(html), html);
  check('F: the response-line slot is empty markup, filled from the answer',
    /data-office-line/.test(officeLineHtml()) && !/[A-Za-z]{3,}<\/span>/.test(officeLineHtml()),
    officeLineHtml());
  check('F: and the label really does say three different things',
    officeLabel(null) === 'Checking'
    && officeLabel({ inOffice: true }) === 'In office'
    && officeLabel({ inOffice: false }) === 'Out of office',
    [officeLabel(null), officeLabel({ inOffice: true }), officeLabel({ inOffice: false })].join(' / '));
}
for (const page of ['public/js/case.js', 'public/js/subscription.js', 'public/js/chat-page.js']) {
  const PAGE = code(page);
  check(`F: ${page.split('/').pop()} uses that one builder`,
    /officeCueHtml\(\)/.test(PAGE));
  check(`F: and wires the "?" it just rendered`, /wireHelp\(/.test(PAGE));
  // THE CHECK THAT WAS MISSING ENTIRELY. Nothing asserted that any client
  // surface actually STARTS the thing. Commenting out watchPresence(el) in
  // case.js left the pill frozen on its first state on every client's chat and
  // the whole battery stayed green. Rendering the markup is not painting it.
  check(`F: and ${page.split('/').pop()} starts the painter, or the pill never `
    + 'moves off "Checking"',
    /watch(?:Presence|Office)\(/.test(PAGE),
    'the markup is rendered but nothing ever paints it');
}
check('F: wireHelp knows the hours kind, or the button is a dead circle',
  /dataset\.help === 'hours' \? openHoursHelp\(\)/.test(code('public/js/help.js')));

check('F: the "?" is a true 44px, not the 40 it used to be',
  /\.help-dot \{ width: 2\.75rem; height: 2\.75rem; min-width: 2\.75rem/.test(CSS));
// CONTENT, NOT AN EMPTY BRACE. The old form matched `.office-cue.out { }` with
// nothing in it, so deleting every declaration from the out state left the
// check green and the two states identical. Each state now has to declare
// something, and the three have to differ from each other.
{
  const rule = (sel) => (CSS.match(new RegExp(`\\${sel} \\{([^}]*)\\}`)) || [, ''])[1].trim();
  const inRule = rule('.office-cue.in');
  const outRule = rule('.office-cue.out');
  const unknownRule = rule('.office-cue.unknown');
  check('F: the pill has a visibly different look in each state',
    /border-color: var\(--green\)/.test(inRule)
    && outRule.length > 0 && inRule !== outRule,
    `in: [${inRule}]  out: [${outRule}]`);
  // NOT KNOWING IS NOT BEING OUT. Cold, the pill used to be the out pill with
  // different words: same solid grey ring, same filled grey dot. A dropped
  // network read as "he is out of office".
  check('F: and "we do not know yet" does not look like "he is out"',
    unknownRule.length > 0 && unknownRule !== outRule
    && /border-style: dashed/.test(unknownRule),
    `unknown: [${unknownRule}]  out: [${outRule}]`);
}

// office.js is downloaded by the landing page through help.js. If it ever
// grows an import, that page starts pulling whatever the import pulls.
//
// THE WORD, NOT THE STATEMENT SHAPE. The old form was `^\s*import\s`, which
// misses `await import('./firebase.js')` entirely - a dynamic import drags the
// whole data layer onto the landing page just as surely, and sits mid-line.
check('F: office.js still imports nothing, statically or dynamically',
  !/\bimport\b/.test(OFFICE), (OFFICE.match(/.*\bimport\b.*/) || [''])[0]);

// A cached "in office" outliving his tap on the switch is the one failure this
// whole feature cannot have, and the route sends no cache-control of its own.
check('F: the status is never read from the browser cache',
  /cache: 'no-store'/.test(OFFICE), 'office.js fetches /api/availability without no-store');
// The public answer is two keys wide, and office.js must not be storing a third
// that the route no longer sends and nothing reads.
check('F: office.js reads nothing off the answer but the two public keys',
  !/\bout\.by\b/.test(OFFICE) && !/\bby:/.test(OFFICE),
  (OFFICE.match(/.*\bby\b.*/) || [''])[0]);

// NO RESPONSE TIME MAY BE INVENTED ANYWHERE ON THE CLIENT SIDE.
//
// Raw file on purpose, comments included: this one is stricter that way, and
// office.js has no comment that would trip it.
check('F: office.js never invents a response time',
  !/typically|usually within|within a few|hours to reply/i.test(f('public/js/office.js')));
// THE PROMISE ITSELF, ANYWHERE, HOWEVER QUOTED.
//
// THE EXPECTATION MOVED, 2026-08-27. The old form was `!/expectation = '(?!')/`
// - syntax-shaped, matching only a single-quoted assignment to one particular
// variable name. Writing the exact banned sentence back as
// `expectation = line || "I typically reply within a few days.";` left it
// green. It is content-shaped now: the words of the promise, in any quoting,
// anywhere in the file. Comments are stripped first, so the note recording the
// old default and why it went survives - the repo is still allowed to remember
// its own bugs.
const PROMISE = /typicall|usually within|within a few (?:days|hours)|reply within|respond within/i;
for (const page of ['public/js/subscription.js', 'public/js/admin-chats.js',
  'public/js/chat.js', 'public/js/help.js', 'public/js/case.js']) {
  check(`F: no built-in reply-time promise left in ${page.split('/').pop()}`,
    !PROMISE.test(code(page)),
    (code(page).match(new RegExp(`.*${PROMISE.source}.*`, 'i')) || [''])[0].trim().slice(0, 90));
}

// ---------------------------------------------------------------------------
// ONE RESPONSE LINE, ONE STORE.
//
// Two documents held a response-time promise and two surfaces read one each:
// the subscriber page rendered settings/subscriberChat.expectationLine beside
// the pill, and the "?" sheet two taps away rendered the office-hours line. A
// subscriber could be shown two different promises, both current. There is one
// now, it arrives on the same answer that paints the pill, and it is edited in
// one place.
// ---------------------------------------------------------------------------
{
  const SUB = code('public/js/subscription.js');
  const CHATS = code('public/js/admin-chats.js');
  check('F: the subscriber page no longer keeps its own response-line store',
    !/subscriberChat/.test(SUB) && !/expectationLine/.test(SUB),
    (SUB.match(/.*(subscriberChat|expectationLine).*/) || [''])[0]);
  check('F: it takes the line off the same answer that paints its pill',
    /officeLineHtml\(\)/.test(SUB));
  check('F: and there is no second editor writing a second document',
    !/expectationLine/.test(CHATS) && !/setDoc\(/.test(CHATS),
    (CHATS.match(/.*(expectationLine|setDoc\().*/) || [''])[0]);
  check('F: the one editor is the one beside his in/out switch',
    /data-rt/.test(code('public/js/admin-hours.js'))
    && /responseTime/.test(code('public/js/admin-hours.js')));
  check('F: and office.js is what fills the slot, from the served answer',
    /\[data-office-line\]/.test(OFFICE) && /state\.responseTime/.test(OFFICE));
}

// ---------------------------------------------------------------------------
// THE FLAG THAT SAID WHETHER HE HAD A TAB OPEN.
//
// presence/eric was world-readable in database.rules.json and written on every
// load of an advocate page, and nothing has read it since the pill replaced it.
// A stranger could subscribe to it and watch him work. Both halves went in the
// same commit, which is the only safe order to check them in: the write is gone
// AND the rule that published it is gone.
// ---------------------------------------------------------------------------
{
  // Comment-stripped, so the note explaining why the flag went cannot itself
  // satisfy or trip a check about the rules.
  const RTDB = strip(f('database.rules.json'));
  check('G: nothing writes the tab-open flag any more',
    !/presence\/eric/.test(code('public/js/auth.js')),
    (code('public/js/auth.js').match(/.*presence\/eric.*/) || [''])[0]);
  check('G: and the rule that published it is closed',
    !/"presence"/.test(RTDB) && !/"\.read":\s*true/.test(RTDB),
    (RTDB.match(/.*("presence"|"\.read":\s*true).*/) || [''])[0]);
  check('G: the database is shut to browsers in both directions',
    /"\.read":\s*false/.test(RTDB) && /"\.write":\s*false/.test(RTDB));
  // Nothing may still be depending on it. Checked before it was removed and
  // pinned here so it stays checked: the demo's own shim is gated behind the
  // admin asset gate and is not a client surface.
  const readers = ['public/js/chat.js', 'public/js/case.js', 'public/js/subscription.js',
    'public/js/chat-page.js', 'public/js/office.js', 'public/js/help.js',
    'public/js/auth.js', 'public/js/firebase.js'];
  check('G: and no client-served module names it at all, comments included',
    readers.every((x) => !/presence\/eric/.test(f(x))),
    readers.filter((x) => /presence\/eric/.test(f(x))).join(', '));
}

// ---------------------------------------------------------------------------
// 7. BLINDNESS: the advocate's half is behind the asset gate
// ---------------------------------------------------------------------------
{
  // A LOUD RED LINE, NOT A CRASH. This used to be `SRC.match(...)[1]`, which on
  // a rename threw a TypeError: exit 1, no FAIL line, no tail, no count. A
  // suite that cannot find the thing it is testing has FAILED, and has to say
  // so in the same words as every other failure.
  const gate = CODE.match(/const ADMIN_ASSET =\s*([\s\S]*?);/);
  check('G: the asset gate can still be found in worker/index.js', !!gate,
    'no `const ADMIN_ASSET = ...` - renamed, moved, or commented out');
  // Build the real regex from the real source and run paths through it, rather
  // than eyeballing that "admin-hours" looks like it matches.
  // eslint-disable-next-line no-new-func
  const RE = gate ? new Function(`return ${gate[1].trim()}`)() : /$^/;
  check('G: /js/admin-hours.js is 404 to a stranger', RE.test('/js/admin-hours.js'));
  check('G: /js/drawer.js still is too', RE.test('/js/drawer.js'));
  check('G: /js/office.js is NOT gated - clients need it',
    !RE.test('/js/office.js'));
  check('G: /css/admin.css, which carries the folder glow, is gated',
    RE.test('/css/admin.css'));
  // The audit proves the gate holds against a live server, but only for the
  // paths it is given. A module missing from its list is a module nobody is
  // proving anything about.
  const AUDIT = code('tools/blindness-audit.mjs');
  check('G: every admin- module in public/js is in the audit\'s own list',
    ['admin-hours.js', 'admin-presence.js', 'admin-ledger.js', 'admin.js',
      'admin-case.js', 'admin-chats.js', 'admin-calendar.js',
      'admin-availability.js', 'admin-dictionary.js', 'admin-settings.js']
      .every((x) => AUDIT.includes(`/js/${x}`)),
    ['admin-hours.js', 'admin-presence.js', 'admin-ledger.js']
      .filter((x) => !AUDIT.includes(`/js/${x}`)).join(', ') || 'listed');
}
check('G: the advocate control lives in the admin-named file, not a served one',
  /export function mountOfficeControl/.test(code('public/js/admin-hours.js'))
  && !/mountOfficeControl\s*\(/.test(OFFICE));
// Comments stripped, by code() at the top of this file. Commenting the call
// out left the name and its bracket sitting in the file, and this check went
// green on a page that had stopped mounting the control at all. That stripper
// is now what EVERY whole-file grep in this suite reads through.
check('G: and it is mounted on BOTH advocate pages, so they cannot disagree',
  /mountOfficeControl\(/.test(code('public/js/admin.js'))
  && /mountOfficeControl\(/.test(code('public/js/admin-availability.js')),
  `shelf ${/mountOfficeControl\(/.test(code('public/js/admin.js'))}, `
  + `availability ${/mountOfficeControl\(/.test(code('public/js/admin-availability.js'))}`);

// ---------------------------------------------------------------------------
// 8. "WORKING ON THIS CLIENT" IS A FOURTH DOOR ONTO THE EXISTING CLOCK
//
// Eric, 2026-08-25: "All clocks in/clock out buttons are manual. Nothing
// automatic." Eric, 2026-08-27: the long press "starts the clock back on for
// that client". AND THEN, 2026-08-29, the long press went: "long pressing
// the chart isn't the way to go about toggling on if I'm working. For
// reasons I won't explain. I want a toggle-able pill like a light switch.
// On/off for work with a 0.25 second animation of the switch flipping."
//
// The nine pins that held the menu are flipped to pin its ABSENCE and the
// switch that replaced it; the originals and their negative controls are in
// this file's history at v2.49. The DIAGNOSIS long press is a different
// feature and its pins stand further down.
// ---------------------------------------------------------------------------
// code(), not f(). Both of these are whole-file greps and both were proved to
// pass on commented-out lines.
const DRAWER = code('public/js/drawer.js');
const ADMINJS = code('public/js/admin.js');
const SITECSS = code('public/css/site.css');
check('H: the long-press work menu is gone, both halves',
  !/wireFolderLongPress/.test(DRAWER) && !/openWorkSheet/.test(DRAWER)
  && !/Working on this client/.test(DRAWER)
  && !/wireFolderLongPress|openWorkSheet|folderIsWorking/.test(ADMINJS));
check('H: the switch on the card is the one door, and it is a real switch',
  /role="switch"/.test(DRAWER) && /aria-checked/.test(DRAWER)
  && /wk-sw/.test(DRAWER) && /wk-knob/.test(DRAWER)
  && !/fetch\(\s*'\/api\/work'/.test(ADMINJS),
  /fetch\(\s*'\/api\/work'/.test(ADMINJS) ? 'admin.js posts to /api/work directly' : '');
check('H: the knob flips in a quarter second, and holds still under reduced motion',
  /\.folder-clock \.wk-knob \{[\s\S]*?transition: transform \.25s ease;/.test(SITECSS)
  && /\.folder-clock\.on \.wk-knob \{ transform: translateX\(\.8rem\); \}/.test(SITECSS)
  && /prefers-reduced-motion[\s\S]{0,200}?\.wk-knob \{ transition: none; \}/.test(SITECSS));
check('H: flipping updates what a screen reader is told',
  /setAttribute\('aria-checked', out\.running \? 'true' : 'false'\)/.test(DRAWER));
check('H: wireFolderClocks still hands its toggle back to a future caller',
  /root\.__paClocksApi = \{[\s\S]*?toggleById/.test(DRAWER)
  && /if \(root\.__paClocks\) return root\.__paClocksApi;/.test(DRAWER));

// 2026-09-03: his own case wears a second modifier, the purple `self`, so
// the pin now reads the two together. The green glow is still the running
// clock's alone: `working` is set from nothing but `clock?.running`.
check('H: the glow is the running clock and nothing else',
  /class="folder\$\{clock\?\.running \? ' working' : ''\}\$\{self \? ' self' : ''\}"/.test(DRAWER));
// Two paths CHANGE a running clock at runtime - the toggle and the beacon's
// "this was stopped" event - and both must repaint the folder. The third path,
// the first paint, is the class in folderCardHtml checked just above.
check('H: and every path that moves the clock moves the glow with it',
  (DRAWER.match(/glow\(id, /g) || []).length >= 2,
  `${(DRAWER.match(/glow\(id, /g) || []).length} call sites`);
check('H: the glow is green, and off is plain manila again',
  /\.folder\.working \{[\s\S]*?outline: 2px solid var\(--green\)/.test(code('public/css/admin.css')));
// THE EXPECTATION MOVED, 2026-08-27, because the old one was vacuous.
//
// It was `!/auto: true/`, pinning the absence of a string that has never once
// existed in drawer.js. It could not go red for any edit anybody could make: a
// check that cannot fail is not evidence, it is decoration. What the rule
// actually says (Eric, 2026-08-25: "All clocks in/clock out buttons are manual.
// Nothing automatic.") is that every clock this file starts is flagged as a
// deliberate tap, so this reads the flags that are really there and requires
// them all to say so. Flip one to true, or delete the flag, and it goes red.
{
  const flags = [...DRAWER.matchAll(/auto:\s*(\w+)/g)].map((m) => m[1]);
  check('H: nothing in it starts a clock without him (the 2026-08-25 rule)',
    flags.length > 0 && flags.every((x) => x === 'false'),
    flags.length ? flags.join(', ') : 'no auto flag in drawer.js at all');
}

// ---- clearing the calendar (Eric, 2026-08-30) -----------------------------
//
// "Clear my calendar of any open slots. Also, make a button to clear the
// entire calendar, as well as a small x by the day to clear the day of
// availability." Three pins: the bulk route only ever deletes what is open
// at that moment, the one-shot sweep actually runs from the cron, and the
// two controls exist and stop for a confirm before anything dies.
{
  const W = code('worker/index.js');
  const AV = code('public/js/admin-availability.js');
  // NEGATIVE CONTROL (run 2026-08-30): replacing the openIds fence with
  // `true` made this read
  //   FAIL  X: the bulk clear deletes only slots that are open right now
  check('X: the bulk clear deletes only slots that are open right now',
    /'\/api\/admin\/slots-clear' && request\.method === 'POST'/.test(W)
    && /const openIds = new Set\(open\.map\(\(s\) => s\.id\)\)/.test(W)
    && /openIds\.has\(id\)/.test(W)
    && /batchDelete\(env, goners\.map/.test(W));
  // NEGATIVE CONTROL (run 2026-08-30): deleting the cron waitUntil hook made
  // this read
  //   FAIL  X: the one-shot sweep is marked, cron-run, and leaves booked slots be
  check('X: the one-shot sweep is marked, cron-run, and leaves booked slots be',
    /migrations\/clear-open-slots-2026-08-30/.test(W)
    && /ctx\.waitUntil\(clearOpenSlots\(env\)\)/.test(W)
    && /\[\['state', 'EQUAL', 'open'\]\], 500\)/.test(W));
  // NEGATIVE CONTROL (run 2026-08-30): guarding the confirm behind
  // `false &&` made this read
  //   FAIL  X: clear-all and the day x both exist and both stop for a confirm
  check('X: clear-all and the day x both exist and both stop for a confirm',
    /getElementById\('clear-all'\)\.addEventListener/.test(AV)
    && /data-day-clear=/.test(AV)
    && /if \(!confirm\(/.test(AV)
    && /'\/api\/admin\/slots-clear'/.test(AV));
}

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
