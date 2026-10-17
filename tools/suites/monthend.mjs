// monthend.mjs - the end of a Full-Service month, the pace of one, and "up to 20 hours" (v7.63).
//
// Eric, 2026-10-17, asked what happens when a month of Full-Service runs out: "Close, with a heads up. If they
// pass closing, under [Case Enhancements] there's a shining upgrade for an additional month request. This goes
// to the advocate he accepts or declines. All case requests get accepted or declined by the advocate they
// choose." While sales are off: "No, keep it off". Asked how to keep a contractor from doing a week and
// stopping, he chose "Pacing flags", and "Yes, 'up to 20 hours'".
//
// What this proves:
//   A. worker/monthend.js's sweep, run against fakes: the heads-up three days out, once an end date; the close
//      once the month is over, with what it was and when; the waits (an undecided appeal, a month in checkout)
//      and the cases it never ends (held, his own, a delivered one)
//   B. the client's request and their advocate's answer, run against fakes: only on a case its month closed,
//      quoted at the case's own price, theirs to withdraw; the answer from the case's own advocate, a reason on
//      a no, a link (or no charge) on a yes that reopens the case, their limit asked about
//   C. the Worker wiring: the routes, sales off, the cron minute, the reopen on payment, the pacing stamps
//   D. the pages: the shining card in its four states and off with sales, the advocate's card, Needs attention
//   E. admin-pacing.js, run: a quiet week, no word to the client, most hours in week one, and never on a case
//      that is closed, held or his own
//   F. Demo mode answers the same way
//
// Run: node monthend.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
const DAY = 86_400_000;
const strip = (src) => src.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function|let) /gm, '$1 ');

// worker/monthend.js whole, its three Firestore calls handed in.
function world(docs) {
  const log = { patches: [], pushes: [], mails: [], pings: [], stripe: [], confirmed: [] };
  const getDoc = async (_e, p) => (docs.has(p) ? { data: JSON.parse(JSON.stringify(docs.get(p))) } : null);
  const patchDoc = async (_e, p, d) => { log.patches.push([p, Object.keys(d)]); docs.set(p, { ...(docs.get(p) || {}), ...d }); return true; };
  const queryDocs = async () => [...docs.entries()].filter(([k, v]) => /^cases\/[^/]+$/.test(k) && v.fullAccess === true).map(([k, v]) => ({ id: k.split('/')[1], data: JSON.parse(JSON.stringify(v)) }));
  const M = new Function('getDoc', 'patchDoc', 'queryDocs', `${strip(f('worker/monthend.js'))}\nreturn { sweepFullServiceMonths, handleExtendRequest, handleExtendDecision, HEADS_UP_MS, MONTH_CLOSED_REASON };`)(getDoc, patchDoc, queryDocs);
  const h = {
    windowEnd: (c) => (c.endsAt ? new Date(c.endsAt) : null),
    notifyUser: async (_e, uid, m) => { log.pushes.push([uid, m.body]); },
    sendEmail: async (_e, m) => { log.mails.push([m.to, m.subject, m.html]); },
    pingCase: async (_e, c, body) => { log.pings.push([c.advocateId || 'eric', body]); },
    salesOpen: true, baseUrl: 'https://x',
  };
  return { M, h, log, docs };
}
const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
const req = (body, uid = '') => new Request('https://x/api', { method: 'POST', headers: { 'content-type': 'application/json', 'x-uid': uid }, body: JSON.stringify(body) });
const answer = async (p) => { const r = await p; return { status: r.status, body: await r.json() }; };

