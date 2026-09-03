// By the numbers (Eric, 2026-09-02). Paints every [data-stat] on the page
// from GET /api/stats, which the server computes once a day across every
// case. Nothing is computed here and no case document is read by this file:
// the figures arrive rounded, as totals and medians, and that is all a page
// ever sees.
//
// The shipped text is the "not measured yet" state. A fetch that fails, or
// a server that has not measured anything yet, leaves it in place; the
// landing page's strip stays hidden until there are real figures behind it.

const money = (n) => Number(n).toLocaleString('en-US');

function replyText(min) {
  if (min === null || min === undefined) return null;
  if (min < 1) return 'under a minute';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function agoText(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const h = Math.floor((Date.now() - t) / 3600_000);
  if (h < 1) return 'within the hour';
  if (h < 24) return h === 1 ? 'an hour ago' : `${h} hours ago`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

/**
 * The demo answers /api/stats from its own shim, which mounts with the data
 * layer. This file needs no data layer of its own, so on a demo host it waits
 * for that mount before asking; on the live site nothing extra loads.
 */
async function demoReady() {
  try {
    if (/(^|\.)thepocketadvocates\.com$/i.test(location.hostname)) return;
    const q = new URLSearchParams(location.search).get('demo');
    if ((q && q !== '0') || sessionStorage.getItem('pa-demo')) await import('./firebase.js');
  } catch { /* not the demo, or storage blocked: ask the real route */ }
}

let inflight = null;
export function stats() {
  if (!inflight) {
    inflight = demoReady()
      .then(() => fetch('/api/stats'))
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
  }
  return inflight;
}

const set = (root, key, text) => {
  for (const el of root.querySelectorAll(`[data-stat="${key}"]`))
    if (text !== null && text !== undefined && el.textContent !== text) el.textContent = text;
};

export async function paintStats(root = document) {
  if (!root.querySelector('[data-stat]')) return;
  const s = await stats();
  if (!s) return;
  const measured = s.replies > 0;
  if (measured) {
    set(root, 'replyMedian', replyText(s.replyMedianMin));
    set(root, 'withinHour', `${s.withinHourPct}%`);
  }
  if (!s.floor) {
    set(root, 'reports', s.reportsTotal ? `${s.reportsOnTime} of ${s.reportsTotal}` : 'none due yet');
    set(root, 'hours', `${money(s.hoursLogged)} hrs`);
    set(root, 'messages', money(s.messages));
    set(root, 'cases', money(s.cases));
    if (s.since) set(root, 'casesLine', `cases taken since ${s.since}`);
    const m = s.milestones || {};
    set(root, 'milestones', money(m.total || 0));
    const parts = [];
    if (m.appointment) parts.push(`${m.appointment} appointment${m.appointment === 1 ? '' : 's'} scheduled`);
    if (m.referral) parts.push(`${m.referral} referral${m.referral === 1 ? '' : 's'} out`);
    if (m.authorization) parts.push(`${m.authorization} authorization${m.authorization === 1 ? '' : 's'} approved`);
    if (m.other) parts.push(`${m.other} other`);
    set(root, 'milestonesLine', parts.length ? `milestones reached: ${parts.join(', ')}` : 'milestones reached');
    set(root, 'logged', money((s.logged || {}).total || 0));
  }
  // The floor: below three cases the ledger is withheld by the server, and
  // the page says how many cases the reply figures rest on.
  for (const el of root.querySelectorAll('[data-ledger]')) el.hidden = !!s.floor;
  for (const el of root.querySelectorAll('[data-stat-floor]')) {
    el.hidden = !s.floor;
    if (s.floor) el.textContent = `Measured across ${s.cases} case${s.cases === 1 ? '' : 's'} so far. The rest of the ledger appears at three.`;
  }
  if (s.computedAt) {
    set(root, 'stamp', `Measured across every case${s.since ? ` since ${s.since}` : ''}. Updated daily; last updated ${agoText(s.computedAt)}.`);
  }
  // The landing strip shows only when there is something real behind it.
  for (const el of root.querySelectorAll('[data-numbers-strip]')) el.hidden = !(measured && !s.floor);
}

paintStats().catch(() => {});
