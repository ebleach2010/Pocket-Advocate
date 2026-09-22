// The trade desk's cron minute and its routes (Eric, 2026-09-22: "Make it a
// case file highlighted green. run it automatically at 7am, 10am, noon on
// trading days. Just like with medical cases I can pause it or manually
// update.").
//
// The desk is a case on the shelf now (v4.7), read by the advisor's own
// pipeline on the case's rails: the cron's minute books a reading at each
// slot the way his tap does (markPending), and the reading itself runs,
// lands and files through advisor.js. What lives here is the calendar, the
// slot claim, and the routes the folder's Stats and Desk pages talk to:
// open a desk, the state, a balance he types, the settings (Pause is a
// setting), and a play he took, skipped or closed. Everything the reading
// files is in trade-desk.js, which this imports.
//
// Three slots on a trading day, 07:00, 10:00 and 12:00 Mountain (his
// hours), two on an early-close day, none on a weekend or an exchange
// holiday. The cron's minute costs nothing outside the three twenty-minute
// windows: the slot is computed before any read, and inside a window the
// slot is claimed conditionally on the state document so two isolates
// never both book the same reading.

import { patchDoc, deleteDoc, listDocs, tryGet, READ_FAILED, readFailedError } from './firestore.js';
import { markPending, diagLog } from './advisor.js';
import { isTradingDay, tradeMetrics, chartSeries, TARGET_DAILY, PROJECTION_MIN_DAYS } from '../public/js/trade-math.js';
import {
  TRADE_TZ, DESK_NAME, SAY, SETTINGS_PATH, STATE_PATH, PLAYS, BALANCES, DEFAULT_WATCHLIST, WATCHLIST_MAX, KEY_RE,
  mtParts, mtInstant, keyTail, resolveKey, watchlistOf, startOf, realDate, stripDashes, refreshStanding,
} from './trade-desk.js';

// ---- constants ------------------------------------------------------------
// "run it automatically at 7am, 10am, noon on trading days": 07:00 is before
// the 07:30 open, a premarket read; noon is inside the last two hours.
export const SCAN_SLOTS = ['07:00', '10:00', '12:00'];
// An early close is 13:00 Eastern, which is 11:00 Mountain: noon would
// already be after the bell.
export const EARLY_CLOSE_SLOTS = ['07:00', '10:00'];
// A slot fires on the first cron firing inside this many minutes after it.
export const SCAN_WINDOW_MIN = 20;
// ---- end constants --------------------------------------------------------

export class TradeError extends Error {
  constructor(status, message, extra = null) { super(message); this.status = status; this.extra = extra; }
}

// ---- the calendar, on his clock ------------------------------------------
const slotMinute = (slot) => Number(slot.slice(0, 2)) * 60 + Number(slot.slice(3, 5));

/** The slots a given day gets: none, the two before an early close, or all three. */
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

/** The next reading after `now`, walking up to two weeks of days. */
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

/** Whether a reading is owed right now, and why not when it is not. Pure. */
export function scanDue({ state, settings, now = Date.now() }) {
  const slot = slotKeyFor(now);
  if (!slot) return { due: false, key: null, why: 'no slot' };
  if (settings?.scansOn === false) return { due: false, key: slot.key, why: 'paused' };
  if (!settings?.caseId) return { due: false, key: slot.key, why: 'no desk' };
  if (state?.lastSlot === slot.key) return { due: false, key: slot.key, why: 'already ran' };
  return { due: true, key: slot.key, why: 'due' };
}

/**
 * The cron's minute: cheap outside the three windows (no read at all), and
 * inside one a conditional claim on the slot before a reading is booked, so
 * two isolates on the same minute never both book it. A desk that is
 * closed, deleted or paused books nothing. What it books is exactly what
 * his tap books: a pending reading on the case, which the drain runs.
 */
