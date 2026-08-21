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
