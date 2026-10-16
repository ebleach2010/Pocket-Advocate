// advocates.mjs - many advocates, and the walls between them.
//
// Eric, 2026-10-15: "We are expanding Pocket Advocate from a single-advocate
// platform into a multi-advocate platform for independent 1099 patient
// advocates." And: "Advocates must never be able to access another
// advocate's cases or data. Enforce this server-side, not just in the UI."
// And: "One advocate cannot access another advocate's data by changing IDs or
// URLs." And: "My existing account should remain the admin account and also
// become the first advocate account." And: "My existing cases should
// automatically be assigned to my account during migration."
//
// What this proves, by running the shipped code:
//   A. who counts as staff, and who sees which case (worker/staff.js, imported)
//   B. every case route that takes an advocate refuses one who is not the
//      case's, with the same 404 a stranger gets, before it reads anything
//      private or writes anything at all; lifted out of the Worker and RUN
//   C. the shared chat and file helpers ask the same question, and a client's
//      message or upload reaches that case's own advocate, nobody else's
//   D. the router: the set of routes that take an advocate is exactly the set
//      checked here, so a new one cannot slip in unchecked
//   E. the migration: Eric becomes advocate number one and everything that
//      existed is stamped his, once, without moving or overwriting anything
//   F. every place a case, invitation, slot or chat line is made says whose
//
// Run: node advocates.mjs
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const W = f('worker/index.js');
const SHOW = f('worker/showcase.js');
const STAFF = await import(pathToFileURL(j(ROOT, 'worker/staff.js')).href);
const ACTS = await import(pathToFileURL(j(ROOT, 'worker/advisor-acts.js')).href);
const DASH = new RegExp('[\\u2013\\u2014]');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
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

const ERIC = 'eric-uid';
const ENV = { ADMIN_UID: ERIC, ADMIN_EMAIL: 'eric@x.test', PUBLIC_BASE_URL: 'https://app.test' };
const A = { uid: 'adv-a', email: 'a@x.test', isAdmin: false, advocateId: 'adv-a' };
const B = { uid: 'adv-b', email: 'b@x.test', isAdmin: false, advocateId: 'adv-b' };
const ADMIN = { uid: ERIC, email: 'eric@x.test', isAdmin: true, advocateId: ERIC };

// ---- A. who is staff, and who sees what --------------------------------------
console.log('\n--- A. who is staff, and who sees what ---');
{
  const { advocateIdOf, staffFrom, staffSees, worksThread, ADVOCATE_ROLE } = STAFF;
  const prof = (role) => ({ data: { role } });
  // A working advocate is set up (2026-10-16: setup first, staff.js setupPending).
  const adv = (active) => ({ data: { active, onboardedAt: 'x' } });
  // NEGATIVE CONTROL (run 2026-10-15): advocateIdOf answering '' for a missing field made this read
  //   FAIL  A1 a case with no advocate is Eric's, never nobody's
  check('A1 a case with no advocate is Eric\'s, never nobody\'s',
    advocateIdOf({}, ENV) === ERIC && advocateIdOf(null, ENV) === ERIC && advocateIdOf({ advocateId: '  ' }, ENV) === ERIC
    && advocateIdOf({ advocateId: 'adv-a' }, ENV) === 'adv-a' && advocateIdOf({ advocateId: 7 }, ENV) === ERIC);
  const asAdmin = staffFrom(ENV, { uid: ERIC }, prof('admin'), null);
  const imposter = staffFrom(ENV, { uid: 'someone' }, prof('admin'), null);
  const live = staffFrom(ENV, { uid: 'adv-a' }, prof(ADVOCATE_ROLE), adv(true));
  const off = staffFrom(ENV, { uid: 'adv-a' }, prof(ADVOCATE_ROLE), adv(false));
  const noRecord = staffFrom(ENV, { uid: 'adv-a' }, prof(ADVOCATE_ROLE), null);
  const client = staffFrom(ENV, { uid: 'c1' }, prof('client'), adv(true));
  // NEGATIVE CONTROL (run 2026-10-15): staffFrom accepting `role === 'admin'` without the ADMIN_UID pin made this read
  //   FAIL  A2 staff is Eric (pinned to his uid) or an active advocate, and nobody else
  check('A2 staff is Eric (pinned to his uid) or an active advocate, and nobody else',
    asAdmin?.isAdmin === true && asAdmin.uid === ERIC && imposter === null
    && live?.isAdmin === false && live.uid === 'adv-a' && off === null && noRecord === null && client === null,
    JSON.stringify({ asAdmin, imposter, live, off, noRecord, client }));
  const theirs = { advocateId: 'adv-a' };
  const legacy = { clientUid: 'c9' };
  // NEGATIVE CONTROL (run 2026-10-15): staffSees answering true for any non-admin staff made this read
  //   FAIL  A3 Eric sees every case; an advocate sees their own and no one else's, his included
  check('A3 Eric sees every case; an advocate sees their own and no one else\'s, his included',
    staffSees(ADMIN, theirs, ENV) && staffSees(ADMIN, legacy, ENV)
    && staffSees(A, theirs, ENV) && !staffSees(B, theirs, ENV) && !staffSees(A, legacy, ENV)
    && !staffSees(null, theirs, ENV) && !staffSees(A, null, ENV));
  const getDoc = async (env, p) => (p === 'advocates/adv-a' ? adv(true) : p === 'advocates/adv-off' ? adv(false) : null);
  const w = await Promise.all([
    worksThread(ENV, ERIC, prof('admin'), theirs, getDoc),
    worksThread(ENV, 'adv-a', prof(ADVOCATE_ROLE), theirs, getDoc),
    worksThread(ENV, 'adv-b', prof(ADVOCATE_ROLE), theirs, getDoc),
    worksThread(ENV, 'adv-off', prof(ADVOCATE_ROLE), { advocateId: 'adv-off' }, getDoc),
    worksThread(ENV, 'adv-a', prof(ADVOCATE_ROLE), legacy, getDoc),
    worksThread(ENV, 'c1', prof('client'), theirs, getDoc),
  ]);
  // NEGATIVE CONTROL (run 2026-10-15): worksThread skipping the active check made this read
  //   FAIL  A4 on a thread, the advocate side is Eric, or that thread's own advocate while active
  check('A4 on a thread, the advocate side is Eric, or that thread\'s own advocate while active',
    JSON.stringify(w) === JSON.stringify([true, true, false, false, false, false]), JSON.stringify(w));
  // NEGATIVE CONTROL (run 2026-10-15): his sentence in the staff module's header reworded made this read
  //   FAIL  A5 the staff module carries no dash and names the rule in his words
  check('A5 the staff module carries no dash and names the rule in his words',
    !DASH.test(f('worker/staff.js')) && /Enforce this server-side, not just in the\n\/\/ UI\./.test(f('worker/staff.js')));
}

// ---- the universal harness ---------------------------------------------------
// A lifted handler runs inside `with` over a proxy: the names it is given
// below are what they are, a global is the global, and ANY other outside name
// becomes a recording stub. Every outside call is therefore seen, which is
// what lets B say "nothing was read or written" and mean all of it.
const SIDE = /^(patchDoc|deleteDoc|batchWrite|batchCreate|batchDelete|notifyUser|sendEmail|stripePost|captureHold|cancelHold|putFile|deleteFile|patchObjectMeta|listDocs|queryDocs|listFiles|raiseRates|pingAdmins|releaseSlotOfCase|bookSlot|refreshAdvisor)$/;
function runLifted(srcs, entry, { staff, store, extra = {} }) {
  const calls = [];
  const locals = new Set();
  for (const s of srcs) for (const m of s.matchAll(/^(?:async\s+)?function\s+(\w+)|^const\s+(\w+)\s*=/gm)) locals.add(m[1] || m[2]);
  const deps = {
    json: (o, s = 200) => ({ o, s }),
    requireStaff: async () => staff,
    requireAdmin: async () => (staff?.isAdmin ? staff : null),
    requireUser: async () => (staff ? { uid: staff.uid, email: staff.email } : null),
    staffSees: STAFF.staffSees,
    worksThread: STAFF.worksThread,
    advocateIdOf: STAFF.advocateIdOf,
    ADVOCATE_ROLE: STAFF.ADVOCATE_ROLE,
    validateAction: ACTS.validateAction,
    getDoc: async (env, p) => { calls.push(['getDoc', p]); return store.has(p) ? { id: p.split('/').pop(), data: store.get(p), updateTime: 't1' } : null; },
    ...extra,
  };
  const proxy = new Proxy({}, {
    has: (t, k) => typeof k === 'string' && (k in deps || (!(k in globalThis) && !locals.has(k))),
    get: (t, k) => {
      if (k === Symbol.unscopables) return undefined;
      if (k in deps) return deps[k];
      return (...args) => { calls.push([k, ...args.slice(1, 2)]); return SIDE.test(k) ? Promise.resolve(k === 'listDocs' || k === 'queryDocs' ? [] : true) : Promise.resolve(null); };
    },
  });
  // eslint-disable-next-line no-new-func
  const fn = new Function('__p', `with (__p) { ${srcs.join('\n')}\n return ${entry}; }`)(proxy);
  return { fn, calls };
}
const req = (body, url = 'https://app.test/x') => ({ method: 'POST', json: async () => body, clone() { return this; }, headers: new Map() });

