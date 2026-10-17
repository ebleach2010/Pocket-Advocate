// CONTRACTORS' OWN SETTINGS (Eric, 2026-10-15: "Contractors have controls in
// settings just like me."). His settings are the business's: one in/out
// switch and response line (config/officeHours), one price list
// (config/rates), one Full-Service limit (config/fullAccess). A contractor
// gets the same three, for their own clients only, kept on their own record
// (advocates/{uid}.settings) and changed only through this Worker:
//
//   in office, out of office, or follow the office hours, and the response
//   line their clients read;
//   their prices: an Advocacy Case (what their invitations start at), a
//   follow-up call and a Full-Service month;
//   how many Full-Service clients they take at once.
//
// Nothing here can reach his settings or anyone else's: the route writes the
// signed-in contractor's own record and nothing else. A case decides whose
// settings apply by its advocate (advocateIdOf), so his cases, and every
// case from before contractors existed, read his exactly as they always have.
//
// Routes:
//   GET  /api/staff/settings    a contractor's own settings (404 for him: his live in the cog's own rows)
//   POST /api/staff/settings    change them

import { getDoc, patchDoc } from './firestore.js';
import { advocateIdOf } from './staff.js';

const UID_RE = /^[\w-]{1,64}$/;
/** The week, Monday first, as their hours are kept. */
export const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const minutes = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
// The same ceiling his own price editor has.
export const STAFF_RATE_MAX_CENTS = 2_000_000;
export const STAFF_RATE_KEYS = ['caseCents', 'addonCents', 'fullCents'];
const LINE_MAX = 160;

// THE BUFFER (Eric, 2026-10-17: "A scheduled time automatically blocks off 3
// hours before and after around the appointment. This is baseline for
// everyone. But can be adjusted per contractor in employer mode."). On the
// record itself (advocates/{uid}.bufferHours), his own included; worker/booking.js applies it.
export const DEFAULT_BUFFER_HOURS = 3;
export const BUFFER_MAX_HOURS = 12;
/** The buffer on an advocate's record, in hours: 0 to 12 in half hours, 3 when never set. */
export function bufferHoursOf(record) {
  const v = record?.bufferHours;
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= BUFFER_MAX_HOURS && Math.round(v * 2) === v * 2
    ? v : DEFAULT_BUFFER_HOURS;
}

/** A buffer as typed, checked: { value } or { error }. */
export function cleanBufferHours(input) {
  const v = typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > BUFFER_MAX_HOURS || Math.round(v * 2) !== v * 2)
    return { error: `The buffer is hours, from 0 to ${BUFFER_MAX_HOURS}, in half hours.` };
  return { value: v };
}

/** The settings off a record, cleaned the same way on every read. */
export function settingsFrom(record) {
  const s = record?.settings || {};
  const manual = s.office?.manual === 'in' || s.office?.manual === 'out' ? s.office.manual : null;
  const line = typeof s.office?.responseTime === 'string' ? s.office.responseTime.trim().slice(0, LINE_MAX) : '';
  const rates = {};
  for (const k of STAFF_RATE_KEYS) {
    // A number, not something Number() will politely turn into one.
    const v = s.rates?.[k];
    if (typeof v === 'number' && Number.isInteger(v) && v >= 50 && v <= STAFF_RATE_MAX_CENTS) rates[k] = v;
  }
  const cap = s.fullCap;
  return {
    office: { manual, responseTime: line || null },
    rates,
    // A whole number from 0 (no limit) to 99, or null: not chosen, which is no limit too.
    fullCap: Number.isInteger(cap) && cap >= 0 && cap <= 99 ? cap : null,
    hours: hoursFrom(s.hours),
    offers: offersFrom(s.offers),
  };
}

/**
 * THEIR WEEK (Eric, 2026-10-17: "their initial schedule"). { mon: { from,
 * to } | null, ... } on their own clock (the record's tz), or null when none
 * was set, which follows the office hours as before. Their in or out light
 * follows it; a hand set in or out still beats it.
 */
export function hoursFrom(h) {
  if (!h || typeof h !== 'object') return null;
  const out = {};
  let any = false;
  for (const d of DAYS) {
    const v = h[d];
    if (v && HHMM.test(String(v.from)) && HHMM.test(String(v.to)) && minutes(v.to) > minutes(v.from)) { out[d] = { from: v.from, to: v.to }; any = true; } else out[d] = null;
  }
  return any ? out : null;
}

/** Their week as typed, checked: { value } (null clears it) or { error }. */
export function cleanHours(input) {
  if (input === null) return { value: null };
  if (!input || typeof input !== 'object') return { error: 'Their hours, day by day.' };
  const value = {};
  for (const d of DAYS) {
    const v = input[d];
    if (!v) { value[d] = null; continue; }
    if (!HHMM.test(String(v.from)) || !HHMM.test(String(v.to))) return { error: 'Each working day needs a start and an end time.' };
    if (minutes(v.to) <= minutes(v.from)) return { error: 'Each working day ends after it starts.' };
    value[d] = { from: v.from, to: v.to };
  }
  return { value };
}

/**
 * What they offer (Eric, 2026-10-17: "everything I asked I could toggle on or
 * off"). His to switch, never theirs. Not set is on, the way it always was.
 */
export function offersFrom(o) {
  return { case: o?.case !== false, full: o?.full !== false };
}

/**
 * The contractor a record belongs to, or '' when it is his: a case or slot
 * with no advocate, his own uid, or anything unreadable.
 */
export function contractorOf(data, env) {
  const uid = advocateIdOf(data, env);
  return uid && uid !== env.ADMIN_UID && UID_RE.test(uid) ? uid : '';
}

/**
 * A contractor's settings, or null: no such record, turned off, or his own
 * record (owner). Null means "use his", the way it always was.
 */
