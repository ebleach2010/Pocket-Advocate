// PAYROLL, THE MANGOMINT WAY (Eric, 2026-10-15): "I also need to be able to
// run payroll through this page. And that includes myself. I can run the last
// week, the last two weeks, the last month, and a custom time frame. When I
// hit 'run report' it generates a spreadsheet with a breakdown of all income
// minus deductions and how much they're owed. I can tap on any pay amount to
// adjust it if there's an error. I also need to see each employees preferred
// payout method. I want it to be EXACTLY how mangomint runs payroll. I can
// delete a generated payroll with no consequence. Any payroll I press confirm
// on gets put into another tab with each month's generated payroll. They are
// paid once a month."
//
// Mangomint's shape, kept: pick the period, Generate report, one row per
// person (Cases, Client Sales, Deductions, Commission, Tips, Pay Adjustments,
// Total), a + to add an adjustment (negative allowed) and a tap on a total to
// correct it, expand a row for its lines, Download the spreadsheet, then
// confirm it into the history. Their share is of what the client paid (his
// answer, 2026-10-15); tips are all theirs; a refund or a chargeback takes
// back their share of it.
//
// Where the money comes from: every payment is on its case (the booking and
// each extraPayments row), which says whose case it is. Refunds, chargebacks
// and Priority Chat renewals live only in Stripe, so the report asks Stripe
// for those in the period and matches each to its case; anything it cannot
// match lands on his own row, named, for him to move.
//
// Routes (his alone, the same 404 for anyone else):
//   GET  /api/admin/payroll[?id=]      the runs, or one run
//   POST /api/admin/payroll            generate, adjust, unadjust, delete, confirm
//   GET  /api/staff/payout             the signed-in advocate's own method, masked
//   POST /api/staff/payout             set it (encrypted at rest; his eyes only)

import { getDoc, patchDoc, deleteDoc, listDocs } from './firestore.js';
import { stripeGet } from './stripe.js';
import { caseBookingCents } from './charge.js';
import { advocateIdOf, DEFAULT_COMMISSION_PCT } from './staff.js';

const ID_RE = /^[\w-]{1,64}$/;
const DAY = 86_400_000;
export const ADVISOR_FEE_CENTS = 7900;

export const KIND_LABEL = {
  booking: 'Advocacy Case', casecharge: 'Advocacy Case', fullaccess: 'Full-Service month', extend: 'Full-Service extra month',
  followup: 'Follow-up call', telehealth: 'Telehealth visit', chatunlock: 'Chat opened early', extra: 'Extra session',
  sub: 'Priority Chat month', tip: 'Tip', refund: 'Refund', dispute: 'Chargeback', advisor: 'Advisor, monthly',
};

const ms = (v) => (v ? new Date(v).getTime() : NaN);
const inRange = (v, start, end) => { const t = ms(v); return Number.isFinite(t) && t >= start && t < end; };

/** The period's edges as times: a start day and an end day, both included, on his clock (UTC minus seven). */
export function periodOf(startDay, endDay) {
  const s = new Date(`${startDay}T00:00:00-07:00`).getTime();
  const e = new Date(`${endDay}T00:00:00-07:00`).getTime() + DAY;
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s || e - s > 400 * DAY) return null;
  return { start: s, end: e };
}

/** Every sale, tip and correction recorded on the cases, inside the period. */
export function caseLines(cases, start, end, env) {
  const lines = [];
  for (const r of cases) {
    const c = r.data || {};
    // Nobody paid for his own case, a family case or the showcase. The sample
    // contractor's money comes from sampleLines below, made for the period.
    if (c.self || c.family || c.showcase || c.sample) continue;
    const base = { adv: advocateIdOf(c, env), caseId: r.id, client: c.clientName || c.clientEmail || 'Client', sample: !!c.sample };
    const booking = Number(c.paidOverrideCents) || caseBookingCents(c);
    const bookedAt = c.charge?.capturedAt || c.createdAt;
    if (booking > 0 && inRange(bookedAt, start, end)) lines.push({ ...base, kind: 'booking', label: KIND_LABEL.booking, cents: booking, at: new Date(bookedAt).toISOString() });
    for (const p of (Array.isArray(c.extraPayments) ? c.extraPayments : [])) {
      const cents = Number(p?.amountCents) || 0;
      if (!cents || p?.duplicate || !inRange(p?.at, start, end)) continue;
      const kind = p.kind || 'extra';
      lines.push({ ...base, kind, label: KIND_LABEL[kind] || p.label || 'Payment', cents, at: new Date(p.at).toISOString() });
    }
  }
  return lines;
}

