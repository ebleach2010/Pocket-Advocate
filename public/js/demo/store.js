// ============================================================================
// THE TEST SUITE — read this before touching it again (2026-08-21).
//
// HOW IT IS ENTERED: two buttons, "Client suite" and "Admin suite", on
// book.html and signin.html. Preview/dev hosts only (same allowlist as
// DEMO_HOST in worker/index.js). Client → /case.html?demo=1&tour=1.
// Admin → /admin.html?demo=admin&tour=1. No email, no code, no account, ever.
//
// Getting here burned a full day across repeated failures. The traps, so the
// NEXT isolated suite takes an hour and not a day:
//
//  1. NO SIGN-UP IN A DEMO. mountDemo once overwrote the seeded profile
//     (first/last name, dob) with a bare {email,name,role}, so booking asked
//     him to make an account. Merge onto the seed; never docs.set over it.
//  2. THE UPDATE TOUR ONLY SHOWS FOR "EXISTING" USERS. unseenVersions()
//     shows a first-ever visitor nothing, and a fresh demo store looks like a
//     first-ever visitor - so the v2.2 tour was unreachable. &tour=1 stamps
//     the previous release (seedLastSeenVersion below) and ONLY &tour=1 does,
//     or the card fires on every harness navigation and blocks their clicks.
//  3. THE LANDING PAGE HIJACKS. index.html bounces an admin-hinted device to
//     /admin.html, which ate the client-suite link on his phone. It must
//     stand aside whenever a demo is running.
//  4. TYPED CODES IN THE EMAIL BOX ARE A TRAP. 1234 in a type=email box on
//     the page the user is actually on (book.html's inline card, not
//     signin.html) just said "invalid email". Buttons, not codes. Codes still
//     work on signin.html as a bonus, nothing more.
//  5. NOTHING SUITE-RELATED MAY DEPEND ON FIREBASE LOADING. The buttons are
//     static markup + classic script, so the suite opens even when the app
//     cannot.
// ============================================================================
//
// The demo's data layer: an in-memory Firestore, Storage and Realtime
// Database with the same exports the real ones have.
//
// WHY THIS SHAPE. The old demo faked the RENDERING - a DEMO_CASE object and a
// handful of `if (DEMO) return renderDemoChat(el)` branches scattered through
// the case page. Every one of those was a branch where the demo showed
// something the product does not do, which is why it could only ever be
// looked at.
//
// Faking the DATA instead means every page, every module and every code path
// runs exactly as it ships. What he clicks is the real thing; only the layer
// underneath is invented.
//
// The store lives in localStorage under one key, so the client link and the
// admin link in the same browser are looking at the SAME case: send a message
// on one, open the other, and it is there. The `storage` event carries it
// live between tabs.
//
// Nothing here is ever served from production - see the asset gate in
// worker/index.js - and firebase.js refuses to load it on the live host.

import { seed } from './seed.js';
import { demoApi } from './api.js';
import { CHANGELOG, VERSION } from '../changelog.js';

const KEY = 'pa-demo-store';

/**
 * What a CLIENT's browser is not allowed to keep on disk.
 *
 * The store persists the whole fake database under one key so both links share
 * a world. On the client link that put the advisor's assessment, the learned
 * profile, the corrections and Eric's private notes into localStorage on a
 * page pretending to be a client's - a JSON blob anyone curious opens first.
 * The real product denies every one of these paths in the Firestore rules;
 * the demo has no rule layer, so it needs its own.
 *
 * The client half runs perfectly without them: nothing on a client page reads
 * any of these. The advocate half keeps everything, because that is his side.
 */
