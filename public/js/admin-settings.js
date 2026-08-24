// The advocate-only half of the settings panel.
//
// It lives in its own module for one reason: settings.js is served to
// clients, and a block gated behind `isAdmin ?` is still readable by anyone
// who opens devtools on it. The blindness audit caught exactly that (the Deep
// read copy named the advisor in a file every client downloads), and the
// standing rule is that clients are blind to advocate tools, not merely
// prevented from clicking them.
//
// The name matters: the asset gate in worker/index.js matches
// `js/admin[\w-]*.js`, so calling this admin-settings.js puts it behind the
// same byte-identical 404 as every other advocate module, for free. Rename it
// to anything else and it is served to the world again.

/** The rows, as HTML. Only ever inserted after the caller has proven admin. */
export function adminSettingsHtml() {
  return `
    <div class="toggle-row" style="margin-top:1rem;">
      <span><strong>Open to my dashboard</strong><br><span class="dim small">This device skips the booking page and lands on Admin. Turn off to test the client view.</span></span>
      <button class="switch ${localStorage.getItem('pa-open-admin') !== '0' ? 'on' : ''}" data-open-admin
        aria-pressed="${localStorage.getItem('pa-open-admin') !== '0'}" aria-label="Open to my dashboard"></button>
    </div>
    <div class="toggle-row" style="margin-top:1rem;">
      <span><strong>Deep read</strong><br><span class="dim small">Your second opinion thinks harder on every Update. Better on a knotty case, several minutes slower. Off is the normal setting.</span></span>
      <button class="switch" data-effort aria-pressed="false" aria-label="Deep read" disabled></button>
    </div>`;
}

/**
 * Wire the rows. The effort switch is server-stored so it follows him between
 * devices, painted from the server rather than assumed, and stays disabled
 * until the real answer is in so it can never show a state it is not in.
 */
export function wireAdminSettings(overlay, user) {
  const effortBtn = overlay.querySelector('[data-effort]');
  if (effortBtn) {
    const paint = (on) => {
      effortBtn.classList.toggle('on', on);
      effortBtn.setAttribute('aria-pressed', String(on));
      effortBtn.disabled = false;
    };
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/effort', { headers: { authorization: `Bearer ${token}` } });
        if (res.ok) paint((await res.json()).effort === 'max');
      } catch { /* leave it disabled rather than lying about the state */ }
    })();
    effortBtn.addEventListener('click', async () => {
      const want = !effortBtn.classList.contains('on');
      effortBtn.disabled = true;
      try {
        const token = await user.getIdToken();
        const res = await fetch('/api/admin/effort', {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ effort: want ? 'max' : 'high' }),
        });
        const out = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(out.error || 'Failed');
        paint(out.effort === 'max');
      } catch {
        paint(!want); // put the switch back where it was
      }
    });
  }

  overlay.querySelector('[data-open-admin]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const on = !btn.classList.contains('on');
    localStorage.setItem('pa-open-admin', on ? '1' : '0');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}
