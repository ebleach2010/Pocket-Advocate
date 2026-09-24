// trade.mjs - the trade desk, as a case file.
//
//   node tools/suites/trade.mjs
//
// Eric, 2026-09-22: "Make it a case file highlighted green. run it
// automatically at 7am, 10am, noon on trading days. Just like with medical
// cases I can pause it or manually update. I can also ask the advisor
// questions and send him screenshots of my positions and portfolio total
// ... There's also a chat where I can essentially track each trade and the
// logic. The advisor scans this and presents any validation and correction
// of my technique ... Terms are a thing here as well."
//
// The whole of worker/trade-desk.js and worker/trade.js is evaluated here
// with the imports replaced by fakes, so everything RUNS: the calendar on
// real instants either side of a clock change, the slot claim against a
// database that says no, the harvest on a real reading, the records, the
// verdict, the routes with their exact sentences. The advisor's seams are
// lifted and run (the policy, the request builder, the knowledge filter)
// or pinned where they cannot be run alone. The shelf, the page, the panel,
// the demo, the lists and the version are pinned.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const has = (p) => existsSync(j(ROOT, p));
const TD = f('worker/trade-desk.js');
const T = f('worker/trade.js');
const W = f('worker/index.js');
const ADV = f('worker/advisor.js');
const SHOW = f('worker/showcase.js');
const DESK = f('public/js/admin-desk.js');
const PANEL = f('public/js/advisor.js');
const CASE = f('public/js/admin-case.js');
const ADMIN = f('public/js/admin.js');
const DRAWER = f('public/js/drawer.js');
const D = f('public/js/demo/api.js');
const SEED = f('public/js/demo/seed.js');
const STORE = f('public/js/demo/store.js');
const CL = f('public/js/changelog.js');
const AUTH = f('public/js/auth.js');
const AUDIT = f('tools/blindness-audit.mjs');
const NOSIDE = f('tools/drives/drive-nosideways.mjs');
const CSS = f('public/css/admin.css');
const DRIVE = f('tools/drives/drive-trade.mjs');
const math = await import('../../public/js/trade-math.js');
// The PDF writer (2026-09-22): the real one, imported, so a filed document in a world is real bytes.
const pdf = await import('../../public/js/textpdf.js');

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
const grab = (src, re) => (src.match(re) || [''])[0];
const DASH = /[—–]/;
const strip = (src) => src.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export /gm, '');

