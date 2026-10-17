// invites.mjs - a case scheduled from a lead.
//
// Eric, 2026-10-15: "schedule a case from a lead. Once a lead is scheduled
// they are prompted to fill out the forms and confirm the time and date."
// His answer on money: "Pay when they confirm", at a price he sets that
// starts at the live case price; 0 is no charge.
//
// The Worker's five routes and the invitation branch of createCaseFromSession
// are lifted out of worker/index.js and RUN against stand-ins for Firestore,
// Stripe and the mail. The page halves are imported (admin-invites.js) or
// pinned on the source (book.js, sales-closed.js); the whole walk runs in a
// browser in drive-invite.mjs.
//
// Run: node invites.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const W = f('worker/index.js');
const BOOK = f('public/js/book.js');
const SALES = f('public/js/sales-closed.js');
const DEMO = f('public/js/demo/api.js');
const ADM = await import(pathToFileURL(j(ROOT, 'public/js/admin-invites.js')).href);
const CHARGE = await import(pathToFileURL(j(ROOT, 'worker/charge.js')).href);
// Whose case (2026-10-15): the real helper, so the lifted routes stamp the advocate.
const STAFF = await import(pathToFileURL(j(ROOT, 'worker/staff.js')).href);
const DASH = new RegExp('[\\u2013\\u2014]');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const line = (re) => (W.match(re) || [''])[0];
const CONSTS = [
  line(/const INVITE_ID_RE = [^\n]+;/), line(/const INVITE_MIN_LEAD_MS = [^\n]+;/), line(/const INVITE_MAX_LEAD_MS = [^\n]+;/),
  line(/const RATE_MAX_CENTS = [^\n]+;/), line(/const REQUIRED_ACKS = [^\n]+;/), line(/const METHODS = [^\n]+;/),
  line(/const PHONE_RE = [^\n]+;/), line(/const FULL_ACCESS_ACK = [^\n]+;/),
].join('\n');
const FNS = ['function inviteDollars(cents) {', 'function inviteWhen(start) {', 'function inviteEmail({ name, start, priceCents, link, from = \'Eric\' }) {',
  'function maskEmail(email) {', 'async function handleLeadInvite(request, env) {', 'async function handleLeadInvites(request, env) {',
  'async function handleLeadInviteCancel(request, env) {', 'async function readInviteFor(env, user, id) {',
  'async function handleInviteRead(request, env) {', 'async function handleInviteConfirm(request, env) {',
  'async function createCaseFromSession(env, session, { held = null } = {}) {'].map((decl) => lift(W, decl));

