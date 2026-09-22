// The trade desk's routes (Eric, 2026-09-22: "Make it a case file
// highlighted green ... Just like with medical cases I can pause it or
// manually update", and then, when the clock was still in it: "I manually
// update either scan individually. No automatic.").
//
// The desk is a case on the shelf (v4.7), read by the advisor's own
// pipeline on the case's rails. It has two runs and he starts both of them
// himself: Scan, which looks only for new entries and files the setups it
// would watch, and Update, which is the full reading of his log, his
// trades and his rules. Nothing else starts either one. What lives here
// are the routes the folder's pages talk to: open a desk, the state, the
// two runs, a balance he types, the settings, his positions, a quote, and
// a play he took, skipped or closed. Everything a run files is in
// trade-desk.js, which this imports; the runs themselves are in
// advisor.js, where every model turn lives.

import { patchDoc, deleteDoc, listDocs, tryGet, READ_FAILED, readFailedError } from './firestore.js';
import { markPending, diagLog, runTradeScan } from './advisor.js';
import {
  isTradingDay, tradeMetrics, chartSeries, PROJECTION_MIN_DAYS,
  rulesOf, RULE_RANGES, defaultRules, dayStatus, realizedToday, openRisk, tradeCalc, closePnl,
  horizonOf, isMarketOpen, INSTRUMENTS,
} from '../public/js/trade-math.js';
import {
  TRADE_TZ, DESK_NAME, SAY, SETTINGS_PATH, STATE_PATH, PLAYS, BALANCES, POSITIONS, DEFAULT_WATCHLIST, WATCHLIST_MAX, KEY_RE,
  QUOTE_MAX, mtParts, mtInstant, keyTail, resolveKey, watchlistOf, startOf, realDate, stripDashes, refreshStanding,
  readPositions, sortPositions, quoteCached, quoteBudgetLeft, rid,
} from './trade-desk.js';

// ---- constants ------------------------------------------------------------
// NOTHING ON THE DESK RUNS BUT HIS TAP (Eric, 2026-09-22: "I manually update
// either scan individually. No automatic."). Three slots a trading day used
// to live here, with the window a cron firing could claim one in, the
// calendar that walked to the next, and the claim that kept two isolates
// from booking the same reading. All of it is gone. What is left is the
// market calendar itself, which the desk still needs to say whether the
// market is open today, and the two runs he starts: Scan and Update.
// ---- end constants --------------------------------------------------------

export class TradeError extends Error {
  constructor(status, message, extra = null) { super(message); this.status = status; this.extra = extra; }
}

// ---- documents --------------------------------------------------------------
async function readSettings(env) {
  const doc = await tryGet(env, SETTINGS_PATH);
  if (doc === READ_FAILED) throw readFailedError('The desk settings could not be read.');
  return doc;
}

function publicSettings(settings) {
  return {
    accountType: settings?.accountType === 'margin' ? 'margin' : 'cash',
    watchlist: watchlistOf(settings),
    pushOn: settings?.pushOn !== false,
    startedAt: settings?.startedAt || null,
    startCents: startOf(settings),
    rules: rulesOf(settings),
    celebrate: settings?.celebrate !== false,
  };
}

// ---- his positions (Eric, 2026-09-22) -----------------------------------------
//
// "I just update the total in my portfolio nightly and input any active
// trades. Once I sell, I can log it and leave a note if I want otherwise it
// disappears." So a position is his, not the desk's: what he is actually in,
// with the arithmetic of the calculator hung off it. The plays the reading
// files stay what they are, a suggestion; taking one can open a position
// from it.
const PRICE_RE = /^\d{1,7}(\.\d{1,4})?$/;
const price = (v, required = true) => {
  if (v === '' || v === null || v === undefined) {
    if (required) throw new TradeError(400, SAY.badPrice);
    return null;
  }
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || !PRICE_RE.test(String(n))) throw new TradeError(400, SAY.badPrice);
  return n;
};

