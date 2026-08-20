// The drawer: the advocate's shelf of case folders.
//
// Split out of folder.js deliberately. That file is the page engine and the
// client's own case page loads it, so anything in it can be read by a patient
// who opens devtools. A folder card carries the working diagnosis on its front
// and long-presses to let Eric override it, and a client is meant to be blind
// to the fact any of that exists. Nothing here is ever loaded by a client page.
//
// The engine itself still lives in folder.js and is shared by both sides.

// Same press length as chat.js, so one long press feels like every other.
const LONG_PRESS_MS = 550;
// The folder-open beat before navigation. Long enough to read as a folder
// opening, short enough that nobody taps twice.
const OPEN_MS = 450;

const REDUCED = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/**
 * One folder on the shelf. Everything interpolated is escaped here, so callers
 * pass raw strings - except `flags`, which is markup by definition (a run of
 * small pills the caller has already built).
 */
export function folderCardHtml({
  id = '', href = '#', name = '', dx = '', dxIsMine = false,
  meta = '', badge = '', badgeClass = '', flags = '',
} = {}) {
  const read = String(dx || '').trim();
  // An override has to carry his mark, or a line he wrote reads as the
  // advisor's read of the case.
  const pen = dxIsMine ? '<span class="dx-pen" role="img" aria-label="your read">✎</span>' : '';
  const dxCls = read ? (dxIsMine ? ' mine' : '') : ' empty';
  return `
    <a class="folder" href="${esc(href)}" data-id="${esc(id)}">
      <span class="folder-tab"><span class="folder-name">${esc(name)}</span></span>
      <span class="folder-body">
        <span class="folder-dx${dxCls}" data-dx="${esc(id)}" data-dx-text="${esc(read)}"
          >${read ? `${pen}${esc(read)}` : 'No read yet'}</span>
        ${meta ? `<span class="folder-meta">${esc(meta)}</span>` : '<span class="folder-meta"></span>'}
        ${badge ? `<span class="status-pill ${esc(badgeClass)}">${esc(badge)}</span>` : ''}
        ${flags ? `<span class="folder-flags">${flags}</span>` : ''}
      </span>
    </a>`;
}

/** Tap a folder: it opens in the hand, then the case page loads. */
export function wireFolderOpen(root) {
  if (!root || root.__paFolderOpen) return;
  root.__paFolderOpen = true;

  root.addEventListener('click', (e) => {
    const card = e.target.closest?.('.folder');
    if (!card || !root.contains(card)) return;

    // The working-diagnosis line is the long-press target for an override, and
    // the click that trails a fired press is not a request to open anything.
    const pressed = card.dataset.lp === '1' || !!card.querySelector('[data-lp="1"]');
    if (pressed || e.target.closest('.folder-dx')) {
      e.preventDefault();
      delete card.dataset.lp;
      card.querySelectorAll('[data-lp]').forEach((n) => { delete n.dataset.lp; });
      return;
    }

    const href = card.getAttribute('href');
    if (!href || href === '#') return;
    e.preventDefault();
    if (card.classList.contains('opening')) return; // one open per tap
    if (REDUCED()) { location.assign(href); return; }
    card.classList.add('opening');
    setTimeout(() => location.assign(href), OPEN_MS);
  });
}

/**
 * Long-press (or right-click) a folder's working-diagnosis line to override it:
 * handler(id, currentText). The stored text comes off the element, so the "No
 * read yet" placeholder never lands in the editor as if he had written it.
 */
export function wireDxLongPress(root, handler) {
  if (!root || typeof handler !== 'function' || root.__paDxPress) return;
  root.__paDxPress = true;

  let timer = null;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };

  const fire = (el) => {
    // Marked on both the line and its folder so the click that follows the
    // press opens an editor and not the case.
    el.dataset.lp = '1';
    const card = el.closest('.folder');
    if (card) card.dataset.lp = '1';
    const id = el.dataset.dx || card?.dataset.id || '';
    const text = 'dxText' in el.dataset ? el.dataset.dxText : el.textContent.trim();
    try { handler(id, text); } catch (err) { console.warn('dx override:', err); }
  };

  root.addEventListener('pointerdown', (e) => {
    const el = e.target.closest?.('.folder-dx');
    if (!el || !root.contains(el)) return;
    delete el.dataset.lp;
    timer = setTimeout(() => { timer = null; fire(el); }, LONG_PRESS_MS);
  });
  ['pointerup', 'pointerleave', 'pointercancel', 'pointermove'].forEach((ev) =>
    root.addEventListener(ev, cancel));
  root.addEventListener('contextmenu', (e) => {
    const el = e.target.closest?.('.folder-dx');
    if (!el || !root.contains(el)) return;
    e.preventDefault();
    cancel();
    fire(el);
  });
}
