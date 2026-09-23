// ============================================================================
// PR 420: THE SIX-AGENT DESK (Eric, 2026-09-23)
// ============================================================================
//
// "Five researchers investigate. One senior desk agent makes the call. I
// receive the trade. That is it."
//
// Agents 1 to 5 research the market independently, each on its own beat, and
// never see each other. Agent 6, the desk, reads all five reports, settles
// where they disagree and returns the trades worth taking right now, ready to
// act on. Eric never sees the research unless he turns the debug switch on:
// the trades are the product.
//
// Nothing here reads his history. No closed trade, no result, no log line and
// no past performance ever reaches an agent: the desk analyses the market,
// not him ("Do not create feedback loops where the agents change their
// recommendations because I personally won or lost previous trades."). The
// only thing about him an agent knows is whether his account can short.
//
// HOW IT RUNS, AND WHY THIS WAY. Every turn is a live, streamed request, not
// the Message Batches API: on 2026-09-22 a batched scan waited 5 to 114
// minutes in the provider's queue, and one run is worth nothing after the
// session it was for. The run is hosted by the per-minute cron's scheduled()
// invocation, awaited, because Cloudflare gives that invocation 15 minutes of
// wall time, where a tap's background work is cancelled 30 seconds after the
// response (verified against the Workers docs, 2026-09-23; that is what broke
// the v6.13 Look). A tap only queues the run; the next firing picks it up.
//
// CPU. That invocation gets 30 seconds of CPU, and time spent waiting on the
// network does not count. So a stream is never consumed event by event in
// JavaScript: the SDK hands back the raw response, the body is buffered
// natively, and accumulateSse rebuilds the finished message in one pass at
// the end. Five parallel researchers therefore cost almost no CPU while they
// work. The SDK's own streaming helper rebuilds a snapshot on every event,
// which is the likeliest reason long streamed turns died near four minutes in
// August 2026.
//
// SURVIVING A KILL. A long invocation can still be ended (a runtime update
// gives in-flight work a 30 second grace). So every researcher's report is
// written the moment it lands, the run beats a heartbeat every 45 seconds,
// and a run whose heartbeat has gone quiet is claimed by the next firing and
// resumed: reports already in are reused, only the missing ones re-run, and
// the desk decides as soon as enough are in.

import { tryGet, patchDoc, READ_FAILED } from './firestore.js';
import { client, diagLog } from './advisor.js';
import { notifyUser } from './push.js';
import {
  SETTINGS_PATH, STATE_PATH, PLAYS, SAY, stripDashes, mtParts, mtInstant, mtLabel, watchlistOf, resolveKey,
  marketSnapshot, quoteCached, rid, realDate,
} from './trade-desk.js';
import { isTradingDay, isMarketOpen, swingLastDay, nextDateKey, EARLY_CLOSE_MIN, MARKET_CLOSE_MIN, MARKET_OPEN_MIN } from '../public/js/trade-math.js';

// ---- the settings of a run ---------------------------------------------------
// "Use Fable unless I explicitly tell you otherwise." Every one of the six
// turns runs on it, and a refusal is never quietly handed to another model:
// that researcher simply counts as not back.
export const DESK_MODEL = 'claude-fable-5-1';
// The researchers run one step below the desk. On this model medium does what
// the previous generation needed high for, and a run has to finish inside the
// cron's window: a researcher at a higher setting can think for longer than
// the whole run is allowed. The desk, which makes the call, runs at high.
export const RESEARCH_EFFORT = 'medium';
export const DESK_EFFORT = 'high';
export const RESEARCH_SEARCHES = 5;
export const RESEARCH_MAX_TOKENS = 32_000;
export const DESK_MAX_TOKENS = 32_000;
// SHORT TURNS, ON PURPOSE (2026-09-23). In August two streamed turns died
// inside this same awaited cron drain, one 184 seconds in, and the cause was
// never settled (the flight recorder saw the deaths, not the reason). So no
// turn here is allowed to run long: a researcher is cut at a little over
// three minutes and the desk likewise, and when research alone has used most
// of that, the desk's decision is handed to the next minute's firing instead
// of stretching one invocation. Reports already in are never lost either way.
export const RESEARCH_BUDGET_MS = 200_000;
export const DESK_BUDGET_MS = 200_000;
export const HANDOFF_AFTER_MS = 150_000;
// Thinking summaries stream as they are written, so bytes keep flowing on a
// long think instead of a silent connection carrying nothing but pings.
export const THINKING = { type: 'adaptive', display: 'summarized' };
// His rule (Eric, 2026-09-23: "3% risk rule."): a stopped-out trade costs at
// most three percent of the balance. Settings can change it.
export const DEFAULT_RISK_PCT = 3;
export const HEARTBEAT_MS = 45_000;
export const STALE_BEAT_MS = 3 * 60_000;
export const RUN_GIVE_UP_MS = 45 * 60_000;
export const MAX_ATTEMPTS = 3;
export const MIN_REPORTS = 2;
export const MAX_TRADES = 6;
export const MAX_PER_HORIZON = 2;
export const MAX_NEWS = 6;
export const MAX_CONTINUES = 2;
export const RESEARCH_PATH = 'trade/research';
export const WEB_SEARCH = { type: 'web_search_20260209', name: 'web_search', max_uses: RESEARCH_SEARCHES };
// The index and the eleven sector funds ride every run beside his watchlist,
// so the macro researcher and the desk see the same tape the others do.
export const MARKET_TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA', 'XLK', 'XLF', 'XLE', 'XLV', 'XLY', 'XLP', 'XLI', 'XLU', 'XLB', 'XLRE', 'XLC'];
const TICKER_RE = /^[A-Z][A-Z.]{0,5}$/;

// ---- the five beats ------------------------------------------------------------
export const LENSES = [
  {
    n: 1, key: 'tape', name: 'Momentum and the tape',
    beat: 'Price action right now: premarket and intraday movers, relative volume, VWAP holds and losses, EMA structure (9, 20, 50), opening range breaks, and breakouts and breakdowns with real volume behind them. Your natural horizon is scalps and intraday trades.',
  },
  {
    n: 2, key: 'catalysts', name: 'Catalysts',
    beat: 'What is making specific stocks move today and this week: earnings reported overnight or due today and after the close, guidance changes, analyst upgrades, downgrades and target changes, SEC filings (8-K, S-1 and offerings, 13D, clusters of Form 4 insider buying or selling), FDA and legal decisions, contracts, mergers. Every horizon.',
  },
  {
    n: 3, key: 'macro', name: 'Macro and sectors',
    beat: 'The index trend (SPY, QQQ, IWM), sector strength and rotation, today\'s and this week\'s macro calendar (Fed speakers, CPI, PPI, jobs, GDP), rates and yields, the dollar, oil, and volatility. Tell the desk which direction the tape favors and which sectors lead or lag, and bring the best-positioned leaders and laggards, or the sector funds themselves, as candidates.',
  },
  {
    n: 4, key: 'swing', name: 'Swing structure',
    beat: 'Daily and weekly charts: bases, pullbacks to rising moving averages, reclaimed levels, multi-day support and resistance, gaps to fill, and relative strength against the index over weeks. Your natural horizon is swing trades of up to three trading days that are out before the weekend; say what would stop one out overnight.',
  },
  {
    n: 5, key: 'options', name: 'Options, volatility and risk',
    beat: 'Unusual options activity and large directional flow, implied volatility and what the options market expects a stock to move, liquidity and spreads, short interest and squeeze risk, and the risk and reward of the day\'s most crowded names. Also the traps: names that look good and are not.',
  },
];

