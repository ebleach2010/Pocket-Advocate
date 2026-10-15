// My account (2026-10-15). An advocate's setup and their own page after it;
// for Eric, his public profile (he is advocate number one, and his card is
// what clients will see).
//
// Eric, 2026-10-15: "During onboarding, the advocate provides: Name, Email,
// Initial password, Headshot, Bio, Credentials, Primary specialty, Additional
// specialties, Service pricing, AI Advisor opt-in, Payment information." This
// page takes the profile, the photo, their own password and the Advisor
// choice. Prices arrive with their calendar, and payment details with
// payroll; both are said so here rather than left out silently.
//
// Everything is the Worker's to check (/api/staff/me, /api/staff/headshot):
// an advocate can set only their own profile, and nothing here can reach
// their share, their switch or anyone else's record.

import './admin-ledger.js';
import { requireAdmin, hydrateNav, STAFF } from './auth.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const OTHER = '__other__';
const BIO_MAX = 1500;

hydrateNav();
const user = await requireAdmin();
const setup = new URLSearchParams(location.search).get('setup') === '1';
let me = null;
if (user) load();

async function api(method, body) {
  const token = await user.getIdToken();
  const res = await fetch('/api/staff/me', {
    method,
    headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(out.error || `That did not work (${res.status}).`), { out });
  return out;
}

async function load() {
  const host = document.getElementById('acct');
  try {
    me = await api('GET');
  } catch (err) {
    host.innerHTML = `<p class="error">${esc(err.message)}</p>`;
    return;
  }
  const admin = STAFF.role === 'admin' || me.role === 'admin';
  document.getElementById('acct-title').textContent = admin ? 'My profile' : (me.advocate.onboardedAt ? 'My account' : 'Set up your account');
  render(host, admin);
}

function steps(a) {
  const need = new Set(a.missing);
  const rows = [
    ['your own password', !me.mustChange],
    ['your photo', !need.has('headshot')],
    ['your name and credentials', !need.has('name') && !need.has('credentials')],
    ['your specialties', !need.has('primary specialty')],
    ['a short bio', !need.has('bio')],
  ];
  return `<ol class="steps">${rows.map(([t, ok]) => `<li class="${ok ? 'done' : ''}">${esc(t)}</li>`).join('')}</ol>`;
}

function specialtyOptions(list, current) {
  const known = list.includes(current);
  return [
    '<option value="">Choose one</option>',
    ...list.map((s) => `<option value="${esc(s)}"${s === current ? ' selected' : ''}>${esc(s)}</option>`),
    `<option value="${OTHER}"${current && !known ? ' selected' : ''}>Something else…</option>`,
  ].join('');
}

function render(host, admin) {
  const a = me.advocate;
  const list = me.specialties || [];
  const extras = a.specialties.filter((s) => s !== a.primarySpecialty);
  const customExtras = extras.filter((s) => !list.includes(s));
  const primaryCustom = a.primarySpecialty && !list.includes(a.primarySpecialty) ? a.primarySpecialty : '';
  const photo = a.hasHeadshot ? `<img src="/api/advocates/headshot?uid=${encodeURIComponent(a.uid)}&t=${Date.now()}" alt="Your photo">` : '<span class="blank">No photo</span>';
  host.innerHTML = `
    ${!admin && !a.onboardedAt ? `<section class="panel"><h3 style="margin:0;">Before your card goes live</h3>${steps(a)}<p class="dim small" style="margin:0;">Your prices and your calendar come next, once your profile is in.</p></section>` : ''}
    ${!admin && me.mustChange ? `
    <form class="panel" id="pw-form" autocomplete="off">
      <h3 style="margin:0;">Choose your own password</h3>
      <label>The password you were given<input type="password" name="current" required autocomplete="current-password"></label>
      <label>Your new password<input type="password" name="next" required minlength="10" autocomplete="new-password"></label>
      <label>The new one again<input type="password" name="again" required minlength="10" autocomplete="new-password"></label>
      <div class="row-btn"><button type="submit" class="btn glow">Save my password</button><span class="dim small" data-said role="status"></span></div>
    </form>` : ''}
    <section class="panel">
      <h3 style="margin:0;">Your photo</h3>
      <div class="headshot" data-photo>${photo}
        <label class="btn quiet" style="display:inline-flex;align-items:center;min-height:44px;cursor:pointer;">Choose a photo
          <input type="file" accept="image/jpeg,image/png,image/webp" data-photo-input hidden></label>
      </div>
      <p class="dim small" style="margin:0;">A clear headshot, JPEG, PNG or WebP, up to 3 MB. It shows on your card on the public site.</p>
      <span class="dim small" data-photo-said role="status"></span>
    </section>
    <form class="panel" id="profile-form" autocomplete="off">
      <h3 style="margin:0;">Your profile</h3>
      <label>Your name, as clients will see it<input type="text" name="name" maxlength="80" value="${esc(a.name)}" required></label>
      <label>Credentials<input type="text" name="credentials" maxlength="200" value="${esc(a.credentials)}" placeholder="For example: RN, BCPA, 8 years in neurology clinics"></label>
      <label>Primary specialty<select name="primary">${specialtyOptions(list, a.primarySpecialty)}</select></label>
      <label data-primary-other ${primaryCustom ? '' : 'hidden'}>Your specialty, in your words<input type="text" name="primaryOther" maxlength="40" value="${esc(primaryCustom)}"></label>
      <fieldset style="border:0;padding:0;margin:0;display:grid;gap:.4rem;">
        <legend style="font-size:.9rem;margin-bottom:.3rem;">Other specialties (optional, up to six)</legend>
        <div class="chips">${list.map((s) => `<label><input type="checkbox" name="extra" value="${esc(s)}"${extras.includes(s) ? ' checked' : ''}> ${esc(s)}</label>`).join('')}</div>
        <label>Any others, separated by commas<input type="text" name="extraOther" maxlength="200" value="${esc(customExtras.join(', '))}"></label>
      </fieldset>
      <label>Bio <span class="dim small" data-bio-count></span><textarea name="bio" maxlength="${BIO_MAX}" placeholder="Who you help, how you work, and what you bring.">${esc(a.bio)}</textarea></label>
      <div class="row-btn"><button type="submit" class="btn glow">Save my profile</button><span class="dim small" data-said role="status"></span></div>
    </form>
    ${admin ? '' : `
    <form class="panel" id="advisor-form">
      <h3 style="margin:0;">Pocket Advocate Advisor</h3>
      <p class="small" style="margin:0;">Advisor reads what is in each of your cases (records, labs, imaging reports, notes, messages, reports, insurance details and the timeline) and gives you a written read: what changed, what is missing, what contradicts, questions to ask, priorities, and insurance or referral issues. It updates every 6 hours when a case has changed, and whenever you tap Update.</p>
      <p class="dim small" style="margin:0;">Advisor is AI-generated guidance. It can be wrong, it does not diagnose, and it does not replace anyone's professional medical judgment. Nothing it writes is ever sent to a client. It costs $79 a month, taken from your earnings, which includes $60 of reading; past that, automatic updates pause and each Update you tap is billed at cost.</p>
      <label class="toggle"><input type="checkbox" name="optin"${a.advisorOptIn ? ' checked' : ''}> I want Advisor</label>
      <p class="dim small" style="margin:0;">${a.advisorEnabled ? 'It is switched on for you.' : a.advisorOptIn ? 'You have asked for it. It is switched on for you once Eric turns it on.' : 'Off. Tick the box to ask for it.'}</p>
      <div class="row-btn"><button type="submit" class="btn quiet">Save my choice</button><span class="dim small" data-said role="status"></span></div>
    </form>
    <section class="panel">
      <h3 style="margin:0;">Prices and payment</h3>
      <p class="dim small" style="margin:0;">You will set your own prices for the three services when your calendar opens, and add how you want to be paid when payroll opens. Neither is needed to finish setting up.</p>
    </section>`}
    ${!admin && !a.onboardedAt ? `
    <section class="panel">
      <div class="row-btn"><button type="button" class="btn glow" data-finish>Finish setting up</button><span class="dim small" data-finish-said role="status"></span></div>
    </section>` : ''}`;
  wire(host, admin);
}

function wire(host, admin) {
  const said = (form, text) => { const s = form.querySelector('[data-said]'); if (s) s.textContent = text; };
  const pw = host.querySelector('#pw-form');
  pw?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(pw);
    if (fd.get('next') !== fd.get('again')) { said(pw, 'The two new passwords are not the same.'); return; }
    said(pw, 'Saving…');
    try {
      await api('POST', { action: 'password', current: fd.get('current'), next: fd.get('next') });
      me.mustChange = false;
      said(pw, 'Saved.');
      setTimeout(() => render(host, admin), 700);
    } catch (err) { said(pw, err.message); }
  });

  const input = host.querySelector('[data-photo-input]');
  input?.addEventListener('change', async () => {
    const file = input.files?.[0];
    const out = host.querySelector('[data-photo-said]');
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) { out.textContent = 'That photo is over 3 MB.'; return; }
    out.textContent = 'Uploading…';
    try {
      const token = await user.getIdToken();
      const res = await fetch('/api/staff/headshot', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': file.type || 'application/octet-stream' },
        body: file,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Upload failed (${res.status}).`);
      out.textContent = 'Saved.';
      me = await api('GET');
      render(host, admin);
    } catch (err) { out.textContent = err.message; }
  });

  const profile = host.querySelector('#profile-form');
  const bio = profile.querySelector('textarea[name="bio"]');
  const count = profile.querySelector('[data-bio-count]');
  const tick = () => { count.textContent = `${bio.value.length} / ${BIO_MAX}`; };
  bio.addEventListener('input', tick);
  tick();
  const primary = profile.querySelector('select[name="primary"]');
  primary.addEventListener('change', () => {
    profile.querySelector('[data-primary-other]').hidden = primary.value !== OTHER;
  });
  profile.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(profile);
    const prim = fd.get('primary') === OTHER ? String(fd.get('primaryOther') || '') : String(fd.get('primary') || '');
    const extra = [...fd.getAll('extra').map(String),
      ...String(fd.get('extraOther') || '').split(',').map((s) => s.trim()).filter(Boolean)];
    said(profile, 'Saving…');
    try {
      const out = await api('POST', {
        action: 'profile', name: fd.get('name'), credentials: fd.get('credentials'), bio: fd.get('bio'),
        primarySpecialty: prim, specialties: [prim, ...extra].filter(Boolean),
      });
      me.advocate = out.advocate;
      said(profile, 'Saved.');
      setTimeout(() => render(host, admin), 700);
    } catch (err) { said(profile, err.message); }
  });

  const adv = host.querySelector('#advisor-form');
  adv?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const on = adv.querySelector('input[name="optin"]').checked;
    said(adv, 'Saving…');
    try {
      const out = await api('POST', { action: 'profile', advisorOptIn: on });
      me.advocate = out.advocate;
      said(adv, on ? 'Saved. Eric will see you asked for it.' : 'Saved. Advisor is off for you.');
      setTimeout(() => render(host, admin), 900);
    } catch (err) { said(adv, err.message); }
  });

  host.querySelector('[data-finish]')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const out = host.querySelector('[data-finish-said]');
    btn.disabled = true;
    out.textContent = '';
    try {
      await api('POST', { action: 'onboarded' });
      out.textContent = 'Done. Taking you to your clients.';
      setTimeout(() => location.assign('/admin.html'), 900);
    } catch (err) {
      out.textContent = err.message;
      btn.disabled = false;
    }
  });
  if (setup && me.mustChange) host.querySelector('#pw-form input')?.focus();
}
