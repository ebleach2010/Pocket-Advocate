// The demo's front door: one button into the seamless demo, and the typed
// codes on the sign-in page. Loaded by book.html and signin.html through a
// host-gated dynamic import.
//
// THIS FILE IS THE POINT. The buttons and codes used to sit inline in the
// pages themselves, which meant the live site served HTML whose source spelled
// out the admin route, the demo URLs and the suite's existence to anyone who
// pressed View Source - inert there, but a map is a map. (Post-2.2 audit,
// 2026-08-21.) Everything that names those things now lives HERE, under
// /js/demo/, where the Worker answers the live site with the same 404 a
// missing file gets. The pages keep only a neutral import behind the host
// check; on thepocketadvocates.com that import fails and nothing of this
// exists.
//
// No imports, deliberately: the suite has to open even on a day Firebase or
// the app itself cannot. (See the header of store.js for the other traps.)

// ONE door (Eric, 2026-08-25: "No weird 4 room suites. Just seamless
// demo."): the landing page with the demo switched on. From there he books
// like normal, the booking becomes a real case in the store, and the demo
// banner switches him between the client and advocate sides. The old rooms
// stay reachable by typed code below - side doors, not the entrance.
const SEAMLESS = '/?demo=1';
const BOOKING = '/book.html?demo=1';
const CLIENT = '/case.html?demo=1&tour=1';
const CLIENT_FULL = '/case.html?demo=1&id=demo-case-full';
const ADMIN = '/admin.html?demo=admin&tour=1';

export function mount(page) {
  const box = document.createElement('div');
  box.style.marginTop = '1rem';
  box.innerHTML = `
    <p class="muted small" style="margin:0 0 .4rem;">Demo — no email, no payment:</p>
    <p style="display:flex; gap:.5rem; flex-wrap:wrap; margin:0;">
      <button type="button" class="btn glow" data-suite-go>▶ Start the demo</button>
    </p>
    <p class="muted small" style="margin:.4rem 0 0;">Starts at the landing page.
      Book like normal; the demo banner switches you between sides.</p>`;
  const go = (sel, to) => box.querySelector(sel)?.addEventListener('click', () => { location.href = to; });
  go('[data-suite-go]', SEAMLESS);
  const anchor = page === 'signin'
    ? document.getElementById('email-form')
    : document.getElementById('step');
  (anchor || document.querySelector('main') || document.body).insertAdjacentElement(
    anchor ? 'afterend' : 'beforeend', box);

  if (page !== 'signin') return;

  // The typed codes: 1234 the client side, 2345 the advocate side, 3456 the
  // booking walk, 4567 the Full Access case. Either box. Capture phase, so a
  // code never reaches the sign-in handlers.
  const CODES = { 1234: CLIENT, 2345: ADMIN, 3456: BOOKING, 4567: CLIENT_FULL };
  const typed = () => {
    for (const id of ['email', 'pin']) {
      const el = document.getElementById(id);
      const to = el && CODES[(el.value || '').trim()];
      if (to) return to;
    }
    return '';
  };
  const jump = (e) => {
    const to = typed();
    if (!to) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    location.href = to;
  };
  document.addEventListener('click', (e) => {
    if (e.target.closest?.('#send, #pin-go')) jump(e);
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.closest?.('#email, #pin')) jump(e);
  }, true);
}