// THE SAMPLE CONTRACTOR'S PAY (Eric, 2026-10-16: "The sample contractor
// should have income and tips so I can run payroll and see numbers beyond
// zero."). Her three invented clients are dated from the day she was added,
// so a later week found nothing. Her sales and tips are invented for whatever
// period is run instead, the same lines for the same days every time: a new
// Advocacy Case every week, a tip most weeks, a Full-Service month every four
// weeks. Every line is marked sample: the totals and Paid leave her out.
export const SAMPLE_CLIENTS = ['Dana Whitfield', 'Priya Shah', 'Grace Kim', 'Tom Becker', 'Ruth Alvarez', 'Sam Okafor', 'Nina Patel', 'Owen Hughes'];
export const SAMPLE_TIPS = [5000, 7500, 10000];
export function sampleLines(cases, start, end, env) {
  const hers = cases.find((r) => r.data?.sample === true);
  if (!hers) return [];
  const adv = advocateIdOf(hers.data, env);
  const lines = [];
  // Whole days on his clock (UTC minus seven), counted from 1970, so a day's lines never depend on the period around it.
  const SHIFT = 7 * 3_600_000;
  for (let n = Math.ceil((start - SHIFT) / DAY); n * DAY + SHIFT < end; n++) {
    const week = Math.floor(n / 7);
    const at = new Date(n * DAY + SHIFT + 10 * 3_600_000);
    if (!inRange(at, start, end)) continue;
    const client = SAMPLE_CLIENTS[week % SAMPLE_CLIENTS.length];
    const base = { adv, caseId: `sample-week-${week}`, client, sample: true, at: at.toISOString() };
    if (n % 7 === 2) lines.push({ ...base, kind: 'booking', label: KIND_LABEL.booking, cents: 210000 });
    if (n % 7 === 5 && week % 4 !== 3) lines.push({ ...base, kind: 'tip', label: KIND_LABEL.tip, cents: SAMPLE_TIPS[week % SAMPLE_TIPS.length] });
    if (n % 28 === 16) lines.push({ ...base, caseId: 'sample-luis-ortega', client: 'Luis Ortega', kind: 'extend', label: KIND_LABEL.extend, cents: 440000 });
  }
  return lines;
}

/** Stripe's list endpoints, every page, newest first, up to a sane ceiling. */
async function stripeAll(env, path, max = 500) {
  const out = [];
  let after = '';
  for (let i = 0; i < 10 && out.length < max; i++) {
    const page = await stripeGet(env, `${path}${path.includes('?') ? '&' : '?'}limit=100${after ? `&starting_after=${after}` : ''}`);
    out.push(...(page.data || []));
    if (!page.has_more || !page.data?.length) break;
    after = page.data[page.data.length - 1].id;
  }
  return out;
}

/**
 * What only Stripe knows, for the period: refunds and chargebacks (each
 * matched to its case through the payment), and Priority Chat renewals
 * (matched to the subscriber's advocate). Anything unmatched is his.
 */
