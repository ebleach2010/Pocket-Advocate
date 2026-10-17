// Employer mode (Eric, 2026-10-15): "This is where I can see all current
// employees (including myself) with a short brief of how many cases they're
// handling and if what type, and their current proposed income from clients
// they have retained. I should then be able to tap in to each client and see
// everything they see without them knowing I'm there." Everything here is
// asked of /api/admin/team, which answers him alone; an advocate who finds
// this page is sent to their own shelf.

import { requireAdmin, hydrateNav, STAFF } from './auth.js';
import { ask } from './sheet.js';
import { openStaffChat } from './admin-staffchat.js';
import { listAccounts, openAddAdvocate, openAccount, paintOff } from './admin-accounts.js';
import { openAdvocateWizard } from './admin-wizard.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
// Whole dollars bare, anything with cents to two places ($1,234.50, never $1,234.5).
const money = (cents) => {
  const c = Math.round(Number(cents) || 0);
  const places = c % 100 ? 2 : 0;
  return `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places })}`;
};
const ORDER = ['Advocacy Case', 'Full-Service', 'Priority Chat', 'Family', 'Own case', 'Showcase', 'Sample'];

hydrateNav();
const user = await requireAdmin();
if (user && STAFF.role !== 'admin') location.replace('/admin.html');
else if (user) {
  document.querySelector('[data-add-adv]')?.addEventListener('click', () => openAddAdvocate(user, { say: teamSay, done: load }));
  load();
}
/** The Team tab's one status line, for the account actions that close their sheet first. */
function teamSay(text) {
  const el = document.getElementById('adv-said');
  if (el) el.textContent = text;
}

async function call(method, body) {
  const token = await user.getIdToken();
  const res = await fetch('/api/admin/team', {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `That did not work (${res.status}).`);
  return out;
}

/** "4 open cases: 2 Advocacy Case, 1 Full-Service, 1 Priority Chat" */
function brief(p) {
  const kinds = Object.entries(p.kinds).sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0]));
  const total = p.open + p.chatLines;
  if (!total) return 'No clients right now.';
  return `${total} ${total === 1 ? 'client' : 'clients'}: ${kinds.map(([k, n]) => `${n} ${k}`).join(', ')}`;
}

function photo(p) {
  const init = p.name.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  if (p.hasPhoto) return `<img class="tm-photo" src="/api/advocates/headshot?uid=${encodeURIComponent(p.uid)}${p.photoV ? `&v=${encodeURIComponent(p.photoV)}` : ''}" alt="" width="56" height="56" data-init="${esc(init)}">`;
  return `<span class="tm-init" aria-hidden="true">${esc(init)}</span>`;
}

// A photo that will not load becomes their initials (2026-10-17, the look
// audit: a broken-picture icon on his own card). Caught on the way down, as
// an image's error never bubbles.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img?.matches?.('img.tm-photo')) return;
  const s = document.createElement('span');
  s.className = 'tm-init';
  s.setAttribute('aria-hidden', 'true');
  s.textContent = img.dataset.init || '';
  img.replaceWith(s);
}, true);

