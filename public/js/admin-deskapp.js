// THE TRADE DESK, AS ONE APP (Eric, 2026-09-22: "The current Trading Desk is
// too fragmented. Remove the excessive tabs and consolidate the app into a
// smaller number of clear, useful sections.")
//
// This is the app: the boot, the one store, the router behind the five tabs,
// the polls, and every action. It draws nothing itself. The markup comes from
// admin-desk.js, which is pure and therefore checkable in node; the animations
// come from admin-deskfx.js, which owns the canvas; the arithmetic comes from
// trade-math.js, which is the same code the Worker computes with.
//
// Two rules run through all of it. The first: every control paints from the
// server's answer, never from its own tap, so what is on screen is what is
// stored. The second: nothing here runs on a clock but the polls. Scan and
// Update wait for his tap, with the one exception he asked for, the reading
// booked at 7:00 Mountain by the Worker's cron.
//
// The name is load-bearing: admin-deskapp.js matches the Worker's asset gate
// at worker/index.js, so this file is a 404 to anyone but him.

import { requireAdmin } from './auth.js';
import {
  db, storage, collection, doc, getDoc, addDoc, updateDoc, onSnapshot,
  query, orderBy, limit, serverTimestamp,
  ref, uploadBytesResumable, getDownloadURL, listAll, getMetadata, deleteObject,
} from './firebase.js';
import { markSeen } from './seen.js';
import { VERSION } from './changelog.js';
import { md, splitPages } from './advisor.js';
import {
  rulesOf, RULE_RANGES, dayStatus, tradeCalc, isMarketOpen, isTradingDay,
  HORIZONS, HORIZON_WORDS, sizeFor, sharesForDollars, dollarsForShares, fmtQty, playSizing, vehicleLabel,
} from './trade-math.js';
import {
  money, shortMoney, dayShort, dayName, agoShort, tradeCall,
  playFaceHtml, positionFaceHtml, dayBarState, deskChartSvg,
  newsRowHtml, earningsChipHtml, statsOverviewHtml, statsBreakdownHtml, statsClosesHtml,
  isQuestion, mergeStream, streamRowHtml, logLineFor, esc,
} from './admin-desk.js';
import { createFx, seedFlicker, targetState } from './admin-deskfx.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const MT = 'America/Boise';
const PAGES = ['plays', 'positions', 'news', 'stats', 'desk'];
const PAGE_KEY = 'pa-desk-page';
const STATS_KEY = 'pa-desk-stats';
/** His clock, as the minute of the day and the weekday, for the market line. */
function mtNow(at = new Date()) {
  const p = {};
  for (const { type, value } of new Intl.DateTimeFormat('en-US', {
    timeZone: MT, hourCycle: 'h23', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(at)) p[type] = value;
  return { hh: p.hour, mm: p.minute, minuteOfDay: Number(p.hour) * 60 + Number(p.minute), weekday: p.weekday };
}

// ---- the store ---------------------------------------------------------------
//
// One object, and painters that name the keys they read. A poll writes a key
// and only the pages that asked for it repaint, which is what keeps a scan
// landing on Plays from rebuilding the stream he is reading on Desk.
const S = {
  deskId: '', closed: false, page: 'plays', statsPage: 0,
  state: null,        // GET trade/state: settings, balances, chart, the key's tail
  panel: null,        // GET advisor/state: the reading, its status, the trade block
  plays: [],
  positions: null,    // GET trade/positions
  news: null, newsAt: 0,
  history: null,
  qa: [], log: [], pending: [],
  glossary: [], files: null,
  quotes: {},
};
const watchers = new Map();
function on(keys, fn) { for (const k of keys) watchers.set(k, [...(watchers.get(k) || []), fn]); }
function set(key, value) {
  S[key] = value;
  for (const fn of watchers.get(key) || []) { try { fn(); } catch { /* one dead painter never stops the rest */ } }
}

const getToken = () => S.user.getIdToken();
const call = (sub, body) => tradeCall(getToken, sub, body);

/** One sentence under a control, which is where every failure lands. */
function say(sel, text) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (el) el.textContent = text || '';
}
let toastTimer = 0;
function toast(text, action, onAction) {
  const host = $('#toasts');
  host.innerHTML = '';
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button type="button" class="btn tiny primary">${esc(action)}</button>` : ''}`;
  host.appendChild(el);
  const kill = () => { if (el.isConnected) el.remove(); };
  el.querySelector('button')?.addEventListener('click', () => { onAction?.(); kill(); });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(kill, 5000);
}
/** A button that is out: disabled, its word changed, and handed back whatever happens. */
async function busy(btn, word, fn) {
  const was = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.textContent = word; }
  try { return await fn(); } finally { if (btn) { btn.disabled = false; btn.innerHTML = was; } }
}

// ---- the router ---------------------------------------------------------------
function placeInd() {
  const b = $('#bar button.on');
  if (!b) return;
  $('#ind').style.transform = `translateX(${b.offsetLeft + b.offsetWidth / 2 - 14}px)`;
}
function show(name, { push = true } = {}) {
  const page = PAGES.includes(name) ? name : 'plays';
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
  $('#composer').hidden = page !== 'desk';
  $('.crumb').innerHTML = `Trade desk <b>${esc(page === 'plays' ? 'Plays' : page === 'positions' ? 'Positions' : page === 'news' ? 'News' : page === 'stats' ? 'Stats' : 'Desk')}</b>`;
  try { localStorage.setItem(PAGE_KEY, page); } catch { /* blocked storage is not an error */ }
  if (push && location.hash.slice(1) !== page) history.replaceState(null, '', `#${page}`);
  // Whichever badge the shelf hangs on this page clears the moment it is open,
  // exactly as the folder's tabs cleared them.
  if (page === 'desk') { markSeen(S.deskId, 'chat'); markSeen(S.deskId, 'advisor'); }
  if (page === 'plays') markSeen(S.deskId, 'dx');
  if (page === 'plays' || page === 'positions') loadPositions();
  if (page === 'plays') paintMarket();
  if (page === 'news') loadNews();
  if (page === 'stats') loadHistory();
  if (page === 'desk') { loadQa(); requestAnimationFrame(() => { padStream(); window.scrollTo(0, document.body.scrollHeight); }); }
  else window.scrollTo(0, 0);
  seedFlicker(document);
}
for (const b of $$('#bar [data-page]')) b.addEventListener('click', () => show(b.dataset.page));

// ---- what the pages read out of the store -------------------------------------
const rulesNow = () => rulesOf({ rules: S.positions?.rules || S.panel?.trade?.rules || S.state?.settings?.rules });
const accountNow = () => (Number.isFinite(S.positions?.accountCents) ? S.positions.accountCents
  : Number.isFinite(S.history?.accountCents) ? S.history.accountCents
    : Number(S.state?.settings?.startCents) || 0);
const scanNow = () => S.panel?.trade?.scan || S.state?.scan || { status: 'idle', note: null, at: null, error: null };
const hasKeyNow = () => !!(S.state?.hasKey ?? S.panel?.trade?.hasKey);
// WHAT IS LIVE (Eric, 2026-09-22: "Why do I have expired plays? Those should
// just refresh."). `expired` used to be in here, so a setup that had timed out
// sat at the top of the board with Take it still on it and the word Expired
// beside it. A setup past its hour is not a setup; it drops to Recent with the
// skipped and the closed, and the board shows only what still stands.
const LIVE = new Set(['open']);
const expired = (p) => p.status === 'expired' || (p.status === 'open' && p.expiresAt && new Date(p.expiresAt).getTime() < Date.now());
const chanceOf = (p) => (Number(p.profitLow) + Number(p.profitHigh)) / 2 || 0;

