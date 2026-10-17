// days.mjs - the day of the service beside the hours, a report past due, and his alert (v7.77).
//
// Eric, 2026-10-17: "Next to hours should be the day we're on of the service. For full services, this is up to 30
// days. If they choose to opt for another month, it gets reset. For advocacy case, it's up to the point of the
// meeting, and then it resets for the 14 days to deliver. Days past that flag that in a red highlight with 'report
// past due'. For chat this can be simply by month. So '1 month of chatting'. Then nothing until the second month."
// Asked where: "Both, and if a contractor has missed the due date the app alerts me and marks the contractor in
// employment mode".
//
// public/js/service-day.js and worker/employer.js are imported; the Worker's sweep is lifted and RUN.
//
//   D1 Full-Service and a monthly service count the day of a 30 day month, again from 1 when a month starts
//   D2 an Advocacy Case counts the days to the call, then the 14 to the report, then says report past due in red
//   D3 a chat line counts by the month
//   D4 Employer mode's summary counts each team member's reports past due
//   D5 the sweep tells him once for each contractor's report past due, never for his own
//   D6 the pages: the client's case, his case page, his shelf, both chat pages, Employer mode, the demo
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
const SD = await import(pathToFileURL(join(ROOT, 'public/js/service-day.js')).href);
const EMP = await import(pathToFileURL(join(ROOT, 'worker/employer.js')).href);
const STAFF = await import(pathToFileURL(join(ROOT, 'worker/staff.js')).href);
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-17T18:00:00Z');
const ago = (d) => new Date(NOW - d * DAY).toISOString();
const ahead = (d) => new Date(NOW + d * DAY).toISOString();

// ---- D1 ------------------------------------------------------------------------------------------------------------
{
  const full = { fullAccess: true, status: 'confirmed', fullAccessAt: ago(10.5) };
  const stacked = { ...full, fullAccessExtraDays: 30 };
  const restarted = { ...full, fullAccessAt: ago(70.5), fullAccessExtraDays: 70 };
  const paused = { ...full, hold: { totalMs: 5 * DAY } };
  const svc = { serviceMonthly: true, service: { kind: 'month' }, status: 'confirmed', charge: { state: 'captured', decidedAt: ago(5.5) } };
  const held = { ...svc, charge: { state: 'held' } };
  const day = (c) => SD.caseDay(c, NOW)?.text || null;
  // NEGATIVE CONTROL (run 2026-10-17): monthDay's `31 - (((left - 1) % 30) + 1)` made `31 - left` made this read
  //   FAIL  D1 Full-Service and a monthly service count the day of a 30 day month, where the current month stands with one bought ahead, and again from 1 when a month starts
  check('D1 Full-Service and a monthly service count the day of a 30 day month, where the current month stands with one bought ahead, and again from 1 when a month starts',
    day(full) === 'Day 11 of 30' && day(stacked) === 'Day 11 of 30' && day(restarted) === 'Day 1 of 30' && day(paused) === 'Day 6 of 30'
    && day(svc) === 'Day 6 of 30' && day(held) === null && day({ ...full, status: 'closed' }) === null
    && SD.monthDay(NOW + 30 * DAY, NOW) === 1 && SD.monthDay(NOW + 1, NOW) === 30 && SD.monthDay(NaN, NOW) === null,
    JSON.stringify({ full: day(full), stacked: day(stacked), restarted: day(restarted), paused: day(paused), svc: day(svc) }));
}

