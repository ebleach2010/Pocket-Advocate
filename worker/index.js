// The only server-side code in the app. Routes:
//   POST   /api/checkout           hold a slot, create a Stripe Checkout Session
//   GET    /api/case-for-session   poll after checkout: has the webhook made my case?
//   POST   /api/make-private       revoke a public election (allowed until call time)
//   POST   /api/subscribe          24/7 Priority Chat subscription Checkout ($50/mo)
//   POST   /api/portal             Stripe customer portal (manage/cancel)
//   POST   /api/stripe/webhook     payments + subscription lifecycle -> Firestore
//   POST   /api/admin/slots        open availability slots (admin)
//   DELETE /api/admin/slots/:id    remove an open slot (admin)
//   POST   /api/admin/case-update  join link / milestones / close (admin)
//   POST   /api/admin/schedule     book a client at any time at all (admin)
//   POST   /api/advisor            private LLM advisor: analyse / ask / draft (admin)
// Plus a cron (see scheduled()) that emails unread-chat digests.
// Everything else falls through to the static app in public/.

import { requireUser } from './firebase-auth.js';
import { mintCustomToken, getAccessToken } from './google-auth.js';
import { getDoc, patchDoc, deleteDoc, queryDocs, batchCreate, listDocs } from './firestore.js';
import { deleteFile } from './storage.js';
import { stripePost, verifyWebhook } from './stripe.js';
import {
  slotTimingProblem, windowProblem, HOLD_MINUTES,
  LEAD_TIME_HOURS, MAX_LEAD_TIME_HOURS,
} from './schedule.js';
import { sendEmail, homeScreenTips, signinCodeEmail } from './email.js';
import { notifyUser } from './push.js';
import {
  runAnalysis, runQuestion, runDraft, markPending, runQueuedAnalyses, runStyleDistill,
  runDaySummary, maybeVoiceStudy, voiceLoopState, setVoiceLoop, pingModel,
} from './advisor.js';

// These build the real Stripe line items. Three browser files mirror them for
// display — public/js/book.js, public/js/subscribe.js, public/js/admin-case.js
// — and every price shown there is derived, never typed. Current rates (Eric,
// 2026-08-20): $265 per case, a $75 follow-up session bought separately, and
// $50/mo chat. Change a rate here and change it in those three, or the page
// quotes one number and the card is charged another (which is exactly what
// happened after the $150 experiment).
const CASE_PRICE_CENTS = 26500;
// The follow-up is a second discussion on the same case, sold from the case
// after the report lands rather than at checkout. It is NOT included.
const ADDON_PRICE_CENTS = 7500;
const SUB_PRICE_CENTS = 5000;
// Case chat opens this many days before the booked call; opening it sooner
// costs a one-time fee at the direct-line price. Eric, 2026-08-22:
// "explicitly for avoiding chat abuse by booking two months in advance."
const CHAT_OPEN_DAYS = 7;
const CHAT_OPEN_CENTS = 5000;

// Every completed booking lifts the case and the follow-up by this much. No
// ceiling, and nothing anywhere says it is happening.
const RATE_STEP_CENTS = 1000;
// Sanity rails on the manual setter, not on the ratchet. A typo that sets the
// case rate to $5 or $50,000 should bounce rather than take a booking.
const RATE_MIN_CENTS = 5000;
const RATE_MAX_CENTS = 500000;
const RATES_PATH = 'config/rates';

/**
 * The live rate. Seeded from the constants above the first time it is asked
 * for, so a fresh deploy has no chicken-and-egg and the constants stay the
 * meaningful default rather than becoming dead code.
 *
 * Returns { caseCents, addonCents, bookings, updateTime } — updateTime is
 * Firestore's, and is what makes the raise a compare-and-swap.
 */
async function readRates(env) {
  const doc = await getDoc(env, RATES_PATH).catch(() => null);
  const d = doc?.data || {};
  return {
    caseCents: Number(d.caseCents) > 0 ? Number(d.caseCents) : CASE_PRICE_CENTS,
    addonCents: Number(d.addonCents) > 0 ? Number(d.addonCents) : ADDON_PRICE_CENTS,
    bookings: Number(d.bookings) || 0,
    updateTime: doc?.updateTime || null,
    seeded: !!doc,
  };
}

/**
 * Lift both rates one step, exactly once per real booking.
 *
 * Two ways this goes wrong and both are guarded. Stripe replays webhooks, so
 * the caller only reaches here when a case was genuinely created (patchDoc
 * returns falsy when mustNotExist fails, which is how a replay is detected).
 * And two people can pay in the same second, so the write is conditional on
 * the document not having changed since it was read; a lost race retries with
 * fresh numbers rather than overwriting, so two bookings raise it twice.
 */
async function raiseRates(env, attempt = 0) {
  if (attempt > 4) {
    console.warn('rate raise: gave up after 5 attempts');
    return null;
  }
  const now = await readRates(env);
  const next = {
    caseCents: Math.min(RATE_MAX_CENTS, now.caseCents + RATE_STEP_CENTS),
    addonCents: Math.min(RATE_MAX_CENTS, now.addonCents + RATE_STEP_CENTS),
    bookings: now.bookings + 1,
    updatedAt: new Date(),
  };
  const opts = now.seeded
    ? { mask: ['caseCents', 'addonCents', 'bookings', 'updatedAt'], ifUpdateTime: now.updateTime }
    : { mustNotExist: true };
  const won = await patchDoc(env, RATES_PATH, next, opts).catch(() => false);
  if (won === false) return raiseRates(env, attempt + 1);
  return next;
}

/**
 * GET /api/rates — public, because the landing page and the booking page both
 * quote it before anyone has signed in.
 */
/**
 * POST /api/admin/rates — read the rate, or set it by hand.
 * POST /api/admin/voice — the nightly voice study: read it, stop it, start it.
 *
 * Not asked for, but without it the only way to change the number is a
 * redeploy, and the whole point of moving it out of the source was that it
 * changes on its own. Body { caseCents, addonCents } sets; an empty body
 * reads.
 */
/**
 * The nightly voice study, from his dashboard.
 *
 * GET-shaped read on POST (everything admin here is POST), plus two verbs:
 * `enabled` turns the loop on or off, and `run` forces one now rather than
 * waiting for the evening.
 *
 * "That runs every 24hrs until I say stop" (Eric, 2026-08-21). Stopping it is
 * a switch he can reach at three in the morning, not a redeploy he has to ask
 * for.
 */
async function handleVoiceLoop(request, env, ctx) {
  const admin = await requireAdmin(request, env);
  // 404, not 403. A route that refuses you is a route that exists, and the
  // name of this one describes something a client must not know is happening.
  if (!admin) return json({ error: 'Not found' }, 404);
  if (request.method !== 'POST') return json(await voiceLoopState(env));
  const body = await request.json().catch(() => ({}));
  if (typeof body?.enabled === 'boolean') return json(await setVoiceLoop(env, body.enabled));
  if (body?.run === true) {
    // Through the same gate the cron uses, so a manual run cannot race the
    // scheduled one, cannot run after he pressed Stop, and stamps lastRunAt
    // like any other run. `force` skips only the clock, not the switch and not
    // the claim.
    //
    // And through keepaliveRun, because three readers plus a merge will not
    // return inside a browser request: this codebase learned that once already.
    return keepaliveRun(ctx, maybeVoiceStudy(env, Date.now(), { force: true }), { raw: true });
  }
  return json(await voiceLoopState(env));
}

async function handleSetRates(request, env) {
  const admin = await requireAdmin(request, env);
  // 404 rather than 403, here and on every admin route.
  //
  // A 403 says "this exists and you may not have it". For most of these that
  // is harmless, and for one of them it is not, and the difference is a
  // judgement about a route name that somebody has to remember to make again
  // every time a route is added. Answering 404 everywhere removes the
  // judgement: an admin route is indistinguishable from a path that is not
  // there, whatever it is called. Nothing is lost - the only caller that ever
  // sees these is his own browser, with a valid token.
  if (!admin) return json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => ({}));
  const now = await readRates(env);
  const want = {
    caseCents: body?.caseCents === undefined ? now.caseCents : Number(body.caseCents),
    addonCents: body?.addonCents === undefined ? now.addonCents : Number(body.addonCents),
  };
  for (const [k, v] of Object.entries(want)) {
    if (!Number.isInteger(v) || v < RATE_MIN_CENTS || v > RATE_MAX_CENTS)
      return json({ error: `${k} has to be a whole number of cents between ${RATE_MIN_CENTS} and ${RATE_MAX_CENTS}.` }, 400);
  }
  const changed = want.caseCents !== now.caseCents || want.addonCents !== now.addonCents;
  if (changed) {
    await patchDoc(env, RATES_PATH, { ...want, updatedAt: new Date(), setByHand: true },
      { mask: ['caseCents', 'addonCents', 'updatedAt', 'setByHand'] });
  }
  return json({ ...want, bookings: now.bookings, changed });
}

async function handleRates(env) {
  const r = await readRates(env);
  return json({ caseCents: r.caseCents, addonCents: r.addonCents, chatOpenCents: CHAT_OPEN_CENTS });
}
// Follow-up sessions expire one month after the first discussion (Eric,
// 2026-07-13); clients get one warning email a week before the deadline.
const FOLLOWUP_EXPIRY_DAYS = 30;
const FOLLOWUP_WARN_DAYS = 7;
// Admin-priced sessions: a percentage of THAT CLIENT'S case rate, 25% steps.
const CHARGE_PCTS = [0, 25, 50, 75, 100, 125, 150];
const METHODS = ['phone', 'video'];
const REQUIRED_ACKS = ['disclaimer', 'privacy', 'recording'];
// A chat message this old with no in-app read gets an email nudge (spec: batched).
const DIGEST_MIN_AGE_MS = 10 * 60_000;

/**
 * Files that only ever render on an admin screen. Everything else in public/
 * is fair game for anyone who visits the site, comments included, because
 * there is no build step and no minifier between the repo and the browser.
 *
 * A miss here is silent: the file simply keeps being downloadable. When a new
 * admin-only module is added, it goes in this list in the same commit.
 */
// The .html is optional because Cloudflare's asset handling serves
// /admin.html at /admin as well, and a gate that only knows one spelling is
// not a gate. Trailing slash likewise.
const ADMIN_ASSET =
  /^\/(admin[\w-]*(\.html)?\/?|js\/(admin[\w-]*|advisor|notes|duty|prep|drawer|seen|panel-bridge)\.js|css\/admin\.css)$/;

/**
 * The demo. Its fixtures carry advisor output, so it is subject to the same
 * blindness rule as everything else, and it has no business existing on the
 * live site at all. Not served from anywhere: 404, same as a path that is not
 * there.
 *
 * firebase.js also refuses to enter demo mode on the production hostname, so
 * this is the second of two independent gates rather than the only one.
 */
const DEMO_ASSET = /^\/js\/demo\//;

/**
 * The path the ASSET SERVER will resolve, not the one in the request line.
 *
 * The gate used to test url.pathname as written. The asset server normalises
 * first and then resolves, and it answers a non-canonical spelling of a file
 * that EXISTS with a 307 to the canonical one, while a spelling of a file that
 * does not exist gets a 404. So `/js//advisor.js` and `/js/%61dvisor.js` both
 * slipped past the regex, fell through to the asset server, and came back with
 * a redirect that said, in effect, yes, that file is here.
 *
 * No content was ever served. But the whole point of the byte-identical 404 is
 * that a stranger cannot tell one path from another, and an existence oracle
 * one percent-encoded character away undoes all of it.
 *
 * Decode, collapse repeated slashes, drop "." segments, resolve "..", and drop
 * the trailing dots and spaces some filesystems fold away. Then match.
 */
function canonicalPath(pathname) {
  let p = pathname;
  // Decode repeatedly: %2561 is %61 is "a". Bounded, and a malformed escape
  // just stays as written rather than throwing the request away.
  for (let i = 0; i < 3; i++) {
    let next;
    try { next = decodeURIComponent(p); } catch { break; }
    if (next === p) break;
    p = next;
  }
  p = p.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
  const out = [];
  for (const seg of p.split('/')) {
    const t = seg.replace(/[.\s]+$/, '') || seg;   // "admin.html." -> "admin.html"
    if (t === '.' || t === '') continue;
    if (t === '..') { out.pop(); continue; }
    out.push(t);
  }
  const trailing = /\/$/.test(p) ? '/' : '';
  return `/${out.join('/')}${out.length ? trailing : ''}`;
}

/**
 * The 404 a gated path returns.
 *
 * It used to be hand-built: 9 bytes, text/plain, no cache header. A real miss
 * from the asset server is zero bytes, no content-type, `no-store`. That
 * difference turned every gated name into a yes/no oracle: ask for
 * /js/advisor.js and the shape of the refusal told you the file was there.
 * Now the refusal IS a real miss, fetched from the asset server.
 */
async function notFound(env, request, url) {
  try {
    // Ask for a miss in the SAME directory, so the _headers rules that apply
    // to the real path apply to the refusal too. /js/* carries no-store, and a
    // refusal without it was still distinguishable from a genuine miss.
    const miss = new URL(url.pathname.replace(/[^/]*$/, '__nothing-is-here'), url);
    return await env.ASSETS.fetch(new Request(miss.toString(), { method: request.method }));
  } catch {
    return new Response(null, { status: 404, headers: { 'cache-control': 'no-store' } });
  }
}

/**
 * Has this browser asked for the demo?
 *
 * The demo needs the admin pages to open, and the gate above exists precisely
 * to stop that. Both are right, so the demo asks by name: visiting any page
 * with ?demo=admin sets a cookie, and that cookie is what opens the admin half
 * for the demo. A stranger who never asked still gets the same 404 they would
 * get for a path that does not exist, which is what the blindness audit
 * checks, because the audit never asks.
 *
 * Refused outright on the production host. This is a preview affordance and
 * has no business on the live site.
 */
const DEMO_COOKIE = 'pa_demo';

/** '' if this browser has not asked for the demo, else '1' or 'admin'. */
function demoRole(request, url) {
  if (!DEMO_HOST.test(url.hostname)) return '';
  const q = url.searchParams.get('demo');
  if (q === '0') return '';
  if (q) return q === 'admin' ? 'admin' : '1';
  const m = (request.headers.get('cookie') || '')
    .match(new RegExp(`(?:^|;\\s*)${DEMO_COOKIE}=([^;]+)`));
  return m ? (m[1] === 'admin' ? 'admin' : '1') : '';
}

const demoCookie = (role) =>
  `${DEMO_COOKIE}=${role}; Path=/; SameSite=Lax; Max-Age=86400`;

// A <script src> and a <link rel=stylesheet> cannot carry an Authorization
// header, so the gate reads a cookie instead of a bearer token. Signed with a
// key derived from the service account: no new secret to configure, and it
// rotates if that ever does.
// The live site, by name.
const PROD_HOST = /(^|\.)thepocketadvocates\.com$/i;

/**
 * Hosts the demo may run on, as an ALLOWLIST.
 *
 * It was a denylist of the production domain, which fails open on every other
 * hostname this Worker answers to — and there is a permanent one: without
 * workers_dev:false and an explicit routes block, Cloudflare also publishes it
 * at pocket-advocate.<subdomain>.workers.dev. On that host ?demo=admin was
 * serving js/advisor.js, css/admin.css and the rest to anyone who asked.
 *
 * A versioned preview URL looks like 8f3a91c2-pocket-advocate.<sub>.workers.dev
 * and is created per deployment. That, and a local dev server, are the only
 * two places a demo belongs.
 */
const DEMO_HOST = /^(?:[0-9a-f]{6,}-[\w-]+\.[\w-]+\.workers\.dev|localhost|127\.0\.0\.1|\[::1\])$/i;

const ADMIN_COOKIE = 'pa_adm';
const ADMIN_COOKIE_DAYS = 14;

let adminKeyPromise = null;
function adminKey(env) {
  if (!adminKeyPromise) {
    adminKeyPromise = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(`asset-gate:${env.FIREBASE_SERVICE_ACCOUNT || ''}`))
      .then((raw) => crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']));
  }
  return adminKeyPromise;
}

async function signAdminCookie(env, uid) {
  const exp = Date.now() + ADMIN_COOKIE_DAYS * 86_400_000;
  const body = `${uid}.${exp}`;
  const key = await adminKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${body}.${hex}`;
}

/** The uid this cookie vouches for, or null. Never throws on junk input. */
async function adminCookieUid(request, env) {
  const raw = request.headers.get('cookie') || '';
  const m = raw.match(new RegExp(`(?:^|;\\s*)${ADMIN_COOKIE}=([^;]+)`));
  if (!m) return null;
  const parts = m[1].split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, hex] = parts;
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return null;
  if (!env.ADMIN_UID || uid !== env.ADMIN_UID) return null;
  // Re-sign the exp that came in, and compare. Signing a fresh one would only
  // ever match a cookie minted this millisecond.
  const key = await adminKey(env);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${uid}.${exp}`));
  const want = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(hex, want) ? uid : null;
}

async function adminCookieHeader(env, uid) {
  const value = await signAdminCookie(env, uid);
  return `${ADMIN_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${ADMIN_COOKIE_DAYS * 86_400}`;
}