// ---- PLAYS --------------------------------------------------------------------
function paintMarket() {
  const t = mtNow();
  const today = S.state?.today || S.positions?.today || '';
  const day = today ? isTradingDay(today) : false;
  const open = day ? isMarketOpen({ dateKey: today, minuteOfDay: t.minuteOfDay }) : false;
  const el = $('#mkt');
  el.classList.toggle('open', open);
  $('#mkt-word').textContent = !day ? `${t.hh}:${t.mm} · Closed`
    : open ? `${t.hh}:${t.mm} · Open`
      : t.minuteOfDay < 450 ? `${t.hh}:${t.mm} · Opens 07:30` : `${t.hh}:${t.mm} · Closed`;
}
function paintScan() {
  const sc = scanNow();
  const row = $('#scan');
  const running = sc.status === 'running';
  row.setAttribute('aria-busy', running ? 'true' : 'false');
  $('#scan-go').disabled = running;
  const n = S.plays.filter((p) => LIVE.has(p.status) && !expired(p)).length;
  $('#scan-txt').innerHTML = running
    ? 'Scanning for new entries. <b>It lands on its own.</b>'
    : sc.at
      ? `Last scan <b>${esc(agoShort(sc.at))}</b> · ${n} on the desk`
      : 'No scan yet today. Tap Scan when you want one.';
  // Three different silences, and he should never have to guess which one it
  // was: a scan that failed, a scan that came back without its setups list,
  // and a desk with no price key on it.
  say('#scan-said', sc.status === 'error' ? sc.error || 'The last scan did not come back.'
    : !hasKeyNow() ? 'No market data key on file. Add it in Settings.'
      : (!running && sc.note?.missing) ? 'That scan came back without its setups list, so nothing was filed. Tap Scan again.'
        : '');
}
function paintNote() {
  const note = scanNow().note;
  const box = $('#note');
  box.hidden = !note || !note.text;
  if (box.hidden) return;
  // The note comes back with its own heading on it, which the page already has.
  $('#note-p').textContent = String(note.text || '').replace(/^#{1,3}\s+[^\n]*\n+/, '').trim();
  $('#note-when').textContent = note.at ? `read ${agoShort(note.at)}` : '';
}
function tickHtml(q) {
  const up = Number(q.chgPct) >= 0;
  const span = Number(q.high) - Number(q.low);
  const pos = span > 0 ? Math.max(0, Math.min(1, (Number(q.last) - Number(q.low)) / span)) : 0.5;
  return `<div class="panel tq ${up ? 'c-green' : 'c-red'}"><div class="sym">${esc(q.ticker)}</div><div class="last num">${Number(q.last).toFixed(2)}</div>
    <div class="chg num ${up ? 'up' : 'dn'}">${up ? '&#9650;' : '&#9660;'} ${up ? '+' : ''}${Number(q.chgPct ?? 0).toFixed(2)}%</div>
    <div class="rng"><i style="left:${(pos * 100).toFixed(0)}%"></i></div>
    <div class="lh"><span>${Number(q.low).toFixed(2)}</span><span>${Number(q.high).toFixed(2)}</span></div></div>`;
}
function paintTicks() {
  const wanted = tickSymbols();
  const rows = wanted.map((t) => S.quotes[t]).filter(Boolean);
  $('#ticks').innerHTML = rows.length ? rows.map(tickHtml).join('')
    : `<p class="dim small" style="grid-column:1/-1;margin:0 0 4px">${hasKeyNow() ? 'No prices right now.' : 'No market data key on file. Add it in Settings.'}</p>`;
}
function tickSymbols() {
  const watch = S.state?.settings?.watchlist || [];
  const mine = (S.positions?.positions || []).filter((p) => p.status === 'open').map((p) => p.ticker);
  const top = S.plays.filter((p) => LIVE.has(p.status) && !expired(p)).sort((a, b) => chanceOf(b) - chanceOf(a))[0]?.ticker;
  return [...new Set([...mine, top, ...watch].filter(Boolean))].slice(0, 3);
}
function paintPlays() {
  const box = $('#plays');
  const rules = rulesNow();
  const accountCents = accountNow();
  const live = S.plays.filter((p) => (LIVE.has(p.status) && !expired(p)) || (p.status === 'took' && !p.closedAt))
    .sort((a, b) => (chanceOf(b) - chanceOf(a)) || String(b.at || '').localeCompare(String(a.at || '')));
  const rest = S.plays.filter((p) => !live.includes(p)).slice(0, 10);
  box.innerHTML = live.length
    ? live.map((p) => playFaceHtml(p, { rules, accountCents })).join('')
    : `<div class="panel empty"><span>${S.plays.length ? 'Nothing still standing. The last setups have run out of time.' : 'Nothing worth taking right now.'}</span><button type="button" class="btn primary" data-scan-here>Scan for new entries</button></div>`;
  box.querySelector('[data-scan-here]')?.addEventListener('click', () => $('#scan-go').click());
  for (const b of box.querySelectorAll('[data-act]')) {
    b.addEventListener('click', () => {
      const card = b.closest('[data-play]');
      const p = S.plays.find((x) => x.id === card.dataset.play);
      if (!p) return;
      if (b.dataset.act === 'take') openPositionSheet(p);
      else if (b.dataset.act === 'skip') markPlay(p, card, 'skipped', b);
      else if (b.dataset.act === 'closed') closedAtSheet(p);
    });
  }
  const rec = $('#recent');
  rec.hidden = !rest.length;
  if (rest.length) {
    $('#recent-sub').textContent = `${rest.length} skipped, closed or past`;
    $('#recent-list').innerHTML = rest.map((p) => `<li><span>${esc(p.ticker)} ${esc(p.side)} <span class="dim">${esc(HORIZON_WORDS[p.horizon] || '')}</span></span><span class="dim">${esc(p.status === 'closed' ? money(p.outcomeCents, true) : p.status === 'skipped' ? 'skipped' : 'past')}</span></li>`).join('');
  }
  $('#plays-sub').textContent = live.length ? `${live.length} on the desk` : 'Best first';
  $('#seg-npos').textContent = String(S.positions?.openCount ?? '');
  paintTicks();
  seedFlicker(box);
}
async function markPlay(p, card, status, btn) {
  try {
    const out = await busy(btn, status === 'skipped' ? 'Skipping…' : 'Saving…', () => call('play', { id: p.id, status }));
    set('plays', S.plays.map((x) => (x.id === p.id ? out.play : x)));
    if (status === 'skipped') toast(`${p.ticker} skipped`);
  } catch (err) {
    say(card.querySelector('[data-play-said]'), err.message);
  }
}
on(['plays'], paintPlays);
on(['plays'], paintScan);
on(['plays'], paintNote);
on(['quotes'], paintTicks);

$('#scan-go').addEventListener('click', async () => {
  say('#scan-said', '');
  try {
    await call('scan', {});
    set('panel', { ...(S.panel || {}), trade: { ...(S.panel?.trade || {}), scan: { ...scanNow(), status: 'running' } } });
    paintScan();
    kickPoll();
  } catch (err) { say('#scan-said', err.message); }
});
$('#note-more').addEventListener('click', () => {
  const n = $('#note');
  n.classList.toggle('clamp');
  $('#note-more').textContent = n.classList.contains('clamp') ? 'more' : 'less';
});

// ---- NEWS ---------------------------------------------------------------------
const NEWS_MEMO_MS = 5 * 60_000;
async function loadNews({ force = false } = {}) {
  if (!force && S.news && Date.now() - S.newsAt < NEWS_MEMO_MS) { paintNews(); return; }
  try {
    const out = await call('news');
    S.newsAt = Date.now();
    set('news', out);
  } catch (err) {
    if (!S.news) $('#news-list').innerHTML = `<li><span class="b"></span><div><div class="t">${esc(err.message)}</div></div><span></span></li>`;
  }
}
function paintNews() {
  const n = S.news;
  if (!n) return;
  const onDesk = n.onDesk || [];
  $('#news-sub').textContent = `${esc(dayName(n.today))} ${esc(dayShort(n.today))} · ${n.tradingDay === 'early' ? 'short session' : n.tradingDay ? 'full session' : 'market closed'}${n.closeAt ? ` · closes ${n.closeAt}` : ''}`;
  $('#news-earn').innerHTML = (n.earnings || []).length
    ? n.earnings.map((e) => earningsChipHtml(e, { onDesk })).join('')
    : `<p class="dim small" style="margin:0">${n.hasKey ? 'Nothing on the calendar today.' : 'No market data key on file. Add it in Settings.'}</p>`;
  const rows = [...(n.headlines || [])].sort((a, b) => {
    const al = (a.related || []).some((t) => onDesk.includes(t));
    const bl = (b.related || []).some((t) => onDesk.includes(t));
    return (Number(bl) - Number(al)) || (new Date(b.at || 0) - new Date(a.at || 0));
  });
  $('#news-list').innerHTML = rows.length
    ? rows.map((r) => newsRowHtml(r, { onDesk })).join('')
    : `<li><span class="b"></span><div><div class="t">${n.hasKey ? 'Nothing in the last 24 hours.' : 'No market data key on file. Add it in Settings.'}</div></div><span></span></li>`;
  $('#news-when').textContent = n.throttled ? `showing the last fetch · ${esc(agoShort(n.asOf))}` : `as of ${esc(agoShort(n.asOf))}`;
  for (const li of $$('#news-list li.has')) {
    li.addEventListener('click', (e) => { if (!e.target.closest('[data-tk]')) li.classList.toggle('open'); });
  }
  for (const b of $$('#pg-news [data-tk]')) b.addEventListener('click', () => jumpToTicker(b.dataset.tk));
}
function jumpToTicker(tk) {
  const play = S.plays.find((p) => p.ticker === tk && LIVE.has(p.status));
  const pos = (S.positions?.positions || []).find((p) => p.ticker === tk && p.status === 'open');
  if (play) { show('plays'); setTimeout(() => $(`[data-play="${play.id}"]`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 140); return; }
  if (pos) { show('positions'); setTimeout(() => $(`[data-pos="${pos.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 140); }
}
on(['news'], paintNews);
$('#news-refresh').addEventListener('click', (e) => busy(e.currentTarget, 'Refreshing…', () => loadNews({ force: true })));

// ---- POSITIONS ----------------------------------------------------------------
const centerOf = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; };
const dayNow = () => S.positions?.dayStatus || dayStatus({ rules: rulesNow(), accountCents: accountNow() });
const liveNow = () => (Number.isFinite(S.positions?.liveCents) ? S.positions.liveCents : accountNow());

async function loadPositions() {
  try {
    const out = await call('positions');
    set('positions', out);
    loadQuotes();
  } catch (err) {
    if (!S.positions) $('#positions').innerHTML = `<div class="panel empty"><span>${esc(err.message)}</span><button type="button" class="btn quiet" data-retry>Try again</button></div>`;
    $('#positions').querySelector('[data-retry]')?.addEventListener('click', loadPositions);
  }
}
async function loadQuotes() {
  const want = tickSymbols();
  if (!want.length || !hasKeyNow()) return;
  try {
    const out = await call(`quote?symbols=${encodeURIComponent(want.join(','))}`);
    const next = { ...S.quotes };
    for (const q of out.quotes || []) next[q.ticker] = q;
    set('quotes', next);
  } catch { /* a missing price is a dash on a card, never an error on the page */ }
}
function paintDay({ words = true, badge = true } = {}) {
  const d = dayNow();
  const gold = targetState({ realizedTodayCents: d.realizedTodayCents, aimCents: d.aimCents, accountCents: accountNow() }) === 'gold';
  const look = dayBarState(d, gold);
  const span = Math.max(1, d.capCents - d.lossLimitCents);
  const pctOf = (c) => ((c - d.lossLimitCents) / span) * 100;
  const bar = $('#daybar');
  const left = Math.min(0, d.realizedTodayCents);
  const right = Math.max(0, d.realizedTodayCents);
  bar.style.setProperty('--zero', `${pctOf(0)}%`);
  bar.style.setProperty('--left', `${pctOf(left)}%`);
  bar.style.setProperty('--width', `${Math.max(0, pctOf(right) - pctOf(left))}%`);
  bar.style.setProperty('--fillc', look.fill);
  bar.style.setProperty('--fillglow', look.glow);
  $('#tick-floor').style.left = `${pctOf(d.floorCents)}%`;
  $('#lbl-floor').style.left = `${pctOf(d.floorCents)}%`;
  $('#lbl-zero').style.left = `${pctOf(0)}%`;
  $('#tick-aim').style.left = `${pctOf(d.aimCents)}%`;
  $('#lbl-aim').style.left = `${pctOf(d.aimCents)}%`;
  const onFloor = d.state === 'on-floor';
  const aimLit = d.state === 'on-aim' || d.state === 'stop-cap';
  for (const el of [$('#tick-floor'), $('#lbl-floor')]) { el.classList.toggle('lit', onFloor); el.style.setProperty('--tc', 'var(--blue)'); }
  for (const el of [$('#tick-aim'), $('#lbl-aim')]) { el.classList.toggle('lit', aimLit); el.style.setProperty('--tc', gold ? 'var(--gold)' : 'var(--green)'); }
  $('#lbl-limit').textContent = money(d.lossLimitCents);
  $('#lbl-cap').textContent = money(d.capCents);
  $('#lbl-floor').querySelector('.word').textContent = money(d.floorCents);
  $('#lbl-aim').querySelector('.word').textContent = money(d.aimCents);
  const made = $('#day-real');
  const flat = d.realizedTodayCents === 0;
  made.style.color = flat ? 'var(--dim)' : look.ink;
  made.style.textShadow = flat ? 'none' : `0 0 1px rgba(255,255,255,.35), 0 0 8px ${look.ink}`;
  if (words) {
    made.textContent = money(d.realizedTodayCents, d.realizedTodayCents > 0);
    const pct = accountNow() ? (d.realizedTodayCents / accountNow()) * 100 : 0;
    $('#day-sub').textContent = `${pct.toFixed(1)}% · ${look.word}`;
    $('#big').textContent = money(liveNow());
  }
  if (badge) {
    const b = $('#bar-badge');
    b.hidden = flat;
    b.textContent = shortMoney(d.realizedTodayCents);
    b.classList.toggle('dn', d.realizedTodayCents < 0);
  }
  placeInd();
  const typed = S.positions?.lastBalanceDay;
  $('#bal-typed').textContent = typed === S.positions?.today ? 'typed today' : typed ? `last typed ${dayShort(typed)}` : 'no balance typed yet';
  $('#bal-last').innerHTML = typed ? `Last entry <b>${esc(dayShort(typed))}</b> · <span class="num">${money(accountNow())}</span>` : 'No balance typed yet.';
  $('#pos-sub').textContent = `${S.positions?.openCount || 0} open · ${money(d.realizedTodayCents, d.realizedTodayCents > 0)} today`;
  $('#seg-npos').textContent = String(S.positions?.openCount ?? '');
  $('#seg-npos2').textContent = String(S.positions?.openCount ?? '');
  if (S.page === 'stats' && S.statsPage === 1) fx?.targetLine(lineState());
}
const lineState = () => (S.state?.settings?.celebrate === false ? 'none' : targetState({
  realizedTodayCents: dayNow().realizedTodayCents, aimCents: dayNow().aimCents, accountCents: accountNow(),
}));
function paintPositions() {
  if (!S.positions) return;
  const rows = S.positions.positions || [];
  const open = rows.filter((p) => p.status === 'open');
  const closedToday = rows.filter((p) => p.status === 'closed' && p.closedDay === S.positions.today);
  const rules = rulesNow();
  const box = $('#positions');
  box.innerHTML = open.length
    ? open.map((p) => {
      const quote = S.quotes[p.ticker] || null;
      const calc = quote ? tradeCalc({ pos: p, rules, accountCents: accountNow(), quote, todayKey: S.positions.today, accountType: S.positions.accountType }) : p.calc;
      return positionFaceHtml(p, calc, { quote });
    }).join('')
    : '<div class="panel empty"><span>Nothing open.</span><span class="row"><button type="button" class="btn primary" data-new>Add a position</button><button type="button" class="btn quiet" data-go="plays">See the plays</button></span></div>';
  box.querySelector('[data-new]')?.addEventListener('click', () => openPositionSheet(null));
  for (const b of box.querySelectorAll('[data-act]')) b.addEventListener('click', () => positionAction(b));
  $('#closed').innerHTML = closedToday.length
    ? closedToday.map((p) => `<div class="r"><span>${esc(p.ticker)} ${esc(p.side)} <span class="dim small">${esc(p.closeNote || '')}</span></span><span class="v ${p.pnlCents >= 0 ? 'up' : 'dn'}">${money(p.pnlCents, true)}</span></div>`).join('')
    : '<div class="r dim">Nothing closed yet today.</div>';
  seedFlicker(box);
}
function positionAction(b) {
  const card = b.closest('[data-pos]');
  const p = (S.positions?.positions || []).find((x) => x.id === card.dataset.pos);
  if (!p) return;
  const grid = card.querySelector('.editgrid');
  const act = b.dataset.act;
  if (act === 'edit') { grid.hidden = !grid.hidden; return; }
  if (act === 'cancel') { grid.hidden = true; return; }
  if (act === 'save') { savePosition(p, grid, b, card); return; }
  if (act === 'remove') { removePosition(p, b, card); return; }
  if (act === 'close') openCloseSheet(p);
}
async function savePosition(p, grid, btn, card) {
  const patch = { id: p.id };
  for (const i of grid.querySelectorAll('[data-f]')) {
    const v = i.value.trim();
    if (i.dataset.f === 'qty') patch.qty = Number(v) || p.qty;
    else patch[i.dataset.f] = v;
  }
  try {
    await busy(btn, 'Saving…', () => call('position', patch));
    await loadPositions();
  } catch (err) { say(card.querySelector('[data-pos-said]'), err.message); }
}
/** A row he typed by mistake. It is not a close and never reaches Stats. */
async function removePosition(p, btn, card) {
  if (!confirm(`Remove ${p.ticker} from the desk? It was typed by mistake and counts nowhere.`)) return;
  try {
    await busy(btn, 'Removing…', () => call('remove', { id: p.id }));
    await loadPositions();
  } catch (err) { say(card.querySelector('[data-pos-said]'), err.message); }
}
on(['positions'], paintPositions);
on(['positions'], () => paintDay());
on(['positions'], paintPlays);
on(['quotes'], paintPositions);

// ---- the sheets ----------------------------------------------------------------
let sheetTrack = null;
function openSheet(html, { onClose } = {}) {
  const ov = $('#overlay');
  ov.innerHTML = `<div class="scrim"></div><div class="sheet"><div class="handle"></div>${html}</div>`;
  const scrim = ov.querySelector('.scrim');
  const sheet = ov.querySelector('.sheet');
  // The keyboard on a phone shrinks the visual viewport, not the layout one, so
  // a fixed sheet has to be told where the top of the keyboard is or the Save
  // button sits behind it.
  const track = () => { const vv = window.visualViewport; if (vv) sheet.style.bottom = `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`; };
  if (window.visualViewport) { sheetTrack = track; visualViewport.addEventListener('resize', track); visualViewport.addEventListener('scroll', track); }
  const close = () => new Promise((res) => {
    if (!sheet.isConnected) { res(); return; }
    if (sheetTrack) { visualViewport.removeEventListener('resize', sheetTrack); visualViewport.removeEventListener('scroll', sheetTrack); sheetTrack = null; }
    scrim.classList.add('out'); sheet.classList.add('out');
    const done = () => { ov.innerHTML = ''; onClose?.(); res(); };
    sheet.addEventListener('animationend', done, { once: true });
    setTimeout(done, 220);
  });
  scrim.addEventListener('click', close);
  for (const x of sheet.querySelectorAll('[data-x]')) x.addEventListener('click', close);
  return { sheet, close };
}
/** A second sheet over the first, for a confirmation that must not lose what is behind it. */
function openInner(html) {
  const ov = $('#overlay');
  const box = document.createElement('div');
  ov.appendChild(box);
  box.innerHTML = `<div class="scrim" style="z-index:95"></div><div class="sheet" style="z-index:96"><div class="handle"></div>${html}</div>`;
  const close = () => box.remove();
  for (const y of box.querySelectorAll('[data-y], .scrim')) y.addEventListener('click', close);
  return { box, close };
}
const INSTRUMENT_WORDS = { stock: 'Shares', call: 'Call', put: 'Put', spread: 'Spread' };
function openPositionSheet(play) {
  const guess = play ? {
    ticker: play.ticker, side: play.side, horizon: play.horizon,
    instrument: play.instrument || 'stock', structure: play.structure || '',
    entry: play.entry, stop: play.stop ?? '', target: (play.targets || [])[0] || '',
    // THE CONTRACT COMES WITH THE PLAY (2026-09-22). He should never retype a
    // strike or an expiration the scan already named.
    strike: play.strike ?? '', strike2: play.strike2 ?? '',
    expiry: play.expiry || '', optionType: play.optionType || '', credit: play.credit === true,
  } : {
    ticker: '', side: 'long', horizon: 'intraday', instrument: 'stock', structure: '', entry: '', stop: '', target: '',
    strike: '', strike2: '', expiry: '', optionType: '', credit: false,
  };
  const { sheet, close } = openSheet(`
    <h3>${play ? `Take ${esc(play.ticker)} ${esc(play.side)}` : 'New position'}</h3>
    <div class="sum">${play ? esc(play.structure || play.instrument || 'shares') : 'What you are actually in, in your own numbers.'}</div>
    <div class="grid2">
      <label>Ticker<input id="np-tk" value="${esc(guess.ticker)}" style="text-transform:uppercase" autocapitalize="characters"></label>
      <label>Side<select id="np-side">${['long', 'short'].map((v) => `<option value="${v}"${guess.side === v ? ' selected' : ''}>${v === 'long' ? 'Long' : 'Short'}</option>`).join('')}</select></label>
      <label>Kind<select id="np-hz">${HORIZONS.map((v) => `<option value="${v}"${guess.horizon === v ? ' selected' : ''}>${esc(HORIZON_WORDS[v])}</option>`).join('')}</select></label>
      <label>Instrument<select id="np-inst">${Object.entries(INSTRUMENT_WORDS).map(([v, w]) => `<option value="${v}"${guess.instrument === v ? ' selected' : ''}>${w}</option>`).join('')}</select></label>
      <label class="qtyf">
        <span class="qtyhead">Quantity<button type="button" class="unit" id="np-unit" data-unit="shares">shares</button></span>
        <input id="np-qty" class="num" inputmode="decimal" value="">
      </label>
      <label><span id="np-entry-k">Entry</span><input id="np-entry" class="num" inputmode="decimal" value="${esc(guess.entry)}"></label>
      <label>Stop<input id="np-stop" class="num" inputmode="decimal" value="${esc(guess.stop)}"></label>
      <label>Target<input id="np-target" class="num" inputmode="decimal" value="${esc(guess.target)}"></label>
    </div>
    <div class="grid2 optonly" id="np-opt" hidden>
      <label>Strike<input id="np-strike" class="num" inputmode="decimal" value="${esc(guess.strike)}"></label>
      <label class="sp2only">Second strike<input id="np-strike2" class="num" inputmode="decimal" value="${esc(guess.strike2)}"></label>
      <label>Expiration<input id="np-expiry" type="date" value="${esc(guess.expiry)}"></label>
      <label class="sp2only">Calls or puts<select id="np-legs">${[['', 'not said'], ['call', 'Calls'], ['put', 'Puts']].map(([v, w]) => `<option value="${v}"${guess.optionType === v ? ' selected' : ''}>${w}</option>`).join('')}</select></label>
      <label class="check sp2only"><input type="checkbox" id="np-credit"${guess.credit ? ' checked' : ''}> Credit spread</label>
    </div>
    <label>What it is<input id="np-structure" value="${esc(guess.structure)}" placeholder="shares, or the contract"></label>
    <div class="row" style="margin-bottom:8px"><button type="button" class="btn tiny quiet" id="np-last">Get the price</button><span class="said" id="np-said"></span></div>
    <div class="riskline" id="np-risk"></div>
    <button type="button" class="btn tall wide primary" id="np-go">Save the position</button>
    <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
  const f = (id) => sheet.querySelector(id);
  /**
   * DOLLARS OR SHARES (Eric, 2026-09-22: "It should have an option for
   * fractional shares. So essentially it changes dollars to shares").
   *
   * One field, one chip. On `shares` the number is a share count and may be
   * fractional. On `$` it is what he is putting in, and the share count is
   * that over the entry price. Contracts cannot be bought in pieces, so the
   * chip is not offered on a call, a put or a spread, and the field goes back
   * to whole contracts the moment the instrument changes.
   *
   * Which unit he last used is remembered, because a person who sizes in
   * dollars sizes in dollars every time.
   */
  const UNIT_KEY = 'pa-desk-qty-unit';
  const unitEl = f('#np-unit');
  const isShares = () => f('#np-inst').value === 'stock';
  let unit = isShares() && localStorage.getItem(UNIT_KEY) === 'dollars' ? 'dollars' : 'shares';
  const entryNow = () => Number(f('#np-entry').value.trim());
  // What goes to the server is always a share or contract count.
  const qtyTyped = () => {
    const typed = Number(f('#np-qty').value);
    if (!Number.isFinite(typed) || typed <= 0) return 0;
    if (unit !== 'dollars' || !isShares()) return typed;
    return sharesForDollars(typed, entryNow()) ?? 0;
  };
  // Whether a field is even asked for depends on what he picked (2026-09-22).
  // Shares want no strike; a single option wants one strike and no second leg;
  // a spread wants both, which way round and whether it is a credit.
  const paintUnit = () => {
    const stock = isShares();
    const inst = f('#np-inst').value;
    if (!stock) unit = 'shares';
    unitEl.hidden = !stock;
    unitEl.dataset.unit = unit;
    unitEl.textContent = unit === 'dollars' ? '$' : (stock ? 'shares' : 'contracts');
    f('#np-qty').setAttribute('inputmode', stock ? 'decimal' : 'numeric');
    f('#np-opt').hidden = stock;
    for (const el of sheet.querySelectorAll('.sp2only')) el.hidden = inst !== 'spread';
    // Entry means three different things, so it says which one.
    f('#np-entry-k').textContent = stock ? 'Entry' : inst === 'spread' ? 'Debit or credit' : 'Premium';
    // "What it is" writes itself from the fields, unless he has typed over it.
    const st = f('#np-structure');
    if (!st.dataset.touched) st.value = vehicleLabel({ ...read(), instrument: inst });
  };
  unitEl.addEventListener('click', () => {
    if (!isShares()) return;
    const had = qtyTyped();                       // hold the position, change the unit
    unit = unit === 'dollars' ? 'shares' : 'dollars';
    try { localStorage.setItem(UNIT_KEY, unit); } catch { /* a private window is not a reason to fail */ }
    const e = entryNow();
    if (had > 0 && e > 0) {
      f('#np-qty').value = unit === 'dollars' ? String(dollarsForShares(had, e) ?? '') : String(fmtQty(had));
    }
    paintUnit();
    calc();
  });
  const read = () => ({
    ticker: f('#np-tk').value.toUpperCase().trim(),
    side: f('#np-side').value, horizon: f('#np-hz').value, instrument: f('#np-inst').value,
    qty: qtyTyped(), entry: f('#np-entry').value.trim(),
    stop: f('#np-stop').value.trim(), target: f('#np-target').value.trim(),
    structure: f('#np-structure').value.trim(),
    strike: f('#np-strike').value.trim(), strike2: f('#np-strike2').value.trim(),
    expiry: f('#np-expiry').value.trim(), optionType: f('#np-legs').value,
    credit: f('#np-credit').checked,
  });
  const calc = () => {
    const v = read();
    const box = f('#np-risk');
    const rules = rulesNow();
    const accountCents = accountNow();
    const entry = Number(v.entry); const stop = Number(v.stop);
    if (!entry || !stop) { box.classList.remove('over'); box.innerHTML = '<span class="dim">An entry and a stop, and the risk appears here.</span>'; return; }
    const pos = { ...v, qty: v.qty || 1 };
    const c = tradeCalc({ pos, rules, accountCents });
    const size = sizeFor({ accountCents, rules, pos });
    const allowed = Math.round((accountCents * rules.riskPct) / 100);
    box.classList.toggle('over', (c.riskCents ?? 0) > allowed);
    const word = v.instrument === 'stock' ? 'shares' : 'contracts';
    // In dollars, the line says what that money actually buys, because the
    // number in the box is no longer the number he is holding.
    const bought = unit === 'dollars' && isShares() && v.qty > 0
      ? ` · buys ${fmtQty(v.qty)} shares` : '';
    box.innerHTML = `<b>Risk ${money(c.riskCents ?? 0)}</b> <span class="dim">of ${money(allowed)} allowed${bought} · your size is ${size.qty == null ? '?' : fmtQty(size.qty)} ${word}${c.ladder ? ` · 1R ${c.ladder.levels[0].price}` : ''}</span>`;
  };
  f('#np-structure').addEventListener('input', (e) => { e.currentTarget.dataset.touched = '1'; });
  for (const i of sheet.querySelectorAll('input, select')) i.addEventListener('input', calc);
  for (const i of sheet.querySelectorAll('#np-opt input, #np-opt select')) i.addEventListener('input', paintUnit);
  f('#np-legs').addEventListener('change', paintUnit);
  if (play) {
    // THE LESSER OF THE TWO (2026-09-22). The play suggests an allocation and
    // his rule caps the risk; the box opens on whichever is smaller, because a
    // suggestion does not get to break Rules to hold. A stock opens in dollars,
    // which is what he types at a broker.
    // In whichever unit he last chose. Taking a play is not a reason to change
    // how he sizes, and silently rewriting his remembered choice would.
    const sz = playSizing({ play, rules: rulesNow(), accountCents: accountNow() });
    f('#np-qty').value = sz.takeQty
      ? String(unit === 'dollars' && guess.instrument === 'stock'
        ? (dollarsForShares(sz.takeQty, Number(guess.entry)) ?? '')
        : fmtQty(sz.takeQty))
      : '';
  }
  f('#np-inst').addEventListener('change', () => { paintUnit(); calc(); });
  paintUnit();
  calc();
  f('#np-last').addEventListener('click', (e) => busy(e.currentTarget, 'Reading…', async () => {
    const tk = f('#np-tk').value.toUpperCase().trim();
    if (!tk) { say(f('#np-said'), 'A ticker first.'); return; }
    try {
      const out = await call(`quote?symbols=${encodeURIComponent(tk)}`);
      const q = (out.quotes || [])[0];
      if (!q) { say(f('#np-said'), 'No price came back for that one.'); return; }
      f('#np-entry').value = String(q.last);
      say(f('#np-said'), `${q.last}, today ${q.low} to ${q.high}.`);
      calc();
    } catch (err) { say(f('#np-said'), err.message); }
  }));
  f('#np-go').addEventListener('click', (e) => busy(e.currentTarget, 'Saving…', async () => {
    const v = read();
    try {
      const out = await call('position', { ...v, ...(play ? { fromPlay: play.id } : {}) });
      navigator.vibrate?.(10);
      await close();
      await loadPositions();
      if (play) await reloadPlays();
      show('positions');
      setTimeout(() => {
        const el = $(`[data-pos="${out.position.id}"]`);
        el?.classList.add('new');
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 220);
    } catch (err) { say(f('#np-said'), err.message); }
  }));
}
function openCloseSheet(p) {
  const guess = p.calc?.unrealizedCents;
  const { sheet, close } = openSheet(`
    <h3>Close ${esc(p.ticker)} ${esc(p.side)}</h3>
    <div class="sum">${esc(p.instrument === 'stock' ? `${fmtQty(p.qty)} sh` : `${fmtQty(p.qty)} × ${p.structure || p.instrument}`)} at ${esc(p.entry)}${p.stop == null ? '' : ` · stop ${esc(p.stop)}`}</div>
    <label>The return, in dollars (plus or minus)<input id="cl-pl" class="num" inputmode="decimal" value="${Number.isFinite(guess) ? (guess / 100).toFixed(2) : ''}"></label>
    <label>Or the price you got out at<input id="cl-px" class="num" inputmode="decimal" placeholder="optional"></label>
    <label>Note<input id="cl-note" placeholder="optional"></label>
    <label class="check"><input type="checkbox" checked id="cl-log"> Put a line in the log</label>
    <div class="stack"><button type="button" class="btn tall wide ${(guess ?? 0) >= 0 ? 'good' : 'bad'}" id="cl-go">Close Position</button><p class="said" id="cl-said" style="margin:0"></p><button type="button" class="btn quiet wide" data-x>Cancel</button></div>`);
  const pl = sheet.querySelector('#cl-pl');
  const go = sheet.querySelector('#cl-go');
  pl.addEventListener('input', () => {
    const v = Number(pl.value);
    if (!Number.isFinite(v) || pl.value.trim() === '') return;
    go.classList.toggle('good', v >= 0);
    go.classList.toggle('bad', v < 0);
  });
  go.addEventListener('click', async () => {
    const px = sheet.querySelector('#cl-px').value.trim();
    const v = Number(pl.value);
    if (!px && (!Number.isFinite(v) || pl.value.trim() === '')) { say(sheet.querySelector('#cl-said'), 'The return in dollars, for example -45 or 28, or the price you got out at.'); return; }
    go.classList.add('filled');
    navigator.vibrate?.(10);
    const body = px ? { id: p.id, exitPrice: px } : { id: p.id, pnlCents: Math.round(v * 100) };
    body.note = sheet.querySelector('#cl-note').value.trim();
    const log = sheet.querySelector('#cl-log').checked;
    try {
      const out = await call('close', body);
      await close();
      await runClose(p, out, log);
    } catch (err) { go.classList.remove('filled'); say(sheet.querySelector('#cl-said'), err.message); }
  });
}
/** The close has landed on the server. Everything after this is the celebration and the tidy up. */
async function runClose(p, out, log) {
  const card = $(`[data-pos="${p.id}"]`);
  const fromEl = card?.querySelector('.pnlrow .u') || card;
  const from = fromEl ? centerOf(fromEl) : { x: innerWidth / 2, y: innerHeight / 2 };
  const before = { real: dayNow().realizedTodayCents, bal: liveNow() };
  const after = { real: out.dayStatus.realizedTodayCents, bal: out.liveCents };
  // The store moves first, so a repaint from any other poll agrees with the
  // figure the animation is counting toward.
  S.positions = { ...S.positions, dayStatus: out.dayStatus, liveCents: out.liveCents };
  const pnl = out.pnlCents;
  const hold = pnl >= 0
    ? fx.profit({ from, before, after, pnl, aimCents: out.dayStatus.aimCents })
    : fx.loss({ from, before, after });
  if (log) writeLog(logLineFor(p, pnl, out.position.exitPrice)).catch(() => { /* the close stands whether or not the line lands */ });
  card?.classList.add('closing');
  setTimeout(() => {
    if (card) leaveCard(card, pnl < 0, () => { loadPositions(); loadHistory({ force: true }); });
    else { loadPositions(); loadHistory({ force: true }); }
  }, hold || 0);
}
/** A card leaving: it fades, then collapses, then whatever replaces it is painted. */
function leaveCard(card, drop, done) {
  card.classList.add('leaving');
  if (drop) card.classList.add('drop');
  const h = card.offsetHeight;
  let finished = false;
  const end = () => { if (!finished) { finished = true; done(); } };
  const collapse = () => {
    card.style.maxHeight = `${h}px`;
    void card.offsetHeight;
    card.classList.add('collapsing');
    card.addEventListener('transitionend', (e) => { if (e.propertyName === 'max-height') end(); }, { once: true });
  };
  card.addEventListener('transitionend', (e) => { if (e.propertyName === 'opacity') collapse(); }, { once: true });
  setTimeout(() => { if (card.isConnected && !card.classList.contains('collapsing')) collapse(); }, 340);
  setTimeout(end, 760);
}
function closedAtSheet(play) {
  const { sheet, close } = openSheet(`
    <h3>${esc(play.ticker)}, closed</h3>
    <div class="sum">What this one actually did, for the record. A play closed here is a note, not a trade: Stats counts positions.</div>
    <label>The return, in dollars (plus or minus)<input id="pc-v" class="num" inputmode="decimal"></label>
    <button type="button" class="btn tall wide primary" id="pc-go">Save it</button>
    <p class="said" id="pc-said" style="margin:8px 0 0"></p>
    <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
  sheet.querySelector('#pc-go').addEventListener('click', (e) => busy(e.currentTarget, 'Saving…', async () => {
    const v = Number(sheet.querySelector('#pc-v').value);
    if (!Number.isFinite(v)) { say(sheet.querySelector('#pc-said'), 'A figure in dollars, for example -45 or 28.'); return; }
    try {
      await call('play', { id: play.id, status: 'closed', outcomeCents: Math.round(v * 100) });
      await close();
      await reloadPlays();
    } catch (err) { say(sheet.querySelector('#pc-said'), err.message); }
  }));
}
function openBalanceSheet() {
  const today = S.positions?.today || S.state?.today || '';
  const { sheet, close } = openSheet(`
    <h3>Tonight's balance</h3>
    <div class="sum">Typed once a day after the close. Today reads ${money(liveNow())} from the closes so far.</div>
    <label>Balance, in dollars<input id="lb-v" class="num" inputmode="decimal" value="${(liveNow() / 100).toFixed(2)}"></label>
    <label>The day<input id="lb-d" type="date" value="${esc(today)}" max="${esc(today)}"></label>
    <label>Note<input id="lb-n" placeholder="optional"></label>
    <button type="button" class="btn tall wide primary" id="lb-go">Save the balance</button>
    <p class="said" id="lb-said" style="margin:8px 0 0"></p>
    <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
  sheet.querySelector('#lb-go').addEventListener('click', (e) => busy(e.currentTarget, 'Saving…', async () => {
    const v = Number(sheet.querySelector('#lb-v').value);
    if (!Number.isFinite(v) || v < 0) { say(sheet.querySelector('#lb-said'), 'The balance in dollars, for example 2450.'); return; }
    try {
      await call('balance', { date: sheet.querySelector('#lb-d').value, cents: Math.round(v * 100), note: sheet.querySelector('#lb-n').value.trim() });
      await close();
      await Promise.all([loadState(), loadPositions(), loadHistory({ force: true })]);
      toast('Balance saved.');
    } catch (err) { say(sheet.querySelector('#lb-said'), err.message); }
  }));
}
$('#new-pos').addEventListener('click', () => openPositionSheet(null));
$('#log-bal').addEventListener('click', openBalanceSheet);
$('#all-closes').addEventListener('click', () => { S.statsPage = 2; show('stats'); paintStats(); });
for (const b of $$('[data-go]')) b.addEventListener('click', () => show(b.dataset.go));

// ---- STATS ---------------------------------------------------------------------
const STATS_WORDS = ['How you are trading', 'By kind, by day, and the pace', 'Every close, newest first'];
let historyAt = 0;
async function loadHistory({ force = false } = {}) {
  if (!force && S.history && Date.now() - historyAt < 30_000) { paintStats(); return; }
  try {
    const out = await call('history');
    historyAt = Date.now();
    set('history', out);
  } catch (err) {
    if (!S.history) $('#st-body').innerHTML = `<div class="panel empty"><span>${esc(err.message)}</span></div>`;
  }
}
function chartPanel() {
  const chart = S.state?.chart;
  const aim = `${rulesNow().dayAimPct}%`;
  if (!chart || !chart.points?.length) return '<div class="panel empty"><span>The chart starts with your first typed balance.</span></div>';
  return `<div class="panel chart"><div id="chart">${deskChartSvg(chart, { aim })}</div>
    <div class="legend"><span><i class="a"></i>Your balance</span><span><i class="t"></i>${esc(aim)} a day from ${money(S.state?.settings?.startCents || 0)}</span></div></div>`;
}
function paintStats(dir = 0) {
  const h = S.history;
  const body = $('#st-body');
  if (!h) { body.innerHTML = '<div class="panel empty"><span>Reading your closes…</span></div>'; return; }
  if (!h.count) {
    body.innerHTML = '<div class="panel empty"><span>No closed trades yet. Stats start with the first close.</span></div>';
    $('#st-nav').hidden = true; $('#st-dots').hidden = true;
    $('#stats-sub').textContent = 'Nothing closed yet';
    return;
  }
  $('#st-nav').hidden = false; $('#st-dots').hidden = false;
  const page = S.statsPage;
  body.innerHTML = page === 0 ? statsOverviewHtml(h.stats)
    : page === 1 ? statsBreakdownHtml(h.stats, h.metrics, rulesNow()) + chartPanel()
      : statsClosesHtml(h.stats);
  body.classList.remove('slide-l', 'slide-r');
  if (dir) { void body.offsetWidth; body.classList.add(dir > 0 ? 'slide-l' : 'slide-r'); }
  for (const b of $$('[data-sp]')) b.classList.toggle('on', Number(b.dataset.sp) === page);
  $$('#st-dots i').forEach((d, i) => d.classList.toggle('on', i === page));
  $('#st-prev').disabled = page === 0;
  $('#st-next').disabled = page === 2;
  $('#stats-sub').textContent = `${STATS_WORDS[page]}${page === 0 ? `, ${h.count} close${h.count === 1 ? '' : 's'}` : ''}${h.capped ? ' (the newest 500)' : ''}`;
  try { localStorage.setItem(STATS_KEY, String(page)); } catch { /* blocked storage is not an error */ }
  if (page === 1) fx?.targetLine(lineState(), { fresh: true });
  if (page === 2) for (const el of body.querySelectorAll('[data-close]')) el.addEventListener('click', () => openCloseDetail(el.dataset.close));
  seedFlicker(body);
}
function statsGo(page, dir) {
  if (page < 0 || page > 2) return;
  S.statsPage = page;
  paintStats(dir);
}
function openCloseDetail(id) {
  const r = (S.history?.closed || []).find((x) => x.id === id);
  if (!r) return;
  const row = $(`.closes .r[data-close="${id}"]`);
  if (row) { row.classList.add('hit'); setTimeout(() => row.classList.remove('hit'), 600); }
  openSheet(`<h3>${esc(r.ticker)} ${esc(r.side)} · ${esc(HORIZON_WORDS[r.horizon] || '')}</h3>
    <div class="sum">${esc(dayName(r.closedDay))} ${esc(dayShort(r.closedDay))} · ${esc(r.instrument === 'stock' ? `${r.qty} sh` : `${r.qty} × ${r.structure || r.instrument}`)}</div>
    <div class="cells" style="grid-template-columns:repeat(3,1fr);margin:0 0 12px"><div><div class="k">Entry</div><div class="v">${esc(r.entry)}</div></div><div><div class="k">Stop</div><div class="v stop">${r.stop == null ? 'none' : esc(r.stop)}</div></div><div><div class="k">Exit</div><div class="v">${r.exitPrice == null ? 'not typed' : esc(r.exitPrice)}</div></div></div>
    <div class="tile" style="margin-bottom:12px"><div class="k">Result</div><div class="v ${r.pnlCents > 0 ? 'up' : r.pnlCents < 0 ? 'dn' : ''}">${money(r.pnlCents, true)}</div>${r.riskCents ? `<div class="sub">risk ${money(r.riskCents)} · ${Math.round((r.pnlCents / r.riskCents) * 10) / 10}R</div>` : ''}${r.closeNote ? `<div class="sub">${esc(r.closeNote)}</div>` : ''}</div>
    <button type="button" class="btn quiet wide" data-x>Close</button>`);
}
on(['history'], () => paintStats());
$('#st-prev').addEventListener('click', () => statsGo(S.statsPage - 1, -1));
$('#st-next').addEventListener('click', () => statsGo(S.statsPage + 1, 1));
for (const b of $$('[data-sp]')) b.addEventListener('click', () => statsGo(Number(b.dataset.sp), Number(b.dataset.sp) > S.statsPage ? 1 : -1));
{
  let x0 = 0; let y0 = 0;
  const pg = $('#pg-stats');
  pg.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; }, { passive: true });
  pg.addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - x0;
    const dy = e.changedTouches[0].clientY - y0;
    if (Math.abs(dx) > 50 && Math.abs(dy) < 40) statsGo(S.statsPage + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  }, { passive: true });
}

// ---- DESK: the reading, the stream and the one composer -------------------------
const STALL_MS = 5 * 60_000;
function paintReading() {
  const st = S.panel?.state || {};
  const running = st.status === 'running' || st.status === 'starting';
  const drawer = $('#drawer');
  drawer.setAttribute('aria-busy', running ? 'true' : 'false');
  $('#update').disabled = running;
  const stalled = running && st.progressAt && Date.now() - new Date(st.progressAt).getTime() > STALL_MS;
  $('#rd-when').textContent = running
    ? (stalled ? 'The reading stalled. Tap Update again.' : 'Reading the whole desk. It lands on its own.')
    : st.updatedAt ? `Reading · ${agoShort(st.updatedAt)}` : 'No reading yet';
  const pages = st.analysis ? splitPages(st.analysis) : [];
  $('#rd-list').textContent = pages.length ? pages.map((p) => p.title).join(' · ') : 'Tap Update for one';
  $('#reading').innerHTML = pages.length
    ? pages.map((p, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(p.title)}</summary><div class="body">${md(p.body)}</div></details>`).join('')
    : '<p class="dim small">Nothing read yet. Update reads the whole desk: your rules, your log, your positions and the tape.</p>';
  say('#desk-said', st.status === 'error' && st.error ? st.error : '');
}
async function loadQa() {
  try {
    const out = await call('qa');
    set('qa', out.qa || []);
  } catch { /* the panel's newest five carry the stream until this lands */ }
}
/** The desk's rows the stream draws from: the list route, with the poll's newest five over it. */
function qaRows() {
  const map = new Map();
  for (const q of S.qa) map.set(q.id, q);
  for (const q of S.panel?.qa || []) map.set(q.id, q);
  return [...map.values()];
}
function paintStream() {
  const rows = mergeStream(S.log, qaRows(), S.pending);
  const now = Date.now();
  $('#stream').innerHTML = rows.map((r) => streamRowHtml(r, {
    md,
    stalled: r.kind === 'question' && r.status === 'running' && Number.isFinite(r.at) && now - r.at > STALL_MS,
  })).join('');
  for (const b of $$('#stream [data-file]')) {
    b.addEventListener('click', () => { const u = b.dataset.file; if (u) window.open(u, '_blank', 'noopener'); });
  }
  seedFlicker($('#stream'));
  if (S.page === 'desk') requestAnimationFrame(() => window.scrollTo(0, document.body.scrollHeight));
}
function padStream() {
  const c = $('#composer');
  $('#pg-desk').style.paddingBottom = c.hidden ? '' : `${c.offsetHeight + 8}px`;
}
on(['log', 'qa', 'pending'], paintStream);
on(['panel'], paintStream);
on(['panel'], paintReading);

let modeOverride = null;
function paintMode() {
  const m = $('#mode');
  if (!m) return;
  const ask = modeOverride === null ? isQuestion($('#say').value) : modeOverride === 'ask';
  m.textContent = ask ? 'Ask' : 'Log';
  m.classList.toggle('ask', ask);
  m.setAttribute('aria-pressed', String(ask));
}
$('#say').addEventListener('input', () => {
  paintMode();
  const ta = $('#say');
  ta.style.height = 'auto';
  ta.style.height = `${Math.min(96, ta.scrollHeight)}px`;
  padStream();
});
$('#mode').addEventListener('click', () => { modeOverride = $('#mode').textContent === 'Ask' ? 'log' : 'ask'; paintMode(); });

// The screenshot rides whichever kind of line he is sending: a question carries
// it to the desk now, a log line files it for the next reading to read.
let attached = null;
$('#cam').addEventListener('click', () => $('#cam-file').click());
$('#cam-file').addEventListener('change', () => {
  const f = $('#cam-file').files[0];
  $('#cam-file').value = '';
  if (!f) return;
  if (!/^image\/(png|jpeg)$|^application\/pdf$/.test(f.type)) { say('#desk-said', `${f.name}: a PNG, a JPEG or a PDF.`); return; }
  if (f.size > 12 * 1024 * 1024) { say('#desk-said', `${f.name} is over 12 MB.`); return; }
  attached = f;
  $('#cam').classList.add('on');
  say('#desk-said', `Attached: ${f.name}`);
});
async function uploadInto(folder, f) {
  const clean = f.name.replace(/[^\w.-]+/g, '_').slice(0, 80);
  const storageRef = ref(storage, `cases/${S.deskId}/${folder}/${Date.now()}-${clean}`);
  const task = uploadBytesResumable(storageRef, f);
  await new Promise((resolve, reject) => { task.on('state_changed', null, reject, resolve); });
  const url = await getDownloadURL(storageRef);
  return { name: f.name, url, path: storageRef.fullPath, size: f.size, contentType: f.type || 'application/octet-stream' };
}
/** One line in the trade log, written the way the chat writes one, so the reading reads it unchanged. */
async function writeLog(text, attachment = null) {
  const messagesRef = collection(db, 'cases', S.deskId, 'chat');
  const row = { from: S.user.uid, role: 'admin', text, ts: serverTimestamp() };
  if (attachment) row.attachment = attachment;
  await addDoc(messagesRef, row);
  await updateDoc(doc(db, 'cases', S.deskId), {
    lastMessage: { text: (text || `File: ${attachment?.name || 'file'}`).slice(0, 120), from: S.user.uid, role: 'admin', ts: new Date(), emailed: true },
  }).catch(() => { /* the line is written; the pointer is furniture */ });
}
async function sendLine() {
  const box = $('#say');
  const text = box.value.trim();
  if (!text && !attached) return;
  const ask = $('#mode').textContent === 'Ask';
  const file = attached;
  box.value = '';
  box.style.height = 'auto';
  attached = null;
  $('#cam').classList.remove('on');
  modeOverride = null;
  paintMode();
  padStream();
  say('#desk-said', '');
  const give = () => { box.value = text; paintMode(); attached = file; if (file) $('#cam').classList.add('on'); };
  try {
    const attachment = file ? await uploadInto(ask ? 'ask-files' : 'chat-files', file) : null;
    if (!ask) { await writeLog(text || `Screenshot: ${attachment?.name || ''}`, attachment); return; }
    const local = { id: `local-${Date.now()}`, at: Date.now(), text };
    set('pending', [...S.pending, local]);
    const token = await getToken();
    const res = await fetch('/api/advisor', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'case', id: S.deskId, action: 'ask', question: text, ...(attachment ? { attachment } : {}) }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw new Error(out.error || `Failed (${res.status})`);
    kickPoll();
  } catch (err) {
    set('pending', S.pending.filter((p) => p.text !== text));
    say('#desk-said', err.message);
    give();
  }
}
$('#send').addEventListener('click', sendLine);
$('#say').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); sendLine(); } });
$('#update').addEventListener('click', async (e) => {
  e.preventDefault();
  say('#desk-said', '');
  try {
    const token = await getToken();
    const res = await fetch('/api/advisor', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'case', id: S.deskId, action: 'analyze' }),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok || out.error) throw new Error(out.error || `Failed (${res.status})`);
    $('#update').disabled = true;
    $('#drawer').setAttribute('aria-busy', 'true');
    $('#rd-when').textContent = 'Reading the whole desk. It lands on its own.';
    kickPoll();
  } catch (err) { say('#desk-said', err.message); }
});

// ---- SETTINGS -------------------------------------------------------------------
const RULE_ROWS = [
  ['riskPct', 'Risk a trade', '%'],
  ['dayLossPct', 'Day loss limit', '%'],
  ['dayFloorPct', 'Floor', '%'],
  ['dayAimPct', 'Aim', '%'],
  ['dayCapPct', 'Day gain cap', '%'],
  ['targetR', 'Target', 'R'],
];
const ruleSub = (k, v) => (k === 'targetR' ? 'against the stop'
  : `${v}% of the account · <span class="num">${money(Math.round((accountNow() * v) / 100))}</span>`);
function openSettings() {
  const ov = $('#overlay');
  const st = S.state || {};
  const pub = st.settings || {};
  const R = rulesNow();
  const sw = (k, on) => `<button type="button" class="sw${on ? ' on' : ''}" data-sw="${k}" aria-pressed="${on}" aria-label="${k}"></button>`;
  const rule = (k, name, unit) => `<div class="r rule"><span>${name}<span class="sub" data-sub="${k}">${ruleSub(k, R[k])}</span></span><span class="box"><input class="num" inputmode="decimal" value="${R[k]}" data-rule="${k}"><span>${unit}</span></span></div>`;
  ov.innerHTML = `<div class="settings"><div class="head"><h1>SETTINGS</h1><button type="button" class="btn tiny primary done" data-x>Done</button></div><div class="wrap stack">
    <div><h2>Account</h2><div class="grp">
      <div class="r">Type<span class="seg" style="margin-left:auto" id="acct-seg"><button type="button" data-at="cash"${pub.accountType !== 'margin' ? ' class="on"' : ''}>Cash</button><button type="button" data-at="margin"${pub.accountType === 'margin' ? ' class="on"' : ''}>Margin</button></span></div>
      <div class="r rule"><span>Starting amount<span class="sub">what the chart measures from</span></span><span class="box"><span style="padding-left:10px">$</span><input class="num" inputmode="decimal" id="set-start" value="${((pub.startCents || 0) / 100).toFixed(2)}"></span></div>
      <div class="r rule"><span>Started on</span><span class="box"><input type="date" id="set-startedAt" value="${esc(pub.startedAt || '')}"></span></div>
      <button type="button" class="r" id="bal-hist">Balance history<span class="v">${(st.balances || []).length} entr${(st.balances || []).length === 1 ? 'y' : 'ies'}</span><span class="chev">&rsaquo;</span></button>
    </div><p class="said" id="set-acct-said"></p></div>
    <div><h2>Rules</h2><div class="grp">${RULE_ROWS.map(([k, n, u]) => rule(k, n, u)).join('')}</div><p class="said" id="set-rule-said"></p></div>
    <div><h2>Market data</h2><div class="grp">
      <div class="r"><span>Price key<span class="sub num" id="key-sub">${st.hasKey ? `on file · ends ${esc(st.keyTail || '')}` : 'none on file'}</span></span><button type="button" class="btn tiny quiet" style="margin-left:auto" id="key-go">${st.hasKey ? 'Replace' : 'Add'}</button></div>
      <div class="r" style="display:block"><span>Watchlist</span><div class="watch" id="watch-chips">${(pub.watchlist || []).map((t) => `<span class="chip tap">${esc(t)}</span>`).join('')}</div><button type="button" class="btn tiny quiet" id="watch-go" style="margin-top:10px">Edit the watchlist</button></div>
    </div><p class="said" id="set-key-said"></p></div>
    <div><h2>Alerts and effects</h2><div class="grp">
      <div class="r"><span>Pushes<span class="sub">A push when a scan finds a strong play.</span></span>${sw('pushOn', pub.pushOn !== false)}</div>
      <div class="r"><span>Celebrations<span class="sub">The close effects, the target line and the particles.</span></span>${sw('celebrate', pub.celebrate !== false)}</div>
      <div class="r"><span>Reduce effects<span class="sub">No particles, shake or sweeps; flashes shortened.</span></span>${sw('reduceFx', pub.reduceFx === true)}</div>
    </div><p class="said" id="set-sw-said"></p></div>
    <div><h2>Files</h2><div class="grp" id="set-files"><div class="r dim">Reading the shelf…</div></div></div>
    <div><h2>Glossary</h2><div class="grp"><div class="r"><input id="gl-q" placeholder="Search the terms"></div><div id="gl-list"></div></div></div>
    <div><h2>The desk</h2><div class="grp">
      <button type="button" class="r" id="desk-close">${S.closed ? 'This desk is closed' : 'Close the desk'}<span class="chev">&rsaquo;</span></button>
      <button type="button" class="r danger" id="desk-delete">Delete the desk<span class="chev">&rsaquo;</span></button>
    </div><p class="said" id="set-desk-said"></p></div>
    <p class="foot">Version ${esc(VERSION)}</p>
  </div></div>`;
  const onEsc = (e) => { if (e.key === 'Escape') closeAll(); };
  const closeAll = () => { ov.innerHTML = ''; document.removeEventListener('keydown', onEsc); };
  for (const x of ov.querySelectorAll('[data-x]')) x.addEventListener('click', closeAll);
  document.addEventListener('keydown', onEsc);

  const save = async (body, saidSel) => {
    say(saidSel, 'Saving…');
    try {
      const out = await call('settings', body);
      set('state', { ...S.state, settings: out.settings, hasKey: out.hasKey, keyTail: out.keyTail });
      say(saidSel, 'Saved.');
      return out;
    } catch (err) { say(saidSel, err.message); return null; }
  };
  for (const b of ov.querySelectorAll('#acct-seg button')) {
    b.addEventListener('click', async () => {
      const out = await save({ accountType: b.dataset.at }, '#set-acct-said');
      if (out) for (const x of ov.querySelectorAll('#acct-seg button')) x.classList.toggle('on', x === b);
    });
  }
  ov.querySelector('#set-start').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 1) { say('#set-acct-said', 'A starting amount in dollars, for example 2000.'); return; }
    save({ startCents: Math.round(v * 100) }, '#set-acct-said');
  });
  ov.querySelector('#set-startedAt').addEventListener('change', (e) => save({ startedAt: e.target.value }, '#set-acct-said'));
  for (const i of ov.querySelectorAll('[data-rule]')) {
    i.addEventListener('change', async () => {
      const k = i.dataset.rule;
      const v = Number(i.value);
      const [lo, hi] = RULE_RANGES[k] || [0, 100];
      if (!Number.isFinite(v) || v < lo || v > hi) { say('#set-rule-said', `${k} sits between ${lo} and ${hi}.`); return; }
      const out = await save({ rules: { ...rulesNow(), [k]: v } }, '#set-rule-said');
      if (!out) return;
      const R2 = rulesOf({ rules: out.settings.rules });
      for (const [kk] of RULE_ROWS) {
        const sub = ov.querySelector(`[data-sub="${kk}"]`);
        if (sub) sub.innerHTML = ruleSub(kk, R2[kk]);
      }
      loadPositions();
    });
  }
  ov.querySelector('#key-go').addEventListener('click', () => {
    const { sheet, close } = openSheet(`<h3>Price key</h3><div class="sum">It is stored on the Worker and never comes back to this page. Only its last four digits are ever shown.</div>
      <label>The key<input id="kk" autocomplete="off"></label>
      <button type="button" class="btn tall wide primary" id="kk-go">Save the key</button>
      <p class="said" id="kk-said" style="margin:8px 0 0"></p>
      <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
    sheet.querySelector('#kk-go').addEventListener('click', (e) => busy(e.currentTarget, 'Saving…', async () => {
      try {
        const out = await call('settings', { finnhubKey: sheet.querySelector('#kk').value.trim() });
        set('state', { ...S.state, settings: out.settings, hasKey: out.hasKey, keyTail: out.keyTail });
        ov.querySelector('#key-sub').textContent = out.hasKey ? `on file · ends ${out.keyTail}` : 'none on file';
        await close();
      } catch (err) { say(sheet.querySelector('#kk-said'), err.message); }
    }));
  });
  ov.querySelector('#watch-go').addEventListener('click', () => {
    const { sheet, close } = openSheet(`<h3>Watchlist</h3><div class="sum">The tickers the readings and the headlines are pinned to.</div>
      <label>Tickers, separated by spaces<textarea id="wl" rows="3">${esc((S.state?.settings?.watchlist || []).join(' '))}</textarea></label>
      <button type="button" class="btn tall wide primary" id="wl-go">Save the watchlist</button>
      <p class="said" id="wl-said" style="margin:8px 0 0"></p>
      <button type="button" class="btn quiet wide" data-x style="margin-top:8px">Cancel</button>`);
    sheet.querySelector('#wl-go').addEventListener('click', (e) => busy(e.currentTarget, 'Saving…', async () => {
      const out = await save({ watchlist: sheet.querySelector('#wl').value }, '#set-key-said');
      if (!out) { say(sheet.querySelector('#wl-said'), 'Six letters at most for each one, and no more than the list allows.'); return; }
      ov.querySelector('#watch-chips').innerHTML = (out.settings.watchlist || []).map((t) => `<span class="chip tap">${esc(t)}</span>`).join('');
      await close();
    }));
  });
  for (const b of ov.querySelectorAll('[data-sw]')) {
    b.addEventListener('click', async () => {
      const on = !b.classList.contains('on');
      const out = await save({ [b.dataset.sw]: on }, '#set-sw-said');
      if (!out) return;
      const now = out.settings[b.dataset.sw] === true || (b.dataset.sw === 'pushOn' && out.settings.pushOn !== false) || (b.dataset.sw === 'celebrate' && out.settings.celebrate !== false);
      b.classList.toggle('on', now);
      b.setAttribute('aria-pressed', String(now));
      fx.applyReduce();
    });
  }
  ov.querySelector('#bal-hist').addEventListener('click', openBalanceHistory);
  ov.querySelector('#desk-close').addEventListener('click', () => {
    if (S.closed) return;
    const { close } = openInner(`<h3>Close the desk?</h3><div class="sum">It stays readable, the readings stop, and nothing is sent to anyone.</div>
      <button type="button" class="btn tall wide bad" id="dc-go">Close the desk</button>
      <button type="button" class="btn quiet wide" style="margin-top:8px" data-y>Keep it open</button>`);
    $('#dc-go').addEventListener('click', (e) => busy(e.currentTarget, 'Closing…', async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/admin/close-case', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ caseId: S.deskId, reason: 'the trade desk' }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
        close();
        location.reload();
      } catch (err) { say('#set-desk-said', err.message); close(); }
    }));
  });
  ov.querySelector('#desk-delete').addEventListener('click', () => {
    const { close } = openInner(`<h3>Delete the desk?</h3><div class="sum">Every play, position, balance and log line goes with it. This cannot be undone.</div>
      <button type="button" class="btn tall wide bad" id="dd-go">Delete the desk</button>
      <button type="button" class="btn quiet wide" style="margin-top:8px" data-y>Cancel</button>`);
    $('#dd-go').addEventListener('click', (e) => busy(e.currentTarget, 'Deleting…', async () => {
      try {
        const token = await getToken();
        const res = await fetch('/api/admin/delete-case', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ caseId: S.deskId }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
        location.href = '/admin.html';
      } catch (err) { say('#set-desk-said', err.message); close(); }
    }));
  });
  paintGlossary();
  ov.querySelector('#gl-q').addEventListener('input', paintGlossary);
  loadFiles();
}
function paintGlossary() {
  const box = $('#gl-list');
  if (!box) return;
  const q = ($('#gl-q')?.value || '').toLowerCase().trim();
  const rows = (S.glossary || []).filter((g) => !q || `${g.term} ${g.definition}`.toLowerCase().includes(q)).slice(0, 60);
  box.innerHTML = rows.length
    ? rows.map((g) => `<div class="r"><span>${esc(g.term)}<span class="sub">${esc(g.definition)}</span></span></div>`).join('')
    : `<div class="r dim">${(S.glossary || []).length ? 'Nothing matches that.' : 'The readings have not taught a term yet.'}</div>`;
}
const FILE_FOLDERS = ['report', 'chat-files', 'ask-files', 'uploads'];
async function loadFiles() {
  const box = $('#set-files');
  if (!box) return;
  try {
    const per = await Promise.all(FILE_FOLDERS.map(async (folder) => {
      const res = await listAll(ref(storage, `cases/${S.deskId}/${folder}`)).catch(() => ({ items: [] }));
      return Promise.all(res.items.map(async (item) => {
        const [url, meta] = await Promise.all([getDownloadURL(item), getMetadata(item)]);
        return { name: meta.customMetadata?.paName || item.name, url, path: item.fullPath, at: new Date(meta.timeCreated) };
      }));
    }));
    const rows = per.flat().sort((a, b) => b.at - a.at).slice(0, 40);
    set('files', rows);
    if (!$('#set-files')) return;
    $('#set-files').innerHTML = rows.length
      ? rows.map((r) => `<div class="r"><button type="button" class="open" data-open="${esc(r.url)}" style="text-align:left;flex:1;min-width:0">${esc(r.name)}<span class="sub">${esc(dayShort(r.at.toISOString().slice(0, 10)))}</span></button><button type="button" class="btn tiny quiet" data-del="${esc(r.path)}">Delete</button></div>`).join('')
      : '<div class="r dim">Nothing filed yet.</div>';
    for (const b of $$('#set-files [data-open]')) b.addEventListener('click', () => window.open(b.dataset.open, '_blank', 'noopener'));
    for (const b of $$('#set-files [data-del]')) {
      b.addEventListener('click', (e) => busy(e.currentTarget, 'Deleting…', async () => {
        try { await deleteObject(ref(storage, b.dataset.del)); await loadFiles(); } catch (err) { toast(err.message); }
      }));
    }
    markSeen(S.deskId, 'files');
  } catch (err) {
    if ($('#set-files')) $('#set-files').innerHTML = `<div class="r dim">${esc(err.message)}</div>`;
  }
}
function openBalanceHistory() {
  const rows = [...(S.state?.balances || [])].reverse();
  const { box, close } = openInner(`<h3>Balance history</h3>
    <div class="panel closed" style="padding:0 14px;margin-bottom:12px;max-height:50vh;overflow:auto">${rows.length ? rows.map((b) => `<div class="r"><span>${esc(dayShort(b.date))}${b.source === 'typed' ? '' : ' <span class="dim small">from a screenshot</span>'}</span><span class="v">${money(b.cents)}</span><button type="button" class="btn tiny quiet" data-bal-del="${esc(b.date)}" style="margin-left:10px">Delete</button></div>`).join('') : '<div class="r dim">Nothing typed yet.</div>'}</div>
    <button type="button" class="btn quiet wide" data-y>Close</button>`);
  for (const b of box.querySelectorAll('[data-bal-del]')) {
    b.addEventListener('click', (e) => busy(e.currentTarget, 'Deleting…', async () => {
      try {
        await call('balance', { date: b.dataset.balDel, remove: true });
        await Promise.all([loadState(), loadPositions()]);
        close();
      } catch (err) { toast(err.message); }
    }));
  }
}
$('#cog').addEventListener('click', openSettings);

// ---- the polls ------------------------------------------------------------------
//
// One loop, at the panel's own cadence: half a minute when nothing is in the
// air, two and a half seconds while an Update, a Scan or a question is. The
// Worker's state route polls the scan's flight for us while a scan runs, so a
// scan lands on whichever page is open without anything else being tapped.
let fx = null;
let pollTimer = 0;
let polling = false;
const busyNow = () => {
  const st = S.panel?.state || {};
  return st.status === 'running' || st.status === 'starting'
    || scanNow().status === 'running'
    || (S.panel?.qa || []).some((q) => q.status === 'running')
    || S.pending.length > 0;
};
function schedule() {
  clearTimeout(pollTimer);
  if (document.hidden) return;
  pollTimer = setTimeout(pollOnce, busyNow() ? 2500 : 30_000);
}
function kickPoll() { clearTimeout(pollTimer); pollTimer = setTimeout(pollOnce, 500); }
async function pollOnce() {
  if (polling) { schedule(); return; }
  polling = true;
  try {
    const token = await getToken();
    const res = await fetch(`/api/advisor/state?kind=case&id=${encodeURIComponent(S.deskId)}`, { headers: { authorization: `Bearer ${token}` } });
    if (res.ok) {
      const out = await res.json();
      const wasScanning = scanNow().status === 'running';
      const wasReading = ['running', 'starting'].includes(S.panel?.state?.status);
      const wasAsking = new Set((S.panel?.qa || []).filter((q) => q.status === 'running').map((q) => q.id));
      set('glossary', out.glossary || []);
      set('panel', { state: out.state || {}, trade: out.trade || null, qa: out.qa || [] });
      if (out.trade?.plays) set('plays', out.trade.plays);
      // A question that has come home: the stream wants the whole list back,
      // because the poll only ever carries the newest five.
      const landed = (out.qa || []).some((q) => wasAsking.has(q.id) && q.status !== 'running');
      if (landed) loadQa();
      // A local row the server now has: drop it, or the same question shows twice.
      if (S.pending.length) {
        const known = new Set((out.qa || []).map((q) => String(q.question || '').trim()));
        const left = S.pending.filter((p) => !known.has(String(p.text || '').trim()));
        if (left.length !== S.pending.length) set('pending', left);
      }
      if (wasScanning && scanNow().status !== 'running') {
        $('#scan').classList.add('landed');
        setTimeout(() => $('#scan').classList.remove('landed'), 700);
        loadPositions();
      }
      if (wasReading && !['running', 'starting'].includes(out.state?.status)) {
        const d = $('#drawer');
        d.classList.add('landed');
        d.open = true;
        setTimeout(() => d.classList.remove('landed'), 800);
      }
    }
  } catch { /* the next tick tries again */ } finally {
    polling = false;
    schedule();
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) { kickPoll(); if (S.page === 'plays' || S.page === 'positions') loadPositions(); } else clearTimeout(pollTimer); });
setInterval(() => {
  if (document.hidden) return;
  if (S.page === 'plays' || S.page === 'positions') loadPositions();
  if (S.page === 'plays') paintMarket();
}, 60_000);
addEventListener('resize', placeInd);
addEventListener('hashchange', () => { const h = location.hash.slice(1); if (PAGES.includes(h) && h !== S.page) show(h, { push: false }); });

