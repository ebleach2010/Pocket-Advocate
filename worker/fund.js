// The Community Assistance Fund's verification (Eric, 2026-10-04).
//
// A member of the community who is living with significant illness or
// disability applies to become a verified participant in the fund. Eric's
// brief, condensed: verification protects members and donors while asking for
// as little sensitive information as possible. It confirms eligibility only.
// It never ranks severity, never asks for a diagnosis, never decides who is
// "sick enough", and never promises an amount.
//
// Everything here is Worker-only, by construction rather than by rule:
//
//   fundApplications/{uid}   one application per account, the doc id is the
//                            uid off the verified sign-in token and never a
//                            value the browser sends. The closing deny-all in
//                            firestore.rules keeps browsers out of it.
//   fundPayments/{uid}       how a distribution would reach them, kept apart
//                            from the application so the two can be removed
//                            or minimized separately.
//   fund/{uid}/{id|medical|photo}/{random}.{ext} in Storage, which browsers
//                            cannot reach (storage.rules opens cases/** only).
//                            The original file name is never kept anywhere: a
//                            name like "lupus-labs.pdf" says what the document
//                            was meant to keep private. A document is shown as
//                            "Medical document 1 (PDF, 1.2 MB)".
//
// Nothing from an application reaches a log, a diagnostic, an error message,
// a URL or a notification. The reviewer's push is generic; an applicant's
// email says only that there is an update and where to sign in.
//
// Reviewers: Eric alone for now (2026-10-04: a second reviewer, "Nobody yet").
// isFundReviewer is the one place to widen. An applicant can never verify
// their own application, and that is refused here, not just greyed out on the
// page: "Your verification must be completed by another authorized reviewer."

import { getDoc, patchDoc, deleteDoc, listDocs } from './firestore.js';
import { putFile, deleteFile, mediaFetch } from './storage.js';
import { notifyUser } from './push.js';
import { sendEmail } from './email.js';
import { requireUser } from './firebase-auth.js';
import {
  EDITABLE, KINDS, DOC_TYPES, PHOTO_TYPES, DOC_MAX_BYTES, PHOTO_MAX_BYTES, MEDICAL_MAX_COUNT, CONSENT_KEYS,
  FUND_STATUSES, SELF_VERIFY_REFUSAL, REVERIFY_MONTHS, ACTIONS, ACT_FROM, ACT_TO,
  addMonths, clean, cleanDraft, cleanPayment, submitGaps, applicantView, reviewerView, sniff,
} from '../public/js/fund-rules.js';

const AUDIT_MAX = 200;
// A second reviewer's uid goes here once there is one.
export const FUND_REVIEWER_UIDS = [];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' },
});

/** The first and only door to the reviewer side. Widen it here. */
export async function isFundReviewer(env, uid) {
  if (!uid) return false;
  if (FUND_REVIEWER_UIDS.includes(uid)) return true;
  if (env.ADMIN_UID && uid !== env.ADMIN_UID) return false;
  const profile = await getDoc(env, `users/${uid}`).catch(() => null);
  return profile?.data?.role === 'admin';
}

const auditRow = (by, act, from, to, msg) => ({ at: new Date(), by, act, ...(from !== undefined ? { from } : {}), ...(to !== undefined ? { to } : {}), ...(msg ? { msg } : {}) });
const withAudit = (app, ...rows) => [...(Array.isArray(app?.audit) ? app.audit : []), ...rows].slice(-AUDIT_MAX);

/**
 * Read, change, write under the document's own update time, so two uploads
 * at once (two medical documents picked together) never lose one. `fn` gets
 * the current data (or null) and answers { patch, mask } or { error, status }.
 */
async function mutate(env, path, fn) {
  for (let tries = 0; tries < 4; tries++) {
    const cur = await getDoc(env, path);
    const out = await fn(cur?.data || null);
    if (out.error) return out;
    const ok = await patchDoc(env, path, out.patch, cur
      ? { mask: out.mask || Object.keys(out.patch), ifUpdateTime: cur.updateTime }
      : { mustNotExist: true });
    if (ok) return { ...out, data: { ...(cur?.data || {}), ...out.patch } };
  }
  return { error: 'Someone else changed this at the same moment. Try again.', status: 409 };
}

