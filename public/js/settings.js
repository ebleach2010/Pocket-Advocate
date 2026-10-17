// The settings cog (client + admin): notifications, and how the app looks.
// Injected into the top nav for any signed-in user.
import { enablePush } from './push.js';
import { db, doc, getDoc, setDoc } from './firebase.js';
import { currentAppearance, applyAppearance, applyHue, currentHue, turnFor, WARM_HUE } from './theme.js';
import { barActs } from './nav-menu.js';

export function initSettings(user, isAdmin = false, isContractor = false) {
  if (!user) return;
  // The right-hand end of the bar, never the link strip: inside the strip the
  // cog was the last thing on a row wider than the screen, so the one control
  // the onboarding tells people to tap was the one always off it.
  const nav = barActs();
  if (!nav || nav.querySelector('.cog-btn')) return;
  const cog = document.createElement('button');
  cog.className = 'cog-btn';
  cog.type = 'button';
  cog.title = 'Settings';
  cog.setAttribute('aria-label', 'Settings');
  cog.textContent = '⚙';
  nav.appendChild(cog);
  cog.addEventListener('click', () => openPanel(user, isAdmin, isContractor));
}

function openPanel(user, isAdmin = false, isContractor = false) {
  const existing = document.getElementById('pa-settings');
  if (existing) { existing.remove(); return; }
  const notifOn = 'Notification' in window && Notification.permission === 'granted';
  // iOS only delivers push to a Home-Screen app, so say that rather than
  // letting the toggle look broken in Safari.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone =
    window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const needsInstall = isIOS && !standalone;

  // The color wheel over the warm look, or Black (2026-10-17).
  const scheme = currentAppearance();
  const overlay = document.createElement('div');
  overlay.id = 'pa-settings';
  overlay.className = 'settings-overlay';
  // Done stays at the top while the sheet scrolls (2026-10-17): the sheet runs
  // to thousands of pixels on a phone, and Done was only at its start.
  overlay.innerHTML = `
    <div class="settings-card">
      <div class="row" style="position:sticky; top:0; z-index:2; margin:-1.1rem -1.2rem 0; padding:.8rem 1.2rem .6rem; background:inherit; border-radius:16px 16px 0 0;"><h3 style="margin:0;">Settings</h3><button class="btn quiet" data-close>Done</button></div>
      <div class="toggle-row">
        <span><strong>Notifications</strong><br><span class="dim small">New messages, documents &amp; updates</span></span>
        <button class="switch ${notifOn ? 'on' : ''}" data-notif aria-pressed="${notifOn}" aria-label="Toggle notifications"></button>
      </div>
      <p class="dim small" style="margin:.5rem 0 0;">${needsInstall
        ? 'On iPhone these only arrive once Pocket Advocate is on your Home Screen. Safari tabs can\'t receive them.'
        : 'Sends a real notification so you can confirm they arrive.'}</p>
      <div class="actions" style="margin-top:.6rem;">
        <button class="btn quiet" data-test-notif>Send a test notification</button>
      </div>
      <p class="dim small" id="pa-notif-result" hidden style="margin:.5rem 0 0;"></p>

      <h4 style="margin:1.2rem 0 .1rem;">Appearance</h4>
      <p class="dim small" style="margin:0 0 .5rem;">Applies on this device, right away.</p>
      <div class="hue-pick${scheme === 'contrast' ? ' is-off' : ''}" data-hue-pick>
        <div class="hue-wheel" data-hue-wheel role="slider" tabindex="0" aria-label="Colour"
          aria-valuemin="0" aria-valuemax="359" aria-valuenow="${(WARM_HUE + currentHue()) % 360}">
          <span class="hue-ring" aria-hidden="true"></span>
          <span class="hue-core" aria-hidden="true"></span>
          <span class="hue-knob" data-hue-knob aria-hidden="true"></span>
        </div>
        <div class="hue-side">
          <p style="margin:0;"><strong>Colour</strong><br><span class="dim small">Turn the wheel to colour the whole look. The gradient comes along.</span></p>
        </div>
        <button type="button" class="btn quiet hue-reset" data-hue-reset>Back to the warm look</button>
      </div>
      <button type="button" class="scheme-swatch hue-black${scheme === 'contrast' ? ' on' : ''}" data-black aria-pressed="${scheme === 'contrast'}">
        <span class="scheme-name">Black</span>
        <span class="scheme-blurb dim small">Black background, white text. Easiest on sensitive eyes.</span>
      </button>
      ${isAdmin ? '<div data-admin-rows></div>' : isContractor ? '<div data-staff-rows></div>' : ''}
    </div>`;
  document.body.appendChild(overlay);

  // Escape, the backdrop and Done all close it. It was the only overlay in the
  // app that ignored Escape.
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-close]').addEventListener('click', close);

  // A silent push failure is indistinguishable from "nothing has happened yet",
  // so give both of us a way to prove delivery on demand.
  const testBtn = overlay.querySelector('[data-test-notif]');
  const resultEl = overlay.querySelector('#pa-notif-result');
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    resultEl.hidden = false;
    resultEl.textContent = 'Sending…';
    try {
      const idToken = await user.getIdToken();
      const res = await fetch('/api/push/test', {
        method: 'POST',
        headers: { authorization: `Bearer ${idToken}` },
      });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
      const n = Number(out.devices) || 0;
      resultEl.textContent = `Sent to ${n} device${n === 1 ? '' : 's'}. If nothing arrives in a few seconds, notifications aren't getting through.`;
    } catch (err) {
      resultEl.textContent = err.message;
    }
    testBtn.disabled = false;
  });

  // THE COLOR WHEEL (Eric, 2026-10-17: "Keep the whole color scheme and
  // gradient, but allow it to be adjusted via a color wheel in settings").
  // Applies as the finger moves, so he sees the change rather than imagining
  // it; Black sits beside it and a turn of the wheel takes it off again.
  wireHueWheel(overlay);

  // The advocate's own rows come from a module a client is never served. A
  // dynamic import, so the request only happens for him: this file is public,
  // and even the NAMES of his tools are his business, not everyone's.
  const adminRows = overlay.querySelector('[data-admin-rows]');
  if (adminRows) {
    import('./admin-settings.js').then((m) => {
      adminRows.innerHTML = m.adminSettingsHtml();
      m.wireAdminSettings(overlay, user);
    }).catch(() => { /* his switches are missing; the client half still works */ });
  }
  // A contractor's own versions of his rows (2026-10-15), from the same kind
  // of module and for the same reason.
  const staffRows = overlay.querySelector('[data-staff-rows]');
  if (staffRows) {
    import('./admin-staffsettings.js').then((m) => {
      staffRows.innerHTML = m.staffSettingsHtml();
      m.wireStaffSettings(overlay, user);
    }).catch(() => { /* their rows are missing; the rest still works */ });
  }

  const notifBtn = overlay.querySelector('[data-notif]');
  notifBtn.addEventListener('click', async () => {
    notifBtn.disabled = true;
    if (notifBtn.classList.contains('on')) {
      await disablePush(user);
      notifBtn.classList.remove('on');
      notifBtn.setAttribute('aria-pressed', 'false');
    } else {
      const r = await enablePush(user);
      if (r.ok) { notifBtn.classList.add('on'); notifBtn.setAttribute('aria-pressed', 'true'); }
      else alert(r.error);
    }
    notifBtn.disabled = false;
  });
}

