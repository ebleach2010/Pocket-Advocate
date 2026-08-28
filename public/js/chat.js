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
  db, storage, collection, doc, addDoc, updateDoc, onSnapshot, getDocs,
  query, orderBy, limit, serverTimestamp,
  ref, uploadBytesResumable, getDownloadURL,
} from './firebase.js';
import {
  emojiById, statusById, openMessageMenu, openStatusSheet, openEditor, openNote, EDIT_WINDOW_MS,
} from './msg-actions.js';
import { askName, safeName } from './rename.js';
import { watchOffice } from './office.js';

const MAX_BYTES = 25 * 1024 * 1024;
const LONG_PRESS_MS = 550;
// How far a pointer may wobble during a held press before it stops counting
// as one. Mirrors MOVE_TOLERANCE in drawer.js, which already had this right.
// Without it, any pointermove at all cancelled the press - fine for a finger,
// fatal for a mouse, which jitters from the click itself.
const MOVE_TOLERANCE = 12;

// Everything that only happens on an admin thread lives in its own module,
// which is not served to a client at all. Loaded on demand when one mounts;
// null otherwise, and every use of it is optional-chained.
//
// It used to live here. It was gated at runtime and never rendered for a
// client, but this file downloads on every case, chat and subscription page,
// and a runtime gate does not stop devtools.
let bridge = null;

/**
 * Paints the in office / out of office cue inside `el`, and keeps it painted.
 *
 * One line, because office.js owns all of it: what to ask for, how often, and
 * what the pill says. The three chat surfaces call this so they cannot end up
 * with three answers to one question.
 */
