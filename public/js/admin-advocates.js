// His Advocates tab (Eric, 2026-10-15): "Admin creates advocate accounts from
// the admin dashboard... Admin should be able to reset an advocate password
// later for technical support." And: "Make the commission percentage
// configurable per advocate." And: "Admin should not enable paid Advisor
// access unless the advocate opted in." Every action is the Worker's to allow
// (/api/admin/advocates answers anyone but him with a 404); this page asks.

import './admin-ledger.js';
import { requireAdmin, hydrateNav, STAFF } from './auth.js';
import { ask } from './sheet.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

hydrateNav();
const user = await requireAdmin();
// Advocates are his to manage. An advocate who finds this page is sent to
// their own shelf; the route would refuse them either way.
if (user && STAFF.role !== 'admin') location.replace('/admin.html');
else if (user) { wireAdd(); load(); }

async function call(body) {
  const token = await user.getIdToken();
  const res = await fetch('/api/admin/advocates', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `That did not work (${res.status}).`);
  return out;
}

function wireAdd() {
  const form = document.getElementById('adv-add');
  const said = document.getElementById('adv-said');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const fd = new FormData(form);
    btn.disabled = true;
    said.textContent = 'Creating…';
    try {
      const out = await call({ action: 'create', name: fd.get('name'), email: fd.get('email'), password: fd.get('password') });
      form.reset();
      said.textContent = out.emailed
        ? 'Done. They have an email saying the account is ready. Give them the password yourself.'
        : 'Done. The email did not send, so tell them yourself: sign in at the site with their email and the password you gave them.';
      load();
    } catch (err) {
      said.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  });
}

function statusOf(a) {
  if (a.sample) return { label: 'SAMPLE', cls: 'paused' };
  if (!a.active) return { label: 'OFF', cls: 'closed pill-off' };
  if (a.owner) return { label: 'YOU', cls: '' };
  if (a.onboardedAt) return { label: 'READY', cls: '' };
  return { label: 'SETTING UP', cls: 'paused' };
}

function cardHtml(a) {
  const st = statusOf(a);
  const specialties = [a.primarySpecialty, ...a.specialties.filter((s) => s !== a.primarySpecialty)].filter(Boolean);
  const advisor = a.advisorEnabled ? 'On' : a.advisorOptIn ? 'Asked for, off' : 'Not asked for';
  return `
    <article class="panel adv-card" data-uid="${esc(a.uid)}">
      <div class="adv-top">
        <h3>${esc(a.name || a.email)}</h3>
        <span class="status-pill ${st.cls}">${st.label}</span>
      </div>
      <div class="adv-meta">
        <span>${esc(a.email)}</span>
        ${specialties.length ? `<span>${esc(specialties.join(' · '))}</span>` : '<span>No specialty yet</span>'}
        ${a.missing.length && !a.owner ? `<span>Still to add: ${esc(a.missing.join(', '))}</span>` : ''}
      </div>
      ${a.owner ? '<p class="dim small" style="margin:0;">Your own profile is under My profile. It is what clients will see on your card.</p>'
    : a.sample ? '<p class="dim small" style="margin:0;">A sample contractor with invented clients, so you can see the team with someone on it. Remove her in <a href="/admin-employer.html">employer mode</a>.</p>' : `
      <div class="adv-row">
        <label class="adv-row">Their share <input type="number" min="0" max="100" step="1" value="${Number(a.commissionPct)}" data-pct aria-label="Their share, percent"> %</label>
        <button type="button" class="btn quiet" data-save-pct>Save share</button>
      </div>
      <div class="adv-row">
        <span class="dim small">Advisor: ${advisor}</span>
        ${a.advisorOptIn ? `<button type="button" class="btn quiet" data-advisor="${a.advisorEnabled ? 'off' : 'on'}">${a.advisorEnabled ? 'Switch it off' : 'Switch it on'}</button>` : ''}
      </div>
      <div class="adv-acts">
        <button type="button" class="btn quiet" data-reset>Reset password</button>
        <button type="button" class="btn ${a.active ? 'danger' : 'glow'}" data-active="${a.active ? 'off' : 'on'}">${a.active ? 'Turn off' : 'Turn back on'}</button>
      </div>`}
      <p class="dim small" data-said role="status" style="margin:0;"></p>
    </article>`;
}

async function load() {
  const list = document.getElementById('adv-list');
  let data;
  try {
    data = await call({ action: 'list' });
  } catch (err) {
    list.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const rows = data.advocates || [];
  list.innerHTML = rows.length ? rows.map(cardHtml).join('') : '<p class="dim">No advocates yet.</p>';
  for (const card of list.querySelectorAll('[data-uid]')) wireCard(card, rows.find((r) => r.uid === card.dataset.uid));
}

function wireCard(card, a) {
  if (!a) return;
  const said = card.querySelector('[data-said]');
  const act = async (btn, body, done) => {
    btn.disabled = true;
    said.textContent = '';
    try {
      const out = await call({ uid: a.uid, ...body });
      said.textContent = done(out);
      setTimeout(load, 900);
    } catch (err) {
      said.textContent = err.message;
    } finally {
      btn.disabled = false;
    }
  };
  card.querySelector('[data-save-pct]')?.addEventListener('click', (e) => {
    const pct = Number(card.querySelector('[data-pct]').value);
    act(e.currentTarget, { action: 'update', commissionPct: pct }, () => `Saved: their share is ${pct}%.`);
  });
  card.querySelector('[data-advisor]')?.addEventListener('click', (e) => {
    const on = e.currentTarget.dataset.advisor === 'on';
    act(e.currentTarget, { action: 'update', advisorEnabled: on }, () => (on ? 'Advisor is on for them.' : 'Advisor is off for them.'));
  });
  card.querySelector('[data-reset]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const pw = await ask({
      title: `A new password for ${a.name || a.email}`,
      body: 'At least 10 characters. Give it to them yourself; they choose their own when they next sign in, and every device they had is signed out.',
      okLabel: 'Set it',
      input: { type: 'text', placeholder: 'New password' },
    });
    if (pw === null) return;
    act(btn, { action: 'reset-password', password: pw }, () => 'Set. Tell them the new password; they will choose their own next.');
  });
  card.querySelector('[data-active]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const off = btn.dataset.active === 'off';
    const sure = await ask({
      title: off ? `Turn off ${a.name || a.email}?` : `Turn ${a.name || a.email} back on?`,
      body: off
        ? 'They are signed out everywhere and can no longer open any case, and their card comes off the public site. Their cases stay as they are until you move them.'
        : 'They can sign in again with their password, and their card returns to the public site once their profile is complete.',
      okLabel: off ? 'Turn off' : 'Turn on',
      danger: off,
    });
    if (!sure) return;
    act(btn, { action: off ? 'deactivate' : 'activate' }, () => (off ? 'Off.' : 'On again.'));
  });
}
