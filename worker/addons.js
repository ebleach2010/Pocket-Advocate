// A FULL-SERVICE CASE'S ENHANCEMENTS ON TOP (Eric, 2026-10-17).
//
// "With full case management, attending appointments and writing insurance
// appeals are enhancements." Each advocate offers their own: "When a
// contractor is onboarded, they'll let me know what add-ons they want to have.
// So when I add a contractor into the app it will be a simple toggle with a
// price input. I can go into their profile and change this at any time by
// pressing on their profile picture." His own prices, asked: an appeal "$350",
// attending an appointment "$525".
//
// advocates/{uid}.addons = { attend: { on, cents }, appeal: { on, cents }, custom: [{ id, label, on, cents }] }
//   custom: his own extras for each advocate, by name and price (2026-10-17:
//   "any extra tiers or add-ons and their pricing"). Asked for and answered
//   exactly as an appeal is; the name they were asked for by rides on the
//   request, the checkout and the case.
//   Attending an appointment runs through the telehealth request (index.js),
//   which reads the price here on a Full-Service case. An appeal is asked for
//   here: the client asks, their advocate says yes (a link to pay, or at no
//   charge) or no in their own words, and paying puts it on the case. "All case
//   requests get accepted or declined by the advocate they choose."
//
//   POST /api/addon-request          { caseId, kind } | { caseId, action: 'withdraw' }   the client
//   POST /api/admin/addon-request    { caseId, decision, reason, amountCents }   their advocate

import { getDoc, patchDoc } from './firestore.js';

const ID = /^[\w-]{1,64}$/;
/** What an advocate can offer on top of a Full-Service month, in the order a client reads them. */
export const ADDON_KINDS = [
  { id: 'attend', label: 'Attending an appointment', line: 'I come to your appointment with you' },
  { id: 'appeal', label: 'Writing an insurance appeal', line: 'One insurance appeal, written and filed' },
];
const KIND = new Map(ADDON_KINDS.map((k) => [k.id, k]));
/** His own, on his word (2026-10-17). A contractor's are off until he sets them. */
export const OWNER_ADDONS = { attend: { on: true, cents: 52500 }, appeal: { on: true, cents: 35000 } };
const MAX_CENTS = 2_000_000;
/** An extra of his own naming: x and eight letters or digits. */
export const CUSTOM_ID = /^x[a-z0-9]{8}$/;
export const CUSTOM_MAX = 6;
const LABEL_MAX = 60;
const label = (v) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX) : '');

/** The extras of his own naming, as stored: every one well formed, the rest dropped. */
function customOf(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((x) => x && CUSTOM_ID.test(String(x.id)) && label(x.label).length >= 2).slice(0, CUSTOM_MAX).map((x) => ({
    id: x.id, label: label(x.label), on: x.on === true,
    cents: Number.isInteger(x.cents) && x.cents >= 0 && x.cents <= MAX_CENTS ? x.cents : 0,
  }));
}

/** One advocate's add-ons, every kind present: what they offer and at what price. */
export function addonsOf(a, { owner = false } = {}) {
  const set = a && typeof a.addons === 'object' && a.addons ? a.addons : (owner ? OWNER_ADDONS : {});
  const out = {};
  for (const { id } of ADDON_KINDS) {
    const v = set[id] || {};
    const cents = Number.isInteger(v.cents) && v.cents >= 0 && v.cents <= MAX_CENTS ? v.cents : 0;
    out[id] = { on: v.on === true, cents };
  }
  out.custom = customOf(set.custom);
  return out;
}

