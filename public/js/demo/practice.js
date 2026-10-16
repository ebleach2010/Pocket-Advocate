// DEMO MODE: set the practice team's clients before a practice payroll
// (Eric, 2026-10-16: "allow me to adjust each fake contractor's amount of
// clients and type before I run fake payroll. So from the payroll screen in
// the suite would be best I assume").
//
// Only ever loaded inside Demo mode, on the payroll tab. Each team member gets
// a number and a kind; Set their clients replaces their book with that many
// clients of that kind, paid inside the dates on the payroll form, so Run
// payroll shows exactly what he set. Start over brings the first four back.

const KINDS = [
  ['case', 'Advocacy Case'],
  ['full', 'Full-Service'],
  ['followup', 'Follow-up call'],
  ['chat', 'Priority Chat'],
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** Paint the panel into `host`; `dates()` reads the payroll form's start and end; `onSet()` runs after. */
export async function mountPractice(host, { dates, onSet }) {
  if (!host) return;
  const res = await fetch('/api/demo/practice').catch(() => null);
  const out = res && res.ok ? await res.json().catch(() => ({})) : {};
  const people = Array.isArray(out.people) ? out.people : [];
  if (!people.length) return;
  host.hidden = false;
  host.innerHTML = `
    <h3 style="margin:0 0 .3rem;">Practice team</h3>
    <p class="dim small" style="margin:0 0 .8rem;">Set how many clients each one has, and what kind, then Run report. Their clients are replaced and paid inside the dates below.</p>
    <div class="practice-rows" style="display:grid; gap:.9rem;">
      ${people.map((p) => `
        <div class="practice-row" data-practice="${esc(p.uid)}" style="display:grid; gap:.35rem;">
          <span style="font-weight:700;">${esc(p.name)} <span class="dim small" style="font-weight:400;">${esc(String(p.pct))}% share</span></span>
          <span style="display:grid; grid-template-columns: 5.2rem minmax(0, 1fr); gap:.5rem;">
            <input aria-label="Clients for ${esc(p.name)}" type="number" inputmode="numeric" min="0" max="12" step="1" value="${Number(p.clients) || 0}" data-practice-n style="width:100%; min-height:44px; text-align:center;">
            <select aria-label="Kind of client for ${esc(p.name)}" data-practice-kind style="width:100%; min-height:44px;">
              ${KINDS.map(([v, l]) => `<option value="${v}"${p.kind === v ? ' selected' : ''}>${l}</option>`).join('')}
            </select>
          </span>
        </div>`).join('')}
    </div>
    <p class="row" style="margin:.9rem 0 0; display:flex; flex-wrap:wrap; gap:.6rem; align-items:center;">
      <button type="button" class="btn glow" data-practice-set>Set their clients</button>
      <span class="dim small" data-practice-said role="status"></span>
    </p>`;
  const said = host.querySelector('[data-practice-said]');
  host.querySelector('[data-practice-set]').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const { start, end } = dates();
    const rows = [...host.querySelectorAll('[data-practice]')].map((row) => ({
      uid: row.dataset.practice,
      clients: Math.max(0, Math.min(12, Math.round(Number(row.querySelector('[data-practice-n]').value) || 0))),
      kind: row.querySelector('[data-practice-kind]').value,
    }));
    btn.disabled = true;
    said.textContent = 'Setting…';
    try {
      const r = await fetch('/api/demo/practice', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ start, end, people: rows }),
      });
      const o = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(o.error || 'That did not work.');
      said.textContent = `Set. ${o.clients} practice ${o.clients === 1 ? 'client' : 'clients'}, paid between ${start} and ${end}. Run report below.`;
      onSet?.();
    } catch (err) {
      said.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}