/** One position off a body, validated field by field with the sentence that says what is wrong. */
function validPosition(body, existing = null, now = Date.now()) {
  const base = existing || {};
  const ticker = String(body?.ticker ?? base.ticker ?? '').toUpperCase().trim();
  if (!/^[A-Z][A-Z.]{0,5}$/.test(ticker)) throw new TradeError(400, SAY.badTicker);
  const side = String(body?.side ?? base.side ?? '').toLowerCase();
  if (!['long', 'short'].includes(side)) throw new TradeError(400, SAY.badSide);
  const instrument = String(body?.instrument ?? base.instrument ?? '').toLowerCase();
  if (!INSTRUMENTS.includes(instrument)) throw new TradeError(400, SAY.badInstrument);
  const horizon = horizonOf(String(body?.horizon ?? base.horizon ?? 'intraday').toLowerCase());
  if (!horizon) throw new TradeError(400, SAY.badHorizon);
  const qty = Number(body?.qty ?? base.qty);
  if (!Number.isInteger(qty) || qty < 1 || qty > 1_000_000) throw new TradeError(400, SAY.badQty);
  const entry = price(body?.entry ?? base.entry);
  const stop = price(body?.stop ?? base.stop ?? null, false);
  const target = price(body?.target ?? base.target ?? null, false);
  const mark = price(body?.mark ?? base.mark ?? null, false);
  const credit = body?.credit === undefined ? base.credit === true : body.credit === true;
  let width = null;
  if (instrument === 'spread') {
    const w = body?.width ?? base.width ?? null;
    if (w !== null && w !== '' && w !== undefined) {
      const n = Number(w);
      if (!Number.isFinite(n) || n <= 0) throw new TradeError(400, SAY.badWidth);
      width = n;
    } else if (credit) throw new TradeError(400, SAY.badWidth);
  }
  const expiry = body?.expiry ?? base.expiry ?? null;
  if (expiry && !realDate(String(expiry))) throw new TradeError(400, SAY.badDate);
  const { dateKey } = mtParts(now);
  return {
    ticker, side, instrument, horizon, qty, entry, stop, target, mark, credit, width,
    expiry: expiry ? String(expiry) : null,
    structure: stripDashes(String(body?.structure ?? base.structure ?? '')).trim().slice(0, 120),
    note: stripDashes(String(body?.note ?? base.note ?? '')).trim().slice(0, 300),
    openedAt: base.openedAt || new Date(now),
    openedDay: base.openedDay || dateKey,
    status: base.status || 'open',
    fromPlay: base.fromPlay || (body?.fromPlay ? String(body.fromPlay).slice(0, 40) : null),
  };
}

/** The account as the rules measure it: his last balance entry, or the start. One read. */
async function accountCentsOf(env, settings) {
  const rows = await listDocs(env, BALANCES, { pageSize: 1, orderBy: 'date desc' }).catch(() => []);
  const last = rows[0]?.data;
  return Number.isFinite(Number(last?.cents)) ? Math.round(Number(last.cents)) : startOf(settings);
}

/** What the Trades and Calc pages paint: his positions with their arithmetic, his rules, and where the day stands. */
export async function tradePositions(env, { now = Date.now() } = {}) {
  const settings = (await readSettings(env))?.data || {};
  const [rows, accountCents] = await Promise.all([readPositions(env), accountCentsOf(env, settings)]);
  const rules = rulesOf(settings);
  const { dateKey, minuteOfDay } = mtParts(now);
  const accountType = settings.accountType === 'margin' ? 'margin' : 'cash';
  const open = rows.filter((p) => p.status === 'open');
  const closedToday = rows.filter((p) => p.status === 'closed' && p.closedDay === dateKey);
  const recent = rows.filter((p) => p.status === 'closed' && p.closedDay !== dateKey).slice(0, 10);
  const withCalc = (p) => ({ ...p, calc: tradeCalc({ pos: p, rules, accountCents, todayKey: dateKey, accountType }) });
  return {
    positions: [...sortPositions(open), ...closedToday, ...recent].map(withCalc),
    openCount: open.length,
    rules, accountCents, accountType,
    today: dateKey, tradingDay: isTradingDay(dateKey), marketOpen: isMarketOpen({ dateKey, minuteOfDay }),
    hasKey: !!resolveKey(env, settings),
    dayStatus: dayStatus({ rules, accountCents, realizedTodayCents: realizedToday(rows, dateKey), openRiskCents: openRisk(rows) }),
    now: new Date(now).toISOString(),
  };
}

