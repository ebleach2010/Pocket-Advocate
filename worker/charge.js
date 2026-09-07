// The hold and the decision (Eric, 2026-09-06): "I would like to be able to
// comp somebody or change charges. So they purchase a tier, but only once I
// approve their case do they get charged, and on the approval/denial screen
// I can tap on the amount charged and change it to any value."
//
// A purchase now AUTHORIZES the card and captures nothing. The case opens
// with a `charge` record in state 'held'; his approval captures the amount he
// set (any figure up to the hold, zero included, which releases the hold and
// opens the case at no charge) and his decline releases the hold and closes
// the case with his reason. Stripe keeps a card hold for seven days; past
// that the hold is 'lapsed', and approving sends a payment link instead.
//
// This file holds the parts that can be run without a network: the record a
// hold opens with, the decision table, and the words. The Stripe calls at the
// bottom are the only things here that reach out.
import { stripePost, stripeGet } from './stripe.js';

/** How long a card authorization stands before the network lets it go. Seven
 *  days for every card brand on an online, customer-initiated payment. */
export const HOLD_DAYS = 7;
/** When he is reminded that a hold is running out: two days before it does. */
export const HOLD_REMIND_AFTER_DAYS = 5;
/** What every held checkout carries, so the webhook can tell a hold from a
 *  payment without trusting payment_status (unpaid on a completed hold). */
export const HOLD_META = { hold: '1' };
export const HOLD_INTENT = { capture_method: 'manual' };
/** The states a decision can still be made in. */
export const UNDECIDED = ['held', 'lapsed', 'invoiced'];

/** True while the case is waiting on him: nothing captured, nothing declined. */
export function chargeUndecided(charge) {
  return !!charge && UNDECIDED.includes(charge.state);
}

/** The charge record a held checkout opens with. Pure. The amount is what
 *  Stripe says can be captured, falling back to the session total. */
export function heldChargeOf(session, pi, now = new Date()) {
  const cents = Number(pi?.amount_capturable) || Number(pi?.amount) || Number(session?.amount_total) || 0;
  return {
    state: 'held',
    kind: session?.metadata?.kind || 'case',
    authorizedCents: cents,
    capturedCents: 0,
    paymentIntentId: pi?.id || session?.payment_intent || null,
    sessionId: session?.id || null,
    heldAt: now,
    expiresAt: new Date(now.getTime() + HOLD_DAYS * 86_400_000),
    decidedAt: null,
    capturedAt: null,
    remindedAt: null,
    ratedAt: null,
  };
}

/** Whole dollars for a sentence. */
export function dollars(cents) {
  return (Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

/**
 * The decision table. Pure: says what the decision means and what Stripe
 * must do for it, before anything is written or called.
 *
 *   { error, code, cap? }                         refused
 *   { op: 'capture' | 'cancel' | 'invoice' | 'none', next: {...} }   accepted
 *
 * `next` is merged over the charge record. A decline carries the reason the
 * client reads word for word, exactly like closing a case does.
 */
export function chargeDecision(charge, { decision, amountCents, reason } = {}, now = new Date()) {
  if (!charge || !charge.state) return { error: 'This case has no held payment to decide.', code: 409 };
  const state = charge.state;
  if (decision === 'decline') {
    if (!UNDECIDED.includes(state)) return { error: 'This case is already decided.', code: 409 };
    const why = typeof reason === 'string' ? reason.trim().slice(0, 500) : '';
    if (!why) return { error: 'Write the reason. The client reads it word for word.', code: 400 };
    return {
      op: state === 'held' ? 'cancel' : 'none',
      next: { state: 'declined', decidedAt: now, releasedAt: now, reason: why },
    };
  }
  if (decision !== 'approve') return { error: 'Bad request', code: 400 };
  // A link that is still live is the decision; one that ran out (Stripe
  // closes a checkout after a day) leaves the case where a lapsed hold does.
  const linkOpen = state === 'invoiced' && charge.invoice?.expiresAt
    && new Date(charge.invoice.expiresAt).getTime() > now.getTime();
  if (linkOpen) return { error: 'A payment link is already out. The case opens when they pay it.', code: 409 };
  const lapsedLike = state === 'lapsed' || state === 'invoiced';
  if (state !== 'held' && !lapsedLike) return { error: 'This case is already decided.', code: 409 };
  const cap = Math.max(0, Math.round(Number(charge.authorizedCents) || 0));
  const amount = amountCents === undefined || amountCents === null ? cap : Number(amountCents);
  if (!Number.isInteger(amount) || amount < 0)
    return { error: 'The amount has to be a whole number of cents, zero or more.', code: 400, cap };
  if (state === 'held' && amount > cap)
    return {
      error: `Up to $${dollars(cap)}, the amount their card is holding. For more, approve at $${dollars(cap)} and charge the rest from Schedule a session.`,
      code: 400, cap,
    };
  if (amount === 0) {
    return {
      op: state === 'held' ? 'cancel' : 'none',
      next: { state: 'comped', capturedCents: 0, decidedAt: now, releasedAt: now },
    };
  }
  if (state === 'held') {
    return { op: 'capture', next: { state: 'captured', capturedCents: amount, decidedAt: now, capturedAt: now } };
  }
  // Lapsed (or a link that ran out): nothing to capture any more; a link for
  // the amount goes out.
  return { op: 'invoice', next: { state: 'invoiced', invoiceCents: amount, decidedAt: now } };
}

/** What the booking part of a case actually paid. With a charge record it is
 *  what was captured and nothing else; without one it is the receipt the
 *  older cases carry. The ledger and the case page both read this. */
export function caseBookingCents(c) {
  if (c?.charge && c.charge.state) return c.charge.state === 'captured' ? Math.max(0, Number(c.charge.capturedCents) || 0) : 0;
  return Number(c?.payment?.amountTotal) || Number(c?.stripe?.amountTotal) || Number(c?.caseRateCents) || 0;
}

/** The client's words, in one place so the page, the email and the push agree. */
export const CHARGE_COPY = {
  held: 'Your card is held, not charged. I read every new case before I take it on, and you are charged only when I do. If I cannot take your case, the hold is released and nothing is charged.',
  approvedCharged: (cents) => `I have taken your case. Your card was charged $${dollars(cents)}.`,
  approvedFree: 'I have taken your case. Nothing was charged.',
  declined: 'Nothing was charged. The hold on your card is released.',
  lapsed: 'The hold on your card lapsed before I decided, so nothing was charged. If I take your case I will send you a link to pay.',
  invoiced: (cents) => `The hold on your card lapsed before I could take your case. Pay $${dollars(cents)} here to open it.`,
};

// ---- Stripe ----------------------------------------------------------------

/** Capture part or all of a hold. A partial capture releases the rest. */
export async function captureHold(env, paymentIntentId, cents) {
  return stripePost(env, `/payment_intents/${paymentIntentId}/capture`, { amount_to_capture: cents });
}

/** Release a hold. A hold that is already gone is not an error here. */
export async function cancelHold(env, paymentIntentId) {
  try {
    return await stripePost(env, `/payment_intents/${paymentIntentId}/cancel`, {});
  } catch (err) {
    if (/already|canceled|cannot be canceled/i.test(String(err.message))) return null;
    throw err;
  }
}

/** The intent as Stripe sees it now: status, amounts. */
export async function readIntent(env, paymentIntentId) {
  return stripeGet(env, `/payment_intents/${paymentIntentId}`);
}
