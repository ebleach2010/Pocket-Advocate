// stats.mjs - By the numbers, driven against the REAL code.
//
// Eric, 2026-09-02: "a page of running granular stats from my performance
// with other clients like response time, # of messages, tasks completed
// within a certain time? Stats pause during a paused case due to my own
// neurological crashes (not to be explicitly mentioned)."
//
// Two things this pins that a grep never could: the ARITHMETIC (which gaps
// count, which do not, where the 7-day clock stops) and the PRIVACY (what a
// stranger's fetch can carry). publicStatsFrom is lifted out of
// worker/index.js and run over fixture cases with known answers; the served
// view is checked key by key; the walk and the hold handler are driven over
// the in-memory Firestore.
//
// Run: node stats.mjs
//
// ===========================================================================
// NEGATIVE CONTROLS - what was broken on purpose, and what went red
//
//   the break                                        what went red
//   ---------------------------------------------------------------------
//   the median takes gaps[0]                         A1
//   the overlapsHold test dropped                    A3, and A1 with it
//   the insideHold filter dropped                    A4, and A1, A3 with it
//   `held` no longer subtracted from the span        A5, A6
//   the open-pause branch of holdPeriodsOf dropped   A14
//   STATS_FLOOR to 1                                 B3
//   the route's cache-control to no-store            C1
//   the freshness gate's return deleted              C4
//   the periods line in the resume patch deleted     C7, C9
//   "Paused cases are left out." typed into the      D4
//     page copy
//   `import { db } from './firebase.js'` added to    D7
//     stats.js
//
// Every break restored by its unique context; 37/37 after each (2026-09-02).
// ===========================================================================
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync, existsSync } from 'node:fs';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const strip = (s) => s
  .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const code = (p) => strip(f(p));
const CODE = strip(SRC);

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