async function disablePush(user) {
  try {
    const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
    const sub = reg && (await reg.pushManager.getSubscription());
    if (!sub) return;
    const ep = sub.endpoint;
    await sub.unsubscribe();
    const snap = await getDoc(doc(db, 'users', user.uid));
    const list = snap.exists() && Array.isArray(snap.data().pushSubs) ? snap.data().pushSubs : [];
    await setDoc(doc(db, 'users', user.uid), { pushSubs: list.filter((s) => s.endpoint !== ep) }, { merge: true });
  } catch (e) {
    console.warn('disable push', e);
  }
}

// The wheel's look, once: a ring of colour round the look's own gradient, and
// a knob where the look's accent sits.
const HUE_CSS = `
  .hue-pick { display: grid; grid-template-columns: 9.5rem minmax(0, 1fr); gap: .9rem; align-items: center; margin: .2rem 0 .7rem; }
  .hue-pick.is-off .hue-wheel { opacity: .45; }
  .hue-wheel { position: relative; width: 9.5rem; aspect-ratio: 1; border-radius: 50%; cursor: pointer; touch-action: none; }
  .hue-ring { position: absolute; inset: 0; border-radius: 50%;
    background: conic-gradient(${Array.from({ length: 13 }, (_, i) => `oklch(.78 .13 ${i * 30})`).join(', ')});
    -webkit-mask: radial-gradient(circle, transparent 60%, #000 61%); mask: radial-gradient(circle, transparent 60%, #000 61%); }
  .hue-core { position: absolute; inset: 27%; border-radius: 50%; background: var(--warm-pop, var(--cyan)); box-shadow: var(--glow-c); }
  .hue-knob { position: absolute; top: 50%; left: 50%; width: 1.5rem; height: 1.5rem; margin: -.75rem 0 0 -.75rem; border-radius: 50%;
    border: 3px solid #FFFFFF; box-shadow: 0 0 0 1px rgba(0, 0, 0, .5), 0 2px 8px rgba(0, 0, 0, .5); pointer-events: none; }
  .hue-wheel:focus-visible { outline: 2px solid var(--cyan); outline-offset: 4px; }
  .hue-side { display: grid; gap: .5rem; justify-items: start; }
  .hue-reset { grid-column: 1 / -1; justify-self: start; }
  .hue-black { width: 100%; text-align: left; }
  @media (max-width: 360px) { .hue-pick { grid-template-columns: 1fr; justify-items: center; } }`;

