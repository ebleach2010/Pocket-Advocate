// THE ADVOCATES THEMSELVES (Eric, 2026-10-15): his Advocates tab, each
// advocate's own account page, the password door, and their headshots.
//
// "Admin creates advocate accounts from the admin dashboard. During
// onboarding, the advocate provides: Name, Email, Initial password, Headshot,
// Bio, Credentials, Primary specialty, Additional specialties, Service
// pricing, AI Advisor opt-in, Payment information. Admin enters the
// email/password when creating the account. The password should be securely
// hashed after creation and never stored or displayed in plaintext. Admin
// should be able to reset an advocate password later for technical support."
//
// Prices and payment details arrive with the phases that use them; this file
// holds who an advocate is and how they get in.
//
// Routes (every one answers an unknown or refused caller with the same 404):
//   POST /api/admin/advocates         his: list, create, update, activate, deactivate, reset-password
//   GET  /api/staff/me                the signed-in advocate's own record (his too: he is advocate one)
//   POST /api/staff/me                profile, password, onboarded
//   POST /api/staff/headshot          their photo, raw image body
//   GET  /api/advocates/headshot?uid= an active advocate's photo, public

import { getDoc, patchDoc, deleteDoc, queryDocs, listDocs } from './firestore.js';
import { addonsOf, cleanAddons } from './addons.js';
import { servicesOf, cleanServices } from './services.js';
import { cleanSettingsChange, settingsFrom, nest, bufferHoursOf, cleanBufferHours } from './staffsettings.js';
import { cleanPayout, sealPayout, PAYOUT_METHODS } from './payroll.js';
import { putFile, deleteFile, mediaFetch } from './storage.js';
import { sendEmail } from './email.js';
import { notifyUser } from './push.js';
import {
  ADVOCATE_ROLE, DEFAULT_COMMISSION_PCT, SPECIALTIES, hashPassword, verifyPassword, passwordProblem,
  newAdvocateUid, cleanProfile, onboardingMissing, advocateView, STAFF_ZONES,
} from './staff.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const UID_RE = /^[\w-]{1,64}$/;
const OWNER_PHOTO = '/img/eric-headshot.jpg';
const HEADSHOT_MAX = 3 * 1024 * 1024;
const HEADSHOT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const cleanEmail = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');
const nameLine = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '');

/** Where an address's password record lives. Keyed by a hash so the path never names the address. */
export async function loginPath(email) {
  return `staffSecrets/${await sha256hex(`staff:${cleanEmail(email)}`)}`;
}

/** Whether this address signs in with a password rather than an emailed code. */
export async function isStaffLogin(env, email) {
  return !!(await getDoc(env, await loginPath(email)).catch(() => null));
}

/**
 * The advocate this address and password open, or null. A miss does the same
 * hashing work as a hit, so the time a refusal takes says nothing about
 * whether the address is an advocate's. Throttling is the caller's.
 */
export async function advocateLogin(env, email, password) {
  const sec = await getDoc(env, await loginPath(email)).catch(() => null);
  if (!sec?.data?.uid) {
    await verifyPassword(String(password || ''), { algo: 'pbkdf2-sha256', rounds: 100_000, salt: '00'.repeat(16), hash: '00'.repeat(32) });
    return null;
  }
  if (!(await verifyPassword(String(password || ''), sec.data))) return null;
  const adv = await getDoc(env, `advocates/${sec.data.uid}`).catch(() => null);
  if (adv?.data?.active !== true) return null;
  return { uid: sec.data.uid, email: cleanEmail(adv.data.email || email), mustChange: sec.data.mustChange === true };
}

const nowSec = () => Math.floor(Date.now() / 1000);

/** Whether a client already signs in with this address: a profile carrying it, or the account it derives (index.js deriveUid). */
async function isClientAddress(env, email) {
  const byField = await queryDocs(env, 'users', [['email', 'EQUAL', email]], 3).catch(() => []);
  if (byField.some((r) => (r.data?.role || 'client') === 'client')) return true;
  const derived = `e${(await sha256hex(`uid:${email}`)).slice(0, 31)}`;
  const prof = await getDoc(env, `users/${derived}`).catch(() => null);
  return !!prof && (prof.data?.role || 'client') === 'client';
}

