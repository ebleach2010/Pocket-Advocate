// The running tally behind the hamburger. Eric, 2026-08-22: "in the
// hamburger menu there should be a running tally for payments + tips from
// each individual client."
//
// Admin pages import this module; it adds a 💰 Ledger item to the nav strip
// (which is what the hamburger collapses into) and opens an overlay with the
// per-client totals from /api/admin/ledger. The file name starts with
// "admin", so the Worker serves it through the same admin gate as every
// other admin module: a client's browser gets a 404, not a ledger.
import { auth } from './firebase.js';

function esc(s) {
  return String(s).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const dollars = (cents) => `$${(cents / 100).toLocaleString('en-US', {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
})}`;

async function openLedger() {
  if (document.getElementById('pa-ledger')) return;
  const overlay = document.createElement('div');
  overlay.id = 'pa-ledger';
  overlay.className = 'settings-overlay';
  overlay.innerHTML = `
    <div class="settings-card" role="dialog" aria-modal="true" aria-label="Ledger">
      <h3 style="margin:0 0 .2rem;">💰 Running tally</h3>
      <p class="dim small" style="margin:0 0 .6rem;">Case payments and tips per client. Subscriptions bill in Stripe and are not counted here.</p>
      <div data-rows><p class="dim small">Adding it up…</p></div>
      <div class="actions" style="margin-top:.7rem;"><button class="btn" data-x>Close</button></div>
    </div>`;
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('[data-x]').addEventListener('click', close);
  document.body.appendChild(overlay);

  const rowsEl = overlay.querySelector('[data-rows]');
  try {
    const token = await auth.currentUser.getIdToken();
    const res = await fetch('/api/admin/ledger', { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`Failed (${res.status})`);
    const { clients, totals } = await res.json();
    if (!clients.length) {
      rowsEl.innerHTML = '<p class="dim small">No paid cases yet.</p>';
      return;
    }
    rowsEl.innerHTML = `
      <ul style="margin:0; padding:0; list-style:none;">
        ${clients.map((c) => `
          <li style="display:flex; gap:.6rem; align-items:baseline; padding:.35rem 0; border-bottom:1px solid var(--line);">
            <span style="flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;">${esc(c.name)}
              <span class="dim small">· ${c.cases} case${c.cases === 1 ? '' : 's'}</span></span>
            <span style="flex:none; font-variant-numeric:tabular-nums;">${dollars(c.paidCents)}</span>
            <span class="dim small" style="flex:none; font-variant-numeric:tabular-nums;">+ ${dollars(c.tipCents)} tips</span>
          </li>`).join('')}
        <li style="display:flex; gap:.6rem; align-items:baseline; padding:.45rem 0; font-weight:600;">
          <span style="flex:1;">Total</span>
          <span style="flex:none; font-variant-numeric:tabular-nums;">${dollars(totals.paidCents)}</span>
          <span class="small" style="flex:none; font-variant-numeric:tabular-nums;">+ ${dollars(totals.tipCents)} tips</span>
        </li>
      </ul>`;
  } catch (err) {
    rowsEl.innerHTML = `<p class="error">Couldn't load the tally: ${esc(err.message)}</p>`;
  }
}

function mount() {
  const tabs = document.querySelector('.tabs');
  if (!tabs || tabs.querySelector('[data-ledger]')) return;
  const a = document.createElement('a');
  a.href = '#';
  a.dataset.ledger = '1';
  a.textContent = '💰 Ledger';
  a.addEventListener('click', (e) => { e.preventDefault(); openLedger(); });
  tabs.appendChild(a);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
