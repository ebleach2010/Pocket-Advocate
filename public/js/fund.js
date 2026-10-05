// The Community Assistance Fund: the verification form and the status page
// (Eric, 2026-10-04).
//
// Six short steps, one thing at a time, written for someone who may be
// exhausted or foggy while they do it: "Step X of 6", big buttons, progress
// saved on every Continue so they can stop and come back, a tick on every
// file that landed, plain words when something goes wrong, and nothing they
// typed is ever cleared by an error. What is on screen lives in `form` and
// is only ever replaced by what they type.
//
// The Worker decides everything that matters (worker/fund.js): whose
// application this is, what may still change, whether it is complete. The
// page only mirrors those rules so a person hears about a gap before they
// tap Submit. No storage address of any file ever reaches this page; a file
// is shown by what it is and how big it is, never by its name.

import { requireUser } from './auth.js';
import { auth, signOut } from './firebase.js';
import { enablePush, pushSupported, pushInstalled } from './push.js';
import { DISCORD_INVITE, CHECK_NOTE, NEED_MAX, dollars, nextPayout, payoutWords, chaseLine, DOC_RULE } from './fund-rules.js';

const HELP = 'office@pocketadvocacy.com';
const box = document.getElementById('fund');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const helpLine = `Still stuck? Email <a href="mailto:${HELP}">${HELP}</a>.`;

const STEPS = ['Community Information', 'Identity Verification', 'Medical Eligibility', 'Participation', 'Payment Information', 'Certification and Consent'];
const STATUS_WORDS = {
  draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review', more_info: 'More Information Requested',
  verified: 'Verified', not_verified: 'Not Verified', inactive: 'Inactive',
};
// Eric's five statements, word for word.
const CONSENTS = [
  ['accurate', 'I certify that the information I submitted is accurate to the best of my knowledge.'],
  ['noGuarantee', 'I understand that submitting this application does not guarantee approval or future distributions.'],
  ['notMedical', 'I understand that verification confirms eligibility only and does not represent a medical opinion or determination of medical severity.'],
  ['reviewerView', 'I consent to authorized reviewers viewing the information and documents I submitted for the limited purpose of determining eligibility.'],
  ['formula', 'I understand that, if approved and actively participating, I will receive distributions according to the same published distribution formula used for other verified participants.'],
];
const ID_REDACT = 'You may redact information we do not need, including your address, ID number, date of birth, and other unrelated personal information. We primarily need enough information to reasonably confirm that the application belongs to a real person.';
const MED_REDACT = 'You may redact diagnoses, medications, test results, account numbers, dates of birth, and unrelated medical information. We only need enough information to reasonably verify eligibility.';
const NOTE_LABEL = 'Anything you’d like the reviewer to know about your documentation?';
const DOC_MAX = 25 * 1024 * 1024;
const PHOTO_MAX = 10 * 1024 * 1024;
const MEDICAL_MAX = 5;
const EXT_TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', heic: 'image/heic', heif: 'image/heif', webp: 'image/webp' };
const TYPE_WORDS = { 'application/pdf': 'PDF', 'image/jpeg': 'JPG', 'image/png': 'PNG', 'image/heic': 'HEIC', 'image/heif': 'HEIF', 'image/webp': 'WEBP' };
const editable = (a) => !a || a.verificationStatus === 'draft' || a.verificationStatus === 'more_info';
const dateWords = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '');
const sizeWords = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

let app = null;
let step = 1;
let token = '';
let dirty = false;
const form = {
  discordUsername: '', preferredName: '', legalName: '', email: '', applicantNote: '', needStatement: '',
  discordMember: false, participationRequested: null, photoPublicConsent: false, usernamePublicConsent: false,
  consents: Object.fromEntries(CONSENTS.map(([k]) => [k, false])),
  payment: { method: 'check', accountName: '', address: { line1: '', line2: '', city: '', state: '', zip: '' } },
};

const user = await requireUser();
if (user) start();

