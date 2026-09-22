// The trade desk's effects (Eric, 2026-09-22: "Do not sacrifice usability for
// effects. Animations should reinforce important events rather than constantly
// distract the user.").
//
// Two jobs. The quiet one is the neon being alive: a field of slow motes behind
// everything and a few particles rising off whatever is lit. The loud one is a
// position closing, which is the only moment in the app worth an animation:
//
//   a profit  a soft green flash, a short camera shake, gold coins that leave
//             the card and fly into MADE TODAY, the figure counting up with
//             each one that lands, the balance following a beat later, and the
//             cards lifting on deeper shadows while the floor drops away.
//   a loss    a red flash, a sharper shake, two red light bars sweeping the top
//             and bottom edges like a siren, a red vignette, and the figure
//             counting down. The same shape, a worse feeling.
//
// Everything above the line is pure: the plan, the geometry, the timing, the
// seeded randomness. A check can run all of it with no browser. Everything
// below it lives inside createFx(), which is the only part that touches the
// DOM, so importing this module in node is safe.
//
// The name is load-bearing: admin-deskfx.js matches the Worker's asset gate,
// so this file is a 404 to anyone but him.

// ---- pure: the geometry and the timing ---------------------------------------
/** The same seed gives the same flight every time, which is what makes a close reproducible in a check. */
export function seededRandom(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuad = (t) => 1 - (1 - t) * (1 - t);
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * A number counting from one figure to another: the value at each frame,
 * monotonic, and the last frame exactly on the figure. Pure, so a check can
 * hold the whole count to the cent without a browser.
 */
export function countFrames(from, to, ms, fps = 60) {
  const n = Math.max(1, Math.round((ms / 1000) * fps));
  const out = [];
  for (let i = 1; i <= n; i++) out.push(i === n ? Math.round(to) : Math.round(from + (to - from) * easeOutCubic(i / n)));
  return out;
}

/**
 * Where the day stands for the chart's line: nothing, at the aim, or a whole
 * point past it. One percentage point of the account above the aim is his
 * "exceed my daily target by at least 1 percentage point".
 */
export function targetState({ realizedTodayCents = 0, aimCents = 0, accountCents = 0 } = {}) {
  const real = Math.round(Number(realizedTodayCents) || 0);
  const aim = Math.round(Number(aimCents) || 0);
  const point = Math.round((Number(accountCents) || 0) * 0.01);
  if (aim > 0 && real >= aim + point) return 'gold';
  if (aim > 0 && real >= aim) return 'aim';
  return 'none';
}

/**
 * What a close is allowed to do. Three answers and no fourth: celebrations off
 * means the numbers simply change, reduced motion means they change with a
 * colour and nothing moves, and otherwise the whole thing runs.
 */
export function fxPlan(kind, { celebrate = true, reduced = false } = {}) {
  if (!celebrate) return { off: true, numberOnly: true, flashMs: 0, flashPeak: 0, shake: false, coins: false, siren: false, depth: false, countMs: 0 };
  if (reduced) return { off: false, numberOnly: true, flashMs: 120, flashPeak: 0.14, shake: false, coins: false, siren: false, depth: 'shadow', countMs: 0, crossfadeMs: 250 };
  return {
    off: false, numberOnly: false,
    flashMs: kind === 'profit' ? 240 : 160,
    flashPeak: kind === 'profit' ? 0.26 : 0.24,
    shake: true, coins: kind === 'profit', siren: kind === 'loss', depth: true, countMs: 400,
  };
}

/** How many coins a close is worth: eight at the least, eighteen at the most, and the aim is what fills the hand. */
export function coinCount(pnlCents, aimCents) {
  const aim = Math.max(1, Math.round(Number(aimCents) || 0));
  return Math.max(8, Math.min(18, 8 + Math.round((8 * (Number(pnlCents) || 0)) / aim)));
}

/**
 * One coin's flight: where it starts, where it lands, how high it arcs and how
 * long it takes. Seeded, so the same close plays the same way twice.
 */
export function particleBurst({ from, to, n, seed = 1 }) {
  const rnd = seededRandom(seed);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push({
      x0: from.x + (rnd() - 0.5) * 48, y0: from.y + (rnd() - 0.5) * 16,
      x1: to.x, y1: to.y,
      delay: i * 36, life: 580 + rnd() * 120,
      drift: (rnd() - 0.5) * 180, lift: 110 + rnd() * 130,
      r: 5.5 + rnd() * 1.5, phase: rnd() * 6.283,
    });
  }
  return out;
}

