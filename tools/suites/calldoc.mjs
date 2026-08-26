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
function fn(name, decl = `export async function ${name}(`) {
  // Brace-counted, not regex-matched. /\n\}/ stops at the first brace in
  // column 0, and this function's system prompt is a template literal with
  // plenty of text in it - the lifted body came out truncated and unbalanced,
  // which surfaced as "Unexpected token 'return'" rather than as anything
  // resembling the real problem.
  //
  // `decl` exists because the turn machinery this suite now also drives - ask,
  // turnRequest, extractText - is module-private and unexported. Nothing can
  // import it, so it gets lifted the same way runCallDoc does, and pass the
  // leading newline in the declaration to keep the match unambiguous.
  const start = SRC.indexOf(decl);
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
// WEB_SEARCH_* are lifted rather than stubbed on purpose. The tool block the
// suite asserts on has to be the REAL one out of advisor.js, or this file
// happily proves that a constant it wrote itself has the right shape.
const LIFTED = [
  konst('MAX_CALLDOC_SOURCES'), konst('escAttr'),
  konst('WEB_SEARCH_MAX_USES'), konst('WEB_SEARCH_TOOL'), konst('WEB_SEARCH_RULES'),
  fn('runCallDoc'),
].join('\n');

// ---- the world ----
let state, queue, asked, attachCalls;
const reset = () => { state = {}; queue = new Map(); asked = null; attachCalls = []; };
// `queue` records EVERY patchDoc, not just advisorQueue rows, so asking
// whether it is empty is not the same as asking whether the retry row is
// gone. It broke the moment runCallDoc started stamping caseMeta on
// success - a legitimate write failing a check that meant something else.
const queueRows = () => [...queue.keys()].filter((k) => k.startsWith('advisorQueue/'));

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
  console: { error: () => {}, warn: () => {} },
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
check('D6 and the queue entry removed, so nothing reruns it forever',
  queueRows().length === 0, queueRows().join());

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
check('D22 and lets go of the queue, so it does not retry forever',
  queueRows().length === 0, queueRows().join());

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

// ---- it has to SAY it finished ------------------------------------------
// The longest turn in the app used to land in silence: no dot on the tab, the
// group or the shelf, while the panel told him he could leave the page. The
// shelf badge reads caseMeta.callDocAt, so if nothing writes it the badge is
// wired to a field that never exists - which is exactly what a UI-only fix
// would have shipped.
reset();
await runCallDoc(env, 'case', 'a', { sources: [{ name: 'prep.pdf', mine: true }] });
const meta = queue.get('caseMeta/a');
check('D38 a finished document stamps caseMeta, so the shelf can badge it',
  !!meta?.callDocAt, JSON.stringify([...queue.keys()]));
check('D39 and the stamp is the only thing written there - no case content',
  meta && Object.keys(meta).join() === 'callDocAt', JSON.stringify(meta));

// A FAILED run must not stamp: a dot promising a ready document he does not
// have is worse than no dot.
reset();
const boom2 = build(...Object.values({ ...deps, ask: async () => { throw new Error('nope'); } }));
await boom2(env, 'case', 'a', { sources: [] });
check('D40 a failed run stamps nothing', !queue.get('caseMeta/a'),
  JSON.stringify([...queue.keys()]));

// A subscription has no folder on the shelf to badge.
reset();
await runCallDoc(env, 'sub', 'a', { sources: [{ name: 'prep.pdf', mine: true }] });
check('D41 and a subscription does not stamp a case that is not there',
  !queue.get('caseMeta/a'), JSON.stringify([...queue.keys()]));

// ---- looking things up on the internet ----------------------------------
// Eric, 2026-08-26: "any internet searches for providers mentioned or other
// providers/paths of action that may be useful."
//
// Web search is a SERVER tool: it runs on Anthropic's side, so there is no
// execution loop here to test. What there IS to test is everything around it,
// and all of it is the kind of thing that fails silently. A tool declared on
// every build spends his money forever. A tool error arrives inside an HTTP
// 200 rather than as a throw, so the crash it causes lands only on the day a
// search actually fails, in production, on the one document he needs. And a
// document that mixes a web page into the case sections gets read aloud to a
// frightened person as though the case file said it.
//
// So: assert on written state, and drive the REAL turn machinery, not a mock
// of it.

// The tool constant itself, lifted rather than re-typed. A suite that writes
// its own copy of the thing it is checking proves only that it can type.
const WEB_SEARCH_TOOL = new Function(
  `${konst('WEB_SEARCH_MAX_USES')}${konst('WEB_SEARCH_TOOL')}\n return WEB_SEARCH_TOOL;`)();

// ---- off unless he ticks it ----
reset();
await runCallDoc(env, 'case', 'a', { sources: [{ name: 'prep.pdf', mine: true }] });
check('D42 searching is OFF by default, so an ordinary build declares no tools',
  asked?.tools === undefined, JSON.stringify(asked?.tools));
check('D43 and a default build is still a finished document', state.callDocStatus === 'ready');
check('D44 nothing claims it searched', state.callDocSearched === false && !state.callDocSearchNote,
  `${state.callDocSearched} / ${state.callDocSearchNote}`);
const sysOff = (asked?.system || []).map((b) => b.text).join('\n');
check('D45 and the internet rules are absent from the prompt entirely, so the cached prefix an ordinary build sends is unchanged',
  !/FROM THE INTERNET, NOT FROM THE CASE/.test(sysOff));

// ---- on, when he ticks it ----
reset();
await runCallDoc(env, 'case', 'a', { sources: [{ name: 'prep.pdf', mine: true }], search: true });
check('D46 ticking it declares exactly one tool', (asked?.tools || []).length === 1,
  JSON.stringify(asked?.tools));
check('D47 and it is the web search server tool, by the type the API expects',
  asked?.tools?.[0]?.type === 'web_search_20260209' && asked?.tools?.[0]?.name === 'web_search',
  JSON.stringify(asked?.tools?.[0]));
check('D48 bounded by max_uses, because every use is billed on the most expensive turn in the app',
  Number(asked?.tools?.[0]?.max_uses) > 0 && Number(asked?.tools?.[0]?.max_uses) <= 10,
  String(asked?.tools?.[0]?.max_uses));
check('D49 code_execution is NOT declared beside it: this variant runs it underneath already, and a second execution environment confuses the model',
  !(asked?.tools || []).some((t) => /code_execution/.test(t?.type || '') || t?.name === 'code_execution'),
  JSON.stringify(asked?.tools));
check('D50 allowed_domains and blocked_domains are never both set, which is a request error',
  !(asked?.tools?.[0]?.allowed_domains && asked?.tools?.[0]?.blocked_domains));
check('D51 a sink rides with it, so the run can tell "searched and found nothing" from "never searched"',
  asked?.toolMeta && typeof asked.toolMeta === 'object');
check('D52 the finished document records that the internet was consulted at all',
  state.callDocSearched === true && !!state.callDocSearchNote,
  `${state.callDocSearched} / ${state.callDocSearchNote}`);

// The request the RETRY reads. Captured from the first write, before success
// clears it, which is the only moment it exists.
reset();
let reqSeen = null;
const capture = build(...Object.values({
  ...deps,
  setState: async (e2, k2, i2, fields) => {
    if (fields.callDocReq) reqSeen = fields.callDocReq;
    Object.assign(state, fields);
  },
}));
await capture(env, 'case', 'a', { sources: [{ name: 'prep.pdf', mine: true }], search: true });
check('D53 the stored request carries the tick, not a guess', reqSeen?.search === true,
  JSON.stringify(reqSeen?.search));

// ---- what the prompt is allowed to do with what it finds ----
reset();
await runCallDoc(env, 'case', 'a', { sources: [{ name: 'prep.pdf', mine: true }], search: true });
const sysOn = (asked?.system || []).map((b) => b.text).join('\n');
for (const [n, re] of [
  ['what may be searched for is providers and programmes THE RECORD names', /THE RECORD ITSELF NAMES/],
  ['and other paths of action worth knowing about', /appeal route[\s\S]{0,120}patient assistance/],
  ['it is not for diagnosis', /Not diagnosis/],
  ['not for treatment advice', /Not treatment advice/],
  ['and never a recommendation to start, stop or change anything', /Never a recommendation to start, stop or change/],
  ['it may not invent a clinician, a clinic or a phone number', /Never invent a clinician, a clinic, a programme, an address or a phone number/],
  ['and a search result does not license naming a doctor the record does not name', /a search result does not lift it/],
  ['a name may appear only if a page actually says it, with that page URL', /only on a line that carries that page's URL/],
  ['internet material may not be mixed into the case sections', /Nothing from the internet may be mixed into sections 1 to 5/],
  ['it gets its own labelled section', /"FROM THE INTERNET, NOT FROM THE CASE"/],
  ['opening with an unmistakable line about where it came from', /NOT FROM THE CASE FILE\. NOT VERIFIED\. CHECK BEFORE YOU SAY IT\./],
  ['every item starred, because the asterisk already means "verify this"', /Every item is starred, without exception/],
  ['every item carrying its source URL', /the source URL on its own line directly beneath it/],
  ['and section 1 pointing at it without drowning the flags from the case', /\* Section 6 is from the internet, none of it verified\./],
  ['finding nothing is a normal build, not a failure', /nothing useful came back/i],
]) check(`D54 ${n}`, re.test(sysOn), 'missing from the system prompt');

// ---- THE TRAP: a tool error is an HTTP 200 with an error OBJECT ----------
// This is the whole reason the section exists. On success, a
// web_search_tool_result carries a LIST. On failure it carries a single error
// OBJECT in the SAME field, and the request succeeded, so nothing raises.
// Anything that indexes, maps or spreads that field crashes on the failure
// path only. So the REAL extractText is lifted and driven with both shapes.
const ASK_LIFTED = [
  konst('MODEL'), konst('MAX_PAUSE_RESUMES'),
  fn('withCacheBp', '\nfunction withCacheBp('),
  fn('turnRequest', '\nfunction turnRequest('),
  fn('stripDashes', '\nfunction stripDashes('),
  fn('extractText', '\nfunction extractText('),
  fn('ask', '\nasync function ask('),
].join('\n');
let carried = [];
let finals = [];
// WHEN THE SCRIPT RUNS OUT, SAY SO - DO NOT HAND BACK undefined.
//
// This dispenser used to be a bare `finals.shift()`. Every check here scripts
// exactly the turns it expects, so a defect that makes ask() take ONE MORE
// turn than the script allows got `undefined` back, and extractText died on
// `undefined.stop_reason`. The suite then exited mid-file: the check that
// caught the defect never printed, and every check after it never ran. That
// is how D68 behaved when the pause_turn guard was removed - it detected the
// bug and took eighteen later checks down with it, reporting neither.
//
// The battery still went red (run.mjs greps the crash output for /Error/), so
// the gate held. But a check that dies instead of failing tells you nothing
// about WHAT broke, and it hides everything behind it. So an over-draw now
// returns a well-formed Message that no assertion will accept, and the run
// carries on to the end with one honest FAIL on the line that caught it.
const overDrawn = { stop_reason: 'end_turn', content: [{ type: 'text', text: '<<UNSCRIPTED EXTRA TURN>>' }] };
const askEnv = new Function('carryTurn', 'console',
  `${ASK_LIFTED}\n return { ask, turnRequest, extractText };`)(
  async (e2, turn) => { carried.push(turn); return finals.length ? finals.shift() : overDrawn; },
  { warn: () => {}, error: () => {} },
);
const { ask: realAsk, turnRequest, extractText } = askEnv;
const oneTurn = (opts = {}) => ({ system: [{ type: 'text', text: 'sys' }], messages: [{ role: 'user', content: 'go' }], effort: 'max', maxTokens: 32000, ...opts });

const errBlock = { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } };
check('D55 the fixture really is the failure shape: an object where success sends a list',
  !Array.isArray(errBlock.content) && !!errBlock.content.error_code);

let tmeta = { queries: 0, results: 0, errors: [] };
let text = '';
let threw = null;
try {
  text = extractText({
    stop_reason: 'end_turn',
    content: [
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'x' } },
      errBlock,
      { type: 'text', text: 'REVIEW BEFORE YOU CALL\n1. *Check this.' },
    ],
  }, tmeta);
} catch (e) { threw = e; }
check('D56 an error OBJECT in a 200 does not crash the text pull', !threw, String(threw && threw.message));
check('D57 the document text is still returned', /REVIEW BEFORE YOU CALL/.test(text), text);
check('D58 and the failure is counted rather than swallowed in silence',
  tmeta.errors.join() === 'max_uses_exceeded' && tmeta.results === 0, JSON.stringify(tmeta));

