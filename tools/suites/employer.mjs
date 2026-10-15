// employer.mjs - employer mode and payroll, run on stand-in stores.
//
// Eric, 2026-10-15: "Next to the big 'clients' on the all cases page, I (and
// only I) need a button to enter employer mode. This is where I can see all
// current employees (including myself) with a short brief of how many cases
// they're handling and if what type, and their current proposed income from
// clients they have retained." And: "send them a message as admin that
// appears as a temporary chat box at the top of their screen with a white
// background. I can close the chat at any time and it removes the chat
// completely and deletes all messages." And: "I also need to be able to run
// payroll through this page. And that includes myself. I can run the last
// week, the last two weeks, the last month, and a custom time frame ... I can
// tap on any pay amount to adjust it if there's an error. I also need to see
// each employees preferred payout method. I want it to be EXACTLY how
// mangomint runs payroll. I can delete a generated payroll with no
// consequence. Any payroll I press confirm on gets put into another tab with
// each month's generated payroll." And: "Create a fake contractor so I can
// preview what it looks like from my end" (in his real dashboard).
//
// worker/employer.js and worker/payroll.js are evaluated whole with their
// imports replaced by stand-ins (a Map for Firestore, a recorder for pushes,
// a scripted Stripe), and the real staff and charge modules beside them.
//
// Run: node employer.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const STAFF = await import(pathToFileURL(j(ROOT, 'worker/staff.js')).href);
const CHARGE = await import(pathToFileURL(j(ROOT, 'worker/charge.js')).href);
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

const ERIC = 'eric-uid';
const ENV = { ADMIN_UID: ERIC, FIREBASE_SERVICE_ACCOUNT: '{"k":"test"}' };
const strip = (src) => src.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function|let) /gm, '$1 ');

function world({ stripe = null } = {}) {
  const docs = new Map();
  const pushes = [];
  const stripeCalls = [];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const fs = {
    getDoc: async (env, p) => (docs.has(p) ? { id: p.split('/').pop(), data: clone(docs.get(p)) } : null),
    patchDoc: async (env, p, data, opts = {}) => { const cur = opts.mask ? (docs.get(p) || {}) : {}; docs.set(p, clone({ ...cur, ...data })); return true; },
    deleteDoc: async (env, p) => { docs.delete(p); return true; },
    listDocs: async (env, coll) => [...docs.entries()].filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === coll.split('/').length + 1).map(([k, v]) => ({ id: k.split('/').pop(), data: clone(v) })),
    batchCreate: async (env, entries) => { let created = 0; for (const e of entries) if (!docs.has(e.path)) { docs.set(e.path, clone(e.data)); created++; } return { created, skipped: entries.length - created }; },
    batchDelete: async (env, paths) => { for (const p of paths) docs.delete(p); return { deleted: paths.length }; },
  };
  const stripeGet = async (env, path) => { stripeCalls.push(path); if (!stripe) throw new Error('no stripe'); return stripe(path); };
  const PAY = new Function(...Object.keys({ ...fs, stripeGet, caseBookingCents: 0, advocateIdOf: 0, DEFAULT_COMMISSION_PCT: 0 }),
    `${strip(f('worker/payroll.js'))}\nreturn { periodOf, caseLines, stripeLines, advisorLines, buildRows, totalsOf, cleanPayout, sealPayout, openPayout, payoutMap, handlePayroll, PAYOUT_METHODS, ADVISOR_FEE_CENTS };`)(
    ...Object.values({ ...fs, stripeGet, caseBookingCents: CHARGE.caseBookingCents, advocateIdOf: STAFF.advocateIdOf, DEFAULT_COMMISSION_PCT: STAFF.DEFAULT_COMMISSION_PCT }));
  const notifyUser = async (env, uid, m) => { pushes.push({ uid, ...m }); };
  const EMP = new Function(...Object.keys({ ...fs, notifyUser, caseBookingCents: 0, advocateIdOf: 0, DEFAULT_COMMISSION_PCT: 0, cleanPayout: 0, sealPayout: 0 }),
    `${strip(f('worker/employer.js'))}\nreturn { teamSummary, casePaid, caseKind, sampleRecords, handleEmployer, SAMPLE_UID, renewing };`)(
    ...Object.values({ ...fs, notifyUser, caseBookingCents: CHARGE.caseBookingCents, advocateIdOf: STAFF.advocateIdOf, DEFAULT_COMMISSION_PCT: STAFF.DEFAULT_COMMISSION_PCT, cleanPayout: PAY.cleanPayout, sealPayout: PAY.sealPayout }));
  return { docs, pushes, stripeCalls, PAY, EMP };
}