const DAY = 86_400_000;
const NOW = Date.now();
/** The Worker's world, in memory. */
function world({ admin = { uid: 'eric' }, user = { uid: 'u-lead' }, profiles = {}, docs = {}, existingCase = false } = {}) {
  const store = new Map(Object.entries(docs));
  for (const [uid, p] of Object.entries(profiles)) store.set(`users/${uid}`, p);
  const log = [];
  const deps = {
    requireAdmin: async () => admin,
    // RE-PINNED 2026-10-15 (v7.46): Eric, "The + sign ... should only be there to schedule a case from any lead they
    // themselves acquire": the three invitation routes take staff now, each seeing only their own (advocates.mjs I1 to
    // I3 run a contractor through them). Here the caller is him, so he sees every invitation, as before; the email
    // takes the sender's name (his, Eric).
    // NEGATIVE CONTROL (run 2026-10-15, v7.46): staffSees made `() => false` made B3 read FAIL (his list came back empty).
    requireStaff: async () => (admin ? { isAdmin: true, ...admin } : null),
    staffSees: STAFF.staffSees,
    requireUser: async () => user,
    requireAdultProfile: async (env, uid) => ({ name: 'Dana Reyes', dob: '1980-02-02', email: store.get(`users/${uid}`)?.email || null }),
    json: (o, s = 200) => ({ o, s }),
    getDoc: async (env, path) => (store.has(path) ? { id: path.split('/').pop(), data: store.get(path), updateTime: 't1' } : null),
    patchDoc: async (env, path, data, opts = {}) => {
      log.push(['patch', path, data, opts]);
      if (opts.mustNotExist && (store.has(path) || (existingCase && path.startsWith('cases/')))) return null;
      store.set(path, { ...(store.get(path) || {}), ...data });
      return true;
    },
    listDocs: async (env, coll) => [...store.entries()].filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === 2).map(([k, v]) => ({ id: k.split('/')[1], data: v })),
    queryDocs: async () => [],
    sendEmail: async (env, m) => { log.push(['mail', m.to, m.subject, m.html]); return true; },
    stripePost: async (env, path, params) => { log.push(['stripe', path, params]); return { id: 'cs_inv', url: 'https://checkout.test/cs_inv' }; },
    caseLineItems: (cents) => [{ quantity: 1, price_data: { currency: 'usd', unit_amount: cents } }],
    createCaseFromSession: async (env, session) => {
      log.push(['create', session]);
      const id = session.metadata.inviteId;
      store.set(`invites/${id}`, { ...store.get(`invites/${id}`), state: 'confirmed', caseId: id });
    },
    cleanPhone: (v) => (typeof v === 'string' ? v.trim() : ''),
    cleanAddress: (v) => (typeof v === 'string' ? v.trim().slice(0, 300) : ''),
    validTz: (tz) => (typeof tz === 'string' && tz ? tz : null),
    escHtml: (s) => String(s),
    firstName: (v) => String(v || '').trim().split(/\s+/)[0] || 'A client',
    resolveClientEmail: async (env, uid, e) => e || 'lead@x.test',
    safeJson: (s) => { try { return JSON.parse(s); } catch { return null; } },
    readRates: async () => ({ caseCents: 210000, addonCents: 32500, fullCents: 440000 }),
    raiseRates: async () => { log.push(['raise']); },
    // RE-PINNED 2026-10-15 (v7.47): a case is sold at its own advocate's prices (ratesForCase) and only his sales
    // climb his (raiseRatesFor); his invitations here read and raise exactly as before.
    ratesForCase: async () => ({ caseCents: 210000, addonCents: 32500, fullCents: 440000 }),
    raiseRatesFor: async () => { log.push(['raise']); },
    pingAdmins: async (env, body) => { log.push(['ping', body]); },
    // The case's own advocate hears of a confirmation (2026-10-16): logged with whose case it is.
    pingCase: async (env, c, body) => { log.push(['ping', body, c?.advocateId || '']); },
    caseRecipients: async () => [{ id: 'eric' }],
    notifyUser: async (env, uid, n) => { log.push(['notify', uid, n.body]); },
    CHARGE_COPY: CHARGE.CHARGE_COPY,
    // The hold's own constants, so a hold slipped into the invitation's checkout is read and caught, not a crash.
    HOLD_INTENT: CHARGE.HOLD_INTENT,
    HOLD_META: CHARGE.HOLD_META,
    heldChargeOf: () => ({ state: 'held' }),
    advocateIdOf: STAFF.advocateIdOf,
    whenHtml: () => '<p>when</p>',
    homeScreenTips: () => '',
    console: { warn() {}, error() {} },
  };
  const names = Object.keys(deps);
  const api = new Function(...names, `
    ${CONSTS}
    ${FNS.filter((s) => !s.startsWith('async function createCaseFromSession')).join('\n')}
    return { inviteEmail, maskEmail, handleLeadInvite, handleLeadInvites, handleLeadInviteCancel, handleInviteRead, handleInviteConfirm };
  `)(...names.map((n) => deps[n]));
  // createCaseFromSession runs on its own, with the real invitation constants.
  const ccNames = names.filter((n) => n !== 'createCaseFromSession');
  const create = new Function(...ccNames, `${CONSTS}\n${FNS[FNS.length - 1]}\nreturn createCaseFromSession;`)(...ccNames.map((n) => deps[n]));
  const req = (body) => ({ json: async () => body });
  return { api, create, store, log, req, env: { PUBLIC_BASE_URL: 'https://app.test', ADMIN_EMAIL: 'eric@x.test', ADMIN_UID: 'eric' } };
}

