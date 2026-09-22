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
const NAMES = ['patchDoc', 'deleteDoc', 'listDocs', 'tryGet', 'READ_FAILED', 'readFailedError', 'notifyUser',
  'markPending', 'diagLog', 'runTradeScan', 'pollScanFlight', 'isTradingDay', 'tradeMetrics', 'chartSeries', 'TARGET_DAILY', 'PROJECTION_MIN_DAYS', 'DEFAULT_START_CENTS', 'fetch', 'crypto',
  'putFile', 'patchObjectMeta', 'BUCKET', 'textPdf',
  // The calculator's arithmetic (2026-09-22), the same module the pages read.
  'rulesOf', 'RULE_RANGES', 'defaultRules', 'dayStatus', 'realizedToday', 'openRisk', 'tradeCalc', 'closePnl',
  'fmtMoney', 'fmtPct', 'HORIZONS', 'HORIZON_WORDS', 'horizonOf', 'horizonFor', 'swingLastDay', 'isMarketOpen', 'INSTRUMENTS',
  // The desk as one app (2026-09-22): his statistics and the big number.
  'tradeStats', 'liveBalance',
  // The note's cut, on the read side (2026-09-22, v6.9).
  'noteOnly', 'noteBullets'];
const EXPORTS = ['TRADE_MODEL', 'TRADE_EFFORT', 'TRADE_TZ', 'MARKET_OPEN', 'MARKET_CLOSE', 'STRONG_PROFIT_LOW', 'WATCHLIST_MAX', 'DEFAULT_WATCHLIST',
  'TRADE_WEB_SEARCH_TOOL', 'TRADE_CATEGORIES', 'DESK_NAME', 'SAY', 'SETTINGS_PATH', 'STATE_PATH', 'PLAYS', 'BALANCES',
  'TRADE_INSTRUCTIONS', 'TRADE_CONTRACT', 'TRADE_ASK_NOTE', 'realDate', 'dollars', 'stripDashes', 'sectionMatch', 'mtParts', 'mtInstant', 'mtLabel',
  'KEY_RE', 'keyTail', 'resolveKey', 'watchlistOf', 'startOf', 'marketSnapshot', 'deskMetrics', 'standingLine', 'tradeStanding', 'refreshStanding',
  'tradeNote', 'validPlay', 'validPortfolio', 'harvestPlays', 'recordPlays', 'recordPortfolio', 'scanVerdict', 'pushStrongPlay', 'fileDeskReading', 'portfolioLineOf',
  'TradeError', 'SCAN_CONTRACT', 'TRADE_STATE_PATH',
  'tradeOpen', 'tradeState', 'tradePanelBlock', 'tradeBalance', 'tradeSettings', 'tradePlay', 'tradeRoute', 'scanBlock',
  'harvestDocument', 'safeDocName', 'fileDocument', 'DOC_TITLE_MAX', 'DOC_BODY_MAX', 'DOC_DEFAULT_TITLE',
  'POSITIONS', 'QUOTE_TTL_MS', 'QUOTE_BUDGET', 'QUOTE_MAX', 'quoteCached', 'quoteBudgetLeft', 'rid',
  'readPositions', 'sortPositions', 'positionLine',
  'tradePositions', 'tradePosition', 'tradeClose', 'tradeRemove', 'tradeQuote',
  // The desk as one app (2026-09-22): the News, Stats and stream routes, the
  // cached feeds behind the first, and the one reading the cron books.
  'tradeNews', 'tradeHistory', 'tradeQa', 'HISTORY_MAX', 'QA_LIST_MAX',
  'maybeMorningRead', 'MORNING_MIN', 'MORNING_WINDOW_MIN', 'maybeCollectScan',
  'newsRows', 'earningsRows', 'newsCached', 'earningsCached', 'NEWS_HOURS', 'NEWS_MAX', 'NEWS_TTL_MS', 'EARNINGS_TTL_MS'];
const READ_FAILED = Symbol('read failed');
const BODY = `${strip(TD)}\n${strip(T)}`;

/** A world: recorders for every write, fixtures for every read, a fake market. */
function world(over = {}) {
  const w = {
    docs: new Map(), patches: [], deletes: [], pushes: [], diag: [], pending: [], scans: [], polls: [], fetches: [], puts: [], metas: [],
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
    READ_FAILED,
    readFailedError: (m) => new Error(m),
    notifyUser: async (env, uid, n) => { w.pushes.push({ uid, ...n }); },
    markPending: async (env, kind, id) => { w.pending.push({ kind, id }); },
    runTradeScan: async (env, caseId, opts) => { w.scans.push({ caseId, opts }); return over.scanOut || { ok: true, status: 'running' }; },
    pollScanFlight: async (env, caseId, opts) => { w.polls.push({ caseId, opts }); return over.pollOut !== undefined ? over.pollOut : true; },
    diagLog: async (env, e) => { w.diag.push(e); },
    isTradingDay: math.isTradingDay, tradeMetrics: math.tradeMetrics, chartSeries: math.chartSeries,
    TARGET_DAILY: math.TARGET_DAILY, PROJECTION_MIN_DAYS: math.PROJECTION_MIN_DAYS, DEFAULT_START_CENTS: math.DEFAULT_START_CENTS,
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
    tradeStats: math.tradeStats, liveBalance: math.liveBalance,
    noteOnly: math.noteOnly, noteBullets: math.noteBullets,
    ...(over.deps || {}),
  };
  const api = new Function('deps', `const { ${NAMES.join(', ')} } = deps;\n${BODY}\nreturn { ${EXPORTS.join(', ')} };`)(deps);
  return { w, api };
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
check('T1 the desk runs on the same model and effort as every other case for every turn, 55 as the strong line, eight trading categories, one web search tool of eight uses, and 2000 as the default start',
  K.TRADE_MODEL === 'claude-opus-5' && K.TRADE_EFFORT === 'max' && K.TRADE_TZ === 'America/Boise'
  && K.STRONG_PROFIT_LOW === 55 && K.DESK_NAME === 'Trade desk' && K.TRADE_CATEGORIES.join() === 'Setup,Indicator,Level,Order,Risk,Options,Market,Instrument'
  && K.TRADE_WEB_SEARCH_TOOL.type === 'web_search_20260209' && K.TRADE_WEB_SEARCH_TOOL.max_uses === 8
  // RE-PINNED 2026-09-22 (v5.2): his aim is a rule (2% by default), and the module's constant reads it.
  && math.TARGET_DAILY === 0.02 && math.defaultRules().dayAimPct === 2 && math.PROJECTION_MIN_DAYS === 14 && math.TRADING_DAYS_PER_YEAR === 252 && math.DEFAULT_START_CENTS === 200000
  && /^export const TRADE_EFFORT = 'max';$/m.test(TD) && !/TRADE_SCAN_EFFORT|TRADE_ASK_EFFORT|TRADE_FALLBACK_MODEL/.test(TD + T));

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

// NEGATIVE CONTROL (run 2026-09-22): the 409 mapping dropped from tradeScan, so a refused second tap answered 502, made this read
//   FAIL  T3 the scan route RUNS: no desk is a 404, a first tap starts one and says so, a second while it is in the air is refused with the sentence that says it lands on its own, and the route never touches the reading's queue
{
  const runScan = async (over = {}) => {
    const { w, api } = world(over);
    if (over.settings !== null) w.docs.set('trade/settings', { data: over.settings || { caseId: 'c1' }, updateTime: 'S1' });
    let err = null;
    let out = null;
    try { out = await api.tradeRoute(env, { sub: 'scan', method: 'POST', body: {}, now: at('2026-09-21T16:05:00Z') }); } catch (e) { err = e; }
    return { w, out, err };
  };
  const ok1 = await runScan();
  const noDesk = await runScan({ settings: {} });
  const busy = await runScan({ scanOut: { ok: false, why: K.SAY.scanRunning, status: 'running' } });
  check('T3 the scan route RUNS: no desk is a 404, a first tap starts one and says so, a second while it is in the air is refused with the sentence that says it lands on its own, and the route never touches the reading\'s queue',
    ok1.out?.ok === true && ok1.out.status === 'running' && ok1.out.caseId === 'c1'
    && ok1.w.scans.length === 1 && ok1.w.scans[0].caseId === 'c1' && ok1.w.pending.length === 0
    && noDesk.err?.status === 404 && noDesk.err.message === K.SAY.noDesk && noDesk.w.scans.length === 0
    && busy.err?.status === 409 && busy.err.message === 'A scan is already running. It lands on its own.',
    JSON.stringify({ ok: ok1.out, noDesk: noDesk.err?.message, busy: busy.err?.message }));
}

// NEGATIVE CONTROL (run 2026-09-22): '2026-09-07' removed from NYSE_HOLIDAYS made this read
//   FAIL  T4 a weekend and a holiday are not trading days, a Monday is, and the day after Thanksgiving closes early
check('T4 a weekend and a holiday are not trading days, a Monday is, and the day after Thanksgiving closes early',
  math.isTradingDay('2026-09-19') === false && math.isTradingDay('2026-09-20') === false
  && math.isTradingDay('2026-09-07') === false && math.isTradingDay('2026-09-21') === 'full'
  && math.isTradingDay('2026-11-27') === 'early' && math.isTradingDay('2027-07-05') === false && math.isTradingDay('nope') === false);

// T5 USED TO PIN WHICH SLOTS AN EARLY-CLOSE DAY GOT. In its place: what the scan's own contract is
// for, which is the half of the desk the reading is not. Eric, 2026-09-22: "when it runs it's just
// looking at new entries. Not doing an update like the advisor."
// NEGATIVE CONTROL (run 2026-09-22): '## Rules to hold' added to SCAN_CONTRACT's list of headings made this read
//   FAIL  T5 the scan's contract asks for three headings and nothing else: a note, at most four setups, the same Plays json the reading writes, no rules, no grading and no question
check('T5 the scan\'s contract asks for three headings and nothing else: a note, at most four setups, the same Plays json the reading writes, no rules, no grading and no question',
  /## Note\n## Setups\n## Plays/.test(K.SCAN_CONTRACT)
  && !/## Right now|## Your trades|## Where you are slipping|## Rules to hold|## Key terms|## Working line|## Corrections/.test(K.SCAN_CONTRACT)
  && /this is a scan, not a reading/.test(K.SCAN_CONTRACT)
  && /do not revise his rules/.test(K.SCAN_CONTRACT) && /You never ask him a question/.test(K.SCAN_CONTRACT)
  && /an empty scan is a real answer and a filler setup costs him money/.test(K.SCAN_CONTRACT)
  && /"Setups": at most 4/.test(K.SCAN_CONTRACT)
  && /portfolio is always null on a scan/.test(K.SCAN_CONTRACT)
  // The three kinds and the weekend ride the scan too, word for word off the reading's contract.
  && /a scalp lives one to ten minutes/.test(K.SCAN_CONTRACT) && /Never write a swing that would be held over a Saturday/.test(K.SCAN_CONTRACT)
  && /never an em dash or an en dash/.test(K.SCAN_CONTRACT) && !DASH.test(K.SCAN_CONTRACT));

// T6 USED TO PIN WHETHER A READING WAS OWED AT A SLOT. In its place: what the pages read to know
// whether a scan is in the air, which is the only state a button needs.
// NEGATIVE CONTROL (run 2026-09-22): scanBlock's `st.scanStatus === 'running' ? 'running'` branch dropped made this read
//   FAIL  T6 scanBlock reads the desk's state for the button: running, error with its sentence, or idle with the last note, its stamp and what it filed, and a refused read is idle rather than a lie
check('T6 scanBlock reads the desk\'s state for the button: running, error with its sentence, or idle with the last note, its stamp and what it filed, and a refused read is idle rather than a lie',
  K.scanBlock({ data: { scanStatus: 'running' } }).status === 'running'
  && K.scanBlock({ data: { scanStatus: 'error', scanError: 'Could not scan.' } }).status === 'error'
  && K.scanBlock({ data: { scanStatus: 'error', scanError: 'Could not scan.' } }).error === 'Could not scan.'
  && K.scanBlock(null).status === 'idle' && K.scanBlock(null).note === null && K.scanBlock(null).at === null
  && K.scanBlock(READ_FAILED).status === 'idle'
  && (() => {
    const b = K.scanBlock({ data: { scanStatus: 'idle', lastScanAt: new Date('2026-09-21T16:05:00Z'), scanNote: { text: '## Note\n\nQuiet.', at: new Date('2026-09-21T16:05:00Z'), plays: 2 } } });
    // RE-PINNED 2026-09-22 (v6.9): the read cuts the note to the Note section and hands the page
    // its bullets, so the heading is gone from the text and the one line is the one bullet.
    return b.status === 'idle' && b.at === '2026-09-21T16:05:00.000Z' && b.note.plays === 2 && b.note.text === 'Quiet.'
      && Array.isArray(b.note.bullets) && b.note.bullets.join('|') === 'Quiet.';
  })());

// T7 USED TO RUN THE CRON'S MINUTE. There is no minute. In its place: both reads carry the scan
// block, so the Read page, the Plays page and the overview all paint the same button from one poll.
// NEGATIVE CONTROL (run 2026-09-22): `scan: scanBlock(stateDoc)` dropped from tradeState made this read
//   FAIL  T7 the state and the panel block both carry the scan, and the state reads it from the desk's own document
{
  const { w, api } = world();
  w.docs.set('trade/settings', { data: { caseId: 'c1', accountType: 'margin', startCents: 200000, startedAt: '2026-09-01' }, updateTime: 'S1' });
  w.docs.set('trade/state', { data: { scanStatus: 'idle', lastScanAt: new Date('2026-09-21T16:05:00Z'), scanNote: { text: 'Quiet tape.', at: new Date('2026-09-21T16:05:00Z'), plays: 1 } }, updateTime: 'T1' });
  w.docs.set('caseMeta/c1', { data: { tradeStanding: { text: 'up' } } });
  const st = await api.tradeState(env, { now: at('2026-09-21T16:05:00Z') });
  const panel = await api.tradePanelBlock(env, { now: at('2026-09-21T16:05:00Z') });
  check('T7 the state and the panel block both carry the scan, and the state reads it from the desk\'s own document',
    st.scan?.status === 'idle' && st.scan.note?.plays === 1 && st.scan.at === '2026-09-21T16:05:00.000Z'
    && st.nextSlot === undefined && st.settings.scansOn === undefined
    && panel.scan?.status === 'idle' && panel.scan.note?.text === 'Quiet tape.'
    && panel.nextSlot === undefined && panel.scansOn === undefined,
    JSON.stringify({ state: st.scan, panel: panel.scan }));
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
  && /^import \{\n\s+TRADE_MODEL, TRADE_EFFORT, TRADE_WEB_SEARCH_TOOL, TRADE_INSTRUCTIONS, TRADE_CONTRACT, TRADE_ASK_NOTE, TRADE_CATEGORIES,\n\s+SCAN_CONTRACT, TRADE_STATE_PATH, SAY as TRADE_SAY,\n\s+tradeNote, harvestPlays, fileDeskReading, portfolioLineOf, recordPortfolio, dollars as deskDollars,\n\s+harvestDocument, fileDocument, stripDashes as deskStripDashes,\n\} from '\.\/trade-desk\.js';/m.test(ADV)
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
    && !!c && c.data.self === true && c.data.trade === true && c.data.clientUid === null && c.data.clientEmail === null && c.data.clientName === 'Trade desk'
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
  const src = lift(W, 'async function handleTrade(request, env, url) {');
  const run = async ({ admin, route }) => {
    const calls = [];
    const api = new Function('deps', `const { requireAdmin, json, tradeRoute, TradeError } = deps;\n${src}\nreturn handleTrade;`)({
      requireAdmin: async () => admin, json: (data, status = 200) => ({ data, status }),
      tradeRoute: async (env2, args) => { calls.push(args); return route(args); }, TradeError: K.TradeError,
    });
    const req = (method) => ({ method, json: async () => ({}) });
    const out = {};
    // Re-pinned 2026-09-22 (v5.2): the query string rides too, for the quote route.
    for (const [m, p] of [['GET', 'state'], ['POST', 'open'], ['POST', 'nope'], ['GET', '']]) out[`${m} ${p}`] = await api(req(m), env, { pathname: `/api/admin/trade/${p}`, searchParams: new URLSearchParams('symbols=NVDA') });
    return { out, calls };
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
    && /if \(url\.pathname\.startsWith\('\/api\/admin\/trade\/'\)\)\n\s+return await handleTrade\(request, env, url\);/.test(W)
    && /return json\(\{ error: err\.message, \.\.\.\(err\.extra \|\| \{\}\) \}, err\.status\);/.test(W),
    JSON.stringify({ stranger: Object.values(stranger.out).map((r) => r.status), him: Object.values(him.out).map((r) => r.status), gone }));
}
{
  const { w, api } = world();
  w.docs.set('trade/settings', { data: { caseId: 'c1', finnhubKey: 'abcd1234wxyz', accountType: 'margin', startCents: 250000, startedAt: '2026-08-31', watchlist: ['SPY'], scansOn: false } });
  w.docs.set('caseMeta/c1', { data: { tradeStanding: { text: 'STANDING', at: '2026-09-21T00:00:00Z' } } });
  w.listed['trade/plays/items'] = [{ id: 'p1', data: { ticker: 'NVDA', status: 'open' } }];
  w.listed['trade/balances/items'] = FIX.map((b) => ({ id: b.date, data: { ...b, source: b.date === '2026-09-21' ? 'screenshot' : 'typed' } }));
  const payload = await api.tradeState(env, { now: at('2026-09-21T15:35:00Z') });
  const block = await api.tradePanelBlock(env, { now: at('2026-09-21T15:35:00Z') });
  const raw = JSON.stringify(payload) + JSON.stringify(block);
  // NEGATIVE CONTROL (run 2026-09-22): `settings: pub` replaced by `settings: { ...settings, ...pub }` in tradeState made this read
  //   FAIL  T26 the state carries the desk's case, whether a key is on file and its last four characters and never the key, the settings, the plays, the entries each with its source, the metrics from his own start, the chart, the scan and the day, and no feed, flights or unseen; the panel's block carries the plays, the standing off the cover, the scan and the push switch
  // RE-PINNED 2026-09-22 (nothing runs but his tap): the next read and the Pause are gone from both
  // reads, and the scan block stands where they were.
  check('T26 the state carries the desk\'s case, whether a key is on file and its last four characters and never the key, the settings, the plays, the entries each with its source, the metrics from his own start, the chart, the scan and the day, and no feed, flights or unseen; the panel\'s block carries the plays, the standing off the cover, the scan and the push switch',
    !/abcd1234wxyz/.test(raw) && !/abcd1234/.test(raw) && payload.hasKey === true && payload.keyTail === 'wxyz' && payload.caseId === 'c1'
    && payload.settings.accountType === 'margin' && payload.settings.startCents === 250000 && payload.settings.watchlist.join() === 'SPY'
    && payload.settings.scansOn === undefined && payload.scansOn === undefined && payload.nextSlot === undefined
    && payload.metrics.startCents === 250000 && payload.metrics.days === 14 && payload.chart.target.length === 15 && payload.balances.length === 5
    && payload.balances[4].source === 'screenshot' && payload.balances[0].source === 'typed' && payload.plays[0].id === 'p1'
    && payload.scan.status === 'idle' && payload.tradingDay === 'full' && payload.today === '2026-09-21'
    && !('feed' in payload) && !('flights' in payload) && !('unseen' in payload)
    && block.plays.length === 1 && block.standing.text === 'STANDING' && block.scan.status === 'idle' && block.nextSlot === undefined && block.scansOn === undefined && block.pushOn === true && block.hasKey === true && block.today === '2026-09-21',
    JSON.stringify({ hasKey: payload.hasKey, tail: payload.keyTail, scan: payload.scan, block: Object.keys(block) }));
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
  const low = await run((api) => api.tradeSettings(env, { startCents: 50 }));
  const start = await run((api) => api.tradeSettings(env, { startCents: 300000, startedAt: '2026-09-01' }), { caseId: 'c1', finnhubKey: 'abcdefghijklmnop1234', startedAt: '2026-08-31' });
  const hijack = await run((api) => api.tradeSettings(env, { pushOn: false, caseId: 'hijack' }), { caseId: 'c1', startedAt: '2026-08-31' });
  const patchOf = (w) => w.patches.find((p) => p.path === 'trade/settings');
  // NEGATIVE CONTROL (run 2026-09-22): the watchlist cap raised to 21 made this read
  //   FAIL  T27 settings refuse a bad key, a 21st ticker, a third account type and a start under a dollar, each with its sentence; a list is uppercased and deduped; a moved start refreshes the cover's standing; the settings take no Pause; the case id is never taken from a body; the reply never carries the key
  // RE-PINNED 2026-09-22 (nothing runs but his tap): scansOn was the Pause on a clock that is gone,
  // so the hijack attempt rides the push switch instead and the settings refuse the field entirely.
  check('T27 settings refuse a bad key, a 21st ticker, a third account type and a start under a dollar, each with its sentence; a list is uppercased and deduped; a moved start refreshes the cover\'s standing; the settings take no Pause; the case id is never taken from a body; the reply never carries the key',
    badKey.threw?.message === K.SAY.badKey && badKey.threw.status === 400 && badKey.w.patches.length === 0
    && list.out.settings.watchlist.join() === 'NVDA,TSLA' && patchOf(list.w).data.watchlist.join() === 'NVDA,TSLA' && patchOf(list.w).data.setByHand === true
    && many.threw?.message === K.SAY.badWatchlist && acct.threw?.message === K.SAY.badAccount && low.threw?.message === K.SAY.badStart
    && patchOf(start.w).data.startCents === 300000 && patchOf(start.w).data.startedAt === '2026-09-01' && start.out.settings.startCents === 300000
    && start.w.patches.some((p) => p.path === 'caseMeta/c1' && p.data.tradeStanding)
    && start.out.hasKey === true && start.out.keyTail === '1234' && !/abcdefghijklmnop1234/.test(JSON.stringify(start.out))
    && patchOf(hijack.w).data.pushOn === false && hijack.out.settings.pushOn === false
    && !('caseId' in patchOf(hijack.w).data) && !patchOf(hijack.w).opts.mask.includes('caseId')
    && !('scansOn' in patchOf(hijack.w).data) && hijack.out.settings.scansOn === undefined
    && !hijack.w.patches.some((p) => p.path === 'caseMeta/c1'),
    JSON.stringify({ list: list.out?.settings.watchlist, start: start.out?.settings.startCents, hijack: patchOf(hijack.w)?.data }));

  const NOW = at('2026-09-21T20:00:00Z');
  const up = await run((api) => api.tradeBalance(env, { date: '2026-09-21', cents: 238000, note: 'after close — done' }, NOW), { caseId: 'c1' });
  const rm = await run((api) => api.tradeBalance(env, { date: '2026-09-21', remove: true }, NOW), { caseId: 'c1' });
  const future = await run((api) => api.tradeBalance(env, { date: '2026-09-22', cents: 1 }, NOW));
  const neg = await run((api) => api.tradeBalance(env, { date: '2026-09-21', cents: -1 }, NOW));
  const junk = await run((api) => api.tradeBalance(env, { date: '2026-02-30', cents: 1 }, NOW));
  // NEGATIVE CONTROL (run 2026-09-22): `source: 'typed'` dropped from the typed balance's row made this read
  //   FAIL  T28 a balance he types is upserted at its date path stamped typed with a dash-free note and the cover's standing refreshed, removed by date with the standing refreshed again, and refused for tomorrow, a negative figure or a date that does not exist, each with its sentence
  check('T28 a balance he types is upserted at its date path stamped typed with a dash-free note and the cover\'s standing refreshed, removed by date with the standing refreshed again, and refused for tomorrow, a negative figure or a date that does not exist, each with its sentence',
    up.out.ok === true && up.w.patches[0].path === 'trade/balances/items/2026-09-21' && up.w.patches[0].data.cents === 238000 && up.w.patches[0].data.source === 'typed' && !DASH.test(up.w.patches[0].data.note)
    && up.w.patches.some((p) => p.path === 'caseMeta/c1' && p.data.tradeStanding?.text) && up.out.standing?.text
    && rm.out.removed === '2026-09-21' && rm.w.deletes[0] === 'trade/balances/items/2026-09-21' && rm.w.patches.some((p) => p.path === 'caseMeta/c1')
    && future.threw?.message === K.SAY.badDate && neg.threw?.message === K.SAY.badCents && junk.threw?.message === K.SAY.badDate,
    JSON.stringify({ up: up.out, rm: rm.out, future: future.threw?.message }));

  const withPlay = async (fn, status = 'open') => run((api, w) => { w.docs.set('trade/plays/items/p1', { data: { ticker: 'NVDA', status, tookAt: null } }); return fn(api); });
  const took = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'took' }));
  const late = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'took' }), 'expired');
  const closed = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'closed', outcomeCents: 4500 }));
  const noOut = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'closed' }));
  const skip = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'skipped' }));
  const gone = await run((api) => api.tradePlay(env, { id: 'p9', status: 'took' }));
  const badStatus = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'sold' }));
  // NEGATIVE CONTROL (run 2026-09-22): `closed` accepted without outcomeCents made this read
  //   FAIL  T29 a play taken stamps when, an expired play still takes it, closed needs the dollars and stamps both, skipped is skipped, an unknown play is 404 and a fourth status is refused, each with its sentence
  check('T29 a play taken stamps when, an expired play still takes it, closed needs the dollars and stamps both, skipped is skipped, an unknown play is 404 and a fourth status is refused, each with its sentence',
    took.out.play.status === 'took' && took.w.patches[0].data.tookAt instanceof Date && took.w.patches[0].opts.mask.join() === 'status,tookAt'
    && late.out.play.status === 'took'
    && closed.out.play.outcomeCents === 4500 && closed.w.patches[0].data.closedAt instanceof Date && closed.w.patches[0].data.tookAt instanceof Date
    && noOut.threw?.message === K.SAY.badOutcome && skip.out.play.status === 'skipped'
    && gone.threw?.message === K.SAY.noPlay && gone.threw.status === 404 && badStatus.threw?.message === K.SAY.badStatus,
    JSON.stringify({ took: took.out?.play.status, late: late.out?.play.status, closed: closed.out?.play.outcomeCents }));
}

