// PR 420 (Eric, 2026-09-23): "Simplify the trading app substantially. The
// app should now have only two primary purposes: 1. Suggested Trades
// 2. Market News. Remove everything else that does not directly support
// those two functions."
//
// This is the app: the boot, one store, the router behind the three tabs, the
// polls, and every action he has. It draws nothing itself: the markup comes
// from admin-desk.js, which is pure and therefore checkable in node, the
// sizing from trade-math.js, which is the same code the Worker computes with,
// and the one loud moment (PROFIT or LOSS) from admin-deskfx.js.
//
// What he can do here is exactly what he asked for and nothing else:
//   RUN TRADING DESK   one tap, no confirmation, a fresh run by the desk
//   YES, I TOOK IT     the card goes electric yellow and grows two buttons
//   NO                 the card goes, and that position stays off the board
//                      until more of the desk agrees than when he passed
//   PROFIT / LOSS      the trade leaves for History with its setup and times
//   ADD/TRIM           more or less of a taken trade, with a new suggested stop
//   Amount or Risk     his own size on any card, open or taken; stop and targets follow
//   Settings           his balance, the risk per trade, and a few switches
// There is no chat and no question box: the desk never asks him anything.
//
// Every control paints from the server's answer, never from its own tap, so
// what is on screen is what is stored.
//
// The name is load-bearing: admin-deskapp.js matches the Worker's asset gate
// at worker/index.js, so this file is a 404 to anyone but him.

import { requireAdmin } from './auth.js';
import { VERSION } from './changelog.js';
import {
  esc, money, price, clock, dayShort, agoShort, tradeCall, runLine, runProgress,
  recCardHtml, boardHtml, historyRowHtml, deskNewsHtml, newsRowHtml, earningsChipHtml,
} from './admin-desk.js';
import { createFx, seedFlicker } from './admin-deskfx.js';
import { recSizing, planFor, positionKey, heldOf, scalePosition, GLP1_CHAIN, AGENTS, HIGH_RISK_PCT } from './trade-math.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PAGES = ['trades', 'news', 'history'];
const PAGE_KEY = 'pa-420-page';
const WORDS = { trades: 'Trades', news: 'News', history: 'History' };
const BUSY = new Set(['queued', 'researching', 'decide', 'deciding']);

// ---- the store ------------------------------------------------------------------
const S = {
  user: null, page: 'trades',
  state: null,             // GET trade/state: the board, the run, the balance, the settings
  news: null, newsAt: 0,   // GET trade/news, memoised five minutes
  history: null, histAt: 0,
  quotes: {},              // the live price for each ticker on a card
  // Bumped by every tap that changes the desk. A poll that set out before the
  // tap is thrown away when it lands, so it can never paint over his answer.
  rev: 0,
};
const getToken = () => S.user.getIdToken();
const call = (sub, body) => tradeCall(getToken, sub, body);
let fx = null;

/** One sentence under a control, which is where every failure lands. */
function say(sel, text) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (el) el.textContent = text || '';
}
let toastTimer = 0;
function toast(text) {
  const host = $('#toasts');
  host.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>`;
  host.appendChild(el);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (el.isConnected) el.remove(); }, 5000);
}

// ---- the router -----------------------------------------------------------------
function placeInd() {
  const b = $('#bar button.on');
  if (b) $('#ind').style.transform = `translateX(${b.offsetLeft + b.offsetWidth / 2 - 14}px)`;
}
function show(name, { push = true } = {}) {
  const page = PAGES.includes(name) ? name : 'trades';
  const prev = S.page;
  S.page = page;
  for (const p of PAGES) {
    const el = $(`#pg-${p}`);
    el.hidden = p !== page;
    el.classList.toggle('in', p === page);
  }
  for (const b of $$('#bar [data-page]')) {
    const own = b.dataset.page === page;
    b.classList.toggle('on', own);
    b.classList.toggle('fl', own);
    b.classList.remove('pop', 'strike');
    if (own && prev !== page) { void b.offsetWidth; b.classList.add('pop', 'strike'); }
  }
  placeInd();
  $('.crumb').innerHTML = `PR 420 <b>${esc(WORDS[page])}</b>`;
  try { localStorage.setItem(PAGE_KEY, page); } catch { /* blocked storage is not an error */ }
  if (push && location.hash.slice(1) !== page) history.replaceState(null, '', `#${page}`);
  if (page === 'news') loadNews();
  if (page === 'history') loadHistory();
  if (page === 'trades') loadQuotes();
  window.scrollTo(0, 0);
  seedFlicker(document);
}
for (const b of $$('#bar [data-page]')) b.addEventListener('click', () => show(b.dataset.page));

// ---- what the Trades page reads out of the store -----------------------------------
const settingsNow = () => S.state?.settings || {};
const balanceNow = () => S.state?.balance || { cents: 0, typed: false };
const cardCtx = () => ({
  accountCents: balanceNow().cents,
  rules: { riskPct: settingsNow().riskPct ?? 3 },
  balanceTyped: !!balanceNow().typed && balanceNow().cents > 0,
  quotes: S.quotes,
  // His taken trades by position, so an add can say how many agreed when he took it (2026-09-24).
  holding: new Map((S.state?.active || []).map((r) => [positionKey(r), r])),
});
const runBusy = () => BUSY.has(S.state?.run?.status);

