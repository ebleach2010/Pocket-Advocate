// Shared live chat: used by the client case dashboard, the subscriber page,
// and both admin thread views. Messages live in {parent}/chat; the parent doc
// carries a `lastMessage` pointer (the one client-writable field on parent
// docs — see firestore.rules) that powers the admin inbox and email digest.
//
// Attachments: the 📎 button uploads into {parent}/chat-files and sends a
// message carrying the file. Long-pressing an attachment (or right-clicking
// on desktop) asks yes/no and saves a copy to the client's profile shelf
// (profiles/{uid}/saved), where the Documents tab picks it up.

import {
  db, rtdb, storage, collection, doc, addDoc, updateDoc, onSnapshot,
  query, orderBy, limit, serverTimestamp, rtdbRef, onValue,
  ref, uploadBytesResumable, getDownloadURL,
} from './firebase.js';

const MAX_BYTES = 25 * 1024 * 1024;
const LONG_PRESS_MS = 550;

/** Shows Eric's live status in `el` (any element with a .p-dot child). */
export function watchPresence(el) {
  onValue(rtdbRef(rtdb, 'presence/eric'), (snap) => {
    const online = snap.val() === true;
    el.querySelector('.p-dot')?.classList.toggle('on', online);
    const label = el.querySelector('.p-label');
    if (label) label.textContent = online ? 'Eric is online' : 'Eric is away';
  });
}

/**
 * Mounts a chat thread.
 * opts: {
 *   container    — element to render into
 *   parentPath   — e.g. ['cases', caseId] or ['subscriptions', uid]
 *   user         — signed-in Firebase user
 *   myRole       — 'client' | 'admin'
 *   saveUid      — whose profile shelf receives long-press saves (the client's uid)
 *   disabled     — composer off (closed case / lapsed subscription)
 *   notice       — text shown instead of the composer when disabled
 * }
 */
