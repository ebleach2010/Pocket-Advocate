// The booking flow (PR 69): three visible steps under a persistent step
// rail. Step 1 takes the time, the meeting method, and (when missing) the
// client's name and date of birth; step 2 is the one agreement in three
// scroll-to-end parts; step 3 takes payment. Sign-in folds into the page
// via inline-auth.js instead of bouncing new visitors to /signin.html.
// The follow-up session is included in the case price now; the paid add-on
// is gone from the UI. The Worker re-validates everything; this UI is not
// trusted.

import { db, doc, getDoc, setDoc, collection, getDocs, query, where } from './firebase.js';
import { currentUser, hydrateNav } from './auth.js';
import { ensureSignedIn } from './inline-auth.js';
import { ageFromDob, MIN_AGE } from './profile.js';
import { WAIVERS } from './waivers.js';
import { FULL_ACCESS_TERMS, FULL_ACCESS_PLAIN } from './tier-terms.js';
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
const CASE_PRICE_CENTS = 65000;
// Filled from /api/rates before the payment step renders, and again if the
// Worker refuses a stale quote.
let caseCents = CASE_PRICE_CENTS;
// The other thing this page can sell. Eric works inside the case rather than
// beside it: he talks to the clinics and the insurer himself and files the
// appeals. Chosen on the payment step, because that is where somebody is
// already weighing what this is worth, and because making every visitor pick
// between two products before they can even see a calendar taxes the common
// path for the sake of the rare one.
const FULL_PRICE_CENTS = 350000;
let fullCents = FULL_PRICE_CENTS;
// Whether he has room for another Full Access client at all. False closes the
// door honestly instead of taking money for work that cannot be started.
let fullOpen = true;
const money = (cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
const tierCents = () => (state.tier === 'full' ? fullCents : caseCents);

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
};

