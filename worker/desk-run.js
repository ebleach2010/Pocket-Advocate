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
// written the moment it lands, and a run whose claim is older than any one
// firing can take (STALE_MS) is claimed by the next firing and resumed:
// reports already in are reused, only the missing ones re-run, and the desk
// decides as soon as enough are in.
//
// FIFTY OUTSIDE CALLS (measured in production, 2026-09-23). One invocation
// may make fifty requests to anything outside the Worker (the database, the
// provider, the quote feed, a push), then every further one throws. The first
// day's runs spent them all partway through research, after which not even
// the error could be saved, so the 7:00 run died three times without a word.
// So a run is two firings, each well inside the fifty: the research in one,
// the desk's decision in the next, which starts with its own fifty. Nothing
// beats a heartbeat (a claim's age is the liveness), the database is read and
// written in batches, the market data is fetched once and stored with the
// research, and a researcher that fails is not retried inside the firing.
// desk.mjs counts every call on the worst path of each firing (D24).

import { tryGet, patchDoc, batchGetDocs, batchWrite, READ_FAILED } from './firestore.js';
import { client, diagLog } from './advisor.js';
import { notifyUser } from './push.js';
import {
  SETTINGS_PATH, STATE_PATH, PLAYS, SAY, stripDashes, mtParts, mtInstant, mtLabel, watchlistOf, resolveKey,
  marketSnapshot, quoteCached, rid, realDate,
  resolveBars, fetchBars, chartsOf, chartsBlock, chartLine, BARS_MAX_SYMBOLS,
  fetchScanner, scanTickers, moversBlock,
} from './trade-desk.js';
import { isTradingDay, isMarketOpen, swingLastDay, nextDateKey, EARLY_CLOSE_MIN, MARKET_CLOSE_MIN, MARKET_OPEN_MIN, positionKey, screenTrades, GLP1_CHAIN, HIGH_RISK_PCT, HIGH_RISK_FLOOR, isFund } from '../public/js/trade-math.js';

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
// RAISED 2026-09-25 (v7.18): all five used every one of five, finding movers the scan now hands them.
// The slowest took 140 seconds of its 200; two more searches go to catalysts.
export const RESEARCH_SEARCHES = 7;
export const RESEARCH_MAX_TOKENS = 32_000;
export const DESK_MAX_TOKENS = 32_000;
// SHORT TURNS, ON PURPOSE (2026-09-23). In August two streamed turns died
// inside this same awaited cron drain, one 184 seconds in, and the cause was
// never settled (the flight recorder saw the deaths, not the reason). So no
// turn here is allowed to run long: a researcher is cut at a little over
// three minutes and the desk likewise, and the desk's decision always goes to
// the next minute's firing (FIFTY OUTSIDE CALLS, above). Reports already in
// are never lost either way.
export const RESEARCH_BUDGET_MS = 200_000;
export const DESK_BUDGET_MS = 200_000;
// Thinking summaries stream as they are written, so bytes keep flowing on a
// long think instead of a silent connection carrying nothing but pings.
export const THINKING = { type: 'adaptive', display: 'summarized' };
// His rule (Eric, 2026-09-23: "3% risk rule."): a stopped-out trade costs at
// most three percent of the balance. Settings can change it.
export const DEFAULT_RISK_PCT = 3;
// A firing's work is capped well under this (research at RESEARCH_BUDGET_MS,
// the desk at DESK_BUDGET_MS, a few writes either side), so a claim older
// than it belongs to an invocation that died.
export const STALE_MS = 6 * 60_000;
// The ceiling one invocation has, and the most devices a desk push tries.
export const CALL_CAP = 50;
export const PUSH_MAX = 3;
export const RUN_GIVE_UP_MS = 45 * 60_000;
export const MAX_ATTEMPTS = 3;
export const MIN_REPORTS = 2;
// Nine, three of each kind (Eric, 2026-09-25, chose "Up to 9"), and the high-risk trade beside them.
export const MAX_TRADES = 9;
export const MAX_PER_HORIZON = 3;
export const MAX_NEWS = 6;
// HIS BAR (Eric, 2026-09-23: "It should suggest anything over a 50% profit for a scalp, intraday,
// swing, for stocks and options. So three possible trades if they're there"). A trade reaches him
// when the low end of the desk's honest chance of its first target before its stop is above this,
// and never when it is not. The desk is told to find the best of each kind that clears it.
// LOWERED 2026-09-25 (v7.18): the last run filed nothing at 50, and he chose "Lower to 45%".
export const CHANCE_FLOOR = 45;
export const MAX_CONTINUES = 1;
export const RESEARCH_PATH = 'trade/research';
export const WEB_SEARCH = { type: 'web_search_20260209', name: 'web_search', max_uses: RESEARCH_SEARCHES };
// The four index funds ride every run, so every researcher and the desk see
// the same tape. Four, not his watchlist and the sector funds as well: each
// quote is one of the fifty calls. The researchers search for the rest, and
// his watchlist goes to them by name.
export const MARKET_TICKERS = ['SPY', 'QQQ', 'IWM', 'DIA'];
/**
 * THE GLP-1 CHAIN (Eric, 2026-09-24: "I want GLp-1 pipeline stocks added to the search. Including
 * HIMs. But from production to development to distribution and sellers."). Named, not priced: a name
 * costs none of the fifty calls. Every researcher and the desk read it in the market note.
 */
// THE RE-CHECK (Eric, 2026-09-24: "If a new run disagrees with a strategy still on the table (0/5
// agents agree), then it is removed. If some agents still agree, update with the new number of
// agreeing agents."). Every run shows the five researchers the desk's own calls he took, as the desk
// filed them: the ticker, the kind, the entry, stop and targets, the setup. Never his size, his fill,
// a result, his balance or anything closed. Each researcher says backs or does not back, and the count
// is taken from their words, not asked of the desk.
export const LIVE_MAX = 12;
const HWORD = { scalp: 'scalp', intraday: 'intraday', swing: 'swing' };
/** What closing a trade he holds is called: buying back a short stock is a cover, the rest is a sale. */
export const exitWord = (r) => (r?.instrument === 'stock' && r?.side === 'short' ? 'Cover' : 'Sell');
export function liveNote(rows) {
  if (!Array.isArray(rows) || !rows.length) return '';
  const lines = rows.map(({ ref, rec: r }) => {
    const vehicle = r.instrument === 'call' || r.instrument === 'put'
      ? `the ${r.strike ?? ''} ${r.instrument} expiring ${r.expiry || 'soon'}, prices are the premium`.replace(/\s+/g, ' ')
      : 'the stock';
    const lo = fin(r.entryLow); const hi = fin(r.entryHigh);
    const entry = lo != null && hi != null && lo !== hi ? `${lo} to ${hi}` : `${lo ?? fin(r.entry) ?? hi ?? 'unknown'}`;
    const targets = (Array.isArray(r.targets) ? r.targets : []).map(fin).filter((x) => x != null).join(' then ') || 'none';
    const filed = r.at ? ` Filed ${mtParts(new Date(r.at).getTime()).dateKey}.` : '';
    return `${ref}: ${r.ticker} ${r.side === 'short' ? 'short' : 'long'} ${HWORD[r.horizon] || 'intraday'}, ${vehicle}. Entry ${entry}, stop ${fin(r.stop) ?? 'none'}, targets ${targets}.${filed}${r.setup ? ` Setup: ${r.setup}` : ''}${r.invalidation ? ` Out if: ${r.invalidation}` : ''}`;
  });
  return `Earlier calls from this desk that are still live. Re-check each one on what you see now and give your verdict under Earlier calls. This is apart from the candidates you bring.\n${lines.join('\n')}`;
}
/**
 * One report's verdicts on the earlier calls (v7.13: "When I'm told to hold, add, trim, or sell"):
 * { E1: 'hold', E2: 'sell' }. The 7.10 words still read: backs is a hold, does not back is a sell.
 * A ref with no plain verdict is left out.
 */
