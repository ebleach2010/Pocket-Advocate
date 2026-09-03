// Reading the case's Storage bucket with the service account.
//
// Why this exists: the client's Documents page uploads straight to Firebase
// Storage from the browser. No Worker call, no chat message, nothing written
// to Firestore. The advisor's automatic file pickup walked chat messages, so a
// document uploaded through the page LABELLED "Tap to add labs, imaging, or
// records" — the primary intake — was invisible to it. That is the bug Eric
// reported as "I added the photos for the doc to look at. It was like 6."
//
// Listing the bucket instead of trusting a notification also fixes it
// retroactively: files uploaded before any of this shipped are found on the
// next pass, because they are simply there.

import { getAccessToken } from './google-auth.js';

// Firebase's default bucket for this project. The browser SDK is configured
// with the same name in public/js/firebase-config.js; if that ever changes,
// both move together.
const BUCKET = 'pocket-advocate-f3148.firebasestorage.app';
const GCS = 'https://storage.googleapis.com/storage/v1/b';
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_only';

/** The media URL for one object. Needs a bearer token; see mediaFetch below. */
export function objectMediaUrl(path) {
  return `${GCS}/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
}

/** Fetch one object's bytes with the service account. */
export async function mediaFetch(env, path) {
  const token = await getAccessToken(env, SCOPE);
  return fetch(objectMediaUrl(path), { headers: { authorization: `Bearer ${token}` } });
}

/**
 * Every object under one prefix, oldest first.
 *
 * Returns [{ name, path, contentType, size, at }] where `name` is the leaf
 * file name as a person would recognise it and `path` is the full object path,
 * which is also the identity the advisor dedupes on.
 */
export async function listFiles(env, prefix, { max = 100 } = {}) {
  const token = await getAccessToken(env, SCOPE);
  const url = new URL(`${GCS}/${BUCKET}/o`);
  url.searchParams.set('prefix', prefix);
  url.searchParams.set('maxResults', String(max));
  // Flat listing: these folders hold files, not sub-folders.
  const res = await fetch(url, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`storage list ${prefix}: ${res.status} ${await res.text()}`);
  const out = await res.json();
  return (out.items || [])
    .filter((o) => o.name && !o.name.endsWith('/'))
    .map((o) => ({
      // Uploads are stored as "<timestamp>-<original name>" by case.js. Show
      // the part a person recognises, keep the whole path as the identity.
      name: leafName(o.name),
      path: o.name,
      contentType: o.contentType || '',
      size: Number(o.size) || 0,
      at: o.timeCreated ? new Date(o.timeCreated).getTime() : 0,
    }))
    .sort((a, b) => a.at - b.at);
}

/**
 * Delete one object with the service account. A missing object counts as
 * deleted: the point is that it is gone, not who got there first. Uses the
 * read_write scope only here; everything else in this file stays read-only.
 */
export async function deleteFile(env, path) {
  const token = await getAccessToken(env, 'https://www.googleapis.com/auth/devstorage.read_write');
  const res = await fetch(`${GCS}/${BUCKET}/o/${encodeURIComponent(path)}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok && res.status !== 404)
    throw new Error(`storage delete ${path}: ${res.status} ${await res.text()}`);
}

/**
 * Write one object with the service account. The ONLY writer of the
 * personal/ prefix (Eric, 2026-09-03: "uploads of documents just for me...
 * ONLY visible to me"): storage.rules deny that prefix to every browser, so
 * the service account is the one identity that can put a byte there or read
 * one back, and this Worker is the one place that identity is used.
 */
