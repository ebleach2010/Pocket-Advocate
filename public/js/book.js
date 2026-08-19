// The book-and-pay wizard (SPEC §C/§D): waivers 1–3 (one per screen,
// scroll-to-end + explicit acknowledge) → one screen that takes both the
// slot and the meeting method → review, optional $50 add-on, Stripe
// Checkout. Sessions are always private, so there is no election screen.
// The Worker re-validates everything; this UI is not trusted.

import { db, collection, getDocs, query, where } from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';
import { ensureFullProfile } from './profile.js';
import { WAIVERS } from './waivers.js';

// MST = fixed UTC-7 year-round (IANA 'Etc/GMT+7'; the sign is inverted by design).
const MOUNTAIN_TZ = 'Etc/GMT+7';
const LEAD_TIME_MS = 72 * 3600 * 1000;
// Quiet horizon: slots further out than 1.5 weeks simply don't render.
// The Worker enforces the same cap server-side.
const MAX_LEAD_MS = 252 * 3600 * 1000;

const state = {
  acks: {}, // formId -> ms timestamp
  slot: null, // { id, start: Date, durationMin }
  requestedStart: null, // Date — a time asked for that isn't on the calendar
  method: 'phone',
  phone: '',
  addOnFollowUp: false,
};

const STEPS = [
  ...WAIVERS.map((w) => ({ label: w.title.split(' ')[0], render: () => renderWaiver(w) })),
  { label: 'Time', render: renderSchedule },
  { label: 'Pay', render: renderReview },
];

let stepIndex = 0;
let user = null;

init();

async function init() {
  hydrateNav();
  user = await requireUser();
  if (!user) return;
  // Name + DOB before anything else; blocks under-18s (Worker re-checks).
  await ensureFullProfile(user, document.getElementById('step'));
  if (new URLSearchParams(location.search).get('canceled')) {
    showError('Checkout was canceled. Your slot was released — pick a time to try again.');
  }
  render();
}

function render() {
  const crumbs = document.getElementById('crumbs');
  crumbs.innerHTML = STEPS.map(
    (s, i) =>
      `<li class="${i < stepIndex ? 'done' : i === stepIndex ? 'now' : ''}">${s.label}</li>`
  ).join('');
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

// ---- Waiver screens (forms 1–3) ----

function renderWaiver(waiver) {
  const el = mount(`
    <h2>The unskippable part — ${waiver.title}</h2>
    <p class="muted small">Know exactly what you're buying. The acknowledge button unlocks when you've scrolled to the end.</p>
    <div class="waiver-body" id="wbody">${waiver.body}</div>
    <p class="scroll-hint" id="hint">Scroll to the end to continue…</p>
    <p>
      ${stepIndex > 0 ? '<button class="btn quiet" id="back">Back</button>' : '<a class="btn quiet" href="/">← Back</a>'}
      <button class="btn" id="ack" disabled>I have read and acknowledge this</button>
    </p>`);

  const body = el.querySelector('#wbody');
  const ack = el.querySelector('#ack');
  const hint = el.querySelector('#hint');
  const checkScrolled = () => {
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 8) {
      ack.disabled = false;
      hint.hidden = true;
    }
  };
  body.addEventListener('scroll', checkScrolled);
  checkScrolled(); // short viewports may not need to scroll

  ack.addEventListener('click', () => {
    state.acks[waiver.id] = Date.now();
    next();
  });
  el.querySelector('#back')?.addEventListener('click', back);
}


// ---- Slot picker ----

