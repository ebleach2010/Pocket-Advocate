// Admin case detail: everything the client sees, plus the levers — post the
// join link / phone note, view + download uploads, upload the recording and
// report (which advances the status and pings the client in-app), close case.

import {
  db, storage, doc, getDoc,
  ref, uploadBytesResumable, listAll, getDownloadURL, getMetadata,
} from './firebase.js';
import { requireAdmin, hydrateNav } from './auth.js';
import { mountChat } from './chat.js';

const MOUNTAIN_TZ = 'Etc/GMT+7';
const caseId = new URLSearchParams(location.search).get('id');

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
      <h1 style="margin:0;">${esc(c.clientEmail || c.clientUid)}</h1>
      <span class="status-pill">${(c.status || '?').replace('_', ' ').toUpperCase()}</span>
    </div>
    <p class="dim small" style="margin-top:.4rem;">
      ${start ? `${mtFmt.format(start)} MST · ${c.appointment.method}` : 'no appointment'}
      · ${c.publicElection?.choice === 'public' ? '<strong style="color:var(--magenta)">PUBLIC session</strong>' : 'private session'}
      ${c.stripe?.amountTotal ? `· <strong style="color:var(--cyan)">$${(c.stripe.amountTotal / 100).toLocaleString()} paid</strong>` : ''}
      ${c.addOnFollowUp ? '· follow-up included' : ''}
      ${due !== null ? `· report due in <strong>${due}d</strong>` : ''}
    </p>

    <div class="panel">
      <h3>Meeting link / phone note</h3>
      <p class="dim small">${c.appointment?.method === 'phone'
        ? `Client expects a call at <strong>${esc(c.appointment.phone || '?')}</strong>. Post the number you'll call from:`
        : 'Paste the Discord voice-channel or Zoom link the client should join:'}</p>
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

    <div class="panel">
      <h3>Chat with the client</h3>
      <div id="chat"></div>
    </div>

    <div class="panel">
      <h3>Milestones</h3>
      <div class="actions" style="margin-top:.3rem;">
        <button class="btn secondary" data-action="recording-uploaded">Call done — start 7-day report clock</button>
        <button class="btn secondary" data-action="report-uploaded">Report delivered</button>
        ${c.status !== 'closed' ? '<button class="btn danger" data-action="close">Close case</button>' : '<span class="dim small">Case closed.</span>'}
      </div>
      <p class="dim small" style="margin-top:.6rem;">Uploading a recording or report triggers its milestone automatically; the buttons cover manual corrections.</p>
    </div>`;

  el.querySelector('#save-link').addEventListener('click', saveLink);
  el.querySelectorAll('[data-action]').forEach((b) =>
    b.addEventListener('click', () => milestone(b.dataset.action, b)));
  el.querySelector('#up-recording').addEventListener('change', (e) =>
    upload(e.target.files[0], 'recording', 'recording-uploaded'));
  el.querySelector('#up-report').addEventListener('change', (e) =>
    upload(e.target.files[0], 'report', 'report-uploaded'));

  mountChat({
    container: el.querySelector('#chat'),
    parentPath: ['cases', caseId],
    user,
    myRole: 'admin',
    saveUid: c.clientUid,
    disabled: c.status === 'closed',
    notice: 'Chat ended when this case closed.',
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