// ---- the prompts -----------------------------------------------------------------
const accountRule = (type) => (type === 'margin'
  ? 'His account is a margin account: short stock is allowed when borrow and liquidity are normal.'
  : 'His account is a cash account, so he cannot short stock: a bearish view can only be a put, or it is skipped.');

export function researchSystem(accountType) {
  return `You are a researcher on PR 420, a small proprietary trading desk that serves one trader, Eric. He trades his own account from his phone and has no time to read research: he opens the app, sees a handful of trades, takes one or ignores it. Five researchers look at the market independently and a sixth, the desk, reads all five reports and makes the final calls. You are one of the five. You will not see the other reports and nobody reads yours except the desk, so write for a colleague who will check your work against four others: facts with their source and time, candidates the desk can act on, and a clear line between what you verified and what you think.

What the desk needs from you:
- The strongest opportunities your beat turns up right now, across scalps (held 1 to 10 minutes), intraday trades (held 1 to 8 hours and flat by the close) and swing trades (held up to 3 trading days and never over a weekend). Quality over count: two well-evidenced candidates beat six thin ones, and none is a valid answer.
- For every candidate: the ticker, long or short, scalp, intraday or swing, the last price with its time and where it came from, an entry zone, a stop, one or two targets, the expected hold, the setup in one sentence, the catalyst, what would invalidate it, and your honest chance, as a range such as 55 to 62, that it reaches the first target before the stop.
- The names you looked at and rejected, one line each, with the reason. The desk uses these to settle disagreements.
- Anything outside your beat that would materially change a trade, such as a halt, an offering, or a macro release in the next hour.

Hard rules:
- Never invent a price, a level, a headline or a number. Every price comes from the market data in the message or from a search you ran today, and you say which. If you cannot confirm a current price, say so and mark the candidate unconfirmed.
- Search for what you need. The market data in the message is a starting point, not the universe: do not stop at the names listed in it. You have at most ${RESEARCH_SEARCHES} searches and a few minutes, so spend them on what would change a call, then finish with what you have.
- Do not size positions and do not mention an account balance. The desk sizes every trade.
- ${accountRule(accountType)}
- Options only on highly liquid names with tight spreads, and only when the option is clearly a better vehicle than the stock. Give the contract (strike, call or put, expiry) and the premium you saw; for an option the entry, stop and targets are premium prices.
- You never ask a question and never address Eric. Report and stop.
- Plain sentences, and never an em dash or an en dash.

Report in plain text under exactly these headings and nothing else:
## Read
Three sentences at most on what your beat shows about the market right now.
## Candidates
One block per candidate, one field per line as Field: value.
## Rejected
One line each.
## Watch
Anything outside your beat that changes a trade, or Nothing.`;
}

export function deskSystem(accountType, riskPct = DEFAULT_RISK_PCT) {
  return `You are the desk on PR 420, a small proprietary trading desk that serves one trader, Eric. He opens the app, sees the trades you choose, and either takes one or ignores it. He will not read research, ask follow-up questions or approve anything: what you return is the whole product. Five researchers have each looked at the market independently, each on a different beat. Their reports are in the message, with the same market data they saw.

Decide which trades are actually worth taking right now, and hand him each one ready to act on.

How to weigh the reports:
- Independent agreement is evidence. Two researchers arriving at the same name for different reasons is stronger than one researcher's conviction.
- A price or headline that no researcher sourced, or that disagrees with the market data, is a red flag. When the market data has a current price, it wins.
- When researchers disagree on direction, only take the trade if one side has decisive evidence.
- A rejection by one researcher counts against a candidate from another. Read the Rejected lines.
- The macro and sector read sets the bias. Be slower to trade against it.
- Only include trades you would take yourself today. No trades is the right answer when nothing is worth it; he would rather see none than a weak one.

Limits:
- At most ${MAX_TRADES} trades and at most ${MAX_PER_HORIZON} of each kind.
- Scalps are held 1 to 10 minutes, intraday trades 1 to 8 hours and flat by the close, swing trades up to 3 trading days and never over a weekend. Give holdMinutes for a scalp or intraday trade and holdDays for a swing.
- Scalps only while the market is open or within an hour of the open.
- ${accountRule(accountType)}
- Options only when clearly better than the stock and liquid. For an option, entry, stop and targets are premium prices per share, lastPrice is the premium, and strike and expiry (YYYY-MM-DD) name the contract.
- For a long, the stop is below the entry zone and the targets above it; for a short stock, the reverse.

Sizing: allocPct is the share of his account you would put in this trade, from 1 to 50. The app turns it into dollars and shares from his balance and caps it so a stopped-out trade costs no more than ${riskPct}% of the account, so you do not do that arithmetic. Set stops where the trade is actually wrong, not where the size looks good.

What he reads has to fit on a phone card at a glance. setup is one sentence under 25 words, catalyst under 15 words, invalidation under 20 words. Plain English with no jargon he would have to decode, and never an em dash or an en dash. chanceLow and chanceHigh are your honest range, in percent, that the first target is reached before the stop. agreement is how many of the five researchers independently supported the trade.

read is one sentence on what the tape is doing. none is one sentence on why there are no trades, or an empty string when there are some.

news is up to ${MAX_NEWS} items that matter for trading today, each with the tickers it touches and one sentence on why it matters. Not general financial news: only what could change a trade.`;
}