const freshApp = (uid, email) => ({
  userId: uid, verificationStatus: 'draft', step: 1, accountEmail: email || null,
  createdAt: new Date(), updatedAt: new Date(), audit: [auditRow(uid, 'started')],
});

function randomId() {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

// ---- the applicant ------------------------------------------------------------

async function handleMe(env, user) {
  const [app, pay] = await Promise.all([
    getDoc(env, `fundApplications/${user.uid}`),
    getDoc(env, `fundPayments/${user.uid}`),
  ]);
  return json({ application: applicantView(app?.data || null, pay?.data || null) });
}

async function handleDraft(request, env, user) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return json({ error: 'Nothing to save.' }, 400);
  const { draft, error } = cleanDraft(body);
  if (error) return json({ error }, 400);
  let payment = null;
  if (body.payment && typeof body.payment === 'object') {
    const p = cleanPayment(body.payment);
    if (p.error) return json({ error: p.error }, 400);
    payment = p.payment;
  }
  const path = `fundApplications/${user.uid}`;
  const out = await mutate(env, path, (cur) => {
    const app = cur || freshApp(user.uid, user.email);
    if (!EDITABLE.has(app.verificationStatus)) return { error: 'This application has been sent for review, so it cannot be changed right now.', status: 409 };
    const patch = { ...(cur ? {} : app), ...draft, updatedAt: new Date() };
    if (draft.photoPublicConsent === true && app.photoPublicConsent !== true) patch.photoConsentAt = new Date();
    if (draft.photoPublicConsent === false) patch.photoConsentAt = null;
    return { patch, mask: cur ? Object.keys(patch) : undefined };
  });
  if (out.error) return json({ error: out.error }, out.status || 400);
  if (payment) {
    await patchDoc(env, `fundPayments/${user.uid}`, { userId: user.uid, ...payment, updatedAt: new Date() });
  }
  const pay = payment || (await getDoc(env, `fundPayments/${user.uid}`))?.data || null;
  return json({ ok: true, application: applicantView(out.data, pay) });
}

