// A team member's add-ons on Full-Service, as toggles with a price (Eric,
// 2026-10-17: "When a contractor is onboarded, they'll let me know what
// add-ons they want to have. So when I add a contractor into the app it will
// be a simple toggle with a price input. I can go into their profile and
// change this at any time by pressing on their profile picture").
//
// The same rows sit in Add an advocate and in the profile sheet on their team
// card. The Worker checks every figure again (worker/addons.js cleanAddons).

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** The kinds, in the order the client reads them. Mirrors worker/addons.js ADDON_KINDS. */
export const ADDON_ROWS = [
  { id: 'attend', label: 'Attending an appointment' },
  { id: 'appeal', label: 'Writing an insurance appeal' },
];

const CSS = `
  .addon-set { border: 1px solid var(--edge-base); border-radius: 12px; padding: .7rem .8rem .5rem; margin: .2rem 0 0; display: grid; gap: .5rem; }
  .addon-set legend { padding: 0 .3rem; color: var(--soft); font-size: .86rem; }
  .addon-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .6rem; }
  .addon-row > label:first-child { display: flex; align-items: center; gap: .55rem; color: var(--ink); }
  .addon-row input[type="checkbox"] { width: 1.15rem; height: 1.15rem; accent-color: var(--cyan); }
  .addon-price { display: inline-flex; align-items: center; gap: .25rem; color: var(--dim); }
  .addon-price input { width: 6.2rem; padding: .45rem .55rem; border-radius: 10px; border: 1px solid var(--edge-base); background: var(--sur-base); color: var(--ink); font: inherit; font-variant-numeric: tabular-nums; }
  .addon-price input:disabled { opacity: .45; }`;

function style() {
  if (document.getElementById('pa-addon-css')) return;
  const st = document.createElement('style');
  st.id = 'pa-addon-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** The rows, filled from what is stored. `addons` is { attend: { on, cents }, appeal: { on, cents } }. */
export function addonFields(addons = {}) {
  style();
  const rows = ADDON_ROWS.map(({ id, label }) => {
    const v = addons[id] || {};
    const dollars = Number(v.cents) > 0 ? Math.round(Number(v.cents)) / 100 : '';
    return `
      <div class="addon-row">
        <label><input type="checkbox" data-addon-on="${id}"${v.on ? ' checked' : ''}> ${esc(label)}</label>
        <label class="addon-price">$<input type="number" min="0" step="1" inputmode="decimal" data-addon-price="${id}" value="${esc(dollars)}" aria-label="${esc(label)} price, dollars"${v.on ? '' : ' disabled'}></label>
      </div>`;
  }).join('');
  return `<fieldset class="addon-set" data-addons><legend>Add-ons on Full-Service</legend>${rows}</fieldset>`;
}

/** A price box follows its toggle, so a price is only typed for something offered. */
export function wireAddonFields(root) {
  for (const box of root.querySelectorAll('[data-addon-on]')) {
    box.addEventListener('change', () => {
      const price = root.querySelector(`[data-addon-price="${box.dataset.addonOn}"]`);
      if (!price) return;
      price.disabled = !box.checked;
      if (box.checked && !price.value) price.focus();
    });
  }
}

/** What the rows say now, in cents, or { error } for a price that is not a price. */
export function readAddonFields(root) {
  const out = {};
  for (const { id, label } of ADDON_ROWS) {
    const on = !!root.querySelector(`[data-addon-on="${id}"]`)?.checked;
    const raw = String(root.querySelector(`[data-addon-price="${id}"]`)?.value || '').trim();
    const dollars = raw === '' ? 0 : Number(raw);
    if (on && (!Number.isFinite(dollars) || dollars < 0)) return { error: `${label}: type a price in dollars.` };
    out[id] = { on, cents: Math.round((Number.isFinite(dollars) ? dollars : 0) * 100) };
  }
  return { addons: out };
}
