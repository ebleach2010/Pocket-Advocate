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
  db, rtdb, storage, collection, doc, addDoc, updateDoc, onSnapshot, getDocs,
  query, orderBy, limit, serverTimestamp, rtdbRef, onValue,
  ref, uploadBytesResumable, getDownloadURL,
} from './firebase.js';
import {
  emojiById, statusById, openMessageMenu, openEditor, EDIT_WINDOW_MS,
} from './msg-actions.js';

const MAX_BYTES = 25 * 1024 * 1024;
const LONG_PRESS_MS = 550;

/** Shows the advocate's live status in `el` (any element with a .p-dot child). */
export function watchPresence(el) {
  onValue(rtdbRef(rtdb, 'presence/eric'), (snap) => {
    const online = snap.val() === true;
    el.querySelector('.p-dot')?.classList.toggle('on', online);
    const label = el.querySelector('.p-label');
    if (label) label.textContent = online ? "I'm online" : "I'm away";
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
  container.classList.add('chat-root');
  container.innerHTML = `
    <button class="chat-expand" data-expand type="button" title="Full screen" aria-label="Full screen">⤢</button>
    <div class="chat-log" data-log><p class="dim small">Loading messages…</p></div>
    ${disabled
      ? `<p class="dim small chat-notice">${esc(notice)}</p>`
      : `<form class="chat-form" data-form>
           <label class="attach-btn" title="Attach a file">📎<input type="file" hidden data-attach
             accept=".pdf,.jpg,.jpeg,.png,.heic,.gif,.webp,.dcm,.dicom,.zip,.mp4,.mov,.doc,.docx,.txt"></label>
           <textarea data-input maxlength="2000" rows="1" placeholder="Write a message…"
             autocomplete="off" autocapitalize="sentences"></textarea>
           <button class="btn" type="submit">Send</button>
         </form>
         <progress data-progress max="100" value="0" hidden></progress>
         <p class="dim small" data-hint hidden>Tip: press and hold a shared file to save it to Documents.</p>
         <p class="error" data-err hidden></p>`}
    <p style="margin:.5rem 0 0; text-align:right;">
      <button class="btn quiet" type="button" data-export
        style="font-size:.72rem; padding:.32rem .7rem;">⬇ Export chat (CSV)</button>
    </p>
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
      const sentAt = data.ts?.toDate ? data.ts.toDate() : null;
      const meta = document.createElement('span');
      meta.className = 'msg-meta';
      meta.textContent = (sentAt ? fmt.format(sentAt) : 'sending…') + (data.editedAt ? ' · edited' : '');
      div.appendChild(meta);

      // The reaction, visible to both sides. A plain emoji rides the corner of
      // the bubble the way it does everywhere else; a status reaction is a
      // sentence, so it gets a chip of its own.
      if (data.reaction?.id) {
        const em = emojiById(data.reaction.id);
        const chip = document.createElement('span');
        if (em) {
          chip.className = 'msg-emoji-react';
          chip.textContent = em.emoji;
        } else {
          const st = statusById(data.reaction.id);
          chip.className = 'msg-react';
          chip.textContent = `${st ? st.emoji + ' ' : ''}${data.reaction.label || st?.label || ''}`;
        }
        div.appendChild(chip);
      }

      // A plain-words recap the model wrote after Eric's messages sat
      // unanswered — a re-orientation aid for clients with brain fog. Both
      // sides see the same text.
      if (data.recap?.text) {
        const rc = document.createElement('div');
        rc.className = 'msg-recap';
        rc.textContent = `💡 In short: ${data.recap.text}`;
        div.appendChild(rc);
      }

      // The pass flag. A question or request from the other person carries an
      // outline flag; tapping it fills red as PASS — "not answering that one,
      // please don't ask why" — visible to both sides. Only whoever passed can
      // take it back.
      const askish = data.text && /\?|(^|\s)(please|can you|could you|would you|will you|do you|did you|have you|are you|send|upload|share|let me know)\b/i.test(data.text);
      if (data.pass || (!mine && askish && data.text)) {
        const flag = document.createElement('button');
        flag.type = 'button';
        flag.className = `pass-flag${data.pass ? ' on' : ''}`;
        flag.textContent = data.pass ? '⚑ PASS' : '⚐ pass';
        flag.title = data.pass
          ? (data.pass.by === user.uid ? 'Passed — tap to take it back' : 'They passed on this — moving on')
          : "Pass on this question — it's marked PASS and we move on, no explanation needed";
        const canToggle = data.pass ? data.pass.by === user.uid : !mine;
        if (canToggle) {
          flag.addEventListener('click', async () => {
            flag.disabled = true;
            await post('/api/chat/pass',
              { kind: kindOf(), id: parentPath[1], msgId: m.id, pass: !data.pass },
              "Couldn't set that");
          });
        } else {
          flag.disabled = true;
        }
        div.appendChild(flag);
      }

      // Long-press opens the menu. What's in it depends on whose message it is:
      // reactions on theirs, editing on your own inside the 3-minute window.
      const editable = mine && !!data.text && sentAt &&
        Date.now() - sentAt.getTime() < EDIT_WINDOW_MS;
      if (!mine || editable || data.text) {
        messageLongPress(div, {
          msgId: m.id,
          canReact: !mine,
          canUseStatus: !mine && myRole === 'admin',
          canEdit: !!editable,
          canRecap: mine && myRole === 'admin' && !!data.text,
          hasReaction: !!data.reaction?.id,
          hasText: !!data.text,
          current: data.reaction?.id || null,
          text: data.text || '',
          deadline: sentAt ? sentAt.getTime() + EDIT_WINDOW_MS : 0,
        });
      }

      log.appendChild(div);
    });
    const hint = container.querySelector('[data-hint]');
    if (hint) {
      const passNote = 'If a question is asked that you\'d rather not answer, tap ⚐ pass under it: it turns red, marks it PASS, and we simply move on — no explanation needed.';
      const hintText = ((myRole === 'admin'
        ? (hasAttachment
          ? 'Press and hold a shared file to save it to their Documents. '
          : '')
        : (hasAttachment
          ? 'Press and hold a message to react or edit it; hold a shared file to save it to Documents. '
          : 'Press and hold a message to react to it, or to edit your own within 3 minutes. ')) + passNote).trim();
      // Update 2.1 launch: the hint runs in gold under its label for 48 hours
      // (until 2026-08-22 ~01:00 UTC), then reverts to the normal dim style on
      // its own — the deadline is baked in, no second deploy needed.
      if (Date.now() < Date.parse('2026-08-22T01:00:00Z')) {
        hint.classList.add('hint-gold');
        hint.innerHTML = `<strong class="hint-update">✨ Update 2.1</strong><br>${esc(hintText)}`;
      } else {
        hint.classList.remove('hint-gold');
        hint.textContent = hintText;
      }
      hint.hidden = false;
    }
    log.scrollTop = log.scrollHeight;
    if (myRole === 'client') scheduleRecap(snap);
  }, (err) => {
    log.innerHTML = `<p class="error">Couldn't load messages: ${esc(err.message)}</p>`;
  });

  // When Eric's latest messages have sat unanswered for 5 minutes and the
  // client is looking at the chat, ask the Worker for a short plain-words
  // recap. The Worker re-checks every condition, so this is only a nudge; the
  // timer covers the case where the 5-minute mark passes while the chat is
  // already open (no new snapshot would fire).
  let recapTimer = null;
  let recapAskedFor = null;
  function scheduleRecap(snap) {
    clearTimeout(recapTimer);
    const docs = snap.docs;
    if (!docs.length) return;
    const lastDoc = docs[docs.length - 1];
    const lastData = lastDoc.data();
    if (lastData.role !== 'admin' || lastData.recap) return;
    if (recapAskedFor === lastDoc.id) return;
    const sentAt = lastData.ts?.toDate ? lastData.ts.toDate().getTime() : 0;
    if (!sentAt) return;
    const due = sentAt + 5 * 60_000 - Date.now();
    recapTimer = setTimeout(() => {
      recapAskedFor = lastDoc.id;
      post('/api/chat/recap', { kind: kindOf(), id: parentPath[1] }, '')
        .catch(() => {});
    }, Math.max(0, due) + 1500);
  }

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
    nudgeOtherSide();
  }

  /**
   * Long-press (or right-click) any message to open its menu. Skips touches
   * that started on an attachment — that gesture already means "save this
   * file" and stealing it would be worse than not having this.
   */
  function messageLongPress(el, opts) {
    el.classList.add('react-target');
    let timer = null;
    const onAttachment = (e) => !!e.target.closest?.('.msg-img, .file-chip');
    const open = () => runMenu(opts);
    const start = (e) => {
      if (onAttachment(e)) return;
      timer = setTimeout(() => { timer = null; open(); }, LONG_PRESS_MS);
    };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((ev) =>
      el.addEventListener(ev, cancel));
    el.addEventListener('contextmenu', (e) => {
      if (onAttachment(e)) return;
      e.preventDefault();
      cancel();
      open();
    });
  }

  const kindOf = () => (parentPath[0] === 'subscriptions' ? 'sub' : 'case');

  async function runMenu(o) {
    const choice = await openMessageMenu(o);
    if (!choice) return; // dismissed — leave everything alone
    if (choice.action === 'copy') {
      try { await navigator.clipboard.writeText(o.text); }
      catch { alert('Copying is blocked on this device.'); }
      return;
    }
    if (choice.action === 'edit') return editMessage(o);
    if (choice.action === 'recap') {
      // Force a plain-words recap of the latest unanswered run, right now.
      return post('/api/chat/recap', { kind: kindOf(), id: parentPath[1], force: true },
        "Couldn't recap");
    }
    await post('/api/chat/react', {
      kind: kindOf(), id: parentPath[1], msgId: o.msgId,
      reaction: choice.action === 'clear' ? null : choice.id,
    }, "Couldn't set that");
  }

  async function editMessage(o) {
    const text = await openEditor(o.text, o.deadline);
    if (text === undefined || text === o.text) return;
    await post('/api/chat/edit',
      { kind: kindOf(), id: parentPath[1], msgId: o.msgId, text },
      "Couldn't save the edit");
  }

  // The onSnapshot listener repaints whatever changed, so there's nothing to
  // do on success but stay out of the way.
  async function post(url, payload, failMsg) {
    try {
      const token = await user.getIdToken();
      const res = await fetch(url, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error((await res.json()).error || `Failed (${res.status})`);
    } catch (err) {
      // An empty failMsg means fire-and-forget: fail silently.
      if (failMsg) alert(`${failMsg}: ${err.message}`);
    }
  }

  // Fire-and-forget web push to the other participant. Failure is invisible —
  // the email digest still covers anyone without notifications on.
  async function nudgeOtherSide() {
    try {
      const kind = parentPath[0] === 'subscriptions' ? 'sub' : 'case';
      const token = await user.getIdToken();
      fetch('/api/notify', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ kind, id: parentPath[1] }),
      }).catch(() => {});
    } catch { /* best-effort only */ }
  }

  // Full-screen chat: the whole thread takes the viewport so long messages
  // read comfortably; ✕ puts it back. Same control both sides of the chat.
  const expandBtn = container.querySelector('[data-expand]');
  expandBtn.addEventListener('click', () => {
    const full = container.classList.toggle('chat-full');
    expandBtn.textContent = full ? '✕' : '⤢';
    expandBtn.title = full ? 'Close full screen' : 'Full screen';
    expandBtn.setAttribute('aria-label', expandBtn.title);
    document.body.classList.toggle('chat-full-open', full);
    const log = container.querySelector('[data-log]');
    if (log) log.scrollTop = log.scrollHeight;
  });

  const form = container.querySelector('[data-form]');
  const input = container.querySelector('[data-input]');

  // Grow with the message instead of scrolling it out of sight, up to the cap
  // in .chat-form textarea, after which it scrolls internally.
  const autoGrow = () => {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  };
  input?.addEventListener('input', autoGrow);

  // Return is a paragraph break, always, on every device. The Send button is
  // the only thing that sends — a keystroke that fires a half-written message
  // at a client is not a tradeoff worth having.

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    autoGrow();
    errEl.hidden = true;
    try {
      await send({ text });
    } catch (err) {
      errEl.textContent = `Couldn't send: ${err.message}`;
      errEl.hidden = false;
      input.value = text;
      autoGrow();
    }
  });

  container.querySelector('[data-export]').addEventListener('click', async (e) => {
    const btn = e.target;
    btn.disabled = true;
    try {
      // Full history, not just the 200 shown on screen.
      const snap = await getDocs(query(messagesRef, orderBy('ts', 'asc')));
      const rows = [['Date', 'Time', 'Sender', 'Message', 'Attachment', 'Attachment URL']];
      snap.forEach((m) => {
        const d = m.data();
        const when = d.ts?.toDate ? d.ts.toDate() : null;
        rows.push([
          when ? when.toLocaleDateString('en-CA') : '',   // YYYY-MM-DD
          when ? when.toLocaleTimeString('en-US') : '',
          d.role === 'admin' ? 'Advocate' : 'Client',
          d.text || '',
          d.attachment?.name || '',
          d.attachment?.url || '',
        ]);
      });
      const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM so Excel reads UTF-8
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `pocket-advocate-chat-${parentPath.join('-')}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err) {
      alert(`Couldn't export: ${err.message}`);
    }
    btn.disabled = false;
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

  // Handed back so the advisor panel can post an approved draft as me.
  return { send: (text) => send({ text }) };
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

// CSV-safe: quote everything, double internal quotes, and defang cells that
// spreadsheet apps would execute as formulas (=SUM…, +, -, @).
function csvCell(v) {
  let s = String(v).replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
