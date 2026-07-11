// The client case dashboard (Phase 2): status timeline, appointment card with
// add-to-calendar, uploads to Storage, the file list (uploads + recording +
// report), and the make-my-session-private revocation. Chat lands in Phase 3.

import {
  db, storage, collection, getDocs, query, where,
  ref, uploadBytesResumable, listAll, getDownloadURL, getMetadata,
} from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';

// MST = fixed UTC-7 year-round (IANA 'Etc/GMT+7'; the sign is inverted by design).
const MOUNTAIN_TZ = 'Etc/GMT+7';
const ACCEPT = '.pdf,.jpg,.jpeg,.png,.heic,.dcm,.dicom,.zip';
const MAX_BYTES = 25 * 1024 * 1024;

const STEPS = [
  ['paid', 'Paid'],
  ['forms', 'Forms acknowledged'],
  ['confirmed', 'Confirmed — upload labs & imaging before the call'],
  ['call', 'The discussion'],
  ['awaiting_report', 'Recording lands in your file'],
  ['delivered', 'Report — within 7 days of the call'],
  ['closed', 'Closed — the file is yours forever'],
];
// How far along the timeline each case status reaches.
const STATUS_RANK = { paid: 1, forms: 1, confirmed: 2, awaiting_report: 4, delivered: 6, closed: 7 };
const STATUS_LABEL = {
  paid: 'OPEN', forms: 'FINISH FORMS', confirmed: 'CONFIRMED',
  awaiting_report: 'REPORT DUE', delivered: 'REPORT READY', closed: 'CLOSED',
};

hydrateNav();
const user = await requireUser();
if (user) loadCases();

async function loadCases() {
  const container = document.getElementById('cases');
  let docs = [];
  try {
    const snapshot = await getDocs(query(collection(db, 'cases'), where('clientUid', '==', user.uid)));
    snapshot.forEach((d) => docs.push({ id: d.id, ...d.data() }));
  } catch (err) {
    container.innerHTML = `<p class="error">Couldn't load your cases: ${err.message}</p>`;
    return;
  }
  if (!docs.length) {
    container.innerHTML =
      '<p class="dim">No cases yet.</p><p><a class="btn" href="/book.html">Book an Advocacy Case →</a></p>';
    return;
  }
  docs.sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt));
  container.innerHTML = '';
  for (const c of docs) container.appendChild(renderCase(c));
  docs.forEach((c) => refreshFiles(c));
}

function renderCase(c) {
  const el = document.createElement('div');
  el.className = 'panel';
  el.id = `case-${c.id}`;
  const start = c.appointment && toDate(c.appointment.start);
  const closed = c.status === 'closed';
  const rank = STATUS_RANK[c.status] ?? 1;

  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
  const localFmt = new Intl.DateTimeFormat('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  });

  const method = c.appointment?.method;
  const methodLine = method === 'phone'
    ? `Phone — Eric calls you at <strong>${esc(c.appointment.phone || 'your number')}</strong>`
    : c.appointment?.joinLink
      ? `${method === 'zoom' ? 'Zoom' : 'Discord'} — <a href="${esc(c.appointment.joinLink)}" rel="noopener">join link</a>`
      : `${method === 'zoom' ? 'Zoom' : 'Discord'} — your join link appears here before the call`;

  const election = c.publicElection || { choice: 'private' };
  const revocable = election.choice === 'public' && !closed &&
    (!election.revocableUntil || toDate(election.revocableUntil) > new Date());

  el.innerHTML = `
    <div class="row">
      <h3 style="margin:0;">Advocacy Case</h3>
      <span class="status-pill ${closed ? 'closed' : ''}">${STATUS_LABEL[c.status] || c.status}</span>
    </div>
    ${start ? `
      <p style="margin:.5rem 0 0;"><strong>${mtFmt.format(start)} MST</strong>
      <span class="dim small">(${localFmt.format(start)} your time)</span>
      <a href="#" class="small" data-ics>+ calendar</a></p>` : ''}
    <ul class="timeline">
      ${STEPS.map(([, label], i) => `
        <li class="${i + 1 < rank ? 'done' : i + 1 === rank ? (closed ? 'done' : 'now') : ''}">
          <span class="t-dot"></span>${label}</li>`).join('')}
    </ul>
    <p class="dim small">${methodLine}</p>
    <p class="dim small">Session: <strong style="color:${election.choice === 'public' ? 'var(--magenta)' : 'var(--cyan)'};">
      ${election.choice === 'public' ? 'PUBLIC — streams live on YouTube' : 'PRIVATE'}</strong></p>
    ${revocable ? `<p><button class="btn ghost" data-private>Make it private</button></p>` : ''}
    ${c.addOnFollowUp ? '<p class="dim small">Follow-up add-on included — book your second session once the report lands.</p>' : ''}

    <h3 style="margin-top:1rem;">Your files</h3>
    ${closed
      ? '<p class="dim small">This case is closed. Your documents stay here forever — download or print any of them.</p>'
      : `<label class="dropzone" data-drop>
           Tap to add labs, imaging, or records<br>
           <span class="small">PDF · JPEG · PNG · HEIC · DICOM · ZIP — 25 MB max each</span>
           <input type="file" accept="${ACCEPT}" multiple hidden data-file-input>
         </label>
         <progress data-progress max="100" value="0" hidden></progress>
         <p class="error" data-upload-error hidden></p>`}
    <ul class="filelist" data-files><li class="dim small">Loading files…</li></ul>
  `;

  el.querySelector('[data-ics]')?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadIcs(c, start);
  });
  el.querySelector('[data-private]')?.addEventListener('click', (e) => makePrivate(c.id, e.target));
  const input = el.querySelector('[data-file-input]');
  input?.addEventListener('change', () => uploadFiles(c, el, [...input.files]));
  return el;
}

