// The case folder: a strip of staggered cut tabs over a stack of pages, one
// page showing at a time, flipped by tap, sideways swipe, or arrow key.
//
// The rule the rest of this file hangs off: pages are built by the caller and
// mounted ONCE. This engine only shows and hides them. The chat page carries a
// live onSnapshot listener and whatever is half-typed in the composer, and
// other pages carry poll loops. Rebuilding one throws all of that away, so
// nothing here ever writes into a page's DOM.
//
// The other rule, the one that bites: `.chat-root.chat-full` is position:fixed,
// and a transformed ancestor would pin it to that ancestor's box instead of the
// screen. Any page holding the chat is marked `.no-transform` and can only ever
// fade - enforced below in JS and again in CSS, because a comment alone has
// never stopped anyone.

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
export function mountPages({ container, pages, storageKey = '', noFlip = [] } = {}) {
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
         data-page="${esc(p.id)}">${p.icon ? `<span class="ftab-ic" aria-hidden="true">${esc(p.icon)}</span>` : ''}<span class="ftab-t">${esc(p.label || p.id)}</span><span class="ftab-dot" data-dot hidden></span></a>`;
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
    // The sheet edges under the folder give a little as a page is pulled off
    // the pile. Restarted, not queued: re-adding the class on the next tap has
    // to replay the animation, and it only does that after a reflow.
    if (!fade) {
      container.classList.remove('shuffling');
      void container.offsetWidth;
      container.classList.add('shuffling');
    }
    const done = () => { clearFlip(el); container.classList.remove('shuffling'); };
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

  /**
   * Move one page. `wrap` makes the pile a loop: past the last page is the
   * first one again, so shuffling forward never dead-ends and he never has to
   * tap all the way back. Arrow keys deliberately do NOT wrap, because a
   * keyboard user expects the strip to have ends.
   */
  function step(delta, focusTab, wrap = false) {
    const i = list.findIndex((p) => p.id === curId);
    let n = i + delta;
    if (n < 0 || n >= list.length) {
      if (!wrap) return;
      n = (n + list.length) % list.length;
    }
    show(list[n].id, delta);
    if (focusTab) tabs.get(list[n].id)?.focus();
  }

  /**
   * Tap the right half of the paper to send it to the back of the pile, the
   * left half to pull the back page forward.
   *
   * The rule that keeps this livable: controls win. A tap that lands on
   * anything interactive does what that control does and never flips, or every
   * button on the right of a page would fight the page turn. Pages that opt
   * out entirely (`fade`/noTransform pages like the chat, which is mostly
   * bubbles and dead space, and the notes sheet, where a tap places a cursor)
   * are left alone and keep swipe and the tab strip.
   */
  // Anything interactive, plus whatever the caller says is not paper. The
  // caller's half matters: a page can hold its own tappable furniture, and
  // naming it here would put every page's internals in every page's bundle.
  const NO_FLIP = ['a', 'button', 'input', 'textarea', 'select', 'label', 'summary',
    'details', '[contenteditable]', '[role="button"]', '[role="tab"]',
    '.msg', '.chip-label', '.folder-tabs', '.chat-root', ...noFlip].join(',');

  container.addEventListener('click', (e) => {
    const page = byId.get(curId);
    if (!page) return;
    if (!page.el.contains(e.target)) return;    // not this page's paper
    // Pages that opt out (the chat, thick with bubbles and dead space he taps
    // around in; the notes sheet, where a tap places a cursor) only flip from
    // the bare margin of the page itself. Without that they would be a trap:
    // you could tap your way in and never tap your way out.
    if (page.noTransform) {
      if (e.target !== page.el) return;
    } else if (e.target.closest?.(NO_FLIP)) {
      return;                                   // a control, not the paper
    }
    // He was selecting text, not turning a page.
    if (window.getSelection && String(window.getSelection())) return;
    const box = page.el.getBoundingClientRect();
    if (!box.width) return;
    step(e.clientX - box.left > box.width / 2 ? 1 : -1, false, true);
  }, { signal: abort.signal });

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
    // Swipe loops for the same reason tapping does: the pile has no end.
    step(dx < 0 ? 1 : -1, false, true);
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

  /**
   * Put a dot on a tab, or take it off. The shelf shows WHICH page changed as
   * an emoji; inside the folder the tab strip only has to say "this one", so a
   * dot is enough and it does not crowd the label. The page he is on never
   * carries one: he is looking at it.
   */
  function mark(id, on) {
    const dot = tabs.get(id)?.querySelector('[data-dot]');
    if (dot) dot.hidden = !on || id === curId;
  }

  container.__paPages = {
    destroy() {
      abort.abort();
      nav.remove();
      container.classList.remove('case-folder');
      delete container.__paPages;
    },
  };

  return { show: go, current: () => curId, mark };
}

/**
 * The folder, built for you. Where mountPages takes elements that already
 * exist, this creates a pane per page, renders into it once, and hands back a
 * handle with `el(id)` so the caller can reach into a page later (mounting
 * the chat, repainting a page in place) without ever rebuilding it.
 *
 * mountFolder({ container, pages, storageKey, initial, onShow, noFlip })
 *   pages: [{ id, title, icon, render(pane), onShow?(pane), fade? }]
 *          `fade` marks a page whose transform would break something inside it
 *          (full-screen chat is position:fixed and dies inside a transformed
 *          ancestor), so it cross-fades instead of flipping.
 *   noFlip: extra selectors that must not turn the page when tapped.
 *   initial: page to open when nothing is remembered yet.
 *   onShow(id, pane): fires whenever a page comes forward, BEFORE that page's
 *          own onShow. This is where a caller marks a page seen, so a page
 *          added later cannot forget to.
 * Returns { el(id), show(id), current(), mark(id, on) }.
 */
export function mountFolder({ container, pages = [], storageKey = '', initial = '', onShow = null, noFlip = [] } = {}) {
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
      // The folder-level hook runs first and always: it is how a page marks
      // itself seen, and a page added later must not be able to forget to.
      onShow: (el) => { onShow?.(p.id, el); p.onShow?.(el); },
    });
  }
  if (!list.length) return { el: () => null, show() {}, current: () => null };

  // Render every page up front. They are cheap, and a page that only builds
  // itself on first view cannot be reached by the code that mounts the chat or
  // repaints a page before it has ever been opened.
  for (const p of (pages || [])) {
    const pane = panes.get(p.id);
    if (!pane || typeof p.render !== 'function') continue;
    try { p.render(pane); } catch (err) {
      console.error(`folder page "${p.id}" failed to render:`, err);
      pane.innerHTML = '<p class="error">This page failed to load.</p>';
    }
  }

  const pager = mountPages({ container, pages: list, storageKey, noFlip });

  // `initial` is a default, not a command: a remembered page wins, because
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
    mark: pager.mark,
  };
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
