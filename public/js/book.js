// The booking flow (PR 69): three visible steps under a persistent step
// rail. Step 1 takes the time, the meeting method, the continuity-of-care
// phone consent, and (when missing) the client's name and date of birth;
// step 2 is the one agreement in four scroll-to-end parts; step 3 takes
// payment and previews the add-ons a running case can buy. The follow-up
// session is a separate $-priced add-on sold from the case page after the
// report lands - NOT included in the case price (an older version of this
// comment said otherwise and was wrong). The Worker re-validates
// everything; this UI is not trusted.

import { db, doc, getDoc, setDoc, collection, getDocs, query, where } from './firebase.js';
import { currentUser, hydrateNav } from './auth.js';
import { ensureSignedIn } from './inline-auth.js';
import { ageFromDob, MIN_AGE } from './profile.js';
import { WAIVERS } from './waivers.js';
import { SERVICE_TERMS, SERVICE_TERMS_PLAIN } from './service-terms.js';
import { rates } from './rates.js';

// The fallback price, and only the fallback. The real one lives in the Worker
// and moves on its own: every completed booking lifts it, so a number compiled
// into this file is wrong the moment somebody else books. It is still here
// because a rate fetch that fails should show a real price rather than a
// blank, and at deploy time this IS the price.
//
// Booking buys one thing (Eric, 2026-08-20). The follow-up used to be a
// checkbox on this screen; it is sold from the case after the report lands
// instead, so this step is a single price and a single decision.
const CASE_PRICE_CENTS = 120000;
// Filled from /api/rates before the payment step renders, and again if the
// Worker refuses a stale quote.
let caseCents = CASE_PRICE_CENTS;
// This page sells ONE service (Eric, 2026-08-25: "Advocacy case and direct
// line are bookable. The others are ADD-ONS."). Hands-Off Case Management is
// bought from inside an open case at the difference; no tier price is
// compiled into this file any more.
// Thousands separated, because the case price crossed $1,000 in the 2026-08-26
// recalibration and "$1200" on a payment button reads like a typo.
const money = (cents) => (cents / 100).toLocaleString('en-US',
  cents % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});

// MST = fixed UTC-7 year-round (IANA 'Etc/GMT+7'; the sign is inverted by design).
const MOUNTAIN_TZ = 'Etc/GMT+7';
const LEAD_TIME_MS = 72 * 3600 * 1000;
// Quiet horizon: slots further out than 1.5 weeks simply don't render.
// The Worker enforces the same cap server-side.
const MAX_LEAD_MS = 252 * 3600 * 1000;

// Plain-language line under each agreement title (copy deck, PR 69).
const AGREEMENT_PLAIN = {
  disclaimer: "What this is, what it is not, and what you're agreeing to.",
  privacy: "What I store, where it lives, and who can see it. You and me. That's the list.",
  recording: 'Our call is recorded so you can revisit it later. The recording is saved in your private case file.',
  [SERVICE_TERMS.id]: SERVICE_TERMS_PLAIN,
};

const state = {
  acks: {}, // formId -> ms timestamp, captured the moment the box is ticked
  read: {}, // formId -> true once a body has been opened and read to the end
  slot: null, // { id, start: Date, durationMin }
  requestedStart: null, // Date: a time asked for that isn't on the calendar
  method: 'phone',
  phone: '',
};

const STEPS = [
  { label: 'Your time', render: renderTime },
  { label: 'One agreement', render: renderAgreement },
  { label: 'Payment', render: renderPayment },
];

let stepIndex = 0;
let user = null;
let profile = {}; // users/{uid} data: read at init, updated by the inline save

init();

async function init() {
  hydrateNav();
  // The live rate, before anything quotes a number. A failed fetch leaves the
  // compiled-in fallback in place, which is the right price at deploy time and
  // is re-checked by the Worker before a card is ever charged.
  rates().then((r) => {
    if (r && Number(r.caseCents) > 0) caseCents = Number(r.caseCents);
  }).catch(() => {});
  drawRail(); // step 1 shows active even while the sign-in card is up
  if (new URLSearchParams(location.search).get('canceled')) {
    showError('Checkout was canceled, so the time you selected is no longer being held. Choose a time to try again.');
  }
  user = await currentUser();
  if (!user) {
    // Signed-out visitors sign in right here, inside step 1.
    user = await ensureSignedIn(document.getElementById('step'), { returnTo: '/book.html' });
  }
  // requireUser used to create users/{uid} on first sign-in; currentUser +
  // ensureSignedIn do not, so replicate auth.js's ensureProfile here. The
  // same read also prefills the inline step-1 profile fields.
  const ref = doc(db, 'users', user.uid);
  try {
    const snapshot = await getDoc(ref);
    if (snapshot.exists()) profile = snapshot.data();
    else await setDoc(ref, { email: user.email, name: '', role: 'client' });
  } catch (err) {
    console.warn('profile check failed', err);
  }
  render();
}

function drawRail() {
  document.getElementById('crumbs').innerHTML = STEPS.map(
    (s, i) =>
      `<li class="${i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}"><span class="n">${i + 1}</span><span class="t">${s.label}</span></li>`
  ).join('');
}