// ---- D2 ------------------------------------------------------------------------------------------------------------
{
  const booked = { status: 'confirmed', createdAt: ago(2.2), appointment: { start: ahead(4.6) } };
  const after = { status: 'awaiting_report', createdAt: ago(9), reportDueAt: ahead(8.5) };
  const late1 = { status: 'awaiting_report', createdAt: ago(20), reportDueAt: ago(0.4) };
  const late3 = { status: 'awaiting_report', createdAt: ago(20), reportDueAt: ago(2.5) };
  const requested = { status: 'confirmed', createdAt: ago(1.5), appointment: { requested: true } };
  const r = (c) => SD.caseDay(c, NOW);
  // NEGATIVE CONTROL (run 2026-10-17): caseDay's `late: true` on a report past due made `late: false` made this read
  //   FAIL  D2 an Advocacy Case counts the days from booking to the call, then the 14 to the report, then says report past due in red; delivered, closed, his own and a one-time service have no count
  check('D2 an Advocacy Case counts the days from booking to the call, then the 14 to the report, then says report past due in red; delivered, closed, his own and a one-time service have no count',
    r(booked)?.text === 'Day 3 of 7' && r(booked).late === false && r(after)?.text === 'Day 6 of 14'
    && r(late1)?.text === 'Report past due, 1 day' && r(late1).late === true && r(late3)?.text === 'Report past due, 3 days' && r(late3).over === 3
    && r(requested)?.text === 'Day 2'
    && r({ ...after, status: 'delivered' }) === null && r({ ...after, reportDeliveredAt: ago(1) }) === null && r({ ...after, status: 'closed' }) === null
    && r({ ...after, self: true }) === null && r({ status: 'confirmed', createdAt: ago(1), service: { kind: 'once' } }) === null
    && SD.REPORT_DAYS === 14 && !DASH.test(f('public/js/service-day.js')),
    JSON.stringify({ booked: r(booked), after: r(after), late1: r(late1), late3: r(late3), requested: r(requested) }));
}

// ---- D3 ------------------------------------------------------------------------------------------------------------
{
  // NEGATIVE CONTROL (run 2026-10-17): chatMonths' `+ 1` taken out made this read
  //   FAIL  D3 a chat line counts by the month: 1 month of chatting until the second month starts
  check('D3 a chat line counts by the month: 1 month of chatting until the second month starts',
    SD.chatMonths({ startedAt: ago(10) }, NOW) === '1 month of chatting' && SD.chatMonths({ startedAt: ago(29.9) }, NOW) === '1 month of chatting'
    && SD.chatMonths({ startedAt: ago(31) }, NOW) === '2 months of chatting' && SD.chatMonths({ createdAt: ago(95) }, NOW) === '4 months of chatting'
    && SD.chatMonths({}, NOW) === null);
}

// ---- D4 ------------------------------------------------------------------------------------------------------------
{
  const late = { advocateId: 'ana', status: 'awaiting_report', clientName: 'Dana Reyes', createdAt: ago(20), reportDueAt: ago(2) };
  const onTime = { advocateId: 'ana', status: 'awaiting_report', clientName: 'Lee Park', createdAt: ago(5), reportDueAt: ahead(9) };
  const his = { advocateId: 'eric', status: 'awaiting_report', clientName: 'Sam Roe', createdAt: ago(20), reportDueAt: ago(1) };
  const team = EMP.teamSummary({
    advocates: [{ id: 'eric', data: { name: 'Eric Leach', owner: true, active: true } }, { id: 'ana', data: { name: 'Ana Rivera', active: true } }],
    cases: [{ id: 'k1', data: late }, { id: 'k2', data: onTime }, { id: 'k3', data: his }], subs: [], subCents: 5000, adminUid: 'eric',
  });
  const ana = team.find((p) => p.uid === 'ana');
  const eric = team.find((p) => p.uid === 'eric');
  // NEGATIVE CONTROL (run 2026-10-17): teamSummary's `if (late) p.late += 1;` taken out made this read
  //   FAIL  D4 Employer mode's summary counts each team member's reports past due and marks the client on their list
  check('D4 Employer mode\'s summary counts each team member\'s reports past due and marks the client on their list',
    ana?.late === 1 && ana.clients.find((c) => c.id === 'k1')?.late === true && ana.clients.find((c) => c.id === 'k2')?.late === false && eric?.late === 1,
    JSON.stringify({ ana: ana && { late: ana.late, clients: ana.clients }, eric: eric?.late }));
}

