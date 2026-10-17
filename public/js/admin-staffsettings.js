// A CONTRACTOR'S OWN SETTINGS, in the cog (Eric, 2026-10-15: "Contractors
// have controls in settings just like me."). His rows run the business's
// settings; these run the same three for a contractor's own clients: their
// door sign and response line, their prices, and how many Full-Service
// clients they take at once. All of it goes through /api/staff/settings,
// which only ever writes the signed-in contractor's own record.
//
// The same discipline as his rows: everything renders disabled, the server
// says what is true, that is painted, and only then can it be touched. A save
// is read back from the answer before it is claimed.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const dollars = (cents) => (Number(cents) > 0 ? (cents / 100).toLocaleString('en-US', cents % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {}) : '');
const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const PRICES = [
  ['caseCents', 'Advocacy Case, $', 'What your invitations start at.'],
  ['addonCents', 'Follow-up session, $', 'For clients who book with you from now on.'],
  ['fullCents', 'Full-Service Case Management, $ a month', 'What your clients are quoted to upgrade.'],
];

export function staffSettingsHtml() {
  return `
    <h4 style="margin:1.2rem 0 .1rem;">In office</h4>
    <p class="dim small" style="margin:0 0 .5rem;" data-sso-follow>What your clients see on their
      case and chat. Follow office hours shows In office during your hours below.</p>
    <div class="row" style="gap:.4rem; flex-wrap:wrap; justify-content:flex-start;" data-sso-picks>
      <button class="btn tiny" data-sso="in" disabled>In office</button>
      <button class="btn tiny" data-sso="out" disabled>Out of office</button>
      <button class="btn tiny" data-sso="" disabled>Follow office hours</button>
    </div>
    <label class="dim small" style="display:block; margin-top:.6rem;">Response time your clients read
      <input type="text" data-sso-line maxlength="160" placeholder="e.g. I reply within a few hours" disabled style="width:100%; min-height:44px; margin-top:.25rem;"></label>
    <button class="btn tiny" data-sso-line-save disabled style="margin-top:.4rem; min-height:44px;">Save the line</button>
    <p class="dim small" data-sso-said style="margin:.45rem 0 0;">Reading your settings…</p>

    <h4 style="margin:1.2rem 0 .1rem;">Your available hours</h4>
    <p class="dim small" style="margin:0 0 .5rem;">The times your clients can book
      you, on your own clock, and your In office light follows them (2026-10-17).
      With none set, nobody can book you from your link, and the light follows
      Monday to Thursday, 8am to 7pm Mountain.</p>
    <div data-ssh style="display:grid; gap:.45rem;">
      ${DAYS.map(([d, name]) => `
      <div style="display:grid; grid-template-columns:7.5rem minmax(0,1fr); align-items:center; gap:.5rem;">
        <label style="display:flex; align-items:center; gap:.5rem;"><input type="checkbox" data-ssh-day="${d}" disabled> ${name}</label>
        <span style="display:flex; align-items:center; gap:.35rem; flex-wrap:wrap;" class="dim small"><input type="time" data-ssh-from="${d}" value="09:00" disabled aria-label="${name} start" style="min-height:44px;"> to <input type="time" data-ssh-to="${d}" value="17:00" disabled aria-label="${name} end" style="min-height:44px;"></span>
      </div>`).join('')}
    </div>
    <button class="btn tiny" data-ssh-save disabled style="margin-top:.4rem; min-height:44px;">Save hours</button>
    <p class="dim small" data-ssh-said style="margin:.45rem 0 0;"></p>
    <p class="dim small" data-ssh-buffer style="margin:.45rem 0 0;"></p>
    <p class="small" data-ssh-link hidden style="margin:.45rem 0 0; overflow-wrap:anywhere;">Your booking link: <a data-ssh-href target="_blank" rel="noopener"></a>
      <button class="btn tiny" type="button" data-ssh-copy style="min-height:44px;">Copy</button></p>

    <h4 style="margin:1.2rem 0 .1rem;">Your prices</h4>
    <p class="dim small" style="margin:0 0 .5rem;">For your own clients, live the
      moment you save. Anyone already booked keeps the price they paid. Leave
      one empty to use the standard price shown under it.</p>
    <div class="price-rows" data-ssp>
      ${PRICES.map(([k, label, note]) => `
      <label class="dim small">${esc(label)}
        <input type="text" inputmode="decimal" data-ssp-price="${k}" disabled>
        <span class="dim small" data-ssp-std="${k}" style="display:block;">${esc(note)}</span></label>`).join('')}
    </div>
    <button class="btn glow" data-ssp-save disabled style="min-height:44px; margin-top:.5rem;">Save prices</button>
    <p class="dim small" data-ssp-said style="margin:.45rem 0 0;"></p>

    <h4 style="margin:1.2rem 0 .1rem;">Full-Service clients at once</h4>
    <p class="dim small" style="margin:0 0 .5rem;">The most you will carry at one
      time. Past this, approving a request tells you that you are full and asks
      before it goes ahead.</p>
    <div class="row" style="gap:.4rem; flex-wrap:wrap; justify-content:flex-start;" data-ssc-picks>
      ${[1, 2, 3, 5].map((n) => `<button class="btn tiny" data-ssc="${n}" disabled>${n}</button>`).join('')}
      <button class="btn tiny" data-ssc="0" disabled>No limit</button>
    </div>
    <p class="dim small" data-ssc-said style="margin:.45rem 0 0;"></p>`;
}