// ---- TRADES -----------------------------------------------------------------------
function paintMarket() {
  const m = S.state?.market || {};
  const el = $('#mkt');
  el.classList.toggle('open', !!m.open);
  const now = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(new Date());
  $('#mkt-word').textContent = !m.tradingDay ? `${now} · Closed`
    : m.open ? `${now} · Open`
      : m.beforeOpen ? `${now} · Opens 07:30` : `${now} · Closed`;
  const b = balanceNow();
  const pct = settingsNow().riskPct ?? 3;
  $('#trades-sub').textContent = b.typed && b.cents > 0
    ? `Balance ${money(b.cents)} · risk ${pct}% a trade`
    : 'Set your balance in Settings so each trade can be sized.';
}
// THE BAR (Eric, 2026-09-24: "Is a loading bar for the desk scan possible?"). It fills from runProgress,
// which only moves on real stages and researchers back; it is repainted each second while a run is
// going, never goes backwards within one run, reads 100 for a moment when the trades land, then goes.
const BAR = { runId: null, max: 0, doneUntil: 0 };
function paintBar() {
  const bar = $('#runbar');
  const fill = $('#runbar-fill');
  const run = S.state?.run;
  let pct = runProgress(run);
  if (pct != null) {
    const id = run.queuedAt || run.startedAt || 'run';
    if (BAR.runId !== id) { BAR.runId = id; BAR.max = 0; }
    pct = Math.max(pct, BAR.max);
    BAR.max = pct;
  } else if (Date.now() < BAR.doneUntil) pct = 100;
  bar.hidden = pct == null;
  if (pct == null) return;
  fill.style.width = `${pct}%`;
  bar.setAttribute('aria-valuenow', String(Math.round(pct)));
  bar.classList.toggle('full', pct >= 100);
}
function paintRun() {
  paintBar();
  const st = S.state || {};
  const run = st.run || { status: 'idle' };
  const line = runLine(run, st.desk);
  const box = $('#runbox');
  box.setAttribute('aria-busy', line.busy ? 'true' : 'false');
  $('#run').disabled = line.busy;
  const dots = run.status === 'researching'
    ? `<span class="agents" aria-hidden="true">${Array.from({ length: Number(run.of) || 5 }, (_, i) => `<i${i < (Number(run.done) || 0) ? ' class="on"' : ''}></i>`).join('')}</span>` : '';
  $('#run-line').innerHTML = dots + line.html;
  say('#run-said', run.status === 'error' ? (run.error || 'The last run did not come back. Tap RUN TRADING DESK.') : '');
  // The desk's own one line on the tape, from the run that filed these trades.
  const d = st.desk;
  const read = d?.read || '';
  $('#deskread').hidden = !read || line.busy;
  $('#deskread-t').textContent = read;
}
function paintBoard() {
  const st = S.state || {};
  const ctx = cardCtx();
  // What the last run says to act on leads the list: sell, trim, add (v7.13). A hold and a trade not yet
  // checked stay in the order he took them, so the one he just took still lands on top.
  const URGENT = { sell: 0, trim: 1, add: 2, hold: 3 };
  const active = [...(st.active || [])].sort((a, b) => (URGENT[a.verdict?.call] ?? 3) - (URGENT[b.verdict?.call] ?? 3));
  const recs = st.recs || [];
  $('#active-wrap').hidden = !active.length;
  $('#active-n').textContent = active.length > 1 ? String(active.length) : '';
  $('#active').innerHTML = active.map((r) => recCardHtml(r, ctx)).join('');
  $('#board').innerHTML = boardHtml(recs, ctx);
  $('#board').hidden = !recs.length;
  const empty = !recs.length;
  $('#board-empty').hidden = !empty;
  if (empty) {
    const d = st.desk;
    $('#board-empty-t').textContent = runBusy() ? 'The desk is running. Fresh trades land here.'
      : !d?.at ? 'No run yet. Tap RUN TRADING DESK.'
        : st.timedOut ? 'The last run\'s trades have run out of time. Tap RUN TRADING DESK for fresh ones.'
          : (d.none || 'Nothing worth taking right now.');
  }
  const badge = $('#bar-badge');
  badge.hidden = !active.length;
  badge.textContent = String(active.length);
  badge.classList.add('volt');
  for (const b of $$('#pg-trades [data-act]')) b.addEventListener('click', () => act(b));
  for (const b of $$('#pg-trades [data-edit]')) b.addEventListener('click', () => openSize(b));
}
function paintTrades() { paintMarket(); paintRun(); paintBoard(); }

/** RUN TRADING DESK: one tap, no confirmation, and the line under it says where the run is from then on. */
async function startRun() {
  const btn = $('#run');
  btn.disabled = true;
  say('#run-said', '');
  S.rev += 1;
  try {
    const out = await call('run', {});
    S.state = { ...S.state, run: out.run };
    paintRun(); paintBoard();
    if (out.already) toast('The desk is already running. It lands on its own.');
    kickPoll(3000);
  } catch (err) {
    paintRun();
    say('#run-said', err.message);
  }
}
$('#run').addEventListener('click', startRun);

function recOf(id) {
  return (S.state?.active || []).find((r) => r.id === id) || (S.state?.recs || []).find((r) => r.id === id) || null;
}
async function act(btn) {
  const card = btn.closest('[data-rec]');
  const id = card?.dataset.rec;
  if (!id || btn.disabled) return;
  const kind = btn.dataset.act;
  if (kind === 'scale') { openScale(btn); return; }
  const saidEl = card.querySelector('[data-rec-said]');
  for (const b of card.querySelectorAll('[data-act]')) b.disabled = true;
  say(saidEl, '');
  S.rev += 1;
  try {
    if (kind === 'take') {
      const out = await call('take', { id });
      const rec = out.rec;
      S.state = {
        ...S.state,
        recs: (S.state.recs || []).filter((r) => r.id !== id),
        active: [rec, ...(S.state.active || []).filter((r) => r.id !== id)],
      };
      paintBoard();
      const lit = $(`#active [data-rec="${CSS.escape(id)}"]`);
      lit?.classList.add('strike');
      lit?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      return;
    }
    if (kind === 'decline') {
      const out = await call('decline', { id });
      card.classList.add('leaving');
      setTimeout(() => {
        S.state = { ...S.state, recs: (S.state.recs || []).filter((r) => r.id !== id) };
        paintBoard();
        toast(`Passed on ${out.rec?.ticker || 'it'}. It comes back only if more than ${out.agreement} of 5 agree.`);
      }, 300);
      return;
    }
    if (kind === 'profit' || kind === 'loss') {
      const r = btn.getBoundingClientRect();
      const out = await call('result', { id, result: kind });
      const hold = fx.result(kind, { from: { x: r.left + r.width / 2, y: r.top + r.height / 2 } });
      S.history = null; S.histAt = 0;
      setTimeout(() => {
        card.classList.add('leaving');
        setTimeout(() => {
          S.state = { ...S.state, active: (S.state.active || []).filter((x) => x.id !== id) };
          paintBoard();
          toast(`${out.rec?.ticker || 'The trade'} is in History, marked ${kind === 'profit' ? 'PROFIT' : 'LOSS'}.`);
        }, 300);
      }, Math.min(900, hold));
    }
  } catch (err) {
    for (const b of card.querySelectorAll('[data-act]')) b.disabled = false;
    say(saidEl, err.message);
    // A trade that timed out or was already marked elsewhere: the server knows best.
    if (/not on the desk|no longer open|before marking|can be passed on/.test(err.message)) loadState().then(paintTrades).catch(() => {});
  }
}

