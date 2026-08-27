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
//   MOUNTAIN_TZ becomes America/Denver               A all six August rows,
//                                                      plus the two zone rows
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
//   the settings doc moves out of settings/          C 4 rows incl. "every
//                                                      document is inside
//                                                      settings/"
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
//   the subscriber reply-time default returns        F "no built-in reply-time
//                                                      promise left"
//   .office-cue.in loses its green                   F "visibly different look
//                                                      in each state"
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
// THREE OF THESE PASSED SILENTLY THE FIRST TIME and the checks were rewritten
// until they did not. Each rewrite carries its own note at the check:
//   - the in-memory patchDoc merged whether or not a mask was given, so
//     deleting the mask from the shipped handler broke nothing here;
//   - "mounted on BOTH advocate pages" matched the call inside a `//` comment;
//   - "leaves the same lp mark" matched wireDxLongPress's mark, not the new
//     one, so deleting the new one stayed green.
// A fourth was a crash rather than a pass: one check dereferenced a null and
// threw, which prints no FAIL line at all. It is optional-chained now.
// ===========================================================================
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';

// The real thing, imported rather than copied. If this import ever fails the
// suite dies loudly, which is the correct outcome: there is nothing to test.
import {
  scheduledOpen, officeStatus, OPEN_HOUR, CLOSE_HOUR, MOUNTAIN_TZ,
} from '../../worker/schedule.js';

const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

// ---------------------------------------------------------------------------
// 1. THE SCHEDULE, RUN AGAINST REAL INSTANTS
//
// MOUNTAIN_TZ is a FIXED UTC-7 offset with no daylight saving (Eric's call,
// 2026-07-11, and every bookable slot is anchored to it). So an MST wall-clock
// hour H is always UTC H+7, in January and in August alike, and each instant
// below is built that way.
//
// EVERY CASE IS RUN IN BOTH JANUARY AND AUGUST on purpose. Not because the
// answer should differ - it must NOT - but because "it must not" is the thing
// worth pinning. If anybody ever swaps this zone for America/Denver, the
// August rows go red and say so, instead of the office light quietly sliding
// an hour away from the booking calendar for eight months of the year.
//
// The MST weekday and wall time of each instant are asserted alongside the
// answer, so a mistyped date cannot make a check pass for the wrong reason.
// ---------------------------------------------------------------------------
const wallFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
// Commas stripped: ICU has spelled this "Mon, 08:00" and "Mon 08:00" in
// different versions, and the suite is testing the office hours, not the
// punctuation of a date formatter.
const wall = (iso) => wallFmt.format(new Date(iso)).replace(/,/g, '');

// [iso, what it should be in MST, expected in-office]
const SCHEDULE_CASES = [
  // January
  ['2026-01-05T14:59:00Z', 'Mon, 07:59', false],
  ['2026-01-05T15:00:00Z', 'Mon, 08:00', true],
  ['2026-01-06T01:59:00Z', 'Mon, 18:59', true],
  ['2026-01-06T02:00:00Z', 'Mon, 19:00', false],
  ['2026-01-10T19:00:00Z', 'Sat, 12:00', false],
  ['2026-01-11T19:00:00Z', 'Sun, 12:00', false],
  // August. Same six, same answers, on the far side of where daylight saving
  // would sit if this zone observed it.
  ['2026-08-03T14:59:00Z', 'Mon, 07:59', false],
  ['2026-08-03T15:00:00Z', 'Mon, 08:00', true],
  ['2026-08-04T01:59:00Z', 'Mon, 18:59', true],
  ['2026-08-04T02:00:00Z', 'Mon, 19:00', false],
  ['2026-08-08T19:00:00Z', 'Sat, 12:00', false],
  ['2026-08-09T19:00:00Z', 'Sun, 12:00', false],
];

