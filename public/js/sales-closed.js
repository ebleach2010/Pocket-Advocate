// The page half of the sales switches (sales.js). A courtesy, not the gate:
// the Worker refuses every closed purchase route whatever a page says.
//
// Package by package (Eric, 2026-10-14: "Unlock priority chat"), each on
// the switch he flips in his settings (2026-10-17), asked for once a page:
//   - a page whose <main> carries data-sales="case" (book) or "chat"
//     (subscribe) hides its buying flow behind the notice while that
//     package is closed, and is left alone while it is open;
//   - services marks each closed package's card "Not currently offering",
//     still opening that package's own page, and leads with the notice only
//     when every package is closed;
//   - the home turns each closed package's card back into the grey card that
//     is one door to its own page, and while the case is closed hides How it
//     works and its menu link; About hides How a case runs.
// Skipped in the demo, which drives the buying flows end to end.
import { packageOpen, loadSales } from './sales.js';

function inDemo() {
  try {
    const q = new URLSearchParams(location.search).get('demo');
    return q !== '0' && !!(q || sessionStorage.getItem('pa-demo'));
  } catch { return false; }
}

const NOTICE = `
    <section class="pa-closed" role="note">
      <h2>Not currently offering</h2>
      <p>Join the waitlist and I'll get back to you soon.</p>
      <a class="btn glow" href="/#waitlist">Join the waitlist</a>
    </section>`;

function style() {
  if (document.getElementById('pa-closed-style')) return;
  const el = document.createElement('style');
  el.id = 'pa-closed-style';
  el.textContent = `
    .pa-closed {
      display: grid; gap: .6rem; margin: 0 0 1.5rem; padding: 1.1rem 1.15rem;
      border: 1px solid var(--edge-lit, rgba(255, 255, 255, .18)); border-left-width: 4px;
      border-radius: 14px; background: var(--sur-base, #131317); color: var(--ink, #F5F5F7);
    }
    .pa-closed h2 { margin: 0; font-size: 1.25rem; }
    .pa-closed p { margin: 0; color: var(--soft, #D2D2D9); line-height: 1.5; }
    .pa-closed .btn { justify-self: start; }
    main.pa-closed-on > :not(.pa-closed):not(.footer-disclaimer) { display: none !important; }
    .pack.pa-off { opacity: .55; filter: grayscale(1); }
    .pa-off-badge {
      display: inline-block; justify-self: start; margin: .7rem 0 .4rem; padding: .2rem .6rem;
      border: 1px solid currentColor; border-radius: 999px;
      font-size: .72rem; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
    }`;
  document.head.appendChild(el);
}

// Each package's own page, and what shows only while that package is open.
const OWN_PAGE = { chat: '/priority-chat.html', case: '/advocacy-case.html', full: '/full-service.html' };
const ONLY_WHILE_OPEN = { case: ['#how', 'a[href="#how"]', '#case-runs'] };

/**
 * The home's card for a closed package, put back the way it was while closed
 * (v7.37): grey, the badge, no buttons, the whole card one door to its own
 * page. Its name, price and line are moved, not copied, so the prices the
 * rates script fills stay filled.
 */
export function closeHomeCard(card, pkg) {
  if (!card || card.tagName === 'A') return;
  const a = document.createElement('a');
  a.className = 'opt opt-off';
  a.href = OWN_PAGE[pkg];
  a.insertAdjacentHTML('afterbegin', '<span class="opt-badge">Not currently offering</span>');
  for (const el of card.querySelectorAll(':scope > h3, :scope > .svc-price, :scope > .svc-line')) a.appendChild(el);
  card.replaceWith(a);
}

/** The home and About: each closed package's card, and what shows only while it is open. */
function closeHome(closed) {
  for (const pkg of closed) {
    const link = document.querySelector(`#options .opt a[href="${OWN_PAGE[pkg]}"]`);
    closeHomeCard(link?.closest('.opt'), pkg);
    // Taken out rather than hidden: the home shows a section by its #anchor, whatever it is marked.
    for (const q of ONLY_WHILE_OPEN[pkg] || []) for (const el of document.querySelectorAll(q)) el.remove();
  }
}

export async function closeSales() {
  if (inDemo()) return;
  await loadSales();
  // An invitation he sent (2026-10-15) is not a sale anyone can start: the
  // booking page opened from one is his time at his price, open or closed.
  if (document.querySelector('main')?.dataset.sales === 'case' && new URLSearchParams(location.search).get('invite')) return;
  const main = document.querySelector('main');
  if (!main || main.querySelector('.pa-closed')) return;
  if (document.getElementById('options') || document.getElementById('case-runs')) {
    closeHome(['case', 'full', 'chat'].filter((p) => !packageOpen(p)));
    return;
  }
  const pkg = main.dataset.sales;
  if (pkg) {
    if (packageOpen(pkg)) return;
    style();
    main.insertAdjacentHTML('afterbegin', NOTICE);
    main.classList.add('pa-closed-on');
    return;
  }
  // Services: the cards, one at a time.
  const closed = ['case', 'full', 'chat'].filter((p) => !packageOpen(p));
  if (!closed.length) return;
  style();
  for (const id of closed) {
    const card = document.getElementById(id);
    if (!card) continue;
    card.classList.add('pa-off');
    // After the card's own tag, which hangs off its top edge, so the two never overlap.
    const tag = card.querySelector('.tag');
    if (tag) tag.insertAdjacentHTML('afterend', '<span class="pa-off-badge">Not currently offering</span>');
    else card.insertAdjacentHTML('afterbegin', '<span class="pa-off-badge">Not currently offering</span>');
    // The card stays a door: it opens the package's own page, which is
    // information, not a sale (2026-10-15: one package, one page).
  }
  if (closed.length === 3) main.insertAdjacentHTML('afterbegin', NOTICE);
}

closeSales();