function card(p) {
  const pill = p.owner ? '<span class="tm-pill">YOU</span>'
    : p.sample ? '<span class="tm-pill sample">SAMPLE</span>'
    : !p.onboarded ? '<span class="tm-pill">SETTING UP</span>' : '';
  const share = p.owner ? 'All of it is yours' : `Their share: ${p.commissionPct}%`;
  // Eric, 2026-10-16: "I should be able to tap on that team member and see
  // their cases." Their name and clients are one tap to their shelf, read
  // only, the way Their cases opens it; his own opens his.
  const shelf = p.owner ? '/admin.html' : `/admin.html?as=${encodeURIComponent(p.uid)}`;
  return `
    <article class="panel tm-card" data-uid="${esc(p.uid)}">
      <div class="tm-head">
        <!-- Their photo opens their profile (Eric, 2026-10-17: "pressing on their profile picture"); the rest of the card, their cases. -->
        <button type="button" class="tm-face" data-face aria-label="${p.owner ? 'Your profile' : `${esc(p.name)}'s profile`}">${photo(p)}<span class="tm-edit" aria-hidden="true">✎</span></button>
        <a class="tm-open" href="${shelf}" aria-label="${p.owner ? 'Your cases' : `${esc(p.name)}'s cases`}">
          <span class="tm-top">
            <span>
              <span class="tm-name">${esc(p.name)}${pill}</span>
              <span class="tm-sub">${esc(share)}${p.closed ? ` · ${p.closed} closed` : ''}</span>
            </span>
            <span class="tm-go" aria-hidden="true">›</span>
          </span>
          <span class="tm-brief">${esc(brief(p))}</span>
          ${!p.owner && p.late ? `<span class="tm-late" data-tm-late style="display:inline-block;margin-top:.35rem;padding:.12rem .55rem;border:1px solid #FF6B6B;border-radius:999px;background:rgba(255,90,90,.18);color:#FFB3B3;font-size:.74rem;font-weight:800;">${p.late} report${p.late === 1 ? '' : 's'} past due</span>` : ''}
        </a>
      </div>
      <div class="tm-money"><strong>${money(p.proposedCents)}</strong><span>${p.owner ? 'from the clients you have now' : 'theirs from the clients they have now'}${p.tipsCents ? `, ${money(p.tipsCents)} of it tips` : ''}</span></div>
      <div class="tm-acts">
        ${p.owner ? '' : `<a class="btn quiet" href="${shelf}">Their cases</a>
        <button type="button" class="btn quiet" data-msg>Message${p.unread ? `<span class="tm-badge" aria-label="${p.unread} new">${p.unread}</span>` : ''}</button>`}
        <button type="button" class="btn quiet" data-profile>${p.owner ? 'Your profile' : 'Profile'}</button>
        ${p.owner || p.sample ? '' : '<button type="button" class="btn quiet" data-account>Account</button>'}
      </div>
    </article>`;
}

async function load() {
  const list = document.getElementById('team');
  let data;
  try { data = await call('GET'); } catch (err) { list.innerHTML = `<p class="error">${esc(err.message)}</p>`; return; }
  const team = data.team || [];
  list.innerHTML = team.length ? team.map(card).join('') : '<p class="dim">Nobody yet.</p>';
  // The accounts behind the cards (share, Advisor, email), and anyone turned off.
  const accounts = await listAccounts(user).catch(() => []);
  paintOff(document.getElementById('team-off'), user, accounts, { say: teamSay, done: load });
  for (const el of list.querySelectorAll('[data-uid]')) {
    const p = team.find((x) => x.uid === el.dataset.uid);
    el.querySelector('[data-account]')?.addEventListener('click', () => {
      const a = accounts.find((x) => x.uid === p.uid);
      if (a) openAccount(user, a, { say: teamSay, done: load });
      else teamSay('That account did not load. Try again in a moment.');
    });
    el.querySelector('[data-msg]')?.addEventListener('click', async () => {
      await openStaffChat(user, { uid: p.uid, name: p.name, onChange: () => {} });
      load();
    });
    el.querySelector('[data-profile]')?.addEventListener('click', () => editProfile(p));
    el.querySelector('[data-face]')?.addEventListener('click', () => editProfile(p));
  }
  // The sample contractor's box went on 2026-10-16: Demo mode has a team of
  // its own, apart from his real one (his word, "Remove both").
}

/**
 * THEIR PHOTO AND BIO, FROM HIM (Eric, 2026-10-15: "I should be able to
 * upload a bio and profile picture for each [contractor] when they submit it
 * to me."). The photo goes up first (the same checks as their own upload,
 * through his door), then the words; the card repaints from the answer.
 */
function editProfile(p) {
  // The same pages that added them, every one a tap away (2026-10-17).
  return openAdvocateWizard(user, { mode: 'edit', uid: p.uid, say: teamSay, done: load });
}

// ---- the tabs --------------------------------------------------------------------
for (const b of document.querySelectorAll('[data-emp-tab]')) {
  b.addEventListener('click', () => showTab(b.dataset.empTab));
}
function showTab(name) {
  for (const b of document.querySelectorAll('[data-emp-tab]')) {
    const on = b.dataset.empTab === name;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  }
  for (const s of document.querySelectorAll('[data-emp-page]')) s.hidden = s.dataset.empPage !== name;
  if (name === 'payroll') { loadDrafts(); mountLivePractice(); }
  if (name === 'history') loadHistory();
  try { history.replaceState(null, '', name === 'team' ? location.pathname : `${location.pathname}#${name}`); } catch { /* fine */ }
}
if (user && STAFF.role === 'admin' && ['#payroll', '#history'].includes(location.hash)) showTab(location.hash.slice(1));

