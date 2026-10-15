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
