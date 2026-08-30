// Minimal Firestore REST client for the Worker. All writes to cases and
// availability go through here with the service account — the browser can
// never create a case or touch a slot (see firestore.rules).

import { getAccessToken } from './google-auth.js';

function baseUrl(env) {
  // FIRESTORE_HOST is a TEST seam: the local queue harness points it at a
  // stub so the real state machine can run end to end through /__scheduled.
  // Production never sets it and gets the real host.
  return `${env.FIRESTORE_HOST || 'https://firestore.googleapis.com'}/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
}

async function authedFetch(env, url, init = {}) {
  const token = await getAccessToken(env);
  return fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      ...(init.headers || {}),
    },
  });
}

/** Returns { data, updateTime } or null if the document does not exist. */
export async function getDoc(env, path) {
  const res = await authedFetch(env, `${baseUrl(env)}/${path}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`firestore get ${path}: ${res.status} ${await res.text()}`);
  const doc = await res.json();
  return { data: fromFields(doc.fields || {}), updateTime: doc.updateTime };
}

/**
 * Patch a document. options:
 *   ifUpdateTime — fail (409) unless the doc's updateTime still matches (optimistic lock)
 *   mustNotExist — create-only
 *   mask         — array of field paths to replace (others untouched)
 * Returns true on success, false on a failed precondition.
 */
export async function patchDoc(env, path, data, options = {}) {
  const params = new URLSearchParams();
  if (options.mask) for (const f of options.mask) params.append('updateMask.fieldPaths', f);
  if (options.ifUpdateTime) params.set('currentDocument.updateTime', options.ifUpdateTime);
  if (options.mustNotExist) params.set('currentDocument.exists', 'false');
  const res = await authedFetch(env, `${baseUrl(env)}/${path}?${params}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: toFields(data) }),
  });
  if (res.status === 409 || res.status === 412 || res.status === 400) {
    // 409/412: precondition failed (lost the race). Surface as false, not a throw.
    const text = await res.text();
    if (/precondition|already exists|FAILED_PRECONDITION/i.test(text)) return false;
    throw new Error(`firestore patch ${path}: ${res.status} ${text}`);
  }
  if (!res.ok) throw new Error(`firestore patch ${path}: ${res.status} ${await res.text()}`);
  return true;
}

/**
 * Create up to 500 documents in ONE request (`:batchWrite`) — Workers cap
 * outbound calls per request, so bulk slot creation cannot loop patchDoc.
 * Each write is create-only; returns { created, skipped } where skipped
 * counts docs that already existed.
 */
export async function batchCreate(env, entries) {
  if (!entries.length) return { created: 0, skipped: 0 };
  const docBase = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const res = await authedFetch(env, `${baseUrl(env)}:batchWrite`, {
    method: 'POST',
    body: JSON.stringify({
      writes: entries.map((e) => ({
        update: { name: `${docBase}/${e.path}`, fields: toFields(e.data) },
        currentDocument: { exists: false },
      })),
    }),
  });
  if (!res.ok) throw new Error(`firestore batchWrite: ${res.status} ${await res.text()}`);
  const out = await res.json();
  let created = 0;
  let skipped = 0;
  for (const s of out.status || []) (s.code ? skipped++ : created++);
  return { created, skipped };
}

/**
 * Delete up to 500 documents in ONE request (`:batchWrite`), for the same
 * reason batchCreate exists: bulk slot clearing cannot loop deleteDoc inside
 * one Worker invocation. A doc already gone counts as deleted, because the
 * end state is what was asked for. Returns { deleted }.
 */
export async function batchDelete(env, paths) {
  if (!paths.length) return { deleted: 0 };
  const docBase = `projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;
  const res = await authedFetch(env, `${baseUrl(env)}:batchWrite`, {
    method: 'POST',
    body: JSON.stringify({ writes: paths.map((p) => ({ delete: `${docBase}/${p}` })) }),
  });
  if (!res.ok) throw new Error(`firestore batchWrite: ${res.status} ${await res.text()}`);
  const out = await res.json();
  let deleted = 0;
  for (const s of out.status || []) if (!s.code) deleted++;
  return { deleted };
}

/**
 * List a subcollection by path (e.g. `cases/abc/chat`). `queryDocs` can only
 * reach top-level collections — a `runQuery` against a subcollection has to be
 * posted to the parent document — so plain listing is both simpler and enough
 * when there is nothing to filter on.
 *
 * `orderBy` takes Firestore's syntax: "ts" ascending, "ts desc" descending.
 */
/**
 * List a collection.
 *
 * `all: true` follows nextPageToken to the end. Without it this returns one
 * page and no indication that there was another, which is fine for the callers
 * that want a bounded read (a shelf, a dropdown) and quietly wrong for anything
 * that means "every document". A sweep that believes it saw everything is worse
 * than one that knows it did not.
 */
export async function listDocs(env, collectionPath, { pageSize = 100, orderBy, all = false } = {}) {
  const out = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ pageSize: String(pageSize) });
    if (orderBy) params.set('orderBy', orderBy);
    if (pageToken) params.set('pageToken', pageToken);
    const res = await authedFetch(env, `${baseUrl(env)}/${collectionPath}?${params}`);
    if (!res.ok) throw new Error(`firestore list ${collectionPath}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    for (const d of page.documents || []) {
      out.push({ id: d.name.split('/').pop(), data: fromFields(d.fields || {}) });
    }
    // One page unless asked, so every existing caller behaves exactly as before.
    pageToken = all ? (page.nextPageToken || '') : '';
  } while (pageToken);
  return out;
}

/** Delete a document. Returns true (idempotent — deleting a missing doc is fine). */
export async function deleteDoc(env, path) {
  const res = await authedFetch(env, `${baseUrl(env)}/${path}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404)
    throw new Error(`firestore delete ${path}: ${res.status} ${await res.text()}`);
  return true;
}

/** Run a simple single-collection query. Returns array of { id, data }. */
export async function queryDocs(env, collectionId, filters, limit = 20) {
  const structuredQuery = {
    from: [{ collectionId }],
    where: {
      compositeFilter: {
        op: 'AND',
        // Firestore rejects EQUAL/NOT_EQUAL against null on a fieldFilter —
        // null comparisons have to go through unaryFilter instead.
        filters: filters.map(([field, op, value]) => (
          value === null
            ? { unaryFilter: { field: { fieldPath: field }, op: op === 'NOT_EQUAL' ? 'IS_NOT_NULL' : 'IS_NULL' } }
            : { fieldFilter: { field: { fieldPath: field }, op, value: toValue(value) } }
        )),
      },
    },
    limit,
  };
  const res = await authedFetch(env, `${baseUrl(env)}:runQuery`, {
    method: 'POST',
    body: JSON.stringify({ structuredQuery }),
  });
  if (!res.ok) throw new Error(`firestore query ${collectionId}: ${res.status} ${await res.text()}`);
  const rows = await res.json();
  return rows
    .filter((r) => r.document)
    .map((r) => ({
      id: r.document.name.split('/').pop(),
      data: fromFields(r.document.fields || {}),
    }));
}

// ---- JSON <-> Firestore value encoding ----

export function toFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fields[k] = toValue(v);
  }
  return fields;
}

function toValue(v) {
  if (v === null) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number')
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') return { mapValue: { fields: toFields(v) } };
  throw new Error(`unsupported value type: ${typeof v}`);
}

function fromFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) obj[k] = fromValue(v);
  return obj;
}

function fromValue(v) {
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) return fromFields(v.mapValue.fields || {});
  return null;
}