console.log('\n--- A. the sweep ---');
{
  const now = Date.now();
  const base = { fullAccess: true, status: 'confirmed', clientUid: 'cl', clientEmail: 'c@x', clientName: 'Dana Whitfield', advocateId: 'ana' };
  const docs = new Map([
    ['cases/soon', { ...base, endsAt: now + 2 * DAY }],
    ['cases/later', { ...base, endsAt: now + 10 * DAY }],
    ['cases/over', { ...base, status: 'awaiting_report', endsAt: now - DAY }],
    ['cases/appeal', { ...base, endsAt: now - DAY }],
    ['cases/appeal/advisor/state', { appealMeta: { filedAt: '2026-10-01', decidedAt: null } }],
    ['cases/paying', { ...base, endsAt: now - DAY, pendingExtend: { url: 'https://pay', expiresAt: new Date(now + 3600_000).toISOString() } }],
    ['cases/held', { ...base, endsAt: now - DAY, hold: { pausedAt: '2026-10-10' } }],
    ['cases/mine', { ...base, self: true, endsAt: now - DAY }],
    ['cases/old', { ...base, status: 'delivered', endsAt: now - DAY }],
  ]);
  const w = world(docs);
  const first = await w.M.sweepFullServiceMonths({}, w.h);
  const again = await w.M.sweepFullServiceMonths({}, w.h);
  const soon = docs.get('cases/soon');
  // NEGATIVE CONTROL (run 2026-10-17): the heads-up's `c.monthNotice?.for === endKey` guard taken out made this read
  //   FAIL  A1 three days out the client and their advocate are told once for that end date, in the words for sales on or off
  check('A1 three days out the client and their advocate are told once for that end date, in the words for sales on or off',
    first.told === 1 && again.told === 0 && soon.monthNotice?.for === new Date(soon.endsAt).toISOString() && soon.status === 'confirmed'
    && w.log.pushes.some(([u, b]) => u === 'cl' && /^Your month of Full-Service ends /.test(b))
    && w.log.mails.some(([, s, html]) => /^Your month of Full-Service ends /.test(s) && /add another month from Case Enhancements/.test(html))
    && w.log.pings.some(([a, b]) => a === 'ana' && /^Dana's Full-Service month ends /.test(b)) && !docs.get('cases/later').monthNotice,
    JSON.stringify({ first, again, pushes: w.log.pushes.length }));
  const over = docs.get('cases/over');
  // NEGATIVE CONTROL (run 2026-10-17): the close's `closedFromStatus` left out made this read
  //   FAIL  A2 once the month is over the case closes on schedule, keeping what it was, when the month ended, and nothing in checkout
  check('A2 once the month is over the case closes on schedule, keeping what it was, when the month ended, and nothing in checkout',
    over.status === 'closed' && over.closedBy === 'automatic' && over.closedReason === w.M.MONTH_CLOSED_REASON
    && over.closedFromStatus === 'awaiting_report' && !!over.monthEndedAt && over.pendingExtend === null && over.extendRequest === null
    && w.log.pushes.some(([u, b]) => u === 'cl' && b === 'Your month of Full-Service has ended. Your file stays yours.')
    && w.log.mails.some(([, s, html]) => s === 'Your month of Full-Service has ended' && /ask for one from Case Enhancements/.test(html))
    && w.log.pings.some(([a, b]) => a === 'ana' && /month ended, and the case is closed\./.test(b)) && first.closed === 1,
    JSON.stringify({ over: over.status, closed: first.closed }));
  // NEGATIVE CONTROL (run 2026-10-17): the sweep's wait on a filed, undecided appeal taken out made this read
  //   FAIL  A3 it waits on an undecided appeal and on a month in checkout, and never ends a held case, his own or a delivered one
  check('A3 it waits on an undecided appeal and on a month in checkout, and never ends a held case, his own or a delivered one',
    ['appeal', 'paying', 'held', 'mine', 'old'].every((id) => docs.get(`cases/${id}`).status !== 'closed'),
    JSON.stringify(['appeal', 'paying', 'held', 'mine', 'old'].map((id) => [id, docs.get(`cases/${id}`).status])));
  const off = world(new Map([['cases/soon', { ...base, endsAt: now + DAY }], ['cases/over', { ...base, endsAt: now - DAY }]]));
  off.h.salesOpen = false;
  await off.M.sweepFullServiceMonths({}, off.h);
  // NEGATIVE CONTROL (run 2026-10-17): the closing mail's `h.salesOpen ?` left out (the ask line always sent) made this read
  //   FAIL  A4 with sales off neither mail offers another month
  check('A4 with sales off neither mail offers another month',
    off.log.mails.length === 2 && off.log.mails.every(([, , html]) => !/another month/i.test(html)) && /Your case closes that day\./.test(off.log.mails[0][2]),
    JSON.stringify(off.log.mails.map((m) => m[1])));
  // NEGATIVE CONTROL (run 2026-10-17): a long dash put in monthend.js's first comment made this read
  //   FAIL  A5 no dash in the module
  check('A5 no dash in the module', !DASH.test(f('worker/monthend.js')));
}

console.log('\n--- B. the request and the answer ---');
{
  const now = Date.now();
  const closed = { fullAccess: true, status: 'closed', monthEndedAt: new Date(now - DAY).toISOString(), closedFromStatus: 'confirmed', clientUid: 'cl', clientEmail: 'c@x', clientName: 'Dana Whitfield', advocateId: 'ana' };
  const docs = new Map([
    ['cases/ended', { ...closed }],
    ['cases/open', { ...closed, status: 'confirmed', monthEndedAt: null }],
    ['cases/hand', { ...closed, monthEndedAt: null }],
    ['cases/theirs', { ...closed, clientUid: 'other' }],
  ]);
  const w = world(docs);
  const hc = { requireUser: async (r) => ({ uid: r.headers.get('x-uid') }), json, pingCase: w.h.pingCase, monthCentsFor: async (c) => (c.advocateId === 'ana' ? 390000 : 0) };
  const ask = (body) => answer(w.M.handleExtendRequest(req(body, 'cl'), {}, hc));
  const open = await ask({ caseId: 'open' });
  const hand = await ask({ caseId: 'hand' });
  const theirs = await ask({ caseId: 'theirs' });
  const first = await ask({ caseId: 'ended' });
  const twice = await ask({ caseId: 'ended' });
  const pending = docs.get('cases/ended').extendRequest;
  // NEGATIVE CONTROL (run 2026-10-17): the request's `!c.data.monthEndedAt` refusal taken out made this read
  //   FAIL  B1 only a case its month closed can ask, at that case's own price, once, and their advocate is told
  check('B1 only a case its month closed can ask, at that case\'s own price, once, and their advocate is told',
    open.status === 409 && hand.status === 409 && theirs.status === 404 && first.status === 200 && first.body.state === 'pending'
    && twice.body.state === 'pending' && pending.state === 'pending' && pending.monthCents === 390000
    && w.log.pings.filter(([a, b]) => a === 'ana' && /is asking for another month of Full-Service\./.test(b)).length === 1,
    JSON.stringify({ open: open.status, hand: hand.status, theirs: theirs.status, first: first.body, pending }));
  const gone = await ask({ caseId: 'ended', action: 'withdraw' });
  const none = await ask({ caseId: 'ended', action: 'withdraw' });
  // NEGATIVE CONTROL (run 2026-10-17): the withdraw's patch (`extendRequest: null`) taken out made this read
  //   FAIL  B2 it is theirs to withdraw while it waits
  check('B2 it is theirs to withdraw while it waits', gone.body.withdrawn === true && docs.get('cases/ended').extendRequest === null && none.status === 409);

  await ask({ caseId: 'ended' });
  const cap = { room: true, open: 1, max: 3 };
  const hd = {
    requireStaff: async (r) => (r.headers.get('x-uid') ? { uid: r.headers.get('x-uid'), isAdmin: r.headers.get('x-uid') === 'eric' } : null),
    staffSees: (s, c) => s.isAdmin || c.advocateId === s.uid, json, notifyUser: w.h.notifyUser,
    stripePost: async (_e, path, body) => { w.log.stripe.push([path, body]); return { id: 'cs_1', url: 'https://pay/cs_1' }; },
    lineItems: (cents) => [{ cents }], capacity: async () => cap, contractorOf: (c) => c.advocateId,
    confirm: async (_e, session) => { w.log.confirmed.push(session); }, baseUrl: 'https://x',
  };
  const decide = (body, uid) => answer(w.M.handleExtendDecision(req(body, uid), {}, hd));
  const stranger = await decide({ caseId: 'ended', decision: 'approve' }, '');
  const other = await decide({ caseId: 'ended', decision: 'approve' }, 'marcus');
  const bare = await decide({ caseId: 'ended', decision: 'decline', reason: '  ' }, 'ana');
  // NEGATIVE CONTROL (run 2026-10-17): the decision's `!h.staffSees(staff, c.data, env)` check taken out made this read
  //   FAIL  B3 only the case's own advocate (or Eric) answers, and a no needs their reason
  check('B3 only the case\'s own advocate (or Eric) answers, and a no needs their reason',
    stranger.status === 404 && other.status === 404 && bare.status === 400 && docs.get('cases/ended').extendRequest.state === 'pending',
    JSON.stringify({ stranger: stranger.status, other: other.status, bare: bare.status }));
  cap.room = false;
  const full = await decide({ caseId: 'ended', decision: 'approve' }, 'ana');
  const yes = await decide({ caseId: 'ended', decision: 'approve', overrideCap: true }, 'ana');
  const c1 = docs.get('cases/ended');
  const [, sess] = w.log.stripe[0] || [];
  // NEGATIVE CONTROL (run 2026-10-17): the session's `reopen: '1'` left out of its metadata made this read
  //   FAIL  B4 a yes asks first when they are full, then sends a link at the quoted price that reopens the case, and tells the client
  check('B4 a yes asks first when they are full, then sends a link at the quoted price that reopens the case, and tells the client',
    full.status === 409 && full.body.error === 'full-booked' && yes.status === 200 && yes.body.url === 'https://pay/cs_1' && yes.body.cents === 390000
    && sess?.metadata?.kind === 'extend' && sess.metadata.reopen === '1' && sess.metadata.caseId === 'ended'
    && c1.extendRequest.state === 'approved' && c1.extendRequest.decidedBy === 'ana' && c1.pendingExtend?.url === 'https://pay/cs_1'
    && w.log.pushes.some(([u, b]) => u === 'cl' && /said yes\. Your next month is ready to start\./.test(b)),
    JSON.stringify({ full: full.body, yes: yes.body, meta: sess?.metadata }));
  cap.room = true;
  docs.set('cases/gift', { ...closed, extendRequest: { state: 'pending', monthCents: 390000 } });
  docs.set('cases/no', { ...closed, extendRequest: { state: 'pending', monthCents: 390000 } });
  const gift = await decide({ caseId: 'gift', decision: 'approve', amountCents: 0 }, 'eric');
  const no = await decide({ caseId: 'no', decision: 'decline', reason: 'I am full until December.' }, 'ana');
  // NEGATIVE CONTROL (run 2026-10-17): the no-charge branch's confirm call taken out made this read
  //   FAIL  B5 a yes at no charge opens the month straight away; a no keeps their words and charges nothing
  check('B5 a yes at no charge opens the month straight away; a no keeps their words and charges nothing',
    gift.body.comped === true && w.log.confirmed.some((s) => s.amount_total === 0 && s.metadata.reopen === '1' && s.metadata.caseId === 'gift')
    && no.body.state === 'declined' && docs.get('cases/no').extendRequest.declineReason === 'I am full until December.'
    && w.log.pushes.some(([u, b]) => u === 'cl' && /Nothing was charged\./.test(b)),
    JSON.stringify({ gift: gift.body, no: no.body }));
}

console.log('\n--- C. the Worker ---');
{
  const W = f('worker/index.js');
  const conf = (W.match(/async function confirmExtensionPurchase\([\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17): '/api/extend-request' taken out of SALES_ROUTES made this read
  //   FAIL  C1 asking is off while sales are off, both routes are wired, and the sweep has its own cron minute
  check('C1 asking is off while sales are off, both routes are wired, and the sweep has its own cron minute',
    // RE-PINNED 2026-10-17 (v7.65): an appeal asked for (/api/addon-request) is a sales route too, listed after it.
    // NEGATIVE CONTROL (run 2026-10-17, v7.65): '/api/extend-request' taken out of SALES_ROUTES made C1 read FAIL.
    /const SALES_ROUTES = new Set\(\[[\s\S]*?'\/api\/extend-request',\n[\s\S]*?\]\);/.test(W)
    && /url\.pathname === '\/api\/extend-request' && request\.method === 'POST'\)\n\s+return await handleExtendRequest\(/.test(W)
    && /url\.pathname === '\/api\/admin\/extend-request' && request\.method === 'POST'\)\n\s+return await handleExtendDecision\(/.test(W)
    && /if \(minute % 15 === 3\) \{\n\s+ctx\.waitUntil\(sweepFullServiceMonths\(env, \{\n\s+windowEnd: fullAccessWindowEnd, notifyUser, sendEmail, pingCase, salesOpen: SALES_OPEN,/.test(W)
    && /monthCentsFor: async \(data\) => \(await ratesForCase\(env, data\)\)\.fullCents/.test(W));
  // NEGATIVE CONTROL (run 2026-10-17): the reopen's `c.data.extendRequest?.state === 'approved'` condition taken out made this read
  //   FAIL  C2 paying reopens a closed case only for the month its advocate approved, as it was, and a month given free records nothing
  check('C2 paying reopens a closed case only for the month its advocate approved, as it was, and a month given free records nothing',
    /const reopening = session\.metadata\?\.reopen === '1' && c\.data\.fullAccess && c\.data\.status === 'closed'\n\s+&& c\.data\.extendRequest\?\.state === 'approved';/.test(conf)
    && /if \(!c\.data\.fullAccess \|\| \(c\.data\.status === 'closed' && !reopening\)\) \{/.test(conf)
    && /status: c\.data\.closedFromStatus \|\| 'confirmed', closedAt: null, closedBy: null, closedReason: null,/.test(conf)
    && /\.\.\.\(reopening \? \['status', 'closedAt', 'closedBy', 'closedReason', 'extendRequest', 'monthNotice'\] : \[\]\)/.test(conf)
    && /const amountCents = Number\.isFinite\(Number\(session\.amount_total\)\) \? Number\(session\.amount_total\) : FULL_EXTEND\[30\];/.test(conf));
  // NEGATIVE CONTROL (run 2026-10-17): the chat reply's `staffMsgAt: now` left out made this read
  //   FAIL  C3 the Worker stamps what the pace is read from: their last word to the client, work logged, where a month's hours start
  check('C3 the Worker stamps what the pace is read from: their last word to the client, work logged, where a month\'s hours start',
    /if \(kind === 'case'\) \{\n\s+ctx\.waitUntil\(patchDoc\(env, `cases\/\$\{id\}`, \{ staffMsgAt: new Date\(\) \}, \{ mask: \['staffMsgAt'\] \}\)/.test(W)
    && /staffMsgAt: now,\n\s+\}, \{ mask: \['lastMessage', 'staffMsgAt'\] \}\)/.test(W)
    && /\{ work: \{ loggedAt: new Date\(\) \} \}, \{ mask: \['work\.loggedAt'\] \}/.test(W)
    && /work: \{ monthStartSeconds: Math\.max\(0, Number\(c\.data\.work\?\.seconds\) \|\| 0\) \},/.test(conf));
}

console.log('\n--- D. the pages ---');
{
  const CJ = f('public/js/case.js');
  const ask = (CJ.match(/function monthAsk\(c\) \{[\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17): extendOffer's first line (`return monthAsk(c)` on a month-closed case) taken out made this read
  //   FAIL  D1 a case its month closed shows the shining ask in its four states, and the ask and Ask again go while sales are off
  check('D1 a case its month closed shows the shining ask in its four states, and the ask and Ask again go while sales are off',
    /function extendOffer\(c\) \{\n\s+if \(c\.fullAccess && c\.status === 'closed' && c\.monthEndedAt\) return monthAsk\(c\);/.test(CJ)
    && /data-month-ask="approved"/.test(ask) && /data-month-ask="pending"/.test(ask) && /data-month-ask="declined"/.test(ask) && /data-month-ask="offer"/.test(ask)
    && /<button type="button" class="btn glow" data-request-month>Request another month<\/button>/.test(ask)
    && /Nothing is charged unless they say yes\./.test(ask) && /class="followup-offer month-ask"/.test(ask)
    && /\.followup-offer\.month-ask::after \{ animation: pa-month-shine/.test(CJ) && /prefers-reduced-motion: no-preference/.test(CJ)
    // RE-PINNED 2026-10-17 (v7.65): the appeal's two buttons follow on the list.
    // NEGATIVE CONTROL (run 2026-10-17, v7.65): [data-request-month] taken off SELLING made D1 read FAIL.
    && /const SELLING = '[^']*\[data-ask-again\],\[data-request-month\][^']*';/.test(CJ)
    && /fetch\('\/api\/extend-request'/.test(CJ));
  const AC = f('public/js/admin-case.js');
  const AD = f('public/js/admin.js');
  // NEGATIVE CONTROL (run 2026-10-17): admin.js's Needs attention loop over former cases taken out made this read
  //   FAIL  D2 the advocate sees the ask on the case with Approve and Can't take it, and on the shelf under Needs attention
  check('D2 the advocate sees the ask on the case with Approve and Can\'t take it, and on the shelf under Needs attention',
    /\$\{c\.extendRequest\?\.state === 'pending' && c\.status === 'closed' \? `/.test(AC) && /data-month-request="approve">Approve: send the link<\/button>/.test(AC)
    && /data-month-request="decline">Can't take it<\/button>/.test(AC) && /fetch\('\/api\/admin\/extend-request'/.test(AC)
    && /for \(const c of former\) \{\n\s+if \(c\.extendRequest\?\.state === 'pending'\) loops\.push\(\{[^\n]*label: 'Asking for another month', tone: 'hot' \}\);/.test(AD));
  // NEGATIVE CONTROL (run 2026-10-17): a long dash put in the ask's heading made this read
  //   FAIL  D3 no dash in the new words
  check('D3 no dash in the new words', !DASH.test(ask) && !DASH.test((AC.match(/data-month-request style[\s\S]*?<\/div>` : ''\}/) || [''])[0]));
}

console.log('\n--- E. the pace ---');
{
  const { pacingFlags } = await import(pathToFileURL(join(ROOT, 'public/js/admin-pacing.js')).href);
  const now = Date.now();
  const ago = (d) => new Date(now - d * DAY).toISOString();
  const base = { fullAccess: true, status: 'confirmed', fullAccessAt: ago(20), work: { seconds: 30 * 3600, updatedAt: ago(1) }, staffMsgAt: ago(1) };
  const ids = (c) => pacingFlags(c, now).map((x) => x.id).join(',');
  const quiet = pacingFlags({ ...base, work: { seconds: 30 * 3600, updatedAt: ago(9) } }, now);
  const logged = ids({ ...base, work: { seconds: 30 * 3600, updatedAt: ago(9), loggedAt: ago(2) } });
  const running = ids({ ...base, work: { seconds: 30 * 3600, updatedAt: ago(9), startedAt: ago(0) } });
  // NEGATIVE CONTROL (run 2026-10-17): admin-pacing.js's lastWork leaving out `ms(w.loggedAt)` made this read
  //   FAIL  E1 a week with no clock time and no work log entry is flagged with its days; a log entry or a running clock clears it
  check('E1 a week with no clock time and no work log entry is flagged with its days; a log entry or a running clock clears it',
    quiet.map((x) => x.id).join(',') === 'quiet' && quiet[0].label === 'No work logged in 9 days' && logged === '' && running === '',
    JSON.stringify({ quiet, logged, running }));
  const unheard = pacingFlags({ ...base, staffMsgAt: ago(8) }, now);
  const lastWordTheirs = ids({ ...base, staffMsgAt: null, lastMessage: { role: 'admin', ts: ago(3) } });
  // NEGATIVE CONTROL (run 2026-10-17): admin-pacing.js's lastWord leaving out the advocate's own last message made this read
  //   FAIL  E2 a week with no word to the client is flagged; their own last message counts as a word
  check('E2 a week with no word to the client is flagged; their own last message counts as a word',
    unheard.map((x) => x.id).join(',') === 'unheard' && unheard[0].label === 'No update to the client in 8 days' && lastWordTheirs === '',
    JSON.stringify({ unheard, lastWordTheirs }));
  const fresh = { ...base, fullAccessAt: ago(4), staffMsgAt: ago(1), work: { seconds: 14 * 3600, tierMark: 1 * 3600, updatedAt: ago(1) } };
  const front = pacingFlags(fresh, now);
  const light = ids({ ...fresh, work: { ...fresh.work, seconds: 9 * 3600 } });
  const later = ids({ ...base, extraPayments: [{ kind: 'extend', at: ago(3) }], work: { seconds: 60 * 3600, monthStartSeconds: 46 * 3600, updatedAt: ago(1) } });
  const unstamped = ids({ ...base, extraPayments: [{ kind: 'extend', at: ago(3) }], work: { seconds: 60 * 3600, updatedAt: ago(1) } });
  // NEGATIVE CONTROL (run 2026-10-17): FRONT_SHARE raised to 0.9 made this read
  //   FAIL  E3 most of the month's hours in its first week are flagged, counted from where that month's hours began, and never guessed
  check('E3 most of the month\'s hours in its first week are flagged, counted from where that month\'s hours began, and never guessed',
    front.map((x) => x.id).join(',') === 'front' && front[0].label === '13 of the month\'s 20 hours in its first week' && light === ''
    && later === 'front' && unstamped === '',
    JSON.stringify({ front, light, later, unstamped }));
  const quietBase = { ...base, work: { seconds: 0, updatedAt: ago(9) }, staffMsgAt: ago(9) };
  // NEGATIVE CONTROL (run 2026-10-17): admin-pacing.js's `c.hold?.pausedAt` exclusion taken out made this read
  //   FAIL  E4 never on a closed case, a held one, his own, the showcase, or in a month's first week of quiet
  check('E4 never on a closed case, a held one, his own, the showcase, or in a month\'s first week of quiet',
    ids(quietBase) === 'quiet,unheard' && ids({ ...quietBase, status: 'closed' }) === '' && ids({ ...quietBase, hold: { pausedAt: ago(1) } }) === ''
    && ids({ ...quietBase, self: true }) === '' && ids({ ...quietBase, showcase: true }) === '' && ids({ ...quietBase, fullAccess: false }) === ''
    && ids({ ...quietBase, fullAccessAt: ago(5) }) === '');
  const AD = f('public/js/admin.js');
  const AC = f('public/js/admin-case.js');
  // NEGATIVE CONTROL (run 2026-10-17): admin.js's Needs attention pace loop taken out made this read
  //   FAIL  E5 the flags show on the folder, under Needs attention and on the case, and the module is gated as admin
  check('E5 the flags show on the folder, under Needs attention and on the case, and the module is gated as admin',
    /\$\{pacingFlags\(c\)\.length \? ' <strong class="fld-alert">CHECK THE PACE<\/strong>' : ''/.test(AD)
    && /for \(const f of pacingFlags\(c\)\) loops\.push\(\{ href, name, label: f\.label, tone: 'warm' \}\);/.test(AD)
    && /for \(const f of pacingFlags\(c\)\) loops\.push\(\['warm', f\.label\]\);/.test(AC)
    && /'\/js\/admin-pacing\.js',/.test(f('tools/blindness-audit.mjs')) && !DASH.test(f('public/js/admin-pacing.js')));
}

console.log('\n--- F. Demo mode ---');
{
  const mem = new Map([['pa-demo-live', '1']]);
  globalThis.sessionStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  globalThis.window = { fetch: async () => new Response('{}'), addEventListener() {}, location: { origin: 'http://x' } };
  globalThis.location = { origin: 'http://x', hostname: '127.0.0.1', pathname: '/admin.html', search: '' };
  globalThis.document = { addEventListener() {}, querySelector: () => null, createElement: () => ({}) };
  const { demoApi } = await import(pathToFileURL(join(ROOT, 'public/js/demo/api.js')).href);
  const docs = new Map(); const files = new Map();
  const now = Date.now();
  docs.set('cases/m1', { fullAccess: true, status: 'closed', closedFromStatus: 'confirmed', monthEndedAt: new Date(now - 2 * DAY), fullAccessAt: new Date(now - 32 * DAY), clientUid: 'c', clientName: 'Jordan Avery', work: { seconds: 40 * 3600 } });
  demoApi('admin', { docs, files, reset() {}, fire() {}, persist() {} });
  const call = async (path, body) => { const r = await window.fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
  const asked = await call('/api/extend-request', { caseId: 'm1' });
  const yes = await call('/api/admin/extend-request', { caseId: 'm1', decision: 'approve' });
  const c = docs.get('cases/m1');
  const end = new Date(c.fullAccessAt).getTime() + (30 + c.fullAccessExtraDays) * DAY;
  // NEGATIVE CONTROL (run 2026-10-17): the demo's yes leaving the case closed (`status: c.closedFromStatus || 'confirmed'` taken out) made this read
  //   FAIL  F1 in the demo the ask lands with the advocate, and a yes opens the case again with thirty days from today
  check('F1 in the demo the ask lands with the advocate, and a yes opens the case again with thirty days from today',
    asked.body.state === 'pending' && yes.body.state === 'started' && c.status === 'confirmed' && c.extendRequest.state === 'started'
    && Math.abs(end - (now + 30 * DAY)) < 1.5 * DAY && c.work.monthStartSeconds === 40 * 3600,
    JSON.stringify({ asked: asked.body, yes: yes.body, status: c.status, days: Math.round((end - now) / DAY) }));
}

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
