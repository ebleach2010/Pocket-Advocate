// The settings cog (client + admin): notifications, and how the app looks.
// Injected into the top nav for any signed-in user.
import { enablePush } from './push.js';
import { db, doc, getDoc, setDoc } from './firebase.js';
import { SCHEMES, currentScheme, applyScheme } from './theme.js';
import { barActs } from './nav-menu.js';

export function initSettings(user, isAdmin = false) {
  if (!user) return;
  // The right-hand end of the bar, never the link strip: inside the strip the
  // cog was the last thing on a row wider than the screen, so the one control
  // the onboarding tells people to tap was the one always off it.
  const nav = barActs();
  if (!nav || nav.querySelector('.cog-btn')) return;
  const cog = document.createElement('button');
  cog.className = 'cog-btn';
  cog.type = 'button';
  cog.title = 'Settings';
  cog.setAttribute('aria-label', 'Settings');
  cog.textContent = '⚙';
  nav.appendChild(cog);
  cog.addEventListener('click', () => openPanel(user, isAdmin));
}

function openPanel(user, isAdmin = false) {
  const existing = document.getElementById('pa-settings');
  if (existing) { existing.remove(); return; }
  const notifOn = 'Notification' in window && Notification.permission === 'granted';
  // iOS only delivers push to a Home-Screen app, so say that rather than
  // letting the toggle look broken in Safari.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const needsInstall = isIOS && !standalone;

  const scheme = currentScheme();
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
        ? 'On iPhone these only arrive once Pocket Advocate is on your Home Screen. Safari tabs can\'t receive them.'
        : 'Sends a real notification so you can confirm they arrive.'}</p>
      <div class="actions" style="margin-top:.6rem;">
        <button class="btn quiet" data-test-notif>Send a test notification</button>
      </div>
      <p class="dim small" id="pa-notif-result" hidden style="margin:.5rem 0 0;"></p>

      <h4 style="margin:1.2rem 0 .1rem;">Appearance</h4>
      <p class="dim small" style="margin:0 0 .5rem;">Applies on this device, right away.</p>
      <div class="scheme-grid" data-schemes>
        ${SCHEMES.map((x) => `
          <button class="scheme-swatch${x.id === scheme ? ' on' : ''}" data-scheme="${x.id}"
            aria-pressed="${x.id === scheme}">
            <span class="scheme-chip sc-${x.id}" aria-hidden="true"><i></i><i></i><i></i></span>
            <span class="scheme-name">${x.label}</span>
            <span class="scheme-blurb dim small">${x.blurb}</span>
          </button>`).join('')}
      </div>
      ${isAdmin ? '<div data-admin-rows></div>' : ''}
    </div>`;
  document.body.appendChild(overlay);

  // Escape, the backdrop and Done all close it. It was the only overlay in the
  // app that ignored Escape.
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);

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

  // Applies immediately, so he sees the change rather than imagining it. The
  // swatches are painted from real scheme tokens, so a swatch cannot drift out
  // of sync with what the scheme actually looks like.
  overlay.querySelectorAll('[data-scheme]').forEach((b) =>
    b.addEventListener('click', () => {
      applyScheme(b.dataset.scheme);
      overlay.querySelectorAll('[data-scheme]').forEach((x) => {
        const on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-pressed', String(on));
      });
    }));

  // The advocate's own rows come from a module a client is never served. A
  // dynamic import, so the request only happens for him: this file is public,
  // and even the NAMES of his tools are his business, not everyone's.
  const adminRows = overlay.querySelector('[data-admin-rows]');
  if (adminRows) {
    import('./admin-settings.js').then((m) => {
      adminRows.innerHTML = m.adminSettingsHtml();
      m.wireAdminSettings(overlay, user);
    }).catch(() => { /* his switches are missing; the client half still works */ });
  }

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