const ADMIN_COOKIE_CLEAR = `${ADMIN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

/** Attach a fresh admin cookie to a JSON response, if this uid is the admin. */
async function withAdminCookie(env, res, uid) {
  if (!env.ADMIN_UID || uid !== env.ADMIN_UID) return res;
  const out = new Response(res.body, res);
  out.headers.append('set-cookie', await adminCookieHeader(env, uid));
  return out;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/checkout' && request.method === 'POST')
        return await handleCheckout(request, env);
      if (url.pathname === '/api/case-for-session' && request.method === 'GET')
        return await handleCaseForSession(request, env, url);
      if (url.pathname === '/api/make-private' && request.method === 'POST')
        return await handleMakePrivate(request, env);
      if (url.pathname === '/api/subscribe' && request.method === 'POST')
        return await handleSubscribe(request, env);
      if (url.pathname === '/api/portal' && request.method === 'POST')
        return await handlePortal(request, env);
      if (url.pathname === '/api/stripe/webhook' && request.method === 'POST')
        return await handleWebhook(request, env);
      if (url.pathname === '/api/admin/slots' && request.method === 'POST')
        return await handleCreateSlots(request, env);
      if (url.pathname.startsWith('/api/admin/slots/') && request.method === 'DELETE')
        return await handleDeleteSlot(request, env, url);
      if (url.pathname === '/api/admin/case-update' && request.method === 'POST')
        return await handleCaseUpdate(request, env);
      if (url.pathname === '/api/admin/schedule' && request.method === 'POST')
        return await handleAdminSchedule(request, env);
      if (url.pathname === '/api/notify' && request.method === 'POST')
        return await handleNotify(request, env, ctx);
      if (url.pathname === '/api/chat/react' && request.method === 'POST')
        return await handleChatReact(request, env);
      if (url.pathname === '/api/chat/edit' && request.method === 'POST')
        return await handleChatEdit(request, env);
      if (url.pathname === '/api/chat/pass' && request.method === 'POST')
        return await handleChatPass(request, env);
      if (url.pathname === '/api/advisor' && request.method === 'POST')
        return await handleAdvisor(request, env, ctx);
      if (url.pathname === '/api/advisor/state' && request.method === 'GET')
        return await handleAdvisorState(request, env, url);
      if (url.pathname === '/api/advisor/covers' && request.method === 'GET')
        return await handleAdvisorCovers(request, env);
      if (url.pathname === '/api/advisor/dictionary')
        return await handleDictionary(request, env);
      if (url.pathname === '/api/push/test' && request.method === 'POST')
        return await handlePushTest(request, env);
      if (url.pathname === '/api/admin/pin' && request.method === 'POST')
        return await handlePinLogin(request, env);
      if (url.pathname === '/api/admin/login' && request.method === 'POST')
        return await handleAdminLogin(request, env);
      if (url.pathname === '/api/auth/request-code' && request.method === 'POST')
        return await handleRequestCode(request, env);
      if (url.pathname === '/api/auth/verify-code' && request.method === 'POST')
        return await handleVerifyCode(request, env);
      if (url.pathname === '/api/auth/device-signin' && request.method === 'POST')
        return await handleDeviceSignin(request, env);
      if (url.pathname === '/api/chat-unlock' && request.method === 'POST')
        return await handleChatUnlock(request, env);
      if (url.pathname === '/api/tip' && request.method === 'POST')
        return await handleTip(request, env);
      if (url.pathname === '/api/review' && request.method === 'POST')
        return await handleReviewSubmit(request, env);
      if (url.pathname === '/api/reviews' && request.method === 'GET')
        return await handleReviewsPublic(env);
      if (url.pathname === '/api/followup' && request.method === 'POST')
        return await handleFollowUpCheckout(request, env);
      if (url.pathname === '/api/changelog' && request.method === 'GET')
        return await handleChangelog(request, env);
      if (url.pathname === '/api/reviews/admin')
        return await handleReviewsAdmin(request, env);
      if (url.pathname === '/api/rates' && request.method === 'GET')
        return await handleRates(env);
      if (url.pathname === '/api/admin/rates' && request.method === 'POST')
        return await handleSetRates(request, env);
      if (url.pathname === '/api/admin/voice')
        return await handleVoiceLoop(request, env, ctx);
      if (url.pathname === '/api/version' && request.method === 'GET')
        return json({ tag: BUILD_TAG, version: VERSION });
      if (url.pathname === '/api/summary' && request.method === 'POST')
        return await handleDaySummary(request, env);
      if (url.pathname === '/api/saved')
        return await handleSaved(request, env, url);
      if (url.pathname === '/api/agenda')
        return await handleAgenda(request, env, url);
      if (url.pathname === '/api/file/delete' && request.method === 'POST')
        return await handleFileDelete(request, env);
      if (url.pathname === '/api/admin/ledger' && request.method === 'GET')
        return await handleLedger(request, env);
      if (url.pathname === '/api/chattime' && request.method === 'POST')
        return await handleChatTime(request, env);
      if (url.pathname === '/api/uploaded' && request.method === 'POST')
        return await handleUploaded(request, env);
      if (url.pathname === '/api/admin/session')
        return await handleAdminSession(request, env);
      if (url.pathname.startsWith('/api/')) {
        // The same token check every real route does, and then the same 404.
        //
        // The advisor routes answer 404 so a client cannot tell them from a
        // path that is not there. That worked on the body and the status and
        // failed on the clock: a gated route verified a token and read a
        // profile before saying "not found", so it took fifty times longer
        // than an unknown one, and the Network tab showed which was which.
        // Doing the work here evens them out. It costs a real client nothing:
        // they never ask for a route that does not exist.
        await requireUser(request, env).catch(() => null);
        return json({ error: 'Not found' }, 404);
      }
    } catch (err) {
      console.error(`${url.pathname}:`, err.stack || err);
      return json({ error: 'Internal error' }, 500);
    }

    const demo = demoRole(request, url);
    // What the asset server will actually resolve. Every gate below tests this
    // rather than the spelling in the request line.
    const assetPath = canonicalPath(url.pathname);

    // The suite's front door is the one demo file served by HOST alone: the
    // pages import it to OFFER the demo, before any demo cookie exists. On the
    // live site it gets the same 404 as a missing path, and with it every
    // admin-naming string it carries stays out of the live site's bytes.
    if (assetPath === '/js/demo/suite.js') {
      if (!DEMO_HOST.test(url.hostname)) return notFound(env, request, url);
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'no-store');
      return out;
    }

    // The demo's own files carry advisor fixtures, so they are gated exactly
    // like the admin ones: a browser that never asked for the demo gets the
    // same 404 it would get for a path that is not there. On the production
    // host demoRole is always '', so they are simply not served at all.
    if (DEMO_ASSET.test(assetPath) && !demo) return notFound(env, request, url);

    // A browser that asked for the admin demo gets the admin half of it, on a
    // preview host only. The cookie is set here so the pages the demo
    // navigates to keep working once the query string is gone.
    if ((ADMIN_ASSET.test(assetPath) || DEMO_ASSET.test(assetPath)) && demo) {
      const wantsAdmin = ADMIN_ASSET.test(assetPath);
      if (wantsAdmin && demo !== 'admin') {
        // Asked for the client demo and reached for the admin half. A PAGE is
        // sent to sign in, because that is a person who navigated somewhere.
        // A module or a stylesheet is a fetch, and it gets the same 404 a path
        // that is not there gets.
        //
        // This branch used to redirect both, so inside the client demo every
        // real admin module answered with a redirect naming the file, and
        // every made-up one answered 404. That is the existence oracle the
        // non-demo gate twenty lines below was written to remove, reopened for
        // exactly the people the demo gets shown to.
        if (!/^\/admin[\w-]*(\.html)?\/?$/.test(assetPath)) {
          return notFound(env, request, url);
        }
        const to = new URL('/signin.html', url);
        to.searchParams.set('to', '/');
        return Response.redirect(to.toString(), 302);
      }
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'private, no-store');
      out.headers.set('vary', 'Cookie');
      out.headers.append('set-cookie', demoCookie(demo));
      return out;
    }

    // The admin half of the site. A stranger gets a real miss from the asset
    // server, byte for byte, so this does not confirm what is here.
    if (ADMIN_ASSET.test(assetPath)) {
      const isPage = /^\/admin[\w-]*(\.html)?\/?$/.test(assetPath);
      const uid = await adminCookieUid(request, env).catch(() => null);
      if (!uid) {
        // Pages too, not only modules. The old branch bounced a signed-out
        // request for an admin PAGE to /signin.html?to=<the admin path> while
        // every other missing path got the 404 - one curl told a stranger the
        // admin area exists and where its door is, which is exactly the
        // oracle the byte-identical 404 exists to close. Eric never needed
        // the bounce: every path of his goes through the sign-in page - the
        // landing redirect points there, the weekly sign-out lands there, and
        // signing in mints the cookie this gate wants. (Post-2.2 audit,
        // 2026-08-21.)
        return notFound(env, request, url);
      }
      // _headers puts `public, max-age=3600` on /css/*, which would let a
      // shared cache keep admin.css and hand it to the next person who asks.
      // Anything behind this gate is per-person and never stored.
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'private, no-store');
      out.headers.set('vary', 'Cookie');
      // Serving an admin page renews the cookie, so an open tab never expires
      // out from under the modules it is about to ask for.
      if (isPage) out.headers.append('set-cookie', await adminCookieHeader(env, uid));
      return out;
    }

    // Landing anywhere with ?demo= is how a demo starts, and the cookie has to
    // be set right there: the very next thing the page does is import the demo
    // store, and that request carries no query string of its own.
    if (demo && url.searchParams.get('demo')) {
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'no-store');
      out.headers.append('set-cookie', demoCookie(demo));
      return out;
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    // The cron fires every five minutes, because Eric asked for a read within
    // five minutes of a message or a document landing. Only the advisor queue
    // wants that cadence: the digests and sweeps are quarter-hourly work and
    // running them three times as often would be three times the Firestore
    // reads for the same outcome, so they still only run on the quarter hour.
    const minute = new Date(event.scheduledTime || Date.now()).getUTCMinutes();
    if (minute % 15 === 0) {
      ctx.waitUntil(runChatDigest(env));
      ctx.waitUntil(runFollowUpWarnings(env));
      ctx.waitUntil(runChatOpenNotices(env));
      ctx.waitUntil(cleanupStaleSlots(env));
      ctx.waitUntil(repairMissingCaseEmails(env));
      ctx.waitUntil(closeDeliveredCases(env));
      ctx.waitUntil(purgeRecaps(env));
    }
    ctx.waitUntil(runQueuedAnalyses(env));
    // The nightly voice study. Returns immediately on every fire but one: it
    // wants his evening, a day since the last run, and no explicit off switch.
    ctx.waitUntil(maybeVoiceStudy(env));
    // Runs once, ever. Instant no-op on every fire after that.
    ctx.waitUntil(grandfatherFollowUps(env));
    // Same deal: Eric's Tuesday hours, opened once, no-op forever after.
    ctx.waitUntil(openTuesdaySlots(env));
    // And the seven-reader voice study's first pass, once, right away.
    ctx.waitUntil(voiceStudyKickoff(env));
    // And the vanished send-as-me, put back where it belonged, once.
    ctx.waitUntil(reviveLostSend(env));
  },
};

/**
 * Everyone who booked before the repricing keeps the follow-up they paid for.
 *
 * (Eric, 2026-08-21: "Be sure the current client gets grandfathered in to
 * having a booked follow up - he's already paid, I only have one.")
 *
 * A case used to include the follow-up session in its price. It does not any
 * more: it is a separate $75 purchase off the case page. Shipping that change
 * without this would quietly take a session off somebody who had already been
 * charged for it, and would ask him to pay a second time for it.
 *
 * Every case that exists at the moment this first runs predates the change, so
 * every one of them is granted the flag the rest of the system already
 * understands. Cases opened afterwards buy it the new way.
 *
 * Written as a marker doc created with mustNotExist, so two cron fires in the
 * same minute cannot both claim the job, and a restart cannot replay it.
 */
/**
 * Run-once: fire one voice study immediately (Eric, 2026-08-22: seven
 * readers "to read through my messages NOW"). force skips the clock and the
 * once-a-day gap but honors his off switch and the concurrent-claim guard
 * inside maybeVoiceStudy, so this can never stack a second study on a live
 * one. The nightly loop then carries on at its new 10pm hour.
 */
async function voiceStudyKickoff(env) {
  const MARKER = 'migrations/voice-study-2026-08-22';
  const m = await getDoc(env, MARKER);
  if (m?.data.finishedAt) return;
  if (m && Date.now() - new Date(m.data.startedAt).getTime() < 30 * 60_000) return;
  const claimed = m
    ? await patchDoc(env, MARKER, { startedAt: new Date() }, { ifUpdateTime: m.updateTime })
    : await patchDoc(env, MARKER, { startedAt: new Date() }, { mustNotExist: true });
  if (!claimed) return;
  try {
    const out = await maybeVoiceStudy(env, Date.now(), { force: true });
    await patchDoc(env, MARKER, { finishedAt: new Date(), result: out?.reason || (out?.ran ? 'ran' : 'no') },
      { mask: ['finishedAt', 'result'] });
    console.log('voice study kickoff:', JSON.stringify(out));
  } catch (err) {
    console.error('voice study kickoff:', err.message || err);
  }
}

/**
 * Run-once: open every Tuesday 10am to 7pm MST, hourly, through 2026-10-20
 * (Eric, 2026-08-22: "Open my schedule every Tuesday from 10am-7pm for the
 * next two months."). Same claim pattern as the grandfather migration; the
 * slot writes are batchCreate with mustNotExist, so a Tuesday slot he
 * already opened (or that a client is mid-booking on) is skipped, never
 * clobbered. Far Tuesdays sit invisible to clients until they roll inside
 * the 1.5 week booking horizon, exactly per his quiet-horizon rule.
 */
async function openTuesdaySlots(env) {
  const MARKER = 'migrations/tuesdays-2026-08-22';
  const m = await getDoc(env, MARKER);
  if (m?.data.finishedAt) return;
  if (m && Date.now() - new Date(m.data.startedAt).getTime() < 10 * 60_000) return;
  const claimed = m
    ? await patchDoc(env, MARKER, { startedAt: new Date() }, { ifUpdateTime: m.updateTime })
    : await patchDoc(env, MARKER, { startedAt: new Date() }, { mustNotExist: true });
  if (!claimed) return;

  // Tuesdays, MST dates. MST is fixed UTC-7, so 10:00 MST = 17:00 UTC and
  // 18:00 MST (the 6pm start that ends 7pm) rolls into 01:00 UTC next day;
  // Date.UTC carries the overflow.
  const TUESDAYS = [
    [2026, 8, 25], [2026, 9, 1], [2026, 9, 8], [2026, 9, 15], [2026, 9, 22],
    [2026, 9, 29], [2026, 10, 6], [2026, 10, 13], [2026, 10, 20],
  ];
  const entries = [];
  for (const [y, mo, d] of TUESDAYS) {
    for (let h = 10; h <= 18; h++) {
      const start = new Date(Date.UTC(y, mo - 1, d, h + 7));
      if (start.getTime() < Date.now() + LEAD_TIME_HOURS * 3600_000) continue;
      if (windowProblem(start.toISOString(), 60)) continue;
      entries.push({
        path: `availability/${slotIdFor(start)}`,
        data: { start, durationMin: 60, state: 'open' },
      });
    }
  }
  try {
    const { created, skipped } = await batchCreate(env, entries);
    await patchDoc(env, MARKER, { finishedAt: new Date(), created, skipped },
      { mask: ['finishedAt', 'created', 'skipped'] });
    console.log(`tuesday slots: created ${created}, skipped ${skipped}`);
  } catch (err) {
    console.error('tuesday slots:', err.message || err);
  }
}

/**
 * Run-once: revive the send-as-me that vanished (Eric, 2026-08-22). His
 * edited draft ended "...is at the bottom ten of my differential"; the send
 * either landed invisibly (the oldest-200 render window, fixed in this same
 * deploy) or died. The edited text survives regardless, because
 * draft-feedback archives every changed send as a style pair. So: find the
 * newest archived send carrying the phrase; if the thread already holds an
 * admin message with it, do nothing (the window fix makes it visible);
 * otherwise write it into the chat as Eric, stamp lastMessage, and nudge
 * the client, exactly as a normal send would have.
 */
async function reviveLostSend(env) {
  const MARKER = 'migrations/revive-2026-08-22';
  const m = await getDoc(env, MARKER);
  if (m?.data.finishedAt) return;
  if (m && Date.now() - new Date(m.data.startedAt).getTime() < 10 * 60_000) return;
  const claimed = m
    ? await patchDoc(env, MARKER, { startedAt: new Date() }, { ifUpdateTime: m.updateTime })
    : await patchDoc(env, MARKER, { startedAt: new Date() }, { mustNotExist: true });
  if (!claimed) return;
  const done = (result) => patchDoc(env, MARKER, { finishedAt: new Date(), result },
    { mask: ['finishedAt', 'result'] }).catch(() => {});
  try {
    const flat = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const needle = 'bottom ten of my differential';
    const edits = await listDocs(env, 'advisorStyle/profile/edits', { pageSize: 200, all: true });
    const row = edits
      .filter((r) => r.data.sent && flat(r.data.sent).includes(needle))
      .sort((a, b) => new Date(b.data.at || 0) - new Date(a.data.at || 0))[0];
    if (!row) return done('no archived send matched');
    const { kind, id } = row.data;
    const parent = kind === 'sub' ? 'subscriptions' : 'cases';
    const chat = await listDocs(env, `${parent}/${id}/chat`, { pageSize: 300, all: true })
      .catch(() => []);
    if (chat.some((c) => c.data.role === 'admin' && flat(c.data.text).includes(needle)))
      return done('already in the thread; the window fix surfaces it');
    const admins = await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 5);
    const eric = admins[0];
    if (!eric) return done('no admin user found');
    const text = String(row.data.sent).slice(0, 2200);
    await patchDoc(env, `${parent}/${id}/chat/${crypto.randomUUID()}`, {
      from: eric.id, role: 'admin', text, ts: new Date(),
    });
    await patchDoc(env, `${parent}/${id}`, {
      lastMessage: {
        text: text.slice(0, 120), from: eric.id, role: 'admin', ts: new Date(), emailed: false,
      },
    }, { mask: ['lastMessage'] }).catch(() => {});
    const clientUid = kind === 'sub' ? id : (await getDoc(env, `cases/${id}`))?.data.clientUid;
    if (clientUid) {
      await notifyUser(env, clientUid, {
        title: 'Pocket Advocate',
        body: `${firstName(eric.data.name) || 'Eric'} sent you a message.`,
        link: kind === 'sub' ? '/subscription.html' : `/case.html?id=${id}`,
      }).catch(() => {});
    }
    return done('revived and sent');
  } catch (err) {
    console.error('revive lost send:', err.message || err);
  }
}

async function grandfatherFollowUps(env) {
  const MARKER = 'migrations/followUpGrandfather';
  // Done means FINISHED, not merely started. Gating on the marker's existence
  // meant one thrown write mid-loop - a Firestore blip, nothing more - froze
  // the migration half-done forever: the marker existed, so every later fire
  // returned at the door, and whoever was after the failure never got the
  // follow-up they had paid for. A claim older than ten minutes with no
  // finishedAt is a corpse, and the next fire takes over from it; the
  // per-case grant is idempotent (addOnFollowUp already set = skipped), so a
  // takeover re-covers the survivors and finishes the rest.
  // (Post-2.2 audit, 2026-08-21.)
  const m = await getDoc(env, MARKER);
  if (m?.data.finishedAt) return;
  if (m && Date.now() - new Date(m.data.startedAt).getTime() < 10 * 60_000) return;
  const claimed = m
    ? await patchDoc(env, MARKER, { startedAt: new Date() }, { ifUpdateTime: m.updateTime })
    : await patchDoc(env, MARKER, { startedAt: new Date() }, { mustNotExist: true });
  if (!claimed) return;   // another fire got there first

  const cases = await listDocs(env, 'cases', { all: true });
  const granted = [];
  for (const c of cases) {
    const d = c.data || {};
    // Already has it, however it got there. Never touch a paid record twice.
    if (d.addOnFollowUp) continue;
    await patchDoc(env, `cases/${c.id}`, {
      addOnFollowUp: true,
      // The 30 day window starts now, not at a call that may be weeks behind
      // them - the same rule confirmFollowUpPurchase uses.
      addOnFollowUpAt: new Date(),
      grandfathered: true,
      // pendingFollowUp is left alone on purpose: a checkout opened before the
      // migration stays payable for hours, and wiping the record here is what
      // made that payment vanish from the ledger when it completed.
    }, { mask: ['addOnFollowUp', 'addOnFollowUpAt', 'grandfathered'] });
    granted.push(c.id);
  }
  await patchDoc(env, MARKER, {
    startedAt: new Date(), finishedAt: new Date(), granted, count: granted.length,
  });
}

// Bumped on each meaningful deploy; served at GET /api/version so a human can
// confirm which build is live without guessing about caches.
const BUILD_TAG = 'v2026-08-22-revive';
// Every merge to main is a version. The notes themselves live in
// public/js/changelog.js, next to the code that draws the card; this constant
// is here so /api/version can say which release is live without the caller
// having to load a client module to find out. Eric's rule (2026-08-21):
// every push to main bumps this and changelog.js's VERSION together, and the
// newest changelog entry's client notes are replaced with that push's
// client-visible changes and bug fixes.
const VERSION = '2.5';

/**
 * The 48 hours the review card promises. "The chat closes 48hrs after you
 * receive your advocacy case review" is a sentence a client reads on their own
 * screen, so it has to be true without Eric remembering to make it true.
 *
 * Closing ends the chat and nothing else. The file, the report, the recording
 * and every message stay theirs forever, which is what the card says two lines
 * further down and what the close mail repeats.
 */
async function closeDeliveredCases(env) {
  try {
    const rows = await queryDocs(env, 'cases', [['status', 'EQUAL', 'delivered']], 40);
    const cutoff = Date.now() - REVIEW_WINDOW_MS;
    for (const row of rows) {
      const at = row.data.reportDeliveredAt ? new Date(row.data.reportDeliveredAt).getTime() : 0;
      // No delivery stamp means an older case that predates the field. Leave
      // it alone rather than closing a chat on a guess.
      if (!at || at > cutoff) continue;
      await patchDoc(env, `cases/${row.id}`, {
        status: 'closed', closedAt: new Date(), closedBy: 'automatic',
      }, { mask: ['status', 'closedAt', 'closedBy'] });
      await sendEmail(env, {
        to: row.data.clientEmail,
        subject: 'Your case file is yours to keep',
        html: `<p>It has been a couple of days since your report landed, so the
          case chat is now closed.</p>
          <p>Everything else stays exactly where it is. Your report, your
          recording, your documents and the whole chat log remain in your file
          for as long as you want them, and you can download or print any of it
          at any time.</p>
          <p>If something new comes up, you can book another case whenever you
          need one.</p>
          <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
      }).catch(() => { /* the close still stands if the mail fails */ });
      await notifyUser(env, row.data.clientUid, {
        title: 'Pocket Advocate',
        body: 'Your case chat has closed. Your file stays yours.',
        link: '/case.html',
      }).catch(() => {});
    }
  } catch (err) {
    console.warn('close delivered:', err.message || err);
  }
}

// Open, unbooked slots whose start is already past — or inside the booking
// lead window — can never be booked. The cron sweeps them out of the database
// so the admin calendar and the client picker never show dead inventory.
// Booked and actively-held slots are never touched. Deletions are capped per
// run: Workers limit outbound calls per invocation, and the cron comes back
// every 15 minutes anyway.
async function cleanupStaleSlots(env) {
  try {
    const open = await queryDocs(env, 'availability', [['state', 'EQUAL', 'open']], 300);
    const cutoff = Date.now() + LEAD_TIME_HOURS * 3600_000;
    const stale = open
      .filter((s) => new Date(s.data.start).getTime() < cutoff)
      .slice(0, 40);
    for (const s of stale) await deleteDoc(env, `availability/${s.id}`);
    if (stale.length) console.log(`slot cleanup: deleted ${stale.length} unbookable open slots`);
  } catch (err) {
    console.warn('slot cleanup failed:', err.message || err);
  }
}

/**
 * Repair cases that were created without a client email, and send the booking
 * confirmation those clients never got.
 *
 * A case with no `clientEmail` is a client who paid and heard nothing, and who
 * can never be emailed again — every sendEmail() to them silently no-ops. This
 * happened for real: checkout read `user.email`, which is always null on
 * custom-token accounts, and the webhook's only fallback was Stripe's
 * `customer_email` (which is just what we passed in, i.e. also nothing).
 * The address is on `users/{uid}` the whole time, so fill it in and follow
 * through. `bookingEmailSentAt` makes the send exactly-once.
 */
async function repairMissingCaseEmails(env) {
  try {
    const rows = await queryDocs(env, 'cases', [['clientEmail', 'EQUAL', null]], 25);
    for (const row of rows) {
      const c = row.data;
      if (!c.clientUid) continue;
      const profile = await getDoc(env, `users/${c.clientUid}`);
      const email = profile?.data.email;
      if (!email) continue;

      const now = new Date();
      await patchDoc(env, `cases/${row.id}`, {
        clientEmail: email,
        bookingEmailSentAt: now,
      }, { mask: ['clientEmail', 'bookingEmailSentAt'] });
      console.log(`case ${row.id}: backfilled client email`);

      if (c.bookingEmailSentAt) continue; // already told them somehow
      const start = c.appointment?.start ? new Date(c.appointment.start) : null;
      if (!start) continue;
      await sendEmail(env, {
        to: email,
        subject: 'Your Pocket Advocate case is open',
        html: `<p>Payment confirmed — your case file is live.</p>
          ${whenHtml(start, c.clientTz)}
          <p>Meeting method: ${escHtml(c.appointment?.method || 'video')}.</p>
          <p>Upload labs, imaging, or records any time before the call.</p>
          <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>
          ${homeScreenTips(env.PUBLIC_BASE_URL)}`,
      });
    }
  } catch (err) {
    console.warn('case email repair failed:', err.message || err);
  }
}

/**
 * Stripe line items for a case. One line, one product: booking buys the case
 * and nothing else (Eric, 2026-08-20). The follow-up is sold from the case
 * after the report lands, rather than as a second decision put in front of
 * somebody still deciding whether to trust him at all.
 */
function caseLineItems(cents) {
  return [
    {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: cents,
        product_data: { name: 'Advocacy Case', description: 'Live discussion + written report' },
      },
    },
  ];
}

/** The follow-up, bought on its own from an existing case. */
function followUpLineItems(cents) {
  return [
    {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: cents,
        product_data: {
          name: 'Follow-up session',
          description: 'A second discussion on this same case',
        },
      },
    },
  ];
}

// ---- POST /api/checkout ----
// Body: { slotId | requestedStart, method, phone?, addOnFollowUp, acks: {form: ms} }
// requestedStart is a time the client asked for that isn't on the calendar. It
// takes payment like any booking, but the case is flagged pending until the
// admin confirms or declines it.
async function handleCheckout(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in to book.' }, 401);
  const identity = await requireAdultProfile(env, user.uid);
  if (identity.error) return json({ error: identity.error }, identity.code);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400);
  const { slotId, requestedStart, method, phone, acks } = body;
  const clientTz = validTz(body.tz);

  if (!METHODS.includes(method)) return json({ error: 'Choose a meeting method.' }, 400);
  if (method === 'phone' && !/^\+?[\d\s().-]{7,20}$/.test(phone || ''))
    return json({ error: 'A valid phone number is required for a phone call.' }, 400);
  for (const form of REQUIRED_ACKS)
    if (!acks || typeof acks[form] !== 'number')
      return json({ error: 'All acknowledgment forms must be completed first.' }, 400);

  // Two paths: an open slot off the calendar, or a time the client requested.
  const isRequest = !slotId && typeof requestedStart === 'string';
  if (isRequest) return await checkoutRequestedTime(env, {
    user, identity, requestedStart, method, phone, acks, clientTz, body,
  });

  // Load and validate the slot.
  if (typeof slotId !== 'string' || !/^[\w-]{1,64}$/.test(slotId))
    return json({ error: 'Invalid slot.' }, 400);
  const slot = await getDoc(env, `availability/${slotId}`);
  if (!slot) return json({ error: 'That time is no longer available.' }, 409);
  const now = new Date();
  const holdExpired =
    slot.data.state === 'held' &&
    slot.data.holdExpiresAt &&
    new Date(slot.data.holdExpiresAt) < now;
  if (slot.data.state !== 'open' && !holdExpired)
    return json({ error: 'That time is no longer available.' }, 409);
  const timingProblem = slotTimingProblem(slot.data.start, slot.data.durationMin || 60, now);
  if (timingProblem) return json({ error: timingProblem }, 409);

  // Hold the slot. The updateTime precondition makes two simultaneous
  // checkouts for the same slot impossible — the loser gets a 409.
  const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  const held = await patchDoc(
    env,
    `availability/${slotId}`,
    { state: 'held', holdExpiresAt, heldByUid: user.uid },
    { ifUpdateTime: slot.updateTime, mask: ['state', 'holdExpiresAt', 'heldByUid'] }
  );
  if (!held) return json({ error: 'Someone just grabbed that time. Pick another slot.' }, 409);

  // Between the page quoting a number and this button being pressed, someone
  // else can have booked and moved the rate. The browser sends what it
  // displayed; a mismatch comes back as a 409 carrying the real figure, and
  // the page updates the number and re-enables the button. Honest about what
  // it costs, silent about why it changed.
  const live = await readRates(env);
  const quoted = Number(body?.quotedCents) || 0;
  if (quoted && quoted !== live.caseCents) {
    // The slot was held a few lines up. Give it back rather than parking it
    // for 30 minutes on a checkout that is not going to happen.
    await patchDoc(env, `availability/${slotId}`,
      { state: 'open', holdExpiresAt: null, heldByUid: null },
      { mask: ['state', 'holdExpiresAt', 'heldByUid'] }).catch(() => {});
    return json({ error: 'rate-changed', caseCents: live.caseCents, addonCents: live.addonCents }, 409);
  }
  const lineItems = caseLineItems(live.caseCents);

  const session = await stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: identity.email || user.email || undefined,
    line_items: lineItems,
    success_url: `${env.PUBLIC_BASE_URL}/return.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.PUBLIC_BASE_URL}/book.html?canceled=1`,
    expires_at: Math.floor(holdExpiresAt.getTime() / 1000),
    metadata: {
      uid: user.uid,
      email: identity.email || user.email || '',
      name: identity.name,
      dob: identity.dob,
      tz: clientTz || '',
      slotId,
      method,
      phone: method === 'phone' ? phone : '',
      acks: JSON.stringify(acks),
    },
  });

  // Remember which session owns the hold so the webhook can match it.
  await patchDoc(env, `availability/${slotId}`, { heldBySession: session.id }, {
    mask: ['heldBySession'],
  });

  return json({ url: session.url });
}

