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
  deleteObject,
  rtdbRef,
  onValue,
  rtdbSet,
  onDisconnect,
} = impl;
