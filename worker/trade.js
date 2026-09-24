// PR 420: the trade desk's routes (Eric, 2026-09-23).
//
// "The app should now have only two primary purposes: 1. Suggested Trades
// 2. Market News. Remove everything else that does not directly support
// those two functions."
//
// So this is the whole surface the page talks to: the board (the desk's
// trades, the ones he took, where the run is), one button that queues a run,
// YES on a trade, PROFIT or LOSS on a taken one, his history, the news that
// matters, his balance, a handful of settings, and a live quote for the cards.
// The run itself is worker/desk-run.js; nothing here starts a turn. Every old
// route (Scan, Look, positions, the calculator, questions, the stats) is gone
// and answers 404 like any other unknown path.
//
// Nothing here feeds his history back to the desk: History is read for his
// eyes on the History page and nowhere else.

import { patchDoc, listDocs, tryGet, batchGetDocs, READ_FAILED, readFailedError, deleteDoc } from './firestore.js';
import { requestRun, runAlive, riskPctOf, RESEARCH_PATH, LENSES } from './desk-run.js';
import { isTradingDay, isMarketOpen, MARKET_OPEN_MIN, planFor } from '../public/js/trade-math.js';
import {
  TRADE_TZ, DESK_NAME, SAY, SETTINGS_PATH, STATE_PATH, PLAYS, BALANCES, POSITIONS, DEFAULT_WATCHLIST, WATCHLIST_MAX, KEY_RE,
  QUOTE_MAX, mtParts, keyTail, resolveKey, watchlistOf, startOf, realDate,
  quoteCached, quoteBudgetLeft, newsCached, earningsCached, newsRows, earningsRows, MARKET_CLOSE,
} from './trade-desk.js';

export class TradeError extends Error {
  constructor(status, message, extra = null) { super(message); this.status = status; this.extra = extra; }
}

const ID_RE = /^[\w-]{1,40}$/;
const TICKER_RE = /^[A-Z][A-Z.]{0,5}$/;
// How many taken trades the board carries. A trade he took leaves this list
// only through PROFIT or LOSS, never by being pushed off the end.
export const ACTIVE_MAX = 30;

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

/** The settings the page may see. The key never rides; only whether one is on file and its last four characters. */
export function publicSettings(settings, env = {}) {
  const key = resolveKey(env, settings);
  return {
    accountType: settings?.accountType === 'margin' ? 'margin' : 'cash',
    riskPct: riskPctOf(settings),
    pushOn: settings?.pushOn !== false,
    debugResearch: settings?.debugResearch === true,
    watchlist: watchlistOf(settings),
    hasKey: !!key, keyTail: keyTail(key),
  };
}

/** The balance he last typed: the figure the desk sizes every trade from, with the day he typed it. */
async function balanceOf(env, settings) {
  const rows = await listDocs(env, BALANCES, { pageSize: 1, orderBy: 'date desc' }).catch(() => []);
  const last = rows[0]?.data;
  if (Number.isFinite(Number(last?.cents))) return { cents: Math.round(Number(last.cents)), date: last.date || rows[0].id, typed: true };
  return { cents: startOf(settings), date: null, typed: false };
}

/** One trade as the page reads it. Old plays from before PR 420 read the same way. */
export function recRow(id, d) {
  const outcome = Number(d?.outcomeCents);
  const result = d?.result === 'profit' || d?.result === 'loss' ? d.result
    : d?.status === 'closed' && Number.isFinite(outcome) && outcome !== 0 ? (outcome > 0 ? 'profit' : 'loss') : null;
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return {
    id,
    ticker: String(d?.ticker || ''), side: d?.side === 'short' ? 'short' : 'long',
    horizon: ['scalp', 'intraday', 'swing'].includes(d?.horizon) ? d.horizon : 'intraday',
    instrument: ['stock', 'call', 'put'].includes(d?.instrument) ? d.instrument : 'stock',
    entryLow: d?.entryLow ?? d?.entry ?? null, entryHigh: d?.entryHigh ?? d?.entry ?? null, entry: d?.entry ?? null,
    stop: d?.stop ?? null, targets: Array.isArray(d?.targets) ? d.targets : [],
    holdMinutes: d?.holdMinutes ?? null, holdDays: d?.holdDays ?? null, allocPct: d?.allocPct ?? null,
    profitLow: d?.profitLow ?? null, profitHigh: d?.profitHigh ?? null,
    setup: d?.setup || d?.picture || '', catalyst: d?.catalyst || '', invalidation: d?.invalidation || d?.watch || '',
    strike: d?.strike ?? null, expiry: d?.expiry ?? null, agreement: d?.agreement ?? null,
    lastPrice: d?.lastPrice ?? null, priceNow: d?.priceNow ?? null, priceAt: iso(d?.priceAt),
    status: String(d?.status || 'open'), result,
    at: iso(d?.at), tookAt: iso(d?.tookAt), closedAt: iso(d?.closedAt), expiresAt: iso(d?.expiresAt),
    runId: d?.runId || null,
    // His own size, when he set one: what he typed, and the stop and targets it gave.
    mine: mineOf(d?.mine),
  };
}
const mineOf = (m) => (m && Number(m.amountCents) > 0 && Number(m.riskCents) > 0 ? {
  amountCents: Number(m.amountCents), riskCents: Number(m.riskCents),
  stop: m.stop ?? null, targets: Array.isArray(m.targets) ? m.targets : [],
  qty: m.qty ?? null, costCents: m.costCents ?? null, at: m.at ? new Date(m.at).toISOString() : null,
} : null);

