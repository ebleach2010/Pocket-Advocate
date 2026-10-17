// DEMO MODE: the practice copy's people (Eric, 2026-10-16).
//
// "There should also be a button at the top called 'demo mode' where you press
// it and 4 of these clients appear. You can do a fake update with the advisor,
// the chat sends basic questions back when asked, you can upload documents and
// photos, start the time, and even within there start employer mode with the
// four 'employees' who each have done a different service and have made
// different amounts of money." His choice the same day: a separate copy, his
// real clients hidden until Exit, nothing real ever touched.
//
// Built on the demo's own seed, so every fixture the pages need is there, then
// reshaped: four clients, each worked by one of four team members, each a
// different service, each a different amount of money:
//   Priya Shah     Ana Rivera   Advocacy Case, call in three days
//   Jordan Avery   Marcus Lee   Full-Service, month two
//   Dana Whitfield Grace Kim    a follow-up call after her report, and a tip
//   Sam Okafor     Luis Ortega  Advocacy Case, and Priority Chat each month
// Entirely invented, like everything in the demo.

import { seed } from './seed.js';

const ADMIN = 'demo-admin';
const JORDAN = 'demo-client';
const days = (n) => new Date(Date.now() - n * 86_400_000);
const hours = (n) => new Date(Date.now() - n * 3_600_000);
const inDays = (n) => new Date(Date.now() + n * 86_400_000);
// The money lands in the month before this one, so the payroll's own default,
// Last month, shows every one of them the first time he runs it.
const lastMonth = (day) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() - 1, day, 12); };

/** The team, as the practice copy has it. */
export const LIVE_TEAM = [
  { uid: 'demo-advocate', name: 'Ana Rivera', pct: 60, credentials: 'Patient advocate, former ICU nurse', primary: 'Cardiology', specialties: ['Cardiology', 'Women\'s Health'], payout: { method: 'ach', hint: 'Checking ending 4417' } },
  { uid: 'demo-marcus', name: 'Marcus Lee', pct: 70, credentials: 'BCPA, Board Certified Patient Advocate', primary: 'Oncology', specialties: ['Oncology', 'Insurance Appeals'], payout: { method: 'zelle', hint: 'Zelle to ma…om' } },
  { uid: 'demo-grace', name: 'Grace Kim', pct: 55, credentials: 'RN, BSN', primary: 'Rheumatology', specialties: ['Rheumatology', 'Complex / Undiagnosed Cases'], payout: { method: 'paypal', hint: 'PayPal gr…om' } },
  { uid: 'demo-luis', name: 'Luis Ortega', pct: 65, credentials: 'MPH, patient navigator', primary: 'Neurology', specialties: ['Neurology', 'Rare Disease'], payout: { method: 'check', hint: 'Paper check to Austin, TX' } },
];

const SAM_CHAT = [
  [8, 'client', "Hi Luis. The headaches are back most mornings, and the new neurologist wants to wait three months before anything changes."],
  [8, 'admin', "Thank you for telling me straight away. Three months is a long wait when it is most mornings. Can you send me the September MRI report and the headache diary you mentioned?"],
  [7, 'client', 'Uploaded both. The diary is a photo of my notebook, sorry about the handwriting.'],
  [6, 'admin', 'The handwriting is fine, and the diary is exactly what a neurologist never sees. I count 19 headache mornings out of 30. That number alone is worth a call to the office.'],
  [3, 'client', 'I had the call with you on Monday. Thank you, it was the first time anyone added it all up.'],
  [2, 'admin', 'I am writing your report now. It will lay out the pattern, what has been tried, and the three questions to bring back to the neurologist.'],
];

const SAM_ANALYSIS = `## Right now
Morning headaches on 19 of the last 30 days, a neurologist who wants to wait
three months, and a September MRI read as unremarkable. The diary is the
strongest thing in the file: it turns "most mornings" into a number.

## Plain English
A headache that is worst on waking has a short list of usual causes, and most
of them are checked with simple questions rather than more scans. The diary
answers several of those questions already.

## Worth asking
- Does the headache ease within an hour of getting up?
- How many days a week are pain relievers taken?
- Has anyone asked about snoring or waking unrefreshed?`;