tmeta = { queries: 0, results: 0, errors: [] };
text = extractText({
  stop_reason: 'end_turn',
  content: [
    { type: 'server_tool_use', id: 'srv_2', name: 'web_search', input: { query: 'y' } },
    { type: 'web_search_tool_result', tool_use_id: 'srv_2', content: [{ type: 'web_search_result', url: 'https://example.org/a', title: 'A' }, { type: 'web_search_result', url: 'https://example.org/b', title: 'B' }] },
    { type: 'text', text: 'FROM THE INTERNET, NOT FROM THE CASE' },
  ],
}, tmeta);
check('D59 a LIST is the success shape and its results are counted',
  tmeta.results === 2 && tmeta.queries === 1 && !tmeta.errors.length, JSON.stringify(tmeta));
check('D60 with the text still pulled out from beside the tool blocks',
  /FROM THE INTERNET/.test(text), text);

// ---- the request body the real turnRequest builds ----
const bodyOn = turnRequest({ system: [{ type: 'text', text: 's' }], messages: [], effort: 'max', maxTokens: 32000, tools: [WEB_SEARCH_TOOL] });
check('D61 the tool reaches the request body under `tools`',
  bodyOn.tools?.[0]?.type === 'web_search_20260209', JSON.stringify(bodyOn.tools));