// Who is asking: the token names a uid, and staff are decided the Worker's way.
const gates = (w) => ({
  json: (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } }),
  requireAdmin: async (req) => { const uid = req.headers.get('x-uid'); return uid === ERIC && w.docs.get(`users/${uid}`)?.role === 'admin' ? { uid } : null; },
  requireStaff: async (req) => {
    const uid = req.headers.get('x-uid'); if (!uid) return null;
    const p = w.docs.get(`users/${uid}`);
    return STAFF.staffFrom(ENV, { uid }, p ? { data: p } : null, w.docs.has(`advocates/${uid}`) ? { data: w.docs.get(`advocates/${uid}`) } : null);
  },
  readRates: async () => ({ subCents: 5000 }),
});
const call = async (w, mod, uid, path, { method = 'GET', json } = {}) => {
  const headers = new Headers(); if (uid) headers.set('x-uid', uid);
  const url = new URL(`https://app.test${path}`);
  const req = { method, headers, url: url.href, json: async () => json ?? null };
  const fn = mod === 'emp' ? w.EMP.handleEmployer : w.PAY.handlePayroll;
  const res = await fn(req, ENV, url, gates(w));
  let out = null; try { out = await res.json(); } catch { out = null; }
  return { status: res.status, out };
};
const seedPeople = (w) => {
  w.docs.set(`users/${ERIC}`, { role: 'admin' });
  w.docs.set(`advocates/${ERIC}`, { uid: ERIC, name: 'Eric', active: true, owner: true, commissionPct: 100, advisor: { optedIn: true, enabled: true } });
  w.docs.set('users/adv-a', { role: 'advocate' });
  w.docs.set('advocates/adv-a', { uid: 'adv-a', name: 'Ana Rivera', active: true, owner: false, commissionPct: 60, onboardedAt: '2026-10-01T00:00:00Z' });
  w.docs.set('users/adv-b', { role: 'advocate' });
  w.docs.set('advocates/adv-b', { uid: 'adv-b', name: 'Ben Cole', active: true, owner: false, commissionPct: 50, onboardedAt: '2026-10-02T00:00:00Z', advisor: { optedIn: true, enabled: true } });
  w.docs.set('advocates/adv-off', { uid: 'adv-off', name: 'Off Person', active: false, owner: false, commissionPct: 60 });
  w.docs.set('users/c1', { role: 'client' });
};

console.log('\n--- A. the team at a glance ---');
{
  const w = world();
  seedPeople(w);
  const cases = [
    { id: 'c-a1', data: { advocateId: 'adv-a', status: 'confirmed', charge: { state: 'captured', capturedCents: 210000 } } },
    { id: 'c-a2', data: { advocateId: 'adv-a', status: 'delivered', fullAccess: true, charge: { state: 'captured', capturedCents: 210000 }, extraPayments: [{ kind: 'fullaccess', amountCents: 230000 }, { kind: 'tip', amountCents: 5000 }, { kind: 'followup', amountCents: 32500, duplicate: true }] } },
    { id: 'c-a3', data: { advocateId: 'adv-a', status: 'closed', charge: { state: 'captured', capturedCents: 210000 } } },
    { id: 'c-e1', data: { status: 'confirmed', stripe: { amountTotal: 210000 } } },
    { id: 'c-e2', data: { status: 'confirmed', self: true } },
    { id: 'c-e3', data: { status: 'confirmed', family: true, stripe: { amountTotal: 0 } } },
    { id: 'c-off', data: { advocateId: 'adv-off', status: 'confirmed', stripe: { amountTotal: 210000 } } },
  ];
  const subs = [
    { id: 's1', data: { status: 'active', currentPeriodEnd: new Date(Date.now() + 9 * 86_400_000).toISOString() } },
    { id: 's2', data: { status: 'active', cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() + 9 * 86_400_000).toISOString() } },
  ];
  const team = w.EMP.teamSummary({ advocates: [...w.docs.entries()].filter(([k]) => k.startsWith('advocates/')).map(([k, v]) => ({ id: k.split('/')[1], data: v })), cases, subs, subCents: 5000, adminUid: ERIC });
  const ana = team.find((p) => p.uid === 'adv-a');
  const eric = team.find((p) => p.uid === ERIC);
  // NEGATIVE CONTROL (run 2026-10-15): teamSummary paying the advocate their share of tips too (tips * pct) made this read
  //   FAIL  A1 each person's open cases by kind, closed ones apart, and what they stand to earn: their share of what their current clients paid, all of their tips, and their share of a month of each chat line
  check('A1 each person\'s open cases by kind, closed ones apart, and what they stand to earn: their share of what their current clients paid, all of their tips, and their share of a month of each chat line',
    team[0].uid === ERIC && ana.open === 2 && ana.closed === 1 && ana.kinds['Advocacy Case'] === 1 && ana.kinds['Full-Service'] === 1
    && ana.paidCents === 650000 && ana.tipsCents === 5000 && ana.proposedCents === Math.round(650000 * 0.6) + 5000
    && eric.open === 3 && eric.kinds['Own case'] === 1 && eric.kinds.Family === 1 && eric.chatLines === 1 && eric.proposedCents === 210000 + 5000
    && !team.some((p) => p.uid === 'adv-off'),
    JSON.stringify(team.map((p) => [p.uid, p.open, p.kinds, p.proposedCents])));

  const asEric = await call(w, 'emp', ERIC, '/api/admin/team');
  const asAna = await call(w, 'emp', 'adv-a', '/api/admin/team');
  const asClient = await call(w, 'emp', 'c1', '/api/admin/team');
  const asNobody = await call(w, 'emp', '', '/api/admin/team');
  // NEGATIVE CONTROL (run 2026-10-15): the team route asking requireStaff instead of requireAdmin made this read
  //   FAIL  A2 employer mode is his alone: an advocate, a client and a stranger get the same 404
  check('A2 employer mode is his alone: an advocate, a client and a stranger get the same 404',
    asEric.status === 200 && Array.isArray(asEric.out.team) && asAna.status === 404 && asClient.status === 404 && asNobody.status === 404,
    JSON.stringify([asEric.status, asAna.status, asClient.status, asNobody.status]));
}

