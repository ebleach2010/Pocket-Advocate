// askflight.mjs - an answer rides the batch.
//
//   node tools/suites/askflight.mjs
//
// Eric, 2026-09-07: "now when asking the advisor something: The server
// answered with something this page could not read", three questions on
// "thinking" in the screenshot. A question's model turn ran streamed inside
// the HTTP invocation, and the CPU budget this plan cannot raise killed a
// long one near four minutes. The question is submitted to the Batches API
// now and collected by the polls, exactly like a read.
//
// What this holds: the submit and never the carried turn (AF1); the pure
// verdict on one poll, run over every branch (AF2); the three pollers, the
// one finish per flight, and the marker that deletes itself (AF3); the
// finish's learning protocol, its failure line, and the one resend a refused
// model gets (AF4); the panel's heartbeat rule and the demo's mirror (AF5);
// the version note and the config comment (AF6).
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const ADV = f('worker/advisor.js');
const W = f('worker/index.js');
const P = f('public/js/advisor.js');
const D = f('public/js/demo/api.js');
const CL = f('public/js/changelog.js');
const CFG = f('wrangler.jsonc');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  let inTpl = false;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '`') { inTpl = !inTpl; continue; }
    if (inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const DASH = /[—–]/;

// The same slab advisor-acts.mjs lifts, so the two suites agree on what
// runQuestion is.
const runQuestion = (ADV.match(/export async function runQuestion[\s\S]*?\n\}/) || [''])[0];
const finishQuestion = lift(ADV, 'async function finishQuestion(env, kind, id, qaId, flight, message) {');
const pollAsk = lift(ADV, 'export async function pollAskFlight(env, kind, id, qaId, { minAgeMs = 15_000 } = {}) {');
const verdictSrc = lift(ADV, 'export function askFlightNext(flight, poll, now = Date.now()) {');
const consts = (ADV.match(/const ASK_ABANDON_MS = [^;]+;\nconst ASK_POLL_FAILS_MAX = [^;]+;/) || [''])[0];
const askFlightNext = verdictSrc && consts
  ? new Function(`${consts}\n${verdictSrc.replace('export function', 'function')}\nreturn askFlightNext;`)()
  : null;

