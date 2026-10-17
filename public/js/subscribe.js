// Subscription signup (PR 69): one screen. The pitch renders up top, the
// terms live in a single .agreement expander (the checkbox unlocks after the
// expander is opened and its body is read to the end), and one glowing button
// starts checkout. The Worker creates the Stripe subscription Checkout; the
// webhook activates access and /subscription.html is home base.

import { db, doc, getDoc, setDoc } from './firebase.js';
import { currentUser, hydrateNav } from './auth.js';
import { ensureSignedIn } from './inline-auth.js';
import { ensureFullProfile } from './profile.js';
import { SUBSCRIPTION_TERMS } from './waivers.js';
import { rates } from './rates.js';

// The seed only, for when /api/rates cannot be reached. The live chat price
// climbs with every new client, so the real figure always comes from the
// Worker; the checkout charges whatever the rates doc says at that moment.
const SUB_PRICE_CENTS = 5000;
const money = (cents) => (cents / 100).toLocaleString('en-US',
  cents % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {});

hydrateNav();

// A CONTRACTOR'S OWN LINE (Eric, 2026-10-17: Priority Chat "Yes, per
// contractor"): ?advocate=<uid> buys their chat line, at their price, once he
// has turned it on for them. Without it, the line is his.
const ADVOCATE = (() => { const v = new URLSearchParams(location.search).get('advocate') || ''; return /^[\w-]{1,64}$/.test(v) ? v : ''; })();
const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

let subCents = SUB_PRICE_CENTS;
// Full-Service's included hours, for the comparison Eric asked for (2026-10-15).
let fullHours = 20;
let offered = true;
let advName = '';
try {
  const r = ADVOCATE
    ? await fetch(`/api/rates?advocate=${encodeURIComponent(ADVOCATE)}`).then((x) => (x.ok ? x.json() : null))
    : await rates();
  if (Number(r?.subCents) > 0) subCents = Number(r.subCents);
  if (Number(r?.fullHours) > 0) fullHours = Number(r.fullHours);
  if (ADVOCATE) offered = r?.chatOffered === true;
} catch { if (ADVOCATE) offered = false; /* his seed stands; theirs is not offered without an answer */ }
if (ADVOCATE) {
  advName = await fetch(`/api/advocates/name?uid=${encodeURIComponent(ADVOCATE)}`)
    .then((x) => (x.ok ? x.json() : null)).then((d) => String(d?.name || '').trim()).catch(() => '');
  if (!advName) offered = false;
}
const advFirst = advName.split(/\s+/)[0] || '';

const pitch = document.getElementById('pitch');
const flow = document.getElementById('flow');
if (!offered) {
  pitch.innerHTML = `<p class="price-line"><strong>${advFirst ? `${esc(advFirst)}'s chat line` : 'This chat line'} is not open right now.</strong></p>
    <p><a class="btn" href="/">See what is offered</a></p>`;
  flow.innerHTML = '';
} else {
  // The pitch is visible before sign-in; every displayed price is the live one.
  pitch.innerHTML = `
    <p class="price-line"><strong>$${money(subCents)}</strong> a month${advFirst ? `, with ${esc(advFirst)}` : ''}. Cancel anytime; your chat history stays available.</p>
    <p><strong>The honest deal:</strong> you are guaranteed same day turnaround for at least one message. At $${money(subCents)} a month, this chat is a fraction of a fraction of the cost of Full-Service Case Management, which gives up to ${fullHours} hours of work, so expect priority, not in-depth case work.</p>`;

  let user = await currentUser();
  if (!user) user = await ensureSignedIn(flow, { returnTo: ADVOCATE ? `/subscribe.html?advocate=${encodeURIComponent(ADVOCATE)}` : '/subscribe.html' });
  await ensureProfile(user);
  await init(user);
}

// First sign-in creates users/{uid} with role 'client', replicating the
// ensureProfile step requireUser used to run for this page (rules enforce
// the role).
async function ensureProfile(u) {
  const ref = doc(db, 'users', u.uid);
  try {
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) {
      await setDoc(ref, { email: u.email, name: '', role: 'client' });
    }
  } catch (err) {
    console.warn('profile check failed', err);
  }
}

async function init(user) {
  // Already subscribed? Straight to the chat.
  try {
    const snapshot = await getDoc(doc(db, 'subscriptions', user.uid));
    if (snapshot.exists()) {
      const end = snapshot.data().currentPeriodEnd;
      if (end && (end.toDate ? end.toDate() : new Date(end)) > new Date()) {
        location.href = '/subscription.html';
        return;
      }
    }
  } catch { /* no sub yet */ }

  if (new URLSearchParams(location.search).get('canceled')) {
    const err = document.getElementById('page-error');
    err.textContent = 'Checkout was canceled and nothing was charged. You can subscribe whenever you are ready.';
    err.hidden = false;
  }
  await ensureFullProfile(user, flow);
  renderTerms(user);
}

/**
 * His chat terms, word for word, with their name where his say "me" (Eric,
 * 2026-10-17: "Simply replace 'me' with the advocate's name"), and their
 * price where his say his. Only on a contractor's own line; waivers.js
 * itself is unchanged.
 */
function termsFor(body, name, cents) {
  const first = String(name).split(/\s+/)[0] || String(name);
  return body
    .replace('an always-open chat line to me, with my live online status visible. I reply on my own time, when I am available.',
      `an always-open chat line to ${esc(name)}, with ${esc(first)}'s live online status visible. ${esc(first)} replies on their own time, when they are available.`)
    .replace('nothing I write is a diagnosis', `nothing ${esc(first)} writes is a diagnosis`)
    .replace('$50 per month through Stripe', `$${money(cents)} per month through Stripe`);
}