const NUM = { type: 'number' };
const NULL_NUM = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const NULL_STR = { anyOf: [{ type: 'string' }, { type: 'null' }] };
export const DESK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['read', 'none', 'trades', 'news'],
  properties: {
    read: { type: 'string' },
    none: { type: 'string' },
    trades: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ticker', 'side', 'horizon', 'instrument', 'lastPrice', 'entryLow', 'entryHigh', 'stop', 'targets',
          'holdMinutes', 'holdDays', 'allocPct', 'chanceLow', 'chanceHigh', 'setup', 'catalyst', 'invalidation',
          'strike', 'expiry', 'agreement'],
        properties: {
          ticker: { type: 'string' },
          side: { type: 'string', enum: ['long', 'short'] },
          horizon: { type: 'string', enum: ['scalp', 'intraday', 'swing'] },
          instrument: { type: 'string', enum: ['stock', 'call', 'put'] },
          lastPrice: NUM,
          entryLow: NUM,
          entryHigh: NUM,
          stop: NUM,
          targets: { type: 'array', items: NUM },
          holdMinutes: NULL_NUM,
          holdDays: NULL_NUM,
          allocPct: NUM,
          chanceLow: { type: 'integer' },
          chanceHigh: { type: 'integer' },
          setup: { type: 'string' },
          catalyst: { type: 'string' },
          invalidation: { type: 'string' },
          strike: NULL_NUM,
          expiry: NULL_STR,
          agreement: { type: 'integer' },
        },
      },
    },
    news: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['headline', 'tickers', 'why'],
        properties: {
          headline: { type: 'string' },
          tickers: { type: 'array', items: { type: 'string' } },
          why: { type: 'string' },
        },
      },
    },
  },
};

// ---- the transport ---------------------------------------------------------------
/**
 * A whole streamed Messages response, buffered as one string, turned back
 * into the Message the non-streamed endpoint would have returned. Pure: no
 * I/O and no clock. Deltas are folded in the way the SDK's own accumulator
 * folds them (a signature is assigned, usage is cumulative and overwrites).
 * Throws on an `error` event, or on a body that never started.
 */
export function accumulateSse(body) {
  let msg = null;
  const blocks = [];
  const partialJson = [];
  let errored = null;
  for (const frame of String(body || '').split(/\r?\n\r?\n/)) {
    let data = '';
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
    }
    if (!data) continue;
    let ev;
    try { ev = JSON.parse(data); } catch { continue; }
    switch (ev.type) {
      case 'message_start':
        msg = { ...ev.message, content: [] };
        break;
      case 'content_block_start': {
        const b = { ...ev.content_block };
        if (b.type === 'text' && typeof b.text !== 'string') b.text = '';
        if (b.type === 'thinking' && typeof b.thinking !== 'string') b.thinking = '';
        blocks[ev.index] = b;
        if (b.type === 'server_tool_use' || b.type === 'tool_use') partialJson[ev.index] = '';
        break;
      }
      case 'content_block_delta': {
        const b = blocks[ev.index];
        const d = ev.delta || {};
        if (!b) break;
        if (d.type === 'text_delta') b.text = (b.text || '') + (d.text || '');
        else if (d.type === 'thinking_delta') b.thinking = (b.thinking || '') + (d.thinking || '');
        else if (d.type === 'signature_delta') b.signature = d.signature || '';
        else if (d.type === 'input_json_delta') partialJson[ev.index] = (partialJson[ev.index] || '') + (d.partial_json || '');
        else if (d.type === 'citations_delta' && d.citation) b.citations = [...(b.citations || []), d.citation];
        break;
      }
      case 'content_block_stop': {
        const b = blocks[ev.index];
        if (b && partialJson[ev.index] !== undefined) {
          const raw = partialJson[ev.index];
          // No deltas: the start event's input stands, as the SDK keeps it.
          if (raw) { try { b.input = JSON.parse(raw); } catch { b.input = {}; } } else if (b.input === undefined) b.input = {};
        }
        break;
      }
      case 'message_delta':
        if (msg) {
          const d = ev.delta || {};
          if ('stop_reason' in d) msg.stop_reason = d.stop_reason;
          if ('stop_sequence' in d) msg.stop_sequence = d.stop_sequence;
          if (d.stop_details !== undefined) msg.stop_details = d.stop_details;
          if (d.container !== undefined) msg.container = d.container;
          if (ev.usage) msg.usage = { ...(msg.usage || {}), ...ev.usage };
        }
        break;
      case 'error':
        errored = ev.error || { type: 'error', message: 'The stream reported an error.' };
        break;
      default: // ping, message_stop, and any event type added later
        break;
    }
  }
  if (errored) {
    const e = new Error(`stream error: ${errored.type || 'error'}: ${errored.message || ''}`.trim());
    e.streamError = errored;
    throw e;
  }
  if (!msg) throw new Error('The stream ended before the answer started.');
  msg.content = blocks.filter(Boolean);
  return msg;
}

/** The text a finished message carries, every text block in order. */
export const textOf = (msg) => (Array.isArray(msg?.content) ? msg.content : [])
  .filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');

export class RefusedError extends Error {
  constructor(category) { super(`refused${category ? ` (${category})` : ''}`); this.refused = true; this.category = category || null; }
}

/**
 * One live turn. The request is streamed so bytes flow from the first moment
 * (a request that produces none is answered 524 by the provider's edge at
 * about two minutes), the body is buffered natively rather than parsed per
 * event, and a pause_turn is continued append-only, the paused turn passed
 * back exactly as it came. `signal` covers the whole body; the SDK's own
 * timeout only covers the wait for headers.
 */
export async function liveTurn(env, body, { signal, maxContinues = MAX_CONTINUES, call = null } = {}) {
  const send = call || ((b) => client(env).messages.create({ ...b, stream: true }, { signal, maxRetries: 2 }).asResponse());
  let messages = body.messages;
  let container = null;
  const parts = [];
  let usage = { input_tokens: 0, output_tokens: 0, searches: 0 };
  let last = null;
  for (let i = 0; i <= maxContinues; i++) {
    const req = { ...body, messages, ...(container ? { container } : {}) };
    const res = await send(req);
    const raw = await res.text();
    last = accumulateSse(raw);
    const u = last.usage || {};
    usage = {
      input_tokens: usage.input_tokens + (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0),
      output_tokens: usage.output_tokens + (Number(u.output_tokens) || 0),
      searches: usage.searches + (Number(u.server_tool_use?.web_search_requests) || 0),
    };
    if (last.stop_reason === 'refusal') throw new RefusedError(last.stop_details?.category);
    parts.push(textOf(last));
    if (last.stop_reason !== 'pause_turn') break;
    if (last.container?.id) container = last.container.id;
    messages = [...messages, { role: 'assistant', content: last.content }];
  }
  return { message: last, text: parts.join('').trim(), usage, turns: parts.length };
}