/** A position he typed, new or edited. The risk is stored with it so the day's arithmetic never has to recompute every row. */
export async function tradePosition(env, body, now = Date.now()) {
  const settings = (await readSettings(env))?.data || {};
  const id = String(body?.id || '');
  let existing = null;
  if (id) {
    if (!/^[\w-]{1,40}$/.test(id)) throw new TradeError(404, SAY.noPosition);
    const doc = await tryGet(env, `${POSITIONS}/${id}`);
    if (doc === READ_FAILED) throw readFailedError('The position could not be read.');
    if (!doc) throw new TradeError(404, SAY.noPosition);
    if (doc.data.status === 'closed') throw new TradeError(409, SAY.closedAlready);
    existing = doc.data;
  }
  const pos = validPosition(body, existing, now);
  const [accountCents] = await Promise.all([accountCentsOf(env, settings)]);
  const rules = rulesOf(settings);
  const { dateKey } = mtParts(now);
  const calc = tradeCalc({ pos, rules, accountCents, todayKey: dateKey, accountType: settings.accountType === 'margin' ? 'margin' : 'cash' });
  const row = { ...pos, riskCents: calc.riskCents, updatedAt: new Date(now) };
  const key = id || rid('t');
  await patchDoc(env, `${POSITIONS}/${key}`, row);
  // Taken from a play: the play remembers the position it became.
  if (!id && pos.fromPlay) {
    await patchDoc(env, `${PLAYS}/${pos.fromPlay}`, { status: 'took', tookAt: new Date(now), positionId: key }, { mask: ['status', 'tookAt', 'positionId'] }).catch(() => {});
  }
  const all = await readPositions(env);
  return {
    ok: true, position: { id: key, ...row }, calc,
    dayStatus: dayStatus({ rules, accountCents, realizedTodayCents: realizedToday(all, dateKey), openRiskCents: openRisk(all) }),
  };
}

/** Sold: the exit price or the dollars, the note he may leave, and the day's arithmetic after it. */
export async function tradeClose(env, body, now = Date.now()) {
  const id = String(body?.id || '');
  if (!/^[\w-]{1,40}$/.test(id)) throw new TradeError(404, SAY.noPosition);
  const doc = await tryGet(env, `${POSITIONS}/${id}`);
  if (doc === READ_FAILED) throw readFailedError('The position could not be read.');
  if (!doc) throw new TradeError(404, SAY.noPosition);
  if (doc.data.status === 'closed') throw new TradeError(409, SAY.closedAlready);
  const pos = doc.data;
  let pnlCents = null;
  let exitPrice = null;
  if (body?.exitPrice !== undefined && body.exitPrice !== '' && body.exitPrice !== null) {
    exitPrice = price(body.exitPrice);
    pnlCents = closePnl({ pos, exitPrice });
  } else if (body?.pnlCents !== undefined) {
    const c = Number(body.pnlCents);
    if (!Number.isInteger(c) || Math.abs(c) >= 1e9) throw new TradeError(400, SAY.badExit);
    pnlCents = c;
  }
  if (pnlCents === null || !Number.isFinite(pnlCents)) throw new TradeError(400, SAY.badExit);
  const settings = (await readSettings(env))?.data || {};
  const { dateKey } = mtParts(now);
  const patch = {
    status: 'closed', closedAt: new Date(now), closedDay: dateKey, exitPrice, pnlCents,
    closeNote: stripDashes(String(body?.note || '')).trim().slice(0, 300),
  };
  await patchDoc(env, `${POSITIONS}/${id}`, patch, { mask: Object.keys(patch) });
  const [all, accountCents] = await Promise.all([readPositions(env), accountCentsOf(env, settings)]);
  const rules = rulesOf(settings);
  return {
    ok: true, position: { id, ...pos, ...patch }, pnlCents,
    dayStatus: dayStatus({ rules, accountCents, realizedTodayCents: realizedToday(all, dateKey), openRiskCents: openRisk(all) }),
    celebrate: pnlCents > 0 && settings.celebrate !== false,
  };
}

