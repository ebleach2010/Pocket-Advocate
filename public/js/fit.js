// The free 15-minute fit call (Eric, 2026-09-01: "Yes, add the free fit
// call"). One page, one question, when; then how to reach you. No account,
// no payment, no agreement. A person who has not decided anything yet should
// not be asked to decide anything except a time.
//
// The picker is book.js's, filtered to the fit slots (kind:'fit'), which the
// paid picker skips for the same reason in reverse. The Worker is the only
// thing that writes: POST /api/fit-call takes the slot and keeps the
// person's details in a place only the Worker reads. The browser never
// touches the leads collection and never learns anyone else's.

import { db, collection, getDocs, query, where } from './firebase.js';
import { BUSINESS_PHONE } from './reviews-config.js';

// Nav auth state rides the Firebase CDN; loaded soft so the page never
// depends on it. The prices in the closing offer likewise.
import('./auth.js').then((m) => m.hydrateNav()).catch(() => {});

// MST = fixed UTC-7 year-round (IANA 'Etc/GMT+7'; the sign is inverted by design).
const MOUNTAIN_TZ = 'Etc/GMT+7';
// Keep in step with LEAD_TIME_HOURS and MAX_LEAD_TIME_HOURS in
// worker/schedule.js. The Worker enforces both; this only hides what it
// would refuse.
const LEAD_TIME_MS = 72 * 3600 * 1000;
const MAX_LEAD_MS = 252 * 3600 * 1000;
// Mirrors FIT_NOTE_MAX in worker/index.js.
const NOTE_MAX = 280;

const state = { slot: null, method: 'phone' };
const box = document.getElementById('fit');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';
const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
const mtFmt = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, hour: 'numeric', minute: '2-digit' });
const localFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
const longLocal = new Intl.DateTimeFormat('en-US', {
  weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
});
const longMt = new Intl.DateTimeFormat('en-US', {
  timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
});

renderPick();

/** The open fit slots inside the bookable window, soonest first. */
async function loadSlots() {
  const snapshot = await getDocs(query(collection(db, 'availability'), where('state', '==', 'open')));
  const slots = [];
  const cutoff = Date.now() + LEAD_TIME_MS;
  const horizon = Date.now() + MAX_LEAD_MS;
  snapshot.forEach((d) => {
    const data = d.data();
    // The fit slots and only the fit slots. A case slot on this page would
    // sell a free call into an hour he opened for paying work.
    if (data.kind !== 'fit') return;
    const start = data.start && data.start.toDate ? data.start.toDate() : new Date(data.start);
    if (start.getTime() >= cutoff && start.getTime() <= horizon)
      slots.push({ id: d.id, start, durationMin: data.durationMin || 15 });
  });
  slots.sort((a, b) => a.start - b.start);
  return slots;
}

async function renderPick() {
  box.innerHTML = `
    <h1>A free 15-minute call</h1>
    <p class="muted measure">You tell me what is going on and I tell you honestly whether I can help. No charge, no obligation.</p>
    <p class="muted small measure">All times are shown in <strong>your</strong> time zone (${esc(zone.replace(/_/g, ' '))}), with my MST time underneath.</p>
    <div id="days" class="stack-tight"><p class="muted">Loading open times…</p></div>
    <div id="after-times" hidden>
    <div class="stack">
    <hr class="divide">
    <h2>How should we talk?</h2>
    <div id="chips">
      <label class="chip-label pill selected">
        <input type="radio" name="method" value="phone" hidden checked>
        Phone call
      </label>
      <label class="chip-label pill">
        <input type="radio" name="method" value="video" hidden>
        Video call
      </label>
    </div>
    <label for="fit-name">Your name</label>
    <input type="text" id="fit-name" autocomplete="name" maxlength="80">
    <label for="fit-email">Email</label>
    <input type="email" id="fit-email" autocomplete="email" inputmode="email" maxlength="120">
    <p class="muted small">The time and the details of the call go here. Nothing else does.</p>
    <div id="phone-row">
      <label for="fit-phone">Best phone number for the call</label>
      <input type="tel" id="fit-phone" autocomplete="tel" placeholder="+1 555 555 5555" maxlength="40">
    </div>
    <p class="muted small measure" id="video-note" hidden>
      I will send a join link by email before the call. Nothing to install.
    </p>
    <label for="fit-note">In one line, what is going on? <span class="muted small">(optional)</span></label>
    <textarea id="fit-note" rows="2" maxlength="${NOTE_MAX}"></textarea>
    <p class="muted small" id="fit-count">${NOTE_MAX} characters left</p>
    <label class="agreement-check" id="us-row">
      <input type="checkbox" id="fit-us">
      I live in the United States or Canada. <span style="color:var(--magenta)">*</span>
    </label>
    <!-- Not for people. A field no visitor sees; the Worker drops anything
         that fills it in. -->
    <div style="position:absolute; left:-10000px; top:auto; width:1px; height:1px; overflow:hidden;" aria-hidden="true">
      <label>Website <input type="text" id="fit-website" name="website" tabindex="-1" autocomplete="off"></label>
    </div>
    <p class="error" id="fit-error" hidden></p>
    <button class="btn cta" id="fit-book" disabled>Book the call</button>
    </div>
    </div>
    <p class="back-row"><a class="btn quiet pill" href="/">← Back</a></p>`;

  const daysEl = box.querySelector('#days');
  let slots = [];
  try {
    slots = await loadSlots();
  } catch (err) {
    daysEl.innerHTML = `<p class="error">Couldn't load the calendar: ${esc(err.message)}</p>
      <p class="muted small">Reload the page and it usually comes back. If it does not, you can call me at ${esc(BUSINESS_PHONE)}.</p>`;
    box.querySelector('#after-times')?.remove();
    return;
  }
  if (!slots.length) {
    daysEl.innerHTML = `<p class="muted">No free-call times are open right now. I add new ones regularly, so check back soon.</p>
      <p><a class="btn quiet" href="tel:${esc(BUSINESS_PHONE)}">📞 Call instead</a>
      <a class="btn quiet" href="/book.html">Book a case</a></p>`;
    box.querySelector('#after-times')?.remove();
    return;
  }

  const byDay = new Map();
  for (const slot of slots) {
    const key = dayFmt.format(slot.start);
    if (!byDay.has(key)) byDay.set(key, []);
    byDay.get(key).push(slot);
  }
  daysEl.innerHTML = [...byDay.entries()].map(([day, list]) => `
    <div class="day"><h3>${esc(day)}<span class="count">${list.length} time${list.length === 1 ? '' : 's'}</span></h3><div class="slots">
      ${list.map((s) => `<button class="slot" data-id="${esc(s.id)}">
          ${localFmt.format(s.start)}
          <span class="local">${mtFmt.format(s.start)} MST my time</span>
        </button>`).join('')}
    </div></div>`).join('');

  const after = box.querySelector('#after-times');
  const bookBtn = box.querySelector('#fit-book');
  daysEl.querySelectorAll('.slot').forEach((btn) =>
    btn.addEventListener('click', () => {
      daysEl.querySelectorAll('.slot').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.slot = slots.find((s) => s.id === btn.dataset.id);
      after.hidden = false;
      bookBtn.disabled = false;
    }));

  box.querySelectorAll('input[name=method]').forEach((input) =>
    input.addEventListener('change', () => {
      state.method = input.value;
      box.querySelectorAll('.chip-label').forEach((c) => c.classList.remove('selected'));
      input.closest('.chip-label').classList.add('selected');
      box.querySelector('#phone-row').hidden = input.value !== 'phone';
      box.querySelector('#video-note').hidden = input.value !== 'video';
    }));

  const note = box.querySelector('#fit-note');
  const count = box.querySelector('#fit-count');
  note.addEventListener('input', () => {
    count.textContent = `${NOTE_MAX - note.value.length} characters left`;
  });

  bookBtn.addEventListener('click', () => submit(slots));
}

