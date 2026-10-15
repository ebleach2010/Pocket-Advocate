// MANY ADVOCATES (Eric, 2026-10-15: "We are expanding Pocket Advocate from a
// single-advocate platform into a multi-advocate platform for independent
// 1099 patient advocates." And: "Advocates must never be able to access
// another advocate's cases or data. Enforce this server-side, not just in the
// UI.")
//
// Who works a case, decided in one place. Three roles:
//   admin     Eric. Sees every case, every advocate, the money. He is also
//             advocate number one: his own cases carry his uid.
//   advocate  An independent contractor he added. Works only the cases whose
//             advocateId is their uid, and only while they are active.
//   client    Everyone else. Never staff; their own case is checked by the
//             routes that serve them (clientUid), not here.
//
// A case, subscription, invite or slot with no advocateId is Eric's. Every one
// that existed before this file did is his, and a missing field must never be
// read as "nobody's", which a careless check would turn into "anybody's".
//
// Nothing here trusts the browser: the role lives on users/{uid}, which only
// the Worker can set to anything but 'client' (firestore.rules), and an
// advocate counts only while advocates/{uid}.active is true, so switching one
// off locks them out on their very next request.

export const ADVOCATE_ROLE = 'advocate';

/** The advocate a case (or subscription, invite, slot) belongs to. Missing means Eric's. */
export function advocateIdOf(data, env) {
  const id = data && typeof data.advocateId === 'string' ? data.advocateId.trim() : '';
  return id || String(env?.ADMIN_UID || '');
}

/**
 * The staff member behind a signed-in user, or null.
 *
 * profile is users/{uid} (a getDoc result or null); advocate is advocates/{uid}
 * (likewise), read only when the role says advocate. Pure, so the suites run it
 * on fixtures.
 */
export function staffFrom(env, user, profile, advocate) {
  if (!user || !user.uid) return null;
  const role = profile?.data?.role;
  if (role === 'admin' && env?.ADMIN_UID && user.uid === env.ADMIN_UID)
    return { uid: user.uid, email: user.email || null, isAdmin: true, advocateId: user.uid };
  if (role === ADVOCATE_ROLE && advocate?.data?.active === true)
    return { uid: user.uid, email: user.email || null, isAdmin: false, advocateId: user.uid };
  return null;
}

/** Whether this staff member may see and work this case (or subscription). */
export function staffSees(staff, data, env) {
  if (!staff || !data) return false;
  if (staff.isAdmin) return true;
  return advocateIdOf(data, env) === staff.uid;
}

/**
 * The thread-side question the shared chat and file helpers ask: is this
 * signed-in profile the advocate side of this thread? The admin is, on every
 * thread (role admin, as those helpers have always asked it). An advocate is,
 * on their own threads only, and only while active. getDoc is passed in so the
 * suites can run it.
 */
export async function worksThread(env, uid, profile, data, getDoc) {
  const role = profile?.data?.role;
  if (role === 'admin') return true;
  if (role !== ADVOCATE_ROLE || !uid || !data) return false;
  if (advocateIdOf(data, env) !== uid) return false;
  const adv = await getDoc(env, `advocates/${uid}`).catch(() => null);
  return adv?.data?.active === true;
}

// ---- ACCOUNTS (Eric, 2026-10-15: "Admin creates advocate accounts from the
// admin dashboard... Admin enters the email/password when creating the
// account. The password should be securely hashed after creation and never
// stored or displayed in plaintext. Admin should be able to reset an advocate
// password later for technical support.")
//
// PBKDF2 with SHA-256, a random 16-byte salt per password, 100,000 rounds
// (the most the Workers runtime allows), a 32-byte result. Only the salt and
// the result are stored, on staffSecrets/{sha256(email)}, a path no browser
// can read or write (the catch-all deny in firestore.rules). The password
// itself is never stored, logged, returned, emailed or shown, to anyone.

export const PBKDF2_ROUNDS = 100_000;
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;
export const DEFAULT_COMMISSION_PCT = 60;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array((String(s).match(/../g) || []).map((h) => parseInt(h, 16)));

/** Why this password will not do, in a sentence for the screen, or '' when it will. */
export function passwordProblem(pw) {
  if (typeof pw !== 'string' || pw.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (pw.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (/^\s|\s$/.test(pw)) return 'No spaces at the start or the end.';
  return '';
}

async function derive(pw, salt, rounds) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: rounds }, key, 256);
}

/** The stored form of a password: { algo, rounds, salt, hash }, hex. Never the password. */
export async function hashPassword(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { algo: 'pbkdf2-sha256', rounds: PBKDF2_ROUNDS, salt: hex(salt), hash: hex(await derive(pw, salt, PBKDF2_ROUNDS)) };
}