console.log('\n--- A. the lifts ---');
// NEGATIVE CONTROL (run 2026-10-15): handleInviteConfirm renamed in the Worker made this read
//   FAIL  A1 the invitation constants, the five handlers and createCaseFromSession lift out of the Worker
check('A1 the invitation constants, the five handlers and createCaseFromSession lift out of the Worker',
  FNS.every(Boolean) && CONSTS.split('\n').every(Boolean), FNS.map((s, i) => (s ? '' : i)).filter((x) => x !== '').join(','));

console.log('\n--- B. his half: the invitation, its email, the list, Cancel ---');
{
  const start = new Date(NOW + 5 * DAY).toISOString();
  const w = world();
  const good = await w.api.handleLeadInvite(w.req({ email: ' Dana@Example.com ', name: 'Dana Reyes', start, priceCents: 210000 }), w.env);
  const inv = w.store.get(`invites/${good.o.id}`);
  const mail = w.log.find((e) => e[0] === 'mail');
  const refusals = await Promise.all([
    w.api.handleLeadInvite(w.req({ email: 'nope', start, priceCents: 0 }), w.env),
    w.api.handleLeadInvite(w.req({ email: 'a@b.co', start: new Date(NOW + 60_000).toISOString(), priceCents: 0 }), w.env),
    w.api.handleLeadInvite(w.req({ email: 'a@b.co', start, priceCents: 25 }), w.env),
    w.api.handleLeadInvite(w.req({ email: 'a@b.co', start, priceCents: -100 }), w.env),
    w.api.handleLeadInvite(w.req({ email: 'a@b.co', start, priceCents: 10.5 }), w.env),
  ]);
  const stranger = world({ admin: null });
  const s404 = await stranger.api.handleLeadInvite(stranger.req({ email: 'a@b.co', start, priceCents: 0 }), stranger.env);
  // NEGATIVE CONTROL (run 2026-10-15): handleLeadInvite's `priceCents > 0 && priceCents < 50` refusal taken out made this read
  //   FAIL  B1 an invitation is written for one address, one time and one price, mailed with its link, and refused for a bad address, a time under an hour away, a price Stripe cannot charge or a stranger
  check('B1 an invitation is written for one address, one time and one price, mailed with its link, and refused for a bad address, a time under an hour away, a price Stripe cannot charge or a stranger',
    good.s === 200 && good.o.emailed === true && good.o.link === `https://app.test/book.html?invite=${good.o.id}`
    && inv?.email === 'dana@example.com' && inv.state === 'sent' && inv.priceCents === 210000 && new Date(inv.start).toISOString() === start && inv.caseId === null
    && mail?.[1] === 'dana@example.com' && mail[3].includes(good.o.link)
    && refusals.every((r) => r.s === 400) && s404.s === 404,
    JSON.stringify({ good, refusals: refusals.map((r) => [r.s, r.o.error]) }));

  const words = w.api.inviteEmail({ name: 'Dana Reyes', start, priceCents: 210000, link: 'L' });
  const free = w.api.inviteEmail({ name: '', start, priceCents: 0, link: 'L' });
  // NEGATIVE CONTROL (run 2026-10-15): the email's "Sign in, fill out your forms, and confirm the time." changed to "Confirm below." made this read
  //   FAIL  B2 the email says the time on his clock, to sign in, fill out the forms and confirm, and the price paid on confirming or that there is no charge, with no dash
  check('B2 the email says the time on his clock, to sign in, fill out the forms and confirm, and the price paid on confirming or that there is no charge, with no dash',
    words.subject === 'Your Advocacy Case call is set'
    && /<p>Hi Dana,<\/p>/.test(words.html) && /I've set aside <strong>\w+day, \w+ \d+ at \d+:\d\d (AM|PM) MST<\/strong> for your Advocacy Case call\. Sign in, fill out your forms, and confirm the time\./.test(words.html)
    && /<p>\$2,100, paid when you confirm\.<\/p>/.test(words.html) && /<p>There is no charge\.<\/p>/.test(free.html) && /<p>Hi,<\/p>/.test(free.html)
    && /<a href="L">Confirm your time<\/a>/.test(words.html) && !DASH.test(words.html + free.html + words.subject),
    words.html);

  const list = await w.api.handleLeadInvites(w.req({}), w.env);
  w.store.set('invites/inv-gone-9', { email: 'x@y.co', start, priceCents: 0, state: 'canceled' });
  w.store.set('invites/inv-done-9', { email: 'x@y.co', start, priceCents: 0, state: 'confirmed', caseId: 'inv-done-9' });
  const list2 = await w.api.handleLeadInvites(w.req({}), w.env);
  const cancel = await w.api.handleLeadInviteCancel(w.req({ id: good.o.id }), w.env);
  const after = await w.api.handleLeadInvites(w.req({}), w.env);
  const late = await w.api.handleLeadInviteCancel(w.req({ id: 'inv-done-9' }), w.env);
  // NEGATIVE CONTROL (run 2026-10-15): handleLeadInvites' `r.data.state === 'sent'` filter taken out made this read
  //   FAIL  B3 the waiting list is only invitations still waiting; Cancel withdraws one, and one already confirmed cannot be withdrawn
  check('B3 the waiting list is only invitations still waiting; Cancel withdraws one, and one already confirmed cannot be withdrawn',
    list.o.invites.length === 1 && list2.o.invites.length === 1 && list.o.invites[0].id === good.o.id && list.o.invites[0].past === false
    && cancel.o.canceled === true && w.store.get(`invites/${good.o.id}`).state === 'canceled' && after.o.invites.length === 0
    && late.s === 409 && late.o.caseId === 'inv-done-9',
    JSON.stringify({ list: list.o, list2: list2.o.invites.length, cancel: cancel.o, after: after.o, late }));
}

