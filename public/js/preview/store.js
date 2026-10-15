// THE CASE PREVIEW (Eric, 2026-10-15: "This showcase suite should exhibit
// every feature and be fully interactable. They can even chat and upload
// documents but they get deleted as soon as they exit").
//
// A visitor walks a whole case as its client, Joe Bloe, with nobody behind
// it. This module stands in for the database and the file store inside the
// visitor's own browser tab, and nothing they do leaves it: no message, no
// file and no signature reaches the server. It lives in sessionStorage, so
// closing the tab ends it, and Exit (bar.js) wipes it on the spot.
//
// Same exports as firebase-real.js, so every client page and module runs
// exactly as it ships. Only the layer underneath is pretend.
import { seedPreview, PREVIEW_UID } from './seed.js';
import { previewApi } from './api.js';

export const STORE_KEY = 'pa-preview-store';
export const FLAG_KEY = 'pa-preview';

const docs = new Map();
const files = new Map();
const listeners = new Set();

function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify({
      docs: [...docs.entries()],
      // A file's bytes ride along as a data: URL when they are small enough to
      // keep; a big upload keeps its name and size and opens until a reload.
      files: [...files.entries()].map(([k, v]) => [k, { ...v, url: /^data:/.test(v.url || '') ? v.url : '' }]),
    }));
  } catch { /* storage full: this page still works, the next one starts over */ }
}

function load() {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORE_KEY) || 'null');
    if (!raw?.docs) return false;
    for (const [k, v] of raw.docs) docs.set(k, v);
    for (const [k, v] of raw.files || []) files.set(k, v);
    return true;
  } catch { return false; }
}

function fire(path) {
  for (const l of listeners) {
    try { l(path); } catch (err) { console.warn('preview listener:', err); }
  }
  persist();
}

// ---------------------------------------------------------- path arithmetic

const parts = (p) => String(p).split('/').filter(Boolean);
const isDocPath = (p) => parts(p).length % 2 === 0;

function childrenOf(collectionPath) {
  const depth = parts(collectionPath).length + 1;
  const prefix = `${collectionPath}/`;
  const out = [];
  for (const [path, data] of docs) {
    if (!path.startsWith(prefix) || parts(path).length !== depth) continue;
    out.push({ path, id: parts(path).pop(), data });
  }
  return out;
}

// ------------------------------------------------------- values and sentinels

const SERVER_TS = { __sentinel: 'ts' };

function resolve(value, existing) {
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value;
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

function stamp(date) {
  return {
    toDate: () => date,
    toMillis: () => date.getTime(),
    toJSON: () => date.toISOString(),
    valueOf: () => date.getTime(),
  };
}

/** Timestamps come back with .toDate(), as Firestore hands them over. */
function hydrate(value) {
  if (value instanceof Date) return stamp(value);
  if (Array.isArray(value)) return value.map(hydrate);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = hydrate(v);
    return out;
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) return stamp(new Date(value));
  return value;
}

// ------------------------------------------------------------ the database

const snapOf = (path, data) => ({
  id: parts(path).pop(),
  ref: { path },
  exists: () => data !== undefined,
  data: () => (data === undefined ? undefined : hydrate(data)),
  get: (k) => (data === undefined ? undefined : hydrate(data[k])),
});

function docRef(_db, ...segs) {
  const path = segs.flatMap((s) => (typeof s === 'string' ? s.split('/') : [s]))
    .filter((s) => typeof s === 'string' && s).join('/');
  if (!isDocPath(path)) throw new Error(`preview: not a document path: ${path}`);
  return { __kind: 'doc', path };
}

function collRef(dbOrRef, ...segs) {
  const base = dbOrRef && dbOrRef.__kind === 'doc' ? dbOrRef.path : '';
  const path = [base, ...segs].flatMap((s) => (typeof s === 'string' ? s.split('/') : []))
    .filter(Boolean).join('/');
  if (isDocPath(path)) throw new Error(`preview: not a collection path: ${path}`);
  return { __kind: 'coll', path, constraints: [] };
}