function wireHueWheel(root) {
  if (!document.getElementById('pa-hue-css')) {
    const st = document.createElement('style');
    st.id = 'pa-hue-css';
    st.textContent = HUE_CSS;
    document.head.appendChild(st);
  }
  const pick = root.querySelector('[data-hue-pick]');
  const wheel = root.querySelector('[data-hue-wheel]');
  const knob = root.querySelector('[data-hue-knob]');
  const black = root.querySelector('[data-black]');
  if (!pick || !wheel || !knob) return;
  const place = (hue) => {
    const a = (hue * Math.PI) / 180;
    const r = wheel.clientWidth * 0.4;
    knob.style.transform = `translate(${Math.sin(a) * r}px, ${-Math.cos(a) * r}px)`;
    knob.style.background = `oklch(.78 .13 ${hue})`;
    wheel.setAttribute('aria-valuenow', String(Math.round(hue)));
  };
  const setBlack = (on) => {
    pick.classList.toggle('is-off', on);
    if (black) { black.classList.toggle('on', on); black.setAttribute('aria-pressed', String(on)); }
  };
  const choose = (hue) => {
    applyHue(turnFor(hue));
    place(hue);
    setBlack(false);
  };
  place((WARM_HUE + currentHue()) % 360);
  let frame = 0;
  const fromPointer = (e) => {
    const r = wheel.getBoundingClientRect();
    const deg = (Math.atan2(e.clientX - (r.left + r.width / 2), -(e.clientY - (r.top + r.height / 2))) * 180) / Math.PI;
    const hue = (deg + 360) % 360;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => choose(hue));
  };
  wheel.addEventListener('pointerdown', (e) => {
    wheel.setPointerCapture?.(e.pointerId);
    fromPointer(e);
    const move = (ev) => fromPointer(ev);
    const up = () => { wheel.removeEventListener('pointermove', move); wheel.removeEventListener('pointerup', up); wheel.removeEventListener('pointercancel', up); };
    wheel.addEventListener('pointermove', move);
    wheel.addEventListener('pointerup', up);
    wheel.addEventListener('pointercancel', up);
  });
  wheel.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 5 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -5 : 0;
    if (!step) return;
    e.preventDefault();
    choose(((Number(wheel.getAttribute('aria-valuenow')) || WARM_HUE) + step + 360) % 360);
  });
  root.querySelector('[data-hue-reset]')?.addEventListener('click', () => choose(WARM_HUE));
  black?.addEventListener('click', () => {
    const on = currentAppearance() !== 'contrast';
    applyAppearance(on ? 'contrast' : 'warm');
    setBlack(on);
  });
}
