// trade.mjs - the Trade portal, his desk.
//
//   node tools/suites/trade.mjs
//
// Eric, 2026-09-21: "An entirely different page, separate for anything else.
// The financial advisor ... shoots me a message every 2 hours on week days on
// potential day trade opportunities with options and stocks. I can ask him
// questions. I have a spot to tally my account total ... He uses fable."
//
// The whole of worker/trade.js is evaluated here with its imports replaced
// by fakes, so every function RUNS: the calendar on real instants either
// side of a clock change, the claim against a database that says no, the
// parser on a real Message, the verdict on every branch, the finish on a
// landed batch, the routes with their exact sentences. What cannot be run is
// pinned: the hooks in the Worker, the lists, the words, the version.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const T = f('worker/trade.js');
const W = f('worker/index.js');
const ADV = f('worker/advisor.js');
const P = f('public/js/admin-trade.js');
const H = f('public/admin-trade.html');
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
const DASH = /[—–]/;

// ---- the real helpers the module borrows, lifted from the advisor -----------
const stripDashes = new Function(`${lift(ADV, 'function stripDashes(t) {')}\nreturn stripDashes;`)();
const extractText = new Function('stripDashes', `${lift(ADV, 'function extractText(final, meta) {')}\nreturn extractText;`)(stripDashes);
const friendly = new Function(`${lift(ADV, 'function friendly(err) {')}\nreturn friendly;`)();
const consts = (ADV.match(/const ASK_ABANDON_MS = [^;]+;\nconst ASK_POLL_FAILS_MAX = [^;]+;/) || [''])[0];
const askFlightNext = new Function(`${consts}\n${lift(ADV, 'function askFlightNext(flight, poll, now = Date.now()) {')}\nreturn askFlightNext;`)();
const batchCustomId = new Function(`const BATCH_ID_MAX = 64;\n${lift(ADV, 'function batchCustomId(prefix, id, stamp) {')}\nreturn batchCustomId;`)();

// ---- the module, evaluated with its imports replaced ------------------------
const BODY = T.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export /gm, '');
const NAMES = ['patchDoc', 'deleteDoc', 'listDocs', 'tryGet', 'READ_FAILED', 'readFailedError', 'notifyUser',
  'client', 'batchCustomId', 'pollTurnBatch', 'askFlightNext', 'diagLog', 'extractText', 'stripDashes', 'friendly',
  'isTradingDay', 'tradeMetrics', 'chartSeries', 'TARGET_DAILY', 'PROJECTION_MIN_DAYS', 'DEFAULT_START_CENTS', 'fetch'];
const EXPORTS = ['TRADE_MODEL', 'TRADE_FALLBACK_MODEL', 'TRADE_SCAN_EFFORT', 'TRADE_ASK_EFFORT', 'SCAN_SLOTS', 'EARLY_CLOSE_SLOTS', 'SCAN_WINDOW_MIN',
  'START_BALANCE_CENTS', 'STRONG_PROFIT_LOW', 'TRADE_TZ', 'TRADE_WEB_SEARCH_TOOL', 'SAY', 'TradeError',
  'mtParts', 'slotsFor', 'slotKeyFor', 'mtInstant', 'nextSlotAfter', 'scanDue', 'TRADE_PLAYBOOK', 'TRADE_REGISTER',
  'scanUserContent', 'askUserContent', 'tradeTurn', 'validPlay', 'parseScan', 'scanVerdict', 'keyTail', 'resolveKey',
  'marketSnapshot', 'submitTradeBatch', 'runScan', 'runAsk', 'finishScan', 'finishAsk', 'pollTradeFlights', 'maybeTradeScan',
  'statePayload', 'tradeState', 'tradeAsk', 'tradeBalance', 'tradeSettings', 'tradePlay', 'tradeSeen', 'tradeScanNow', 'tradeRoute'];
const READ_FAILED = Symbol('read failed');

/** A world: recorders for every write, fixtures for every read, a fake provider and a fake market. */
function world(over = {}) {
  const w = {
    docs: new Map(), patches: [], deletes: [], pushes: [], diag: [], creates: [], fetches: [], cancels: [],
    poll: { state: 'running' }, claim: true, listed: {}, reads: 0, fetchStatus: 200, ...over,
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
    client: () => ({ messages: { batches: {
      create: async (req) => { w.creates.push(req); if (w.createFails && w.createFails.length) { const e = w.createFails.shift(); if (e) throw e; } return { id: `b${w.creates.length}` }; },
      cancel: async (id) => { w.cancels.push(id); },
    } } }),
    batchCustomId,
    pollTurnBatch: async () => (typeof w.poll === 'function' ? w.poll() : w.poll),
    askFlightNext,
    diagLog: async (env, e) => { w.diag.push(e); },
    extractText, stripDashes, friendly,
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
    ...(over.deps || {}),
  };
  const api = new Function('deps', `const { ${NAMES.join(', ')} } = deps;\n${BODY}\nreturn { ${EXPORTS.join(', ')} };`)(deps);
  return { w, api };
}
const { api: K } = world();
const env = { ADMIN_UID: 'eric', ANTHROPIC_API_KEY: 'k' };
const at = (iso) => new Date(iso).getTime();
const msg = (text) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text }] });
const GOOD = {
  quiet: false, summary: 'Chips lead. Volume is above average.', notes: [{ text: 'Fed minutes at 12:00 MT.' }],
  plays: [
    { ticker: 'nvda', side: 'long', instrument: 'spread', structure: 'Oct 17 650/655 call debit spread', entry: 2.1, stop: 1.3, targets: [3.4], holdMinutes: 180, why: 'Gap held — volume is real.', catalyst: 'Guidance raised.', risk: 'Break of 648.', profitLow: 56, profitHigh: 64, sizeDollars: 420, overnightOk: false, overnightWhy: 'Intraday.' },
    { ticker: 'TSLA', side: 'short', instrument: 'stock', structure: 'shares', entry: 412, stop: 418, targets: [402], holdMinutes: 60, why: 'Rejected VWAP twice.', catalyst: 'Deliveries missed.', risk: 'Reclaim of 415.', profitLow: 45, profitHigh: 55, sizeDollars: 800, overnightOk: false, overnightWhy: '' },
  ],
};

// ---- T1 to T6: the constants and the calendar --------------------------------
// NEGATIVE CONTROL (run 2026-09-21): `STRONG_PROFIT_LOW = 55` changed to 50 made this read
//   FAIL  T1 the desk runs on the pinned id at high for a scan and max for a question, four Mountain slots, a 20 minute window, 55 as the strong line, and 2000 as the default start
check('T1 the desk runs on the pinned id at high for a scan and max for a question, four Mountain slots, a 20 minute window, 55 as the strong line, and 2000 as the default start',
  K.TRADE_MODEL === 'claude-fable-5-1' && K.TRADE_SCAN_EFFORT === 'high' && K.TRADE_ASK_EFFORT === 'max'
  && K.SCAN_SLOTS.join() === '07:30,09:30,11:30,13:30' && K.EARLY_CLOSE_SLOTS.join() === '07:30,09:30'
  && K.SCAN_WINDOW_MIN === 20 && K.STRONG_PROFIT_LOW === 55 && K.START_BALANCE_CENTS === 200000 && K.TRADE_TZ === 'America/Boise'
  && math.TARGET_DAILY === 0.03 && math.PROJECTION_MIN_DAYS === 14 && math.TRADING_DAYS_PER_YEAR === 252
  && K.TRADE_WEB_SEARCH_TOOL.type === 'web_search_20260209' && K.TRADE_WEB_SEARCH_TOOL.max_uses === 8);

