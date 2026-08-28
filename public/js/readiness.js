// The Hands-Off readiness checklist (Eric, 2026-08-25: "There needs to be a
// checklist on their end that populates in order for me to begin... but the
// clock starts upon booking").
//
// DERIVED, never stored. The one row left is backed by a record that already
// exists, the scope-note acknowledgment on the case, so the checklist can
// never disagree with the case itself, needs no route of its own, and holds
// nothing a client could tick past. Both sides render from this one function,
// so the two views cannot drift.
//
// WHY IT IS ONE ROW NOW (2026-08-27). It had three. Two of them were derived
// from the signed authority documents, and signing them on the case page was
// parked on Eric's word the same day. A row nothing can satisfy is not a
// checklist, it is a card pinned at "Not ready yet" on every case he ever
// opens, so those two rows are gone rather than left to rot.
//
// AND "READY" NO LONGER MEANS "you may pick up the phone". That claim needed
// a signed records release behind it, which this file can no longer see. What
// is left is exactly what the app still knows: whether they have read and
// acknowledged the scope note. His own card reports the permissions on file
// separately, in its own words, and goes orange when there are none, so the
// warning that used to ride on this checklist did not go anywhere.

export function handsOffReadiness(c) {
  // Two records satisfy the one row, because there are two ways onto the
  // tier. Bought in the app: the scope note was read and acknowledged at
  // checkout (forms.fullAccess). Opened by hand: nothing was acknowledged at
  // purchase, and the scope of work agreement signed on the case page
  // (scopeSignedAt, stamped by the Worker at signing) is the record that
  // closes the gap (Eric, 2026-08-29: "All I need is scope of work
  // agreement"). Before that stamp existed a hand-opened case sat at "Not
  // ready" forever, with nothing the client could do about it.
  const rows = [
    {
      id: 'scope',
      label: 'The scope of work, read and agreed',
      done: !!(c?.forms?.fullAccess || c?.scopeSignedAt),
    },
  ];
  return { rows, ready: rows.every((r) => r.done) };
}

/**
 * Has this case's Hands-Off month not begun yet?
 *
 * ONE PREDICATE, because there are three parties to this sentence and they
 * were disagreeing. The Worker decides whether the client's email mentions a
 * future month; the client's own case page decides whether it says the month
 * "starts" or "started"; his confirmation line says the same thing back to
 * him. All three describe one fact and all three must answer the same.
 *
 * TWELVE HOURS OF GRACE, matching worker/index.js (action 'open-full', where
 * startsLater is startAt > now + 12 hours). This is not a rounding nicety.
 * The panel stores NOON Mountain on the day he picks, so opening a case at
 * nine in the morning to start TODAY lands three hours in the future. With a
 * bare `> Date.now()` the Worker sent the ordinary email while both screens
 * announced a month that "starts later", for three hours, on every same-day
 * opening. Same-day is the common case.
 *
 * READS A FIRESTORE TIMESTAMP, not just a string. Both browser halves take
 * this field straight off the SDK, where valueOf() is a zero-padded sort key
 * and `new Date(stamp)` is Invalid Date. A bare `new Date()` here would
 * return false on every real case while every source-text check stayed green,
 * which is the silent pass this comment exists to prevent. The pattern is the
 * one every other browser reader already uses (case.js:1900,
 * admin-case.js:3262, admin-calendar.js:143).
 */
export const HANDS_OFF_START_GRACE_MS = 12 * 3600_000;

export function handsOffStartsLater(c, now = Date.now()) {
  const raw = c?.fullAccessAt;
  if (!raw) return false;
  const at = raw.toDate ? raw.toDate().getTime() : new Date(raw).getTime();
  if (!Number.isFinite(at)) return false;
  return at > now + HANDS_OFF_START_GRACE_MS;
}
