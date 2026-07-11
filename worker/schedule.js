// The scheduling trust boundary. The browser shows these rules; the Worker
// enforces them. Times are anchored to MST — fixed UTC-7 year-round, no
// daylight-saving shift (Eric's call, 2026-07-11). Clients see their local
// equivalent, but bookable windows never move with the client's timezone.
// Note: the IANA 'Etc/GMT+7' zone IS UTC-7 (the sign is inverted by design).

export const LEAD_TIME_HOURS = 72;
export const OPEN_HOUR = 8; // 8am MST
export const CLOSE_HOUR = 18; // 6pm MST
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
    return `Appointments run 8:00am–6:00pm MST.`;
  return null;
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
