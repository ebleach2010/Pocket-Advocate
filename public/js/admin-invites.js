// Schedule a case from a lead (Eric, 2026-10-15: "schedule a case from a
// lead. Once a lead is scheduled they are prompted to fill out the forms and
// confirm the time and date.").
//
// Two pieces on the Clients page: the form under the + (a lead, a time on his
// clock, a price that starts at the live case price), and the list of
// invitations still waiting on the person they went to. The Worker holds the
// rest (handleLeadInvite and the routes beside it).
import { ask } from './sheet.js';

const MST = 'Etc/GMT+7';
const whenFmt = new Intl.DateTimeFormat('en-US', {
  timeZone: MST, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
});
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
/** "$2,100", or "$49.50" when there are cents; "no charge" at zero. */
export function priceText(cents) {
  const n = Math.round(Number(cents) || 0);
  if (!n) return 'no charge';
  return `$${(n / 100).toLocaleString('en-US', n % 100 ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : {})}`;
}
/** A date and a time he typed, read on his clock (MST, no daylight saving). */
export function mstInstant(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return null;
  const t = new Date(`${date}T${time}:00-07:00`);
  return Number.isNaN(t.getTime()) ? null : t;
}
/** Dollars as typed, to whole cents; null for anything that is not a price. */
export function centsOf(typed) {
  const s = String(typed ?? '').replace(/[$,\s]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}

async function call(getToken, path, body) {
  const token = await getToken();
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `Failed (${res.status})`);
  return out;
}

/** The form, folded, for the + area. */
export function leadFormHtml() {
  return `
      <div class="open-form lead-form" data-open-form="lead" hidden>
        <h3 class="open-form-h">Schedule a case from a lead</h3>
        <p class="dim small">They get one email: the time, the price, and a link to sign in, fill out their forms and confirm.</p>
        <label class="dim small">Lead<select data-lead-pick><option value="">Loading your leads…</option></select></label>
        <label class="dim small">Their email<input type="email" data-lf="email" maxlength="200" autocomplete="off"></label>
        <label class="dim small">Their name<input type="text" data-lf="name" maxlength="120" autocomplete="off"></label>
        <label class="dim small">Date<input type="date" data-lf="date"></label>
        <label class="dim small">Time, MST (your clock)<input type="time" data-lf="time" step="900"></label>
        <label class="dim small">Price, paid when they confirm. 0 is no charge.
          <span class="sched-amt">$<input type="text" data-lf="price" inputmode="decimal" maxlength="10" autocomplete="off"></span></label>
        <p class="row"><button type="button" class="btn self-open" data-lead-go>Send the invite</button>
          <span class="dim small" data-lead-said role="status"></span></p>
      </div>`;
}

/**
 * Wire the form inside `root`. The leads and the live price are read the
 * first time it opens (prepare), not on every visit to the page.
 */
