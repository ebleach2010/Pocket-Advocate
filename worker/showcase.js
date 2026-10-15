// The showcase: Joe Bloe, a case that is not a case.
//
// Eric, 2026-09-06: "Create a completely fake case for me to show off on
// YouTube. Enter a chat log of maybe 50 back and forth messages, fake name,
// address, phone number, rare disease, fake document uploads, everything to
// make it an interactable environment where I can show how the system works
// without exposing patient information... Name the guy Joe Bloe."
//
// Everything in this file is invented: the man, his address, his phone, his
// doctors, his clinics, his insurer, his results. It is wired like a client's
// case so every surface treats it as one (the shelf, the chat, the uploads,
// the log, the milestones, the reading), with `showcase: true` on the case
// document so the parts that tell, count or bill a real person skip it, and
// no real person behind it: no uid, an address at example.com that
// email.js refuses to send to, a 555 number.
//
// The illness is Susac syndrome: rare, autoimmune, the small arteries of the
// brain, the retina and the inner ear, usually first called migraine, stress
// or early MS. A story with three organs and one answer is a story the read
// can be seen working on.
import { getDoc, patchDoc, queryDocs, batchCreate, batchDelete, listDocs } from './firestore.js';
import { BUCKET, putFile, patchObjectMeta, listFiles, deleteFile } from './storage.js';
import { markPending } from './advisor.js';
// The PDF writer is a shared module (2026-09-22): the demo builds the same
// file in the browser.
import { textPdf } from '../public/js/textpdf.js';
import { JOE, CHAT, docsFor, MILESTONES, WORK_LOG, AUTHORITY, AGENDA, TELEHEALTH, CHECK_IN, SHOWCASE_COVERS, at, silentWav } from '../public/js/preview/joe.js';
// The story is shared with the public preview; the suites and the Worker still read it from here.
export { JOE, CHAT, docsFor, MILESTONES, WORK_LOG, AUTHORITY, AGENDA, TELEHEALTH, CHECK_IN, SHOWCASE_COVERS };

function authorityItem(now, [days, hour, kind, fields]) {
  return {
    kind, signedName: JOE.name, signedAt: at(now, days, hour), revokedAt: null,
    expiresAt: at(now, days + 365, hour),
    clinicName: '', clinicAddress: '', clinicPhone: '', fromDate: null, toDate: null,
    purpose: '', memberId: '', planName: '', categories: [], scopes: [], contactOk: false, signatureImage: '',
    ...fields,
  };
}

/**
 * Build the case in Firestore and Storage. One per app: a second call finds
 * the one that exists (open or closed) and hands it back, so the door on the
 * shelf can say so. Deleted, it can be built again.
 */