// ---- his size ---------------------------------------------------------------------------
// Eric, 2026-09-23: "I should be able to manually tap on the amount traded and update it, the
// amount I'm willing to risk, then it adjusts the stop loss and take profit", and "Including after
// the trade was accepted". The sheet opens on the card's own numbers; as he types, the stop and
// targets they give are shown from planFor, the function the Worker saves with. Save sends the two
// numbers, and the card repaints from what the server kept.
const dollarsIn = (v) => { const raw = String(v ?? '').replace(/[$,\s]/g, ''); const n = Number(raw); return raw && Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null; };
const plainDollars = (cents) => (cents > 0 ? (cents / 100).toFixed(2).replace(/\.00$/, '') : '');
function openSize(btn) {
  const card = btn.closest('[data-rec]');
  const r = recOf(card?.dataset.rec);
  if (!r) return;
  const ctx = cardCtx();
  const acct = ctx.balanceTyped ? ctx.accountCents : 0;
  const base = r.mine ? { costCents: r.mine.amountCents, riskCents: r.mine.riskCents } : recSizing({ rec: r, accountCents: ctx.accountCents, rules: ctx.rules });
  const amt0 = r.mine ? r.mine.amountCents : (ctx.balanceTyped ? base.costCents : null);
  const risk0 = r.mine ? r.mine.riskCents : (ctx.balanceTyped ? base.riskCents : null);
  const live = Number(S.quotes?.[r.ticker]?.last);
  // After an add or a trim the size is measured at his average, and the desk's plan no longer fits it.
  const scaled = Array.isArray(r.mine?.legs) && r.mine.legs.length > 0;
  const at = scaled ? r.mine.entry : null;
  const { sheet, close } = openSheet(`<h3>${esc(r.ticker)} · your size</h3>
    <div class="sum">What goes in, and what you would lose at the stop. The stop and targets move to match, and the targets keep the desk's reward for the risk.</div>
    <label>Amount in the trade<span class="box"><span style="padding-left:10px">$</span><input class="num" inputmode="decimal" id="sz-amt" value="${esc(plainDollars(amt0))}" placeholder="500"></span></label>
    <label>Risk, lost at the stop<span class="box"><span style="padding-left:10px">$</span><input class="num" inputmode="decimal" id="sz-risk" value="${esc(plainDollars(risk0))}" placeholder="60"></span></label>
    <div class="panel sizeprev" id="sz-prev" aria-live="polite"></div>
    <button type="button" class="btn tall wide primary" id="sz-go">Save my size</button>
    <p class="said" id="sz-said" style="margin:8px 0 0"></p>
    ${r.mine && !scaled ? '<button type="button" class="btn quiet wide" id="sz-reset" style="margin-top:8px">Back to the desk\'s plan</button>' : ''}
    <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
  const amtIn = sheet.querySelector('#sz-amt');
  const riskIn = sheet.querySelector('#sz-risk');
  const go = sheet.querySelector('#sz-go');
  const prev = sheet.querySelector('#sz-prev');
  const preview = () => {
    const a = dollarsIn(amtIn.value); const k = dollarsIn(riskIn.value);
    const p = a && k ? planFor({ rec: r, amountCents: a, riskCents: k, accountCents: acct, rules: ctx.rules, entry: at }) : { ok: false, why: 'Type the amount and the risk in dollars.' };
    go.disabled = !p.ok;
    if (!p.ok) { prev.innerHTML = `<p class="why">${esc(p.why)}</p>`; return p; }
    const qty = p.contracts != null ? `${p.contracts} contract${p.contracts === 1 ? '' : 's'}` : `${p.shares} share${p.shares === 1 ? '' : 's'}`;
    const up = r.instrument !== 'stock' || r.side !== 'short';
    const hit = Number.isFinite(live) && live > 0 && (up ? live <= p.stop : live >= p.stop);
    prev.innerHTML = `<div class="row"><span class="k">Stop</span><span class="v red num">${esc(price(p.stop))}</span></div>
      <div class="row"><span class="k">Targets</span><span class="v green num">${esc(p.targets.map(price).join(' then '))}</span></div>
      <div class="row"><span class="k">${scaled ? 'Holds' : 'Buys'}</span><span class="v num">${esc(qty)} at ${esc(price(p.entry))}, ${esc(money(p.costCents))}</span></div>
      <div class="row"><span class="k">Risk</span><span class="v num">${esc(money(p.riskCents))}${p.rewardCents != null ? ` for ${esc(money(p.rewardCents))}, 1 : ${esc(p.rr)}` : ''}</span></div>
      ${p.overRule ? `<p class="warn">Over your ${esc(money(p.budgetCents))} rule for one trade.</p>` : ''}
      ${hit ? `<p class="warn">At ${esc(price(live))} now, that stop is already hit.</p>` : ''}`;
    return p;
  };
  amtIn.addEventListener('input', preview);
  riskIn.addEventListener('input', preview);
  preview();
  const send = async (body, done) => {
    go.disabled = true;
    say(sheet.querySelector('#sz-said'), 'Saving…');
    S.rev += 1;
    try {
      const out = await call('adjust', { id: r.id, ...body });
      const rec = out.rec;
      S.state = {
        ...S.state,
        recs: (S.state.recs || []).map((x) => (x.id === rec.id ? rec : x)),
        active: (S.state.active || []).map((x) => (x.id === rec.id ? rec : x)),
      };
      paintBoard();
      close();
      toast(done(rec));
    } catch (err) {
      say(sheet.querySelector('#sz-said'), err.message);
      go.disabled = false;
    }
  };
  go.addEventListener('click', () => {
    const p = preview();
    if (!p.ok) return;
    send({ amountCents: dollarsIn(amtIn.value), riskCents: dollarsIn(riskIn.value) }, (rec) => `Saved. ${rec.ticker} stop ${price(rec.mine?.stop)}.`);
  });
  sheet.querySelector('#sz-reset')?.addEventListener('click', () => send({ reset: true }, (rec) => `${rec.ticker} is back on the desk's plan.`));
  (btn.dataset.edit === 'risk' ? riskIn : amtIn).focus();
}

// ---- add or trim ------------------------------------------------------------------------
// Eric, 2026-09-24: "Button between profit and loss that says add/trim and this opens the card to
// add/subtract a new contract or stock amount (in dollars) manually. It gives me a new suggested stop
// loss." Stock in dollars, an option in whole contracts, at a price he can change. The preview is
// scalePosition, the function the Worker saves with: the new stop keeps his dollars at risk the same
// unless he types another, and one line says what keeping the old stop would risk instead.
function openScale(btn) {
  const card = btn.closest('[data-rec]');
  const r = recOf(card?.dataset.rec);
  if (!r) return;
  const ctx = cardCtx();
  const acct = ctx.balanceTyped ? ctx.accountCents : 0;
  const opt = r.instrument !== 'stock';
  const held = heldOf({ rec: r, accountCents: acct, rules: ctx.rules });
  const live = Number(S.quotes?.[r.ticker]?.last);
  const px0 = !opt && Number.isFinite(live) && live > 0 ? live : held.entry;
  const unit = (q) => (opt ? `${q} contract${q === 1 ? '' : 's'}` : `${Math.round(q * 10000) / 10000} share${q === 1 ? '' : 's'}`);
  const hold = held.qty > 0 ? `You hold ${unit(held.qty)} at ${price(held.entry)}${held.stop != null ? `, stop ${price(held.stop)}` : ''}.` : '';
  let mode = 'add';
  const { sheet, close } = openSheet(`<h3>${esc(r.ticker)} · add or trim</h3>
    <div class="sum">${esc(hold)} The new stop keeps what you would lose at it the same, unless you change the risk.</div>
    <div class="seg views" id="sc-seg"><button type="button" data-k="add" class="on" aria-pressed="true">Add</button><button type="button" data-k="trim" aria-pressed="false">Trim</button></div>
    ${opt
      ? '<label>Contracts<span class="box"><input class="num" inputmode="numeric" id="sc-n" placeholder="1"></span></label>'
      : '<label>Amount in dollars<span class="box"><span style="padding-left:10px">$</span><input class="num" inputmode="decimal" id="sc-n" placeholder="250"></span></label>'}
    <label>${opt ? 'Premium per share' : 'Price per share'}<span class="box"><span style="padding-left:10px">$</span><input class="num" inputmode="decimal" id="sc-px" value="${esc(px0 > 0 ? String(Math.round(px0 * 100) / 100) : '')}"></span></label>
    <label>Risk, lost at the stop<span class="box"><span style="padding-left:10px">$</span><input class="num" inputmode="decimal" id="sc-risk" value="${esc(plainDollars(held.riskCents))}" placeholder="60"></span></label>
    <div class="panel sizeprev" id="sc-prev" aria-live="polite"></div>
    <button type="button" class="btn tall wide primary" id="sc-go">Save</button>
    <p class="said" id="sc-said" style="margin:8px 0 0"></p>
    <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
  const nIn = sheet.querySelector('#sc-n');
  const pxIn = sheet.querySelector('#sc-px');
  const riskIn = sheet.querySelector('#sc-risk');
  const go = sheet.querySelector('#sc-go');
  const prev = sheet.querySelector('#sc-prev');
  const numIn = (v) => { const raw = String(v ?? '').replace(/[$,\s]/g, ''); const x = Number(raw); return raw && Number.isFinite(x) && x > 0 ? x : null; };
  const body = () => ({
    id: r.id, kind: mode, price: numIn(pxIn.value), riskCents: dollarsIn(riskIn.value),
    ...(opt ? { contracts: numIn(nIn.value) } : { amountCents: dollarsIn(nIn.value) }),
  });
  const preview = () => {
    const b = body();
    const p = (opt ? b.contracts : b.amountCents) ? scalePosition({ rec: r, ...b, accountCents: acct, rules: ctx.rules })
      : { ok: false, why: opt ? 'How many contracts, for example 1.' : 'The amount in dollars, for example 250.' };
    go.disabled = !p.ok;
    go.textContent = mode === 'add' ? 'Save the add' : 'Save the trim';
    if (!p.ok) { prev.innerHTML = `<p class="why">${esc(p.why)}</p>`; return p; }
    const up = opt || r.side !== 'short';
    const hit = Number.isFinite(live) && live > 0 && (up ? live <= p.stop : live >= p.stop);
    const keep = p.keepStopRiskCents != null && p.keepStop != null && Math.abs(p.keepStop - p.stop) > 1e-9;
    prev.innerHTML = `<div class="row"><span class="k">Holds</span><span class="v num">${esc(unit(p.qty))} at ${esc(price(p.entry))}</span></div>
      <div class="row"><span class="k">Stop</span><span class="v red num">${esc(price(p.stop))}${p.keepStop != null ? ` <span class="was">was ${esc(price(p.keepStop))}</span>` : ''}</span></div>
      <div class="row"><span class="k">Targets</span><span class="v green num">${esc(p.targets.map(price).join(' then '))}</span></div>
      <div class="row"><span class="k">Risk</span><span class="v num">${esc(money(p.riskCents))}${p.rewardCents != null ? ` for ${esc(money(p.rewardCents))}, 1 : ${esc(p.rr)}` : ''}</span></div>
      ${keep ? `<p class="why">Keeping the stop at ${esc(price(p.keepStop))} would risk ${esc(money(p.keepStopRiskCents))} instead.</p>` : ''}
      ${p.overRule ? `<p class="warn">Over your ${esc(money(p.budgetCents))} rule for one trade.</p>` : ''}
      ${hit ? `<p class="warn">At ${esc(price(live))} now, that stop is already hit.</p>` : ''}`;
    return p;
  };
  for (const b of sheet.querySelectorAll('#sc-seg button')) {
    b.addEventListener('click', () => {
      mode = b.dataset.k;
      for (const x of sheet.querySelectorAll('#sc-seg button')) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); }
      preview();
    });
  }
  for (const x of [nIn, pxIn, riskIn]) x.addEventListener('input', preview);
  preview();
  go.addEventListener('click', async () => {
    const p = preview();
    if (!p.ok) return;
    go.disabled = true;
    say(sheet.querySelector('#sc-said'), 'Saving…');
    S.rev += 1;
    try {
      const out = await call('scale', body());
      const rec = out.rec;
      S.state = { ...S.state, active: (S.state.active || []).map((x) => (x.id === rec.id ? rec : x)) };
      paintBoard();
      close();
      toast(`${mode === 'add' ? 'Added' : 'Trimmed'}. ${rec.ticker} stop ${price(rec.mine?.stop)}.`);
    } catch (err) {
      say(sheet.querySelector('#sc-said'), err.message);
      go.disabled = false;
    }
  });
  nIn.focus();
}

// ---- live prices on the cards ---------------------------------------------------------
let quotesAt = 0;
async function loadQuotes({ force = false } = {}) {
  const st = S.state;
  if (!st?.settings?.hasKey || !st.market?.open) return;
  if (!force && Date.now() - quotesAt < 55_000) return;
  const tickers = [...new Set([...(st.active || []), ...(st.recs || [])].map((r) => r.ticker).filter(Boolean))].slice(0, 10);
  if (!tickers.length) return;
  quotesAt = Date.now();
  try {
    const out = await call(`quote?symbols=${encodeURIComponent(tickers.join(','))}`);
    for (const q of out.quotes || []) S.quotes[q.ticker] = q;
    if (S.page === 'trades') paintBoard();
  } catch { /* a missed quote leaves the price the desk saw */ }
}

// ---- NEWS -----------------------------------------------------------------------------
const NEWS_MEMO_MS = 5 * 60_000;
async function loadNews({ force = false } = {}) {
  if (!force && S.news && Date.now() - S.newsAt < NEWS_MEMO_MS) { paintNews(); return; }
  say('#news-said', S.news ? '' : 'Reading the news…');
  try {
    S.news = await call('news');
    S.newsAt = Date.now();
    paintNews();
  } catch (err) { say('#news-said', err.message); }
}
function paintNews() {
  const n = S.news;
  if (!n) return;
  const desk = n.desk || [];
  $('#news-desk-wrap').hidden = !desk.length;
  $('#news-desk').innerHTML = desk.map(deskNewsHtml).join('');
  const earn = n.earnings || [];
  $('#news-earn-wrap').hidden = !earn.length;
  $('#news-earn').innerHTML = earn.map(earningsChipHtml).join('');
  const rows = n.headlines || [];
  $('#news-list').innerHTML = rows.length ? rows.map((h) => newsRowHtml(h)).join('')
    : `<li><span></span><div class="t dim">${n.hasKey ? 'Nothing market moving in the last day.' : 'Live headlines need a market data key.'}</div><span></span></li>`;
  for (const li of $$('#news-list li.has')) li.addEventListener('click', (e) => { if (!e.target.closest('a')) li.classList.toggle('open'); });
  $('#news-sub').textContent = `${n.deskAt ? `Desk ${agoShort(n.deskAt)} · ` : ''}as of ${clock(n.asOf)}`;
  say('#news-said', !n.hasKey ? 'No market data key on file. Add it in Settings. The desk\'s own picks still show.'
    : n.throttled ? 'Showing the last fetch. The market data limit was close.' : '');
}
$('#news-refresh').addEventListener('click', () => loadNews({ force: true }));

// ---- HISTORY ---------------------------------------------------------------------------
async function loadHistory({ force = false } = {}) {
  if (!force && S.history && Date.now() - S.histAt < 60_000) { paintHistory(); return; }
  say('#hist-said', S.history ? '' : 'Reading your history…');
  try {
    S.history = await call('history');
    S.histAt = Date.now();
    paintHistory();
  } catch (err) { say('#hist-said', err.message); }
}
function paintHistory() {
  const rows = S.history?.rows || [];
  $('#hist').innerHTML = rows.length ? rows.map(historyRowHtml).join('')
    : '<li class="hist"><div class="empty" style="padding:22px 0">Nothing closed yet. A trade you mark PROFIT or LOSS lands here.</div></li>';
  $('#hist-sub').textContent = rows.length ? `${rows.length} closed, newest first` : 'Your closed trades';
  say('#hist-said', '');
}

// ---- SETTINGS --------------------------------------------------------------------------
let sheetTrack = null;
let sheetClose = null;
function openSheet(html) {
  sheetClose?.();
  const host = document.createElement('div');
  $('#overlay').appendChild(host);
  host.innerHTML = `<div class="scrim" style="z-index:95"></div><div class="sheet" style="z-index:96"><div class="handle"></div>${html}</div>`;
  const sheet = host.querySelector('.sheet');
  // The keyboard on a phone shrinks the visual viewport, not the layout one,
  // so a fixed sheet has to be told where the top of the keyboard is.
  const track = () => { const vv = window.visualViewport; if (vv) sheet.style.bottom = `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`; };
  if (window.visualViewport) { sheetTrack = track; visualViewport.addEventListener('resize', track); visualViewport.addEventListener('scroll', track); }
  const close = () => {
    if (sheetTrack) { visualViewport.removeEventListener('resize', sheetTrack); visualViewport.removeEventListener('scroll', sheetTrack); sheetTrack = null; }
    host.remove();
    if (sheetClose === close) sheetClose = null;
  };
  sheetClose = close;
  for (const x of host.querySelectorAll('[data-x], .scrim')) x.addEventListener('click', close);
  return { sheet, close };
}
const riskSub = (pct) => {
  const b = balanceNow().cents;
  // The one high-risk trade a run (v7.17) has its own cap, said here so the bigger size is never a surprise.
  const bold = b > 0 ? ` The one high-risk trade a run may risk up to ${HIGH_RISK_PCT}%, <span class="num">${money(Math.round((b * HIGH_RISK_PCT) / 100))}</span>.` : ` The one high-risk trade a run may risk up to ${HIGH_RISK_PCT}%.`;
  return (b > 0 ? `${pct}% of ${money(b)} is <span class="num">${money(Math.round((b * pct) / 100))}</span> a trade.` : 'of the balance, on every trade.') + bold;
};
/** The 15-minute charts' line in Settings: whether Alpaca's key is on file, and what Alpaca said when it was saved. */
function barsSub(pub) {
  if (!pub?.hasBarsKey) return 'Alpaca key: none on file';
  const st = pub.barsCheck?.status;
  return `Alpaca key on file · ends ${pub.barsKeyTail || ''}${st === 'ok' ? ' · working' : st === 'refused' ? ' · Alpaca turned it down' : st === 'failed' ? ' · not checked yet' : ''}`;
}
function balanceSub() {
  const b = balanceNow();
  if (!(b.cents > 0)) return 'none yet';
  return b.typed ? `typed ${esc(dayShort(b.date ? `${b.date}T12:00:00Z` : ''))}` : 'the starting amount, until you type one';
}
function openSettings() {
  const ov = $('#overlay');
  const pub = settingsNow();
  const b = balanceNow();
  const sw = (k, on) => `<button type="button" class="sw${on ? ' on' : ''}" data-sw="${k}" aria-pressed="${on}" aria-label="${k}"></button>`;
  ov.innerHTML = `<div class="settings"><div class="head"><h1>SETTINGS</h1><button type="button" class="btn tiny primary done" data-x>Done</button></div><div class="wrap stack">
    <div><h2>Balance</h2><div class="grp">
      <div class="r"><span>Your balance<span class="sub" id="bal-sub">${balanceSub()}</span></span><span class="v num" id="bal-v" style="font-size:17px;color:var(--ink)">${b.cents > 0 ? money(b.cents) : ''}</span></div>
      <div class="r rule" style="grid-template-columns:1fr auto"><span class="box"><span style="padding-left:10px">$</span><input class="num" inputmode="decimal" id="bal-in" placeholder="Today's balance"></span><button type="button" class="btn tiny primary" id="bal-go">Save</button></div>
    </div><p class="said" id="bal-said">Every trade is sized from this. Update it when it changes.</p></div>
    <div><h2>Risk</h2><div class="grp">
      <div class="r rule"><span>Risk per trade<span class="sub" id="risk-sub">${riskSub(pub.riskPct ?? 3)}</span></span><span class="box"><input class="num" inputmode="decimal" id="risk-in" value="${esc(pub.riskPct ?? 3)}"><span>%</span></span></div>
      <div class="r">Account<span class="seg" style="margin-left:auto" id="acct-seg"><button type="button" data-at="cash"${pub.accountType !== 'margin' ? ' class="on"' : ''}>Cash</button><button type="button" data-at="margin"${pub.accountType === 'margin' ? ' class="on"' : ''}>Margin</button></span></div>
    </div><p class="said" id="risk-said"></p></div>
    <div><h2>Market data</h2><div class="grp">
      <div class="r"><span>Price key<span class="sub num" id="key-sub">${pub.hasKey ? `on file · ends ${esc(pub.keyTail || '')}` : 'none on file'}</span></span><button type="button" class="btn tiny quiet" style="margin-left:auto" id="key-go">${pub.hasKey ? 'Replace' : 'Add'}</button></div>
      <div class="r"><span>15-minute charts<span class="sub num" id="bars-sub">${esc(barsSub(pub))}</span></span><button type="button" class="btn tiny quiet" style="margin-left:auto" id="bars-go">${pub.hasBarsKey ? 'Replace' : 'Add'}</button></div>
      <div class="r" style="display:block"><span>Always looked at<span class="sub">Named to the desk on every run. It still looks well past them.</span></span><div class="watch" id="watch-chips">${(pub.watchlist || []).map((t) => `<span class="chip tap">${esc(t)}</span>`).join('')}</div><button type="button" class="btn tiny quiet" id="watch-go" style="margin-top:10px">Edit the list</button></div>
    </div><p class="said" id="key-said"></p></div>
    <div><h2>GLP-1 chain</h2><div class="grp">
      <div class="r" style="display:block" id="chain"><span>Searched on every run<span class="sub">From the makers to the sellers. A trade from it clears the same 50% bar as any other.</span></span>${GLP1_CHAIN.map((g) => `<span class="sub" style="margin-top:12px">${esc(g.role)}</span><div class="watch">${g.tickers.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>`).join('')}</div>
    </div></div>
    <div><h2>Alerts</h2><div class="grp">
      <div class="r"><span>Pushes<span class="sub">The 7:00 run, and any run that finds a strong trade.</span></span>${sw('pushOn', pub.pushOn !== false)}</div>
      <div class="r"><span>Show the research<span class="sub">For debugging only: the five researchers' reports from the last run.</span></span>${sw('debugResearch', pub.debugResearch === true)}</div>
      <button type="button" class="r" id="research-go"${pub.debugResearch === true ? '' : ' hidden'}>The last run's research<span class="chev">&rsaquo;</span></button>
    </div><p class="said" id="sw-said"></p></div>
    <p class="foot">Version ${esc(VERSION)}</p>
  </div></div>`;
  const onEsc = (e) => { if (e.key === 'Escape') closeAll(); };
  const closeAll = () => { sheetClose?.(); ov.innerHTML = ''; document.removeEventListener('keydown', onEsc); };
  for (const x of ov.querySelectorAll('.settings [data-x]')) x.addEventListener('click', closeAll);
  document.addEventListener('keydown', onEsc);

  const save = async (body, saidSel) => {
    say(saidSel, 'Saving…');
    S.rev += 1;
    try {
      const out = await call('settings', body);
      S.state = { ...S.state, settings: out.settings };
      paintTrades();
      say(saidSel, 'Saved.');
      return out;
    } catch (err) { say(saidSel, err.message); return null; }
  };
  ov.querySelector('#bal-go').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const raw = String(ov.querySelector('#bal-in').value).replace(/[$,\s]/g, '');
    const v = Number(raw);
    if (!raw || !Number.isFinite(v) || v <= 0) { say('#bal-said', 'The balance in dollars, for example 2450.'); return; }
    btn.disabled = true;
    say('#bal-said', 'Saving…');
    S.rev += 1;
    try {
      const out = await call('balance', { cents: Math.round(v * 100) });
      S.state = { ...S.state, balance: out.balance };
      ov.querySelector('#bal-v').textContent = money(out.balance.cents);
      ov.querySelector('#bal-sub').innerHTML = balanceSub();
      ov.querySelector('#risk-sub').innerHTML = riskSub(settingsNow().riskPct ?? 3);
      ov.querySelector('#bal-in').value = '';
      paintTrades();
      say('#bal-said', 'Saved. Every trade is sized from it now.');
    } catch (err) { say('#bal-said', err.message); } finally { btn.disabled = false; }
  });
  ov.querySelector('#risk-in').addEventListener('change', async (e) => {
    const v = Number(e.target.value);
    const out = await save({ riskPct: v }, '#risk-said');
    if (out) { e.target.value = out.settings.riskPct; ov.querySelector('#risk-sub').innerHTML = riskSub(out.settings.riskPct); }
  });
  for (const b2 of ov.querySelectorAll('#acct-seg button')) {
    b2.addEventListener('click', async () => {
      const out = await save({ accountType: b2.dataset.at }, '#risk-said');
      if (out) for (const x of ov.querySelectorAll('#acct-seg button')) x.classList.toggle('on', x.dataset.at === out.settings.accountType);
    });
  }
  ov.querySelector('#key-go').addEventListener('click', () => {
    const { sheet, close } = openSheet(`<h3>Price key</h3><div class="sum">It is stored on the Worker and never comes back to this page. Only its last four characters are ever shown.</div>
      <label>The key<input id="kk" autocomplete="off"></label>
      <button type="button" class="btn tall wide primary" id="kk-go">Save the key</button>
      <p class="said" id="kk-said" style="margin:8px 0 0"></p>
      <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
    sheet.querySelector('#kk-go').addEventListener('click', async () => {
      try {
        const out = await call('settings', { finnhubKey: sheet.querySelector('#kk').value.trim() });
        S.state = { ...S.state, settings: out.settings };
        ov.querySelector('#key-sub').textContent = out.settings.hasKey ? `on file · ends ${out.settings.keyTail}` : 'none on file';
        close();
      } catch (err) { say(sheet.querySelector('#kk-said'), err.message); }
    });
  });
  // THE 15-MINUTE CHARTS' KEY (v7.15): Alpaca's free plan, both halves at once, tested as it is saved.
  ov.querySelector('#bars-go').addEventListener('click', () => {
    const { sheet, close } = openSheet(`<h3>15-minute charts</h3><div class="sum">From Alpaca's free plan. In your Alpaca dashboard, open API Keys and generate one, then paste both halves here. They are stored on the Worker and never come back to this page.</div>
      <label>Key ID<input id="ak" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <label>Secret<input id="as" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false"></label>
      <button type="button" class="btn tall wide primary" id="ak-go">Save and test</button>
      <p class="said" id="ak-said" style="margin:8px 0 0"></p>
      <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
    sheet.querySelector('#ak-go').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      say(sheet.querySelector('#ak-said'), 'Checking with Alpaca…');
      try {
        const out = await call('settings', { alpacaKeyId: sheet.querySelector('#ak').value.trim(), alpacaSecret: sheet.querySelector('#as').value.trim() });
        S.state = { ...S.state, settings: out.settings };
        ov.querySelector('#bars-sub').textContent = barsSub(out.settings);
        ov.querySelector('#bars-go').textContent = out.settings.hasBarsKey ? 'Replace' : 'Add';
        const st = out.settings.barsCheck?.status;
        if (st === 'refused') { say(sheet.querySelector('#ak-said'), 'Saved, but Alpaca turned it down. Check you copied both halves of the same key.'); return; }
        close();
        say('#key-said', st === 'ok' ? 'Alpaca works. The next run has 15-minute charts.' : st === 'failed' ? 'Saved. Alpaca did not answer just now; the next run tries again.' : 'Removed. Runs go without 15-minute charts.');
      } catch (err) { say(sheet.querySelector('#ak-said'), err.message); } finally { btn.disabled = false; }
    });
  });
  ov.querySelector('#watch-go').addEventListener('click', () => {
    const { sheet, close } = openSheet(`<h3>Always looked at</h3><div class="sum">Tickers named to the desk on every run. It still looks well past them.</div>
      <label>Tickers, separated by spaces<textarea id="wl" rows="3">${esc((settingsNow().watchlist || []).join(' '))}</textarea></label>
      <button type="button" class="btn tall wide primary" id="wl-go">Save the list</button>
      <p class="said" id="wl-said" style="margin:8px 0 0"></p>
      <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
    sheet.querySelector('#wl-go').addEventListener('click', async () => {
      const out = await save({ watchlist: sheet.querySelector('#wl').value }, '#wl-said');
      if (!out) return;
      ov.querySelector('#watch-chips').innerHTML = (out.settings.watchlist || []).map((t) => `<span class="chip tap">${esc(t)}</span>`).join('');
      close();
    });
  });
  for (const b2 of ov.querySelectorAll('[data-sw]')) {
    b2.addEventListener('click', async () => {
      const k = b2.dataset.sw;
      const want = !b2.classList.contains('on');
      const out = await save({ [k]: want }, '#sw-said');
      if (!out) return;
      const now = k === 'pushOn' ? out.settings.pushOn !== false : out.settings[k] === true;
      b2.classList.toggle('on', now);
      b2.setAttribute('aria-pressed', String(now));
      if (k === 'debugResearch') ov.querySelector('#research-go').hidden = !now;
    });
  }
  ov.querySelector('#research-go').addEventListener('click', openResearch);
}
async function openResearch() {
  const { sheet } = openSheet('<h3>The last run\'s research</h3><div class="sum" id="rs-sum">Reading…</div><div id="rs-list" class="stack"></div><button type="button" class="btn quiet wide" data-x style="margin-top:12px">Close</button>');
  try {
    const out = await call('research');
    sheet.querySelector('#rs-sum').textContent = out.at ? `From the run ${agoShort(out.at)}. The desk read these; you do not need to.` : 'No run has filed research yet.';
    sheet.querySelector('#rs-list').innerHTML = (out.reports || []).map((r) => `<div class="panel"><div class="k">${esc(AGENTS[r.n]?.name ? `${AGENTS[r.n].name}, ${r.beat}` : r.beat)} · ${esc(r.status)}${r.ms ? ` · ${Math.round(r.ms / 1000)}s` : ''}</div><div style="white-space:pre-wrap;font-size:13px;margin-top:6px;color:var(--ink-2)">${esc(r.text || r.err || 'Nothing came back.')}</div></div>`).join('');
  } catch (err) { sheet.querySelector('#rs-sum').textContent = err.message; }
}
$('#cog').addEventListener('click', openSettings);

// ---- the polls -------------------------------------------------------------------------
//
// Five seconds while a run is in the air, so the researchers' count moves as
// they come back; a minute when nothing is. Every loop pauses while the tab is
// hidden and kicks the moment it is back.
let pollTimer = 0;
let pollAt = 0;
let polling = false;
function schedule(ms) {
  if (document.hidden) { clearTimeout(pollTimer); pollTimer = 0; return; }
  const wait = ms ?? (runBusy() ? 5000 : 60_000);
  // A poll already due sooner stays where it is; a later one is brought forward.
  if (pollTimer && pollAt <= Date.now() + wait) return;
  clearTimeout(pollTimer);
  pollAt = Date.now() + wait;
  pollTimer = setTimeout(() => { pollTimer = 0; pollOnce(); }, wait);
}
function kickPoll(ms = 400) { schedule(ms); }
async function loadState() {
  const out = await call('state');
  S.state = out;
  return out;
}
async function pollOnce() {
  if (polling) { schedule(); return; }
  polling = true;
  const wasBusy = runBusy();
  const before = new Set((S.state?.recs || []).map((r) => r.id));
  const rev = S.rev;
  try {
    const out = await call('state');
    // A tap landed while this poll was out: its answer is newer, so this one is dropped.
    if (rev !== S.rev) return;
    S.state = out;
    paintTrades();
    if (wasBusy && !runBusy()) {
      // The run landed: say so, light the box, and let the fresh cards arrive.
      const box = $('#runbox');
      box.classList.remove('landed'); void box.offsetWidth; box.classList.add('landed');
      // The bar reads full for a moment when trades land, then goes; a run that failed just goes.
      if (S.state.run?.status !== 'error') { BAR.doneUntil = Date.now() + 1400; paintBar(); setTimeout(paintBar, 1500); }
      const freshRecs = (S.state.recs || []).filter((r) => !before.has(r.id));
      const fresh = freshRecs.length;
      // The high-risk trade is named as such the moment it lands (v7.17).
      const bold = freshRecs.some((r) => r.highRisk) ? (fresh === 1 ? ', and it is high risk' : ', one of them high risk') : '';
      if (S.state.run?.status === 'error') toast('The run did not finish. The line under the button says why.');
      else {
        // What the run says about the trades he took, sells first, with how many agree (v7.13).
        const vs = S.state.desk?.verdicts || [];
        const of = (x) => (x.agree != null ? ` (${x.agree} of 5)` : '');
        const sells = vs.filter((x) => x.call === 'sell').map((x) => `${x.instrument === 'stock' && x.side === 'short' ? 'Cover' : 'Sell'} ${x.ticker} now${of(x)}.`);
        const rest = ['trim', 'add', 'hold'].map((c) => { const t = vs.filter((x) => x.call === c); return t.length ? ` ${c[0].toUpperCase()}${c.slice(1)} ${t.map((x) => `${x.ticker}${of(x)}`).join(', ')}.` : ''; }).join('');
        const yours = `${sells.length ? ` ${sells.join(' ')}` : ''}${rest}`;
        toast(`${fresh ? `The desk is in: ${fresh} trade${fresh === 1 ? '' : 's'}${bold}.` : 'The desk is in. Nothing worth taking right now.'}${yours}`);
        if (sells.length) $('#active-wrap')?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
      S.news = null;
      quotesAt = 0;
      loadQuotes();
      if (S.page === 'news') loadNews({ force: true });
    }
  } catch { /* the next tick tries again */ } finally {
    polling = false;
    schedule();
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) kickPoll(); else { clearTimeout(pollTimer); pollTimer = 0; } });
setInterval(() => { if (!document.hidden && S.page === 'trades' && runBusy()) paintBar(); }, 1000);
setInterval(() => {
  if (document.hidden || !S.state) return;
  paintMarket();
  if (S.page === 'trades') { loadQuotes(); if (runBusy()) paintRun(); }
}, 30_000);
addEventListener('resize', placeInd);
addEventListener('hashchange', () => { const h = location.hash.slice(1); if (PAGES.includes(h) && h !== S.page) show(h, { push: false }); });

// ---- the door, when no desk is open ------------------------------------------------------
function paintDoor(said = '') {
  $('#boot')?.remove();
  const app = $('#app');
  app.hidden = false;
  app.innerHTML = `<section class="page in"><header class="title"><div><h1 class="pt fl">PR 420</h1><p class="ps">Nothing is open yet.</p></div></header>
    <div class="panel empty"><span>One tap opens the desk.</span><button type="button" class="btn primary tall" id="door-go">Open PR 420</button><p class="said" id="door-said">${esc(said)}</p></div></section>`;
  $('#door-go').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/trade/open', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok && !(res.status === 409 && out.existing)) throw new Error(out.error || `Failed (${res.status})`);
      location.reload();
    } catch (err) { say('#door-said', err.message); btn.disabled = false; }
  });
}

// ---- boot --------------------------------------------------------------------------------
(async () => {
  const user = await requireAdmin();
  if (!user) return;
  S.user = user;
  let st = null;
  try { st = await loadState(); } catch (err) {
    $('#boot').textContent = err.message;
    return;
  }
  if (!st.open) { paintDoor(); return; }
  fx = createFx({
    state: () => ({ celebrate: true, reduceFx: false }),
    emitters: [['#run', 'blue'], ['#bar button.on', 'blue'], ['.page:not([hidden]) .pt', 'blue']],
  });
  $('#boot').remove();
  $('#app').hidden = false;
  $('#bar').hidden = false;
  paintTrades();
  let start = 'trades';
  try { start = location.hash.slice(1) || localStorage.getItem(PAGE_KEY) || 'trades'; } catch { /* blocked storage is not an error */ }
  show(start, { push: false });
  fx.start();
  schedule();
})();
