// BOOKABLE HOURS AND THE BUFFER (Eric, 2026-10-17: "Yes, with an adjustable
// buffer block around it. A scheduled time automatically blocks off 3 hours
// before and after around the appointment. This is baseline for everyone. But
// can be adjusted per contractor in employer mode.")
//
// A contractor's available hours (advocates/{uid}.settings.hours, on their own
// clock) are the times their clients can book: an Advocacy Case call of an
// hour, starting on the hour or the half hour, inside the same lead time and
// horizon as his own calendar. His own bookable times stay the ones he opens
// in his Calendar.
//
// THE BUFFER is everyone's, his included: no paid appointment may be booked
// within bufferHours (3 unless he set another on their card) before or after
// another paid appointment of the same advocate. Free calls make no buffer,
// but cannot be booked inside one (his answer, 2026-10-17: "Paid only").
// Staff scheduling by hand is not held to it: that is him, or them, putting a
// client where the two of them agreed to meet.
//
// The pure parts (the buffer, the times from a week, the paid appointments)
// are exported for the suites; the reads below them gather the world once.

import { getDoc, listDocs } from './firestore.js';
import { advocateIdOf } from './staff.js';
import { settingsFrom, bufferHoursOf } from './staffsettings.js';
// The buffer's numbers live with the rest of an advocate's settings; said again here for the routes that book.
export { DEFAULT_BUFFER_HOURS, BUFFER_MAX_HOURS, bufferHoursOf, cleanBufferHours } from './staffsettings.js';
import { LEAD_TIME_HOURS, MAX_LEAD_TIME_HOURS } from './schedule.js';

/** An Advocacy Case call, the thing a contractor's hours sell. */
export const BOOK_MINUTES = 60;
/** Times start on the hour and the half hour. */
export const BOOK_STEP_MINUTES = 30;
const FIT_KIND = 'fit';
const UID_RE = /^[\w-]{1,64}$/;
const HOUR = 3600_000;

const ms = (v) => {
  const t = v?.toDate ? v.toDate().getTime() : new Date(v || 0).getTime();
  return Number.isFinite(t) ? t : 0;
};

/**
 * One advocate's paid appointments as { a, b, id, held, until }: the slots
 * booked or held (a hold that has run out is nothing), the invitations still
 * waiting on the client, and the cases with a set time. Free calls, requested
 * times, closed cases and anyone else's are left out. Pure.
 */
export function paidIntervals({ slots = [], invites = [], cases = [] }, uid, env, now = Date.now()) {
  const out = [];
  for (const { id, data: d } of slots) {
    if (!d || d.kind === FIT_KIND || advocateIdOf(d, env) !== uid) continue;
    const held = d.state === 'held' && ms(d.holdExpiresAt) > now;
    if (d.state !== 'booked' && !held) continue;
    const a = ms(d.start);
    if (a) out.push({ a, b: a + (Number(d.durationMin) || BOOK_MINUTES) * 60_000, id: `slot:${id}`, held, until: held ? ms(d.holdExpiresAt) : 0 });
  }
  for (const { id, data: d } of invites) {
    if (!d || d.state !== 'sent' || advocateIdOf(d, env) !== uid) continue;
    const a = ms(d.start);
    if (a) out.push({ a, b: a + BOOK_MINUTES * 60_000, id: `invite:${id}`, held: false, until: 0 });
  }
  for (const { id, data: c } of cases) {
    if (!c || c.status === 'closed' || c.self || c.showcase || advocateIdOf(c, env) !== uid) continue;
    const ap = c.appointment;
    if (!ap || ap.requested) continue;
    const a = ms(ap.start);
    if (a) out.push({ a, b: a + (Number(ap.durationMin) || BOOK_MINUTES) * 60_000, id: `case:${id}`, held: false, until: 0 });
  }
  return out;
}

/** The appointments [s, e) would sit within the buffer of, leaving out the ids given. Pure. */
export function conflictsWith(intervals, bufferMs, s, e, except = []) {
  return intervals.filter((x) => !except.includes(x.id) && s < x.b + bufferMs && e > x.a - bufferMs);
}

/** True when [s, e) sits inside someone's buffer. Pure. */
export function insideBuffer(intervals, bufferMs, s, e, except = []) {
  return conflictsWith(intervals, bufferMs, s, e, except).length > 0;
}

/**
 * After a hold is taken, two clients may each hold a time inside the other's
 * buffer. Each side decides the same way: a booking, a case or an invitation
 * always wins, and between two holds the one taken first (its hold runs out
 * first; ties by id) keeps it. True when this hold must be given back. Pure.
 */
export function mustYield(intervals, me, bufferMs) {
  return conflictsWith(intervals, bufferMs, me.a, me.b, [me.id]).some((x) =>
    !x.held || x.until < me.until || (x.until === me.until && x.id < me.id));
}

