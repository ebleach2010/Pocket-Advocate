// The Community Assistance Fund's rules (2026-10-04): what an application
// may hold, what each status allows, what the applicant and the reviewer
// each get to see. No reading, no writing and no network here: the Worker
// (worker/fund.js) does the storing and the deciding with these, and the
// demo mirrors the routes with the very same functions, so the two cannot
// drift apart. Served like any other module, so nothing in it is secret.

export const FUND_STATUSES = ['draft', 'submitted', 'under_review', 'more_info', 'verified', 'not_verified', 'inactive'];
// The applicant can change what they sent only while it is theirs to change.
export const EDITABLE = new Set(['draft', 'more_info']);
// Eric, 2026-10-04: "payout should be check only." Mailed to the address they
// give: "No tracking number. Payout via check will come from Mercury banking
// and take 7-10 business days to arrive."
export const PAYMENT_METHODS = ['check'];
export const CHECK_ONLY_REFUSAL = 'Distributions are mailed by check only.';
export const CHECK_NOTE = 'Checks are sent from Mercury and take 7 to 10 business days to arrive.';
// Eric, 2026-10-04: "Fundraiser runs through Christmas Eve with monthly payout
// distributions. With first payout November 1." Then, the same day:
// "Verified applicants will receive monthly payouts via Mercury Business Check
// on January 1st, 2027. Not monthly." So one payout, January 1, 2027, carrying
// everything that came in through Christmas Eve. The date counts until
// midnight Mountain that morning (MST, 07:00 UTC).
export const PAYOUTS = [
  { date: '2027-01-01', at: Date.UTC(2027, 0, 1, 7) },
];
export const nextPayout = (now = Date.now()) => PAYOUTS.find((p) => now < p.at) || null;
export const payoutWords = (p) => (p ? new Date(`${p.date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '');
// Eric, 2026-10-04: "If you do not receive your check by the 10th of November,
// please email me." Each month the same: the 10th after a check mailed in the
// first days of the month, otherwise the 10th of the month after, in
// Mountain time.
export function chaseLine(at) {
  const t = new Date(at);
  if (!Number.isFinite(t.getTime())) return '';
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', year: 'numeric', month: 'numeric', day: 'numeric' })
    .formatToParts(t).map((x) => [x.type, Number(x.value)]));
  const m = parts.day <= 5 ? parts.month : (parts.month % 12) + 1;
  const name = new Date(Date.UTC(2026, m - 1, 10)).toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' });
  return `If you do not receive your check by ${name} 10, please email office@pocketadvocacy.com.`;
}

// The fund's totals (Eric, 2026-10-04: "Every Friday, I'll post in Discord:
// Number of approved recipients, Net GoFundMe proceeds so far, Zazzle creator
// earnings being added, Combined total in the fund"). Both amounts are totals
// so far, never one week's; the combined total is their sum. A pool posted
// before these two existed reads as GoFundMe alone.
export const TOTALS_LIMIT = 100_000_000;
export function fundTotals(p) {
  if (!p) return null;
  const gofundmeCents = Number.isInteger(p.gofundmeCents) ? p.gofundmeCents : (Number(p.totalCents) || 0);
  const zazzleCents = Number.isInteger(p.zazzleCents) ? p.zazzleCents : 0;
  return { gofundmeCents, zazzleCents, totalCents: gofundmeCents + zazzleCents };
}
/** What has been mailed to one participant, and what their share so far still owes them. */
export function sentAndOwed(payouts, shareCents) {
  const sentCents = (Array.isArray(payouts) ? payouts : []).reduce((n, x) => n + (Number(x?.amountCents) || 0), 0);
  return { sentCents, owedCents: Math.max(0, (Number(shareCents) || 0) - sentCents) };
}
// Eric, 2026-10-04: "They must be a discord member."
export const DISCORD_INVITE = 'https://discord.gg/YZXYQFjUGa';
// Eric, 2026-10-04: "a short blurb from them for why they are in need. Max 1500 characters."
export const NEED_MAX = 1500;
export const CONSENT_KEYS = ['accurate', 'noGuarantee', 'notMedical', 'reviewerView', 'formula'];
export const SELF_VERIFY_REFUSAL = 'Your verification must be completed by another authorized reviewer.';
// Eric, 2026-10-04: reverification "Every 6 months".
export const REVERIFY_MONTHS = 6;
export const DOC_MAX_BYTES = 25 * 1024 * 1024;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const MEDICAL_MAX_COUNT = 5;

export const DOC_TYPES = {
  'application/pdf': 'pdf', 'image/jpeg': 'jpg', 'image/png': 'png',
  'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp',
};
export const PHOTO_TYPES = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/heic': 'heic', 'image/heif': 'heif', 'image/webp': 'webp',
};
export const KINDS = { id: 'identity', medical: 'medical', photo: 'photo' };

// What the applicant's own words may be. Lengths are generous for the person
// and small for the database.
export const TEXT_LIMITS = {
  discordUsername: 64, preferredName: 80, legalName: 120, email: 200, applicantNote: 2000, needStatement: NEED_MAX,
};
export const PAYMENT_LIMITS = { accountName: 120 };
export const ADDRESS_LIMITS = { line1: 120, line2: 120, city: 80, state: 2, zip: 10 };

/** Six months on, same day of the month where the month has it. */
export function addMonths(date, months) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let n = Number(digits[digits.length - 1 - i]);
    if (i % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

/**
 * True when a check field holds something we must never keep: a card
 * number or a password. A street address is numbers and words by nature (a
 * ZIP+4, a "Pin Oak Drive"), so nothing else in it is refused; a name gets
 * the account-number words and long runs of digits refused as well.
 */
export function looksSensitive(value, { address = false } = {}) {
  const s = String(value || '');
  if (/\b(pass ?word|passcode)\b/i.test(s)) return true;
  if ((s.match(/\d[\d\s-]{11,}\d/g) || []).some((run) => { const d = run.replace(/\D/g, ''); return d.length >= 13 && d.length <= 19 && luhn(d); })) return true;
  if (address) return false;
  if (/\b(pin|ssn|social security|routing|account (?:number|no\.?|#))\b/i.test(s)) return true;
  return (s.match(/\d[\d\s().+-]{6,}\d/g) || []).some((run) => run.replace(/\D/g, '').length >= 8);
}

export const SENSITIVE_REFUSAL = 'Please leave out passwords, PINs, card numbers and bank account or routing numbers. We only need the name and address for the check.';

/** The check details as stored, or an error sentence. Nothing but a check. */
export function cleanPayment(raw) {
  if (raw?.method && raw.method !== 'check') return { error: CHECK_ONLY_REFUSAL };
  const a = raw?.address || {};
  const out = {
    method: 'check',
    accountName: clean(raw?.accountName, PAYMENT_LIMITS.accountName),
    address: Object.fromEntries(Object.entries(ADDRESS_LIMITS).map(([k, max]) => [k, clean(a[k], max)])),
  };
  out.address.state = out.address.state.toUpperCase();
  if (looksSensitive(out.accountName) || Object.values(out.address).some((v) => looksSensitive(v, { address: true }))) return { error: SENSITIVE_REFUSAL };
  return { payment: out };
}

/** What a complete check answer needs. '' when complete. */
export function paymentGap(p) {
  if (p?.method !== 'check') return 'Add the name and mailing address for your check.';
  const a = p.address || {};
  if (!p.accountName) return 'Add the name the check should be made out to.';
  if (!a.line1 || !a.city) return 'Add the street address and city the check should be mailed to.';
  if (!/^[A-Z]{2}$/.test(a.state || '')) return 'Add the two-letter state, like ID.';
  if (!/^\d{5}(-\d{4})?$/.test(a.zip || '')) return 'Add the five-digit ZIP code.';
  return '';
}

/** The applicant's own fields from a draft body, cleaned. Unknown keys are dropped. */
export function cleanDraft(body) {
  const out = {};
  for (const [k, max] of Object.entries(TEXT_LIMITS))
    if (k in (body || {})) out[k] = clean(body[k], max);
  if ('email' in out && out.email && !EMAIL_RE.test(out.email)) return { error: 'That email address does not look complete.' };
  if ('discordMember' in (body || {})) out.discordMember = body.discordMember === true;
  if ('participationRequested' in (body || {}))
    out.participationRequested = body.participationRequested === true ? true : body.participationRequested === false ? false : null;
  if ('photoPublicConsent' in (body || {})) out.photoPublicConsent = body.photoPublicConsent === true;
  if (body?.consents && typeof body.consents === 'object') {
    out.consents = {};
    for (const k of CONSENT_KEYS) out.consents[k] = body.consents[k] === true;
  }
  if ('step' in (body || {})) {
    const n = Number(body.step);
    out.step = Number.isInteger(n) && n >= 1 && n <= 6 ? n : 1;
  }
  return { draft: out };
}

/** Every reason an application cannot be submitted yet, in the order of the steps. */
export function submitGaps(app, payment) {
  const gaps = [];
  if (!app?.discordUsername) gaps.push({ step: 1, why: 'Add your Discord username or display name.' });
  if (!app?.preferredName) gaps.push({ step: 1, why: 'Add the name you would like us to use.' });
  if (!app?.legalName) gaps.push({ step: 1, why: 'Add your legal name.' });
  if (!app?.identityDocument?.id) gaps.push({ step: 2, why: 'Upload one identification document.' });
  if (!(Array.isArray(app?.medicalDocuments) && app.medicalDocuments.length)) gaps.push({ step: 3, why: 'Upload at least one document that shows eligibility.' });
  if (!String(app?.needStatement || '').trim()) gaps.push({ step: 3, why: 'Tell us briefly why you are in need.' });
  if (app?.discordMember !== true) gaps.push({ step: 4, why: 'Confirm that you are a member of the Discord community.' });
  if (app?.participationRequested !== true && app?.participationRequested !== false) gaps.push({ step: 4, why: 'Answer whether you would like to receive distributions.' });
  if (app?.photo?.id && app?.photoPublicConsent !== true) gaps.push({ step: 4, why: 'Tick the box that lets the photo be shown on the GoFundMe page, or remove the photo.' });
  if (app?.participationRequested === true) {
    const gap = paymentGap(payment);
    if (gap) gaps.push({ step: 5, why: gap });
  }
  if (!CONSENT_KEYS.every((k) => app?.consents?.[k] === true)) gaps.push({ step: 6, why: 'Tick all five statements.' });
  return gaps;
}

const refOut = (r, i, label) => (r?.id ? { id: r.id, type: r.type, size: r.size, uploadedAt: r.uploadedAt || null, label: i == null ? label : `${label} ${i + 1}` } : null);

/** What the applicant sees of their own application: never the reviewer's side. */
export function applicantView(app, payment) {
  if (!app) return null;
  const status = FUND_STATUSES.includes(app.verificationStatus) ? app.verificationStatus : 'draft';
  return {
    verificationStatus: status,
    step: app.step || 1,
    discordUsername: app.discordUsername || '',
    preferredName: app.preferredName || '',
    legalName: app.legalName || '',
    email: app.email || '',
    applicantNote: app.applicantNote || '',
    needStatement: app.needStatement || '',
    discordMember: app.discordMember === true,
    participationRequested: app.participationRequested ?? null,
    participationActive: app.participationActive === true,
    photoPublicConsent: app.photoPublicConsent === true,
    consents: Object.fromEntries(CONSENT_KEYS.map((k) => [k, app.consents?.[k] === true])),
    identityDocument: refOut(app.identityDocument, null, 'ID document'),
    medicalDocuments: (Array.isArray(app.medicalDocuments) ? app.medicalDocuments : []).map((r, i) => refOut(r, i, 'Medical document')),
    photo: refOut(app.photo, null, 'Photo'),
    submittedAt: app.submittedAt || null,
    verifiedAt: status === 'verified' || status === 'inactive' ? app.verifiedAt || null : null,
    reverificationDueAt: status === 'verified' ? app.reverificationDueAt || null : null,
    // The reviewer's message reaches them only where it asks something of
    // them or explains a decision. The internal note never does.
    applicantMessage: status === 'more_info' || status === 'not_verified' ? app.applicantMessage || '' : '',
    payment: payment ? { method: payment.method || null, accountName: payment.accountName || '', address: payment.address || null } : null,
    // What was sent to them and how, newest first; never who marked it.
    payouts: (Array.isArray(app.payouts) ? app.payouts : []).map((x) => ({ at: x.at, amountCents: x.amountCents, method: x.method, ref: x.ref })).reverse(),
  };
}

/**
 * Who shares the pool: verified, taking part, and not a reviewer. Eric,
 * 2026-10-04: "I will not be included in the payout. I only organize."
 */
export const isActiveParticipant = (uid, app, reviewerUids = []) =>
  app?.verificationStatus === 'verified' && app?.participationActive === true && !reviewerUids.includes(uid);

/** An equal share in whole cents. The remainder stays in the pool. */
export const shareOf = (totalCents, count) => (count > 0 && totalCents > 0 ? Math.floor(totalCents / count) : 0);

export const dollars = (cents) => `$${(Math.max(0, Number(cents) || 0) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const METHOD_WORDS = { check: 'check' };

/** One line for where a check goes: the name and the mailing address. */
export function checkTo(p) {
  if (p?.method !== 'check') return 'no mailing address yet';
  const a = p.address || {};
  return `Check to ${p.accountName}, ${[a.line1, a.line2].filter(Boolean).join(', ')}, ${a.city}, ${a.state} ${a.zip}`;
}

/** What the reviewer sees: everything but storage paths. */
export function reviewerView(uid, app, payment) {
  const base = applicantView(app, payment);
  return {
    ...base,
    uid,
    verifiedAt: app.verifiedAt || null,
    reverificationDueAt: app.reverificationDueAt || null,
    reviewedAt: app.reviewedAt || null,
    reviewerId: app.reviewerId || null,
    applicantMessage: app.applicantMessage || '',
    internalReviewerNote: app.internalReviewerNote || '',
    photoConsentAt: app.photoConsentAt || null,
    createdAt: app.createdAt || null,
    updatedAt: app.updatedAt || null,
    audit: Array.isArray(app.audit) ? app.audit : [],
  };
}

/** The bytes are what they say they are, or the upload is refused. */
export function sniff(bytes, type) {
  const b = new Uint8Array(bytes.slice(0, 16));
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (type === 'application/pdf') return ascii(0, 5) === '%PDF-';
  if (type === 'image/jpeg') return b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF;
  if (type === 'image/png') return b[0] === 0x89 && ascii(1, 4) === 'PNG';
  if (type === 'image/webp') return ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP';
  if (type === 'image/heic' || type === 'image/heif') return ascii(4, 8) === 'ftyp';
  return false;
}

export const ACTIONS = new Set(['verify', 'reverify', 'request_info', 'decline', 'inactive', 'note']);
export const ACT_FROM = {
  verify: new Set(['submitted', 'under_review', 'more_info', 'not_verified', 'inactive']),
  reverify: new Set(['verified', 'inactive']),
  request_info: new Set(['submitted', 'under_review', 'verified', 'inactive']),
  decline: new Set(['submitted', 'under_review', 'more_info']),
  inactive: new Set(['verified']),
};
export const ACT_TO = { verify: 'verified', reverify: 'verified', request_info: 'more_info', decline: 'not_verified', inactive: 'inactive' };