/**
 * Checkout for a time the client asked for that isn't on the calendar. There
 * is no availability doc to hold — nothing is reserved — so the case is created
 * flagged `appointment.requested`, and the admin confirms or declines it.
 */
async function checkoutRequestedTime(env, o) {
  const { user, identity, requestedStart, method, phone, acks, clientTz } = o;
  const start = new Date(requestedStart);
  if (Number.isNaN(start.getTime())) return json({ error: 'Pick a valid date and time.' }, 400);

  // Lead time and horizon still apply, but NOT the 8am-6pm MST window: a time
  // outside my usual hours is the single most likely thing to be requested,
  // and every request is confirmed by hand anyway. Running the full
  // slotTimingProblem() here would reject exactly the cases this exists for.
  const leadMs = start.getTime() - Date.now();
  if (leadMs < LEAD_TIME_HOURS * 3600_000)
    return json({ error: `Please pick a time at least ${LEAD_TIME_HOURS} hours from now.` }, 409);
  if (leadMs > MAX_LEAD_TIME_HOURS * 3600_000)
    return json({ error: 'Please pick a time within the next week and a half.' }, 409);

  // The live rate, and the same honesty check the slot path runs. This built
  // its line items with NO amount at all - caseLineItems() with nothing in it
  // - so Stripe rejected every single requested-time checkout since the
  // ratchet landed: the one path made for people whose time is not on the
  // calendar could not take their money. (Post-2.2 audit, 2026-08-21.)
  const live = await readRates(env);
  const quoted = Number(o.body?.quotedCents) || 0;
  if (quoted && quoted !== live.caseCents)
    return json({ error: 'rate-changed', caseCents: live.caseCents, addonCents: live.addonCents }, 409);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  const lineItems = caseLineItems(live.caseCents);
  const session = await stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: identity.email || user.email || undefined,
    line_items: lineItems,
    success_url: `${env.PUBLIC_BASE_URL}/return.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.PUBLIC_BASE_URL}/book.html?canceled=1`,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    metadata: {
      uid: user.uid,
      email: identity.email || user.email || '',
      name: identity.name,
      dob: identity.dob,
      tz: clientTz || '',
      slotId: '',
      requestedStart: start.toISOString(),
      method,
      phone: method === 'phone' ? phone : '',
      acks: JSON.stringify(acks),
    },
  });
  return json({ url: session.url });
}

// ---- GET /api/case-for-session?session_id=cs_... ----
async function handleCaseForSession(request, env, url) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const sessionId = url.searchParams.get('session_id') || '';
  const rows = await queryDocs(env, 'cases', [
    ['clientUid', 'EQUAL', user.uid],
    ['stripe.sessionId', 'EQUAL', sessionId],
  ], 1);
  if (!rows.length) return json({ ready: false });
  return json({ ready: true, caseId: rows[0].id });
}

// ---- POST /api/make-private ----  Body: { caseId }
async function handleMakePrivate(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const { caseId } = await request.json().catch(() => ({}));
  if (typeof caseId !== 'string' || !/^[\w-]{1,64}$/.test(caseId))
    return json({ error: 'Bad request' }, 400);

  const doc = await getDoc(env, `cases/${caseId}`);
  if (!doc || doc.data.clientUid !== user.uid) return json({ error: 'Not found' }, 404);
  const election = doc.data.publicElection || {};
  if (election.choice !== 'public') return json({ ok: true, choice: 'private' });
  if (election.revocableUntil && new Date(election.revocableUntil) < new Date())
    return json({ error: 'The broadcast window has already started.' }, 409);

  const history = Array.isArray(election.history) ? election.history : [];
  history.push({ choice: 'private', at: new Date() });
  await patchDoc(
    env,
    `cases/${caseId}`,
    { publicElection: { ...election, choice: 'private', history } },
    { mask: ['publicElection'] }
  );
  return json({ ok: true, choice: 'private' });
}

// ---- POST /api/subscribe ----  Body: { termsAckAt } (form 5 acknowledgment)
async function handleSubscribe(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in to subscribe.' }, 401);
  const identity = await requireAdultProfile(env, user.uid);
  if (identity.error) return json({ error: identity.error }, identity.code);
  const { termsAckAt } = await request.json().catch(() => ({}));
  if (typeof termsAckAt !== 'number')
    return json({ error: 'Please read and acknowledge the subscription terms first.' }, 400);

  const existing = await getDoc(env, `subscriptions/${user.uid}`);
  if (existing && new Date(existing.data.currentPeriodEnd || 0) > new Date())
    return json({ error: 'You already have an active subscription.' }, 409);

  const session = await stripePost(env, '/checkout/sessions', {
    mode: 'subscription',
    customer_email: identity.email || user.email || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: SUB_PRICE_CENTS,
          recurring: { interval: 'month' },
          product_data: {
            name: '24/7 Priority Chat',
            description: 'Anytime chat with me, your advocate',
          },
        },
      },
    ],
    success_url: `${env.PUBLIC_BASE_URL}/subscription.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.PUBLIC_BASE_URL}/subscribe.html?canceled=1`,
    metadata: { uid: user.uid, email: identity.email || user.email || '', termsAckAt: String(termsAckAt) },
    subscription_data: { metadata: { uid: user.uid } },
  });
  return json({ url: session.url });
}

// ---- POST /api/portal ----  Manage/cancel via Stripe's customer portal
async function handlePortal(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const sub = await getDoc(env, `subscriptions/${user.uid}`);
  if (!sub || !sub.data.stripeCustomerId) return json({ error: 'No subscription found.' }, 404);
  const session = await stripePost(env, '/billing_portal/sessions', {
    customer: sub.data.stripeCustomerId,
    return_url: `${env.PUBLIC_BASE_URL}/subscription.html`,
    ...(env.STRIPE_PORTAL_CONFIG ? { configuration: env.STRIPE_PORTAL_CONFIG } : {}),
  });
  return json({ url: session.url });
}

// ---- POST /api/stripe/webhook ----
async function handleWebhook(request, env) {
  const payload = await request.text();
  const event = await verifyWebhook(
    payload,
    request.headers.get('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET
  );
  if (!event) return json({ error: 'Invalid signature' }, 400);
  const obj = event.data.object;

  if (event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded') {
    // For one-off payments, "completed" is not "paid": delayed methods (ACH
    // and friends, a dashboard setting, not a code one) complete the session
    // with payment_status 'unpaid' and settle later. Granting on completion
    // would hand out a case or a follow-up before the money moved, and a
    // later payment failure would leave the grant standing. Unpaid sessions
    // wait for async_payment_succeeded, which runs this same dispatch.
    // Subscriptions are invoice-driven and keep their own path.
    // (Post-2.2 audit, 2026-08-21.)
    if (obj.mode === 'subscription') {
      if (event.type === 'checkout.session.completed') await activateSubscription(env, obj);
    } else if (obj.payment_status && obj.payment_status !== 'paid') {
      // Not settled yet; the success event will come back through here.
    } else if (obj.metadata?.kind === 'tip') await confirmTip(env, obj);
    else if (obj.metadata?.kind === 'chatunlock') await confirmChatUnlock(env, obj);
    else if (obj.metadata?.kind === 'extra') await confirmExtraSession(env, obj);
    else if (obj.metadata?.kind === 'followup') await confirmFollowUpPurchase(env, obj);
    else await createCaseFromSession(env, obj);
  } else if (event.type === 'checkout.session.async_payment_failed') {
    // The money never arrived: give the slot back, exactly as an expiry does.
    await releaseHold(env, obj);
  } else if (event.type === 'checkout.session.expired') {
    await releaseHold(env, obj);
  } else if (
    event.type === 'customer.subscription.updated' ||
    event.type === 'customer.subscription.deleted'
  ) {
    await syncSubscription(env, obj);
  } else if (event.type === 'invoice.payment_failed') {
    await markSubscription(env, obj.customer, { status: 'past_due' });
  }
  return json({ received: true });
}

// ---- subscription lifecycle (SPEC: access runs to the end of the paid period) ----

async function activateSubscription(env, session) {
  const uid = session.metadata && session.metadata.uid;
  if (!uid) return;
  const now = new Date();
  const email = await resolveClientEmail(env, uid, session.metadata.email, session);
  await patchDoc(env, `subscriptions/${uid}`, {
    stripeCustomerId: session.customer || null,
    subscriptionId: session.subscription || null,
    status: 'active',
    email,
    termsAckAt: session.metadata.termsAckAt
      ? new Date(Number(session.metadata.termsAckAt))
      : now,
    startedAt: now,
    // Provisional; the customer.subscription.updated event corrects it.
    currentPeriodEnd: new Date(now.getTime() + 32 * 86_400_000),
  });
  await sendEmail(env, {
    to: email,
    subject: 'Your 24/7 Priority Chat is live',
    html: `<p>Your chat line to me is open. I reply when I'm available — response
      timing is never guaranteed, exactly as the terms you accepted say.</p>
      <p><a href="${env.PUBLIC_BASE_URL}/subscription.html">Open your chat</a></p>
      ${homeScreenTips(env.PUBLIC_BASE_URL)}`,
  });
}

/** Handles customer.subscription.updated / .deleted. */
async function syncSubscription(env, sub) {
  const uid = (sub.metadata && sub.metadata.uid) || (await uidForCustomer(env, sub.customer));
  if (!uid) return;
  const status = sub.status === 'canceled' ? 'canceled' : sub.status;
  const fields = { status };
  if (sub.current_period_end) fields.currentPeriodEnd = new Date(sub.current_period_end * 1000);
  await patchDoc(env, `subscriptions/${uid}`, fields, { mask: Object.keys(fields) });
  if (status === 'canceled') {
    const doc = await getDoc(env, `subscriptions/${uid}`);
    await sendEmail(env, {
      to: doc?.data.email,
      subject: 'Your 24/7 Priority Chat has ended',
      html: `<p>Your subscription is canceled. Chat access runs to the end of the period
        you already paid for, and your message history stays visible to you.</p>`,
    });
  }
}

async function markSubscription(env, customerId, fields) {
  const uid = await uidForCustomer(env, customerId);
  if (!uid) return;
  await patchDoc(env, `subscriptions/${uid}`, fields, { mask: Object.keys(fields) });
}

async function uidForCustomer(env, customerId) {
  if (!customerId) return null;
  const rows = await queryDocs(env, 'subscriptions', [
    ['stripeCustomerId', 'EQUAL', customerId],
  ], 1);
  return rows.length ? rows[0].id : null;
}

// ---- chat email digest (cron, every 15 min) ----
// Two different rhythms, by recipient (Eric, 2026-07-21):
//   • CLIENT-directed nudges (Eric wrote): at most ONE per day, sent at 6pm in
//     the client's own timezone, and only if they still haven't opened it. No
//     inbox spam during a back-and-forth — push is the instant channel.
//   • ADMIN-directed nudges (client wrote): removed 2026-08-20. Push is the
//     channel for those now, and it is his own inbox.
//
// What is NOT here, and should not be confused with it: the booking
// confirmation, the follow-up receipt, the case-closed note, both
// subscription emails, and the alert when a client asks for a time that is
// not on his calendar. Those are transactional and fire once.
// Never any message content in the email.
const CLIENT_DIGEST_HOUR = 18; // 6pm, client-local

function hourInTz(now, tz) {
  const zone = tz || 'Etc/GMT+7'; // default MST
  try {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  } catch {
    return Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Etc/GMT+7', hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  }
}

export async function runChatDigest(env, now = Date.now()) {
  for (const coll of ['cases', 'subscriptions']) {
    const rows = await queryDocs(env, coll, [['lastMessage.emailed', 'EQUAL', false]], 50);
    for (const row of rows) {
      const lm = row.data.lastMessage;
      if (!lm || !lm.ts) continue;
      if (now - new Date(lm.ts).getTime() < DIGEST_MIN_AGE_MS) continue;

      if (lm.role === 'admin') {
        // Client is the recipient — hold until 6pm their time, once a day.
        const tz = row.data.clientTz || (coll === 'subscriptions' ? row.data.tz : null);
        if (hourInTz(now, tz) !== CLIENT_DIGEST_HOUR) continue;
        const to = row.data.clientEmail || row.data.email;
        const link = coll === 'cases' ? '/case.html' : '/subscription.html';
        if (to) {
          await sendEmail(env, {
            to,
            subject: 'Something new is waiting in Pocket Advocate',
            html: `<p>There's a new message, document, or update waiting for you in the app.</p>
              <p><a href="${env.PUBLIC_BASE_URL}${link}">Open Pocket Advocate</a></p>
              <p style="color:#888; font-size:13px;">You'll only get this once a day, and only when there's something you haven't seen yet.</p>`,
          });
        }
      }
      // The other branch used to email Eric within 15 minutes of any client
      // message. It is gone (Eric, 2026-08-20: "stop sending my email updates
      // on unseen messages. We have push notifications working, this is
      // unnecessary"). Push already tells him, and it is his own inbox.
      //
      // The flag write below still runs for BOTH branches. Without it every
      // client-authored message would stay emailed:false forever and be
      // re-queried, fifty rows at a time, every quarter hour, for nothing.
      await patchDoc(env, `${coll}/${row.id}`, { lastMessage: { emailed: true } }, {
        mask: ['lastMessage.emailed'],
      });
    }
  }
}

/**
 * One-off: clear the `recap` field off every chat message that already has
 * one. Those fields hold model-written text on a document the client can read,
 * which is the whole reason the feature was pulled. Removing the code stops new
 * ones; this removes the ones already there.
 *
 * Self-terminating. It flags itself done in config/maintenance and after that
 * costs one document read per quarter hour, which is why it can live in the
 * cron instead of needing Eric to run anything. Safe to delete this function
 * and its call a release or two from now.
 *
 * Idempotent by construction: a message with no recap field is skipped, so a
 * run that hits the write cap simply finishes on the next tick.
 */
const PURGE_WRITE_CAP = 300;

export async function purgeRecaps(env) {
  try {
    const flag = await getDoc(env, 'config/maintenance');
    if (flag?.data.recapPurgeDone) return;

    let writes = 0;
    let complete = true;
    for (const coll of ['cases', 'subscriptions']) {
      // Both of these are paginated. They were not, and a page size of 300 was
      // being read as "all of them": past 300 cases, or 300 messages in one
      // thread, the sweep would step over the rest and then set the done flag,
      // which is the difference between cleaned up and believed cleaned up.
      const parents = await listDocs(env, coll, { pageSize: 300, all: true });
      for (const p of parents) {
        const msgs = await listDocs(env, `${coll}/${p.id}/chat`, { pageSize: 300, all: true });
        for (const m of msgs) {
          if (!m.data.recap) continue;
          if (writes >= PURGE_WRITE_CAP) { complete = false; break; }
          // An empty body with the field in the update mask is how Firestore
          // deletes a field rather than setting it to null.
          await patchDoc(env, `${coll}/${p.id}/chat/${m.id}`, {}, { mask: ['recap'] });
          writes++;
        }
        if (!complete) break;
      }
      if (!complete) break;
    }

    if (writes) console.log(`recap purge: cleared ${writes}`);
    if (complete) {
      await patchDoc(env, 'config/maintenance', {
        recapPurgeDone: true, recapPurgeAt: new Date(),
      }, { mask: ['recapPurgeDone', 'recapPurgeAt'] });
      console.log('recap purge: complete');
    }
  } catch (err) {
    // Never let a maintenance sweep take the cron down with it.
    console.error('recap purge failed:', err);
  }
}

/** The ONLY place a case is ever created. */
/**
 * The client's email address, from whichever source actually has it.
 * `users/{uid}.email` is authoritative — sign-in writes it on every code
 * verification — and it's the only one that survives the fact that
 * custom-token accounts carry no email claim, so `user.email` is always null.
 */
async function resolveClientEmail(env, uid, metadataEmail, session) {
  if (metadataEmail) return metadataEmail;
  if (uid) {
    const profile = await getDoc(env, `users/${uid}`);
    if (profile?.data.email) return profile.data.email;
  }
  return session?.customer_details?.email || session?.customer_email || null;
}

async function createCaseFromSession(env, session) {
  const m = session.metadata || {};
  if (!m.uid || (!m.slotId && !m.requestedStart)) return;

  // Idempotency: Stripe retries webhooks; don't create the case twice.
  const existing = await queryDocs(env, 'cases', [
    ['stripe.sessionId', 'EQUAL', session.id],
  ], 1);
  if (existing.length) return;

  const slot = m.slotId ? await getDoc(env, `availability/${m.slotId}`) : null;
  // Every way of learning this client's address, in order of trust. Getting
  // this wrong is expensive and silent: a case with no email sends no booking
  // confirmation and can never be emailed again, so the client pays and hears
  // nothing. `customer_email` is only ever what WE passed in — the address a
  // customer types at Stripe Checkout comes back on `customer_details`.
  const email = await resolveClientEmail(env, m.uid, m.email, session);
  const acks = safeJson(m.acks) || {};
  const now = new Date();
  const allFormsDone = REQUIRED_ACKS.every((f) => typeof acks[f] === 'number');
  const isRequest = !m.slotId && !!m.requestedStart;
  const start = isRequest ? new Date(m.requestedStart) : slot ? new Date(slot.data.start) : null;
  const caseId = crypto.randomUUID();

  // The rate as it stands at the moment this case is created. Read once and
  // used twice: written onto the case as what this client bought at, and, one
  // booking later, what the next client is quoted.
  const rateAtBooking = await readRates(env);

  const created = await patchDoc(
    env,
    `cases/${caseId}`,
    {
      clientUid: m.uid,
      clientEmail: email,
      clientName: m.name || null,
      clientDob: m.dob || null,
      clientTz: m.tz || null,
      status: allFormsDone ? 'confirmed' : 'forms',
      createdAt: now,
      appointment: {
        start,
        durationMin: slot ? slot.data.durationMin || 60 : 60,
        method: m.method,
        phone: m.phone || null,
        joinLink: null,
        // A time the client asked for, not one off the calendar. Nothing is
        // reserved until the admin confirms it.
        requested: isRequest,
      },
      // Always private — the election screen is gone. Field retained so
      // existing cases and the case page keep rendering.
      publicElection: { choice: 'private', history: [{ choice: 'private', at: now }] },
      // Nothing sold at checkout carries a follow-up any more; it is bought
      // later, from the case, and that purchase sets this flag.
      addOnFollowUp: false,
      forms: Object.fromEntries(
        REQUIRED_ACKS.map((f) => [f, typeof acks[f] === 'number' ? new Date(acks[f]) : null])
      ),
      files: [],
      reportDueAt: null, // set when the call ends (Phase 2)
      // The rate this client was sold at. A percentage charge later is a share
      // of THIS number, not of whatever the rate happens to be by then: a
      // client who paid $275 is not re-based onto a rate that moved after they
      // bought (Eric, "current client gets grandfathered in", 2026-08-20).
      caseRateCents: rateAtBooking.caseCents,
      // The follow-up price he was told at booking time. Eric: "The person who
      // books gets the add-on at the price they were originally told." Without
      // this, a client who booked at $265 would be quoted whatever the add-on
      // had drifted to by the time their report landed.
      addonRateCents: rateAtBooking.addonCents,
      stripe: {
        sessionId: session.id,
        paymentIntentId: session.payment_intent || null,
        amountTotal: session.amount_total || null,
      },
    },
    { mustNotExist: true }
  );

  // mustNotExist returns falsy when the document already existed, which is how
  // a replayed Stripe webhook shows up. Raising here and only here means a
  // replay cannot bump the rate a second time.
  if (created) await raiseRates(env).catch((err) => console.warn('rate raise:', err.message || err));

  if (isRequest && start) {
    const mt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Etc/GMT+7', weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(start);
    if (env.ADMIN_EMAIL) {
      await sendEmail(env, {
        to: env.ADMIN_EMAIL,
        subject: 'A client requested a time that is not on your calendar',
        html: `<p><strong>${escHtml(m.name || 'A client')}</strong> paid for a case and asked for:</p>
          <p><strong>${mt} MST</strong></p>
          <p>This time was not open on your calendar and nothing is reserved. Confirm it or
          offer another time from the case page.</p>
          <p><a href="${env.PUBLIC_BASE_URL}/admin-case.html?id=${caseId}">Review the request</a></p>`,
      });
    }
    for (const a of await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 5)) {
      await notifyUser(env, a.id, {
        title: 'Booking request',
        body: `${firstName(m.name) || 'A client'} requested ${mt} MST.`,
        link: `/admin-case.html?id=${caseId}`,
      });
    }
  }

  const clientEmail = email;
  if (clientEmail && start) {
    const mtFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Etc/GMT+7', weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    await sendEmail(env, {
      to: clientEmail,
      subject: 'Your Pocket Advocate case is open',
      html: `<p>Payment confirmed — your case file is live.</p>
        ${whenHtml(start, m.tz)}
        <p>Meeting method: ${m.method}.</p>
        <p>Upload labs, imaging, or records any time before the call.</p>
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>
        ${homeScreenTips(env.PUBLIC_BASE_URL)}`,
    });
  }

  if (slot) {
    // Book the slot for this case. If a stale hold raced us (extremely
    // unlikely: holds outlive their checkout sessions), flag it for Eric
    // rather than silently double-booking.
    const stillOurs =
      slot.data.heldBySession === session.id || slot.data.state !== 'booked';
    if (stillOurs) {
      await patchDoc(env, `availability/${m.slotId}`, {
        state: 'booked',
        caseId,
        holdExpiresAt: null,
        heldByUid: null,
        heldBySession: null,
      }, { mask: ['state', 'caseId', 'holdExpiresAt', 'heldByUid', 'heldBySession'] });
    } else {
      await patchDoc(env, `cases/${caseId}`, { needsReschedule: true }, {
        mask: ['needsReschedule'],
      });
    }
  }
}

