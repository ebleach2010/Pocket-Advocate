// The Trade portal (Eric, 2026-09-21): "An entirely different page, separate
// for anything else. The financial advisor. He is trained on day trading
// techniques, data, stays up to date on news, and shoots me a message every
// 2 hours on week days on potential day trade opportunities with options and
// stocks. I can ask him questions. I have a spot to tally my account total
// ... He uses fable. It's just admin side. Trade portal."
//
// Admin only, and separate: its own module, its own documents under trade/
// (unreadable by clients under the rules' closing deny), its own page. What
// it borrows from the advisor is the plumbing that already survived contact
// with production: the batch submit, the poll, the one-finish claim, the
// pure verdict on a poll, and the flight recorder.
//
// The desk runs four scans on a trading day, at 07:30, 09:30, 11:30 and
// 13:30 Mountain (his answer on 2026-09-21: market hours only). A scan is a
// batch turn: the Finnhub packet (quotes, headlines, today's earnings) and
// his recent plays go in, web search is on, and a JSON object comes back
// with plays, notes, or neither. Nothing at all is written for a quiet
// scan, because he asked that the desk say nothing when nothing stands out.
// A strong play is pushed to his phone; notes land quietly with a badge.

import { patchDoc, deleteDoc, listDocs, tryGet, READ_FAILED, readFailedError } from './firestore.js';
import { notifyUser } from './push.js';
import {
  client, batchCustomId, pollTurnBatch, askFlightNext, diagLog, extractText, stripDashes, friendly,
} from './advisor.js';
import {
  isTradingDay, tradeMetrics, chartSeries, TARGET_DAILY, PROJECTION_MIN_DAYS, DEFAULT_START_CENTS,
} from '../public/js/trade-math.js';

// ---- constants ------------------------------------------------------------
// "He uses fable." Thinking is always on for this model, so the request
// carries no thinking key at all. The fallback id is used only if the
// provider refuses the pinned one at submit (400 or 404 naming the model).
export const TRADE_MODEL = 'claude-fable-5-1';
export const TRADE_FALLBACK_MODEL = 'claude-opus-5';
// A play is time-sensitive, so a scan runs one step below the top; his own
// question is not, and gets the top.
export const TRADE_SCAN_EFFORT = 'high';
export const TRADE_ASK_EFFORT = 'max';
export const SCAN_TOKENS = 32000;
export const ASK_TOKENS = 16000;
export const TRADE_TZ = 'America/Boise';
export const SCAN_SLOTS = ['07:30', '09:30', '11:30', '13:30'];
// An early close is 13:00 Eastern, which is 11:00 Mountain: the 11:30 scan
// would already be after the bell.
export const EARLY_CLOSE_SLOTS = ['07:30', '09:30'];
// A slot fires on the first cron firing inside this many minutes after it.
export const SCAN_WINDOW_MIN = 20;
export const MARKET_OPEN = '07:30';
export const MARKET_CLOSE = '14:00';
export const START_BALANCE_CENTS = DEFAULT_START_CENTS;
// A strong play, the one that reaches his phone: the low end of its chance
// of profit at or above this, with a named catalyst. The Worker decides
// this from the fields, never the prompt's mood.
export const STRONG_PROFIT_LOW = 55;
export const WATCHLIST_MAX = 20;
export const DEFAULT_WATCHLIST = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'AMD', 'META', 'AMZN', 'MSFT', 'COIN'];
export const FEED_PAGE = 30;
export const TRADE_SEARCH_MAX_USES = 8;
export const TRADE_WEB_SEARCH_TOOL = { type: 'web_search_20260209', name: 'web_search', max_uses: TRADE_SEARCH_MAX_USES };
export const FLIGHT_STALE_FINISH_MS = 5 * 60_000;
// The sentences the routes refuse with. Exported so the demo mirrors them
// word for word and a check can hold the two to each other.
export const SAY = {
  notFound: 'Not found',
  askEmpty: 'Ask something, up to 2000 characters.',
  noKey: 'Add your Finnhub key in Settings first.',
  scanRunning: 'A scan is already running. It lands on its own.',
  badDate: 'Pick a date like 2026-09-21, not in the future.',
  badCents: 'Enter the balance in dollars, 0 or more, under ten million.',
  badStart: 'Starting amount: whole dollars, 1 or more, under ten million.',
  noPlay: 'No such play.',
  badStatus: 'Status must be took, skipped, or closed.',
  badOutcome: 'Closed at needs a dollar figure, plus or minus.',
  badKey: 'That key does not look like a Finnhub key.',
  badAccount: 'Account type is cash or margin.',
  badWatchlist: 'Watchlist: up to 20 tickers, letters and dots only.',
  unreadable: 'The desk answered with something this page could not read.',
};
// ---- end constants --------------------------------------------------------

export class TradeError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const SETTINGS_PATH = 'trade/settings';
const STATE_PATH = 'trade/state';
const FLIGHTS = 'trade/flights/items';
const FEED = 'trade/feed/items';
const PLAYS = 'trade/plays/items';
const BALANCES = 'trade/balances/items';

