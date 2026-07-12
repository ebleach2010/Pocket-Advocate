// The book-and-pay wizard (SPEC §C/§D): waivers 1–3 (one per screen,
// scroll-to-end + explicit acknowledge) → public/private election (its own
// screen, private pre-selected) → slot picker (Mountain + local time) →
// meeting method (Discord badged Preferred) → review, optional $50 add-on,
// Stripe Checkout. The Worker re-validates everything; this UI is not trusted.

import { db, collection, getDocs, query, where } from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';
import { WAIVERS, ELECTION_QUOTE } from './waivers.js';

// MST = fixed UTC-7 year-round (IANA 'Etc/GMT+7'; the sign is inverted by design).
const MOUNTAIN_TZ = 'Etc/GMT+7';
const LEAD_TIME_MS = 72 * 3600 * 1000;

const state = {
  acks: {}, // formId -> ms timestamp
  election: 'private',
  slot: null, // { id, start: Date, durationMin }
  method: 'discord',
  phone: '',
  addOnFollowUp: false,
};

const STEPS = [
  ...WAIVERS.map((w) => ({ label: w.title.split(' ')[0], render: () => renderWaiver(w) })),
  { label: 'Public/private', render: renderElection },
  { label: 'Time', render: renderSchedule },
  { label: 'Method', render: renderMethod },
  { label: 'Pay', render: renderReview },
];

let stepIndex = 0;
let user = null;

init();

async function init() {
  hydrateNav();
  user = await requireUser();
  if (!user) return;
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

// ---- Public/private election (form 4, its own screen) ----

function renderElection(preselected = state.election) {
  const el = mount(`
    <h2>Public or private?</h2>
    <blockquote class="consent-quote">"${ELECTION_QUOTE}"</blockquote>
    <label class="choice ${preselected === 'private' ? 'selected' : ''}" id="c-private">
      <input type="radio" name="election" value="private" ${preselected === 'private' ? 'checked' : ''}>
      <strong>Private session</strong><br>
      <span class="muted small">The discussion happens only between you and Eric. The recording lives only in your case file. Same price, every benefit included.</span>
    </label>
    <label class="choice ${preselected === 'public' ? 'selected' : ''}" id="c-public">
      <input type="radio" name="election" value="public" ${preselected === 'public' ? 'checked' : ''}>
      <strong>Public session</strong><br>
      <span class="muted small">The live discussion is broadcast on the TheBroScientist YouTube channel so other patients can learn from it. You can change your mind and make it private any time before the broadcast starts.</span>
    </label>
    <p>
      <button class="btn quiet" id="back">Back</button>
      <button class="btn" id="continue">Continue</button>
    </p>`);

  el.querySelectorAll('input[name=election]').forEach((input) =>
    input.addEventListener('change', () => {
      el.querySelector('#c-private').classList.toggle('selected', input.value === 'private' && input.checked);
      el.querySelector('#c-public').classList.toggle('selected', input.value === 'public' && input.checked);
      state.election = input.value;
    })
  );
  el.querySelector('#continue').addEventListener('click', () => {
    state.acks.election = Date.now();
    next();
  });
  el.querySelector('#back').addEventListener('click', back);
}

// ---- Slot picker ----

async function renderSchedule() {
  const el = mount(`
    <h2>Pick a time</h2>
    <p class="muted small">Times are anchored to MST (8am–6pm), with your local time shown underneath. Appointments must be at least 72 hours out.</p>
    <div id="days"><p class="muted">Loading available times…</p></div>
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
    snapshot.forEach((docSnap) => {
      const data = docSnap.data();
      const start = data.start && data.start.toDate ? data.start.toDate() : new Date(data.start);
      if (start.getTime() >= cutoff)
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

  const dayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
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
      <div class="day"><h3>${day}</h3><div class="slots">
        ${daySlots
          .map(
            (s) => `<button class="slot" data-id="${s.id}">
              ${mtFmt.format(s.start)} MST
              <span class="local">${localFmt.format(s.start)} your time</span>
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
      el.querySelector('#continue').disabled = false;
    })
  );
  el.querySelector('#continue').addEventListener('click', () => {
    if (state.slot) next();
  });
}

