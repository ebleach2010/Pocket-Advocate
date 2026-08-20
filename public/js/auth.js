// Magic-link auth helpers + the shared top-nav auth state.
import {
  auth,
  db,
  rtdb,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signOut,
  rtdbRef,
  rtdbSet,
  onDisconnect,
} from './firebase.js';

const EMAIL_KEY = 'pa-signin-email';

// Pages inside an installed app can stay suspended for days; nobody should
// have to force-close to pick up a deploy, and nobody is ever logged out by
// one (sessions live in storage, not in the code). On resume, compare the
// server's build tag to the one this page loaded under and reload when they
// differ — unless someone is mid-sentence in a text box.
let loadedTag = null;
async function checkVersion() {
  try {
    const res = await fetch('/api/version');
    const { tag } = await res.json();
    if (!tag) return;
    if (!loadedTag) { loadedTag = tag; return; }
    if (tag === loadedTag) return;
    const a = document.activeElement;
    const typing = a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.value;
    if (!typing) location.reload();
  } catch { /* offline — never reload on a failed check */ }
}
checkVersion();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkVersion();
});
setInterval(checkVersion, 30 * 60_000);

export function rememberEmail(email) {
  localStorage.setItem(EMAIL_KEY, email);
}
export function recallEmail() {
  return localStorage.getItem(EMAIL_KEY) || '';
}

export async function sendMagicLink(email, returnTo = '/book.html') {
  await sendSignInLinkToEmail(auth, email, {
    url: `${location.origin}/signin.html?to=${encodeURIComponent(returnTo)}`,
    handleCodeInApp: true,
  });
  rememberEmail(email);
}

/** Resolves with the signed-in user, or null. */
export function currentUser() {
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      resolve(user);
    });
  });
}

/** Redirects to sign-in (remembering where to come back to) if signed out. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    location.href = `/signin.html?to=${encodeURIComponent(location.pathname + location.search)}`;
    return null;
  }
  await ensureProfile(user);
  return user;
}

/** First sign-in creates users/{uid} with role 'client' (rules enforce it). */
async function ensureProfile(user) {
  const ref = doc(db, 'users', user.uid);
  try {
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) {
      await setDoc(ref, { email: user.email, name: '', role: 'client' });
    }
  } catch (err) {
    console.warn('profile check failed', err);
  }
}

/** True when the signed-in user is the admin (Eric). */
export async function isAdmin(user) {
  try {
    const snapshot = await getDoc(doc(db, 'users', user.uid));
    return snapshot.exists() && snapshot.data().role === 'admin';
  } catch {
    return false;
  }
}

/** Redirects non-admins away from admin pages; returns the admin user. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!user) return null;
  if (!(await isAdmin(user))) {
    // Clear the open-to-admin hint BEFORE bouncing to '/', or a stale hint on
    // a non-admin device would bounce '/' right back here, forever.
    localStorage.removeItem('pa-admin-device');
    location.href = '/';
    return null;
  }
  // Weekly re-login, Eric's own rule: an admin session older than 7 days is
  // signed out everywhere on this device, trusted-device token included, so
  // getting back in takes the password again.
  const WEEK_MS = 7 * 86_400_000;
  const since = Number(localStorage.getItem('pa-admin-since') || 0);
  if (!since) {
    localStorage.setItem('pa-admin-since', String(Date.now()));
  } else if (Date.now() - since > WEEK_MS) {
    localStorage.removeItem('pa-admin-since');
    localStorage.removeItem('pa-device-token');
    localStorage.removeItem('pa-admin-device');
    await signOut(auth);
    location.href = `/signin.html?to=${encodeURIComponent(location.pathname + location.search)}`;
    return null;
  }
  // Mark this device as the admin's so the landing page can redirect to the
  // dashboard instantly, without waiting for Firebase to wake up.
  localStorage.setItem('pa-admin-device', '1');
  startPresence();
  return user;
}

// Eric's presence sets itself while any admin page is open, and clears when
// the connection drops (SPEC §D — Tether's onDisconnect pattern).
function startPresence() {
  try {
    const presenceRef = rtdbRef(rtdb, 'presence/eric');
    onDisconnect(presenceRef).set(false);
    rtdbSet(presenceRef, true);
  } catch (err) {
    console.warn('presence unavailable', err);
  }
}

/** Fills the shared top-nav sign-in/out state on any page that has it. */
export async function hydrateNav() {
  const el = document.querySelector('[data-nav-auth]');
  if (!el) return;
  const user = await currentUser();
  if (user) {
    const admin = await isAdmin(user);
    const path = location.pathname;
    if (admin) {
      localStorage.setItem('pa-admin-device', '1');
      el.innerHTML =
        `<a href="/admin.html">Admin</a> <a href="#" data-signout title="${user.email || ''}">Sign out</a>`;
    } else {
      el.innerHTML =
        `<a href="/case.html" class="${path === '/case.html' ? 'active' : ''}">My cases</a>` +
        ` <a href="/chat.html" data-nav-chat class="${path === '/chat.html' ? 'active' : ''}">Chat</a>` +
        ` <a href="#" data-signout title="${user.email || ''}">Sign out</a>`;
    }
    el.querySelector('[data-signout]').addEventListener('click', async (e) => {
      e.preventDefault();
      // Untrust this device too, or the sign-in page would silently sign them
      // straight back in and "Sign out" would mean nothing on a shared phone.
      localStorage.removeItem('pa-device-token');
      localStorage.removeItem('pa-admin-device');
      await signOut(auth);
      location.href = '/';
    });
    markUnread(user, admin).catch(() => {});
    import('./settings.js').then((m) => m.initSettings(user, admin)).catch(() => {});
    // What changed since they last opened the app. Loaded soft and shown once:
    // nothing on the page depends on it, and a changelog that fails to load is
    // not a reason for anything else to break. Nobody is shown a changelog on
    // a first-ever visit - they need the app, not its history.
    import('./changelog.js').then((m) => m.showVersionCard(admin, user)).catch(() => {});
  } else {
    el.innerHTML = `<a href="/signin.html">Sign in</a>`;
  }
}

// Glowing golden diamond on the Chat tab when a conversation is waiting on you:
// for Eric, any thread whose last word was a client's; for a client, any whose
// last word was Eric's.
async function markUnread(user, admin) {
  let unread = false;
  try {
    if (admin) {
      const [cases, subs] = await Promise.all([
        getDocs(collection(db, 'cases')),
        getDocs(collection(db, 'subscriptions')),
      ]);
      const any = (snap) => snap.docs.some((d) => d.data().lastMessage?.role === 'client');
      unread = any(cases) || any(subs);
    } else {
      const cases = await getDocs(query(collection(db, 'cases'), where('clientUid', '==', user.uid)));
      unread = cases.docs.some((d) => d.data().lastMessage?.role === 'admin');
      if (!unread) {
        const sub = await getDoc(doc(db, 'subscriptions', user.uid));
        unread = sub.exists() && sub.data().lastMessage?.role === 'admin';
      }
    }
  } catch { /* no badge on error */ }
  if (!unread) return;
  const link = admin
    ? document.querySelector('.tabs a[href="/admin-chats.html"]')
    : document.querySelector('[data-nav-chat]');
  if (link && !link.querySelector('.diamond')) {
    link.insertAdjacentHTML('beforeend', ' <span class="diamond" title="Unread messages">◆</span>');
  }
}