// NEGATIVE CONTROL (run 2026-09-21): `SCAN_SLOTS[0]` changed to '06:30' made this read
//   FAIL  T2 07:30 Mountain is 13:30Z in July and 14:30Z in January, and 13:30Z in January is nothing
check('T2 07:30 Mountain is 13:30Z in July and 14:30Z in January, and 13:30Z in January is nothing',
  K.slotKeyFor(at('2026-07-15T13:31:00Z'))?.key === '2026-07-15T07:30'
  && K.slotKeyFor(at('2026-01-15T14:31:00Z'))?.key === '2026-01-15T07:30'
  && K.slotKeyFor(at('2026-01-15T13:31:00Z')) === null
  && K.mtParts(at('2026-07-15T13:31:00Z')).minuteOfDay === 7 * 60 + 31,
  JSON.stringify([K.slotKeyFor(at('2026-07-15T13:31:00Z')), K.slotKeyFor(at('2026-01-15T14:31:00Z'))]));

// NEGATIVE CONTROL (run 2026-09-21): `SCAN_WINDOW_MIN = 20` changed to 30 made this read
//   FAIL  T3 a slot fires for twenty minutes and not a minute more, and the latest slot wins inside its window
check('T3 a slot fires for twenty minutes and not a minute more, and the latest slot wins inside its window',
  K.slotKeyFor(at('2026-09-21T13:49:00Z'))?.key === '2026-09-21T07:30'
  && K.slotKeyFor(at('2026-09-21T13:50:00Z')) === null
  && K.slotKeyFor(at('2026-09-21T19:35:00Z'))?.key === '2026-09-21T13:30'
  && K.slotKeyFor(at('2026-09-21T17:35:00Z'))?.key === '2026-09-21T11:30');

// NEGATIVE CONTROL (run 2026-09-21): '2026-09-07' removed from NYSE_HOLIDAYS made this read
//   FAIL  T4 a weekend and a holiday are not trading days, a Monday is, and the day after Thanksgiving closes early
check('T4 a weekend and a holiday are not trading days, a Monday is, and the day after Thanksgiving closes early',
  math.isTradingDay('2026-09-19') === false && math.isTradingDay('2026-09-20') === false
  && math.isTradingDay('2026-09-07') === false && math.isTradingDay('2026-09-21') === 'full'
  && math.isTradingDay('2026-11-27') === 'early' && math.isTradingDay('2027-07-05') === false && math.isTradingDay('nope') === false);

// NEGATIVE CONTROL (run 2026-09-21): slotsFor returning SCAN_SLOTS on an early day made this read
//   FAIL  T5 an early close gets the two morning slots, a holiday none, an ordinary day four, and the weekend scan is never Saturday
check('T5 an early close gets the two morning slots, a holiday none, an ordinary day four, and the weekend scan is never Saturday',
  K.slotsFor('2026-11-27').join() === '07:30,09:30' && K.slotsFor('2026-09-07').length === 0
  && K.slotsFor('2026-09-21').length === 4 && K.slotKeyFor(at('2026-09-19T13:35:00Z')) === null
  && K.slotKeyFor(at('2026-11-27T18:35:00Z')) === null
  && K.nextSlotAfter(at('2026-09-18T21:00:00Z'))?.key === '2026-09-21T07:30');

{
  const now = at('2026-09-21T15:35:00Z');
  const due = K.scanDue({ state: { lastSlot: '2026-09-21T07:30' }, settings: {}, hasKey: true, now });
  const ran = K.scanDue({ state: { lastSlot: '2026-09-21T09:30' }, settings: {}, hasKey: true, now });
  const off = K.scanDue({ state: {}, settings: { scansOn: false }, hasKey: true, now });
  const noKey = K.scanDue({ state: {}, settings: {}, hasKey: false, now });
  const none = K.scanDue({ state: {}, settings: {}, hasKey: true, now: at('2026-09-21T03:00:00Z') });
  // NEGATIVE CONTROL (run 2026-09-21): `state?.lastSlot === slot.key` became `!==` made this read
  //   FAIL  T6 a scan is due once per slot: not twice, not with scans off, not without a key, not outside a window, and each refusal says why
  check('T6 a scan is due once per slot: not twice, not with scans off, not without a key, not outside a window, and each refusal says why',
    due.due === true && due.key === '2026-09-21T09:30'
    && ran.due === false && ran.why === 'already ran'
    && off.due === false && off.why === 'scans off'
    && noKey.due === false && noKey.why === 'no key'
    && none.due === false && none.why === 'no slot' && none.key === null,
    JSON.stringify({ due, ran, off, noKey, none }));
}

// ---- T7 and T8: the cron's minute, run ----------------------------------------
{
  const settingsDoc = { data: { finnhubKey: 'abcdefghijklmnop1234', accountType: 'cash', startCents: 200000, startedAt: '2026-09-01' }, updateTime: 'S1' };
  const stateDoc = { data: { lastSlot: '2026-09-21T07:30' }, updateTime: 'T1' };
  const run = async (over) => {
    const { w, api } = world(over);
    w.docs.set('trade/settings', settingsDoc);
    if (over.stateDoc !== null) w.docs.set('trade/state', over.stateDoc || stateDoc);
    const out = await api.maybeTradeScan(env, at('2026-09-21T15:35:00Z'));
    return { w, out };
  };
  const lost = await run({ claim: false });
  const won = await run({ claim: true });
  const fresh = await run({ claim: true, stateDoc: null });
  const claimOf = (w) => w.patches.find((p) => p.path === 'trade/state' && p.data.lastSlot);
  // NEGATIVE CONTROL (run 2026-09-21): `if (!claimed)` became `if (false)` made this read
  //   FAIL  T7 a lost claim on the slot runs nothing and a won claim runs one scan: the claim rides ifUpdateTime with a state document and mustNotExist without
  check('T7 a lost claim on the slot runs nothing and a won claim runs one scan: the claim rides ifUpdateTime with a state document and mustNotExist without',
    lost.out.ran === false && lost.out.why === 'claim lost' && lost.w.creates.length === 0 && lost.w.diag.some((e) => e.ev === 'trade-claim-lost')
    && claimOf(lost.w)?.opts?.ifUpdateTime === 'T1' && claimOf(lost.w)?.data.lastSlot === '2026-09-21T09:30'
    && won.out.ran === true && won.w.creates.length === 1
    && won.w.patches.some((p) => p.path.startsWith('trade/flights/items/') && p.data.kind === 'scan' && p.data.slotKey === '2026-09-21T09:30')
    && won.w.diag.some((e) => e.ev === 'trade-scan-submit' && e.slot === '2026-09-21T09:30')
    && claimOf(fresh.w)?.opts?.mustNotExist === true && fresh.out.ran === true,
    JSON.stringify({ lost: lost.out, won: won.out, creates: won.w.creates.length }));

  const quiet = await run({ claim: true, deps: {} });
  const { w: early, api: apiEarly } = world({ claim: true });
  early.docs.set('trade/settings', settingsDoc);
  const outEarly = await apiEarly.maybeTradeScan(env, at('2026-09-21T12:00:00Z'));
  // NEGATIVE CONTROL (run 2026-09-21): the settings read moved above `slotKeyFor` made this read
  //   FAIL  T8 outside the four windows the cron's minute reads nothing at all, and inside one it reads the two documents once
  check('T8 outside the four windows the cron\'s minute reads nothing at all, and inside one it reads the two documents once',
    outEarly.ran === false && outEarly.why === 'no slot' && early.reads === 0 && quiet.w.reads === 2,
    JSON.stringify({ early: early.reads, inside: quiet.w.reads }));
}