/** Every trusted device an advocate holds, gone: the next visit asks for the password. */
async function forgetDevices(env, uid) {
  const rows = await queryDocs(env, 'trustedDevices', [['uid', 'EQUAL', uid]], 50).catch(() => []);
  for (const r of rows) await deleteDoc(env, `trustedDevices/${r.id}`).catch(() => {});
  return rows.length;
}

function welcomeEmail(env, name) {
  const base = env.PUBLIC_BASE_URL || '';
  const first = String(name || '').split(' ')[0] || 'there';
  return {
    subject: 'Your Pocket Advocate account is ready',
    html: `<p>Hi ${first.replace(/[<>&"']/g, '')},</p>
      <p>Your advocate account on Pocket Advocate is ready.</p>
      <p>Sign in at <a href="${base}/signin.html">${base.replace(/^https?:\/\//, '')}/signin.html</a> with this email address and the password you were given. The first time, you will choose a password of your own and set up your profile.</p>`,
  };
}

// ---- his Advocates tab ----------------------------------------------------------

/**
 * The rest of his pages, checked (2026-10-17): their share, their profile
 * words, what they offer with their prices and week (settings), and how they
 * are paid. { error } or the cleaned parts. On create the profile and share
 * land on the new record; on an update the settings come back as a dotted
 * patch, and the owner's own record takes no settings or payout here (his
 * live in his cog, and he is not on the payroll).
 */
function cleanSetup(body, { creating, owner = false }) {
  const out = { profile: {} };
  if (creating) {
    out.profile = cleanProfile({ ...(body.profile && typeof body.profile === 'object' ? body.profile : {}) });
    delete out.profile.name;
    delete out.profile.advisorOptIn;
    if (body.commissionPct !== undefined) {
      const pct = Number(body.commissionPct);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) return { error: 'Their share is a whole percent, 0 to 100.' };
      out.commissionPct = pct;
    }
  }
  const s = body.settings;
  if (s && typeof s === 'object' && Object.keys(s).length) {
    if (owner) return { error: 'Your own prices and hours are in your settings.' };
    const got = cleanSettingsChange(s, { admin: true });
    if (got.error) return { error: got.error };
    if (creating) out.settings = nest(got.patch).settings;
    else { out.settingsPatch = got.patch; out.settingsMask = got.mask; }
  }
  // The buffer around their paid appointments (Eric, 2026-10-17: "baseline for
  // everyone. But can be adjusted per contractor in employer mode"), his own included.
  if (body.bufferHours !== undefined && body.bufferHours !== null && body.bufferHours !== '') {
    const got = cleanBufferHours(body.bufferHours);
    if (got.error) return { error: got.error };
    out.bufferHours = got.value;
  }
  if (body.payout && body.payout.method) {
    if (owner) return { error: 'You are not on the payroll.' };
    const got = cleanPayout(body.payout);
    if (got.error) return { error: got.error };
    out.payout = got;
  }
  return out;
}

/** Their way to be paid, as he typed it: sealed, with only the method and a masked hint in the clear. */
async function writePayout(env, uid, got, by, at) {
  await patchDoc(env, `payouts/${uid}`, { method: got.method, hint: got.hint, sealed: await sealPayout(env, got.details), updatedAt: at, setBy: by });
}

