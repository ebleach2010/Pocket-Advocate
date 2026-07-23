// Admin case list: every case, status badges, and the "report due in N days"
// countdown that keeps the 7-day SLA from silently slipping (SPEC §F).

import { db, collection, getDocs } from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';
import { initPushPrompt } from './push.js';

const MOUNTAIN_TZ = 'Etc/GMT+7';
const OPEN_ORDER = { awaiting_report: 0, confirmed: 1, forms: 2, paid: 3, delivered: 4, closed: 5 };

hydrateNav();
const user = await requireAdmin();
if (user) load();

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
  const cents = cases.reduce((sum, c) =>
    sum + (c.stripe?.amountTotal || 0) +
    (Array.isArray(c.extraPayments) ? c.extraPayments.reduce((x, p) => x + (p.amountCents || 0), 0) : 0), 0);
  const summary = `
    <div class="panel" style="margin-bottom:1rem;">
      <div class="row"><strong>Case revenue (paid via Stripe)</strong>
        <span class="price" style="color:var(--cyan);">$${(cents / 100).toLocaleString()}</span></div>
      <p class="dim small" style="margin:.3rem 0 0;">${cases.length} case${cases.length === 1 ? '' : 's'}, every one backed by a confirmed payment.
        Subscriptions and refunds live in the <a href="https://dashboard.stripe.com" target="_blank" rel="noopener">Stripe dashboard</a>.</p>
    </div>`;
  const rowFor = (c, detail) => `
    <a class="panel" style="display:block; text-decoration:none; color:inherit;" href="/admin-case.html?id=${c.id}">
      <div class="row">
        <strong>${esc(c.clientName || c.clientEmail || c.clientUid)}</strong>
        <span class="status-pill ${c.status === 'closed' ? 'closed' : ''} ${dueSoon(c) ? 'due' : ''}">${badge(c)}</span>
      </div>
      <p class="dim small" style="margin:.3rem 0 0;">${detail}
        ${c.needsReschedule ? '· <strong style="color:var(--danger)">NEEDS RESCHEDULE</strong>' : ''}</p>
    </a>`;
  const section = (title, color, rows) => rows.length
    ? `<h2 style="font-size:.78rem; letter-spacing:.16em; color:${color}; font-family:ui-monospace,monospace; margin:1.4rem 0 .6rem;">${title}</h2>${rows.join('')}`
    : '';

  listEl.innerHTML = summary +
    section('CURRENT CLIENTS — REPORT PHASE', 'var(--cyan)', current.map((c) => rowFor(c,
      `${c.reportDueAt ? `report due <strong style="color:var(--ink)">${dateFmt.format(toDate(c.reportDueAt))}</strong>` : 'report clock not started'}
       ${followUpFlag(c)}`))) +
    section('BOOKED — UPCOMING CALLS', 'var(--green)', future.map((c) => rowFor(c,
      `<strong style="color:var(--ink)">${mtFmt.format(toDate(c.appointment.start))} MST</strong> · ${esc(c.appointment.method)}
       ${followUpFlag(c)}`))) +
    section('FORMER CLIENTS — CLOSED', 'var(--dim)', former.map((c) => rowFor(c,
      `closed <strong style="color:var(--ink)">${c.closedAt ? dateFmt.format(toDate(c.closedAt)) : '—'}</strong>`)));
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
