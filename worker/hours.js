// PAST THE MONTH'S 20 HOURS, the Worker's side (Eric, 2026-10-17; his words
// are at the top of public/js/extra-hours.js, which this imports so the hours
// asked about, billed and charged for are the same hours).
//
// Once a Full-Service case's month passes its 20 hours the client is told
// (markIncludedHours in index.js) and asked on their case page to choose:
//   continue to the end of the month at $200 an hour   POST /api/hours-choice { caseId, choice: 'hourly' }
//   another month at the case's month price            the Add another month checkout already there (/api/extend)
//   end the case, everything kept                      POST /api/hours-choice { caseId, choice: 'end' }
// Continuing lets their advocate bill the time past the hours:
//   POST /api/admin/bill-hours { caseId }   a pay link for every minute past them not yet billed
//   webhook kind 'hours'                    confirmHoursPurchase: paid, so those minutes are theirs
//   checkout expired                        clearHoursCheckout
// Another month adds 20 hours, so its question goes away on its own once paid.

import { getDoc, patchDoc } from './firestore.js';
import { hoursOf, needsChoice, extraCents, hm, money, EXTRA_HOUR_CENTS } from '../public/js/extra-hours.js';

const ID = /^[\w-]{1,64}$/;
const first = (v) => String(v || '').trim().split(/\s+/)[0] || '';
const esc = (v) => String(v).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const ENDED_REASON = 'You ended the case after your month\'s 20 hours. Everything in it stays here for your reference.';
/** Less than a minute past the hours is nothing to bill. */
const MIN_BILL_SEC = 60;

/**
 * The client's choice. `h`: requireUser, json, pingCase, stopClock.
 * Only their own case, only while the question stands; a second tap finds it answered.
 */
export async function handleHoursChoice(request, env, h) {
  const user = await h.requireUser(request, env);
  if (!user) return h.json({ error: 'Sign in required' }, 401);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!ID.test(caseId)) return h.json({ error: 'Bad case' }, 400);
  const choice = body?.choice === 'hourly' ? 'hourly' : body?.choice === 'end' ? 'end' : '';
  if (!choice) return h.json({ error: 'Bad request' }, 400);
  const c = await getDoc(env, `cases/${caseId}`);
  if (!c || c.data.clientUid !== user.uid) return h.json({ error: 'Not found' }, 404);
  if (!needsChoice(c.data)) return h.json({ error: 'There is nothing to choose right now.' }, 409);
  const now = new Date();
  const picked = { kind: choice, month: hoursOf(c.data).months, at: now, ...(choice === 'hourly' ? { rateCents: EXTRA_HOUR_CENTS } : {}) };
  const name = first(c.data.clientName) || 'Your client';
  const link = `/admin-case.html?id=${caseId}`;
  if (choice === 'hourly') {
    const ok = await patchDoc(env, `cases/${caseId}`, { hoursChoice: picked }, { mask: ['hoursChoice'], ifUpdateTime: c.updateTime }).catch(() => false);
    if (ok === false) return h.json({ error: 'That did not save. Try again.' }, 409);
    await h.pingCase(env, c.data, `${name} chose to continue to the end of the month at ${money(EXTRA_HOUR_CENTS)} an hour. Bill the extra hours from their case.`, link).catch(() => {});
    return h.json({ ok: true, choice });
  }
  // Ending it: a clock still running on it is banked first, as any close leaves none running.
  if (c.data.work?.startedAt) await h.stopClock(env, caseId, c.data).catch(() => {});
  await patchDoc(env, `cases/${caseId}`, {
    hoursChoice: picked, status: 'closed', closedAt: now, closedBy: 'client', closedReason: ENDED_REASON,
    closedFromStatus: c.data.status || 'confirmed', pendingExtend: null, extendRequest: null,
  }, { mask: ['hoursChoice', 'status', 'closedAt', 'closedBy', 'closedReason', 'closedFromStatus', 'pendingExtend', 'extendRequest'] });
  await h.pingCase(env, c.data, `${name} ended their case after the month's 20 hours. Everything stays on file.`, link).catch(() => {});
  return h.json({ ok: true, choice });
}

/**
 * Bill extra hours. `h`: requireStaff, staffSees, json, notifyUser, sendEmail, stripePost, baseUrl.
 * Only the case's own advocate (or him), only once the client chose to continue,
 * and only for the minutes past the hours that are not already billed.
 */