/**
 * Identity gate (Eric, 2026-07-14): money can only move for a signed-in adult
 * with a real name on file. The browser collects it; this is the enforcement.
 */
async function requireAdultProfile(env, uid) {
  const profile = await getDoc(env, `users/${uid}`);
  const p = profile?.data || {};
  if (!p.firstName || !p.lastName || !p.dob)
    return { error: 'Complete your profile (name and date of birth) first.', code: 400 };
  const dob = new Date(`${p.dob}T00:00:00Z`);
  if (Number.isNaN(dob.getTime()))
    return { error: 'Your date of birth looks invalid — re-enter it.', code: 400 };
  const now = new Date();
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  if (age < 18)
    return { error: 'Pocket Advocate serves adults — a parent or guardian needs to reach out first.', code: 403 };
  // The profile email is the authoritative one: sign-in writes it on every
  // code verification. The Firebase user object has none — custom-token
  // accounts carry no email claim — so anything reading `user.email` gets null.
  return { name: `${p.firstName} ${p.lastName}`.slice(0, 120), dob: p.dob, email: p.email || null };
}

// ---- POST /api/notify ----
// Body: { kind: 'case'|'sub', id }. Called fire-and-forget after a chat send;
// pushes a content-free nudge to the *other* side of the thread. Titles and
// bodies never include message text — same privacy policy as the email digest.
/**
 * First name only, for notification bodies. Eric, 2026-08-22: "Whenever I
 * get a notification, please specify the first name of whoever did it."
 * Never the surname (a lock screen is a public place), never empty.
 */
function firstName(v) {
  const first = String(v || '').trim().split(/\s+/)[0] || '';
  // An email address is not a name; use the part before the @ instead of
  // printing a whole address on a lock screen.
  return first.includes('@') ? first.split('@')[0] : first;
}

async function handleNotify(request, env, ctx) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => null);
  const kind = body?.kind;
  const id = typeof body?.id === 'string' ? body.id : '';
  if ((kind !== 'case' && kind !== 'sub') || !id) return json({ error: 'Bad request' }, 400);

  const profile = await getDoc(env, `users/${user.uid}`);
  const isAdmin = profile?.data.role === 'admin';

  let clientUid; // the non-admin side of the thread
  let adminLink;
  let clientLink;
  let threadClientName = '';
  if (kind === 'case') {
    const doc = await getDoc(env, `cases/${id}`);
    if (!doc) return json({ error: 'Not found' }, 404);
    clientUid = doc.data.clientUid;
    threadClientName = doc.data.clientName || '';
    adminLink = `/admin-case.html?id=${id}`;
    clientLink = `/case.html?id=${id}`;
  } else {
    const sub = await getDoc(env, `subscriptions/${id}`);
    if (!sub) return json({ error: 'Not found' }, 404);
    clientUid = id;
    threadClientName = sub.data.name || sub.data.clientName || '';
    adminLink = `/admin-chats.html?sub=${id}`;
    clientLink = '/subscription.html';
  }

  if (user.uid === clientUid) {
    // Client wrote — nudge every admin device, and let the advisor re-read the
    // case so Eric's panel is current before he even opens it.
    refreshAdvisor(env, ctx, kind, id);
    // The 💬 on the folder, and the dot on the Chat tab, both come from this.
    // It goes on BOTH docs deliberately: the shelf reads caseMeta for every
    // case in one call, and the open case reads its own advisor state on a
    // poll, so neither surface needs an extra request to know a client wrote.
    // Only this branch stamps it. refreshAdvisor runs for Eric's messages too,
    // and a badge that lights on his own writing is a badge he learns to
    // ignore.
    ctx.waitUntil((async () => {
      const now = new Date();
      const parent = kind === 'case' ? 'cases' : 'subscriptions';
      await patchDoc(env, `${parent}/${id}/advisor/state`, { clientMsgAt: now },
        { mask: ['clientMsgAt'] }).catch(() => {});
      if (kind === 'case')
        await patchDoc(env, `caseMeta/${id}`, { clientMsgAt: now },
          { mask: ['clientMsgAt'] }).catch(() => {});
    })());
    // Named, not "a client": with several open threads the name IS the
    // information. The sender is the caller, so their own profile name wins,
    // then whatever the thread knows them as.
    const senderName = firstName(profile?.data.name)
      || firstName(threadClientName)
      || 'A client';
    const admins = await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 5);
    for (const a of admins) {
      await notifyUser(env, a.id, {
        title: 'Pocket Advocate',
        body: `${senderName} sent you a message.`,
        link: adminLink,
      });
    }
  } else if (isAdmin) {
    // Eric wrote — the advisor should fold his side in too, so its read stays
    // current through the whole exchange, not just the client's half.
    refreshAdvisor(env, ctx, kind, id);
    await notifyUser(env, clientUid, {
      title: 'Pocket Advocate',
      body: `${firstName(profile?.data.name) || 'Your advocate'} sent you a message.`,
      link: clientLink,
    });
  } else {
    return json({ error: 'Not your thread' }, 403);
  }
  return json({ ok: true });
}

// ---- POST /api/admin/pin ----
/**
 * Status reactions I can put on a client's message.
 *
 * The point is that nobody sits there wondering whether they've been left on
 * read. `label` is what shows on the message; `push` is the notification,
 * deliberately different for each one so the phone says something specific
 * rather than a generic "new activity". Neither ever quotes message content.
 *
 * Keep in sync with STATUS_REACTIONS in public/js/msg-actions.js.
 */
/**
 * What he can tell a client he is doing. Admin only, one per message.
 *
 * The label IS the notification. There used to be a second, slightly different
 * wording for the push - "labs and chart notes" against "labs / chart notes" -
 * and two strings meaning one thing is two strings that drift. The sheet he
 * picks from promises "they get a notification saying exactly this", so it
 * says exactly this.
 *
 * Keep in sync with STATUS_REACTIONS in public/js/msg-actions.js.
 */
const CHAT_REACTIONS = {
  seen: { label: 'Eric has seen your message' },
  reading: { label: 'Eric is reading…' },
  research: { label: 'Eric is doing research…' },
  thinking: { label: 'Eric is thinking about your situation…' },
  history: { label: 'Eric is reviewing your history…' },
  labs: { label: 'Eric is reviewing your labs / chart notes' },
};

/**
 * The ordinary emoji anyone can use, either direction. Clients get these and
 * only these — the status reactions above are mine to give, and a client
 * announcing "Eric is reviewing your labs" would be nonsense at best.
 *
 * Keep in sync with EMOJI_REACTIONS in public/js/msg-actions.js.
 */
const EMOJI_REACTIONS = {
  love: '❤️',
  haha: '😆',
  wow: '😮',
  sad: '😢',
  angry: '😡',
  like: '👍',
};

/**
 * A run with no heartbeat for this long is dead and may be replaced. The panel
 * uses the same number to decide when to say "stalled" (public/js/advisor.js),
 * and the two MUST agree: a window where the screen says dead and the Worker
 * says alive is a button that does nothing.
 */
const ADVISOR_ALIVE_MS = 120_000;

/** How long a message stays editable by its author. */
const EDIT_WINDOW_MS = 3 * 60 * 1000;

/**
 * Resolve a chat thread and check the caller belongs in it. Returns
 * { clientUid, link, path, isAdmin } or { error, code }.
 */
/**
 * Membership in a thread, without naming a message. chatContext is this plus a
 * message id; splitting it out lets a route that operates on the whole thread
 * ask the same question. The contract of chatContext itself is unchanged, and
 * has to stay that way: react, pass and edit all depend on it byte for byte.
 */
async function threadContext(env, user, kind, id) {
  if ((kind !== 'case' && kind !== 'sub') || !/^[\w-]{1,64}$/.test(id))
    return { error: 'Bad request', code: 400 };

  const profile = await getDoc(env, `users/${user.uid}`);
  const isAdmin = profile?.data.role === 'admin';

  let clientUid;
  let link;
  if (kind === 'case') {
    const doc = await getDoc(env, `cases/${id}`);
    if (!doc) return { error: 'Not found', code: 404 };
    clientUid = doc.data.clientUid;
    link = `/case.html?id=${id}`;
  } else {
    const sub = await getDoc(env, `subscriptions/${id}`);
    if (!sub) return { error: 'Not found', code: 404 };
    clientUid = id;
    link = '/subscription.html';
  }
  // Membership, not merely authentication: being signed in is not permission
  // to touch a stranger's thread.
  if (!isAdmin && user.uid !== clientUid) return { error: 'Not your thread', code: 403 };

  return { clientUid, link, isAdmin, parent: kind === 'case' ? 'cases' : 'subscriptions' };
}

async function chatContext(env, user, kind, id, msgId) {
  if ((kind !== 'case' && kind !== 'sub') || !/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(msgId))
    return { error: 'Bad request', code: 400 };

  const profile = await getDoc(env, `users/${user.uid}`);
  const isAdmin = profile?.data.role === 'admin';

  let clientUid;
  let link;
  if (kind === 'case') {
    const doc = await getDoc(env, `cases/${id}`);
    if (!doc) return { error: 'Not found', code: 404 };
    clientUid = doc.data.clientUid;
    link = `/case.html?id=${id}`;
  } else {
    const sub = await getDoc(env, `subscriptions/${id}`);
    if (!sub) return { error: 'Not found', code: 404 };
    clientUid = id;
    link = '/subscription.html';
  }
  // Membership, not merely authentication: being signed in is not permission
  // to touch a stranger's thread.
  if (!isAdmin && user.uid !== clientUid) return { error: 'Not your thread', code: 403 };

  return {
    clientUid, link, isAdmin,
    callerName: firstName(profile?.data.name) || '',
    path: `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/chat/${msgId}`,
  };
}

/**
 * POST /api/chat/react  Body: { kind: 'case'|'sub', id, msgId, reaction|null }
 *
 * Chat messages are immutable to the browser (firestore.rules: `allow update:
 * if false`), so reactions are written here with the service account — which
 * also puts the notification on a path a client can't skip.
 *
 * Both sides may react, but not with the same vocabulary: clients are limited
 * to the plain emoji, while the "Eric is reading…" statuses are admin-only.
 * Nobody reacts to their own message.
 */
async function handleChatReact(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const body = await request.json().catch(() => null);
  const ctx = await chatContext(env, user, body?.kind, String(body?.id || ''), String(body?.msgId || ''));
  if (ctx.error) return json({ error: ctx.error }, ctx.code);

  const reaction = body?.reaction ?? null;
  const isEmoji = reaction !== null && Object.hasOwn(EMOJI_REACTIONS, reaction);
  const isStatus = reaction !== null && Object.hasOwn(CHAT_REACTIONS, reaction);
  if (reaction !== null && !isEmoji && !isStatus)
    return json({ error: 'Unknown reaction' }, 400);
  if (isStatus && !ctx.isAdmin)
    return json({ error: 'That reaction is not available.' }, 403);

  const msg = await getDoc(env, ctx.path);
  if (!msg) return json({ error: 'No such message' }, 404);
  if (msg.data.from === user.uid)
    return json({ error: 'You can only react to the other person\'s messages.' }, 403);

  if (!reaction) {
    // Eric, 2026-08-21: "Remove reaction isn't working for chat."
    //
    // Two faults here, and the second is what made it invisible.
    //
    // It wrote an explicit null rather than removing the field. A document
    // then carries `reaction: null`, which every reader has to remember to
    // treat as absent. Passing undefined leaves the field out of the body
    // while the mask still names it, which is how Firestore is told to DELETE
    // a field - the reaction stops existing rather than existing as nothing.
    //
    // And it announced ok:true without ever looking at whether the write
    // happened. patchDoc returns false on a failed precondition instead of
    // throwing, so a clear that did nothing at all still answered "done", the
    // browser had nothing to alert about, and the chip stayed exactly where it
    // was. Now a failed clear says so and the client's error path fires.
    const cleared = await patchDoc(env, ctx.path, { reaction: undefined }, { mask: ['reaction'] });
    if (!cleared) return json({ error: 'Could not remove that reaction. Try again.' }, 409);
    return json({ ok: true, reaction: null });
  }

  const already = msg.data.reaction?.id === reaction;
  const record = isEmoji
    ? { id: reaction, emoji: EMOJI_REACTIONS[reaction], kind: 'emoji', by: user.uid, at: new Date() }
    : { id: reaction, label: CHAT_REACTIONS[reaction].label, kind: 'status', by: user.uid, at: new Date() };
  const wrote = await patchDoc(env, ctx.path, { reaction: record }, { mask: ['reaction'] });
  if (!wrote) return json({ error: 'Could not set that reaction. Try again.' }, 409);

  // Re-applying the same reaction is not news — their phone already said it.
  // Changing it is, so that one notifies. Notify whoever wrote the message.
  const target = msg.data.from;
  // A client gets told what Eric is DOING, and nothing else. An emoji on their
  // message is a small kindness on a screen, not a thing worth buzzing a
  // phone for (Eric, 2026-08-21: "send clients a notification of my reactions.
  // Not emojis"). His own phone still gets theirs: he asked to keep push.
  const toClient = target === ctx.clientUid;
  const worthSending = isEmoji ? !toClient : true;
  if (!already && target && target !== user.uid && worthSending) {
    // The exact words of the reaction, not a paraphrase of them. The sheet he
    // picks from promises "they get a notification saying exactly this", and
    // a second wording drifting alongside the first is how that stops being
    // true without anyone noticing.
    const push = isEmoji
      ? `${ctx.callerName || (ctx.isAdmin ? 'Eric' : 'Your client')} reacted ${EMOJI_REACTIONS[reaction]} to your message.`
      : CHAT_REACTIONS[reaction].label;
    await notifyUser(env, target, { title: 'Pocket Advocate', body: push, link: ctx.link });
  }
  return json({ ok: true, reaction, notified: !already && worthSending });
}

/**
 * POST /api/uploaded  Body: { kind: 'case'|'sub', id }
 *
 * "A file just landed." Sent by the Documents page, which uploads straight to
 * Storage and otherwise leaves no trace anywhere the Worker can see. No file
 * details are taken from the caller: the advisor lists the bucket itself, so
 * this is only a nudge to look, and the worst a bad caller can do is ask for a
 * read of a case they are already a party to.
 */
async function handleUploaded(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => null);
  const kind = body?.kind === 'sub' ? 'sub' : 'case';
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'Bad id' }, 400);

  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const doc = await getDoc(env, `${parent}/${id}`);
  if (!doc) return json({ error: 'Not found' }, 404);
  const clientUid = kind === 'case' ? doc.data.clientUid : id;
  const profile = await getDoc(env, `users/${user.uid}`);
  const isAdmin = profile?.data.role === 'admin';
  if (!isAdmin && user.uid !== clientUid) return json({ error: 'Not your case' }, 403);

  await markPending(env, kind, id);

  // Tell him what landed and what they called it. He asked for the name in the
  // notification, and the name is now their own description of the thing
  // rather than IMG_4127, which is the entire reason for asking.
  //
  // Client uploads only: his own file landing on his own case is not news.
  if (!isAdmin) {
    const names = Array.isArray(body?.names)
      ? body.names.filter((n) => typeof n === 'string').map((n) => n.slice(0, 80)).slice(0, 10)
      : [];
    const who = firstName((kind === 'case' ? doc.data.clientName : doc.data.name)
      || doc.data.clientEmail || doc.data.email) || 'A client';
    const what = names.length === 1
      ? names[0]
      : names.length > 1
        ? `${names.length} files: ${names.join(', ').slice(0, 120)}`
        : 'a file';
    const link = kind === 'case' ? `/admin-case.html?id=${id}` : `/admin-chats.html?id=${id}`;
    const admins = await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 5);
    for (const a of admins) {
      await notifyUser(env, a.id, {
        title: 'Pocket Advocate',
        body: `${who} uploaded ${what}`,
        link,
      }).catch(() => { /* the file is up either way */ });
    }
  }
  return json({ ok: true });
}

/**
 * POST /api/summary  Body: { kind, id, day: 'YYYY-MM-DD' }
 *
 * One day of a thread, read back to him. ADMIN ONLY, and deliberately so:
 * Eric asked for this on his side after taking it off the client's, and a
 * client is never to be handed anything generated for them.
 *
 * Once per day per case is enforced here rather than by a disabled button.
 * The day is cached on first generation and served from cache after, so the
 * limit is a property of the data rather than of the UI.
 */
async function handleDaySummary(request, env) {
  const admin = await requireAdmin(request, env);
  // 404 for the same reason the advisor routes give one: a status code that
  // differs from an unknown route confirms the route is there.
  if (!admin) return json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => null);
  const kind = body?.kind === 'sub' ? 'sub' : 'case';
  const id = String(body?.id || '');
  const day = String(body?.day || '');
  if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'Bad id' }, 400);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return json({ error: 'Bad day' }, 400);
  // A day that has not happened has nothing in it.
  if (new Date(`${day}T00:00:00Z`).getTime() > Date.now() + 86_400_000)
    return json({ error: 'That day has not happened yet.' }, 400);

  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const doc = await getDoc(env, `${parent}/${id}`);
  if (!doc) return json({ error: 'Not found' }, 404);

  // Awaited rather than run through keepaliveRun: that helper reports only
  // ok/failed, and the whole point here is the text it produces. One day of
  // one thread at low effort is a short call, and he pressed a button and is
  // waiting for an answer.
  try {
    const out = await runDaySummary(env, kind, id, day);
    if (out.empty) return json({ error: 'Nothing was said that day.' }, 404);
    return json(out);
  } catch (err) {
    console.error('day summary:', err.stack || err);
    // The REAL reason, because this route is requireAdmin-gated: only Eric's
    // panel ever sees it. Every other advisor path already reports raw
    // (keepaliveRun {raw:true}); this was the one place that hid the cause
    // behind a shrug, which left him guessing about API keys from his phone.
    // (Eric, 2026-08-21: "Same error. Send an agent to run diagnostics.")
    // The status from the provider rides along when there is one - a 401
    // means the key, a 529 means Anthropic is overloaded, and the two need
    // opposite responses.
    const detail = [err.status, err.message || String(err)].filter(Boolean).join(': ');
    return json({ error: `Day summary failed - ${detail}` }, 502);
  }
}

/**
 * /api/saved — messages either side has bookmarked, with a note.
 *
 *   GET  ?kind=case&id=…            list mine on this thread
 *   POST { kind, id, msgId, note }  save one, or update its note
 *   POST { kind, id, msgId, delete: true }
 *
 * Stored at {parent}/{id}/private/saved/{savedUid}/{msgId} — six path segments
 * so it resolves to a document, five for the list, structurally identical to
 * the advisor/state/qa/{id} shape that already works, and NOT the odd-segment
 * shape that has bitten this codebase before.
 *
 * Under private/ because that subtree is denied to the browser in both cases
 * and subscriptions, and falls through to deny-all if the live rules have not
 * caught up. Denied either way, which is the only safe assumption when rules
 * cannot be deployed from here.
 *
 * The saver's uid is a PATH SEGMENT, not a field, so one person's bookmarks
 * are structurally unreachable from the other's rather than filtered out by
 * code that could be got wrong later. {msgId} as the document id gives free
 * dedupe: saving the same message twice is one row.
 *
 * The two invariants: nothing is written to the shared chat message document,
 * and notifyUser is never called from here. React and pass do both, and
 * either one would tell the other person they had been bookmarked.
 */
const SAVED_NOTE_MAX = 2000;

async function handleSaved(request, env, url) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  const kind = (body?.kind || url.searchParams.get('kind')) === 'sub' ? 'sub' : 'case';
  const id = String(body?.id || url.searchParams.get('id') || '');
  const ctx = await threadContext(env, user, kind, id);
  if (ctx.error) return json({ error: ctx.error }, ctx.code);

  const mine = `${ctx.parent}/${id}/private/saved/${user.uid}`;

  if (request.method === 'GET') {
    const rows = await listDocs(env, mine, { pageSize: 200 }).catch(() => []);
    return json({
      saved: rows
        .map((r) => ({ msgId: r.id, ...r.data }))
        .sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0)),
    });
  }
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);

  const msgId = String(body?.msgId || '');
  if (!/^[\w-]{1,64}$/.test(msgId)) return json({ error: 'Bad message' }, 400);
  const path = `${mine}/${msgId}`;

  if (body?.delete) {
    await deleteDoc(env, path);
    return json({ ok: true, removed: msgId });
  }

  // The snapshot is read from the message with the service account. Taking it
  // from the request body would let a caller store words the other person
  // never wrote, under their name, on a page that looks like a record.
  const msg = await getDoc(env, `${ctx.parent}/${id}/chat/${msgId}`);
  if (!msg) return json({ error: 'No such message' }, 404);
  const note = typeof body?.note === 'string' ? body.note.slice(0, SAVED_NOTE_MAX) : '';

  const existing = await getDoc(env, path).catch(() => null);
  await patchDoc(env, path, {
    text: String(msg.data.text || '').slice(0, 2000),
    role: msg.data.role === 'admin' ? 'admin' : 'client',
    attachmentName: msg.data.attachment?.name || null,
    sentAt: msg.data.ts || null,
    note,
    // Saving it again keeps the moment it was first saved.
    savedAt: existing?.data.savedAt ? new Date(existing.data.savedAt) : new Date(),
    updatedAt: new Date(),
  });
  return json({ ok: true, msgId });
}

/**
 * The next-call agenda. The lanes on the client composer route anything that
 * is not intake, logistics, or urgent into this list instead of the thread:
 * captured and visible to both sides, then dealt with together on a call
 * instead of piecemeal in chat. (Eric, 2026-08-21: "The chat is swallowing
 * my time to the point I make next to nothing.")
 *
 * GET  /api/agenda?id=…                               both sides
 * POST /api/agenda {id, action:'add', text}           both sides
 * POST /api/agenda {id, action:'done', itemId, done}  admin only
 * POST /api/agenda {id, action:'remove', itemId}      admin, or author while open
 * POST /api/agenda {id, action:'clear'}               admin: drop covered items
 */
