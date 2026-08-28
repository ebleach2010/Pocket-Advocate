// In office, or out of office. The one client-facing answer, and the cue that
// paints it.
//
// Eric, 2026-08-27: scheduled hours Monday to Friday, 8:00 to 19:00 Mountain,
// with a switch he can flip either way from his phone that always beats the
// schedule, and a "pretty noticeable visual cue" for clients of which it is.
//
// NOTHING IS DECIDED HERE. The schedule lives in worker/schedule.js beside the
// constants it reads (OPEN_HOUR, CLOSE_HOUR, OFFICE_TZ), and the switch he
// flips is stored where only the Worker can reach it. This file asks
// GET /api/availability and paints the answer. Writing the hours down a second
// time in a browser module is exactly how the two would come to disagree.
//
// The one number this file does hold is OFFICE_ZONE, because turning "8:00 AM
// Mountain" into the reader's own clock cannot be done without naming the
// place. It is checked against the shipped constant by the suite rather than
// left to memory.
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

// Eric's own clock, daylight saving included. The same string as OFFICE_TZ in
// worker/schedule.js, and the suite fails if the two ever stop matching.
const OFFICE_ZONE = 'America/Boise';

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
        // The answer is in or out, and the line he has written. Nothing else is
        // sent and nothing else is stored: this route is anonymous and polled
        // once a minute, and two keys is the whole of it by design.
        //
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

/**
 * The words on the pill, and nothing about how fast anybody replies.
 *
 * THREE STATES, NOT TWO. "Checking" is what the pill says before the first
 * answer lands and for as long as the route cannot be reached. It used to say
 * "Office hours", which wore the same grey border and the same grey dot as
 * "Out of office" - so a client whose network had dropped, or who had loaded
 * the page while the route was down, was being told he was out when nobody
 * knew. Not knowing and being out are different facts and now look different.
 */
export function officeLabel(s = state) {
  if (!s) return 'Checking';
  return s.inOffice ? 'In office' : 'Out of office';
}

/**
 * The same hours in the reader's own clock: "10:00 AM to 9:00 PM your time",
 * or an empty string when the browser cannot say where it is.
 *
 * READ FROM THE SENTENCE THE CLIENT IS LOOKING AT. `sentence` is his hours
 * line, and the two numbers are parsed out of it, so the Mountain half and the
 * local half of that line cannot state different times however either is
 * edited. No hours are written down here.
 *
 * Empty rather than wrong, every time: no timezone from the browser, a zone
 * Intl refuses, a sentence with no clock times in it, or a reader already on
 * his clock (where the second half would only repeat the first). The sheet then
 * shows Mountain alone, which is what it said before this existed.
 *
 * `opts.zone` and `opts.now` exist so the suite can run this against a named
 * zone and a fixed instant. Nothing in the app passes them; the browser's own
 * timezone and the current moment are the defaults.
 */
export function localHoursNote(sentence, { zone, now = new Date() } = {}) {
  try {
    const said = /(\d{1,2}):(\d{2})\s*AM to (\d{1,2}):(\d{2})\s*PM/.exec(String(sentence || ''));
    if (!said) return '';
    const openMin = (Number(said[1]) % 12) * 60 + Number(said[2]);
    const closeMin = ((Number(said[3]) % 12) + 12) * 60 + Number(said[4]);
    // Undefined means "ask the browser", which is what the app does. Anything
    // else, an empty string included, is taken at its word - so the suite can
    // hand this what a browser that reports nothing hands it.
    const here = zone === undefined
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : zone;
    if (!here) return '';
    const mine = offsetMinutes(now, OFFICE_ZONE);
    const theirs = offsetMinutes(now, here);
    if (!Number.isFinite(mine) || !Number.isFinite(theirs) || mine === theirs) return '';
    // Anchored to the date it is on HIS calendar, so "8:00 AM" is 8:00 AM on
    // the day the reader is actually having. In the hour a daylight-saving
    // change lands this can be out by that hour, for that hour.
    const wall = new Date(now.getTime() + mine * 60_000);
    const midnight = Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate());
    const at = (mins) => new Date(midnight + (mins - mine) * 60_000);
    const clock = new Intl.DateTimeFormat('en-US', {
      timeZone: here, hour: 'numeric', minute: '2-digit', hour12: true,
    });
    const from = clock.format(at(openMin));
    const to = clock.format(at(closeMin));
    // A last look before it goes on a client's screen: if either half came back
    // without a digit in it, print nothing rather than print nonsense.
    if (!/\d/.test(from) || !/\d/.test(to)) return '';
    return `${from} to ${to} your time`;
  } catch {
    return '';
  }
}

/** Minutes that `zone` is ahead of UTC at `date`. Throws on an unusable zone. */
function offsetMinutes(date, zone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  const asUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'),
    get('hour') % 24, get('minute'), get('second'),
  );
  return (asUtc - date.getTime()) / 60_000;
}

/**
 * Paint the cue inside `root`.
 *
 * Looks for `[data-office]`, and falls back to the older `.p-dot` / `.p-label`
 * pair, so a surface that has not been given the pill markup still says
 * something true rather than nothing.
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
    // The third class, so "we do not know yet" cannot be mistaken for "he is
    // out". site.css gives it a dashed edge and a hollow dot.
    cue.classList.toggle('unknown', !known);
    cue.setAttribute('title', known
      ? (state.inOffice ? 'In office' : 'Out of office')
      : 'Checking whether I am in office');
  }
  // `.on` is the class the dot already used, so the existing rule in site.css
  // keeps working and no surface loses its dot in the change.
  if (dot) dot.classList.toggle('on', known && state.inOffice);
  if (label) label.textContent = officeLabel();
  // The response line, on the surfaces that have a slot for it. Painted from
  // the same answer as the pill, so a line he clears disappears everywhere at
  // once, and nothing is shown until he has typed one.
  const line = root.querySelector?.('[data-office-line]');
  if (line) {
    const said = known && state.responseTime ? state.responseTime : '';
    line.textContent = said ? `"${said}"` : '';
    line.hidden = !said;
  }
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
  return `<span class="office-cue unknown" data-office role="status">`
    + `<span class="p-dot" aria-hidden="true"></span>`
    + `<span class="p-label">Checking</span></span>`
    + `<button class="help-dot" data-help="hours" type="button"`
    + ` aria-label="When will Eric respond?" title="When will Eric respond?">?</button>`;
}

/**
 * The empty slot for the response line, for a surface that shows one beside
 * the pill.
 *
 * Empty and hidden until an answer arrives, and filled by paint() from that
 * answer. It is deliberately markup with nothing in it rather than a string
 * baked in at render time: the page paints once and the answer arrives later,
 * so a line built into the HTML would either be missing or be stale.
 *
 * THERE IS ONE RESPONSE LINE IN THE APP. It is the one Eric types beside his
 * in/out switch, it reaches the browser on the same answer as the pill, and
 * every surface that shows it shows this. Two stores for it meant a subscriber
 * could read two different promises two taps apart.
 */
export function officeLineHtml() {
  return '<span class="expectation" data-office-line hidden></span>';
}
