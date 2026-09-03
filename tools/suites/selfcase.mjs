// selfcase.mjs - his own case: the turn policy that pins the stronger model
// at high, the block that tells every prompt who it is reading about, the
// fallback when the stronger model is refused, and the purple.
//
// Eric, 2026-09-03: "I would like to use this tool for myself as I'm entering
// my fifth relapse. Open an admin case file highlighted purple. Same controls,
// only I enter data/information into the chat and there's NOONE on the other
// end. Fable 5.1 high gets used for my case."
//
// The policy machinery is lifted out of the shipped advisor and RUN, with
// AsyncLocalStorage from Node standing in for the Worker's (same API, same
// module name). The wrap sites and the UI are pinned on the source.
import { readFileSync } from 'node:fs';
import { dirname as d, join as j } from 'node:path';
import { fileURLToPath as f2 } from 'node:url';
import { AsyncLocalStorage } from 'node:async_hooks';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const ADV = f('worker/advisor.js');
const WORKER = f('worker/index.js');
const SITE = f('public/css/site.css');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const grab = (src, re) => (src.match(re) || [''])[0];

// ---- lifts ----
const modelLine = grab(ADV, /const MODEL = '[^']+';/);
const selfModelLine = grab(ADV, /const SELF_MODEL = '[^']+';/);
const selfEffortLine = grab(ADV, /const SELF_EFFORT = '[^']+';/);
const storeLine = grab(ADV, /const turnPolicy = new AsyncLocalStorage\(\);/);
const withPolicy = lift(ADV, 'export async function withCasePolicy(env, kind, id, fn) {');
const selfBlockFn = lift(ADV, 'function selfBlock() {');
const refusedFn = lift(ADV, 'function modelRefused(err, turn) {');
const fallbackFn = lift(ADV, 'async function sendWithFallback(env, turn, send) {');
const turnReqFn = lift(ADV, 'function turnRequest({ system, messages, effort, maxTokens = 64000, tools }) {');
const todayFn = lift(ADV, 'function todayBlock() {');
const econNoteFn = lift(ADV, 'function economicsNote(econ) {');

// NEGATIVE CONTROL (run 2026-09-03): renaming sendWithFallback in the advisor made this read
//   FAIL  S1 the policy, the block, the fallback and the request builder lift out of the shipped advisor  -- sendWithFallback
check('S1 the policy, the block, the fallback and the request builder lift out of the shipped advisor',
  !!modelLine && !!selfModelLine && !!selfEffortLine && !!storeLine && !!withPolicy && !!selfBlockFn
  && !!refusedFn && !!fallbackFn && !!turnReqFn && !!todayFn && !!econNoteFn,
  [!modelLine && 'MODEL', !selfModelLine && 'SELF_MODEL', !selfEffortLine && 'SELF_EFFORT', !storeLine && 'turnPolicy',
    !withPolicy && 'withCasePolicy', !selfBlockFn && 'selfBlock', !refusedFn && 'modelRefused',
    !fallbackFn && 'sendWithFallback', !turnReqFn && 'turnRequest', !todayFn && 'todayBlock', !econNoteFn && 'economicsNote']
    .filter(Boolean).join(', '));

const harness = () => {
  const diag = [];
  const store = new Map();
  const deps = {
    AsyncLocalStorage,
    getDoc: async (env, path) => (store.has(path) ? { id: path.split('/').pop(), data: store.get(path) } : null),
    diagLog: async (env, entry) => { diag.push(entry); },
    withCacheBp: (blocks) => blocks,
  };
  // eslint-disable-next-line no-new-func
  const api = new Function('deps', `
    const { AsyncLocalStorage, getDoc, diagLog, withCacheBp } = deps;
    ${modelLine}
    ${selfModelLine}
    ${selfEffortLine}
    ${storeLine}
    ${withPolicy.replace('export async function', 'async function')}
    ${selfBlockFn}
    ${refusedFn}
    ${fallbackFn}
    ${todayFn}
    ${turnReqFn}
    ${econNoteFn}
    return { withCasePolicy, turnRequest, sendWithFallback, economicsNote, MODEL, SELF_MODEL, SELF_EFFORT };
  `)(deps);
  return { api, diag, store };
};