// ---- B. every case route refuses an advocate who is not the case's -----------
console.log('\n--- B. the case routes ---');
// Each route that takes an advocate, with a body that would do something real.
const STAFF_ROUTES = [
  ['handleHold', 'async function handleHold(request, env) {', { caseId: 'ca', on: true, note: 'back soon' }],
  ['handleCloseCase', 'async function handleCloseCase(request, env) {', { caseId: 'ca', reason: 'All done.' }],
  ['handleCaseCharge', 'async function handleCaseCharge(request, env) {', { caseId: 'ca', decision: 'decline', reason: 'Full this month.' }],
  ['handleCaseUpdate', 'async function handleCaseUpdate(request, env) {', { caseId: 'ca', action: 'join-link', joinLink: 'https://meet.test/x' }],
  ['handleClientAlert', 'async function handleClientAlert(request, env) {', { caseId: 'ca', text: 'Open your case today, please.' }],
  ['handleAdminSchedule', 'async function handleAdminSchedule(request, env) {', { caseId: 'ca', mode: 'checkin', customStart: new Date(Date.now() + 9 * 86_400_000).toISOString() }],
  ['handleFullRequestDecision', 'async function handleFullRequestDecision(request, env) {', { caseId: 'ca', decision: 'decline', reason: 'Not this month.' }],
  ['handleTelehealthDecide', 'async function handleTelehealthDecide(request, env) {', { caseId: 'ca', action: 'deny' }],
  ['handleClinicCalls', 'async function handleClinicCalls(request, env, url) {', { caseId: 'ca', action: 'add', clinic: 'Mercy cardiology' }],
  ['handleMilestones', 'async function handleMilestones(request, env, url) {', { caseId: 'ca', action: 'add', label: 'Referral sent' }],
  ['handleFileMeta', 'async function handleFileMeta(request, env) {', { kind: 'case', id: 'ca', path: 'cases/ca/uploads/1-x.pdf', name: 'Mine' }],
  ['handleChatTime', 'async function handleChatTime(request, env) {', { id: 'ca', seconds: 30 }],
  // The work clock (v7.44): each advocate's own clock doc, on their own cases.
  ['handleWork', 'async function handleWork(request, env) {', { caseId: 'ca', on: true }],
  // Their notes (v7.44).
  ['handleCaseNotes', 'async function handleCaseNotes(request, env, url) {', { caseId: 'ca', html: '<p>Note</p>' }],
];
// Routes about the staff member themselves, not one case: the presence
// beacon writes their own clock doc and nothing else.
// RE-PINNED 2026-10-15 (v7.46): Eric, "The + sign under all cases should only be there to schedule a case from any
// lead they themselves acquire": the invitation routes take an advocate now, each on their own (section I).
// NEGATIVE CONTROL (run 2026-10-15, v7.46): handleAdminLeads switched to `const staff = await requireStaff(request, env);` made D1 read FAIL.
const STAFF_OWN_ROUTES = ['handleWorkPresence', 'handleLeadInvite', 'handleLeadInvites', 'handleLeadInviteCancel', 'handleStaffLeads'];
// The helpers the lifted routes need by name, lifted with them so they run as shipped.
const HELPERS = ['async function threadContext(env, user, kind, id) {'].map((dcl) => lift(W, dcl));
{
  const lifts = STAFF_ROUTES.map(([, decl]) => lift(W, decl));
  // NEGATIVE CONTROL (run 2026-10-15): handleChatTime renamed in the Worker made this read
  //   FAIL  B1 every route that takes an advocate lifts out of the Worker
  check('B1 every route that takes an advocate lifts out of the Worker', lifts.every(Boolean) && HELPERS.every(Boolean),
    STAFF_ROUTES.filter((r, i) => !lifts[i]).map((r) => r[0]).join(','));
  // The order, read off the source: the ownership check comes before the first
  // private read or any write. A route can be right at runtime for the bodies
  // tried here and still read before it checks for some other body; this
  // catches that shape whatever the body.
  const order = STAFF_ROUTES.map(([name], i) => {
    const src = lifts[i];
    const gate = Math.min(...[src.indexOf('staffSees(staff,'), src.indexOf('threadContext(env, staff,')].filter((n) => n >= 0));
    const first = Math.min(...['patchDoc(', 'deleteDoc(', 'listDocs(', 'notifyUser(', 'sendEmail(', 'stripePost(', 'captureHold(', 'cancelHold(', 'patchObjectMeta(', 'deleteFile(', 'queryDocs(']
      .map((k) => src.indexOf(k)).filter((n) => n >= 0));
    return { name, ok: Number.isFinite(gate) && gate < first && /const staff = await requireStaff\(request, env\);\n {2}if \(!staff\) return json\(\{ error: 'Not found' \}, 404\);/.test(src) && !/requireAdmin\(/.test(src) };
  });
  // NEGATIVE CONTROL (run 2026-10-15): handleMilestones' owner check moved below its GET listing made this read
  //   FAIL  B2 each one asks requireStaff, then checks the case is theirs before it reads anything private or writes anything
  check('B2 each one asks requireStaff, then checks the case is theirs before it reads anything private or writes anything',
    order.every((o) => o.ok), order.filter((o) => !o.ok).map((o) => o.name).join(','));

  const outcomes = [];
  for (const [name, decl, body] of STAFF_ROUTES) {
    const src = lift(W, decl);
    for (const [who, staff] of [['B', B], ['A', A], ['admin', ADMIN], ['stranger', null]]) {
      const store = new Map([
        ['cases/ca', { advocateId: 'adv-a', clientUid: 'c1', clientName: 'Dana Reyes', clientEmail: 'd@x.test', status: 'confirmed',
          charge: { state: 'held', authorizedCents: 210000, capturedCents: 0, paymentIntentId: 'pi_1' },
          fullAccessRequest: { state: 'pending' }, pendingTelehealth: { state: 'requested' }, hold: {} }],
        ['users/adv-a', { role: 'advocate', name: 'Ana Advocate' }], ['users/adv-b', { role: 'advocate' }], [`users/${ERIC}`, { role: 'admin' }],
        // A working advocate is set up (2026-10-16: setup first, staff.js setupPending).
        ['advocates/adv-a', { active: true, onboardedAt: 'x' }], ['advocates/adv-b', { active: true, onboardedAt: 'x' }],
      ]);
      const { fn, calls } = runLifted([...HELPERS, src], name, { staff, store });
      let res; let threw = '';
      try { res = await fn(req(body), ENV, { waitUntil() {} }); } catch (e) { threw = `${e.constructor.name}: ${e.message}`; }
      // A route that throws after passing its gate has still passed it; what
      // matters here is what happened before, and that a refusal never throws.
      const sides = calls.filter((c) => SIDE.test(c[0]));
      const privateReads = calls.filter((c) => c[0] === 'getDoc' && /\/private\//.test(String(c[1])));
      outcomes.push({ name, who, status: res?.s ?? null, threw, sides: sides.length, privateReads: privateReads.length });
    }
  }
  const of = (who) => outcomes.filter((o) => o.who === who);
  // NEGATIVE CONTROL (run 2026-10-15): handleCloseCase's `|| !staffSees(staff, doc.data, env)` taken out made this read
  //   FAIL  B3 advocate B on advocate A's case: the same 404 a stranger gets, on every route, and nothing read or written
  check('B3 advocate B on advocate A\'s case: the same 404 a stranger gets, on every route, and nothing read or written',
    of('B').every((o) => o.status === 404 && !o.threw && o.sides === 0 && o.privateReads === 0),
    JSON.stringify(of('B').filter((o) => !(o.status === 404 && !o.threw && o.sides === 0 && o.privateReads === 0))));
  // NEGATIVE CONTROL (run 2026-10-15): the first route's `if (!staff)` refusal answering 403 made this read
  //   FAIL  B4 a stranger gets that same 404 and nothing happens
  check('B4 a stranger gets that same 404 and nothing happens',
    of('stranger').every((o) => o.status === 404 && !o.threw && o.sides === 0),
    JSON.stringify(of('stranger').filter((o) => o.status !== 404 || o.sides)));
  // The case's own advocate, and Eric, get past the gate: each route does
  // what it is for (a write, a read of the record, or a refusal about the
  // request itself), which is never the gate's 404.
  const through = (o) => o.status !== 404 || o.sides > 0;
  // NEGATIVE CONTROL (run 2026-10-15): staffSees answering false for a non-admin made this read
  //   FAIL  B5 advocate A works their own case on every route, and Eric works it too
  check('B5 advocate A works their own case on every route, and Eric works it too',
    of('A').every(through) && of('admin').every(through),
    JSON.stringify([...of('A'), ...of('admin')].filter((o) => !through(o))));
  // The types are his, shared by every case: an advocate uses them and only he changes the list.
  {
    const src = lift(W, 'async function handleClinicCalls(request, env, url) {');
    const store = new Map([['cases/ca', { advocateId: 'adv-a' }]]);
    // A route that gets past the refusal and then trips on a stub has still
    // got past it: that is a fail of this check, never a crash of the suite.
    const run = async (staff) => {
      const h = runLifted([src], 'handleClinicCalls', { staff, store });
      let r;
      try { r = await h.fn(req({ caseId: 'ca', action: 'kind-add', label: 'Fax', color: 'cyan' }), ENV); } catch (e) { r = { s: `threw ${e.message}` }; }
      return { s: r?.s, w: h.calls.filter((c) => c[0] === 'patchDoc').length };
    };
    const a = await run(A);
    // NEGATIVE CONTROL (run 2026-10-15): the kind- refusal taken out of handleClinicCalls made this read
    //   FAIL  B6 an advocate cannot change the shared list of activity or milestone types
    check('B6 an advocate cannot change the shared list of activity or milestone types',
      a.s === 403 && a.w === 0 && (W.match(/if \(String\(body\?\.action \|\| ''\)\.startsWith\('kind-'\) && !staff\.isAdmin\)/g) || []).length === 2,
      JSON.stringify(a));
  }
}

// The presence beacon is about the staff member, not a case: an advocate's
// beat writes their own clock doc, whatever case id rides on it.
{
  const src = [(W.match(/const CLOCK_DOC = [^\n]+;/) || [''])[0], lift(W, 'function clockPathFor(env, uid) {'), lift(W, 'async function handleWorkPresence(request, env) {')];
  const store = new Map([['cases/ca', { advocateId: 'adv-a', work: { startedAt: new Date().toISOString() } }], ['admin/clock', { running: ['ca'] }]]);
  const { fn, calls } = runLifted(src, 'handleWorkPresence', { staff: B, store, extra: {
    WORK_PRESENCE_STALE_MS: 180_000, workDayString: () => '2026-10-15', todayByCase: () => ({}),
  } });
  const out = await fn(req({ caseId: 'ca' }), ENV);
  const writes = calls.filter((c) => c[0] === 'patchDoc').map((c) => c[1]);
  const reads = calls.filter((c) => c[0] === 'getDoc').map((c) => c[1]);
  // NEGATIVE CONTROL (run 2026-10-15): the beacon's clock taken as `clockPathFor(env, env.ADMIN_UID)` made this read
  //   FAIL  B7 an advocate's presence beat writes their own clock doc and reads nobody's case
  check('B7 an advocate\'s presence beat writes their own clock doc and reads nobody\'s case',
    out?.s === 200 && writes.length === 1 && writes[0] === 'staffClocks/adv-b' && !reads.some((p) => p.startsWith('cases/') || p === 'admin/clock'),
    JSON.stringify({ writes, reads }));
}

// ---- C. the shared chat and file helpers -------------------------------------
console.log('\n--- C. chat, files and pings ---');
{
  const tc = lift(W, 'async function threadContext(env, user, kind, id) {');
  const cc = lift(W, 'async function chatContext(env, user, kind, id, msgId) {');
  const up = lift(W, 'async function handleUploaded(request, env) {');
  const nt = lift(W, 'async function handleNotify(request, env, ctx) {');
  const pz = lift(W, 'async function pausedForClient(request, env, url) {');
  // NEGATIVE CONTROL (run 2026-10-15): pausedForClient renamed in the Worker made this read
  //   FAIL  C1 the helpers lift
  check('C1 the helpers lift', [tc, cc, up, nt, pz].every(Boolean));
  const store = () => new Map([
    ['cases/ca', { advocateId: 'adv-a', clientUid: 'c1', clientName: 'Dana Reyes', status: 'confirmed', hold: { pausedAt: '2026-10-14T00:00:00Z' } }],
    ['cases/old', { clientUid: 'c2', clientName: 'Old Client', status: 'confirmed' }],
    ['subscriptions/c3', { advocateId: 'adv-a', name: 'Sub Client' }],
    ['users/adv-a', { role: 'advocate' }], ['users/adv-b', { role: 'advocate' }], ['users/adv-off', { role: 'advocate' }],
    [`users/${ERIC}`, { role: 'admin' }], ['users/c1', { role: 'client', name: 'Dana Reyes' }], ['users/c2', { role: 'client' }], ['users/c3', { role: 'client' }],
    // A working advocate is set up (2026-10-16: setup first, staff.js setupPending).
    ['advocates/adv-a', { active: true, onboardedAt: 'x' }], ['advocates/adv-b', { active: true, onboardedAt: 'x' }], ['advocates/adv-off', { active: false, onboardedAt: 'x' }],
  ]);
  const ctxOf = async (uid, kind, id) => {
    const { fn } = runLifted([tc], 'threadContext', { staff: null, store: store(), extra: { firstName: (v) => String(v || '').split(' ')[0] } });
    return fn(ENV, { uid }, kind, id);
  };
  const r = {
    clientOwn: await ctxOf('c1', 'case', 'ca'), clientOther: await ctxOf('c2', 'case', 'ca'),
    a: await ctxOf('adv-a', 'case', 'ca'), b: await ctxOf('adv-b', 'case', 'ca'), off: await ctxOf('adv-off', 'case', 'ca'),
    aOld: await ctxOf('adv-a', 'case', 'old'), eric: await ctxOf(ERIC, 'case', 'ca'), aSub: await ctxOf('adv-a', 'sub', 'c3'), bSub: await ctxOf('adv-b', 'sub', 'c3'),
  };
  // NEGATIVE CONTROL (run 2026-10-15): threadContext's isAdmin back to `profile?.data.role === 'admin'` made this read
  //   FAIL  C2 a thread's advocate side is Eric or its own advocate; another advocate, a switched-off one, or one on Eric's own cases is a stranger
  check('C2 a thread\'s advocate side is Eric or its own advocate; another advocate, a switched-off one, or one on Eric\'s own cases is a stranger',
    r.clientOwn.isAdmin === false && !r.clientOwn.error && r.clientOther.code === 404
    && r.a.isAdmin === true && r.eric.isAdmin === true && r.aSub.isAdmin === true
    && r.b.code === 404 && r.off.code === 404 && r.aOld.code === 404 && r.bSub.code === 404,
    JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.code || v.isAdmin]))));
  {
    const { fn } = runLifted([cc], 'chatContext', { staff: null, store: store(), extra: { firstName: (v) => String(v || '').split(' ')[0] } });
    const a = await fn(ENV, { uid: 'adv-a' }, 'case', 'ca', 'm1');
    const b = await fn(ENV, { uid: 'adv-b' }, 'case', 'ca', 'm1');
    // NEGATIVE CONTROL (run 2026-10-15): chatContext's isAdmin back to `profile?.data.role === 'admin'` made this read
    //   FAIL  C3 a message's reactions, passes and edits follow the same wall
    check('C3 a message\'s reactions, passes and edits follow the same wall', a.isAdmin === true && b.code === 404, JSON.stringify({ a, b }));
  }
  // A client's upload and message ping their own advocate; another advocate is refused and pings nobody.
  const pings = async (src, entry, user, body) => {
    const s = store();
    const { fn, calls } = runLifted([src], entry, { staff: null, store: s, extra: {
      requireUser: async () => user, firstName: (v) => String(v || '').split(' ')[0],
      advocateName: () => 'Ana', notifyUser: async (env, uid, n) => { calls.push(['notifyUser', uid, n.body]); },
    } });
    const out = await fn(req(body), ENV, { waitUntil() {} });
    return { s: out?.s, to: calls.filter((c) => c[0] === 'notifyUser').map((c) => c[1]) };
  };
  const upClient = await pings(up, 'handleUploaded', { uid: 'c1' }, { kind: 'case', id: 'ca', names: ['labs.pdf'] });
  const upB = await pings(up, 'handleUploaded', { uid: 'adv-b' }, { kind: 'case', id: 'ca', names: ['x.pdf'] });
  const upOld = await pings(up, 'handleUploaded', { uid: 'c2' }, { kind: 'case', id: 'old', names: ['x.pdf'] });
  // NEGATIVE CONTROL (run 2026-10-15): handleUploaded notifying env.ADMIN_UID instead of the case's advocate made this read
  //   FAIL  C4 a client's upload pings their own advocate, Eric on his own cases, and another advocate is refused
  check('C4 a client\'s upload pings their own advocate, Eric on his own cases, and another advocate is refused',
    upClient.s === 200 && JSON.stringify(upClient.to) === '["adv-a"]' && upB.s === 404 && !upB.to.length
    && JSON.stringify(upOld.to) === JSON.stringify([ERIC]), JSON.stringify({ upClient, upB, upOld }));
  const ntClient = await pings(nt, 'handleNotify', { uid: 'c3' }, { kind: 'sub', id: 'c3' });
  const ntB = await pings(nt, 'handleNotify', { uid: 'adv-b' }, { kind: 'sub', id: 'c3' });
  const ntA = await pings(nt, 'handleNotify', { uid: 'adv-a' }, { kind: 'sub', id: 'c3' });
  // NEGATIVE CONTROL (run 2026-10-15): handleNotify pinging env.ADMIN_UID for every client message made this read
  //   FAIL  C5 a client's message pings their own advocate; that advocate's reply pings the client; another advocate is refused
  check('C5 a client\'s message pings their own advocate; that advocate\'s reply pings the client; another advocate is refused',
    JSON.stringify(ntClient.to) === '["adv-a"]' && ntB.s === 404 && !ntB.to.length && JSON.stringify(ntA.to) === '["c3"]',
    JSON.stringify({ ntClient, ntB, ntA }));
  {
    const run = async (uid) => { const { fn } = runLifted([pz], 'pausedForClient', { staff: null, store: store(), extra: { requireUser: async () => ({ uid }), onHold: (c) => !!c?.hold?.pausedAt } }); return fn(req({ caseId: 'ca' }), ENV, new URL('https://app.test/api/agenda')); };
    const got = { a: await run('adv-a'), eric: await run(ERIC), b: await run('adv-b'), client: await run('c1') };
    // NEGATIVE CONTROL (run 2026-10-15): pausedForClient back to `return profile?.data?.role !== 'admin';` made this read
    //   FAIL  C6 a paused case never holds its own advocate or Eric; the client, and anyone else, is held
    check('C6 a paused case never holds its own advocate or Eric; the client, and anyone else, is held',
      got.a === false && got.eric === false && got.b === true && got.client === true, JSON.stringify(got));
  }
}

