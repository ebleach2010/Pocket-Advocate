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

const KEY = 'pa-demo-store';

// ---------------------------------------------------------------- the store

/** Everything, as path -> plain object. Paths are Firestore paths. */
let docs = new Map();
/** Uploaded bytes, as path -> { name, type, size, url }. */
let files = new Map();
const listeners = new Set();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({
      docs: [...docs.entries()],
      // Object URLs do not survive a reload, so only the metadata is kept and
      // a reloaded page shows the file without a preview. Honest, and better
      // than a broken image.
      files: [...files.entries()].map(([k, v]) => [k, { ...v, url: v.persisted ? v.url : '' }]),
    }));
  } catch { /* quota or private mode: the demo still works for this tab */ }
}

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!raw?.docs) return false;
    docs = new Map(raw.docs);
    files = new Map(raw.files || []);
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
export function reset() {
  docs = new Map();
  files = new Map();
  seed({ set: (p, v) => docs.set(p, v), file: (p, v) => files.set(p, v) });
  persist();
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

function uploadBytesResumable(ref, file) {
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
      .map((p) => ({ __kind: 'file', path: p, name: parts(p).pop() })),
    prefixes: [],
  };
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
  if (!load()) reset();
  // Another tab wrote: repaint. This is what makes the two links one system
  // rather than two demos.
  window.addEventListener('storage', (e) => {
    if (e.key !== KEY) return;
    if (load()) for (const l of listeners) { try { l(''); } catch { /* ignore */ } }
  });

  const auth = makeAuth(admin ? 'admin' : 'client');
  // users/{uid} has to exist, and with the right role, because auth.js reads
  // it to decide which half of the app to show.
  docs.set(`users/${auth.user.uid}`, {
    email: auth.user.email,
    name: auth.user.displayName,
    role: admin ? 'admin' : 'client',
  });
  persist();

  demoApi(role, { docs, files, reset });
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

    rtdbRef,
    onValue,
    rtdbSet,
    onDisconnect,
  };
}

void isSentinel;
