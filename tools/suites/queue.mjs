// queue.mjs — runQueuedAnalyses, driven for real.
//
// WHY THIS SUITE EXISTS. Every long advisor turn writes a row into
// advisorQueue and the per-minute cron drains it. The drain dispatches on the
// row's OWN flag - appeal, callNotes, draft - and anything it does not
// recognise falls through to a generic "claim the analysis" path at the
// bottom. That fall-through is not inert. It BUYS A FULL MAX-EFFORT ANALYSIS
// off the unrecognised row, once a minute, and after three tries writes a
// failure onto the assessment - a different document, about a different job,
// that Eric reads and believes.
//
// The call document shipped without its branch, so every stranded call doc
// did exactly that. Nothing in tools/suites touched this function at all,
// which is why it shipped: the calldoc suite drives runCallDoc and stops at
// the queue WRITE, and nobody had ever run the READ.
//
// This drives the real function with a fake clock and a fake store, and
// asserts on WHICH runner was called - the one thing that separates "retried
// the call document" from "silently bought an analysis".
import { readFileSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f(import.meta.url)), '..', '..');
const SRC = readFileSync(j(ROOT, 'worker/advisor.js'), 'utf8');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

// ---- lift (same brace-counted walk the calldoc suite uses) ----------------
function fn(name) {
  const start = SRC.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`could not lift ${name}`);
  return liftAt(start, name);
}
// Any declaration shape: exported or not, async or not (sweepOne and
// pollFlight are module-private, the clock helpers are sync).
function liftAny(name) {
  for (const pre of ['export async function', 'export function', 'async function', 'function']) {
    const start = SRC.indexOf(`${pre} ${name}(`);
    if (start >= 0) return liftAt(start, name);
  }
  throw new Error(`could not lift ${name}`);
}
function liftAt(start, name) {
  let par = 0, bodyAt = -1;
  for (let k = SRC.indexOf('(', start); k < SRC.length; k++) {
    if (SRC[k] === '(') par++;
    else if (SRC[k] === ')') { par--; if (!par) { bodyAt = SRC.indexOf('{', k); break; } }
  }
  if (bodyAt < 0) throw new Error(`could not find the body of ${name}`);
  let depth = 0, end = -1, inTpl = false;
  for (let i = bodyAt; i < SRC.length; i++) {
    const ch = SRC[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '`') { inTpl = !inTpl; continue; }
    if (inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  if (end < 0) throw new Error(`could not find the end of ${name}`);
  return SRC.slice(start, end).replace(/^export /, '');
}
const LIFTED = fn('runQueuedAnalyses');

// ---- the world -----------------------------------------------------------
let rows, state, calls, deleted, patched;
const reset = (initialRows, initialState) => {
  rows = initialRows;
  state = { ...initialState };
  calls = [];
  deleted = [];
  patched = [];
};

const HOUR = 3600_000;
const deps = () => ({
  listDocs: async (env, path) => (/advisorQueue/.test(path) ? rows : []),
  getDoc: async (env, path) => (/advisorState|state$/.test(path)
    ? { data: state }
    : { data: { clientName: 'Jordan Avery', status: 'open' } }),
  patchDoc: async (env, path, data) => { patched.push([path, data]); return true; },
  deleteDoc: async (env, path) => { deleted.push(path); return true; },
  setState: async (env, kind, id, fields) => { Object.assign(state, fields); },
  statePath: (k, i) => `advisorState/${k}_${i}`,
  // The four runners. Each records that it was CALLED, which is the whole
  // assertion: a call doc row must wake runCallDoc and nothing else.
  runAnalysis: async (...a) => { calls.push(['runAnalysis', a.slice(1, 3).join('/')]); },
  runAppeal: async () => { calls.push(['runAppeal']); },
  runCallNotes: async () => { calls.push(['runCallNotes']); },
  runCallDoc: async (env, kind, id, opts) => { calls.push(['runCallDoc', `${kind}/${id}`, opts]); },
  runDraft: async () => { calls.push(['runDraft']); },
  // Since 2026-09-03 every run the drain starts enters under the case's
  // turn policy (his own case pins the stronger model). Passed through here:
  // what this suite proves is which runner wakes, not what model it uses.
  withCasePolicy: async (env, kind, id, fn) => fn(),
  friendly: (e) => (e && e.message) || String(e),
  console: { error: () => {}, warn: () => {}, log: () => {} },
  // THESE FOUR EXIST SO THE FALL-THROUGH IS REACHABLE, and that matters more
  // than it looks. Without them the generic analysis claim at the bottom of
  // the drain throws on a missing binding, the throw is swallowed, and
  // "runAnalysis was never called" comes back TRUE for a reason that has
  // nothing to do with the code being right. Q2 was passing that way when
  // this suite was first written - the exact silent-pass this whole test
  // directory exists to defeat. With them injected, deleting the callDoc
  // branch makes Q2 go red, which is the only thing that makes it a check.
  ANALYSIS_MAX_TRIES: 3,
  diagLog: async () => {},
  client: () => ({ messages: { batches: { cancel: async () => {} } } }),
  pollFlight: async () => {},
  // The handover (2026-09-05): a recorder, like the runners above.
  runHandover: async (env, id, from) => { calls.push(['runHandover', `${id}<${from}`]); },
});
const build = (over = {}) => {
  const dd = { ...deps(), ...over };
  // The third answer (2026-09-09), on whatever getDoc this build was handed.
  dd.READ_FAILED = Symbol('read failed');
  dd.tryGet = async (env, p) => { try { return await dd.getDoc(env, p); } catch { return dd.READ_FAILED; } };
  return new Function(...Object.keys(dd), `${LIFTED}\n return runQueuedAnalyses;`)(...Object.values(dd));
};
const env = {};

// A call doc that started an hour ago and has not beaten since: stranded by
// a closed lid, which is exactly the case the queue row exists for.
const strandedState = {
  callDocStatus: 'running',
  callDocStartedAt: new Date(Date.now() - HOUR),
  callDocProgressAt: new Date(Date.now() - HOUR),
  callDocReq: {
    instruction: 'Lead with the insurance question.',
    revise: false,
    base: '',
    // He ticked "look things up on the internet" on the build that died.
    search: true,
    sources: [
      { name: 'prep.pdf', mine: true, path: 'cases/a/prep.pdf' },
      { name: 'photo.jpg', inline: true },
    ],
  },
  analysis: 'Working assessment: seronegative picture, records incomplete.',
  status: 'ready',
};
const calldocRow = { id: 'calldoc_case_a', data: { kind: 'case', id: 'a', callDoc: true, at: new Date(Date.now() - HOUR) } };

// ---- 1. a stranded call doc is RETRIED, and buys no analysis --------------
reset([calldocRow], strandedState);
await build()(env, 0);
check('Q1 a stranded call document wakes runCallDoc',
  calls.some((c) => c[0] === 'runCallDoc'), JSON.stringify(calls.map((c) => c[0])));
check('Q2 and NEVER buys an analysis off the same row',
  !calls.some((c) => c[0] === 'runAnalysis'), JSON.stringify(calls.map((c) => c[0])));
check('Q3 the assessment is left exactly as it was',
  state.analysis === 'Working assessment: seronegative picture, records incomplete.'
  && state.status === 'ready', `${state.status} / ${String(state.analysis).slice(0, 40)}`);
check('Q4 the retry carries his instruction through',
  calls.find((c) => c[0] === 'runCallDoc')?.[2]?.instruction === 'Lead with the insurance question.');
check('Q5 and runs without the stream, because no one is holding the connection',
  calls.find((c) => c[0] === 'runCallDoc')?.[2]?.noStream === true);
check('Q6 it retries only the Storage-backed sources, since the bytes are gone',
  JSON.stringify(calls.find((c) => c[0] === 'runCallDoc')?.[2]?.sources?.map((s) => s.name)) === '["prep.pdf"]',
  JSON.stringify(calls.find((c) => c[0] === 'runCallDoc')?.[2]?.sources));
// His tick has to survive the retry in BOTH directions. Dropped, and the
// rebuild quietly loses the internet section he asked for and cannot see why.
// Assumed, and a rebuild he never watched spends money he never agreed to.
check('Q6b the retry carries his internet tick through, rather than guessing',
  calls.find((c) => c[0] === 'runCallDoc')?.[2]?.search === true,
  JSON.stringify(calls.find((c) => c[0] === 'runCallDoc')?.[2]?.search));
check('Q7 and the row records the attempt, so it cannot retry forever',
  patched.some(([p, dta]) => /calldoc_case_a/.test(p) && dta.tries === 1),
  JSON.stringify(patched));

// ---- 2. a LIVE call doc is left alone ------------------------------------
// A run that started two minutes ago and beat ten seconds ago. Note both
// fields have to be recent: an earlier version of this check set the heartbeat
// to now while leaving the start an hour back, which cannot happen - the run
// budget kills a turn at fifteen minutes - and it failed for that reason
// rather than for anything wrong in the drain.
reset([calldocRow], {
  ...strandedState,
  callDocStartedAt: new Date(Date.now() - 2 * 60_000),
  callDocProgressAt: new Date(Date.now() - 10_000),
});
await build()(env, 0);
check('Q8 a call document that beat a moment ago is not touched',
  calls.length === 0 && deleted.length === 0, JSON.stringify(calls.map((c) => c[0])));

// And one that beat recently but has been going far past the run budget IS
// dead, whatever its last heartbeat says.
reset([calldocRow], {
  ...strandedState,
  callDocStartedAt: new Date(Date.now() - 40 * 60_000),
  callDocProgressAt: new Date(Date.now() - 10_000),
});
await build()(env, 0);
check('Q8b but one running 40 minutes is dead however recently it beat',
  calls.some((c) => c[0] === 'runCallDoc'), JSON.stringify(calls.map((c) => c[0])));

// ---- 3. a FINISHED call doc drops its row --------------------------------
reset([calldocRow], { ...strandedState, callDocStatus: 'ready' });
await build()(env, 0);
check('Q9 a finished call document has its queue row removed',
  deleted.includes('advisorQueue/calldoc_case_a'), JSON.stringify(deleted));
check('Q10 and buys nothing at all', calls.length === 0, JSON.stringify(calls.map((c) => c[0])));

// ---- 4. giving up says so on the CALL DOC, not the assessment ------------
reset([{ ...calldocRow, data: { ...calldocRow.data, tries: 2 } }], strandedState);
await build()(env, 0);
check('Q11 a third failure gives up on the call document',
  state.callDocStatus === 'error', state.callDocStatus);
check('Q12 and says so where he will look for it',
  /call document kept getting interrupted/i.test(state.callDocError || ''), state.callDocError);
check('Q13 the assessment is STILL untouched by a call-document failure',
  state.analysis === 'Working assessment: seronegative picture, records incomplete.'
  && state.status === 'ready', `${state.status}`);
check('Q14 and the row is gone rather than retrying every minute forever',
  deleted.includes('advisorQueue/calldoc_case_a'), JSON.stringify(deleted));

// ---- 5. the sibling runners still work ----------------------------------
reset([{ id: 'callnotes_case_a', data: { kind: 'case', id: 'a', callNotes: true } }], {
  callNotesStatus: 'running',
  callNotesStartedAt: new Date(Date.now() - HOUR),
  callNotesProgressAt: new Date(Date.now() - HOUR),
  callNotesReq: { instruction: 'x', revise: false, base: '' },
});
await build()(env, 0);
check('Q15 call notes still routes to its own runner, unchanged',
  calls.some((c) => c[0] === 'runCallNotes') && !calls.some((c) => c[0] === 'runAnalysis'),
  JSON.stringify(calls.map((c) => c[0])));

// ---- Q18-Q19: a flight is not a wall (Eric, 2026-09-03, after a provider
// outage: "The advisor is stuck on thinking for over two hours") -----------
// Grep pins over the real source: the two clauses are small and their
// absence is exactly the two-hour wedge he saw.
// NEGATIVE CONTROL (run 2026-09-03): `if (auto) return;` changed back to an
// unconditional `return` made this read
//   FAIL  Q18 a manual Update takes over an in-flight batch instead of being answered with silence
// Re-pinned 2026-09-04: the takeover is still here and still his, but it now
// sits behind the age gate Q24 pins, because a tap on a young flight was
// destroying work that only needed collecting. The ordering is what this
// check holds: auto defers, then the gate, then the cancel.
check('Q18 a manual Update takes over an in-flight batch instead of being answered with silence',
  /< 3 \* 3_600_000\) \{\n\s*if \(auto\) return;[\s\S]{0,2500}batches\.cancel\(flight\.batchId\)[\s\S]{0,200}setState\(env, kind, id, \{ batchCtx: null \}\)/.test(SRC));
// NEGATIVE CONTROL (run 2026-09-03): `pollFails >= 30` changed to `>= 3000` made this read
//   FAIL  Q19 a flight the provider cannot be reached for, thirty polls running, is abandoned into the retry path
check('Q19 a flight the provider cannot be reached for, thirty polls running, is abandoned into the retry path',
  /const pollFails = unreachable \? \(Number\(flight\.pollFails\) \|\| 0\) \+ 1 : 0;/.test(SRC)
  && /if \(unreachable && pollFails >= 30\) \{/.test(SRC)
  && /batchCtx: \{ \.\.\.flight, pollFails \},/.test(SRC));


// ---- bringing a read home without the cron (Eric, 2026-09-04) -------------
// "It still keeps stalling even with app open." The flight recorder showed an
// hour with no `end` at all: takeover, start, submit, takeover, start,
// submit. runQueuedAnalyses was the only thing that ever polled a flight and
// scheduled() was the only thing that called it, so with the trigger
// unreliable a finished read was never collected.
const POLL_ONE = fn('pollCaseFlight');
const POLL_ALL = fn('pollFlightsNow');
const mkPoll = (docs, { queueRows = [] } = {}) => {
  const polled = [];
  const listed = [];
  // eslint-disable-next-line no-new-func
  return {
    polled,
    listed,
    api: new Function('deps', `
      const { getDoc, statePath, pollFlight, listDocs } = deps;
      ${POLL_ONE.replace('export async function', 'async function')}
      ${POLL_ALL.replace('export async function', 'async function')}
      return { pollCaseFlight, pollFlightsNow };
    `)({
      getDoc: async (env, path) => (docs[path] ? { id: path, data: docs[path] } : null),
      statePath: (kind, id) => `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/advisor/state`,
      pollFlight: async (env, kind, id, rowId, flight) => { polled.push({ kind, id, rowId, batchId: flight.batchId }); },
      listDocs: async (env, coll, opts) => { listed.push([coll, opts?.pageSize]); return queueRows; },
    }),
  };
};
const flightState = (extra = {}) => ({ batchCtx: { batchId: 'batch_1', submittedAt: new Date(Date.now() - 200_000) }, ...extra });

{
  const H1 = mkPoll({ 'cases/mine/advisor/state': flightState({ progressAt: new Date(Date.now() - 200_000) }) });
  const did = await H1.api.pollCaseFlight({}, 'case', 'mine');
  // NEGATIVE CONTROL (run 2026-09-04): pollCaseFlight returning before it
  // called pollFlight made this read
  //   FAIL  Q20 a flight nobody has looked at lately is polled, under the queue row id the drain uses
  check('Q20 a flight nobody has looked at lately is polled, under the queue row id the drain uses',
    did === true && H1.polled.length === 1 && H1.polled[0].rowId === 'case_mine'
    && H1.polled[0].batchId === 'batch_1',
    JSON.stringify(H1.polled));

  const H2 = mkPoll({ 'cases/mine/advisor/state': flightState({ progressAt: new Date() }) });
  const fresh = await H2.api.pollCaseFlight({}, 'case', 'mine');
  const H3 = mkPoll({ 'cases/mine/advisor/state': { status: 'idle' } });
  const none = await H3.api.pollCaseFlight({}, 'case', 'mine');
  // NEGATIVE CONTROL (run 2026-09-04): the minAgeMs throttle removed made this read
  //   FAIL  Q21 a flight somebody looked at seconds ago is left alone, and a case with no flight costs one read
  check('Q21 a flight somebody looked at seconds ago is left alone, and a case with no flight costs one read',
    fresh === false && H2.polled.length === 0 && none === false && H3.polled.length === 0);

  const H4 = mkPoll({
    'cases/a/advisor/state': flightState({ progressAt: new Date(Date.now() - 200_000) }),
    'cases/b/advisor/state': { status: 'idle' },
  }, { queueRows: [{ id: 'case_a', data: { kind: 'case', id: 'a' } }, { id: 'case_b', data: { kind: 'case', id: 'b' } }, { id: 'junk', data: {} }] });
  await H4.api.pollFlightsNow({});
  // NEGATIVE CONTROL (run 2026-09-04): pollFlightsNow walking nothing (the
  // loop body removed) made this read
  //   FAIL  Q22 ordinary traffic walks the queue and polls every flight on it, ignoring a malformed row
  check('Q22 ordinary traffic walks the queue and polls every flight on it, ignoring a malformed row',
    H4.listed.length === 1 && H4.listed[0][0] === 'advisorQueue'
    && H4.polled.length === 1 && H4.polled[0].id === 'a',
    JSON.stringify({ listed: H4.listed, polled: H4.polled }));
}

const W = readFileSync(j(ROOT, 'worker/index.js'), 'utf8');
// NEGATIVE CONTROL (run 2026-09-04): the pollCaseFlight call removed from the
// state route made this read
//   FAIL  Q23 the panel's own poll collects the read, and any API request collects every other one
// Re-pinned 2026-09-07 (v3.5): the state route's first qa page is `qaFirst`
// now, re-read after a question in flight was polled (askflight.mjs AF3).
check('Q23 the panel\'s own poll collects the read, and any API request collects every other one',
  /await pollCaseFlight\(env, kind, id\)\.catch\(\(\) => \{\}\);/.test(W)
  // Awaited before the panel's reads, or the answer it just collected would
  // not be in the payload it is answering with.
  && W.indexOf('await pollCaseFlight(env, kind, id)') < W.indexOf('const [state, qaFirst, knowledge, notesDoc, style] = await Promise.all(')
  && /ctx\.waitUntil\(pollFlightsNow\(env\)\.catch\(\(\) => \{\}\)\);/.test(W)
  && /pollCaseFlight, pollFlightsNow,/.test(W));

// NEGATIVE CONTROL (run 2026-09-04): TAKEOVER_AFTER_MS raised so every flight
// counts as young made this read
//   FAIL  Q24 his tap polls a young flight instead of throwing it away, and still takes over an old one
check('Q24 his tap polls a young flight instead of throwing it away, and still takes over an old one',
  /const TAKEOVER_AFTER_MS = 15 \* 60_000;/.test(SRC)
  && /if \(flightAge < TAKEOVER_AFTER_MS\) \{\n\s+await pollFlight\(env, kind, id, `\$\{kind\}_\$\{id\}`, flight\)\.catch\(\(\) => \{\}\);\n\s+return;\n\s+\}/.test(SRC)
  // The takeover still exists, after that gate, for a flight that is old.
  && SRC.indexOf('if (flightAge < TAKEOVER_AFTER_MS)') < SRC.indexOf("diagLog(env, { ev: 'flight-takeover'"));

// NEGATIVE CONTROL (run 2026-09-04): the claim written unconditionally (no
// ifUpdateTime) made this read
//   FAIL  Q25 only one run of the two that pass the guards together buys the turn
check('Q25 only one run of the two that pass the guards together buys the turn',
  /const claimed = await patchDoc\(env, statePath\(kind, id\),\n\s+\{ status: 'running', error: null, startedAt: new Date\(\), stage: 'starting' \},\n\s+cur\n\s+\? \{ mask: \[[^\]]*\], ifUpdateTime: cur\.updateTime \}\n\s+: \{ mask: \[[^\]]*\], mustNotExist: true \},\n\s+\)\.catch\(\(\) => false\);/.test(SRC)
  && /if \(claimed === false\) \{\n\s+await diagLog\(env, \{ ev: 'claim-lost', kind, auto \}\);\n\s+return;\n\s+\}/.test(SRC)
  // The claim comes before the run announces itself, so the recorder shows
  // one start per turn bought.
  && SRC.indexOf('const claimed = await patchDoc(env, statePath(kind, id),') < SRC.indexOf("ev: 'start', kind, auto, skipMedia"));

// ---- nothing reads but his tap (Eric, 2026-09-13) ------------------------
// "Stop automatic updates. I'll manually press update so it doesn't burn
// through tokens." The clock that lived here from 2026-09-05 (thirty minutes,
// an hour more each empty look, back to thirty on a new note, the panel
// firing the look itself) is gone whole. Q26 to Q35 keep their names and
// were re-pointed at the new world on 2026-09-13, each with its own control:
// what they hold now is that nothing books a read, nothing waits on a
// clock, and the one thing that starts a read is his tap.
const MIN = 60_000;
const P = readFileSync(j(ROOT, 'public/js/advisor.js'), 'utf8');
const DEMO = readFileSync(j(ROOT, 'public/js/demo/api.js'), 'utf8');

// Re-pinned 2026-09-13: the drain used to leave a row standing until its
// clock came (autoWaitMs); there is no clock to wait on.
// NEGATIVE CONTROL (run 2026-09-13): a wait on a stale nextAutoAt put back before the claim made this read
//   FAIL  Q26 the drain carries no clock: no wait, no field read
check('Q26 the drain carries no clock: no wait, no field read',
  !/autoWaitMs|nextAutoAt|autoGapMin/.test(LIFTED));

{
  // The drain, run: a row on a state that still carries a stale clock in the
  // future (an old document) runs at this firing all the same.
  const stale = { status: 'idle', analysis: 'prior', updatedAt: new Date(Date.now() - 10 * MIN), nextAutoAt: new Date(Date.now() + 20 * MIN) };
  const row = () => [{ id: 'case_a', data: { kind: 'case', id: 'a', at: new Date(Date.now() - MIN), tries: 0 } }];
  reset(row(), stale);
  await build()(env, 0);
  // NEGATIVE CONTROL (run 2026-09-13): the same wait as Q26's control made this read
  //   FAIL  Q27 a queued row runs at the next firing whatever stale clock its state still carries
  check('Q27 a queued row runs at the next firing whatever stale clock its state still carries',
    calls.filter((c) => c[0] === 'runAnalysis').length === 1, JSON.stringify(calls));
}

// NEGATIVE CONTROL (run 2026-09-13): a `nextAutoAt: null` put back on the landed read's state write made this read
//   FAIL  Q28 the clock is gone from the module, the Worker, the panel and the demo: no constants, no helpers, no field booked, no line about the next look
check('Q28 the clock is gone from the module, the Worker, the panel and the demo: no constants, no helpers, no field booked, no line about the next look',
  !/AUTO_GAP_MIN|AUTO_GAP_STEP_MIN|AUTO_GAP_CAP_MIN|nextAutoGap|autoWaitMs|nextAutoAt|autoGapMin/.test(SRC)
  && !/nextAutoAt|autoGapMin|nextAutoInS/.test(W)
  && !/nextAutoAt|autoGapMin|next automatic read|clockDue|firedFor/.test(P)
  && !/nextAutoAt|autoGapMin/.test(DEMO)
  && /NOTHING READS BUT HIS TAP \(Eric, 2026-09-13/.test(SRC));

{
  // markPending, lifted and run: owed work, due now. One state write, one
  // queue row, and no read of the state at all (the read that served the
  // clock went with the clock).
  const MP = liftAny('markPending');
  const run = async (existingRow) => {
    const sets = [];
    const queued = [];
    let reads = 0;
    const api = new Function('deps', `
      const { getDoc, setState, patchDoc, statePath, queuePath, PENDING_FLOOR_MS } = deps;
      const READ_FAILED = Symbol('read failed'); const tryGet = async (env, p) => { try { return await getDoc(env, p); } catch { return READ_FAILED; } };
      ${MP}
      return markPending;
    `)({
      getDoc: async (env, path) => { if (/advisor\/state$/.test(path)) reads += 1; return /advisorQueue/.test(path) ? existingRow : null; },
      setState: async (env, kind, id, fields) => { sets.push(fields); },
      patchDoc: async (env, path, data) => { queued.push([path, data]); return true; },
      statePath: (kind, id) => `cases/${id}/advisor/state`,
      queuePath: (kind, id) => `advisorQueue/${kind}_${id}`,
      PENDING_FLOOR_MS: 5 * MIN,
    });
    await api({}, 'case', 'a');
    return { sets, queued, reads };
  };
  const tap = await run(null);
  const again = await run({ data: { kind: 'case', id: 'a', tries: 2 } });
  const s = tap.sets[0] || {};
  // NEGATIVE CONTROL (run 2026-09-13): `nextAutoAt: now` put back beside pendingAt in the one state write made this read
  //   FAIL  Q29 a tap is owed work, due now: pendingAt stamped, nothing else booked, the row queued once and never rewritten
  check('Q29 a tap is owed work, due now: pendingAt stamped, nothing else booked, the row queued once and never rewritten',
    tap.sets.length === 1 && !!s.pendingAt && Object.keys(s).join() === 'pendingAt'
    && tap.queued.length === 1 && tap.queued[0][0] === 'advisorQueue/case_a' && tap.queued[0][1].tries === 0
    && again.sets.length === 1 && again.queued.length === 0,
    JSON.stringify({ tap, again }));
  // NEGATIVE CONTROL (run 2026-09-13): a read of the state put back at the top of markPending made this read
  //   FAIL  Q30 and it reads nothing: the state read that served the clock went with the clock
  check('Q30 and it reads nothing: the state read that served the clock went with the clock',
    tap.reads === 0 && again.reads === 0 && /export async function markPending\(env, kind, id\) \{/.test(SRC),
    JSON.stringify({ reads: tap.reads }));
}

// Re-pinned 2026-09-13: the nothing-new exit used to move the clock an hour
// further out; it books nothing now, and only a drain-run rescue reaches it,
// since nothing schedules a look.
// NEGATIVE CONTROL (run 2026-09-13): `gapMin: 0,` put back on the exit's recorder entry made this read
//   FAIL  Q31 a drain-run pass that finds nothing new costs no turn and books nothing
check('Q31 a drain-run pass that finds nothing new costs no turn and books nothing',
  /await setState\(env, kind, id, \{\n\s+status: 'idle', startedAt: null, progressAt: null, stage: null, pendingAt: null,\n\s+\}\);\n\s+await deleteDoc\(env, queuePath\(kind, id\)\)\.catch\(\(\) => \{\}\);\n\s+await diagLog\(env, \{ ev: 'end', ok: true, kind, skipped: 'nothing-new', ms: Date\.now\(\) - runT0 \}\);\n\s+return;/.test(SRC));

// Re-pinned 2026-09-13: a landed read used to book thirty minutes; it books
// nothing, and its own leftovers and a catch-up backlog are queued as owed
// work, due now.
// NEGATIVE CONTROL (run 2026-09-13): the leftovers' markPending given back a `{ due: continues }` made this read
//   FAIL  Q32 a read that landed books nothing, and its own leftovers run at the next firing
check('Q32 a read that landed books nothing, and its own leftovers run at the next firing',
  /const continues = !!\(\(m\.carry \|\| \[\]\)\.length \|\| \(ctx\.catchup && ctx\.newerLeft > 0\)\);/.test(SRC)
  && /if \(continues \|\| behind\)\n\s+await markPending\(env, kind, id\)\.catch\(\(\) => \{\}\);/.test(SRC)
  && !/markPending\(env, [^)]*\{ (?:force|due)/.test(SRC));

{
  // pollFlight, lifted and run against a landed batch: the finish is
  // claimed once. The fake state document has a server-side updateTime that
  // can move between the read and the conditional write, which is the race.
  const PF = liftAny('pollFlight');
  const run = async ({ serverTime = 'T1', readTime = 'T1', finishingAt = null } = {}) => {
    const finished = [];
    const patches = [];
    const flight = { batchId: 'b1', customId: 'c1', submittedAt: new Date(Date.now() - 200_000), finishingAt };
    const api = new Function('deps', `
      const { pollTurnBatch, client, setState, getDoc, patchDoc, statePath, finishAnalysis, diagLog, deleteDoc, markPending, modelRefused, friendly } = deps;
      ${PF}
      return pollFlight;
    `)({
      pollTurnBatch: async () => ({ state: 'done', message: { content: [] } }),
      client: () => ({ messages: { batches: { cancel: async () => {} } } }),
      setState: async () => {},
      getDoc: async () => ({ data: { batchCtx: flight }, updateTime: readTime }),
      patchDoc: async (env, path, data, opts) => {
        patches.push([data, opts]);
        if (opts?.ifUpdateTime && opts.ifUpdateTime !== serverTime) throw new Error('precondition failed');
        return true;
      },
      statePath: (kind, id) => `cases/${id}/advisor/state`,
      finishAnalysis: async (env, kind, id, ctx) => { finished.push(ctx.batchId); },
      diagLog: async () => {},
      deleteDoc: async () => {},
      markPending: async () => {},
      modelRefused: () => false,
      friendly: (e) => String(e?.message || e),
    });
    await api({}, 'case', 'a', 'case_a', flight);
    return { finished, patches };
  };
  const won = await run();
  const lost = await run({ serverTime: 'T2' });
  const held = await run({ finishingAt: new Date(Date.now() - MIN) });
  const stale = await run({ finishingAt: new Date(Date.now() - 10 * MIN) });
  // NEGATIVE CONTROL (run 2026-09-05): `ifUpdateTime: cur.updateTime` dropped from the finish claim made this read
  //   FAIL  Q33 a landed batch is finished once: the claim on the state document decides, a fresh stamp defers, a stale one is taken over
  check('Q33 a landed batch is finished once: the claim on the state document decides, a fresh stamp defers, a stale one is taken over',
    won.finished.length === 1 && won.patches[0]?.[1]?.mask?.join() === 'batchCtx' && won.patches[0]?.[1]?.ifUpdateTime === 'T1'
    && !!won.patches[0]?.[0]?.batchCtx?.finishingAt
    && lost.finished.length === 0
    && held.finished.length === 0 && held.patches.length === 0
    && stale.finished.length === 1,
    JSON.stringify({ won: won.finished, lost: lost.finished, held: held.finished, stale: stale.finished }));
}

{
  // sweepOne, lifted and run: it rescues work he asked for and books nothing
  // of its own. A case with nothing owed is left alone whatever stale clock
  // its document still carries; a tap owed past the settle window is booked
  // as owed; the old paused flag no longer stops a rescue.
  const SW = liftAny('sweepOne');
  const run = async (stateData) => {
    const queued = [];
    const logged = [];
    const api = new Function('deps', `
      const { getDoc, statePath, queuePath, setState, patchDoc, diagLog, PENDING_FLOOR_MS, console } = deps;
      const READ_FAILED = Symbol('read failed'); const tryGet = async (env, p) => { try { return await getDoc(env, p); } catch { return READ_FAILED; } };
      ${SW}
      return sweepOne;
    `)({
      getDoc: async (env, path) => (/advisor\/state$/.test(path) ? { data: stateData } : null),
      statePath: (kind, id) => `cases/${id}/advisor/state`,
      queuePath: (kind, id) => `advisorQueue/${kind}_${id}`,
      setState: async () => {},
      patchDoc: async (env, path, data) => { queued.push([path, data]); return true; },
      diagLog: async (env, e) => { logged.push(e); },
      PENDING_FLOOR_MS: 5 * MIN,
      console: { warn: () => {} },
    });
    await api({}, { kind: 'case', id: 'a' });
    return { queued, logged };
  };
  const base = { status: 'idle', analysis: 'prior', updatedAt: new Date(Date.now() - 2 * 3600_000) };
  const quiet = await run({ ...base, autoGapMin: 90, nextAutoAt: new Date(Date.now() - MIN) });
  const owed = await run({ ...base, pendingAt: new Date(Date.now() - 6 * MIN) });
  const pausedOwed = await run({ ...base, pendingAt: new Date(Date.now() - 6 * MIN), paused: true });
  // NEGATIVE CONTROL (run 2026-09-13): the sweep's early return given back a stale-clock clause made this read
  //   FAIL  Q34 the sweep books a tap that is owed, never a look of its own, and a stale clock or an old paused flag on the document changes nothing
  check('Q34 the sweep books a tap that is owed, never a look of its own, and a stale clock or an old paused flag on the document changes nothing',
    quiet.queued.length === 0 && quiet.logged.length === 0
    && owed.queued.length === 1 && owed.queued[0][0] === 'advisorQueue/case_a' && owed.queued[0][1].tries === 0
    && owed.logged.some((e) => e.ev === 'requeue' && e.why === 'owed')
    && pausedOwed.queued.length === 1
    && !/'clock'/.test(SW) && !/paused/.test(SW),
    JSON.stringify({ quiet: quiet.queued, owed: owed.queued, pausedOwed: pausedOwed.queued }));
}

// Re-pinned 2026-09-13: the panel used to fire a read itself when the clock
// came or a flag stood, and carried a Pause for that automation. Neither
// exists: the Update button is the one way a read starts, and the route
// behind it runs a tap as a tap.
// NEGATIVE CONTROL (run 2026-09-13): `post({ action: 'analyze', auto: true })` put back after the Update tap's poll made this read
//   FAIL  Q35 the panel volunteers nothing and has nothing to pause; the Update button and the route behind it are the one way a read starts
// 2026-09-22 (v4.7): the trade desk's panel carries a Pause for the desk's
// three readings a day, under its own name (data-desk-pause, deskPauseBtn);
// this pin still holds that the medical panel volunteers nothing and has
// nothing of its own to pause.
check('Q35 the panel volunteers nothing and has nothing to pause; the Update button and the route behind it are the one way a read starts',
  !/auto: true/.test(P) && !/data-pause|pauseBtn|analysis paused/.test(P)
  && /data-refresh/.test(P) && /post\(\{ action: 'analyze'/.test(P)
  && /Nothing fires from here \(2026-09-13\)/.test(P)
  && /await markPending\(env, kind, id\);\n(?:.*\n){0,12}?\s+return keepaliveRun\(ctx, runAnalysis\(env, kind, id, media, \{ auto: false, freshFiles: true \}\), \{ raw: true \}\);/.test(W)
  && !/body\?\.auto === true/.test(W.slice(W.indexOf('async function handleAdvisorAction')))
  && !/action === 'pause'/.test(W) && !/refreshAdvisor/.test(W)
  && /No read is booked here any more \(2026-09-13\)/.test(W));

// ---- the handover row (Eric, 2026-09-05: his own cases in sequence) ------
{
  const row = (tries = 0) => [{ id: 'handover_case_n', data: { kind: 'case', id: 'n', handover: true, from: ['a', 'b'], at: new Date(), tries } }];
  reset(row(), { handovers: [{ fromCase: 'a' }], handoverStatus: 'running' });
  await build()(env, 0);
  const one = { calls: [...calls], patched: [...patched], deleted: [...deleted] };
  reset(row(), { handovers: [{ fromCase: 'a' }, { fromCase: 'b' }], handoverStatus: 'running' });
  await build()(env, 0);
  const done = { calls: [...calls], deleted: [...deleted], status: state.handoverStatus };
  reset(row(3), { handovers: [], handoverStatus: 'running' });
  await build()(env, 0);
  const gaveUp = { calls: [...calls], deleted: [...deleted], status: state.handoverStatus, err: state.handoverError };
  // NEGATIVE CONTROL (run 2026-09-05): the drain's `if (row.data.handover) {` branch changed to `if (false) {` made this read
  //   FAIL  Q36 a handover row condenses the next source still owed, one per firing, buys no analysis, is gone once every source is in, and gives up honestly after three tries
  check('Q36 a handover row condenses the next source still owed, one per firing, buys no analysis, is gone once every source is in, and gives up honestly after three tries',
    one.calls.filter((c) => c[0] === 'runHandover').length === 1 && one.calls[0][1] === 'n<b'
    && !one.calls.some((c) => c[0] === 'runAnalysis')
    && one.patched.some(([p, d]) => /advisorQueue\/handover_case_n/.test(p) && d.tries === 1)
    && one.patched.some(([p, d]) => /advisorQueue\/handover_case_n/.test(p) && d.tries === 0)
    && !one.deleted.length
    && !done.calls.length && done.deleted.includes('advisorQueue/handover_case_n') && done.status === 'ready'
    && !gaveUp.calls.length && gaveUp.deleted.includes('advisorQueue/handover_case_n') && gaveUp.status === 'error' && /kept failing/.test(gaveUp.err),
    JSON.stringify({ one, done, gaveUp }).slice(0, 400));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
