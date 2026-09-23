// PR 420: every view the desk draws, as pure functions (Eric, 2026-09-23:
// "The purpose is to let me understand the trade at a glance.").
//
// Nothing here fetches, stores or listens. A row of data goes in and markup
// comes out, which is why the suite can run the whole look in node and hold a
// card to its shape without a browser. The app that mounts these lives in
// admin-deskapp.js; the sizing they print is recSizing in trade-math.js, the
// same code the Worker would compute with.
//
// The name is load-bearing: admin-desk.js matches the Worker's asset gate, so
// this file is a 404 to anyone but him.

import { recSizing, planFor, HORIZON_WORDS } from './trade-math.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (cents, signed = false) => {
  const n = Number(cents) || 0;
  const s = `$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${s}` : signed && n > 0 ? `+${s}` : s;
};
/** Whole dollars, for the amount he puts in: "$1,240". */
export const wholeMoney = (cents) => `$${Math.round((Number(cents) || 0) / 100).toLocaleString('en-US')}`;
/** A price the way a quote reads: two places, four under a dollar. */
export const price = (v) => {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return '';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`;
};
const MT = 'America/Boise';
/** The time of day, on his clock: "9:42 AM". */
export const clock = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: MT, hour: 'numeric', minute: '2-digit' }).format(d) : '';
};
/** A day, on his clock: "Sep 23". */
export const dayShort = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: MT, month: 'short', day: 'numeric' }).format(d) : '';
};
/** How long ago, in the words a person uses: "just now", "12m ago", "2h ago", "Sep 20". */
export function agoShort(v, now = Date.now()) {
  if (!v) return '';
  const d = new Date(v);
  const ms = now - d.getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms < 90_000) return 'just now';
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 20 * 3600_000) return `${Math.round(ms / 3600_000)}h ago`;
  return dayShort(v);
}

/** One call to the desk's routes, with his token. */
export async function tradeCall(getToken, sub, body) {
  const token = await getToken();
  const res = await fetch(`/api/admin/trade/${sub}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
  return out;
}

// ---- the run line under RUN TRADING DESK -------------------------------------
const minutesSince = (v, now) => {
  const t = v ? new Date(v).getTime() : 0;
  return Number.isFinite(t) && t ? Math.max(0, Math.round((now - t) / 60_000)) : null;
};
const soFar = (m) => (m == null || m < 1 ? '' : ` ${m === 1 ? '1 minute' : `${m} minutes`} so far.`);

/**
 * WHERE THE RUN IS, AND FOR HOW LONG (PR 420). He should never look at a
 * spinner and wonder: the line says which half of the run is working, how
 * many of the five researchers are back, and how long it has been. `busy`
 * says whether the button is down.
 */
export function runLine(run, desk, now = Date.now()) {
  const st = run?.status || 'idle';
  const of = Number(run?.of) || 5;
  if (st === 'queued') return { busy: true, html: `Starting. <b>The desk picks it up within a minute.</b>${soFar(minutesSince(run.queuedAt, now))}` };
  if (st === 'researching') return { busy: true, html: `Five researchers at work. <b>${Number(run.done) || 0} of ${of} back.</b>${soFar(minutesSince(run.startedAt || run.queuedAt, now))}` };
  if (st === 'decide') return { busy: true, html: `Research is in. <b>The desk decides in the next minute.</b>${soFar(minutesSince(run.startedAt || run.queuedAt, now))}` };
  if (st === 'deciding') return { busy: true, html: `The desk is deciding. <b>Almost there.</b>${soFar(minutesSince(run.startedAt || run.queuedAt, now))}` };
  if (!desk?.at) return { busy: false, html: 'No run yet. <b>Tap RUN TRADING DESK.</b>' };
  const n = Number(desk.count) || 0;
  const ago = agoShort(desk.at, now);
  return { busy: false, html: `Last run <b>${esc(clock(desk.at))}</b>${ago === 'just now' ? '' : `, ${esc(ago)}`} · ${n} trade${n === 1 ? '' : 's'}` };
}

