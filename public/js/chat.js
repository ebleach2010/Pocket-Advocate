// Shared live chat: used by the client case dashboard, the subscriber page,
// and both admin thread views. Messages live in {parent}/chat; the parent doc
// carries a `lastMessage` pointer (the one client-writable field on parent
// docs — see firestore.rules) that powers the admin inbox and email digest.

import {
  db, rtdb, collection, doc, addDoc, updateDoc, onSnapshot,
  query, orderBy, limit, serverTimestamp, rtdbRef, onValue,
} from './firebase.js';

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
 *   disabled     — composer off (closed case / lapsed subscription)
 *   notice       — text shown instead of the composer when disabled
 * }
 */
export function mountChat({ container, parentPath, user, myRole, disabled = false, notice = '' }) {
  container.innerHTML = `
    <div class="chat-log" data-log><p class="dim small">Loading messages…</p></div>
    ${disabled
      ? `<p class="dim small chat-notice">${esc(notice)}</p>`
      : `<form class="chat-form" data-form>
           <input type="text" data-input maxlength="2000" placeholder="Write a message…" autocomplete="off">
           <button class="btn" type="submit">Send</button>
         </form>
         <p class="error" data-err hidden></p>`}
  `;
  const log = container.querySelector('[data-log]');
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
    snap.forEach((m) => {
      const data = m.data();
      const mine = data.from === user.uid;
      const div = document.createElement('div');
      div.className = `msg ${mine ? 'me' : 'them'}`;
      div.innerHTML = `<span class="msg-text"></span>
        <span class="msg-meta">${data.ts?.toDate ? fmt.format(data.ts.toDate()) : 'sending…'}</span>`;
      div.querySelector('.msg-text').textContent = data.text;
      log.appendChild(div);
    });
    log.scrollTop = log.scrollHeight;
  }, (err) => {
    log.innerHTML = `<p class="error">Couldn't load messages: ${esc(err.message)}</p>`;
  });

  const form = container.querySelector('[data-form]');
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = container.querySelector('[data-input]');
    const errEl = container.querySelector('[data-err]');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    errEl.hidden = true;
    try {
      await addDoc(messagesRef, { from: user.uid, role: myRole, text, ts: serverTimestamp() });
      await updateDoc(parentRef, {
        lastMessage: { text: text.slice(0, 120), from: user.uid, role: myRole, ts: new Date(), emailed: false },
      });
    } catch (err) {
      errEl.textContent = `Couldn't send: ${err.message}`;
      errEl.hidden = false;
      input.value = text;
    }
  });
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
