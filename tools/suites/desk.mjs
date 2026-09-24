// desk.mjs - PR 420, the six-agent desk's engine (worker/desk-run.js).
//
//   node tools/suites/desk.mjs
//
// Eric, 2026-09-23: "Five researchers investigate. One senior desk agent
// makes the call. I receive the trade. That is it." And: "The Trading Desk
// should NOT review my trade history when deciding future trades."
//
// The pure parts are imported and run. The run itself (queue, claim, the five
// researchers, the desk, filing, the push, resume and handoff) is evaluated
// from source with its imports replaced by a fake database and fake turns, so
// every path RUNS against recorders rather than being pinned by pattern.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';
import * as TD from '../../worker/trade-desk.js';
import * as TM from '../../public/js/trade-math.js';
import * as DR from '../../worker/desk-run.js';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const SRC = f('worker/desk-run.js');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
const DASH = /[\u2013\u2014]/;

// ---- the harness ---------------------------------------------------------------
const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const setPath = (o, p, v) => {
  const ks = p.split('.');
  let cur = o;
  for (const k of ks.slice(0, -1)) { if (cur[k] == null || typeof cur[k] !== 'object' || cur[k] instanceof Date) cur[k] = {}; cur = cur[k]; }
  const last = ks[ks.length - 1];
  if (v === undefined) delete cur[last]; else cur[last] = v;
};
const clone = (x) => structuredClone(x);

function world({ state = null, settings = { caseId: 'c1', accountType: 'cash' }, research = null, plays = {}, balances = {} } = {}) {
  const docs = new Map();
  let t = 0;
  const put = (path, data) => docs.set(path, { data: clone(data), updateTime: `U${++t}` });
  if (state) put(TD.STATE_PATH, state);
  if (settings) put(TD.SETTINGS_PATH, settings);
  if (research) put(DR.RESEARCH_PATH, research);
  for (const [id, p] of Object.entries(plays)) put(`${TD.PLAYS}/${id}`, p);
  for (const [id, b] of Object.entries(balances)) put(`${TD.BALANCES}/${id}`, b);
  // `calls` counts every request that would leave the Worker (2026-09-23): one invocation gets fifty,
  // measured in production. A read or write is one, a batch is one, the flight recorder is two (it reads
  // its ring, then writes it), a push is its profile read, one send per device (three devices here) and
  // a cleanup write, and a turn is counted at its worst: every retry and every continuation it may make.
  const w = { docs, patches: [], diag: [], pushes: [], bodies: [], calls: 0, batches: [] };
  const write = (path, data, opts = {}) => {
    const cur = docs.get(path);
    if (opts.mustNotExist && cur) return false;
    if (opts.ifUpdateTime && (!cur || cur.updateTime !== opts.ifUpdateTime)) return false;
    let next;
    if (opts.mask) {
      next = cur ? clone(cur.data) : {};
      for (const m of opts.mask) setPath(next, m, clone(getPath(data, m)));
    } else next = clone(data);
    put(path, next);
    return true;
  };
  const deps = {
    READ_FAILED: Symbol('read failed'),
    tryGet: async (env, path) => { w.calls += 1; return docs.has(path) ? clone(docs.get(path)) : null; },
    patchDoc: async (env, path, data, opts = {}) => {
      w.calls += 1;
      w.patches.push({ path, data: clone(data), opts: clone(opts) });
      return write(path, data, opts);
    },
    batchGetDocs: async (env, paths) => { w.calls += 1; w.batches.push({ get: paths.slice() }); return paths.map((p) => (docs.has(p) ? clone(docs.get(p)) : null)); },
    batchWrite: async (env, writes) => {
      w.calls += 1;
      w.batches.push({ write: writes.map((x) => x.path) });
      return writes.map((x) => { w.patches.push({ path: x.path, data: clone(x.data), opts: { mask: x.mask, ifUpdateTime: x.ifUpdateTime, mustNotExist: x.mustNotExist, batch: true } }); return write(x.path, x.data, x); });
    },
    client: () => { throw new Error('no network in the suite'); },
    diagLog: async (env, row) => { w.calls += 2; w.diag.push(row); },
    notifyUser: async (env, uid, msg) => { w.calls += 1 + Math.min(3, msg.max ?? 10) + 1; w.pushes.push({ uid, ...msg }); },
  };
  return { w, deps, docs, put };
}

// desk-run.js, evaluated with its imports replaced.
function load(deps) {
  const body = SRC.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export /gm, '');
  const names = {
    batchGetDocs: async () => { throw new Error('batchGetDocs not faked'); },
    batchWrite: async () => { throw new Error('batchWrite not faked'); },
    ...deps,
    SETTINGS_PATH: TD.SETTINGS_PATH, STATE_PATH: TD.STATE_PATH, PLAYS: TD.PLAYS, SAY: TD.SAY, stripDashes: TD.stripDashes,
    mtParts: TD.mtParts, mtInstant: TD.mtInstant, mtLabel: TD.mtLabel, watchlistOf: TD.watchlistOf, resolveKey: TD.resolveKey,
    marketSnapshot: TD.marketSnapshot, quoteCached: TD.quoteCached, rid: TD.rid, realDate: TD.realDate,
    isTradingDay: TM.isTradingDay, isMarketOpen: TM.isMarketOpen, swingLastDay: TM.swingLastDay, nextDateKey: TM.nextDateKey,
    EARLY_CLOSE_MIN: TM.EARLY_CLOSE_MIN, MARKET_CLOSE_MIN: TM.MARKET_CLOSE_MIN, MARKET_OPEN_MIN: TM.MARKET_OPEN_MIN,
    positionKey: TM.positionKey, screenTrades: TM.screenTrades, GLP1_CHAIN: TM.GLP1_CHAIN,
  };
  const keys = Object.keys(names);
  return new Function(...keys, `${body}\nreturn { accumulateSse, liveTurn, requestRun, maybeRunDesk, executeRun, maybeMorningRun, runAlive, RefusedError, peekDesk, deskClaimable, fatalOf, chainNote };`)(...keys.map((k) => names[k]));
}

// A research turn and a desk turn, scripted per test.
const REPORT = (n) => `## Read\nTape is firm.\n## Candidates\nTicker: NVDA\nSide: long\n## Rejected\nTSLA, extended.\n## Watch\nNothing.\n(researcher ${n})`;
const TRADE = (over = {}) => ({
  ticker: 'NVDA', side: 'long', horizon: 'intraday', instrument: 'stock', lastPrice: 248.1,
  entryLow: 247.5, entryHigh: 248, stop: 245.8, targets: [251, 253.5], holdMinutes: 180, holdDays: null,
  allocPct: 40, chanceLow: 56, chanceHigh: 64, setup: 'Reclaimed VWAP on twice normal volume after the guide raise.',
  catalyst: 'Data center guide raised overnight.', invalidation: 'Loses 246 on volume.', strike: null, expiry: null, agreement: 3, ...over,
});
const DESK_OUT = (over = {}) => ({
  read: 'Indexes firm, tech leading.', none: '',
  trades: [TRADE(), TRADE({ ticker: 'XLE', horizon: 'swing', holdMinutes: null, holdDays: 2, entryLow: 90, entryHigh: 90.5, stop: 88, targets: [94], chanceLow: 55, chanceHigh: 60, setup: 'Oil bid, energy leading the week.' })],
  news: [{ headline: 'Fed speaker at noon', tickers: ['SPY'], why: 'Could move rates and tech.' }],
  ...over,
});
function turns({ research = () => ({ text: REPORT(0) }), desk = () => ({ text: JSON.stringify(DESK_OUT()) }) } = {}, w) {
  return async (env, body, opts = {}) => {
    w.bodies.push(clone(body));
    w.calls += (1 + (opts.maxRetries ?? 0)) * (1 + (opts.maxContinues ?? DR.MAX_CONTINUES));
    const isResearch = Array.isArray(body.tools) && body.tools.length;
    const n = isResearch ? Number((body.messages[0].content[0].text.match(/^Your beat: ([^.]+)\./) || [])[1] && DR.LENSES.find((L) => body.messages[0].content[0].text.startsWith(`Your beat: ${L.name}.`))?.n) : 0;
    const out = isResearch ? await research(n, body, opts) : await desk(body, opts);
    if (out instanceof Error) throw out;
    return { message: { stop_reason: out.stop || 'end_turn', content: [] }, text: out.text, usage: { input_tokens: 1000, output_tokens: 500, searches: isResearch ? 3 : 0 }, turns: 1 };
  };
}
// A Wednesday, 10:00 Mountain, market open.
const WED_10 = Date.UTC(2026, 8, 23, 16, 0);
const realNow = Date.now;
const at = (ms) => { Date.now = () => ms; };
const restore = () => { Date.now = realNow; };
const env = { ADMIN_UID: 'eric' };
const runOf = (docs) => docs.get(TD.STATE_PATH)?.data?.run;