check('D62 with no beta header machinery bolted on, it is an ordinary request',
  !('betas' in bodyOn) && !('anthropic_beta' in bodyOn), JSON.stringify(Object.keys(bodyOn)));
const bodyOff = turnRequest({ system: [{ type: 'text', text: 's' }], messages: [], effort: 'max', maxTokens: 32000 });
check('D63 and a caller that passes no tools sends no `tools` key at all, so the other five callers are byte-identical',
  !('tools' in bodyOff), JSON.stringify(Object.keys(bodyOff)));

// ---- pause_turn ----
carried = [];
finals = [
  { stop_reason: 'pause_turn', content: [{ type: 'text', text: 'first half' }, { type: 'server_tool_use', id: 's', name: 'web_search', input: {} }] },
  { stop_reason: 'end_turn', content: [{ type: 'text', text: 'second half' }] },
];
tmeta = { queries: 0, results: 0, errors: [] };
let joined = await realAsk({}, oneTurn({ tools: [WEB_SEARCH_TOOL], toolMeta: tmeta }));
check('D64 pause_turn is handed back to the model rather than treated as the end',
  carried.length === 2, `${carried.length} requests`);
check('D65 and the text from BOTH halves survives, so a paused turn is not a truncated document',
  /first half/.test(joined) && /second half/.test(joined), joined);