console.log('\n--- B. the temporary chat ---');
{
  const w = world();
  seedPeople(w);
  const empty = await call(w, 'emp', 'adv-a', '/api/staff/chat');
  const first = await call(w, 'emp', 'adv-a', '/api/staff/chat', { method: 'POST', json: { action: 'send', text: '  Can you look at Priya\'s denial?  ' } });
  const hisView = await call(w, 'emp', ERIC, '/api/staff/chat?uid=adv-a');
  const reply = await call(w, 'emp', ERIC, '/api/staff/chat', { method: 'POST', json: { action: 'send', uid: 'adv-a', text: 'Yes, sending notes now.' } });
  const herView = await call(w, 'emp', 'adv-a', '/api/staff/chat');
  // NEGATIVE CONTROL (run 2026-10-15): the advocate's send skipping the push to him made this read
  //   FAIL  B1 an advocate writes from their icon and he is pinged; his answer reaches the top of their screen and pings them; each side counts what it has not read
  check('B1 an advocate writes from their icon and he is pinged; his answer reaches the top of their screen and pings them; each side counts what it has not read',
    empty.status === 200 && empty.out.open === false && first.status === 200 && first.out.messages[0].text === 'Can you look at Priya\'s denial?'
    && hisView.out.unread === 1 && hisView.out.messages.length === 1 && reply.status === 200
    && herView.out.unread === 1 && herView.out.messages.map((m) => m.from).join() === 'advocate,admin'
    && w.pushes.length === 2 && w.pushes[0].uid === ERIC && w.pushes[1].uid === 'adv-a',
    JSON.stringify({ hisView: hisView.out, herView: herView.out, pushes: w.pushes }));
  const sneak = await call(w, 'emp', 'adv-b', '/api/staff/chat?uid=adv-a');
  const sneakClose = await call(w, 'emp', 'adv-a', '/api/staff/chat', { method: 'POST', json: { action: 'close', uid: 'adv-a' } });
  const client = await call(w, 'emp', 'c1', '/api/staff/chat');
  const himself = await call(w, 'emp', ERIC, `/api/staff/chat?uid=${ERIC}`);
  // NEGATIVE CONTROL (run 2026-10-15): the advocate side honouring ?uid= made this read
  //   FAIL  B2 an advocate reads only their own thread whatever the address says, cannot close it, and a client or his own uid gets the 404
  check('B2 an advocate reads only their own thread whatever the address says, cannot close it, and a client or his own uid gets the 404',
    sneak.status === 200 && sneak.out.messages.length === 0 && sneakClose.status === 404 && client.status === 404 && himself.status === 404
    && w.docs.has('staffChats/adv-a'),
    JSON.stringify([sneak.out, sneakClose.status, client.status, himself.status]));
  const closed = await call(w, 'emp', ERIC, '/api/staff/chat', { method: 'POST', json: { action: 'close', uid: 'adv-a' } });
  const after = await call(w, 'emp', 'adv-a', '/api/staff/chat');
  // NEGATIVE CONTROL (run 2026-10-15): close clearing the unread counts instead of deleting the thread made this read
  //   FAIL  B3 when he closes it, every message is deleted, for both of them
  check('B3 when he closes it, every message is deleted, for both of them',
    closed.status === 200 && !w.docs.has('staffChats/adv-a') && after.out.open === false && after.out.messages.length === 0);
  const long = await call(w, 'emp', 'adv-a', '/api/staff/chat', { method: 'POST', json: { action: 'send', text: 'x'.repeat(5000) } });
  for (let i = 0; i < 205; i++) await call(w, 'emp', ERIC, '/api/staff/chat', { method: 'POST', json: { action: 'send', uid: 'adv-a', text: `m${i}` } });
  const kept = w.docs.get('staffChats/adv-a').messages;
  const blank = await call(w, 'emp', ERIC, '/api/staff/chat', { method: 'POST', json: { action: 'send', uid: 'adv-a', text: '   ' } });
// NEGATIVE CONTROL (run 2026-10-15): send keeping every message (no `.slice(-CHAT_MAX)`) made this read
//   FAIL  B4 a message is at most 1,000 characters, the thread keeps the newest 200, and an empty one is refused
  check('B4 a message is at most 1,000 characters, the thread keeps the newest 200, and an empty one is refused',
    long.out.messages[0].text.length === 1000 && kept.length === 200 && kept[199].text === 'm204' && blank.status === 400);
}

