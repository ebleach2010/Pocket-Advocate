// The preview's case (Eric, 2026-10-15): Joe Bloe, the way his own client
// page shows him. Built from the same story as the showcase on Eric's side
// (joe.js), so whatever is added to the story shows in both places.
import {
  JOE, CHAT, docsFor, MILESTONES, WORK_LOG, AUTHORITY, AGENDA, TELEHEALTH, CHECK_IN, at, silentWav,
} from './joe.js';
import { textPdf } from '../textpdf.js';

export const PREVIEW_UID = 'preview-visitor';
export const PREVIEW_CASE = 'preview-case';
export const ERIC_UID = 'preview-eric';

/** Bytes to a data: URL, so a file survives a page change inside the tab. */
function dataUrl(bytes, type) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return `data:${type};base64,${btoa(bin)}`;
}

/** [days ago, hour, file name, lines]: two a day for the last nine days. */
const DAILY = [
  [0, 8, 'symptom-diary-today.pdf', ['# Symptom diary', 'Morning: headache behind the eyes, 3 out of 10.', 'No new spots in my vision. Hearing about the same.', 'Slept about seven hours.']],
  [0, 11, 'questions-for-the-angiography-read.pdf', ['# Questions for the angiography read', 'How many branches are blocked, and which eye is worse?', 'Is this enough to start treatment now?', 'Do I need to stop driving?']],
  [-1, 9, 'symptom-diary-yesterday.pdf', ['# Symptom diary', 'Headache 4 out of 10 after lunch.', 'Ringing in the left ear for about an hour.', 'Took nothing for it.']],
  [-1, 15, 'pharmacy-receipt.pdf', ['# Pharmacy receipt', 'Sumatriptan 50 mg, 9 tablets.', 'Paid $18.40 with insurance.']],
  [-2, 10, 'insurance-card-front-and-back.pdf', ['# Insurance card', 'Gem State Health Plan, PPO.', 'Member ID on file with the case.', 'Prior authorization line on the back.']],
  [-2, 17, 'blood-pressure-log.pdf', ['# Blood pressure log', 'Morning 128 over 82. Evening 132 over 84.', 'Taken seated, left arm.']],
  [-3, 9, 'visual-field-printout.pdf', ['# Visual field test', 'Patchy loss in the upper right of the right eye.', 'Left eye within normal limits.']],
  [-3, 14, 'work-note-from-hr.pdf', ['# Work note', 'Two days off approved for appointments this week.', 'Return to light duty after.']],
  [-4, 8, 'symptom-diary-sunday.pdf', ['# Symptom diary', 'Bad morning. Confused for about twenty minutes, my wife noticed first.', 'Better by ten.']],
  [-4, 16, 'neurology-referral.pdf', ['# Referral', 'Referred to neurology for recurrent headache with transient confusion and hearing change.', 'Urgent, within two weeks.']],
  [-5, 10, 'hearing-change-notes.pdf', ['# Hearing notes', 'Low tones sound muffled on the left.', 'Worse at the end of the day.']],
  [-5, 13, 'prior-auth-request-copy.pdf', ['# Prior authorization request', 'Request sent by the clinic for the angiography.', 'Reference number on file.']],
  [-6, 9, 'symptom-diary-friday.pdf', ['# Symptom diary', 'Headache 2 out of 10.', 'Good day overall, walked thirty minutes.']],
  [-6, 18, 'family-history.pdf', ['# Family history', 'Mother: migraines. Father: high blood pressure.', 'No known autoimmune illness in the family.']],
  [-7, 11, 'old-eye-exam-2024.pdf', ['# Eye exam, 2024', 'Routine exam. Glasses prescription only.', 'Retina normal at the time.']],
  [-7, 15, 'insurance-explanation-of-benefits.pdf', ['# Explanation of benefits', 'MRI brain: allowed, applied to deductible.', 'You may owe $412.']],
  [-8, 10, 'photo-of-eye-spots-notes.pdf', ['# Notes on the eye spots', 'Grey patches in the upper right, come and go.', 'Last about ten minutes each time.']],
  [-8, 16, 'medication-allergies.pdf', ['# Allergies', 'Penicillin: rash as a child.', 'No other known allergies.']],
];

