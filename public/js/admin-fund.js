// The Community Assistance Fund's verification queue (Eric, 2026-10-04).
//
// The list, one application at a time, its documents opened through the
// Worker as blobs (never a storage address), the internal note, the audit
// history, and the five actions. A decline or a request for more
// information needs a brief internal reason, which only reviewers read; what
// the applicant reads is a separate, optional message. Verify and Reverify
// are greyed out on his own application with Eric's sentence, and the Worker
// refuses them there whatever this page does.

import { requireAdmin, hydrateNav } from './auth.js';
import { dollars, CHECK_NOTE, checkTo, VERIFY_CHECKS, VERIFY_CHECKS_REFUSAL } from './fund-rules.js';
import { enablePush, pushSupported, pushInstalled, initPushPrompt } from './push.js';

hydrateNav();
const user = await requireAdmin();
// This is his home page now, so it keeps his push subscription fresh: when
// alerts are already allowed on this device, quietly re-register it.
if (user) initPushPrompt(user, null).catch(() => {});
const el = document.getElementById('fq');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const SELF_REFUSAL = 'Your verification must be completed by another authorized reviewer.';
const STATUS_WORDS = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review', more_info: 'More Information Requested',
  verified: 'Verified', not_verified: 'Not Verified', inactive: 'Inactive',
};
const FILTERS = [
  ['waiting', 'Waiting', (s) => s === 'submitted' || s === 'under_review'],
  ['more_info', 'More info asked', (s) => s === 'more_info'],
  ['verified', 'Verified', (s) => s === 'verified'],
  ['not_verified', 'Not verified', (s) => s === 'not_verified'],
  ['inactive', 'Inactive', (s) => s === 'inactive'],
  ['draft', 'Unfinished', (s) => s === 'draft'],
  ['all', 'All', () => true],
];
// Which actions apply to which state: the Worker's own table, mirrored.
const ACT_FROM = {
  verify: ['submitted', 'under_review', 'more_info', 'not_verified', 'inactive'],
  reverify: ['verified', 'inactive'],
  request_info: ['submitted', 'under_review', 'verified', 'inactive'],
  decline: ['submitted', 'under_review', 'more_info'],
  inactive: ['verified'],
};
const ACT_WORDS = {
  verify: 'Verify', reverify: 'Reverify', request_info: 'Request More Information', decline: 'Decline Verification', inactive: 'Mark Inactive',
};
const HISTORY_WORDS = {
  started: 'Started the application', submitted: 'Submitted', resubmitted: 'Submitted again',
  'uploaded-id': 'Uploaded an ID document', 'uploaded-medical': 'Uploaded a medical document', 'uploaded-photo': 'Uploaded a photo',
  'removed-id': 'Removed the ID document', 'removed-medical': 'Removed a medical document', 'removed-photo': 'Removed the photo',
  viewed: 'Opened the application', 'review-started': 'Review started',
  'opened-id': 'Opened the ID document', 'opened-medical': 'Opened a medical document', 'opened-photo': 'Opened the photo',
  verify: 'Verified', reverify: 'Reverified', request_info: 'Asked for more information', decline: 'Declined verification',
  inactive: 'Marked inactive', 'note-saved': 'Saved the internal note', 'payout-sent': 'Marked a check mailed',
};
const TYPE_WORDS = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/heic': 'HEIC', 'image/heif': 'HEIF', 'image/webp': 'WEBP' };
const toCents = (v) => { const n = Number(String(v || '').replace(/[$,\s]/g, '')); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
const when = (v) => (v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const day = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
const sizeWords = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);

let filter = 'waiting';
let blobs = [];
if (user) route();
window.addEventListener('hashchange', route);

async function api(path, { method = 'GET', body } = {}) {
  const token = await user.getIdToken();
  const res = await fetch(path, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
  return out;
}

function route() {
  for (const u of blobs) URL.revokeObjectURL(u);
  blobs = [];
  const uid = new URLSearchParams(location.hash.slice(1)).get('uid');
  if (uid) openOne(uid);
  else list();
}

async function list() {
  el.innerHTML = '<p class="dim">Loading…</p>';
  let rows = [];
  try {
    rows = (await api('/api/admin/fund/list')).applications || [];
  } catch (err) {
    el.innerHTML = `<p class="error">Couldn't load the queue: ${esc(err.message)}</p>`;
    return;
  }
  const count = (fn) => rows.filter((r) => fn(r.verificationStatus)).length;
  const pick = FILTERS.find(([k]) => k === filter) || FILTERS[0];
  // Waiting reads oldest first, so whoever has waited longest is on top;
  // every other list reads newest first.
  const at = (r) => new Date(r.submittedAt || r.updatedAt || 0).getTime();
  const shown = rows.filter((r) => pick[2](r.verificationStatus))
    .sort((x, y) => (filter === 'waiting' ? at(x) - at(y) : at(y) - at(x)));
  el.innerHTML = `
    <div id="fq-alerts"></div>
    <div id="fq-pool"><p class="dim small">Loading the pool…</p></div>
    <h2 class="fq-sub">Applications</h2>
    <div class="fq-chips" role="tablist">${FILTERS.map(([k, w, fn]) => `
      <button type="button" class="fq-chip${k === filter ? ' on' : ''}" data-f="${k}" role="tab" aria-selected="${k === filter}">${w} <span>${count(fn)}</span></button>`).join('')}
    </div>
    ${shown.length ? `<ul class="fq-list">${shown.map((r) => `
      <li><a class="fq-row" href="#uid=${encodeURIComponent(r.uid)}">
        <span class="fq-name">${esc(r.preferredName || 'No name yet')}${r.self ? ' <span class="fq-flag">your own</span>' : ''}</span>
        <span class="fq-meta">${esc(r.discordUsername || 'no Discord name yet')} · ${r.submittedAt ? `submitted ${day(r.submittedAt)}` : 'not submitted'}</span>
        <span class="fq-pill s-${r.verificationStatus}">${STATUS_WORDS[r.verificationStatus]}</span>
        ${r.reverificationOverdue ? '<span class="fq-flag due">reverification due</span>' : ''}
      </a></li>`).join('')}</ul>` : '<p class="dim">Nothing here.</p>'}`;
  el.querySelectorAll('[data-f]').forEach((b) => b.addEventListener('click', () => { filter = b.dataset.f; list(); }));
  alerts();
  pool();
}

// ---- application alerts (Eric, 2026-10-04: "be sure I receive notifications
// for applications"). Every submit pushes to each device he turned alerts on
// for and emails him as well; this card turns the push on for this device
// and proves both arrive. ----
function alerts(said = '') {
  const box = el.querySelector('#fq-alerts');
  if (!box) return;
  const on = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const canAsk = pushSupported() && !on && (typeof Notification === 'undefined' || Notification.permission !== 'denied');
  const iosNoIcon = /iPhone|iPad|iPod/.test(navigator.userAgent || '') && !pushInstalled();
  box.innerHTML = `
    <section class="fq-alerts">
      <h2>Application alerts</h2>
      <p class="dim small">Every new application sends a notification to your phone and an email to your inbox. Neither shows a name.</p>
      ${on ? '<p class="small ok">\u2713 On for this device.</p>'
        : canAsk ? '<p class="row"><button type="button" class="btn glow" id="fq-push">Turn on alerts on this device</button></p>'
          : `<p class="small">${iosNoIcon ? 'On iPhone, open this page from your Home Screen icon to turn alerts on.' : 'This browser cannot show alerts. The email still comes.'}</p>`}
      <p class="row"><button type="button" class="btn" id="fq-test">Send me a test alert</button> <span class="small" id="fq-alert-said" role="status">${esc(said)}</span></p>
    </section>`;
  box.querySelector('#fq-push')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    const out = await enablePush(user).catch((err) => ({ ok: false, error: err.message }));
    alerts(out.ok ? 'Alerts are on for this device.' : out.error || 'Alerts could not be turned on.');
  });
  box.querySelector('#fq-test').addEventListener('click', async (e) => {
    const out = box.querySelector('#fq-alert-said');
    e.currentTarget.disabled = true;
    out.textContent = 'Sending…';
    try { out.textContent = testWords(await api('/api/admin/fund/test-alert', { method: 'POST', body: {} })); }
    catch (err) { out.textContent = `The test did not go: ${err.message}`; }
    e.currentTarget.disabled = false;
  });
}

