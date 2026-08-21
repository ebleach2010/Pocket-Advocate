// The strip across the top that says this is not real, and the Reset that
// puts the fake case back so the booking flow can be walked again.
//
// Deliberately loud. A demo that looks exactly like the product is the point,
// and it is also the risk: nobody should ever be a paragraph into reading a
// case before working out that none of it happened.

import { reset } from './store.js';

export function mountBanner(role) {
  if (document.querySelector('.demo-bar')) return;
  const bar = document.createElement('div');
  bar.className = 'demo-bar';
  bar.innerHTML = `
    <span class="demo-dot" aria-hidden="true"></span>
    <span class="demo-what"><strong>Demo.</strong>
      <span class="demo-more">Invented case. Nothing saved, charged or sent.</span></span>
    <span class="demo-acts">
      <a class="btn ghost" href="${role === 'admin' ? '/case.html?demo=1' : '/admin.html?demo=admin'}"
        >${role === 'admin' ? 'Client side' : 'Advocate side'}</a>
      <button type="button" class="btn ghost" data-demo-reset>Start over</button>
    </span>`;
  document.body.prepend(bar);
  document.body.classList.add('has-demo-bar');

  // The strip wraps to a different number of lines at every width, and the
  // sticky page header docks underneath it. A guessed height meant the header
  // slid under the strip and vanished the moment anything scrolled, so the
  // real height is published and kept current through a rotation.
  const publish = () => document.documentElement.style.setProperty(
    '--demo-bar-h', `${Math.round(bar.getBoundingClientRect().height)}px`);
  publish();
  if (window.ResizeObserver) new ResizeObserver(publish).observe(bar);
  else window.addEventListener('resize', publish);

  // Loud at the top of the page, slim once you start reading. Three lines of
  // banner pinned over every screen fights everything the tabs were built to
  // fix, and the sentence has done its job by the time anyone scrolls: what is
  // still worth keeping in reach is the word Demo and the two buttons.
  //
  // Two thresholds, not one. Slimming removes about fifty pixels of page, which
  // moves the scroll position back up; on a single threshold that lands you
  // under it again, the strip grows, and the page shivers between the two
  // states for as long as you sit there.
  const slim = () => {
    const y = window.scrollY;
    if (y > 90) bar.classList.add('slim');
    else if (y < 20) bar.classList.remove('slim');
  };
  slim();
  window.addEventListener('scroll', slim, { passive: true });

  bar.querySelector('[data-demo-reset]').addEventListener('click', () => {
    reset();
    // A full reload, because half the app is holding state from the case that
    // just stopped existing.
    location.reload();
  });
}
