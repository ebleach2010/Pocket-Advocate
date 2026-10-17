// THEIR OWN SERVICES (Eric, 2026-10-17: "Allow me to turn different tiers on
// and off for each contractor (including new tier types that a contractor
// wants during onboarding)." Asked one-time or monthly: "Either, their
// choice". Asked what buying a one-time one does: "Opens a case, no time".
// A monthly one: "Like Full-Service".)
//
// A contractor's own services live on their record (advocates/{uid}.services):
// a name, a line about it, one-time or monthly, a price, and on or off. They
// ask for one from their settings; it stays off until he turns it on, on their
// card in Employer mode, where he can also add, change or take one away.
//
// Either kind is sold from their booking page like a case, with the card held
// until they take it on, and opens a case with no call time: they set things
// up together in the case chat. A monthly one buys a month at a time, like
// Full-Service (2026-10-17, v7.75): thirty days from the day it is taken on, a heads-up
// three days before the end, the case closes at the end, and another month is
// asked for afterwards, which their advocate says yes or no to
// (worker/monthend.js).

const SERVICE_ID = /^s[a-z0-9]{8}$/;
export const SERVICE_MAX = 6;
const MAX_CENTS = 2_000_000;
const NAME_MAX = 60;
const ABOUT_MAX = 240;
export const SERVICE_KINDS = ['once', 'month'];
const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const centsOf = (v) => (Number.isInteger(v) && v >= 0 && v <= MAX_CENTS ? v : 0);

/** Their services as stored: every one well formed, the rest dropped. */
export function servicesOf(record) {
  const list = Array.isArray(record?.services) ? record.services : [];
  return list.filter((x) => x && SERVICE_ID.test(String(x.id)) && text(x.label, NAME_MAX).length >= 2).slice(0, SERVICE_MAX).map((x) => ({
    id: x.id,
    label: text(x.label, NAME_MAX),
    about: text(x.about, ABOUT_MAX),
    kind: SERVICE_KINDS.includes(x.kind) ? x.kind : 'once',
    cents: centsOf(x.cents),
    on: x.on === true,
    askedAt: x.askedAt || null,
  }));
}

/** What a client can buy right now: on and priced, one-time or monthly. */
export function sellable(s) {
  return !!s && s.on === true && SERVICE_KINDS.includes(s.kind) && s.cents >= 50;
}

/** A month of their own service, in days, as a month of Full-Service is. */
export const SERVICE_MONTH_DAYS = 30;

/**
 * When the month a monthly service case is on runs out: thirty days for each
 * month from the day their advocate took it on (the card is only held until
 * then, so no day of it is spent waiting), plus any time the case sat paused
 * (`heldMs`, from the Worker). Null while the card is held, and for anything
 * that is not a monthly service case.
 */
export function serviceWindowEnd(c, heldMs = 0) {
  if (c?.serviceMonthly !== true || c.charge?.state === 'held') return null;
  const start = new Date(c.charge?.decidedAt || c.charge?.capturedAt || c.serviceAt || c.createdAt || 0).getTime();
  if (!Number.isFinite(start) || !start) return null;
  const days = SERVICE_MONTH_DAYS + (Number(c.serviceExtraDays) || 0);
  return new Date(start + days * 86_400_000 + (Number(heldMs) || 0));
}

/** One service by id, or null. */
export function serviceOf(record, id) {
  return SERVICE_ID.test(String(id || '')) ? servicesOf(record).find((s) => s.id === id) || null : null;
}

/**
 * Services as sent, checked: { value } to store, or { error }. `admin` is him
 * on their card: he may switch them on. Anyone else (the contractor asking)
 * keeps each service's switch where it was, a new one starts off, and one
 * whose name or kind they change goes off again until he looks: he turned on
 * what he saw. Their price is theirs, as all their prices are.
 */
export function cleanServices(input, prev = [], { admin = false } = {}) {
  if (!Array.isArray(input)) return { error: 'Bad services.' };
  const before = new Map((Array.isArray(prev) ? prev : []).filter((x) => x && SERVICE_ID.test(String(x.id))).map((x) => [x.id, x]));
  const rows = input.filter((x) => x && (text(x.label, NAME_MAX) || text(x.about, ABOUT_MAX)));
  if (rows.length > SERVICE_MAX) return { error: `Up to ${SERVICE_MAX} services of their own.` };
  const seen = new Set();
  const value = [];
  for (const x of rows) {
    const name = text(x.label, NAME_MAX);
    if (name.length < 2) return { error: 'Each service needs a name.' };
    if (seen.has(name.toLowerCase())) return { error: `${name} is there twice.` };
    seen.add(name.toLowerCase());
    const kind = SERVICE_KINDS.includes(x.kind) ? x.kind : '';
    if (!kind) return { error: `${name}: one-time or monthly.` };
    const cents = Number(x.cents);
    if (!Number.isInteger(cents) || cents < 50 || cents > MAX_CENTS) return { error: `${name}: a price from $0.50 to $20,000.` };
    // An id is kept once given, so a case opened from it still finds its service.
    const id = SERVICE_ID.test(String(x.id)) ? x.id : `s${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
    const was = before.get(id);
    const same = !!was && text(was.label, NAME_MAX).toLowerCase() === name.toLowerCase() && was.kind === kind;
    const on = admin ? x.on === true : same && was.on === true;
    // When they asked: kept while it is the same service, new when they ask for a new or changed one.
    const askedAt = admin || same ? was?.askedAt || null : new Date().toISOString();
    value.push({ id, label: name, about: text(x.about, ABOUT_MAX), kind, cents, on, askedAt });
  }
  return { value };
}

/** The ones a contractor has just asked for, new or changed, that wait for him, by name: what he is told about. */
export function newlyAsked(before, after) {
  const had = new Map(servicesOf({ services: before }).map((s) => [s.id, s.askedAt]));
  return servicesOf({ services: after }).filter((s) => !s.on && s.askedAt && s.askedAt !== had.get(s.id)).map((s) => s.label);
}
