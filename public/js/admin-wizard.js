// ADD AN ADVOCATE, PAGE BY PAGE (Eric, 2026-10-17: "When I add an advocate, it
// should go page by page through everything I asked I could toggle on or off,
// their pricing, their initial schedule, profile picture, bio, any extra tiers
// or add-ons and their pricing, their pay preferences and if ACH their routing
// # and account # (assuming this is encrypted enough for that info to be
// safe) etc").
//
// Seven pages: who they are, what they offer and at what price, add-ons on
// Full-Service (attending, appeals and his own extras), their available hours, photo
// and bio, their share and pay, then a page to check it all. The same pages
// open again from their photo on their card, every page one tap away, to
// change anything. Whatever he leaves blank they fill in when they first sign
// in. The Worker checks every figure again (worker/advocates.js cleanSetup);
// bank numbers are sealed there before they are written (worker/payroll.js),
// and only the method and its last four ever come back.

import { addonFields, wireAddonFields, readAddonFields } from './admin-addons.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

const STEPS = [
  { id: 'who', title: 'Who they are' },
  { id: 'offer', title: 'What they offer' },
  { id: 'addons', title: 'Add-ons on Full-Service' },
  { id: 'hours', title: 'Available hours' },
  { id: 'profile', title: 'Photo and bio' },
  { id: 'pay', title: 'Their share and pay' },
  { id: 'review', title: 'Check it over' },
];
/** His own card has no prices, hours or pay here: those live in his settings. */
const OWNER_STEPS = ['who', 'addons', 'profile', 'review'];

export const DAYS = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const ZONE_NAMES = {
  'America/New_York': 'Eastern', 'America/Chicago': 'Central', 'America/Denver': 'Mountain', 'America/Boise': 'Mountain (Boise)',
  'America/Phoenix': 'Arizona', 'America/Los_Angeles': 'Pacific', 'America/Anchorage': 'Alaska', 'Pacific/Honolulu': 'Hawaii',
};
/** The fields each way of being paid needs; the same as their own page asks (admin-account.js). */
export const PAY_FIELDS = {
  ach: [['name', 'Name on the account'], ['routing', 'Routing number (9 digits)', 'numeric'], ['account', 'Account number', 'numeric'], ['type', 'Checking or savings', 'type']],
  check: [['name', 'Name for the check'], ['address', 'Mailing address', 'area']],
  zelle: [['name', 'Their name'], ['handle', 'Zelle email or phone']],
  paypal: [['name', 'Their name'], ['handle', 'PayPal email']],
  venmo: [['name', 'Their name'], ['handle', 'Venmo handle or phone']],
  other: [['name', 'Their name'], ['text', 'How they want to be paid', 'area']],
};
const PAY_NAMES = { ach: 'Direct deposit (ACH)', check: 'Paper check', zelle: 'Zelle', paypal: 'PayPal', venmo: 'Venmo', other: 'Other' };

