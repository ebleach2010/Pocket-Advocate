// charge.mjs - the hold and the decision: a purchase authorizes the card, his
// approval charges the amount he set (zero included), his decline releases it.
//
//   node tools/suites/charge.mjs
//
// Eric, 2026-09-06: "I would like to be able to comp somebody or change
// charges. So they purchase a tier, but only once I approve their case do the
// get charged, and on the approval/denial screen I can tap on the amount
// charged and change it to any value."
//
// What this holds: the decision table (worker/charge.js) run whole; the route
// lifted and run against fakes in every branch, with the order that keeps
// money and record together; the hold on all three checkouts and never on
// the subscription; the webhook's held branch, the lapse and the sweep; the
// telehealth and Full-Service halves; the client's pill and words, the
// booking line, his card and its wiring, the shelf tag, the money lines; the
// demo mirrors and the drive; no dash in anything a person reads.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const SRC = f('worker/charge.js');
const W = f('worker/index.js');
const STRIPE = f('worker/stripe.js');
const CASE = f('public/js/case.js');
const BOOK = f('public/js/book.js');
const RET = f('public/return.html');
const ADMC = f('public/js/admin-case.js');
const ADMIN = f('public/js/admin.js');
const ACSS = f('public/css/admin.css');
const DEMO = f('public/js/demo/api.js');
const DRIVE = f('tools/drives/drive-approval.mjs');
const CL = f('public/js/changelog.js');
const mod = await import(pathToFileURL(j(ROOT, 'worker/charge.js')).href);

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  let inTpl = false;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '`') { inTpl = !inTpl; continue; }
    if (inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const DASH = /[—–]/;
const NOW = new Date('2026-09-07T12:00:00Z');
const day = 86_400_000;

// ---- CH1: the decision table, whole -----------------------------------------
{
  const { chargeDecision, heldChargeOf, caseBookingCents, CHARGE_COPY, HOLD_DAYS } = mod;
  const held = { state: 'held', authorizedCents: 120000, paymentIntentId: 'pi_1' };
  const a1 = chargeDecision(held, { decision: 'approve' }, NOW);
  const a2 = chargeDecision(held, { decision: 'approve', amountCents: 90000 }, NOW);
  const a0 = chargeDecision(held, { decision: 'approve', amountCents: 0 }, NOW);
  const over = chargeDecision(held, { decision: 'approve', amountCents: 120001 }, NOW);
  const neg = chargeDecision(held, { decision: 'approve', amountCents: -5 }, NOW);
  const frac = chargeDecision(held, { decision: 'approve', amountCents: 12.5 }, NOW);
  const dNo = chargeDecision(held, { decision: 'decline' }, NOW);
  const dYes = chargeDecision(held, { decision: 'decline', reason: `  ${'x'.repeat(600)}  ` }, NOW);
  const lapsed = { ...held, state: 'lapsed' };
  const l1 = chargeDecision(lapsed, { decision: 'approve', amountCents: 50000 }, NOW);
  const l0 = chargeDecision(lapsed, { decision: 'approve', amountCents: 0 }, NOW);
  const lBig = chargeDecision(lapsed, { decision: 'approve', amountCents: 500000 }, NOW);
  const lD = chargeDecision(lapsed, { decision: 'decline', reason: 'full' }, NOW);
  const invOpen = { ...held, state: 'invoiced', invoice: { expiresAt: new Date(NOW.getTime() + 3600_000) } };
  const invOld = { ...held, state: 'invoiced', invoice: { expiresAt: new Date(NOW.getTime() - 3600_000) } };
  const i1 = chargeDecision(invOpen, { decision: 'approve', amountCents: 50000 }, NOW);
  const i2 = chargeDecision(invOld, { decision: 'approve', amountCents: 50000 }, NOW);
  const i3 = chargeDecision(invOpen, { decision: 'decline', reason: 'full' }, NOW);
  const done = ['captured', 'comped', 'declined'].map((state) => [
    chargeDecision({ ...held, state }, { decision: 'approve' }, NOW),
    chargeDecision({ ...held, state }, { decision: 'decline', reason: 'x' }, NOW),
  ]);
  const none = chargeDecision(null, { decision: 'approve' }, NOW);
  const bad = chargeDecision(held, { decision: 'maybe' }, NOW);
  const rec = heldChargeOf(
    { id: 'cs_1', amount_total: 120000, payment_intent: 'pi_1', metadata: {} },
    { id: 'pi_1', amount: 120000, amount_capturable: 120000, status: 'requires_capture' }, NOW,
  );
  const tele = heldChargeOf({ id: 'cs_2', amount_total: 52500, metadata: { kind: 'telehealth' } }, { id: 'pi_2', amount_capturable: 52500 }, NOW);
  // NEGATIVE CONTROL (run 2026-09-07): charge.js `if (amount === 0) {` changed to `if (amount === -1) {` made this read
  //   FAIL  CH1 the decision table: a held case captures the hold by default or the amount he set, releases at zero, refuses more than the hold, a decline needs the reason and releases, a lapsed hold invoices or comps, an open link blocks and a dead one does not, a decided case refuses both ways, the held record carries the intent and a seven-day clock, and the booking figure is what was captured and nothing else
  check('CH1 the decision table: a held case captures the hold by default or the amount he set, releases at zero, refuses more than the hold, a decline needs the reason and releases, a lapsed hold invoices or comps, an open link blocks and a dead one does not, a decided case refuses both ways, the held record carries the intent and a seven-day clock, and the booking figure is what was captured and nothing else',
    a1.op === 'capture' && a1.next.state === 'captured' && a1.next.capturedCents === 120000
    && a2.op === 'capture' && a2.next.capturedCents === 90000 && a2.next.capturedAt === NOW
    && a0.op === 'cancel' && a0.next.state === 'comped' && a0.next.capturedCents === 0 && a0.next.releasedAt === NOW
    && over.code === 400 && over.cap === 120000 && /Up to \$1,200, the amount their card is holding/.test(over.error)
    && neg.code === 400 && frac.code === 400
    && dNo.code === 400 && /Write the reason/.test(dNo.error)
    && dYes.op === 'cancel' && dYes.next.state === 'declined' && dYes.next.reason.length === 500 && dYes.next.releasedAt === NOW
    && l1.op === 'invoice' && l1.next.state === 'invoiced' && l1.next.invoiceCents === 50000
    && l0.op === 'none' && l0.next.state === 'comped'
    && lBig.op === 'invoice' && lBig.next.invoiceCents === 500000
    && lD.op === 'none' && lD.next.state === 'declined'
    && i1.code === 409 && /already out/.test(i1.error)
    && i2.op === 'invoice' && i2.next.invoiceCents === 50000
    && i3.op === 'none' && i3.next.state === 'declined'
    && done.every(([a, b]) => a.code === 409 && b.code === 409)
    && none.code === 409 && bad.code === 400
    && rec.state === 'held' && rec.authorizedCents === 120000 && rec.capturedCents === 0 && rec.paymentIntentId === 'pi_1'
    && rec.sessionId === 'cs_1' && rec.kind === 'case' && rec.heldAt === NOW
    && rec.expiresAt.getTime() === NOW.getTime() + HOLD_DAYS * day && HOLD_DAYS === 7
    && tele.kind === 'telehealth' && tele.authorizedCents === 52500
    && caseBookingCents({ charge: rec, stripe: { amountTotal: 120000 } }) === 0
    && caseBookingCents({ charge: { state: 'captured', capturedCents: 90000 }, stripe: { amountTotal: 120000 } }) === 90000
    && caseBookingCents({ charge: { state: 'comped', capturedCents: 0 }, stripe: { amountTotal: 120000 } }) === 0
    && caseBookingCents({ charge: { state: 'declined' }, caseRateCents: 120000 }) === 0
    && caseBookingCents({ stripe: { amountTotal: 110000 }, caseRateCents: 120000 }) === 110000
    && caseBookingCents({ caseRateCents: 120000 }) === 120000
    && /\$900\./.test(CHARGE_COPY.approvedCharged(90000)) && /\$500 here/.test(CHARGE_COPY.invoiced(50000))
    && !DASH.test(SRC),
    JSON.stringify({ a1, a2, a0, over, dYes: dYes.next?.state, l1, i1: i1.code, i2: i2.op, rec }));
}

// ---- CH2: the route, lifted and run in every branch ------------------------
{
  const body = lift(W, 'async function handleCaseCharge(request, env) {');
  const names = ['requireAdmin', 'json', 'getDoc', 'chargeDecision', 'captureHold', 'readIntent', 'patchDoc',
    'stripePost', 'caseLineItems', 'raiseRates', 'cancelHold', 'releaseSlotOfCase', 'CHARGE_COPY', 'notifyUser',
    'sendEmail', 'escHtml', 'console'];
  const mk = body ? new Function(...names, `return ${body}`) : null;
  const run = async (c, req, { captureFails = null, intent = null, admin = { uid: 'eric' } } = {}) => {
    const log = [];
    const fakes = {
      requireAdmin: async () => admin,
      json: (o, s = 200) => ({ o, s }),
      getDoc: async () => (c ? { id: 'c1', data: c, updateTime: 't1' } : null),
      chargeDecision: mod.chargeDecision,
      captureHold: async (env, pi, cents) => { log.push(['capture', pi, cents]); if (captureFails) throw new Error(captureFails); return { amount_received: cents }; },
      readIntent: async () => intent,
      patchDoc: async (env, path, fields, opts) => { log.push(['patch', path, fields, opts]); return true; },
      stripePost: async (env, path, params) => { log.push(['stripe', path, params]); return { id: 'cs_link', url: 'https://pay.test/x' }; },
      caseLineItems: (cents) => [{ price_data: { unit_amount: cents } }],
      raiseRates: async () => { log.push(['raise']); },
      cancelHold: async (env, pi) => { log.push(['cancel', pi]); },
      releaseSlotOfCase: async (env, id) => { log.push(['slot', id]); },
      CHARGE_COPY: mod.CHARGE_COPY,
      notifyUser: async (env, uid, n) => { log.push(['notify', uid, n.body]); },
      sendEmail: async (env, m) => { log.push(['mail', m.subject, m.html]); },
      escHtml: (s) => String(s),
      console: { warn() {}, error() {} },
    };
    const fn = mk(...names.map((n) => fakes[n]));
    const out = await fn({ json: async () => req }, { PUBLIC_BASE_URL: 'https://x.test' });
    return { out, log };
  };
  const base = {
    clientUid: 'u1', clientEmail: 'c@x.test', clientName: 'Pat Q', hold: { totalMs: 5 },
    charge: { state: 'held', authorizedCents: 120000, capturedCents: 0, paymentIntentId: 'pi_1', heldAt: NOW },
  };
  const idx = (log, kind) => log.findIndex((e) => e[0] === kind);
  const patchOf = (log) => log.filter((e) => e[0] === 'patch').map((e) => e[2]);
  const a = await run(base, { caseId: 'c1', decision: 'approve', amountCents: 90000 });
  const aP = patchOf(a.log)[0];
  const z = await run(base, { caseId: 'c1', decision: 'approve', amountCents: 0 });
  const zP = patchOf(z.log)[0];
  const dec = await run(base, { caseId: 'c1', decision: 'decline', reason: 'I am full this month.' });
  const dP = patchOf(dec.log)[0];
  const lapse = await run(base, { caseId: 'c1', decision: 'approve', amountCents: 90000 }, { captureFails: 'stripe: canceled', intent: { status: 'canceled' } });
  const twice = await run(base, { caseId: 'c1', decision: 'approve', amountCents: 90000 }, { captureFails: 'stripe: already captured', intent: { status: 'succeeded', amount_received: 90000 } });
  const other = await run(base, { caseId: 'c1', decision: 'approve', amountCents: 90000 }, { captureFails: 'stripe: card_declined', intent: { status: 'requires_capture' } });
  const link = await run({ ...base, charge: { ...base.charge, state: 'lapsed' } }, { caseId: 'c1', decision: 'approve', amountCents: 50000 });
  const lP = patchOf(link.log)[0];
  const stranger = await run(base, { caseId: 'c1', decision: 'approve' }, { admin: null });
  const own = await run({ ...base, self: true }, { caseId: 'c1', decision: 'approve' });
  const over = await run(base, { caseId: 'c1', decision: 'approve', amountCents: 200000 });
  const bare = await run({ clientUid: 'u1' }, { caseId: 'c1', decision: 'approve' });
  // NEGATIVE CONTROL (run 2026-09-07): the route's `if (approved && !ch.ratedAt) await raiseRates(env)` changed to `if (false && ...)` made this read
  //   FAIL  CH2 the route: approve captures the amount he set, writes captured, raises the rate once and tells the client the figure; zero writes comped before releasing the hold, raises the rate and says nothing was charged; decline needs the reason, writes closed with it, releases the hold after the record, gives the slot back, raises nothing and says so; a capture Stripe refuses reads the intent back (gone marks the hold lapsed and answers 409, captured already counts as done, anything else answers 502 and writes nothing); a lapsed hold sends a link for the amount; a stranger gets 404, his own case 409, more than the hold 400 with the cap, a case with no hold 409
  check('CH2 the route: approve captures the amount he set, writes captured, raises the rate once and tells the client the figure; zero writes comped before releasing the hold, raises the rate and says nothing was charged; decline needs the reason, writes closed with it, releases the hold after the record, gives the slot back, raises nothing and says so; a capture Stripe refuses reads the intent back (gone marks the hold lapsed and answers 409, captured already counts as done, anything else answers 502 and writes nothing); a lapsed hold sends a link for the amount; a stranger gets 404, his own case 409, more than the hold 400 with the cap, a case with no hold 409',
    !!body
    && a.out.s === 200 && a.log[0][0] === 'capture' && a.log[0][2] === 90000 && aP.charge.state === 'captured' && aP.charge.capturedCents === 90000
    && !!aP.charge.ratedAt && a.log.filter((e) => e[0] === 'raise').length === 1 && idx(a.log, 'capture') < idx(a.log, 'patch')
    && a.log.some((e) => e[0] === 'notify' && /charged \$900\./.test(e[2])) && a.log.some((e) => e[0] === 'mail' && e[1] === 'I have taken your case')
    && z.out.s === 200 && zP.charge.state === 'comped' && zP.charge.capturedCents === 0 && idx(z.log, 'patch') < idx(z.log, 'cancel')
    && z.log.some((e) => e[0] === 'raise') && z.log.some((e) => e[0] === 'notify' && /Nothing was charged\./.test(e[2]))
    && dec.out.s === 200 && dP.status === 'closed' && dP.closedReason === 'I am full this month.' && dP.charge.state === 'declined'
    && idx(dec.log, 'patch') < idx(dec.log, 'cancel') && dec.log.some((e) => e[0] === 'slot' && e[1] === 'c1')
    && !dec.log.some((e) => e[0] === 'raise') && dec.log.some((e) => e[0] === 'notify' && /^I cannot take your case\. Nothing was charged\./.test(e[2]))
    && dec.log.some((e) => e[0] === 'mail' && /I am full this month\./.test(e[2]) && /hold on your card is released/.test(e[2]))
    && lapse.out.s === 409 && lapse.out.o.lapsed === true && patchOf(lapse.log)[0].charge.state === 'lapsed' && !lapse.log.some((e) => e[0] === 'raise')
    && twice.out.s === 200 && patchOf(twice.log)[0].charge.state === 'captured' && patchOf(twice.log)[0].charge.capturedCents === 90000
    && other.out.s === 502 && !other.log.some((e) => e[0] === 'patch')
    && link.out.s === 200 && lP.charge.state === 'invoiced' && lP.charge.invoice.url === 'https://pay.test/x' && lP.charge.invoice.cents === 50000
    && link.log.some((e) => e[0] === 'stripe' && e[1] === '/checkout/sessions' && e[2].metadata.kind === 'casecharge' && e[2].line_items[0].price_data.unit_amount === 50000)
    && !link.log.some((e) => e[0] === 'raise') && link.log.some((e) => e[0] === 'notify' && /Pay \$500 here/.test(e[2]))
    && stranger.out.s === 404 && own.out.s === 409 && over.out.s === 400 && over.out.o.cap === 120000 && bare.out.s === 409,
    JSON.stringify({ a: [a.out.s, a.log.map((e) => e[0])], z: [z.out.s, z.log.map((e) => e[0])], dec: [dec.out.s, dec.log.map((e) => e[0])], lapse: lapse.out, twice: twice.out.s, other: other.out.s, link: link.out.s, stranger: stranger.out.s, own: own.out.s, over: over.out, bare: bare.out.s }));
}

// ---- CH3: the hold on the checkouts, the webhook's held branch, the case ----
{
  const subBlock = (W.match(/mode: 'subscription',[\s\S]{0,900}?\}\);/) || [''])[0];
  const held = lift(W, 'async function onHeldSession(env, session) {');
  const runHeld = async (pi, kind = '') => {
    const calls = [];
    const fn = new Function('readIntent', 'confirmTelehealthPurchase', 'createCaseFromSession', `return ${held}`)(
      async () => pi,
      async (env, s, o) => { calls.push(['tele', o.held]); },
      async (env, s, o) => { calls.push(['case', o.held]); },
    );
    await fn({}, { payment_intent: 'pi_1', metadata: { kind } });
    return calls;
  };
  const h1 = await runHeld({ id: 'pi_1', status: 'requires_capture' });
  const h2 = await runHeld({ id: 'pi_1', status: 'succeeded' });
  const h3 = await runHeld({ id: 'pi_1', status: 'requires_payment_method' });
  const h4 = await runHeld({ id: 'pi_1', status: 'requires_capture' }, 'telehealth');
  const h5 = await runHeld(null);
  // NEGATIVE CONTROL (run 2026-09-07): createCaseFromSession's `if (created && !held) await raiseRates` changed to `if (created) await raiseRates` made this read
  //   FAIL  CH3 the slot checkout, the requested-time checkout and the telehealth checkout hold the card and are flagged as holds, the subscription is neither, the webhook reads a flagged session's intent back before the settlement branch and opens the case or the request only on a standing hold (a hand-captured intent opens it paid, anything else opens nothing), a cancelled intent and a paid case link each have their branch, the case opens with the held record and raises the rate only when paid outright, he is pinged to decide, the mail says the card is held, and the route is registered
  check('CH3 the slot checkout, the requested-time checkout and the telehealth checkout hold the card and are flagged as holds, the subscription is neither, the webhook reads a flagged session\'s intent back before the settlement branch and opens the case or the request only on a standing hold (a hand-captured intent opens it paid, anything else opens nothing), a cancelled intent and a paid case link each have their branch, the case opens with the held record and raises the rate only when paid outright, he is pinged to decide, the mail says the card is held, and the route is registered',
    (W.match(/payment_intent_data: HOLD_INTENT,/g) || []).length === 3
    && (W.match(/\.\.\.HOLD_META,/g) || []).length === 3
    && !!subBlock && !/HOLD_INTENT|HOLD_META/.test(subBlock)
    && /import \{\n\s+HOLD_META, HOLD_INTENT, HOLD_DAYS, HOLD_REMIND_AFTER_DAYS, heldChargeOf,/.test(W)
    && W.indexOf("obj.metadata?.hold === '1' && obj.payment_intent") < W.indexOf("obj.payment_status && obj.payment_status !== 'paid'")
    && /if \(event\.type === 'checkout\.session\.completed'\) await onHeldSession\(env, obj\);/.test(W)
    && /else if \(event\.type === 'payment_intent\.canceled'\) \{\n[\s\S]{0,300}?await onIntentCanceled\(env, obj\);/.test(W)
    && /else if \(obj\.metadata\?\.kind === 'casecharge'\) await confirmCaseCharge\(env, obj\);/.test(W)
    && JSON.stringify(h1) === JSON.stringify([['case', { id: 'pi_1', status: 'requires_capture' }]])
    && JSON.stringify(h2) === JSON.stringify([['case', null]]) && h3.length === 0 && h5.length === 0
    && h4.length === 1 && h4[0][0] === 'tele' && h4[0][1]?.status === 'requires_capture'
    && /async function createCaseFromSession\(env, session, \{ held = null \} = \{\}\) \{/.test(W)
    && /charge: held \? heldChargeOf\(session, held, now\) : null,/.test(W)
    && /if \(created && !held\) await raiseRates\(env\)/.test(W)
    && /if \(created && held\) \{\n\s+await pingAdmins\(env,\n\s+`\$\{firstName\(m\.name\) \|\| 'A client'\} booked a case\. Their card is held, not charged: approve or decline it\.`/.test(W)
    && /subject: held \? 'Your Pocket Advocate case is in' : 'Your Pocket Advocate case is open',/.test(W)
    && /\$\{held \? escHtml\(CHARGE_COPY\.held\) : 'Payment confirmed/.test(W)
    && /url\.pathname === '\/api\/admin\/case-charge' && request\.method === 'POST'/.test(W)
    && /^\/\/   POST   \/api\/admin\/case-charge/m.test(W)
    && /export async function stripeGet\(env, path\) \{/.test(STRIPE),
    JSON.stringify({ h1, h2, h3, h4, h5, holds: (W.match(/payment_intent_data: HOLD_INTENT,/g) || []).length }));
}

// ---- CH4: the lapse and the sweep ------------------------------------------
{
  const canceled = lift(W, 'async function onIntentCanceled(env, pi) {');
  const sweep = lift(W, 'async function holdSweep(env) {');
  const mkFakes = (rows, intent) => {
    const log = [];
    const fakes = {
      queryDocs: async () => rows,
      patchDoc: async (env, path, fields) => { log.push(['patch', path, fields]); return true; },
      pingAdmins: async (env, body) => { log.push(['ping', body]); },
      notifyUser: async (env, uid, n) => { log.push(['notify', uid, n.body]); },
      readIntent: async () => intent,
      raiseRates: async () => { log.push(['raise']); },
      firstName: (s) => String(s || '').split(' ')[0],
      CHARGE_COPY: mod.CHARGE_COPY,
      HOLD_DAYS: mod.HOLD_DAYS,
      HOLD_REMIND_AFTER_DAYS: mod.HOLD_REMIND_AFTER_DAYS,
      Date,
    };
    return { log, fakes };
  };
  const names = ['queryDocs', 'patchDoc', 'pingAdmins', 'notifyUser', 'readIntent', 'raiseRates', 'firstName', 'CHARGE_COPY', 'HOLD_DAYS', 'HOLD_REMIND_AFTER_DAYS'];
  const runCanceled = async (row) => {
    const { log, fakes } = mkFakes(row ? [row] : [], null);
    await new Function(...names, `return ${canceled}`)(...names.map((n) => fakes[n]))({}, { id: 'pi_1' });
    return log;
  };
  const runSweep = async (rows, intent) => {
    const { log, fakes } = mkFakes(rows, intent);
    await new Function(...names, `return ${sweep}`)(...names.map((n) => fakes[n]))({});
    return log;
  };
  const heldRow = (ageDays, extra = {}) => ({
    id: 'c1', updateTime: 't', data: { clientUid: 'u1', clientName: 'Pat Q', charge: { state: 'held', paymentIntentId: 'pi_1', heldAt: new Date(Date.now() - ageDays * day), authorizedCents: 120000, ...extra } },
  });
  const l1 = await runCanceled(heldRow(2));
  const l2 = await runCanceled({ ...heldRow(2), data: { ...heldRow(2).data, charge: { ...heldRow(2).data.charge, state: 'declined' } } });
  const l3 = await runCanceled(null);
  const s1 = await runSweep([heldRow(5.5)], null);
  const s2 = await runSweep([heldRow(5.5, { remindedAt: new Date() })], null);
  const s3 = await runSweep([heldRow(7.5)], { status: 'canceled' });
  const s4 = await runSweep([heldRow(7.5)], { status: 'succeeded', amount_received: 120000 });
  const s5 = await runSweep([heldRow(7.5)], { status: 'requires_capture' });
  const s6 = await runSweep([heldRow(2)], null);
  // NEGATIVE CONTROL (run 2026-09-07): holdSweep's `ageDays >= HOLD_REMIND_AFTER_DAYS && !ch.remindedAt` changed to `&& ch.remindedAt` made this read
  //   FAIL  CH4 a cancelled intent marks only a case still held as lapsed and tells both sides, and the sweep reminds him once two days before a hold runs out, marks a hold Stripe let go as lapsed, writes a hand capture down as captured, and leaves a young hold and a standing one alone
  check('CH4 a cancelled intent marks only a case still held as lapsed and tells both sides, and the sweep reminds him once two days before a hold runs out, marks a hold Stripe let go as lapsed, writes a hand capture down as captured, and leaves a young hold and a standing one alone',
    !!canceled && !!sweep
    && l1.some((e) => e[0] === 'patch' && e[2].charge.state === 'lapsed') && l1.some((e) => e[0] === 'ping' && /lapsed before you decided/.test(e[1]))
    && l1.some((e) => e[0] === 'notify' && e[1] === 'u1' && e[2] === mod.CHARGE_COPY.lapsed)
    && l2.length === 0 && l3.length === 0
    && s1.some((e) => e[0] === 'patch' && !!e[2].charge.remindedAt) && s1.some((e) => e[0] === 'ping' && /lapses in about two days/.test(e[1]))
    && s2.length === 0
    && s3.some((e) => e[0] === 'patch' && e[2].charge.state === 'lapsed') && s3.some((e) => e[0] === 'ping' && /lapsed before you decided/.test(e[1])) && s3.some((e) => e[0] === 'notify')
    && s4.some((e) => e[0] === 'patch' && e[2].charge.state === 'captured' && e[2].charge.capturedCents === 120000 && e[2].charge.byHand === true) && s4.some((e) => e[0] === 'raise')
    && !s5.some((e) => e[0] === 'patch' && e[2].charge.state !== 'held') && s5.some((e) => e[0] === 'ping' && /lapses in about two days/.test(e[1]))
    && s6.length === 0
    && /ctx\.waitUntil\(holdSweep\(env\)\);/.test(W) && mod.HOLD_REMIND_AFTER_DAYS === 5,
    JSON.stringify({ l1: l1.map((e) => e[0]), l2, s1: s1.map((e) => e[0]), s2, s3: s3.map((e) => e[0]), s4: s4.map((e) => e[0]), s5: s5.map((e) => e[0]), s6 }));
}

// ---- CH5: telehealth, held not paid ----------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the deny's `if (heldNow) await cancelHold(env, p.paymentIntentId)` changed to `if (false) await cancelHold(...)` made this read
//   FAIL  CH5 telehealth: the request holds the card and says so on the receipt, the webhook writes the hold on the request and pushes no payment, confirming captures the amount he set up to the hold (zero releases; a lapsed hold can only confirm at no charge) and writes captured money down, declining releases the hold with nothing to refund and says so, his card and the client's card carry the held words, and the demo mirrors it
check('CH5 telehealth: the request holds the card and says so on the receipt, the webhook writes the hold on the request and pushes no payment, confirming captures the amount he set up to the hold (zero releases; a lapsed hold can only confirm at no charge) and writes captured money down, declining releases the hold with nothing to refund and says so, his card and the client\'s card carry the held words, and the demo mirrors it',
  /line_items: telehealthLineItems\(TELEHEALTH_PRICE_CENTS\),\n\s+payment_intent_data: HOLD_INTENT,/.test(W)
  && /Your card is held now and charged only when he confirms he can attend\./.test(W)
  && /async function confirmTelehealthPurchase\(env, session, \{ held = null \} = \{\}\) \{/.test(W)
  && /if \(!held\) payments\.push\(\{ kind: 'telehealth'/.test(W)
  && /heldCents: held \? \(Number\(held\.amount_capturable\) \|\| total\) : 0,\n\s+paymentIntentId: held \? held\.id : null,\n\s+holdState: held \? 'held' : null,/.test(W)
  && /if \(p\.paymentIntentId && \(p\.holdState === 'held' \|\| p\.holdState === 'lapsed'\)\) \{/.test(W)
  && /if \(!Number\.isInteger\(asked\) \|\| asked < 0 \|\| asked > cap\)\n\s+return json\(\{ error: `Up to \$\$\{chargeDollars\(cap\)\}, the amount their card is holding; 0 confirms at no charge\.`, cap \}, 400\);/.test(W)
  && /if \(p\.holdState === 'lapsed' && asked > 0\)\n\s+return json\(/.test(W)
  && /payments\.push\(\{ kind: 'telehealth', amountCents: paidCents, sessionId: p\.sessionId \|\| null, at: new Date\(\) \}\);/.test(W)
  && /if \(p\.holdState === 'held'\) await cancelHold\(env, p\.paymentIntentId\)\.catch\(\(\) => \{\}\);/.test(W)
  && /const heldNow = !!p\.paymentIntentId && p\.holdState === 'held';/.test(W)
  && /released: !!p\.paymentIntentId && !p\.paidCents,/.test(W)
  && /if \(heldNow\) await cancelHold\(env, p\.paymentIntentId\)\.catch\(\(\) => \{\}\);/.test(W)
  && /Nothing was charged; the hold on your card is released\.'/.test(W)
  && /Your card is held, not charged, until I confirm\./.test(CASE)
  && /Nothing was charged; the hold on your card is released/.test(CASE)
  && /Their card is holding \$\$\{\(Number\(c\.pendingTelehealth\.heldCents\) \/ 100\)\.toFixed\(0\)\}, not charged\./.test(ADMC)
  && /Charge them how much\? Their card is holding \$/.test(ADMC)
  && /body: JSON\.stringify\(\{ caseId, action, amountCents \}\),/.test(ADMC)
  && /if \(p\.paymentIntentId && p\.holdState === 'held'\) \{\n\s+const cap = Number\(p\.heldCents\) \|\| 0;/.test(DEMO)
  && /released: !!p\.paymentIntentId && !p\.paidCents,/.test(DEMO));

// ---- CH6: Full-Service, the amount his ---------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): handleFullRequestDecision's `if (cents === 0) {` changed to `if (cents === -1) {` made this read
//   FAIL  CH6 Full-Service approval takes the amount he typed (the quoted month by default), refuses a bad one, opens the month at no charge with no link when it is zero through the same landing a paid link has, sends the link for any other figure, the card asks for the figure and carries it on both posts, and the demo honours it
check('CH6 Full-Service approval takes the amount he typed (the quoted month by default), refuses a bad one, opens the month at no charge with no link when it is zero through the same landing a paid link has, sends the link for any other figure, the card asks for the figure and carries it on both posts, and the demo honours it',
  /const asked = body\?\.amountCents;\n\s+const cents = asked === undefined \|\| asked === null \? quoted : Number\(asked\);\n\s+if \(!Number\.isInteger\(cents\) \|\| cents < 0 \|\| cents > 2_000_000\)/.test(W)
  && /if \(cents === 0\) \{\n[\s\S]{0,700}?await confirmFullAccessPurchase\(env, \{\n\s+id: `comp_\$\{caseId\}_\$\{Date\.now\(\)\}`, amount_total: 0,\n\s+metadata: \{ caseId, ackAt: String\(req\.ackAt \|\| Date\.now\(\)\), comped: '1' \},\n\s+\}\);/.test(W)
  && /return json\(\{ ok: true, state: 'started', cents: 0, comped: true \}\);/.test(W)
  && /line_items: fullAccessLineItems\(cents\),/.test(W)
  && /First month, in dollars\. They were quoted \$/.test(ADMC)
  && (ADMC.match(/body: JSON\.stringify\(\{ caseId, decision, reason, amountCents/g) || []).length === 2
  && /const asked = body\.amountCents === undefined \|\| body\.amountCents === null \? null : Number\(body\.amountCents\);/.test(DEMO)
  && /const amount = asked === null \? \(Number\(req\.firstMonthCents\) \|\| 0\) : asked;/.test(DEMO));

// ---- CH7: the pages ----------------------------------------------------------
{
  const paid = lift(ADMC, 'function paidCents(c) {');
  const paidCents = new Function('caseRate', `return ${paid}`)((c) => Number(c?.caseRateCents) || 0);
  const held = { charge: { state: 'held', authorizedCents: 120000, capturedCents: 0 }, stripe: { amountTotal: 120000 }, caseRateCents: 120000 };
  const cap = { charge: { state: 'captured', capturedCents: 90000 }, stripe: { amountTotal: 120000 }, caseRateCents: 120000, extraPayments: [{ kind: 'followup', amountCents: 32500 }, { kind: 'tip', amountCents: 500 }] };
  const comp = { charge: { state: 'comped', capturedCents: 0 }, stripe: { amountTotal: 120000 }, caseRateCents: 120000 };
  const tier = { charge: { state: 'captured', capturedCents: 90000 }, stripe: { amountTotal: 120000 }, caseRateCents: 120000, fullAccess: true, fullAccessRateCents: 120000 + 440000, extraPayments: [{ kind: 'fullaccess', amountCents: 440000 }] };
  const old = { stripe: { amountTotal: 120000 }, caseRateCents: 120000 };
  const notice = (CASE.match(/function chargeNotice\(c\) \{[\s\S]*?\n\}/) || [''])[0];
  const heldLine = (notice.match(/\? '([^']+)'\n\s+: linkOpen/) || [])[1] || '';
  const bookLine = (BOOK.match(/data-hold-line>([^<]+)</) || [])[1] || '';
  const card = (ADMC.match(/function chargeCard\(c\) \{[\s\S]*?\n\}/) || [''])[0];
  const wire = lift(ADMC, 'function wireChargeCard(card, c) {');
  // NEGATIVE CONTROL (run 2026-09-07): paidCents's `c.charge.state === 'captured' ? Math.max(0, Number(c.charge.capturedCents) || 0) : 0` changed to `=== 'held' ?` made this read
  //   FAIL  CH7 the pages: the client's pill reads AWAITING APPROVAL while the hold waits, the card under it says the Worker's exact words, a declined case says nothing was charged under the reason, the booking page says the card is held before the button and the return page after, his card carries the tappable amount and posts the decision with it to the route, the shelf tags a case waiting on him, the amount is 44px tall, the six admin pages load the bumped stylesheet, and what a case paid is what was captured: nothing held, nothing comped, the month on top on the tier, the old receipt on an old case
  check('CH7 the pages: the client\'s pill reads AWAITING APPROVAL while the hold waits, the card under it says the Worker\'s exact words, a declined case says nothing was charged under the reason, the booking page says the card is held before the button and the return page after, his card carries the tappable amount and posts the decision with it to the route, the shelf tags a case waiting on him, the amount is 44px tall, the six admin pages load the bumped stylesheet, and what a case paid is what was captured: nothing held, nothing comped, the month on top on the tier, the old receipt on an old case',
    /return CHARGE_WAITING\.includes\(c\?\.charge\?\.state\) \? 'AWAITING APPROVAL' : '';/.test(CASE)
    && (CASE.match(/chargeLabel\(c\) \|\| STATUS_LABEL\[c\.status\] \|\| c\.status/g) || []).length === 2
    && /\$\{closedNotice\(c\)\}\n\s+\$\{chargeNotice\(c\)\}/.test(CASE)
    && heldLine === mod.CHARGE_COPY.held
    && /data-charge-released>Nothing was charged\. The hold on your card is released\.<\/p>/.test(CASE)
    && bookLine === `Your card is held today, not charged. ${mod.CHARGE_COPY.held.replace(/^Your card is held, not charged\. /, '')}`
    && /<button class="btn cta" id="pay">Book, \$\$\{money\(caseCents\)\} held<\/button>/.test(BOOK)
    && /your card is held as normal/.test(BOOK) && /Case fees are non-refundable once I have taken your case\./.test(BOOK)
    && /Your card is held, not charged\. I am opening your case now/.test(RET)
    && /\$\{chargeUndecided\(c\.charge\) \? chargeCard\(c\) : ''\}/.test(ADMC)
    && /data-charge-card/.test(card) && /data-charge-tap/.test(card) && /data-charge-in/.test(card) && /data-charge="approve"/.test(card) && /data-charge="decline"/.test(card)
    && /0 takes the case at no charge\./.test(card)
    && /fetch\('\/api\/admin\/case-charge', \{/.test(wire) && /body: JSON\.stringify\(\{ caseId, decision, amountCents, reason \}\),/.test(wire)
    && /if \(ch\.state === 'held' && amountCents > cap\) \{ say\(/.test(wire)
    && /const chargeEl = pane\.querySelector\('\[data-charge-card\]'\);\n\s+if \(chargeEl\) wireChargeCard\(chargeEl, c\);/.test(ADMC)
    && (ADMIN.match(/\$\{chargeTag\(c\)\}/g) || []).length === 2 && /APPROVE OR DECLINE · \$\{what\}/.test(ADMIN)
    && /stripeTook\(c\)/.test(ADMIN)
    && /^\.charge-amt \{[\s\S]*?min-height: 44px;/m.test(ACSS)
    && ['admin-availability', 'admin-calendar', 'admin-case', 'admin-chats', 'admin-dictionary', 'admin'].every((p) => /admin\.css\?v=stat111/.test(f(`public/${p}.html`)))
    && paidCents(held) === 0 && paidCents(cap) === 90000 + 32500 && paidCents(comp) === 0 && paidCents(tier) === 90000 + 440000 && paidCents(old) === 120000,
    JSON.stringify({ heldLine, bookLine, paid: [paidCents(held), paidCents(cap), paidCents(comp), paidCents(tier), paidCents(old)] }));
}

// ---- CH8: the money lines, the demo, the drive, the words --------------------
// NEGATIVE CONTROL (run 2026-09-07): the ledger's `Number(c.paidOverrideCents) || caseBookingCents(c)` changed to `|| Number(c.stripe?.amountTotal)` made this read
//   FAIL  CH8 the ledger reads what was captured, the demo's booking opens on a hold and its decision mirror approves at any amount up to the hold (zero comps) or declines with the reason and closes, the drive walks a hold from booking to approve, decline and comp, the version notes tell clients the card is held, and no dash is in anything a person reads
check('CH8 the ledger reads what was captured, the demo\'s booking opens on a hold and its decision mirror approves at any amount up to the hold (zero comps) or declines with the reason and closes, the drive walks a hold from booking to approve, decline and comp, the version notes tell clients the card is held, and no dash is in anything a person reads',
  /g\.paidCents \+= Number\(c\.paidOverrideCents\) \|\| caseBookingCents\(c\);/.test(W)
  && /charge: \{\n\s+state: 'held', kind: 'case', authorizedCents: 120000, capturedCents: 0,\n\s+paymentIntentId: 'pi_demo_booked', sessionId: 'cs_demo_booked',/.test(DEMO)
  && /if \(path === '\/api\/admin\/case-charge'\) \{/.test(DEMO)
  && /if \(ch\.state === 'held' && amount > cap\)\n\s+return fail\(400,/.test(DEMO)
  && /\? \{ \.\.\.ch, state: 'comped', capturedCents: 0, decidedAt: now, releasedAt: now, ratedAt: now \}/.test(DEMO)
  && /status: 'closed', closedAt: now, closedBy: 'advocate', closedReason: reason,\n\s+charge: \{ \.\.\.ch, state: 'declined'/.test(DEMO)
  && /AWAITING APPROVAL/.test(DRIVE) && /data-charge-tap/.test(DRIVE) && /data-charge-released/.test(DRIVE) && /comped|no charge/.test(DRIVE)
  && /version: '3\.0',/.test(CL) && /card is held/.test((CL.match(/version: '3\.0',[\s\S]*?admin: \[/) || [''])[0])
  && !DASH.test((CASE.match(/function chargeNotice\(c\) \{[\s\S]*?\n\}/) || [''])[0])
  && !DASH.test((BOOK.match(/data-hold-line>[^<]+</) || [''])[0])
  && !DASH.test((ADMC.match(/function chargeCard\(c\) \{[\s\S]*?\n\}/) || [''])[0])
  && !DASH.test(lift(ADMC, 'function wireChargeCard(card, c) {'))
  && !DASH.test(lift(W, 'async function handleCaseCharge(request, env) {'))
  && !DASH.test((CL.match(/version: '3\.0',[\s\S]*?\},/) || [''])[0]));

// ---- CH9: the two lines that still said paid (v3.1) --------------------------
{
  const line = lift(CASE, 'function confirmedLine(c) {');
  const shown = lift(CASE, 'function paidShownCents(c) {');
  const paidShownCents = new Function(`return ${shown}`)();
  const confirmedLine = new Function('paidShownCents', `return ${line}`)(paidShownCents);
  const held = { status: 'confirmed', charge: { state: 'held', authorizedCents: 120000 }, stripe: { amountTotal: 120000 } };
  const cap = { status: 'confirmed', charge: { state: 'captured', capturedCents: 90000 }, stripe: { amountTotal: 120000 } };
  const comp = { status: 'confirmed', charge: { state: 'comped', capturedCents: 0 }, stripe: { amountTotal: 120000 } };
  const lapsed = { status: 'confirmed', charge: { state: 'lapsed' }, stripe: { amountTotal: 120000 } };
  const old = { status: 'confirmed', stripe: { amountTotal: 120000 } };
  const paidRow = (ADMC.match(/const ch = c\.charge && c\.charge\.state \? c\.charge : null;[\s\S]*?row\('PAID', holdNote, 'var\(--orange\)'\);/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-09-07): confirmedLine's `if (ch.state === 'held') return` changed to `if (false) return` made this read
  //   FAIL  CH9 the client's line under the appointment says card held and not charged, charged with the figure, or no charge, and never "received" for a hold; what the client's page shows as paid is what was captured; and his PAID row prints the hold in words, never as money
  check('CH9 the client\'s line under the appointment says card held and not charged, charged with the figure, or no charge, and never "received" for a hold; what the client\'s page shows as paid is what was captured; and his PAID row prints the hold in words, never as money',
    !!line && !!shown
    && confirmedLine(held) === 'Card held, $1,200, not charged'
    && confirmedLine(cap) === 'Charged $900'
    && confirmedLine(comp) === 'No charge'
    && confirmedLine(lapsed) === 'Nothing charged yet'
    && /^Payment confirmed, \$1,200 received$/.test(confirmedLine(old))
    && paidShownCents(held) === null && paidShownCents(cap) === 90000 && paidShownCents(comp) === null && paidShownCents(old) === 120000
    && !!paidRow && /ch\.state === 'captured' \? Number\(ch\.capturedCents\) \|\| 0 : 0/.test(paidRow)
    && /`\$\{whole\(ch\.authorizedCents\)\} held, not charged`/.test(paidRow) && /'declined, nothing charged'/.test(paidRow) && /'no charge'/.test(paidRow)
    && !DASH.test(paidRow) && !DASH.test(line),
    JSON.stringify({ held: confirmedLine(held), cap: confirmedLine(cap), comp: confirmedLine(comp), lapsed: confirmedLine(lapsed), old: confirmedLine(old), shown: [paidShownCents(held), paidShownCents(cap), paidShownCents(comp), paidShownCents(old)] }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