async function api(path, { method = 'GET', body, headers = {} } = {}) {
  token = await user.getIdToken();
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { authorization: `Bearer ${token}`, ...(body !== undefined && !(body instanceof Blob) ? { 'content-type': 'application/json' } : {}), ...headers },
      body: body === undefined ? undefined : body instanceof Blob ? body : JSON.stringify(body),
    });
  } catch {
    throw new Error('We could not reach the server. Check your connection and try again. Your answers are still here.');
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(out.error || 'Something went wrong. Try again in a minute. Your answers are still here.');
    err.gaps = out.gaps || [];
    throw err;
  }
  return out;
}

function adopt(a) {
  app = a;
  if (!a) return;
  for (const k of ['discordUsername', 'preferredName', 'legalName', 'email', 'applicantNote', 'needStatement']) form[k] = a[k] || '';
  form.discordMember = a.discordMember === true;
  form.participationRequested = a.participationRequested ?? null;
  form.photoPublicConsent = a.photoPublicConsent === true;
  form.usernamePublicConsent = a.usernamePublicConsent === true;
  form.consents = { ...form.consents, ...(a.consents || {}) };
  if (a.payment) form.payment = { ...form.payment, ...a.payment, address: { ...form.payment.address, ...(a.payment.address || {}) } };
}

async function start() {
  const out = document.getElementById('fund-out');
  if (out) {
    out.hidden = false;
    out.addEventListener('click', async () => {
      await saveQuietly();
      try { await signOut(auth); } catch { /* signed out already */ }
      location.href = '/';
    });
  }
  try {
    const me = await api('/api/fund/me');
    adopt(me.application);
  } catch (err) {
    box.innerHTML = `<div class="fund-error" role="alert">${esc(err.message)} ${helpLine}</div>`;
    return;
  }
  if (app && app.verificationStatus === 'more_info') step = 6;
  else step = Math.min(6, Math.max(1, app?.step || 1));
  if (step === 5 && form.participationRequested === false) step = 6;
  render();
  // Leaving the page saves what is on it, so a phone that sleeps mid-step
  // loses nothing.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveQuietly();
  });
}

function render() {
  if (!editable(app)) renderStatus();
  else renderStep();
}

// ---- the steps ----------------------------------------------------------------

const field = (key, label, { hint = '', optional = false, type = 'text', max = 120, area = false, value } = {}) => `
  <div class="fund-field">
    <label for="f-${key}">${esc(label)}${optional ? ' <span class="fund-req">(optional)</span>' : ''}</label>
    ${hint ? `<p class="fund-hint" id="h-${key}">${hint}</p>` : ''}
    ${area
      ? `<textarea id="f-${key}" data-k="${key}" maxlength="${max}"${hint ? ` aria-describedby="h-${key}"` : ''}>${esc(value ?? form[key])}</textarea>${key === 'needStatement' ? `<p class="fund-hint" data-count="${key}">${max - String(value ?? form[key]).length} characters left</p>` : ''}`
      : `<input type="${type}" id="f-${key}" data-k="${key}" maxlength="${max}" value="${esc(value ?? form[key])}"${hint ? ` aria-describedby="h-${key}"` : ''}${type === 'email' ? ' inputmode="email" autocomplete="email"' : ''}>`}
  </div>`;

const check = (key, label, on) => `
  <label class="fund-check"><input type="checkbox" data-c="${key}"${on ? ' checked' : ''}><span>${esc(label)}</span></label>`;

function filesOf(kind) {
  if (!app) return [];
  if (kind === 'medical') return (app.medicalDocuments || []).filter(Boolean);
  return [kind === 'id' ? app.identityDocument : app.photo].filter(Boolean);
}

function uploader(kind) {
  const files = filesOf(kind);
  const many = kind === 'medical';
  const full = many ? files.length >= MEDICAL_MAX : false;
  const accept = kind === 'photo' ? 'image/*,.heic,.heif' : 'application/pdf,image/*,.heic,.heif';
  return `
    <ul class="fund-files">${files.map((f) => `
      <li class="fund-file"><span class="fund-tick" aria-hidden="true">✓</span>
        <span class="fund-file-text">${esc(f.label)} <span class="fund-dim fund-small">(${TYPE_WORDS[f.type] || 'File'}, ${sizeWords(f.size)}) uploaded</span></span>
        <button type="button" data-remove="${kind}" data-id="${esc(f.id)}">Remove</button></li>`).join('')}
    </ul>
    ${full ? `<p class="fund-hint">That is the most you can add here. Remove one to add another.</p>` : `
    <label class="fund-drop" data-drop="${kind}">
      <input type="file" accept="${accept}" data-file="${kind}"${many ? ' multiple' : ''}>
      <strong>${files.length && !many ? 'Choose a different file' : files.length ? 'Add another file' : 'Choose a file'}</strong>
      <span class="fund-small">${kind === 'photo' ? 'A JPG, PNG, HEIC or WEBP picture, up to 10 MB' : 'A PDF or a photo of the page, up to 25 MB'}</span>
    </label>`}
    <p class="fund-saved" data-upmsg="${kind}" aria-live="polite"></p>`;
}