// ---- one trade --------------------------------------------------------------------
/** How long he should expect to hold it, in the words a card has room for. */
export function holdText(r) {
  if (r.horizon === 'swing') { const d = Number(r.holdDays) || 2; return `${d} day${d === 1 ? '' : 's'}`; }
  const m = Number(r.holdMinutes) || 0;
  if (!m) return r.horizon === 'scalp' ? 'minutes' : 'today';
  if (m < 60) return `${m} min`;
  const h = Math.round((m / 60) * 10) / 10;
  return `${h} hour${h === 1 ? '' : 's'}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const expiryText = (k) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || '')); return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}` : ''; };
/** The contract, when it is one: "$250.00 call expiring 16 Oct". */
export function vehicleText(r) {
  if (r.instrument !== 'call' && r.instrument !== 'put') return '';
  const k = r.strike != null ? `${price(r.strike)} ` : '';
  const e = r.expiry ? ` expiring ${expiryText(r.expiry)}` : '';
  return `${k}${r.instrument}${e}. Prices below are the premium per share.`;
}
const qtyText = (sz) => {
  if (sz.contracts != null) return `${sz.contracts} contract${sz.contracts === 1 ? '' : 's'}`;
  if (sz.shares != null) return `${Number.isInteger(sz.shares) ? sz.shares : Math.round(sz.shares * 10000) / 10000} share${sz.shares === 1 ? '' : 's'}`;
  return '';
};

/**
 * ONE TRADE, AT A GLANCE (Eric, 2026-09-23). Every field he listed, in the
 * order he reads a trade: what and which way, where it is now, where to get
 * in, how much, where he is wrong, where he gets paid, what that costs and
 * pays, how long, why, and what kills it. A taken trade is the same card lit
 * electric yellow, with PROFIT and LOSS in place of the one button.
 */
