// Magic-link auth helpers + the shared top-nav auth state.
import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  signOut,
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
  return user;
}

/** Fills the shared top-nav sign-in/out state on any page that has it. */
export async function hydrateNav() {
  const el = document.querySelector('[data-nav-auth]');
  if (!el) return;
  const user = await currentUser();
  if (user) {
    const admin = await isAdmin(user);
    el.innerHTML =
      (admin ? `<a href="/admin.html">Admin</a>` : `<a href="/case.html">My cases</a>`) +
      ` <a href="#" data-signout title="${user.email || ''}">Sign out</a>`;
    el.querySelector('[data-signout]').addEventListener('click', async (e) => {
      e.preventDefault();
      await signOut(auth);
      location.href = '/';
    });
  } else {
    el.innerHTML = `<a href="/signin.html">Sign in</a>`;
  }
}
