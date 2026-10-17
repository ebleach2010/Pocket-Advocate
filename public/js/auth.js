// Magic-link auth helpers + the shared top-nav auth state.
import {
  auth,
  db,
  doc,
  getDoc,
  setDoc,
  collection,
  getDocs,
  query,
  where,
  onAuthStateChanged,
  signOut,
} from './firebase.js';

const EMAIL_KEY = 'pa-signin-email';

// Pages inside an installed app can stay suspended for days; nobody should
// have to force-close to pick up a deploy, and nobody is ever logged out by
// one (sessions live in storage, not in the code). On resume, compare the
// server's build tag to the one this page loaded under and reload when they
// differ — unless someone is mid-sentence in a text box.
let loadedTag = null;
async function checkVersion() {
  try {
    const res = await fetch('/api/version');
    const { tag } = await res.json();
    if (!tag) return;
    if (!loadedTag) { loadedTag = tag; return; }
    if (tag === loadedTag) return;
    const a = document.activeElement;
    const typing = a && (a.tagName === 'TEXTAREA' || a.tagName === 'INPUT') && a.value;
    if (!typing) location.reload();
  } catch { /* offline — never reload on a failed check */ }
}
checkVersion();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkVersion();
});
setInterval(checkVersion, 30 * 60_000);

export function rememberEmail(email) {
  localStorage.setItem(EMAIL_KEY, email);
}
export function recallEmail() {
  return localStorage.getItem(EMAIL_KEY) || '';
}

// A read that never answers (2026-09-24, Eric: "It's stuck loading in the client case menu on launch").
// A phone waking from the background can leave a database read waiting forever; these few are given
// ten seconds and then treated the way a refused read already is.
const TOO_SLOW = Symbol('too slow');
const orTooSlow = (p, ms = 10_000) => new Promise((resolve, reject) => {
  const t = setTimeout(() => resolve(TOO_SLOW), ms);
  p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
});

// WHERE SIGN-IN IS (Eric, 2026-09-24, 2:03 AM, the Clients page on "Stuck on: checking your sign-in").
// Before it says who is signed in, the sign-in library checks the saved session with Google, and after
// a phone wakes that can take up to a minute. A page's safety net reads this to tell that wait, which
// ends on its own, from a real stall: 'google' while the library checks, 'profile' while the profile is
// read, 'ok' after.
const signinStep = (step) => { try { window.__paSignin = step; } catch { /* no window */ } };

/** Resolves with the signed-in user, or null. */
export function currentUser() {
  signinStep('google');
  return new Promise((resolve) => {
    const stop = onAuthStateChanged(auth, (user) => {
      stop();
      signinStep('profile');
      resolve(user);
    });
  });
}

// ONE READ OF THE PROFILE A PAGE (2026-09-24). The nav, the profile check and the admin check each read
// users/{uid}, three reads of one document, and on a slow wake each could take its full ten seconds in
// turn. They share one read now.
const profileReads = new Map();
function readProfile(user) {
  if (!profileReads.has(user.uid)) profileReads.set(user.uid, orTooSlow(getDoc(doc(db, 'users', user.uid))));
  return profileReads.get(user.uid);
}

/** Redirects to sign-in (remembering where to come back to) if signed out. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) {
    location.href = `/signin.html?to=${encodeURIComponent(location.pathname + location.search)}`;
    return null;
  }
  await ensureProfile(user);
  return user;
}

/** First sign-in creates users/{uid} with role 'client' (rules enforce it). */
async function ensureProfile(user) {
  try {
    const snapshot = await readProfile(user);
    if (snapshot === TOO_SLOW) return;
    if (!snapshot.exists()) {
      await setDoc(doc(db, 'users', user.uid), { email: user.email, name: '', role: 'client' });
    }
  } catch (err) {
    console.warn('profile check failed', err);
  }
}

/**
 * Admin pages, modules and stylesheet are served behind a signed cookie the
 * Worker sets, because a <script src> cannot carry a bearer token. Sign-in
 * mints it, but a browser can hold a live session with no cookie: a device
 * that was already signed in before this shipped, or one whose cookie aged
 * out. Asking for one here means the next navigation to an admin page already
 * has what the gate wants.
 *
 * Once per page load, and failure is not fatal: worst case the gate bounces
 * him to sign in, which is exactly what it should do.
 */