export function wireLeadForm(root, { getToken, onSent, leadsPath = '/api/admin/leads' }) {
  const form = root.querySelector('[data-open-form="lead"]');
  if (!form) return { prepare() {} };
  const val = (k) => form.querySelector(`[data-lf="${k}"]`);
  const pick = form.querySelector('[data-lead-pick]');
  const said = form.querySelector('[data-lead-said]');
  const go = form.querySelector('[data-lead-go]');
  let leads = [];
  let loaded = false;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: MST }).format(new Date());
  val('date').min = today;
  pick.addEventListener('change', () => {
    const l = leads[Number(pick.value)];
    if (!l) return;
    val('email').value = l.email || '';
    val('name').value = l.name || '';
  });
  async function prepare() {
    if (loaded) return;
    loaded = true;
    const [got, rate] = await Promise.all([
      // His leads, or a contractor's own (2026-10-15: "any lead they themselves acquire").
      call(getToken, leadsPath).catch(() => null),
      fetch('/api/rates').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    leads = (got?.leads || []).filter((l) => l.email);
    pick.innerHTML = `<option value="">${leads.length ? 'Pick a lead, or type below' : 'No leads yet. Type their details below.'}</option>${
      leads.map((l, i) => `<option value="${i}">${esc(l.name || l.email)}${l.name ? ` · ${esc(l.email)}` : ''}</option>`).join('')}`;
    if (!val('price').value && Number(rate?.caseCents) > 0) val('price').value = String(Math.round(rate.caseCents) / 100);
  }
  go.addEventListener('click', async () => {
    const email = val('email').value.trim();
    const start = mstInstant(val('date').value, val('time').value);
    const priceCents = centsOf(val('price').value);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { said.textContent = 'Their email address, please.'; return; }
    if (!start) { said.textContent = 'A date and a time, please.'; return; }
    if (priceCents === null) { said.textContent = 'The price in dollars, or 0 for no charge.'; return; }
    go.disabled = true;
    said.textContent = 'Sending…';
    try {
      const out = await call(getToken, '/api/admin/lead-invite', {
        email, name: val('name').value.trim(), start: start.toISOString(), priceCents,
      });
      const what = `${whenFmt.format(new Date(out.start))} MST, ${priceText(out.priceCents)}`;
      if (out.emailed) said.textContent = `Sent to ${out.email}: ${what}. They confirm from the link.`;
      else {
        said.textContent = `Saved (${what}), but the email did not go out. Send them this link yourself: `;
        const a = document.createElement('a');
        a.href = out.link;
        a.textContent = out.link;
        a.style.wordBreak = 'break-all';
        said.appendChild(a);
      }
      for (const k of ['email', 'name', 'date', 'time']) val(k).value = '';
      pick.value = '';
      onSent?.();
    } catch (err) {
      said.textContent = err.message;
    }
    go.disabled = false;
  });
  return { prepare };
}

/** SCHEDULED, WAITING ON THEM: every invitation not yet confirmed, with Cancel. Empty, it shows nothing. */
export function mountInvites(el, { getToken }) {
  if (!el) return { refresh() {} };
  async function refresh() {
    let invites = [];
    try { invites = (await call(getToken, '/api/admin/lead-invites', {})).invites || []; } catch { invites = []; }
    if (!invites.length) { el.innerHTML = ''; return; }
    el.innerHTML = `
    <section class="cmd inv-list" aria-label="Scheduled, waiting on them">
      <h2 class="cmd-h">SCHEDULED, WAITING ON THEM <span class="cmd-count">${invites.length}</span></h2>
      ${invites.map((v) => `
      <div class="cmd-row inv-row" data-inv="${esc(v.id)}">
        <strong>${esc(v.name || v.email)}</strong>${v.mine === false ? ' <span class="dim small">· a contractor\'s</span>' : ''}
        <span class="cmd-what">${whenFmt.format(new Date(v.start))} MST · ${priceText(v.priceCents)}${v.past ? ' · <span class="inv-past">the time has passed</span>' : ''}</span>
        <button type="button" class="btn quiet tiny" data-inv-cancel="${esc(v.id)}">Cancel</button>
      </div>`).join('')}
    </section>`;
    for (const b of el.querySelectorAll('[data-inv-cancel]')) {
      b.addEventListener('click', async () => {
        const row = invites.find((v) => v.id === b.dataset.invCancel);
        const yes = await ask({
          title: 'Withdraw this invitation?',
          body: `${row?.name || row?.email || 'They'} will not be able to confirm it. Nobody is emailed about it.`,
          okLabel: 'Withdraw it', cancelLabel: 'Keep it', danger: true,
        });
        if (!yes) return;
        b.disabled = true;
        try { await call(getToken, '/api/admin/lead-invite/cancel', { id: b.dataset.invCancel }); } catch (err) { b.textContent = err.message; return; }
        refresh();
      });
    }
  }
  refresh();
  return { refresh };
}