export async function maybeTradeScan(env, now = Date.now()) {
  const slot = slotKeyFor(now);
  if (!slot) return { ran: false, why: 'no slot' };
  const settingsDoc = await tryGet(env, SETTINGS_PATH);
  const stateDoc = await tryGet(env, STATE_PATH);
  if (settingsDoc === READ_FAILED || stateDoc === READ_FAILED) return { ran: false, why: 'unreadable' };
  const settings = settingsDoc?.data || {};
  const due = scanDue({ state: stateDoc?.data || {}, settings, now });
  if (!due.due) return { ran: false, why: due.why };
  const caseDoc = await tryGet(env, `cases/${settings.caseId}`);
  if (caseDoc === READ_FAILED) return { ran: false, why: 'unreadable' };
  if (!caseDoc || !caseDoc.data.trade || caseDoc.data.status === 'closed') return { ran: false, why: 'no desk' };
  const claimed = await patchDoc(env, STATE_PATH, { lastSlot: slot.key, claimedAt: new Date() },
    stateDoc ? { mask: ['lastSlot', 'claimedAt'], ifUpdateTime: stateDoc.updateTime } : { mask: ['lastSlot', 'claimedAt'], mustNotExist: true }).catch(() => false);
  if (!claimed) { await diagLog(env, { ev: 'trade-claim-lost', slot: slot.key }); return { ran: false, why: 'claim lost' }; }
  await markPending(env, 'case', settings.caseId);
  await diagLog(env, { ev: 'trade-slot', slot: slot.key, caseId: settings.caseId });
  return { ran: true, why: 'due', key: slot.key, caseId: settings.caseId };
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
    scansOn: settings?.scansOn !== false,
    pushOn: settings?.pushOn !== false,
    startedAt: settings?.startedAt || null,
    startCents: startOf(settings),
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
  const [settingsDoc, plays, balances] = await Promise.all([
    readSettings(env),
    listDocs(env, PLAYS, { pageSize: 50, orderBy: 'at desc' }).catch(() => []),
    listDocs(env, BALANCES, { pageSize: 400, orderBy: 'date asc', all: true }).catch(() => []),
  ]);
  const settings = settingsDoc?.data || {};
  const key = resolveKey(env, settings);
  const pub = publicSettings(settings);
  const rows = balances.map((b) => ({ date: b.data?.date || b.id, cents: b.data?.cents, note: b.data?.note || '', source: b.data?.source || 'typed' }));
  const metrics = tradeMetrics(rows, { startedAt: pub.startedAt, startCents: pub.startCents, target: TARGET_DAILY, minDays: PROJECTION_MIN_DAYS });
  const sources = new Map(rows.map((b) => [b.date, b.source]));
  const { dateKey } = mtParts(now);
  return {
    caseId: settings.caseId || null,
    settings: pub, hasKey: !!key, keyTail: keyTail(key),
    plays: plays.map((r) => ({ id: r.id, ...r.data })),
    balances: metrics.entries.map((e) => ({ ...e, source: sources.get(e.date) || 'typed' })),
    metrics, chart: chartSeries(metrics),
    nextSlot: nextSlotAfter(now), tradingDay: isTradingDay(dateKey), today: dateKey, scansOn: pub.scansOn,
    now: new Date(now).toISOString(),
  };
}

/** What the advisor panel needs on its poll: the plays for the Plays page, the standing, the next read, the two switches. Three small reads. */
export async function tradePanelBlock(env, { now = Date.now() } = {}) {
  const settings = (await readSettings(env))?.data || {};
  const [plays, meta] = await Promise.all([
    listDocs(env, PLAYS, { pageSize: 30, orderBy: 'at desc' }).catch(() => []),
    settings.caseId ? tryGet(env, `caseMeta/${settings.caseId}`) : Promise.resolve(null),
  ]);
  const key = resolveKey(env, settings);
  const { dateKey } = mtParts(now);
  return {
    plays: plays.map((r) => ({ id: r.id, ...r.data })),
    standing: meta && meta !== READ_FAILED ? (meta.data?.tradeStanding || null) : null,
    nextSlot: nextSlotAfter(now), scansOn: settings.scansOn !== false, pushOn: settings.pushOn !== false,
    hasKey: !!key, tradingDay: isTradingDay(dateKey), today: dateKey,
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

/** The settings, by his hand. scansOn is the Pause. The case id is the desk's own and never taken from a body. */
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
    if (list.length > WATCHLIST_MAX || !list.every((t) => /^[A-Z][A-Z.]{0,5}$/.test(t))) throw new TradeError(400, SAY.badWatchlist);
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
  // The start moved: the cover's standing is measured from it.
  if (patch.startCents !== undefined || patch.startedAt !== undefined) await refreshStanding(env, { settings }).catch(() => {});
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
export async function tradeRoute(env, { sub, method, body, now = Date.now() }) {
  if (method === 'GET' && sub === 'state') return tradeState(env, { now });
  if (method !== 'POST') throw new TradeError(404, SAY.notFound);
  if (sub === 'open') return tradeOpen(env, { now: new Date(now) });
  if (sub === 'balance') return tradeBalance(env, body, now);
  if (sub === 'settings') return tradeSettings(env, body);
  if (sub === 'play') return tradePlay(env, body);
  throw new TradeError(404, SAY.notFound);
}
