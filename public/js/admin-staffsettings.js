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
const PRICES = [
  ['caseCents', 'Advocacy Case, $', 'What your invitations start at.'],
  ['addonCents', 'Follow-up session, $', 'For clients who book with you from now on.'],
  ['fullCents', 'Full-Service Case Management, $ a month', 'What your clients are quoted to upgrade.'],
];

export function staffSettingsHtml() {
  return `
    <h4 style="margin:1.2rem 0 .1rem;">In office</h4>
    <p class="dim small" style="margin:0 0 .5rem;">What your clients see on their
      case and chat. Follow office hours shows In office Monday to Thursday,
      8am to 7pm Mountain.</p>
    <div class="row" style="gap:.4rem; flex-wrap:wrap; justify-content:flex-start;" data-sso-picks>
      <button class="btn tiny" data-sso="in" disabled>In office</button>
      <button class="btn tiny" data-sso="out" disabled>Out of office</button>
      <button class="btn tiny" data-sso="" disabled>Follow office hours</button>
    </div>
    <label class="dim small" style="display:block; margin-top:.6rem;">Response time your clients read
      <input type="text" data-sso-line maxlength="160" placeholder="e.g. I reply within a few hours" disabled style="width:100%; min-height:44px; margin-top:.25rem;"></label>
    <button class="btn tiny" data-sso-line-save disabled style="margin-top:.4rem; min-height:44px;">Save the line</button>
    <p class="dim small" data-sso-said style="margin:.45rem 0 0;">Reading your settings…</p>

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
  const line = q('[data-sso-line]');

  const paint = (s) => {
    const manual = s.office?.manual || '';
    qa('[data-sso]').forEach((b) => {
      const on = b.dataset.sso === manual;
      b.classList.toggle('glow', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = false;
    });
    officeSaid.textContent = `Your clients see: ${s.office?.inOffice ? 'In office' : 'Out of office'}${manual ? ', set by you' : ', from the office hours'}.`;
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
  qa('[data-ssc]').forEach((b) => b.addEventListener('click', async () => {
    capSaid.textContent = 'Saving…';
    try { paint(await call(user, { fullCap: Number(b.dataset.ssc) })); } catch (x) { capSaid.textContent = x.message; }
  }));
}
