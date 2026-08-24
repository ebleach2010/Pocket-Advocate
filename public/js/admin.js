// Admin case list: every case, status badges, and the "report due in N days"
// countdown that keeps the 7-day SLA from silently slipping (SPEC §F).

import './admin-ledger.js';
import { db, collection, getDocs } from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';
import { initPushPrompt } from './push.js';
import { folderCardHtml, wireFolderOpen, wireDxLongPress, openDxSheet } from './drawer.js';
import { unseenBadges } from './seen.js';

const MOUNTAIN_TZ = 'Etc/GMT+7';

hydrateNav();
const user = await requireAdmin();
if (user) load();

/**
 * The covers, in one call. caseMeta is Worker-only by rule: a case doc is
 * client-readable and a working diagnosis is Eric's private material, never
 * something a patient should find on their own record.
 */
async function loadCovers() {
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/advisor/covers', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return {};
    return (await res.json()).covers || {};
  } catch { return {}; }   // a shelf with no covers is still a usable shelf
}

/** Eric's own read of a case, typed onto the front of the folder. */
async function overrideDx(id, current) {
  const next = await openDxSheet(current);
  if (next === undefined) return;      // backed out; '' means hand it back
  const text = next.slice(0, 120);
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/advisor', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'case', id, action: 'dx', text }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Failed (${res.status})`);
    load();
  } catch (err) { alert(err.message); }
}