function testWords({ devices = 0, emailed = false }) {
  const where = `${devices} device${devices === 1 ? '' : 's'}`;
  if (devices && emailed) return `Sent to ${where} and your email.`;
  if (devices) return `Sent to ${where}. The email did not go.`;
  if (emailed) return 'Sent to your email. No device has alerts on yet, so turn them on above.';
  return 'Nothing went out: no device has alerts on, and the email did not go.';
}

// ---- the fund's totals (Eric, 2026-10-04: "I will update the amount in the
// donation pool weekly so each participant can see their active share", then
// "monthly payout distributions ... payout should be check only", and "Every
// Friday, I'll post in Discord: Number of approved recipients, Net GoFundMe
// proceeds so far, Zazzle creator earnings being added, Combined total in the
// fund"). He enters the two totals so far; the combined total and each share
// follow, and the Friday post is one tap to copy. The payout is one check on
// January 1, 2027 ("Not monthly"). ----
const longDay = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const money = (c) => (Number.isInteger(c) ? (c / 100).toFixed(2) : '');

function discordPost(p) {
  return [
    `Community Assistance Fund update, ${longDay(p.updatedAt)}`,
    `Approved recipients: ${p.activeCount}`,
    `Net GoFundMe proceeds so far: ${dollars(p.gofundmeCents)}`,
    `Zazzle creator earnings being added: ${dollars(p.zazzleCents)}`,
    `Combined total in the fund: ${dollars(p.totalCents)}`,
  ].join('\n');
}

