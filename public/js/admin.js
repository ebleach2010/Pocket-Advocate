// Admin case list: every case, status badges, and the "report due in N days"
// countdown that keeps the 7-day SLA from silently slipping (SPEC §F).

import { db, collection, getDocs } from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';

const MOUNTAIN_TZ = 'Etc/GMT+7';
const OPEN_ORDER = { awaiting_report: 0, confirmed: 1, forms: 2, paid: 3, delivered: 4, closed: 5 };

hydrateNav();
const user = await requireAdmin();
if (user) load();

async function load() {
  const listEl = document.getElementById('list');
  let cases = [];
  try {
    const snapshot = await getDocs(collection(db, 'cases'));
    snapshot.forEach((d) => cases.push({ id: d.id, ...d.data() }));
  } catch (err) {
    listEl.innerHTML = `<p class="error">Couldn't load cases: ${err.message}</p>`;
    return;
  }
  if (!cases.length) {
    listEl.innerHTML = '<p class="dim">No cases yet. They appear here the moment a payment lands.</p>';
    return;
  }
  cases.sort((a, b) =>
    (OPEN_ORDER[a.status] ?? 9) - (OPEN_ORDER[b.status] ?? 9) ||
    toDate(a.appointment?.start) - toDate(b.appointment?.start));

  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
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
  listEl.innerHTML = summary + cases.map((c) => {
    const start = c.appointment && toDate(c.appointment.start);
    return `
    <a class="panel" style="display:block; text-decoration:none; color:inherit;" href="/admin-case.html?id=${c.id}">
      <div class="row">
        <strong>${esc(c.clientName || c.clientEmail || c.clientUid)}</strong>
        <span class="status-pill ${c.status === 'closed' ? 'closed' : ''} ${dueSoon(c) ? 'due' : ''}">${badge(c)}</span>
      </div>
      <p class="dim small" style="margin:.3rem 0 0;">
        ${start ? `${mtFmt.format(start)} MST · ${c.appointment.method}` : 'no appointment'}
        · ${c.publicElection?.choice === 'public' ? 'PUBLIC' : 'private'}
        ${c.stripe?.amountTotal ? `· <strong style="color:var(--cyan)">$${(c.stripe.amountTotal / 100).toLocaleString()} paid</strong>` : ''}
        ${followUpFlag(c)}
        ${c.needsReschedule ? '· <strong style="color:var(--danger)">NEEDS RESCHEDULE</strong>' : ''}
      </p>
    </a>`;
  }).join('');
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
