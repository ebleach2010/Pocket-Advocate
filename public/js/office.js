// In office, or out of office. The one client-facing answer, and the cue that
// paints it.
//
// Eric, 2026-08-27: scheduled hours Monday to Friday, 8:00 to 19:00 Mountain,
// with a switch he can flip either way from his phone that always beats the
// schedule, and a "pretty noticeable visual cue" for clients of which it is.
//
// NOTHING IS DECIDED HERE. The schedule lives in worker/schedule.js beside the
// constants it reads (OPEN_HOUR, CLOSE_HOUR, MOUNTAIN_TZ), and the override
// lives in settings/officeHours. This file asks GET /api/availability and
// paints the answer. Writing the hours down a second time in a browser module
// is exactly how the light and the booking calendar would come to disagree.
//
// No imports on purpose. The "?" panel in help.js opens on the landing page,
// which does not load Firebase at all, and a single import here would drag the
// whole data layer onto it.

// One minute while the tab is in front of somebody, and an immediate re-read
// whenever it comes back to the front. A flip of his switch therefore shows up
// within a minute on a chat somebody is sitting on, and instantly on any page
// they open. There is no live socket for this and deliberately so: it is a
// door sign, not a heartbeat.
const POLL_MS = 60_000;

let state = null;          // the last answer, or null before one arrives
let inflight = null;
let timer = null;
const painters = new Set();

/** The last answer, or null if none has arrived yet. Never throws. */
export function officeNow() { return state; }

/**
 * Ask the Worker. Concurrent callers share one request; a failure leaves the
 * previous answer standing rather than replacing it with a guess.
 */
export async function readOffice() {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      // no-store, deliberately. The route answers 200 with no cache-control,
      // which lets a browser heuristically reuse its own copy - and a cached
      // "in office" is exactly the thing that must never outlive his tap on
      // the switch. Polling a cache is worse than not polling.
      const res = await fetch('/api/availability', {
        headers: { accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(String(res.status));
      const out = await res.json();
      if (typeof out?.inOffice !== 'boolean') throw new Error('shape');
      state = {
        inOffice: out.inOffice,
        by: out.by === 'manual' ? 'manual' : 'schedule',
        // Only ever a string he typed. The server sends null when he has not,
        // and this refuses to invent one: no response time is promised unless
        // one has been set by hand.
        responseTime: typeof out.responseTime === 'string' && out.responseTime.trim()
          ? out.responseTime.trim() : null,
      };
    } catch {
      // Offline, or the route is not there. Keep whatever we last knew.
    }
    inflight = null;
    paintAll();
    return state;
  })();
  return inflight;
}

/** The two words on the pill, and nothing about how fast anybody replies. */
export function officeLabel(s = state) {
  if (!s) return 'Office hours';
  return s.inOffice ? 'In office' : 'Out of office';
}

/**
 * Paint the cue inside `root`.
 *
 * Looks for `[data-office]`, and falls back to the `.p-dot` / `.p-label` pair
 * that carried the old presence light, so a surface that has not been given
 * the pill markup still says something true rather than nothing.
 */
export function watchOffice(root) {
  if (!root) return;
  painters.add(root);
  paint(root);
  readOffice();
  start();
}

function paint(root) {
  const cue = root.matches?.('[data-office]') ? root : root.querySelector?.('[data-office]');
  const dot = root.querySelector?.('.p-dot');
  const label = root.querySelector?.('.p-label');
  const known = !!state;
  if (cue) {
    cue.classList.toggle('in', known && state.inOffice);
    cue.classList.toggle('out', known && !state.inOffice);
    cue.setAttribute('title', known
      ? (state.inOffice ? 'In office' : 'Out of office')
      : 'Checking whether I am in office');
  }
  // `.on` is the class the presence light already used, so the existing rule
  // in site.css keeps working and no surface loses its dot in the change.
  if (dot) dot.classList.toggle('on', known && state.inOffice);
  if (label) label.textContent = officeLabel();
}

function paintAll() {
  for (const root of painters) {
    // A repainted page can throw its cue away without telling us. Drop the
    // root rather than holding a detached node and painting into nothing
    // forever.
    if (!root.isConnected) { painters.delete(root); continue; }
    paint(root);
  }
  if (!painters.size) stop();
}

function start() {
  if (timer) return;
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') readOffice();
  }, POLL_MS);
  document.addEventListener('visibilitychange', onShow);
}

function stop() {
  clearInterval(timer);
  timer = null;
  document.removeEventListener('visibilitychange', onShow);
}

function onShow() {
  if (document.visibilityState === 'visible') readOffice();
}

/**
 * The markup for the cue plus its "?".
 *
 * One function so the three client chat surfaces cannot drift: the case page,
 * the subscriber page and the Chat tab all get the same pill, the same words
 * and the same button.
 */
export function officeCueHtml() {
  return `<span class="office-cue" data-office role="status">`
    + `<span class="p-dot" aria-hidden="true"></span>`
    + `<span class="p-label">Office hours</span></span>`
    + `<button class="help-dot" data-help="hours" type="button"`
    + ` aria-label="When will Eric respond?" title="When will Eric respond?">?</button>`;
}