/** Where the run is, in the words the RUN TRADING DESK line needs. */
export function runBlock(run, now = Date.now()) {
  if (!run) return { status: 'idle', alive: false };
  const iso = (v) => (v ? new Date(v).toISOString() : null);
  return {
    status: ['queued', 'researching', 'decide', 'deciding', 'error', 'idle'].includes(run.status) ? run.status : 'idle',
    alive: runAlive(run, now),
    trigger: run.trigger || 'manual',
    queuedAt: iso(run.queuedAt), startedAt: iso(run.startedAt), finishedAt: iso(run.finishedAt),
    // When the research was handed over and when the desk took it: the progress bar's clocks.
    decideAt: iso(run.decideAt), claimedAt: iso(run.claimedAt),
    done: Number(run.done) || 0, of: LENSES.length,
    count: Number.isFinite(Number(run.count)) ? Number(run.count) : null,
    error: run.status === 'error' ? (run.error || SAY.runStalled) : null,
  };
}

// ---- the board ----------------------------------------------------------------
/**
 * Everything the Trades page paints, in one answer: the desk's trades from
 * its last run that are still worth taking, the ones he took, how many ideas
 * timed out, where a run is, his balance and the market's hours. The board is
 * found by id (the last run's ids and his taken ones ride trade/state), so it
 * costs a handful of reads rather than a walk of a collection that grows.
 */
export async function tradeState(env, { now = Date.now() } = {}) {
  const [settingsDoc, stateDoc] = await Promise.all([readSettings(env), readState(env)]);
  const settings = settingsDoc?.data || {};
  const st = stateDoc?.data || {};
  let activeIds = Array.isArray(st.activeIds) ? st.activeIds : null;
  // The first read after PR 420: any play he had already taken joins the board
  // once. Not one he logged as a position (that trade was closed on the old
  // Positions page and is in History already), and not a spread, which the
  // new card cannot size.
  if (!activeIds) {
    const recent = await listDocs(env, PLAYS, { pageSize: 100, orderBy: 'at desc' }).catch(() => []);
    activeIds = recent.filter((r) => r.data?.status === 'took' && !r.data?.positionId && ['stock', 'call', 'put', undefined].includes(r.data?.instrument))
      .map((r) => r.id).slice(0, ACTIVE_MAX);
    await patchDoc(env, STATE_PATH, { activeIds }, stateDoc ? { mask: ['activeIds'] } : { mask: ['activeIds'], mustNotExist: true }).catch(() => {});
  }
  const deskIds = Array.isArray(st.desk?.ids) ? st.desk.ids : [];
  const ids = [...new Set([...activeIds, ...deskIds])].filter((id) => ID_RE.test(String(id))).slice(0, ACTIVE_MAX + 20);
  // One read for every card (2026-09-23): a request gets fifty outside
  // calls, and thirty taken trades read one by one would spend most of them.
  // While the researchers work, their document says how many are back.
  const researching = st.run?.status === 'researching';
  const [docs, balance, rdoc] = await Promise.all([
    batchGetDocs(env, ids.map((id) => `${PLAYS}/${id}`)).catch(() => ids.map(() => null)),
    balanceOf(env, settings),
    researching ? tryGet(env, RESEARCH_PATH).catch(() => null) : null,
  ]);
  const rows = docs.map((d, i) => (d ? recRow(ids[i], d.data) : null)).filter(Boolean);
  const back = rdoc && rdoc !== READ_FAILED && rdoc.data?.runId === st.run?.id
    ? LENSES.filter((L) => rdoc.data?.[`r${L.n}`]?.status === 'ok').length : null;
  const live = (r) => r.status === 'open' && (!r.expiresAt || new Date(r.expiresAt).getTime() > now);
  const recs = rows.filter((r) => deskIds.includes(r.id) && live(r));
  const timedOut = rows.filter((r) => deskIds.includes(r.id) && r.status === 'open' && !live(r)).length;
  const active = rows.filter((r) => r.status === 'took').sort((a, b) => String(b.tookAt).localeCompare(String(a.tookAt)));
  const { dateKey, minuteOfDay } = mtParts(now);
  const day = isTradingDay(dateKey);
  return {
    open: !!settings.caseId, caseId: settings.caseId || null,
    settings: publicSettings(settings, env),
    balance,
    run: back == null ? runBlock(st.run, now) : { ...runBlock(st.run, now), done: back },
    desk: st.desk ? {
      at: st.desk.at ? new Date(st.desk.at).toISOString() : null, trigger: st.desk.trigger || 'manual',
      read: st.desk.read || '', none: st.desk.none || '', count: Number(st.desk.count) || 0, reports: Number(st.desk.reports) || 0,
    } : null,
    recs, active, timedOut,
    market: {
      today: dateKey, tradingDay: day, open: isMarketOpen({ dateKey, minuteOfDay }),
      beforeOpen: !!day && minuteOfDay < MARKET_OPEN_MIN, closeAt: day === 'early' ? '11:00' : day ? MARKET_CLOSE : null,
    },
    now: new Date(now).toISOString(),
  };
}

