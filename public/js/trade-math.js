// The arithmetic behind the Trade portal's Account and Stats tabs, in one
// place so the Worker (which computes the payload), the demo mirror (which
// stands in for the Worker) and any check agree to the cent. Pure: no fetch,
// no dates read from the clock, nothing but the arguments. No secrets, so a
// public path is fine; nothing here is worth gating.

// NYSE closures. Hand-entered from the exchange calendar for 2026 and 2027;
// 2028 needs adding before it arrives. An early close is 13:00 Eastern,
// which is 11:00 Mountain.
export const NYSE_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31', '2027-06-18',
  '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
]);
export const NYSE_EARLY_CLOSE = new Set(['2026-11-27', '2026-12-24', '2027-11-26']);

// His daily aim, as the default rule says it (2026-09-22: "at LEAST 1% of
// gains a day (optimally 2%)"); the standing line, the chart's line and the
// desk note all read it from the rules, and this is what they read when no
// rule has been set by hand.
export const TARGET_DAILY = defaultRules().dayAimPct / 100;
export const PROJECTION_MIN_DAYS = 14;
export const TRADING_DAYS_PER_YEAR = 252;
export const DEFAULT_START_CENTS = 200000;

/** false on a weekend or a holiday, 'early' on a 13:00 Eastern close, else 'full'. */
export function isTradingDay(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return false;
  const dow = new Date(`${dateKey}T12:00:00Z`).getUTCDay();
  if (dow === 0 || dow === 6) return false;
  if (NYSE_HOLIDAYS.has(dateKey)) return false;
  return NYSE_EARLY_CLOSE.has(dateKey) ? 'early' : 'full';
}