const CSS = `
  .wz-sheet { width: min(36rem, calc(100vw - 2rem)); max-height: calc(100dvh - 2rem); }
  .wz-head { display: grid; gap: .45rem; margin-bottom: .6rem; }
  .wz-step { margin: 0; color: var(--dim); font-size: .78rem; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
  .wz-title { margin: 0; font-size: 1.3rem; }
  .wz-dots { display: flex; gap: .35rem; flex-wrap: wrap; }
  .wz-dot { width: 2rem; height: 2rem; border-radius: 999px; border: 1px solid var(--edge-base, var(--line)); background: transparent; color: var(--dim); font: inherit; font-size: .78rem; font-weight: 800; padding: 0; }
  .wz-dot.on { border-color: var(--cyan); color: var(--ink); background: color-mix(in srgb, var(--cyan) 16%, transparent); }
  .wz-dot.done { color: var(--ink); }
  .wz-dot:disabled { opacity: .45; }
  .wz-body { display: grid; gap: .8rem; }
  .wz-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: .6rem; }
  .wz-row > label:first-child { display: flex; align-items: center; gap: .55rem; color: var(--ink); font-weight: 700; }
  .wz-row input[type="checkbox"] { width: 1.15rem; height: 1.15rem; accent-color: var(--cyan); }
  .wz-money { display: inline-flex; align-items: center; gap: .25rem; color: var(--dim); }
  .wz-money input, .wz-num { width: 7rem; }
  .wz-sub { margin: -.35rem 0 0 1.7rem; }
  .wz-box { border: 1px solid var(--edge-base, var(--line)); border-radius: 12px; padding: .7rem .8rem; display: grid; gap: .6rem; }
  .wz-day { display: grid; grid-template-columns: 7.5rem minmax(0, 1fr); align-items: center; gap: .5rem; }
  .wz-day > label { display: flex; align-items: center; gap: .5rem; color: var(--ink); }
  .wz-times { display: flex; align-items: center; gap: .35rem; flex-wrap: wrap; color: var(--dim); font-size: .86rem; }
  .wz-times input { width: 7.2rem; }
  .wz-times input:disabled { opacity: .4; }
  .wz-custom { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: .45rem; }
  .wz-custom input[type="text"] { min-width: 0; }
  .wz-pic { display: flex; align-items: center; gap: .8rem; flex-wrap: wrap; }
  .wz-pic img { width: 76px; height: 76px; border-radius: 50%; object-fit: cover; border: 1px solid var(--edge-base, var(--line)); }
  .wz-safe { margin: 0; padding: .55rem .7rem; border-radius: 10px; background: color-mix(in srgb, var(--green, #76F1AC) 10%, transparent); color: var(--soft, var(--ink)); font-size: .84rem; }
  .wz-review { display: grid; gap: .55rem; margin: 0; padding: 0; list-style: none; }
  .wz-review li { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: .5rem; align-items: start; border-bottom: 1px solid var(--line); padding-bottom: .5rem; }
  .wz-review strong { display: block; }
  .wz-review span { color: var(--dim); font-size: .86rem; overflow-wrap: anywhere; }
  .wz-foot { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; margin-top: .9rem; position: sticky; bottom: 0; padding-top: .6rem; background: inherit; }
  .wz-foot .grow { flex: 1; }`;

