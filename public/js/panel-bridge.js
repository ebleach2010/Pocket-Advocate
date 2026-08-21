// Everything the chat does that only exists because the advisor panel does.
//
// WHY THIS FILE EXISTS. All of this used to live in chat.js, which every
// client with a case, a chat or a subscription downloads. It was correctly
// gated at runtime - none of it renders for a client - but a runtime gate does
// not stop anyone opening devtools, and the bytes shipped regardless. Between
// them the two files carried a live tooltip naming an Analyze button, a menu
// row called "Stage this file for review", a sheet that talks about repaired
// wording, and the pa-panel-* event names.
//
// Now it is one admin-only module, served behind the same gate as advisor.js,
// and chat.js reaches for it only when an admin thread mounts. A client's
// browser never asks for this file, and would be refused if it did.
//
// If you add anything here that a client must not know about, check it is in
// the ADMIN_ASSET list in worker/index.js in the same commit.

/** Per-message notes the panel pushes in: msgId → { issue, fixed }. */
const corrections = new Map();
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  document.addEventListener('pa-panel-state', (e) => {
    corrections.clear();
    for (const c of e.detail?.corrections || []) {
      if (c?.msgId) corrections.set(c.msgId, { issue: c.issue || '', fixed: c.fixed || '' });
    }
  });
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/**
 * A 👨‍⚕️ badge under a readable attachment. Tap once to select the file, tap
 * again to deselect; the panel's Update button counts what is selected.
 */
export function selectBadge(att) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'dr-badge';
  b.dataset.url = att.url;
  b.textContent = '👨‍⚕️';
  b.title = 'Select this file, then press Analyze in the panel';
  if (window.__paMediaSel?.has(att.url)) b.classList.add('on');
  b.addEventListener('click', () => {
    b.classList.toggle('on');
    document.dispatchEvent(new CustomEvent('pa-panel-toggle', {
      detail: {
        attachment: {
          name: att.name || 'file',
          url: att.url,
          contentType: att.contentType || '',
          size: att.size || 0,
        },
      },
    }));
  });
  return b;
}

/**
 * The sheet behind a flagged message: what is wrong, and the repaired wording.
 * Resolves 'fix', 'leave', or undefined if he backs out.
 *
 * Not a confirm(): it has to show two blocks of text, and this codebase has
 * already been bitten once by a native dialog that does nothing at all inside
 * an iOS home-screen app.
 */
export function openCorrection(issue, fixed) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';
    overlay.innerHTML = `
      <div class="settings-card fix-card" role="dialog" aria-modal="true" aria-label="Worth a second look">
        <div class="row"><h3 style="margin:0;">Worth a second look</h3>
          <button class="btn quiet" data-cancel>Close</button></div>
        <p class="fix-issue"></p>
        <div class="fix-text"></div>
        <div class="actions" style="margin-top:.7rem;">
          <button class="btn" data-fix>Use this wording</button>
          <button class="btn quiet" data-leave>Leave it as is</button>
        </div>
      </div>`;
    // textContent, not innerHTML: neither string is authored here.
    overlay.querySelector('.fix-issue').textContent = issue || '';
    overlay.querySelector('.fix-text').textContent = fixed || '';

    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      resolve(v);
    };
    function onKey(e) { if (e.key === 'Escape') done(undefined); }

    overlay.querySelector('[data-cancel]').addEventListener('click', () => done(undefined));
    overlay.querySelector('[data-fix]').addEventListener('click', () => done('fix'));
    overlay.querySelector('[data-leave]').addEventListener('click', () => done('leave'));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) done(undefined); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  });
}

/** The long-press rows that only make sense beside the panel. */
export function extraMenuRows({ canStage }) {
  return canStage
    ? [{ act: 'stage', emoji: '👨‍⚕️', label: 'Stage this file for review' }]
    : [];
}

/**
 * A quiet mark on one of his own messages that the last read flagged, and the
 * whole apply-or-dismiss loop behind it.
 *
 * `edit(msgId, text)` saves a repaired wording; `done(msgId)` tells the panel
 * to stop raising it.
 *
 * Named `paint` rather than anything descriptive, and the event it fires is
 * `pa-mark-done`, because chat.js has to spell both of them out and chat.js is
 * served to every client. The words for what this actually is live on this
 * side of the gate.
 */
export function paint(log, { edit, done, openEditor, editWindowMs }) {
  wire();
  for (const el of log.querySelectorAll('.msg.me[data-mid]')) {
    const c = corrections.get(el.dataset.mid);
    const existing = el.querySelector('.msg-fix');
    if (!c || (!c.issue && !c.fixed)) { existing?.remove(); continue; }
    if (existing) continue;
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'msg-fix';
    chip.textContent = '⚠ Worth a second look';
    chip.title = c.issue;
    chip.addEventListener('click', async (e) => {
      e.stopPropagation();
      const choice = await openCorrection(c.issue, c.fixed);
      if (!choice) return;
      if (choice === 'fix') {
        const text = await openEditor(c.fixed, Date.now() + editWindowMs);
        if (text === undefined) return;
        await edit(el.dataset.mid, text);
      }
      // Fixed or waved away, it stops being raised either way.
      corrections.delete(el.dataset.mid);
      chip.remove();
      done(el.dataset.mid);
    });
    el.appendChild(chip);
  }
}

/** Call back whenever the panel pushes new state, so the chat can repaint. */
export function onPanelState(fn) {
  wire();
  document.addEventListener('pa-panel-state', () => fn());
}

/** Repaint the selection badges when the panel changes the selection. */
export function watchSelection(container) {
  document.addEventListener('pa-panel-select', () => {
    container.querySelectorAll('.dr-badge').forEach((b) =>
      b.classList.toggle('on', !!window.__paMediaSel?.has(b.dataset.url)));
  });
}

/**
 * Furniture this module adds that a long press must not steal. Named here
 * rather than in chat.js, which every client downloads.
 */
export const noLongPress = ['.dr-badge'];

/** Hand a file to the panel for the next read. */
export function stageFile(attachment) {
  document.dispatchEvent(new CustomEvent('pa-panel-review', { detail: { attachment } }));
}

void esc;
