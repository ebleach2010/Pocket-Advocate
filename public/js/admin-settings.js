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
    </div>

    <h4 style="margin:1.4rem 0 .1rem;">ChatGPT key</h4>
    <p class="dim small" style="margin:0 0 .5rem;">
      Checked with OpenAI before it is kept, so a wrong one is caught here.
      Nothing writes notes with it yet.</p>
    <p class="small" data-oa-state style="margin:0 0 .5rem;">Checking\u2026</p>
    <div class="actions" style="gap:.4rem; flex-wrap:wrap; align-items:center;">
      <input type="password" data-oa-key placeholder="sk-\u2026" autocomplete="off"
        autocapitalize="off" autocorrect="off" spellcheck="false"
        aria-label="OpenAI key" style="flex:1 1 11rem; min-width:0; width:auto;">
      <button class="btn" data-oa-save>Save</button>
      <button class="btn quiet" data-oa-clear hidden>Remove</button>
    </div>
    <p class="small" data-oa-msg hidden style="margin:.5rem 0 0;"></p>
    <p class="dim small" style="margin:.5rem 0 0;">
      Kept in your database, read only by the server, never sent back to this
      screen. A server secret is a safer hiding place but needs a computer to
      set. Say the word and I will move it.</p>`;
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

  wireOpenAiKey(overlay, user);

  overlay.querySelector('[data-open-admin]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const on = !btn.classList.contains('on');
    localStorage.setItem('pa-open-admin', on ? '1' : '0');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

/**
 * The ChatGPT key row.
 *
 * The key goes UP and never comes back down: the server answers with whether
 * one is set and its last four characters, which is enough for him to tell one
 * key from another and useless to anyone reading this screen over his
 * shoulder. So this function never holds a whole key for longer than the
 * request that carries it, and clears the box the moment the save lands.
 */
function wireOpenAiKey(overlay, user) {
  const box = overlay.querySelector('[data-oa-key]');
  if (!box) return;
  const stateEl = overlay.querySelector('[data-oa-state]');
  const msgEl = overlay.querySelector('[data-oa-msg]');
  const saveBtn = overlay.querySelector('[data-oa-save]');
  const clearBtn = overlay.querySelector('[data-oa-clear]');

  const say = (text, bad = false) => {
    msgEl.hidden = !text;
    msgEl.textContent = text;
    msgEl.style.color = bad ? 'var(--orange)' : 'var(--dim)';
  };

  const when = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isFinite(d.getTime())
      ? `, saved ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      : '';
  };

  // Painted from the SERVER's answer, never from what was just typed, so the
  // row can never show a key it does not actually hold.
  const paint = (s) => {
    if (!s) {
      stateEl.textContent = 'Could not check whether a key is saved.';
      clearBtn.hidden = true;
      return;
    }
    if (s.viaSecret) {
      stateEl.textContent = `Key ending ${s.tail} is set on the server itself, which is the safer place. Nothing here can change it.`;
      clearBtn.hidden = true;
      box.hidden = true;
      saveBtn.hidden = true;
      return;
    }
    stateEl.textContent = s.set
      ? `Key ending ${s.tail}${when(s.updatedAt)}.${s.checked ? '' : ' It was never proven to work.'}`
      : 'No key saved yet.';
    clearBtn.hidden = !s.set;
    box.placeholder = s.set ? 'Paste a new one to replace it' : 'sk-\u2026';
  };

  const call = async (body) => {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/openai-key', {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    return out;
  };

  call().then(paint).catch(() => paint(null));

  saveBtn.addEventListener('click', async () => {
    const key = box.value.trim();
    if (!key) { say('Paste a key first.', true); return; }
    saveBtn.disabled = true;
    say('Checking it with OpenAI\u2026');
    try {
      const out = await call({ key });
      box.value = '';
      paint(out);
      say(out.message || 'Saved.');
    } catch (err) {
      say(err.message, true);
    }
    saveBtn.disabled = false;
  });

  clearBtn.addEventListener('click', async () => {
    if (!confirm('Remove the saved ChatGPT key?')) return;
    clearBtn.disabled = true;
    try {
      const out = await call({ clear: true });
      box.value = '';
      paint(out);
      say(out.message || 'Removed.');
    } catch (err) {
      say(err.message, true);
    }
    clearBtn.disabled = false;
  });
}
