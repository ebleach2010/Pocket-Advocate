// The reviews strip: one motion engine for autoscroll, drag, and momentum.
//
// The CSS keyframe animation is only a pre-JS fallback — this module kills it
// on init and drives the track itself, because the keyframe's -50% jump is
// not the true repeat distance once flex gaps are involved (that mismatch is
// what caused the visible blank seam on iOS). Here the wrap period is
// MEASURED from the second copy's first card, so the loop is pixel-exact.
//
// Behavior (per Eric):
//   - autoscrolls gently until the first touch, then autoscroll is off for
//     good (reduced-motion users never get autoscroll at all)
//   - drag follows the finger 1:1; vertical page scroll unaffected
//   - fast flick + release → glides, bleeding ~3% speed per frame
//   - slow drag + release → barely drifts

const AUTO_SPEED = 0.03; // px/ms ≈ 30px/s, matches the old 40s loop
const FRICTION = 0.97;   // per 16.7ms frame
const MAX_DT = 50;       // clamp across tab-switch gaps

export function enhanceReviewsStrip(strip) {
  const track = strip?.querySelector('.reviews-track');
  if (!track || track.children.length < 2) return;

  let x = 0;
  let v = 0;
  let auto = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let dragging = false;
  let rafId = null;
  let prevT = null;
  let moved = 0;
  let lastPX = 0;
  let samples = [];
  let per = 0;

  // Exact repeat distance: where the duplicate copy starts.
  function period() {
    if (per > 0) return per;
    const kids = track.children;
    const n = Math.floor(kids.length / 2);
    per = n >= 1 && kids[n] ? kids[n].offsetLeft - kids[0].offsetLeft : 0;
    return per;
  }
  addEventListener('resize', () => { per = 0; });

  const wrap = (val) => {
    const p = period();
    if (p <= 0) return val;
    val %= p;
    if (val > 0) val -= p;
    return val;
  };
  const apply = () => { track.style.transform = `translate3d(${x}px,0,0)`; };

  // Take over from the CSS fallback animation at the position it reached.
  const matrix = new DOMMatrixReadOnly(getComputedStyle(track).transform);
  x = wrap(matrix.m41 || 0);
  track.style.animation = 'none';
  apply();

  function tick(t) {
    const dt = prevT == null ? 0 : Math.min(t - prevT, MAX_DT);
    prevT = t;
    if (!dragging && dt > 0) {
      if (auto) {
        x = wrap(x - AUTO_SPEED * dt);
        apply();
      } else if (v !== 0) {
        x = wrap(x + v * dt);
        apply();
        v *= Math.pow(FRICTION, dt / 16.7);
        if (Math.abs(v) < 0.02) v = 0;
      }
    }
    if ((auto && !dragging) || v !== 0) {
      rafId = requestAnimationFrame(tick);
    } else {
      rafId = null;
      prevT = null;
    }
  }
  function ensureLoop() {
    if (rafId == null) {
      prevT = null;
      rafId = requestAnimationFrame(tick);
    }
  }
  ensureLoop();

  strip.addEventListener('pointerdown', (e) => {
    auto = false; // first touch retires autoscroll permanently
    v = 0;
    dragging = true;
    moved = 0;
    lastPX = e.clientX;
    samples = [{ t: performance.now(), x: e.clientX }];
    strip.setPointerCapture(e.pointerId);
  });

  strip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastPX;
    lastPX = e.clientX;
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
    if (Math.abs(v) < 0.05) v = 0;
    if (v !== 0) ensureLoop();
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
