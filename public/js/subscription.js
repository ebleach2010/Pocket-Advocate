// The subscriber home: live chat with Eric, his presence + the expectation
// line he controls, subscription status, and the Stripe customer portal.

import { db, doc, getDoc } from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';
import { mountChat, watchPresence } from './chat.js';
import { initPushPrompt } from './push.js';

hydrateNav();
const user = await requireUser();
if (user) load();

async function load() {
  const page = document.getElementById('page');
  const sessionId = new URLSearchParams(location.search).get('session_id');

  let sub = await fetchSub();
  if (!sub && sessionId) {
    // Payment just finished; the webhook is opening the subscription.
    page.innerHTML = '<h1>Finishing up…</h1><p class="dim">Payment received — unlocking your chat now. A few seconds, usually.</p>';
    const started = Date.now();
    while (!sub && Date.now() - started < 90_000) {
      await new Promise((r) => setTimeout(r, 2500));
      sub = await fetchSub();
    }
  }

  if (!sub) {
    page.innerHTML = `
      <h1>No subscription yet</h1>
      <p class="dim">The Pocket Advocate subscription is an always-open chat line to Eric for $50/mo.</p>
      <div class="actions"><a class="btn mag" href="/subscribe.html">Get Pocket Advocate →</a></div>`;
    return;
  }

  const end = sub.currentPeriodEnd?.toDate ? sub.currentPeriodEnd.toDate() : new Date(sub.currentPeriodEnd || 0);
  const active = end > new Date();
  const endFmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  let expectation = 'Eric typically replies within a few days.';
  try {
    const snapshot = await getDoc(doc(db, 'settings', 'subscriberChat'));
    if (snapshot.exists() && snapshot.data().expectationLine) expectation = snapshot.data().expectationLine;
  } catch { /* default stands */ }

  page.innerHTML = `
    <div class="row">
      <h1 style="margin:0;">Your chat with Eric</h1>
      <span class="status-pill ${active ? '' : 'closed'}">${active ? 'ACTIVE' : 'ENDED'}</span>
    </div>
    <p style="margin-top:.4rem;"><span class="p-dot"></span><span class="p-label">Checking…</span>
      <span class="expectation"> · "${esc(expectation)}"</span></p>
    <div class="panel" id="chat"></div>
    <p class="dim small">
      ${active
        ? `Renews ${sub.status === 'canceled' ? '— canceled; access ends' : ''} ${endFmt.format(end)}.`
        : 'Your subscription has ended. Your message history stays visible to you.'}
      <a href="#" id="portal">Manage subscription</a>
    </p>`;

  watchPresence(page);
  initPushPrompt(user, page).catch(() => {});
  mountChat({
    container: document.getElementById('chat'),
    parentPath: ['subscriptions', user.uid],
    user,
    myRole: 'client',
    saveUid: user.uid,
    disabled: !active,
    notice: 'Chat is paused — your subscription has ended. Resubscribe any time; your history stays.',
  });

  document.getElementById('portal').addEventListener('click', async (e) => {
    e.preventDefault();
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Portal unavailable');
      location.href = data.url;
    } catch (err) {
      alert(err.message);
    }
  });
}

async function fetchSub() {
  try {
    const snapshot = await getDoc(doc(db, 'subscriptions', user.uid));
    return snapshot.exists() ? snapshot.data() : null;
  } catch {
    return null;
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