async function handleAgenda(request, env, url) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);
  const body = request.method === 'POST' ? await request.json().catch(() => null) : null;
  const id = String(body?.id || url.searchParams.get('id') || '');
  const ctx = await threadContext(env, user, 'case', id);
  if (ctx.error) return json({ error: ctx.error }, ctx.code);
  const coll = `cases/${id}/agenda`;

  if (request.method === 'GET') {
    // No orderBy: it silently drops docs missing the field. Sort here.
    const rows = await listDocs(env, coll, { pageSize: 200 }).catch(() => []);
    return json({
      items: rows
        .map((r) => ({ id: r.id, ...r.data }))
        .sort((a, b) => new Date(a.at || 0) - new Date(b.at || 0)),
    });
  }
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  const action = body?.action;

  if (action === 'add') {
    const c = await getDoc(env, `cases/${id}`);
    if (c?.data.status === 'closed') return json({ error: 'This case is closed.' }, 409);
    const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : '';
    if (!text) return json({ error: 'Write the item first.' }, 400);
    const itemId = crypto.randomUUID();
    const item = {
      text, by: user.uid, role: ctx.isAdmin ? 'admin' : 'client',
      at: new Date(), done: false, doneAt: null,
    };
    await patchDoc(env, `${coll}/${itemId}`, item);
    return json({ ok: true, item: { id: itemId, ...item } });
  }

  if (action === 'done' || action === 'remove') {
    const itemId = String(body?.itemId || '');
    if (!/^[\w-]{1,64}$/.test(itemId)) return json({ error: 'Bad item' }, 400);
    if (action === 'done') {
      if (!ctx.isAdmin) return json({ error: 'Not found' }, 404);
      // Look before patching: patchDoc with a mask CREATES a missing doc, so
      // checking off an item the client removed a moment earlier resurrected
      // it as a text-less stub both pages painted as "✓ undefined".
      const row = await getDoc(env, `${coll}/${itemId}`);
      if (!row) return json({ ok: true, removed: true });
      const done = body?.done !== false;
      await patchDoc(env, `${coll}/${itemId}`,
        { done, doneAt: done ? new Date() : null }, { mask: ['done', 'doneAt'] });
      return json({ ok: true });
    }
    const row = await getDoc(env, `${coll}/${itemId}`);
    if (!row) return json({ ok: true });
    // A client can take back their own item while it is still open; a
    // covered item is part of the call record and stays.
    if (!ctx.isAdmin && (row.data.by !== user.uid || row.data.done))
      return json({ error: 'Not yours to remove' }, 403);
    await deleteDoc(env, `${coll}/${itemId}`);
    return json({ ok: true });
  }

  if (action === 'clear') {
    if (!ctx.isAdmin) return json({ error: 'Not found' }, 404);
    const rows = await listDocs(env, coll, { pageSize: 200 }).catch(() => []);
    for (const r of rows) {
      if (r.data.done) await deleteDoc(env, `${coll}/${r.id}`).catch(() => {});
    }
    return json({ ok: true });
  }
  return json({ error: 'Unknown action' }, 400);
}

/**
 * POST /api/file/delete  Body: { kind: 'case'|'sub', id, path }
 *
 * Deleting an uploaded file, with the authority rules Eric set (2026-08-22):
 * "I should also be able to long press and delete any uploaded files. They
 * should too, so long as they themselves uploaded it. I get authority on
 * both." So: the admin deletes anything under the thread; a client deletes
 * their own dropzone uploads and their own saved shelf freely, a chat file
 * only when a chat message of THEIRS carries it (authorship proven from the
 * thread, not claimed by the caller), and never the report or the recording.
 */
async function handleFileDelete(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => null);
  const kind = body?.kind === 'sub' ? 'sub' : 'case';
  const id = String(body?.id || '');
  const ctx = await threadContext(env, user, kind, id);
  if (ctx.error) return json({ error: ctx.error }, ctx.code);
  const path = String(body?.path || '');
  if (!path || path.length > 1024 || path.includes('..'))
    return json({ error: 'Bad path' }, 400);

  const base = `${ctx.parent}/${id}/`;
  const inThread = ['uploads/', 'chat-files/', 'report/', 'recording/']
    .some((f) => path.startsWith(base + f));
  const ownShelf = path.startsWith(`profiles/${user.uid}/saved/`);
  const clientShelf = path.startsWith(`profiles/${ctx.clientUid}/saved/`);

  if (ctx.isAdmin) {
    if (!inThread && !clientShelf) return json({ error: 'Bad path' }, 400);
  } else {
    if (!inThread && !ownShelf) return json({ error: 'Bad path' }, 400);
    if (path.startsWith(`${base}report/`) || path.startsWith(`${base}recording/`))
      return json({ error: 'That file is part of your case record.' }, 403);
    if (path.startsWith(`${base}chat-files/`)) {
      const rows = await listDocs(env, `${base}chat`, { pageSize: 200, all: true }).catch(() => []);
      const theirs = rows.some((r) =>
        r.data.from === user.uid && r.data.attachment?.path === path);
      if (!theirs) return json({ error: 'Only files you shared yourself can be removed.' }, 403);
    }
  }

  await deleteFile(env, path);
  return json({ ok: true });
}

/**
 * GET /api/admin/ledger
 *
 * The running tally behind the admin hamburger: what each client has paid,
 * and what they have tipped, summed from the cases (the booking itself plus
 * every extraPayments row). Subscriptions bill monthly in Stripe and are not
 * mirrored per-payment into Firestore, so they are not counted here; the
 * Stripe dashboard stays the truth for those.
 */
async function handleLedger(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Not found' }, 404);
  const rows = await listDocs(env, 'cases', { pageSize: 300, all: true }).catch(() => []);
  const byClient = new Map();
  for (const r of rows) {
    const c = r.data;
    const key = c.clientUid || r.id;
    if (!byClient.has(key)) {
      byClient.set(key, {
        name: c.clientName || c.clientEmail || 'Unknown client',
        paidCents: 0, tipCents: 0, cases: 0,
      });
    }
    const g = byClient.get(key);
    g.cases += 1;
    g.paidCents += Number(c.payment?.amountTotal) || Number(c.stripe?.amountTotal)
      || Number(c.caseRateCents) || 0;
    for (const p of (Array.isArray(c.extraPayments) ? c.extraPayments : [])) {
      const cents = Number(p?.amountCents) || 0;
      if (p?.kind === 'tip') g.tipCents += cents;
      else g.paidCents += cents;
    }
  }
  const clients = [...byClient.values()]
    .sort((a, b) => (b.paidCents + b.tipCents) - (a.paidCents + a.tipCents));
  return json({
    clients,
    totals: {
      paidCents: clients.reduce((s, c) => s + c.paidCents, 0),
      tipCents: clients.reduce((s, c) => s + c.tipCents, 0),
    },
  });
}

/**
 * Eric's per-client chat-hours meter. Admin-only by route, and admin-only by
 * storage: totals land on caseMeta, which no client-served path reads, so a
 * client can never see what their chat costs. The admin chat page beats every
 * 30 seconds while open and visible; seconds:0 just reads the total back.
 */
async function handleChatTime(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => null);
  const id = String(body?.id || '');
  if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'Bad id' }, 400);
  const seconds = Math.max(0, Math.min(120, Number(body?.seconds) || 0));
  // Locked increment: chat open on the phone and the desktop at once meant
  // two read-modify-writes racing, and the loser's 30 seconds vanished from
  // the one number this meter exists to keep honest.
  let total = 0;
  for (let attempt = 0; attempt < 3; attempt++) {
    const meta = await getDoc(env, `caseMeta/${id}`).catch(() => null);
    total = Math.max(0, Number(meta?.data.chatSeconds) || 0) + seconds;
    if (!seconds) break;
    const ok = meta
      ? await patchDoc(env, `caseMeta/${id}`, { chatSeconds: total, chatSecondsAt: new Date() },
        { mask: ['chatSeconds', 'chatSecondsAt'], ifUpdateTime: meta.updateTime })
      : await patchDoc(env, `caseMeta/${id}`, { chatSeconds: total, chatSecondsAt: new Date() },
        { mask: ['chatSeconds', 'chatSecondsAt'] });
    if (ok !== false) break;
  }
  return json({ total });
}

/**
 * POST /api/chat/pass  Body: { kind: 'case'|'sub', id, msgId, pass: bool }
 *
 * Passing on a question. A CLIENT can flag a message of Eric's as PASS: "not
 * answering that one, please don't ask why." The mark is visible to both, he
 * gets one quiet notification, and nobody owes anybody an explanation. Only
 * whoever set the flag can take it back, which is why an admin can still
 * unset one he made before this became client-only (Eric, 2026-08-20: "I can't
 * pass on messages. Only they should be able to"). Worker-written for
 * the same reason as reactions and edits: chat messages are browser-immutable
 * by rule.
 */
async function handleChatPass(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const body = await request.json().catch(() => null);
  const ctx = await chatContext(env, user, body?.kind, String(body?.id || ''), String(body?.msgId || ''));
  if (ctx.error) return json({ error: ctx.error }, ctx.code);

  const msg = await getDoc(env, ctx.path);
  if (!msg) return json({ error: 'No such message' }, 404);

  if (body?.pass) {
    if (msg.data.from === user.uid)
      return json({ error: "You can only pass on the other person's message." }, 403);
    // The UI stopped offering this to him; the route refuses it too, so the
    // rule holds against anything that talks to the API directly. Taking a
    // pass BACK is still his, for anything he set before this shipped.
    if (ctx.isAdmin)
      return json({ error: 'Passing is the client\'s to do.' }, 403);
    const already = !!msg.data.pass;
    await patchDoc(env, ctx.path, { pass: { by: user.uid, at: new Date() } }, { mask: ['pass'] });
    const author = msg.data.from;
    if (!already && author && author !== user.uid) {
      const kind = body.kind === 'sub' ? 'sub' : 'case';
      const id = String(body.id);
      // Send the asker back to the right side of the thread.
      const authorIsAdmin = msg.data.role === 'admin';
      const link = authorIsAdmin
        ? (kind === 'case' ? `/admin-case.html?id=${id}` : '/admin-chats.html')
        : ctx.link;
      await notifyUser(env, author, {
        title: 'Pocket Advocate',
        body: `${ctx.callerName || (ctx.isAdmin ? 'Eric' : 'Your client')} passed on your question. Moving on.`,
        link,
      });
    }
    return json({ ok: true, pass: true });
  }

  if (msg.data.pass?.by !== user.uid)
    return json({ error: 'Only whoever passed can take it back.' }, 403);
  await patchDoc(env, ctx.path, { pass: null }, { mask: ['pass'] });
  return json({ ok: true, pass: false });
}

/**
 * POST /api/chat/edit  Body: { kind: 'case'|'sub', id, msgId, text }
 * Your own message, within three minutes of sending it. Same reason this is
 * server-side as reactions: messages are browser-immutable by rule, and the
 * clock has to be one nobody can set. One exception to the clock: the admin
 * editing his OWN messages has no window, so an advisor-flagged factual slip
 * can be fixed days later. Client rules are unchanged.
 */
async function handleChatEdit(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);

  const body = await request.json().catch(() => null);
  const ctx = await chatContext(env, user, body?.kind, String(body?.id || ''), String(body?.msgId || ''));
  if (ctx.error) return json({ error: ctx.error }, ctx.code);

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 2000) return json({ error: 'Message must be 1–2000 characters.' }, 400);

  const msg = await getDoc(env, ctx.path);
  if (!msg) return json({ error: 'No such message' }, 404);
  if (msg.data.from !== user.uid) return json({ error: 'That is not your message.' }, 403);
  // An attachment-only message has nothing to edit; editing the caption of one
  // that also has text is fine.
  if (!msg.data.text) return json({ error: 'That message has no text to edit.' }, 400);

  const sent = new Date(msg.data.ts || 0).getTime();
  const adminOwn = ctx.isAdmin && msg.data.role === 'admin';
  if (!adminOwn && (!sent || Date.now() - sent > EDIT_WINDOW_MS))
    return json({ error: 'Messages can only be edited for 3 minutes after sending.' }, 409);

  const previous = msg.data.text;
  await patchDoc(env, ctx.path, { text, editedAt: new Date() }, { mask: ['text', 'editedAt'] });

  // Keep the admin inbox and the email digest honest: if this was still the
  // newest message in the thread, its preview is now wrong.
  const parentPath = ctx.path.replace(/\/chat\/[^/]+$/, '');
  const parent = await getDoc(env, parentPath);
  const last = parent?.data.lastMessage;
  if (last && last.from === user.uid && last.text === previous.slice(0, 120)) {
    await patchDoc(env, parentPath, {
      lastMessage: {
        ...last,
        text: text.slice(0, 120),
        // Reading decodes timestamps to ISO strings; handing one straight back
        // would silently retype the field from timestamp to string.
        ts: last.ts ? new Date(last.ts) : new Date(),
      },
    }, { mask: ['lastMessage'] });
  }

  return json({ ok: true, text });
}

/**
 * Run long model work while holding the HTTP connection open. Workers kill
 * background work ~30 seconds after the response completes — learned live: a
 * ten-minute Opus analysis started via ctx.waitUntil died silently every time,
 * leaving status stuck on "running" — but an open connection has no wall-clock
 * limit. So the response streams one byte of whitespace every 10 seconds until
 * the work lands, then closes with JSON. Whitespace is legal JSON padding, so
 * the panel's res.json() parses the whole body unchanged.
 */
function keepaliveRun(ctx, work, { raw = false } = {}) {
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  ctx.waitUntil((async () => {
    const tick = setInterval(() => { writer.write(enc.encode(' ')).catch(() => {}); }, 10_000);
    let body = '{"ok":true}';
    try {
      await work;
    } catch (err) {
      // The message can name an API key, a billing state or a provider. That
      // is fine for Eric's own panel and is a leak anywhere else, so callers
      // ask for it by name and the default says nothing.
      console.error('keepaliveRun failed:', err);
      body = JSON.stringify({
        ok: false,
        error: raw ? String(err.message || err) : 'That did not go through. Try again.',
      });
    }
    clearInterval(tick);
    try {
      await writer.write(enc.encode('\n' + body));
      await writer.close();
    } catch { /* client gone — the cron queue covers an interrupted analysis */ }
  })());
  return new Response(readable, { headers: { 'content-type': 'application/json' } });
}

/**
 * GET /api/advisor/state?kind=case&id=…
 *
 * The panel reads its state through here rather than straight from Firestore.
 * Firestore rules ship by CLI, which this project's owner has no way to run, so
 * a browser read of the advisor subtree fails until rules are next published —
 * and the advisor would look broken through no fault of its own. Reading via
 * the Worker also means the admin check lives in one place. (The rules in
 * firestore.rules still lock the subtree down for whenever they are published;
 * until then default-deny already keeps clients out of it entirely.)
 */
async function handleAdvisorState(request, env, url) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Not found' }, 404);
  // The uid check first, because it needs no round trip. A caller who is not
  // him is refused in the same time an unknown route takes, instead of being
  // told, by the clock, that this route does real work before it refuses.
  if (env.ADMIN_UID && user.uid !== env.ADMIN_UID) return json({ error: 'Not found' }, 404);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Not found' }, 404);

  const kind = url.searchParams.get('kind') === 'sub' ? 'sub' : 'case';
  const id = url.searchParams.get('id') || '';
  if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'Bad id' }, 400);

  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  // One round of reads for the whole panel. Every one of them degrades to
  // empty: a case with no advisor state, no notes and no glossary is the
  // normal first-visit state, not an error.
  const [state, qa, knowledge, notesDoc, style] = await Promise.all([
    getDoc(env, `${parent}/${id}/advisor/state`).catch(() => null),
    // Newest first. Ascending returned the twenty OLDEST, so past twenty
    // questions on one thread a new answer was never in the page: the panel
    // kept showing "thinking..." while the real answer sat in Firestore.
    listDocs(env, `${parent}/${id}/advisor/state/qa`, { pageSize: 20, orderBy: 'at desc' }).catch(() => []),
    listDocs(env, 'advisorKnowledge', { pageSize: 200 }).catch(() => []),
    getDoc(env, `${parent}/${id}/private/notes`).catch(() => null),
    getDoc(env, 'advisorStyle/profile').catch(() => null),
  ]);
  // keyConfigured: admin-only visibility into whether the ANTHROPIC_API_KEY
  // secret is actually bound to the running version — "saved in the dashboard"
  // and "attached to the deployment" are different states in Cloudflare, and
  // the difference is invisible from outside without this.
  // readFiles and pendingMedia are bookkeeping: up to 500 storage paths that
  // would ride on every poll for no reason. The report built from them is what
  // the panel actually draws.
  const { readFiles, pendingMedia, ...panelState } = state?.data || {};
  return json({
    state: panelState,
    qa: qa.map((r) => r.data),
    glossary: knowledge.map((r) => ({
      id: r.id, term: r.data.term, definition: r.data.definition,
      category: r.data.category || 'General', learned: !!r.data.learnedAt,
      // Conditions and syndromes carry the three things Eric asked to see
      // beside the definition. Terms that are just terms carry none of them.
      mechanism: r.data.mechanism || '', treatment: r.data.treatment || '',
      outcome: r.data.outcome || '',
      addedAt: r.data.addedAt || null,
    })),
    keyConfigured: Boolean(env.ANTHROPIC_API_KEY),
    // The folder surfaces. All of this is Eric's private working material;
    // nothing here is ever readable by a client (this route is admin-gated,
    // the docs themselves are browser-denied by rule).
    notes: notesDoc?.data.html || '',
    notesUpdatedAt: notesDoc?.data.updatedAt || null,
    // The panel and the case header both read `workingLine` and expect
    // `dxOverride` to carry its own text and timestamp. This used to send
    // `dx: { working, override }`, which nothing has ever read: the working
    // line was blank on two of the three surfaces that show it, and only the
    // shelf worked because it reads workingDx off the case doc directly.
    workingLine: state?.data.workingDx || '',
    dxOverride: typeof state?.data.dxOverride === 'string' && state.data.dxOverride
      ? { text: state.data.dxOverride, at: state.data.dxOverrideAt || null }
      : null,
    differential: Array.isArray(state?.data.differential) ? state.data.differential : [],
    // Dismissed corrections stay on the doc, so the next analysis knows not to
    // raise them again, but they never come back out here: dismissed means the
    // chat stops marking that message.
    corrections: (Array.isArray(state?.data.corrections) ? state.data.corrections : [])
      .filter((c) => c && !c.dismissed),
    // Things he asked the client for and has not received. Rows he marked
    // answered stay stored, so the next pass knows not to raise them again,
    // and never come back out here.
    unanswered: (Array.isArray(state?.data.unanswered) ? state.data.unanswered : [])
      .filter((r) => r && !r.answered),
    // Exactly what the last analysis did with every file it was handed: read,
    // already read, queued for the next pass, or unreadable with the reason.
    // Eric shared eight documents once and the advisor discussed three; this
    // is the surface that makes that visible instead of guessable.
    mediaReport: state?.data.mediaReport || null,
    queuedFiles: Array.isArray(pendingMedia) ? pendingMedia.map((m) => m.name) : [],
    // What the advisor has worked out about Eric himself: how he writes, the
    // positions he holds (including anything he settled with "override"), and
    // an honest read on what he does well with clients and what he could work
    // on. Global rather than per-case, and never client-visible: this route is
    // admin-gated and advisorStyle is Worker-only.
    about: {
      voice: style?.data.voice || '',
      stances: style?.data.stances || '',
      coaching: style?.data.coaching || '',
      updatedAt: style?.data.updatedAt || null,
    },
  });
}

/**
 * Eric's half of the release notes.
 *
 * It lives here rather than in public/js/changelog.js because that file is
 * loaded by every page: anything in it can be read by anyone who opens
 * devtools, and these lines name the advisor, the working diagnosis and the
 * duty-of-care draft. A client is meant to be blind to all three, and "blind"
 * has to mean blind to somebody curious, not only to somebody who never looks.
 *
 * The client's half stays in the static file, where it belongs: it is what
 * every reader is supposed to see.
 */
const ADMIN_NOTES = {
  '2.2': [
    'The dashboard is a shelf of case folders with the working diagnosis on the front. Press and hold that line to write your own over it.',
    'Folders carry an emoji for anything you have not looked at yet, and they stack: 💬👨‍🔬.',
    'The case opens as a folder. Tap the right half of a page to send it to the back of the pile, the left half to bring one forward. It loops.',
    'The advisor stops losing documents. Everything you hand it is read, queued for the next pass, or named with the reason it could not be read.',
    'It also picks up new files on its own, about five minutes after they land, and never re-reads one.',
    'Ten sections now, including plain English with colour-coded terms, a chart note, what is missing, and what is genuinely ruled out.',
    'Say "override" and the advisor stops arguing and files your position permanently.',
    'Education and About you are their own tabs.',
    'Reviews land in the case Overview for you to publish or keep private.',
    'A duty-of-care draft and a printable video prep sheet live under Drafts.',
    'Tabs are grouped now: Case, Advisor, Track and Mine across the top, three pages in each, everything two taps away.',
    'The duty-of-care draft is a ⚕️ in the chat composer, on every case, always the same. It says nothing about anyone.',
    'Unanswered: things you asked the client for that never came back, oldest first, with ask-again and got-it.',
    'Summary: one day of a thread read back to you. Once per day, and the same day always reads the same.',
    'Saved: press and hold any message to bookmark it with a note. Private to you, and nothing is written back to the message.',
    'The corrections the advisor flags are actually wired up now. A flagged message of yours carries a mark and offers the repaired wording.',
    'The override opens a real editor instead of a prompt(), which did nothing at all inside the home-screen app.',
    'The differential shows why each one fits and what would move it, on the page and on the printed prep sheet.',
    'Documents uploaded on the client\'s own page are read now. They never were: that page uploads straight to storage and nothing told the advisor.',
    'You no longer get an email when a client writes. Push already told you.',
  ],
};

async function handleChangelog(request, env) {
  const user = await requireUser(request, env);
  // 404 for a signed-out caller too. A 401 here says the route is real and
  // you are merely not logged in, which is the same oracle the 403 was.
  if (!user) return json({ error: 'Not found' }, 404);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Not found' }, 404);
  return json({ admin: ADMIN_NOTES });
}

/**
 * POST /api/followup — the client buys a follow-up session on their own case,
 * after the report has landed.
 *
 * Buying it only sets `addOnFollowUp`, which is the flag every part of the
 * follow-up machinery already keys off: Eric's scheduler, the expiry warning
 * cron, the line on their case page. So there is no second scheduling path to
 * build and no second way for the two to disagree. He books it exactly as he
 * books one that was bought at checkout.
 */
async function handleFollowUpCheckout(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!/^[\w-]{1,64}$/.test(caseId)) return json({ error: 'Bad case' }, 400);

  const c = await getDoc(env, `cases/${caseId}`);
  if (!c || c.data.clientUid !== user.uid) return json({ error: 'Not found' }, 404);
  if (c.data.addOnFollowUp)
    return json({ error: 'You already have a follow-up session on this case.' }, 409);
  // Offered once there is something to follow up ON. Before the discussion has
  // happened, a second discussion is not a thing anyone can want yet.
  if (!['awaiting_report', 'delivered', 'closed'].includes(c.data.status))
    return json({ error: 'Your first discussion has to happen first.' }, 409);
  // A live checkout still in play: hand back the same link rather than opening
  // a second one they could pay twice.
  const pending = c.data.pendingFollowUp;
  if (pending?.url && new Date(pending.expiresAt || 0).getTime() > Date.now())
    return json({ ok: true, url: pending.url });

  const expiresAt = new Date(Date.now() + 23 * 3600_000);
  const session = await stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: c.data.clientEmail || undefined,
    line_items: followUpLineItems(followUpCents(c.data)),
    success_url: `${env.PUBLIC_BASE_URL}/case.html?id=${caseId}&followup=1`,
    cancel_url: `${env.PUBLIC_BASE_URL}/case.html?id=${caseId}`,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    metadata: { kind: 'followup', caseId, uid: c.data.clientUid },
  });
  await patchDoc(env, `cases/${caseId}`, {
    pendingFollowUp: { sessionId: session.id, url: session.url, createdAt: new Date(), expiresAt },
  }, { mask: ['pendingFollowUp'] });
  return json({ ok: true, url: session.url });
}

/**
 * What a follow-up costs THIS client: the price they were told when they
 * booked, not the one new clients see now. A case from before the field
 * existed falls back to the constant, which since it only moves upward errs in
 * the client's favour.
 */
