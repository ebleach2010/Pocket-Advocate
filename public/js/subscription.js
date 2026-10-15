// The subscriber home (24/7 Priority Chat): live subscriber chat, the in office
// cue and the response line Eric has set, subscription status, and the Stripe
// customer portal.

import { db, doc, getDoc } from './firebase.js';
import { paintRates } from './rates.js';
import { requireUser, hydrateNav, renewing } from './auth.js';
import { mountChat, watchPresence } from './chat.js';
import { initPushPrompt } from './push.js';
import { initSetupGuide } from './onboarding.js';
import { officeCueHtml, officeLineHtml } from './office.js';
import { startNightShift } from './night-shift.js';
startNightShift();
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
      <div class="actions"><a class="btn glow" href="/subscribe.html">Get 24/7 Priority Chat →</a></div>`;
    // Painted after the markup exists: this page builds its body at runtime.
    paintRates(page).catch(() => {});
    return;
  }

  const end = sub.currentPeriodEnd?.toDate ? sub.currentPeriodEnd.toDate() : new Date(sub.currentPeriodEnd || 0);
  const active = end > new Date();
  const endFmt = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  // ONE RESPONSE LINE, ONE SOURCE.
  //
  // The line about timing shown here and the one inside the "?" answer are the
  // same line, and it reaches the browser on the same answer that paints the
  // pill. Two surfaces cannot state different things, and clearing it clears it
  // in both. office.js fills the slot below.
  //
  // NO DEFAULT. Nothing about how long a reply takes appears unless a line has
  // been written, and nothing here invents one.

  page.innerHTML = `
    <div class="row">
      <h1 style="margin:0;">Your chat with me</h1>
      <span class="status-pill ${active ? '' : 'closed'}">${active ? 'ACTIVE' : 'ENDED'}</span>
    </div>
    <p class="office-row" style="margin-top:.4rem;">${officeCueHtml()}${officeLineHtml()}</p>
    <div class="panel" id="chat"></div>
    <p class="dim small">
      ${active
        ? (sub.status === 'canceled' || sub.cancelAtPeriodEnd
          ? `Canceled. Your chat stays open until ${endFmt.format(end)}.`
          : `Renews ${endFmt.format(end)}.`)
        : 'Your subscription has ended. Your message history stays visible to you.'}
      <a href="#" id="portal">Manage subscription</a>
    </p>
    ${renewing(sub) ? '<p class="cancel-row"><button type="button" class="btn ghost" data-cancel-open>Cancel subscription</button></p>' : ''}
    <dialog class="cancel-sheet" id="cancel-sheet" aria-labelledby="cancel-title">
      <h2 id="cancel-title">Cancel 24/7 Priority Chat?</h2>
      <p>Your subscription renews monthly unless you choose to cancel it. If you cancel, your chat stays open until ${endFmt.format(end)}, and everything you shared stays in your case file.</p>
      <p class="error small" data-cancel-err hidden></p>
      <div class="cancel-acts">
        <button type="button" class="btn danger" data-cancel-go>Cancel subscription</button>
        <button type="button" class="btn quiet" data-cancel-keep autofocus>Keep it</button>
      </div>
    </dialog>`;

  watchPresence(page);
  wireHelp(page);
  // The first-run guide (Home Screen, notifications), the same one a case
  // client gets, at the foot of the page. It asks about notifications itself,
  // so the push prompt here only refreshes the token quietly.
  initPushPrompt(user, null).catch(() => {});
  const setupHost = document.createElement('div');
  const mainEl = document.querySelector('main');
  mainEl?.insertBefore(setupHost, mainEl.querySelector('.footer-disclaimer'));
  initSetupGuide(user, setupHost, { welcome: false });
  mountChat({
    container: document.getElementById('chat'),
    parentPath: ['subscriptions', user.uid],
    user,
    myRole: 'client',
    saveUid: user.uid,
    disabled: !active,
    notice: 'Chat is paused. Your subscription has ended. Resubscribe any time; your history stays.',
  });

  // THE CLEAR WAY TO CANCEL (Eric, 2026-10-15). The menu's "Cancel
  // subscription" lands here on #cancel and opens this at once; the button on
  // the page opens it too. Confirming goes straight to Stripe's own cancel
  // step for this subscription, and back here after.
  const sheet = document.getElementById('cancel-sheet');
  const openCancel = () => { if (sheet && !sheet.open && renewing(sub)) sheet.showModal(); };
  page.querySelector('[data-cancel-open]')?.addEventListener('click', openCancel);
  sheet?.querySelector('[data-cancel-keep]').addEventListener('click', () => sheet.close());
  sheet?.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });
  sheet?.querySelector('[data-cancel-go]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const err = sheet.querySelector('[data-cancel-err]');
    btn.disabled = true;
    try {
      const res = await fetch('/api/portal', {
        method: 'POST',
        headers: { authorization: `Bearer ${await user.getIdToken()}`, 'content-type': 'application/json' },
        body: JSON.stringify({ flow: 'cancel' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error || 'Cancelling is not available right now. Try again in a minute.');
      location.href = data.url;
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      btn.disabled = false;
    }
  });
  if (location.hash === '#cancel') openCancel();
  window.addEventListener('hashchange', () => { if (location.hash === '#cancel') openCancel(); });

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

// The escaper that used to live here went with the second response-line store.
// Nothing on this page renders text from a document any more: the one line a
// client reads is set by office.js, from the answer that paints the pill.