console.log('\n--- C. the sample contractor ---');
{
  const w = world();
  seedPeople(w);
  const made = await call(w, 'emp', ERIC, '/api/admin/team', { method: 'POST', json: { action: 'sample-create' } });
  const again = await call(w, 'emp', ERIC, '/api/admin/team', { method: 'POST', json: { action: 'sample-create' } });
  const adv = w.docs.get('advocates/sample-contractor');
  const cases = [...w.docs.entries()].filter(([k]) => /^cases\/[^/]+$/.test(k)).map(([, v]) => v);
  const team = (await call(w, 'emp', ERIC, '/api/admin/team')).out;
  const pay = w.docs.get('payouts/sample-contractor');
  // NEGATIVE CONTROL (run 2026-10-15): the sample cases written without `showcase: true` made this read
  //   FAIL  C1 the sample is a contractor nobody is: marked sample, three invented clients on her name that every count and email skips the way the showcase is skipped, no sign-in, and a sealed way to be paid
  check('C1 the sample is a contractor nobody is: marked sample, three invented clients on her name that every count and email skips the way the showcase is skipped, no sign-in, and a sealed way to be paid',
    made.status === 200 && again.out.existing === true && adv?.sample === true && adv.owner === false && !!adv.onboardedAt
    && cases.length === 3 && cases.every((c) => c.sample === true && c.showcase === true && c.advocateId === 'sample-contractor' && !c.clientUid && /@example\.com$/.test(c.clientEmail))
    && ![...w.docs.keys()].some((k) => k.startsWith('staffSecrets/'))
    && team.sample === true && team.team.find((p) => p.uid === 'sample-contractor')?.open === 3
    && pay?.method === 'zelle' && !String(pay.sealed).includes('maya') && /sample/.test(pay.hint),
    JSON.stringify({ made: made.out, adv, n: cases.length, pay }));
  const gone = await call(w, 'emp', ERIC, '/api/admin/team', { method: 'POST', json: { action: 'sample-remove' } });
  const left = [...w.docs.keys()].filter((k) => /sample/.test(k));
  const denied = await call(w, 'emp', 'adv-a', '/api/admin/team', { method: 'POST', json: { action: 'sample-create' } });
  // NEGATIVE CONTROL (run 2026-10-15): sample-remove leaving her cases' chat in place made this read
  //   FAIL  C2 one tap removes her, her clients, their chats and her pay details, and nobody else can add or remove her
  check('C2 one tap removes her, her clients, their chats and her pay details, and nobody else can add or remove her',
    gone.status === 200 && !left.length && denied.status === 404 && w.docs.has('advocates/adv-a'), left.join(','));
}