// ---- what every agent is told about the market ------------------------------------
/** The session in words: open, before the open, after the close, or no session today. */
export function sessionLine(now = Date.now()) {
  const { dateKey, minuteOfDay, hh, mm } = mtParts(now);
  const day = isTradingDay(dateKey);
  const clock = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} Mountain`;
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(now));
  if (!day) return { text: `It is ${clock} on ${weekday}. The market is closed today; plan for the next session.`, open: false, minsToOpen: null };
  const close = day === 'early' ? EARLY_CLOSE_MIN : MARKET_CLOSE_MIN;
  if (isMarketOpen({ dateKey, minuteOfDay })) {
    return { text: `It is ${clock} on ${weekday}. The market is open and closes at ${day === 'early' ? '11:00' : '14:00'} Mountain${day === 'early' ? ' (an early close)' : ''}, ${close - minuteOfDay} minutes from now.`, open: true, minsToOpen: 0 };
  }
  if (minuteOfDay < MARKET_OPEN_MIN) {
    return { text: `It is ${clock} on ${weekday}, before the open. The market opens at 07:30 Mountain, ${MARKET_OPEN_MIN - minuteOfDay} minutes from now.`, open: false, minsToOpen: MARKET_OPEN_MIN - minuteOfDay };
  }
  return { text: `It is ${clock} on ${weekday}, after the close. Plan for the next session.`, open: false, minsToOpen: null };
}

/** The market data block every agent gets. Quotes, headlines and today's earnings; never anything about him. */
export function snapshotText(snap, { hasKey = true } = {}) {
  if (!hasKey) return 'No market data key is on file, so there are no quotes here. Search for every price you use and say where it came from.';
  const quotes = (snap?.quotes || []).map((q) => `${q.ticker} ${q.last} (${q.chgPct >= 0 ? '+' : ''}${q.chgPct}% on the day, open ${q.open}, high ${q.high}, low ${q.low}, previous close ${q.prevClose})`);
  const news = (snap?.news || []).slice(0, 15).map((n) => `${n.headline}${n.related?.length ? ` [${n.related.join(', ')}]` : ''} (${n.source || 'wire'})`);
  const earnings = (snap?.earnings || []).slice(0, 30).map((e) => `${e.symbol}${e.hour ? ` ${e.hour}` : ''}`);
  return [
    `Quotes as of ${snap?.at || 'now'}:`, quotes.length ? quotes.join('\n') : 'No quotes came back.',
    snap?.missing?.length ? `No quote came back for: ${snap.missing.join(', ')}.` : '',
    '', 'Headlines from the last twelve hours:', news.length ? news.join('\n') : 'None came back.',
    '', `Reporting earnings today: ${earnings.length ? earnings.join(', ') : 'none listed'}.`,
  ].filter((l) => l !== null).join('\n').trim();
}

// ---- checking what the desk returned ----------------------------------------------
const fin = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const r4 = (x) => Math.round(x * 10000) / 10000;
const clip = (s, n) => stripDashes(String(s || '')).replace(/\s+/g, ' ').trim().slice(0, n);

/**
 * One trade the desk returned, checked field by field and returned in the
 * shape a card reads, or null when it cannot be acted on safely: a ticker
 * that is not one, a short he cannot place, prices on the wrong side of the
 * entry, an option with no contract. Pure.
 */
export function validRec(t, { accountType = 'cash', session = null, todayKey = null } = {}) {
  if (!t || typeof t !== 'object') return null;
  const ticker = String(t.ticker || '').trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return null;
  const side = t.side === 'short' ? 'short' : t.side === 'long' ? 'long' : null;
  const horizon = ['scalp', 'intraday', 'swing'].includes(t.horizon) ? t.horizon : null;
  const instrument = ['stock', 'call', 'put'].includes(t.instrument) ? t.instrument : 'stock';
  if (!side || !horizon) return null;
  if (instrument === 'stock' && side === 'short' && accountType !== 'margin') return null;
  // An option here is always bought, so its premium is always a long.
  if (instrument !== 'stock' && side !== 'long') return null;
  let lo = fin(t.entryLow); let hi = fin(t.entryHigh);
  if (lo == null && hi == null) return null;
  if (lo == null) lo = hi;
  if (hi == null) hi = lo;
  if (lo > hi) [lo, hi] = [hi, lo];
  const stop = fin(t.stop);
  const targets = (Array.isArray(t.targets) ? t.targets : []).map(fin).filter((v) => v != null && v > 0).slice(0, 2);
  if (!(lo > 0) || !(stop > 0) || !targets.length) return null;
  const up = instrument !== 'stock' || side === 'long';
  if (up && !(stop < lo && targets.every((x) => x > hi))) return null;
  if (!up && !(stop > hi && targets.every((x) => x < lo))) return null;
  if (targets.length === 2 && (up ? targets[1] <= targets[0] : targets[1] >= targets[0])) targets.pop();
  let strike = null; let expiry = null;
  if (instrument !== 'stock') {
    strike = fin(t.strike);
    expiry = realDate(t.expiry) ? String(t.expiry) : null;
    if (!(strike > 0) || !expiry || (todayKey && expiry < todayKey)) return null;
  }
  if (horizon === 'scalp' && session && !session.open && !(session.minsToOpen != null && session.minsToOpen <= 60)) return null;
  let cLo = Math.round(fin(t.chanceLow) ?? 0); let cHi = Math.round(fin(t.chanceHigh) ?? 0);
  if (cLo > cHi) [cLo, cHi] = [cHi, cLo];
  const chanceOk = cLo >= 1 && cHi <= 99;
  const hm = fin(t.holdMinutes); const hd = fin(t.holdDays);
  const setup = clip(t.setup, 220);
  if (!setup) return null;
  return {
    ticker, side, horizon, instrument,
    lastPrice: fin(t.lastPrice) != null && fin(t.lastPrice) > 0 ? r4(fin(t.lastPrice)) : null,
    entryLow: r4(lo), entryHigh: r4(hi), entry: r4((lo + hi) / 2), stop: r4(stop), targets: targets.map(r4),
    holdMinutes: horizon === 'swing' ? null : Math.min(480, Math.max(1, Math.round(hm ?? (horizon === 'scalp' ? 10 : 120)))),
    holdDays: horizon === 'swing' ? Math.min(3, Math.max(1, Math.round(hd ?? 2))) : null,
    allocPct: Math.min(50, Math.max(1, Math.round(fin(t.allocPct) ?? 10))),
    profitLow: chanceOk ? cLo : null, profitHigh: chanceOk ? cHi : null,
    setup, catalyst: clip(t.catalyst, 140), invalidation: clip(t.invalidation, 180),
    strike, expiry, agreement: Math.min(5, Math.max(0, Math.round(fin(t.agreement) ?? 0))),
  };
}

/** The desk's whole answer, checked: at most six trades, two of a kind, no repeats; at most six news items. Pure. */
export function checkDesk(out, ctx = {}) {
  const trades = [];
  const perKind = { scalp: 0, intraday: 0, swing: 0 };
  const seen = new Set();
  let dropped = 0;
  for (const t of Array.isArray(out?.trades) ? out.trades : []) {
    const r = validRec(t, ctx);
    if (!r) { dropped++; continue; }
    const key = `${r.ticker}:${r.side}:${r.horizon}`;
    if (seen.has(key) || perKind[r.horizon] >= MAX_PER_HORIZON || trades.length >= MAX_TRADES) { dropped++; continue; }
    seen.add(key); perKind[r.horizon]++;
    trades.push(r);
  }
  const news = (Array.isArray(out?.news) ? out.news : []).map((n) => ({
    headline: clip(n?.headline, 180),
    tickers: (Array.isArray(n?.tickers) ? n.tickers : []).map((x) => String(x).trim().toUpperCase()).filter((x) => TICKER_RE.test(x)).slice(0, 6),
    why: clip(n?.why, 220),
  })).filter((n) => n.headline).slice(0, MAX_NEWS);
  return { trades, news, read: clip(out?.read, 240), none: clip(out?.none, 240), dropped };
}

/** The desk's answer as JSON: the structured output itself, or failing that the first JSON object in the text. */
export function parseDesk(text) {
  const s = String(text || '').trim();
  try { return JSON.parse(s); } catch { /* fall through */ }
  const fenced = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* fall through */ } }
  const a = s.indexOf('{'); const b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch { /* fall through */ } }
  return null;
}

/** When an idea stops being worth taking if he has not taken it. Taken trades never expire. */
export function recExpiry(horizon, { holdDays = 2, now = Date.now(), contractExpiry = null } = {}) {
  const { dateKey, minuteOfDay } = mtParts(now);
  const day = isTradingDay(dateKey);
  const closeMin = day === 'early' ? EARLY_CLOSE_MIN : MARKET_CLOSE_MIN;
  const nextSession = () => { let d = nextDateKey(dateKey); for (let i = 0; i < 10 && !isTradingDay(d); i++) d = nextDateKey(d); return d; };
  const sessionDay = day && minuteOfDay < closeMin ? dateKey : nextSession();
  const closeOf = (k) => mtInstant(k, isTradingDay(k) === 'early' ? '11:00' : '14:00');
  let at;
  if (horizon === 'scalp') {
    // Half an hour, and never past the close it was filed for.
    const openAt = mtInstant(sessionDay, '07:30');
    at = Math.min(Math.max(now, openAt) + 30 * 60_000, closeOf(sessionDay));
  } else if (horizon === 'swing') at = closeOf(swingLastDay(sessionDay, holdDays) || sessionDay);
  else at = closeOf(sessionDay);
  // A contract cannot be taken after the day it expires.
  if (realDate(contractExpiry)) at = Math.min(at, closeOf(contractExpiry));
  return new Date(at);
}

// ---- the run's state -----------------------------------------------------------------
async function readState(env) {
  const doc = await tryGet(env, STATE_PATH);
  if (doc === READ_FAILED) throw new Error('The desk state could not be read.');
  return doc;
}
const ms = (v) => (v ? new Date(v).getTime() : 0);
const LIVE = new Set(['queued', 'researching', 'decide', 'deciding']);

/** Whether a run is genuinely in flight: queued, or working with a heartbeat that is not stale. */
export function runAlive(run, now = Date.now()) {
  if (!run || !LIVE.has(run.status)) return false;
  if (run.status === 'queued' || run.status === 'decide') return now - ms(run.queuedAt || run.startedAt) < RUN_GIVE_UP_MS;
  // A fresh heartbeat means an invocation is working on it now, however long
  // the run has been going; only a quiet one can be taken over or given up.
  return now - ms(run.heartbeatAt || run.claimedAt) < STALE_BEAT_MS;
}

/**
 * Queue a run: his tap or the 7:00 firing. Never starts a turn itself. A run
 * already in flight is answered with `already` rather than a second run,
 * because two taps must not buy two runs.
 */
export async function requestRun(env, { trigger = 'manual', now = Date.now() } = {}) {
  const doc = await readState(env);
  const run = doc?.data?.run || null;
  if (runAlive(run, now)) return { ok: true, already: true, run };
  const next = { id: rid('run_'), status: 'queued', trigger, queuedAt: new Date(now), attempt: 0, done: 0, error: null };
  const opts = doc ? { mask: ['run'], ifUpdateTime: doc.updateTime } : { mask: ['run'], mustNotExist: true };
  // A write that fails outright throws to the caller; only a lost precondition
  // comes back false, and that is "already" only when a run really is going.
  const won = await patchDoc(env, STATE_PATH, { run: next }, opts);
  if (won === false) {
    const again = await readState(env).catch(() => null);
    const cur = again?.data?.run || null;
    return runAlive(cur, now) ? { ok: true, already: true, run: cur } : { ok: false, busy: true, run: cur };
  }
  await diagLog(env, { ev: 'desk-run-queued', trigger }).catch(() => {});
  return { ok: true, already: false, run: next };
}

/**
 * The cron's one call. Claims a queued run, or resumes one whose heartbeat
 * went quiet, and runs it to the end inside this invocation. Returns true
 * when it did the work, so the firing leaves the case drain for the next one.
 */
export async function maybeRunDesk(env, { deadlineAt, now = Date.now(), deps = {} } = {}) {
  let doc;
  try { doc = await readState(env); } catch { return false; }
  const run = doc?.data?.run;
  if (!run || !LIVE.has(run.status)) return false;
  // Queued, and research handed to the desk, are claimed at once; a working
  // run only once its heartbeat has gone quiet.
  const ready = run.status === 'queued' || run.status === 'decide';
  if (!ready && runAlive(run, now)) return false;
  const age = now - ms(run.startedAt || run.queuedAt);
  // Attempts count invocations that died on it. A run handed to the desk
  // after its research is not a death, so it is never given up for that.
  if (age >= RUN_GIVE_UP_MS || (!ready && (Number(run.attempt) || 0) >= MAX_ATTEMPTS)) {
    await patchDoc(env, STATE_PATH, { run: { ...run, status: 'error', error: SAY.runStalled, finishedAt: new Date(now) } }, { mask: ['run'], ifUpdateTime: doc.updateTime }).catch(() => {});
    await diagLog(env, { ev: 'desk-run-end', ok: false, err: 'gave up', attempt: run.attempt || 0 }).catch(() => {});
    return false;
  }
  const claimed = {
    ...run,
    phase: run.status === 'decide' || run.status === 'deciding' ? 'desk' : 'research',
    status: run.status === 'decide' || run.status === 'deciding' ? 'deciding' : 'researching',
    startedAt: run.startedAt || new Date(now),
    claimedAt: new Date(now), heartbeatAt: new Date(now),
    attempt: run.status === 'decide' ? Math.max(1, Number(run.attempt) || 0) : (Number(run.attempt) || 0) + 1, error: null,
  };
  const won = await patchDoc(env, STATE_PATH, { run: claimed }, { mask: ['run'], ifUpdateTime: doc.updateTime }).catch(() => false);
  if (won === false) return false;
  const t0 = Date.now();
  await executeRun(env, claimed, { deadlineAt, deps });
  // True only when the run really held this firing. One that failed in
  // seconds (a refused request, no credit) leaves the minute's case drain to
  // run as usual, so tapping again and again can never starve the cases.
  return Date.now() - t0 >= (deps.heldMs ?? 60_000);
}

// ---- one run, start to finish ------------------------------------------------------------
const friendly = (err) => {
  if (err?.refused) return 'declined to answer';
  if (err?.name === 'AbortError' || /abort/i.test(String(err?.message || ''))) return 'ran past its time';
  const s = Number(err?.status);
  if (s === 429) return 'rate limited';
  if (s === 529 || s === 503) return 'the provider was overloaded';
  if (s >= 500) return 'the provider had an error';
  if (s === 400) return `the request was refused: ${String(err?.message || '').slice(0, 120)}`;
  return String(err?.message || err || 'failed').slice(0, 140);
};

/** His risk per trade, in percent of the balance: his setting, else three. */
export function riskPctOf(settings) {
  const v = Number(settings?.riskPct);
  return Number.isFinite(v) && v >= 0.1 && v <= 5 ? Math.round(v * 100) / 100 : DEFAULT_RISK_PCT;
}

async function readSettings(env) {
  const doc = await tryGet(env, SETTINGS_PATH);
  return doc === READ_FAILED ? {} : (doc?.data || {});
}

/** Everything a run does after its claim. Exported for the checks, which hand it fakes through `deps`. */
export async function executeRun(env, run, { deadlineAt = Date.now() + 12 * 60_000, deps = {} } = {}) {
  const t0 = Date.now();
  const turn = deps.liveTurn || liveTurn;
  const snapshot = deps.marketSnapshot || marketSnapshot;
  const quote = deps.quoteCached || quoteCached;
  const push = deps.notifyUser || notifyUser;
  const settings = await readSettings(env);
  const doc0 = await tryGet(env, STATE_PATH).catch(() => null);
  const accountType = settings.accountType === 'margin' ? 'margin' : 'cash';
  const key = resolveKey(env, settings);
  const session = sessionLine(t0);
  const { dateKey: todayKey } = mtParts(t0);
  let alive = true;
  let beatTimer = null;
  let wake = null;
  // OWNERSHIP (2026-09-23). Another invocation may have given this run up or
  // he may have queued a new one while this one worked. Every write below
  // first checks the slot still holds this run and this attempt; once it does
  // not, this invocation stops writing altogether, so an old attempt can never
  // overwrite a newer run or keep a dead one looking alive.
  let lost = false;
  const mine = async () => {
    const d = await tryGet(env, STATE_PATH).catch(() => null);
    if (!d || d === READ_FAILED) return null;
    const r = d.data?.run;
    if (r && r.id === run.id && (Number(r.attempt) || 0) === (Number(run.attempt) || 0)) return d;
    lost = true;
    return false;
  };
  const beat = (async () => {
    while (alive) {
      await new Promise((r) => { wake = r; beatTimer = setTimeout(r, deps.heartbeatMs || HEARTBEAT_MS); });
      if (!alive || lost) break;
      if (await mine() === false) break;
      await patchDoc(env, STATE_PATH, { run: { heartbeatAt: new Date() } }, { mask: ['run.heartbeatAt'] }).catch(() => {});
    }
  })();
  const setRun = async (fields) => {
    if (lost || await mine() === false) return false;
    return patchDoc(env, STATE_PATH, { run: fields }, { mask: Object.keys(fields).map((k) => `run.${k}`) }).catch(() => false);
  };
  const superseded = async (stage) => {
    await diagLog(env, { ev: 'desk-run-end', ok: false, err: `superseded at ${stage}`, attempt: run.attempt || 0, ms: Date.now() - t0 }).catch(() => {});
    return { ok: false, why: 'superseded' };
  };
  try {
    // The research doc belongs to one run. A resumed run keeps what landed; a fresh one starts clean.
    const rdoc = await tryGet(env, RESEARCH_PATH);
    // A read that failed is not "no research": wiping the document would throw
    // away reports already paid for. The run goes back to be claimed again.
    if (rdoc === READ_FAILED) {
      await setRun({ status: run.phase === 'desk' ? 'decide' : 'queued', heartbeatAt: new Date() });
      await diagLog(env, { ev: 'desk-run-retry', err: 'research unreadable', attempt: run.attempt || 0 }).catch(() => {});
      return { ok: false, retry: true };
    }
    const prior = rdoc && rdoc.data?.runId === run.id ? rdoc.data : null;
    if (!prior) {
      await patchDoc(env, RESEARCH_PATH, { runId: run.id, at: new Date(), r1: null, r2: null, r3: null, r4: null, r5: null }).catch(() => {});
    }
    const reports = {};
    for (const L of LENSES) if (prior?.[`r${L.n}`]?.status === 'ok') reports[L.n] = prior[`r${L.n}`];

    const tickers = [...new Set([...MARKET_TICKERS, ...watchlistOf(settings)])].slice(0, 30);
    const snap = key ? await snapshot(key, tickers, t0).catch(() => null) : null;
    const market = snapshotText(snap, { hasKey: !!key });
    const system = researchSystem(accountType);

    // The five, in parallel, each written the moment it lands.
    const left = run.phase === 'desk' ? [] : LENSES.filter((L) => !reports[L.n]);
    // A resumed run that already holds enough reports does not buy the missing ones twice.
    const skipResearch = (Number(run.attempt) || 1) > 1 && Object.keys(reports).length >= MIN_REPORTS;
    const budget = Math.min(RESEARCH_BUDGET_MS, deadlineAt - Date.now() - DESK_BUDGET_MS - 20_000);
    const agents = [];
    let unsaved = false;
    if (left.length && !skipResearch && budget >= 60_000) {
      await setRun({ status: 'researching', done: Object.keys(reports).length });
      await Promise.all(left.map(async (L) => {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), budget);
        const a0 = Date.now();
        let row;
        try {
          const out = await turn(env, {
            model: DESK_MODEL,
            max_tokens: RESEARCH_MAX_TOKENS,
            system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
            messages: [{ role: 'user', content: [{ type: 'text', text: `Your beat: ${L.name}. ${L.beat}\n\n${session.text}\n\n${market}` }] }],
            tools: [WEB_SEARCH],
            thinking: THINKING,
            output_config: { effort: RESEARCH_EFFORT },
          }, { signal: ac.signal });
          const text = stripDashes(out.text).slice(0, 12_000);
          row = text
            ? { status: 'ok', text, ms: Date.now() - a0, stop: out.message?.stop_reason || '', usage: out.usage, turns: out.turns, at: new Date() }
            : { status: 'failed', err: 'came back empty', ms: Date.now() - a0, stop: out.message?.stop_reason || '', usage: out.usage, at: new Date() };
        } catch (err) {
          row = { status: err?.refused ? 'refused' : 'failed', err: friendly(err), ms: Date.now() - a0, at: new Date() };
        } finally {
          clearTimeout(timer);
        }
        agents.push({ n: L.n, ok: row.status === 'ok', ms: row.ms, s: row.usage?.searches ?? null, st: row.stop || row.err || '' });
        if (row.status === 'ok') reports[L.n] = row;
        const saved = await patchDoc(env, RESEARCH_PATH, { [`r${L.n}`]: row }, { mask: [`r${L.n}`] }).catch(() => false);
        if (saved === false && row.status === 'ok') unsaved = true;
        await setRun({ done: Object.keys(reports).length, heartbeatAt: new Date() });
      }));
    }

    if (lost) return superseded('research');
    const got = LENSES.filter((L) => reports[L.n]);
    if (got.length < MIN_REPORTS) {
      const why = SAY.runThin;
      await setRun({ status: 'error', error: why, finishedAt: new Date() });
      await diagLog(env, { ev: 'desk-run-end', ok: false, err: `reports ${got.length}`, agents, ms: Date.now() - t0 }).catch(() => {});
      return { ok: false, why };
    }

    // A long research phase hands the decision to the next minute's firing,
    // which claims it at once, so no invocation carries both long halves.
    // Never when a report could not be saved (the next firing would not see
    // it), and never on the last attempt allowed.
    if (run.phase !== 'desk' && !unsaved && (Number(run.attempt) || 1) < MAX_ATTEMPTS
      && Date.now() - t0 > (deps.handoffAfterMs ?? HANDOFF_AFTER_MS)) {
      await setRun({ status: 'decide', heartbeatAt: new Date() });
      await diagLog(env, { ev: 'desk-run-handoff', reports: got.length, agents, ms: Date.now() - t0 }).catch(() => {});
      return { ok: true, handedOff: true, reports: got.length };
    }

    // The desk.
    await setRun({ status: 'deciding', heartbeatAt: new Date() });
    const deskBudget = Math.max(60_000, Math.min(DESK_BUDGET_MS, deadlineAt - Date.now() - 10_000));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deskBudget);
    const d0 = Date.now();
    let decided;
    const reportText = got.map((L) => `### Researcher ${L.n}: ${L.name}\n${reports[L.n].text}`).join('\n\n');
    const missing = LENSES.filter((L) => !reports[L.n]).map((L) => L.name);
    const deskUser = `${session.text}\n\n${missing.length ? `These beats did not report this run: ${missing.join(', ')}.\n\n` : ''}The market data every researcher saw:\n${market}\n\nThe five reports:\n\n${reportText}`;
    const deskBody = (structured) => ({
      model: DESK_MODEL,
      max_tokens: DESK_MAX_TOKENS,
      system: [{ type: 'text', text: deskSystem(accountType, riskPctOf(settings)) + (structured ? '' : '\n\nReturn only one JSON object with the fields read, none, trades and news, and nothing else.') }],
      messages: [{ role: 'user', content: [{ type: 'text', text: deskUser }] }],
      thinking: THINKING,
      output_config: structured ? { effort: DESK_EFFORT, format: { type: 'json_schema', schema: DESK_SCHEMA } } : { effort: DESK_EFFORT },
    });
    try {
      let out;
      try {
        out = await turn(env, deskBody(true), { signal: ac.signal, maxContinues: 0 });
      } catch (err) {
        // An account that cannot use structured output answers 400; the same call without it still works.
        if (Number(err?.status) !== 400 || !/output_config|format|schema/i.test(String(err?.message || ''))) throw err;
        out = await turn(env, deskBody(false), { signal: ac.signal, maxContinues: 0 });
      }
      decided = { json: parseDesk(out.text), stop: out.message?.stop_reason || '', usage: out.usage, ms: Date.now() - d0 };
    } catch (err) {
      const why = `The desk could not decide: ${friendly(err)}. Tap RUN TRADING DESK to try again.`;
      await setRun({ status: 'error', error: why, finishedAt: new Date() });
      await diagLog(env, { ev: 'desk-run-end', ok: false, err: `desk ${friendly(err)}`.slice(0, 140), agents, ms: Date.now() - t0 }).catch(() => {});
      return { ok: false, why };
    } finally {
      clearTimeout(timer);
    }
    // Only an object with a trades list is an answer. Anything else, a bare
    // list or some other shape, would read as "nothing worth taking" and clear
    // his board, so it is refused the same way unreadable text is.
    if (!decided.json || typeof decided.json !== 'object' || Array.isArray(decided.json) || !Array.isArray(decided.json.trades)) {
      const why = 'The desk answered in a shape the app could not read, so nothing changed. Tap RUN TRADING DESK to try again.';
      await setRun({ status: 'error', error: why, finishedAt: new Date() });
      await diagLog(env, { ev: 'desk-run-end', ok: false, err: 'unreadable', stop: decided.stop, agents, ms: Date.now() - t0 }).catch(() => {});
      return { ok: false, why };
    }
    const checked = checkDesk(decided.json, { accountType, session, todayKey });

    // Current prices, from the quote feed rather than from the research.
    if (key) {
      await Promise.all(checked.trades.map(async (r) => {
        if (r.instrument !== 'stock') return;
        const q = await quote(key, r.ticker, Date.now()).catch(() => null);
        if (q && q !== 'over' && Number.isFinite(q.last)) { r.priceNow = q.last; r.priceAt = new Date(); }
      }));
    }

    // Filing, in the order that can never leave him with no board: the new
    // ideas are written first, then the state points at them, and only then
    // does every idea still open from the last run give way. A trade he took
    // is never retired here: only PROFIT or LOSS moves it.
    const own = await mine();
    if (own === false) return superseded('filing');
    const filed = await fileRecs(env, run, checked.trades, { caseId: settings.caseId || '' });
    const finishedAt = new Date();
    const finalPatch = {
      run: { ...run, status: 'idle', finishedAt, heartbeatAt: finishedAt, done: got.length, error: null, count: checked.trades.length, ms: finishedAt.getTime() - ms(run.startedAt || t0) },
      desk: { runId: run.id, at: finishedAt, trigger: run.trigger || 'manual', read: checked.read, none: checked.none, news: checked.news, count: checked.trades.length, reports: got.length, ids: filed.ids },
    };
    let wrote = false;
    for (let i = 0; i < 3 && !wrote; i++) {
      const d = i === 0 && own ? own : await mine();
      if (d === false) return superseded('final write');
      wrote = await patchDoc(env, STATE_PATH, finalPatch, d ? { mask: ['run', 'desk'], ifUpdateTime: d.updateTime } : { mask: ['run', 'desk'] }) !== false;
    }
    if (!wrote) throw new Error('the board could not be saved');
    const expired = await retireRecs(env, doc0?.data?.desk?.ids || [], filed.ids);

    // The push: always for the 7:00 run, and for his own run when there is something to take.
    let pushed = false;
    if (env.ADMIN_UID && settings.pushOn !== false && (run.trigger === 'morning' || checked.trades.length)) {
      const names = checked.trades.slice(0, 3).map((r) => `${r.ticker} ${r.side}`).join(', ');
      const body = checked.trades.length
        ? `${run.trigger === 'morning' ? '7:00 desk: ' : ''}${checked.trades.length} trade${checked.trades.length === 1 ? '' : 's'} ready. ${names}${checked.trades.length > 3 ? ' and more' : ''}.`
        : `${run.trigger === 'morning' ? '7:00 desk: ' : ''}nothing worth taking yet.`;
      await push(env, env.ADMIN_UID, { title: 'PR 420', body, link: '/admin-desk.html' }).catch(() => {});
      pushed = true;
    }
    await diagLog(env, {
      ev: 'desk-run-end', ok: true, trigger: run.trigger || 'manual', attempt: run.attempt || 1, reports: got.length,
      trades: checked.trades.length, dropped: checked.dropped, expired, news: checked.news.length, pushed,
      agents, desk: { ms: decided.ms, st: decided.stop, in: decided.usage?.input_tokens, out: decided.usage?.output_tokens },
      ms: Date.now() - t0,
    }).catch(() => {});
    return { ok: true, trades: checked.trades.length, reports: got.length };
  } catch (err) {
    console.error('desk run:', err?.stack || err);
    const why = `The desk run failed: ${friendly(err)}. Tap RUN TRADING DESK to try again.`;
    await setRun({ status: 'error', error: why, finishedAt: new Date() });
    await diagLog(env, { ev: 'desk-run-end', ok: false, err: friendly(err).slice(0, 140), ms: Date.now() - t0 }).catch(() => {});
    return { ok: false, why };
  } finally {
    alive = false;
    clearTimeout(beatTimer);
    if (wake) wake();
    await beat;
  }
}

