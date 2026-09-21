// The Trade portal (Eric, 2026-09-21): his desk, on its own page. Five
// tabs. Desk: the feed the scans and his questions land in, and the box he
// asks from. Plays: what he calls the trade differential, one card per open
// play. Account: the balance he types, and what it says about the year.
// Stats: his line against the 3% a day line, in yellow. Settings: the key,
// the account type, the watchlist, the switches, the start.
//
// The name is load-bearing: admin-trade.js matches the Worker's asset gate,
// so this file is a 404 to anyone but him. Everything painted here comes
// from one route, /api/admin/trade/state, polled every half minute and every
// two and a half seconds while something is in flight.

import { requireAdmin, hydrateNav } from './auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (cents, signed = false) => {
  const n = Number(cents) || 0;
  const s = `$${(Math.abs(n) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `-${s}` : signed && n > 0 ? `+${s}` : s;
};
const pct = (x, d = 2) => `${(Number(x) * 100).toFixed(d)}%`;
const MT = 'America/Boise';
const whenShort = (v) => {
  if (!v) return '';
  const t = new Date(v);
  if (Number.isNaN(t.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: MT, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(t);
};
const dayShort = (v) => {
  if (!v) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: MT, month: 'short', day: 'numeric' }).format(new Date(`${v}T12:00:00Z`));
};
const mins = (ms) => `${Math.max(1, Math.round(ms / 60000))} min`;

async function call(sub, body) {
  const token = await user.getIdToken();
  const res = await fetch(`/api/admin/trade/${sub}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
  return out;
}

let S = null;          // the last payload the server gave
let tab = 'desk';
try { tab = localStorage.getItem('pa-trade-tab') || 'desk'; } catch { /* storage blocked */ }
let timer = null;
let root = null;
let settingsPainted = false;

const TABS = [['desk', 'Desk'], ['plays', 'Plays'], ['account', 'Account'], ['stats', 'Stats'], ['settings', 'Settings']];