// ---- D. the router -----------------------------------------------------------
console.log('\n--- D. the router ---');
{
  const takers = [...W.matchAll(/\n(?:async )?function (\w+)\([^)]*\) \{\n(?:\s*\/\/[^\n]*\n)*\s*const staff = await requireStaff\(request, env\);/g)].map((m) => m[1]).sort();
  const listed = [...STAFF_ROUTES.map((r) => r[0]), ...STAFF_OWN_ROUTES].sort();
  // NEGATIVE CONTROL (run 2026-10-15): handleLeadInvite switched to `const staff = await requireStaff(request, env);` made this read
  //   FAIL  D1 the routes that take an advocate are exactly the ones checked above, so a new one cannot slip in unchecked
  check('D1 the routes that take an advocate are exactly the ones checked above, so a new one cannot slip in unchecked',
    JSON.stringify(takers) === JSON.stringify(listed), `worker: ${takers.join(',')}`);
  // RE-PINNED 2026-10-16 (v7.56): requireStaff takes { setup } and refuses an advocate still setting up unless the
  // route allows it (their account page's routes); the decision is still staffFrom's.
  const reqStaff = lift(W, 'async function requireStaff(request, env, opts = {}) {');
  // NEGATIVE CONTROL (run 2026-10-15): requireStaff handing staffFrom a made-up active record made this read
  //   FAIL  D2 requireStaff reads the role and the advocate record on the server, and decides with the shared rule
  // NEGATIVE CONTROL (run 2026-10-16, v7.56): requireStaff's `if (staff?.setup && opts.setup !== true) return null;` taken out made this read
  //   FAIL  D2 requireStaff reads the role and the advocate record on the server, and decides with the shared rule
  check('D2 requireStaff reads the role and the advocate record on the server, and decides with the shared rule',
    /const profile = await getDoc\(env, `users\/\$\{user\.uid\}`\);/.test(reqStaff) && /advocates\/\$\{user\.uid\}/.test(reqStaff)
    && /const staff = staffFrom\(env, user, profile, advocate\);/.test(reqStaff)
    && /if \(staff\?\.setup && opts\.setup !== true\) return null;\n\s+return staff;/.test(reqStaff));
  // Everything about the platform as a whole stays his alone.
  // RE-PINNED 2026-10-15 (v7.46): handleLeadInvite is staff now (a contractor's own leads, section I); his leads list stays his.
  // NEGATIVE CONTROL (run 2026-10-15, v7.46): handleAdminLeads asking requireStaff made D1 and D3 read FAIL.
  // RE-PINNED 2026-10-15 (v7.51): Eric, "Remove the fund queue, one day summary". handleDaySummary is gone with its
  // route; the rest stay his alone.
  // NEGATIVE CONTROL (run 2026-10-15, v7.51): handleSetRates asking requireStaff still made D3 read FAIL.
  const hisAlone = ['handleSetRates', 'handleCreateSlots', 'handleAdminLeads', 'handleLedger', 'handleStatsRecompute', 'handleSelfCase', 'handleShowcaseCase', 'handleDeleteCase', 'handleFamilyCase', 'handleBookingClosure', 'handleOfficeHoursControl', 'handleFullCapacity', 'handleChatReply', 'handlePersonal'];
  const wrong = hisAlone.filter((n) => { const m = W.match(new RegExp(`\\n(?:async )?function ${n}\\([^)]*\\) \\{[\\s\\S]{0,300}`)); return !m || !/await requireAdmin\(request, env\)/.test(m[0]); });
  // NEGATIVE CONTROL (run 2026-10-15): handleSetRates asking requireStaff made this read
  //   FAIL  D3 prices, calendar, leads, the ledger, invitations, his own and family cases, the showcase and the private reading stay his alone for now
  // RE-PINNED 2026-10-15 (v7.44): the work clock is every advocate's now, on their own clock doc (STAFF_ROUTES above).
  check('D3 prices, calendar, leads, the ledger, invitations, his own and family cases, the showcase and the private reading stay his alone for now',
    !wrong.length, wrong.join(','));
}