const NOT_FOR_CLIENTS = [/\/advisor\//, /^advisorStyle\//, /^advisorKnowledge\//,
  /^caseMeta\//, /^advisorQueue\//, /\/private\//];
let clientSide = false;

// ---------------------------------------------------------------- the store

/** Everything, as path -> plain object. Paths are Firestore paths. */
let docs = new Map();
/** Uploaded bytes, as path -> { name, type, size, url }. */
let files = new Map();
const listeners = new Set();

// The advocate-only half lives under its OWN key, which a client-side tab
// never writes and never reads. One shared key filtered at write time was a
// trap: the client link's first persist() rewrote the shared blob WITHOUT the
// advisor docs, so opening the client suite first (or just having both tabs
// open) gutted the admin demo - advisor panel, glossary, notes, all blank.
// (Post-2.2 audit, 2026-08-21.) Split, the client tab can only ever touch the
// client-safe half, and what it cannot see it cannot destroy.
const KEY_ADMIN = KEY + '-advocate';
const ADMIN_ONLY = (path) => NOT_FOR_CLIENTS.some((re) => re.test(path));

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      docs: [...docs.entries()].filter(([path]) => !ADMIN_ONLY(path)),
      // Object URLs do not survive a reload, so only the metadata is kept and
      // a reloaded page shows the file without a preview. Honest, and better
      // than a broken image.
      files: [...files.entries()].map(([k, v]) => [k, { ...v, url: v.persisted ? v.url : '' }]),
    }));
    if (!clientSide) {
      localStorage.setItem(KEY_ADMIN, JSON.stringify({
        docs: [...docs.entries()].filter(([path]) => ADMIN_ONLY(path)),
      }));
    }
  } catch { /* quota or private mode: the demo still works for this tab */ }
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw?.docs) return false;
    // In place, never rebound: demoApi captured THESE Map objects at mount,
    // so a cross-tab storage event that rebound them would leave the whole
    // API layer reading and writing an orphan - a booking made after that
    // event landed in a Map nothing persisted or repainted.
    docs.clear();
    for (const [k, v] of raw.docs) docs.set(k, v);
    files.clear();
    for (const [k, v] of raw.files || []) files.set(k, v);
    if (!clientSide) {
      const adm = JSON.parse(localStorage.getItem(KEY_ADMIN) || 'null');
      for (const [k, v] of adm?.docs || []) docs.set(k, v);
      // The seamless door enters through the CLIENT side, whose reset() no
      // longer writes the advocate half to disk (see reset). So the first
      // advocate tab after a client-side seed finds its half missing and
      // fills it in from the fixtures here - without this, the advisor
      // panel, glossary and notes were blank on that first visit.
      if (!adm?.docs?.length) {
        const tmp = new Map();
        seed({ set: (p, v) => tmp.set(p, v), file: () => {} });
        for (const [k, v] of tmp) if (ADMIN_ONLY(k) && !docs.has(k)) docs.set(k, v);
        persist();
      }
    }
    return true;
  } catch { return false; }
}

function fire(path) {
  for (const l of listeners) {
    try { l(path); } catch (err) { console.warn('demo listener:', err); }
  }
  persist();
}

/** Wipe and re-seed. The banner's Reset, so the booking flow can be re-run. */
/**
 * The suite buttons carry &tour=1, and that is the one thing that replays the
 * v2.2 update tour.
 *
 * (Eric, 2026-08-21: "what the client who is already in as a case will see for
 * the update" / "EACH SIDE WITH THE NEW V2.2 TUTORIAL.")
 *
 * unseenVersions() shows a first-ever visitor no changelog at all, on purpose,
 * and an empty demo store looked exactly like a first-ever visitor - so the
 * one screen only an EXISTING client ever sees was unreachable from the test
 * suite. Stamping the previous release makes this browser a client who has
 * been away since the last version, and the card fires exactly as it will for
 * every real client the moment 2.2 ships.
 *
 * Only on &tour=1: each button press replays it on that side, and plain
 * demo navigation (the banner's cross-links, every test harness) is left
 * alone.
 */
function seedLastSeenVersion() {
  try {
    // Relative to the newest LOUD version, not the newest version: quiet
    // versions (footer-only, no card) sit at the top of CHANGELOG and never
    // show a card, so seeding just below one of those would show nothing.
    const loud = CHANGELOG.findIndex((v) => !v.quiet);
    const previous = loud >= 0 ? CHANGELOG[loud + 1] : null;
    localStorage.setItem('pa-seen-version', previous ? previous.version : '0.1');
  } catch { /* storage blocked: the card simply does not show */ }
}

