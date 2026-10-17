// PAST THE MONTH'S 20 HOURS (Eric, 2026-10-17: "The full service clients
// should get a notification and a pop up when opening the app once 20 hours
// have passed. 'To continue, select one of the three: continue up to the full
// 30 days for [$/hour] | Purchase an addition month at [fulll case price] |
// end case (all information is kept for your reference)'"). Asked the rate:
// "$200 an hour". Asked how it is paid: "Advocate bills hours used": the
// advocate taps Bill extra hours and the client gets a link to pay for the
// time past 20.
//
// One module, read by the client's case page, the advocate's case page, the
// demo and the Worker (worker/hours.js imports it), so the hours the client is
// asked about, the hours the advocate bills and the hours the Worker charges
// for are always the same hours.

/** The hours a month includes (FULL_INCLUDED_HOURS in the Worker and case.js; the hours suite pins all three equal). */
export const MONTH_HOURS = 20;
/** Eric, 2026-10-17: "$200 an hour". */
export const EXTRA_HOUR_CENTS = 20000;

/**
 * Where a Full-Service case stands against its hours. Every month bought adds
 * 20 hours; hours already billed and paid for are their own, so a month bought
 * after them is never spent on them twice.
 *   delivered  seconds of Full-Service work banked (the review's are not counted)
 *   included   seconds the months bought cover
 *   used       delivered, less what was billed: what the months are measured against
 *   extra      seconds past the months and past what was billed: what is left to bill
 */
export function hoursOf(c) {
  const w = c?.work || {};
  const mark = Math.max(0, Number(w.tierMark) || 0);
  const delivered = Math.max(0, (Number(w.seconds) || 0) - mark);
  const months = Math.max(1, Math.floor(Number(c?.fullAccessMonths) || 1));
  const billed = Math.max(0, Number(c?.hoursBilledSec) || 0);
  const included = months * MONTH_HOURS * 3600;
  const used = Math.max(0, delivered - billed);
  return { delivered, months, billed, included, used, extra: Math.max(0, used - included) };
}

/** Past the month's hours, so the client is asked how to go on: once for each month, until they choose. */
export function needsChoice(c) {
  if (!c?.fullAccess || c.status === 'closed' || c.self || c.showcase || c.family) return false;
  const h = hoursOf(c);
  if (h.used < h.included) return false;
  return Number(c.hoursChoice?.month) !== h.months;
}

/** What the extra time costs, to the minute: nothing rounded up, nothing padded. */
export function extraCents(seconds) {
  return Math.round((Math.floor(Math.max(0, Number(seconds) || 0) / 60) * EXTRA_HOUR_CENTS) / 60);
}

/** 2h 17m, the way the hours card writes time. */
export function hm(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}h ` : ''}${m}m`;
}

/** $456.67, or $200 when it is whole. */
export function money(cents) {
  const n = Math.max(0, Math.round(Number(cents) || 0));
  return n % 100 ? `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `$${(n / 100).toLocaleString('en-US')}`;
}