export async function buildShowcase(env, { adminUid } = {}) {
  const existing = await queryDocs(env, 'cases', [['showcase', 'EQUAL', true]], 1).catch(() => []);
  if (existing.length) return { id: existing[0].id, existing: true };
  const eric = adminUid || (await queryDocs(env, 'users', [['role', 'EQUAL', 'admin']], 1).catch(() => []))[0]?.id || 'eric';
  const now = new Date();
  const id = crypto.randomUUID();
  const docs = docsFor(now);
  // The documents first, so every chat row that carries one can point at it.
  const uploaded = {};
  for (const doc of docs) {
    const bytes = textPdf(doc.lines);
    const stamp = at(now, doc.days, 12).getTime();
    const path = `cases/${id}/${doc.folder}/${stamp}-${doc.name}`;
    const put = await putFile(env, path, bytes, 'application/pdf');
    // A download token, the way the browser SDK stamps one, so the chat's
    // link and the Documents tab open it like any other upload.
    const token = crypto.randomUUID();
    await patchObjectMeta(env, put.path, { firebaseStorageDownloadTokens: token }).catch(() => {});
    uploaded[doc.name] = {
      name: doc.name,
      path: put.path,
      size: put.size || bytes.byteLength,
      contentType: 'application/pdf',
      url: `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(put.path)}?alt=media&token=${token}`,
    };
  }
  const opened = at(now, -22, 16, 5);
  const call = at(now, -14, 10, 0);
  // The call's recording (2026-10-15), so the recording row is on his Documents too.
  const wav = silentWav();
  const recPath = `cases/${id}/recording/${call.getTime()}-video-call-recording.wav`;
  const rec = await putFile(env, recPath, wav, 'audio/wav');
  await patchObjectMeta(env, rec.path, { firebaseStorageDownloadTokens: crypto.randomUUID() }).catch(() => {});
  const rows = CHAT.map(([days, h, m, who, text, attach]) => ({
    path: `cases/${id}/chat/${crypto.randomUUID()}`,
    data: {
      from: who === 'eric' ? eric : JOE.uid,
      role: who === 'eric' ? 'admin' : 'client',
      text,
      ts: at(now, days, h, m),
      ...(attach && uploaded[attach] ? { attachment: uploaded[attach] } : {}),
    },
  }));
  const last = rows[rows.length - 1].data;
  const lastFromJoe = [...rows].reverse().find((r) => r.data.role === 'client')?.data.ts || now;
  await patchDoc(env, `cases/${id}`, {
    showcase: true,
    clientUid: null,
    clientEmail: JOE.email,
    clientName: JOE.name,
    clientDob: JOE.dob,
    clientTz: JOE.tz,
    clientPhone: JOE.phone,
    clientAddress: JOE.address,
    // The report went out on day seven, so the overview says DELIVERED
    // rather than counting an overdue report on camera.
    status: 'delivered',
    createdAt: opened,
    bookingEmailSentAt: opened,
    appointment: { start: call, durationMin: 60, method: 'video', phone: null, joinLink: null, requested: false },
    publicElection: { choice: 'private', history: [{ choice: 'private', at: opened }] },
    addOnFollowUp: false,
    forms: { hipaa: opened, terms: opened, consent: opened, recording: opened },
    files: [],
    reportDueAt: at(now, -7, 17, 0),
    reportDeliveredAt: at(now, -7, 12, 30),
    caseRateCents: 120000,
    addonRateCents: 32500,
    fullAccess: true,
    fullAccessAt: at(now, -10, 9, 30),
    fullAccessRateCents: 440000,
    fullAccessMonths: 1,
    fullAccessByHand: true,
    stripe: null,
    // Six hours and forty minutes on the Full-Service clock, an hour of it
    // from the review phase before the flip.
    work: { seconds: 24000, startedAt: null, tierMark: 3600, doing: null },
    hold: null,
    chatUnlocked: true,
    chatOpenNotified: true,
    lastMessage: { text: last.text.slice(0, 120), from: last.from, role: last.role, ts: last.ts, emailed: true },
    // The next Full-Service check-in, on the books (2026-10-15).
    checkIns: [{ start: at(now, CHECK_IN.days, CHECK_IN.hour, CHECK_IN.minute), durationMin: 30, slotId: null, scheduledAt: at(now, -2, 16) }],
    // Confirmed the day before yesterday, attested by Joe when he asked.
    telehealthVisits: [{
      when: at(now, TELEHEALTH.days, TELEHEALTH.hour, TELEHEALTH.minute),
      clinicName: TELEHEALTH.clinicName, provider: TELEHEALTH.provider,
      paidCents: 0, sessionId: null, attestAt: at(now, -3, 11), confirmedAt: at(now, -2, 15),
    }],
  }, { mustNotExist: true });
  for (let i = 0; i < rows.length; i += 400) await batchCreate(env, rows.slice(i, i + 400));
  await batchCreate(env, MILESTONES.map(([days, h, kind, kindLabel, kindColor, what]) => ({
    path: `cases/${id}/private/milestones/items/${crypto.randomUUID()}`,
    data: { what, kind, kindLabel, kindColor, at: at(now, days, h), createdAt: at(now, days, h) },
  })));
  await batchCreate(env, WORK_LOG.map(([days, h, m, kind, clinic, phone, parties, summary]) => ({
    path: `cases/${id}/private/clinicCalls/items/${crypto.randomUUID()}`,
    data: { clinic, phone, parties, kind, kindLabel: '', kindColor: '', summary, at: at(now, days, h, m), notes: '', createdAt: at(now, days, h, m) },
  })));
  await batchCreate(env, AUTHORITY.map((a) => ({
    path: `cases/${id}/private/authority/items/${crypto.randomUUID()}`,
    data: authorityItem(now, a),
  })));
  await batchCreate(env, AGENDA.map(([days, h, who, text]) => ({
    path: `cases/${id}/agenda/${crypto.randomUUID()}`,
    data: { text, by: who === 'eric' ? eric : JOE.uid, role: who === 'eric' ? 'admin' : 'client', at: at(now, days, h), done: false, doneAt: null },
  })));
  await patchDoc(env, `caseMeta/${id}`, { clientMsgAt: lastFromJoe }, { mask: ['clientMsgAt'] }).catch(() => {});
  // The first read runs on the next firing, so the 🧬 page and the reading
  // are there when the camera is.
  await markPending(env, 'case', id).catch(() => {}); // owed work, due now (2026-09-13: no options)
  return { id, existing: false, messages: rows.length, documents: docs.length, milestones: MILESTONES.length, log: WORK_LOG.length, permissions: AUTHORITY.length, agenda: AGENDA.length };
}

/**
 * Everything a case owns, gone: its chat, its reading and the questions
 * under it, its private notes, milestones, log, authority and agenda, its
 * meta, every queue row waiting on it, every file in its folders, and the
 * document itself, last. Only ever called for a case with nobody real behind
 * it (his own, or the showcase); the route above it decides that.
 */
export async function wipeCase(env, id, { adminUid } = {}) {
  const paths = [];
  for (const sub of ['chat', 'advisor/state/qa', 'private/milestones/items', 'private/clinicCalls/items', 'private/authority/items', 'agenda']) {
    const rows = await listDocs(env, `cases/${id}/${sub}`, { pageSize: 300, all: true }).catch(() => []);
    for (const r of rows) paths.push(`cases/${id}/${sub}/${r.id}`);
  }
  paths.push(
    `cases/${id}/advisor/state`, `cases/${id}/private/notes`, `cases/${id}/private/milestones`,
    `cases/${id}/private/clinicCalls`, `cases/${id}/private/authority`, `caseMeta/${id}`,
  );
  const queue = await listDocs(env, 'advisorQueue', { pageSize: 300, all: true }).catch(() => []);
  for (const q of queue) if (q.data?.id === id) paths.push(`advisorQueue/${q.id}`);
  const files = await listFiles(env, `cases/${id}/`, { max: 500 }).catch(() => []);
  for (const f of files) await deleteFile(env, f.path).catch(() => {});
  paths.push(`cases/${id}`);
  let deleted = 0;
  for (let i = 0; i < paths.length; i += 400) deleted += (await batchDelete(env, paths.slice(i, i + 400))).deleted;
  if (adminUid) {
    const prof = await getDoc(env, `users/${adminUid}`).catch(() => null);
    if (prof?.data.selfCaseId === id)
      await patchDoc(env, `users/${adminUid}`, { selfCaseId: null }, { mask: ['selfCaseId'] }).catch(() => {});
  }
  return { docs: deleted, files: files.length };
}
