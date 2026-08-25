// The fake case. One client, one thread, one file of documents, and enough
// advisor output that every page has something real to show.
//
// Entirely invented. No detail here comes from any real client, and the
// clinical content is deliberately generic: this exists to exercise an
// interface, not to be read as medicine.

const CASE_ID = 'demo-case';
// The Full Access case. Its own id so both states are drivable: the standard
// case still shows the upgrade card, which is how most of these get sold.
const FULL_ID = 'demo-case-full';
const CLIENT = 'demo-client';
const ADMIN = 'demo-admin';

const days = (n) => new Date(Date.now() - n * 86_400_000);
const hours = (n) => new Date(Date.now() - n * 3_600_000);
const inDays = (n) => new Date(Date.now() + n * 86_400_000);

const CHAT = [
  [10, 'client', "Hi Eric. I've been going in circles for about two years now. Fatigue that doesn't lift, joint pain that moves around, and three doctors who have each told me something different."],
  [10, 'admin', "Thank you for writing all that out. Two years is a long time to be carrying this on your own, and moving pain with fatigue is a real pattern, not a vague one. Before our call I'd like to see whatever bloodwork you have, even the old ones."],
  [9, 'client', "I have some. The GP did a big panel in March and said everything was normal, but nobody showed me the actual numbers."],
  [9, 'admin', 'Normal is doing a lot of work in that sentence. Can you ask the practice for the full report rather than the summary letter? You are entitled to it and it usually takes one phone call.'],
  [8, 'client', "I'll try. They've been hard to get hold of."],
  [7, 'admin', "Any luck with the March panel? I'd rather go into the call with the numbers than without them."],
  [6, 'client', 'Not yet, sorry. I called twice and got the answerphone both times.'],
  [6, 'admin', "That's not on you. If it helps, I can give you the exact words to say when you do get through."],
  [5, 'client', "That would help actually. My brain isn't great on the phone."],
  [5, 'admin', 'Here is the whole script: "I would like a copy of my full blood test results from March, including the reference ranges, not the summary letter. I am happy to collect them or receive them by email." That is all you need to say.'],
  [4, 'client', 'Thank you. I also wanted to ask about the rheumatology referral the second doctor mentioned. Is that worth chasing?'],
  [4, 'admin', "Yes, and I'd chase it. Moving joint pain with this much fatigue is squarely their territory, and a referral that was mentioned but never made is the most common thing I find."],
  [2, 'client', "I uploaded the discharge summary from the March hospital visit, and some photos of the rash I get on my hands. It comes and goes so I've been photographing it."],
  [2, 'admin', 'Good, photographing it is exactly right. A rash nobody has seen is a rash nobody can act on. I will go through everything before we speak.'],
  [1, 'client', 'Also, is the recording something I get to keep?'],
  [1, 'admin', "Yes. The recording and the written report are both yours, permanently, whatever happens to the case afterwards."],
];