let adminSessionAsked = false;
async function ensureAdminSession(user) {
  if (adminSessionAsked) return;
  adminSessionAsked = true;
  try {
    await orTooSlow((async () => fetch('/api/admin/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${await user.getIdToken()}` },
    }))());
  } catch { /* offline, or already holding a good cookie */ }
}

/**
 * True when the signed-in user is the admin (Eric), false when the profile
 * says otherwise, and NULL when the profile could not be read at all. The
 * third answer is new (2026-09-09) and it is not the same as no: the
 * database was refusing every read, this returned false, and the page below
 * took that as proof this was not his phone.
 */
export async function isAdmin(user) {
  try {
    // Too slow is unknown, the same as refused: his phone stays his (2026-09-24).
    const snapshot = await readProfile(user);
    if (snapshot === TOO_SLOW) return null;
    return snapshot.exists() && snapshot.data().role === 'admin';
  } catch {
    return null;
  }
}

/**
 * WHO IS WORKING (2026-10-15). The working side of the app serves two kinds of
 * staff: Eric, who sees every case, and the advocates he adds, who see their
 * own. The database rules and the Worker enforce which cases each can reach;
 * this is only how a page knows which list to ask for and what to show.
 * 'admin', 'advocate', false for anyone else, and null when the profile could
 * not be read, the same three answers isAdmin gives.
 */
// `name` is the profile's own name (2026-10-15), so an advocate's pages can say theirs.
// `setup` (2026-10-16): an advocate who has not finished setting up, or must
// choose a new password after a reset. The Worker refuses their work until
// then; this only takes them to the page where they can do it.
export const STAFF = { role: null, uid: null, name: '', setup: false };
export async function staffRole(user) {
  try {
    const snapshot = await readProfile(user);
    if (snapshot === TOO_SLOW) return null;
    const role = snapshot.exists() ? snapshot.data().role : '';
    if (snapshot.exists()) STAFF.name = String(snapshot.data().name || '');
    if (snapshot.exists()) STAFF.setup = role === 'advocate' && snapshot.data().setupPending === true;
    return role === 'admin' || role === 'advocate' ? role : false;
  } catch {
    return null;
  }
}

/** The cases a staff member works: every one for Eric, their own for an advocate. */
export function staffCasesQuery(user) {
  return STAFF.role === 'advocate'
    ? query(collection(db, 'cases'), where('advocateId', '==', user.uid))
    : collection(db, 'cases');
}
/** The chat subscriptions, the same way. */
export function staffSubsQuery(user) {
  return STAFF.role === 'advocate'
    ? query(collection(db, 'subscriptions'), where('advocateId', '==', user.uid))
    : collection(db, 'subscriptions');
}