// ---- payroll, the Mangomint way (Eric, 2026-10-15) ---------------------------------
// "I can run the last week, the last two weeks, the last month, and a custom
// time frame. When I hit 'run report' it generates a spreadsheet with a
// breakdown of all income minus deductions and how much they're owed. I can
// tap on any pay amount to adjust it if there's an error. I also need to see
// each employees preferred payout method. I want it to be EXACTLY how
// mangomint runs payroll. I can delete a generated payroll with no
// consequence. Any payroll I press confirm on gets put into another tab with
// each month's generated payroll."

const dayStr = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const longDay = (s) => new Date(`${s}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const shortDay = (s) => new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const signed = (cents) => (cents < 0 ? `<span class="pr-neg">&minus;${money(-cents)}</span>` : money(cents));

/** The presets, on this phone's calendar: whole weeks Monday to Sunday, and the whole month before this one. */
export function presetRange(preset, today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const dow = (d.getDay() + 6) % 7;
  const lastSun = addDays(d, -(dow + 1));
  if (preset === 'week') return { start: dayStr(addDays(lastSun, -6)), end: dayStr(lastSun) };
  if (preset === 'twoweeks') return { start: dayStr(addDays(lastSun, -13)), end: dayStr(lastSun) };
  const first = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const last = new Date(d.getFullYear(), d.getMonth(), 0);
  return { start: dayStr(first), end: dayStr(last) };
}

async function payroll(method, body, id) {
  const token = await user.getIdToken();
  const res = await fetch(`/api/admin/payroll${id ? `?id=${encodeURIComponent(id)}` : ''}`, {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `That did not work (${res.status}).`);
  return out;
}

const form = document.getElementById('pr-form');
const fillDates = () => {
  const preset = form.preset.value;
  if (preset === 'custom') return;
  const r = presetRange(preset);
  form.start.value = r.start;
  form.end.value = r.end;
};
form.addEventListener('change', (e) => {
  if (e.target.name === 'preset') fillDates();
  if (e.target.name === 'start' || e.target.name === 'end') form.querySelector('input[value="custom"]').checked = true;
});
fillDates();
// DEMO MODE (Eric, 2026-10-16: "allow me to adjust each fake contractor's
// amount of clients and type before I run fake payroll. So from the payroll
// screen in the suite would be best I assume"). Inside Demo mode only: the
// practice team's clients, set above the form and paid inside its dates.
mountLivePractice();
// Painted again each time Payroll opens (2026-10-17), so a share changed on
// the Team tab reads the same here.
function mountLivePractice() {
  try { if (sessionStorage.getItem('pa-demo-live') !== '1') return; } catch { return; /* no storage: not in Demo mode */ }
  const f = document.getElementById('pr-form');
  import('./demo/practice.js').then((m) => m.mountPractice(document.getElementById('practice'), {
    dates: () => ({ start: f.start.value, end: f.end.value }),
    onSet: () => load(),
  })).catch(() => { /* the payroll still runs without it */ });
}
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const said = document.getElementById('pr-said');
  const btn = form.querySelector('button[type="submit"]');
  btn.disabled = true;
  said.textContent = 'Running the report…';
  try {
    const { run } = await payroll('POST', { action: 'generate', start: form.start.value, end: form.end.value, preset: form.preset.value, includeAll: form.includeAll.checked });
    said.textContent = '';
    showRun(run);
    loadDrafts();
  } catch (err) { said.textContent = err.message; }
  finally { btn.disabled = false; }
});

async function loadDrafts() {
  const box = document.getElementById('pr-drafts');
  try {
    const { runs } = await payroll('GET');
    const drafts = runs.filter((r) => r.status === 'draft');
    box.innerHTML = drafts.length ? `<div class="pr-list">${drafts.map((r) => `
      <div class="panel pr-item">
        <span><span class="pr-chip draft">DRAFT</span> ${esc(longDay(r.start))} to ${esc(longDay(r.end))}</span>
        <span><strong>${money(r.totals?.totalCents)}</strong>${r.sampleCents ? ` <span class="dim small" data-draft-sample>${money(r.totals?.totalCents + r.sampleCents)} with the sample</span>` : ''}</span>
        <span class="pr-acts"><button type="button" class="btn quiet" data-open="${esc(r.id)}">Open</button></span>
      </div>`).join('')}</div>` : '';
    box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => showRun((await payroll('GET', null, b.dataset.open)).run)));
  } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

/** The month a payroll belongs to: the month its period ends in. */
const monthOf = (r) => new Date(`${r.end}T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

// PAY HISTORY, A FOLDER A MONTH (Eric, 2026-10-15: "When I press 'paid,' the
// spreadsheet gets put in a folder for that month."). The newest month opens
// on its own; each paid payroll inside it opens the whole report again.
async function loadHistory() {
  const box = document.getElementById('pr-history');
  try {
    const { runs } = await payroll('GET');
    const done = runs.filter((r) => r.status !== 'draft');
    if (!done.length) { box.innerHTML = '<p class="dim">Nothing paid yet. A payroll you mark Paid goes in a folder for its month, here.</p>'; return; }
    const byMonth = new Map();
    for (const r of done) {
      const m = monthOf(r);
      if (!byMonth.has(m)) byMonth.set(m, []);
      byMonth.get(m).push(r);
    }
    box.innerHTML = [...byMonth.entries()].map(([m, rs], i) => `
      <details class="pr-folder"${i === 0 ? ' open' : ''}>
        <summary><span class="pr-month">${esc(m)}</span><span class="pr-folder-sum">${rs.length} ${rs.length === 1 ? 'payroll' : 'payrolls'} · ${money(rs.reduce((t, r) => t + (Number(r.totals?.totalCents) || 0), 0))}</span></summary>
        <div class="pr-list">${rs.map((r) => `
          <div class="pr-item">
            <span><span class="pr-chip done">PAID</span>${r.editedAt ? ' <span class="pr-chip">EDITED</span>' : ''} ${esc(longDay(r.start))} to ${esc(longDay(r.end))}</span>
            <span>${r.people} ${r.people === 1 ? 'person' : 'people'} · <strong>${money(r.totals?.totalCents)}</strong></span>
            <span class="pr-acts"><button type="button" class="btn quiet" data-open="${esc(r.id)}">Open</button></span>
          </div>`).join('')}</div>
      </details>`).join('');
    box.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', async () => {
      const { run } = await payroll('GET', null, b.dataset.open);
      showTab('payroll');
      showRun(run);
    }));
  } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
}