const ANALYSIS = `## Right now
Two years of moving joint pain with unlifting fatigue, and a [[serology]] panel
she was told was normal but has never seen. The single most useful move before
the call is getting the March numbers with their reference ranges, because
"normal" from a GP letter and "normal" on the page are different claims. She
has also photographed an intermittent hand rash, which is the kind of evidence
that usually goes missing.

## Plain English
[[Serology]] just means blood tests that look for signs your immune system is
reacting to something. A result can sit inside the normal range and still be
worth a second look, which is why the actual numbers matter more than the word
"normal" in a letter. The rash photos matter for the same reason: things that
come and go are almost never happening on the day of the appointment.

## What this could be
- An inflammatory arthritis. What would raise it: the March inflammatory
  markers being at the top of the range rather than mid-range.
- A connective tissue condition. What would raise it: the hand rash being
  photosensitive or over the knuckles rather than the finger joints.
- Post-viral fatigue with unrelated joint symptoms. What would lower it: a
  clear inflammatory pattern in the bloods.
- Thyroid or iron deficiency not fully treated. What would raise it: the March
  panel showing borderline results that were called normal.

## Worth investigating
- The full March panel with reference ranges. Settles what "normal" meant.
- Whether the rheumatology referral was ever actually made. A referral
  mentioned and not sent is the most common gap in a file.
- Ferritin specifically, not just haemoglobin. Fatigue with normal haemoglobin
  and low ferritin is routinely missed.

## Worth asking
- Do you have the actual numbers from the March blood tests, or only the letter?
- Does the hand rash come up in sunlight, or with heat, or with nothing you can point to?
- Was the rheumatology referral ever confirmed in writing?

## What we know so far
### History
Two years of fatigue that does not lift with rest. Moving joint pain, no fixed
joint. Intermittent hand rash, photographed by the client.
### Normal results
March panel reported as normal by the GP; numbers not yet seen.
### Procedures
Hospital visit in March, discharge summary uploaded.

## What's missing
- The March panel with reference ranges.
- Confirmation the rheumatology referral was sent.
- Any record of what the second doctor actually wrote.

## Ruled out
- Nothing is genuinely ruled out yet. The March panel is the first thing that
  could rule anything out, and it has not been seen.

## For you
She said her brain is not great on the phone and then made two calls anyway.
The script you sent is the right kind of help: it removes the part she finds
hard without doing it for her.

## Key terms
- Serology [Test or lab]: blood tests looking for immune system activity | Mechanism: antibodies made against the body's own tissue show up in the blood | Treatment: not a treatment, a test that guides one | Outlook: a positive result narrows the search rather than ending it
- Ferritin [Test or lab]: how much iron is in storage, as opposed to circulating`;

const DIFFERENTIAL = [
  { name: 'Inflammatory arthritis', pct: 35, why: 'Moving joint pain over two years with unlifting fatigue is the classic shape.', moves: 'The March inflammatory markers. Top of range raises it, mid-range lowers it.' },
  { name: 'Connective tissue condition', pct: 25, why: 'The intermittent hand rash alongside joint and fatigue symptoms.', moves: 'Where the rash actually sits, and whether sunlight brings it out.' },
  { name: 'Unresolved iron deficiency', pct: 20, why: 'Fatigue called normal on a panel that may never have included ferritin.', moves: 'A ferritin number. Under 30 raises it sharply.' },
  { name: 'Post-viral fatigue', pct: 20, why: 'Fits the fatigue, fits the timeline, does not explain the rash.', moves: 'A clean inflammatory panel would raise it; anything positive lowers it.' },
];

const UNANSWERED = [
  { ask: 'The full March blood panel with reference ranges, not the summary letter', firstAskedAt: days(9), times: 3, answered: false },
  { ask: 'Written confirmation that the rheumatology referral was actually sent', firstAskedAt: days(4), times: 1, answered: false },
];

const GLOSSARY = [
  { term: 'Serology', category: 'Test or lab', definition: 'Blood tests looking for immune system activity.', mechanism: "Antibodies made against the body's own tissue show up in the blood.", treatment: 'Not a treatment; a test that guides one.', outcome: 'A positive result narrows the search rather than ending it.', addedAt: days(2), learnedAt: null },
  { term: 'Ferritin', category: 'Test or lab', definition: 'How much iron is in storage, as opposed to circulating.', mechanism: '', treatment: '', outcome: '', addedAt: days(2), learnedAt: days(1) },
];

/** Write the whole thing. `set` takes a Firestore path, `file` a Storage one. */

// The Full Access thread. Shorter than the main one on purpose: what this
// case is FOR is the work that happens off the thread, and the demo should
// make that obvious rather than bury it in chat.
const FULL_CHAT = [
  [37, 'client', 'They denied the MRI. The letter just says not medically necessary and gives a policy number.'],
  [37, 'admin', 'Send me the letter and your card, front and back. I will get the policy they are citing and we will see whether they actually applied it.'],
  [36, 'client', 'Sent. I do not understand any of it.'],
  [36, 'admin', 'You do not have to. That is mine now. I need two forms signed before I can talk to them, and they are on your case page.'],
  [31, 'client', 'Both signed.'],
  [31, 'admin', 'Got them. I have the records request in with Valley Neurology and I am booked with your plan on Tuesday.'],
  [3, 'admin', 'The appeal is written. I am filing it before the deadline and I will tell you the day it goes.'],
];

