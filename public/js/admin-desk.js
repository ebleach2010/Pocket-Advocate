// The trade desk's own pages inside the case folder (Eric, 2026-09-22:
// "Make it a case file highlighted green"). Three things live here: the play
// cards the panel paints onto the Plays page (where a medical case has its
// Dx page), the Stats page (his balance, the entries, the chart against the
// his aim a day line), and the Desk page (the key, the account type, the start,
// the watchlist, the two switches).
//
// The name is load-bearing: admin-desk.js matches the Worker's asset gate,
// so this file is a 404 to anyone but him. The pages talk to one route,
// /api/admin/trade/state, on show; the cards come from the panel's poll.

import {
  tradeCalc, dayStatus, realizedToday, openRisk, rulesOf, defaultRules, RULE_RANGES,
  HORIZONS, HORIZON_WORDS, WARNING_TEXT, ladder, sizeFor, unitRisk, fmtPct,
} from './trade-math.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (cents, signed = false) => {
  const n = Number(cents) || 0;
  const s = `$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${s}` : signed && n > 0 ? `+${s}` : s;
};
const pct = (x, d = 2) => `${(Number(x) * 100).toFixed(d)}%`;
const MT = 'America/Boise';
export const dayShort = (v) => {
  if (!v) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: MT, month: 'short', day: 'numeric' }).format(new Date(`${v}T12:00:00Z`));
};

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

// ---- the play cards ------------------------------------------------------------
/** One card per play, the six setup lines on it. Pure: a play in, markup out. */
export function playCardHtml(p) {
  const past = p.expiresAt && new Date(p.expiresAt).getTime() < Date.now() && p.status === 'open';
  const expired = p.status === 'expired' || past;
  const chance = `${p.profitLow} to ${p.profitHigh}% chance of profit`;
  const kind = HORIZON_WORDS[p.horizon] || 'Intraday';
  const rows = [
    ['Kind', p.horizon === 'swing' ? `${kind}, ${p.holdDays || 3} day${(p.holdDays || 3) === 1 ? '' : 's'}, out before the weekend` : kind],
    ['Structure', p.structure || p.instrument],
    ['Entry', p.entry], ['Stop', p.stop], ['Targets', (p.targets || []).join(', ')],
    ['Hold', p.holdMinutes >= 60 ? `${Math.round(p.holdMinutes / 60 * 10) / 10} h` : `${p.holdMinutes} min`],
    ['Size', money(Number(p.sizeDollars) * 100)],
    ...(p.picture ? [['Current picture', p.picture]] : []),
    ...(p.bull ? [['Bull case', p.bull]] : []),
    ...(p.bear ? [['Bear case', p.bear]] : []),
    ...((p.levels || []).length ? [['Levels', p.levels.join(', ')]] : []),
    ['Risk', p.risk],
    ...(p.watch ? [['What to watch next', p.watch]] : []),
    ...(p.why ? [['Why', p.why]] : []),
    ['Catalyst', p.catalyst],
    ['Overnight', p.overnight?.ok ? `Yes. ${p.overnight.why || ''}` : `No. ${p.overnight?.why || ''}`],
  ];
  const state = p.status === 'took' ? 'Taken' : p.status === 'closed' ? `Closed ${money(p.outcomeCents, true)}` : p.status === 'skipped' ? 'Skipped' : expired ? 'Expired' : 'Open';
  const canTake = p.status === 'open' || p.status === 'expired';
  return `<div class="panel play-card${expired ? ' expired' : ''}" data-play="${esc(p.id)}">
    <div class="play-head"><span><span class="play-ticker">${esc(p.ticker)}</span> <span class="play-side">${esc(p.side)}</span> <span class="pos-badge kind-${esc(p.horizon || 'intraday')}">${esc(kind)}</span></span><span class="trade-when">${esc(p.slot ? `read at ${p.slot}` : '')}${p.slot ? ' · ' : ''}${esc(state)}</span></div>
    <div class="play-chance">${esc(chance)}</div>
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${canTake ? `<div class="play-actions"><button type="button" class="btn tiny" data-act="took">Took it</button><button type="button" class="btn quiet tiny" data-act="skipped">Skip</button></div>` : ''}
    ${p.status === 'took' && !p.positionId ? `<div class="play-actions"><label class="dim small">Open it as a position, quantity <input type="number" step="1" min="1" inputmode="numeric" data-open-qty></label><button type="button" class="btn tiny" data-act="open">Add to Trades</button></div>` : ''}
    ${p.status === 'took' ? `<div class="play-actions"><label class="dim small">Closed at, dollars, plus or minus <input type="number" step="0.01" inputmode="decimal" data-outcome></label><button type="button" class="btn tiny" data-act="closed">Close</button></div>` : ''}
    <p class="trade-said" data-play-said></p>
  </div>`;
}

// The fields the open action needs, off the card the panel painted. The
// panel holds the play objects, but a card can be replaced by its own
// repaint, so the values are read from the rows rather than kept in a
// closure that a repaint would drop.
function playOf(card) {
  const val = (k) => {
    const dts = [...card.querySelectorAll('dt')];
    const dt = dts.find((d) => d.textContent.trim() === k);
    return dt ? dt.nextElementSibling?.textContent.trim() || '' : '';
  };
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  return {
    ticker: card.querySelector('.play-ticker')?.textContent.trim() || '',
    side: card.querySelector('.play-side')?.textContent.trim() || 'long',
    instrument: /spread/i.test(val('Structure')) ? 'spread' : /call/i.test(val('Structure')) ? 'call' : /put/i.test(val('Structure')) ? 'put' : 'stock',
    horizon: (card.querySelector('.pos-badge')?.textContent.trim() || 'Intraday').toLowerCase(),
    entry: num(val('Entry')), stop: num(val('Stop')),
    targets: val('Targets').split(',').map((x) => num(x.trim())).filter((x) => x != null),
    structure: val('Structure'),
  };
}

