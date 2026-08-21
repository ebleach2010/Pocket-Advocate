// The single import point for data access across the app.
//
// Normally this is Firebase. In demo mode it is an in-memory stand-in with
// exactly the same exports, which is what makes the demo a demo rather than a
// screenshot: every page, every module and every code path runs unchanged and
// only the layer underneath is fake.
//
// Top-level await makes this an async module. Every importer already awaits it
// implicitly, because that is how ES modules work; nothing else changes.

/**
 * Demo mode, and the two gates on it.
 *
 * First: NEVER on the production host. Not a config flag, not an env var, a
 * hostname check that fails closed. thepocketadvocates.com cannot enter demo
 * mode whatever the URL says.
 *
 * Second: it is entirely browser-side. No demo branch exists in the Worker, no
 * magic code, no bypass in handleVerifyCode. The worst a leaked demo link can
 * do is let a stranger play with invented data in their own tab.
 *
 * `?demo=1` is the client, `?demo=admin` is his side. It sticks for the tab so
 * a navigation (booking, the return page) stays in the demo; `?demo=0` leaves.
 */
const DEMO = (() => {
  try {
    if (/(^|\.)thepocketadvocates\.com$/i.test(location.hostname)) return '';
    const q = new URLSearchParams(location.search).get('demo');
    if (q === '0') { sessionStorage.removeItem('pa-demo'); return ''; }
    if (q) { sessionStorage.setItem('pa-demo', q); return q; }
    return sessionStorage.getItem('pa-demo') || '';
  } catch {
    return '';   // storage blocked: not a reason to fake anything
  }
})();

// A dynamic import, so the demo files are never fetched on a real page — and
// they are not served from production at all.
const impl = DEMO
  ? await import('./demo/store.js').then((m) => m.mountDemo(DEMO))
  : await import('./firebase-real.js');

export const {
  auth,
  db,
  storage,
  rtdb,
  onAuthStateChanged,
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  signInWithCustomToken,
  signOut,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  addDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
  arrayUnion,
  ref,
  uploadBytesResumable,
  listAll,
  getDownloadURL,
  getMetadata,
  rtdbRef,
  onValue,
  rtdbSet,
  onDisconnect,
} = impl;

/** '' when this is the real thing, otherwise the demo role. */
export const DEMO_MODE = DEMO;
