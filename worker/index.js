// The only server-side code in the app. Routes:
//   POST   /api/checkout           hold a slot, create a Stripe Checkout Session
//   GET    /api/case-for-session   poll after checkout: has the webhook made my case?
//   POST   /api/make-private       revoke a public election (allowed until call time)
//   POST   /api/stripe/webhook     checkout.session.completed -> create the case
//   POST   /api/admin/slots        open availability slots (admin)
//   DELETE /api/admin/slots/:id    remove an open slot (admin)
//   POST   /api/admin/case-update  join link / milestones / close (admin)
// Everything else falls through to the static app in public/.

import { requireUser } from './firebase-auth.js';
import { getDoc, patchDoc, deleteDoc, queryDocs } from './firestore.js';
import { stripePost, verifyWebhook } from './stripe.js';
import { slotTimingProblem, windowProblem, HOLD_MINUTES } from './schedule.js';

const CASE_PRICE_CENTS = 10000;
const ADDON_PRICE_CENTS = 5000;
const METHODS = ['discord', 'zoom', 'phone'];
const REQUIRED_ACKS = ['disclaimer', 'privacy', 'recording', 'election'];

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
      if (url.pathname === '/api/stripe/webhook' && request.method === 'POST')
        return await handleWebhook(request, env);
      if (url.pathname === '/api/admin/slots' && request.method === 'POST')
        return await handleCreateSlots(request, env);
      if (url.pathname.startsWith('/api/admin/slots/') && request.method === 'DELETE')
        return await handleDeleteSlot(request, env, url);
      if (url.pathname === '/api/admin/case-update' && request.method === 'POST')
        return await handleCaseUpdate(request, env);
      if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, 404);
    } catch (err) {
      console.error(`${url.pathname}:`, err.stack || err);
      return json({ error: 'Internal error' }, 500);
    }
    return env.ASSETS.fetch(request);
  },
};

// ---- POST /api/checkout ----
// Body: { slotId, method, phone?, addOnFollowUp, election, acks: {form: msSinceEpoch} }
async function handleCheckout(request, env) {
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Sign in to book.' }, 401);

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

// ---- POST /api/stripe/webhook ----
async function handleWebhook(request, env) {
  const payload = await request.text();
  const event = await verifyWebhook(
    payload,
    request.headers.get('stripe-signature'),
    env.STRIPE_WEBHOOK_SECRET
  );
  if (!event) return json({ error: 'Invalid signature' }, 400);

  if (event.type === 'checkout.session.completed') {
    await createCaseFromSession(env, event.data.object);
  } else if (event.type === 'checkout.session.expired') {
    await releaseHold(env, event.data.object);
  }
  return json({ received: true });
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
    // The call happened: start the 7-day report clock (SPEC: callEnd + 7 days).
    if (doc.data.status === 'closed') return json({ error: 'Case is closed.' }, 409);
    const fields = { reportDueAt: new Date(now.getTime() + 7 * 86_400_000) };
    if (doc.data.status !== 'delivered') fields.status = 'awaiting_report';
    await patchDoc(env, `cases/${caseId}`, fields, { mask: Object.keys(fields) });
  } else if (action === 'report-uploaded') {
    if (doc.data.status === 'closed') return json({ error: 'Case is closed.' }, 409);
    await patchDoc(env, `cases/${caseId}`, { status: 'delivered', reportDeliveredAt: now }, {
      mask: ['status', 'reportDeliveredAt'],
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
  if (!slot || slot.data.state !== 'held' || slot.data.heldBySession !== session.id) return;
  await patchDoc(env, `availability/${slotId}`, {
    state: 'open',
    holdExpiresAt: null,
    heldByUid: null,
    heldBySession: null,
  });
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