async function loadState() {
  const out = await call('state');
  set('state', out);
  if (out.plays) set('plays', out.plays);
  return out;
}
async function reloadPlays() { try { const out = await call('state'); set('state', out); set('plays', out.plays || []); } catch { /* the poll carries them */ } }

// ---- the door, when no desk is open ----------------------------------------------
function paintDoor(said = '') {
  $('#boot')?.remove();
  const app = $('#app');
  app.hidden = false;
  app.innerHTML = `<section class="page in"><header class="title"><div><h1 class="pt fl">TRADE DESK</h1><p class="ps">Nothing is open yet.</p></div></header>
    <div class="panel empty"><span>One tap opens the desk and walks in.</span><button type="button" class="btn primary tall" id="door-go">Open the desk</button><p class="said" id="door-said">${esc(said)}</p></div></section>`;
  $('#door-go').addEventListener('click', (e) => busy(e.currentTarget, 'Opening…', async () => {
    try {
      const token = await getToken();
      const res = await fetch('/api/admin/trade/open', {
        method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: '{}',
      });
      const out = await res.json().catch(() => ({}));
      const id = res.ok ? out.id : (res.status === 409 && out.existing ? out.existing : null);
      if (!id) throw new Error(out.error || `Failed (${res.status})`);
      location.href = `/admin-desk.html?id=${encodeURIComponent(id)}`;
    } catch (err) { say('#door-said', err.message); }
  }));
}

