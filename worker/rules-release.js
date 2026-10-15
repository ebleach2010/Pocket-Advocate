// THE SECURITY RULES, PUBLISHED BY THE WORKER (2026-10-15).
//
// Eric, 2026-10-15: "Advocates must never be able to access another
// advocate's cases or data. Enforce this server-side, not just in the UI."
// The rules in firestore.rules and storage.rules are the second lock on that,
// and he cannot run a deploy command from a phone. So the Worker publishes
// them: it carries both files (worker/rules-text.js, generated and checked by
// the battery) and, when what it carries differs from what it last published,
// it creates a ruleset with the Firebase Rules API and points the release at
// it, using the same service account it uses for everything else. It publishes
// only what it was built with; nothing in a request can choose the source.
//
// The outcome lands on config/rulesRelease (Worker-only) and in /api/diag. A
// failure is retried six hours later, not every minute, and changes nothing:
// the rules already live stay live.

import { getAccessToken } from './google-auth.js';
import { getDoc, patchDoc } from './firestore.js';
import { BUCKET } from './storage.js';
import { FIRESTORE_RULES, STORAGE_RULES } from './rules-text.js';

const API = 'https://firebaserules.googleapis.com/v1';
export const RULES_STATUS = 'config/rulesRelease';
export const RULES_RETRY_MS = 6 * 3600_000;

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function rulesApi(env, method, path, body) {
  const token = await getAccessToken(env, 'https://www.googleapis.com/auth/cloud-platform');
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`rules ${method} ${path.split('/').slice(-2).join('/')}: ${res.status} ${text.slice(0, 200)}`);
  return text ? JSON.parse(text) : {};
}

/** The two services, what the Worker carries for each, and where each is released. */
export function rulesTargets(env) {
  const p = env.FIREBASE_PROJECT_ID;
  return [
    { svc: 'firestore', file: 'firestore.rules', source: FIRESTORE_RULES, release: 'cloud.firestore', project: p },
    { svc: 'storage', file: 'storage.rules', source: STORAGE_RULES, release: `firebase.storage/${BUCKET}`, project: p },
  ];
}

/**
 * Publish whichever of the two differs from what was last published here.
 * `force` re-publishes regardless (never used by the cron).
 */
export async function releaseRules(env, { force = false, now = Date.now() } = {}) {
  if (!env.FIREBASE_PROJECT_ID) return null;
  const st = await getDoc(env, RULES_STATUS).catch(() => null);
  const have = st?.data || {};
  const out = { ...have };
  let changed = false;
  for (const t of rulesTargets(env)) {
    const hash = await sha256hex(t.source);
    const prev = have[t.svc] || {};
    if (!force && prev.hash === hash && prev.ok === true) continue;
    if (!force && prev.hash === hash && prev.ok === false && now - new Date(prev.at || 0).getTime() < RULES_RETRY_MS) continue;
    changed = true;
    try {
      const rs = await rulesApi(env, 'POST', `/projects/${t.project}/rulesets`, {
        source: { files: [{ name: t.file, content: t.source }] },
      });
      await rulesApi(env, 'PATCH', `/projects/${t.project}/releases/${t.release}`, {
        release: { name: `projects/${t.project}/releases/${t.release}`, rulesetName: rs.name },
      });
      out[t.svc] = { hash, ok: true, at: new Date(now), ruleset: rs.name || null, error: null };
    } catch (err) {
      out[t.svc] = { hash, ok: false, at: new Date(now), ruleset: null, error: String(err?.message || err).slice(0, 300) };
    }
  }
  if (changed) await patchDoc(env, RULES_STATUS, out).catch(() => {});
  return out;
}