export async function putFile(env, path, bytes, contentType) {
  const token = await getAccessToken(env, 'https://www.googleapis.com/auth/devstorage.read_write');
  const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${BUCKET}/o`);
  url.searchParams.set('uploadType', 'media');
  url.searchParams.set('name', path);
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': contentType || 'application/octet-stream' },
    body: bytes,
  });
  if (!res.ok) throw new Error(`storage put ${path}: ${res.status} ${await res.text()}`);
  const o = await res.json();
  return {
    name: leafName(o.name || path),
    path: o.name || path,
    contentType: o.contentType || contentType || '',
    size: Number(o.size) || (bytes.byteLength ?? 0),
    at: o.timeCreated ? new Date(o.timeCreated).getTime() : Date.now(),
  };
}

function leafName(objectPath) {
  const leaf = objectPath.split('/').pop() || 'file';
  // "1755712345678-scan.jpg" reads better as "scan.jpg".
  return leaf.replace(/^\d{10,}-/, '');
}

/**
 * The folders in a case a client can put files into. `report` and `recording`
 * are Eric's own to place and are not intake, so they are not read here.
 */
export const INTAKE_FOLDERS = ['uploads', 'chat-files'];

/** Intake files for one case or subscription, across every intake folder. */
export async function listIntake(env, kind, id, { max = 100 } = {}) {
  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const lists = await Promise.all(
    INTAKE_FOLDERS.map((f) => listFiles(env, `${parent}/${id}/${f}/`, { max }).catch(() => []))
  );
  return lists.flat().sort((a, b) => a.at - b.at);
}

/**
 * The WHOLE shelf by name, both sides' folders, for the draft writer's
 * inventory (Eric, 2026-08-30: "The advisor should be able to see the
 * uploads and documents so it knows what I'm referencing if I reference
 * one"). Names and dates only; nothing here reads a byte of any file.
 * `report` and `recording` are his own folders and are deliberately
 * included: the documents he references by name are usually his.
 */
export async function listShelf(env, kind, id, { max = 100 } = {}) {
  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const folders = [...INTAKE_FOLDERS, 'report', 'recording'];
  const lists = await Promise.all(folders.map((f) =>
    listFiles(env, `${parent}/${id}/${f}/`, { max }).catch(() => [])
      .then((rows) => rows.map((r) => ({ ...r, folder: f })))));
  return lists.flat().sort((a, b) => a.at - b.at);
}

/**
 * ONE OBJECT'S METADATA, without its bytes.
 *
 * Used by the delete route to find out whether Eric has FILED a file. A filed
 * file is part of the record he keeps, and a client removing their own chat
 * upload after he has labelled it a filled form would take that form out of
 * the case. The label is the only place that fact is written, so this is the
 * only place the delete route can read it.
 *
 * Returns null for an object that is not there, because "no metadata" and
 * "no file" answer the delete route the same way: there is no label on it.
 */
export async function objectMeta(env, path) {
  const token = await getAccessToken(env, SCOPE);
  const res = await fetch(`${GCS}/${BUCKET}/o/${encodeURIComponent(path)}`,
    { headers: { authorization: `Bearer ${token}` } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`storage meta ${path}: ${res.status} ${await res.text()}`);
  const o = await res.json();
  return {
    path: o.name,
    contentType: o.contentType || '',
    size: Number(o.size) || 0,
    custom: o.metadata || {},
  };
}

/**
 * Change the custom metadata on an object that already exists.
 *
 * WHY A FILE CANNOT SIMPLY BE RENAMED. An object's name IS its identity in
 * Storage: there is no rename. The nearest thing is a copy to a new name
 * followed by a delete of the old one, and that changes the path. The path is
 * the identity the chat message's attachment points at, the identity the
 * advisor dedupes on, and the identity baked into every download URL already
 * handed out. So the bytes and the path stay exactly where they are and the
 * name a person reads rides alongside them as `paName`. Both listings prefer
 * it and fall back to the object name, so a file nobody has renamed reads
 * exactly as it always did.
 *
 * PATCH, NEVER UPDATE, and only the `metadata` map. Two reasons, both of them
 * the kind that break quietly:
 *
 *   - `firebaseStorageDownloadTokens` lives in that same map. Replacing the
 *     map wholesale drops the token, and every download URL already given out
 *     for that file stops working. patch MERGES the map: keys given are set,
 *     keys given as null are removed, keys not mentioned are left alone.
 *   - contentType and contentDisposition are object fields beside it. An
 *     upload that set `contentDisposition: 'inline'` so a document opens in
 *     the phone's browser instead of downloading keeps it, because those
 *     fields are not in this request body at all.
 *
 * objects.patch is one of the methods that can reach an object's ACLs, so
 * Google requires the full scope for it. Everything else in this file stays
 * on the narrowest scope that works.
 */
export async function patchObjectMeta(env, path, custom) {
  const token = await getAccessToken(env,
    'https://www.googleapis.com/auth/devstorage.full_control');
  const res = await fetch(`${GCS}/${BUCKET}/o/${encodeURIComponent(path)}`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ metadata: custom }),
  });
  if (!res.ok) throw new Error(`storage patch ${path}: ${res.status} ${await res.text()}`);
  const o = await res.json();
  return { path: o.name, custom: o.metadata || {} };
}