// Eric, 2026-10-04: "payout should be check only." The step asks for where
// to mail it and nothing else.
function checkFields() {
  const p = form.payment;
  const a = p.address || {};
  return field('accountName', 'Name to make the check out to', { value: p.accountName })
    + field('addr-line1', 'Street address', { value: a.line1 })
    + field('addr-line2', 'Apartment, suite or unit', { value: a.line2, optional: true })
    + field('addr-city', 'City', { value: a.city, max: 80 })
    + `<div class="fund-two">${field('addr-state', 'State', { value: a.state, max: 2, hint: 'Two letters, like ID.' })}${field('addr-zip', 'ZIP code', { value: a.zip, max: 10 })}</div>`;
}

function stepBody(n) {
  if (n === 1) return `
    <p class="fund-dim fund-measure">This takes about ten minutes. Your progress saves each time you tap Continue, so you can stop and come back.</p>
    ${field('discordUsername', 'Discord username', { max: 64, hint: 'Required. Your Discord username, not a display name.' })}
    <p class="fund-hint">You must be a member of our Discord community. Not a member yet? <a href="${DISCORD_INVITE}" target="_blank" rel="noopener">Join the Discord</a> first.</p>
    ${field('preferredName', 'Preferred name', { hint: 'What you would like us to call you.', max: 80 })}
    ${field('legalName', 'Legal name', { hint: 'Your legal name is used privately for verification and is never displayed publicly.' })}
    ${field('email', 'Email address', { optional: true, type: 'email', max: 200, hint: 'Only if you would like us to use a different email from the one you signed in with.' })}`;
  if (n === 2) return `
    <p class="fund-measure">Upload one identity document, such as a driver’s license, a state ID, a passport or other government-issued identification.</p>
    <div class="fund-note">${esc(ID_REDACT)}</div>
    <p class="fund-hint">Leave your full name visible. It must match the name on your medical document.</p>
    ${uploader('id')}`;
  if (n === 3) return `
    <div class="fund-note">${esc(MED_REDACT)}</div>
    <div class="fund-note fund-warn">${esc(DOC_RULE)}</div>
    <p class="fund-measure">Upload at least one document that reasonably shows you are currently affected by a significant medical condition or disability, for example:</p>
    <ul class="fund-dim fund-small">
      <li>Physician/provider letter</li><li>After-visit summary</li><li>Hospital discharge paperwork</li>
      <li>Patient portal document</li><li>Treatment authorization</li>
      <li>Disability-benefit or disability-determination letter</li><li>Other comparable healthcare documentation</li>
    </ul>
    ${uploader('medical')}
    ${field('needStatement', 'In a few sentences, why are you in need?', { area: true, max: NEED_MAX, hint: 'In your own words. You never need to name a diagnosis.' })}
    ${field('applicantNote', NOTE_LABEL, { optional: true, area: true, max: 2000, hint: 'You never need to describe a diagnosis.' })}
    <p class="fund-hint">Your diagnosis, legal name and medical documents will not be made public.</p>`;
  if (n === 4) return `
    ${check('discordMember', 'I am currently a member of the associated Discord community.', form.discordMember)}
    <p class="fund-hint">Only members of our Discord community can take part. Not a member yet? <a href="${DISCORD_INVITE}" target="_blank" rel="noopener">Join the Discord</a>, then come back to this step.</p>
    ${check('usernamePublicConsent', 'I understand that if I am approved, my Discord username will be published in text and video before payout.', form.usernamePublicConsent)}
    <p class="fund-hint">No medical information or legal names are published.</p>
    <fieldset class="fund-field" style="border:0;padding:0;margin:20px 0 0">
      <legend class="fund-label">Would you like to participate as a recipient of community fund distributions?</legend>
      <div class="fund-choices">
        <label class="fund-choice"><input type="radio" name="part" value="yes"${form.participationRequested === true ? ' checked' : ''}>Yes</label>
        <label class="fund-choice"><input type="radio" name="part" value="no"${form.participationRequested === false ? ' checked' : ''}>No</label>
      </div>
      <p class="fund-hint">Only applicants who choose Yes can receive distributions once verified.</p>
    </fieldset>
    <h2>A photo for the GoFundMe page <span class="fund-req">(optional)</span></h2>
    <p class="fund-hint">If you would like, you can add a picture of yourself to be included on the fund’s GoFundMe page, so donors can see some of the people they are helping. You can skip this.</p>
    <p class="fund-hint">Photos are completely optional and will only be posted with your consent. Not submitting one will not affect approval or your share.</p>
    ${uploader('photo')}
    ${filesOf('photo').length ? check('photoPublicConsent', 'I agree this photo may be shown publicly on the community’s GoFundMe page.', form.photoPublicConsent) : ''}`;
  if (n === 5) return `
    <p class="fund-measure">Verified applicants will receive payouts via Mercury Business Check on January 1st, 2027. Where should yours go?</p>
    <p class="fund-note">${esc(CHECK_NOTE)}</p>
    ${checkFields()}
    <div class="fund-note fund-warn">Never enter passwords, PINs, card numbers or bank details. We will never ask for them.</div>
    <p class="fund-hint">Only authorized fund reviewers can see this.</p>`;
  const meds = filesOf('medical').length;
  const a = form.payment.address || {};
  const mailTo = form.payment.accountName && a.line1 ? `Check to ${a.city || 'your address'}` : 'mailing address not added yet';
  return `
    <p class="fund-measure">Here is what you are sending. Tap Edit to change anything.</p>
    <ul class="fund-summary">
      <li><span>Your names and Discord</span><button type="button" data-go="1">Edit</button></li>
      <li><span>ID document${filesOf('id').length ? ' ✓' : ': not added yet'}</span><button type="button" data-go="2">Edit</button></li>
      <li><span>${meds ? `${meds} medical document${meds === 1 ? '' : 's'} ✓` : 'Medical documents: not added yet'}</span><button type="button" data-go="3">Edit</button></li>
      <li><span>Receiving distributions: ${form.participationRequested === true ? 'Yes' : form.participationRequested === false ? 'No' : 'not answered yet'}</span><button type="button" data-go="4">Edit</button></li>
      ${form.participationRequested === true ? `<li><span>Payment: ${esc(mailTo)}</span><button type="button" data-go="5">Edit</button></li>` : ''}
    </ul>
    ${CONSENTS.map(([k, w]) => check(`consent:${k}`, w, form.consents[k])).join('')}`;
}