/** Writes the new ideas, each with the time it stops being worth taking. */
async function fileRecs(env, run, trades, { caseId = '' } = {}) {
  const now = new Date();
  const ids = [];
  for (const t of trades) {
    const id = rid('rec_');
    await patchDoc(env, `${PLAYS}/${id}`, {
      ...t, id, caseId, runId: run.id, at: now, slot: mtLabel(now.getTime()), status: 'open',
      expiresAt: recExpiry(t.horizon, { holdDays: t.holdDays || 2, now: now.getTime(), contractExpiry: t.instrument === 'stock' ? null : t.expiry }),
      tookAt: null, closedAt: null, result: null,
    });
    ids.push(id);
  }
  return { ids };
}

/**
 * Retires the last run's ideas he did not take, once the new board is saved.
 * Best effort: an idea that stays open here is off the board anyway, because
 * the board is found by the new run's ids. The ids ride trade/state, so this
 * reads six documents rather than listing a collection that grows every day.
 */
async function retireRecs(env, previous, keep = []) {
  let expired = 0;
  const now = new Date();
  for (const id of (Array.isArray(previous) ? previous : []).slice(0, 20)) {
    if (keep.includes(id)) continue;
    const d = await tryGet(env, `${PLAYS}/${id}`).catch(() => null);
    if (!d || d === READ_FAILED || d.data?.status !== 'open') continue;
    const won = await patchDoc(env, `${PLAYS}/${id}`, { status: 'expired', expiredAt: now }, { mask: ['status', 'expiredAt'], ifUpdateTime: d.updateTime }).catch(() => false);
    if (won !== false) expired++;
  }
  return expired;
}