const SAM_DIFFERENTIAL = [
  { name: 'Medication overuse headache', pct: 40, why: 'Near-daily headaches with pain relievers most days.', moves: 'How many days a week pain relievers are taken.' },
  { name: 'Sleep-related headache', pct: 30, why: 'Worst on waking, eases as the morning goes on.', moves: 'Snoring, waking unrefreshed, a partner who has noticed pauses.' },
  { name: 'Chronic migraine', pct: 30, why: 'Fifteen or more headache days a month for over three months.', moves: 'Light and sound sensitivity, and nausea on the bad days.' },
];

// Priya's and Jordan's own reads (2026-10-17): Priya had none, so Update
// spun and settled back on nothing, and Jordan wore Dana's joint pain.
const PRIYA_ANALYSIS = `## Right now
Episodes of a racing heart, three or four a week, each lasting a few minutes,
and an October echo read as structurally normal. The episodes start and stop
suddenly, which narrows things more than the echo does.

## Plain English
A normal echo says the heart's structure is fine. It says nothing about the
rhythm during an episode, and that is the open question. Catching one on a
monitor is the usual next step.

## Worth asking
- Has anyone offered a two week patch monitor?
- Do the episodes stop with bearing down or cold water on the face?
- Any fainting, or near fainting, during one?`;

const PRIYA_DIFFERENTIAL = [
  { name: 'Supraventricular tachycardia', pct: 45, why: 'Sudden start and sudden stop, a few minutes each.', moves: 'An episode caught on a monitor.' },
  { name: 'Postural tachycardia', pct: 30, why: 'Worse on standing, with tiredness between episodes.', moves: 'Heart rate lying down and after ten minutes standing.' },
  { name: 'Inappropriate sinus tachycardia', pct: 25, why: 'A fast resting rate with a normal echo.', moves: 'The resting rate across a whole day.' },
];

const JORDAN_ANALYSIS = `## Right now
Numbness in the left arm and blurred vision in episodes since spring, a
neurology note from 19 May asking for an MRI, and the plan's denial as not
medically necessary. The first-level appeal is filed and their clock is
running.

## Plain English
The neurologist asked for the scan because the episodes have not been
explained. The denial cites a criterion the note already meets; the appeal
says so, line by line.

## Worth asking
- Has the neurologist offered a peer to peer call with the plan?
- How long does each episode last, and what ends it?
- Is there a date the records from Valley Neurology are promised by?`;

const JORDAN_DIFFERENTIAL = [
  { name: 'Migraine with aura', pct: 40, why: 'Episodes of visual blur with numbness that pass.', moves: 'Headache after the episodes, and how long the aura lasts.' },
  { name: 'Demyelinating disease', pct: 35, why: 'Separate episodes in different parts of the body.', moves: 'The MRI the plan denied.' },
  { name: 'Cervical radiculopathy', pct: 25, why: 'Arm numbness that can follow neck position.', moves: 'Whether turning the head brings it on.' },
];

const DANA_CHAT = [
  [12, 'client', "Hi Grace. I've been going in circles for about two years now. Fatigue that doesn't lift, joint pain that moves around, and three doctors who have each told me something different."],
  [12, 'admin', "Thank you for writing all that out. Two years is a long time to carry this on your own. Before our call I'd like to see whatever bloodwork you have, even the old ones."],
  [10, 'client', "I uploaded the discharge summary from March, and photos of the rash I get on my hands. It comes and goes so I've been photographing it."],
  [10, 'admin', 'Photographing it is exactly right. A rash nobody has seen is a rash nobody can act on.'],
  [3, 'client', 'Got the report, thank you. Can we do the follow-up call to go over it? I bought it this morning.'],
  [2, 'admin', 'Yes, it is booked for Thursday. Bring any questions the report raised, and we will go through them one by one.'],
  [1, 'client', 'Thank you for everything so far. I left a small tip, it is not much but I wanted to.'],
];

/**
 * The practice copy: the demo's seed, reshaped to four clients and four team
 * members. `set` and `file` are the store's own writers.
 */