function followUpCents(c) {
  return Number(c?.addonRateCents) > 0 ? Number(c.addonRateCents) : ADDON_PRICE_CENTS;
}

/** Paid. Set the flag the rest of the system already understands. */
async function confirmFollowUpPurchase(env, session) {
  const caseId = session.metadata?.caseId;
  if (!caseId) return;
  const c = await getDoc(env, `cases/${caseId}`);
  if (!c) return;
  const now = new Date();
  if (c.data.addOnFollowUp) {
    // The flag is already set - the grandfather migration, or a second
    // checkout that raced this one - but MONEY MOVED, and the old bare return
    // recorded it nowhere: no ledger entry, no email, nobody told, nothing to
    // refund from. The payment is written down and Eric is pinged to refund
    // it; the one session already recorded is the only repeat this skips.
    // (Post-2.2 audit, 2026-08-21.)
    const prior = Array.isArray(c.data.extraPayments) ? c.data.extraPayments : [];
    if (prior.some((x) => x.sessionId === session.id)) return;
    prior.push({
      kind: 'followup', amountCents: session.amount_total || followUpCents(c.data),
      sessionId: session.id, at: now, duplicate: true,
    });
    // Locked like confirmTip: a concurrent confirm must not erase this row.
    const okDup = await patchDoc(env, `cases/${caseId}`, { extraPayments: prior },
      { mask: ['extraPayments'], ifUpdateTime: c.updateTime });
    if (okDup === false) return confirmFollowUpPurchase(env, session);
    const admins = await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 5).catch(() => []);
    for (const a of admins) {
      await notifyUser(env, a.id, {
        title: 'Pocket Advocate',
        body: `${firstName(c.data.clientName) || 'A client'} paid for a follow-up their case already has. Refund it from Stripe.`,
        link: `/admin-case.html?id=${caseId}`,
      }).catch(() => {});
    }
    return;
  }
  const payments = Array.isArray(c.data.extraPayments) ? c.data.extraPayments : [];
  payments.push({
    kind: 'followup', amountCents: session.amount_total || followUpCents(c.data),
    sessionId: session.id, at: now,
  });
  const okBuy = await patchDoc(env, `cases/${caseId}`, {
    addOnFollowUp: true,
    // The month runs from here, not from a call that may be weeks behind them.
    addOnFollowUpAt: now,
    pendingFollowUp: null,
    extraPayments: payments,
  }, { mask: ['addOnFollowUp', 'addOnFollowUpAt', 'pendingFollowUp', 'extraPayments'], ifUpdateTime: c.updateTime });
  // Lost the lock: something else wrote the case between read and write.
  // Re-run from the top; the sessionId dedup makes the retry idempotent.
  if (okBuy === false) return confirmFollowUpPurchase(env, session);
  await sendEmail(env, {
    to: c.data.clientEmail,
    subject: 'Your follow-up session is paid for',
    html: `<p>That's booked in principle — I'll be in touch in your case chat to
      find a time that works.</p>
      <p>It's yours to use within 30 days from today.</p>
      <p><a href="${env.PUBLIC_BASE_URL}/case.html?id=${caseId}">Open your case</a></p>`,
  }).catch(() => { /* the purchase still stands if the mail fails */ });
  const admins = await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 5).catch(() => []);
  for (const a of admins) {
    await notifyUser(env, a.id, {
      title: 'Pocket Advocate',
      body: `${firstName(c.data.clientName) || 'A client'} bought a follow-up session.`,
      link: `/admin-case.html?id=${caseId}`,
    }).catch(() => {});
  }
}

/** How long a case chat stays open after the report lands. */
const REVIEW_WINDOW_MS = 48 * 3600_000;

/**
 * POST /api/review — the client's five stars and a few words, on their own
 * delivered case. One review per case: a second submission edits the first
 * rather than stacking, because a review is a verdict on a case and a case has
 * one of those.
 *
 * Nothing is published by this route. Every review lands unpublished and Eric
 * decides, which is why the copy the client reads promises them nothing about
 * where it appears.
 */
/**
 * POST /api/tip  Body: { caseId, amountCents }
 *
 * The tip jar. Entirely optional, never gates anything, and grants nothing:
 * the only record is a ledger entry and a note to Eric. The amount is chosen
 * on the page (a percentage of what they paid, or their own number); this
 * only checks it is a sane amount on their own case, then hands them to
 * Stripe. Charged immediately - it is a checkout, not a saved card.
 */
async function handleTip(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!/^[\w-]{1,64}$/.test(caseId)) return json({ error: 'Bad case' }, 400);
  const amountCents = Math.round(Number(body?.amountCents));
  if (!(amountCents >= 100 && amountCents <= 500000))
    return json({ error: 'Pick an amount between $1 and $5,000.' }, 400);
  const doc = await getDoc(env, `cases/${caseId}`);
  if (!doc || doc.data.clientUid !== user.uid) return json({ error: 'Not found' }, 404);

  const session = await stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: doc.data.clientEmail || user.email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: amountCents,
        product_data: { name: 'Tip', description: 'Optional contribution — The Pocket Advocate' },
      },
    }],
    success_url: `${env.PUBLIC_BASE_URL}/case.html?id=${caseId}&tipped=1`,
    cancel_url: `${env.PUBLIC_BASE_URL}/case.html?id=${caseId}`,
    metadata: { kind: 'tip', caseId, uid: user.uid },
  });
  return json({ url: session.url });
}

/**
 * POST /api/chat-unlock  Body: { caseId }
 *
 * Opens the case chat before its one-week window, for a one-time $50 (the
 * direct-line price). Anti-abuse by design: a call booked far out no longer
 * buys months of free chat runway. The fee never changes what the case
 * includes; it only moves the chat's opening day.
 */
async function handleChatUnlock(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!/^[\w-]{1,64}$/.test(caseId)) return json({ error: 'Bad case' }, 400);
  const doc = await getDoc(env, `cases/${caseId}`);
  if (!doc || doc.data.clientUid !== user.uid) return json({ error: 'Not found' }, 404);
  if (doc.data.chatUnlocked) return json({ error: 'Chat is already open.' }, 409);

  const session = await stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: doc.data.clientEmail || user.email || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: CHAT_OPEN_CENTS,
        product_data: { name: 'Open chat now', description: 'Direct line for the life of your case - The Pocket Advocate' },
      },
    }],
    success_url: `${env.PUBLIC_BASE_URL}/case.html?id=${caseId}&chatopen=1`,
    cancel_url: `${env.PUBLIC_BASE_URL}/case.html?id=${caseId}`,
    metadata: { kind: 'chatunlock', caseId, uid: user.uid },
  });
  return json({ url: session.url });
}

/** Paid. Open the chat, write the ledger row, tell Eric. */
async function confirmChatUnlock(env, session) {
  const caseId = session.metadata?.caseId;
  if (!caseId) return;
  let wrote = false;
  for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
    const c = await getDoc(env, `cases/${caseId}`);
    if (!c) return;
    const payments = Array.isArray(c.data.extraPayments) ? c.data.extraPayments : [];
    if (payments.some((x) => x.sessionId === session.id)) return;
    payments.push({
      kind: 'chatunlock', amountCents: session.amount_total || CHAT_OPEN_CENTS,
      sessionId: session.id, at: new Date(),
    });
    wrote = false !== await patchDoc(env, `cases/${caseId}`, {
      chatUnlocked: true, chatUnlockedAt: new Date(), chatOpenNotified: true,
      extraPayments: payments,
    }, { mask: ['chatUnlocked', 'chatUnlockedAt', 'chatOpenNotified', 'extraPayments'], ifUpdateTime: c.updateTime });
  }
  if (!wrote) { console.warn('confirmChatUnlock: kept losing the lock', caseId); return; }
  const c = await getDoc(env, `cases/${caseId}`).catch(() => null);
  if (session.metadata?.uid) {
    await notifyUser(env, session.metadata.uid, {
      title: 'Pocket Advocate',
      body: 'Chat is open on your case. Message me anytime.',
      link: `/case.html?id=${caseId}`,
    }).catch(() => {});
  }
  const admins = await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 5).catch(() => []);
  for (const a of admins) {
    await notifyUser(env, a.id, {
      title: 'Pocket Advocate',
      body: `${firstName(c?.data.clientName) || 'A client'} opened chat early ($${((session.amount_total || CHAT_OPEN_CENTS) / 100).toFixed(2)}).`,
      link: `/admin-case.html?id=${caseId}`,
    }).catch(() => {});
  }
}

/**
 * Cron: tell a gated client the moment their chat opens (Eric, 2026-08-22:
 * "They get notified when chat becomes unlocked"). Only cases that actually
 * LIVED through the gate: booked more than a week before their call, still
 * pre-call, never paid the early-open fee. A normal booking whose chat was
 * open from day one gets no notice, because nothing changed for them. The
 * marker is written before the sends, so an overlapping cron fire can never
 * notify twice; push and email both go, since not every client turns
 * notifications on.
 */
async function runChatOpenNotices(env) {
  try {
    const rows = await listDocs(env, 'cases', { pageSize: 300, all: true });
    const now = Date.now();
    for (const r of rows) {
      const c = r.data;
      if (c.chatOpenNotified || c.chatUnlocked) continue;
      if (['delivered', 'closed'].includes(c.status)) continue;
      const start = c.appointment?.start ? new Date(c.appointment.start).getTime() : 0;
      if (!start) continue;
      const opensAt = start - CHAT_OPEN_DAYS * 86_400_000;
      if (now < opensAt || now >= start) continue;
      if (!c.createdAt || new Date(c.createdAt).getTime() >= opensAt) continue; // never gated
      const marked = await patchDoc(env, `cases/${r.id}`, { chatOpenNotified: true },
        { mask: ['chatOpenNotified'], ifUpdateTime: r.updateTime });
      if (marked === false) continue; // raced; the other writer owns it
      if (c.clientUid) {
        await notifyUser(env, c.clientUid, {
          title: 'Pocket Advocate',
          body: 'Chat is now open ahead of our call. Message me anytime.',
          link: `/case.html?id=${r.id}`,
        }).catch(() => {});
      }
      if (c.clientEmail) {
        await sendEmail(env, {
          to: c.clientEmail,
          subject: 'Chat is open on your case',
          html: `<p>We're inside a week of our call, so chat is now open on your case. Message me anytime.</p>
            <p><a href="${env.PUBLIC_BASE_URL}/case.html?id=${r.id}">Open your case</a></p>`,
        }).catch(() => { /* the push may still have landed */ });
      }
    }
  } catch (err) {
    console.warn('chat open notices:', err.message || err);
  }
}

/** Paid. A ledger entry and a thank-you to nobody but Eric. */
async function confirmTip(env, session) {
  const caseId = session.metadata?.caseId;
  if (!caseId) return;
  // Locked read-modify-write: two webhook confirms landing together each
  // read the same array, and the loser's write erased the winner's entry, a
  // paid tip with no ledger row. The precondition makes the loser re-read.
  let wrote = false;
  for (let attempt = 0; attempt < 3 && !wrote; attempt++) {
    const c = await getDoc(env, `cases/${caseId}`);
    if (!c) return;
    const payments = Array.isArray(c.data.extraPayments) ? c.data.extraPayments : [];
    if (payments.some((x) => x.sessionId === session.id)) return;
    payments.push({
      kind: 'tip', amountCents: session.amount_total || 0, sessionId: session.id, at: new Date(),
    });
    wrote = false !== await patchDoc(env, `cases/${caseId}`, { extraPayments: payments },
      { mask: ['extraPayments'], ifUpdateTime: c.updateTime });
  }
  if (!wrote) { console.warn('confirmTip: ledger append kept losing the lock', caseId); return; }
  const c = { data: (await getDoc(env, `cases/${caseId}`))?.data || {} };
  const admins = await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 5).catch(() => []);
  for (const a of admins) {
    await notifyUser(env, a.id, {
      title: 'Pocket Advocate',
      body: `${firstName(c.data.clientName) || 'A client'} left a $${((session.amount_total || 0) / 100).toFixed(2)} tip.`,
      link: `/admin-case.html?id=${caseId}`,
    }).catch(() => {});
  }
}

async function handleReviewSubmit(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!/^[\w-]{1,64}$/.test(caseId)) return json({ error: 'Bad case' }, 400);

  const stars = Math.round(Number(body?.stars));
  if (!(stars >= 1 && stars <= 5)) return json({ error: 'Pick one to five stars.' }, 400);
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 1000) : '';

  // Their OWN case, and only once it has actually been delivered. A review of
  // something that has not happened is not a review.
  const doc = await getDoc(env, `cases/${caseId}`);
  if (!doc || doc.data.clientUid !== user.uid) return json({ error: 'Not found' }, 404);
  // Any time, not only after delivery. (Eric, 2026-08-21: "you're welcome to
  // leave a review at any point along the way. You don't need to wait until
  // your case is finished.") Own-case is still the gate that matters.

  const prior = await getDoc(env, `reviews/${caseId}`).catch(() => null);
  await patchDoc(env, `reviews/${caseId}`, {
    caseId,
    clientUid: user.uid,
    // The name shown on the reviews page if Eric publishes it. It comes off
    // the case rather than from the request: a review must never be able to
    // sign itself as somebody else.
    name: doc.data.clientName || 'A client',
    stars, text,
    at: new Date(),
    // An edit never re-publishes itself. Eric approved the words he read.
    published: false,
    publishedAt: null,
  }, { mask: ['caseId', 'clientUid', 'name', 'stars', 'text', 'at', 'published', 'publishedAt'] });

  return json({ ok: true, edited: !!prior });
}

/** GET /api/reviews — published reviews only. Public, no auth. */
async function handleReviewsPublic(env) {
  const rows = await queryDocs(env, 'reviews', [['published', 'EQUAL', true]], 50).catch(() => []);
  const reviews = rows
    .map((r) => ({
      name: r.data.name || 'A client',
      stars: Math.max(1, Math.min(5, Math.round(Number(r.data.stars) || 5))),
      text: String(r.data.text || ''),
      at: r.data.publishedAt || r.data.at || null,
    }))
    .sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0));
  return json({ reviews });
}

/**
 * The approval queue. GET lists every review with its state; POST publishes or
 * unpublishes one. Admin only, because publishing a client's words under their
 * own name is not a decision that belongs anywhere else.
 */
async function handleReviewsAdmin(request, env) {
  const user = await requireUser(request, env);
  // 404 for a signed-out caller too. A 401 here says the route is real and
  // you are merely not logged in, which is the same oracle the 403 was.
  if (!user) return json({ error: 'Not found' }, 404);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Not found' }, 404);

  if (request.method === 'GET') {
    const rows = await listDocs(env, 'reviews', { pageSize: 200 }).catch(() => []);
    return json({
      reviews: rows.map((r) => ({
        id: r.id, caseId: r.data.caseId || r.id, name: r.data.name || '',
        stars: Number(r.data.stars) || 0, text: String(r.data.text || ''),
        at: r.data.at || null, published: !!r.data.published,
      })).sort((a, b) => new Date(b.at || 0) - new Date(a.at || 0)),
    });
  }

  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === 'string' ? body.id : '';
    if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'Bad review' }, 400);
    const publish = body?.publish === true;
    await patchDoc(env, `reviews/${id}`, {
      published: publish, publishedAt: publish ? new Date() : null,
    }, { mask: ['published', 'publishedAt'] });
    return json({ ok: true, published: publish });
  }

  return json({ error: 'Method not allowed' }, 405);
}

/**
 * GET /api/advisor/covers — the dashboard shelf's folder covers in one call:
 * { covers: { [caseId]: { text, by } } }. caseMeta is Worker-only by rule
 * (a case doc is client-readable, so the working line can never live there);
 * the shelf paints "No read yet" for any case without a cover.
 */
async function handleAdvisorCovers(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Not found' }, 404);
  // The uid check first, because it needs no round trip. A caller who is not
  // him is refused in the same time an unknown route takes, instead of being
  // told, by the clock, that this route does real work before it refuses.
  if (env.ADMIN_UID && user.uid !== env.ADMIN_UID) return json({ error: 'Not found' }, 404);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Not found' }, 404);

  const rows = await listDocs(env, 'caseMeta', { pageSize: 200 }).catch(() => []);
  const covers = {};
  for (const r of rows) {
    const dx = r.data.workingDx;
    covers[r.id] = {
      text: dx?.text || '',
      by: dx?.by || 'advisor',
      // What changed, and when. The shelf compares these against what Eric has
      // already looked at to decide which emoji a folder carries.
      at: {
        advisor: r.data.advisorAt || null,
        diff: r.data.diffAt || null,
        draft: r.data.draftAt || null,
        chat: r.data.clientMsgAt || null,
        files: r.data.fileAt || null,
      },
    };
  }
  return json({ covers });
}

/**
 * GET/POST /api/advisor/dictionary — Eric's full medical dictionary.
 * GET returns every term with category and learned state; POST { termId,
 * learned } flips a checkbox. Global, not per-case: his vocabulary is his,
 * wherever it was learned. Admin only.
 */
async function handleDictionary(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Not found' }, 404);
  // The uid check first, because it needs no round trip. A caller who is not
  // him is refused in the same time an unknown route takes, instead of being
  // told, by the clock, that this route does real work before it refuses.
  if (env.ADMIN_UID && user.uid !== env.ADMIN_UID) return json({ error: 'Not found' }, 404);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Not found' }, 404);

  if (request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const termId = typeof body?.termId === 'string' ? body.termId : '';
    if (!/^[a-z0-9-]{1,60}$/.test(termId)) return json({ error: 'Bad term' }, 400);
    await patchDoc(env, `advisorKnowledge/${termId}`, {
      learnedAt: body?.learned ? new Date() : null,
      learnedVia: body?.learned ? 'checked' : null,
    }, { mask: ['learnedAt', 'learnedVia'] });
    return json({ ok: true });
  }

  const rows = await listDocs(env, 'advisorKnowledge', { pageSize: 300 }).catch(() => []);
  return json({
    terms: rows.map((r) => ({
      id: r.id,
      term: r.data.term,
      definition: r.data.definition,
      category: r.data.category || 'General',
      learned: !!r.data.learnedAt,
      learnedVia: r.data.learnedVia || null,
    })),
  });
}

// The only tags the notes paper may keep. Everything else is dropped, and
// every kept tag is rebuilt bare, so no attribute, no on* handler and no
// javascript: url can survive the trip through here.
const NOTE_TAGS = new Set([
  'b', 'strong', 'i', 'em', 'u', 'h1', 'h2', 'h3', 'p', 'br', 'div', 'span',
  'ul', 'ol', 'li', 'blockquote', 'font', 'sup', 'sub',
]);
// Tags whose CONTENT is as dangerous as the tag: dropping `<script>` while
// keeping what is between the tags just moves the payload into the text.
// `embed` is deliberately not here — it is void, so it has nothing to take
// with it, and waiting for a close tag that never comes would swallow the rest
// of a pasted note. It is dropped as an unlisted tag like any other.
const NOTE_KILL = new Set(['script', 'style', 'iframe', 'object']);

/** The one attribute the notes toolbar needs back: document.execCommand still
 * writes sizes as `<font size=N>`. A digit 1-7 can carry nothing executable. */
function fontAttr(attrs) {
  const m = attrs.match(/(?:^|\s)size\s*=\s*["']?\s*([1-7])(?=["'\s/]|$)/i);
  return m ? ` size="${m[1]}"` : '';
}

/**
 * Allowlist sanitizer for the notes editor's HTML. The Worker is the trust
 * boundary, so the sanitizing happens here and not in the page that typed it:
 * the browser sends contenteditable output, which is attacker-shaped by
 * definition, and the result is stored and re-rendered later. Admin-authored
 * and admin-read is not a reason to skip it.
 *
 * Text passes through as-is (contenteditable entity-encodes typed angle
 * brackets), unknown tags vanish while their text stays, script/style/iframe/
 * object take their contents with them, and an unterminated tag fragment takes
 * the rest of the string with it.
 */
function sanitizeNotes(html) {
  let out = '';
  let i = 0;
  let killing = '';
  let depth = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { if (!killing) out += html.slice(i); break; }
    if (!killing) out += html.slice(i, lt);
    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    const m = html.slice(lt, gt + 1).match(/^<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)(?=[\s/>])([^>]*)>$/);
    if (m) {
      const closing = m[1] === '/';
      const name = m[2].toLowerCase();
      const selfClosing = /\/\s*$/.test(m[3]);
      if (killing) {
        if (name === killing) depth += closing ? -1 : (selfClosing ? 0 : 1);
        if (depth <= 0) { killing = ''; depth = 0; }
      } else if (NOTE_KILL.has(name)) {
        if (!closing && !selfClosing) { killing = name; depth = 1; }
      } else if (NOTE_TAGS.has(name)) {
        out += closing ? `</${name}>` : `<${name}${name === 'font' ? fontAttr(m[3]) : ''}>`;
      }
    }
    i = gt + 1;
  }
  return out;
}

/**
 * POST /api/advisor  Body: { kind: 'case'|'sub', id, action, question?, instruction?, draft?, sent? }
 * action: 'analyze' | 'ask' | 'draft' | 'draft-feedback' | 'pause' | 'resume' | 'clear-draft'
 *       | 'dx' (folder-cover override) | 'note' (private notes) | 'correction-dismiss'
 *       | 'unanswered-answered' (an outstanding ask he got, or let go)
 *
 * Admin only, and invisible to clients by rule — see the `advisor` match in
 * firestore.rules. The model calls run in ctx.waitUntil and land in Firestore,
 * so the panel just watches the document rather than holding a request open
 * for a long Opus turn.
 */