const rid = (p) => `${p}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// ---- the calendar, on his clock ------------------------------------------
const MT_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: TRADE_TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', weekday: 'short',
});

/** The wall clock in Mountain time: date key, hour, minute, minute of the day. */
export function mtParts(now = Date.now()) {
  const p = {};
  for (const { type, value } of MT_FMT.formatToParts(new Date(now))) p[type] = value;
  const hh = Number(p.hour) % 24;
  const mm = Number(p.minute);
  return { dateKey: `${p.year}-${p.month}-${p.day}`, hh, mm, minuteOfDay: hh * 60 + mm, weekday: p.weekday };
}

const slotMinute = (slot) => Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5));

/** The slots a given day gets: none, the two before an early close, or all four. */
export function slotsFor(dateKey) {
  const day = isTradingDay(dateKey);
  if (!day) return [];
  return day === 'early' ? EARLY_CLOSE_SLOTS : SCAN_SLOTS;
}

/** The slot `now` sits inside, or null: the latest slot whose minute has passed within the window. */
export function slotKeyFor(now = Date.now()) {
  const { dateKey, minuteOfDay } = mtParts(now);
  for (const slot of [...slotsFor(dateKey)].reverse()) {
    const m = slotMinute(slot);
    if (minuteOfDay >= m && minuteOfDay - m < SCAN_WINDOW_MIN) return { key: `${dateKey}T${slot}`, dateKey, slot };
  }
  return null;
}

/** The instant a Mountain wall time falls on, to the minute. */
export function mtInstant(dateKey, hhmm) {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const guess = Date.UTC(y, mo - 1, d, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  const p = mtParts(guess);
  const wall = Date.UTC(Number(p.dateKey.slice(0, 4)), Number(p.dateKey.slice(5, 7)) - 1, Number(p.dateKey.slice(8, 10)), p.hh, p.mm);
  return guess + (guess - wall);
}

/** The next scan after `now`, walking up to two weeks of days. */
export function nextSlotAfter(now = Date.now()) {
  for (let i = 0; i < 14; i++) {
    const at = now + i * 86_400_000;
    const { dateKey, minuteOfDay } = mtParts(at);
    for (const slot of slotsFor(dateKey)) {
      if (i === 0 && slotMinute(slot) <= minuteOfDay) continue;
      return { key: `${dateKey}T${slot}`, dateKey, slot, atMs: mtInstant(dateKey, slot) };
    }
  }
  return null;
}

/** Whether a scan is owed right now, and why not when it is not. Pure. */
export function scanDue({ state, settings, hasKey, now = Date.now() }) {
  const slot = slotKeyFor(now);
  if (!slot) return { due: false, key: null, why: 'no slot' };
  if (settings?.scansOn === false) return { due: false, key: slot.key, why: 'scans off' };
  if (!hasKey) return { due: false, key: slot.key, why: 'no key' };
  if (state?.lastSlot === slot.key) return { due: false, key: slot.key, why: 'already ran' };
  return { due: true, key: slot.key, why: 'due' };
}

// ---- the prompt -----------------------------------------------------------
export const TRADE_PLAYBOOK = `You are the trading desk for one person. He day trades a small account: stocks, single options, and defined-risk spreads. He holds for one minute to several hours and closes before the bell unless a position has a high chance of a good return overnight. His target is 3% of the account a day. Market hours on his clock are ${MARKET_OPEN} to ${MARKET_CLOSE} Mountain time. He checks every options chain in his broker before he enters, so name strikes and expiries from the stock price and say what to check.

What you are for: at each scan, find the plays that stand out right now and say the rest that is worth knowing. When nothing stands out, say so by returning no plays. Never invent a play to fill the space. Use the quotes you are given for prices; use web search for what moved a name, what is on the calendar, and what the market is doing, and prefer a fresh source over a stale one.

The setups you know and name by name: gap and go (a gap up on volume that holds above the opening range), the opening range breakout (the first five to fifteen minutes set a range; a break with volume is the entry, the other side of the range is the stop), VWAP reclaim and VWAP rejection (price crossing back above the volume weighted average price with volume is a long trigger; failing at it from below is a short trigger), relative volume (a move on two or three times normal volume is real; a move on thin volume is not), catalysts (earnings, guidance, FDA decisions, upgrades and downgrades, contracts, macro prints, Fed days) and sector sympathy (one name moves and its peers follow).

Options: a call or a put is the simple play on a fast move. A debit vertical spread caps the cost and the risk when implied volatility is high or the move may be modest. Sell nothing naked. Earnings inflate implied volatility and it collapses after the print: buying a single option into earnings risks IV crush even when the direction is right, so prefer a spread or the stock. A same-day expiry (0DTE) contract has heavy gamma and theta: it can double or go to zero in minutes, so it is a small-size, fast-exit instrument only. Check liquidity before anything: open interest in the hundreds or more, a bid to ask spread that is a small fraction of the mid, and volume today. Name the strike by delta or distance from the price and say which expiry.

Risk: position size comes first. Risk a small share of the account on any one trade, one to two percent at the stop, and size the position so the stop costs that and no more. Say the stop before the target. Under $25,000 a margin account is bound by the pattern day trader rule (the PDT rule): four day trades in five business days flags it, so on a margin account count day trades and say when a play would spend one. On a cash account funds settle the next day, so a sale today is not buying power today, and reusing unsettled funds is a good faith violation. His account type and balance are in each request; respect both.

What makes a play strong: a clear catalyst you can name, a setup with a defined entry, a stop the setup gives you, a target that pays at least twice the risk, and enough liquidity to get in and out. Give a chance of profit as a range, low to high, in whole percents, and be honest: a range that starts at 55 or higher is a play he may be pushed for, so do not start there unless the case is real. Below that the play still goes in the list as a watch.

Do not: chase a move already extended, average down, name an illiquid ticker, give a target the quotes contradict, or hold an overnight position without saying why the chance of a good return is high.

