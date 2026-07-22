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
  const { getMessaging, getToken, isSupported } = await import(
    'https://www.gstatic.com/firebasejs/10.12.5/firebase-messaging.js'
  );
  if (!(await isSupported())) throw new Error('this browser can’t receive web push');
  const { initializeApp, getApps } = await import(
    'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js'
  );
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  // Register the FCM worker and — crucially on iOS — wait until it is the
  // active controller before asking for a token, or getToken races and fails.
  const reg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
  await navigator.serviceWorker.ready;
  const token = await getToken(getMessaging(app), {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: reg,
  });
  if (!token) throw new Error('no token returned');
  await setDoc(doc(db, 'users', uid), { fcmTokens: arrayUnion(token) }, { merge: true });
  return token;
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