const H = harness();
H.store.set('cases/mine', { self: true, clientName: 'Eric Bleach' });
H.store.set('cases/theirs', { clientName: 'Dana Reyes' });
const build = () => H.api.turnRequest({ system: 'SYS', messages: [], effort: 'medium', maxTokens: 1000 });
const plain = build();
const mine = await H.api.withCasePolicy({}, 'case', 'mine', async () => build());
const theirs = await H.api.withCasePolicy({}, 'case', 'theirs', async () => build());
const sub = await H.api.withCasePolicy({}, 'sub', 'mine', async () => build());
// NEGATIVE CONTROL (run 2026-09-03): turnRequest reading `policy?.effort ?? 'medium'` with the policy's effort dropped made this read
//   FAIL  S2 on his own case every turn is the stronger model at high, with the block that says so last
check('S2 on his own case every turn is the stronger model at high, with the block that says so last',
  mine.model === H.api.SELF_MODEL && mine.output_config.effort === 'high'
  && mine.system[mine.system.length - 1].text.startsWith('HIS OWN CASE.')
  && /he is the advocate reading you AND the patient/.test(mine.system[mine.system.length - 1].text)
  && /Money, hours and rates play no part/.test(mine.system[mine.system.length - 1].text),
  `${mine.model} ${mine.output_config.effort} last block: ${mine.system[mine.system.length - 1].text.slice(0, 40)}`);
// NEGATIVE CONTROL (run 2026-09-03): withCasePolicy building a policy for every case (the `self` test dropped) made this read
//   FAIL  S3 every other case, a subscription, and a turn outside any run keep the default model and their own effort, with no block
check('S3 every other case, a subscription, and a turn outside any run keep the default model and their own effort, with no block',
  [plain, theirs, sub].every((t) => t.model === H.api.MODEL && t.output_config.effort === 'medium'
    && !t.system.some((b) => /HIS OWN CASE/.test(b.text))),
  [plain, theirs, sub].map((t) => `${t.model}/${t.output_config.effort}/${t.system.length}`).join(' '));
// The policy follows the run through an await, which is the whole reason it
// is a store and not an argument.
const late = await H.api.withCasePolicy({}, 'case', 'mine', async () => {
  await new Promise((r) => setTimeout(r, 5));
  return build();
});
check('S4 the policy follows the run across an await', late.model === H.api.SELF_MODEL);

// ---- the fallback ----
const refused = Object.assign(new Error('model: claude-fable-5-1 is not a valid model'), { status: 404 });
const sends = [];
// Caught, not awaited bare: a fallback that rethrows the refusal is this
// check's FAIL, not the suite's crash.
let out = null;
try {
  out = await H.api.withCasePolicy({}, 'case', 'mine', async () => H.api.sendWithFallback({}, build(), async (t) => {
    sends.push(t.model);
    if (t.model === H.api.SELF_MODEL) throw refused;
    return 'carried';
  }));
} catch (e) { out = e; }
// NEGATIVE CONTROL (run 2026-09-03): modelRefused answering false for a 404 made this read
//   FAIL  S5 a refused stronger model is noted once in the diag log and the same turn is carried on the default
check('S5 a refused stronger model is noted once in the diag log and the same turn is carried on the default',
  out === 'carried' && sends.join(',') === `${H.api.SELF_MODEL},${H.api.MODEL}`
  && H.diag.length === 1 && H.diag[0].ev === 'self-model-fallback' && H.diag[0].id === 'mine',
  `${sends.join(',')} diag ${JSON.stringify(H.diag)}`);
