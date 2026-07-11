// Touch/drag physics for the reviews strip.
//
// Until first touch, the CSS animation autoscrolls. On pointerdown we read
// the animation's current position, kill it for good (per Eric: once they've
// grabbed it, autoscroll stays off), and drive the track by hand:
//   - drag follows the finger 1:1 (vertical page scroll still works —
//     touch-action: pan-y)
//   - release with a fast flick → glides on, bleeding speed ~3%/frame
//   - release from a slow drag → barely drifts
// The track holds two copies of the cards, so position wraps seamlessly.

export function enhanceReviewsStrip(strip) {
  const track = strip?.querySelector('.reviews-track');
  if (!track) return;

  let x = null; // manual position; null = CSS autoscroll still owns the track
  let v = 0;
  let raf = null;
  let dragging = false;
  let moved = 0;
  let lastPointerX = 0;
  let samples = [];

  const half = () => track.scrollWidth / 2;
  const wrap = (val) => {
    const h = half();
    if (h <= 0) return val;
    while (val <= -h) val += h;
    while (val > 0) val -= h;
    return val;
  };
  const apply = () => { track.style.transform = `translateX(${x}px)`; };

  function takeover() {
    if (x !== null) return;
    const matrix = new DOMMatrixReadOnly(getComputedStyle(track).transform);
    x = wrap(matrix.m41);
    track.style.animation = 'none'; // autoscroll ends here, permanently
    apply();
  }

  strip.addEventListener('pointerdown', (e) => {
    takeover();
    if (raf) cancelAnimationFrame(raf);
    dragging = true;
    moved = 0;
    v = 0;
    lastPointerX = e.clientX;
    samples = [{ t: performance.now(), x: e.clientX }];
    strip.setPointerCapture(e.pointerId);
  });

  strip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastPointerX;
    lastPointerX = e.clientX;
    moved += Math.abs(dx);
    x = wrap(x + dx);
    apply();
    const now = performance.now();
    samples.push({ t: now, x: e.clientX });
    while (samples.length > 2 && now - samples[0].t > 100) samples.shift();
  });

  function release() {
    if (!dragging) return;
    dragging = false;
    // velocity = px/ms over the last ~100ms of movement; stale = no momentum
    const now = performance.now();
    const first = samples[0];
    const last = samples[samples.length - 1];
    v = last && first && last.t > first.t && now - last.t < 80
      ? (last.x - first.x) / (last.t - first.t)
      : 0;
    let prev = performance.now();
    const step = (t) => {
      const dt = Math.min(t - prev, 50);
      prev = t;
      x = wrap(x + v * dt);
      apply();
      v *= Math.pow(0.97, dt / 16.7);
      if (Math.abs(v) > 0.02) raf = requestAnimationFrame(step);
    };
    if (Math.abs(v) > 0.05) raf = requestAnimationFrame(step);
  }
  strip.addEventListener('pointerup', release);
  strip.addEventListener('pointercancel', release);

  // a real drag shouldn't fire the card's link on release
  strip.addEventListener('click', (e) => {
    if (moved > 6) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);
}
