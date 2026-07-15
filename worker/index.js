// The only server-side code in the app. Routes:
//   POST   /api/checkout           hold a slot, create a Stripe Checkout Session
//   GET    /api/case-for-session   poll after checkout: has the webhook made my case?
//   POST   /api/make-private       revoke a public election (allowed until call time)
//   POST   /api/subscribe          Pocket Advocate subscription Checkout ($20/mo)
//   POST   /api/portal             Stripe customer portal (manage/cancel)
//   POST   /api/stripe/webhook     payments + subscription lifecycle -> Firestore
//   POST   /api/admin/slots        open availability slots (admin)
//   DELETE /api/admin/slots/:id    remove an open slot (admin)
//   POST   /api/admin/case-update  join link / milestones / close (admin)
// Plus a cron (see scheduled()) that emails unread-chat digests.
// Everything else falls through to the static app in public/.

import { requireUser } from './firebase-auth.js';
import { getDoc, patchDoc, deleteDoc, queryDocs } from './firestore.js';
import { stripePost, verifyWebhook } from './stripe.js';
import { slotTimingProblem, windowProblem, HOLD_MINUTES } from './schedule.js';
import { sendEmail, homeScreenTips } from './email.js';

const CASE_PRICE_CENTS = 10000;
const ADDON_PRICE_CENTS = 5000;
const SUB_PRICE_CENTS = 2000;
// Follow-up add-ons expire one month after the first discussion (Eric,
// 2026-07-13); clients get one warning email a week before the deadline.
const FOLLOWUP_EXPIRY_DAYS = 30;
const FOLLOWUP_WARN_DAYS = 7;
// Admin-priced sessions: percentage of the $100 case rate, 25% steps.
const CHARGE_PCTS = [0, 25, 50, 75, 100, 125, 150];
const METHODS = ['discord', 'zoom', 'phone'];
const REQUIRED_ACKS = ['disclaimer', 'privacy', 'recording', 'election'];
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
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(`${url.pathname}:`, err.stack || err);
      return json({ error: 'Internal error' }, 500);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runChatDigest(env));
    ctx.waitUntil(runFollowUpWarnings(env));
  },
};

