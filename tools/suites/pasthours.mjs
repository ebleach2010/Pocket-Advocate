// pasthours.mjs - past a Full-Service month's 20 hours: the notice, the three choices, and the bill (v7.78).
//
// Eric, 2026-10-17: "The full service clients should get a notification and a pop up when opening the app once 20
// hours have passed. 'To continue, select one of the three: continue up to the full 30 days for [$/hour] | Purchase
// an addition month at [fulll case price] | end case (all information is kept for your reference)'". Asked the rate:
// "$200 an hour". Asked how it is paid: "Advocate bills hours used".
//
// public/js/extra-hours.js is imported; worker/hours.js is evaluated whole with Firestore as a Map, Stripe, pushes
// and mail as recorders, and the real staff gates beside it.
//
//   P1 the hours: past the month's, what is left to bill, to the minute, hours paid for their own
//   P2 the client's choice: only their own case, only while it stands; by the hour, or ended with everything kept
//   P3 Bill extra hours: only the case's advocate, only after by the hour that month, one link at a time
//   P4 paid: the minutes are theirs, once; an unpaid link clears
//   P5 the Worker: routes, webhook, expiry, the notice once a month, payroll's line, the numbers pinned equal
//   P6 the pages: his words in the pop up, asked on opening, the bill on her card, Bill extra hours, the demo
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
const XH = await import(pathToFileURL(join(ROOT, 'public/js/extra-hours.js')).href);
const STAFF = await import(pathToFileURL(join(ROOT, 'worker/staff.js')).href);
const H = 3600;
const ENV = { ADMIN_UID: 'eric-uid' };
const full = (o = {}) => ({ fullAccess: true, status: 'confirmed', clientUid: 'dana', clientName: 'Dana Reyes', clientEmail: 'dana@example.com', advocateId: 'ana', fullAccessMonths: 1, work: { seconds: 2 * H, tierMark: 2 * H }, ...o });
const worked = (sec, o = {}) => full({ work: { seconds: 2 * H + sec, tierMark: 2 * H }, ...o });

// ---- P1 ------------------------------------------------------------------------------------------------------------
{
  const n = XH.needsChoice;
  const paid3 = worked(23 * H, { hoursBilledSec: 3 * H });
  const month2 = worked(45 * H, { fullAccessMonths: 2, hoursBilledSec: 3 * H });
  // NEGATIVE CONTROL (run 2026-10-17): hoursOf's `const used = Math.max(0, delivered - billed);` made `const used = delivered;` made this read
  //   FAIL  P1 past the month's hours they are asked once a month until they choose; what is left to bill is to the minute, and hours paid for are their own
  check('P1 past the month\'s hours they are asked once a month until they choose; what is left to bill is to the minute, and hours paid for are their own',
    !n(worked(19.9 * H)) && n(worked(20 * H)) && !n(worked(21 * H, { hoursChoice: { kind: 'hourly', month: 1 } }))
    && !n(worked(30 * H, { fullAccessMonths: 2 })) && n(worked(40 * H, { fullAccessMonths: 2, hoursChoice: { kind: 'hourly', month: 1 } }))
    && !n(worked(25 * H, { status: 'closed' })) && !n(worked(25 * H, { self: true })) && !n(worked(25 * H, { family: true })) && !n({ status: 'confirmed', work: { seconds: 90 * H } })
    && XH.hoursOf(paid3).used === 20 * H && XH.hoursOf(paid3).extra === 0 && n(paid3)
    && XH.hoursOf(month2).extra === 2 * H && XH.hoursOf(worked(22 * H)).extra === 2 * H
    && XH.extraCents(2 * H + 17 * 60 + 40) === 45667 && XH.extraCents(59) === 0 && XH.extraCents(H) === 20000
    && XH.hm(2 * H + 17 * 60) === '2h 17m' && XH.money(45667) === '$456.67' && XH.money(440000) === '$4,400'
    && XH.MONTH_HOURS === 20 && XH.EXTRA_HOUR_CENTS === 20000 && !DASH.test(f('public/js/extra-hours.js')),
    JSON.stringify({ paid3: XH.hoursOf(paid3), month2: XH.hoursOf(month2) }));
}

