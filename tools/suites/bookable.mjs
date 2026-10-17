// bookable.mjs - a contractor's available hours are their bookable times, with a buffer around paid appointments (v7.70).
//
// Eric, 2026-10-17: "Not weekly hours. Available hours. This is where clients can see they can be booked." Then: "Yes,
// with an adjustable buffer block around it. A scheduled time automatically blocks off 3 hours before and after around
// the appointment. This is baseline for everyone. But can be adjusted per contractor in employer mode." On free calls,
// his answer: paid appointments make the buffer; a free call makes none, but cannot land inside one.
//
// worker/booking.js is lifted whole and RUN against a stand-in store; the contractor checkout is lifted from
// worker/index.js and run with Stripe stood in.
//
//   B1 the buffer's numbers: three when never set, half hours from 0 to 12, anything else refused
//   B2 times from a week: on the hour and half hour, on their own clock, the whole call inside the day, lead to horizon
//   B3 the paid appointments: booked and live holds, waiting invitations, set case times; never a free call or anyone else's
//   B4 the buffer's edges: exactly the buffer away is fine, a minute closer is not, and 0 still forbids overlap
//   B5 a contractor's open times leave out their buffer, follow their own setting, and never open for him or the closed
//   B6 his own open slots inside his buffer are hidden, free calls make no buffer, and a contractor's booking is not his
//   B7 two holds inside one buffer: the first taken keeps it, a booking always wins
//   B8 the contractor checkout: their time only, held as theirs, given back on a race or a changed price, and their case
//   B9 his checkout and the free call refuse a time inside the buffer, and the routes are public
//   B10 the pages: their calendar, his buffered slots hidden, his card's buffer, their link, and the demo mirrors it
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
const STAFF = await import(pathToFileURL(join(ROOT, 'worker/staff.js')).href);
const SS = await import(pathToFileURL(join(ROOT, 'worker/staffsettings.js')).href);
const SCHED = await import(pathToFileURL(join(ROOT, 'worker/schedule.js')).href);
const CHARGE = await import(pathToFileURL(join(ROOT, 'worker/charge.js')).href);
const strip = (src) => src
  .replace(/^import [\s\S]*?from '[^']+';\n/gm, '')
  .replace(/^export \{[^}]*\} from '[^']+';\n/gm, '')
  .replace(/^export (const|let|async function|function) /gm, '$1 ');