// ---- D5 ------------------------------------------------------------------------------------------------------------
{
  const W = f('worker/index.js');
  const fn = (W.match(/\nasync function sweepLateReports\(env\) \{[\s\S]*?\n\}/) || [''])[0];
  const docs = new Map([
    ['cases/late', { advocateId: 'ana', status: 'awaiting_report', clientName: 'Dana Reyes', createdAt: ago(20), reportDueAt: new Date(Date.now() - 2 * DAY).toISOString() }],
    ['cases/mine', { advocateId: 'eric-uid', status: 'awaiting_report', clientName: 'Sam Roe', createdAt: ago(20), reportDueAt: new Date(Date.now() - 2 * DAY).toISOString() }],
    ['cases/soon', { advocateId: 'ana', status: 'awaiting_report', clientName: 'Lee Park', createdAt: ago(5), reportDueAt: new Date(Date.now() + 5 * DAY).toISOString() }],
    ['advocates/ana', { name: 'Ana Rivera', active: true }],
  ]);
  const pings = [];
  const contractorOf = (c, env) => { const id = STAFF.advocateIdOf(c, env); return id && id !== env.ADMIN_UID ? id : null; };
  const run = new Function('queryDocs', 'patchDoc', 'getDoc', 'contractorOf', 'caseDay', 'pingAdmins', 'firstName', `${fn} return sweepLateReports;`)(
    async (env, coll, filters) => [...docs.entries()].filter(([k, v]) => k.startsWith('cases/') && filters.every(([fld, , val]) => v[fld] === val)).map(([k, v]) => ({ id: k.split('/')[1], data: JSON.parse(JSON.stringify(v)) })),
    async (env, p, d) => { docs.set(p, { ...docs.get(p), ...d }); return true; },
    async (env, p) => (docs.has(p) ? { data: docs.get(p) } : null),
    contractorOf, SD.caseDay, async (env, body, link) => { pings.push({ body, link }); },
    (v) => String(v || '').trim().split(/\s+/)[0] || 'A client');
  const first = await run({ ADMIN_UID: 'eric-uid' });
  const again = await run({ ADMIN_UID: 'eric-uid' });
  // NEGATIVE CONTROL (run 2026-10-17): the sweep's `c.lateToldAt ||` taken out made this read
  //   FAIL  D5 the sweep tells him once for each contractor's report past due, by name, never for his own or one not yet due
  check('D5 the sweep tells him once for each contractor\'s report past due, by name, never for his own or one not yet due',
    !!fn && first === 1 && again === 0 && pings.length === 1 && pings[0].body === "Ana's report for Dana is past due." && pings[0].link === '/admin-case.html?id=late'
    && !!docs.get('cases/late').lateToldAt && !docs.get('cases/mine').lateToldAt && !docs.get('cases/soon').lateToldAt
    && /ctx\.waitUntil\(sweepLateReports\(env\)\.catch\(/.test(W) && /import \{ caseDay \} from '\.\.\/public\/js\/service-day\.js';/.test(W),
    JSON.stringify({ first, again, pings }));
}

// ---- D6 ------------------------------------------------------------------------------------------------------------
{
  const CASE = f('public/js/case.js'); const ACASE = f('public/js/admin-case.js'); const ADMIN = f('public/js/admin.js');
  const CHATS = f('public/js/admin-chats.js'); const SUB = f('public/js/subscription.js'); const EMPL = f('public/js/admin-employer.js');
  const DEMO = f('public/js/demo/api.js');
  // NEGATIVE CONTROL (run 2026-10-17): admin.js's `${dayTag(c)}` taken out of the folder's line made this read
  //   FAIL  D6 the pages: the client's case and hours, his case page and shelf, both chat pages and Employer mode show the count, past due in red, and the demo counts the same
  check('D6 the pages: the client\'s case and hours, his case page and shelf, both chat pages and Employer mode show the count, past due in red, and the demo counts the same',
    /<p class="eyebrow">YOUR MONTH'S HOURS \$\{dayChip\(caseDay\(c\)\)\}<\/p>/.test(CASE) && /\$\{c\.fullAccess \? '' : dayChip\(caseDay\(c\)\)\}/.test(CASE)
    && /\.day-chip\.late \{ border-color: #FF6B6B;/.test(CASE)
    && /\$\{dayChipHtml\(caseDay\(c\)\)\}/.test(ACASE)
    && /flags: `<span class="folder-note">\$\{dayTag\(c\)\}\$\{detail\}/.test(ADMIN) && /if \(late\?\.late\) return `REPORT PAST DUE \$\{late\.over\}d`;/.test(ADMIN) && /dueSoon\(c\) \|\| caseDay\(c\)\?\.late \? 'due' : ''/.test(ADMIN)
    && /months: s\.status === 'active' \? chatMonths\(s\) : null,/.test(CHATS) && /data-chat-months/.test(SUB)
    && /\$\{!p\.owner && p\.late \? `<span class="tm-late" data-tm-late/.test(EMPL)
    && /const late = caseDay\(c\)\?\.late === true;/.test(DEMO) && /import \{ caseDay \} from '\.\.\/service-day\.js';/.test(DEMO));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