/** A coin's place on its arc at a moment, and how solid it is. Pure. */
export function arcPoint(c, t) {
  const e = easeInOutCubic(Math.max(0, Math.min(1, t)));
  const mx = (c.x0 + c.x1) / 2 + c.drift;
  const my = Math.min(c.y0, c.y1) - c.lift;
  return {
    x: (1 - e) * (1 - e) * c.x0 + 2 * (1 - e) * e * mx + e * e * c.x1,
    y: (1 - e) * (1 - e) * c.y0 + 2 * (1 - e) * e * my + e * e * c.y1,
    alpha: t > 0.92 ? (1 - t) / 0.08 : 1,
  };
}

/** The shake, as two offsets in pixels: a fast wobble that dies out. A profit rocks, a loss snaps. */
export function shakeAt(kind, t) {
  const a = kind === 'profit' ? { x: 3, tau: 85, fx: 24, y: 1.8, fy: 19, ph: 1.1, ms: 320 } : { x: 4, tau: 60, fx: 30, y: 2.4, fy: 23, ph: 0.8, ms: 260 };
  if (t >= a.ms) return { x: 0, y: 0, done: true };
  return {
    x: a.x * Math.exp(-t / a.tau) * Math.sin((6.283 * a.fx * t) / 1000),
    y: a.y * Math.exp(-t / a.tau) * Math.sin((6.283 * a.fy * t) / 1000 + a.ph),
    done: false,
  };
}

/** Where the siren's hot spot is, which strip it is on, and how bright, at a moment in the sweep. */
export function sirenSweeps(t, { width = 390, passMs = 300, passes = 3 } = {}) {
  const total = passMs * passes;
  if (t < 0 || t > total + 80) return null;
  const pass = Math.min(passes - 1, Math.floor(t / passMs));
  const pt = (t - pass * passMs) / passMs;
  return {
    pass,
    hot: pass === 1 ? width * (1 - pt) : width * pt,
    top: pass === 0 || pass === 2,
    bottom: pass === 1 || pass === 2,
    fade: t > total ? Math.max(0, 1 - (t - total) / 80) : 1,
  };
}

// ---- the browser half --------------------------------------------------------
const RGB = { blue: '77,163,255', green: '57,255,158', gold: '255,209,102', red: '255,77,109' };
const hashOf = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

/** Seeded flicker timings, so two lit things beside each other never blink together, and a reload blinks the same way. */
export function seedFlicker(root) {
  if (typeof document === 'undefined' || !root) return;
  const r = seededRandom(hashOf(root.id || 'desk'));
  for (const el of root.querySelectorAll('.fl')) {
    const d = 5 + r() * 6;
    el.style.setProperty('--fl-dur', `${d.toFixed(2)}s`);
    el.style.setProperty('--fl-delay', `${(-r() * d).toFixed(2)}s`);
    el.classList.remove('fl-b', 'fl-c');
    const v = Math.floor(r() * 3);
    if (v === 1) el.classList.add('fl-b');
    else if (v === 2) el.classList.add('fl-c');
  }
}

/**
 * The canvas, the loop and the three named effects. Everything it touches is
 * passed in, so nothing here reaches for a global: `opts.state()` hands back
 * the two switches, `opts.money` formats a figure, `opts.onDay` repaints the
 * day bar at the right moment in the timeline.
 */
