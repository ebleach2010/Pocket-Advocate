// Web-push opt-in. Renders a small "turn on notifications" panel; on accept,
// registers the FCM service worker, grabs a token, and stores it on
// users/{uid}.fcmTokens for the Worker to push to. Silently does nothing when
// push isn't possible (no VAPID key yet, unsupported browser, or Safari
// without the app installed to the Home Screen).
import { db, doc, getDoc, setDoc, arrayUnion } from './firebase.js';
import { VAPID_PUBLIC_KEY } from './firebase-config.js';

const DISMISS_KEY = 'pa-push-dismissed';

function supported() {
  return (
    !!VAPID_PUBLIC_KEY &&
    'serviceWorker' in navigator &&
    'Notification' in window &&
    'PushManager' in window
  );
}

function urlB64ToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

// Native Web Push (RFC 8291). Subscribe via the browser's own push service —
// no Firebase, which is what actually works inside iOS Home-Screen apps.
async function saveToken(uid) {
  const reg = await navigator.serviceWorker.register('/push-sw.js');
  await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ||
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(VAPID_PUBLIC_KEY),
    }));
  const j = sub.toJSON();
  const rec = { endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth };
  const snap = await getDoc(doc(db, 'users', uid));
  const cur = snap.exists() && Array.isArray(snap.data().pushSubs) ? snap.data().pushSubs : [];
  if (!cur.some((s) => s.endpoint === rec.endpoint)) {
    await setDoc(doc(db, 'users', uid), { pushSubs: arrayUnion(rec) }, { merge: true });
  }
  return rec;
}

/**
 * Call on signed-in pages with a container to (maybe) show the opt-in panel.
 * Already-granted users get a silent token refresh instead of UI.
 */
export async function initPushPrompt(user, mount) {
  if (!supported() || !user) return;
  if (Notification.permission === 'denied') return;

  // Permission already granted: refresh the token. If that fails, don't hide it
  // — show the reason, because otherwise we'd never register and never know why.
  if (Notification.permission === 'granted') {
    try {
      await saveToken(user.uid);
    } catch (err) {
      console.error('push refresh:', err);
      if (mount) {
        const p = document.createElement('div');
        p.className = 'panel push-prompt';
        p.innerHTML = `<p class="dim small" style="margin:0;">Notifications aren’t registering on this device:<br><strong>${String(err && err.message || err)}</strong><br>
          <button class="btn quiet" data-push="retry" style="margin-top:.5rem;">Try again</button></p>`;
        p.querySelector('[data-push="retry"]').addEventListener('click', () => location.reload());
        mount.prepend(p);
      }
    }
    return;
  }
  if (!mount || localStorage.getItem(DISMISS_KEY)) return;

  const panel = document.createElement('div');
  panel.className = 'panel push-prompt';
  panel.innerHTML = `
    <p style="margin:0 0 .6rem;"><strong>Message alerts</strong><br>
    <span class="dim small">Get a notification on this device when there's a reply — no message content is shown.</span></p>
    <div class="row" style="gap:.6rem;">
      <button class="btn" data-push="on">Turn on notifications</button>
      <button class="btn quiet" data-push="later">Not now</button>
    </div>`;
  mount.prepend(panel);

  panel.querySelector('[data-push="later"]').addEventListener('click', () => {
    localStorage.setItem(DISMISS_KEY, '1');
    panel.remove();
  });
  panel.querySelector('[data-push="on"]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        panel.remove();
        return;
      }
      await saveToken(user.uid);
      panel.innerHTML = '<p class="dim" style="margin:0;">Notifications are on for this device. ✓</p>';
      setTimeout(() => panel.remove(), 4000);
    } catch (err) {
      console.error('push setup:', err);
      // Show the real reason (and keep it on screen) so it can be diagnosed.
      panel.innerHTML =
        `<p class="dim small" style="margin:0;">Couldn’t turn on notifications:<br><strong>${String(err && err.message || err)}</strong><br>
         <button class="btn quiet" data-push="retry" style="margin-top:.5rem;">Try again</button></p>`;
      panel.querySelector('[data-push="retry"]')?.addEventListener('click', () => location.reload());
    }
  });
}