async function adminAdvocates(request, env, h) {
  const admin = await h.requireAdmin(request, env);
  if (!admin) return h.json({ error: 'Not found' }, 404);
  const body = (await request.json().catch(() => null)) || {};
  const action = String(body.action || 'list');

  if (action === 'list') {
    const rows = await listDocs(env, 'advocates', { pageSize: 300, all: true }).catch(() => []);
    const list = rows.map((r) => advocateView(r.id, r.data))
      .sort((a, b) => (b.owner - a.owner) || (b.active - a.active) || a.name.localeCompare(b.name));
    return h.json({ advocates: list, specialties: SPECIALTIES, defaultCommissionPct: DEFAULT_COMMISSION_PCT });
  }

  if (action === 'create') {
    const email = cleanEmail(body.email);
    const name = nameLine(body.name);
    if (!name) return h.json({ error: 'Their name, please.' }, 400);
    if (!EMAIL_RE.test(email)) return h.json({ error: 'Enter a valid email address.' }, 400);
    if (env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase())
      return h.json({ error: 'That is your own address.' }, 409);
    const problem = passwordProblem(body.password);
    if (problem) return h.json({ error: problem }, 400);
    // THEIR ADD-ONS, SET AS HE ADDS THEM (Eric, 2026-10-17: "when I add a
    // contractor into the app it will be a simple toggle with a price input").
    const addons = body.addons === undefined ? { value: addonsOf(null) } : cleanAddons(body.addons);
    if (addons.error) return h.json({ error: addons.error }, 400);
    // Their own services (2026-10-17: "including new tier types that a contractor wants"), his to switch.
    const services = body.services === undefined ? { value: [] } : cleanServices(body.services, [], { admin: true });
    if (services.error) return h.json({ error: services.error }, 400);
    // EVERYTHING ELSE, PAGE BY PAGE (Eric, 2026-10-17: "When I add an
    // advocate, it should go page by page through everything I asked I could
    // toggle on or off, their pricing, their initial schedule, profile
    // picture, bio, any extra tiers or add-ons and their pricing, their pay
    // preferences and if ACH their routing # and account #"). All of it is
    // checked before the address is claimed, so a refusal never leaves half
    // an account. What he leaves blank they fill in when they first sign in.
    const extra = cleanSetup(body, { creating: true });
    if (extra.error) return h.json({ error: extra.error }, 400);
    // A CLIENT'S ADDRESS STAYS A CLIENT'S (onboarding review, 2026-10-16).
    // Made an advocate's, the address would sign in with a password from then
    // on and the client's own account, cases and chat would be out of reach.
    if (await isClientAddress(env, email)) return h.json({ error: 'That address already belongs to a client here. Use another email for their advocate account.' }, 409);
    const uid = newAdvocateUid();
    const now = new Date();
    // The address is claimed first, and only once: a second account for the
    // same address is refused here rather than half-made.
    const claimed = await patchDoc(env, await loginPath(email), {
      uid, ...(await hashPassword(body.password)), mustChange: true, setAt: now, setBy: 'admin',
    }, { mustNotExist: true });
    if (!claimed) return h.json({ error: 'That address already has an advocate account.' }, 409);
    await patchDoc(env, `advocates/${uid}`, {
      uid, name, email, active: true, owner: false,
      commissionPct: extra.commissionPct ?? DEFAULT_COMMISSION_PCT, payroll: true,
      primarySpecialty: extra.profile.primarySpecialty ?? '', specialties: extra.profile.specialties ?? [],
      credentials: extra.profile.credentials ?? '', bio: extra.profile.bio ?? '', headshotPath: null,
      acceptingNew: true, tz: extra.profile.tz || 'America/Boise',
      ...(extra.settings ? { settings: { ...extra.settings, updatedAt: now } } : {}),
      ...(extra.bufferHours !== undefined ? { bufferHours: extra.bufferHours } : {}),
      addons: addons.value,
      services: services.value,
      advisor: { optedIn: false, enabled: false },
      createdAt: now, createdBy: admin.uid, onboardedAt: null,
      // Their own password first (setupPending in staff.js); the hash is on staffSecrets.
      mustChange: true,
    }, { mustNotExist: true });
    await patchDoc(env, `users/${uid}`, { role: ADVOCATE_ROLE, email, name, setupPending: true }, { mustNotExist: true });
    // How they are paid, sealed before it is written (worker/payroll.js); only the method and a masked hint are in the clear.
    if (extra.payout) await writePayout(env, uid, extra.payout, admin.uid, now);
    const mail = welcomeEmail(env, name);
    const emailed = await sendEmail(env, { to: email, subject: mail.subject, html: mail.html }).catch(() => false);
    return h.json({ ok: true, uid, emailed: !!emailed, payout: extra.payout ? { method: extra.payout.method, hint: extra.payout.hint } : null });
  }

  const uid = String(body.uid || '');
  if (!UID_RE.test(uid)) return h.json({ error: 'Bad advocate' }, 400);
  const doc = await getDoc(env, `advocates/${uid}`);
  if (!doc) return h.json({ error: 'Not found' }, 404);
  const a = doc.data;

  // Everything his pages set, to open them again for a change (2026-10-17). Never a sealed detail: the method and its masked hint.
  if (action === 'get') {
    const p = await getDoc(env, `payouts/${uid}`).catch(() => null);
    return h.json({
      advocate: advocateView(uid, a), addons: addonsOf(a, { owner: a.owner === true }), settings: settingsFrom(a), services: servicesOf(a),
      bufferHours: bufferHoursOf(a),
      payout: p?.data?.method ? { method: p.data.method, label: PAYOUT_METHODS[p.data.method] || '', hint: p.data.hint || '' } : null,
      methods: PAYOUT_METHODS, zones: STAFF_ZONES, specialties: SPECIALTIES,
    });
  }

  // The sample contractor (employer mode) has no sign-in and no switch; she is removed there.
  if (a.sample === true && action !== 'update') return h.json({ error: 'This is the sample contractor. Remove her in employer mode.' }, 409);
  if (action === 'deactivate' || action === 'activate') {
    if (a.owner) return h.json({ error: 'You are the owner; your account stays on.' }, 409);
    const on = action === 'activate';
    // Off ends every session they hold (2026-10-16): one begun before this
    // moment is refused by every route and rule, now and after a turn back on.
    await patchDoc(env, `advocates/${uid}`, { active: on, [on ? 'activatedAt' : 'deactivatedAt']: new Date(), ...(on ? {} : { sessionsFrom: nowSec() }) },
      { mask: ['active', on ? 'activatedAt' : 'deactivatedAt', ...(on ? [] : ['sessionsFrom'])] });
    // Off means out now: every trusted device goes, and every route checks
    // `active` on its next request whatever a browser still holds.
    const forgot = on ? 0 : await forgetDevices(env, uid);
    return h.json({ ok: true, active: on, devicesForgotten: forgot });
  }

  if (action === 'reset-password') {
    if (a.owner) return h.json({ error: 'Your own sign-in is your PIN.' }, 409);
    const problem = passwordProblem(body.password);
    if (problem) return h.json({ error: problem }, 400);
    await patchDoc(env, await loginPath(a.email), {
      uid, ...(await hashPassword(body.password)), mustChange: true, setAt: new Date(), setBy: 'admin',
    });
    // Signed out everywhere, as the sheet tells him (2026-10-16), and back to
    // choosing their own password before any work opens.
    await patchDoc(env, `advocates/${uid}`, { mustChange: true, sessionsFrom: nowSec() }, { mask: ['mustChange', 'sessionsFrom'] });
    await patchDoc(env, `users/${uid}`, { setupPending: true }, { mask: ['setupPending'] }).catch(() => {});
    await forgetDevices(env, uid);
    // Nothing echoes the password back, here or anywhere.
    return h.json({ ok: true });
  }

  if (action === 'update') {
    const patch = cleanProfile(body);
    if ('name' in patch && !patch.name) return h.json({ error: 'Their name, please.' }, 400);
    const mask = Object.keys(patch).filter((k) => k !== 'advisorOptIn');
    delete patch.advisorOptIn;
    if ('commissionPct' in body) {
      const pct = Number(body.commissionPct);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) return h.json({ error: 'Commission is a whole percent, 0 to 100.' }, 400);
      patch.commissionPct = pct; mask.push('commissionPct');
    }
    if ('acceptingNew' in body) { patch.acceptingNew = body.acceptingNew === true; mask.push('acceptingNew'); }
    // "I can go into their profile and change this at any time" (2026-10-17).
    if ('addons' in body) {
      const addons = cleanAddons(body.addons);
      if (addons.error) return h.json({ error: addons.error }, 400);
      patch.addons = addons.value; mask.push('addons');
    }
    // Their own services (2026-10-17): he adds, changes, takes away and switches them.
    if ('services' in body && a.owner !== true) {
      const services = cleanServices(body.services, a.services, { admin: true });
      if (services.error) return h.json({ error: services.error }, 400);
      patch.services = services.value; mask.push('services');
    }
    // His pages, again (2026-10-17): what they offer, their prices and week, and how they are paid.
    const extra = cleanSetup(body, { creating: false, owner: a.owner === true });
    if (extra.error) return h.json({ error: extra.error }, 400);
    if (extra.settingsPatch) {
      patch.settings = { ...nest(extra.settingsPatch).settings, updatedAt: new Date() };
      mask.push(...extra.settingsMask, 'settings.updatedAt');
    }
    if (extra.bufferHours !== undefined) { patch.bufferHours = extra.bufferHours; mask.push('bufferHours'); }
    // Paid access only for someone who asked for it (Eric: "Admin should not
    // enable paid Advisor access unless the advocate opted in.").
    if ('advisorEnabled' in body) {
      const want = body.advisorEnabled === true;
      if (want && !a.owner && a.advisor?.optedIn !== true)
        return h.json({ error: 'They have not opted in. It can be switched on once they do.' }, 409);
      patch.advisor = { ...(a.advisor || {}), enabled: want, enabledAt: want ? new Date() : null };
      mask.push('advisor');
    }
    if (!mask.length && !extra.payout) return h.json({ error: 'Nothing to change.' }, 400);
    if (extra.payout) await writePayout(env, uid, extra.payout, admin.uid, new Date());
    if (mask.length) await patchDoc(env, `advocates/${uid}`, { ...patch, updatedAt: new Date() }, { mask: [...mask, 'updatedAt'] });
    // The name on their sign-in profile follows, the way their own change does (never for the sample, who has none).
    if ('name' in patch && a.sample !== true) await patchDoc(env, `users/${uid}`, { name: patch.name }, { mask: ['name'] }).catch(() => {});
    const fresh = await getDoc(env, `advocates/${uid}`);
    return h.json({ ok: true, advocate: advocateView(uid, fresh?.data || { ...a, ...patch }) });
  }

  return h.json({ error: 'Bad request' }, 400);
}