// ---- T30: the Worker's hooks and refusals ------------------------------------------------
// NEGATIVE CONTROL (run 2026-09-22): the `maybeTradeScan(env, fired)` line removed from scheduled() made this read
//   FAIL  T30 the Worker imports the desk's routes, panel block and categories, books nothing on the desk at the cron's minute, no longer polls any desk flight, hands the panel the desk's block and the trading half of the glossary on a desk, prints the standing on the covers, refuses to pull from the desk or continue it, and a deleted desk clears the settings' pointer
// NEGATIVE CONTROL (run 2026-09-22): `ctx.waitUntil(maybeTradeScan(env, fired).catch(() => {}));` put back into scheduled() made this read
//   FAIL  T30 the Worker imports the desk's routes, panel block and categories, books nothing on the desk at the cron's minute, no longer polls any desk flight, ...
// RE-PINNED 2026-09-22 (v6.0, the desk as one app): the cron books ONE thing on the desk, the
// morning reading Eric asked for at 7:00 Mountain, and the state route collects a scan his tap put
// in the air so the page does not wait for the cron.
check('T30 the Worker imports the desk\'s routes, panel block, morning reading and categories, books the 7:00 reading at the cron\'s firing, polls a scan in flight on the state route and re-reads the block, hands the panel the desk\'s block and the trading half of the glossary on a desk, prints the standing on the covers, refuses to pull from the desk or continue it, and a deleted desk clears the settings\' pointer',
  // RE-PINNED 2026-09-22 (v6.3): the cron also collects a scan already in the air, asking the desk
  // rather than the queue, because a flight whose queue row had gone was invisible to every clock.
  // NEGATIVE CONTROL (run 2026-09-22, v6.3): the collector's waitUntil replaced with a resolved
  // promise made this read
  //   FAIL  T30 the Worker imports the desk's routes, panel block, morning reading and categories, ...
  /import \{ tradeRoute, TradeError, tradePanelBlock, maybeMorningRead, maybeCollectScan \} from '\.\/trade\.js';\nimport \{ TRADE_CATEGORIES, SAY as TRADE_SAY \} from '\.\/trade-desk\.js';/.test(W)
  && !/maybeTradeScan/.test(W)
  && /ctx\.waitUntil\(maybeMorningRead\(env\)\.catch\(\(\) => \{\}\)\);/.test(W)
  && /ctx\.waitUntil\(maybeCollectScan\(env\)\.catch\(\(\) => \{\}\)\);/.test(W)
  && /pollCaseFlight, pollFlightsNow, pollAskFlight, pollScanFlight,/.test(W)
  && /if \(tradeBlock\?\.scan\?\.status === 'running' && await pollScanFlight\(env, id\)\.catch\(\(\) => false\)\) \{\n\s+tradeBlock = await tradePanelBlock\(env\)\.catch\(\(\) => tradeBlock\);\n\s+\}/.test(W)
  && !/pollTradeFlights/.test(W) && !/pollTradeFlights|submitTradeBatch|tradeAsk|tradeSeen|tradeScanNow|trade\/feed|trade\/flights/.test(T)
  && /const trade = !!state\?\.data\.trade;\n\s+const terms = knowledge\.filter\(\(r\) => TRADE_CATEGORIES\.includes\(String\(r\.data\.category \|\| ''\)\) === trade\);\n\s+let tradeBlock = trade \? await tradePanelBlock\(env\)\.catch\(\(\) => null\) : null;/.test(W)
  && /state: panelState,\n\s+trade: tradeBlock,/.test(W) && /glossary: terms\.map\(\(r\) => \(\{/.test(W)
  && /by: dx\?\.by \|\| 'advisor',\n(?:\s*\/\/[^\n]*\n)*\s+tradeStanding: r\.data\.tradeStanding\?\.text \|\| '',/.test(W)
  && /if \(c\.data\.trade\) return \{ error: TRADE_SAY\.noPull, cases: \[\] \};/.test(W)
  && /if \(doc\.data\.trade\) return json\(\{ error: TRADE_SAY\.noNext \}, 409\);/.test(W)
  && /^\/\/   GET\/POST \/api\/admin\/trade\/\* /m.test(W)
  && /const desk = await getDoc\(env, 'trade\/settings'\)\.catch\(\(\) => null\);\n\s+if \(desk\?\.data\.caseId === id\)\n\s+await patchDoc\(env, 'trade\/settings', \{ caseId: null \}, \{ mask: \['caseId'\] \}\)\.catch\(\(\) => \{\}\);\n\s+return \{ docs: deleted, files: files\.length \};/.test(SHOW)
  // RE-PINNED 2026-09-22 (v6.3): the desk's module also takes the scan poller, because the cron's
  // collector lives beside the morning reading and asks the desk rather than the queue.
  && /^export function client\(env\) \{/m.test(ADV) && /^export async function markPending\(/m.test(ADV) && /import \{ markPending, diagLog, runTradeScan, pollScanFlight \} from '\.\/advisor\.js';/.test(T));

// ---- T31 to T34: the shelf, the page, the panel, the desk's module ----------------------
// NEGATIVE CONTROL (run 2026-09-22): `if (c.trade) return 'TRADE DESK';` removed from badge() made this read
//   FAIL  T31 the shelf: the desk is off his own shelf and off the pull-from picker, on its own green shelf with its standing on the line, badged TRADE DESK before his own case, a green door posts to open and walks into a desk already open, the card wears the green class after the purple, and the four schemes each name the green
check('T31 the shelf: the desk is off his own shelf and off the pull-from picker, on its own green shelf with its standing on the line, badged TRADE DESK before his own case, a green door posts to open and walks into a desk already open, the card wears the green class after the purple, and the four schemes each name the green',
  /const mine = cases\.filter\(\(c\) => c\.self && !c\.trade && c\.status !== 'closed'\);/.test(ADMIN)
  && /const ownAll = cases\.filter\(\(c\) => c\.self && !c\.trade\)/.test(ADMIN)
  && /const desks = cases\.filter\(\(c\) => c\.trade\)/.test(ADMIN) && /section\('TRADE DESK', 'var\(--trade\)', \[/.test(ADMIN)
  && /one reading at 7:00 Mountain; everything else waits for your tap/.test(ADMIN)
  // RE-PINNED 2026-09-22 (v6.0): the desk's card, and the door, open its own page.
  && /href: c\.trade \? `\/admin-desk\.html\?id=\$\{c\.id\}` : `\/admin-case\.html\?id=\$\{c\.id\}`,/.test(ADMIN)
  && /location\.href = `\/admin-desk\.html\?id=\$\{encodeURIComponent\(id\)\}`;/.test(ADMIN)
  && /data-open-trade>📈 Open my trade desk<\/button>/.test(ADMIN) && /\(deskOpen\.length \? '' : `<div class="open-doors">/.test(ADMIN)
  && /fetch\('\/api\/admin\/trade\/open', \{/.test(ADMIN) && /const id = res\.ok \? out\.id : \(res\.status === 409 && out\.existing \? out\.existing : null\);/.test(ADMIN)
  && /listEl\.innerHTML = attBlock \+ todayBlock \+ selfBlock \+ tradeBlock \+/.test(ADMIN)
  && /function badge\(c\) \{\n\s+if \(c\.trade\) return 'TRADE DESK';\n\s+if \(c\.self\) return 'MY OWN CASE';/.test(ADMIN)
  && /trade: !!c\.trade,\n(?:\s*\/\/[^\n]*\n)*\s+meta: c\.trade \? \(cover\.tradeStanding \|\| 'no reading yet'\) : '',/.test(ADMIN)
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

{
  const m = math.tradeMetrics(FIX, { startedAt: '2026-08-31' });
  const c = math.chartSeries(m);
  const mod = await import('../../public/js/admin-desk.js');
  const svg = mod.deskChartSvg(c);
  const svgAim = mod.deskChartSvg(c, { aim: '2.5%' });
  const play = { id: 'p1', ...K.validPlay(PLAY), status: 'open' };
  const rules = math.defaultRules();
  const card = mod.playFaceHtml(play, { rules, accountCents: 238000 });
  // A stock setup is a dollar figure to him and never a share count (2026-09-22).
  const stockPlay = { id: 'p9', ...K.validPlay({ ...PLAY, instrument: 'stock', structure: 'shares', strike: null, strike2: null, optionType: null, expiry: null, allocPct: 21, entry: 228.9, stop: 226.3, targets: [231.5] }), status: 'open' };
  const stockCard = mod.playFaceHtml(stockPlay, { rules, accountCents: 449000 });
  // An allocation that risks more than his one trade rule says so on its face.
  const overCard = mod.playFaceHtml({ ...stockPlay, allocPct: 90 }, { rules, accountCents: 449000 });
  const expired = mod.playFaceHtml({ ...play, id: 'p2', status: 'expired' }, { rules, accountCents: 238000 });
  // The one from his screenshot (2026-09-22): still marked open, but its hour has gone. That is
  // the card that sat at the top of his board saying Expired with Take it still on it.
  const ranOut = mod.playFaceHtml({ ...play, id: 'p5', status: 'open', expiresAt: new Date(Date.now() - 3600_000) }, { rules, accountCents: 238000 });
  const took = mod.playFaceHtml({ ...play, id: 'p3', status: 'took' }, { rules, accountCents: 238000 });
  const closedPlay = mod.playFaceHtml({ ...play, id: 'p4', status: 'closed', outcomeCents: 4500 }, { rules, accountCents: 238000 });
  const pos = { id: 't1', ticker: 'NVDA', side: 'long', instrument: 'stock', horizon: 'intraday', qty: 10, entry: 648.4, stop: 646.9, target: 652, mark: null, status: 'open' };
  const quote = { ticker: 'NVDA', last: 651.2, high: 653.8, low: 646.1, chgPct: 0.43 };
  const posCalc = math.tradeCalc({ pos, rules, accountCents: 238000, quote });
  const posCard = mod.positionFaceHtml(pos, posCalc, { quote });
  const soldCard = mod.positionFaceHtml({ ...pos, status: 'closed', pnlCents: 2800, exitPrice: 651.2, closeNote: 'Out at the second target.' }, posCalc, {});
  // The seven readings of the day bar, in one pass.
  const bar = (state, real, gold = false) => mod.dayBarState({ state, realizedTodayCents: real }, gold);
  const bars = {
    stopLoss: bar('stop-loss', -12000), underNeg: bar('below-floor', -500), underPos: bar('below-floor', 500),
    floor: bar('on-floor', 4000), aim: bar('on-aim', 8000), gold: bar('on-aim', 12000, true), cap: bar('stop-cap', 40000),
  };
  // NEGATIVE CONTROL (run 2026-09-22): `var(--gold)` replaced by `#FFD166` on the target polyline made this read
  //   FAIL  T34 the desk's view module RUNS: the chart is one SVG of five polylines with every colour a token and no hex, and says the aim in words; a play card leads with the ticker, the side, the kind and the odds, carries entry, target, stop and the risk in his dollars, hides the seven setup rows behind a tap, and offers Take it and Skip until it is taken, then Closed at; an expired card says so; a closed one reads its dollars; a position card carries its figures, its ladder and its edit grid, and a sold one says what it sold at; and the day bar answers with a colour, a glow and a word in all seven states
  check('T34 the desk\'s view module RUNS: the chart is one SVG of five polylines with every colour a token and no hex, and says the aim in words; a play card leads with the ticker, the side, the kind and the odds, carries entry, target, stop and the risk in his dollars, hides the seven setup rows behind a tap, and offers Take it and Skip until it is taken, then Closed at; an expired card says so; a closed one reads its dollars; a position card carries its figures, its ladder and its edit grid, and a sold one says what it sold at; and the day bar answers with a colour, a glow and a word in all seven states',
    /^<svg id="chart-svg" viewBox="0 0 340 190"/.test(svg.trim())
    && (svg.match(/<polyline /g) || []).length === 5 && /stroke="var\(--gold\)"/.test(svg) && /fill="var\(--green\)"/.test(svg)
    && !/#[0-9a-fA-F]{3,6}\b/.test(svg) && mod.deskChartSvg(null) === '' && mod.deskChartSvg({ points: [] }) === ''
    && /against the 2% a day line/.test(svg) && /against the 2\.5% a day line/.test(svgAim)
    // RE-PINNED 2026-09-22 (v6.7, Eric: "Make the plays fucking plain English. For example. 3
    // hours, NVDA, $248, stop loss price, take profit price. If call, date strike expiration.").
    // The face is his sentence and one line under it. The odds block, the two chips, the why line
    // and all five cells are gone, because every one of them was a thing he had to translate.
    && /<p class="plain">3 hours, buy \$419 of the NVDA 650\/655 call debit spread expiring 17 Oct, stop loss 1\.30, take profit 3\.40<\/p>/.test(card)
    // RE-PINNED 2026-09-22 (v6.8, Eric: "Why is the confidence interval gone"): the chance is back
    // top right in the kind colour on every card, and OUT of the small line, so it is said once and
    // where he reads it. It is the only block back; the tags, cells and why line stay gone.
    // NEGATIVE CONTROL (run 2026-09-22, v6.8): the odds span dropped from the head row made this read
    //   FAIL  T34 the desk's view module RUNS: ...
    // RE-PINNED 2026-09-22 (v6.11, Eric: "Stock names have disappeared"): the ticker leads the head
    // row on every card, 20px bold at the left, with the chance at the right and the state word
    // between when there is one. Nothing else comes back.
    // NEGATIVE CONTROL (run 2026-09-22, v6.11): the tk span dropped from the head row made this read
    //   FAIL  T34 the desk's view module RUNS: ...
    && /<div class="head"><span class="tk">NVDA<\/span><span class="odds"><div class="k">Chance<\/div><div class="v">56 to 64%<\/div><\/span><\/div>\n\s+<p class="plain">/.test(card)
    && /<p class="under over">Get in near 2\.10\. You lose about \$80\.00 if the stop hits\. That is more than the \$23\.80 you allow one trade\.<\/p>/.test(card)
    && !/Chance of profit/.test(card)
    && /<div class="head"><span class="tk">NVDA<\/span><span class="co">Expired<\/span><span class="odds">/.test(ranOut)
    && !/class="tags"/.test(card) && !/class="cells"/.test(card) && !/class="why"/.test(card)
    && /<p class="plain">3 hours, buy \$943 of NVDA, stop loss 226\.30, take profit 231\.50<\/p>/.test(stockCard)
    && /You lose about \$10\.71 if the stop hits\./.test(stockCard) && !/ sh</.test(stockCard)
    && /<p class="under over">/.test(overCard)
    && ['Why', 'Catalyst', 'Bull', 'Bear', 'Levels', 'Risk', 'Watch', 'Overnight'].every((k) => card.includes(`<dt>${k}</dt>`))
    && /648 · 650 · 652 · 655/.test(card) && /data-act="take"[^>]*>Take it</.test(card) && /data-act="skip">Skip</.test(card) && !/data-act="closed"/.test(card)
    // RE-PINNED 2026-09-22 (v6.7): an expired setup has no Take it on it, because it is not a
    // setup any more. It says Expired and waits in Recent.
    // NEGATIVE CONTROL (run 2026-09-22, v6.7): the card's `&& !expired` dropped from `live`, so a
    //   setup whose hour had gone still offered Take it, made this read
    //   FAIL  T34 the desk's view module RUNS: ...
    && /class="outlined play expired"/.test(expired) && />Expired</.test(expired) && !/data-act="take"/.test(expired)
    && /class="outlined play expired"/.test(ranOut) && />Expired</.test(ranOut)
    && !/data-act="take"/.test(ranOut) && !/data-act="skip"/.test(ranOut)
    && />Taken</.test(took) && /data-act="closed">Closed at</.test(took)
    && /Closed \+\$45\.00/.test(closedPlay) && !/data-act=/.test(closedPlay)
    && /data-pos="t1"/.test(posCard) && /<span class="u up">\+\$28\.00<\/span>/.test(posCard) && /<span class="r">1\.9R<\/span>/.test(posCard)
    && /<div class="v stop">646\.9<\/div>/.test(posCard) && /class="editgrid" hidden/.test(posCard) && /data-act="close">Close Position</.test(posCard)
    && /class="outlined pos closed"/.test(soldCard) && /Out at the second target\./.test(soldCard) && !/data-act="close"/.test(soldCard)
    && bars.stopLoss.fill === 'var(--red)' && /loss limit is hit/.test(bars.stopLoss.word)
    && bars.underNeg.ink === 'var(--red)' && bars.underPos.ink === 'var(--dim)' && bars.underPos.glow === '0px'
    && bars.floor.fill === 'var(--blue)' && bars.floor.word === 'On the floor'
    && bars.aim.fill === 'var(--green)' && bars.aim.word === 'At the aim'
    && bars.gold.fill === 'var(--gold)' && /Past the aim by a point/.test(bars.gold.word)
    && bars.cap.fill === 'var(--gold)' && /cap is hit/.test(bars.cap.word)
    && Object.values(bars).every((b) => b.fill && b.word && !DASH.test(b.word))
    && !DASH.test(DESK),
    card.slice(0, 160));

  const news = mod.newsRowHtml({ headline: 'Chips lead the open', source: 'Demo', at: new Date(Date.now() - 41 * 60_000).toISOString(), url: 'https://example.invalid/x', summary: 'The tape held its ranges.', related: ['NVDA', 'MU'] }, { onDesk: ['NVDA'] });
  const plain = mod.newsRowHtml({ headline: 'Oil slips', source: 'Demo', at: new Date(Date.now() - 4 * 3600_000).toISOString(), related: [] }, { onDesk: [] });
  const beat = mod.earningsChipHtml({ symbol: 'MU', hour: 'bmo', epsEstimate: 1.12, epsActual: 1.26 }, { onDesk: ['MU'] });
  const miss = mod.earningsChipHtml({ symbol: 'NKE', hour: 'amc', epsEstimate: 0.7, epsActual: 0.4 }, { onDesk: [] });
  const stats = math.tradeStats([
    { id: 'a', pnlCents: 12000, horizon: 'intraday', riskCents: 1500, closedDay: '2026-09-14', closedAt: '2026-09-14T20:00:00Z' },
    { id: 'b', pnlCents: -4400, horizon: 'scalp', riskCents: 4400, closedDay: '2026-09-15', closedAt: '2026-09-15T20:00:00Z' },
    { id: 'c', pnlCents: 0, horizon: 'swing', riskCents: 3000, closedDay: '2026-09-16', closedAt: '2026-09-16T20:00:00Z' },
    { id: 'd', pnlCents: 6200, horizon: 'intraday', riskCents: 1500, closedDay: '2026-09-17', closedAt: '2026-09-17T20:00:00Z' },
  ], { today: '2026-09-22' });
  const over = mod.statsOverviewHtml(stats);
  const brk = mod.statsBreakdownHtml(stats, m, rules);
  const closes = mod.statsClosesHtml(stats);
  // NEGATIVE CONTROL (run 2026-09-22): the lit dot's class dropped from newsRowHtml made this read
  //   FAIL  T52 the News and Stats markup RUNS: a headline on the desk lights its dot and gives its ticker a button, one that is not stays quiet; an earnings chip says pre or post and beat or miss; the overview leads with the win rate and the streak; the breakdown prints all three kinds, the five weekdays and the pace; and the closes page draws one bar and one row for each close, oldest bar on the left
  check('T52 the News and Stats markup RUNS: a headline on the desk lights its dot and gives its ticker a button, one that is not stays quiet; an earnings chip says pre or post and beat or miss; the overview leads with the win rate and the streak; the breakdown prints all three kinds, the five weekdays and the pace; and the closes page draws one bar and one row for each close, oldest bar on the left',
    /<span class="b lit"><\/span>/.test(news) && /data-tk="NVDA"/.test(news) && /<span class="chip">MU<\/span>/.test(news)
    && /Demo · 41m/.test(news) && /class="sum">The tape held its ranges\./.test(news) && /<li class="has">/.test(news)
    && /<li class="">/.test(plain) && !/lit/.test(plain) && /Demo · 4h/.test(plain)
    && /MU/.test(beat) && /pre beat/.test(beat) && /data-tk="MU"/.test(beat)
    && /post miss/.test(miss) && !/data-tk/.test(miss)
    && /<div class="k">Win rate<\/div>/.test(over) && /67%/.test(over) && /2 W \/ 1 L \/ 1 flat/.test(over)
    && /net \+\$138\.00/.test(over) && /longest 1W · 1L/.test(over) && /<h2>R<\/h2>/.test(over)
    && ['scalp', 'intraday', 'swing'].every((k) => brk.includes(`<div class="k">${k}</div>`))
    && (brk.match(/<div class="trk">/g) || []).length === 5 && /<h2>Pace<\/h2>/.test(brk) && /vs aim 2%/.test(brk)
    && /Balance against the 2% line/.test(brk)
    && /<h2>Last 4 closes<\/h2>/.test(closes) && (closes.match(/data-close="/g) || []).length === 8
    && closes.indexOf('data-close="a"') < closes.indexOf('data-close="d"')
    && !DASH.test(over) && !DASH.test(brk) && !DASH.test(closes),
    over.slice(0, 120));

  const qs = ['Is 652 real?', 'Is it real?  ', 'Really? ', '"Is it?"', 'Is it?)', 'Is it?]', 'Is it? ', 'Worth it?'];
  const nots = ['NVDA long 10 at 648.4', 'Why not. I took it', '', '   ', 'A question mark? no, wait.', '?'];
  const merged = mod.mergeStream(
    [{ id: 'm1', ts: '2026-09-22T15:10:00Z', text: 'NVDA long 10 at 648.4.' }, { id: 'm2', ts: '2026-09-22T15:40:00Z', text: 'Out at 651.' }],
    [{ id: 'q1', at: '2026-09-22T15:31:00Z', question: 'Is 652 a real level?', answer: '652 is the prior high.', status: 'done', doc: { name: 'NVDA 652.pdf', url: 'https://x.invalid/a.pdf' } }],
    [{ id: 'local-1', at: Date.parse('2026-09-22T15:50:00Z'), text: 'What is the risk here?' }],
  );
  const dupe = mod.mergeStream([], [{ id: 'q1', at: '2026-09-22T15:31:00Z', question: 'Same one?', status: 'done', answer: 'Yes.' }], [{ id: 'local-2', at: Date.now(), text: 'Same one?' }]);
  const logRow = mod.streamRowHtml(merged[0]);
  const answered = mod.streamRowHtml(merged[1], { md: (t) => `<p>${t}</p>` });
  const thinking = mod.streamRowHtml(merged[3]);
  const stalled = mod.streamRowHtml(merged[3], { stalled: true });
  const line = mod.logLineFor({ ticker: 'NVDA', side: 'long', instrument: 'stock', qty: 10, entry: 648.4, stop: 646.9 }, 2800, 651.2);
  const lossLine = mod.logLineFor({ ticker: 'TSLA', side: 'short', instrument: 'stock', qty: 25, entry: 412.1, stop: null }, -4500, '');
  // NEGATIVE CONTROL (run 2026-09-22): mergeStream's `qaRows.some(...)` guard replaced by `if (false)` made this read
  //   FAIL  T53 the stream RUNS: a line ending in a question mark is a question whatever closes after it, a line that does not is a log line, an empty box is neither; the log, the questions and a question still in the air merge by the clock with the unstamped one at the end and no double when the server has it; his lines are blue and named, the desk's green, a waiting one shows the dots and a stalled one says to ask again; and a close writes the log line the reading grades from
  check('T53 the stream RUNS: a line ending in a question mark is a question whatever closes after it, a line that does not is a log line, an empty box is neither; the log, the questions and a question still in the air merge by the clock with the unstamped one at the end and no double when the server has it; his lines are blue and named, the desk\'s green, a waiting one shows the dots and a stalled one says to ask again; and a close writes the log line the reading grades from',
    qs.every((t) => mod.isQuestion(t)) && nots.slice(0, 5).every((t) => !mod.isQuestion(t)) && mod.isQuestion('?') === true
    && merged.length === 4 && merged.map((r) => r.kind).join() === 'log,question,log,question'
    && merged[0].id === 'm1' && merged[1].id === 'q1' && merged[2].id === 'm2'
    && merged[3].id === 'local-1' && merged[3].status === 'running' && merged[3].local === true
    && dupe.length === 1 && dupe[0].id === 'q1'
    && /class="msg you"/.test(logRow) && /<span class="who fl">You<\/span>/.test(logRow) && !/class="tag"/.test(logRow)
    && /<span class="tag">Ask<\/span>/.test(answered) && /class="msg desk latest"/.test(answered) && /<p>652 is the prior high\.<\/p>/.test(answered)
    && /data-file="https:\/\/x\.invalid\/a\.pdf"/.test(answered)
    && /class="msg desk think"/.test(thinking) && /<i><\/i><i><\/i><i><\/i>/.test(thinking)
    && /No answer came back\. Ask it again\./.test(stalled)
    && line === 'NVDA long 10 shares at 648.4, stop 646.9. Out at 651.2, plus 28.00.'
    && lossLine === 'TSLA short 25 shares at 412.1. minus 45.00.'
    && !DASH.test(line) && !DASH.test(lossLine),
    JSON.stringify({ merged: merged.map((r) => r.id), line }));
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
  //   FAIL  T54 the effects RUN: the plan is three answers and no fourth, a count lands exactly on the figure and is one frame when there is no time to spend, a burst is seeded so the same close flies twice the same way and a different seed does not, a coin's arc leaves, rises and lands, the shake dies out inside a third of a second, the siren sweeps three passes and stops, the coins are eight at the least and eighteen at the most, and the line goes green at the aim and gold a whole point past it
  check('T54 the effects RUN: the plan is three answers and no fourth, a count lands exactly on the figure and is one frame when there is no time to spend, a burst is seeded so the same close flies twice the same way and a different seed does not, a coin\'s arc leaves, rises and lands, the shake dies out inside a third of a second, the siren sweeps three passes and stops, the coins are eight at the least and eighteen at the most, and the line goes green at the aim and gold a whole point past it',
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
    && !DASH.test(FXSRC) && !DASH.test(APP),
    JSON.stringify({ frames: frames.length, burst: burst.length, sweep: sweep.map((x) => (x ? x.pass : null)) }));
}

// ---- T55: the three read routes and the morning reading RUN --------------------------------
{
  const nowMs = at('2026-09-22T16:00:00Z');
  const settings = { caseId: 'c1', startedAt: '2026-08-31', startCents: 200000, accountType: 'cash', finnhubKey: 'abcdefghijklmnop1234' };
  const closedRows = [
    { id: 'z1', data: { ticker: 'NVDA', side: 'long', instrument: 'stock', horizon: 'intraday', qty: 10, entry: 648.4, status: 'closed', closedDay: '2026-09-18', closedAt: '2026-09-18T20:00:00Z', pnlCents: 12000, riskCents: 1500 } },
    { id: 'z2', data: { ticker: 'TSLA', side: 'short', instrument: 'stock', horizon: 'scalp', qty: 25, entry: 412.1, status: 'closed', closedDay: '2026-09-19', closedAt: '2026-09-19T20:00:00Z', pnlCents: -4400, riskCents: 4400 } },
    { id: 'z3', data: { ticker: 'AMD', side: 'long', instrument: 'stock', horizon: 'swing', qty: 60, entry: 160.2, status: 'open' } },
  ];
  const mk = (over = {}) => {
    const { w, api } = world();
    w.docs.set('trade/settings', { data: { ...settings, ...(over.settings || {}) } });
    w.listed['trade/balances/items'] = [{ id: '2026-09-21', data: { date: '2026-09-21', cents: 238000 } }];
    w.listed['trade/positions/items'] = over.positions || closedRows;
    w.listed['trade/plays/items'] = over.plays || [{ id: 'p1', data: { ticker: 'NVDA', status: 'open' } }];
    w.listed['cases/c1/advisor/state/qa'] = over.qa || [
      { id: 'q1', data: { question: 'Is 652 real?', answer: 'It is the prior high.', status: 'done', at: '2026-09-22T15:31:00Z', fileRef: { path: 'secret' } } },
    ];
    return { w, api };
  };
  const newsWorld = mk();
  const news = await newsWorld.api.tradeNews(env, { now: nowMs });
  const cached = await newsWorld.api.tradeNews(env, { now: nowMs + 1000 });
  const noKey = await mk({ settings: { finnhubKey: '' } }).api.tradeNews(env, { now: nowMs });
  const history = await mk().api.tradeHistory(env, { now: nowMs });
  const qa = await mk().api.tradeQa(env, {});
  const capped = await mk().api.tradeQa(env, { n: 200 });
  let noDesk = '';
  try { await mk({ settings: { caseId: null } }).api.tradeQa(env, {}); } catch (e) { noDesk = e.message; }
  const live = mk();
  const positions = await live.api.tradePositions(env, { now: nowMs });
  const typedToday = mk();
  typedToday.w.listed['trade/balances/items'] = [{ id: '2026-09-22', data: { date: '2026-09-22', cents: 238000 } }];
  const typedRows = [...closedRows, { id: 'z4', data: { ticker: 'SPY', side: 'long', instrument: 'stock', horizon: 'scalp', qty: 10, entry: 571.2, status: 'closed', closedDay: '2026-09-22', closedAt: '2026-09-22T19:00:00Z', pnlCents: 5000, riskCents: 1200 } }];
  typedToday.w.listed['trade/positions/items'] = typedRows;
  const afterTyped = await typedToday.api.tradePositions(env, { now: nowMs });
  const beforeTyped = mk({ positions: typedRows });
  const untyped = await beforeTyped.api.tradePositions(env, { now: nowMs });
  // The one reading the cron books: inside the window, once, and never on a day the market is shut.
  const morn = (over = {}) => {
    const { w, api } = world();
    w.docs.set('trade/settings', { data: settings });
    if (over.state) w.docs.set('trade/state', { data: over.state, updateTime: 'u1' });
    if (over.claim === false) w.claim = false;
    return { w, api };
  };
  const early = morn({ state: { scanStatus: 'idle' } });
  const ranEarly = await early.api.maybeMorningRead(env, { now: at('2026-09-22T13:10:00Z') });
  const first = morn();
  const ranFirst = await first.api.maybeMorningRead(env, { now: at('2026-09-22T13:10:00Z') });
  const late = await morn().api.maybeMorningRead(env, { now: at('2026-09-22T14:40:00Z') });
  const weekend = await morn().api.maybeMorningRead(env, { now: at('2026-09-20T13:10:00Z') });
  const twice = await morn({ state: { morningDay: '2026-09-22' } }).api.maybeMorningRead(env, { now: at('2026-09-22T13:10:00Z') });
  const raced = await morn({ claim: false, state: { scanStatus: 'idle' } }).api.maybeMorningRead(env, { now: at('2026-09-22T13:10:00Z') });
  // NEGATIVE CONTROL (run 2026-09-22): `liveCents` on the positions route changed to the bare accountCents made this read
  //   FAIL  T55 the three read routes and the morning reading RUN: News answers off the cached feeds and counts them in the quote budget, lights the tickers he is in and answers without a key rather than failing; Stats reads every close newest first with the statistics computed by the shared arithmetic; the stream's list strips the file reference and caps at forty and refuses with no desk; the big number is the last typed balance plus today's closes until tonight's entry carries them itself; and the 7:00 reading books once inside its window, never twice, never on a day the market is shut, and never against another isolate that got there first
  check('T55 the three read routes and the morning reading RUN: News answers off the cached feeds and counts them in the quote budget, lights the tickers he is in and answers without a key rather than failing; Stats reads every close newest first with the statistics computed by the shared arithmetic; the stream\'s list strips the file reference and caps at forty and refuses with no desk; the big number is the last typed balance plus today\'s closes until tonight\'s entry carries them itself; and the 7:00 reading books once inside its window, never twice, never on a day the market is shut, and never against another isolate that got there first',
    news.hasKey === true && news.headlines.length === 1 && news.headlines[0].headline === 'Chips lead the open'
    && news.earnings.length === 1 && news.earnings[0].symbol === 'ORCL' && news.earnings[0].hour === 'amc'
    && news.onDesk.includes('NVDA') && news.onDesk.includes('AMD') && !news.onDesk.includes('TSLA')
    && news.closeAt === K.MARKET_CLOSE && news.today === '2026-09-22' && news.throttled === false
    && newsWorld.w.fetches.filter((u) => /\/news\?/.test(u)).length === 1
    && cached.headlines.length === 1 && newsWorld.w.fetches.filter((u) => /\/news\?/.test(u)).length === 1
    && noKey.hasKey === false && noKey.headlines.length === 0 && noKey.earnings.length === 0
    && history.count === 2 && history.capped === false && K.HISTORY_MAX === 500
    && history.closed.every((r) => r.status === 'closed') && history.stats.count === 2
    && history.stats.wins === 1 && history.stats.losses === 1 && history.stats.netCents === 7600
    && history.rules.dayAimPct === 2 && history.accountCents === 238000 && history.today === '2026-09-22'
    && qa.qa.length === 1 && qa.qa[0].question === 'Is 652 real?' && qa.qa[0].fileRef === undefined
    && capped.qa.length === 1 && K.QA_LIST_MAX === 40 && noDesk === K.SAY.noDesk
    && positions.liveCents === 238000 && positions.lastBalanceDay === '2026-09-21'
    && untyped.liveCents === 243000 && untyped.lastBalanceDay === '2026-09-21'
    && afterTyped.liveCents === 238000 && afterTyped.lastBalanceDay === '2026-09-22'
    && ranEarly.ran === true && early.w.pending.some((r) => r.kind === 'case' && r.id === 'c1')
    && early.w.patches.some((p) => p.path === 'trade/state' && p.data.morningDay === '2026-09-22' && p.opts?.ifUpdateTime === 'u1')
    && ranFirst.ran === true && first.w.patches.some((p) => p.path === 'trade/state' && p.opts?.mustNotExist === true)
    && K.MORNING_MIN === 420 && K.MORNING_WINDOW_MIN === 30
    && late.ran === false && weekend.ran === false && twice.ran === false && raced.ran === false
    && [late.why, weekend.why, twice.why, raced.why].join() === 'not the hour,not a trading day,already read,another isolate booked it',
    JSON.stringify({ news: news.headlines.length, hist: history.count, live: [positions.liveCents, untyped.liveCents, afterTyped.liveCents], morn: [ranEarly.ran, late.why, weekend.why, twice.why, raced.why] }));
}


// ---- T35: the lists, the files, the demo -------------------------------------------------
{
  const gate = (W.match(/const ADMIN_ASSET =\n\s+(\/.*\/);/) || [])[1];
  const ADMIN_ASSET = gate ? new Function(`return ${gate};`)() : null;
  const mirror = D.slice(D.indexOf('the trade desk (2026-09-21; a case file since 2026-09-22)'), D.indexOf('the advisor, from a fixture'));
  const sentences = Object.entries(K.SAY).filter(([k]) => !['notFound', 'noNext', 'noPull'].includes(k)).map(([, v]) => v);
  const pages = ['admin', 'admin-calendar', 'admin-chats', 'admin-availability', 'admin-dictionary', 'admin-case', 'admin-desk'];
  const seedDesk = SEED.slice(SEED.indexOf('the trade desk (2026-09-21; a case file since 2026-09-22)'));
  // NEGATIVE CONTROL (run 2026-09-22): '/js/admin-desk.js' removed from the audit's ADMIN_ASSETS made this read
  //   FAIL  T35 the portal page and its module are gone and no admin page links them; the six pages ask for the stylesheet at its new version; the audit proves the desk's module 404s to a stranger and no longer names the page; the sideways drive walks the desk's case; the asset gate covers admin-desk.js and not trade.js; the demo seeds the desk as a self and trade case with its log, its reading, its plays with their setups, typed balances, two trading terms and its cover, mirrors open with the open desk's id, the state, the desk's block, the trading half of the glossary, the Logged sentence, the refusals and the clearing on delete, keeps its desk off the client half, and refuses with the Worker's exact sentences
  check('T35 the portal page and its module are gone and no admin page links them; the six pages ask for the stylesheet at its new version; the audit proves the desk\'s module 404s to a stranger and no longer names the page; the sideways drive walks the desk\'s case; the asset gate covers admin-desk.js and not trade.js; the demo seeds the desk as a self and trade case with its log, its reading, its plays with their setups, typed balances, two trading terms and its cover, mirrors open with the open desk\'s id, the state, the desk\'s block, the trading half of the glossary, the Logged sentence, the refusals and the clearing on delete, keeps its desk off the client half, and refuses with the Worker\'s exact sentences',
    !has('public/admin-trade.html') && !has('public/js/admin-trade.js')
    && pages.every((p) => !/admin-trade/.test(f(`public/${p}.html`)) && /admin\.css\?v=stat116/.test(f(`public/${p}.html`)))
    // RE-PINNED 2026-09-22 (v6.0): the desk's page, its app and its effects are all gated by name,
    // and all three are named in the audit's own lists so the 404 is proved rather than assumed.
    && ['/js/admin-desk.js', '/js/admin-deskapp.js', '/js/admin-deskfx.js'].every((x) => AUDIT.includes(`'${x}'`))
    && /'\/admin-desk',/.test(AUDIT) && !/admin-trade/.test(AUDIT)
    && /'\/admin-desk\.html\?id=demo-case-trade&demo=admin'/.test(NOSIDE) && !/admin-trade/.test(NOSIDE)
    && !!ADMIN_ASSET && ADMIN_ASSET.test('/js/admin-desk.js') && ADMIN_ASSET.test('/js/admin-deskapp.js') && ADMIN_ASSET.test('/js/admin-deskfx.js')
    && ADMIN_ASSET.test('/admin-desk.html') && ADMIN_ASSET.test('/admin-desk')
    && ADMIN_ASSET.test('/js/advisor.js') && !ADMIN_ASSET.test('/js/trade.js') && !ADMIN_ASSET.test('/js/trade-math.js') && !ADMIN_ASSET.test('/js/textpdf.js')
    // The three routes the new pages read, mirrored, and the big number after a close.
    && /if \(sub === 'news' && init\.method !== 'POST'\)/.test(mirror) && /if \(sub === 'history' && init\.method !== 'POST'\)/.test(mirror) && /if \(sub === 'qa' && init\.method !== 'POST'\)/.test(mirror)
    && /liveCents: liveBalance\(\{ accountCents, lastBalanceDay: account\.day, todayKey: todayMT, realizedTodayCents: realized \}\),/.test(mirror)
    && /reduceFx: s\.reduceFx === true,/.test(D) && /stats: tradeStats\(rows, \{ today: todayMT \}\),/.test(mirror)
    && /const DEMO_NEWS = \[/.test(D) && /const DEMO_EARNINGS = \[/.test(D)
    // Fourteen closes over the last twelve days, none today, so Stats has a fortnight to read and
    // the day the drive opens on starts at zero.
    && /const CLOSES = \[/.test(seedDesk) && (seedDesk.match(/^\s+\['c\d+',/gm) || []).length === 13
    && !/\['c\d+', '[A-Z]+', '\w+', '\w+', '\w+', \d+, [\d.]+, [\d.null]+, [\d.]+, -?\d+, 0,/.test(seedDesk)
    && /\/\^trade\\\/\//.test(STORE)
    && /const TRADE_ID = 'demo-case-trade';/.test(SEED) && /set\(`cases\/\$\{TRADE_ID\}`, \{\n\s+self: true,\n\s+trade: true,/.test(SEED) && /clientName: 'Trade desk',/.test(SEED)
    && /## Your trades/.test(SEED) && /## Rules to hold/.test(SEED) && /## Setups/.test(SEED) && /analysis: TRADE_READING,/.test(SEED)
    // RE-PINNED 2026-09-22 (v5.1): the desk asks him nothing, so its log has no question row and no
    // reply to one; a line of his own saying where he wants the account going stands where they did.
    && !/role: 'question'/.test(seedDesk) && !/replyTo: 'tq1'|answerId: 'tr1'/.test(SEED)
    && /Where I want this going: 3% a day on the account/.test(seedDesk)
    && /caseId: TRADE_ID, openedAt: days\(21\),/.test(SEED) && /picture: 'Holding above the opening range at 650/.test(SEED) && (seedDesk.match(/source: 'typed'/g) || []).length === 1
    && /set\('advisorKnowledge\/vwap', \{ term: 'VWAP', category: 'Indicator'/.test(SEED) && /tradeStanding: \{ text: '\$2,380\.00 · 14 trading days · 0\.75 pts under 2% a day'/.test(SEED)
    && !/trade\/feed|trade\/flights/.test(SEED) && !/trade\/feed|trade\/flights/.test(D)
    && /if \(role !== 'admin'\) return fail\(404, 'Not found'\);/.test(mirror) && sentences.every((s) => mirror.includes(`'${s.replace(/'/g, "\\'")}'`))
    && /return fail\(409, SAY\.deskOpen, \{ existing: s\.caseId \}\);/.test(mirror) && /const fail = \(status, error, extra = null\) => \(\{/.test(D)
    && /source: 'typed' \}\);\n\s+const standing = deskRefreshStanding\(store\);/.test(mirror)
    && /const TRADE_CATS = \['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'\];/.test(D)
    && /TRADE_CATS\.includes\(d\.category \|\| 'General'\) === isTrade\)/.test(D) && /trade: isTrade \? deskPanelBlock\(store\) : null,/.test(D)
    && /answer \+= `\\n\\nLogged \$2,410\.00 as the balance for \$\{today\}\.`;/.test(D) && /so the screenshot's total was not logged over it\./.test(D)
    && /v\?\.self && !v\?\.trade\);/.test(D) && D.includes("if (c.trade) return fail(400, 'The trade desk cannot be pulled from.');") && D.includes(`if (old.trade) return fail(409, '${K.SAY.noNext}');`)
    && /if \(ts\?\.caseId === id\) store\.docs\.set\('trade\/settings', \{ \.\.\.ts, caseId: null \}\);/.test(D)
    // RE-PINNED 2026-09-22 (v5.1): the mirror no longer has a desk half of that list; it asks on his own case only.
    && /tradeStanding: v\.tradeStanding\?\.text \|\| ''/.test(D) && /if \(c\.self && !c\.trade && !asked\) \{/.test(D) && !/const qs = c\.trade \? \[/.test(D)
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
  const PAGE = f('public/admin-desk.html');
  const HARD = [/advisor/i, /differential/i, /\bAI\b/, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bOpus\b/i, /\bFable\b/i, /\bthe model\b/i, /\ba model\b/i, /chatbot/i];
  // NEGATIVE CONTROL (run 2026-09-22, v6.11): 'back at the head of every setup' reworded to 'back at the top of every setup' in the 6.11 entry made this read
  //   FAIL  T36 both versions read 6.11 with the new tag, the 4.7 through 6.10 entries are quiet and admin-only in the desk's words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo's desk
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
  check('T36 both versions read 6.11 with the new tag, the 4.7 through 6.10 entries are quiet and admin-only in the desk\'s words, the new page is stamped dark and asks for the fonts, the stylesheet and the three modules, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entries, the drive, the stylesheet or the demo\'s desk',
    /export const VERSION = '6\.11';/.test(CL) && /const VERSION = '6\.11';/.test(W) && /const BUILD_TAG = 'v2026-09-22-ticker-back';/.test(W)
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
    && /if \(url\.searchParams\.get\('do'\) === 'desk'\) \{/.test(W)
    && /submittedAgeS: age\(d\.scanCtx\.submittedAt\)/.test(W) && /head: String\(d\.scanNote\.text \|\| ''\)\.slice\(0, 600\)/.test(W)
    && /version: '6\.0',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry60)
    && /its own app now/.test(entry60) && /Plays, Positions, News, Stats and Desk/.test(entry60)
    && /question mark is a question/.test(entry60) && /7:00 Mountain/.test(entry60) && !DASH.test(entry60)
    && (entry60.match(/^\s+'[^\n]+',$/gm) || []).length >= 5
    // The page itself: always dark, its own stylesheet token, the three modules it mounts.
    && /<html lang="en" data-scheme="calm" data-desk>/.test(PAGE)
    && /admin\.css\?v=stat116/.test(PAGE) && /nav-menu\.js/.test(PAGE)
    && /js\/admin-deskapp\.js/.test(PAGE) && /js\/admin-presence\.js/.test(PAGE) && /js\/version-note\.js/.test(PAGE)
    && (PAGE.match(/<section class="page"/g) || []).length === 5
    && (PAGE.match(/<button data-page="/g) || []).length === 5
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
  check('T42 the desk files the document: the block is cut before the term harvest and after the answer is read, the file is made after the portfolio line inside the desk\'s branch, the answer says Filed as and the row carries doc in its mask, a failed file keeps the words in the answer and both outcomes are logged; the panel hangs the link under a landed answer, tells the Uploads page once when a new one arrives and the page listens; the link wears the green at thumb size; the demo builds a real file with the shared writer on a document question and files it; the showcase imports the writer and no longer keeps one; the audit reads the served module and the gate leaves it public; and the drive asks for one',
    /const hd = trade \? harvestDocument\(answer\) : \{ text: answer, doc: null \};\n\s+let filed = null;/.test(fin)
    && /let cleaned = await harvestKeyTerms\(env, hd\.text, \{/.test(fin)
    && fin.indexOf('const answer = extractText(message);') < fin.indexOf('harvestDocument(answer)') && fin.indexOf('harvestDocument(answer)') < fin.indexOf('harvestKeyTerms(env, hd.text')
    && fin.indexOf('const pf = portfolioLineOf(cleaned);') < fin.indexOf('fileDocument(env, id, hd.doc') && fin.indexOf('fileDocument(env, id, hd.doc') < fin.indexOf('if (override) {')
    && /if \(hd\.doc\) \{\n\s+const d0 = Date\.now\(\);\n\s+try \{\n\s+filed = await fileDocument\(env, id, hd\.doc, \{ now: Date\.now\(\) \}\);\n\s+cleaned = `\$\{cleaned\}\\n\\nFiled as \$\{filed\.name\} on Uploads\.`;/.test(fin)
    && /ev: 'ask-doc', ok: true, bytes: filed\.size/.test(fin) && /ev: 'ask-doc', ok: false/.test(fin)
    && /cleaned = `\$\{cleaned\}\\n\\n# \$\{hd\.doc\.title\}\\n\\n\$\{hd\.doc\.body\}\\n\\nThe file could not be made, so the document is here instead\.`;/.test(fin)
    && /answer: cleaned, status: 'done', override, batch: null, doc: filed,\n\s+\}, \{ mask: \['answer', 'status', 'override', 'batch', 'doc'\] \}\);/.test(fin)
    && /harvestDocument, fileDocument, stripDashes as deskStripDashes,\n\} from '\.\/trade-desk\.js';/.test(ADV)
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
    && /Make me a one page PDF of my rules to hold/.test(DRIVE) && /%PDF-1\.4/.test(DRIVE),
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
    && /if \(c\.self && !c\.trade && !asked\) \{/.test(D),
    JSON.stringify({ found: api.harvestQuestions(withSection), inReading: api.harvestQuestions(reading).length, un: api.unansweredFromChat(rows).length }));
}

// ---- T57: the cron collects a scan already in the air (v6.3) --------------------------------
// The other half of T56. T56 keeps a scan's queue row from being thrown away; this is what happens
// to a flight whose row has ALREADY gone, which is the state his desk was actually in: submitted
// 13:27, still up at 15:24, queue empty, nothing on any clock able to see it.
{
  const set = { caseId: 'c1', startedAt: '2026-08-31', startCents: 200000 };
  const flying = { batchId: 'b1', customId: 'scan-c1-x', submittedAt: '2026-09-22T19:27:00Z', pollFails: 0 };
  const mk2 = (over = {}) => {
    const { w, api } = world(over.world || {});
    w.docs.set('trade/settings', { data: { ...set, ...(over.settings || {}) } });
    if (over.state !== undefined) w.docs.set('trade/state', over.state);
    return { w, api };
  };
  const up = mk2({ state: { data: { scanStatus: 'running', scanCtx: flying } } });
  const collected = await up.api.maybeCollectScan(env);
  const quiet = mk2({ state: { data: { scanStatus: 'idle', scanCtx: null } } });
  const nothing = await quiet.api.maybeCollectScan(env);
  const none = mk2({});
  const noState = await none.api.maybeCollectScan(env);
  const noDesk2 = mk2({ state: { data: { scanStatus: 'running', scanCtx: flying } }, settings: { caseId: null } });
  const deskless = await noDesk2.api.maybeCollectScan(env);
  const unreadable = mk2({ state: READ_FAILED });
  const blind = await unreadable.api.maybeCollectScan(env);
  // A poll that says it did nothing (the heartbeat was still warm) is not a collection, but the
  // look still happened: what is counted is the look, not its answer.
  const warm = mk2({ state: { data: { scanStatus: 'running', scanCtx: flying } }, world: { pollOut: false } });
  const warmed = await warm.api.maybeCollectScan(env);
  // A flight parked with no batch id is not a flight.
  const halfway = mk2({ state: { data: { scanStatus: 'running', scanCtx: { pollFails: 0 } } } });
  const skipped = await halfway.api.maybeCollectScan(env);
  const seven = [up, quiet, none, noDesk2, unreadable, warm, halfway];

  // NEGATIVE CONTROL (run 2026-09-22, v6.3): `{ minAgeMs: 45_000 }` on the collector's poll changed
  // to `{ minAgeMs: 0 }` made this read
  //   FAIL  T57 the cron collects a scan already in the air RUNS: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.3): the collector's `|| !st.scanCtx?.batchId` dropped, so a
  // half parked flight would have been polled, made this read
  //   FAIL  T57 the cron collects a scan already in the air RUNS: ...
  check('T57 the cron collects a scan already in the air RUNS: it asks the desk rather than the queue, so a flight whose queue row has gone is still looked at; the look costs one document when nothing is flying and reads the desk\'s id only when something is; it waits the same forty five seconds ordinary traffic waits; a half parked flight, a shut desk and a state it cannot read are each answered rather than polled; and not one of the seven cases starts a scan or books a reading',
    collected.ran === true && collected.caseId === 'c1'
    && up.w.polls.length === 1 && up.w.polls[0].caseId === 'c1' && up.w.polls[0].opts?.minAgeMs === 45_000
    && nothing.ran === false && nothing.why === 'nothing in the air' && quiet.w.polls.length === 0 && quiet.w.reads === 1
    && noState.ran === false && noState.why === 'nothing in the air' && none.w.polls.length === 0
    && deskless.ran === false && deskless.why === 'no desk' && noDesk2.w.polls.length === 0
    && blind.ran === false && blind.why === 'state unreadable' && unreadable.w.polls.length === 0 && unreadable.w.reads === 1
    && warmed.ran === false && warm.w.polls.length === 1
    && skipped.ran === false && skipped.why === 'nothing in the air' && halfway.w.polls.length === 0
    && seven.every((x) => x.w.scans.length === 0 && x.w.pending.length === 0),
    JSON.stringify({ collected, nothing, deskless, blind, warmed, polls: up.w.polls.length, reads: quiet.w.reads }));
}

// ---- T59: the dollars or shares chip (Eric, 2026-09-22) -------------------------------------
// "It should have an option for fractional shares. So essentially it changes dollars to shares."
// One field, one chip, and the number that leaves the page is always a share or contract count.
{
  const APP3 = f('public/js/admin-deskapp.js');
  const VIEW = f('public/js/admin-desk.js');
  const CSS3 = f('public/css/admin.css');
  const D3 = f('public/js/demo/api.js');
  const DRIVE3 = f('tools/drives/drive-trade.mjs');
  // NEGATIVE CONTROL (run 2026-09-22, v6.5): `qty: qtyTyped()` in the sheet's read() put back to
  //   `qty: Number(f('#np-qty').value)`, so dollars would have been saved as a share count, made this read
  //   FAIL  T59 the quantity field says what its number means: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.5): the `if (!stock) unit = 'shares';` line dropped from
  //   paintUnit, so a contract could be sized in dollars, made this read
  //   FAIL  T59 the quantity field says what its number means: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.5): one `fmtQty(p.qty)` on the card's face put back to a
  //   raw `p.qty`, so a fraction would have printed to fifteen places, made this read
  //   FAIL  T59 the quantity field says what its number means: ...
  check('T59 the quantity field says what its number means: a chip beside it flips between shares and dollars, what leaves the page is always a share or contract count whichever way it is showing, a contract is never offered the chip because it cannot be bought in pieces, the choice is remembered for next time and a private window is not a reason to fail, the line says how many shares the money buys, every place a quantity is printed prints it through the shared formatter rather than raw, the demo refuses exactly as the Worker does, and the drive flips it both ways',
    /<button type="button" class="unit" id="np-unit" data-unit="shares">shares<\/button>/.test(APP3)
    && /const qtyTyped = \(\) => \{/.test(APP3)
    && /if \(unit !== 'dollars' \|\| !isShares\(\)\) return typed;\n\s+return sharesForDollars\(typed, entryNow\(\)\) \?\? 0;/.test(APP3)
    && /qty: qtyTyped\(\), entry:/.test(APP3)
    && !/qty: Number\(f\('#np-qty'\)\.value\)/.test(APP3)
    && /if \(!stock\) unit = 'shares';/.test(APP3) && /unitEl\.hidden = !stock;/.test(APP3)
    && /const UNIT_KEY = 'pa-desk-qty-unit';/.test(APP3)
    && /try \{ localStorage\.setItem\(UNIT_KEY, unit\); \} catch \{[^\n]*\}/.test(APP3)
    && /buys \$\{fmtQty\(v\.qty\)\} shares/.test(APP3)
    && /f\('#np-inst'\)\.addEventListener\('change', \(\) => \{ paintUnit\(\); calc\(\); \}\);/.test(APP3)
    // Nothing prints a raw quantity any more, on either module.
    && !/\$\{p\.qty\} sh/.test(APP3) && !/\$\{p\.qty\} sh/.test(VIEW) && !/\$\{p\.qty\} shares/.test(VIEW)
    && (VIEW.match(/fmtQty\(p\.qty\)/g) || []).length >= 4
    && /step="\$\{p\.instrument === 'stock' \? '0\.0001' : '1'\}"/.test(VIEW)
    && /sharesForDollars, dollarsForShares, fmtQty,/.test(APP3)
    // The chip has a look of its own, and it disappears rather than sitting there dead.
    && /html\[data-desk\]:root \.sheet \.unit \{/.test(CSS3)
    && /html\[data-desk\]:root \.sheet \.unit\[data-unit="dollars"\] \{/.test(CSS3)
    && /html\[data-desk\]:root \.sheet \.unit\[hidden\] \{ display: none; \}/.test(CSS3)
    && !DASH.test(CSS3.slice(CSS3.indexOf('DOLLARS OR SHARES'), CSS3.indexOf('DOLLARS OR SHARES') + 1200))
    // The demo refuses with the same two sentences, by the same rule.
    && /const whole = instrument !== 'stock';/.test(D3)
    && /return fail\(400, whole \? SAY\.badQty : SAY\.badShares\);/.test(D3)
    && K.SAY.badQty === 'Contracts: a whole number, 1 or more.'
    && K.SAY.badShares === 'Shares: any amount above zero, fractions welcome, to four places.'
    && !DASH.test(K.SAY.badQty) && !DASH.test(K.SAY.badShares)
    // And the drive actually taps it.
    && /one tap turns the share count into what it costs/.test(DRIVE3)
    && /a dollar amount under one share still buys a fraction of one/.test(DRIVE3)
    && /a contract is never sized in dollars/.test(DRIVE3)
    && !DASH.test(APP3),
    `${APP3.length} app chars`);
}

// ---- T60: what a play is telling him to do (Eric, 2026-09-22) -------------------------------
// "It also needs to suggest % allocation and make it clear if it's suggesting call, put, spread at
// what price/expiration or total value in stocks, not shares."
{
  const APP4 = f('public/js/admin-deskapp.js');
  const SEED4 = f('public/js/demo/seed.js');
  const D4 = f('public/js/demo/api.js');
  const DRIVE4 = f('tools/drives/drive-trade.mjs');
  const R4 = math.defaultRules();
  const A4 = 449000;
  // His own figures: 1% of $4,490 is $44.90 of RISK, which at $2.60 a share is 17.2692 shares, or
  // $3,952 of CAPITAL. The two numbers are a factor of 88 apart and only one of them used to show.
  const stock = math.playSizing({ play: { instrument: 'stock', side: 'long', entry: 228.9, stop: 226.3, allocPct: 21 }, rules: R4, accountCents: A4 });
  const big = math.playSizing({ play: { instrument: 'stock', side: 'long', entry: 228.9, stop: 226.3, allocPct: 90 }, rules: R4, accountCents: A4 });
  const call = math.playSizing({ play: { instrument: 'call', side: 'long', entry: 2.10, stop: 1.30, strike: 650, expiry: '2026-10-17', allocPct: 18 }, rules: R4, accountCents: A4 });
  // No allocPct at all: the dollars an older play asked for, read as a percent of the account.
  const old = math.playSizing({ play: { instrument: 'stock', side: 'long', entry: 228.9, stop: 226.3, sizeDollars: 449 }, rules: R4, accountCents: A4 });
  const bare = math.playSizing({ play: { instrument: 'stock', side: 'long', entry: 228.9, stop: 226.3 }, rules: R4, accountCents: A4 });

  // NEGATIVE CONTROL (run 2026-09-22, v6.6): takeQty's `Math.min(qty, ruleQty)` changed to `qty`,
  //   so a suggestion could break Rules to hold, made this read
  //   FAIL  T60 a play says what to put in and in what: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.6): vehicleLabel's expiry dropped from the built string,
  //   so a contract never said when it expires, made this read
  //   FAIL  T60 a play says what to put in and in what: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.6): the sheet's `f('#np-opt').hidden = stock;` line
  //   removed, so shares asked for a strike, made this read
  //   FAIL  T60 a play says what to put in and in what: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.6): validPlay's allocPct forced to null, so a scan could
  //   file a setup that never says what to put into it, made this read
  //   FAIL  T60 a play says what to put in and in what: ...
  check('T60 a play says what to put in and in what RUNS: the allocation is a share of the account and not the same number as the risk, a stock turns it into dollars and a fraction of a share while a contract turns it into a whole count, Take it opens on the LESSER of the suggestion and what his one trade rule allows so a suggestion can never break Rules to hold, an older play with only its dollars still reads, and a play with neither says nothing rather than guessing; the vehicle names the strike, which way round a spread runs and the date it expires, and falls back to whatever the play called itself; the sheet asks for a strike and an expiration the moment he picks a contract and never for shares, labels the entry as the premium, writes What it is for him until he types over it, and carries the play\'s own contract in; both contracts tell the scan to give the percent, the strikes, the legs and the date; and the demo seeds and keeps all of it',
    // The two numbers, and that they are different numbers.
    stock.allocPct === 21 && stock.allocCents === 94290 && stock.shares === 4.1193 && stock.contracts === null
    && stock.riskCents === 1071 && stock.budgetCents === 4490 && stock.overRule === false
    && stock.vehicle === 'shares' && stock.takeQty === 4.1193
    // 90% of the account risks $2,101 against a $44.90 rule, and Take it opens on the rule.
    && big.overRule === true && big.takeQty === 17.2692 && big.takeQty === big.ruleQty
    && call.contracts === 3 && call.shares === null && call.costCents === 63000
    && call.vehicle === '650 call, 17 Oct' && call.perUnitCents === 21000
    && old.allocCents === 44900 && old.allocPct === 10 && bare.allocCents === null && bare.allocPct === null
    && math.vehicleLabel({ instrument: 'spread', strike: 650, strike2: 655, optionType: 'call', expiry: '2026-10-17' }) === '650/655 call debit spread, 17 Oct'
    && math.vehicleLabel({ instrument: 'spread', strike: 650, strike2: 655, optionType: 'put', credit: true, expiry: '2026-10-17' }) === '650/655 put credit spread, 17 Oct'
    && math.vehicleLabel({ instrument: 'put', strike: 220, expiry: '2026-10-17' }) === '220 put, 17 Oct'
    && math.vehicleLabel({ instrument: 'call', structure: 'Oct 17 650 call' }) === 'Oct 17 650 call'
    && math.vehicleLabel({ instrument: 'stock' }) === 'shares'
    && math.expiryWords('2026-10-17') === '17 Oct' && math.expiryWords('') === '' && math.expiryWords('nope') === ''
    // The validator keeps every one of the new fields, rounds the percent to a tenth, and throws
    // away a percent or a date that is not one.
    && K.validPlay({ ...PLAY, allocPct: 17.64, strike: 650, strike2: 655, optionType: 'CALL', expiry: '2026-10-17', credit: true }).allocPct === 17.6
    && K.validPlay({ ...PLAY, strike: 650, strike2: 655, optionType: 'CALL', expiry: '2026-10-17', credit: true }).strike === 650
    && K.validPlay({ ...PLAY, strike: 650, strike2: 655, optionType: 'CALL', expiry: '2026-10-17', credit: true }).strike2 === 655
    && K.validPlay({ ...PLAY, strike: 650, strike2: 655, optionType: 'CALL', expiry: '2026-10-17', credit: true }).optionType === 'call'
    && K.validPlay({ ...PLAY, strike: 650, strike2: 655, optionType: 'CALL', expiry: '2026-10-17', credit: true }).expiry === '2026-10-17'
    && K.validPlay({ ...PLAY, strike: 650, strike2: 655, optionType: 'CALL', expiry: '2026-10-17', credit: true }).credit === true
    && K.validPlay({ ...PLAY, allocPct: 0 }).allocPct === null && K.validPlay({ ...PLAY, allocPct: 150 }).allocPct === null
    && K.validPlay({ ...PLAY, expiry: '2026-02-31' }).expiry === null && K.validPlay({ ...PLAY, strike: -5 }).strike === null
    && K.validPlay({ ...PLAY, optionType: 'straddle' }).optionType === null
    // The sheet: the fields appear with the instrument and never before it.
    && /<div class="grid2 optonly" id="np-opt" hidden>/.test(APP4)
    && /<label>Strike<input id="np-strike"/.test(APP4)
    && /<label class="sp2only">Second strike<input id="np-strike2"/.test(APP4)
    && /<label>Expiration<input id="np-expiry" type="date"/.test(APP4)
    && /f\('#np-opt'\)\.hidden = stock;/.test(APP4)
    && /for \(const el of sheet\.querySelectorAll\('\.sp2only'\)\) el\.hidden = inst !== 'spread';/.test(APP4)
    && /f\('#np-entry-k'\)\.textContent = stock \? 'Entry' : inst === 'spread' \? 'Debit or credit' : 'Premium';/.test(APP4)
    && /if \(!st\.dataset\.touched\) st\.value = vehicleLabel\(\{ \.\.\.read\(\), instrument: inst \}\);/.test(APP4)
    && /e\.currentTarget\.dataset\.touched = '1';/.test(APP4)
    && /strike: play\.strike \?\? '', strike2: play\.strike2 \?\? '',/.test(APP4)
    && /const sz = playSizing\(\{ play, rules: rulesNow\(\), accountCents: accountNow\(\) \}\);/.test(APP4)
    && /f\('#np-qty'\)\.value = sz\.takeQty/.test(APP4)
    // Both contracts ask for it, and neither carries a dash.
    && /allocPct \(the share of his account to put into this trade/.test(K.SCAN_CONTRACT)
    && /allocPct \(the share of his account to put into this trade/.test(K.TRADE_CONTRACT)
    && [K.SCAN_CONTRACT, K.TRADE_CONTRACT].every((c) => /strike \(the strike, options only\)/.test(c)
      && /expiry \(the expiration as YYYY-MM-DD, options only\)/.test(c)
      && /never a number of shares/.test(c) && /the strike and the date/.test(c) && !DASH.test(c))
    // The demo seeds a real contract and keeps the fields it is sent.
    && /strike: 650, strike2: 655, optionType: 'call', credit: false, expiry: '2026-10-17',/.test(SEED4)
    && /allocPct: 17\.6,/.test(SEED4) && /allocPct: 33\.6,/.test(SEED4) && /allocPct: 21,/.test(SEED4)
    && /optionType: \['call', 'put'\]\.includes\(String\(body\.optionType \|\| ''\)\) \? String\(body\.optionType\) : null,/.test(D4)
    && /strike, strike2, optionType,/.test(T)
    && /the strike and the expiration/.test(DRIVE4)
    && !DASH.test(APP4) && !DASH.test(SEED4.slice(SEED4.indexOf('p-demo-1'), SEED4.indexOf('p-demo-2'))),
    JSON.stringify({ stock, call, old: old.allocPct, bare: bare.allocCents }));
}

// ---- T61: plain English, a board that refreshes, and a wider net (Eric, 2026-09-22) ---------
// "Make the plays fucking plain English... Why do I have expired plays? Those should just refresh.
// And it shouldnt just look at mega cap companies. Jesus. Also the long blurb here is dumb."
{
  const APP5 = f('public/js/admin-deskapp.js');
  const CSS5 = f('public/css/admin.css');
  const DRIVE5 = f('tools/drives/drive-trade.mjs');
  const D5 = f('public/js/demo/api.js');
  const R5 = math.defaultRules();
  const A5 = 449000;
  const P = (over) => math.playLine({ ticker: 'NVDA', side: 'long', instrument: 'stock', entry: 228.9, stop: 226.3, targets: [231.5], holdMinutes: 180, allocPct: 5.5, ...over }, { rules: R5, accountCents: A5 });
  // RE-PINNED 2026-09-22 (v6.9): noteOnly moved to the shared arithmetic so the read side cuts too.
  const noteOnly = math.noteOnly;
  const wall = '## Note\n\nThe tape is holding its ranges.\n\nOne more line of the note.\n\n## Setups\n\n### AMD long\nCurrent picture: eight hundred words of it.\nChance of profit: 45 to 55%\n\n### META long\nCurrent picture: more.';

  // NEGATIVE CONTROL (run 2026-09-22, v6.7): playLine's hold dropped from the front of the line,
  //   so the sentence no longer opened with how long he is in it, made this read
  //   FAIL  T61 a setup reads as one plain sentence: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.7): 'expired' put back into the page's LIVE set, so a
  //   setup that had run out of time sat on the board with Take it on it, made this read
  //   FAIL  T61 a setup reads as one plain sentence: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.7): noteOnly's sectionMatch arm removed, so the whole
  //   Setups section came back into the note, made this read
  //   FAIL  T61 a setup reads as one plain sentence: ...
  check('T61 a setup reads as one plain sentence in his own order and nothing else RUNS: how long he is in it, buy or short with how much money, the contract with its strike and the date it expires when there is one, then the stop loss and the take profit, with no R, no share count and no abbreviation to expand; the board carries only what still stands, so a setup past its hour drops to Recent instead of sitting at the top with Take it on it; the note kept on the desk is the Note section alone rather than the whole reading; and the watchlist is a starting point the scan is told to look past, with a default his account can actually take',
    // His example: "3 hours, NVDA, $248, stop loss price, take profit price."
    P() === '3 hours, buy $247 of NVDA, stop loss 226.30, take profit 231.50'
    && P({ side: 'short' }) === '3 hours, short $247 of NVDA, stop loss 226.30, take profit 231.50'
    // "If call, date strike expiration."
    && P({ instrument: 'call', entry: 2.1, stop: 1.3, targets: [3.4], strike: 650, expiry: '2026-10-17' })
      === '3 hours, buy $247 of NVDA 650 call expiring 17 Oct, stop loss 1.30, take profit 3.40'
    && P({ instrument: 'spread', entry: 2.1, stop: 1.3, targets: [3.4], strike: 650, strike2: 655, optionType: 'call', expiry: '2026-10-17' })
      === '3 hours, buy $247 of the NVDA 650/655 call debit spread expiring 17 Oct, stop loss 1.30, take profit 3.40'
    // A hold he would say out loud, and a price he would read out loud.
    && math.holdPlain({ holdMinutes: 10 }) === '10 minutes' && math.holdPlain({ holdMinutes: 60 }) === '1 hour'
    && math.holdPlain({ holdMinutes: 180 }) === '3 hours' && math.holdPlain({ horizon: 'swing', holdDays: 1 }) === '1 day'
    && math.holdPlain({ horizon: 'swing', holdDays: 3 }) === '3 days'
    && math.priceWords(226.3) === '226.30' && math.priceWords(402) === '402' && math.priceWords(null) === ''
    // Nothing missing is invented: no stop, no stop clause; no money, no money.
    && P({ stop: null }) === '3 hours, buy $247 of NVDA, take profit 231.50'
    && P({ allocPct: null, sizeDollars: null }) === '3 hours, buy NVDA, stop loss 226.30, take profit 231.50'
    && P({ targets: [] }) === '3 hours, buy $247 of NVDA, stop loss 226.30'
    // The board carries only what still stands.
    && /const LIVE = new Set\(\['open'\]\);/.test(APP5)
    && /LIVE\.has\(p\.status\) && !expired\(p\)/.test(APP5)
    && /Nothing still standing\. The last setups have run out of time\./.test(APP5)
    // The note is the Note.
    && noteOnly(wall) === 'The tape is holding its ranges.\n\nOne more line of the note.'
    && noteOnly('Just a sentence, no headings.') === 'Just a sentence, no headings.'
    && !/Setups/.test(noteOnly(wall)) && !/###/.test(noteOnly(wall))
    && !/### QQQ long/.test(D5)
    // A wider net, and a default list his account can take.
    && K.DEFAULT_WATCHLIST.includes('IWM') && K.DEFAULT_WATCHLIST.length === 10
    && !['META', 'MSFT', 'AMZN', 'AAPL'].some((t) => K.DEFAULT_WATCHLIST.includes(t))
    && [K.SCAN_CONTRACT, K.TRADE_CONTRACT].every((c) => /a starting point, not the universe/.test(c)
      && /Mid caps and small caps are in scope/.test(c)
      && /Do not file four mega caps because they are the names in front of you/.test(c)
      && /leaves room for a real position inside his rule/.test(c) && !DASH.test(c))
    // The look, and the drive that walks it.
    && /html\[data-desk\]:root \.play \.plain \{/.test(CSS5) && /html\[data-desk\]:root \.play \.under \{/.test(CSS5)
    && /each card is one plain sentence/.test(DRIVE5) && /nothing expired is on the board/.test(DRIVE5)
    && /the scan refreshes the board rather than piling up on it/.test(DRIVE5)
    // RE-PINNED 2026-09-22 (v6.9): the drive counts bullets now rather than characters.
    && /the note is at most five bullets and has no more button/.test(DRIVE5),
    JSON.stringify({ stock: P(), call: P({ instrument: 'call', entry: 2.1, stop: 1.3, targets: [3.4], strike: 650, expiry: '2026-10-17' }), note: noteOnly(wall) }));
}

// ---- T62: the note is at most five bullets, on every path (Eric, 2026-09-22) -----------------
// "This needs to disappear or be shortened to 5 bullet points." His screenshot was a note filed
// before v6.7's write-time cut, so the whole reading was still stored, and the clamp that was
// supposed to hide it was written for a p while the note was a div. Now the cut runs on the read.
{
  const APP6 = f('public/js/admin-deskapp.js');
  const HTML6 = f('public/admin-desk.html');
  const CSS6 = f('public/css/admin.css');
  const D6 = f('public/js/demo/api.js');
  const DRIVE6 = f('tools/drives/drive-trade.mjs');
  const wall = '## Note\n\nTwo hours in, the tape is rotational, not trending: QQQ +0.41% while SPY is flat on its session low. MSFT has the cleanest trend, but a cash account cannot short shares. NVDA is dropped: it lags AMD in the same sector. The 10:00 to 12:00 slow window is next, so favor pullbacks over breakout chases. The three below are closely correlated longs, and $4,490 cash funds about one round trip. One more sentence that should be the sixth and fall off.\n\n## Setups\n\n### AMD long\nCurrent picture: AMD is 619.98, up 0.72%, after opening at 609.02.\nChance of profit: 45 to 55%';
  const fromWall = math.noteBullets(wall);
  const asBullets = math.noteBullets('## Note\n\n- one\n- two\n- three\n- four\n- five\n- six\n\n## Setups\n\n### X long\nCurrent picture: y.');
  const longOne = math.noteBullets(`## Note\n\n- ${'word '.repeat(60).trim()}`);
  const decimals = math.noteBullets('AMD is 619.98, up 0.72%, after opening at 609.02 and it held. Then it ran.');
  const headless = math.noteBullets('Two hours in. Then more.\n\n## Setups\n### X');
  const empty = [math.noteBullets(''), math.noteBullets('## Note\n\n'), math.noteBullets(null)];
  // The read side: scanBlock hands the page bullets cut from whatever is stored.
  const stored = { data: { scanStatus: 'idle', lastScanAt: new Date('2026-09-22T15:50:00Z'), scanNote: { text: wall, at: new Date('2026-09-22T15:50:00Z'), plays: 3 } } };
  const block6 = K.scanBlock(stored);

  // NEGATIVE CONTROL (run 2026-09-22, v6.9): NOTE_BULLETS_MAX raised from 5 to 50 made this read
  //   FAIL  T62 the note is at most five bullets ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.9): noteBullets given the whole text rather than
  //   noteOnly(text), so the Setups section came back as bullets, made this read
  //   FAIL  T62 the note is at most five bullets ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.9): the page's `<li>` map put back to textContent of the
  //   text made this read
  //   FAIL  T62 the note is at most five bullets ...
  check('T62 the note is at most five bullets on every path RUNS: the wall from his screenshot, stored in full, gives five sentences from the Note section and none from the setups; a note written as bullets gives those bullets and drops the sixth; a bullet past 160 characters is cut at a word; a decimal or a clock time never splits a sentence; a note with no heading still stops at the first one; nothing gives nothing; the Worker and the demo both cut on the READ so the wall already on his desk comes down without a new scan; the page renders a list and has no clamp and no more button; the scan contract asks for five bullets under 15 words and the reading contract never had a Note heading to ask with; and the drive counts them',
    fromWall.length === 5
    && fromWall[0] === 'Two hours in, the tape is rotational, not trending: QQQ +0.41% while SPY is flat on its session low.'
    && fromWall[1] === 'MSFT has the cleanest trend, but a cash account cannot short shares.'
    && fromWall[3] === 'The 10:00 to 12:00 slow window is next, so favor pullbacks over breakout chases.'
    && fromWall[4] === 'The three below are closely correlated longs, and $4,490 cash funds about one round trip.'
    && fromWall.every((b) => !/Setups|###|Current picture|sixth/.test(b))
    && asBullets.join('|') === 'one|two|three|four|five'
    && longOne.length === 1 && longOne[0].length <= 160 && longOne[0].length > 120 && !/ $/.test(longOne[0])
    && decimals.length === 2 && decimals[0] === 'AMD is 619.98, up 0.72%, after opening at 609.02 and it held.' && decimals[1] === 'Then it ran.'
    && headless.join('|') === 'Two hours in.|Then more.'
    && empty.every((e) => Array.isArray(e) && e.length === 0)
    && math.NOTE_BULLETS_MAX === 5 && math.NOTE_BULLET_CHARS === 160
    && math.noteOnly(wall).startsWith('Two hours in') && !/Setups/.test(math.noteOnly(wall))
    && Array.isArray(block6.note.bullets) && block6.note.bullets.length === 5 && !/Setups/.test(block6.note.text)
    && /text: noteOnly\(note\.text\), bullets: noteBullets\(note\.text\),/.test(T)
    && /text: noteOnly\(note\.text\), bullets: noteBullets\(note\.text\),/.test(D6)
    && /liveBalance, tradeStats, noteOnly, noteBullets,\n\} from '\.\.\/trade-math\.js';/.test(D6)
    && /<ul id="note-p" class="bul"><\/ul>/.test(HTML6) && !/id="note-more"/.test(HTML6) && !/class="panel say clamp"/.test(HTML6)
    && /const bullets = Array\.isArray\(note\?\.bullets\) \? note\.bullets : noteBullets\(note\?\.text \|\| ''\);/.test(APP6)
    && /\$\('#note-p'\)\.innerHTML = bullets\.map\(\(b\) => `<li>\$\{esc\(b\)\}<\/li>`\)\.join\(''\);/.test(APP6)
    && !/#note-more/.test(APP6) && !/classList\.toggle\('clamp'\)/.test(APP6)
    && /html\[data-desk\]:root \.say \.bul \{ margin: 0; padding-left: 18px;/.test(CSS6)
    && /html\[data-desk\]:root \.say \{ position: relative; margin-bottom: 12px; padding: 12px 14px 10px 14px;/.test(CSS6)
    && /"Note": at most five bullet points and nothing that is not a bullet\./.test(K.SCAN_CONTRACT)
    && /is under 15 words/.test(K.SCAN_CONTRACT) && /No paragraphs under this heading, ever/.test(K.SCAN_CONTRACT)
    && !/"Note": under 120 words/.test(K.SCAN_CONTRACT) && !/"Note":/.test(K.TRADE_CONTRACT) && !DASH.test(K.SCAN_CONTRACT)
    && /the note is at most five bullets and has no more button/.test(DRIVE6)
    && !DASH.test(APP6) && !DASH.test(f('public/js/trade-math.js')),
    JSON.stringify({ fromWall, asBullets, longOne: longOne[0]?.length, decimals, headless, block: block6.note.bullets?.length }));
}

// ---- T56: a scan in flight is not a reading (Eric, 2026-09-22: "It's not producing a scan rn") ----
{
  const sweep = lift(ADV, 'export async function runQueuedAnalyses(env, deadlineAt = 0) {');
  const now = lift(ADV, 'export async function pollFlightsNow(env) {');
  const APP2 = f('public/js/admin-deskapp.js');
  const iScan = sweep.indexOf('if (row.data.scan)');
  const iAsk = sweep.indexOf('if (row.data.ask)');
  const iClaim = sweep.indexOf('const state = await getDoc(env, statePath(kind, id));');
  const iGiveUp = sweep.indexOf('tries > ANALYSIS_MAX_TRIES');
  // WHAT THIS IS FOR (measured in production, 2026-09-22): a scan's marker
  // carries kind and id like every other queue row. With no branch of its
  // own it reached the analysis claim, which judged it a reading that would
  // not start: four firings counted it, the fourth stamped the desk with
  // "This read kept stopping partway" and deleted the marker, and deleting
  // the marker orphaned the flight the marker existed to collect. The scan
  // submitted at 13:27 was still in the air at 15:00 with an empty queue.
  // NEGATIVE CONTROL (run 2026-09-22): the `if (row.data.scan)` branch removed from runQueuedAnalyses made this read
  //   FAIL  T56 a scan in flight is never mistaken for a reading: the queue sweeper answers a scan marker with one look at its batch and stops there, above the claim that would have counted it as a read that would not start, stamped the desk with an error it never had and deleted the marker the flight needed; ordinary traffic collects the same marker the same way; and the marker is the one the scan writes
  check('T56 a scan in flight is never mistaken for a reading: the queue sweeper answers a scan marker with one look at its batch and stops there, above the claim that would have counted it as a read that would not start, stamped the desk with an error it never had and deleted the marker the flight needed; ordinary traffic collects the same marker the same way; and the marker is the one the scan writes',
    iScan > -1 && iAsk > -1 && iClaim > -1 && iGiveUp > -1
    && /if \(row\.data\.scan\) \{\n\s+await pollScanFlight\(env, id\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}/.test(sweep)
    // Above the claim, and above the give-up that deleted the marker.
    && iAsk < iScan && iScan < iClaim && iScan < iGiveUp
    // The other collector has said the same thing since the scan got a flight.
    && /if \(row\.data\.scan\) \{\n\s+await pollScanFlight\(env, id, \{ minAgeMs: 45_000 \}\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}/.test(now)
    // And both are looking for the row the scan actually writes.
    && /const SCAN_MARKER = \(caseId\) => `advisorQueue\/scan_case_\$\{caseId\}`;/.test(ADV)
    // A landed scan says which silence it was: nothing worth taking, or no
    // setups list at all. The page has a sentence for the second.
    // RE-PINNED 2026-09-22 (v6.7): the note kept everything but the Plays json, which meant the
    // whole Setups section ran into one wall of text on his Plays page. It is the Note section
    // alone now, and a fifth of the length.
    && /scanNote: \{ text: noteOnly\(pl\.text\)\.slice\(0, 1200\), at: new Date\(\), plays: filed\?\.plays \?\? 0, missing: !!pl\.missing \},/.test(ADV)
    // RE-PINNED 2026-09-22 (v6.9): the cut is imported from the shared arithmetic, not local.
    && /import \{ noteOnly \} from '\.\.\/public\/js\/trade-math\.js';/.test(ADV) && !/function noteOnly\(/.test(ADV)
    && /plays: Number\(note\.plays\) \|\| 0, missing: note\.missing === true,/.test(T)
    && /plays: Number\(note\.plays\) \|\| 0, missing: note\.missing === true,/.test(D)
    && /That scan came back without its setups list, so nothing was filed\. Tap Scan again\./.test(APP2)
    && /patchDoc\(env, SCAN_MARKER\(caseId\), \{ kind: 'case', id: caseId, scan: true, at: new Date\(\) \}/.test(ADV)
    // And a look at a live scan puts the marker back, so one poll from
    // anywhere hands an orphaned flight back to the clock.
    && /await patchDoc\(env, marker, \{ kind: 'case', id: caseId, scan: true, at: new Date\(\) \},\n\s+\{ mask: \['kind', 'id', 'scan', 'at'\] \}\)\.catch\(\(\) => \{\}\);/.test(ADV)
    // The window that found it, which reads and writes nothing of his.
    && /if \(url\.searchParams\.get\('do'\) === 'desk'\) \{/.test(W) && /submittedAgeS: age\(d\.scanCtx\.submittedAt\)/.test(W),
    JSON.stringify({ ask: iAsk, scan: iScan, claim: iClaim, giveUp: iGiveUp }));
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
  const nowMs = at('2026-09-22T16:00:00Z');
  const settings = { caseId: 'c1', startedAt: '2026-08-31', startCents: 200000, accountType: 'cash', finnhubKey: 'abcdefghijklmnop1234' };
  const mk = (over = {}) => {
    const { w, api } = world();
    w.docs.set('trade/settings', { data: settings });
    w.listed['trade/balances/items'] = [{ id: '2026-09-22', data: { date: '2026-09-22', cents: 400000 } }];
    w.listed['trade/positions/items'] = over.positions || [];
    for (const r of (over.positions || [])) w.docs.set(`trade/positions/items/${r.id}`, { data: r.data });
    return { w, api };
  };
  const open1 = { id: 'x1', data: { ticker: 'NVDA', side: 'long', instrument: 'stock', horizon: 'swing', qty: 10, entry: 648.4, stop: 646.9, status: 'open', riskCents: 1500, openedAt: '2026-09-20T15:00:00Z', openedDay: '2026-09-20' } };
  const open2 = { id: 'x2', data: { ticker: 'AAPL', side: 'long', instrument: 'stock', horizon: 'scalp', qty: 5, entry: 231.1, stop: 230.4, status: 'open', riskCents: 350, openedAt: '2026-09-22T15:00:00Z', openedDay: '2026-09-22' } };
  const closed = { id: 'x3', data: { ticker: 'TSLA', side: 'short', instrument: 'stock', horizon: 'scalp', qty: 25, entry: 412.1, status: 'closed', closedDay: '2026-09-22', pnlCents: 5750, openedAt: '2026-09-22T14:00:00Z' } };
  const listed = await mk({ positions: [open1, open2, closed] }).api.tradePositions({ ...env }, { now: nowMs });
  const made = mk();
  const created = await made.api.tradePosition(env, { ticker: 'aapl', side: 'long', instrument: 'stock', horizon: 'intraday', qty: 34, entry: 231.1, stop: 230.4, target: 233 }, nowMs);
  const fracWorld = mk();
  const frac = await fracWorld.api.tradePosition(env, { ticker: 'nvda', side: 'long', instrument: 'stock', horizon: 'intraday', qty: 17.2692, entry: 228.9, stop: 226.3 }, nowMs);
  const refusals = [];
  for (const [body, want] of [
    [{ ticker: '1BAD', side: 'long', instrument: 'stock', qty: 1, entry: 1 }, K.SAY.badTicker],
    [{ ticker: 'AAPL', side: 'sideways', instrument: 'stock', qty: 1, entry: 1 }, K.SAY.badSide],
    [{ ticker: 'AAPL', side: 'long', instrument: 'future', qty: 1, entry: 1 }, K.SAY.badInstrument],
    [{ ticker: 'AAPL', side: 'long', instrument: 'stock', horizon: 'day', qty: 1, entry: 1 }, K.SAY.badHorizon],
    // RE-PINNED 2026-09-22 (v6.5, fractional shares): a stock and a contract are refused in two
    // different sentences, because half a share is a position and half a contract is not a thing.
    // NEGATIVE CONTROL (run 2026-09-22, v6.5): the validator's `whole ? SAY.badQty : SAY.badShares`
    //   flattened back to one sentence made this read    FAIL  T48 the position routes RUN ...
    [{ ticker: 'AAPL', side: 'long', instrument: 'stock', qty: 0, entry: 1 }, K.SAY.badShares],
    [{ ticker: 'AAPL', side: 'long', instrument: 'stock', qty: 1.00005, entry: 1 }, K.SAY.badShares],
    [{ ticker: 'AAPL', side: 'long', instrument: 'stock', qty: -2, entry: 1 }, K.SAY.badShares],
    [{ ticker: 'AAPL', side: 'long', instrument: 'call', qty: 1.5, entry: 1 }, K.SAY.badQty],
    [{ ticker: 'AAPL', side: 'long', instrument: 'call', qty: 0, entry: 1 }, K.SAY.badQty],
    [{ ticker: 'AAPL', side: 'long', instrument: 'stock', qty: 1, entry: 0 }, K.SAY.badPrice],
    [{ ticker: 'AAPL', side: 'long', instrument: 'spread', credit: true, qty: 1, entry: 1.2 }, K.SAY.badWidth],
  ]) {
    try { await mk().api.tradePosition(env, body, nowMs); refusals.push('served'); } catch (e) { refusals.push(e.message === want ? 'said it' : e.message); }
  }
  const world4 = mk({ positions: [open2] });
  const sold = await world4.api.tradeClose(env, { id: 'x2', exitPrice: 232.6, note: 'Out at the target.' }, nowMs);
  let twice = '';
  world4.w.docs.set('trade/positions/items/x2', { data: { ...open2.data, status: 'closed' } });
  try { await world4.api.tradeClose(env, { id: 'x2', exitPrice: 233 }, nowMs); } catch (e) { twice = e.message; }
  const world5 = mk({ positions: [open2] });
  const typed = await world5.api.tradeClose(env, { id: 'x2', pnlCents: -1200 }, nowMs);
  const world6 = mk({ positions: [open2] });
  world6.w.docs.set('trade/settings', { data: { ...settings, celebrate: false } });
  const quiet = await world6.api.tradeClose(env, { id: 'x2', exitPrice: 232.6 }, nowMs);
  const gone = mk({ positions: [open2] });
  const removed = await gone.api.tradeRemove(env, { id: 'x2' });
  // NEGATIVE CONTROL (run 2026-09-22): `celebrate` answered on a loss too (`pnlCents !== 0`) made this read
  //   FAIL  T48 the position routes RUN: every bad field is refused with its own sentence and a share and a contract get different ones, a new trade stores the risk the rule measures and a fractional share count is kept as typed, the list puts the open ones first by kind with today's closes after them, the day rides every answer, Sold reads the exit price or the dollars he types, stamps the day it closed and celebrates only a profit and only when the switch is on, a second Sold is refused, and Remove takes the row away
  check('T48 the position routes RUN: every bad field is refused with its own sentence and a share and a contract get different ones, a new trade stores the risk the rule measures and a fractional share count is kept as typed, the list puts the open ones first by kind with today\'s closes after them, the day rides every answer, Sold reads the exit price or the dollars he types, stamps the day it closed and celebrates only a profit and only when the switch is on, a second Sold is refused, and Remove takes the row away',
    refusals.every((r) => r === 'said it')
    && listed.positions.map((p) => p.id).join() === 'x2,x1,x3' && listed.openCount === 2
    && listed.accountCents === 400000 && listed.rules.dayAimPct === 2 && listed.dayStatus.realizedTodayCents === 5750
    && listed.positions[0].calc.riskCents === 350 && listed.today === '2026-09-22' && listed.accountType === 'cash'
    && created.position.ticker === 'AAPL' && created.position.riskCents === 2380 && created.calc.suggestedQty === 57.1429
    // And a fractional share count is stored as typed, with the risk it really carries.
    && frac.position.qty === 17.2692 && frac.position.riskCents === 4490
    && made.w.patches.some((p) => p.path.startsWith('trade/positions/items/') && p.data.riskCents === 2380 && p.data.status === 'open')
    && sold.pnlCents === 750 && sold.celebrate === true && sold.position.closedDay === '2026-09-22' && sold.dayStatus.state === 'below-floor'
    && world4.w.patches.some((p) => p.data.status === 'closed' && p.data.closeNote === 'Out at the target.')
    && twice === K.SAY.closedAlready && typed.pnlCents === -1200 && typed.celebrate === false && quiet.celebrate === false
    && removed.removed === 'x2' && gone.w.deletes.includes('trade/positions/items/x2'),
    JSON.stringify({ refusals, order: listed.positions.map((p) => p.id), sold: sold.pnlCents, twice }));
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

// ---- T51: the scan's own flight, run (Eric, 2026-09-22) ----------------------------
//
// The scan is a model turn he starts, so it rides the batch the way a question does: submitted,
// parked on the desk's own state, collected by whichever poller gets there first. Lifted out of
// advisor.js and run against recorders, because the shape of a flight is where the paid-for work
// goes missing.
{
  const scanFns = [
    lift(ADV, 'export async function runTradeScan(env, caseId, { now = Date.now() } = {}) {'),
    lift(ADV, 'export async function pollScanFlight(env, caseId, { minAgeMs = 15_000 } = {}) {'),
    lift(ADV, 'async function finishTradeScan(env, caseId, flight, message) {'),
    lift(ADV, 'async function deskState(env) {'),
    lift(ADV, 'export function askFlightNext(flight, poll, now = Date.now()) {'),
  ].join('\n');
  const markerLine = grab(ADV, /const SCAN_MARKER = \(caseId\) => [^\n]+/);
  const abandonLine = grab(ADV, /const SCAN_ABANDON_MS = [^\n]+/);
  const failsLine = grab(ADV, /const ASK_POLL_FAILS_MAX = [^\n]+/);
  const askAbandonLine = grab(ADV, /const ASK_ABANDON_MS = [^\n]+/);

  const scanWorld = (over = {}) => {
    const w = { docs: new Map(), patches: [], deletes: [], diag: [], filed: [], cancels: [], submitted: [], notes: 0 };
    const deps = {
      tryGet: async (env2, path) => (w.docs.has(path) ? w.docs.get(path) : null),
      patchDoc: async (env2, path, data, opts = {}) => {
        w.patches.push({ path, data, opts });
        if (opts.ifUpdateTime && over.lostRace) return false;
        const cur = w.docs.get(path) || { data: {}, updateTime: 'U0' };
        w.docs.set(path, { data: { ...cur.data, ...data }, updateTime: `U${w.patches.length}` });
        return true;
      },
      deleteDoc: async (env2, path) => { w.deletes.push(path); },
      diagLog: async (env2, row) => { w.diag.push(row); },
      tradeNote: async () => { w.notes++; return '\n\n<desk>\nNOTE\n</desk>'; },
      turnRequest: (t) => ({ ...t, model: 'MODEL-ID' }),
      submitTurnBatch: async (env2, turn, customId) => {
        w.submitted.push({ turn, customId });
        if (over.submitThrows) throw new Error('nope');
        return 'batch-1';
      },
      batchCustomId: (prefix, id, stamp) => `${prefix}-${id}-${Number(stamp).toString(36)}`,
      pollTurnBatch: async () => (over.poll || { state: 'running' }),
      harvestPlays: K.harvestPlays,
      fileDeskReading: async (env2, id, harvested) => { w.filed.push({ id, harvested }); return { plays: (harvested.plays || []).length, expired: 1, pushed: false }; },
      extractText: () => over.text ?? '## Note\n\nQuiet.\n\n## Plays\n\n```json\n{ "plays": [], "portfolio": null }\n```',
      deskStripDashes: K.stripDashes,
      friendly: (e) => String(e.message || e),
      client: () => ({ messages: { batches: { cancel: async (id) => { w.cancels.push(id); } } } }),
      TRADE_STATE_PATH: K.STATE_PATH,
      TRADE_EFFORT: K.TRADE_EFFORT,
      TRADE_INSTRUCTIONS: K.TRADE_INSTRUCTIONS,
      SCAN_CONTRACT: K.SCAN_CONTRACT,
      TRADE_SAY: K.SAY,
      readFailedError: (m) => new Error(m),
      // The note's cut is the shared one now (2026-09-22, v6.9).
      noteOnly: math.noteOnly,
      // The scan carries the search tool itself (2026-09-22, v6.10).
      TRADE_WEB_SEARCH_TOOL: K.TRADE_WEB_SEARCH_TOOL,
    };
    const names = Object.keys(deps).join(', ');
    const api = new Function('deps', `
      const { ${names} } = deps;
      const READ_FAILED = Symbol('read failed');
      ${markerLine}
      ${abandonLine}
      ${failsLine}
      ${askAbandonLine}
      ${scanFns.replace(/export async function/g, 'async function').replace(/export function askFlightNext/, 'function askFlightNext')}
      return { runTradeScan, pollScanFlight };
    `)(deps);
    return { w, api };
  };

  // A first tap: the note is read, the turn is built off his instructions and the scan's contract,
  // the flight is parked with its marker, and nothing of the reading's is touched.
  const first = scanWorld();
  const started = await first.api.runTradeScan(env, 'c1', { now: at('2026-09-21T16:05:00Z') });
  // A second tap while it is in the air buys nothing.
  const busy = scanWorld();
  busy.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'running', scanAt: new Date(at('2026-09-21T16:00:00Z')), scanCtx: { batchId: 'b' } }, updateTime: 'U0' });
  const refused = await busy.api.runTradeScan(env, 'c1', { now: at('2026-09-21T16:05:00Z') });
  // A tap on a flight two hours stale starts a fresh one rather than waiting for ever.
  const stale = scanWorld();
  stale.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'running', scanAt: new Date(at('2026-09-21T13:00:00Z')), scanCtx: { batchId: 'b' } }, updateTime: 'U0' });
  const restarted = await stale.api.runTradeScan(env, 'c1', { now: at('2026-09-21T16:05:00Z') });
  // A submit that throws parks the error rather than leaving him on Scanning for ever.
  const broke = scanWorld({ submitThrows: true });
  const brokeOut = await broke.api.runTradeScan(env, 'c1', { now: at('2026-09-21T16:05:00Z') });

  // Just submitted, against the real clock: askFlightNext abandons a flight older than two hours,
  // and a fixture stamped in the past would read as abandoned rather than as a heartbeat.
  const flying = { batchId: 'b1', customId: 'scan-c1-x', submittedAt: new Date(), pollFails: 0 };
  const running = scanWorld({ poll: { state: 'running' } });
  running.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'running', scanCtx: flying, scanProgressAt: new Date() }, updateTime: 'U0' });
  const beat = await running.api.pollScanFlight(env, 'c1', { minAgeMs: 0 });
  // A flight still running after two hours is cancelled and parked, not watched for ever.
  const old2 = scanWorld({ poll: { state: 'running' } });
  old2.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'running', scanCtx: { ...flying, submittedAt: new Date(Date.now() - 3 * 3600_000) }, scanProgressAt: new Date(Date.now() - 3 * 3600_000) }, updateTime: 'U0' });
  const abandoned = await old2.api.pollScanFlight(env, 'c1', { minAgeMs: 0 });

  const landed = scanWorld({ poll: { state: 'done', message: {} }, text: '## Note\n\nOne to watch.\n\n## Plays\n\n```json\n{ "plays": [], "portfolio": null }\n```' });
  landed.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'running', scanCtx: flying, scanProgressAt: new Date() }, updateTime: 'U0' });
  const done = await landed.api.pollScanFlight(env, 'c1', { minAgeMs: 0 });
  const noteOf = (w) => w.patches.find((p) => p.data.scanNote)?.data;

  // Two pollers, one finish: the second loses the conditional claim and writes nothing.
  const raced = scanWorld({ poll: { state: 'done', message: {} }, lostRace: true });
  raced.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'running', scanCtx: flying, scanProgressAt: new Date() }, updateTime: 'U0' });
  const lost = await raced.api.pollScanFlight(env, 'c1', { minAgeMs: 0 });

  const failed = scanWorld({ poll: { state: 'failed', why: 'the batch died' } });
  failed.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'running', scanCtx: flying, scanProgressAt: new Date() }, updateTime: 'U0' });
  const dead = await failed.api.pollScanFlight(env, 'c1', { minAgeMs: 0 });

  // Nothing in the air: the marker has nothing left to do and deletes itself.
  const idle = scanWorld();
  idle.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'idle' }, updateTime: 'U0' });
  const nothing = await idle.api.pollScanFlight(env, 'c1', { minAgeMs: 0 });

  // NEGATIVE CONTROL (run 2026-09-22): `scanStatus: 'running'` dropped from runTradeScan's first patch made this read
  //   FAIL  T51 the scan's flight RUNS: a tap reads the note, builds the turn off his instructions and the scan's contract alone, parks the flight on the desk's own state with its own marker, and books no reading; a second tap while it is in the air is refused and a two hour old flight is restarted; a submit that throws parks the error; a poll heartbeats, and a landed one files the plays through the reading's own call, keeps the note and stamps the scan; the loser of a race writes nothing; a failed batch parks its reason and clears the marker, and a flight still up after two hours is cancelled
  check('T51 the scan\'s flight RUNS: a tap reads the note, builds the turn off his instructions and the scan\'s contract alone, parks the flight on the desk\'s own state with its own marker, and books no reading; a second tap while it is in the air is refused and a two hour old flight is restarted; a submit that throws parks the error; a poll heartbeats, and a landed one files the plays through the reading\'s own call, keeps the note and stamps the scan; the loser of a race writes nothing; a failed batch parks its reason and clears the marker, and a flight still up after two hours is cancelled',
    started.ok === true && started.status === 'running' && first.w.notes === 1
    && first.w.submitted.length === 1
    && first.w.submitted[0].turn.system[0].text === `${K.TRADE_INSTRUCTIONS}\n\n${K.SCAN_CONTRACT}`
    && /Eric tapped Scan/.test(first.w.submitted[0].turn.messages[0].content[0].text)
    && /<desk>/.test(first.w.submitted[0].turn.messages[0].content[0].text)
    // RE-PINNED 2026-09-22 (v6.4): doubled, because at max effort with eight searches the thinking
    // and the searching are spent from the same ceiling, and at 16000 one scan spent all of it
    // before writing a word and came back with no text block at all.
    // NEGATIVE CONTROL (run 2026-09-22, v6.4): the ceiling put back to 16000 made this read
    //   FAIL  T51 the scan's flight RUNS: ...
    && first.w.submitted[0].turn.maxTokens === 32000
    // RE-PINNED 2026-09-22 (v6.10): the scan's turn carries the web search tool, eight uses, the
    // same tool the reading gets through the desk's policy. It never had one: searches: 0 on every
    // scan in the log, so it could only see the ten quotes in the note.
    // NEGATIVE CONTROL (run 2026-09-22, v6.10): `tools: [TRADE_WEB_SEARCH_TOOL],` removed from the
    //   scan's turn made this read    FAIL  T51 the scan's flight RUNS: ...
    && JSON.stringify(first.w.submitted[0].turn.tools) === JSON.stringify([K.TRADE_WEB_SEARCH_TOOL])
    && K.TRADE_WEB_SEARCH_TOOL.max_uses === 8 && K.TRADE_WEB_SEARCH_TOOL.type === 'web_search_20260209'
    && first.w.submitted[0].customId.startsWith('scan-c1-')
    && first.w.patches.some((p) => p.path === K.STATE_PATH && p.data.scanStatus === 'running')
    && first.w.patches.some((p) => p.path === K.STATE_PATH && p.data.scanCtx?.batchId === 'batch-1')
    && first.w.patches.some((p) => p.path === 'advisorQueue/scan_case_c1' && p.data.scan === true)
    && !first.w.patches.some((p) => /advisor\/state/.test(p.path))
    && refused.ok === false && refused.why === K.SAY.scanRunning && busy.w.submitted.length === 0
    && restarted.ok === true && stale.w.submitted.length === 1
    && brokeOut.ok === false && broke.w.patches.some((p) => p.data.scanStatus === 'error' && /nope/.test(p.data.scanError || ''))
    && beat === true && running.w.patches.some((p) => p.data.scanProgressAt && p.data.scanCtx) && running.w.filed.length === 0
    && done === true && landed.w.filed.length === 1 && landed.w.filed[0].id === 'c1' && landed.w.filed[0].harvested.portfolio === null
    && noteOf(landed.w)?.scanStatus === 'idle' && noteOf(landed.w)?.lastScanAt instanceof Date
    && /One to watch\./.test(noteOf(landed.w)?.scanNote.text) && !/```json/.test(noteOf(landed.w)?.scanNote.text)
    && landed.w.deletes.includes('advisorQueue/scan_case_c1')
    && landed.w.diag.some((e) => e.ev === 'scan-end' && e.ok === true)
    && lost === false && raced.w.filed.length === 0
    && dead === true && failed.w.patches.some((p) => p.data.scanStatus === 'error' && /the batch died/.test(p.data.scanError || ''))
    && failed.w.deletes.includes('advisorQueue/scan_case_c1')
    && nothing === false && idle.w.deletes.includes('advisorQueue/scan_case_c1')
    && abandoned === true && old2.w.cancels.includes('b1') && old2.w.patches.some((p) => p.data.scanStatus === 'error' && /two hours/.test(p.data.scanError || '')),
    JSON.stringify({ started, refused: refused.why, beat, done, lost, dead, nothing }));

  // ---- T58: an empty answer is a failed scan, and it never eats the last good note ----------
  // The 13:27 flight, once something finally looked at it, came back with server_tool_use and
  // web_search_tool_result blocks and not one text block. It was filed as a finished scan with an
  // empty note, which read on the page as "ran, found nothing" AND wrote that emptiness over the
  // note from midnight, destroying the one thing still worth reading.
  const blank = scanWorld({ poll: { state: 'done', message: { stop_reason: 'max_tokens', content: [{ type: 'server_tool_use' }, { type: 'web_search_tool_result' }] } }, text: '' });
  blank.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'running', scanCtx: flying, scanProgressAt: new Date(), scanNote: { text: 'The midnight note.', plays: 3 } }, updateTime: 'U0' });
  const empty = await blank.api.pollScanFlight(env, 'c1', { minAgeMs: 0 });
  const blankEnd = blank.w.diag.find((e) => e.ev === 'scan-end');
  const goodEnd = landed.w.diag.find((e) => e.ev === 'scan-end');
  // Whitespace is empty too: an answer of three newlines is not an answer.
  const spaces = scanWorld({ poll: { state: 'done', message: {} }, text: '   \n  \n' });
  spaces.w.docs.set(K.STATE_PATH, { data: { scanStatus: 'running', scanCtx: flying, scanProgressAt: new Date() }, updateTime: 'U0' });
  await spaces.api.pollScanFlight(env, 'c1', { minAgeMs: 0 });

  // NEGATIVE CONTROL (run 2026-09-22, v6.4): the `if (!text) {` guard in finishTradeScan changed to
  //   `if (false) {` made this read
  //   FAIL  T58 an empty answer is a failed scan: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.4): the guard's `scanNote` left in its mask, so the empty
  //   note was written over the good one, made this read
  //   FAIL  T58 an empty answer is a failed scan: ...
  // NEGATIVE CONTROL (run 2026-09-22, v6.4): the `.trim()` dropped from the answer, so three
  //   newlines counted as an answer, made this read
  //   FAIL  T58 an empty answer is a failed scan: ...
  check('T58 an empty answer is a failed scan, not a finished one: nothing is filed, the note he already had is left exactly where it is rather than overwritten with nothing, the page gets a sentence saying the scan came back empty and to tap again, and the log keeps the three things that say why it was empty, which are the stop reason, the kinds of block that did come back and how many searches it ran; an answer of nothing but whitespace is judged the same way; and a real answer still carries its shape into the log',
    empty === true && blank.w.filed.length === 0
    && blank.w.patches.some((p) => p.data.scanStatus === 'error' && /came back empty/.test(p.data.scanError || '') && /Tap Scan again/.test(p.data.scanError || ''))
    && !blank.w.patches.some((p) => p.data.scanNote !== undefined)
    && !blank.w.patches.some((p) => (p.opts?.mask || []).includes('scanNote'))
    && !!blankEnd && blankEnd.ok === false && blankEnd.why === 'empty' && blankEnd.chars === 0
    && blankEnd.stop === 'max_tokens' && blankEnd.kinds === 'server_tool_use+web_search_tool_result' && blankEnd.searches === 1
    && spaces.w.filed.length === 0 && spaces.w.patches.some((p) => /came back empty/.test(p.data.scanError || ''))
    && !spaces.w.patches.some((p) => p.data.scanNote !== undefined)
    && !!goodEnd && goodEnd.ok === true && goodEnd.chars > 0 && goodEnd.kinds === '' && goodEnd.searches === 0,
    JSON.stringify({ empty, blankEnd, filed: blank.w.filed.length }));
}

// THE COUNTER IS COUNTED LAST (2026-09-22, v6.4). It used to be declared in the middle of the
// file, just above T51, so every check written after that line was printed but never counted: the
// suite said "57/57 passed" and exited 0 with a check reading FAIL on screen, and the battery that
// guards every push believed it. Found by a check that failed and was waved through.
const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
