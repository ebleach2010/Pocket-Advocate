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
import { stripePost, verifyWebhook } from './stripe.js';
import {
  slotTimingProblem, windowProblem, HOLD_MINUTES,
  LEAD_TIME_HOURS, MAX_LEAD_TIME_HOURS,
} from './schedule.js';
import { sendEmail, homeScreenTips, signinCodeEmail } from './email.js';
import { notifyUser } from './push.js';
import { runAnalysis, runQuestion, runDraft, runRecap, markPending, runQueuedAnalyses, runStyleDistill } from './advisor.js';

// These build the real Stripe line items. Three browser files mirror them for
// display — public/js/book.js, public/js/subscribe.js, public/js/admin-case.js
// — and every price shown there is derived, never typed. Current rates (Eric,
// 2026-08-20): $275 per case, a $75 follow-up session bought separately, and
// $50/mo chat. Change a rate here and change it in those three, or the page
// quotes one number and the card is charged another (which is exactly what
// happened after the $150 experiment).
const CASE_PRICE_CENTS = 27500;
// The follow-up is a real add-on: a second discussion on the same case, offered
// at checkout and priced on its own. It is NOT included in the case fee.
const ADDON_PRICE_CENTS = 7500;
const SUB_PRICE_CENTS = 5000;
// Follow-up sessions expire one month after the first discussion (Eric,
// 2026-07-13); clients get one warning email a week before the deadline.
const FOLLOWUP_EXPIRY_DAYS = 30;
const FOLLOWUP_WARN_DAYS = 7;
// Admin-priced sessions: percentage of the $275 case rate, 25% steps.
const CHARGE_PCTS = [0, 25, 50, 75, 100, 125, 150];
const METHODS = ['phone', 'video'];
const REQUIRED_ACKS = ['disclaimer', 'privacy', 'recording'];
// A chat message this old with no in-app read gets an email nudge (spec: batched).
const DIGEST_MIN_AGE_MS = 10 * 60_000;

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
      if (url.pathname === '/api/chat/recap' && request.method === 'POST')
        return await handleChatRecap(request, env, ctx);
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
      if (url.pathname === '/api/review' && request.method === 'POST')
        return await handleReviewSubmit(request, env);
      if (url.pathname === '/api/reviews' && request.method === 'GET')
        return await handleReviewsPublic(env);
      if (url.pathname === '/api/reviews/admin')
        return await handleReviewsAdmin(request, env);
      if (url.pathname === '/api/version' && request.method === 'GET')
        return json({ tag: BUILD_TAG, version: VERSION });
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(`${url.pathname}:`, err.stack || err);
      return json({ error: 'Internal error' }, 500);
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
      ctx.waitUntil(cleanupStaleSlots(env));
      ctx.waitUntil(repairMissingCaseEmails(env));
      ctx.waitUntil(closeDeliveredCases(env));
    }
    ctx.waitUntil(runQueuedAnalyses(env));
  },
};

// Bumped on each meaningful deploy; served at GET /api/version so a human can
// confirm which build is live without guessing about caches.
const BUILD_TAG = 'v2026-08-20-folder';
// Every merge to main is a version. The notes themselves live in
// public/js/changelog.js, next to the code that draws the card; this constant
// is here so /api/version can say which release is live without the caller
// having to load a client module to find out.
const VERSION = '2.2';

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
        status: 'closed', closedAt: new Date(), closedBy: 'review-window',
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
 * Stripe line items for a case, plus the follow-up session when the client
 * bought one at checkout. Two separate lines on purpose: the receipt should
 * show exactly what was paid for, and the follow-up is its own product at its
 * own price, never a discount folded into the case fee.
 */