// The denial and its clock, computed so the deadline is always live in the
// demo rather than a date that has quietly gone past.
const DENIED_AT = days(37).toISOString().slice(0, 10);
const APPEAL_DUE = new Date(days(37).getTime() + 180 * 86_400_000)
  .toISOString().slice(0, 10);

// A letter in the shape runAppeal actually produces, including a [NEEDS: ]
// marker, because the gap markers are the part he has to know about.
const DEMO_APPEAL = `RE: Jordan Avery | Member ID CH-4417822 | Claim 44821-2
Dates of service: 12 June 2026 | Provider: Valley Neurology
Denial dated: ${DENIED_AT}

1. WHAT WAS DENIED AND WHY

Cascade Health PPO denied MRI of the brain with and without contrast as not
medically necessary, citing medical policy MP-114 and denial code UM-22.

2. WHY THAT REASON DOES NOT APPLY HERE

MP-114 requires documented failure of two conservative measures over at least
six weeks before advanced imaging is approved. The record documents both.
Physical therapy ran from 3 February to 21 March 2026, discharged without
improvement by the treating therapist. A trial of amitriptyline ran from 2
April to 19 May 2026 and was stopped for intolerance, documented by the
prescribing physician. That is two measures across fifteen weeks, which
exceeds the policy's own threshold.

MP-114 further requires a focal neurological finding. The 19 May examination
records a persistent left-sided visual field deficit, which is focal by any
reading of the policy.

3. THE CLINICAL SUPPORT

Neurology consultation note, 19 May 2026, recording the field deficit and the
rationale for imaging. Physical therapy discharge summary, 21 March 2026.
Medication record for the amitriptyline trial and its discontinuation.

[NEEDS: the reference number printed on the denial letter]

4. WHAT IS REQUESTED

Overturn the denial and authorise the study. In the alternative, a peer to
peer review with the treating neurologist. I also request the full plan
document and the clinical criteria applied to this claim, and the specialty
and credentials of the reviewer who decided it.

5. TIMELINESS

This appeal is filed within the plan's own filing window from the date of the
adverse determination. A written response is requested within the timeframe
the plan's documents require.

Eric Bleach
Patient advocate, authorised representative
Pocket Advocate

Enclosures: appointment of authorised representative; neurology consultation
note; physical therapy discharge summary; medication record.`;