async function handleAdvisor(request, env, ctx) {
  // 404, not 401 or 403. An unknown route answers 404, so answering anything
  // else here confirms to a client that a route by this name exists. The data
  // was never reachable; the status code was the leak.
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Not found' }, 404);
  // The uid check first, because it needs no round trip. A caller who is not
  // him is refused in the same time an unknown route takes, instead of being
  // told, by the clock, that this route does real work before it refuses.
  if (env.ADMIN_UID && user.uid !== env.ADMIN_UID) return json({ error: 'Not found' }, 404);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Not found' }, 404);

  const body = await request.json().catch(() => null);
  const kind = body?.kind === 'sub' ? 'sub' : 'case';
  const id = typeof body?.id === 'string' ? body.id : '';
  const action = body?.action;
  if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'Bad id' }, 400);

  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  const statePath = `${parent}/${id}/advisor/state`;

  if (action === 'pause' || action === 'resume') {
    await patchDoc(env, statePath, { paused: action === 'pause' }, { mask: ['paused'] });
    return json({ ok: true, paused: action === 'pause' });
  }

  if (action === 'term') {
    // "I understand this now." Checked terms are never explained again and
    // become part of how the advisor gauges what level to pitch at.
    const termId = typeof body?.termId === 'string' ? body.termId : '';
    if (!/^[a-z0-9-]{1,60}$/.test(termId)) return json({ error: 'Bad term' }, 400);
    await patchDoc(env, `advisorKnowledge/${termId}`, {
      learnedAt: body?.learned ? new Date() : null,
    }, { mask: ['learnedAt'] });
    return json({ ok: true });
  }

  // The three folder writes below are single small patches, so they answer
  // straight away: keepaliveRun exists for the minutes-long model turns, and
  // holding a connection open for a one-field write only slows the page down.

  if (action === 'dx') {
    // Eric's own read for the folder cover. Text overrides the advisor's
    // working line; null or empty hands the cover back to the advisor. It sits
    // beside the advisor's line on the Worker-only state doc, not on the case
    // doc a client can read.
    const raw = body?.text ?? '';
    if (typeof raw !== 'string') return json({ error: 'Bad working line' }, 400);
    const text = raw.trim();
    if (text.length > 120)
      return json({ error: 'Keep the working line to 120 characters.' }, 400);
    const now = new Date();
    // Only a clear needs the advisor's own line back for the shelf.
    const state = text ? null : await getDoc(env, statePath);
    await patchDoc(env, statePath, {
      dxOverride: text || null, dxOverrideAt: text ? now : null,
    }, { mask: ['dxOverride', 'dxOverrideAt'] });
    if (kind === 'case')
      await patchDoc(env, `caseMeta/${id}`, {
        workingDx: {
          text: text || state?.data.workingDx || '',
          by: text ? 'eric' : 'advisor',
          at: now,
        },
      }, { mask: ['workingDx'] });
    return json({ ok: true });
  }

  if (action === 'note') {
    // Eric's private notes page. Sanitized here because the Worker is the
    // trust boundary, and stored under `private/`, which is browser-denied by
    // rule in both directions: only this admin-gated route reads it back.
    if (typeof body?.html !== 'string') return json({ error: 'Bad note' }, 400);
    if (body.html.length > 200_000)
      return json({ error: 'That note is too long to save.' }, 400);
    const now = new Date();
    await patchDoc(env, `${parent}/${id}/private/notes`, {
      html: sanitizeNotes(body.html), updatedAt: now,
    }, { mask: ['html', 'updatedAt'] });
    return json({ ok: true, savedAt: now.toISOString() });
  }

  if (action === 'unanswered-answered') {
    // He got it, or decided to let it go. The flag rides on the row itself so
    // the next analysis merges it forward rather than raising the same ask
    // again next week.
    const ask = typeof body?.ask === 'string' ? body.ask.slice(0, 300) : '';
    if (!ask) return json({ error: 'Which one?' }, 400);
    const flat = (v) => String(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const state = await getDoc(env, statePath);
    const unanswered = (Array.isArray(state?.data.unanswered) ? state.data.unanswered : [])
      .filter((r) => r && r.ask)
      // Reading decodes timestamps to ISO strings; writing the array back
      // untouched would retype every date from timestamp to string.
      .map((r) => ({
        ...r,
        firstAskedAt: r.firstAskedAt ? new Date(r.firstAskedAt) : new Date(),
        answered: flat(r.ask) === flat(ask) ? true : !!r.answered,
      }));
    await patchDoc(env, statePath, { unanswered }, { mask: ['unanswered'] });
    return json({ ok: true });
  }

  if (action === 'correction-dismiss') {
    // A flagged slip was applied (or waved off): stop offering the fix. The
    // flag rides on the correction itself, so the next analysis merges it
    // forward instead of raising the same repair again.
    const msgId = typeof body?.msgId === 'string' ? body.msgId : '';
    if (!/^[\w-]{1,64}$/.test(msgId)) return json({ error: 'Bad message id' }, 400);
    const state = await getDoc(env, statePath);
    const corrections = (Array.isArray(state?.data.corrections) ? state.data.corrections : [])
      .filter((c) => c && c.msgId)
      // Reading decodes timestamps to ISO strings; writing the array back
      // untouched would retype every `at` from timestamp to string.
      .map((c) => ({
        ...c,
        at: c.at ? new Date(c.at) : new Date(),
        dismissed: c.msgId === msgId ? true : !!c.dismissed,
      }));
    await patchDoc(env, statePath, { corrections }, { mask: ['corrections'] });
    return json({ ok: true });
  }

  if (action === 'reset') {
    // Wipe everything the advisor holds on this thread — assessment, Q&A,
    // draft, queue — so it starts clean. Qa docs first: deleting a parent doc
    // does not delete its subcollection in Firestore.
    const qa = await listDocs(env, `${parent}/${id}/advisor/state/qa`, { pageSize: 50 }).catch(() => []);
    for (const q of qa) await deleteDoc(env, `${parent}/${id}/advisor/state/qa/${q.id}`);
    await deleteDoc(env, `${parent}/${id}/advisor/state`);
    await deleteDoc(env, `advisorQueue/${kind}_${id}`);
    return json({ ok: true, cleared: true });
  }

  if (action === 'clear-draft') {
    await patchDoc(env, statePath, { draft: null, draftStatus: null }, {
      mask: ['draft', 'draftStatus'],
    });
    return json({ ok: true });
  }

  if (action === 'draft-feedback') {
    // Eric just sent a prepared draft: `draft` is what the advisor wrote,
    // `sent` is what actually went out after his edits. A real edit is stored
    // as a style lesson and triggers an immediate profile distill, so the
    // very next draft writes with it. An unchanged send stores NOTHING: a
    // failed feedback call can reopen the editor with the already-sent
    // original, and recording that re-send as "the draft was already right"
    // would poison the evidence against his actual edit. Either way the
    // served draft is cleared (the send itself already happened).
    const draft = typeof body?.draft === 'string' ? body.draft.slice(0, 4000) : '';
    const sent = typeof body?.sent === 'string' ? body.sent.slice(0, 2200) : '';
    if (!draft || !sent) return json({ error: 'Bad feedback' }, 400);
    const changed = draft.trim() !== sent.trim();
    if (changed) {
      await patchDoc(env, `advisorStyle/profile/edits/${crypto.randomUUID()}`, {
        draft, sent, changed, kind, id, at: new Date(),
      });
    } else {
      // An unchanged send still stores an EXCLUSION KEY: sent text with no
      // draft field, so every pair filter skips it. It is never evidence
      // (the re-send poisoning the comment above guards against cannot
      // happen through a doc that carries no draft); it exists so the voice
      // study can recognise draft-born words in the chat and keep them out
      // of the "how Eric writes" corpus. Without it, an unedited send was
      // read back as his organic writing, and the profile slowly converged
      // on the model's own style wearing his name.
      await patchDoc(env, `advisorStyle/profile/edits/${crypto.randomUUID()}`, {
        sent, changed: false, kind, id, at: new Date(),
      }).catch(() => {});
    }
    await patchDoc(env, statePath, { draft: null, draftStatus: null }, {
      mask: ['draft', 'draftStatus'],
    });
    if (!changed) return json({ ok: true, learned: false });
    return keepaliveRun(ctx, runStyleDistill(env, kind, id), { raw: true });
  }

  if (action === 'ping') {
    // The panel fires this on its own when a run stalls; the answer is the
    // provider's, verbatim, on a route only the admin can reach.
    try {
      return json(await pingModel(env));
    } catch (err) {
      return json({ ok: false, error: [err.status, err.message || String(err)].filter(Boolean).join(': ') });
    }
  }

  if (action === 'analyze') {
    // Don't stack a second Opus run on top of a LIVE one - but a dead one must
    // never block the button that exists to revive it.
    //
    // (Eric, 2026-08-21: "Update stalled. Tapping update afterwards did
    // nothing.")
    //
    // This held the lock for twelve minutes from startedAt, while the panel
    // declares a run dead after two minutes without a heartbeat. For the ten
    // minutes in between, the screen said "stalled - tap Update" and every tap
    // was answered ok:true and thrown away. The two ends now judge liveness
    // the same way and by the same clock: the heartbeat the run itself writes,
    // and the same two minutes. If the panel says stalled, a new run starts.
    const state = await getDoc(env, `${parent}/${id}/advisor/state`);
    const startedAt = state?.data.startedAt ? new Date(state.data.startedAt).getTime() : 0;
    const progressAt = state?.data.progressAt ? new Date(state.data.progressAt).getTime() : 0;
    const lastBeat = Math.max(startedAt, progressAt);
    if (state?.data.status === 'running' && lastBeat && Date.now() - lastBeat < ADVISOR_ALIVE_MS)
      return json({ ok: true, already: true });
    // Files Eric explicitly selected (the 👨‍⚕️ badges), plus files he
    // uploaded straight to the advisor from his own device: those arrive
    // inline as base64 `data` and never exist anywhere a client could see.
    // Shape-checked here; URLs are fence-checked in the advisor before any
    // fetch, and inline data is size-capped there before use.
    // Take every file he staged. The advisor batches what will not fit into
    // the next pass rather than truncating here, so a cap at this layer would
    // just be the same silent drop one level up. The only ceiling left is on
    // inline base64 - that is real bytes in this request, and 24MB of it is
    // already more than one pass can carry.
    let media = null;
    if (Array.isArray(body?.media) && body.media.length) {
      let inlineBudget = 24_000_000;
      media = body.media.slice(0, 60).map((m) => {
        const data = typeof m?.data === 'string' && m.data.length <= 20_000_000 ? m.data : '';
        const fits = data && data.length <= inlineBudget;
        if (fits) inlineBudget -= data.length;
        return {
          name: String(m?.name || 'file').slice(0, 200),
          url: typeof m?.url === 'string' ? m.url.slice(0, 2048) : '',
          data: fits ? data : '',
          contentType: String(m?.contentType || '').slice(0, 100),
          size: typeof m?.size === 'number' ? m.size : 0,
        };
      }).filter((m) => m.url || m.data);
      if (!media.length) media = null;
    }
    // Queue first: if this connection drops mid-run, the cron retries it
    // (a cron retry runs without the selected files; the selection belongs
    // to the tap that made it).
    await markPending(env, kind, id);
    return keepaliveRun(ctx, runAnalysis(env, kind, id, media), { raw: true });
  }

  if (action === 'draft') {
    const instruction = typeof body?.instruction === 'string' ? body.instruction.slice(0, 1000) : '';
    // revise: rewrite the existing draft per the instruction instead of
    // starting fresh; `base` carries the draft box's current text so a
    // revision builds on Eric's in-place edits.
    const revise = body?.revise === true;
    const base = revise && typeof body?.base === 'string' ? body.base.slice(0, 4000) : '';
    // "Make it warmer", typed into the revise box, is Eric correcting the
    // advisor in his own words, and it used to evaporate with the request.
    // Stored with no draft/sent so every pair filter skips it; the nightly
    // study reads the newest few as their own small evidence list.
    if (revise && instruction) {
      await patchDoc(env, `advisorStyle/profile/edits/${crypto.randomUUID()}`, {
        instruction, changed: false, kind, id, at: new Date(),
      }).catch(() => {});
    }
    return keepaliveRun(ctx, runDraft(env, kind, id, instruction, revise, base), { raw: true });
  }

  if (action === 'ask') {
    const question = typeof body?.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 2000) return json({ error: 'Ask something (1–2000 chars).' }, 400);
    // Optional file to review ("send to the advisor"). Only the shape is
    // checked here; the URL itself is fence-checked in the advisor (Firebase
    // Storage host, this thread's own folder) before anything is fetched.
    let attachment = null;
    if (body?.attachment && typeof body.attachment === 'object') {
      attachment = {
        name: String(body.attachment.name || 'file').slice(0, 200),
        url: typeof body.attachment.url === 'string' ? body.attachment.url.slice(0, 2048) : '',
        contentType: String(body.attachment.contentType || '').slice(0, 100),
        size: typeof body.attachment.size === 'number' ? body.attachment.size : 0,
      };
      if (!attachment.url) return json({ error: 'Bad file reference' }, 400);
    }
    const qaId = crypto.randomUUID();
    await patchDoc(env, `${parent}/${id}/advisor/state/qa/${qaId}`, {
      question, answer: null, status: 'running', at: new Date(),
      ...(attachment ? { file: attachment.name } : {}),
    });
    return keepaliveRun(ctx, runQuestion(env, kind, id, qaId, question, attachment), { raw: true });
  }

  return json({ error: 'Unknown action' }, 400);
}

/**
 * A client wrote something — refresh the advisor's read of the case in the
 * background, unless Eric paused it. Best-effort: the advisor is a convenience,
 * never a reason for a message to fail.
 */
function refreshAdvisor(env, ctx, kind, id) {
  ctx.waitUntil((async () => {
    try {
      const parent = kind === 'case' ? 'cases' : 'subscriptions';
      const state = await getDoc(env, `${parent}/${id}/advisor/state`);
      if (state?.data.paused) return;
      // Only FLAG the work here — never run it. This executes in the ~30s of
      // background grace after the client's request completes, which is not
      // enough for an Opus turn; the actual analysis runs from Eric's open
      // panel (which holds a connection) or the cron.
      await markPending(env, kind, id);
    } catch (err) {
      console.warn('advisor refresh:', err.message || err);
    }
  })());
}

// POST /api/push/test — send a notification to the caller's OWN devices.
// "Are notifications actually working?" is otherwise unanswerable without
// waiting for a real event, and a silent failure looks identical to nothing
// having happened. Only ever pushes to the authenticated user's own
// subscriptions, so it can't be used to bother anyone else.
async function handlePushTest(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in first.' }, 401);
  const profile = await getDoc(env, `users/${user.uid}`);
  const subs = Array.isArray(profile?.data.pushSubs) ? profile.data.pushSubs : [];
  if (!subs.length)
    return json({ error: 'This device isn\'t registered for notifications yet. Turn them on above, then try again.' }, 409);
  await notifyUser(env, user.uid, {
    title: 'Pocket Advocate',
    body: 'Notifications are working. This is the only test message you\'ll get.',
    link: '/',
  });
  return json({ ok: true, devices: subs.length });
}

/**
 * POST /api/admin/login  Body: { email, password }
 * Eric's front door: his email plus a password (the ADMIN_PIN secret), checked
 * timing-safe and throttled per-IP exactly like the PIN path. Success mints an
 * admin session AND a trusted-device token, so the device stays signed in
 * between logins; the browser enforces a weekly re-login on top (auth.js).
 */
async function handleAdminLogin(request, env) {
  const cache = caches.default;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rlKey = new Request(`https://pin-throttle.internal/${encodeURIComponent(ip)}`);
  const prior = await cache.match(rlKey);
  const fails = prior ? parseInt(await prior.text(), 10) || 0 : 0;
  if (fails >= 5) return json({ error: 'Too many attempts. Try again later.' }, 429);

  const body = await request.json().catch(() => null);
  const email = (body?.email || '').trim().toLowerCase();
  const password = typeof body?.password === 'string' ? body.password : '';
  const expected = env.ADMIN_PIN || '';
  const adminUid = env.ADMIN_UID || '';

  await new Promise((r) => setTimeout(r, 400));

  const emailOk = env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase();
  if (!expected || !adminUid || !emailOk || !timingSafeEqual(password, expected)) {
    await cache.put(
      rlKey,
      new Response(String(fails + 1), { headers: { 'cache-control': 'max-age=900' } })
    );
    return json({ error: 'Wrong email or password.' }, 401);
  }

  await cache.delete(rlKey);
  const token = await mintCustomToken(env, adminUid);
  const deviceToken = await issueDeviceToken(env, adminUid, email);
  // The asset gate rides along with the sign-in that earned it, so the first
  // navigation to an admin page works without a second round trip.
  return withAdminCookie(env, json({ token, deviceToken }), adminUid);
}

// Body: { pin }. A private shortcut: the correct PIN mints a real admin
// session (custom token) so Eric can skip the email link. The PIN itself is a
// Worker secret (ADMIN_PIN) — never shipped to the browser. Failed attempts are
// throttled per-IP to blunt guessing; the response never hints that a numeric
// entry means anything, so the sign-in page gives nothing away.
async function handlePinLogin(request, env) {
  const cache = caches.default;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const rlKey = new Request(`https://pin-throttle.internal/${encodeURIComponent(ip)}`);
  const prior = await cache.match(rlKey);
  const fails = prior ? parseInt(await prior.text(), 10) || 0 : 0;
  if (fails >= 5) return json({ error: 'Invalid.' }, 429);

  const body = await request.json().catch(() => null);
  const pin = typeof body?.pin === 'string' ? body.pin : '';
  const expected = env.ADMIN_PIN || '';
  const adminUid = env.ADMIN_UID || '';

  // Slow automated guessing a little on every attempt.
  await new Promise((r) => setTimeout(r, 400));

  if (!expected || !adminUid || !timingSafeEqual(pin, expected)) {
    await cache.put(
      rlKey,
      new Response(String(fails + 1), { headers: { 'cache-control': 'max-age=900' } })
    );
    return json({ error: 'Invalid.' }, 401);
  }

  await cache.delete(rlKey);
  const token = await mintCustomToken(env, adminUid);
  // Trust this device, exactly as the password door already did.
  //
  // (Eric, 2026-08-21: "Give me easier logins jfc.")
  //
  // This door handed back a session and nothing else, so the browser had
  // nothing to come back with. The PIN is how he actually gets in, and it was
  // the only way in that asked again on every single visit, while the password
  // door - the one nobody uses - was trusted for six months.
  //
  // The email goes back with it because device-signin binds a token to the
  // address it was issued for and the browser has no way to know his. It only
  // ever reaches a caller that has already proved the PIN.
  const email = (env.ADMIN_EMAIL || '').trim().toLowerCase();
  const deviceToken = email ? await issueDeviceToken(env, adminUid, email) : '';
  return withAdminCookie(env, json({ token, deviceToken, email }), adminUid);
}

// ---- POST /api/auth/request-code + /api/auth/verify-code ----
// In-app email code login. Replaces magic links so sign-in completes entirely
// inside the installed app (iOS gives the Home-Screen PWA its own storage,
// separate from Safari — a link tapped in Mail opens Safari and never logs the
// app in, which is the infinite-relogin loop). A code typed in-app persists.
const CODE_TTL_MS = 10 * 60 * 1000;

async function handleRequestCode(request, env) {
  const body = await request.json().catch(() => null);
  const email = (body?.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, 400);

  // Eric signs in with his email and a password, not an emailed code. The
  // page shows a password box when the server says so; nothing about WHY is
  // revealed beyond that, and the password is still throttled server-side.
  if (env.ADMIN_EMAIL && email === env.ADMIN_EMAIL.toLowerCase())
    return json({ ok: true, mode: 'password' });

  const key = await sha256hex(email);
  const now = Date.now();
  const existing = await getDoc(env, `authCodes/${key}`);
  // Don't let someone spam a mailbox: at most one send per 30s.
  if (existing?.data.lastSentAt && now - new Date(existing.data.lastSentAt).getTime() < 30_000) {
    return json({ ok: true });
  }
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
  await patchDoc(env, `authCodes/${key}`, {
    email,
    codeHash: await sha256hex(`${code}:${email}`),
    expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
    attempts: 0,
    lastSentAt: new Date(now).toISOString(),
  });
  await sendEmail(env, {
    to: email,
    subject: `Your Pocket Advocate sign-in code: ${code}`,
    html: signinCodeEmail(code, env.PUBLIC_BASE_URL),
  });
  return json({ ok: true });
}

async function handleVerifyCode(request, env) {
  const body = await request.json().catch(() => null);
  const email = (body?.email || '').trim().toLowerCase();
  const code = (body?.code || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^\d{6}$/.test(code))
    return json({ error: 'Invalid or expired code.' }, 400);

  const key = await sha256hex(email);
  const doc = await getDoc(env, `authCodes/${key}`);
  if (!doc) return json({ error: 'Invalid or expired code.' }, 401);
  const d = doc.data;
  if (new Date(d.expiresAt).getTime() < Date.now()) {
    await deleteDoc(env, `authCodes/${key}`);
    return json({ error: 'Invalid or expired code.' }, 401);
  }
  if ((d.attempts || 0) >= 5) {
    await deleteDoc(env, `authCodes/${key}`);
    return json({ error: 'Too many attempts — request a new code.' }, 429);
  }
  if ((await sha256hex(`${code}:${email}`)) !== d.codeHash) {
    await patchDoc(env, `authCodes/${key}`, { ...d, attempts: (d.attempts || 0) + 1 });
    return json({ error: 'Invalid or expired code.' }, 401);
  }

  await deleteDoc(env, `authCodes/${key}`);
  // Existing users keep their Firebase uid (and all their data); brand-new ones
  // get a stable derived uid that custom-token sign-in auto-provisions.
  const uid = (await lookupUidByEmail(env, email)) || (await deriveUid(email));
  // Guarantee the app always has their email (custom-token accounts carry none).
  await patchDoc(env, `users/${uid}`, { email }, { mask: ['email'] });
  const token = await mintCustomToken(env, uid);
  // One code entry earns this device a token, so the next sign-in on it needs
  // only the email. The token is the second factor that keeps a known address
  // from being a credential on its own.
  const deviceToken = await issueDeviceToken(env, uid, email);
  return withAdminCookie(env, json({ token, deviceToken }), uid);
}

/**
 * POST /api/admin/session — mint the asset-gate cookie for a caller who has
 * already signed in and proved they are the admin. DELETE clears it.
 *
 * Needed because the browser can hold a live Firebase session with no cookie:
 * a returning device, or one whose cookie aged out. auth.js calls this the
 * moment it recognises an admin, so the next navigation to an admin page
 * already has what the gate wants.
 */
async function handleAdminSession(request, env) {
  if (request.method === 'DELETE') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json', 'set-cookie': ADMIN_COOKIE_CLEAR },
    });
  }
  if (request.method !== 'POST') return json({ error: 'Not found' }, 404);
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Not found' }, 404);
  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      'content-type': 'application/json',
      'set-cookie': await adminCookieHeader(env, admin.uid),
    },
  });
}

// A trusted device lasts six months of disuse; every sign-in renews it.
const DEVICE_TOKEN_TTL_DAYS = 180;

async function issueDeviceToken(env, uid, email) {
  const raw = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  const expiresAt = new Date(Date.now() + DEVICE_TOKEN_TTL_DAYS * 86_400_000);
  await patchDoc(env, `trustedDevices/${await sha256hex(raw)}`, {
    uid, email, createdAt: new Date(), lastUsedAt: new Date(), expiresAt,
  });
  return raw;
}

// ---- POST /api/auth/device-signin ----
// Body: { email, deviceToken }. Signs in without a code on a device that has
// already proven one. Only the hash is stored, and the token is bound to the
// email it was issued for, so it can never be replayed against another account.
async function handleDeviceSignin(request, env) {
  const body = await request.json().catch(() => null);
  const email = (body?.email || '').trim().toLowerCase();
  const deviceToken = (body?.deviceToken || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !/^[0-9a-f]{64}$/.test(deviceToken))
    return json({ error: 'This device needs a code.' }, 401);

  const key = await sha256hex(deviceToken);
  const doc = await getDoc(env, `trustedDevices/${key}`);
  if (!doc) return json({ error: 'This device needs a code.' }, 401);
  const d = doc.data;
  if (d.email !== email) return json({ error: 'This device needs a code.' }, 401);
  if (d.expiresAt && new Date(d.expiresAt).getTime() < Date.now()) {
    await deleteDoc(env, `trustedDevices/${key}`);
    return json({ error: 'This device needs a code.' }, 401);
  }

  await patchDoc(env, `trustedDevices/${key}`, {
    ...d,
    lastUsedAt: new Date(),
    expiresAt: new Date(Date.now() + DEVICE_TOKEN_TTL_DAYS * 86_400_000),
  });
  const token = await mintCustomToken(env, d.uid);
  return withAdminCookie(env, json({ token }), d.uid);
}