const fmtCache = new Map();
function partsIn(zone) {
  if (!fmtCache.has(zone)) {
    fmtCache.set(zone, new Intl.DateTimeFormat('en-US', {
      timeZone: zone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }));
  }
  const f = fmtCache.get(zone);
  return (t) => {
    const p = Object.fromEntries(f.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return { day: String(p.weekday).slice(0, 3).toLowerCase(), min: (Number(p.hour) % 24) * 60 + Number(p.minute) };
  };
}
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/**
 * The times a week offers: every start on the hour or half hour, on the
 * advocate's own clock, whose whole call fits inside that day's hours, from
 * the lead time to the horizon. Daylight saving moves with the clock, the way
 * a wall calendar does. Pure.
 */
export function timesFromHours(hours, tz, {
  now = Date.now(), durationMin = BOOK_MINUTES, stepMin = BOOK_STEP_MINUTES,
  leadMs = LEAD_TIME_HOURS * HOUR, horizonMs = MAX_LEAD_TIME_HOURS * HOUR,
} = {}) {
  if (!hours || typeof hours !== 'object') return [];
  let zone = 'America/Boise';
  try { if (tz) { new Intl.DateTimeFormat('en-US', { timeZone: tz }); zone = tz; } } catch { /* his */ }
  const at = partsIn(zone);
  const quarter = 15 * 60_000;
  const first = Math.ceil((now + leadMs) / quarter) * quarter;
  const out = [];
  for (let t = first; t <= now + horizonMs; t += quarter) {
    const { day, min } = at(t);
    if (min % stepMin) continue;
    const span = hours[day];
    if (!span || typeof span.from !== 'string' || typeof span.to !== 'string') continue;
    if (min >= toMin(span.from) && min + durationMin <= toMin(span.to)) out.push(new Date(t));
  }
  return out;
}

// ---- the reads -----------------------------------------------------------------------

/** Every slot, invitation and case, read once for a decision. */
export async function readBookingWorld(env) {
  const [slots, invites, cases] = await Promise.all([
    listDocs(env, 'availability', { pageSize: 300, all: true }),
    listDocs(env, 'invites', { pageSize: 300, all: true }),
    listDocs(env, 'cases', { pageSize: 300, all: true }),
  ]);
  return { slots, invites, cases };
}

/**
 * The same, kept for half a minute in this isolate, for the public pickers
 * only: a page view should not cost a read of every case. A time it shows
 * that has just been taken is refused at checkout, which reads afresh.
 */
let recent = { at: 0, world: null };
export async function recentBookingWorld(env, maxAgeMs = 30_000) {
  if (!recent.world || Date.now() - recent.at > maxAgeMs) recent = { at: Date.now(), world: await readBookingWorld(env) };
  return recent.world;
}

/** An advocate's buffer in milliseconds, his included (his record is advocates/{his uid}). */
export async function bufferMsFor(env, uid) {
  const rec = UID_RE.test(String(uid || '')) ? await getDoc(env, `advocates/${uid}`).catch(() => null) : null;
  return bufferHoursOf(rec?.data) * HOUR;
}

/**
 * A contractor's bookable times right now, or { error, code }: never his (his
 * are his Calendar), never someone turned off, not taking Advocacy Cases, or
 * with no hours set.
 */
export async function bookableTimes(env, uid, { now = Date.now(), world = null } = {}) {
  const closed = { error: 'That calendar is not open for booking.', code: 404 };
  if (!UID_RE.test(String(uid || '')) || uid === env.ADMIN_UID) return closed;
  const rec = await getDoc(env, `advocates/${uid}`).catch(() => null);
  const d = rec?.data;
  if (!d || d.active !== true || d.owner === true) return closed;
  const s = settingsFrom(d);
  if (!s.offers.case || !s.hours) return closed;
  const w = world || await readBookingWorld(env);
  const intervals = paidIntervals(w, uid, env, now);
  const buf = bufferHoursOf(d) * HOUR;
  const times = timesFromHours(s.hours, d.tz, { now })
    .filter((t) => !insideBuffer(intervals, buf, t.getTime(), t.getTime() + BOOK_MINUTES * 60_000));
  return { name: String(d.name || '').trim(), tz: d.tz || 'America/Boise', durationMin: BOOK_MINUTES, times };
}

/**
 * The ids of his open slots of one kind ('case' or 'fit') that sit inside his
 * buffer right now, so his pickers leave them out. A free call booked next to
 * a slot never hides it: free calls make no buffer.
 */
export async function bufferedSlotIds(env, kind, { now = Date.now(), world = null } = {}) {
  const uid = String(env.ADMIN_UID || '');
  const w = world || await readBookingWorld(env);
  const intervals = paidIntervals(w, uid, env, now);
  const buf = await bufferMsFor(env, uid);
  const out = [];
  for (const { id, data: d } of w.slots) {
    if (!d || d.state !== 'open' || advocateIdOf(d, env) !== uid) continue;
    if ((kind === FIT_KIND) !== (d.kind === FIT_KIND)) continue;
    const a = ms(d.start);
    const b = a + (Number(d.durationMin) || (d.kind === FIT_KIND ? 15 : BOOK_MINUTES)) * 60_000;
    if (a && insideBuffer(intervals, buf, a, b, [`slot:${id}`])) out.push(id);
  }
  return out;
}

/** True when one slot (a { id, data } row) sits inside its advocate's buffer. */
export async function slotInsideBuffer(env, row, { now = Date.now() } = {}) {
  const uid = advocateIdOf(row.data, env);
  const w = await readBookingWorld(env);
  const a = ms(row.data.start);
  const b = a + (Number(row.data.durationMin) || BOOK_MINUTES) * 60_000;
  return insideBuffer(paidIntervals(w, uid, env, now), await bufferMsFor(env, uid), a, b, [`slot:${row.id}`]);
}

/**
 * Read again once a hold is taken: true when another paid hold or booking
 * landed inside the buffer first, and this hold has to go back.
 */
export async function holdMustYield(env, slotId, { now = Date.now() } = {}) {
  const w = await readBookingWorld(env);
  const mine = w.slots.find((r) => r.id === slotId);
  if (!mine) return false;
  const uid = advocateIdOf(mine.data, env);
  const intervals = paidIntervals(w, uid, env, now);
  const me = intervals.find((x) => x.id === `slot:${slotId}`);
  if (!me) return false;
  return mustYield(intervals, me, await bufferMsFor(env, uid));
}