for (const [iso, expectWall, expectOpen] of SCHEDULE_CASES) {
  const month = iso.slice(0, 7);
  check(`A: ${expectWall} in ${month} is ${expectOpen ? 'IN office' : 'OUT of office'}`,
    wall(iso) === expectWall.replace(/,/g, '') && scheduledOpen(new Date(iso)) === expectOpen,
    `clock read ${wall(iso)}, predicate said ${scheduledOpen(new Date(iso))}`);
}

// The two halves of the pair must give the SAME answer, which is the fixed
// offset stated as an assertion rather than as a comment.
for (let i = 0; i < 6; i += 1) {
  const [janIso, w] = SCHEDULE_CASES[i];
  const [augIso] = SCHEDULE_CASES[i + 6];
  check(`A: ${w} answers the same in January and August (the zone has no DST)`,
    scheduledOpen(new Date(janIso)) === scheduledOpen(new Date(augIso)),
    `${scheduledOpen(new Date(janIso))} vs ${scheduledOpen(new Date(augIso))}`);
}

check('A: the predicate reads the hours off the shipped constants, 8 and 19',
  OPEN_HOUR === 8 && CLOSE_HOUR === 19, `${OPEN_HOUR}..${CLOSE_HOUR}`);
check('A: and the zone is still the fixed UTC-7 the calendar is anchored to',
  MOUNTAIN_TZ === 'Etc/GMT+7', MOUNTAIN_TZ);
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
  if (!m) throw new Error(`could not lift ${name}`);
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

reset();
const fresh = await W.handleAvailability(env);
check('C: with no settings document at all, the schedule decides and nothing throws',
  fresh.status === 200 && typeof fresh.body.inOffice === 'boolean' && fresh.body.by === 'schedule',
  JSON.stringify(fresh.body));
check('C: and no response time is promised', fresh.body.responseTime === null,
  JSON.stringify(fresh.body));

await W.handleOfficeHoursControl(req({ manual: 'out' }), env);
const afterOut = await W.handleAvailability(env);
check('C: setting OUT is read back as out, by his hand rather than by the clock',
  afterOut.body.inOffice === false && afterOut.body.by === 'manual',
  JSON.stringify(afterOut.body));
check('C: and is stamped setByHand, the same stamp settings/booking carries',
  docs.get('settings/officeHours')?.setByHand === true,
  JSON.stringify(docs.get('settings/officeHours')));

await W.handleOfficeHoursControl(req({ manual: null }), env);
check('C: clearing it hands the answer back to the schedule',
  (await W.handleAvailability(env)).body.by === 'schedule',
  JSON.stringify(docs.get('settings/officeHours')));

// The masked-write property, which is the thing a bare setDoc would have
// broken - see the same defect fixed in admin-chats.js in this commit.
reset();
await W.handleOfficeHoursControl(req({ responseTime: 'I answer most messages the same day.' }), env);
await W.handleOfficeHoursControl(req({ manual: 'out' }), env);
check('C: flipping the switch does not wipe the response line he typed',
  docs.get('settings/officeHours')?.responseTime === 'I answer most messages the same day.',
  JSON.stringify(docs.get('settings/officeHours')));
await W.handleOfficeHoursControl(req({ responseTime: 'Back Monday.' }), env);
check('C: and saving the line does not wipe the switch',
  docs.get('settings/officeHours')?.manual === 'out',
  JSON.stringify(docs.get('settings/officeHours')));

// NEVER PROMISE A RESPONSE TIME UNLESS ONE HAS BEEN SET BY HAND.
reset();
docs.set('settings/officeHours', { responseTime: '   ' });
check('C: a blank line is no line, not an empty promise on a client screen',
  (await W.handleAvailability(env)).body.responseTime === null);
docs.set('settings/officeHours', { responseTime: '  Usually within a day.  ' });
check('C: a real line comes back trimmed',
  (await W.handleAvailability(env)).body.responseTime === 'Usually within a day.');
