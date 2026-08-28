// Night when the office is closed (Eric, 2026-08-29: "When I'm out of office,
// the client side flips to a dark scheme. Booking page stays as you are
// designing it.")
//
// THE CLIENT APP ONLY. The case page, the chat page and the subscriber page
// call startNightShift(); booking, the landing page and everything a stranger
// reads stay in Daylight, which is why this is an opt-in module and not a line
// inside office.js that every surface would inherit.
//
// A DOOR SIGN, NOT A SETTING. The flip never writes to storage: it stamps the
// scheme on <html> for as long as the office is closed and puts the client's
// own scheme back the moment it opens. Two carve-outs, both deliberate:
//
//   Paper and High contrast are never overridden. Somebody who picked a
//   scheme for their eyes keeps it at every hour of the day.
//
//   A scheme picked from Settings DURING the closed hours wins for the rest
//   of that visit. Flipping somebody back to dark seconds after they chose
//   light would read as the control not working.
//
// No polling of its own: office.js already asks once a minute while a cue is
// on the page, and officeNow() is a free read of that answer. This module
// re-reads it on a light cadence and on tab return, so the flip lands within
// a minute of his switch either way.
import { readOffice, officeNow } from './office.js';
import { currentScheme, schemeThemeColor } from './theme.js';

const KEEP = new Set(['paper', 'contrast']);
const LOOK_MS = 20_000;

let engaged = false;    // the shift set the scheme, so the shift must unset it
let suspended = false;  // they chose a scheme while shifted; their word stands
let timer = null;

function paintMeta(id) {
  const meta = document.querySelector('meta[name="theme-color"]');
  const c = schemeThemeColor(id);
  if (meta && c) meta.setAttribute('content', c);
}

function apply() {
  const s = officeNow();
  if (!s) return;
  const chosen = currentScheme();
  const root = document.documentElement;
  if (!s.inOffice && !suspended && !KEEP.has(chosen)) {
    if (root.dataset.scheme !== 'calm') {
      root.dataset.scheme = 'calm';
      paintMeta('calm');
    }
    engaged = true;
  } else if (engaged) {
    if (chosen === 'neon') delete root.dataset.scheme;
    else root.dataset.scheme = chosen;
    paintMeta(chosen);
    engaged = false;
  }
}

/** Idempotent. Call once from a client-app page. */
export function startNightShift() {
  if (timer) return;
  // Their explicit pick beats the door sign for the rest of the visit.
  // theme.js announces every applyScheme() with this event.
  document.addEventListener('pa-scheme-set', () => {
    suspended = true;
    engaged = false;
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { readOffice().then(apply); }
  });
  timer = setInterval(apply, LOOK_MS);
  readOffice().then(apply);
}