/** The report: Mangomint's columns, a row per person, the totals under them. */
// A paid payroll he has said yes to editing, by id, for as long as it is open.
let editingPaid = '';

function showRun(run) {
  const box = document.getElementById('pr-report');
  const paid = run.status !== 'draft';
  if (editingPaid !== run.id) editingPaid = '';
  // Whether the figures can be changed right now: a draft, or a paid one he said yes to.
  const draft = !paid || editingPaid === run.id;
  const rows = run.rows || [];
  const t = run.totals || {};
  // Eric, 2026-10-16: "The sample contractor should have income and tips so I can run payroll and see numbers beyond zero."
  const samples = rows.filter((r) => r.sample);
  // The Total leaves her out, so a run with nobody real in it read all zeros
  // (Eric, 2026-10-16: "when I run the report it's zero's across the board").
  // A second total under it counts her; Paid still leaves her out.
  const withSample = Object.fromEntries(['cases', 'salesCents', 'deductionsCents', 'commissionCents', 'tipsCents', 'adjustmentsCents', 'totalCents']
    .map((k) => [k, (Number(t[k]) || 0) + samples.reduce((sum, r) => sum + (Number(r[k]) || 0), 0)]));
  const totalRow = (label, x, cls) => `<tr class="pr-total${cls}"><td>${label}</td><td data-label="Cases">${x.cases || 0}</td><td data-label="Client sales">${money(x.salesCents)}</td><td data-label="Deductions">${x.deductionsCents ? signed(-x.deductionsCents) : money(0)}</td><td data-label="Commission">${money(x.commissionCents)}</td><td data-label="Tips">${money(x.tipsCents)}</td><td data-label="Pay adjustments">${signed(x.adjustmentsCents || 0)}</td><td data-label="Total" class="pr-tot-cell">${signed(x.totalCents || 0)}</td><td class="pr-pay-cell"></td></tr>`;
  // The hint alone when it already names the method (2026-10-17): "Zelle to ma…om" under "Zelle" said it twice.
  const hintSays = (r) => !!r.payout?.hint && r.payout.hint.toLowerCase().startsWith(String(r.payout.label || '').toLowerCase());
  const payCell = (r) => (r.payout?.label
    ? (hintSays(r) ? esc(r.payout.hint) : `${esc(r.payout.label)}<br><span class="dim small">${esc(r.payout.hint || '')}</span>`)
    : '<span class="dim">Not set yet</span>');
  box.innerHTML = `
    <div class="pr-head">
      <h2>${esc(longDay(run.start))} to ${esc(longDay(run.end))} <span class="pr-chip ${paid ? 'done' : 'draft'}">${paid ? 'PAID' : 'DRAFT'}</span>${run.editedAt ? ' <span class="pr-chip">EDITED</span>' : ''}</h2>
      <div class="pr-acts">
        <button type="button" class="btn quiet" data-dl>Download spreadsheet</button>
        ${!paid ? '<button type="button" class="btn danger" data-del>Delete</button><button type="button" class="btn glow" data-confirm>Paid</button>'
    : editingPaid === run.id ? '<button type="button" class="btn quiet" data-edit-done>Done editing</button>'
      : '<button type="button" class="btn quiet" data-edit-paid>Edit</button>'}
      </div>
    </div>
    <div class="pr-scroll">
      <table class="pr">
        <thead><tr><th>Staff</th><th>Cases</th><th>Client sales</th><th>Deductions</th><th>Commission</th><th>Tips</th><th>Pay adjustments</th><th>Total</th><th>Payout method</th></tr></thead>
        <tbody>
          ${rows.map((r) => `
          <tr data-row="${esc(r.uid)}">
            <td><button type="button" class="pr-who" data-expand="${esc(r.uid)}" aria-expanded="false">${esc(r.name)}${r.sample ? ' <span class="pr-chip draft">SAMPLE</span>' : ''}${r.off ? ' <span class="pr-chip">TURNED OFF</span>' : ''}</button><br><span class="dim small">${r.owner ? 'All yours' : `${r.commissionPct}% share`}</span></td>
            <td data-label="Cases">${r.cases}</td>
            <td data-label="Client sales">${money(r.salesCents)}</td>
            <td data-label="Deductions">${r.deductionsCents ? signed(-r.deductionsCents) : money(0)}</td>
            <td data-label="Commission">${money(r.commissionCents)}</td>
            <td data-label="Tips">${money(r.tipsCents)}</td>
            <td data-label="Pay adjustments"><span>${signed(r.adjustmentsCents)}${draft ? `<button type="button" class="pr-plus" data-plus="${esc(r.uid)}" aria-label="Add a pay adjustment for ${esc(r.name)}">+</button>` : ''}</span></td>
            <td data-label="Total" class="pr-tot-cell">${draft ? `<button type="button" class="pr-amt" data-set="${esc(r.uid)}" aria-label="Adjust ${esc(r.name)}'s pay">${signed(r.totalCents)}</button>` : signed(r.totalCents)}</td>
            <td data-label="Payout method" class="pr-pay-cell" style="text-align:left;"><span>${payCell(r)}</span></td>
          </tr>
          <tr data-detail="${esc(r.uid)}" hidden><td class="pr-detail" colspan="9">${detailHtml(r, draft)}</td></tr>`).join('')}
          ${totalRow('Total', t, '')}
          ${samples.length ? totalRow(`With ${esc(samples[0].name)} <span class="pr-chip draft">SAMPLE</span>`, withSample, ' pr-with" data-with-sample="1') : ''}
        </tbody>
      </table>
    </div>
    ${(run.notes || []).map((n) => `<p class="pr-note">${esc(n)}</p>`).join('')}
    ${samples.length ? `<p class="pr-note" data-sample-note>${esc(samples[0].name)} is a sample: her sales and tips are invented so you can see real numbers. The Total leaves her out, and so does Paid. With her, this run would be ${signed(withSample.totalCents)}, as the last row shows.</p>` : ''}
    <p class="pr-note">Tap a name for every line behind it. ${draft ? 'Tap a total to correct it, or + to add a bonus, a reimbursement or a pay adjustment. A minus takes money off.' : `Paid, in the ${esc(monthOf(run))} folder in Pay history. Edit asks you first.`}</p>`;
  box.scrollIntoView({ behavior: 'smooth', block: 'start' });
  box.querySelectorAll('[data-expand]').forEach((b) => b.addEventListener('click', () => {
    const row = box.querySelector(`[data-detail="${CSS.escape(b.dataset.expand)}"]`);
    row.hidden = !row.hidden;
    b.setAttribute('aria-expanded', String(!row.hidden));
  }));
  box.querySelectorAll('[data-plus]').forEach((b) => b.addEventListener('click', () => adjust(run, b.dataset.plus, 'add')));
  box.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => adjust(run, b.dataset.set, 'set')));
  box.querySelectorAll('[data-unadj]').forEach((b) => b.addEventListener('click', async () => showRun((await payroll('POST', { action: 'unadjust', id: run.id, adjId: b.dataset.unadj, editPaid: paid })).run)));
  box.querySelectorAll('[data-reveal]').forEach((b) => b.addEventListener('click', () => reveal(rows.find((r) => r.uid === b.dataset.reveal))));
  box.querySelector('[data-dl]').addEventListener('click', () => download(run));
  box.querySelector('[data-del]')?.addEventListener('click', async () => {
    const sure = await ask({ title: 'Delete this payroll?', body: 'Nothing is paid or changed by it, so deleting it changes nothing else. You can run it again any time.', okLabel: 'Delete', danger: true });
    if (!sure) return;
    await payroll('POST', { action: 'delete', id: run.id });
    box.innerHTML = '';
    loadDrafts();
  });
  box.querySelector('[data-confirm]')?.addEventListener('click', async () => {
    const sure = await ask({ title: 'Mark this payroll paid?', body: `${longDay(run.start)} to ${longDay(run.end)}, ${money(t.totalCents)} in all. It goes in the ${monthOf(run)} folder in Pay history. You can still edit it there.`, okLabel: 'Paid' });
    if (!sure) return;
    const out = await payroll('POST', { action: 'confirm', id: run.id });
    showRun(out.run);
    loadDrafts();
  });
  // Editing a paid payroll asks first, in his words (2026-10-15).
  box.querySelector('[data-edit-paid]')?.addEventListener('click', async () => {
    const sure = await ask({ title: 'Are you sure you want to edit this paid payroll?', body: 'Any change is kept on it with the date, and it stays in its month.', okLabel: 'Edit', danger: true });
    if (!sure) return;
    editingPaid = run.id;
    showRun(run);
  });
  box.querySelector('[data-edit-done]')?.addEventListener('click', () => { editingPaid = ''; showRun(run); loadHistory(); });
}