/** RUN TRADING DESK. Queues a run and answers at once; a run already going is answered, never doubled. */
export async function tradeRun(env, { now = Date.now() } = {}) {
  const settings = (await readSettings(env))?.data || {};
  if (!settings.caseId) throw new TradeError(404, SAY.noDesk);
  const out = await requestRun(env, { trigger: 'manual', now });
  // Lost the write to another writer and nothing is running: tap again, never "queued".
  if (out.ok === false) throw new TradeError(409, SAY.busy);
  return { ok: true, already: !!out.already, run: runBlock(out.run, now) };
}

// His taken trades ride trade/state, so the board finds them by id. Written
// under a precondition and retried, because a run finishing in the same
// second writes the same document.
async function editActive(env, fn) {
  for (let i = 0; i < 4; i++) {
    const doc = await readState(env);
    const cur = Array.isArray(doc?.data?.activeIds) ? doc.data.activeIds : [];
    const next = fn(cur);
    const won = await patchDoc(env, STATE_PATH, { activeIds: next }, doc
      ? { mask: ['activeIds'], ifUpdateTime: doc.updateTime }
      : { mask: ['activeIds'], mustNotExist: true }).catch(() => false);
    if (won !== false) return next;
  }
  throw new TradeError(409, SAY.busy);
}

async function readRec(env, id) {
  if (!ID_RE.test(id)) throw new TradeError(404, SAY.noRec);
  const doc = await tryGet(env, `${PLAYS}/${id}`);
  if (doc === READ_FAILED) throw readFailedError('The trade could not be read.');
  if (!doc) throw new TradeError(404, SAY.noRec);
  return doc;
}

/** YES: he took it. The card goes electric yellow and grows PROFIT and LOSS. A second tap changes nothing. */
export async function tradeTake(env, body, now = Date.now()) {
  const id = String(body?.id || '');
  const doc = await readRec(env, id);
  const d = doc.data || {};
  // A second YES changes nothing on the trade, but still makes sure it is on
  // his active list: a first tap whose list write failed is finished here
  // rather than leaving a taken trade on no list at all.
  const addActive = (ids) => (ids.includes(id) ? ids : [id, ...ids].slice(0, ACTIVE_MAX));
  if (d.status === 'took') {
    const st = await readState(env).catch(() => null);
    if (!(st?.data?.activeIds || []).includes(id)) await editActive(env, addActive);
    return { ok: true, rec: recRow(id, d) };
  }
  if (d.status !== 'open') throw new TradeError(409, SAY.notOpen);
  const patch = { status: 'took', tookAt: new Date(now) };
  const won = await patchDoc(env, `${PLAYS}/${id}`, patch, { mask: Object.keys(patch), ifUpdateTime: doc.updateTime }).catch(() => false);
  if (won === false) throw new TradeError(409, SAY.busy);
  await editActive(env, addActive);
  return { ok: true, rec: recRow(id, { ...d, ...patch }) };
}