console.log('\n--- C. their half: reading it, confirming it ---');
{
  const start = new Date(NOW + 4 * DAY).toISOString();
  const base = () => world({
    profiles: { 'u-lead': { email: 'dana@example.com' }, 'u-other': { email: 'someone@else.com' } },
    docs: {
      'invites/inv-paid-1': { email: 'dana@example.com', name: 'Dana Reyes', start, priceCents: 210000, state: 'sent' },
      'invites/inv-free-1': { email: 'dana@example.com', name: 'Dana Reyes', start, priceCents: 0, state: 'sent' },
      'invites/inv-gone-1': { email: 'dana@example.com', start, priceCents: 0, state: 'canceled' },
      'invites/inv-done-1': { email: 'dana@example.com', start, priceCents: 0, state: 'confirmed', caseId: 'inv-done-1' },
      'invites/inv-past-1': { email: 'dana@example.com', start: new Date(NOW - DAY).toISOString(), priceCents: 0, state: 'sent' },
    },
  });
  const w = base();
  const read = await w.api.handleInviteRead(w.req({ id: 'inv-paid-1' }), w.env);
  const other = world({ user: { uid: 'u-other' }, profiles: { 'u-other': { email: 'someone@else.com' } }, docs: { 'invites/inv-paid-1': { email: 'dana@example.com', start, priceCents: 1, state: 'sent' } } });
  const wrong = await other.api.handleInviteRead(other.req({ id: 'inv-paid-1' }), other.env);
  const gone = await w.api.handleInviteRead(w.req({ id: 'inv-gone-1' }), w.env);
  const done = await w.api.handleInviteRead(w.req({ id: 'inv-done-1' }), w.env);
  const past = await w.api.handleInviteRead(w.req({ id: 'inv-past-1' }), w.env);
  const bad = await w.api.handleInviteRead(w.req({ id: 'x' }), w.env);
  // NEGATIVE CONTROL (run 2026-10-15): readInviteFor's address comparison taken out made this read
  //   FAIL  C1 an invitation reads its time and price only for the address it went to, and says why when it is someone else's, withdrawn, already confirmed, past, or not a link
  check('C1 an invitation reads its time and price only for the address it went to, and says why when it is someone else\'s, withdrawn, already confirmed, past, or not a link',
    read.s === 200 && read.o.start === start && read.o.priceCents === 210000 && read.o.name === 'Dana Reyes'
    && wrong.s === 403 && /sent to d\*\*\*@example\.com\. Sign in with that address/.test(wrong.o.error) && !/dana@/.test(wrong.o.error)
    && gone.s === 410 && done.s === 409 && done.o.caseId === 'inv-done-1' && past.s === 410 && bad.s === 400,
    JSON.stringify({ read, wrong, gone: gone.s, done, past: past.s, bad: bad.s }));

  const acks = { disclaimer: 1, privacy: 1, recording: 1, service: 1, phoneConsent: 1 };
  const paid = base();
  const pay = await paid.api.handleInviteConfirm(paid.req({ id: 'inv-paid-1', method: 'video', phone: '+1 208 555 0100', address: '1 Main', acks, tz: 'America/Boise' }), paid.env);
  const sp = paid.log.find((e) => e[0] === 'stripe')?.[2] || {};
  const free = base();
  const freeOut = await free.api.handleInviteConfirm(free.req({ id: 'inv-free-1', method: 'phone', phone: '+1 208 555 0100', acks }), free.env);
  const made = free.log.find((e) => e[0] === 'create')?.[1] || {};
  const noAck = base();
  const r1 = await noAck.api.handleInviteConfirm(noAck.req({ id: 'inv-paid-1', method: 'video', phone: '+1 208 555 0100', acks: { disclaimer: 1 } }), noAck.env);
  const r2 = await noAck.api.handleInviteConfirm(noAck.req({ id: 'inv-paid-1', method: 'fax', phone: '+1 208 555 0100', acks }), noAck.env);
  const r3 = await noAck.api.handleInviteConfirm(noAck.req({ id: 'inv-paid-1', method: 'video', phone: 'x', acks }), noAck.env);
  // NEGATIVE CONTROL (run 2026-10-15): handleInviteConfirm's checkout given `payment_intent_data: HOLD_INTENT` made this read
  //   FAIL  C2 confirming at a price is a Stripe checkout charged at once (never a hold) for exactly his price, carrying the invitation and its time; at zero the case opens with nothing to pay; the agreement, the method and the number are required as at every booking
  check('C2 confirming at a price is a Stripe checkout charged at once (never a hold) for exactly his price, carrying the invitation and its time; at zero the case opens with nothing to pay; the agreement, the method and the number are required as at every booking',
    pay.s === 200 && pay.o.url === 'https://checkout.test/cs_inv' && sp.mode === 'payment' && !('payment_intent_data' in sp)
    && sp.line_items?.[0]?.price_data?.unit_amount === 210000 && sp.metadata?.inviteId === 'inv-paid-1' && sp.metadata.requestedStart === start
    && sp.metadata.priceCents === '210000' && sp.metadata.slotId === '' && !('hold' in sp.metadata) && !('kind' in sp.metadata)
    && JSON.parse(sp.metadata.acks).phoneConsent === 1 && sp.cancel_url === 'https://app.test/book.html?invite=inv-paid-1&canceled=1'
    && /return\.html\?session_id=\{CHECKOUT_SESSION_ID\}$/.test(sp.success_url)
    && freeOut.s === 200 && freeOut.o.caseId === 'inv-free-1' && made.id === 'invite_inv-free-1' && made.amount_total === 0 && made.metadata?.priceCents === '0'
    && !free.log.some((e) => e[0] === 'stripe')
    && r1.s === 400 && r2.s === 400 && r3.s === 400 && !noAck.log.some((e) => e[0] === 'stripe' || e[0] === 'create'),
    JSON.stringify({ pay, sp, freeOut, made: made.id, refusals: [r1.s, r2.s, r3.s] }));
}