/**
 * THE 7:00 RUN (Eric, 2026-09-23: "The Trading Desk automatically performs its
 * full market scan once per trading day at 7:00 AM Mountain Time. That remains
 * the ONLY automatic scheduled run."). Half an hour before the open, on a
 * trading day, once: the day is claimed under a precondition so two isolates
 * in the same minute cannot both queue it. It only queues; the drain runs it.
 */
export const MORNING_MIN = 7 * 60;
export const MORNING_WINDOW_MIN = 30;
export async function maybeMorningRun(env, { now = Date.now() } = {}) {
  // The clock first: outside the half hour this costs no read at all.
  const { dateKey, minuteOfDay } = mtParts(now);
  if (!isTradingDay(dateKey)) return { ran: false, why: 'not a trading day' };
  if (minuteOfDay < MORNING_MIN || minuteOfDay >= MORNING_MIN + MORNING_WINDOW_MIN) return { ran: false, why: 'not the hour' };
  const settings = await readSettings(env);
  if (!settings.caseId) return { ran: false, why: 'no desk' };
  const doc = await tryGet(env, STATE_PATH);
  if (doc === READ_FAILED) return { ran: false, why: 'state unreadable' };
  if (doc?.data?.morningDay === dateKey) return { ran: false, why: 'already ran' };
  // A run of his still going: wait for it inside the window rather than
  // spend the day's 7:00 run on it.
  if (runAlive(doc?.data?.run, now)) return { ran: false, why: 'a run is going' };
  // The day's stamp and the queued run land in ONE write, so the stamp can
  // never be set without the run it stands for.
  const next = { id: rid('run_'), status: 'queued', trigger: 'morning', queuedAt: new Date(now), attempt: 0, done: 0, error: null };
  const mask = ['morningDay', 'morningAt', 'run'];
  const claimed = await patchDoc(env, STATE_PATH, { morningDay: dateKey, morningAt: new Date(now), run: next },
    doc ? { mask, ifUpdateTime: doc.updateTime } : { mask, mustNotExist: true }).catch(() => false);
  if (claimed === false) return { ran: false, why: 'another isolate claimed it' };
  await diagLog(env, { ev: 'desk-run-queued', trigger: 'morning' }).catch(() => {});
  return { ran: true, day: dateKey, already: false, run: next };
}
