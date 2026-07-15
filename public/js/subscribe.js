// Subscription signup: form 5 terms (scroll-to-end + acknowledge, same
// pattern as the case waivers) → Worker creates the Stripe subscription
// Checkout. The webhook activates access; /subscription.html is home base.

import { db, doc, getDoc } from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';
import { ensureFullProfile } from './profile.js';
import { SUBSCRIPTION_TERMS } from './waivers.js';

hydrateNav();
const user = await requireUser();
if (user) init();

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
  await ensureFullProfile(user, document.getElementById('flow'));
  renderTerms();
}

function renderTerms() {
  const el = document.getElementById('flow');
  el.innerHTML = `
    <h2>The unskippable part</h2>
    <p class="dim small">One read. The no-guarantee clause is the whole deal — know it before you pay.</p>
    <div class="waiver-body" id="body">${SUBSCRIPTION_TERMS.body}</div>
    <p class="scroll-hint" id="hint">Scroll to the end to continue…</p>
    <div class="actions">
      <button class="btn mag" id="go" disabled>Accept & subscribe — $20/mo</button>
    </div>
    <p class="dim small" style="margin-top:.6rem;">You'll be taken to Stripe's secure checkout — card details never touch this site.</p>`;

  const body = el.querySelector('#body');
  const go = el.querySelector('#go');
  const hint = el.querySelector('#hint');
  const check = () => {
    if (body.scrollTop + body.clientHeight >= body.scrollHeight - 8) {
      go.disabled = false;
      hint.hidden = true;
    }
  };
  body.addEventListener('scroll', check);
  check();

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
