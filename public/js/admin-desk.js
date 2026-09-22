// The trade desk's own pages inside the case folder (Eric, 2026-09-22:
// "Make it a case file highlighted green"). Three things live here: the play
// cards the panel paints onto the Plays page (where a medical case has its
// Dx page), the Stats page (his balance, the entries, the chart against the
// 3% a day line), and the Desk page (the key, the account type, the start,
// the watchlist, the two switches).
//
// The name is load-bearing: admin-desk.js matches the Worker's asset gate,
// so this file is a 404 to anyone but him. The pages talk to one route,
// /api/admin/trade/state, on show; the cards come from the panel's poll.

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
  const rows = [
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
    <div class="play-head"><span><span class="play-ticker">${esc(p.ticker)}</span> <span class="play-side">${esc(p.side)}</span></span><span class="trade-when">${esc(p.slot ? `read at ${p.slot}` : '')}${p.slot ? ' · ' : ''}${esc(state)}</span></div>
    <div class="play-chance">${esc(chance)}</div>
    <dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${canTake ? `<div class="play-actions"><button type="button" class="btn tiny" data-act="took">Took it</button><button type="button" class="btn quiet tiny" data-act="skipped">Skip</button></div>` : ''}
    ${p.status === 'took' ? `<div class="play-actions"><label class="dim small">Closed at, dollars, plus or minus <input type="number" step="0.01" inputmode="decimal" data-outcome></label><button type="button" class="btn tiny" data-act="closed">Close</button></div>` : ''}
    <p class="trade-said" data-play-said></p>
  </div>`;
}

/** Took it, Skip and Close on every card under `root`. A saved card repaints itself from the server's answer. */
export function wirePlayCards(root, { getToken, onSaved = null } = {}) {
  for (const b of root.querySelectorAll('[data-act]')) {
    b.addEventListener('click', async () => {
      const card = b.closest('[data-play]');
      const said = card.querySelector('[data-play-said]');
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
        wirePlayCards(next, { getToken, onSaved });
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
export function svgChart(chart, { w = 340, h = 200 } = {}) {
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
  return `<svg viewBox="0 0 ${w} ${h}" width="100%" role="img" aria-label="Your balance by trading day against the 3% a day line">
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
    const line = m.days === 0
      ? 'No entries yet. Add today\'s balance above and the chart starts.'
      : `You are ${money(Math.abs(m.offTargetCents))} (${Math.abs(m.offTargetPoints).toFixed(2)} points a day) ${m.offTargetCents < 0 ? 'below' : 'above'} the 3% a day line.`;
    stats.innerHTML = `
      <p><strong>${esc(line)}</strong></p>
      <div class="panel trade-chart">${svgChart(S.chart)}
        <div class="trade-legend"><span><i style="background:var(--cyan)"></i>Your balance</span><span><i style="background:var(--target)"></i>3% a day from ${esc(money(m.startCents))}</span></div>
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
      <div class="toggle-row"><span><strong>Readings</strong><br><span class="dim small">Three on a trading day, 7:00, 10:00 and noon Mountain. Off is Pause; Update still reads on a tap.</span></span><button type="button" class="switch" data-sw="scansOn" aria-pressed="false" aria-label="Readings" disabled></button></div>
      <div class="toggle-row"><span><strong>Pushes</strong><br><span class="dim small">A push to your phone when a reading finds a strong play.</span></span><button type="button" class="switch" data-sw="pushOn" aria-pressed="false" aria-label="Pushes" disabled></button></div>
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