// ---- T9 and T10: the turn and the words ----------------------------------------
{
  const scan = K.tradeTurn({ kind: 'scan', user: 'x' });
  const ask = K.tradeTurn({ kind: 'ask', user: 'y', search: false });
  const raw = JSON.stringify(scan);
  // NEGATIVE CONTROL (run 2026-09-21): `thinking: { type: 'adaptive' }` added to the body made this read
  //   FAIL  T9 a scan turn is the pinned id at high with one web search tool of eight uses and no thinking key and no cache_control; a question is max, and search can be left off
  check('T9 a scan turn is the pinned id at high with one web search tool of eight uses and no thinking key and no cache_control; a question is max, and search can be left off',
    scan.model === 'claude-fable-5-1' && !('thinking' in scan) && scan.output_config.effort === 'high' && !scan.output_config.format
    && scan.tools?.length === 1 && scan.tools[0].max_uses === 8 && !/cache_control/.test(raw)
    && scan.system.length === 2 && scan.system[0].text === K.TRADE_PLAYBOOK && scan.system[1].text === K.TRADE_REGISTER
    && scan.messages[0].role === 'user' && scan.messages[0].content === 'x' && scan.max_tokens === 32000
    && ask.output_config.effort === 'max' && !('tools' in ask) && ask.max_tokens === 16000);

  const words = ['PDT', 'IV crush', '0DTE', 'VWAP', 'opening range', 'position size', 'gap and go', 'relative volume', 'good faith violation', 'Sell nothing naked'];
  const reg = ['Plain English', 'Short declarative sentences', 'Numbers first', 'No figures of speech', 'No greetings', 'No em dashes and no en dashes'];
  // NEGATIVE CONTROL (run 2026-09-21): 'No figures of speech' deleted from TRADE_REGISTER made this read
  //   FAIL  T10 the playbook names the setups, the option risks, the PDT rule and sizing; the register says plain English, short sentences, numbers first, no figures of speech, no greetings, no dashes
  check('T10 the playbook names the setups, the option risks, the PDT rule and sizing; the register says plain English, short sentences, numbers first, no figures of speech, no greetings, no dashes',
    words.every((x) => K.TRADE_PLAYBOOK.includes(x)) && reg.every((x) => K.TRADE_REGISTER.includes(x))
    && /ONE JSON object/.test(K.TRADE_PLAYBOOK) && /"profitLow": integer/.test(K.TRADE_PLAYBOOK)
    && !DASH.test(K.TRADE_PLAYBOOK) && !DASH.test(K.TRADE_REGISTER),
    words.filter((x) => !K.TRADE_PLAYBOOK.includes(x)).join(', '));
}

// ---- T11 to T13: the answer, read strictly, and the verdict ---------------------
{
  const two = K.parseScan(msg('```json\n' + JSON.stringify(GOOD) + '\n```'));
  const missing = K.parseScan(msg(JSON.stringify({ ...GOOD, plays: [{ ...GOOD.plays[0], profitLow: undefined }, GOOD.plays[1]] })));
  let threw = '';
  try { K.parseScan(msg('I would not trade today.')); } catch (e) { threw = e.message; }
  // NEGATIVE CONTROL (run 2026-09-21): the `profitLow` check dropped from validPlay (int(...) replaced by 0) made this read
  //   FAIL  T11 a fenced JSON answer yields its two plays, a play without profitLow is dropped and counted, and prose throws the plain sentence
  check('T11 a fenced JSON answer yields its two plays, a play without profitLow is dropped and counted, and prose throws the plain sentence',
    two.plays.length === 2 && two.dropped === 0 && two.quiet === false && two.notes.length === 1 && two.summary === GOOD.summary
    && missing.plays.length === 1 && missing.dropped === 1 && missing.plays[0].ticker === 'TSLA'
    && threw === K.SAY.unreadable,
    JSON.stringify({ two: two.plays.length, dropped: missing.dropped, threw }));

  const badSide = K.parseScan(msg(JSON.stringify({ ...GOOD, plays: [{ ...GOOD.plays[0], side: 'buy' }, GOOD.plays[1]] })));
  // NEGATIVE CONTROL (run 2026-09-21): the side enum widened to include 'buy' made this read
  //   FAIL  T12 a play with a side that is not long or short is dropped, a ticker is uppercased, and a dash in the why is gone before it is stored
  check('T12 a play with a side that is not long or short is dropped, a ticker is uppercased, and a dash in the why is gone before it is stored',
    badSide.plays.length === 1 && badSide.dropped === 1
    && two.plays[0].ticker === 'NVDA' && !DASH.test(two.plays[0].why) && /Gap held/.test(two.plays[0].why)
    && two.plays[0].overnight.ok === false && two.plays[0].targets.length === 1
    && K.validPlay({ ...GOOD.plays[0], profitLow: 70, profitHigh: 60 }) === null
    && K.validPlay({ ...GOOD.plays[0], targets: [] }) === null,
    JSON.stringify({ why: two.plays[0].why }));

  const quiet = K.scanVerdict({ plays: [], notes: [] }, {});
  const notes = K.scanVerdict({ plays: [], notes: [{ text: 'x' }] }, {});
  const strong = K.scanVerdict(two, {});
  const weak = K.scanVerdict({ plays: [{ ...two.plays[0], profitLow: 54 }], notes: [] }, {});
  const noCat = K.scanVerdict({ plays: [{ ...two.plays[0], catalyst: ' ' }], notes: [] }, {});
  const off = K.scanVerdict(two, { pushOn: false });
  // NEGATIVE CONTROL (run 2026-09-21): `p.profitLow >= STRONG_PROFIT_LOW` became `>` made this read
  //   FAIL  T13 nothing at all is quiet, notes alone write without a push, a play at 55 with a catalyst pushes a body naming the ticker and side, 54 does not, no catalyst does not, and pushes off silences
  check('T13 nothing at all is quiet, notes alone write without a push, a play at 55 with a catalyst pushes a body naming the ticker and side, 54 does not, no catalyst does not, and pushes off silences',
    quiet.result === 'quiet' && quiet.write === false && quiet.push === false
    && notes.result === 'notes' && notes.write === true && notes.push === false
    && strong.result === 'plays' && strong.push === true && /^NVDA long: Oct 17 650\/655 call debit spread, 56 to 64% chance\.$/.test(strong.body) && !DASH.test(strong.body)
    && K.scanVerdict({ plays: [{ ...two.plays[0], profitLow: 55 }], notes: [] }, {}).push === true
    && weak.push === false && weak.result === 'plays' && noCat.push === false
    && off.push === false && off.write === true,
    JSON.stringify({ strong: strong.body, weak: weak.push, off: off.push }));
}

