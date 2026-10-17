// SMOOTH WHILE SCROLLING (Eric, 2026-10-17: "The app is having some hitching
// when scrolling in areas"). The glows, shines and pulses that make the pages
// feel alive are drawn again on every frame they move, and while the page is
// scrolling that drawing competes with the scroll itself. So they hold still
// while the page is moving and pick up again a moment after it stops. Loaded
// on every page through nav-menu.js.

const root = document.documentElement;
if (!document.getElementById('pa-smooth')) {
  const st = document.createElement('style');
  st.id = 'pa-smooth';
  st.textContent = 'html.pa-scrolling *, html.pa-scrolling *::before, html.pa-scrolling *::after { animation-play-state: paused !important; }';
  document.head.appendChild(st);
  let timer = 0;
  const settle = () => { root.classList.remove('pa-scrolling'); timer = 0; };
  // Capturing, so a scrolling panel inside the page (the shelf, a sheet) counts as well as the page.
  document.addEventListener('scroll', () => {
    if (timer) clearTimeout(timer);
    else root.classList.add('pa-scrolling');
    timer = setTimeout(settle, 180);
  }, { passive: true, capture: true });
}
