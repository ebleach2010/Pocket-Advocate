// Status reactions Eric puts on a client's message so nobody is left on read.
// Long-press (or right-click) a client message in any admin thread to pick one.
//
// Keep in sync with CHAT_REACTIONS in worker/index.js — the Worker owns the
// notification wording and is the only thing allowed to write these.

export const REACTIONS = [
  { id: 'seen', emoji: '👁', label: 'Eric has seen your message' },
  { id: 'reading', emoji: '📖', label: 'Eric is reading…' },
  { id: 'research', emoji: '🔎', label: 'Eric is doing research…' },
  { id: 'thinking', emoji: '💭', label: 'Eric is thinking about your situation…' },
  { id: 'history', emoji: '🗂', label: 'Eric is reviewing your history…' },
  { id: 'labs', emoji: '🧪', label: 'Eric is reviewing your labs / chart notes' },
];

export const byId = (id) => REACTIONS.find((r) => r.id === id);

/**
 * The picker sheet. Resolves to a reaction id, `null` to clear, or
 * `undefined` if dismissed (which means leave whatever is there alone).
 */
export function pickReaction(current) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay react-overlay';
    overlay.innerHTML = `
      <div class="settings-card react-card" role="dialog" aria-modal="true" aria-label="Let them know what you're doing">
        <div class="row">
          <h3 style="margin:0;">Let them know</h3>
          <button class="btn quiet" data-cancel>Cancel</button>
        </div>
        <p class="dim small" style="margin:.2rem 0 .7rem;">They get a notification saying exactly this. Nothing from the message itself is included.</p>
        <div class="react-list">
          ${REACTIONS.map((r) => `
            <button class="react-opt${r.id === current ? ' on' : ''}" data-pick="${r.id}">
              <span class="react-emoji">${r.emoji}</span><span>${r.label}</span>
            </button>`).join('')}
        </div>
        ${current ? '<div class="actions" style="margin-top:.7rem;"><button class="btn quiet" data-pick="">Remove reaction</button></div>' : ''}
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
    overlay.querySelector('[data-cancel]').addEventListener('click', () => done(undefined));
    overlay.querySelectorAll('[data-pick]').forEach((b) =>
      b.addEventListener('click', () => done(b.dataset.pick || null)));
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
  });
}