export async function handleBillHours(request, env, h) {
  const staff = await h.requireStaff(request, env);
  if (!staff) return h.json({ error: 'Not found' }, 404);
  const body = await request.json().catch(() => ({}));
  const caseId = typeof body?.caseId === 'string' ? body.caseId : '';
  if (!ID.test(caseId)) return h.json({ error: 'Bad case' }, 400);
  const c = await getDoc(env, `cases/${caseId}`);
  if (!c || !h.staffSees(staff, c.data, env)) return h.json({ error: 'Not found' }, 404);
  if (!c.data.fullAccess || c.data.self || c.data.family) return h.json({ error: 'Only a Full-Service case has extra hours.' }, 409);
  // Their yes is for the month they gave it in; a later month asks again.
  if (c.data.hoursChoice?.kind !== 'hourly' || Number(c.data.hoursChoice.month) !== hoursOf(c.data).months)
    return h.json({ error: 'They have not chosen to continue by the hour.' }, 409);
  // One link at a time: a live one is handed back rather than a second they could pay twice.
  const live = c.data.pendingHours;
  if (live?.url && new Date(live.expiresAt || 0).getTime() > Date.now())
    return h.json({ ok: true, url: live.url, seconds: live.seconds, cents: live.cents, already: true });
  const seconds = Math.floor(hoursOf(c.data).extra / 60) * 60;
  if (seconds < MIN_BILL_SEC) return h.json({ error: 'Nothing past the month\'s hours is left to bill.' }, 409);
  const cents = extraCents(seconds);
  const expiresAt = new Date(Date.now() + 23 * 3600_000);
  const session = await h.stripePost(env, '/checkout/sessions', {
    mode: 'payment',
    customer_email: c.data.clientEmail || undefined,
    line_items: [{
      price_data: {
        currency: 'usd',
        product_data: { name: 'Extra advocacy hours', description: `${hm(seconds)} past the month's 20 hours, at ${money(EXTRA_HOUR_CENTS)} an hour.` },
        unit_amount: cents,
      },
      quantity: 1,
    }],
    success_url: `${h.baseUrl}/case.html?id=${caseId}&hourspaid=1`,
    cancel_url: `${h.baseUrl}/case.html?id=${caseId}`,
    expires_at: Math.floor(expiresAt.getTime() / 1000),
    metadata: { kind: 'hours', caseId, uid: c.data.clientUid || '', seconds: String(seconds) },
  });
  const pending = { sessionId: session.id, url: session.url, seconds, cents, createdAt: new Date(), expiresAt, by: staff.uid };
  const wrote = await patchDoc(env, `cases/${caseId}`, { pendingHours: pending }, { mask: ['pendingHours'], ifUpdateTime: c.updateTime }).catch(() => false);
  if (wrote === false) {
    const again = await getDoc(env, `cases/${caseId}`).catch(() => null);
    if (again?.data.pendingHours?.url) return h.json({ ok: true, url: again.data.pendingHours.url, already: true });
  }
  const said = `Your bill for the extra hours is ready: ${hm(seconds)}, ${money(cents)}.`;
  if (c.data.clientUid) await h.notifyUser(env, c.data.clientUid, { title: 'Pocket Advocate', body: said, link: `/case.html?id=${caseId}` }).catch(() => {});
  if (c.data.clientEmail) {
    await h.sendEmail(env, {
      to: c.data.clientEmail,
      subject: 'Your bill for the extra hours',
      html: `<p>${esc(said)}</p>
        <p>That is the time past your month's 20 hours, at ${money(EXTRA_HOUR_CENTS)} an hour, as you chose.</p>
        <p><a href="${esc(session.url)}">Pay now</a> or open your case to pay from there.</p>`,
    }).catch(() => {});
  }
  return h.json({ ok: true, url: session.url, seconds, cents });
}

/** Paid: those minutes are theirs, once per checkout. `h`: pingCase. */
export async function confirmHoursPurchase(env, session, h, attempt = 0) {
  if (attempt > 3) throw new Error(`hours: lock contention on ${session.id}`);
  const caseId = session.metadata?.caseId;
  if (!caseId) return;
  const c = await getDoc(env, `cases/${caseId}`);
  if (!c) throw new Error(`hours: no case for ${session.id}`);
  const payments = Array.isArray(c.data.extraPayments) ? [...c.data.extraPayments] : [];
  if (payments.some((x) => x.sessionId === session.id)) return;
  const seconds = Math.max(0, Math.floor(Number(session.metadata?.seconds) || 0));
  const amountCents = Number.isFinite(Number(session.amount_total)) ? Number(session.amount_total) : extraCents(seconds);
  payments.push({ kind: 'hours', amountCents, sessionId: session.id, at: new Date(), seconds });
  const ok = await patchDoc(env, `cases/${caseId}`, {
    extraPayments: payments,
    hoursBilledSec: Math.max(0, Number(c.data.hoursBilledSec) || 0) + seconds,
    ...(c.data.pendingHours?.sessionId === session.id ? { pendingHours: null } : {}),
  }, { mask: ['extraPayments', 'hoursBilledSec', ...(c.data.pendingHours?.sessionId === session.id ? ['pendingHours'] : [])], ifUpdateTime: c.updateTime }).catch(() => false);
  if (ok === false) return confirmHoursPurchase(env, session, h, attempt + 1);
  await h.pingCase(env, c.data, `${first(c.data.clientName) || 'Your client'} paid for ${hm(seconds)} of extra hours (${money(amountCents)}).`, `/admin-case.html?id=${caseId}`).catch(() => {});
}

/** A bill they opened and walked away from: the advocate can send a fresh one. */
export async function clearHoursCheckout(env, session) {
  const caseId = session.metadata?.caseId;
  if (!caseId) return;
  const c = await getDoc(env, `cases/${caseId}`).catch(() => null);
  if (c?.data.pendingHours?.sessionId === session.id)
    await patchDoc(env, `cases/${caseId}`, { pendingHours: null }, { mask: ['pendingHours'] });
}