/** Redirects anyone who is not staff away from the working pages; returns the user. */
export async function requireAdmin() {
  const user = await requireUser();
  if (!user) return null;
  const role = await staffRole(user);
  // Staff: Eric, or an advocate (2026-10-15). The device hint remembers which,
  // so an unreadable profile on a known device keeps its own half of the app.
  const hint = localStorage.getItem('pa-admin-device');
  const known = role || (role === null && hint ? (hint === 'advocate' ? 'advocate' : 'admin') : null);
  const admin = !!known;
  // A REFUSED READ IS NOT A REFUSAL (Eric, 2026-09-09, in hospital, with the
  // database over its daily read allowance). The profile could not be read,
  // isAdmin said false, and this wiped the trusted-device flag and the PIN
  // pad off the one phone he had and sent him to the marketing page. A
  // device that already carries the admin hint, when the answer is unknown,
  // is left alone: every real door is still the Worker's, which checks for
  // itself, so nothing is opened by staying on the page.
  const unknownButHis = role === null && !!hint;
  if (!admin && !unknownButHis) {
    // Clear the open-to-admin hint BEFORE bouncing to '/', or a stale hint on
    // a non-admin device would bounce '/' right back here, forever. The PIN
    // pad goes with it: this is not his phone.
    localStorage.removeItem('pa-admin-device');
    localStorage.removeItem('pa-admin-door');
    location.href = '/';
    return null;
  }
  // Not waited on (2026-09-24): the cookie only matters to the next page he opens, and this page is
  // already his. Asked for, it lands in the background.
  ensureAdminSession(user);
  // Weekly re-login, Eric's own rule: an admin session older than 7 days is
  // signed out everywhere on this device, trusted-device token included, so
  // getting back in takes the PIN again. Once a week, on a number pad — the
  // rest of the week the trusted device carries him straight in. `pa-admin-door`
  // survives this on purpose, so the PIN pad is still there waiting for him.
  const WEEK_MS = 7 * 86_400_000;
  const since = Number(localStorage.getItem('pa-admin-since') || 0);
  if (!since) {
    localStorage.setItem('pa-admin-since', String(Date.now()));
  } else if (Date.now() - since > WEEK_MS) {
    localStorage.removeItem('pa-admin-since');
    localStorage.removeItem('pa-device-token');
    localStorage.removeItem('pa-admin-device');
    try { await fetch('/api/admin/session', { method: 'DELETE' }); } catch { /* offline */ }
    await signOut(auth);
    location.href = `/signin.html?to=${encodeURIComponent(location.pathname + location.search)}`;
    return null;
  }
  // Mark this device as staff so the landing page can redirect to the
  // dashboard instantly, without waiting for Firebase to wake up. '1' is his,
  // as it has always been; an advocate's device says so.
  localStorage.setItem('pa-admin-device', known === 'advocate' ? 'advocate' : '1');
  STAFF.role = known;
  STAFF.uid = user.uid;
  if (known === 'advocate' && STAFF.setup && !/^\/admin-account/.test(location.pathname)) {
    location.replace('/admin-account.html?setup=1');
    return null;
  }
  try { document.documentElement.dataset.staff = known; } catch { /* no document */ }
  // The tabs each half of the working app shows: loaded only here, on a
  // working page, so no client page ever fetches it.
  import('./admin-staffnav.js').then((m) => m.mountStaffNav(known)).catch(() => {});
  signinStep('ok');
  return user;
}

// A world-readable flag saying whether Eric had a tab open used to be written
// here on every load of an advocate page. Nothing reads it any more: the in
// office / out of office answer comes from the Worker and he sets it himself.
// It was a live signal about him that anybody could read, so it is not written
// and the database rule that published it is closed (database.rules.json).

/** Fills the shared top-nav sign-in/out state on any page that has it. */
export async function hydrateNav() {
  const el = document.querySelector('[data-nav-auth]');
  if (!el) return;
  const user = await currentUser();
  if (user) {
    // Staff, him or an advocate (2026-10-15), get the working side's nav.
    const role = await staffRole(user);
    const admin = role === 'admin';
    const staff = role === 'admin' || role === 'advocate';
    const path = location.pathname;
    if (staff) {
      localStorage.setItem('pa-admin-device', role === 'advocate' ? 'advocate' : '1');
      ensureAdminSession(user);
      el.innerHTML =
        // No "Admin" link: every admin page already carries "Clients", which
        // goes to the same place. Two names for one door in a seven-item menu
        // is one item of pure noise.
        // Off the working pages, though, nothing did (2026-10-16): the home
        // page is reachable now, and Clients is the way back from it.
        (/^\/admin/.test(path) ? '' : '<a href="/admin.html" data-nav-work>Clients</a> ')
        + `<a href="#" data-signout title="${user.email || ''}">Sign out</a>`;
    } else {
      el.innerHTML =
        // "My cases" waits until there is a case to show; a chat-only
        // subscriber never sees a door to an empty room.
        `<a href="/case.html" data-nav-cases hidden class="${path === '/case.html' ? 'active' : ''}">My cases</a>` +
        ` <a href="/chat.html" data-nav-chat class="${path === '/chat.html' ? 'active' : ''}">Chat</a>` +
        // A clear way to cancel, in the menu at the top right (Eric,
        // 2026-10-15: "When they do open a case, they need a clear way to
        // cancel. So that will be in a hamburger menu at the top right").
        // Shown once there is a subscription that is still renewing.
        ` <a href="/subscription.html#cancel" data-nav-cancel hidden>Cancel subscription</a>` +
        ` <a href="#" data-signout title="${user.email || ''}">Sign out</a>`;
      showCancel(el, user).catch(() => {});
      showCases(el, user).catch(() => {});
    }
    el.querySelector('[data-signout]').addEventListener('click', async (e) => {
      e.preventDefault();
      // Untrust this device too, or the sign-in page would silently sign them
      // straight back in and "Sign out" would mean nothing on a shared phone.
      // Signing out on purpose also takes the PIN pad away; the weekly clock
      // in requireAdmin deliberately does not, because a weekly re-login is
      // not the phone changing hands.
      localStorage.removeItem('pa-device-token');
      localStorage.removeItem('pa-admin-device');
      localStorage.removeItem('pa-admin-door');
      // Signing out leaves Demo mode too (2026-10-17), so the next sign-in on
      // this tab opens the real shelf.
      try { sessionStorage.removeItem('pa-demo-live'); } catch { /* no storage */ }
      try { await fetch('/api/admin/session', { method: 'DELETE' }); } catch { /* offline */ }
      await signOut(auth);
      location.href = '/';
    });
    markUnread(user, staff, role).catch(() => {});
    import('./settings.js').then((m) => m.initSettings(user, admin, role === 'advocate')).catch(() => {});
    // What changed since they last opened the app. Loaded soft and shown once:
    // nothing on the page depends on it, and a changelog that fails to load is
    // not a reason for anything else to break. Nobody is shown a changelog on
    // a first-ever visit - they need the app, not its history.
    import('./changelog.js').then((m) => m.showVersionCard(admin, user)).catch(() => {});
  } else {
    el.innerHTML = `<a href="/signin.html">Sign in</a>`;
  }
}

