// The case folder: a strip of staggered cut tabs over a stack of pages, one
// page showing at a time, flipped by tap, sideways swipe, or arrow key.
//
// The rule the rest of this file hangs off: pages are built by the caller and
// mounted ONCE. This engine only shows and hides them. The chat page carries a
// live onSnapshot listener and whatever is half-typed in the composer; the
// advisor page carries a poll loop. Rebuilding either throws all of that away,
// so nothing here ever writes into a page's DOM.
//
// The other rule, the one that bites: `.chat-root.chat-full` is position:fixed,
// and a transformed ancestor would pin it to that ancestor's box instead of the
// screen. Any page holding the chat is marked `.no-transform` and can only ever
// fade - enforced below in JS and again in CSS, because a comment alone has
// never stopped anyone.

// Same press length as chat.js, so one long press feels like every other.
const LONG_PRESS_MS = 550;
// The folder-open beat before navigation. Long enough to read as a folder
// opening, short enough that nobody taps twice.
const OPEN_MS = 450;
// A flip has to be deliberate: a real sideways drag, not a wobble on a scroll.
const SWIPE_MIN_X = 50;
// The outer 24px of the screen belong to Safari's back gesture.
const EDGE = 24;

const REDUCED = () =>
  !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

let seq = 0;

/**
 * mountPages({ container, pages, storageKey })
 *   pages: [{ id, label, icon, el, noTransform?, onShow? }] - `el` is already
 *          inside `container` and is never rebuilt, only shown and hidden.
 *   storageKey: localStorage key holding the last open page id ('' = forget).
 * Returns { show(id), current() }.
 *
 * Most callers want mountFolder() below instead: it builds the panes for you.
 */
