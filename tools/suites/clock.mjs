// clock.mjs — the work clock, driven against the REAL worker functions
// lifted out of worker/index.js, over an in-memory Firestore.
//
// The point of lifting rather than reimplementing: these assertions are about
// Eric's rules, and a hand-copied clone of the logic would keep passing after
// the real one broke.
//
// THE RULE CHANGED 2026-08-25 ("All clocks in/clock out buttons are manual.
// Nothing automatic."), and this suite's expectations changed with it in the
// same commit: an automatic start is now asserted to be a NO-OP, the beacon
// is asserted to never stop a hand-started clock, and the old auto behaviour
// survives only as the LEGACY-reap checks. The ask ladder stays: a question
// is not an automation.
//
// Run: node clock.mjs
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

// ---- lift the real source ------------------------------------------------
function fn(name) {
  const re = new RegExp(`\\nasync function ${name}\\([\\s\\S]*?\\n\\}`);
  const m = SRC.match(re);
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
function konst(name) {
  const m = SRC.match(new RegExp(`\\nconst ${name} = [^;]+;`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0];
}

const LIFTED = [
  konst('WORK_NUDGE_MINUTES'), konst('WORK_PRESENCE_STALE_MS'), konst('CLOCK_DOC'),
  fn('setClockRunning'), fn('stopWorkClock'), fn('handleWork'),
  fn('handleWorkPresence'), fn('runWorkClockNudges'),
].join('\n');

// ---- the world it runs in ------------------------------------------------
let docs, pushes, NOW;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

const deps = {
  // Deep-copies out, so a test that mutates a returned doc cannot corrupt the
  // store and quietly make a later assertion pass.
  getDoc: async (env, path) => (docs.has(path) ? { data: clone(docs.get(path)), updateTime: '1' } : null),
  patchDoc: async (env, path, patch, opts = {}) => {
    const cur = docs.get(path) || {};
    const mask = opts.mask;
    const next = { ...cur };
    for (const k of mask || Object.keys(patch)) next[k] = clone(patch[k]);
    docs.set(path, next);
    return true;
  },
  queryDocs: async () => [{ id: 'eric', data: { role: 'admin' } }],
  notifyUser: async (env, uid, msg) => { pushes.push(msg); },
  firstName: (v) => String(v || '').trim().split(/\s+/)[0] || '',
  json: (data, status = 200) => ({ status, body: data }),
  requireAdmin: async () => ({ uid: 'eric' }),
};

// The lifted code stamps times with `new Date()`, which does NOT route through
// Date.now(), so stubbing Date.now alone left every write on the real wall
// clock while the assertions ran on the fake one. Shadow the constructor too,
// passed in as a parameter so it shadows the global inside the lifted scope
// only.
class FakeDate extends Date {
  constructor(...a) { if (!a.length) super(NOW); else super(...a); }
  static now() { return NOW; }
}

const build = new Function(
  ...Object.keys(deps), 'Date',
  `${LIFTED}
   return { handleWork, handleWorkPresence, runWorkClockNudges, stopWorkClock,
            WORK_NUDGE_MINUTES, WORK_PRESENCE_STALE_MS, CLOCK_DOC };`,
);
const W = build(...Object.values(deps), FakeDate);

const env = {};
const req = (body) => ({ json: async () => body });
const work = (id) => docs.get(`cases/${id}`)?.work || {};
const running = () => (docs.get(W.CLOCK_DOC)?.running || []).slice().sort();

function reset() {
  docs = new Map();
  pushes = [];
  NOW = Date.parse('2026-08-25T18:00:00Z');
  docs.set('cases/a', { clientName: 'Jordan Avery', work: { seconds: 3600 } });
  docs.set('cases/b', { clientName: 'Sam Rivera', work: { seconds: 600 } });
}
// One clock for the whole suite, so "five minutes later" is a line of code.
const realNow = Date.now;
Date.now = () => NOW;
const advance = (mins) => { NOW += mins * 60_000; };

// ---- manual only ---------------------------------------------------------
reset();
const noop = await W.handleWork(req({ caseId: 'a', on: true, auto: true }), env);
check('C1 an automatic start is a NO-OP: nothing starts (manual only, 2026-08-25)',
  !work('a').startedAt && noop.body.running === false, JSON.stringify(noop.body));
check('C2 and the running list stays empty', running().length === 0, running().join());

await W.handleWork(req({ caseId: 'a', on: true, auto: false }), env);
check('C3 a deliberate tap starts the clock, pinned',
  !!work('a').startedAt && work('a').auto === false);
check('C4 a running clock is registered so the cron costs one read',
  running().join() === 'a', running().join());

// A double tap mid-stretch must not restart it.
advance(30);
const again = await W.handleWork(req({ caseId: 'a', on: true, auto: false }), env);
check('C5 a second start keeps the original start rather than resetting it',
  new Date(again.body.startedAt).getTime() === NOW - 30 * 60_000,
  `${again.body.startedAt} vs now ${new Date(NOW).toISOString()}`);
check('C6 the banked total is untouched by it', work('a').seconds === 3600);
const noop2 = await W.handleWork(req({ caseId: 'a', on: true, auto: true }), env);
check('C7 an auto start over a running clock changes nothing and reports the truth',
  noop2.body.running === true
  && new Date(noop2.body.startedAt).getTime() === NOW - 30 * 60_000,
  JSON.stringify(noop2.body));

// Walking around the app stops NOTHING he started by hand.
await W.handleWorkPresence(req({ caseId: '' }), env);
check('C8 a manual clock survives leaving the chart', !!work('a').startedAt);
await W.handleWorkPresence(req({ caseId: 'b' }), env);
check('C9 and survives opening somebody else', !!work('a').startedAt);

// Two at once is the whole reason the shelf control exists.
await W.handleWork(req({ caseId: 'b', on: true, auto: false }), env);
check('C10 two clocks run at once with their own totals',
  !!work('a').startedAt && !!work('b').startedAt && running().join() === 'a,b');

// ---- the legacy auto stretch ---------------------------------------------
// A clock started under the retired chart-entry rule can still exist on a
// case doc. The beacon reaps it; a tap over it pins it. This is cleanup of
// old state, not a live behaviour - nothing can CREATE one any more (C1).
reset();
docs.set('cases/a', {
  clientName: 'Jordan Avery',
  work: { seconds: 3600, startedAt: new Date(NOW).toISOString(), auto: true },
});
docs.set(W.CLOCK_DOC, { running: ['a'], seenAt: new Date(NOW).toISOString(), atCaseId: 'a' });
advance(30);
const beacon = await W.handleWorkPresence(req({ caseId: '' }), env);
check('C11 a LEGACY auto stretch is reaped by the beacon and banked',
  !work('a').startedAt && work('a').seconds === 3600 + 30 * 60,
  String(work('a').seconds));
check('C11b the beacon reports the stop AND the new total, so the page it came '
  + 'from can correct the card it already painted',
  beacon.body.stopped?.[0]?.id === 'a' && beacon.body.stopped[0].seconds === 3600 + 30 * 60,
  JSON.stringify(beacon.body.stopped));
check('C11c the running list empties with it', running().length === 0, running().join());

reset();
docs.set('cases/a', {
  clientName: 'Jordan Avery',
  work: { seconds: 3600, startedAt: new Date(NOW).toISOString(), auto: true },
});
docs.set(W.CLOCK_DOC, { running: ['a'] });
await W.handleWork(req({ caseId: 'a', on: true, auto: false }), env);
check('C12 a tap over a legacy auto stretch pins it', work('a').auto === false);
await W.handleWorkPresence(req({ caseId: '' }), env);
check('C13 so the beacon no longer stops it', !!work('a').startedAt);

// ---- leaving the app ----------------------------------------------------
reset();
await W.handleWork(req({ caseId: 'a', on: true, auto: false }), env);
await W.handleWorkPresence(req({ caseId: 'a' }), env);
advance(2);
await W.runWorkClockNudges(env);
check('C14 nothing is asked while the app is open', pushes.length === 0);
check('C15 and a running clock is NOT stopped by the app closing',
  !!work('a').startedAt);

advance(4); // 6 minutes since the last beacon
await W.runWorkClockNudges(env);
check('C16 the first rung fires at five minutes away', pushes.length === 1,
  JSON.stringify(pushes));
check('C17 it names the client and offers the answer screen',
  pushes[0]?.body.startsWith('Jordan:') && pushes[0]?.link.includes('clock=ask'),
  JSON.stringify(pushes[0]));
await W.runWorkClockNudges(env);
await W.runWorkClockNudges(env);
check('C18 a rung fires once, not once a minute', pushes.length === 1);

advance(5); // 11 minutes
await W.runWorkClockNudges(env);
check('C19 the ten minute rung still gets through', pushes.length === 2);
advance(10); // 21
await W.runWorkClockNudges(env);
check('C20 nothing fires between rungs', pushes.length === 2);
advance(10); // 31
await W.runWorkClockNudges(env);
check('C21 the thirty minute rung is the last one', pushes.length === 3);
advance(120);
await W.runWorkClockNudges(env);
check('C22 and it does not nag forever after that', pushes.length === 3);

// Coming back re-arms it.
await W.handleWorkPresence(req({ caseId: 'a' }), env);
check('C23 returning to the app clears the ladder', Number(work('a').nudged) === 0);
advance(6);
await W.runWorkClockNudges(env);
check('C24 so a later absence asks again from the first rung', pushes.length === 4);

// Per client, not per app: two running clocks are two separate prompts.
reset();
await W.handleWork(req({ caseId: 'a', on: true, auto: false }), env);
await W.handleWork(req({ caseId: 'b', on: true, auto: false }), env);
await W.handleWorkPresence(req({ caseId: '' }), env);
advance(6);
await W.runWorkClockNudges(env);
check('C25 the prompt is per client', pushes.length === 2
  && pushes.some((p) => p.body.startsWith('Jordan:'))
  && pushes.some((p) => p.body.startsWith('Sam:')), JSON.stringify(pushes.map((p) => p.body)));

// ---- the honest stop ----------------------------------------------------
// Deliberately NOT beaconing straight after the start. The first version of
// this test did, which hid a real bug: the backdate read a per-case stamp that
// only the START ever wrote, so a long stretch would have banked to its own
// beginning and thrown away every hour of it. Two hours of work with the app
// open, then 45 minutes away, must bank the two hours.
reset();
await W.handleWork(req({ caseId: 'a', on: true, auto: false }), env);
for (let i = 0; i < 8; i += 1) { advance(15); await W.handleWorkPresence(req({ caseId: 'a' }), env); }
advance(45); // he left after the last beacon and answered the 30 minute prompt
const stopped = await W.handleWork(req({ caseId: 'a', on: false, backdate: true }), env);
check('C26 "no, I finished a while ago" banks to the last beacon, not to now',
  work('a').seconds === 3600 + 2 * 3600, `${work('a').seconds} vs banked-to-now ${3600 + 2 * 3600 + 45 * 60}`);
check('C27 and says so, so the shorter total is not read as lost time',
  !!stopped.body.bankedTo);

reset();
await W.handleWork(req({ caseId: 'a', on: true, auto: false }), env);
advance(45);
await W.handleWork(req({ caseId: 'a', on: false }), env);
check('C28 an ordinary stop still banks everything up to now',
  work('a').seconds === 3600 + 45 * 60, String(work('a').seconds));

// The forgotten-toggle cap survives the rewrite.
reset();
await W.handleWork(req({ caseId: 'a', on: true, auto: false }), env);
advance(60 * 40);
await W.handleWork(req({ caseId: 'a', on: false }), env);
check('C29 a clock left running for days still banks at most twelve hours',
  work('a').seconds === 3600 + 12 * 3600, String(work('a').seconds));

// ---- state hygiene ------------------------------------------------------
reset();
await W.handleWork(req({ caseId: 'a', on: true, auto: false }), env);
await W.handleWork(req({ caseId: 'a', on: false }), env);
check('C30 stopping clears auto and the ladder',
  work('a').auto === false && Number(work('a').nudged) === 0 && running().length === 0);

// A stale running list must not produce a phantom prompt.
reset();
docs.set(W.CLOCK_DOC, { running: ['a', 'b'], seenAt: new Date(NOW - 60 * 60_000).toISOString(), atCaseId: '' });
await W.runWorkClockNudges(env);
check('C31 a case with no live clock is dropped rather than pushed about',
  pushes.length === 0 && running().length === 0, JSON.stringify({ pushes: pushes.length, running: running() }));

// The beacon is cheap when there is nothing to do.
reset();
const before = docs.size;
await W.handleWorkPresence(req({ caseId: 'a' }), env);
check('C32 a beacon with nothing running only writes the beacon',
  docs.size === before + 1 && !!docs.get(W.CLOCK_DOC)?.seenAt);

// A bad case id is refused rather than creating a document.
reset();
const bad = await W.handleWork(req({ caseId: '../../users/eric', on: true }), env);
check('C33 the case id is still validated', bad.status === 400, JSON.stringify(bad));

Date.now = realNow;
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) { for (const f of failed) console.log(`  FAILED: ${f.name}`); process.exit(1); }