// ---- T14 and T15: the landing, run -------------------------------------------------
{
  const flight = { kind: 'scan', batchId: 'b1', customId: 'c1', submittedAt: new Date(Date.now() - 300_000).toISOString(), slotKey: '2026-09-21T09:30' };
  const run = async (text, over = {}) => {
    const { w, api } = world(over);
    w.docs.set('trade/settings', { data: { pushOn: true, ...(over.settings || {}) } });
    const out = await api.finishScan(env, flight, msg(text));
    return { w, out };
  };
  const quiet = await run(JSON.stringify({ quiet: true, summary: '', notes: [], plays: [] }));
  const plays = await run(JSON.stringify(GOOD));
  const broken = await run('nothing here');
  const feedOf = (w) => w.patches.filter((p) => p.path.startsWith('trade/feed/items/'));
  const playsOf = (w) => w.patches.filter((p) => p.path.startsWith('trade/plays/items/'));
  // NEGATIVE CONTROL (run 2026-09-21): the notifyUser call removed from finishScan made this read
  //   FAIL  T14 a quiet landing writes only the state and no feed row; plays write a feed row, a play row each and one push to his uid with the portal link; an unreadable answer writes an error row and says so in the state
  check('T14 a quiet landing writes only the state and no feed row; plays write a feed row, a play row each and one push to his uid with the portal link; an unreadable answer writes an error row and says so in the state',
    quiet.out.result === 'quiet' && feedOf(quiet.w).length === 0 && playsOf(quiet.w).length === 0 && quiet.w.pushes.length === 0
    && quiet.w.patches.some((p) => p.path === 'trade/state' && p.data.lastScanResult === 'quiet')
    && plays.out.result === 'plays' && feedOf(plays.w).length === 1 && playsOf(plays.w).length === 2
    && feedOf(plays.w)[0].data.kind === 'scan' && feedOf(plays.w)[0].data.slot === '09:30' && feedOf(plays.w)[0].data.playIds.length === 2
    && playsOf(plays.w).every((p) => p.data.status === 'open' && p.data.expiresAt instanceof Date && p.data.slot === '09:30')
    && plays.w.pushes.length === 1 && plays.w.pushes[0].uid === 'eric' && plays.w.pushes[0].link === '/admin-trade.html' && plays.w.pushes[0].title === 'Pocket Advocate' && /^NVDA long/.test(plays.w.pushes[0].body)
    && plays.w.diag.some((e) => e.ev === 'trade-push') && plays.w.diag.some((e) => e.ev === 'trade-scan-end' && e.ok === true && e.plays === 2)
    && broken.out.result === 'error' && feedOf(broken.w).length === 1 && feedOf(broken.w)[0].data.kind === 'error' && /could not be read/.test(feedOf(broken.w)[0].data.text)
    && broken.w.patches.some((p) => p.path === 'trade/state' && p.data.lastScanResult === 'error'),
    JSON.stringify({ quiet: quiet.out, plays: plays.out.result, pushes: plays.w.pushes.length, broken: broken.out }));

  const row = (extra = {}) => ({ id: 'tX', updateTime: 'U1', data: { ...flight, progressAt: new Date(Date.now() - 60_000).toISOString(), ...extra } });
  const poll = async (over, extra) => {
    const { w, api } = world({ poll: { state: 'done', message: msg(JSON.stringify(GOOD)) }, ...over });
    w.listed['trade/flights/items'] = [row(extra)];
    w.docs.set('trade/settings', { data: {} });
    const touched = await api.pollTradeFlights(env, { minAgeMs: 15_000 });
    return { w, touched };
  };
  const lost = await poll({ claim: false });
  const won = await poll({ claim: true });
  const held = await poll({ claim: true }, { finishingAt: new Date(Date.now() - 60_000).toISOString() });
  const young = await poll({ claim: true }, { progressAt: new Date().toISOString() });
  const failed = await poll({ poll: { state: 'failed', why: 'batch died' } });
  // NEGATIVE CONTROL (run 2026-09-21): `if (won === false) continue;` removed made this read
  //   FAIL  T15 a landed flight is finished once: the claim on the flight row decides, a fresh finishingAt defers, a young heartbeat is not polled, and a failed batch writes its error row and deletes the flight
  check('T15 a landed flight is finished once: the claim on the flight row decides, a fresh finishingAt defers, a young heartbeat is not polled, and a failed batch writes its error row and deletes the flight',
    lost.w.patches.some((p) => p.path === 'trade/flights/items/tX' && p.opts?.ifUpdateTime === 'U1' && p.data.finishingAt)
    && feedOf(lost.w).length === 0 && lost.w.deletes.length === 0
    && won.touched === true && feedOf(won.w).length === 1 && won.w.deletes.includes('trade/flights/items/tX')
    && held.touched === false && feedOf(held.w).length === 0
    && young.touched === false && young.w.patches.length === 0
    && failed.touched === true && feedOf(failed.w).length === 1 && feedOf(failed.w)[0].data.kind === 'error' && failed.w.deletes.includes('trade/flights/items/tX')
    && failed.w.diag.some((e) => e.ev === 'trade-scan-end' && e.ok === false),
    JSON.stringify({ lost: feedOf(lost.w).length, won: won.touched, held: held.touched, young: young.touched, failed: failed.touched }));
}

// NEGATIVE CONTROL (run 2026-09-21): `askFlightNext` dropped from trade.js's import in favour of a local copy made this read
//   FAIL  T16 the verdict on a poll is the advisor's own, imported, with its two hour abandon and thirty unreachable polls intact
check('T16 the verdict on a poll is the advisor\'s own, imported, with its two hour abandon and thirty unreachable polls intact',
  /import \{[^}]*\baskFlightNext\b[^}]*\} from '\.\/advisor\.js';/.test(T) && !/function askFlightNext/.test(T)
  && /const ASK_ABANDON_MS = 2 \* 3_600_000;\nconst ASK_POLL_FAILS_MAX = 30;/.test(ADV)
  && askFlightNext({ submittedAt: new Date(Date.now() - 3 * 3_600_000).toISOString() }, { state: 'running' }).op === 'fail'
  && /const next = askFlightNext\(flight, poll, Date\.now\(\)\);/.test(T));

