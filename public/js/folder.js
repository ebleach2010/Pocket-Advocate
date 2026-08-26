// The case folder: a strip of staggered cut tabs over a stack of pages, one
// page showing at a time, flipped by the tab strip, a sideways swipe, or an
// arrow key. Tapping the page itself does NOT turn it - see the note by the
// swipe handler for why that was removed.
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
export function mountPages({ container, pages, storageKey = '', groups = null } = {}) {
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

  // Two tiers, or one. `groups` is [{ id, label, icon, pages: [pageId…] }];
  // a page named in no group, or no groups at all, means the old flat strip.
  const groupList = (groups || [])
    .map((g) => ({ ...g, pages: (g.pages || []).filter((id) => byId.has(id)) }))
    .filter((g) => g.id && g.pages.length);
  const grouped = groupList.length > 0;
  const groupOf = new Map();
  for (const g of groupList) for (const id of g.pages) groupOf.set(id, g.id);
  // A page nobody claimed still has to be reachable, so it joins the first
  // group rather than becoming unreachable furniture.
  if (grouped) {
    for (const p of list) {
      if (!groupOf.has(p.id)) {
        groupOf.set(p.id, groupList[0].id);
        groupList[0].pages.push(p.id);
      }
    }
  }
  let openGroup = grouped ? groupList[0].id : null;
  // Where he was in each group, so coming back to a group returns him to the
  // page he left rather than to its front.
  const lastInGroup = new Map(groupList.map((g) => [g.id, g.pages[0]]));

  // The strip is built here and prepended; the pages stay exactly where the
  // caller put them (reparenting a live page would drop focus and scroll).
  let groupNav = null;
  if (grouped) {
    groupNav = document.createElement('nav');
    groupNav.className = 'folder-groups';
    groupNav.setAttribute('role', 'tablist');
    groupNav.setAttribute('aria-label', 'Sections');
    // Four chips across a phone need the label under the icon, same as a
    // crowded page row does.
    if (groupList.length >= 4) groupNav.classList.add('many');
    groupNav.innerHTML = groupList.map((g) => `
      <button type="button" class="fgrp" data-group="${esc(g.id)}" aria-selected="false">
        ${g.icon ? `<span class="fgrp-ic" aria-hidden="true">${esc(g.icon)}</span>` : ''}<span class="fgrp-t">${esc(g.label || g.id)}</span><span class="fgrp-dot" data-gdot hidden></span>
      </button>`).join('');
  }

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
  if (groupNav) {
    container.prepend(groupNav);
    // The page row sticks below the group row rather than under the header, so
    // the class carries the offset instead of a :has() the CSS would need.
    container.classList.add('two-tier');
  }

  const tabs = new Map();
  nav.querySelectorAll('a[data-page]').forEach((a) => tabs.set(a.dataset.page, a));
  const groupTabs = new Map();
  groupNav?.querySelectorAll('button[data-group]').forEach((b) => groupTabs.set(b.dataset.group, b));

  /** The pages the strip is currently offering: one group's, or all of them. */
  const visible = () => (grouped
    ? groupList.find((g) => g.id === openGroup).pages.map((id) => byId.get(id))
    : list);

  /**
   * Show one group's page tabs and hide the rest. Hidden, not removed and not
   * scrolled past: the row holds one group's worth of tabs so it never needs
   * to scroll sideways, which is the whole point of the second tier.
   */
  function paintGroups() {
    if (!grouped) {
      // A flat strip with four or more tabs has the same width problem a
      // crowded group does, and the same answer.
      // Three full-size tabs already overflow a 320px row: measured, not
      // guessed. Three is where the even-width treatment starts.
      nav.classList.toggle('tight', list.length >= 3);
      return;
    }
    const g = groupList.find((x) => x.id === openGroup);
    const mine = new Set(g.pages);
    tabs.forEach((a, id) => { a.hidden = !mine.has(id); });
    // Enough tabs across a narrow phone and the label needs its own line
    // under the icon. Set here rather than in a media query because it
    // depends on how many pages this group has, not on the screen.
    nav.classList.toggle('tight', g.pages.length >= 3);
    groupTabs.forEach((b, id) => {
      const on = id === openGroup;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    paintGroupDots();
  }

  /**
   * A dot on a page inside a closed group is invisible, so it bubbles to the
   * group chip. The open group never shows one: its own tabs are saying it.
   */
  function paintGroupDots() {
    if (!grouped) return;
    for (const g of groupList) {
      const dot = groupTabs.get(g.id)?.querySelector('[data-gdot]');
      if (!dot) continue;
      const any = g.id !== openGroup && g.pages.some((id) => {
        const d = tabs.get(id)?.querySelector('[data-dot]');
        return d && !d.hidden;
      });
      dot.hidden = !any;
    }
  }

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
    if (grouped) {
      openGroup = groupOf.get(id) || openGroup;
      lastInGroup.set(openGroup, id);
      paintGroups();
    }

    // Hide the outgoing page outright rather than animating it out: two pages
    // in the flow at once makes the folder jump to the taller one mid-flip.
    if (from) { clearFlip(from.el); from.el.hidden = true; }
    next.el.hidden = false;
    flipIn(next, from, dir);
    // Bring the tab strip up to the top of the screen, so the page that just
    // opened is the thing you are looking at. Without this, on a narrow phone,
    // tapping a tab changed nothing above the fold: the header, the title and
    // the hint stayed put and only the highlight moved, at the bottom edge.
    // Only when the strip has actually scrolled out of its resting place, so a
    // tap at the top of a short page does not yank anything.
    try {
      const strip = nav;
      const barH = parseInt(getComputedStyle(document.documentElement)
        .getPropertyValue('--bar-h'), 10) || 52;
      // In BOTH directions. This used to fire only when the strip sat below
      // its docked spot (a page scrolled near the top), so opening a tab from
      // halfway down a long page left you staring at the MIDDLE of the new
      // page - the chat especially, which he opened onto a random slice of
      // history. (Eric, 2026-08-21: "it should put the chat center of
      // screen.") Now a tab tap always lands the strip under the bar, page
      // filling the screen below it.
      const top = strip ? strip.getBoundingClientRect().top : barH;
      if (strip && Math.abs(top - barH) > 4) {
        const y = window.scrollY + top - barH;
        window.scrollTo({ top: Math.max(0, y), behavior: REDUCED() ? 'auto' : 'smooth' });
      }
    } catch { /* scrolling is a nicety, never a requirement */ }
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
    if (!byId.has(id)) return;
    // Direction is only meaningful between two pages of the same group; going
    // to another group is a fresh page, not a flip through the pile.
    const sameGroup = !grouped || groupOf.get(id) === groupOf.get(curId);
    const scope = sameGroup ? visible() : [];
    const from = scope.findIndex((p) => p.id === curId);
    const to = scope.findIndex((p) => p.id === id);
    show(id, sameGroup && to >= 0 && from >= 0 ? (to < from ? -1 : 1) : 0);
  }

  /**
   * Move one page. `wrap` makes the pile a loop: past the last page is the
   * first one again, so shuffling forward never dead-ends and he never has to
   * tap all the way back. Arrow keys deliberately do NOT wrap, because a
   * keyboard user expects the strip to have ends.
   */
  function step(delta, focusTab, wrap = false) {
    // Within the open group. Flipping out of a group sideways would move the
    // group row under his thumb, which is the travel this was meant to remove.
    const scope = visible();
    const i = scope.findIndex((p) => p.id === curId);
    if (i < 0) return;
    let n = i + delta;
    if (n < 0 || n >= scope.length) {
      if (!wrap) return;
      n = (n + scope.length) % scope.length;
    }
    show(scope[n].id, delta);
    if (focusTab) tabs.get(scope[n].id)?.focus();
  }

  groupNav?.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-group]');
    if (!b) return;
    e.preventDefault();
    // Back to where he was in that group, not to its front.
    const want = lastInGroup.get(b.dataset.group);
    if (want && want !== curId) go(want);
    else { openGroup = b.dataset.group; paintGroups(); }
  }, on);

  // TAP-TO-TURN IS GONE, and must not come back (Eric, 2026-08-25, on a PC:
  // "when I click on center screen of [a wide page] it puts me back to the
  // dx… That can be removed. Pressing tabs is easy enough.").
  //
  // The bracket replaces one word of his. Every client browser downloads this
  // file, so the admin-only vocabulary must not appear in it even inside a
  // comment; tools/blindness-audit.mjs is what catches it.
  //
  // Why it bit worst exactly where he found it: a `fade` page only ever
  // turned from the page's own bare margin, and on a wide screen the middle
  // of a chat IS bare margin. So an idle click in the empty space between
  // bubbles threw him onto another page, with nothing on screen to explain
  // what he had done.
  //
  // The tab strip, the sideways swipe and the arrow keys all remain, and all
  // three say what they are before you commit to them. A tap that turns a
  // page does not, which is what made it the wrong control for a person who
  // is tired and reading.

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
  paintGroups();
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
    paintGroupDots();
  }

  container.__paPages = {
    destroy() {
      abort.abort();
      groupNav?.remove();
      nav.remove();
      container.classList.remove('two-tier');
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
 * mountFolder({ container, pages, storageKey, initial, onShow })
 *   pages: [{ id, title, icon, render(pane), onShow?(pane), fade? }]
 *          `fade` marks a page whose transform would break something inside it
 *          (full-screen chat is position:fixed and dies inside a transformed
 *          ancestor), so it cross-fades instead of flipping.
 *   groups: [{ id, label, icon, pages: [pageId…] }] turns the strip into two
 *          tiers - a group row that never changes and a page row showing only
 *          the open group. Omit it and the strip is exactly what it was.
 *   initial: page to open when nothing is remembered yet.
 *   onShow(id, pane): fires whenever a page comes forward, BEFORE that page's
 *          own onShow. This is where a caller marks a page seen, so a page
 *          added later cannot forget to.
 * Returns { el(id), show(id), current(), mark(id, on) }.
 */
export function mountFolder({ container, pages = [], storageKey = '', initial = '', onShow = null, groups = null } = {}) {
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

  const pager = mountPages({ container, pages: list, storageKey, groups });

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