/** The day after, as a key. */
export function nextDateKey(dateKey) {
  const t = new Date(`${dateKey}T12:00:00Z`).getTime() + 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Trading days strictly after `fromKey` up to and including `toKey`; 0 when toKey is not later. */
export function tradingDaysBetween(fromKey, toKey) {
  if (!fromKey || !toKey || String(toKey) <= String(fromKey)) return 0;
  let n = 0;
  let d = nextDateKey(fromKey);
  // Bounded: two thousand calendar days is over seven years of entries.
  for (let i = 0; i < 2000 && d <= toKey; i++) {
    if (isTradingDay(d)) n += 1;
    d = nextDateKey(d);
  }
  return n;
}

/**
 * Where he stands against his aim a day. `balances` are { date, cents, note }
 * rows in any order; the start is whatever he set (2000 by default) on
 * `startedAt`. Days are trading days, not calendar days, so a weekend costs
 * him nothing against the target.
 */
export function tradeMetrics(balances, { startedAt, startCents = DEFAULT_START_CENTS, target = TARGET_DAILY, minDays = PROJECTION_MIN_DAYS } = {}) {
  const start = Number.isFinite(Number(startCents)) && Number(startCents) > 0 ? Math.round(Number(startCents)) : DEFAULT_START_CENTS;
  const rows = (Array.isArray(balances) ? balances : [])
    .filter((b) => b && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || '')) && Number.isFinite(Number(b.cents)))
    .map((b) => ({ date: String(b.date), cents: Math.round(Number(b.cents)), note: String(b.note || '') }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const entries = rows.map((b) => ({ ...b, dayIndex: startedAt ? tradingDaysBetween(startedAt, b.date) : 0 }));
  const last = entries[entries.length - 1] || null;
  const days = last ? last.dayIndex : 0;
  const currentCents = last ? last.cents : start;
  const gainCents = currentCents - start;
  const avgDaily = days > 0 && currentCents > 0 ? Math.pow(currentCents / start, 1 / days) - 1 : 0;
  const targetCents = Math.round(start * Math.pow(1 + target, days));
  const projections = days >= minDays
    ? {
      linearYearCents: Math.round((gainCents / days) * TRADING_DAYS_PER_YEAR),
      compoundYearCents: Math.round(currentCents * Math.pow(1 + avgDaily, TRADING_DAYS_PER_YEAR) - currentCents),
    }
    : null;
  return {
    startCents: start, startedAt: startedAt || null, days, currentCents, gainCents,
    totalReturn: start ? gainCents / start : 0,
    avgDaily,
    target,
    offTargetPoints: (avgDaily - target) * 100,
    targetCents,
    offTargetCents: currentCents - targetCents,
    projections,
    minDays,
    entries,
  };
}

/** The two lines the chart draws: his entries, and the target over the same days. */
export function chartSeries(m) {
  const start = m.startCents;
  const pts = m.entries.map((e) => ({ x: e.dayIndex, y: e.cents }));
  const points = pts.some((p) => p.x === 0) ? pts : [{ x: 0, y: start }, ...pts];
  const target = [];
  for (let x = 0; x <= m.days; x++) target.push({ x, y: Math.round(start * Math.pow(1 + m.target, x)) });
  const ys = [...points, ...target].map((p) => p.y);
  return { points, target, xMax: Math.max(m.days, 1), yMax: Math.max(...ys, 1), yMin: Math.min(...ys, start) };
}

// ---- the calculator (Eric, 2026-09-22) ----------------------------------------
//
// "A calculator to help me with take profits and stop losses. With a 4k ish
// account and the ambition of at LEAST 1% of gains a day (optimally 2%, stop
// at 10% portfolio total even if I hit a big home run)." What day traders
// actually do, from the research that day: risk a fixed slice of the
// account on one trade (the 1% rule), size the position from the distance
// to the stop, write the target as a multiple of that distance (R), and
// stop for the day at a set loss and at a set gain. All of it is here, pure,
// so the Worker, the demo and the checks agree to the cent. Money is integer
// cents; prices are numbers to four decimals; options are quoted per share
// and multiplied by 100 a contract.

/** His rules, as shipped. Every one is his to change on the Calc page. */
export function defaultRules() {
  return { riskPct: 1, dayLossPct: 3, dayFloorPct: 1, dayAimPct: 2, dayCapPct: 10, targetR: 2 };
}
export const RULE_RANGES = {
  riskPct: [0.1, 5], dayLossPct: [0.5, 20], dayFloorPct: [0.1, 20], dayAimPct: [0.1, 30], dayCapPct: [0.5, 50], targetR: [0.5, 5],
};
/** The rules on a settings document, merged over the defaults, clamped, and the floor under the aim under the cap or all three fall back. */
export function rulesOf(settings) {
  const d = defaultRules();
  const raw = settings && typeof settings.rules === 'object' && settings.rules ? settings.rules : {};
  const out = { ...d };
  for (const k of Object.keys(d)) {
    const v = Number(raw[k]);
    if (!Number.isFinite(v)) continue;
    const [lo, hi] = RULE_RANGES[k];
    out[k] = Math.min(hi, Math.max(lo, Math.round(v * 100) / 100));
  }
  if (!(out.dayFloorPct < out.dayAimPct && out.dayAimPct < out.dayCapPct)) {
    out.dayFloorPct = d.dayFloorPct; out.dayAimPct = d.dayAimPct; out.dayCapPct = d.dayCapPct;
  }
  return out;
}

// The market on his clock, in minutes of the Mountain day.
export const MARKET_OPEN_MIN = 450;
export const MARKET_CLOSE_MIN = 840;
export const EARLY_CLOSE_MIN = 660;
/** Whether the market is open at a Mountain minute of a day. */
export function isMarketOpen({ dateKey, minuteOfDay }) {
  const day = isTradingDay(dateKey);
  if (!day) return false;
  const close = day === 'early' ? EARLY_CLOSE_MIN : MARKET_CLOSE_MIN;
  return minuteOfDay >= MARKET_OPEN_MIN && minuteOfDay < close;
}

export const OPTION_MULT = 100;
// THE THREE KINDS OF TRADE (Eric, 2026-09-22): "I want trades separated from
// scalps (1-10min) intraday (1-8hr) and swing (8hr-3 days). We don't hold
// over weekends." The minutes are the window each one is meant to live in;
// nothing enforces a clock on him, but the desk sizes, sorts and expires by
// this, and every swing dies at the last close before a weekend.
export const HORIZONS = ['scalp', 'intraday', 'swing'];
export const HORIZON_MINUTES = { scalp: [1, 10], intraday: [60, 480], swing: [480, 4320] };
export const HORIZON_WORDS = { scalp: 'Scalp', intraday: 'Intraday', swing: 'Swing' };
/** The horizon a hold in minutes falls in: up to ten minutes is a scalp, up to eight hours intraday, beyond that swing. */
export function horizonFor(holdMinutes) {
  const m = Number(holdMinutes);
  if (!Number.isFinite(m) || m <= 0) return 'intraday';
  if (m <= HORIZON_MINUTES.scalp[1]) return 'scalp';
  if (m <= HORIZON_MINUTES.intraday[1]) return 'intraday';
  return 'swing';
}
export const horizonOf = (v) => (HORIZONS.includes(String(v)) ? String(v) : null);
/** The last trading day of the week `dateKey` sits in: nothing is held over a weekend. */
export function lastTradingDayOfWeek(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  let d = String(dateKey);
  let best = isTradingDay(d) ? d : null;
  // Saturday ends the week, so walk to the Friday at the latest.
  for (let i = 0; i < 7; i++) {
    const next = nextDateKey(d);
    if (new Date(`${next}T12:00:00Z`).getUTCDay() === 6) break;
    d = next;
    if (isTradingDay(d)) best = d;
  }
  return best || dateKey;
}
/** The day a swing position should be out by: `holdDays` trading days on, but never past this week's last close. */
export function swingLastDay(fromKey, holdDays = 3) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fromKey || ''))) return null;
  const weekEnd = lastTradingDayOfWeek(fromKey);
  let d = String(fromKey);
  let left = Math.max(0, Math.min(10, Math.floor(Number(holdDays) || 0)));
  for (let i = 0; i < 20 && left > 0; i++) {
    const next = nextDateKey(d);
    if (next > weekEnd) break;
    d = next;
    if (isTradingDay(d)) left -= 1;
  }
  return d > weekEnd ? weekEnd : d;
}
export const INSTRUMENTS = ['stock', 'call', 'put', 'spread'];
const isOption = (i) => i === 'call' || i === 'put' || i === 'spread';
export const multOf = (pos) => (isOption(pos?.instrument) ? OPTION_MULT : 1);
export const signOf = (pos) => (pos?.side === 'short' ? -1 : 1);
const fin = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
const r2 = (x) => Math.round(x * 100) / 100;
const r4 = (x) => Math.round(x * 10000) / 10000;
export const fmtMoney = (cents, signed = false) => {
  const n = Number(cents) || 0;
  const s = `$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${s}` : signed && n > 0 ? `+${s}` : s;
};
/** 0.02 reads "2%", 0.015 reads "1.5%". */
export const fmtPct = (x) => `${Math.round(Number(x) * 10000) / 100}%`;
/** A credit spread or a short option is entered at the premium received; a stop above it is the loss. */
const stopAbove = (pos) => pos?.side === 'short' || (pos?.instrument === 'spread' && !!pos?.credit);

/**
 * Dollars at risk per share or per contract, or null when nothing caps it.
 * Stock: the distance to the stop. A long call, put or debit spread: the
 * premium, or the distance to a stop premium. A credit spread: the width
 * less the credit, or the distance to a stop premium. A short call or put
 * with no stop: null, the loss is not capped.
 */
export function unitRisk(pos) {
  const entry = fin(pos?.entry); const stop = fin(pos?.stop); const width = fin(pos?.width);
  if (entry == null || entry <= 0) return null;
  const M = multOf(pos);
  if (pos.instrument === 'stock') return stop == null ? null : r4(Math.abs(entry - stop));
  if (stopAbove(pos)) {
    if (stop != null && stop > entry) return r4((stop - entry) * M);
    if (pos.instrument === 'spread' && width != null && width > entry) return r4((width - entry) * M);
    return null;
  }
  return stop != null && stop < entry ? r4((entry - stop) * M) : r4(entry * M);
}

