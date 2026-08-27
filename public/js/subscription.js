// The subscriber home (24/7 Priority Chat): live subscriber chat, the advocate's
// presence + the admin-controlled expectation line, subscription status, and
// the Stripe customer portal.

import { db, doc, getDoc } from './firebase.js';
import { paintRates } from './rates.js';
import { requireUser, hydrateNav } from './auth.js';
import { mountChat, watchPresence } from './chat.js';
import { initPushPrompt } from './push.js';
import { officeCueHtml } from './office.js';
import { wireHelp } from './help.js';

hydrateNav();
const user = await requireUser();
if (user) load();

async function load() {
  const page = document.getElementById('page');
  const sessionId = new URLSearchParams(location.search).get('session_id');

  let sub = await fetchSub();
  if (!sub && sessionId) {
    // Payment just finished; the webhook is opening the subscription.
    page.innerHTML = '<h1>Finishing up…</h1><p class="dim">Payment received. I am unlocking your chat now; this usually takes a few seconds.</p>';
    const started = Date.now();
    while (!sub && Date.now() - started < 90_000) {
      await new Promise((r) => setTimeout(r, 2500));
      sub = await fetchSub();
    }
  }

  if (!sub) {
    page.innerHTML = `
      <h1>No subscription yet</h1>
      <p class="dim">24/7 Priority Chat, <span data-rate="sub">$95</span>/mo: chat, case files, photos, and labs all in one on-the-go priority chat. Cancel anytime.</p>
      <div class="actions"><a class="btn mag" href="/subscribe.html">Get 24/7 Priority Chat →</a></div>`;
    // Painted after the markup exists: this page builds its body at runtime.
    paintRates(page).catch(() => {});
    return;
  }

  const end = sub.currentPeriodEnd?.toDate ? sub.currentPeriodEnd.toDate() : new Date(sub.currentPeriodEnd || 0);
  const active = end > new Date();
  const endFmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // NO DEFAULT (Eric, 2026-08-27: "Never display or promise a specific
  // response time unless one has been manually set"). This used to fall back
  // to "I typically reply within a few days" - a response-time promise printed
  // on a paying subscriber's screen that he had never actually made. The line
  // now shows what he typed on his chats page, and nothing at all until he
  // types something.
  let expectation = '';
  try {
    const snapshot = await getDoc(doc(db, 'settings', 'subscriberChat'));
    const line = snapshot.exists() ? String(snapshot.data().expectationLine || '').trim() : '';
    if (line) expectation = line;
  } catch { /* nothing shown, which is the safe direction */ }

  page.innerHTML = `
    <div class="row">
      <h1 style="margin:0;">Your chat with me</h1>
      <span class="status-pill ${active ? '' : 'closed'}">${active ? 'ACTIVE' : 'ENDED'}</span>
    </div>
    <p class="office-row" style="margin-top:.4rem;">${officeCueHtml()}${
      expectation ? `<span class="expectation">"${esc(expectation)}"</span>` : ''}</p>
    <div class="panel" id="chat"></div>
    <p class="dim small">
      ${active
        ? `Renews ${sub.status === 'canceled' ? '(canceled) access ends' : ''} ${endFmt.format(end)}.`
        : 'Your subscription has ended. Your message history stays visible to you.'}
      <a href="#" id="portal">Manage subscription</a>
    </p>`;

  watchPresence(page);
  wireHelp(page);
  initPushPrompt(user, page).catch(() => {});
  mountChat({
    container: document.getElementById('chat'),
    parentPath: ['subscriptions', user.uid],
    user,
    myRole: 'client',
    saveUid: user.uid,
    disabled: !active,
    notice: 'Chat is paused. Your subscription has ended. Resubscribe any time; your history stays.',
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
