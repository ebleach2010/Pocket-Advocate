// The long-press menu on a chat message: a Facebook-style emoji bar on top,
// then whatever actions apply to that particular message.
//
// Two reaction vocabularies. Everyone gets the plain emoji; only Eric gets the
// "Eric is reading…" statuses, which is the whole point of them. Keep both in
// sync with EMOJI_REACTIONS / CHAT_REACTIONS in worker/index.js — the Worker
// owns the notification wording and is the only thing allowed to write either.

export const EMOJI_REACTIONS = [
  { id: 'love', emoji: '❤️', name: 'Love' },
  { id: 'haha', emoji: '😆', name: 'Haha' },
  { id: 'wow', emoji: '😮', name: 'Wow' },
  { id: 'sad', emoji: '😢', name: 'Sad' },
  { id: 'angry', emoji: '😡', name: 'Angry' },
  { id: 'like', emoji: '👍', name: 'Like' },
];

export const STATUS_REACTIONS = [
  { id: 'seen', emoji: '👁', label: 'Eric has seen your message' },
  { id: 'reading', emoji: '📖', label: 'Eric is reading…' },
  { id: 'research', emoji: '🔎', label: 'Eric is doing research…' },
  { id: 'thinking', emoji: '💭', label: 'Eric is thinking about your situation…' },
  { id: 'history', emoji: '🗂', label: 'Eric is reviewing your history…' },
  { id: 'labs', emoji: '🧪', label: 'Eric is reviewing your labs / chart notes' },
];

/** How long a message stays editable. Mirrors EDIT_WINDOW_MS in the Worker. */
export const EDIT_WINDOW_MS = 3 * 60 * 1000;

export const emojiById = (id) => EMOJI_REACTIONS.find((r) => r.id === id);
export const statusById = (id) => STATUS_REACTIONS.find((r) => r.id === id);

/**
 * Open the menu for one message.
 * opts: { canReact, canUseStatus, canEdit, canRecap, canPass, canStage,
 *         passedByMe, hasReaction, hasText, current }
 * Resolves to { action: 'react', id } | { action: 'clear' } | { action: 'edit' }
 * | { action: 'copy' } | { action: 'stage' }, or undefined if dismissed.
 */
export function openMessageMenu(opts) {
  const { canReact, canUseStatus, canEdit, canRecap, canPass, canStage, passedByMe, hasReaction, hasText, current } = opts;
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'msg-menu-overlay';
    overlay.innerHTML = `
      <div class="msg-menu" role="dialog" aria-modal="true" aria-label="Message actions">
        ${canReact ? `
          <div class="react-bar" role="group" aria-label="React">
            ${EMOJI_REACTIONS.map((r) => `
              <button class="react-emoji-btn${r.id === current ? ' on' : ''}"
                data-react="${r.id}" title="${r.name}" aria-label="${r.name}">${r.emoji}</button>`).join('')}
          </div>` : ''}
        <div class="msg-menu-sheet">
          ${canUseStatus ? `
            <p class="msg-menu-head">Let them know what you're doing</p>
            ${STATUS_REACTIONS.map((r) => `
              <button class="msg-menu-row${r.id === current ? ' on' : ''}" data-react="${r.id}">
                <span class="react-emoji">${r.emoji}</span><span>${r.label}</span>
              </button>`).join('')}
            <p class="msg-menu-note">They get a notification saying exactly this. Nothing from the message itself is included.</p>` : ''}
          ${canStage ? '<button class="msg-menu-row" data-act="stage"><span class="react-emoji">👨‍⚕️</span><span>Stage this file for review</span></button>' : ''}
          ${hasReaction ? '<button class="msg-menu-row" data-act="clear"><span class="react-emoji">✕</span><span>Remove reaction</span></button>' : ''}
          ${canEdit ? '<button class="msg-menu-row" data-act="edit"><span class="react-emoji">✏️</span><span>Edit message</span></button>' : ''}
          ${canRecap ? '<button class="msg-menu-row" data-act="recap"><span class="react-emoji">💡</span><span>Recap for them now</span></button>' : ''}
          ${canPass ? '<button class="msg-menu-row" data-act="pass"><span class="react-emoji">⚐</span><span>Pass on this — no questions asked</span></button>' : ''}
          ${passedByMe ? '<button class="msg-menu-row" data-act="unpass"><span class="react-emoji">⚑</span><span>Take back the pass</span></button>' : ''}
          ${hasText ? '<button class="msg-menu-row" data-act="copy"><span class="react-emoji">📋</span><span>Copy text</span></button>' : ''}
          <button class="msg-menu-row cancel" data-act="cancel"><span>Cancel</span></button>
        </div>
      </div>`;

    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    function onKey(e) { if (e.key === 'Escape') done(undefined); }

    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(undefined); });
    overlay.querySelectorAll('[data-react]').forEach((b) =>
      b.addEventListener('click', () => done({ action: 'react', id: b.dataset.react })));
    overlay.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => done(b.dataset.act === 'cancel' ? undefined : { action: b.dataset.act })));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  });
}

/**
 * The edit box. A modal rather than an inline field on purpose: the chat log
 * repaints wholesale whenever any message changes, which would wipe an
 * in-place editor mid-sentence if the other person wrote while you were typing.
 * Resolves to the new text, or undefined if cancelled.
 */
export function openEditor(currentText, deadline) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="settings-card edit-card" role="dialog" aria-modal="true" aria-label="Edit message">
        <div class="row"><h3 style="margin:0;">Edit message</h3><button class="btn quiet" data-cancel>Cancel</button></div>
        <textarea class="edit-box" data-text maxlength="2000" rows="4"></textarea>
        <p class="dim small" data-left style="margin:.4rem 0 0;"></p>
        <div class="actions" style="margin-top:.7rem;"><button class="btn" data-save>Save</button></div>
      </div>`;

    const box = overlay.querySelector('[data-text]');
    const left = overlay.querySelector('[data-left]');
    box.value = currentText;

    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      clearInterval(tick);
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    function onKey(e) { if (e.key === 'Escape') done(undefined); }

    // The window is real and short — show it running down rather than letting
    // someone finish a careful rewrite and get refused.
    const tick = setInterval(() => {
      const ms = deadline - Date.now();
      if (ms <= 0) {
        left.textContent = 'The 3-minute edit window has closed.';
        overlay.querySelector('[data-save]').disabled = true;
        clearInterval(tick);
        return;
      }
      const s = Math.ceil(ms / 1000);
      left.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} left to edit`;
    }, 250);

    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(undefined); });
    overlay.querySelector('[data-cancel]').addEventListener('click', () => done(undefined));
    overlay.querySelector('[data-save]').addEventListener('click', () => {
      const v = box.value.trim();
      if (v) done(v);
    });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  });
}