export function watchPresence(el) {
  watchOffice(el);
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
/**
 * onStatus: called with the status id sitting on the newest message whenever
 *   the thread repaints, so a control OUTSIDE this chat (the dropdown beside
 *   "Chat with the client") can show what is currently set.
 * composerButton: an optional { icon, title, onClick } the caller can put in
 * the composer row, left of the text box. The caller owns what it means; this
 * file only knows where it goes.
 */
export function mountChat({ container, parentPath, user, myRole, saveUid, disabled = false, notice = '', composerButton = null, onStatus = null }) {
  container.classList.add('chat-root');
  // The lane chips lived and died on 2026-08-22 (Eric: "Just get rid of all
  // of them. They're pointless. Have it just be a chat."). Do not rebuild a
  // categoriser into this composer. Messages already sent with a lane keep
  // their little mark below; the next-call list under the chat has its own
  // add box and never needed the composer.
  container.innerHTML = `
    ${disabled
      ? '<button class="chat-expand" data-expand type="button" title="Full screen" aria-label="Full screen">⤢</button>'
      : ''}
    <div class="chat-log" data-log><p class="dim small">Loading messages…</p></div>
    ${disabled
      ? `<p class="dim small chat-notice">${esc(notice)}</p>`
      : `<form class="chat-form" data-form>
           <button type="button" class="attach-btn" data-expand title="Full screen"
             aria-label="Full screen">⤢</button>
           <label class="attach-btn" title="Attach a file">📎<input type="file" hidden data-attach
             accept=".pdf,.jpg,.jpeg,.png,.heic,.gif,.webp,.dcm,.dicom,.zip,.mp4,.mov,.doc,.docx,.txt"></label>
           ${composerButton ? `<button type="button" class="attach-btn" data-extra
             title="${esc(composerButton.title || '')}" aria-label="${esc(composerButton.title || '')}"
             >${esc(composerButton.icon || '')}</button>` : ''}
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
  // Set by send(), cleared by the repaint that draws the result: your own
  // message takes you to the bottom even if you were reading back through the
  // history, because you asked for it. Nobody else's does.
  let followNext = false;
  let latestMsgId = null;
  // The status on the newest message, mirrored so the panel's dropdown can
  // show what is set without re-reading Firestore.
  let currentStatusId = '';
  const parentRef = doc(db, ...parentPath);
  const messagesRef = collection(db, ...parentPath, 'chat');

  // DESCENDING with the limit, then re-sorted ascending below. Ascending
  // with limit(200) keeps the OLDEST 200: the moment a thread crossed two
  // hundred messages, every NEW message was written successfully and then
  // silently fell outside the render window on both sides. (Eric,
  // 2026-08-22: "I did a 'send as me' after editing a draft and it just
  // disappeared.") Descending keeps the NEWEST 200, which is the window a
  // conversation actually needs; the full history stays in the CSV export.
  onSnapshot(query(messagesRef, orderBy('ts', 'desc'), limit(200)), (snap) => {
    if (snap.empty) {
      log.innerHTML = '<p class="dim small">No messages yet. Say hi.</p>';
      return;
    }
    const fmt = new Intl.DateTimeFormat('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
    // Measured before the rebuild, because emptying the log sets scrollTop to
    // 0 and the answer would always be yes.
    const wasAtBottom = followNext
      || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
    followNext = false;
    log.innerHTML = '';
    let hasAttachment = false;
    const ordered = [];
    snap.forEach((m) => ordered.push(m));
    // Oldest first for reading, whatever order the window arrived in. A
    // just-sent message has a null server timestamp for a beat; it sorts to
    // the end, which is exactly where a just-sent message belongs.
    ordered.sort((a, b) => {
      const ta = a.data().ts?.toDate?.()?.getTime?.() ?? Infinity;
      const tb = b.data().ts?.toDate?.()?.getTime?.() ?? Infinity;
      return ta - tb;
    });
    // The status dropdown hangs its pick on whatever is newest right now -
    // preferring the newest COMMITTED message: a just-sent local echo has no
    // server timestamp yet, and the Worker answers "No such message" for a
    // write it has not seen.
    const committed = ordered.filter((m) => m.data().ts);
    const newest = committed.length ? committed[committed.length - 1] : ordered[ordered.length - 1];
    latestMsgId = newest?.id ?? null;
    // What the dropdown should be showing. Only a STATUS counts: a plain emoji
    // is the client reacting to him and is nobody's working state.
    {
      const rid = newest?.data()?.reaction?.id || '';
      currentStatusId = rid && statusById(rid) ? rid : '';
      onStatus?.(currentStatusId);
    }
    for (const m of ordered) {
      const data = m.data();
      const mine = data.from === user.uid;
      const div = document.createElement('div');
      div.className = `msg ${mine ? 'me' : 'them'}`;
      div.dataset.mid = m.id;
      if (data.text) {
        const span = document.createElement('span');
        span.className = 'msg-text';
        span.appendChild(linkify(data.text));
        div.appendChild(span);
      }
      // Images and PDFs can be selected on admin threads, and only where the
      // module that consumes the selection has actually loaded.
      const att = data.attachment;
      const attCt = (att?.contentType || '').toLowerCase();
      const attReadable = !!att?.url && !/heic|heif/.test(attCt) &&
        (attCt.startsWith('image/') || attCt === 'application/pdf' || /\.pdf$/i.test(att?.name || ''));
      const canStage = attReadable && myRole === 'admin' &&
        document.body.dataset.panel === '1';
      if (att && att.url) {
        hasAttachment = true;
        div.appendChild(renderAttachment(att, saveUid));
        if (canStage && bridge) div.appendChild(bridge.selectBadge(att));
      }
      const sentAt = data.ts?.toDate ? data.ts.toDate() : null;
      const meta = document.createElement('span');
      meta.className = 'msg-meta';
      // The lane the sender filed it under rides the timestamp, so a scan of
      // the thread shows what is urgent and what is paperwork at a glance.
      const laneIcon = { reply: '↩️', intake: '📋', info: '🆕', records: '📎', clinical: '🚨' }[data.lane] || '';
      if (data.lane === 'clinical') div.classList.add('lane-hot');
      meta.textContent = (laneIcon ? `${laneIcon} ` : '')
        + (sentAt ? fmt.format(sentAt) : 'sending…') + (data.editedAt ? ' · edited' : '');
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

      // The pass flag. A question or request carries an outline flag; tapping
      // it fills red as PASS — "not answering that one, please don't ask why"
      // — visible to both sides. Only whoever passed can take it back.
      //
      // Offered to CLIENTS only (Eric, 2026-08-20: "I can't pass on messages.
      // Only they should be able to"). He still sees a pass a client set,
      // because that is how he knows to stop asking, and anything he passed
      // before this shipped stays his to take back.
      const canOfferPass = myRole === 'client';
      const askish = data.text && /\?|(^|\s)(please|can you|could you|would you|will you|do you|did you|have you|are you|send|upload|share|let me know)\b/i.test(data.text);
      if (data.pass || (canOfferPass && !mine && askish && data.text)) {
        const flag = document.createElement('button');
        flag.type = 'button';
        flag.className = `pass-flag${data.pass ? ' on' : ''}`;
        flag.textContent = data.pass ? '⚑ PASS' : '⚐ pass';
        flag.title = data.pass
          ? (data.pass.by === user.uid ? 'Passed. Tap to take it back' : 'They passed on this, so we are moving on')
          : "Pass on this question. It is marked PASS and we move on, no explanation needed";
        const canToggle = data.pass ? data.pass.by === user.uid : (canOfferPass && !mine);
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
      // The Worker lets an admin edit their own message at any age; the
      // three-minute window is for everyone else. The UI used to apply it to
      // both, which quietly made a repaired wording unusable on anything
      // older than three minutes.
      const editable = mine && !!data.text &&
        (myRole === 'admin' || (sentAt && Date.now() - sentAt.getTime() < EDIT_WINDOW_MS));
      if (!mine || editable || data.text || canStage) {
        messageLongPress(div, {
          msgId: m.id,
          // Same rule as hasReaction below: no emoji bar over a bubble that
          // is carrying the advocate's status note, except for the advocate.
          canReact: !mine && (myRole === 'admin' || data.reaction?.kind !== 'status'),
          // His own messages take a status too (Eric, 2026-08-25): the
          // client is still the one notified, with the exact words.
          canUseStatus: myRole === 'admin',
          canEdit: !!editable,
          canPass: myRole === 'client' && !mine && !!data.text && !data.pass,
          // Either side, either person's message. Saving is private and tells
          // nobody, so there is nothing to gate.
          canSave: !!(data.text || att),
          savedAlready: savedIds.has(m.id),
          extraRows: bridge ? bridge.extraMenuRows({ canStage }) : [],
          attachment: canStage ? att : null,
          passedByMe: data.pass?.by === user.uid,
          // A status note is the advocate's broadcast, not a reaction the
          // client may remove - the Worker refuses, so the menu must not
          // offer the row that would only ever answer with an error.
          hasReaction: !!data.reaction?.id
            && (myRole === 'admin' || data.reaction?.kind !== 'status'),
          hasText: !!data.text,
          current: data.reaction?.id || null,
          text: data.text || '',
          deadline: sentAt ? sentAt.getTime() + EDIT_WINDOW_MS : 0,
        });
      }

      log.appendChild(div);
    }
    const hint = container.querySelector('[data-hint]');
    if (hint) {
      // Passing is the client's to do, so only the client is told about it.
      const passNote = myRole === 'client'
        ? 'Long hold the message and press the flag to pass on a question or subject. No questions asked, no judgement; we\'ll move forward like it was never said.'
        : '';
      const hintText = ((myRole === 'admin'
        ? (hasAttachment
          ? 'Press and hold a shared file to save it to their Documents. '
          : '')
        : (hasAttachment
          ? 'Press and hold a message to react or edit it; hold a shared file to save it to Documents. '
          : 'Press and hold a message to react to it, or to edit your own within 3 minutes. ')) + passNote).trim();
      // The one-off gold "Update 2.1" banner that used to run here has retired.
      // changelog.js does this job now, for every release rather than one, and
      // it says what changed instead of only that something did.
      hint.textContent = hintText;
      hint.hidden = !hintText;
    }
    // Only chase the bottom if that is where they already were. Any write to
    // any message in the thread rebuilds this list, and scrolling
    // unconditionally would throw someone reading back through the history
    // down to the end for no reason they could see.
    if (wasAtBottom) log.scrollTop = log.scrollHeight;
    repaintFlags();
    paintSaved();
  }, (err) => {
    log.innerHTML = `<p class="error">Couldn't load messages: ${esc(err.message)}</p>`;
  });

  // The admin-only half, fetched only on an admin thread. A client's browser
  // never asks for this file and would be refused if it did. The role comes
  // from the mount, never from a caller-supplied flag.
  if (myRole === 'admin') {
    import('./panel-bridge.js').then((m) => {
      bridge = m;
      m.watchSelection(container);
      m.onPanelState(repaintFlags);
      repaintFlags();
    }).catch(() => { /* the chat is a chat without it */ });
  }

  async function send({ text = '', attachment = null }) {
    followNext = true;
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
    // The last selector is furniture only an admin thread adds, and naming it
    // here would put it in a file every client downloads. The module that adds
    // it says what to skip.
    // A link is a link: pressing one opens it (and a long press should get
    // the browser's own link menu), so the message menu stays out of its way.
    const skip = ['.msg-img', '.file-chip', 'a', ...(bridge?.noLongPress || [])].join(', ');
    const onAttachment = (e) => !!e.target.closest?.(skip);
    const open = () => runMenu(opts);
    // Where the press began, so a MOVE can be judged rather than merely
    // noticed. Eric, 2026-08-25, on a PC: the menu would not open for him.
    // Cancelling on any pointermove at all is fine for a finger, which either
    // rests or swipes - but a mouse jitters a pixel or two just from the click
    // itself, and a trackpad worse, so the timer was being killed before it
    // could ever fire. Right-click still worked, and nobody would guess that.
    let x0 = 0, y0 = 0;
    const start = (e) => {
      if (onAttachment(e)) return;
      x0 = e.clientX; y0 = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        // He was dragging out a selection, not asking for the menu. Text is
        // selectable on a mouse now, so a held press that has produced one is
        // a copy in progress and the menu would destroy it.
        if (window.getSelection && String(window.getSelection())) return;
        open();
      }, LONG_PRESS_MS);
    };
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    const moved = (e) => {
      if (!timer) return;
      if (Math.hypot(e.clientX - x0, e.clientY - y0) > MOVE_TOLERANCE) cancel();
    };
    el.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
      el.addEventListener(ev, cancel));
    el.addEventListener('pointermove', moved);
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
    if (choice.action === 'pass' || choice.action === 'unpass') {
      return post('/api/chat/pass',
        { kind: kindOf(), id: parentPath[1], msgId: o.msgId, pass: choice.action === 'pass' },
        "Couldn't set that");
    }
    if (choice.action === 'save') {
      // A note can be added here or on the Saved page; offering it at the
      // moment of saving is the difference between a bookmark and a record.
      const note = await openNote(savedIds.get(o.msgId) || '');
      if (note === undefined) return;
      await post('/api/saved',
        { kind: kindOf(), id: parentPath[1], msgId: o.msgId, note },
        "Couldn't save that");
      savedIds.set(o.msgId, note);
      paintSaved();
      document.dispatchEvent(new CustomEvent('pa-saved-changed', {
        detail: { kind: kindOf(), id: parentPath[1] },
      }));
      return;
    }
    if (choice.action === 'stage') {
      // The page that owns the request is on the other side of this; the chat
      // just hands the file over.
      bridge?.stageFile(o.attachment);
      return;
    }
    // Clearing takes the chip off the bubble the moment the Worker confirms,
    // rather than waiting on the snapshot to come back round. The listener
    // repaints from Firestore a beat later and agrees with it; if the Worker
    // refused, post() alerts and this never runs, so the chip stays - which is
    // the truth. (Eric, 2026-08-21: "Remove reaction isn't working for chat.")
    const clearing = choice.action === 'clear';
    const ok = await post('/api/chat/react', {
      kind: kindOf(), id: parentPath[1], msgId: o.msgId,
      reaction: clearing ? null : choice.id,
    }, "Couldn't set that");
    if (ok && clearing) {
      const row = log.querySelector(`[data-mid="${CSS.escape(o.msgId)}"]`);
      row?.querySelectorAll('.msg-react, .msg-emoji-react').forEach((n) => n.remove());
    }
  }

  /** Anything the optional module above wants drawn on the thread. */
  function repaintFlags() {
    bridge?.paint(log, {
      openEditor,
      editWindowMs: EDIT_WINDOW_MS,
      edit: (msgId, text) => post('/api/chat/edit',
        { kind: kindOf(), id: parentPath[1], msgId, text }, "Couldn't save the edit"),
      done: (msgId) => document.dispatchEvent(
        new CustomEvent('pa-mark-done', { detail: { msgId } })),
    });
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
      return true;
    } catch (err) {
      // An empty failMsg means fire-and-forget: fail silently.
      if (failMsg) alert(`${failMsg}: ${err.message}`);
      return false;
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

  if (composerButton?.onClick) {
    container.querySelector('[data-extra]')?.addEventListener('click', (e) => {
      e.preventDefault();
      composerButton.onClick();
    });
  }

  // The ids this person has bookmarked on this thread. Loaded once and kept
  // in step by hand: it only ever changes from actions taken right here.
  const savedIds = new Map();   // msgId -> the note, so "update" starts where it left off
  (async () => {
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/saved?kind=${kindOf()}&id=${encodeURIComponent(parentPath[1])}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      for (const r of (await res.json()).saved || []) savedIds.set(r.msgId, r.note || '');
      paintSaved();
    } catch { /* the mark is a nicety, not the feature */ }
  })();

  /** A small bookmark on a message this person saved. Only they ever see it. */
  function paintSaved() {
    for (const el of log.querySelectorAll('.msg[data-mid]')) {
      const on = savedIds.has(el.dataset.mid);
      const had = el.querySelector('.sv-mark');
      if (on && !had) {
        const mark = document.createElement('span');
        mark.className = 'sv-mark';
        mark.textContent = '🔖';
        mark.title = 'Saved to your saved messages';
        el.appendChild(mark);
      } else if (!on && had) had.remove();
    }
  }

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
      // Same words as the Documents page, which already told people what to do
      // about it rather than only what was wrong.
      errEl.textContent = `${file.name} is over 25 MB. Compress it or split it up.`;
      errEl.hidden = false;
      return;
    }
    // Ask a client what it is before it goes anywhere. Not Eric: he is the one
    // who wanted the descriptions, and being asked to describe his own report
    // every time he sends one would be a tax on the person who set the rule.
    const named = myRole === 'client' ? await askName(file) : file.name;
    const bar = container.querySelector('[data-progress]');
    bar.hidden = false;
    try {
      const storageRef = ref(storage,
        `${parentPath.join('/')}/chat-files/${Date.now()}-${safeName(named)}`);
      const task = uploadBytesResumable(storageRef, file);
      await new Promise((resolve, reject) => {
        task.on('state_changed',
          (s) => { bar.value = (s.bytesTransferred / s.totalBytes) * 100; },
          reject, resolve);
      });
      const url = await getDownloadURL(storageRef);
      await send({
        attachment: {
          name: named, url, path: storageRef.fullPath,
          size: file.size, contentType: file.type || 'application/octet-stream',
        },
      });
      // Documents lists chat-files now, so a file shared here belongs in that
      // list the moment it lands rather than after a reload. Same event the
      // long-press save already fires.
      document.dispatchEvent(new CustomEvent('pa-saved-file'));
    } catch (err) {
      errEl.textContent = `Upload failed: ${err.message}`;
      errEl.hidden = false;
    }
    bar.hidden = true;
  });

  // Handed back so the admin panel can post an approved message as me.
  // Eric, 2026-08-25: the statuses "should sit to the right of 'chat with
  // client' as a dropdown so I can have it be the status of what I'm working
  // on." The panel owns the control; this owns the write, because it knows
  // which message is newest. Same write the long-press menu makes.
  return {
    send: (text) => send({ text }),
    setStatus: async (id) => {
      if (!latestMsgId) throw new Error('There are no messages here yet to hang a status on. Send one first.');
      // The Worker's OWN words, not a generic apology. The first version
      // passed an empty failMsg to post(), which swallows the reason and
      // returns false, so a real refusal ("You can only react to the other
      // person's messages", "Unknown reaction", a 401 from an expired token)
      // all reached Eric as "That did not save. Try again." - which told him
      // nothing and told me less.
      const token = await user.getIdToken();
      const res = await fetch('/api/chat/react', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: kindOf(), id: parentPath[1], msgId: latestMsgId, reaction: id || null,
        }),
      });
      if (!res.ok) {
        const out = await res.json().catch(() => ({}));
        throw new Error(out.error ? `${out.error} (${res.status})` : `That did not save (${res.status}).`);
      }
      return true;
    },
    /** Whatever status is on the newest message right now, or '' for none. */
    currentStatus: () => currentStatusId,
  };
}

