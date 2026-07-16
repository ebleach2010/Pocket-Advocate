// Web push via FCM HTTP v1. Tokens live on users/{uid}.fcmTokens (written by
// the browser after the user allows notifications); stale tokens are pruned
// on send. Bodies stay content-free, same policy as email.

import { getAccessToken } from './google-auth.js';
import { getDoc, patchDoc } from './firestore.js';

const MESSAGING_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';

/** Push to every registered device of one user. Never throws — push is best-effort. */
export async function notifyUser(env, uid, { title, body, link }) {
  try {
    const profile = await getDoc(env, `users/${uid}`);
    const tokens = Array.isArray(profile?.data.fcmTokens) ? profile.data.fcmTokens : [];
    if (!tokens.length) return;
    const access = await getAccessToken(env, MESSAGING_SCOPE);
    const stale = [];
    for (const token of tokens.slice(0, 10)) {
      const res = await fetch(
        `https://fcm.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/messages:send`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${access}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            message: {
              token,
              notification: { title, body },
              webpush: {
                notification: { icon: '/icon-180.png', badge: '/icon-180.png' },
                fcm_options: { link: `${env.PUBLIC_BASE_URL}${link}` },
              },
            },
          }),
        }
      );
      if (res.status === 404 || res.status === 400) stale.push(token);
      else if (!res.ok) console.error('fcm send failed:', res.status, (await res.text()).slice(0, 200));
    }
    if (stale.length) {
      await patchDoc(env, `users/${uid}`, {
        fcmTokens: tokens.filter((t) => !stale.includes(t)),
      }, { mask: ['fcmTokens'] });
    }
  } catch (err) {
    console.error('notifyUser:', err.message);
  }
}
