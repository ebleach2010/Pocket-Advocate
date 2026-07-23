// The settings cog (client + admin): notifications on/off and the color-scheme
// picker. Injected into the top nav for any signed-in user.
import { setTheme, currentTheme, THEMES } from './theme.js';
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
  const cur = currentTheme();
  const notifOn = 'Notification' in window && Notification.permission === 'granted';

  const overlay = document.createElement('div');
  overlay.id = 'pa-settings';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card">
      <div class="row"><h3 style="margin:0;">Settings</h3><button class="btn quiet" data-close>Done</button></div>
      <div class="toggle-row">
        <span><strong>Notifications</strong><br><span class="dim small">Alerts for new messages &amp; updates</span></span>
        <button class="switch ${notifOn ? 'on' : ''}" data-notif aria-pressed="${notifOn}" aria-label="Toggle notifications"></button>
      </div>
      <p style="margin:.9rem 0 .3rem;"><strong>Appearance</strong></p>
      <div class="seg">
        ${THEMES.map((t) => `<button data-theme-pick="${t.id}" class="${t.id === cur ? 'on' : ''}">${t.label}</button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.querySelector('[data-close]').addEventListener('click', () => overlay.remove());
  overlay.querySelectorAll('[data-theme-pick]').forEach((b) =>
    b.addEventListener('click', () => {
      setTheme(b.dataset.themePick);
      overlay.querySelectorAll('[data-theme-pick]').forEach((x) => x.classList.toggle('on', x === b));
    }));

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