export function createFx({ money, state, onDay, emitters = [] } = {}) {
  const $ = (s) => document.querySelector(s);
  const canvas = $('#fx'); const ctx = canvas.getContext('2d');
  const amb = $('#ambient'); const actx = amb.getContext('2d');
  const strip = document.createElement('canvas'); const sctx = strip.getContext('2d');
  let W = 0; let H = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    for (const [c, x] of [[canvas, ctx], [amb, actx]]) {
      c.width = W * dpr; c.height = H * dpr; c.style.width = `${W}px`; c.style.height = `${H}px`;
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    strip.width = W; strip.height = 72;
  }
  addEventListener('resize', resize); resize();
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const opts = () => state?.() || {};
  const reduced = () => media.matches || opts().reduceFx === true;
  const fxOn = () => opts().celebrate !== false && !reduced();
  const plan = (kind) => fxPlan(kind, { celebrate: opts().celebrate !== false, reduced: reduced() });

  // ---- one loop for every particle on the page ----
  const coins = []; const rings = []; const sparks = []; const motes = []; const emit = [];
  let siren = null; let raf = 0; let frameN = 0;
  const alive = () => coins.length || rings.length || sparks.length || siren || motes.length || emit.length;
  function kick() { if (!raf && !document.hidden) raf = requestAnimationFrame(tick); }
  function tick(now) {
    raf = 0; frameN += 1;
    // Nothing but the quiet layers alive: half the frames is plenty and costs half the battery.
    const light = !coins.length && !rings.length && !sparks.length && !siren;
    if (light && frameN % 2) { if (alive() || moteEmitters.length) raf = requestAnimationFrame(tick); return; }
    ctx.clearRect(0, 0, W, H);
    drawSiren(now); drawCoins(now); drawRings(now); drawSparks(now); drawMotes(now); drawEmit(now);
    if (alive() || moteEmitters.length) raf = requestAnimationFrame(tick);
    else ctx.clearRect(0, 0, W, H);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (raf) cancelAnimationFrame(raf); raf = 0; } else { kick(); ambientKick(); }
  });

  // ---- coins ----
  function coinDisc(x, y, r, phi, alpha) {
    // The shadow first, so a coin has something to fly over.
    ctx.save(); ctx.globalAlpha = alpha * 0.45; ctx.fillStyle = '#000'; ctx.filter = 'blur(3px)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + 7, r * 0.95, r * 0.55, 0, 0, 6.283); ctx.fill(); ctx.restore();
    const sx = Math.cos(phi);
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
    if (Math.abs(sx) < 0.25) {
      // Edge on: a thin bar, which is what makes it read as spinning.
      ctx.fillStyle = '#B8862B'; ctx.shadowColor = 'rgba(255,209,102,.75)'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.roundRect(-1, -r, 2, 2 * r, 1); ctx.fill(); ctx.restore(); return;
    }
    ctx.scale(Math.max(Math.abs(sx), 0.12), 1);
    const g = ctx.createRadialGradient(-0.3 * r, -0.3 * r, 0, 0, 0, r);
    g.addColorStop(0, '#FFF1BF'); g.addColorStop(0.55, '#F5C654'); g.addColorStop(1, '#C9891C');
    ctx.shadowColor = 'rgba(255,209,102,.75)'; ctx.shadowBlur = 8; ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, r, 0, 6.283); ctx.fill();
    ctx.shadowBlur = 0; ctx.strokeStyle = 'rgba(112,64,8,.75)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.55)';
    ctx.beginPath(); ctx.ellipse(-0.32 * r, -0.34 * r, 0.28 * r, 0.18 * r, -0.6, 0, 6.283); ctx.fill();
    ctx.restore();
  }
  function drawCoins(now) {
    for (let i = coins.length - 1; i >= 0; i--) {
      const c = coins[i]; const t = (now - c.t0) / c.life;
      if (t >= 1) { coins.splice(i, 1); c.land(); continue; }
      if (t < 0) continue;
      const p = arcPoint(c, t);
      coinDisc(p.x, p.y, c.r, c.phase + (6.283 * 3.5 * (now - c.t0)) / 1000, p.alpha);
    }
  }
  function drawRings(now) {
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i]; const t = (now - r.t0) / 220;
      if (t >= 1) { rings.splice(i, 1); continue; }
      if (t < 0) continue;
      ctx.save(); ctx.globalAlpha = 0.85 * (1 - easeOutQuad(t));
      ctx.strokeStyle = '#FFD166'; ctx.lineWidth = 1.5; ctx.shadowColor = '#FFD166'; ctx.shadowBlur = 6;
      ctx.beginPath(); ctx.arc(r.x, r.y, 4 + 18 * easeOutQuad(t), 0, 6.283); ctx.stroke(); ctx.restore();
    }
  }
  function drawSparks(now) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]; const t = (now - s.t0) / s.life;
      if (t >= 1) { sparks.splice(i, 1); continue; }
      if (t < 0) continue;
      ctx.save(); ctx.globalAlpha = 1 - t; ctx.fillStyle = s.color; ctx.shadowColor = s.color; ctx.shadowBlur = 6;
      ctx.beginPath();
      ctx.arc(s.x + Math.cos(s.a) * s.d * easeOutQuad(t), s.y + Math.sin(s.a) * s.d * easeOutQuad(t) - (s.rise || 0) * t, s.r, 0, 6.283);
      ctx.fill(); ctx.restore();
    }
  }
  function burstAt(x, y, n, color, d0, d1, life) {
    const now = performance.now();
    for (let i = 0; i < n; i++) sparks.push({ x, y, a: Math.random() * 6.283, d: d0 + Math.random() * (d1 - d0), r: 1.5 + Math.random(), t0: now, life, color });
    kick();
  }

  // ---- the siren ----
  function drawSiren(now) {
    if (!siren) return;
    const t = now - siren.t0;
    const sw = sirenSweeps(t, { width: W });
    if (!sw) { siren = null; return; }
    const barH = $('#bar')?.offsetHeight || 0;
    const drawStrip = (y, flip) => {
      sctx.clearRect(0, 0, W, 72);
      const v = sctx.createLinearGradient(0, flip ? 72 : 0, 0, flip ? 0 : 72);
      v.addColorStop(0, 'rgba(255,77,109,.85)'); v.addColorStop(1, 'rgba(255,77,109,0)');
      sctx.globalCompositeOperation = 'source-over'; sctx.fillStyle = v; sctx.fillRect(0, 0, W, 72);
      const hg = sctx.createLinearGradient(sw.hot - 120, 0, sw.hot + 100, 0);
      hg.addColorStop(0, 'rgba(0,0,0,0)'); hg.addColorStop(120 / 220, 'rgba(0,0,0,1)'); hg.addColorStop(1, 'rgba(0,0,0,0)');
      sctx.globalCompositeOperation = 'destination-in'; sctx.fillStyle = hg; sctx.fillRect(0, 0, W, 72);
      ctx.save(); ctx.globalAlpha = sw.fade; ctx.drawImage(strip, 0, y); ctx.restore();
    };
    if (sw.top) drawStrip(0, false);
    if (sw.bottom) drawStrip(H - barH - 72, true);
    ctx.save(); ctx.globalAlpha = sw.fade; ctx.fillStyle = '#FFB3C0';
    ctx.shadowColor = 'rgba(255,77,109,.9)'; ctx.shadowBlur = 16;
    if (sw.top) ctx.fillRect(sw.hot - 110, 0, 220, 2);
    if (sw.bottom) ctx.fillRect(sw.hot - 110, H - barH - 2, 220, 2);
    ctx.restore();
  }

  // ---- motes off whatever is lit ----
  const moteEmitters = emitters.map(([sel, hue]) => ({ sel, hue, rnd: seededRandom(hashOf(sel)), rect: null, last: 0, alive: 0 }));
  let moteRects = 0;
  function drawMotes(now) {
    if (!fxOn()) { motes.length = 0; return; }
    // The rects are read four times a second, not sixty: a layout read a frame is what makes a canvas expensive.
    if (now - moteRects > 500) {
      moteRects = now;
      for (const e of moteEmitters) {
        const el = document.querySelector(e.sel);
        const r = el && !el.closest('[hidden]') ? el.getBoundingClientRect() : null;
        e.rect = r && r.width && r.bottom > 0 && r.top < H ? r : null;
      }
    }
    for (const e of moteEmitters) {
      if (!e.rect || e.alive >= 12 || motes.length >= 48 || now - e.last < 180) continue;
      e.last = now; e.alive += 1;
      const r = e.rect; const rn = e.rnd; const side = Math.floor(rn() * 4); const off = 2 + rn() * 8;
      let x; let y; let nx = 0; let ny = 0;
      if (side === 0) { x = r.left + rn() * r.width; y = r.top - off; ny = -1; }
      else if (side === 1) { x = r.right + off; y = r.top + rn() * r.height; nx = 1; }
      else if (side === 2) { x = r.left + rn() * r.width; y = r.bottom + off; ny = 1; }
      else { x = r.left - off; y = r.top + rn() * r.height; nx = -1; }
      motes.push({ e, x, y, nx, ny, out: 12 + rn() * 16, up: 14 + rn() * 18, r: 1.3 + rn() * 1.3, t0: now, life: 1400 + rn() * 1200, ph: rn() * 6, hue: e.hue });
    }
    for (let i = motes.length - 1; i >= 0; i--) {
      const m = motes[i]; const t = (now - m.t0) / m.life;
      if (t >= 1) { m.e.alive -= 1; motes.splice(i, 1); continue; }
      const a = t < 0.3 ? (t / 0.3) * 0.9 : 0.9 * (1 - (t - 0.3) / 0.7);
      const mx = m.x + m.nx * m.out * t + Math.sin(now / 160 + m.ph) * 2;
      const my = m.y + m.ny * m.out * t - m.up * t;
      ctx.save(); ctx.globalAlpha = a;
      ctx.fillStyle = `rgb(${RGB[m.hue]})`; ctx.shadowColor = `rgb(${RGB[m.hue]})`; ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(mx, my, m.r, 0, 6.283); ctx.fill();
      ctx.shadowBlur = 0; ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.beginPath(); ctx.arc(mx, my, m.r * 0.45, 0, 6.283); ctx.fill();
      ctx.restore();
    }
  }

  // ---- the gold rising off the chart's last point ----
  let emitOn = false; let emitLast = 0;
  function drawEmit(now) {
    const dot = $('#last-dot');
    if (!dot) { emit.length = 0; return; }
    const rect = dot.getBoundingClientRect();
    const topH = $('.top')?.offsetHeight || 0; const barTop = H - ($('#bar')?.offsetHeight || 0);
    const onScreen = rect.top > topH && rect.bottom < barTop;
    if (emitOn && fxOn() && onScreen && now - emitLast > 400) {
      emitLast = now;
      for (let i = 0; i < 3; i++) {
        emit.push({ dx: -20 + Math.random() * 40, dy: Math.random() * 6, t0: now + Math.random() * 200, life: 1400 + Math.random() * 800, rise: 30 + Math.random() * 40, r: 1.2 + Math.random() * 1.6, ph: Math.random() * 6 });
      }
    }
    const cx = rect.left + rect.width / 2; const cy = rect.top + rect.height / 2;
    for (let i = emit.length - 1; i >= 0; i--) {
      const p = emit[i]; const t = (now - p.t0) / p.life;
      if (t >= 1) { emit.splice(i, 1); continue; }
      if (t < 0) continue;
      ctx.save(); ctx.globalAlpha = (1 - t) * 0.9; ctx.fillStyle = '#FFD166'; ctx.shadowColor = '#FFD166'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(cx + p.dx + Math.sin(t * 6 + p.ph) * 4, cy + p.dy - t * p.rise, p.r, 0, 6.283); ctx.fill(); ctx.restore();
    }
  }

  // ---- the frame itself: shake, depth, flash ----
  function shake(kind) {
    const root = document.documentElement; const t0 = performance.now();
    document.body.classList.add('shaking');
    const step = (now) => {
      const s = shakeAt(kind, now - t0);
      root.style.setProperty('--sx', `${s.x.toFixed(2)}px`);
      root.style.setProperty('--sy', `${s.y.toFixed(2)}px`);
      if (s.done) { document.body.classList.remove('shaking'); return; }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function depth(kind, holdMs) {
    document.body.style.setProperty('--fx-rim', kind === 'profit' ? 'rgba(57,255,158,.2)' : 'rgba(255,77,109,.22)');
    document.body.classList.add('fx-depth');
    setTimeout(() => document.body.classList.remove('fx-depth'), holdMs);
  }
  function flash(kind, x, y, ms, peak) {
    const f = $('#flash'); const c = kind === 'profit' ? RGB.green : RGB.red;
    f.style.background = `radial-gradient(120% 90% at ${x}px ${y}px, rgba(${c},${peak}) 0%, rgba(${c},${peak * 0.4}) 45%, rgba(${c},.03) 100%)`;
    f.style.setProperty('--fl-ms', `${ms}ms`);
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    f.addEventListener('animationend', () => f.classList.remove('go'), { once: true });
  }

  // ---- numbers ----
  function tween(el, from, to, ms, fmt) {
    if (!el) return Promise.resolve();
    if (el.__count) cancelAnimationFrame(el.__count);
    if (!ms) { el.textContent = fmt(to); return Promise.resolve(); }
    const t0 = performance.now();
    return new Promise((res) => {
      const step = (now) => {
        const t = Math.min(1, (now - t0) / ms);
        el.textContent = fmt(Math.round(from + (to - from) * easeOutCubic(t)));
        if (t < 1) el.__count = requestAnimationFrame(step);
        else { el.__count = 0; res(); }
      };
      el.__count = requestAnimationFrame(step);
    });
  }
  const fmtReal = (v) => money(v, v > 0);
  const short = (v) => money(v, true).replace(/\.\d\d$/, '');
  /** Where the coins are going: the day's figure when it is on screen, the tab's badge when it is not. */
  function target() {
    const el = $('#day-real'); const r = el.getBoundingClientRect();
    const topH = $('.top').offsetHeight; const barTop = H - $('#bar').offsetHeight;
    if (r.top > topH && r.bottom < barTop && !$('#pg-positions').hidden) return { el, x: r.right - 12, y: r.top + r.height / 2, bar: false };
    const bd = $('#bar-badge');
    const b = (bd.hidden ? $('#bar [data-page="positions"]') : bd).getBoundingClientRect();
    return { el, x: b.left + b.width / 2, y: bd.hidden ? b.top + 14 : b.top + b.height / 2, bar: true };
  }
  function popBadge() { const b = $('#bar-badge'); b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); }

  /**
   * A profit. Returns how long the card must stay put: the last coin has to
   * leave before the card it came from collapses, or the tail of the flight
   * pours out of whatever slid up into the gap.
   */
  function profit({ from, before, after, pnl, aimCents }) {
    const made = $('#day-real'); const big = $('#big');
    const p = plan('profit');
    window.__paFxLast = { kind: 'profit', plan: p };
    if (p.off) { onDay?.(); return 0; }
    const tg = target();
    flash('profit', tg.x, tg.y, p.flashMs, p.flashPeak);
    if (p.numberOnly) {
      onDay?.({ words: false });
      made.textContent = fmtReal(after.real); big.textContent = money(after.bal);
      made.classList.add('pulse-good'); big.classList.add('pulse-good');
      setTimeout(() => { made.classList.remove('pulse-good'); big.classList.remove('pulse-good'); onDay?.({ numbers: false }); }, 600);
      return 0;
    }
    if (p.shake) shake('profit');
    if (p.depth) depth('profit', 700);
    const n = coinCount(pnl, aimCents);
    const flight = particleBurst({ from, to: { x: tg.x, y: tg.y }, n, seed: Date.now() & 0xffff });
    const T0 = performance.now();
    let landed = 0; let first = true;
    for (const c of flight) {
      coins.push({
        ...c, t0: T0 + c.delay,
        land: () => {
          landed += 1;
          rings.push({ x: tg.x, y: tg.y, t0: performance.now() });
          for (let k = 0; k < 3; k++) sparks.push({ x: tg.x, y: tg.y, a: Math.random() * 6.283, d: 40 + Math.random() * 20, r: 1.5, t0: performance.now(), life: 260, color: '#FFE28A' });
          if (!made.classList.contains('bump')) { made.classList.add('bump'); setTimeout(() => made.classList.remove('bump'), 90); }
          if (first) {
            first = false;
            onDay?.({ words: false, badge: !tg.bar });
            made.classList.add('pulse-good'); big.classList.add('pulse-good');
            tween(big, before.bal, after.bal, p.countMs, money);
            if (tg.bar) { const bd = $('#bar-badge'); bd.hidden = false; bd.classList.remove('dn'); }
          }
          const cur = Number(made.dataset.v || before.real);
          const nxt = landed === n ? after.real : before.real + Math.round((pnl * landed) / n);
          made.dataset.v = String(nxt);
          tween(made, cur, nxt, 120, fmtReal);
          if (tg.bar) { tween($('#bar-badge'), cur, nxt, 120, short); $('#bar-badge').classList.toggle('dn', nxt < 0); }
          if (landed === n) {
            popBadge(); onDay?.({ numbers: false });
            setTimeout(() => { made.classList.remove('pulse-good'); big.classList.remove('pulse-good'); delete made.dataset.v; }, 360);
          }
        },
      });
    }
    kick();
    return n * 36 + 120;
  }

  /** A loss. The same shape, a worse feeling, and no coins to wait for. */
  function loss({ from, before, after }) {
    const made = $('#day-real'); const big = $('#big');
    const p = plan('loss');
    window.__paFxLast = { kind: 'loss', plan: p };
    if (p.off) { onDay?.(); return 0; }
    flash('loss', from.x, from.y, p.flashMs, p.flashPeak);
    if (p.numberOnly) {
      onDay?.({ words: false });
      made.textContent = fmtReal(after.real); big.textContent = money(after.bal);
      made.classList.add('pulse-bad'); big.classList.add('pulse-bad');
      setTimeout(() => { made.classList.remove('pulse-bad'); big.classList.remove('pulse-bad'); onDay?.({ numbers: false }); }, 600);
      return 0;
    }
    if (p.shake) shake('loss');
    if (p.depth) depth('loss', 900);
    if (p.siren) { siren = { t0: performance.now() }; kick(); }
    const dm = $('#dimmer');
    dm.classList.remove('go'); void dm.offsetWidth; dm.classList.add('go');
    dm.addEventListener('animationend', () => dm.classList.remove('go'), { once: true });
    setTimeout(() => {
      onDay?.({ words: false });
      made.classList.add('pulse-bad'); big.classList.add('pulse-bad');
      tween(made, before.real, after.real, 440, fmtReal);
      tween(big, before.bal, after.bal, 440, money);
    }, 260);
    setTimeout(() => { popBadge(); onDay?.({ numbers: false }); }, 700);
    setTimeout(() => { made.classList.remove('pulse-bad'); big.classList.remove('pulse-bad'); }, 1100);
    return 260;
  }

  // ---- the chart's line ----
  let lineState = 'none';
  function targetLine(next, { fresh = false } = {}) {
    const svg = $('#chart-svg');
    let stt = opts().celebrate === false ? 'none' : next;
    if (!svg) { lineState = stt; emitOn = false; return; }
    const entering = fresh ? stt !== 'none' : stt !== lineState && stt !== 'none';
    lineState = stt;
    svg.classList.toggle('aim', stt === 'aim');
    svg.classList.toggle('gold', stt === 'gold');
    const a = $('#disp-anim');
    if (a) {
      const n = a.cloneNode();
      n.setAttribute('values', stt === 'gold' ? '1.5;3;1.5' : stt === 'aim' ? '1;2;1' : '0;0;0');
      n.setAttribute('dur', stt === 'gold' ? '1.8s' : '2.4s');
      a.replaceWith(n);
    }
    const col = stt === 'gold' ? '#FFD166' : '#39FF9E';
    $('#last-dot')?.setAttribute('fill', col);
    if ($('#last-dot')) $('#last-dot').style.filter = `drop-shadow(0 0 6px ${col})`;
    $('#last-halo')?.setAttribute('stroke', col);
    $('#chart')?.parentElement?.classList.toggle('gold', stt === 'gold');
    emitOn = stt === 'gold';
    if (emitOn) kick();
    if (entering && fxOn()) {
      const ig = $('#ignite');
      if (ig) {
        const L = ig.getTotalLength();
        ig.style.stroke = stt === 'gold' ? '#FFF3C4' : '#FFFFFF';
        ig.style.strokeDasharray = `${L} ${L}`;
        ig.animate([{ strokeDashoffset: L, opacity: 0.9 }, { strokeDashoffset: 0, opacity: 0.9, offset: 0.7 }, { strokeDashoffset: 0, opacity: 0 }], { duration: 1000, easing: 'ease-out' });
      }
      const dot = $('#last-dot');
      if (dot) {
        const t0 = performance.now();
        const pop = (now) => { const t = Math.min(1, (now - t0) / 400); dot.setAttribute('r', String(t < 0.5 ? 4 + 6 * t : 7 - 4 * (t - 0.5))); if (t < 1) requestAnimationFrame(pop); };
        requestAnimationFrame(pop);
      }
      if (stt === 'gold' && dotRect()) { const r = dotRect(); burstAt(r.x, r.y, 12, '#FFD166', 30, 70, 500); }
    }
  }
  function dotRect() { const d = $('#last-dot'); if (!d) return null; const r = d.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }

  // ---- the field behind everything ----
  const dots = [];
  { const r = seededRandom(42);
    for (let i = 0; i < 100; i++) {
      const roll = r();
      dots.push({ x: r(), y: r(), r: 0.6 + r() * 1.8, hue: roll < 0.7 ? 'blue' : roll < 0.92 ? 'green' : 'gold', base: 0.12 + r() * 0.2, per: 2500 + r() * 3500, ph: r() * 6, v: 0.003 + r() * 0.006 });
    } }
  let araf = 0; let aN = 0;
  function ambientTick(now) {
    araf = 0;
    if (document.hidden || !fxOn()) { actx.clearRect(0, 0, W, H); return; }
    if (aN++ % 2) { araf = requestAnimationFrame(ambientTick); return; }
    actx.clearRect(0, 0, W, H);
    const par = (scrollY * 0.04) / H;
    for (const d of dots) {
      d.y -= d.v / 30;
      if (d.y < -0.02) d.y = 1.02;
      const a = d.base * (0.6 + 0.4 * Math.sin(now / d.per + d.ph));
      const y = (((d.y - par) % 1) + 1) % 1;
      actx.globalAlpha = a; actx.fillStyle = `rgb(${RGB[d.hue]})`;
      actx.shadowBlur = d.r > 1 ? 4 : 0; actx.shadowColor = actx.fillStyle;
      actx.beginPath(); actx.arc(d.x * W + Math.sin(now / 4000 + d.ph) * 6, y * H, d.r, 0, 6.283); actx.fill();
    }
    actx.globalAlpha = 1; actx.shadowBlur = 0;
    araf = requestAnimationFrame(ambientTick);
  }
  const ambientKick = () => { if (!araf) araf = requestAnimationFrame(ambientTick); };

  function applyReduce() {
    document.documentElement.classList.toggle('reduce', reduced());
    ambientKick(); kick();
  }
  media.addEventListener?.('change', applyReduce);

  return { profit, loss, targetLine, applyReduce, plan, kick: ambientKick, start() { applyReduce(); ambientKick(); kick(); } };
}