/** Took it, Skip, Close and Add to Trades on every card under `root`. A saved card repaints itself from the server's answer. */
export function wirePlayCards(root, { getToken, onSaved = null, onOpened = null } = {}) {
  for (const b of root.querySelectorAll('[data-act]')) {
    b.addEventListener('click', async () => {
      const card = b.closest('[data-play]');
      const said = card.querySelector('[data-play-said]');
      // A play he took becomes a position of his own, with its own
      // arithmetic on the Trades page (2026-09-22).
      if (b.dataset.act === 'open') {
        const qty = Number(card.querySelector('[data-open-qty]')?.value);
        if (!Number.isInteger(qty) || qty < 1) { said.textContent = 'Quantity: a whole number, 1 or more.'; said.classList.add('trade-err'); return; }
        const p = playOf(card);
        for (const x of card.querySelectorAll('button')) x.disabled = true;
        said.classList.remove('trade-err');
        said.textContent = 'Adding…';
        try {
          await tradeCall(getToken, 'position', {
            fromPlay: card.dataset.play, ticker: p.ticker, side: p.side, instrument: p.instrument,
            horizon: p.horizon || 'intraday', qty, entry: p.entry, stop: p.stop,
            target: (p.targets || [])[0] ?? null, structure: p.structure || '',
          });
          said.textContent = 'Added to Trades.';
          onOpened?.();
        } catch (err) {
          said.textContent = err.message; said.classList.add('trade-err');
          for (const x of card.querySelectorAll('button')) x.disabled = false;
        }
        return;
      }
      const body = { id: card.dataset.play, status: b.dataset.act };
      if (b.dataset.act === 'closed') {
        const v = Number(card.querySelector('[data-outcome]')?.value);
        if (!Number.isFinite(v)) { said.textContent = 'Enter the dollars, plus or minus.'; said.classList.add('trade-err'); return; }
        body.outcomeCents = Math.round(v * 100);
      }
      for (const x of card.querySelectorAll('button')) x.disabled = true;
      said.classList.remove('trade-err');
      said.textContent = 'Saving…';
      try {
        const out = await tradeCall(getToken, 'play', body);
        const wrap = document.createElement('div');
        wrap.innerHTML = playCardHtml({ ...out.play, id: card.dataset.play });
        const next = wrap.firstElementChild;
        card.replaceWith(next);
        wirePlayCards(next, { getToken, onSaved, onOpened });
        onSaved?.(out.play);
      } catch (err) {
        said.textContent = err.message; said.classList.add('trade-err');
        for (const x of card.querySelectorAll('button')) x.disabled = false;
      }
    });
  }
}