/** PROFIT or LOSS: the trade leaves the board for History with its setup, the result and both times. */
export async function tradeResult(env, body, now = Date.now()) {
  const id = String(body?.id || '');
  const result = String(body?.result || '');
  if (!['profit', 'loss'].includes(result)) throw new TradeError(400, SAY.badResult);
  const doc = await readRec(env, id);
  const d = doc.data || {};
  if (d.status === 'closed' && d.result === result) return { ok: true, rec: recRow(id, d) };
  if (d.status !== 'took') throw new TradeError(409, SAY.notTaken);
  const patch = { status: 'closed', result, closedAt: new Date(now) };
  const won = await patchDoc(env, `${PLAYS}/${id}`, patch, { mask: Object.keys(patch), ifUpdateTime: doc.updateTime }).catch(() => false);
  if (won === false) throw new TradeError(409, SAY.busy);
  await editActive(env, (ids) => ids.filter((x) => x !== id));
  return { ok: true, rec: recRow(id, { ...d, ...patch }) };
}

/**
 * HIS SIZE (Eric, 2026-09-23: "I should be able to manually tap on the amount
 * traded and update it, the amount I'm willing to risk, then it adjusts the
 * stop loss and take profit", "Including after the trade was accepted"). The
 * stop and targets come from planFor, the same function the card previews
 * with, so what he saw is what is saved. The desk's own stop and targets stay
 * on the trade untouched: History shows both. `reset` goes back to the desk's.
 */
export async function tradeAdjust(env, body, now = Date.now()) {
  const id = String(body?.id || '');
  const doc = await readRec(env, id);
  const d = doc.data || {};
  if (d.status !== 'open' && d.status !== 'took') throw new TradeError(409, SAY.notAdjustable);
  let mine = null;
  if (body?.reset !== true) {
    const p = planFor({ rec: d, amountCents: body?.amountCents, riskCents: body?.riskCents });
    if (!p.ok) throw new TradeError(400, p.why);
    mine = { amountCents: p.amountCents, riskCents: p.askedRiskCents, stop: p.stop, targets: p.targets, qty: p.qty, costCents: p.costCents, at: new Date(now) };
  }
  const won = await patchDoc(env, `${PLAYS}/${id}`, { mine }, { mask: ['mine'], ifUpdateTime: doc.updateTime }).catch(() => false);
  if (won === false) throw new TradeError(409, SAY.busy);
  return { ok: true, rec: recRow(id, { ...d, mine }) };
}

// ---- history ----------------------------------------------------------------------
/**
 * Every trade he closed, newest first, with the setup it was taken on and
 * PROFIT or LOSS. For his records only: nothing here ever reaches the desk.
 * The positions he logged by hand before PR 420 are his records too, so they
 * stay, read the same way.
 */
export const HISTORY_MAX = 200;
export async function tradeHistory(env) {
  const [plays, positions] = await Promise.all([
    listDocs(env, PLAYS, { pageSize: HISTORY_MAX, orderBy: 'closedAt desc' }).catch(() => []),
    listDocs(env, POSITIONS, { pageSize: HISTORY_MAX, orderBy: 'closedAt desc' }).catch(() => []),
  ]);
  // A play he took on the old page and logged as a position is one trade, not
  // two: the position is its record, so the play is left out.
  const logged = new Set(positions.filter((r) => r.data?.status === 'closed').map((r) => r.id));
  const fromPlays = plays.filter((r) => r.data?.status === 'closed' && !(r.data?.positionId && logged.has(r.data.positionId)))
    .map((r) => ({ ...recRow(r.id, r.data), source: 'desk' }));
  const fromPositions = positions.filter((r) => r.data?.status === 'closed').map((r) => {
    const p = r.data || {};
    const pnl = Number(p.pnlCents);
    return {
      ...recRow(r.id, { ...p, targets: p.target ? [p.target] : [], setup: p.note || p.structure || '' }),
      status: 'closed', result: Number.isFinite(pnl) && pnl !== 0 ? (pnl > 0 ? 'profit' : 'loss') : null,
      tookAt: p.openedAt ? new Date(p.openedAt).toISOString() : null, source: 'logged',
    };
  });
  const rows = [...fromPlays, ...fromPositions]
    .sort((a, b) => String(b.closedAt || '').localeCompare(String(a.closedAt || '')))
    .slice(0, HISTORY_MAX);
  return { rows, count: rows.length };
}