async function renderSchedule() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';
  const el = mount(`
    <h2>Pick a time</h2>
    <p class="muted small">All times are shown in <strong>your</strong> time zone (${zone.replace(/_/g, ' ')}), with my MST time underneath. Appointments must be at least 72 hours out.</p>
    <div id="days"><p class="muted">Loading available times…</p></div>

    <details id="request-box" style="margin-top:1rem;">
      <summary class="btn quiet" style="cursor:pointer;">
        None of these work? Request a time →
      </summary>
      <div class="card" style="margin-top:.7rem;">
        <p class="muted small" style="margin-top:0;">Pick any date and time that suits you. I'll review it and confirm — you'll hear back before the date. Times are in your own time zone.</p>
        <label for="req-date">Date</label>
        <input type="date" id="req-date">
        <label for="req-time" style="margin-top:.6rem;">Time</label>
        <input type="time" id="req-time" step="900">
        <p class="muted small" id="req-mst" style="margin:.6rem 0 0;">Choose a date and time to see it in my time zone.</p>
        <p class="error" id="req-error" hidden></p>
      </div>
    </details>

    <h3 style="margin:1.4rem 0 .5rem;">How should we talk?</h3>
    <div id="chips">
      <label class="chip-label ${state.method === 'phone' ? 'selected' : ''}">
        <input type="radio" name="method" value="phone" hidden ${state.method === 'phone' ? 'checked' : ''}>
        Phone call
      </label>
      <label class="chip-label ${state.method === 'video' ? 'selected' : ''}">
        <input type="radio" name="method" value="video" hidden ${state.method === 'video' ? 'checked' : ''}>
        Video call
      </label>
    </div>
    <div id="phone-row" ${state.method === 'phone' ? '' : 'hidden'} style="margin-top:.7rem;">
      <label for="phone">Your phone number — I'll call you</label>
      <input type="tel" id="phone" placeholder="+1 555 555 5555" value="${state.phone}">
    </div>
    <p class="muted small" id="video-note" ${state.method === 'video' ? '' : 'hidden'} style="margin-top:.7rem;">
      I'll send you a join link before the call — it appears on your case page too. Nothing to install.
    </p>
    <p class="error" id="method-error" hidden></p>
    <p>
      <button class="btn quiet" id="back">Back</button>
      <button class="btn" id="continue" disabled>Continue</button>
    </p>`);
  el.querySelector('#back').addEventListener('click', back);

  let slots = [];
  try {
    const snapshot = await getDocs(
      query(collection(db, 'availability'), where('state', '==', 'open'))
    );
    const cutoff = Date.now() + LEAD_TIME_MS;
    const horizon = Date.now() + MAX_LEAD_MS;
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const start = data.start && data.start.toDate ? data.start.toDate() : new Date(data.start);
      if (start.getTime() >= cutoff && start.getTime() <= horizon)
        slots.push({ id: docSnap.id, start, durationMin: data.durationMin || 60 });
    });
  } catch (err) {
    el.querySelector('#days').innerHTML =
      `<p class="error">Couldn't load the calendar: ${err.message}</p>`;
    return;
  }
  slots.sort((a, b) => a.start - b.start);

  const daysEl = el.querySelector('#days');
  if (!slots.length) {
    daysEl.innerHTML =
      '<p class="muted">No open times right now — check back soon, new slots are added regularly.</p>';
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

  daysEl.querySelectorAll('.slot').forEach((btn) =>
    btn.addEventListener('click', () => {
      daysEl.querySelectorAll('.slot').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.slot = slots.find((s) => s.id === btn.dataset.id);
      state.requestedStart = null;
      const rb = el.querySelector('#request-box');
      if (rb) rb.open = false;
      el.querySelector('#continue').disabled = false;
    })
  );
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
  reqDate.min = localDay(Date.now() + LEAD_TIME_MS);
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
  };
  reqDate.addEventListener('change', syncRequest);
  reqTime.addEventListener('change', syncRequest);
  reqBox.addEventListener('toggle', () => {
    if (reqBox.open) return;
    state.requestedStart = null;
    reqMst.textContent = 'Choose a date and time to see it in my time zone.';
    el.querySelector('#continue').disabled = !state.slot;
  });

  el.querySelectorAll('input[name=method]').forEach((input) =>
    input.addEventListener('change', () => {
      state.method = input.value;
      el.querySelectorAll('.chip-label').forEach((c) => c.classList.remove('selected'));
      input.closest('.chip-label').classList.add('selected');
      el.querySelector('#phone-row').hidden = input.value !== 'phone';
      el.querySelector('#video-note').hidden = input.value !== 'video';
    })
  );

  el.querySelector('#continue').addEventListener('click', () => {
    if (!state.slot && !state.requestedStart) return;
    const err = el.querySelector('#method-error');
    err.hidden = true;
    if (state.requestedStart) {
      const reqErr = el.querySelector('#req-error');
      reqErr.hidden = true;
      const lead = state.requestedStart.getTime() - Date.now();
      if (lead < LEAD_TIME_MS) {
        reqErr.textContent = 'Please pick a time at least 72 hours from now.';
        reqErr.hidden = false;
        return;
      }
      if (lead > MAX_LEAD_MS) {
        reqErr.textContent = 'Please pick a time within the next week and a half.';
        reqErr.hidden = false;
        return;
      }
    }
    if (state.method === 'phone') {
      state.phone = el.querySelector('#phone').value.trim();
      if (!/^\+?[\d\s().-]{7,20}$/.test(state.phone)) {
        err.textContent = 'Enter a valid phone number so I can call you.';
        err.hidden = false;
        return;
      }
    }
    next();
  });
}

// ---- Review & pay ----

function renderReview() {
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
    <div class="card">
      <div class="row"><h3>Advocacy Case</h3><span class="price">$125</span></div>
      <p class="muted small">
        <strong style="color:var(--ink)">${localLong.format(when)}</strong> (your time)<br>
        ${mtFmt.format(when)} MST my time<br>
        ${methodLabel} · Private session${isRequest ? ' · <span style="color:var(--orange)">Requested — awaiting my confirmation</span>' : ''}
      </p>
    </div>
    ${isRequest ? `<p class="addon-note pending">
      <strong>This time is a request.</strong> It isn't on my calendar yet. Your case opens and
      your payment is taken as normal, and I'll confirm this time — or offer you the nearest one
      that works — before the date. Nothing is lost either way.
    </p>` : ''}
    <label class="choice addon" id="addon-box">
      <span class="addon-head">
        <span class="addon-title"><input type="checkbox" id="addon"> Add a follow-up discussion</span>
        <span class="addon-price">+$50</span>
      </span>
      <span class="addon-why">A second full discussion on this same case, booked any time after your report lands — use it within one month. A follow-up bought later is a fresh $125 case instead.</span>
      <span class="addon-once">Offered here only</span>
    </label>
    <p class="muted small">${isRequest ? 'Requested times are not held' : 'Your time slot is held'} while you complete payment. You'll be taken to Stripe's secure checkout — card details never touch this site. Case fees are non-refundable once your slot is booked.</p>
    <p class="error" id="pay-error" hidden></p>
    <p>
      <button class="btn quiet" id="back">Back</button>
      <button class="btn" id="pay">Pay $<span id="total">150</span> &amp; book</button>
    </p>`);

  const addon = el.querySelector('#addon');
  addon.addEventListener('change', () => {
    state.addOnFollowUp = addon.checked;
    el.querySelector('#addon-box').classList.toggle('selected', addon.checked);
    el.querySelector('#total').textContent = addon.checked ? '200' : '150';
  });
  el.querySelector('#back').addEventListener('click', back);

  el.querySelector('#pay').addEventListener('click', async () => {
    const payBtn = el.querySelector('#pay');
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
          addOnFollowUp: state.addOnFollowUp,
          acks: state.acks,
          // So emails can speak the client's local time (Eric, 2026-07-15).
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Checkout failed (${res.status})`);
      location.href = data.url;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      payBtn.disabled = false;
    }
  });
}