export async function stripeLines(env, start, end, cases, subs) {
  if (!env.STRIPE_SECRET_KEY) return { lines: [], note: 'Stripe is not connected here, so refunds, chargebacks and chat renewals are not in this report.' };
  const range = `created[gte]=${Math.floor(start / 1000)}&created[lt]=${Math.floor(end / 1000)}`;
  const byIntent = new Map();
  const bySession = new Map();
  for (const r of cases) {
    const c = r.data || {};
    const who = { adv: advocateIdOf(c, env), caseId: r.id, client: c.clientName || 'Client', sample: !!c.sample };
    for (const pi of [c.stripe?.paymentIntentId, c.charge?.paymentIntentId]) if (pi) byIntent.set(pi, who);
    for (const s of [c.stripe?.sessionId, c.charge?.sessionId, c.charge?.paidSessionId, ...(c.extraPayments || []).map((p) => p?.sessionId)]) if (s) bySession.set(s, who);
  }
  const byCustomer = new Map(subs.map((s) => [s.data?.stripeCustomerId, { adv: advocateIdOf(s.data, env), caseId: '', client: s.data?.email || 'Priority Chat', sample: false }]));
  const eric = { adv: String(env.ADMIN_UID || ''), caseId: '', client: 'Not matched to a case', sample: false };
  const whoFor = async (pi) => {
    if (!pi) return eric;
    if (byIntent.has(pi)) return byIntent.get(pi);
    const sess = await stripeGet(env, `/v1/checkout/sessions?payment_intent=${encodeURIComponent(pi)}&limit=1`).catch(() => null);
    const s = sess?.data?.[0];
    if (s && bySession.has(s.id)) return bySession.get(s.id);
    if (s?.customer && byCustomer.has(s.customer)) return byCustomer.get(s.customer);
    return eric;
  };
  const lines = [];
  try {
    for (const rf of await stripeAll(env, `/v1/refunds?${range}`)) {
      if (rf.status && !['succeeded', 'pending'].includes(rf.status)) continue;
      const who = await whoFor(rf.payment_intent);
      lines.push({ ...who, kind: 'refund', label: KIND_LABEL.refund, cents: Number(rf.amount) || 0, at: new Date(rf.created * 1000).toISOString(), ref: rf.id });
    }
    for (const dp of await stripeAll(env, `/v1/disputes?${range}`)) {
      const who = await whoFor(dp.payment_intent);
      lines.push({ ...who, kind: 'dispute', label: KIND_LABEL.dispute, cents: Number(dp.amount) || 0, at: new Date(dp.created * 1000).toISOString(), ref: dp.id });
    }
    for (const inv of await stripeAll(env, `/v1/invoices?status=paid&${range}`)) {
      const cents = Number(inv.amount_paid) || 0;
      if (!cents) continue;
      const who = byCustomer.get(inv.customer) || { ...eric, client: inv.customer_email || 'Priority Chat' };
      lines.push({ ...who, kind: 'sub', label: KIND_LABEL.sub, cents, at: new Date(inv.created * 1000).toISOString(), ref: inv.id });
    }
    return { lines, note: '' };
  } catch (err) {
    return { lines, note: `Stripe did not answer (${String(err?.message || err).slice(0, 120)}), so some refunds, chargebacks or chat renewals may be missing.` };
  }
}

/** The fee for each month of the period that starts inside it, for anyone with the Advisor switched on. */
export function advisorLines(advocates, start, end) {
  const lines = [];
  for (const a of advocates) {
    const d = a.data || {};
    if (d.owner === true || d.advisor?.enabled !== true) continue;
    const t = new Date(start);
    let first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1, 7));
    if (first.getTime() < start) first = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1, 7));
    for (let m = first; m.getTime() < end; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1, 7))) {
      lines.push({ adv: a.id, caseId: '', client: '', sample: d.sample === true, kind: 'advisor', label: KIND_LABEL.advisor, cents: ADVISOR_FEE_CENTS, at: m.toISOString() });
    }
  }
  return lines;
}

/**
 * The report: one row per person, Mangomint's columns. Sales pay their
 * share; tips are theirs whole; a refund or chargeback takes back their
 * share of it; a fee comes off whole; his adjustments land last.
 */