Answer with ONE JSON object and nothing before or after it, no code fence, in exactly this shape:
{"quiet": boolean, "summary": string, "notes": [{"text": string}], "plays": [{"ticker": string, "side": "long" or "short", "instrument": "stock" or "call" or "put" or "spread", "structure": string, "entry": number, "stop": number, "targets": [number], "holdMinutes": integer, "why": string, "catalyst": string, "risk": string, "profitLow": integer, "profitHigh": integer, "sizeDollars": integer, "overnightOk": boolean, "overnightWhy": string}]}
quiet is true when there is nothing worth his attention at all, and then notes and plays are both empty. summary is two or three sentences on the market right now. notes are single facts worth knowing that are not plays. structure names the exact instrument (for example "Nov 21 660 call" or "Oct 17 150/155 call debit spread" or "shares"). entry, stop and targets are prices of the underlying for stock plays and of the option or spread for option plays, and you say which in structure. holdMinutes is how long the play is expected to take. sizeDollars is the dollars to put on given his balance and the risk rules. why is two or three short sentences. Every string obeys the register rules.`;

export const TRADE_REGISTER = `Register: Plain English. Short declarative sentences. Numbers first. No figures of speech, no idioms, no metaphors. No greetings, no sign-offs, no hedging boilerplate, no disclaimers. No em dashes and no en dashes: use commas, colons, or the word to. Every play stands on its own: a stranger reading one card knows the ticker, the side, the structure, the entry, the stop, the targets, the hold, the why, the catalyst, the risk, and the chance of profit as a range.`;

const dollars = (cents) => `$${(Number(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const whenMT = (ms) => new Intl.DateTimeFormat('en-US', {
  timeZone: TRADE_TZ, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
}).format(new Date(ms));

function quotesText(snap) {
  const lines = (snap?.quotes || []).map((q) => `${q.ticker} ${q.last} (${q.chgPct >= 0 ? '+' : ''}${q.chgPct}% today, open ${q.open}, high ${q.high}, low ${q.low}, prev close ${q.prevClose})`);
  const missing = (snap?.missing || []).length ? `\nNo quote came back for: ${snap.missing.join(', ')}.` : '';
  return (lines.length ? lines.join('\n') : 'No quotes were available.') + missing;
}

function playsText(plays) {
  if (!plays.length) return 'None yet.';
  return plays.map((p) => {
    const d = p.data || p;
    const out = d.status === 'closed' && Number.isFinite(Number(d.outcomeCents)) ? `, closed ${dollars(d.outcomeCents)}` : '';
    return `${d.ticker} ${d.side} ${d.structure || d.instrument} (${d.slot || 'manual'}): ${d.status}${out}; chance ${d.profitLow} to ${d.profitHigh}%`;
  }).join('\n');
}

/** What the scan turn is told. The key never appears here; only what it fetched. */
export function scanUserContent({ now = Date.now(), slot = '', snap, settings, balanceCents, plays = [], questions = [] }) {
  const acct = settings?.accountType === 'margin' ? 'margin' : 'cash';
  const target = Math.round(Number(balanceCents) * TARGET_DAILY);
  const lines = [
    `Now: ${whenMT(now)}, Mountain time. Market hours ${MARKET_OPEN} to ${MARKET_CLOSE}. ${slot ? `This is the ${slot} scan.` : 'This scan was asked for by hand.'}`,
    `Account: ${dollars(balanceCents)}, ${acct} account. Started at ${dollars(settings?.startCents || START_BALANCE_CENTS)} on ${settings?.startedAt || 'an unrecorded date'}. Target today: 3%, which is ${dollars(target)}.`,
    `Quotes (Finnhub, as of now):\n${quotesText(snap)}`,
    `Headlines (last twelve hours):\n${(snap?.news || []).length ? snap.news.map((n) => `- ${n.headline} (${n.source})`).join('\n') : 'None fetched.'}`,
    `Earnings today: ${(snap?.earnings || []).length ? snap.earnings.map((e) => `${e.symbol} ${e.hour}`).join(', ') : 'none listed.'}`,
    `His recent plays:\n${playsText(plays)}`,
    questions.length ? `His recent questions and the desk's answers:\n${questions.map((q) => `Q: ${q.text}\nA: ${(q.answer || '').slice(0, 600)}`).join('\n')}` : '',
    'Scan now. Return the JSON object.',
  ];
  return lines.filter(Boolean).join('\n\n');
}

/** What a question turn is told: the same desk, plus the recent feed and the open plays. */
export function askUserContent({ now = Date.now(), snap, settings, balanceCents, feed = [], plays = [], question }) {
  const acct = settings?.accountType === 'margin' ? 'margin' : 'cash';
  const recent = feed.map((r) => {
    const d = r.data || r;
    if (d.kind === 'question') return `Q (${d.at ? whenMT(new Date(d.at).getTime()) : ''}): ${d.text}\nA: ${(d.answer || '').slice(0, 800)}`;
    if (d.kind === 'scan') return `Scan ${d.slot || ''}: ${d.text}${(d.notes || []).length ? ` Notes: ${d.notes.map((n) => n.text).join(' ')}` : ''}`;
    return `${d.kind}: ${d.text}`;
  });
  return [
    `Now: ${whenMT(now)}, Mountain time. Account: ${dollars(balanceCents)}, ${acct} account.`,
    snap ? `Quotes (Finnhub, as of now):\n${quotesText(snap)}` : '',
    `Open plays:\n${playsText(plays.filter((p) => (p.data || p).status === 'open' || (p.data || p).status === 'took'))}`,
    recent.length ? `Recent desk feed, newest first:\n${recent.join('\n')}` : '',
    `His question: ${question}`,
    'Answer in plain text, under 250 words, register rules apply. No JSON.',
  ].filter(Boolean).join('\n\n');
}

/** One request body, batch or not. No thinking key (always on for this model), no cache_control (four scans two hours apart never hit one). */
export function tradeTurn({ kind, user, search = true, model = TRADE_MODEL }) {
  const scan = kind === 'scan';
  return {
    model,
    max_tokens: scan ? SCAN_TOKENS : ASK_TOKENS,
    output_config: { effort: scan ? TRADE_SCAN_EFFORT : TRADE_ASK_EFFORT },
    system: [{ type: 'text', text: TRADE_PLAYBOOK }, { type: 'text', text: TRADE_REGISTER }],
    messages: [{ role: 'user', content: user }],
    ...(search ? { tools: [TRADE_WEB_SEARCH_TOOL] } : {}),
  };
}

// ---- the answer, read strictly -------------------------------------------
const TICKER_RE = /^[A-Z][A-Z.]{0,5}$/;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : NaN);
const int = (v, lo, hi) => { const n = Number(v); return Number.isInteger(n) && n >= lo && n <= hi ? n : NaN; };
const str = (v, n) => stripDashes(String(v == null ? '' : v)).trim().slice(0, n);

/** One play, validated field by field, or null. */
export function validPlay(p) {
  if (!p || typeof p !== 'object') return null;
  const ticker = String(p.ticker || '').toUpperCase().trim();
  const side = String(p.side || '').toLowerCase();
  const instrument = String(p.instrument || '').toLowerCase();
  const profitLow = int(p.profitLow, 0, 100);
  const profitHigh = int(p.profitHigh, 0, 100);
  const holdMinutes = int(p.holdMinutes, 1, 1440);
  const sizeDollars = int(p.sizeDollars, 0, 10_000_000);
  const entry = num(p.entry);
  const stop = num(p.stop);
  const targets = Array.isArray(p.targets) ? p.targets.map(num).filter((n) => Number.isFinite(n)).slice(0, 4) : [];
  if (!TICKER_RE.test(ticker) || !['long', 'short'].includes(side) || !['stock', 'call', 'put', 'spread'].includes(instrument)) return null;
  if ([profitLow, profitHigh, holdMinutes, sizeDollars, entry, stop].some((n) => Number.isNaN(n)) || profitLow > profitHigh || !targets.length) return null;
  return {
    ticker, side, instrument, structure: str(p.structure, 120), entry, stop, targets, holdMinutes,
    why: str(p.why, 800), catalyst: str(p.catalyst, 300), risk: str(p.risk, 400),
    profitLow, profitHigh, sizeDollars,
    overnight: { ok: p.overnightOk === true, why: str(p.overnightWhy, 300) },
  };
}

/** The scan's JSON out of a Message: fences stripped, the object located, every play validated, the bad ones counted. */
export function parseScan(message, meta) {
  const text = extractText(message, meta);
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const a = cleaned.indexOf('{');
  const b = cleaned.lastIndexOf('}');
  let obj;
  try { obj = JSON.parse(cleaned.slice(a, b + 1)); } catch { throw new Error(SAY.unreadable); }
  if (!obj || typeof obj !== 'object') throw new Error(SAY.unreadable);
  const rawPlays = Array.isArray(obj.plays) ? obj.plays : [];
  const plays = rawPlays.map(validPlay).filter(Boolean).slice(0, 6);
  const notes = (Array.isArray(obj.notes) ? obj.notes : [])
    .map((n) => ({ text: str(typeof n === 'string' ? n : n?.text, 500) })).filter((n) => n.text).slice(0, 10);
  return { quiet: obj.quiet === true || (!plays.length && !notes.length), summary: str(obj.summary, 1200), notes, plays, dropped: rawPlays.length - plays.length };
}

/** What a landed scan means: write nothing, write quietly, or write and push. Pure. */
export function scanVerdict(parsed, settings) {
  const plays = parsed?.plays || [];
  const notes = parsed?.notes || [];
  if (!plays.length && !notes.length) return { result: 'quiet', write: false, push: false, body: '' };
  const strong = plays.filter((p) => p.profitLow >= STRONG_PROFIT_LOW && String(p.catalyst || '').trim());
  const push = settings?.pushOn !== false && strong.length > 0;
  const p = strong[0];
  const body = p
    ? stripDashes(`${p.ticker} ${p.side}: ${p.structure || p.instrument}, ${p.profitLow} to ${p.profitHigh}% chance.${strong.length > 1 ? ` ${strong.length - 1} more in the portal.` : ''}`)
    : '';
  return { result: plays.length ? 'plays' : 'notes', write: true, push, body };
}

// ---- Finnhub ----------------------------------------------------------------
const KEY_RE = /^[A-Za-z0-9_-]{16,64}$/;
export const keyTail = (key) => (key ? String(key).slice(-4) : '');
/** A real secret on the Worker wins; the key he pasted is the everyday case. */
export const resolveKey = (env, settings) => String(env?.FINNHUB_KEY || settings?.finnhubKey || '');

async function fetchFinnhub(key, path, params = {}) {
  const qs = new URLSearchParams({ ...params, token: key });
  try {
    const res = await fetch(`https://finnhub.io/api/v1${path}?${qs}`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const out = await res.json().catch(() => null);
    if (!out || (typeof out === 'object' && !Array.isArray(out) && out.error)) return null;
    return out;
  } catch {
    return null;
  }
}

const watchlistOf = (settings) => (Array.isArray(settings?.watchlist) && settings.watchlist.length ? settings.watchlist : DEFAULT_WATCHLIST).slice(0, WATCHLIST_MAX);

/** Quotes for the watchlist, the last twelve hours of general headlines, today's earnings. A refused endpoint is dropped and named. */
export async function marketSnapshot(key, watchlist, now = Date.now()) {
  const { dateKey } = mtParts(now);
  const r2 = (v) => (Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null);
  const [quotes, news, cal] = await Promise.all([
    Promise.all(watchlist.map(async (ticker) => {
      const q = await fetchFinnhub(key, '/quote', { symbol: ticker });
      if (!q || !Number.isFinite(Number(q.c)) || Number(q.c) === 0) return { ticker, missing: true };
      return { ticker, last: r2(q.c), chg: r2(q.d), chgPct: r2(q.dp), open: r2(q.o), high: r2(q.h), low: r2(q.l), prevClose: r2(q.pc), at: q.t ? new Date(Number(q.t) * 1000).toISOString() : null };
    })),
    fetchFinnhub(key, '/news', { category: 'general' }),
    fetchFinnhub(key, '/calendar/earnings', { from: dateKey, to: dateKey }),
  ]);
  const cutoff = now - 12 * 3600_000;
  return {
    at: new Date(now).toISOString(),
    quotes: quotes.filter((q) => !q.missing),
    missing: quotes.filter((q) => q.missing).map((q) => q.ticker),
    news: (Array.isArray(news) ? news : [])
      .filter((n) => n && n.headline && (!n.datetime || Number(n.datetime) * 1000 >= cutoff))
      .slice(0, 20).map((n) => ({ headline: stripDashes(String(n.headline)).slice(0, 200), source: String(n.source || '').slice(0, 60), at: n.datetime ? new Date(Number(n.datetime) * 1000).toISOString() : null })),
    earnings: (Array.isArray(cal?.earningsCalendar) ? cal.earningsCalendar : [])
      .filter((e) => e && e.symbol).slice(0, 40).map((e) => ({ symbol: String(e.symbol), hour: String(e.hour || '') })),
    newsOk: Array.isArray(news), earningsOk: !!cal,
  };
}

// ---- documents --------------------------------------------------------------
async function readSettings(env) {
  const doc = await tryGet(env, SETTINGS_PATH);
  if (doc === READ_FAILED) throw readFailedError('The desk settings could not be read.');
  return doc;
}
async function readState(env) {
  const doc = await tryGet(env, STATE_PATH);
  if (doc === READ_FAILED) throw readFailedError('The desk state could not be read.');
  return doc;
}
const startOf = (settings) => (Number.isInteger(settings?.startCents) && settings.startCents > 0 ? settings.startCents : START_BALANCE_CENTS);

async function latestBalanceCents(env, settings) {
  const rows = await listDocs(env, BALANCES, { pageSize: 1, orderBy: 'date desc' }).catch(() => []);
  return rows[0]?.data?.cents ?? startOf(settings);
}

async function openScanFlight(env) {
  const rows = await listDocs(env, FLIGHTS, { pageSize: 5 }).catch(() => []);
  return rows.find((r) => r.data.kind === 'scan') || null;
}

/** The batch create, with the two fallbacks that turn a 400 into a resubmit rather than a lost scan. */
export async function submitTradeBatch(env, turn, customId) {
  const create = async (t) => {
    const b = await client(env).messages.batches.create({ requests: [{ custom_id: customId, params: t }] });
    return { batchId: b.id, model: t.model, search: !!t.tools };
  };
  try {
    return await create(turn);
  } catch (err) {
    const msg = String(err?.message || err);
    const status = err?.status;
    if (status === 400 && turn.tools && /tool|web_search/i.test(msg)) {
      await diagLog(env, { ev: 'trade-search-off', why: msg.slice(0, 200) });
      await patchDoc(env, STATE_PATH, { searchOff: true }, { mask: ['searchOff'] }).catch(() => {});
      const { tools, ...rest } = turn;
      void tools;
      return create(rest);
    }
    if ((status === 400 || status === 404) && turn.model !== TRADE_FALLBACK_MODEL && /model/i.test(msg)) {
      await diagLog(env, { ev: 'trade-model-fallback', why: msg.slice(0, 200) });
      return create({ ...turn, model: TRADE_FALLBACK_MODEL });
    }
    throw err;
  }
}

async function writeFlight(env, fields) {
  const id = rid('t');
  await patchDoc(env, `${FLIGHTS}/${id}`, { submittedAt: new Date(), progressAt: new Date(), pollFails: 0, finishingAt: null, ...fields });
  return id;
}

/** One scan: the packet, the turn, the submit, the flight. Throws TradeError on the two refusals a route shows him. */
export async function runScan(env, { manual = false, slotKey = '', settingsDoc = null, stateDoc = null } = {}) {
  const t0 = Date.now();
  // The cron hands in the two documents it just read; a tap reads them here.
  if (!settingsDoc) settingsDoc = await readSettings(env);
  const settings = settingsDoc?.data || {};
  if (!stateDoc) stateDoc = await readState(env);
  const key = resolveKey(env, settings);
  if (!key) throw new TradeError(409, SAY.noKey);
  if (await openScanFlight(env)) throw new TradeError(409, SAY.scanRunning);
  const [snap, balanceCents, plays, questions] = await Promise.all([
    marketSnapshot(key, watchlistOf(settings), t0),
    latestBalanceCents(env, settings),
    listDocs(env, PLAYS, { pageSize: 20, orderBy: 'at desc' }).catch(() => []),
    listDocs(env, FEED, { pageSize: 30, orderBy: 'at desc' }).catch(() => []),
  ]);
  const qa = questions.filter((r) => r.data.kind === 'question' && r.data.status === 'done').slice(0, 10).map((r) => r.data);
  const user = scanUserContent({ now: t0, slot: slotKey ? slotKey.slice(11) : '', snap, settings, balanceCents, plays, questions: qa });
  const turn = tradeTurn({ kind: 'scan', user, search: stateDoc?.data?.searchOff !== true });
  const customId = batchCustomId('trade', slotKey ? slotKey.replace(/[^\w-]/g, '') : 'manual', t0);
  const sub = await submitTradeBatch(env, turn, customId);
  const id = await writeFlight(env, { kind: 'scan', batchId: sub.batchId, customId, model: sub.model, search: sub.search, slotKey, manual });
  await diagLog(env, { ev: 'trade-scan-submit', slot: slotKey || 'manual', manual, tickers: snap.quotes.length, missing: snap.missing.length, search: sub.search, ms: Date.now() - t0 });
  return { flightId: id };
}

/** One question: the row, the turn, the submit, the flight. */
export async function runAsk(env, question) {
  const t0 = Date.now();
  const settings = (await readSettings(env))?.data || {};
  const stateDoc = await readState(env);
  const feedId = rid('f');
  await patchDoc(env, `${FEED}/${feedId}`, { at: new Date(), kind: 'question', text: question, status: 'running', answer: '', answeredAt: null });
  const key = resolveKey(env, settings);
  const [snap, balanceCents, feed, plays] = await Promise.all([
    key ? marketSnapshot(key, watchlistOf(settings), t0) : null,
    latestBalanceCents(env, settings),
    listDocs(env, FEED, { pageSize: 20, orderBy: 'at desc' }).catch(() => []),
    listDocs(env, PLAYS, { pageSize: 20, orderBy: 'at desc' }).catch(() => []),
  ]);
  const user = askUserContent({ now: t0, snap, settings, balanceCents, feed: feed.filter((r) => r.id !== feedId), plays, question });
  const turn = tradeTurn({ kind: 'ask', user, search: stateDoc?.data?.searchOff !== true });
  const customId = batchCustomId('trade-ask', feedId, t0);
  try {
    const sub = await submitTradeBatch(env, turn, customId);
    const id = await writeFlight(env, { kind: 'ask', feedId, batchId: sub.batchId, customId, model: sub.model, search: sub.search });
    await diagLog(env, { ev: 'trade-ask-submit', search: sub.search, ms: Date.now() - t0 });
    return { feedId, flightId: id };
  } catch (err) {
    await patchDoc(env, `${FEED}/${feedId}`, { status: 'error', answer: stripDashes(`Could not ask: ${friendly(err)}`) }, { mask: ['status', 'answer'] }).catch(() => {});
    await diagLog(env, { ev: 'trade-ask-end', ok: false, ms: Date.now() - t0, err: String(err?.message || err).slice(0, 140) });
    throw err;
  }
}

/** A landed scan: read strictly, decide, write what the verdict says, push if it says so. */
export async function finishScan(env, flight, message) {
  const t0 = flight.submittedAt ? new Date(flight.submittedAt).getTime() : Date.now();
  const meta = {};
  let parsed;
  try {
    parsed = parseScan(message, meta);
  } catch (err) {
    const why = String(err?.message || err).slice(0, 200);
    await patchDoc(env, `${FEED}/${rid('f')}`, { at: new Date(), kind: 'error', slot: flight.slotKey || '', text: stripDashes(`The ${flight.slotKey ? flight.slotKey.slice(11) : 'manual'} scan could not be read: ${why}`) }).catch(() => {});
    await patchDoc(env, STATE_PATH, { lastScanAt: new Date(), lastScanResult: 'error', lastError: why }, { mask: ['lastScanAt', 'lastScanResult', 'lastError'] }).catch(() => {});
    await diagLog(env, { ev: 'trade-scan-end', ok: false, result: 'error', ms: Date.now() - t0, err: why.slice(0, 140) });
    return { result: 'error' };
  }
  const settings = (await readSettings(env))?.data || {};
  const v = scanVerdict(parsed, settings);
  const now = new Date();
  const slot = flight.slotKey ? flight.slotKey.slice(11) : (flight.manual ? 'manual' : '');
  if (!v.write) {
    await patchDoc(env, STATE_PATH, { lastScanAt: now, lastScanResult: 'quiet', lastError: null, lastSlotLanded: flight.slotKey || 'manual' },
      { mask: ['lastScanAt', 'lastScanResult', 'lastError', 'lastSlotLanded'] }).catch(() => {});
    await diagLog(env, { ev: 'trade-scan-end', ok: true, result: 'quiet', plays: 0, notes: 0, dropped: parsed.dropped, ms: Date.now() - t0, queries: meta.queries || 0, results: meta.results || 0 });
    return { result: 'quiet' };
  }
  const feedId = rid('f');
  const dateKey = flight.slotKey ? flight.slotKey.slice(0, 10) : mtParts(now.getTime()).dateKey;
  const close = mtInstant(dateKey, MARKET_CLOSE);
  const playIds = [];
  for (const p of parsed.plays) {
    const id = rid('p');
    const expiresAt = new Date(Math.min(now.getTime() + 2 * p.holdMinutes * 60_000, Math.max(close, now.getTime() + 15 * 60_000)));
    await patchDoc(env, `${PLAYS}/${id}`, { at: now, slot, feedId, ...p, status: 'open', outcomeCents: null, tookAt: null, closedAt: null, expiresAt });
    playIds.push(id);
  }
  await patchDoc(env, `${FEED}/${feedId}`, {
    at: now, kind: 'scan', slot, text: parsed.summary, notes: parsed.notes, playIds, quiet: false,
    searched: { queries: meta.queries || 0, results: meta.results || 0 }, landedMs: now.getTime() - t0,
  });
  await patchDoc(env, STATE_PATH, { lastScanAt: now, lastScanResult: v.result, lastError: null, lastSlotLanded: flight.slotKey || 'manual' },
    { mask: ['lastScanAt', 'lastScanResult', 'lastError', 'lastSlotLanded'] }).catch(() => {});
  if (v.push && env.ADMIN_UID) {
    await notifyUser(env, env.ADMIN_UID, { title: 'Pocket Advocate', body: v.body, link: '/admin-trade.html' }).catch(() => {});
    await diagLog(env, { ev: 'trade-push' });
  }
  await diagLog(env, { ev: 'trade-scan-end', ok: true, result: v.result, plays: parsed.plays.length, notes: parsed.notes.length, dropped: parsed.dropped, ms: Date.now() - t0, queries: meta.queries || 0, results: meta.results || 0 });
  return { result: v.result, feedId, playIds };
}

/** A landed answer onto its question row. */
export async function finishAsk(env, flight, message) {
  const t0 = flight.submittedAt ? new Date(flight.submittedAt).getTime() : Date.now();
  const meta = {};
  let text;
  try {
    text = extractText(message, meta);
  } catch (err) {
    await patchDoc(env, `${FEED}/${flight.feedId}`, { status: 'error', answer: stripDashes(`Could not answer: ${friendly(err)}`) }, { mask: ['status', 'answer'] }).catch(() => {});
    await diagLog(env, { ev: 'trade-ask-end', ok: false, ms: Date.now() - t0, err: String(err?.message || err).slice(0, 140) });
    return;
  }
  await patchDoc(env, `${FEED}/${flight.feedId}`, { status: 'done', answer: text, answeredAt: new Date() }, { mask: ['status', 'answer', 'answeredAt'] });
  await diagLog(env, { ev: 'trade-ask-end', ok: true, ms: Date.now() - t0, queries: meta.queries || 0 });
}

async function failFlight(env, flight, why) {
  const plain = stripDashes(friendly(new Error(why || 'The batch failed.')));
  if (flight.kind === 'ask' && flight.feedId) {
    await patchDoc(env, `${FEED}/${flight.feedId}`, { status: 'error', answer: `Could not answer: ${plain}` }, { mask: ['status', 'answer'] }).catch(() => {});
    await diagLog(env, { ev: 'trade-ask-end', ok: false, err: String(why || '').slice(0, 140) });
    return;
  }
  await patchDoc(env, `${FEED}/${rid('f')}`, { at: new Date(), kind: 'error', slot: flight.slotKey ? flight.slotKey.slice(11) : 'manual', text: `The desk could not finish this scan: ${plain}` }).catch(() => {});
  await patchDoc(env, STATE_PATH, { lastScanAt: new Date(), lastScanResult: 'error', lastError: String(why || '').slice(0, 200) }, { mask: ['lastScanAt', 'lastScanResult', 'lastError'] }).catch(() => {});
  await diagLog(env, { ev: 'trade-scan-end', ok: false, result: 'error', err: String(why || '').slice(0, 140) });
}

/**
 * One look at every open flight. The same shape as pollAskFlight: throttled
 * by the flight's own heartbeat, the pure verdict decides, and a landing is
 * claimed once with ifUpdateTime so two pollers never both finish it.
 * Returns true when it touched anything.
 */
export async function pollTradeFlights(env, { minAgeMs = 15_000 } = {}) {
  const rows = await listDocs(env, FLIGHTS, { pageSize: 5 }).catch(() => []);
  let touched = false;
  for (const row of rows) {
    const flight = row.data;
    if (!flight?.batchId) { await deleteDoc(env, `${FLIGHTS}/${row.id}`).catch(() => {}); continue; }
    const beat = flight.progressAt ? new Date(flight.progressAt).getTime() : 0;
    if (beat && Date.now() - beat < minAgeMs) continue;
    let poll;
    try { poll = await pollTurnBatch(env, flight.batchId, flight.customId); } catch { poll = { state: 'unreachable' }; }
    const next = askFlightNext(flight, poll, Date.now());
    if (next.op === 'wait') {
      await patchDoc(env, `${FLIGHTS}/${row.id}`, { progressAt: new Date(), pollFails: next.pollFails }, { mask: ['progressAt', 'pollFails'] }).catch(() => {});
      touched = true;
      continue;
    }
    if (next.op === 'finish') {
      const fin = flight.finishingAt ? new Date(flight.finishingAt).getTime() : 0;
      if (fin && Date.now() - fin < FLIGHT_STALE_FINISH_MS) continue;
      const won = await patchDoc(env, `${FLIGHTS}/${row.id}`, { finishingAt: new Date() }, { mask: ['finishingAt'], ifUpdateTime: row.updateTime }).catch(() => false);
      if (won === false) continue;
      if (flight.kind === 'ask') await finishAsk(env, flight, poll.message);
      else await finishScan(env, flight, poll.message);
      await deleteDoc(env, `${FLIGHTS}/${row.id}`).catch(() => {});
      touched = true;
      continue;
    }
    if (next.cancel) {
      try { await client(env).messages.batches.cancel(flight.batchId); } catch { /* gone, or unreachable */ }
    }
    await failFlight(env, flight, next.why);
    await deleteDoc(env, `${FLIGHTS}/${row.id}`).catch(() => {});
    touched = true;
  }
  return touched;
}

/**
 * The cron's minute: cheap outside the four windows (no read at all), and
 * inside one a conditional claim on the slot before a scan runs, so two
 * isolates on the same minute never both pay for it.
 */
export async function maybeTradeScan(env, now = Date.now()) {
  const slot = slotKeyFor(now);
  if (!slot) return { ran: false, why: 'no slot' };
  const settingsDoc = await tryGet(env, SETTINGS_PATH);
  const stateDoc = await tryGet(env, STATE_PATH);
  if (settingsDoc === READ_FAILED || stateDoc === READ_FAILED) return { ran: false, why: 'unreadable' };
  const settings = settingsDoc?.data || {};
  const due = scanDue({ state: stateDoc?.data || {}, settings, hasKey: !!resolveKey(env, settings), now });
  if (!due.due) return { ran: false, why: due.why };
  const claimed = await patchDoc(env, STATE_PATH, { lastSlot: slot.key, claimedAt: new Date() },
    stateDoc ? { mask: ['lastSlot', 'claimedAt'], ifUpdateTime: stateDoc.updateTime } : { mask: ['lastSlot', 'claimedAt'], mustNotExist: true }).catch(() => false);
  if (!claimed) { await diagLog(env, { ev: 'trade-claim-lost', slot: slot.key }); return { ran: false, why: 'claim lost' }; }
  try {
    await runScan(env, { slotKey: slot.key, settingsDoc, stateDoc });
    return { ran: true, why: 'due', key: slot.key };
  } catch (err) {
    const why = String(err?.message || err).slice(0, 200);
    if (!(err instanceof TradeError && err.message === SAY.scanRunning)) {
      await patchDoc(env, `${FEED}/${rid('f')}`, { at: new Date(), kind: 'error', slot: slot.slot, text: stripDashes(`The ${slot.slot} scan could not start: ${friendly(err)}`) }).catch(() => {});
      await patchDoc(env, STATE_PATH, { lastScanResult: 'error', lastError: why }, { mask: ['lastScanResult', 'lastError'] }).catch(() => {});
    }
    await diagLog(env, { ev: 'trade-scan-end', ok: false, result: 'error', slot: slot.key, err: why.slice(0, 140) });
    return { ran: false, why: 'failed', err: why };
  }
}

// ---- the routes ------------------------------------------------------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const realDate = (k) => DATE_RE.test(k) && new Date(`${k}T12:00:00Z`).toISOString().slice(0, 10) === k;

function publicSettings(settings) {
  return {
    accountType: settings?.accountType === 'margin' ? 'margin' : 'cash',
    watchlist: watchlistOf(settings),
    scansOn: settings?.scansOn !== false,
    pushOn: settings?.pushOn !== false,
    startedAt: settings?.startedAt || null,
    startCents: startOf(settings),
  };
}

/** The whole page in one answer. The key never rides; only whether one is on file and its last four characters. */
export function statePayload({ settings, state, feed, plays, balances, flights, now = Date.now(), hasKey, keyTailText }) {
  const pub = publicSettings(settings);
  const rows = balances.map((b) => ({ date: b.data?.date || b.id, cents: b.data?.cents, note: b.data?.note || '' }));
  const metrics = tradeMetrics(rows, { startedAt: pub.startedAt, startCents: pub.startCents, target: TARGET_DAILY, minDays: PROJECTION_MIN_DAYS });
  const seenAt = state?.seenAt ? new Date(state.seenAt).getTime() : 0;
  const { dateKey } = mtParts(now);
  return {
    settings: pub, hasKey: !!hasKey, keyTail: keyTailText || '',
    state: {
      lastSlot: state?.lastSlot || null, lastScanAt: state?.lastScanAt || null, lastScanResult: state?.lastScanResult || null,
      lastError: state?.lastError || null, seenAt: state?.seenAt || null, searchOff: state?.searchOff === true,
    },
    flights: flights.map((r) => ({ id: r.id, kind: r.data.kind, submittedAt: r.data.submittedAt || null, feedId: r.data.feedId || null })),
    feed: feed.map((r) => ({ id: r.id, ...r.data })),
    plays: plays.map((r) => ({ id: r.id, ...r.data })),
    balances: metrics.entries,
    metrics, chart: chartSeries(metrics),
    unseen: feed.filter((r) => r.data.kind !== 'question' && new Date(r.data.at || 0).getTime() > seenAt).length,
    nextSlot: nextSlotAfter(now), tradingDay: isTradingDay(dateKey), today: dateKey, now: new Date(now).toISOString(),
  };
}

export async function tradeState(env, { now = Date.now() } = {}) {
  await pollTradeFlights(env, { minAgeMs: 15_000 }).catch(() => {});
  const [settingsDoc, stateDoc, feed, plays, balances, flights] = await Promise.all([
    readSettings(env), readState(env),
    listDocs(env, FEED, { pageSize: FEED_PAGE, orderBy: 'at desc' }).catch(() => []),
    listDocs(env, PLAYS, { pageSize: 50, orderBy: 'at desc' }).catch(() => []),
    listDocs(env, BALANCES, { pageSize: 400, orderBy: 'date asc', all: true }).catch(() => []),
    listDocs(env, FLIGHTS, { pageSize: 5 }).catch(() => []),
  ]);
  const settings = settingsDoc?.data || {};
  const key = resolveKey(env, settings);
  return statePayload({ settings, state: stateDoc?.data || {}, feed, plays, balances, flights, now, hasKey: !!key, keyTailText: keyTail(key) });
}

export async function tradeAsk(env, body) {
  const question = String(body?.question || '').trim();
  if (!question || question.length > 2000) throw new TradeError(400, SAY.askEmpty);
  const out = await runAsk(env, question);
  return { ok: true, feedId: out.feedId };
}

export async function tradeBalance(env, body, now = Date.now()) {
  const date = String(body?.date || '').trim();
  const { dateKey: today } = mtParts(now);
  if (!realDate(date) || date > today) throw new TradeError(400, SAY.badDate);
  if (body?.remove === true) {
    await deleteDoc(env, `${BALANCES}/${date}`).catch(() => {});
    return { ok: true, removed: date };
  }
  const cents = Number(body?.cents);
  if (!Number.isInteger(cents) || cents < 0 || cents >= 1e9) throw new TradeError(400, SAY.badCents);
  const note = stripDashes(String(body?.note || '')).trim().slice(0, 140);
  await patchDoc(env, `${BALANCES}/${date}`, { date, at: new Date(), cents, note });
  return { ok: true, date, cents };
}

export async function tradeSettings(env, body) {
  const patch = {};
  if (body?.finnhubKey !== undefined) {
    const key = String(body.finnhubKey || '').trim();
    if (key && !KEY_RE.test(key)) throw new TradeError(400, SAY.badKey);
    patch.finnhubKey = key;
  }
  if (body?.accountType !== undefined) {
    if (!['cash', 'margin'].includes(body.accountType)) throw new TradeError(400, SAY.badAccount);
    patch.accountType = body.accountType;
  }
  if (body?.watchlist !== undefined) {
    const raw = Array.isArray(body.watchlist) ? body.watchlist : String(body.watchlist || '').split(/[\s,]+/);
    const list = [...new Set(raw.map((t) => String(t || '').toUpperCase().trim()).filter(Boolean))];
    if (list.length > WATCHLIST_MAX || !list.every((t) => TICKER_RE.test(t))) throw new TradeError(400, SAY.badWatchlist);
    patch.watchlist = list.length ? list : DEFAULT_WATCHLIST;
  }
  if (body?.scansOn !== undefined) patch.scansOn = body.scansOn === true;
  if (body?.pushOn !== undefined) patch.pushOn = body.pushOn === true;
  if (body?.startedAt !== undefined) {
    const k = String(body.startedAt || '').trim();
    if (!realDate(k)) throw new TradeError(400, SAY.badDate);
    patch.startedAt = k;
  }
  if (body?.startCents !== undefined) {
    const c = Number(body.startCents);
    if (!Number.isInteger(c) || c < 100 || c >= 1e9) throw new TradeError(400, SAY.badStart);
    patch.startCents = c;
  }
  const cur = (await readSettings(env))?.data || {};
  if (!cur.startedAt && !patch.startedAt) patch.startedAt = mtParts().dateKey;
  const mask = Object.keys(patch);
  if (mask.length) {
    await patchDoc(env, SETTINGS_PATH, { ...patch, setByHand: true, updatedAt: new Date() }, { mask: [...mask, 'setByHand', 'updatedAt'] });
  }
  const settings = { ...cur, ...patch };
  const key = resolveKey(env, settings);
  return { ok: true, settings: publicSettings(settings), hasKey: !!key, keyTail: keyTail(key) };
}

export async function tradePlay(env, body) {
  const id = String(body?.id || '');
  if (!/^[\w-]{1,40}$/.test(id)) throw new TradeError(404, SAY.noPlay);
  const status = String(body?.status || '');
  if (!['took', 'skipped', 'closed'].includes(status)) throw new TradeError(400, SAY.badStatus);
  const play = await tryGet(env, `${PLAYS}/${id}`);
  if (play === READ_FAILED) throw readFailedError('The play could not be read.');
  if (!play) throw new TradeError(404, SAY.noPlay);
  const now = new Date();
  const patch = { status };
  if (status === 'took') patch.tookAt = now;
  if (status === 'closed') {
    const cents = Number(body?.outcomeCents);
    if (!Number.isInteger(cents) || Math.abs(cents) >= 1e9) throw new TradeError(400, SAY.badOutcome);
    patch.outcomeCents = cents;
    patch.closedAt = now;
    if (!play.data.tookAt) patch.tookAt = now;
  }
  await patchDoc(env, `${PLAYS}/${id}`, patch, { mask: Object.keys(patch) });
  return { ok: true, play: { id, ...play.data, ...patch } };
}

export async function tradeSeen(env) {
  await patchDoc(env, STATE_PATH, { seenAt: new Date() }, { mask: ['seenAt'] });
  return { ok: true, unseen: 0 };
}

export async function tradeScanNow(env) {
  const out = await runScan(env, { manual: true });
  return { ok: true, flightId: out.flightId };
}

/** The dispatch behind /api/admin/trade/<sub>. The caller has already proved the admin. */
export async function tradeRoute(env, { sub, method, body, now = Date.now() }) {
  if (method === 'GET' && sub === 'state') return tradeState(env, { now });
  if (method !== 'POST') throw new TradeError(404, SAY.notFound);
  if (sub === 'ask') return tradeAsk(env, body);
  if (sub === 'balance') return tradeBalance(env, body, now);
  if (sub === 'settings') return tradeSettings(env, body);
  if (sub === 'play') return tradePlay(env, body);
  if (sub === 'seen') return tradeSeen(env);
  if (sub === 'scan') return tradeScanNow(env);
  throw new TradeError(404, SAY.notFound);
}
