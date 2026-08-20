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

// Keep in sync with SUB_PRICE_CENTS in worker/index.js. The Worker builds the
// real Stripe line item from its own copy, so a hardcoded figure here can only
// ever be a lie waiting to happen.
const SUB_PRICE_CENTS = 2999;
const money = (cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));

hydrateNav();

// The pitch is visible before sign-in; every displayed price derives from the
// mirror above.
document.getElementById('pitch').innerHTML = `
  <p class="price-line"><strong>$${money(SUB_PRICE_CENTS)}</strong> a month. Cancel anytime and keep your history.</p>
  <p><strong>The honest deal:</strong> I answer when I'm available. Sometimes that's minutes, sometimes it's days. The terms below say exactly that.</p>`;

const flow = document.getElementById('flow');

let user = await currentUser();
if (!user) user = await ensureSignedIn(flow, { returnTo: '/subscribe.html' });
await ensureProfile(user);
await init();

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

async function init() {
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
    err.textContent = 'Checkout was canceled — nothing was charged. Subscribe below whenever you like.';
    err.hidden = false;
  }
  await ensureFullProfile(user, flow);
  renderTerms();
}

function renderTerms() {
  flow.innerHTML = `
    <details class="agreement" data-id="${SUBSCRIPTION_TERMS.id}">
      <summary>
        <span class="agreement-title">The terms, in plain words</span>
        <span class="agreement-plain">The no-guarantee clause is the whole deal. Know it before you pay.</span>
      </summary>
      <div class="agreement-body">${SUBSCRIPTION_TERMS.body}</div>
      <label class="agreement-check"><input type="checkbox" id="terms-ok" disabled> I have read and accept these terms</label>
    </details>
    <div class="actions">
      <button class="btn glow" id="go" disabled>Subscribe, $${money(SUB_PRICE_CENTS)}/mo</button>
    </div>
    <p class="dim small" style="margin-top:.6rem;">You'll be taken to Stripe's secure checkout, so card details never touch this site.</p>`;

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
        body: JSON.stringify({ termsAckAt: Date.now() }),
      });
      const data = await res.json();
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
