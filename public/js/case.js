// The client case dashboard (Phases 2–3): after booking, the case lives in
// three tabs — Progress (timeline + appointment), Chat (live, with file
// sharing), and Documents (uploads from both ends + files saved from chat).

import {
  db, storage, collection, getDocs, query, where,
  ref, uploadBytesResumable, listAll, getDownloadURL, getMetadata,
} from './firebase.js';
import { requireUser, hydrateNav } from './auth.js';
import { mountChat, watchPresence } from './chat.js';
import { initSetupGuide } from './onboarding.js';

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
const STATUS_RANK = { paid: 1, forms: 1, confirmed: 2, awaiting_report: 4, delivered: 6, closed: 7 };
const STATUS_LABEL = {
  paid: 'OPEN', forms: 'FINISH FORMS', confirmed: 'CONFIRMED',
  awaiting_report: 'REPORT DUE', delivered: 'REPORT READY', closed: 'CLOSED',
};

// Isolated preview: /case.html?demo=1 renders the full client dashboard with
// sample data — no login, no booking, no real data touched. Live panels (chat,
// documents) show representative static samples.
const DEMO = new URLSearchParams(location.search).get('demo') === '1';

hydrateNav();
let user = null;
let cases = [];
let currentId = null;
let currentTab = 'progress';

if (DEMO) {
  user = { uid: 'demo', getIdToken: async () => '' };
  cases = [DEMO_CASE()];
  currentId = 'demo';
  renderDemoBanner();
  render();
} else {
  user = await requireUser();
  if (user) {
    boot();
    // Introductory setup guide (install + notifications) for any signed-in
    // client — not gated on having a case.
    initSetupGuide(user, document.querySelector('main'));
  }
}

function DEMO_CASE() {
  const start = new Date(Date.now() + 4 * 86_400_000);
  return {
    id: 'demo',
    status: 'confirmed',
    createdAt: new Date(Date.now() - 2 * 86_400_000),
    clientName: 'Jane Sample',
    clientEmail: 'jane@example.com',
    appointment: { start, durationMin: 60, method: 'zoom', joinLink: null, phone: null },
    publicElection: { choice: 'private', revocableUntil: start },
    addOnFollowUp: true,
  };
}

function renderDemoBanner() {
  const main = document.querySelector('main');
  const b = document.createElement('div');
  b.className = 'panel';
  b.style.cssText = 'border-color:var(--magenta); box-shadow:var(--glow-m);';
  b.innerHTML = `<p style="margin:0;"><strong>Preview mode</strong> — this is exactly what a client sees, with sample data. Nothing here is real. <a href="/case.html">Exit preview</a></p>`;
  main.prepend(b);
}

async function boot() {
  const container = document.getElementById('cases');
  try {
    const snapshot = await getDocs(query(collection(db, 'cases'), where('clientUid', '==', user.uid)));
    cases = [];
    snapshot.forEach((d) => cases.push({ id: d.id, ...d.data() }));
  } catch (err) {
    container.innerHTML = `<p class="error">Couldn't load your cases: ${err.message}</p>`;
    return;
  }
  if (!cases.length) {
    container.innerHTML =
      '<p class="dim">No cases yet.</p><p><a class="btn" href="/book.html">Book an Advocacy Case →</a></p>';
    return;
  }
  cases.sort((a, b) => toDate(b.createdAt) - toDate(a.createdAt));
  currentId = currentId && cases.some((c) => c.id === currentId) ? currentId : cases[0].id;
  render();
}

function render() {
  const container = document.getElementById('cases');
  const c = cases.find((x) => x.id === currentId);
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });

  container.innerHTML = `
    ${cases.length > 1 ? `
      <div class="case-picker">
        ${cases.map((x) => `
          <button class="chip-label ${x.id === currentId ? 'selected' : ''}" data-case="${x.id}">
            ${x.appointment?.start ? mtFmt.format(toDate(x.appointment.start)) : 'Case'}
            ${x.status === 'closed' ? ' · closed' : ''}
          </button>`).join('')}
      </div>` : ''}
    <div class="row">
      <h2 style="margin:0;">Advocacy Case</h2>
      <span class="status-pill ${c.status === 'closed' ? 'closed' : ''}">${STATUS_LABEL[c.status] || c.status}</span>
    </div>
    <nav class="subtabs" role="tablist">
      <button data-tab="progress" class="${currentTab === 'progress' ? 'active' : ''}">Progress</button>
      <button data-tab="chat" class="${currentTab === 'chat' ? 'active' : ''}">Chat</button>
      <button data-tab="docs" class="${currentTab === 'docs' ? 'active' : ''}">Documents</button>
    </nav>
    <section id="tab-body"></section>`;

  container.querySelectorAll('[data-case]').forEach((b) =>
    b.addEventListener('click', () => { currentId = b.dataset.case; render(); }));
  container.querySelectorAll('[data-tab]').forEach((b) =>
    b.addEventListener('click', () => { currentTab = b.dataset.tab; render(); }));

  const body = container.querySelector('#tab-body');
  if (currentTab === 'progress') renderProgress(body, c);
  else if (currentTab === 'chat') renderChat(body, c);
  else renderDocs(body, c);
}