// ---- boot -------------------------------------------------------------------------
(async () => {
  const user = await requireAdmin();
  if (!user) return;
  S.user = user;
  try { S.statsPage = Math.min(2, Math.max(0, Number(localStorage.getItem(STATS_KEY)) || 0)); } catch { /* blocked storage is not an error */ }
  let st = null;
  try { st = await loadState(); } catch (err) {
    $('#boot').textContent = err.message;
    return;
  }
  if (!st.caseId) { paintDoor(); return; }
  S.deskId = st.caseId;
  const snap = await getDoc(doc(db, 'cases', S.deskId)).catch(() => null);
  S.closed = !!(snap?.exists?.() && snap.data()?.status === 'closed');
  // The log, live. Newest two hundred, oldest first once they are here, which
  // is the order a conversation reads in.
  onSnapshot(query(collection(db, 'cases', S.deskId, 'chat'), orderBy('ts', 'desc'), limit(200)), (rows) => {
    set('log', rows.docs.map((d) => ({ id: d.id, ...d.data() })).reverse());
  }, () => { /* an offline snapshot listener retries by itself */ });

  fx = createFx({
    money,
    state: () => ({ celebrate: S.state?.settings?.celebrate !== false, reduceFx: S.state?.settings?.reduceFx === true }),
    onDay: (opts) => paintDay(opts),
    emitters: [
      ['#scan-go', 'blue'], ['#bar button.on', 'blue'], ['.tile.hero .v', 'green'],
      ['#send', 'blue'], ['#stream .msg.desk.latest', 'green'],
      ['.page:not([hidden]) .pt', 'blue'], ['#day-real', 'green'],
    ],
  });

  $('#boot').remove();
  $('#app').hidden = false;
  $('#bar').hidden = false;
  // A closed desk opens read only: the box goes, the sentence stays where it
  // was, and Update has nothing to read for.
  if (S.closed) {
    $('#composer').innerHTML = '<div class="hint">This desk is closed. It opens read only.</div>';
    $('#update').disabled = true;
  }
  paintScan(); paintNote(); paintPlays(); paintReading(); paintStream(); paintMode();
  let start = 'plays';
  try { start = location.hash.slice(1) || localStorage.getItem(PAGE_KEY) || 'plays'; } catch { /* blocked storage is not an error */ }
  show(start, { push: false });
  fx.start();
  fx.targetLine(lineState(), { fresh: true });
  loadPositions();
  pollOnce();
  if (S.closed) toast('This desk is closed. It opens read only.');
})();