// ---- POST /api/checkout ----
// Body: { slotId, method, phone?, addOnFollowUp, election, acks: {form: msSinceEpoch} }
async function handleCheckout(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in to book.' }, 401);
  const identity = await requireAdultProfile(env, user.uid);
  if (identity.error) return json({ error: identity.error }, identity.code);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400);
  const { slotId, method, phone, addOnFollowUp, election, acks } = body;

  if (!METHODS.includes(method)) return json({ error: 'Choose a meeting method.' }, 400);
  if (method === 'phone' && !/^\+?[\d\s().-]{7,20}$/.test(phone || ''))
    return json({ error: 'A valid phone number is required for a phone call.' }, 400);
  if (election !== 'private' && election !== 'public')
    return json({ error: 'Choose public or private.' }, 400);
  for (const form of REQUIRED_ACKS)
    if (!acks || typeof acks[form] !== 'number')
      return json({ error: 'All acknowledgment forms must be completed first.' }, 400);

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

  const lineItems = [
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
    lineItems.push({
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: ADDON_PRICE_CENTS,
        product_data: { name: 'Follow-up add-on', description: 'Second discussion on this case' },
      },
    });

  const session = await stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: user.email || undefined,
    line_items: lineItems,
    success_url: `${env.PUBLIC_BASE_URL}/return.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.PUBLIC_BASE_URL}/book.html?canceled=1`,
    expires_at: Math.floor(holdExpiresAt.getTime() / 1000),
    metadata: {
      uid: user.uid,
      email: user.email || '',
      name: identity.name,
      dob: identity.dob,
      slotId,
      method,
      phone: method === 'phone' ? phone : '',
      addOnFollowUp: addOnFollowUp ? '1' : '0',
      election,
      acks: JSON.stringify(acks),
    },
  });

  // Remember which session owns the hold so the webhook can match it.
  await patchDoc(env, `availability/${slotId}`, { heldBySession: session.id }, {
    mask: ['heldBySession'],
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
    customer_email: user.email || undefined,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: SUB_PRICE_CENTS,
          recurring: { interval: 'month' },
          product_data: {
            name: 'Pocket Advocate subscription',
            description: 'Anytime chat with your advocate',
          },
        },
      },
    ],
    success_url: `${env.PUBLIC_BASE_URL}/subscription.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${env.PUBLIC_BASE_URL}/subscribe.html?canceled=1`,
    metadata: { uid: user.uid, termsAckAt: String(termsAckAt) },
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
  await patchDoc(env, `subscriptions/${uid}`, {
    stripeCustomerId: session.customer || null,
    subscriptionId: session.subscription || null,
    status: 'active',
    email: session.customer_email || session.customer_details?.email || null,
    termsAckAt: session.metadata.termsAckAt
      ? new Date(Number(session.metadata.termsAckAt))
      : now,
    startedAt: now,
    // Provisional; the customer.subscription.updated event corrects it.
    currentPeriodEnd: new Date(now.getTime() + 32 * 86_400_000),
  });
  const email = session.customer_email || session.customer_details?.email;
  await sendEmail(env, {
    to: email,
    subject: 'Your Pocket Advocate subscription is live',
    html: `<p>Your chat line to Eric is open. He replies when he's available — response
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
      subject: 'Your Pocket Advocate subscription has ended',
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
// One nudge per thread per run, only for messages old enough that the
// recipient clearly hasn't seen them in-app. No message content in email.
export async function runChatDigest(env, now = Date.now()) {
  for (const coll of ['cases', 'subscriptions']) {
    const rows = await queryDocs(env, coll, [['lastMessage.emailed', 'EQUAL', false]], 50);
    for (const row of rows) {
      const lm = row.data.lastMessage;
      if (!lm || !lm.ts) continue;
      if (now - new Date(lm.ts).getTime() < DIGEST_MIN_AGE_MS) continue;
      const to = lm.role === 'admin'
        ? row.data.clientEmail || row.data.email
        : env.ADMIN_EMAIL;
      const link = lm.role === 'admin'
        ? coll === 'cases' ? '/case.html' : '/subscription.html'
        : '/admin-chats.html';
      if (to) {
        await sendEmail(env, {
          to,
          subject: 'New message on Pocket Advocate',
          html: `<p>You have an unread message waiting.</p>
            <p><a href="${env.PUBLIC_BASE_URL}${link}">Open the chat</a></p>`,
        });
      }
      await patchDoc(env, `${coll}/${row.id}`, { lastMessage: { emailed: true } }, {
        mask: ['lastMessage.emailed'],
      });
    }
  }
}

/** The ONLY place a case is ever created. */
async function createCaseFromSession(env, session) {
  const m = session.metadata || {};
  if (!m.uid || !m.slotId) return;

  // Idempotency: Stripe retries webhooks; don't create the case twice.
  const existing = await queryDocs(env, 'cases', [
    ['stripe.sessionId', 'EQUAL', session.id],
  ], 1);
  if (existing.length) return;

  const slot = await getDoc(env, `availability/${m.slotId}`);
  const acks = safeJson(m.acks) || {};
  const now = new Date();
  const allFormsDone = REQUIRED_ACKS.every((f) => typeof acks[f] === 'number');
  const start = slot ? new Date(slot.data.start) : null;
  const caseId = crypto.randomUUID();

  await patchDoc(
    env,
    `cases/${caseId}`,
    {
      clientUid: m.uid,
      clientEmail: m.email || session.customer_email || null,
      clientName: m.name || null,
      clientDob: m.dob || null,
      status: allFormsDone ? 'confirmed' : 'forms',
      createdAt: now,
      appointment: {
        start,
        durationMin: slot ? slot.data.durationMin || 60 : 60,
        method: m.method,
        phone: m.phone || null,
        joinLink: null,
      },
      publicElection: {
        choice: m.election === 'public' ? 'public' : 'private',
        history: [{ choice: m.election, at: now }],
        revocableUntil: start,
      },
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

  const clientEmail = m.email || session.customer_email;
  if (clientEmail && start) {
    const mtFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Etc/GMT+7', weekday: 'long', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
    await sendEmail(env, {
      to: clientEmail,
      subject: 'Your Pocket Advocate case is open',
      html: `<p>Payment confirmed — your case file is live.</p>
        <p><strong>${mtFmt.format(start)} MST</strong> · ${m.method}</p>
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
      });
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
  return { name: `${p.firstName} ${p.lastName}`.slice(0, 120), dob: p.dob };
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

  let created = 0;
  let skipped = 0;
  for (const iso of starts) {
    const start = new Date(iso);
    if (Number.isNaN(start.getTime()) || start.getTime() < Date.now()) { skipped++; continue; }
    if (windowProblem(iso, durationMin)) { skipped++; continue; }
    const ok = await patchDoc(
      env,
      `availability/${slotIdFor(start)}`,
      { start, durationMin, state: 'open' },
      { mustNotExist: true }
    );
    ok ? created++ : skipped++; // exists already (open, held, or booked) -> skip
  }
  return json({ created, skipped });
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
          <p>Eric is now putting together your written report. Expect it within
          <strong>7 business days</strong> — some reports take slightly longer
          depending on complexity, and yours will be worth the care.</p>
          <p>When the report lands, you'll have a day to look it over and ask
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
        <p>Take a day to read it over — if anything raises a question, ask Eric
        in your case chat before the case wraps up.</p>
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
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
    await patchDoc(env, `availability/${slotId}`, {
      state: 'open',
      holdExpiresAt: null,
      heldByUid: null,
      heldBySession: null,
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

function followUpExpiry(c) {
  const base = c.appointment?.start ? new Date(c.appointment.start) : null;
  return base ? new Date(base.getTime() + FOLLOWUP_EXPIRY_DAYS * 86_400_000) : null;
}

/**
 * POST /api/admin/schedule
 * Body: { caseId, slotId, mode: 'reschedule'|'followup'|'charge', pct?, tagline? }
 * Admin scheduling skips the 72h lead and 1.5-week horizon on purpose (Eric
 * arranges these with the client directly); the 8am–6pm window still applies.
 */
async function handleAdminSchedule(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return json({ error: 'Admin only' }, 403);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Bad request' }, 400);
  const { caseId, slotId, mode, pct, tagline } = body;
  if (typeof caseId !== 'string' || !/^[\w-]{1,64}$/.test(caseId))
    return json({ error: 'Bad case id' }, 400);
  if (typeof slotId !== 'string' || !/^[\w-]{1,64}$/.test(slotId))
    return json({ error: 'Bad slot id' }, 400);
  if (!['reschedule', 'followup', 'charge'].includes(mode))
    return json({ error: 'Bad mode' }, 400);

  const caseDoc = await getDoc(env, `cases/${caseId}`);
  if (!caseDoc) return json({ error: 'No such case' }, 404);
  const c = caseDoc.data;

  const slot = await getDoc(env, `availability/${slotId}`);
  if (!slot) return json({ error: 'No such slot' }, 404);
  const now = new Date();
  const holdExpired =
    slot.data.state === 'held' &&
    slot.data.holdExpiresAt &&
    new Date(slot.data.holdExpiresAt) < now;
  if (slot.data.state !== 'open' && !holdExpired)
    return json({ error: 'That slot is not open.' }, 409);
  const start = new Date(slot.data.start);
  if (start.getTime() <= now.getTime()) return json({ error: 'That slot is in the past.' }, 409);
  const wp = windowProblem(slot.data.start, slot.data.durationMin || 60);
  if (wp) return json({ error: wp }, 409);
  const durationMin = slot.data.durationMin || 60;
  const when = `${MT_FMT.format(start)} MST`;

  const bookSlot = () =>
    patchDoc(env, `availability/${slotId}`, {
      state: 'booked', caseId, holdExpiresAt: null, heldByUid: null, heldBySession: null,
    });

  if (mode === 'reschedule') {
    // Free whatever slot(s) this case previously occupied, then take the new one.
    const oldSlots = await queryDocs(env, 'availability', [['caseId', 'EQUAL', caseId]], 5);
    for (const s of oldSlots)
      if (s.id !== slotId)
        await patchDoc(env, `availability/${s.id}`, { state: 'open', caseId: null }, {
          mask: ['state', 'caseId'],
        });
    await bookSlot();
    await patchDoc(env, `cases/${caseId}`, {
      appointment: { ...c.appointment, start, durationMin },
      needsReschedule: null,
    }, { mask: ['appointment', 'needsReschedule'] });
    await sendEmail(env, {
      to: c.clientEmail,
      subject: 'Your Pocket Advocate appointment moved',
      html: `<p>Your discussion with Eric is now scheduled for:</p>
        <p><strong>${when}</strong></p>
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
    });
    return json({ ok: true, scheduled: when });
  }

  if (mode === 'followup') {
    if (!c.addOnFollowUp) return json({ error: 'This case has no paid follow-up add-on.' }, 409);
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
      html: `<p>Your paid follow-up discussion with Eric is scheduled:</p>
        <p><strong>${when}</strong></p>
        <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
    });
    return json({ ok: true, scheduled: when });
  }

  // mode === 'charge' — a custom-priced session (percentage of the $100 rate).
  if (!CHARGE_PCTS.includes(pct)) return json({ error: 'Pick a rate (0–150% in 25% steps).' }, 400);
  const label =
    typeof tagline === 'string' && tagline.trim()
      ? tagline.trim().slice(0, 120)
      : 'Advocacy Session';
  const amountCents = pct * 100; // pct% of $100

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
      subject: 'A session with Eric is booked',
      html: `<p>${escHtml(label)} — no charge.</p>
        <p><strong>${when}</strong></p>
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
          product_data: { name: label, description: `${when} with Eric` },
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
    subject: 'Eric scheduled a session — payment needed to confirm',
    html: `<p>${escHtml(label)} — $${(amountCents / 100).toFixed(2)}.</p>
      <p><strong>${when}</strong></p>
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
  });
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
      <p><strong>${MT_FMT.format(start)} MST</strong></p>
      <p><a href="${env.PUBLIC_BASE_URL}/case.html">Open your case</a></p>`,
  });
}

/**
 * Cron: warn clients one week before an unscheduled follow-up add-on expires
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
        html: `<p>Your case included a paid follow-up discussion, and it expires on
          <strong>${MT_FMT.format(new Date(expires))} MST</strong> — one month after your first discussion.</p>
          <p>To use it, message Eric in your case chat and he'll get it scheduled.</p>
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
