// PACING (Eric, 2026-10-17). Asked how to keep a contractor from doing a week,
// meeting the hours and stopping, or drifting along with no progress, he chose
// flags: a Full-Service case is flagged to him and to its advocate after a week
// with no logged work or no word to the client, or when most of the month's
// hours go in its first week.
//
// A flag is a nudge on the shelf and on the case, nothing more. It changes no
// pay, and no client sees it: this file is gated like every admin- module.

const DAY = 86_400_000;
export const QUIET_DAYS = 7;
// Most of the month's hours: this share of them, inside its first week.
export const FRONT_SHARE = 0.6;
const MONTH_HOURS = 20;

const ms = (v) => {
  if (!v) return 0;
  const t = (v?.toDate ? v.toDate() : new Date(v)).getTime();
  return Number.isFinite(t) ? t : 0;
};

/** The flags on one case, each with words for a chip, newest rule last. */
export function pacingFlags(c, now = Date.now()) {
  if (!c?.fullAccess || c.status === 'closed' || c.self || c.showcase || c.sample || c.hold?.pausedAt) return [];
  const began = ms(c.fullAccessAt);
  if (!began || began > now) return [];
  const months = (Array.isArray(c.extraPayments) ? c.extraPayments : [])
    .filter((p) => p?.kind === 'extend' && !p.duplicate).map((p) => ms(p.at)).filter(Boolean);
  const monthStart = Math.max(began, ...months);
  const w = c.work || {};
  const flags = [];
  const days = (t) => Math.floor((now - t) / DAY);
  // A week with nothing logged: no clock time, no work log entry, no clock running.
  const lastWork = w.startedAt ? now : Math.max(began, ms(w.updatedAt), ms(w.loggedAt));
  if (now - began >= QUIET_DAYS * DAY && now - lastWork >= QUIET_DAYS * DAY)
    flags.push({ id: 'quiet', label: `No work logged in ${days(lastWork)} days` });
  // A week with no word to the client from their side.
  const lm = c.lastMessage;
  const lastWord = Math.max(began, ms(c.staffMsgAt), lm?.role === 'admin' ? ms(lm.ts) : 0);
  if (now - began >= QUIET_DAYS * DAY && now - lastWord >= QUIET_DAYS * DAY)
    flags.push({ id: 'unheard', label: `No update to the client in ${days(lastWord)} days` });
  // Most of the month's hours inside its first week. A later month counts from
  // where its hours began, which the Worker stamps when it is paid for; one
  // paid before that stamp existed is left alone rather than guessed at.
  const from = months.length
    ? (Number.isFinite(Number(w.monthStartSeconds)) && w.monthStartSeconds !== null ? Number(w.monthStartSeconds) : null)
    : Math.max(0, Number(w.tierMark) || 0);
  const used = from === null ? 0 : Math.max(0, (Number(w.seconds) || 0) - from);
  if (now - monthStart < QUIET_DAYS * DAY && used >= FRONT_SHARE * MONTH_HOURS * 3600)
    flags.push({ id: 'front', label: `${Math.floor(used / 3600)} of the month's ${MONTH_HOURS} hours in its first week` });
  return flags;
}