console.log('\n--- D. the case it opens ---');
{
  const start = new Date(NOW + 4 * DAY).toISOString();
  const meta = (priceCents, id = 'inv-paid-1') => ({
    uid: 'u-lead', email: 'dana@example.com', name: 'Dana Reyes', dob: '1980-02-02', tz: 'America/Boise', slotId: '', requestedStart: start,
    method: 'video', phone: '+1 208 555 0100', address: '', acks: JSON.stringify({ disclaimer: 1, privacy: 1, recording: 1, service: 1, phoneConsent: 1 }),
    inviteId: id, priceCents: String(priceCents),
  });
  const paid = world({ docs: { 'invites/inv-paid-1': { state: 'sent' } } });
  await paid.create(paid.env, { id: 'cs_1', amount_total: 210000, payment_intent: 'pi_1', metadata: meta(210000) });
  const c = paid.store.get('cases/inv-paid-1');
  const free = world({ docs: { 'invites/inv-free-1': { state: 'sent' } } });
  await free.create(free.env, { id: 'invite_inv-free-1', amount_total: 0, payment_intent: null, metadata: meta(0, 'inv-free-1') });
  const fc = free.store.get('cases/inv-free-1');
  const twice = world({ existingCase: true, docs: { 'invites/inv-paid-1': { state: 'confirmed', caseId: 'inv-paid-1' } } });
  await twice.create(twice.env, { id: 'cs_2', amount_total: 210000, payment_intent: 'pi_2', metadata: meta(210000) });
  const mailTo = (w) => w.log.filter((e) => e[0] === 'mail').map((e) => [e[1], e[2], e[3]]);
  // NEGATIVE CONTROL (run 2026-10-15): createCaseFromSession's `const caseId = inviteId || crypto.randomUUID();` changed to `const caseId = crypto.randomUUID();` made this read
  //   FAIL  D1 the case takes the invitation's id, his time (not a request) and his price, the invitation is marked confirmed and he is told; paid, the rate moves like any sale; free, nothing moves and the mail says the time is confirmed; a second payment for one invitation opens nothing and tells him to refund it
  check('D1 the case takes the invitation\'s id, his time (not a request) and his price, the invitation is marked confirmed and he is told; paid, the rate moves like any sale; free, nothing moves and the mail says the time is confirmed; a second payment for one invitation opens nothing and tells him to refund it',
    !!c && c.status === 'confirmed' && new Date(c.appointment.start).toISOString() === start && c.appointment.requested === false
    && c.caseRateCents === 210000 && c.invite?.id === 'inv-paid-1' && c.invite.priceCents === 210000 && c.charge === null
    && paid.store.get('invites/inv-paid-1').state === 'confirmed' && paid.store.get('invites/inv-paid-1').caseId === 'inv-paid-1'
    && paid.log.some((e) => e[0] === 'ping' && e[1] === 'Dana confirmed the case you scheduled.')
    && paid.log.filter((e) => e[0] === 'raise').length === 1
    && !mailTo(paid).some(([to]) => to === 'eric@x.test') && mailTo(paid).some(([to, , html]) => to === 'dana@example.com' && /Payment confirmed/.test(html))
    && !!fc && fc.caseRateCents === 0 && fc.stripe.sessionId === 'invite_inv-free-1' && free.log.filter((e) => e[0] === 'raise').length === 0
    && mailTo(free).some(([to, , html]) => to === 'dana@example.com' && /Your time is confirmed\. Your case file is live\./.test(html))
    && twice.log.some((e) => e[0] === 'ping' && /paid twice for the case you scheduled\. Refund the second payment from Stripe\./.test(e[1]))
    && !twice.log.some((e) => e[0] === 'patch' && e[1].startsWith('invites/')) && !twice.log.some((e) => e[0] === 'raise') && mailTo(twice).length === 0,
    JSON.stringify({ c, fc: fc && { rate: fc.caseRateCents, sid: fc.stripe.sessionId }, paidLog: paid.log.map((e) => e[0]), twiceLog: twice.log.map((e) => [e[0], e[1]]) }));
}