console.log('\n--- D. payroll ---');
{
  const w = world();
  seedPeople(w);
  const P = w.PAY;
  const per = P.periodOf('2026-09-01', '2026-09-30');
  const bad = [P.periodOf('2026-09-30', '2026-09-01'), P.periodOf('2025-01-01', '2026-09-01'), P.periodOf('x', 'y')];
  // NEGATIVE CONTROL (run 2026-10-15): periodOf leaving the end day out (no `+ DAY`) made this read
  //   FAIL  D1 a period runs from the start of its first day to the end of its last, on his clock, and a backwards or year-long one is refused
  check('D1 a period runs from the start of its first day to the end of its last, on his clock, and a backwards or year-long one is refused',
    per && new Date(per.start).toISOString() === '2026-09-01T07:00:00.000Z' && new Date(per.end).toISOString() === '2026-10-01T07:00:00.000Z' && bad.every((x) => x === null),
    JSON.stringify(per));
  const cases = [
    { id: 'k1', data: { advocateId: 'adv-a', clientName: 'Priya', charge: { state: 'captured', capturedCents: 210000, capturedAt: '2026-09-05T18:00:00Z' }, createdAt: '2026-08-30T00:00:00Z',
      extraPayments: [{ kind: 'tip', amountCents: 5000, at: '2026-09-10T18:00:00Z' }, { kind: 'followup', amountCents: 32500, at: '2026-09-12T18:00:00Z' }, { kind: 'followup', amountCents: 32500, at: '2026-09-12T18:01:00Z', duplicate: true }, { kind: 'extend', amountCents: 230000, at: '2026-10-02T18:00:00Z' }] } },
    { id: 'k2', data: { clientName: 'Jordan', stripe: { amountTotal: 210000, paymentIntentId: 'pi_jordan' }, createdAt: '2026-09-20T18:00:00Z', paidOverrideCents: 175000 } },
    { id: 'k3', data: { self: true, stripe: { amountTotal: 99 }, createdAt: '2026-09-20T18:00:00Z' } },
    { id: 'k4', data: { showcase: true, stripe: { amountTotal: 99 }, createdAt: '2026-09-20T18:00:00Z' } },
    { id: 'k5', data: { advocateId: 'adv-a', clientName: 'Held', charge: { state: 'held', authorizedCents: 210000 }, createdAt: '2026-09-21T18:00:00Z' } },
    { id: 'k6', data: { advocateId: 'sample-contractor', sample: true, showcase: true, clientName: 'Grace', charge: { state: 'captured', capturedCents: 210000, capturedAt: '2026-09-22T18:00:00Z' } } },
  ];
  const lines = P.caseLines(cases, per.start, per.end, ENV);
  const kinds = lines.map((l) => `${l.caseId}:${l.kind}:${l.cents}`).sort();
  // NEGATIVE CONTROL (run 2026-10-15): caseLines counting duplicate payments made this read
  //   FAIL  D2 the period's money is every payment on the cases dated inside it: captured bookings, his corrections, each later purchase and tip; never a duplicate, a hold, his own case or the showcase
  check('D2 the period\'s money is every payment on the cases dated inside it: captured bookings, his corrections, each later purchase and tip; never a duplicate, a hold, his own case or the showcase',
    JSON.stringify(kinds) === JSON.stringify(['k1:booking:210000', 'k1:followup:32500', 'k1:tip:5000', 'k2:booking:175000', 'k6:booking:210000'].sort())
    && lines.find((l) => l.caseId === 'k6').sample === true && lines.find((l) => l.caseId === 'k2').adv === ERIC,
    JSON.stringify(kinds));

  const stripe = (path) => {
    if (path.startsWith('/v1/refunds')) return { data: [{ id: 're_1', amount: 32500, payment_intent: 'pi_x', status: 'succeeded', created: 1758000000 }, { id: 're_2', amount: 10000, payment_intent: 'pi_jordan', status: 'succeeded', created: 1758000100 }, { id: 're_3', amount: 999, payment_intent: 'pi_unknown', status: 'succeeded', created: 1758000200 }], has_more: false };
    if (path.startsWith('/v1/disputes')) return { data: [], has_more: false };
    if (path.startsWith('/v1/invoices')) return { data: [{ id: 'in_1', amount_paid: 5000, customer: 'cus_1', created: 1758000300 }], has_more: false };
    if (path.startsWith('/v1/checkout/sessions')) return { data: path.includes('pi_x') ? [{ id: 'cs_followup_k1' }] : [], has_more: false };
    return { data: [] };
  };
  const w2 = world({ stripe });
  seedPeople(w2);
  const cases2 = cases.map((c) => (c.id === 'k1' ? { ...c, data: { ...c.data, extraPayments: [...c.data.extraPayments.slice(0, 2), { ...c.data.extraPayments[1], sessionId: 'cs_followup_k1' }] } } : c));
  const subs = [{ id: 'sub-u1', data: { stripeCustomerId: 'cus_1', advocateId: 'adv-b' } }];
  const st = await w2.PAY.stripeLines({ ...ENV, STRIPE_SECRET_KEY: 'sk' }, per.start, per.end, cases2, subs);
  const none = await w2.PAY.stripeLines(ENV, per.start, per.end, cases2, subs);
  const who = st.lines.map((l) => `${l.ref}:${l.adv}:${l.kind}`).sort();
  // NEGATIVE CONTROL (run 2026-10-15): stripeLines skipping the checkout session lookup for an unknown payment made this read
  //   FAIL  D3 Stripe's refunds, chargebacks and chat renewals land on the right person: by the payment, else its checkout, else the subscriber's advocate; anything unmatched is his, named
  check('D3 Stripe\'s refunds, chargebacks and chat renewals land on the right person: by the payment, else its checkout, else the subscriber\'s advocate; anything unmatched is his, named',
    JSON.stringify(who) === JSON.stringify([`in_1:adv-b:sub`, 're_1:adv-a:refund', `re_2:${ERIC}:refund`, `re_3:${ERIC}:refund`].sort())
    && st.lines.find((l) => l.ref === 're_3').client === 'Not matched to a case' && !st.note && /not connected/.test(none.note) && none.lines.length === 0,
    JSON.stringify({ who, note: st.note }));

  const advocates = [...w.docs.entries()].filter(([k]) => k.startsWith('advocates/')).map(([k, v]) => ({ id: k.split('/')[1], data: v }));
  advocates.push({ id: 'sample-contractor', data: { name: 'Maya Torres', sample: true, active: true, commissionPct: 60, onboardedAt: 'x' } });
  const all = [...lines, ...st.lines, ...P.advisorLines(advocates, per.start, per.end)];
  const rows = P.buildRows({ advocates, lines: all, adjustments: [{ id: 'j1', uid: 'adv-a', type: 'Bonus', cents: 2500 }], adminUid: ERIC });
  const ana = rows.find((r) => r.uid === 'adv-a');
  const eric = rows.find((r) => r.uid === ERIC);
  const ben = rows.find((r) => r.uid === 'adv-b');
  const totals = P.totalsOf(rows);
  // NEGATIVE CONTROL (run 2026-10-15): buildRows taking the whole refund off the advocate instead of their share made this read
  //   FAIL  D4 each row is Mangomint's: client sales at their share, every tip theirs, a refund takes back their share of it, the Advisor fee comes off whole, his adjustments last; he is on it at 100%, and the sample is shown but kept out of the totals
  check('D4 each row is Mangomint\'s: client sales at their share, every tip theirs, a refund takes back their share of it, the Advisor fee comes off whole, his adjustments last; he is on it at 100%, and the sample is shown but kept out of the totals',
    ana.salesCents === 242500 && ana.commissionCents === Math.round(210000 * 0.6) + Math.round(32500 * 0.6) && ana.tipsCents === 5000
    && ana.deductionsCents === Math.round(32500 * 0.6) && ana.adjustmentsCents === 2500
    && ana.totalCents === ana.commissionCents + 5000 - ana.deductionsCents + 2500 && ana.cases === 1
    && eric.commissionPct === 100 && eric.salesCents === 175000 && eric.deductionsCents === 10999 && eric.totalCents === 175000 - 10999
    && ben.salesCents === 5000 && ben.commissionCents === 2500 && ben.deductionsCents === P.ADVISOR_FEE_CENTS
    && rows.some((r) => r.sample) && totals.salesCents === ana.salesCents + eric.salesCents + ben.salesCents
    && rows[0].uid === ERIC && !rows.some((r) => r.uid === 'adv-off'),
    JSON.stringify(rows.map((r) => [r.uid, r.salesCents, r.commissionCents, r.tipsCents, r.deductionsCents, r.adjustmentsCents, r.totalCents])));
  const quiet = P.buildRows({ advocates, lines: lines.filter((l) => l.adv === 'adv-a'), adminUid: ERIC, includeAll: false });
// NEGATIVE CONTROL (run 2026-10-15): buildRows keeping every row whatever includeAll says made this read
//   FAIL  D5 "Include all staff members" off leaves out anyone with nothing in the period
  check('D5 "Include all staff members" off leaves out anyone with nothing in the period', quiet.length === 1 && quiet[0].uid === 'adv-a', quiet.map((r) => r.uid).join());
}