// ---- the chart -------------------------------------------------------------------
/** The chart, as one SVG string. Pure: a chart series in, markup out, colours by token. */
export function svgChart(chart, { w = 340, h = 200, aim = '2%' } = {}) {
  if (!chart || !chart.points || !chart.points.length) return '';
  const L = 46; const R = 8; const T = 10; const B = 26;
  const xMax = Math.max(1, chart.xMax);
  const yTop = Math.max(chart.yMax, 1);
  const yBot = Math.max(0, Math.min(chart.yMin, yTop - 1));
  const sx = (x) => L + (x / xMax) * (w - L - R);
  const sy = (y) => T + (1 - (y - yBot) / (yTop - yBot)) * (h - T - B);
  const path = (pts) => pts.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
  const ticks = [yBot, (yBot + yTop) / 2, yTop];
  const tick = (y) => `<text x="${L - 4}" y="${(sy(y) + 4).toFixed(1)}" text-anchor="end" font-size="10" fill="var(--dim)">$${Math.round(y / 100).toLocaleString('en-US')}</text><line x1="${L}" x2="${w - R}" y1="${sy(y).toFixed(1)}" y2="${sy(y).toFixed(1)}" stroke="var(--line)" stroke-width="1"/>`;
  const xs = [0, Math.round(xMax / 2), xMax];
  // The two end labels hug their edges, or the last one is clipped at the
  // right of the box.
  const xl = (x) => `<text x="${sx(x).toFixed(1)}" y="${h - 8}" text-anchor="${x === 0 ? 'start' : x === xMax ? 'end' : 'middle'}" font-size="10" fill="var(--dim)">day ${x}</text>`;
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Your balance by trading day against the ${aim} a day line">
    ${ticks.map(tick).join('')}${xs.map(xl).join('')}
    <polyline points="${path(chart.target)}" fill="none" stroke="var(--target)" stroke-width="2" stroke-dasharray="5 4"/>
    <polyline points="${path(chart.points)}" fill="none" stroke="var(--cyan)" stroke-width="2.5" stroke-linejoin="round"/>
    ${chart.points.map((p) => `<circle cx="${sx(p.x).toFixed(1)}" cy="${sy(p.y).toFixed(1)}" r="3" fill="var(--cyan)"/>`).join('')}
  </svg>`;
}

// ---- Stats: the balance, the entries, the chart ----------------------------------------
/** The Stats page. `pane._reload` refetches; the page shows it every time it opens. */
export function mountTradeStats(pane, { getToken }) {
  pane.innerHTML = `
    <div data-stats-top><p class="dim">Loading…</p></div>
    <form class="panel trade-form" data-acct-form>
      <label>Date <input type="date" name="date" required></label>
      <label>Balance, in dollars <input type="number" name="dollars" step="0.01" min="0" inputmode="decimal" required></label>
      <label>Note (optional) <input type="text" name="note" maxlength="140"></label>
      <div class="row"><button type="submit" class="btn">Save balance</button><span class="trade-said" data-acct-said></span></div>
    </form>
    <ul class="trade-list" data-acct-list></ul>
    <div data-stats></div>`;
  const form = pane.querySelector('[data-acct-form]');
  const said = pane.querySelector('[data-acct-said]');
  let S = null;
  function paint() {
    const m = S.metrics;
    const top = pane.querySelector('[data-stats-top]');
    if (!form.date.value) form.date.value = S.today;
    const dir = m.gainCents >= 0 ? 'up' : 'down';
    const proj = m.projections
      ? `<div class="panel"><h3>Projected year</h3>
          <p>At your average daily profit so far: <strong>${esc(money(m.projections.linearYearCents, true))}</strong> a year.</p>
          <p>If that average held and compounded: <strong>${esc(money(m.projections.compoundYearCents, true))}</strong> a year.</p>
          <p class="dim small">Both are ${m.days} trading days of data stretched over ${252} trading days. They move with every entry.</p></div>`
      : `<p class="dim small">Projections start after ${m.minDays} trading days of entries (${m.days} so far).</p>`;
    top.innerHTML = `
      <div class="trade-big">${esc(money(m.currentCents))}</div>
      <p>Started at ${esc(money(m.startCents))}${m.startedAt ? ` on ${esc(dayShort(m.startedAt))}` : ''}. ${m.days} trading day${m.days === 1 ? '' : 's'}, ${dir} ${esc(money(Math.abs(m.gainCents)))} (${esc(pct(m.totalReturn, 1))}).</p>
      <p>Average ${esc(pct(m.avgDaily))} a day against a target of ${esc(pct(m.target, 0))}.</p>
      ${proj}`;
    const list = pane.querySelector('[data-acct-list]');
    const rows = [...(S.balances || [])].reverse();
    list.innerHTML = rows.length ? rows.map((b) => `<li><span>${esc(dayShort(b.date))} <strong>${esc(money(b.cents))}</strong>${b.source === 'screenshot' ? ' <span class="dim small">📷 from a screenshot</span>' : ''}${b.note && b.source !== 'screenshot' ? ` <span class="dim small">${esc(b.note)}</span>` : ''}</span><button type="button" class="btn quiet tiny" data-del="${esc(b.date)}">Delete</button></li>`).join('')
      : '<li class="dim">No entries yet. Type today\'s balance above, or ask with a screenshot of your portfolio total.</li>';
    for (const b of list.querySelectorAll('[data-del]')) {
      b.addEventListener('click', async () => {
        b.disabled = true;
        try { await tradeCall(getToken, 'balance', { date: b.dataset.del, remove: true }); await load(); } catch (err) { b.disabled = false; said.textContent = err.message; }
      });
    }
    const stats = pane.querySelector('[data-stats]');
    // HIS AIM, NOT A NUMBER IN THE PAGE (2026-09-22): the target line is the
    // aim on the Calc page, so the chart says whatever that rule says.
    const aim = pct(m.target, 0);
    const line = m.days === 0
      ? 'No entries yet. Add today\'s balance above and the chart starts.'
      : `You are ${money(Math.abs(m.offTargetCents))} (${Math.abs(m.offTargetPoints).toFixed(2)} points a day) ${m.offTargetCents < 0 ? 'below' : 'above'} the ${aim} a day line.`;
    stats.innerHTML = `
      <p><strong>${esc(line)}</strong></p>
      <div class="panel trade-chart">${svgChart(S.chart, { aim })}
        <div class="trade-legend"><span><i style="background:var(--cyan)"></i>Your balance</span><span><i style="background:var(--target)"></i>${esc(aim)} a day from ${esc(money(m.startCents))}</span></div>
      </div>
      <p class="dim small">Where the line should be today: ${esc(money(m.targetCents))} after ${m.days} trading day${m.days === 1 ? '' : 's'}. Your average: ${esc(pct(m.avgDaily))} a day.</p>`;
  }
  async function load() {
    try {
      S = await tradeCall(getToken, 'state');
      paint();
    } catch (err) {
      pane.querySelector('[data-stats-top]').innerHTML = `<p class="error">Could not load: ${esc(err.message)}</p>`;
    }
  }
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = form.date.value;
    const dollars = Number(form.dollars.value);
    if (!Number.isFinite(dollars)) { said.textContent = 'Enter the balance in dollars.'; said.classList.add('trade-err'); return; }
    said.classList.remove('trade-err');
    said.textContent = 'Saving…';
    form.querySelector('button').disabled = true;
    try {
      await tradeCall(getToken, 'balance', { date, cents: Math.round(dollars * 100), note: form.note.value });
      form.dollars.value = ''; form.note.value = '';
      said.textContent = 'Saved.';
      await load();
    } catch (err) {
      said.textContent = err.message; said.classList.add('trade-err');
    } finally {
      form.querySelector('button').disabled = false;
    }
  });
  pane._reload = load;
  load();
}

// ---- Desk: the key, the account, the start, the watchlist, the switches ------------------
// Render disabled, ask the server, paint what it said, and only then let him
// touch a control. A failed save puts the control back where the server
// left it and says why. The same discipline as the settings overlay.
export function mountTradeDesk(pane, { getToken }) {
  pane.innerHTML = `
    <div class="panel trade-form" data-settings>
      <h3>Market data</h3>
      <p class="dim small" data-key-said>Reading…</p>
      <div class="row" data-key-row hidden>
        <input type="password" data-key placeholder="Finnhub API key" autocomplete="off" disabled>
        <button type="button" class="btn tiny" data-key-save disabled>Save key</button>
        <button type="button" class="btn quiet tiny" data-key-replace hidden>Replace</button>
      </div>
      <h3>Account</h3>
      <div class="seg" data-acct-type>
        <button type="button" data-acct="cash" disabled>Cash</button>
        <button type="button" data-acct="margin" disabled>Margin</button>
      </div>
      <label>Starting amount, in dollars <input type="number" data-start-dollars step="1" min="1" inputmode="numeric" disabled></label>
      <label>Started on <input type="date" data-started disabled></label>
      <div class="row"><button type="button" class="btn tiny" data-start-save disabled>Save start</button></div>
      <h3>Watchlist</h3>
      <label>Tickers, comma separated, up to 20 <input type="text" data-watch disabled></label>
      <div class="row"><button type="button" class="btn tiny" data-watch-save disabled>Save watchlist</button></div>
      <h3>Switches</h3>
      <div class="toggle-row"><span><strong>Pushes</strong><br><span class="dim small">A push to your phone when a scan or a reading finds a strong play.</span></span><button type="button" class="switch" data-sw="pushOn" aria-pressed="false" aria-label="Pushes" disabled></button></div>
      <p class="trade-said" data-set-said></p>
    </div>
    <p class="trade-foot">Ideas, not orders. Every trade is your decision.</p>`;
  const box = pane.querySelector('[data-settings]');
  const said = box.querySelector('[data-set-said]');
  let confirmed = null;
  let today = '';
  function paintSettings(payload) {
    confirmed = { settings: { ...payload.settings }, hasKey: payload.hasKey, keyTail: payload.keyTail };
    const s = payload.settings;
    const keySaid = box.querySelector('[data-key-said]');
    const keyIn = box.querySelector('[data-key]');
    keySaid.textContent = payload.hasKey ? `Key on file, ends in ${payload.keyTail}.` : 'No key yet. Sign up at finnhub.io (free), then paste the key here.';
    box.querySelector('[data-key-row]').hidden = false;
    keyIn.hidden = payload.hasKey; keyIn.disabled = false; keyIn.value = '';
    box.querySelector('[data-key-save]').hidden = payload.hasKey; box.querySelector('[data-key-save]').disabled = false;
    box.querySelector('[data-key-replace]').hidden = !payload.hasKey;
    for (const b of box.querySelectorAll('[data-acct]')) { b.classList.toggle('on', b.dataset.acct === s.accountType); b.disabled = false; }
    box.querySelector('[data-start-dollars]').value = String(Math.round(s.startCents / 100));
    box.querySelector('[data-start-dollars]').disabled = false;
    box.querySelector('[data-started]').value = s.startedAt || today || '';
    box.querySelector('[data-started]').disabled = false;
    box.querySelector('[data-start-save]').disabled = false;
    box.querySelector('[data-watch]').value = (s.watchlist || []).join(', ');
    box.querySelector('[data-watch]').disabled = false;
    box.querySelector('[data-watch-save]').disabled = false;
    for (const sw of box.querySelectorAll('[data-sw]')) {
      const on = s[sw.dataset.sw] !== false;
      sw.classList.toggle('on', on); sw.setAttribute('aria-pressed', String(on)); sw.disabled = false;
    }
  }
  const save = async (body, controls) => {
    for (const c of controls) c.disabled = true;
    said.classList.remove('trade-err');
    said.textContent = 'Saving…';
    try {
      const out = await tradeCall(getToken, 'settings', body);
      paintSettings(out);
      said.textContent = 'Saved.';
      // The panel's Pause and next-read line, and the overview's button,
      // follow at once rather than on the next poll.
      document.dispatchEvent(new CustomEvent('pa-desk-settings', { detail: out }));
    } catch (err) {
      if (confirmed) paintSettings(confirmed);
      said.textContent = `Not changed: ${err.message}`;
      said.classList.add('trade-err');
    }
  };
  box.querySelector('[data-key-save]').addEventListener('click', () => {
    const keyIn = box.querySelector('[data-key]');
    save({ finnhubKey: keyIn.value.trim() }, [keyIn, box.querySelector('[data-key-save]')]);
  });
  box.querySelector('[data-key-replace]').addEventListener('click', () => {
    box.querySelector('[data-key]').hidden = false;
    box.querySelector('[data-key-save]').hidden = false;
    box.querySelector('[data-key-replace]').hidden = true;
    box.querySelector('[data-key]').focus();
  });
  for (const b of box.querySelectorAll('[data-acct]')) b.addEventListener('click', () => save({ accountType: b.dataset.acct }, [...box.querySelectorAll('[data-acct]')]));
  box.querySelector('[data-start-save]').addEventListener('click', () => {
    const d = Number(box.querySelector('[data-start-dollars]').value);
    save({ startCents: Math.round(d * 100), startedAt: box.querySelector('[data-started]').value }, [box.querySelector('[data-start-save]')]);
  });
  box.querySelector('[data-watch-save]').addEventListener('click', () => save({ watchlist: box.querySelector('[data-watch]').value }, [box.querySelector('[data-watch-save]')]));
  for (const sw of box.querySelectorAll('[data-sw]')) sw.addEventListener('click', () => save({ [sw.dataset.sw]: sw.getAttribute('aria-pressed') !== 'true' }, [sw]));
  async function load() {
    try {
      const S = await tradeCall(getToken, 'state');
      today = S.today || '';
      paintSettings(S);
    } catch (err) {
      box.querySelector('[data-key-said]').textContent = `Could not load: ${err.message}`;
    }
  }
  pane._reload = load;
  load();
}

// ---- his positions: the cards, the day strip, and the two pages ----------------
//
// Eric, 2026-09-22: "a calculator for bands stop losses take profits and
// whatever else my noob ass doesn't know about. Most useful when the
// information is calculated and displayed neatly by the trade." So every
// open position carries its own arithmetic on its face: what it risks
// against his rule, the ladder of R levels around the entry, where the last
// price sits, and anything worth a warning. The arithmetic itself lives in
// trade-math.js, shared with the Worker, so the page never invents a figure.

const KIND_ORDER = ['scalp', 'intraday', 'swing'];

/** Where the day stands against his rules, as one strip. Pure. */
export function dayStripHtml(ds) {
  if (!ds) return '';
  const tone = ds.state === 'stop-loss' ? ' bad' : ds.state === 'stop-cap' || ds.state === 'on-aim' ? ' good' : '';
  return `<div class="day-strip${tone}" data-day-strip>
    <span><span class="day-k">TODAY</span> <strong data-day-realized>${esc(money(ds.realizedTodayCents, true))}</strong></span>
    <span data-day-state>${esc(ds.line)}</span>
    <span class="dim small">Floor ${esc(money(ds.floorCents))} · Aim ${esc(money(ds.aimCents))} · Stop at ${esc(money(ds.lossLimitCents))} or ${esc(money(ds.capCents))} · <span data-day-left>${esc(money(ds.remainingRiskCents))}</span> left to risk</span>
  </div>`;
}

/** One position, with every figure the calculator gives. Pure: a row and the numbers around it in, markup out. */
export function positionCardHtml(p, { rules, accountCents, todayKey, accountType, quote = null } = {}) {
  const c = tradeCalc({ pos: p, rules, accountCents, todayKey, accountType, quote });
  const kind = HORIZON_WORDS[p.horizon] || 'Intraday';
  const closed = p.status === 'closed';
  const qtyText = p.instrument === 'stock' ? `${p.qty} share${p.qty === 1 ? '' : 's'}` : `${p.qty} contract${p.qty === 1 ? '' : 's'}`;
  const lad = c.ladder;
  const rows = [
    ['Entry', `${p.entry}${p.structure ? ` · ${p.structure}` : ''}`],
    ['Stop', p.stop == null ? 'none set' : `${p.stop}${c.distances.stopFromEntry ? ` (${fmtPct(c.distances.stopFromEntry.pct)} from entry)` : ''}`],
    ['Target', c.target == null ? 'none set' : `${c.target}${c.rr == null ? '' : ` (${c.rr}R)`}${c.rewardCents == null ? '' : `, ${money(c.rewardCents)} if it pays`}`],
    ['Size', `${qtyText}, ${money(c.positionCents)}${c.positionPct == null ? '' : ` (${fmtPct(c.positionPct)} of the account)`}`],
    ['Risk', c.riskCents == null ? 'not capped' : `${money(c.riskCents)}${c.riskPct == null ? '' : ` (${fmtPct(c.riskPct)})`}, your rule allows ${money(c.budgetCents)}`],
    ...(lad ? [['Ladder', `stop ${p.stop} · breakeven ${lad.breakeven} · ${lad.levels.map((l) => `${l.r}R ${l.price}`).join(' · ')}`]] : []),
    ...(c.last != null ? [['Last', `${c.last}${c.unrealizedCents == null ? '' : ` · ${c.unrealizedCents >= 0 ? 'up' : 'down'} ${money(Math.abs(c.unrealizedCents))}`}`]] : []),
    ...(c.distances.stopFromLast || c.distances.targetFromLast ? [['From here', [
      c.distances.stopFromLast ? `stop ${fmtPct(Math.abs(c.distances.stopFromLast.pct))} away` : '',
      c.distances.targetFromLast ? `target ${fmtPct(Math.abs(c.distances.targetFromLast.pct))} away` : '',
    ].filter(Boolean).join(', ')]] : []),
    ...(c.todaysRange ? [['Today', `${c.todaysRange.low} to ${c.todaysRange.high}`]] : []),
    ...(p.note ? [['Note', p.note]] : []),
    ...(closed ? [['Sold', `${p.exitPrice ?? ''} · ${money(p.pnlCents, true)}${p.closeNote ? ` · ${p.closeNote}` : ''}`]] : []),
  ];
  return `<div class="panel pos-card${closed ? ' closed' : ''}" data-pos="${esc(p.id)}" data-horizon="${esc(p.horizon || 'intraday')}">
    <div class="play-head">
      <span><span class="play-ticker">${esc(p.ticker)}</span> <span class="play-side">${esc(p.side)}</span> <span class="pos-badge kind-${esc(p.horizon || 'intraday')}">${esc(kind)}</span></span>
      <span class="trade-when">${closed ? esc(money(p.pnlCents, true)) : esc(qtyText)}</span>
    </div>
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${(c.warnings || []).length ? `<ul class="pos-warn">${c.warnings.map((w) => `<li>${esc(WARNING_TEXT[w] || w)}</li>`).join('')}</ul>` : ''}
    ${closed ? '' : `<div class="play-actions">
      <button type="button" class="btn tiny" data-act="sold">Sold</button>
      <button type="button" class="btn quiet tiny" data-act="remove">Remove</button>
    </div>
    <div class="sold-sheet" data-sold-sheet hidden>
      <label>Sold at, price <input type="number" step="0.0001" inputmode="decimal" data-exit></label>
      <label>or the profit and loss, in dollars <input type="number" step="0.01" inputmode="decimal" data-pl></label>
      <label>Note (optional) <input type="text" maxlength="300" data-close-note></label>
      <label class="row-check"><input type="checkbox" data-log checked> Put a line in the log</label>
      <div class="row"><button type="button" class="btn tiny" data-act="close">Log it</button><button type="button" class="btn quiet tiny" data-act="cancel">Cancel</button></div>
    </div>`}
    <p class="trade-said" data-pos-said></p>
  </div>`;
}

/** A line for his log when he sells, in the words the reading grades from. */
function logLineFor(p, pnlCents, exitPrice) {
  const what = p.instrument === 'stock' ? `${p.qty} shares` : `${p.qty} ${p.structure || p.instrument}`;
  const out = exitPrice != null && exitPrice !== '' ? ` Out at ${exitPrice},` : '';
  return `${p.ticker} ${p.side} ${what} at ${p.entry}${p.stop == null ? '' : `, stop ${p.stop}`}.${out} ${pnlCents >= 0 ? 'plus' : 'minus'} ${Math.abs(pnlCents / 100).toFixed(2)}.`;
}

/** The Trades page: the day, a form that does the arithmetic as he types, his open positions, and what he closed today. */
export function mountTrades(pane, { getToken, onLog = null, onCelebrate = null }) {
  pane.innerHTML = `
    <div data-day-wrap></div>
    <details class="panel trade-form" data-pos-new>
      <summary><strong>New trade</strong></summary>
      <form data-pos-form>
        <div class="form-grid">
          <label>Ticker <input name="ticker" maxlength="6" autocapitalize="characters" required></label>
          <label>Side <select name="side"><option value="long">Long</option><option value="short">Short</option></select></label>
          <label>Kind <select name="horizon">${KIND_ORDER.map((h) => `<option value="${h}"${h === 'intraday' ? ' selected' : ''}>${HORIZON_WORDS[h]}</option>`).join('')}</select></label>
          <label>Instrument <select name="instrument"><option value="stock">Stock</option><option value="call">Call</option><option value="put">Put</option><option value="spread">Spread</option></select></label>
          <label>Quantity <input name="qty" type="number" step="1" min="1" inputmode="numeric" required></label>
          <label>Entry <input name="entry" type="number" step="0.0001" inputmode="decimal" required></label>
          <label>Stop <input name="stop" type="number" step="0.0001" inputmode="decimal"></label>
          <label>Target <input name="target" type="number" step="0.0001" inputmode="decimal"></label>
          <label data-opt hidden>Structure <input name="structure" maxlength="120" placeholder="Oct 17 650 call"></label>
          <label data-opt hidden>Mark, the last premium <input name="mark" type="number" step="0.0001" inputmode="decimal"></label>
          <label data-spread hidden>Spread width <input name="width" type="number" step="0.01" inputmode="decimal"></label>
          <label data-spread hidden class="row-check"><input type="checkbox" name="credit"> Credit spread</label>
          <label data-opt hidden>Expiry <input name="expiry" type="date"></label>
          <label>Note <input name="note" maxlength="300"></label>
        </div>
        <div class="row"><button type="button" class="btn quiet tiny" data-quote-btn>Get the price</button><span class="dim small" data-quote-said></span></div>
        <div class="pos-preview" data-pos-preview></div>
        <div class="row"><button type="submit" class="btn">Save the trade</button><span class="trade-said" data-pos-said></span></div>
      </form>
    </details>
    <div data-pos-list><p class="dim">Loading…</p></div>
    <h3 class="closed-head">Closed today</h3>
    <ul class="trade-list" data-closed-list></ul>
    <p class="trade-foot">Ideas, not orders. Every trade is your decision.</p>`;
  const form = pane.querySelector('[data-pos-form]');
  const said = pane.querySelector('[data-pos-said]');
  const quotes = new Map();
  let S = null;
  let timer = 0;

  const readForm = () => {
    const f = new FormData(form);
    const n = (k) => { const v = String(f.get(k) || '').trim(); return v === '' ? null : Number(v); };
    return {
      ticker: String(f.get('ticker') || '').toUpperCase().trim(), side: f.get('side'), instrument: f.get('instrument'),
      horizon: f.get('horizon'), qty: n('qty'), entry: n('entry'), stop: n('stop'), target: n('target'),
      mark: n('mark'), width: n('width'), credit: f.get('credit') === 'on',
      structure: String(f.get('structure') || '').trim(), expiry: String(f.get('expiry') || '') || null,
      note: String(f.get('note') || '').trim(),
    };
  };
  const preview = () => {
    if (!S) return;
    const pos = readForm();
    const box = pane.querySelector('[data-pos-preview]');
    if (!pos.entry) { box.innerHTML = '<p class="dim small">Type an entry and a stop and the numbers appear here.</p>'; return; }
    const q = quotes.get(pos.ticker) || null;
    const c = tradeCalc({ pos: { ...pos, qty: pos.qty || 0 }, rules: S.rules, accountCents: S.accountCents, todayKey: S.today, accountType: S.accountType, quote: q });
    const lad = c.ladder;
    box.innerHTML = `
      <p><strong>${c.riskCents == null ? 'Risk is not capped on this one.' : `Risk ${esc(money(c.riskCents))}${c.riskPct == null ? '' : ` (${esc(fmtPct(c.riskPct))})`}, your rule allows ${esc(money(c.budgetCents))}.`}</strong></p>
      ${c.suggestedQty != null ? `<p class="dim small">Your rule sizes this at <strong>${c.suggestedQty}</strong>${pos.instrument === 'stock' ? ' shares' : ' contracts'}.</p>` : ''}
      ${lad ? `<p class="dim small">Breakeven ${lad.breakeven} · ${lad.levels.map((l) => `${l.r}R ${l.price}`).join(' · ')}${c.rr == null ? '' : ` · target ${c.target} is ${c.rr}R`}</p>` : ''}
      ${(c.warnings || []).length ? `<ul class="pos-warn">${c.warnings.map((w) => `<li>${esc(WARNING_TEXT[w] || w)}</li>`).join('')}</ul>` : ''}`;
  };
  form.addEventListener('input', preview);
  form.addEventListener('change', () => {
    const opt = form.instrument.value !== 'stock';
    for (const el of pane.querySelectorAll('[data-opt]')) el.hidden = !opt;
    for (const el of pane.querySelectorAll('[data-spread]')) el.hidden = form.instrument.value !== 'spread';
    preview();
  });
  pane.querySelector('[data-quote-btn]').addEventListener('click', async () => {
    const t = String(form.ticker.value || '').toUpperCase().trim();
    const out = pane.querySelector('[data-quote-said]');
    if (!t) { out.textContent = 'Type a ticker first.'; return; }
    out.textContent = 'Asking…';
    try {
      const r = await tradeCall(getToken, `quote?symbols=${encodeURIComponent(t)}`);
      const q = (r.quotes || [])[0];
      if (!q) { out.textContent = `No quote came back for ${t}.`; return; }
      quotes.set(t, q);
      out.textContent = `${q.ticker} ${q.last}, today ${q.low} to ${q.high}.`;
      if (!form.entry.value) form.entry.value = String(q.last);
      preview();
    } catch (err) { out.textContent = err.message; }
  });

  function paint() {
    pane.querySelector('[data-day-wrap]').innerHTML = dayStripHtml(S.dayStatus);
    const open = (S.positions || []).filter((p) => p.status === 'open');
    const closedToday = (S.positions || []).filter((p) => p.status === 'closed' && p.closedDay === S.today);
    const list = pane.querySelector('[data-pos-list]');
    list.innerHTML = open.length
      ? open.map((p) => positionCardHtml(p, { rules: S.rules, accountCents: S.accountCents, todayKey: S.today, accountType: S.accountType, quote: quotes.get(p.ticker) || null })).join('')
      : '<p class="dim">Nothing open. Add a trade above when you are in one.</p>';
    wirePositionCards(list);
    const cl = pane.querySelector('[data-closed-list]');
    cl.innerHTML = closedToday.length
      ? closedToday.map((p) => `<li data-closed="${esc(p.id)}"><span>${esc(p.ticker)} ${esc(p.side)} <strong>${esc(money(p.pnlCents, true))}</strong>${p.closeNote ? ` <span class="dim small">${esc(p.closeNote)}</span>` : ''}</span></li>`).join('')
      : '<li class="dim">Nothing closed today.</li>';
  }

  function wirePositionCards(root) {
    for (const b of root.querySelectorAll('[data-act]')) {
      b.addEventListener('click', async () => {
        const card = b.closest('[data-pos]');
        const id = card.dataset.pos;
        const say = card.querySelector('[data-pos-said]');
        const sheet = card.querySelector('[data-sold-sheet]');
        if (b.dataset.act === 'sold') { sheet.hidden = false; card.querySelector('[data-exit]')?.focus(); return; }
        if (b.dataset.act === 'cancel') { sheet.hidden = true; return; }
        if (b.dataset.act === 'remove') {
          if (!confirm('Remove this trade? Nothing is logged.')) return;
          b.disabled = true;
          try { await tradeCall(getToken, 'remove', { id }); await load(); } catch (err) { say.textContent = err.message; b.disabled = false; }
          return;
        }
        if (b.dataset.act !== 'close') return;
        const exit = card.querySelector('[data-exit]').value;
        const pl = card.querySelector('[data-pl]').value;
        if (exit === '' && pl === '') { say.textContent = 'Sold at needs the exit price, or the profit or loss in dollars.'; say.classList.add('trade-err'); return; }
        const body = { id, note: card.querySelector('[data-close-note]').value };
        if (exit !== '') body.exitPrice = Number(exit); else body.pnlCents = Math.round(Number(pl) * 100);
        const wantsLog = card.querySelector('[data-log]').checked;
        for (const x of card.querySelectorAll('button')) x.disabled = true;
        say.classList.remove('trade-err');
        say.textContent = 'Saving…';
        try {
          const out = await tradeCall(getToken, 'close', body);
          if (wantsLog && onLog) onLog(logLineFor(out.position, out.pnlCents, exit === '' ? null : Number(exit)));
          onCelebrate?.({ pnlCents: out.pnlCents, celebrate: out.celebrate === true });
          document.dispatchEvent(new CustomEvent('pa-desk-day', { detail: { dayStatus: out.dayStatus, rules: S?.rules } }));
          await load();
        } catch (err) {
          say.textContent = err.message; say.classList.add('trade-err');
          for (const x of card.querySelectorAll('button')) x.disabled = false;
        }
      });
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pos = readForm();
    said.classList.remove('trade-err');
    said.textContent = 'Saving…';
    form.querySelector('button[type="submit"]').disabled = true;
    try {
      await tradeCall(getToken, 'position', pos);
      form.reset();
      pane.querySelector('[data-pos-preview]').innerHTML = '';
      pane.querySelector('[data-pos-new]').open = false;
      said.textContent = 'Saved.';
      await load();
    } catch (err) {
      said.textContent = err.message; said.classList.add('trade-err');
    } finally {
      form.querySelector('button[type="submit"]').disabled = false;
    }
  });

  // The quotes behind the cards: only the tickers he is actually in, only
  // while this page is on screen and the market is open, and never more
  // than the route's ten at a time. Finnhub's minute is small and the
  // reading spends most of it.
  async function refreshQuotes() {
    if (!S || !S.hasKey || !S.marketOpen || pane.hidden || document.visibilityState !== 'visible') return;
    const tickers = [...new Set((S.positions || []).filter((p) => p.status === 'open' && p.instrument === 'stock').map((p) => p.ticker))].slice(0, 10);
    if (!tickers.length) return;
    try {
      const r = await tradeCall(getToken, `quote?symbols=${encodeURIComponent(tickers.join(','))}`);
      for (const q of r.quotes || []) quotes.set(q.ticker, q);
      paint();
    } catch { /* a quote that did not come back changes nothing on the page */ }
  }

  async function load() {
    try {
      S = await tradeCall(getToken, 'positions');
      paint();
      preview();
      document.dispatchEvent(new CustomEvent('pa-desk-day', { detail: { dayStatus: S.dayStatus, rules: S.rules } }));
      await refreshQuotes();
    } catch (err) {
      pane.querySelector('[data-pos-list]').innerHTML = `<p class="error">Could not load: ${esc(err.message)}</p>`;
    }
  }
  clearInterval(timer);
  timer = setInterval(refreshQuotes, 60_000);
  pane._reload = load;
  load();
}

/** The Trade calculations page: his rules in dollars, and the editable variables of every open trade. */
export function mountCalc(pane, { getToken }) {
  pane.innerHTML = `
    <div data-day-wrap></div>
    <form class="panel trade-form" data-rules-form>
      <h3>Your rules</h3>
      <p class="dim small">Every trade on the Trades page is measured against these. Change one and the numbers follow.</p>
      <div class="form-grid" data-rules-grid></div>
      <div class="row"><button type="submit" class="btn">Save the rules</button><span class="trade-said" data-rules-said></span></div>
    </form>
    <h3 class="closed-head">Open trades</h3>
    <div data-calc-list><p class="dim">Loading…</p></div>`;
  const RULE_FIELDS = [
    ['riskPct', 'Risk a trade', 'of the account on one trade'],
    ['dayLossPct', 'Stop the day, loss', 'realized loss and you stop'],
    ['dayFloorPct', 'Floor', 'the least you want in a day'],
    ['dayAimPct', 'Aim', 'the day you are after'],
    ['dayCapPct', 'Stop the day, gain', 'banked and you stop, even on a home run'],
    ['targetR', 'Target', 'R, how far the target sits against the stop'],
  ];
  const form = pane.querySelector('[data-rules-form]');
  const said = pane.querySelector('[data-rules-said]');
  let S = null;

  function paintRules() {
    const grid = pane.querySelector('[data-rules-grid]');
    grid.innerHTML = RULE_FIELDS.map(([k, label, tail]) => {
      const [lo, hi] = RULE_RANGES[k];
      const v = S.rules[k];
      const dollarsOf = k === 'targetR' ? '' : money(Math.round(S.accountCents * v / 100));
      return `<label>${esc(label)}
        <input name="${k}" type="number" step="0.1" min="${lo}" max="${hi}" inputmode="decimal" value="${v}">
        <span class="dim small"><span data-rule-dollars="${k}">${esc(dollarsOf)}</span> ${esc(tail)}</span>
      </label>`;
    }).join('');
    for (const input of grid.querySelectorAll('input')) {
      input.addEventListener('input', () => {
        const k = input.name;
        const out = grid.querySelector(`[data-rule-dollars="${k}"]`);
        if (!out || k === 'targetR') return;
        const v = Number(input.value);
        out.textContent = Number.isFinite(v) ? money(Math.round(S.accountCents * v / 100)) : '';
      });
    }
  }

  function paint() {
    pane.querySelector('[data-day-wrap]').innerHTML = dayStripHtml(S.dayStatus);
    paintRules();
    const open = (S.positions || []).filter((p) => p.status === 'open');
    const list = pane.querySelector('[data-calc-list]');
    list.innerHTML = open.length ? open.map((p) => {
      const c = tradeCalc({ pos: p, rules: S.rules, accountCents: S.accountCents, todayKey: S.today, accountType: S.accountType });
      return `<div class="panel calc-card" data-calc-pos="${esc(p.id)}">
        <div class="play-head"><span><span class="play-ticker">${esc(p.ticker)}</span> <span class="play-side">${esc(p.side)}</span> <span class="pos-badge kind-${esc(p.horizon || 'intraday')}">${esc(HORIZON_WORDS[p.horizon] || 'Intraday')}</span></span><span class="trade-when" data-calc-risk>${esc(c.riskCents == null ? 'not capped' : money(c.riskCents))}</span></div>
        <div class="form-grid">
          <label>Stop <input type="number" step="0.0001" inputmode="decimal" data-edit="stop" value="${p.stop ?? ''}"></label>
          <label>Target <input type="number" step="0.0001" inputmode="decimal" data-edit="target" value="${p.target ?? ''}"></label>
          <label>Quantity <input type="number" step="1" min="1" inputmode="numeric" data-edit="qty" value="${esc(p.qty)}"></label>
          ${p.instrument === 'stock' ? '' : `<label>Mark <input type="number" step="0.0001" inputmode="decimal" data-edit="mark" value="${p.mark ?? ''}"></label>`}
        </div>
        <p class="dim small" data-calc-line>${esc(calcLine(p, c))}</p>
        <div class="row"><button type="button" class="btn tiny" data-act="save">Save</button><span class="trade-said" data-calc-said></span></div>
      </div>`;
    }).join('') : '<p class="dim">Nothing open. What you put on the Trades page shows up here to adjust.</p>';
    for (const b of list.querySelectorAll('[data-act="save"]')) {
      b.addEventListener('click', async () => {
        const card = b.closest('[data-calc-pos]');
        const say = card.querySelector('[data-calc-said]');
        const body = { id: card.dataset.calcPos };
        for (const input of card.querySelectorAll('[data-edit]')) {
          const v = input.value.trim();
          body[input.dataset.edit] = v === '' ? null : Number(v);
        }
        b.disabled = true;
        say.classList.remove('trade-err');
        say.textContent = 'Saving…';
        try {
          const out = await tradeCall(getToken, 'position', body);
          card.querySelector('[data-calc-line]').textContent = calcLine(out.position, out.calc);
          card.querySelector('[data-calc-risk]').textContent = out.calc.riskCents == null ? 'not capped' : money(out.calc.riskCents);
          say.textContent = 'Saved.';
          document.dispatchEvent(new CustomEvent('pa-desk-day', { detail: { dayStatus: out.dayStatus, rules: S?.rules } }));
        } catch (err) {
          say.textContent = err.message; say.classList.add('trade-err');
        } finally { b.disabled = false; }
      });
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const rules = {};
    for (const [k] of RULE_FIELDS) rules[k] = Number(new FormData(form).get(k));
    said.classList.remove('trade-err');
    said.textContent = 'Saving…';
    try {
      const out = await tradeCall(getToken, 'settings', { rules });
      said.textContent = 'Saved.';
      document.dispatchEvent(new CustomEvent('pa-desk-settings', { detail: out }));
      await load();
    } catch (err) {
      said.textContent = err.message; said.classList.add('trade-err');
    }
  });

  async function load() {
    try {
      S = await tradeCall(getToken, 'positions');
      paint();
      document.dispatchEvent(new CustomEvent('pa-desk-day', { detail: { dayStatus: S.dayStatus, rules: S.rules } }));
    } catch (err) {
      pane.querySelector('[data-calc-list]').innerHTML = `<p class="error">Could not load: ${esc(err.message)}</p>`;
    }
  }
  pane._reload = load;
  load();
}

/** One sentence under a trade on the Calc page. Pure. */
export function calcLine(p, c) {
  const risk = c.riskCents == null ? 'Risk is not capped' : `Risk ${money(c.riskCents)}${c.riskPct == null ? '' : ` (${fmtPct(c.riskPct)})`}`;
  const rule = c.budgetCents ? `, your rule allows ${money(c.budgetCents)}` : '';
  const size = c.suggestedQty == null ? '' : `, which sizes at ${c.suggestedQty}`;
  const tgt = c.target == null ? '' : `. Target ${c.target}${c.rr == null ? '' : ` is ${c.rr}R`}`;
  return `${risk}${rule}${size}${tgt}.`;
}