console.log('\n--- E. the wiring ---');
{
  const ADMIN_ASSET = new Function(`${(W.match(/const ADMIN_ASSET =\n\s+\/[^\n]+\/;/) || ['const ADMIN_ASSET = /$^/;'])[0]} return ADMIN_ASSET;`)();
  // RE-PINNED 2026-10-17 (v7.72): the purchase routes are a Map of route to the services it sells (one switch per service).
  // NEGATIVE CONTROL (run 2026-10-17, v7.72): `['/api/invite/confirm', ['case']],` added to SALES_ROUTES made E1 read FAIL.
  const salesSet = (W.match(/const SALES_ROUTES = new Map\(\[([\s\S]*?)\n\]\);/) || [])[1] || '';
  const routes = [['/api/admin/lead-invite', 'handleLeadInvite'], ['/api/admin/lead-invites', 'handleLeadInvites'],
    ['/api/admin/lead-invite/cancel', 'handleLeadInviteCancel'], ['/api/invite', 'handleInviteRead'], ['/api/invite/confirm', 'handleInviteConfirm']];
  // NEGATIVE CONTROL (run 2026-10-15): '/api/invite/confirm' added to SALES_ROUTES made this read
  //   FAIL  E1 the five routes are registered as POSTs and none is a sales route, so an invitation works while sales are closed; the booking page skips the closed notice for one, and his module sits behind the admin gate
  check('E1 the five routes are registered as POSTs and none is a sales route, so an invitation works while sales are closed; the booking page skips the closed notice for one, and his module sits behind the admin gate',
    routes.every(([p, h]) => new RegExp(`url\\.pathname === '${p.replace(/\//g, '\\/')}' && request\\.method === 'POST'\\)\\n\\s+return await ${h}\\(request, env\\);`).test(W))
    && !/invite/.test(salesSet) && !!salesSet
    && /if \(document\.querySelector\('main'\)\?\.dataset\.sales === 'case' && new URLSearchParams\(location\.search\)\.get\('invite'\)\) return;/.test(SALES)
    && SALES.indexOf("get('invite')") < SALES.indexOf('main.insertAdjacentHTML')
    && ADMIN_ASSET.test('/js/admin-invites.js') && !ADMIN_ASSET.test('/js/book.js'),
    salesSet);
  // NEGATIVE CONTROL (run 2026-10-15): book.js's `wireStep1(el);` at the end of the calendar path taken out made this read
  //   FAIL  E2 the booking page reads the invitation after sign-in and returns to it, shows his time in place of the calendar, wires the same details for both paths, and confirms through the invitation route
  check('E2 the booking page reads the invitation after sign-in and returns to it, shows his time in place of the calendar, wires the same details for both paths, and confirms through the invitation route',
    /const INVITE_ID = \(\(\) => \{\n\s+const v = new URLSearchParams\(location\.search\)\.get\('invite'\) \|\| '';\n\s+return \/\^\[\\w-\]\{6,64\}\$\/\.test\(v\) \? v : '';/.test(BOOK)
    // RE-PINNED 2026-10-17 (v7.65): a step up from chat returns to ?step= after sign-in too; the invitation still comes first.
    // NEGATIVE CONTROL (run 2026-10-17, v7.65): the invitation's return taken out of the sign-in made E2 read FAIL.
    // RE-PINNED 2026-10-17 (v7.70): a contractor's own calendar (?advocate=) returns to itself too, after the invitation.
    // NEGATIVE CONTROL (run 2026-10-17, v7.70): the calendar path's `wireStep1(el);` after wireRequest taken out made E2 read FAIL.
    && /returnTo: INVITE_ID \? `\/book\.html\?invite=\$\{INVITE_ID\}` : ADVOCATE \? `\/book\.html\?advocate=\$\{encodeURIComponent\(ADVOCATE\)\}` : STEP \? `\/book\.html\?step=\$\{STEP\}` : '\/book\.html'/.test(BOOK)
    && /if \(INVITE_ID && !\(await readInvite\(\)\)\) return;\n\s+render\(\);/.test(BOOK)
    && /if \(state\.invite\) \{\n\s+showInviteTime\(el\);\n\s+wireStep1\(el\);\n\s+return;\n\s+\}/.test(BOOK)
    && /drawDays\(el, slots\);\n\s+\/\/ ---- request a time that isn't on the calendar ----\n\s+wireRequest\(el, closedUntil\);\n\s+wireStep1\(el\);\n\}/.test(BOOK)
    && /drawDays\(el, slots, \{ mst: false \}\);\n\s+wireStep1\(el\);\n\}/.test(BOOK)
    && (BOOK.match(/\n {4}stripUnwiredStep1\(el/g) || []).length === 4
    && /if \(!state\.slot && !state\.requestedStart && !state\.invite\) return;/.test(BOOK)
    && /fetch\('\/api\/invite\/confirm', \{/.test(BOOK) && /fetch\('\/api\/invite', \{/.test(BOOK)
    && /payBtn\.textContent = invite\.priceCents \? `Confirm and pay \$\$\{money\(invite\.priceCents\)\}` : 'Confirm my time';/.test(BOOK)
    && !DASH.test((BOOK.match(/function showInviteTime[\s\S]*?\n\}/) || [''])[0]));
  // NEGATIVE CONTROL (run 2026-10-15): the demo's lead-invite refusal for a price under fifty cents taken out made this read
  //   FAIL  E3 the demo mirrors all five routes with the Worker's refusals, and its confirm writes the case at his time and price under the invitation's id
  check('E3 the demo mirrors all five routes with the Worker\'s refusals, and its confirm writes the case at his time and price under the invitation\'s id',
    /if \(path === '\/api\/admin\/lead-invite' \|\| path === '\/api\/admin\/lead-invites' \|\| path === '\/api\/admin\/lead-invite\/cancel'\) \{/.test(DEMO)
    && /if \(path === '\/api\/invite' \|\| path === '\/api\/invite\/confirm'\) \{/.test(DEMO)
    && /if \(priceCents > 0 && priceCents < 50\) return fail\(400, 'Stripe cannot charge less than \$0\.50\. Use 0 for no charge\.'\);/.test(DEMO)
    && /Sign in with that address to confirm it\./.test(DEMO) && /All acknowledgment forms must be completed first\./.test(DEMO)
    && /store\.docs\.set\(`cases\/\$\{id\}`, \{/.test(DEMO) && /requested: false \}/.test(DEMO) && /caseRateCents: cents,/.test(DEMO)
    && /store\.docs\.set\(key, \{ \.\.\.inv, state: 'confirmed', confirmedAt: now, caseId: id \}\);/.test(DEMO));
}

console.log('\n--- F. his form\'s arithmetic ---');
{
  const t = ADM.mstInstant('2026-10-20', '10:00');
  // NEGATIVE CONTROL (run 2026-10-15): mstInstant's `-07:00` changed to `Z` made this read
  //   FAIL  F1 a date and time he types are read on his clock (MST), dollars as typed become whole cents, and anything else is refused before it is sent
  check('F1 a date and time he types are read on his clock (MST), dollars as typed become whole cents, and anything else is refused before it is sent',
    t?.toISOString() === '2026-10-20T17:00:00.000Z' && ADM.mstInstant('', '10:00') === null && ADM.mstInstant('2026-10-20', '') === null
    && ADM.centsOf('2100') === 210000 && ADM.centsOf('$2,100') === 210000 && ADM.centsOf('49.5') === 4950 && ADM.centsOf('0') === 0
    && ADM.centsOf('') === null && ADM.centsOf('abc') === null && ADM.centsOf('1.234') === null
    && ADM.priceText(210000) === '$2,100' && ADM.priceText(4950) === '$49.50' && ADM.priceText(0) === 'no charge',
    String(t?.toISOString()));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const r of failed) console.log(`  FAILED: ${r.name}`);
  process.exit(1);
}