function mount() {
  root = document.getElementById('trade');
  root.innerHTML = `
    <div class="trade-tabs" role="tablist">
      ${TABS.map(([k, label]) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === tab}">${label}<span class="trade-badge" data-badge hidden></span></button>`).join('')}
    </div>
    <section data-pane="desk" ${tab === 'desk' ? '' : 'hidden'}>
      <p class="dim small" data-next></p>
      <div class="panel" data-ask>
        <textarea data-q placeholder="Ask the desk anything: a ticker, a setup, what to do with a position." maxlength="2000"></textarea>
        <div class="trade-form row" style="margin-top:.5rem;">
          <button type="button" class="btn">Ask</button>
          <button type="button" class="btn quiet" data-scan-now>Scan now</button>
          <span class="trade-said" data-desk-said></span>
        </div>
      </div>
      <div class="trade-feed" data-feed></div>
    </section>
    <section data-pane="plays" ${tab === 'plays' ? '' : 'hidden'}>
      <h2>Trade differential</h2>
      <div data-plays></div>
    </section>
    <section data-pane="account" ${tab === 'account' ? '' : 'hidden'}>
      <div data-acct-top></div>
      <form class="panel trade-form" data-acct-form>
        <label>Date <input type="date" name="date" required></label>
        <label>Balance, in dollars <input type="number" name="dollars" step="0.01" min="0" inputmode="decimal" required></label>
        <label>Note (optional) <input type="text" name="note" maxlength="140"></label>
        <div class="row"><button type="submit" class="btn">Save balance</button><span class="trade-said" data-acct-said></span></div>
      </form>
      <ul class="trade-list" data-acct-list></ul>
    </section>
    <section data-pane="stats" ${tab === 'stats' ? '' : 'hidden'}>
      <div data-stats></div>
    </section>
    <section data-pane="settings" ${tab === 'settings' ? '' : 'hidden'}>
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
        <div class="toggle-row"><span><strong>Scans</strong><br><span class="dim small">Four a day on a trading day, 7:30, 9:30, 11:30 and 1:30 Mountain.</span></span><button type="button" class="switch" data-sw="scansOn" aria-pressed="false" aria-label="Scans" disabled></button></div>
        <div class="toggle-row"><span><strong>Pushes</strong><br><span class="dim small">A push to your phone when a play stands out. Notes never push.</span></span><button type="button" class="switch" data-sw="pushOn" aria-pressed="false" aria-label="Pushes" disabled></button></div>
        <p class="trade-said" data-set-said></p>
      </div>
    </section>
    <p class="trade-foot">Ideas, not orders. Every trade is your decision.</p>`;

  for (const b of root.querySelectorAll('[data-tab]')) b.addEventListener('click', () => switchTab(b.dataset.tab));
  wireDesk();
  wireAccount();
  wireSettings();
  refresh();
}

function switchTab(next) {
  tab = next;
  try { localStorage.setItem('pa-trade-tab', tab); } catch { /* storage blocked */ }
  for (const b of root.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of root.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== tab;
  if (S) paint();
}

async function refresh() {
  clearTimeout(timer);
  try {
    S = await call('state');
    paint();
  } catch (err) {
    const el = root.querySelector('[data-desk-said]');
    if (el) { el.textContent = `Could not load: ${err.message}`; el.classList.add('trade-err'); }
  }
  const busy = !!(S && S.flights && S.flights.length);
  timer = setTimeout(refresh, busy ? 2500 : 30000);
}

function paint() {
  const badge = root.querySelector('[data-tab="desk"] [data-badge]');
  badge.hidden = !(S.unseen > 0);
  badge.textContent = S.unseen > 0 ? String(S.unseen) : '';
  if (tab === 'desk') {
    paintDesk();
    if (S.unseen > 0) call('seen', {}).then(() => { S.unseen = 0; badge.hidden = true; }).catch(() => {});
  }
  if (tab === 'plays') paintPlays();
  if (tab === 'account') paintAccount();
  if (tab === 'stats') paintStats();
  if (tab === 'settings' && !settingsPainted) paintSettings(S);
}

// ---- Desk ------------------------------------------------------------------
function wireDesk() {
  const box = root.querySelector('[data-ask]');
  const q = box.querySelector('[data-q]');
  const said = root.querySelector('[data-desk-said]');
  box.querySelector('.btn').addEventListener('click', async () => {
    const question = q.value.trim();
    if (!question) { said.textContent = 'Ask something first.'; return; }
    said.classList.remove('trade-err');
    said.textContent = 'Sending…';
    try {
      await call('ask', { question });
      q.value = '';
      said.textContent = 'Asked. The answer lands here on its own.';
      refresh();
    } catch (err) {
      said.textContent = err.message; said.classList.add('trade-err');
    }
  });
  root.querySelector('[data-scan-now]').addEventListener('click', async () => {
    said.classList.remove('trade-err');
    said.textContent = 'Scanning…';
    try {
      await call('scan', {});
      said.textContent = 'Scan started. It lands here in a few minutes.';
      refresh();
    } catch (err) {
      said.textContent = err.message; said.classList.add('trade-err');
    }
  });
}

function nextLine() {
  if (S.settings && S.settings.scansOn === false) return 'Scans are off. Turn them on in Settings, or tap Scan now.';
  if (!S.hasKey) return 'No market data key yet. Add your Finnhub key in Settings.';
  const flying = (S.flights || []).find((f) => f.kind === 'scan');
  if (flying) return `A scan is running, sent ${whenShort(flying.submittedAt)}.`;
  if (!S.nextSlot) return 'Market closed today.';
  const today = S.nextSlot.dateKey === S.today;
  return `Next scan ${today ? '' : `${dayShort(S.nextSlot.dateKey)} `}${S.nextSlot.slot.replace(/^0/, '')} MT${S.tradingDay === false ? ', market closed today' : ''}.`;
}

function feedRow(r) {
  const when = `<span class="trade-when">${esc(whenShort(r.at))}</span>`;
  if (r.kind === 'scan') {
    const n = (r.playIds || []).length;
    return `<div class="panel">
      <div>${when} <strong>Scan ${esc(r.slot || 'now')}</strong>${r.landedMs ? ` <span class="trade-when">landed in ${esc(mins(r.landedMs))}</span>` : ''}</div>
      <p style="margin:.4rem 0 0;">${esc(r.text)}</p>
      ${(r.notes || []).length ? `<ul class="trade-notes">${r.notes.map((x) => `<li>${esc(x.text)}</li>`).join('')}</ul>` : ''}
      ${n ? `<p style="margin:.5rem 0 0;"><button type="button" class="btn quiet tiny" data-go="plays">${n} play${n === 1 ? '' : 's'}, see Plays</button></p>` : ''}
    </div>`;
  }
  if (r.kind === 'question') {
    const a = r.status === 'running' ? '<span class="dim">Thinking…</span>'
      : r.status === 'error' ? `<span class="trade-err">${esc(r.answer)}</span>` : esc(r.answer);
    return `<div class="panel"><div>${when}</div><p class="trade-q" style="margin:.3rem 0 0;">${esc(r.text)}</p><div class="trade-a">${a}</div></div>`;
  }
  return `<div class="panel"><div>${when}</div><p style="margin:.3rem 0 0;" class="${r.kind === 'error' ? 'trade-err' : ''}">${esc(r.text)}</p></div>`;
}

function paintDesk() {
  root.querySelector('[data-next]').textContent = nextLine();
  const feed = root.querySelector('[data-feed]');
  const rows = S.feed || [];
  feed.innerHTML = rows.length ? rows.map(feedRow).join('') : '<p class="dim">Nothing yet. The first scan lands at the next slot, or tap Scan now.</p>';
  for (const b of feed.querySelectorAll('[data-go]')) b.addEventListener('click', () => switchTab(b.dataset.go));
}

// ---- Plays -----------------------------------------------------------------
function playCard(p) {
  const past = p.expiresAt && new Date(p.expiresAt).getTime() < Date.now() && p.status === 'open';
  const chance = `${p.profitLow} to ${p.profitHigh}% chance of profit`;
  const rows = [
    ['Structure', p.structure || p.instrument],
    ['Entry', p.entry], ['Stop', p.stop], ['Targets', (p.targets || []).join(', ')],
    ['Hold', p.holdMinutes >= 60 ? `${Math.round(p.holdMinutes / 60 * 10) / 10} h` : `${p.holdMinutes} min`],
    ['Size', money(Number(p.sizeDollars) * 100)],
    ['Why', p.why], ['Catalyst', p.catalyst], ['Risk', p.risk],
    ['Overnight', p.overnight?.ok ? `Yes. ${p.overnight.why || ''}` : `No. ${p.overnight?.why || ''}`],
  ];
  const state = p.status === 'took' ? 'Taken' : p.status === 'closed' ? `Closed ${money(p.outcomeCents, true)}` : p.status === 'skipped' ? 'Skipped' : past ? 'Past its window' : 'Open';
  return `<div class="panel play-card${past ? ' past' : ''}" data-play="${esc(p.id)}">
    <div class="play-head"><span><span class="play-ticker">${esc(p.ticker)}</span> <span class="play-side">${esc(p.side)}</span></span><span class="trade-when">${esc(p.slot || '')} · ${esc(state)}</span></div>
    <div class="play-chance">${esc(chance)}</div>
    <dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    ${p.status === 'open' ? `<div class="play-actions"><button type="button" class="btn tiny" data-act="took">Took it</button><button type="button" class="btn quiet tiny" data-act="skipped">Skip</button></div>` : ''}
    ${p.status === 'took' ? `<div class="play-actions"><label class="dim small">Closed at, dollars, plus or minus <input type="number" step="0.01" inputmode="decimal" data-outcome></label><button type="button" class="btn tiny" data-act="closed">Close</button></div>` : ''}
    <p class="trade-said" data-play-said></p>
  </div>`;
}

function paintPlays() {
  const el = root.querySelector('[data-plays]');
  const plays = S.plays || [];
  const live = plays.filter((p) => p.status === 'open' || p.status === 'took');
  const done = plays.filter((p) => p.status === 'closed' || p.status === 'skipped').slice(0, 10);
  el.innerHTML = (live.length ? live.map(playCard).join('') : '<p class="dim">No open plays. A scan that finds one puts it here.</p>')
    + (done.length ? `<h3 class="dim small" style="margin-top:1.2rem;">Recent</h3>${done.map(playCard).join('')}` : '');
  for (const b of el.querySelectorAll('[data-act]')) {
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
      try { await call('play', body); await refresh(); } catch (err) { said.textContent = err.message; said.classList.add('trade-err'); for (const x of card.querySelectorAll('button')) x.disabled = false; }
    });
  }
}

// ---- Account ---------------------------------------------------------------
function wireAccount() {
  const form = root.querySelector('[data-acct-form]');
  const said = root.querySelector('[data-acct-said]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const date = form.date.value;
    const dollars = Number(form.dollars.value);
    if (!Number.isFinite(dollars)) { said.textContent = 'Enter the balance in dollars.'; said.classList.add('trade-err'); return; }
    said.classList.remove('trade-err');
    said.textContent = 'Saving…';
    form.querySelector('button').disabled = true;
    try {
      await call('balance', { date, cents: Math.round(dollars * 100), note: form.note.value });
      form.dollars.value = ''; form.note.value = '';
      said.textContent = 'Saved.';
      await refresh();
    } catch (err) {
      said.textContent = err.message; said.classList.add('trade-err');
    } finally {
      form.querySelector('button').disabled = false;
    }
  });
}

function paintAccount() {
  const m = S.metrics;
  const top = root.querySelector('[data-acct-top]');
  const form = root.querySelector('[data-acct-form]');
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
  const list = root.querySelector('[data-acct-list]');
  const rows = [...(S.balances || [])].reverse();
  list.innerHTML = rows.length ? rows.map((b) => `<li><span>${esc(dayShort(b.date))} <strong>${esc(money(b.cents))}</strong>${b.note ? ` <span class="dim small">${esc(b.note)}</span>` : ''}</span><button type="button" class="btn quiet tiny" data-del="${esc(b.date)}">Delete</button></li>`).join('')
    : '<li class="dim">No entries yet. Type today\'s balance above.</li>';
  for (const b of list.querySelectorAll('[data-del]')) {
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await call('balance', { date: b.dataset.del, remove: true }); await refresh(); } catch (err) { b.disabled = false; root.querySelector('[data-acct-said]').textContent = err.message; }
    });
  }
}

// ---- Stats -----------------------------------------------------------------
/** The chart, as one SVG string. Pure: a chart series in, markup out, colours by token. */
function svgChart(chart, { w = 340, h = 200 } = {}) {
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

function paintStats() {
  const m = S.metrics;
  const el = root.querySelector('[data-stats]');
  const line = m.days === 0
    ? 'No entries yet. Add today\'s balance on the Account tab and the chart starts.'
    : `You are ${money(Math.abs(m.offTargetCents))} (${Math.abs(m.offTargetPoints).toFixed(2)} points a day) ${m.offTargetCents < 0 ? 'below' : 'above'} the 3% a day line.`;
  el.innerHTML = `
    <p><strong>${esc(line)}</strong></p>
    <div class="panel trade-chart">${svgChart(S.chart)}
      <div class="trade-legend"><span><i style="background:var(--cyan)"></i>Your balance</span><span><i style="background:var(--target)"></i>3% a day from ${esc(money(m.startCents))}</span></div>
    </div>
    <p class="dim small">Where the line should be today: ${esc(money(m.targetCents))} after ${m.days} trading day${m.days === 1 ? '' : 's'}. Your average: ${esc(pct(m.avgDaily))} a day.</p>`;
}

// ---- Settings --------------------------------------------------------------
// Render disabled, ask the server, paint what it said, and only then let him
// touch a control. A failed save puts the control back where the server
// left it and says why. The same discipline as the settings overlay.
let confirmed = null;
function paintSettings(payload) {
  confirmed = { settings: { ...payload.settings }, hasKey: payload.hasKey, keyTail: payload.keyTail };
  const s = payload.settings;
  const box = root.querySelector('[data-settings]');
  const keySaid = box.querySelector('[data-key-said]');
  const keyRow = box.querySelector('[data-key-row]');
  const keyIn = box.querySelector('[data-key]');
  const keyReplace = box.querySelector('[data-key-replace]');
  keySaid.textContent = payload.hasKey ? `Key on file, ends in ${payload.keyTail}.` : 'No key yet. Sign up at finnhub.io (free), then paste the key here.';
  keyRow.hidden = false;
  keyIn.hidden = payload.hasKey; keyIn.disabled = false; keyIn.value = '';
  box.querySelector('[data-key-save]').hidden = payload.hasKey; box.querySelector('[data-key-save]').disabled = false;
  keyReplace.hidden = !payload.hasKey;
  for (const b of box.querySelectorAll('[data-acct]')) { b.classList.toggle('on', b.dataset.acct === s.accountType); b.disabled = false; }
  box.querySelector('[data-start-dollars]').value = String(Math.round(s.startCents / 100));
  box.querySelector('[data-start-dollars]').disabled = false;
  box.querySelector('[data-started]').value = s.startedAt || payload.today || '';
  box.querySelector('[data-started]').disabled = false;
  box.querySelector('[data-start-save]').disabled = false;
  box.querySelector('[data-watch]').value = (s.watchlist || []).join(', ');
  box.querySelector('[data-watch]').disabled = false;
  box.querySelector('[data-watch-save]').disabled = false;
  for (const sw of box.querySelectorAll('[data-sw]')) {
    const on = s[sw.dataset.sw] !== false;
    sw.classList.toggle('on', on); sw.setAttribute('aria-pressed', String(on)); sw.disabled = false;
  }
  settingsPainted = true;
}

function wireSettings() {
  const box = root.querySelector('[data-settings]');
  const said = box.querySelector('[data-set-said]');
  const save = async (body, controls) => {
    for (const c of controls) c.disabled = true;
    said.classList.remove('trade-err');
    said.textContent = 'Saving…';
    try {
      const out = await call('settings', body);
      paintSettings({ ...out, today: S?.today });
      if (S) { S.settings = out.settings; S.hasKey = out.hasKey; S.keyTail = out.keyTail; }
      said.textContent = 'Saved.';
      refresh();
    } catch (err) {
      if (confirmed) paintSettings({ ...confirmed, today: S?.today });
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
}

// The gate and the mount sit at the foot on purpose: mount() reads the
// module's own state (root, tab, S), which a `let` above it only holds once
// this line is reached. At the top, the way the smaller admin pages do it,
// the first paint threw before it drew a tab.
hydrateNav();
const user = await requireAdmin();
if (user) mount();