// ---- news -------------------------------------------------------------------------
// Relevance over volume (Eric: "Do not turn this into a generic financial-news
// feed."). A headline earns its place by naming a ticker on the board, or by
// being the kind of macro news that moves the whole tape.
export const MACRO_RE = /\b(fed|fomc|powell|rate (?:cut|hike|decision)s?|interest rates?|treasur(?:y|ies)|yields?|inflation|cpi|ppi|pce|jobs report|payrolls?|unemployment|jobless|gdp|recession|tariffs?|trade war|oil|opec|crude|shutdown|debt ceiling|stimulus|central bank|ecb|boj|volatility|vix|sell-?off|rally)\b/i;
export const NEWS_SHOWN = 12;
/** The live headlines worth his time: the board's tickers first, then the macro ones. Pure. */
export function relevantNews(rows, tickers = [], { max = NEWS_SHOWN } = {}) {
  const want = [...new Set(tickers.map((t) => String(t).toUpperCase()).filter((t) => TICKER_RE.test(t)))];
  const scored = (Array.isArray(rows) ? rows : []).map((n) => {
    const hits = want.filter((t) => (n.related || []).includes(t) || new RegExp(`\\b${t.replace('.', '\\.')}\\b`).test(n.headline || ''));
    return { ...n, onDesk: hits, score: hits.length ? 2 : MACRO_RE.test(`${n.headline || ''} ${n.summary || ''}`) ? 1 : 0 };
  }).filter((n) => n.score > 0);
  return scored.sort((a, b) => b.score - a.score || String(b.at || '').localeCompare(String(a.at || ''))).slice(0, max)
    .map(({ score, ...n }) => n);
}
/** Earnings that matter today: the board's tickers, and the companies big enough to move the index. Pure. */
export function relevantEarnings(rows, tickers = [], { max = 12, bigRevenue = 5e9 } = {}) {
  const want = new Set(tickers.map((t) => String(t).toUpperCase()));
  return (Array.isArray(rows) ? rows : [])
    .filter((e) => want.has(e.symbol) || (Number(e.revenueEstimate) || 0) >= bigRevenue)
    .sort((a, b) => Number(want.has(b.symbol)) - Number(want.has(a.symbol)) || (Number(b.revenueEstimate) || 0) - (Number(a.revenueEstimate) || 0))
    .slice(0, max)
    .map((e) => ({ ...e, onDesk: want.has(e.symbol) }));
}

/**
 * The News page: what the desk itself flagged on its last run, then the live
 * headlines and earnings that touch the board or the whole tape. Without a
 * market data key the desk's own list still shows and the page says why the
 * rest is empty.
 */
export async function tradeNews(env, { now = Date.now() } = {}) {
  const [settingsDoc, stateDoc] = await Promise.all([readSettings(env), readState(env)]);
  const settings = settingsDoc?.data || {};
  const st = stateDoc?.data || {};
  const key = resolveKey(env, settings);
  const { dateKey, minuteOfDay } = mtParts(now);
  const ids = [...new Set([...(st.activeIds || []), ...(st.desk?.ids || [])])].filter((id) => ID_RE.test(String(id))).slice(0, 30);
  const docs = await Promise.all(ids.map((id) => tryGet(env, `${PLAYS}/${id}`).catch(() => null)));
  const tickers = [...new Set(docs.filter((d) => d && d !== READ_FAILED && ['open', 'took'].includes(d.data?.status)).map((d) => String(d.data.ticker || '')).filter((t) => TICKER_RE.test(t)))];
  const base = {
    hasKey: !!key, asOf: new Date(now).toISOString(), today: dateKey, tradingDay: isTradingDay(dateKey),
    marketOpen: isMarketOpen({ dateKey, minuteOfDay }), tickers,
    desk: Array.isArray(st.desk?.news) ? st.desk.news : [], deskAt: st.desk?.at ? new Date(st.desk.at).toISOString() : null,
  };
  if (!key) return { ...base, headlines: [], earnings: [], throttled: false };
  const budgetBefore = quoteBudgetLeft(now);
  const [raw, cal] = await Promise.all([
    newsCached(key, now).catch(() => null),
    earningsCached(key, dateKey, now).catch(() => null),
  ]);
  return {
    ...base,
    headlines: relevantNews(newsRows(raw, now, { hours: 24, max: 60 }), tickers),
    earnings: relevantEarnings(earningsRows(cal, { max: 200 }), tickers),
    throttled: budgetBefore <= 2 || (!raw && !cal),
  };
}