// ---- T17 and T18: the submit and the market -----------------------------------------
{
  const turn = K.tradeTurn({ kind: 'scan', user: 'x' });
  const run = async (fails) => {
    const { w, api } = world({ createFails: fails });
    let out; let threw = null;
    try { out = await api.submitTradeBatch(env, turn, 'trade-x'); } catch (e) { threw = e; }
    return { w, out, threw };
  };
  const tools = await run([Object.assign(new Error('tools of type web_search_20260209 are not supported here'), { status: 400 })]);
  const model = await run([Object.assign(new Error('model: claude-fable-5-1 not found'), { status: 404 })]);
  const boom = await run([Object.assign(new Error('overloaded'), { status: 500 })]);
  // NEGATIVE CONTROL (run 2026-09-21): the 500 swallowed (`throw err` replaced by `return create(turn)`) made this read
  //   FAIL  T17 a 400 naming tools resubmits once without search and stamps searchOff, a 404 naming the model resubmits once on the fallback id, and anything else throws after one create
  check('T17 a 400 naming tools resubmits once without search and stamps searchOff, a 404 naming the model resubmits once on the fallback id, and anything else throws after one create',
    tools.w.creates.length === 2 && !('tools' in tools.w.creates[1].requests[0].params) && tools.out.search === false
    && tools.w.patches.some((p) => p.path === 'trade/state' && p.data.searchOff === true) && tools.w.diag.some((e) => e.ev === 'trade-search-off')
    && model.w.creates.length === 2 && model.w.creates[1].requests[0].params.model === 'claude-opus-5' && model.out.model === 'claude-opus-5'
    && model.w.diag.some((e) => e.ev === 'trade-model-fallback')
    && boom.threw && /overloaded/.test(boom.threw.message) && boom.w.creates.length === 1,
    JSON.stringify({ tools: tools.w.creates.length, model: model.out, boom: boom.threw?.message }));

  const { w, api } = world();
  const snap = await api.marketSnapshot('abcdefghijklmnop1234', ['SPY', 'NVDA']);
  const { w: w2, api: api2 } = world({ fetchStatus: 403 });
  const refused = await api2.marketSnapshot('abcdefghijklmnop1234', ['SPY']);
  const content = api.scanUserContent({ now: at('2026-09-21T15:35:00Z'), slot: '09:30', snap, settings: { accountType: 'margin', startCents: 200000, startedAt: '2026-09-01', finnhubKey: 'abcdefghijklmnop1234' }, balanceCents: 218000, plays: [], questions: [] });
  // NEGATIVE CONTROL (run 2026-09-21): the key concatenated into scanUserContent's first line made this read
  //   FAIL  T18 a real secret wins over the pasted key, the quote URL carries the token, a refused endpoint leaves the ticker named missing and nothing thrown, and the key never appears in what the desk is told
  check('T18 a real secret wins over the pasted key, the quote URL carries the token, a refused endpoint leaves the ticker named missing and nothing thrown, and the key never appears in what the desk is told',
    K.resolveKey({ FINNHUB_KEY: 'envkey' }, { finnhubKey: 'docs' }) === 'envkey' && K.resolveKey({}, { finnhubKey: 'docs' }) === 'docs' && K.resolveKey({}, {}) === ''
    && K.keyTail('abcd1234wxyz') === 'wxyz' && K.keyTail('') === ''
    && w.fetches.some((u) => /finnhub\.io\/api\/v1\/quote\?symbol=SPY&token=abcdefghijklmnop1234/.test(u))
    && snap.quotes.length === 2 && snap.quotes[0].last === 100.5 && snap.missing.length === 0 && snap.news.length === 1 && snap.earnings[0].symbol === 'ORCL'
    && refused.quotes.length === 0 && refused.missing.join() === 'SPY' && refused.newsOk === false && w2.fetches.length === 3
    && !/abcdefghijklmnop1234/.test(content) && /margin account/.test(content) && /\$2,180\.00/.test(content) && /09:30 scan/.test(content) && /SPY 100\.5/.test(content) && /ORCL amc/.test(content)
    && !DASH.test(content),
    JSON.stringify({ missing: refused.missing, fetches: w.fetches.length }));
}

// ---- T19 to T23: the arithmetic and the chart ---------------------------------------
const FIX = [{ date: '2026-09-01', cents: 205000 }, { date: '2026-09-04', cents: 212000 }, { date: '2026-09-10', cents: 208000 }, { date: '2026-09-16', cents: 220000 }, { date: '2026-09-21', cents: 238000 }];
const near = (a, b, tol) => Math.abs(a - b) <= tol;
{
  const m = math.tradeMetrics(FIX, { startedAt: '2026-08-31' });
  // NEGATIVE CONTROL (run 2026-09-21): TRADING_DAYS_PER_YEAR changed to 250 made this read
  //   FAIL  T19 fourteen trading days from a $2,000 start to $2,380: 1.25% a day, 1.75 points under the target, $645 under the line, and two projected years
  check('T19 fourteen trading days from a $2,000 start to $2,380: 1.25% a day, 1.75 points under the target, $645 under the line, and two projected years',
    m.days === 14 && m.currentCents === 238000 && m.gainCents === 38000 && near(m.avgDaily, 0.0125, 0.0002)
    && near(m.offTargetPoints, -1.75, 0.02) && near(m.targetCents, 302518, 50) && near(m.offTargetCents, -64518, 50)
    && m.projections && m.projections.linearYearCents === 684000 && near(m.projections.compoundYearCents, 5212323, 5)
    && m.entries[0].dayIndex === 1 && m.entries[4].dayIndex === 14,
    JSON.stringify({ days: m.days, avg: m.avgDaily, pts: m.offTargetPoints, proj: m.projections }));

  const thirteen = math.tradeMetrics(FIX.slice(0, 4).concat([{ date: '2026-09-18', cents: 238000 }]), { startedAt: '2026-08-31' });
  // NEGATIVE CONTROL (run 2026-09-21): `days >= minDays` became `>` made this read
  //   FAIL  T20 the same run ending a trading day earlier is thirteen days and shows no projection, and the gate is fourteen
  check('T20 the same run ending a trading day earlier is thirteen days and shows no projection, and the gate is fourteen',
    thirteen.days === 13 && thirteen.projections === null && thirteen.minDays === 14 && m.projections !== null,
    JSON.stringify({ days: thirteen.days }));

  const ahead = math.tradeMetrics([{ date: '2026-09-21', cents: 320000 }], { startedAt: '2026-08-31' });
  const own = math.tradeMetrics([{ date: '2026-09-21', cents: 600000 }], { startedAt: '2026-08-31', startCents: 500000 });
  // NEGATIVE CONTROL (run 2026-09-21): `currentCents - targetCents` swapped made this read
  //   FAIL  T21 a run above the line reads positive both ways, and a different starting amount moves the line and the average with it
  check('T21 a run above the line reads positive both ways, and a different starting amount moves the line and the average with it',
    ahead.offTargetPoints > 0 && ahead.offTargetCents > 0 && ahead.days === 14
    && own.startCents === 500000 && own.gainCents === 100000 && near(own.targetCents, 500000 * Math.pow(1.03, 14), 50) && own.offTargetCents < 0
    && math.tradeMetrics([], { startedAt: '2026-08-31' }).currentCents === 200000 && math.tradeMetrics([], { startedAt: '2026-08-31' }).days === 0,
    JSON.stringify({ ahead: ahead.offTargetPoints, own: own.targetCents }));

  const c = math.chartSeries(m);
  // NEGATIVE CONTROL (run 2026-09-21): the target series started at x = 1 made this read
  //   FAIL  T22 the chart carries his six points from day 0 and fifteen target points from the start, and its top is the higher of the two lines
  check('T22 the chart carries his six points from day 0 and fifteen target points from the start, and its top is the higher of the two lines',
    c.points.length === 6 && c.points[0].x === 0 && c.points[0].y === 200000 && c.target.length === 15 && c.target[0].x === 0 && c.target[0].y === 200000
    && c.target[14].y === m.targetCents && c.xMax === 14 && c.yMax === Math.max(302518, 238000) && c.yMin === 200000,
    JSON.stringify({ points: c.points.length, target: c.target.length, yMax: c.yMax }));

  const svgChart = new Function(`${lift(P, 'function svgChart(chart, { w = 340, h = 200 } = {}) {')}\nreturn svgChart;`)();
  const svg = svgChart(c);
  // NEGATIVE CONTROL (run 2026-09-21): `var(--target)` replaced by `#E5B800` on the target polyline made this read
  //   FAIL  T23 the page's chart is one SVG with a viewBox and a role, two polylines coloured by token (his in cyan, the target in the yellow token), a dot per entry, and not one hex colour
  check('T23 the page\'s chart is one SVG with a viewBox and a role, two polylines coloured by token (his in cyan, the target in the yellow token), a dot per entry, and not one hex colour',
    /^<svg viewBox="0 0 340 200" width="100%" role="img" aria-label="[^"]+"/.test(svg.trim())
    && (svg.match(/<polyline /g) || []).length === 2 && /stroke="var\(--target\)"/.test(svg) && /stroke="var\(--cyan\)"/.test(svg)
    && (svg.match(/<circle /g) || []).length === 6 && !/#[0-9a-fA-F]{3,6}\b/.test(svg) && svgChart(null) === ''
    && /:root \{ --target: #B58A00; \}/.test(CSS) && /data-scheme="calm"\] \{ --target: #FFD54A; \}/.test(CSS) && /\.trade-chart svg/.test(CSS),
    svg.slice(0, 120));
}