/** What he typed, checked: { value } to store, or { error }. A price under fifty cents cannot be charged. */
export function cleanAddons(input) {
  if (!input || typeof input !== 'object') return { error: 'Bad add-ons.' };
  const value = {};
  for (const { id, label } of ADDON_KINDS) {
    const v = input[id] || {};
    const on = v.on === true;
    const cents = Number(v.cents);
    if (on && (!Number.isInteger(cents) || cents < 0 || cents > MAX_CENTS))
      return { error: `${label}: a price from $0 to $20,000.` };
    if (on && cents > 0 && cents < 50) return { error: `${label}: Stripe cannot charge less than $0.50. Use 0 for no charge.` };
    value[id] = { on, cents: on ? cents : (Number.isInteger(cents) && cents >= 0 && cents <= MAX_CENTS ? cents : 0) };
  }
  if (input.custom !== undefined) {
    if (!Array.isArray(input.custom)) return { error: 'Bad add-ons.' };
    const rows = input.custom.filter((x) => x && (label(x.label) || x.on === true));
    if (rows.length > CUSTOM_MAX) return { error: `Up to ${CUSTOM_MAX} of your own add-ons.` };
    const seen = new Set();
    value.custom = [];
    for (const x of rows) {
      const name = label(x.label);
      if (name.length < 2) return { error: 'Each add-on of your own needs a name.' };
      if (seen.has(name.toLowerCase())) return { error: `${name} is there twice.` };
      seen.add(name.toLowerCase());
      const on = x.on === true;
      const cents = Number(x.cents);
      if (on && (!Number.isInteger(cents) || cents < 0 || cents > MAX_CENTS)) return { error: `${name}: a price from $0 to $20,000.` };
      if (on && cents > 0 && cents < 50) return { error: `${name}: Stripe cannot charge less than $0.50. Use 0 for no charge.` };
      // An id is kept once given, so a request already made still finds its add-on.
      const id = CUSTOM_ID.test(String(x.id)) ? x.id : `x${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}`;
      value.custom.push({ id, label: name, on, cents: Number.isInteger(cents) && cents >= 0 && cents <= MAX_CENTS ? cents : 0 });
    }
  }
  return { value };
}

/** What a request is for, by kind: the appeal, or one of his own extras. Null when it is neither. */
export function addonKind(offered, kind) {
  if (kind === 'appeal') return { label: KIND.get('appeal').label, line: KIND.get('appeal').line, on: offered.appeal?.on === true, cents: offered.appeal?.cents || 0, mine: false };
  const x = CUSTOM_ID.test(String(kind)) ? (offered.custom || []).find((k) => k.id === kind) : null;
  return x ? { label: x.label, line: '', on: x.on, cents: x.cents, mine: true } : null;
}

/** How a request is named in a sentence: "an insurance appeal" style for his kinds, the extra's own name otherwise. */
const named = (req) => (KIND.has(req?.kind) ? KIND.get(req.kind).label.toLowerCase() : (req?.label || 'your enhancement'));

/** The add-ons a case's own advocate offers. His when the case is his; none when theirs cannot be read. */
export async function caseAddons(env, c, advocateIdOf) {
  const uid = advocateIdOf(c, env);
  const rec = uid ? await getDoc(env, `advocates/${uid}`).catch(() => null) : null;
  const owner = !uid || uid === env.ADMIN_UID || rec?.data?.owner === true;
  if (rec?.data && !owner && rec.data.active !== true) return addonsOf(null);
  return addonsOf(rec?.data || null, { owner });
}

/**
 * The client asks for an add-on on their open Full-Service case. Nothing is
 * charged and no card is taken. `h` carries requireUser, json, pingCase and
 * advocateIdOf.
 */