/** Live quotes for the tickers on his cards. Cached and rate limited against the minute's budget. */
export async function tradeQuote(env, query, now = Date.now()) {
  const settings = (await readSettings(env))?.data || {};
  const key = resolveKey(env, settings);
  if (!key) throw new TradeError(404, SAY.noQuoteKey);
  const raw = String(query?.symbols || '').split(/[\s,]+/).map((t) => t.toUpperCase().trim()).filter(Boolean);
  const list = [...new Set(raw)];
  if (!list.length || list.length > QUOTE_MAX) throw new TradeError(400, SAY.quoteMany);
  if (!list.every((t) => TICKER_RE.test(t))) throw new TradeError(400, SAY.badTicker);
  if (quoteBudgetLeft(now) <= 0) throw new TradeError(429, SAY.quoteBudget);
  const rows = await Promise.all(list.map((t) => quoteCached(key, t, now)));
  return {
    quotes: rows.filter((q) => q && q !== 'over'),
    missing: list.filter((t, i) => !rows[i] || rows[i] === 'over'),
    at: new Date(now).toISOString(),
  };
}

/**
 * The five researchers' reports from the last run, ONLY when he has turned
 * the debug switch on (Eric: "I should NOT see the internal agent discussion
 * unless explicitly enabled for debugging."). Off, the path does not exist.
 */
export async function tradeResearch(env) {
  const settings = (await readSettings(env))?.data || {};
  if (settings.debugResearch !== true) throw new TradeError(404, SAY.notFound);
  const doc = await tryGet(env, RESEARCH_PATH);
  if (doc === READ_FAILED) throw readFailedError('The research could not be read.');
  const d = doc?.data || {};
  return {
    runId: d.runId || null, at: d.at ? new Date(d.at).toISOString() : null,
    reports: LENSES.map((L) => {
      const r = d[`r${L.n}`];
      return { n: L.n, beat: L.name, status: r?.status || 'missing', text: r?.text || '', err: r?.err || '', ms: Number(r?.ms) || null };
    }),
  };
}

// ---- the door, his balance, his settings ------------------------------------------------
/**
 * Open the desk: one case document with self and trade on it and the settings
 * pointing at it. One open desk at a time; a second call while one is open is
 * refused with the open one's id, so the shelf can walk into it instead.
 */
export async function tradeOpen(env, { now = new Date() } = {}) {
  const settings = (await readSettings(env))?.data || {};
  if (settings.caseId) {
    const cur = await tryGet(env, `cases/${settings.caseId}`);
    if (cur === READ_FAILED) throw readFailedError('The desk could not be read.');
    if (cur && cur.data.status !== 'closed') throw new TradeError(409, SAY.deskOpen, { existing: settings.caseId });
  }
  const caseId = crypto.randomUUID();
  await patchDoc(env, `cases/${caseId}`, {
    self: true,
    trade: true,
    clientUid: null,
    clientEmail: null,
    clientName: DESK_NAME,
    clientDob: null,
    clientTz: TRADE_TZ,
    clientPhone: null,
    clientAddress: null,
    status: 'confirmed',
    createdAt: now,
    // So the missing-email repair never "fixes" this one.
    bookingEmailSentAt: now,
    appointment: null,
    publicElection: { choice: 'private', history: [{ choice: 'private', at: now }] },
    addOnFollowUp: false,
    forms: {},
    files: [],
    reportDueAt: null,
    caseRateCents: 0,
    addonRateCents: 0,
    fullAccess: true,
    fullAccessAt: now,
    fullAccessRateCents: 0,
    fullAccessMonths: 0,
    fullAccessByHand: true,
    stripe: null,
    work: { seconds: 0, startedAt: null },
    hold: null,
    priorCases: [],
    carriedDx: [],
  }, { mustNotExist: true });
  // trade on the state too, so anything reading the case's state can tell it is the desk.
  await patchDoc(env, `cases/${caseId}/advisor/state`, {
    trade: true, priorCases: [], carriedDx: [], handovers: [], handoverStatus: null,
  }, { mask: ['trade', 'priorCases', 'carriedDx', 'handovers', 'handoverStatus'] });
  const patch = { caseId, openedAt: now };
  if (!settings.startedAt) patch.startedAt = mtParts(now.getTime()).dateKey;
  await patchDoc(env, SETTINGS_PATH, patch, { mask: Object.keys(patch) });
  return { ok: true, id: caseId, created: true };
}