function caseLineItems(addOnFollowUp) {
  const items = [
    {
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: CASE_PRICE_CENTS,
        product_data: { name: 'Advocacy Case', description: 'Live discussion + written report' },
      },
    },
  ];
  if (addOnFollowUp)
    items.push({
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: ADDON_PRICE_CENTS,
        product_data: {
          name: 'Follow-up session',
          description: 'A second discussion on this same case',
        },
      },
    });
  return items;
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
  const { slotId, requestedStart, method, phone, addOnFollowUp, acks } = body;
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
    user, identity, requestedStart, method, phone, addOnFollowUp, acks, clientTz,
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

  const lineItems = caseLineItems(addOnFollowUp);

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
      addOnFollowUp: addOnFollowUp ? '1' : '0',
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
  const { user, identity, requestedStart, method, phone, addOnFollowUp, acks, clientTz } = o;
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

  const now = new Date();
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  const lineItems = caseLineItems(addOnFollowUp);
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
      addOnFollowUp: addOnFollowUp ? '1' : '0',
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

  if (event.type === 'checkout.session.completed') {
    if (obj.mode === 'subscription') await activateSubscription(env, obj);
    else if (obj.metadata?.kind === 'extra') await confirmExtraSession(env, obj);
    else await createCaseFromSession(env, obj);
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
//   • ADMIN-directed nudges (client wrote): stay prompt, so Eric hears quickly
//     even without push.
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
      } else {
        // Eric is the recipient — prompt.
        if (env.ADMIN_EMAIL) {
          await sendEmail(env, {
            to: env.ADMIN_EMAIL,
            subject: 'New message on Pocket Advocate',
            html: `<p>You have an unread client message.</p>
              <p><a href="${env.PUBLIC_BASE_URL}/admin-chats.html">Open the chat</a></p>`,
          });
        }
      }
      await patchDoc(env, `${coll}/${row.id}`, { lastMessage: { emailed: true } }, {
        mask: ['lastMessage.emailed'],
      });
    }
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

  await patchDoc(
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
      addOnFollowUp: m.addOnFollowUp === '1',
      forms: Object.fromEntries(
        REQUIRED_ACKS.map((f) => [f, typeof acks[f] === 'number' ? new Date(acks[f]) : null])
      ),
      files: [],
      reportDueAt: null, // set when the call ends (Phase 2)
      stripe: {
        sessionId: session.id,
        paymentIntentId: session.payment_intent || null,
        amountTotal: session.amount_total || null,
      },
    },
    { mustNotExist: true }
  );

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
        body: `${m.name || 'A client'} requested ${mt} MST.`,
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
  if (kind === 'case') {
    const doc = await getDoc(env, `cases/${id}`);
    if (!doc) return json({ error: 'Not found' }, 404);
    clientUid = doc.data.clientUid;
    adminLink = `/admin-case.html?id=${id}`;
    clientLink = `/case.html?id=${id}`;
  } else {
    const sub = await getDoc(env, `subscriptions/${id}`);
    if (!sub) return json({ error: 'Not found' }, 404);
    clientUid = id;
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
    const admins = await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 5);
    for (const a of admins) {
      await notifyUser(env, a.id, {
        title: 'Pocket Advocate',
        body: 'New message from a client.',
        link: adminLink,
      });
    }
  } else if (isAdmin) {
    // Eric wrote — the advisor should fold his side in too, so its read stays
    // current through the whole exchange, not just the client's half.
    refreshAdvisor(env, ctx, kind, id);
    await notifyUser(env, clientUid, {
      title: 'Pocket Advocate',
      body: 'You have a new message from me.',
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
const CHAT_REACTIONS = {
  seen: { label: 'Eric has seen your message', push: 'Eric has seen your message.' },
  reading: { label: 'Eric is reading…', push: 'Eric is reading your message.' },
  research: { label: 'Eric is doing research…', push: 'Eric is doing research on your question.' },
  thinking: { label: 'Eric is thinking about your situation…', push: 'Eric is thinking about your situation.' },
  history: { label: 'Eric is reviewing your history…', push: 'Eric is reviewing your history.' },
  labs: { label: 'Eric is reviewing your labs / chart notes', push: 'Eric is reviewing your labs and chart notes.' },
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

/** How long a message stays editable by its author. */
const EDIT_WINDOW_MS = 3 * 60 * 1000;

/**
 * Resolve a chat thread and check the caller belongs in it. Returns
 * { clientUid, link, path, isAdmin } or { error, code }.
 */
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

  return { clientUid, link, isAdmin, path: `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/chat/${msgId}` };
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
    await patchDoc(env, ctx.path, { reaction: null }, { mask: ['reaction'] });
    return json({ ok: true, reaction: null });
  }

  const already = msg.data.reaction?.id === reaction;
  const record = isEmoji
    ? { id: reaction, emoji: EMOJI_REACTIONS[reaction], kind: 'emoji', by: user.uid, at: new Date() }
    : { id: reaction, label: CHAT_REACTIONS[reaction].label, kind: 'status', by: user.uid, at: new Date() };
  await patchDoc(env, ctx.path, { reaction: record }, { mask: ['reaction'] });

  // Re-applying the same reaction is not news — their phone already said it.
  // Changing it is, so that one notifies. Notify whoever wrote the message.
  const target = msg.data.from;
  if (!already && target && target !== user.uid) {
    const push = isEmoji
      ? `${ctx.isAdmin ? 'Eric' : 'Your client'} reacted ${EMOJI_REACTIONS[reaction]} to your message.`
      : CHAT_REACTIONS[reaction].push;
    await notifyUser(env, target, { title: 'Pocket Advocate', body: push, link: ctx.link });
  }
  return json({ ok: true, reaction, notified: !already });
}

/**
 * POST /api/chat/recap  Body: { kind: 'case'|'sub', id }
 * Either participant may ask for the recap; the client's open chat is what
 * normally triggers it. All the real conditions (5 minutes unanswered, long
 * enough to need one, not already done) are enforced in runRecap, so a caller
 * can't spend money by hammering this.
 */
async function handleChatRecap(request, env, ctx) {
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
  if (!isAdmin && user.uid !== clientUid)
    return json({ error: 'Not your thread' }, 403);

  // force: Eric's "recap for them, now" — skips the 5-minute wait and the
  // length threshold, and regenerates over an existing recap. Admin only.
  return keepaliveRun(ctx, runRecap(env, kind, id, { force: !!body?.force && isAdmin }));
}

/**
 * POST /api/chat/pass  Body: { kind: 'case'|'sub', id, msgId, pass: bool }
 *
 * Passing on a question. Either side can flag a message from the other person
 * as PASS: "not answering that one, please don't ask why." The mark is visible
 * to both, the asker gets one quiet notification, and nobody owes anybody an
 * explanation. Only whoever set the flag can take it back. Worker-written for
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
        body: `${ctx.isAdmin ? 'Eric' : 'Your client'} passed on your question. Moving on.`,
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
function keepaliveRun(ctx, work) {
  const enc = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  ctx.waitUntil((async () => {
    const tick = setInterval(() => { writer.write(enc.encode(' ')).catch(() => {}); }, 10_000);
    let body = '{"ok":true}';
    try {
      await work;
    } catch (err) {
      body = JSON.stringify({ ok: false, error: String(err.message || err) });
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
  if (!user) return json({ error: 'Sign in required' }, 401);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Admin only' }, 403);

  const kind = url.searchParams.get('kind') === 'sub' ? 'sub' : 'case';
  const id = url.searchParams.get('id') || '';
  if (!/^[\w-]{1,64}$/.test(id)) return json({ error: 'Bad id' }, 400);

  const parent = kind === 'case' ? 'cases' : 'subscriptions';
  // One round of reads for the whole panel. Every one of them degrades to
  // empty: a case with no advisor state, no notes and no glossary is the
  // normal first-visit state, not an error.
  const [state, qa, knowledge, notesDoc, style] = await Promise.all([
    getDoc(env, `${parent}/${id}/advisor/state`).catch(() => null),
    listDocs(env, `${parent}/${id}/advisor/state/qa`, { pageSize: 20, orderBy: 'at' }).catch(() => []),
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
  const { readFiles, pendingMedia, ...publicState } = state?.data || {};
  return json({
    state: publicState,
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
    dx: {
      working: state?.data.workingDx || '',
      override: typeof state?.data.dxOverride === 'string' ? state.data.dxOverride : null,
    },
    differential: Array.isArray(state?.data.differential) ? state.data.differential : [],
    // Dismissed corrections stay on the doc, so the next analysis knows not to
    // raise them again, but they never come back out here: dismissed means the
    // chat stops marking that message.
    corrections: (Array.isArray(state?.data.corrections) ? state.data.corrections : [])
      .filter((c) => c && !c.dismissed),
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
  if (!['delivered', 'closed'].includes(doc.data.status))
    return json({ error: 'This case has not been delivered yet.' }, 409);

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
  if (!user) return json({ error: 'Sign in required' }, 401);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Admin only' }, 403);

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
  if (!user) return json({ error: 'Sign in required' }, 401);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Admin only' }, 403);

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
  if (!user) return json({ error: 'Sign in required' }, 401);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Admin only' }, 403);

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
 *
 * Admin only, and invisible to clients by rule — see the `advisor` match in
 * firestore.rules. The model calls run in ctx.waitUntil and land in Firestore,
 * so the panel just watches the document rather than holding a request open
 * for a long Opus turn.
 */
async function handleAdvisor(request, env, ctx) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in required' }, 401);
  const profile = await getDoc(env, `users/${user.uid}`);
  if (profile?.data.role !== 'admin') return json({ error: 'Admin only' }, 403);

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
    }
    await patchDoc(env, statePath, { draft: null, draftStatus: null }, {
      mask: ['draft', 'draftStatus'],
    });
    if (!changed) return json({ ok: true, learned: false });
    return keepaliveRun(ctx, runStyleDistill(env, kind, id));
  }

  if (action === 'analyze') {
    // Don't stack a second Opus run on top of a live one.
    const state = await getDoc(env, `${parent}/${id}/advisor/state`);
    const startedAt = state?.data.startedAt ? new Date(state.data.startedAt).getTime() : 0;
    if (state?.data.status === 'running' && Date.now() - startedAt < 12 * 60_000)
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
    return keepaliveRun(ctx, runAnalysis(env, kind, id, media));
  }

  if (action === 'draft') {
    const instruction = typeof body?.instruction === 'string' ? body.instruction.slice(0, 1000) : '';
    // revise: rewrite the existing draft per the instruction instead of
    // starting fresh; `base` carries the draft box's current text so a
    // revision builds on Eric's in-place edits.
    const revise = body?.revise === true;
    const base = revise && typeof body?.base === 'string' ? body.base.slice(0, 4000) : '';
    return keepaliveRun(ctx, runDraft(env, kind, id, instruction, revise, base));
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
    return keepaliveRun(ctx, runQuestion(env, kind, id, qaId, question, attachment));
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
  return json({ token, deviceToken });
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
  return json({ token });
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
  return json({ token, deviceToken });
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
  return json({ token });
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
  if (!admin) return json({ error: 'Admin only' }, 403);
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
  if (!admin) return json({ error: 'Admin only' }, 403);
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
  if (!admin) return json({ error: 'Admin only' }, 403);
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

function followUpExpiry(c) {
  const base = c.appointment?.start ? new Date(c.appointment.start) : null;
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
  if (!admin) return json({ error: 'Admin only' }, 403);
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

  // mode === 'charge' — a custom-priced session (percentage of the $275 rate).
  if (!CHARGE_PCTS.includes(pct)) return json({ error: 'Pick a rate (0–150% in 25% steps).' }, 400);
  const label =
    typeof tagline === 'string' && tagline.trim()
      ? tagline.trim().slice(0, 120)
      : 'Advocacy Session';
  const amountCents = Math.round((pct * CASE_PRICE_CENTS) / 100); // pct% of the case rate

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
  await patchDoc(env, `cases/${m.caseId}`, {
    followUp: {
      start, durationMin, slotId: m.slotId, kind: 'extra',
      label: m.tagline || 'Advocacy Session',
      amountCents: session.amount_total || 0,
      sessionId: session.id, scheduledAt: new Date(),
    },
    pendingExtra: null,
    extraPayments: payments,
  }, { mask: ['followUp', 'pendingExtra', 'extraPayments'] });
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
    const base = c.appointment?.start ? new Date(c.appointment.start).getTime() : null;
    if (!base || now < base) continue; // first discussion hasn't happened yet
    const expires = base + FOLLOWUP_EXPIRY_DAYS * 86_400_000;
    if (now >= expires) continue; // already lapsed — no email after the fact
    if (expires - now > FOLLOWUP_WARN_DAYS * 86_400_000) continue; // not yet warning time
    if (c.clientEmail) {
      await sendEmail(env, {
        to: c.clientEmail,
        subject: 'Your follow-up session expires in one week',
        html: `<p>You bought a follow-up discussion on your case, and it expires one month
          after your first discussion:</p>
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