const state = {
  tier: 'case', // 'case' | 'full' — chosen on the payment step
  acks: {}, // formId -> ms timestamp, captured the moment the box is ticked
  read: {}, // formId -> true once a body has been opened and read to the end
  slot: null, // { id, start: Date, durationMin }
  requestedStart: null, // Date — a time asked for that isn't on the calendar
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
    if (r && Number(r.fullCents) > 0) fullCents = Number(r.fullCents);
    if (r && r.fullOpen === false) fullOpen = false;
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

// ---- Step 1: Your time ----

async function renderTime() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';
  const today = new Date().toISOString().slice(0, 10);
  const el = mount(`
    <h2>When should we talk?</h2>
    <p class="muted small">All times are shown in <strong>your</strong> time zone (${zone.replace(/_/g, ' ')}), with my MST time underneath. Appointments must be at least 72 hours out.</p>
    <div id="days"><p class="muted">Loading available times…</p></div>

    <details id="request-box" style="margin-top:1rem;">
      <summary class="btn quiet" style="cursor:pointer;">
        None of these work? Request a time →
      </summary>
      <div class="card" style="margin-top:.7rem;">
        <p class="muted small" style="margin-top:0;">Choose any date and time that works for you. I will review the request and confirm it before the appointment. Times are shown in your time zone.</p>
        <label for="req-date">Date</label>
        <input type="date" id="req-date">
        <label for="req-time" style="margin-top:.6rem;">Time</label>
        <input type="time" id="req-time" step="900">
        <p class="muted small" id="req-mst" style="margin:.6rem 0 0;">Choose a date and time below; the app will handle the time-zone conversion.</p>
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
      <label for="phone">Best phone number for the call</label>
      <input type="tel" id="phone" placeholder="+1 555 555 5555" value="${state.phone}">
    </div>
    <p class="muted small" id="video-note" ${state.method === 'video' ? '' : 'hidden'} style="margin-top:.7rem;">
      I'll send you a join link before the call, and it appears on your case page too. Nothing to install.
    </p>
    <p class="error" id="method-error" hidden></p>
    ${needsProfile() ? `
    <div class="card" id="profile-block">
      <h3>Who am I working with?</h3>
      <p class="muted small">Please use your real name so I know whose case I am reviewing. Your information stays private, like the rest of your case file.</p>
      <label for="pf-first">First name</label>
      <input type="text" id="pf-first" autocomplete="given-name" value="${esc(profile.firstName || '')}">
      <label for="pf-last" style="margin-top:.6rem;">Last name</label>
      <input type="text" id="pf-last" autocomplete="family-name" value="${esc(profile.lastName || '')}">
      <label for="pf-dob" style="margin-top:.6rem;">Date of birth</label>
      <input type="date" id="pf-dob" max="${today}" value="${esc(profile.dob || '')}">
      <p class="muted small" style="margin-top:.6rem;">Pocket Advocate serves adults. If the client is under 18,
        a parent or guardian needs to reach out first, through the site or the About page's call button.</p>
      <p class="error" id="pf-err" hidden></p>
    </div>` : ''}
    <p>
      <a class="btn quiet" href="/">← Back</a>
      <button class="btn glow" id="continue" disabled>Continue</button>
    </p>`);

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
      '<p class="muted">No appointments are open right now. I add new availability regularly, so check back soon.</p>';
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
    })
  );

  el.querySelector('#continue').addEventListener('click', async () => {
    if (!state.slot && !state.requestedStart) return;
    const err = el.querySelector('#method-error');
    err.hidden = true;
    if (state.requestedStart) {
      const reqErr = el.querySelector('#req-error');
      reqErr.hidden = true;
      const lead = state.requestedStart.getTime() - Date.now();
      if (lead < LEAD_TIME_MS) {
        reqErr.textContent = 'Please choose a time at least 72 hours from now.';
        reqErr.hidden = false;
        return;
      }
      if (lead > MAX_LEAD_MS) {
        reqErr.textContent = 'Please choose a time within the next 10 days.';
        reqErr.hidden = false;
        return;
      }
    }
    if (state.method === 'phone') {
      state.phone = el.querySelector('#phone').value.trim();
      if (!/^\+?[\d\s().-]{7,20}$/.test(state.phone)) {
        err.textContent = 'Enter a valid phone number so I can reach you for the call.';
        err.hidden = false;
        return;
      }
    }
    // Name + DOB before money moves. The save must land before the pay call
    // because the Worker re-checks the profile at checkout. Same strings and
    // setDoc shape as profile.js's ensureFullProfile.
    if (needsProfile()) {
      const pfErr = el.querySelector('#pf-err');
      const firstName = el.querySelector('#pf-first').value.trim();
      const lastName = el.querySelector('#pf-last').value.trim();
      const dob = el.querySelector('#pf-dob').value;
      pfErr.hidden = true;
      if (!firstName || !lastName) {
        pfErr.textContent = 'First and last name, please, so I know whose case I am reviewing.';
        pfErr.hidden = false;
        return;
      }
      const age = ageFromDob(dob);
      if (age === null) {
        pfErr.textContent = 'Enter your date of birth.';
        pfErr.hidden = false;
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
        pfErr.textContent = `Couldn't save: ${e.message}`;
        pfErr.hidden = false;
        return;
      }
    }
    next();
  });
}

// ---- Step 2: One agreement ----

