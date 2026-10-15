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
  const adv = (active) => ({ data: { active } });
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
];
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
        ['advocates/adv-a', { active: true }], ['advocates/adv-b', { active: true }],
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
    ['advocates/adv-a', { active: true }], ['advocates/adv-b', { active: true }], ['advocates/adv-off', { active: false }],
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
  const listed = STAFF_ROUTES.map((r) => r[0]).sort();
  // NEGATIVE CONTROL (run 2026-10-15): handleLeadInvite switched to `const staff = await requireStaff(request, env);` made this read
  //   FAIL  D1 the routes that take an advocate are exactly the ones checked above, so a new one cannot slip in unchecked
  check('D1 the routes that take an advocate are exactly the ones checked above, so a new one cannot slip in unchecked',
    JSON.stringify(takers) === JSON.stringify(listed), `worker: ${takers.join(',')}`);
  const reqStaff = lift(W, 'async function requireStaff(request, env) {');
  // NEGATIVE CONTROL (run 2026-10-15): requireStaff handing staffFrom a made-up active record made this read
  //   FAIL  D2 requireStaff reads the role and the advocate record on the server, and decides with the shared rule
  check('D2 requireStaff reads the role and the advocate record on the server, and decides with the shared rule',
    /const profile = await getDoc\(env, `users\/\$\{user\.uid\}`\);/.test(reqStaff) && /advocates\/\$\{user\.uid\}/.test(reqStaff)
    && /return staffFrom\(env, user, profile, advocate\);/.test(reqStaff));
  // Everything about the platform as a whole stays his alone.
  const hisAlone = ['handleSetRates', 'handleCreateSlots', 'handleAdminLeads', 'handleLedger', 'handleLeadInvite', 'handleStatsRecompute', 'handleSelfCase', 'handleShowcaseCase', 'handleDeleteCase', 'handleFamilyCase', 'handleBookingClosure', 'handleOfficeHoursControl', 'handleFullCapacity', 'handleWork', 'handleWorkPresence', 'handleDaySummary', 'handleChatReply', 'handlePersonal'];
  const wrong = hisAlone.filter((n) => { const m = W.match(new RegExp(`\\n(?:async )?function ${n}\\([^)]*\\) \\{[\\s\\S]{0,300}`)); return !m || !/await requireAdmin\(request, env\)/.test(m[0]); });
  // NEGATIVE CONTROL (run 2026-10-15): handleSetRates asking requireStaff made this read
  //   FAIL  D3 prices, calendar, leads, the ledger, invitations, his own and family cases, the showcase, the work clock and the private reading stay his alone for now
  check('D3 prices, calendar, leads, the ledger, invitations, his own and family cases, the showcase, the work clock and the private reading stay his alone for now',
    !wrong.length, wrong.join(','));
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

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