export function seed({ set, file }) {
  // Open times to book into. Without these the booking page says "No open
  // times right now" and the sign-up walk - the thing the demo exists to let
  // him do - stops on its first step. The window the page accepts is 72 hours
  // out to ten and a half days, so these sit inside it with room either side.
  const SLOT_HOURS = [10, 13, 15];
  let slot = 0;
  for (const day of [4, 5, 6, 8]) {
    for (const hour of SLOT_HOURS) {
      const start = inDays(day);
      start.setHours(hour, 0, 0, 0);
      set(`availability/slot-${++slot}`, { state: 'open', start, durationMin: 60 });
    }
  }

  // A complete profile, so nothing in the demo ever asks him to make an
  // account (Eric, 2026-08-21: "Skip me having to create an account for God's
  // sake. I don't want to have to put in my email on a test suite."). Booking
  // only asks for a name and a date of birth when it does not have them.
  set(`users/${CLIENT}`, {
    email: 'jordan@example.demo', name: 'Jordan Avery', role: 'client',
    firstName: 'Jordan', lastName: 'Avery', dob: '1988-03-14',
  });
  set(`users/${ADMIN}`, { email: 'you@pocketadvocate.demo', name: 'Eric', role: 'admin' });

  set(`cases/${CASE_ID}`, {
    clientUid: CLIENT,
    clientEmail: 'jordan@example.demo',
    clientName: 'Jordan Avery',
    clientTz: 'America/Denver',
    status: 'delivered',
    createdAt: days(11),
    appointment: {
      start: days(3),
      durationMin: 60,
      method: 'video',
      joinLink: 'https://example.invalid/demo-call',
      requested: false,
    },
    publicElection: { choice: 'private', history: [{ choice: 'private', at: days(11) }] },
    addOnFollowUp: false,
    caseRateCents: 65000,
    addonRateCents: 17500,
    forms: { disclaimer: days(11), privacy: days(11), recording: days(11) },
    reportDueAt: days(-4),
    reportDeliveredAt: hours(20),
    files: [],
    stripe: { sessionId: 'cs_demo', paymentIntentId: 'pi_demo', amountTotal: 65000 },
    // The work clock, part-way through AND running, so both suites show a
    // real total plus the live "working on it right now" state. Seeded
    // relative to load time, so the demo always shows about 22 live minutes.
    // Eleven and a half hours against $650 is about $56/hr, under the
    // default floor, so the margin badge shows its amber state on the case
    // where that is the real story. The Full Access case below is the
    // healthy one.
    work: { seconds: 11 * 3600 + 40 * 60, startedAt: new Date(Date.now() - 22 * 60_000) },
  });

  let i = 0;
  for (const [ago, role, text] of CHAT) {
    const id = `m${String(++i).padStart(3, '0')}`;
    set(`cases/${CASE_ID}/chat/${id}`, {
      from: role === 'admin' ? ADMIN : CLIENT,
      role,
      text,
      ts: days(ago),
    });
  }

  // The next-call list the chat lanes feed: one item from each side, so both
  // suites show the shared agenda doing its job.
  set(`cases/${CASE_ID}/agenda/a001`, {
    text: 'Go over what the March panel result actually changes',
    by: CLIENT, role: 'client', at: days(1), done: false, doneAt: null,
  });
  set(`cases/${CASE_ID}/agenda/a002`, {
    text: 'Decide whether to push the rheumatology referral now or wait for the panel',
    by: ADMIN, role: 'admin', at: hours(20), done: false, doneAt: null,
  });

  // The advisor's own state, so every page on his side has something on it.
  set(`cases/${CASE_ID}/advisor/state`, {
    analysis: ANALYSIS,
    status: 'idle',
    updatedAt: hours(6),
    workingDx: 'Two years unexplained, bloods never actually seen',
    differential: DIFFERENTIAL,
    diffAt: hours(6),
    fileAt: hours(5),
    clientMsgAt: days(1),
    unanswered: UNANSWERED,
    corrections: [{
      msgId: 'm012',
      issue: 'Called it "the second doctor\'s referral" when the thread says the second doctor only mentioned it.',
      fixed: "Yes, and I'd chase it. Moving joint pain with this much fatigue is squarely their territory, and a referral that was mentioned but never confirmed is the most common thing I find.",
      at: hours(6),
      dismissed: false,
    }],
    mediaReport: {
      read: ['discharge-summary-march.pdf', 'hand-rash-1.jpg', 'hand-rash-2.jpg'],
      known: [],
      queued: [],
      unreadable: [],
    },
  });

  for (const g of GLOSSARY) set(`advisorKnowledge/${g.term.toLowerCase()}`, g);

  set('advisorStyle/profile', {
    voice: '- Short sentences, then one longer one that lands the point.\n- Opens by naming what the person did rather than what they should do.\n- Strips hedging out of drafts. "Might be worth" becomes "I would".',
    stances: "- Chases a referral that was mentioned but never confirmed, every time (edit pairs)\n- Asks for numbers with reference ranges rather than accepting \"normal\" (Eric's override, 2026-08-14)",
    coaching: '- Gives people the exact words when the hard part is the phone call, not the decision.\n- Names effort before asking for more of it.\n- Sometimes puts the ask at the end of a long message, where a tired person will not reach it.',
    updatedAt: hours(30),
  });

  set(`cases/${CASE_ID}/private/notes/doc`, {
    html: '<p>Rheum referral: chase this first. Two years is long enough.</p><p>She undersells how much she has already done.</p>',
    updatedAt: hours(12),
  });

  // Documents. No bytes, so no preview, but they list and open like the real
  // thing and the page renders exactly as it ships.
  const doc = (path, name, type, size, ago) =>
    file(path, { name, type, size, at: days(ago).toISOString(), url: '' });
  doc(`cases/${CASE_ID}/uploads/1755000000000-discharge-summary-march.pdf`, 'discharge-summary-march.pdf', 'application/pdf', 284_000, 2);
  doc(`cases/${CASE_ID}/uploads/1755000001000-hand-rash-1.jpg`, 'hand-rash-1.jpg', 'image/jpeg', 1_240_000, 2);
  doc(`cases/${CASE_ID}/uploads/1755000002000-hand-rash-2.jpg`, 'hand-rash-2.jpg', 'image/jpeg', 1_180_000, 2);
  doc(`cases/${CASE_ID}/report/advocacy-case-review.pdf`, 'advocacy-case-review.pdf', 'application/pdf', 512_000, 0);
  doc(`cases/${CASE_ID}/recording/discussion.m4a`, 'discussion.m4a', 'audio/mp4', 41_000_000, 3);

  // ---------------------------------------------------------------- suite 3
  // A Full Access case, so the tier's own surfaces are drivable rather than
  // described: the authorisations on the client side, and the appeal, the
  // clinic calls and the capacity counter on his.
  //
  // A SECOND case rather than a flag on the first, because the two states are
  // both worth showing: the standard case above still offers the upgrade card,
  // which is how most of these will actually be sold.
  set(`cases/${FULL_ID}`, {
    clientUid: CLIENT,
    clientEmail: 'jordan@example.demo',
    clientName: 'Jordan Avery',
    clientDob: '1988-03-14',
    clientTz: 'America/Denver',
    status: 'awaiting_report',
    createdAt: days(38),
    appointment: {
      // The first call is 20 days BEHIND us, deliberately: the tier's
      // cadence is a check-in every two weeks, so a call 20 days back with
      // nothing booked ahead is exactly what lights CHECK-IN DUE on the
      // shelf - the state the suite exists to show. The 60-day window still
      // has 40 days to run, so booking the next check-in works too.
      start: days(20), durationMin: 60, method: 'phone',
      phone: '+1 555 0148', joinLink: null, requested: false,
    },
    publicElection: { choice: 'private', history: [{ choice: 'private', at: days(38) }] },
    addOnFollowUp: false,
    // The standard rate stays the base for percentage charges; what the tier
    // actually cost is its own field, and the two are never summed.
    caseRateCents: 65000,
    addonRateCents: 17500,
    fullAccess: true,
    fullAccessAt: days(38),
    fullAccessRateCents: 350000,
    // Stamped at the first signature, matching the authorisation seeded
    // below. The tier window does NOT run from this any more - it runs 60
    // days from the first call - but the field remains the record of when
    // he first had authority to act.
    authorityAt: days(31),
    forms: {
      disclaimer: days(38), privacy: days(38), recording: days(38),
      fullAccess: days(38),
    },
    reportDueAt: days(13),
    files: [],
    stripe: { sessionId: 'cs_demo_full', paymentIntentId: 'pi_demo_full', amountTotal: 150000 },
    // 26 hours against $3,500 is about $134/hr, which is what the tier is
    // priced to earn. The standard case above is deliberately the opposite
    // number, so the margin badge shows both of its states across the demo.
    work: { seconds: 26 * 3600, startedAt: null },
  });

  for (const [ago, role, text] of FULL_CHAT) {
    const id = `f${String(++i).padStart(3, '0')}`;
    set(`cases/${FULL_ID}/chat/${id}`, {
      from: role === 'admin' ? ADMIN : CLIENT,
      role, text, ts: days(ago),
    });
  }

  // The signed authorisations. Stored under their own demo path rather than
  // `cases/{id}/private/`, because the demo store keeps everything under
  // /private/ out of the client half entirely, and a client is meant to see
  // their own signed forms. In production the split is the same idea done
  // properly: the records sit in the private subtree and the Worker route is
  // what lets each side read its own view.
  set(`demoAuthority/${FULL_ID}/items/a1`, {
    kind: 'records',
    signedName: 'Jordan Avery', signedAt: days(31), revokedAt: null,
    expiresAt: days(-334),
    clinicName: 'Valley Neurology', clinicAddress: '10 Mesa Road, Phoenix AZ',
    clinicPhone: '+1 555 0102',
    fromDate: '2024-01-01', toDate: '2026-07-31',
    categories: ['genetic'],
    purpose: '',
    memberId: '', planName: '',
  });
  set(`demoAuthority/${FULL_ID}/items/a2`, {
    kind: 'representative',
    signedName: 'Jordan Avery', signedAt: days(30), revokedAt: null,
    expiresAt: days(-335),
    planName: 'Cascade Health PPO', memberId: 'CH-4417822',
    clinicName: '', clinicAddress: '', clinicPhone: '',
    fromDate: '', toDate: '', categories: [],
  });

  // Two clinic calls of the three the tier includes: one done with notes, one
  // still to happen. Admin-only by path, which is the point.
  set(`cases/${FULL_ID}/private/clinicCalls/items/c1`, {
    clinic: 'Valley Neurology, records office',
    phone: '+1 555 0102', parties: 'me, Jordan, records clerk',
    at: days(24), createdAt: days(26), notesAt: days(24),
    notes: 'Records request logged, reference VN-88213. They quoted 30 days and '
      + 'confirmed the authorisation is on file. Asked for imaging on disc as well '
      + 'as the reports. Jordan confirmed her date of birth on the call.',
  });
  set(`cases/${FULL_ID}/private/clinicCalls/items/c2`, {
    clinic: 'Cascade Health, utilisation review',
    phone: '+1 555 0190', parties: 'me, Jordan',
    at: days(2), createdAt: days(5), notes: '',
  });

  // The advisor state for this case: an assessment, and an appeal letter
  // already drafted and waiting to be filed against a live deadline. All of
  // it is admin-only by path.
  set(`cases/${FULL_ID}/advisor/state`, {
    status: 'idle',
    analysis: ANALYSIS,
    updatedAt: hours(3),
    workingDx: 'Denied MRI, criteria arguably met',
    differential: DIFFERENTIAL,
    unanswered: [],
    corrections: [],
    lastPassType: 'delta',
    passesSinceFull: 2,
    appeal: DEMO_APPEAL,
    appealAt: hours(4),
    appealStatus: 'ready',
    appealMeta: {
      memberId: 'CH-4417822', planName: 'Cascade Health PPO',
      claimNumber: '44821-2', deniedAt: DENIED_AT,
      trackId: 'commercial-internal',
      trackLabel: 'Commercial or employer plan, internal appeal',
      dueAt: APPEAL_DUE,
    },
  });

  doc(`cases/${FULL_ID}/uploads/1755000010000-denial-letter.pdf`, 'denial-letter.pdf', 'application/pdf', 96_000, 37);
  doc(`cases/${FULL_ID}/uploads/1755000011000-insurance-card.jpg`, 'insurance-card.jpg', 'image/jpeg', 820_000, 36);
  doc(`cases/${FULL_ID}/uploads/1755000012000-neurology-note-19-may.pdf`, 'neurology-note-19-may.pdf', 'application/pdf', 214_000, 20);
}

export const DEMO_CASE_ID = CASE_ID;
export const DEMO_FULL_CASE_ID = FULL_ID;