export function reset() {
  // Same rule as load(): empty in place, never rebind (demoApi holds these).
  docs.clear();
  files.clear();
  seed({ set: (p, v) => docs.set(p, v), file: (p, v) => files.set(p, v) });
  persist();
  // The advocate half is written to disk only from an advocate tab. It used
  // to be written from client tabs too (fixture data, so no real secret),
  // but with the seamless door entering through the client side that meant
  // EVERY demo browser kept advisor fixtures on disk - the exact shape of
  // blob the client/advocate key split exists to keep off a client machine.
  // A later advocate tab that finds its half missing re-seeds it in load().
  if (!clientSide) {
    try {
      localStorage.setItem(KEY_ADMIN, JSON.stringify({
        docs: [...docs.entries()].filter(([path]) => ADMIN_ONLY(path)),
      }));
    } catch { /* quota or private mode */ }
  }
  fire('');
}

// ---------------------------------------------------------- path arithmetic

const parts = (p) => String(p).split('/').filter(Boolean);
const isDocPath = (p) => parts(p).length % 2 === 0;

/** Documents directly inside a collection path (not in its sub-collections). */
function childrenOf(collectionPath) {
  const depth = parts(collectionPath).length + 1;
  const prefix = `${collectionPath}/`;
  const out = [];
  for (const [path, data] of docs) {
    if (!path.startsWith(prefix)) continue;
    if (parts(path).length !== depth) continue;
    out.push({ path, id: parts(path).pop(), data });
  }
  return out;
}

// ------------------------------------------------------- values and sentinels

const SERVER_TS = { __sentinel: 'ts' };
const isSentinel = (v) => v && typeof v === 'object' && v.__sentinel;

function resolve(value, existing) {
  if (!value || typeof value !== 'object') return value;
  if (value.__sentinel === 'ts') return new Date();
  if (value.__sentinel === 'arrayUnion') {
    const have = Array.isArray(existing) ? existing : [];
    const add = value.values.filter((v) => !have.some((h) => JSON.stringify(h) === JSON.stringify(v)));
    return [...have, ...add];
  }
  if (Array.isArray(value)) return value.map((v) => resolve(v));
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = resolve(v, existing?.[k]);
  return out;
}

/** Firestore hands timestamps back with .toDate(); a lot of code calls it. */
function hydrate(value) {
  if (value instanceof Date) return stamp(value);
  if (Array.isArray(value)) return value.map(hydrate);
  if (value && typeof value === 'object') {
    // An ISO string that came back from localStorage is a date again.
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = hydrate(v);
    return out;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) {
    return stamp(new Date(value));
  }
  return value;
}

function stamp(date) {
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
    toJSON: () => date.toISOString(),
    valueOf: () => date.getTime(),
  };
}

// ------------------------------------------------------------ the Firestore

const snapOf = (path, data) => ({
  id: parts(path).pop(),
  ref: { path },
  exists: () => data !== undefined,
  data: () => (data === undefined ? undefined : hydrate(data)),
  get: (k) => (data === undefined ? undefined : hydrate(data[k])),
});

function docRef(_db, ...segs) {
  // doc(db, 'users', uid) and doc(db, 'users/uid') both happen in this app.
  const path = segs.flatMap((s) => (typeof s === 'string' ? s.split('/') : [s]))
    .filter((s) => typeof s === 'string' && s).join('/');
  if (!isDocPath(path)) throw new Error(`demo: not a document path: ${path}`);
  return { __kind: 'doc', path };
}

function collRef(dbOrRef, ...segs) {
  const base = dbOrRef && dbOrRef.__kind === 'doc' ? dbOrRef.path : '';
  const path = [base, ...segs].flatMap((s) => (typeof s === 'string' ? s.split('/') : []))
    .filter(Boolean).join('/');
  if (isDocPath(path)) throw new Error(`demo: not a collection path: ${path}`);
  return { __kind: 'coll', path, constraints: [] };
}

