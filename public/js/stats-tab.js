// THE PULL-UP TAB (Eric, 2026-10-15: "put my stats at the bottom of the
// landing page in brief; it will be a tab with an arrow that glows like the
// waitlist button and softly eases up and down in an ease in, ease out fashion
// every 1.5 seconds. When they grab it and swipe up it shows all of my
// stats.")
//
// The tab carries the brief: the reply figures, which are measured from the
// first message. Grabbed and pulled up, the sheet follows the finger and
// settles open past a short pull or a flick; a tap opens it too, because a
// swipe is not something every hand or every screen reader can do. The sheet
// closes on a pull back down, the backdrop, Close or Escape. stats.js paints
// every figure in it, the same answer the stats page reads.
import { stats, replyText } from './stats.js';

/** The one-line brief, or '' when nothing has been measured yet. */
export function briefText(s) {
  if (!s || !(s.replies > 0)) return '';
  const reply = replyText(s.replyMedianMin);
  const parts = [];
  if (reply) parts.push(`${reply} median reply`);
  if (Number.isFinite(Number(s.withinHourPct))) parts.push(`${s.withinHourPct}% within an hour`);
  return parts.join(' \u00b7 ');
}

/** Open or not, from how far up and how fast the finger went. */
export function settles(pulledPx, pxPerMs) {
  return pulledPx > 60 || (pulledPx > 12 && pxPerMs > 0.5);
}

function mount() {
  const tab = document.querySelector('[data-stats-tab]');
  const sheet = document.querySelector('[data-stats-sheet]');
  const card = sheet?.querySelector('[data-stats-card]');
  if (!tab || !sheet || !card) return;

  const place = (px) => { card.style.transform = px === null ? '' : `translateY(${Math.max(0, px)}px)`; };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  function open() {
    sheet.hidden = false;
    sheet.classList.remove('dragging');
    place(null);
    requestAnimationFrame(() => sheet.classList.add('open'));
    tab.setAttribute('aria-expanded', 'true');
    document.addEventListener('keydown', onKey);
    sheet.querySelector('[data-stats-close]')?.focus({ preventScroll: true });
  }
  function close() {
    sheet.classList.remove('open', 'dragging');
    place(null);
    tab.setAttribute('aria-expanded', 'false');
    document.removeEventListener('keydown', onKey);
    const done = () => { if (!sheet.classList.contains('open')) sheet.hidden = true; };
    card.addEventListener('transitionend', done, { once: true });
    setTimeout(done, 450);
    tab.focus({ preventScroll: true });
  }

  // Grab the tab and pull. The sheet rises under the finger.
  let drag = null;
  tab.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, t: e.timeStamp, last: e.clientY, lastT: e.timeStamp, moved: false, h: 0 };
    tab.setPointerCapture?.(e.pointerId);
  });
  tab.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const up = drag.y - e.clientY;
    if (!drag.moved && up < 8) return;
    if (!drag.moved) {
      drag.moved = true;
      sheet.hidden = false;
      sheet.classList.add('dragging', 'open');
      drag.h = card.getBoundingClientRect().height;
    }
    drag.vel = (drag.last - e.clientY) / Math.max(1, e.timeStamp - drag.lastT);
    drag.last = e.clientY; drag.lastT = e.timeStamp;
    place(drag.h - up);
  });
  const release = (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) return;           // a tap: the click below opens it
    sheet.classList.remove('dragging');
    if (settles(d.y - e.clientY, d.vel || 0)) open(); else close();
    tab.dataset.dragged = String(Date.now());  // the click a drag may end in does nothing
  };
  tab.addEventListener('pointerup', release);
  tab.addEventListener('pointercancel', release);
  tab.addEventListener('click', () => {
    const dragged = Number(tab.dataset.dragged) || 0;
    delete tab.dataset.dragged;
    if (Date.now() - dragged < 500) return;
    open();
  });

  // Pull it back down by its top edge, or tap outside it.
  const grab = sheet.querySelector('[data-stats-grab]');
  let down = null;
  grab?.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-stats-close]')) return;
    down = { y: e.clientY };
    grab.setPointerCapture?.(e.pointerId);
    sheet.classList.add('dragging');
  });
  grab?.addEventListener('pointermove', (e) => { if (down) place(e.clientY - down.y); });
  const letGo = (e) => {
    if (!down) return;
    const pulled = e.clientY - down.y; down = null;
    sheet.classList.remove('dragging');
    if (pulled > 80) close(); else place(null);
  };
  grab?.addEventListener('pointerup', letGo);
  grab?.addEventListener('pointercancel', letGo);
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });
  sheet.querySelector('[data-stats-close]')?.addEventListener('click', close);

  // The brief, and the tab only once there is something real to show.
  stats().then((s) => {
    const brief = briefText(s);
    if (!brief) return;
    tab.querySelector('[data-stats-brief]').textContent = brief;
    tab.hidden = false;
  }).catch(() => {});
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
}
