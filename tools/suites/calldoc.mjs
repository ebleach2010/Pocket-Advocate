// calldoc.mjs — the call document, driven against the REAL runCallDoc lifted
// out of worker/advisor.js.
//
// WHY IT RUNS THE FUNCTION RATHER THAN GREPPING IT. runCallDoc ends in a
// catch that records the failure and returns. That is right for production -
// a dead turn must not take the isolate with it - and lethal for a test,
// because a missing binding, a typo'd helper or a bad property all land in
// the same quiet `callDocStatus: 'error'`. So this suite drives the function
// and then ASSERTS ON THE STATE IT WROTE: status ready, no error, and the
// error text surfaced when there should be one. A run that dies of a
// ReferenceError fails here loudly, which is the whole point.
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

// ---- lift ----
function fn(name) {
  // Brace-counted, not regex-matched. /\n\}/ stops at the first brace in
  // column 0, and this function's system prompt is a template literal with
  // plenty of text in it - the lifted body came out truncated and unbalanced,
  // which surfaced as "Unexpected token 'return'" rather than as anything
  // resembling the real problem.
  const start = SRC.indexOf(`export async function ${name}(`);
  if (start < 0) throw new Error(`could not lift ${name}`);
  // The BODY's opening brace, which is not the first brace: runCallDoc takes a
  // destructured options object, so `{ instruction = '', ... }` opens one
  // inside the parameter list and a naive indexOf('{') closed the count at the
  // end of the signature - 130 characters of "function" and nothing else.
  let par = 0, bodyAt = -1;
  for (let k = SRC.indexOf('(', start); k < SRC.length; k++) {
    if (SRC[k] === '(') par++;
    else if (SRC[k] === ')') { par--; if (!par) { bodyAt = SRC.indexOf('{', k); break; } }
  }
  if (bodyAt < 0) throw new Error(`could not find the body of ${name}`);
  let depth = 0, i = bodyAt, end = -1, inTpl = false;
  for (; i < SRC.length; i++) {
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
function konst(name) {
  // Stop at a semicolon that ENDS A LINE, not the first semicolon anywhere: a
  // first pass used [^;]+; and cut escAttr in half inside the string '&amp;',
  // which contains one. The lifted half was a syntax error, and a suite that
  // cannot parse the thing it tests proves nothing.
  const m = SRC.match(new RegExp(`\\nconst ${name} = [\\s\\S]*?;\\n`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0];
}
const LIFTED = [konst('MAX_CALLDOC_SOURCES'), konst('escAttr'), fn('runCallDoc')].join('\n');

// ---- the world ----
let state, queue, asked, attachCalls;
const reset = () => { state = {}; queue = new Map(); asked = null; attachCalls = []; };

const deps = {
  setState: async (env, kind, id, fields) => { Object.assign(state, fields); },
  patchDoc: async (env, path, data) => { queue.set(path, data); return true; },
  deleteDoc: async (env, path) => { queue.delete(path); return true; },
  getDoc: async (env, path) => (/private\/notes$/.test(path)
    ? { data: { html: '<p>He said the rash started <b>before</b> the infusion.</p>' } }
    : /advisorState|state$/.test(path)
      ? { data: { analysis: 'Working assessment: seronegative picture, records incomplete.' } }
      : { data: { clientName: 'Jordan Avery', clientTz: 'America/Denver', status: 'open', fullAccess: true } }),
  listDocs: async () => ([{ data: { text: 'Ask about the March panel', done: false } }]),
  recentMessages: async () => ([{ data: () => ({ from: 'client', text: 'I have been going in circles.' }) }]),
  loadQa: async () => ([]),
  loadStyle: async () => ({}),
  stanceNote: () => 'He prefers plain words.',
  qaBlock: () => '<qa>(none)</qa>',
  transcript: () => 'client: I have been going in circles.',
  friendly: (e) => (e && e.message) || String(e),
  statePath: (k, i) => `advisorState/${k}_${i}`,
  callDocQueuePath: (k, i) => `advisorQueue/calldoc_${k}_${i}`,
  attachmentBlock: async (env, att) => {
    attachCalls.push(att?.name);
    if (att?.bad) return { skip: 'a format the advisor cannot read' };
    return { bytes: 0, block: { type: 'document', source: { type: 'url', url: 'https://x/y.pdf' } } };
  },
  VOICE: 'You are Eric.',
  ask: async (env, opts) => { asked = opts; return 'REVIEW BEFORE YOU CALL\n1. *Creatinine read off a chart, check it.\n\nTHE CALL, IN ORDER\nOpen with the March panel.'; },
  console: { error: () => {} },
};
const build = new Function(...Object.keys(deps), `${LIFTED}\n return runCallDoc;`);
const runCallDoc = build(...Object.values(deps));
const env = {};

// ---- a normal build ----
reset();
await runCallDoc(env, 'case', 'a', {
  sources: [{ name: 'prep.pdf', mine: true }, { name: 'labs.pdf' }],
  instruction: 'Lead with the insurance question.',
});
check('D1 it finishes and the state says ready', state.callDocStatus === 'ready',
  `${state.callDocStatus} / ${state.callDocError || 'no error'}`);
check('D2 no error was recorded', !state.callDocError, String(state.callDocError));
check('D3 the document was stored', /REVIEW BEFORE YOU CALL/.test(state.callDoc || ''));
check('D4 it names what it was built from', (state.callDocSources || []).join() === 'prep.pdf,labs.pdf',
  (state.callDocSources || []).join());
check('D5 the in-flight request was cleared', state.callDocReq === null);
check('D6 and the queue entry removed, so nothing reruns it forever', queue.size === 0);

// ---- Eric's explicit ask: Opus Max ----
check('D7 it runs at MAX effort, which is what he asked for', asked?.effort === 'max', asked?.effort);
check('D8 with room to write a long document', asked?.maxTokens >= 32000, String(asked?.maxTokens));

// ---- the shape he asked for ----
const sys = (asked?.system || []).map((b) => b.text).join('\n');
for (const [n, re] of [
  ['the starred items are collected at the top', /REVIEW BEFORE YOU CALL/],
  ['his document is reformatted into call order', /THE CALL, IN ORDER/],
  ['missing questions are named', /QUESTIONS THAT ARE MISSING/],
  ['the case adds what his document lacks', /FROM THE CASE, NOT IN YOUR DOCUMENT/],
  ['and every claim carries a source', /SOURCES/],
  ['the asterisk rule is explicit', /Put \* immediately before anything Eric should personally verify/],
  ['when in doubt it stars it', /when it is close, star it/],
  ['his document is the spine, not a draft to replace', /THAT DOCUMENT IS THE SPINE/],
  ['it may not invent values', /Never invent a value/],
  ['it may not diagnose', /Never diagnose/],
  ['and no em dashes, per the standing rule', /Never use an em dash/],
]) check(`D9 ${n}`, re.test(sys), 'missing from the system prompt');

// ---- the documents actually ride the turn ----
const content = asked?.messages?.[0]?.content;
check('D10 the uploads are sent as document blocks',
  Array.isArray(content) && content.filter((b) => b.type === 'document').length === 2,
  JSON.stringify((content || []).map((b) => b.type)));
check('D11 his own upload is marked as his, so his words are preserved',
  (content || []).some((b) => b.type === 'text' && /from="Eric"/.test(b.text || '')));
check('D12 the case rides with them', (content || []).some((b) => /Jordan Avery/.test(b.text || '')));
check('D13 including his private notes', (content || []).some((b) => /before<\/b>|before the infusion/.test(b.text || '')));

// ---- a file it cannot read is reported, not silently dropped ----
reset();
await runCallDoc(env, 'case', 'a', { sources: [{ name: 'scan.heic', bad: true }, { name: 'ok.pdf' }] });
check('D14 an unreadable file does not kill the run', state.callDocStatus === 'ready', state.callDocError);
check('D15 and Eric is told which one, and why',
  (state.callDocSkipped || []).some((t) => /scan\.heic: a format/.test(t)),
  JSON.stringify(state.callDocSkipped));
check('D16 the readable one still went in', (state.callDocSources || []).join() === 'ok.pdf');

// ---- the cap ----
reset();
await runCallDoc(env, 'case', 'a', { sources: Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.pdf` })) });
check('D17 it stops at the source cap rather than sending thirty documents',
  attachCalls.length === 12, `${attachCalls.length} sent`);

// ---- revising keeps his words ----
reset();
await runCallDoc(env, 'case', 'a', { revise: true, base: 'EXISTING DOC BODY', instruction: 'shorter' });
const rev = asked.messages[0].content.find((b) => b.type === 'text' && /current_call_document/.test(b.text || ''));
check('D18 a revision is given the current document', !!rev && /EXISTING DOC BODY/.test(rev.text));
check('D19 and told to keep what he did not ask to change',
  /Keep everything he did not ask you to change/.test(rev.text));

// ---- a failing turn is recorded, not swallowed ----
reset();
const boom = build(...Object.values({ ...deps, ask: async () => { throw new Error('provider exploded'); } }));
await boom(env, 'case', 'a', { sources: [] });
check('D20 a dead turn writes status error', state.callDocStatus === 'error', state.callDocStatus);
check('D21 with the reason, so the panel can say it', /provider exploded/.test(state.callDocError || ''),
  state.callDocError);
check('D22 and lets go of the queue, so it does not retry forever', queue.size === 0);

// ---- an empty answer is a failure, not a document ----
reset();
const empty = build(...Object.values({ ...deps, ask: async () => '   ' }));
await empty(env, 'case', 'a', { sources: [] });
check('D23 an empty answer is an error, never a blank document saved as ready',
  state.callDocStatus === 'error' && !state.callDoc, `${state.callDocStatus}/${state.callDoc}`);

// ---- the write that never fit -------------------------------------------
// THE BLIND SPOT THIS SUITE HAD. `deps.setState` above accepts anything, so
// nothing in this file could ever see a document too big to STORE - and the
// first thing runCallDoc does is write callDocReq, which used to carry each
// source's base64 verbatim. Base64 is 4/3 of the file and a Firestore
// document is capped at 1 MiB, so any upload over about 786 KB failed with a
// raw 400 before the model was called at all. That is a phone photo. That is
// a scanned page. That is what he uploads.
//
// So this section swaps in a setState that enforces the REAL limit and drives
// the same function with a realistically sized document.
const FIRESTORE_DOC_MAX = 1_048_576;
const sizedDeps = (rec) => ({
  ...deps,
  setState: async (envx, kind, id, fields) => {
    // What goes over the wire before Firestore's own field encoding, which
    // only ADDS to it. An under-count that still exceeds the cap is proof.
    const bytes = new TextEncoder().encode(JSON.stringify(fields)).length;
    rec.max = Math.max(rec.max || 0, bytes);
    if (bytes > FIRESTORE_DOC_MAX) {
      throw new Error(`firestore patch: 400 INVALID_ARGUMENT: the value of property "callDocReq" is longer than ${FIRESTORE_DOC_MAX} bytes`);
    }
    Object.assign(state, fields);
  },
});

// A 3 MB photo of a lab printout: an ordinary iPhone picture, and well inside
// the panel's own 8 MB cap.
const bigB64 = 'A'.repeat(Math.ceil((3 * 1024 * 1024 * 4) / 3));
reset();
const rec = { max: 0 };
const sized = build(...Object.values(sizedDeps(rec)));
await sized(env, 'case', 'a', {
  sources: [{ name: 'chart-photo.jpg', contentType: 'image/jpeg', size: 3 * 1024 * 1024, mine: true, data: bigB64 }],
});
check('D24 a 3 MB upload does not blow the 1 MiB document limit',
  state.callDocStatus === 'ready',
  `${state.callDocStatus}: ${String(state.callDocError || '').slice(0, 120)}`);
check('D25 because the request stores descriptors, never the bytes',
  rec.max > 0 && rec.max < FIRESTORE_DOC_MAX, `largest write was ${rec.max} bytes`);
check('D26 and the upload still reached the model',
  attachCalls.includes('chart-photo.jpg'), attachCalls.join());

// The route drops anything past its inline budget. runCallDoc must SAY so
// rather than build a document quietly missing a file he watched himself pick.
reset();
await runCallDoc(env, 'case', 'a', {
  sources: [{ name: 'prep.pdf', mine: true }, { name: 'huge-scan.pdf', overBudget: true }],
});
check('D27 a file dropped for size is named, not silently missing',
  (state.callDocSkipped || []).some((s) => /huge-scan\.pdf/.test(s)),
  JSON.stringify(state.callDocSkipped));
check('D28 and the rest of the document is still built',
  state.callDocStatus === 'ready', state.callDocStatus);

// ---- the case's own files ------------------------------------------------
// Section 4 needs two documents in the room. A case file arrives with a URL
// and no bytes, is never his document, and must be tagged so the model can
// tell "the spine" from "material to read it against".
reset();
await runCallDoc(env, 'case', 'a', {
  sources: [
    { name: 'prep.pdf', mine: true, data: 'AAAA' },
    { name: 'discharge-summary.pdf', url: 'https://storage/x/discharge.pdf', size: 900000 },
    { name: 'hand-rash.jpg', url: 'https://storage/x/rash.jpg', size: 400000 },
  ],
});
const blocks = asked?.messages?.[0]?.content || [];
const tags = blocks.filter((b) => b.type === 'text' && /^<document /.test(b.text || ''))
  .map((b) => b.text);
check('D29 all three documents ride the turn', tags.length === 3, JSON.stringify(tags));
check('D30 only HIS is tagged as his', tags.filter((t) => /from="Eric"/.test(t)).length === 1,
  JSON.stringify(tags));
check('D31 and it is the one he picked off the device',
  /prep\.pdf/.test(tags.find((t) => /from="Eric"/.test(t)) || ''),
  tags.find((t) => /from="Eric"/.test(t)));
check('D32 the case files are named but NOT marked his',
  tags.some((t) => /discharge-summary/.test(t) && !/from="Eric"/.test(t))
  && tags.some((t) => /hand-rash/.test(t) && !/from="Eric"/.test(t)), JSON.stringify(tags));
check('D33 and all three are recorded as what it was built from',
  (state.callDocSources || []).length === 3, JSON.stringify(state.callDocSources));

// The prompt has to SAY what a case document is for, or the model treats a
// lab report's structure as a call plan.
const sys2 = (asked?.system || []).map((b) => b.text).join('\n');
check('D34 the prompt names the other documents as case material',
  /CASE MATERIAL he ticked from the file shelf/.test(sys2));
check('D35 and says their structure means nothing here',
  /its structure means nothing here/.test(sys2));
check('D36 and tells it to read ACROSS them',
  /Read ACROSS the case documents he ticked/.test(sys2));
check('D37 with a defined behaviour when nothing came from him',
  /BUILT FROM THE CASE, NOT FROM YOUR DOCUMENT/.test(sys2));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