/** His balance, as he types it. The latest one sizes every trade, and a new one re-sizes every card at once. */
export async function tradeBalance(env, body, now = Date.now()) {
  const { dateKey: today } = mtParts(now);
  const date = body?.date === undefined || body?.date === '' ? today : String(body.date).trim();
  if (!realDate(date) || date > today) throw new TradeError(400, SAY.badDate);
  if (body?.remove === true) {
    await deleteDoc(env, `${BALANCES}/${date}`).catch(() => {});
    return { ok: true, removed: date };
  }
  const cents = Number(body?.cents);
  if (!Number.isInteger(cents) || cents < 0 || cents >= 1e9) throw new TradeError(400, SAY.badCents);
  await patchDoc(env, `${BALANCES}/${date}`, { date, at: new Date(now), cents, note: '', source: 'typed' });
  return { ok: true, balance: { cents, date, typed: true } };
}

/** The few settings the desk has. The case id is the desk's own and never taken from a body. */
export async function tradeSettings(env, body) {
  const cur = (await readSettings(env))?.data || {};
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
  if (body?.riskPct !== undefined) {
    const v = Number(body.riskPct);
    if (!Number.isFinite(v) || v < 0.1 || v > 5) throw new TradeError(400, SAY.badRisk);
    patch.riskPct = Math.round(v * 100) / 100;
  }
  if (body?.watchlist !== undefined) {
    const raw = Array.isArray(body.watchlist) ? body.watchlist : String(body.watchlist || '').split(/[\s,]+/);
    const list = [...new Set(raw.map((t) => String(t || '').toUpperCase().trim()).filter(Boolean))];
    if (list.length > WATCHLIST_MAX || !list.every((t) => TICKER_RE.test(t))) throw new TradeError(400, SAY.badWatchlist);
    patch.watchlist = list.length ? list : DEFAULT_WATCHLIST;
  }
  if (body?.pushOn !== undefined) patch.pushOn = body.pushOn === true;
  if (body?.debugResearch !== undefined) patch.debugResearch = body.debugResearch === true;
  const mask = Object.keys(patch);
  if (mask.length) await patchDoc(env, SETTINGS_PATH, { ...patch, updatedAt: new Date() }, { mask: [...mask, 'updatedAt'] });
  const settings = { ...cur, ...patch };
  return { ok: true, settings: publicSettings(settings, env) };
}

/**
 * What a case panel reading the desk's case needs: nothing but the fact that
 * it is the desk. PR 420 has no reading, no scan and no chat, so the folder's
 * panel only ever hands off to the desk's own page.
 */
export async function tradePanelBlock(env) {
  const settings = (await readSettings(env))?.data || {};
  return { caseId: settings.caseId || null, pr420: true };
}

/** The dispatch behind /api/admin/trade/<sub>. The caller has already proved the admin. */
export async function tradeRoute(env, { sub, method, body, query = {}, now = Date.now() }) {
  if (method === 'GET' && sub === 'state') return tradeState(env, { now });
  if (method === 'GET' && sub === 'history') return tradeHistory(env);
  if (method === 'GET' && sub === 'news') return tradeNews(env, { now });
  if (method === 'GET' && sub === 'quote') return tradeQuote(env, query, now);
  if (method === 'GET' && sub === 'research') return tradeResearch(env);
  if (method !== 'POST') throw new TradeError(404, SAY.notFound);
  if (sub === 'run') return tradeRun(env, { now });
  if (sub === 'take') return tradeTake(env, body, now);
  if (sub === 'result') return tradeResult(env, body, now);
  if (sub === 'adjust') return tradeAdjust(env, body, now);
  if (sub === 'balance') return tradeBalance(env, body, now);
  if (sub === 'settings') return tradeSettings(env, body);
  if (sub === 'open') return tradeOpen(env, { now: new Date(now) });
  throw new TradeError(404, SAY.notFound);
}