const other = Object.assign(new Error('overloaded'), { status: 529 });
let thrown = null;
try {
  await H.api.withCasePolicy({}, 'case', 'mine', async () => H.api.sendWithFallback({}, build(), async () => { throw other; }));
} catch (e) { thrown = e; }
let thrownDefault = null;
try {
  await H.api.sendWithFallback({}, build(), async () => { throw refused; });
} catch (e) { thrownDefault = e; }
check('S6 any other error, and a refusal of the default model itself, are thrown untouched',
  thrown === other && thrownDefault === refused && H.diag.length === 1);

// ---- the economics ----
check('S7 his own case has no economics block, and the loader says so before it reads a rate',
  H.api.economicsNote({ self: true, paidCents: 0, seconds: 7200 }) === ''
  && /if \(c\.self\) return \{ self: true, paidCents: 0, tipCents: 0, seconds: 0 \};/.test(ADV));

// ---- the wrap sites, pinned ----
const drain = ADV.slice(ADV.indexOf('export async function runQueuedAnalyses(env'), ADV.indexOf('export async function requeueStranded(env') > 0
  ? ADV.length : ADV.length);
// NEGATIVE CONTROL (run 2026-09-03): the appeal rescue in the drain unwrapped made this read
//   FAIL  S8 every run the cron drain starts, and the analysis it re-runs, enter under the policy
check('S8 every run the cron drain starts, and the analysis it re-runs, enter under the policy',
  /withCasePolicy\(env, kind, id, \(\) => runAppeal\(/.test(drain)
  && /withCasePolicy\(env, kind, id, \(\) => runCallNotes\(/.test(drain)
  && /withCasePolicy\(env, kind, id, \(\) => runCallDoc\(/.test(drain)
  && /withCasePolicy\(env, kind, id, \(\) => runDraft\(/.test(drain)
  && /withCasePolicy\(env, kind, id, \(\) => runAnalysis\(/.test(drain));
// NEGATIVE CONTROL (run 2026-09-03): the advisor route calling handleAdvisorAction directly made this read
//   FAIL  S9 the advisor route and the day summary enter under the policy too
check('S9 the advisor route and the day summary enter under the policy too',
  /return withCasePolicy\(env, kind, id, \(\) => handleAdvisorAction\(\{/.test(WORKER)
  && /const out = await withCasePolicy\(env, kind, id, \(\) => runDaySummary\(env, kind, id, day\)\);/.test(WORKER)
  && /withCasePolicy,/.test(grab(WORKER, /import \{[\s\S]*?\} from '\.\/advisor\.js';/)));
check('S10 the analysis pass pins its effort from the policy, so the diagnostics tell the truth',
  /const passEffort = turnPolicy\.getStore\(\)\?\.effort \|\| \(!auto \? effort/.test(ADV));
check('S11 the ping can ask the stronger model by name, from the route',
  /export async function pingModel\(env, which = 'default'\)/.test(ADV)
  && /model: which === 'self' \? SELF_MODEL : MODEL, max_tokens: 1,/.test(ADV)
  && /pingModel\(env, body\?\.which === 'self' \? 'self' : 'default'\)/.test(WORKER));

// ---- the purple ----
const schemes = [/:root \{[\s\S]*?\n\}/, /:root\[data-scheme="calm"\] \{[\s\S]*?\n\}/, /:root\[data-scheme="paper"\] \{[\s\S]*?\n\}/, /:root\[data-scheme="contrast"\] \{[\s\S]*?\n\}/];
// NEGATIVE CONTROL (run 2026-09-03): --self removed from the paper scheme made this read
//   FAIL  S12 the one purple is a token in all four schemes, so his case reads purple in every look
check('S12 the one purple is a token in all four schemes, so his case reads purple in every look',
  schemes.every((re) => /--self: #[0-9A-Fa-f]{6};/.test(grab(SITE, re))),
  schemes.map((re, i) => (/--self:/.test(grab(SITE, re)) ? '' : `scheme ${i} missing`)).filter(Boolean).join(', '));

// ---- the route, running ----
const routeSrc = lift(WORKER, 'async function handleSelfCase(request, env) {');
const runRoute = ({ admin = true, profile = { name: 'Eric Bleach', role: 'admin' }, cases = {} } = {}) => {
  const written = [];
  const store = new Map(Object.entries(cases).map(([id, d]) => [`cases/${id}`, d]));
  if (profile) store.set('users/eric', profile);
  const deps = {
    requireAdmin: async () => (admin ? { uid: 'eric' } : null),
    json: (obj, code = 200) => ({ code, obj }),
    getDoc: async (env, path) => (store.has(path) ? { id: path.split('/').pop(), data: store.get(path) } : null),
    patchDoc: async (env, path, data, opts) => { written.push({ path, data, opts }); store.set(path, { ...(store.get(path) || {}), ...data }); return true; },
    crypto: { randomUUID: () => 'mine-1' },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('deps', `const { requireAdmin, json, getDoc, patchDoc, crypto } = deps; ${routeSrc} return handleSelfCase;`)(deps);
  return { post: () => fn({}, {}), written };
};
const R1 = runRoute();
const made = await R1.post();
const doc = R1.written.find((w) => w.path === 'cases/mine-1');
// NEGATIVE CONTROL (run 2026-09-03): the route writing `clientUid: admin.uid` made this read
//   FAIL  S13 the route makes one case shaped like every other, with self on and nobody on the other end
check('S13 the route makes one case shaped like every other, with self on and nobody on the other end',
  !!routeSrc && made.code === 200 && made.obj.ok === true && made.obj.id === 'mine-1' && made.obj.created === true
  && !!doc && doc.data.self === true && doc.data.clientUid === null && doc.data.clientEmail === null
  && doc.data.clientName === 'Eric Bleach' && doc.data.status === 'confirmed' && doc.data.fullAccess === true
  && doc.data.appointment === null && doc.data.reportDueAt === null && doc.data.caseRateCents === 0
  && doc.data.stripe === null && doc.opts?.mustNotExist === true
  && !!doc.data.bookingEmailSentAt
  && R1.written.some((w) => w.path === 'users/eric' && w.data.selfCaseId === 'mine-1'),
  JSON.stringify(doc?.data || made).slice(0, 200));
const R2 = runRoute({ profile: { name: 'Eric Bleach', role: 'admin', selfCaseId: 'mine-0' }, cases: { 'mine-0': { self: true, status: 'confirmed' } } });
const again = await R2.post();
// NEGATIVE CONTROL (run 2026-09-03): the existing-case look-up removed made this read
//   FAIL  S14 a second call opens the same case and writes nothing; a closed one is left closed and a new one made
const R3 = runRoute({ profile: { name: 'Eric Bleach', role: 'admin', selfCaseId: 'mine-0' }, cases: { 'mine-0': { self: true, status: 'closed' } } });
const afterClose = await R3.post();
check('S14 a second call opens the same case and writes nothing; a closed one is left closed and a new one made',
  again.code === 200 && again.obj.id === 'mine-0' && again.obj.created === false && R2.written.length === 0
  && afterClose.obj.id === 'mine-1' && afterClose.obj.created === true,
  `${JSON.stringify(again.obj)} then ${JSON.stringify(afterClose.obj)}`);
const R4 = runRoute({ admin: false });
// NEGATIVE CONTROL (run 2026-09-03): the admin refusal neutered (`if (!admin && false)`) made this read
//   FAIL  S15 a stranger gets the site's 404 and nothing is written  -- threw: Cannot read properties of null (reading 'uid')
let stranger = null;
try { stranger = await R4.post(); } catch (e) { stranger = { code: 500, obj: { threw: e.message } }; }
check('S15 a stranger gets the site\'s 404 and nothing is written', stranger.code === 404 && R4.written.length === 0,
  stranger.obj?.threw ? `threw: ${stranger.obj.threw}` : `${stranger.code}`);
// NEGATIVE CONTROL (run 2026-09-03): the route's line removed from the header table made this read
//   FAIL  S16 the route is registered under the admin prefix and named in the header table
check('S16 the route is registered under the admin prefix and named in the header table',
  /url\.pathname === '\/api\/admin\/self-case' && request\.method === 'POST'\)\n\s+return await handleSelfCase\(request, env\);/.test(WORKER)
  && /^\/\/   POST   \/api\/admin\/self-case\s+his own case/m.test(WORKER));

// ---- the guards, pinned where a client would otherwise be told or counted ----
const guards = [
  ['the chat notice', /if \(doc\.data\.self\) return json\(\{ ok: true, self: true \}\);\n\s+clientUid = doc\.data\.clientUid;/],
  ['the chat digest', /if \(row\.data\.self\) \{\n\s+await patchDoc\(env, `\$\{coll\}\/\$\{row\.id\}`, \{ lastMessage: \{ \.\.\.lm, emailed: true \} \}/],
  ['the work log notice', /if \(!c \|\| !c\.clientUid \|\| c\.self \|\| c\.status === 'closed'\) return null;/],
  ['the recording clock', /if \(doc\.data\.self\) return json\(\{ ok: true, self: true \}\);\n\s+const alreadyStarted = !!doc\.data\.reportDueAt;/],
  ['the document push', /if \(doc\.data\.clientUid && !doc\.data\.self\) \{/],
  ['the delivered state', /if \(doc\.data\.self\) return json\(\{ ok: true, self: true \}\);\n\s+await patchDoc\(env, `cases\/\$\{caseId\}`, \{ status: 'delivered'/],
  ['the included hours', /if \(!c\?\.fullAccess \|\| c\.self \|\| c\.status === 'closed' \|\| c\.work\?\.includedDoneAt\) return;/],
  ['the delivered-case sweep', /if \(onHold\(row\.data\)\) continue;\n[^\n]*\n\s+if \(row\.data\.self\) continue;/],
  ['the chat-open notice', /if \(c\.chatOpenNotified \|\| c\.chatUnlocked \|\| c\.self\) continue;/],
  ['the missing-email repair', /if \(!c\.clientUid \|\| c\.self\) continue;/],
  ['the scheduler', /if \(c\.self\) return json\(\{ error: 'Your own case has nobody on the other end to book with\.' \}, 409\);/],
  ['the capacity, both paths', /\]\, 200\)\)\.filter\(\(r\) => !r\.data\.self\);[\s\S]{0,200}r\.data\.status !== 'closed' && !r\.data\.self\)/],
  ['the ledger', /const c = r\.data;\n[^\n]*\n[^\n]*\n\s+if \(c\.self\) continue;\n\s+const key = c\.clientUid \|\| r\.id;/],
  ['the public stats', /const c = r\.data;\n[^\n]*\n[^\n]*\n\s+if \(c\.self\) continue;\n\s+const periods = holdPeriodsOf\(c, now\);/],
];
// NEGATIVE CONTROL (run 2026-09-03): the ledger's skip removed made this read
//   FAIL  S17 every place a client would be told or counted checks the flag  -- the ledger
check('S17 every place a client would be told or counted checks the flag',
  guards.every(([, re]) => re.test(WORKER)),
  guards.filter(([, re]) => !re.test(WORKER)).map(([n]) => n).join(', '));

// ---- the purple and the page, pinned ----
const ADMIN = f('public/js/admin.js');
const CASE = f('public/js/admin-case.js');
const DRAWER = f('public/js/drawer.js');
const ACSS = f('public/css/admin.css');
const DEMO = f('public/js/demo/api.js');
// NEGATIVE CONTROL (run 2026-09-03): the dashboard's `mine` shelf filter dropped made this read
//   FAIL  S18 the shelf: his case on its own purple shelf, out of the three and out of the revenue line, or the purple button that opens one
check('S18 the shelf: his case on its own purple shelf, out of the three and out of the revenue line, or the purple button that opens one',
  /const mine = cases\.filter\(\(c\) => c\.self && c\.status !== 'closed'\);/.test(ADMIN)
  && /const billed = cases\.filter\(\(c\) => !c\.self\);/.test(ADMIN)
  && /const former = billed\.filter/.test(ADMIN) && /const current = billed\.filter/.test(ADMIN)
  && /billed\.reduce\(/.test(ADMIN) && /\$\{billed\.length\} case/.test(ADMIN)
  && /section\('MY OWN CASE', 'var\(--self\)'/.test(ADMIN)
  && /data-self-open>Open a case for myself</.test(ADMIN)
  && /fetch\('\/api\/admin\/self-case'/.test(ADMIN)
  && /if \(c\.self\) return 'MY OWN CASE';/.test(ADMIN)
  && /if \(c\.self \|\| c\.status !== 'awaiting_report'/.test(ADMIN)
  && /if \(!c\?\.fullAccess \|\| c\.self \|\| c\.status === 'closed' \|\| c\.hold\?\.pausedAt\) return false;/.test(ADMIN)
  && /self: !!c\.self,/.test(ADMIN)
  && /\$\{self \? ' self' : ''\}/.test(DRAWER));
// NEGATIVE CONTROL (run 2026-09-03): the masthead pill's self branch removed made this read
//   FAIL  S19 the page: a purple masthead, an overview built for him, no message makers, records into the intake folders, no check-in nag
check('S19 the page: a purple masthead, an overview built for him, no message makers, records into the intake folders, no check-in nag',
  /head\.className = `case-head\$\{c\.self \? ' self' : ''\}`;/.test(CASE)
  && /data-status>\$\{c\.self \? 'MY OWN CASE' : /.test(CASE)
  && /pill\.textContent = c\.self \? 'MY OWN CASE' : /.test(CASE)
  && /if \(c\.self\) \{ paintSelfOverview\(pane, c\); return; \}/.test(CASE)
  && /data-self-note>Nobody is on the other end\./.test(CASE)
  && /composerButton: data\.self \? \[\] : \[\{/.test(CASE)
  && /const own = typeof data === 'object' && data !== null && !!data\.self;\n\s+const folder = own && kind !== 'recording' \? 'uploads' : kind;/.test(CASE)
  && /if \(own\) \{\n\s+\/\/ Nobody to tell[\s\S]{0,400}fetch\('\/api\/uploaded'/.test(CASE)
  && /<h3>\$\{data\.self \? 'Your notes' : 'Chat with the client'\}<\/h3>/.test(CASE)
  && /if \(rateEl && live\.self\) rateEl\.hidden = true;/.test(CASE)
  && /if \(typeof data === 'object' && data && data\.self\) \{ row\.hidden = true; return; \}/.test(CASE)
  && /if \(!c\?\.fullAccess \|\| c\.self \|\| c\.status === 'closed'\) return null;/.test(CASE)
  && /\.folder\.self \{/.test(ACSS) && /\.status-pill\.self \{/.test(ACSS) && /\.case-head\.self \.case-name \{ color: var\(--self\); \}/.test(ACSS)
  && /\.btn\.self-open \{/.test(ACSS));
check('S20 the demo mirrors the route, one per admin, the same shape',
  /path === '\/api\/admin\/self-case'/.test(DEMO) && /const key = 'cases\/demo-case-mine';/.test(DEMO)
  && /self: true,\n\s+clientUid: null,\n\s+clientEmail: null,/.test(DEMO));
const copy = [
  grab(CASE, /function paintSelfOverview\(pane, c\) \{[\s\S]*?\n\}/),
  grab(ADMIN, /const selfBlock = mine\.length[\s\S]*?<\/p>`;/),
  grab(CHANGELOG_SRC(), /version: '2\.81',[\s\S]*?\n  \},/),
  selfBlockFn,
  routeSrc,
];
function CHANGELOG_SRC() { return f('public/js/changelog.js'); }
check('S21 not one em or en dash in anything new, and the client list of the entry is empty',
  copy.every((s) => s && !/[–—]/.test(s))
  && /version: '2\.81',\n\s+quiet: true,\n\s+client: \[\],/.test(CHANGELOG_SRC()),
  copy.map((s, i) => (s ? (/[–—]/.test(s) ? `slice ${i} has a dash` : '') : `slice ${i} empty`)).filter(Boolean).join(', '));

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