check('D66 the resumed request carries what was written so far',
  carried[1]?.messages?.length === 2 && carried[1].messages[1].role === 'assistant',
  JSON.stringify((carried[1]?.messages || []).map((m) => m.role)));
check('D67 and still declares the tool, or the model loses it mid turn',
  carried[1]?.tools?.[0]?.type === 'web_search_20260209');

carried = [];
finals = [{ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'only half' }] }];
joined = await realAsk({}, oneTurn());
check('D68 a caller with no tools never enters the resume loop, whatever stop_reason says',
  carried.length === 1 && joined === 'only half', `${carried.length} / ${joined}`);

carried = [];
finals = Array.from({ length: 9 }, () => ({ stop_reason: 'pause_turn', content: [{ type: 'text', text: 'more' }] }));
joined = await realAsk({}, oneTurn({ tools: [WEB_SEARCH_TOOL] }));
check('D69 resuming is bounded, so a turn that never settles cannot spend forever',
  carried.length > 1 && carried.length <= 5, `${carried.length} requests`);
check('D70 and what was written is kept rather than thrown away at the cap', /more/.test(joined));

// ---- a search failure never costs him the document ----------------------
// Three ways it can go wrong, and all three must end with a document on the
// page. Asserted on WRITTEN STATE, because runCallDoc ends in a catch and a
// crash in here would otherwise read as a quiet 'error' nobody noticed.
reset();
const errored = build(...Object.values({
  ...deps,
  ask: async (e2, opts) => {
    asked = opts;
    // The real extractText over a real failure payload, so this is the whole
    // path and not a stub agreeing with itself.
    return extractText({
      stop_reason: 'end_turn',
      content: [errBlock, { type: 'text', text: 'REVIEW BEFORE YOU CALL\n1. *Check this.' }],
    }, opts.toolMeta);
  },
}));
await errored(env, 'case', 'a', { sources: [{ name: 'prep.pdf', mine: true }], search: true });
check('D71 a tool error inside a 200 still yields a finished document',
  state.callDocStatus === 'ready' && /REVIEW BEFORE YOU CALL/.test(state.callDoc || ''),
  `${state.callDocStatus}: ${String(state.callDocError || '').slice(0, 120)}`);