/** Gone: a row he typed by mistake, open or closed. */
export async function tradeRemove(env, body) {
  const id = String(body?.id || '');
  if (!/^[\w-]{1,40}$/.test(id)) throw new TradeError(404, SAY.noPosition);
  await deleteDoc(env, `${POSITIONS}/${id}`).catch(() => {});
  return { ok: true, removed: id };
}

/** Live quotes for the tickers he is actually in. Cached and rate limited, because the reading spends most of the minute's budget. */
export async function tradeQuote(env, query, now = Date.now()) {
  const settings = (await readSettings(env))?.data || {};
  const key = resolveKey(env, settings);
  if (!key) throw new TradeError(404, SAY.noQuoteKey);
  const raw = String(query?.symbols || '').split(/[\s,]+/).map((t) => t.toUpperCase().trim()).filter(Boolean);
  const list = [...new Set(raw)];
  if (!list.length || list.length > QUOTE_MAX) throw new TradeError(400, SAY.quoteMany);
  if (!list.every((t) => /^[A-Z][A-Z.]{0,5}$/.test(t))) throw new TradeError(400, SAY.badTicker);
  if (quoteBudgetLeft(now) <= 0) throw new TradeError(429, SAY.quoteBudget);
  const rows = await Promise.all(list.map((t) => quoteCached(key, t, now)));
  return {
    quotes: rows.filter((q) => q && q !== 'over'),
    missing: list.filter((t, i) => !rows[i] || rows[i] === 'over'),
    at: new Date(now).toISOString(),
  };
}

// ---- the routes ------------------------------------------------------------
/**
 * Open the desk: one case document with self and trade on it, its advisor
 * state marked as the desk's, and the settings pointing at it. One open
 * desk at a time; a second call while one is open is refused with the
 * open one's id, so the shelf can walk into it instead.
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
  // trade on the state too, so the panel's poll can tell without reading
  // the case document on every tick.
  await patchDoc(env, `cases/${caseId}/advisor/state`, {
    trade: true, priorCases: [], carriedDx: [], handovers: [], handoverStatus: null,
  }, { mask: ['trade', 'priorCases', 'carriedDx', 'handovers', 'handoverStatus'] });
  const patch = { caseId, openedAt: now };
  if (!settings.startedAt) patch.startedAt = mtParts(now.getTime()).dateKey;
  await patchDoc(env, SETTINGS_PATH, patch, { mask: Object.keys(patch) });
  return { ok: true, id: caseId, created: true };
}

/** The Stats and Desk pages in one answer. The key never rides; only whether one is on file and its last four characters. */
export async function tradeState(env, { now = Date.now() } = {}) {
  const [settingsDoc, plays, balances, stateDoc] = await Promise.all([
    readSettings(env),
    listDocs(env, PLAYS, { pageSize: 50, orderBy: 'at desc' }).catch(() => []),
    listDocs(env, BALANCES, { pageSize: 400, orderBy: 'date asc', all: true }).catch(() => []),
    tryGet(env, STATE_PATH).catch(() => null),
  ]);
  const settings = settingsDoc?.data || {};
  const key = resolveKey(env, settings);
  const pub = publicSettings(settings);
  const rows = balances.map((b) => ({ date: b.data?.date || b.id, cents: b.data?.cents, note: b.data?.note || '', source: b.data?.source || 'typed' }));
  const metrics = tradeMetrics(rows, { startedAt: pub.startedAt, startCents: pub.startCents, target: pub.rules.dayAimPct / 100, minDays: PROJECTION_MIN_DAYS });
  const sources = new Map(rows.map((b) => [b.date, b.source]));
  const { dateKey } = mtParts(now);
  return {
    caseId: settings.caseId || null,
    settings: pub, hasKey: !!key, keyTail: keyTail(key),
    plays: plays.map((r) => ({ id: r.id, ...r.data })),
    balances: metrics.entries.map((e) => ({ ...e, source: sources.get(e.date) || 'typed' })),
    metrics, chart: chartSeries(metrics),
    tradingDay: isTradingDay(dateKey), today: dateKey,
    scan: scanBlock(stateDoc),
    now: new Date(now).toISOString(),
  };
}