export function seedLive({ set, file }) {
  const docs = new Map();
  const files = new Map();
  seed({ set: (p, v) => docs.set(p, v), file: (p, v) => files.set(p, v) });

  // Each of his four team members, set up and paid the way they chose.
  for (const t of LIVE_TEAM) {
    docs.set(`advocates/${t.uid}`, {
      ...(docs.get(`advocates/${t.uid}`) || {}),
      uid: t.uid, name: t.name, email: `${t.name.split(' ')[0].toLowerCase()}@advocate.demo`, active: true, owner: false,
      commissionPct: t.pct, payroll: true, primarySpecialty: t.primary, specialties: t.specialties, credentials: t.credentials,
      bio: '', headshotPath: null, acceptingNew: true, advisor: { optedIn: false, enabled: false },
      createdAt: days(60), onboardedAt: days(58), demoMustChange: false,
    });
    docs.set(`users/${t.uid}`, { email: `${t.name.split(' ')[0].toLowerCase()}@advocate.demo`, name: t.name, role: 'advocate' });
    docs.set(`payouts/${t.uid}`, { method: t.payout.method, hint: t.payout.hint, details: { name: t.name } });
  }

  // A case handed to one of them: their name in it, their side of the chat.
  const hand = (caseId, uid, first) => {
    const c = docs.get(`cases/${caseId}`);
    docs.set(`cases/${caseId}`, { ...c, advocateId: uid });
    for (const [p, m] of docs) {
      if (p.startsWith(`cases/${caseId}/agenda/`) && m.by === ADMIN) docs.set(p, { ...m, by: uid });
      if (!p.startsWith(`cases/${caseId}/chat/`)) continue;
      docs.set(p, { ...m, from: m.role === 'admin' ? uid : m.from, text: String(m.text || '').replace(/\bEric\b/g, first) });
    }
  };
  const chat = (caseId, client, uid, lines) => {
    for (const p of [...docs.keys()]) if (p.startsWith(`cases/${caseId}/chat/`)) docs.delete(p);
    lines.forEach(([ago, role, text], i) => docs.set(`cases/${caseId}/chat/m${String(i + 1).padStart(3, '0')}`, {
      from: role === 'admin' ? uid : client, role, text, ts: days(ago),
    }));
    const [ago, role, text] = lines[lines.length - 1];
    docs.set(`cases/${caseId}`, { ...docs.get(`cases/${caseId}`), lastMessage: { text: text.slice(0, 120), from: role === 'admin' ? uid : client, role, ts: days(ago), emailed: true } });
  };

  // Priya, Ana's: an Advocacy Case, booked, the call in three days.
  {
    const id = 'demo-case-ana';
    docs.set(`cases/${id}`, {
      ...docs.get(`cases/${id}`), caseRateCents: 210000, createdAt: days(2),
      appointment: { start: inDays(3), durationMin: 60, method: 'video', joinLink: null, requested: false },
      stripe: { sessionId: 'cs_demo_ana', paymentIntentId: 'pi_demo_ana', amountTotal: 210000 },
      charge: { state: 'captured', capturedCents: 210000, capturedAt: lastMonth(24) },
    });
    files.set(`cases/${id}/uploads/1760100000000-echo-report-october.pdf`, { name: '1760100000000-echo-report-october.pdf', type: 'application/pdf', size: 198_000, at: days(1).toISOString(), url: '' });
    docs.set(`cases/${id}/advisor/state`, {
      ...(docs.get(`cases/${id}/advisor/state`) || {}),
      analysis: PRIYA_ANALYSIS, differential: PRIYA_DIFFERENTIAL, workingDx: 'Racing heart in episodes, normal echo',
      status: 'idle', updatedAt: hours(20), diffAt: hours(20), corrections: [], unanswered: [],
    });
    // On the calendar (2026-10-17): her call was on the case and missing from the month.
    docs.set('availability/live-priya', { state: 'booked', start: docs.get(`cases/${id}`).appointment.start, durationMin: 60, caseId: id, advocateId: 'demo-advocate' });
  }

  // Jordan, Marcus's: Full-Service, month two.
  {
    const id = 'demo-case-full';
    hand(id, 'demo-marcus', 'Marcus');
    docs.set(`cases/${id}`, {
      ...docs.get(`cases/${id}`),
      charge: { state: 'captured', capturedCents: 350000, capturedAt: lastMonth(6) },
      extraPayments: [{ kind: 'fullaccess', amountCents: 440000, at: lastMonth(21) }],
    });
    docs.set(`cases/${id}/advisor/state`, {
      ...docs.get(`cases/${id}/advisor/state`),
      analysis: JORDAN_ANALYSIS, differential: JORDAN_DIFFERENTIAL, workingDx: 'Denied MRI, criteria arguably met',
    });
  }

  // Dana, Grace's: the report delivered, a follow-up call bought, and a tip.
  // The demo's richest case, renamed: her files and the read stay as they are.
  {
    const id = 'demo-case';
    const dana = 'demo-client-dana';
    docs.set(`users/${dana}`, { email: 'dana@example.demo', name: 'Dana Whitfield', role: 'client', firstName: 'Dana', lastName: 'Whitfield', dob: '1979-06-02' });
    const c = docs.get(`cases/${id}`);
    docs.set(`cases/${id}`, {
      ...c, clientUid: dana, clientEmail: 'dana@example.demo', clientName: 'Dana Whitfield', clientTz: 'America/Chicago',
      clientPhone: '+1 612 555 0177', clientAddress: '90 Linden Ct, Saint Paul, MN 55104', createdAt: days(12),
      caseRateCents: 210000, addOnFollowUp: true,
      stripe: { sessionId: 'cs_demo', paymentIntentId: 'pi_demo', amountTotal: 210000 },
      charge: { state: 'captured', capturedCents: 210000, capturedAt: lastMonth(9) },
      extraPayments: [
        { kind: 'followup', amountCents: 32500, at: lastMonth(18) },
        { kind: 'tip', amountCents: 7500, at: lastMonth(19) },
      ],
      // `start`, as every page reads it (2026-10-17: under `at` it showed as Dec 31).
      followUp: { start: inDays(2), durationMin: 30, kind: 'followup', label: 'Follow-up discussion', amountCents: 32500, scheduledAt: days(3), method: 'video' },
    });
    docs.set('availability/live-dana', { state: 'booked', start: docs.get(`cases/${id}`).followUp.start, durationMin: 30, caseId: id, advocateId: 'demo-grace', kind: 'followup' });
    for (const [p, m] of docs) if (p.startsWith(`cases/${id}/agenda/`) && m.by === JORDAN) docs.set(p, { ...m, by: dana });
    chat(id, dana, 'demo-grace', DANA_CHAT);
    hand(id, 'demo-grace', 'Grace');
  }

  // Sam, Luis's: an Advocacy Case with the report being written, and Priority Chat each month.
  {
    const id = 'demo-case-sam';
    const sam = 'demo-client-sam';
    docs.set(`users/${sam}`, { email: 'sam@example.demo', name: 'Sam Okafor', role: 'client', firstName: 'Sam', lastName: 'Okafor', dob: '1991-11-20' });
    docs.set(`cases/${id}`, {
      advocateId: 'demo-luis', clientUid: sam, clientEmail: 'sam@example.demo', clientName: 'Sam Okafor', clientTz: 'America/Chicago',
      clientPhone: '+1 512 555 0133', clientAddress: '1407 Elm Row, Austin, TX 78702',
      status: 'awaiting_report', createdAt: days(9),
      appointment: { start: days(3), durationMin: 60, method: 'video', joinLink: 'https://example.invalid/demo-call', requested: false },
      publicElection: { choice: 'private', history: [{ choice: 'private', at: days(9) }] },
      addOnFollowUp: false, caseRateCents: 210000, addonRateCents: 32500,
      forms: { disclaimer: days(9), privacy: days(9), recording: days(9) },
      reportDueAt: inDays(11), files: [],
      stripe: { sessionId: 'cs_demo_sam', paymentIntentId: 'pi_demo_sam', amountTotal: 210000 },
      charge: { state: 'captured', capturedCents: 210000, capturedAt: lastMonth(14) },
      work: { seconds: 3 * 3600 + 15 * 60, startedAt: null },
    });
    chat(id, sam, 'demo-luis', SAM_CHAT);
    docs.set(`cases/${id}/advisor/state`, {
      analysis: SAM_ANALYSIS, status: 'idle', updatedAt: hours(30),
      workingDx: 'Near-daily morning headaches, a three month wait',
      differential: SAM_DIFFERENTIAL, diffAt: hours(30), fileAt: hours(31), clientMsgAt: days(2),
      unanswered: [{ ask: 'How many days a week pain relievers are taken', firstAskedAt: days(6), times: 1, answered: false }],
      corrections: [], mediaReport: { read: ['mri-report-september.pdf', 'headache-diary.jpg'], known: [], queued: [], unreadable: [] },
    });
    files.set(`cases/${id}/uploads/1760200000000-mri-report-september.pdf`, { name: '1760200000000-mri-report-september.pdf', type: 'application/pdf', size: 236_000, at: days(7).toISOString(), url: '' });
    files.set(`cases/${id}/uploads/1760200001000-headache-diary.jpg`, { name: '1760200001000-headache-diary.jpg', type: 'image/jpeg', size: 1_420_000, at: days(7).toISOString(), url: '' });
    // Priority Chat, his monthly line on top. `demoInvoices` is the demo's
    // stand-in for what the real payroll asks Stripe for.
    docs.set(`subscriptions/${sam}`, {
      uid: sam, email: 'sam@example.demo', name: 'Sam Okafor', advocateId: 'demo-luis', status: 'active',
      createdAt: days(40), currentPeriodEnd: inDays(20), stripeCustomerId: 'cus_demo_sam',
      demoInvoices: [{ cents: 5000, at: lastMonth(3) }, { cents: 5000, at: new Date(lastMonth(3).getTime() + 30 * 86_400_000) }],
      lastMessage: { text: 'Is it normal to feel worse on the weekends?', from: sam, role: 'client', ts: hours(5), emailed: true },
    });
    docs.set(`subscriptions/${sam}/chat/s001`, { from: sam, role: 'client', text: 'Quick one: is it normal to feel worse on the weekends?', ts: hours(5) });
  }

  // Every case with a conversation says so in Chats (2026-10-17): Jordan's and
  // Priya's read "No messages yet" over a full thread.
  for (const [p, c] of [...docs]) {
    if (!/^cases\/[^/]+$/.test(p) || c.lastMessage) continue;
    const last = [...docs].filter(([k]) => k.startsWith(`${p}/chat/`)).map(([, m]) => m)
      .sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))[0];
    if (last) docs.set(p, { ...c, lastMessage: { text: String(last.text || '').slice(0, 120), from: last.from, role: last.role, ts: last.ts, emailed: true } });
  }

  for (const [p, v] of docs) set(p, v);
  for (const [p, v] of files) file(p, v);
}