const whereC = (field, op, value) => ({ t: 'where', field, op, value });
const orderByC = (field, dir = 'asc') => ({ t: 'order', field, dir });
const limitC = (n) => ({ t: 'limit', n });

function queryOf(ref, ...constraints) {
  return { __kind: 'coll', path: ref.path, constraints: [...(ref.constraints || []), ...constraints] };
}

const valueAt = (data, field) =>
  String(field).split('.').reduce((o, k) => (o == null ? o : o[k]), data);

function runQuery(ref) {
  let rows = childrenOf(ref.path);
  for (const c of ref.constraints || []) {
    if (c.t === 'where') {
      rows = rows.filter((r) => {
        const v = valueAt(r.data, c.field);
        if (c.op === '==') return JSON.stringify(v) === JSON.stringify(c.value);
        if (c.op === '!=') return JSON.stringify(v) !== JSON.stringify(c.value);
        if (c.op === 'in') return (c.value || []).some((x) => JSON.stringify(x) === JSON.stringify(v));
        if (c.op === '>') return v > c.value;
        if (c.op === '>=') return v >= c.value;
        if (c.op === '<') return v < c.value;
        if (c.op === '<=') return v <= c.value;
        return true;
      });
    }
  }
  for (const c of ref.constraints || []) {
    if (c.t === 'order') {
      const dir = c.dir === 'desc' ? -1 : 1;
      rows.sort((a, b) => {
        const x = valueAt(a.data, c.field);
        const y = valueAt(b.data, c.field);
        const ax = x instanceof Date ? x.getTime() : (typeof x === 'string' ? Date.parse(x) || x : x);
        const by = y instanceof Date ? y.getTime() : (typeof y === 'string' ? Date.parse(y) || y : y);
        return ax < by ? -dir : ax > by ? dir : 0;
      });
    }
  }
  for (const c of ref.constraints || []) {
    if (c.t === 'limit') rows = rows.slice(0, c.n);
  }
  return rows;
}

const querySnap = (rows) => {
  const list = rows.map((r) => snapOf(r.path, r.data));
  return {
    docs: list,
    size: list.length,
    empty: list.length === 0,
    forEach: (fn) => list.forEach(fn),
  };
};

async function getDocFn(ref) {
  return snapOf(ref.path, docs.get(ref.path));
}

async function getDocsFn(ref) {
  return querySnap(runQuery(ref));
}

async function setDocFn(ref, data, opts = {}) {
  const prior = docs.get(ref.path);
  const next = opts.merge ? { ...(prior || {}), ...resolve(data, prior) } : resolve(data, prior);
  docs.set(ref.path, next);
  fire(ref.path);
}

async function updateDocFn(ref, data) {
  const prior = docs.get(ref.path) || {};
  const next = { ...prior };
  for (const [k, v] of Object.entries(data)) {
    // Dotted field paths are how the app writes lastMessage.emailed.
    if (k.includes('.')) {
      const keys = k.split('.');
      let cur = next;
      for (const key of keys.slice(0, -1)) {
        cur[key] = { ...(cur[key] || {}) };
        cur = cur[key];
      }
      cur[keys[keys.length - 1]] = resolve(v, undefined);
    } else {
      next[k] = resolve(v, prior[k]);
    }
  }
  docs.set(ref.path, next);
  fire(ref.path);
}

let addSeq = 0;
async function addDocFn(ref, data) {
  const id = `d${Date.now().toString(36)}${(++addSeq).toString(36)}`;
  const path = `${ref.path}/${id}`;
  docs.set(path, resolve(data));
  fire(path);
  return { __kind: 'doc', path, id };
}

/**
 * The one that makes the demo feel alive. Fires now, and again on every write
 * touching this path or collection - including a write from the OTHER tab, so
 * a message sent on the client link appears on the admin link.
 */
