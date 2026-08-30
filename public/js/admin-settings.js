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

/**
 * WHICH CASE THIS PANEL IS SITTING ON TOP OF, if any.
 *
 * The cog is global furniture and a payment is one client's. So the money row
 * renders on a case page and nowhere else, and it carries that client's name
 * so there is never a question about which case a figure is being written
 * onto. Read from the page rather than passed in, because settings.js is
 * served to every client and has no business knowing this module needs it.
 *
 * The name comes from the header admin-case.js paints, which is the same
 * string he is looking at three inches higher up the screen.
 */
function onCase() {
  // BOTH SPELLINGS. The Worker serves the page at /admin-case as well as
  // /admin-case.html and redirects the second to the first, so on his actual
  // phone `location.pathname` is the extensionless one. A test written against
  // the filename alone rendered no money row at all on the live page, which a
  // browser drive caught and no amount of reading would have.
  if (!/\/admin-case(\.html)?\/?$/.test(location.pathname)) return null;
  const id = new URLSearchParams(location.search).get('id') || '';
  if (!/^[\w-]{1,64}$/.test(id)) return null;
  const name = (document.querySelector('[data-client]')?.textContent || '').trim();
  return { id, name };
}

const esc = (s2) => String(s2).replace(/[&<>"]/g, (ch) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/** The rows, as HTML. Only ever inserted after the caller has proven admin. */
export function adminSettingsHtml() {
  const c = onCase();
  return `
    ${c ? `
    <h4 style="margin:1.2rem 0 .1rem;">What ${esc(c.name || 'this client')} actually paid</h4>
    <!-- THE CONTROL THAT WAS NOT THERE. There was one, on the Chat page: a
         0.72rem dim monospace pill with no pointer, no role, no accessible
         name and no verb, whose only explanation was a title attribute an
         iPhone never renders. It wrote the right field and told him nothing
         either way, so a dashboard reading $175 on a case that paid $3,400
         survived him tapping it.

         So: a heading with the client's name in it, a label with a verb, a
         44px target, and a sentence that says what happens to the number
         afterwards. Rendered whether or not anything is recorded yet, because
         "nothing recorded" is the case that most needs the box. -->
    <p class="dim small" style="margin:0 0 .5rem;">Everything they have paid
      you for the case itself, however it reached you. Follow-ups and sessions
      booked in the app are counted separately.</p>
    <p class="dim small" style="margin:0 0 .5rem;">This sets your hourly, the
      PAID line on their case, and the figure on their own page. Your Stripe
      total never changes.</p>
    <div class="row" style="gap:.5rem; align-items:flex-end;">
      <label class="dim small" style="flex:1;">Paid for this case, in dollars
        <input type="text" inputmode="decimal" data-paid-amount
          placeholder="Reading the case…" aria-label="What this client paid for the case, in dollars"
          disabled></label>
      <button class="btn" data-paid-save style="flex:none; min-height:44px;" disabled>Record</button>
    </div>
    <p class="dim small" data-paid-said style="margin:.45rem 0 0;"></p>` : ''}
    <div class="toggle-row" style="margin-top:1rem;">
      <span><strong>Open to my dashboard</strong><br><span class="dim small">This device skips the booking page and lands on Admin. Turn off to test the client view.</span></span>
      <button class="switch ${localStorage.getItem('pa-open-admin') !== '0' ? 'on' : ''}" data-open-admin
        aria-pressed="${localStorage.getItem('pa-open-admin') !== '0'}" aria-label="Open to my dashboard"></button>
    </div>
    <h4 style="margin:1.2rem 0 .1rem;">Full-Service cases at once</h4>
    <!-- THE TAP THE WORKER'S OWN COMMENT PROMISED. FULL_MAX_OPEN_DEFAULT said
         "one tap on his dashboard changes it" and there was no tap: the field
         it read had never been written by anything. Eric, 2026-08-27: "remove
         limitations on how many hand off cases I can have. Or at least put
         that in an admin settings cog." He picked the cog.

         Presets, not a text field. A number he types on a phone is a keyboard,
         a fat finger and a validation message; these are five taps that cannot
         be wrong. No limit is 0, stored deliberately, which is why the Worker
         reads it behind setByHand rather than treating 0 as unset. -->
    <p class="dim small" style="margin:0 0 .5rem;">The most you will carry at
      one time. Past this, approving a request tells you that you are full and
      asks before it goes ahead, so it slows you down rather than stopping
      you.</p>
    <p class="dim small" style="margin:0 0 .5rem;">No copy anywhere promises a
      number, so you can change this whenever you like.</p>
    <div class="row" style="gap:.4rem; flex-wrap:wrap; justify-content:flex-start;" data-cap-picks>
      ${[1, 2, 3, 5].map((n) => `<button class="btn tiny" data-cap="${n}" disabled>${n}</button>`).join('')}
      <button class="btn tiny" data-cap="0" disabled>No limit</button>
    </div>
    <p class="dim small" data-cap-said style="margin:.45rem 0 0;">Reading it back…</p>

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
  wirePaid(overlay, user);
  wireCapacity(overlay, user);
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

/**
 * The money row, wired on the same discipline as the Deep read switch above:
 * render disabled, ask the SERVER what is true, paint that, and only then let
 * him touch it. A control that starts out claiming a state it has not checked
 * is how a save that never happened looks exactly like one that did.
 *
 * The read is the case document itself, which is the record every other
 * screen reads. The write goes through the same admin route the old pill
 * used, and then the case is READ BACK before anything is claimed: a 200 says
 * the request was accepted, and the question he is actually asking is what
 * the case now holds. On a failure the box is put back to the last figure the
 * server confirmed rather than left showing a number nothing agrees with.
 */
async function wirePaid(overlay, user) {
  const input = overlay.querySelector('[data-paid-amount]');
  const btn = overlay.querySelector('[data-paid-save]');
  const said = overlay.querySelector('[data-paid-said]');
  if (!input || !btn) return;
  const caseId = new URLSearchParams(location.search).get('id') || '';

  // Firestore, not a bespoke route: the case document IS the state, the admin
  // can read it by rule, and a second endpoint returning a copy of one field
  // is one more thing that can disagree with the case.
  const { db, doc, getDoc } = await import('./firebase.js');
  const readCase = async () => (await getDoc(doc(db, 'cases', caseId))).data() || {};

  // Grouped in the sentence, plain in the box. A four-figure confirmation
  // reading "$3400" is the same missing comma the case page and the shelf both
  // fixed; the input value must stay parseable, so only the words get it.
  const money = (cents) => (cents / 100).toFixed(2).replace(/\.00$/, '');
  const shown = (cents) => (cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 ? 2 : 0,
    maximumFractionDigits: cents % 100 ? 2 : 0,
  });
  let confirmed = null;             // the last figure the SERVER agreed to
  const paint = (cents) => {
    confirmed = cents;
    input.value = cents > 0 ? money(cents) : '';
    input.placeholder = cents > 0 ? '' : 'Nothing recorded yet';
    input.disabled = false;
    btn.disabled = false;
  };
  const tell = (text, bad) => {
    said.textContent = text;
    said.style.color = bad ? 'var(--danger)' : 'var(--cyan)';
  };

  try {
    paint(Number((await readCase()).paidOverrideCents) || 0);
  } catch {
    // Disabled and honest, rather than an empty box that looks like a fact.
    said.textContent = 'Could not read this case, so this is not safe to edit yet.';
    said.style.color = 'var(--danger)';
    return;
  }

  btn.addEventListener('click', async () => {
    const amount = Number(String(input.value).replace(/[^0-9.]/g, ''));
    if (!(amount > 0)) {
      tell('That did not look like an amount. Nothing changed.', true);
      input.value = confirmed > 0 ? money(confirmed) : '';
      return;
    }
    const cents = Math.round(amount * 100);
    input.disabled = true;
    btn.disabled = true;
    said.textContent = 'Recording…';
    said.style.color = '';
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/case-update', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ caseId, action: 'set-paid', paidCents: cents }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
      const stored = Number((await readCase()).paidOverrideCents) || 0;
      if (stored !== cents) throw new Error('the case still shows the old figure');
      paint(stored);
      // WHAT IT REPLACED, said back to him. The server records the figure it
      // displaced; without a reader that record is a write nobody ever sees,
      // and the one moment it is worth reading is the moment it happens. A
      // first entry replaced nothing, so it says nothing.
      const was = Number(out.correctedFrom) > 0 && Number(out.correctedFrom) !== stored
        ? ` It was $${shown(Number(out.correctedFrom))}.` : '';
      tell(`Recorded. This case now reads $${shown(stored)} paid, on your dashboard, on their page, and in your hourly.${was}`);
      // The case page behind this overlay holds the same number in three
      // places and repaints none of them by itself.
      document.dispatchEvent(new CustomEvent('pa-case-money'));
    } catch (err) {
      // Put the control back where the server left it. Leaving his typing in
      // the box after a failed write is the lie this row exists to stop.
      paint(confirmed);
      tell(`Not recorded: ${err.message}. Nothing on the case changed.`, true);
    }
  });
}

/**
 * How many Full-Service cases at once.
 *
 * Same discipline as the two rows above and as wireClosure in
 * admin-availability.js: the buttons render DISABLED, the Worker is asked what
 * is actually stored, that is what gets painted, and only then can he touch
 * them. On a failed write the buttons go back to the last state the server
 * confirmed instead of showing a choice that did not take.
 */
async function wireCapacity(overlay, user) {
  const row = overlay.querySelector('[data-cap-picks]');
  const said = overlay.querySelector('[data-cap-said]');
  if (!row) return;
  const btns = [...row.querySelectorAll('[data-cap]')];

  const call = async (body) => {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/full-capacity', {
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

  let confirmed = null;              // the last state the SERVER agreed to
  const paint = (state) => {
    confirmed = state;
    for (const b of btns) {
      const on = Number(b.dataset.cap) === state.max;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = false;
    }
    // His current load either way. Taking the cap off must not take away the
    // one line that tells him how much he is carrying.
    said.textContent = state.max === 0
      ? `No limit. You are carrying ${state.open} right now.`
      : `${state.open} of ${state.max} open right now.`;
    said.style.color = '';
  };

  try {
    paint(await call());
  } catch {
    // Left disabled and honest. A row of buttons showing a state nobody has
    // read is the exact failure the Deep read switch above was written to
    // avoid.
    said.textContent = 'Could not read your limit, so this is not safe to change yet.';
    said.style.color = 'var(--danger)';
    return;
  }

  for (const b of btns) {
    b.addEventListener('click', async () => {
      const want = Number(b.dataset.cap);
      for (const x of btns) x.disabled = true;
      said.textContent = 'Saving…';
      try {
        paint(await call({ maxOpen: want }));
      } catch (err) {
        paint(confirmed);            // put the row back where the server left it
        said.textContent = `Not changed: ${err.message}`;
        said.style.color = 'var(--danger)';
      }
    });
  }
}
