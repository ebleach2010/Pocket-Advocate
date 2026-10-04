// The Community Assistance Fund, mirrored for the demo (2026-10-04).
//
// The same routes as worker/fund.js, answered from the demo's store with the
// very same rules (fund-rules.js): what is kept, what each status allows,
// what the applicant and the reviewer each see, the self-verification
// refusal. Files are kept as object URLs so a tap opens what was picked; a
// file whose URL did not survive a reload opens as a one-page placeholder.
// Nothing here reaches the Worker.

import {
  EDITABLE, KINDS, DOC_TYPES, PHOTO_TYPES, DOC_MAX_BYTES, PHOTO_MAX_BYTES, MEDICAL_MAX_COUNT, CONSENT_KEYS,
  FUND_STATUSES, SELF_VERIFY_REFUSAL, REVERIFY_MONTHS, ACTIONS, ACT_FROM, ACT_TO,
  addMonths, clean, cleanDraft, cleanPayment, submitGaps, applicantView, reviewerView,
  isActiveParticipant, shareOf, checkTo, dollars,
} from '../fund-rules.js';
import { textPdf } from '../textpdf.js';

const res = (status, data) => ({
  ok: status < 400,
  status,
  headers: { get: () => 'application/json' },
  json: async () => data,
  text: async () => JSON.stringify(data),
});
const now = () => new Date().toISOString();
const audit = (a, ...rows) => [...(a?.audit || []), ...rows].slice(-200);
const row = (by, act, from, to, extra = {}) => ({ at: now(), by, act, ...(from ? { from } : {}), ...(to ? { to } : {}), ...extra });
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Answers a fund route, or null when the path is not one. */
export async function fundDemo({ path, q, body, init, role, store, real }) {
  if (!path.startsWith('/api/fund/') && !path.startsWith('/api/admin/fund/')) return null;
  const me = role === 'admin' ? 'demo-admin' : 'demo-client';
  const method = (init.method || 'GET').toUpperCase();
  const get = (p) => store.docs.get(p) || null;
  const put = (p, v) => { store.docs.set(p, v); store.persist?.(); };
  const appPath = (uid) => `fundApplications/${uid}`;
  const payOf = (uid) => get(`fundPayments/${uid}`);
  // His own uid is never in a payout, as in the Worker.
  const REVIEWERS = ['demo-admin'];
  const actives = () => [...store.docs.entries()].filter(([k, a]) => /^fundApplications\/[^/]+$/.test(k) && isActiveParticipant(k.split('/')[1], a, REVIEWERS));
  const poolView = () => {
    const p = get('fundPool/current');
    const since = p?.updatedAt ? new Date(p.updatedAt).getTime() : 0;
    return {
      me,
      pool: p ? { totalCents: p.totalCents, activeCount: p.activeCount, shareCents: p.shareCents, updatedAt: p.updatedAt, pending: 0 } : null,
      participants: actives().map(([k, a]) => {
        const uid = k.split('/')[1];
        const pay = payOf(uid);
        const last = (a.payouts || []).slice(-1)[0] || null;
        // Check only, as in the Worker.
        const payTo = checkTo(pay);
        return { uid, preferredName: a.preferredName || '', method: pay?.method === 'check' ? 'check' : null, payTo, lastPayout: last, paidThisRound: !!last && since > 0 && new Date(last.at).getTime() >= since };
      }),
    };
  };

  if (path.startsWith('/api/admin/fund/')) {
    if (role !== 'admin') return res(404, { error: 'Not found' });
    if (path === '/api/admin/fund/pool' && method === 'GET') return res(200, poolView());
    if (path === '/api/admin/fund/pool' && method === 'POST') {
      const totalCents = Number(body.totalCents);
      if (!Number.isInteger(totalCents) || totalCents < 0) return res(400, { error: 'Enter the pool total in dollars and cents, like 1240.50.' });
      const n = actives().length;
      put('fundPool/current', { totalCents, activeCount: n, shareCents: shareOf(totalCents, n), updatedAt: now(), updatedBy: me, pending: [] });
      return res(200, poolView());
    }
    if (path === '/api/admin/fund/payout') {
      const uid = body.uid;
      const a = get(appPath(uid));
      const amountCents = Number(body.amountCents);
      const ref = clean(body.ref, 60);
      if (REVIEWERS.includes(uid)) return res(403, { error: 'Reviewers are not paid from the fund.' });
      if (!Number.isInteger(amountCents) || amountCents <= 0) return res(400, { error: 'Enter the amount sent, like 124.00.' });
      if (ref.length < 2) return res(400, { error: 'Add the check number.' });
      if (!a || !isActiveParticipant(uid, a, REVIEWERS)) return res(409, { error: 'Only a verified participant who is taking part can be paid.' });
      if (payOf(uid)?.method !== 'check') return res(409, { error: 'There is no mailing address on file for them yet.' });
      put(appPath(uid), { ...a, payouts: [...(a.payouts || []), { at: now(), amountCents, method: 'check', ref, by: me }], audit: audit(a, row(me, 'payout-sent', '', '', { msg: `${dollars(amountCents)} check mailed, Check #${ref}` })) });
      return res(200, { ok: true });
    }
    // The test alert: the demo has no inbox and no push service, so it says
    // what the Worker would, counting this device if it allows alerts.
    if (path === '/api/admin/fund/test-alert') {
      const devices = typeof Notification !== 'undefined' && Notification.permission === 'granted' ? 1 : 0;
      return res(200, { ok: true, devices, emailed: true });
    }
    if (path === '/api/admin/fund/list') {
      const apps = [...store.docs.entries()].filter(([k]) => /^fundApplications\/[^/]+$/.test(k)).map(([k, a]) => {
        const uid = k.split('/')[1];
        const status = FUND_STATUSES.includes(a.verificationStatus) ? a.verificationStatus : 'draft';
        return {
          uid, preferredName: a.preferredName || '', discordUsername: a.discordUsername || '', verificationStatus: status,
          submittedAt: a.submittedAt || null, updatedAt: a.updatedAt || null, reverificationDueAt: a.reverificationDueAt || null,
          reverificationOverdue: status === 'verified' && !!a.reverificationDueAt && new Date(a.reverificationDueAt) < new Date(),
          participationRequested: a.participationRequested ?? null, participationActive: a.participationActive === true, self: uid === me,
        };
      });
      return res(200, { me, applications: apps });
    }
    const uid = q.get('uid') || body.uid;
    const a = get(appPath(uid));
    if (!a) return res(404, { error: 'Not found' });
    if (path === '/api/admin/fund/view') {
      const next = { ...a, audit: audit(a, row(me, 'viewed')) };
      if (a.verificationStatus === 'submitted' && uid !== me) {
        next.verificationStatus = 'under_review';
        next.audit = audit(next, row(me, 'review-started', 'submitted', 'under_review'));
      }
      put(appPath(uid), next);
      return res(200, { me, application: reviewerView(uid, next, payOf(uid)) });
    }
    if (path === '/api/admin/fund/file') {
      const id = q.get('doc');
      const all = [['id', a.identityDocument], ['photo', a.photo], ...(a.medicalDocuments || []).map((r) => ['medical', r])];
      const hit = all.find(([, r]) => r?.id === id);
      if (!hit) return res(404, { error: 'Not found' });
      put(appPath(uid), { ...a, audit: audit(a, row(me, `opened-${hit[0]}`)) });
      const f = store.files.get(hit[1].path);
      let blob = null;
      if (f?.url) { try { blob = await (await real(f.url)).blob(); } catch { blob = null; } }
      if (!blob) blob = new Blob([textPdf(['This is a demo document.', '', 'In the real app the file the applicant uploaded opens here.'], { title: 'Demo document', footer: 'Community Assistance Fund demo' })], { type: 'application/pdf' });
      return { ok: true, status: 200, headers: { get: (h) => (/content-type/i.test(h) ? blob.type : null) }, blob: async () => blob, json: async () => ({}) };
    }
    if (path === '/api/admin/fund/act') {
      const action = body.action;
      if (!ACTIONS.has(action)) return res(400, { error: 'That action is not available.' });
      if ((action === 'verify' || action === 'reverify') && uid === me) return res(403, { error: SELF_VERIFY_REFUSAL });
      const reason = clean(body.reason, 1000);
      const message = clean(body.message, 1000);
      const note = clean(body.note, 4000);
      if ((action === 'request_info' || action === 'decline') && message.length < 2)
        return res(400, { error: action === 'decline' ? 'Write the reason for the denial. It is sent to the applicant.' : 'Write what you need from the applicant. It is sent to them.' });
      let next;
      if (action === 'note') next = { ...a, internalReviewerNote: note, updatedAt: now(), audit: audit(a, row(me, 'note-saved')) };
      else {
        const from = a.verificationStatus;
        if (from === 'draft') return res(409, { error: 'This application has not been sent for review yet.' });
        if (!ACT_FROM[action].has(from)) return res(409, { error: 'That action does not apply to an application in this state.' });
        next = { ...a, verificationStatus: ACT_TO[action], reviewedAt: now(), reviewerId: me, updatedAt: now() };
        if (action === 'verify' || action === 'reverify') {
          next.verifiedAt = now();
          next.reverificationDueAt = addMonths(new Date(), REVERIFY_MONTHS).toISOString();
          next.participationActive = a.participationRequested === true;
          next.applicantMessage = null;
        }
        if (action === 'request_info' || action === 'decline') next.applicantMessage = message || null;
        if (action === 'decline' || action === 'inactive') next.participationActive = false;
        if (note) next.internalReviewerNote = note;
        next.audit = audit(a, row(me, action, from, ACT_TO[action], { ...(reason ? { reason } : {}), ...(message ? { msg: message } : {}) }));
      }
      put(appPath(uid), next);
      return res(200, { ok: true, me, application: reviewerView(uid, next, payOf(uid)) });
    }
    return res(404, { error: 'Not found' });
  }

  const fresh = () => ({ userId: me, verificationStatus: 'draft', step: 1, createdAt: now(), updatedAt: now(), audit: [row(me, 'started')] });
  const cur = get(appPath(me));
  const view = (a) => res(200, { ok: true, application: applicantView(a, payOf(me)) });
  if (path === '/api/fund/me') {
    const view = applicantView(cur, payOf(me));
    const p = get('fundPool/current');
    if (view && p?.totalCents && isActiveParticipant(me, cur, REVIEWERS)) view.pool = { totalCents: p.totalCents, shareCents: p.shareCents, activeCount: p.activeCount, asOf: p.updatedAt };
    return res(200, { application: view });
  }
  if (path === '/api/fund/draft') {
    const a = cur || fresh();
    if (!EDITABLE.has(a.verificationStatus)) return res(409, { error: 'This application has been sent for review, so it cannot be changed right now.' });
    const { draft, error } = cleanDraft(body);
    if (error) return res(400, { error });
    if (body.payment) {
      const p = cleanPayment(body.payment);
      if (p.error) return res(400, { error: p.error });
      put(`fundPayments/${me}`, { userId: me, ...p.payment, updatedAt: now() });
    }
    const next = { ...a, ...draft, updatedAt: now() };
    put(appPath(me), next);
    return view(next);
  }
  if (path === '/api/fund/upload') {
    const kind = q.get('kind');
    if (!KINDS[kind]) return res(400, { error: 'Choose what this file is for.' });
    const a = cur || fresh();
    if (!EDITABLE.has(a.verificationStatus)) return res(409, { error: 'This application has been sent for review, so files cannot be added right now.' });
    const blob = init.body;
    const type = (new Headers(init.headers || {}).get('content-type') || blob?.type || '').toLowerCase();
    const types = kind === 'photo' ? PHOTO_TYPES : DOC_TYPES;
    if (!types[type]) return res(415, { error: kind === 'photo' ? 'That file type is not accepted for a photo. Use a JPG, PNG, HEIC or WEBP picture.' : 'That file type is not accepted. Use a PDF or a JPG, PNG, HEIC or WEBP picture.' });
    const max = kind === 'photo' ? PHOTO_MAX_BYTES : DOC_MAX_BYTES;
    if (!blob?.size) return res(400, { error: 'That file is empty.' });
    if (blob.size > max) return res(413, { error: `That file is over ${kind === 'photo' ? '10' : '25'} MB. Try a smaller copy or a photo of the page.` });
    if (kind === 'medical' && (a.medicalDocuments || []).length >= MEDICAL_MAX_COUNT) return res(409, { error: `You can add up to ${MEDICAL_MAX_COUNT} documents here. Remove one to add another.` });
    const id = rid();
    const p = `fund/${me}/${kind}/${id}.${types[type]}`;
    let url = '';
    try { url = URL.createObjectURL(blob); } catch { /* no preview */ }
    store.files.set(p, { name: `${kind}.${types[type]}`, type, size: blob.size, at: now(), url });
    const ref = { id, type, size: blob.size, path: p, uploadedAt: now() };
    const next = { ...a, updatedAt: now(), audit: audit(a, row(me, `uploaded-${kind}`)) };
    if (kind === 'id') { if (a.identityDocument?.path) store.files.delete(a.identityDocument.path); next.identityDocument = ref; }
    if (kind === 'photo') { if (a.photo?.path) store.files.delete(a.photo.path); next.photo = ref; }
    if (kind === 'medical') next.medicalDocuments = [...(a.medicalDocuments || []), ref];
    put(appPath(me), next);
    return view(next);
  }
  if (path === '/api/fund/remove') {
    if (!cur) return res(404, { error: 'That file was not found.' });
    if (!EDITABLE.has(cur.verificationStatus)) return res(409, { error: 'This application has been sent for review, so files cannot be removed right now.' });
    const { kind, id } = body;
    const next = { ...cur, updatedAt: now(), audit: audit(cur, row(me, `removed-${kind}`)) };
    let gone = null;
    if (kind === 'id' && cur.identityDocument?.id === id) { gone = cur.identityDocument; next.identityDocument = null; }
    if (kind === 'photo' && cur.photo?.id === id) { gone = cur.photo; next.photo = null; next.photoPublicConsent = false; }
    if (kind === 'medical') {
      gone = (cur.medicalDocuments || []).find((r) => r.id === id) || null;
      next.medicalDocuments = (cur.medicalDocuments || []).filter((r) => r.id !== id);
    }
    if (!gone) return res(404, { error: 'That file was not found.' });
    store.files.delete(gone.path);
    put(appPath(me), next);
    return view(next);
  }
  if (path === '/api/fund/submit') {
    if (!cur) return res(404, { error: 'Start the application first.' });
    if (!EDITABLE.has(cur.verificationStatus)) return res(409, { error: 'This application has already been sent for review.' });
    const gaps = submitGaps(cur, payOf(me));
    if (gaps.length) return res(400, { error: gaps[0].why, gaps });
    const again = cur.verificationStatus === 'more_info';
    const next = {
      ...cur, verificationStatus: 'submitted', submittedAt: now(), updatedAt: now(), applicantMessage: null,
      consents: { ...Object.fromEntries(CONSENT_KEYS.map((k) => [k, true])), at: now() },
      audit: audit(cur, row(me, again ? 'resubmitted' : 'submitted', cur.verificationStatus, 'submitted')),
    };
    if (next.participationRequested === false) store.docs.delete(`fundPayments/${me}`);
    put(appPath(me), next);
    return view(next);
  }
  return res(404, { error: 'Not found' });
}
