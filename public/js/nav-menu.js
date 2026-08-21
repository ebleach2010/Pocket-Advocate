// The top bar, when the links do not fit.
//
// The nav held more links than fit, inside a strip that was allowed to scroll
// sideways with its scrollbar hidden. On a phone that meant roughly 200 visible
// pixels of a 590 pixel row, with everything past it off the screen and nothing
// on screen suggesting it was there. The settings cog was one of the casualties,
// and the guided tour tells people to tap it.
//
// So: the strip stops scrolling. When the links do not fit on the row, they
// move into a menu behind a button that does fit, and the cog moves out of the
// strip entirely so it is always visible. When they do fit, nothing changes.
//
// The same elements are used either way - they are restyled, not cloned - so
// every listener that was attached to a link still works.

let barInner = null;
let tabs = null;
let acts = null;
let toggle = null;
let fitting = false;

/** The always-visible right-hand end of the bar. Created once, on demand. */
export function barActs() {
  const inner = document.querySelector('.bar-inner');
  if (!inner) return null;
  let el = inner.querySelector('.bar-acts');
  if (!el) {
    el = document.createElement('div');
    el.className = 'bar-acts';
    inner.appendChild(el);
  }
  return el;
}

function closeMenu() {
  if (!tabs) return;
  tabs.classList.remove('open');
  toggle?.setAttribute('aria-expanded', 'false');
}

function openMenu() {
  if (!tabs) return;
  tabs.classList.add('open');
  toggle?.setAttribute('aria-expanded', 'true');
}

/**
 * Decide, from the real width, whether the links fit.
 *
 * Measured with the menu collapsed OFF, because collapsed the links are stacked
 * in a panel and their widths mean nothing. One forced reflow per resize.
 */
function fit() {
  if (!tabs || !barInner || fitting) return;
  fitting = true;
  try {
    const wasCollapsed = barInner.classList.contains('collapsed');
    barInner.classList.remove('collapsed');
    closeMenu();
    // Read after the write, so the browser has laid the row back out.
    const over = tabs.scrollWidth > tabs.clientWidth + 4;
    barInner.classList.toggle('collapsed', over);
    if (over !== wasCollapsed) closeMenu();
  } finally {
    fitting = false;
  }
}

/**
 * Mounts itself, and imports nothing.
 *
 * The bar is the first thing on every page and the last thing that should
 * depend on anything: firebase.js is an async module, so when the Firebase CDN
 * is slow or blocked every module downstream of it - auth.js included - never
 * evaluates, and a bar wired from there would simply never be fitted.
 */
export function mountNav() {
  barInner = document.querySelector('.bar-inner');
  tabs = document.querySelector('.tabs');
  if (!barInner || !tabs) return;
  acts = barActs();

  if (!toggle) {
    toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nav-toggle';
    toggle.textContent = '☰';
    toggle.title = 'Menu';
    toggle.setAttribute('aria-label', 'Menu');
    toggle.setAttribute('aria-expanded', 'false');
    // Prepended, so the cog keeps the outermost corner it has always had.
    acts.prepend(toggle);
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      tabs.classList.contains('open') ? closeMenu() : openMenu();
    });
    // Anywhere else, and Escape, put it away. A menu that can only be closed by
    // the button that opened it is a trap on a small screen.
    document.addEventListener('click', (e) => {
      if (!tabs.classList.contains('open')) return;
      if (!tabs.contains(e.target) && e.target !== toggle) closeMenu();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
    tabs.addEventListener('click', (e) => { if (e.target.closest('a')) closeMenu(); });
  }

  fit();
  // Anything added to the bar later - the cog, a nav link once the sign-in
  // resolves - changes the answer, so re-ask instead of relying on call order.
  if (window.ResizeObserver) new ResizeObserver(fit).observe(barInner);
  else window.addEventListener('resize', fit);
  if (window.MutationObserver) {
    new MutationObserver(fit).observe(tabs, { childList: true, subtree: true });
    new MutationObserver(fit).observe(acts, { childList: true });
  }
  window.addEventListener('orientationchange', () => setTimeout(fit, 120));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountNav);
} else {
  mountNav();
}