/** Whether pw matches a stored record, compared in constant time. */
export async function verifyPassword(pw, rec) {
  if (typeof pw !== 'string' || !rec || rec.algo !== 'pbkdf2-sha256' || !rec.salt || !rec.hash) return false;
  const rounds = Math.min(Math.max(Number(rec.rounds) || 0, 1), PBKDF2_ROUNDS);
  const got = hex(await derive(pw, unhex(rec.salt), rounds));
  if (got.length !== rec.hash.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ rec.hash.charCodeAt(i);
  return diff === 0;
}

/** A fresh advocate uid: 'a' and 31 hex characters, never a client's derived uid ('e' + hex). */
export function newAdvocateUid() {
  return `a${hex(crypto.getRandomValues(new Uint8Array(16))).slice(0, 31)}`;
}

// ---- THE PROFILE (Eric, 2026-10-15: "Headshot, Name, Credentials, Specialty,
// Bio, Their prices for the three existing service tiers, Booking button." And:
// "Each advocate has one primary specialty and optional additional
// specialties.")
//
// His examples, in his order. An advocate may also name their own, which
// becomes its own tab on the public site the same way.
export const SPECIALTIES = [
  'Neurology',
  'Autoimmune / Rheumatology',
  'Cardiology',
  'Oncology',
  'Rare Disease',
  'Complex / Undiagnosed Cases',
];
export const MAX_EXTRA_SPECIALTIES = 6;

const line = (v, n) => (typeof v === 'string'
  ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const para = (v, n) => (typeof v === 'string'
  ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '');

/** A specialty as typed or picked: one of his, matched loosely, or their own words. */
export function cleanSpecialty(v) {
  const s = line(v, 40);
  if (!s) return '';
  const known = SPECIALTIES.find((k) => k.toLowerCase() === s.toLowerCase());
  return known || s;
}

/**
 * The fields an advocate may set on their own profile, cleaned. Anything not
 * listed is dropped, so a body cannot reach `active`, `commissionPct`, `owner`
 * or anything else that is his to set.
 */
export function cleanProfile(body = {}) {
  const out = {};
  if ('name' in body) out.name = line(body.name, 80);
  if ('credentials' in body) out.credentials = line(body.credentials, 200);
  if ('bio' in body) out.bio = para(body.bio, 1500);
  if ('primarySpecialty' in body) out.primarySpecialty = cleanSpecialty(body.primarySpecialty);
  if ('specialties' in body) {
    const list = Array.isArray(body.specialties) ? body.specialties : [];
    const seen = new Set();
    out.specialties = list.map(cleanSpecialty).filter((s) => {
      const k = s.toLowerCase();
      if (!s || seen.has(k)) return false;
      seen.add(k);
      return true;
    }).slice(0, MAX_EXTRA_SPECIALTIES);
  }
  if ('advisorOptIn' in body) out.advisorOptIn = body.advisorOptIn === true;
  return out;
}

/** What onboarding still needs before an advocate can be listed, by name. */
export function onboardingMissing(a = {}) {
  const missing = [];
  if (!line(a.name, 80)) missing.push('name');
  if (!a.headshotPath) missing.push('headshot');
  if (!line(a.credentials, 200)) missing.push('credentials');
  if (!line(a.primarySpecialty, 40)) missing.push('primary specialty');
  if (!para(a.bio, 1500)) missing.push('bio');
  return missing;
}

/**
 * An advocate as their own account page and his Advocates tab see them. No
 * secret is anywhere on the record, and none is added here: the password lives
 * on staffSecrets, and payment details (when they come) are encrypted and
 * shown only to him.
 */
export function advocateView(id, a = {}) {
  return {
    uid: id,
    name: a.name || '',
    email: a.email || '',
    active: a.active === true,
    owner: a.owner === true,
    sample: a.sample === true,
    credentials: a.credentials || '',
    bio: a.bio || '',
    primarySpecialty: a.primarySpecialty || '',
    specialties: Array.isArray(a.specialties) ? a.specialties : [],
    hasHeadshot: !!a.headshotPath,
    commissionPct: Number.isFinite(Number(a.commissionPct)) ? Number(a.commissionPct) : DEFAULT_COMMISSION_PCT,
    advisorOptIn: a.advisorOptIn === true || a.advisor?.optedIn === true,
    advisorEnabled: a.advisor?.enabled === true,
    acceptingNew: a.acceptingNew !== false,
    onboardedAt: a.onboardedAt || null,
    createdAt: a.createdAt || null,
    missing: onboardingMissing(a),
  };
}