function detailHtml(r, draft) {
  const lines = r.lines || [];
  const adj = r.adjustments || [];
  return `
    <table class="pr-lines">
      ${lines.length ? lines.map((l) => `<tr><td>${esc(shortDay(l.at))}</td><td>${esc(l.client || '')}</td><td>${esc(l.label)}</td><td class="n">${l.kind === 'advisor' ? '' : money(l.cents)}</td><td class="n">${signed(l.payCents)}</td></tr>`).join('') : '<tr class="pr-none"><td>No sales, tips or deductions in this period.</td></tr>'}
      ${adj.map((a) => `<tr class="pr-adj"><td>${esc(shortDay(a.at))}</td><td colspan="2">${esc(a.type)}${a.note ? `: ${esc(a.note)}` : ''}</td><td></td><td class="n">${signed(a.cents)}${draft ? ` <button type="button" class="btn quiet tiny" data-unadj="${esc(a.id)}">Remove</button>` : ''}</td></tr>`).join('')}
    </table>
    ${r.payout?.details ? `<p style="margin:.6rem 0 0;"><button type="button" class="btn quiet" data-reveal="${esc(r.uid)}">Show how to pay ${esc(r.name)}</button></p>` : ''}`;
}

/** His correction: + adds a typed adjustment; a tap on the total sets what they are owed. */
function adjust(run, uid, mode) {
  const r = run.rows.find((x) => x.uid === uid);
  const dlg = document.createElement('dialog');
  dlg.className = 'cancel-sheet ask-sheet';
  dlg.innerHTML = `
    <form method="dialog" class="ask-form">
      <h2>${mode === 'set' ? `Correct ${esc(r.name)}'s pay` : `Add to ${esc(r.name)}'s pay`}</h2>
      ${mode === 'set'
    ? `<p>Now ${esc(money(r.totalCents))}. Type what they should be paid; the difference is recorded as a correction.</p>
       <input class="ask-input" name="amount" inputmode="decimal" placeholder="What they are owed, e.g. 1260.00" autocomplete="off">`
    : `<p>A minus takes money off.</p>
       <select class="ask-input" name="type"><option>Pay adjustment</option><option>Bonus</option><option>Reimbursement</option></select>
       <input class="ask-input" name="amount" inputmode="decimal" placeholder="Amount, e.g. 50 or -25" autocomplete="off">`}
      <input class="ask-input" name="note" maxlength="200" placeholder="A note (optional)" autocomplete="off">
      <p class="error" data-err hidden></p>
      <div class="cancel-acts">
        <button type="submit" class="btn glow" value="ok">Save</button>
        <button type="button" class="btn quiet" data-no>Cancel</button>
      </div>
    </form>`;
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('[data-no]').addEventListener('click', close);
  dlg.addEventListener('cancel', close);
  dlg.querySelector('form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.currentTarget;
    const err = dlg.querySelector('[data-err]');
    const typed = Math.round(Number(String(f.amount.value).replace(/[$,\s]/g, '')) * 100);
    if (!Number.isFinite(typed)) { err.textContent = 'A number, please.'; err.hidden = false; return; }
    const cents = mode === 'set' ? typed - r.totalCents : typed;
    if (!cents) { close(); return; }
    try {
      const out = await payroll('POST', { action: 'adjust', id: run.id, uid, cents, type: mode === 'set' ? 'Correction' : f.type.value, note: f.note.value, editPaid: run.status !== 'draft' });
      close();
      showRun(out.run);
    } catch (x) { err.textContent = x.message; err.hidden = false; }
  });
  dlg.showModal();
  dlg.querySelector('[name="amount"]').focus();
}