// ---- files: everything lives under cases/{id}/ in Storage ----

async function refreshFiles(c) {
  const listEl = document.querySelector(`#case-${c.id} [data-files]`);
  if (!listEl) return;
  const kinds = [
    ['report', `cases/${c.id}/report`],
    ['recording', `cases/${c.id}/recording`],
    ['upload', `cases/${c.id}/uploads`],
  ];
  const rows = [];
  for (const [kind, path] of kinds) {
    try {
      const res = await listAll(ref(storage, path));
      for (const item of res.items) {
        const [url, meta] = await Promise.all([getDownloadURL(item), getMetadata(item)]);
        rows.push({ kind, name: item.name, url, ts: new Date(meta.timeCreated), size: meta.size });
      }
    } catch { /* folder may not exist yet */ }
  }
  if (!rows.length) {
    listEl.innerHTML = '<li class="dim small">Nothing here yet.</li>';
    return;
  }
  rows.sort((a, b) => (a.kind === b.kind ? b.ts - a.ts : a.kind === 'report' ? -1 : b.kind === 'report' ? 1 : a.kind === 'recording' ? -1 : 1));
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  listEl.innerHTML = rows.map((r) => `
    <li>
      <span class="fname"><span class="kind-pill ${r.kind}">${r.kind.toUpperCase()}</span>
        <a href="${r.url}" target="_blank" rel="noopener">${esc(r.name)}</a></span>
      <span class="fmeta">${fmt.format(r.ts)} · ${prettySize(r.size)}</span>
    </li>`).join('');
}

async function uploadFiles(c, el, files) {
  const bar = el.querySelector('[data-progress]');
  const err = el.querySelector('[data-upload-error]');
  const zone = el.querySelector('[data-drop]');
  err.hidden = true;
  for (const file of files) {
    if (file.size > MAX_BYTES) {
      err.textContent = `${file.name} is over 25 MB. Compress it or split it up.`;
      err.hidden = false;
      continue;
    }
    zone.classList.add('busy');
    bar.hidden = false;
    const safe = file.name.replace(/[^\w.\- ]+/g, '_');
    const task = uploadBytesResumable(ref(storage, `cases/${c.id}/uploads/${Date.now()}-${safe}`), file);
    try {
      await new Promise((resolve, reject) => {
        task.on('state_changed',
          (snap) => { bar.value = (snap.bytesTransferred / snap.totalBytes) * 100; },
          reject, resolve);
      });
    } catch (e) {
      err.textContent = `Upload of ${file.name} failed: ${e.message}`;
      err.hidden = false;
    }
  }
  zone.classList.remove('busy');
  bar.hidden = true;
  el.querySelector('[data-file-input]').value = '';
  refreshFiles(c);
}

// ---- actions ----

async function makePrivate(caseId, btn) {
  btn.disabled = true;
  try {
    const idToken = await user.getIdToken();
    const res = await fetch('/api/make-private', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ caseId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not update.');
    loadCases();
  } catch (err) {
    btn.disabled = false;
    alert(err.message);
  }
}

function downloadIcs(c, start) {
  const end = new Date(start.getTime() + (c.appointment.durationMin || 60) * 60_000);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z/, 'Z');
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Pocket Advocate//EN',
    'BEGIN:VEVENT',
    `UID:${c.id}@pocket-advocate`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    'SUMMARY:Pocket Advocate — your advocacy discussion',
    `DESCRIPTION:Method: ${c.appointment.method}. Details on your case page.`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const a = document.createElement('a');
  a.href = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
  a.download = 'pocket-advocate.ics';
  a.click();
}

// ---- utils ----

function toDate(v) {
  if (!v) return new Date(0);
  if (v.toDate) return v.toDate();
  return new Date(v);
}
function prettySize(bytes) {
  if (!bytes) return '';
  if (bytes > 1048576) return (bytes / 1048576).toFixed(1) + ' MB';
  if (bytes > 1024) return Math.round(bytes / 1024) + ' KB';
  return bytes + ' B';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