/** A first read for a case that has none, in its own name (2026-10-17). */
export function firstRead(c) {
  const first = String(c.clientName || '').split(' ')[0] || 'This client';
  return {
    analysis: `## Right now\n${first}'s file is new: the intake and whatever has been uploaded so far. Nothing in it contradicts what was said at booking.\n\n## Plain English\nIt is too early for a pattern. The first call is where the history gets its dates, and the records sent after it are what this read will lean on.\n\n## Worth asking\n- When did this start, as close to a date as possible?\n- What has been tried, and what changed after each?\n- Which records are still with a clinic?`,
    workingDx: 'New case, first read',
    differential: [],
    diffAt: new Date(),
  };
}

/**
 * What a practice client asks back when he writes to them. Basic, the way a
 * real client's next question usually is; one per message he sends, in turn.
 */
/** What a Priority Chat subscriber asks back: a chat has no calls (2026-10-17). */
export const LIVE_CHAT_QUESTIONS = [
  'Thank you. Is it normal for it to come and go like that?',
  'Should I be writing these down somewhere?',
  'Can I send you a photo of the label?',
  'Is this something to ask my doctor about, or can it wait?',
  'What should I ask the pharmacist when I pick it up?',
  'That helps, thank you. Okay if I check in again later this week?',
];

export const LIVE_QUESTIONS = [
  'Thank you. When is our next call again?',
  'Do you need anything else from me before then?',
  'Should I bring my medication list to the appointment?',
  'Can you explain the next step in plain English?',
  'Is it okay if my partner joins the call?',
  'How long does it usually take to hear back from the specialist?',
];