export async function handleAddonRequest(request, env, h) {
  const user = await h.requireUser(request, env);
  if (!user) return h.json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!ID.test(caseId)) return h.json({ error: 'Bad case' }, 400);
  const c = await getDoc(env, `cases/${caseId}`);
  if (!c || c.data.clientUid !== user.uid) return h.json({ error: 'Not found' }, 404);
  const req = c.data.addonRequest;

  if (body?.action === 'withdraw') {
    if (req?.state !== 'pending') return h.json({ error: 'There is no request to withdraw.' }, 409);
    const undone = await patchDoc(env, `cases/${caseId}`, { addonRequest: null }, { mask: ['addonRequest'], ifUpdateTime: c.updateTime });
    if (undone === false) return h.json({ error: 'Try that once more.' }, 409);
    return h.json({ ok: true, withdrawn: true });
  }

  if (!c.data.fullAccess) return h.json({ error: 'These are enhancements on Full-Service Case Management.' }, 409);
  if (c.data.status === 'closed') return h.json({ error: 'This case is closed.' }, 409);
  const kind = typeof body?.kind === 'string' ? body.kind : '';
  // Attending runs through the appointment request, which takes the clinic and the time.
  if (kind !== 'appeal' && !CUSTOM_ID.test(kind)) return h.json({ error: 'Bad add-on' }, 400);
  if (req?.state === 'pending') return h.json({ error: 'You already have a request waiting on your advocate.' }, 409);
  if (req?.state === 'approved' && c.data.pendingAddon?.url && new Date(c.data.pendingAddon.expiresAt || 0).getTime() > Date.now())
    return h.json({ error: 'Your last one is ready to pay. Finish that first.' }, 409);
  const offered = addonKind(await caseAddons(env, c.data, h.advocateIdOf), kind);
  if (!offered) return h.json({ error: 'Bad add-on' }, 400);
  if (!offered.on) return h.json({ error: 'Your advocate does not offer this one. Ask in chat.' }, 409);

  const next = {
    kind, state: 'pending', at: new Date(),
    // Its name as they saw it, for every screen and email after.
    label: offered.label,
    // The price quoted when they asked, so a yes days later charges what they saw.
    cents: offered.cents,
    note: typeof body?.note === 'string' ? body.note.replace(/\s+/g, ' ').trim().slice(0, 600) : '',
    decidedAt: null, declineReason: '',
  };
  const wrote = await patchDoc(env, `cases/${caseId}`, { addonRequest: next }, { mask: ['addonRequest'], ifUpdateTime: c.updateTime });
  if (wrote === false) return h.json({ error: 'Try that once more.' }, 409);
  await h.pingCase(env, c.data, `${String(c.data.clientName || '').trim().split(/\s+/)[0] || 'A client'} is asking for ${named(next)}. Say yes or no on their case.`,
    `/admin-case.html?id=${caseId}`);
  return h.json({ ok: true, state: 'pending', at: next.at, cents: next.cents });
}

/**
 * Their advocate answers. `h` carries requireStaff, staffSees, json,
 * notifyUser, stripePost, confirm (confirmAddonPurchase) and baseUrl.
 */