function onSnapshotFn(ref, next, error) {
  const cb = typeof next === 'function' ? next : next?.next;
  const err = typeof error === 'function' ? error : next?.error;
  const isDoc = ref.__kind === 'doc';

  const emit = () => {
    try {
      cb(isDoc ? snapOf(ref.path, docs.get(ref.path)) : querySnap(runQuery(ref)));
    } catch (e) {
      if (err) err(e); else console.warn('demo snapshot:', e);
    }
  };

  const listener = (path) => {
    if (!path) return emit();                       // a reset repaints everything
    if (isDoc ? path === ref.path : path.startsWith(`${ref.path}/`)) emit();
  };
  listeners.add(listener);
  setTimeout(emit, 0);
  return () => listeners.delete(listener);
}

// -------------------------------------------------------------- the Storage

function storageRef(_storage, path) {
  return { __kind: 'file', path: String(path || '') };
}

function uploadBytesResumable(ref, file, metadata) {
  // The real thing hands back a task you subscribe to. So does this one, with
  // a couple of progress ticks so the bar he sees is the bar that ships.
  const total = file.size || 1;
  const handlers = { state_changed: [], done: [], fail: [] };
  const task = {
    on(_event, onProgress, onError, onDone) {
      if (onProgress) handlers.state_changed.push(onProgress);
      if (onError) handlers.fail.push(onError);
      if (onDone) handlers.done.push(onDone);
    },
    snapshot: { ref },
  };
  let sent = 0;
  const tick = setInterval(() => {
    sent = Math.min(total, sent + Math.ceil(total / 3));
    handlers.state_changed.forEach((f) => f({ bytesTransferred: sent, totalBytes: total, ref }));
    if (sent >= total) {
      clearInterval(tick);
      // The real bytes he picked, so an uploaded photo actually displays and
      // the lightbox works on it.
      let url = '';
      try { url = URL.createObjectURL(file); } catch { /* no preview, still listed */ }
      files.set(ref.path, {
        name: file.name || parts(ref.path).pop(),
        type: file.type || '',
        size: file.size || 0,
        at: new Date().toISOString(),
        url,
        // The real thing carries custom metadata alongside the bytes, and the
        // file listings read the category off it. Without this the demo can
        // upload a call summary and then show it as a report, which is a demo
        // disagreeing with the app about the one thing it was driven to check.
        meta: (metadata && metadata.customMetadata) || null,
      });
      persist();
      handlers.done.forEach((f) => f({ ref, bytesTransferred: total, totalBytes: total }));
    }
  }, 220);
  return task;
}

async function listAll(ref) {
  const prefix = `${ref.path}/`;
  return {
    items: [...files.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => ({ __kind: 'file', path: p, fullPath: p, name: parts(p).pop() })),
    prefixes: [],
  };
}

async function deleteObject(ref) {
  // Eric's own prep shelf can be cleared, so the demo has to be able to
  // clear it too - otherwise the one control that removes a private document
  // is the one control no drive can exercise.
  files.delete(ref.path);
  fire(ref.path);
}

async function getDownloadURL(ref) {
  const f = files.get(ref.path);
  if (!f) throw new Error('demo: no such file');
  return f.url || 'data:text/plain,demo';
}

async function getMetadata(ref) {
  const f = files.get(ref.path) || {};
  return {
    name: f.name || parts(ref.path).pop(),
    size: f.size || 0,
    contentType: f.type || '',
    timeCreated: f.at || new Date().toISOString(),
    // Absent on a file uploaded without any, exactly as Firebase leaves it,
    // so both listings exercise their own `|| ''` fallback here too.
    customMetadata: f.meta || undefined,
  };
}

// ------------------------------------------------------------------- presence

function rtdbRef(_rtdb, path) { return { __kind: 'rtdb', path: String(path) }; }
function onValue(ref, cb) {
  // He is online in the demo, so the client's status dot has something to say.
  setTimeout(() => cb({ val: () => (ref.path === 'presence/eric' ? true : null) }), 0);
  return () => {};
}
async function rtdbSet() { /* presence is decoration here */ }
function onDisconnect() { return { set: async () => {} }; }

