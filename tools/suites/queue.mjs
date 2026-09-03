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
  return SRC.slice(start, end).replace('export async function', 'async function');
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
});
const build = (over = {}) => {
  const dd = { ...deps(), ...over };
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
check('Q18 a manual Update takes over an in-flight batch instead of being answered with silence',
  /< 3 \* 3_600_000\) \{\n\s*if \(auto\) return;[\s\S]{0,900}batches\.cancel\(flight\.batchId\)[\s\S]{0,200}setState\(env, kind, id, \{ batchCtx: null \}\)/.test(SRC));
// NEGATIVE CONTROL (run 2026-09-03): `pollFails >= 30` changed to `>= 3000` made this read
//   FAIL  Q19 a flight the provider cannot be reached for, thirty polls running, is abandoned into the retry path
check('Q19 a flight the provider cannot be reached for, thirty polls running, is abandoned into the retry path',
  /const pollFails = unreachable \? \(Number\(flight\.pollFails\) \|\| 0\) \+ 1 : 0;/.test(SRC)
  && /if \(unreachable && pollFails >= 30\) \{/.test(SRC)
  && /batchCtx: \{ \.\.\.flight, pollFails \},/.test(SRC));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
