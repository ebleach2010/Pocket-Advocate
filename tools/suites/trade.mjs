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
  'markPending', 'diagLog', 'isTradingDay', 'tradeMetrics', 'chartSeries', 'TARGET_DAILY', 'PROJECTION_MIN_DAYS', 'DEFAULT_START_CENTS', 'fetch', 'crypto'];
const EXPORTS = ['TRADE_MODEL', 'TRADE_EFFORT', 'TRADE_TZ', 'MARKET_OPEN', 'MARKET_CLOSE', 'STRONG_PROFIT_LOW', 'WATCHLIST_MAX', 'DEFAULT_WATCHLIST',
  'TRADE_WEB_SEARCH_TOOL', 'TRADE_CATEGORIES', 'DESK_NAME', 'SAY', 'SETTINGS_PATH', 'STATE_PATH', 'PLAYS', 'BALANCES',
  'TRADE_INSTRUCTIONS', 'TRADE_CONTRACT', 'TRADE_ASK_NOTE', 'realDate', 'dollars', 'stripDashes', 'sectionMatch', 'mtParts', 'mtInstant', 'mtLabel',
  'KEY_RE', 'keyTail', 'resolveKey', 'watchlistOf', 'startOf', 'marketSnapshot', 'deskMetrics', 'standingLine', 'tradeStanding', 'refreshStanding',
  'tradeNote', 'validPlay', 'validPortfolio', 'harvestPlays', 'recordPlays', 'recordPortfolio', 'scanVerdict', 'pushStrongPlay', 'fileDeskReading', 'portfolioLineOf',
  'SCAN_SLOTS', 'EARLY_CLOSE_SLOTS', 'SCAN_WINDOW_MIN', 'TradeError', 'slotsFor', 'slotKeyFor', 'nextSlotAfter', 'scanDue', 'maybeTradeScan',
  'tradeOpen', 'tradeState', 'tradePanelBlock', 'tradeBalance', 'tradeSettings', 'tradePlay', 'tradeRoute'];
const READ_FAILED = Symbol('read failed');
const BODY = `${strip(TD)}\n${strip(T)}`;