/**
 * What his Scan button needs to know: whether one is in the air, what the
 * last one said, and when. Pure apart from the read it is handed, so the
 * page and the panel read the scan the same way (2026-09-22).
 */
export function scanBlock(stateDoc) {
  const st = (stateDoc && stateDoc !== READ_FAILED ? stateDoc.data : null) || {};
  const note = st.scanNote || null;
  return {
    status: st.scanStatus === 'running' ? 'running' : st.scanStatus === 'error' ? 'error' : 'idle',
    error: st.scanError || null,
    at: st.lastScanAt ? new Date(st.lastScanAt).toISOString() : null,
    note: note ? { text: String(note.text || ''), at: note.at ? new Date(note.at).toISOString() : null, plays: Number(note.plays) || 0 } : null,
  };
}

/** What the advisor panel needs on its poll: the plays for the Plays page, the standing, the next read, the two switches. Three small reads. */
export async function tradePanelBlock(env, { now = Date.now() } = {}) {
  const settings = (await readSettings(env))?.data || {};
  // Three reads, in one round trip: the plays, the cover's standing, and
  // whether a scan he tapped is still in the air (2026-09-22).
  const [plays, meta, state] = await Promise.all([
    listDocs(env, PLAYS, { pageSize: 30, orderBy: 'at desc' }).catch(() => []),
    settings.caseId ? tryGet(env, `caseMeta/${settings.caseId}`) : Promise.resolve(null),
    tryGet(env, STATE_PATH).catch(() => null),
  ]);
  const key = resolveKey(env, settings);
  const { dateKey } = mtParts(now);
  return {
    plays: plays.map((r) => ({ id: r.id, ...r.data })),
    standing: meta && meta !== READ_FAILED ? (meta.data?.tradeStanding || null) : null,
    pushOn: settings.pushOn !== false,
    hasKey: !!key, tradingDay: isTradingDay(dateKey), today: dateKey,
    rules: rulesOf(settings),
    scan: scanBlock(state),
  };
}

/** A balance he typed: the row for its date, stamped typed so a screenshot never overwrites it, and the cover's standing refreshed. */
export async function tradeBalance(env, body, now = Date.now()) {
  const date = String(body?.date || '').trim();
  const { dateKey: today } = mtParts(now);
  if (!realDate(date) || date > today) throw new TradeError(400, SAY.badDate);
  if (body?.remove === true) {
    await deleteDoc(env, `${BALANCES}/${date}`).catch(() => {});
    await refreshStanding(env, { now }).catch(() => {});
    return { ok: true, removed: date };
  }
  const cents = Number(body?.cents);
  if (!Number.isInteger(cents) || cents < 0 || cents >= 1e9) throw new TradeError(400, SAY.badCents);
  const note = stripDashes(String(body?.note || '')).trim().slice(0, 140);
  await patchDoc(env, `${BALANCES}/${date}`, { date, at: new Date(now), cents, note, source: 'typed' });
  const standing = await refreshStanding(env, { now }).catch(() => null);
  return { ok: true, date, cents, standing };
}

/**
 * THE SCAN, ON HIS TAP (Eric, 2026-09-22: "I manually update either scan
 * individually. No automatic."). Looks only for new entries: it files the
 * setups it would watch right now and a short note saying why, and touches
 * nothing else on the desk. The full reading is the other button, and books
 * itself the way his tap has always booked one, through markPending.
 */
