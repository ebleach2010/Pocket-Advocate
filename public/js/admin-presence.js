// The presence beacon: which chart Eric has open, and whether the app is
// open at all.
//
// One self-installing module, dropped into every advocate page by a script
// tag rather than imported, so a page added later gets it by copying one
// line and cannot half-wire it.
//
// It answers two questions the work clock needs and no unload handler can be
// trusted to answer:
//
//   1. "Has he left this chart?" Arriving on any other advocate page proves
//      it. `pagehide` cannot tell a tab close from a swipe back to the
//      shelf, and iOS drops it outright often enough that a clock which
//      relied on it would silently keep running. So the arrival is the
//      signal, not the departure.
//   2. "Is the app open?" The beacon stops when the page is hidden, which is
//      exactly the state Eric asked to be prompted about: "If I exit the app,
//      whatever state it was in remains with a prompt after 5, 10, and 30
//      min."
//
// The name matters: `admin-` puts this behind the asset gate in
// worker/index.js, so a client asking for it gets a 404 like every other
// advocate module. A file called presence.js would be served to everyone.
import { currentUser, isAdmin } from './auth.js';

// Once a minute. The shortest thing measured against this beacon is five
// minutes, so a minute is fine and a dropped request costs nothing.
const BEAT_MS = 60_000;

/** The chart on screen, if this page is one. Empty means anywhere else. */
function openCaseId() {
  if (!/\/admin-case(\.html)?$/.test(location.pathname)) return '';
  const id = new URLSearchParams(location.search).get('id') || '';
  return /^[\w-]{1,64}$/.test(id) ? id : '';
}

let timer = null;
let user = null;

async function beat() {
  if (!user || document.visibilityState !== 'visible') return;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/work/here', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ caseId: openCaseId() }),
    });
    const out = await res.json().catch(() => ({}));
    // A beacon can STOP a clock, and the page that sent it has already drawn
    // that card from a case it read a moment earlier. Say so out loud rather
    // than leaving a green dot on a clock the server has already banked -
    // which is worse than no dot, because it reads as time still counting.
    if (Array.isArray(out.stopped) && out.stopped.length) {
      window.dispatchEvent(new CustomEvent('pa-clock-stopped', { detail: { stopped: out.stopped } }));
    }
    // Today's per-case hours, which only this beacon carries (Eric,
    // 2026-08-29: "a daily hours/min logged for the day... Only seen on my
    // side"). The shelf and the chart both listen; neither has to ask. The
    // stash on window is for paints that happen BETWEEN beats - a shelf
    // repaint reads it so the figure survives its own card being rebuilt.
    if (out.day && typeof out.day === 'object') {
      const byCase = out.day.byCase && typeof out.day.byCase === 'object' ? out.day.byCase : {};
      window.__paDayLog = byCase;
      window.dispatchEvent(new CustomEvent('pa-day-log', { detail: { byCase } }));
    }
  } catch {
    // Offline, or the tab is being torn down. The next beat catches up, and
    // a missed beat only ever makes him look MORE away, which is the safe
    // direction: the worst case is being asked whether he is still working.
  }
}

// Read-only auth on purpose. requireAdmin() re-runs the weekly re-login check
// and re-posts the admin session; every advocate page has already called it
// by the time this loads, and calling it twice would do that work twice.
(async () => {
  const u = await currentUser();
  if (!u || !(await isAdmin(u))) return;
  user = u;
  beat();
  timer = setInterval(beat, BEAT_MS);
  // Coming back to a backgrounded tab is a return to the app, and the ladder
  // should be re-armed at once rather than up to a minute later.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') beat();
  });
  window.addEventListener('pagehide', () => clearInterval(timer));
})();