async function handleUpload(request, env, url, user) {
  const kind = url.searchParams.get('kind');
  if (!KINDS[kind]) return json({ error: 'Choose what this file is for.' }, 400);
  const types = kind === 'photo' ? PHOTO_TYPES : DOC_TYPES;
  const max = kind === 'photo' ? PHOTO_MAX_BYTES : DOC_MAX_BYTES;
  const capWords = kind === 'photo' ? '10 MB' : '25 MB';
  const type = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!types[type]) {
    return json({ error: kind === 'photo'
      ? 'That file type is not accepted for a photo. Use a JPG, PNG, HEIC or WEBP picture.'
      : 'That file type is not accepted. Use a PDF or a JPG, PNG, HEIC or WEBP picture.' }, 415);
  }
  const declared = Number(request.headers.get('content-length')) || 0;
  if (!declared) return json({ error: 'The file did not arrive. Try it again.' }, 411);
  if (declared > max) return json({ error: `That file is over ${capWords}. Try a smaller copy or a photo of the page.` }, 413);
  // The status is checked before the bytes are read, so a sent application
  // never buffers a file it would refuse.
  const before = await getDoc(env, `fundApplications/${user.uid}`);
  if (before && !EDITABLE.has(before.data.verificationStatus))
    return json({ error: 'This application has been sent for review, so files cannot be added right now.' }, 409);
  if (kind === 'medical' && (before?.data.medicalDocuments || []).length >= MEDICAL_MAX_COUNT)
    return json({ error: `You can add up to ${MEDICAL_MAX_COUNT} documents here. Remove one to add another.` }, 409);
  let bytes;
  try {
    bytes = await request.arrayBuffer();
  } catch {
    return json({ error: 'The file did not finish uploading. Try it again.' }, 400);
  }
  if (!bytes.byteLength) return json({ error: 'That file is empty.' }, 400);
  if (bytes.byteLength > max) return json({ error: `That file is over ${capWords}. Try a smaller copy or a photo of the page.` }, 413);
  if (!sniff(bytes, type)) return json({ error: 'That file could not be read as the type it says it is. Try saving it again as a PDF or a photo.' }, 415);
  const id = randomId();
  const path = `fund/${user.uid}/${kind}/${id}.${types[type]}`;
  let row;
  try {
    row = await putFile(env, path, bytes, type);
  } catch {
    return json({ error: 'The file could not be saved just now. Try again in a minute.' }, 502);
  }
  const ref = { id, type, size: bytes.byteLength, path: row.path, uploadedAt: new Date() };
  let replaced = null;
  const out = await mutate(env, `fundApplications/${user.uid}`, (cur) => {
    const app = cur || freshApp(user.uid, user.email);
    if (!EDITABLE.has(app.verificationStatus)) return { error: 'This application has been sent for review, so files cannot be added right now.', status: 409 };
    const patch = { ...(cur ? {} : app), updatedAt: new Date() };
    if (kind === 'id') { replaced = app.identityDocument || null; patch.identityDocument = ref; }
    if (kind === 'photo') { replaced = app.photo || null; patch.photo = ref; }
    if (kind === 'medical') {
      const list = Array.isArray(app.medicalDocuments) ? app.medicalDocuments : [];
      if (list.length >= MEDICAL_MAX_COUNT) return { error: `You can add up to ${MEDICAL_MAX_COUNT} documents here. Remove one to add another.`, status: 409 };
      patch.medicalDocuments = [...list, ref];
    }
    patch.audit = withAudit(app, auditRow(user.uid, `uploaded-${kind}`));
    return { patch, mask: cur ? Object.keys(patch) : undefined };
  });
  if (out.error) {
    await deleteFile(env, row.path).catch(() => {});
    return json({ error: out.error }, out.status || 400);
  }
  if (replaced?.path) await deleteFile(env, replaced.path).catch(() => {});
  const pay = (await getDoc(env, `fundPayments/${user.uid}`))?.data || null;
  return json({ ok: true, application: applicantView(out.data, pay) });
}

async function handleRemove(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const kind = body?.kind;
  const id = typeof body?.id === 'string' ? body.id : '';
  if (!KINDS[kind] || !/^[0-9a-f]{24}$/.test(id)) return json({ error: 'That file was not found.' }, 400);
  let gone = null;
  const out = await mutate(env, `fundApplications/${user.uid}`, (cur) => {
    if (!cur) return { error: 'That file was not found.', status: 404 };
    if (!EDITABLE.has(cur.verificationStatus)) return { error: 'This application has been sent for review, so files cannot be removed right now.', status: 409 };
    const patch = { updatedAt: new Date() };
    if (kind === 'id' && cur.identityDocument?.id === id) { gone = cur.identityDocument; patch.identityDocument = null; }
    if (kind === 'photo' && cur.photo?.id === id) { gone = cur.photo; patch.photo = null; patch.photoPublicConsent = false; patch.photoConsentAt = null; }
    if (kind === 'medical') {
      const list = Array.isArray(cur.medicalDocuments) ? cur.medicalDocuments : [];
      gone = list.find((r) => r.id === id) || null;
      if (gone) patch.medicalDocuments = list.filter((r) => r.id !== id);
    }
    if (!gone) return { error: 'That file was not found.', status: 404 };
    patch.audit = withAudit(cur, auditRow(user.uid, `removed-${kind}`));
    return { patch };
  });
  if (out.error) return json({ error: out.error }, out.status || 400);
  if (gone?.path) await deleteFile(env, gone.path).catch(() => {});
  const pay = (await getDoc(env, `fundPayments/${user.uid}`))?.data || null;
  return json({ ok: true, application: applicantView(out.data, pay) });
}

