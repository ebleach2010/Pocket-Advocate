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
import { readFileSync, readdirSync } from 'node:fs';
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

// ---- the routes, running ----
const routeSrc = lift(WORKER, 'async function handleSelfCase(request, env) {');
// The details go through the booking cleaners (contact.mjs runs those on
// their own); here they ride along so the routes can be driven whole.
const phoneRe = grab(WORKER, /const PHONE_RE = \/[^\n]*\/;/);
const cleanPhoneSrc = grab(WORKER, /const cleanPhone = \(v\) => \([\s\S]*?: ''\);/);
const cleanAddressSrc = grab(WORKER, /const cleanAddress = \(v\) => \([\s\S]*?: ''\);/);
const personSrc = lift(WORKER, 'function personFields(body, fallback = {}) {');
const familySrc = lift(WORKER, 'async function handleFamilyCase(request, env) {');
const claimSrc = lift(WORKER, 'async function claimFamilyCases(env, uid, email) {');
const runRoute = ({ admin = true, profile = { name: 'Eric Bleach', role: 'admin' }, cases = {}, body = {}, users = {} } = {}) => {
  const written = [];
  const mails = [];
  const store = new Map(Object.entries(cases).map(([id, d]) => [`cases/${id}`, d]));
  if (profile) store.set('users/eric', profile);
  const deps = {
    requireAdmin: async () => (admin ? { uid: 'eric' } : null),
    json: (obj, code = 200) => ({ code, obj }),
    getDoc: async (env, path) => (store.has(path) ? { id: path.split('/').pop(), data: store.get(path) } : null),
    patchDoc: async (env, path, data, opts) => { written.push({ path, data, opts }); store.set(path, { ...(store.get(path) || {}), ...data }); return true; },
    queryDocs: async (env, coll, filters) => [...store.entries()]
      .filter(([p, d]) => p.startsWith(`${coll}/`) && d[filters[0][0]] === filters[0][2])
      .map(([p, d]) => ({ id: p.split('/').pop(), data: d })),
    lookupUidByEmail: async (env, email) => users[email] || null,
    sendEmail: async (env, m) => { mails.push(m); },
    escHtml: (s) => String(s),
    firstName: (v) => String(v || '').trim().split(' ')[0],
    crypto: { randomUUID: () => 'mine-1' },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('deps', `
    const { requireAdmin, json, getDoc, patchDoc, queryDocs, lookupUidByEmail, sendEmail, escHtml, firstName, crypto } = deps;
    ${phoneRe}
    ${cleanPhoneSrc}
    ${cleanAddressSrc}
    ${personSrc}
    ${routeSrc}
    ${familySrc}
    ${claimSrc}
    return { handleSelfCase, handleFamilyCase, claimFamilyCases };
  `)(deps);
  const req = { json: async () => body };
  return {
    post: () => fn.handleSelfCase(req, {}),
    family: () => fn.handleFamilyCase(req, {}),
    claim: (uid, email) => fn.claimFamilyCases({}, uid, email),
    written, mails, store,
  };
};
const R1 = runRoute({ body: { firstName: ' Eric ', lastName: 'Bleach', dob: '1985-02-03', phone: '+1 208 555 0100', address: ' 12 Elm St, Boise, ID 83702 ' } });
const made = await R1.post();
const doc = R1.written.find((w) => w.path === 'cases/mine-1');
// NEGATIVE CONTROL (run 2026-09-03): the route writing `clientUid: admin.uid` made this read
//   FAIL  S13 the route makes one case shaped like every other, with self on, nobody on the other end, and the details he typed
check('S13 the route makes one case shaped like every other, with self on, nobody on the other end, and the details he typed',
  !!routeSrc && !!personSrc && made.code === 200 && made.obj.ok === true && made.obj.id === 'mine-1' && made.obj.created === true
  && !!doc && doc.data.self === true && doc.data.clientUid === null && doc.data.clientEmail === null
  && doc.data.clientName === 'Eric Bleach' && doc.data.clientDob === '1985-02-03'
  && doc.data.clientPhone === '+1 208 555 0100' && doc.data.clientAddress === '12 Elm St, Boise, ID 83702'
  && doc.data.status === 'confirmed' && doc.data.fullAccess === true
  && doc.data.appointment === null && doc.data.reportDueAt === null && doc.data.caseRateCents === 0
  && doc.data.stripe === null && doc.opts?.mustNotExist === true
  && !!doc.data.bookingEmailSentAt
  && R1.written.some((w) => w.path === 'users/eric' && w.data.selfCaseId === 'mine-1'),
  JSON.stringify(doc?.data || made).slice(0, 220));
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
  // Re-pinned 2026-09-03 (oriented to him): the self branch wakes the read
  // before it returns, and still tells and stamps nobody.
  ['the chat notice', /if \(doc\.data\.self\) \{\n\s+refreshAdvisor\(env, ctx, kind, id\);\n\s+return json\(\{ ok: true, self: true \}\);\n\s+\}/],
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
  && /const shelved = cases\.filter\(\(c\) => !c\.self\);/.test(ADMIN)
  && /const billed = shelved\.filter\(\(c\) => !c\.family\);/.test(ADMIN)
  && /const former = shelved\.filter/.test(ADMIN) && /const current = shelved\.filter/.test(ADMIN)
  && /billed\.reduce\(/.test(ADMIN) && /\$\{billed\.length\} case/.test(ADMIN)
  && /section\('MY OWN CASE', 'var\(--self\)'/.test(ADMIN)
  && /data-open-door="self">Open a case for myself</.test(ADMIN)
  && /which === 'family' \? '\/api\/admin\/family-case' : '\/api\/admin\/self-case'/.test(ADMIN)
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
  && /const noMoney = !!\(live\.self \|\| live\.family\);\n\s+if \(rateEl && noMoney\) rateEl\.hidden = true;/.test(CASE)
  && /if \(typeof data === 'object' && data && data\.self\) \{ row\.hidden = true; return; \}/.test(CASE)
  && /if \(!c\?\.fullAccess \|\| c\.self \|\| c\.status === 'closed'\) return null;/.test(CASE)
  && /\.folder\.self \{/.test(ACSS) && /\.status-pill\.self \{/.test(ACSS) && /\.case-head\.self \.case-name \{ color: var\(--self\); \}/.test(ACSS)
  && /\.btn\.self-open \{/.test(ACSS));
check('S20 the demo mirrors the route, one per admin, the same shape',
  /path === '\/api\/admin\/self-case'/.test(DEMO) && /const key = 'cases\/demo-case-mine';/.test(DEMO)
  && /self: true,\n\s+clientUid: null,\n\s+clientEmail: null,/.test(DEMO));
const copy = [
  grab(CASE, /function paintSelfOverview\(pane, c\) \{[\s\S]*?\n\}/),
  grab(ADMIN, /const person = \(p, withEmail\) => `[\s\S]*?<\/div>`;/),
  grab(CHANGELOG_SRC(), /version: '2\.81',[\s\S]*?\n  \},/),
  grab(CHANGELOG_SRC(), /version: '2\.82',[\s\S]*?\n  \},/),
  selfBlockFn,
  routeSrc,
  personSrc,
  familySrc,
  claimSrc,
];
function CHANGELOG_SRC() { return f('public/js/changelog.js'); }
check('S21 not one em or en dash in anything new, and the client list of the entry is empty',
  copy.every((s) => s && !/[–—]/.test(s))
  && /version: '2\.81',\n\s+quiet: true,\n\s+client: \[\],/.test(CHANGELOG_SRC()),
  copy.map((s, i) => (s ? (/[–—]/.test(s) ? `slice ${i} has a dash` : '') : `slice ${i} empty`)).filter(Boolean).join(', '));

// ---- his details, and the family case (Eric, 2026-09-03, later the same day) ----
const R5 = runRoute({ body: {} });
const blank = await R5.post();
const blankDoc = R5.written.find((w) => w.path === 'cases/mine-1');
const R6 = runRoute({ body: { firstName: 'Eric', dob: '02/03/1985' } });
const badDob = await R6.post();
const R7 = runRoute({ body: { firstName: 'Eric', phone: 'call me' } });
const badPhone = await R7.post();
// NEGATIVE CONTROL (run 2026-09-03): the date-of-birth rule in personFields neutered (`if (false) return`) made this read
//   FAIL  S22 a blank form falls back to the profile's name; a date of birth or a phone that is not one is refused with nothing written
check('S22 a blank form falls back to the profile\'s name; a date of birth or a phone that is not one is refused with nothing written',
  blank.code === 200 && blankDoc?.data.clientName === 'Eric Bleach' && blankDoc?.data.clientDob === null
  && badDob.code === 400 && R6.written.length === 0 && badPhone.code === 400 && R7.written.length === 0,
  `${blank.code}/${blankDoc?.data.clientName} ${badDob.code} ${badPhone.code}`);

const F1 = runRoute({ body: { firstName: 'Ann', lastName: 'Bleach', email: ' Ann@Example.com ', relation: 'my mother', dob: '1950-01-02', phone: '208 555 0199', address: '9 Oak St, Boise, ID 83702' } });
const fam = await F1.family();
const famDoc = F1.written.find((w) => w.path === 'cases/mine-1');
// NEGATIVE CONTROL (run 2026-09-03): the family route writing `caseRateCents: 120000` made this read
//   FAIL  S23 a family case is an ordinary case, free, chat open from the first day, the typed email lowercased as the login, one email to them and none elsewhere
check('S23 a family case is an ordinary case, free, chat open from the first day, the typed email lowercased as the login, one email to them and none elsewhere',
  !!familySrc && fam.code === 200 && fam.obj.ok === true && fam.obj.id === 'mine-1' && fam.obj.claimed === false
  && !!famDoc && famDoc.data.family === true && famDoc.data.familyRelation === 'my mother'
  && famDoc.data.clientUid === null && famDoc.data.clientEmail === 'ann@example.com'
  && famDoc.data.clientName === 'Ann Bleach' && famDoc.data.clientDob === '1950-01-02'
  && famDoc.data.clientPhone === '208 555 0199' && famDoc.data.clientAddress === '9 Oak St, Boise, ID 83702'
  && famDoc.data.self !== true && famDoc.data.status === 'confirmed' && famDoc.data.appointment === null
  && famDoc.data.caseRateCents === 0 && famDoc.data.addonRateCents === 0 && famDoc.data.stripe === null
  && famDoc.data.fullAccess === false && famDoc.data.chatUnlocked === true && famDoc.data.chatOpenNotified === true
  && !!famDoc.data.bookingEmailSentAt && famDoc.opts?.mustNotExist === true
  && F1.mails.length === 1 && F1.mails[0].to === 'ann@example.com'
  && /signin\.html/.test(F1.mails[0].html) && /no charge/.test(F1.mails[0].html) && /Hi Ann/.test(F1.mails[0].html)
  && !F1.written.some((w) => w.path.startsWith('users/')),
  JSON.stringify(famDoc?.data || fam).slice(0, 220));
const F2 = runRoute({ body: { firstName: 'Ann', lastName: 'Bleach', email: 'ann@example.com' }, users: { 'ann@example.com': 'u-ann' } });
const famKnown = await F2.family();
const F3 = runRoute({ body: { firstName: 'Ann', lastName: 'Bleach', email: 'not an email' } });
const famBad = await F3.family();
const F4 = runRoute({ admin: false, body: { firstName: 'Ann', lastName: 'Bleach', email: 'ann@example.com' } });
let famStranger = null;
try { famStranger = await F4.family(); } catch (e) { famStranger = { code: 500, obj: { threw: e.message } }; }
// NEGATIVE CONTROL (run 2026-09-03): the account look-up replaced with `const uid = null` made this read
//   FAIL  S24 an address that already has an account gets the case at once; a bad address and a stranger write nothing  -- 200/false 400 404
check('S24 an address that already has an account gets the case at once; a bad address and a stranger write nothing',
  famKnown.code === 200 && famKnown.obj.claimed === true
  && F2.written.find((w) => w.path === 'cases/mine-1')?.data.clientUid === 'u-ann'
  && famBad.code === 400 && F3.written.length === 0 && F3.mails.length === 0
  && famStranger.code === 404 && F4.written.length === 0,
  `${famKnown.code}/${famKnown.obj.claimed} ${famBad.code} ${famStranger.code}`);

const C1 = runRoute({ cases: {
  waiting: { family: true, clientEmail: 'ann@example.com', clientUid: null },
  taken: { family: true, clientEmail: 'ann@example.com', clientUid: 'other' },
  notfamily: { clientEmail: 'ann@example.com', clientUid: null },
  elsewhere: { family: true, clientEmail: 'bob@example.com', clientUid: null },
} });
const claimed = await C1.claim('u-ann', 'ann@example.com');
// NEGATIVE CONTROL (run 2026-09-03): the claim dropping its family test (`if (r.data.clientUid) continue;`) made this read
//   FAIL  S25 the first sign-in with that address takes only the family case still waiting, and the code step calls it
check('S25 the first sign-in with that address takes only the family case still waiting, and the code step calls it',
  !!claimSrc && claimed === 1
  && C1.written.length === 1 && C1.written[0].path === 'cases/waiting' && C1.written[0].data.clientUid === 'u-ann'
  && (C1.written[0].opts?.mask || []).join(',') === 'clientUid'
  && /await patchDoc\(env, `users\/\$\{uid\}`, \{ email \}, \{ mask: \['email'\] \}\);\n[^\n]*\n\s+await claimFamilyCases\(env, uid, email\)\.catch\(\(\) => \{\}\);/.test(WORKER)
  && /url\.pathname === '\/api\/admin\/family-case' && request\.method === 'POST'\)\n\s+return await handleFamilyCase\(request, env\);/.test(WORKER),
  `${claimed} claimed, wrote ${C1.written.map((w) => w.path).join(',')}`);

const CLIENT = f('public/js/case.js');
// NEGATIVE CONTROL (run 2026-09-03): the family door renamed to `data-open-door="fam"` made this read
//   FAIL  S26 both doors and their forms are on the shelf, the family flag rides the card and the page, their page sells nothing, and the demo mirrors it
check('S26 both doors and their forms are on the shelf, the family flag rides the card and the page, their page sells nothing, and the demo mirrors it',
  /data-open-door="family">Open a family case</.test(ADMIN)
  && ['self:firstName', 'self:lastName', 'self:dob', 'self:phone', 'self:address', 'family:email', 'family:relation'].every((k) => new RegExp(`data-of="\\$\\{p\\}:${k.split(':')[1]}"`).test(ADMIN))
  && /const person = \(p, withEmail\) => `/.test(ADMIN)
  && /FAMILY · FREE/.test(ADMIN)
  && /loops\.push\(\['family', `Family, free/.test(CASE)
  && /if \(c\.family\) \{\n\s+el\.innerHTML = `\n\s+<h2 class="case-sec-h">Case Enhancements<\/h2>\n\s+<p class="dim small"[^>]*>Nothing to buy here: this case is free\./.test(CLIENT)
  && /path === '\/api\/admin\/family-case'/.test(DEMO) && /family: true,\n\s+familyRelation:/.test(DEMO)
  && /const typed = \[body\.firstName, body\.lastName\]/.test(DEMO));

// ---- the details, editable in place (Eric, 2026-09-03, "Gg Gg") ----
const updateSrc = lift(WORKER, 'async function handleCaseUpdate(request, env) {');
const runUpdate = (caseData, body) => {
  const written = [];
  const deps = {
    requireAdmin: async () => ({ uid: 'eric' }),
    json: (obj, code = 200) => ({ code, obj }),
    getDoc: async (env, path) => (path === 'cases/c1' ? { id: 'c1', data: caseData } : null),
    patchDoc: async (env, path, data, opts) => { written.push({ path, data, opts }); return true; },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('deps', `
    const { requireAdmin, json, getDoc, patchDoc } = deps;
    ${phoneRe}
    ${cleanPhoneSrc}
    ${cleanAddressSrc}
    ${personSrc}
    ${updateSrc}
    return handleCaseUpdate;
  `)(deps);
  return { post: () => fn({ json: async () => ({ caseId: 'c1', action: 'details', ...body }) }, {}), written };
};
const D1 = runUpdate({ self: true, clientName: 'Gg Gg' }, { name: ' Eric  Bleach ', dob: '1985-02-03', phone: '+1 208 555 0100', address: '12 Elm St' });
const d1 = await D1.post();
const D2 = runUpdate({ family: true, clientName: 'Ann' }, { name: 'Ann Bleach', dob: '' });
const d2 = await D2.post();
const D3 = runUpdate({ clientUid: 'client1', clientName: 'Dana Reyes' }, { name: 'Somebody Else' });
const d3 = await D3.post();
const D4 = runUpdate({ self: true }, { name: 'Eric', dob: '02/03/1985' });
const d4 = await D4.post();
// NEGATIVE CONTROL (run 2026-09-03): the self-or-family guard on `details` removed made this read
//   FAIL  S27 the details edit rewrites the four fields on his own case and a family case, refuses a client's case, and refuses a bad date
check('S27 the details edit rewrites the four fields on his own case and a family case, refuses a client\'s case, and refuses a bad date',
  !!updateSrc && d1.code === 200 && d1.obj.ok === true
  && D1.written.length === 1 && D1.written[0].path === 'cases/c1'
  && Object.keys(D1.written[0].data).sort().join(',') === 'clientAddress,clientDob,clientName,clientPhone'
  && D1.written[0].data.clientName === 'Eric Bleach' && D1.written[0].data.clientDob === '1985-02-03'
  && D1.written[0].data.clientPhone === '+1 208 555 0100' && D1.written[0].data.clientAddress === '12 Elm St'
  && (D1.written[0].opts?.mask || []).slice().sort().join(',') === 'clientAddress,clientDob,clientName,clientPhone'
  && d2.code === 200 && D2.written[0]?.data.clientName === 'Ann Bleach' && D2.written[0]?.data.clientDob === null
  && d3.code === 409 && D3.written.length === 0
  && d4.code === 400 && D4.written.length === 0,
  `${d1.code} ${d2.code} ${d3.code} ${d4.code} ${JSON.stringify(D1.written[0]?.data)}`);
// NEGATIVE CONTROL (run 2026-09-03): the Save posting action 'contact' instead of 'details' made this read
//   FAIL  S28 the Edit sits beside his name on the overview, saves the four fields through the route, and the demo mirrors it
check('S28 the Edit sits beside his name on the overview, saves the four fields through the route, and the demo mirrors it',
  /data-self-edit aria-label="Edit the name, date of birth, phone and address"/.test(CASE)
  && ['name', 'dob', 'phone', 'address'].every((n) => new RegExp(`data-self-in="${n}"`).test(CASE))
  && /api\(\{ action: 'details', name: g\('name'\), dob: g\('dob'\), phone: g\('phone'\), address: g\('address'\) \}\)/.test(CASE)
  && /body\.action === 'details'/.test(DEMO)
  && /if \(!c\.self && !c\.family\) return fail\(409/.test(DEMO));


// ---- oriented to him: its own brief, questions in the chat, Reply (Eric, 2026-09-03) ----
const CHAT = f('public/js/chat.js');
const PANEL = f('public/js/advisor.js');
const between = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a + from.length);
  return b < 0 ? '' : src.slice(a, b);
};
const selfVoiceSrc = between(ADV, 'const SELF_VOICE = `', 'const voice = ()');
const voiceFn = grab(ADV, /const voice = \(\) => \(turnPolicy\.getStore\(\)\?\.self \? SELF_VOICE : VOICE\);/);
const selfAssessSrc = between(ADV, 'const SELF_ASSESSMENT = `', '/** Raw API errors are unreadable');
// eslint-disable-next-line no-new-func
const selfVoice = selfVoiceSrc ? new Function(`${selfVoiceSrc}; return SELF_VOICE;`)() : '';
// eslint-disable-next-line no-new-func
const selfAssess = selfAssessSrc ? new Function(`${selfAssessSrc}; return SELF_ASSESSMENT;`)() : '';
// NEGATIVE CONTROL (run 2026-09-03): the analysis site reduced to `text: `${VOICE}` made this read
//   FAIL  S29 his own case reads on its own brief and its own assessment, whole, picked by the policy where the turn is built  -- voice() x5, VOICE x1
check('S29 his own case reads on its own brief and its own assessment, whole, picked by the policy where the turn is built',
  !!selfVoiceSrc && !!voiceFn && !!selfAssessSrc
  && (ADV.match(/\$\{voice\(\)\}/g) || []).length === 5
  && (ADV.match(/\$\{VOICE\}/g) || []).length === 1
  && /system: \[\{ type: 'text', text: self \? `\$\{SELF_VOICE\}\\n\\n\$\{SELF_ASSESSMENT\}` : `\$\{VOICE\}/.test(ADV)
  && /const self = !!turnPolicy\.getStore\(\)\?\.self;/.test(ADV)
  && /style\.voice && !self \? `/.test(ADV),
  `voice() x${(ADV.match(/\$\{voice\(\)\}/g) || []).length}, VOICE x${(ADV.match(/\$\{VOICE\}/g) || []).length}`);

const HEADINGS = ['Right now', 'Plain English', 'What this could be', 'Worth investigating', 'Questions for you',
  'What we know so far', "What's missing", 'Ruled out', 'Watch for', 'Key terms', 'Working line', 'Differential',
  'Not answered', 'Corrections'];
const headingOrder = HEADINGS.map((h) => selfAssess.indexOf(`## ${h}\n`));
// NEGATIVE CONTROL (run 2026-09-03): "He answers in the chat" changed to "He answers on the panel" made this read
//   FAIL  S30 the brief is about him, forbids the advocacy chores, tells the read to ask him, and the assessment carries the questions section and the machine tail
check('S30 the brief is about him, forbids the advocacy chores, tells the read to ask him, and the assessment carries the questions section and the machine tail',
  /about Eric/.test(selfVoice) && /There is no client/.test(selfVoice) && /no faxing, no records requests/.test(selfVoice)
  && /ASK HIM/.test(selfVoice) && /He answers in the chat/.test(selfVoice)
  && !/[—–]/.test(selfVoiceSrc) && /[—]/.test(selfVoice) && /[–]/.test(selfVoice)
  && headingOrder.every((i) => i >= 0) && headingOrder.every((i, k) => k === 0 || i > headingOrder[k - 1])
  && /put to him in his chat word for word, one bubble each/.test(selfAssess)
  && /"## Not answered": on this case the app keeps this list itself/.test(selfAssess)
  && !/[—–]/.test(selfAssessSrc),
  `headings ${headingOrder.join(',')}`);

const transcriptFn = lift(ADV, 'function transcript(rows) {');
// eslint-disable-next-line no-new-func
const transcriptRun = new Function(`const mediaKind = () => true; ${transcriptFn}; return transcript;`)();
const tRows = [
  { id: 'e1', data: { role: 'admin', text: 'Day 3: tremor is back.' } },
  { id: 'q1', data: { role: 'question', text: 'What time did it start?' } },
  { id: 'a1', data: { role: 'admin', text: 'About 6am.', replyTo: 'q1' } },
  { id: 'c1', data: { role: 'client', text: 'hi' } },
];
const tOut = transcriptRun(tRows);
// NEGATIVE CONTROL (run 2026-09-03): the YOU ASKED label shortened to ASKED made this read
//   FAIL  S31 the transcript names the questions it asked and which one an answer answers  -- ERIC [id=e1]: Day 3: tremor is back. |  | ASKED [id=q1]: Wha...
check('S31 the transcript names the questions it asked and which one an answer answers',
  !!transcriptFn && tOut.includes('ERIC [id=e1]: Day 3') && tOut.includes('YOU ASKED [id=q1]: What time')
  && tOut.includes('ERIC [id=a1] (answering id=q1): About 6am.') && tOut.includes('CLIENT: hi'),
  tOut.replace(/\n/g, ' | ').slice(0, 200));

const sectionMatchFn = lift(ADV, 'function sectionMatch(text, name) {');
const flatTextLine = grab(ADV, /const flatText = \(v\) => [^\n]+;/);
const harvestQFn = lift(ADV, 'function harvestQuestions(text) {');
// eslint-disable-next-line no-new-func
const harvestQ = new Function(`${sectionMatchFn}; ${flatTextLine}; ${harvestQFn}; return harvestQuestions;`)();
const qText = '## Right now\nfine\n\n## Questions for you\n- What time did the tremor start today?\n- What time did the tremor start today?\n- none\n- How many hours did you sleep last night?\n1. Did the neurologist change the dose?\n- Any fever since Monday?\n- Fifth one that must not make it?\n\n## What we know so far\n- x';
const qOut = harvestQ(qText);
// NEGATIVE CONTROL (run 2026-09-03): the four-question cap raised to nine made this read
//   FAIL  S32 the questions section is read as at most four distinct questions, none and repeats dropped, and no section is no questions  -- ["What time d...
check('S32 the questions section is read as at most four distinct questions, none and repeats dropped, and no section is no questions',
  !!harvestQFn && qOut.length === 4 && qOut[0] === 'What time did the tremor start today?'
  && qOut[1] === 'How many hours did you sleep last night?' && qOut[2] === 'Did the neurologist change the dose?'
  && qOut[3] === 'Any fever since Monday?' && harvestQ('## Right now\nnothing').length === 0,
  JSON.stringify(qOut));

const askFn = lift(ADV, 'async function askInChat(env, id, questions, rows) {');
const askWrites = [];
// eslint-disable-next-line no-new-func
const askRun = new Function('patchDoc', `${flatTextLine}; ${askFn}; return askInChat;`)(
  async (env, path, data, opts) => { askWrites.push({ path, data, opts }); });
const standingRows = [{ id: 'q0', data: { role: 'question', text: 'What time did the tremor start today?' } }];
const askedN = await askRun({}, 'mine', ['What time did the tremor start today?', 'How many hours did you sleep last night?'], standingRows);
const chatWrites = askWrites.filter((w) => /^cases\/mine\/chat\//.test(w.path));
const shelfWrite = askWrites.find((w) => w.path === 'cases/mine');
const askedAgain = await askRun({}, 'mine', ['What time did the tremor start today?'], standingRows);
// NEGATIVE CONTROL (run 2026-09-03): the standing-question skip replaced with `if (false) continue;` made this read
//   FAIL  S33 a question goes into his chat once, as a question row nobody sent, and a standing one is not asked twice  -- 2 then 1, writes cases/mine/cha...
check('S33 a question goes into his chat once, as a question row nobody sent, and a standing one is not asked twice',
  !!askFn && askedN === 1 && chatWrites.length === 1
  && chatWrites[0].data.role === 'question' && chatWrites[0].data.from === 'reading'
  && chatWrites[0].data.text === 'How many hours did you sleep last night?'
  && !!shelfWrite && (shelfWrite.opts?.mask || []).join(',') === 'lastMessage'
  && shelfWrite.data.lastMessage.text.startsWith('❓ How many hours') && shelfWrite.data.lastMessage.emailed === true
  && askedAgain === 0 && askWrites.length === 2,
  `${askedN} then ${askedAgain}, writes ${askWrites.map((w) => w.path).join(',')}`);

const unFromChatFn = lift(ADV, 'function unansweredFromChat(rows) {');
// eslint-disable-next-line no-new-func
const unFromChat = new Function(`${unFromChatFn}; return unansweredFromChat;`)();
const unRows = [
  { id: 'q1', data: { role: 'question', text: 'Open one?', ts: new Date('2026-09-01T10:00:00Z') } },
  { id: 'q2', data: { role: 'question', text: 'Stamped one?', answeredAt: new Date() } },
  { id: 'q3', data: { role: 'question', text: 'Answered by a row?' } },
  { id: 'a3', data: { role: 'admin', text: 'yes', replyTo: 'q3' } },
];
const unOut = unFromChat(unRows);
const finishSrc = lift(ADV, 'async function finishAnalysis(env, kind, id, ctx, message) {');
// NEGATIVE CONTROL (run 2026-09-03): the finish's `ctx.self &&` dropped from the ask made this read
//   FAIL  S34 the finish knows his own case from the flight, keeps the Unanswered list from the chat, and asks the questions after the read is saved
check('S34 the finish knows his own case from the flight, keeps the Unanswered list from the chat, and asks the questions after the read is saved',
  !!unFromChatFn && unOut.length === 1 && unOut[0].ask === 'Open one?' && unOut[0].answered === false
  && /effort: passEffort, auto, skipMedia, self,/.test(ADV)
  && /if \(ctx\.self\) un\.unanswered = unansweredFromChat\(rows\);/.test(finishSrc)
  && /if \(ctx\.self && kind === 'case'\) \{\n\s+await askInChat\(env, id, harvestQuestions\(finalText\), rows\)/.test(finishSrc)
  && finishSrc.indexOf('await askInChat(') > finishSrc.indexOf("analysis: finalText, status: 'idle'"),
  JSON.stringify(unOut));

const replySrc = lift(WORKER, 'async function handleChatReply(request, env, ctx) {');
const runReply = ({ admin = { uid: 'eric' }, caseData = { self: true, status: 'confirmed' }, question = { role: 'question', text: 'What time did it start?' }, body = {} } = {}) => {
  const written = [];
  const refreshed = [];
  const deps = {
    requireAdmin: async () => admin,
    json: (obj, code = 200) => ({ code, obj }),
    getDoc: async (env, path) => (path === 'cases/c1' ? { id: 'c1', data: caseData }
      : path === 'cases/c1/chat/q1' ? (question ? { id: 'q1', data: question } : null) : null),
    patchDoc: async (env, path, data, opts) => { written.push({ path, data, opts }); return true; },
    refreshAdvisor: (env, ctx, kind, id) => { refreshed.push(`${kind}/${id}`); },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('deps', `
    const { requireAdmin, json, getDoc, patchDoc, refreshAdvisor } = deps;
    ${replySrc}
    return handleChatReply;
  `)(deps);
  const req = { json: async () => ({ kind: 'case', id: 'c1', msgId: 'q1', text: 'About 6am, right hand only.', ...body }) };
  return { post: () => fn(req, {}, {}), written, refreshed };
};
const RP1 = runReply();
const rp1 = await RP1.post();
const RP2 = runReply({ admin: null });
const rp2 = await RP2.post();
const RP3 = runReply({ caseData: { clientUid: 'client1', status: 'confirmed' } });
const rp3 = await RP3.post();
const RP4 = runReply({ question: { role: 'admin', text: 'not a question' } });
const rp4 = await RP4.post();
const RP5 = runReply({ body: { text: '' } });
const rp5 = await RP5.post();
const replyDoc = RP1.written.find((w) => /^cases\/c1\/chat\/(?!q1$)/.test(w.path));
const stamp = RP1.written.find((w) => w.path === 'cases/c1/chat/q1');
const shelf = RP1.written.find((w) => w.path === 'cases/c1');
// NEGATIVE CONTROL (run 2026-09-03): the own-case 409 in handleChatReply replaced with `if (false)` made this read
//   FAIL  S35 his answer goes through the Worker with the question on it, stamps the question, moves the shelf line, wakes the read, and refuses everyone and everything else
check('S35 his answer goes through the Worker with the question on it, stamps the question, moves the shelf line, wakes the read, and refuses everyone and everything else',
  !!replySrc && rp1.code === 200 && rp1.obj.ok === true
  && !!replyDoc && replyDoc.data.role === 'admin' && replyDoc.data.from === 'eric'
  && replyDoc.data.replyTo === 'q1' && replyDoc.data.quote === 'What time did it start?'
  && replyDoc.data.text === 'About 6am, right hand only.'
  && !!stamp && (stamp.opts?.mask || []).join(',') === 'answeredAt,answerId' && stamp.data.answerId === rp1.obj.id
  && !!shelf && (shelf.opts?.mask || []).join(',') === 'lastMessage' && shelf.data.lastMessage.emailed === true
  && RP1.refreshed.join(',') === 'case/c1'
  && rp2.code === 404 && RP2.written.length === 0
  && rp3.code === 409 && RP3.written.length === 0
  && rp4.code === 404 && RP4.written.length === 0
  && rp5.code === 400 && RP5.written.length === 0
  && /url\.pathname === '\/api\/chat\/reply' && request\.method === 'POST'\)\n\s+return await handleChatReply\(request, env, ctx\);/.test(WORKER)
  && /^\/\/   POST   \/api\/chat\/reply /m.test(WORKER),
  `${rp1.code} ${rp2.code} ${rp3.code} ${rp4.code} ${rp5.code}`);

// NEGATIVE CONTROL (run 2026-09-03): the refreshAdvisor call removed from the notify branch made this read
//   FAIL  S36 a note on his own case wakes the read the way a client message does, and still pings nobody
check('S36 a note on his own case wakes the read the way a client message does, and still pings nobody',
  /if \(doc\.data\.self\) \{\n\s+refreshAdvisor\(env, ctx, kind, id\);\n\s+return json\(\{ ok: true, self: true \}\);\n\s+\}/.test(WORKER));

// NEGATIVE CONTROL (run 2026-09-03): the Reply button's class renamed to reply-button made this read
//   FAIL  S37 the chat paints a question with a Reply, his answer with the question above it, the answer goes through the Worker, and the panel and the demo follow
check('S37 the chat paints a question with a Reply, his answer with the question above it, the answer goes through the Worker, and the panel and the demo follow',
  /const isQ = data\.role === 'question';/.test(CHAT)
  && /div\.className = `msg \$\{mine \? 'me' : 'them'\}\$\{isQ \? ' q' : ''\}`;/.test(CHAT)
  && /qt\.className = 'msg-quote';/.test(CHAT)
  && /if \(isQ\) \{[\s\S]*?if \(myRole === 'admin' && !disabled\) \{[\s\S]*?rb\.className = 'reply-btn';[\s\S]*?\} else if \(!mine \|\| editable \|\| data\.text \|\| canStage\) \{/.test(CHAT)
  && /if \(replyTo && text && !attachment && myRole === 'admin'\) \{[\s\S]*?post\('\/api\/chat\/reply',/.test(CHAT)
  && /data-reply-strip hidden/.test(CHAT) && /placeholder = 'Write a message…' \}\) \{/.test(CHAT)
  && /self: !!data\.self,/.test(CASE) && /placeholder: data\.self \? /.test(CASE)
  && /unansweredSelf = !!data\.self;/.test(CASE) && /\$\{unansweredSelf \? '' : `<button class="btn quiet" data-again=/.test(CASE)
  && /goTo = null, self = false \}\) \{/.test(PANEL)
  && /const sendable = \(title\) => !self && SENDABLE\.has\(normTitle\(title\)\);/.test(PANEL)
  && !/SENDABLE\.has\(normTitle\(pg\.title\)\)/.test(PANEL)
  && /'Questions for you': '❓',/.test(PANEL) && /'Watch for': '🚨',/.test(PANEL)
  && /path === '\/api\/chat\/reply'/.test(DEMO)
  && /if \(c\.self && !asked\) \{[\s\S]*?role: 'question'/.test(DEMO));

const cssVersions = [...new Set(readdirSync(j(ROOT, 'public')).filter((n) => /^admin.*\.html$/.test(n))
  .map((n) => (f(`public/${n}`).match(/admin\.css\?v=([a-z0-9]+)/) || [])[1] || 'none'))];
// NEGATIVE CONTROL (run 2026-09-03): .reply-strip renamed in admin.css made this read
//   FAIL  S38 the question, the quote, the Reply and the strip are styled on the admin sheet, and every admin page asks for the same new copy of it  -- st...
check('S38 the question, the quote, the Reply and the strip are styled on the admin sheet, and every admin page asks for the same new copy of it',
  /\.msg\.q \{/.test(ACSS) && /\.msg-quote \{/.test(ACSS) && /\.reply-btn \{/.test(ACSS) && /\.reply-strip \{/.test(ACSS)
  && cssVersions.length === 1 && cssVersions[0] !== 'none' && cssVersions[0] !== 'stat106',
  cssVersions.join(','));

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