function render() {
  drawRail();
  document.getElementById('step').innerHTML = '';
  STEPS[stepIndex].render();
}

function next() {
  stepIndex = Math.min(stepIndex + 1, STEPS.length - 1);
  showError('');
  render();
}
function back() {
  stepIndex = Math.max(stepIndex - 1, 0);
  showError('');
  render();
}

function showError(msg) {
  const el = document.getElementById('page-error');
  el.textContent = msg;
  el.hidden = !msg;
}

function mount(html) {
  document.getElementById('step').innerHTML = html;
  return document.getElementById('step');
}

const needsProfile = () => !(profile.firstName && profile.lastName && profile.dob);

// ---- the flow's furniture ----

/**
 * Line icons, drawn from the same set as the rest of the app's mockup: one
 * weight, round caps, no fills, and `currentColor` throughout so a medallion's
 * colour comes from the scheme token on its container rather than from here.
 * Nothing in this file may name a colour: there are four schemes and a literal
 * is wrong in three of them.
 */
const SVG = (d) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"
     stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON = {
  calendar: SVG('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/><circle cx="8.5" cy="14.5" r="1.1" fill="currentColor" stroke="none"/><circle cx="12" cy="14.5" r="1.1" fill="currentColor" stroke="none"/>'),
  clock: SVG('<circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/>'),
  phone: SVG('<path d="M6.2 3.5h3l1.6 4-2 1.4a12 12 0 0 0 5.3 5.3l1.4-2 4 1.6v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4.2 5.7a2 2 0 0 1 2-2.2Z"/>'),
  video: SVG('<rect x="2.5" y="6" width="13" height="12" rx="3"/><path d="m15.5 11 6-3.2v8.4l-6-3.2z"/>'),
  doc: SVG('<path d="M6 3h7l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"/><path d="M13 3v5h5M8.5 13h7M8.5 17h5"/>'),
  shield: SVG('<path d="M12 3 5 6v6c0 4.2 2.9 7.7 7 9 4.1-1.3 7-4.8 7-9V6l-7-3Z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
  brief: SVG('<rect x="3" y="7" width="18" height="13" rx="3"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12h18"/>'),
  card: SVG('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h3"/>'),
};

/**
 * Refuse in a way the client can actually find.
 *
 * The defect this replaces: Continue was pressed, one `<p class="error">`
 * somewhere on a page three screens tall was un-hidden, and nothing else
 * happened. On a phone that is indistinguishable from a dead button, and it is
 * exactly where a walk-through of the flow got stuck. Now the reason is
 * printed against the control that is blocking, that control is marked,
 * the message is scrolled into the middle of the screen, and the caret lands
 * in the field so the fix is one tap away.
 */
function refuse(errEl, msg, { field = null, block = null } = {}) {
  if (!errEl) return;
  errEl.textContent = msg;
  errEl.hidden = false;
  if (field) {
    field.classList.add('is-invalid');
    field.setAttribute('aria-invalid', 'true');
  }
  if (block) block.classList.add('is-invalid');
  errEl.scrollIntoView({ block: 'center' });
  // Focus after the scroll has been asked for, not before: focusing a field
  // scrolls the page on its own and would fight the position just requested.
  setTimeout(() => {
    try { field?.focus({ preventScroll: true }); } catch { /* not focusable */ }
  }, 260);
}

/** Wipe every refusal on the current step before re-checking it. */
function clearRefusals(el) {
  el.querySelectorAll('.field-error').forEach((e) => {
    e.hidden = true;
    e.textContent = '';
  });
  el.querySelectorAll('.is-invalid').forEach((e) => {
    e.classList.remove('is-invalid');
    e.removeAttribute('aria-invalid');
  });
}

/**
 * The one line above the action bar that says what is still outstanding, so
 * the answer is on screen BEFORE the button is pressed rather than after.
 * `ready` turns the dot green: nothing is left to do here.
 */
function setReady(el, msg, ready = false) {
  const note = el.querySelector('#ready-note');
  if (!note) return;
  note.textContent = msg || '';
  note.hidden = !msg;
  note.classList.toggle('go', !!ready);
}

const PHONE_RE = /^\+?[\d\s().-]{7,20}$/;

/**
 * Take away every step-1 control that is rendered above an early return and
 * wired below it.
 *
 * There are two such returns - a calendar read that threw, and a calendar
 * with nothing in it - and only one of them used to clean up. A control on
 * screen and inert is worse than no control: it reads as the app being broken
 * while the visitor keeps tapping it, with no path to pay and no explanation.
 */
function stripUnwiredStep1(el, { keepIntro = false } = {}) {
  el.querySelector('#request-box')?.remove();
  el.querySelector('#after-times')?.remove();
  el.querySelector('#continue')?.remove();
  // The sentence beside Continue describes a form that is no longer there.
  el.querySelector('#ready-note')?.remove();
  if (!keepIntro) el.querySelector('#time-intro')?.remove();
  for (const sel of ['#chips', '#phone-row', '#video-note', '#phone-consent-row',
    '#phone-err', '#consent-err', '#profile-block'])
    el.querySelector(sel)?.remove();
  el.querySelectorAll('h3').forEach((h) => {
    if (/How should we talk/.test(h.textContent)) h.remove();
  });
}

// ---- Step 1: Your time ----

async function renderTime() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';
  const today = new Date().toISOString().slice(0, 10);
  const el = mount(`
    <section class="bk-sec lit bk-hero">
      <div class="bk-sec-h">
        <span class="bk-ic">${ICON.calendar}</span>
        <div>
          <h2>When should we talk?</h2>
          <p class="bk-sub" id="time-intro">Shown in <strong>your</strong> time zone (${zone.replace(/_/g, ' ')}), with my MST time underneath. The earliest booking is 72 hours out.</p>
        </div>
      </div>
    </section>
    <div id="days"><p class="muted">Loading available times…</p></div>

    <details id="request-box">
      <summary class="btn quiet">
        ${ICON.clock}<span>None of these work? Request a time</span><span class="chev" aria-hidden="true">›</span>
      </summary>
      <div class="card">
        <p class="bk-sub" style="margin:0 0 .6rem;">Pick any date and time. I will confirm it before the appointment.</p>
        <div class="bk-field" style="margin-top:0;">
          <label for="req-date">Date</label>
          <input type="date" id="req-date">
        </div>
        <div class="bk-field">
          <label for="req-time">Time</label>
          <input type="time" id="req-time" step="900">
        </div>
        <p class="bk-sub" id="req-mst" style="margin:.6rem 0 0;">Choose a date and time and I will show it in my time zone.</p>
        <p class="error field-error" id="req-error" hidden></p>
      </div>
    </details>

    <div id="after-times">
    <section class="bk-sec">
      <div class="bk-sec-h">
        <span class="bk-ic m">${ICON.phone}</span>
        <div>
          <h3>How should we talk?</h3>
          <p class="bk-sub">One private session, on the line that suits you.</p>
        </div>
      </div>
      <div id="chips">
        <label class="chip-label ${state.method === 'phone' ? 'selected' : ''}">
          <input type="radio" name="method" value="phone" hidden ${state.method === 'phone' ? 'checked' : ''}>
          ${ICON.phone}Phone call
        </label>
        <label class="chip-label ${state.method === 'video' ? 'selected' : ''}">
          <input type="radio" name="method" value="video" hidden ${state.method === 'video' ? 'checked' : ''}>
          ${ICON.video}Video call
        </label>
      </div>
      <div id="phone-row" class="bk-field" ${state.method === 'phone' ? '' : 'hidden'}>
        <label for="phone">Best phone number for the call</label>
        <input type="tel" id="phone" inputmode="tel" autocomplete="tel" placeholder="+1 555 555 5555" value="${state.phone}">
        <p class="error field-error" id="phone-err" hidden></p>
      </div>
      <p class="bk-sub" id="video-note" ${state.method === 'video' ? '' : 'hidden'}>
        I'll send a join link before the call, and it is on your case page too. Nothing to install.
      </p>
      <label class="agreement-check" id="phone-consent-row">
        <input type="checkbox" id="phone-consent" ${state.acks.phoneConsent ? 'checked' : ''}>
        You may contact me by phone between sessions for continuity of care. <span style="color:var(--magenta)">*</span>
      </label>
      <p class="error field-error" id="consent-err" hidden></p>
    </section>
    ${needsProfile() ? `
    <section class="bk-sec" id="profile-block">
      <div class="bk-sec-h">
        <span class="bk-ic g">${ICON.shield}</span>
        <div>
          <h3>Who am I working with?</h3>
          <p class="bk-sub">Your real name, so I know whose case I am reviewing. It stays private, like the rest of your file.</p>
        </div>
      </div>
      <div class="bk-field">
        <label for="pf-first">First name</label>
        <input type="text" id="pf-first" autocomplete="given-name" value="${esc(profile.firstName || '')}">
      </div>
      <div class="bk-field">
        <label for="pf-last">Last name</label>
        <input type="text" id="pf-last" autocomplete="family-name" value="${esc(profile.lastName || '')}">
      </div>
      <div class="bk-field">
        <label for="pf-dob">Date of birth</label>
        <input type="date" id="pf-dob" max="${today}" value="${esc(profile.dob || '')}">
      </div>
      <p class="bk-sub" style="margin-top:.55rem;">Pocket Advocate serves adults. If the client is under 18,
        a parent or guardian needs to reach out first, through the site or the About page's call button.</p>
      <p class="error field-error" id="pf-err" hidden></p>
    </section>` : ''}
    </div>
    <div class="bk-actions">
      <p class="bk-ready" id="ready-note" hidden></p>
      <div class="bk-actions-row">
        <a class="btn quiet" href="/">Back</a>
        <button class="btn glow" id="continue" disabled>Continue</button>
      </div>
    </div>`);

  let slots = [];
  // When the books are shut, say so. An empty calendar with no explanation
  // reads as a broken page or an abandoned business; a date reads as a man
  // who is busy and will be back. The Worker enforces the same window - this
  // is the courtesy half, not the lock.
  let closedUntil = 0;
  try {
    const snap = await getDoc(doc(db, 'settings', 'booking'));
    const raw = snap.exists() ? snap.data().closedUntil : null;
    const t = raw?.toDate ? raw.toDate().getTime() : (raw ? new Date(raw).getTime() : 0);
    if (Number.isFinite(t) && t > Date.now()) closedUntil = t;
  } catch { /* an unreadable setting is not a reason to hide the calendar */ }
  try {
    const snapshot = await getDocs(
      query(collection(db, 'availability'), where('state', '==', 'open'))
    );
    const cutoff = Math.max(Date.now() + LEAD_TIME_MS, closedUntil);
    const horizon = Date.now() + MAX_LEAD_MS;
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const start = data.start && data.start.toDate ? data.start.toDate() : new Date(data.start);
      if (start.getTime() >= cutoff && start.getTime() <= horizon)
        slots.push({ id: docSnap.id, start, durationMin: data.durationMin || 60 });
    });
  } catch (err) {
    el.querySelector('#days').innerHTML =
      `<p class="error">Couldn't load the calendar: ${err.message}</p>
       <p class="muted small">Reload the page and it usually comes back. If it
         does not, the About page has another way to reach me.</p>`;
    // Everything below the calendar is wired further down this function, so
    // returning here used to leave a complete, working-LOOKING form that was
    // entirely inert: chips that did not highlight, a request picker whose
    // time-zone line never updated, a Continue button grey forever. Somebody
    // trying to pay had no path and no explanation.
    stripUnwiredStep1(el, { keepIntro: true });
    return;
  }
  slots.sort((a, b) => a.start - b.start);

  const daysEl = el.querySelector('#days');
  if (!slots.length) {
    // MST, like every policy date. Without the zone, Alaska and Hawaii read
    // "Sunday, September 6" - the day they were standing in - beside an empty
    // calendar. The Worker's closedMessage already pins it.
    const backOn = closedUntil && new Intl.DateTimeFormat('en-US', {
      timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
    }).format(new Date(closedUntil));
    daysEl.innerHTML = closedUntil
      ? `<p class="muted">I have closed my books for now: I am carrying as many
           cases as I can do properly, and taking another would mean doing all
           of them worse. I open again <strong>${backOn}</strong>, and the
           times will appear here.</p>
         <p class="muted small">If you are already a client, nothing about your
           case changes. Message me in your chat as usual.</p>`
      : '<p class="muted">No appointments are open right now. I add new availability regularly, so check back soon.</p>';
    // Everything below the calendar is wired AFTER this early return, so
    // leaving it on screen offers a picker and a set of choices that silently
    // do nothing. When the books are shut there is one thing to say and no
    // decisions to make, so take the rest away rather than let somebody fill
    // it in and press a dead button.
    stripUnwiredStep1(el, { keepIntro: !closedUntil });
    return;
  }

  // Days and headline times run in the CLIENT's zone (Eric, 2026-07-15);
  // Eric's MST equivalent rides underneath so nobody miscounts.
  const dayFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
  });
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, hour: 'numeric', minute: '2-digit',
  });
  const localFmt = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  const byDay = new Map();
  for (const slot of slots) {
    const key = dayFmt.format(slot.start);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(slot);
  }

  daysEl.innerHTML = [...byDay.entries()]
    .map(
      ([day, daySlots]) => `
      <div class="day"><h3>${day}<span class="count">${daySlots.length} time${daySlots.length === 1 ? '' : 's'}</span></h3><div class="slots">
        ${daySlots
          .map(
            (s) => `<button class="slot" data-id="${s.id}">
              ${localFmt.format(s.start)}
              <span class="local">${mtFmt.format(s.start)} MST my time</span>
            </button>`
          )
          .join('')}
      </div></div>`
    )
    .join('');

  /**
   * What is still outstanding on this step, in the order Continue checks it.
   * Printed above the button so the answer is on screen BEFORE it is pressed;
   * the same order is used by the refusal below so the two never disagree.
   */
  const stillNeeded = () => {
    if (!state.slot && !state.requestedStart) return 'Choose a time above to continue.';
    if (state.method === 'phone' && !PHONE_RE.test((el.querySelector('#phone')?.value || '').trim()))
      return 'Add the best phone number for the call.';
    if (!state.acks.phoneConsent) return 'Tick the consent box under the number.';
    if (needsProfile()) {
      const first = el.querySelector('#pf-first')?.value.trim();
      const last = el.querySelector('#pf-last')?.value.trim();
      const dob = el.querySelector('#pf-dob')?.value;
      if (!first || !last) return 'Add your first and last name.';
      if (!dob) return 'Add your date of birth.';
    }
    return '';
  };
  const syncReady = () => {
    const left = stillNeeded();
    setReady(el, left || 'Everything I need. Next is the agreement.', !left);
  };

  daysEl.querySelectorAll('.slot').forEach((btn) =>
    btn.addEventListener('click', () => {
      daysEl.querySelectorAll('.slot').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.slot = slots.find((s) => s.id === btn.dataset.id);
      state.requestedStart = null;
      const rb = el.querySelector('#request-box');
      if (rb) rb.open = false;
      el.querySelector('#continue').disabled = false;
      syncReady();
    })
  );
  // Coming back from a later step: re-mark the slot they already picked.
  if (state.slot) {
    const picked = daysEl.querySelector(`.slot[data-id="${state.slot.id}"]`);
    if (picked) {
      picked.classList.add('selected');
      el.querySelector('#continue').disabled = false;
    } else {
      state.slot = null; // it vanished while they were away
    }
  }
  // ---- request a time that isn't on the calendar ----
  const reqDate = el.querySelector('#req-date');
  const reqTime = el.querySelector('#req-time');
  const reqMst = el.querySelector('#req-mst');
  const reqBox = el.querySelector('#request-box');
  const mstLong = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  // Fence the picker to the same range the Worker accepts, in the client's own
  // zone, so an out-of-range date is impossible rather than rejected at payment.
  const localDay = (ms) => {
    const d = new Date(ms);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
  };
  // The closure raises the floor as well, or a request for a closed date
  // would be typed in full and refused at payment - which is the failure this
  // fencing exists to prevent, and a worse one than an empty calendar.
  reqDate.min = localDay(Math.max(Date.now() + LEAD_TIME_MS, closedUntil));
  reqDate.max = localDay(Date.now() + MAX_LEAD_MS);

  const syncRequest = () => {
    state.requestedStart = null;
    if (!reqDate.value || !reqTime.value) {
      reqMst.textContent = 'Choose a date and time to see it in my time zone.';
      return;
    }
    // A bare "YYYY-MM-DDTHH:MM" is parsed in the client's local zone, which is
    // exactly the zone they picked it in.
    const when = new Date(`${reqDate.value}T${reqTime.value}`);
    if (Number.isNaN(when.getTime())) return;
    state.requestedStart = when;
    reqMst.innerHTML = `That's <strong style="color:var(--ink)">${mstLong.format(when)} MST</strong> my time.`;
    // Choosing a request clears any calendar slot, and vice versa.
    state.slot = null;
    el.querySelectorAll('.slot').forEach((b) => b.classList.remove('selected'));
    el.querySelector('#continue').disabled = false;
    syncReady();
  };
  reqDate.addEventListener('change', syncRequest);
  reqTime.addEventListener('change', syncRequest);
  reqBox.addEventListener('toggle', () => {
    if (reqBox.open) return;
    state.requestedStart = null;
    reqMst.textContent = 'Choose a date and time to see it in my time zone.';
    el.querySelector('#continue').disabled = !state.slot;
    syncReady();
  });
  // Coming back from a later step: re-fill the time they already requested.
  if (state.requestedStart) {
    const d = state.requestedStart;
    const pad = (n) => String(n).padStart(2, '0');
    reqDate.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    reqTime.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    reqBox.open = true;
    syncRequest();
  }

  el.querySelectorAll('input[name=method]').forEach((input) =>
    input.addEventListener('change', () => {
      state.method = input.value;
      el.querySelectorAll('.chip-label').forEach((c) => c.classList.remove('selected'));
      input.closest('.chip-label').classList.add('selected');
      el.querySelector('#phone-row').hidden = input.value !== 'phone';
      el.querySelector('#video-note').hidden = input.value !== 'video';
      syncReady();
    })
  );

  el.querySelector('#continue').addEventListener('click', async () => {
    if (!state.slot && !state.requestedStart) return;
    clearRefusals(el);
    if (state.requestedStart) {
      const reqErr = el.querySelector('#req-error');
      const lead = state.requestedStart.getTime() - Date.now();
      if (lead < LEAD_TIME_MS) {
        refuse(reqErr, 'Please choose a time at least 72 hours from now.', { field: reqDate });
        return;
      }
      if (lead > MAX_LEAD_MS) {
        refuse(reqErr, 'Please choose a time within the next 10 days.', { field: reqDate });
        return;
      }
    }
    if (state.method === 'phone') {
      const phoneField = el.querySelector('#phone');
      state.phone = phoneField.value.trim();
      if (!PHONE_RE.test(state.phone)) {
        // THE refusal that used to happen off screen. It is now printed under
        // the field it is about, scrolled into the middle of the viewport, and
        // the caret is put in the box.
        refuse(el.querySelector('#phone-err'),
          'Enter a valid phone number so I can reach you for the call.',
          { field: phoneField });
        return;
      }
    }
    // Continuity-of-care phone consent (Eric, 2026-08-25). Required for every
    // booking, video included - he calls clients back between sessions
    // whatever the session method. Enforced by the Worker too (REQUIRED_ACKS).
    if (!state.acks.phoneConsent) {
      refuse(el.querySelector('#consent-err'),
        'Tick the consent box so I can call you between sessions.',
        { block: el.querySelector('#phone-consent-row') });
      return;
    }
    // Name + DOB before money moves. The save must land before the pay call
    // because the Worker re-checks the profile at checkout. Same strings and
    // setDoc shape as profile.js's ensureFullProfile.
    if (needsProfile()) {
      const pfErr = el.querySelector('#pf-err');
      const firstField = el.querySelector('#pf-first');
      const lastField = el.querySelector('#pf-last');
      const dobField = el.querySelector('#pf-dob');
      const firstName = firstField.value.trim();
      const lastName = lastField.value.trim();
      const dob = dobField.value;
      if (!firstName || !lastName) {
        refuse(pfErr, 'First and last name, please, so I know whose case I am reviewing.',
          { field: firstName ? lastField : firstField, block: el.querySelector('#profile-block') });
        return;
      }
      const age = ageFromDob(dob);
      if (age === null) {
        refuse(pfErr, 'Enter your date of birth.',
          { field: dobField, block: el.querySelector('#profile-block') });
        return;
      }
      if (age < MIN_AGE) {
        mount(`
          <h2>A parent or guardian needs to contact me first</h2>
          <p class="muted">If you are trying to book for someone under 18, have a parent or guardian reach out
          through the site first (the call button on the <a href="/about.html">About page</a> works).
          I will take it from there.</p>`);
        return;
      }
      try {
        await setDoc(doc(db, 'users', user.uid), {
          firstName, lastName, dob,
          name: `${firstName} ${lastName}`,
          email: user.email || profile.email || null,
          role: profile.role || 'client',
        }, { merge: true });
        profile = { ...profile, firstName, lastName, dob };
      } catch (e) {
        refuse(pfErr, `Couldn't save: ${e.message}`,
          { block: el.querySelector('#profile-block') });
        return;
      }
    }
    next();
  });

  // The consent tick is an acknowledgment like the agreement boxes: stamped
  // the moment it happens, cleared if they untick, sent in the same acks map.
  el.querySelector('#phone-consent')?.addEventListener('change', (e) => {
    if (e.target.checked) state.acks.phoneConsent = Date.now();
    else delete state.acks.phoneConsent;
    el.querySelector('#consent-err').hidden = true;
    el.querySelector('#phone-consent-row')?.classList.remove('is-invalid');
    syncReady();
  });

  // Typing into a field that was just refused clears its mark straight away,
  // so the red does not outlive the problem.
  for (const sel of ['#phone', '#pf-first', '#pf-last', '#pf-dob']) {
    const field = el.querySelector(sel);
    if (!field) continue;
    field.addEventListener('input', () => {
      field.classList.remove('is-invalid');
      field.removeAttribute('aria-invalid');
      const box = field.closest('.bk-sec');
      if (box) {
        box.classList.remove('is-invalid');
        box.querySelectorAll('.field-error').forEach((e) => { e.hidden = true; });
      }
      syncReady();
    });
  }
  syncReady();
}