export async function handleAddonDecision(request, env, h) {
  const staff = await h.requireStaff(request, env);
  if (!staff) return h.json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!ID.test(caseId)) return h.json({ error: 'Bad case' }, 400);
  const decision = body?.decision === 'approve' ? 'approve' : body?.decision === 'decline' ? 'decline' : '';
  if (!decision) return h.json({ error: 'Bad request' }, 400);
  const c = await getDoc(env, `cases/${caseId}`);
  if (!c || !h.staffSees(staff, c.data, env)) return h.json({ error: 'Not found' }, 404);
  const req = c.data.addonRequest;
  if (req?.state !== 'pending') return h.json({ error: 'There is no request waiting.' }, 409);
  const what = named(req);
  const tell = (text) => (c.data.clientUid
    ? h.notifyUser(env, c.data.clientUid, { title: 'Pocket Advocate', body: text, link: `/case.html?id=${caseId}&page=addons` }).catch(() => {})
    : null);

  if (decision === 'decline') {
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, 600) : '';
    if (!reason) return h.json({ error: 'Write the reason. The client reads it word for word.' }, 400);
    await patchDoc(env, `cases/${caseId}`, {
      addonRequest: { ...req, state: 'declined', decidedAt: new Date(), declineReason: reason, decidedBy: staff.uid },
    }, { mask: ['addonRequest'] });
    await tell(`Your advocate answered your request for ${what}. Nothing was charged.`);
    return h.json({ ok: true, state: 'declined' });
  }

  const asked = body?.amountCents;
  const cents = asked === undefined || asked === null ? Number(req.cents) || 0 : Number(asked);
  if (!Number.isInteger(cents) || cents < 0 || cents > MAX_CENTS)
    return h.json({ error: 'The amount has to be a whole number of cents, zero or more, under $20,000.' }, 400);
  if (cents > 0 && cents < 50) return h.json({ error: 'Stripe cannot charge less than $0.50. Use 0 for no charge.' }, 400);
  if (cents === 0) {
    await patchDoc(env, `cases/${caseId}`, {
      addonRequest: { ...req, state: 'approved', decidedAt: new Date(), compedAt: new Date(), decidedBy: staff.uid },
    }, { mask: ['addonRequest'] });
    await h.confirm(env, { id: `comp_addon_${caseId}_${Date.now()}`, amount_total: 0, metadata: { kind: 'addon', caseId, addon: req.kind, label: String(req.label || '').slice(0, 100) } });
    await tell(`Good news: ${what} is on your case, at no charge.`);
    return h.json({ ok: true, state: 'started', cents: 0, comped: true });
  }
  // 23 hours, the most a Checkout Session may stay open.
  const expiresAt = new Date(Date.now() + 23 * 3600_000);
  const session = await h.stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: c.data.clientEmail || undefined,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd', unit_amount: cents,
        product_data: { name: KIND.get(req.kind)?.label || req.label || 'Case enhancement', description: KIND.get(req.kind)?.line || undefined },
      },
    }],
    success_url: `${h.baseUrl}/case.html?id=${caseId}&page=addons`,
    cancel_url: `${h.baseUrl}/case.html?id=${caseId}&page=addons`,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    metadata: { kind: 'addon', caseId, uid: c.data.clientUid || '', addon: req.kind, label: String(req.label || '').slice(0, 100) },
  });
  await patchDoc(env, `cases/${caseId}`, {
    addonRequest: { ...req, state: 'approved', decidedAt: new Date(), decidedBy: staff.uid },
    pendingAddon: { sessionId: session.id, url: session.url, cents, kind: req.kind, createdAt: new Date(), expiresAt },
  }, { mask: ['addonRequest', 'pendingAddon'] });
  await tell(`Good news: your advocate said yes to ${what}. It is ready to pay on your case.`);
  return h.json({ ok: true, state: 'approved', url: session.url, cents });
}

/**
 * Paid (or given at no charge): the add-on is on the case, once per session.
 * `h` carries pingCase.
 */
export async function confirmAddonPurchase(env, session, h, attempt = 0) {
  if (attempt > 3) throw new Error(`addon: lock contention on ${session.id}`);
  const caseId = session.metadata?.caseId;
  if (!caseId) return;
  const c = await getDoc(env, `cases/${caseId}`);
  if (!c) throw new Error(`addon: no case for ${session.id}`);
  const payments = Array.isArray(c.data.extraPayments) ? [...c.data.extraPayments] : [];
  if (payments.some((x) => x.sessionId === session.id)) return;
  const kind = KIND.has(session.metadata?.addon) || CUSTOM_ID.test(String(session.metadata?.addon || '')) ? session.metadata.addon : 'appeal';
  const name = KIND.get(kind)?.label || label(session.metadata?.label) || 'Case enhancement';
  const amountCents = Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : 0;
  const now = new Date();
  payments.push({ kind: 'addon', addon: kind, label: name, amountCents, sessionId: session.id, at: now });
  const bought = Array.isArray(c.data.addonsBought) ? [...c.data.addonsBought] : [];
  bought.push({ kind, label: name, cents: amountCents, at: now, sessionId: session.id });
  const req = c.data.addonRequest;
  const ok = await patchDoc(env, `cases/${caseId}`, {
    extraPayments: payments,
    addonsBought: bought,
    addonRequest: req ? { ...req, state: 'started', startedAt: now } : null,
    pendingAddon: null,
  }, { mask: ['extraPayments', 'addonsBought', 'addonRequest', 'pendingAddon'], ifUpdateTime: c.updateTime }).catch(() => false);
  if (ok === false) return confirmAddonPurchase(env, session, h, attempt + 1);
  if (amountCents > 0) {
    await h.pingCase(env, c.data, `${String(c.data.clientName || '').trim().split(/\s+/)[0] || 'Your client'} paid for ${named({ kind, label: name })}.`,
      `/admin-case.html?id=${caseId}`).catch(() => {});
  }
}