// ----------------------------------------------------------------- the person

function makeAuth(role) {
  const uid = role === 'admin' ? 'demo-admin' : 'demo-client';
  const user = {
    uid,
    email: role === 'admin' ? 'you@pocketadvocate.demo' : 'jordan@example.demo',
    displayName: role === 'admin' ? 'Eric' : 'Jordan Avery',
    getIdToken: async () => 'demo',
  };
  return { user, currentUser: user };
}

// --------------------------------------------------------------------- mount

export function mountDemo(role) {
  const admin = role === 'admin';
  // Set before anything reads or writes, so the first persist already filters.
  clientSide = !admin;
  if (!load()) reset();
  try {
    if (new URLSearchParams(location.search).get('tour')) seedLastSeenVersion();
  } catch { /* no URL to read: leave it alone */ }
  // Another tab wrote: repaint. This is what makes the two links one system
  // rather than two demos.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY && e.key !== KEY_ADMIN) return;
    if (load()) for (const l of listeners) { try { l(''); } catch { /* ignore */ } }
  });

  const auth = makeAuth(admin ? 'admin' : 'client');
  // users/{uid} has to exist, and with the right role, because auth.js reads
  // it to decide which half of the app to show.
  //
  // Merged onto whatever the seed put there, not written over it. Replacing it
  // wholesale threw away the seeded first name, last name and date of birth,
  // so the booking page thought the profile was incomplete and asked him to
  // fill it in - which is the account step he does not want in a demo.
  docs.set(`users/${auth.user.uid}`, {
    ...(docs.get(`users/${auth.user.uid}`) || {}),
    email: auth.user.email,
    name: auth.user.displayName,
    role: admin ? 'admin' : 'client',
  });
  persist();

  // `fire` rides along so an api-route write to a message (a reaction, a
  // lane stamp) repaints the open chat the way a real Firestore write would,
  // instead of waiting for the next unrelated write to shake the snapshot.
  // `persist` too, because a route that writes straight into `docs` (the work
  // clock does) was only changing the in-memory copy: the next page load read
  // the seed back and the change vanished. Harmless for a reaction on a
  // message, wrong for a clock, whose whole behaviour is about what survives
  // walking from one page to another.
  demoApi(role, { docs, files, reset, fire, persist });
  import('./banner.js').then((m) => {
    if (document.body) m.mountBanner(role);
    else document.addEventListener('DOMContentLoaded', () => m.mountBanner(role));
  }).catch(() => { /* the demo works without the strip; it just says less */ });

  return {
    auth,
    db: { __kind: 'db' },
    storage: { __kind: 'storage' },
    rtdb: { __kind: 'rtdb' },

    onAuthStateChanged: (_auth, cb) => { setTimeout(() => cb(auth.user), 0); return () => {}; },
    sendSignInLinkToEmail: async () => {},
    isSignInWithEmailLink: () => false,
    signInWithEmailLink: async () => ({ user: auth.user }),
    signInWithCustomToken: async () => ({ user: auth.user }),
    signOut: async () => {},

    collection: collRef,
    doc: docRef,
    getDoc: getDocFn,
    getDocs: getDocsFn,
    setDoc: setDocFn,
    addDoc: addDocFn,
    updateDoc: updateDocFn,
    onSnapshot: onSnapshotFn,
    query: queryOf,
    where: whereC,
    orderBy: orderByC,
    limit: limitC,
    serverTimestamp: () => SERVER_TS,
    arrayUnion: (...values) => ({ __sentinel: 'arrayUnion', values }),

    ref: storageRef,
    uploadBytesResumable,
    listAll,
    getDownloadURL,
    getMetadata,
    deleteObject,

    rtdbRef,
    onValue,
    rtdbSet,
    onDisconnect,
  };
}

void isSentinel;