export function mountPages({ container, pages, storageKey = '' } = {}) {
  const list = (pages || []).filter((p) => p && p.id && p.el);
  if (!container || !list.length) return { show() {}, current: () => null };

  // A second mount on the same container (switching cases) must not leave the
  // old strip and its listeners behind, still flipping pages that are gone.
  container.__paPages?.destroy();

  const abort = new AbortController();
  const on = { signal: abort.signal };
  const uid = `fld${++seq}`;
  const byId = new Map(list.map((p) => [p.id, p]));

  container.classList.add('case-folder');

  // The strip is built here and prepended; the pages stay exactly where the
  // caller put them (reparenting a live page would drop focus and scroll).
  const nav = document.createElement('nav');
  nav.className = 'folder-tabs';
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'Case pages');
  nav.innerHTML = list.map((p, i) => {
    p.el.id = p.el.id || `${uid}-pg-${i}`;
    return `
      <a class="ftab" role="tab" href="#${esc(p.el.id)}" id="${uid}-tab-${i}"
         aria-controls="${esc(p.el.id)}" aria-selected="false" tabindex="-1"
         data-page="${esc(p.id)}">${p.icon ? `<span class="ftab-ic" aria-hidden="true">${esc(p.icon)}</span>` : ''}<span class="ftab-t">${esc(p.label || p.id)}</span></a>`;
  }).join('');
  container.prepend(nav);

  const tabs = new Map();
  nav.querySelectorAll('a[data-page]').forEach((a) => tabs.set(a.dataset.page, a));

  list.forEach((p, i) => {
    p.el.classList.add('fpage');
    p.el.setAttribute('role', 'tabpanel');
    p.el.setAttribute('aria-labelledby', `${uid}-tab-${i}`);
    if (flat(p)) p.el.classList.add('no-transform');
    p.el.hidden = true;
  });

  let curId = null;

  function show(id, dir = 0) {
    const idx = list.findIndex((p) => p.id === id);
    if (idx < 0 || id === curId) return;
    const from = curId ? byId.get(curId) : null;
    const next = list[idx];
    curId = id;

    // Hide the outgoing page outright rather than animating it out: two pages
    // in the flow at once makes the folder jump to the taller one mid-flip.
    if (from) { clearFlip(from.el); from.el.hidden = true; }
    next.el.hidden = false;
    flipIn(next, from, dir);
    // Landing on a page is the moment for anything that needs real layout:
    // pinning a chat log to its newest message, clearing an unseen badge.
    try { next.onShow?.(next.el); } catch (err) { console.warn('page onShow:', err); }

    tabs.forEach((a, tid) => {
      const active = tid === id;
      a.classList.toggle('on', active);
      a.setAttribute('aria-selected', active ? 'true' : 'false');
      // Roving tabindex: one stop for the whole strip, arrows do the rest.
      a.tabIndex = active ? 0 : -1;
    });
    reveal(tabs.get(id));

    if (storageKey) {
      try { localStorage.setItem(storageKey, id); } catch { /* storage blocked */ }
    }
  }

  function flipIn(page, from, dir) {
    const el = page.el;
    clearFlip(el);
    if (REDUCED() || !from) return; // the first page is simply there
    // Either side being the chat page means the whole flip is opacity-only, so
    // going in and coming back feel like the same gesture.
    const fade = flat(page) || flat(from);
    el.classList.add(fade ? 'f-fade' : dir < 0 ? 'f-in-l' : 'f-in-r');
    const done = () => clearFlip(el);
    el.addEventListener('animationend', done, { once: true });
    // animationend never arrives if the tab is backgrounded mid-flip.
    setTimeout(done, 420);
  }

  function go(id) {
    const from = list.findIndex((p) => p.id === curId);
    const to = list.findIndex((p) => p.id === id);
    if (to < 0) return;
    show(id, to < from ? -1 : 1);
  }

  function step(delta, focusTab) {
    const i = list.findIndex((p) => p.id === curId);
    const n = i + delta;
    if (n < 0 || n >= list.length) return;
    show(list[n].id, delta);
    if (focusTab) tabs.get(list[n].id)?.focus();
  }

  /** Keep the open tab in the strip without ever scrolling the page itself. */
  function reveal(tab) {
    if (!tab) return;
    const nr = nav.getBoundingClientRect();
    const tr = tab.getBoundingClientRect();
    if (!nr.width) return;
    const pad = 14;
    let d = 0;
    if (tr.left < nr.left + pad) d = tr.left - nr.left - pad;
    else if (tr.right > nr.right - pad) d = tr.right - nr.right + pad;
    if (!d) return;
    try { nav.scrollBy({ left: d, behavior: REDUCED() ? 'auto' : 'smooth' }); }
    catch { nav.scrollLeft += d; }
  }

  nav.addEventListener('click', (e) => {
    const a = e.target.closest?.('a[data-page]');
    if (!a) return;
    e.preventDefault(); // the href is there for focus and semantics, not travel
    go(a.dataset.page);
  }, on);

  nav.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (!e.target.closest?.('a[data-page]')) return;
    e.preventDefault();
    step(e.key === 'ArrowRight' ? 1 : -1, true);
  }, on);

  // Swipe to flip, with case.js's discipline: one finger, mostly sideways, far
  // enough to mean it, never off something the finger is trying to use or
  // scroll, and never from the screen edges.
  let x0 = 0;
  let y0 = 0;
  let live = false;
  container.addEventListener('touchstart', (e) => {
    live = false;
    if (e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.target.closest?.('input, textarea, select, button, a, [contenteditable]')) return;
    if (scrollableX(t.target, container)) return;
    if (t.clientX < EDGE || t.clientX > window.innerWidth - EDGE) return;
    x0 = t.clientX; y0 = t.clientY; live = true;
  }, { passive: true, signal: abort.signal });
  container.addEventListener('touchend', (e) => {
    if (!live) return;
    live = false;
    const t = e.changedTouches[0];
    const dx = t.clientX - x0;
    const dy = t.clientY - y0;
    if (Math.abs(dx) < SWIPE_MIN_X || Math.abs(dy) >= Math.abs(dx)) return;
    step(dx < 0 ? 1 : -1, false);
  }, { passive: true, signal: abort.signal });
  container.addEventListener('touchcancel', () => { live = false; },
    { passive: true, signal: abort.signal });

  // Come back to the page you left. A remembered id that no longer exists (the
  // page list changed under it) falls back to the front of the folder.
  let openTo = list[0].id;
  if (storageKey) {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved && byId.has(saved)) openTo = saved;
    } catch { /* storage blocked */ }
  }
  show(openTo);

  container.__paPages = {
    destroy() {
      abort.abort();
      nav.remove();
      container.classList.remove('case-folder');
      delete container.__paPages;
    },
  };

  return { show: go, current: () => curId };
}