docs.set('settings/officeHours', { responseTime: 'x'.repeat(400) });
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
  && !docs.has('settings/officeHours'));
check('C: a response time that is not text is refused too',
  (await W.handleOfficeHoursControl(req({ responseTime: 42 }), env)).status === 400);

reset();
ADMIN = false;
const stranger = await W.handleOfficeHoursControl(req({ manual: 'in' }), env);
check('C: a stranger gets 404 from the control, like every other admin route',
  stranger.status === 404 && stranger.body.error === 'Not found', JSON.stringify(stranger));
check('C: and changed nothing', !docs.has('settings/officeHours'));
ADMIN = true;

// The public read is public: it must NOT be behind requireAdmin, or the pill
// on a client's chat says "Checking" for ever.
check('C: the public read never asks for an admin',
  !/async function handleAvailability\([\s\S]*?\n\}/.exec(SRC)[0].includes('requireAdmin'));
check('C: and is routed as a public GET, beside /api/rates',
  /url\.pathname === '\/api\/availability' && request\.method === 'GET'/.test(SRC));
check('C: the control is routed too',
  /url\.pathname === '\/api\/admin\/office-hours'/.test(SRC));

// The settings document lives under settings/, which firestore.rules already
// makes public-read and admin-write. No rules change is needed, and this is
// the check that says so out loud rather than leaving it to memory.
{
  const RULES = f('firestore.rules');
  check('C: settings/ is already public-read and admin-write, so no rules change',
    /match \/settings\/\{doc\}[\s\S]*?allow read: if true;[\s\S]*?allow write: if isAdmin\(\);/.test(RULES));
  // EVERY path the two handlers touch, not just the first one that happens to
  // match. A first version of this looked for one literal, and moving the
  // document out from under settings/ left that literal behind elsewhere in
  // the file and the check stayed green on a document the rules do not cover.
  const paths = [...LIFTED.matchAll(/(?:getDoc|patchDoc)\(env, '([^']+)'/g)].map((m) => m[1]);
  check('C: and every document this feature touches is inside settings/',
    paths.length > 0 && paths.every((p) => p.startsWith('settings/')),
    paths.join(', ') || 'no document paths found at all');
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
  const DEMO = f('public/js/demo/api.js');
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
const HELP = f('public/js/help.js');
const ERICS_WORDS = [
  'Standard advocacy hours are Monday to Friday, 8:00 AM to 7:00 PM Mountain Time, unless my current status shows otherwise.',
  'I check messages throughout the day, but responses are triaged based on urgency, time sensitivity, and what each case needs, not simply the order messages arrive.',
  'A time-sensitive issue, such as an appointment happening soon, a problem accessing care, a deadline, or an important change in your situation, may be prioritized ahead of a routine question or update.',
  "If I haven't responded yet, that doesn't necessarily mean I'm not working on your case.",
  'A significant part of advocacy happens behind the scenes. I may be reviewing your records, researching your case, preparing for an appointment, working through next steps, contacting or preparing communication for your care team, or handling something that indirectly moves your case forward.',
  'Some messages also deserve more than a quick answer. If I need to review information or do additional work before giving you a useful response, I may intentionally wait to respond until I can give the question the attention it deserves.',
  "You're always welcome to send messages outside office hours. I'll see them when I'm back in office.",
  'This chat is not an emergency or real-time medical service. If something requires immediate medical attention, use the appropriate emergency or medical resources available to you.',
];
// The prose block only: from his first sentence to his last. Everything before
// it is the live status line, which is markup rather than copy.
const block = HELP.slice(
  HELP.indexOf('<p>Standard advocacy hours'),
  HELP.indexOf('available to you.') + 'available to you.'.length,
);
const prose = block.replace(/<[^>]+>/g, ' ')
  .replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

check('E: the sheet body is his eight blocks and nothing else',
  prose === ERICS_WORDS.join(' '),
  `got: ${prose.slice(0, 160)}...`);
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

check('E: the sentence he asked to emphasise is the emphasised one',
  new RegExp(`class="hours-key"[^>]*>\\s*${ERICS_WORDS[3].slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`)
    .test(HELP.replace(/\s+/g, ' ')),
  'the .hours-key block does not open with "If I haven\'t responded yet"');
check('E: and .hours-key is actually styled to stand out',
  /\.help-card p\.hours-key \{[^}]*font-weight: 700/.test(f('public/css/site.css')));

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
// ---------------------------------------------------------------------------
const OFFICE = f('public/js/office.js');
check('F: the cue and its "?" are built in one place, so the three chat '
  + 'surfaces cannot end up with three versions of it',
  /export function officeCueHtml/.test(OFFICE)
  && /data-help="hours"/.test(OFFICE));
for (const page of ['public/js/case.js', 'public/js/subscription.js', 'public/js/chat-page.js']) {
  check(`F: ${page.split('/').pop()} uses that one builder`,
    /officeCueHtml\(\)/.test(f(page)));
  check(`F: and wires the "?" it just rendered`, /wireHelp\(/.test(f(page)));
}
check('F: wireHelp knows the hours kind, or the button is a dead circle',
  /dataset\.help === 'hours' \? openHoursHelp\(\)/.test(HELP));

check('F: the "?" is a true 44px, not the 40 it used to be',
  /\.help-dot \{ width: 2\.75rem; height: 2\.75rem; min-width: 2\.75rem/.test(f('public/css/site.css')));
check('F: the pill has a visibly different look in each state',
  /\.office-cue\.in \{[^}]*border-color: var\(--green\)/.test(f('public/css/site.css'))
  && /\.office-cue\.out \{/.test(f('public/css/site.css')));

// office.js is downloaded by the landing page through help.js. If it ever
// grows an import, that page starts pulling whatever the import pulls.
check('F: office.js still imports nothing',
  !/^\s*import\s/m.test(OFFICE), (OFFICE.match(/^\s*import\s.*/m) || [''])[0]);

// A cached "in office" outliving his tap on the switch is the one failure this
// whole feature cannot have, and the route sends no cache-control of its own.
check('F: the status is never read from the browser cache',
  /cache: 'no-store'/.test(OFFICE), 'office.js fetches /api/availability without no-store');

// No response time may be invented anywhere on the client side.
check('F: office.js never invents a response time',
  !/typically|usually within|within a few|hours to reply/i.test(OFFICE));
// The DEFAULT, not the word: the comment on that line records what the old
// default said and why it went, and a check that could not tell the two apart
// would forbid the repo from remembering its own bugs.
check('F: and the subscriber page has no built-in reply-time promise left',
  !/expectation = '(?!')/.test(f('public/js/subscription.js')),
  (f('public/js/subscription.js').match(/expectation = '.*/) || [''])[0]);

// ---------------------------------------------------------------------------
// 7. BLINDNESS: the advocate's half is behind the asset gate
// ---------------------------------------------------------------------------
{
  const gate = SRC.match(/const ADMIN_ASSET =\s*([\s\S]*?);/)[1];
  // Build the real regex from the real source and run paths through it, rather
  // than eyeballing that "admin-hours" looks like it matches.
  // eslint-disable-next-line no-new-func
  const RE = new Function(`return ${gate.trim()}`)();
  check('G: /js/admin-hours.js is 404 to a stranger', RE.test('/js/admin-hours.js'));
  check('G: /js/drawer.js still is too', RE.test('/js/drawer.js'));
  check('G: /js/office.js is NOT gated - clients need it',
    !RE.test('/js/office.js'));
  check('G: /css/admin.css, which carries the folder glow, is gated',
    RE.test('/css/admin.css'));
}
check('G: the advocate control lives in the admin-named file, not a served one',
  /export function mountOfficeControl/.test(f('public/js/admin-hours.js'))
  && !/mountOfficeControl\s*\(/.test(OFFICE));
// Comments stripped first. Commenting the call out left the name and its
// bracket sitting in the file, and this check went green on a page that had
// stopped mounting the control at all.
const code = (p) => f(p).replace(/^\s*\/\/.*$/gm, '');
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
// that client". The danger is a fifth clock rather than a fourth switch, so
// what is pinned here is that the menu goes through the SAME toggle.
// ---------------------------------------------------------------------------
const DRAWER = f('public/js/drawer.js');
const ADMINJS = f('public/js/admin.js');
check('H: the long press exists and opens a menu',
  /export function wireFolderLongPress/.test(DRAWER)
  && /export function openWorkSheet/.test(DRAWER));
// The ROW, not the prose. The doc comment above openWorkSheet quotes him
// saying the words, so a check that matched anywhere in the file would go
// green on the quotation after the button had been renamed to something else.
check('H: the menu row says exactly what he asked it to say',
  /: 'Working on this client'\}<\/span>/.test(DRAWER.replace(/\s+/g, ' ')),
  'no "Working on this client" row in the sheet markup');
check('H: and offers the way back off it',
  /Stop working on this client/.test(DRAWER));
// A fetch, not a mention: the comment above the handler names the route it is
// deliberately NOT calling, and that sentence is worth keeping.
check('H: the handler runs the card toggle rather than posting to /api/work '
  + 'itself, so the two doors are one behaviour',
  /toggleById\(id\)/.test(ADMINJS) && !/fetch\(\s*'\/api\/work'/.test(ADMINJS),
  /fetch\(\s*'\/api\/work'/.test(ADMINJS) ? 'admin.js posts to /api/work directly' : '');
check('H: wireFolderClocks hands that toggle back to its caller',
  /root\.__paClocksApi = \{[\s\S]*?toggleById/.test(DRAWER));
check('H: and keeps handing it back after a repaint, when it returns early',
  /if \(root\.__paClocks\) return root\.__paClocksApi;/.test(DRAWER));
// Scoped to the NEW function. wireDxLongPress sets the same mark a hundred
// lines up, so a whole-file grep stayed green after the mark was deleted from
// the folder press and every long press started opening the case underneath
// its own menu.
const PRESS = (DRAWER.match(/export function wireFolderLongPress\([\s\S]*?\n\}/) || [''])[0];
check('H: the folder press function can be found at all', PRESS.length > 200);
check('H: the press leaves the same lp mark, so the trailing click does not '
  + 'also open the case',
  /card\.dataset\.lp = '1';/.test(PRESS));
check('H: it keeps its hands off the diagnosis line and the clock control, '
  + 'which already own the press and the tap',
  /closest\?\.\('\.folder-dx'\) \|\| e\.target\.closest\?\.\('\[data-clock\]'\)/.test(PRESS));
check('H: and uses the app-wide press length rather than one of its own',
  /LONG_PRESS_MS\)/.test(PRESS) && /const LONG_PRESS_MS = 550;/.test(DRAWER));

check('H: the glow is the running clock and nothing else',
  /class="folder\$\{clock\?\.running \? ' working' : ''\}"/.test(DRAWER));
// Two paths CHANGE a running clock at runtime - the toggle and the beacon's
// "this was stopped" event - and both must repaint the folder. The third path,
// the first paint, is the class in folderCardHtml checked just above.
check('H: and every path that moves the clock moves the glow with it',
  (DRAWER.match(/glow\(id, /g) || []).length >= 2,
  `${(DRAWER.match(/glow\(id, /g) || []).length} call sites`);
check('H: the glow is green, and off is plain manila again',
  /\.folder\.working \{[\s\S]*?outline: 2px solid var\(--green\)/.test(f('public/css/admin.css')));
check('H: nothing in it starts a clock without him (the 2026-08-25 rule)',
  !/auto: true/.test(DRAWER));

// ---------------------------------------------------------------------------
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
