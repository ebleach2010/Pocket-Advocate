// THE DAY OF THE SERVICE (Eric, 2026-10-17: "Next to hours should be the day
// we're on of the service. For full services, this is up to 30 days. If they
// choose to opt for another month, it gets reset. For advocacy case, it's up
// to the point of the meeting, and then it resets for the 14 days to deliver.
// Days past that flag that in a red highlight with 'report past due'. For
// chat this can be simply by month. So '1 month of chatting'. Then nothing
// until the second month").
//
// One module, read by both sides and by the Worker (worker/index.js imports
// it), so the client's page, his shelf, his case page and the alert he gets
// can never disagree about what day it is.

const DAY = 86_400_000;
// The Full-Service window's rule, copied from worker/index.js
// (fullAccessWindowEnd), as case.js and admin-case.js copy it.
const FULL_WINDOW_DAYS = 30;
const FULL_LEGACY_WINDOW_DAYS = 60;
const FULL_MONTHLY_FROM_AT = Date.parse('2026-08-26T00:00:00Z');
const FULL_WINDOW_FROM_PURCHASE_AT = Date.parse('2026-08-25T00:00:00Z');
/** An Advocacy Case's report is due this many days after the call. */
export const REPORT_DAYS = 14;

/** A time from anything the store or a page holds: a Date, a Firestore timestamp, a string or a number. */
export function msOf(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v?.toDate === 'function') return v.toDate().getTime();
  if (typeof v?.seconds === 'number') return v.seconds * 1000;
  if (typeof v?._seconds === 'number') return v._seconds * 1000;
  return new Date(v).getTime();
}

/** Time a case has spent paused: what is banked, plus the stretch still running. */
function heldMs(c, now) {
  const since = msOf(c?.hold?.pausedAt);
  return Math.max(0, Number(c?.hold?.totalMs) || 0) + (Number.isFinite(since) ? Math.max(0, now - since) : 0);
}

/** When a Full-Service case's paid window ends (worker/index.js fullAccessWindowEnd). */
export function fullEnd(c, now = Date.now()) {
  if (!c?.fullAccess) return NaN;
  const bought = msOf(c.fullAccessAt);
  const firstCall = msOf(c.appointment?.start);
  const newRule = Number.isFinite(bought) && bought >= FULL_WINDOW_FROM_PURCHASE_AT;
  const start = newRule ? bought : (Number.isFinite(firstCall) ? firstCall : bought);
  if (!Number.isFinite(start)) return NaN;
  const base = Number.isFinite(bought) && bought >= FULL_MONTHLY_FROM_AT ? FULL_WINDOW_DAYS : FULL_LEGACY_WINDOW_DAYS;
  return start + (base + (Number(c.fullAccessExtraDays) || 0)) * DAY + heldMs(c, now);
}

/** When a monthly own service's month ends (worker/services.js serviceWindowEnd); NaN while its card is held. */
export function serviceEnd(c, now = Date.now()) {
  if (c?.serviceMonthly !== true || c.charge?.state === 'held') return NaN;
  const start = msOf(c.charge?.decidedAt || c.charge?.capturedAt || c.serviceAt || c.createdAt);
  if (!Number.isFinite(start)) return NaN;
  return start + (30 + (Number(c.serviceExtraDays) || 0)) * DAY + heldMs(c, now);
}

/**
 * The day of a 30-day month that runs out at `end`. Months run back to back,
 * so with one bought ahead the count is where the current month stands; a
 * month that starts again after one closed starts again at day 1.
 */
export function monthDay(end, now = Date.now()) {
  if (!Number.isFinite(end)) return null;
  const left = Math.max(1, Math.ceil((end - now) / DAY));
  return 31 - (((left - 1) % 30) + 1);
}

/**
 * The chip beside the hours, or null where there is no clock to read:
 *   Full-Service or a monthly service   Day 12 of 30
 *   an Advocacy Case before the call    Day 3 of 7   (the days from booking to the call)
 *   after the call                      Day 5 of 14  (to the report)
 *   past the report's due day           Report past due, 2 days   (late: true)
 * A delivered or closed case, his own, the showcase and a one-time service have none.
 */
export function caseDay(c, now = Date.now()) {
  if (!c || c.status === 'closed' || c.self || (c.showcase && !c.sample)) return null;
  if (c.fullAccess) {
    const d = monthDay(fullEnd(c, now), now);
    return d ? { text: `Day ${d} of 30`, late: false } : null;
  }
  if (c.serviceMonthly) {
    const d = monthDay(serviceEnd(c, now), now);
    return d ? { text: `Day ${d} of 30`, late: false } : null;
  }
  if (c.service) return null;
  if (c.status === 'delivered' || c.reportDeliveredAt) return null;
  const due = msOf(c.reportDueAt);
  if (Number.isFinite(due)) {
    if (now > due) {
      const over = Math.max(1, Math.ceil((now - due) / DAY));
      return { text: `Report past due, ${over} day${over === 1 ? '' : 's'}`, late: true, over };
    }
    const d = Math.min(REPORT_DAYS, Math.max(1, Math.floor((now - (due - REPORT_DAYS * DAY)) / DAY) + 1));
    return { text: `Day ${d} of ${REPORT_DAYS}`, late: false };
  }
  const open = msOf(c.createdAt);
  if (!Number.isFinite(open)) return null;
  const d = Math.max(1, Math.floor((now - open) / DAY) + 1);
  const call = msOf(c.appointment?.start);
  if (Number.isFinite(call) && call > open) {
    const span = Math.max(1, Math.ceil((call - open) / DAY));
    return { text: `Day ${Math.min(d, span)} of ${span}`, late: false };
  }
  return { text: `Day ${d}`, late: false };
}

/** A chat line, by the month: "1 month of chatting", and nothing new until the second month starts. */
export function chatMonths(sub, now = Date.now()) {
  const start = msOf(sub?.startedAt || sub?.createdAt);
  if (!Number.isFinite(start)) return null;
  const n = Math.max(1, Math.floor((now - start) / (30 * DAY)) + 1);
  return `${n} month${n === 1 ? '' : 's'} of chatting`;
}
