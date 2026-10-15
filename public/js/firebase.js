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
 * Preview mode. Off unless the host is a per-deployment preview build, which
 * the server decides and this only mirrors: the live site cannot enter it
 * whatever a URL says, and the modules it needs are not served there at all.
 *
 * Nothing about the authentication path changes here or in the Worker.
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

/**
 * THE CASE PREVIEW (Eric, 2026-10-15: "So clients can see the features before
 * they commit"). "Preview a case" on the home opens /case.html?preview=1, and
 * from then on this tab runs an invented case of its own (js/preview/) instead
 * of the real database, until Exit wipes it or the tab closes. On the live
 * site too: nothing it does reaches the server. Never on an advocate page.
 */
const PREVIEW = (() => {
  try {
    if (/^\/admin/.test(location.pathname)) return false;
    const q = new URLSearchParams(location.search).get('preview');
    if (q === '1') sessionStorage.setItem('pa-preview', '1');
    if (q === '0') { sessionStorage.removeItem('pa-preview'); sessionStorage.removeItem('pa-preview-store'); }
    return sessionStorage.getItem('pa-preview') === '1';
  } catch {
    return false;   // storage blocked: the preview cannot hold anything, so it does not start
  }
})();

// A dynamic import, so the demo files are never fetched on a real page — and
// they are not served from production at all. The preview's files are small,
// client-only, and fetched only once a visitor asks for one.
const impl = PREVIEW
  ? await import('./preview/store.js').then((m) => m.mountPreview())
  : DEMO
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
  deleteObject,
  rtdbRef,
  onValue,
  rtdbSet,
  onDisconnect,
} = impl;
