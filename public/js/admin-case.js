// Admin case detail: everything the client sees, plus the levers — post the
// join link / phone note, view + download uploads, upload the recording and
// report (which advances the status and pings the client in-app), close case.

import {
  db, storage, doc, getDoc, collection, getDocs, query, where,
  ref, uploadBytesResumable, listAll, getDownloadURL, getMetadata,
} from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';
import { mountChat } from './chat.js';
import { mountAdvisor } from './advisor.js';

const MOUNTAIN_TZ = 'Etc/GMT+7';
// Keep in sync with CASE_PRICE_CENTS in worker/index.js — the custom-rate
// percentages below are a share of the standard Advocacy Case fee.
const CASE_PRICE_CENTS = 27500;
const dollars = (cents) => (cents % 100 ? (cents / 100).toFixed(2) : String(cents / 100));
const caseId = new URLSearchParams(location.search).get('id');
// Sentinel value for "a time that isn't on the calendar" in the slot dropdown.
const CUSTOM = '__custom__';
const CUSTOM_OPTION = `<option value="${CUSTOM}">A time not on the calendar…</option>`;

hydrateNav();
const user = await requireAdmin();
if (user && caseId) load();

let data = null;

async function load() {
  const el = document.getElementById('case');
  try {
    const snapshot = await getDoc(doc(db, 'cases', caseId));
    if (!snapshot.exists()) throw new Error('No such case.');
    data = snapshot.data();
  } catch (err) {
    el.innerHTML = `<p class="error">${err.message}</p>`;
    return;
  }
  render(el);
  refreshFiles();
}