export function mountChat({ container, parentPath, user, myRole, saveUid, disabled = false, notice = '' }) {
  container.innerHTML = `
    <div class="chat-log" data-log><p class="dim small">Loading messages…</p></div>
    ${disabled
      ? `<p class="dim small chat-notice">${esc(notice)}</p>`
      : `<form class="chat-form" data-form>
           <label class="attach-btn" title="Attach a file">📎<input type="file" hidden data-attach
             accept=".pdf,.jpg,.jpeg,.png,.heic,.gif,.webp,.dcm,.dicom,.zip,.mp4,.mov,.doc,.docx,.txt"></label>
           <input type="text" data-input maxlength="2000" placeholder="Write a message…" autocomplete="off">
           <button class="btn" type="submit">Send</button>
         </form>
         <progress data-progress max="100" value="0" hidden></progress>
         <p class="dim small" data-hint hidden>Tip: press and hold a shared file to save it to Documents.</p>
         <p class="error" data-err hidden></p>`}
  `;
  const log = container.querySelector('[data-log]');
  const errEl = container.querySelector('[data-err]');
  const parentRef = doc(db, ...parentPath);
  const messagesRef = collection(db, ...parentPath, 'chat');

  onSnapshot(query(messagesRef, orderBy('ts', 'asc'), limit(200)), (snap) => {
    if (snap.empty) {
      log.innerHTML = '<p class="dim small">No messages yet. Say hi.</p>';
      return;
    }
    const fmt = new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    log.innerHTML = '';
    let hasAttachment = false;
    snap.forEach((m) => {
      const data = m.data();
      const mine = data.from === user.uid;
      const div = document.createElement('div');
      div.className = `msg ${mine ? 'me' : 'them'}`;
      if (data.text) {
        const span = document.createElement('span');
        span.className = 'msg-text';
        span.textContent = data.text;
        div.appendChild(span);
      }
      if (data.attachment && data.attachment.url) {
        hasAttachment = true;
        div.appendChild(renderAttachment(data.attachment, saveUid));
      }
      const meta = document.createElement('span');
      meta.className = 'msg-meta';
      meta.textContent = data.ts?.toDate ? fmt.format(data.ts.toDate()) : 'sending…';
      div.appendChild(meta);
      log.appendChild(div);
    });
    const hint = container.querySelector('[data-hint]');
    if (hint) hint.hidden = !hasAttachment;
    log.scrollTop = log.scrollHeight;
  }, (err) => {
    log.innerHTML = `<p class="error">Couldn't load messages: ${esc(err.message)}</p>`;
  });

  async function send({ text = '', attachment = null }) {
    const message = { from: user.uid, role: myRole, text, ts: serverTimestamp() };
    if (attachment) message.attachment = attachment;
    await addDoc(messagesRef, message);
    await updateDoc(parentRef, {
      lastMessage: {
        text: (text || `📎 ${attachment?.name || 'file'}`).slice(0, 120),
        from: user.uid, role: myRole, ts: new Date(), emailed: false,
      },
    });
  }

  const form = container.querySelector('[data-form]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = container.querySelector('[data-input]');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    errEl.hidden = true;
    try {
      await send({ text });
    } catch (err) {
      errEl.textContent = `Couldn't send: ${err.message}`;
      errEl.hidden = false;
      input.value = text;
    }
  });

  container.querySelector('[data-attach]')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    errEl.hidden = true;
    if (file.size > MAX_BYTES) {
      errEl.textContent = `${file.name} is over 25 MB.`;
      errEl.hidden = false;
      return;
    }
    const bar = container.querySelector('[data-progress]');
    bar.hidden = false;
    try {
      const safe = file.name.replace(/[^\w.\- ]+/g, '_');
      const storageRef = ref(storage, `${parentPath.join('/')}/chat-files/${Date.now()}-${safe}`);
      const task = uploadBytesResumable(storageRef, file);
      await new Promise((resolve, reject) => {
        task.on('state_changed',
          (s) => { bar.value = (s.bytesTransferred / s.totalBytes) * 100; },
          reject, resolve);
      });
      const url = await getDownloadURL(storageRef);
      await send({
        attachment: {
          name: file.name, url, path: storageRef.fullPath,
          size: file.size, contentType: file.type || 'application/octet-stream',
        },
      });
    } catch (err) {
      errEl.textContent = `Upload failed: ${err.message}`;
      errEl.hidden = false;
    }
    bar.hidden = true;
  });
}

// ---- attachment rendering + long-press save ----

function renderAttachment(att, saveUid) {
  let el;
  if ((att.contentType || '').startsWith('image/')) {
    el = document.createElement('img');
    el.className = 'msg-img';
    el.src = att.url;
    el.alt = att.name;
    el.loading = 'lazy';
  } else {
    el = document.createElement('a');
    el.className = 'file-chip';
    el.href = att.url;
    el.target = '_blank';
    el.rel = 'noopener';
    el.textContent = `📄 ${att.name}`;
  }
  if (saveUid) attachLongPress(el, att, saveUid);
  return el;
}

function attachLongPress(el, att, saveUid) {
  let timer = null;
  const start = () => { timer = setTimeout(() => { timer = null; promptSave(att, saveUid); }, LONG_PRESS_MS); };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  el.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((ev) =>
    el.addEventListener(ev, cancel));
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); promptSave(att, saveUid); });
}

async function promptSave(att, saveUid) {
  if (!confirm(`Save "${att.name}" to Documents?`)) return;
  try {
    const blob = await (await fetch(att.url)).blob();
    const dest = ref(storage, `profiles/${saveUid}/saved/${Date.now()}-${att.name.replace(/[^\w.\- ]+/g, '_')}`);
    const task = uploadBytesResumable(dest, blob, { contentType: att.contentType });
    await new Promise((resolve, reject) => task.on('state_changed', null, reject, resolve));
    alert(`Saved "${att.name}" to Documents.`);
    document.dispatchEvent(new CustomEvent('pa-saved-file'));
  } catch (err) {
    alert(`Couldn't save: ${err.message}`);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