/** Every client-visible part of the case, written into the preview store. */
export function seedPreview(now, { set, file }) {
  const id = PREVIEW_CASE;
  set(`users/${PREVIEW_UID}`, {
    email: JOE.email, name: JOE.name, role: 'client', firstName: 'Joe', lastName: 'Bloe', dob: JOE.dob,
  });

  // The documents, as text PDFs dated against the chat.
  const attached = {};
  for (const d of docsFor(now)) {
    const bytes = textPdf(d.lines);
    const when = at(now, d.days, 12);
    const path = `cases/${id}/${d.folder}/${when.getTime()}-${d.name}`;
    const url = dataUrl(bytes, 'application/pdf');
    const meta = d.name === 'case-report.pdf' ? { paCategory: 'report' }
      : d.name === 'appeal-letter.pdf' ? { paCategory: 'formsent', paStarred: String(when.getTime()) } : null;
    file(path, { name: `${when.getTime()}-${d.name}`, type: 'application/pdf', size: bytes.length, at: when.toISOString(), url, meta });
    attached[d.name] = { name: d.name, path, size: bytes.length, contentType: 'application/pdf', url };
  }
  // A couple of his own uploads a day (Eric, 2026-10-15: "make a couple file
  // uploads per day"), so the Docs tab reads like a case being worked. The
  // preview's alone: the showcase keeps the story's own set.
  for (const [days, hour, name, lines] of DAILY) {
    const bytes = textPdf(lines);
    const when = at(now, days, hour, 20);
    const path = `cases/${id}/uploads/${when.getTime()}-${name}`;
    file(path, { name: `${when.getTime()}-${name}`, type: 'application/pdf', size: bytes.length, at: when.toISOString(), url: dataUrl(bytes, 'application/pdf'), meta: null });
  }
  const call = at(now, -14, 10, 0);
  const rec = silentWav();
  file(`cases/${id}/recording/${call.getTime()}-video-call-recording.wav`, {
    name: `${call.getTime()}-video-call-recording.wav`, type: 'audio/wav', size: rec.length,
    at: at(now, -14, 11, 5).toISOString(), url: dataUrl(rec, 'audio/wav'), meta: null,
  });

  const opened = at(now, -22, 16, 5);
  const fullAt = at(now, -10, 9, 30);
  set(`cases/${id}`, {
    clientUid: PREVIEW_UID,
    clientEmail: JOE.email,
    clientName: JOE.name,
    clientDob: JOE.dob,
    clientTz: JOE.tz,
    clientPhone: JOE.phone,
    clientAddress: JOE.address,
    status: 'delivered',
    createdAt: opened,
    bookingEmailSentAt: opened,
    appointment: { start: call, durationMin: 60, method: 'video', phone: null, joinLink: null, requested: false },
    publicElection: { choice: 'private', history: [{ choice: 'private', at: opened }] },
    addOnFollowUp: false,
    forms: { disclaimer: opened, privacy: opened, recording: opened, service: opened, phoneConsent: opened, fullAccess: fullAt },
    files: [],
    reportDueAt: at(now, 0, 10, 0),
    reportDeliveredAt: at(now, -6, 12, 30),
    caseRateCents: 210000,
    addonRateCents: 32500,
    fullAccess: true,
    fullAccessAt: fullAt,
    fullAccessRateCents: 440000,
    fullAccessMonths: 1,
    authorityAt: at(now, -13, 10),
    scopeSignedAt: at(now, -10, 9),
    stripe: { sessionId: 'preview', paymentIntentId: null, amountTotal: 210000 },
    // Working on it right now, so the line that says so is on the page.
    work: { seconds: 24000, startedAt: new Date(now.getTime() - 18 * 60_000), tierMark: 3600, doing: 'reading your angiography report' },
    hold: null,
    chatUnlocked: true,
    chatOpenNotified: true,
    checkIns: [{ start: at(now, CHECK_IN.days, CHECK_IN.hour, CHECK_IN.minute), durationMin: 30, slotId: null, scheduledAt: at(now, -2, 16) }],
    telehealthVisits: [{
      when: at(now, TELEHEALTH.days, TELEHEALTH.hour, TELEHEALTH.minute),
      clinicName: TELEHEALTH.clinicName, provider: TELEHEALTH.provider,
      paidCents: 0, sessionId: null, attestAt: at(now, -3, 11), confirmedAt: at(now, -2, 15),
    }],
  });

  CHAT.forEach(([days, h, m, who, text, attach], i) => {
    set(`cases/${id}/chat/m${String(i + 1).padStart(3, '0')}`, {
      from: who === 'eric' ? ERIC_UID : PREVIEW_UID,
      role: who === 'eric' ? 'admin' : 'client',
      text,
      ts: at(now, days, h, m),
      ...(attach && attached[attach] ? { attachment: attached[attach] } : {}),
    });
  });

  AGENDA.forEach(([days, h, who, text], i) => {
    set(`cases/${id}/agenda/a${i + 1}`, {
      text, by: who === 'eric' ? ERIC_UID : PREVIEW_UID, role: who === 'eric' ? 'admin' : 'client',
      at: at(now, days, h), done: false, doneAt: null,
    });
  });

  // The client's view of his log: when, what kind, who, and the line written
  // for them. Never the phone, the parties or his notes.
  WORK_LOG.forEach(([days, h, m, kind, clinic, , , summary], i) => {
    set(`cases/${id}/caseLog/c${i + 1}`, { at: at(now, days, h, m), kind, who: clinic, summary });
  });
  MILESTONES.forEach(([days, h, kind, label, color, what], i) => {
    set(`cases/${id}/milestones/m${i + 1}`, { what, kindLabel: label, kindColor: color, kind, at: at(now, days, h) });
  });

  AUTHORITY.forEach(([days, h, kind, fields], i) => {
    set(`cases/${id}/authority/f${i + 1}`, {
      kind, signedName: JOE.name, signedAt: at(now, days, h), revokedAt: null, expiresAt: at(now, days + 365, h),
      clinicName: '', clinicAddress: '', clinicPhone: '', fromDate: '', toDate: '',
      purpose: '', memberId: '', planName: '', categories: [], scopes: [], contactOk: false, signatureImage: '',
      ...fields,
    });
  });
}