/**
 * The folder, built for you. Where mountPages takes elements that already
 * exist, this creates a pane per page, renders into it once, and hands back a
 * handle with `el(id)` so the caller can reach into a page later (mounting the
 * chat, repainting the differential) without ever rebuilding it.
 *
 * mountFolder({ container, pages, storageKey, initial })
 *   pages: [{ id, title, icon, render(pane), onShow?(pane), fade? }]
 *          `fade` marks a page whose transform would break something inside it
 *          (full-screen chat is position:fixed and dies inside a transformed
 *          ancestor), so it cross-fades instead of flipping.
 *   initial: page to open when nothing is remembered yet.
 * Returns { el(id), show(id), current() }.
 */
export function mountFolder({ container, pages = [], storageKey = '', initial = '' } = {}) {
  if (!container) return { el: () => null, show() {}, current: () => null };

  container.innerHTML = '';
  const panes = new Map();
  const list = [];

  for (const p of (pages || [])) {
    if (!p || !p.id) continue;
    const pane = document.createElement('section');
    pane.className = 'fpage';
    pane.dataset.page = p.id;
    container.appendChild(pane);
    panes.set(p.id, pane);
    list.push({
      id: p.id,
      label: p.title || p.id,
      icon: p.icon || '',
      el: pane,
      noTransform: !!p.fade,
      onShow: p.onShow,
    });
  }
  if (!list.length) return { el: () => null, show() {}, current: () => null };

  // Render every page up front. They are cheap, and a page that only builds
  // itself on first view cannot be reached by the code that mounts the chat
  // or repaints the differential before it has ever been opened.
  for (const p of (pages || [])) {
    const pane = panes.get(p.id);
    if (!pane || typeof p.render !== 'function') continue;
    try { p.render(pane); } catch (err) {
      console.error(`folder page "${p.id}" failed to render:`, err);
      pane.innerHTML = '<p class="error">This page failed to load.</p>';
    }
  }

  const pager = mountPages({ container, pages: list, storageKey });

  // `initial` is a default, not an override: a remembered page wins, because
  // coming back to where you were beats being sent to the front every time.
  if (initial && panes.has(initial)) {
    let remembered = '';
    if (storageKey) {
      try { remembered = localStorage.getItem(storageKey) || ''; } catch { /* blocked */ }
    }
    if (!remembered || !panes.has(remembered)) pager.show(initial);
  }

  return {
    el: (id) => panes.get(id) || null,
    show: pager.show,
    current: pager.current,
  };
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

/** The workspace settling open, once, as if the folder had just been set down. */
export function folderEnter(el) {
  if (!el || REDUCED()) return;
  // Same fixed-position trap as the flips: if the chat lives anywhere inside
  // this element, the settle can only be a fade.
  if (el.classList.contains('no-transform') ||
      el.querySelector?.('.chat-root, .fpage.no-transform')) {
    el.classList.add('no-transform');
  }
  el.classList.add('enter');
  const done = () => el.classList.remove('enter');
  el.addEventListener('animationend', done, { once: true });
  setTimeout(done, 700);
}

function flat(page) {
  // The chat page by name, plus anything the caller flags: both mean "an
  // ancestor of something position:fixed, so never transform it".
  return !!page && (page.id === 'chat' || page.noTransform === true);
}

function clearFlip(el) {
  el.classList.remove('f-in-l', 'f-in-r', 'f-fade');
}

/** True when something between el and stop scrolls sideways on its own. */
function scrollableX(el, stop) {
  for (let n = el; n && n !== stop; n = n.parentElement) {
    if (n.scrollWidth > n.clientWidth + 4) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
  }
  return false;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}