export function buildRows({ advocates, lines, adjustments = [], payouts = new Map(), adminUid, includeAll = true }) {
  const rows = new Map();
  for (const a of advocates) {
    const d = a.data || {};
    if (d.active !== true && d.owner !== true) continue;
    const pct = d.owner === true || a.id === adminUid ? 100 : (Number.isFinite(Number(d.commissionPct)) ? Number(d.commissionPct) : DEFAULT_COMMISSION_PCT);
    rows.set(a.id, {
      uid: a.id, name: d.name || d.email || 'Advocate', owner: d.owner === true || a.id === adminUid, sample: d.sample === true,
      commissionPct: pct, cases: 0, salesCents: 0, commissionCents: 0, tipsCents: 0, deductionsCents: 0, adjustmentsCents: 0, totalCents: 0,
      payout: payouts.get(a.id) || null, lines: [], adjustments: [],
    });
  }
  const caseSets = new Map();
  for (const l of lines) {
    const row = rows.get(l.adv) || rows.get(adminUid);
    if (!row) continue;
    let pay = 0;
    if (l.kind === 'tip') { pay = l.cents; row.tipsCents += l.cents; }
    else if (l.kind === 'refund' || l.kind === 'dispute') { pay = -Math.round(l.cents * row.commissionPct / 100); row.deductionsCents += -pay; }
    else if (l.kind === 'advisor') { pay = -l.cents; row.deductionsCents += l.cents; }
    else {
      pay = Math.round(l.cents * row.commissionPct / 100);
      row.salesCents += l.cents;
      row.commissionCents += pay;
      if (l.caseId) { if (!caseSets.has(row.uid)) caseSets.set(row.uid, new Set()); caseSets.get(row.uid).add(l.caseId); }
      else row.cases += 1;
    }
    row.lines.push({ ...l, payCents: pay });
  }
  for (const [uid, set] of caseSets) rows.get(uid).cases += set.size;
  for (const adj of adjustments) {
    const row = rows.get(adj.uid);
    if (!row) continue;
    row.adjustmentsCents += Number(adj.cents) || 0;
    row.adjustments.push(adj);
  }
  for (const row of rows.values()) {
    row.totalCents = row.commissionCents + row.tipsCents - row.deductionsCents + row.adjustmentsCents;
    row.lines.sort((a, b) => ms(a.at) - ms(b.at));
  }
  return [...rows.values()]
    .filter((r) => includeAll || r.lines.length || r.adjustments.length)
    .sort((a, b) => (b.owner - a.owner) || (a.sample - b.sample) || a.name.localeCompare(b.name));
}

export function totalsOf(rows) {
  const sum = (k) => rows.filter((r) => !r.sample).reduce((s, r) => s + r[k], 0);
  return {
    cases: sum('cases'), salesCents: sum('salesCents'), commissionCents: sum('commissionCents'), tipsCents: sum('tipsCents'),
    deductionsCents: sum('deductionsCents'), adjustmentsCents: sum('adjustmentsCents'), totalCents: sum('totalCents'),
  };
}

// ---- payout methods: theirs to set, his to read --------------------------------

export const PAYOUT_METHODS = {
  ach: 'Direct deposit (ACH)', check: 'Paper check', zelle: 'Zelle', paypal: 'PayPal', venmo: 'Venmo', other: 'Other',
};

let payoutKeyPromise = null;
function payoutKey(env) {
  if (!payoutKeyPromise) {
    payoutKeyPromise = crypto.subtle
      .digest('SHA-256', new TextEncoder().encode(`payout-details:${env.PAYOUT_KEY || env.FIREBASE_SERVICE_ACCOUNT || ''}`))
      .then((raw) => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
  }
  return payoutKeyPromise;
}
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));

export async function sealPayout(env, details) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await payoutKey(env), new TextEncoder().encode(JSON.stringify(details))));
  return `${b64(iv)}.${b64(ct)}`;
}
export async function openPayout(env, sealed) {
  try {
    const [iv, ct] = String(sealed || '').split('.');
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await payoutKey(env), unb64(ct));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch { return null; }
}

const line = (v, n = 120) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, n) : '');