export async function contractorSettings(env, uid) {
  if (!uid || !UID_RE.test(uid) || uid === env.ADMIN_UID) return null;
  const rec = await getDoc(env, `advocates/${uid}`).catch(() => null);
  const d = rec?.data;
  if (!d || d.owner === true || d.active !== true) return null;
  return { ...settingsFrom(d), tz: d.tz || null };
}

/** His price list with a contractor's own prices laid over it, key by key. */
export function mergeRates(base, own) {
  const out = { ...base };
  for (const k of STAFF_RATE_KEYS) if (Number(own?.rates?.[k]) > 0) out[k] = own.rates[k];
  return out;
}

/**
 * What a change asks for, checked: { patch, mask } to write, or { error }.
 * `admin` is him setting someone's up (2026-10-17): only he may switch what
 * they offer.
 */
export function cleanSettingsChange(body, { admin = false } = {}) {
  const patch = {};
  const mask = [];
  if (body?.office !== undefined) {
    const o = body.office || {};
    if (o.manual !== undefined) {
      if (o.manual !== 'in' && o.manual !== 'out' && o.manual !== null) return { error: "In office, out of office, or follow the office hours." };
      patch['settings.office.manual'] = o.manual;
      mask.push('settings.office.manual');
    }
    if (o.responseTime !== undefined) {
      if (o.responseTime !== null && typeof o.responseTime !== 'string') return { error: 'A response time is a line of text.' };
      const typed = String(o.responseTime ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
      patch['settings.office.responseTime'] = typed ? typed.slice(0, LINE_MAX) : null;
      mask.push('settings.office.responseTime');
    }
  }
  if (body?.rates !== undefined) {
    for (const k of STAFF_RATE_KEYS) {
      if (body.rates?.[k] === undefined) continue;
      const v = body.rates[k];
      if (v === null) { patch[`settings.rates.${k}`] = null; mask.push(`settings.rates.${k}`); continue; }
      const cents = Number(v);
      if (!Number.isInteger(cents) || cents < 50 || cents > STAFF_RATE_MAX_CENTS)
        return { error: `A price from $0.50 to $${(STAFF_RATE_MAX_CENTS / 100).toLocaleString('en-US')}.` };
      patch[`settings.rates.${k}`] = cents;
      mask.push(`settings.rates.${k}`);
    }
  }
  if (body?.fullCap !== undefined) {
    const cap = body.fullCap;
    if (cap !== null && !(Number.isInteger(cap) && cap >= 0 && cap <= 99)) return { error: 'A number from 0 (no limit) to 99.' };
    patch['settings.fullCap'] = cap;
    mask.push('settings.fullCap');
  }
  if (body?.hours !== undefined) {
    const got = cleanHours(body.hours);
    if (got.error) return { error: got.error };
    patch['settings.hours'] = got.value;
    mask.push('settings.hours');
  }
  if (body?.offers !== undefined) {
    if (!admin) return { error: 'What you offer is set by Eric.' };
    for (const k of ['case', 'full']) {
      if (body.offers?.[k] === undefined) continue;
      patch[`settings.offers.${k}`] = body.offers[k] === true;
      mask.push(`settings.offers.${k}`);
    }
  }
  if (!mask.length) return { error: 'Nothing to change.' };
  return { patch, mask };
}

/** A nested patch, from the dotted one above (patchDoc takes nested data and dotted mask paths). */
export function nest(flat) {
  const out = {};
  for (const [path, v] of Object.entries(flat)) {
    const keys = path.split('.');
    let at = out;
    keys.slice(0, -1).forEach((k) => { at[k] = at[k] || {}; at = at[k]; });
    at[keys[keys.length - 1]] = v;
  }
  return out;
}

/**
 * GET/POST /api/staff/settings. A contractor's own, and nobody else's: the
 * record written is always the signed-in contractor's. He has his own rows
 * for the business's settings, so this answers him with the 404.
 */
export async function handleStaffSettings(request, env, h) {
  const staff = await h.requireStaff(request, env);
  if (!staff || staff.isAdmin) return h.json({ error: 'Not found' }, 404);
  const path = `advocates/${staff.uid}`;
  if (request.method === 'POST') {
    const body = (await request.json().catch(() => null)) || {};
    const got = cleanSettingsChange(body);
    if (got.error) return h.json({ error: got.error }, 400);
    await patchDoc(env, path, nest({ ...got.patch, 'settings.updatedAt': new Date() }), { mask: [...got.mask, 'settings.updatedAt'] });
  } else if (request.method !== 'GET') {
    return h.json({ error: 'Not found' }, 404);
  }
  const rec = await getDoc(env, path).catch(() => null);
  const mine = settingsFrom(rec?.data);
  const base = await h.readRates(env).catch(() => ({}));
  // Their light follows their own week once there is one (2026-10-17).
  const office = h.officeStatus(mine.office.manual, new Date(), mine.hours ? { hours: mine.hours, tz: rec?.data?.tz } : null);
  return h.json({
    office: { ...office, manual: mine.office.manual, responseTime: mine.office.responseTime },
    rates: mine.rates,
    // His prices, shown beside theirs as the starting point, never as a rule.
    standard: { caseCents: base.caseCents, addonCents: base.addonCents, fullCents: base.fullCents },
    fullCap: mine.fullCap,
    hours: mine.hours,
    tz: rec?.data?.tz || 'America/Boise',
    offers: mine.offers,
    // Their hours are bookable (2026-10-17): the link their clients book from, and the buffer he set around each paid appointment.
    bookingPath: `/book.html?advocate=${encodeURIComponent(staff.uid)}`,
    bufferHours: bufferHoursOf(rec?.data),
  });
}
