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

export const TARGET_DAILY = 0.03;
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
 * Where he stands against 3% a day. `balances` are { date, cents, note }
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