/** Their method, checked, with a hint that is safe to show back to them. */
export function cleanPayout(body) {
  const method = String(body?.method || '');
  if (!PAYOUT_METHODS[method]) return { error: 'Choose how you want to be paid.' };
  const f = body?.fields || {};
  const name = line(f.name, 80);
  if (method === 'ach') {
    const routing = line(f.routing, 20).replace(/\D/g, '');
    const account = line(f.account, 30).replace(/\D/g, '');
    const type = f.type === 'savings' ? 'savings' : 'checking';
    if (!name || routing.length !== 9 || account.length < 4 || account.length > 17) return { error: 'The name on the account, a 9 digit routing number and the account number, please.' };
    return { method, details: { name, routing, account, type }, hint: `${type === 'savings' ? 'Savings' : 'Checking'} ending ${account.slice(-4)}` };
  }
  if (method === 'check') {
    const address = line(f.address, 300);
    if (!name || address.length < 8) return { error: 'The name for the check and the address to mail it to, please.' };
    return { method, details: { name, address }, hint: `Mailed to ${address.split(/[,\n]/)[0]}` };
  }
  if (method === 'zelle' || method === 'paypal' || method === 'venmo') {
    const handle = line(f.handle, 120);
    if (handle.length < 3) return { error: `The ${PAYOUT_METHODS[method]} email, phone or handle, please.` };
    const shown = handle.length > 4 ? `${handle.slice(0, 2)}…${handle.slice(-2)}` : '…';
    return { method, details: { name, handle }, hint: `${PAYOUT_METHODS[method]} to ${shown}` };
  }
  const text = line(f.text, 300);
  if (text.length < 3) return { error: 'Say how you want to be paid.' };
  return { method, details: { name, text }, hint: 'Other, as written' };
}

/** Everyone's method, opened, for his eyes on the payroll. */
export async function payoutMap(env) {
  const rows = await listDocs(env, 'payouts', { pageSize: 100, all: true }).catch(() => []);
  const out = new Map();
  for (const r of rows) {
    const details = await openPayout(env, r.data?.sealed);
    out.set(r.id, { method: r.data?.method || '', label: PAYOUT_METHODS[r.data?.method] || '', hint: r.data?.hint || '', details });
  }
  return out;
}

async function staffPayout(request, env, h) {
  const staff = await h.requireStaff(request, env);
  if (!staff) return h.json({ error: 'Not found' }, 404);
  const path = `payouts/${staff.uid}`;
  if (request.method === 'GET') {
    const d = (await getDoc(env, path).catch(() => null))?.data;
    return h.json({ method: d?.method || '', label: PAYOUT_METHODS[d?.method] || '', hint: d?.hint || '', methods: PAYOUT_METHODS });
  }
  if (request.method !== 'POST') return h.json({ error: 'Not found' }, 404);
  const body = (await request.json().catch(() => null)) || {};
  const got = cleanPayout(body);
  if (got.error) return h.json({ error: got.error }, 400);
  // Sealed before it is written; only the method and a masked hint are in the clear.
  await patchDoc(env, path, { method: got.method, hint: got.hint, sealed: await sealPayout(env, got.details), updatedAt: new Date() });
  return h.json({ ok: true, method: got.method, label: PAYOUT_METHODS[got.method], hint: got.hint });
}

// ---- the runs -------------------------------------------------------------------

const summary = (id, d) => ({
  id, status: d.status, start: d.start, end: d.end, preset: d.preset || 'custom', createdAt: d.createdAt, confirmedAt: d.confirmedAt || null, editedAt: d.editedAt || null,
  totals: d.totals || null, people: Array.isArray(d.rows) ? d.rows.filter((r) => !r.sample).length : 0,
  // What the sample contractor's row comes to, so a draft's card is not a bare $0 (2026-10-16).
  sampleCents: Array.isArray(d.rows) ? d.rows.filter((r) => r.sample).reduce((t, r) => t + (Number(r.totalCents) || 0), 0) : 0,
});