/**
 * FRACTIONAL SHARES (Eric, 2026-09-22: "It should have an option for
 * fractional shares. So essentially it changes dollars to shares").
 *
 * A share can be bought in pieces; a contract cannot. So a stock position's
 * quantity is a real number to four places, and an option or a spread is
 * still a whole number of contracts. Four places is well inside what a broker
 * will fill and keeps every cents figure exact.
 *
 * Every arithmetic site reads the quantity through here rather than flooring
 * it for itself, which is what used to turn 0.4 shares into nothing at all.
 */
export const QTY_DP = 4;
export function qtyOf(pos) {
  const n = Number(pos?.qty);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return pos?.instrument === 'stock' ? r4(n) : Math.floor(n);
}
/** What a dollar amount buys at a price, in shares to four places. */
export function sharesForDollars(dollars, entry) {
  const d = fin(dollars); const e = fin(entry);
  if (d == null || e == null || e <= 0 || d <= 0) return null;
  return r4(d / e);
}
/** What a share count costs at a price, in dollars to the cent. */
export function dollarsForShares(qty, entry) {
  const q = fin(qty); const e = fin(entry);
  if (q == null || e == null || q <= 0 || e <= 0) return null;
  return r2(q * e);
}
/** A quantity as a person reads it: 17, not 17.0000; 17.2692, not 17.26920000000001. */
export function fmtQty(qty) {
  const n = Number(qty);
  if (!Number.isFinite(n) || n <= 0) return '0';
  return Number.isInteger(n) ? String(n) : String(r4(n));
}

/** The size the rule allows: the risk budget over the unit risk, rounded down; null when nothing caps the risk. */
export function sizeFor({ accountCents, rules, pos }) {
  const u = unitRisk(pos);
  const budgetCents = Math.round((Number(accountCents) || 0) * ((rules || defaultRules()).riskPct) / 100);
  if (u == null || u <= 0) return { unitRisk: u, budgetCents, qty: null };
  const exact = budgetCents / (u * 100);
  // A stock takes the budget exactly, because a share can be bought in
  // pieces (2026-09-22). A contract cannot, so it still rounds down, and
  // one contract already over the budget is still a size of zero.
  return { unitRisk: u, budgetCents, qty: pos?.instrument === 'stock' ? r4(exact) : Math.floor(exact) };
}

/**
 * WHAT IT ACTUALLY IS (Eric, 2026-09-22: "make it clear if it's suggesting
 * call, put, spread at what price/expiration or total value in stocks, not
 * shares").
 *
 * A vehicle in one short line: the strike, the kind and when it expires, or
 * the word shares. Built from the real fields when they are there and from
 * whatever `structure` says when they are not, so an older play still reads.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 2026-10-17 as "17 Oct". Never parsed through the local clock, which would move the day. */
export function expiryWords(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
  if (!m) return '';
  const mon = MONTHS[Number(m[2]) - 1];
  return mon ? `${Number(m[3])} ${mon}` : '';
}
export function vehicleLabel(p) {
  const inst = String(p?.instrument || 'stock');
  if (inst === 'stock') return 'shares';
  const k = fin(p?.strike); const k2 = fin(p?.strike2);
  const when = expiryWords(p?.expiry);
  // A spread is calls or puts, and which one changes the trade entirely, so it
  // is said when the play says it.
  const leg = ['call', 'put'].includes(String(p?.optionType || '')) ? `${p.optionType} ` : '';
  const kind = inst === 'spread'
    ? `${leg}${p?.credit ? 'credit' : 'debit'} spread`
    : inst;
  const strikes = k == null ? '' : (inst === 'spread' && k2 != null ? `${k}/${k2} ` : `${k} `);
  const built = `${strikes}${kind}${when ? `, ${when}` : ''}`.trim();
  // Nothing typed at all: fall back to whatever the play called itself.
  return strikes || when ? built : (String(p?.structure || '').trim() || kind);
}

/**
 * THE NOTE, AT MOST FIVE BULLETS (Eric, 2026-09-22: "This needs to disappear or
 * be shortened to 5 bullet points").
 *
 * noteOnly keeps the Note section of a scan's answer and nothing after it.
 * noteBullets turns that into at most five short lines: the lines written as
 * bullets when there are any, otherwise one line a sentence. Both run on the
 * READ side as well as the write side, so a note filed before this rule
 * existed is cut down the moment a page asks for it, without a new scan.
 * Shared here so the Worker, the page, the demo and the checks all cut the
 * same way.
 */