/** Whether a subscription still renews, so there is something to cancel. */
export function renewing(sub, now = Date.now()) {
  if (!sub || sub.status === 'canceled' || sub.cancelAtPeriodEnd) return false;
  const end = sub.currentPeriodEnd?.toDate ? sub.currentPeriodEnd.toDate() : new Date(sub.currentPeriodEnd || 0);
  return end.getTime() > now;
}

async function showCancel(el, user) {
  const snap = await getDoc(doc(db, 'subscriptions', user.uid));
  const link = el.querySelector('[data-nav-cancel]');
  if (link && snap.exists() && renewing(snap.data())) link.hidden = false;
}

async function showCases(el, user) {
  const snap = await getDocs(query(collection(db, 'cases'), where('clientUid', '==', user.uid)));
  const link = el.querySelector('[data-nav-cases]');
  if (link && !snap.empty) link.hidden = false;
}

// Glowing golden diamond on the Chat tab when a conversation is waiting on you:
// for Eric, any thread whose last word was a client's; for a client, any whose
// last word was Eric's.
async function markUnread(user, admin, role) {
  let unread = false;
  try {
    if (admin) {
      // His: every thread. An advocate's: their own (2026-10-15).
      const mine = (name) => (role === 'advocate'
        ? query(collection(db, name), where('advocateId', '==', user.uid))
        : collection(db, name));
      const [cases, subs] = await Promise.all([
        getDocs(mine('cases')),
        getDocs(mine('subscriptions')),
      ]);
      const any = (snap) => snap.docs.some((d) => d.data().lastMessage?.role === 'client');
      unread = any(cases) || any(subs);
    } else {
      const cases = await getDocs(query(collection(db, 'cases'), where('clientUid', '==', user.uid)));
      unread = cases.docs.some((d) => d.data().lastMessage?.role === 'admin');
      if (!unread) {
        const sub = await getDoc(doc(db, 'subscriptions', user.uid));
        unread = sub.exists() && sub.data().lastMessage?.role === 'admin';
      }
    }
  } catch { /* no badge on error */ }
  if (!unread) return;
  const link = admin
    ? document.querySelector('.tabs a[href="/admin-chats.html"]')
    : document.querySelector('[data-nav-chat]');
  if (link && !link.querySelector('.diamond')) {
    link.insertAdjacentHTML('beforeend', ' <span class="diamond" title="Unread messages">◆</span>');
  }
}
