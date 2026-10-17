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
import { FULL_ACCESS_TERMS, FULL_ACCESS_PLAIN } from './tier-terms.js';

// The fallback price, and only the fallback. The real one lives in the Worker
// and moves on its own: every completed booking lifts it, so a number compiled
// into this file is wrong the moment somebody else books. It is still here
// because a rate fetch that fails should show a real price rather than a
// blank, and at deploy time this IS the price.
//
// Booking buys one thing (Eric, 2026-08-20). The follow-up used to be a
// checkbox on this screen; it is sold from the case after the report lands
// instead, so this step is a single price and a single decision.
const CASE_PRICE_CENTS = 210000;
// Filled from /api/rates before the payment step renders, and again if the
// Worker refuses a stale quote.
let caseCents = CASE_PRICE_CENTS;
// This page sells ONE service (Eric, 2026-08-25: "Advocacy case and direct
// line are bookable. The others are ADD-ONS."). Full-Service Case Management is
// bought from inside an open case at the difference; no tier price is
// compiled into this file any more.
// Thousands separated, because the case price crossed $1,000 in the 2026-08-26
// recalibration and "$1200" on a payment button reads like a typo.
// FROM CHAT (Eric, 2026-10-17: "From chat, they can enhance to advocacy case
// or full case management and just pay the month's difference"; "Credit $50,
// end chat"). /book.html?step=case or ?step=full from the chat page. The
// Worker says whether this subscriber has the credit and what each costs with
// it; without it the page is the ordinary booking.
const STEP = /^(case|full)$/.test(new URLSearchParams(location.search).get('step') || '') ? new URLSearchParams(location.search).get('step') : '';
let stepUp = null; // { eligible, creditCents, caseCents, fullCents }
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
  requestedStart: null, // Date — a time asked for that isn't on the calendar
  method: 'phone',
  phone: '',
  address: '', // home address, optional (Eric, 2026-09-03)
  invite: null, // { start: Date, priceCents, name } once the Worker has read his invitation
  advocate: null, // { name } on a contractor's own calendar
  service: null, // { id, label, about, cents } when buying one of a contractor's own services
};

const STEPS = [
  { label: 'Your time', render: renderTime },
  { label: 'One agreement', render: renderAgreement },
  { label: 'Payment', render: renderPayment },
];

let stepIndex = 0;
let user = null;
let profile = {}; // users/{uid} data: read at init, updated by the inline save

// SCHEDULED FROM A LEAD (Eric, 2026-10-15: "Once a lead is scheduled they are
// prompted to fill out the forms and confirm the time and date."). The link in
// his email is /book.html?invite=<id>: one time, one price, set by him. Step 1
// shows that time instead of the calendar; the details, the agreement and the
// confirm are the same as any booking, and the Worker checks all of it again.
const INVITE_ID = (() => {
  const v = new URLSearchParams(location.search).get('invite') || '';
  return /^[\w-]{6,64}$/.test(v) ? v : '';
})();