async function payrollRoute(request, env, url, h) {
  const admin = await h.requireAdmin(request, env);
  if (!admin) return h.json({ error: 'Not found' }, 404);
  if (request.method === 'GET') {
    const id = url.searchParams.get('id');
    if (id) {
      if (!ID_RE.test(id)) return h.json({ error: 'Not found' }, 404);
      const doc = await getDoc(env, `payrollRuns/${id}`).catch(() => null);
      if (!doc) return h.json({ error: 'Not found' }, 404);
      // Methods are read fresh, so a change they made since shows here.
      const payouts = await payoutMap(env);
      const rows = (doc.data.rows || []).map((r) => ({ ...r, payout: payouts.get(r.uid) || r.payout || null }));
      return h.json({ run: { id, ...doc.data, rows } });
    }
    const rows = await listDocs(env, 'payrollRuns', { pageSize: 100, all: true }).catch(() => []);
    return h.json({ runs: rows.map((r) => summary(r.id, r.data)).sort((a, b) => ms(b.createdAt) - ms(a.createdAt)) });
  }
  if (request.method !== 'POST') return h.json({ error: 'Not found' }, 404);
  const body = (await request.json().catch(() => null)) || {};

  if (body.action === 'generate') {
    const period = periodOf(String(body.start || ''), String(body.end || ''));
    if (!period) return h.json({ error: 'Choose a start and an end day, the end after the start.' }, 400);
    const [advocates, cases, subs] = await Promise.all([
      listDocs(env, 'advocates', { pageSize: 100, all: true }).catch(() => []),
      listDocs(env, 'cases', { pageSize: 300, all: true }).catch(() => []),
      listDocs(env, 'subscriptions', { pageSize: 300, all: true }).catch(() => []),
    ]);
    const fromStripe = await stripeLines(env, period.start, period.end, cases, subs);
    const lines = [...caseLines(cases, period.start, period.end, env), ...sampleLines(cases, period.start, period.end, env), ...fromStripe.lines, ...advisorLines(advocates, period.start, period.end)];
    const payouts = await payoutMap(env);
    const rows = buildRows({ advocates, lines, payouts, adminUid: env.ADMIN_UID, includeAll: body.includeAll !== false });
    const id = `pr-${body.start}-${body.end}-${crypto.randomUUID().slice(0, 6)}`;
    const run = {
      status: 'draft', start: String(body.start), end: String(body.end), preset: String(body.preset || 'custom').slice(0, 20),
      createdAt: new Date(), createdBy: admin.uid, rows: rows.map(({ payout, ...r }) => r), adjustments: [], totals: totalsOf(rows),
      notes: fromStripe.note ? [fromStripe.note] : [],
    };
    await patchDoc(env, `payrollRuns/${id}`, run);
    return h.json({ run: { id, ...run, rows } });
  }

  const id = String(body.id || '');
  if (!ID_RE.test(id)) return h.json({ error: 'Not found' }, 404);
  const doc = await getDoc(env, `payrollRuns/${id}`).catch(() => null);
  if (!doc) return h.json({ error: 'Not found' }, 404);
  const run = doc.data;

  if (body.action === 'delete') {
    if (run.status !== 'draft') return h.json({ error: 'A paid payroll stays in its month.' }, 409);
    await deleteDoc(env, `payrollRuns/${id}`);
    return h.json({ ok: true });
  }
  // PAID, AND STILL EDITABLE (Eric, 2026-10-15: "When I press 'paid,' the
  // spreadsheet gets put in a folder for that month. It can still be edited
  // if needed but with a warning prompt of (are you sure you want to edit
  // this paid payroll?)"). A paid run takes an adjustment only when the
  // request says he answered yes (editPaid), and every such edit is kept on
  // the run with when it happened.
  const paid = run.status !== 'draft';
  if (paid && body.action === 'confirm') return h.json({ error: 'This payroll is already paid.' }, 409);
  if (paid && body.editPaid !== true) return h.json({ error: 'This payroll is paid. Say you are sure you want to edit it first.', paid: true }, 409);

  const withPayouts = async (rows) => { const p = await payoutMap(env); return rows.map((r) => ({ ...r, payout: p.get(r.uid) || null })); };
  const recompute = (adjustments) => {
    const rows = (run.rows || []).map((r) => {
      const mine = adjustments.filter((a) => a.uid === r.uid);
      const adj = mine.reduce((s, a) => s + (Number(a.cents) || 0), 0);
      return { ...r, adjustments: mine, adjustmentsCents: adj, totalCents: r.commissionCents + r.tipsCents - r.deductionsCents + adj };
    });
    return { rows, totals: totalsOf(rows) };
  };

  // What an edit of a paid run leaves behind: when, and what was done.
  const editStamp = (what) => (paid
    ? { editedAt: new Date(), edits: [...(Array.isArray(run.edits) ? run.edits : []), { at: new Date().toISOString(), ...what }].slice(-100) }
    : {});
  const editMask = paid ? ['editedAt', 'edits'] : [];
  if (body.action === 'adjust') {
    const uid = String(body.uid || '');
    if (!(run.rows || []).some((r) => r.uid === uid)) return h.json({ error: 'Not on this payroll.' }, 400);
    const cents = Math.round(Number(body.cents));
    if (!Number.isFinite(cents) || !cents || Math.abs(cents) > 10_000_000) return h.json({ error: 'An amount, please. A minus sign takes it off.' }, 400);
    const type = ['Pay adjustment', 'Bonus', 'Reimbursement', 'Correction'].includes(body.type) ? body.type : 'Pay adjustment';
    const adj = { id: crypto.randomUUID().slice(0, 8), uid, type, cents, note: line(body.note, 200), at: new Date().toISOString() };
    const adjustments = [...(run.adjustments || []), adj];
    const next = recompute(adjustments);
    const stamp = editStamp({ action: 'adjust', uid, cents, type });
    await patchDoc(env, `payrollRuns/${id}`, { adjustments, rows: next.rows, totals: next.totals, ...stamp }, { mask: ['adjustments', 'rows', 'totals', ...editMask] });
    return h.json({ run: { id, ...run, adjustments, ...next, ...stamp, rows: await withPayouts(next.rows) } });
  }
  if (body.action === 'unadjust') {
    const gone = (run.adjustments || []).find((a) => a.id === String(body.adjId || ''));
    const adjustments = (run.adjustments || []).filter((a) => a.id !== String(body.adjId || ''));
    const next = recompute(adjustments);
    const stamp = editStamp({ action: 'unadjust', uid: gone?.uid || '', cents: gone ? -gone.cents : 0, type: gone?.type || '' });
    await patchDoc(env, `payrollRuns/${id}`, { adjustments, rows: next.rows, totals: next.totals, ...stamp }, { mask: ['adjustments', 'rows', 'totals', ...editMask] });
    return h.json({ run: { id, ...run, adjustments, ...next, ...stamp, rows: await withPayouts(next.rows) } });
  }
  if (body.action === 'confirm') {
    // The sample contractor is never paid: her row goes before it is kept.
    const rows = (run.rows || []).filter((r) => !r.sample);
    const confirmed = { status: 'confirmed', confirmedAt: new Date(), rows, totals: totalsOf(rows) };
    await patchDoc(env, `payrollRuns/${id}`, confirmed, { mask: ['status', 'confirmedAt', 'rows', 'totals'] });
    return h.json({ run: { id, ...run, ...confirmed, rows: await withPayouts(rows) } });
  }
  return h.json({ error: 'Bad request' }, 400);
}

/** The one entry point the Worker's router calls for everything above. */
export async function handlePayroll(request, env, url, h) {
  if (url.pathname === '/api/admin/payroll') return payrollRoute(request, env, url, h);
  if (url.pathname === '/api/staff/payout') return staffPayout(request, env, h);
  return h.json({ error: 'Not found' }, 404);
}
