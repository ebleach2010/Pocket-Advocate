// Maintenance mode for the front door, so an update can be checked over
// before anybody can buy anything on top of it.
//
// TWO HALVES, and only one of them is a real gate:
//
//   1. This file greys the page and says when it will be back. It is a
//      courtesy. A stale tab, a bookmarked /book.html, or somebody with
//      scripting off never sees it.
//   2. worker/index.js refuses /api/checkout and /api/subscribe outright for
//      the same window. THAT is the gate, and it is the one that decides
//      whether money can move.
//
// The two carry the same timestamp and a test pins them together, because a
// page that says "back at 1pm" while checkout still answers is exactly the
// way somebody gets charged during a window that was supposed to be shut.
//
// WHAT IS DELIBERATELY NOT BLOCKED. Existing clients are unaffected, which
// was the whole condition: their case page, chat, uploads and sign-in are
// untouched, and this module is not loaded on any of them. Even here the
// overlay keeps one live control - Sign in - because a current client who
// happens to land on the front page must not be walled out of their own
// case by a notice aimed at new bookings.
//
// Eric, 2026-08-24: "gray out the onboarding screen... nothing can be done
// from the landing page. Current client unaffected."

// 8PM MST on 2026-08-25 (Eric, 2026-08-25: moved out from 1PM, then again
// from 6PM). MST is a fixed UTC-7 here (no DST, matching MOUNTAIN_TZ =
// 'Etc/GMT+7' everywhere else), so 20:00 MST is 03:00Z the NEXT day - which
// is why the date on this timestamp reads 08-26 while the window is still
// "same day" to a reader in Mountain time.
// MUST match MAINTENANCE_UNTIL in worker/index.js.
export const MAINTENANCE_UNTIL = '2026-08-26T03:00:00Z';

/** The words Eric asked for, verbatim (2026-08-25). "Under Maintenance" is
 *  what a broken site says; this says what is actually happening. */
export const MAINTENANCE_TEXT = 'Eric is prepping documents…';

/** Whether the window is open right now. */
export function underMaintenance(now = Date.now()) {
  const until = Date.parse(MAINTENANCE_UNTIL);
  return Number.isFinite(until) && now < until;
}

/**
 * Preview and local hosts, matching DEMO_HOST in worker/index.js. A versioned
 * preview looks like 6e90a366-pocket-advocate.<sub>.workers.dev.
 */
const PREVIEW_HOST =
  /^(?:[0-9a-f]{6,}-[\w-]+\.[\w-]+\.workers\.dev|localhost|127\.0\.0\.1|\[::1\])$/i;

/**
 * Grey the page, say why, and stop anything that starts a purchase.
 *
 * Skipped entirely while the demo is running: the suites drive booking end to
 * end on a preview host, and a scrim over them would turn a real failure into
 * a green run.
 *
 * Skipped on a preview host FULL STOP, demo or not. Eric, 2026-08-25: "the
 * suite is blocked by the maintenance block." A preview is not the front door
 * - it is the one place work gets looked at before it ships, and a notice
 * aimed at strangers was greying the review. The Worker skips the same hosts,
 * so the page and the gate still agree with each other.
 */
export function initMaintenance() {
  try {
    if (PREVIEW_HOST.test(location.hostname)) return;
    const q = new URLSearchParams(location.search).get('demo');
    if (q !== '0' && (q || sessionStorage.getItem('pa-demo'))) return;
  } catch { /* storage blocked: carry on and show it */ }
  if (!underMaintenance()) return;
  if (document.querySelector('.pa-maint')) return;

  const style = document.createElement('style');
  style.textContent = `
    html.pa-maint-on, html.pa-maint-on body { overflow: hidden; }
    /* Grey and dim everything that is not the notice. A sibling filter, not
       an ancestor one: filter on an ancestor would become the containing
       block for the fixed overlay and pin it to the wrong box. */
    html.pa-maint-on body > *:not(.pa-maint) {
      filter: grayscale(100%) brightness(.42);
      pointer-events: none !important;
      user-select: none;
    }
    .pa-maint {
      position: fixed; inset: 0; z-index: 2147483000;
      display: flex; align-items: center; justify-content: center;
      padding: 1.5rem; text-align: center;
      background: rgba(8, 10, 16, .82);
      -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px);
    }
    .pa-maint-box {
      max-width: 30rem; width: 100%;
      border: 1px solid rgba(255, 255, 255, .16); border-radius: 14px;
      background: rgba(18, 22, 32, .96);
      padding: 1.6rem 1.3rem;
      box-shadow: 0 18px 60px rgba(0, 0, 0, .55);
      color: #E8ECF4;
      font: 400 1rem/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .pa-maint-box h1 {
      margin: 0 0 .6rem; font-size: 1.32rem; line-height: 1.28; font-weight: 700;
      letter-spacing: .01em; text-wrap: balance; color: #FFFFFF;
    }
    .pa-maint-box p { margin: 0 0 .5rem; color: #AFB8C9; font-size: .95rem; }
    .pa-maint-box p.last { margin-bottom: 1.1rem; }
    .pa-maint-box a {
      display: inline-block; padding: .6rem 1.1rem; min-height: 44px;
      box-sizing: border-box; line-height: 1.9;
      border-radius: 999px; text-decoration: none; font-weight: 600;
      border: 1px solid rgba(255, 255, 255, .30); color: #E8ECF4;
    }
    .pa-maint-box a:focus-visible { outline: 2px solid #7FD8FF; outline-offset: 2px; }
    @media (prefers-reduced-motion: no-preference) {
      .pa-maint { animation: pa-maint-in .18s ease-out; }
    }
    @keyframes pa-maint-in { from { opacity: 0; } to { opacity: 1; } }`;
  document.head.appendChild(style);

  const el = document.createElement('div');
  el.className = 'pa-maint';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', MAINTENANCE_TEXT);
  el.innerHTML = `
    <div class="pa-maint-box">
      <h1>${MAINTENANCE_TEXT}</h1>
      <p><strong>Back at 8PM MST.</strong> I am sorry for the inconvenience.
        Nothing can be booked until then.</p>
      <p class="last"><strong>If you are already a client, nothing has changed.</strong>
        Your case, your files and your chat are open as normal.</p>
      <a href="/signin.html">Sign in to your case</a>
    </div>`;
  document.body.appendChild(el);
  document.documentElement.classList.add('pa-maint-on');

  // The scrim covers the page, but a link is still a link to a keyboard and
  // to a screen reader. Neuter the two that spend money, at the source.
  for (const a of document.querySelectorAll('a[href*="/book.html"], a[href*="/subscribe.html"]')) {
    a.removeAttribute('href');
    a.setAttribute('aria-disabled', 'true');
    a.setAttribute('tabindex', '-1');
  }
  // And a capture-phase catch for anything painted after this runs.
  document.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[href]');
    if (!a || !underMaintenance()) return;
    if (/\/(book|subscribe)\.html/.test(a.getAttribute('href') || '')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  el.querySelector('a')?.focus();
}

initMaintenance();
