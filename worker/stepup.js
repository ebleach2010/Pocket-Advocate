// FROM PRIORITY CHAT TO A CASE (Eric, 2026-10-17).
//
// "From chat, they can enhance to advocacy case or full case management and
// just pay the month's difference." Asked how: "Credit $50, end chat". A
// subscriber whose line is renewing books an Advocacy Case, or a first month
// of Full-Service, with their $50 chat month off the price. The booking is a
// card hold like every other, so their advocate accepts or declines it ("All
// case requests get accepted or declined by the advocate they choose"); only
// an accepted case ends the chat line, at the end of the month they paid for,
// because the case chat takes its place. One credit per chat line.
//
//   GET  /api/step-up   what a step up costs this subscriber, or that it is not theirs
//   checkout:  stepUpPrice() prices the booking; createCaseFromSession records chatStepUp
//   approval:  endChatForStepUp() once their advocate accepts the case

import { getDoc, patchDoc } from './firestore.js';

/** His word: "Credit $50". */
export const CHAT_STEP_CREDIT_CENTS = 5000;

const renewingSub = (s) => !!s && (s.status === 'active' || s.status === 'trialing') && s.cancelAtPeriodEnd !== true;

/** This subscriber's step-up credit, or null: no renewing line, or its credit already used. */
export async function chatStepUp(env, uid) {
  if (!uid) return null;
  const sub = await getDoc(env, `subscriptions/${uid}`).catch(() => null);
  if (!sub || !renewingSub(sub.data) || sub.data.stepUpCaseId) return null;
  return { creditCents: CHAT_STEP_CREDIT_CENTS, subscriptionId: sub.data.subscriptionId || null };
}

/** The booking's price: the case fee, or a Full-Service month, less the chat month. */
export function stepUpPrice({ caseCents, fullCents }, { full = false, step = null } = {}) {
  const base = full ? Number(fullCents) || 0 : Number(caseCents) || 0;
  return Math.max(100, base - Math.max(0, Number(step?.creditCents) || 0));
}

/** GET /api/step-up. `h` carries requireUser, json and readRates. */
export async function handleStepUpQuote(request, env, h) {
  const user = await h.requireUser(request, env);
  if (!user) return h.json({ error: 'Sign in required' }, 401);
  const step = await chatStepUp(env, user.uid);
  if (!step) return h.json({ eligible: false, creditCents: 0 });
  const live = await h.readRates(env);
  return h.json({
    eligible: true,
    creditCents: step.creditCents,
    caseCents: stepUpPrice(live, { step }),
    fullCents: stepUpPrice(live, { full: true, step }),
  });
}

/**
 * Their advocate accepted a case booked from chat: the chat line stops
 * renewing (it runs to the end of the month they paid for), and the line is
 * marked so its credit cannot be spent twice. Once per case. `h` carries
 * stripePost.
 */
export async function endChatForStepUp(env, caseId, c, h) {
  const st = c?.chatStepUp;
  if (!st || st.endedAt || !c.clientUid) return false;
  const sub = await getDoc(env, `subscriptions/${c.clientUid}`).catch(() => null);
  const subId = st.subscriptionId || sub?.data?.subscriptionId || '';
  if (subId) await h.stripePost(env, `/subscriptions/${subId}`, { cancel_at_period_end: 'true' });
  const now = new Date();
  if (sub) {
    await patchDoc(env, `subscriptions/${c.clientUid}`, { stepUpCaseId: caseId, stepUpAt: now, cancelAtPeriodEnd: true },
      { mask: ['stepUpCaseId', 'stepUpAt', 'cancelAtPeriodEnd'] });
  }
  await patchDoc(env, `cases/${caseId}`, { chatStepUp: { ...st, endedAt: now } }, { mask: ['chatStepUp'] });
  return true;
}