// The Worker's module, run with stand-ins.
function world(cases) {
  const docs = new Map(Object.entries(cases).map(([id, d]) => [`cases/${id}`, JSON.parse(JSON.stringify(d))]));
  const pings = []; const pushes = []; const mails = []; const stripe = []; const stopped = [];
  let t = 0;
  const getDoc = async (env, p) => (docs.has(p) ? { id: p.split('/').pop(), data: JSON.parse(JSON.stringify(docs.get(p))), updateTime: `t${t}` } : null);
  const patchDoc = async (env, p, data, opts = {}) => {
    if (opts.ifUpdateTime && opts.ifUpdateTime !== `t${t}`) return false;
    docs.set(p, { ...(docs.get(p) || {}), ...JSON.parse(JSON.stringify(data)) }); t += 1; return true;
  };
  const src = f('worker/hours.js').replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function) /gm, '$1 ');
  const M = new Function('getDoc', 'patchDoc', 'hoursOf', 'needsChoice', 'extraCents', 'hm', 'money', 'EXTRA_HOUR_CENTS',
    `${src}\nreturn { handleHoursChoice, handleBillHours, confirmHoursPurchase, clearHoursCheckout, ENDED_REASON };`)(
    getDoc, patchDoc, XH.hoursOf, XH.needsChoice, XH.extraCents, XH.hm, XH.money, XH.EXTRA_HOUR_CENTS);
  const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  const who = { dana: { uid: 'dana' }, lee: { uid: 'lee' } };
  const staffOf = { ana: { uid: 'ana', isAdmin: false }, ben: { uid: 'ben', isAdmin: false }, eric: { uid: 'eric-uid', isAdmin: true } };
  const req = (as, body) => new Request('https://x/api', { method: 'POST', headers: { 'x-as': as }, body: JSON.stringify(body) });
  const hc = {
    requireUser: async (r) => who[r.headers.get('x-as')] || null, json,
    pingCase: async (env, c, body, link) => { pings.push({ body, link }); },
    stopClock: async (env, id, data) => { stopped.push(id); await patchDoc(env, `cases/${id}`, { work: { ...data.work, startedAt: null } }); },
  };
  const hb = {
    requireStaff: async (r) => staffOf[r.headers.get('x-as')] || null, staffSees: STAFF.staffSees, json,
    notifyUser: async (env, uid, m) => { pushes.push({ uid, ...m }); },
    sendEmail: async (env, m) => { mails.push(m); },
    stripePost: async (env, path, body) => { stripe.push({ path, body }); return { id: `cs_${stripe.length}`, url: `https://pay/${stripe.length}` }; },
    baseUrl: 'https://app',
  };
  const call = async (fn, h, as, body) => { const res = await fn(req(as, body), ENV, h); return { status: res.status, out: await res.json() }; };
  return { docs, pings, pushes, mails, stripe, stopped, M, choose: (as, body) => call(M.handleHoursChoice, hc, as, body), bill: (as, body) => call(M.handleBillHours, hb, as, body) };
}