// ---- Progress tab ----
function renderProgress(el, c) {
  const start = c.appointment && toDate(c.appointment.start);
  const closed = c.status === 'closed';
  const rank = STATUS_RANK[c.status] ?? 1;
  const mtFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
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
    <div class="panel">
      ${start ? `
        <p style="margin:0 0 .3rem;"><strong>${mtFmt.format(start)} MST</strong><br>
        <span class="dim small">${localFmt.format(start)} your time</span>
        <a href="#" class="small" data-ics>+ calendar</a></p>` : ''}
      <p class="dim small">${methodLine}</p>
      <ul class="timeline">
        ${STEPS.map(([, label], i) => `
          <li class="${i + 1 < rank ? 'done' : i + 1 === rank ? (closed ? 'done' : 'now') : ''}">
            <span class="t-dot"></span>${label}</li>`).join('')}
      </ul>
      <p class="dim small">Session: <strong style="color:${election.choice === 'public' ? 'var(--magenta)' : 'var(--cyan)'};">
        ${election.choice === 'public' ? 'PUBLIC — streams live on YouTube' : 'PRIVATE'}</strong></p>
      ${revocable ? `<p><button class="btn ghost" data-private>Make it private</button></p>` : ''}
      ${followUpSection(c)}
    </div>`;

  el.querySelector('[data-ics]')?.addEventListener('click', (e) => {
    e.preventDefault();
    downloadIcs(c, start);
  });
  el.querySelector('[data-private]')?.addEventListener('click', (e) => makePrivate(c.id, e.target));
  return;

  /** Second-session state: scheduled follow-up, a pay-to-confirm prompt, or the unused add-on with its deadline. */
  function followUpSection(c) {
    const mt = new Intl.DateTimeFormat('en-US', {
      timeZone: MOUNTAIN_TZ, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    if (c.followUp) {
      const s = toDate(c.followUp.start);
      return `<p class="small" style="margin-top:.5rem;"><strong style="color:var(--cyan)">
        ${c.followUp.kind === 'followup' ? 'Follow-up session' : esc(c.followUp.label || 'Session')}:</strong>
        ${mt.format(s)} MST</p>`;
    }
    if (c.pendingExtra) {
      const s = toDate(c.pendingExtra.start);
      return `<div style="border:1px solid var(--magenta); border-radius:10px; padding:.6rem .8rem; margin-top:.6rem;">
        <p class="small" style="margin:0 0 .4rem;"><strong>${esc(c.pendingExtra.label)}</strong> —
          ${mt.format(s)} MST · $${(c.pendingExtra.amountCents / 100).toLocaleString()}</p>
        <p class="dim small" style="margin:0 0 .5rem;">Eric scheduled this for you. The time is held for 24 hours — pay to confirm it.</p>
        <a class="btn" href="${esc(c.pendingExtra.url)}">Pay & confirm</a>
      </div>`;
    }
    if (c.addOnFollowUp) {
      const base = c.appointment?.start ? toDate(c.appointment.start).getTime() : null;
      const expires = base ? base + 30 * 86_400_000 : null;
      const lapsed = expires && Date.now() > expires;
      if (lapsed) return '';
      return `<p class="dim small">Follow-up add-on included — message Eric in chat to schedule your second session.${
        expires && Date.now() > base
          ? ` Use it by <strong style="color:var(--ink)">${mt.format(new Date(expires))} MST</strong> (one month after your discussion).`
          : ' It must be used within one month of your first discussion.'
      }</p>`;
    }
    return '';
  }
}

// ---- Chat tab ----
function renderChat(el, c) {
  if (DEMO) return renderDemoChat(el);
  const closed = c.status === 'closed';
  el.innerHTML = `
    <p style="margin:.2rem 0 .3rem;"><span class="p-dot"></span><span class="p-label">Checking…</span></p>
    <div class="panel" data-chat></div>`;
  watchPresence(el);
  mountChat({
    container: el.querySelector('[data-chat]'),
    parentPath: ['cases', c.id],
    user,
    myRole: 'client',
    saveUid: user.uid,
    disabled: closed,
    notice: 'This chat ended when the case closed. Your documents remain yours forever.',
  });
}

function renderDemoChat(el) {
  const msgs = [
    { role: 'admin', text: "Hi Jane — I've got your case. Upload any labs or imaging when you can and we'll dig into it on our call.", d: '10:02 AM' },
    { role: 'client', text: 'Thank you! Just added my recent MRI and bloodwork to Documents.', d: '10:15 AM' },
    { role: 'admin', text: 'Perfect, I see them. I already have a couple of questions ready for your neurologist. See you Thursday.', d: '10:20 AM' },
  ];
  el.innerHTML = `
    <p style="margin:.2rem 0 .3rem;"><span class="p-dot on"></span><span class="p-label">Eric is online</span></p>
    <div class="panel">
      <div class="chat-log">
        ${msgs.map((m) => `
          <div class="msg ${m.role === 'client' ? 'me' : 'them'}">
            <span class="msg-text">${esc(m.text)}</span>
            <span class="msg-meta">${m.d}</span>
          </div>`).join('')}
      </div>
      <form class="chat-form" onsubmit="return false;">
        <label class="attach-btn" title="Attach a file">📎</label>
        <input type="text" placeholder="Write a message…" autocomplete="off">
        <button class="btn" type="submit">Send</button>
      </form>
      <p class="dim small" style="margin-top:.4rem;">Preview only — messages aren't sent.</p>
    </div>`;
}

// ---- Documents tab ----
function renderDocs(el, c) {
  if (DEMO) return renderDemoDocs(el);
  const closed = c.status === 'closed';
  el.innerHTML = `
    ${closed
      ? '<p class="dim small">This case is closed. Your documents stay here forever — download or print any of them.</p>'
      : `<label class="dropzone" data-drop>
           Tap to add labs, imaging, or records<br>
           <span class="small">PDF · JPEG · PNG · HEIC · DICOM · ZIP — 25 MB max each</span>
           <input type="file" accept="${ACCEPT}" multiple hidden data-file-input>
         </label>
         <progress data-progress max="100" value="0" hidden></progress>
         <p class="error" data-upload-error hidden></p>`}
    <ul class="filelist" data-files><li class="dim small">Loading files…</li></ul>`;
  const input = el.querySelector('[data-file-input]');
  input?.addEventListener('change', () => uploadFiles(c, el, [...input.files]));
  refreshFiles(c, el);
  document.addEventListener('pa-saved-file', () => refreshFiles(c, el), { once: true });
}

function renderDemoDocs(el) {
  const files = [
    { kind: 'upload', name: 'MRI_brain_2026-05.pdf', meta: 'May 12 · 4.2 MB' },
    { kind: 'upload', name: 'Bloodwork_June.pdf', meta: 'Jun 3 · 320 KB' },
    { kind: 'saved', name: 'referral_letter.jpg', meta: 'Jun 4 · 1.1 MB' },
  ];
  el.innerHTML = `
    <label class="dropzone">Tap to add labs, imaging, or records<br>
      <span class="small">PDF · JPEG · PNG · HEIC · DICOM · ZIP — 25 MB max each</span></label>
    <ul class="filelist">
      ${files.map((r) => `
        <li>
          <span class="fname"><span class="kind-pill ${r.kind}">${r.kind === 'saved' ? 'FROM CHAT' : r.kind.toUpperCase()}</span>
            <a href="#" onclick="return false;">${esc(r.name)}</a></span>
          <span class="fmeta">${r.meta}</span>
        </li>`).join('')}
    </ul>
    <p class="dim small" style="margin-top:.4rem;">Preview only — sample documents.</p>`;
}

async function refreshFiles(c, el) {
  const listEl = el.querySelector('[data-files]');
  if (!listEl) return;
  const kinds = [
    ['report', `cases/${c.id}/report`],
    ['recording', `cases/${c.id}/recording`],
    ['upload', `cases/${c.id}/uploads`],
    ['saved', `profiles/${user.uid}/saved`],
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
    listEl.innerHTML = '<li class="dim small">Nothing here yet. Add files above, or share them in chat and long-press to save.</li>';
    return;
  }
  const order = { report: 0, recording: 1, upload: 2, saved: 3 };
  rows.sort((a, b) => order[a.kind] - order[b.kind] || b.ts - a.ts);
  const fmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });
  listEl.innerHTML = rows.map((r) => `
    <li>
      <span class="fname"><span class="kind-pill ${r.kind}">${r.kind === 'saved' ? 'FROM CHAT' : r.kind.toUpperCase()}</span>
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
  refreshFiles(c, el);
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
    boot();
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