// ---- D1 to D3: the transport -------------------------------------------------------
const ev = (o) => `event: ${o.type}\ndata: ${JSON.stringify(o)}\n\n`;
const SSE = [
  ev({ type: 'message_start', message: { id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-fable-5-1', content: [], stop_reason: null, usage: { input_tokens: 1200, output_tokens: 1 } } }),
  ev({ type: 'ping' }),
  ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } }),
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Checking the tape. ' } }),
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'NVDA leads.' } }),
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG1' } }),
  ev({ type: 'content_block_stop', index: 0 }),
  ev({ type: 'content_block_start', index: 1, content_block: { type: 'server_tool_use', id: 'srvtoolu_1', name: 'web_search', input: {} } }),
  ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query": "NVDA pre' } }),
  ev({ type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: 'market"}' } }),
  ev({ type: 'content_block_stop', index: 1 }),
  ev({ type: 'content_block_start', index: 2, content_block: { type: 'web_search_tool_result', tool_use_id: 'srvtoolu_1', content: [{ type: 'web_search_result', url: 'https://x.test/a', title: 'A', encrypted_content: 'enc' }] } }),
  ev({ type: 'content_block_stop', index: 2 }),
  ev({ type: 'content_block_start', index: 3, content_block: { type: 'text', text: '' } }),
  ev({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: 'NVDA is up ' } }),
  ev({ type: 'content_block_delta', index: 3, delta: { type: 'citations_delta', citation: { type: 'web_search_result_location', url: 'https://x.test/a', cited_text: 'up 2%' } } }),
  ev({ type: 'content_block_delta', index: 3, delta: { type: 'text_delta', text: '2% premarket.' } }),
  ev({ type: 'content_block_stop', index: 3 }),
  ev({ type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null, container: { id: 'cont_1' } }, usage: { input_tokens: 1300, output_tokens: 850, server_tool_use: { web_search_requests: 1 } } }),
  ev({ type: 'message_stop' }),
].join('');
{
  const m = DR.accumulateSse(SSE);
  const crlf = DR.accumulateSse(SSE.replace(/\n/g, '\r\n'));
  const empty = DR.accumulateSse(SSE.replace(/"partial_json":"[^"]*"/g, '"partial_json":""'));
  // NEGATIVE CONTROL (run 2026-09-23): the signature_delta branch changed to append
  //   (`b.signature = (b.signature || '') + ...`) with a second delta 'SIG2' added made this read
  //   FAIL  D1 the buffered stream is rebuilt into the message ...
  const twoSig = DR.accumulateSse(SSE.replace(ev({ type: 'content_block_stop', index: 0 }), ev({ type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG2' } }) + ev({ type: 'content_block_stop', index: 0 })));
  check('D1 the buffered stream is rebuilt into the message the endpoint would have sent: blocks in order, thinking text joined and its signature ASSIGNED as the SDK does, a server tool\'s input parsed from its partial json and an empty one left {}, a search result kept whole, text joined with its citation, usage overwritten cumulatively, the stop reason and the container carried, and CRLF framing read the same',
    m.id === 'msg_1' && m.content.map((b) => b.type).join() === 'thinking,server_tool_use,web_search_tool_result,text'
    && m.content[0].thinking === 'Checking the tape. NVDA leads.' && m.content[0].signature === 'SIG1' && twoSig.content[0].signature === 'SIG2'
    && m.content[1].input.query === 'NVDA premarket' && JSON.stringify(empty.content[1].input) === '{}'
    && m.content[2].content[0].encrypted_content === 'enc'
    && m.content[3].text === 'NVDA is up 2% premarket.' && m.content[3].citations.length === 1
    && m.usage.input_tokens === 1300 && m.usage.output_tokens === 850 && m.usage.server_tool_use.web_search_requests === 1
    && m.stop_reason === 'end_turn' && m.container.id === 'cont_1'
    && crlf.content.length === 4 && DR.textOf(m) === 'NVDA is up 2% premarket.',
    JSON.stringify({ sig: twoSig.content[0].signature, usage: m.usage }));
}
{
  let a = ''; let b = '';
  try { DR.accumulateSse(SSE + ev({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } })); } catch (e) { a = e.message; }
  try { DR.accumulateSse('event: ping\ndata: {"type":"ping"}\n\n'); } catch (e) { b = e.message; }
  const refused = DR.accumulateSse(SSE.replace('"stop_reason":"end_turn"', '"stop_reason":"refusal","stop_details":{"type":"refusal","category":"cyber"}'));
  // NEGATIVE CONTROL (run 2026-09-23): the `if (errored)` throw removed made this read
  //   FAIL  D2 a stream that reports an error, or never starts, throws ...
  check('D2 a stream that reports an error, or never starts, throws with the reason rather than filing half an answer; a refusal surfaces with its category',
    /overloaded_error/.test(a) && /before the answer started/.test(b) && refused.stop_reason === 'refusal' && refused.stop_details?.category === 'cyber',
    JSON.stringify({ a, b }));
}
{
  const { deps } = world();
  const M = load(deps);
  const sent = [];
  const paused = SSE.replace('"stop_reason":"end_turn"', '"stop_reason":"pause_turn"');
  const call = (seq) => { let i = 0; return async (req) => { sent.push(clone(req)); const body = seq[Math.min(i++, seq.length - 1)]; return { text: async () => body }; }; };
  const two = await M.liveTurn({}, { model: 'm', messages: [{ role: 'user', content: 'go' }] }, { call: call([paused, SSE]) });
  const cap = await M.liveTurn({}, { model: 'm', messages: [{ role: 'user', content: 'go' }] }, { call: call([paused, paused, paused, paused]), maxContinues: 1 });
  let refused = null;
  try { await M.liveTurn({}, { model: 'm', messages: [] }, { call: call([SSE.replace('"stop_reason":"end_turn"', '"stop_reason":"refusal","stop_details":{"type":"refusal","category":"bio"}')]) }); } catch (e) { refused = e; }
  // NEGATIVE CONTROL (run 2026-09-23): the continuation's `messages = [...messages, { role: 'assistant', content: last.content }]`
  //   changed to `messages = messages` made this read    FAIL  D3 a paused turn is continued append-only ...
  check('D3 a paused turn is continued append-only: the paused assistant turn is passed back exactly as it came with the container id, no extra user message, the texts of both segments joined and the usage summed; continuations stop at the cap; a refusal throws a RefusedError with its category instead of being read as an answer',
    sent.length >= 2 && sent[1].messages.length === 2 && sent[1].messages[1].role === 'assistant'
    && JSON.stringify(sent[1].messages[1].content) === JSON.stringify(DR.accumulateSse(paused).content)
    && sent[1].container === 'cont_1' && !sent[1].messages.some((m, i) => i > 0 && m.role === 'user')
    && two.text === 'NVDA is up 2% premarket.NVDA is up 2% premarket.' && two.turns === 2 && two.usage.output_tokens === 1700 && two.usage.searches === 2
    && cap.turns === 2 && refused?.refused === true && refused.category === 'bio',
    JSON.stringify({ n: sent.length, turns: two.turns, cap: cap.turns }));
}

// ---- D4 to D8: checking what the desk returned, and the clock ------------------------
{
  const s = { open: true, minsToOpen: 0 };
  const today = '2026-09-23';
  const ok = DR.validRec(TRADE(), { accountType: 'cash', session: s, todayKey: today });
  const cashShort = DR.validRec(TRADE({ side: 'short', stop: 250, targets: [244], entryLow: 247, entryHigh: 247.5 }), { accountType: 'cash', session: s });
  const marginShort = DR.validRec(TRADE({ side: 'short', stop: 250, targets: [244], entryLow: 247, entryHigh: 247.5 }), { accountType: 'margin', session: s });
  const badStop = DR.validRec(TRADE({ stop: 249 }), { session: s });
  const badTarget = DR.validRec(TRADE({ targets: [247] }), { session: s });
  const stopInZone = DR.validRec(TRADE({ stop: 247.8 }), { session: s });
  const swapped = DR.validRec(TRADE({ entryLow: 248, entryHigh: 247.5 }), { session: s });
  const call = DR.validRec(TRADE({ instrument: 'call', strike: 250, expiry: '2026-10-16', entryLow: 3.2, entryHigh: 3.4, stop: 1.6, targets: [5] }), { session: s, todayKey: today });
  const noContract = DR.validRec(TRADE({ instrument: 'call', strike: null, expiry: null, entryLow: 3.2, entryHigh: 3.4, stop: 1.6, targets: [5] }), { session: s, todayKey: today });
  const pastExpiry = DR.validRec(TRADE({ instrument: 'put', strike: 240, expiry: '2026-09-01', entryLow: 2, entryHigh: 2.2, stop: 1, targets: [4] }), { session: s, todayKey: today });
  const shortCall = DR.validRec(TRADE({ instrument: 'call', side: 'short', strike: 250, expiry: '2026-10-16', entryLow: 3.2, entryHigh: 3.4, stop: 1.6, targets: [5] }), { session: s, todayKey: today });
  const scalpNight = DR.validRec(TRADE({ horizon: 'scalp' }), { session: { open: false, minsToOpen: null } });
  const scalpPre = DR.validRec(TRADE({ horizon: 'scalp' }), { session: { open: false, minsToOpen: 30 } });
  const clamps = DR.validRec(TRADE({ allocPct: 90, holdMinutes: 9000, chanceLow: 70, chanceHigh: 60, setup: 'Up \u2014 and away', ticker: ' nvda ' }), { session: s });
  const swing = DR.validRec(TRADE({ horizon: 'swing', holdDays: 9, holdMinutes: 30 }), { session: s });
  const badTargets = DR.validRec(TRADE({ targets: [253.5, 251] }), { session: s });
  // NEGATIVE CONTROL (run 2026-09-23): the cash-account short guard
  //   (`if (instrument === 'stock' && side === 'short' && accountType !== 'margin') return null;`) removed made this read
  //   FAIL  D4 a trade is checked field by field ...
  // NEGATIVE CONTROL (run 2026-09-23): the long-side check `stop < lo` changed to `stop < hi` (a stop inside the entry zone) made this read
  //   FAIL  D4 a trade is checked field by field ...
  check('D4 a trade is checked field by field before he ever sees it: the ticker uppercased, a short stock refused on a cash account and kept on margin, a stop or a target on the wrong side of the entry refused, a reversed entry zone swapped, an option kept only as a bought contract with a strike and an expiry still ahead, a scalp refused overnight but kept within an hour of the open, the size, hold and chance clamped, a swing held one to three days, targets kept in order, and every dash stripped',
    ok && ok.ticker === 'NVDA' && ok.entry === 247.75 && ok.targets.join() === '251,253.5' && ok.profitLow === 56
    && cashShort === null && marginShort?.side === 'short' && badStop === null && badTarget === null && stopInZone === null
    && swapped?.entryLow === 247.5 && swapped.entryHigh === 248
    && call?.instrument === 'call' && call.strike === 250 && call.expiry === '2026-10-16' && noContract === null && pastExpiry === null && shortCall === null
    && scalpNight === null && scalpPre?.horizon === 'scalp'
    && clamps.ticker === 'NVDA' && clamps.allocPct === 50 && clamps.holdMinutes === 480 && clamps.profitLow === 60 && clamps.profitHigh === 70 && !DASH.test(clamps.setup)
    && swing.holdDays === 3 && swing.holdMinutes === null && badTargets.targets.join() === '253.5',
    JSON.stringify({ ok: !!ok, cashShort, marginShort: !!marginShort, clamps }));
}
{
  const many = { trades: [
    TRADE(), TRADE(), TRADE({ ticker: 'AMD' }), TRADE({ ticker: 'SMCI' }),
    TRADE({ ticker: 'XLE', horizon: 'swing', holdDays: 2 }), TRADE({ ticker: 'XLF', horizon: 'swing', holdDays: 2 }), TRADE({ ticker: 'XLK', horizon: 'swing', holdDays: 2 }),
    TRADE({ ticker: 'TSLA', horizon: 'scalp' }), TRADE({ ticker: 'META', horizon: 'scalp' }), TRADE({ ticker: 'AAPL', horizon: 'scalp' }),
    TRADE({ ticker: '12' }),
  ], news: Array.from({ length: 9 }, (_, i) => ({ headline: `News ${i} \u2013 moved`, tickers: ['spy', 'bad ticker', 'QQQ'], why: 'Because.' })), read: 'Firm.', none: '' };
  const c = DR.checkDesk(many, { session: { open: true } });
  const perKind = (k) => c.trades.filter((t) => t.horizon === k).length;
  // NEGATIVE CONTROL (run 2026-09-23): `perKind[r.horizon] >= MAX_PER_HORIZON` removed from checkDesk made this read
  //   FAIL  D5 the desk's answer is capped ...
  check('D5 the desk\'s answer is capped the way his screen needs: at most six trades and two of each kind, the same ticker, side and kind never twice, a bad ticker dropped and counted, at most six news items with their tickers cleaned and no dashes',
    c.trades.length === 6 && perKind('intraday') === 2 && perKind('swing') === 2 && perKind('scalp') === 2
    && c.trades.filter((t) => t.ticker === 'NVDA').length === 1 && c.dropped === 5
    && c.news.length === 6 && c.news[0].tickers.join() === 'SPY,QQQ' && !c.news.some((n) => DASH.test(n.headline)),
    JSON.stringify({ n: c.trades.length, dropped: c.dropped }));
}
{
  const obj = DESK_OUT();
  // NEGATIVE CONTROL (run 2026-09-23): the fenced-block branch removed from parseDesk made this read
  //   FAIL  D6 the desk's JSON is read whether it came back bare, fenced or wrapped in a sentence ...
  check('D6 the desk\'s JSON is read whether it came back bare, fenced or wrapped in a sentence, and anything else reads as nothing rather than a guess',
    DR.parseDesk(JSON.stringify(obj))?.trades.length === 2
    && DR.parseDesk(`Plan {draft}. Here it is:\n\`\`\`json\n${JSON.stringify(obj)}\n\`\`\`\nDone.`)?.read === obj.read
    && DR.parseDesk(`Sure. ${JSON.stringify(obj)} That is all.`)?.news.length === 1
    && DR.parseDesk('no json here') === null && DR.parseDesk('') === null);
}
{
  const iso = (x) => new Date(x).toISOString();
  const preOpen = Date.UTC(2026, 8, 23, 13, 0); // 07:00 MT Wednesday
  const midday = Date.UTC(2026, 8, 23, 17, 0); // 11:00 MT
  const evening = Date.UTC(2026, 8, 24, 2, 0); // 20:00 MT Wednesday
  const friday = Date.UTC(2026, 8, 25, 17, 0); // 11:00 MT Friday
  const thanksgivingFri = Date.UTC(2026, 10, 27, 16, 0); // early close day, 09:00 MT
  // NEGATIVE CONTROL (run 2026-09-23): the swing branch changed to `closeOf(sessionDay)` made this read
  //   FAIL  D7 an untaken idea expires when it stops being worth taking ...
  check('D7 an untaken idea expires when it stops being worth taking: a scalp half an hour after the open or after the run, an intraday trade at that session\'s close (the next session\'s after hours, eleven on an early close), a swing at the close of the day it should be out by and never past the week\'s last close',
    iso(DR.recExpiry('scalp', { now: preOpen })) === '2026-09-23T14:00:00.000Z'
    && iso(DR.recExpiry('scalp', { now: midday })) === '2026-09-23T17:30:00.000Z'
    && iso(DR.recExpiry('intraday', { now: midday })) === '2026-09-23T20:00:00.000Z'
    && iso(DR.recExpiry('intraday', { now: evening })) === '2026-09-24T20:00:00.000Z'
    && iso(DR.recExpiry('swing', { holdDays: 2, now: midday })) === '2026-09-25T20:00:00.000Z'
    && iso(DR.recExpiry('swing', { holdDays: 3, now: friday })) === '2026-09-25T20:00:00.000Z'
    && iso(DR.recExpiry('intraday', { now: thanksgivingFri })) === '2026-11-27T18:00:00.000Z',
    JSON.stringify([DR.recExpiry('swing', { holdDays: 3, now: friday }), DR.recExpiry('intraday', { now: thanksgivingFri })]));
}
{
  const open = DR.sessionLine(WED_10);
  const pre = DR.sessionLine(Date.UTC(2026, 8, 23, 13, 0));
  const after = DR.sessionLine(Date.UTC(2026, 8, 23, 21, 0));
  const sat = DR.sessionLine(Date.UTC(2026, 8, 26, 16, 0));
  // NEGATIVE CONTROL (run 2026-09-23): the before-the-open branch's minsToOpen changed to null made this read
  //   FAIL  D8 every agent is told the session on his clock ...
  check('D8 every agent is told the session on his clock: open with the minutes to the close, before the open with the minutes to it, after the close, and no session on a weekend',
    open.open && /market is open and closes at 14:00 Mountain, 240 minutes/.test(open.text)
    && !pre.open && pre.minsToOpen === 30 && /before the open/.test(pre.text)
    && !after.open && /after the close/.test(after.text) && !sat.open && /closed today/.test(sat.text),
    JSON.stringify([open.text, pre.text]));
}

// ---- D9 to D10: the queue and the claim -----------------------------------------------
{
  at(WED_10);
  const fresh = world();
  const M = load(fresh.deps);
  const first = await M.requestRun(env, { now: WED_10 });
  const second = await M.requestRun(env, { now: WED_10 + 5000 });
  const stale = world({ state: { run: { id: 'old', status: 'researching', startedAt: new Date(WED_10 - 20 * 60_000), heartbeatAt: new Date(WED_10 - 10 * 60_000) } } });
  const again = await load(stale.deps).requestRun(env, { now: WED_10 });
  const idle = world({ state: { run: { id: 'old', status: 'idle' } } });
  const next = await load(idle.deps).requestRun(env, { now: WED_10, trigger: 'morning' });
  restore();
  // NEGATIVE CONTROL (run 2026-09-23): the `if (runAlive(run, now)) return { ok: true, already: true, run };` guard removed
  //   made this read    FAIL  D9 his tap only queues a run ...
  check('D9 his tap only queues a run and never starts a turn itself: the first tap queues one under a create-only claim, a second tap while it is alive buys nothing, a run whose heartbeat went quiet long ago is replaced, and the 7:00 trigger rides the same queue',
    first.ok && !first.already && runOf(fresh.docs).status === 'queued' && runOf(fresh.docs).trigger === 'manual'
    && fresh.w.patches[0].opts.mustNotExist === true && second.already === true
    && fresh.w.patches.filter((p) => p.path === TD.STATE_PATH).length === 1
    && again.already === false && runOf(stale.docs).id !== 'old' && runOf(stale.docs).status === 'queued'
    && next.already === false && runOf(idle.docs).trigger === 'morning',
    JSON.stringify({ first, second: second.already }));
}
{
  at(WED_10);
  const busy = world({ state: { run: { id: 'r1', status: 'researching', startedAt: new Date(WED_10 - 60_000), heartbeatAt: new Date(WED_10 - 20_000), attempt: 1 } } });
  const skipped = await load(busy.deps).maybeRunDesk(env, { deadlineAt: WED_10 + 12 * 60_000, now: WED_10, deps: { liveTurn: turns({}, busy.w) } });
  const tired = world({ state: { run: { id: 'r1', status: 'researching', startedAt: new Date(WED_10 - 30 * 60_000), heartbeatAt: new Date(WED_10 - 10 * 60_000), attempt: 3 } } });
  const gave = await load(tired.deps).maybeRunDesk(env, { deadlineAt: WED_10 + 12 * 60_000, now: WED_10, deps: { liveTurn: turns({}, tired.w) } });
  const handed = world({ state: { run: { id: 'r2', status: 'decide', queuedAt: new Date(WED_10 - 5 * 60_000), startedAt: new Date(WED_10 - 4 * 60_000), heartbeatAt: new Date(WED_10 - 30_000), attempt: 1 } },
    research: { runId: 'r2', r1: { status: 'ok', text: REPORT(1) }, r2: { status: 'ok', text: REPORT(2) }, r3: { status: 'ok', text: REPORT(3) }, r4: null, r5: null } });
  const tookIt = await load(handed.deps).maybeRunDesk(env, { deadlineAt: WED_10 + 12 * 60_000, now: WED_10, deps: { liveTurn: turns({}, handed.w) } });
  // RE-PINNED 2026-09-23 (v7.2, fifty calls): a run that failed in seconds still took the firing. What is
  // left of its fifty calls is not enough to promise a case read, so the drain waits one minute.
  const quick = world({ state: { run: { id: 'r3', status: 'queued', queuedAt: new Date(WED_10 - 30_000), attempt: 0 } } });
  const quickHeld = await load(quick.deps).maybeRunDesk(env, { deadlineAt: WED_10 + 12 * 60_000, now: WED_10, deps: { liveTurn: turns({ research: () => Object.assign(new Error('bad model'), { status: 400 }) }, quick.w) } });
  const claimPatch = handed.w.patches.find((p) => p.path === TD.STATE_PATH && p.opts.ifUpdateTime);
  restore();
  // NEGATIVE CONTROL (run 2026-09-23): the ready guard (`const ready = run.status === 'queued' || run.status === 'decide';`)
  //   changed to `const ready = run.status === 'queued';` made this read    FAIL  D10 the cron claims a run under a precondition ...
  check('D10 the cron claims a run under a precondition and never twice: a working run with a live heartbeat is left alone, one past its attempts or forty-five minutes is closed with a sentence he can act on, and a run whose research was handed to the desk is claimed at once, straight into the desk\'s phase, without buying the research again',
    skipped === false && busy.w.bodies.length === 0
    // RE-PINNED 2026-09-23 (v7.2): giving a run up is desk work, so it answers true and the drain waits a minute.
    && gave === true && runOf(tired.docs).status === 'error' && runOf(tired.docs).error === TD.SAY.runStalled
    // RE-PINNED 2026-09-23 (review): a claim of research handed to the desk is not a new attempt, so it keeps
    // attempt 1; and a run that failed in seconds answers false so the minute's case drain still runs.
    // NEGATIVE CONTROL (run 2026-09-23): maybeRunDesk's `return Date.now() - t0 >= (deps.heldMs ?? 60_000);` put back to `return true;` made this read
    //   FAIL  D10 the cron claims a run under a precondition ...
    && tookIt === true && claimPatch.data.run.phase === 'desk' && claimPatch.data.run.attempt === 1
    // NEGATIVE CONTROL (run 2026-09-23, v7.2): maybeRunDesk's final `return true;` changed to `return false;` made this read
    //   FAIL  D10 the cron claims a run under a precondition ...
    && quickHeld === true && runOf(quick.docs).status === 'error'
    && handed.w.bodies.length === 1 && !handed.w.bodies[0].tools && runOf(handed.docs).status === 'idle',
    JSON.stringify({ skipped, gave, tookIt, bodies: handed.w.bodies.length }));
}

// ---- D11 to D17: one run, start to finish ----------------------------------------------
const RUN = { id: 'run_x', status: 'researching', trigger: 'manual', startedAt: new Date(WED_10), claimedAt: new Date(WED_10), heartbeatAt: new Date(WED_10), attempt: 1, phase: 'research' };
// RE-PINNED 2026-09-23 (v7.2, fifty calls): a run is two firings now, the research in one and the desk's
// decision in the next, each with its own fifty calls. This plays both the way the cron does: the
// research firing, then, when it handed over, the claim maybeRunDesk makes and the desk firing. The
// calls each firing made are kept apart for D24.
async function firings(M, W, run, deps, { researchOnly = false } = {}) {
  const c0 = W.w.calls;
  const first = await M.executeRun(env, run, { deadlineAt: WED_10 + 12.5 * 60_000, deps });
  const researchCalls = W.w.calls - c0;
  if (!first.handedOff || researchOnly) return { out: first, first, researchCalls, deskCalls: 0 };
  const cur = W.docs.get(TD.STATE_PATH).data;
  const run2 = { ...cur.run, phase: 'desk', status: 'deciding', claimedAt: new Date(WED_10 + 60_000), attempt: Math.max(1, Number(cur.run.attempt) || 0) };
  W.put(TD.STATE_PATH, { ...cur, run: run2 });
  const c1 = W.w.calls;
  const out = await M.executeRun(env, run2, { deadlineAt: WED_10 + 60_000 + 12.5 * 60_000, deps });
  return { out, first, researchCalls, deskCalls: W.w.calls - c1 };
}
async function oneRun(opts = {}) {
  at(WED_10);
  const W = world({
    // The slot holds the same run and attempt the invocation was handed (2026-09-23): the run checks
    // it still owns the slot before every write, so a harness that disagreed would read as superseded.
    state: { run: { ...RUN, ...(opts.run || {}) }, desk: { runId: 'prev', ids: ['old_open', 'old_took'] }, ...(opts.state || {}) },
    settings: { caseId: 'c1', accountType: 'cash', finnhubKey: '', ...(opts.settings || {}) },
    plays: {
      // RE-PINNED 2026-09-23 (v7.2): the last run's idea was AMD, which is also on the default watchlist,
      // and the watchlist now reaches the researchers by name (it is his setting, not his history).
      old_open: { ticker: 'MRVL', status: 'open', runId: 'prev' },
      old_took: { ticker: 'SMCI', status: 'took', runId: 'prev' },
      hist_1: { ticker: 'ZZHIST', status: 'closed', result: 'loss', setup: 'HISTORYMARKER lost money here', outcomeCents: -4400 },
      ...(opts.plays || {}),
    },
    balances: { '2026-09-22': { date: '2026-09-22', cents: 987654 } },
    research: opts.research || null,
  });
  const M = load(W.deps);
  const f = await firings(M, W, { ...RUN, ...(opts.run || {}) }, { liveTurn: turns(opts.turns || {}, W.w), ...(opts.deps || {}) }, { researchOnly: opts.researchOnly });
  restore();
  return { ...f, ...W };
}
{
  const r = await oneRun();
  const research = r.w.bodies.filter((b) => b.tools);
  const desk = r.w.bodies.filter((b) => !b.tools);
  const recs = [...r.docs.entries()].filter(([p, v]) => p.startsWith(`${TD.PLAYS}/rec_`)).map(([, v]) => v.data);
  const st = r.docs.get(TD.STATE_PATH).data;
  const reportsDoc = r.docs.get(DR.RESEARCH_PATH).data;
  const end = r.w.diag.find((e) => e.ev === 'desk-run-end');
  // RE-PINNED 2026-09-23 (v7.2): the researchers' row rides the handoff, which ends the research firing.
  const handoff = r.w.diag.find((e) => e.ev === 'desk-run-handoff');
  // NEGATIVE CONTROL (run 2026-09-23): `output_config: structured ? { effort: DESK_EFFORT, format: ... }` changed to
  //   `{ effort: RESEARCH_EFFORT, format: ... }` made this read    FAIL  D11 one run, start to finish ...
  // NEGATIVE CONTROL (run 2026-09-23): the retirement loop in fileRecs emptied (`for (const id of [])`) made this read
  //   FAIL  D11 one run, start to finish ...
  // RE-RUN 2026-09-23 (v7.2, retiring is one read and one write now): retireRecs' ids emptied (`const ids = [];`) made this read
  //   FAIL  D11 one run, start to finish ...
  check('D11 one run, start to finish: five researchers on Fable 5.1 at medium with five web searches and streamed thinking summaries, each on its own beat and each report written as it lands; then one desk turn on Fable 5.1 at high with the structured schema and no tools; the checked trades filed as the new board with the run, an expiry and no taken time; the last run\'s untaken idea retired and the taken one left alone; the run closed with the count and the desk\'s read, news and ids; a push titled PR 420; and the recorder\'s end row',
    r.out.ok === true && research.length === 5 && desk.length === 1
    && research.every((b) => b.model === 'claude-fable-5-1' && b.output_config.effort === 'medium' && b.tools[0].type === 'web_search_20260209' && b.tools[0].max_uses === 5 && b.thinking?.display === 'summarized')
    && new Set(research.map((b) => b.messages[0].content[0].text.split('.')[0])).size === 5
    && ['r1', 'r2', 'r3', 'r4', 'r5'].every((k) => reportsDoc[k]?.status === 'ok') && reportsDoc.runId === 'run_x'
    && desk[0].model === 'claude-fable-5-1' && desk[0].output_config.effort === 'high' && desk[0].output_config.format.type === 'json_schema' && desk[0].thinking?.display === 'summarized'
    && recs.length === 2 && recs.every((x) => x.runId === 'run_x' && x.status === 'open' && x.expiresAt instanceof Date && x.tookAt === null)
    && r.docs.get(`${TD.PLAYS}/old_open`).data.status === 'expired' && r.docs.get(`${TD.PLAYS}/old_took`).data.status === 'took'
    && st.run.status === 'idle' && st.run.count === 2 && st.desk.runId === 'run_x' && st.desk.news.length === 1 && st.desk.ids.length === 2 && st.desk.read === 'Indexes firm, tech leading.'
    && r.w.pushes.length === 1 && r.w.pushes[0].title === 'PR 420' && /2 trades ready\. NVDA long, XLE long\./.test(r.w.pushes[0].body)
    && end?.ok === true && end.reports === 5 && end.trades === 2 && handoff?.agents.length === 5,
    JSON.stringify({ out: r.out, recs: recs.length, run: st.run?.status, pushes: r.w.pushes }));
}
{
  const r = await oneRun();
  const everything = JSON.stringify(r.w.bodies);
  // NEGATIVE CONTROL (run 2026-09-23): a closed trade read into the research message
  //   (`...${market}\n\n${JSON.stringify((await tryGet(env, `${PLAYS}/hist_1`))?.data || '')}`) made this read
  //   FAIL  D12 NO HISTORY REACHES ANY AGENT ...
  // RE-RUN 2026-09-23 (v7.2, the market rides the research doc): the same read appended after `${prior.market}` made this read
  //   FAIL  D12 NO HISTORY REACHES ANY AGENT ...
  check('D12 NO HISTORY REACHES ANY AGENT (Eric: "The Trading Desk should NOT review my trade history when deciding future trades."): not one of the six requests carries a closed trade, its result, its setup, his balance, or even his last trade\'s ticker',
    r.w.bodies.length === 6 && !/ZZHIST|HISTORYMARKER|9876\.54|987654|4400|SMCI|\bMRVL\b/.test(everything),
    (everything.match(/ZZHIST|HISTORYMARKER|9876\.54|987654|4400|SMCI|\bMRVL\b/) || [''])[0]);
}
{
  const refuse = await oneRun({ turns: { research: (n) => (n <= 2 ? { text: REPORT(n) } : Object.assign(new Error('refused (cyber)'), { refused: true })) } });
  const thin = await oneRun({ turns: { research: (n) => (n === 1 ? { text: REPORT(n) } : Object.assign(new Error('boom'), { status: 529 })) } });
  const thinRecs = [...thin.docs.keys()].filter((p) => p.startsWith(`${TD.PLAYS}/rec_`));
  // NEGATIVE CONTROL (run 2026-09-23): `MIN_REPORTS` set to 1 made this read
  //   FAIL  D13 a researcher that refuses or fails simply counts as not back ...
  check('D13 a researcher that refuses or fails simply counts as not back and is never switched to another model: with two reports the desk still decides, and with fewer than two the run stops with his sentence, no desk turn is bought, nothing is filed and the old board stays',
    refuse.out.ok === true && refuse.w.bodies.filter((b) => !b.tools).length === 1
    && refuse.w.bodies.every((b) => b.model === 'claude-fable-5-1')
    && refuse.docs.get(DR.RESEARCH_PATH).data.r3.status === 'refused'
    && /These beats did not report this run: Macro and sectors, Swing structure, Options, volatility and risk\./.test(refuse.w.bodies.find((b) => !b.tools).messages[0].content[0].text)
    && thin.out.ok === false && thin.out.why === TD.SAY.runThin && thin.w.bodies.filter((b) => !b.tools).length === 0
    && thinRecs.length === 0 && thin.docs.get(`${TD.PLAYS}/old_open`).data.status === 'open' && runOf(thin.docs).status === 'error',
    JSON.stringify({ refuse: refuse.out, thin: thin.out }));
}
{
  const r = await oneRun({ researchOnly: true });
  const both = await oneRun({ settings: { finnhubKey: 'KEY123456789' }, deps: { marketSnapshot: async (k, tickers) => ({ at: 'T', quotes: tickers.map((t) => ({ ticker: t, last: 500, chgPct: 0.5, open: 499, high: 501, low: 498, prevClose: 497 })), news: [], earnings: [], missing: [] }) } });
  const deskMsg = both.w.bodies.find((b) => !b.tools)?.messages[0].content[0].text || '';
  // NEGATIVE CONTROL (run 2026-09-23): the handoff's `return { ok: true, handedOff: true, ... }` removed made this read
  //   FAIL  D14 a long research phase hands the decision to the next firing ...
  // RE-PINNED 2026-09-23 (v7.2, fifty calls): every run hands over now, not only a long one, so the desk's
  // decision always starts with its own fifty calls; and the market the researchers saw is kept with their
  // reports, so the desk reads the same tape without fetching it again.
  // NEGATIVE CONTROL (run 2026-09-23, v7.2): the desk firing's market put back to `const market = 'No market data was saved with this run.';` made this read
  //   FAIL  D14 every research firing hands the decision to the next firing ...
  check('D14 every research firing hands the decision to the next firing: the run is left at decide with every report stored, no desk turn is bought, nothing is filed and nothing is pushed; the market the researchers saw is stored with them and is what the desk reads, fetched once',
    r.out.handedOff === true && runOf(r.docs).status === 'decide' && r.w.bodies.filter((b) => !b.tools).length === 0
    && ['r1', 'r2', 'r3', 'r4', 'r5'].every((k) => r.docs.get(DR.RESEARCH_PATH).data[k]?.status === 'ok')
    && r.w.pushes.length === 0 && r.w.diag.some((e) => e.ev === 'desk-run-handoff')
    && both.out.ok === true && /SPY 500/.test(both.docs.get(DR.RESEARCH_PATH).data.market) && /SPY 500 \(\+0\.5% on the day/.test(deskMsg),
    JSON.stringify({ r: r.out, both: both.out }));
}
{
  const research = { runId: 'run_x', r1: { status: 'ok', text: REPORT(1) }, r2: { status: 'ok', text: REPORT(2) }, r3: { status: 'failed', err: 'ran past its time' }, r4: null, r5: null };
  const resumedEnough = await oneRun({ research, run: { attempt: 2 } });
  const resumedShort = await oneRun({ research: { runId: 'run_x', r1: { status: 'ok', text: REPORT(1) }, r2: null, r3: null, r4: null, r5: null }, run: { attempt: 2 } });
  const otherRun = await oneRun({ research: { runId: 'someone_else', r1: { status: 'ok', text: 'STALE REPORT' }, r2: null, r3: null, r4: null, r5: null } });
  // NEGATIVE CONTROL (run 2026-09-23): the `prior` runId comparison (`rdoc.data?.runId === run.id`) dropped made this read
  //   FAIL  D15 a run killed partway resumes from what landed ...
  // RE-RUN 2026-09-23 (v7.2, `prior` is a let now): `let prior = rdoc ? rdoc.data : null;` made this read
  //   FAIL  D15 a run killed partway resumes from what landed ...
  check('D15 a run killed partway resumes from what landed: a resumed run that already holds two reports goes straight to the desk without buying the rest again, one that holds fewer re-runs only the missing beats, and reports from a different run are never reused',
    resumedEnough.w.bodies.filter((b) => b.tools).length === 0 && resumedEnough.w.bodies.filter((b) => !b.tools).length === 1 && resumedEnough.out.ok
    && resumedShort.w.bodies.filter((b) => b.tools).length === 4 && resumedShort.out.ok
    && otherRun.w.bodies.filter((b) => b.tools).length === 5 && !JSON.stringify(otherRun.w.bodies).includes('STALE REPORT'),
    JSON.stringify({ enough: resumedEnough.w.bodies.length, short: resumedShort.w.bodies.length, other: otherRun.w.bodies.length }));
}
{
  let deskCalls = 0;
  const fallback = await oneRun({ turns: { desk: (body) => { deskCalls++; if (body.output_config.format) return Object.assign(new Error('output_config.format is not supported'), { status: 400 }); return { text: `Here you go: ${JSON.stringify(DESK_OUT())}` }; } } });
  const plain400 = await oneRun({ turns: { desk: () => Object.assign(new Error('messages: bad'), { status: 400 }) } });
  // NEGATIVE CONTROL (run 2026-09-23): the retry's `/output_config|format|schema/` test changed to `/never/` made this read
  //   FAIL  D16 an account that cannot use structured output ...
  check('D16 an account that cannot use structured output still gets its trades: the same desk turn is sent once more without the schema and with a plain JSON instruction, and read; any other refusal is not retried and closes the run with the reason',
    fallback.out.ok && deskCalls === 2 && fallback.w.bodies.filter((b) => !b.tools)[1].output_config.format === undefined
    && /Return only one JSON object/.test(fallback.w.bodies.filter((b) => !b.tools)[1].system[0].text)
    && plain400.out.ok === false && plain400.w.bodies.filter((b) => !b.tools).length === 1 && /The desk could not decide: the request was refused/.test(runOf(plain400.docs).error),
    JSON.stringify({ fb: fallback.out, deskCalls, p: plain400.out }));
}
{
  const r = await oneRun({ turns: { desk: () => ({ text: 'I think NVDA looks good today.' }) } });
  const none = await oneRun({ turns: { desk: () => ({ text: JSON.stringify(DESK_OUT({ trades: [], none: 'Nothing clean on the tape.' })) }) }, state: { run: { ...RUN, trigger: 'morning' } }, run: { trigger: 'morning' } });
  // NEGATIVE CONTROL (run 2026-09-23): the `if (!decided.json)` guard removed made this read
  //   FAIL  D17 a desk answer the app cannot read changes nothing ...
  check('D17 a desk answer the app cannot read changes nothing on his screen and says so; a desk that finds nothing worth taking is a real answer: the board empties, the reason is kept, and the 7:00 run still pushes that there is nothing yet',
    r.out.ok === false && runOf(r.docs).status === 'error' && /could not read/.test(runOf(r.docs).error)
    && r.docs.get(`${TD.PLAYS}/old_open`).data.status === 'open' && ![...r.docs.keys()].some((p) => p.startsWith(`${TD.PLAYS}/rec_`))
    && none.out.ok && none.docs.get(TD.STATE_PATH).data.desk.none === 'Nothing clean on the tape.' && none.docs.get(`${TD.PLAYS}/old_open`).data.status === 'expired'
    && none.w.pushes.length === 1 && /7:00 desk: nothing worth taking yet\./.test(none.w.pushes[0].body),
    JSON.stringify({ r: r.out, pushes: none.w.pushes }));
}

// ---- D18 to D19: the 7:00 run and the prompts ------------------------------------------
{
  const seven = Date.UTC(2026, 8, 23, 13, 5); // 07:05 MT Wednesday
  const W = world();
  const M = load(W.deps);
  const a = await M.maybeMorningRun(env, { now: seven });
  const b = await M.maybeMorningRun(env, { now: seven + 60_000 });
  const early = await load(world().deps).maybeMorningRun(env, { now: Date.UTC(2026, 8, 23, 12, 59) });
  const late = await load(world().deps).maybeMorningRun(env, { now: Date.UTC(2026, 8, 23, 13, 30) });
  const sat = await load(world().deps).maybeMorningRun(env, { now: Date.UTC(2026, 8, 26, 13, 5) });
  const noDesk = await load(world({ settings: {} }).deps).maybeMorningRun(env, { now: seven });
  // NEGATIVE CONTROL (run 2026-09-23): the `morningDay === dateKey` check removed made this read
  //   FAIL  D18 the 7:00 run is the only automatic one ...
  check('D18 the 7:00 run is the only automatic one (Eric: "That remains the ONLY automatic scheduled run."): between 7:00 and 7:29 Mountain on a trading day with a desk open it queues exactly one morning run under a claim, and not at 6:59, not at 7:30, not on a Saturday, not twice and not without a desk',
    a.ran === true && runOf(W.docs).trigger === 'morning' && b.ran === false && b.why === 'already ran'
    && early.ran === false && late.ran === false && sat.ran === false && noDesk.ran === false,
    JSON.stringify({ a, b, early, late, sat, noDesk }));
}
{
  const rs = DR.researchSystem('cash');
  const rm = DR.researchSystem('margin');
  const ds = DR.deskSystem('cash', 3);
  const allStrict = (s) => (s.type !== 'object' || (s.additionalProperties === false && Object.keys(s.properties).every((k) => s.required.includes(k)) && Object.values(s.properties).every(allStrict)))
    && (s.type !== 'array' || allStrict(s.items)) && (!s.anyOf || s.anyOf.every(allStrict));
  // NEGATIVE CONTROL (run 2026-09-23): `DEFAULT_RISK_PCT` set to 1 made this read
  //   FAIL  D19 the six turns are told what he asked for ...
  check('D19 the six turns are told what he asked for: every one on Fable 5.1, the researchers told his account can or cannot short and never to size or invent a price, the desk told his 3% risk rule, the six-trade and two-per-kind limits and the phone-card lengths; the schema is strict on every object so the structured output can be enforced; five distinct beats; no dash in any prompt; and a missing risk setting reads as 3%',
    DR.DESK_MODEL === 'claude-fable-5-1' && DR.RESEARCH_EFFORT === 'medium' && DR.DESK_EFFORT === 'high'
    && /cannot short stock/.test(rs) && /short stock is allowed/.test(rm) && /Never invent a price/.test(rs) && /Do not size positions/.test(rs) && /never ask a question/i.test(rs)
    && /no more than 3% of the account/.test(ds) && /At most 6 trades and at most 2 of each kind/.test(ds) && /under 25 words/.test(ds)
    && allStrict(DR.DESK_SCHEMA) && DR.LENSES.length === 5 && new Set(DR.LENSES.map((L) => L.key)).size === 5
    && !DASH.test(rs + rm + ds + DR.LENSES.map((L) => L.beat).join(' '))
    && DR.riskPctOf({}) === 3 && DR.riskPctOf({ riskPct: 2 }) === 2 && DR.riskPctOf({ riskPct: 40 }) === 3
    && DR.WEB_SEARCH.type === 'web_search_20260209' && DR.THINKING.display === 'summarized');
}

// ---- D20: how much, at his 3% ---------------------------------------------------------
{
  const acct = 245000;
  const rules = { riskPct: 3 };
  const a = TM.recSizing({ rec: { instrument: 'stock', side: 'long', entryLow: 247.5, entryHigh: 248, stop: 245.8, targets: [251, 253.5], allocPct: 40 }, accountCents: acct, rules });
  const b = TM.recSizing({ rec: { instrument: 'stock', side: 'long', entry: 50, stop: 45, targets: [60], allocPct: 50 }, accountCents: acct, rules });
  const c = TM.recSizing({ rec: { instrument: 'stock', side: 'short', entry: 100, stop: 102, targets: [96], allocPct: 10 }, accountCents: acct, rules });
  const d = TM.recSizing({ rec: { instrument: 'call', side: 'long', entry: 3.2, stop: 1.6, targets: [5], allocPct: 20 }, accountCents: acct, rules });
  const e = TM.recSizing({ rec: { instrument: 'put', side: 'long', entry: 0.4, stop: 0.2, targets: [0.8], allocPct: 20 }, accountCents: 1000000, rules });
  const none = TM.recSizing({ rec: { instrument: 'stock', entry: 10, stop: 9, allocPct: 10 }, accountCents: 0, rules });
  // NEGATIVE CONTROL (run 2026-09-23): `out.capped = byRule < byAlloc; qty = ...` computed from byAlloc alone
  //   (`let qty = byAlloc;`) made this read    FAIL  D20 how much, at his 3% ...
  check('D20 how much, at his 3%: the idea\'s share of the account in dollars and fractional shares when that is the smaller, the rule\'s size when the stop is wide so a stopped-out trade costs exactly 3%, a short counted downward, whole contracts, one contract over the rule sized to zero and said, and no balance sizes nothing',
    // RE-PINNED 2026-09-23 (review): sized from the worst fill in the zone, the top of it for a buy, so a fill
    // anywhere in the zone stays inside his rule. The rest are single prices and do not move.
    a.entry === 248 && a.shares === 3.9516 && !a.capped && a.riskCents === Math.round(3.9516 * 220) && a.rewardCents === Math.round(300 * 3.9516) && a.reward2Cents === Math.round(550 * 3.9516)
    && b.capped && b.shares === 14.7 && b.riskCents === 7350 && b.riskCents === Math.round(acct * 0.03) && b.rr === 2
    && c.shares === 2.45 && c.riskCents === 490 && c.rewardCents === 980
    && d.contracts === 0 && d.overRule && d.budgetCents === 7350
    && e.contracts === 15 && e.riskCents === 30000 && e.rr === 2
    && none.qty === null,
    JSON.stringify({ a, b, d, e }));
}

// ---- D21 to D23: what the review found (2026-09-23) ----------------------------------------
// Three reviewers read the engine against the fake database and reproduced these. Each is held here.
{
  at(WED_10);
  // A research document that cannot be read is not an empty one.
  const A = world({ state: { run: RUN }, research: { runId: 'run_x', r1: { status: 'ok', text: REPORT(1) }, r2: { status: 'ok', text: REPORT(2) } } });
  const realGet = A.deps.tryGet;
  A.deps.tryGet = async (e, path) => (path === DR.RESEARCH_PATH ? A.deps.READ_FAILED : realGet(e, path));
  const outA = await load(A.deps).executeRun(env, RUN, { deadlineAt: WED_10 + 12.5 * 60_000, deps: { liveTurn: turns({}, A.w) } });
  // A run he replaced mid-flight: the old attempt stops writing and files nothing.
  const B = world({ state: { run: RUN, desk: { runId: 'prev', ids: ['old_open'] } }, plays: { old_open: { ticker: 'AMD', status: 'open' } } });
  const sup = turns({ research: (n) => { if (n === 1) B.put(TD.STATE_PATH, { run: { id: 'run_new', status: 'queued', queuedAt: new Date(WED_10), attempt: 0 }, desk: { runId: 'prev', ids: ['old_open'] } }); return { text: REPORT(n) }; } }, B.w);
  const outB = await load(B.deps).executeRun(env, RUN, { deadlineAt: WED_10 + 12.5 * 60_000, deps: { liveTurn: sup } });
  restore();
  // An answer in the wrong shape never clears his board.
  const C = await oneRun({ turns: { desk: () => ({ text: '[{"ticker":"NVDA","side":"long"}]' }) } });
  // NEGATIVE CONTROL (run 2026-09-23): executeRun's READ_FAILED guard on the research read removed made this read
  //   FAIL  D21 a run never destroys what it cannot see ...
  // NEGATIVE CONTROL (run 2026-09-23): mine()'s ownership test loosened to `if (r) return d;` made this read
  //   FAIL  D21 a run never destroys what it cannot see ...
  // NEGATIVE CONTROL (run 2026-09-23): the answer's shape test put back to `if (!decided.json) {` made this read
  //   FAIL  D21 a run never destroys what it cannot see ...
  check('D21 a run never destroys what it cannot see: a research document it cannot read is left exactly as it was and the run goes back to be claimed, with nothing bought; a run he replaced while it worked stops writing, files nothing and leaves his new run in the slot; and an answer that is not an object with a trades list is refused and leaves his board as it was',
    outA.retry === true && A.w.bodies.length === 0 && A.docs.get(DR.RESEARCH_PATH).data.r1?.status === 'ok' && runOf(A.docs).status === 'queued'
    && !A.w.patches.some((p) => p.path === DR.RESEARCH_PATH)
    && outB.why === 'superseded' && runOf(B.docs).id === 'run_new' && runOf(B.docs).status === 'queued'
    && ![...B.docs.keys()].some((k) => k.startsWith(`${TD.PLAYS}/rec_`)) && B.docs.get(`${TD.PLAYS}/old_open`).data.status === 'open'
    && B.w.bodies.filter((b) => !b.tools).length === 0 && B.w.pushes.length === 0
    && C.out.ok === false && /shape the app could not read/.test(C.out.why) && C.docs.get(`${TD.PLAYS}/old_open`).data.status === 'open'
    && C.docs.get(TD.STATE_PATH).data.desk.ids.join() === 'old_open,old_took',
    JSON.stringify({ a: outA, b: outB, c: C.out }));
}
{
  // The new board is saved before the old one gives way.
  at(WED_10);
  const F = world({
    state: { run: RUN, desk: { runId: 'prev', ids: ['old_open'] } },
    settings: { caseId: 'c1', accountType: 'cash', finnhubKey: '' },
    plays: { old_open: { ticker: 'AMD', status: 'open' } },
  });
  const realPatch = F.deps.patchDoc;
  F.deps.patchDoc = async (e, path, data, opts = {}) => {
    if (path === TD.STATE_PATH && (opts.mask || []).includes('desk')) throw new Error('write failed');
    return realPatch(e, path, data, opts);
  };
  const outF = (await firings(load(F.deps), F, RUN, { liveTurn: turns({}, F.w) })).out;
  restore();
  const lateScalp = DR.recExpiry('scalp', { now: Date.UTC(2026, 8, 23, 19, 50) });
  const earlyScalp = DR.recExpiry('scalp', { now: Date.UTC(2026, 8, 23, 16, 0) });
  const shortCall = DR.recExpiry('swing', { holdDays: 3, now: Date.UTC(2026, 8, 21, 16, 0), contractExpiry: '2026-09-21' });
  const longCall = DR.recExpiry('swing', { holdDays: 3, now: Date.UTC(2026, 8, 21, 16, 0), contractExpiry: '2026-10-16' });
  // NEGATIVE CONTROL (run 2026-09-23): `await retireRecs(env, doc0?.data?.desk?.ids || [], []);` inserted before fileRecs made this read
  //   FAIL  D22 the board can never be left empty ...
  // RE-RUN 2026-09-23 (v7.2, the previous ids come from the ownership read): `await retireRecs(env, previous, [], { getMany, writeMany });`
  //   inserted before fileRecs made this read    FAIL  D22 the board can never be left empty ...
  // NEGATIVE CONTROL (run 2026-09-23): recExpiry's contract cap (`if (realDate(contractExpiry)) at = ...`) removed made this read
  //   FAIL  D22 the board can never be left empty ...
  check('D22 the board can never be left empty and an idea never outlives its market: when the new board cannot be saved, the last run\'s idea is still open and the state still points at it; a scalp filed near the close expires at the close and one filed mid morning thirty minutes on; and an option expires with its contract when that comes first',
    outF.ok === false && F.docs.get(`${TD.PLAYS}/old_open`).data.status === 'open' && F.docs.get(TD.STATE_PATH).data.desk.ids.join() === 'old_open'
    && lateScalp.getTime() === Date.UTC(2026, 8, 23, 20, 0) && earlyScalp.getTime() === Date.UTC(2026, 8, 23, 16, 30)
    && shortCall.getTime() === Date.UTC(2026, 8, 21, 20, 0) && longCall.getTime() === Date.UTC(2026, 8, 24, 20, 0),
    JSON.stringify({ f: outF, late: lateScalp.toISOString(), short: shortCall.toISOString(), long: longCall.toISOString() }));
}
{
  // The 7:00 run: the clock first, then one write that stamps the day and queues the run together.
  const reads = [];
  const mk = (over) => { const X = world(over); const g = X.deps.tryGet; X.deps.tryGet = async (e, p) => { reads.push(p); return g(e, p); }; return X; };
  const before = mk({});
  const beforeOut = await load(before.deps).maybeMorningRun(env, { now: Date.UTC(2026, 8, 23, 12, 30) });
  const readsBefore = reads.length;
  const fresh = mk({ state: { run: { id: 'old', status: 'idle' } } });
  const freshOut = await load(fresh.deps).maybeMorningRun(env, { now: Date.UTC(2026, 8, 23, 13, 5) });
  const stamp = fresh.w.patches.find((p) => p.path === TD.STATE_PATH);
  const busy = mk({ state: { run: { id: 'mine', status: 'researching', startedAt: new Date(Date.UTC(2026, 8, 23, 13, 0)), heartbeatAt: new Date(Date.UTC(2026, 8, 23, 13, 4, 30)), attempt: 1 } } });
  const busyOut = await load(busy.deps).maybeMorningRun(env, { now: Date.UTC(2026, 8, 23, 13, 5) });
  // RE-PINNED 2026-09-23 (v7.2): every research firing hands over, the last attempt too, and the desk's
  // claim of research handed over is never given up for attempts: the handoff is not a death.
  const lastTry = await oneRun({ researchOnly: true, run: { attempt: 3 } });
  const lastDesk = world({ state: { run: { id: 'r9', status: 'decide', queuedAt: new Date(WED_10 - 5 * 60_000), startedAt: new Date(WED_10 - 4 * 60_000), attempt: 3 } },
    research: { runId: 'r9', r1: { status: 'ok', text: REPORT(1) }, r2: { status: 'ok', text: REPORT(2) } } });
  at(WED_10);
  const lastDeskOut = await load(lastDesk.deps).maybeRunDesk(env, { deadlineAt: WED_10 + 12 * 60_000, now: WED_10, deps: { liveTurn: turns({}, lastDesk.w) } });
  restore();
  // NEGATIVE CONTROL (run 2026-09-23): maybeMorningRun's `if (runAlive(doc?.data?.run, now)) return { ran: false, why: 'a run is going' };` removed made this read
  //   FAIL  D23 the 7:00 run reads nothing before seven ...
  // NEGATIVE CONTROL (run 2026-09-23): the handoff's `&& (Number(run.attempt) || 1) < MAX_ATTEMPTS` removed made this read
  //   FAIL  D23 the 7:00 run reads nothing before seven ...
  // NEGATIVE CONTROL (run 2026-09-23, v7.2): the give-up's `(!ready && ...)` changed to `(... >= MAX_ATTEMPTS)` without the ready guard made this read
  //   FAIL  D23 the 7:00 run reads nothing before seven ...
  check('D23 the 7:00 run reads nothing before seven, stamps the day and queues the run in one write so the stamp can never stand without its run, waits rather than spending the day on a run of his still going, and a run on its last attempt still hands its research over and has its decision made, never given up for it',
    beforeOut.why === 'not the hour' && readsBefore === 0
    && freshOut.ran === true && stamp && stamp.opts.mask.join() === 'morningDay,morningAt,run' && stamp.data.run.trigger === 'morning'
    && runOf(fresh.docs).status === 'queued' && fresh.docs.get(TD.STATE_PATH).data.morningDay === '2026-09-23'
    && fresh.w.patches.filter((p) => p.path === TD.STATE_PATH).length === 1
    && busyOut.ran === false && busyOut.why === 'a run is going' && !busy.docs.get(TD.STATE_PATH).data.morningDay
    && lastTry.out.ok === true && lastTry.out.handedOff === true && runOf(lastTry.docs).status === 'decide'
    && lastDeskOut === true && runOf(lastDesk.docs).status === 'idle' && lastDesk.w.bodies.filter((b) => !b.tools).length === 1,
    JSON.stringify({ before: beforeOut, fresh: freshOut, busy: busyOut, last: lastTry.out }));
}

// ---- D24 to D26: the fifty calls, and a run that cannot run (2026-09-23) -----------------------
// Measured in production the day after PR 420 shipped: one invocation gets fifty outside calls, then
// every further one throws. The 7:00 run spent them partway through research, could not even save its
// error, and died three times without a word, on a day the account was also out of credit.
const SIX = [
  TRADE({ ticker: 'NVDA', horizon: 'scalp', holdMinutes: 8 }), TRADE({ ticker: 'AMD', horizon: 'scalp', holdMinutes: 8 }),
  TRADE({ ticker: 'TSLA' }), TRADE({ ticker: 'META' }),
  TRADE({ ticker: 'XLE', horizon: 'swing', holdMinutes: null, holdDays: 2 }), TRADE({ ticker: 'XLF', horizon: 'swing', holdMinutes: null, holdDays: 2 }),
];
const snapCounted = (W) => async (k, tickers) => { W.w.calls += tickers.length + 2; return { at: 'T', quotes: tickers.map((t) => ({ ticker: t, last: 500, chgPct: 0.1, open: 1, high: 1, low: 1, prevClose: 1 })), news: [], earnings: [], missing: [] }; };
const quoteCounted = (W) => async (k, t) => { W.w.calls += 1; return { ticker: t, last: 248.2 }; };
// What a desk firing spends before the run's own first call: the firing's look, the claim, the cron's
// heartbeat, the 7:00 check's two reads inside its half hour, and one database token. Six more are kept
// spare for a read the database refuses once and is retried.
const OUTSIDE = 6;
const SPARE = 6;
{
  const creditErr = () => Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the API."}}'), { status: 400 });
  // RE-PINNED 2026-09-24 (v7.10): the worst case now holds twelve taken trades, the most a run re-checks:
  // the research firing reads his list and the trades (two calls), and the desk firing writes the re-check
  // (one batch) beside the read of what he holds it already made.
  const HELD = Object.fromEntries(Array.from({ length: DR.LIVE_MAX }, (_, i) => [`h${i}`, { ticker: `H${String.fromCharCode(65 + i)}`, side: 'long', instrument: 'stock', horizon: 'swing', status: 'took', agreement: 3, entryLow: 10, entryHigh: 11, stop: 9, targets: [13] }]));
  const heldIds = Object.keys(HELD);
  // The research firing at its worst: a fresh run, a market key, all five back, every retry and continuation counted.
  at(WED_10);
  const R = world({ state: { run: { ...RUN, trigger: 'morning' }, desk: { runId: 'prev', ids: [] }, activeIds: heldIds }, settings: { caseId: 'c1', accountType: 'cash', finnhubKey: 'KEY123456789' }, plays: HELD });
  const rOut = await load(R.deps).executeRun(env, { ...RUN, trigger: 'morning' }, { deadlineAt: WED_10 + 12.5 * 60_000, deps: { liveTurn: turns({}, R.w), marketSnapshot: snapCounted(R) } });
  // The research firing that fails: every researcher refused, the error saved, the 7:00 push sent.
  const X = world({ state: { run: { ...RUN, trigger: 'morning' }, activeIds: heldIds }, settings: { caseId: 'c1', accountType: 'cash', finnhubKey: 'KEY123456789' }, plays: HELD });
  const xOut = await load(X.deps).executeRun(env, { ...RUN, trigger: 'morning' }, { deadlineAt: WED_10 + 12.5 * 60_000, deps: { liveTurn: turns({ research: creditErr }, X.w), marketSnapshot: snapCounted(X) } });
  // The desk firing at its worst: six stock trades each priced, six ideas from the last run to retire, the 7:00 push.
  const prevIds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
  const deskRun = { ...RUN, trigger: 'morning', phase: 'desk', status: 'deciding' };
  // Every held trade re-checked and every one changed: half now backed by one, half dropped by all five.
  const verdicts = `\n## Earlier calls\n${heldIds.map((id, i) => `E${i + 1}: ${i % 2 ? 'does not back' : 'backs'}`).join('\n')}`;
  const D = world({
    state: { run: deskRun, desk: { runId: 'prev', ids: prevIds }, activeIds: heldIds },
    settings: { caseId: 'c1', accountType: 'cash', finnhubKey: 'KEY123456789' },
    research: { runId: 'run_x', market: 'SPY 500', live: heldIds.map((id, i) => ({ ref: `E${i + 1}`, id })), r1: { status: 'ok', text: REPORT(1) + verdicts }, r2: { status: 'ok', text: REPORT(2) + verdicts }, r3: { status: 'ok', text: REPORT(3) + verdicts }, r4: { status: 'ok', text: REPORT(4) + verdicts }, r5: { status: 'ok', text: REPORT(5) + verdicts } },
    plays: { ...HELD, ...Object.fromEntries(prevIds.map((id) => [id, { ticker: 'OLD', status: 'open', runId: 'prev' }])) },
  });
  const dOut = await load(D.deps).executeRun(env, deskRun, { deadlineAt: WED_10 + 12.5 * 60_000, deps: { liveTurn: turns({ desk: () => ({ text: JSON.stringify(DESK_OUT({ trades: SIX })) }) }, D.w), quoteCached: quoteCounted(D) } });
  restore();
  const room = DR.CALL_CAP - OUTSIDE - SPARE;
  const recs = [...D.docs.keys()].filter((k) => k.startsWith(`${TD.PLAYS}/rec_`));
  // NEGATIVE CONTROL (run 2026-09-23): MARKET_TICKERS put back to the index and the eleven sector funds made this read
  //   FAIL  D24 every firing fits inside the fifty calls ...
  // NEGATIVE CONTROL (run 2026-09-23): fileRecs put back to one patchDoc per idea made this read
  //   FAIL  D24 every firing fits inside the fifty calls ...
  // NEGATIVE CONTROL (run 2026-09-23): the researchers' `maxRetries: 0` changed to `maxRetries: 2` made this read
  //   FAIL  D24 every firing fits inside the fifty calls ...
  // NEGATIVE CONTROL (run 2026-09-23): the research firing deciding in place (the handoff's `return { ok: true, handedOff: true, ... }` removed) made this read
  //   FAIL  D24 every firing fits inside the fifty calls ...
  // NEGATIVE CONTROL (run 2026-09-24, v7.10): the re-check written one batch per trade (`for (const x of rechecks) ... writeMany(env, [x.write])`) made this read
  //   FAIL  D24 every firing fits inside the fifty calls ...
  check(`D24 every firing fits inside the fifty calls an invocation gets, counted at its worst with ${OUTSIDE} spent before the run and ${SPARE} kept spare: the research firing with a market key, twelve trades he holds to show and all five back, the research firing whose five are all refused and whose 7:00 push goes out, and the desk firing that prices six trades, files them in one write, re-checks twelve he holds in one read and one write, retires six old ideas in one read and one write, and pushes`,
    rOut.handedOff === true && R.w.calls <= room && R.w.batches.filter((b) => b.get).length === 1
    && xOut.ok === false && X.w.pushes.length === 1 && X.w.calls <= room
    && dOut.ok === true && recs.length === 6 && D.w.calls <= room
    && D.w.batches.filter((b) => b.write).length === 3 && D.w.batches.filter((b) => b.get).length === 2
    // RE-PINNED 2026-09-24 (v7.12): nothing leaves his list; the ones all five are against are SELL.
    && heldIds.every((id, i) => D.docs.get(`${TD.PLAYS}/${id}`).data.status === 'took' && D.docs.get(`${TD.PLAYS}/${id}`).data.verdict?.call === (i % 2 ? 'sell' : 'hold'))
    && prevIds.every((id) => D.docs.get(`${TD.PLAYS}/${id}`).data.status === 'expired'),
    JSON.stringify({ room, research: R.w.calls, failed: X.w.calls, desk: D.w.calls, recs: recs.length, d: dOut }));
}
{
  const creditErr = () => Object.assign(new Error('400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the API."}}'), { status: 400 });
  const morning = { run: { trigger: 'morning' }, state: { run: { ...RUN, trigger: 'morning' } } };
  const dry = await oneRun({ ...morning, turns: { research: creditErr } });
  const dryManual = await oneRun({ turns: { research: creditErr } });
  const mixed = await oneRun({ ...morning, turns: { research: (n) => (n <= 3 ? creditErr() : Object.assign(new Error('Overloaded'), { status: 529 })) } });
  const key = await oneRun({ turns: { research: () => Object.assign(new Error('invalid x-api-key'), { status: 401 }) } });
  const deskDry = await oneRun({ ...morning, turns: { desk: creditErr } });
  const endOf = (r) => r.w.diag.filter((e) => e.ev === 'desk-run-end').pop();
  // NEGATIVE CONTROL (run 2026-09-23): fatalOf's credit test changed to `/credit card/i` made this read
  //   FAIL  D25 a run that cannot run says why ...
  // NEGATIVE CONTROL (run 2026-09-23): the research failure's `agents.every((x) => x.fa && x.fa === agents[0].fa)` loosened to `agents.some((x) => x.fa)` made this read
  //   FAIL  D25 a run that cannot run says why ...
  check('D25 a run that cannot run says why, at once: when every researcher is refused because the account is out of credit, the run ends on its first attempt with the sentence that says so and where to add it, buys no desk turn and files nothing, the 7:00 run pushes that sentence and his own run does not; a key refused says that instead; a mix of reasons is only "fewer than two came back"; and the desk refused for credit says the same sentence',
    dry.out.ok === false && dry.out.why === TD.SAY.noCredit && runOf(dry.docs).status === 'error' && runOf(dry.docs).error === TD.SAY.noCredit
    && runOf(dry.docs).attempt === 1 && dry.w.bodies.filter((b) => !b.tools).length === 0 && ![...dry.docs.keys()].some((k) => k.startsWith(`${TD.PLAYS}/rec_`))
    && dry.w.pushes.length === 1 && dry.w.pushes[0].body === `The 7:00 run did not finish. ${TD.SAY.noCredit}` && dry.w.pushes[0].max === DR.PUSH_MAX
    && /credit/.test(endOf(dry)?.err || '')
    && dryManual.out.why === TD.SAY.noCredit && dryManual.w.pushes.length === 0
    && key.out.why === TD.SAY.keyRefused
    && mixed.out.why === TD.SAY.runThin && mixed.w.pushes.length === 1 && mixed.w.pushes[0].body === `The 7:00 run did not finish. ${TD.SAY.runThin}`
    && deskDry.out.why === TD.SAY.noCredit && runOf(deskDry.docs).error === TD.SAY.noCredit && deskDry.w.pushes.length === 1
    && /console\.anthropic\.com/.test(TD.SAY.noCredit) && !DASH.test(TD.SAY.noCredit + TD.SAY.keyRefused)
    && DR.fatalOf(creditErr()) === 'credit' && DR.fatalOf(Object.assign(new Error('messages: bad'), { status: 400 })) === null
    && DR.fatalOf({ status: 401 }) === 'key' && DR.fatalOf({ status: 529 }) === null && DR.fatalOf(null) === null,
    JSON.stringify({ dry: dry.out, manual: dryManual.w.pushes.length, key: key.out, mixed: mixed.out, desk: deskDry.out }));
}
{
  at(WED_10);
  const tired = (trigger, settings) => world({ state: { run: { id: 'r7', status: 'researching', trigger, startedAt: new Date(WED_10 - 30 * 60_000), claimedAt: new Date(WED_10 - 10 * 60_000), attempt: 3 } }, ...(settings ? { settings } : {}) });
  const am = tired('morning');
  const amOut = await load(am.deps).maybeRunDesk(env, { deadlineAt: WED_10 + 12 * 60_000, now: WED_10, deps: { liveTurn: turns({}, am.w) } });
  const mine = tired('manual');
  await load(mine.deps).maybeRunDesk(env, { deadlineAt: WED_10 + 12 * 60_000, now: WED_10, deps: { liveTurn: turns({}, mine.w) } });
  const quiet = tired('morning', { caseId: 'c1', pushOn: false });
  await load(quiet.deps).maybeRunDesk(env, { deadlineAt: WED_10 + 12 * 60_000, now: WED_10, deps: { liveTurn: turns({}, quiet.w) } });
  const peek = async (run) => { const P = world({ state: run ? { run } : null }); return load(P.deps).peekDesk(env, { now: WED_10 }); };
  const pQueued = await peek({ id: 'a', status: 'queued', queuedAt: new Date(WED_10 - 30_000) });
  const pFresh = await peek({ id: 'a', status: 'researching', claimedAt: new Date(WED_10 - 5 * 60_000) });
  const pStale = await peek({ id: 'a', status: 'researching', claimedAt: new Date(WED_10 - 7 * 60_000) });
  const pIdle = await peek({ id: 'a', status: 'idle' });
  const pNone = await peek(null);
  restore();
  // NEGATIVE CONTROL (run 2026-09-23): the give-up's `if (gave !== false) await pushFailure(...)` removed made this read
  //   FAIL  D26 the 7:00 run always reaches his phone ...
  // NEGATIVE CONTROL (run 2026-09-23): runAlive's `< STALE_MS` changed to `< RUN_GIVE_UP_MS` made this read
  //   FAIL  D26 the 7:00 run always reaches his phone ...
  check('D26 the 7:00 run always reaches his phone (Eric: "I didn\'t get a 7am mst run/push for 420 like I asked"): a morning run the cron has to give up pushes that it did not finish and why, his own run given up does not push, and his push switch off is obeyed; and the firing\'s first look answers the state only when there is desk work: a queued run or one whose claim is older than any firing takes, never a run claimed five minutes ago, an idle desk or no desk',
    amOut === true && runOf(am.docs).status === 'error' && am.w.pushes.length === 1 && am.w.pushes[0].body === `The 7:00 run did not finish. ${TD.SAY.runStalled}`
    && mine.w.pushes.length === 0 && runOf(mine.docs).status === 'error' && quiet.w.pushes.length === 0
    && pQueued?.data?.run?.id === 'a' && pFresh === null && pStale?.data?.run?.id === 'a' && pIdle === null && pNone === null
    && DR.STALE_MS === 6 * 60_000 && DR.RESEARCH_BUDGET_MS < DR.STALE_MS - 60_000 && DR.DESK_BUDGET_MS < DR.STALE_MS - 60_000,
    JSON.stringify({ am: am.w.pushes, mine: mine.w.pushes.length, quiet: quiet.w.pushes.length, pFresh: !!pFresh }));
}

// ---- D27: his bar (2026-09-23, v7.4) ------------------------------------------------------------
// Eric: "It should suggest anything over a 50% profit for a scalp, intraday, swing, for stocks and
// options. So three possible trades if they're there." The first real run filed one trade: the desk had
// been told none beats a weak one. Now every trade over his bar reaches him, and nothing under it.
{
  const s = { open: true, minsToOpen: 0 };
  const at51 = DR.validRec(TRADE({ chanceLow: 51, chanceHigh: 58 }), { session: s });
  const at50 = DR.validRec(TRADE({ chanceLow: 50, chanceHigh: 60 }), { session: s });
  const low = DR.validRec(TRADE({ chanceLow: 44, chanceHigh: 52 }), { session: s });
  const none = DR.validRec(TRADE({ chanceLow: null, chanceHigh: null }), { session: s });
  const three = DESK_OUT({ trades: [
    TRADE({ ticker: 'AMD', horizon: 'scalp', holdMinutes: 8, chanceLow: 55, chanceHigh: 62 }),
    TRADE({ ticker: 'META', chanceLow: 49, chanceHigh: 58 }),
    TRADE({ ticker: 'SOFI', instrument: 'call', strike: 17, expiry: '2026-10-16', entryLow: 0.8, entryHigh: 0.85, stop: 0.5, targets: [1.3], chanceLow: 53, chanceHigh: 60 }),
    TRADE({ ticker: 'XLE', horizon: 'swing', holdMinutes: null, holdDays: 2, entryLow: 90, entryHigh: 90.5, stop: 88, targets: [94], chanceLow: 57, chanceHigh: 63 }),
  ] });
  const r = await oneRun({ turns: { desk: () => ({ text: JSON.stringify(three) }) } });
  const filed = [...r.docs.entries()].filter(([k]) => k.startsWith(`${TD.PLAYS}/rec_`)).map(([, v]) => v.data);
  const ds = DR.deskSystem('cash', 3);
  const rs = DR.researchSystem('cash');
  // NEGATIVE CONTROL (run 2026-09-23): validRec's `if (!chanceOk || cLo <= CHANCE_FLOOR) return null;` removed made this read
  //   FAIL  D27 his bar ...
  // NEGATIVE CONTROL (run 2026-09-23): the desk's bar line put back to "Only include trades you would take yourself today. No trades is the right answer when nothing is worth it; he would rather see none than a weak one." made this read
  //   FAIL  D27 his bar ...
  check('D27 his bar (Eric: "anything over a 50% profit for a scalp, intraday, swing, for stocks and options"): a trade whose chance starts above 50% reaches him, stock or option, and one at 50, under it or with no chance given never does; a run that returns a scalp, two intraday trades and a swing files every one over the bar and drops the one under; the desk is told to give him the best of each kind that clears it and never to lift a number to clear it; the researchers are told to bring every candidate over it; and "none beats a weak one" is gone',
    at51?.profitLow === 51 && at50 === null && low === null && none === null && DR.CHANCE_FLOOR === 50
    && r.out.ok === true && filed.map((x) => x.ticker).sort().join() === 'AMD,SOFI,XLE' && filed.every((x) => x.profitLow > 50)
    && filed.find((x) => x.ticker === 'SOFI')?.instrument === 'call'
    && r.w.diag.find((e) => e.ev === 'desk-run-end')?.dropped === 1
    && /every trade whose honest chance of reaching the first target before the stop is above 50%, which means chanceLow of at least 51/.test(ds)
    && /best trade in each of the three kinds, scalp, intraday and swing, stock or option, whenever one clears that bar/.test(ds)
    && /never raise a number to clear it/.test(ds)
    && /Bring every candidate you honestly rate above 50%/.test(rs) && /stocks and options alike/.test(rs)
    && !/none than a weak one|Quality over count/.test(ds + rs) && !DASH.test(ds + rs),
    JSON.stringify({ at51: at51?.profitLow, at50, filed: filed.map((x) => `${x.ticker}:${x.profitLow}`) }));
}

// ---- D28: what reaches him, screened after the desk decides (2026-09-24, v7.6) -------------------------
// Eric: "The desk should only suggest new positions or increasing equity in a position ... If denied, it
// doesn't suggest that position to me again unless an additional agent agrees", and "Passing on a scalp
// does not mean pass on a swing." He holds a HELDX intraday long and passed on an AMD scalp at 2 of 5.
{
  const held = { activeIds: ['held1'], declined: { 'AMD:up:scalp': { agreement: 2, at: new Date(WED_10 - 86_400_000), recId: 'old1' } } };
  const plays = { held1: { ticker: 'HELDX', side: 'long', instrument: 'stock', horizon: 'intraday', status: 'took', runId: 'prev' } };
  const first = DESK_OUT({ trades: [
    TRADE({ ticker: 'HELDX', instrument: 'put', side: 'long', strike: 40, expiry: '2026-10-16', entryLow: 1.2, entryHigh: 1.3, stop: 0.8, targets: [2] }),
    TRADE({ ticker: 'HELDX', entryLow: 41, entryHigh: 41.5, stop: 40, targets: [43.5] }),
    TRADE({ ticker: 'HELDX', horizon: 'swing', holdMinutes: null, holdDays: 2, entryLow: 41, entryHigh: 41.5, stop: 39, targets: [45] }),
    TRADE({ ticker: 'AMD', horizon: 'scalp', holdMinutes: 8, agreement: 2, entryLow: 168, entryHigh: 168.4, stop: 167.2, targets: [170] }),
    TRADE({ ticker: 'AMD', horizon: 'swing', holdMinutes: null, holdDays: 2, agreement: 2, entryLow: 168, entryHigh: 168.4, stop: 162, targets: [178] }),
  ] });
  const second = DESK_OUT({ trades: [TRADE({ ticker: 'AMD', horizon: 'scalp', holdMinutes: 8, agreement: 3, entryLow: 168, entryHigh: 168.4, stop: 167.2, targets: [170] })] });
  const a = await oneRun({ state: held, plays, turns: { desk: () => ({ text: JSON.stringify(first) }) } });
  const b = await oneRun({ state: held, plays, turns: { desk: () => ({ text: JSON.stringify(second) }) } });
  const recs = (r) => [...r.docs.entries()].filter(([k]) => k.startsWith(`${TD.PLAYS}/rec_`)).map(([, v]) => v.data);
  const tag = (x) => `${x.ticker}/${x.horizon}/${x.instrument}${x.adds ? '+add' : ''}${x.reoffered ? `+back${x.reoffered.was}>${x.reoffered.now}` : ''}`;
  const filedA = recs(a).map(tag).sort().join(' ');
  const filedB = recs(b).map(tag).join(' ');
  const endA = a.w.diag.find((e) => e.ev === 'desk-run-end');
  const asked = JSON.stringify([...a.w.bodies, ...b.w.bodies]);
  // NEGATIVE CONTROL (run 2026-09-24): the desk firing's `checked.trades = screened.keep;` removed made this read
  //   FAIL  D28 what reaches him is screened after the desk decides ...
  // NEGATIVE CONTROL (run 2026-09-24): the held read emptied (`const held = [];` in place of the batch read's keys) made this read
  //   FAIL  D28 what reaches him is screened after the desk decides ...
  // RE-PINNED 2026-09-24 (v7.10, Eric: "If a new run disagrees with a strategy still on the table (0/5 agents
  // agree), then it is removed"): the researchers are shown the trade he holds, as the desk's own earlier
  // call to re-check (D30), and nowhere else; what he passed on still never reaches one.
  const outside = asked.replace(/E1: HELDX long intraday, the stock\./g, '');
  check('D28 what reaches him is screened after the desk decides: the same position as the HELDX long he holds files as an add, a put leaning against it in the same kind is dropped, a HELDX swing files as new; the AMD scalp he passed on at 2 stays off while an AMD swing files as new, and a later run where 3 agree files the scalp as back; the recorder counts what was held back; the trade he holds reaches an agent only as the earlier call to re-check, and what he passed on never does',
    a.out.ok === true && filedA === 'AMD/swing/stock HELDX/intraday/stock+add HELDX/swing/stock'
    && b.out.ok === true && filedB === 'AMD/scalp/stock+back2>3'
    && endA?.screened?.against === 1 && endA.screened.declined === 1 && endA.screened.twice === 0
    && /E1: HELDX long intraday, the stock\./.test(asked) && !/HELDX|declined|passed on|AMD:up/.test(outside),
    JSON.stringify({ filedA, filedB, screened: endA?.screened, leak: (outside.match(/HELDX|declined|passed on|AMD:up/) || [''])[0] }));
}

// ---- D29: the GLP-1 chain (2026-09-24, v7.9) ----------------------------------------------------
// Eric: "I want GLp-1 pipeline stocks added to the search. Including HIMs. But from production to
// development to distribution and sellers."
{
  const r = await oneRun();
  const research = r.w.bodies.filter((b) => b.tools).map((b) => b.messages[0].content[0].text);
  const desk = r.w.bodies.find((b) => !b.tools)?.messages[0].content[0].text || '';
  const note = DR.chainNote();
  const all = TM.GLP1_CHAIN.flatMap((g) => g.tickers);
  const group = (role) => TM.GLP1_CHAIN.find((g) => g.role === role)?.tickers || [];
  // NEGATIVE CONTROL (run 2026-09-24): the run's `market += ... chainNote()` line removed made this read
  //   FAIL  D29 the GLP-1 chain rides every run ...
  // NEGATIVE CONTROL (run 2026-09-24): HIMS taken out of the Sellers made this read
  //   FAIL  D29 the GLP-1 chain rides every run ...
  check('D29 the GLP-1 chain rides every run: all five researchers and the desk read it in the market note, from the makers through development, production and supply and distribution to the sellers, HIMS among the sellers; every name is a ticker the desk accepts and none is named twice; the names that were bought, dropped their program or went private are not in it; it is named, not priced, and it says a trade from it clears the same bar as any other',
    research.length === 5 && research.every((t) => t.includes(note)) && desk.includes(note)
    && TM.GLP1_CHAIN.map((g) => g.role).join('|') === 'Makers, selling now|In development|Production and supply|Distribution|Sellers'
    && group('Sellers').includes('HIMS') && group('Makers, selling now').join() === 'LLY,NVO'
    && ['VKTX', 'GPCR', 'KLRA'].every((t) => group('In development').includes(t)) && ['WST', 'STVN'].every((t) => group('Production and supply').includes(t))
    && group('Distribution').join() === 'MCK,COR,CAH'
    && all.length === new Set(all).size && all.every((t) => /^[A-Z][A-Z.]{0,5}$/.test(t))
    && !['MTSR', 'TERN', 'CTLT', 'ZEAL', 'RHHBY'].some((t) => all.includes(t))
    && /Sellers: HIMS, LFMD, WW, GDRX, CVS, COST\./.test(note) && /a trade from it clears the same bar as any other\.$/.test(note)
    && !/HIMS|VKTX|LLY/.test(DR.MARKET_TICKERS.join()) && !DASH.test(note),
    JSON.stringify({ research: research.filter((t) => t.includes(note)).length, desk: desk.includes(note), roles: TM.GLP1_CHAIN.map((g) => g.role) }));
}

// ---- D30: the re-check (2026-09-24, v7.10) --------------------------------------------------------
// Eric: "If a new run disagrees with a strategy still on the table (0/5 agents agree), then it is
// removed. If some agents still agree, update with the new number of agreeing agents." He holds BA
// (taken at 3 of 5, with his own size), F and XOM; a fourth id on his list is not a taken trade.
{
  const state = { activeIds: ['h1', 'h2', 'h3', 'h4'] };
  const plays = {
    h1: { ticker: 'BA', side: 'long', instrument: 'stock', horizon: 'swing', status: 'took', agreement: 3, entryLow: 200.5, entryHigh: 203, stop: 197.4, targets: [206, 209], setup: 'Base above 200.', invalidation: 'Close under 197.', at: new Date(WED_10 - 86_400_000), mine: { qty: 7, riskCents: 4321, amountCents: 142100 } },
    h2: { ticker: 'F', side: 'long', instrument: 'stock', horizon: 'intraday', status: 'took', agreement: 2, entryLow: 11, entryHigh: 11.2, stop: 10.8, targets: [11.8] },
    h3: { ticker: 'XOM', side: 'long', instrument: 'call', strike: 120, expiry: '2026-10-16', horizon: 'swing', status: 'took', agreement: 4, entryLow: 2.1, entryHigh: 2.3, stop: 1.5, targets: [3.4] },
    h4: { ticker: 'OLDX', side: 'long', instrument: 'stock', horizon: 'intraday', status: 'expired' },
  };
  // Researchers 1 and 2 back BA; all five plainly do not back F; four do not back XOM and one is silent on it.
  const verdict = (n) => `\n## Earlier calls\nE1: ${n <= 2 ? 'backs, still basing above 200' : 'does not back, momentum faded'}\nE2: does not back, lost the level\n${n === 5 ? '' : 'E3: does not back, the premium bled\n'}`;
  // RE-PINNED 2026-09-24 (v7.12, Eric: "it should scan that same trade and tell me if I should hold or if things
  // have changed and I need to sell", and a SELL stays up in red until he marks it): nothing leaves his list;
  // the desk calls BA a sell though two back it, calls F a hold though all five are against it (overruled:
  // all five against is a sell), and says nothing on XOM, where four of the five against decide it.
  const holdings = [{ ref: 'E1', call: 'sell', why: 'Momentum faded and it lost 200 on volume.' }, { ref: 'E2', call: 'hold', why: 'Fine.' }];
  const deskSays = () => ({ text: JSON.stringify(DESK_OUT({ holdings })) });
  const r = await oneRun({ state, plays, turns: { research: (n) => ({ text: REPORT(n) + verdict(n) }), desk: deskSays } });
  // A thin run: researcher 5 does not report, so four plain noes on F are not five.
  const thin = await oneRun({ state, plays, turns: { research: (n) => (n === 5 ? Object.assign(new Error('Overloaded'), { status: 529 }) : { text: REPORT(n) + verdict(n) }), desk: () => ({ text: JSON.stringify(DESK_OUT({ holdings: [] })) }) } });
  const research = r.w.bodies.filter((b) => b.tools).map((b) => b.messages[0].content[0].text);
  const asked = JSON.stringify(r.w.bodies);
  const doc = (W, id) => W.docs.get(`${TD.PLAYS}/${id}`).data;
  const st = r.docs.get(TD.STATE_PATH).data;
  const end = r.w.diag.find((e) => e.ev === 'desk-run-end');
  const writes = r.w.patches.filter((p) => /\/h[123]$/.test(p.path));
  // NEGATIVE CONTROL (run 2026-09-24): tallyEarlier's drop rule loosened to `against >= 1` made this read
  //   FAIL  D30 every run re-checks the trades he took ...
  // NEGATIVE CONTROL (run 2026-09-24, v7.13): callFor's all-five-sell rule removed (the desk's hold on F standing) made this read
  //   FAIL  D30 every run re-checks the trades he took ...
  // RE-PINNED 2026-09-24 (v7.14, Eric: "if all the agents report to the 6th agent shouldn't he have the final call?"):
  // that rule is gone at his word. The desk's hold on F stands though all five say sell, and 0 of 5 agree with it.
  // NEGATIVE CONTROL (run 2026-09-24, v7.14): the all-five-sell rule put back in callFor made this read
  //   FAIL  D30 every run re-checks the trades he took ...
  // NEGATIVE CONTROL (run 2026-09-24): the re-check's writes left unsent (`const recheckOk = [];`) made this read
  //   FAIL  D30 every run re-checks the trades he took ...
  // NEGATIVE CONTROL (run 2026-09-24): the research firing's `market += ... liveNote(liveRows)` line removed made this read
  //   FAIL  D30 every run re-checks the trades he took ...
  // RE-PINNED 2026-09-24 (v7.13, Eric: "When I'm told to hold, add, trim, or sell, I need to know what agents and
  // how many agree with that decision"): each researcher's own vote is kept by number, and how many agree is how
  // many voted the call he is shown. The 7.10 words (backs, does not back) still read as hold and sell.
  check('D30 every run re-checks the trades he took: the five researchers are shown each one as the desk filed it and nothing of his size, and asked for hold, add, trim or sell under their own heading; BA takes the desk\'s SELL with its reason, keeps each researcher\'s vote by number and reads 3 of 5, the three who said sell, keeping the 3 it was taken at; F, all five saying sell, takes the desk\'s HOLD, which is final, 0 of 5; XOM, one silent and four for sell, keeps the silent one as no word and is a SELL on the votes, 4 of 5; each write goes under the trade\'s own time; the board and the push lead with the sells and say how many; and in a thin run a tie calls nothing and leaves the count as it was',
    r.out.ok === true && research.length === 5
    && research.every((t) => /E1: BA long swing, the stock\. Entry 200\.5 to 203, stop 197\.4, targets 206 then 209\. Filed 2026-09-2\d\. Setup: Base above 200\. Out if: Close under 197\./.test(t)
      && /E2: F long intraday, the stock\./.test(t) && /E3: XOM long swing, the 120 call expiring 2026-10-16, prices are the premium\./.test(t) && !/OLDX|E4:/.test(t))
    && !/4321|142100|"qty"/.test(asked) && /## Earlier calls\nOne line for each earlier call the message lists, as E1: hold, E1: add, E1: trim or E1: sell/.test(r.w.bodies[0].system[0].text)
    && r.docs.get(DR.RESEARCH_PATH).data.live.map((x) => `${x.ref}=${x.id}`).join() === 'E1=h1,E2=h2,E3=h3'
    && doc(r, 'h1').status === 'took' && doc(r, 'h1').agreement === 3 && doc(r, 'h1').tookAgreement === 3
    && doc(r, 'h1').verdict?.call === 'sell' && doc(r, 'h1').verdict.why === 'Momentum faded and it lost 200 on volume.' && doc(r, 'h1').verdict.runId === 'run_x'
    && JSON.stringify(doc(r, 'h1').verdict.votes) === '{"1":"hold","2":"hold","3":"sell","4":"sell","5":"sell"}'
    && doc(r, 'h2').status === 'took' && !doc(r, 'h2').dropped && doc(r, 'h2').agreement === 0 && doc(r, 'h2').tookAgreement === 2 && doc(r, 'h2').agreedRunId === 'run_x'
    && doc(r, 'h2').verdict?.call === 'hold' && doc(r, 'h2').verdict.why === 'Fine.'
    && doc(r, 'h3').status === 'took' && doc(r, 'h3').agreement === 4 && doc(r, 'h3').tookAgreement === 4 && doc(r, 'h3').verdict?.call === 'sell' && doc(r, 'h3').verdict.why === '4 of 5 say sell.'
    && doc(r, 'h3').verdict.votes['5'] === null
    && writes.length === 3 && writes.every((p) => p.opts.batch && /^U\d+$/.test(p.opts.ifUpdateTime))
    && st.activeIds.join() === 'h1,h2,h3,h4' && st.desk.verdicts.map((x) => `${x.ticker}:${x.call}:${x.agree}`).join() === 'BA:sell:3,XOM:sell:4,F:hold:0'
    && /^Sell BA now \(3 of 5\): Momentum faded and it lost 200 on volume\. Sell XOM now \(4 of 5\): 4 of 5 say sell\. Hold F \(0 of 5\)\./.test(r.w.pushes[0]?.body || '')
    && end?.recheck?.live === 3 && end.recheck.updated === 1 && end.recheck.sell === 2 && end.recheck.hold === 1 && end.recheck.none === 0
    && thin.out.ok === true && doc(thin, 'h2').status === 'took' && doc(thin, 'h2').agreement === 4 && doc(thin, 'h2').verdict?.call === 'sell' && doc(thin, 'h2').verdict.why === '4 of 5 say sell.'
    // BA in the thin run is two for hold and two for sell: a tie gives no call, and the count stays as it was.
    && doc(thin, 'h1').agreement === 3 && doc(thin, 'h1').verdict === undefined
    && thin.docs.get(TD.STATE_PATH).data.activeIds.join() === 'h1,h2,h3,h4',
    JSON.stringify({ h1: doc(r, 'h1')?.verdict, h2: doc(r, 'h2')?.verdict, h3: doc(r, 'h3')?.verdict, ids: st.activeIds, push: r.w.pushes[0]?.body, recheck: end?.recheck, thin: [doc(thin, 'h1')?.verdict, doc(thin, 'h2')?.verdict] }));
}
{
  // The verdicts are read from the researcher's own words under its heading, however it writes the line.
  // RE-PINNED 2026-09-24 (v7.13): four words now, hold, add, trim and sell; the 7.10 two still read as hold and sell.
  const v = DR.earlierVerdicts('## Read\nE9: hold\n## Earlier calls\nE1: backs, basing.\n- **E2:** does not back, lost it\nE3 - Hold\nE4: unsure\nE5: No longer, gapped down\nE6: add, volume building\n* E7: **Trim** into the first target\nE8: Sell, broke 11\n## Other\nE10: hold');
  // NEGATIVE CONTROL (run 2026-09-24): earlierVerdicts reading the whole report instead of its section (`const after = String(text || '');`) made this read
  //   FAIL  D31 a verdict is read ...
  check('D31 a verdict is read only under the Earlier calls heading, however the line is written: hold, add, a bold trim and sell are read, and the old backs, does not back and no longer read as hold and sell; unsure is no verdict; a line under another heading does not count',
    JSON.stringify(v) === JSON.stringify({ E1: 'hold', E2: 'sell', E3: 'hold', E5: 'sell', E6: 'add', E7: 'trim', E8: 'sell' }),
    JSON.stringify(v));
}

// ---- D32: HOLD, ADD, TRIM or SELL (2026-09-24, v7.12; four calls from v7.13) -------------------------
// Eric: "If I took a trade and scan, it should scan that same trade and tell me if I should hold or if
// things have changed and I need to sell, front and center", then "When I'm told to hold, add, trim, or sell".
// RE-PINNED 2026-09-24 (v7.13): four calls; holdOrSell became callFor and the plurality of four decides.
{
  const sys = DR.deskSystem('cash');
  const H = DR.DESK_SCHEMA.properties.holdings;
  const c = DR.checkDesk({ trades: [], holdings: [
    { ref: 'e1', call: 'hold', why: 'Still basing above 200 with volume.' }, { ref: 'E1', call: 'sell', why: 'second answer for E1' },
    { ref: 'E2', call: 'sell', why: 'Lost the level \u2014 on volume.' }, { ref: 'X9', call: 'hold', why: 'not a ref' }, { ref: 'E3', call: 'maybe', why: 'not a call' },
    { ref: 'E4', call: 'trim', why: 'Near the first target.' }, { ref: 'E5', call: 'add', why: 'Volume building on the breakout.' },
  ] });
  const t = (hold, add, trim, sell) => ({ counts: { hold, add, trim, sell } });
  // NEGATIVE CONTROL (run 2026-09-24): checkDesk's `ref in holdings` guard dropped (a second answer for E1 overwriting the first) made this read
  //   FAIL  D32 the desk calls HOLD, ADD, TRIM or SELL ...
  // RE-PINNED 2026-09-24 (v7.14, Eric: "shouldn't he have the final call?"): the desk's call stands even against five sells.
  check('D32 the desk calls HOLD, ADD, TRIM or SELL on every earlier call: its schema requires holdings, each a ref, one of the four and a reason; its brief says when to sell, trim and add; the answer keeps the first call per real ref, drops anything else, and strips a dash from the reason; the desk\'s call is final, even against five sells; with no call the most-voted of the four wins and a tie or silence calls nothing; and closing a short stock is a cover',
    DR.DESK_SCHEMA.required.includes('holdings') && H.items.required.join() === 'ref,call,why' && H.items.properties.call.enum.join() === 'hold,add,trim,sell'
    && /holdings: the market data may list earlier calls from this desk that are still live, as E1, E2/.test(sys) && /call hold, add, trim or sell/.test(sys)
    && /Sell when what the trade was built on has broken/.test(sys) && /Trim when it is still right but worth less size\. Add when it is stronger now and worth more size\./.test(sys)
    && JSON.stringify(Object.keys(c.holdings)) === '["E1","E2","E4","E5"]' && c.holdings.E1.call === 'hold' && c.holdings.E4.call === 'trim' && c.holdings.E5.call === 'add' && !/[\u2013\u2014]/.test(c.holdings.E2.why)
    && DR.callFor(t(0, 0, 0, 5), { call: 'hold', why: 'Fine.' }).call === 'hold' && DR.callFor(t(0, 0, 0, 5), { call: 'sell', why: 'Broke 11.' }).why === 'Broke 11.'
    && DR.callFor(t(0, 0, 0, 5)).call === 'sell' && DR.callFor(t(0, 0, 0, 5)).why === '5 of 5 say sell.'
    && DR.callFor(t(3, 0, 0, 2), { call: 'trim', why: 'Near the target.' }).call === 'trim'
    && DR.callFor(t(1, 3, 0, 1)).call === 'add' && DR.callFor(t(1, 3, 0, 1)).why === '3 of 5 say add.' && DR.callFor(t(0, 1, 2, 1)).why === '2 of 5 say trim.'
    && DR.callFor(t(2, 0, 0, 2)) === null && DR.callFor(t(0, 0, 0, 0)) === null
    && DR.URGENCY.sell < DR.URGENCY.trim && DR.URGENCY.trim < DR.URGENCY.add && DR.URGENCY.add < DR.URGENCY.hold
    && DR.exitWord({ instrument: 'stock', side: 'short' }) === 'Cover' && DR.exitWord({ instrument: 'put', side: 'long' }) === 'Sell' && DR.exitWord({ instrument: 'stock', side: 'long' }) === 'Sell',
    JSON.stringify({ holdings: c.holdings }));
}
{
  // ---- D33: for and against on a new trade (2026-09-24, v7.13) ---------------------------------------
  // Eric: "They are listed for and against." The desk names them by number; the count is the backers.
  const T = DR.DESK_SCHEMA.properties.trades.items;
  const s1 = DR.stanceOf({ backers: [4, 1, 2, 2, 9, '3'], doubters: [3, 5, 0], agreement: 5 });
  const s2 = DR.stanceOf({ agreement: 2 });
  const rec = DR.checkDesk({ trades: [TRADE({ backers: [1, 2, 4], doubters: [5], agreement: 5 })] }, { accountType: 'cash' }).trades[0];
  // NEGATIVE CONTROL (run 2026-09-24): stanceOf's count put back to the desk's number (`const agreement = Math.min(5, ...)` alone) made this read
  //   FAIL  D33 for and against on a new trade ...
  check('D33 for and against on a new trade: the schema requires backers and doubters by researcher number; its brief says who goes in each and that the count is the backers; a number outside 1 to 5 or twice is dropped, one in both lists leaves both, and the count is the backers, whatever number the desk gave; with no names the desk\'s number stands; and a filed trade carries all three',
    T.required.includes('backers') && T.required.includes('doubters') && T.properties.backers.items.type === 'integer'
    && /backers are the researchers, by number 1 to 5, who independently brought or supported the trade, and doubters are the ones who rejected it or argued against it/.test(DR.deskSystem('cash')) && /agreement is how many backers there are\./.test(DR.deskSystem('cash'))
    && JSON.stringify(s1) === '{"agreement":3,"backers":[1,2,4],"doubters":[5]}'
    && JSON.stringify(s2) === '{"agreement":2,"backers":[],"doubters":[]}'
    && rec && rec.agreement === 3 && rec.backers.join() === '1,2,4' && rec.doubters.join() === '5',
    JSON.stringify({ s1, s2, rec: rec && { agreement: rec.agreement, backers: rec.backers, doubters: rec.doubters } }));
}

// THE COUNTER IS COUNTED LAST (the rule from trade.mjs, 2026-09-22): every check above is counted.
const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