// ---- I. a contractor's own leads (Eric, 2026-10-15) ---------------------------
// "Remove the ability to make their own case or family case for contractors.
// The + sign under all cases should only be there to schedule a case from any
// lead they themselves acquire." The invitation routes RUN as A, B and Eric.
console.log('\n--- I. their own leads ---');
{
  const consts = [(W.match(/const INVITE_ID_RE = [^\n]+;/) || [''])[0], (W.match(/const INVITE_MIN_LEAD_MS = [^\n]+;/) || [''])[0],
    (W.match(/const INVITE_MAX_LEAD_MS = [^\n]+;/) || [''])[0], (W.match(/const RATE_MAX_CENTS = [^\n]+;/) || [''])[0]];
  const src = [...consts, lift(W, 'function inviteDollars(cents) {'), lift(W, 'function inviteWhen(start) {'), lift(W, 'function escHtml(s) {'),
    lift(W, 'function inviteEmail({ name, start, priceCents, link, from = \'Eric\' }) {'), lift(W, 'async function handleLeadInvite(request, env) {'),
    lift(W, 'async function handleLeadInvites(request, env) {'), lift(W, 'async function handleLeadInviteCancel(request, env) {'), lift(W, 'async function handleStaffLeads(request, env) {')];
  const later = new Date(Date.now() + 5 * 86_400_000).toISOString();
  const send = async (staff) => {
    const store = new Map([['advocates/adv-a', { name: 'Ana Rivera', active: true }]]);
    const written = [];
    const mails = [];
    const { fn } = runLifted(src, 'handleLeadInvite', { staff, store, extra: {
      patchDoc: async (env, p, d) => { written.push([p, d]); return true; }, sendEmail: async (env, m) => { mails.push(m); return true; },
    } });
    const out = await fn(req({ email: 'lead@x.test', name: 'Lee Lead', start: later, priceCents: 210000 }), ENV);
    return { out, written, mails };
  };
  const a = await send(A);
  const e = await send(ADMIN);
  const nobody = await send(null);
  // NEGATIVE CONTROL (run 2026-10-15): the invitation's `advocateId: admin.uid` written as `env.ADMIN_UID` made this read
  //   FAIL  I1 a contractor's invitation is theirs: it, and the case it becomes, carry their uid, and the email is signed with their name; his is signed Eric; a stranger gets the 404
  check('I1 a contractor\'s invitation is theirs: it, and the case it becomes, carry their uid, and the email is signed with their name; his is signed Eric; a stranger gets the 404',
    a.out?.s === 200 && a.written[0]?.[1]?.advocateId === 'adv-a' && a.written[0][1].by === 'adv-a' && /<p>Ana Rivera<\/p>/.test(a.mails[0]?.html || '')
    && e.written[0]?.[1]?.advocateId === ERIC && /<p>Eric<\/p>/.test(e.mails[0]?.html || '') && nobody.out?.s === 404,
    JSON.stringify({ a: a.written[0]?.[1]?.advocateId, e: e.written[0]?.[1]?.advocateId, nobody: nobody.out?.s }));
  const rows = [
    { id: 'inv-aaa1', data: { state: 'sent', email: 'one@x.test', start: later, priceCents: 1, advocateId: 'adv-a' } },
    { id: 'inv-bbb1', data: { state: 'sent', email: 'two@x.test', start: later, priceCents: 1, advocateId: 'adv-b' } },
    { id: 'inv-eee1', data: { state: 'sent', email: 'three@x.test', start: later, priceCents: 1 } },
  ];
  const list = async (staff) => {
    const { fn } = runLifted(src, 'handleLeadInvites', { staff, store: new Map(), extra: { listDocs: async () => rows } });
    return (await fn(req({}), ENV))?.o?.invites?.map((v) => v.id).sort().join() || '';
  };
  const leads = async (staff) => {
    const { fn } = runLifted(src, 'handleStaffLeads', { staff, store: new Map(), extra: { listDocs: async (env, coll) => (coll === 'invites' ? rows : [{ id: 'l1', data: { email: 'mine@x.test', name: 'Mine', advocateId: 'adv-a' } }]) } });
    return (await fn({ method: 'GET' }, ENV))?.o?.leads?.map((l) => l.email).sort().join() || '';
  };
  const cancel = async (staff, id) => {
    const store = new Map(rows.map((r) => [`invites/${r.id}`, r.data]));
    const written = [];
    const { fn } = runLifted(src, 'handleLeadInviteCancel', { staff, store, extra: { patchDoc: async (env, p, d) => { written.push(p); return true; } } });
    return { s: (await fn(req({ id }), ENV))?.s, written };
  };
  const listA = await list(A);
  const listE = await list(ADMIN);
  const leadsA = await leads(A);
  const leadsB = await leads(B);
  const cancelOther = await cancel(A, 'inv-bbb1');
  const cancelOwn = await cancel(A, 'inv-aaa1');
  const cancelHis = await cancel(ADMIN, 'inv-bbb1');
  // NEGATIVE CONTROL (run 2026-10-15): handleLeadInvites dropping its staffSees filter made this read
  //   FAIL  I2 a contractor lists, picks from and withdraws only their own; another's invitation is the same 404 a stranger gets; he sees and may withdraw any
  check('I2 a contractor lists, picks from and withdraws only their own; another\'s invitation is the same 404 a stranger gets; he sees and may withdraw any',
    listA === 'inv-aaa1' && listE === 'inv-aaa1,inv-bbb1,inv-eee1' && leadsA === 'mine@x.test,one@x.test' && leadsB === 'two@x.test'
    && cancelOther.s === 404 && !cancelOther.written.length && cancelOwn.s === 200 && cancelHis.s === 200,
    JSON.stringify({ listA, listE, leadsA, leadsB, cancelOther, cancelOwn: cancelOwn.s, cancelHis: cancelHis.s }));
  // NEGATIVE CONTROL (run 2026-10-15): the advocate branch keeping every item of the + menu made this read
  //   FAIL  I3 a contractor's + holds one door, a case from their own lead; his own, family and showcase doors stay his, and their routes his alone
  const ADM = f('public/js/admin.js');
  check('I3 a contractor\'s + holds one door, a case from their own lead; his own, family and showcase doors stay his, and their routes his alone',
    /if \(item\.dataset\.openDoor !== 'lead'\) item\.remove\(\);/.test(ADM) && /addEl\.innerHTML = advocate \? leadFormHtml\(\) :/.test(ADM)
    && /leadsPath: advocate \? '\/api\/staff\/leads' : '\/api\/admin\/leads'/.test(ADM)
    && ['handleSelfCase', 'handleFamilyCase', 'handleShowcaseCase'].every((n) => /await requireAdmin\(request, env\)/.test((W.match(new RegExp(`\\n(?:async )?function ${n}\\([^)]*\\) \\{[\\s\\S]{0,300}`)) || [''])[0])));
  // Payroll pays a share of what a client paid, so money typed in by hand is his to type (2026-10-15).
  // NEGATIVE CONTROL (run 2026-10-15): set-paid's `if (!staff.isAdmin)` line, open-full's, and the case page's `|| advocate`, each taken out on its own, made this read
  //   FAIL  I4 money paid outside the app is his alone to record: set-paid and open-full refuse a contractor with the 404 a stranger gets, and their case page does not offer it
  const guard = (action) => new RegExp(`\\} else if \\(action === '${action}'\\) \\{\\n(?:\\s*//[^\\n]*\\n)*\\s*if \\(!staff\\.isAdmin\\) return json\\(\\{ error: 'No such case' \\}, 404\\);`).test(W);
  check('I4 money paid outside the app is his alone to record: set-paid and open-full refuse a contractor with the 404 a stranger gets, and their case page does not offer it',
    guard('set-paid') && guard('open-full')
    && /\$\{c\.fullAccess \|\| advocate \? '' : `\n\s+<!-- OPENING THE TIER BY HAND/.test(f('public/js/admin-case.js')),
    JSON.stringify({ setPaid: guard('set-paid'), openFull: guard('open-full') }));
}

// ---- E. the migration --------------------------------------------------------
console.log('\n--- E. the stamp ---');
{
  const src = [lift(W, 'function ownerAdvocateRecord(env, profile, now) {'), lift(W, 'async function stampAdvocates(env) {'),
    (W.match(/const ADVOCATE_STAMP_COLLECTIONS = [^\n]+;/) || [''])[0]];
  // NEGATIVE CONTROL (run 2026-10-15): ownerAdvocateRecord renamed in the Worker made this read
  //   FAIL  E1 the stamp lifts
  check('E1 the stamp lifts', src.every(Boolean));
  const make = (seed) => {
    const db = new Map(Object.entries(seed));
    const writes = [];
    const deps = {
      getDoc: async (env, p) => (db.has(p) ? { data: db.get(p), updateTime: 't' } : null),
      patchDoc: async (env, p, data, opts = {}) => {
        if (opts.mustNotExist && db.has(p)) return null;
        writes.push([p, data, opts]); db.set(p, { ...(opts.mask ? db.get(p) : {}), ...data }); return true;
      },
      listDocs: async (env, coll) => [...db.entries()].filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === 2).map(([k, v]) => ({ id: k.split('/')[1], data: v })),
      batchWrite: async (env, ws) => ws.map((w) => { writes.push([w.path, w.data, { mask: w.mask, batch: true }]); db.set(w.path, { ...db.get(w.path), ...w.data }); return true; }),
      console: { error() {} },
    };
    // eslint-disable-next-line no-new-func
    const fn = new Function(...Object.keys(deps), `${src[2]}\n${src[0]}\n${src[1]}\nreturn stampAdvocates;`)(...Object.values(deps));
    return { fn, db, writes };
  };
  const seed = {
    [`users/${ERIC}`]: { name: 'Eric Bleach', role: 'admin' },
    'cases/c1': { clientUid: 'u1' }, 'cases/c2': { clientUid: 'u2', advocateId: 'adv-a' }, 'subscriptions/u3': { status: 'active' },
    'invites/i1': { state: 'sent' }, 'availability/s1': { state: 'open' }, 'availability/s2': { state: 'open', advocateId: 'adv-a' }, 'waitlist/w1': { email: 'w@x.test' },
  };
  const m = make(seed);
  await m.fn(ENV);
  const me = m.db.get(`advocates/${ERIC}`);
  const stamped = ['cases/c1', 'subscriptions/u3', 'invites/i1', 'availability/s1', 'waitlist/w1'].every((p) => m.db.get(p).advocateId === ERIC);
  const kept = m.db.get('cases/c2').advocateId === 'adv-a' && m.db.get('availability/s2').advocateId === 'adv-a';
  const masked = m.writes.filter((w) => w[2].batch).every((w) => JSON.stringify(w[2].mask) === '["advocateId"]' && Object.keys(w[1]).join() === 'advocateId');
  // NEGATIVE CONTROL (run 2026-10-15): the stamp's filter taken out, so every document is stamped, made this read
  //   FAIL  E2 Eric becomes advocate number one, owner, on no commission and off the payroll; everything without an advocate becomes his and nothing else moves
  check('E2 Eric becomes advocate number one, owner, on no commission and off the payroll; everything without an advocate becomes his and nothing else moves',
    me?.owner === true && me.active === true && me.commissionPct === 100 && me.payroll === false && me.name === 'Eric Bleach' && me.email === 'eric@x.test'
    && stamped && kept && masked && m.db.get('migrations/advocates-2026-10-15')?.finishedAt,
    JSON.stringify({ me, stamped, kept, masked }));
  const before = m.writes.length;
  await m.fn(ENV);
  // NEGATIVE CONTROL (run 2026-10-15): the finished and in-flight guards taken out made this read
  //   FAIL  E3 it runs once: a second fire writes nothing
  check('E3 it runs once: a second fire writes nothing', m.writes.length === before, `${m.writes.length - before} more write(s)`);
  const n = make({ ...seed, [`advocates/${ERIC}`]: { name: 'Eric', bio: 'His own words', active: true } });
  await n.fn(ENV);
  // NEGATIVE CONTROL (run 2026-10-15): his record written without mustNotExist made this read
  //   FAIL  E4 a record he has already filled in is never replaced
  check('E4 a record he has already filled in is never replaced', n.db.get(`advocates/${ERIC}`).bio === 'His own words');
  // NEGATIVE CONTROL (run 2026-10-15): the cron's `if (minute % 15 === 7) ctx.waitUntil(stampAdvocates(env));` taken out made this read
  //   FAIL  E5 the cron runs it, in a minute of its own away from the quarter hour's crowd
  check('E5 the cron runs it, in a minute of its own away from the quarter hour\'s crowd', /\n {4}if \(minute % 15 === 7\) ctx\.waitUntil\(stampAdvocates\(env\)\);/.test(W));
}

// ---- F. everything new says whose it is --------------------------------------
console.log('\n--- F. whose ---');
{
  const cc = lift(W, 'async function createCaseFromSession(env, session, { held = null } = {}) {');
  // NEGATIVE CONTROL (run 2026-10-15): `advocateId,` taken out of the new case document made this read
  //   FAIL  F1 a paid or invited case is its advocate's: from the checkout, else the slot's calendar, else Eric's
  check('F1 a paid or invited case is its advocate\'s: from the checkout, else the slot\'s calendar, else Eric\'s',
    /const advocateId = \(typeof m\.advocateId === 'string' && \/\^\[\\w-\]\{1,64\}\$\/\.test\(m\.advocateId\) && m\.advocateId\)\n\s*\|\| advocateIdOf\(slot\?\.data, env\);/.test(cc)
    && /`cases\/\$\{caseId\}`,\n\s*\{\n\s*advocateId,\n\s*clientUid: m\.uid,/.test(cc));
  // NEGATIVE CONTROL (run 2026-10-15): the showcase's `advocateId: eric,` taken out made this read
  //   FAIL  F2 his own case, a family case and the showcase are the advocate's who made them
  check('F2 his own case, a family case and the showcase are the advocate\'s who made them',
    /self: true,\n\s*\/\/[^\n]*\n\s*advocateId: admin\.uid,/.test(lift(W, 'async function createSelfCase(env, admin, who, sources = []) {'))
    && /family: true,\n\s*\/\/[^\n]*\n\s*advocateId: admin\.uid,/.test(lift(W, 'async function handleFamilyCase(request, env) {'))
    && /showcase: true,\n\s*\/\/[^\n]*\n\s*advocateId: eric,/.test(SHOW));
  // NEGATIVE CONTROL (run 2026-10-15): the invitation checkout's `advocateId: advocateIdOf(got.invite, env),` taken out made this read
  //   FAIL  F3 an invitation carries its advocate, and its checkout hands it to the case
  check('F3 an invitation carries its advocate, and its checkout hands it to the case',
    /advocateId: admin\.uid,\n\s*\}, \{ mustNotExist: true \}\);/.test(lift(W, 'async function handleLeadInvite(request, env) {'))
    && /advocateId: advocateIdOf\(got\.invite, env\),/.test(lift(W, 'async function handleInviteConfirm(request, env) {')));
  // NEGATIVE CONTROL (run 2026-10-15): the new slot's `advocateId: admin.uid,` taken out made this read
  //   FAIL  F4 a chat line keeps its advocate through every activation, and a new hour on a calendar says whose
  check('F4 a chat line keeps its advocate through every activation, and a new hour on a calendar says whose',
    /advocateId: \(typeof session\.metadata\.advocateId === 'string'[\s\S]{0,200}\|\| advocateIdOf\(existing\?\.data, env\),/.test(lift(W, 'async function activateSubscription(env, session) {'))
    && /advocateId: admin\.uid,/.test(lift(W, 'async function handleCreateSlots(request, env) {'))
    && /adminCreated: true, advocateId: advocateIdOf\(c, env\) \}/.test(lift(W, 'async function handleAdminSchedule(request, env) {')));
}

// ---- G. the accounts: his Advocates tab, their own page, the password door ----
// worker/advocates.js evaluated whole with its imports replaced by stand-ins
// (the way fund.mjs runs worker/fund.js), and the real staff module beside it.
console.log('\n--- G. accounts ---');
{
  const SRC = f('worker/advocates.js');
  const world = () => {
    const docs = new Map();
    const files = new Map();
    const mails = [];
    const pushes = [];
    const deps = {
      getDoc: async (env, p) => (docs.has(p) ? { id: p.split('/').pop(), data: JSON.parse(JSON.stringify(docs.get(p))), updateTime: 't' } : null),
      patchDoc: async (env, p, data, opts = {}) => {
        if (opts.mustNotExist && docs.has(p)) return null;
        const cur = opts.mask ? (docs.get(p) || {}) : {};
        docs.set(p, JSON.parse(JSON.stringify({ ...cur, ...data })));
        return true;
      },
      deleteDoc: async (env, p) => { docs.delete(p); return true; },
      queryDocs: async (env, coll, filters) => [...docs.entries()].filter(([k, v]) => k.startsWith(`${coll}/`) && filters.every(([fld, , val]) => v[fld] === val)).map(([k, v]) => ({ id: k.split('/')[1], data: v })),
      listDocs: async (env, coll) => [...docs.entries()].filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === 2).map(([k, v]) => ({ id: k.split('/')[1], data: v })),
      putFile: async (env, p, bytes, type) => { files.set(p, { bytes, type }); return { path: p }; },
      deleteFile: async (env, p) => { files.delete(p); },
      mediaFetch: async (env, p) => (files.has(p) ? { ok: true, body: files.get(p).bytes, headers: new Headers({ 'content-type': files.get(p).type }) } : { ok: false }),
      sendEmail: async (env, m) => { mails.push(m); return true; },
      notifyUser: async (env, uid, m) => { pushes.push({ uid, ...m }); },
      ...STAFF,
    };
    const body = SRC.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function) /gm, '$1 ');
    const api = new Function(...Object.keys(deps), `${body}\nreturn { handleAdvocates, isStaffLogin, advocateLogin, loginPath };`)(...Object.values(deps));
    return { docs, files, mails, pushes, api };
  };
  const env = { ADMIN_UID: ERIC, ADMIN_EMAIL: 'eric@x.test', PUBLIC_BASE_URL: 'https://app.test' };
  // Who is asking: the token names a uid; requireStaff and requireAdmin decide the way the Worker's do.
  const h = (w) => ({
    json: (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } }),
    requireAdmin: async (req) => { const uid = req.headers.get('x-uid'); const p = w.docs.get(`users/${uid}`); return uid === ERIC && p?.role === 'admin' ? { uid, email: 'eric@x.test' } : null; },
    // As the Worker's (2026-10-16): a session that began now, and setup first unless the route allows it.
    requireStaff: async (req, e2, opts = {}) => { const uid = req.headers.get('x-uid'); if (!uid) return null; const p = w.docs.get(`users/${uid}`); const s = STAFF.staffFrom(env, { uid, authTime: Math.floor(Date.now() / 1000) + 5 }, p ? { data: p } : null, w.docs.has(`advocates/${uid}`) ? { data: w.docs.get(`advocates/${uid}`) } : null); return s?.setup && opts.setup !== true ? null : s; },
    // The router hands these in (2026-10-16), so a new password gives this device a fresh session.
    mintCustomToken: async (e2, uid) => `token-for-${uid}`,
    issueDeviceToken: async (e2, uid) => `device-for-${uid}`,
  });
  const call = async (w, uid, path, { method = 'POST', json, bytes, type } = {}) => {
    const headers = new Headers();
    if (uid) headers.set('x-uid', uid);
    if (type) headers.set('content-type', type);
    if (bytes) headers.set('content-length', String(bytes.byteLength));
    const url = new URL(`https://app.test${path}`);
    const req = { method, headers, url: url.href, json: async () => json ?? null, arrayBuffer: async () => bytes || new ArrayBuffer(0) };
    const res = await w.api.handleAdvocates(req, env, url, h(w));
    let out = null; try { out = await res.clone().json(); } catch { out = null; }
    return { status: res.status, out, res };
  };
  const PW = 'given-password-1';
  const w = world();
  w.docs.set(`users/${ERIC}`, { role: 'admin' });
  w.docs.set(`advocates/${ERIC}`, { uid: ERIC, name: 'Eric', email: 'eric@x.test', active: true, owner: true, commissionPct: 100, advisor: { optedIn: true, enabled: true } });
  w.docs.set('users/c1', { role: 'client' });
  const made = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'create', name: 'Ana Rivera', email: ' Ana@Example.com ', password: PW } });
  const uid = made.out?.uid;
  const secretPath = await w.api.loginPath('ana@example.com');
  const secret = w.docs.get(secretPath);
  const everything = JSON.stringify([...w.docs.values()]) + JSON.stringify(w.mails) + JSON.stringify(made.out);
  // NEGATIVE CONTROL (run 2026-10-15): the create storing `password: body.password` beside the hash made this read
  //   FAIL  G1 creating an advocate stores a salted hash and never the password: not on any record, not in the email, not in the answer
  check('G1 creating an advocate stores a salted hash and never the password: not on any record, not in the email, not in the answer',
    made.status === 200 && /^a[0-9a-f]{31}$/.test(uid || '') && secret?.algo === 'pbkdf2-sha256' && secret.rounds === 100000
    && /^[0-9a-f]{32}$/.test(secret.salt) && /^[0-9a-f]{64}$/.test(secret.hash) && secret.mustChange === true && secret.uid === uid
    && !everything.includes(PW) && w.mails.length === 1 && w.mails[0].to === 'ana@example.com' && !DASH.test(w.mails[0].html),
    JSON.stringify({ status: made.status, uid, secret: secret && Object.keys(secret) }));
  const adv = w.docs.get(`advocates/${uid}`);
  // NEGATIVE CONTROL (run 2026-10-15): the create's share set to 100 instead of DEFAULT_COMMISSION_PCT made this read
  //   FAIL  G2 the new advocate is active at the 60% default, off the Advisor, unset up, and their user record says advocate
  check('G2 the new advocate is active at the 60% default, off the Advisor, unset up, and their user record says advocate',
    adv?.active === true && adv.commissionPct === 60 && adv.advisor?.optedIn === false && adv.advisor?.enabled === false
    && adv.onboardedAt === null && adv.owner === false && w.docs.get(`users/${uid}`)?.role === 'advocate' && adv.email === 'ana@example.com');
  const dup = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'create', name: 'Ana Again', email: 'ana@example.com', password: PW } });
  const his = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'create', name: 'Eric', email: 'eric@x.test', password: PW } });
  const weak = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'create', name: 'Weak', email: 'weak@x.test', password: 'short' } });
  const asAdvocate = await call(w, uid, '/api/admin/advocates', { json: { action: 'list' } });
  const asClient = await call(w, 'c1', '/api/admin/advocates', { json: { action: 'create', name: 'X', email: 'x@x.test', password: PW } });
  const stranger = await call(w, '', '/api/admin/advocates', { json: { action: 'list' } });
  // NEGATIVE CONTROL (run 2026-10-15): the create's `{ mustNotExist: true }` on the password record taken out made this read
  //   FAIL  G3 one account per address, never his, never a weak password, and only he reaches the tab: an advocate, a client and a stranger get the 404
  check('G3 one account per address, never his, never a weak password, and only he reaches the tab: an advocate, a client and a stranger get the 404',
    dup.status === 409 && his.status === 409 && weak.status === 400
    && asAdvocate.status === 404 && asClient.status === 404 && stranger.status === 404,
    JSON.stringify([dup.status, his.status, weak.status, asAdvocate.status, asClient.status, stranger.status]));
  const right = await w.api.advocateLogin(env, 'ANA@example.com ', PW);
  const wrong = await w.api.advocateLogin(env, 'ana@example.com', 'not-the-password');
  const nobody = await w.api.advocateLogin(env, 'nobody@example.com', PW);
  // NEGATIVE CONTROL (run 2026-10-15): advocateLogin skipping verifyPassword made this read
  //   FAIL  G4 the password door opens for the right password only, says whether they still hold the one they were given, and a miss does the same hashing work
  check('G4 the password door opens for the right password only, says whether they still hold the one they were given, and a miss does the same hashing work',
    right?.uid === uid && right.mustChange === true && right.email === 'ana@example.com' && wrong === null && nobody === null
    && /if \(!sec\?\.data\?\.uid\) \{\n\s*await verifyPassword\(/.test(SRC)
    && await w.api.isStaffLogin(env, 'ana@example.com') && !(await w.api.isStaffLogin(env, 'c1@example.com')));
  // Their own page.
  const me = await call(w, uid, '/api/staff/me', { method: 'GET' });
  const seen = JSON.stringify(me.out);
  // NEGATIVE CONTROL (run 2026-10-15): the GET answer carrying `login: login?.data` beside the record made this read
  //   FAIL  G5 their own page shows their record and never a secret
  check('G5 their own page shows their record and never a secret',
    me.status === 200 && me.out.advocate.uid === uid && me.out.mustChange === true && me.out.role === 'advocate'
    && !/"(hash|salt|password|algo|rounds)"\s*:|pbkdf2/i.test(seen) && Array.isArray(me.out.specialties) && me.out.specialties.length === 6);
  const sneaky = await call(w, uid, '/api/staff/me', { json: { action: 'profile', name: 'Ana Rivera', active: false, owner: true, commissionPct: 100, advisor: { enabled: true }, credentials: 'RN, BCPA', bio: 'Hearts.', primarySpecialty: 'cardiology', specialties: ['Cardiology', 'Sleep', 'sleep'] } });
  const after = w.docs.get(`advocates/${uid}`);
  // NEGATIVE CONTROL (run 2026-10-15): cleanProfile passing `commissionPct` through made this read
  //   FAIL  G6 an advocate sets their own profile and nothing of his: not their share, their switch, their standing or their owner flag
  check('G6 an advocate sets their own profile and nothing of his: not their share, their switch, their standing or their owner flag',
    sneaky.status === 200 && after.commissionPct === 60 && after.active === true && after.owner === false && after.advisor.enabled === false
    && after.credentials === 'RN, BCPA' && after.primarySpecialty === 'Cardiology' && JSON.stringify(after.specialties) === '["Cardiology","Sleep"]',
    JSON.stringify(after));
  const optIn = await call(w, uid, '/api/staff/me', { json: { action: 'profile', advisorOptIn: true } });
  const enabled = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'update', uid, advisorEnabled: true } });
  const optOut = await call(w, uid, '/api/staff/me', { json: { action: 'profile', advisorOptIn: false } });
  const enableWithoutAsking = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'update', uid, advisorEnabled: true } });
  // NEGATIVE CONTROL (run 2026-10-15): the update's opt-in refusal taken out made this read
  //   FAIL  G7 he switches Advisor on only for someone who asked; opting out switches it off
  check('G7 he switches Advisor on only for someone who asked; opting out switches it off',
    optIn.status === 200 && enabled.status === 200 && optOut.status === 200 && w.docs.get(`advocates/${uid}`).advisor.enabled === false
    && enableWithoutAsking.status === 409, JSON.stringify([optIn.status, enabled.status, optOut.status, enableWithoutAsking.status]));
  const badCur = await call(w, uid, '/api/staff/me', { json: { action: 'password', current: 'nope-nope-nope', next: 'brand-new-pass-9' } });
  const notReady = await call(w, uid, '/api/staff/me', { json: { action: 'onboarded' } });
  const changed = await call(w, uid, '/api/staff/me', { json: { action: 'password', current: PW, next: 'brand-new-pass-9' } });
  const oldNow = await w.api.advocateLogin(env, 'ana@example.com', PW);
  const newNow = await w.api.advocateLogin(env, 'ana@example.com', 'brand-new-pass-9');
  const afterChange = { adv: { ...w.docs.get(`advocates/${uid}`) }, user: { ...w.docs.get(`users/${uid}`) } };
  // Their own password now, but no photo yet: still not finished.
  const noPhoto = await call(w, uid, '/api/staff/me', { json: { action: 'onboarded' } });
  // NEGATIVE CONTROL (run 2026-10-15): the password change skipping its verifyPassword of the current one made this read
  //   FAIL  G8 changing their password needs the current one, and afterwards only the new one opens the door
  check('G8 changing their password needs the current one, and afterwards only the new one opens the door',
    badCur.status === 403 && changed.status === 200 && oldNow === null && newNow?.uid === uid && newNow.mustChange === false,
    JSON.stringify([badCur.status, changed.status]));
  // The photo.
  const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).buffer;
  const fake = new TextEncoder().encode('<script>alert(1)</script>').buffer;
  const up = await call(w, uid, '/api/staff/headshot', { bytes: JPG, type: 'image/jpeg' });
  const liar = await call(w, uid, '/api/staff/headshot', { bytes: fake, type: 'image/jpeg' });
  const svg = await call(w, uid, '/api/staff/headshot', { bytes: fake, type: 'image/svg+xml' });
  const shotPath = w.docs.get(`advocates/${uid}`).headshotPath;
  const pub = await call(w, '', `/api/advocates/headshot?uid=${uid}`, { method: 'GET' });
  // NEGATIVE CONTROL (run 2026-10-15): looksLike answering true for any bytes made this read
  //   FAIL  G9 a photo is a real JPEG, PNG or WebP under their own prefix; anything else is refused; the public route serves it
  check('G9 a photo is a real JPEG, PNG or WebP under their own prefix; anything else is refused; the public route serves it',
    up.status === 200 && liar.status === 415 && svg.status === 415 && shotPath?.startsWith(`advocates/${uid}/headshot-`)
    && pub.status === 200 && pub.res.headers.get('content-type') === 'image/jpeg' && pub.res.headers.get('x-content-type-options') === 'nosniff',
    JSON.stringify([up.status, liar.status, svg.status, pub.status, shotPath]));
  // How they get paid is part of setup (2026-10-16): refused without it, then set the way their page sets it.
  const noPay = await call(w, uid, '/api/staff/me', { json: { action: 'onboarded' } });
  w.docs.set(`payouts/${uid}`, { method: 'zelle', hint: 'Zelle to an…om', sealed: 'x' });
  const finished = await call(w, uid, '/api/staff/me', { json: { action: 'onboarded' } });
  // NEGATIVE CONTROL (run 2026-10-15): the onboarded action's missing-fields refusal taken out made this read
  //   (first run MISSED: the password guard refused the same call; noPhoto added so each guard is met alone, then re-run)
  //   FAIL  G10 setup finishes only when the profile is whole and their own password is set, once, and tells him
  // RE-PINNED 2026-10-16 (v7.56): a way to be paid is needed too, so the photo-less call names two things missing,
  // the call with the photo but no way to be paid names one, and it finishes once both are in.
  // NEGATIVE CONTROL (run 2026-10-16, v7.56): staffMe's `missing.push('how you get paid')` taken out made this read
  //   FAIL  G10 setup finishes only when the profile is whole and their own password is set, once, and tells him
  check('G10 setup finishes only when the profile is whole and their own password is set, once, and tells him',
    notReady.status === 409 && noPhoto.status === 409 && JSON.stringify(noPhoto.out?.missing) === JSON.stringify(['headshot', 'how you get paid'])
    && noPay.status === 409 && JSON.stringify(noPay.out?.missing) === JSON.stringify(['how you get paid']) && finished.status === 200 && !!w.docs.get(`advocates/${uid}`).onboardedAt
    && w.pushes.length === 1 && w.pushes[0].uid === ERIC && !DASH.test(w.pushes[0].body), JSON.stringify([notReady.status, noPhoto.status, noPhoto.out, finished.status, w.pushes]));
  // His support tools.
  w.docs.set('trustedDevices/d1', { uid, email: 'ana@example.com' });
  w.docs.set('trustedDevices/d2', { uid: 'c1', email: 'c1@x.test' });
  // Their own change set the mark; set back, so the reset is seen setting it on its own (G18).
  w.docs.set(`advocates/${uid}`, { ...w.docs.get(`advocates/${uid}`), sessionsFrom: 1 });
  const reset = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'reset-password', uid, password: 'support-reset-77' } });
  const afterReset = await w.api.advocateLogin(env, 'ana@example.com', 'support-reset-77');
  const resetFrom = Number(w.docs.get(`advocates/${uid}`).sessionsFrom) || 0;
  // NEGATIVE CONTROL (run 2026-10-15): the reset's `await forgetDevices(env, uid);` taken out made this read
  //   FAIL  G11 his reset sets a password they must change, signs out every device of theirs and no one else's, and echoes nothing back
  check('G11 his reset sets a password they must change, signs out every device of theirs and no one else\'s, and echoes nothing back',
    reset.status === 200 && afterReset?.mustChange === true && !w.docs.has('trustedDevices/d1') && w.docs.has('trustedDevices/d2')
    && !JSON.stringify(reset.out).includes('support-reset-77'));
  w.docs.set('trustedDevices/d3', { uid, email: 'ana@example.com' });
  // Each of his two actions is seen ending sessions on its own: the reset's mark is set back before the turn-off.
  w.docs.set(`advocates/${uid}`, { ...w.docs.get(`advocates/${uid}`), sessionsFrom: 1 });
  const off = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'deactivate', uid } });
  const offLogin = await w.api.advocateLogin(env, 'ana@example.com', 'support-reset-77');
  const offStaff = STAFF.staffFrom(env, { uid }, { data: w.docs.get(`users/${uid}`) }, { data: w.docs.get(`advocates/${uid}`) });
  const offPhoto = await call(w, '', `/api/advocates/headshot?uid=${uid}`, { method: 'GET' });
  const ownerOff = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'deactivate', uid: ERIC } });
  // NEGATIVE CONTROL (run 2026-10-15): deactivate leaving `active` true made this read
  //   FAIL  G12 turning an advocate off locks them out at once: no door, no staff, no devices, no public photo; his own account cannot be turned off
  check('G12 turning an advocate off locks them out at once: no door, no staff, no devices, no public photo; his own account cannot be turned off',
    off.status === 200 && offLogin === null && offStaff === null && !w.docs.has('trustedDevices/d3') && offPhoto.status === 404 && ownerOff.status === 409);

  // ---- the four audits (2026-10-16): sessions end, setup comes first, a client's address stays theirs ----
  const advNow = w.docs.get(`advocates/${uid}`);
  const before = Number(advNow.sessionsFrom) - 30;
  const back = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'activate', uid } });
  const oldSession = STAFF.staffFrom(env, { uid, authTime: before }, { data: w.docs.get(`users/${uid}`) }, { data: w.docs.get(`advocates/${uid}`) });
  const newSession = STAFF.staffFrom(env, { uid, authTime: Math.floor(Date.now() / 1000) + 5 }, { data: w.docs.get(`users/${uid}`) }, { data: w.docs.get(`advocates/${uid}`) });
  // NEGATIVE CONTROL (run 2026-10-16): deactivate's `...(on ? {} : { sessionsFrom: nowSec() })` made `...({})` made this read
  //   FAIL  G18 his reset and his turning off end every session begun before them, even after he turns them back on; a session begun since works, set up first after a reset
  // NEGATIVE CONTROL (run 2026-10-16): the reset's patch without `sessionsFrom: nowSec()` made this read
  //   FAIL  G18 his reset and his turning off end every session begun before them, even after he turns them back on; a session begun since works, set up first after a reset
  check('G18 his reset and his turning off end every session begun before them, even after he turns them back on; a session begun since works, set up first after a reset',
    back.status === 200 && resetFrom > 1000 && Number(advNow.sessionsFrom) > 1000 && oldSession === null && newSession?.uid === uid && newSession.setup === true
    && advNow.mustChange === true && w.docs.get(`users/${uid}`)?.setupPending === true,
    JSON.stringify({ sessionsFrom: advNow.sessionsFrom, oldSession, newSession, mustChange: advNow.mustChange }));
  // NEGATIVE CONTROL (run 2026-10-16): the password change's `forgetDevices(env, staff.uid)` and fresh token taken out made this read
  //   FAIL  G19 their own new password ends every other session and device, hands this one a fresh session and device token, and clears the password step
  check('G19 their own new password ends every other session and device, hands this one a fresh session and device token, and clears the password step',
    changed.out?.token === `token-for-${uid}` && changed.out?.deviceToken === `device-for-${uid}`
    && afterChange.adv.mustChange === false && Number(afterChange.adv.sessionsFrom) > 0 && afterChange.user.setupPending === true
    && !JSON.stringify(changed.out).includes('brand-new-pass-9'),
    JSON.stringify({ out: changed.out, adv: { mustChange: afterChange.adv.mustChange, sessionsFrom: afterChange.adv.sessionsFrom }, user: afterChange.user }));
  w.docs.set('users/c9', { role: 'client', email: 'client.nine@x.test' });
  const takeClient = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'create', name: 'Not Them', email: 'Client.Nine@x.test', password: 'a-fine-password-1' } });
  const derived = `e${createHash('sha256').update('uid:derived@x.test').digest('hex').slice(0, 31)}`;
  w.docs.set(`users/${derived}`, { role: 'client' });
  const takeDerived = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'create', name: 'Not Them Either', email: 'derived@x.test', password: 'a-fine-password-1' } });
  const fresh = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'create', name: 'New Person', email: 'new.person@x.test', password: 'a-fine-password-1' } });
  // NEGATIVE CONTROL (run 2026-10-16): create's `if (await isClientAddress(env, email))` made `if (false)` made this read
  //   FAIL  G20 a client's address is never made an advocate's, whether their profile carries it or it derives their account; a new address is, set up first
  check('G20 a client\'s address is never made an advocate\'s, whether their profile carries it or it derives their account; a new address is, set up first',
    takeClient.status === 409 && /belongs to a client/.test(takeClient.out?.error || '') && takeDerived.status === 409
    && fresh.status === 200 && w.docs.get(`advocates/${fresh.out.uid}`)?.mustChange === true && w.docs.get(`users/${fresh.out.uid}`)?.setupPending === true,
    JSON.stringify([takeClient.status, takeDerived.status, fresh.status]));
  const pct = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'update', uid, commissionPct: 55 } });
  const badPct = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'update', uid, commissionPct: 55.5 } });
  // NEGATIVE CONTROL (run 2026-10-15): the share's `Number.isInteger` loosened to `Number.isFinite` made this read
  //   FAIL  G13 his share setting is a whole percent from 0 to 100, per advocate
  check('G13 his share setting is a whole percent from 0 to 100, per advocate',
    pct.status === 200 && w.docs.get(`advocates/${uid}`).commissionPct === 55 && badPct.status === 400);
  // NEGATIVE CONTROL (run 2026-10-15): an em dash put in admin-advocates.js's header made this read
  //   FAIL  G14 the accounts module carries no dash
  // His own photo ships with the site (2026-10-15): his cases show his face before he uploads one.
  const hisPhoto = await call(w, '', `/api/advocates/headshot?uid=${ERIC}`, { method: 'GET' });
  w.docs.set('advocates/adv-nophoto', { uid: 'adv-nophoto', active: true, owner: false });
  const othersNone = await call(w, '', '/api/advocates/headshot?uid=adv-nophoto', { method: 'GET' });
  // NEGATIVE CONTROL (run 2026-10-15): the owner fallback answering for any active advocate without a photo made this read
  //   FAIL  G15 his own photo stands in until he uploads one; another advocate without a photo has none
  check('G15 his own photo stands in until he uploads one; another advocate without a photo has none',
    hisPhoto.status === 302 && hisPhoto.res.headers.get('location') === '/img/eric-headshot.jpg' && othersNone.status === 404,
    JSON.stringify([hisPhoto.status, hisPhoto.res.headers.get('location'), othersNone.status]));
  // Eric, 2026-10-15: "I should be able to upload a bio and profile picture for each [contractor] when they submit it
  // to me." His door for it is his alone; theirs stays their own; the home asks for his face as uid=owner.
  const JPG2 = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 9, 9, 9]).buffer;
  // An advocate who is on (Ana was turned off in G12), so their 404 is his door saying no, not their account being off.
  w.docs.set('users/adv-live', { role: 'advocate' });
  w.docs.set('advocates/adv-live', { uid: 'adv-live', active: true, owner: false, name: 'Live One' });
  const hisUpload = await call(w, ERIC, '/api/admin/advocates/headshot?uid=adv-nophoto', { bytes: JPG2, type: 'image/jpeg' });
  const theirTry = await call(w, 'adv-live', '/api/admin/advocates/headshot?uid=adv-nophoto', { bytes: JPG2, type: 'image/jpeg' });
  const hisLie = await call(w, ERIC, '/api/admin/advocates/headshot?uid=adv-nophoto', { bytes: fake, type: 'image/jpeg' });
  const hisBio = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'update', uid: 'adv-nophoto', bio: 'Twelve years in neurology clinics.', credentials: 'RN' } });
  const noName = await call(w, ERIC, '/api/admin/advocates', { json: { action: 'update', uid: 'adv-nophoto', name: '   ' } });
  const owner = await call(w, '', '/api/advocates/headshot?uid=owner', { method: 'GET' });
  const nophoto = w.docs.get('advocates/adv-nophoto');
  // NEGATIVE CONTROL (run 2026-10-15, v7.50): adminHeadshot asking requireStaff instead of requireAdmin made this read
  //   FAIL  G16 he uploads a contractor's photo and bio from employer mode, checked like their own; they cannot use his door; the home finds his face as owner
  check('G16 he uploads a contractor\'s photo and bio from employer mode, checked like their own; they cannot use his door; the home finds his face as owner',
    hisUpload.status === 200 && nophoto.headshotPath?.startsWith('advocates/adv-nophoto/headshot-') && theirTry.status === 404 && hisLie.status === 415
    && hisBio.status === 200 && nophoto.bio === 'Twelve years in neurology clinics.' && nophoto.credentials === 'RN' && noName.status === 400
    && owner.status === 302 && owner.res.headers.get('location') === '/img/eric-headshot.jpg',
    JSON.stringify([hisUpload.status, theirTry.status, hisLie.status, hisBio.status, noName.status, owner.status]));
  // RE-PINNED 2026-10-16 (v7.55): the Advocates tab became Employer mode's accounts (one Team page); its module is
  // admin-accounts.js, and admin-advocates.js is gone.
  // NEGATIVE CONTROL (run 2026-10-16, v7.55): an em dash put in admin-accounts.js's header made G14 read FAIL.
  check('G14 the accounts module carries no dash', !DASH.test(SRC) && !DASH.test(f('public/js/admin-accounts.js')) && !DASH.test(f('public/js/admin-account.js')));
}

