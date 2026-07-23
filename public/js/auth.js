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
    location.href = '/';
    return null;
  }
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
      await signOut(auth);
      location.href = '/';
    });
    markUnread(user, admin).catch(() => {});
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