// ---- the two modules, evaluated with their imports replaced ---------------------
// RE-PINNED 2026-09-23 (PR 420): the two modules used to be one concatenated body, which only
// worked while no top-level name appeared in both. PR 420's trade.js keeps its own TICKER_RE,
// so each module is evaluated on its own now, trade.js handed what trade-desk.js exports the way
// an import would. The export names are read off the source, so a list here can never drift
// from the modules; the engine's four names come from desk-run.js itself, with requestRun a
// recorder so a route that queues a run can be held to what it asked for.
const DR = await import('../../worker/desk-run.js');
const importNames = (src) => [...src.matchAll(/^import \{([\s\S]*?)\} from '[^']+';$/gm)]
  .flatMap((m) => m[1].split(',').map((x) => x.trim()).filter(Boolean).map((x) => x.split(/\s+as\s+/).pop()));
const exportNames = (src) => [...src.matchAll(/^export (?:async )?(?:function|const|class|let) (\w+)/gm)].map((m) => m[1]);
const TD_IMPORTS = importNames(TD);
const T_IMPORTS = importNames(T);
const EXPORTS = exportNames(TD);
const T_EXPORTS = exportNames(T);
const READ_FAILED = Symbol('read failed');
const BODY_TD = strip(TD);
const BODY_T = strip(T);

/** A world: recorders for every write, fixtures for every read, a fake market. */
function world(over = {}) {
  const w = {
    docs: new Map(), patches: [], deletes: [], pushes: [], diag: [], pending: [], runs: [], fetches: [], puts: [], metas: [],
    claim: true, listed: {}, reads: 0, fetchStatus: 200, putFails: false, ...over,
  };
  const deps = {
    patchDoc: async (env, path, data, opts) => {
      w.patches.push({ path, data, opts });
      if (opts?.ifUpdateTime || opts?.mustNotExist) return w.claim;
      return true;
    },
    deleteDoc: async (env, path) => { w.deletes.push(path); return true; },
    listDocs: async (env, coll) => w.listed[coll] || [],
    tryGet: async (env, path) => { w.reads += 1; const v = w.docs.get(path); return v === undefined ? null : v; },
    // One read for many (2026-09-23): counted as one call, as the Worker's is. A READ_FAILED doc reads as missing.
    batchGetDocs: async (env, paths) => { w.reads += 1; w.batchGets = (w.batchGets || 0) + 1; return paths.map((p) => { const v = w.docs.get(p); return v === undefined || v === READ_FAILED ? null : v; }); },
    READ_FAILED,
    readFailedError: (m) => new Error(m),
    notifyUser: async (env, uid, n) => { w.pushes.push({ uid, ...n }); },
    markPending: async (env, kind, id) => { w.pending.push({ kind, id }); },
    diagLog: async (env, e) => { w.diag.push(e); },
    // PR 420's engine: the route queues through requestRun and nothing else.
    requestRun: async (env, { trigger, now }) => {
      w.runs.push({ trigger, now });
      return over.runOut || { ok: true, already: false, run: { id: 'run-1', status: 'queued', trigger, queuedAt: new Date(now), done: 0 } };
    },
    runAlive: DR.runAlive, riskPctOf: DR.riskPctOf, RESEARCH_PATH: DR.RESEARCH_PATH, LENSES: DR.LENSES,
    isTradingDay: math.isTradingDay, tradeMetrics: math.tradeMetrics, chartSeries: math.chartSeries, planFor: math.planFor, positionKey: math.positionKey, scalePosition: math.scalePosition,
    TARGET_DAILY: math.TARGET_DAILY, PROJECTION_MIN_DAYS: math.PROJECTION_MIN_DAYS, DEFAULT_START_CENTS: math.DEFAULT_START_CENTS,
    MARKET_OPEN_MIN: math.MARKET_OPEN_MIN,
    fetch: async (url) => {
      w.fetches.push(String(url));
      const u = String(url);
      const body = /\/quote\?/.test(u) ? { c: 100.5, d: 1, dp: 1.01, h: 101, l: 99, o: 99.5, pc: 99.5, t: 1758470000 }
        : /\/news\?/.test(u) ? [{ headline: 'Chips lead the open', source: 'Demo', datetime: Math.floor(Date.now() / 1000) - 600 }]
          : /\/calendar\/earnings/.test(u) ? { earningsCalendar: [{ symbol: 'ORCL', hour: 'amc' }] } : {};
      return { ok: w.fetchStatus === 200, status: w.fetchStatus, json: async () => body };
    },
    crypto: { randomUUID: () => 'uuid-new-desk' },
    // The storage half the filed document needs (2026-09-22): a recorder that hands back what putFile does.
    putFile: async (env, path, bytes, contentType) => {
      if (w.putFails) throw new Error('put failed');
      w.puts.push({ path, bytes, contentType });
      return { name: path.split('/').pop().replace(/^\d{10,}-/, ''), path, size: bytes.byteLength, contentType, at: new Date().toISOString() };
    },
    patchObjectMeta: async (env, path, custom) => { w.metas.push({ path, custom }); return { path, custom }; },
    BUCKET: 'bucket.appspot.com',
    textPdf: pdf.textPdf,
    rulesOf: math.rulesOf, RULE_RANGES: math.RULE_RANGES, defaultRules: math.defaultRules,
    dayStatus: math.dayStatus, realizedToday: math.realizedToday, openRisk: math.openRisk,
    tradeCalc: math.tradeCalc, closePnl: math.closePnl, fmtMoney: math.fmtMoney, fmtPct: math.fmtPct,
    HORIZONS: math.HORIZONS, HORIZON_WORDS: math.HORIZON_WORDS, horizonOf: math.horizonOf, horizonFor: math.horizonFor,
    swingLastDay: math.swingLastDay, isMarketOpen: math.isMarketOpen, INSTRUMENTS: math.INSTRUMENTS,
    ...(over.deps || {}),
  };
  const td = new Function('deps', `const { ${[...TD_IMPORTS, 'fetch', 'crypto'].join(', ')} } = deps;\n${BODY_TD}\nreturn { ${EXPORTS.join(', ')} };`)(deps);
  const tDeps = { ...deps, ...td, ...(over.deps || {}) };
  const t = new Function('deps', `const { ${[...T_IMPORTS, 'fetch', 'crypto'].join(', ')} } = deps;\n${BODY_T}\nreturn { ${T_EXPORTS.join(', ')} };`)(tDeps);
  return { w, api: { ...td, ...t } };
}
const { api: K } = world();
const env = { ADMIN_UID: 'eric', ANTHROPIC_API_KEY: 'k' };
const at = (iso) => new Date(iso).getTime();
const FIX = [{ date: '2026-09-01', cents: 205000 }, { date: '2026-09-04', cents: 212000 }, { date: '2026-09-10', cents: 208000 }, { date: '2026-09-16', cents: 220000 }, { date: '2026-09-21', cents: 238000 }];
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const PLAY = {
  ticker: 'nvda', side: 'long', instrument: 'spread', structure: 'Oct 17 650/655 call debit spread', entry: 2.1, stop: 1.3, targets: [3.4], holdMinutes: 180,
  // The vehicle in fields (2026-09-22): the strikes, which way round, and when it expires.
  strike: 650, strike2: 655, optionType: 'call', expiry: '2026-10-17', allocPct: 17.6,
  profitLow: 56, profitHigh: 64, sizeDollars: 420, catalyst: 'Guidance raised.', overnightOk: false, overnightWhy: 'Intraday.',
  picture: 'Holding above the opening range — volume is real.', bull: 'Through 652 opens 655.', bear: 'Below 648 ends it.', levels: ['648', '650', '652', '655'], risk: 'Break of 648.', watch: 'The 10:30 bar.',
};
const READING = `## Right now
Chips lead. Volume is above average.

## Your trades
NVDA long (m001): good trade.

## Where you are slipping
- none yet

## Rules to hold
- Every options entry gets a stop (m003).

## Setups
### NVDA long
Current picture: holding above the opening range.
Chance of profit: 56 to 64%.

## Questions for you
- none

## Key terms
- none

## Working line
Sound entries, stops go missing

## Plays
\`\`\`json
${JSON.stringify({ plays: [PLAY, { ...PLAY, ticker: 'TSLA', side: 'short', instrument: 'stock', profitLow: 45, profitHigh: 55, catalyst: '' }], portfolio: { totalCents: 241000, asOf: '2026-09-22' } })}
\`\`\`

## Not answered
- none

## Corrections
- none
`;

// ---- T1 to T7: the constants, the calendar, and the two runs he starts ----------
// RE-PINNED 2026-09-22 (nothing on the desk runs but his tap): the desk ran three times a trading
// day on a smaller model one step below the top, which is what T1 used to pin. Nothing is a
// background turn any more, so both of his buttons buy the same model and effort every other case
// gets, and the three slots, their window and the whole calendar of them are gone from the module.
// NEGATIVE CONTROL (run 2026-09-22): `TRADE_EFFORT = 'max'` changed back to 'high' made this read
//   FAIL  T1 the desk runs on the same model and effort as every other case for every turn, 55 as the strong line, eight trading categories, one web search tool of eight uses, and 2000 as the default start
// RE-PINNED 2026-09-22 (v6.12): one carve-out by his choice. Scan runs at high; Update, a question
// and every other case keep max. The constant this check used to forbid is now the one it requires.
// NEGATIVE CONTROL (run 2026-09-22, v6.12): `TRADE_SCAN_EFFORT = 'high'` changed to 'max' made this read
//   FAIL  T1 the desk runs on the same model and effort as every other case for every turn ...
// RE-PINNED 2026-09-23 (PR 420): the Scan's and the Look's strengths went with the two buttons, and the
// desk is called PR 420. The reading's constants stay because the reading's code in the advisor is still
// there, unreachable from any page; the six-agent desk's own model and efforts are pinned in desk.mjs.
// NEGATIVE CONTROL (run 2026-09-23): DESK_NAME put back to 'Trade desk' made this read
//   FAIL  T1 the desk's constants: ...
check('T1 the desk\'s constants: the reading keeps its model and effort, 55 as the strong line, eight trading categories, one web search tool of eight uses, 2000 as the default start, the name PR 420, and no Scan or Look strength left',
  K.TRADE_MODEL === 'claude-opus-5' && K.TRADE_EFFORT === 'max' && K.TRADE_TZ === 'America/Boise'
  && K.STRONG_PROFIT_LOW === 55 && K.DESK_NAME === 'PR 420' && K.TRADE_CATEGORIES.join() === 'Setup,Indicator,Level,Order,Risk,Options,Market,Instrument'
  && K.TRADE_WEB_SEARCH_TOOL.type === 'web_search_20260209' && K.TRADE_WEB_SEARCH_TOOL.max_uses === 8
  // RE-PINNED 2026-09-22 (v5.2): his aim is a rule (2% by default), and the module's constant reads it.
  && math.TARGET_DAILY === 0.02 && math.defaultRules().dayAimPct === 2 && math.PROJECTION_MIN_DAYS === 14 && math.TRADING_DAYS_PER_YEAR === 252 && math.DEFAULT_START_CENTS === 200000
  && /^export const TRADE_EFFORT = 'max';$/m.test(TD) && K.TRADE_SCAN_EFFORT === undefined && K.TRADE_LOOK_EFFORT === undefined
  && !/TRADE_SCAN_EFFORT|TRADE_LOOK_EFFORT|TRADE_ASK_EFFORT|TRADE_FALLBACK_MODEL/.test(TD + T + ADV));

// T2 USED TO PIN THE SLOT CLOCK (07:00 Mountain is 13:00Z in July, 14:00Z in January). Eric,
// 2026-09-22: "I manually update either scan individually. No automatic." There is no clock to pin,
// so what stands in its place is that every name it was built from is gone from the module and
// nothing books a desk turn but a route he taps.
// NEGATIVE CONTROL (run 2026-09-22): `export const SCAN_SLOTS = ['07:00'];` added back to trade.js made this read
//   FAIL  T2 the clock is gone: not one of the slot names is left in the module, the settings take no Pause, and neither read offers a next slot
check('T2 the clock is gone: not one of the slot names is left in the module, the settings take no Pause, and neither read offers a next slot',
  !/SCAN_SLOTS|EARLY_CLOSE_SLOTS|SCAN_WINDOW_MIN|slotsFor|slotKeyFor|nextSlotAfter|scanDue|maybeTradeScan|lastSlot/.test(T)
  && !/scansOn/.test(T) && !/nextSlot/.test(T)
  && typeof K.slotKeyFor === 'undefined' && typeof K.maybeTradeScan === 'undefined'
  // The market calendar itself stays: the desk still says whether the market is open today.
  && /tradingDay: isTradingDay\(dateKey\)/.test(T));

// RE-PINNED 2026-09-23 (PR 420): the scan route is gone. RUN TRADING DESK is the one button, and its
// route does one thing: it asks the engine to queue a run and answers at once. It never starts a turn
// and never touches the reading's queue; a run already going is answered, never refused and never doubled.
// NEGATIVE CONTROL (run 2026-09-23): tradeRun's `already: !!out.already` answered as `already: false` made this read
//   FAIL  T3 RUN TRADING DESK RUNS: ...
// PINNED 2026-09-23 (review): a tap that lost the queue write while no run was going came back as
// `already: false` with the old run, so the page painted a finished run as if it had just queued.
// NEGATIVE CONTROL (run 2026-09-23): tradeRun without its `out.ok === false` 409 made this read
//   FAIL  T3 RUN TRADING DESK RUNS: ...
{
  const runRun = async (over = {}, sub = 'run') => {
    const { w, api } = world(over);
    if (over.settings !== null) w.docs.set('trade/settings', { data: over.settings || { caseId: 'c1' }, updateTime: 'S1' });
    let err = null;
    let out = null;
    try { out = await api.tradeRoute(env, { sub, method: 'POST', body: {}, now: at('2026-09-21T16:05:00Z') }); } catch (e) { err = e; }
    return { w, out, err };
  };
  const ok1 = await runRun();
  const noDesk = await runRun({ settings: {} });
  const busy = await runRun({ runOut: { ok: true, already: true, run: { id: 'run-0', status: 'researching', startedAt: new Date(), done: 2 } } });
  // A tap that lost the write to another writer with no run going is told to tap again, never told it queued.
  const lost = await runRun({ runOut: { ok: false, busy: true, run: { id: 'run-0', status: 'done' } } });
  const scan = await runRun({}, 'scan');
  const look = await runRun({}, 'look');
  check('T3 RUN TRADING DESK RUNS: no desk is a 404, a tap queues one manual run and answers with where it is, a tap while one is going is answered with that run and never refused, a tap that lost the write is a 409 that says tap again, the old Scan and Look are plain 404s, and the route never touches the reading\'s queue',
    ok1.out?.ok === true && ok1.out.already === false && ok1.out.run.status === 'queued' && ok1.out.run.of === 5
    && ok1.w.runs.length === 1 && ok1.w.runs[0].trigger === 'manual' && ok1.w.pending.length === 0
    && noDesk.err?.status === 404 && noDesk.err.message === K.SAY.noDesk && noDesk.w.runs.length === 0
    && busy.err === null && busy.out.already === true && busy.out.run.status === 'researching' && busy.out.run.done === 2
    && lost.err?.status === 409 && lost.err.message === K.SAY.busy && lost.out === null
    && scan.err?.status === 404 && look.err?.status === 404 && scan.w.runs.length === 0,
    JSON.stringify({ ok: ok1.out, noDesk: noDesk.err?.message, busy: busy.out }));
}

// NEGATIVE CONTROL (run 2026-09-22): '2026-09-07' removed from NYSE_HOLIDAYS made this read
//   FAIL  T4 a weekend and a holiday are not trading days, a Monday is, and the day after Thanksgiving closes early
check('T4 a weekend and a holiday are not trading days, a Monday is, and the day after Thanksgiving closes early',
  math.isTradingDay('2026-09-19') === false && math.isTradingDay('2026-09-20') === false
  && math.isTradingDay('2026-09-07') === false && math.isTradingDay('2026-09-21') === 'full'
  && math.isTradingDay('2026-11-27') === 'early' && math.isTradingDay('2027-07-05') === false && math.isTradingDay('nope') === false);

// T5 USED TO PIN WHICH SLOTS AN EARLY-CLOSE DAY GOT, and then the scan's own contract.
// RE-PINNED 2026-09-23 (PR 420): both of the scan's contracts are gone. The only thing that suggests a
// trade now is the six-agent desk, which writes its own prompts in desk-run.js (pinned in desk.mjs), so
// what stands here is that no contract for a Scan or a Look is left anywhere to be sent.
// NEGATIVE CONTROL (run 2026-09-23): `export const SCAN_CONTRACT = '';` added back to trade-desk.js made this read
//   FAIL  T5 the Scan's and the Look's contracts are gone ...
check('T5 the Scan\'s and the Look\'s contracts are gone from the Worker and the advisor, and the desk\'s own two prompts say no question ever goes to him',
  K.SCAN_CONTRACT === undefined && K.LOOK_CONTRACT === undefined
  && !/SCAN_CONTRACT|LOOK_CONTRACT/.test(TD + T + ADV + W)
  && /will not read research, ask follow-up questions or approve anything/.test(DR.deskSystem('cash', 3))
  && /You never ask a question and never address Eric\./.test(DR.researchSystem('cash')));

// T6 USED TO PIN WHETHER A READING WAS OWED AT A SLOT, and then what scanBlock read for the button.
// RE-PINNED 2026-09-23 (PR 420): scanBlock is gone. runBlock is what the RUN TRADING DESK line reads:
// which stage the run is in, how many of the five researchers are back, and the sentence when it failed.
// NEGATIVE CONTROL (run 2026-09-23): runBlock's `run.status === 'error' ? (run.error || SAY.runStalled) : null` answered null made this read
//   FAIL  T6 runBlock RUNS: ...
{
  const now = at('2026-09-23T16:00:00Z');
  const q = K.runBlock({ status: 'queued', queuedAt: new Date(now - 20_000), trigger: 'manual' }, now);
  const r = K.runBlock({ status: 'researching', startedAt: new Date(now - 90_000), heartbeatAt: new Date(now - 10_000), done: 3 }, now);
  const e = K.runBlock({ status: 'error', error: 'Fewer than two came back.' }, now);
  const e2 = K.runBlock({ status: 'error' }, now);
  const odd = K.runBlock({ status: 'scanning' }, now);
  check('T6 runBlock RUNS: no run is idle and not alive, queued and researching are alive with the count back of five, an error carries its sentence or the stalled one, and a status it does not know reads idle',
    K.runBlock(null, now).status === 'idle' && K.runBlock(null, now).alive === false
    && q.status === 'queued' && q.alive === true && q.of === 5 && q.queuedAt === new Date(now - 20_000).toISOString()
    && r.status === 'researching' && r.done === 3 && r.of === 5 && r.alive === true
    && e.error === 'Fewer than two came back.' && e2.error === K.SAY.runStalled && K.runBlock({ status: 'idle' }, now).error === null
    && odd.status === 'idle',
    JSON.stringify({ q, r, e, e2, odd }));
}

// T7 USED TO RUN THE CRON'S MINUTE, and then pinned that both reads carried the scan.
// RE-PINNED 2026-09-23 (PR 420): the board. The state answers with the last run's trades that are
// still worth taking, the ones he took in their own list, how many timed out, his balance as he last
// typed it, and the panel's block is nothing but the fact that this case is the desk.
// NEGATIVE CONTROL (run 2026-09-23): tradeState's `recs` filter lost `&& live(r)` made this read
//   FAIL  T7 the board RUNS: ...
{
  const now = at('2026-09-23T16:00:00Z');
  const { w, api } = world();
  w.docs.set('trade/settings', { data: { caseId: 'c1', accountType: 'cash', riskPct: 3 }, updateTime: 'S1' });
  w.docs.set('trade/state', { data: { desk: { at: new Date(now - 3600_000), ids: ['a', 'b', 'c'], count: 3, read: 'Firm.', none: '' }, activeIds: ['t'], run: { status: 'idle' } }, updateTime: 'T1' });
  const rec = (o) => ({ data: { ticker: 'NVDA', side: 'long', horizon: 'intraday', instrument: 'stock', entryLow: 1, entryHigh: 2, stop: 0.5, targets: [3], ...o }, updateTime: 'P' });
  w.docs.set('trade/plays/items/a', rec({ status: 'open', expiresAt: new Date(now + 3600_000) }));
  w.docs.set('trade/plays/items/b', rec({ status: 'open', expiresAt: new Date(now - 60_000) }));
  w.docs.set('trade/plays/items/c', rec({ status: 'expired' }));
  w.docs.set('trade/plays/items/t', rec({ status: 'took', tookAt: new Date(now - 600_000), ticker: 'PLTR' }));
  w.listed['trade/balances/items'] = [{ id: '2026-09-22', data: { date: '2026-09-22', cents: 238000 } }];
  const st = await api.tradeState(env, { now });
  const panel = await api.tradePanelBlock(env);
  // A first read after PR 420: the plays he had already taken join the board once, and are written down.
  const fresh = world();
  fresh.w.docs.set('trade/settings', { data: { caseId: 'c1' }, updateTime: 'S1' });
  // RE-PINNED 2026-09-23 (review): a play taken on the old page and logged as a position was closed there, and a
  // spread cannot be sized by the new card, so neither joins the board.
  // NEGATIVE CONTROL (run 2026-09-23): the seed's `!r.data?.positionId &&` removed made this read
  //   FAIL  T7 the board RUNS: ...
  fresh.w.listed['trade/plays/items'] = [{ id: 'old1', data: { status: 'took' } }, { id: 'old2', data: { status: 'closed' } },
    { id: 'old3', data: { status: 'took', positionId: 'pos1' } }, { id: 'old4', data: { status: 'took', instrument: 'spread' } }];
  await fresh.api.tradeState(env, { now });
  const seeded = fresh.w.patches.find((x) => x.path === 'trade/state' && x.data.activeIds);
  check('T7 the board RUNS: only the last run\'s trades still in their time are offered, the taken one sits in its own list, one timed out is counted, the balance is the one he typed, the settings say 3%, and the panel\'s block only says this is the desk; a first read seeds his taken plays once',
    st.recs.map((r) => r.id).join() === 'a' && st.active.map((r) => r.id).join() === 't' && st.timedOut === 1
    && st.balance.cents === 238000 && st.balance.typed === true && st.settings.riskPct === 3 && st.open === true
    && st.desk.read === 'Firm.' && st.run.status === 'idle' && st.market.today === '2026-09-23'
    && panel.caseId === 'c1' && panel.pr420 === true && Object.keys(panel).length === 2
    && seeded?.data.activeIds.join() === 'old1' && seeded.opts.mustNotExist === true,
    JSON.stringify({ recs: st.recs.map((r) => r.id), active: st.active.map((r) => r.id), timedOut: st.timedOut, panel, seeded: seeded?.data }));
}

// ---- T8: the three texts -------------------------------------------------------------
{
  // Nine since 2026-09-22 (Eric: "Questions in the chat are unnecessary"): no question section
  // and no list of what he never answered, because the desk asks him nothing.
  const HEADS = ['## Right now', '## Your trades', '## Where you are slipping', '## Rules to hold', '## Setups', '## Key terms', '## Working line', '## Plays', '## Corrections'];
  const idx = HEADS.map((h) => K.TRADE_CONTRACT.indexOf(`${h}\n`));
  const ordered = idx.every((i, n) => i >= 0 && (n === 0 || i > idx[n - 1]));
  const words = ['MOST IMPORTANT RULE', 'Position size = how much money is placed in the trade.', 'VWAP reclaim and VWAP rejection', 'Do not present uncertain market movement as certain.', 'What I would watch next:'];
  // NEGATIVE CONTROL (run 2026-09-22): the contract's `YOU NEVER ASK HIM A QUESTION.` line removed made this read
  //   FAIL  T8 his instructions ride word for word (the opening, the close, the rule that matters most, 6774 characters), the contract names the nine sections in order and never a question one with the Plays shape and the six setup lines and closes on "Every trade is his decision", the ask note asks for the one PORTFOLIO TOTAL line, and none of the three carries a dash
  check('T8 his instructions ride word for word (the opening, the close, the rule that matters most, 6774 characters), the contract names the nine sections in order and never a question one with the Plays shape and the six setup lines and closes on "Every trade is his decision", the ask note asks for the one PORTFOLIO TOTAL line, and none of the three carries a dash',
    K.TRADE_INSTRUCTIONS.length === 6774 && K.TRADE_INSTRUCTIONS.startsWith('You are a friendly stock day-trading advisor and teacher built into a trading app.')
    && K.TRADE_INSTRUCTIONS.endsWith('Talk like a knowledgeable trading mentor sitting beside the user looking at the same screen.')
    && words.every((x) => K.TRADE_INSTRUCTIONS.includes(x))
    && ordered && /Current picture, Bull case, Bear case, Levels, Risk, What I would watch next/.test(K.TRADE_CONTRACT)
    && /"plays": \[ \.\.\. \], "portfolio": null/.test(K.TRADE_CONTRACT) && /Every trade is his decision\.$/.test(K.TRADE_CONTRACT)
    && /the differential is the Plays section below/.test(K.TRADE_CONTRACT) && /one section here, Rules to hold/.test(K.TRADE_CONTRACT)
    // ERIC, 2026-09-22: "Questions in the chat are unnecessary. The chat is just for me to dump information
    // that help guide the ... trading desk to my goals or bring up things I'm thinking of."
    && !/Questions for you|Not answered/.test(K.TRADE_CONTRACT) && /YOU NEVER ASK HIM A QUESTION\./.test(K.TRADE_CONTRACT)
    && /it is his alone to write in/.test(K.TRADE_CONTRACT) && /Read all of it as direction\./.test(K.TRADE_CONTRACT)
    && /Never take a total from memory or from an earlier screenshot/.test(K.TRADE_CONTRACT)
    && /PORTFOLIO TOTAL: \$1,234\.56 \(2026-09-22\)/.test(K.TRADE_ASK_NOTE) && /never an order/.test(K.TRADE_ASK_NOTE)
    // The document rule (2026-09-22): the tagged block, last, one per answer, and none unasked.
    && /<document title="the title">/.test(K.TRADE_ASK_NOTE) && /<\/document>/.test(K.TRADE_ASK_NOTE) && /Without such a request, no block\./.test(K.TRADE_ASK_NOTE)
    && /with nothing after it but the document block if there is one/.test(K.TRADE_ASK_NOTE)
    && !DASH.test(K.TRADE_INSTRUCTIONS) && !DASH.test(K.TRADE_CONTRACT) && !DASH.test(K.TRADE_ASK_NOTE),
    `instructions ${K.TRADE_INSTRUCTIONS.length} chars, heads ${idx.join(',')}`);
}

// ---- T9 to T12: the advisor's seams, lifted and run ------------------------------------
const modelLine = grab(ADV, /const MODEL = '[^']+';/);
const selfModelLine = grab(ADV, /const SELF_MODEL = '[^']+';/);
const selfEffortLine = grab(ADV, /const SELF_EFFORT = '[^']+';/);
const caseEffortLine = grab(ADV, /const CASE_EFFORT = '[^']+';/);
const storeLine = grab(ADV, /const turnPolicy = new AsyncLocalStorage\(\);/);
const withPolicy = lift(ADV, 'export async function withCasePolicy(env, kind, id, fn) {');
const selfBlockFn = lift(ADV, 'function selfBlock() {');
const todayFn = lift(ADV, 'function todayBlock() {');
// The real breakpoint helper, not a pass-through (2026-09-22, v4.9): T38 proves the caller's flagged block
// and the trailing today block still carry their breakpoints once a blank block is dropped between them.
const withCacheBpFn = lift(ADV, 'function withCacheBp(system) {');
const turnReqFn = lift(ADV, 'function turnRequest({ system, messages, effort, maxTokens = 64000, tools }) {');
const loadKnowledgeFn = lift(ADV, 'async function loadKnowledge(env) {');
const harness = () => {
  const store = new Map();
  const deps = {
    AsyncLocalStorage,
    getDoc: async (env2, path) => (store.has(path) ? { id: path.split('/').pop(), data: store.get(path) } : null),
    statePath: (kind, id) => `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/advisor/state`,
    TRADE_MODEL: K.TRADE_MODEL, TRADE_EFFORT: K.TRADE_EFFORT, TRADE_WEB_SEARCH_TOOL: K.TRADE_WEB_SEARCH_TOOL, TRADE_CATEGORIES: K.TRADE_CATEGORIES,
    listDocs: async () => store.get('advisorKnowledge') || [],
  };
  const api = new Function('deps', `
    const { AsyncLocalStorage, getDoc, statePath, TRADE_MODEL, TRADE_EFFORT, TRADE_WEB_SEARCH_TOOL, TRADE_CATEGORIES, listDocs } = deps;
    const READ_FAILED = Symbol('read failed'); const tryGet = async (env, p) => { try { return await getDoc(env, p); } catch { return READ_FAILED; } };
    const readFailedError = (m) => new Error(m);
    ${withCacheBpFn}
    ${modelLine}
    ${selfModelLine}
    ${selfEffortLine}
    ${caseEffortLine}
    ${storeLine}
    ${withPolicy.replace('export async function', 'async function')}
    ${selfBlockFn}
    ${todayFn}
    ${turnReqFn}
    ${loadKnowledgeFn}
    return { withCasePolicy, turnRequest, loadKnowledge, turnPolicy, MODEL, SELF_MODEL };
  `)(deps);
  return { api, store };
};
{
  const H = harness();
  H.store.set('cases/desk', { self: true, trade: true, clientName: 'Trade desk' });
  H.store.set('cases/mine', { self: true, clientName: 'Eric Bleach' });
  H.store.set('cases/refused', { self: true, trade: true });
  H.store.set('cases/refused/advisor/state', { modelRefusedId: K.TRADE_MODEL });
  const seen = (id) => H.api.withCasePolicy({}, 'case', id, async () => H.api.turnPolicy.getStore());
  const desk = await seen('desk');
  const mine = await seen('mine');
  const refused = await seen('refused');
  // NEGATIVE CONTROL (run 2026-09-22): the web search tool dropped from the desk's policy line made this read
  //   FAIL  T9 the policy on the desk is self and trade on the desk's id at its own effort with one web search tool, a refused pinned id drops to the default, his own case keeps its own policy, and the branch is one line so the effort is a policy field and not a literal
  // RE-PINNED 2026-09-22 (nothing runs but his tap): the desk's effort is the top one now, so the
  // check reads it off the constant rather than naming the step below it.
  check('T9 the policy on the desk is self and trade on the desk\'s id at its own effort with one web search tool, a refused pinned id drops to the default, his own case keeps its own policy, and the branch is one line so the effort is a policy field and not a literal',
    desk.self === true && desk.trade === true && desk.model === K.TRADE_MODEL && desk.effort === K.TRADE_EFFORT && desk.tools?.length === 1 && desk.tools[0].type === 'web_search_20260209'
    && mine.self === true && !mine.trade && mine.model === H.api.SELF_MODEL && !mine.tools
    && refused.trade === true && refused.model === H.api.MODEL
    && /^\s+policy = \{ self: true, trade: true, model: TRADE_MODEL, effort: TRADE_EFFORT, tools: \[TRADE_WEB_SEARCH_TOOL\], kind, id \};$/m.test(ADV)
    && /if \(c\?\.data\.trade\) \{\n\s+policy = \{ self: true, trade: true/.test(ADV)
    && /if \(st\?\.data\.modelRefusedId === TRADE_MODEL\) policy\.model = MODEL;/.test(ADV),
    JSON.stringify({ desk, mine: mine.model, refused: refused.model }));

  const build = () => H.api.turnRequest({ system: 'SYS', messages: [], effort: 'medium', maxTokens: 1000, tools: [{ name: 'set_price' }] });
  const onDesk = await H.api.withCasePolicy({}, 'case', 'desk', async () => build());
  const onMine = await H.api.withCasePolicy({}, 'case', 'mine', async () => build());
  // NEGATIVE CONTROL (run 2026-09-22): the self block appended on the desk too (`policy?.self` alone) made this read
  //   FAIL  T10 a desk turn carries no self block, the thinking key every other case gets, the web search tool in place of the caller's action tools, and the desk's own id and effort; his own case still gets the block, the thinking key and its own tools
  // RE-PINNED 2026-09-22 (nothing runs but his tap): the desk used to run a model that thinks on its
  // own, so a desk turn carried no thinking key at all. Both of his buttons buy the same model every
  // other case gets now, and it takes the same key.
  check('T10 a desk turn carries no self block, the thinking key every other case gets, the web search tool in place of the caller\'s action tools, and the desk\'s own id and effort; his own case still gets the block, the thinking key and its own tools',
    onDesk.model === K.TRADE_MODEL && onDesk.output_config.effort === K.TRADE_EFFORT && onDesk.thinking?.type === 'adaptive'
    && onDesk.tools.length === 1 && onDesk.tools[0].type === 'web_search_20260209'
    && !onDesk.system.some((b) => /HIS OWN CASE/.test(b.text)) && onDesk.system[0].text === 'SYS'
    && onMine.thinking?.type === 'adaptive' && onMine.tools[0].name === 'set_price' && onMine.system.some((b) => /HIS OWN CASE/.test(b.text))
    && /if \(policy\?\.self && !policy\.trade\) sys\.push\(selfBlock\(\)\);/.test(ADV),
    JSON.stringify({ desk: Object.keys(onDesk), tools: onDesk.tools }));

  // ERIC, 2026-09-22, the desk's Read page: "Analysis failed: system: text content blocks must contain
  // non-whitespace text". The reading's second block falls back to one space when the desk has no
  // trading terms, and the API refuses a whitespace-only block. Four dead reads in the ring.
  const blanks = () => H.api.turnRequest({ system: [{ type: 'text', text: 'SYS', cache: true }, { type: 'text', text: ' ' }, { type: 'text', text: '' }], messages: [], effort: 'medium', maxTokens: 1000 });
  const blankDesk = await H.api.withCasePolicy({}, 'case', 'desk', async () => blanks());
  const blankMine = await H.api.withCasePolicy({}, 'case', 'mine', async () => blanks());
  const blankNone = blanks();
  const noBlank = (t) => t.system.every((b) => b.type !== 'text' || /\S/.test(b.text));
  // NEGATIVE CONTROL (run 2026-09-22): the filter's test loosened to `/[\s\S]*/` (a space passes) made this read
  //   FAIL  T38 a blank system block never rides: a one-space block and an empty block are dropped on the desk, on his own case and outside any policy, the caller's flagged block keeps its breakpoint, the today block is still last with the trailing breakpoint, and the drop sits in turnRequest where every request is built
  check('T38 a blank system block never rides: a one-space block and an empty block are dropped on the desk, on his own case and outside any policy, the caller\'s flagged block keeps its breakpoint, the today block is still last with the trailing breakpoint, and the drop sits in turnRequest where every request is built',
    noBlank(blankDesk) && noBlank(blankMine) && noBlank(blankNone)
    && blankDesk.system.length === 2 && blankDesk.system[0].text === 'SYS' && blankDesk.system[0].cache_control?.type === 'ephemeral'
    && /^Today is /.test(blankDesk.system[1].text) && blankDesk.system[1].cache_control?.type === 'ephemeral'
    && blankMine.system.length === 3 && /HIS OWN CASE/.test(blankMine.system[2].text) && blankNone.system.length === 2
    && /const kept = sys\.filter\(\(b\) => b\.type !== 'text' \|\| \/\\S\/\.test\(String\(b\.text \?\? ''\)\)\);/.test(ADV)
    && /system: withCacheBp\(kept\),/.test(ADV),
    JSON.stringify({ desk: blankDesk.system.map((b) => b.text.slice(0, 12)), mine: blankMine.system.length }));

  H.store.set('advisorKnowledge', [
    { id: 'vwap', data: { term: 'VWAP', category: 'Indicator', learnedAt: null } },
    { id: 'ferritin', data: { term: 'Ferritin', category: 'Test or lab', learnedAt: '2026-09-01' } },
    { id: 'plain', data: { term: 'Plain', learnedAt: null } },
  ]);
  const deskTerms = await H.api.withCasePolicy({}, 'case', 'desk', async () => H.api.loadKnowledge({}));
  const mineTerms = await H.api.withCasePolicy({}, 'case', 'mine', async () => H.api.loadKnowledge({}));
  const noneTerms = await H.api.loadKnowledge({});
  // NEGATIVE CONTROL (run 2026-09-22): loadKnowledge's category filter removed (`const rows = all;`) made this read
  //   FAIL  T11 the knowledge a desk turn is handed is the trading categories only, and every other turn, and a turn outside any run, sees the medical half and none of the trading terms
  check('T11 the knowledge a desk turn is handed is the trading categories only, and every other turn, and a turn outside any run, sees the medical half and none of the trading terms',
    deskTerms.pending.join() === 'VWAP' && deskTerms.learned.length === 0
    && mineTerms.learned.join() === 'Ferritin' && mineTerms.pending.join() === 'Plain'
    && noneTerms.learned.join() === 'Ferritin' && !noneTerms.pending.includes('VWAP')
    && /const rows = all\.filter\(\(r\) => TRADE_CATEGORIES\.includes\(String\(r\.data\.category \|\| ''\)\) === trade\);/.test(ADV),
    JSON.stringify({ deskTerms, mineTerms }));
}

// NEGATIVE CONTROL (run 2026-09-22): `+ tradeNoteText` dropped from the reading's user text made this read
//   FAIL  T12 the reading on the desk: the brief is three-way from the policy, the system is his instructions and the contract first in the same ternary, the second block is the knowledge note alone, the desk note rides the user text, both bails skip the desk, the flight carries trade, and the subject is his trading desk
check('T12 the reading on the desk: the brief is three-way from the policy, the system is his instructions and the contract first in the same ternary, the second block is the knowledge note alone, the desk note rides the user text, both bails skip the desk, the flight carries trade, and the subject is his trading desk',
  /const voice = \(\) => \(turnPolicy\.getStore\(\)\?\.trade \? TRADE_INSTRUCTIONS : turnPolicy\.getStore\(\)\?\.self \? SELF_VOICE : VOICE\);/.test(ADV)
  && /text: trade \? `\$\{TRADE_INSTRUCTIONS\}\\n\\n\$\{TRADE_CONTRACT\}` : self \? `\$\{SELF_VOICE\}\\n\\n\$\{SELF_ASSESSMENT\}` : `\$\{VOICE\}/.test(ADV)
  && /text: trade \? \(knowledgeNote\(knowledge\) \|\| ' '\) : `\$\{knowledgeNote\(knowledge\)\}\$\{self \? priorCasesNote\(state\?\.data\) : ''\}/.test(ADV)
  && /const trade = !!turnPolicy\.getStore\(\)\?\.trade;\n\s+const tradeNoteText = trade \? await tradeNote\(env, \{ now: runT0 \}\) : '';\n\s+const subj = trade \? 'Eric\\'s trading desk' : self \? 'Eric' : 'this client';/.test(ADV)
  && /\+ mediaNote\(media\)\n\s+\+ tradeNoteText,/.test(ADV)
  && /effort: passEffort, auto, skipMedia, self, trade, model: turn\.model,/.test(ADV)
  && /&& !\(turnPolicy\.getStore\(\)\?\.self && priorCasesNote\(state\?\.data\)\)\n(?:\s*\/\/[^\n]*\n)*\s+&& !turnPolicy\.getStore\(\)\?\.trade\) \{/.test(ADV)
  && /if \(auto && !skipMedia && prior && !media\.blocks\.length && !media\.carry\.length\n(?:\s*\/\/[^\n]*\n)*\s+&& !turnPolicy\.getStore\(\)\?\.trade\n/.test(ADV)
  // RE-PINNED 2026-09-22 (nothing runs but his tap): the advisor takes the scan's contract, the
  // desk's state path and its sentences too, because the scan he taps lives there with the reading.
  // RE-PINNED 2026-09-22 (v6.12): the scan's own strength rides in the same import.
  // RE-PINNED 2026-09-22 (v6.13): and the fast look's strength and contract beside them.
  // RE-PINNED 2026-09-23 (PR 420): the Scan and the Look are gone, so the import is back to what the
  // reading and a question need, and nothing of the desk's state or its sentences.
  // NEGATIVE CONTROL (run 2026-09-23): the import's `tradeNote, harvestPlays,` swapped to `harvestPlays, tradeNote,` made this read
  //   FAIL  T12 the reading on the desk: ...
  && /^import \{\n\s+TRADE_MODEL, TRADE_EFFORT, TRADE_WEB_SEARCH_TOOL, TRADE_INSTRUCTIONS, TRADE_CONTRACT, TRADE_ASK_NOTE, TRADE_CATEGORIES,\n\s+tradeNote, harvestPlays, fileDeskReading, portfolioLineOf, recordPortfolio, dollars as deskDollars,\n\s+harvestDocument, fileDocument,\n\} from '\.\/trade-desk\.js';/m.test(ADV)
  && !/from '\.\/advisor\.js'/.test(TD));

// ---- T13 to T16: the harvest and the records, run ----------------------------------
{
  const h = K.harvestPlays(READING);
  const noHead = K.harvestPlays('## Right now\nx\n\n## Not answered\n- none\n');
  const prose = K.harvestPlays('## Right now\nx\n\n## Plays\nNothing stood out today.\n\n## Not answered\n- none\n');
  const noPic = K.harvestPlays(`## Plays\n${JSON.stringify({ plays: [{ ...PLAY, picture: '' }, PLAY], portfolio: null })}\n`);
  // NEGATIVE CONTROL (run 2026-09-22): harvestPlays returning an empty list for a reading with no Plays heading made this read
  //   FAIL  T13 the Plays section is read strictly: a fenced block yields its plays and the portfolio and is cut out of the text; no heading keeps the text whole and files nothing; a body that will not parse is cut out and files nothing; a play without its picture is dropped and counted
  check('T13 the Plays section is read strictly: a fenced block yields its plays and the portfolio and is cut out of the text; no heading keeps the text whole and files nothing; a body that will not parse is cut out and files nothing; a play without its picture is dropped and counted',
    h.missing === false && h.plays.length === 2 && h.plays[0].ticker === 'NVDA' && h.portfolio?.totalCents === 241000 && h.portfolio.asOf === '2026-09-22'
    && !/## Plays/.test(h.text) && /## Not answered/.test(h.text) && /## Working line/.test(h.text) && h.dropped === 0
    && noHead.missing === true && noHead.plays === null && noHead.text === '## Right now\nx\n\n## Not answered\n- none\n'
    && prose.missing === true && prose.plays === null && !/Nothing stood out/.test(prose.text) && /## Not answered/.test(prose.text)
    && noPic.missing === false && noPic.plays.length === 1 && noPic.dropped === 1,
    JSON.stringify({ plays: h.plays.length, portfolio: h.portfolio, noPic: noPic.dropped }));

  const v = K.validPlay(PLAY);
  // NEGATIVE CONTROL (run 2026-09-22): the side enum widened to include 'buy' made this read
  //   FAIL  T14 a play is validated field by field: the ticker uppercased, a dash in the picture gone, the six setup fields carried with the levels capped at eight, a side that is not long or short dropped, a chance that runs backwards dropped, no targets dropped, and a bad portfolio null
  check('T14 a play is validated field by field: the ticker uppercased, a dash in the picture gone, the six setup fields carried with the levels capped at eight, a side that is not long or short dropped, a chance that runs backwards dropped, no targets dropped, and a bad portfolio null',
    v.ticker === 'NVDA' && !DASH.test(v.picture) && /Holding above the opening range/.test(v.picture) && v.bull === 'Through 652 opens 655.' && v.levels.join() === '648,650,652,655' && v.watch === 'The 10:30 bar.'
    && K.validPlay({ ...PLAY, levels: Array.from({ length: 12 }, (_, i) => String(i)) }).levels.length === 8
    && K.validPlay({ ...PLAY, side: 'buy' }) === null && K.validPlay({ ...PLAY, profitLow: 70, profitHigh: 60 }) === null && K.validPlay({ ...PLAY, targets: [] }) === null
    && K.validPortfolio({ totalCents: 2410.5, asOf: '2026-09-22' }) === null && K.validPortfolio({ totalCents: 241000, asOf: '2026-02-30' }) === null,
    JSON.stringify({ levels: v.levels, picture: v.picture }));

  const { w, api } = world();
  w.listed['trade/plays/items'] = [
    { id: 'old1', data: { status: 'open', ticker: 'AMD' } }, { id: 'old2', data: { status: 'took', ticker: 'META' } }, { id: 'old3', data: { status: 'closed', ticker: 'SPY' } },
  ];
  const rec = await api.recordPlays(env, 'c1', [v], { slot: '07:02', now: at('2026-09-22T13:02:00Z') });
  const expired = w.patches.filter((p) => p.data.status === 'expired');
  const fresh = w.patches.find((p) => p.data.status === 'open');
  // NEGATIVE CONTROL (run 2026-09-22): recordPlays expiring every row that is not closed made this read
  //   FAIL  T15 the plays a reading filed: every row still open from an earlier reading expires and nothing else moves, each new play is a row on the desk with the case id, the read's label, an expiry inside the day and status open
  check('T15 the plays a reading filed: every row still open from an earlier reading expires and nothing else moves, each new play is a row on the desk with the case id, the read\'s label, an expiry inside the day and status open',
    rec.ids.length === 1 && rec.expired === 1 && expired.length === 1 && expired[0].path === 'trade/plays/items/old1' && expired[0].opts.mask.join() === 'status,expiredAt'
    && !w.patches.some((p) => p.path.endsWith('/old2') || p.path.endsWith('/old3'))
    && fresh && fresh.data.caseId === 'c1' && fresh.data.slot === '07:02' && fresh.data.ticker === 'NVDA' && fresh.data.expiresAt instanceof Date
    && fresh.data.expiresAt.getTime() === at('2026-09-22T19:02:00Z') && fresh.data.picture === v.picture,
    JSON.stringify({ rec, fresh: fresh?.path }));

  const run = async (existing, extra = {}) => {
    const { w: w2, api: api2 } = world(extra);
    w2.docs.set('trade/settings', { data: { caseId: 'c1', startCents: 200000, startedAt: '2026-08-31' } });
    if (existing) w2.docs.set('trade/balances/items/2026-09-22', existing);
    const out = await api2.recordPortfolio(env, { totalCents: 241000, asOf: '2026-09-22' }, { now: at('2026-09-22T20:00:00Z') });
    return { w: w2, out };
  };
  const typed = await run({ data: { cents: 240000, source: 'typed' } });
  const legacy = await run({ data: { cents: 240000 } });
  const shot = await run({ data: { cents: 240000, source: 'screenshot' } });
  const none = await run(null);
  const unreadable = await run(null, { deps: { tryGet: async () => READ_FAILED } });
  const future = await (async () => { const { api: a } = world(); return a.recordPortfolio(env, { totalCents: 1, asOf: '2026-09-23' }, { now: at('2026-09-22T20:00:00Z') }); })();
  // NEGATIVE CONTROL (run 2026-09-22): a row with no source no longer counted as typed made this read
  //   FAIL  T16 a portfolio total off a screenshot: a typed row wins, a row with no source is his and wins, a screenshot overwrites an earlier screenshot, an empty day takes it with the note and the source stamped and the cover's standing refreshed, a day nobody could read is left alone, and tomorrow is refused
  check('T16 a portfolio total off a screenshot: a typed row wins, a row with no source is his and wins, a screenshot overwrites an earlier screenshot, an empty day takes it with the note and the source stamped and the cover\'s standing refreshed, a day nobody could read is left alone, and tomorrow is refused',
    typed.out.ok === false && typed.out.why === 'typed wins' && !typed.w.patches.some((p) => p.path.startsWith('trade/balances'))
    && legacy.out.ok === false && legacy.out.why === 'typed wins'
    && shot.out.ok === true && shot.w.patches.some((p) => p.path === 'trade/balances/items/2026-09-22' && p.data.cents === 241000 && p.data.source === 'screenshot' && p.data.note === 'from a screenshot')
    && none.out.ok === true && none.out.cents === 241000 && none.w.patches.some((p) => p.path === 'caseMeta/c1' && p.data.tradeStanding?.text && p.opts.mask.join() === 'tradeStanding')
    && unreadable.out.ok === false && unreadable.out.why === 'unreadable' && unreadable.w.patches.length === 0
    && future.ok === false && future.why === 'bad date',
    JSON.stringify({ typed: typed.out, shot: shot.out, none: none.out, unreadable: unreadable.out }));
}

// ---- T17 to T20: the standing, the verdict, the filing, the answer's last line ----------
{
  const m = math.tradeMetrics(FIX, { startedAt: '2026-08-31' });
  const { w, api } = world();
  w.docs.set('trade/settings', { data: { caseId: 'c1', startCents: 200000, startedAt: '2026-08-31' } });
  w.listed['trade/balances/items'] = FIX.map((b) => ({ id: b.date, data: b }));
  const st = await api.tradeStanding(env);
  const refreshed = await api.refreshStanding(env, { now: at('2026-09-21T20:00:00Z') });
  const { api: bare } = world();
  const noDesk = await bare.refreshStanding(env);
  // NEGATIVE CONTROL (run 2026-09-22): `under` and `over` swapped in standingLine made this read
  //   FAIL  T17 the standing line reads the balance, the trading days and the points under or over his daily aim from the same arithmetic, an empty desk reads no entries yet, and the refresh writes it onto the desk's cover and nowhere without a desk
  check('T17 the standing line reads the balance, the trading days and the points under or over his daily aim from the same arithmetic, an empty desk reads no entries yet, and the refresh writes it onto the desk\'s cover and nowhere without a desk',
    K.standingLine(m) === '$2,380.00 · 14 trading days · 0.75 pts under 2% a day'
    && K.standingLine(math.tradeMetrics([{ date: '2026-09-21', cents: 320000 }], { startedAt: '2026-08-31' })).endsWith('pts over 2% a day')
    && K.standingLine(math.tradeMetrics([], { startedAt: '2026-08-31' })) === '$2,000.00 · no entries yet'
    && st.text === '$2,380.00 · 14 trading days · 0.75 pts under 2% a day' && st.currentCents === 238000 && st.days === 14
    && refreshed.text === st.text && w.patches.some((p) => p.path === 'caseMeta/c1' && p.data.tradeStanding.text === st.text)
    && noDesk === null && !DASH.test(st.text),
    JSON.stringify({ line: K.standingLine(m), st }));

  const strong = K.scanVerdict([K.validPlay(PLAY)], {});
  const weak = K.scanVerdict([K.validPlay({ ...PLAY, profitLow: 54 })], {});
  const noCat = K.scanVerdict([K.validPlay({ ...PLAY, catalyst: ' ' })], {});
  const off = K.scanVerdict([K.validPlay(PLAY)], { pushOn: false });
  const two = K.scanVerdict([K.validPlay(PLAY), K.validPlay({ ...PLAY, ticker: 'AMD', profitLow: 60 })], {});
  const { w: pw, api: papi } = world();
  const pushed = await papi.pushStrongPlay(env, 'c1', strong);
  const silent = await papi.pushStrongPlay(env, 'c1', weak);
  const noUid = await papi.pushStrongPlay({}, 'c1', strong);
  // NEGATIVE CONTROL (run 2026-09-22): `>= STRONG_PROFIT_LOW` became `>` made this read
  //   FAIL  T18 a play at 55 with a catalyst pushes a body naming the ticker and side, 54 does not, no catalyst does not, pushes off silences, a second strong play is counted in the body, and the push goes to his uid with the desk's case as the link
  check('T18 a play at 55 with a catalyst pushes a body naming the ticker and side, 54 does not, no catalyst does not, pushes off silences, a second strong play is counted in the body, and the push goes to his uid with the desk\'s case as the link',
    strong.push === true && strong.strong === 1 && /^NVDA long: Oct 17 650\/655 call debit spread, 56 to 64% chance\.$/.test(strong.body)
    && K.scanVerdict([K.validPlay({ ...PLAY, profitLow: 55 })], {}).push === true
    && weak.push === false && noCat.push === false && off.push === false && off.strong === 1
    && two.push === true && / 1 more on the desk\.$/.test(two.body)
    && pushed === true && pw.pushes.length === 1 && pw.pushes[0].uid === 'eric' && pw.pushes[0].link === '/admin-desk.html?id=c1' && pw.pushes[0].title === 'Pocket Advocate' && pw.pushes[0].body === strong.body
    && silent === false && noUid === false && pw.pushes.length === 1,
    JSON.stringify({ strong, two: two.body, pushes: pw.pushes }));

  const filed = async (harvested, settings = {}) => {
    const { w: fw, api: fapi } = world();
    fw.docs.set('trade/settings', { data: { caseId: 'c1', startCents: 200000, startedAt: '2026-08-31', ...settings } });
    fw.listed['trade/balances/items'] = FIX.map((b) => ({ id: b.date, data: b }));
    fw.listed['trade/plays/items'] = [{ id: 'old1', data: { status: 'open' } }];
    const out = await fapi.fileDeskReading(env, 'c1', harvested, { now: at('2026-09-22T13:02:00Z') });
    return { w: fw, out };
  };
  const full = await filed(K.harvestPlays(READING));
  const missing = await filed(K.harvestPlays('## Right now\nx\n'));
  const quiet = await filed(K.harvestPlays('## Plays\n{"plays": [], "portfolio": null}\n'));
  // NEGATIVE CONTROL (run 2026-09-22): the push dropped from fileDeskReading (`if (false)`) made this read
  //   FAIL  T19 what a landed reading files: two plays as rows with the old one expired, the portfolio total as a balance, one push, and the standing; a reading with no Plays section files nothing and still computes the standing; a reading with an empty list expires the old play, files none and pushes nothing
  check('T19 what a landed reading files: two plays as rows with the old one expired, the portfolio total as a balance, one push, and the standing; a reading with no Plays section files nothing and still computes the standing; a reading with an empty list expires the old play, files none and pushes nothing',
    full.out.plays === 2 && full.out.expired === 1 && full.out.dropped === 0 && full.out.missing === false && full.out.portfolio?.ok === true && full.out.pushed === true && /pts under 2% a day$/.test(full.out.standing?.text || '')
    && full.w.patches.filter((p) => p.path.startsWith('trade/plays/items/') && p.data.status === 'open').length === 2
    && full.w.patches.some((p) => p.path === 'trade/balances/items/2026-09-22' && p.data.cents === 241000)
    && full.w.pushes.length === 1 && full.w.pushes[0].link === '/admin-desk.html?id=c1'
    && full.w.patches.filter((p) => p.path.startsWith('trade/plays/items/') && p.data.slot === '07:02').length === 2
    && missing.out.missing === true && missing.out.plays === 0 && missing.w.patches.length === 0 && missing.w.pushes.length === 0 && !!missing.out.standing
    && quiet.out.missing === false && quiet.out.plays === 0 && quiet.out.expired === 1 && quiet.w.pushes.length === 0,
    JSON.stringify({ full: full.out, missing: missing.out, quiet: quiet.out }));

  const line = K.portfolioLineOf('The setup holds.\n\nPORTFOLIO TOTAL: $2,410.50 (2026-09-22)');
  const mid = K.portfolioLineOf('PORTFOLIO TOTAL: $2,410.50 (2026-09-22)\n\nThe setup holds.');
  const bad = K.portfolioLineOf('Fine.\n\nPORTFOLIO TOTAL: $2,410.50 (2026-02-30)');
  const plain = K.portfolioLineOf('Fine, nothing to log.');
  // NEGATIVE CONTROL (run 2026-09-22): the `$` anchor dropped from the PORTFOLIO TOTAL line's regex made this read
  //   FAIL  T20 a desk answer's last line is read and cut off: the dollars with commas and cents become a total for its date, the same line in the middle of an answer is left alone, a line with a date that does not exist is cut off and logs nothing, and an answer without the line is untouched
  check('T20 a desk answer\'s last line is read and cut off: the dollars with commas and cents become a total for its date, the same line in the middle of an answer is left alone, a line with a date that does not exist is cut off and logs nothing, and an answer without the line is untouched',
    line.text === 'The setup holds.' && line.portfolio?.totalCents === 241050 && line.portfolio.asOf === '2026-09-22'
    && mid.portfolio === null && /PORTFOLIO TOTAL/.test(mid.text)
    && bad.portfolio === null && bad.text === 'Fine.'
    && plain.portfolio === null && plain.text === 'Fine, nothing to log.'
    && K.portfolioLineOf('x\nportfolio total: 1,234 (2026-09-22).').portfolio?.totalCents === 123400,
    JSON.stringify({ line, mid: mid.portfolio, bad }));
}

// ---- T21: the desk note, run ---------------------------------------------------------
{
  const { w, api } = world();
  w.docs.set('trade/settings', { data: { caseId: 'c1', finnhubKey: 'abcdefghijklmnop1234', accountType: 'margin', startCents: 200000, startedAt: '2026-08-31', watchlist: ['SPY', 'NVDA'] } });
  w.listed['trade/balances/items'] = FIX.map((b) => ({ id: b.date, data: { ...b, source: b.date === '2026-09-21' ? 'screenshot' : 'typed' } }));
  w.listed['trade/plays/items'] = [{ id: 'p1', data: { ticker: 'NVDA', side: 'long', structure: 'shares', slot: '07:02', status: 'closed', outcomeCents: 4500, profitLow: 55, profitHigh: 65 } }];
  const note = await api.tradeNote(env, { now: at('2026-09-21T15:35:00Z') });
  const { w: w2, api: api2 } = world();
  w2.docs.set('trade/settings', { data: { caseId: 'c1', startCents: 200000, startedAt: '2026-08-31' } });
  const bare = await api2.tradeNote(env, { now: at('2026-09-21T15:35:00Z') });
  const { w: w3, api: api3 } = world({ FINNHUB_KEY: 'x' });
  void w3;
  const envKey = await api3.tradeNote({ ...env, FINNHUB_KEY: 'envkeyenvkeyenvkey' }, { now: at('2026-09-21T15:35:00Z') });
  // NEGATIVE CONTROL (run 2026-09-22): tradeNote fetching the market without a key made this read
  //   FAIL  T21 the desk note carries the account, the standing, the quotes, the headlines, today's earnings, his plays and his last entries with a screenshot row marked, fetches the watchlist with the key and never prints it; without a key it fetches nothing and says so; a real secret on the Worker wins
  check('T21 the desk note carries the account, the standing, the quotes, the headlines, today\'s earnings, his plays and his last entries with a screenshot row marked, fetches the watchlist with the key and never prints it; without a key it fetches nothing and says so; a real secret on the Worker wins',
    /<desk>/.test(note) && /Account: \$2,380\.00, margin account, started at \$2,000\.00 on 2026-08-31/.test(note) && /Standing: \$2,380\.00 · 14 trading days · 0\.75 pts under 2% a day/.test(note)
    && /His rules today: aim 2%, which is \$47\.60; floor 1%, \$23\.80; stop the day at a 3% loss, \$71\.40, or at a 10% gain, \$238\.00\./.test(note)
    && /He risks 1% of the account on one trade, \$23\.80, and writes targets at 2R\./.test(note)
    && /Today: Realized \$0\.00, under the floor\./.test(note) && /His open positions \(his own, not the plays\):\nNone open\./.test(note) && /SPY 100\.5/.test(note) && /Chips lead the open/.test(note) && /ORCL amc/.test(note)
    && /NVDA long shares \(07:02\): closed, closed \$45\.00; chance 55 to 65%/.test(note) && /2026-09-21 \$2,380\.00 \(from a screenshot\)/.test(note)
    && w.fetches.some((u) => /quote\?symbol=NVDA&token=abcdefghijklmnop1234/.test(u)) && w.fetches.length === 4 && !/abcdefghijklmnop1234/.test(note) && !DASH.test(note)
    && w2.fetches.length === 0 && /No market data key is on file/.test(bare) && !/Quotes \(Finnhub/.test(bare)
    && envKey.includes('Quotes (Finnhub') && !/envkeyenvkeyenvkey/.test(envKey),
    note.slice(0, 200));
}

// ---- T22 and T23: the finish, pinned where it cannot run alone ---------------------------
// NEGATIVE CONTROL (run 2026-09-22): `material: personMaterial(rows, qaRows)` restored on the desk made this read
//   FAIL  T22 the finish on the desk: the harvester gets no material, the Plays section is cut out after the corrections, an update pass splices Rules to hold, what the reading filed goes through one call with its recorder line, and the standing rides the cover's mirror
check('T22 the finish on the desk: the harvester gets no material, the Plays section is cut out after the corrections, an update pass splices Rules to hold, what the reading filed goes through one call with its recorder line, and the standing rides the cover\'s mirror',
  /material: ctx\.trade \? null : personMaterial\(rows, qaRows\),/.test(ADV)
  && /const corr = harvestCorrections\(un\.text, rows, p\.corrections\);\n(?:\s*\/\/[^\n]*\n)*\s+const pl = ctx\.trade \? harvestPlays\(corr\.text\) : \{ text: corr\.text, plays: null, portfolio: null, missing: true, dropped: 0 \};/.test(ADV)
  && /\? spliceUnchanged\(pl\.text, prior, ctx\.trade \? \['Rules to hold'\] : \['What we know so far', 'Ruled out'\]\)\n\s+: pl\.text;/.test(ADV)
  && /if \(ctx\.trade && kind === 'case'\) \{\n\s+desk = await fileDeskReading\(env, id, pl, \{ now: submittedMs \|\| now\.getTime\(\) \}\)/.test(ADV)
  && /ev: 'trade-read', plays: desk\?\.plays \?\? 0, expired: desk\?\.expired \?\? 0, dropped: pl\.dropped, missing: pl\.missing,/.test(ADV)
  && /\.\.\.\(desk\?\.standing \? \{ tradeStanding: desk\.standing \} : \{\}\),\n\s+\}, \{ mask: \['workingDx', 'advisorAt', 'diffAt', 'fileAt', 'draftAt', \.\.\.\(desk\?\.standing \? \['tradeStanding'\] : \[\]\)\] \}\)/.test(ADV)
  && ADV.indexOf('await askInChat(env, id, harvestQuestions(finalText), rows)') < ADV.indexOf('desk = await fileDeskReading(env, id, pl,'));

// NEGATIVE CONTROL (run 2026-09-22): `if (!trade)` dropped from finishQuestion's markPending made this read
//   FAIL  T23 a question on the desk: the desk note rides the user text, the ask note takes the authority note's place on the second block, the flight carries trade, the finish reads trade from the policy or the flight, a portfolio line becomes a balance with the Logged sentence or the typed-wins sentence, and no reading is booked after an answer on the desk
check('T23 a question on the desk: the desk note rides the user text, the ask note takes the authority note\'s place on the second block, the flight carries trade, the finish reads trade from the policy or the flight, a portfolio line becomes a balance with the Logged sentence or the typed-wins sentence, and no reading is booked after an answer on the desk',
  /const trade = !!turnPolicy\.getStore\(\)\?\.trade;\n\s+\/\/ The flight recorder/.test(ADV)
  && /const chat = transcript\(rows\);\n\s+const tradeNoteText = trade \? await tradeNote\(env, \{ now: t0 \}\) : '';\n\s+let fileBlocks = \[\];/.test(ADV)
  && /\$\{override \? OVERRIDE_NOTE : ''\}\$\{trade \? TRADE_ASK_NOTE : AUTHORITY_NOTE\}` \|\| ' ' \}\],/.test(ADV)
  && /\$\{workLogNote\(worklog\)\}\$\{tradeNoteText\}\$\{fileNote\}\\nEric asks: \$\{question\}`,/.test(ADV)
  && /batch: \{ batchId, customId, submittedAt: new Date\(\), model: turn\.model, self, trade, override, pollFails: 0 \},/.test(ADV)
  && /const trade = !!\(turnPolicy\.getStore\(\)\?\.trade \|\| flight\?\.trade\);/.test(ADV)
  && /if \(trade\) \{\n\s+const pf = portfolioLineOf\(cleaned\);\n\s+cleaned = pf\.text;\n\s+if \(pf\.portfolio\) \{\n\s+const rec = await recordPortfolio\(env, pf\.portfolio, \{\}\)\.catch\(\(\) => null\);\n\s+if \(rec\?\.ok\) cleaned = `\$\{cleaned\}\\n\\nLogged \$\{deskDollars\(rec\.cents\)\} as the balance for \$\{rec\.date\}\.`;\n\s+else if \(rec\?\.why === 'typed wins'\) cleaned = `\$\{cleaned\}\\n\\nYou typed a balance for \$\{rec\.date\}, so the screenshot's total was not logged over it\.`;/.test(ADV)
  && /if \(!trade\) await markPending\(env, kind, id\)\.catch\(\(\) => \{\}\);/.test(ADV)
  && ADV.indexOf('cleaned = await applyForgotten(env, cleaned);') < ADV.indexOf('const pf = portfolioLineOf(cleaned);'));

// ---- T24 to T29: the routes, run with their sentences -----------------------------------
{
  const run = async (settings = {}, caseDoc = null, over = {}) => {
    const { w, api } = world(over);
    w.docs.set('trade/settings', { data: settings });
    if (caseDoc) w.docs.set(`cases/${settings.caseId}`, { data: caseDoc });
    let out = null; let threw = null;
    try { out = await api.tradeOpen(env, { now: new Date('2026-09-22T13:00:00Z') }); } catch (e) { threw = e; }
    return { w, out, threw };
  };
  const fresh = await run({ startedAt: '2026-08-31', startCents: 200000 });
  const first = await run({});
  const open = await run({ caseId: 'old' }, { trade: true, status: 'confirmed' });
  const closed = await run({ caseId: 'old' }, { trade: true, status: 'closed' });
  const caseOf = (w) => w.patches.find((p) => p.path === 'cases/uuid-new-desk');
  const c = caseOf(fresh.w);
  // NEGATIVE CONTROL (run 2026-09-22): the open desk's id dropped from the 409 made this read
  //   FAIL  T24 opening the desk writes one case document that is self and trade with no client, no money and the desk's name, marks its state as the desk's, points the settings at it and stamps a start date when there is none; a desk already open is refused with its id beside the sentence; a closed desk allows a new one
  check('T24 opening the desk writes one case document that is self and trade with no client, no money and the desk\'s name, marks its state as the desk\'s, points the settings at it and stamps a start date when there is none; a desk already open is refused with its id beside the sentence; a closed desk allows a new one',
    fresh.out.ok === true && fresh.out.id === 'uuid-new-desk' && fresh.out.created === true
    // RE-PINNED 2026-09-23 (PR 420): a desk opened from now on carries its new name.
    // NEGATIVE CONTROL (run 2026-09-23): DESK_NAME put back to 'Trade desk' made this read
    //   FAIL  T24 opening the desk writes one case document ...
    && !!c && c.data.self === true && c.data.trade === true && c.data.clientUid === null && c.data.clientEmail === null && c.data.clientName === 'PR 420'
    && c.data.status === 'confirmed' && c.data.fullAccess === true && c.data.fullAccessByHand === true && c.data.caseRateCents === 0 && c.data.stripe === null
    && c.data.priorCases.length === 0 && c.data.carriedDx.length === 0 && c.data.clientTz === 'America/Boise' && c.opts.mustNotExist === true
    && fresh.w.patches.some((p) => p.path === 'cases/uuid-new-desk/advisor/state' && p.data.trade === true && p.opts.mask.includes('trade'))
    && fresh.w.patches.some((p) => p.path === 'trade/settings' && p.data.caseId === 'uuid-new-desk' && p.opts.mask.join() === 'caseId,openedAt')
    && first.w.patches.some((p) => p.path === 'trade/settings' && p.data.startedAt === '2026-09-22' && p.opts.mask.includes('startedAt'))
    && open.threw?.constructor?.name === 'TradeError' && open.threw.status === 409 && open.threw.message === K.SAY.deskOpen && open.threw.extra?.existing === 'old' && !caseOf(open.w)
    && closed.out.ok === true && !!caseOf(closed.w),
    JSON.stringify({ fresh: fresh.out, open: open.threw?.message, closed: closed.out }));
}
{
  const src = lift(W, 'async function handleTrade(request, env, url, ctx) {');
  const run = async ({ admin, route }) => {
    const calls = [];
    const api = new Function('deps', `const { requireAdmin, json, tradeRoute, TradeError } = deps;\n${src}\nreturn handleTrade;`)({
      requireAdmin: async () => admin, json: (data, status = 200) => ({ data, status }),
      tradeRoute: async (env2, args) => { calls.push(args); return route(args); }, TradeError: K.TradeError,
    });
    const req = (method) => ({ method, json: async () => ({}) });
    const out = {};
    // Re-pinned 2026-09-22 (v5.2): the query string rides too, for the quote route.
    // Re-pinned 2026-09-22 (v6.13): and `ctx`, which is what lets the fast look
    // run its turn on his tap through waitUntil instead of holding the answer.
    const ctx = { waitUntil: () => {} };
    for (const [m, p] of [['GET', 'state'], ['POST', 'open'], ['POST', 'nope'], ['GET', '']]) out[`${m} ${p}`] = await api(req(m), env, { pathname: `/api/admin/trade/${p}`, searchParams: new URLSearchParams('symbols=NVDA') }, ctx);
    return { out, calls, ctx };
  };
  const stranger = await run({ admin: null, route: () => ({ ok: true }) });
  const him = await run({ admin: { uid: 'eric' }, route: ({ sub }) => { if (sub === 'nope') throw new K.TradeError(404, 'Not found'); if (sub === 'open') throw new K.TradeError(409, K.SAY.deskOpen, { existing: 'old' }); return { ok: true, sub }; } });
  let rethrown = false;
  try { await run({ admin: { uid: 'eric' }, route: () => { throw new Error('boom'); } }); } catch { rethrown = true; }
  const { api: R } = world();
  const gone = [];
  for (const [method, sub] of [['POST', 'ask'], ['POST', 'scan'], ['POST', 'seen'], ['GET', 'feed']]) {
    try { await R.tradeRoute(env, { sub, method, body: {} }); gone.push('served'); } catch (e) { gone.push(e.status); }
  }
  // NEGATIVE CONTROL (run 2026-09-22): `...(err.extra || {})` dropped from handleTrade's answer made this read
  //   FAIL  T25 a stranger gets 404 on every sub-path and never reaches the dispatch; he gets the dispatch, a TradeError is its own status with what it carries beside the sentence, anything else is rethrown; and the old portal's ask, scan, seen and feed are plain 404s
  check('T25 a stranger gets 404 on every sub-path and never reaches the dispatch; he gets the dispatch, a TradeError is its own status with what it carries beside the sentence, anything else is rethrown; and the old portal\'s ask, scan, seen and feed are plain 404s',
    Object.values(stranger.out).every((r) => r.status === 404 && r.data.error === 'Not found') && stranger.calls.length === 0
    && him.out['GET state'].status === 200 && him.out['GET state'].data.sub === 'state'
    && him.out['POST open'].status === 409 && him.out['POST open'].data.error === K.SAY.deskOpen && him.out['POST open'].data.existing === 'old'
    && him.out['POST nope'].status === 404 && rethrown
    && gone.join() === '404,404,404,404'
    // RE-PINNED 2026-09-22 (v6.13): `ctx` rides from the router into the dispatch, which
    // is what lets the fast look run its turn on his tap through waitUntil.
    && /if \(url\.pathname\.startsWith\('\/api\/admin\/trade\/'\)\)\n\s+return await handleTrade\(request, env, url, ctx\);/.test(W)
    && him.calls.every((c) => c.ctx === him.ctx)
    && /return json\(await tradeRoute\(env, \{ sub, method: request\.method, body, query, ctx \}\)\);/.test(W)
    && /return json\(\{ error: err\.message, \.\.\.\(err\.extra \|\| \{\}\) \}, err\.status\);/.test(W),
    JSON.stringify({ stranger: Object.values(stranger.out).map((r) => r.status), him: Object.values(him.out).map((r) => r.status), gone }));
}
{
  const { w, api } = world();
  w.docs.set('trade/settings', { data: { caseId: 'c1', finnhubKey: 'abcd1234wxyz', accountType: 'margin', startCents: 250000, startedAt: '2026-08-31', watchlist: ['SPY'], riskPct: 2.5, debugResearch: true, scansOn: false } });
  w.docs.set('trade/state', { data: { activeIds: [], desk: { ids: [] } }, updateTime: 'T1' });
  const payload = await api.tradeState(env, { now: at('2026-09-21T15:35:00Z') });
  const noBal = payload.balance;
  const raw = JSON.stringify(payload);
  // RE-PINNED 2026-09-23 (PR 420): the state is the board now. It still carries whether a key is on
  // file and its last four characters and never the key; the plays, the entries, the metrics, the
  // chart, the scan and the standing are all gone from it, because the page has no chart and no
  // reading and the desk never reviews his history.
  // NEGATIVE CONTROL (run 2026-09-23): publicSettings returning `{ ...settings, ... }` made this read
  //   FAIL  T26 the state carries ...
  check('T26 the state carries the desk\'s case, whether a key is on file and its last four characters and never the key, his account type, his risk per trade, the push and debug switches and the list it prices, the starting amount as the balance until he types one, the day, and none of the plays, the entries, the metrics, the chart, the scan or the standing',
    !/abcd1234wxyz/.test(raw) && !/abcd1234/.test(raw) && payload.settings.hasKey === true && payload.settings.keyTail === 'wxyz' && payload.caseId === 'c1'
    && payload.settings.accountType === 'margin' && payload.settings.riskPct === 2.5 && payload.settings.debugResearch === true && payload.settings.pushOn === true
    && payload.settings.watchlist.join() === 'SPY' && Object.keys(payload.settings).sort().join() === 'accountType,debugResearch,hasKey,keyTail,pushOn,riskPct,watchlist'
    && noBal.cents === 250000 && noBal.typed === false && noBal.date === null
    && payload.market.today === '2026-09-21' && payload.market.tradingDay === 'full' && payload.market.open === true
    && ['plays', 'balances', 'metrics', 'chart', 'scan', 'standing', 'feed', 'flights', 'unseen', 'nextSlot'].every((k) => !(k in payload)),
    JSON.stringify({ settings: payload.settings, balance: noBal, keys: Object.keys(payload) }));
}
{
  const run = async (fn, settings = {}) => {
    const { w, api } = world();
    w.docs.set('trade/settings', { data: settings });
    let out = null; let threw = null;
    try { out = await fn(api, w); } catch (e) { threw = e; }
    return { w, out, threw };
  };
  const badKey = await run((api) => api.tradeSettings(env, { finnhubKey: 'short' }));
  const list = await run((api) => api.tradeSettings(env, { watchlist: 'nvda, tsla, nvda' }));
  // Letters only, so the 21st is refused for being the 21st and not for a digit.
  const many = await run((api) => api.tradeSettings(env, { watchlist: Array.from({ length: 21 }, (_, i) => `T${String.fromCharCode(65 + i)}`) }));
  const acct = await run((api) => api.tradeSettings(env, { accountType: 'x' }));
  const lowRisk = await run((api) => api.tradeSettings(env, { riskPct: 0.05 }));
  const highRisk = await run((api) => api.tradeSettings(env, { riskPct: 6 }));
  const wordRisk = await run((api) => api.tradeSettings(env, { riskPct: 'three' }));
  const risk = await run((api) => api.tradeSettings(env, { riskPct: 2.456 }), { caseId: 'c1', finnhubKey: 'abcdefghijklmnop1234' });
  const hijack = await run((api) => api.tradeSettings(env, { pushOn: false, caseId: 'hijack', startCents: 5 }), { caseId: 'c1' });
  const dbg = await run((api) => api.tradeSettings(env, { debugResearch: true }), { caseId: 'c1' });
  const patchOf = (w) => w.patches.find((p) => p.path === 'trade/settings');
  // RE-PINNED 2026-09-23 (PR 420): the starting amount and its date left Settings with the chart they
  // served, and nothing refreshes a standing any more. The risk per trade is his one rule now (Eric:
  // "3% risk rule."), refused outside 0.1 to 5 percent with its own sentence.
  // NEGATIVE CONTROL (run 2026-09-23): tradeSettings' `v > 5` bound raised to `v > 50` made this read
  //   FAIL  T27 settings refuse ...
  check('T27 settings refuse a bad key, a 21st ticker, a third account type and a risk per trade under 0.1 or over 5 percent or not a number, each with its sentence; a risk is kept to two places; a list is uppercased and deduped; the debug switch saves; the case id and a starting amount are never taken from a body; the reply never carries the key',
    badKey.threw?.message === K.SAY.badKey && badKey.threw.status === 400 && badKey.w.patches.length === 0
    && list.out.settings.watchlist.join() === 'NVDA,TSLA' && patchOf(list.w).data.watchlist.join() === 'NVDA,TSLA'
    && many.threw?.message === K.SAY.badWatchlist && acct.threw?.message === K.SAY.badAccount
    && [lowRisk, highRisk, wordRisk].every((r) => r.threw?.message === K.SAY.badRisk && r.threw.status === 400 && r.w.patches.length === 0)
    && K.SAY.badRisk === 'Risk per trade: 0.1 to 5 percent of the balance.'
    && patchOf(risk.w).data.riskPct === 2.46 && risk.out.settings.riskPct === 2.46
    && risk.out.settings.hasKey === true && risk.out.settings.keyTail === '1234' && !/abcdefghijklmnop1234/.test(JSON.stringify(risk.out))
    && patchOf(hijack.w).data.pushOn === false && hijack.out.settings.pushOn === false
    && !('caseId' in patchOf(hijack.w).data) && !patchOf(hijack.w).opts.mask.includes('caseId') && !('startCents' in patchOf(hijack.w).data)
    && patchOf(dbg.w).data.debugResearch === true && dbg.out.settings.debugResearch === true
    && !hijack.w.patches.some((p) => p.path.startsWith('caseMeta/')),
    JSON.stringify({ list: list.out?.settings.watchlist, risk: risk.out?.settings.riskPct, hijack: patchOf(hijack.w)?.data }));

  const NOW = at('2026-09-21T20:00:00Z');
  const up = await run((api) => api.tradeBalance(env, { date: '2026-09-21', cents: 238000 }, NOW), { caseId: 'c1' });
  const today = await run((api) => api.tradeBalance(env, { cents: 241000 }, NOW), { caseId: 'c1' });
  const rm = await run((api) => api.tradeBalance(env, { date: '2026-09-21', remove: true }, NOW), { caseId: 'c1' });
  const future = await run((api) => api.tradeBalance(env, { date: '2026-09-22', cents: 1 }, NOW));
  const neg = await run((api) => api.tradeBalance(env, { date: '2026-09-21', cents: -1 }, NOW));
  const junk = await run((api) => api.tradeBalance(env, { date: '2026-02-30', cents: 1 }, NOW));
  // RE-PINNED 2026-09-23 (PR 420): no standing to refresh, and a balance typed without a date is today's
  // on his clock, which is how the Settings sheet sends it.
  // NEGATIVE CONTROL (run 2026-09-23): tradeBalance's `date === undefined || body?.date === ''` default removed made this read
  //   FAIL  T28 a balance he types ...
  check('T28 a balance he types is upserted at its date path stamped typed, a balance with no date is today\'s on his clock, the answer is the balance the cards size from, a date removes, and tomorrow, a negative figure or a date that does not exist are each refused with their sentence; nothing touches a cover',
    up.out.ok === true && up.w.patches[0].path === 'trade/balances/items/2026-09-21' && up.w.patches[0].data.cents === 238000 && up.w.patches[0].data.source === 'typed'
    && up.out.balance.cents === 238000 && up.out.balance.typed === true && up.out.balance.date === '2026-09-21'
    && today.w.patches[0]?.path === 'trade/balances/items/2026-09-21' && today.out?.balance.cents === 241000
    && rm.out.removed === '2026-09-21' && rm.w.deletes[0] === 'trade/balances/items/2026-09-21'
    && future.threw?.message === K.SAY.badDate && neg.threw?.message === K.SAY.badCents && junk.threw?.message === K.SAY.badDate
    && ![up, today, rm].some((r) => r.w.patches.some((p) => p.path.startsWith('caseMeta/'))),
    JSON.stringify({ up: up.out, today: today.out, rm: rm.out, future: future.threw?.message }));

  const withRec = async (fn, status = 'open', over = {}) => {
    const { w, api } = world(over);
    w.docs.set('trade/settings', { data: { caseId: 'c1' } });
    w.docs.set('trade/state', { data: { activeIds: over.activeIds || ['other'] }, updateTime: 'ST1' });
    w.docs.set('trade/plays/items/p1', { data: { ticker: 'NVDA', side: 'long', horizon: 'intraday', status, tookAt: status === 'took' ? new Date('2026-09-21T15:00:00Z') : null, result: over.result || null }, updateTime: 'P1' });
    let out = null; let threw = null;
    try { out = await fn(api); } catch (e) { threw = e; }
    return { w, out, threw };
  };
  const NOW2 = at('2026-09-21T16:00:00Z');
  const took = await withRec((api) => api.tradeRoute(env, { sub: 'take', method: 'POST', body: { id: 'p1' }, now: NOW2 }));
  const again = await withRec((api) => api.tradeTake(env, { id: 'p1' }, NOW2), 'took', { activeIds: ['p1', 'other'] });
  // RE-PINNED 2026-09-23 (review): a first YES whose list write failed left the trade taken and on no list;
  // the second YES now finishes that job instead of answering ok and changing nothing.
  // NEGATIVE CONTROL (run 2026-09-23): tradeTake's `if (!(st?.data?.activeIds || []).includes(id)) await editActive(env, addActive);` removed made this read
  //   FAIL  T29 YES and PROFIT or LOSS RUN: ...
  const repaired = await withRec((api) => api.tradeTake(env, { id: 'p1' }, NOW2), 'took');
  const late = await withRec((api) => api.tradeTake(env, { id: 'p1' }, NOW2), 'expired');
  const nobody = await withRec((api) => api.tradeTake(env, { id: 'p9' }, NOW2));
  const lost = await withRec((api) => api.tradeTake(env, { id: 'p1' }, NOW2), 'open', { claim: false });
  const won = await withRec((api) => api.tradeRoute(env, { sub: 'result', method: 'POST', body: { id: 'p1', result: 'profit' }, now: NOW2 }), 'took');
  const lossR = await withRec((api) => api.tradeResult(env, { id: 'p1', result: 'loss' }, NOW2), 'took');
  const early = await withRec((api) => api.tradeResult(env, { id: 'p1', result: 'loss' }, NOW2), 'open');
  const odd = await withRec((api) => api.tradeResult(env, { id: 'p1', result: 'even' }, NOW2), 'took');
  const twice = await withRec((api) => api.tradeResult(env, { id: 'p1', result: 'profit' }, NOW2), 'closed', { result: 'profit' });
  const playPatch = (w) => w.patches.find((p) => p.path === 'trade/plays/items/p1');
  const activeOf = (w) => w.patches.filter((p) => p.path === 'trade/state').pop()?.data.activeIds;
  // RE-PINNED 2026-09-23 (PR 420): took, skipped and closed at a dollar figure are gone. He answers a
  // trade twice at most: YES when he takes it, then PROFIT or LOSS, and each is written under a
  // precondition so a run finishing in the same second cannot lose it.
  // NEGATIVE CONTROL (run 2026-09-23): tradeResult's `if (d.status !== 'took')` guard removed made this read
  //   FAIL  T29 YES and PROFIT or LOSS RUN: ...
  check('T29 YES and PROFIT or LOSS RUN: YES takes an open trade under a precondition, stamps when and puts it first among his active ones; a second YES changes nothing; a trade no longer open, an unknown one and a lost race are refused with their sentences; PROFIT or LOSS closes a taken one with the result and the time and takes it off the active list; before YES, or a third answer, is refused; the same answer twice changes nothing',
    took.out?.rec.status === 'took' && playPatch(took.w).data.tookAt instanceof Date && playPatch(took.w).opts.mask.join() === 'status,tookAt'
    && playPatch(took.w).opts.ifUpdateTime === 'P1' && activeOf(took.w).join() === 'p1,other'
    && again.out?.rec.status === 'took' && again.w.patches.length === 0
    && repaired.out?.rec.status === 'took' && activeOf(repaired.w)?.join() === 'p1,other' && !repaired.w.patches.some((p) => p.path === 'trade/plays/items/p1')
    && late.threw?.status === 409 && late.threw.message === K.SAY.notOpen && nobody.threw?.status === 404 && nobody.threw.message === K.SAY.noRec
    && lost.threw?.status === 409 && lost.threw.message === K.SAY.busy
    && won.out?.rec.status === 'closed' && won.out.rec.result === 'profit' && playPatch(won.w).data.closedAt instanceof Date
    && playPatch(won.w).opts.mask.join() === 'status,result,closedAt' && activeOf(won.w).join() === 'other'
    && lossR.out?.rec.result === 'loss' && early.threw?.message === K.SAY.notTaken && early.threw.status === 409
    && odd.threw?.message === K.SAY.badResult && odd.threw.status === 400 && twice.out?.rec.result === 'profit' && twice.w.patches.length === 0,
    JSON.stringify({ took: took.out?.rec.status, active: activeOf(took.w), won: won.out?.rec, early: early.threw?.message }));
}

// ---- T30: the Worker's hooks and refusals ------------------------------------------------
// RE-PINNED 2026-09-23 (PR 420): the cron's desk work is two calls now. maybeMorningRun queues the
// 7:00 run through waitUntil, and maybeRunDesk runs a queued one AWAITED in the firing, which is
// what gives it the firing's fifteen minutes; when it ran, the case drain waits for the next minute.
// The scan collector, the morning reading and the state route's scan poll are gone; the panel's
// block only says the case is the desk.
// NEGATIVE CONTROL (run 2026-09-23): `const ranDesk = await maybeRunDesk(` changed to `const ranDesk = false && await maybeRunDesk(` made this read
//   FAIL  T30 the Worker imports ...
check('T30 the Worker imports the desk\'s routes and panel block, the run and its morning clock, and the categories; queues the 7:00 run at every firing and runs a queued one awaited before the case drain; no longer collects a scan or books a reading; hands the panel the desk\'s block and the trading half of the glossary on a desk; prints the standing on the covers; refuses to pull from the desk or continue it; and a deleted desk clears the settings\' pointer',
  /import \{ tradeRoute, TradeError, tradePanelBlock \} from '\.\/trade\.js';\nimport \{ maybeRunDesk, maybeMorningRun, peekDesk \} from '\.\/desk-run\.js';\nimport \{ TRADE_CATEGORIES, SAY as TRADE_SAY \} from '\.\/trade-desk\.js';/.test(W)
  && !/maybeTradeScan|maybeMorningRead|maybeCollectScan|pollScanFlight/.test(W)
  && /ctx\.waitUntil\(maybeMorningRun\(env\)\.catch\(\(\) => \{\}\)\);/.test(W)
  // RE-PINNED 2026-09-23 (review): never on a quarter hour, whose firing carries the medical sweeps.
  // NEGATIVE CONTROL (run 2026-09-23): `minute % 15 === 0 ? false` changed to `minute % 15 === 99 ? false` made this read
  //   FAIL  T30 the Worker imports ...
  // RE-PINNED 2026-09-23 (v7.2, fifty calls): the firing looks first, one read before anything runs
  // beside it, and never on a quarter hour. When the desk has work the three per-minute chores wait for
  // the next minute, and the run is handed the document the look read.
  // NEGATIVE CONTROL (run 2026-09-23, v7.2): `if (!deskDoc) {` around the chores changed to `if (true) {` made this read
  //   FAIL  T30 the Worker imports ...
  // NEGATIVE CONTROL (run 2026-09-23, v7.2): `minute % 15 === 0 ? null : await peekDesk(env)` changed to `await peekDesk(env)` made this read
  //   FAIL  T30 the Worker imports ...
  && /const deskDoc = minute % 15 === 0 \? null : await peekDesk\(env\)\.catch\(\(\) => null\);/.test(W)
  && W.indexOf('await peekDesk(env)') < W.indexOf("ctx.waitUntil(patchDoc(env, 'diag/cron'")
  && /if \(!deskDoc\) \{\n(?:\s*\/\/[^\n]*\n)*\s+ctx\.waitUntil\(unparkAdvisor\(env\)\);\n(?:\s*\/\/[^\n]*\n)*\s+ctx\.waitUntil\(runWorkClockNudges\(env\)\);\n(?:\s*\/\/[^\n]*\n)*\s+ctx\.waitUntil\(closeBookingsAug2026\(env\)\);\n\s+\}/.test(W)
  && (W.match(/ctx\.waitUntil\(unparkAdvisor\(env\)\)/g) || []).length === 1
  && /const ranDesk = !deskDoc \? false\n\s+: await maybeRunDesk\(env, \{ deadlineAt, doc: deskDoc \}\)\.catch\(/.test(W)
  && /const ranAnalysis = ranDesk \? true : await runQueuedAnalyses\(env, deadlineAt\);/.test(W)
  && W.indexOf(': await maybeRunDesk(') < W.indexOf('const ranAnalysis = ranDesk')
  && /pollCaseFlight, pollFlightsNow, pollAskFlight,\n/.test(W)
  && !/pollTradeFlights/.test(W) && !/pollTradeFlights|submitTradeBatch|tradeAsk|tradeSeen|tradeScanNow|trade\/feed|trade\/flights/.test(T)
  && /const trade = !!state\?\.data\.trade;\n\s+const terms = knowledge\.filter\(\(r\) => TRADE_CATEGORIES\.includes\(String\(r\.data\.category \|\| ''\)\) === trade\);\n(?:\s*\/\/[^\n]*\n)*\s+const tradeBlock = trade \? await tradePanelBlock\(env\)\.catch\(\(\) => null\) : null;/.test(W)
  && /state: panelState,\n\s+trade: tradeBlock,/.test(W) && /glossary: terms\.map\(\(r\) => \(\{/.test(W)
  && /by: dx\?\.by \|\| 'advisor',\n(?:\s*\/\/[^\n]*\n)*\s+tradeStanding: r\.data\.tradeStanding\?\.text \|\| '',/.test(W)
  && /if \(c\.data\.trade\) return \{ error: TRADE_SAY\.noPull, cases: \[\] \};/.test(W)
  && /if \(doc\.data\.trade\) return json\(\{ error: TRADE_SAY\.noNext \}, 409\);/.test(W)
  && /^\/\/   GET\/POST \/api\/admin\/trade\/\* /m.test(W)
  && /const desk = await getDoc\(env, 'trade\/settings'\)\.catch\(\(\) => null\);\n\s+if \(desk\?\.data\.caseId === id\)\n\s+await patchDoc\(env, 'trade\/settings', \{ caseId: null \}, \{ mask: \['caseId'\] \}\)\.catch\(\(\) => \{\}\);\n\s+return \{ docs: deleted, files: files\.length \};/.test(SHOW)
  // The desk's routes take nothing from the advisor any more: the run is desk-run.js's.
  && !/from '\.\/advisor\.js'/.test(T) && /from '\.\/desk-run\.js';/.test(T));

// ---- T31 to T34: the shelf, the page, the panel, the desk's module ----------------------
// NEGATIVE CONTROL (run 2026-09-22): `if (c.trade) return 'TRADE DESK';` removed from badge() made this read
//   FAIL  T31 the shelf: ...
// RE-PINNED 2026-09-23 (PR 420): the desk is called PR 420 on the shelf, its card and its badge, the line
// under it says what it is for instead of a standing no reading writes any more, and the row says when it runs.
// NEGATIVE CONTROL (run 2026-09-23): the card's `name: c.trade ? 'PR 420' :` dropped made this read
//   FAIL  T31 the shelf: ...
check('T31 the shelf: the desk is off his own shelf and off the pull-from picker, on its own green shelf named PR 420 with what it is for on the line, badged PR 420 before his own case, a green door posts to open and walks into a desk already open, the card wears the green class after the purple, and the four schemes each name the green',
  /const mine = cases\.filter\(\(c\) => c\.self && !c\.trade && c\.status !== 'closed'\);/.test(ADMIN)
  && /const ownAll = cases\.filter\(\(c\) => c\.self && !c\.trade\)/.test(ADMIN)
  && /const desks = cases\.filter\(\(c\) => c\.trade\)/.test(ADMIN) && /section\('PR 420', 'var\(--trade\)', \[/.test(ADMIN)
  && /runs itself at 7:00 Mountain on trading days; RUN TRADING DESK any time/.test(ADMIN)
  && /name: c\.trade \? 'PR 420' : \(c\.clientName \|\| c\.clientEmail \|\| c\.clientUid\),/.test(ADMIN)
  // RE-PINNED 2026-09-22 (v6.0): the desk's card, and the door, open its own page.
  && /href: c\.trade \? `\/admin-desk\.html\?id=\$\{c\.id\}` : `\/admin-case\.html\?id=\$\{c\.id\}`,/.test(ADMIN)
  && /location\.href = `\/admin-desk\.html\?id=\$\{encodeURIComponent\(id\)\}`;/.test(ADMIN)
  && /data-open-trade>📈 Open PR 420<\/button>/.test(ADMIN) && /\(deskOpen\.length \? '' : `<div class="open-doors">/.test(ADMIN)
  && /fetch\('\/api\/admin\/trade\/open', \{/.test(ADMIN) && /const id = res\.ok \? out\.id : \(res\.status === 409 && out\.existing \? out\.existing : null\);/.test(ADMIN)
  && /listEl\.innerHTML = attBlock \+ todayBlock \+ selfBlock \+ tradeBlock \+/.test(ADMIN)
  && /function badge\(c\) \{\n\s+if \(c\.trade\) return 'PR 420';\n\s+if \(c\.self\) return 'MY OWN CASE';/.test(ADMIN)
  && /trade: !!c\.trade,\n(?:\s*\/\/[^\n]*\n)*\s+meta: c\.trade \? 'Suggested trades and market news' : '',/.test(ADMIN)
  && /self = false,\n(?:\s*\/\/[^\n]*\n)*\s+trade = false,\n\} = \{\}\) \{/.test(DRAWER)
  && /\$\{self \? ' self' : ''\}\$\{trade \? ' trade' : ''\}/.test(DRAWER)
  && /:root \{ --trade: #1F8A6D; \}/.test(CSS) && /data-scheme="calm"\] \{ --trade: #6FD9B4; \}/.test(CSS) && /data-scheme="paper"\] \{ --trade: #23705A; \}/.test(CSS) && /data-scheme="contrast"\] \{ --trade: #7CFFCF; \}/.test(CSS)
  && /\.folder\.trade \{\n\s+outline: 2px solid var\(--trade\);/.test(CSS) && CSS.indexOf('.folder.self {') < CSS.indexOf('.folder.trade {')
  && /\.status-pill\.trade \{/.test(CSS) && /\.case-head\.trade \.case-name \{ color: var\(--trade\); \}/.test(CSS) && /\.btn\.trade-open \{/.test(CSS)
  && !/\.trade-tabs|\.trade-badge/.test(CSS));

// NEGATIVE CONTROL (run 2026-09-22, v6.0): the `location.replace` hand off changed to location.assign made this read
//   FAIL  T32 the folder hands a desk off and keeps none of its furniture: one location.replace to the desk's own page before anything is rendered, no desk groups, no page filter, no desk pages, no desk branches on the masthead, the chat or the uploads note, no desk overview and no desk events, and the panel is mounted without a desk flag
check('T32 the folder hands a desk off and keeps none of its furniture: one location.replace to the desk\'s own page before anything is rendered, no desk groups, no page filter, no desk pages, no desk branches on the masthead, the chat or the uploads note, no desk overview and no desk events, and the panel is mounted without a desk flag',
  /if \(data\.trade\) \{\n\s+location\.replace\(`\/admin-desk\.html\?id=\$\{encodeURIComponent\(caseId\)\}`\);\n\s+return;\n\s+\}/.test(CASE)
  && (CASE.match(/location\.replace\(/g) || []).length === 1
  && CASE.indexOf('if (data.trade) {') < CASE.indexOf('render(el);')
  && !/DESK_GROUPS|DESK_PAGE_IDS|paintTradeOverview|tradeOverviewRepaint|deskDayLine/.test(CASE)
  && !/pa-desk-day|pa-desk-settings|pa-desk-scan/.test(CASE)
  && !/mountTradeStats|mountTradeDesk|mountTrades|mountCalc/.test(CASE)
  && !/admin-desk\.js/.test(CASE)
  && !/data-trade-scan|data-trade-today|data-trade-next|data-trade-standing/.test(CASE)
  && !/'trades'|'calc'|id: 'desk'/.test(CASE)
  // What is left says nothing about a desk: the masthead has two states, the chat two names, the
  // uploads note one sentence, and the composer's placeholder one branch.
  && /head\.className = `case-head\$\{c\.self \? ' self' : ''\}`;/.test(CASE)
  && /<span class="status-pill\$\{c\.self \? ' self' : ''\}" data-status>\$\{c\.self \? 'MY OWN CASE' : /.test(CASE)
  && /<h3>\$\{data\.self \? 'Your notes' : 'Chat with the client'\}<\/h3>/.test(CASE)
  && /placeholder: data\.self \? 'Add a note, or answer a question above…' : undefined,/.test(CASE)
  && /note\.textContent = 'Your own records: labs, letters, notes, anything\./.test(CASE)
  && /if \(c\.self\) \{ paintSelfOverview\(pane, c\); return; \}/.test(CASE)
  && /\]\,\n\s+\}\);/.test(CASE)
  && /self: !!data\.self,/.test(CASE) && !/trade: !!data\.trade,/.test(CASE)
  // The eight trading categories stay: the Worker still hands a desk only those.
  && /'General',\n(?:\s*\/\/[^\n]*\n)*\s+'Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'\];/.test(CASE));

// NEGATIVE CONTROL (run 2026-09-22, v6.0): `submitAsk(question)` given a second argument made this read
//   FAIL  T33 the panel carries no desk at all: one flag in its signature, no Scan button, no desk line, no camera on Ask, no play cards and no desk block on its poll; and it exports the two the desk's own page reads its reading with
check('T33 the panel carries no desk at all: one flag in its signature, no Scan button, no desk line, no camera on Ask, no play cards and no desk block on its poll; and it exports the two the desk\'s own page reads its reading with',
  /export function mountAdvisor\(\{ container, kind, id, user, onSend, draftContainer = null, diffContainer = null, qaContainer = null, goTo = null, self = false \}\) \{/.test(PANEL)
  && !/data-desk-scan|data-desk-sub|paintDeskSub|lastTrade|deskScanBtn/.test(PANEL)
  && !/data-ask-attach|data-ask-file|ask-chip|uploadAskFile|askFile/.test(PANEL)
  && !/playCardHtml|wirePlayCards|admin-desk\.js/.test(PANEL)
  && !/pa-desk-settings|pa-desk-scan/.test(PANEL)
  && !/uploadBytesResumable/.test(PANEL) && !/out\.trade/.test(PANEL)
  && /<h3>👨‍⚕️ Advisor<\/h3>/.test(PANEL) && /<h3>💬 Ask your advisor<\/h3>/.test(PANEL)
  && /placeholder="Ask your advisor…"/.test(PANEL)
  && /const ok = await submitAsk\(question\);/.test(PANEL)
  && /^export function splitPages\(text\) \{/m.test(PANEL) && /^export function md\(text, terms = null\) \{/m.test(PANEL)
  // The four headings a desk's reading writes still have their icons: the desk's own page draws
  // the reading, but it is the same document out of the same run.
  && /'Your trades': '🧾',\n\s+'Where you are slipping': '⚠️',\n\s+'Rules to hold': '📌',\n\s+'Setups': '📈',/.test(PANEL));

// ---- T34, T52, T53: the desk's view module (PR 420) -------------------------------------------
// RE-PINNED 2026-09-23 (PR 420, Eric: "The purpose is to let me understand the trade at a glance."):
// the play card, the position card, the day bar and the chart are gone with the pages that drew
// them. One card is left, and it carries every field he listed, in the order he reads a trade.
{
  const mod = await import('../../public/js/admin-desk.js');
  const rules = { riskPct: 3 };
  const REC = {
    id: 'r1', ticker: 'NVDA', side: 'long', horizon: 'intraday', instrument: 'stock', entryLow: 247.5, entryHigh: 248, entry: 247.75,
    stop: 245.8, targets: [251, 253.5], holdMinutes: 180, allocPct: 40, profitLow: 56, profitHigh: 64, priceNow: 248.1, lastPrice: 248.1,
    setup: 'Reclaimed VWAP on twice normal volume.', catalyst: 'Guide raised.', invalidation: 'Loses 246.', agreement: 3, status: 'open',
  };
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const card = mod.recCardHtml(REC, { accountCents: 245000, rules });
  const live = mod.recCardHtml(REC, { accountCents: 245000, rules, quotes: { NVDA: { last: 249.3 } } });
  const took = mod.recCardHtml({ ...REC, status: 'took', tookAt: '2026-09-23T16:02:00Z' }, { accountCents: 245000, rules });
  const call = { ...REC, id: 'r2', ticker: 'AMD', horizon: 'scalp', instrument: 'call', strike: 170, expiry: '2026-10-16', entryLow: 2.05, entryHigh: 2.2, stop: 1.6, targets: [2.9], allocPct: 12, holdMinutes: 15, lastPrice: 168.4, priceNow: null };
  const callCard = mod.recCardHtml(call, { accountCents: 245000, rules });
  const dear = mod.recCardHtml({ ...call, allocPct: 5 }, { accountCents: 245000, rules });
  const risky = mod.recCardHtml({ ...call, stop: 0.2, allocPct: 30 }, { accountCents: 245000, rules });
  const noBal = mod.recCardHtml(REC, { accountCents: 0, rules, balanceTyped: false });
  const swing = mod.recCardHtml({ ...REC, id: 'r3', horizon: 'swing', holdMinutes: null, holdDays: 3 }, { accountCents: 245000, rules });
  const board = mod.boardHtml([{ ...REC, id: 'b1', horizon: 'swing' }, { ...REC, id: 'b2' }, { ...REC, id: 'b3', horizon: 'scalp' }, { ...REC, id: 'b4' }], { accountCents: 245000, rules });
  const t = text(card);
  // NEGATIVE CONTROL (run 2026-09-23): the Out if row dropped from recCardHtml's why list made this read
  //   FAIL  T34 the desk's view module RUNS: ...
  check('T34 the desk\'s view module RUNS: a trade reads ticker, Long or Short, its kind and its chance, then the price now, the entry zone, the dollars and shares his 3% rule and the desk\'s allocation allow, how long to hold, the stop, both targets, the risk and reward in dollars and the R:R, then the setup, the catalyst, what kills it and how many researchers agree, with YES under it; a live quote replaces the desk\'s price; a taken one is lit active with the time and PROFIT and LOSS in place of YES; a contract says Stock for the price, names the strike and the date and counts whole contracts; a contract his allocation cannot buy or his rule cannot carry says so in dollars; no balance says to set it; a swing holds in days; and the board groups scalp, intraday and swing in that order with a count, leaving out an empty kind',
    // RE-PINNED 2026-09-23 (review): sized from the worst fill in the zone, $248.00 for this buy.
    // RE-PINNED 2026-09-24 (v7.6, Eric: "I should be able to accept/deny"): NO sits beside YES on a new suggestion.
    // RE-PINNED 2026-09-24 (v7.10, Eric: "The number of agents that agree should be placed just under probability
    // in the same font"): 3 of 5 agree sits under the chance, and the Desk row under the setup is gone.
    /^NVDA Long Intraday Chance 56 to 64% 3 of 5 agree Now \$248\.10 Entry \$247\.50 to \$248\.00 Amount \$980 · 3\.9516 shares Hold 3 hours Stop \$245\.80 Targets \$251\.00 then \$253\.50 Risk \$8\.69 Reward \$11\.85 R:R 1 : 1\.36 Reclaimed VWAP on twice normal volume\. Catalyst Guide raised\. Out if Loses 246\. YES, I TOOK IT NO$/.test(t)
    && /class="outlined rec" data-kind="intraday" data-rec="r1"/.test(card) && /data-act="take"/.test(card) && /data-act="decline"/.test(card) && !/data-act="profit"/.test(card)
    && /Now \$249\.30/.test(text(live))
    && /class="outlined rec active"/.test(took) && /Active since 10:02 AM/.test(text(took))
    && /data-act="profit">PROFIT</.test(took) && /data-act="loss">LOSS</.test(took) && !/data-act="take"/.test(took) && !/data-act="decline"/.test(took)
    && /Stock \$168\.40/.test(text(callCard)) && /\$170\.00 call expiring 16 Oct\. Prices below are the premium per share\./.test(callCard)
    && /Amount \$220 · 1 contract/.test(text(callCard))
    && /One contract costs \$220, more than the \$123 set aside/.test(text(dear))
    && /One contract risks \$200\.00, over your \$73\.50 rule/.test(text(risky))
    && /Amount Set your balance in Settings/.test(text(noBal)) && !/Risk \$/.test(text(noBal))
    && /Hold 3 days/.test(text(swing))
    && board.indexOf('data-kind="scalp"') < board.indexOf('data-kind="intraday"') && board.indexOf('data-kind="intraday"') < board.indexOf('data-kind="swing"')
    && /<h2 class="kindhead">Intraday<span class="n">2<\/span><\/h2>/.test(board) && (board.match(/class="kindgroup"/g) || []).length === 3
    && !/data-kind="swing"/.test(mod.boardHtml([REC], { accountCents: 245000, rules }))
    && ['playFaceHtml', 'positionFaceHtml', 'dayBarState', 'deskChartSvg', 'statsOverviewHtml', 'isQuestion', 'mergeStream', 'streamRowHtml', 'logLineFor', 'scanRunLine'].every((k) => !(k in mod))
    && !DASH.test(DESK),
    t.slice(0, 400));

  const hist = mod.historyRowHtml({ id: 'h1', ticker: 'QQQ', side: 'long', horizon: 'intraday', entryLow: 495.8, entryHigh: 496.3, stop: 494.8, targets: [498.1], setup: 'Trend day.', catalyst: 'Chips.', invalidation: 'Under 495.', result: 'profit', tookAt: '2026-09-22T15:00:00Z', closedAt: '2026-09-22T17:00:00Z' });
  const histLoss = mod.historyRowHtml({ id: 'h2', ticker: 'SPY', side: 'short', horizon: 'scalp', result: 'loss', closedAt: '2026-09-22T17:00:00Z' });
  const histNone = mod.historyRowHtml({ id: 'h3', ticker: 'TSLA', side: 'long', horizon: 'scalp', result: null, closedAt: '2026-09-22T17:00:00Z' });
  const news = mod.newsRowHtml({ headline: 'Chips lead the open', source: 'Demo', at: new Date(Date.now() - 41 * 60_000).toISOString(), url: 'https://example.invalid/x', summary: 'The tape held its ranges.', onDesk: ['NVDA'] });
  const quiet = mod.newsRowHtml({ headline: 'Oil slips', source: 'Demo', at: new Date(Date.now() - 4 * 3600_000).toISOString(), onDesk: [] });
  const flagged = mod.deskNewsHtml({ headline: 'Micron beats', why: 'Chips move on it.', tickers: ['MU', 'NVDA'] });
  const bmo = mod.earningsChipHtml({ symbol: 'MU', hour: 'bmo', onDesk: true });
  const amc = mod.earningsChipHtml({ symbol: 'NKE', hour: 'amc', onDesk: false });
  // RE-PINNED 2026-09-23 (PR 420): Stats is gone (Eric: "NO performance graphs"). News and History are the
  // two lists left, and each row says what it is at a glance.
  // NEGATIVE CONTROL (run 2026-09-23): historyRowHtml's LOSS tag answered as PROFIT made this read
  //   FAIL  T52 the News and History markup RUNS: ...
  check('T52 the News and History markup RUNS: a closed trade reads its day, the ticker, the side and the kind with PROFIT, LOSS or Closed, and folds out the plan it was taken on with the setup, the catalyst, what killed it and both times; a headline on the board lights its dot and chips its ticker, one that is not stays quiet, and its summary folds out with the link; the desk\'s own item carries why it matters and its tickers; an earnings chip says before the open or after the close and lights when it is on the board',
    /<span class="res profit">PROFIT<\/span>/.test(hist) && /<b>QQQ<\/b> Long · Intraday/.test(hist)
    && /Entry \$495\.80 to \$496\.30, stop \$494\.80, targets \$498\.10\./.test(hist) && /Trend day\./.test(hist) && /Out if<\/span> Under 495\./.test(hist)
    && /Taken Sep 22 9:00 AM\. Closed Sep 22 11:00 AM\./.test(text(hist))
    && /<span class="res loss">LOSS<\/span>/.test(histLoss) && /Short · Scalp/.test(histLoss) && /<span class="res none">Closed<\/span>/.test(histNone)
    && /<span class="b lit"><\/span>/.test(news) && /chip neon c-blue">NVDA</.test(news) && /class="sum">The tape held its ranges\. <a href="https:\/\/example\.invalid\/x"/.test(news)
    && /Demo · 41m ago/.test(news) && /<li class="has">/.test(news)
    && /<span class="b"><\/span>/.test(quiet) && !/lit/.test(quiet) && /<li class="">/.test(quiet)
    && /<li class="dnews"><div class="t">Micron beats<\/div><div class="why">Chips move on it\.<\/div>/.test(flagged) && (flagged.match(/class="chip"/g) || []).length === 2
    && /MU <span class="dim">before open<\/span>/.test(bmo) && /chip neon c-blue/.test(bmo) && /after close/.test(amc) && !/neon/.test(amc)
    && ![hist, histLoss, news, flagged, bmo].some((h) => DASH.test(h)),
    text(hist).slice(0, 200));

  const PAGE = f('public/admin-desk.html');
  const APP = f('public/js/admin-deskapp.js');
  // RE-PINNED 2026-09-23 (PR 420, Eric: "NO CHAT"): the stream, the composer, the question mark rule and
  // the reading drawer are gone. What stands here is that none of them came back, on the page or in the
  // app, and that the app asks nothing and posts to no question or log route.
  // NEGATIVE CONTROL (run 2026-09-23): `<textarea id="say"></textarea>` added back to the page made this read
  //   FAIL  T53 the stream is gone: ...
  // RE-PINNED 2026-09-23 (v7.3, Eric: "I should be able to manually tap on the amount traded and update it"):
  // adjust joins the writes; it carries two numbers and nothing he types in words.
  // RE-PINNED 2026-09-24 (v7.6): decline joins them, the NO beside YES; it carries only the trade's id.
  // RE-PINNED 2026-09-24 (v7.8): scale joins them, ADD/TRIM on a taken trade; and the list now reads every
  // call whatever follows the route's name, since `call('scale', body())` slipped past the old `, {` match.
  const WRITES = [...APP.matchAll(/call\('(\w+)',/g)].map((x) => x[1]);
  // NEGATIVE CONTROL (run 2026-09-24, v7.8): an extra `call('ask', body())` added to the app made this read
  //   FAIL  T53 the stream is gone: ...
  check('T53 the stream is gone: the page has no composer, no text box, no stream and no reading, the app writes no log line, asks no question, reads no Firestore and imports none of the old pieces, and its only writes are run, take, decline, result, adjust, scale, balance, settings and open',
    !/<textarea|id="composer"|id="stream"|id="drawer"|id="say"|data-page="desk"|data-page="plays"|data-page="positions"|data-page="stats"/.test(PAGE)
    && !/firebase\.js|onSnapshot|addDoc|advisor\/ask|advisor\/state|isQuestion|mergeStream|md\(|splitPages|confirm\(/.test(APP)
    && WRITES.includes('scale') && WRITES.every((sub) => ['run', 'take', 'decline', 'result', 'adjust', 'scale', 'balance', 'settings'].includes(sub))
    && /fetch\('\/api\/admin\/trade\/open'/.test(APP),
    JSON.stringify(WRITES));
}

// ---- T54: the effects, as pure functions (2026-09-22, the desk as one app) ------------------
{
  const fx = await import('../../public/js/admin-deskfx.js');
  const FXSRC = f('public/js/admin-deskfx.js');
  const APP = f('public/js/admin-deskapp.js');
  const full = fx.fxPlan('profit', {});
  const loss = fx.fxPlan('loss', {});
  const reduced = fx.fxPlan('profit', { reduced: true });
  const off = fx.fxPlan('profit', { celebrate: false });
  const frames = fx.countFrames(0, 2800, 400);
  const instant = fx.countFrames(0, 2800, 0);
  const burst = fx.particleBurst({ from: { x: 40, y: 400 }, to: { x: 300, y: 90 }, n: 12, seed: 7 });
  const again = fx.particleBurst({ from: { x: 40, y: 400 }, to: { x: 300, y: 90 }, n: 12, seed: 7 });
  const other = fx.particleBurst({ from: { x: 40, y: 400 }, to: { x: 300, y: 90 }, n: 12, seed: 8 });
  const mid = fx.arcPoint(burst[0], 0.5);
  const shake = [0, 50, 200, 400].map((t) => fx.shakeAt('profit', t));
  const sweep = [0, 320, 640, 1000].map((t) => fx.sirenSweeps(t, { width: 390 }));
  // NEGATIVE CONTROL (run 2026-09-22): `aim + point` loosened to `aim` in targetState's gold arm made this read
  //   FAIL  T54 the effects RUN: ...
  // RE-PINNED 2026-09-23 (PR 420): the close effects became PROFIT and LOSS on a taken trade. The pure
  // half is unchanged; the browser half has one loud method, result(), whose coins fly to the History
  // tab, and nothing left that reached for the old balance figures or the chart.
  // NEGATIVE CONTROL (run 2026-09-23): the app's `fx.result(kind, {` call changed to `fx.plan(kind, {` made this read
  //   FAIL  T54 the effects RUN: ...
  check('T54 the effects RUN: the plan is three answers and no fourth, a count lands exactly on the figure and is one frame when there is no time to spend, a burst is seeded so the same close flies twice the same way and a different seed does not, a coin\'s arc leaves, rises and lands, the shake dies out inside a third of a second, the siren sweeps three passes and stops, the coins are eight at the least and eighteen at the most, and the line goes green at the aim and gold a whole point past it; PROFIT and LOSS play through one result() whose coins fly to History, and nothing reaches for the old figures or the chart',
    off.off === true && off.numberOnly === true && off.flashMs === 0
    && reduced.off === false && reduced.numberOnly === true && reduced.coins === false && reduced.siren === false && reduced.countMs === 0
    && full.numberOnly === false && full.coins === true && full.siren === false && full.shake === true && full.depth === true
    && loss.coins === false && loss.siren === true && loss.flashMs === 160
    && frames.length === 24 && frames[frames.length - 1] === 2800 && frames.every((v, i) => i === 0 || v >= frames[i - 1])
    && instant.length === 1 && instant[0] === 2800
    && burst.length === 12 && JSON.stringify(burst) === JSON.stringify(again) && JSON.stringify(burst) !== JSON.stringify(other)
    && burst.every((c, i) => c.delay === i * 36 && c.r >= 5.5 && c.r <= 7)
    && fx.arcPoint(burst[0], 0).x === burst[0].x0 && Math.round(fx.arcPoint(burst[0], 1).x) === 300
    && mid.y < Math.min(burst[0].y0, burst[0].y1) && fx.arcPoint(burst[0], 0.96).alpha < 1
    && shake[0].done === false && Math.abs(shake[1].x) > Math.abs(shake[2].x) && shake[3].done === true && shake[3].x === 0
    && sweep[0].top === true && sweep[0].bottom === false
    && sweep[1].top === false && sweep[1].bottom === true
    && sweep[2].top === true && sweep[2].bottom === true
    && sweep[3] === null && sweep.slice(0, 3).every((x) => x.hot >= 0 && x.hot <= 390)
    && fx.coinCount(1, 4760) === 8 && fx.coinCount(4760, 4760) === 16 && fx.coinCount(100000, 4760) === 18
    && fx.targetState({ realizedTodayCents: 4000, aimCents: 4760, accountCents: 238000 }) === 'none'
    && fx.targetState({ realizedTodayCents: 4760, aimCents: 4760, accountCents: 238000 }) === 'aim'
    && fx.targetState({ realizedTodayCents: 7139, aimCents: 4760, accountCents: 238000 }) === 'aim'
    && fx.targetState({ realizedTodayCents: 7140, aimCents: 4760, accountCents: 238000 }) === 'gold'
    && fx.targetState({}) === 'none'
    && typeof fx.createFx === 'function' && typeof fx.seedFlicker === 'function'
    && /function result\(kind, \{ from \} = \{\}\) \{/.test(FXSRC) && /\$\('#bar \[data-page="history"\]'\)/.test(FXSRC)
    && /return \{ result, applyReduce, plan, kick: ambientKick, start\(\) \{/.test(FXSRC)
    && !/#day-real|#big|#chart-svg|#last-dot|bar-badge|function profit\(|function loss\(|function targetLine\(/.test(FXSRC)
    && /const hold = fx\.result\(kind, \{ from: \{ x: r\.left \+ r\.width \/ 2, y: r\.top \+ r\.height \/ 2 \} \}\);/.test(APP)
    && !DASH.test(FXSRC) && !DASH.test(APP),
    JSON.stringify({ frames: frames.length, burst: burst.length, sweep: sweep.map((x) => (x ? x.pass : null)) }));
}

// ---- T55: the read routes RUN (PR 420) --------------------------------------------------------
{
  const nowMs = at('2026-09-22T16:00:00Z');
  const settings = { caseId: 'c1', accountType: 'cash', finnhubKey: 'abcdefghijklmnop1234' };
  const sec = Math.floor(nowMs / 1000);
  const FEED = [
    { headline: 'Nvidia raises guidance', source: 'A', datetime: sec - 600, related: 'NVDA', summary: 'Up.' },
    { headline: 'Fed minutes show a split on cuts', source: 'B', datetime: sec - 1200, related: '' },
    { headline: 'Celebrity chef opens a restaurant', source: 'C', datetime: sec - 300, related: '' },
    { headline: 'Old story on NVDA', source: 'D', datetime: sec - 30 * 3600, related: 'NVDA' },
  ];
  const CAL = { earningsCalendar: [{ symbol: 'NVDA', hour: 'amc' }, { symbol: 'BIG', hour: 'bmo', revenueEstimate: 9e9 }, { symbol: 'TINY', hour: 'bmo', revenueEstimate: 1e8 }] };
  const feedFetch = (w) => async (url) => {
    w.fetches.push(String(url));
    const body = /\/news\?/.test(url) ? FEED : /\/calendar\/earnings/.test(url) ? CAL : {};
    return { ok: true, status: 200, json: async () => body };
  };
  const mk = (over = {}) => {
    const box = { fetches: [] };
    const { w, api } = world({ deps: { fetch: feedFetch(box) } });
    w.fetches = box.fetches;
    w.docs.set('trade/settings', { data: { ...settings, ...(over.settings || {}) } });
    w.docs.set('trade/state', { data: { activeIds: ['t1'], desk: { ids: ['a1'], at: new Date(nowMs - 3600_000), news: [{ headline: 'Desk item', why: 'Moves chips.', tickers: ['NVDA'] }] } }, updateTime: 'T1' });
    w.docs.set('trade/plays/items/a1', { data: { ticker: 'NVDA', status: 'open' } });
    w.docs.set('trade/plays/items/t1', { data: { ticker: 'AMD', status: 'took' } });
    w.listed['trade/plays/items'] = over.plays || [
      { id: 'h2', data: { ticker: 'SPY', side: 'long', horizon: 'scalp', status: 'closed', result: 'loss', closedAt: new Date('2026-09-21T18:00:00Z') } },
      // RE-PINNED 2026-09-23 (review): one trade, logged as a position on the old page and later marked closed
      // as a play too, is History's once, by its position.
      // NEGATIVE CONTROL (run 2026-09-23): tradeHistory's `&& !(r.data?.positionId && logged.has(r.data.positionId))` removed made this read
      //   FAIL  T55 the read routes RUN: ...
      { id: 'dup', data: { ticker: 'TSLA', side: 'short', horizon: 'scalp', status: 'closed', outcomeCents: 5750, positionId: 'z1', closedAt: new Date('2026-09-15T16:00:00Z') } },
      { id: 'o1', data: { ticker: 'NVDA', status: 'open' } },
      { id: 'h1', data: { ticker: 'QQQ', side: 'long', horizon: 'intraday', status: 'closed', result: 'profit', closedAt: new Date('2026-09-22T15:00:00Z') } },
    ];
    w.listed['trade/positions/items'] = over.positions || [
      { id: 'z1', data: { ticker: 'TSLA', side: 'short', horizon: 'scalp', status: 'closed', pnlCents: 5750, entry: 412.1, target: 405, note: 'Covered.', openedAt: new Date('2026-09-15T15:00:00Z'), closedAt: new Date('2026-09-15T16:00:00Z') } },
      { id: 'z2', data: { ticker: 'AMD', status: 'open' } },
    ];
    return { w, api };
  };
  const nw = mk();
  const news = await nw.api.tradeNews(env, { now: nowMs });
  const again = await nw.api.tradeNews(env, { now: nowMs + 1000 });
  const noKey = await mk({ settings: { finnhubKey: '' } }).api.tradeNews(env, { now: nowMs });
  const history = await mk().api.tradeHistory(env);
  const off = mk();
  let offErr = null;
  try { await off.api.tradeRoute(env, { sub: 'research', method: 'GET', now: nowMs }); } catch (e) { offErr = e; }
  const on = mk({ settings: { debugResearch: true } });
  on.w.docs.set('trade/research', { data: { runId: 'run-1', at: new Date(nowMs - 60_000), r1: { status: 'ok', text: 'Tape firm.', ms: 90000 }, r3: { status: 'failed', err: 'timeout' } } });
  const research = await on.api.tradeRoute(env, { sub: 'research', method: 'GET', now: nowMs });
  // RE-PINNED 2026-09-23 (PR 420, Eric: "Only include news that is likely to affect trading decisions.
  // Prioritize relevance over volume."): News keeps what names a ticker on the board or moves the whole
  // tape and drops the rest; the desk's own flagged items lead; History is his closed trades, the desk's
  // and the ones he logged by hand before, and nothing else; the stream's list, Stats, the positions and
  // the morning reading left with their pages (the 7:00 run is desk-run.js's, pinned in desk.mjs D18).
  // NEGATIVE CONTROL (run 2026-09-23): relevantNews' `.filter((n) => n.score > 0)` removed made this read
  //   FAIL  T55 the read routes RUN: ...
  check('T55 the read routes RUN: News leads with the desk\'s own items, keeps a headline that names a ticker on the board or moves the whole tape and drops a celebrity story and a day old one, keeps earnings for the board and for a company big enough to move the index, answers off the cached feed the second time, and without a key still shows the desk\'s items; History is every closed trade newest first with PROFIT or LOSS, the old logged positions read the same way, and nothing open; the research is a 404 until the debug switch is on and then the five reports; and the stream, Stats, positions and the morning reading are gone',
    news.desk.length === 1 && news.desk[0].headline === 'Desk item' && news.tickers.join() === 'AMD,NVDA'
    && news.headlines.map((h) => h.headline).join('|') === 'Nvidia raises guidance|Fed minutes show a split on cuts'
    && news.headlines[0].onDesk.join() === 'NVDA' && news.headlines[1].onDesk.length === 0
    && news.earnings.map((e) => e.symbol).join() === 'NVDA,BIG' && news.earnings[0].onDesk === true && news.earnings[1].onDesk === false
    && again.headlines.length === 2 && nw.w.fetches.filter((u) => /\/news\?/.test(u)).length === 1
    && noKey.hasKey === false && noKey.headlines.length === 0 && noKey.desk.length === 1
    && history.rows.map((r) => r.id).join() === 'h1,h2,z1' && history.count === 3 && K.HISTORY_MAX === 200
    && history.rows[0].result === 'profit' && history.rows[1].result === 'loss' && history.rows[2].result === 'profit' && history.rows[2].source === 'logged'
    && history.rows[2].side === 'short' && history.rows[2].setup === 'Covered.' && history.rows.every((r) => r.status === 'closed')
    && offErr?.status === 404
    && research.runId === 'run-1' && research.reports.length === 5 && research.reports[0].text === 'Tape firm.' && research.reports[2].status === 'failed'
    && research.reports[1].status === 'missing'
    && ['tradeQa', 'tradePositions', 'tradeStats', 'maybeMorningRead', 'maybeCollectScan', 'QA_LIST_MAX'].every((k) => K[k] === undefined),
    JSON.stringify({ desk: news.desk.length, headlines: news.headlines.map((h) => h.headline), earnings: news.earnings.map((e) => e.symbol), history: history.rows.map((r) => [r.id, r.result]) }));
}


// ---- T35: the lists, the files, the demo -------------------------------------------------
{
  const gate = (W.match(/const ADMIN_ASSET =\n\s+(\/.*\/);/) || [])[1];
  const ADMIN_ASSET = gate ? new Function(`return ${gate};`)() : null;
  const mirror = D.slice(D.indexOf('PR 420, the trading desk (2026-09-23)'), D.indexOf('the advisor, from a fixture'));
  // RE-PINNED 2026-09-23 (PR 420): every sentence the new routes can answer with, the demo answers with
  // word for word. The ones it cannot reach are the engine's own (a run that died, fewer than two
  // researchers back), a lost write race, and the two refusals the folder makes, not the desk.
  const sentences = Object.entries(K.SAY)
    .filter(([k]) => ['notFound', 'deskOpen', 'badDate', 'badCents', 'badKey', 'badAccount', 'badWatchlist', 'badTicker', 'noDesk', 'noQuoteKey', 'quoteMany', 'runStalled', 'noRec', 'notOpen', 'notTaken', 'badResult', 'badRisk'].includes(k))
    .map(([, v]) => v);
  const pages = ['admin', 'admin-calendar', 'admin-chats', 'admin-availability', 'admin-dictionary', 'admin-case', 'admin-desk'];
  const seedDesk = SEED.slice(SEED.indexOf('PR 420, the trading desk (2026-09-23)'));
  // NEGATIVE CONTROL (run 2026-09-22): '/js/admin-desk.js' removed from the audit's ADMIN_ASSETS made this read
  //   FAIL  T35 the portal page and its module are gone ...
  // RE-PINNED 2026-09-23 (PR 420): the demo mirrors the new routes and walks a run through its stages on
  // a timer, and the seed is the new board: the last run's trades, one he took, a history marked PROFIT
  // and LOSS, the research behind the debug switch, and his 3% rule. The log, the reading, the positions,
  // the stats and the scan are gone from both.
  // NEGATIVE CONTROL (run 2026-09-23): the demo's `badRisk` sentence reworded to 'Risk per trade: 0.1 to 5 percent.' made this read
  //   FAIL  T35 the portal page and its module are gone ...
  check('T35 the portal page and its module are gone and no admin page links them; the seven pages ask for the stylesheet at its new version; the audit proves the desk\'s page and three modules 404 to a stranger; the sideways drive walks the desk; the asset gate covers the desk\'s files and not the shared arithmetic; the demo mirrors the board, a run that walks its stages, YES, PROFIT and LOSS, History, News, the research behind its switch, the balance and the settings, refuses with the Worker\'s exact sentences, seeds the new board with his 3% rule, keeps its desk off the client half, and carries no log, reading, positions, stats or scan',
    !has('public/admin-trade.html') && !has('public/js/admin-trade.js')
    // RE-PINNED 2026-09-23 (v7.3): stat118, for the size cells he can tap; stat119 (2026-09-24, v7.5) for the run's bar;
    // stat120 (2026-09-24, v7.6) for NO, the Add chip and the back-again note; stat121 (2026-09-24, v7.8) for ADD/TRIM; stat122 (2026-09-24, v7.12) for HOLD and SELL.
    && pages.every((p) => !/admin-trade/.test(f(`public/${p}.html`)) && /admin\.css\?v=stat122/.test(f(`public/${p}.html`)))
    && ['/js/admin-desk.js', '/js/admin-deskapp.js', '/js/admin-deskfx.js'].every((x) => AUDIT.includes(`'${x}'`))
    && /'\/admin-desk',/.test(AUDIT) && !/admin-trade/.test(AUDIT)
    && /'\/admin-desk\.html\?id=demo-case-trade&demo=admin'/.test(NOSIDE) && !/admin-trade/.test(NOSIDE)
    && !!ADMIN_ASSET && ADMIN_ASSET.test('/js/admin-desk.js') && ADMIN_ASSET.test('/js/admin-deskapp.js') && ADMIN_ASSET.test('/js/admin-deskfx.js')
    && ADMIN_ASSET.test('/admin-desk.html') && ADMIN_ASSET.test('/admin-desk')
    && ADMIN_ASSET.test('/js/advisor.js') && !ADMIN_ASSET.test('/js/trade.js') && !ADMIN_ASSET.test('/js/trade-math.js') && !ADMIN_ASSET.test('/js/textpdf.js')
    && ['state', 'history', 'news', 'quote', 'research'].every((sub) => mirror.includes(`if (sub === '${sub}' && init.method !== 'POST')`))
    && ['open', 'balance', 'settings', 'take', 'result', 'run'].every((sub) => mirror.includes(`if (sub === '${sub}') {`))
    // RE-PINNED 2026-09-24 (v7.5): the demo's walk stamps the claim, the handover and the desk's claim, for the bar,
    // and passes through decide as the cron does.
    && /status: 'researching', startedAt: new Date\(\), claimedAt: new Date\(\), done: 0/.test(mirror)
    && /put\(\{ status: 'decide', decideAt: new Date\(\) \}\)/.test(mirror) && /put\(\{ status: 'deciding', claimedAt: new Date\(\) \}\)/.test(mirror)
    && /if \(BUSY_RUN\.includes\(st0\.run\?\.status\)\) return ok\(\{ ok: true, already: true/.test(mirror)
    && /if \(settings\(\)\.debugResearch !== true\) return fail\(404, SAY\.notFound\);/.test(mirror)
    && /if \(d\.status !== 'took'\) return fail\(409, SAY\.notTaken\);/.test(mirror) && /if \(d\.status !== 'open'\) return fail\(409, SAY\.notOpen\);/.test(mirror)
    && /const DEMO_NEWS = \[/.test(D) && /const DEMO_EARNINGS = \[/.test(D)
    && /\/\^trade\\\/\//.test(STORE)
    && /const TRADE_ID = 'demo-case-trade';/.test(SEED) && /set\(`cases\/\$\{TRADE_ID\}`, \{\n\s+self: true,\n\s+trade: true,/.test(SEED) && /clientName: 'PR 420',/.test(seedDesk)
    && /riskPct: 3, debugResearch: false,/.test(seedDesk) && /ids: \['r-demo-1', 'r-demo-2', 'r-demo-3', 'r-demo-4'\]/.test(seedDesk) && /activeIds: \['r-demo-5'\],/.test(seedDesk)
    && /status: 'took', tookAt: hours\(0\.66\)/.test(seedDesk) && (seedDesk.match(/^\s+\['h\d', \d, '\w+', '[A-Z]+', '(profit|loss)',/gm) || []).length === 6
    && /set\('trade\/research', \{/.test(seedDesk) && (seedDesk.match(/source: 'typed'/g) || []).length === 1
    && !/TRADE_READING|chat\/t0|tradeStanding|const CLOSES|scanNote|scanStatus/.test(SEED)
    && !/deskScanBlock|deskPositions|tradeStats|liveBalance|noteBullets|scanStatus|sub === 'scan'|sub === 'look'|sub === 'qa'|sub === 'positions'/.test(D)
    && /set\('advisorKnowledge\/vwap', \{ term: 'VWAP', category: 'Indicator'/.test(SEED)
    && !/trade\/feed|trade\/flights/.test(SEED) && !/trade\/feed|trade\/flights/.test(D)
    && /if \(role !== 'admin'\) return fail\(404, 'Not found'\);/.test(mirror) && sentences.length === 17 && sentences.every((s) => mirror.includes(`'${s.replace(/'/g, "\\'")}'`))
    && /return fail\(409, SAY\.deskOpen, \{ existing: s\.caseId \}\);/.test(mirror) && /const fail = \(status, error, extra = null\) => \(\{/.test(D)
    && /const TRADE_CATS = \['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'\];/.test(D)
    && /TRADE_CATS\.includes\(d\.category \|\| 'General'\) === isTrade\)/.test(D) && /trade: isTrade \? deskPanelBlock\(store\) : null,/.test(D)
    && /return \{ caseId: s\.caseId \|\| null, pr420: true \};/.test(D)
    && /v\?\.self && !v\?\.trade\);/.test(D) && D.includes("if (c.trade) return fail(400, 'The trade desk cannot be pulled from.');") && D.includes(`if (old.trade) return fail(409, '${K.SAY.noNext}');`)
    && /if \(ts\?\.caseId === id\) store\.docs\.set\('trade\/settings', \{ \.\.\.ts, caseId: null \}\);/.test(D)
    && /if \(c\.self && !c\.trade && !asked\) \{/.test(D) && !/const qs = c\.trade \? \[/.test(D)
    && !DASH.test(mirror) && !DASH.test(seedDesk),
    sentences.filter((s) => !mirror.includes(`'${s.replace(/'/g, "\\'")}'`)).join(' | '));
}

// ---- T36: the versions and the words --------------------------------------------------------
{
  const entry = (CL.match(/\{\n\s+\/\/ THE TRADE DESK AS A CASE FILE[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v4.8): both versions read 4.8 and the tag is the furniture push; the 4.7 entry keeps its words.
  const entry48 = (CL.match(/\{\n\s+\/\/ THE DESK SHOWS ONLY ITS OWN FURNITURE[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v4.9): the blank-block push carries its own quiet entry.
  const entry49 = (CL.match(/\{\n\s+\/\/ A BLANK BLOCK IS REFUSED[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v5.0): the desk makes a PDF; its own quiet entry.
  const entry50 = (CL.match(/\{\n\s+\/\/ THE DESK MAKES A PDF[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v5.1): the desk asks him nothing; its own quiet entry.
  const entry51 = (CL.match(/\{\n\s+\/\/ THE DESK ASKS HIM NOTHING[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v5.2): the calculator and his positions.
  const entry52 = (CL.match(/\{\n\s+\/\/ THE CALCULATOR AND HIS POSITIONS[\s\S]*?\n  \},/) || [''])[0];
  const entry53 = (CL.match(/\{\n\s+\/\/ NOTHING RUNS BUT HIS TAP[\s\S]*?\n  \},/) || [''])[0];
  const cssDesk = CSS.slice(CSS.indexOf('/* THE TRADE DESK (Eric, 2026-09-22'), CSS.indexOf('/* The two doors on the shelf'));
  // The desk's own sheet (2026-09-22, v6.0), which is most of what he looks at now.
  const cssApp = CSS.slice(CSS.indexOf('/* ===== THE TRADE DESK, AS ONE APP'));
  const entry60 = (CL.match(/\{\n\s+\/\/ THE DESK AS ONE APP[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.1): the scan's own window, added the same day.
  const entry61 = (CL.match(/\{\n\s+\/\/ THE SCAN, FROM OUTSIDE[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.2): the scan lands on its own again.
  const entry62 = (CL.match(/\{\n\s+\/\/ THE SCAN THAT NEVER LANDED[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.3): a flight whose queue row has gone is collected too.
  const entry63 = (CL.match(/\{\n\s+\/\/ THE FLIGHT NOBODY WAS LOOKING AT[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.4): an empty scan is a failure and never eats the note he had.
  const entry64 = (CL.match(/\{\n\s+\/\/ AN EMPTY SCAN IS A FAILED SCAN[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.5): dollars or shares, and a share can be held in pieces.
  const entry65 = (CL.match(/\{\n\s+\/\/ DOLLARS OR SHARES[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.6): what to put in, and in what.
  const entry66 = (CL.match(/\{\n\s+\/\/ WHAT TO PUT IN, AND IN WHAT[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.7): plain English, a board that refreshes, a wider net.
  const entry67 = (CL.match(/\{\n\s+\/\/ PLAIN ENGLISH, A BOARD THAT REFRESHES[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.8): the chance of profit back on the face.
  const entry68 = (CL.match(/\{\n\s+\/\/ THE CHANCE, BACK WHERE HE READS IT[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.9): the note is at most five bullets, on every path.
  const entry69 = (CL.match(/\{\n\s+\/\/ AT MOST FIVE BULLETS[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.10): the scan can see the market.
  const entry610 = (CL.match(/\{\n\s+\/\/ THE SCAN CAN SEE THE MARKET[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.11): the ticker back at the head of every card.
  const entry611 = (CL.match(/\{\n\s+\/\/ THE TICKER BACK AT THE HEAD[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.12): Scan at high, Update at max, by his choice.
  const entry612 = (CL.match(/\{\n\s+\/\/ SCAN AT HIGH, UPDATE AT MAX[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v6.13): a fast look beside the deep scan, and how long a run has been.
  const entry613 = (CL.match(/\{\n\s+\/\/ A FAST LOOK BESIDE THE DEEP SCAN[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-23 (PR 420): the desk rebuilt and renamed.
  const entry70 = (CL.match(/\{\n\s+\/\/ PR 420 \(Eric, 2026-09-23[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-23 (v7.1): the measuring hatch, its own quiet entry.
  const entry71 = (CL.match(/\{\n\s+\/\/ WHICH WALL A RUN HITS[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-23 (v7.2): fifty calls, its own quiet entry.
  const entry72 = (CL.match(/\{\n\s+\/\/ FIFTY CALLS \(Eric, 2026-09-23[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-23 (v7.3): his own size, its own quiet entry.
  const entry73 = (CL.match(/\{\n\s+\/\/ YOUR SIZE \(Eric, 2026-09-23[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-23 (v7.4): his bar, its own quiet entry.
  const entry74 = (CL.match(/\{\n\s+\/\/ HIS BAR \(Eric, 2026-09-23[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-24 (v7.5): the run's bar, its own quiet entry.
  const entry75 = (CL.match(/\{\n\s+\/\/ THE RUN'S BAR \(Eric, 2026-09-24[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-24 (v7.6): accept or pass, its own quiet entry.
  const entry76 = (CL.match(/\{\n\s+\/\/ ACCEPT OR PASS \(Eric, 2026-09-24[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-24 (v7.7): how many agree, its own quiet entry.
  const entry77 = (CL.match(/\{\n\s+\/\/ HOW MANY AGREE \(Eric, 2026-09-24[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-24 (v7.8): add or trim, its own quiet entry.
  const entry78 = (CL.match(/\{\n\s+\/\/ ADD OR TRIM \(Eric, 2026-09-24[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-24 (v7.9): the GLP-1 chain, its own quiet entry.
  const entry79 = (CL.match(/\{\n\s+\/\/ THE GLP-1 CHAIN \(Eric, 2026-09-24[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-24 (v7.10): the re-check, its own quiet entry.
  const entry710 = (CL.match(/\{\n\s+\/\/ THE RE-CHECK \(Eric, 2026-09-24[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-24 (v7.11): the Clients page's safety net, its own quiet entry.
  const entry711 = (CL.match(/\{\n\s+\/\/ NEVER STUCK ON LOADING \(Eric, 2026-09-24[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-24 (v7.12): HOLD or SELL, its own quiet entry.
  const entry712 = (CL.match(/\{\n\s+\/\/ HOLD OR SELL \(Eric, 2026-09-24[\s\S]*?\n  \},/) || [''])[0];
  const PAGE = f('public/admin-desk.html');
  const HARD = [/advisor/i, /differential/i, /\bAI\b/, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bOpus\b/i, /\bFable\b/i, /\bthe model\b/i, /\ba model\b/i, /chatbot/i];
  // NEGATIVE CONTROL (run 2026-09-22, v6.12): 'one step below Update' reworded to 'one step under Update' in the 6.12 entry made this read
  //   FAIL  T36 both versions read 6.12 with the new tag, the 4.7 through 6.11 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.11): 'back at the head of every setup' reworded to 'back at the top of every setup' in the 6.11 entry made this read
  //   FAIL  T36 both versions read 6.12 with the new tag, the 4.7 through 6.11 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.10): 'can look at the market now' reworded to 'can see the market now' in the 6.10 entry made this read
  //   FAIL  T36 both versions read 6.11 with the new tag, the 4.7 through 6.10 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.9): 'without a new scan' reworded to 'without another scan' in the 6.9 entry made this read
  //   FAIL  T36 both versions read 6.10 with the new tag, the 4.7 through 6.9 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.8): 'back at the top right of every setup' reworded to 'back at the top of every setup' in the 6.8 entry made this read
  //   FAIL  T36 both versions read 6.9 with the new tag, the 4.7 through 6.8 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.7): 'A setup is one sentence now' reworded to 'A setup is a single sentence now' in the 6.7 entry made this read
  //   FAIL  T36 both versions read 6.8 with the new tag, the 4.7 through 6.7 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.6): 'That is a different number from the risk' reworded to 'That is another number from the risk' in the 6.6 entry made this read
  //   FAIL  T36 both versions read 6.7 with the new tag, the 4.7 through 6.6 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.5): 'Shares can be fractional now' reworded to 'Shares can be partial now' in the 6.5 entry made this read
  //   FAIL  T36 both versions read 6.6 with the new tag, the 4.7 through 6.5 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.4): 'treated as a failed scan' reworded to 'handled as a failed scan' in the 6.4 entry made this read
  //   FAIL  T36 both versions read 6.5 with the new tag, the 4.7 through 6.4 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.3): 'can no longer be lost' reworded to 'can no longer go missing' in the 6.3 entry made this read
  //   FAIL  T36 both versions read 6.4 with the new tag, the 4.7 through 6.3 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.2): 'lands on its own again' reworded to 'lands by itself again' in the 6.2 entry made this read
  //   FAIL  T36 both versions read 6.3 with the new tag, the 4.7 through 6.2 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v5.2): 'has a calculator' reworded to 'has a calculator now' in the 5.2 entry made this read
  //   FAIL  T36 both versions read 5.3 with the new tag, the 4.7 through 5.3 entries are quiet and admin-only in the desk's words, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entry, the drive, the stylesheet's green or the demo's desk
  // NEGATIVE CONTROL (run 2026-09-22, v6.13): 'comes back inside a couple of minutes' reworded to 'comes back within a couple of minutes' in the 6.13 entry made this read
  //   FAIL  T36 both versions read 6.13 with the new tag, the 4.7 through 6.12 entries are quiet and admin-only in the desk's words, ...
  // RE-PINNED 2026-09-23 (PR 420): both versions read 7.0 with the PR 420 tag, and the page is three
  // pages behind three tabs named PR 420.
  // NEGATIVE CONTROL (run 2026-09-23): 'lights up electric yellow' reworded to 'turns electric yellow' in the 7.0 entry made this read
  //   FAIL  T36 both versions read 7.0 ...
  // RE-PINNED 2026-09-23 (v7.1): both versions read 7.1 with the limits tag; the 7.0 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-23, v7.1): 'stop partway without saying so' reworded to 'stop partway silently' in the 7.1 entry made this read
  //   FAIL  T36 both versions read 7.1 ...
  // RE-PINNED 2026-09-23 (v7.2): both versions read 7.2 with the fifty-calls tag; the 7.1 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-23, v7.2): 'stopped partway without being able to say so' reworded to 'stopped partway silently' in the 7.2 entry made this read
  //   FAIL  T36 both versions read 7.2 ...
  // RE-PINNED 2026-09-23 (v7.3): both versions read 7.3 with the your-size tag; the 7.2 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-23, v7.3): 'before or after you take it' reworded to 'before or after taking it' in the 7.3 entry made this read
  //   FAIL  T36 both versions read 7.3 ...
  // RE-PINNED 2026-09-23 (v7.4): both versions read 7.4 with the his-bar tag; the 7.3 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-23, v7.4): 'better than a 50% chance' reworded to 'more than a 50% chance' in the 7.4 entry made this read
  //   FAIL  T36 both versions read 7.4 ...
  // RE-PINNED 2026-09-24 (v7.5): both versions read 7.5 with the run-bar tag; the 7.4 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-24, v7.5): 'only fills to the end when the trades are in' reworded to 'fills up when the trades are in' in the 7.5 entry made this read
  //   FAIL  T36 both versions read 7.5 ...
  // RE-PINNED 2026-09-24 (v7.6): both versions read 7.6 with the accept-or-pass tag; the 7.5 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-24, v7.6): 'passing on one leaves the other alone' reworded to 'passing on one keeps the other' in the 7.6 entry made this read
  //   FAIL  T36 both versions read 7.6 ...
  // RE-PINNED 2026-09-24 (v7.7): both versions read 7.7 with the agree-shown tag; the 7.6 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-24, v7.7): 'even when it is only one or none' reworded to 'even when it is one or none' in the 7.7 entry made this read
  //   FAIL  T36 both versions read 7.7 ...
  // RE-PINNED 2026-09-24 (v7.8): both versions read 7.8 with the add-trim tag; the 7.7 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-24, v7.8): 'keeps what you would lose at it the same' reworded to 'keeps your risk the same' in the 7.8 entry made this read
  //   FAIL  T36 both versions read 7.8 ...
  // RE-PINNED 2026-09-24 (v7.9): both versions read 7.9 with the glp1-chain tag; the 7.8 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-24, v7.9): 'the companies that make the pens and vials' reworded to 'the pen and vial makers' in the 7.9 entry made this read
  //   FAIL  T36 both versions read 7.9 ...
  // RE-PINNED 2026-09-24 (v7.10): both versions read 7.10 with the recheck tag; the 7.9 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-24, v7.10): 'still back each one' reworded to 'still like each one' in the 7.10 entry made this read
  //   FAIL  T36 both versions read 7.10 ...
  // RE-PINNED 2026-09-24 (v7.11): both versions read 7.11 with the no-hang tag; the 7.10 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-24, v7.11): 'it reloads itself once' reworded to 'it reloads once' in the 7.11 entry made this read
  //   FAIL  T36 both versions read 7.11 ...
  // RE-PINNED 2026-09-24 (v7.12): both versions read 7.12 with the hold-sell tag; the 7.11 entry keeps its words.
  // NEGATIVE CONTROL (run 2026-09-24, v7.12): 'nothing disappears on its own any more' reworded to 'nothing goes away by itself now' in the 7.12 entry made this read
  //   FAIL  T36 both versions read 7.12 ...
  check('T36 both versions read 7.12 with the new tag, the 4.7 through 7.12 entries are quiet and admin-only in the desk\'s words, the page is PR 420, stamped dark, three pages behind three tabs, and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo\'s desk',
    /export const VERSION = '7\.12';/.test(CL) && /const VERSION = '7\.12';/.test(W) && /const BUILD_TAG = 'v2026-09-24-hold-sell';/.test(W)
    && /version: '7\.12',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry712)
    && /nothing disappears on its own any more/.test(entry712) && /HOLD or SELL/.test(entry712) && !DASH.test(entry712) && !HARD.some((re) => re.test(entry712))
    && /version: '7\.11',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry711)
    && /it reloads itself once/.test(entry711) && !DASH.test(entry711) && !HARD.some((re) => re.test(entry711))
    && /version: '7\.10',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry710)
    && /still back each one/.test(entry710) && /marked Dropped/.test(entry710) && !DASH.test(entry710) && !HARD.some((re) => re.test(entry710))
    && /version: '7\.9',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry79)
    && /the companies that make the pens and vials/.test(entry79) && /HIMS among them/.test(entry79) && !DASH.test(entry79) && !HARD.some((re) => re.test(entry79))
    && /version: '7\.8',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry78)
    && /keeps what you would lose at it the same/.test(entry78) && /ADD\/TRIM between PROFIT and LOSS/.test(entry78) && !DASH.test(entry78) && !HARD.some((re) => re.test(entry78))
    && /version: '7\.7',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry77)
    && /even when it is only one or none/.test(entry77) && !DASH.test(entry77) && !HARD.some((re) => re.test(entry77))
    && /version: '7\.6',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry76)
    && /passing on one leaves the other alone/.test(entry76) && /shows as an Add to your position/.test(entry76) && !DASH.test(entry76) && !HARD.some((re) => re.test(entry76))
    && /version: '7\.5',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry75)
    && /only fills to the end when the trades are in/.test(entry75) && !DASH.test(entry75) && !HARD.some((re) => re.test(entry75))
    && /version: '7\.4',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry74)
    && /better than a 50% chance/.test(entry74) && /best scalp, intraday and swing/.test(entry74) && !DASH.test(entry74)
    && !HARD.some((re) => re.test(entry74))
    && /version: '7\.3',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry73)
    && /Tap Amount or Risk on any trade, before or after you take it/.test(entry73) && /History keeps both/.test(entry73) && !DASH.test(entry73)
    && !HARD.some((re) => re.test(entry73))
    && /version: '7\.2',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry72)
    && /stopped partway without being able to say so/.test(entry72) && /you get a push saying so and why/.test(entry72) && !DASH.test(entry72)
    && !HARD.some((re) => re.test(entry72))
    && /version: '7\.1',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry71)
    && /stop partway without saying so/.test(entry71) && !DASH.test(entry71)
    && /version: '7\.0',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry70)
    && /The trade desk is PR 420 now/.test(entry70) && /RUN TRADING DESK/.test(entry70) && /3% risk per trade/.test(entry70)
    && /lights up electric yellow with PROFIT and LOSS/.test(entry70) && /never looks at your history/.test(entry70) && !DASH.test(entry70)
    && (entry70.match(/^\s+'[^\n]+',$/gm) || []).length === 6
    && /version: '6\.13',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry613)
    && /comes back inside a couple of minutes/.test(entry613) && /how long it has been/.test(entry613) && !DASH.test(entry613)
    && /version: '6\.12',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry612)
    && /one step below Update/.test(entry612) && !DASH.test(entry612)
    && /version: '6\.11',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry611)
    && /back at the head of every setup/.test(entry611) && !DASH.test(entry611)
    && /version: '6\.10',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry610)
    && /can look at the market now/.test(entry610) && !DASH.test(entry610)
    && /version: '6\.9',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry69)
    && /at most five bullets/.test(entry69) && /without a new scan/.test(entry69) && !DASH.test(entry69)
    && /version: '6\.8',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry68)
    && /back at the top right of every setup/.test(entry68) && !DASH.test(entry68)
    && /version: '6\.7',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry67)
    && /A setup is one sentence now/.test(entry67) && /Expired setups are off the board/.test(entry67)
    && /a starting point, not the whole hunt/.test(entry67) && /the note again/.test(entry67) && !DASH.test(entry67)
    && (entry67.match(/^\s+'[^\n]+',$/gm) || []).length === 4
    && /version: '6\.6',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry66)
    && /a different number from the risk/.test(entry66) && /never a number of shares/.test(entry66)
    && /can never break Rules to hold/.test(entry66) && !DASH.test(entry66)
    && /version: '6\.5',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry65)
    && /Shares can be fractional now/.test(entry65) && /half a contract is not a thing/.test(entry65) && !DASH.test(entry65)
    && (entry65.match(/^\s+'[^\n]+',$/gm) || []).length === 3
    && /version: '6\.4',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry64)
    && /treated as a failed scan/.test(entry64) && /twice the room to answer/.test(entry64) && !DASH.test(entry64)
    && /version: '6\.3',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry63)
    && /can no longer be lost/.test(entry63) && /It still starts nothing/.test(entry63) && !DASH.test(entry63)
    && /version: '6\.2',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry62)
    && /lands on its own again/.test(entry62) && /which silence it is/.test(entry62) && !DASH.test(entry62)
    && /version: '6\.1',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry61)
    && /looked at from outside/.test(entry61) && !DASH.test(entry61)
    // The window itself: read only, and it says what the flight is doing.
    // RE-PINNED 2026-09-23 (PR 420): no flight any more. It says where the run is, how each of the five
    // researchers did, and what the desk filed, which is what the first real runs have to be read by.
    && /if \(url\.searchParams\.get\('do'\) === 'desk'\) \{/.test(W)
    && /queuedAgeS: age\(run\.queuedAt\), startedAgeS: age\(run\.startedAt\), beatAgeS: age\(run\.heartbeatAt\), finishedAgeS: age\(run\.finishedAt\),/.test(W)
    && /agents: \[1, 2, 3, 4, 5\]\.map\(\(n\) => \{/.test(W) && /morning: \{ day: d\.morningDay \|\| null, ageS: age\(d\.morningAt\) \},/.test(W)
    && /version: '6\.0',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry60)
    && /its own app now/.test(entry60) && /Plays, Positions, News, Stats and Desk/.test(entry60)
    && /question mark is a question/.test(entry60) && /7:00 Mountain/.test(entry60) && !DASH.test(entry60)
    && (entry60.match(/^\s+'[^\n]+',$/gm) || []).length >= 5
    // The page itself: always dark, its own stylesheet token, the three modules it mounts.
    && /<html lang="en" data-scheme="calm" data-desk>/.test(PAGE)
    && /admin\.css\?v=stat122/.test(PAGE) && /nav-menu\.js/.test(PAGE) && /<title>PR 420<\/title>/.test(PAGE)
    && /js\/admin-deskapp\.js/.test(PAGE) && /js\/admin-presence\.js/.test(PAGE) && /js\/version-note\.js/.test(PAGE)
    && (PAGE.match(/<section class="page"/g) || []).length === 3
    && (PAGE.match(/<button data-page="/g) || []).length === 3 && /data-page="trades"[\s\S]*data-page="news"[\s\S]*data-page="history"/.test(PAGE)
    && !DASH.test(PAGE) && !DASH.test(cssApp)
    // RE-PINNED 2026-09-22 (nothing runs but his tap): the 5.3 entry says the clock is gone and what
    // each of the two buttons buys.
    && /version: '5\.3',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry53)
    && /runs on a clock any more/.test(entry53) && /Scan looks only for new entries/.test(entry53) && /Pause is gone/.test(entry53) && !DASH.test(entry53)
    && /version: '5\.2',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry52) && /has a calculator/.test(entry52) && /scalps, intraday and swing/.test(entry52) && /held over a weekend/.test(entry52) && !DASH.test(entry52)
    && /version: '5\.1',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry51) && /no longer asks you anything/.test(entry51) && /yours to dump into/.test(entry51) && !DASH.test(entry51)
    && /version: '4\.9',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry49) && /The trade desk reads again\./.test(entry49) && /non-whitespace text/.test(entry49) && !DASH.test(entry49)
    && /version: '5\.0',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry50) && /📄 link to a real PDF/.test(entry50) && /Uploads page under Reports/.test(entry50) && !DASH.test(entry50)
    && /version: '4\.8',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry48) && (entry48.match(/^\s+'[^\n]+',$/gm) || []).length >= 2
    && /only its own pages/.test(entry48) && /opens on Overview/.test(entry48) && /work clock/.test(entry48) && /Working on line/.test(entry48) && !DASH.test(entry48)
    && /version: '4\.7',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry) && (entry.match(/^\s+'[^\n]+',$/gm) || []).length >= 2
    && /trade desk is a case file/.test(entry) && /Trade log/.test(entry) && /Read page/.test(entry) && /Plays page/.test(entry) && /7:00, 10:00 and noon Mountain/.test(entry)
    && HARD.every((re) => !re.test(CL)) && HARD.every((re) => !re.test(AUTH))
    && !DASH.test(entry) && !DASH.test(DRIVE) && !DASH.test(cssDesk),
    HARD.filter((re) => re.test(CL)).map(String).join(', '));
}

// T37 is retired (2026-09-22, v6.0): the desk left the case folder, so there is no page filter to
// run. What replaced it is T32, which proves the folder hands a desk off and keeps none of its
// furniture, and the new page's own five sections in T36.

// ---- T39 to T42: the desk makes a PDF (Eric, 2026-09-22: "generate PDFs just like LLM in a chat") --------
{
  const dash = String.fromCharCode(0x2014);
  const body = 'Every entry has a stop.\n\n# Sizing\n- Size to the stop, never to the target.\n- No adds to a loser.';
  const h = K.harvestDocument(`Here is the sheet.\n\n<document title="Rules to hold ${dash} v2">\n${body}\n</document>`);
  const none = K.harvestDocument('Just an answer.\n\nPORTFOLIO TOTAL: $2,410.00 (2026-09-22)');
  const untitled = K.harvestDocument('<document>\nA line.\n</document>');
  const open = K.harvestDocument('Answer.\n\n<document title="Half">\nA line that never closes.');
  const fenced = K.harvestDocument('Sheet.\n\n```\n<document title="Fenced">\nInside.\n</document>\n```');
  const after = K.harvestDocument('Answer.\n\nPORTFOLIO TOTAL: $2,410.00 (2026-09-22)\n\n<document title="Plan">\nThe plan.\n</document>');
  const pf = K.portfolioLineOf(after.text);
  const long = K.harvestDocument(`<document title="Long">\n${'x'.repeat(40_000)}\n</document>`);
  const empty = K.harvestDocument('<document title="Empty">\n\n</document>');
  // NEGATIVE CONTROL (run 2026-09-22): the block left in the text (`const rest = t.trim();`) made this read
  //   FAIL  T39 harvestDocument RUNS: the block is cut out whole and the answer keeps its words, the title loses its dash, the body keeps its headings and bullets, no block leaves the text untouched, no title gets the default, an unclosed block loses its tag and keeps its words, a fenced block is tolerated, a block after the PORTFOLIO line still lets the line parse, a 40k body is cut to 30k, and an empty block is no document
  check('T39 harvestDocument RUNS: the block is cut out whole and the answer keeps its words, the title loses its dash, the body keeps its headings and bullets, no block leaves the text untouched, no title gets the default, an unclosed block loses its tag and keeps its words, a fenced block is tolerated, a block after the PORTFOLIO line still lets the line parse, a 40k body is cut to 30k, and an empty block is no document',
    h.text === 'Here is the sheet.' && /^Rules to hold/.test(h.doc?.title || '') && !DASH.test(h.doc?.title || '') && h.doc?.body === body && !h.truncated
    && none.doc === null && none.text === 'Just an answer.\n\nPORTFOLIO TOTAL: $2,410.00 (2026-09-22)' && !none.truncated
    && untitled.doc?.title === K.DOC_DEFAULT_TITLE && untitled.doc?.body === 'A line.'
    && open.doc === null && open.truncated === true && open.text === 'Answer.\n\nA line that never closes.'
    && fenced.doc?.title === 'Fenced' && fenced.doc?.body === 'Inside.' && fenced.text === 'Sheet.'
    && after.doc?.title === 'Plan' && pf.portfolio?.totalCents === 241000 && pf.text === 'Answer.'
    && long.doc?.body.length === K.DOC_BODY_MAX && K.DOC_BODY_MAX === 30_000 && K.DOC_TITLE_MAX === 120
    && empty.doc === null && empty.text === '',
    JSON.stringify({ text: h.text, title: h.doc?.title, open: open.text, pf: pf.text }));
}

{
  const e9 = String.fromCharCode(0xE9);
  const rq = String.fromCharCode(0x2019);
  const mid = String.fromCharCode(0xB7);
  const em = String.fromCharCode(0x2014);
  const bullet = String.fromCharCode(0x95);
  const bytes = pdf.textPdf(['Intro line.', '', '# Sizing', `- Caf${e9} ${rq}quote${rq} ${mid} and ${em} dash and an emoji ${String.fromCodePoint(0x1F4C8)} gone`,
    ...Array.from({ length: 90 }, (_, i) => `Line ${i} ` + 'word '.repeat(28))], { title: 'Rules to hold', footer: `Trade desk ${mid} 2026-09-22 ${mid} Ideas, not orders.` });
  const s = Buffer.from(bytes).toString('latin1');
  const xrefAt = Number((s.match(/startxref\n(\d+)\n/) || [])[1]);
  const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((x) => Number(x[1]));
  const offsetsOk = entries.length > 0 && entries.every((off, i) => s.slice(off).startsWith(`${i + 1} 0 obj`));
  const count = Number((s.match(/\/Count (\d+)/) || [])[1]);
  const lengthsOk = [...s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)].every((m) => s.indexOf('\nendstream', m.index + m[0].length) - (m.index + m[0].length) === Number(m[1]));
  const PDFSRC = f('public/js/textpdf.js');
  const HARDW = [/advisor/i, /differential/i, /\bAI\b/, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bOpus\b/i, /\bFable\b/i, /\bthe model\b/i, /\ba model\b/i, /chatbot/i];
  // NEGATIVE CONTROL (run 2026-09-22): every xref offset written one byte off (`offsets.push(out.length + 1)`) made this read
  //   FAIL  T40 the PDF writer RUNS: header to trailer with every object at the offset the table says and every stream as long as it claims, the title at 16 bold, a heading at 10.5 bold, a bullet glyph with the text indented, Latin-1 and the curly quote kept as WinAnsi bytes, the dash a hyphen and the emoji dropped, the footer and Page n of N on every page, and the served module carries no word from the blindness list and no dash
  check('T40 the PDF writer RUNS: header to trailer with every object at the offset the table says and every stream as long as it claims, the title at 16 bold, a heading at 10.5 bold, a bullet glyph with the text indented, Latin-1 and the curly quote kept as WinAnsi bytes, the dash a hyphen and the emoji dropped, the footer and Page n of N on every page, and the served module carries no word from the blindness list and no dash',
    s.startsWith('%PDF-1.4\n') && s.endsWith('%%EOF\n') && offsetsOk && lengthsOk && count >= 2 && (s.match(/\/Type \/Page\b/g) || []).length === count
    && /\/F2 16 Tf [^\n]*\(Rules to hold\) Tj/.test(s) && /\/F2 10\.5 Tf [^\n]*\(Sizing\) Tj/.test(s)
    && s.includes(`(${bullet}) Tj`) && /1 0 0 1 66 [\d.]+ Tm \(Caf/.test(s)
    && s.includes(`Caf${e9} ${String.fromCharCode(0x92)}quote${String.fromCharCode(0x92)} ${mid} and - dash and an emoji gone`)
    && !/[\x96\x97]/.test(s) && !s.includes('?')
    && (s.match(/\(Page \d+ of \d+\) Tj/g) || []).length === count && s.includes(`(Page 1 of ${count}) Tj`) && (s.match(/Ideas, not orders\.\) Tj/g) || []).length === count
    && HARDW.every((re) => !re.test(PDFSRC)) && !DASH.test(PDFSRC),
    `offsets ${offsetsOk}, lengths ${lengthsOk}, count ${count}, objects ${entries.length}`);
}

{
  const { w, api } = world();
  const filed = await api.fileDocument({}, 'c1', { title: 'Rules to hold', body: 'Every entry has a stop.\n- Size to the stop.' }, { now: 1758500000000 });
  await api.fileDocument({}, 'c1', { title: 'Q3 plan / what? (draft)', body: 'x' }, { now: 1758500000001 });
  const put = w.puts[0];
  const meta = w.metas[0];
  const bad = world({ putFails: true });
  let failed = null;
  try { await bad.api.fileDocument({}, 'c1', { title: 'Nope', body: 'x' }); } catch (e) { failed = e; }
  // NEGATIVE CONTROL (run 2026-09-22): the download token dropped from the metadata patch made this read
  //   FAIL  T41 fileDocument RUNS: the PDF lands in the case's report folder under the stamp and the title, as application/pdf and real bytes, the token and the display name are patched onto it, the descriptor carries the leaf name, the path, the size, a date and the token URL, a title with slashes and question marks files under a plain name, and a failed put throws and patches nothing
  check('T41 fileDocument RUNS: the PDF lands in the case\'s report folder under the stamp and the title, as application/pdf and real bytes, the token and the display name are patched onto it, the descriptor carries the leaf name, the path, the size, a date and the token URL, a title with slashes and question marks files under a plain name, and a failed put throws and patches nothing',
    w.puts.length === 2 && put.path === 'cases/c1/report/1758500000000-Rules to hold.pdf' && put.contentType === 'application/pdf'
    && Buffer.from(put.bytes.subarray(0, 8)).toString('latin1') === '%PDF-1.4'
    && meta.path === put.path && meta.custom.firebaseStorageDownloadTokens === 'uuid-new-desk' && meta.custom.paName === 'Rules to hold.pdf'
    && filed.name === 'Rules to hold.pdf' && filed.path === put.path && filed.size === put.bytes.byteLength && filed.at instanceof Date
    && filed.url === `https://firebasestorage.googleapis.com/v0/b/bucket.appspot.com/o/${encodeURIComponent(put.path)}?alt=media&token=uuid-new-desk`
    && w.puts[1].path === 'cases/c1/report/1758500000001-Q3 plan what draft.pdf' && K.safeDocName('') === K.DOC_DEFAULT_TITLE
    && failed instanceof Error && bad.w.metas.length === 0 && bad.w.puts.length === 0,
    JSON.stringify({ path: put?.path, meta: meta?.custom, url: filed?.url }));
}

{
  const fin = lift(ADV, 'async function finishQuestion(env, kind, id, qaId, flight, message) {');
  // NEGATIVE CONTROL (run 2026-09-22): `download=` dropped from the panel's link made this read
  //   FAIL  T42 the desk files the document: the block is cut before the term harvest and after the answer is read, the file is made after the portfolio line inside the desk's branch, the answer says Filed as and the row carries doc in its mask, a failed file keeps the words in the answer and both outcomes are logged; the panel hangs the link under a landed answer, tells the Uploads page once when a new one arrives and the page listens; the link wears the green at thumb size; the demo builds a real file with the shared writer on a document question and files it; the showcase imports the writer and no longer keeps one; the audit reads the served module and the gate leaves it public; and the drive asks for one
  check('T42 the desk files the document: the block is cut before the term harvest and after the answer is read, the file is made after the portfolio line inside the desk\'s branch, the answer says Filed as and the row carries doc in its mask, a failed file keeps the words in the answer and both outcomes are logged; the panel hangs the link under a landed answer, tells the Uploads page once when a new one arrives and the page listens; the link wears the green at thumb size; the demo builds a real file with the shared writer on a document question and files it; the showcase imports the writer and no longer keeps one; and the audit reads the served module and the gate leaves it public',
    /const hd = trade \? harvestDocument\(answer\) : \{ text: answer, doc: null \};\n\s+let filed = null;/.test(fin)
    && /let cleaned = await harvestKeyTerms\(env, hd\.text, \{/.test(fin)
    && fin.indexOf('const answer = extractText(message);') < fin.indexOf('harvestDocument(answer)') && fin.indexOf('harvestDocument(answer)') < fin.indexOf('harvestKeyTerms(env, hd.text')
    && fin.indexOf('const pf = portfolioLineOf(cleaned);') < fin.indexOf('fileDocument(env, id, hd.doc') && fin.indexOf('fileDocument(env, id, hd.doc') < fin.indexOf('if (override) {')
    && /if \(hd\.doc\) \{\n\s+const d0 = Date\.now\(\);\n\s+try \{\n\s+filed = await fileDocument\(env, id, hd\.doc, \{ now: Date\.now\(\) \}\);\n\s+cleaned = `\$\{cleaned\}\\n\\nFiled as \$\{filed\.name\} on Uploads\.`;/.test(fin)
    && /ev: 'ask-doc', ok: true, bytes: filed\.size/.test(fin) && /ev: 'ask-doc', ok: false/.test(fin)
    && /cleaned = `\$\{cleaned\}\\n\\n# \$\{hd\.doc\.title\}\\n\\n\$\{hd\.doc\.body\}\\n\\nThe file could not be made, so the document is here instead\.`;/.test(fin)
    && /answer: cleaned, status: 'done', override, batch: null, doc: filed,\n\s+\}, \{ mask: \['answer', 'status', 'override', 'batch', 'doc'\] \}\);/.test(fin)
    // RE-PINNED 2026-09-23 (PR 420): the import lost the alias the scan's finish used; the two it needs stay.
    // NEGATIVE CONTROL (run 2026-09-23): the import's `harvestDocument, fileDocument,` swapped to `fileDocument, harvestDocument,` made this read
    //   FAIL  T42 the desk files the document: ...
    && /harvestDocument, fileDocument,\n\} from '\.\/trade-desk\.js';/.test(ADV)
    && /const docLink = \(q\) => \(q\.doc\?\.url\n\s+\? `<p class="ask-doc"><a href="\$\{esc\(q\.doc\.url\)\}" target="_blank" rel="noopener" download="\$\{esc\(q\.doc\.name \|\| 'document\.pdf'\)\}">📄 \$\{esc\(q\.doc\.name \|\| 'document\.pdf'\)\}<\/a><\/p>`/.test(PANEL)
    && /\$\{q\.status === 'running' \? '' : docLink\(q\)\}<\/div>/.test(PANEL)
    && /if \(docsPrimed\) document\.dispatchEvent\(new CustomEvent\('pa-saved-file'\)\);/.test(PANEL) && /docsPrimed = true;/.test(PANEL)
    && /addEventListener\('pa-saved-file'/.test(CASE)
    && /\.ask-doc a \{ display: inline-flex; align-items: center; gap: \.4rem; min-height: 44px;[^\n]*border: 1px solid var\(--trade\);/.test(CSS)
    && /import \{ textPdf \} from '\.\.\/textpdf\.js';/.test(D) && /\/\\b\(pdf\|document\|sheet\|playbook\|checklist\|write\.\?up\|print\)\\b\/i\.test\(d\.question \|\| ''\)/.test(D)
    && /const bytes = textPdf\(lines, \{ title: 'Rules to hold', footer:/.test(D) && /store\.files\.set\(path, \{ name: 'Rules to hold\.pdf', type: 'application\/pdf', size: bytes\.length, at, url, persisted: true \}\);/.test(D)
    && /Filed as Rules to hold\.pdf on Uploads\./.test(D) && /\.\.\.\(doc \? \{ doc \} : \{\}\) \}\);/.test(D)
    && /import \{ textPdf \} from '\.\.\/public\/js\/textpdf\.js';/.test(SHOW) && !/export function textPdf/.test(SHOW)
    && /import \{ textPdf \} from '\.\.\/public\/js\/textpdf\.js';/.test(TD) && /import \{ BUCKET, putFile, patchObjectMeta \} from '\.\/storage\.js';/.test(TD)
    && /'\/js\/textpdf\.js',/.test(AUDIT)
    // RE-PINNED 2026-09-23 (PR 420): the desk's page asks nothing, so the drive can no longer ask it for a
    // document; the writer, the filing and the demo's real bytes above are what stand for it now.
    && !/Make me a one page PDF/.test(DRIVE),
    JSON.stringify({ fin: fin.length, order: [fin.indexOf('harvestDocument(answer)'), fin.indexOf('harvestKeyTerms(env, hd.text'), fin.indexOf('fileDocument(env, id, hd.doc')] }));
}

// ---- T43: the desk asks him nothing (Eric, 2026-09-22: "Questions in the chat are unnecessary") -------
{
  const qFn = lift(ADV, 'function harvestQuestions(text) {');
  const unFn = lift(ADV, 'function unansweredFromChat(rows) {');
  const secFn = lift(ADV, 'function sectionMatch(text, name) {');
  const flatLine = grab(ADV, /const flatText = [^\n]+/);
  const api = new Function(`${secFn}\n${flatLine}\n${qFn}\n${unFn}\nreturn { harvestQuestions, unansweredFromChat };`)();
  const reading = grab(SEED, /const TRADE_READING = `[\s\S]*?`;/);
  const withSection = 'body\n\n## Questions for you\n- What size were you working with on SPY that morning?\n';
  const rows = [
    { id: 'q1', data: { role: 'question', text: 'Why no stop on the AMD calls?', ts: new Date('2026-09-20T15:00:00Z') } },
    { id: 'q2', data: { role: 'question', text: 'Answered one', ts: new Date('2026-09-20T15:00:00Z'), answeredAt: new Date() } },
    { id: 'm1', data: { role: 'admin', text: 'AAPL long 40 shares.' } },
  ];
  const finish = lift(ADV, 'async function finishAnalysis(env, kind, id, ctx, message) {');
  // NEGATIVE CONTROL (run 2026-09-22): the `!ctx.trade` dropped from the askInChat gate made this read
  //   FAIL  T43 the desk asks him nothing: the harvest still reads a question section wherever one appears, so the gate is what protects the log, and the gate is on the desk at the one site that writes into it; the desk's unanswered list is emptied rather than carried; the seeded desk reading carries no question section; the panel's chat hint is off the desk; the folder has no Track row and the demo mirror asks on his own case only
  check('T43 the desk asks him nothing: the harvest still reads a question section wherever one appears, so the gate is what protects the log, and the gate is on the desk at the one site that writes into it; the desk\'s unanswered list is emptied rather than carried; the seeded desk reading carries no question section; the panel\'s chat hint is off the desk; the folder has no Track row and the demo mirror asks on his own case only',
    api.harvestQuestions(withSection).length === 1 && api.harvestQuestions(reading).length === 0
    && !/## Questions for you/.test(reading)
    && api.unansweredFromChat(rows).length === 1 && api.unansweredFromChat(rows)[0].ask === 'Why no stop on the AMD calls?'
    && /if \(ctx\.self && !ctx\.trade && kind === 'case'\) \{\n\s+await askInChat\(env, id, harvestQuestions\(finalText\), rows\)/.test(finish)
    && /if \(ctx\.trade\) \{\n\s+un\.unanswered = \[\];\n\s+\} else if \(ctx\.self\) \{/.test(finish)
    && finish.indexOf('const un = harvestUnanswered(tr.text, p.unanswered);') < finish.indexOf('if (ctx.trade) {\n    un.unanswered = [];')
    // RE-PINNED 2026-09-22 (v6.0): the desk left the folder, so the panel's hint is back to one
    // condition and the folder has no desk clause left to carry.
    && /\$\{self && normTitle\(pg\.title\) === normTitle\('Questions for you'\)/.test(PANEL)
    && !/DESK_GROUPS/.test(CASE)
    && /if \(c\.self && !c\.trade && !asked\) \{/.test(D)
    // RE-PINNED 2026-09-23 (PR 420): the demo's desk has no reading and no log at all now, so the seeded
    // reading this check read is gone rather than merely free of a question section.
    // NEGATIVE CONTROL (run 2026-09-23): `const TRADE_READING = '';` added back to the seed made this read
    //   FAIL  T43 the desk asks him nothing: ...
    && !/TRADE_READING/.test(SEED) && reading === '',
    JSON.stringify({ found: api.harvestQuestions(withSection), inReading: api.harvestQuestions(reading).length, un: api.unansweredFromChat(rows).length }));
}

// ---- T57 USED TO RUN THE CRON'S SCAN COLLECTOR (v6.3) ------------------------------------------
// RE-PINNED 2026-09-23 (PR 420): there is no scan left to collect. The cron's desk work is the 7:00
// run it queues and the queued run it hosts (T30, and desk.mjs for both), so what stands here is that
// nothing of the scan's collection is left on the desk's routes or the Worker.
// NEGATIVE CONTROL (run 2026-09-23): `export async function maybeCollectScan() { return null; }` added back to trade.js made this read
//   FAIL  T57 the scan collector is gone ...
check('T57 the scan collector is gone: the desk\'s routes export no collector, no morning reading and no scan block, nothing in the Worker or the advisor names one, and the firing\'s only desk calls are the run it queues at 7:00 and the queued run it hosts',
  K.maybeCollectScan === undefined && K.maybeMorningRead === undefined && K.scanBlock === undefined
  && !/maybeCollectScan|maybeMorningRead|scanBlock|pollScanFlight|runTradeScan|runTradeLook|finishTradeScan/.test(T + W + ADV)
  && (W.match(/maybeRunDesk\(|maybeMorningRun\(/g) || []).length === 2);

// ---- T59 to T62 (PR 420) ------------------------------------------------------------------
// RE-PINNED 2026-09-23 (PR 420): the position sheet and its dollars-or-shares chip, the play card's one
// sentence and the five-bullet note all left with the pages that drew them. What each stood for is on
// the one card now: the dollars and the count together (T59), sized by his 3% rule against the desk's
// allocation (T60), in words that fit a phone at a glance (T61), with the desk's one line in place of
// the note (T62).
{
  const mod = await import('../../public/js/admin-desk.js');
  const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const base = { id: 'q', ticker: 'F', side: 'long', horizon: 'intraday', instrument: 'stock', entryLow: 50, entryHigh: 50, stop: 49, targets: [52], allocPct: 50, status: 'open' };
  const whole = text(mod.recCardHtml(base, { accountCents: 100000, rules: { riskPct: 3 } }));
  const frac = text(mod.recCardHtml({ ...base, entryLow: 247.5, entryHigh: 248, stop: 245.8, allocPct: 40 }, { accountCents: 245000, rules: { riskPct: 3 } }));
  const two = text(mod.recCardHtml({ ...base, instrument: 'call', strike: 50, expiry: '2026-10-16', entryLow: 1, entryHigh: 1, stop: 0.9, targets: [1.5], allocPct: 25 }, { accountCents: 100000, rules: { riskPct: 3 } }));
  const PAGE = f('public/admin-desk.html'); const APP = f('public/js/admin-deskapp.js');
  // NEGATIVE CONTROL (run 2026-09-23): qtyText's `Math.round(sz.shares * 10000) / 10000` changed to `Math.round(sz.shares)` made this read
  //   FAIL  T59 the card says what to put in ...
  check('T59 the card says what to put in both ways at once: the dollars beside the share count, a fraction to four places, a whole count bare, and contracts whole and plural; and the page has no position sheet, no quantity field and no chip',
    /Amount \$500 · 10 shares/.test(whole) && /Amount \$980 · 3\.9516 shares/.test(frac) && /Amount \$200 · 2 contracts/.test(two)
    && !/data-unit|qtyf|id="np-|openPositionSheet|sharesForDollars/.test(PAGE + APP),
    JSON.stringify({ whole: whole.slice(0, 120), two: two.slice(0, 120) }));

  const S = (rec, a = 245000, riskPct = 3) => math.recSizing({ rec: { side: 'long', instrument: 'stock', ...rec }, accountCents: a, rules: { riskPct } });
  const stock = S({ entryLow: 247.5, entryHigh: 248, stop: 245.8, targets: [251, 253.5], allocPct: 40 });
  const capped = S({ entryLow: 247.5, entryHigh: 248, stop: 200, targets: [300], allocPct: 50 });
  const onePct = S({ entryLow: 247.5, entryHigh: 248, stop: 200, targets: [300], allocPct: 50 }, 245000, 1);
  const call = S({ instrument: 'call', entryLow: 2.05, entryHigh: 2.2, stop: 1.6, targets: [2.9], allocPct: 12 });
  const over = S({ instrument: 'call', entryLow: 2.05, entryHigh: 2.2, stop: 0.2, targets: [2.9], allocPct: 30 });
  const short = S({ side: 'short', entryLow: 100, entryHigh: 100, stop: 102, targets: [96, 94], allocPct: 10 }, 1000000);
  const noEntry = S({ stop: 1, targets: [2] });
  const noMoney = S({ entryLow: 10, entryHigh: 10, stop: 9, targets: [12], allocPct: 10 }, 0);
  // NEGATIVE CONTROL (run 2026-09-23): recSizing's `out.overRule = whole && ...` answered `out.overRule = false` made this read
  //   FAIL  T60 recSizing RUNS ...
  // RE-PINNED 2026-09-23 (review): sized from the worst fill in the zone, the top for a buy and the bottom for a
  // short, so a fill anywhere in the zone stays inside his rule; and 3% when no rule is handed in.
  check('T60 recSizing RUNS with his 3% rule: the entry is the worst fill in the zone; the allocation and the rule each allow a size and the smaller wins, marked capped when the rule does; a share is sized to four places and a contract whole; the risk and both rewards are in dollars with the R:R; 1% instead of 3% sizes a third as much; a contract the rule cannot carry is flagged over the rule; a short earns as the price falls; no entry or no balance sizes nothing; and the desk\'s default rule is 3% unless he set one between 0.1 and 5',
    stock.entry === 248 && stock.budgetCents === 7350 && stock.qty === 3.9516 && stock.shares === 3.9516 && stock.capped === false
    && stock.costCents === 98000 && stock.riskCents === 869 && stock.rewardCents === 1185 && stock.reward2Cents === 2173 && stock.rr === 1.36
    && capped.capped === true && capped.qty === 1.5313 && Math.abs(capped.riskCents - 7350) <= 1
    && Math.abs(onePct.qty * 3 - capped.qty) < 0.001 && onePct.budgetCents === 2450
    && call.contracts === 1 && call.costCents === 22000 && call.riskCents === 6000 && call.rewardCents === 7000 && call.rr === 1.17
    && over.qty === 0 && over.contracts === 0 && over.overRule === true && over.unitRiskCents === 20000
    && math.recSizing({ rec: { side: 'short', instrument: 'stock', entryLow: 99, entryHigh: 100, stop: 102, targets: [96], allocPct: 10 }, accountCents: 1000000, rules: { riskPct: 3 } }).entry === 99
    && math.recSizing({ rec: { side: 'long', instrument: 'stock', entryLow: 10, entryHigh: 10, stop: 5, targets: [20], allocPct: 50 }, accountCents: 100000 }).budgetCents === 3000
    && short.rewardCents > 0 && short.reward2Cents > short.rewardCents && short.riskCents > 0
    && noEntry.qty === null && noMoney.qty === null
    && DR.riskPctOf({}) === 3 && DR.riskPctOf({ riskPct: 2.5 }) === 2.5 && DR.riskPctOf({ riskPct: 9 }) === 3 && DR.riskPctOf({ riskPct: 0.05 }) === 3
    && DR.DEFAULT_RISK_PCT === 3,
    JSON.stringify({ stock, capped: [capped.qty, capped.riskCents], call: [call.contracts, call.riskCents], over: over.overRule }));

  const long = 'word '.repeat(80).trim();
  const T0 = { ticker: 'NVDA', side: 'long', horizon: 'intraday', instrument: 'stock', entryLow: 10, entryHigh: 10.2, stop: 9.5, targets: [11], setup: long, catalyst: long, invalidation: long, chanceLow: 55, chanceHigh: 60 };
  const clipped = DR.validRec(T0, { accountType: 'cash' });
  const noSetup = DR.validRec({ ...T0, setup: '' }, { accountType: 'cash' });
  const deskPrompt = DR.deskSystem('cash', 3);
  // NEGATIVE CONTROL (run 2026-09-23): validRec's `clip(t.setup, 220)` loosened to `clip(t.setup, 2200)` made this read
  //   FAIL  T61 what he reads fits a phone card ...
  check('T61 what he reads fits a phone card at a glance: the desk is told one sentence under 25 words for the setup, 15 for the catalyst and 20 for what kills it, in plain English with no dash; whatever comes back is cut to 220, 140 and 180 characters before it is filed; and a trade with no setup at all is not filed',
    /setup is one sentence under 25 words, catalyst under 15 words, invalidation under 20 words/.test(deskPrompt)
    && /Plain English with no jargon he would have to decode, and never an em dash or an en dash/.test(deskPrompt)
    && clipped.setup.length <= 220 && clipped.catalyst.length <= 140 && clipped.invalidation.length <= 180
    && clipped.setup.length > 150 && noSetup === null,
    JSON.stringify({ setup: clipped?.setup.length, catalyst: clipped?.catalyst.length, invalidation: clipped?.invalidation.length }));

  const st = await (async () => {
    const { w, api } = world();
    w.docs.set('trade/settings', { data: { caseId: 'c1' } });
    w.docs.set('trade/state', { data: { desk: { at: new Date(), ids: [], read: 'x'.repeat(10), none: 'Nothing clean.' }, scanNote: { text: '## Note\n\nOld wall.' } }, updateTime: 'T1' });
    return api.tradeState(env, { now: Date.now() });
  })();
  // NEGATIVE CONTROL (run 2026-09-23): `<div class="panel say" id="note"></div>` added back to the page made this read
  //   FAIL  T62 the note is gone ...
  check('T62 the note is gone from the desk: the state carries no note even when an old one is stored, the page has no note panel and the demo stores none; the desk\'s one line on the tape and its one line on why there are no trades stand in its place, clipped to 240 characters',
    !('scan' in st) && !('note' in st) && st.desk.read === 'x'.repeat(10) && st.desk.none === 'Nothing clean.'
    && !/id="note"|note-p|noteBullets/.test(PAGE + APP + D)
    && /read: clip\(out\?\.read, 240\), none: clip\(out\?\.none, 240\)/.test(f('worker/desk-run.js'))
    && /\$\('#deskread-t'\)\.textContent = read;/.test(APP),
    JSON.stringify({ desk: st.desk }));
}

// ---- T56: a scan marker is never mistaken for a reading (Eric, 2026-09-22: "It's not producing a scan rn") ----
// RE-PINNED 2026-09-23 (PR 420): no scan writes a marker any more, but one left in the queue from before
// PR 420 must still never reach the claim that would count it as a reading that will not start. Both
// sweepers now delete it at the same place the old branch stood, above the claim and the case poll.
// NEGATIVE CONTROL (run 2026-09-23): the drain's scan branch's deleteDoc replaced with `void 0;` made this read
//   FAIL  T56 a leftover scan marker ...
{
  const drain = lift(ADV, 'export async function runQueuedAnalyses(env, deadlineAt = 0) {');
  const now2 = lift(ADV, 'export async function pollFlightsNow(env) {');
  const del = 'await deleteDoc(env, `advisorQueue/${row.id}`).catch(() => {});';
  check('T56 a leftover scan marker is never mistaken for a reading: both sweepers delete it before anything else can judge it, the drain above the draft rescue and the claim, the poller above the case poll, and neither reaches for a scan flight',
    drain.length > 500 && now2.length > 100
    && /if \(row\.data\.scan\) \{\n\s+await deleteDoc\(env, `advisorQueue\/\$\{row\.id\}`\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}/.test(drain)
    && drain.indexOf('if (row.data.scan) {') < drain.indexOf('if (row.data.draft)')
    && /if \(row\.data\.scan\) \{\n\s+await deleteDoc\(env, `advisorQueue\/\$\{row\.id\}`\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}\n\s+await pollCaseFlight\(env, kind, id, \{ minAgeMs: 45_000 \}\)/.test(now2)
    && drain.includes(del) && now2.includes(del) && !/pollScanFlight|SCAN_MARKER/.test(drain + now2 + ADV),
    JSON.stringify({ drain: drain.length, now2: now2.length }));
}

// ---- T44 to T49: the calculator (Eric, 2026-09-22: "a calculator to help me with take profits and stop losses") ----
{
  const R = math.defaultRules();
  const clamped = math.rulesOf({ rules: { riskPct: 99, dayLossPct: 0.01, targetR: 2.5 } });
  const bad = math.rulesOf({ rules: { dayFloorPct: 9, dayAimPct: 2, dayCapPct: 10 } });
  const weekEnd = math.lastTradingDayOfWeek('2026-09-23');
  // NEGATIVE CONTROL (run 2026-09-22): `swingLastDay` returning `d` without the week-end clamp made this read
  //   FAIL  T44 the rules and the three kinds of trade: the defaults are 1% a trade, a 3% day loss, a 1% floor, a 2% aim, a 10% cap and 2R; a rule out of range is clamped and a floor above the aim falls back to all three; the market opens at 07:30 and closes at 14:00 on his clock, 11:00 on an early close; a hold of ten minutes is a scalp, three hours intraday, a day and a half swing; and a swing never runs past the last close of its week
  check('T44 the rules and the three kinds of trade: the defaults are 1% a trade, a 3% day loss, a 1% floor, a 2% aim, a 10% cap and 2R; a rule out of range is clamped and a floor above the aim falls back to all three; the market opens at 07:30 and closes at 14:00 on his clock, 11:00 on an early close; a hold of ten minutes is a scalp, three hours intraday, a day and a half swing; and a swing never runs past the last close of its week',
    R.riskPct === 1 && R.dayLossPct === 3 && R.dayFloorPct === 1 && R.dayAimPct === 2 && R.dayCapPct === 10 && R.targetR === 2
    && clamped.riskPct === 5 && clamped.dayLossPct === 0.5 && clamped.targetR === 2.5
    && bad.dayFloorPct === 1 && bad.dayAimPct === 2 && bad.dayCapPct === 10
    && math.isMarketOpen({ dateKey: '2026-09-22', minuteOfDay: 450 }) === true && math.isMarketOpen({ dateKey: '2026-09-22', minuteOfDay: 449 }) === false
    && math.isMarketOpen({ dateKey: '2026-09-22', minuteOfDay: 840 }) === false && math.isMarketOpen({ dateKey: '2026-11-27', minuteOfDay: 700 }) === false
    && math.isMarketOpen({ dateKey: '2026-09-26', minuteOfDay: 600 }) === false
    && math.horizonFor(10) === 'scalp' && math.horizonFor(180) === 'intraday' && math.horizonFor(2000) === 'swing'
    && math.HORIZONS.join() === 'scalp,intraday,swing' && math.horizonOf('swing') === 'swing' && math.horizonOf('day') === null
    && weekEnd === '2026-09-25' && math.swingLastDay('2026-09-23', 3) === '2026-09-25' && math.swingLastDay('2026-09-21', 2) === '2026-09-23',
    JSON.stringify({ clamped, bad, weekEnd }));
}

{
  const R = math.defaultRules();
  const stock = { ticker: 'AAPL', side: 'long', instrument: 'stock', horizon: 'intraday', qty: 34, entry: 231.10, stop: 230.40, target: 233 };
  const short = { ticker: 'TSLA', side: 'short', instrument: 'stock', horizon: 'scalp', qty: 25, entry: 412.10, stop: 414, target: 405 };
  const call = { ticker: 'SPY', side: 'long', instrument: 'call', horizon: 'swing', qty: 2, entry: 4.20, stop: 2.80 };
  const callNoStop = { ...call, stop: null };
  const debit = { ticker: 'NVDA', side: 'long', instrument: 'spread', qty: 1, entry: 2.10, stop: 1.30, width: 5 };
  const credit = { ticker: 'SPY', side: 'short', instrument: 'spread', credit: true, qty: 1, entry: 1.20, width: 5 };
  const naked = { ticker: 'SPY', side: 'short', instrument: 'call', qty: 1, entry: 3 };
  const lad = math.ladder({ side: 'long', entry: 231.10, stop: 230.40 });
  const ladShort = math.ladder({ side: 'short', entry: 412.10, stop: 414 });
  // NEGATIVE CONTROL (run 2026-09-22): the option multiplier dropped from unitRisk (`* M` removed on the long branch) made this read
  //   FAIL  T45 the risk of one share or one contract, the ladder and the size his rule allows: ...
  check('T45 the risk of one share or one contract, the ladder and the size his rule allows: a stock risks the distance to the stop, a long option its premium or the distance to a stop premium, a debit spread its debit, a credit spread the width less the credit, and a naked short option is not capped; the ladder runs the right way for a long and a short; and the size is the budget over the risk, exactly for a stock and rounded down for a contract, zero when one contract is already over; a share can be held in pieces and a contract cannot, dollars convert to shares and back, and a fraction of a share earns a fraction of the move',
    math.unitRisk(stock) === 0.7 && math.unitRisk(short) === 1.9
    && math.unitRisk(call) === 140 && math.unitRisk(callNoStop) === 420
    && math.unitRisk(debit) === 80 && math.unitRisk(credit) === 380 && math.unitRisk(naked) === null
    && lad.r === 0.7 && lad.breakeven === 231.10 && lad.levels.map((l) => l.price).join() === '231.8,232.5,233.2'
    && ladShort.levels.map((l) => l.price).join() === '410.2,408.3,406.4'
    // RE-PINNED 2026-09-22 (v6.5, fractional shares): a share can be bought in pieces, so a stock
    // takes the budget EXACTLY rather than rounding down and leaving 0.1428 of the rule unspent.
    // A contract cannot be split, so it still rounds down and one already over the budget is zero.
    // NEGATIVE CONTROL (run 2026-09-22, v6.5): sizeFor's stock arm removed, so everything rounded
    //   down again, made this read    FAIL  T45 the risk of one share or one contract ...
    // NEGATIVE CONTROL (run 2026-09-22, v6.5): qtyOf's stock arm removed, so a share could not be
    //   held in pieces, made this read    FAIL  T45 the risk of one share or one contract ...
    && math.sizeFor({ accountCents: 400000, rules: R, pos: stock }).qty === 57.1429
    && math.sizeFor({ accountCents: 400000, rules: R, pos: call }).qty === 0
    && math.sizeFor({ accountCents: 400000, rules: R, pos: naked }).qty === null
    // The quantity itself, read the way every arithmetic site reads it.
    && math.qtyOf({ instrument: 'stock', qty: 17.26923 }) === 17.2692
    && math.qtyOf({ instrument: 'call', qty: 2.9 }) === 2
    && math.qtyOf({ instrument: 'stock', qty: 0 }) === 0 && math.qtyOf({ instrument: 'stock', qty: -3 }) === 0
    && math.qtyOf({}) === 0 && math.qtyOf(null) === 0
    // Dollars in, shares out, and back again.
    // Four places is the limit, so the trip back can land a cent away from where it started. That
    // is the rounding being honest rather than a bug: 500 buys 2.1844 shares, which cost 500.01.
    && math.sharesForDollars(500, 228.9) === 2.1844 && math.dollarsForShares(2.1844, 228.9) === 500.01
    && math.sharesForDollars(500, 0) === null && math.sharesForDollars(0, 228.9) === null
    && math.dollarsForShares(17.2692, 228.9) === 3952.92
    && math.fmtQty(17) === '17' && math.fmtQty(17.2692) === '17.2692' && math.fmtQty(17.00) === '17'
    && math.fmtQty(0) === '0' && math.fmtQty(null) === '0' && math.QTY_DP === 4
    // A fraction of a share earns a fraction of the move, to the cent.
    && math.closePnl({ pos: { ...stock, qty: 0.5 }, exitPrice: 232.60 }) === 75
    && math.closePnl({ pos: stock, exitPrice: 232.60 }) === 5100
    && math.closePnl({ pos: short, exitPrice: 409.80 }) === 5750
    && math.closePnl({ pos: call, exitPrice: 6.50 }) === 46000
    && math.closePnl({ pos: credit, exitPrice: 0.40 }) === 8000,
    JSON.stringify({ stock: math.unitRisk(stock), call: math.unitRisk(call), credit: math.unitRisk(credit), qty: math.sizeFor({ accountCents: 400000, rules: R, pos: stock }).qty }));
}

{
  const R = math.defaultRules();
  const A = 400000;
  const pos = { ticker: 'AAPL', side: 'long', instrument: 'stock', horizon: 'intraday', qty: 34, entry: 231.10, stop: 230.40, target: 233, openedDay: '2026-09-22' };
  const quote = { ticker: 'AAPL', last: 232.60, high: 233.20, low: 230.60, prevClose: 231.10 };
  const c = math.tradeCalc({ pos, rules: R, accountCents: A, quote, todayKey: '2026-09-22', accountType: 'margin' });
  const over = math.tradeCalc({ pos: { ...pos, qty: 400 }, rules: R, accountCents: A, todayKey: '2026-09-22', accountType: 'margin' });
  const noStop = math.tradeCalc({ pos: { ...pos, stop: null }, rules: R, accountCents: A, todayKey: '2026-09-22', accountType: 'margin' });
  const wrong = math.tradeCalc({ pos: { ...pos, stop: 232 }, rules: R, accountCents: A, todayKey: '2026-09-22', accountType: 'margin' });
  const cash = math.tradeCalc({ pos, rules: R, accountCents: A, todayKey: '2026-09-22', accountType: 'cash' });
  const stale = math.tradeCalc({ pos: { ...pos, openedDay: '2026-09-21' }, rules: R, accountCents: A, todayKey: '2026-09-22', accountType: 'margin' });
  const weekend = math.tradeCalc({ pos: { ...pos, horizon: 'swing' }, rules: R, accountCents: A, todayKey: '2026-09-25', accountType: 'margin' });
  const noise = math.tradeCalc({ pos: { ...pos, stop: 230.95 }, rules: R, accountCents: A, quote, todayKey: '2026-09-22', accountType: 'margin' });
  const shortCall = math.tradeCalc({ pos: { ticker: 'SPY', side: 'short', instrument: 'call', qty: 1, entry: 3 }, rules: R, accountCents: A, todayKey: '2026-09-22', accountType: 'margin' });
  // NEGATIVE CONTROL (run 2026-09-22): the noise threshold tightened from a quarter of today's range to a twentieth made this read
  //   FAIL  T46 what a card shows RUNS: the risk in dollars and as a share of the account, what the rule allows, the cost and its share, the ladder, the target as an R multiple with its reward, the distance from the entry and from the last price, the unrealized figure, today's range off the quote, and one warning for each thing worth saying
  check('T46 what a card shows RUNS: the risk in dollars and as a share of the account, what the rule allows, the cost and its share, the ladder, the target as an R multiple with its reward, the distance from the entry and from the last price, the unrealized figure, today\'s range off the quote, and one warning for each thing worth saying',
    // RE-PINNED 2026-09-22 (v6.5, fractional shares): the size a stock's rule allows is exact now.
    // NEGATIVE CONTROL (run 2026-09-22, v6.5): tradeCalc's `qtyOf(pos)` put back to a floor, so
    //   half a share carried no risk at all, made this read    FAIL  T46 what a card shows RUNS ...
    c.riskCents === 2380 && c.riskPct === 0.0060 && c.budgetCents === 4000 && c.suggestedQty === 57.1429
    // A fraction of a share carries its fraction of the risk, the cost and the unrealized figure.
    && math.tradeCalc({ pos: { ...pos, qty: 0.5 }, rules: R, accountCents: A, quote }).riskCents === 35
    && math.tradeCalc({ pos: { ...pos, qty: 0.5 }, rules: R, accountCents: A, quote }).positionCents === 11555
    && math.tradeCalc({ pos: { ...pos, qty: 0.5 }, rules: R, accountCents: A, quote }).unrealizedCents === 75
    && c.positionCents === 785740 && c.rr === 2.71 && c.rewardCents === 6460 && c.target === 233
    && c.last === 232.60 && c.unrealizedCents === 5100
    && c.distances.stopFromEntry.dollars === -0.7 && c.distances.targetFromLast.dollars === 0.4
    && c.todaysRange.high === 233.20 && c.todaysRange.low === 230.60
    && c.warnings.length === 1 && c.warnings[0] === 'position-over-half'
    && over.warnings.includes('risk-over-rule') && noStop.warnings.includes('no-stop') && wrong.warnings.includes('stop-wrong-side')
    && cash.warnings.includes('cash-t1') && stale.warnings.includes('day-past-close') && weekend.warnings.includes('weekend-ahead')
    && noise.warnings.includes('stop-in-noise') && shortCall.warnings.includes('short-option-uncapped') && shortCall.riskCents === null
    && Object.keys(math.WARNING_TEXT).every((k) => math.WARNING_TEXT[k] && !DASH.test(math.WARNING_TEXT[k])),
    JSON.stringify({ risk: c.riskCents, pct: c.riskPct, rr: c.rr, warn: c.warnings }));
}

{
  const R = math.defaultRules();
  const A = 400000;
  const swingOpen = { id: 'p2', status: 'open', horizon: 'swing', riskCents: 3000 };
  const rows = [
    { id: 'p1', status: 'closed', horizon: 'scalp', closedDay: '2026-09-22', pnlCents: 4500 },
    { id: 'p3', status: 'closed', horizon: 'swing', closedDay: '2026-09-21', pnlCents: 9000 },
    swingOpen,
  ];
  const at = (cents) => math.dayStatus({ rules: R, accountCents: A, realizedTodayCents: cents, openRiskCents: math.openRisk(rows) });
  const day = at(math.realizedToday(rows, '2026-09-22'));
  // NEGATIVE CONTROL (run 2026-09-22): the cap test loosened from `>=` to `>` made this read
  //   FAIL  T47 the day against his rules RUNS: the four lines in dollars from the account, the state at a 3% loss, under the floor, on the floor, at the aim and at the 10% cap, what is left to risk after the open trades, and a swing that counts its risk today but never its unrealized figure
  check('T47 the day against his rules RUNS: the four lines in dollars from the account, the state at a 3% loss, under the floor, on the floor, at the aim and at the 10% cap, what is left to risk after the open trades, and a swing that counts its risk today but never its unrealized figure',
    day.lossLimitCents === -12000 && day.floorCents === 4000 && day.aimCents === 8000 && day.capCents === 40000
    && math.realizedToday(rows, '2026-09-22') === 4500 && math.openRisk(rows) === 3000
    && day.state === 'on-floor' && day.remainingRiskCents === 13500
    && at(-12000).state === 'stop-loss' && at(-12000).remainingRiskCents === 0
    && at(-11999).state === 'below-floor' && at(3999).state === 'below-floor'
    && at(8000).state === 'on-aim' && at(40000).state === 'stop-cap' && at(40000).remainingRiskCents === 0
    && /Realized \+\$45\.00, on the floor\. Aim is \$80\.00\. \$135\.00 left to risk today\./.test(day.line) && !DASH.test(day.line),
    JSON.stringify({ day, floor: at(3999).state, aim: at(8000).state }));
}

{
  // RE-PINNED 2026-09-23 (PR 420): his hand-logged positions, the calculator's edits and the closes left
  // with the Positions page. What he logged before stays readable in History (T55); the routes that wrote
  // them answer 404 like any other path the desk does not have.
  // NEGATIVE CONTROL (run 2026-09-23): `if (sub === 'close') return { ok: true };` added to tradeRoute's POST branch made this read
  //   FAIL  T48 the position routes are gone ...
  const { api } = world();
  const gone = [];
  for (const [method, sub] of [['GET', 'positions'], ['POST', 'position'], ['POST', 'close'], ['POST', 'remove'], ['POST', 'play'], ['GET', 'qa'], ['POST', 'look']]) {
    try { await api.tradeRoute(env, { sub, method, body: { id: 'x1' } }); gone.push('served'); } catch (e) { gone.push(e.status); }
  }
  check('T48 the position routes are gone: the list, a new position, a close, a remove, a play status, the questions list and the fast look all answer 404, and the routes module has none of them',
    gone.every((s) => s === 404)
    && ['tradePositions', 'tradePosition', 'tradeClose', 'tradeRemove', 'tradePlay', 'tradeQa', 'tradeLook'].every((k) => K[k] === undefined)
    && !/async function trade(Positions|Position|Close|Remove|Play|Qa|Look)\b/.test(T),
    gone.join());
}

{
  const nowMs = at('2026-09-22T16:00:00Z');
  const mk = (settings) => {
    const { w, api } = world();
    w.docs.set('trade/settings', { data: settings });
    return { w, api };
  };
  const keyed = mk({ finnhubKey: 'abcdefghijklmnop1234' });
  // The fetch count is read as each call lands, not at the end: by then the cold one has already run.
  const one = await keyed.api.tradeQuote(env, { symbols: 'nvda,NVDA' }, nowMs);
  const afterOne = keyed.w.fetches.length;
  const again = await keyed.api.tradeQuote(env, { symbols: 'NVDA' }, nowMs + 1000);
  const afterAgain = keyed.w.fetches.length;
  const fresh = await keyed.api.tradeQuote(env, { symbols: 'NVDA' }, nowMs + 30_000);
  const afterFresh = keyed.w.fetches.length;
  const noKey = mk({});
  const errs = [];
  for (const [w2, q, when] of [[noKey, { symbols: 'NVDA' }, nowMs], [keyed, { symbols: 'A,B,C,D,E,F,G,H,I,J,K' }, nowMs], [keyed, { symbols: '' }, nowMs], [keyed, { symbols: '1BAD' }, nowMs]]) {
    try { await w2.api.tradeQuote(env, q, when); errs.push('served'); } catch (e) { errs.push(`${e.status} ${e.message}`); }
  }
  const spent = mk({ finnhubKey: 'abcdefghijklmnop1234' });
  // Fifty DISTINCT tickers: a repeat would answer from the cache and cost the minute nothing.
  const tick = (i) => `T${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`;
  for (let i = 0; i < 50; i++) await spent.api.tradeQuote(env, { symbols: tick(i) }, nowMs).catch(() => {});
  let over = '';
  try { await spent.api.tradeQuote(env, { symbols: 'NVDA' }, nowMs); } catch (e) { over = `${e.status} ${e.message}`; }
  // NEGATIVE CONTROL (run 2026-09-22): the cache's TTL read as 0 (`now - hit.at < 0`) made this read
  //   FAIL  T49 the quote route RUNS: no key is a 404 with the sentence that says where to put one, eleven tickers and none at all are refused, a bad ticker is refused, the same ticker twice in twenty seconds costs one call, a colder one costs another, and the minute's budget answers 429 rather than calling out
  check('T49 the quote route RUNS: no key is a 404 with the sentence that says where to put one, eleven tickers and none at all are refused, a bad ticker is refused, the same ticker twice in twenty seconds costs one call, a colder one costs another, and the minute\'s budget answers 429 rather than calling out',
    one.quotes.length === 1 && one.quotes[0].ticker === 'NVDA' && afterOne === 1
    && again.quotes.length === 1 && afterAgain === 1
    && fresh.quotes.length === 1 && afterFresh === 2
    && errs[0] === `404 ${K.SAY.noQuoteKey}` && errs[1] === `400 ${K.SAY.quoteMany}` && errs[2] === `400 ${K.SAY.quoteMany}` && errs[3] === `400 ${K.SAY.badTicker}`
    && over === `429 ${K.SAY.quoteBudget}` && K.QUOTE_BUDGET === 50 && K.QUOTE_TTL_MS === 20_000 && K.QUOTE_MAX === 10,
    JSON.stringify({ afterOne, afterAgain, afterFresh, errs, over }));
}

{
  const nowMs = at('2026-09-21T15:35:00Z');
  const { w, api } = world();
  w.docs.set('trade/settings', { data: { caseId: 'c1', startedAt: '2026-08-31', startCents: 200000, accountType: 'cash' } });
  w.listed['trade/balances/items'] = [{ id: '2026-09-21', data: { date: '2026-09-21', cents: 238000 } }];
  w.listed['trade/positions/items'] = [
    { id: 'x1', data: { ticker: 'NVDA', side: 'long', instrument: 'stock', horizon: 'swing', qty: 10, entry: 648.4, stop: 646.9, target: 652, status: 'open', riskCents: 1500, openedAt: '2026-09-18T15:00:00Z', openedDay: '2026-09-18' } },
    { id: 'x2', data: { ticker: 'AAPL', side: 'long', instrument: 'stock', horizon: 'scalp', qty: 5, entry: 231.1, stop: 230.4, status: 'open', riskCents: 350, openedAt: '2026-09-21T15:00:00Z', openedDay: '2026-09-21' } },
  ];
  const note = await api.tradeNote(env, { now: nowMs });
  const play = K.validPlay({ ticker: 'amd', side: 'long', instrument: 'stock', entry: 167.3, stop: 163.8, targets: [174], holdMinutes: 1800, horizon: 'swing', holdDays: 3, profitLow: 50, profitHigh: 60, sizeDollars: 500, picture: 'Base above the fifty day.' });
  const scalp = K.validPlay({ ticker: 'spy', side: 'long', instrument: 'stock', entry: 574, stop: 573.6, targets: [575], holdMinutes: 8, profitLow: 50, profitHigh: 60, sizeDollars: 500, picture: 'Opening drive.' });
  const { w: w2, api: api2 } = world();
  w2.docs.set('trade/settings', { data: { caseId: 'c1' } });
  await api2.recordPlays(env, 'c1', [play, scalp], { slot: '07:02', now: at('2026-09-23T15:00:00Z') });
  const rows = w2.patches.filter((p) => p.path.startsWith('trade/plays/items/') && p.data.status === 'open');
  const swingRow = rows.find((r) => r.data.ticker === 'AMD');
  const scalpRow = rows.find((r) => r.data.ticker === 'SPY');
  // NEGATIVE CONTROL (run 2026-09-22): the swing expiry left on the day-play clock (the ternary dropped) made this read
  //   FAIL  T50 the note and the plays know the three kinds: the note carries his rules in dollars, where the day stands and every open position with its kind, its risk and where it is going, day first; a play says which kind it is or is read from its hold; and a swing play expires at the close of its last day and never past the week's last close, while a scalp keeps the session clock
  check('T50 the note and the plays know the three kinds: the note carries his rules in dollars, where the day stands and every open position with its kind, its risk and where it is going, day first; a play says which kind it is or is read from its hold; and a swing play expires at the close of its last day and never past the week\'s last close, while a scalp keeps the session clock',
    /His rules today: aim 2%, which is \$47\.60/.test(note) && /Today: Realized \$0\.00, under the floor\./.test(note)
    && /His open positions \(his own, not the plays\):/.test(note)
    && /Scalp: AAPL long 5 shares at 231\.1, stop 230\.4 \(risk \$3\.50, 0\.15% of the account\)/.test(note)
    && /Swing: NVDA long 10 shares at 648\.4, stop 646\.9 \(risk \$15\.00, 0\.63% of the account\), target 652/.test(note)
    && note.indexOf('Scalp: AAPL') < note.indexOf('Swing: NVDA') && !DASH.test(note)
    && play.horizon === 'swing' && play.holdDays === 3 && scalp.horizon === 'scalp' && scalp.holdDays === 0
    && swingRow.data.expiresAt.toISOString() === new Date(K.mtInstant('2026-09-25', '14:00')).toISOString()
    && scalpRow.data.expiresAt.toISOString() === new Date(at('2026-09-23T15:00:00Z') + 16 * 60_000).toISOString(),
    JSON.stringify({ swing: swingRow?.data.expiresAt, scalp: scalpRow?.data.expiresAt }));
}

// ---- T51, T58, T63: the scan's flight, the empty scan and the fast look (2026-09-22) ---------
// RE-PINNED 2026-09-23 (PR 420): all three were the Scan and the Look, and both are gone. The six-agent
// run is what suggests a trade now, and its flight, its failures and its resume are held in desk.mjs
// (D11 to D17). What stands here is that none of the old machinery survived to be reached by accident.
// NEGATIVE CONTROL (run 2026-09-23): `const SCAN_MARKER = (id) => id;` added back to advisor.js made this read
//   FAIL  T51 the scan's flight is gone ...
check('T51 the scan\'s flight is gone: the advisor has no scan runner, no poller, no finish, no marker, no desk state and none of the scan\'s sentences, and nothing imports them',
  !/runTradeScan|pollScanFlight|finishTradeScan|SCAN_MARKER|SCAN_ABANDON_MS|deskState\(|TRADE_SAY|scanRunning/.test(ADV)
  && !/runTradeScan|pollScanFlight|finishTradeScan/.test(W + T));
// NEGATIVE CONTROL (run 2026-09-23): `scanEmpty: 'x',` added back to trade-desk.js' SAY made this read
//   FAIL  T58 the empty scan's handling is gone ...
check('T58 the empty scan\'s handling is gone with the scan: no sentence for it in the desk\'s SAY, and the six-agent run answers a thin run with its own sentence instead',
  !/scanEmpty|scanRunning|lookRunning|lookLong|lookNoCtx/.test(TD)
  && K.SAY.runThin === 'Fewer than two of the five researchers came back, so the desk made no calls. Tap RUN TRADING DESK to try again.'
  && /SAY\.runThin/.test(f('worker/desk-run.js')));
// NEGATIVE CONTROL (run 2026-09-23): `id="look-go"` added back to the page made this read
//   FAIL  T63 the fast look is gone ...
check('T63 the fast look is gone: no Look button, no Scan button, no look route, no look contract, no look strength and no look runner, on the page, in the app, the routes, the demo or the advisor',
  !/look-go|scan-go/.test(f('public/admin-desk.html') + f('public/js/admin-deskapp.js'))
  && !/tradeLook|runTradeLook|LOOK_CONTRACT|TRADE_LOOK_EFFORT|LOOK_BUDGET/.test(T + TD + ADV + W)
  && !/sub === 'look'/.test(D));

// ---- T64: how long it has been, on the RUN TRADING DESK line (Eric, 2026-09-22) ---------------
// RE-PINNED 2026-09-23 (PR 420): the running row belongs to the one button now. runLine says which
// stage the run is in, how many of the five are back, and for how long, and never "0 minutes".
// NEGATIVE CONTROL (run 2026-09-23): runLine's `m < 1 ? ''` changed to `m < 0 ? ''` made this read
//   FAIL  T64 the RUN TRADING DESK line says ...
{
  const DESKMOD = await import('../../public/js/admin-desk.js');
  const APP = f('public/js/admin-deskapp.js');
  const now = Date.parse('2026-09-23T16:00:00Z');
  const ago = (s) => new Date(now - s * 1000).toISOString();
  const q = DESKMOD.runLine({ status: 'queued', queuedAt: ago(20) }, null, now);
  const r = DESKMOD.runLine({ status: 'researching', startedAt: ago(61), done: 2, of: 5 }, null, now);
  const r3 = DESKMOD.runLine({ status: 'researching', startedAt: ago(200), done: 4, of: 5 }, null, now);
  const dec = DESKMOD.runLine({ status: 'decide', startedAt: ago(180) }, null, now);
  const deciding = DESKMOD.runLine({ status: 'deciding', startedAt: ago(250) }, null, now);
  const none = DESKMOD.runLine({ status: 'idle' }, null, now);
  const last = DESKMOD.runLine({ status: 'idle' }, { at: ago(7200), count: 3 }, now);
  const one = DESKMOD.runLine({ status: 'idle' }, { at: ago(30), count: 1 }, now);
  const bad = DESKMOD.runLine({ status: 'researching', startedAt: 'not a date', done: 1 }, null, now);
  check('T64 the RUN TRADING DESK line says where the run is: queued says it is picked up within a minute and never counts zero; researching says how many of five are back and for how many minutes, singular at one; handed to the desk and deciding each say so; idle with no run says to tap; idle after a run says when, how long ago and how many trades, singular at one; an unreadable stamp still says the stage; the button is down while any stage runs; and the page repaints the line on the poll and draws the five dots',
    q.busy === true && q.html === 'Starting. <b>The desk picks it up within a minute.</b>'
    && r.busy === true && r.html === 'Five researchers at work. <b>2 of 5 back.</b> 1 minute so far.'
    && r3.html === 'Five researchers at work. <b>4 of 5 back.</b> 3 minutes so far.'
    && dec.busy === true && /The desk decides in the next minute\./.test(dec.html) && deciding.busy === true && /The desk is deciding\./.test(deciding.html)
    && none.busy === false && none.html === 'No run yet. <b>Tap RUN TRADING DESK.</b>'
    && last.busy === false && /^Last run <b>[0-9:]+ [AP]M<\/b>, 2h ago · 3 trades$/.test(last.html)
    && /^Last run <b>[0-9:]+ [AP]M<\/b> · 1 trade$/.test(one.html)
    && bad.html === 'Five researchers at work. <b>1 of 5 back.</b>'
    && /\$\('#run'\)\.disabled = line\.busy;/.test(APP) && /const line = runLine\(run, st\.desk\);/.test(APP)
    && /run\.status === 'researching'\n\s+\? `<span class="agents" aria-hidden="true">/.test(APP)
    // RE-PINNED 2026-09-23 (review): the scheduler keeps a sooner poll rather than pushing it back.
    && /const wait = ms \?\? \(runBusy\(\) \? 5000 : 60_000\);/.test(APP)
    && !DASH.test(q.html + r.html + dec.html + last.html),
    JSON.stringify({ q: q.html, r: r.html, last: last.html, one: one.html }));
}

// ---- T65: the page's shape and its Settings (PR 420, 2026-09-23) ---------------------------------
// Eric: "TRADES (default) ... NEWS ... HISTORY ... SETTINGS/BALANCE (minimal)", "Balance manually
// updated, used for sizing", "3% risk rule." The page opens on Trades, the cog opens a sheet with his
// balance first and the risk per trade beside it, and nothing on the sheet reaches back for the key.
// NEGATIVE CONTROL (run 2026-09-23): the sheet's `value="${esc(pub.riskPct ?? 3)}"` changed to `value="${esc(pub.riskPct ?? 1)}"` made this read
//   FAIL  T65 the page opens on Trades ...
{
  const PAGE = f('public/admin-desk.html');
  const APP = f('public/js/admin-deskapp.js');
  check('T65 the page opens on Trades with RUN TRADING DESK at the top, the active trades above the board and the rule under it; the cog opens Settings with his balance first, typed and saved as today\'s, then the risk per trade at 3% unless he set one, the account type, the key by its last four only, the list it prices, pushes and the debug switch that alone opens the research; and a stored page that no longer exists falls back to Trades',
    /const PAGES = \['trades', 'news', 'history'\];/.test(APP) && /const page = PAGES\.includes\(name\) \? name : 'trades';/.test(APP)
    && PAGE.indexOf('id="runbox"') < PAGE.indexOf('id="active-wrap"') && PAGE.indexOf('id="active-wrap"') < PAGE.indexOf('id="board"')
    && /RUN TRADING DESK<\/button>/.test(PAGE) && /<p class="foot">Ideas, not orders\. Every trade is your decision\.<\/p>/.test(PAGE)
    && APP.indexOf('<h2>Balance</h2>') > 0 && APP.indexOf('<h2>Balance</h2>') < APP.indexOf('<h2>Risk</h2>')
    && /await call\('balance', \{ cents: Math\.round\(v \* 100\) \}\);/.test(APP)
    && /value="\$\{esc\(pub\.riskPct \?\? 3\)\}"/.test(APP) && /const out = await save\(\{ riskPct: v \}, '#risk-said'\);/.test(APP)
    && /pub\.hasKey \? `on file · ends \$\{esc\(pub\.keyTail \|\| ''\)\}` : 'none on file'/.test(APP) && !/finnhubKey: pub|pub\.finnhubKey/.test(APP)
    && /\$\{sw\('pushOn', pub\.pushOn !== false\)\}/.test(APP) && /\$\{sw\('debugResearch', pub\.debugResearch === true\)\}/.test(APP)
    && /id="research-go"\$\{pub\.debugResearch === true \? '' : ' hidden'\}/.test(APP)
    && /rules: \{ riskPct: settingsNow\(\)\.riskPct \?\? 3 \},/.test(APP)
    && !DASH.test(PAGE + APP));
}

// ---- T66: what the review found on the page (2026-09-23) ------------------------------------------
// A reviewer read the app end to end. Six things it found are held here, each in the one line that fixes it.
// NEGATIVE CONTROL (run 2026-09-23): pollOnce's `if (rev !== S.rev) return;` removed made this read
//   FAIL  T66 the page never paints over his tap ...
// NEGATIVE CONTROL (run 2026-09-23): the balance guard's `!raw ||` removed made this read
//   FAIL  T66 the page never paints over his tap ...
{
  const APP = f('public/js/admin-deskapp.js');
  const startRun = lift(APP, 'async function startRun() {');
  check('T66 the page never paints over his tap and never loses a word: a poll that set out before a tap is thrown away when it lands; every tap bumps the revision; a sooner poll is never pushed back; a failed RUN shows its reason after the line repaints rather than before; an empty or zero balance is refused before anything is sent; the door keeps its button through a failure; closing Settings closes an open sheet and its listeners; and a card sizes only from a balance he typed',
    /const rev = S\.rev;\n\s+try \{\n\s+const out = await call\('state'\);\n(?:\s*\/\/[^\n]*\n)*\s+if \(rev !== S\.rev\) return;\n\s+S\.state = out;/.test(APP)
    && (APP.match(/S\.rev \+= 1;/g) || []).length >= 4
    && /if \(pollTimer && pollAt <= Date\.now\(\) \+ wait\) return;/.test(APP)
    && startRun.indexOf('paintRun();\n    say(\'#run-said\', err.message);') > 0
    && /if \(!raw \|\| !Number\.isFinite\(v\) \|\| v <= 0\) \{ say\('#bal-said'/.test(APP)
    && /const btn = e\.currentTarget;\n\s+btn\.disabled = true;/.test(APP) && /say\('#door-said', err\.message\); btn\.disabled = false;/.test(APP)
    && /const closeAll = \(\) => \{ sheetClose\?\.\(\); ov\.innerHTML = '';/.test(APP)
    && /balanceTyped: !!balanceNow\(\)\.typed && balanceNow\(\)\.cents > 0,/.test(APP),
    JSON.stringify({ revs: (APP.match(/S\.rev \+= 1;/g) || []).length, run: startRun.length }));
}

// ---- T68 to T70: his own size (2026-09-23, v7.3) --------------------------------------------------
// Eric: "I should be able to manually tap on the amount traded and update it, the amount I'm willing to
// risk, then it adjusts the stop loss and take profit", and "Including after the trade was accepted".
{
  const NV = { instrument: 'stock', side: 'long', entryLow: 247.5, entryHigh: 248, stop: 245.8, targets: [251, 253.5] };
  const a = math.planFor({ rec: NV, amountCents: 100000, riskCents: 6000, accountCents: 245000 });
  // The multiple of the risk each target was, before and after.
  const mult = (e, st, t) => (t - e) / (e - st);
  const sh = math.planFor({ rec: { instrument: 'stock', side: 'short', entryLow: 100, entryHigh: 101, stop: 103, targets: [96] }, amountCents: 50000, riskCents: 2000 });
  const call = math.planFor({ rec: { instrument: 'call', side: 'long', entryLow: 3.1, entryHigh: 3.2, stop: 1.6, targets: [5] }, amountCents: 100000, riskCents: 30000 });
  const over = math.planFor({ rec: NV, amountCents: 100000, riskCents: 9000, accountCents: 245000 });
  const noStop = math.planFor({ rec: { ...NV, stop: null }, amountCents: 100000, riskCents: 6000 });
  // Across many sizes the loss at the stop is never more than he said and what goes in never more than he said.
  let honest = true;
  for (const amt of [5000, 12345, 98000, 250000]) for (const rk of [100, 869, 2500, 4000]) {
    const p = math.planFor({ rec: NV, amountCents: amt, riskCents: rk });
    if (p.ok && (p.riskCents > rk || p.costCents > amt || p.stop >= p.entry)) honest = false;
  }
  const whyOf = (o) => math.planFor({ rec: NV, amountCents: 100000, riskCents: 6000, ...o }).why || '';
  // NEGATIVE CONTROL (run 2026-09-23): planFor's long stop rounded down (`Math.floor(raw * t + 1e-6) / t` on both sides) made this read
  //   FAIL  T68 his size RUNS ...
  // NEGATIVE CONTROL (run 2026-09-23): planFor's targets left as the desk's (`targets = deskTargets.map(...)` replaced by `targets = deskTargets`) made this read
  //   FAIL  T68 his size RUNS ...
  // NEGATIVE CONTROL (run 2026-09-23): fractional shares rounded to the nearest instead of down (`r4(amount / unitCents)`) made this read
  //   FAIL  T68 his size RUNS ...
  check('T68 his size RUNS: a thousand dollars risking sixty buys from the top of the zone, puts the stop where sixty is lost and carries each target out at the multiple of the risk the desk gave it; a short\'s stop goes above and its target below; an option buys whole contracts under the amount; the loss at the stop is never more than he said and what goes in never more; a risk over his rule is flagged, not refused; with no stop from the desk the targets stay; and what cannot be done is refused in a sentence he can act on',
    a.ok && a.entry === 248 && a.shares === 4.0322 && a.costCents <= 100000 && a.riskCents === 6000 && a.stop === 233.12
    && Math.abs(mult(248, 233.12, a.targets[0]) - mult(248, 245.8, 251)) < 0.01 && Math.abs(mult(248, 233.12, a.targets[1]) - mult(248, 245.8, 253.5)) < 0.01
    && a.targets[0] === 268.29 && a.rr === 1.36 && a.overRule === false && a.budgetCents === 7350
    && sh.ok && sh.entry === 100 && sh.stop === 104 && sh.targets[0] === 94.67 && sh.riskCents === 2000
    && call.ok && call.contracts === 3 && call.costCents === 96000 && call.stop === 2.2 && call.targets[0] === 4.33
    && honest && over.ok && over.overRule === true
    && noStop.ok && noStop.targets.join() === '251,253.5'
    && /less than the \$999\.99 going in/.test(whyOf({ riskCents: 100000 }))
    && /stop would sit on the entry/.test(whyOf({ riskCents: 1 }))
    && /One contract costs \$320\.00, more than \$200\.00/.test(math.planFor({ rec: { instrument: 'call', side: 'long', entryLow: 3.2, entryHigh: 3.2, stop: 1.6, targets: [5] }, amountCents: 20000, riskCents: 3000 }).why)
    && /amount in dollars/.test(whyOf({ amountCents: 0 })) && /risk in dollars/.test(whyOf({ riskCents: 'x' }))
    && /targets would fall below zero/.test(math.planFor({ rec: { instrument: 'stock', side: 'short', entryLow: 10, entryHigh: 10, stop: 12, targets: [4] }, amountCents: 1000, riskCents: 800 }).why)
    && !DASH.test(Object.values({ a: whyOf({ riskCents: 100000 }), b: whyOf({ riskCents: 1 }) }).join(' ')),
    JSON.stringify({ a, sh, call, honest }));
}
{
  const now = at('2026-09-23T16:00:00Z');
  const REC = { ticker: 'NVDA', side: 'long', horizon: 'intraday', instrument: 'stock', entryLow: 247.5, entryHigh: 248, stop: 245.8, targets: [251, 253.5], status: 'open' };
  const adjust = async (rec, body, over = {}) => {
    const { w, api } = world(over);
    w.docs.set('trade/plays/items/r1', { data: rec, updateTime: 'P1' });
    let out = null; let err = null;
    try { out = await api.tradeRoute(env, { sub: 'adjust', method: 'POST', body: { id: 'r1', ...body }, now }); } catch (e) { err = e; }
    return { w, out, err, patch: w.patches.find((x) => x.path === 'trade/plays/items/r1') };
  };
  const open = await adjust(REC, { amountCents: 100000, riskCents: 6000 });
  const taken = await adjust({ ...REC, status: 'took', tookAt: new Date(now - 60_000) }, { amountCents: 50000, riskCents: 2500 });
  const closed = await adjust({ ...REC, status: 'closed', result: 'profit' }, { amountCents: 100000, riskCents: 6000 });
  const bad = await adjust(REC, { amountCents: 100000, riskCents: 100000 });
  const reset = await adjust({ ...REC, mine: { amountCents: 100000, riskCents: 6000, stop: 233.12, targets: [268.29] } }, { reset: true });
  const lost = await adjust(REC, { amountCents: 100000, riskCents: 6000 }, { claim: false });
  // NEGATIVE CONTROL (run 2026-09-23): tradeAdjust's status guard (`if (d.status !== 'open' && d.status !== 'took')`) removed made this read
  //   FAIL  T69 the size route RUNS ...
  // NEGATIVE CONTROL (run 2026-09-23): tradeAdjust's `ifUpdateTime: doc.updateTime` dropped made this read
  //   FAIL  T69 the size route RUNS ...
  check('T69 the size route RUNS: on an open trade and on one he took it saves his two numbers with the stop and targets they give, under the trade\'s own time, and touches nothing of the desk\'s; a closed trade is a 409 that says so; a size that cannot be done is a 400 with the sentence and nothing written; reset goes back to the desk\'s plan; and a write that lost the race is a 409 that says tap again',
    open.out?.ok && open.patch?.opts.mask.join() === 'mine' && open.patch.opts.ifUpdateTime === 'P1' && Object.keys(open.patch.data).join() === 'mine'
    && open.patch.data.mine.amountCents === 100000 && open.patch.data.mine.riskCents === 6000 && open.patch.data.mine.stop === 233.12 && open.patch.data.mine.targets[0] === 268.29
    && open.out.rec.mine.stop === 233.12 && open.out.rec.stop === 245.8 && open.out.rec.targets.join() === '251,253.5'
    && taken.out?.ok && taken.out.rec.status === 'took' && taken.out.rec.mine.amountCents === 50000
    && closed.err?.status === 409 && closed.err.message === K.SAY.notAdjustable && !closed.patch
    && bad.err?.status === 400 && /less than the/.test(bad.err.message) && !bad.patch
    && reset.out?.ok && reset.patch.data.mine === null && reset.out.rec.mine === null
    && lost.err?.status === 409 && lost.err.message === K.SAY.busy,
    JSON.stringify({ open: open.out?.rec?.mine, closed: closed.err?.message, bad: bad.err?.message, lost: lost.err?.message }));
}
{
  const mod = await import('../../public/js/admin-desk.js');
  const REC = { id: 'r1', ticker: 'NVDA', side: 'long', horizon: 'intraday', instrument: 'stock', entryLow: 247.5, entryHigh: 248, stop: 245.8, targets: [251, 253.5], allocPct: 40, status: 'open' };
  const mine = { amountCents: 100000, riskCents: 6000, stop: 233.12, targets: [268.29, 285.2] };
  const rules = { riskPct: 3 };
  const plain = mod.recCardHtml(REC, { accountCents: 245000, rules });
  const his = mod.recCardHtml({ ...REC, mine }, { accountCents: 245000, rules });
  const hisTaken = mod.recCardHtml({ ...REC, status: 'took', mine }, { accountCents: 245000, rules });
  const hisOver = mod.recCardHtml({ ...REC, mine: { ...mine, riskCents: 9000 } }, { accountCents: 245000, rules });
  const noBal = mod.recCardHtml({ ...REC, mine }, { accountCents: 0, rules, balanceTyped: false });
  const cellV = (h, k) => ((h.match(new RegExp(`<div class="k">${k}</div><div class="v">([^<]*)</div>`)) || [])[1] || '');
  const tapV = (h, e) => ((h.match(new RegExp(`data-edit="${e}"[^>]*><span class="k">[^<]*<span class="pen" aria-hidden="true"></span></span><span class="v">([^<]*)</span>`)) || [])[1] || '');
  const hist = mod.historyRowHtml({ ...REC, status: 'closed', result: 'profit', closedAt: '2026-09-23T19:00:00Z', mine: { ...mine, costCents: 99999 } });
  const histPlain = mod.historyRowHtml({ ...REC, status: 'closed', result: 'loss', closedAt: '2026-09-23T19:00:00Z' });
  const APP = f('public/js/admin-deskapp.js');
  // NEGATIVE CONTROL (run 2026-09-23): the card's `const stopNow = mine ? mine.stop : r.stop;` put back to `const stopNow = r.stop;` made this read
  //   FAIL  T70 his size on the card and in History ...
  // NEGATIVE CONTROL (run 2026-09-23): historyRowHtml's `his` line emptied (`const his = '';`) made this read
  //   FAIL  T70 his size on the card and in History ...
  // NEGATIVE CONTROL (run 2026-09-23): the board's `[data-edit]` listener removed from paintBoard made this read
  //   FAIL  T70 his size on the card and in History ...
  check('T70 his size on the card and in History: Amount and Risk are buttons on every card, open or taken; with his size the card shows his amount, his stop, his targets and his risk, says it is his and what the desk had, and flags a risk over his rule; with no balance typed his size still sizes the card; History shows what he traded beside the desk\'s plan; and the page opens the sheet from either cell, previews with the same function the Worker saves with, and sends only the two numbers or a reset',
    /data-edit="amount"/.test(plain) && /data-edit="risk"/.test(plain) && /data-edit="amount"/.test(hisTaken) && /data-edit="risk"/.test(hisTaken)
    && tapV(his, 'amount') === '$1,000 · 4.0322 shares' && tapV(his, 'risk') === '$60.00'
    && cellV(his, 'Stop') === '$233.12' && cellV(his, 'Targets') === '$268.29 then $285.20' && cellV(plain, 'Stop') === '$245.80'
    && /<p class="mine-note"><b>Your size\.<\/b> The desk had the stop at \$245\.80, targets \$251\.00 then \$253\.50\.<\/p>/.test(his)
    && !/mine-note/.test(plain) && /over your \$73\.50 rule/.test(hisOver) && !/over your/.test(his)
    && tapV(noBal, 'amount') === '$1,000 · 4.0322 shares' && cellV(noBal, 'Stop') === '$233.12'
    && /<span class="k">Desk<\/span> Entry \$247\.50 to \$248\.00, stop \$245\.80, targets \$251\.00 then \$253\.50\./.test(hist)
    && /<p class="mine"><span class="k">You<\/span> put in \$999\.99, risked \$60\.00, stop \$233\.12, targets \$268\.29 then \$285\.20\.<\/p>/.test(hist)
    && !/class="mine"/.test(histPlain) && !/<span class="k">Desk<\/span>/.test(histPlain)
    && /for \(const b of \$\$\('#pg-trades \[data-edit\]'\)\) b\.addEventListener\('click', \(\) => openSize\(b\)\);/.test(APP)
    // RE-PINNED 2026-09-24 (v7.8): the preview and the demo's adjust also carry his average once he has
    // added or trimmed (`entry`), null before, so the same size saves the same way.
    && /planFor\(\{ rec: r, amountCents: a, riskCents: k, accountCents: acct, rules: ctx\.rules, entry: at \}\)/.test(APP)
    && /call\('adjust', \{ id: r\.id, \.\.\.body \}\)/.test(APP) && /send\(\{ amountCents: dollarsIn\(amtIn\.value\), riskCents: dollarsIn\(riskIn\.value\) \}/.test(APP)
    && /send\(\{ reset: true \}/.test(APP)
    && /if \(sub === 'adjust'\) \{[\s\S]*?planFor\(\{ rec: d, amountCents: body\.amountCents, riskCents: body\.riskCents, entry: legs\.length \? d\.mine\.entry : null \}\)/.test(D)
    && /html\[data-desk\]:root \.rec \.cell\.tap \{[^}]*min-height: 44px;/.test(CSS)
    && ![his, hist, hisOver].some((h) => DASH.test(h)),
    JSON.stringify({ amt: tapV(his, 'amount'), risk: tapV(his, 'risk'), stop: cellV(his, 'Stop'), hist: hist.replace(/\s+/g, ' ').slice(0, 500) }));
}

// ---- T71: the run's bar (2026-09-24, v7.5) ----------------------------------------------------------
// Eric: "Is a loading bar for the desk scan possible?" It moves on real stages and researchers back only.
{
  const mod = await import('../../public/js/admin-desk.js');
  const t0 = at('2026-09-24T16:00:00Z');
  const iso = (ms) => new Date(ms).toISOString();
  const P = (run, now) => mod.runProgress(run, now);
  const q0 = P({ status: 'queued', queuedAt: iso(t0) }, t0);
  const q60 = P({ status: 'queued', queuedAt: iso(t0) }, t0 + 60_000);
  const r = (done, secs) => P({ status: 'researching', startedAt: iso(t0), done, of: 5 }, t0 + secs * 1000);
  const step = (72 - 8) / 5;
  const dec = P({ status: 'decide', decideAt: iso(t0) }, t0 + 30_000);
  const d0 = P({ status: 'deciding', claimedAt: iso(t0) }, t0);
  const dLate = P({ status: 'deciding', claimedAt: iso(t0) }, t0 + 3600_000);
  // A whole run, in the order the cron walks it, sampled every ten seconds: never backwards, never 100.
  const walk = [];
  for (let s = 0; s <= 50; s += 10) walk.push(P({ status: 'queued', queuedAt: iso(t0) }, t0 + s * 1000));
  for (let d = 0; d <= 5; d++) for (let s = 0; s <= 30; s += 10) walk.push(r(d, 60 + d * 20 + s));
  for (let s = 0; s <= 50; s += 10) walk.push(P({ status: 'decide', decideAt: iso(t0) }, t0 + s * 1000));
  for (let s = 0; s <= 300; s += 10) walk.push(P({ status: 'deciding', claimedAt: iso(t0) }, t0 + s * 1000));
  const rising = walk.every((v, i) => i === 0 || v >= walk[i - 1]);
  const PAGE = f('public/admin-desk.html');
  const APP = f('public/js/admin-deskapp.js');
  // NEGATIVE CONTROL (run 2026-09-24): the creep's 0.9 raised to 1.3, so the clock alone carried the bar past the next researcher's mark, made this read
  //   FAIL  T71 the run's bar RUNS ...
  // NEGATIVE CONTROL (run 2026-09-24): RUN_BANDS' deciding band put to [80, 100] made this read
  //   FAIL  T71 the run's bar RUNS ...
  check('T71 the run\'s bar RUNS: nothing running is no bar; waiting to be picked up stays in its first band; with no researcher back it creeps but never reaches the first researcher\'s mark however long it waits, and each one back lifts it a step; handed over and deciding each keep their band and never read 100 while the run is going; a whole run sampled in order never goes backwards; the page has the bar, repaints it each second while a run goes, never lets it fall within a run, and shows it full only when the trades land',
    P(null) === null && P({ status: 'idle' }) === null && P({ status: 'error' }) === null
    && q0 === 0 && q60 > 0 && q60 < 8
    && r(0, 0) === 8 && r(0, 3600) < 8 + step && r(0, 3600) > 8 + step * 0.8
    && r(3, 90) >= 8 + 3 * step && r(3, 90) < 8 + 4 * step && r(5, 200) === 72
    && dec >= 72 && dec < 80 && d0 === 80 && dLate < 97 && dLate > 95
    && rising && walk.every((v) => v < 100)
    && /<div class="runbar" id="runbar" role="progressbar"[^>]*hidden><i id="runbar-fill"><\/i><\/div>/.test(PAGE)
    && /setInterval\(\(\) => \{ if \(!document\.hidden && S\.page === 'trades' && runBusy\(\)\) paintBar\(\); \}, 1000\);/.test(APP)
    && /pct = Math\.max\(pct, BAR\.max\);/.test(APP) && /BAR\.doneUntil = Date\.now\(\) \+ 1400;/.test(APP)
    && /decideAt: iso\(run\.decideAt\), claimedAt: iso\(run\.claimedAt\),/.test(T) && /decideAt: iso\(run\.decideAt\), claimedAt: iso\(run\.claimedAt\),/.test(D)
    && /status: 'decide', done: got\.length, decideAt: new Date\(\)/.test(f('worker/desk-run.js'))
    && !/\.runbox\[aria-busy="true"\]::after/.test(CSS),
    JSON.stringify({ q60, r0: r(0, 3600), r3: r(3, 90), dec, d0, dLate, rising }));
}

// ---- T72 to T74: accept or pass (2026-09-24, v7.6) ------------------------------------------------
// Eric: "The desk should only suggest new positions or increasing equity in a position. I got the same
// position given to me twice. I should be able to accept/deny. If denied, it doesn't suggest that position
// to me again unless an additional agent agrees." And at review: "Passing on a scalp does not mean pass on
// a swing. They are different categories."
{
  const T = (o) => ({ ticker: 'NVDA', side: 'long', instrument: 'stock', horizon: 'intraday', agreement: 2, ...o });
  const keys = [math.positionKey(T({})), math.positionKey(T({ instrument: 'call' })), math.positionKey(T({ instrument: 'put' })), math.positionKey(T({ side: 'short' })), math.positionKey(T({ horizon: 'swing', ticker: ' nvda ' }))];
  const run = math.screenTrades([
    T({}), T({ instrument: 'call' }), T({ ticker: 'TSLA', horizon: 'scalp' }), T({ ticker: 'TSLA', horizon: 'scalp', instrument: 'put' }),
    T({ ticker: 'AMD', horizon: 'scalp' }), T({ ticker: 'AMD', horizon: 'scalp', agreement: 3 }), T({ ticker: 'AMD', horizon: 'swing' }),
    T({ ticker: 'MU', horizon: 'swing', instrument: 'put' }), T({ ticker: 'MU', horizon: 'scalp', instrument: 'put' }), T({ ticker: 'SOFI', agreement: 5 }),
  ], { held: ['NVDA:up:intraday', 'MU:up:swing'], declined: { 'AMD:up:scalp': { agreement: 2 }, 'SOFI:up:intraday': { agreement: 5 } } });
  const got = run.keep.map((k) => `${k.ticker}/${k.horizon}/${k.instrument}${k.adds ? '+add' : ''}${k.reoffered ? `+back${k.reoffered.was}>${k.reoffered.now}` : ''}`).join(' ');
  // NEGATIVE CONTROL (run 2026-09-24): positionKey without the kind (`${ticker}:${direction}` only) made this read
  //   FAIL  T72 what reaches him RUNS ...
  // NEGATIVE CONTROL (run 2026-09-24): screenTrades' pass test `agree <= was` changed to `agree < was` made this read
  //   FAIL  T72 what reaches him RUNS ...
  // NEGATIVE CONTROL (run 2026-09-24): screenTrades' held-against test removed (`if (ways && !ways.has(dir))` changed to `if (false)`) made this read
  //   FAIL  T72 what reaches him RUNS ...
  check('T72 what reaches him RUNS: a position is a ticker, a direction and a kind whatever the vehicle, a put and a short both down; one per position in a run and never both ways on one ticker and kind; the same position as one he holds comes as an add, one leaning against it in the same kind does not come, and a different kind on the same ticker is new; a position he passed on stays off at the same agreement or less and comes back flagged when more agree; a pass on a scalp leaves the swing alone; and passed at 5 of 5 it can never beat itself',
    keys.join() === 'NVDA:up:intraday,NVDA:up:intraday,NVDA:down:intraday,NVDA:down:intraday,NVDA:up:swing'
    && got === 'NVDA/intraday/stock+add TSLA/scalp/stock AMD/scalp/stock+back2>3 AMD/swing/stock MU/scalp/put'
    && run.dropped.twice === 2 && run.dropped.against === 1 && run.dropped.declined === 2,
    JSON.stringify({ got, dropped: run.dropped }));
}
{
  const now = at('2026-09-24T16:00:00Z');
  const REC = { ticker: 'AMD', side: 'long', horizon: 'scalp', instrument: 'call', agreement: 2, status: 'open', entryLow: 2, entryHigh: 2.2, stop: 1.6, targets: [2.9] };
  const decline = async (rec, over = {}, state = { declined: { 'OLD:up:swing': { agreement: 4, at: new Date(now - 86_400_000) } } }) => {
    const { w, api } = world(over);
    w.docs.set('trade/plays/items/r1', { data: rec, updateTime: 'P1' });
    w.docs.set('trade/state', { data: state, updateTime: 'S1' });
    let out = null; let err = null;
    try { out = await api.tradeRoute(env, { sub: 'decline', method: 'POST', body: { id: 'r1' }, now }); } catch (e) { err = e; }
    return { w, out, err, rec: w.patches.find((x) => x.path === 'trade/plays/items/r1'), st: w.patches.find((x) => x.path === 'trade/state') };
  };
  const ok1 = await decline(REC);
  const again = await decline({ ...REC, status: 'declined' });
  const took = await decline({ ...REC, status: 'took' });
  const lost = await decline(REC, { claim: false });
  const many = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`T${i}:up:swing`, { agreement: 1, at: new Date(now - (i + 1) * 60_000) }]));
  const capped = await decline(REC, {}, { declined: many });
  const capKeys = Object.keys(capped.st?.data.declined || {});
  // NEGATIVE CONTROL (run 2026-09-24): tradeDecline's `{ agreement, at: new Date(now), recId: id }` written with `agreement: 0` made this read
  //   FAIL  T73 NO RUNS ...
  // NEGATIVE CONTROL (run 2026-09-24): tradeDecline's status guard allowing a taken trade (`d.status !== 'open' && d.status !== 'declined' && d.status !== 'took'`) made this read
  //   FAIL  T73 NO RUNS ...
  check('T73 NO RUNS: a new suggestion he passes on leaves the board under its own time, and its position is remembered with how many of the desk agreed, beside the ones already remembered; a second NO is answered and remembered again; a trade he took cannot be passed on; a lost race says tap again; and only the newest two hundred passes are kept, the new one among them',
    ok1.out?.ok && ok1.rec?.data.status === 'declined' && ok1.rec.opts.ifUpdateTime === 'P1' && ok1.out.rec.status === 'declined'
    && ok1.st?.opts.mask.join() === 'declined' && ok1.st.opts.ifUpdateTime === 'S1'
    && ok1.st.data.declined['AMD:up:scalp']?.agreement === 2 && ok1.st.data.declined['AMD:up:scalp'].recId === 'r1' && ok1.st.data.declined['OLD:up:swing']?.agreement === 4
    && ok1.out.agreement === 2 && ok1.out.key === 'AMD:up:scalp'
    && again.out?.ok && !again.rec && again.st?.data.declined['AMD:up:scalp']?.agreement === 2
    && took.err?.status === 409 && took.err.message === K.SAY.notDeclinable && !took.st
    && lost.err?.status === 409 && lost.err.message === K.SAY.busy
    && capKeys.length === 200 && capKeys.includes('AMD:up:scalp') && capKeys.includes('T0:up:swing') && !capKeys.includes('T249:up:swing'),
    JSON.stringify({ ok: ok1.st?.data.declined?.['AMD:up:scalp'], took: took.err?.message, cap: capKeys.length }));
}
{
  const mod = await import('../../public/js/admin-desk.js');
  const REC = { id: 'r1', ticker: 'NVDA', side: 'long', horizon: 'intraday', instrument: 'stock', entryLow: 247.5, entryHigh: 248, stop: 245.8, targets: [251, 253.5], allocPct: 40, status: 'open', agreement: 3 };
  const ctx = { accountCents: 245000, rules: { riskPct: 3 } };
  const open = mod.recCardHtml(REC, ctx);
  const add = mod.recCardHtml({ ...REC, adds: true }, ctx);
  const back = mod.recCardHtml({ ...REC, reoffered: { was: 2, now: 3 } }, ctx);
  const took = mod.recCardHtml({ ...REC, status: 'took', adds: true, reoffered: { was: 2, now: 3 } }, ctx);
  const APP = f('public/js/admin-deskapp.js');
  // NEGATIVE CONTROL (run 2026-09-24): the NO button taken out of recCardHtml's open acts made this read
  //   FAIL  T74 accept or pass on the card ...
  // NEGATIVE CONTROL (run 2026-09-24): the app's decline branch sending the ticker (`call('decline', { id, ticker: ... })`) made this read
  //   FAIL  T74 accept or pass on the card ...
  check('T74 accept or pass on the card: a new suggestion carries YES and NO, a taken one neither; an add says Add and that he already holds it; a position back after a pass says when he passed and how many agree now; a taken card carries neither note; the page sends NO with the trade\'s id alone and says when it can come back; and the demo passes the same way and screens its run with the same function',
    /data-act="take">YES, I TOOK IT<\/button><button type="button" class="btn big quiet pass" data-act="decline" aria-label="No, pass on this trade">NO<\/button>/.test(open)
    && !/addtag|deal-note/.test(open)
    // RE-PINNED 2026-09-24 (v7.7): the add note says how many agree now (T75 holds the comparison with when he took it).
    && /<span class="addtag">Add<\/span>/.test(add) && /<p class="deal-note add"><b>You already hold NVDA\.<\/b> 3 of 5 agree now\. Taking this adds to your position\.<\/p>/.test(add)
    && /<p class="deal-note back"><b>Back again\.<\/b> You passed on this when 2 of 5 agreed\. Now 3 of 5 do\.<\/p>/.test(back)
    && !/addtag|deal-note|data-act="decline"/.test(took)
    && /const out = await call\('decline', \{ id \}\);/.test(APP) && /Passed on \$\{out\.rec\?\.ticker \|\| 'it'\}\. It comes back only if more than \$\{out\.agreement\} of 5 agree\./.test(APP)
    && /if \(sub === 'decline'\) \{[\s\S]*?positionKey\(d\)/.test(D) && /const \{ keep \} = screenTrades\(FRESH, \{ held, declined: tstate\(\)\.declined \|\| \{\} \}\);/.test(D)
    && ![open, add, back].some((h) => DASH.test(h)),
    back.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 400));
}

// ---- T75: how many agree, on every card (2026-09-24, v7.7) ---------------------------------------
// Eric, from a BA card marked ADD with no Desk row: "I need to see how many agents agreed to a position if
// it's a repeat. I'm not seeing it." The row was only drawn from 2 up.
{
  const mod = await import('../../public/js/admin-desk.js');
  const REC = { id: 'r1', ticker: 'BA', side: 'long', horizon: 'swing', instrument: 'stock', entryLow: 200.5, entryHigh: 203, stop: 197.4, targets: [206, 209], allocPct: 10, status: 'open', agreement: 1 };
  const ctx = { accountCents: 245000, rules: { riskPct: 3 } };
  const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  // RE-PINNED 2026-09-24 (v7.10): the count is read under the chance, in the chance's own type (T80).
  const row = (a) => ((mod.recCardHtml({ ...REC, agreement: a }, ctx)).match(/<span class="odds">(?:<span class="k">Chance<\/span><span class="v">[^<]*<\/span>)?<span class="v agree">(\d) of 5 agree<\/span><\/span>/) || [])[1];
  const held = { ...REC, id: 'h1', status: 'took', agreement: 3 };
  const holding = new Map([[math.positionKey(held), held]]);
  const add = txt(mod.recCardHtml({ ...REC, adds: true }, { ...ctx, holding }));
  const addAlone = txt(mod.recCardHtml({ ...REC, adds: true }, ctx));
  const addNone = txt(mod.recCardHtml({ ...REC, adds: true }, { ...ctx, holding: new Map([[math.positionKey(held), { ...held, agreement: null }]]) }));
  const took = txt(mod.recCardHtml({ ...held, adds: true }, { ...ctx, holding }));
  const APP = f('public/js/admin-deskapp.js');
  // NEGATIVE CONTROL (run 2026-09-24): the card's count put back to `Number(r.agreement) >= 2 ? ... : ''` made this read
  //   FAIL  T75 how many agree, on every card ...
  // NEGATIVE CONTROL (run 2026-09-24): the add's held comparison removed (`const heldRec = null;`) made this read
  //   FAIL  T75 how many agree, on every card ...
  check('T75 how many agree, on every card: the count under the chance reads 0, 1 and 5 of 5 as well as the rest; an add says how many agreed when he took the trade he holds and how many agree now, or only now when the first is not on record or not in hand; a taken card has no add note; and the page hands the card his taken trades by position',
    row(0) === '0' && row(1) === '1' && row(3) === '3' && row(5) === '5'
    && /You already hold BA\. 3 of 5 agreed when you took it; 1 of 5 agree now\. Taking this adds to your position\./.test(add)
    && /You already hold BA\. 1 of 5 agree now\. Taking this adds to your position\./.test(addAlone)
    && /You already hold BA\. 1 of 5 agree now\. Taking this adds/.test(addNone)
    && !/You already hold/.test(took)
    && /holding: new Map\(\(S\.state\?\.active \|\| \[\]\)\.map\(\(r\) => \[positionKey\(r\), r\]\)\),/.test(APP)
    && !DASH.test(add),
    JSON.stringify({ rows: [row(0), row(1), row(5)], add: (add.match(/You already hold.*?position\./) || [''])[0] }));
}

// ---- T76 to T78: ADD/TRIM (2026-09-24, v7.8) -----------------------------------------------------
// Eric: "Button between profit and loss that says add/trim and this opens the card to add/subtract a new
// contract or stock amount (in dollars) manually. It gives me a new suggested stop loss."
// He holds 2 BA at 203 with the stop at 197, $12 at risk; the desk's targets are 1 and 2 times its risk.
const BA_HELD = { ticker: 'BA', side: 'long', horizon: 'swing', instrument: 'stock', entryLow: 200, entryHigh: 203, stop: 197, targets: [209, 215], status: 'took',
  mine: { qty: 2, entry: 203, riskCents: 1200, stop: 197, targets: [209, 215], amountCents: 40600, costCents: 40600 } };
{
  const S = BA_HELD;
  const add = math.scalePosition({ rec: S, kind: 'add', amountCents: 60000, price: 200 });
  const trim = math.scalePosition({ rec: S, kind: 'trim', amountCents: 21000, price: 210 });
  const riskTyped = math.scalePosition({ rec: S, kind: 'add', amountCents: 60000, price: 200, riskCents: 2100 });
  const O = { ticker: 'BA', side: 'long', horizon: 'swing', instrument: 'call', entryLow: 3, entryHigh: 3.2, stop: 2, targets: [4.4], status: 'took', mine: { qty: 3, entry: 3.2, riskCents: 36000, stop: 2, amountCents: 96000 } };
  const opt = math.scalePosition({ rec: O, kind: 'add', contracts: 2, price: 2.9 });
  const optTrim = math.scalePosition({ rec: O, kind: 'trim', contracts: 1, price: 4 });
  const H = { ticker: 'F', side: 'short', horizon: 'intraday', instrument: 'stock', entryLow: 50, entryHigh: 49, stop: 51, targets: [45], status: 'took', mine: { qty: 10, entry: 49, riskCents: 2000, stop: 51, amountCents: 49000 } };
  const short = math.scalePosition({ rec: H, kind: 'add', amountCents: 50000, price: 50 });
  const bare = { ...S, mine: null, allocPct: 10 };
  const fromBal = math.scalePosition({ rec: bare, kind: 'add', amountCents: 60000, price: 200, accountCents: 245000, rules: { riskPct: 3 } });
  const why = (o) => math.scalePosition({ rec: S, kind: 'add', amountCents: 60000, price: 200, ...o }).why;
  const pick = (p) => (p.ok ? { qty: p.qty, entry: p.entry, stop: p.stop, targets: p.targets, risk: p.riskCents, keep: p.keepStopRiskCents } : p.why);
  // NEGATIVE CONTROL (run 2026-09-24): scalePosition's add blend put back to `entry = held.entry;` made this read
  //   FAIL  T76 an add or a trim RUNS ...
  // NEGATIVE CONTROL (run 2026-09-24): scalePosition's whole-position guard removed made this read
  //   FAIL  T76 an add or a trim RUNS ...
  check('T76 an add or a trim RUNS: $600 of BA at 200 on 2 held at 203 holds 5 at an average of 201.20, and the stop moves up to 198.80 so the whole still loses his $12, the targets keeping the desk\'s multiples from his average, with keeping the old stop at 197 risking $21 instead; a risk he types is the one used; a trim keeps the average and the $12, so its stop widens, and keeping the old stop would risk $6; the whole position is refused as a trim; an option adds and trims whole contracts at the premium; a short\'s stop stays above; a taken trade he never sized holds what its card showed; and what cannot be done says so in a sentence',
    add.ok && add.qty === 5 && add.entry === 201.2 && add.stop === 198.8 && add.targets.join() === '203.6,206' && add.riskCents === 1200 && add.keepStop === 197 && add.keepStopRiskCents === 2100 && add.changeQty === 3 && add.costCents === 100600
    && riskTyped.stop === 197 && riskTyped.riskCents === 2100
    && trim.ok && trim.qty === 1 && trim.entry === 203 && trim.stop === 191 && trim.riskCents === 1200 && trim.keepStopRiskCents === 600
    && math.scalePosition({ rec: S, kind: 'trim', amountCents: 50000, price: 210 }).why === 'That is the whole position. Mark it PROFIT or LOSS instead.'
    && opt.ok && opt.contracts === 5 && opt.entry === 3.08 && opt.stop === 2.36 && opt.targets.join() === '3.8' && opt.riskCents === 36000
    && optTrim.ok && optTrim.contracts === 2 && optTrim.entry === 3.2 && optTrim.stop === 1.4
    && short.ok && short.qty === 20 && short.entry === 49.5 && short.stop === 50.5 && short.targets.join() === '47.5'
    && fromBal.ok && fromBal.heldBefore.qty === 1.2069 && fromBal.heldBefore.entry === 203
    && math.scalePosition({ rec: { ...S, mine: null }, kind: 'add', amountCents: 60000, price: 200 }).why === 'Set your size first: tap Amount on the card.'
    && why({ price: null }) === 'The price you traded at, for example 199.50.' && why({ kind: 'sell' }) === 'Add or trim.'
    && why({ amountCents: 0 }) === 'The amount in dollars, for example 250.'
    && math.scalePosition({ rec: O, kind: 'add', contracts: 0, price: 2.9 }).why === 'How many contracts, for example 1.'
    && math.scalePosition({ rec: O, kind: 'add', contracts: 1, price: null }).why === 'The premium per share you traded at, for example 2.10.',
    JSON.stringify({ add: pick(add), trim: pick(trim), opt: pick(opt), short: pick(short) }));
}
{
  const now = at('2026-09-24T16:00:00Z');
  const run = async (sub, rec, body, over = {}) => {
    const { w, api } = world(over);
    w.docs.set('trade/plays/items/r1', { data: rec, updateTime: 'P1' });
    let out = null; let err = null;
    try { out = await api.tradeRoute(env, { sub, method: 'POST', body: { id: 'r1', ...body }, now }); } catch (e) { err = e; }
    return { w, out, err, patch: w.patches.find((x) => x.path === 'trade/plays/items/r1') };
  };
  const add = await run('scale', BA_HELD, { kind: 'add', amountCents: 60000, price: 200 });
  const scaled = { ...BA_HELD, mine: add.patch?.data.mine };
  const trim = await run('scale', scaled, { kind: 'trim', amountCents: 20000, price: 205 });
  const open = await run('scale', { ...BA_HELD, status: 'open' }, { kind: 'add', amountCents: 60000, price: 200 });
  const whole = await run('scale', BA_HELD, { kind: 'trim', amountCents: 50000, price: 210 });
  const lost = await run('scale', BA_HELD, { kind: 'add', amountCents: 60000, price: 200 }, { claim: false });
  const many = await run('scale', { ...BA_HELD, mine: { ...BA_HELD.mine, legs: Array.from({ length: 20 }, (_, i) => ({ kind: 'add', qty: 0.1, price: 200 + i, at: new Date(now - 1e6) })) } }, { kind: 'add', amountCents: 60000, price: 200 });
  const reset = await run('adjust', scaled, { reset: true });
  const resize = await run('adjust', scaled, { amountCents: 100600, riskCents: 2100 });
  const m = add.patch?.data.mine || {};
  // NEGATIVE CONTROL (run 2026-09-24): tradeScale's status guard (`if (d.status !== 'took')`) removed made this read
  //   FAIL  T77 the add and trim route RUNS ...
  // NEGATIVE CONTROL (run 2026-09-24): tradeScale's new leg left off the list (`const legs = [...(...)].slice(-20)` without it) made this read
  //   FAIL  T77 the add and trim route RUNS ...
  check('T77 the add and trim route RUNS: on a trade he took it saves what he holds now, his average, the new stop and targets, the risk, and the add itself as a leg, under the trade\'s own time and touching nothing of the desk\'s; a trim after it keeps the average and adds its own leg; an open trade is a 409 that says tap YES first; the whole position is a 400 with the sentence and nothing written; a lost race says tap again; only the last twenty legs are kept, the newest last; once added to, the desk\'s plan is refused and a resize keeps his average and his legs',
    add.out?.ok && add.patch?.opts.mask.join() === 'mine' && add.patch.opts.ifUpdateTime === 'P1' && Object.keys(add.patch.data).join() === 'mine'
    && m.qty === 5 && m.entry === 201.2 && m.stop === 198.8 && m.targets.join() === '203.6,206' && m.riskCents === 1200 && m.costCents === 100600 && m.amountCents === 100600
    && m.legs.length === 1 && m.legs[0].kind === 'add' && m.legs[0].qty === 3 && m.legs[0].price === 200
    && add.out.rec.mine.entry === 201.2 && add.out.rec.mine.legs[0].kind === 'add' && add.out.rec.stop === 197 && add.out.rec.targets.join() === '209,215'
    && trim.out?.ok && trim.patch.data.mine.entry === 201.2 && trim.patch.data.mine.legs.map((l) => l.kind).join() === 'add,trim' && trim.patch.data.mine.qty === 4.0244
    && open.err?.status === 409 && open.err.message === K.SAY.notScalable && !open.patch
    && whole.err?.status === 400 && whole.err.message === 'That is the whole position. Mark it PROFIT or LOSS instead.' && !whole.patch
    && lost.err?.status === 409 && lost.err.message === K.SAY.busy
    && many.patch?.data.mine.legs.length === 20 && many.patch.data.mine.legs[19].price === 200 && many.patch.data.mine.legs[0].price === 201
    && reset.err?.status === 409 && reset.err.message === K.SAY.scaledNoReset && !reset.patch
    && resize.out?.ok && resize.patch.data.mine.entry === 201.2 && resize.patch.data.mine.legs.length === 1 && resize.patch.data.mine.stop === 197 && resize.patch.data.mine.qty === 5,
    JSON.stringify({ add: m, trim: trim.patch?.data.mine?.qty, open: open.err?.message, reset: reset.err?.message, resize: resize.patch?.data.mine?.stop }));
}
{
  const mod = await import('../../public/js/admin-desk.js');
  const ctx = { accountCents: 245000, rules: { riskPct: 3 } };
  const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const mine = { qty: 5, entry: 201.2, riskCents: 1200, stop: 198.8, targets: [203.6, 206], amountCents: 100600, costCents: 100600, legs: [{ kind: 'add', qty: 3, price: 200 }] };
  const REC = { ...BA_HELD, id: 'r1', agreement: 3, mine };
  const card = mod.recCardHtml(REC, ctx);
  const both = txt(mod.recCardHtml({ ...REC, mine: { ...mine, legs: [...mine.legs, { kind: 'trim', qty: 1, price: 205 }] } }, ctx));
  const openCard = mod.recCardHtml({ ...REC, status: 'open', mine: null }, ctx);
  const hist = txt(mod.historyRowHtml({ ...REC, status: 'closed', result: 'profit', closedAt: '2026-09-24T19:00:00Z' }));
  const APP = f('public/js/admin-deskapp.js');
  const CSS = f('public/css/admin.css');
  const DS = (k) => ((D.match(new RegExp(`${k}: '((?:[^'\\\\]|\\\\.)*)'`)) || [])[1] || '').replace(/\\'/g, '\'');
  // NEGATIVE CONTROL (run 2026-09-24): the ADD/TRIM button taken out of recCardHtml's taken acts made this read
  //   FAIL  T78 ADD/TRIM on the card ...
  // NEGATIVE CONTROL (run 2026-09-24): act()'s `if (kind === 'scale') { openScale(btn); return; }` removed made this read
  //   FAIL  T78 ADD/TRIM on the card ...
  // NEGATIVE CONTROL (run 2026-09-24): the taken card's `min-width: 0; padding: 0 10px;` rule dropped (the card grew to 329px on a 320px screen without it) made this read
  //   FAIL  T78 ADD/TRIM on the card ...
  check('T78 ADD/TRIM on the card: a taken trade has PROFIT, then ADD/TRIM, then LOSS, and a new suggestion has none of them; after an add the card sizes from what he holds at his average, says so with how many adds and trims, keeps the desk\'s plan beside it, and History says his average; the page opens its own sheet before anything is disabled, previews with the function the Worker saves with, sends the add or trim, sizes at his average and hides the way back to the desk\'s plan once he has added or trimmed; the button is narrower than the other two and the three give up padding to fit a 320px screen; and the demo takes the same route with the same sentences',
    /data-act="profit">PROFIT<\/button><button type="button" class="btn big quiet scale" data-act="scale" aria-label="Add to or trim this trade">ADD\/TRIM<\/button><button type="button" class="btn big loss" data-act="loss">LOSS<\/button>/.test(card)
    && !/data-act="scale"/.test(openCard)
    && /Amount \$1,006 · 5 shares/.test(txt(card)) && /Stop \$198\.80/.test(txt(card)) && /Targets \$203\.60 then \$206\.00/.test(txt(card)) && /Risk \$12\.00/.test(txt(card))
    && /Your size\. 5 shares at an average of \$201\.20 after 1 add\. The desk had the stop at \$197\.00, targets \$209\.00 then \$215\.00\./.test(txt(card))
    && /at an average of \$201\.20 after 1 add and 1 trim\./.test(both)
    && /You put in \$1,006\.00, average \$201\.20, risked \$12\.00, stop \$198\.80/.test(hist)
    && /const kind = btn\.dataset\.act;\n  if \(kind === 'scale'\) \{ openScale\(btn\); return; \}\n  const saidEl/.test(APP)
    && /scalePosition\(\{ rec: r, \.\.\.b, accountCents: acct, rules: ctx\.rules \}\)/.test(APP) && /const out = await call\('scale', body\(\)\);/.test(APP)
    && /\.\.\.\(opt \? \{ contracts: numIn\(nIn\.value\) \} : \{ amountCents: dollarsIn\(nIn\.value\) \}\)/.test(APP)
    && /const at = scaled \? r\.mine\.entry : null;/.test(APP) && /\$\{r\.mine && !scaled \? '<button type="button" class="btn quiet wide" id="sz-reset"/.test(APP)
    && /html\[data-desk\]:root \.rec \.acts \.btn\.big\.scale \{ flex: 0 0 auto;/.test(CSS)
    && /html\[data-desk\]:root \.rec\.active \.acts \.btn\.big \{ min-width: 0; padding: 0 10px; \}/.test(CSS) && /@media \(max-width: 359px\) \{\n  html\[data-desk\]:root \.rec\.active \.acts \.btn\.big \{ padding: 0 6px;/.test(CSS)
    && /if \(sub === 'scale'\) \{[\s\S]*?if \(d\.status !== 'took'\) return fail\(409, SAY\.notScalable\);[\s\S]*?scalePosition\(\{ rec: d, kind: body\.kind/.test(D)
    && DS('notScalable') === K.SAY.notScalable && DS('scaledNoReset') === K.SAY.scaledNoReset
    && /if \(legs\.length && body\.reset === true\) return fail\(409, SAY\.scaledNoReset\);/.test(D)
    && ![card, both, hist].some((h) => DASH.test(h)),
    JSON.stringify({ note: (txt(card).match(/Your size\..*?\.\s.*?\./) || [''])[0], hist: (hist.match(/You put in[^.]*\./) || [''])[0] }));
}

// ---- T79: the GLP-1 chain in Settings (2026-09-24, v7.9) ---------------------------------------
// Eric: "I want GLp-1 pipeline stocks added to the search. Including HIMs." The run names it (desk.mjs
// D29); Settings shows it, from the one list, so what he reads is what the desk is told. The watchlist
// row said "Always priced" since before v7.2, when the run stopped pricing it: it says what it does now.
{
  const APP = f('public/js/admin-deskapp.js');
  // NEGATIVE CONTROL (run 2026-09-24): the GLP-1 chain block taken out of openSettings made this read
  //   FAIL  T79 the GLP-1 chain in Settings ...
  check('T79 the GLP-1 chain in Settings: its own section, drawn from the same list the run names, every role with its tickers, and it says a trade from it clears the same bar; the watchlist says it is named to the desk, no longer that it is priced',
    /import \{[^}]*\bGLP1_CHAIN\b[^}]*\} from '\.\/trade-math\.js';/.test(APP)
    && /<div><h2>GLP-1 chain<\/h2><div class="grp">/.test(APP)
    && /\$\{GLP1_CHAIN\.map\(\(g\) => `<span class="sub" style="margin-top:12px">\$\{esc\(g\.role\)\}<\/span><div class="watch">\$\{g\.tickers\.map\(\(t\) => `<span class="chip">\$\{esc\(t\)\}<\/span>`\)\.join\(''\)\}<\/div>`\)\.join\(''\)\}/.test(APP)
    && /From the makers to the sellers\. A trade from it clears the same 50% bar as any other\./.test(APP)
    && !/Always priced|prices these on every run|Tickers the desk prices/.test(APP) && /Named to the desk on every run\./.test(APP)
    && math.GLP1_CHAIN.find((g) => g.role === 'Sellers')?.tickers.includes('HIMS'),
    '');
}

// ---- T80: the re-check on the card, the board and History (2026-09-24, v7.10) ---------------------
// Eric, from a taken card's Chance: "If a new run disagrees with a strategy still on the table (0/5
// agents agree), then it is removed. If some agents still agree, update with the new number of agreeing
// agents. The number of agents that agree should be placed just under probability in the same font."
{
  const mod = await import('../../public/js/admin-desk.js');
  const ctx = { accountCents: 245000, rules: { riskPct: 3 } };
  const REC = { id: 'r1', ticker: 'BA', side: 'long', horizon: 'swing', instrument: 'stock', entryLow: 200.5, entryHigh: 203, stop: 197.4, targets: [206, 209], allocPct: 10, profitLow: 51, profitHigh: 56, agreement: 3 };
  const took = mod.recCardHtml({ ...REC, status: 'took', agreement: 2, tookAgreement: 3 }, ctx);
  const held = { ...REC, id: 'h1', status: 'took', agreement: 1, tookAgreement: 3 };
  const add = mod.recCardHtml({ ...REC, id: 'r2', status: 'open', adds: true, agreement: 2 }, { ...ctx, holding: new Map([[math.positionKey(held), held]]) });
  const txt = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const hist = txt(mod.historyRowHtml({ ...REC, status: 'closed', result: null, closedAt: '2026-09-24T16:02:00Z', dropped: { at: '2026-09-24T16:02:00Z', runId: 'run9' }, agreement: 0, tookAgreement: 3 }));
  const histPlain = txt(mod.historyRowHtml({ ...REC, status: 'closed', result: null, closedAt: '2026-09-24T16:02:00Z' }));
  const row = K.recRow('h1', { ...REC, status: 'closed', tookAgreement: 3, agreement: 0, agreedAt: new Date('2026-09-24T16:02:00Z'), dropped: { at: new Date('2026-09-24T16:02:00Z'), runId: 'run9' } });
  const now = at('2026-09-24T16:05:00Z');
  const { w, api } = world();
  w.docs.set('trade/settings', { data: { caseId: 'c1' }, updateTime: 'S1' });
  // RE-PINNED 2026-09-24 (v7.12): a run no longer drops a trade he took; the board carries its HOLD or SELL calls (T81).
  w.docs.set('trade/state', { data: { desk: { at: new Date(now - 60_000), ids: [], count: 0, verdicts: [{ ticker: 'F', horizon: 'intraday', side: 'long', instrument: 'stock', call: 'sell', why: 'Lost 11.' }, { ticker: 'XOM', horizon: 'weekly', call: 'maybe', why: 'x' }] }, activeIds: [] }, updateTime: 'T1' });
  const board = await api.tradeState(env, { now });
  const APP = f('public/js/admin-deskapp.js');
  const CSS = f('public/css/admin.css');
  // NEGATIVE CONTROL (run 2026-09-24): the count taken back out of the card's odds (`${agree ? ... : ''}` emptied there) made this read
  //   FAIL  T80 the re-check on the card ...
  // NEGATIVE CONTROL (run 2026-09-24): History's Dropped tag put back to Closed made this read
  //   FAIL  T80 the re-check on the card ...
  check('T80 the re-check on the card, the board and History: the count sits just under the chance in the chance\'s own type and the Desk row is gone; a taken trade shows the count the last run gave it; an add still says how many agreed when he took the one he holds, not the re-checked count; History still marks a trade dropped before v7.12 Dropped and says which run and why, and a plain closed one stays Closed; the row carries the count at the take and the drop; the board carries the run\'s calls, each read back as hold or sell; and the demo stands in for the count and the call without dropping anything',
    /<span class="odds"><span class="k">Chance<\/span><span class="v">51 to 56%<\/span><span class="v agree">2 of 5 agree<\/span><\/span>/.test(took)
    && !/<dt>Desk<\/dt>/.test(took + add) && !/\.agree\b/.test(CSS) && /html\[data-desk\]:root \.rec \.odds \.v \{ font-family: var\(--mono\); font-size: 14px;/.test(CSS)
    && /You already hold BA\. 3 of 5 agreed when you took it; 2 of 5 agree now\./.test(txt(add))
    && / Swing Dropped Entry /.test(hist) && /Dropped by the 10:02 AM run: none of the five backed it any more\./.test(hist) && /\bClosed\b/.test(histPlain) && !/Dropped/.test(histPlain)
    && row.tookAgreement === 3 && row.agreement === 0 && row.dropped?.runId === 'run9' && row.agreedAt === '2026-09-24T16:02:00.000Z'
    && K.recRow('x', { ...REC }).tookAgreement === null && K.recRow('x', { ...REC }).dropped === null
    && board.desk.verdicts.map((x) => `${x.ticker}/${x.horizon}/${x.call}`).join() === 'F/intraday/sell,XOM/intraday/hold'
    && /const DEMO_BACKING = \{ PLTR: 3, SOFI: 0 \};/.test(D) && !/status: 'closed', closedAt: new Date\(now\), result: null, agreement: 0/.test(D)
    && /const call = backs >= 3 \? 'hold' : 'sell';/.test(D)
    && /tookAgreement: Number\.isFinite\(Number\(d\.tookAgreement\)\)/.test(D) && /verdicts: Array\.isArray\(st\.desk\.verdicts\)/.test(D)
    && ![took, add, hist].some((h) => DASH.test(h)),
    JSON.stringify({ odds: (took.match(/<span class="odds">.*?<\/span><\/span>/) || [''])[0], hist: hist.slice(0, 200), verdicts: board.desk?.verdicts }));
}

// ---- T81: HOLD or SELL, front and center (2026-09-24, v7.12) -----------------------------------------
// Eric: "If I took a trade and scan, it should scan that same trade and tell me if I should hold or if
// things have changed and I need to sell, front and center." Asked what a SELL card does, he chose: it
// stays up in red until he marks PROFIT or LOSS.
{
  const mod = await import('../../public/js/admin-desk.js');
  const ctx = { accountCents: 245000, rules: { riskPct: 3 }, now: at('2026-09-24T18:00:00Z') };
  const REC = { id: 'h1', ticker: 'BA', side: 'long', horizon: 'swing', instrument: 'stock', entryLow: 200.5, entryHigh: 203, stop: 197.4, targets: [206, 209], allocPct: 10, profitLow: 51, profitHigh: 56, agreement: 2, status: 'took' };
  const sell = mod.recCardHtml({ ...REC, verdict: { call: 'sell', why: 'Lost 200 on volume.', at: '2026-09-24T16:02:00Z' } }, ctx);
  const hold = mod.recCardHtml({ ...REC, verdict: { call: 'hold', why: 'Still basing above 200.', at: '2026-09-23T16:02:00Z' } }, ctx);
  const cover = mod.recCardHtml({ ...REC, side: 'short', verdict: { call: 'sell', why: 'Squeezing.', at: '2026-09-24T16:02:00Z' } }, ctx);
  const fresh = mod.recCardHtml({ ...REC }, ctx);
  const open = mod.recCardHtml({ ...REC, status: 'open', verdict: { call: 'sell', why: 'x', at: '2026-09-24T16:02:00Z' } }, ctx);
  const row = K.recRow('h1', { ...REC, verdict: { call: 'sell', why: 'Lost 200.', at: new Date('2026-09-24T16:02:00Z'), runId: 'run9' } });
  const APP = f('public/js/admin-deskapp.js');
  const CSS = f('public/css/admin.css');
  // NEGATIVE CONTROL (run 2026-09-24): the verdict block taken out of the card (`${verdictHtml}` removed) made this read
  //   FAIL  T81 HOLD or SELL, front and center ...
  // NEGATIVE CONTROL (run 2026-09-24): the Active list's sell-first sort removed (`const active = st.active || [];`) made this read
  //   FAIL  T81 HOLD or SELL, front and center ...
  check('T81 HOLD or SELL, front and center: a taken trade opens with the last run\'s call, SELL NOW in red with its reason and the run\'s time, or HOLD in green, dated when it is not today\'s; a short stock says COVER NOW; a taken trade not yet re-checked says so and how to check it; a new suggestion carries no call; a SELL card is red all over; the row carries the call; the Active list puts sells first; and the landing says sell or cover and hold, and brings the list into view when there is a sell',
    /^<article class="outlined rec active sell"[^>]*>\s*<div class="verdict sell" role="status"><span class="call">SELL NOW<\/span><span class="why">Lost 200 on volume\.<\/span><span class="when">From the 10:02 AM run<\/span><\/div>\s*<div class="head">/.test(sell)
    && /<div class="verdict hold" role="status"><span class="call">HOLD<\/span><span class="why">Still basing above 200\.<\/span><span class="when">From the Sep 23 10:02 AM run<\/span><\/div>/.test(hold) && !/rec active sell/.test(hold)
    && /<span class="call">COVER NOW<\/span>/.test(cover)
    && /<div class="verdict none"><span class="why">Not re-checked yet\. RUN TRADING DESK checks it\.<\/span><\/div>/.test(fresh)
    && !/class="verdict/.test(open)
    && row.verdict?.call === 'sell' && row.verdict.why === 'Lost 200.' && row.verdict.at === '2026-09-24T16:02:00.000Z' && K.recRow('x', { ...REC }).verdict === null
    && /const active = \[\.\.\.\(st\.active \|\| \[\]\)\]\.sort\(\(a, b\) => \(b\.verdict\?\.call === 'sell'\) - \(a\.verdict\?\.call === 'sell'\)\);/.test(APP)
    && /`\$\{x\.instrument === 'stock' && x\.side === 'short' \? 'Cover' : 'Sell'\} \$\{x\.ticker\} now\.`/.test(APP) && /Hold \$\{holds\.join\(', '\)\}\./.test(APP)
    && /if \(sells\.length\) \$\('#active-wrap'\)\?\.scrollIntoView/.test(APP) && /html\[data-desk\]:root #active-wrap, html\[data-desk\]:root \.rec \{ scroll-margin-top: calc\(var\(--demo-bar-h, 0px\) \+ var\(--top-h\)/.test(CSS)
    && /html\[data-desk\]:root \.rec \.verdict\.sell \{ border-color: var\(--red\);/.test(CSS) && /html\[data-desk\]:root \.rec\.active\.sell \{ border-color: var\(--red\);/.test(CSS)
    && /html\[data-desk\]:root \.rec \.verdict \.call \{ font-family: var\(--display\); font-weight: 800; font-size: 26px;/.test(CSS)
    && ![sell, hold, cover, fresh].some((h) => DASH.test(h)),
    sell.slice(0, 400));
}

// ---- T67: the board in one read (2026-09-23, v7.2) ----------------------------------------------
// A request gets fifty outside calls, measured in production. The board used to read every card on
// its own, thirty taken trades and the last run's six, which was most of them. One batch read now,
// and while the researchers work their own document says how many are back, for this run only.
// NEGATIVE CONTROL (run 2026-09-23): tradeState's batch read put back to one tryGet per id made this read
//   FAIL  T67 the board is one read ...
// NEGATIVE CONTROL (run 2026-09-23): the count's `rdoc.data?.runId === st.run?.id` test dropped made this read
//   FAIL  T67 the board is one read ...
{
  const now = at('2026-09-23T16:00:00Z');
  const board = (run, research) => {
    const { w, api } = world();
    const taken = Array.from({ length: 30 }, (_, i) => `t${i}`);
    w.docs.set('trade/settings', { data: { caseId: 'c1' }, updateTime: 'S1' });
    w.docs.set('trade/state', { data: { desk: { at: new Date(now - 60_000), ids: ['a', 'b', 'c', 'd', 'e', 'f'], count: 6 }, activeIds: taken, run }, updateTime: 'T1' });
    const rec = (o) => ({ data: { ticker: 'NVDA', side: 'long', horizon: 'intraday', instrument: 'stock', entryLow: 1, entryHigh: 2, stop: 0.5, targets: [3], ...o }, updateTime: 'P' });
    for (const id of ['a', 'b', 'c', 'd', 'e', 'f']) w.docs.set(`trade/plays/items/${id}`, rec({ status: 'open', expiresAt: new Date(now + 3600_000) }));
    taken.forEach((id, i) => w.docs.set(`trade/plays/items/${id}`, rec({ status: 'took', tookAt: new Date(now - i * 1000) })));
    if (research) w.docs.set(DR.RESEARCH_PATH, { data: research, updateTime: 'R1' });
    return api.tradeState(env, { now }).then((st) => ({ st, w }));
  };
  const idle = await board({ status: 'idle' });
  const working = await board({ id: 'run9', status: 'researching', claimedAt: new Date(now - 60_000), done: 0 }, { runId: 'run9', r1: { status: 'ok' }, r2: { status: 'failed' }, r3: { status: 'ok' } });
  const other = await board({ id: 'run9', status: 'researching', claimedAt: new Date(now - 60_000), done: 0 }, { runId: 'run8', r1: { status: 'ok' }, r2: { status: 'ok' } });
  check('T67 the board is one read: thirty taken trades and six ideas cost one batch read beside the settings and the state, every one of them painted; while the researchers work the count back comes from their own document for this run, never another run\'s',
    idle.w.batchGets === 1 && idle.w.reads <= 3 && idle.st.active.length === 30 && idle.st.recs.length === 6
    && working.st.run.done === 2 && working.st.run.status === 'researching' && working.w.batchGets === 1
    && other.st.run.done === 0,
    JSON.stringify({ reads: idle.w.reads, batches: idle.w.batchGets, active: idle.st.active.length, done: working.st.run.done, other: other.st.run.done }));
}

// THE COUNTER IS COUNTED LAST (2026-09-22, v6.4). It used to be declared in the middle of the
// file, just above T51, so every check written after that line was printed but never counted: the
// suite said "57/57 passed" and exited 0 with a check reading FAIL on screen, and the battery that
// guards every push believed it. Found by a check that failed and was waved through.
const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