export const CALLS = ['hold', 'add', 'trim', 'sell'];
export function earlierVerdicts(text) {
  const out = {};
  const after = String(text || '').split(/^#{2,3}\s*Earlier calls:?\s*$/im)[1];
  if (after == null) return out;
  for (const line of after.split(/^#{2,3}\s/m)[0].split('\n')) {
    const x = line.match(/^\s*(?:[-*]\s*)?[*_]*\s*(E\d{1,2})\b[*_]*\s*[:.)-]?\s*[*_]*\s*(.*)$/i);
    if (!x) continue;
    const ref = x[1].toUpperCase();
    if (ref in out) continue;
    const v = x[2].toLowerCase().replace(/^[*_]+/, '');
    if (/^(does not|doesn't|do not|don't|no longer|not|no|sell|exit|close|cover)\b/.test(v)) out[ref] = 'sell';
    else if (/^(trim|reduce|scale (?:back|down))\b/.test(v)) out[ref] = 'trim';
    else if (/^(add|buy more|increase)\b/.test(v)) out[ref] = 'add';
    else if (/^(hold|keep|still backs?|backs?|yes)\b/.test(v)) out[ref] = 'hold';
  }
  return out;
}
/**
 * Each earlier call's votes (v7.13): every researcher's own word by number, null for one that did not
 * report or said nothing plain on it, and the count for each of the four. `reports` is [{ n, text }].
 */
export function tallyEarlier(live, reports) {
  const read = (reports || []).map((r, i) => (typeof r === 'string' ? { n: i + 1, v: earlierVerdicts(r) } : { n: r.n, v: earlierVerdicts(r.text) }));
  return (Array.isArray(live) ? live : []).map(({ ref, id }) => {
    const votes = Object.fromEntries(LENSES.map((L) => [L.n, read.find((x) => x.n === L.n)?.v[ref] || null]));
    const counts = Object.fromEntries(CALLS.map((c) => [c, Object.values(votes).filter((x) => x === c).length]));
    return { ref, id, votes, counts };
  });
}
/**
 * HOLD, ADD, TRIM OR SELL (Eric, 2026-09-24: "tell me if I should hold or if things have changed and I
 * need to sell, front and center", and "When I'm told to hold, add, trim, or sell, I need to know what
 * agents and how many agree"). The desk makes the call from the five votes and the market, and its call
 * is final (v7.14, Eric: "if all the agents report to the 6th agent shouldn't he have the final call?").
 * Only with no call from the desk does the vote decide: the most-voted of the four wins, and a tie or
 * silence gives no new call, leaving the last one standing.
 */
export function callFor(t, desk = null) {
  const says = (c) => `${t.counts[c]} of 5 say ${c}.`;
  if (desk && CALLS.includes(desk.call)) return { call: desk.call, why: desk.why || says(desk.call) };
  const ranked = CALLS.map((c) => [c, t.counts[c]]).sort((a, b) => b[1] - a[1]);
  if (!ranked[0][1] || ranked[0][1] === ranked[1][1]) return null;
  return { call: ranked[0][0], why: says(ranked[0][0]) };
}
/** What he has to act on first: a sell, then a trim, then an add, then a hold. */
export const URGENCY = { sell: 0, trim: 1, add: 2, hold: 3 };

export function chainNote(chain = GLP1_CHAIN) {
  const groups = chain.map((g) => `${g.role}: ${g.tickers.join(', ')}.`).join(' ');
  return `The GLP-1 chain, which he wants searched on every run, from the makers to the sellers. ${groups} Look at it on every run beside everything else on your beat. News in one link often moves the others: a trial readout moves the other developers, and a price cut, a supply problem or a new seller deal moves the makers, the suppliers and the sellers. A search or two across the chain is usually enough to see what is moving in it. It is a place to look, not a quota: a trade from it clears the same bar as any other.`;
}
const TICKER_RE = /^[A-Z][A-Z.]{0,5}$/;
/**
 * The tickers the researchers brought as candidates, read off each report's Candidates section
 * ("Ticker: NVDA"), in order and once each, so the desk gets their 15-minute charts (v7.15). Pure.
 */
export function candidateTickers(texts) {
  const out = [];
  for (const text of texts || []) {
    const part = String(text || '').split(/^#{2,3}\s*Candidates:?\s*$/m)[1];
    if (part == null) continue;
    const body = part.split(/^#{2,3}\s/m)[0];
    for (const m of body.matchAll(/^\s*(?:[-*]\s*)?[*_]*[Tt]icker[*_]*\s*:[*_]*\s*[*_]*\$?([A-Z][A-Z.]{0,5})\b/gm)) {
      if (TICKER_RE.test(m[1]) && !out.includes(m[1])) out.push(m[1]);
    }
  }
  return out;
}

// ---- the five beats ------------------------------------------------------------
export const LENSES = [
  {
    n: 1, key: 'tape', name: 'Momentum and the tape',
    beat: 'Start from the market scan: the top gainers, losers and most active stocks. Price action right now: premarket and intraday movers, relative volume, VWAP holds and losses, EMA structure (9, 20, 50), opening range breaks, and breakouts and breakdowns with real volume behind them. Your natural horizon is scalps and intraday trades. When the message carries 15-minute charts, read VWAP, the 9, 20 and 50 EMAs and the MACD from them rather than searching: they are worked out from the bars, and your searches are better spent on what is moving.',
  },
  {
    n: 2, key: 'catalysts', name: 'Catalysts',
    beat: 'Why the stocks on the market scan are moving, and what else is moving specific stocks today and this week: earnings reported overnight or due today and after the close, guidance changes, analyst upgrades, downgrades and target changes, SEC filings (8-K, S-1 and offerings, 13D, clusters of Form 4 insider buying or selling), FDA and legal decisions, contracts, mergers. Every horizon.',
  },
  {
    n: 3, key: 'macro', name: 'Macro and sectors',
    beat: 'The index trend (SPY, QQQ, IWM), sector strength and rotation, today\'s and this week\'s macro calendar (Fed speakers, CPI, PPI, jobs, GDP), rates and yields, the dollar, oil, and volatility. Tell the desk which direction the tape favors and which sectors lead or lag, including the sectors behind the stocks on the market scan, and bring the strongest leading and weakest lagging stocks in them as candidates, never the funds themselves.',
  },
  {
    n: 4, key: 'swing', name: 'Swing structure',
    beat: 'Daily and weekly charts, starting with the stocks on the market scan and the leaders of the strongest sectors: bases, pullbacks to rising moving averages, reclaimed levels, multi-day support and resistance, gaps to fill, and relative strength against the index over weeks. Your natural horizon is swing trades of up to three trading days that are out before the weekend; say what would stop one out overnight.',
  },
  {
    n: 5, key: 'options', name: 'Options, volatility and risk',
    beat: 'Options on the stocks on the market scan first. Unusual options activity and large directional flow, implied volatility and what the options market expects a stock to move, liquidity and spreads, short interest and squeeze risk, and the risk and reward of the day\'s most crowded names. Also the traps: names that look good and are not.',
  },
];

// ---- the prompts -----------------------------------------------------------------
const accountRule = (type) => (type === 'margin'
  ? 'His account is a margin account: short stock is allowed when borrow and liquidity are normal.'
  : 'His account is a cash account, so he cannot short stock: a bearish view can only be a put, or it is skipped.');

export function researchSystem(accountType) {
  return `You are a researcher on PR 420, a small proprietary trading desk that serves one trader, Eric. He trades his own account from his phone and has no time to read research: he opens the app, sees a handful of trades, takes one or ignores it. Five researchers look at the market independently and a sixth, the desk, reads all five reports and makes the final calls. You are one of the five. You will not see the other reports and nobody reads yours except the desk, so write for a colleague who will check your work against four others: facts with their source and time, candidates the desk can act on, and a clear line between what you verified and what you think.

What the desk needs from you:
- The strongest opportunities your beat turns up right now, across scalps (held 1 to 10 minutes), intraday trades (held 1 to 8 hours and flat by the close) and swing trades (held up to 3 trading days and never over a weekend). Bring every candidate you honestly rate above ${CHANCE_FLOOR}% to reach its first target before its stop, the low end of your range, in every horizon your beat covers and in stocks and options alike: he sees every trade that clears that bar. None is still the right answer for a horizon where nothing clears it.
- For every candidate: the ticker, long or short, scalp, intraday or swing, the last price with its time and where it came from, an entry zone, a stop, one or two targets, the expected hold, the setup in one sentence, the catalyst, what would invalidate it, and your honest chance, as a range such as 55 to 62, that it reaches the first target before the stop.
- Your one best high-risk, high-reward idea, if your beat has one, marked High risk: yes. Usually an option, or a lower-cap stock with room to run whose sensible size would risk more than his usual rule. It still needs an honest chance of at least ${HIGH_RISK_FLOOR}% to reach its first target before its stop, and everything else a candidate needs.
- The names you looked at and rejected, one line each, with the reason. The desk uses these to settle disagreements.
- Anything outside your beat that would materially change a trade, such as a halt, an offering, or a macro release in the next hour.

Hard rules:
- Never invent a price, a level, a headline or a number. Every price comes from the market data in the message or from a search you ran today, and you say which. If you cannot confirm a current price, say so and mark the candidate unconfirmed.
- Stocks and options on stocks only. Index, sector, leveraged and volatility funds (SPY, QQQ, IWM, the XL funds, TQQQ, SOXL and the like) tell you where the market is; they are never a candidate.
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
Anything outside your beat that changes a trade, or Nothing.
## Earlier calls
One line for each earlier call the message lists, as E1: hold, E1: add, E1: trim or E1: sell, then a few words why. Hold: still worth holding as it is, to its targets with its stop where it is. Add: stronger now and worth more size. Trim: still right but worth less size, because the risk grew or the first target is close. Sell: what it was built on has broken, or the stop now looks likelier than the target. Write None when the message lists none.`;
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
- Stocks and options on stocks only (Eric: "There are so many stocks with trading opportunities."). Index, sector, leveraged and volatility funds read the market and are never a trade, the high-risk trade included; the app drops any. The market scan in the message is where the day's moves are: look there first.
- The 15-minute charts, when the message has them, are worked out from real bars. For a scalp or an intraday trade, set the entry and the stop against VWAP and the 9, 20 and 50 EMAs, and be slow to go long below VWAP with the EMAs stacked down, or short above VWAP with them stacked up, unless the catalyst is decisive. Use them on the earlier calls too.
- His bar: he wants every trade whose honest chance of reaching the first target before the stop is above ${CHANCE_FLOOR}%, which means chanceLow of at least ${CHANCE_FLOOR + 1}. Give him the best trade in each of the three kinds, scalp, intraday and swing, stock or option, whenever one clears that bar, and a second and third in a kind whenever they clear it too. Leave a kind empty only when nothing in it clears the bar, and never raise a number to clear it: the app drops anything at ${CHANCE_FLOOR}% or below.

Limits:
- At most ${MAX_TRADES} trades and at most ${MAX_PER_HORIZON} of each kind, and never the same ticker twice in the same direction and kind: one trade per position, in the vehicle that suits it best.
- Scalps are held 1 to 10 minutes, intraday trades 1 to 8 hours and flat by the close, swing trades up to 3 trading days and never over a weekend. Give holdMinutes for a scalp or intraday trade and holdDays for a swing.
- Scalps only while the market is open or within an hour of the open.
- ${accountRule(accountType)}
- Options only when clearly better than the stock and liquid. For an option, entry, stop and targets are premium prices per share, lastPrice is the premium, and strike and expiry (YYYY-MM-DD) name the contract.
- For a long, the stop is below the entry zone and the targets above it; for a short stock, the reverse.

The high-risk trade (Eric: "Add exactly one stock per turn for high risk high reward. Usually options or high entry positions on lower cap stocks that exceed my 3% limit."): put exactly one trade in highRisk on every run. It is the best high-risk, high-reward trade the reports support: usually an option, or a lower-cap stock with room to run. It may risk up to ${HIGH_RISK_PCT}% of the account at its stop instead of his usual rule, and it needs an honest chanceLow of at least ${HIGH_RISK_FLOOR}. It is not one of the trades above, never the same position as one of them, and it does not count toward their limits. Leave highRisk empty only when nothing honest clears ${HIGH_RISK_FLOOR}%, and never raise a number to clear it.

Sizing: allocPct is the share of his account you would put in this trade, from 1 to 50. The app turns it into dollars and shares from his balance and caps it so a stopped-out trade costs no more than ${riskPct}% of the account (${HIGH_RISK_PCT}% for the high-risk trade), so you do not do that arithmetic. Set stops where the trade is actually wrong, not where the size looks good.

What he reads has to fit on a phone card at a glance. setup is one sentence under 25 words, catalyst under 15 words, invalidation under 20 words. Plain English with no jargon he would have to decode, and never an em dash or an en dash. chanceLow and chanceHigh are your honest range, in percent, that the first target is reached before the stop. backers are the researchers, by number 1 to 5, who independently brought or supported the trade, and doubters are the ones who rejected it or argued against it; a researcher is in one list or neither, never both. agreement is how many backers there are.

read is one sentence on what the tape is doing. none is one sentence on why there are no trades, or an empty string when there are some.

holdings: the market data may list earlier calls from this desk that are still live, as E1, E2 and so on, and each researcher gave a verdict on them under Earlier calls. For each one give its ref, call hold, add, trim or sell, and why: one plain sentence under 20 words he can act on. Sell when what the trade was built on has broken, its catalyst has turned, or the evidence now says the stop comes before the target. Trim when it is still right but worth less size. Add when it is stronger now and worth more size. Hold otherwise. Weigh the researchers' verdicts the way you weigh their candidates. An empty list when the market data lists none.

news is up to ${MAX_NEWS} items that matter for trading today, each with the tickers it touches and one sentence on why it matters. Not general financial news: only what could change a trade.`;
}

const NUM = { type: 'number' };
const NULL_NUM = { anyOf: [{ type: 'number' }, { type: 'null' }] };
const NULL_STR = { anyOf: [{ type: 'string' }, { type: 'null' }] };
const TRADE_ITEM = {
  type: 'object',
  additionalProperties: false,
  required: ['ticker', 'side', 'horizon', 'instrument', 'lastPrice', 'entryLow', 'entryHigh', 'stop', 'targets',
    'holdMinutes', 'holdDays', 'allocPct', 'chanceLow', 'chanceHigh', 'setup', 'catalyst', 'invalidation',
    'strike', 'expiry', 'agreement', 'backers', 'doubters'],
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
    backers: { type: 'array', items: { type: 'integer' } },
    doubters: { type: 'array', items: { type: 'integer' } },
  },
};
export const DESK_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['read', 'none', 'trades', 'highRisk', 'news', 'holdings'],
  properties: {
    read: { type: 'string' },
    none: { type: 'string' },
    trades: { type: 'array', items: TRADE_ITEM },
    // The one high-risk trade (Eric, 2026-09-25): none, or one, in its own list.
    highRisk: { type: 'array', items: TRADE_ITEM },
    holdings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['ref', 'call', 'why'],
        properties: {
          ref: { type: 'string' },
          call: { type: 'string', enum: ['hold', 'add', 'trim', 'sell'] },
          why: { type: 'string' },
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
export async function liveTurn(env, body, { signal, maxContinues = MAX_CONTINUES, maxRetries = 0, call = null } = {}) {
  const send = call || ((b) => client(env).messages.create({ ...b, stream: true }, { signal, maxRetries }).asResponse());
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
export function validRec(t, { accountType = 'cash', session = null, todayKey = null, highRisk = false } = {}) {
  if (!t || typeof t !== 'object') return null;
  const ticker = String(t.ticker || '').trim().toUpperCase();
  if (!TICKER_RE.test(ticker)) return null;
  // Stocks and their options only (v7.18): a fund is never a trade.
  if (isFund(ticker)) return null;
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
  // His bar: nothing at or below it reaches him, and a trade with no chance given cannot clear it. The
  // high-risk trade has its own, lower one (Eric chose "Needs 40%+"): at least HIGH_RISK_FLOOR.
  if (!chanceOk || (highRisk ? cLo < HIGH_RISK_FLOOR : cLo <= CHANCE_FLOOR)) return null;
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
    strike, expiry, ...stanceOf(t),
    ...(highRisk ? { highRisk: true } : {}),
  };
}
/**
 * Who is for and who is against a new trade (v7.13: "They are listed for and against"), by researcher
 * number. A number outside 1 to 5, or one in both lists, is dropped from both; the count is the backers
 * when the desk named them, else the number it gave.
 */
export function stanceOf(t) {
  const nums = (a) => [...new Set((Array.isArray(a) ? a : []).map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= LENSES.length))];
  const b0 = nums(t?.backers); const d0 = nums(t?.doubters);
  const both = b0.filter((x) => d0.includes(x));
  const backers = b0.filter((x) => !both.includes(x)).sort((a, b) => a - b);
  const doubters = d0.filter((x) => !both.includes(x)).sort((a, b) => a - b);
  const agreement = backers.length ? backers.length : Math.min(5, Math.max(0, Math.round(fin(t?.agreement) ?? 0)));
  return { agreement, backers, doubters };
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
    // One trade per position (Eric, 2026-09-24: "I got the same position given to me twice"):
    // a ticker in one direction and one kind, whatever the vehicle.
    const key = positionKey(r);
    if (seen.has(key) || perKind[r.horizon] >= MAX_PER_HORIZON || trades.length >= MAX_TRADES) { dropped++; continue; }
    seen.add(key); perKind[r.horizon]++;
    trades.push(r);
  }
  // THE HIGH-RISK TRADE (Eric, 2026-09-25): exactly one at most, the first that clears its own bar and
  // is not a position already on the list. It rides beside the six, never in their place.
  for (const t of Array.isArray(out?.highRisk) ? out.highRisk : []) {
    const r = validRec(t, { ...ctx, highRisk: true });
    if (!r || seen.has(positionKey(r)) || trades.some((x) => x.highRisk)) { dropped++; continue; }
    seen.add(positionKey(r));
    trades.push(r);
  }
  const news = (Array.isArray(out?.news) ? out.news : []).map((n) => ({
    headline: clip(n?.headline, 180),
    tickers: (Array.isArray(n?.tickers) ? n.tickers : []).map((x) => String(x).trim().toUpperCase()).filter((x) => TICKER_RE.test(x)).slice(0, 6),
    why: clip(n?.why, 220),
  })).filter((n) => n.headline).slice(0, MAX_NEWS);
  // The call on each earlier call, by its ref (v7.12). Anything but hold or sell on a real ref is left out.
  const holdings = {};
  for (const h of Array.isArray(out?.holdings) ? out.holdings : []) {
    const ref = String(h?.ref || '').trim().toUpperCase();
    if (!/^E\d{1,2}$/.test(ref) || ref in holdings || !CALLS.includes(h?.call)) continue;
    holdings[ref] = { call: h.call, why: clip(h?.why, 200) };
  }
  return { trades, news, read: clip(out?.read, 240), none: clip(out?.none, 240), dropped, holdings };
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

/** Whether a run is genuinely in flight: queued, or working under a claim younger than any firing can take. */
export function runAlive(run, now = Date.now()) {
  if (!run || !LIVE.has(run.status)) return false;
  if (run.status === 'queued' || run.status === 'decide') return now - ms(run.queuedAt || run.startedAt) < RUN_GIVE_UP_MS;
  // A firing's work is capped under STALE_MS, so a younger claim is being
  // worked on now; only an older one can be taken over or given up.
  return now - ms(run.claimedAt || run.heartbeatAt) < STALE_MS;
}

/** Whether the cron has something to do for the desk: a run to claim, to resume or to give up. */
export function deskClaimable(run, now = Date.now()) {
  if (!run || !LIVE.has(run.status)) return false;
  return run.status === 'queued' || run.status === 'decide' || !runAlive(run, now);
}

/**
 * The firing's first look (2026-09-23): one read, before anything else runs,
 * so a firing that hosts the desk can leave its per-minute chores to the next
 * one and give the run its fifty calls. Answers the state document when there
 * is desk work, else null.
 */
export async function peekDesk(env, { now = Date.now() } = {}) {
  const doc = await tryGet(env, STATE_PATH);
  if (!doc || doc === READ_FAILED) return null;
  return deskClaimable(doc.data?.run, now) ? doc : null;
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
 * The cron's one call. Claims a queued run, or resumes one whose claim went
 * stale, and runs that one firing's share of it (the research, or the desk's
 * decision) inside this invocation. Returns true when it did desk work, so
 * the firing leaves the case drain to the next minute: what remains of its
 * fifty calls is not enough to promise a case read. `doc` is the state the
 * firing's first look already read, so it is not read twice.
 */
export async function maybeRunDesk(env, { deadlineAt, now = Date.now(), doc: seen = null, deps = {} } = {}) {
  let doc = seen;
  if (!doc) { try { doc = await readState(env); } catch { return false; } }
  const run = doc?.data?.run;
  if (!run || !LIVE.has(run.status)) return false;
  // Queued, and research handed to the desk, are claimed at once; a working
  // run only once its claim has gone stale.
  const ready = run.status === 'queued' || run.status === 'decide';
  if (!ready && runAlive(run, now)) return false;
  const age = now - ms(run.startedAt || run.queuedAt);
  // Attempts count invocations that died on it. A run handed to the desk
  // after its research is not a death, so it is never given up for that.
  if (age >= RUN_GIVE_UP_MS || (!ready && (Number(run.attempt) || 0) >= MAX_ATTEMPTS)) {
    const gave = await patchDoc(env, STATE_PATH, { run: { ...run, status: 'error', error: SAY.runStalled, finishedAt: new Date(now) } }, { mask: ['run'], ifUpdateTime: doc.updateTime }).catch(() => false);
    await diagLog(env, { ev: 'desk-run-end', ok: false, err: 'gave up', trigger: run.trigger || 'manual', attempt: run.attempt || 0 }).catch(() => {});
    if (gave !== false) await pushFailure(env, run, SAY.runStalled, { notifyUser: deps.notifyUser });
    return true;
  }
  const toDesk = run.status === 'decide' || run.status === 'deciding';
  const claimed = {
    ...run,
    phase: toDesk ? 'desk' : 'research',
    status: toDesk ? 'deciding' : 'researching',
    startedAt: run.startedAt || new Date(now),
    claimedAt: new Date(now), heartbeatAt: new Date(now),
    attempt: run.status === 'decide' ? Math.max(1, Number(run.attempt) || 0) : (Number(run.attempt) || 0) + 1, error: null,
  };
  const won = await patchDoc(env, STATE_PATH, { run: claimed }, { mask: ['run'], ifUpdateTime: doc.updateTime }).catch(() => false);
  if (won === false) return false;
  await executeRun(env, claimed, { deadlineAt, deps });
  return true;
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

/**
 * An error no retry can fix (2026-09-23, the day the account ran dry): the
 * account is out of credit, or the key is refused. Every researcher fails
 * the same way in a third of a second, and trying again only hides why.
 */
export function fatalOf(err) {
  const s = Number(err?.status);
  if (s === 400 && /credit balance/i.test(String(err?.message || ''))) return 'credit';
  if (s === 401 || s === 403) return 'key';
  return null;
}
const fatalSay = (f) => (f === 'credit' ? SAY.noCredit : f === 'key' ? SAY.keyRefused : null);

/** His risk per trade, in percent of the balance: his setting, else three. */
export function riskPctOf(settings) {
  const v = Number(settings?.riskPct);
  return Number.isFinite(v) && v >= 0.1 && v <= 5 ? Math.round(v * 100) / 100 : DEFAULT_RISK_PCT;
}

async function readSettings(env) {
  const doc = await tryGet(env, SETTINGS_PATH);
  return doc === READ_FAILED ? {} : (doc?.data || {});
}

/**
 * The 7:00 run always reaches his phone (Eric, 2026-09-23: "I didn't get a
 * 7am mst run/push for 420 like I asked"): a run that could not finish says
 * so, and why, instead of saying nothing. His own runs he is watching.
 */
async function pushFailure(env, run, why, { notifyUser: push = null } = {}, settings = null) {
  if (run?.trigger !== 'morning' || !env.ADMIN_UID) return false;
  const s = settings || await readSettings(env);
  if (s.pushOn === false) return false;
  await (push || notifyUser)(env, env.ADMIN_UID, { title: 'PR 420', body: `The 7:00 run did not finish. ${why}`, link: '/admin-desk.html', max: PUSH_MAX }).catch(() => {});
  return true;
}

/**
 * One firing's share of a run, after its claim: the research when the run is
 * in its research phase, the desk's decision when it has been handed over.
 * Exported for the checks, which hand it fakes through `deps`.
 */
export async function executeRun(env, run, { deadlineAt = Date.now() + 12 * 60_000, deps = {} } = {}) {
  const t0 = Date.now();
  const turn = deps.liveTurn || liveTurn;
  const snapshot = deps.marketSnapshot || marketSnapshot;
  const quote = deps.quoteCached || quoteCached;
  const bars = deps.fetchBars || fetchBars;
  const scanner = deps.fetchScanner || fetchScanner;
  const push = deps.notifyUser || notifyUser;
  const getMany = deps.batchGetDocs || batchGetDocs;
  const writeMany = deps.batchWrite || batchWrite;
  const settings = await readSettings(env);
  const accountType = settings.accountType === 'margin' ? 'margin' : 'cash';
  const key = resolveKey(env, settings);
  const barsKey = resolveBars(env, settings);
  const session = sessionLine(t0);
  const { dateKey: todayKey } = mtParts(t0);
  // OWNERSHIP (2026-09-23). Another invocation may have given this run up or
  // he may have queued a new one while this one worked. Every write below
  // first checks the slot still holds this run and this attempt; once it does
  // not, this invocation stops writing altogether, so an old attempt can never
  // overwrite a newer run.
  let lost = false;
  const mine = async () => {
    const d = await tryGet(env, STATE_PATH).catch(() => null);
    if (!d || d === READ_FAILED) return null;
    const r = d.data?.run;
    if (r && r.id === run.id && (Number(r.attempt) || 0) === (Number(run.attempt) || 0)) return d;
    lost = true;
    return false;
  };
  // `own` is a read already made that proved ownership, so it is not made twice.
  const setRun = async (fields, own = null) => {
    if (lost) return false;
    if (!own && await mine() === false) return false;
    return patchDoc(env, STATE_PATH, { run: fields }, { mask: Object.keys(fields).map((k) => `run.${k}`) }).catch(() => false);
  };
  const superseded = async (stage) => {
    await diagLog(env, { ev: 'desk-run-end', ok: false, err: `superseded at ${stage}`, attempt: run.attempt || 0, ms: Date.now() - t0 }).catch(() => {});
    return { ok: false, why: 'superseded' };
  };
  // Every way a run can end badly ends here: the sentence he reads, the
  // flight recorder, and for the 7:00 run the push.
  const fail = async (why, err, extra = {}, own = null) => {
    const wrote = await setRun({ status: 'error', error: why, finishedAt: new Date() }, own);
    await diagLog(env, { ev: 'desk-run-end', ok: false, trigger: run.trigger || 'manual', err: String(err || '').slice(0, 140), ...extra, ms: Date.now() - t0 }).catch(() => {});
    if (wrote !== false && !lost) await pushFailure(env, run, why, { notifyUser: push }, settings);
    return { ok: false, why };
  };
  try {
    // The research doc belongs to one run. A resumed run keeps what landed; a fresh one starts clean.
    const rdoc = await tryGet(env, RESEARCH_PATH);
    // A read that failed is not "no research": wiping the document would throw
    // away reports already paid for. The run goes back to be claimed again.
    if (rdoc === READ_FAILED) {
      await setRun({ status: run.phase === 'desk' ? 'decide' : 'queued' });
      await diagLog(env, { ev: 'desk-run-retry', err: 'research unreadable', attempt: run.attempt || 0 }).catch(() => {});
      return { ok: false, retry: true };
    }
    let prior = rdoc && rdoc.data?.runId === run.id ? rdoc.data : null;
    const reports = {};
    for (const L of LENSES) if (prior?.[`r${L.n}`]?.status === 'ok') reports[L.n] = prior[`r${L.n}`];

    if (run.phase !== 'desk') {
      // THE RESEARCH FIRING. The market is fetched once per run and kept with
      // the research, so the desk reads the same tape without paying again.
      if (typeof prior?.market !== 'string') {
        const snap = key ? await snapshot(key, MARKET_TICKERS, t0).catch(() => null) : null;
        let market = snapshotText(snap, { hasKey: !!key });
        const watch = watchlistOf(settings).filter((t) => !MARKET_TICKERS.includes(t) && !isFund(t)).slice(0, 25);
        if (watch.length) market += `\n\nHis watchlist, not priced here: ${watch.join(', ')}.`;
        market += `\n\n${chainNote()}`;
        // THE MARKET SCAN (v7.18): the day's gainers, losers and most active, before anything else is read.
        const scan = barsKey ? await scanner(barsKey).catch(() => ({ status: 'failed', gainers: [], losers: [], active: [] })) : { status: 'nokey', gainers: [], losers: [], active: [] };
        market += `\n\n${moversBlock(scan, { when: session.open ? 'live' : session.minsToOpen != null ? 'before' : 'after' })}`;
        // The calls he took, for the re-check: one read of the board's list and one of the trades.
        const st0 = await tryGet(env, STATE_PATH).catch(() => null);
        const liveIds = (Array.isArray(st0?.data?.activeIds) ? st0.data.activeIds : []).slice(0, LIVE_MAX);
        const liveDocs = liveIds.length ? await getMany(env, liveIds.map((id) => `${PLAYS}/${id}`)).catch(() => []) : [];
        const liveRows = liveIds.map((id, i) => ({ id, rec: liveDocs[i]?.data })).filter((x) => x.rec?.status === 'took').map((x, i) => ({ ...x, ref: `E${i + 1}` }));
        const live = liveRows.map(({ ref, id, rec }) => ({ ref, id, ticker: String(rec.ticker || '') }));
        if (liveRows.length) market += `\n\n${liveNote(liveRows)}`;
        // THE 15-MINUTE CHARTS (v7.15): the index funds, the trades he took and his watchlist, all in
        // one request, worked out here and handed to all five and the desk as numbers.
        // The movers get charts too (v7.18), after the funds and what he holds and before his watchlist:
        // the one request takes forty.
        const chartSyms = [...MARKET_TICKERS, ...liveRows.map((x) => x.rec.ticker), ...scanTickers(scan), ...watch];
        const bars15 = barsKey ? await bars(barsKey, chartSyms, t0).catch(() => ({ status: 'failed', bars: {} })) : { status: 'nokey', bars: {} };
        const block = chartsBlock(bars15, chartSyms, t0);
        if (block) market += `\n\n${block}`;
        const charts = bars15.status;
        const scanned = scan.status;
        const wrote = prior
          ? await patchDoc(env, RESEARCH_PATH, { market, live, charts, scanner: scanned }, { mask: ['market', 'live', 'charts', 'scanner'] }).catch(() => false)
          : await patchDoc(env, RESEARCH_PATH, { runId: run.id, at: new Date(), market, live, charts, scanner: scanned, r1: null, r2: null, r3: null, r4: null, r5: null }).catch(() => false);
        // A fresh run whose document could not be reset would file its
        // reports beside another run's: it goes back to be claimed again.
        if (wrote === false && !prior) {
          await setRun({ status: 'queued' });
          await diagLog(env, { ev: 'desk-run-retry', err: 'research not reset', attempt: run.attempt || 0 }).catch(() => {});
          return { ok: false, retry: true };
        }
        prior = { ...(prior || { runId: run.id }), market, live, charts, scanner: scanned };
      }
      const system = researchSystem(accountType);
      // A resumed run that already holds enough reports does not buy the missing ones twice.
      const left = LENSES.filter((L) => !reports[L.n]);
      const skipResearch = (Number(run.attempt) || 1) > 1 && Object.keys(reports).length >= MIN_REPORTS;
      const budget = Math.min(RESEARCH_BUDGET_MS, deadlineAt - Date.now() - 20_000);
      const agents = [];
      if (left.length && !skipResearch && budget >= 60_000) {
        // The five, in parallel, each written the moment it lands. No
        // retries inside the firing: two of five back is enough to decide.
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
              messages: [{ role: 'user', content: [{ type: 'text', text: `Your beat: ${L.name}. ${L.beat}\n\n${session.text}\n\n${prior.market}` }] }],
              tools: [WEB_SEARCH],
              thinking: THINKING,
              output_config: { effort: RESEARCH_EFFORT },
            }, { signal: ac.signal, maxContinues: MAX_CONTINUES, maxRetries: 0 });
            const text = stripDashes(out.text).slice(0, 12_000);
            row = text
              ? { status: 'ok', text, ms: Date.now() - a0, stop: out.message?.stop_reason || '', usage: out.usage, turns: out.turns, at: new Date() }
              : { status: 'failed', err: 'came back empty', ms: Date.now() - a0, stop: out.message?.stop_reason || '', usage: out.usage, at: new Date() };
          } catch (err) {
            row = { status: err?.refused ? 'refused' : 'failed', err: friendly(err), fatal: fatalOf(err), ms: Date.now() - a0, at: new Date() };
          } finally {
            clearTimeout(timer);
          }
          const saved = await patchDoc(env, RESEARCH_PATH, { [`r${L.n}`]: row }, { mask: [`r${L.n}`] }).catch(() => false);
          // Only a saved report counts: the desk reads them from the document in the next firing.
          if (row.status === 'ok' && saved !== false) reports[L.n] = row;
          agents.push({ n: L.n, ok: !!reports[L.n], ms: row.ms, s: row.usage?.searches ?? null, st: row.stop || row.err || '', fa: row.fatal || null });
        }));
      }
      const got = LENSES.filter((L) => reports[L.n]);
      const own = await mine();
      if (own === false) return superseded('research');
      if (got.length < MIN_REPORTS) {
        // Every researcher refused for the same reason no retry can fix: say that reason.
        const f = agents.length && agents.every((x) => x.fa && x.fa === agents[0].fa) ? agents[0].fa : null;
        return fail(fatalSay(f) || SAY.runThin, f ? `no credit or key: ${f}` : `reports ${got.length}`, { agents }, own);
      }
      // Research is in. The desk decides in the next firing, which starts
      // with its own fifty calls; the page says so meanwhile.
      await setRun({ status: 'decide', done: got.length, decideAt: new Date() }, own);
      await diagLog(env, { ev: 'desk-run-handoff', reports: got.length, agents, charts: prior?.charts || null, scanner: prior?.scanner || null, ms: Date.now() - t0 }).catch(() => {});
      return { ok: true, handedOff: true, reports: got.length };
    }

    // THE DESK FIRING.
    const got = LENSES.filter((L) => reports[L.n]);
    if (got.length < MIN_REPORTS) return fail(SAY.runThin, `desk saw ${got.length}`);
    const market = typeof prior?.market === 'string' ? prior.market : 'No market data was saved with this run.';
    const deskBudget = Math.max(60_000, Math.min(DESK_BUDGET_MS, deadlineAt - Date.now() - 10_000));
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), deskBudget);
    const d0 = Date.now();
    let decided;
    const reportText = got.map((L) => `### Researcher ${L.n}: ${L.name}\n${reports[L.n].text}`).join('\n\n');
    const missing = LENSES.filter((L) => !reports[L.n]).map((L) => L.name);
    // Fresh 15-minute charts for the trades he holds and every candidate the five named (v7.15), in
    // one request, so the desk sets entries and stops against VWAP and the EMAs as they stand now.
    const heldTickers = (Array.isArray(prior?.live) ? prior.live : []).map((x) => String(x?.ticker || '')).filter(Boolean);
    const deskSyms = [...new Set([...heldTickers, ...candidateTickers(got.map((L) => reports[L.n].text))])].slice(0, BARS_MAX_SYMBOLS);
    const c0 = Date.now();
    const fresh = !barsKey ? { status: 'nokey', bars: {} }
      : deskSyms.length ? await bars(barsKey, deskSyms, c0).catch(() => ({ status: 'failed', bars: {} })) : { status: 'ok', bars: {} };
    const charts = fresh.status === 'ok' ? chartsOf(fresh, c0) : {};
    const deskCharts = deskSyms.length ? chartsBlock(fresh, deskSyms, c0, { title: 'Fresh 15-minute charts for the trades he holds and the candidates the researchers named' }) : '';
    const chartOn = (ticker) => {
      const x = charts[String(ticker || '').toUpperCase()];
      const line = chartLine(x);
      return line ? { line, at: new Date(x.barAt) } : null;
    };
    const deskUser = `${session.text}\n\n${missing.length ? `These beats did not report this run: ${missing.join(', ')}.\n\n` : ''}The market data every researcher saw:\n${market}${deskCharts ? `\n\n${deskCharts}` : ''}\n\nThe five reports:\n\n${reportText}`;
    const deskBody = (structured) => ({
      model: DESK_MODEL,
      max_tokens: DESK_MAX_TOKENS,
      system: [{ type: 'text', text: deskSystem(accountType, riskPctOf(settings)) + (structured ? '' : '\n\nReturn only one JSON object with the fields read, none, trades, highRisk, news and holdings, and nothing else.') }],
      messages: [{ role: 'user', content: [{ type: 'text', text: deskUser }] }],
      thinking: THINKING,
      output_config: structured ? { effort: DESK_EFFORT, format: { type: 'json_schema', schema: DESK_SCHEMA } } : { effort: DESK_EFFORT },
    });
    try {
      let out;
      try {
        out = await turn(env, deskBody(true), { signal: ac.signal, maxContinues: 0, maxRetries: 1 });
      } catch (err) {
        // An account that cannot use structured output answers 400; the same call without it still works.
        if (Number(err?.status) !== 400 || !/output_config|format|schema/i.test(String(err?.message || ''))) throw err;
        out = await turn(env, deskBody(false), { signal: ac.signal, maxContinues: 0, maxRetries: 1 });
      }
      decided = { json: parseDesk(out.text), stop: out.message?.stop_reason || '', usage: out.usage, ms: Date.now() - d0 };
    } catch (err) {
      const why = fatalSay(fatalOf(err)) || `The desk could not decide: ${friendly(err)}. Tap RUN TRADING DESK to try again.`;
      return fail(why, `desk ${friendly(err)}`);
    } finally {
      clearTimeout(timer);
    }
    // Only an object with a trades list is an answer. Anything else, a bare
    // list or some other shape, would read as "nothing worth taking" and clear
    // his board, so it is refused the same way unreadable text is.
    if (!decided.json || typeof decided.json !== 'object' || Array.isArray(decided.json) || !Array.isArray(decided.json.trades)) {
      return fail('The desk answered in a shape the app could not read, so nothing changed. Tap RUN TRADING DESK to try again.', 'unreadable', { stop: decided.stop });
    }
    const checked = checkDesk(decided.json, { accountType, session, todayKey });

    // WHAT REACHES HIM (Eric, 2026-09-24: "The desk should only suggest new
    // positions or increasing equity in a position ... If denied, it doesn't
    // suggest that position to me again unless an additional agent agrees").
    // Screened here, after the desk has decided, against the trades he holds
    // and the ones he passed on, so nothing about him ever reaches an agent.
    // The ownership read comes first because it is also what is screened with.
    const own = await mine();
    if (own === false) return superseded('filing');
    const heldIds = (Array.isArray(own?.data?.activeIds) ? own.data.activeIds : []).slice(0, 40);
    const heldDocs = heldIds.length ? await getMany(env, heldIds.map((id) => `${PLAYS}/${id}`)).catch(() => []) : [];
    const held = heldDocs.filter((d) => d?.data?.status === 'took').map((d) => positionKey(d.data));
    const screened = screenTrades(checked.trades, { held, declined: own?.data?.declined || {} });
    checked.trades = screened.keep;

    // Each trade's 15-minute chart in a line, for the card.
    for (const r of checked.trades) { const c = chartOn(r.ticker); if (c) r.chart = c; }

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
    const previous = Array.isArray(own?.data?.desk?.ids) ? own.data.desk.ids : [];
    const filed = await fileRecs(env, run, checked.trades, { caseId: settings.caseId || '', writeMany });

    // THE RE-CHECK: each call he took that the researchers were shown, counted from their verdicts,
    // written under its own time so a PROFIT, a LOSS or a resize that lands in between wins.
    const tally = tallyEarlier(Array.isArray(prior?.live) ? prior.live : [], got.map((L) => ({ n: L.n, text: reports[L.n].text })));
    const heldById = new Map(heldIds.map((id, i) => [id, heldDocs[i]]));
    const recheckAt = new Date();
    const rechecks = [];
    for (const t of tally) {
      const doc = heldById.get(t.id);
      const d = doc?.data;
      if (!d || d.status !== 'took') continue;
      // No call (a tie, or nobody said), no change: the last call and count stand.
      const verdict = callFor(t, checked.holdings[t.ref]);
      if (!verdict) continue;
      // How many agree is now how many voted the call he is shown (v7.13).
      const count = t.counts[verdict.call];
      const recount = Number(d.agreement) !== count;
      const data = { tookAgreement: d.tookAgreement ?? d.agreement ?? null };
      if (recount) Object.assign(data, { agreement: count, agreedAt: recheckAt, agreedRunId: run.id });
      data.verdict = { call: verdict.call, why: verdict.why, at: recheckAt, runId: run.id, votes: t.votes };
      const c = chartOn(d.ticker);
      if (c) data.chart = c;
      rechecks.push({ id: t.id, d, recount, verdict, write: { path: `${PLAYS}/${t.id}`, data, mask: Object.keys(data), ifUpdateTime: doc.updateTime } });
    }
    const recheckOk = rechecks.length ? await writeMany(env, rechecks.map((x) => x.write)).catch(() => rechecks.map(() => false)) : [];
    const landed = rechecks.filter((x, i) => recheckOk[i]);
    const updated = landed.filter((x) => x.recount).length;
    // Sells first, then trims, adds and holds: what he has to act on leads.
    const verdicts = landed.map((x) => ({ ticker: x.d.ticker, horizon: x.d.horizon, side: x.d.side === 'short' ? 'short' : 'long', instrument: x.d.instrument || 'stock', call: x.verdict.call, why: x.verdict.why, agree: x.write.data.verdict.votes ? Object.values(x.write.data.verdict.votes).filter((v) => v === x.verdict.call).length : null }))
      .sort((a, b) => URGENCY[a.call] - URGENCY[b.call]);
    const finishedAt = new Date();
    const finalPatch = {
      run: { ...run, status: 'idle', finishedAt, heartbeatAt: finishedAt, done: got.length, error: null, count: filed.ids.length, ms: finishedAt.getTime() - ms(run.startedAt || t0) },
      desk: { runId: run.id, at: finishedAt, trigger: run.trigger || 'manual', read: checked.read, none: checked.none, news: checked.news, count: filed.ids.length, reports: got.length, ids: filed.ids, verdicts: verdicts.slice(0, 12), charts: fresh.status, scanner: ['ok', 'nokey', 'refused', 'failed'].includes(prior?.scanner) ? prior.scanner : null },
    };
    let wrote = false;
    for (let i = 0; i < 2 && !wrote; i++) {
      const d = i === 0 && own ? own : await mine();
      if (d === false) return superseded('final write');
      wrote = await patchDoc(env, STATE_PATH, finalPatch, d ? { mask: ['run', 'desk'], ifUpdateTime: d.updateTime } : { mask: ['run', 'desk'] }) !== false;
    }
    if (!wrote) throw new Error('the board could not be saved');
    const expired = await retireRecs(env, previous, filed.ids, { getMany, writeMany }).catch(() => 0);

    // The push: always for the 7:00 run, and for his own run when there is something to take.
    let pushed = false;
    const n = filed.ids.length;
    if (env.ADMIN_UID && settings.pushOn !== false && (run.trigger === 'morning' || n || verdicts.length)) {
      const names = checked.trades.slice(0, 3).map((r) => `${r.ticker} ${r.side}`).join(', ');
      const parts = [];
      // His trades first, sells before holds (v7.12): what he has to act on leads the push.
      const of = (v) => (v.agree != null ? ` (${v.agree} of 5)` : '');
      for (const v of verdicts.filter((x) => x.call === 'sell').slice(0, 3)) parts.push(`${exitWord(v)} ${v.ticker} now${of(v)}: ${v.why.replace(/[.\s]+$/, '')}.`);
      for (const c of ['trim', 'add', 'hold']) {
        const these = verdicts.filter((x) => x.call === c);
        if (these.length) parts.push(`${c[0].toUpperCase()}${c.slice(1)} ${these.map((v) => `${v.ticker}${of(v)}`).join(', ')}.`);
      }
      if (n) parts.push(`${n} trade${n === 1 ? '' : 's'} ready. ${names}${n > 3 ? ' and more' : ''}.`);
      // The high-risk trade is named on its own, with its chance, so it is never mistaken for the rest.
      const hr = checked.trades.find((r) => r.highRisk);
      if (hr) parts.push(`High risk: ${hr.ticker} ${hr.instrument === 'stock' ? hr.side : hr.instrument}, ${hr.profitLow} to ${hr.profitHigh}%.`);
      else if (run.trigger === 'morning' || !verdicts.length) parts.push(`${parts.length ? 'Nothing' : 'nothing'} worth taking yet.`);
      const body = `${run.trigger === 'morning' ? '7:00 desk: ' : ''}${parts.join(' ')}`;
      await push(env, env.ADMIN_UID, { title: 'PR 420', body, link: '/admin-desk.html', max: PUSH_MAX }).catch(() => {});
      pushed = true;
    }
    await diagLog(env, {
      ev: 'desk-run-end', ok: true, trigger: run.trigger || 'manual', attempt: run.attempt || 1, reports: got.length,
      trades: n, dropped: checked.dropped, screened: screened.dropped, expired, news: checked.news.length, pushed,
      charts: { st: fresh.status, asked: deskSyms.length, got: Object.keys(charts).length, cut: !!fresh.cut },
      recheck: { live: tally.length, updated, ...Object.fromEntries(CALLS.map((c) => [c, verdicts.filter((v) => v.call === c).length])), none: tally.length - rechecks.length },
      desk: { ms: decided.ms, st: decided.stop, in: decided.usage?.input_tokens, out: decided.usage?.output_tokens },
      ms: Date.now() - t0,
    }).catch(() => {});
    return { ok: true, trades: n, reports: got.length };
  } catch (err) {
    console.error('desk run:', err?.stack || err);
    return fail(`The desk run failed: ${friendly(err)}. Tap RUN TRADING DESK to try again.`, friendly(err));
  }
}

/** Writes the new ideas in one request, each with the time it stops being worth taking. Answers the ids that landed. */
async function fileRecs(env, run, trades, { caseId = '', writeMany = batchWrite } = {}) {
  if (!trades.length) return { ids: [] };
  const now = new Date();
  const rows = trades.map((t) => {
    const id = rid('rec_');
    return {
      id,
      path: `${PLAYS}/${id}`,
      mustNotExist: true,
      data: {
        ...t, id, caseId, runId: run.id, at: now, slot: mtLabel(now.getTime()), status: 'open',
        expiresAt: recExpiry(t.horizon, { holdDays: t.holdDays || 2, now: now.getTime(), contractExpiry: t.instrument === 'stock' ? null : t.expiry }),
        tookAt: null, closedAt: null, result: null,
      },
    };
  });
  const ok = await writeMany(env, rows.map(({ path, data, mustNotExist }) => ({ path, data, mustNotExist })));
  return { ids: rows.filter((r, i) => ok[i]).map((r) => r.id) };
}

/**
 * Retires the last run's ideas he did not take, once the new board is saved:
 * one read of them all and one write, each under its own document's time so a
 * YES that lands in between wins. Best effort: an idea that stays open here is
 * off the board anyway, because the board is found by the new run's ids.
 */
async function retireRecs(env, previous, keep = [], { getMany = batchGetDocs, writeMany = batchWrite } = {}) {
  const ids = (Array.isArray(previous) ? previous : []).filter((id) => !keep.includes(id)).slice(0, 20);
  if (!ids.length) return 0;
  const docs = await getMany(env, ids.map((id) => `${PLAYS}/${id}`));
  const now = new Date();
  const writes = [];
  ids.forEach((id, i) => {
    const d = docs[i];
    if (d && d.data?.status === 'open') writes.push({ path: `${PLAYS}/${id}`, data: { status: 'expired', expiredAt: now }, mask: ['status', 'expiredAt'], ifUpdateTime: d.updateTime });
  });
  if (!writes.length) return 0;
  const ok = await writeMany(env, writes);
  return ok.filter(Boolean).length;
}

// PARKED (Eric, 2026-09-25: "Park pr 420. No scans unless I manually do it. No auto token burn
// anywhere."). The 7:00 run is gone: nothing starts a desk run on a clock. The only thing that queues
// one is his tap on RUN TRADING DESK (requestRun, from the route); the cron only carries a run he
// started through its two firings.