function renderStep() {
  const more = app?.verificationStatus === 'more_info';
  box.innerHTML = `
    ${more ? `<div class="fund-card">
      <span class="fund-pill attn">More Information Requested</span>
      <p>The reviewer needs a little more before finishing.${app.applicantMessage ? ` Their note: <strong>${esc(app.applicantMessage)}</strong>` : ''}</p>
      <p class="fund-hint">Change anything you need to, then submit again from this last step.</p>
    </div>` : ''}
    <div class="fund-progress">
      <div class="fund-progress-label">Step ${step} of 6</div>
      <div class="fund-progress-bar" role="progressbar" aria-label="Step ${step} of 6" aria-valuemin="1" aria-valuemax="6" aria-valuenow="${step}"><span style="width:${Math.round((step / 6) * 100)}%"></span></div>
    </div>
    <h1>${STEPS[step - 1]}</h1>
    ${stepBody(step)}
    <div class="fund-error" id="fund-error" role="alert" hidden></div>
    <div class="fund-actions">
      ${step > 1 ? '<button type="button" class="fund-btn quiet" id="fund-back">Back</button>' : ''}
      <button type="button" class="fund-btn" id="fund-next">${step === 6 ? 'Submit for Verification' : 'Continue'}</button>
    </div>
    <p class="fund-saved" id="fund-saved" aria-live="polite"></p>`;
  wire();
  window.scrollTo(0, 0);
}