// ---- their own account page -------------------------------------------------------

async function staffMe(request, env, h) {
  const staff = await h.requireStaff(request, env, { setup: true });
  if (!staff) return h.json({ error: 'Not found' }, 404);
  const path = `advocates/${staff.uid}`;
  const doc = await getDoc(env, path);
  if (!doc) return h.json({ error: 'Not found' }, 404);
  const a = doc.data;
  const login = staff.isAdmin ? null : await getDoc(env, await loginPath(a.email)).catch(() => null);

  if (request.method === 'GET') {
    const payout = staff.isAdmin ? null : await getDoc(env, `payouts/${staff.uid}`).catch(() => null);
    return h.json({
      advocate: advocateView(staff.uid, a), role: staff.isAdmin ? 'admin' : ADVOCATE_ROLE,
      mustChange: login?.data?.mustChange === true, specialties: SPECIALTIES, zones: STAFF_ZONES,
      payoutSet: !!payout?.data?.method,
    });
  }
  if (request.method !== 'POST') return h.json({ error: 'Not found' }, 404);
  const body = (await request.json().catch(() => null)) || {};

  if (body.action === 'profile') {
    const patch = cleanProfile(body);
    const mask = Object.keys(patch).filter((k) => k !== 'advisorOptIn');
    if ('advisorOptIn' in patch) {
      // Opting out switches it off too; opting in leaves the switch to him.
      patch.advisor = { ...(a.advisor || {}), optedIn: patch.advisorOptIn,
        optedInAt: patch.advisorOptIn ? new Date() : null,
        ...(patch.advisorOptIn ? {} : { enabled: a.owner ? a.advisor?.enabled === true : false }) };
      mask.push('advisor');
    }
    delete patch.advisorOptIn;
    if (!mask.length) return h.json({ error: 'Nothing to change.' }, 400);
    if ('name' in patch && !patch.name) return h.json({ error: 'Your name, please.' }, 400);
    await patchDoc(env, path, { ...patch, updatedAt: new Date() }, { mask: [...mask, 'updatedAt'] });
    if ('name' in patch) await patchDoc(env, `users/${staff.uid}`, { name: patch.name }, { mask: ['name'] }).catch(() => {});
    const fresh = await getDoc(env, path);
    return h.json({ ok: true, advocate: advocateView(staff.uid, fresh?.data || { ...a, ...patch }) });
  }

  if (body.action === 'password') {
    if (staff.isAdmin || !login) return h.json({ error: 'Your own sign-in is your PIN.' }, 409);
    if (!(await verifyPassword(String(body.current || ''), login.data)))
      return h.json({ error: 'Your current password is not right.' }, 403);
    const problem = passwordProblem(body.next);
    if (problem) return h.json({ error: problem }, 400);
    if (body.next === body.current) return h.json({ error: 'Choose a password that is new.' }, 400);
    await patchDoc(env, await loginPath(a.email), {
      uid: staff.uid, ...(await hashPassword(body.next)), mustChange: false, setAt: new Date(), setBy: 'advocate',
    });
    // A new password ends every other session and trusted device (2026-10-16);
    // this one gets a fresh session and device token back, so they stay in.
    await patchDoc(env, path, { mustChange: false, sessionsFrom: nowSec() }, { mask: ['mustChange', 'sessionsFrom'] });
    await patchDoc(env, `users/${staff.uid}`, { setupPending: !a.onboardedAt }, { mask: ['setupPending'] }).catch(() => {});
    await forgetDevices(env, staff.uid);
    const token = h.mintCustomToken ? await h.mintCustomToken(env, staff.uid).catch(() => null) : null;
    const deviceToken = h.issueDeviceToken ? await h.issueDeviceToken(env, staff.uid, a.email).catch(() => null) : null;
    return h.json({ ok: true, token, deviceToken });
  }

  if (body.action === 'onboarded') {
    const missing = onboardingMissing(a);
    // How they get paid is part of setting up (2026-10-16): payroll needs it.
    if (!staff.isAdmin && !(await getDoc(env, `payouts/${staff.uid}`).catch(() => null))?.data?.method) missing.push('how you get paid');
    if (missing.length) return h.json({ error: `Still needed: ${missing.join(', ')}.`, missing }, 409);
    if (login?.data?.mustChange === true) return h.json({ error: 'Choose your own password first.' }, 409);
    if (!a.onboardedAt) {
      await patchDoc(env, path, { onboardedAt: new Date() }, { mask: ['onboardedAt'] });
      await patchDoc(env, `users/${staff.uid}`, { setupPending: false }, { mask: ['setupPending'] }).catch(() => {});
      if (!staff.isAdmin && env.ADMIN_UID)
        await notifyUser(env, env.ADMIN_UID, {
          title: 'Pocket Advocate', body: `${a.name || 'An advocate'} finished setting up their profile.`, link: '/admin-employer.html',
        }).catch(() => {});
    }
    return h.json({ ok: true });
  }

  return h.json({ error: 'Bad request' }, 400);
}