const whereC = (field, op, value) => ({ t: 'where', field, op, value });
const orderByC = (field, dir = 'asc') => ({ t: 'order', field, dir });
const limitC = (n) => ({ t: 'limit', n });
const queryOf = (ref, ...constraints) => ({ __kind: 'coll', path: ref.path, constraints: [...(ref.constraints || []), ...constraints] });
const valueAt = (data, field) => String(field).split('.').reduce((o, k) => (o == null ? o : o[k]), data);
const sortable = (x) => (x instanceof Date ? x.getTime() : (typeof x === 'string' ? Date.parse(x) || x : x));

function runQuery(ref) {
  let rows = childrenOf(ref.path);
  for (const c of ref.constraints || []) {
    if (c.t !== 'where') continue;
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
  for (const c of ref.constraints || []) {
    if (c.t !== 'order') continue;
    const dir = c.dir === 'desc' ? -1 : 1;
    rows.sort((a, b) => {
      const x = sortable(valueAt(a.data, c.field));
      const y = sortable(valueAt(b.data, c.field));
      return x < y ? -dir : x > y ? dir : 0;
    });
  }
  for (const c of ref.constraints || []) if (c.t === 'limit') rows = rows.slice(0, c.n);
  return rows;
}

const querySnap = (rows) => {
  const list = rows.map((r) => snapOf(r.path, r.data));
  return { docs: list, size: list.length, empty: list.length === 0, forEach: (fn) => list.forEach(fn) };
};

async function setDocFn(ref, data, opts = {}) {
  const prior = docs.get(ref.path);
  docs.set(ref.path, opts.merge ? { ...(prior || {}), ...resolve(data, prior) } : resolve(data, prior));
  fire(ref.path);
}

async function updateDocFn(ref, data) {
  const prior = docs.get(ref.path) || {};
  const next = { ...prior };
  for (const [k, v] of Object.entries(data)) {
    if (k.includes('.')) {
      const keys = k.split('.');
      let cur = next;
      for (const key of keys.slice(0, -1)) { cur[key] = { ...(cur[key] || {}) }; cur = cur[key]; }
      cur[keys[keys.length - 1]] = resolve(v, undefined);
    } else next[k] = resolve(v, prior[k]);
  }
  docs.set(ref.path, next);
  fire(ref.path);
}

let addSeq = 0;
async function addDocFn(ref, data) {
  const id = `p${Date.now().toString(36)}${(++addSeq).toString(36)}`;
  const path = `${ref.path}/${id}`;
  docs.set(path, resolve(data));
  fire(path);
  return { __kind: 'doc', path, id };
}

/** Fires now, and again on every write touching this path or collection. */
function onSnapshotFn(ref, next, error) {
  const cb = typeof next === 'function' ? next : next?.next;
  const err = typeof error === 'function' ? error : next?.error;
  const isDoc = ref.__kind === 'doc';
  const emit = () => {
    try { cb(isDoc ? snapOf(ref.path, docs.get(ref.path)) : querySnap(runQuery(ref))); } catch (e) { if (err) err(e); }
  };
  const listener = (path) => {
    if (!path) return emit();
    if (isDoc ? path === ref.path : path.startsWith(`${ref.path}/`)) emit();
  };
  listeners.add(listener);
  setTimeout(emit, 0);
  return () => listeners.delete(listener);
}

// -------------------------------------------------------------- the files

const KEEP_BYTES = 1_500_000;
const asDataUrl = (file) => new Promise((resolveUrl) => {
  try {
    const r = new FileReader();
    r.onload = () => resolveUrl(String(r.result || ''));
    r.onerror = () => resolveUrl('');
    r.readAsDataURL(file);
  } catch { resolveUrl(''); }
});

function uploadBytesResumable(ref, file, metadata) {
  const total = file.size || 1;
  const handlers = { progress: [], done: [], fail: [] };
  const task = {
    on(_event, onProgress, onError, onDone) {
      if (onProgress) handlers.progress.push(onProgress);
      if (onError) handlers.fail.push(onError);
      if (onDone) handlers.done.push(onDone);
    },
    snapshot: { ref },
  };
  let sent = 0;
  const tick = setInterval(async () => {
    sent = Math.min(total, sent + Math.ceil(total / 3));
    handlers.progress.forEach((f) => f({ bytesTransferred: sent, totalBytes: total, ref }));
    if (sent < total) return;
    clearInterval(tick);
    // The real bytes they picked, so the file opens like any upload.
    let url = '';
    if ((file.size || 0) <= KEEP_BYTES) url = await asDataUrl(file);
    if (!url) { try { url = URL.createObjectURL(file); } catch { /* listed, not openable */ } }
    files.set(ref.path, {
      name: file.name || parts(ref.path).pop(), type: file.type || '', size: file.size || 0,
      at: new Date().toISOString(), url, meta: (metadata && metadata.customMetadata) || null,
    });
    persist();
    handlers.done.forEach((f) => f({ ref, bytesTransferred: total, totalBytes: total }));
  }, 200);
  return task;
}

async function listAll(ref) {
  const prefix = `${ref.path}/`;
  return {
    items: [...files.keys()].filter((p) => p.startsWith(prefix) && !p.slice(prefix.length).includes('/'))
      .map((p) => ({ __kind: 'file', path: p, fullPath: p, name: parts(p).pop() })),
    prefixes: [],
  };
}

async function deleteObject(ref) { files.delete(ref.path); fire(ref.path); }

async function getDownloadURL(ref) {
  const f = files.get(ref.path);
  if (!f) throw new Error('preview: no such file');
  return f.url || 'data:text/plain,This%20file%20was%20only%20kept%20until%20the%20page%20reloaded.';
}

async function getMetadata(ref) {
  const f = files.get(ref.path) || {};
  return {
    name: f.name || parts(ref.path).pop(), size: f.size || 0, contentType: f.type || '',
    timeCreated: f.at || new Date().toISOString(), customMetadata: f.meta || undefined,
  };
}

// ------------------------------------------------------------------ mount

/** Everything the visitor did, gone. Exit calls this before it leaves. */
export function wipePreview() {
  for (const f of files.values()) { if (/^blob:/.test(f.url || '')) { try { URL.revokeObjectURL(f.url); } catch { /* gone */ } } }
  docs.clear();
  files.clear();
  try { sessionStorage.removeItem(STORE_KEY); sessionStorage.removeItem(FLAG_KEY); } catch { /* nothing kept */ }
}

export function mountPreview() {
  if (!load()) {
    seedPreview(new Date(), { set: (p, v) => docs.set(p, v), file: (p, v) => files.set(p, v) });
    persist();
  }
  const user = {
    uid: PREVIEW_UID,
    email: docs.get(`users/${PREVIEW_UID}`)?.email || '',
    displayName: docs.get(`users/${PREVIEW_UID}`)?.name || '',
    getIdToken: async () => 'preview',
  };
  const auth = { currentUser: user };
  previewApi({ docs, files, fire, persist });
  import('./bar.js').then((m) => {
    if (document.body) m.mountBar(wipePreview);
    else document.addEventListener('DOMContentLoaded', () => m.mountBar(wipePreview));
  }).catch(() => { /* the preview still works; Exit is also the home link */ });

  return {
    auth,
    db: { __kind: 'db' },
    storage: { __kind: 'storage' },
    rtdb: { __kind: 'rtdb' },
    onAuthStateChanged: (_auth, cb) => { setTimeout(() => cb(user), 0); return () => {}; },
    sendSignInLinkToEmail: async () => {},
    isSignInWithEmailLink: () => false,
    signInWithEmailLink: async () => ({ user }),
    signInWithCustomToken: async () => ({ user }),
    // Signing out of the preview is leaving it.
    signOut: async () => { wipePreview(); location.assign('/'); },
    collection: collRef,
    doc: docRef,
    getDoc: async (ref) => snapOf(ref.path, docs.get(ref.path)),
    getDocs: async (ref) => querySnap(runQuery(ref)),
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
    ref: (_storage, path) => ({ __kind: 'file', path: String(path || '') }),
    uploadBytesResumable,
    listAll,
    getDownloadURL,
    getMetadata,
    deleteObject,
    rtdbRef: (_rtdb, path) => ({ __kind: 'rtdb', path: String(path) }),
    onValue: (_ref, cb) => { setTimeout(() => cb({ val: () => null }), 0); return () => {}; },
    rtdbSet: async () => {},
    onDisconnect: () => ({ set: async () => {} }),
  };
}