// ---- Step 2: One agreement ----

// The three original waivers, plus the service terms added 2026-08-24. Kept
// as one list so the scroll gate, the tick boxes and the Continue button all
// count the same set - a fourth part bolted on beside them would have been a
// fourth chance to leave one unwired.
const AGREEMENT_PARTS = [...WAIVERS, SERVICE_TERMS];

// How long each part is. Not a word of the agreement can go and the scroll
// gate stays, so the only honest thing left to change is how much of it the
// client can SEE they have done: 1,425 words behind four identical closed
// drawers, with no sense of progress, is what people abandon.
const wordsIn = (html) => String(html).replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length;
// 200 words a minute is a fair pace for a document somebody is actually
// reading rather than skimming, and a minute is the smallest useful unit.
const minutesFor = (words) => Math.max(1, Math.round(words / 200));

function renderAgreement() {
  const parts = AGREEMENT_PARTS.map((w) => ({ ...w, words: wordsIn(w.body) }));
  const totalWords = parts.reduce((n, p) => n + p.words, 0);
  const el = mount(`
    <section class="bk-sec lit">
      <div class="bk-sec-h">
        <span class="bk-ic">${ICON.doc}</span>
        <div>
          <h2>One agreement, four short parts</h2>
          <p class="bk-sub">Open each part and read it through. Once you have reached the end of all four, you can acknowledge the agreement.</p>
        </div>
      </div>
      <div class="agree-meter">
        <ol class="agree-dots" id="agree-dots">${parts.map((p) => `<li data-dot="${p.id}"></li>`).join('')}</ol>
        <p class="agree-count" id="agree-count"></p>
      </div>
    </section>
    ${parts.map(
      (w, i) => `
      <details class="agreement" data-id="${w.id}">
        <summary>
          <span class="agreement-title">${esc(w.title)}</span>
          <span class="agreement-plain">${AGREEMENT_PLAIN[w.id] || ''}</span>
          <span class="agree-tag"><span class="len">Part ${i + 1} of ${parts.length} · about ${minutesFor(w.words)} min</span><span class="pill" data-pill>Not read</span></span>
        </summary>
        <div class="agreement-body">${w.body}</div>
        <div class="read-bar" data-bar><i></i></div>
        <p class="read-hint" data-hint>Read to the end of this part and the box below unlocks.</p>
        <label class="agreement-check"><input type="checkbox" ${state.acks[w.id] ? 'checked' : ''} ${state.acks[w.id] || state.read[w.id] ? '' : 'disabled'}> I have read and acknowledge this</label>
      </details>`
    ).join('')}
    <div class="bk-actions">
      <p class="bk-ready" id="ready-note" hidden></p>
      <div class="bk-actions-row">
        <button class="btn quiet" id="back">Back</button>
        <button class="btn glow" id="continue" ${AGREEMENT_PARTS.every((w) => state.acks[w.id]) ? '' : 'disabled'}>Continue</button>
      </div>
    </div>`);

  const continueBtn = el.querySelector('#continue');
  const countEl = el.querySelector('#agree-count');

  /** The headline count, the four segments, and the line above Continue. */
  const paintTotals = () => {
    const done = (p) => !!state.acks[p.id] || !!state.read[p.id];
    const readCount = parts.filter(done).length;
    const ackCount = parts.filter((p) => state.acks[p.id]).length;
    const leftWords = parts.filter((p) => !done(p)).reduce((n, p) => n + p.words, 0);
    countEl.innerHTML = ackCount === parts.length
      ? `All ${parts.length} acknowledged<span class="rest">nothing left to read</span>`
      : `${readCount} of ${parts.length} read<span class="rest">${
          leftWords
            ? `about ${minutesFor(leftWords)} min left`
            : `${parts.length - ackCount} box${parts.length - ackCount === 1 ? '' : 'es'} to tick`
        }</span>`;
    // Whichever part is open and not yet finished is the one thing to say.
    const open = [...el.querySelectorAll('details.agreement[open]')]
      .find((d) => !state.read[d.dataset.id] && !state.acks[d.dataset.id]);
    if (ackCount === parts.length) setReady(el, 'All four acknowledged. Next is payment.', true);
    else if (readCount === parts.length) setReady(el, 'Tick the box in each part to acknowledge it.');
    else if (open) setReady(el, 'Keep going to the end of the part you have open.');
    else setReady(el, `Open the next part and read it to the end. About ${minutesFor(leftWords)} min left.`);
  };

  const syncContinue = () => {
    continueBtn.disabled = !AGREEMENT_PARTS.every((w) => state.acks[w.id]);
  };

  el.querySelectorAll('details.agreement').forEach((d) => {
    const id = d.dataset.id;
    const body = d.querySelector('.agreement-body');
    const box = d.querySelector('.agreement-check input');
    const bar = d.querySelector('[data-bar]');
    const hint = d.querySelector('[data-hint]');
    const pill = d.querySelector('[data-pill]');
    const dot = el.querySelector(`[data-dot="${id}"]`);

    /** This part's state, on its pill, its hint and its segment of the meter. */
    const paintPart = () => {
      const acked = !!state.acks[id];
      const done = acked || !!state.read[id];
      pill.textContent = acked ? 'Acknowledged' : done ? 'Read' : d.open ? 'Reading' : 'Not read';
      pill.className = `pill${acked ? ' ack' : done ? ' read' : d.open ? ' at' : ''}`;
      hint.textContent = acked
        ? 'Acknowledged. Nothing else to do in this part.'
        : done
          ? 'You have reached the end. Tick the box to acknowledge this part.'
          : 'Read to the end of this part and the box below unlocks.';
      hint.classList.toggle('done', done);
      dot.className = acked ? 'ack' : done ? 'read' : d.open ? 'at' : '';
      if (done) {
        bar.style.setProperty('--p', '1');
        dot.style.setProperty('--p', '1');
      }
    };

    /** How far down this part the client has got, live, as they scroll it. */
    const paintProgress = () => {
      if (!d.open) return;
      const seen = body.scrollHeight > 0
        ? Math.min(1, (body.scrollTop + body.clientHeight) / body.scrollHeight)
        : 1;
      const p = state.read[id] ? 1 : seen;
      bar.style.setProperty('--p', p.toFixed(3));
      dot.style.setProperty('--p', p.toFixed(3));
    };

    // Proof of exposure: the box unlocks only after this part has been opened
    // AND its body scrolled to the end. Checked once on open too, because a
    // short body may not need to scroll at all. Never measure while closed:
    // a hidden body reads 0/0 and would unlock for free.
    const checkScrolled = () => {
      if (!d.open) return;
      if (body.scrollTop + body.clientHeight >= body.scrollHeight - 8) {
        state.read[id] = true;
        box.disabled = false;
      }
    };
    body.addEventListener('scroll', () => {
      checkScrolled();
      paintProgress();
      paintPart();
      paintTotals();
    });
    d.addEventListener('toggle', () => {
      if (d.open) requestAnimationFrame(() => {
        checkScrolled();
        paintProgress();
        paintPart();
        paintTotals();
      });
      else { paintPart(); paintTotals(); }
    });
    box.addEventListener('change', () => {
      // The ack timestamp is the moment the box is ticked (the Worker stores
      // these). Unticking withdraws it.
      if (box.checked) state.acks[id] = Date.now();
      else delete state.acks[id];
      syncContinue();
      paintPart();
      paintTotals();
    });
    paintPart();
  });
  paintTotals();

  el.querySelector('#back').addEventListener('click', back);
  continueBtn.addEventListener('click', next);
}

