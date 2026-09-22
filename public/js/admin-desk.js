// Every view the trade desk draws, as pure functions (Eric, 2026-09-22: "make
// each play card easy to scan in 1 to 2 seconds ... the hierarchy of ticker,
// direction, trade type, risk, target range, stop, hold time, and rationale
// should be obvious").
//
// Nothing here fetches, stores or listens. A row of data goes in and markup
// comes out, which is why the suite can run the whole look in node and hold a
// card to its shape without a browser. The app that mounts these lives in
// admin-deskapp.js; the arithmetic they print lives in trade-math.js and is
// the same code the Worker computes with, so a figure on the page and a figure
// in a reading can never disagree.
//
// The name is load-bearing: admin-desk.js matches the Worker's asset gate, so
// this file is a 404 to anyone but him.

import {
  tradeCalc, rulesOf, HORIZON_WORDS, WARNING_TEXT, fmtPct, sizeFor, fmtQty, playSizing, playLine, priceWords,
} from './trade-math.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (cents, signed = false) => {
  const n = Number(cents) || 0;
  const s = `$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${s}` : signed && n > 0 ? `+${s}` : s;
};
/** The same figure without its cents, for a place the width matters: the tab's badge. */
export const shortMoney = (cents) => money(cents, true).replace(/\.\d\d$/, '');
const MT = 'America/Boise';
export const dayShort = (v) => {
  if (!v) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: MT, month: 'short', day: 'numeric' }).format(new Date(`${v}T12:00:00Z`));
};
/** A weekday for a day key, on his clock: the Closes list reads Mon, Tue, Wed. */
export const dayName = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${v}T12:00:00Z`));
};
/** The time of day a stream row carries, on his clock. */
export const timeShort = (v) => {
  if (!v) return '';
  const d = v && typeof v.toDate === 'function' ? v.toDate() : new Date(v);
  return Number.isFinite(d.getTime()) ? new Intl.DateTimeFormat('en-US', { timeZone: MT, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(d) : '';
};
/** How long ago, in the words a person uses: "just now", "2h ago", "Sep 20". */
export function agoShort(v, now = Date.now()) {
  if (!v) return '';
  const d = v && typeof v.toDate === 'function' ? v.toDate() : new Date(v);
  const ms = now - d.getTime();
  if (!Number.isFinite(ms)) return '';
  if (ms < 90_000) return 'just now';
  if (ms < 3600_000) return `${Math.round(ms / 60_000)}m ago`;
  if (ms < 20 * 3600_000) return `${Math.round(ms / 3600_000)}h ago`;
  return new Intl.DateTimeFormat('en-US', { timeZone: MT, month: 'short', day: 'numeric' }).format(d);
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

// ---- the small parts every card shares -------------------------------------
const SIDE = (side) => (side === 'short'
  ? '<span class="chip neon c-red">Short</span>'
  : '<span class="chip neon c-green">Long</span>');
const KIND = (kind) => `<span class="chip neon kind fl">${esc(HORIZON_WORDS[kind] || 'Intraday')}</span>`;
const cell = (label, value, cls = '', sub = '') =>
  `<div><div class="k">${esc(label)}</div><div class="v ${cls}">${value}</div>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}</div>`;
/** A hold in minutes, in the words a card has room for. */
export function holdWords(p) {
  if (p.horizon === 'swing') { const d = Number(p.holdDays) || 3; return `${d} day${d === 1 ? '' : 's'}`; }
  const m = Number(p.holdMinutes) || 0;
  return m >= 60 ? `${Math.round((m / 60) * 10) / 10}h` : `${m}m`;
}

/**
 * A SETUP IN ONE PLAIN SENTENCE (Eric, 2026-09-22: "Make the plays fucking
 * plain English. For example. 3 hours, NVDA, $248, stop loss price, take
 * profit price. If call, date strike expiration. Simplify. Don't make me guess
 * what it means.").
 *
 * So the face is his sentence and one line under it, and that is all. The
 * odds block, the two chips, the four cells and the In cell are gone: every
 * one of them made him translate something. What he loses if the stop hits is
 * said in dollars rather than as an R, the chance is said as a chance, and
 * everything else is behind the tap it was always behind.
 */
export function playFaceHtml(p, { rules, accountCents } = {}) {
  const R = rulesOf({ rules });
  const past = p.expiresAt && new Date(p.expiresAt).getTime() < Date.now() && p.status === 'open';
  const expired = p.status === 'expired' || past;
  const sz = playSizing({ play: p, rules: R, accountCents });
  const line = playLine(p, { rules: R, accountCents });
  const loses = sz.riskCents == null ? '' : `You lose about ${money(sz.riskCents)} if the stop hits.`;
  // THE CHANCE, BACK WHERE HE READS IT (Eric, 2026-09-22: "Why is the
  // confidence interval gone"). v6.7 took the odds block off the face with
  // the rest of the furniture and left the chance as the last words of the
  // small line under the sentence, which is a demotion of the one number he
  // reads first. It sits top right again, in the kind colour, on every card.
  const chance = p.profitLow == null ? '' : `<span class="odds"><div class="k">Chance</div><div class="v">${esc(p.profitLow)} to ${esc(p.profitHigh)}%</div></span>`;
  const over = sz.overRule ? `That is more than the ${money(sz.budgetCents)} you allow one trade.` : '';
  const near = p.entry == null ? '' : `Get in near ${priceWords(p.entry)}.`;
  const state = p.status === 'took' ? 'Taken' : p.status === 'closed' ? `Closed ${money(p.outcomeCents, true)}` : p.status === 'skipped' ? 'Skipped' : expired ? 'Expired' : '';
  const rows = [
    ['Why', p.picture], ['Catalyst', p.catalyst], ['Bull', p.bull], ['Bear', p.bear],
    ['Levels', (p.levels || []).join(' · ')], ['Risk', p.risk], ['Watch', p.watch],
    ['Overnight', p.overnight?.ok ? `Yes. ${p.overnight.why || ''}` : `No. ${p.overnight?.why || ''}`],
  ].filter(([, v]) => v);
  const live = p.status === 'open' && !expired;
  return `<article class="outlined play${expired ? ' expired' : ''}" data-kind="${esc(p.horizon || 'intraday')}" data-play="${esc(p.id)}">
    ${/* THE TICKER LEADS (Eric, 2026-09-22: "Stock names have disappeared"). v6.7 took the big
        ticker off with the rest of the furniture and left it mid sentence at body weight, so a
        board of cards had nothing to scan by. Left of the head row on every card; the chance stays
        right; the state word sits between when there is one. */''}
    <div class="head"><span class="tk">${esc(p.ticker)}</span>${state ? `<span class="co">${esc(state)}</span>` : ''}${chance}</div>
    <p class="plain">${esc(line)}</p>
    <p class="under${sz.overRule ? ' over' : ''}">${esc([near, loses, over].filter(Boolean).join(' '))}</p>
    <details><summary><span>Why, and what to watch</span><span class="chev">&#9662;</span></summary>
      <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    </details>
    <div class="acts">
      ${live ? '<button type="button" class="btn primary fl" data-act="take" style="min-width:120px">Take it</button><button type="button" class="btn tiny quiet end" data-act="skip">Skip</button>' : ''}
      ${p.status === 'took' ? '<button type="button" class="btn tiny" data-act="closed">Closed at</button>' : ''}
    </div>
    <p class="said" data-play-said></p>
  </article>`;
}

/**
 * A position he is in: what it is doing right now in dollars and in R, then
 * the four prices that decide it, then the ladder. The calculator's warnings
 * sit under them, because a missing stop is the thing he wants shouted.
 */
export function positionFaceHtml(p, calc, { quote = null } = {}) {
  const up = (calc.unrealizedCents ?? 0) >= 0;
  const closed = p.status === 'closed';
  const qtyText = p.instrument === 'stock' ? `${fmtQty(p.qty)} sh` : `${fmtQty(p.qty)} × ${p.structure || p.instrument}`;
  const lad = calc.ladder;
  const rungs = lad ? lad.levels.map((l) => l.price) : [];
  const pnl = closed ? p.pnlCents : calc.unrealizedCents;
  const rMul = calc.riskCents && pnl != null ? `${Math.round((pnl / calc.riskCents) * 10) / 10}R` : '';
  return `<article class="outlined pos${closed ? ' closed' : ''}" data-kind="${esc(p.horizon || 'intraday')}" data-pos="${esc(p.id)}">
    <div class="head"><span class="tk">${esc(p.ticker)}</span>${SIDE(p.side)}${KIND(p.horizon)}<span class="meta">${esc(qtyText)}</span></div>
    <div class="pnlrow"><div><span class="u ${up ? 'up' : 'dn'}">${pnl == null ? 'no mark' : money(pnl, true)}</span><span class="r">${esc(rMul)}</span></div></div>
    <div class="cells">
      ${cell('Entry', esc(p.entry))}
      ${cell('Stop', p.stop == null ? 'none' : esc(p.stop), 'stop')}
      ${cell('Risk', calc.riskCents == null ? 'not capped' : money(calc.riskCents))}
      ${cell('Last', calc.last == null ? (quote ? 'no quote' : 'none') : esc(calc.last))}
    </div>
    ${rungs.length ? `<div class="tg"><span class="k">Targets</span>${rungs[0]}<span class="later"> · ${rungs.slice(1).join(' · ')}</span></div>` : ''}
    ${(calc.warnings || []).length ? `<div class="warn"><b>&#x26A0;&#xFE0E;</b> ${esc((calc.warnings || []).map((w) => WARNING_TEXT[w] || w).join(' '))}</div>` : ''}
    ${closed ? `<div class="tg"><span class="k">Sold</span>${esc(p.exitPrice ?? '')} ${esc(p.closeNote || '')}</div>` : `<div class="acts">
      <button type="button" class="btn good" data-act="close">Close Position</button>
      <button type="button" class="btn tiny quiet end" data-act="edit">Edit &#9662;</button>
    </div>
    <div class="editgrid" hidden>
      <label class="k">Stop<input type="number" step="0.0001" inputmode="decimal" class="num" data-f="stop" value="${p.stop ?? ''}"></label>
      <label class="k">Target<input type="number" step="0.0001" inputmode="decimal" class="num" data-f="target" value="${p.target ?? ''}"></label>
      <label class="k">Quantity<input type="number" step="${p.instrument === 'stock' ? '0.0001' : '1'}" min="${p.instrument === 'stock' ? '0.0001' : '1'}" inputmode="${p.instrument === 'stock' ? 'decimal' : 'numeric'}" class="num" data-f="qty" value="${esc(fmtQty(p.qty))}"></label>
      ${p.instrument === 'stock' ? '' : `<label class="k">Mark<input type="number" step="0.0001" inputmode="decimal" class="num" data-f="mark" value="${p.mark ?? ''}"></label>`}
      <div class="acts"><button type="button" class="btn primary" data-act="save">Save</button><button type="button" class="btn quiet" data-act="cancel">Cancel</button><button type="button" class="btn tiny quiet end" data-act="remove">Remove</button></div>
    </div>`}
    <p class="said" data-pos-said></p>
  </article>`;
}

/** The colour, the glow and the word the day bar wears, per state. Pure, so a check can walk all seven. */
export function dayBarState(ds, gold = false) {
  const neg = (ds?.realizedTodayCents || 0) < 0;
  const map = {
    'stop-loss': ['var(--red)', '12px', 'Stop for the day. The loss limit is hit.', 'var(--red)'],
    'below-floor': [neg ? 'rgba(255,77,109,.55)' : 'var(--dim)', '0px', 'Under the floor', neg ? 'var(--red)' : 'var(--dim)'],
    'on-floor': ['var(--blue)', '10px', 'On the floor', 'var(--blue)'],
    'on-aim': gold ? ['var(--gold)', '16px', 'Past the aim by a point', 'var(--gold)'] : ['var(--green)', '12px', 'At the aim', 'var(--green)'],
    'stop-cap': ['var(--gold)', '16px', 'Stop for the day. The cap is hit.', 'var(--gold)'],
  };
  const [fill, glow, word, ink] = map[ds?.state] || map['below-floor'];
  return { fill, glow, word, ink };
}

// ---- the chart ---------------------------------------------------------------
/**
 * His balance against the line he is aiming at, as one SVG. Every colour is a
 * token, never a literal, so the page's scheme owns the look and the effects
 * module can light the line without touching the geometry.
 */
export function deskChartSvg(chart, { w = 340, h = 190, aim = '2%' } = {}) {
  if (!chart || !chart.points || !chart.points.length) return '';
  const L = 50; const R = 10; const T = 12; const B = 24;
  const xMax = Math.max(1, chart.xMax);
  const yTop = Math.max(chart.yMax, 1);
  const yBot = Math.max(0, Math.min(chart.yMin, yTop - 1));
  const sx = (x) => L + (x / xMax) * (w - L - R);
  const sy = (y) => T + (1 - (y - yBot) / (yTop - yBot)) * (h - T - B);
  const path = (pts) => pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  // Four round figures rather than the raw ends, so the axis reads as money.
  const step = Math.max(1, Math.ceil((yTop - yBot) / 3 / 10000) * 10000);
  const ticks = [0, 1, 2, 3].map((i) => yBot + i * step).filter((y) => y <= yTop + step);
  const tick = (y) => `<text x="${L - 5}" y="${(sy(y) + 4).toFixed(1)}" text-anchor="end" font-size="13" fill="var(--dim)">$${Math.round(y / 100).toLocaleString('en-US')}</text><line x1="${L}" x2="${w - R}" y1="${sy(y).toFixed(1)}" y2="${sy(y).toFixed(1)}" stroke="var(--line)"/>`;
  const xs = [0, Math.round(xMax / 2), xMax];
  const xl = (x) => `<text x="${sx(x).toFixed(1)}" y="${h - 6}" text-anchor="${x === 0 ? 'start' : x === xMax ? 'end' : 'middle'}" font-size="13" fill="var(--dim)">day ${x}</text>`;
  const last = chart.points[chart.points.length - 1];
  const pts = path(chart.points);
  return `<svg id="chart-svg" viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Your balance by trading day against the ${esc(aim)} a day line">
    <defs>
      <filter id="wave" x="-5%" y="-15%" width="110%" height="130%"><feTurbulence id="turb" type="fractalNoise" baseFrequency="0.02 0.4" numOctaves="1" seed="7" result="n"><animate attributeName="baseFrequency" values="0.018 0.38;0.024 0.44;0.018 0.38" dur="6s" repeatCount="indefinite"/></feTurbulence><feDisplacementMap id="disp" in="SourceGraphic" in2="n" scale="0" xChannelSelector="R" yChannelSelector="G"><animate id="disp-anim" attributeName="scale" values="0;0;0" dur="2.4s" repeatCount="indefinite"/></feDisplacementMap></filter>
      <filter id="blur3" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
      <filter id="blur6" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
      <filter id="blur10" x="-10%" y="-30%" width="120%" height="160%"><feGaussianBlur stdDeviation="10"/></filter>
    </defs>
    ${ticks.map(tick).join('')}${xs.map(xl).join('')}
    <polyline points="${path(chart.target)}" fill="none" stroke="var(--gold)" stroke-width="1.5" stroke-dasharray="5 4" opacity=".8"/>
    <g class="copies"><use href="#line" filter="url(#blur3)"/><use href="#line" filter="url(#blur6)"/><use href="#line" filter="url(#blur10)"/></g>
    <polyline id="line" points="${pts}"/>
    <polyline class="runner" points="${pts}"/><polyline class="runner2" points="${pts}"/>
    <polyline class="ignite" id="ignite" points="${pts}"/>
    <circle id="last-halo" cx="${sx(last.x).toFixed(1)}" cy="${sy(last.y).toFixed(1)}" r="9" fill="none" stroke="var(--green)" opacity=".35"><animate attributeName="r" values="7;13;7" dur="2.4s" repeatCount="indefinite"/><animate attributeName="opacity" values=".45;.08;.45" dur="2.4s" repeatCount="indefinite"/></circle>
    <circle id="last-dot" cx="${sx(last.x).toFixed(1)}" cy="${sy(last.y).toFixed(1)}" r="4" fill="var(--green)"/>
  </svg>`;
}

// ---- News --------------------------------------------------------------------
/** One headline: what it says, who wrote it, how long ago, and which of his tickers it names. */
export function newsRowHtml(n, { onDesk = [], now = Date.now() } = {}) {
  const lit = (n.related || []).some((t) => onDesk.includes(t));
  const ms = n.at ? now - new Date(n.at).getTime() : NaN;
  const ago = Number.isFinite(ms) ? (ms < 3600_000 ? `${Math.max(1, Math.round(ms / 60_000))}m` : `${Math.round(ms / 3600_000)}h`) : '';
  const chips = (n.related || []).map((t) => (onDesk.includes(t)
    ? `<button type="button" class="chip neon c-blue" data-tk="${esc(t)}">${esc(t)}</button>`
    : `<span class="chip">${esc(t)}</span>`)).join('');
  const title = n.url ? `<a class="t" href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.headline)}</a>` : `<div class="t">${esc(n.headline)}</div>`;
  return `<li class="${n.summary ? 'has' : ''}"><span class="b${lit ? ' lit' : ''}"></span><div>${title}<div class="s"><span>${esc(n.source)}${ago ? ` · ${ago}` : ''}</span>${chips}</div>${n.summary ? `<div class="sum">${esc(n.summary)}</div>` : ''}</div>${n.summary ? '<span class="chev">&#9662;</span>' : '<span></span>'}</li>`;
}
/** One earnings chip: who reports and when in the day, with beat or miss when the number is already out. */
export function earningsChipHtml(e, { onDesk = [] } = {}) {
  const when = e.hour === 'bmo' ? 'pre' : e.hour === 'amc' ? 'post' : e.hour || '';
  const beat = e.epsActual != null && e.epsEstimate != null ? (e.epsActual >= e.epsEstimate ? ' beat' : ' miss') : '';
  const body = `${esc(e.symbol)} <span style="opacity:.65;font-weight:500;text-transform:none">${esc(when)}${beat}</span>`;
  return onDesk.includes(e.symbol)
    ? `<button type="button" class="chip tap neon c-blue" data-tk="${esc(e.symbol)}">${body}</button>`
    : `<span class="chip tap">${body}</span>`;
}

// ---- Stats -------------------------------------------------------------------
const pctText = (x, d = 0) => `${(Number(x) * 100).toFixed(d)}%`;
const tone = (n) => (n > 0 ? 'up' : n < 0 ? 'dn' : '');
/** The first Stats page: the one figure that matters, then the pairs that explain it. */
export function statsOverviewHtml(s) {
  return `<div class="tiles">
    <div class="tile hero"><div><div class="k">Win rate</div><div class="v fl">${s.winRate === null ? 'n/a' : pctText(s.winRate)}</div></div><div class="side"><div>${s.wins} W / ${s.losses} L${s.flats ? ` / ${s.flats} flat` : ''}</div><div class="dim small" style="margin-top:4px">${s.count} closed trade${s.count === 1 ? '' : 's'}</div><div class="net ${tone(s.netCents)}" style="margin-top:2px">net ${money(s.netCents, true)}</div></div></div>
    <div class="tile"><div class="k">Profit factor</div><div class="v g">${s.profitFactor === null ? (s.noLosses ? 'no losses' : 'n/a') : s.profitFactor.toFixed(2)}</div><div class="sub">gross win over gross loss</div></div>
    <div class="tile"><div class="k">Expectancy</div><div class="v ${tone(s.expectancyCents)}">${money(s.expectancyCents, true)}</div><div class="sub">a trade</div></div>
    <div class="tile wide pair"><div><div class="k">Average win</div><div class="v up">${s.avgWinCents === null ? 'n/a' : money(s.avgWinCents, true)}</div></div><div><div class="k">Average loss</div><div class="v dn">${s.avgLossCents === null ? 'n/a' : money(s.avgLossCents, true)}</div></div></div>
    <div class="tile wide pair"><div><div class="k">Best</div><div class="v up">${s.best ? money(s.best.pnlCents, true) : 'n/a'}</div><div class="sub">${s.best ? `${esc(s.best.ticker || '')}` : ''}</div></div><div><div class="k">Worst</div><div class="v dn">${s.worst ? money(s.worst.pnlCents, true) : 'n/a'}</div><div class="sub">${s.worst ? `${esc(s.worst.ticker || '')}` : ''}</div></div></div>
  </div>
  <h2>Streak</h2>
  <div class="panel between"><div class="streak">${'<i></i>'.repeat(Math.min(12, s.streak.n))}<span class="num" style="margin-left:8px">${s.streak.n} ${s.streak.kind === 'win' ? 'win' : s.streak.kind === 'loss' ? 'loss' : 'flat'}${s.streak.n === 1 || s.streak.kind === 'none' ? '' : 'es'.slice(s.streak.kind === 'win' ? 1 : 0)}</span></div><span class="dim small num">longest ${s.longestWin}W · ${s.longestLoss}L</span></div>
  ${s.r ? `<h2>R</h2><div class="panel daily"><span class="l">Average</span><span class="n ${tone(s.r.avgR)}">${s.r.avgR}R</span><span class="q">over ${s.r.count} trades</span><span class="l">Best and worst</span><span class="n">${s.r.bestR}R</span><span class="q">and ${s.r.worstR}R</span></div>` : ''}`;
}
/** The second: how he trades by kind and by weekday, and whether the pace clears the aim. */
export function statsBreakdownHtml(s, m, rules) {
  const days = s.byWeekday;
  const maxAbs = Math.max(...days.map((d) => Math.abs(d.netCents)), 1);
  const aim = pctText(rules.dayAimPct / 100, 0);
  const proj = m.projections;
  return `<h2>By kind</h2>
  <div class="panel kinds">${['scalp', 'intraday', 'swing'].map((k) => {
    const d = s.byHorizon[k]; const c = k === 'scalp' ? 'var(--blue)' : k === 'intraday' ? 'var(--green)' : 'var(--gold)';
    return `<div style="--kc:${c}"><div class="k">${esc(k)}</div><div class="p num ${tone(d.netCents)}">${money(d.netCents, true)}</div><div class="wl">${d.wins}W ${d.losses}L</div></div>`;
  }).join('')}</div>
  <h2>By day</h2>
  <div class="panel wk">${days.map((d) => {
    const up = d.netCents >= 0;
    const px = Math.max(3, Math.round((Math.abs(d.netCents) / maxAbs) * (up ? 30 : 18)));
    return `<div><div class="trk"><i class="${up ? '' : 'dn'}" style="height:${px}px;${up ? 'bottom:18px' : 'top:31px'}"></i></div><span class="d">${esc(d.label)}</span><span class="n ${tone(d.netCents)}">${shortMoney(d.netCents)}</span></div>`;
  }).join('')}</div>
  <h2>Pace</h2>
  <div class="panel daily">
    <span class="l">Average a day</span><span class="n ${tone(m.avgDaily)}">${pctText(m.avgDaily, 2)}</span><span class="q">vs aim ${esc(aim)}</span>
    <span class="l">Total return</span><span class="n ${tone(m.totalReturn)}">${pctText(m.totalReturn, 1)}</span><span class="q">${m.days} day${m.days === 1 ? '' : 's'}</span>
    ${proj ? `<span class="l">A year at this pace</span><span class="n ${tone(proj.linearYearCents)}">${money(proj.linearYearCents, true)}</span><span class="q">linear</span>
    <span class="l"></span><span class="n ${tone(proj.compoundYearCents)}">${money(proj.compoundYearCents, true)}</span><span class="q">compounded</span>`
    : `<span class="l">A year at this pace</span><span class="n">after ${m.minDays}</span><span class="q">trading days</span>`}
  </div>
  <h2>Balance against the ${esc(aim)} line</h2>`;
}
/** The third: every close, newest first, with the bars above them oldest first so the shape of the fortnight reads left to right. */
export function statsClosesHtml(s) {
  const bars = [...s.last].reverse();
  const maxAbs = Math.max(...bars.map((r) => Math.abs(r.pnlCents)), 1);
  return `<h2>Last ${s.last.length} close${s.last.length === 1 ? '' : 's'}</h2>
  <div class="panel"><div class="bars">${bars.map((r) => `<button type="button" class="col" data-close="${esc(r.id)}" aria-label="${esc(r.ticker || '')} ${money(r.pnlCents, true)}"><i class="${r.pnlCents < 0 ? 'dn' : r.pnlCents === 0 ? 'flat' : ''}" style="height:${Math.max(3, Math.round((Math.abs(r.pnlCents) / maxAbs) * 56))}px"></i></button>`).join('')}</div><p class="dim tiny-t" style="margin:8px 0 0">Oldest on the left. Tap a bar or a row for the trade.</p></div>
  <div class="panel closes" style="margin-top:12px">${s.last.map((r) => `<button type="button" class="r" data-close="${esc(r.id)}"><div><div class="who"><b>${esc(r.ticker || '')}</b><span class="chip neon kind" data-kind="${esc(r.horizon)}">${esc(r.horizon)}</span></div><div class="d">${esc(dayName(r.closedDay))} ${esc(dayShort(r.closedDay))}${r.r == null ? '' : ` · ${r.r}R`}</div></div><span class="v ${tone(r.pnlCents)}">${money(r.pnlCents, true)}</span><span class="chev">&rsaquo;</span></button>`).join('')}</div>`;
}

// ---- the Desk's stream -------------------------------------------------------
/**
 * A message ending in a question mark is a question. A closing quote, bracket
 * or paren after it still counts, and so does trailing space; anything else is
 * a line for the log and nothing answers it (Eric, 2026-09-22: "If it does not
 * end in a question, treat it as information/context").
 */
export function isQuestion(text) {
  return /\?['"”’)\]\s]*$/.test(String(text || '').trim()) && String(text || '').trim() !== '';
}

/**
 * The log and the questions as one conversation, oldest first. The two come
 * from different places (Firestore for the log, the desk's own rows for the
 * questions) and the only thing that orders them is the clock.
 */
export function mergeStream(logRows = [], qaRows = [], pending = []) {
  const at = (v) => {
    if (!v) return NaN;
    const d = typeof v.toDate === 'function' ? v.toDate() : new Date(v);
    const ms = d.getTime();
    return Number.isFinite(ms) ? ms : NaN;
  };
  const out = [];
  for (const m of logRows) {
    out.push({ kind: 'log', id: m.id, at: at(m.ts), text: String(m.text || ''), attachment: m.attachment || null });
  }
  const seen = new Set();
  for (const q of qaRows) {
    if (seen.has(q.id)) continue;
    seen.add(q.id);
    out.push({
      kind: 'question', id: q.id, at: at(q.at), text: String(q.question || ''),
      answer: q.answer || '', status: q.status || 'done', doc: q.doc || null,
      file: q.file || null, error: q.error || '',
    });
  }
  for (const p of pending) {
    if (qaRows.some((q) => String(q.question || '').trim() === String(p.text || '').trim())) continue;
    out.push({ kind: 'question', id: p.id, at: at(p.at), text: p.text, answer: '', status: 'running', local: true });
  }
  // A row whose stamp has not landed yet sits at the end, which is where it
  // was typed; everything else goes by the clock.
  return out.sort((a, b) => {
    const an = Number.isFinite(a.at); const bn = Number.isFinite(b.at);
    if (an && bn) return a.at - b.at;
    if (an) return -1;
    if (bn) return 1;
    return 0;
  });
}

/** One entry in the stream: his in blue with his name on it, the desk's in green with its own. */
export function streamRowHtml(row, { md = (t) => esc(t), stalled = false } = {}) {
  const t = Number.isFinite(row.at) ? timeShort(new Date(row.at)) : '';
  const file = (f, icon) => (f ? `<button type="button" class="att" data-file="${esc(f.url || '')}">${icon} ${esc(f.name || 'file')}</button>` : '');
  const CAM = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>';
  const DOC = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h8l5 5v13H6z"/><path d="M14 3v5h5M9 13h7M9 17h7"/></svg>';
  if (row.kind === 'log') {
    return `<article class="msg you"><header><span class="who fl">You</span><span class="t">${esc(t)}</span></header><div class="b">${esc(row.text)}</div>${file(row.attachment, CAM)}</article>`;
  }
  const ask = `<article class="msg you"><header><span class="who fl">You</span><span class="t">${esc(t)}</span><span class="tag">Ask</span></header><div class="b">${esc(row.text)}</div>${file(row.file, CAM)}</article>`;
  if (row.status === 'running') {
    const body = stalled
      ? '<div class="b">No answer came back. Ask it again.</div>'
      : '<div class="b"><i></i><i></i><i></i></div>';
    return `${ask}<article class="msg desk think"><header><span class="who">Desk</span><span class="t"></span></header>${body}</article>`;
  }
  if (row.status === 'error') {
    return `${ask}<article class="msg desk"><header><span class="who">Desk</span><span class="t">${esc(t)}</span></header><div class="b">${esc(row.error || 'That one did not come back.')}</div></article>`;
  }
  return `${ask}<article class="msg desk latest"><header><span class="who fl">Desk</span><span class="t">${esc(t)}</span></header><div class="b">${md(row.answer)}</div>${file(row.doc, DOC)}</article>`;
}

/** A line for his log when he sells, in the words the reading grades from. */
export function logLineFor(p, pnlCents, exitPrice) {
  const what = p.instrument === 'stock' ? `${fmtQty(p.qty)} shares` : `${fmtQty(p.qty)} ${p.structure || p.instrument}`;
  const out = exitPrice != null && exitPrice !== '' ? ` Out at ${exitPrice},` : '';
  return `${p.ticker} ${p.side} ${what} at ${p.entry}${p.stop == null ? '' : `, stop ${p.stop}`}.${out} ${pnlCents >= 0 ? 'plus' : 'minus'} ${Math.abs(pnlCents / 100).toFixed(2)}.`;
}

export { esc, fmtPct };
