// The scheduling trust boundary. The browser shows these rules; the Worker
// enforces them. Times are anchored to MST — fixed UTC-7 year-round, no
// daylight-saving shift (Eric's call, 2026-07-11). Clients see their local
// equivalent, but bookable windows never move with the client's timezone.
// Note: the IANA 'Etc/GMT+7' zone IS UTC-7 (the sign is inverted by design).
//
// TWO ZONES LIVE HERE AND THEY ARE NOT THE SAME ZONE. MOUNTAIN_TZ anchors what
// a client can book. OFFICE_TZ answers what time it is where Eric is standing,
// which is the only thing the in-office light cares about. See OFFICE_TZ.

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
/**
 * THE OFFICE-HOURS ZONE, AND IT IS DELIBERATELY NOT THE BOOKING ANCHOR ABOVE.
 *
 * Eric, 2026-08-27, his words: "I live in Boise, ID, MST. Booking can be done
 * anytime. The only thing it does is says I'm out of office if it's 7am MST.
 * Or 11pm MST. This is not a complicated concept. If there's something getting
 * in the way of that, override it."
 *
 * This is that override, and it touches the in-office light only. One constant
 * was being asked two different questions:
 *
 *   The booking calendar asks which INSTANTS a client may buy. Those are
 *   anchored to MOUNTAIN_TZ, a fixed UTC-7 that never shifts, because a slot
 *   has to mean the same moment whenever it was opened. Not changed here. He
 *   said booking can be done anytime, and moving live slots is its own job.
 *
 *   The office light asks what time it is where ERIC IS STANDING. That is his
 *   clock, not an offset. Boise keeps daylight saving; a fixed UTC-7 reads an
 *   hour behind his kitchen wall from mid-March to early November, so for eight
 *   months of the year the light came on at 9am and went out at 8pm. Naming the
 *   place instead of the offset makes his 8am his 8am all year.
 *
 * The cost, said out loud rather than buried: for those eight months the light
 * and the calendar no longer describe the same wall-clock window. He was asked
 * and that is the trade he chose.
 */
export const OFFICE_TZ = 'America/Boise';
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
 * The ZONE is OFFICE_TZ, not MOUNTAIN_TZ, and the comment on OFFICE_TZ says why
 * in full: this window follows his real wall clock, on his explicit word, while
 * the booking calendar stays on the fixed offset it was anchored to.
 */
export function scheduledOpen(now = new Date()) {
  const when = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(when.getTime())) return false;
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: OFFICE_TZ, weekday: 'short',
  }).format(when);
  // Friday joined the weekend on Eric's word (2026-08-29: "we're now doing
  // Fri-Sun out of office unless I manually turn it back on"). The manual
  // override still beats this both ways, so a Friday he chooses to work is
  // one tap on the shelf, exactly as before.
  if (weekday === 'Fri' || weekday === 'Sat' || weekday === 'Sun') return false;
  const { hour, minute } = officeParts(when);
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

function wallParts(date, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { hour: get('hour') % 24, minute: get('minute') };
}

/** The booking anchor's wall clock: fixed UTC-7, no daylight saving. */
function mountainParts(date) { return wallParts(date, MOUNTAIN_TZ); }

/** Eric's own wall clock, daylight saving included. Office light only. */
function officeParts(date) { return wallParts(date, OFFICE_TZ); }
