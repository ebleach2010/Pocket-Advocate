// Which pages of a case Eric has actually looked at, and what has changed
// since he did.
//
// A folder on the shelf carries an emoji for every page holding something he
// has not seen yet, stacked side by side: a new client message and a fresh
// advisor read together read as 💬👨‍🔬. The same badge shows on the tab inside
// the folder, so he knows which page to shuffle to.
//
// Seen-state is per case, per page, and local to the device on purpose. It is
// a reading position, not a fact about the case: it belongs to the phone in
// his hand, and syncing it would mean a write on every page turn.

const KEY = 'pa-seen';

// Order matters: this is the order the badges stack in, and it runs from the
// thing that most often needs an answer to the thing that least often does.
export const PAGE_BADGES = [
  { page: 'chat', emoji: '💬', label: 'new message' },
  { page: 'advisor', emoji: '👨‍🔬', label: 'new read' },
  { page: 'dx', emoji: '🧬', label: 'differential moved' },
  { page: 'drafts', emoji: '✍️', label: 'draft waiting' },
  // The longest turn in the app, and until now the only one that landed
  // in silence: no dot on the tab, the group or the shelf. The panel told
  // him he could leave the page, then never said it was done.
  { page: 'calldoc', emoji: '📄', label: 'call document ready' },
  { page: 'files', emoji: '📎', label: 'new file' },
  { page: 'overview', emoji: '⚠️', label: 'needs you' },
];

/** Every page's activity stamp, keyed the way the shelf's payload delivers it. */
const STAMP_KEY = { chat: 'chat', advisor: 'advisor', dx: 'diff', drafts: 'draft',
  files: 'files', calldoc: 'calldoc' };

function all() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; }
  catch { return {}; }     // corrupt or blocked storage means everything is new
}

function write(map) {
  try { localStorage.setItem(KEY, JSON.stringify(map)); } catch { /* blocked */ }
}

/** When Eric last looked at one page of one case, as a millisecond stamp. */
export function seenAt(caseId, page) {
  return Number(all()[`${caseId}:${page}`]) || 0;
}

/**
 * He is looking at it now. Called the moment a page comes forward, which is
 * why the badge clears on landing rather than on some later save.
 */
export function markSeen(caseId, page) {
  if (!caseId || !page) return;
  const map = all();
  map[`${caseId}:${page}`] = Date.now();
  // Keep this from growing without limit across years of cases: 400 entries is
  // dozens of cases at seven pages each, and the oldest reading positions are
  // the ones it costs nothing to forget.
  const keys = Object.keys(map);
  if (keys.length > 400) {
    keys.sort((a, b) => (map[a] || 0) - (map[b] || 0))
      .slice(0, keys.length - 400)
      .forEach((k) => delete map[k]);
  }
  write(map);
}

/** Has this one page changed since he last had it open? */
export function isUnseen(caseId, page, stamp) {
  const at = stamp ? new Date(stamp).getTime() : 0;
  if (!at || Number.isNaN(at)) return false;
  return at > seenAt(caseId, page);
}

/**
 * The badge run for one folder: the emoji for every page with something
 * unseen, in PAGE_BADGES order, or '' when there is nothing.
 *
 * `at` is the activity payload from the covers route. `force` marks pages that
 * are unseen for a reason other than a timestamp - the overview flag is a
 * state, not an event: a case that needs rescheduling wants his attention
 * whether or not anything moved today.
 */
export function unseenBadges(caseId, at = {}, force = {}) {
  return PAGE_BADGES
    .filter(({ page }) => (force[page]
      ? seenAt(caseId, page) < Date.now() - 12 * 3600_000   // re-raises daily
      : isUnseen(caseId, page, (at || {})[STAMP_KEY[page]])))
    .map(({ emoji }) => emoji)
    .join('');
}