// ---- links inside message text ----
//
// Message text is rendered as TEXT NODES, never as markup: that is what makes
// a message safe to show, and it is why a pasted link used to sit there dead.
// So links are found in the text and built as real elements, with the text
// around them still going in as text. A URL is only linked when it parses and
// its protocol is http, https or mailto, which is what keeps "javascript:..."
// from ever becoming something a client can tap.
const LINK_RE = /((?:https?:\/\/|www\.)[^\s<>"']+|[^\s<>"'@]+@[^\s<>"'@]+\.[a-z]{2,})/gi;
// Sentence punctuation that follows a link rather than belonging to it.
const LINK_TRAIL = /[.,;:!?'")\]}>]+$/;

function linkify(text) {
  const frag = document.createDocumentFragment();
  const str = String(text);
  let i = 0;
  for (const m of str.matchAll(LINK_RE)) {
    const raw = m[0];
    const start = m.index;
    let body = raw.replace(LINK_TRAIL, '');
    // Give back a closing paren the URL actually owns, so a wikipedia-style
    // "..._(disease)" link is not cut in half.
    while (body.length < raw.length && raw[body.length] === ')'
      && (body.match(/\(/g) || []).length > (body.match(/\)/g) || []).length) {
      body = raw.slice(0, body.length + 1);
    }
    if (!body) continue;
    const isEmail = !/^(https?:\/\/|www\.)/i.test(body) && body.includes('@');
    const href = isEmail ? `mailto:${body}`
      : /^www\./i.test(body) ? `https://${body}` : body;
    let okProto = false;
    try {
      okProto = ['http:', 'https:', 'mailto:'].includes(new URL(href).protocol);
    } catch { okProto = false; }
    if (!okProto) continue;
    if (start > i) frag.appendChild(document.createTextNode(str.slice(i, start)));
    const a = document.createElement('a');
    a.href = href;
    a.textContent = body;
    a.className = 'msg-link';
    if (!isEmail) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
    }
    frag.appendChild(a);
    i = start + body.length;
  }
  if (i < str.length) frag.appendChild(document.createTextNode(str.slice(i)));
  return frag;
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
    // Tap to expand. A long-press that already fired the save prompt marks
    // the element so the trailing click doesn't also pop the lightbox.
    el.addEventListener('click', () => {
      if (el.dataset.lp) { delete el.dataset.lp; return; }
      openLightbox(att);
    });
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
  let x0 = 0, y0 = 0;
  const start = (e) => {
    delete el.dataset.lp;
    x0 = e.clientX; y0 = e.clientY;
    timer = setTimeout(() => { timer = null; el.dataset.lp = '1'; promptSave(att, saveUid); }, LONG_PRESS_MS);
  };
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  // Same wobble allowance as the message press and the drawer: a mouse moves
  // a pixel or two just from being clicked, and cancelling on that meant a
  // held press never completed on a computer.
  const moved = (e) => {
    if (!timer) return;
    if (Math.hypot(e.clientX - x0, e.clientY - y0) > MOVE_TOLERANCE) cancel();
  };
  el.addEventListener('pointerdown', start);
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) =>
    el.addEventListener(ev, cancel));
  el.addEventListener('pointermove', moved);
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    cancel();
    el.dataset.lp = '1';
    promptSave(att, saveUid);
  });
}

