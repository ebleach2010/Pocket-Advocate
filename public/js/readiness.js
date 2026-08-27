// The Hands-Off readiness checklist (Eric, 2026-08-25: "There needs to be a
// checklist on their end that populates in order for me to begin... but the
// clock starts upon booking").
//
// DERIVED, never stored. Every row is backed by a record that already
// exists - the scope-note acknowledgment on the case, the signed authority
// documents behind /api/authority - so the checklist can never disagree
// with the documents themselves, needs no route of its own, and holds
// nothing a client could tick past. Both sides render from this one
// function, so the two views cannot drift.

export function handsOffReadiness(c, authorityItems = []) {
  const live = (authorityItems || []).filter((i) => !i.revokedAt);
  const rows = [
    {
      id: 'scope',
      label: 'The scope note, read and acknowledged',
      done: !!(c?.forms?.fullAccess),
    },
    {
      id: 'records',
      label: 'A records authorisation signed for at least one clinic',
      // It has to actually authorise something. A records form with every
      // communication box unticked is a piece of paper, not permission, and
      // reading it as "ready" told Eric he could pick up the phone.
      // Documents signed before scopes existed have no scopes field at all
      // and did authorise the full set, so undefined counts and [] does not.
      done: live.some((i) => i.kind === 'records'
        && (!Array.isArray(i.scopes) || i.scopes.length > 0)),
    },
    {
      id: 'representative',
      label: 'The insurance representative designation signed',
      done: live.some((i) => i.kind === 'representative'),
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
