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
    <h4 style="margin:1.2rem 0 .1rem;">Prices</h4>
    <!-- Eric, 2026-10-15: "In the settings tab for admin let me adjust price
         for each effective immediately." The setter used to sit folded at the
         foot of the Clients page as "Today's rate"; it lives here now, the one
         place. Same discipline as the rows below: disabled until the server
         has said what the prices are, and a save is read back before it is
         claimed. -->
    <p class="dim small" style="margin:0 0 .5rem;">Live the moment you save, on
      every page and at checkout. Anyone already booked or subscribed keeps the
      price they paid.</p>
    <div class="price-rows" data-prices>
      <label class="dim small">24/7 Priority Chat, $ a month
        <input type="text" inputmode="decimal" data-price="subCents" disabled></label>
      <label class="dim small">Advocacy Case, $
        <input type="text" inputmode="decimal" data-price="caseCents" disabled></label>
      <label class="dim small">Full-Service Case Management, $ a month
        <input type="text" inputmode="decimal" data-price="fullCents" disabled></label>
      <label class="dim small">Follow-up session, $
        <input type="text" inputmode="decimal" data-price="addonCents" disabled></label>
      <label class="dim small">Warn me when a case earns under, $ an hour
        <input type="text" inputmode="decimal" data-price="floorCents" disabled></label>
    </div>
    <p class="dim small" style="margin:.5rem 0 .5rem;">Still on from August:
      chat rises $5 with each new client until $100, and the follow-up 10% a
      booking until $425. A price you set above that stays put.</p>
    <button class="btn glow" data-prices-save disabled style="min-height:44px;">Save prices</button>
    <p class="dim small" data-prices-said style="margin:.45rem 0 0;">Reading your prices…</p>
    <div class="toggle-row" style="margin-top:1rem;">
      <span><strong>Open to my dashboard</strong><br><span class="dim small">This device skips the home page and lands on Admin. Turn off to test the client view.</span></span>
      <button class="switch ${localStorage.getItem('pa-open-admin') !== '0' ? 'on' : ''}" data-open-admin
        aria-pressed="${localStorage.getItem('pa-open-admin') !== '0'}" aria-label="Open to my dashboard"></button>
    </div>
    <div class="toggle-row" style="margin-top:1rem;">
      <!-- Eric, 2026-10-15: "try adding the same warm style from the preview
           suite to the landing page. Something I can easily undo." This is
           the undo: off, and the public pages are black again within a
           minute, with nothing to deploy. -->
      <span><strong>Warm public pages</strong><br><span class="dim small" data-look-said>The home and the package pages in the warm look your clients see. Turn off for the black look.</span></span>
      <button class="switch" data-look-warm aria-pressed="false" aria-label="Warm public pages" disabled></button>
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
    ${c && c.name ? `
    <h4 style="margin:1.4rem 0 .1rem;">Delete ${esc(c.name)}'s case</h4>
    <!-- A REAL CLIENT'S DELETE LIVES HERE (Eric, 2026-10-16: "'Delete' for
         sample fake clients should be on the folders. For real clients it
         should be in settings"). On their case only, under their name, and
         locked until the name is typed: the Worker refuses a real case
         without it, whatever a page sends. -->
    <p class="dim small" style="margin:0 0 .5rem;">For good: the chat, the files,
      the reading, the log and the milestones. Their account stays, and nothing
      is refunded. Type their name to unlock it.</p>
    <label class="dim small">Type ${esc(c.name)}
      <input type="text" data-del-confirm autocomplete="off" autocapitalize="words" spellcheck="false"></label>
    <button class="btn danger" data-del-case disabled style="min-height:44px; margin-top:.5rem;">Delete this case</button>
    <p class="dim small" data-del-said role="status" style="margin:.45rem 0 0;"></p>` : ''}
`;
}

/**
 * Wire the rows. The Deep read switch used to live here and was retired on
 * 2026-09-09, when every case went to the top effort: a switch that still
 * said "Off" while the app ran at max would have been the app lying about
 * itself. Its discipline is kept by the rows below, and named in the money
 * row's own comment: render disabled, ask the server what is true, paint
 * that, and only then let him touch it.
 */
export function wireAdminSettings(overlay, user) {
  wirePrices(overlay, user);
  wirePaid(overlay, user);
  wireCapacity(overlay, user);
  wireLook(overlay, user);
  wireDeleteCase(overlay, user);
  overlay.querySelector('[data-open-admin]')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    const on = !btn.classList.contains('on');
    localStorage.setItem('pa-open-admin', on ? '1' : '0');
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
  });
}

/** The warm public pages switch: asked first, painted from the answer, then live. */
function wireLook(overlay, user) {
  const btn = overlay.querySelector('[data-look-warm]');
  const said = overlay.querySelector('[data-look-said]');
  if (!btn) return;
  const paint = (on) => {
    btn.classList.toggle('on', on);
    btn.setAttribute('aria-pressed', String(on));
    btn.disabled = false;
  };
  const call = async (body) => {
    const res = await fetch('/api/admin/look', {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${await user.getIdToken()}`, ...(body ? { 'content-type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `That did not save (${res.status}).`);
    return out;
  };
  call().then((o) => paint(o.landingWarm === true)).catch(() => { said.textContent = 'Could not read it. Try again in a moment.'; });
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const o = await call({ landingWarm: !btn.classList.contains('on') });
      paint(o.landingWarm === true);
      said.textContent = o.landingWarm ? 'Warm. The public pages show it within a minute.' : 'Black again. The public pages show it within a minute.';
    } catch (x) { said.textContent = x.message; btn.disabled = false; }
  });
}