function renderAgreement() {
  const el = mount(`
    <h2>One agreement, three short parts</h2>
    <p class="muted small">Open each part and read it through. Once you have reached the end of all three, you can acknowledge the agreement.</p>
    ${WAIVERS.map(
      (w) => `
      <details class="agreement" data-id="${w.id}">
        <summary>
          <span class="agreement-title">${esc(w.title)}</span>
          <span class="agreement-plain">${AGREEMENT_PLAIN[w.id] || ''}</span>
        </summary>
        <div class="agreement-body">${w.body}</div>
        <label class="agreement-check"><input type="checkbox" ${state.acks[w.id] ? 'checked' : ''} ${state.acks[w.id] || state.read[w.id] ? '' : 'disabled'}> I have read and acknowledge this</label>
      </details>`
    ).join('')}
    <p>
      <button class="btn quiet" id="back">Back</button>
      <button class="btn glow" id="continue" ${WAIVERS.every((w) => state.acks[w.id]) ? '' : 'disabled'}>Continue</button>
    </p>`);

  const continueBtn = el.querySelector('#continue');
  const syncContinue = () => {
    continueBtn.disabled = !WAIVERS.every((w) => state.acks[w.id]);
  };

  el.querySelectorAll('details.agreement').forEach((d) => {
    const id = d.dataset.id;
    const body = d.querySelector('.agreement-body');
    const box = d.querySelector('.agreement-check input');
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
    body.addEventListener('scroll', checkScrolled);
    d.addEventListener('toggle', () => {
      if (d.open) requestAnimationFrame(checkScrolled);
    });
    box.addEventListener('change', () => {
      // The ack timestamp is the moment the box is ticked (the Worker stores
      // these). Unticking withdraws it.
      if (box.checked) state.acks[id] = Date.now();
      else delete state.acks[id];
      syncContinue();
    });
  });

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
    <div class="card">
      <div class="row"><h3>Advocacy Case</h3></div>
      <p class="muted small">
        <strong style="color:var(--ink)">${localLong.format(when)}</strong> (your time)<br>
        ${mtFmt.format(when)} MST my time<br>
        ${methodLabel} · Private session${isRequest ? ' · <span style="color:var(--orange)">Time requested. Awaiting confirmation.</span>' : ''}
      </p>
    </div>
    ${isRequest ? `<p class="notice-box pending">
      <strong>This time is a request.</strong> It isn't on my calendar yet. Your case opens and
      your payment is taken as normal, and I'll confirm this time, or offer you the nearest one
      that works, before the date. Nothing is lost either way.
    </p>` : ''}
    <div class="tier-pick" role="group" aria-label="What you are buying">
      <button type="button" class="tier-card${state.tier === 'case' ? ' on' : ''}" data-tier="case"
        aria-pressed="${state.tier === 'case'}">
        <span class="tier-name">Advocacy Case</span>
        <span class="tier-price" data-tier-price-case>$${money(caseCents)}</span>
        <span class="tier-what">I read everything, we talk it through, and you get a written report to carry to your own doctors.</span>
      </button>
      <button type="button" class="tier-card${state.tier === 'full' ? ' on' : ''}" data-tier="full"
        aria-pressed="${state.tier === 'full'}"${fullOpen ? '' : ' disabled'}>
        <span class="tier-name">Full Access</span>
        <span class="tier-price" data-tier-price-full>$${money(fullCents)}</span>
        <span class="tier-what">${fullOpen
          ? 'Everything above, and I deal with your clinics and your insurer myself, including writing and filing your appeals.'
          : 'I am at capacity for this right now and cannot take another one honestly. Book a case and ask me about it; I will tell you when a place opens.'}</span>
      </button>
    </div>
    <details class="agreement" data-id="${FULL_ACCESS_TERMS.id}" data-full-terms hidden>
      <summary>
        <span class="agreement-title">${esc(FULL_ACCESS_TERMS.title)}</span>
        <span class="agreement-plain">${FULL_ACCESS_PLAIN}</span>
      </summary>
      <div class="agreement-body">${FULL_ACCESS_TERMS.body}</div>
      <label class="agreement-check"><input type="checkbox" ${state.acks[FULL_ACCESS_TERMS.id] ? 'checked' : ''} ${state.acks[FULL_ACCESS_TERMS.id] || state.read[FULL_ACCESS_TERMS.id] ? '' : 'disabled'}> I have read and acknowledge this</label>
    </details>
    <div class="price-line">
      <span class="included" data-included>This includes our call and your written report within 7 days.</span>
    </div>
    <p class="muted small">${isRequest ? 'Requested times are not held while you complete payment.' : 'Your selected time is held while you complete payment.'} You'll be taken to Stripe's secure checkout, so card details never touch this site. Case fees are non-refundable once your slot is booked. If I reschedule you more than once, you're entitled to a full refund on request.</p>
    <p class="error" id="pay-error" hidden></p>
    <p>
      <button class="btn quiet" id="back">Back</button>
      <button class="btn glow" id="pay">Pay $${money(tierCents())} and book</button>
    </p>`);

  el.querySelector('#back').addEventListener('click', back);

  // Which service, and the extra agreement Full Access needs. The scope note
  // uses the same proof-of-exposure gate as the three standing agreements:
  // opened AND scrolled to the end before the box can be ticked. A tier this
  // size should not be buyable by anyone who has not seen where it stops.
  const payBtn = el.querySelector('#pay');
  const includedEl = el.querySelector('[data-included]');
  const terms = el.querySelector('[data-full-terms]');
  const termsBox = terms.querySelector('.agreement-check input');
  const termsBody = terms.querySelector('.agreement-body');

  const syncTier = () => {
    const full = state.tier === 'full';
    terms.hidden = !full;
    if (!full) terms.open = false;
    includedEl.textContent = full
      ? 'Everything in a case, plus the records, the calls with your clinics, and your appeals.'
      : 'This includes our call and your written report within 7 days.';
    payBtn.textContent = `Pay $${money(tierCents())} and book`;
    payBtn.disabled = full && !state.acks[FULL_ACCESS_TERMS.id];
    // The cards carry the only visible prices now, so they have to be
    // repainted here too: a rate-changed 409 moves both numbers, and a card
    // still showing the old one is the exact mismatch the handshake exists
    // to prevent.
    const caseEl = el.querySelector('[data-tier-price-case]');
    const fullEl = el.querySelector('[data-tier-price-full]');
    if (caseEl) caseEl.textContent = `$${money(caseCents)}`;
    if (fullEl) fullEl.textContent = `$${money(fullCents)}`;
    for (const card of el.querySelectorAll('[data-tier]')) {
      const on = card.dataset.tier === state.tier;
      card.classList.toggle('on', on);
      card.setAttribute('aria-pressed', String(on));
    }
  };

  for (const card of el.querySelectorAll('[data-tier]')) {
    card.addEventListener('click', () => {
      if (card.disabled) return;
      state.tier = card.dataset.tier;
      syncTier();
    });
  }

  const checkTermsScrolled = () => {
    if (!terms.open) return;
    if (termsBody.scrollTop + termsBody.clientHeight >= termsBody.scrollHeight - 8) {
      state.read[FULL_ACCESS_TERMS.id] = true;
      termsBox.disabled = false;
    }
  };
  termsBody.addEventListener('scroll', checkTermsScrolled);
  terms.addEventListener('toggle', () => {
    if (terms.open) requestAnimationFrame(checkTermsScrolled);
  });
  termsBox.addEventListener('change', () => {
    if (termsBox.checked) state.acks[FULL_ACCESS_TERMS.id] = Date.now();
    else delete state.acks[FULL_ACCESS_TERMS.id];
    syncTier();
  });
  syncTier();

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
          tier: state.tier,
          // What this screen is showing. If the rate moved between the page
          // loading and this button being pressed, the Worker refuses rather
          // than charging a number nobody agreed to.
          quotedCents: tierCents(),
          // So emails can speak the client's local time (Eric, 2026-07-15).
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.error === 'rate-changed' && Number(data.caseCents) > 0) {
        // Update the number and hand the button back. No explanation: the
        // price is what it is, and why it changed is nobody's business.
        caseCents = Number(data.caseCents);
        if (Number(data.fullCents) > 0) fullCents = Number(data.fullCents);
        syncTier();
        payBtn.disabled = false;
        return;
      }
      // He is full. Say so plainly, put them back on the standard case, and
      // do not pretend the button will work if they press it again.
      if (res.status === 409 && data.error === 'full-booked') {
        fullOpen = false;
        state.tier = 'case';
        delete state.acks[FULL_ACCESS_TERMS.id];
        const card = el.querySelector('[data-tier="full"]');
        if (card) {
          card.disabled = true;
          card.querySelector('.tier-what').textContent =
            'Someone took the last place while you were reading. Book a case and ask me about it; I will tell you when one opens.';
        }
        syncTier();
        payBtn.disabled = false;
        errEl.textContent = 'Full Access just filled up. Your case is still here at the standard price.';
        errEl.hidden = false;
        return;
      }
      if (!res.ok) throw new Error(data.error || `Checkout failed (${res.status})`);
      location.href = data.url;
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      payBtn.disabled = false;
    }
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