// ---- H. the Worker's doors for them -------------------------------------------
console.log('\n--- H. doors ---');
{
  const login = lift(W, 'async function handleAdminLogin(request, env) {');
  const code = lift(W, 'async function handleRequestCode(request, env) {');
  // NEGATIVE CONTROL (run 2026-10-15): the advocate branch's throttle increment taken out made this read
  //   FAIL  H1 an advocate's address gets the password box, and their door shares his throttle, his sentence and his 400ms
  check('H1 an advocate\'s address gets the password box, and their door shares his throttle, his sentence and his 400ms',
    /if \(await isStaffLogin\(env, email\)\) return json\(\{ ok: true, mode: 'password' \}\);/.test(code)
    && /if \(!emailOk\) \{\n[\s\S]*?const adv = email \? await advocateLogin\(env, email, password\)\.catch\(\(\) => null\) : null;\n\s*if \(!adv\) \{\n\s*await cache\.put\(\n\s*rlKey,\n\s*new Response\(String\(fails \+ 1\)/.test(login)
    && /return json\(\{ error: 'Wrong email or password\.' \}, 401\);\n\s*\}\n\s*await cache\.delete\(rlKey\);\n\s*const token = await mintCustomToken\(env, adv\.uid\);/.test(login)
    && login.indexOf('setTimeout(r, 400)') < login.indexOf('if (!emailOk) {'));
  // The cookie: signed for staff only, and the fund page is still his.
  const cookieSrc = [lift(W, 'function adminKey(env) {'), lift(W, 'async function signAdminCookie(env, uid) {'), lift(W, 'async function adminCookieUid(request, env) {'),
    lift(W, 'async function adminCookieHeader(env, uid) {'), lift(W, 'async function withAdminCookie(env, res, uid) {'), lift(W, 'async function withStaffCookie(env, res, uid) {'),
    lift(W, 'function timingSafeEqual(a, b) {')].join('\n');
  const docs = new Map([['advocates/adv-a', { active: true }], ['advocates/adv-off', { active: false }]]);
  // eslint-disable-next-line no-new-func
  const mk = new Function('getDoc', `const ADMIN_COOKIE = 'pa_adm'; const ADMIN_COOKIE_DAYS = 14; let adminKeyPromise = null;\n${cookieSrc}\nreturn { signAdminCookie, adminCookieUid, withStaffCookie };`)(async (env, p) => (docs.has(p) ? { data: docs.get(p) } : null));
  const env = { ADMIN_UID: ERIC, FIREBASE_SERVICE_ACCOUNT: '{"k":"test"}' };
  const res = (o) => new Response(JSON.stringify(o));
  const cookieOf = (r) => (r.headers.get('set-cookie') || '').match(/pa_adm=([^;]+)/)?.[1] || '';
  const forA = cookieOf(await mk.withStaffCookie(env, res({}), 'adv-a'));
  const forOff = cookieOf(await mk.withStaffCookie(env, res({}), 'adv-off'));
  const forClient = cookieOf(await mk.withStaffCookie(env, res({}), 'c1'));
  const forEric = cookieOf(await mk.withStaffCookie(env, res({}), ERIC));
  const read = (c) => mk.adminCookieUid({ headers: new Headers({ cookie: `pa_adm=${c}` }) }, env);
  const forged = forA.replace(/^adv-a/, 'adv-b');
  // NEGATIVE CONTROL (run 2026-10-15): withStaffCookie skipping the active check made this read
  //   FAIL  H2 the working pages' cookie is signed for him and for active advocates only, and a forged uid fails the signature
  check('H2 the working pages\' cookie is signed for him and for active advocates only, and a forged uid fails the signature',
    !!forA && !forOff && !forClient && !!forEric && (await read(forA)) === 'adv-a' && (await read(forEric)) === ERIC && (await read(forged)) === null,
    JSON.stringify({ forA: !!forA, forOff: !!forOff, forClient: !!forClient }));
  // NEGATIVE CONTROL (run 2026-10-15): the fund page gate's `=== env.ADMIN_UID` taken out made this read
  //   FAIL  H3 the hidden fund page asks for HIS uid on the cookie, and the session route and device sign-in serve staff
  check('H3 the hidden fund page asks for HIS uid on the cookie, and the session route and device sign-in serve staff',
    /const his = !!env\.ADMIN_UID && \(await adminCookieUid\(request, env\)\.catch\(\(\) => null\)\) === env\.ADMIN_UID;/.test(W)
    && /const staff = await requireStaff\(request, env\);\n\s*if \(!staff\) return json\(\{ error: 'Not found' \}, 404\);\n\s*return new Response\(JSON\.stringify\(\{ ok: true, role:/.test(lift(W, 'async function handleAdminSession(request, env) {'))
    && /return withStaffCookie\(env, json\(\{ token \}\), d\.uid\);/.test(lift(W, 'async function handleDeviceSignin(request, env) {')));
  // NEGATIVE CONTROL (run 2026-10-15): the router handing `requireAdmin: requireStaff` to the accounts module made this read
  //   FAIL  H4 the routes reach the accounts module, with his gate and the staff gate handed in
  // RE-PINNED 2026-10-15 (v7.50): his upload of a contractor's photo (/api/admin/advocates/headshot) reaches it too.
  // NEGATIVE CONTROL (run 2026-10-15, v7.50): the router handing `requireAdmin: requireStaff` again made H4 read FAIL.
  // RE-PINNED 2026-10-16 (v7.56): the module also gets mintCustomToken and issueDeviceToken, so a new password hands
  // the current device a fresh session while every other one ends.
  // NEGATIVE CONTROL (run 2026-10-16, v7.56): the router handing `requireAdmin: requireStaff` once more made H4 read FAIL.
  check('H4 the routes reach the accounts module, with his gate and the staff gate handed in',
    /if \(url\.pathname === '\/api\/admin\/advocates' \|\| url\.pathname === '\/api\/admin\/advocates\/headshot' \|\| url\.pathname\.startsWith\('\/api\/staff\/'\) \|\| url\.pathname\.startsWith\('\/api\/advocates\/'\)\)\n\s*return await handleAdvocates\(request, env, url, \{ requireAdmin, requireStaff, json, mintCustomToken, issueDeviceToken \}\);/.test(W));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