console.log('\n--- E. the runs ---');
{
  const w = world();
  seedPeople(w);
  w.docs.set('cases/r1', { advocateId: 'adv-a', clientName: 'Priya', charge: { state: 'captured', capturedCents: 210000, capturedAt: '2026-09-05T18:00:00Z' } });
  await w.PAY.handlePayroll({ method: 'POST', headers: new Headers({ 'x-uid': 'adv-a' }), json: async () => ({ method: 'ach', fields: { name: 'Ana Rivera', routing: '123456789', account: '000123456789', type: 'checking' } }) },
    ENV, new URL('https://app.test/api/staff/payout'), gates(w));
  const gen = await call(w, 'pay', ERIC, '/api/admin/payroll', { method: 'POST', json: { action: 'generate', start: '2026-09-01', end: '2026-09-30', preset: 'month' } });
  const id = gen.out?.run?.id;
  const stored = JSON.stringify(w.docs.get(`payrollRuns/${id}`) || {});
  const anaRow = gen.out?.run?.rows?.find((r) => r.uid === 'adv-a');
  // NEGATIVE CONTROL (run 2026-10-15): the run stored with each row's opened payout details made this read
  //   FAIL  E1 Run report saves a draft he can open again; it shows each person's way to be paid, opened for him, and the bank numbers are never written into the payroll itself
  check('E1 Run report saves a draft he can open again; it shows each person\'s way to be paid, opened for him, and the bank numbers are never written into the payroll itself',
    gen.status === 200 && gen.out.run.status === 'draft' && anaRow?.payout?.label === 'Direct deposit (ACH)' && anaRow.payout.details?.account === '000123456789'
    && !stored.includes('000123456789') && !stored.includes('123456789') && /Checking ending 6789/.test(anaRow.payout.hint),
    JSON.stringify({ status: gen.status, payout: anaRow?.payout }));
  const before = anaRow.totalCents;
  const set = await call(w, 'pay', ERIC, '/api/admin/payroll', { method: 'POST', json: { action: 'adjust', id, uid: 'adv-a', cents: 1500 - before, type: 'Correction', note: 'Agreed flat' } });
  const plus = await call(w, 'pay', ERIC, '/api/admin/payroll', { method: 'POST', json: { action: 'adjust', id, uid: 'adv-a', cents: -500, type: 'Pay adjustment' } });
  const rowNow = plus.out.run.rows.find((r) => r.uid === 'adv-a');
  const undo = await call(w, 'pay', ERIC, '/api/admin/payroll', { method: 'POST', json: { action: 'unadjust', id, adjId: plus.out.run.adjustments[1].id } });
  // NEGATIVE CONTROL (run 2026-10-15): adjust not recomputing the row's total made this read
  //   FAIL  E2 a tap on a total sets what they are owed as a correction; + adds a typed adjustment, a minus takes money off; either can be removed; the totals follow
  check('E2 a tap on a total sets what they are owed as a correction; + adds a typed adjustment, a minus takes money off; either can be removed; the totals follow',
    set.status === 200 && rowNow.totalCents === 1000 && rowNow.adjustments.length === 2
    && plus.out.run.totals.totalCents === plus.out.run.rows.filter((r) => !r.sample).reduce((s, r) => s + r.totalCents, 0)
    && undo.out.run.rows.find((r) => r.uid === 'adv-a').totalCents === 1500 && undo.out.run.adjustments.length === 1,
    JSON.stringify({ rowNow: rowNow?.totalCents, n: rowNow?.adjustments?.length, tot: plus.out?.run?.totals, undo: undo.out?.run?.rows?.find((r) => r.uid === "adv-a")?.totalCents, undoAdj: undo.out?.run?.adjustments?.length }));
  const second = await call(w, 'pay', ERIC, '/api/admin/payroll', { method: 'POST', json: { action: 'generate', start: '2026-09-01', end: '2026-09-07', preset: 'week' } });
  const del = await call(w, 'pay', ERIC, '/api/admin/payroll', { method: 'POST', json: { action: 'delete', id: second.out.run.id } });
  const conf = await call(w, 'pay', ERIC, '/api/admin/payroll', { method: 'POST', json: { action: 'confirm', id } });
  const delConf = await call(w, 'pay', ERIC, '/api/admin/payroll', { method: 'POST', json: { action: 'delete', id } });
  const adjConf = await call(w, 'pay', ERIC, '/api/admin/payroll', { method: 'POST', json: { action: 'adjust', id, uid: 'adv-a', cents: 100 } });
  const list = await call(w, 'pay', ERIC, '/api/admin/payroll');
  // NEGATIVE CONTROL (run 2026-10-15): delete allowed on a confirmed run made this read
  //   FAIL  E3 a draft deletes with nothing else touched; Confirm moves it to the history for good, where it can no longer be deleted or changed
  check('E3 a draft deletes with nothing else touched; Confirm moves it to the history for good, where it can no longer be deleted or changed',
    del.status === 200 && !w.docs.has(`payrollRuns/${second.out.run.id}`) && w.docs.has('cases/r1')
    && conf.out.run.status === 'confirmed' && delConf.status === 409 && adjConf.status === 409
    && list.out.runs.length === 1 && list.out.runs[0].status === 'confirmed',
    JSON.stringify([del.status, conf.out?.run?.status, delConf.status, adjConf.status, list.out?.runs?.length]));
  const asAna = await call(w, 'pay', 'adv-a', '/api/admin/payroll');
  const asNobody = await call(w, 'pay', '', '/api/admin/payroll', { method: 'POST', json: { action: 'generate', start: '2026-09-01', end: '2026-09-30' } });
// NEGATIVE CONTROL (run 2026-10-15): the payroll route asking requireStaff instead of requireAdmin made this read
//   FAIL  E4 payroll is his alone: an advocate or a stranger gets the 404
  check('E4 payroll is his alone: an advocate or a stranger gets the 404', asAna.status === 404 && asNobody.status === 404);
}