// ---- T24 and T25: the gate and the payload -----------------------------------------------
{
  const src = lift(W, 'async function handleTrade(request, env, url) {');
  const run = async ({ admin, route }) => {
    const calls = [];
    const api = new Function('deps', `const { requireAdmin, json, tradeRoute, TradeError } = deps;\n${src}\nreturn handleTrade;`)({
      requireAdmin: async () => admin, json: (data, status = 200) => ({ data, status }),
      tradeRoute: async (env, args) => { calls.push(args); return route(args); }, TradeError: K.TradeError,
    });
    const req = (method, path) => ({ method, json: async () => ({ question: 'q' }) });
    const out = {};
    for (const [m, p] of [['GET', 'state'], ['POST', 'ask'], ['POST', 'nope'], ['GET', '']]) out[`${m} ${p}`] = await api(req(m, p), env, { pathname: `/api/admin/trade/${p}` });
    return { out, calls };
  };
  const stranger = await run({ admin: null, route: () => ({ ok: true }) });
  const him = await run({ admin: { uid: 'eric' }, route: ({ sub }) => { if (sub === 'nope') throw new K.TradeError(404, 'Not found'); if (sub === 'ask') throw new K.TradeError(409, 'A scan is already running. It lands on its own.'); return { ok: true, sub }; } });
  let rethrown = false;
  try { await run({ admin: { uid: 'eric' }, route: () => { throw new Error('boom'); } }); } catch { rethrown = true; }
  // NEGATIVE CONTROL (run 2026-09-21): the stranger's 404 changed to 403 made this read
  //   FAIL  T24 a stranger gets 404 on every sub-path and never reaches the dispatch; he gets the dispatch, a TradeError is its own status, and anything else is rethrown to the ordinary catch
  check('T24 a stranger gets 404 on every sub-path and never reaches the dispatch; he gets the dispatch, a TradeError is its own status, and anything else is rethrown to the ordinary catch',
    Object.values(stranger.out).every((r) => r.status === 404 && r.data.error === 'Not found') && stranger.calls.length === 0
    && him.out['GET state'].status === 200 && him.out['GET state'].data.sub === 'state' && him.calls[0].method === 'GET'
    && him.out['POST ask'].status === 409 && him.calls[1].body.question === 'q'
    && him.out['POST nope'].status === 404 && rethrown
    && /if \(url\.pathname\.startsWith\('\/api\/admin\/trade\/'\)\)\n\s+return await handleTrade\(request, env, url\);/.test(W),
    JSON.stringify({ stranger: Object.values(stranger.out).map((r) => r.status), him: Object.values(him.out).map((r) => r.status) }));

  const { w, api } = world();
  w.docs.set('trade/settings', { data: { finnhubKey: 'abcd1234wxyz', accountType: 'margin', startCents: 250000, startedAt: '2026-08-31', watchlist: ['SPY'] } });
  w.docs.set('trade/state', { data: { seenAt: new Date(Date.now() - 3600_000).toISOString() } });
  w.listed['trade/feed/items'] = [
    { id: 'f1', data: { at: new Date().toISOString(), kind: 'scan', text: 's' } },
    { id: 'f2', data: { at: new Date().toISOString(), kind: 'question', text: 'q', status: 'done', answer: 'a' } },
    { id: 'f3', data: { at: new Date(Date.now() - 7200_000).toISOString(), kind: 'note', text: 'old' } },
  ];
  w.listed['trade/balances/items'] = FIX.map((b) => ({ id: b.date, data: b }));
  const payload = await api.tradeState(env, { now: at('2026-09-21T15:35:00Z') });
  const raw = JSON.stringify(payload);
  // NEGATIVE CONTROL (run 2026-09-21): `settings: pub` replaced by `settings: { ...settings, ...pub }` in statePayload made this read
  //   FAIL  T25 the payload carries whether a key is on file and its last four characters and never the key; the settings, the metrics from his own start, the chart, the unseen count, the next slot and the day
  check('T25 the payload carries whether a key is on file and its last four characters and never the key; the settings, the metrics from his own start, the chart, the unseen count, the next slot and the day',
    !/abcd1234wxyz/.test(raw) && !/abcd1234/.test(raw) && payload.hasKey === true && payload.keyTail === 'wxyz'
    && payload.settings.accountType === 'margin' && payload.settings.startCents === 250000 && payload.settings.watchlist.join() === 'SPY' && payload.settings.scansOn === true
    && payload.metrics.startCents === 250000 && payload.metrics.days === 14 && payload.chart.target.length === 15 && payload.balances.length === 5
    && payload.unseen === 1 && payload.feed.length === 3 && payload.feed[1].id === 'f2'
    && payload.nextSlot.key === '2026-09-21T11:30' && payload.tradingDay === 'full' && payload.today === '2026-09-21',
    JSON.stringify({ hasKey: payload.hasKey, tail: payload.keyTail, unseen: payload.unseen, next: payload.nextSlot?.key }));
}