async function lookupUidByEmail(env, email) {
  const tok = await getAccessToken(env, 'https://www.googleapis.com/auth/cloud-platform');
  const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup', {
    method: 'POST',
    headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: [email] }),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return d.users?.[0]?.localId || null;
}

async function deriveUid(email) {
  return 'e' + (await sha256hex(`uid:${email}`)).slice(0, 31);
}

async function sha256hex(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Constant-time-ish string compare (length is not sensitive here).
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// ---- admin: the availability editor and case milestones ----

async function requireAdmin(request, env) {
  const user = await requireUser(request, env);
  if (!user) return null;
  // No round trip for a caller who cannot be him. Same reason as above: the
  // time a refusal takes is itself an answer.
  if (env.ADMIN_UID && user.uid !== env.ADMIN_UID) return null;
  const profile = await getDoc(env, `users/${user.uid}`);
  if (!profile || profile.data.role !== 'admin') return null;
  return user;
}

function slotIdFor(start) {
  // "2026-07-20_16-00" — same shape the seed script used.
  return start.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 16);
}

// POST /api/admin/slots  Body: { starts: [iso...], durationMin }
async function handleCreateSlots(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => null);
  const starts = body && Array.isArray(body.starts) ? body.starts : null;
  const durationMin = body && Number(body.durationMin) > 0 ? Number(body.durationMin) : 60;
  if (!starts || !starts.length || starts.length > 500)
    return json({ error: 'Provide 1–500 slot start times.' }, 400);

  // One batched write for the whole range — Workers cap outbound calls per
  // request, so 100+ individual creates would die mid-loop (learned live,
  // 2026-07-14). Invalid/past/out-of-window times are skipped up front.
  let invalid = 0;
  const entries = [];
  for (const iso of starts) {
    const start = new Date(iso);
    // A slot inside the booking lead window can never be booked by a client,
    // so opening one would only create dead inventory for the cron to sweep.
    if (Number.isNaN(start.getTime())) { invalid++; continue; }
    if (start.getTime() < Date.now() + LEAD_TIME_HOURS * 3600_000) { invalid++; continue; }
    if (windowProblem(iso, durationMin)) { invalid++; continue; }
    entries.push({
      path: `availability/${slotIdFor(start)}`,
      data: { start, durationMin, state: 'open' },
    });
  }
  const { created, skipped } = await batchCreate(env, entries);
  return json({ created, skipped: skipped + invalid });
}

// DELETE /api/admin/slots/:id — only slots nobody holds or has booked
async function handleDeleteSlot(request, env, url) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Not found' }, 404);
  const slotId = url.pathname.split('/').pop();
  if (!/^[\w-]{1,64}$/.test(slotId)) return json({ error: 'Bad slot id' }, 400);
  const slot = await getDoc(env, `availability/${slotId}`);
  if (!slot) return json({ ok: true });
  const holdActive =
    slot.data.state === 'held' &&
    slot.data.holdExpiresAt &&
    new Date(slot.data.holdExpiresAt) > new Date();
  if (slot.data.state === 'booked' || holdActive)
    return json({ error: 'That slot is booked or mid-checkout — it cannot be deleted.' }, 409);
  await deleteDoc(env, `availability/${slotId}`);
  return json({ ok: true });
}

// POST /api/admin/case-update  Body: { caseId, action, joinLink? }
async function handleCaseUpdate(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Not found' }, 404);
  const { caseId, action, joinLink } = await request.json().catch(() => ({}));
  if (typeof caseId !== 'string' || !/^[\w-]{1,64}$/.test(caseId))
    return json({ error: 'Bad case id' }, 400);
  const doc = await getDoc(env, `cases/${caseId}`);
  if (!doc) return json({ error: 'No such case' }, 404);
  const now = new Date();

  if (action === 'join-link') {
    if (typeof joinLink !== 'string' || joinLink.length > 500)
      return json({ error: 'Bad link' }, 400);
    await patchDoc(env, `cases/${caseId}`, { appointment: { joinLink: joinLink || null } }, {
      mask: ['appointment.joinLink'],
    });
  } else if (action === 'recording-uploaded') {
    // The call happened: start the report clock. Admin-side the deadline is a
    // strict 7 calendar days; the client is told "7 business days, some take
    // slightly longer" (Eric's leeway, 2026-07-13).
    if (doc.data.status === 'closed') return json({ error: 'Case is closed.' }, 409);
    const alreadyStarted = !!doc.data.reportDueAt;
    const fields = { reportDueAt: new Date(now.getTime() + 7 * 86_400_000) };
    if (doc.data.status !== 'delivered') fields.status = 'awaiting_report';
    await patchDoc(env, `cases/${caseId}`, fields, { mask: Object.keys(fields) });
    if (!alreadyStarted) {
      await sendEmail(env, {
        to: doc.data.clientEmail,
        subject: 'Great meeting — your report is on the way',
        html: `<p>It was great talking with you today. Your discussion is done,
          and the recording will be in your case file for you to revisit anytime.</p>
          <p>I'm now putting together your written report. Expect it within
          <strong>7 business days</strong> — some reports take slightly longer
          depending on complexity, and yours will be worth the care.</p>
          <p>When the report lands, you'll have 48 hours to look it over and ask
          any questions in your case chat before the case wraps up. Your file —
          report, recording, everything — stays yours forever either way.</p>
          <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
      });
    }
  } else if (action === 'report-uploaded') {
    if (doc.data.status === 'closed') return json({ error: 'Case is closed.' }, 409);
    await patchDoc(env, `cases/${caseId}`, { status: 'delivered', reportDeliveredAt: now }, {
      mask: ['status', 'reportDeliveredAt'],
    });
    await sendEmail(env, {
      to: doc.data.clientEmail,
      subject: 'Your Pocket Advocate report is ready',
      html: `<p>Your written report is in your case file — yours to download,
        print, and keep forever. Share it with your care team.</p>
        <p>Take a couple of days to read it over — the case chat stays open for
        48 hours, so ask me anything it raises while it's fresh.</p>
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
    });
  } else if (action === 'confirm-request') {
    const appt = doc.data.appointment || {};
    if (!appt.requested) return json({ error: 'This appointment is not a pending request.' }, 409);
    await patchDoc(env, `cases/${caseId}`, {
      appointment: { ...appt, requested: false },
    }, { mask: ['appointment'] });
    await sendEmail(env, {
      to: doc.data.clientEmail,
      subject: 'Your requested time is confirmed',
      html: `<p>Good news — the time you asked for works. Your discussion is booked for:</p>
        ${whenHtml(new Date(appt.start), doc.data.clientTz)}
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
    });
    await notifyUser(env, doc.data.clientUid, {
      title: 'Pocket Advocate',
      body: 'Your requested time is confirmed.',
      link: '/case.html',
    });
  } else if (action === 'deny-request') {
    const appt = doc.data.appointment || {};
    if (!appt.requested) return json({ error: 'This appointment is not a pending request.' }, 409);
    await patchDoc(env, `cases/${caseId}`, {
      appointment: { ...appt, requested: false },
      needsReschedule: true,
    }, { mask: ['appointment', 'needsReschedule'] });
    await sendEmail(env, {
      to: doc.data.clientEmail,
      subject: 'That time did not work — let us find another',
      html: `<p>I'm sorry — the time you asked for isn't one I can make. Nothing is lost:
        your case is open and paid, and I'll offer you another time shortly.</p>
        <p>If a particular window suits you better, message me in your case chat and
        I'll work around it.</p>
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
    });
    await notifyUser(env, doc.data.clientUid, {
      title: 'Pocket Advocate',
      body: 'Your requested time needs changing — open your case.',
      link: '/case.html',
    });
  } else if (action === 'close') {
    await patchDoc(env, `cases/${caseId}`, { status: 'closed', closedAt: now }, {
      mask: ['status', 'closedAt'],
    });
  } else {
    return json({ error: 'Unknown action' }, 400);
  }
  return json({ ok: true });
}

async function releaseHold(env, session) {
  const slotId = session.metadata && session.metadata.slotId;
  if (!slotId) return;
  const slot = await getDoc(env, `availability/${slotId}`);
  if (slot && slot.data.state === 'held' && slot.data.heldBySession === session.id) {
    // A slot I created by hand for one client goes away when the sale falls
    // through — it was never meant to be public inventory.
    if (slot.data.adminCreated) await deleteDoc(env, `availability/${slotId}`);
    else
      await patchDoc(env, `availability/${slotId}`, {
        state: 'open',
        holdExpiresAt: null,
        heldByUid: null,
        heldBySession: null,
      }, { mask: ['state', 'holdExpiresAt', 'heldByUid', 'heldBySession'] });
  }
  // A follow-up the client started buying and walked away from.
  if (session.metadata?.kind === 'followup' && session.metadata.caseId) {
    const caseDoc = await getDoc(env, `cases/${session.metadata.caseId}`);
    if (caseDoc?.data.pendingFollowUp?.sessionId === session.id)
      await patchDoc(env, `cases/${session.metadata.caseId}`, { pendingFollowUp: null }, {
        mask: ['pendingFollowUp'],
      });
  }
  // An admin-priced session that was never paid: clear the client's pay prompt.
  if (session.metadata?.kind === 'extra' && session.metadata.caseId) {
    const caseDoc = await getDoc(env, `cases/${session.metadata.caseId}`);
    if (caseDoc?.data.pendingExtra?.sessionId === session.id)
      await patchDoc(env, `cases/${session.metadata.caseId}`, { pendingExtra: null }, {
        mask: ['pendingExtra'],
      });
  }
}

// ---- admin scheduling: reschedule, paid follow-up, or a custom-priced session ----

const MT_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Etc/GMT+7', weekday: 'long', month: 'long', day: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

/** A usable IANA zone string, or null. */
function validTz(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 60) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return null; }
}

/**
 * Dual-zone time line for client emails (Eric, 2026-07-15): the client's
 * local time leads, Eric's MST rides underneath. Falls back to MST-only
 * when the zone is unknown or IS Mountain time.
 */
function whenHtml(start, tz) {
  const mst = `${MT_FMT.format(start)} MST`;
  const zone = validTz(tz);
  if (!zone) return `<p><strong>${mst}</strong></p>`;
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  }).format(start);
  if (local.replace(/\s/g, '') === `${MT_FMT.format(start)}`.replace(/\s/g, '')) return `<p><strong>${mst}</strong></p>`;
  return `<p><strong>${local}</strong> (your time)<br>
    <span style="color:#666;">${mst} my time</span></p>`;
}

/**
 * When a bought follow-up stops being redeemable.
 *
 * The month runs from the purchase when there is one, and from the first
 * discussion otherwise. A follow-up bought three weeks after the call would
 * otherwise arrive with nine days on it, which is not what anyone just paid
 * $75 for.
 */
function followUpBase(c) {
  if (c.addOnFollowUpAt) return new Date(c.addOnFollowUpAt);
  return c.appointment?.start ? new Date(c.appointment.start) : null;
}

function followUpExpiry(c) {
  const base = followUpBase(c);
  return base ? new Date(base.getTime() + FOLLOWUP_EXPIRY_DAYS * 86_400_000) : null;
}

/**
 * POST /api/admin/schedule
 * Body: { caseId, mode: 'reschedule'|'followup'|'charge',
 *         slotId? | customStart? (ISO), customDurationMin?, pct?, tagline? }
 *
 * Admin scheduling has no restriction on WHEN. Picking an open slot off the
 * calendar is the convenient path; `customStart` books any wall-clock time at
 * all and creates the availability doc on demand. The 72h lead, the 1.5-week
 * horizon, the 8am–6pm window and the must-already-be-open rule exist to keep
 * client self-service booking sane — none of them should stop me from putting
 * a client where the two of us actually agreed to meet.
 */
async function handleAdminSchedule(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400);
  const { caseId, customStart, customDurationMin, mode, pct, tagline } = body;
  if (typeof caseId !== 'string' || !/^[\w-]{1,64}$/.test(caseId))
    return json({ error: 'Bad case id' }, 400);
  if (!['reschedule', 'followup', 'charge'].includes(mode))
    return json({ error: 'Bad mode' }, 400);

  const caseDoc = await getDoc(env, `cases/${caseId}`);
  if (!caseDoc) return json({ error: 'No such case' }, 404);
  const c = caseDoc.data;

  const now = new Date();

  // Resolve the slot — an existing one, or a brand new one at a time I typed.
  let slotId;
  let slot;
  if (typeof customStart === 'string' && customStart) {
    const at = new Date(customStart);
    if (Number.isNaN(at.getTime())) return json({ error: 'Pick a valid date and time.' }, 400);
    const mins = Number(customDurationMin) > 0 ? Math.min(Math.round(Number(customDurationMin)), 480) : 60;
    slotId = slotIdFor(at);
    slot = await getDoc(env, `availability/${slotId}`);
    if (!slot) {
      // `adminCreated` marks this as mine, not public inventory: rescheduling
      // away from it deletes it instead of leaving an odd-hour opening on the
      // client picker.
      await patchDoc(env, `availability/${slotId}`,
        { start: at, durationMin: mins, state: 'open', adminCreated: true },
        { mustNotExist: true });
      slot = await getDoc(env, `availability/${slotId}`);
      if (!slot) return json({ error: "Couldn't open that time — try again." }, 409);
    }
  } else {
    if (typeof body.slotId !== 'string' || !/^[\w-]{1,64}$/.test(body.slotId))
      return json({ error: 'Bad slot id' }, 400);
    slotId = body.slotId;
    slot = await getDoc(env, `availability/${slotId}`);
    if (!slot) return json({ error: 'No such slot' }, 404);
  }

  const holdExpired =
    slot.data.state === 'held' &&
    slot.data.holdExpiresAt &&
    new Date(slot.data.holdExpiresAt) < now;
  // The only genuine conflict is someone ELSE sitting in that time. A slot this
  // same case already occupies is fine to re-take.
  if (slot.data.state !== 'open' && !holdExpired && slot.data.caseId !== caseId)
    return json({ error: 'Another client is already booked at that time.' }, 409);
  const start = new Date(slot.data.start);
  const durationMin = slot.data.durationMin || 60;
  const when = `${MT_FMT.format(start)} MST`;

  const bookSlot = () =>
    patchDoc(env, `availability/${slotId}`, {
      state: 'booked', caseId, holdExpiresAt: null, heldByUid: null, heldBySession: null,
    }, { mask: ['state', 'caseId', 'holdExpiresAt', 'heldByUid', 'heldBySession'] });

  if (mode === 'reschedule') {
    // Free whatever slot(s) this case previously occupied, then take the new one.
    // A slot I invented for this client isn't public inventory — delete it
    // rather than reopening an odd-hour time on the client picker.
    const oldSlots = await queryDocs(env, 'availability', [['caseId', 'EQUAL', caseId]], 5);
    for (const s of oldSlots) {
      if (s.id === slotId) continue;
      if (s.data.adminCreated) await deleteDoc(env, `availability/${s.id}`);
      else
        await patchDoc(env, `availability/${s.id}`, { state: 'open', caseId: null }, {
          mask: ['state', 'caseId'],
        });
    }
    await bookSlot();
    await patchDoc(env, `cases/${caseId}`, {
      appointment: { ...c.appointment, start, durationMin },
      needsReschedule: null,
    }, { mask: ['appointment', 'needsReschedule'] });
    await sendEmail(env, {
      to: c.clientEmail,
      subject: 'Your Pocket Advocate appointment moved',
      html: `<p>Your discussion with me is now scheduled for:</p>
        ${whenHtml(start, c.clientTz)}
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
    });
    return json({ ok: true, scheduled: when });
  }

  if (mode === 'followup') {
    if (!c.addOnFollowUp) return json({ error: 'This case has no follow-up session on it.' }, 409);
    if (c.followUp) return json({ error: 'The follow-up is already scheduled.' }, 409);
    const expiry = followUpExpiry(c);
    if (expiry && now > expiry)
      return json({ error: `The follow-up window expired ${MT_FMT.format(expiry)}. Use "charge" at 0% to honor it anyway.` }, 409);
    await bookSlot();
    await patchDoc(env, `cases/${caseId}`, {
      followUp: {
        start, durationMin, slotId, kind: 'followup',
        label: 'Follow-up discussion', amountCents: 0, scheduledAt: now,
      },
    }, { mask: ['followUp'] });
    await sendEmail(env, {
      to: c.clientEmail,
      subject: 'Your follow-up session is booked',
      html: `<p>Your follow-up discussion with me is scheduled:</p>
        ${whenHtml(start, c.clientTz)}
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
    });
    return json({ ok: true, scheduled: when });
  }

  // mode === 'charge' — a custom-priced session (a percentage of their rate).
  if (!CHARGE_PCTS.includes(pct)) return json({ error: 'Pick a rate (0–150% in 25% steps).' }, 400);
  const label =
    typeof tagline === 'string' && tagline.trim()
      ? tagline.trim().slice(0, 120)
      : 'Advocacy Session';
  // A share of what THEY paid. A case from before this field existed falls
  // back to the current rate, which since rates have only come down errs in the
  // client's favour rather than against them.
  const amountCents = Math.round((pct * (c.caseRateCents || CASE_PRICE_CENTS)) / 100);

  if (amountCents === 0) {
    await bookSlot();
    await patchDoc(env, `cases/${caseId}`, {
      followUp: {
        start, durationMin, slotId, kind: 'extra',
        label, amountCents: 0, scheduledAt: now,
      },
    }, { mask: ['followUp'] });
    await sendEmail(env, {
      to: c.clientEmail,
      subject: 'A session with me is booked',
      html: `<p>${escHtml(label)} — no charge.</p>
        ${whenHtml(start, c.clientTz)}
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
    });
    return json({ ok: true, scheduled: when });
  }

  // Paid: hold the slot for 24h and send the client to Stripe.
  const holdExpiresAt = new Date(now.getTime() + 24 * 3600_000);
  const held = await patchDoc(
    env,
    `availability/${slotId}`,
    { state: 'held', holdExpiresAt, heldByUid: c.clientUid },
    { ifUpdateTime: slot.updateTime, mask: ['state', 'holdExpiresAt', 'heldByUid'] }
  );
  if (!held) return json({ error: 'That slot was just taken. Pick another.' }, 409);

  const session = await stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: c.clientEmail || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: { name: label, description: `${when} with me` },
        },
      },
    ],
    success_url: `${env.PUBLIC_BASE_URL}/case.html?paid=1`,
    cancel_url: `${env.PUBLIC_BASE_URL}/case.html`,
    expires_at: Math.floor(holdExpiresAt.getTime() / 1000),
    metadata: { kind: 'extra', caseId, slotId, uid: c.clientUid, tagline: label, pct: String(pct) },
  });
  await patchDoc(env, `availability/${slotId}`, { heldBySession: session.id }, {
    mask: ['heldBySession'],
  });
  await patchDoc(env, `cases/${caseId}`, {
    pendingExtra: {
      slotId, start, durationMin, amountCents, label,
      sessionId: session.id, url: session.url, createdAt: now,
    },
  }, { mask: ['pendingExtra'] });
  await sendEmail(env, {
    to: c.clientEmail,
    subject: 'I scheduled a session for you — payment needed to confirm',
    html: `<p>${escHtml(label)} — $${(amountCents / 100).toFixed(2)}.</p>
      ${whenHtml(start, c.clientTz)}
      <p>The time is held for 24 hours. <a href="${session.url}">Pay to confirm</a>,
      or open <a href="${env.PUBLIC_BASE_URL}/case.html">your case page</a>.</p>`,
  });
  return json({ ok: true, scheduled: when, checkoutUrl: session.url, amountCents });
}

/** Webhook: an admin-priced session was paid — book it into the case. */
async function confirmExtraSession(env, session) {
  const m = session.metadata || {};
  if (!m.caseId || !m.slotId) return;
  const caseDoc = await getDoc(env, `cases/${m.caseId}`);
  if (!caseDoc) return;
  if (caseDoc.data.followUp?.sessionId === session.id) return; // webhook retry
  const c = caseDoc.data;

  const slot = await getDoc(env, `availability/${m.slotId}`);
  const start = slot ? new Date(slot.data.start) : new Date(c.pendingExtra?.start);
  const durationMin = slot ? slot.data.durationMin || 60 : c.pendingExtra?.durationMin || 60;
  await patchDoc(env, `availability/${m.slotId}`, {
    state: 'booked', caseId: m.caseId, holdExpiresAt: null, heldByUid: null, heldBySession: null,
  }, { mask: ['state', 'caseId', 'holdExpiresAt', 'heldByUid', 'heldBySession'] });
  const payments = Array.isArray(c.extraPayments) ? c.extraPayments : [];
  payments.push({
    amountCents: session.amount_total || 0,
    label: m.tagline || 'Advocacy Session',
    sessionId: session.id,
    at: new Date(),
  });
  const okX = await patchDoc(env, `cases/${m.caseId}`, {
    followUp: {
      start, durationMin, slotId: m.slotId, kind: 'extra',
      label: m.tagline || 'Advocacy Session',
      amountCents: session.amount_total || 0,
      sessionId: session.id, scheduledAt: new Date(),
    },
    pendingExtra: null,
    extraPayments: payments,
  }, { mask: ['followUp', 'pendingExtra', 'extraPayments'], ifUpdateTime: caseDoc.updateTime });
  // Lost the lock; re-run from the top, the sessionId check makes it idempotent.
  if (okX === false) return confirmExtraSession(env, session);
  await sendEmail(env, {
    to: c.clientEmail,
    subject: 'Your session is confirmed',
    html: `<p>Payment received — you're booked:</p>
      ${whenHtml(start, c.clientTz)}
      <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
  });
}

/**
 * Cron: warn clients one week before an unscheduled follow-up session expires
 * (30 days after the first discussion). One email, ever, per case.
 */
export async function runFollowUpWarnings(env, now = Date.now()) {
  const rows = await queryDocs(env, 'cases', [['addOnFollowUp', 'EQUAL', true]], 100);
  for (const row of rows) {
    const c = row.data;
    if (c.followUp || c.pendingExtra || c.followUpExpiryWarned) continue;
    // The SAME clock the scheduler enforces (followUpExpiry: purchase date
    // when there is one, first discussion otherwise). This used to count from
    // the appointment alone, so a follow-up bought late was never warned at
    // all - the cron thought it had already lapsed while the scheduler would
    // happily book it - and one bought early was warned with a date weeks
    // ahead of the real one. A deadline email with the wrong deadline is
    // worse than none. (Post-2.2 audit, 2026-08-21.)
    const expiry = followUpExpiry(c);
    if (!expiry) continue;
    const expires = expiry.getTime();
    if (now >= expires) continue; // already lapsed — no email after the fact
    if (expires - now > FOLLOWUP_WARN_DAYS * 86_400_000) continue; // not yet warning time
    if (c.clientEmail) {
      await sendEmail(env, {
        to: c.clientEmail,
        // A grandfathered case never bought anything, so the email does not
        // say they did. What both kinds share is the part that matters: it is
        // theirs, and it has a date on it.
        subject: 'Your follow-up session expires in one week',
        html: `<p>Your case includes a follow-up discussion, and it expires:</p>
          ${whenHtml(new Date(expires), c.clientTz)}
          <p>To use it, message me in your case chat and I'll get it scheduled.</p>
          <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
      });
    }
    await patchDoc(env, `cases/${row.id}`, { followUpExpiryWarned: true }, {
      mask: ['followUpExpiryWarned'],
    });
  }
}

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function safeJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
