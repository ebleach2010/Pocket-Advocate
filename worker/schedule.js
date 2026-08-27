// The scheduling trust boundary. The browser shows these rules; the Worker
// enforces them. Times are anchored to MST — fixed UTC-7 year-round, no
// daylight-saving shift (Eric's call, 2026-07-11). Clients see their local
// equivalent, but bookable windows never move with the client's timezone.
// Note: the IANA 'Etc/GMT+7' zone IS UTC-7 (the sign is inverted by design).

export const LEAD_TIME_HOURS = 72;
// Quiet booking horizon (Eric, 2026-07-13): cases can't be scheduled more
// than 1.5 weeks out. Case chat opens the moment payment lands, so a far-out
// appointment would buy months of chat runway for one $275 case. Not
// advertised in the UI — far slots simply don't show, and the server rejects.
export const MAX_LEAD_TIME_HOURS = 252; // 1.5 weeks
export const OPEN_HOUR = 8; // 8am MST
// 7pm close (Eric, 2026-08-22: "Open my schedule every Tuesday from
// 10am-7pm") - the ceiling for any slot's END; which hours actually open on
// a given day is whatever slots exist.
export const CLOSE_HOUR = 19; // 7pm MST
export const MOUNTAIN_TZ = 'Etc/GMT+7';
// Spec asks for a ~15-minute hold; Stripe Checkout sessions cannot expire in
// less than 30 minutes, so the hold matches the session's real lifetime.
export const HOLD_MINUTES = 30;

/** Returns null if the slot timing is bookable, else a human-readable reason. */
export function slotTimingProblem(startIso, durationMin, now = new Date()) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return 'Invalid slot time.';
  const leadMs = start.getTime() - now.getTime();
  if (leadMs < LEAD_TIME_HOURS * 3600_000)
    return `Appointments must be booked at least ${LEAD_TIME_HOURS} hours in advance.`;
  if (leadMs > MAX_LEAD_TIME_HOURS * 3600_000)
    return 'That time is not open for booking yet — please pick a sooner slot.';
  return windowProblem(startIso, durationMin);
}

/** The 8am–6pm MST window check alone — used when the admin opens slots. */
export function windowProblem(startIso, durationMin) {
  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return 'Invalid slot time.';
  const startParts = mountainParts(start);
  const end = new Date(start.getTime() + durationMin * 60_000);
  const endParts = mountainParts(end);
  const startMinutes = startParts.hour * 60 + startParts.minute;
  const endMinutes = endParts.hour * 60 + endParts.minute;
  if (startMinutes < OPEN_HOUR * 60 || endMinutes > CLOSE_HOUR * 60 || endMinutes <= startMinutes)
    return `Appointments run 8:00am–7:00pm MST.`;
  return null;
}

/**
 * OFFICE HOURS. Eric, 2026-08-27: "Mon to Fri, 8:00 to 19:00 Mountain."
 *
 * Those are OPEN_HOUR and CLOSE_HOUR exactly, so this reuses them rather than
 * writing 8 and 19 down in a second place where the two could drift apart. The
 * bookable window and the in-office light are the same day by construction.
 *
 * The weekday rule is new here - the booking window never had one, because a
 * Saturday simply has no slots opened on it. The idiom is copied from
 * public/js/admin-availability.js, which is the only Mon-Fri test in the repo.
 *
 * MOUNTAIN_TZ is fixed UTC-7 with no daylight saving (see the header). From
 * mid-March to early November that means this window is 9am to 8pm on Eric's
 * real wall clock. That is a consequence of the 2026-07-11 decision to anchor
 * everything to one offset, and it is a decision, not a bug: the light and the
 * booking calendar agree with each other, which matters more than either
 * agreeing with a phone. The manual override below covers the hour at each end
 * until he says otherwise.
 */
export function scheduledOpen(now = new Date()) {
  const when = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(when.getTime())) return false;
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short',
  }).format(when);
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const { hour, minute } = mountainParts(when);
  const minutes = hour * 60 + minute;
  // Open at the top of OPEN_HOUR, shut at the top of CLOSE_HOUR: 8:00 is in,
  // 19:00 is out. The last bookable slot ENDS at 19:00, so the office being
  // shut at 19:00 exactly is the same boundary the calendar already uses.
  return minutes >= OPEN_HOUR * 60 && minutes < CLOSE_HOUR * 60;
}

/**
 * In or out, and why.
 *
 * ERIC'S RULE, BOTH DIRECTIONS (2026-08-27): "manual override always beats the
 * schedule." Out during normal hours shows out - he is with his daughter.
 * In outside normal hours shows in - he is pulling overtime. There is no
 * expiry on an override, deliberately: one that lapsed on its own would be the
 * schedule beating him, which is the thing he ruled out. The advocate control
 * says so out loud whenever a standing override disagrees with the schedule,
 * so putting it back is one tap and never a surprise.
 *
 * `manual` is 'in', 'out', or anything else for "follow the schedule".
 */
export function officeStatus(manual, now = new Date()) {
  const scheduled = scheduledOpen(now);
  const override = manual === 'in' || manual === 'out' ? manual : null;
  const inOffice = override ? override === 'in' : scheduled;
  return {
    inOffice,
    scheduled,
    manual: override,
    // True only when the override is actually changing the answer. A standing
    // "in" during office hours is agreement, not an override worth shouting
    // about, and the advocate control paints from this.
    overriding: !!override && inOffice !== scheduled,
  };
}

function mountainParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { hour: get('hour') % 24, minute: get('minute') };
}
