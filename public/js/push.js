// Web-push opt-in. Renders a small "turn on notifications" panel; on accept,
// registers the FCM service worker, grabs a token, and stores it on
// users/{uid}.fcmTokens for the Worker to push to. Silently does nothing when
// push isn't possible (no VAPID key yet, unsupported browser, or Safari
// without the app installed to the Home Screen).
import { db, doc, setDoc, arrayUnion } from './firebase.js';
import { firebaseConfig, VAPID_PUBLIC_KEY } from './firebase-config.js';

const DISMISS_KEY = 'pa-push-dismissed';

function supported() {
  return (
    !!VAPID_PUBLIC_KEY &&
    'serviceWorker' in navigator &&
    'Notification' in window &&
    'PushManager' in window
  );
}

async function saveToken(uid) {
  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  const { getMessaging, getToken } = await import(
    'https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js'
  );
  const { initializeApp, getApps } = await import(
    'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'
  );
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: reg,
  });
  if (!token) throw new Error('no token');
  await setDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) }, { merge: true });
}

/**
 * Call on signed-in pages with a container to (maybe) show the opt-in panel.
 * Already-granted users get a silent token refresh instead of UI.
 */
export async function initPushPrompt(user, mount) {
  if (!supported() || !user) return;

  if (Notification.permission === 'granted') {
    saveToken(user.uid).catch(() => {});
    return;
  }
  if (Notification.permission === 'denied') return;
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
      panel.innerHTML =
        '<p class="dim" style="margin:0;">Couldn’t turn on notifications on this device.</p>';
      setTimeout(() => panel.remove(), 4000);
    }
  });
}