/**
 * The money row, wired on the discipline the Deep read switch used to carry:
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

/** Dollars as he types them ("2,100", "$2100.00") to whole cents, or NaN. */
/** Delete this client's case: unlocked by their name, typed; then home to the shelf. */
function wireDeleteCase(overlay, user) {
  const c = onCase();
  const box = overlay.querySelector('[data-del-confirm]');
  const go = overlay.querySelector('[data-del-case]');
  const said = overlay.querySelector('[data-del-said]');
  if (!c || !box || !go) return;
  const norm = (v) => String(v || '').trim().replace(/\s+/g, ' ').toLowerCase();
  box.addEventListener('input', () => { go.disabled = norm(box.value) !== norm(c.name); });
  go.addEventListener('click', async () => {
    if (norm(box.value) !== norm(c.name)) return;
    go.disabled = true;
    said.textContent = 'Deleting…';
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/admin/delete-case', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ caseId: c.id, confirmName: box.value, real: true }),
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || `That did not go through (${res.status}).`);
      said.textContent = 'Deleted.';
      location.href = '/admin.html';
    } catch (err) {
      said.textContent = err.message;
      go.disabled = false;
    }
  });
}

export function toCents(text) {
  const t = String(text ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return NaN;
  return Math.round(Number(t) * 100);
}

/**
 * Prices, from the settings cog. Read from POST /api/admin/rates with an empty
 * body (the same route the Clients page used), painted, and only then
 * editable. A save sends every box, and what the server answers is what is
 * painted back: a 200 is not the claim, the stored numbers are.
 */
async function wirePrices(overlay, user) {
  const box = overlay.querySelector('[data-prices]');
  const btn = overlay.querySelector('[data-prices-save]');
  const said = overlay.querySelector('[data-prices-said]');
  if (!box || !btn) return;
  const inputs = [...box.querySelectorAll('[data-price]')];
  const plain = (cents) => (cents / 100).toFixed(2).replace(/\.00$/, '');
  const shown = (cents) => `$${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: cents % 100 ? 2 : 0 })}`;
  const call = async (body) => {
    const token = await user.getIdToken();
    const res = await fetch('/api/admin/rates', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
    return out;
  };
  let confirmed = null;              // the last prices the SERVER agreed to
  const paint = (r) => {
    confirmed = r;
    for (const el of inputs) { el.value = plain(Number(r[el.dataset.price]) || 0); el.disabled = false; }
    btn.disabled = false;
  };
  const tell = (text, bad) => { said.textContent = text; said.style.color = bad ? 'var(--danger)' : ''; };

  try {
    paint(await call());
    tell('');
  } catch {
    tell('Could not read your prices, so they are not safe to change yet.', true);
    return;
  }

  btn.addEventListener('click', async () => {
    const want = {};
    for (const el of inputs) {
      const cents = toCents(el.value);
      if (!(cents > 0)) {
        tell(`That did not look like an amount: "${el.value}". Nothing changed.`, true);
        paint(confirmed);
        return;
      }
      want[el.dataset.price] = cents;
    }
    for (const el of inputs) el.disabled = true;
    btn.disabled = true;
    tell('Saving…');
    try {
      const r = await call(want);
      paint(r);
      tell(r.changed
        ? `Saved and live: chat ${shown(r.subCents)} a month, a case ${shown(r.caseCents)}, Full-Service ${shown(r.fullCents)} a month, a follow-up ${shown(r.addonCents)}.`
        : 'Already those prices. Nothing changed.');
    } catch (err) {
      paint(confirmed);
      // The Worker names the field in cents; he is told which price, in dollars.
      const NAMES = { subCents: 'The chat price', caseCents: 'The case price', fullCents: 'The Full-Service price', addonCents: 'The follow-up price', floorCents: 'The warning line' };
      const m = /^(\w+) has to be a whole number of cents between (\d+) and (\d+)\.$/.exec(err.message);
      tell(m ? `Not saved: ${NAMES[m[1]] || 'That price'} has to be between ${shown(Number(m[2]))} and ${shown(Number(m[3]))}. Nothing changed.`
        : `Not saved: ${err.message}. Nothing changed.`, true);
    }
  });
}
