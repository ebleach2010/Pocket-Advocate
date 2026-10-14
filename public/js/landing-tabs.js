// The landing's other screens (Eric, 2026-10-14: "Reorient everything so
// everything on the main page fits without scrolling. Then add a hamburger
// menu symbol at the top right where tabs for every other section appears").
//
// The menu's links are plain anchors and landing.css shows the section they
// name as a screen over the home (:target), so all of it works with this
// file absent. This only adds a Back link to each screen and makes it a real
// step back when the screen was opened from the home, so the phone's own
// back gesture and the link agree.

const SCREENS = 'main > .land-sec.ruled, footer.site-foot#more';
let fromHome = !location.hash;

function wire() {
  for (const el of document.querySelectorAll(SCREENS)) {
    if (el.querySelector(':scope > .panel-back')) continue;
    el.insertAdjacentHTML('afterbegin', '<a class="panel-back" href="#">&#8249; Back</a>');
  }
  document.addEventListener('click', (e) => {
    const back = e.target.closest?.('.panel-back');
    if (!back) return;
    if (fromHome) { e.preventDefault(); history.back(); }
  });
  window.addEventListener('hashchange', (e) => {
    const was = new URL(e.oldURL).hash;
    if (!was || was === '#') fromHome = true;
    else if (!location.hash || location.hash === '#') fromHome = false;
    // A screen that was display:none measured nothing; let anything that
    // sizes itself (the reviews strip) look again.
    window.dispatchEvent(new Event('resize'));
    const target = location.hash.length > 1 ? document.getElementById(decodeURIComponent(location.hash.slice(1))) : null;
    const open = target && target.matches(SCREENS) ? target : null;
    if (open) { open.scrollTop = 0; open.querySelector('h2')?.setAttribute('tabindex', '-1'); open.querySelector('h2')?.focus({ preventScroll: true }); }
  });
}

wire();