async function handleSubmit(env, user, ctx) {
  const pay = (await getDoc(env, `fundPayments/${user.uid}`))?.data || null;
  let wasResubmit = false;
  const out = await mutate(env, `fundApplications/${user.uid}`, (cur) => {
    if (!cur) return { error: 'Start the application first.', status: 404 };
    if (!EDITABLE.has(cur.verificationStatus)) return { error: 'This application has already been sent for review.', status: 409 };
    const gaps = submitGaps(cur, pay);
    if (gaps.length) return { error: gaps[0].why, gaps, status: 400 };
    wasResubmit = cur.verificationStatus === 'more_info';
    const now = new Date();
    return {
      patch: {
        verificationStatus: 'submitted', submittedAt: now, updatedAt: now, applicantMessage: null,
        consents: { ...Object.fromEntries(CONSENT_KEYS.map((k) => [k, true])), at: now },
        audit: withAudit(cur, auditRow(user.uid, wasResubmit ? 'resubmitted' : 'submitted', cur.verificationStatus, 'submitted')),
      },
    };
  });
  if (out.error) return json({ error: out.error, gaps: out.gaps || [] }, out.status || 400);
  // Someone who does not want distributions has no reason for us to keep
  // how one would reach them.
  let kept = pay;
  if (out.data.participationRequested === false && pay) {
    await deleteDoc(env, `fundPayments/${user.uid}`).catch(() => {});
    kept = null;
  }
  // No names, no details: only that the queue has something in it.
  if (env.ADMIN_UID) {
    const ping = notifyUser(env, env.ADMIN_UID, {
      title: wasResubmit ? 'Updated fund application' : 'New fund application',
      body: 'Open the fund queue to review it.',
      link: '/admin-fund.html',
    });
    if (ctx?.waitUntil) ctx.waitUntil(ping); else await ping;
  }
  return json({ ok: true, application: applicantView(out.data, kept) });
}

// ---- the reviewer -------------------------------------------------------------

async function reviewer(request, env) {
  const user = await requireUser(request, env);
  if (!user || !(await isFundReviewer(env, user.uid))) return null;
  return user;
}

async function handleQueue(env, rev) {
  const rows = await listDocs(env, 'fundApplications', { pageSize: 300, all: true });
  const now = Date.now();
  return json({
    me: rev.uid,
    applications: rows.map((r) => {
      const a = r.data || {};
      const status = FUND_STATUSES.includes(a.verificationStatus) ? a.verificationStatus : 'draft';
      return {
        uid: r.id,
        preferredName: a.preferredName || '',
        discordUsername: a.discordUsername || '',
        verificationStatus: status,
        submittedAt: a.submittedAt || null,
        updatedAt: a.updatedAt || null,
        reverificationDueAt: a.reverificationDueAt || null,
        reverificationOverdue: status === 'verified' && !!a.reverificationDueAt && new Date(a.reverificationDueAt).getTime() < now,
        participationRequested: a.participationRequested ?? null,
        participationActive: a.participationActive === true,
        self: r.id === rev.uid,
      };
    }).sort((x, y) => String(y.submittedAt || y.updatedAt || '').localeCompare(String(x.submittedAt || x.updatedAt || ''))),
  });
}

const okUid = (v) => typeof v === 'string' && /^[\w-]{1,128}$/.test(v);

async function handleView(env, url, rev) {
  const uid = url.searchParams.get('uid');
  if (!okUid(uid)) return json({ error: 'Not found' }, 404);
  const out = await mutate(env, `fundApplications/${uid}`, (cur) => {
    if (!cur) return { error: 'Not found', status: 404 };
    const patch = { audit: withAudit(cur, auditRow(rev.uid, 'viewed')) };
    // The first look by someone other than the applicant starts the review.
    if (cur.verificationStatus === 'submitted' && uid !== rev.uid) {
      patch.verificationStatus = 'under_review';
      patch.audit = withAudit(cur, auditRow(rev.uid, 'viewed'), auditRow(rev.uid, 'review-started', 'submitted', 'under_review'));
    }
    return { patch };
  });
  if (out.error) return json({ error: out.error }, out.status || 400);
  const pay = (await getDoc(env, `fundPayments/${uid}`))?.data || null;
  return json({ me: rev.uid, application: reviewerView(uid, out.data, pay) });
}

