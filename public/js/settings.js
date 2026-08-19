// The settings cog (client + admin): notifications on/off. Injected into the
// top nav for any signed-in user. There is deliberately no theme picker — the
// site is neon, one look, everywhere.
import { enablePush } from './push.js';
import { db, doc, getDoc, setDoc } from './firebase.js';

export function initSettings(user) {
  if (!user) return;
  const nav = document.querySelector('.tabs');
  if (!nav || nav.querySelector('.cog-btn')) return;
  const cog = document.createElement('button');
  cog.className = 'cog-btn';
  cog.type = 'button';
  cog.title = 'Settings';
  cog.setAttribute('aria-label', 'Settings');
  cog.textContent = '⚙';
  nav.appendChild(cog);
  cog.addEventListener('click', () => openPanel(user));
}

function openPanel(user) {
  const existing = document.getElementById('pa-settings');
  if (existing) { existing.remove(); return; }
  const notifOn = 'Notification' in window && Notification.permission === 'granted';
  // iOS only delivers push to a Home-Screen app, so say that rather than
  // letting the toggle look broken in Safari.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const needsInstall = isIOS && !standalone;

  const overlay = document.createElement('div');
  overlay.id = 'pa-settings';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card">
      <div class="row"><h3 style="margin:0;">Settings</h3><button class="btn quiet" data-close>Done</button></div>
      <div class="toggle-row">
        <span><strong>Notifications</strong><br><span class="dim small">New messages, documents &amp; updates</span></span>
        <button class="switch ${notifOn ? 'on' : ''}" data-notif aria-pressed="${notifOn}" aria-label="Toggle notifications"></button>
      </div>
      <p class="dim small" style="margin:.5rem 0 0;">${needsInstall
        ? 'On iPhone these only arrive once Pocket Advocate is on your Home Screen — Safari tabs can\'t receive them.'
        : 'Sends a real notification so you can confirm they arrive.'}</p>
      <div class="actions" style="margin-top:.6rem;">
        <button class="btn quiet" data-test-notif>Send a test notification</button>
      </div>
      <p class="dim small" id="pa-notif-result" hidden style="margin:.5rem 0 0;"></p>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());

  // A silent push failure is indistinguishable from "nothing has happened yet",
  // so give both of us a way to prove delivery on demand.
  const testBtn = overlay.querySelector('[data-test-notif]');
  const resultEl = overlay.querySelector('#pa-notif-result');
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    resultEl.hidden = false;
    resultEl.textContent = 'Sending…';
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}` },
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
      resultEl.textContent = `Sent to ${out.devices} device${out.devices === 1 ? '' : 's'}. If nothing arrives in a few seconds, notifications aren't getting through.`;
    } catch (err) {
      resultEl.textContent = err.message;
    }
    testBtn.disabled = false;
  });

  const notifBtn = overlay.querySelector('[data-notif]');
  notifBtn.addEventListener('click', async () => {
    notifBtn.disabled = true;
    if (notifBtn.classList.contains('on')) {
      await disablePush(user);
      notifBtn.classList.remove('on');
      notifBtn.setAttribute('aria-pressed', 'false');
    } else {
      const r = await enablePush(user);
      if (r.ok) { notifBtn.classList.add('on'); notifBtn.setAttribute('aria-pressed', 'true'); }
      else alert(r.error);
    }
    notifBtn.disabled = false;
  });
}

async function disablePush(user) {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return;
    const ep = sub.endpoint;
    await sub.unsubscribe();
    const snap = await getDoc(doc(db, 'users', user.uid));
    const list = snap.exists() && Array.isArray(snap.data().pushSubs) ? snap.data().pushSubs : [];
    await setDoc(doc(db, 'users', user.uid), { pushSubs: list.filter((s) => s.endpoint !== ep) }, { merge: true });
  } catch (e) {
    console.warn('disable push', e);
  }
}