function wire() {
  // A message about what was missing goes as soon as they start fixing it.
  box.addEventListener('input', clearError);
  box.addEventListener('change', clearError);
  box.querySelectorAll('[data-k]').forEach((el) => el.addEventListener('input', () => setField(el)));
  box.querySelectorAll('[data-c]').forEach((el) => el.addEventListener('change', () => {
    const k = el.dataset.c;
    if (k.startsWith('consent:')) form.consents[k.slice(8)] = el.checked;
    else form[k] = el.checked;
    dirty = true;
  }));
  box.querySelectorAll('input[name=part]').forEach((el) => el.addEventListener('change', () => {
    form.participationRequested = el.value === 'yes';
    dirty = true;
  }));
  box.querySelectorAll('[data-file]').forEach((el) => el.addEventListener('change', () => upload(el.dataset.file, [...el.files])));
  box.querySelectorAll('[data-remove]').forEach((el) => el.addEventListener('click', () => removeFile(el.dataset.remove, el.dataset.id, el)));
  box.querySelectorAll('[data-go]').forEach((el) => el.addEventListener('click', () => go(Number(el.dataset.go))));
  box.querySelector('#fund-back')?.addEventListener('click', () => go(prevStep()));
  box.querySelector('#fund-next')?.addEventListener('click', next);
}

/** One keystroke into `form`, wherever that field lives. */
function setField(el) {
  const k = el.dataset.k;
  if (k.startsWith('addr-')) form.payment.address[k.slice(5)] = el.value;
  else if (k === 'accountName') form.payment.accountName = el.value;
  else form[k] = el.value;
  const count = box.querySelector(`[data-count="${k}"]`);
  if (count) count.textContent = `${Number(el.maxLength) - el.value.length} characters left`;
  dirty = true;
}

const prevStep = () => (step === 6 && form.participationRequested === false ? 4 : step - 1);
const nextStep = () => (step === 4 && form.participationRequested === false ? 6 : step + 1);

function clearError() {
  const el = box.querySelector('#fund-error');
  if (el && !el.hidden) { el.hidden = true; el.innerHTML = ''; }
}