/** The first bytes of a real JPEG, PNG or WebP, so a renamed file of anything else is refused. */
function looksLike(type, u8) {
  if (type === 'image/jpeg') return u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff;
  if (type === 'image/png') return u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47;
  if (type === 'image/webp') return u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46 && u8[8] === 0x57 && u8[9] === 0x45;
  return false;
}

async function staffHeadshot(request, env, h) {
  const staff = await h.requireStaff(request, env, { setup: true });
  if (!staff) return h.json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return h.json({ error: 'Not found' }, 404);
  return saveHeadshot(request, env, h, staff.uid);
}

/**
 * POST /api/admin/advocates/headshot?uid=   his alone (Eric, 2026-10-15:
 * "I should be able to upload a bio and profile picture for each [contractor]
 * when they submit it to me."). The same checks and the same place as their
 * own upload; the bio goes through the update action beside it.
 */
async function adminHeadshot(request, env, url, h) {
  const admin = await h.requireAdmin(request, env);
  if (!admin) return h.json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return h.json({ error: 'Not found' }, 404);
  const uid = String(url.searchParams.get('uid') || '');
  if (!UID_RE.test(uid)) return h.json({ error: 'Bad advocate' }, 400);
  return saveHeadshot(request, env, h, uid);
}

/** One photo, checked and kept under that advocate, the old one removed. */
async function saveHeadshot(request, env, h, uid) {
  const type = String(request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const ext = HEADSHOT_TYPES[type];
  if (!ext) return h.json({ error: 'A JPEG, PNG or WebP photo, please.' }, 415);
  const declared = Number(request.headers.get('content-length') || 0);
  if (declared > HEADSHOT_MAX) return h.json({ error: 'That photo is over 3 MB.' }, 413);
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (!bytes.byteLength) return h.json({ error: 'The photo did not arrive.' }, 400);
  if (bytes.byteLength > HEADSHOT_MAX) return h.json({ error: 'That photo is over 3 MB.' }, 413);
  if (!looksLike(type, bytes)) return h.json({ error: 'That file is not the photo it says it is.' }, 415);
  const doc = await getDoc(env, `advocates/${uid}`);
  if (!doc) return h.json({ error: 'Not found' }, 404);
  // Under advocates/, which no browser can reach in storage.rules; it is
  // served by the route below, and only while the advocate is active.
  const path = `advocates/${uid}/headshot-${Date.now()}.${ext}`;
  await putFile(env, path, bytes, type);
  await patchDoc(env, `advocates/${uid}`, { headshotPath: path, updatedAt: new Date() }, { mask: ['headshotPath', 'updatedAt'] });
  const old = doc.data.headshotPath;
  if (old && old !== path && old.startsWith(`advocates/${uid}/`)) await deleteFile(env, old).catch(() => {});
  return h.json({ ok: true, photoV: path.split('-').pop().split('.')[0] });
}

async function publicHeadshot(request, env, url, h) {
  // ?uid=owner is his, whoever his uid is (2026-10-15): the home asks for it
  // without carrying an account id in its source.
  const asked = String(url.searchParams.get('uid') || '');
  const uid = asked === 'owner' ? String(env.ADMIN_UID || '') : asked;
  if (!UID_RE.test(uid)) return h.json({ error: 'Not found' }, 404);
  const doc = await getDoc(env, `advocates/${uid}`).catch(() => null);
  const path = doc?.data?.active === true ? doc.data.headshotPath : null;
  // His own photo ships with the site (public/img), so his cases and the
  // home show his face before he uploads one here (2026-10-15).
  // The home's uid=owner always has a face: his shipped photo until he sets one.
  if (!path && ((doc?.data?.active === true && doc.data.owner === true) || asked === 'owner'))
    return new Response(null, { status: 302, headers: { location: OWNER_PHOTO, 'cache-control': 'public, max-age=3600' } });
  if (!path || !path.startsWith(`advocates/${uid}/`)) return h.json({ error: 'Not found' }, 404);
  const res = await mediaFetch(env, path).catch(() => null);
  if (!res?.ok) return h.json({ error: 'Not found' }, 404);
  const type = res.headers.get('content-type') || 'image/jpeg';
  if (!HEADSHOT_TYPES[type]) return h.json({ error: 'Not found' }, 404);
  return new Response(res.body, {
    headers: { 'content-type': type, 'cache-control': 'public, max-age=3600', 'x-content-type-options': 'nosniff' },
  });
}

/**
 * GET /api/advocates/name?uid=  A contractor's name, as their client's forms
 * print it (2026-10-15: a records release sent from a contractor's case named
 * Eric as the client's advocate). Public, like their photo, and only for an
 * active advocate who is not him: his forms print his legal name as they
 * always have, so he, and anyone unknown or turned off, answers null.
 */
async function publicName(request, env, url, h) {
  const uid = String(url.searchParams.get('uid') || '');
  if (!UID_RE.test(uid) || uid === env.ADMIN_UID) return h.json({ name: null });
  const d = (await getDoc(env, `advocates/${uid}`).catch(() => null))?.data;
  const name = d?.active === true && d.owner !== true && typeof d.name === 'string' ? d.name.trim().slice(0, 80) : '';
  return h.json({ name: name || null });
}

/** The one entry point the Worker's router calls for everything above. */
export async function handleAdvocates(request, env, url, h) {
  const p = url.pathname;
  if (p === '/api/admin/advocates' && request.method === 'POST') return adminAdvocates(request, env, h);
  if (p === '/api/staff/me') return staffMe(request, env, h);
  if (p === '/api/staff/headshot') return staffHeadshot(request, env, h);
  if (p === '/api/admin/advocates/headshot') return adminHeadshot(request, env, url, h);
  if (p === '/api/advocates/headshot' && request.method === 'GET') return publicHeadshot(request, env, url, h);
  if (p === '/api/advocates/name' && request.method === 'GET') return publicName(request, env, url, h);
  return h.json({ error: 'Not found' }, 404);
}