export function noteOnly(text) {
  const t = String(text || '');
  const m = t.match(/^\s*\**#{2,3}\s*\**\s*Note\s*\**\s*\n([\s\S]*?)(?=^\s*\**#{2,3}\s|$(?![\s\S]))/im);
  if (m) return m[1].trim();
  // No Note heading: whatever comes before the first heading, first paragraph.
  return t.replace(/^#{1,6}[^\n]*\n+/, '').split(/\n\s*#{2,3}\s/)[0].trim().split(/\n{2,}/)[0].trim();
}
export const NOTE_BULLETS_MAX = 5;
export const NOTE_BULLET_CHARS = 160;
export function noteBullets(text, { max = NOTE_BULLETS_MAX, chars = NOTE_BULLET_CHARS } = {}) {
  const body = noteOnly(text);
  if (!body) return [];
  let items = body.split('\n').map((l) => l.trim())
    .filter((l) => /^[-*\u2022]\s+/.test(l)).map((l) => l.replace(/^[-*\u2022]\s+/, '').trim());
  if (!items.length) {
    // Prose: a sentence ends at . ! or ? followed by a space and a capital, a
    // digit, a dollar sign or a quote, so 619.98 and 10:00 to 12:00 stay whole.
    items = body.replace(/\s+/g, ' ').trim()
      .replace(/([.!?])\s+(?=[A-Z0-9$"'(])/g, '$1\u0001').split('\u0001')
      .map((x) => x.trim()).filter(Boolean);
  }
  const cut = (x) => {
    if (x.length <= chars) return x;
    const head = x.slice(0, chars);
    const at = head.lastIndexOf(' ');
    return (at > chars / 2 ? head.slice(0, at) : head).trim();
  };
  return items.slice(0, max).map(cut).filter(Boolean);
}

/** A hold in the words a person says out loud: 10 minutes, 3 hours, 2 days. */
export function holdPlain(p) {
  if (p?.horizon === 'swing') { const d = Number(p.holdDays) || 3; return `${d} day${d === 1 ? '' : 's'}`; }
  const m = Math.round(Number(p?.holdMinutes) || 0);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'}`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h} hour${h === 1 ? '' : 's'}`;
}
/** A price as he would read it aloud: 226.30, not 226.3, and 402 stays 402. */
export function priceWords(v) {
  const n = fin(v);
  if (n == null) return '';
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}
const px = priceWords;

/**
 * A SETUP IN ONE PLAIN SENTENCE (Eric, 2026-09-22: "Make the plays fucking
 * plain English. For example. 3 hours, NVDA, $248, stop loss price, take
 * profit price. If call, date strike expiration. Simplify. Don't make me guess
 * what it means.").
 *
 * His order, his words. The hold first, then what to do and with how much
 * money, then the contract if it is one, then the two prices that end it. No
 * chips, no R multiples, no share counts, no abbreviations he has to expand
 * in his head.
 */
export function playLine(p, { rules, accountCents } = {}) {
  const sz = playSizing({ play: p, rules, accountCents });
  const verb = p?.side === 'short' ? 'short' : 'buy';
  const money = sz.allocCents == null ? '' : `$${Math.round(sz.allocCents / 100).toLocaleString('en-US')} of `;
  // Inside a sentence the date reads better as a word than as another comma,
  // which would be the fourth in the line.
  const phrase = sz.vehicle.replace(/, ([^,]+)$/, ' expiring $1');
  const what = p?.instrument === 'stock'
    ? `${p?.ticker || ''}`
    : p?.instrument === 'spread'
      ? `the ${p?.ticker || ''} ${phrase}`
      : `${p?.ticker || ''} ${phrase}`;
  const bits = [holdPlain(p), `${verb} ${money}${what}`.trim()];
  if (p?.stop != null && p.stop !== '') bits.push(`stop loss ${px(p.stop)}`);
  const t = (p?.targets || [])[0];
  if (t != null) bits.push(`take profit ${px(t)}`);
  return bits.filter(Boolean).join(', ');
}

/**
 * WHAT A PLAY IS TELLING HIM TO PUT IN, and what that buys.
 *
 * Risk and allocation are two different numbers and the card only ever showed
 * one of them. On his own figures: $44.90 of risk on a $4,490 account is
 * 17.2692 shares of NVDA at 228.9, which is $3,952 of capital, or 88% of
 * everything he has. The risk rule never says that out loud.
 *
 * So a play carries allocPct, the share of the account to put in, and this
 * turns it into the thing he actually does: dollars for a stock, a count of
 * contracts for anything else. `takeQty` is the LESSER of what the play
 * suggests and what his one-trade risk rule allows, because a suggestion does
 * not get to break Rules to hold.
 */
export function playSizing({ play, rules, accountCents }) {
  const A = Math.max(0, Number(accountCents) || 0);
  const R = rulesOf({ rules });
  const inst = String(play?.instrument || 'stock');
  const entry = fin(play?.entry);
  const pos = { instrument: inst, side: play?.side, entry, stop: fin(play?.stop), credit: !!play?.credit, width: fin(play?.width) };
  const size = sizeFor({ accountCents: A, rules: R, pos });
  const pct = fin(play?.allocPct);
  const asked = fin(play?.sizeDollars);
  // His percent if the play gave one; otherwise the dollars it asked for,
  // read as a percent of the account so both arrive at the same place.
  const allocCents = pct != null && pct > 0 ? Math.round((A * pct) / 100)
    : asked != null && asked > 0 ? Math.round(asked * 100) : null;
  const allocPct = allocCents != null && A ? r2((allocCents / A) * 100) : null;
  const perUnitCents = entry == null ? null : Math.round(entry * multOf(pos) * 100);
  let qty = null;
  if (allocCents != null && perUnitCents != null && perUnitCents > 0) {
    qty = inst === 'stock'
      ? r4(allocCents / perUnitCents)
      : Math.floor(allocCents / perUnitCents);
  }
  const costCents = qty == null || perUnitCents == null ? null : Math.round(qty * perUnitCents);
  const u = unitRisk(pos);
  const riskCents = qty == null || u == null ? null : Math.round(u * qty * 100);
  const overRule = riskCents != null && riskCents > size.budgetCents;
  // What Take it should put in the box: never more than the rule allows.
  const ruleQty = size.qty;
  const takeQty = qty == null ? ruleQty
    : ruleQty == null ? qty
      : Math.min(qty, ruleQty);
  return {
    allocPct, allocCents, vehicle: vehicleLabel(play), instrument: inst,
    shares: inst === 'stock' ? qty : null,
    contracts: inst === 'stock' ? null : qty,
    perUnitCents, costCents, riskCents,
    budgetCents: size.budgetCents, ruleQty, overRule,
    takeQty: takeQty == null || takeQty <= 0 ? null : takeQty,
    takeCents: !takeQty || takeQty <= 0 || perUnitCents == null ? null : Math.round(takeQty * perUnitCents),
  };
}

/**
 * HOW MUCH, IN THE UNITS HE ACTS IN (PR 420, 2026-09-23). A trade idea
 * arrives with an entry zone, a stop, one or two targets and a suggested share
 * of the account. This turns it into what the card says: dollars in, shares
 * or contracts, what the stop costs, what the first target pays, and the
 * ratio between them.
 *
 * The suggested share is capped by his risk per trade (three percent unless
 * he changes it): the size is the lesser of what the idea asks for and what
 * keeps a stopped-out trade inside that rule. Shares can be fractional;
 * contracts are whole, so one contract that already risks more than the rule
 * sizes to zero and says so. Sized on every read from the balance he last
 * typed, so a new balance re-sizes every card at once.
 */
export function recSizing({ rec, accountCents, rules }) {
  const A = Math.max(0, Math.round(Number(accountCents) || 0));
  // His rule is 3% a trade (Eric, 2026-09-23: "3% risk rule."), so that is what a card sizes to when
  // no rule is handed in, not the calculator's old 1%.
  const R = rulesOf({ rules: { riskPct: 3, ...(rules || {}) } });
  const inst = ['stock', 'call', 'put'].includes(rec?.instrument) ? rec.instrument : 'stock';
  const lo = fin(rec?.entryLow); const hi = fin(rec?.entryHigh);
  // THE WORST FILL (2026-09-23): the rule has to hold wherever in the zone he is filled, so a buy is
  // sized from the top of the zone and a short from the bottom. Sized from the middle, a fill at the
  // edge of a wide zone could lose more at the stop than his rule allows.
  const up = inst !== 'stock' || rec?.side !== 'short';
  const entry = lo != null && hi != null ? (up ? Math.max(lo, hi) : Math.min(lo, hi)) : fin(rec?.entry) ?? lo ?? hi;
  const stop = fin(rec?.stop);
  const targets = (Array.isArray(rec?.targets) ? rec.targets : []).map(fin).filter((t) => t != null);
  const pos = { instrument: inst, side: rec?.side === 'short' ? 'short' : 'long', entry, stop };
  const M = multOf(pos);
  const out = {
    instrument: inst, entry, qty: null, shares: null, contracts: null, costCents: null,
    riskCents: null, rewardCents: null, reward2Cents: null, rr: null,
    budgetCents: Math.round((A * R.riskPct) / 100), capped: false, overRule: false, unitRiskCents: null,
    allocCents: null, unitCostCents: null,
  };
  if (entry == null || entry <= 0 || !A) return out;
  const u = unitRisk(pos);
  out.unitRiskCents = u == null ? null : Math.round(u * 100);
  const perUnitCents = Math.round(entry * M * 100);
  const pct = Math.min(50, Math.max(0, fin(rec?.allocPct) ?? 0));
  const allocCents = Math.min(A, Math.round((A * pct) / 100));
  out.allocCents = allocCents;
  out.unitCostCents = perUnitCents;
  const whole = inst !== 'stock';
  const byAlloc = perUnitCents > 0 ? allocCents / perUnitCents : 0;
  const byRule = out.unitRiskCents && out.unitRiskCents > 0 ? out.budgetCents / out.unitRiskCents : Infinity;
  let qty = Math.min(byAlloc, byRule);
  out.capped = byRule < byAlloc;
  qty = whole ? Math.floor(qty) : r4(qty);
  if (!(qty > 0)) {
    out.overRule = whole && out.unitRiskCents != null && out.unitRiskCents > out.budgetCents;
    out.qty = 0;
    if (whole) out.contracts = 0; else out.shares = 0;
    out.costCents = 0;
    return out;
  }
  out.qty = qty;
  if (whole) out.contracts = qty; else out.shares = qty;
  out.costCents = Math.round(qty * perUnitCents);
  out.riskCents = out.unitRiskCents == null ? null : Math.round(qty * out.unitRiskCents);
  const sign = pos.side === 'short' && inst === 'stock' ? -1 : 1;
  const gain = (t) => Math.round(Math.max(0, sign * (t - entry)) * M * 100 * qty);
  if (targets[0] != null) out.rewardCents = gain(targets[0]);
  if (targets[1] != null) out.reward2Cents = gain(targets[1]);
  if (out.riskCents && out.rewardCents != null) out.rr = r2(out.rewardCents / out.riskCents);
  return out;
}

/**
 * HIS SIZE (Eric, 2026-09-23: "I should be able to manually tap on the amount traded and update it,
 * the amount I'm willing to risk, then it adjusts the stop loss and take profit", and "Including after
 * the trade was accepted"). He sets the dollars going in and the dollars he is willing to lose; the
 * stop goes where exactly that much is lost, and every target keeps the multiple of the risk the desk
 * gave it, so a wider stop carries the targets out with it. Priced from the same worst fill in the zone
 * the card sizes from, and the stop is rounded toward the entry so the loss at it is never more than he
 * said. A size that cannot be done answers { ok: false, why } with a sentence he can act on.
 */
export function planFor({ rec, amountCents, riskCents, accountCents = 0, rules = null }) {
  const inst = ['stock', 'call', 'put'].includes(rec?.instrument) ? rec.instrument : 'stock';
  const up = inst !== 'stock' || rec?.side !== 'short';
  const lo = fin(rec?.entryLow); const hi = fin(rec?.entryHigh);
  const entry = lo != null && hi != null ? (up ? Math.max(lo, hi) : Math.min(lo, hi)) : fin(rec?.entry) ?? lo ?? hi;
  const amount = Math.round(Number(amountCents));
  const risk = Math.round(Number(riskCents));
  const no = (why) => ({ ok: false, why });
  if (!(entry > 0)) return no('This trade has no entry price to size from.');
  if (!(amount > 0) || amount > 1e9) return no('The amount in dollars, for example 500.');
  if (!(risk > 0)) return no('The risk in dollars, for example 60.');
  const M = inst === 'stock' ? 1 : OPTION_MULT;
  const unitCents = entry * M * 100;
  const whole = inst !== 'stock';
  // Rounded down, so what goes in is never a cent more than he said.
  const qty = whole ? Math.floor(amount / unitCents + 1e-9) : Math.floor((amount / unitCents) * 10000 + 1e-6) / 10000;
  if (!(qty > 0)) return no(whole ? `One contract costs ${fmtMoney(Math.round(unitCents))}, more than ${fmtMoney(amount)}.` : 'That amount is too small to buy any.');
  const costCents = Math.round(qty * unitCents);
  // A buy cannot lose more than it cost, and a stop at nothing is no stop.
  if (up && risk >= costCents) return no(`The risk has to be less than the ${fmtMoney(costCents)} going in.`);
  // Cents above a dollar, a hundredth of a cent below it, like the prices the desk writes.
  const tick = (p) => (p >= 1 ? 100 : 10000);
  const dist = risk / (qty * M * 100);
  const raw = up ? entry - dist : entry + dist;
  const t = tick(raw);
  const stop = up ? Math.ceil(raw * t - 1e-6) / t : Math.floor(raw * t + 1e-6) / t;
  if (up ? stop >= entry : stop <= entry) return no('That risk is too small for this size: the stop would sit on the entry.');
  if (!(stop > 0)) return no('The stop would fall below zero at that risk.');
  // The desk's targets as multiples of the desk's risk, carried to his.
  const deskStop = fin(rec?.stop);
  const deskDist = deskStop == null ? null : up ? entry - deskStop : deskStop - entry;
  const deskTargets = (Array.isArray(rec?.targets) ? rec.targets : []).map(fin).filter((x) => x != null);
  const newDist = up ? entry - stop : stop - entry;
  let targets = deskTargets;
  if (deskDist > 0 && deskTargets.length) {
    targets = deskTargets.map((x) => {
      const k = (up ? x - entry : entry - x) / deskDist;
      const p = up ? entry + k * newDist : entry - k * newDist;
      return Math.round(p * tick(p)) / tick(p);
    }).filter((p) => p > 0 && (up ? p > entry : p < entry));
    if (!targets.length) return no('The targets would fall below zero at that risk.');
  }
  const sign = up ? 1 : -1;
  const gain = (x) => Math.round(Math.max(0, sign * (x - entry)) * M * 100 * qty);
  const actualRisk = Math.round(newDist * M * 100 * qty);
  const out = {
    ok: true, instrument: inst, entry, qty, shares: whole ? null : qty, contracts: whole ? qty : null,
    amountCents: amount, askedRiskCents: risk, costCents, riskCents: actualRisk, stop, targets,
    rewardCents: targets[0] != null ? gain(targets[0]) : null, reward2Cents: targets[1] != null ? gain(targets[1]) : null,
    rr: null, budgetCents: null, overRule: false,
  };
  if (out.rewardCents != null && actualRisk > 0) out.rr = r2(out.rewardCents / actualRisk);
  const A = Math.max(0, Math.round(Number(accountCents) || 0));
  if (A) {
    const R = rulesOf({ rules: { riskPct: 3, ...(rules || {}) } });
    out.budgetCents = Math.round((A * R.riskPct) / 100);
    out.overRule = actualRisk > out.budgetCents;
  }
  return out;
}

/** The price ladder around the entry: the stop's distance as R, breakeven, then 1R, 2R and 3R the right way round. */
export function ladder({ side, entry, stop }) {
  const e = fin(entry); const s = fin(stop);
  if (e == null || s == null) return null;
  const sign = side === 'short' ? -1 : 1;
  const r = Math.abs(e - s);
  return { r: r4(r), breakeven: e, levels: [1, 2, 3].map((k) => ({ r: k, price: r4(e + sign * k * r) })) };
}

/** The profit or loss of a close, in cents: the move times the side, times 100 a contract, times the quantity. A credit spread gains when the premium falls. */
export function closePnl({ pos, exitPrice }) {
  const entry = fin(pos?.entry); const exit = fin(exitPrice); const qty = qtyOf(pos);
  if (entry == null || exit == null) return null;
  const M = multOf(pos);
  const per = pos.instrument === 'spread' && pos.credit ? (entry - exit) * M : (exit - entry) * signOf(pos) * M;
  return Math.round(per * qty * 100);
}

export const WARNING_TEXT = {
  'risk-over-rule': 'Risk is over your rule for one trade.',
  'no-stop': 'No stop. Set one before the order goes in.',
  'stop-wrong-side': 'The stop is on the wrong side of the entry.',
  'position-over-half': 'More than half the account in one trade.',
  'cash-t1': 'Cash account: what you sell today settles tomorrow. Buying with it before then and selling again is a good faith violation.',
  'day-past-close': 'A scalp or intraday trade still open past its day.',
  'weekend-ahead': 'Last trading day of the week. Nothing is held over a weekend.',
  'expires-today': 'Expires today.',
  'short-option-uncapped': 'A short option without a stop has no cap on the loss.',
  'stop-in-noise': 'The stop sits inside a quarter of today\'s range; the noise can take it.',
};

/**
 * Everything a card shows for one position: the risk in dollars and as a
 * share of the account, the size the rule allows, the cost, the ladder, the
 * target (typed, or targetR up the ladder), the reward and the R:R, the
 * distances from the entry and from the last price (a stock's live quote,
 * an option's typed mark), the unrealized figure, today's range off the
 * quote, and every warning that applies.
 */
export function tradeCalc({ pos, rules, accountCents, quote = null, todayKey = null, accountType = null }) {
  const R = rules || defaultRules();
  const A = Number(accountCents) || 0;
  const M = multOf(pos); const sign = signOf(pos);
  const entry = fin(pos.entry); const stop = fin(pos.stop);
  const qty = qtyOf(pos);
  const u = unitRisk(pos);
  const size = sizeFor({ accountCents: A, rules: R, pos });
  const riskCents = u == null ? null : Math.round(u * qty * 100);
  const riskPct = riskCents == null || !A ? null : r4(riskCents / A);
  const lad = ladder({ side: pos.side, entry, stop });
  const target = fin(pos.target) ?? (lad && entry != null ? r4(entry + sign * R.targetR * lad.r) : null);
  const rewardCents = target != null && entry != null ? Math.round(Math.abs(target - entry) * M * qty * 100) : null;
  const rr = lad && lad.r > 0 && target != null ? r2(Math.abs(target - entry) / lad.r) : null;
  const positionCents = entry != null ? Math.round(entry * M * qty * 100) : 0;
  const positionPct = A ? r4(positionCents / A) : null;
  const last = isOption(pos.instrument) ? fin(pos.mark) : (quote ? fin(quote.last) : null);
  const unrealizedCents = last != null && entry != null ? Math.round((last - entry) * sign * M * qty * 100) : null;
  const dist = (a, b) => (a != null && b != null && b ? { pct: r4((a - b) / b), dollars: r2(a - b) } : null);
  const distances = { stopFromEntry: dist(stop, entry), targetFromEntry: dist(target, entry), stopFromLast: dist(stop, last), targetFromLast: dist(target, last) };
  const high = quote ? fin(quote.high) : null; const low = quote ? fin(quote.low) : null; const prev = quote ? fin(quote.prevClose) : null;
  const todaysRange = high != null && low != null ? { high, low, rangePct: prev ? r4((high - low) / prev) : null } : null;
  const warnings = [];
  if (riskCents != null && riskCents > size.budgetCents) warnings.push('risk-over-rule');
  if (stop == null) warnings.push('no-stop');
  else if (entry != null && (stopAbove(pos) ? stop <= entry : stop >= entry)) warnings.push('stop-wrong-side');
  if (positionPct != null && positionPct > 0.5) warnings.push('position-over-half');
  if (accountType === 'cash') warnings.push('cash-t1');
  if (pos.horizon !== 'swing' && todayKey && pos.openedDay && pos.openedDay < todayKey && pos.status !== 'closed') warnings.push('day-past-close');
  if (pos.horizon === 'swing' && todayKey && pos.status !== 'closed' && lastTradingDayOfWeek(todayKey) === todayKey) warnings.push('weekend-ahead');
  if (pos.expiry && todayKey && pos.expiry === todayKey) warnings.push('expires-today');
  if (u == null && stop == null && pos.side === 'short' && (pos.instrument === 'call' || pos.instrument === 'put')) warnings.push('short-option-uncapped');
  if (todaysRange && lad && pos.instrument === 'stock' && high - low > 0 && lad.r < 0.25 * (high - low)) warnings.push('stop-in-noise');
  return {
    unitRisk: u, riskCents, riskPct, budgetCents: size.budgetCents, suggestedQty: size.qty,
    positionCents, positionPct, ladder: lad, target, rewardCents, rr, last, unrealizedCents, distances, todaysRange, warnings,
  };
}

/** What he has banked today: every position closed on the day, either horizon. Unrealized never counts. */
export function realizedToday(positions, todayKey) {
  return (positions || []).filter((p) => p && p.status === 'closed' && p.closedDay === todayKey).reduce((s, p) => s + (Number(p.pnlCents) || 0), 0);
}
/** The risk standing in every open position, both horizons. */
export function openRisk(positions) {
  return (positions || []).filter((p) => p && p.status === 'open').reduce((s, p) => s + Math.max(0, Number(p.riskCents) || 0), 0);
}

/**
 * THE BIG NUMBER (2026-09-22, the desk as one app): his last typed balance
 * plus what he has banked today, until tonight's balance is typed, after
 * which the typed figure alone. Without the second half a close made after
 * the nightly entry would count twice: once in the entry, once on top of it.
 */
export function liveBalance({ accountCents, lastBalanceDay = null, todayKey = null, realizedTodayCents = 0 }) {
  const A = Math.round(Number(accountCents) || 0);
  if (lastBalanceDay && todayKey && String(lastBalanceDay) === String(todayKey)) return A;
  return A + Math.round(Number(realizedTodayCents) || 0);
}

// ---- his statistics (2026-09-22, the desk as one app) ------------------------
//
// Eric: "Trading performance, win rate, returns, losses, averages, streaks,
// and other useful metrics." Every figure here comes from the closed
// positions and nothing else: a play he marked closed without taking a
// position is a note, not a trade. Pure, so the Worker's history route, the
// demo and the checks agree to the cent.
const closeTime = (r) => {
  const v = r?.closedAt;
  const ms = v && typeof v.toDate === 'function' ? v.toDate().getTime() : v ? new Date(v).getTime() : NaN;
  return Number.isFinite(ms) ? ms : 0;
};
const r2s = (x) => Math.round(x * 100) / 100;
const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const kindOf = (r) => (HORIZONS.includes(String(r?.horizon)) ? String(r.horizon) : 'intraday');
const emptyBucket = () => ({ count: 0, wins: 0, losses: 0, netCents: 0, winRate: null });
const rate = (w, l) => (w + l ? Math.round((w / (w + l)) * 10000) / 10000 : null);

/**
 * What the Stats page shows, off the closed rows: the count and the split,
 * the win rate with flats out of the denominator, the gross figures and the
 * expectancy, the profit factor, the averages, the best and the worst, the
 * streak he is on and the longest each way, the same by kind and by weekday
 * and by day, the last N closes, the R figures where a risk was stored, and
 * today's line when a day is given.
 */
export function tradeStats(closed, { today = null, lastN = 20 } = {}) {
  const rows = (Array.isArray(closed) ? closed : [])
    .filter((r) => r && Number.isFinite(Number(r.pnlCents)) && (r.status === undefined || r.status === 'closed'))
    .map((r) => ({ ...r, pnlCents: Math.round(Number(r.pnlCents)), _t: closeTime(r) }))
    .sort((a, b) => a._t - b._t || String(a.closedDay || '').localeCompare(String(b.closedDay || '')) || String(a.id || '').localeCompare(String(b.id || '')));
  const wins = rows.filter((r) => r.pnlCents > 0);
  const losses = rows.filter((r) => r.pnlCents < 0);
  const flats = rows.filter((r) => r.pnlCents === 0);
  const grossWinCents = wins.reduce((s, r) => s + r.pnlCents, 0);
  const grossLossCents = -losses.reduce((s, r) => s + r.pnlCents, 0);
  const netCents = grossWinCents - grossLossCents;
  const pick = (r) => (r ? { id: r.id ?? null, ticker: r.ticker ?? null, pnlCents: r.pnlCents, closedDay: r.closedDay ?? null } : null);
  const best = rows.reduce((b, r) => (b === null || r.pnlCents > b.pnlCents ? r : b), null);
  const worst = rows.reduce((b, r) => (b === null || r.pnlCents < b.pnlCents ? r : b), null);
  // The streak he is on, walking back from the newest; a flat ends one.
  let streak = { kind: 'none', n: 0 };
  for (let i = rows.length - 1; i >= 0; i--) {
    const k = rows[i].pnlCents > 0 ? 'win' : rows[i].pnlCents < 0 ? 'loss' : 'none';
    if (i === rows.length - 1) { if (k === 'none') break; streak = { kind: k, n: 1 }; continue; }
    if (k !== streak.kind) break;
    streak.n += 1;
  }
  let longestWin = 0; let longestLoss = 0; let cw = 0; let cl = 0;
  for (const r of rows) {
    if (r.pnlCents > 0) { cw += 1; cl = 0; } else if (r.pnlCents < 0) { cl += 1; cw = 0; } else { cw = 0; cl = 0; }
    longestWin = Math.max(longestWin, cw); longestLoss = Math.max(longestLoss, cl);
  }
  const byHorizon = { scalp: emptyBucket(), intraday: emptyBucket(), swing: emptyBucket() };
  for (const r of rows) {
    const b = byHorizon[kindOf(r)];
    b.count += 1; b.netCents += r.pnlCents;
    if (r.pnlCents > 0) b.wins += 1; else if (r.pnlCents < 0) b.losses += 1;
  }
  for (const k of HORIZONS) byHorizon[k].winRate = rate(byHorizon[k].wins, byHorizon[k].losses);
  const byWeekday = [1, 2, 3, 4, 5].map((dow) => ({ dow, label: WEEKDAY[dow], count: 0, wins: 0, losses: 0, netCents: 0 }));
  const dayMap = new Map();
  for (const r of rows) {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(String(r.closedDay || '')) ? String(r.closedDay) : null;
    if (!day) continue;
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const w = byWeekday.find((x) => x.dow === dow);
    if (w) { w.count += 1; w.netCents += r.pnlCents; if (r.pnlCents > 0) w.wins += 1; else if (r.pnlCents < 0) w.losses += 1; }
    const d = dayMap.get(day) || { day, count: 0, netCents: 0 };
    d.count += 1; d.netCents += r.pnlCents; dayMap.set(day, d);
  }
  const byDay = [...dayMap.values()].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0)).slice(0, 60);
  const rRows = rows.filter((r) => Number(r.riskCents) > 0).map((r) => ({ ...r, r: r2s(r.pnlCents / Number(r.riskCents)) }));
  const rBlock = rRows.length ? {
    count: rRows.length,
    sumR: r2s(rRows.reduce((s, r) => s + r.r, 0)),
    avgR: r2s(rRows.reduce((s, r) => s + r.r, 0) / rRows.length),
    bestR: Math.max(...rRows.map((r) => r.r)),
    worstR: Math.min(...rRows.map((r) => r.r)),
  } : null;
  const n = Math.max(0, Math.min(200, Math.floor(Number(lastN) || 0)));
  const last = rows.slice(-n).reverse().map((r) => ({
    id: r.id ?? null, ticker: r.ticker ?? null, pnlCents: r.pnlCents, closedAt: r._t ? new Date(r._t).toISOString() : null,
    closedDay: r.closedDay ?? null, horizon: kindOf(r), r: Number(r.riskCents) > 0 ? r2s(r.pnlCents / Number(r.riskCents)) : null,
  }));
  const todayRows = today ? rows.filter((r) => String(r.closedDay || '') === String(today)) : [];
  return {
    count: rows.length, wins: wins.length, losses: losses.length, flats: flats.length,
    winRate: rate(wins.length, losses.length),
    grossWinCents, grossLossCents, netCents,
    expectancyCents: rows.length ? Math.round(netCents / rows.length) : 0,
    profitFactor: grossLossCents > 0 ? r2s(grossWinCents / grossLossCents) : null,
    noLosses: grossLossCents === 0 && grossWinCents > 0,
    avgWinCents: wins.length ? Math.round(grossWinCents / wins.length) : null,
    avgLossCents: losses.length ? -Math.round(grossLossCents / losses.length) : null,
    bestCents: best ? best.pnlCents : null, worstCents: worst ? worst.pnlCents : null,
    best: pick(best), worst: pick(worst),
    streak, longestWin, longestLoss,
    byHorizon, byWeekday, byDay, last, r: rBlock,
    today: today ? { count: todayRows.length, netCents: todayRows.reduce((s, r) => s + r.pnlCents, 0) } : null,
  };
}

const DAY_WORDS = {
  'stop-loss': 'stop for the day, the loss limit is hit',
  'stop-cap': 'stop for the day, the cap is hit',
  'below-floor': 'under the floor',
  'on-floor': 'on the floor',
  'on-aim': 'at the aim',
};
/**
 * Where the day stands against his rules: the four lines in dollars, the
 * state, what is left to risk (the room above the loss limit, less what the
 * open positions already put at risk; nothing once a stop state is reached),
 * and one sentence.
 */
export function dayStatus({ rules, accountCents, realizedTodayCents = 0, openRiskCents = 0 }) {
  const R = rules || defaultRules();
  const A = Number(accountCents) || 0;
  const lossLimitCents = -Math.round(A * R.dayLossPct / 100);
  const floorCents = Math.round(A * R.dayFloorPct / 100);
  const aimCents = Math.round(A * R.dayAimPct / 100);
  const capCents = Math.round(A * R.dayCapPct / 100);
  const real = Math.round(Number(realizedTodayCents) || 0);
  const open = Math.max(0, Math.round(Number(openRiskCents) || 0));
  const state = real <= lossLimitCents ? 'stop-loss' : real >= capCents ? 'stop-cap' : real < floorCents ? 'below-floor' : real < aimCents ? 'on-floor' : 'on-aim';
  const remainingRiskCents = state.startsWith('stop') ? 0 : Math.max(0, (real - lossLimitCents) - open);
  const line = `Realized ${fmtMoney(real, true)}, ${DAY_WORDS[state]}. Aim is ${fmtMoney(aimCents)}. ${fmtMoney(remainingRiskCents)} left to risk today.`;
  return { lossLimitCents, floorCents, aimCents, capCents, realizedTodayCents: real, openRiskCents: open, state, remainingRiskCents, line };
}