async function call(user, body) {
  const token = await user.getIdToken();
  const res = await fetch('/api/staff/settings', {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `That did not save (${res.status}).`);
  return out;
}

export function wireStaffSettings(overlay, user) {
  const q = (sel) => overlay.querySelector(sel);
  const qa = (sel) => [...overlay.querySelectorAll(sel)];
  const officeSaid = q('[data-sso-said]');
  const priceSaid = q('[data-ssp-said]');
  const capSaid = q('[data-ssc-said]');
  const hoursSaid = q('[data-ssh-said]');
  const line = q('[data-sso-line]');

  const paint = (s) => {
    const manual = s.office?.manual || '';
    qa('[data-sso]').forEach((b) => {
      const on = b.dataset.sso === manual;
      b.classList.toggle('glow', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = false;
    });
    officeSaid.textContent = `Your clients see: ${s.office?.inOffice ? 'In office' : 'Out of office'}${manual ? ', set by you' : s.hours ? ', from your hours' : ', from the office hours'}.`;
    for (const [d] of DAYS) {
      const v = s.hours?.[d] || null;
      const box = q(`[data-ssh-day="${d}"]`);
      box.checked = !!v;
      box.disabled = false;
      for (const [k, t] of [['from', v?.from], ['to', v?.to]]) {
        const input = q(`[data-ssh-${k}="${d}"]`);
        if (t) input.value = t;
        input.disabled = !v;
      }
    }
    q('[data-ssh-save]').disabled = false;
    // Their calendar (2026-10-17): the link their clients book from, and the buffer Eric keeps around each paid appointment.
    const buf = s.bufferHours ?? 3;
    q('[data-ssh-buffer]').textContent = `Nothing paid can be booked within ${buf} hour${buf === 1 ? '' : 's'} before or after another paid appointment of yours. Eric sets this.`;
    if (s.bookingPath) {
      const url = `${location.origin}${s.bookingPath}`;
      const a = q('[data-ssh-href]');
      a.href = s.bookingPath;
      a.textContent = url;
      q('[data-ssh-link]').hidden = false;
    }
    line.value = s.office?.responseTime || '';
    line.disabled = false;
    q('[data-sso-line-save]').disabled = false;
    for (const [k] of PRICES) {
      const input = q(`[data-ssp-price="${k}"]`);
      input.value = dollars(s.rates?.[k]);
      input.placeholder = dollars(s.standard?.[k]) ? `Standard: ${dollars(s.standard[k])}` : '';
      input.disabled = false;
    }
    q('[data-ssp-save]').disabled = false;
    const cap = s.fullCap ?? 0;
    qa('[data-ssc]').forEach((b) => {
      const on = Number(b.dataset.ssc) === cap;
      b.classList.toggle('glow', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = false;
    });
    capSaid.textContent = cap ? `At most ${cap} at once.` : 'No limit.';
  };

  call(user).then(paint).catch((x) => { officeSaid.textContent = x.message; });

  qa('[data-sso]').forEach((b) => b.addEventListener('click', async () => {
    officeSaid.textContent = 'Saving…';
    try { paint(await call(user, { office: { manual: b.dataset.sso || null } })); } catch (x) { officeSaid.textContent = x.message; }
  }));
  q('[data-sso-line-save]').addEventListener('click', async () => {
    officeSaid.textContent = 'Saving…';
    try { paint(await call(user, { office: { responseTime: line.value.trim() || null } })); officeSaid.textContent += ' Line saved.'; } catch (x) { officeSaid.textContent = x.message; }
  });
  q('[data-ssp-save]').addEventListener('click', async () => {
    const rates = {};
    for (const [k] of PRICES) {
      const raw = q(`[data-ssp-price="${k}"]`).value.replace(/[$,\s]/g, '');
      if (!raw) { rates[k] = null; continue; }
      const cents = Math.round(Number(raw) * 100);
      if (!Number.isFinite(cents) || cents < 50) { priceSaid.textContent = 'A price, in dollars, please.'; return; }
      rates[k] = cents;
    }
    priceSaid.textContent = 'Saving…';
    try { paint(await call(user, { rates })); priceSaid.textContent = 'Saved. Your clients see these now.'; } catch (x) { priceSaid.textContent = x.message; }
  });
  qa('[data-ssh-day]').forEach((box) => box.addEventListener('change', () => {
    for (const k of ['from', 'to']) q(`[data-ssh-${k}="${box.dataset.sshDay}"]`).disabled = !box.checked;
  }));
  q('[data-ssh-copy]').addEventListener('click', async () => {
    const b = q('[data-ssh-copy]');
    try { await navigator.clipboard.writeText(q('[data-ssh-href]').textContent); b.textContent = 'Copied'; } catch { b.textContent = 'Hold the link to copy it'; }
  });
  q('[data-ssh-save]').addEventListener('click', async () => {
    const hours = {};
    for (const [d, name] of DAYS) {
      if (!q(`[data-ssh-day="${d}"]`).checked) { hours[d] = null; continue; }
      const from = q(`[data-ssh-from="${d}"]`).value;
      const to = q(`[data-ssh-to="${d}"]`).value;
      if (!from || !to || to <= from) { hoursSaid.textContent = `${name}: the end comes after the start.`; return; }
      hours[d] = { from, to };
    }
    hoursSaid.textContent = 'Saving…';
    try {
      paint(await call(user, { hours: Object.values(hours).some(Boolean) ? hours : null }));
      hoursSaid.textContent = 'Saved. Your light follows these now.';
    } catch (x) { hoursSaid.textContent = x.message; }
  });
  qa('[data-ssc]').forEach((b) => b.addEventListener('click', async () => {
    capSaid.textContent = 'Saving…';
    try { paint(await call(user, { fullCap: Number(b.dataset.ssc) })); } catch (x) { capSaid.textContent = x.message; }
  }));
}