/** How to pay them, opened on his screen only when he asks. */
function reveal(r) {
  const d = r?.payout?.details || {};
  const rows = Object.entries({ Name: d.name, Routing: d.routing, Account: d.account, Type: d.type, Address: d.address, 'Send to': d.handle, Note: d.text })
    .filter(([, v]) => v);
  const dlg = document.createElement('dialog');
  dlg.className = 'cancel-sheet ask-sheet';
  dlg.innerHTML = `
    <form method="dialog" class="ask-form">
      <h2>Pay ${esc(r.name)}: ${esc(r.payout.label)}</h2>
      ${rows.map(([k, v]) => `<p style="margin:0 0 .4rem;"><span class="dim small">${esc(k)}</span><br><strong style="user-select:all;">${esc(v)}</strong></p>`).join('')}
      <div class="cancel-acts"><button type="submit" class="btn glow" value="ok">Done</button></div>
    </form>`;
  document.body.appendChild(dlg);
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
}

/** The spreadsheet: the summary, every line behind it, and every adjustment. Account numbers never go in it. */
function download(run) {
  // A name or a note that starts like a formula is written as text
  // (security review, 2026-10-16): a client's name such as =HYPERLINK(...)
  // would otherwise run in his spreadsheet. Amounts stay numbers.
  const cell = (v) => {
    let s = String(v ?? '').replace(/\r?\n/g, ' ');
    if (!/^-?\d+(\.\d+)?$/.test(s) && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n]/.test(s) || s.startsWith("'") ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const d = (c) => ((Number(c) || 0) / 100).toFixed(2);
  const out = [];
  out.push(['Payroll', `${run.start} to ${run.end}`, run.status === 'draft' ? 'Draft' : 'Paid']);
  out.push([]);
  out.push(['Staff', 'Share %', 'Cases', 'Client sales', 'Deductions', 'Commission', 'Tips', 'Pay adjustments', 'Total owed', 'Payout method']);
  for (const r of run.rows || []) {
    out.push([r.name + (r.sample ? ' (sample)' : ''), r.commissionPct, r.cases, d(r.salesCents), d(-r.deductionsCents), d(r.commissionCents), d(r.tipsCents), d(r.adjustmentsCents), d(r.totalCents), r.payout ? `${r.payout.label} ${r.payout.hint || ''}`.trim() : 'Not set']);
  }
  const t = run.totals || {};
  out.push(['Total', '', t.cases, d(t.salesCents), d(-(t.deductionsCents || 0)), d(t.commissionCents), d(t.tipsCents), d(t.adjustmentsCents), d(t.totalCents), '']);
  out.push([]);
  out.push(['Staff', 'Date', 'Client', 'Item', 'Amount', 'Their pay']);
  for (const r of run.rows || []) for (const l of r.lines || []) out.push([r.name, String(l.at).slice(0, 10), l.client || '', l.label, l.kind === 'advisor' ? '' : d(l.cents), d(l.payCents)]);
  out.push([]);
  out.push(['Staff', 'Date', 'Adjustment', 'Amount', 'Note']);
  for (const r of run.rows || []) for (const a of r.adjustments || []) out.push([r.name, String(a.at).slice(0, 10), a.type, d(a.cents), a.note || '']);
  const blob = new Blob([`${out.map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `payroll-${run.start}-to-${run.end}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