// ---- AF1: the submit, never the carried turn ---------------------------------
// NEGATIVE CONTROL (run 2026-09-07): runQuestion's `submitTurnBatch(env, turn, customId)` renamed to `submitTurnBatchX(...)` made this read
//   FAIL  AF1 a question is built and submitted to the batch, never carried streamed inside the invocation, ...
check('AF1 a question is built and submitted to the batch, never carried streamed inside the invocation: the turn goes through turnRequest with the action tools, submitTurnBatch takes it, the row gets the batch and the file reference, the marker goes on the queue, and the recorder sees the submit',
  runQuestion.length > 2000
  && /const turn = turnRequest\(\{\n\s+effort: QUESTION_EFFORT,\n\s+maxTokens: QUESTION_TOKENS,\n\s+tools: actionTools\(\),/.test(runQuestion)
  && !/await ask\(env,/.test(runQuestion) && !/onBeat/.test(runQuestion)
  && /const batchId = await submitTurnBatch\(env, turn, customId\);/.test(runQuestion)
  && /batch: \{ batchId, customId, submittedAt: new Date\(\), model: turn\.model, self, override, pollFails: 0 \},/.test(runQuestion)
  && /\.\.\.\(attachment \? \{ fileRef: attachment \} : \{\}\),/.test(runQuestion)
  && /await patchDoc\(env, askQueuePath\(kind, id, qaId\), \{ kind, id, qaId, ask: true, at: new Date\(\) \},/.test(runQuestion)
  && /ev: 'ask-submit', kind, self, ms: Date\.now\(\) - t0/.test(runQuestion)
  && /const askQueuePath = \(kind, id, qaId\) => `advisorQueue\/ask_\$\{kind\}_\$\{id\}_\$\{qaId\}`;/.test(ADV)
  && (ADV.match(/tools: actionTools\(\)/g) || []).length === 1
  && /return keepaliveRun\(ctx, runQuestion\(env, kind, id, qaId, question, attachment\), \{ raw: true \}\);/.test(W),
  `slab ${runQuestion.length} chars`);

// ---- AF2: the verdict on one poll, every branch -------------------------------
// NEGATIVE CONTROL (run 2026-09-07): ASK_POLL_FAILS_MAX raised from 30 to 31, so the thirtieth unreachable poll waited instead of abandoning, made this read
//   FAIL  AF2 the verdict on one poll: a landed batch finishes, ...
const T = 1_700_000_000_000;
const flight = (extra = {}) => ({ batchId: 'b', customId: 'c', submittedAt: new Date(T).toISOString(), pollFails: 0, ...extra });
const runs = askFlightNext && {
  done: askFlightNext(flight(), { state: 'done', message: {} }, T + 60_000),
  failed: askFlightNext(flight(), { state: 'failed', why: 'boom' }, T + 60_000),
  young: askFlightNext(flight({ pollFails: 4 }), { state: 'running' }, T + 60_000),
  unreachable: askFlightNext(flight({ pollFails: 3 }), { state: 'unreachable' }, T + 60_000),
  unreachableMax: askFlightNext(flight({ pollFails: 29 }), { state: 'unreachable' }, T + 60_000),
  old: askFlightNext(flight(), { state: 'running' }, T + 2 * 3_600_000 + 1),
  oldButDone: askFlightNext(flight(), { state: 'done', message: {} }, T + 3 * 3_600_000),
};
check('AF2 the verdict on one poll: a landed batch finishes, a failed one fails with its reason, a young running one waits and a reachable poll resets the unreachable count, an unreachable poll counts up, thirty in a row abandon it with the batch cancelled, two hours abandon it the same way, and a landed batch finishes however old it is',
  !!runs
  && runs.done.op === 'finish'
  && runs.failed.op === 'fail' && runs.failed.why === 'boom' && !runs.failed.cancel
  && runs.young.op === 'wait' && runs.young.pollFails === 0
  && runs.unreachable.op === 'wait' && runs.unreachable.pollFails === 4
  && runs.unreachableMax.op === 'fail' && runs.unreachableMax.cancel === true && /half an hour/.test(runs.unreachableMax.why)
  && runs.old.op === 'fail' && runs.old.cancel === true && /two hours/.test(runs.old.why)
  && runs.oldButDone.op === 'finish'
  && /const ASK_ABANDON_MS = 2 \* 3_600_000;/.test(consts) && /const ASK_POLL_FAILS_MAX = 30;/.test(consts)
  && !DASH.test(verdictSrc),
  JSON.stringify(runs));

// ---- AF3: three pollers, one finish -------------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the `if (won === false) return false;` guard before finishQuestion removed made this read
//   FAIL  AF3 three pollers and one finish: ...
check('AF3 three pollers and one finish: the drain looks at an ask marker under the case policy and never claims it as a read, pollFlightsNow routes it the same way, the state route polls the running rows it just read and re-reads them when one was touched, the finish is claimed conditionally on the row not having moved, a stale claim goes free in five minutes, and the marker deletes itself once the row is done',
  /if \(row\.data\.ask\) \{\n\s+await withCasePolicy\(env, kind, id, \(\) => pollAskFlight\(env, kind, id, String\(row\.data\.qaId \|\| ''\)\)\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}\n\s+\/\/ A draft marker/.test(ADV)
  && /if \(row\.data\.ask\) \{\n\s+await withCasePolicy\(env, kind, id, \(\) => pollAskFlight\(env, kind, id, String\(row\.data\.qaId \|\| ''\), \{ minAgeMs: 45_000 \}\)\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}\n\s+await pollCaseFlight\(env, kind, id, \{ minAgeMs: 45_000 \}\)/.test(ADV)
  && /const inFlight = qa\.filter\(\(r\) => r\.data\.status === 'running' && r\.data\.batch\?\.batchId\)\.slice\(0, 3\);/.test(W)
  && /await withCasePolicy\(env, kind, id, async \(\) => \{\n\s+for \(const r of inFlight\) touched = \(await pollAskFlight\(env, kind, id, r\.id\)\.catch\(\(\) => false\)\) \|\| touched;\n\s+\}\);\n\s+if \(touched\) qa = await qaPage\(\);/.test(W)
  && /if \(beat && Date\.now\(\) - beat < minAgeMs\) return false;/.test(pollAsk)
  && /if \(fin && Date\.now\(\) - fin < 5 \* 60_000\) return false;/.test(pollAsk)
  && /\{ mask: \['batch'\], ifUpdateTime: row\.updateTime \}\)\.catch\(\(\) => false\);\n\s+if \(won === false\) return false;\n\s+await finishQuestion\(env, kind, id, qaId, flight, poll\.message\);\n\s+await deleteDoc\(env, marker\)/.test(pollAsk)
  && /if \(!row \|\| row\.data\.status !== 'running' \|\| !flight\?\.batchId\) \{\n[^\n]*\n\s+await deleteDoc\(env, marker\)\.catch\(\(\) => \{\}\);\n\s+return false;/.test(pollAsk)
  && /poll = \{ state: 'unreachable' \};/.test(pollAsk)
  && /pollCaseFlight, pollFlightsNow, pollAskFlight,/.test(W));

// ---- AF4: the finish, its failure line, the one resend ------------------------
// NEGATIVE CONTROL (run 2026-09-07): finishQuestion's `cleaned = await applyForgotten(env, cleaned);` line removed made this read
//   FAIL  AF4 the finish reads the landed message as the live path did: ...
check('AF4 the finish reads the landed message as the live path did: the tool_use blocks written down and never run, the answer through extractText, the harvest with his question and the answer as material and the file as a document, mastered and forgotten, the override filed or kept to his own case, the proposal parked after the answer, the stale flag; a failure writes the Couldn\'t answer line with the batch cleared; and a refused stronger model is stamped and the question sent once more, never twice',
  finishQuestion.length > 1500
  && /collectActs\(message, acts\);\n\s+const answer = extractText\(message\);/.test(finishQuestion)
  && /material: personMaterial\(rows, qa, \[question, answer\]\),\n\s+docNames: attachment\?\.name \? \[attachment\.name\] : \[\],/.test(finishQuestion)
  && /cleaned = await applyMastered\(env, cleaned\);\n\s+cleaned = await applyForgotten\(env, cleaned\);/.test(finishQuestion)
  && /if \(self\) \{[\s\S]*?sectionMatch\(cleaned, 'Stance'\)[\s\S]*?\} else \{\n\s+cleaned = await fileOverride\(env, cleaned\);/.test(finishQuestion)
  && /answer: cleaned, status: 'done', override, batch: null,\n\s+\}, \{ mask: \['answer', 'status', 'override', 'batch'\] \}\);\n\s+await diagLog\(env, \{ ev: 'ask-end', ok: true, kind, ms: Date\.now\(\) - t0 \}\)[\s\S]*?await parkAct\(env, kind, id, acts\)[\s\S]*?await markPending\(env, kind, id\)/.test(finishQuestion)
  && /answer: `Couldn't answer: \$\{friendly\(err\)\}`, status: 'error', batch: null,/.test(finishQuestion)
  && /if \(flight\.model && !row\.data\.resent\n\s+&& modelRefused\(\{ status: 400, message: String\(next\.why \|\| ''\) \}, \{ model: flight\.model \}\)\) \{/.test(pollAsk)
  && /await patchDoc\(env, path, \{ batch: null, resent: true \}, \{ mask: \['batch', 'resent'\] \}\)/.test(pollAsk)
  && /await withCasePolicy\(env, kind, id, \(\) => runQuestion\(env, kind, id, qaId, String\(row\.data\.question \|\| ''\), row\.data\.fileRef \|\| null\)\);/.test(pollAsk)
  && /if \(next\.cancel\) \{\n\s+try \{ await client\(env\)\.messages\.batches\.cancel\(flight\.batchId\); \}/.test(pollAsk)
  && /qa: qa\.map\(\(\{ data: \{ fileRef, \.\.\.rest \} \}\) => \{ void fileRef; return rest; \}\),/.test(W),
  `finish ${finishQuestion.length} chars, poll ${pollAsk.length} chars`);

// ---- AF5: the panel's heartbeat rule and the demo -----------------------------
// NEGATIVE CONTROL (run 2026-09-07): the panel's `QA_STALL_MS = 5 * 60_000` put back to `4 * 60_000` made this read
//   FAIL  AF5 the panel judges a question by its heartbeat, not its age: ...
const qaBlock = (P.match(/const QA_STALL_MS = [\s\S]*?function renderQa\(qa\) \{[\s\S]*?qaEl\.innerHTML = rows\.join\(''\);/) || [''])[0];
check('AF5 the panel judges a question by its heartbeat, not its age: five quiet minutes on the newer of at and progressAt say no answer came back, after a minute and a half a running row says a long answer takes a few minutes and lands on its own, and the demo mirrors the ask as a running row with a batch that lands a few seconds later, newest first',
  /const QA_STALL_MS = 5 \* 60_000;\n\s+const QA_LONG_MS = 90_000;/.test(qaBlock)
  && /const qaBeat = \(q\) => Math\.max\(\n\s+q\.at \? toDate\(q\.at\)\?\.getTime\(\) \|\| 0 : 0,\n\s+q\.progressAt \? toDate\(q\.progressAt\)\?\.getTime\(\) \|\| 0 : 0\);/.test(qaBlock)
  && /const beat = qaBeat\(q\);\n\s+return !!beat && Date\.now\(\) - beat > QA_STALL_MS;/.test(qaBlock)
  && /thinking…\$\{qaLong\(q\) \? ' A long answer takes a few minutes and lands on its own\.' : ''\}/.test(qaBlock)
  && !/the Q&A path writes no heartbeat/.test(P)
  && /if \(body\.action === 'ask'\) \{[\s\S]*?status: 'running', at: new Date\(\), progressAt: new Date\(\),\n\s+batch: \{ batchId: 'demo-batch', submittedAt: new Date\(\) \},/.test(D)
  && /if \(!p\.startsWith\(qaPrefix\) \|\| d\.status !== 'running'\) continue;\n\s+if \(Date\.now\(\) - new Date\(d\.at \|\| 0\)\.getTime\(\) < 4000\) continue;/.test(D)
  && /qa: qaRows,/.test(D)
  && !DASH.test(qaBlock),
  `qa block ${qaBlock.length} chars`);

// ---- AF6: the version note and the config comment ------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the 3.5 note's "lands on its own, phone locked or not;" cut to "lands on its own;" made this read
//   FAIL  AF6 the version note says a question rides the background lane and lands on its own, ...
const entry = (CL.match(/version: '3\.5',[\s\S]*?\n  \},/) || [''])[0];
check('AF6 the version note says a question rides the background lane and lands on its own, in words a client may read, and the config says why no clock in the Worker holds a model turn and that both rejected keys stay out',
  !!entry && /handed to the same background lane the readings use/.test(entry)
  && /lands on its own, phone locked or not/.test(entry) && /five quiet minutes/.test(entry)
  && !/\badvisor\b/i.test(entry) && !/\bmodel\b/i.test(entry) && !DASH.test(entry)
  && /every long model turn rides the Batches API instead/.test(CFG) && /a "workflows" key beside it, were rejected/.test(CFG)
  && !/"limits"\s*:/.test(CFG) && !/"workflows"\s*:/.test(CFG));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