function fn(name) {
  const m = SRC.match(new RegExp(`\\nasync function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
function sfn(name) {
  const m = SRC.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
function konst(name) {
  const m = SRC.match(new RegExp(`\\nconst ${name} = [^;]+;`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0];
}
const LIFTED = [
  konst('STATS_DOC'), konst('STATS_PROMISE_MS'), konst('STATS_FLOOR'), konst('STATS_REFRESH_MS'),
  sfn('holdPeriodsOf'), konst('insideHold'), konst('overlapsHold'), sfn('heldWithin'),
  sfn('publicStatsFrom'), sfn('publicStatsView'), sfn('json'),
  fn('computePublicStats'), fn('handleStats'), fn('handleStatsRecompute'), fn('handleHold'),
].join('\n');

let docs, reads, writes, pushes, adminOk;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const rows = (coll) => [...docs.entries()]
  .filter(([p]) => p.startsWith(`${coll}/`) && p.slice(coll.length + 1).indexOf('/') < 0)
  .map(([p, d]) => ({ id: p.slice(coll.length + 1), data: clone(d) }));
const deps = {
  getDoc: async (env, path) => { reads.push(path); return docs.has(path) ? { data: clone(docs.get(path)), updateTime: '1' } : null; },
  patchDoc: async (env, path, patch, opts = {}) => {
    const cur = docs.get(path) || {};
    const next = { ...cur };
    for (const k of opts.mask || Object.keys(patch)) next[k] = clone(patch[k]);
    docs.set(path, next);
    writes.push({ path, patch: clone(patch), mask: opts.mask || null });
    return true;
  },
  listDocs: async (env, coll) => { reads.push(coll); return rows(coll); },
  requireAdmin: async () => (adminOk ? { uid: 'eric' } : null),
  notifyUser: async (env, uid, msg) => { pushes.push(msg); },
};
const build = new Function(...Object.keys(deps),
  `${LIFTED}
   return { holdPeriodsOf, heldWithin, publicStatsFrom, publicStatsView, computePublicStats,
            handleStats, handleStatsRecompute, handleHold, STATS_DOC, STATS_FLOOR, STATS_PROMISE_MS };`);
const W = build(...Object.values(deps));
const env = {};
const reset = () => { docs = new Map(); reads = []; writes = []; pushes = []; adminOk = true; };
const T = (s) => new Date(s).getTime();
const req = (body, url = 'https://example.com/api/stats') => ({
  json: async () => body, url, headers: { get: () => null },
});

// ---------------------------------------------------------------------------
// A. THE ARITHMETIC, on cases with known answers
// ---------------------------------------------------------------------------
console.log('\n--- A. the arithmetic ---');
const NOW = T('2026-09-01T12:00:00Z');
const cases = [
  { // on time, five days, no hold
    createdAt: '2026-07-10T00:00:00Z', appointment: { start: '2026-07-15T17:00:00Z' },
    reportDeliveredAt: '2026-07-20T17:00:00Z', work: { seconds: 10 * 3600 },
    milestones: [{ kind: 'appointment' }, { kind: 'referral' }], log: [{ kind: 'call' }, { kind: 'call' }, { kind: 'appeal' }],
  },
  { // eleven days on the wall, five of them paused: six days, on time
    createdAt: '2026-07-28T00:00:00Z', appointment: { start: '2026-08-01T17:00:00Z' },
    reportDeliveredAt: '2026-08-12T17:00:00Z', work: { seconds: 20 * 3600 + 1800 },
    hold: { pausedAt: null, totalMs: 5 * 86_400_000, periods: [{ from: '2026-08-03T00:00:00Z', to: '2026-08-08T00:00:00Z' }] },
    milestones: [{ kind: 'authorization' }, { kind: 'custom-thing' }], log: [{ kind: 'investigation' }, { kind: 'email' }],
  },
  { // ten days, no hold: late
    createdAt: '2026-08-05T00:00:00Z', appointment: { start: '2026-08-10T17:00:00Z' },
    reportDeliveredAt: '2026-08-20T17:00:00Z', work: { seconds: 5 * 3600 },
  },
  { // no report yet: not counted
    createdAt: '2026-08-25T00:00:00Z', appointment: { start: '2026-08-30T17:00:00Z' }, work: { seconds: 0 },
  },
];
const holdB = [[T('2026-08-03T00:00:00Z'), T('2026-08-08T00:00:00Z')]];
const threads = [
  { holdPeriods: [], rows: [
    { role: 'client', ts: '2026-07-16T10:00:00Z' }, { role: 'admin', ts: '2026-07-16T10:03:00Z' },   // 3 min
    { role: 'client', ts: '2026-07-16T11:00:00Z' }, { role: 'client', ts: '2026-07-16T11:05:00Z' },  // one question
    { role: 'admin', ts: '2026-07-16T12:30:00Z' }, { role: 'admin', ts: '2026-07-16T12:31:00Z' },    // 90 min, then nothing
  ] },
  { holdPeriods: holdB, rows: [
    { role: 'client', ts: '2026-08-02T10:00:00Z' }, { role: 'admin', ts: '2026-08-02T10:10:00Z' },   // 10 min
    { role: 'client', ts: '2026-08-02T20:00:00Z' },                                                  // asked before the hold
    { role: 'client', ts: '2026-08-04T09:00:00Z' },                                                  // inside the hold: not a message
    { role: 'admin', ts: '2026-08-09T09:00:00Z' },                                                   // answered after it: gap dropped
  ] },
  { holdPeriods: [], rows: [
    { role: 'client', ts: '2026-08-15T10:00:00Z' }, { role: 'admin', ts: '2026-08-15T10:30:00Z' },   // 30 min
    { role: 'system', ts: '2026-08-15T10:31:00Z' },                                                  // not a message
  ] },
];
const D = W.publicStatsFrom({ cases, threads, now: NOW });
// NEGATIVE CONTROL (run 2026-09-02): the median taking gaps[0] made this read
//   FAIL  A1 the reply median and the within-an-hour share come off the right four gaps
check('A1 the reply median and the within-an-hour share come off the right four gaps',
  D.replies === 4 && D.replyMedianMin === 20 && D.withinHourPct === 75, JSON.stringify([D.replies, D.replyMedianMin, D.withinHourPct]));
check('A2 a run of client messages is one question, answered once',
  D.replies === 4);
// NEGATIVE CONTROL (run 2026-09-02): dropping the overlapsHold test made this read
//   FAIL  A3 a gap that overlaps a hold window is dropped
check('A3 a gap that overlaps a hold window is dropped',
  W.publicStatsFrom({ cases, threads: [threads[1]], now: NOW }).replies === 1);
// NEGATIVE CONTROL (run 2026-09-02): dropping the insideHold filter made this read
//   FAIL  A4 a message inside a hold window is not counted
check('A4 a message inside a hold window is not counted',
  D.messages === 12, String(D.messages));
// NEGATIVE CONTROL (run 2026-09-02): `done - start - held` to `done - start` made this read
//   FAIL  A5 reports: on time, on time because the hold stopped the clock, late; the undelivered one not counted
check('A5 reports: on time, on time because the hold stopped the clock, late; the undelivered one not counted',
  D.reportsTotal === 3 && D.reportsOnTime === 2, JSON.stringify([D.reportsOnTime, D.reportsTotal]));
{
  const old = { ...cases[1], hold: { totalMs: 5 * 86_400_000 } };
  const d = W.publicStatsFrom({ cases: [old], threads: [], now: NOW });
  check('A6 an older hold that recorded only its sum is credited in full', d.reportsOnTime === 1 && d.reportsTotal === 1);
  const over = { ...cases[2], hold: { totalMs: 400 * 86_400_000 } };
  const d2 = W.publicStatsFrom({ cases: [over], threads: [], now: NOW });
  check('A7 and never past the span itself', d2.reportsOnTime === 1 && W.heldWithin(0, 10, [[-5, 50]]) === 10);
}
check('A8 hours logged is the rounded total of every case clock',
  D.hoursLogged === 36, String(D.hoursLogged));
check('A9 milestones by kind, a custom kind counted as other',
  JSON.stringify(D.milestones) === JSON.stringify({ appointment: 1, referral: 1, authorization: 1, other: 1, total: 4 }));
check('A10 the work log by kind, his own kinds counted as other',
  JSON.stringify(D.logged) === JSON.stringify({ call: 2, appeal: 1, investigation: 1, appointment: 0, other: 1, total: 5 }));
check('A11 "since" is the month of the earliest case, in MST', D.since === 'July 2026' && D.cases === 4);
check('A12 every figure is already rounded',
  Number.isInteger(D.replyMedianMin) && Number.isInteger(D.withinHourPct) && Number.isInteger(D.hoursLogged));
check('A13 nothing to measure yields nulls, not zeros pretending to be answers',
  (() => { const e = W.publicStatsFrom({ cases: [], threads: [], now: NOW }); return e.replyMedianMin === null && e.withinHourPct === null && e.since === '' && e.cases === 0; })());
{
  const open = { hold: { pausedAt: '2026-08-30T00:00:00Z', periods: [{ from: '2026-08-01T00:00:00Z', to: '2026-08-02T00:00:00Z' }] } };
  const p = W.holdPeriodsOf(open, NOW);
  // NEGATIVE CONTROL (run 2026-09-02): dropping the pausedAt branch made this read
  //   FAIL  A14 an open pause is a window running to now
  check('A14 an open pause is a window running to now',
    p.length === 2 && p[1][0] === T('2026-08-30T00:00:00Z') && p[1][1] === NOW);
}

// ---------------------------------------------------------------------------
// B. WHAT A STRANGER MAY READ
// ---------------------------------------------------------------------------
console.log('\n--- B. the view ---');
{
  const v = W.publicStatsView(D);
  const keys = Object.keys(v).sort().join(',');
  check('B1 the served view carries totals, medians, the count and the stamp, and nothing else',
    keys === 'cases,computedAt,floor,hoursLogged,logged,messages,milestones,replies,replyMedianMin,reportsOnTime,reportsTotal,since,withinHourPct', keys);
  check('B2 no per-case field: no names, no dates, no arrays of cases',
    !/clientName|clientEmail|clientUid|clientTz|"appointment":\{|createdAt|reportDeliveredAt/i.test(JSON.stringify(v))
    && !Array.isArray(v.cases) && !('threads' in v));
  const two = W.publicStatsView({ ...D, cases: 2 });
  // NEGATIVE CONTROL (run 2026-09-02): STATS_FLOOR to 1 made this read
  //   FAIL  B3 below three cases the ledger is withheld and the reply figures stay
  check('B3 below three cases the ledger is withheld and the reply figures stay',
    W.STATS_FLOOR === 3 && two.floor === true && !('messages' in two) && !('hoursLogged' in two)
    && !('milestones' in two) && two.replyMedianMin === 20 && two.cases === 2);
  check('B4 at three the ledger shows', W.publicStatsView({ ...D, cases: 3 }).floor === false);
}

// ---------------------------------------------------------------------------
// C. THE ROUTE, THE WALK, THE HOLD
// ---------------------------------------------------------------------------
console.log('\n--- C. the route, the walk, the hold ---');
reset();
docs.set(W.STATS_DOC, D);
{
  const cells = new Map();
  globalThis.caches = { default: {
    match: async (k) => (cells.has(k.url) ? new Response(cells.get(k.url), { headers: { 'content-type': 'application/json' } }) : undefined),
    put: async (k, res) => { cells.set(k.url, await res.text()); },
    delete: async (k) => cells.delete(k.url),
  } };
  const r1 = await W.handleStats(req(null), env);
  const b1 = await r1.json();
  const readsAfterFirst = reads.length;
  const r2 = await W.handleStats(req(null), env);
  const b2 = await r2.json();
  // NEGATIVE CONTROL (run 2026-09-02): the cache-control dropped to `no-store` made this read
  //   FAIL  C1 the route is public, answers the view, and says it may be cached for an hour
  check('C1 the route is public, answers the view, and says it may be cached for an hour',
    r1.status === 200 && b1.replyMedianMin === 20 && b1.floor === false
    && r1.headers.get('cache-control') === 'public, max-age=3600'
    && !/requireUser|requireAdmin/.test(fn('handleStats')));
  check('C2 the second fetch inside the hour comes off the edge cache without a read',
    b2.replyMedianMin === 20 && reads.length === readsAfterFirst);
  adminOk = false;
  const stranger = await W.handleStatsRecompute(req({}), env);
  check('C3 the recompute is admin only, 404 to a stranger', stranger.status === 404);
  delete globalThis.caches;
}
reset();
docs.set(W.STATS_DOC, { computedAt: new Date(NOW - 3600_000).toISOString(), cases: 9 });
{
  const realNow = Date.now;
  Date.now = () => NOW;
  const r = await W.computePublicStats(env);
  Date.now = realNow;
  // NEGATIVE CONTROL (run 2026-09-02): the gate's `return null` deleted made this read
  //   FAIL  C4 a stamp fresher than a day means one read and no walk
  check('C4 a stamp fresher than a day means one read and no walk', r === null && reads.length === 1 && writes.length === 0);
}
reset();
docs.set('cases/A', { createdAt: '2026-07-10T00:00:00Z', appointment: { start: '2026-07-15T17:00:00Z' }, reportDeliveredAt: '2026-07-20T17:00:00Z', work: { seconds: 7200 }, clientName: 'Riley', clientEmail: 'r@example.com' });
docs.set('cases/A/chat/1', { role: 'client', ts: '2026-07-16T10:00:00Z', text: 'hi' });
docs.set('cases/A/chat/2', { role: 'admin', ts: '2026-07-16T10:04:00Z', text: 'hello' });
docs.set('cases/A/private/milestones/items/m1', { kind: 'referral', what: 'x' });
docs.set('cases/A/private/clinicCalls/items/c1', { kind: 'call', what: 'y' });
docs.set('subscriptions/S', { startedAt: '2026-07-01T00:00:00Z' });
docs.set('subscriptions/S/chat/1', { role: 'client', ts: '2026-07-02T10:00:00Z', text: 'q' });
docs.set('subscriptions/S/chat/2', { role: 'admin', ts: '2026-07-02T10:20:00Z', text: 'a' });
{
  const realNow = Date.now;
  Date.now = () => NOW;
  const r = await W.computePublicStats(env, { force: true });
  Date.now = realNow;
  const stored = docs.get(W.STATS_DOC);
  check('C5 the walk reads every case, its chat, milestones and log, every subscription and its chat, and writes stats/public',
    !!r && stored && stored.cases === 1 && stored.replies === 2 && stored.replyMedianMin === 12 && stored.messages === 4
    && stored.reportsOnTime === 1 && stored.milestones.referral === 1 && stored.logged.call === 1 && stored.hoursLogged === 2,
    JSON.stringify(stored));
  check('C6 what is stored carries no name, email or case id',
    !/Riley|r@example\.com|cases\/A/.test(JSON.stringify(stored)));
}
reset();
docs.set('cases/H', { clientUid: 'u1', status: 'awaiting_report', hold: { pausedAt: null, totalMs: 0, periods: [] } });
{
  const on = await W.handleHold(req({ caseId: 'H', on: true }), env);
  await on.json();
  docs.set('cases/H', { ...docs.get('cases/H'), hold: { ...docs.get('cases/H').hold, pausedAt: new Date(NOW - 2 * 86_400_000).toISOString() } });
  const realNow = Date.now;
  Date.now = () => NOW;
  const off = await W.handleHold(req({ caseId: 'H', on: false }), env);
  Date.now = realNow;
  const out = await off.json();
  const h = docs.get('cases/H').hold;
  // NEGATIVE CONTROL (run 2026-09-02): the periods line in the resume patch deleted made this read
  //   FAIL  C7 resuming a paused case records the window it was paused for
  check('C7 resuming a paused case records the window it was paused for',
    off.status === 200 && out.paused === false && Array.isArray(h.periods) && h.periods.length === 1
    && T(h.periods[0].from) === NOW - 2 * 86_400_000
    && Math.abs(T(h.periods[0].to) - Date.now()) < 60_000, JSON.stringify(h));
  check('C8 and the sum the rest of the app reads still moves with it', h.totalMs === 2 * 86_400_000);
  const again = await W.handleHold(req({ caseId: 'H', on: true }), env);
  await again.json();
  check('C9 pausing again carries the earlier windows through', docs.get('cases/H').hold.periods.length === 1);
}

// ---------------------------------------------------------------------------
// D. THE PAGE, THE STRIP, THE WORDS
// ---------------------------------------------------------------------------
console.log('\n--- D. the page and the words ---');
const HARD = [/advisor/i, /differential/i, /\bAI\b/, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bthe model\b/i, /\ba model\b/i];
// The rule about paused cases lives in the Worker and nowhere a client reads.
const QUIET = [/paus/i, /\bhold\b/i, /crash/i, /health of/i, /neurolog/i, /unavailab/i, /out of office/i];
{
  const page = f('public/stats.html');
  const js = f('public/js/stats.js');
  const idx = f('public/index.html');
  const strip = idx.slice(idx.indexOf('id="numbers"'), idx.indexOf('The whole ledger') + 40);
  const fresh = [page, js, strip];
  check('D1 the page carries the four tiles, the ledger, the floor line and loads stats.js',
    ['replyMedian', 'withinHour', 'reports', 'hours', 'messages', 'milestones', 'logged', 'cases', 'stamp']
      .every((k) => page.includes(`data-stat="${k}"`))
    && /data-ledger/.test(page) && /data-stat-floor/.test(page) && /src="\/js\/stats\.js"/.test(page));
  check('D2 the landing strip is hidden until there are figures, and every tile opens the ledger',
    /id="numbers" data-numbers-strip hidden/.test(strip)
    && (strip.match(/<a class="tile" href="\/stats\.html">/g) || []).length === 4
    && /data-numbers-strip/.test(code('public/js/stats.js')) && /import\('\/js\/stats\.js'\)/.test(idx));
  check('D3 the footer on both pages lists By the numbers',
    /<a href="\/stats\.html">By the numbers<\/a>/.test(idx) && /<a href="\/stats\.html">By the numbers<\/a>/.test(page));
  // NEGATIVE CONTROL (run 2026-09-02): "paused cases are left out" typed into stats.html made this read
  //   FAIL  D4 the pause rule appears in code and never in anything a client reads
  check('D4 the pause rule appears in code and never in anything a client reads',
    /insideHold|overlapsHold/.test(sfn('publicStatsFrom'))
    && fresh.every((s) => QUIET.every((re) => !re.test(s))));
  check('D5 not one term from the blindness list, and not one dash', fresh.every((s) => HARD.every((re) => !re.test(s)) && !/[–—]/.test(s)));
  check('D6 the page copy is the approved mock\'s, word for word',
    page.includes('How I actually work, measured.')
    && page.includes('Not promises. Reply times, hours, and reports delivered on time, measured across every case and updated daily.')
    && page.includes('Reply time is the gap between a client\'s message and my answer, across every message on every case. Reports count as on time when they land inside the 7 days promised at booking.')
    && page.includes('Nothing here is per client. Every figure is a total or a median across all cases, so no one can be picked out of it.'));
  // NEGATIVE CONTROL (run 2026-09-02): an `import { db } from './firebase.js'` added to stats.js made this read
  //   FAIL  D7 stats.js reads one public route and never a case document
  check('D7 stats.js reads one public route and never a case document',
    /fetch\('\/api\/stats'\)/.test(code('public/js/stats.js'))
    && !/cases\/|getDoc|collection\(|\bdb\b|subscriptions\//.test(code('public/js/stats.js')));
  check('D8 the routes are registered, the cron calls the walk, the audit crawls /stats, the demo answers',
    /url\.pathname === '\/api\/stats' && request\.method === 'GET'\)\s*return await handleStats/.test(CODE)
    && /url\.pathname === '\/api\/admin\/stats' && request\.method === 'POST'\)\s*return await handleStatsRecompute/.test(CODE)
    && /ctx\.waitUntil\(computePublicStats\(env\)\)/.test(CODE)
    && /'\/stats'/.test((code('tools/blindness-audit.mjs').match(/const CLIENT_PAGES = \[([\s\S]*?)\];/) || [])[1] || '')
    && /path === '\/api\/stats'/.test(code('public/js/demo/api.js')));
  // Pin updated 2026-09-03 on the landing branch: Look A moved every page to
  // sp7, so the pin asks for "at least sp6" rather than sp6 exactly.
  check('D9 the CSS the page needs ships with a bumped stylesheet version on the two pages that use it',
    /\.numbers \.tile/.test(f('public/css/glowup.css')) && /glowup\.css\?v=sp([6-9]|\d{2})/.test(idx) && /glowup\.css\?v=sp([6-9]|\d{2})/.test(page)
    && existsSync(__j(__REPO, 'public/stats.html')));
  const region = SRC.slice(SRC.indexOf('BY THE NUMBERS (Eric'), SRC.indexOf('async function handleStatsRecompute'));
  check('D10 nothing new in the Worker is dashed either', !/[–—]/.test(region + fn('handleStatsRecompute')));
}

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