// ---- Step 3: Payment ----

function renderPayment() {
  const localLong = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const methodLabel = state.method === 'phone' ? `Phone call to ${state.phone}` : 'Video call (I\'ll send the link)';
  const when = state.slot ? state.slot.start : state.requestedStart;
  const isRequest = !state.slot && !!state.requestedStart;

  const el = mount(`
    <h2>Lock it in</h2>
    <section class="bk-sec">
      <div class="bk-sec-h">
        <span class="bk-ic">${ICON.brief}</span>
        <div>
          <h3>Advocacy Case</h3>
          <p class="bk-sub">Private session, one to one.</p>
        </div>
      </div>
      <div class="bk-lines">
        <p class="bk-line">${ICON.calendar}<span><strong>${localLong.format(when)}</strong> (your time)<br>${mtFmt.format(when)} MST my time</span></p>
        <p class="bk-line">${state.method === 'phone' ? ICON.phone : ICON.video}<span>${methodLabel}</span></p>
        ${isRequest ? `<p class="bk-line">${ICON.clock}<span class="pend">Time requested. Awaiting confirmation.</span></p>` : ''}
      </div>
    </section>
    ${isRequest ? `<p class="notice-box pending">
      <strong>This time is a request.</strong> It isn't on my calendar yet. Your case opens and
      your payment is taken as normal, and I'll confirm this time, or offer you the nearest one
      that works, before the date. Nothing is lost either way.
    </p>` : ''}
    <div class="price-line">
      <span class="price" data-case-price>$${money(caseCents)}</span>
      <span class="included" data-included>This includes our call and your written report within 7 days.</span>
    </div>
    <details class="faq" id="addons-preview">
      <summary>Case Enhancements, once your case starts</summary>
      <div class="faq-a">
        <p class="muted small" style="margin:.3rem 0 .5rem;">Nothing to decide
          now, and nothing here is charged today. Once your case is open,
          these are available from the Case Enhancements tab on your case page
          whenever you want them:</p>
        <p class="muted small" style="margin:0 0 .35rem;"><strong style="color:var(--ink)">Hands-Off Case Management</strong><br>
          I take over the legwork for 60 days: check-in calls at least twice a
          month, unlimited calls to your clinics and insurer on your behalf,
          your telehealth visits attended, and two written insurance appeals.
          You pay what is owed minus what you have already paid, never twice.</p>
        <p class="muted small" style="margin:0 0 .35rem;"><strong style="color:var(--ink)">Follow-up session · $<span data-rate="addon">175</span></strong><br>
          A second full discussion on the same case after your report lands. Same case, same file, no starting over.</p>
        <p class="muted small" style="margin:0;"><strong style="color:var(--ink)">Telehealth appointment advocacy · $250</strong><br>
          I join a telehealth visit with one of your own providers by video and advocate live. I confirm every appointment personally; if I can't attend, or your provider doesn't allow it, you get every dollar back. Included with Hands-Off Case Management.</p>
      </div>
    </details>
    <p class="bk-fine">${isRequest ? 'Requested times are not held while you complete payment.' : 'Your selected time is held while you complete payment.'} You'll be taken to Stripe's secure checkout, so card details never touch this site. Case fees are non-refundable once your slot is booked. If I reschedule you more than once, you're entitled to a full refund on request.</p>
    <p class="error field-error" id="pay-error" hidden></p>
    <div class="bk-actions">
      <p class="bk-ready go" id="ready-note">Card details go to Stripe, never to this site.</p>
      <div class="bk-actions-row">
        <button class="btn quiet" id="back">Back</button>
        <button class="btn glow" id="pay">Pay $${money(caseCents)} and book</button>
      </div>
    </div>`);

  el.querySelector('#back').addEventListener('click', back);

  // One service on this screen now (Eric, 2026-08-25: "Advocacy case and
  // direct line are bookable. The others are ADD-ONS."). Hands-Off Case
  // Management is bought from inside an open case, at the difference, behind
  // its own scope-note gate there - the tier picker and its agreement left
  // with the second service.
  const payBtn = el.querySelector('#pay');
  const repaintPrice = () => {
    const p = el.querySelector('[data-case-price]');
    if (p) p.textContent = `$${money(caseCents)}`;
    payBtn.textContent = `Pay $${money(caseCents)} and book`;
  };
  repaintPrice();

  el.querySelector('#pay').addEventListener('click', async () => {
    const errEl = el.querySelector('#pay-error');
    payBtn.disabled = true;
    errEl.hidden = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          slotId: state.slot ? state.slot.id : undefined,
          requestedStart: state.requestedStart ? state.requestedStart.toISOString() : undefined,
          method: state.method,
          phone: state.phone,
          acks: state.acks,
          // What this screen is showing. If the rate moved between the page
          // loading and this button being pressed, the Worker refuses rather
          // than charging a number nobody agreed to.
          quotedCents: caseCents,
          // So emails can speak the client's local time (Eric, 2026-07-15).
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.error === 'rate-changed' && Number(data.caseCents) > 0) {
        // Update the number and hand the button back. No explanation: the
        // price is what it is, and why it changed is nobody's business.
        caseCents = Number(data.caseCents);
        repaintPrice();
        payBtn.disabled = false;
        return;
      }
      if (!res.ok) throw new Error(data.error || `Checkout failed (${res.status})`);
      location.href = data.url;
    } catch (err) {
      // A refused payment is the one refusal a client is certain to be looking
      // for, so it gets the same treatment as the rest: boxed, and scrolled to.
      refuse(errEl, err.message);
      payBtn.disabled = false;
    }
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