check('D72 and it says so, rather than implying the internet was consulted successfully',
  /max_uses_exceeded/.test(state.callDocSearchNote || ''), state.callDocSearchNote);

// A REQUEST-LEVEL rejection of the tool block does raise. That must cost him
// the search, never the document.
reset();
let toolTries = 0;
const rejected = build(...Object.values({
  ...deps,
  ask: async (e2, opts) => {
    asked = opts;
    if (opts.tools) { toolTries += 1; const e = new Error('invalid_request_error: unsupported tool'); e.status = 400; throw e; }
    return 'REVIEW BEFORE YOU CALL\n1. *Check this.\n\nTHE CALL, IN ORDER\nOpen with the March panel.';
  },
}));
await rejected(env, 'case', 'a', { sources: [{ name: 'prep.pdf', mine: true }], search: true });
check('D73 a rejected tool block falls back to a plain build instead of losing the document',
  state.callDocStatus === 'ready' && /THE CALL, IN ORDER/.test(state.callDoc || ''),
  `${state.callDocStatus}: ${String(state.callDocError || '').slice(0, 160)}`);
check('D74 the fallback ran WITHOUT tools, or it would just fail again',
  toolTries === 1 && asked?.tools === undefined, `${toolTries} tool attempts`);
check('D75 and he is told the lookups did not happen', /did not|failed/i.test(state.callDocSearchNote || ''),
  state.callDocSearchNote);

// But a stall or an overload must NOT be retried: the second turn fails the
// same way, costs another max-effort run, and delays the error he needs.
reset();
let calls = 0;
const stalled = build(...Object.values({
  ...deps,
  ask: async () => { calls += 1; throw new Error('The model went quiet mid-read and the run was stopped.'); },
}));
await stalled(env, 'case', 'a', { sources: [{ name: 'prep.pdf', mine: true }], search: true });
check('D76 a stall is not retried as though it were a tool problem', calls === 1, `${calls} turns`);
check('D77 and it lands as a recorded error, not a silent nothing',
  state.callDocStatus === 'error' && /went quiet/.test(state.callDocError || ''),
  `${state.callDocStatus}: ${state.callDocError}`);

// Searching and finding nothing is an ordinary build.
reset();
const nothing = build(...Object.values({
  ...deps,
  ask: async (e2, opts) => {
    asked = opts;
    return extractText({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'REVIEW BEFORE YOU CALL\n1. *Check this.' }] }, opts.toolMeta);
  },
}));
await nothing(env, 'case', 'a', { sources: [{ name: 'prep.pdf', mine: true }], search: true });
check('D78 a search that returns nothing is still a finished document',
  state.callDocStatus === 'ready' && !state.callDocError, state.callDocError);
check('D79 and says nothing came back rather than staying silent about it',
  /Nothing useful came back/i.test(state.callDocSearchNote || ''), state.callDocSearchNote);

// ---- the wiring, panel to route to runCallDoc ---------------------------
// Read as TEXT, and the header of this file is right that text is the weaker
// check. It is used here because the two ends cannot be lifted: admin-case.js
// is a browser module that imports the Firebase SDK at load, and the route is
// a 7000 line request handler. What is pinned is only the join between them,
// which is the part that silently comes apart: a panel that sends `search`
// against a route that reads `websearch` is two green files and a control
// that does nothing, forever, with no error anywhere.
const PANEL = readFileSync(j(ROOT, 'public/js/admin-case.js'), 'utf8');
const ROUTE = readFileSync(j(ROOT, 'worker/index.js'), 'utf8');
check('D80 the panel has a tick for it', /data-cd-search/.test(PANEL));
check('D81 held in a flag that starts false, so it is never on unless he asks',
  /let callDocSearch = false;/.test(PANEL));
