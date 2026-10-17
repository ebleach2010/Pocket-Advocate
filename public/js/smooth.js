// SMOOTH WHILE SCROLLING (Eric, 2026-10-17: "The app is having some hitching
// when scrolling in areas"). The glows, shines and pulses that make the pages
// feel alive are drawn again on every frame they move, and while the page is
// scrolling that drawing competes with the scroll itself. So they hold still
// while the page is moving and pick up again a moment after it stops. Loaded
// on every page through nav-menu.js.
//
// Only the ones that loop (2026-10-17, v7.81). Holding every animation also
// held a tab's slide in: a tap on a tab scrolls the page, the slide froze
// part way, and the page sat shifted to the side until the scroll settled.
// A move that plays once, a tab, a sheet, a card arriving, finishes on time.

const root = document.documentElement;
if (!document.getElementById('pa-smooth')) {
  const st = document.createElement('style');
  st.id = 'pa-smooth';
  // A browser that cannot list its animations holds them all, the way it always did.
  const listed = typeof document.getAnimations === 'function';
  st.textContent = listed ? '' : 'html.pa-scrolling *, html.pa-scrolling *::before, html.pa-scrolling *::after { animation-play-state: paused !important; }';
  document.head.appendChild(st);
  let timer = 0;
  let held = [];
  const loops = (a) => a.playState === 'running' && a.effect?.getTiming?.().iterations === Infinity;
  const hold = () => {
    if (!listed) return;
    try { held = document.getAnimations().filter(loops); held.forEach((a) => a.pause()); } catch { held = []; }
  };
  const release = () => {
    for (const a of held) { try { a.play(); } catch { /* gone with its element */ } }
    held = [];
  };
  const settle = () => { root.classList.remove('pa-scrolling'); release(); timer = 0; };
  // Capturing, so a scrolling panel inside the page (the shelf, a sheet) counts as well as the page.
  document.addEventListener('scroll', () => {
    if (timer) clearTimeout(timer);
    else { root.classList.add('pa-scrolling'); hold(); }
    timer = setTimeout(settle, 180);
  }, { passive: true, capture: true });
}