async function copyOut(box, text, said) {
  const out = box.querySelector('[data-copy-out]');
  try {
    await navigator.clipboard.writeText(text);
    out.hidden = true;
    said.textContent = 'Copied. Paste it into Discord.';
  } catch {
    // No clipboard here: show it, selected, to copy by hand.
    out.value = text;
    out.hidden = false;
    out.select();
    said.textContent = 'Copy the text below.';
  }
}

async function pool(data) {
  const box = el.querySelector('#fq-pool');
  if (!box) return;
  let out = data;
  if (!out) {
    try { out = await api('/api/admin/fund/pool'); } catch (err) { box.innerHTML = `<p class="error">Couldn't load the pool: ${esc(err.message)}</p>`; return; }
  }
  const p = out.pool;
  const rows = out.participants || [];
  box.innerHTML = `
    <section class="fq-pool">
      <h2 class="fq-sub">The fund so far</h2>
      ${p ? `<div class="fq-totals">
        <p class="small">Net GoFundMe proceeds so far: <strong>${dollars(p.gofundmeCents)}</strong></p>
        <p class="small">Zazzle creator earnings being added: <strong>${dollars(p.zazzleCents)}</strong></p>
        <p class="small">Combined total in the fund: <strong>${dollars(p.totalCents)}</strong></p>
        <p class="small">Approved recipients: <strong>${p.activeCount}</strong></p>
        <p class="small">Each share so far: <strong>${dollars(p.shareCents)}</strong></p>
        <p class="dim small">Posted ${when(p.updatedAt)}</p>
      </div>${p.pending ? `<p class="dim small">Telling participants now: ${p.pending} still to go, a few each minute.</p>` : ''}
      <p class="row"><button type="button" class="btn" id="fq-copy-post">Copy the Friday post for Discord</button></p>` : '<p class="dim small">No totals posted yet.</p>'}
      <label class="small">Net GoFundMe proceeds so far, in dollars
        <input class="fq-text fq-money" id="fq-gofundme" inputmode="decimal" placeholder="1240.00" value="${p ? money(p.gofundmeCents) : ''}"></label>
      <label class="small">Zazzle creator earnings being added, in dollars
        <input class="fq-text fq-money" id="fq-zazzle" inputmode="decimal" placeholder="0.00" value="${p ? money(p.zazzleCents) : ''}"></label>
      <p class="small">Combined total in the fund: <strong id="fq-combined">${p ? dollars(p.totalCents) : '$0.00'}</strong></p>
      <p class="dim small">Both are totals so far, not one week's. Post every Friday.</p>
      <p class="row"><button type="button" class="btn glow" id="fq-post">Post and tell participants</button> <span class="dim small" id="fq-post-said" role="status"></span></p>
      <textarea class="fq-text" data-copy-out rows="6" readonly hidden></textarea>
      <p class="dim small">The fund is split equally among approved recipients. You are never one of them.</p>
      <h3>Checks</h3>
      ${rows.length ? `<ul class="fq-payouts">${rows.map((r) => `
        <li class="fq-payout" data-uid="${esc(r.uid)}">
          <span class="fq-name">${esc(r.preferredName || 'No name')}${r.discordUsername ? ` <span class="dim small">${esc(r.discordUsername)}</span>` : ''}</span>
          <span class="small">${esc(r.payTo)}</span>
          ${p ? `<span class="small">Share so far ${dollars(p.shareCents)} · Sent ${dollars(r.sentCents)} · Still owed ${dollars(r.owedCents)}</span>` : ''}
          ${r.lastPayout ? `<span class="small ok">✓ Mailed ${dollars(r.lastPayout.amountCents)} ${day(r.lastPayout.at)}, Check #${esc(r.lastPayout.ref)}</span>` : ''}
          ${p && !r.owedCents ? '<span class="dim small">Paid up so far.</span>' : `
          <span class="fq-pay-row">
            <input class="fq-text fq-money" data-amount inputmode="decimal" value="${p ? money(r.owedCents) : ''}" aria-label="Amount of the check">
            <input class="fq-text" data-ref placeholder="Check #" maxlength="60" aria-label="Check number">
            <button type="button" class="btn" data-pay>Mark mailed</button>
          </span>
          <span class="dim small">${esc(CHECK_NOTE)}</span>
          <span class="error small" data-pay-said hidden></span>`}
        </li>`).join('')}</ul>
      <p class="row"><button type="button" class="btn" id="fq-copy-names">Copy the approved Discord usernames</button> <span class="dim small" id="fq-names-said" role="status"></span></p>
      <p class="dim small">For the list you publish before payout. Only Discord usernames: no legal names, nothing medical.</p>` : '<p class="dim small">Nobody is taking part yet.</p>'}
    </section>`;
  const combine = () => {
    const g = toCents(box.querySelector('#fq-gofundme').value || '0');
    const z = toCents(box.querySelector('#fq-zazzle').value || '0');
    box.querySelector('#fq-combined').textContent = Number.isInteger(g) && Number.isInteger(z) ? dollars(g + z) : 'check the amounts';
  };
  box.querySelector('#fq-gofundme').addEventListener('input', combine);
  box.querySelector('#fq-zazzle').addEventListener('input', combine);
  box.querySelector('#fq-copy-post')?.addEventListener('click', () => copyOut(box, discordPost(p), box.querySelector('#fq-post-said')));
  box.querySelector('#fq-copy-names')?.addEventListener('click', () => copyOut(box,
    [`Approved recipients (${rows.length}):`, ...rows.map((r) => r.discordUsername || '(no Discord name)')].join('\n'), box.querySelector('#fq-names-said')));
  box.querySelector('#fq-post').addEventListener('click', async (e) => {
    const said = box.querySelector('#fq-post-said');
    const g = toCents(box.querySelector('#fq-gofundme').value);
    const z = toCents(box.querySelector('#fq-zazzle').value || '0');
    if (!box.querySelector('#fq-gofundme').value.trim() || !Number.isInteger(g) || g < 0 || !Number.isInteger(z) || z < 0) { said.textContent = 'Enter the GoFundMe amount in dollars, like 1240.00, and the Zazzle amount, or 0.'; return; }
    e.currentTarget.disabled = true;
    try { pool(await api('/api/admin/fund/pool', { method: 'POST', body: { gofundmeCents: g, zazzleCents: z } })); }
    catch (err) { said.textContent = err.message; e.currentTarget.disabled = false; }
  });
  box.querySelectorAll('[data-pay]').forEach((b) => b.addEventListener('click', async () => {
    const li = b.closest('[data-uid]');
    const said = li.querySelector('[data-pay-said]');
    const cents = toCents(li.querySelector('[data-amount]').value);
    const ref = li.querySelector('[data-ref]').value.trim();
    said.hidden = true;
    if (!Number.isInteger(cents) || cents <= 0) { said.textContent = 'Enter the amount of the check.'; said.hidden = false; return; }
    if (ref.length < 2) { said.textContent = 'Add the check number.'; said.hidden = false; return; }
    b.disabled = true;
    try { await api('/api/admin/fund/payout', { method: 'POST', body: { uid: li.dataset.uid, amountCents: cents, ref } }); pool(); }
    catch (err) { said.textContent = err.message; said.hidden = false; b.disabled = false; }
  }));
}

async function openOne(uid) {
  el.innerHTML = '<p class="dim">Loading…</p>';
  let out;
  try {
    out = await api(`/api/admin/fund/view?uid=${encodeURIComponent(uid)}`);
  } catch (err) {
    el.innerHTML = `<p><a href="#">← Back to the queue</a></p><p class="error">${esc(err.message)}</p>`;
    return;
  }
  paint(out.application, out.me);
}

function docRow(a, d, kind) {
  return `<li class="fq-doc" data-doc="${esc(d.id)}">
    <span>${esc(d.label)} <span class="dim small">(${TYPE_WORDS[d.type] || 'file'}, ${sizeWords(d.size)}, ${day(d.uploadedAt)})</span></span>
    <button type="button" class="btn" data-open="${esc(d.id)}" data-type="${esc(d.type)}" data-kind="${kind}">Open</button>
    <div class="fq-preview" hidden></div>
  </li>`;
}

function paint(a, me) {
  const own = a.uid === me;
  const s = a.verificationStatus;
  const docs = [a.identityDocument && docRow(a, a.identityDocument, 'id'), ...(a.medicalDocuments || []).map((d) => docRow(a, d, 'medical'))].filter(Boolean);
  const p = a.payment;
  // Check only (Eric, 2026-10-04: "payout should be check only").
  const payWords = esc(checkTo(p));
  const actions = Object.keys(ACT_WORDS).filter((k) => ACT_FROM[k].includes(s));
  const history = [...(a.audit || [])].reverse();
  const who = (by) => (by === me ? 'You' : by === a.uid ? 'Applicant' : 'Reviewer');
  el.innerHTML = `
    <p><a href="#">← Back to the queue</a></p>
    <div class="fq-head">
      <h2>${esc(a.preferredName || 'No name yet')}</h2>
      <span class="fq-pill s-${s}">${STATUS_WORDS[s]}</span>
      ${own ? '<span class="fq-flag">your own application</span>' : ''}
    </div>
    <dl class="fq-facts">
      <dt>Discord</dt><dd>${esc(a.discordUsername)}</dd>
      <dt>Legal name</dt><dd>${esc(a.legalName)}</dd>
      ${a.email ? `<dt>Email</dt><dd>${esc(a.email)}</dd>` : ''}
      <dt>Submitted</dt><dd>${when(a.submittedAt) || 'not yet'}</dd>
      ${a.reviewedAt ? `<dt>Last reviewed</dt><dd>${when(a.reviewedAt)}</dd>` : ''}
      ${a.verifiedAt ? `<dt>Verified</dt><dd>${day(a.verifiedAt)}</dd>` : ''}
      ${a.reverificationDueAt ? `<dt>Reverification due</dt><dd>${day(a.reverificationDueAt)}</dd>` : ''}
      <dt>Wants distributions</dt><dd>${a.participationRequested === true ? 'Yes' : a.participationRequested === false ? 'No' : 'not answered'}</dd>
      <dt>Participation</dt><dd>${a.participationActive ? 'Active' : 'Not active'}</dd>
      <dt>Discord member</dt><dd>${a.discordMember ? 'Confirmed' : 'Not confirmed'}</dd>
      <dt>Username may be published</dt><dd>${a.usernamePublicConsent ? `Agreed${a.usernameConsentAt ? ` ${day(a.usernameConsentAt)}` : ''}` : 'Not agreed'}</dd>
    </dl>

    <h3>Documents</h3>
    <p class="dim small">The medical document must show disability due to illness, and the name on it must match the full name on the ID.</p>
    ${docs.length ? `<ul class="fq-docs">${docs.join('')}</ul>` : '<p class="dim">No documents yet.</p>'}
    ${a.photo ? `<h3>GoFundMe photo</h3><ul class="fq-docs">${docRow(a, a.photo, 'photo')}</ul>
      <p class="small ${a.photoPublicConsent ? '' : 'error'}">${a.photoPublicConsent ? `Public-use consent given${a.photoConsentAt ? ` ${day(a.photoConsentAt)}` : ''}.` : 'No public-use consent: do not use this photo.'}</p>` : ''}

    <h3>Why they are in need</h3>
    <p class="fq-note">${a.needStatement ? esc(a.needStatement) : '<span class="dim">Not written yet.</span>'}</p>

    <h3>Applicant note</h3>
    <p class="fq-note">${a.applicantNote ? esc(a.applicantNote) : '<span class="dim">None.</span>'}</p>

    <h3>Payment</h3>
    <p>${payWords}</p>
    ${(a.payouts || []).length ? `<h3>Sent</h3><ul class="fq-history">${a.payouts.map((x) => `<li>${dollars(x.amountCents)} check · ${day(x.at)} · Check #${esc(x.ref)}</li>`).join('')}</ul>` : ''}

    <h3>Internal note <span class="dim small">(reviewers only)</span></h3>
    <textarea id="fq-note" class="fq-text" maxlength="4000">${esc(a.internalReviewerNote)}</textarea>
    <p class="row"><button type="button" class="btn" id="fq-note-save">Save note</button> <span class="dim small" id="fq-note-said"></span></p>

    <h3>Actions</h3>
    ${actions.length ? `<div class="fq-actions">${actions.map((k) => {
      const blocked = own && (k === 'verify' || k === 'reverify');
      return `<button type="button" class="btn${k === 'verify' || k === 'reverify' ? ' glow' : k === 'decline' ? ' mag' : ''}" data-act="${k}"${blocked ? ' disabled aria-describedby="fq-self"' : ''}>${ACT_WORDS[k]}</button>`;
    }).join('')}</div>
    ${own && actions.some((k) => k === 'verify' || k === 'reverify') ? `<p class="small" id="fq-self">${SELF_REFUSAL}</p>` : ''}` : `<p class="dim">${s === 'draft' ? 'Not submitted yet, so there is nothing to act on.' : 'No action applies right now.'}</p>`}
    <div id="fq-act-form" hidden></div>
    <p class="error" id="fq-act-error" hidden></p>
    ${a.applicantMessage ? `<p class="small dim">Message the applicant sees: “${esc(a.applicantMessage)}”</p>` : ''}

    <h3>History</h3>
    <ol class="fq-history">${history.slice(0, 40).map((h) => `
      <li><span class="dim small">${when(h.at)}</span> · <strong>${who(h.by)}</strong> ${esc(HISTORY_WORDS[h.act] || h.act)}${h.from && h.to && h.from !== h.to ? ` <span class="dim small">(${esc(STATUS_WORDS[h.from] || h.from)} → ${esc(STATUS_WORDS[h.to] || h.to)})</span>` : ''}${h.reason ? `<br><span class="small">Reason: ${esc(h.reason)}</span>` : ''}${h.msg ? `<br><span class="small dim">To the applicant: ${esc(h.msg)}</span>` : ''}</li>`).join('')}
    </ol>
    ${history.length > 40 ? `<p class="dim small">${history.length - 40} older entries kept.</p>` : ''}`;

  el.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openDoc(a.uid, b)));
  el.querySelector('#fq-note-save').addEventListener('click', async (e) => {
    const said = el.querySelector('#fq-note-said');
    e.currentTarget.disabled = true;
    try {
      const out = await api('/api/admin/fund/act', { method: 'POST', body: { uid: a.uid, action: 'note', note: el.querySelector('#fq-note').value } });
      paint(out.application, out.me);
      el.querySelector('#fq-note-said').textContent = 'Saved.';
    } catch (err) {
      said.textContent = err.message;
      e.currentTarget.disabled = false;
    }
  });
  el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => actForm(a, b.dataset.act)));
}

function actForm(a, act) {
  const box = el.querySelector('#fq-act-form');
  const needsReason = act === 'request_info' || act === 'decline';
  box.hidden = false;
  box.innerHTML = `
    <div class="fq-confirm">
      <p><strong>${ACT_WORDS[act]}</strong>${act === 'verify' || act === 'reverify' ? ': confirms eligibility only, and sets reverification six months out.' : ''}</p>
      ${needsReason ? `
        <label class="small">${act === 'decline' ? 'Why it was denied' : 'What you need from them'} <span class="dim">(required, emailed to the applicant)</span>
          <textarea class="fq-text" id="fq-message" maxlength="1000"></textarea></label>
        <label class="small">Private note for the history <span class="dim">(optional, only you see it)</span>
          <textarea class="fq-text" id="fq-reason" maxlength="1000"></textarea></label>` : ''}
      ${act === 'verify' || act === 'reverify' ? `${VERIFY_CHECKS.map(([k, w]) => `
        <label class="small fq-tick"><input type="checkbox" data-vcheck="${k}"> ${esc(w)}</label>`).join('')}
        <p class="dim small">The applicant gets an email saying they are approved.</p>` : ''}
      <p class="row"><button type="button" class="btn glow" id="fq-go">${ACT_WORDS[act]}</button>
        <button type="button" class="btn quiet" id="fq-cancel">Cancel</button></p>
    </div>`;
  box.querySelector('#fq-cancel').addEventListener('click', () => { box.hidden = true; box.innerHTML = ''; });
  box.querySelector('#fq-go').addEventListener('click', async (e) => {
    const err = el.querySelector('#fq-act-error');
    err.hidden = true;
    const reason = box.querySelector('#fq-reason')?.value.trim() || '';
    const message = box.querySelector('#fq-message')?.value.trim() || '';
    const checks = Object.fromEntries([...box.querySelectorAll('[data-vcheck]')].map((c) => [c.dataset.vcheck, c.checked]));
    if ((act === 'verify' || act === 'reverify') && !VERIFY_CHECKS.every(([k]) => checks[k] === true)) {
      err.textContent = VERIFY_CHECKS_REFUSAL;
      err.hidden = false;
      return;
    }
    if (needsReason && message.length < 2) {
      err.textContent = act === 'decline' ? 'Write why it was denied first. It is emailed to them.' : 'Write what you need first. It is emailed to them.';
      err.hidden = false;
      box.querySelector('#fq-message').focus();
      return;
    }
    e.currentTarget.disabled = true;
    try {
      const out = await api('/api/admin/fund/act', { method: 'POST', body: { uid: a.uid, action: act, reason, message, checks } });
      paint(out.application, out.me);
    } catch (x) {
      err.textContent = x.message;
      err.hidden = false;
      e.currentTarget.disabled = false;
    }
  });
}

async function openDoc(uid, btn) {
  const row = btn.closest('.fq-doc');
  const view = row.querySelector('.fq-preview');
  btn.disabled = true;
  btn.textContent = 'Opening…';
  try {
    const token = await user.getIdToken();
    const res = await fetch(`/api/admin/fund/file?uid=${encodeURIComponent(uid)}&doc=${encodeURIComponent(btn.dataset.open)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`The file could not be opened (${res.status}).`);
    const url = URL.createObjectURL(await res.blob());
    blobs.push(url);
    const type = btn.dataset.type;
    const name = `${btn.dataset.kind === 'id' ? 'id-document' : btn.dataset.kind === 'photo' ? 'photo' : 'medical-document'}.${(TYPE_WORDS[type] || 'file').toLowerCase()}`;
    view.innerHTML = `${type === 'application/pdf'
      ? `<iframe title="Document preview" src="${url}"></iframe>`
      : /heic|heif/.test(type) ? '<p class="dim small">This picture is HEIC, which most browsers cannot show here. Use Open full size or Download.</p>'
        : `<img alt="Document preview" src="${url}">`}
      <p class="row"><a class="btn" href="${url}" target="_blank" rel="noopener">Open full size</a> <a class="btn quiet" href="${url}" download="${name}">Download</a></p>`;
    view.hidden = false;
    btn.textContent = 'Opened';
  } catch (err) {
    view.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    view.hidden = false;
    btn.disabled = false;
    btn.textContent = 'Open';
  }
}