// ---- P2 ------------------------------------------------------------------------------------------------------------
{
  const w = world({ k1: worked(21 * H), k2: worked(12 * H), k3: worked(22 * H, { work: { seconds: 2 * H + 22 * H, tierMark: 2 * H, startedAt: '2026-10-17T10:00:00Z' } }) });
  const other = await w.choose('lee', { caseId: 'k1', choice: 'hourly' });
  const early = await w.choose('dana', { caseId: 'k2', choice: 'hourly' });
  const odd = await w.choose('dana', { caseId: 'k1', choice: 'free' });
  const hourly = await w.choose('dana', { caseId: 'k1', choice: 'hourly' });
  const again = await w.choose('dana', { caseId: 'k1', choice: 'end' });
  const ended = await w.choose('dana', { caseId: 'k3', choice: 'end' });
  const k1 = w.docs.get('cases/k1'); const k3 = w.docs.get('cases/k3');
  // NEGATIVE CONTROL (run 2026-10-17): handleHoursChoice's `|| c.data.clientUid !== user.uid` taken out made this read
  //   FAIL  P2 the client chooses on their own case only, only past the hours: by the hour is kept for the month and their advocate told; ending closes it with everything kept and the clock banked
  check('P2 the client chooses on their own case only, only past the hours: by the hour is kept for the month and their advocate told; ending closes it with everything kept and the clock banked',
    other.status === 404 && early.status === 409 && odd.status === 400
    && hourly.status === 200 && k1.hoursChoice?.kind === 'hourly' && k1.hoursChoice.month === 1 && k1.hoursChoice.rateCents === 20000 && k1.status === 'confirmed'
    && again.status === 409
    && ended.status === 200 && k3.status === 'closed' && k3.closedBy === 'client' && k3.closedReason === w.M.ENDED_REASON && k3.closedFromStatus === 'confirmed'
    && k3.hoursChoice?.kind === 'end' && w.stopped.includes('k3') && k3.work.startedAt === null
    && w.pings.length === 2 && /Dana chose to continue to the end of the month at \$200 an hour/.test(w.pings[0].body) && /Dana ended their case after the month's 20 hours\. Everything stays on file\./.test(w.pings[1].body),
    JSON.stringify({ other: other.status, early: early.status, hourly: hourly.status, again: again.status, ended: ended.status, k1: k1.hoursChoice, k3: { s: k3.status, by: k3.closedBy } }));
}

// ---- P3 ------------------------------------------------------------------------------------------------------------
{
  const yes = { kind: 'hourly', month: 1 };
  const w = world({
    k1: worked(22 * H + 17 * 60 + 40, { hoursChoice: yes }),
    k2: worked(23 * H),
    k3: worked(41 * H, { fullAccessMonths: 2, hoursChoice: yes }),
    k4: worked(20 * H + 30, { hoursChoice: yes }),
  });
  const stranger = await w.bill('ben', { caseId: 'k1' });
  const noYes = await w.bill('ana', { caseId: 'k2' });
  const lastMonth = await w.bill('ana', { caseId: 'k3' });
  const tooLittle = await w.bill('ana', { caseId: 'k4' });
  const sent = await w.bill('ana', { caseId: 'k1' });
  const twice = await w.bill('eric', { caseId: 'k1' });
  const s0 = w.stripe[0]?.body;
  const k1 = w.docs.get('cases/k1');
  // NEGATIVE CONTROL (run 2026-10-17): handleBillHours' `|| !h.staffSees(staff, c.data, env)` taken out made this read
  //   FAIL  P3 Bill extra hours: only the case's advocate or him, only after they chose by the hour that month, every whole minute past the hours, one link at a time, and the client told and mailed
  check('P3 Bill extra hours: only the case\'s advocate or him, only after they chose by the hour that month, every whole minute past the hours, one link at a time, and the client told and mailed',
    stranger.status === 404 && noYes.status === 409 && lastMonth.status === 409 && tooLittle.status === 409
    && sent.status === 200 && sent.out.seconds === 2 * H + 17 * 60 && sent.out.cents === 45667
    && w.stripe.length === 1 && s0?.metadata?.kind === 'hours' && s0.metadata.caseId === 'k1' && s0.metadata.seconds === String(2 * H + 17 * 60)
    && s0.line_items[0].price_data.unit_amount === 45667 && s0.customer_email === 'dana@example.com' && /hourspaid=1/.test(s0.success_url)
    && k1.pendingHours?.url === 'https://pay/1' && k1.pendingHours.seconds === 2 * H + 17 * 60
    && twice.status === 200 && twice.out.already === true && twice.out.url === 'https://pay/1'
    && w.pushes.length === 1 && w.pushes[0].uid === 'dana' && w.pushes[0].body === 'Your bill for the extra hours is ready: 2h 17m, $456.67.'
    && w.mails.length === 1 && /https:\/\/pay\/1/.test(w.mails[0].html),
    JSON.stringify({ stranger: stranger.status, noYes: noYes.status, lastMonth: lastMonth.status, tooLittle: tooLittle.status, sent: sent.out, stripe: w.stripe.length }));
}