check('D82 the tick is sent with the build', /action: 'call-doc', sources, search: callDocSearch/.test(PANEL));
check('D83 and with a revise, so the two paths cannot drift apart',
  /action: 'call-doc', revise: true[^\n]*search: callDocSearch/.test(PANEL));
check('D84 the route reads that exact field, strictly true, and passes it on',
  /search: body\?\.search === true/.test(ROUTE));
check('D85 discarding a document clears what it said about the internet too',
  /callDocSearched: null, callDocSearchNote: null/.test(ROUTE));
check('D86 nothing on the panel names a model, an AI or automation, because that language never goes on a page',
  !/\b(AI|A\.I\.|model|Claude|Anthropic|automated|automation)\b/i
    .test((PANEL.match(/data-cd-search[\s\S]{0,900}/) || [''])[0]));

// ---- THE ROUTE ITSELF, which nothing had ever driven ------------------------
//
// WHY THIS BLOCK EXISTS. Every check above this line drives runCallDoc, lifted
// out of advisor.js. Not one of them touched the ROUTE that calls it, and the
// route is where the call document actually died: it mapped his ticked sources
// with a helper, `str`, that was defined as a local const inside three OTHER
// route handlers and was not in scope here. That is a synchronous
// ReferenceError, thrown before runCallDoc is ever reached, which the router's
// catch-all flattens into `{ error: 'Internal error' }`.
//
// So the feature returned "Internal error" on every single build, the state was
// never set, the model was never called, and 110 green checks said nothing was
// wrong, because they all started one function too late. This is the third time
// in this directory that a suite has been kinder than production by testing the
// half that works.
//
// The fix is to lift the route's own mapping and RUN it, with only the module
// level helpers it is allowed to see. If a future edit reaches for something
// that is not in scope there, this goes red instead of Eric finding out.
const WSRC = readFileSync(j(ROOT, 'worker/index.js'), 'utf8');

function liftCallDocMapping() {
  const cd = WSRC.indexOf("if (action === 'call-doc')");
  if (cd < 0) throw new Error('the call-doc action is gone');
  const a = WSRC.indexOf('let inlineBudget', cd);
  const tail = ".filter((a) => a.name || a.url || a.path || a.data);";
  const b = WSRC.indexOf(tail, a);
  if (a < 0 || b < 0) throw new Error('could not find the source mapping');
  return WSRC.slice(a, b) + tail;
}

// Only what the route may legitimately see: helpers defined at MODULE level in
// the Worker. A local from another handler must NOT be handed in here, or this
// check would paper over exactly the bug it exists to catch.
function moduleLevel(name) {
  const re = new RegExp('^function ' + name + '\\([^)]*\\) \\{[\\s\\S]*?\\n\\}', 'm');
  const m = WSRC.match(re);
  if (!m) return null;
  return m[0];
}

let routeThrew = null;
let routeOut = null;
try {
  const strDef = moduleLevel('str');
  if (!strDef) throw new Error('str is not defined at module level in worker/index.js');
  const src = strDef + '\n' + liftCallDocMapping() + '\n return sources;';
  routeOut = new Function('body', src)({
    sources: [
      { name: '  prep.pdf  ', contentType: 'application/pdf', size: 4096, path: 'cases/a/prep/x.pdf', mine: true },
      { name: 'photo.jpg', contentType: 'image/jpeg', size: 900, data: 'AAAA' },
    ],
  });
} catch (e) { routeThrew = e; }

check('D87 the ROUTE maps his ticked sources without throwing, which is what "Internal error" was',
  !routeThrew, routeThrew && (routeThrew.constructor.name + ': ' + routeThrew.message));
check('D88 every helper the route reaches for is defined at MODULE level, not inside another handler',
  !!moduleLevel('str'),
  'str must be a module level function, or handleAdvisor cannot see it');
check('D89 and the mapping keeps both a Storage-backed pick and an inline one',
  Array.isArray(routeOut) && routeOut.length === 2, JSON.stringify(routeOut));
check('D90 with the name trimmed and the private tick carried through',
  routeOut?.[0]?.name === 'prep.pdf' && routeOut[0].mine === true && routeOut[0].path === 'cases/a/prep/x.pdf',
  JSON.stringify(routeOut?.[0]));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