function findRef(app, id) {
  if (app?.identityDocument?.id === id) return { ref: app.identityDocument, kind: 'id' };
  if (app?.photo?.id === id) return { ref: app.photo, kind: 'photo' };
  const m = (Array.isArray(app?.medicalDocuments) ? app.medicalDocuments : []).find((r) => r.id === id);
  return m ? { ref: m, kind: 'medical' } : null;
}

async function handleFile(env, url, rev) {
  const uid = url.searchParams.get('uid');
  const id = url.searchParams.get('doc') || '';
  if (!okUid(uid) || !/^[0-9a-f]{24}$/.test(id)) return json({ error: 'Not found' }, 404);
  const app = await getDoc(env, `fundApplications/${uid}`);
  const hit = findRef(app?.data, id);
  // The path comes from the application itself and must sit under that
  // applicant's own prefix: no file of anyone else's is reachable this way.
  if (!hit || !String(hit.ref.path || '').startsWith(`fund/${uid}/`)) return json({ error: 'Not found' }, 404);
  const upstream = await mediaFetch(env, hit.ref.path);
  if (!upstream.ok) return json({ error: 'Not found' }, 404);
  await mutate(env, `fundApplications/${uid}`, (cur) => (cur
    ? { patch: { audit: withAudit(cur, auditRow(rev.uid, `opened-${hit.kind}`)) } }
    : { error: 'Not found', status: 404 })).catch(() => {});
  const type = DOC_TYPES[hit.ref.type] ? hit.ref.type : 'application/octet-stream';
  const leaf = `${hit.kind === 'id' ? 'id-document' : hit.kind === 'photo' ? 'photo' : 'medical-document'}.${DOC_TYPES[type] || 'bin'}`;
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': type,
      'content-disposition': `inline; filename="${leaf}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "sandbox; default-src 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-robots-tag': 'noindex',
    },
  });
}

/** One generic line to the applicant's sign-in email: never what changed or why. */
async function tellApplicant(env, app) {
  const to = app?.accountEmail;
  if (!to) return;
  await sendEmail(env, {
    to,
    subject: 'An update on your Community Assistance Fund application',
    html: '<p>There is an update on your Community Assistance Fund application.</p><p>Sign in at <a href="https://thepocketadvocates.com/fund.html">thepocketadvocates.com/fund.html</a> to see it.</p>',
  }).catch(() => {});
}

async function handleAct(request, env, rev, ctx) {
  const body = await request.json().catch(() => ({}));
  const uid = body?.uid;
  const action = body?.action;
  if (!okUid(uid) || !ACTIONS.has(action)) return json({ error: 'That action is not available.' }, 400);
  // The rule, before anything is read: nobody verifies their own application.
  if ((action === 'verify' || action === 'reverify') && uid === rev.uid) return json({ error: SELF_VERIFY_REFUSAL }, 403);
  // Eric's brief: "Require the reviewer to enter a brief internal reason when
  // declining verification or requesting more information." The reason is
  // the reviewer's own and stays in the audit history; what the applicant
  // reads is a separate, optional message.
  const reason = clean(body?.reason, 1000);
  const message = clean(body?.message, 1000);
  const note = clean(body?.note, 4000);
  if ((action === 'request_info' || action === 'decline') && reason.length < 2)
    return json({ error: action === 'decline' ? 'Write a brief internal reason for declining.' : 'Write a brief internal reason for asking for more information.' }, 400);
  const out = await mutate(env, `fundApplications/${uid}`, (cur) => {
    if (!cur) return { error: 'Not found', status: 404 };
    const from = cur.verificationStatus;
    if (action === 'note') {
      return { patch: { internalReviewerNote: note, updatedAt: new Date(), audit: withAudit(cur, auditRow(rev.uid, 'note-saved')) } };
    }
    if (from === 'draft') return { error: 'This application has not been sent for review yet.', status: 409 };
    if (!ACT_FROM[action].has(from)) return { error: 'That action does not apply to an application in this state.', status: 409 };
    const now = new Date();
    const patch = { verificationStatus: ACT_TO[action], reviewedAt: now, reviewerId: rev.uid, updatedAt: now };
    if (action === 'verify' || action === 'reverify') {
      patch.verifiedAt = now;
      patch.reverificationDueAt = addMonths(now, REVERIFY_MONTHS);
      patch.participationActive = cur.participationRequested === true;
      patch.applicantMessage = null;
    }
    if (action === 'request_info' || action === 'decline') patch.applicantMessage = message || null;
    if (action === 'decline' || action === 'inactive') patch.participationActive = false;
    if (note) patch.internalReviewerNote = note;
    patch.audit = withAudit(cur, { ...auditRow(rev.uid, action, from, ACT_TO[action]), ...(reason ? { reason } : {}), ...(message ? { msg: message } : {}) });
    return { patch };
  });
  if (out.error) return json({ error: out.error }, out.status || 400);
  if (action !== 'note') {
    const mail = tellApplicant(env, out.data);
    if (ctx?.waitUntil) ctx.waitUntil(mail); else await mail;
  }
  const pay = (await getDoc(env, `fundPayments/${uid}`))?.data || null;
  return json({ ok: true, me: rev.uid, application: reviewerView(uid, out.data, pay) });
}

/**
 * Ready for deletion, not wired to anything (Eric's brief: "no auto-deletion
 * yet"). Removes every file and the payment details, and leaves only the
 * minimal record: who, the status, when verified, by whom, when due, and a
 * short note with nothing medical in it.
 */
export async function minimizeFundApplication(env, uid, { note = '' } = {}) {
  const cur = await getDoc(env, `fundApplications/${uid}`);
  if (!cur) return { ok: false };
  const a = cur.data;
  const refs = [a.identityDocument, a.photo, ...(Array.isArray(a.medicalDocuments) ? a.medicalDocuments : [])].filter((r) => r?.path);
  for (const r of refs) await deleteFile(env, r.path).catch(() => {});
  await deleteDoc(env, `fundPayments/${uid}`).catch(() => {});
  // No mask: the whole document is replaced by the minimal record.
  await patchDoc(env, `fundApplications/${uid}`, {
    userId: uid,
    verificationStatus: a.verificationStatus || 'draft',
    verifiedAt: a.verifiedAt || null,
    reviewerId: a.reviewerId || null,
    reverificationDueAt: a.reverificationDueAt || null,
    minimalNote: clean(note, 200),
    minimizedAt: new Date(),
  });
  return { ok: true, files: refs.length };
}

/** /api/fund/* and /api/admin/fund/*, the one entry the router calls. */
export async function handleFund(request, env, url, ctx) {
  const p = url.pathname;
  if (p.startsWith('/api/admin/fund/')) {
    const rev = await reviewer(request, env);
    if (!rev) return json({ error: 'Not found' }, 404);
    if (p === '/api/admin/fund/list' && request.method === 'GET') return handleQueue(env, rev);
    if (p === '/api/admin/fund/view' && request.method === 'GET') return handleView(env, url, rev);
    if (p === '/api/admin/fund/file' && request.method === 'GET') return handleFile(env, url, rev);
    if (p === '/api/admin/fund/act' && request.method === 'POST') return handleAct(request, env, rev, ctx);
    return json({ error: 'Not found' }, 404);
  }
  const user = await requireUser(request, env);
  if (!user) return json({ error: 'Please sign in again.' }, 401);
  if (p === '/api/fund/me' && request.method === 'GET') return handleMe(env, user);
  if (p === '/api/fund/draft' && request.method === 'POST') return handleDraft(request, env, user);
  if (p === '/api/fund/upload' && request.method === 'POST') return handleUpload(request, env, url, user);
  if (p === '/api/fund/remove' && request.method === 'POST') return handleRemove(request, env, user);
  if (p === '/api/fund/submit' && request.method === 'POST') return handleSubmit(env, user, ctx);
  return json({ error: 'Not found' }, 404);
}
