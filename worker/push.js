// Native Web Push delivery. Subscriptions live on users/{uid}.pushSubs as
// [{endpoint, p256dh, auth}] (written by the browser after the user allows
// notifications); dead ones are pruned on send. Bodies stay content-free.

import { getDoc, patchDoc } from './firestore.js';
import { sendWebPush } from './webpush.js';

/** Push to every registered device of one user. Never throws — best-effort. */
export async function notifyUser(env, uid, { title, body, link }) {
  try {
    const profile = await getDoc(env, `users/${uid}`);
    const subs = Array.isArray(profile?.data.pushSubs) ? profile.data.pushSubs : [];
    if (!subs.length) return;
    const message = { title, body, link };
    const stale = [];
    for (const sub of subs.slice(0, 10)) {
      try {
        const status = await sendWebPush(env, sub, message);
        if (status === 404 || status === 410) stale.push(sub.endpoint);
        else if (status >= 400) console.error('webpush send failed:', status, sub.endpoint.slice(0, 40));
      } catch (e) {
        console.error('webpush error:', e.message);
      }
    }
    if (stale.length) {
      await patchDoc(env, `users/${uid}`, {
        pushSubs: subs.filter((s) => !stale.includes(s.endpoint)),
      }, { mask: ['pushSubs'] });
    }
  } catch (err) {
    console.error('notifyUser:', err.message);
  }
}
