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
    <span class="demo-what"><strong>Demo.</strong> Invented case, nothing saved anywhere,
      no payments, no email. ${role === 'admin' ? "You are looking at the advocate's side." : 'You are looking at what a client sees.'}</span>
    <span class="demo-acts">
      <a class="btn ghost" href="${role === 'admin' ? '/case.html?demo=1' : '/admin.html?demo=admin'}"
        >${role === 'admin' ? 'Client side' : 'Advocate side'}</a>
      <button type="button" class="btn ghost" data-demo-reset>Start over</button>
    </span>`;
  document.body.prepend(bar);
  document.body.classList.add('has-demo-bar');

  bar.querySelector('[data-demo-reset]').addEventListener('click', () => {
    reset();
    // A full reload, because half the app is holding state from the case that
    // just stopped existing.
    location.reload();
  });
}