async function submit(slots) {
  const errEl = box.querySelector('#fit-error');
  const bookBtn = box.querySelector('#fit-book');
  const show = (msg) => { errEl.textContent = msg; errEl.hidden = false; };
  errEl.hidden = true;
  if (!state.slot) return show('Pick a time first.');
  const name = box.querySelector('#fit-name').value.trim();
  const email = box.querySelector('#fit-email').value.trim();
  const phone = box.querySelector('#fit-phone').value.trim();
  const note = box.querySelector('#fit-note').value.trim().slice(0, NOTE_MAX);
  if (name.length < 2) return show('Your name, please.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email))
    return show('A working email address, please. The details of the call go there.');
  if (state.method === 'phone' && !/^\+?[\d\s().-]{7,20}$/.test(phone))
    return show('Enter a valid phone number so I can reach you for the call.');
  if (!box.querySelector('#fit-us').checked)
    return show('Tick the box if you live in the United States or Canada. I can only work with people there.');

  bookBtn.disabled = true;
  bookBtn.textContent = 'Booking…';
  try {
    const res = await fetch('/api/fit-call', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slotId: state.slot.id, name, email, phone, method: state.method, note,
        tz: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
        us: true,
        website: box.querySelector('#fit-website').value,
      }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) {
      show(out.error || `That did not go through (${res.status}). Try again.`);
      bookBtn.disabled = false;
      bookBtn.textContent = 'Book the call';
      // The time went to someone else: the calendar on screen is stale.
      if (res.status === 409 && /no longer available|just took/.test(out.error || '')) {
        state.slot = null;
        setTimeout(renderPick, 1800);
      }
      return;
    }
    renderDone(state.slot, { name, email, phone });
  } catch (err) {
    show(`Couldn't reach the server: ${err.message}`);
    bookBtn.disabled = false;
    bookBtn.textContent = 'Book the call';
  }
}

function renderDone(slot, who) {
  const local = longLocal.format(slot.start);
  const mt = longMt.format(slot.start);
  box.innerHTML = `
    <h1>Booked.</h1>
    <p class="measure"><strong>${esc(local)}</strong><br>
      <span class="muted">${esc(mt)} MST, my time</span></p>
    <p class="muted measure">${state.method === 'phone'
      ? `I will call you at <strong>${esc(who.phone)}</strong>.`
      : 'A join link comes by email before the call. Nothing to install.'}
      The details are on their way to <strong>${esc(who.email)}</strong>.</p>
    <hr class="divide">
    <p class="muted measure">Already sure you want to go ahead? You do not have to wait for the call.</p>
    <div class="actions">
      <a class="btn cta" href="/book.html">Book a case, <span data-rate="case">$1,200</span></a>
      <a class="btn quiet" href="/">Back to the front page</a>
    </div>`;
  import('./rates.js').catch(() => {});
}
