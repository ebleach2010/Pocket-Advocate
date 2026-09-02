// fitcall.mjs - the free 15-minute fit call, driven against the REAL code.
//
// Eric, 2026-09-01, choosing it from the landing sweep: "Yes, add the free
// fit call." The one door on the site with no sign-in and no payment, which
// makes it the one door a script can lean on and the one place a stranger's
// details could land somewhere world-readable. Both halves are pinned here.
//
// WHY THIS LIFTS AND RUNS: the whole risk is in the ORDER of the refusals and
// in WHICH document the person's details are written to. A regex cannot tell
// a name on the slot from a name on the lead. So handleFitCall and its admin
// route are lifted out of worker/index.js and driven over an in-memory
// Firestore that honours mustNotExist and ifUpdateTime, the same harness
// clock.mjs and availability.mjs use.
//
// Run: node fitcall.mjs
//
// ===========================================================================
// NEGATIVE CONTROLS - what was broken on purpose, and what went red
//
// A check nobody has watched fail is not evidence. Every row below was run by
// editing the real source, running this file, reading the output, and putting
// the source back. The right-hand column is what was OBSERVED.
//
//   the break                                        what went red
//   ---------------------------------------------------------------------
//   handleCreateSlots reads body.durationMin         A2
//     for a fit slot
//   `name` added to the slot patch and its mask      A4, A5
//   the slotTimingProblem call deleted               B8
//   the prior-lead query result ignored              B10
//   the honeypot line deleted                        B12
//   ifUpdateTime dropped from the slot take          B13
//   `n >= FIT_IP_LIMIT` becomes `n >`                C1
//   the pingAdmins line deleted                      D1
//   the admin route's 404 becomes 403                E1
//   join-link patches the slot as well               E3
//   the reopen patch in cancel deleted               E4
//   the fit guard in handleCheckout deleted          F1
//   the skip line in book.js deleted                 F4
//   `match /leads/{id} { allow read: if true; }`     F6
//     added to the rules
//   '/fit' removed from the audit's CLIENT_PAGES     F7
//   the hero's first door retargeted at /book.html   F8
//   the demo route renamed /api/fit-calls            F16
//   an em dash typed into fit.js's intro             F18
//
// Every break was one red row, restored by its unique context, and the
// file read 57/57 again after each one (2026-09-02).
// ===========================================================================
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { slotTimingProblem, windowProblem, LEAD_TIME_HOURS } from '../../worker/schedule.js';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const strip = (s) => s
  .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const code = (p) => strip(f(p));
const CODE = strip(SRC);

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

