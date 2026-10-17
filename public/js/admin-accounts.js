// Advocate accounts, from Employer mode (2026-10-16).
//
// Eric, 2026-10-15: "remove redundancy". Advocates and Employer mode listed
// the same people twice: share set on one and shown on the other, photo and
// bio on one, password and turn off on the other. One Team page now: each
// card in Employer mode opens its account here, Add an advocate sits at the
// top of Team, and anyone turned off is listed under the team to turn back
// on. Every action is the Worker's to allow (/api/admin/advocates answers
// anyone but him with a 404); this module only asks.
//
// The rules these carry are the ones the Advocates tab carried (Eric,
// 2026-10-15): "Admin creates advocate accounts from the admin dashboard...
// Admin should be able to reset an advocate password later for technical
// support", "Make the commission percentage configurable per advocate", and
// "Admin should not enable paid Advisor access unless the advocate opted in."

import { ask } from './sheet.js';
import { openAdvocateWizard } from './admin-wizard.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

async function call(user, body) {
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

/** Every account he holds, turned off ones included. */
export async function listAccounts(user) {
  return (await call(user, { action: 'list' })).advocates || [];
}

function sheet(html) {
  const dlg = document.createElement('dialog');
  dlg.className = 'cancel-sheet ask-sheet tm-sheet';
  dlg.innerHTML = html;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', close);
  dlg.querySelector('[data-no]')?.addEventListener('click', close);
  dlg.showModal();
  return { dlg, close };
}

/**
 * Add an advocate, page by page (Eric, 2026-10-17: "it should go page by page
 * through everything I asked I could toggle on or off"): admin-wizard.js.
 */
export function openAddAdvocate(user, { say, done }) {
  return openAdvocateWizard(user, { mode: 'add', say, done });
}

/** One advocate's account: their share, Advisor, a new password, turning them off. */
export function openAccount(user, a, { say, done }) {
  const advisor = a.advisorEnabled ? 'On' : a.advisorOptIn ? 'Asked for, off' : 'Not asked for';
  const { dlg, close } = sheet(`
    <form class="ask-form" data-account="${esc(a.uid)}" onsubmit="return false">
      <h2>${esc(a.name || a.email)}'s account</h2>
      <p class="dim small" style="margin:0;">${esc(a.email || '')}</p>
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
        <button type="button" class="btn danger" data-active="off">Turn off</button>
      </div>
      <p class="dim small" data-said role="status" style="margin:0;"></p>
      <div class="cancel-acts"><button type="button" class="btn quiet" data-no>Close</button></div>
    </form>`);
  const said = dlg.querySelector('[data-said]');
  const act = async (btn, body, line) => {
    btn.disabled = true;
    said.textContent = '';
    try {
      await call(user, { uid: a.uid, ...body });
      said.textContent = line;
      done();
    } catch (x) {
      said.textContent = x.message;
    } finally {
      btn.disabled = false;
    }
  };
  dlg.querySelector('[data-save-pct]').addEventListener('click', (e) => {
    const pct = Number(dlg.querySelector('[data-pct]').value);
    act(e.currentTarget, { action: 'update', commissionPct: pct }, `Saved: their share is ${pct}%.`);
  });
  dlg.querySelector('[data-advisor]')?.addEventListener('click', (e) => {
    const on = e.currentTarget.dataset.advisor === 'on';
    act(e.currentTarget, { action: 'update', advisorEnabled: on }, on ? 'Advisor is on for them.' : 'Advisor is off for them.');
  });
  // The two that ask first close this sheet, so one question is ever on the screen.
  dlg.querySelector('[data-reset]').addEventListener('click', async () => {
    close();
    const pw = await ask({
      title: `A new password for ${a.name || a.email}`,
      body: 'At least 10 characters. Give it to them yourself; they choose their own when they next sign in, and every device they had is signed out.',
      okLabel: 'Set it',
      input: { type: 'text', placeholder: 'New password' },
    });
    if (pw === null) return;
    try {
      await call(user, { uid: a.uid, action: 'reset-password', password: pw });
      say('Set. Tell them the new password; they will choose their own next.');
    } catch (x) { say(x.message); }
  });
  dlg.querySelector('[data-active="off"]').addEventListener('click', async () => {
    close();
    const sure = await ask({
      title: `Turn off ${a.name || a.email}?`,
      body: 'They are signed out everywhere and can no longer open any case, and their card comes off the public site. Their cases stay as they are until you move them.',
      okLabel: 'Turn off',
      danger: true,
    });
    if (!sure) return;
    try {
      await call(user, { uid: a.uid, action: 'deactivate' });
      say(`${a.name || a.email} is off.`);
      done();
    } catch (x) { say(x.message); }
  });
}

/** Anyone turned off, under the team, each with Turn back on. */
export function paintOff(host, user, rows, { say, done }) {
  if (!host) return;
  const off = rows.filter((a) => !a.active && !a.owner && !a.sample);
  host.innerHTML = off.length ? `
    <h3 class="tm-off-h">Turned off</h3>
    ${off.map((a) => `
    <article class="panel adv-card" data-off="${esc(a.uid)}">
      <div class="adv-top"><h3>${esc(a.name || a.email)}</h3><span class="status-pill closed pill-off">OFF</span></div>
      <div class="adv-acts"><button type="button" class="btn glow" data-active="on">Turn back on</button></div>
    </article>`).join('')}` : '';
  for (const card of host.querySelectorAll('[data-off]')) {
    const a = off.find((x) => x.uid === card.dataset.off);
    card.querySelector('[data-active="on"]').addEventListener('click', async (e) => {
      const sure = await ask({
        title: `Turn ${a.name || a.email} back on?`,
        body: 'They can sign in again with their password, and their card returns to the public site once their profile is complete.',
        okLabel: 'Turn on',
      });
      if (!sure) return;
      e.target.disabled = true;
      try {
        await call(user, { uid: a.uid, action: 'activate' });
        say(`${a.name || a.email} is on again.`);
        done();
      } catch (x) { say(x.message); e.target.disabled = false; }
    });
  }
}