async function load() {
  const listEl = document.getElementById('list');
  initPushPrompt(user, document.querySelector('main')).catch(() => {});
  let cases = [];
  try {
    const snapshot = await getDocs(collection(db, 'cases'));
    snapshot.forEach((d) => cases.push({ id: d.id, ...d.data() }));
  } catch (err) {
    listEl.innerHTML = `<p class="error">Couldn't load cases: ${err.message}</p>`;
    return;
  }
  if (!cases.length) {
    listEl.innerHTML = '<p class="dim">No clients yet. They appear here the moment a payment lands.</p>';
    return;
  }

  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, month: 'short', day: 'numeric', year: 'numeric',
  });
  const now = Date.now();

  // Three shelves (Eric, 2026-07-15): current clients (call happened, report
  // phase) on top, future booked calls next, former (closed) at the bottom.
  const former = cases.filter((c) => c.status === 'closed');
  const future = cases.filter((c) =>
    c.status !== 'closed' && c.appointment?.start && toDate(c.appointment.start).getTime() > now);
  const current = cases.filter((c) => !former.includes(c) && !future.includes(c));
  current.sort((a, b) => toDate(a.reportDueAt || 0) - toDate(b.reportDueAt || 0));
  future.sort((a, b) => toDate(a.appointment?.start) - toDate(b.appointment?.start));
  former.sort((a, b) => toDate(b.closedAt || 0) - toDate(a.closedAt || 0));
  // Money at a glance: every case is created by a confirmed Stripe payment,
  // so the sum of amountTotal IS confirmed case revenue. Subscriptions renew
  // monthly inside Stripe — the dashboard there is the source of truth.
  const covers = await loadCovers();
  const cents = cases.reduce((sum, c) =>
    sum + (c.stripe?.amountTotal || 0) +
    (Array.isArray(c.extraPayments) ? c.extraPayments.reduce((x, p) => x + (p.amountCents || 0), 0) : 0), 0);
  // What a case costs right now. It rises by $10 on every completed booking,
  // silently, so this is the only place the current number is stated.
  let rate = null;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/rates', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.ok) rate = await res.json();
  } catch { /* the shelf is still a shelf without it */ }

  // The nightly voice study. It runs on its own; this is the switch and the
  // proof it is still running.
  let voice = null;
  try {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/voice', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: '{}',
    });
    if (res.ok) voice = await res.json();
  } catch { /* same */ }
  const dollars = (c) => (c % 100 ? (c / 100).toFixed(2) : String(c / 100));
  const rateBlock = rate ? `
    <details class="panel" style="margin-bottom:1rem;">
      <summary class="row" style="cursor:pointer;">
        <strong>Today's rate</strong>
        <span class="price" style="color:var(--magenta);">$${dollars(rate.caseCents)}</span>
      </summary>
      <p class="dim small" style="margin:.5rem 0 .6rem;">Follow-up
        <strong style="color:var(--ink)">$${dollars(rate.addonCents)}</strong>,
        Priority Chat <strong style="color:var(--ink)">$${dollars(rate.subCents || 5000)}/mo</strong>.
        Case and follow-up grow 10% per booking (to $1000 and $500 caps); chat
        climbs $5 per new client of any type (to $100). ${rate.bookings} booking${rate.bookings === 1 ? ' has' : 's have'}
        counted so far. Everyone already booked keeps what they were quoted.</p>
      <div class="row" style="gap:.5rem; flex-wrap:wrap;">
        <label class="dim small">Case $
          <input type="number" id="rate-case" min="50" step="1" value="${(rate.caseCents / 100)}"
            style="width:6rem;"></label>
        <label class="dim small">Follow-up $
          <input type="number" id="rate-addon" min="50" step="1" value="${(rate.addonCents / 100)}"
            style="width:6rem;"></label>
        <label class="dim small">Chat $/mo
          <input type="number" id="rate-sub" min="10" max="100" step="1" value="${((rate.subCents || 5000) / 100)}"
            style="width:5rem;"></label>
        <button class="btn quiet" id="rate-save">Set</button>
      </div>
      <p class="dim small" id="rate-said" style="margin:.4rem 0 0;" hidden></p>
    </details>` : '';

  const ago = (iso) => {
    if (!iso) return 'never';
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 36) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`;
    return `${Math.round(hrs / 24)} days ago`;
  };
  const voiceBlock = voice ? `
    <details class="panel" style="margin-bottom:1rem;">
      <summary class="row" style="cursor:pointer;">
        <strong>Voice study</strong>
        <span class="dim small">${voice.enabled ? `ran ${ago(voice.lastRunAt)}` : 'off'}</span>
      </summary>
      <p class="dim small" style="margin:.5rem 0 .6rem;">Every night at
        ${voice.hour > 12 ? voice.hour - 12 : voice.hour}pm your time, three passes read how
        you edit drafts and how you write to clients, and fold what they find into
        About&nbsp;you. ${voice.runs} run${voice.runs === 1 ? '' : 's'} so far.
        ${voice.lastError ? `<span style="color:var(--magenta);">Last one said: ${esc(voice.lastError)}</span>` : ''}</p>
      <div class="row" style="gap:.5rem; flex-wrap:wrap;">
        <button class="btn quiet" id="voice-toggle">${voice.enabled ? 'Stop it' : 'Start it again'}</button>
        <button class="btn quiet" id="voice-now">Run one now</button>
      </div>
      <p class="dim small" id="voice-said" style="margin:.4rem 0 0;" hidden></p>
    </details>` : '';

  const summary = `
    <div class="panel" style="margin-bottom:1rem;">
      <div class="row"><strong>Case revenue (paid via Stripe)</strong>
        <span class="price" style="color:var(--cyan);">$${(cents / 100).toLocaleString()}</span></div>
      <p class="dim small" style="margin:.3rem 0 0;">${cases.length} case${cases.length === 1 ? '' : 's'}, every one backed by a confirmed payment.
        Subscriptions and refunds live in the <a href="https://dashboard.stripe.com" target="_blank" rel="noopener">Stripe dashboard</a>.</p>
    </div>`;
  // A folder on the shelf. detail and the follow-up flag are markup the
  // caller built, so they ride in as `flags`; everything else is escaped by
  // folderCardHtml.
  const rowFor = (c, detail) => {
    const cover = covers[c.id] || {};
    const badges = unseenBadges(c.id, cover.at, {
      // The overview flag is not an activity stamp, it is a state: a case that
      // needs rescheduling wants his attention whether or not anything moved.
      overview: c.needsReschedule || dueSoon(c),
    });
    return folderCardHtml({
      id: c.id,
      href: `/admin-case.html?id=${c.id}`,
      name: c.clientName || c.clientEmail || c.clientUid,
      dx: cover.text || '',
      dxIsMine: cover.by === 'eric',
      badge: badge(c),
      badgeClass: `${c.status === 'closed' ? 'closed' : ''} ${dueSoon(c) ? 'due' : ''}`.trim(),
      flags: `<span class="folder-note">${detail}${
        c.needsReschedule ? '· <strong style="color:var(--danger)">NEEDS RESCHEDULE</strong>' : ''
      }</span>${badges ? `<span class="folder-badges" title="Not looked at yet">${badges}</span>` : ''}`,
    });
  };
  const section = (title, color, rows) => rows.length
    ? `<h2 style="font-size:.78rem; letter-spacing:.16em; color:${color}; font-family:ui-monospace,monospace; margin:1.4rem 0 .6rem;">${title}</h2><div class="drawer">${rows.join('')}</div>`
    : '';

  listEl.innerHTML = rateBlock + voiceBlock + summary +
    section('CURRENT CLIENTS — REPORT PHASE', 'var(--cyan)', current.map((c) => rowFor(c,
      `${c.reportDueAt ? `report due <strong style="color:var(--ink)">${dateFmt.format(toDate(c.reportDueAt))}</strong>` : 'report clock not started'}
       ${followUpFlag(c)}`))) +
    section('BOOKED — UPCOMING CALLS', 'var(--green)', future.map((c) => rowFor(c,
      `<strong style="color:var(--ink)">${mtFmt.format(toDate(c.appointment.start))} MST</strong> · ${esc(c.appointment.method)}
       ${followUpFlag(c)}`))) +
    section('FORMER CLIENTS — CLOSED', 'var(--dim)', former.map((c) => rowFor(c,
      `closed <strong style="color:var(--ink)">${c.closedAt ? dateFmt.format(toDate(c.closedAt)) : '—'}</strong>`)));

  const voiceSay = listEl.querySelector('#voice-said');
  const voicePost = async (btn, body, done) => {
    btn.disabled = true;
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/voice', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
      voiceSay.textContent = done(d);
    } catch (err) {
      voiceSay.textContent = err.message;
    }
    voiceSay.hidden = false;
    btn.disabled = false;
  };
  const toggleVoice = listEl.querySelector('#voice-toggle');
  if (toggleVoice) {
    toggleVoice.addEventListener('click', () => voicePost(toggleVoice, { enabled: !voice.enabled }, (d) => {
      voice = d;
      toggleVoice.textContent = d.enabled ? 'Stop it' : 'Start it again';
      return d.enabled ? 'Back on. Next one tonight.' : 'Stopped. Nothing runs until you start it again.';
    }));
  }
  const voiceNow = listEl.querySelector('#voice-now');
  if (voiceNow) {
    voiceNow.addEventListener('click', () => voicePost(voiceNow, { run: true }, (d) => {
      const r = d.lastRun || {};
      if (r.ran && r.wrote) return `Done. ${(r.readers || []).length} passes read, About you is updated.`;
      if (r.ran) return `Read it, but wrote nothing: ${r.reason || 'no change worth making'}.`;
      return `Nothing to do: ${r.reason || 'not enough to read yet'}.`;
    }));
  }

  const saveRate = listEl.querySelector('#rate-save');
  if (saveRate) {
    saveRate.addEventListener('click', async () => {
      const said = listEl.querySelector('#rate-said');
      saveRate.disabled = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/rates', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            caseCents: Math.round(Number(listEl.querySelector('#rate-case').value) * 100),
            addonCents: Math.round(Number(listEl.querySelector('#rate-addon').value) * 100),
            subCents: Math.round(Number(listEl.querySelector('#rate-sub').value) * 100),
          }),
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || `Failed (${res.status})`);
        said.textContent = d.changed
          ? `Set. A case is $${dollars(d.caseCents)}, a follow-up $${dollars(d.addonCents)}, chat $${dollars(d.subCents)}/mo.`
          : 'Already those numbers.';
        said.hidden = false;
      } catch (err) {
        said.textContent = err.message;
        said.hidden = false;
      }
      saveRate.disabled = false;
    });
  }

  // Tap a folder and it opens in the hand before the case page loads; press
  // and hold the diagnosis line to write your own over the advisor's.
  wireFolderOpen(listEl);
  wireDxLongPress(listEl, overrideDx);
}

function badge(c) {
  if (c.status === 'awaiting_report' && c.reportDueAt) {
    const days = Math.ceil((toDate(c.reportDueAt) - Date.now()) / 86_400_000);
    return days >= 0 ? `REPORT DUE ${days}d` : `OVERDUE ${-days}d`;
  }
  return (c.status || '?').replace('_', ' ').toUpperCase();
}
/** Loud follow-up state in the list: paid+countdown, booked, or expired. */
function followUpFlag(c) {
  if (c.followUp) {
    const fmt = new Intl.DateTimeFormat('en-US', { timeZone: MOUNTAIN_TZ, month: 'short', day: 'numeric' });
    return `· <strong style="color:var(--cyan)">FOLLOW-UP ${fmt.format(toDate(c.followUp.start))}</strong>`;
  }
  if (c.pendingExtra) return '· <strong style="color:var(--magenta)">AWAITING PAYMENT</strong>';
  if (!c.addOnFollowUp) return '';
  const base = c.appointment?.start ? toDate(c.appointment.start).getTime() : null;
  if (!base) return '· <strong style="color:var(--magenta)">FOLLOW-UP PAID</strong>';
  const days = Math.ceil((base + 30 * 86_400_000 - Date.now()) / 86_400_000);
  if (days <= 0) return '· <strong style="color:var(--danger)">FOLLOW-UP EXPIRED</strong>';
  return `· <strong style="color:var(--magenta)">FOLLOW-UP PAID · ${days}d left</strong>`;
}

function dueSoon(c) {
  if (c.status !== 'awaiting_report' || !c.reportDueAt) return false;
  return toDate(c.reportDueAt) - Date.now() < 3 * 86_400_000;
}
function toDate(v) {
  if (!v) return new Date(0);
  if (v.toDate) return v.toDate();
  return new Date(v);
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