async function tradeScan(env, { now = Date.now() } = {}) {
  const settings = (await readSettings(env))?.data || {};
  if (!settings.caseId) throw new TradeError(404, SAY.noDesk);
  const out = await runTradeScan(env, settings.caseId, { now });
  if (!out.ok && out.why === SAY.scanRunning) throw new TradeError(409, SAY.scanRunning);
  if (!out.ok) throw new TradeError(502, out.why || SAY.scanRunning);
  return { ok: true, status: 'running', caseId: settings.caseId };
}

/** The settings, by his hand. The case id is the desk's own and never taken from a body. */
export async function tradeSettings(env, body) {
  const patch = {};
  const cur0 = (await readSettings(env))?.data || {};
  const cur = cur0;
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
    if (list.length > WATCHLIST_MAX || !list.every((t) => /^[A-Z][A-Z.]{0,5}$/.test(t))) throw new TradeError(400, SAY.badWatchlist);
    patch.watchlist = list.length ? list : DEFAULT_WATCHLIST;
  }
  if (body?.pushOn !== undefined) patch.pushOn = body.pushOn === true;
  if (body?.celebrate !== undefined) patch.celebrate = body.celebrate === true;
  // His rules, the ones the whole calculator reads (2026-09-22). Each one
  // inside its range, and the floor under the aim under the cap, or the
  // sentence says what the ranges are and nothing is written.
  if (body?.rules !== undefined) {
    const r = body.rules;
    if (!r || typeof r !== 'object') throw new TradeError(400, SAY.badRules);
    const next = { ...rulesOf(cur0) };
    for (const k of Object.keys(defaultRules())) {
      if (r[k] === undefined) continue;
      const v = Number(r[k]);
      const [lo, hi] = RULE_RANGES[k];
      if (!Number.isFinite(v) || v < lo || v > hi) throw new TradeError(400, SAY.badRules);
      next[k] = Math.round(v * 100) / 100;
    }
    if (!(next.dayFloorPct < next.dayAimPct && next.dayAimPct < next.dayCapPct)) throw new TradeError(400, SAY.badRules);
    patch.rules = next;
  }
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
  if (!cur.startedAt && !patch.startedAt) patch.startedAt = mtParts().dateKey;
  const mask = Object.keys(patch);
  if (mask.length) {
    await patchDoc(env, SETTINGS_PATH, { ...patch, setByHand: true, updatedAt: new Date() }, { mask: [...mask, 'setByHand', 'updatedAt'] });
  }
  const settings = { ...cur, ...patch };
  const key = resolveKey(env, settings);
  // The start moved: the cover's standing is measured from it.
  // The start moved, or the aim did: the cover's standing is measured from both.
  if (patch.startCents !== undefined || patch.startedAt !== undefined || patch.rules !== undefined) await refreshStanding(env, { settings }).catch(() => {});
  return { ok: true, settings: publicSettings(settings), hasKey: !!key, keyTail: keyTail(key) };
}

/** Took it, Skip, or Closed at: his word on a play, whether or not its window has passed. */
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

/** The dispatch behind /api/admin/trade/<sub>. The caller has already proved the admin. */
export async function tradeRoute(env, { sub, method, body, query = {}, now = Date.now() }) {
  if (method === 'GET' && sub === 'state') return tradeState(env, { now });
  if (method === 'GET' && sub === 'positions') return tradePositions(env, { now });
  if (method === 'GET' && sub === 'quote') return tradeQuote(env, query, now);
  if (method !== 'POST') throw new TradeError(404, SAY.notFound);
  if (sub === 'open') return tradeOpen(env, { now: new Date(now) });
  if (sub === 'balance') return tradeBalance(env, body, now);
  if (sub === 'settings') return tradeSettings(env, body);
  if (sub === 'play') return tradePlay(env, body);
  if (sub === 'scan') return tradeScan(env, { now });
  if (sub === 'position') return tradePosition(env, body, now);
  if (sub === 'close') return tradeClose(env, body, now);
  if (sub === 'remove') return tradeRemove(env, body);
  throw new TradeError(404, SAY.notFound);
}