// A CONTRACTOR'S OWN CALENDAR (Eric, 2026-10-17: their available hours are
// "where clients can see they can be booked"). /book.html?advocate=<uid>: the
// times come from their hours, less the buffer around their paid
// appointments (/api/advocate-times), at their own price. The rest of the
// booking is the same; the case is theirs.
const ADVOCATE = (() => {
  const v = new URLSearchParams(location.search).get('advocate') || '';
  return !INVITE_ID && /^[\w-]{1,64}$/.test(v) ? v : '';
})();
// A CONTRACTOR'S OWN SERVICE (Eric, 2026-10-17: "Opens a case, no time").
// /book.html?advocate=<uid>&service=<id>: no time to pick; the details, the
// agreement and the card hold are the same as any booking, and the case it
// opens is theirs, planned together in the case chat.
const SERVICE = (() => {
  const v = new URLSearchParams(location.search).get('service') || '';
  return ADVOCATE && /^s[a-z0-9]{8}$/.test(v) ? v : '';
})();
if (SERVICE) STEPS[0].label = 'Your details';
/** Their first name once their times have loaded. */
const advFirst = () => String(state.advocate?.name || '').split(/\s+/)[0] || 'Your advocate';
// Their prices and what they offer, asked once (2026-10-17: their own chat line too).
let advRatesP = null;
const advRates = () => (advRatesP ||= fetch(`/api/rates?advocate=${encodeURIComponent(ADVOCATE)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null));

/** Their name: from their times when those came back, else asked for (a closed calendar does not carry it). */
async function advName() {
  return state.advocate?.name || fetch(`/api/advocates/name?uid=${encodeURIComponent(ADVOCATE)}`)
    .then((x) => (x.ok ? x.json() : null)).then((d) => String(d?.name || '').trim()).catch(() => '');
}

/**
 * Their own services (2026-10-17), each a door to buying it: on their booking
 * page above their times, or on its own when they take no bookings right now.
 */
async function addServiceList(el) {
  const r = await advRates();
  const list = Array.isArray(r?.services) ? r.services : [];
  if (!list.length || el.querySelector('[data-adv-services]')) return;
  el.querySelector('#days')?.insertAdjacentHTML('beforebegin', `
    <div class="stack-tight" data-adv-services>
      ${list.map((x) => `<a class="card-quiet adv-svc" href="/book.html?advocate=${encodeURIComponent(ADVOCATE)}&service=${encodeURIComponent(x.id)}" data-adv-service="${esc(x.id)}">
        <strong>${esc(x.label)}</strong> <span class="muted">$${money(Number(x.cents) || 0)}${x.kind === 'month' ? ' a month' : ''}</span>
        ${x.about ? `<span class="muted small" style="display:block;">${esc(x.about)}</span>` : ''}</a>`).join('')}
    </div>`);
}

/**
 * Step 1 for one of their services: what it is, at its price, and no time to
 * pick. False when it is not on offer, with the reason in place of the step.
 */
async function showService(el) {
  const r = await advRates();
  const svc = (Array.isArray(r?.services) ? r.services : []).find((x) => x.id === SERVICE);
  const name = await advName();
  state.advocate = { name };
  const first = advFirst();
  if (!svc) {
    el.querySelector('h1').textContent = 'Not offered right now';
    el.querySelector('#days').innerHTML = `<p class="muted" data-svc-closed>That service is not offered right now. <a href="/book.html?advocate=${encodeURIComponent(ADVOCATE)}">See what ${esc(first)} offers</a>.</p>`;
    stripUnwiredStep1(el, { keepIntro: false });
    return false;
  }
  state.service = { id: svc.id, label: svc.label, about: svc.about || '', cents: Number(svc.cents) || 0, monthly: svc.kind === 'month' };
  el.querySelector('h1').textContent = svc.label;
  // A monthly one runs like Full-Service (2026-10-17, v7.75): a month at a time, and another only when both of you want it.
  el.querySelector('#time-intro').innerHTML = `${svc.about ? `${esc(svc.about)} ` : ''}With <strong>${esc(name || 'your advocate')}</strong>. There is no call time to pick: once ${esc(first)} takes it on, you plan the next step together in your case chat.${state.service.monthly ? ` It runs a month at a time, from the day ${esc(first)} takes it on. When the month ends your case closes, and you can ask for another.` : ''}`;
  el.querySelector('#days').innerHTML = `<div class="day" data-svc-pick><div class="slots"><div class="slot selected">${esc(svc.label)}, $${money(state.service.cents)}${state.service.monthly ? ' a month' : ''}</div></div></div>`;
  el.querySelector('#request-box')?.remove();
  // Their way to reach the client stays; there is no call to choose a kind of.
  el.querySelector('#chips')?.remove();
  el.querySelector('#video-note')?.remove();
  for (const h of el.querySelectorAll('h2')) if (/How should we talk/.test(h.textContent)) h.textContent = 'How to reach you';
  revealAfterTimes(el);
  el.querySelector('#continue').disabled = false;
  return true;
}

/**
 * Their own chat line, once he has turned it on (Eric, 2026-10-17: Priority
 * Chat "Yes, per contractor"): offered above their times, or on its own when
 * they take no bookings right now.
 */
async function addChatLink(el) {
  const r = await advRates();
  if (!r?.chatOffered || el.querySelector('[data-adv-chat]')) return;
  // Their name, from their times when those came back, else asked for (a closed calendar does not carry it).
  const name = await advName();
  if (el.querySelector('[data-adv-chat]')) return;
  const first = String(name || '').split(/\s+/)[0];
  const who = first ? ` with ${esc(first)}` : '';
  const price = Number(r.subCents) > 0 ? `, $${money(Number(r.subCents))} a month` : '';
  el.querySelector('#days')?.insertAdjacentHTML('beforebegin',
    `<p class="small" data-adv-chat><a href="/subscribe.html?advocate=${encodeURIComponent(ADVOCATE)}">Or start a 24/7 Priority Chat line${who}${price}</a></p>`);
}

init();

async function init() {
  hydrateNav();
  // The live rate, before anything quotes a number. A failed fetch leaves the
  // compiled-in fallback in place, which is the right price at deploy time and
  // is re-checked by the Worker before a card is ever charged.
  // A contractor's calendar quotes their price, not his.
  (ADVOCATE ? advRates() : rates()).then((r) => {
    if (r && Number(r.caseCents) > 0) caseCents = Number(r.caseCents);
  }).catch(() => {});
  drawRail(); // step 1 shows active even while the sign-in card is up
  if (new URLSearchParams(location.search).get('canceled')) {
    showError(INVITE_ID
      ? 'Checkout was canceled and nothing was charged. Your time is still set aside; confirm when you are ready.'
      : SERVICE ? 'Checkout was canceled and nothing was charged. You can try again whenever you are ready.'
        : 'Checkout was canceled, so the time you selected is no longer being held. Choose a time to try again.');
  }
  user = await currentUser();
  if (!user) {
    // Signed-out visitors sign in right here, inside step 1.
    user = await ensureSignedIn(document.getElementById('step'), { returnTo: INVITE_ID ? `/book.html?invite=${INVITE_ID}` : ADVOCATE ? `/book.html?advocate=${encodeURIComponent(ADVOCATE)}${SERVICE ? `&service=${SERVICE}` : ''}` : STEP ? `/book.html?step=${STEP}` : '/book.html' });
  }
  if (!INVITE_ID && !ADVOCATE) loadStepUp().catch(() => {});
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
  if (INVITE_ID && !(await readInvite())) return;
  render();
}

/**
 * His invitation, read for the person signed in. A link that is not theirs,
 * withdrawn, or past says why, in place of the steps; one already confirmed
 * points at the case it opened.
 */
async function readInvite() {
  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ id: INVITE_ID }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || `The invitation could not be read (${res.status}).`), { caseId: data.caseId });
    state.invite = { start: new Date(data.start), priceCents: Number(data.priceCents) || 0, name: data.name || '' };
    // Nothing is bought on the last step of an invitation: it is confirmed.
    STEPS[2].label = 'Confirm';
    return true;
  } catch (err) {
    document.getElementById('crumbs').innerHTML = '';
    mount(`
    <h1>Your invitation</h1>
    <p class="muted measure" data-invite-said>${esc(err.message)}</p>
    ${err.caseId ? `<p><a class="btn cta" href="/case.html?id=${encodeURIComponent(err.caseId)}">Open your case</a></p>` : ''}
    <p class="back-row"><a class="btn quiet pill" href="/">← Back</a></p>`);
    return false;
  }
}

/** Step 1 for an invitation: his time, set, where the calendar would be. */
function showInviteTime(el) {
  const when = state.invite.start;
  const dayFmt = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const localFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const mtFmt = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, hour: 'numeric', minute: '2-digit' });
  el.querySelector('h1').textContent = 'Your call is set';
  el.querySelector('#time-intro').textContent = 'I set this time aside for your Advocacy Case call. Fill in the rest below, read the agreement, and confirm.';
  el.querySelector('#days').innerHTML = `
      <div class="day invite-time" data-invite-time><h3>${dayFmt.format(when)}</h3><div class="slots">
        <div class="slot selected">${localFmt.format(when)}
          <span class="local">${mtFmt.format(when)} MST my time</span></div>
      </div></div>`;
  el.querySelector('#request-box')?.remove();
  revealAfterTimes(el);
  el.querySelector('#continue').disabled = false;
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
  if (!keepIntro) el.querySelector('#time-intro')?.remove();
  for (const sel of ['#chips', '#phone-row', '#video-note', '#phone-consent-row', '#method-error', '#profile-block'])
    el.querySelector(sel)?.remove();
  // h2 since 2026-08-26: the second half of step 1 is a section of the step,
  // not a sub-heading of the calendar. Both are matched so a heading level
  // that moves again cannot leave this behind.
  el.querySelectorAll('h2, h3').forEach((h) => {
    if (/How should we talk/.test(h.textContent)) h.remove();
  });
}

/**
 * The second half of step 1, which only exists once there is a time.
 *
 * Everything below the calendar - the call method, the number to ring, the
 * consent, the name and date of birth - is a decision ABOUT an appointment
 * that has not been chosen yet. Showing it all at once put fifteen things on
 * the first screen of a page whose only question is "when", and buried the
 * times themselves under a form. It stays folded until a time is picked, and
 * then it is the only thing left to do.
 */
function revealAfterTimes(el) {
  const after = el.querySelector('#after-times');
  if (!after || !after.hidden) return;
  after.hidden = false;
}

// ---- Step 1: Your time ----

async function renderTime() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'your time zone';
  const today = new Date().toISOString().slice(0, 10);
  const el = mount(`
    <h1>When should we talk?</h1>
    <p class="muted small measure" id="time-intro">All times are shown in <strong>your</strong> time zone (${zone.replace(/_/g, ' ')}), with my MST time underneath. Appointments must be at least 72 hours out.</p>
    <div id="days" class="stack-tight"><p class="muted">Loading available times…</p></div>

    <details id="request-box" class="card-quiet">
      <summary class="btn quiet pill">
        None of these work? Request a time
      </summary>
      <div class="stack-tight">
        <p class="muted small measure">Choose any date and time that works for you. I will review the request and confirm it before the appointment. Times are shown in your time zone.</p>
        <label for="req-date">Date</label>
        <input type="date" id="req-date">
        <label for="req-time">Time</label>
        <input type="time" id="req-time" step="900">
        <p class="muted small" id="req-mst">Choose a date and time below; the app will handle the time-zone conversion.</p>
        <p class="error" id="req-error" hidden></p>
      </div>
    </details>

    <!-- The hidden attribute lives on a PLAIN wrapper and .stack on the box
         inside it. .stack lays out with gap, which means display:flex, and a
         class selector beats the user-agent rule that makes hidden work, so
         .stack and hidden on the same element would have quietly un-hidden
         this whole half of the step the day the stylesheet landed. -->
    <div id="after-times" hidden>
    <div class="stack">
    <hr class="divide">
    <h2>How should we talk?</h2>
    <div id="chips">
      <label class="chip-label pill ${state.method === 'phone' ? 'selected' : ''}">
        <input type="radio" name="method" value="phone" hidden ${state.method === 'phone' ? 'checked' : ''}>
        Phone call
      </label>
      <label class="chip-label pill ${state.method === 'video' ? 'selected' : ''}">
        <input type="radio" name="method" value="video" hidden ${state.method === 'video' ? 'checked' : ''}>
        Video call
      </label>
    </div>
    <!-- Asked for on every booking, video included (Eric, 2026-09-03: the
         client's phone and home address belong on his overview card). The
         consent tick below already promises he may call; this is the number
         it was missing. The address is optional. -->
    <div id="phone-row">
      <label for="phone">Best number to reach you</label>
      <input type="tel" id="phone" autocomplete="tel" placeholder="+1 555 555 5555" value="${state.phone}">
    </div>
    <div id="address-row">
      <label for="address">Home address <span class="muted">(optional)</span></label>
      <input type="text" id="address" maxlength="300" autocomplete="street-address"
        placeholder="Street, city, state, ZIP" value="${state.address.replace(/"/g, '&quot;')}">
      <p class="muted small measure">For records requests and anything I mail you.</p>
    </div>
    <p class="muted small measure" id="video-note" ${state.method === 'video' ? '' : 'hidden'}>
      I'll send you a join link before the call, and it appears on your case page too. Nothing to install.
    </p>
    <label class="agreement-check" id="phone-consent-row">
      <input type="checkbox" id="phone-consent" ${state.acks.phoneConsent ? 'checked' : ''}>
      You may contact me by phone between sessions for continuity of care. <span style="color:var(--magenta)">*</span>
    </label>
    <p class="error" id="method-error" hidden></p>
    ${needsProfile() ? `
    <div class="card stack-tight" id="profile-block">
      <h2>Who am I working with?</h2>
      <p class="muted small measure">Please use your real name so I know whose case I am reviewing. Your information stays private, like the rest of your case file.</p>
      <label for="pf-first">First name</label>
      <input type="text" id="pf-first" autocomplete="given-name" value="${esc(profile.firstName || '')}">
      <label for="pf-last">Last name</label>
      <input type="text" id="pf-last" autocomplete="family-name" value="${esc(profile.lastName || '')}">
      <label for="pf-dob">Date of birth</label>
      <input type="date" id="pf-dob" max="${today}" value="${esc(profile.dob || '')}">
      <p class="muted small measure">Pocket Advocate serves adults. If the client is under 18,
        a parent or guardian needs to reach out first, through the site or the About page's call button.</p>
      <p class="error" id="pf-err" hidden></p>
    </div>` : ''}
    <button class="btn cta" id="continue" disabled>Continue</button>
    </div>
    </div>
    <p class="back-row"><a class="btn quiet pill" href="/">← Back</a></p>`);

  // An invitation: the time is his, already set. No calendar, no request;
  // the rest of step 1 is the same as every booking, wired the same way.
  if (state.invite) {
    showInviteTime(el);
    wireStep1(el);
    return;
  }
  if (SERVICE) {
    if (await showService(el)) wireStep1(el);
    return;
  }
  if (ADVOCATE) {
    await renderAdvocateTimes(el, zone);
    return;
  }

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
      // A free-call slot is fifteen minutes he opened for a fit call
      // (fit.js); it is not an hour to sell. The Worker refuses it at
      // checkout too, so this is the courtesy half.
      if (data.kind === 'fit') return;
      // A contractor's time is never his (2026-10-17); it is never left open either.
      if (data.fromHours) return;
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
  // HIS BUFFER (Eric, 2026-10-17: "A scheduled time automatically blocks off 3
  // hours before and after around the appointment"): an open time inside it is
  // left out. The courtesy half: the Worker refuses one at checkout anyway.
  try {
    const r = await fetch('/api/slots/buffered?kind=case');
    const blocked = r.ok ? (await r.json()).blocked || [] : [];
    if (blocked.length) slots = slots.filter((s) => !blocked.includes(s.id));
  } catch { /* the Worker still refuses a time inside the buffer */ }
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

  drawDays(el, slots);
  // ---- request a time that isn't on the calendar ----
  wireRequest(el, closedUntil);
  wireStep1(el);
}

/**
 * A contractor's calendar: their open times, their name over them, no
 * request box (their hours are the offer). Prices and the rest are the same.
 */
async function renderAdvocateTimes(el, zone) {
  el.querySelector('#request-box')?.remove();
  const daysEl = el.querySelector('#days');
  let got = {};
  try {
    const res = await fetch(`/api/advocate-times?advocate=${encodeURIComponent(ADVOCATE)}`);
    got = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(got.error || 'That calendar is not open for booking.');
  } catch (err) {
    daysEl.innerHTML = `<p class="muted" data-adv-closed>${esc(err.message)}</p>`;
    stripUnwiredStep1(el, { keepIntro: false });
    addChatLink(el).catch(() => {});
    addServiceList(el).catch(() => {});
    return;
  }
  state.advocate = { name: String(got.name || '') };
  addChatLink(el).catch(() => {});
  addServiceList(el).catch(() => {});
  el.querySelector('#time-intro').innerHTML = `<span class="adv-who" data-adv-who><img src="/api/advocates/headshot?uid=${encodeURIComponent(ADVOCATE)}" alt="" width="44" height="44" onerror="this.remove()"><span>With <strong>${esc(state.advocate.name || 'your advocate')}</strong>.</span></span>
    All times are shown in <strong>your</strong> time zone (${esc(zone.replace(/_/g, ' '))}). Appointments must be at least 72 hours out.`;
  const slots = (Array.isArray(got.times) ? got.times : [])
    .map((iso) => ({ id: iso, start: new Date(iso), durationMin: Number(got.durationMin) || 60 }))
    .filter((x) => !Number.isNaN(x.start.getTime()));
  if (!slots.length) {
    daysEl.innerHTML = `<p class="muted" data-adv-none>${esc(advFirst())} has no open times in the next week and a half. Check back soon.</p>`;
    stripUnwiredStep1(el, { keepIntro: true });
    return;
  }
  drawDays(el, slots, { mst: false });
  wireStep1(el);
}

/** The open times, a day at a time, in the client's zone; picking one reveals the rest of step 1. */
function drawDays(el, slots, { mst = true } = {}) {
  const daysEl = el.querySelector('#days');
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
              ${mst ? `<span class="local">${mtFmt.format(s.start)} MST my time</span>` : ''}
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
      revealAfterTimes(el);
    })
  );
  // Coming back from a later step: re-mark the slot they already picked.
  if (state.slot) {
    const picked = daysEl.querySelector(`.slot[data-id="${state.slot.id}"]`);
    if (picked) {
      picked.classList.add('selected');
      el.querySelector('#continue').disabled = false;
      revealAfterTimes(el);
    } else {
      state.slot = null; // it vanished while they were away
    }
  }
}

/** The request box under his calendar: any time, confirmed by hand. */
function wireRequest(el, closedUntil) {
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
    revealAfterTimes(el);
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
}

/**
 * The second half of step 1, wired: the method, the number, the consent, the
 * name and date of birth, and Continue. One function for the calendar and
 * for an invitation, so the two can never ask for different things.
 */
function wireStep1(el) {
  el.querySelectorAll('input[name=method]').forEach((input) =>
    input.addEventListener('change', () => {
      state.method = input.value;
      el.querySelectorAll('.chip-label').forEach((c) => c.classList.remove('selected'));
      input.closest('.chip-label').classList.add('selected');
      el.querySelector('#video-note').hidden = input.value !== 'video';
    })
  );

  el.querySelector('#continue').addEventListener('click', async () => {
    if (!state.slot && !state.requestedStart && !state.invite && !state.service) return;
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
    // Every booking, whatever the method (2026-09-03). The Worker holds the
    // same rule, so a stale page cannot slip past it.
    state.phone = el.querySelector('#phone').value.trim();
    if (!/^\+?[\d\s().-]{7,20}$/.test(state.phone)) {
      err.textContent = 'Enter a valid phone number so I can reach you.';
      err.hidden = false;
      return;
    }
    state.address = el.querySelector('#address')?.value.trim().slice(0, 300) || '';
    // Continuity-of-care phone consent (Eric, 2026-08-25). Required for every
    // booking, video included - he calls clients back between sessions
    // whatever the session method. Enforced by the Worker too (REQUIRED_ACKS).
    if (!state.acks.phoneConsent) {
      err.textContent = 'Tick the consent box so I can call you between sessions.';
      err.hidden = false;
      return;
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

  // The consent tick is an acknowledgment like the agreement boxes: stamped
  // the moment it happens, cleared if they untick, sent in the same acks map.
  el.querySelector('#phone-consent')?.addEventListener('change', (e) => {
    if (e.target.checked) state.acks.phoneConsent = Date.now();
    else delete state.acks.phoneConsent;
  });
}

// ---- Step 2: One agreement ----

// The three original waivers, plus the service terms added 2026-08-24. Kept
// as one list so the scroll gate, the tick boxes and the Continue button all
// count the same set - a fourth part bolted on beside them would have been a
// fourth chance to leave one unwired.
const AGREEMENT_PARTS = [...WAIVERS, SERVICE_TERMS];

function renderAgreement() {
  const el = mount(`
    <h1>One agreement, four short parts</h1>
    <p class="muted small measure">Open each part and read it through. Once you have reached the end of all four, you can acknowledge the agreement.</p>
    <div class="stack-tight">
    ${AGREEMENT_PARTS.map(
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
    </div>
    <p class="dim small" data-agree-count></p>
    <button class="btn cta" id="continue" ${AGREEMENT_PARTS.every((w) => state.acks[w.id]) ? '' : 'disabled'}>Continue</button>
    <p class="back-row"><button class="btn quiet pill" id="back">Back</button></p>`);

  const continueBtn = el.querySelector('#continue');
  const tally = el.querySelector('[data-agree-count]');
  // One number instead of four states to hold in your head. A grey Continue
  // with no explanation is the most abandonable moment in the flow, and the
  // reason it is grey was previously invisible.
  const syncContinue = () => {
    const done = AGREEMENT_PARTS.filter((w) => state.acks[w.id]).length;
    continueBtn.disabled = done < AGREEMENT_PARTS.length;
    tally.textContent = done === AGREEMENT_PARTS.length
      ? `All ${AGREEMENT_PARTS.length} parts acknowledged.`
      : `${done} of ${AGREEMENT_PARTS.length} parts acknowledged.`;
  };
  syncContinue();

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

/**
 * The last step for one of their own services (2026-10-17): its name and
 * price, the card held until they take it on, and no time. Its own route,
 * /api/service-checkout, checks all of it again.
 */
function renderServicePayment() {
  const svc = state.service;
  const el = mount(`
    <h1>Lock it in</h1>
    <section class="stack-tight">
      <p class="price-line">
        <span class="eyebrow" data-svc-name>${esc(svc.label)}</span>
        <span class="price" data-case-price>$${money(svc.cents)}</span>${svc.monthly ? ' <span class="muted" data-svc-month>for one month</span>' : ''}
        ${svc.about ? `<span class="included" data-included>${esc(svc.about)}</span>` : ''}
      </p>
      <p class="muted small">With ${esc(state.advocate?.name || 'your advocate')}<br>
        No call time: you plan the next step together in your case chat.<br>
        ${svc.monthly ? 'A month at a time: your month starts the day your case is taken on.<br>' : ''}
        We reach you at ${esc(state.phone)}</p>
    </section>
    <p class="error" id="pay-error" hidden></p>
    <button class="btn cta" id="pay">Pay $${money(svc.cents)} and book</button>
    <p class="muted small measure" data-hold-line-svc>Your card is held today, not charged. ${esc(advFirst())} reads every new case before taking it on, and you are charged only when your case is taken. If it cannot be, the hold is released and nothing is charged.</p>
    <p class="muted small measure">You'll be taken to Stripe's secure checkout, so card details never touch this site. Fees are non-refundable once your case is taken.</p>
    <p class="back-row"><button class="btn quiet pill" id="back">Back</button></p>`);
  el.querySelector('#back').addEventListener('click', back);
  const payBtn = el.querySelector('#pay');
  payBtn.addEventListener('click', async () => {
    const errEl = el.querySelector('#pay-error');
    payBtn.disabled = true;
    errEl.hidden = true;
    try {
      const res = await fetch('/api/service-checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${await user.getIdToken()}` },
        body: JSON.stringify({
          advocate: ADVOCATE, service: svc.id, quotedCents: svc.cents,
          method: state.method, phone: state.phone, address: state.address, acks: state.acks,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        }),
      });
      const data = await res.json().catch(() => ({}));
      // Their price moved since the page loaded: show the new one and hand the button back.
      if (res.status === 409 && data.error === 'rate-changed' && Number(data.priceCents) > 0) {
        svc.cents = Number(data.priceCents);
        el.querySelector('[data-case-price]').textContent = `$${money(svc.cents)}`;
        payBtn.textContent = `Pay $${money(svc.cents)} and book`;
        errEl.textContent = `The price is now $${money(svc.cents)}. Tap Pay again to go ahead.`;
        errEl.hidden = false;
        payBtn.disabled = false;
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

function renderPayment() {
  if (state.service) return renderServicePayment();
  const localLong = new Intl.DateTimeFormat('en-US', {
    weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const methodLabel = state.method === 'phone' ? `Phone call to ${state.phone}` : ADVOCATE ? 'Video call (you\'ll get the link)' : 'Video call (I\'ll send the link)';
  const invite = state.invite;
  const when = invite ? invite.start : state.slot ? state.slot.start : state.requestedStart;
  const isRequest = !invite && !state.slot && !!state.requestedStart;

  // ONE lit thing, not three stacked ones. The service, the time and the
  // price were a heading, a bordered card and a bordered price strip in a
  // row, all at the same weight, so nothing on the screen said "this is what
  // you are buying". The price block is the one lit surface now, the time
  // sits under it as plain text, and the button below is the only other
  // control above the fold. (A card around the price box put a box inside a
  // box, which is the same flattening in a different shape.)
  const el = mount(`
    <h1>Lock it in</h1>
    <section class="stack-tight">
      <p class="price-line">
        <span class="eyebrow">${stepFull() ? 'Full-Service Case Management, first month' : 'Advocacy Case'}</span>
        <span class="price" data-case-price>${invite && !invite.priceCents ? 'No charge' : `$${money(invite ? invite.priceCents : shownCents())}`}</span>
        <span class="included" data-included>${stepFull()
    ? 'Up to 20 hours of advocacy in the month, from our first call. No written report: the work replaces it.'
    : 'This includes our call and your written report within 14 days.'}</span>
      </p>
      ${!invite && stepUp ? `<p class="muted small measure" data-step-credit>Your $${money(stepUp.creditCents)} chat month comes off. Once I take your case your chat line stops renewing, and the case chat takes over.</p>` : ''}
      <p class="muted small">
        <strong style="color:var(--ink)">${localLong.format(when)}</strong> (your time)<br>
        ${ADVOCATE ? `With ${esc(state.advocate?.name || 'your advocate')}` : `${mtFmt.format(when)} MST my time`}<br>
        ${methodLabel} · Private session${isRequest ? ' · <span style="color:var(--orange)">Time requested. Awaiting confirmation.</span>' : ''}
      </p>
    </section>
    ${isRequest ? `<p class="notice-box pending">
      <strong>This time is a request.</strong> It isn't on my calendar yet. Your case opens and
      your card is held as normal, and I'll confirm this time, or offer you the nearest one
      that works, before the date. Nothing is lost either way.
    </p>` : ''}
    ${stepFull() ? `
    <details class="agreement" data-id="${esc(FULL_ACCESS_TERMS.id)}">
      <summary>
        <span class="agreement-title">${esc(FULL_ACCESS_TERMS.title)}</span>
        <span class="agreement-plain">${esc(FULL_ACCESS_PLAIN)}</span>
      </summary>
      <div class="agreement-body">${FULL_ACCESS_TERMS.body}</div>
      <label class="agreement-check"><input type="checkbox" data-step-ack disabled> I have read and acknowledge this</label>
    </details>` : ''}
    <p class="error" id="pay-error" hidden></p>
    <button class="btn cta" id="pay">${invite ? 'Confirm' : `Book, $${money(shownCents())} held`}</button>
    <!-- THE HOLD (Eric, 2026-09-06): the card is held today and charged only
         when he takes the case. Said before the button is pressed, in the
         same words the case page and the mail use. -->
    ${invite ? `<p class="muted small measure" data-invite-line>${invite.priceCents
    ? 'Your card is charged when you confirm, through Stripe\'s secure checkout, so card details never touch this site.'
    : 'There is nothing to pay. Confirming opens your case.'}</p>` : ADVOCATE ? `<p class="muted small measure" data-hold-line-theirs>Your card is held today, not charged. ${esc(advFirst())} reads every new case before taking it on, and you are charged only when your case is taken. If it cannot be, the hold is released and nothing is charged.</p>` : `<p class="muted small measure" data-hold-line>Your card is held today, not charged. I read every new case before I take it on, and you are charged only when I do. If I cannot take your case, the hold is released and nothing is charged.</p>`}
    <!-- The terms sit under the button rather than over it. They are what
         pressing it agrees to, they are still on screen before any card is,
         and above it they were a paragraph of small print standing between a
         person and the only thing this step is for. -->
    ${invite ? '<p class="muted small measure">This time is set aside for you. If I reschedule you more than once, you\'re entitled to a full refund on request.</p>' : ''}
    <p class="muted small measure"${invite ? ' hidden' : ''}>${isRequest ? 'Requested times are not held while you complete checkout.' : 'Your selected time is held while you complete checkout.'} You'll be taken to Stripe's secure checkout, so card details never touch this site. ${ADVOCATE ? 'Case fees are non-refundable once your case is taken. If your time is moved more than once, you\'re entitled to a full refund on request.' : 'Case fees are non-refundable once I have taken your case. If I reschedule you more than once, you\'re entitled to a full refund on request.'}</p>
    <!-- Nothing in here is decided today, so it is context for after the
         decision, not a fourth thing competing with it. -->
    <details class="faq card-quiet" id="addons-preview">
      <summary>Case Enhancements, once your case starts</summary>
      <div class="faq-a">
        <p class="muted small" style="margin:.3rem 0 .5rem;">Nothing to decide
          now, and nothing here is charged today. Once your case is open,
          these are available from the Case Enhancements tab on your case page
          whenever you want them:</p>
        <p class="muted small" style="margin:0 0 .35rem;"><strong style="color:var(--ink)">Full-Service Case Management</strong><br>
          I take over the legwork, a month at a time: up to 20 hours of
          comprehensive advocacy each 30-day service period, with priority
          access throughout. Check-in calls at least twice a month and calls to
          your clinics and insurer on your behalf, all from those hours.
          Writing an insurance appeal and coming to an appointment with you
          are enhancements on top. Most cases take about two months, and every
          month after the first is your choice, not a commitment. Asked for
          before your written report, your case fee comes off the first month
          and Full-Service replaces the report.</p>
        <p class="muted small" style="margin:0 0 .35rem;"><strong style="color:var(--ink)">Follow-up session · $<span data-rate="addon">325</span></strong><br>
          A second full discussion on the same case after your report lands. Same case, same file, no starting over.</p>
        <p class="muted small" style="margin:0;"><strong style="color:var(--ink)">Telehealth appointment advocacy · $<span data-rate="tele">525</span></strong><br>
          I join a telehealth visit with one of your own providers by video and advocate live. I confirm every appointment personally; your card is held, not charged, until I do, and if I can't attend or your provider doesn't allow it, nothing is charged. On Full-Service it is an enhancement at your advocate's price.</p>
      </div>
    </details>
    <p class="back-row"><button class="btn quiet pill" id="back">Back</button></p>`);

  el.querySelector('#back').addEventListener('click', back);

  // One service on this screen now (Eric, 2026-08-25: "Advocacy case and
  // direct line are bookable. The others are ADD-ONS."). Full-Service Case
  // Management is bought from inside an open case, at the difference, behind
  // its own scope-note gate there - the tier picker and its agreement left
  // with the second service.
  const payBtn = el.querySelector('#pay');
  const repaintPrice = () => {
    const p = el.querySelector('[data-case-price]');
    if (invite) {
      payBtn.textContent = invite.priceCents ? `Confirm and pay $${money(invite.priceCents)}` : 'Confirm my time';
      return;
    }
    if (p) p.textContent = `$${money(shownCents())}`;
    payBtn.textContent = `Pay $${money(shownCents())} and book`;
  };
  repaintPrice();
  // The scope note gates a Full-Service month from chat the way it gates the
  // upgrade (case.js): opened and read to its end, ticked, then the button.
  let stepAckAt = 0;
  {
    const det = el.querySelector('details.agreement');
    const body = det?.querySelector('.agreement-body');
    const box = el.querySelector('[data-step-ack]');
    if (det && body && box) {
      payBtn.disabled = true;
      const checkScrolled = () => { if (det.open && body.scrollTop + body.clientHeight >= body.scrollHeight - 8) box.disabled = false; };
      body.addEventListener('scroll', checkScrolled);
      det.addEventListener('toggle', () => { if (det.open) requestAnimationFrame(checkScrolled); });
      box.addEventListener('change', () => { stepAckAt = box.checked ? Date.now() : 0; payBtn.disabled = !stepAckAt; });
    }
  }

  el.querySelector('#pay').addEventListener('click', async () => {
    const errEl = el.querySelector('#pay-error');
    payBtn.disabled = true;
    errEl.hidden = true;
    try {
      const idToken = await user.getIdToken();
      if (invite) {
        // His invitation: the time and the price are his, so the Worker reads
        // them off the invitation and takes only what this person gave.
        const res = await fetch('/api/invite/confirm', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            id: INVITE_ID, method: state.method, phone: state.phone, address: state.address, acks: state.acks,
            tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Could not confirm (${res.status})`);
        location.href = data.url || `/case.html?id=${encodeURIComponent(data.caseId || '')}`;
        return;
      }
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          // A contractor's time is not a slot yet: their uid and the time, checked again by the Worker.
          ...(ADVOCATE && state.slot ? { advocate: ADVOCATE, start: state.slot.start.toISOString() } : {}),
          slotId: state.slot && !ADVOCATE ? state.slot.id : undefined,
          requestedStart: state.requestedStart ? state.requestedStart.toISOString() : undefined,
          method: state.method,
          phone: state.phone,
          address: state.address,
          acks: stepFull() ? { ...state.acks, [FULL_ACCESS_TERMS.id]: stepAckAt } : state.acks,
          ...(stepFull() ? { tier: 'full' } : {}),
          // What this screen is showing. If the rate moved between the page
          // loading and this button being pressed, the Worker refuses rather
          // than charging a number nobody agreed to.
          quotedCents: shownCents(),
          // So emails can speak the client's local time (Eric, 2026-07-15).
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
        }),
      });
      const data = await res.json();
      if (res.status === 409 && data.error === 'rate-changed' && Number(data.caseCents) > 0) {
        // Update the number and hand the button back. No explanation: the
        // price is what it is, and why it changed is nobody's business.
        caseCents = Number(data.caseCents);
        // From chat, the credited figures again, from the Worker.
        if (stepUp) await loadStepUp().catch(() => {});
        repaintPrice();
        payBtn.disabled = false;
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

/** This subscriber's chat credit, if their line is renewing and the credit is unspent. */
async function loadStepUp() {
  const res = await fetch('/api/step-up', { headers: { authorization: `Bearer ${await user.getIdToken()}` } });
  const d = res.ok ? await res.json().catch(() => null) : null;
  stepUp = d?.eligible ? d : null;
}
/** Full-Service from chat: only on ?step=full, and only with the credit. */
const stepFull = () => STEP === 'full' && !!stepUp;
/** What this booking costs: the chat-credited figure when it applies, else the case fee. */
const shownCents = () => (stepUp ? (stepFull() ? stepUp.fullCents : stepUp.caseCents) : caseCents);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