export function recCardHtml(r, { accountCents, rules, balanceTyped = true, quotes = null } = {}) {
  // HIS SIZE (2026-09-23): when he set the amount and the risk himself, the card is sized from his
  // numbers, and the stop and targets are the ones they give; the desk's own are named under the grid.
  const his = r.mine ? planFor({ rec: r, amountCents: r.mine.amountCents, riskCents: r.mine.riskCents, accountCents: balanceTyped ? accountCents : 0, rules }) : null;
  const mine = his?.ok ? his : null;
  const sz = mine || recSizing({ rec: r, accountCents, rules });
  const sized = !!mine || balanceTyped;
  const stopNow = mine ? mine.stop : r.stop;
  const targetsNow = mine ? mine.targets : (r.targets || []);
  const active = r.status === 'took';
  const kind = HORIZON_WORDS[r.horizon] || 'Intraday';
  const entry = r.entryLow != null && r.entryHigh != null && Number(r.entryLow) !== Number(r.entryHigh)
    ? `${price(r.entryLow)} to ${price(r.entryHigh)}` : price(r.entryLow ?? r.entry ?? r.entryHigh);
  const targets = targetsNow.map(price).filter(Boolean).join(' then ');
  // The price right now: a live quote when the page has one, else what the desk
  // saw when it filed the trade. On a contract it is the stock's price, so the
  // cell says Stock rather than Now beside premiums.
  const live = Number(quotes?.[r.ticker]?.last);
  const now = Number.isFinite(live) && live > 0 ? price(live) : r.priceNow != null ? price(r.priceNow) : r.lastPrice != null ? price(r.lastPrice) : '';
  const chance = r.profitLow != null && r.profitHigh != null ? `${esc(r.profitLow)} to ${esc(r.profitHigh)}%` : '';
  const agree = Number(r.agreement) >= 2 ? `${Number(r.agreement)} of 5 agree` : '';
  const amount = !sized || sz.qty == null ? 'Set your balance in Settings'
    : sz.qty === 0 ? (sz.overRule ? `One contract risks ${money(sz.unitRiskCents)}, over your ${money(sz.budgetCents)} rule`
      : sz.contracts === 0 && sz.unitCostCents > sz.allocCents ? `One contract costs ${wholeMoney(sz.unitCostCents)}, more than the ${wholeMoney(sz.allocCents)} set aside`
        : 'Too small to size')
      : `${wholeMoney(sz.costCents)} · ${qtyText(sz)}`;
  const cell = (k, v, cls = '') => (v ? `<div class="cell${cls ? ` ${cls}` : ''}"><div class="k">${esc(k)}</div><div class="v">${v}</div></div>` : '');
  // Amount and Risk are his to change, open or taken: a tap opens the size sheet.
  const tap = (k, v, cls, edit) => `<button type="button" class="cell tap${cls ? ` ${cls}` : ''}" data-edit="${edit}" aria-label="Change the ${edit}"><span class="k">${esc(k)}<span class="pen" aria-hidden="true"></span></span><span class="v">${v || 'Set it'}</span></button>`;
  const deskPlan = mine ? `The desk had the stop at ${price(r.stop)}${(r.targets || []).length ? `, targets ${(r.targets || []).map(price).join(' then ')}` : ''}.` : '';
  const ruleNote = mine?.overRule ? ` That is over your ${money(mine.budgetCents)} rule.` : '';
  return `<article class="outlined rec${active ? ' active' : ''}" data-kind="${esc(r.horizon || 'intraday')}" data-rec="${esc(r.id)}">
    <div class="head">
      <span class="tk">${esc(r.ticker)}</span>
      <span class="side ${r.side === 'short' ? 'short' : 'long'}">${r.side === 'short' ? 'Short' : 'Long'}</span>
      <span class="kind">${esc(kind)}</span>
      ${chance ? `<span class="odds"><span class="k">Chance</span><span class="v">${chance}</span></span>` : ''}
    </div>
    ${active ? `<div class="live-tag">Active${r.tookAt ? ` since ${esc(clock(r.tookAt))}` : ''}</div>` : ''}
    <div class="grid">
      ${cell(r.instrument === 'stock' ? 'Now' : 'Stock', esc(now))}
      ${cell('Entry', esc(entry), 'wide')}
      ${tap('Amount', esc(amount), 'wide', 'amount')}
      ${cell('Hold', esc(holdText(r)))}
      ${cell('Stop', esc(price(stopNow)), 'red')}
      ${cell('Targets', esc(targets), 'wide green')}
      ${tap('Risk', sized && sz.riskCents != null ? esc(money(sz.riskCents)) : '', 'red', 'risk')}
      ${cell('Reward', sized && sz.rewardCents != null ? esc(money(sz.rewardCents)) : '', 'green')}
      ${cell('R:R', sized && sz.rr != null ? esc(`1 : ${sz.rr}`) : '')}
    </div>
    ${mine ? `<p class="mine-note"><b>Your size.</b> ${esc(deskPlan)}${esc(ruleNote)}</p>` : ''}
    ${vehicleText(r) ? `<p class="vehicle">${esc(vehicleText(r))}</p>` : ''}
    ${r.setup ? `<p class="setup">${esc(r.setup)}</p>` : ''}
    <dl class="why">
      ${r.catalyst ? `<dt>Catalyst</dt><dd>${esc(r.catalyst)}</dd>` : ''}
      ${r.invalidation ? `<dt>Out if</dt><dd>${esc(r.invalidation)}</dd>` : ''}
      ${agree ? `<dt>Desk</dt><dd>${esc(agree)}</dd>` : ''}
    </dl>
    <div class="acts">
      ${active
        ? '<button type="button" class="btn big profit" data-act="profit">PROFIT</button><button type="button" class="btn big loss" data-act="loss">LOSS</button>'
        : '<button type="button" class="btn big primary take fl" data-act="take">YES, I TOOK IT</button>'}
    </div>
    <p class="said" data-rec-said></p>
  </article>`;
}

/** The three kinds, in his order, each with its own heading; a kind with nothing in it is left out. */
export const KIND_ORDER = ['scalp', 'intraday', 'swing'];
export function boardHtml(recs, ctx = {}) {
  return KIND_ORDER.map((k) => {
    const rows = recs.filter((r) => r.horizon === k);
    if (!rows.length) return '';
    return `<section class="kindgroup" data-kind="${k}"><h2 class="kindhead">${esc(HORIZON_WORDS[k])}<span class="n">${rows.length}</span></h2><div class="stack">${rows.map((r) => recCardHtml(r, ctx)).join('')}</div></section>`;
  }).join('');
}