/** A world: recorders for every write, fixtures for every read, a fake market. */
function world(over = {}) {
  const w = {
    docs: new Map(), patches: [], deletes: [], pushes: [], diag: [], pending: [], fetches: [],
    claim: true, listed: {}, reads: 0, fetchStatus: 200, ...over,
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

// ---- T1 to T6: the constants and the calendar --------------------------------
// NEGATIVE CONTROL (run 2026-09-22): `TRADE_EFFORT = 'high'` changed to 'max' made this read
//   FAIL  T1 the desk runs on the pinned id at high for every turn, three Mountain slots at 7, 10 and noon, two on an early close, a 20 minute window, 55 as the strong line, eight trading categories, one web search tool of eight uses, and 2000 as the default start
check('T1 the desk runs on the pinned id at high for every turn, three Mountain slots at 7, 10 and noon, two on an early close, a 20 minute window, 55 as the strong line, eight trading categories, one web search tool of eight uses, and 2000 as the default start',
  K.TRADE_MODEL === 'claude-fable-5-1' && K.TRADE_EFFORT === 'high' && K.TRADE_TZ === 'America/Boise'
  && K.SCAN_SLOTS.join() === '07:00,10:00,12:00' && K.EARLY_CLOSE_SLOTS.join() === '07:00,10:00' && K.SCAN_WINDOW_MIN === 20
  && K.STRONG_PROFIT_LOW === 55 && K.DESK_NAME === 'Trade desk' && K.TRADE_CATEGORIES.join() === 'Setup,Indicator,Level,Order,Risk,Options,Market,Instrument'
  && K.TRADE_WEB_SEARCH_TOOL.type === 'web_search_20260209' && K.TRADE_WEB_SEARCH_TOOL.max_uses === 8
  && math.TARGET_DAILY === 0.03 && math.PROJECTION_MIN_DAYS === 14 && math.TRADING_DAYS_PER_YEAR === 252 && math.DEFAULT_START_CENTS === 200000
  && /^export const TRADE_EFFORT = 'high';$/m.test(TD) && !/TRADE_SCAN_EFFORT|TRADE_ASK_EFFORT|TRADE_FALLBACK_MODEL/.test(TD + T));

// NEGATIVE CONTROL (run 2026-09-22): `SCAN_SLOTS[0]` changed to '06:00' made this read
//   FAIL  T2 07:00 Mountain is 13:00Z in July and 14:00Z in January, and 13:01Z in January is nothing
check('T2 07:00 Mountain is 13:00Z in July and 14:00Z in January, and 13:01Z in January is nothing',
  K.slotKeyFor(at('2026-07-15T13:01:00Z'))?.key === '2026-07-15T07:00'
  && K.slotKeyFor(at('2026-01-15T14:01:00Z'))?.key === '2026-01-15T07:00'
  && K.slotKeyFor(at('2026-01-15T13:01:00Z')) === null
  && K.mtParts(at('2026-07-15T13:01:00Z')).minuteOfDay === 7 * 60 + 1 && K.mtLabel(at('2026-09-22T13:02:00Z')) === '07:02',
  JSON.stringify([K.slotKeyFor(at('2026-07-15T13:01:00Z')), K.slotKeyFor(at('2026-01-15T14:01:00Z'))]));

// NEGATIVE CONTROL (run 2026-09-22): `SCAN_WINDOW_MIN = 20` changed to 30 made this read
//   FAIL  T3 a slot fires for twenty minutes and not a minute more, and the latest slot wins inside its window
check('T3 a slot fires for twenty minutes and not a minute more, and the latest slot wins inside its window',
  K.slotKeyFor(at('2026-09-21T13:19:00Z'))?.key === '2026-09-21T07:00'
  && K.slotKeyFor(at('2026-09-21T13:20:00Z')) === null
  && K.slotKeyFor(at('2026-09-21T18:05:00Z'))?.key === '2026-09-21T12:00'
  && K.slotKeyFor(at('2026-09-21T16:05:00Z'))?.key === '2026-09-21T10:00'
  && K.slotKeyFor(at('2026-09-21T19:35:00Z')) === null);

// NEGATIVE CONTROL (run 2026-09-22): '2026-09-07' removed from NYSE_HOLIDAYS made this read
//   FAIL  T4 a weekend and a holiday are not trading days, a Monday is, and the day after Thanksgiving closes early
check('T4 a weekend and a holiday are not trading days, a Monday is, and the day after Thanksgiving closes early',
  math.isTradingDay('2026-09-19') === false && math.isTradingDay('2026-09-20') === false
  && math.isTradingDay('2026-09-07') === false && math.isTradingDay('2026-09-21') === 'full'
  && math.isTradingDay('2026-11-27') === 'early' && math.isTradingDay('2027-07-05') === false && math.isTradingDay('nope') === false);

// NEGATIVE CONTROL (run 2026-09-22): slotsFor returning SCAN_SLOTS on an early day made this read
//   FAIL  T5 an early close gets the two morning slots, a holiday none, an ordinary day three, the weekend slot is never Saturday, and Friday evening's next read is Monday 07:00
check('T5 an early close gets the two morning slots, a holiday none, an ordinary day three, the weekend slot is never Saturday, and Friday evening\'s next read is Monday 07:00',
  K.slotsFor('2026-11-27').join() === '07:00,10:00' && K.slotsFor('2026-09-07').length === 0
  && K.slotsFor('2026-09-21').length === 3 && K.slotKeyFor(at('2026-09-19T13:05:00Z')) === null
  && K.slotKeyFor(at('2026-11-27T18:05:00Z')) === null
  && K.nextSlotAfter(at('2026-09-18T21:00:00Z'))?.key === '2026-09-21T07:00'
  && K.nextSlotAfter(at('2026-09-21T14:00:00Z'))?.key === '2026-09-21T10:00'
  && new Date(K.nextSlotAfter(at('2026-09-21T14:00:00Z')).atMs).toISOString() === '2026-09-21T16:00:00.000Z');

{
  const now = at('2026-09-21T16:05:00Z');
  const due = K.scanDue({ state: { lastSlot: '2026-09-21T07:00' }, settings: { caseId: 'c1' }, now });
  const ran = K.scanDue({ state: { lastSlot: '2026-09-21T10:00' }, settings: { caseId: 'c1' }, now });
  const paused = K.scanDue({ state: {}, settings: { caseId: 'c1', scansOn: false }, now });
  const noDesk = K.scanDue({ state: {}, settings: {}, now });
  const none = K.scanDue({ state: {}, settings: { caseId: 'c1' }, now: at('2026-09-21T03:00:00Z') });
  // NEGATIVE CONTROL (run 2026-09-22): `state?.lastSlot === slot.key` became `!==` made this read
  //   FAIL  T6 a reading is owed once per slot: not twice, not paused, not without a desk, not outside a window, and each refusal says why
  check('T6 a reading is owed once per slot: not twice, not paused, not without a desk, not outside a window, and each refusal says why',
    due.due === true && due.key === '2026-09-21T10:00'
    && ran.due === false && ran.why === 'already ran'
    && paused.due === false && paused.why === 'paused'
    && noDesk.due === false && noDesk.why === 'no desk'
    && none.due === false && none.why === 'no slot' && none.key === null,
    JSON.stringify({ due, ran, paused, noDesk, none }));
}

// ---- T7: the cron's minute, run ----------------------------------------------------
{
  const settingsDoc = { data: { caseId: 'c1', accountType: 'cash', startCents: 200000, startedAt: '2026-09-01' }, updateTime: 'S1' };
  const stateDoc = { data: { lastSlot: '2026-09-21T07:00' }, updateTime: 'T1' };
  const run = async (over, caseData = { trade: true, status: 'confirmed' }) => {
    const { w, api } = world(over);
    w.docs.set('trade/settings', over.settingsDoc || settingsDoc);
    if (over.stateDoc !== null) w.docs.set('trade/state', over.stateDoc || stateDoc);
    if (caseData) w.docs.set('cases/c1', { data: caseData });
    const out = await api.maybeTradeScan(env, at('2026-09-21T16:05:00Z'));
    return { w, out };
  };
  const lost = await run({ claim: false });
  const won = await run({ claim: true });
  const fresh = await run({ claim: true, stateDoc: null });
  const closed = await run({ claim: true }, { trade: true, status: 'closed' });
  const gone = await run({ claim: true }, null);
  const notDesk = await run({ claim: true }, { self: true, status: 'confirmed' });
  const paused = await run({ claim: true, settingsDoc: { data: { caseId: 'c1', scansOn: false }, updateTime: 'S1' } });
  const { w: early, api: apiEarly } = world({ claim: true });
  early.docs.set('trade/settings', settingsDoc);
  const outEarly = await apiEarly.maybeTradeScan(env, at('2026-09-21T12:00:00Z'));
  const claimOf = (w) => w.patches.find((p) => p.path === 'trade/state' && p.data.lastSlot);
  // NEGATIVE CONTROL (run 2026-09-22): `if (!claimed)` became `if (false)` made this read
  //   FAIL  T7 outside a window the minute reads nothing; inside one it reads the settings, the state and the desk's case, a lost claim books nothing, a won claim books one reading on the desk's case and logs the slot, the claim rides ifUpdateTime with a state document and mustNotExist without, and a closed, missing, paused or non-desk case books nothing and claims nothing
  check('T7 outside a window the minute reads nothing; inside one it reads the settings, the state and the desk\'s case, a lost claim books nothing, a won claim books one reading on the desk\'s case and logs the slot, the claim rides ifUpdateTime with a state document and mustNotExist without, and a closed, missing, paused or non-desk case books nothing and claims nothing',
    outEarly.ran === false && outEarly.why === 'no slot' && early.reads === 0
    && lost.out.ran === false && lost.out.why === 'claim lost' && lost.w.pending.length === 0 && lost.w.diag.some((e) => e.ev === 'trade-claim-lost')
    && claimOf(lost.w)?.opts?.ifUpdateTime === 'T1' && claimOf(lost.w)?.data.lastSlot === '2026-09-21T10:00'
    && won.out.ran === true && won.w.reads === 3 && won.w.pending.length === 1 && won.w.pending[0].kind === 'case' && won.w.pending[0].id === 'c1'
    && won.w.diag.some((e) => e.ev === 'trade-slot' && e.slot === '2026-09-21T10:00' && e.caseId === 'c1')
    && claimOf(fresh.w)?.opts?.mustNotExist === true && fresh.out.ran === true
    && closed.out.why === 'no desk' && !claimOf(closed.w) && closed.w.pending.length === 0
    && gone.out.why === 'no desk' && !claimOf(gone.w) && notDesk.out.why === 'no desk' && !claimOf(notDesk.w)
    && paused.out.why === 'paused' && paused.w.reads === 2 && !claimOf(paused.w),
    JSON.stringify({ lost: lost.out, won: won.out, reads: won.w.reads, closed: closed.out, paused: paused.out }));
}

// ---- T8: the three texts -------------------------------------------------------------
{
  const HEADS = ['## Right now', '## Your trades', '## Where you are slipping', '## Rules to hold', '## Setups', '## Questions for you', '## Key terms', '## Working line', '## Plays', '## Not answered', '## Corrections'];
  const idx = HEADS.map((h) => K.TRADE_CONTRACT.indexOf(`${h}\n`));
  const ordered = idx.every((i, n) => i >= 0 && (n === 0 || i > idx[n - 1]));
  const words = ['MOST IMPORTANT RULE', 'Position size = how much money is placed in the trade.', 'VWAP reclaim and VWAP rejection', 'Do not present uncertain market movement as certain.', 'What I would watch next:'];
  // NEGATIVE CONTROL (run 2026-09-22): the contract's closing sentence changed to "Every trade is his call." made this read
  //   FAIL  T8 his instructions ride word for word (the opening, the close, the rule that matters most, 6774 characters), the contract names the eleven sections in order with the Plays shape and the six setup lines and closes on "Every trade is his decision", the ask note asks for the one PORTFOLIO TOTAL line, and none of the three carries a dash
  check('T8 his instructions ride word for word (the opening, the close, the rule that matters most, 6774 characters), the contract names the eleven sections in order with the Plays shape and the six setup lines and closes on "Every trade is his decision", the ask note asks for the one PORTFOLIO TOTAL line, and none of the three carries a dash',
    K.TRADE_INSTRUCTIONS.length === 6774 && K.TRADE_INSTRUCTIONS.startsWith('You are a friendly stock day-trading advisor and teacher built into a trading app.')
    && K.TRADE_INSTRUCTIONS.endsWith('Talk like a knowledgeable trading mentor sitting beside the user looking at the same screen.')
    && words.every((x) => K.TRADE_INSTRUCTIONS.includes(x))
    && ordered && /Current picture, Bull case, Bear case, Levels, Risk, What I would watch next/.test(K.TRADE_CONTRACT)
    && /"plays": \[ \.\.\. \], "portfolio": null/.test(K.TRADE_CONTRACT) && /Every trade is his decision\.$/.test(K.TRADE_CONTRACT)
    && /the differential is the Plays section below/.test(K.TRADE_CONTRACT) && /one section here, Rules to hold/.test(K.TRADE_CONTRACT)
    && /Never take a total from memory or from an earlier screenshot/.test(K.TRADE_CONTRACT)
    && /PORTFOLIO TOTAL: \$1,234\.56 \(2026-09-22\)/.test(K.TRADE_ASK_NOTE) && /never an order/.test(K.TRADE_ASK_NOTE)
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
const turnReqFn = lift(ADV, 'function turnRequest({ system, messages, effort, maxTokens = 64000, tools }) {');
const loadKnowledgeFn = lift(ADV, 'async function loadKnowledge(env) {');
const harness = () => {
  const store = new Map();
  const deps = {
    AsyncLocalStorage,
    getDoc: async (env2, path) => (store.has(path) ? { id: path.split('/').pop(), data: store.get(path) } : null),
    statePath: (kind, id) => `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/advisor/state`,
    withCacheBp: (blocks) => blocks,
    TRADE_MODEL: K.TRADE_MODEL, TRADE_EFFORT: K.TRADE_EFFORT, TRADE_WEB_SEARCH_TOOL: K.TRADE_WEB_SEARCH_TOOL, TRADE_CATEGORIES: K.TRADE_CATEGORIES,
    listDocs: async () => store.get('advisorKnowledge') || [],
  };
  const api = new Function('deps', `
    const { AsyncLocalStorage, getDoc, statePath, withCacheBp, TRADE_MODEL, TRADE_EFFORT, TRADE_WEB_SEARCH_TOOL, TRADE_CATEGORIES, listDocs } = deps;
    const READ_FAILED = Symbol('read failed'); const tryGet = async (env, p) => { try { return await getDoc(env, p); } catch { return READ_FAILED; } };
    const readFailedError = (m) => new Error(m);
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
  //   FAIL  T9 the policy on the desk is self and trade on the pinned id at high with one web search tool, a refused pinned id drops to the default, his own case keeps its own policy, and the branch is one line so the effort is a policy field and not a literal
  check('T9 the policy on the desk is self and trade on the pinned id at high with one web search tool, a refused pinned id drops to the default, his own case keeps its own policy, and the branch is one line so the effort is a policy field and not a literal',
    desk.self === true && desk.trade === true && desk.model === K.TRADE_MODEL && desk.effort === 'high' && desk.tools?.length === 1 && desk.tools[0].type === 'web_search_20260209'
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
  //   FAIL  T10 a desk turn carries no self block, no thinking key, the web search tool in place of the caller's action tools, the pinned id and high; his own case still gets the block, the thinking key and its own tools
  check('T10 a desk turn carries no self block, no thinking key, the web search tool in place of the caller\'s action tools, the pinned id and high; his own case still gets the block, the thinking key and its own tools',
    onDesk.model === K.TRADE_MODEL && onDesk.output_config.effort === 'high' && !('thinking' in onDesk)
    && onDesk.tools.length === 1 && onDesk.tools[0].type === 'web_search_20260209'
    && !onDesk.system.some((b) => /HIS OWN CASE/.test(b.text)) && onDesk.system[0].text === 'SYS'
    && onMine.thinking?.type === 'adaptive' && onMine.tools[0].name === 'set_price' && onMine.system.some((b) => /HIS OWN CASE/.test(b.text))
    && /if \(policy\?\.self && !policy\.trade\) sys\.push\(selfBlock\(\)\);/.test(ADV),
    JSON.stringify({ desk: Object.keys(onDesk), tools: onDesk.tools }));

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
  && /^import \{\n\s+TRADE_MODEL, TRADE_EFFORT, TRADE_WEB_SEARCH_TOOL, TRADE_INSTRUCTIONS, TRADE_CONTRACT, TRADE_ASK_NOTE, TRADE_CATEGORIES,\n\s+tradeNote, harvestPlays, fileDeskReading, portfolioLineOf, recordPortfolio, dollars as deskDollars,\n\} from '\.\/trade-desk\.js';/m.test(ADV)
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
  //   FAIL  T17 the standing line reads the balance, the trading days and the points under or over 3% a day from the same arithmetic, an empty desk reads no entries yet, and the refresh writes it onto the desk's cover and nowhere without a desk
  check('T17 the standing line reads the balance, the trading days and the points under or over 3% a day from the same arithmetic, an empty desk reads no entries yet, and the refresh writes it onto the desk\'s cover and nowhere without a desk',
    K.standingLine(m) === '$2,380.00 · 14 trading days · 1.75 pts under 3% a day'
    && K.standingLine(math.tradeMetrics([{ date: '2026-09-21', cents: 320000 }], { startedAt: '2026-08-31' })).endsWith('pts over 3% a day')
    && K.standingLine(math.tradeMetrics([], { startedAt: '2026-08-31' })) === '$2,000.00 · no entries yet'
    && st.text === '$2,380.00 · 14 trading days · 1.75 pts under 3% a day' && st.currentCents === 238000 && st.days === 14
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
    && pushed === true && pw.pushes.length === 1 && pw.pushes[0].uid === 'eric' && pw.pushes[0].link === '/admin-case.html?id=c1' && pw.pushes[0].title === 'Pocket Advocate' && pw.pushes[0].body === strong.body
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
    full.out.plays === 2 && full.out.expired === 1 && full.out.dropped === 0 && full.out.missing === false && full.out.portfolio?.ok === true && full.out.pushed === true && /pts under 3% a day$/.test(full.out.standing?.text || '')
    && full.w.patches.filter((p) => p.path.startsWith('trade/plays/items/') && p.data.status === 'open').length === 2
    && full.w.patches.some((p) => p.path === 'trade/balances/items/2026-09-22' && p.data.cents === 241000)
    && full.w.pushes.length === 1 && full.w.pushes[0].link === '/admin-case.html?id=c1'
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
    /<desk>/.test(note) && /Account: \$2,380\.00, margin account, started at \$2,000\.00 on 2026-08-31/.test(note) && /Standing: \$2,380\.00 · 14 trading days · 1\.75 pts under 3% a day/.test(note)
    && /Target today: 3%, which is \$71\.40/.test(note) && /SPY 100\.5/.test(note) && /Chips lead the open/.test(note) && /ORCL amc/.test(note)
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
    for (const [m, p] of [['GET', 'state'], ['POST', 'open'], ['POST', 'nope'], ['GET', '']]) out[`${m} ${p}`] = await api(req(m), env, { pathname: `/api/admin/trade/${p}` });
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
  //   FAIL  T26 the state carries the desk's case, whether a key is on file and its last four characters and never the key, the settings, the plays, the entries each with its source, the metrics from his own start, the chart, the next read and the day, and no feed, flights or unseen; the panel's block carries the plays, the standing off the cover, the next read and the two switches
  check('T26 the state carries the desk\'s case, whether a key is on file and its last four characters and never the key, the settings, the plays, the entries each with its source, the metrics from his own start, the chart, the next read and the day, and no feed, flights or unseen; the panel\'s block carries the plays, the standing off the cover, the next read and the two switches',
    !/abcd1234wxyz/.test(raw) && !/abcd1234/.test(raw) && payload.hasKey === true && payload.keyTail === 'wxyz' && payload.caseId === 'c1'
    && payload.settings.accountType === 'margin' && payload.settings.startCents === 250000 && payload.settings.watchlist.join() === 'SPY' && payload.settings.scansOn === false && payload.scansOn === false
    && payload.metrics.startCents === 250000 && payload.metrics.days === 14 && payload.chart.target.length === 15 && payload.balances.length === 5
    && payload.balances[4].source === 'screenshot' && payload.balances[0].source === 'typed' && payload.plays[0].id === 'p1'
    && payload.nextSlot.key === '2026-09-21T10:00' && payload.tradingDay === 'full' && payload.today === '2026-09-21'
    && !('feed' in payload) && !('flights' in payload) && !('unseen' in payload)
    && block.plays.length === 1 && block.standing.text === 'STANDING' && block.nextSlot.key === '2026-09-21T10:00' && block.scansOn === false && block.pushOn === true && block.hasKey === true && block.today === '2026-09-21',
    JSON.stringify({ hasKey: payload.hasKey, tail: payload.keyTail, next: payload.nextSlot?.key, block: Object.keys(block) }));
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
  const pause = await run((api) => api.tradeSettings(env, { scansOn: false, caseId: 'hijack' }), { caseId: 'c1', startedAt: '2026-08-31' });
  const patchOf = (w) => w.patches.find((p) => p.path === 'trade/settings');
  // NEGATIVE CONTROL (run 2026-09-22): the watchlist cap raised to 21 made this read
  //   FAIL  T27 settings refuse a bad key, a 21st ticker, a third account type and a start under a dollar, each with its sentence; a list is uppercased and deduped; a moved start refreshes the cover's standing; Pause is the scansOn switch; the case id is never taken from a body; the reply never carries the key
  check('T27 settings refuse a bad key, a 21st ticker, a third account type and a start under a dollar, each with its sentence; a list is uppercased and deduped; a moved start refreshes the cover\'s standing; Pause is the scansOn switch; the case id is never taken from a body; the reply never carries the key',
    badKey.threw?.message === K.SAY.badKey && badKey.threw.status === 400 && badKey.w.patches.length === 0
    && list.out.settings.watchlist.join() === 'NVDA,TSLA' && patchOf(list.w).data.watchlist.join() === 'NVDA,TSLA' && patchOf(list.w).data.setByHand === true
    && many.threw?.message === K.SAY.badWatchlist && acct.threw?.message === K.SAY.badAccount && low.threw?.message === K.SAY.badStart
    && patchOf(start.w).data.startCents === 300000 && patchOf(start.w).data.startedAt === '2026-09-01' && start.out.settings.startCents === 300000
    && start.w.patches.some((p) => p.path === 'caseMeta/c1' && p.data.tradeStanding)
    && start.out.hasKey === true && start.out.keyTail === '1234' && !/abcdefghijklmnop1234/.test(JSON.stringify(start.out))
    && patchOf(pause.w).data.scansOn === false && pause.out.settings.scansOn === false && !('caseId' in patchOf(pause.w).data) && !patchOf(pause.w).opts.mask.includes('caseId')
    && !pause.w.patches.some((p) => p.path === 'caseMeta/c1'),
    JSON.stringify({ list: list.out?.settings.watchlist, start: start.out?.settings.startCents, pause: patchOf(pause.w)?.data }));

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
//   FAIL  T30 the Worker imports the desk's slots, routes, panel block and categories, books a reading at the cron's minute after the books close, no longer polls any desk flight, hands the panel the desk's block and the trading half of the glossary on a desk, prints the standing on the covers, refuses to pull from the desk or continue it, and a deleted desk clears the settings' pointer
check('T30 the Worker imports the desk\'s slots, routes, panel block and categories, books a reading at the cron\'s minute after the books close, no longer polls any desk flight, hands the panel the desk\'s block and the trading half of the glossary on a desk, prints the standing on the covers, refuses to pull from the desk or continue it, and a deleted desk clears the settings\' pointer',
  /import \{ tradeRoute, TradeError, maybeTradeScan, tradePanelBlock \} from '\.\/trade\.js';\nimport \{ TRADE_CATEGORIES, SAY as TRADE_SAY \} from '\.\/trade-desk\.js';/.test(W)
  && /ctx\.waitUntil\(closeBookingsAug2026\(env\)\);\n(?:\s*\/\/[^\n]*\n)*\s+ctx\.waitUntil\(maybeTradeScan\(env, fired\)\.catch\(\(\) => \{\}\)\);/.test(W)
  && !/pollTradeFlights/.test(W) && !/pollTradeFlights|submitTradeBatch|tradeAsk|tradeSeen|tradeScanNow|trade\/feed|trade\/flights/.test(T)
  && /const trade = !!state\?\.data\.trade;\n\s+const terms = knowledge\.filter\(\(r\) => TRADE_CATEGORIES\.includes\(String\(r\.data\.category \|\| ''\)\) === trade\);\n\s+const tradeBlock = trade \? await tradePanelBlock\(env\)\.catch\(\(\) => null\) : null;/.test(W)
  && /state: panelState,\n\s+trade: tradeBlock,/.test(W) && /glossary: terms\.map\(\(r\) => \(\{/.test(W)
  && /by: dx\?\.by \|\| 'advisor',\n(?:\s*\/\/[^\n]*\n)*\s+tradeStanding: r\.data\.tradeStanding\?\.text \|\| '',/.test(W)
  && /if \(c\.data\.trade\) return \{ error: TRADE_SAY\.noPull, cases: \[\] \};/.test(W)
  && /if \(doc\.data\.trade\) return json\(\{ error: TRADE_SAY\.noNext \}, 409\);/.test(W)
  && /^\/\/   GET\/POST \/api\/admin\/trade\/\* /m.test(W)
  && /const desk = await getDoc\(env, 'trade\/settings'\)\.catch\(\(\) => null\);\n\s+if \(desk\?\.data\.caseId === id\)\n\s+await patchDoc\(env, 'trade\/settings', \{ caseId: null \}, \{ mask: \['caseId'\] \}\)\.catch\(\(\) => \{\}\);\n\s+return \{ docs: deleted, files: files\.length \};/.test(SHOW)
  && /^export function client\(env\) \{/m.test(ADV) && /^export async function markPending\(/m.test(ADV) && /import \{ markPending, diagLog \} from '\.\/advisor\.js';/.test(T));

// ---- T31 to T34: the shelf, the page, the panel, the desk's module ----------------------
// NEGATIVE CONTROL (run 2026-09-22): `if (c.trade) return 'TRADE DESK';` removed from badge() made this read
//   FAIL  T31 the shelf: the desk is off his own shelf and off the pull-from picker, on its own green shelf with its standing on the line, badged TRADE DESK before his own case, a green door posts to open and walks into a desk already open, the card wears the green class after the purple, and the four schemes each name the green
check('T31 the shelf: the desk is off his own shelf and off the pull-from picker, on its own green shelf with its standing on the line, badged TRADE DESK before his own case, a green door posts to open and walks into a desk already open, the card wears the green class after the purple, and the four schemes each name the green',
  /const mine = cases\.filter\(\(c\) => c\.self && !c\.trade && c\.status !== 'closed'\);/.test(ADMIN)
  && /const ownAll = cases\.filter\(\(c\) => c\.self && !c\.trade\)/.test(ADMIN)
  && /const desks = cases\.filter\(\(c\) => c\.trade\)/.test(ADMIN) && /section\('TRADE DESK', 'var\(--trade\)', \[/.test(ADMIN)
  && /three reads on a trading day, 7:00, 10:00 and noon/.test(ADMIN)
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
  && !/\.trade-tabs|\.trade-badge/.test(CSS) && /\.ask-attach \{/.test(CSS) && /\.play-card\.expired/.test(CSS));

// NEGATIVE CONTROL (run 2026-09-22, v4.8): the `.filter((p) => !data.trade || DESK_PAGE_IDS.has(p.id))` on the pages array replaced by a bare `],` made this read
//   FAIL  T32 the folder page: a desk gets four groups with six pages under Desk and none that talk to a client, only the pages its groups name, no clock button, no clock row and no Working on dropdown, its own uploads sentence, the Dx page is Plays, Stats and Desk mount the desk's module and refetch on show, the masthead and the pill test the desk first and wear green, the chat is the Trade log with its own placeholder, the overview is the desk's with its note and Pause, close and Delete, the eight categories are in the order, and the panel gets the flag
check('T32 the folder page: a desk gets four groups with six pages under Desk and none that talk to a client, only the pages its groups name, no clock button, no clock row and no Working on dropdown, its own uploads sentence, the Dx page is Plays, Stats and Desk mount the desk\'s module and refetch on show, the masthead and the pill test the desk first and wear green, the chat is the Trade log with its own placeholder, the overview is the desk\'s with its note and Pause, close and Delete, the eight categories are in the order, and the panel gets the flag',
  /const DESK_GROUPS = \[\n\s+\{ id: 'case', label: 'Case', icon: '📁', pages: \['overview', 'chat', 'files'\] \},\n\s+\{ id: 'read', label: 'Desk', icon: '📈', pages: \['advisor', 'dx', 'advisor-chat', 'education', 'stats', 'desk'\] \},\n\s+\{ id: 'mine', label: 'Mine', icon: '🔒', pages: \['notes', 'saved', 'personal'\] \},\n\s+\{ id: 'track', label: 'Track', icon: '🗒', pages: \['unanswered'\] \},\n\];/.test(CASE)
  && /\.\.\.\(data\.trade \? \{ groups: DESK_GROUPS \} : \{\}\),/.test(CASE)
  // ERIC, 2026-09-22, the screenshot: folder.js sweeps every unclaimed page into the first group, so the desk filters
  // the array to the pages its groups name, and wears neither the clock nor the Working on line.
  && /const DESK_PAGE_IDS = new Set\(DESK_GROUPS\.flatMap\(\(g\) => g\.pages\)\);/.test(CASE)
  && /\]\.filter\(\(p\) => !data\.trade \|\| DESK_PAGE_IDS\.has\(p\.id\)\),\n\s+\}\);/.test(CASE)
  && /\$\{c\.status === 'closed' \|\| c\.trade \? '' : `\n\s+<button type="button" class="btn quiet work-head" data-work-head/.test(CASE)
  && /\$\{data\.trade \? '' : `\n\s+<label class="status-pick">/.test(CASE)
  && /\$\{data\.trade \? '' : `\n\s+<div class="row" data-workclock/.test(CASE)
  // The panel's draft container is looked up on a page the desk no longer has: null, not a throw (the drive caught it).
  && /draftContainer: folder\.el\('drafts'\)\?\.querySelector\('#draft-panel'\) \|\| null,/.test(CASE)
  && /note\.textContent = data\.trade\n\s+\? 'Your screenshots: positions, portfolio totals, charts\. They go straight into the next reading, and nobody is told\.'\n\s+: 'Your own records: labs, letters, notes, anything\. They go straight into the reading, and nobody is told\.';/.test(CASE)
  && CASE.indexOf("{ id: 'act', label: 'Act', icon: '⚖️'") < CASE.indexOf('...(data.trade ? { groups: DESK_GROUPS } : {}),')
  && /id: 'dx', title: data\.trade \? 'Plays' : 'Dx', icon: data\.trade \? '📈' : '🧬',/.test(CASE)
  && /id: 'stats', title: 'Stats', icon: '📊',\n\s+render: \(pane\) => mountTradeStats\(pane, \{ getToken: \(\) => user\.getIdToken\(\) \}\),\n\s+onShow: \(pane\) => pane\._reload\?\.\(\),/.test(CASE)
  && /id: 'desk', title: 'Desk', icon: '⚙️',\n\s+render: \(pane\) => mountTradeDesk\(pane, \{ getToken: \(\) => user\.getIdToken\(\) \}\),\n\s+onShow: \(pane\) => pane\._reload\?\.\(\),/.test(CASE)
  && /import \{ mountTradeStats, mountTradeDesk \} from '\.\/admin-desk\.js';/.test(CASE)
  && /head\.className = `case-head\$\{c\.trade \? ' trade' : c\.self \? ' self' : ''\}`;/.test(CASE)
  && /<span class="status-pill\$\{c\.trade \? ' trade' : c\.self \? ' self' : ''\}" data-status>\$\{c\.trade \? 'TRADE DESK' : c\.self \? 'MY OWN CASE' : /.test(CASE)
  && /pill\.textContent = c\.trade \? 'TRADE DESK' : c\.self \? 'MY OWN CASE' : /.test(CASE)
  && /<h3>\$\{data\.trade \? 'Trade log' : data\.self \? 'Your notes' : 'Chat with the client'\}<\/h3>/.test(CASE)
  && /placeholder: data\.self \? \(data\.trade \? 'Log a trade and why, or answer a question above…' : 'Add a note, or answer a question above…'\) : undefined,/.test(CASE)
  && /if \(c\.trade\) \{ paintTradeOverview\(pane, c\); return; \}\n\s+if \(c\.self\) \{ paintSelfOverview\(pane, c\); return; \}/.test(CASE)
  && /function paintTradeOverview\(pane, c\) \{/.test(CASE)
  && /Nobody is on the other end\. The chat is your trade log, the uploads are your screenshots, and every reading is about your trading\. Three reads on a trading day at 7:00, 10:00 and noon Mountain, plus any Update you tap\. A screenshot posted to the log inside four minutes of a read is picked up by the next one; the 📷 on Ask reads it now\./.test(CASE)
  && /data-trade-pause>\$\{t\.scansOn === false \? 'Resume the readings' : 'Pause the readings'\}<\/button>/.test(CASE)
  && /fetch\('\/api\/admin\/trade\/settings', \{[\s\S]{0,300}?body: JSON\.stringify\(\{ scansOn: !on \}\),/.test(CASE)
  && /body: JSON\.stringify\(\{ caseId, reason: 'the trade desk' \}\),/.test(CASE)
  && /tradeOverviewRepaint\?\.\(\);/.test(CASE)
  && /'General',\n(?:\s*\/\/[^\n]*\n)*\s+'Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'\];/.test(CASE)
  && /self: !!data\.self,\n(?:\s*\/\/[^\n]*\n)*\s+trade: !!data\.trade,/.test(CASE));

// NEGATIVE CONTROL (run 2026-09-22): the Plays page's closing sentence changed to "Every trade is your call." made this read
//   FAIL  T33 the panel: it takes the desk's flag, heads itself Trade desk with Pause beside Update and a line under the updated line, offers a 📷 on Ask that uploads under the case's ask-files and rides the ask as its attachment, shows the file on the question row, paints play cards onto the Plays page with the disclaimer and never the two medical lists, whitelists the desk's block, and names the four new sections
check('T33 the panel: it takes the desk\'s flag, heads itself Trade desk with Pause beside Update and a line under the updated line, offers a 📷 on Ask that uploads under the case\'s ask-files and rides the ask as its attachment, shows the file on the question row, paints play cards onto the Plays page with the disclaimer and never the two medical lists, whitelists the desk\'s block, and names the four new sections',
  /export function mountAdvisor\(\{ container, kind, id, user, onSend, draftContainer = null, diffContainer = null, qaContainer = null, goTo = null, self = false, trade = false \}\) \{/.test(PANEL)
  && /<h3>\$\{trade \? '📈 Trade desk' : '👨‍⚕️ Advisor'\}<\/h3>/.test(PANEL)
  && /\$\{trade \? '<button class="btn quiet tiny" data-desk-pause title="Pause or resume the three readings a day">Pause<\/button>' : ''\}/.test(PANEL)
  && !/data-pause\b|\bpauseBtn\b/.test(PANEL)
  && /document\.addEventListener\('pa-desk-settings', \(e\) => \{/.test(PANEL) && /new CustomEvent\('pa-desk-settings', \{ detail: out \}\)/.test(DESK) && /'pa-desk-settings'/.test(CASE)
  && /\$\{trade \? '<p class="dim small desk-sub" data-desk-sub><\/p>' : ''\}/.test(PANEL)
  && /body: JSON\.stringify\(\{ scansOn: !deskScansOn \}\),/.test(PANEL) && /paintDeskSub\(\{ \.\.\.\(lastTrade \|\| \{\}\), scansOn: out\.settings\?\.scansOn !== false \}\);/.test(PANEL)
  && /if \(trade && out\.trade\) paintDeskSub\(out\.trade\);/.test(PANEL)
  && /data-ask-attach title="Attach a screenshot of your positions or your portfolio total">📷<input type="file" hidden data-ask-file accept="image\/png,image\/jpeg,application\/pdf"><\/label>/.test(PANEL)
  && /const storageRef = ref\(storage, `cases\/\$\{id\}\/ask-files\/\$\{Date\.now\(\)\}-/.test(PANEL)
  && /const ok = await submitAsk\(question, attachment\);/.test(PANEL) && /try \{ attachment = await uploadAskFile\(askFile\); \}/.test(PANEL)
  && /\$\{q\.file \? ` <span class="dim small">📎 \$\{esc\(q\.file\)\}<\/span>` : ''\}/.test(PANEL)
  && /if \(trade\) \{\n\s+const t = d\.trade \|\| \{\};\n\s+const plays = Array\.isArray\(t\.plays\) \? t\.plays : \[\];/.test(PANEL)
  && /live\.map\(playCardHtml\)/.test(PANEL) && /<p class="diff-disclaimer">Ideas, not orders\. Every trade is your decision\.<\/p>`;\n\s+wirePlayCards\(diffContainer,/.test(PANEL)
  && PANEL.indexOf("if (trade) {\n      const t = d.trade") < PANEL.indexOf("const own = self ? `")
  && /trade: out\.trade \|\| null,/.test(PANEL)
  && /'Your trades': '🧾',\n\s+'Where you are slipping': '⚠️',\n\s+'Rules to hold': '📌',\n\s+'Setups': '📈',/.test(PANEL)
  && /import \{ playCardHtml, wirePlayCards, dayShort as deskDay \} from '\.\/admin-desk\.js';\nimport \{ storage, ref, uploadBytesResumable, getDownloadURL \} from '\.\/firebase\.js';/.test(PANEL)
  && /\$\{trade \? '📈 Ask the desk' : '💬 Ask your advisor'\}/.test(PANEL));

{
  const m = math.tradeMetrics(FIX, { startedAt: '2026-08-31' });
  const c = math.chartSeries(m);
  const mod = await import('../../public/js/admin-desk.js');
  const svg = mod.svgChart(c);
  const card = mod.playCardHtml({ id: 'p1', ...K.validPlay(PLAY), status: 'open', slot: '07:02', expiresAt: new Date(Date.now() + 3600_000).toISOString() });
  const expired = mod.playCardHtml({ id: 'p2', ...K.validPlay(PLAY), status: 'expired' });
  const took = mod.playCardHtml({ id: 'p3', ...K.validPlay(PLAY), status: 'took' });
  const closed = mod.playCardHtml({ id: 'p4', ...K.validPlay(PLAY), status: 'closed', outcomeCents: 4500 });
  // NEGATIVE CONTROL (run 2026-09-22): `var(--target)` replaced by `#E5B800` on the target polyline made this read
  //   FAIL  T34 the desk's module RUNS: the chart is one SVG with two polylines by token and a dot per entry and not one hex colour; a card carries the ticker, the side, the chance as a range, the six setup rows, the read's label and Took it and Skip; an expired card says so and still takes Took it; a taken card offers Close; a closed card reads its dollars; the two mounts and the caller exist; the arithmetic is the shared module; and no dashes
  check('T34 the desk\'s module RUNS: the chart is one SVG with two polylines by token and a dot per entry and not one hex colour; a card carries the ticker, the side, the chance as a range, the six setup rows, the read\'s label and Took it and Skip; an expired card says so and still takes Took it; a taken card offers Close; a closed card reads its dollars; the two mounts and the caller exist; the arithmetic is the shared module; and no dashes',
    /^<svg viewBox="0 0 340 200" width="100%" role="img" aria-label="[^"]+"/.test(svg.trim())
    && (svg.match(/<polyline /g) || []).length === 2 && /stroke="var\(--target\)"/.test(svg) && /stroke="var\(--cyan\)"/.test(svg)
    && (svg.match(/<circle /g) || []).length === 6 && !/#[0-9a-fA-F]{3,6}\b/.test(svg) && mod.svgChart(null) === ''
    && /:root \{ --target: #B58A00; \}/.test(CSS) && /data-scheme="calm"\] \{ --target: #FFD54A; \}/.test(CSS)
    && /class="play-ticker">NVDA</.test(card) && /class="play-side">long</.test(card) && /56 to 64% chance of profit/.test(card)
    && ['Current picture', 'Bull case', 'Bear case', 'Levels', 'Risk', 'What to watch next', 'Catalyst', 'Overnight'].every((k) => card.includes(`<dt>${k}</dt>`))
    && /648, 650, 652, 655/.test(card) && /read at 07:02 · Open/.test(card) && /data-act="took">Took it</.test(card) && /data-act="skipped">Skip</.test(card) && !/data-act="closed"/.test(card)
    && /play-card expired/.test(expired) && /Expired/.test(expired) && /data-act="took"/.test(expired)
    && /Taken/.test(took) && /data-act="closed">Close</.test(took) && /data-outcome/.test(took)
    && /Closed \+\$45\.00/.test(closed) && !/data-act=/.test(closed)
    && typeof mod.mountTradeStats === 'function' && typeof mod.mountTradeDesk === 'function' && typeof mod.tradeCall === 'function' && typeof mod.wirePlayCards === 'function'
    && /fetch\(`\/api\/admin\/trade\/\$\{sub\}`/.test(DESK) && /Ideas, not orders\. Every trade is your decision\./.test(DESK)
    && !DASH.test(DESK) && !DASH.test(TD) && !DASH.test(T),
    card.slice(0, 160));
}

// ---- T35: the lists, the files, the demo -------------------------------------------------
{
  const gate = (W.match(/const ADMIN_ASSET =\n\s+(\/.*\/);/) || [])[1];
  const ADMIN_ASSET = gate ? new Function(`return ${gate};`)() : null;
  const mirror = D.slice(D.indexOf('the trade desk (2026-09-21; a case file since 2026-09-22)'), D.indexOf('the advisor, from a fixture'));
  const sentences = Object.entries(K.SAY).filter(([k]) => !['notFound', 'noNext', 'noPull'].includes(k)).map(([, v]) => v);
  const pages = ['admin', 'admin-calendar', 'admin-chats', 'admin-availability', 'admin-dictionary', 'admin-case'];
  const seedDesk = SEED.slice(SEED.indexOf('the trade desk (2026-09-21; a case file since 2026-09-22)'));
  // NEGATIVE CONTROL (run 2026-09-22): '/js/admin-desk.js' removed from the audit's ADMIN_ASSETS made this read
  //   FAIL  T35 the portal page and its module are gone and no admin page links them; the six pages ask for the stylesheet at its new version; the audit proves the desk's module 404s to a stranger and no longer names the page; the sideways drive walks the desk's case; the asset gate covers admin-desk.js and not trade.js; the demo seeds the desk as a self and trade case with its log, its reading, its plays with their setups, typed balances, two trading terms and its cover, mirrors open with the open desk's id, the state, the desk's block, the trading half of the glossary, the Logged sentence, the refusals and the clearing on delete, keeps its desk off the client half, and refuses with the Worker's exact sentences
  check('T35 the portal page and its module are gone and no admin page links them; the six pages ask for the stylesheet at its new version; the audit proves the desk\'s module 404s to a stranger and no longer names the page; the sideways drive walks the desk\'s case; the asset gate covers admin-desk.js and not trade.js; the demo seeds the desk as a self and trade case with its log, its reading, its plays with their setups, typed balances, two trading terms and its cover, mirrors open with the open desk\'s id, the state, the desk\'s block, the trading half of the glossary, the Logged sentence, the refusals and the clearing on delete, keeps its desk off the client half, and refuses with the Worker\'s exact sentences',
    !has('public/admin-trade.html') && !has('public/js/admin-trade.js')
    && pages.every((p) => !/admin-trade/.test(f(`public/${p}.html`)) && /admin\.css\?v=stat112/.test(f(`public/${p}.html`)))
    && /'\/js\/admin-desk\.js',/.test(AUDIT) && !/admin-trade/.test(AUDIT) && /'\/admin-case\.html\?id=demo-case-trade&demo=admin'/.test(NOSIDE) && !/admin-trade/.test(NOSIDE)
    && !!ADMIN_ASSET && ADMIN_ASSET.test('/js/admin-desk.js') && ADMIN_ASSET.test('/js/advisor.js') && !ADMIN_ASSET.test('/js/trade.js') && !ADMIN_ASSET.test('/js/trade-math.js')
    && /\/\^trade\\\/\//.test(STORE)
    && /const TRADE_ID = 'demo-case-trade';/.test(SEED) && /set\(`cases\/\$\{TRADE_ID\}`, \{\n\s+self: true,\n\s+trade: true,/.test(SEED) && /clientName: 'Trade desk',/.test(SEED)
    && /## Your trades/.test(SEED) && /## Rules to hold/.test(SEED) && /## Setups/.test(SEED) && /analysis: TRADE_READING,/.test(SEED)
    && /from: 'reading', role: 'question', ts: hours\(3\)/.test(SEED) && /replyTo: 'tq1'/.test(SEED)
    && /caseId: TRADE_ID, openedAt: days\(21\),/.test(SEED) && /picture: 'Holding above the opening range at 650/.test(SEED) && (seedDesk.match(/source: 'typed'/g) || []).length === 1
    && /set\('advisorKnowledge\/vwap', \{ term: 'VWAP', category: 'Indicator'/.test(SEED) && /tradeStanding: \{ text: '\$2,380\.00 · 14 trading days · 1\.75 pts under 3% a day'/.test(SEED)
    && !/trade\/feed|trade\/flights/.test(SEED) && !/trade\/feed|trade\/flights/.test(D)
    && /if \(role !== 'admin'\) return fail\(404, 'Not found'\);/.test(mirror) && sentences.every((s) => mirror.includes(`'${s.replace(/'/g, "\\'")}'`))
    && /return fail\(409, SAY\.deskOpen, \{ existing: s\.caseId \}\);/.test(mirror) && /const fail = \(status, error, extra = null\) => \(\{/.test(D)
    && /source: 'typed' \}\);\n\s+const standing = deskRefreshStanding\(store\);/.test(mirror)
    && /const TRADE_CATS = \['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'\];/.test(D)
    && /TRADE_CATS\.includes\(d\.category \|\| 'General'\) === isTrade\)/.test(D) && /trade: isTrade \? deskPanelBlock\(store\) : null,/.test(D)
    && /answer \+= `\\n\\nLogged \$2,410\.00 as the balance for \$\{today\}\.`;/.test(D) && /so the screenshot's total was not logged over it\./.test(D)
    && /v\?\.self && !v\?\.trade\);/.test(D) && D.includes("if (c.trade) return fail(400, 'The trade desk cannot be pulled from.');") && D.includes(`if (old.trade) return fail(409, '${K.SAY.noNext}');`)
    && /if \(ts\?\.caseId === id\) store\.docs\.set\('trade\/settings', \{ \.\.\.ts, caseId: null \}\);/.test(D)
    && /tradeStanding: v\.tradeStanding\?\.text \|\| ''/.test(D) && /const qs = c\.trade \? \[/.test(D)
    && !DASH.test(mirror) && !DASH.test(seedDesk),
    sentences.filter((s) => !mirror.includes(`'${s.replace(/'/g, "\\'")}'`)).join(' | '));
}

// ---- T36: the versions and the words --------------------------------------------------------
{
  const entry = (CL.match(/\{\n\s+\/\/ THE TRADE DESK AS A CASE FILE[\s\S]*?\n  \},/) || [''])[0];
  // RE-PINNED 2026-09-22 (v4.8): both versions read 4.8 and the tag is the furniture push; the 4.7 entry keeps its words.
  const entry48 = (CL.match(/\{\n\s+\/\/ THE DESK SHOWS ONLY ITS OWN FURNITURE[\s\S]*?\n  \},/) || [''])[0];
  const cssDesk = CSS.slice(CSS.indexOf('/* THE TRADE DESK (Eric, 2026-09-22'), CSS.indexOf('/* The two doors on the shelf'));
  const HARD = [/advisor/i, /differential/i, /\bAI\b/, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bOpus\b/i, /\bFable\b/i, /\bthe model\b/i, /\ba model\b/i, /chatbot/i];
  // NEGATIVE CONTROL (run 2026-09-22, v4.8): 'only its own pages' reworded to 'only its own tabs' in the 4.8 entry made this read
  //   FAIL  T36 both versions read 4.8 with the new tag, the 4.7 entry and the 4.8 entry are quiet and admin-only in the desk's words, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entry, the drive, the stylesheet's green or the demo's desk
  check('T36 both versions read 4.8 with the new tag, the 4.7 entry and the 4.8 entry are quiet and admin-only in the desk\'s words, nothing in the version note or the sign-in module carries a word from the blindness list, and not one dash in the entry, the drive, the stylesheet\'s green or the demo\'s desk',
    /export const VERSION = '4\.8';/.test(CL) && /const VERSION = '4\.8';/.test(W) && /const BUILD_TAG = 'v2026-09-22-desk-furniture-only';/.test(W)
    && /version: '4\.8',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry48) && (entry48.match(/^\s+'[^\n]+',$/gm) || []).length >= 2
    && /only its own pages/.test(entry48) && /opens on Overview/.test(entry48) && /work clock/.test(entry48) && /Working on line/.test(entry48) && !DASH.test(entry48)
    && /version: '4\.7',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry) && (entry.match(/^\s+'[^\n]+',$/gm) || []).length >= 2
    && /trade desk is a case file/.test(entry) && /Trade log/.test(entry) && /Read page/.test(entry) && /Plays page/.test(entry) && /7:00, 10:00 and noon Mountain/.test(entry)
    && HARD.every((re) => !re.test(CL)) && HARD.every((re) => !re.test(AUTH))
    && !DASH.test(entry) && !DASH.test(DRIVE) && !DASH.test(cssDesk),
    HARD.filter((re) => re.test(CL)).map(String).join(', '));
}

// ---- T37: the desk's page filter RUNS (Eric, 2026-09-22, the screenshot) ---------------------
{
  const groupsSrc = grab(CASE, /const DESK_GROUPS = \[[\s\S]*?\n\];/);
  const setSrc = grab(CASE, /const DESK_PAGE_IDS = new Set\([^\n]*\);/);
  const expr = (CASE.match(/\]\.filter\(\(p\) => ([^\n]*?)\),\n\s+\}\);/) || [])[1] || 'false';
  const { DESK_GROUPS, DESK_PAGE_IDS } = new Function(`${groupsSrc}\n${setSrc}\nreturn { DESK_GROUPS, DESK_PAGE_IDS };`)();
  const keep = new Function('data', 'DESK_PAGE_IDS', 'p', `return ${expr};`);
  const ids = [...CASE.matchAll(/id: '([\w-]+)', title:/g)].map((m) => m[1]);
  const pages = ids.map((id) => ({ id }));
  const desk = pages.filter((p) => keep({ self: true, trade: true }, DESK_PAGE_IDS, p)).map((p) => p.id);
  const medical = pages.filter((p) => keep({ fullAccess: true }, DESK_PAGE_IDS, p)).map((p) => p.id);
  const own = pages.filter((p) => keep({ self: true }, DESK_PAGE_IDS, p)).map((p) => p.id);
  const gone = ['appeals', 'log', 'milestones', 'about', 'calldoc', 'agenda', 'summary', 'drafts'];
  // NEGATIVE CONTROL (run 2026-09-22): `.concat(['log'])` on DESK_PAGE_IDS made this read
  //   FAIL  T37 the desk's page filter RUNS: of the twenty-one pages the file declares, the desk keeps exactly the thirteen its four groups name, Overview first, and drops the appeal form, the work log, the milestones, About you, My doc, the agenda, the summary and the drafts; a medical case and his own case keep all twenty-one
  check('T37 the desk\'s page filter RUNS: of the twenty-one pages the file declares, the desk keeps exactly the thirteen its four groups name, Overview first, and drops the appeal form, the work log, the milestones, About you, My doc, the agenda, the summary and the drafts; a medical case and his own case keep all twenty-one',
    ids.length === 21 && DESK_GROUPS.length === 4 && DESK_PAGE_IDS.size === 13
    && desk.length === 13 && desk.every((id) => DESK_PAGE_IDS.has(id)) && [...DESK_PAGE_IDS].every((id) => desk.includes(id))
    && desk[0] === 'overview' && gone.every((id) => ids.includes(id) && !desk.includes(id))
    && medical.length === 21 && own.length === 21,
    JSON.stringify({ ids: ids.length, size: DESK_PAGE_IDS.size, desk }));
}

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