function style() {
  if (document.getElementById('pa-wizard-css')) return;
  const st = document.createElement('style');
  st.id = 'pa-wizard-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const dollars = (cents) => (Number(cents) > 0 ? String(Math.round(Number(cents)) / 100) : '');
const money = (cents) => `$${(Math.round(Number(cents) || 0) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
/** A typed price as cents: '' is null (theirs follows his), anything else must be a price. */
function cents(raw, label) {
  const t = String(raw ?? '').replace(/[$,\s]/g, '');
  if (t === '') return { value: null };
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0.5 || n > 20000) return { error: `${label}: a price from $0.50 to $20,000, or leave it empty for yours.` };
  return { value: Math.round(n * 100) };
}

async function api(user, path, { method = 'POST', body, raw } = {}) {
  const headers = { authorization: `Bearer ${await user.getIdToken()}` };
  if (!raw) headers['content-type'] = 'application/json';
  else headers['content-type'] = raw.type;
  const res = await fetch(path, { method, headers, body: raw || (body ? JSON.stringify(body) : undefined) });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || `That did not work (${res.status}).`);
  return out;
}

/**
 * Opens the pages. mode 'add', or 'edit' with the person's uid. `say(text)`
 * reports what happened on the page; `done()` repaints the team.
 */
export async function openAdvocateWizard(user, { mode = 'add', uid = '', say = () => {}, done = () => {} } = {}) {
  style();
  const editing = mode === 'edit';
  const dlg = document.createElement('dialog');
  dlg.className = 'cancel-sheet ask-sheet tm-sheet wz-sheet';
  dlg.innerHTML = '<p class="dim">Loading…</p>';
  document.body.appendChild(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', close);
  dlg.showModal();

  // What he sees first: his own prices as the starting point, and for a change, everything they have now.
  let theirs = null;
  let mine = {};
  try {
    const [rates, got] = await Promise.all([
      fetch('/api/rates').then((r) => r.json()).catch(() => ({})),
      editing ? api(user, '/api/admin/advocates', { body: { action: 'get', uid } }) : Promise.resolve(null),
    ]);
    mine = rates || {};
    theirs = got;
  } catch (x) {
    dlg.innerHTML = `<p class="error">${esc(x.message)}</p><div class="cancel-acts"><button type="button" class="btn quiet" data-no>Close</button></div>`;
    dlg.querySelector('[data-no]').addEventListener('click', close);
    return;
  }
  const a = theirs?.advocate || {};
  const owner = a.owner === true;
  const steps = STEPS.filter((s) => !owner || OWNER_STEPS.includes(s.id));
  const set = theirs?.settings || {};
  const st = {
    name: a.name || '', email: a.email || '', password: '',
    offers: { case: set.offers?.case !== false, full: set.offers?.full !== false },
    rates: { caseCents: set.rates?.caseCents ?? null, addonCents: set.rates?.addonCents ?? null, fullCents: set.rates?.fullCents ?? null },
    fullCap: set.fullCap ?? 0,
    addons: theirs?.addons || {},
    custom: (theirs?.addons?.custom || []).map((x) => ({ ...x })),
    hours: set.hours || (editing ? null : { mon: { from: '09:00', to: '17:00' }, tue: { from: '09:00', to: '17:00' }, wed: { from: '09:00', to: '17:00' }, thu: { from: '09:00', to: '17:00' }, fri: { from: '09:00', to: '17:00' }, sat: null, sun: null }),
    tz: a.tz || 'America/Boise',
    responseTime: set.office?.responseTime || '',
    credentials: a.credentials || '', bio: a.bio || '', primarySpecialty: a.primarySpecialty || '',
    photo: null, hasPhoto: !!a.hasHeadshot,
    commissionPct: Number.isFinite(Number(a.commissionPct)) ? Number(a.commissionPct) : 60,
    payNow: theirs?.payout || null, payChange: !editing, payMethod: '', pay: {},
  };
  const zones = theirs?.zones || Object.keys(ZONE_NAMES);
  const specialties = theirs?.specialties || [];
  let at = 0;
  const seen = new Set([0]);

  // ---- each page, from the state, and back into it ------------------------------------
  const page = {
    who: () => editing ? `
      <label class="dim small">Their name<input class="ask-input" name="name" maxlength="80" value="${esc(st.name)}" autocomplete="off" required></label>
      <p class="dim small" style="margin:0;">Email: ${esc(st.email)}</p>` : `
      <label class="dim small">Their name<input class="ask-input" name="name" maxlength="80" value="${esc(st.name)}" autocomplete="off" required></label>
      <label class="dim small">Their email<input class="ask-input" name="email" type="email" maxlength="200" value="${esc(st.email)}" autocomplete="off" required></label>
      <label class="dim small">A first password, at least 10 characters<input class="ask-input" name="password" type="text" minlength="10" maxlength="200" value="${esc(st.password)}" autocomplete="off" required></label>
      <p class="dim small" style="margin:0;">They get an email saying the account is ready. Give them this password yourself: it is never emailed, shown again or kept as you typed it. They choose their own the first time they sign in.</p>`,
    offer: () => `
      <p class="dim small" style="margin:0;">Leave a price empty to use yours.</p>
      <div class="wz-box">
        <div class="wz-row"><label><input type="checkbox" data-offer="case"${st.offers.case ? ' checked' : ''}> Advocacy Case</label>
          <label class="wz-money">$<input class="ask-input" inputmode="decimal" data-rate="caseCents" value="${esc(dollars(st.rates.caseCents))}" placeholder="${esc(dollars(mine.caseCents))}" aria-label="Advocacy Case price, dollars"></label></div>
        <div class="wz-row wz-sub"><span class="dim small">A follow-up call</span>
          <label class="wz-money">$<input class="ask-input" inputmode="decimal" data-rate="addonCents" value="${esc(dollars(st.rates.addonCents))}" placeholder="${esc(dollars(mine.addonCents))}" aria-label="Follow-up call price, dollars"></label></div>
      </div>
      <div class="wz-box">
        <div class="wz-row"><label><input type="checkbox" data-offer="full"${st.offers.full ? ' checked' : ''}> Full-Service, a month</label>
          <label class="wz-money">$<input class="ask-input" inputmode="decimal" data-rate="fullCents" value="${esc(dollars(st.rates.fullCents))}" placeholder="${esc(dollars(mine.fullCents))}" aria-label="Full-Service month price, dollars"></label></div>
        <div class="wz-row wz-sub"><span class="dim small">Full-Service clients at once (0 is no limit)</span>
          <input class="ask-input wz-num" type="number" min="0" max="99" step="1" data-cap value="${esc(st.fullCap)}" aria-label="Full-Service clients at once"></div>
      </div>
      <p class="dim small" style="margin:0;">Turned off, nobody can buy it from them. Priority Chat stays yours.</p>`,
    addons: () => `
      ${addonFields(st.addons)}
      <div class="wz-box" data-customs>
        <strong>Your own add-ons for them</strong>
        <p class="dim small" style="margin:0;">Anything else they do on top of a month, with your name for it and a price. Clients ask for it on their case, and they say yes or no.</p>
        ${st.custom.map((x, i) => customRow(x, i)).join('')}
        ${st.custom.length < 6 ? '<button type="button" class="btn quiet" data-add-custom>+ Add one</button>' : ''}
      </div>`,
    hours: () => `
      <p class="dim small" style="margin:0;">The days and times they are available. Their in and out of office light follows these. They can change them later.</p>
      <div class="wz-box">${DAYS.map(([d, name]) => {
        const v = st.hours?.[d] || null;
        return `<div class="wz-day"><label><input type="checkbox" data-day="${d}"${v ? ' checked' : ''}> ${name}</label>
          <span class="wz-times"><input class="ask-input" type="time" data-from="${d}" value="${esc(v?.from || '09:00')}"${v ? '' : ' disabled'} aria-label="${name} start"> to <input class="ask-input" type="time" data-to="${d}" value="${esc(v?.to || '17:00')}"${v ? '' : ' disabled'} aria-label="${name} end"></span></div>`;
      }).join('')}</div>
      <label class="dim small">Their time zone<select class="ask-input" data-tz>${zones.map((z) => `<option value="${esc(z)}"${z === st.tz ? ' selected' : ''}>${esc(ZONE_NAMES[z] || z)}</option>`).join('')}</select></label>
      <label class="dim small">What their clients read about replies (optional)<input class="ask-input" data-response maxlength="160" value="${esc(st.responseTime)}" placeholder="For example: I reply within one business day"></label>`,
    profile: () => `
      <div class="wz-pic">
        <img data-pic-preview alt=""${st.photo ? ` src="${esc(URL.createObjectURL(st.photo))}"` : st.hasPhoto && uid ? ` src="/api/advocates/headshot?uid=${encodeURIComponent(uid)}"` : ' hidden'}>
        <label class="btn quiet">Choose a photo<input type="file" accept="image/jpeg,image/png,image/webp" data-pic hidden></label>
      </div>
      <label class="dim small">Credentials<input class="ask-input" name="credentials" maxlength="200" value="${esc(st.credentials)}" placeholder="For example: RN, BCPA" autocomplete="off"></label>
      ${specialties.length ? `<label class="dim small">Their main specialty<select class="ask-input" name="primarySpecialty"><option value="">Not chosen</option>${specialties.map((s) => `<option${s === st.primarySpecialty ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>` : ''}
      <label class="dim small">Bio<textarea class="ask-input" name="bio" maxlength="1500" rows="6" placeholder="The bio they sent you.">${esc(st.bio)}</textarea></label>`,
    pay: () => `
      <label class="dim small">Their share of what their clients pay, in percent<input class="ask-input wz-num" type="number" min="0" max="100" step="1" name="commissionPct" value="${esc(st.commissionPct)}"></label>
      ${st.payNow ? `<p class="small" style="margin:0;">Paid by ${esc(st.payNow.label || PAY_NAMES[st.payNow.method] || st.payNow.method)}${st.payNow.hint ? `: ${esc(st.payNow.hint)}` : ''}.</p>` : ''}
      ${st.payNow && !st.payChange ? '<button type="button" class="btn quiet" data-pay-change>Change how they are paid</button>' : `
      <label class="dim small">How they want to be paid<select class="ask-input" data-pay-method>
        <option value="">${st.payNow ? 'Keep it as it is' : 'They will add it when they sign in'}</option>
        ${Object.entries(PAY_NAMES).map(([k, v]) => `<option value="${k}"${k === st.payMethod ? ' selected' : ''}>${esc(v)}</option>`).join('')}
      </select></label>
      <div class="wz-box" data-pay-fields${st.payMethod ? '' : ' hidden'}>${payFields(st.payMethod, st.pay)}</div>`}
      <p class="wz-safe">Bank details are encrypted before they are stored. Only you see the full numbers; everyone else sees the last four.</p>`,
    review: () => `
      <ul class="wz-review">${steps.filter((s) => s.id !== 'review').map((s) => `<li><div><strong>${esc(s.title)}</strong><span>${esc(summary(s.id))}</span></div><button type="button" class="btn quiet tiny" data-jump="${steps.indexOf(s)}">Change</button></li>`).join('')}</ul>`,
  };

  function customRow(x, i) {
    return `<div class="wz-custom" data-custom="${i}">
      <input type="checkbox" data-c-on${x.on ? ' checked' : ''} aria-label="Offer it">
      <input class="ask-input" type="text" data-c-label maxlength="60" value="${esc(x.label || '')}" placeholder="Name it" aria-label="Add-on name">
      <label class="wz-money">$<input class="ask-input" inputmode="decimal" data-c-price value="${esc(x.raw ?? dollars(x.cents))}" aria-label="Add-on price, dollars" style="width:5.5rem"></label>
      <button type="button" class="btn quiet tiny" data-c-remove aria-label="Remove it">Remove</button>
    </div>`;
  }
  function payFields(method, vals) {
    return (PAY_FIELDS[method] || []).map(([k, label, kind]) => {
      if (kind === 'type') return `<label class="dim small">${esc(label)}<select class="ask-input" data-pf="${k}"><option value="checking"${vals[k] !== 'savings' ? ' selected' : ''}>Checking</option><option value="savings"${vals[k] === 'savings' ? ' selected' : ''}>Savings</option></select></label>`;
      if (kind === 'area') return `<label class="dim small">${esc(label)}<textarea class="ask-input" rows="3" data-pf="${k}">${esc(vals[k] || '')}</textarea></label>`;
      return `<label class="dim small">${esc(label)}<input class="ask-input" data-pf="${k}" value="${esc(vals[k] || '')}"${kind === 'numeric' ? ' inputmode="numeric" autocomplete="off"' : ''}></label>`;
    }).join('');
  }
  function summary(id) {
    if (id === 'who') return editing ? st.name : `${st.name || 'No name yet'}, ${st.email || 'no email yet'}`;
    if (id === 'offer') {
      const p = (k) => money(st.rates[k] ?? mine[k]);
      return [st.offers.case ? `Advocacy Case ${p('caseCents')}, follow-up ${p('addonCents')}` : 'No Advocacy Cases',
        st.offers.full ? `Full-Service ${p('fullCents')} a month${st.fullCap ? `, ${st.fullCap} at once` : ''}` : 'No Full-Service'].join('. ');
    }
    if (id === 'addons') {
      const on = [];
      if (st.addons.attend?.on) on.push(`attending ${money(st.addons.attend.cents)}`);
      if (st.addons.appeal?.on) on.push(`appeals ${money(st.addons.appeal.cents)}`);
      for (const x of st.custom) if (x.on && x.label) on.push(`${x.label} ${money(x.cents)}`);
      return on.length ? on.join(', ') : 'None';
    }
    if (id === 'hours') {
      const days = DAYS.filter(([d]) => st.hours?.[d]).map(([d, n]) => `${n.slice(0, 3)} ${st.hours[d].from} to ${st.hours[d].to}`);
      return days.length ? `${days.join(', ')} (${ZONE_NAMES[st.tz] || st.tz})` : 'Your office hours';
    }
    if (id === 'profile') return [st.photo || st.hasPhoto ? 'Photo' : 'No photo yet', st.credentials || 'no credentials yet', st.bio ? 'bio written' : 'no bio yet'].join(', ');
    if (id === 'pay') {
      const how = st.payMethod ? PAY_NAMES[st.payMethod] : st.payNow ? `${st.payNow.label || PAY_NAMES[st.payNow.method]} ${st.payNow.hint || ''}`.trim() : 'They add it when they sign in';
      return `${st.commissionPct}% share. ${how}`;
    }
    return '';
  }

  /** His own extras as the rows stand, nothing dropped, so a row's place still matches the screen. */
  const customRows = () => [...dlg.querySelectorAll('[data-custom]')].map((row, i) => ({
    ...(st.custom[i] || {}), on: !!row.querySelector('[data-c-on]').checked,
    label: row.querySelector('[data-c-label]').value.trim(), raw: row.querySelector('[data-c-price]').value,
  }));
  /** The appeal and attending rows as they stand, kept while a row of his own is added or taken away. */
  const keepAddonRows = () => { const picked = readAddonFields(dlg); if (!picked.error) st.addons = { ...st.addons, ...picked.addons }; };

  /** The page's fields back into the state; an error stops the page from being left. */
  function read() {
    const id = steps[at].id;
    const q = (s) => dlg.querySelector(s);
    if (id === 'who') {
      st.name = String(q('[name="name"]')?.value || '').trim();
      if (!editing) { st.email = String(q('[name="email"]')?.value || '').trim(); st.password = String(q('[name="password"]')?.value || ''); }
      if (!st.name) return 'Their name, please.';
      if (!editing && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(st.email)) return 'Their email address, please.';
      if (!editing && st.password.length < 10) return 'A first password of at least 10 characters.';
    }
    if (id === 'offer') {
      for (const k of ['case', 'full']) st.offers[k] = !!q(`[data-offer="${k}"]`)?.checked;
      for (const [k, label] of [['caseCents', 'Advocacy Case'], ['addonCents', 'Follow-up call'], ['fullCents', 'Full-Service']]) {
        const got = cents(q(`[data-rate="${k}"]`)?.value, label);
        if (got.error) return got.error;
        st.rates[k] = got.value;
      }
      const cap = Number(q('[data-cap]')?.value || 0);
      if (!Number.isInteger(cap) || cap < 0 || cap > 99) return 'Clients at once: a number from 0 to 99.';
      st.fullCap = cap;
    }
    if (id === 'addons') {
      const picked = readAddonFields(dlg);
      if (picked.error) return picked.error;
      st.addons = { ...st.addons, ...picked.addons };
      st.custom = customRows();
      for (const x of st.custom) {
        if (!x.label && !x.on) continue;
        if (!x.label) return 'Each add-on of your own needs a name.';
        const t = String(x.raw ?? '').replace(/[$,\s]/g, '');
        const n = t === '' ? 0 : Number(t);
        if (!Number.isFinite(n) || n < 0 || n > 20000 || (n > 0 && n < 0.5)) return `${x.label}: a price from $0.50 to $20,000, or 0 for no charge.`;
        x.cents = Math.round(n * 100);
      }
      st.custom = st.custom.filter((x) => x.label || x.on).map(({ raw, ...x }) => x);
    }
    if (id === 'hours') {
      const hours = {};
      for (const [d, name] of DAYS) {
        if (!q(`[data-day="${d}"]`)?.checked) { hours[d] = null; continue; }
        const from = q(`[data-from="${d}"]`).value;
        const to = q(`[data-to="${d}"]`).value;
        if (!from || !to || to <= from) return `${name}: the end comes after the start.`;
        hours[d] = { from, to };
      }
      st.hours = Object.values(hours).some(Boolean) ? hours : null;
      st.tz = q('[data-tz]')?.value || st.tz;
      st.responseTime = String(q('[data-response]')?.value || '').trim();
    }
    if (id === 'profile') {
      st.credentials = String(q('[name="credentials"]')?.value || '').trim();
      st.bio = String(q('[name="bio"]')?.value || '').trim();
      if (q('[name="primarySpecialty"]')) st.primarySpecialty = q('[name="primarySpecialty"]').value;
      if (st.photo && st.photo.size > 3 * 1024 * 1024) return 'That photo is over 3 MB.';
    }
    if (id === 'pay') {
      const pct = Number(q('[name="commissionPct"]')?.value);
      if (!Number.isInteger(pct) || pct < 0 || pct > 100) return 'Their share is a whole percent, 0 to 100.';
      st.commissionPct = pct;
      const sel = q('[data-pay-method]');
      if (sel) {
        st.payMethod = sel.value;
        st.pay = {};
        for (const el of dlg.querySelectorAll('[data-pf]')) st.pay[el.dataset.pf] = el.value.trim();
        if (st.payMethod === 'ach') {
          const routing = (st.pay.routing || '').replace(/\D/g, '');
          const account = (st.pay.account || '').replace(/\D/g, '');
          if (!st.pay.name || routing.length !== 9 || account.length < 4 || account.length > 17) return 'The name on the account, a 9 digit routing number and the account number, please.';
        }
      }
    }
    return '';
  }

  function paint() {
    const s = steps[at];
    const last = at === steps.length - 1;
    dlg.innerHTML = `
      <form class="ask-form" id="${editing ? 'adv-edit' : 'adv-add'}" data-wizard="${esc(s.id)}" autocomplete="off" novalidate>
        <div class="wz-head">
          <p class="wz-step">${editing ? `${esc(st.name || 'Their')} details` : 'Add an advocate'} · Step ${at + 1} of ${steps.length}</p>
          <h2 class="wz-title">${esc(s.title)}</h2>
          <div class="wz-dots" role="tablist" aria-label="Pages">${steps.map((x, i) => `<button type="button" class="wz-dot${i === at ? ' on' : ''}${seen.has(i) && i !== at ? ' done' : ''}" data-jump="${i}" aria-label="${esc(x.title)}"${editing || seen.has(i) ? '' : ' disabled'}${i === at ? ' aria-current="step"' : ''}>${i + 1}</button>`).join('')}</div>
        </div>
        <div class="wz-body">${page[s.id]()}</div>
        <p class="error" data-err hidden role="alert"></p>
        <div class="wz-foot">
          ${at > 0 ? '<button type="button" class="btn quiet" data-back>Back</button>' : '<button type="button" class="btn quiet" data-no>Cancel</button>'}
          <span class="grow"></span>
          ${editing && !last ? '<button type="button" class="btn quiet" data-save>Save</button>' : ''}
          ${last ? `<button type="submit" class="btn glow" data-finish>${editing ? 'Save changes' : `Add ${esc(st.name.split(/\s+/)[0] || 'them')}`}</button>` : '<button type="submit" class="btn glow" data-next>Next</button>'}
        </div>
      </form>`;
    wire();
    // Only the first page asks for typing at once; on a phone every other page would throw the keyboard up unasked.
    if (at === 0 && !editing) dlg.querySelector('.wz-body input')?.focus({ preventScroll: true });
  }

  const err = (text) => { const e = dlg.querySelector('[data-err]'); if (e) { e.textContent = text; e.hidden = !text; } };
  // Forward only past a page that reads right; back is always open.
  const go = (i) => {
    const problem = read();
    if (problem && i > at) { err(problem); return; }
    at = Math.max(0, Math.min(steps.length - 1, i));
    seen.add(at);
    paint();
    dlg.scrollTo?.(0, 0);
  };

  function wire() {
    const form = dlg.querySelector('form');
    dlg.querySelector('[data-no]')?.addEventListener('click', close);
    dlg.querySelector('[data-back]')?.addEventListener('click', () => go(at - 1));
    for (const b of dlg.querySelectorAll('[data-jump]')) b.addEventListener('click', () => go(Number(b.dataset.jump)));
    dlg.querySelector('[data-save]')?.addEventListener('click', () => finish());
    form.addEventListener('submit', (e) => { e.preventDefault(); if (steps[at].id === 'review') finish(); else go(at + 1); });
    if (steps[at].id === 'addons') {
      wireAddonFields(dlg);
      dlg.querySelector('[data-add-custom]')?.addEventListener('click', () => {
        keepAddonRows();
        st.custom = customRows();
        st.custom.push({ on: true, label: '', cents: 0 });
        paint();
        [...dlg.querySelectorAll('[data-c-label]')].pop()?.focus();
      });
      for (const row of dlg.querySelectorAll('[data-custom]')) {
        row.querySelector('[data-c-remove]').addEventListener('click', () => {
          keepAddonRows();
          st.custom = customRows();
          st.custom.splice(Number(row.dataset.custom), 1);
          paint();
        });
      }
    }
    if (steps[at].id === 'hours') {
      for (const box of dlg.querySelectorAll('[data-day]')) {
        box.addEventListener('change', () => {
          for (const t of dlg.querySelectorAll(`[data-from="${box.dataset.day}"], [data-to="${box.dataset.day}"]`)) t.disabled = !box.checked;
        });
      }
    }
    if (steps[at].id === 'profile') {
      const pic = dlg.querySelector('[data-pic]');
      pic.addEventListener('change', () => {
        const file = pic.files?.[0];
        if (!file) return;
        st.photo = file;
        const img = dlg.querySelector('[data-pic-preview]');
        img.src = URL.createObjectURL(file);
        img.hidden = false;
      });
    }
    if (steps[at].id === 'pay') {
      dlg.querySelector('[data-pay-change]')?.addEventListener('click', () => { read(); st.payChange = true; paint(); });
      const sel = dlg.querySelector('[data-pay-method]');
      sel?.addEventListener('change', () => {
        const box = dlg.querySelector('[data-pay-fields]');
        st.payMethod = sel.value;
        box.innerHTML = payFields(sel.value, {});
        box.hidden = !sel.value;
      });
    }
  }

  async function finish() {
    const problem = read();
    if (problem) { err(problem); return; }
    const btn = dlg.querySelector('[data-finish], [data-save]');
    if (btn) btn.disabled = true;
    err('');
    const settings = owner ? undefined : {
      offers: { ...st.offers }, rates: { ...st.rates }, fullCap: st.fullCap, hours: st.hours,
      office: { responseTime: st.responseTime || null },
    };
    const addons = { attend: st.addons.attend || { on: false, cents: 0 }, appeal: st.addons.appeal || { on: false, cents: 0 }, custom: st.custom };
    const payout = !owner && st.payMethod ? { method: st.payMethod, fields: st.pay } : undefined;
    try {
      let id = uid;
      let emailed = true;
      if (editing) {
        if (st.photo) await api(user, `/api/admin/advocates/headshot?uid=${encodeURIComponent(uid)}`, { raw: st.photo });
        await api(user, '/api/admin/advocates', {
          body: {
            action: 'update', uid, name: st.name, credentials: st.credentials, bio: st.bio,
            ...(st.primarySpecialty ? { primarySpecialty: st.primarySpecialty } : {}),
            ...(owner ? {} : { tz: st.tz, commissionPct: st.commissionPct, settings, payout }),
            addons,
          },
        });
      } else {
        const out = await api(user, '/api/admin/advocates', {
          body: {
            action: 'create', name: st.name, email: st.email, password: st.password, commissionPct: st.commissionPct,
            profile: { credentials: st.credentials, bio: st.bio, primarySpecialty: st.primarySpecialty, ...(st.primarySpecialty ? { specialties: [st.primarySpecialty] } : {}), tz: st.tz },
            settings, addons, payout,
          },
        });
        id = out.uid;
        emailed = out.emailed;
        // The photo goes up once the account exists; a photo that will not go up never undoes the account.
        if (st.photo) {
          try { await api(user, `/api/admin/advocates/headshot?uid=${encodeURIComponent(id)}`, { raw: st.photo }); } catch (x) {
            close();
            say(`Added. The photo did not upload (${x.message}). Add it from their card.`);
            done();
            return;
          }
        }
      }
      close();
      say(editing ? 'Saved.' : emailed
        ? 'Done. They have an email saying the account is ready. Give them the password yourself.'
        : 'Done. The email did not send, so tell them yourself: sign in at the site with their email and the password you gave them.');
      done();
    } catch (x) {
      err(x.message);
      if (btn) btn.disabled = false;
    }
  }

  paint();
}