/**
 * Full-screen image viewer: tap a chat image to expand it, tap anywhere
 * outside (or ✕, or Escape) to close. Sits above full-screen chat (z 80 vs
 * 75) so it works from either view. URLs are assigned as properties, never
 * interpolated into HTML — attachment fields are user-written data.
 */
export function openLightbox(att) {
  if (document.querySelector('.lightbox')) return;
  const overlay = document.createElement('div');
  overlay.className = 'lightbox';
  overlay.innerHTML = `
    <button class="lightbox-x" type="button" aria-label="Close">✕</button>
    <img alt="">
    <p class="lightbox-bar"><span></span><a target="_blank" rel="noopener">Open original</a></p>`;
  const img = overlay.querySelector('img');
  img.src = att.url;
  img.alt = att.name || '';
  overlay.querySelector('.lightbox-bar span').textContent = att.name || '';
  overlay.querySelector('.lightbox-bar a').href = att.url;
  const close = () => {
    overlay.remove();
    document.body.classList.remove('lightbox-open');
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay || e.target.classList.contains('lightbox-x')) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.classList.add('lightbox-open');
  document.body.appendChild(overlay);
}

/** A confirmation that does not have to be dismissed before life continues. */
function toast(text, bad = false) {
  document.querySelector('.pa-toast')?.remove();
  const el = document.createElement('div');
  el.className = `pa-toast${bad ? ' bad' : ''}`;
  el.setAttribute('role', 'status');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

async function promptSave(att, saveUid) {
  if (!confirm(`Save "${att.name}" to Documents?`)) return;
  try {
    const blob = await (await fetch(att.url)).blob();
    const dest = ref(storage, `profiles/${saveUid}/saved/${Date.now()}-${att.name.replace(/[^\w.\- ]+/g, '_')}`);
    const task = uploadBytesResumable(dest, blob, { contentType: att.contentType });
    await new Promise((resolve, reject) => task.on('state_changed', null, reject, resolve));
    toast(`Saved "${att.name}" to Documents.`);
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