function render(el) {
  const c = data;
  const start = c.appointment && toDate(c.appointment.start);
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const due = c.reportDueAt
    ? Math.ceil((toDate(c.reportDueAt) - Date.now()) / 86_400_000)
    : null;

  el.innerHTML = `
    <div class="row">
      <h1 style="margin:0;">${esc(c.clientName || c.clientEmail || c.clientUid)}</h1>
      <span class="status-pill">${(c.status || '?').replace('_', ' ').toUpperCase()}</span>
    </div>
    ${infoBar(c, mtFmt, start, due)}
    ${c.appointment?.requested ? `
    <div class="panel" style="border-color:var(--orange); box-shadow:var(--glow-o);">
      <h3 style="margin:0 0 .3rem; color:var(--orange);">Booking request — not on your calendar</h3>
      <p class="small" style="margin:0 0 .2rem;">They asked for
        <strong>${start ? esc(mtFmt.format(start)) : 'an unknown time'} MST</strong>, paid in full.
        Nothing is reserved until you confirm.</p>
      <p class="dim small" style="margin:0 0 .7rem;">Declining keeps the case and the payment;
        it just flags the case so you can offer another time below.</p>
      <button class="btn" data-action="confirm-request">Confirm this time</button>
      <button class="btn quiet" data-action="deny-request">Can't make it</button>
    </div>` : ''}
    ${c.status !== 'closed' ? `
    <div style="margin:0 0 1rem;">
      <button class="btn danger" data-action="close" style="width:100%; padding:.8rem; font-size:1rem;">
        Close case
      </button>
    </div>` : ''}

    <div class="panel">
      <h3>Meeting link / phone note</h3>
      <p class="dim small">${c.appointment?.method === 'phone'
        ? `Client expects a call at <strong>${esc(c.appointment.phone || '?')}</strong>. Post the number you'll call from:`
        : 'Paste the video-call link the client should join:'}</p>
      <input type="url" id="joinlink" placeholder="${c.appointment?.method === 'phone' ? 'Calling from +1 …' : 'https://…'}"
        value="${esc(c.appointment?.joinLink || '')}">
      <div class="actions"><button class="btn secondary" id="save-link">Save</button></div>
    </div>

    <div class="panel">
      <h3>Files</h3>
      <ul class="filelist" id="files"><li class="dim small">Loading…</li></ul>
      <label class="small" style="margin-top:.7rem;">Upload the recording
        <input type="file" id="up-recording" accept="video/*,audio/*,.mp4,.m4a,.mp3,.mkv,.webm">
      </label>
      <label class="small" style="margin-top:.5rem;">Upload the report <span class="dim">(advances the case + pings the client)</span>
        <input type="file" id="up-report" accept=".pdf,.html,.md,.doc,.docx,.jpg,.jpeg,.png,.heic">
      </label>
      <progress id="bar" max="100" value="0" hidden></progress>
      <p class="error" id="err" hidden></p>
    </div>

    <div class="chat-with-advisor">
      <div class="panel">
        <h3>Chat with the client</h3>
        <div id="chat"></div>
      </div>
      <div class="panel advisor-panel" id="advisor"></div>
    </div>

    <div class="panel">
      <h3>Schedule a session</h3>
      <p class="dim small">Book this client at any time at all — pick an open slot, or type a time that isn't on the calendar. Lead time, booking horizon and business hours don't apply to you.</p>
      <select id="sched-slot"><option value="">Loading open slots…</option></select>
      <div id="sched-custom" style="margin-top:.5rem;" hidden>
        <input type="datetime-local" id="sched-when">
        <select id="sched-dur" style="margin-top:.35rem;">
          ${[30, 45, 60, 90, 120].map((m) =>
            `<option value="${m}" ${m === 60 ? 'selected' : ''}>${m} minutes</option>`).join('')}
        </select>
        <p class="dim small" style="margin:.3rem 0 0;">Times are MST. Evenings, weekends and tomorrow are all fair game — the slot is created for this client only and never shows up on the public picker.</p>
      </div>
      <div id="sched-modes" style="margin-top:.6rem;">
        <label class="small" style="display:block;"><input type="radio" name="sched-mode" value="reschedule" checked>
          Reschedule the main appointment <span class="dim">(no charge)</span></label>
        <label class="small" style="display:block;"><input type="radio" name="sched-mode" value="followup" ${followUpAvailable(c) ? '' : 'disabled'}>
          Book their paid follow-up ${followUpAvailable(c) ? '' : `<span class="dim">(${followUpUnavailableReason(c)})</span>`}</label>
        <label class="small" style="display:block;"><input type="radio" name="sched-mode" value="charge">
          Charge for a session:</label>
        <div id="sched-charge" style="margin:.35rem 0 0 1.4rem;" hidden>
          <select id="sched-pct">
            ${[0, 25, 50, 75, 100, 125, 150].map((p) =>
              `<option value="${p}" ${p === 50 ? 'selected' : ''}>${p}% — ${p === 0 ? 'no charge' : '$' + dollars((p * CASE_PRICE_CENTS) / 100)}</option>`).join('')}
          </select>
          <input type="text" id="sched-tag" maxlength="120" placeholder="Invoice line (optional) — e.g. Records deep-dive session" style="margin-top:.35rem;">
          <p class="dim small" style="margin:.3rem 0 0;">The client pays through Stripe to confirm; the slot holds for 24 hours. Your tagline is the line item on their receipt.</p>
        </div>
      </div>
      <p class="error" id="sched-err" hidden></p>
      <div id="sched-result" class="dim small" style="margin-top:.4rem;"></div>
      <div class="actions"><button class="btn secondary" id="sched-go">Schedule</button></div>
    </div>

    <div class="panel">
      <h3>Milestones</h3>
      <div class="actions" style="margin-top:.3rem;">
        <button class="btn secondary" data-action="recording-uploaded">Call done — start 7-day report clock</button>
        <button class="btn secondary" data-action="report-uploaded">Report delivered</button>
        ${c.status === 'closed' ? '<span class="dim small">Case closed.</span>' : ''}
      </div>
      <p class="dim small" style="margin-top:.6rem;">Uploading a recording or report triggers its milestone automatically; the buttons cover manual corrections.</p>
    </div>`;

  el.querySelector('#save-link').addEventListener('click', saveLink);
  wireScheduler(el);
  el.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', () => milestone(b.dataset.action, b)));
  el.querySelector('#up-recording').addEventListener('change', (e) =>
    upload(e.target.files[0], 'recording', 'recording-uploaded'));
  el.querySelector('#up-report').addEventListener('change', (e) =>
    upload(e.target.files[0], 'report', 'report-uploaded'));

  const chat = mountChat({
    container: el.querySelector('#chat'),
    parentPath: ['cases', caseId],
    user,
    myRole: 'admin',
    saveUid: c.clientUid,
    disabled: c.status === 'closed',
    notice: 'Chat ended when this case closed.',
  });

  // Admin-only, and admin-only by rule — see the `advisor` match in
  // firestore.rules. An approved draft goes out through the same send path as
  // anything I type, so it lands as an ordinary message from me.
  mountAdvisor({
    container: el.querySelector('#advisor'),
    kind: 'case',
    id: caseId,
    user,
    onSend: (text) => chat.send(text),
  });
}

async function api(body) {
  const idToken = await user.getIdToken();
  const res = await fetch('/api/admin/case-update', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ caseId, ...body }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
  return out;
}

async function saveLink() {
  const value = document.getElementById('joinlink').value.trim();
  try {
    await api({ action: 'join-link', joinLink: value });
    load();
  } catch (err) { alert(err.message); }
}

async function milestone(action, btn) {
  if (action === 'close' && !confirm('Close this case? The client keeps the file forever; chat ends (Phase 3).')) return;
  btn.disabled = true;
  try {
    await api({ action });
    load();
  } catch (err) {
    btn.disabled = false;
    alert(err.message);
  }
}

async function upload(file, kind, milestoneAction) {
  if (!file) return;
  const bar = document.getElementById('bar');
  const err = document.getElementById('err');
  err.hidden = true;
  bar.hidden = false;
  const safe = file.name.replace(/[^\w.\- ]+/g, '_');
  const task = uploadBytesResumable(ref(storage, `cases/${caseId}/${kind}/${safe}`), file);
  try {
    await new Promise((resolve, reject) => {
      task.on('state_changed',
        (snap) => { bar.value = (snap.bytesTransferred / snap.totalBytes) * 100; },
        reject, resolve);
    });
    await api({ action: milestoneAction });
    load();
  } catch (e) {
    err.textContent = `Upload failed: ${e.message}`;
    err.hidden = false;
  }
  bar.hidden = true;
}

async function refreshFiles() {
  const listEl = document.getElementById('files');
  const rows = [];
  for (const [kind, path] of [
    ['report', `cases/${caseId}/report`],
    ['recording', `cases/${caseId}/recording`],
    ['upload', `cases/${caseId}/uploads`],
    ['saved', `profiles/${data.clientUid}/saved`],
  ]) {
    try {
      const res = await listAll(ref(storage, path));
      for (const item of res.items) {
        const [url, meta] = await Promise.all([getDownloadURL(item), getMetadata(item)]);
        rows.push({ kind, name: item.name, url, ts: new Date(meta.timeCreated), size: meta.size });
      }
    } catch { /* empty */ }
  }
  if (!rows.length) {
    listEl.innerHTML = '<li class="dim small">No files yet.</li>';
    return;
  }
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  listEl.innerHTML = rows.map((r) => `
    <li>
      <span class="fname"><span class="kind-pill ${r.kind}">${r.kind === 'saved' ? 'FROM CHAT' : r.kind.toUpperCase()}</span>
        <a href="${r.url}" target="_blank" rel="noopener">${esc(r.name)}</a></span>
      <span class="fmeta">${fmt.format(r.ts)} · ${prettySize(r.size)}</span>
    </li>`).join('');
}

// ---- follow-up status + the scheduling panel ----

const FOLLOWUP_EXPIRY_MS = 30 * 86_400_000;

function followUpDaysLeft(c) {
  const base = c.appointment?.start ? toDate(c.appointment.start).getTime() : null;
  if (!base) return null;
  return Math.ceil((base + FOLLOWUP_EXPIRY_MS - Date.now()) / 86_400_000);
}
function followUpAvailable(c) {
  if (!c.addOnFollowUp || c.followUp) return false;
  const days = followUpDaysLeft(c);
  return days === null || days > 0;
}
function followUpUnavailableReason(c) {
  if (!c.addOnFollowUp) return 'not purchased';
  if (c.followUp) return 'already scheduled';
  return 'expired — use Charge at 0% to honor it';
}

/**
 * Everything that matters, one section: appointment, session type, money,
 * the report clock (strict 7 calendar days, loud as it tightens), follow-up
 * state, and any payment the client still owes.
 */
function infoBar(c, mtFmt, start, due) {
  // Compact date form so values sit on one line even at phone width.
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const rows = [];
  const row = (label, value, color) => rows.push(`
    <span style="font:600 .62rem/1.7 ui-monospace,monospace; letter-spacing:.13em; color:var(--dim); white-space:nowrap;">${label}</span>
    <span class="small" style="color:${color || 'var(--ink)'}; font-weight:600; min-width:0;">${value}</span>`);

  if (c.clientName || c.clientDob) {
    const age = c.clientDob ? Math.floor((Date.now() - new Date(c.clientDob + 'T00:00:00').getTime()) / 31_557_600_000) : null;
    row('CLIENT', `${esc(c.clientName || '?')}${c.clientDob ? ` <span class="dim">· DOB ${esc(c.clientDob)}${age !== null ? ` (${age})` : ''}</span>` : ''}${c.clientEmail ? ` <span class="dim">· ${esc(c.clientEmail)}</span>` : ''}`);
  }
  row('CALL', start
    ? `${fmt.format(start)} MST · ${esc(c.appointment.method)}${c.publicElection?.choice === 'public' ? ' · <span style="color:var(--magenta)">PUBLIC</span>' : ''}`
    : 'no appointment', start ? null : 'var(--danger)');

  const extraCents = Array.isArray(c.extraPayments)
    ? c.extraPayments.reduce((x, p) => x + (p.amountCents || 0), 0) : 0;
  const totalCents = (c.stripe?.amountTotal || 0) + extraCents;
  if (totalCents)
    row('PAID', `$${(totalCents / 100).toLocaleString()}${extraCents ? ` <span class="dim">(case $${((c.stripe?.amountTotal || 0) / 100).toLocaleString()} + sessions $${(extraCents / 100).toLocaleString()})</span>` : ''}`, 'var(--cyan)');

  // The report clock — strict 7 calendar days on this side of the counter.
  if (c.status === 'delivered' || c.status === 'closed')
    row('REPORT', c.status === 'closed' ? 'delivered · case closed' : 'DELIVERED', 'var(--cyan)');
  else if (due !== null)
    row('REPORT', due >= 0 ? `due in ${due} day${due === 1 ? '' : 's'}` : `OVERDUE ${-due}d`,
      due < 0 ? 'var(--danger)' : due <= 3 ? 'var(--magenta)' : 'var(--cyan)');
  else row('REPORT', '<span class="dim">clock starts at "Call done"</span>');

  if (c.followUp)
    row(c.followUp.kind === 'followup' ? 'FOLLOW-UP' : 'SESSION',
      `${fmt.format(toDate(c.followUp.start))} MST${c.followUp.amountCents ? ` · $${(c.followUp.amountCents / 100).toLocaleString()} paid` : ''}`,
      'var(--cyan)');
  else if (c.addOnFollowUp) {
    const days = followUpDaysLeft(c);
    if (days !== null && days <= 0) row('FOLLOW-UP', 'EXPIRED', 'var(--danger)');
    else row('FOLLOW-UP', days === null
      ? 'paid · unscheduled'
      : `paid · <strong>${days}d left</strong> to use${c.followUpExpiryWarned ? ' <span class="dim">· client warned</span>' : ''}`, 'var(--magenta)');
  }

  if (c.pendingExtra)
    row('UNPAID', `${esc(c.pendingExtra.label)} · $${(c.pendingExtra.amountCents / 100).toLocaleString()} · ${fmt.format(toDate(c.pendingExtra.start))} MST`,
      'var(--magenta)');
  if (c.needsReschedule) row('ALERT', 'NEEDS RESCHEDULE', 'var(--danger)');

  return `<div class="panel" style="display:grid; grid-template-columns:max-content 1fr;
    column-gap:1.1rem; row-gap:.5rem; align-items:baseline;
    margin:.7rem 0 1rem; padding:.85rem 1rem;">${rows.join('')}</div>`;
}