// ---- T26 to T29: the routes, run with their sentences ------------------------------------
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
  const many = await run((api) => api.tradeSettings(env, { watchlist: Array.from({ length: 21 }, (_, i) => `T${i}`) }));
  const acct = await run((api) => api.tradeSettings(env, { accountType: 'x' }));
  const low = await run((api) => api.tradeSettings(env, { startCents: 50 }));
  const start = await run((api) => api.tradeSettings(env, { startCents: 300000, startedAt: '2026-09-01' }), { finnhubKey: 'abcdefghijklmnop1234', startedAt: '2026-08-31' });
  const first = await run((api) => api.tradeSettings(env, { pushOn: false }));
  const patchOf = (w) => w.patches.find((p) => p.path === 'trade/settings');
  // NEGATIVE CONTROL (run 2026-09-21): the watchlist cap raised to 21 made this read
  //   FAIL  T26 settings refuse a bad key, a 21st ticker, a third account type and a start under a dollar, each with its sentence; a list is uppercased and deduped; the start is stored in cents with its date; a first save stamps a start date; the reply never carries the key
  check('T26 settings refuse a bad key, a 21st ticker, a third account type and a start under a dollar, each with its sentence; a list is uppercased and deduped; the start is stored in cents with its date; a first save stamps a start date; the reply never carries the key',
    badKey.threw?.message === K.SAY.badKey && badKey.threw.status === 400 && badKey.w.patches.length === 0
    && list.out.settings.watchlist.join() === 'NVDA,TSLA' && patchOf(list.w).data.watchlist.join() === 'NVDA,TSLA' && patchOf(list.w).data.setByHand === true
    && many.threw?.message === K.SAY.badWatchlist && acct.threw?.message === K.SAY.badAccount && low.threw?.message === K.SAY.badStart
    && patchOf(start.w).data.startCents === 300000 && patchOf(start.w).data.startedAt === '2026-09-01' && start.out.settings.startCents === 300000
    && start.out.hasKey === true && start.out.keyTail === '1234' && !/abcdefghijklmnop1234/.test(JSON.stringify(start.out))
    && /^\d{4}-\d{2}-\d{2}$/.test(patchOf(first.w).data.startedAt) && patchOf(first.w).data.pushOn === false && patchOf(first.w).opts.mask.includes('startedAt'),
    JSON.stringify({ list: list.out?.settings.watchlist, start: start.out?.settings.startCents, first: patchOf(first.w)?.data }));

  const NOW = at('2026-09-21T20:00:00Z');
  const up = await run((api) => api.tradeBalance(env, { date: '2026-09-21', cents: 238000, note: 'after close — done' }, NOW));
  const rm = await run((api) => api.tradeBalance(env, { date: '2026-09-21', remove: true }, NOW));
  const future = await run((api) => api.tradeBalance(env, { date: '2026-09-22', cents: 1 }, NOW));
  const neg = await run((api) => api.tradeBalance(env, { date: '2026-09-21', cents: -1 }, NOW));
  const junk = await run((api) => api.tradeBalance(env, { date: '2026-02-30', cents: 1 }, NOW));
  // NEGATIVE CONTROL (run 2026-09-21): the future-date refusal (`|| date > today`) dropped made this read
  //   FAIL  T27 a balance is upserted at its date path with a dash-free note, removed by date, and refused for tomorrow, a negative figure or a date that does not exist, each with its sentence
  check('T27 a balance is upserted at its date path with a dash-free note, removed by date, and refused for tomorrow, a negative figure or a date that does not exist, each with its sentence',
    up.out.ok === true && up.w.patches[0].path === 'trade/balances/items/2026-09-21' && up.w.patches[0].data.cents === 238000 && !DASH.test(up.w.patches[0].data.note)
    && rm.out.removed === '2026-09-21' && rm.w.deletes[0] === 'trade/balances/items/2026-09-21'
    && future.threw?.message === K.SAY.badDate && neg.threw?.message === K.SAY.badCents && junk.threw?.message === K.SAY.badDate,
    JSON.stringify({ up: up.out, rm: rm.out, future: future.threw?.message }));

  const withPlay = async (fn) => run((api, w) => { w.docs.set('trade/plays/items/p1', { data: { ticker: 'NVDA', status: 'open', tookAt: null } }); return fn(api); });
  const took = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'took' }));
  const closed = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'closed', outcomeCents: 4500 }));
  const noOut = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'closed' }));
  const skip = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'skipped' }));
  const gone = await run((api) => api.tradePlay(env, { id: 'p9', status: 'took' }));
  const badStatus = await withPlay((api) => api.tradePlay(env, { id: 'p1', status: 'sold' }));
  // NEGATIVE CONTROL (run 2026-09-21): `closed` accepted without outcomeCents (the badOutcome throw removed) made this read
  //   FAIL  T28 a play taken stamps when, closed needs the dollars and stamps both, skipped is skipped, an unknown play is 404 and a fourth status is refused, each with its sentence
  check('T28 a play taken stamps when, closed needs the dollars and stamps both, skipped is skipped, an unknown play is 404 and a fourth status is refused, each with its sentence',
    took.out.play.status === 'took' && took.w.patches[0].data.tookAt instanceof Date && took.w.patches[0].opts.mask.join() === 'status,tookAt'
    && closed.out.play.outcomeCents === 4500 && closed.w.patches[0].data.closedAt instanceof Date && closed.w.patches[0].data.tookAt instanceof Date
    && noOut.threw?.message === K.SAY.badOutcome && skip.out.play.status === 'skipped'
    && gone.threw?.message === K.SAY.noPlay && gone.threw.status === 404 && badStatus.threw?.message === K.SAY.badStatus,
    JSON.stringify({ took: took.out?.play.status, closed: closed.out?.play.outcomeCents, noOut: noOut.threw?.message }));

  const empty = await run((api) => api.tradeAsk(env, { question: '   ' }));
  const long = await run((api) => api.tradeAsk(env, { question: 'x'.repeat(2001) }));
  const asked = await run((api) => api.tradeAsk(env, { question: 'Is NVDA a long here?' }), { finnhubKey: 'abcdefghijklmnop1234' });
  const qRow = asked.w.patches.find((p) => p.path.startsWith('trade/feed/items/'));
  const flightRow = asked.w.patches.find((p) => p.path.startsWith('trade/flights/items/'));
  const { w: fw, api: fapi } = world();
  await fapi.finishAsk(env, { kind: 'ask', feedId: 'fQ', submittedAt: new Date().toISOString() }, msg('Yes — small.'));
  const done = fw.patches.find((p) => p.path === 'trade/feed/items/fQ');
  // NEGATIVE CONTROL (run 2026-09-21): the question turn's effort changed to high made this read
  //   FAIL  T29 a question is trimmed and bounded with its sentence, written running, submitted at max with the desk's system, its flight carrying the row id; the landing writes the answer done with no dash
  check('T29 a question is trimmed and bounded with its sentence, written running, submitted at max with the desk\'s system, its flight carrying the row id; the landing writes the answer done with no dash',
    empty.threw?.message === K.SAY.askEmpty && long.threw?.message === K.SAY.askEmpty && empty.w.patches.length === 0
    && asked.out.ok === true && qRow.data.kind === 'question' && qRow.data.status === 'running' && qRow.data.text === 'Is NVDA a long here?'
    && asked.w.creates.length === 1 && asked.w.creates[0].requests[0].params.output_config.effort === 'max' && asked.w.creates[0].requests[0].params.system[0].text === K.TRADE_PLAYBOOK
    && /His question: Is NVDA a long here\?/.test(asked.w.creates[0].requests[0].params.messages[0].content)
    && flightRow.data.kind === 'ask' && flightRow.data.feedId === asked.out.feedId && asked.w.creates[0].requests[0].custom_id.length <= 64
    && asked.w.diag.some((e) => e.ev === 'trade-ask-submit')
    && done.data.status === 'done' && done.data.answer === 'Yes. small.' && fw.diag.some((e) => e.ev === 'trade-ask-end' && e.ok === true),
    JSON.stringify({ effort: asked.w.creates[0]?.requests[0].params.output_config, done: done?.data.answer }));
}