function showError(message, { help = false } = {}) {
  const el = box.querySelector('#fund-error');
  if (!el) return;
  el.innerHTML = `${esc(message)}${help ? ` ${helpLine}` : ''}`;
  el.hidden = false;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** What this step still needs, in the Worker's own words. '' when complete. */
function gapOf(n) {
  if (n === 1) {
    if (!form.discordUsername.trim()) return ['Add your Discord username.', 'discordUsername'];
    if (!form.preferredName.trim()) return ['Add the name you would like us to use.', 'preferredName'];
    if (!form.legalName.trim()) return ['Add your legal name.', 'legalName'];
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return ['That email address does not look complete.', 'email'];
  }
  if (n === 2 && !filesOf('id').length) return ['Upload one identification document.'];
  if (n === 3 && !filesOf('medical').length) return ['Upload at least one document that shows eligibility.'];
  if (n === 3 && !form.needStatement.trim()) return ['Tell us briefly why you are in need.', 'needStatement'];
  if (n === 4) {
    if (!form.discordMember) return ['Confirm that you are a member of the Discord community.'];
    if (!form.usernamePublicConsent) return ['Tick the box that says your Discord username will be published if you are approved.'];
    if (form.participationRequested === null) return ['Answer whether you would like to receive distributions.'];
    if (filesOf('photo').length && !form.photoPublicConsent) return ['Tick the box that lets the photo be shown on the GoFundMe page, or remove the photo.'];
  }
  if (n === 5) {
    const p = form.payment;
    const a = p.address;
    if (!p.accountName.trim()) return ['Add the name the check should be made out to.', 'accountName'];
    if (!a.line1.trim()) return ['Add the street address the check should be mailed to.', 'addr-line1'];
    if (!a.city.trim()) return ['Add the city.', 'addr-city'];
    if (!/^[A-Za-z]{2}$/.test(a.state.trim())) return ['Add the two-letter state, like ID.', 'addr-state'];
    if (!/^\d{5}(-\d{4})?$/.test(a.zip.trim())) return ['Add the five-digit ZIP code.', 'addr-zip'];
  }
  if (n === 6 && !CONSENTS.every(([k]) => form.consents[k])) return ['Tick all five statements.'];
  return '';
}

function draftBody(nextAt) {
  const body = {
    discordUsername: form.discordUsername, preferredName: form.preferredName, legalName: form.legalName,
    email: form.email, applicantNote: form.applicantNote, needStatement: form.needStatement, discordMember: form.discordMember,
    participationRequested: form.participationRequested, photoPublicConsent: form.photoPublicConsent,
    usernamePublicConsent: form.usernamePublicConsent, consents: form.consents, step: nextAt,
  };
  const p = form.payment;
  if (p.accountName || Object.values(p.address).some((v) => String(v || '').trim())) body.payment = { method: 'check', accountName: p.accountName, address: p.address };
  return body;
}

async function save(nextAt) {
  const out = await api('/api/fund/draft', { method: 'POST', body: draftBody(nextAt) });
  // Only what the server owns comes back into the page: the files and the
  // status. What they typed stays exactly as they typed it.
  const typed = JSON.parse(JSON.stringify(form));
  adopt(out.application);
  Object.assign(form, typed);
  dirty = false;
}

async function saveQuietly() {
  if (!dirty || !editable(app) || !token) return;
  try {
    await fetch('/api/fund/draft', {
      method: 'POST', keepalive: true,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(draftBody(step)),
    });
    dirty = false;
  } catch { /* the next Continue saves it */ }
}

async function go(n) {
  if (dirty) saveQuietly();
  step = Math.min(6, Math.max(1, n));
  renderStep();
}

async function next() {
  const btn = box.querySelector('#fund-next');
  const gap = gapOf(step);
  if (gap) {
    showError(gap[0]);
    if (gap[1]) box.querySelector(`#f-${gap[1]}`)?.focus();
    return;
  }
  btn.disabled = true;
  const said = box.querySelector('#fund-saved');
  try {
    if (step < 6) {
      if (said) said.textContent = 'Saving…';
      const to = nextStep();
      await save(to);
      step = to;
      renderStep();
      const s = box.querySelector('#fund-saved');
      if (s) s.textContent = 'Saved. You can stop here and come back any time.';
      return;
    }
    if (said) said.textContent = 'Sending…';
    await save(6);
    const out = await api('/api/fund/submit', { method: 'POST', body: {} });
    adopt(out.application);
    renderStatus();
  } catch (err) {
    btn.disabled = false;
    if (said) said.textContent = '';
    showError(err.message, { help: true });
    const at = err.gaps?.[0]?.step;
    if (at && at !== step) {
      const el = box.querySelector('#fund-error');
      el.insertAdjacentHTML('beforeend', ` <button type="button" class="fund-btn quiet" data-jump="${at}" style="margin-top:10px">Go to Step ${at}</button>`);
      el.querySelector('[data-jump]').addEventListener('click', () => go(at));
    }
  }
}

function typeOf(file) {
  if (file.type && TYPE_WORDS[file.type]) return file.type;
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  return EXT_TYPES[ext] || file.type || '';
}

async function upload(kind, files) {
  if (!files.length) return;
  const msg = () => box.querySelector(`[data-upmsg="${kind}"]`);
  const drop = box.querySelector(`[data-drop="${kind}"]`);
  const room = kind === 'medical' ? MEDICAL_MAX - filesOf('medical').length : 1;
  const list = files.slice(0, Math.max(0, room));
  const max = kind === 'photo' ? PHOTO_MAX : DOC_MAX;
  drop?.classList.add('busy');
  let done = 0;
  for (const file of list) {
    if (msg()) msg().textContent = list.length > 1 ? `Uploading ${done + 1} of ${list.length}…` : 'Uploading…';
    if (file.size > max) {
      showError(`That file is over ${kind === 'photo' ? '10' : '25'} MB. Try a smaller copy or a photo of the page.`, { help: true });
      break;
    }
    try {
      const out = await api(`/api/fund/upload?kind=${kind}`, { method: 'POST', body: file, headers: { 'content-type': typeOf(file) } });
      const typed = JSON.parse(JSON.stringify(form));
      adopt(out.application);
      Object.assign(form, typed);
      done++;
    } catch (err) {
      renderStep();
      showError(err.message, { help: true });
      return;
    }
  }
  renderStep();
  if (done && msg()) msg().textContent = done > 1 ? `✓ ${done} files uploaded.` : '✓ Uploaded.';
  if (files.length > list.length) showError(`You can add up to ${MEDICAL_MAX} documents here. The extra ${files.length - list.length === 1 ? 'file was' : 'files were'} not added.`);
}

async function removeFile(kind, id, btn) {
  btn.disabled = true;
  try {
    const out = await api('/api/fund/remove', { method: 'POST', body: { kind, id } });
    const typed = JSON.parse(JSON.stringify(form));
    adopt(out.application);
    Object.assign(form, typed);
    if (kind === 'photo') form.photoPublicConsent = false;
    renderStep();
    const m = box.querySelector(`[data-upmsg="${kind}"]`);
    if (m) m.textContent = 'Removed.';
  } catch (err) {
    btn.disabled = false;
    showError(err.message, { help: true });
  }
}

// ---- the status page ----------------------------------------------------------

function renderStatus() {
  const s = app.verificationStatus;
  const pill = `<span class="fund-pill${s === 'not_verified' ? ' attn' : s === 'inactive' ? ' quiet' : ''}">${STATUS_WORDS[s] || 'Submitted'}</span>`;
  let body = '';
  if (s === 'submitted') body = `
    <h1>Thank you. Your application is in.</h1>
    <p class="fund-measure">It is waiting for a reviewer. There is nothing else you need to do right now. We will email you when there is an update.</p>
    ${app.submittedAt ? `<dl class="fund-facts"><dt>Submitted</dt><dd>${dateWords(app.submittedAt)}</dd></dl>` : ''}`;
  if (s === 'under_review') body = `
    <h1>A reviewer is looking at your application.</h1>
    <p class="fund-measure">There is nothing you need to do right now. We will email you when there is an update.</p>`;
  if (s === 'verified') body = `
    <h1>You are a verified participant.</h1>
    <dl class="fund-facts">
      <dt>Verification date</dt><dd>${dateWords(app.verifiedAt)}</dd>
      <dt>Participation</dt><dd>${app.participationActive ? 'Active: receiving distributions' : 'Not receiving distributions'}</dd>
      ${app.reverificationDueAt ? `<dt>Next reverification</dt><dd>${dateWords(app.reverificationDueAt)}</dd>` : ''}
    </dl>
    <p class="fund-hint" style="margin-top:14px">Verification confirms eligibility only. It is not a medical opinion.</p>`;
  // Eric, 2026-10-04: "I will update the amount in the donation pool weekly
  // so each participant can see their active share." Then, the same day:
  // "monthly payout distributions. With first payout November 1." And:
  // "Every Friday, I'll post in Discord: Number of approved recipients, Net
  // GoFundMe proceeds so far, Zazzle creator earnings being added, Combined
  // total in the fund", with "a running total of your payout" on their phone.
  // The payout is one check, on January 1, 2027 ("Not monthly").
  const next = nextPayout();
  const nextLine = next ? `<dt>Payout date</dt><dd>${esc(payoutWords(next))}</dd>` : '';
  const chase = next ? `<p class="fund-hint">${esc(chaseLine(next.at))}</p>` : '';
  const pl = app.pool;
  const share = s === 'verified' && app.participationActive ? (pl ? `
    <div class="fund-card fund-share">
      <h2>The fund so far</h2>
      <dl class="fund-facts">
        <dt>Net GoFundMe proceeds so far</dt><dd>${dollars(pl.gofundmeCents)}</dd>
        <dt>Zazzle creator earnings being added</dt><dd>${dollars(pl.zazzleCents)}</dd>
        <dt>Combined total in the fund</dt><dd>${dollars(pl.totalCents)}</dd>
        <dt>Approved recipients</dt><dd>${esc(pl.activeCount)}</dd>
        <dt>Your share so far</dt><dd>${dollars(pl.shareCents)}</dd>
        ${pl.sentCents ? `<dt>Sent to you so far</dt><dd>${dollars(pl.sentCents)}</dd>` : ''}
        ${nextLine}
      </dl>
      ${chase}
      <p class="fund-hint" style="margin-top:12px">Updated ${dateWords(pl.asOf)}, and every Friday. The fund is shared equally among every approved recipient.</p>
    </div>` : `
    <div class="fund-card fund-share"><h2>The fund so far</h2>${nextLine ? `<dl class="fund-facts">${nextLine}</dl>` : ''}${chase}<p class="fund-hint">The fund's totals and your share so far show here once they are posted. They are updated every Friday.</p></div>`) : '';
  const sent = (app.payouts || []).length ? `
    <div class="fund-card">
      <h2>Sent to you</h2>
      <ul class="fund-sent">${app.payouts.map((x) => `
        <li><strong>${dollars(x.amountCents)}</strong> check mailed ${dateWords(x.at)}<br><span class="fund-dim fund-small">Check #${esc(x.ref)}. ${esc(CHECK_NOTE)}${Date.now() - new Date(x.at).getTime() < 20 * 86_400_000 ? ` ${esc(chaseLine(x.at))}` : ''}</span></li>`).join('')}
      </ul>
    </div>` : '';
  if (s === 'not_verified') body = `
    <h1>Your application was not verified.</h1>
    ${app.applicantMessage ? `<p class="fund-measure">The reviewer’s note: <strong>${esc(app.applicantMessage)}</strong></p>` : ''}
    <p class="fund-measure">If you have questions, email <a href="mailto:${HELP}">${HELP}</a>.</p>`;
  if (s === 'inactive') body = `
    <h1>Your participation is currently inactive.</h1>
    ${app.verifiedAt ? `<dl class="fund-facts"><dt>Last verified</dt><dd>${dateWords(app.verifiedAt)}</dd></dl>` : ''}
    <p class="fund-measure">If you have questions, email <a href="mailto:${HELP}">${HELP}</a>.</p>`;
  box.innerHTML = `<div class="fund-card">${pill}${body}</div>${share || ''}${sent || ''}${s === 'not_verified' ? '' : notifyCard()}`;
  wireNotify();
  window.scrollTo(0, 0);
}

// ---- updates on their phone -----------------------------------------------------
// Eric, 2026-10-04: "There should still be instructions for how to add to
// Home Screen, and they will receive notifications about their verification
// status, weekly donation pool total and their split, and any marks that
// they've been sent their money." The totals are posted every Friday. On iPhone a notification needs the Home
// Screen icon, so the steps come first; whoever never turns them on gets the
// same news by email.

const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent || '');

function notifyCard() {
  const on = typeof Notification !== 'undefined' && Notification.permission === 'granted';
  const canAsk = pushSupported() && !on && (typeof Notification === 'undefined' || Notification.permission !== 'denied');
  return `
    <div class="fund-card fund-notify">
      <h2>Get updates on your phone</h2>
      <p class="fund-hint">Your verification status, the fund's totals and your share so far each Friday, and a note when your check is mailed, with its check number.</p>
      ${pushInstalled() ? '' : `
      <p class="fund-label">Add this page to your Home Screen</p>
      <p class="fund-small"><strong>iPhone:</strong> open this page in Safari, tap Share (the square with an arrow), then <strong>Add to Home Screen</strong>, and open it from the new icon.</p>
      <p class="fund-small"><strong>Android:</strong> open this page in Chrome, tap the three-dot menu, then <strong>Add to Home screen</strong>.</p>
      <p class="fund-hint">Adding it to your Home Screen asks you to sign in once more. That only happens the first time.</p>`}
      ${on ? '<p class="fund-saved">\u2713 Notifications are on for this device.</p>'
        : canAsk ? '<button type="button" class="fund-btn" id="fund-push">Turn on notifications</button><p class="fund-saved" id="fund-push-said"></p>'
          : `<p class="fund-hint">${isIOS() && !pushInstalled() ? 'Open it from your Home Screen icon to turn on notifications.' : 'This browser cannot show notifications.'}</p>`}
      <p class="fund-hint">Without notifications, the same updates come to your email.</p>
    </div>`;
}

function wireNotify() {
  const btn = box.querySelector('#fund-push');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    const said = box.querySelector('#fund-push-said');
    const out = await enablePush(user);
    if (out.ok) { btn.remove(); if (said) said.textContent = '\u2713 Notifications are on for this device.'; }
    else { btn.disabled = false; if (said) said.textContent = out.error; }
  });
}