function renderTerms(user) {
  flow.innerHTML = `
    <details class="agreement" data-id="${SUBSCRIPTION_TERMS.id}">
      <summary>
        <span class="agreement-title">The terms, in plain words</span>
        <span class="agreement-plain">The important part: same day turnaround for at least one message, and priority, not in-depth case work. Please read the terms before you subscribe.</span>
      </summary>
      <div class="agreement-body"${advName ? ' data-terms-theirs' : ''}>${advName ? termsFor(SUBSCRIPTION_TERMS.body, advName, subCents) : SUBSCRIPTION_TERMS.body}</div>
      <label class="agreement-check"><input type="checkbox" id="terms-ok" disabled> I have read and accept these terms</label>
    </details>
    <div class="actions">
      <button class="btn glow" id="go" disabled>Subscribe, $${money(subCents)}/mo</button>
    </div>
    <p class="dim small" style="margin-top:.6rem;">You'll complete payment through Stripe's secure checkout, so your card details never pass through Pocket Advocate.</p>`;

  const agreement = flow.querySelector('.agreement');
  const body = agreement.querySelector('.agreement-body');
  const tick = flow.querySelector('#terms-ok');
  const go = flow.querySelector('#go');

  // Proof of exposure: the checkbox enables only after the expander has been
  // opened AND its body scrolled to the end (checked once on open for short
  // bodies that don't scroll).
  const seen = () => {
    // Never measure while closed: a hidden body reads 0/0 and would unlock
    // for free (same guard as book.js).
    if (!agreement.open) return;
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 8) tick.disabled = false;
  };
  agreement.addEventListener('toggle', () => {
    if (agreement.open) requestAnimationFrame(seen);
  });
  body.addEventListener('scroll', seen);

  tick.addEventListener('change', () => { go.disabled = !tick.checked; });

  go.addEventListener('click', async () => {
    go.disabled = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ termsAckAt: Date.now(), ...(ADVOCATE ? { advocate: ADVOCATE, quotedCents: subCents } : {}) }),
      });
      const data = await res.json();
      // Their price moved since the page loaded: show the new one and let them choose again.
      if (res.status === 409 && data.rateChanged && Number(data.priceCents) > 0) {
        subCents = Number(data.priceCents);
        go.textContent = `Subscribe, $${money(subCents)}/mo`;
      }
      if (!res.ok) throw new Error(data.error || `Failed (${res.status})`);
      location.href = data.url;
    } catch (err) {
      const errEl = document.getElementById('page-error');
      errEl.textContent = err.message;
      errEl.hidden = false;
      go.disabled = false;
    }
  });
}