console.log('\n--- F. how they want to be paid ---');
{
  const w = world();
  seedPeople(w);
  const P = w.PAY;
  const ach = P.cleanPayout({ method: 'ach', fields: { name: 'Ana', routing: '12345678', account: '1234' } });
  const ok = P.cleanPayout({ method: 'ach', fields: { name: 'Ana', routing: '123-456-789', account: '9876543210', type: 'savings' } });
  const zelle = P.cleanPayout({ method: 'zelle', fields: { handle: 'ana@example.com' } });
  const none = P.cleanPayout({ method: 'crypto' });
  const sealed = await P.sealPayout(ENV, ok.details);
  const opened = await P.openPayout(ENV, sealed);
  const wrongKey = await P.openPayout({ FIREBASE_SERVICE_ACCOUNT: 'other' }, sealed);
  // NEGATIVE CONTROL (run 2026-10-15): the ACH hint built from the whole account number made this read
  //   FAIL  F1 a method is checked before it is kept, its hint shows the last four at most, and the details are sealed so only the Worker's key opens them
  check('F1 a method is checked before it is kept, its hint shows the last four at most, and the details are sealed so only the Worker\'s key opens them',
    !!ach.error && ok.hint === 'Savings ending 3210' && ok.details.routing === '123456789' && /Zelle to an…om/.test(zelle.hint) && !!none.error
    && !sealed.includes('9876543210') && opened?.account === '9876543210',
    JSON.stringify({ ok: ok.hint, zelle: zelle.hint }));
  const set = await w.PAY.handlePayroll({ method: 'POST', headers: new Headers({ 'x-uid': 'adv-a' }), json: async () => ({ method: 'check', fields: { name: 'Ana Rivera', address: '12 Elm St, Boise, ID 83702' } }) },
    ENV, new URL('https://app.test/api/staff/payout'), gates(w));
  const mine = await (await w.PAY.handlePayroll({ method: 'GET', headers: new Headers({ 'x-uid': 'adv-a' }) }, ENV, new URL('https://app.test/api/staff/payout'), gates(w))).json();
  const theirs = await (await w.PAY.handlePayroll({ method: 'GET', headers: new Headers({ 'x-uid': 'adv-b' }) }, ENV, new URL('https://app.test/api/staff/payout'), gates(w))).json();
  const stranger = await w.PAY.handlePayroll({ method: 'GET', headers: new Headers() }, ENV, new URL('https://app.test/api/staff/payout'), gates(w));
  const doc = JSON.stringify(w.docs.get('payouts/adv-a'));
  // NEGATIVE CONTROL (run 2026-10-15): the payout route writing `details` beside the sealed copy made this read
  //   FAIL  F2 an advocate sets their own way to be paid and sees it back masked; the record holds it sealed; nobody else reads it
  check('F2 an advocate sets their own way to be paid and sees it back masked; the record holds it sealed; nobody else reads it',
    set.status === 200 && mine.method === 'check' && /Mailed to 12 Elm St/.test(mine.hint) && !('details' in mine)
    && !doc.includes('Elm St, Boise') && theirs.method === '' && stranger.status === 404,
    JSON.stringify({ mine, doc: doc.slice(0, 120) }));
  // NEGATIVE CONTROL (run 2026-10-15): an em dash put in employer.js's first comment made this read
  //   FAIL  F3 the employer and payroll modules carry no dash
  check('F3 the employer and payroll modules carry no dash', !DASH.test(f('worker/employer.js')) && !DASH.test(f('worker/payroll.js'))
    && !DASH.test(f('public/js/admin-employer.js')) && !DASH.test(f('public/js/admin-staffchat.js')) && !DASH.test(f('public/admin-employer.html')));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