// ---- lift the real source ------------------------------------------------
function fn(name) {
  const m = SRC.match(new RegExp(`\\nasync function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
function sfn(name) {
  const m = SRC.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
function konst(name) {
  const m = SRC.match(new RegExp(`\\nconst ${name} = [^;]+;`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0];
}
const LIFTED = [
  konst('METHODS'), konst('FIT_KIND'), konst('FIT_CALL_MIN'), konst('FIT_IP_LIMIT'),
  konst('FIT_NOTE_MAX'), konst('MT_FMT'),
  sfn('str'), sfn('validTz'), sfn('firstName'), sfn('escHtml'), sfn('json'),
  sfn('whenHtml'), sfn('closedMessage'), sfn('slotIdFor'),
  fn('readBookingClosure'), fn('pingAdmins'),
  fn('fitThrottled'), fn('handleFitCall'), fn('fitNotify'), fn('handleAdminFitCalls'),
  fn('handleCreateSlots'),
].join('\n');

// ---- the world it runs in ------------------------------------------------
let docs, pushes, emails, writes, adminOk;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const rows = (coll) => [...docs.entries()]
  .filter(([p]) => p.startsWith(`${coll}/`) && p.split('/').length === 2)
  .map(([p, d]) => ({ id: p.split('/')[1], data: clone(d.data) }));

const deps = {
  getDoc: async (env, path) => (docs.has(path)
    ? { data: clone(docs.get(path).data), updateTime: String(docs.get(path).v) } : null),
  // Honours the two preconditions the handlers lean on. A harness that
  // ignored ifUpdateTime could not show the lost race, and one that ignored
  // mustNotExist could not show a replay.
  patchDoc: async (env, path, patch, opts = {}) => {
    const cur = docs.get(path);
    if (opts.mustNotExist && cur) return false;
    if (opts.ifUpdateTime && (!cur || String(cur.v) !== String(opts.ifUpdateTime))) return false;
    const next = { ...(cur?.data || {}) };
    for (const k of opts.mask || Object.keys(patch)) next[k] = clone(patch[k]);
    docs.set(path, { data: next, v: (cur?.v || 0) + 1 });
    writes.push({ path, patch: clone(patch), mask: opts.mask || null });
    return true;
  },
  queryDocs: async (env, coll, filters, limit = 20) => rows(coll)
    .filter((r) => filters.every(([field, op, v]) => (op === 'EQUAL' ? r.data[field] === v : true)))
    .slice(0, limit),
  listDocs: async (env, coll) => rows(coll),
  batchCreate: async (env, entries) => {
    let created = 0; let skipped = 0;
    for (const e of entries) {
      if (docs.has(e.path)) { skipped++; continue; }
      docs.set(e.path, { data: clone(e.data), v: 1 });
      created++;
    }
    return { created, skipped };
  },
  notifyUser: async (env, uid, msg) => { pushes.push({ uid, ...msg }); },
  sendEmail: async (env, msg) => { emails.push(msg); return true; },
  requireAdmin: async () => (adminOk ? { uid: 'eric' } : null),
  slotTimingProblem, windowProblem, LEAD_TIME_HOURS,
  crypto: webcrypto,
};
const build = new Function(
  ...Object.keys(deps),
  `${LIFTED}
   return { handleFitCall, handleAdminFitCalls, handleCreateSlots, fitThrottled,
            FIT_KIND, FIT_CALL_MIN, FIT_IP_LIMIT, FIT_NOTE_MAX };`,
);
const W = build(...Object.values(deps));

const env = { ADMIN_EMAIL: 'eric@example.com', PUBLIC_BASE_URL: 'https://example.com' };
const req = (body, { ip = '1.2.3.4', method = 'POST' } = {}) => ({
  method,
  json: async () => body,
  headers: { get: (k) => (k === 'cf-connecting-ip' ? ip : null) },
});
// A wall-clock hour in MST, N days out: inside the lead window and the
// horizon, inside business hours, whatever day this runs.
const base = new Date();
const at = (days, hourMst, minute = 0) => new Date(Date.UTC(
  base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + days, hourMst + 7, minute));
function reset() {
  docs = new Map(); pushes = []; emails = []; writes = []; adminOk = true;
  docs.set('users/eric', { data: { role: 'admin' }, v: 1 });
  docs.set('availability/fit-1', { data: { start: at(5, 10), durationMin: 15, state: 'open', kind: 'fit' }, v: 1 });
  docs.set('availability/fit-2', { data: { start: at(6, 10), durationMin: 15, state: 'open', kind: 'fit' }, v: 1 });
  docs.set('availability/case-1', { data: { start: at(5, 13), durationMin: 60, state: 'open' }, v: 1 });
}
const GOOD = {
  slotId: 'fit-1', name: 'Riley Test', email: 'Riley@Example.com', phone: '+1 208 555 0100',
  method: 'phone', note: 'Three neurologists, three answers.', tz: 'America/New_York', us: true, website: '',
};
const call = async (body, opts) => {
  const r = await W.handleFitCall(req(body, opts), env);
  return { status: r.status, out: await r.json() };
};
const admin = async (body, opts) => {
  const r = await W.handleAdminFitCalls(req(body, { method: body ? 'POST' : 'GET', ...opts }), env);
  return { status: r.status, out: await r.json() };
};
const slot = (id) => docs.get(`availability/${id}`)?.data;
const leads = () => rows('leads');

// ---------------------------------------------------------------------------
// A. THE SHAPE: fifteen minutes, kind:'fit', and the person is never on the
//    world-readable slot
// ---------------------------------------------------------------------------
console.log('\n--- A. the shape ---');
check('A1 a fit call is fifteen minutes and its kind is "fit"',
  W.FIT_CALL_MIN === 15 && W.FIT_KIND === 'fit');

reset();
{
  // NEGATIVE CONTROL (run 2026-09-02): making handleCreateSlots read
  // body.durationMin for a fit slot made this read
  //   FAIL  A2 opening fit slots fixes them at fifteen minutes whatever the body says
  const r = await W.handleCreateSlots(req({ starts: [at(7, 9).toISOString()], kind: 'fit', durationMin: 60 }), env);
  const out = await r.json();
  const made = [...docs.entries()].find(([p]) => p.startsWith('availability/') && !/fit-|case-/.test(p))?.[1].data;
  check('A2 opening fit slots fixes them at fifteen minutes whatever the body says',
    out.created === 1 && made?.durationMin === 15 && made?.kind === 'fit', JSON.stringify(made));
}
reset();
{
  const r = await W.handleCreateSlots(req({ starts: [at(7, 9).toISOString()] }), env);
  await r.json();
  const made = [...docs.entries()].find(([p]) => p.startsWith('availability/') && !/fit-|case-/.test(p))?.[1].data;
  check('A3 a case slot opened the old way is sixty minutes and carries no kind',
    made?.durationMin === 60 && !('kind' in made));
}

reset();
const booked = await call(GOOD);
{
  const s = slot('fit-1');
  const l = leads()[0];
  // NEGATIVE CONTROL (run 2026-09-02): adding `name` to the slot patch made
  // this read
  //   FAIL  A4 the taken slot carries state and leadId and nothing about the person
  const slotKeys = Object.keys(s).sort().join(',');
  check('A4 the taken slot carries state and leadId and nothing about the person',
    booked.status === 200 && s.state === 'booked' && typeof s.leadId === 'string'
    && slotKeys === 'durationMin,kind,leadId,start,state',
    slotKeys);
  const take = writes.find((w) => w.path === 'availability/fit-1');
  check('A5 the slot take is masked to exactly state and leadId',
    take && Array.isArray(take.mask) && take.mask.slice().sort().join() === 'leadId,state');
  check('A6 the person lands on leads/{leadId}, name, email (lowercased), phone, note, zone, time',
    l && l.id === s.leadId && l.data.name === 'Riley Test' && l.data.email === 'riley@example.com'
    && l.data.phone === '+1 208 555 0100' && l.data.method === 'phone'
    && l.data.note === 'Three neurologists, three answers.' && l.data.tz === 'America/New_York'
    && l.data.slotId === 'fit-1' && l.data.state === 'booked' && l.data.durationMin === 15);
  check('A7 the lead write is mustNotExist, so a replayed id can never overwrite a person',
    writes.find((w) => w.path === `leads/${s.leadId}`) && (() => {
      const src = fn('handleFitCall');
      return /patchDoc\(env, `leads\/\$\{leadId\}`, lead, \{ mustNotExist: true \}\)/.test(src);
    })());
  check('A8 the answer carries ok, leadId and start, and nothing personal',
    booked.out.ok === true && booked.out.leadId === s.leadId && !!booked.out.start
    && !('email' in booked.out) && !('name' in booked.out) && !('phone' in booked.out));
  check('A9 the handler has no Stripe in it',
    !/stripePost|checkout\/sessions|line_items/.test(fn('handleFitCall') + fn('fitNotify')));
}

// ---------------------------------------------------------------------------
// B. THE REFUSALS, each one writing nothing
// ---------------------------------------------------------------------------
console.log('\n--- B. the refusals ---');
const refused = async (name, body, wantStatus, wantRe, opts) => {
  reset();
  const r = await call(body, opts);
  const clean = writes.length === 0 && leads().length === 0 && slot('fit-1').state === 'open';
  check(name, r.status === wantStatus && wantRe.test(r.out.error || '') && clean,
    `${r.status} ${r.out.error || ''} writes=${writes.length}`);
};
await refused('B1 a sixty-minute case slot is refused, nothing written',
  { ...GOOD, slotId: 'case-1' }, 409, /no longer available/);
await refused('B2 a missing name is refused', { ...GOOD, name: 'R' }, 400, /name/);
await refused('B3 a bad email is refused', { ...GOOD, email: 'riley@nowhere' }, 400, /email/);
await refused('B4 no method is refused', { ...GOOD, method: 'carrier pigeon' }, 400, /Phone or video/);
await refused('B5 a phone call with no number is refused', { ...GOOD, phone: '' }, 400, /phone number/);
await refused('B6 outside the US and Canada is refused', { ...GOOD, us: false }, 400, /United States and Canada/);
await refused('B7 no slot is refused', { ...GOOD, slotId: '' }, 400, /Pick a time/);
reset();
docs.set('availability/soon', { data: { start: new Date(Date.now() + 3600_000), durationMin: 15, state: 'open', kind: 'fit' }, v: 1 });
{
  const r = await call({ ...GOOD, slotId: 'soon' });
  // NEGATIVE CONTROL (run 2026-09-02): deleting the slotTimingProblem call
  // made this read
  //   FAIL  B8 a slot inside the 72-hour lead window is refused by the shared timing rule
  check('B8 a slot inside the 72-hour lead window is refused by the shared timing rule',
    r.status === 409 && /72 hours/.test(r.out.error) && slot('soon').state === 'open' && leads().length === 0);
}
reset();
docs.set('settings/booking', { data: { closedUntil: at(9, 12) }, v: 1 });
{
  const r = await call(GOOD);
  check('B9 closed books close this door too, with the same sentence a case gets',
    r.status === 409 && /not taking new cases until/.test(r.out.error) && slot('fit-1').state === 'open');
}
reset();
docs.set('leads/prior', { data: { email: 'riley@example.com', state: 'booked', start: at(6, 10) }, v: 1 });
{
  const r = await call(GOOD);
  // NEGATIVE CONTROL (run 2026-09-02): dropping the prior-lead query made this read
  //   FAIL  B10 one call per person: a second booking on the same email is refused
  check('B10 one call per person: a second booking on the same email is refused',
    r.status === 409 && /already have a call/.test(r.out.error) && slot('fit-1').state === 'open' && leads().length === 1);
}
reset();
docs.set('leads/old', { data: { email: 'riley@example.com', state: 'booked', start: at(-3, 10) }, v: 1 });
{
  const r = await call(GOOD);
  check('B11 a past call on the same email does not block a new one',
    r.status === 200 && slot('fit-1').state === 'booked');
}
reset();
{
  const r = await call({ ...GOOD, website: 'http://spam.example' });
  // NEGATIVE CONTROL (run 2026-09-02): removing the honeypot line made this read
  //   FAIL  B12 the honeypot answers a cheerful 200 and writes, emails and pushes nothing
  check('B12 the honeypot answers a cheerful 200 and writes, emails and pushes nothing',
    r.status === 200 && r.out.ok === true && writes.length === 0 && emails.length === 0
    && pushes.length === 0 && slot('fit-1').state === 'open');
}
reset();
{
  // Two people, one time. The second take sees a stale updateTime and loses.
  const stale = await deps.getDoc(env, 'availability/fit-1');
  docs.set('availability/fit-1', { ...docs.get('availability/fit-1'), v: 2 });
  void stale;
  // Simulated the way it happens: the doc moved between the read and the
  // take. Wrap getDoc so the handler reads the OLD version.
  const realGet = deps.getDoc;
  let once = true;
  const W2 = build(...Object.values({ ...deps, getDoc: async (e, p) => {
    const d = await realGet(e, p);
    if (p === 'availability/fit-1' && once) { once = false; return { ...d, updateTime: '1' }; }
    return d;
  } }));
  const r = await W2.handleFitCall(req(GOOD), env);
  const out = await r.json();
  // NEGATIVE CONTROL (run 2026-09-02): dropping ifUpdateTime from the take
  // made this read
  //   FAIL  B13 a lost race is a 409 with no lead written and the slot untouched
  check('B13 a lost race is a 409 with no lead written and the slot untouched',
    r.status === 409 && /just took/.test(out.error) && leads().length === 0 && slot('fit-1').state === 'open');
}

// ---------------------------------------------------------------------------
// C. THE THROTTLE, on a fake edge cache
// ---------------------------------------------------------------------------
console.log('\n--- C. the throttle ---');
{
  const cells = new Map();
  globalThis.caches = { default: {
    match: async (k) => (cells.has(k.url) ? new Response(cells.get(k.url)) : undefined),
    put: async (k, res) => { cells.set(k.url, await res.text()); },
  } };
  reset();
  const codes = [];
  for (let i = 0; i < W.FIT_IP_LIMIT + 1; i++) codes.push((await call({ ...GOOD, name: '' })).status);
  const other = (await call({ ...GOOD, name: '' }, { ip: '9.9.9.9' })).status;
  delete globalThis.caches;
  // NEGATIVE CONTROL (run 2026-09-02): `n >= FIT_IP_LIMIT` to `n > FIT_IP_LIMIT` made this read
  //   FAIL  C1 the sixth try from one connection in an hour is 429; the fifth is not
  check('C1 the sixth try from one connection in an hour is 429; the fifth is not',
    codes.slice(0, W.FIT_IP_LIMIT).every((c) => c === 400) && codes[W.FIT_IP_LIMIT] === 429, codes.join());
  check('C2 another connection is not throttled by the first', other === 400);
  check('C3 the throttle counts before the body is read, so a flood of junk is a flood of 429s',
    /fitThrottled\(ip\)[\s\S]*request\.json\(\)/.test(fn('handleFitCall')));
  check('C4 with no edge cache at all (this harness) nothing is throttled and nothing throws',
    (await call({ ...GOOD, name: '' })).status === 400);
}

// ---------------------------------------------------------------------------
// D. THE NOTICES: two to Eric, one to the person, once
// ---------------------------------------------------------------------------
console.log('\n--- D. the notices ---');
reset();
await call(GOOD);
{
  const toEric = emails.filter((e) => e.to === env.ADMIN_EMAIL);
  const toThem = emails.filter((e) => e.to === 'riley@example.com');
  // NEGATIVE CONTROL (run 2026-09-02): deleting the pingAdmins line made this read
  //   FAIL  D1 one push to the admin, naming the time in MST
  check('D1 one push to the admin, naming the time in MST',
    pushes.length === 1 && pushes[0].uid === 'eric' && /MST/.test(pushes[0].body)
    && pushes[0].link === '/admin.html#fit-calls');
  check('D2 one email to Eric with the name, the email, the number and the note',
    toEric.length === 1 && /Riley Test/.test(toEric[0].html) && /riley@example.com/.test(toEric[0].html)
    && /208 555 0100/.test(toEric[0].html) && /Three neurologists/.test(toEric[0].html));
  check('D3 one email to the person with the time in both zones and the case link',
    toThem.length === 1 && /your time/.test(toThem[0].html) && /my time/.test(toThem[0].html)
    && /book\.html/.test(toThem[0].html) && /I will call you at/.test(toThem[0].html));
  // The rule in worker/email.js: no business number in anything that lands in
  // an inbox (Eric, 2026-08-21).
  check('D4 no business number in any of the three',
    emails.every((e) => !/670\s?8608/.test(e.html)) && !/670\s?8608/.test(pushes[0].body));
  check('D5 nothing in the notices is dashed',
    emails.every((e) => !/[–—]/.test(e.html + e.subject)) && !/[–—]/.test(pushes[0].body));
}
reset();
await call({ ...GOOD, method: 'video', phone: '' });
check('D6 a video call tells the person a link is coming and stores no number',
  /join link/i.test(emails.find((e) => e.to === 'riley@example.com')?.html || '') && leads()[0].data.phone === '');

// ---------------------------------------------------------------------------
// E. THE ADMIN ROUTE
// ---------------------------------------------------------------------------
console.log('\n--- E. the admin route ---');
reset();
await call(GOOD);
const leadId = leads()[0].id;
adminOk = false;
{
  const g = await admin(null);
  const p = await admin({ leadId, action: 'done' });
  // NEGATIVE CONTROL (run 2026-09-02): `if (!admin) return json(..., 404)` to 403 made this read
  //   FAIL  E1 strangers get the same 404 every admin route gives, on GET and POST
  check('E1 strangers get the same 404 every admin route gives, on GET and POST',
    g.status === 404 && p.status === 404 && leads()[0].data.state === 'booked');
}
adminOk = true;
{
  docs.set('leads/ancient', { data: { name: 'Old', email: 'old@example.com', state: 'done', start: at(-20, 10) }, v: 1 });
  const g = await admin(null);
  check('E2 GET lists the calls from two weeks back onward, soonest first, with the person on each',
    g.status === 200 && g.out.calls.length === 1 && g.out.calls[0].id === leadId && g.out.calls[0].name === 'Riley Test');
}
{
  const bad = await admin({ leadId, action: 'join-link', joinLink: 'http://meet.example/x' });
  const good = await admin({ leadId, action: 'join-link', joinLink: 'https://meet.example/abc' });
  const l = docs.get(`leads/${leadId}`).data;
  const linkWrite = writes.filter((w) => w.path.startsWith('availability/')).length;
  // NEGATIVE CONTROL (run 2026-09-02): patching the slot too in join-link made this read
  //   FAIL  E3 join-link patches the lead only and emails the person the link
  check('E3 join-link patches the lead only and emails the person the link',
    bad.status === 400 && good.status === 200 && l.joinLink === 'https://meet.example/abc'
    && linkWrite === 1 /* the take */ && emails.some((e) => e.to === 'riley@example.com' && /meet\.example\/abc/.test(e.html)));
}
{
  const before = emails.length;
  const r = await admin({ leadId, action: 'cancel' });
  const s = slot('fit-1');
  const l = docs.get(`leads/${leadId}`).data;
  // NEGATIVE CONTROL (run 2026-09-02): dropping the reopen patch made this read
  //   FAIL  E4 cancel on a future call reopens the slot, clears its leadId, and emails a way back
  check('E4 cancel on a future call reopens the slot, clears its leadId, and emails a way back',
    r.status === 200 && s.state === 'open' && s.leadId === null && l.state === 'canceled'
    && emails.length === before + 1 && /fit\.html/.test(emails[emails.length - 1].html));
  const again = await admin({ leadId, action: 'cancel' });
  check('E5 cancelling twice is refused', again.status === 409);
}
reset();
docs.set('leads/past', { data: { name: 'P', email: 'p@example.com', state: 'booked', slotId: 'fit-1', start: at(-1, 10) }, v: 1 });
docs.set('availability/fit-1', { data: { start: at(-1, 10), durationMin: 15, state: 'booked', kind: 'fit', leadId: 'past' }, v: 1 });
{
  const r = await admin({ leadId: 'past', action: 'cancel' });
  check('E6 cancel on a call already gone does not reopen a time in the past',
    r.status === 200 && slot('fit-1').state === 'booked');
}
reset();
await call(GOOD);
{
  const id = leads()[0].id;
  const d = await admin({ leadId: id, action: 'done' });
  const n = await admin({ leadId: id, action: 'no-show' });
  const x = await admin({ leadId: id, action: 'nonsense' });
  check('E7 done and no-show stamp the lead; a made-up action is refused',
    d.status === 200 && n.status === 200 && x.status === 400 && docs.get(`leads/${id}`).data.state === 'no-show');
}

// ---------------------------------------------------------------------------
// F. THE REST OF THE SITE KNOWS: guards, picker, rules, audit, landing, demo
// ---------------------------------------------------------------------------
console.log('\n--- F. the rest of the site ---');
{
  const checkout = strip(fn('handleCheckout'));
  const sched = strip(fn('handleAdminSchedule'));
  // NEGATIVE CONTROL (run 2026-09-02): deleting the guard in handleCheckout made this read
  //   FAIL  F1 checkout refuses a fit slot before it holds anything
  check('F1 checkout refuses a fit slot before it holds anything',
    /slot\.data\.kind === FIT_KIND/.test(checkout)
    && checkout.indexOf('slot.data.kind === FIT_KIND') < checkout.indexOf("state: 'held'"));
  check('F2 the admin scheduler refuses a fit slot too',
    /slot\.data\.kind === FIT_KIND/.test(sched));
}
check('F3 both routes are registered, the public POST and the admin one',
  /url\.pathname === '\/api\/fit-call' && request\.method === 'POST'\)\s*return await handleFitCall/.test(CODE)
  && /url\.pathname === '\/api\/admin\/fit-calls'\)\s*return await handleAdminFitCalls/.test(CODE));
// NEGATIVE CONTROL (run 2026-09-02): deleting the skip line in book.js made this read
//   FAIL  F4 the paid picker skips fit slots
check('F4 the paid picker skips fit slots',
  /if \(data\.kind === 'fit'\) return;/.test(code('public/js/book.js')));
check('F5 fit.js lists fit slots and only fit slots',
  /if \(data\.kind !== 'fit'\) return;/.test(code('public/js/fit.js')));
{
  const rules = f('firestore.rules');
  const tail = rules.slice(rules.lastIndexOf('match /{document=**}'));
  // NEGATIVE CONTROL (run 2026-09-02): adding `match /leads/{id} { allow read: if true; }` made this read
  //   FAIL  F6 leads/ has no rule of its own and sits under the deny tail
  check('F6 leads/ has no rule of its own and sits under the deny tail',
    !/match \/leads/.test(rules) && /allow read, write: if false;/.test(tail));
}
{
  const audit = code('tools/blindness-audit.mjs');
  const pages = audit.match(/const CLIENT_PAGES = \[([\s\S]*?)\];/)?.[1] || '';
  const assets = audit.match(/const ADMIN_ASSETS = \[([\s\S]*?)\];/)?.[1] || '';
  // NEGATIVE CONTROL (run 2026-09-02): removing '/fit' from CLIENT_PAGES made this read
  //   FAIL  F7 the audit crawls /fit as a client page and gates admin-fit.js
  check('F7 the audit crawls /fit as a client page and gates admin-fit.js',
    /'\/fit'/.test(pages) && /'\/js\/admin-fit\.js'/.test(assets));
}
{
  const idx = f('public/index.html');
  const hero = idx.slice(idx.indexOf('<section class="land-sec hero">'), idx.indexOf('</section>'));
  const acts = [...hero.matchAll(/<a class="act ([^"]*)" href="([^"]+)">/g)].map((m) => [m[1], m[2]]);
  // NEGATIVE CONTROL (run 2026-09-02): swapping the two hero anchors made this read
  //   FAIL  F8 the hero's first door is the free call at full weight; the case is second at card weight
  check('F8 the hero\'s first door is the free call at full weight; the case is second at card weight',
    acts.length === 2 && /act-c/.test(acts[0][0]) && acts[0][1] === '/fit.html'
    && /act-m/.test(acts[1][0]) && acts[1][1] === '/book.html'
    && /Book a free 15-minute call/.test(hero) && /data-rate="case"/.test(hero));
  const dock = idx.slice(idx.indexOf('id="sticky-book"'), idx.indexOf('id="sticky-book"') + 200);
  check('F9 the dock and the closing lead with the free call and keep the case beside it',
    /href="\/fit\.html"/.test(dock)
    && /<a class="btn glow cta" href="\/fit\.html">Book a free 15-minute call<\/a>\s*<a class="btn ghost" href="\/book\.html">Book a case/.test(idx));
  check('F10 the footer lists the free call', /<a href="\/fit\.html">Book a free call<\/a>/.test(idx));
}
{
  const page = f('public/fit.html');
  check('F11 fit.html is a real page: the box, the module, the disclaimer, no admin module',
    existsSync(__j(__REPO, 'public/fit.html')) && /id="fit"/.test(page) && /src="\/js\/fit\.js"/.test(page)
    && /call 911/.test(page) && !/\/js\/admin/.test(page));
  const fit = code('public/js/fit.js');
  check('F12 fit.js posts to /api/fit-call with the honeypot and the US tick, and imports nothing admin',
    /fetch\('\/api\/fit-call'/.test(fit) && /website:/.test(fit) && /us: true/.test(fit)
    && !/admin|advisor/.test(fit));
  check('F13 fit.js mirrors the note length and the two window constants',
    /const NOTE_MAX = 280;/.test(fit) && /72 \* 3600 \* 1000/.test(fit) && /252 \* 3600 \* 1000/.test(fit)
    && W.FIT_NOTE_MAX === 280);
}
{
  check('F14 the dashboard mounts the FREE CALLS block and the calendar paints the fit mark',
    /id="fit-calls"/.test(f('public/admin.html')) && /mountFitCalls\(/.test(code('public/js/admin.js'))
    && /cal-mark fit/.test(code('public/js/admin-calendar.js')) && /\.cal-mark\.fit/.test(f('public/css/admin.css')));
  check('F15 the availability page can open fit slots and sends the kind, never a length',
    /name="kind" value="fit"/.test(f('public/admin-availability.html'))
    && /\{ starts, kind: 'fit' \}/.test(code('public/js/admin-availability.js')));
}
{
  const demo = code('public/js/demo/api.js');
  const seed = code('public/js/demo/seed.js');
  // NEGATIVE CONTROL (run 2026-09-02): renaming the demo route to /api/fit-calls made this read
  //   FAIL  F16 the demo mirrors both routes and seeds fit slots
  check('F16 the demo mirrors both routes and seeds fit slots',
    /path === '\/api\/fit-call'/.test(demo) && /path === '\/api\/admin\/fit-calls'/.test(demo)
    && /kind: 'fit'/.test(seed));
  check('F17 the demo refuses the same things in the same words',
    /Your name, please\./.test(demo) && /Phone or video\?/.test(demo)
    && /United States and Canada/.test(demo) && /already have a call booked/.test(demo)
    && /That time is no longer available\./.test(demo));
}
{
  // The served bytes, comments included: dashes are about what a person reads.
  const fresh = [
    f('public/fit.html'), f('public/js/fit.js'), f('public/js/admin-fit.js'),
    fn('handleFitCall'), fn('fitNotify'), fn('handleAdminFitCalls'), fn('fitThrottled'),
    SRC.slice(SRC.indexOf('THE FREE 15-MINUTE FIT CALL'), SRC.indexOf('const FIT_NOTE_MAX')),
  ];
  // NEGATIVE CONTROL (run 2026-09-02): an em dash typed into fit.js's intro made this read
  //   FAIL  F18 not one em or en dash in anything new
  check('F18 not one em or en dash in anything new', fresh.every((s) => !/[–—]/.test(s)));
}

// ---------------------------------------------------------------------------
const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