// ---- P4 ------------------------------------------------------------------------------------------------------------
{
  const w = world({ k1: worked(22 * H + 17 * 60, { hoursChoice: { kind: 'hourly', month: 1 }, pendingHours: { sessionId: 'cs_9', url: 'https://pay/9', seconds: 2 * H + 17 * 60 } }), k2: worked(21 * H, { pendingHours: { sessionId: 'cs_live', url: 'https://pay/x' } }) });
  const session = { id: 'cs_9', amount_total: 45667, metadata: { kind: 'hours', caseId: 'k1', seconds: String(2 * H + 17 * 60) } };
  await w.M.confirmHoursPurchase(ENV, session, { pingCase: async (env, c, body) => { w.pings.push({ body }); } });
  await w.M.confirmHoursPurchase(ENV, session, { pingCase: async (env, c, body) => { w.pings.push({ body }); } });
  const k1 = w.docs.get('cases/k1');
  await w.M.clearHoursCheckout(ENV, { id: 'cs_old', metadata: { caseId: 'k2' } });
  const kept = w.docs.get('cases/k2').pendingHours;
  await w.M.clearHoursCheckout(ENV, { id: 'cs_live', metadata: { caseId: 'k2' } });
  // NEGATIVE CONTROL (run 2026-10-17): confirmHoursPurchase's `if (payments.some((x) => x.sessionId === session.id)) return;` taken out made this read
  //   FAIL  P4 paid, the minutes are theirs once: the payment is written down, nothing is left to bill, and only its own unpaid link is cleared
  check('P4 paid, the minutes are theirs once: the payment is written down, nothing is left to bill, and only its own unpaid link is cleared',
    k1.extraPayments?.length === 1 && k1.extraPayments[0].kind === 'hours' && k1.extraPayments[0].amountCents === 45667 && k1.extraPayments[0].seconds === 2 * H + 17 * 60
    && k1.hoursBilledSec === 2 * H + 17 * 60 && k1.pendingHours === null && XH.hoursOf(k1).extra === 0
    && w.pings.length === 1 && w.pings[0].body === 'Dana paid for 2h 17m of extra hours ($456.67).'
    && kept?.sessionId === 'cs_live' && w.docs.get('cases/k2').pendingHours === null,
    JSON.stringify({ pays: k1.extraPayments?.length, billed: k1.hoursBilledSec, pings: w.pings.length }));
}

// ---- P5 ------------------------------------------------------------------------------------------------------------
{
  const W = f('worker/index.js'); const PAY = f('worker/payroll.js'); const CASE = f('public/js/case.js');
  const hook = (W.match(/async function markIncludedHours\([\s\S]*?\n\}/) || [''])[0];
  const num = (src, name) => Number((src.match(new RegExp(`const ${name} = (\\d+);`)) || [])[1]);
  // NEGATIVE CONTROL (run 2026-10-17): the webhook's `else if (obj.metadata?.kind === 'hours') await confirmHoursPurchase(env, obj, { pingCase });` taken out made this read
  //   FAIL  P5 the Worker routes both doors, takes the payment, clears an unpaid link, tells them once a month past what was billed, and payroll names the line; the 20 is one number
  check('P5 the Worker routes both doors, takes the payment, clears an unpaid link, tells them once a month past what was billed, and payroll names the line; the 20 is one number',
    /import \{ handleHoursChoice, handleBillHours, confirmHoursPurchase, clearHoursCheckout \} from '\.\/hours\.js';/.test(W)
    && /url\.pathname === '\/api\/hours-choice' && request\.method === 'POST'\)\n\s+return await handleHoursChoice\(request, env, \{\n\s+requireUser, json, pingCase,/.test(W)
    && /stopClock: \(e, id, data\) => stopWorkClock\(e, id, data\.work, Date\.now\(\), clockPathFor\(e, advocateIdOf\(data, e\)\)\),/.test(W)
    && /url\.pathname === '\/api\/admin\/bill-hours' && request\.method === 'POST'\)\n\s+return await handleBillHours\(request, env, \{ requireStaff, staffSees, json, notifyUser, sendEmail, stripePost, baseUrl: env\.PUBLIC_BASE_URL \}\);/.test(W)
    && /else if \(obj\.metadata\?\.kind === 'hours'\) await confirmHoursPurchase\(env, obj, \{ pingCase \}\);/.test(W)
    && /if \(session\.metadata\?\.kind === 'hours' && session\.metadata\.caseId\) await clearHoursCheckout\(env, session\);/.test(W)
    && /const told = Number\(c\.work\?\.includedDoneMonths\) \|\| \(c\.work\?\.includedDoneAt \? 1 : 0\);/.test(hook)
    && /bankedSeconds - tierMark - Math\.max\(0, Number\(c\.hoursBilledSec\) \|\| 0\)/.test(hook) && /c\.family/.test(hook)
    && /hours: 'Full-Service extra hours',/.test(PAY)
    && num(W, 'FULL_INCLUDED_HOURS') === XH.MONTH_HOURS && num(CASE, 'FULL_INCLUDED_HOURS') === XH.MONTH_HOURS
    && !DASH.test(f('worker/hours.js')),
    JSON.stringify({ hookLen: hook.length }));
}

