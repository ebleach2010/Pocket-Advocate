// The fake case. One client, one thread, one file of documents, and enough
// advisor output that every page has something real to show.
//
// Entirely invented. No detail here comes from any real client, and the
// clinical content is deliberately generic: this exists to exercise an
// interface, not to be read as medicine.

const CASE_ID = 'demo-case';
const CLIENT = 'demo-client';
const ADMIN = 'demo-admin';

const days = (n) => new Date(Date.now() - n * 86_400_000);
const hours = (n) => new Date(Date.now() - n * 3_600_000);

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
export function seed({ set, file }) {
  set(`users/${CLIENT}`, { email: 'jordan@example.demo', name: 'Jordan Avery', role: 'client' });
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
    caseRateCents: 26500,
    addonRateCents: 7500,
    forms: { disclaimer: days(11), privacy: days(11), recording: days(11) },
    reportDueAt: days(-4),
    reportDeliveredAt: hours(20),
    files: [],
    stripe: { sessionId: 'cs_demo', paymentIntentId: 'pi_demo', amountTotal: 26500 },
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
}

export const DEMO_CASE_ID = CASE_ID;