// ---- T30 to T35: the pins -----------------------------------------------------------------
// NEGATIVE CONTROL (run 2026-09-21): the `maybeTradeScan(env, fired)` line removed from scheduled() made this read
//   FAIL  T30 the Worker imports the desk, scans at the cron's minute, polls its flights from the cron and from any API request, and both hooks swallow their own errors
check('T30 the Worker imports the desk, scans at the cron\'s minute, polls its flights from the cron and from any API request, and both hooks swallow their own errors',
  /import \{ tradeRoute, TradeError, maybeTradeScan, pollTradeFlights \} from '\.\/trade\.js';/.test(W)
  && /ctx\.waitUntil\(closeBookingsAug2026\(env\)\);\n(?:\s*\/\/[^\n]*\n)*\s+ctx\.waitUntil\(maybeTradeScan\(env, fired\)\.catch\(\(\) => \{\}\)\);\n\s+ctx\.waitUntil\(pollTradeFlights\(env, \{ minAgeMs: 45_000 \}\)\.catch\(\(\) => \{\}\)\);/.test(W)
  && /ctx\.waitUntil\(pollFlightsNow\(env\)\.catch\(\(\) => \{\}\)\);\n(?:\s*\/\/[^\n]*\n)*\s+ctx\.waitUntil\(pollTradeFlights\(env, \{ minAgeMs: 45_000 \}\)\.catch\(\(\) => \{\}\)\);/.test(W)
  && (W.match(/pollTradeFlights\(env, \{ minAgeMs: 45_000 \}\)/g) || []).length === 2
  && /^export function client\(env\) \{/m.test(ADV) && /^export function batchCustomId\(/m.test(ADV) && /^export async function pollTurnBatch\(/m.test(ADV));

{
  const entry = (CL.match(/\{\n\s+\/\/ THE TRADE PORTAL[\s\S]*?\n  \},/) || [''])[0];
  const cssTail = CSS.slice(CSS.indexOf('/* Trade portal'));
  // NEGATIVE CONTROL (run 2026-09-21): an em dash typed into the Desk tab's empty-feed sentence made this read
  //   FAIL  T31 not one em or en dash in the module, the page, its markup, the drive, the seed's desk rows, the stylesheet's section or the version note
  check('T31 not one em or en dash in the module, the page, its markup, the drive, the seed\'s desk rows, the stylesheet\'s section or the version note',
    !DASH.test(T) && !DASH.test(P) && !DASH.test(H) && !DASH.test(DRIVE) && !DASH.test(cssTail) && !DASH.test(entry)
    && !DASH.test(SEED.slice(SEED.indexOf('the Trade portal (2026-09-21)'))) && !DASH.test(D.slice(D.indexOf('the Trade portal (2026-09-21)'), D.indexOf('the advisor, from a fixture'))),
    [T, P, H, DRIVE].map((s, i) => (DASH.test(s) ? ['trade.js', 'admin-trade.js', 'admin-trade.html', 'drive'][i] : '')).filter(Boolean).join(', '));

  const HARD = [/advisor/i, /differential/i, /\bAI\b/, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bOpus\b/i, /\bFable\b/i, /\bthe model\b/i, /\ba model\b/i, /chatbot/i];
  // NEGATIVE CONTROL (run 2026-09-21): 'the model' typed into the entry's second admin line made this read
  //   FAIL  T32 both versions read 4.6, the entry is quiet and admin-only with its two lines, and nothing in the version note or the sign-in module carries a word from the blindness list
  check('T32 both versions read 4.6, the entry is quiet and admin-only with its two lines, and nothing in the version note or the sign-in module carries a word from the blindness list',
    /export const VERSION = '4\.6';/.test(CL) && /const VERSION = '4\.6';/.test(W) && /const BUILD_TAG = 'v2026-09-21-trade-portal';/.test(W)
    && /version: '4\.6',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry) && (entry.match(/^\s+'[^\n]+',$/gm) || []).length >= 2
    && /Trade portal/.test(entry) && /3% a day line, in yellow/.test(entry)
    && HARD.every((re) => !re.test(CL)) && HARD.every((re) => !re.test(AUTH)),
    HARD.filter((re) => re.test(CL)).map(String).join(', '));
}

{
  const gate = (W.match(/const ADMIN_ASSET =\n\s+(\/.*\/);/) || [])[1];
  const ADMIN_ASSET = gate ? new Function(`return ${gate};`)() : null;
  // NEGATIVE CONTROL (run 2026-09-21): '/admin-trade' removed from the audit's ADMIN_PAGES made this read
  //   FAIL  T33 the audit proves the page and the module 404 to a stranger, the sideways drive walks the page, and the asset gate matches both names and not a bare trade.js
  check('T33 the audit proves the page and the module 404 to a stranger, the sideways drive walks the page, and the asset gate matches both names and not a bare trade.js',
    /'\/admin-trade',/.test(AUDIT) && /'\/js\/admin-trade\.js',/.test(AUDIT) && /'\/admin-trade\.html\?demo=admin'/.test(NOSIDE)
    && !!ADMIN_ASSET && ADMIN_ASSET.test('/admin-trade.html') && ADMIN_ASSET.test('/admin-trade') && ADMIN_ASSET.test('/js/admin-trade.js')
    && !ADMIN_ASSET.test('/js/trade.js') && !ADMIN_ASSET.test('/js/trade-math.js'),
    String(gate).slice(0, 80));
}

{
  const mirror = D.slice(D.indexOf('the Trade portal (2026-09-21)'), D.indexOf('the advisor, from a fixture'));
  const sentences = Object.entries(K.SAY).filter(([k]) => k !== 'unreadable' && k !== 'notFound').map(([, v]) => v);
  // NEGATIVE CONTROL (run 2026-09-21): the mirror's badCents sentence altered by one word made this read
  //   FAIL  T34 the demo keeps his desk off the client half, seeds a key on file with fifteen trading days of balances, imports the same arithmetic, and refuses with the Worker's exact sentences
  check('T34 the demo keeps his desk off the client half, seeds a key on file with fifteen trading days of balances, imports the same arithmetic, and refuses with the Worker\'s exact sentences',
    /\/\^trade\\\/\//.test(STORE) && /set\('trade\/settings', \{\n\s+finnhubKey: 'demo-finnhub-key-1234'/.test(SEED)
    && /trade\/balances\/items\/\$\{dk\(n\)\}/.test(SEED) && /\[\[20, 200000\], \[17, 205000\], \[14, 212000\], \[9, 208000\], \[5, 220000\], \[0, 238000\]\]/.test(SEED)
    && /import \{ tradeMetrics, chartSeries \} from '\.\.\/trade-math\.js';/.test(D) && /tradeMetrics\(balances, \{ startedAt: p\.startedAt, startCents: p\.startCents \}\)/.test(mirror)
    && /if \(role !== 'admin'\) return fail\(404, 'Not found'\);/.test(mirror)
    && sentences.every((s) => mirror.includes(`'${s.replace(/'/g, "\\'")}'`)),
    sentences.filter((s) => !mirror.includes(`'${s.replace(/'/g, "\\'")}'`)).join(' | '));
}

// NEGATIVE CONTROL (run 2026-09-21): the Trade link removed from admin-chats.html made this read
//   FAIL  T35 all seven admin pages link the desk, its own page marks the tab active, loads the admin stylesheet at its current version and the two modules, and hands the mount to admin-trade.js
check('T35 all seven admin pages link the desk, its own page marks the tab active, loads the admin stylesheet at its current version and the two modules, and hands the mount to admin-trade.js',
  ['admin', 'admin-calendar', 'admin-chats', 'admin-availability', 'admin-dictionary', 'admin-case', 'admin-trade']
    .every((p) => /<a href="\/admin-trade\.html"( class="active")?>📈 Trade<\/a>/.test(f(`public/${p}.html`)))
  && /<a href="\/admin-trade\.html" class="active">📈 Trade<\/a>/.test(H) && /admin\.css\?v=stat111/.test(H)
  && /<script type="module" src="\/js\/admin-trade\.js"><\/script>\n<script type="module" src="\/js\/admin-presence\.js"><\/script>/.test(H)
  && /<div id="trade">/.test(H) && /const user = await requireAdmin\(\);\nif \(user\) mount\(\);/.test(P)
  && /Ideas, not orders\. Every trade is your decision\./.test(P));

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