// ---- history ------------------------------------------------------------------------
/** One closed trade: when, what, the setup it was taken on, and PROFIT or LOSS. The setup folds out on a tap. */
export function historyRowHtml(r) {
  const entry = r.entryLow != null && r.entryHigh != null && Number(r.entryLow) !== Number(r.entryHigh)
    ? `${price(r.entryLow)} to ${price(r.entryHigh)}` : price(r.entryLow ?? r.entry);
  const tag = r.result === 'profit' ? '<span class="res profit">PROFIT</span>'
    : r.result === 'loss' ? '<span class="res loss">LOSS</span>' : '<span class="res none">Closed</span>';
  const plan = [
    entry && `Entry ${entry}`,
    r.stop != null && `stop ${price(r.stop)}`,
    (r.targets || []).length && `targets ${(r.targets || []).map(price).join(' then ')}`,
  ].filter(Boolean).join(', ');
  // What he actually traded, when he set his own size (2026-09-23): the desk's plan above stays as it was.
  const m = r.mine;
  const his = m ? [
    `put in ${money(m.costCents ?? m.amountCents)}`,
    `risked ${money(m.riskCents)}`,
    m.stop != null && `stop ${price(m.stop)}`,
    (m.targets || []).length && `targets ${m.targets.map(price).join(' then ')}`,
  ].filter(Boolean).join(', ') : '';
  return `<li class="hist" data-kind="${esc(r.horizon)}" data-hist="${esc(r.id)}">
    <details><summary>
      <span class="when">${esc(dayShort(r.closedAt))}</span>
      <span class="what"><b>${esc(r.ticker)}</b> ${r.side === 'short' ? 'Short' : 'Long'} · ${esc(HORIZON_WORDS[r.horizon] || 'Intraday')}</span>
      ${tag}
    </summary>
    <div class="more">
      ${plan ? `<p>${m ? '<span class="k">Desk</span> ' : ''}${esc(plan)}.</p>` : ''}
      ${his ? `<p class="mine"><span class="k">You</span> ${esc(his)}.</p>` : ''}
      ${r.setup ? `<p>${esc(r.setup)}</p>` : ''}
      ${r.catalyst ? `<p><span class="k">Catalyst</span> ${esc(r.catalyst)}</p>` : ''}
      ${r.invalidation ? `<p><span class="k">Out if</span> ${esc(r.invalidation)}</p>` : ''}
      <p class="times">${r.tookAt ? `Taken ${esc(dayShort(r.tookAt))} ${esc(clock(r.tookAt))}. ` : ''}Closed ${esc(dayShort(r.closedAt))} ${esc(clock(r.closedAt))}.</p>
    </div></details>
  </li>`;
}

// ---- news -------------------------------------------------------------------------------
/** One item the desk itself flagged on its run, with the tickers it touches and why it matters. */
export function deskNewsHtml(n) {
  return `<li class="dnews"><div class="t">${esc(n.headline)}</div>${n.why ? `<div class="why">${esc(n.why)}</div>` : ''}${(n.tickers || []).length ? `<div class="s">${n.tickers.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : ''}</li>`;
}
/** One live headline: lit when it names a ticker on the board. The summary folds out on a tap. */
export function newsRowHtml(n, { now = Date.now() } = {}) {
  const lit = (n.onDesk || []).length > 0;
  return `<li class="${n.summary ? 'has' : ''}">
    <span class="b${lit ? ' lit' : ''}"></span>
    <div><div class="t">${esc(n.headline)}</div>
      <div class="s">${esc(n.source || '')}${n.at ? ` · ${esc(agoShort(n.at, now))}` : ''}${(n.onDesk || []).map((t) => ` <span class="chip neon c-blue">${esc(t)}</span>`).join('')}</div>
      ${n.summary ? `<div class="sum">${esc(n.summary)}${n.url ? ` <a href="${esc(n.url)}" target="_blank" rel="noopener">Open</a>` : ''}</div>` : ''}
    </div>
    ${n.summary ? '<span class="chev">&#9662;</span>' : '<span></span>'}
  </li>`;
}
/** One company reporting today: before the open, after the close, and lit when it is on the board. */
export function earningsChipHtml(e) {
  const when = e.hour === 'bmo' ? 'before open' : e.hour === 'amc' ? 'after close' : '';
  return `<span class="chip${e.onDesk ? ' neon c-blue' : ''}">${esc(e.symbol)}${when ? ` <span class="dim">${esc(when)}</span>` : ''}</span>`;
}