const W = f('worker/index.js');
const lift = (name) => {
  const m = W.match(new RegExp(`\\n(async )?function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
};

const ERIC = 'eric-uid';
const env = { ADMIN_UID: ERIC, PUBLIC_BASE_URL: 'https://app.test' };
const HOUR = 3600_000;
const NOW = Date.UTC(2026, 9, 12, 12, 0); // Monday, October 12, 2026
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

// ---- worker/booking.js, whole, against a stand-in store -------------------------------
function store(seed = {}) {
  const docs = new Map(Object.entries(seed).map(([k, v]) => [k, { data: clone(v), v: '1' }]));
  return {
    docs,
    getDoc: async (e, p) => (docs.has(p) ? { id: p.split('/').pop(), data: clone(docs.get(p).data), updateTime: docs.get(p).v } : null),
    listDocs: async (e, coll) => [...docs.entries()].filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === 2)
      .map(([k, d]) => ({ id: k.split('/')[1], data: clone(d.data) })),
  };
}
function booking(st) {
  const deps = {
    getDoc: st.getDoc, listDocs: st.listDocs, advocateIdOf: STAFF.advocateIdOf,
    settingsFrom: SS.settingsFrom, bufferHoursOf: SS.bufferHoursOf,
    LEAD_TIME_HOURS: SCHED.LEAD_TIME_HOURS, MAX_LEAD_TIME_HOURS: SCHED.MAX_LEAD_TIME_HOURS,
  };
  return new Function(...Object.keys(deps), `${strip(f('worker/booking.js'))}
    return { paidIntervals, conflictsWith, insideBuffer, mustYield, timesFromHours, readBookingWorld, bufferMsFor,
      bookableTimes, bufferedSlotIds, slotInsideBuffer, holdMustYield, BOOK_MINUTES };`)(...Object.values(deps));
}
const B = booking(store());
const iso = (t) => new Date(t).toISOString();

// ---------------------------------------------------------------------------
console.log('\n--- B1 to B4: the pure parts ---');
{
  const keep = [0, 1.5, 3, 12].every((v) => SS.bufferHoursOf({ bufferHours: v }) === v);
  const fall = [undefined, null, -1, 12.5, 1.25, '2', NaN].every((v) => SS.bufferHoursOf({ bufferHours: v }) === 3) && SS.bufferHoursOf(null) === 3;
  const refused = [-1, 12.5, 1.25, 'x', '', null, {}].every((v) => !!SS.cleanBufferHours(v).error);
  const taken = SS.cleanBufferHours('2').value === 2 && SS.cleanBufferHours(0).value === 0 && SS.cleanBufferHours(4.5).value === 4.5;
  // NEGATIVE CONTROL (run 2026-10-17): bufferHoursOf's fallback `? v : DEFAULT_BUFFER_HOURS;` made `? v : 0;` made this read
  //   FAIL  B1 the buffer's numbers: three when never set, half hours from 0 to 12, anything else refused
  check('B1 the buffer\'s numbers: three when never set, half hours from 0 to 12, anything else refused',
    keep && fall && refused && taken && SS.DEFAULT_BUFFER_HOURS === 3 && SS.BUFFER_MAX_HOURS === 12, JSON.stringify({ keep, fall, refused, taken }));
}
{
  const tue = B.timesFromHours({ tue: { from: '09:00', to: '11:00' } }, 'America/New_York', { now: NOW }).map(iso);
  // The week the clocks go back: Monday, November 2 at 9:00 is 14:00 UTC, not 13:00.
  const dst = B.timesFromHours({ mon: { from: '09:00', to: '10:00' } }, 'America/New_York', { now: Date.UTC(2026, 9, 27, 12, 0) }).map(iso);
  // A call that would run past the end of the day is not offered; nothing before the lead time or after the horizon.
  const late = B.timesFromHours({ thu: { from: '16:00', to: '17:20' } }, 'America/Boise', { now: NOW }).map(iso);
  const none = B.timesFromHours(null, 'America/Boise', { now: NOW });
  // NEGATIVE CONTROL (run 2026-10-17): timesFromHours's `min + durationMin <= toMin(span.to)` made `min < toMin(span.to)` made this read
  //   FAIL  B2 times from a week: on the hour and half hour, on their own clock, the whole call inside the day, lead to horizon
  check('B2 times from a week: on the hour and half hour, on their own clock, the whole call inside the day, lead to horizon',
    JSON.stringify(tue) === JSON.stringify(['2026-10-20T13:00:00.000Z', '2026-10-20T13:30:00.000Z', '2026-10-20T14:00:00.000Z'])
    && JSON.stringify(dst) === JSON.stringify(['2026-11-02T14:00:00.000Z'])
    && JSON.stringify(late) === JSON.stringify(['2026-10-15T22:00:00.000Z', '2026-10-22T22:00:00.000Z'])
    && none.length === 0, JSON.stringify({ tue, dst, late }));
}
{
  const at = (d, h) => iso(Date.UTC(2026, 9, d, h, 0));
  const world = {
    slots: [
      { id: 's1', data: { advocateId: 'ana', state: 'booked', start: at(20, 18), durationMin: 60 } },
      { id: 's2', data: { advocateId: 'ana', state: 'held', start: at(21, 18), holdExpiresAt: iso(NOW + 10 * 60_000) } },
      { id: 's3', data: { advocateId: 'ana', state: 'held', start: at(22, 18), holdExpiresAt: iso(NOW - 60_000) } },
      { id: 's4', data: { advocateId: 'ana', state: 'booked', kind: 'fit', start: at(19, 18), durationMin: 15 } },
      { id: 's5', data: { state: 'booked', start: at(20, 15) } },
      { id: 's6', data: { advocateId: 'ana', state: 'open', start: at(20, 20) } },
    ],
    invites: [
      { id: 'i1', data: { advocateId: 'ana', state: 'sent', start: at(19, 15) } },
      { id: 'i2', data: { advocateId: 'ana', state: 'canceled', start: at(19, 16) } },
      { id: 'i3', data: { state: 'sent', start: at(19, 17) } },
    ],
    cases: [
      { id: 'c1', data: { advocateId: 'ana', status: 'confirmed', appointment: { start: at(16, 18), durationMin: 90 } } },
      { id: 'c2', data: { advocateId: 'ana', status: 'confirmed', appointment: { start: at(16, 20), requested: true } } },
      { id: 'c3', data: { advocateId: 'ana', status: 'closed', appointment: { start: at(16, 21) } } },
      { id: 'c4', data: { advocateId: 'ana', self: true, appointment: { start: at(16, 22) } } },
      { id: 'c5', data: { status: 'confirmed', appointment: { start: at(16, 23) } } },
    ],
  };
  const ana = B.paidIntervals(world, 'ana', env, NOW);
  const eric = B.paidIntervals(world, ERIC, env, NOW).map((x) => x.id).sort();
  const c1 = ana.find((x) => x.id === 'case:c1');
  // NEGATIVE CONTROL (run 2026-10-17): paidIntervals's `d.kind === FIT_KIND ||` skip taken out made this read
  //   FAIL  B3 the paid appointments: booked and live holds, waiting invitations, set case times; never a free call or anyone else's
  check('B3 the paid appointments: booked and live holds, waiting invitations, set case times; never a free call or anyone else\'s',
    JSON.stringify(ana.map((x) => x.id).sort()) === JSON.stringify(['case:c1', 'invite:i1', 'slot:s1', 'slot:s2'])
    && ana.find((x) => x.id === 'slot:s2')?.held === true && ana.find((x) => x.id === 'slot:s1')?.held === false
    && c1 && c1.b - c1.a === 90 * 60_000
    && JSON.stringify(eric) === JSON.stringify(['case:c5', 'invite:i3', 'slot:s5']),
    JSON.stringify({ ana: ana.map((x) => x.id), eric }));
}
{
  const appt = [{ a: Date.UTC(2026, 9, 20, 12), b: Date.UTC(2026, 9, 20, 13), id: 'case:x' }];
  const in3 = (sh, sm) => { const s = Date.UTC(2026, 9, 20, sh, sm); return B.insideBuffer(appt, 3 * HOUR, s, s + HOUR); };
  const in0 = (sh, sm) => { const s = Date.UTC(2026, 9, 20, sh, sm); return B.insideBuffer(appt, 0, s, s + HOUR); };
  // NEGATIVE CONTROL (run 2026-10-17): conflictsWith's `s < x.b + bufferMs` made `s <= x.b + bufferMs` made this read
  //   FAIL  B4 the buffer's edges: exactly the buffer away is fine, a minute closer is not, and 0 still forbids overlap
  check('B4 the buffer\'s edges: exactly the buffer away is fine, a minute closer is not, and 0 still forbids overlap',
    !in3(16, 0) && in3(15, 59) && !in3(8, 0) && in3(8, 1) && !in0(13, 0) && !in0(11, 0) && in0(12, 30) && in0(11, 30)
    && !B.insideBuffer(appt, 3 * HOUR, Date.UTC(2026, 9, 20, 12), Date.UTC(2026, 9, 20, 13), ['case:x']));
}

// ---------------------------------------------------------------------------
console.log('\n--- B5 to B7: the reads ---');
{
  const ana = { uid: 'ana', name: 'Ana Rivera', active: true, owner: false, tz: 'America/Boise', settings: { hours: { tue: { from: '08:00', to: '18:00' } } } };
  const bookedTue = { advocateId: 'ana', status: 'confirmed', appointment: { start: '2026-10-20T18:00:00.000Z', durationMin: 60 } };
  const run = async (seed, uid = 'ana') => { const S = store(seed); return booking(S).bookableTimes(env, uid, { now: NOW }); };
  const three = await run({ 'advocates/ana': ana, 'cases/c1': bookedTue });
  const one = await run({ 'advocates/ana': { ...ana, bufferHours: 1 }, 'cases/c1': bookedTue });
  const local = (t) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/Boise', hour: 'numeric', minute: '2-digit' });
  const shut = await Promise.all([
    run({ 'advocates/ana': { ...ana, active: false } }), run({ 'advocates/ana': { ...ana, settings: { ...ana.settings, offers: { case: false } } } }),
    run({ 'advocates/ana': { ...ana, settings: {} } }), run({ [`advocates/${ERIC}`]: { ...ana, uid: ERIC, owner: true } }, ERIC),
    run({ 'advocates/ana': { ...ana, owner: true } }), run({}, 'nobody'),
  ]);
  // NEGATIVE CONTROL (run 2026-10-17): bookableTimes's `.filter((t) => !insideBuffer(...))` taken out made this read
  //   FAIL  B5 a contractor's open times leave out their buffer, follow their own setting, and never open for him or the closed
  check('B5 a contractor\'s open times leave out their buffer, follow their own setting, and never open for him or the closed',
    three.name === 'Ana Rivera' && three.durationMin === 60
    && JSON.stringify(three.times.map(local)) === JSON.stringify(['8:00 AM', '4:00 PM', '4:30 PM', '5:00 PM'])
    && JSON.stringify(one.times.map(local)) === JSON.stringify(['8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '2:00 PM', '2:30 PM', '3:00 PM', '3:30 PM', '4:00 PM', '4:30 PM', '5:00 PM'])
    && shut.every((x) => x.code === 404 && !x.times),
    JSON.stringify({ three: three.times?.map(local), one: one.times?.map(local), shut: shut.map((x) => x.code) }));
}
{
  const S = store({
    'slots-placeholder/x': {},
    'availability/paid': { state: 'booked', start: '2026-10-21T18:00:00.000Z', durationMin: 60, caseId: 'c' },
    'availability/early': { advocateId: ERIC, state: 'open', start: '2026-10-21T14:00:00.000Z', durationMin: 60 },
    'availability/near': { state: 'open', start: '2026-10-21T15:30:00.000Z', durationMin: 60 },
    'availability/after': { advocateId: ERIC, state: 'open', start: '2026-10-21T21:00:00.000Z', durationMin: 60 },
    'availability/late': { state: 'open', start: '2026-10-21T22:00:00.000Z', durationMin: 60 },
    'availability/fitnear': { state: 'open', kind: 'fit', start: '2026-10-21T20:00:00.000Z', durationMin: 15 },
    'availability/fitfar': { state: 'open', kind: 'fit', start: '2026-10-21T23:00:00.000Z', durationMin: 15 },
    'availability/fitbooked': { state: 'booked', kind: 'fit', start: '2026-10-22T18:00:00.000Z', durationMin: 15 },
    'availability/besidefree': { state: 'open', start: '2026-10-22T19:00:00.000Z', durationMin: 60 },
    'availability/anabooked': { advocateId: 'ana', state: 'booked', start: '2026-10-23T18:00:00.000Z', durationMin: 60 },
    'availability/besideana': { state: 'open', start: '2026-10-23T19:00:00.000Z', durationMin: 60 },
    [`advocates/${ERIC}`]: { uid: ERIC, owner: true, active: true },
  });
  const Bx = booking(S);
  const cases = await Bx.bufferedSlotIds(env, 'case', { now: NOW });
  const fits = await Bx.bufferedSlotIds(env, 'fit', { now: NOW });
  S.docs.set(`advocates/${ERIC}`, { data: { uid: ERIC, owner: true, active: true, bufferHours: 0 }, v: '2' });
  const zero = await Bx.bufferedSlotIds(env, 'case', { now: NOW });
  const insideNear = await Bx.slotInsideBuffer(env, { id: 'near', data: S.docs.get('availability/near').data }, { now: NOW });
  // NEGATIVE CONTROL (run 2026-10-17): bufferedSlotIds's `(kind === FIT_KIND) !== (d.kind === FIT_KIND)` skip taken out made this read
  //   FAIL  B6 his own open slots inside his buffer are hidden, free calls make no buffer, and a contractor's booking is not his
  check('B6 his own open slots inside his buffer are hidden, free calls make no buffer, and a contractor\'s booking is not his',
    JSON.stringify(cases.sort()) === JSON.stringify(['after', 'near']) && JSON.stringify(fits) === JSON.stringify(['fitnear'])
    && zero.length === 0 && insideNear === false,
    JSON.stringify({ cases, fits, zero, insideNear }));
}
{
  const me = { a: 0, b: HOUR, id: 'slot:m', held: true, until: 1000 };
  const other = (o) => [me, { a: 2 * HOUR, b: 3 * HOUR, id: 'slot:o', held: true, until: 1000, ...o }];
  const yieldTo = (o) => B.mustYield(other(o), me, 3 * HOUR);
  // NEGATIVE CONTROL (run 2026-10-17): mustYield's `!x.held ||` taken out made this read
  //   FAIL  B7 two holds inside one buffer: the first taken keeps it, a booking always wins
  check('B7 two holds inside one buffer: the first taken keeps it, a booking always wins',
    // A booking wins whatever its stamp says: the one below carries a later one on purpose.
    yieldTo({ until: 900 }) && !yieldTo({ until: 1100 }) && yieldTo({ held: false, until: 5000 }) && yieldTo({ held: false, until: 0 })
    && yieldTo({ id: 'slot:a' }) && !yieldTo({ id: 'slot:z' }) && !B.mustYield(other({ a: 10 * HOUR, b: 11 * HOUR, until: 1 }), me, 3 * HOUR));
}

// ---------------------------------------------------------------------------
console.log('\n--- B8: the contractor checkout ---');
{
  const docs = new Map();
  const stripe = [];
  let yieldNext = false;
  let times = [new Date('2026-10-20T14:00:00.000Z')];
  const deps = {
    json: (o, st = 200) => ({ status: st, body: o }),
    bookableTimes: async (e, uid) => (uid === 'ana' ? { times } : { error: 'That calendar is not open for booking.', code: 404 }),
    getDoc: async (e, p) => (docs.has(p) ? { data: clone(docs.get(p).data), updateTime: docs.get(p).v } : null),
    patchDoc: async (e, p, data, opts = {}) => {
      const cur = docs.get(p);
      if (opts.mustNotExist && cur) return false;
      if (opts.ifUpdateTime && (!cur || cur.v !== opts.ifUpdateTime)) return false;
      const next = opts.mask ? { ...(cur?.data || {}) } : {};
      if (opts.mask) for (const k of opts.mask) next[k] = data[k]; else Object.assign(next, data);
      docs.set(p, { data: clone(next), v: String((Number(cur?.v) || 0) + 1) });
      return true;
    },
    deleteDoc: async (e, p) => { docs.delete(p); return true; },
    holdMustYield: async () => yieldNext,
    ratesForCase: async (e, d) => (d.advocateId === 'ana' ? { caseCents: 190000, addonCents: 30000, fullCents: 380000 } : { caseCents: 1 }),
    stripePost: async (e, path, body) => { stripe.push({ path, body }); return { id: `cs_${stripe.length}`, url: `https://stripe.test/${stripe.length}` }; },
    caseLineItems: (cents) => [{ amount: cents }],
    HOLD_INTENT: CHARGE.HOLD_INTENT, HOLD_META: CHARGE.HOLD_META, HOLD_MINUTES: SCHED.HOLD_MINUTES,
    BOOK_MINUTES: 60, cleanPhone: (p) => p, cleanAddress: (a) => a || '',
  };
  const konst = (name) => { const m = W.match(new RegExp(`\\nconst ${name} = [^;]+;`)); if (!m) throw new Error(name); return m[0]; };
  const C = new Function(...Object.keys(deps), `${konst('BUFFER_RACE')}\n${lift('slotIdFor')}\n${lift('checkoutAdvocateTime')}
    return { checkoutAdvocateTime, slotIdFor };`)(...Object.values(deps));
  const o = (body) => ({ user: { uid: 'client1', email: 'c@x.test' }, identity: { email: 'c@x.test', name: 'Cy Client', dob: '1980-01-01' }, body: { advocate: 'ana', start: '2026-10-20T14:00:00.000Z', ...body }, method: 'video', phone: '+1 555 555 5555', acks: { disclaimer: 1 }, clientTz: 'America/Chicago' });
  const id = `availability/${C.slotIdFor(new Date('2026-10-20T14:00:00.000Z'))}-ana`;
  const him = await C.checkoutAdvocateTime({ ...env }, o({ advocate: ERIC }));
  const full = await C.checkoutAdvocateTime(env, o({ tier: 'full' }));
  const notOffered = await C.checkoutAdvocateTime(env, o({ start: '2026-10-20T15:00:00.000Z' }));
  const before = docs.size;
  const good = await C.checkoutAdvocateTime(env, o({ quotedCents: 190000 }));
  const held = docs.get(id)?.data || {};
  const sent = stripe[0]?.body || {};
  const again = await C.checkoutAdvocateTime(env, o({}));
  docs.set(id, { data: { ...held, holdExpiresAt: '2000-01-01T00:00:00.000Z' }, v: '9' });
  const lapsed = await C.checkoutAdvocateTime(env, o({}));
  docs.delete(id);
  yieldNext = true;
  const raced = await C.checkoutAdvocateTime(env, o({}));
  const afterRace = docs.has(id);
  yieldNext = false;
  const moved = await C.checkoutAdvocateTime(env, o({ quotedCents: 150000 }));
  const afterMove = docs.has(id);
  // NEGATIVE CONTROL (run 2026-10-17): checkoutAdvocateTime's `if (await holdMustYield(env, slotId).catch(() => false)) {` made `if (false) {` made this read
  //   FAIL  B8 the contractor checkout: their time only, held as theirs, given back on a race or a changed price, and their case
  check('B8 the contractor checkout: their time only, held as theirs, given back on a race or a changed price, and their case',
    him.status === 404 && full.status === 400 && notOffered.status === 409 && before === 0
    && good.status === 200 && good.body.url === 'https://stripe.test/1'
    && held.state === 'held' && held.advocateId === 'ana' && held.adminCreated === true && held.fromHours === true && held.heldBySession === 'cs_1'
    && held.heldByUid === 'client1' && held.durationMin === 60 && held.start === '2026-10-20T14:00:00.000Z'
    && JSON.stringify(sent.payment_intent_data) === JSON.stringify(CHARGE.HOLD_INTENT) && sent.metadata?.hold === '1'
    && sent.metadata?.advocateId === 'ana' && sent.metadata?.slotId === id.split('/')[1] && sent.line_items?.[0]?.amount === 190000
    && /book\.html\?advocate=ana&canceled=1$/.test(sent.cancel_url)
    && again.status === 409 && lapsed.status === 200
    && raced.status === 409 && /next to that one/.test(raced.body.error) && afterRace === false
    && moved.status === 409 && moved.body.error === 'rate-changed' && moved.body.caseCents === 190000 && afterMove === false,
    JSON.stringify({ him: him.status, full: full.status, notOffered: notOffered.status, good: good.status, held, again: again.status, lapsed: lapsed.status, raced: raced.status, afterRace, moved: moved.body, afterMove }));
}

// ---------------------------------------------------------------------------
console.log('\n--- B9 and B10: his own doors, and the pages ---');
{
  const checkout = lift('handleCheckout');
  const fit = lift('handleFitCall');
  // NEGATIVE CONTROL (run 2026-10-17): handleCheckout's buffer refusal (`if (await slotInsideBuffer(env, { id: slotId, data: slot.data })`) taken out made this read
  //   FAIL  B9 his checkout and the free call refuse a time inside the buffer, and the routes are public
  check('B9 his checkout and the free call refuse a time inside the buffer, and the routes are public',
    /if \(await slotInsideBuffer\(env, \{ id: slotId, data: slot\.data \}\)\.catch\(\(\) => false\)\)\n\s+return json\(\{ error: BUFFER_REFUSAL \}, 409\);\n\n\s+\/\/ Hold the slot\./.test(checkout)
    && /if \(!held\) return json[^\n]+\n[^\n]+\n\s+if \(await holdMustYield\(env, slotId\)\.catch\(\(\) => false\)\) \{/.test(checkout)
    && /if \(typeof body\.advocate === 'string' && body\.advocate\)\n\s+return await checkoutAdvocateTime\(env,/.test(checkout)
    && checkout.indexOf('checkoutAdvocateTime') < checkout.indexOf('const isRequest')
    && /if \(await slotInsideBuffer\(env, \{ id: body\.slotId, data: slot\.data \}\)\.catch\(\(\) => false\)\)/.test(fit)
    && fit.indexOf('slotInsideBuffer') < fit.indexOf('Take the slot')
    && /if \(url\.pathname === '\/api\/advocate-times' && request\.method === 'GET'\)\n\s+return await handleAdvocateTimes\(env, url\);/.test(W)
    && /if \(url\.pathname === '\/api\/slots\/buffered' && request\.method === 'GET'\)\n\s+return await handleBufferedSlots\(env, url\);/.test(W)
    && W.indexOf("'/api/advocate-times'") < W.indexOf("url.pathname === '/api/diag'")
    && /return json\(\{ name: got\.name, durationMin: got\.durationMin, times: got\.times\.map\(\(t\) => t\.toISOString\(\)\) \}\);/.test(W));

  const BOOK = f('public/js/book.js');
  const FIT = f('public/js/fit.js');
  const WIZ = f('public/js/admin-wizard.js');
  const MINE = f('public/js/admin-staffsettings.js');
  const DEMO = f('public/js/demo/api.js');
  const SSW = f('worker/staffsettings.js');
  const fresh = [f('worker/booking.js'), lift('checkoutAdvocateTime'), lift('handleAdvocateTimes'), lift('handleBufferedSlots'),
    (BOOK.match(/async function renderAdvocateTimes[\s\S]*?\n\}/) || [''])[0]];
  // NEGATIVE CONTROL (run 2026-10-17): book.js's `if (blocked.length) slots = slots.filter((s) => !blocked.includes(s.id));` taken out made this read
  //   FAIL  B10 the pages: their calendar, his buffered slots hidden, his card's buffer, their link, and the demo mirrors it
  check('B10 the pages: their calendar, his buffered slots hidden, his card\'s buffer, their link, and the demo mirrors it',
    /fetch\(`\/api\/advocate-times\?advocate=\$\{encodeURIComponent\(ADVOCATE\)\}`\)/.test(BOOK)
    && /\.\.\.\(ADVOCATE && state\.slot \? \{ advocate: ADVOCATE, start: state\.slot\.start\.toISOString\(\) \} : \{\}\),/.test(BOOK)
    && /slotId: state\.slot && !ADVOCATE \? state\.slot\.id : undefined,/.test(BOOK)
    && /el\.querySelector\('#request-box'\)\?\.remove\(\);/.test(BOOK)
    && /fetch\('\/api\/slots\/buffered\?kind=case'\)/.test(BOOK) && /if \(blocked\.length\) slots = slots\.filter\(\(s\) => !blocked\.includes\(s\.id\)\);/.test(BOOK)
    && /if \(data\.fromHours\) return;/.test(BOOK)
    && /fetch\(`\/api\/rates\?advocate=\$\{encodeURIComponent\(ADVOCATE\)\}`\)/.test(BOOK)
    && /fetch\('\/api\/slots\/buffered\?kind=fit'\)/.test(FIT)
    && /const OWNER_STEPS = \['who', 'addons', 'hours', 'profile', 'review'\];/.test(WIZ) && /function bufferField\(\)/.test(WIZ)
    && /data-book-link>Their booking link:/.test(WIZ)
    && /bookingPath: `\/book\.html\?advocate=\$\{encodeURIComponent\(staff\.uid\)\}`,/.test(SSW) && /bufferHours: bufferHoursOf\(rec\?\.data\),/.test(SSW)
    && /data-ssh-link/.test(MINE) && /Eric sets this\./.test(MINE)
    && /if \(path === '\/api\/advocate-times'\) \{/.test(DEMO) && /if \(path === '\/api\/slots\/buffered'\) \{/.test(DEMO)
    && /if \(advUid\) \{\n\s+const got = demoTimes\(advUid\);/.test(DEMO) && /bufferHours: demoBuffer\(a\),/.test(DEMO)
    && /bookingPath: `\/book\.html\?advocate=\$\{encodeURIComponent\(me\)\}`, bufferHours: demoBuffer\(rec\),/.test(DEMO)
    && fresh.every((s) => s && !DASH.test(s)) && !DASH.test(MINE) && !DASH.test(WIZ),
    'page shape');
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