// ---- Meeting method ----

function renderMethod() {
  const el = mount(`
    <h2>How should the call happen?</h2>
    <div id="chips">
      <label class="chip-label ${state.method === 'discord' ? 'selected' : ''}">
        <input type="radio" name="method" value="discord" hidden ${state.method === 'discord' ? 'checked' : ''}>
        Discord voice channel <span class="pref-badge">Preferred</span>
      </label>
      <label class="chip-label ${state.method === 'zoom' ? 'selected' : ''}">
        <input type="radio" name="method" value="zoom" hidden ${state.method === 'zoom' ? 'checked' : ''}>
        Zoom call
      </label>
      <label class="chip-label ${state.method === 'phone' ? 'selected' : ''}">
        <input type="radio" name="method" value="phone" hidden ${state.method === 'phone' ? 'checked' : ''}>
        Phone call
      </label>
    </div>
    <p class="muted small">Discord is preferred — you can stream your own camera there, so it works like any video meeting. Your case page will show the join link (or the number to expect) before the call.</p>
    <div id="phone-row" ${state.method === 'phone' ? '' : 'hidden'}>
      <label for="phone">Your phone number (we'll call you)</label>
      <input type="tel" id="phone" placeholder="+1 555 555 5555" value="${state.phone}">
    </div>
    <p class="error" id="method-error" hidden></p>
    <p style="margin-top:1rem;">
      <button class="btn quiet" id="back">Back</button>
      <button class="btn" id="continue">Continue</button>
    </p>`);

  el.querySelectorAll('input[name=method]').forEach((input) =>
    input.addEventListener('change', () => {
      state.method = input.value;
      el.querySelectorAll('.chip-label').forEach((c) => c.classList.remove('selected'));
      input.closest('.chip-label').classList.add('selected');
      el.querySelector('#phone-row').hidden = input.value !== 'phone';
    })
  );
  el.querySelector('#back').addEventListener('click', back);
  el.querySelector('#continue').addEventListener('click', () => {
    if (state.method === 'phone') {
      state.phone = el.querySelector('#phone').value.trim();
      if (!/^\+?[\d\s().-]{7,20}$/.test(state.phone)) {
        const err = el.querySelector('#method-error');
        err.textContent = 'Enter a valid phone number so Eric can call you.';
        err.hidden = false;
        return;
      }
    }
    next();
  });
}

// ---- Review & pay ----

function renderReview() {
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const methodLabel = { discord: 'Discord voice channel', zoom: 'Zoom call', phone: `Phone call to ${state.phone}` }[state.method];

  const el = mount(`
    <h2>Lock it in</h2>
    <div class="card">
      <div class="row"><h3>Advocacy Case</h3><span class="price">$100</span></div>
      <p class="muted small">
        ${mtFmt.format(state.slot.start)} MST<br>
        ${methodLabel} · ${state.election === 'public' ? 'Public session (broadcast live; revocable until the broadcast starts)' : 'Private session'}
      </p>
    </div>
    <label class="choice" id="addon-box">
      <input type="checkbox" id="addon"> <strong>Add a follow-up discussion — +$50</strong><br>
      <span class="muted small">A second schedulable discussion on this case, bookable any time after your report lands. Only available right now, at checkout — a follow-up later is a fresh $100 case.</span>
    </label>
    <p class="muted small">Your time slot is held while you complete payment. You'll be taken to Stripe's secure checkout — card details never touch this site.</p>
    <p class="error" id="pay-error" hidden></p>
    <p>
      <button class="btn quiet" id="back">Back</button>
      <button class="btn" id="pay">Pay $<span id="total">100</span> & book</button>
    </p>`);

  const addon = el.querySelector('#addon');
  addon.addEventListener('change', () => {
    state.addOnFollowUp = addon.checked;
    el.querySelector('#addon-box').classList.toggle('selected', addon.checked);
    el.querySelector('#total').textContent = addon.checked ? '150' : '100';
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
          slotId: state.slot.id,
          method: state.method,
          phone: state.phone,
          addOnFollowUp: state.addOnFollowUp,
          election: state.election,
          acks: state.acks,
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