async function wireScheduler(el) {
  const slotSel = el.querySelector('#sched-slot');
  const chargeBox = el.querySelector('#sched-charge');
  el.querySelectorAll('input[name=sched-mode]').forEach((r) =>
    r.addEventListener('change', () => { chargeBox.hidden = r.value !== 'charge' || !r.checked; }));

  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  try {
    const snapshot = await getDocs(query(collection(db, 'availability'), where('state', '==', 'open')));
    const slots = [];
    snapshot.forEach((d) => {
      const s = d.data();
      const start = toDate(s.start);
      if (start.getTime() > Date.now()) slots.push({ id: d.id, start });
    });
    slots.sort((a, b) => a.start - b.start);
    // Custom time goes last when there's real inventory (an open slot is the
    // common case) and first when there isn't — with no slots open, typing a
    // time is the only thing left to do.
    slotSel.innerHTML = slots.length
      ? slots.map((s) => `<option value="${s.id}">${mtFmt.format(s.start)} MST</option>`).join('') + CUSTOM_OPTION
      : CUSTOM_OPTION;
  } catch (err) {
    slotSel.innerHTML = CUSTOM_OPTION;
    console.warn("couldn't load open slots:", err.message);
  }

  const customBox = el.querySelector('#sched-custom');
  const whenInput = el.querySelector('#sched-when');
  const syncCustom = () => { customBox.hidden = slotSel.value !== CUSTOM; };
  slotSel.addEventListener('change', syncCustom);
  syncCustom();

  el.querySelector('#sched-go').addEventListener('click', async () => {
    const btn = el.querySelector('#sched-go');
    const errEl = el.querySelector('#sched-err');
    const resultEl = el.querySelector('#sched-result');
    const slotId = slotSel.value;
    const mode = el.querySelector('input[name=sched-mode]:checked').value;
    errEl.hidden = true;

    // A custom time is typed as MST wall-clock; MST is a fixed -07:00, so
    // stamping the offset on turns it into the exact instant regardless of
    // which timezone this browser thinks it's in.
    let customStart;
    if (slotId === CUSTOM) {
      if (!whenInput.value) { errEl.textContent = 'Pick a date and time.'; errEl.hidden = false; return; }
      const at = new Date(`${whenInput.value}:00-07:00`);
      if (Number.isNaN(at.getTime())) { errEl.textContent = "That date and time didn't parse."; errEl.hidden = false; return; }
      if (at.getTime() < Date.now() &&
          !confirm(`${mtFmt.format(at)} MST is in the past. Book it anyway?`)) return;
      customStart = at.toISOString();
    } else if (!slotId) {
      errEl.textContent = 'Pick a slot.';
      errEl.hidden = false;
      return;
    }

    btn.disabled = true;
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/admin/schedule', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          caseId, mode,
          slotId: customStart ? undefined : slotId,
          customStart,
          customDurationMin: customStart ? Number(el.querySelector('#sched-dur').value) : undefined,
          pct: mode === 'charge' ? Number(el.querySelector('#sched-pct').value) : undefined,
          tagline: mode === 'charge' ? el.querySelector('#sched-tag').value : undefined,
        }),
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || `Request failed (${res.status})`);
      if (out.checkoutUrl) {
        resultEl.innerHTML = `Scheduled pending payment ($${(out.amountCents / 100).toLocaleString()}).
          The client got an email and a pay button on their case page — or send this link in chat:
          <input type="text" readonly value="${esc(out.checkoutUrl)}" onclick="this.select()" style="margin-top:.3rem;">`;
      } else {
        resultEl.textContent = `Booked: ${out.scheduled}. The client has been emailed.`;
        setTimeout(load, 1200);
      }
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
    }
    btn.disabled = false;
  });
}

function toDate(v) { return v?.toDate ? v.toDate() : new Date(v || 0); }
function prettySize(bytes) {
  if (!bytes) return '';
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