// ---- P6 ------------------------------------------------------------------------------------------------------------
{
  const CASE = f('public/js/case.js'); const ACASE = f('public/js/admin-case.js'); const DEMO = f('public/js/demo/api.js');
  const ask = (CASE.match(/function openHoursAsk\(c\) \{[\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17): the `askHoursIfDue();` after watchCase() taken out made this read
  //   FAIL  P6 the pop up is his words with the rate and the month's price, asked on opening and as the hours land; the bill is on their card; Bill extra hours on the case; the demo answers both
  check('P6 the pop up is his words with the rate and the month\'s price, asked on opening and as the hours land; the bill is on their card; Bill extra hours on the case; the demo answers both',
    /<h2>To continue, select one of the three:<\/h2>/.test(ask)
    && /data-pick="hourly">continue up to the full 30 days for \$\{money\(EXTRA_HOUR_CENTS\)\} an hour<\/button>/.test(ask)
    && /data-pick="month">Purchase an additional month at <span data-hours-price>\$\{money\(fullAccessPrice\(\)\)\}<\/span><\/button>/.test(ask)
    && /data-pick="end">end case \(all information is kept for your reference\)<\/button>/.test(ask)
    && /data-later>Not now</.test(ask) && /<h2>End your case now\?<\/h2>/.test(ask) && /fetch\('\/api\/hours-choice'/.test(ask)
    && /fetch\('\/api\/extend', \{[\s\S]{0,200}quotedCents: fullAccessPrice\(\)/.test(ask)
    && /\.hours-picks \.btn::first-letter \{ text-transform: uppercase; \}/.test(CASE)
    && /watchCase\(\);\n\s+\/\/ Past the month's hours: asked on opening \(2026-10-17, v7\.78\)\.\n\s+askHoursIfDue\(\);/.test(CASE)
    && /refreshSections\(\);\n\s+armWorkTick\(\);\n\s+askHoursIfDue\(\);/.test(CASE)
    && /Your bill for the extra hours: \$\{esc\(hm\(p\.seconds\)\)\}, \$\{esc\(money\(p\.cents\)\)\}\./.test(CASE) && /data-hours-choose>Choose how to continue</.test(CASE)
    && /\$\{pastHoursPanel\(c\)\}/.test(ACASE) && /<button class="btn" data-bill-hours>Bill extra hours<\/button>/.test(ACASE) && /fetch\('\/api\/admin\/bill-hours'/.test(ACASE)
    && /if \(path === '\/api\/hours-choice'\) \{/.test(DEMO) && /if \(path === '\/api\/admin\/bill-hours'\) \{/.test(DEMO)
    && !/no extra charge/.test(ask) && !DASH.test(ask),
    JSON.stringify({ askLen: ask.length }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
