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

export const JOE = {
  name: 'Joe Bloe',
  dob: '1979-04-12',
  phone: '+1 208 555 0147',
  address: '1188 Juniper Ridge Rd, Nampa, ID 83686',
  email: 'joe.bloe@example.com',
  tz: 'America/Boise',
  uid: 'showcase-joe-bloe',
};

/** Day offsets from build time, so the case reads as three weeks old whenever it is built. */
const DAY = 86_400_000;
function at(now, days, hour = 9, minute = 0) {
  const t = new Date(now.getTime() + days * DAY);
  // The app prints every time on the fixed MST clock (UTC minus seven, no
  // daylight saving), so a 9 here reads as 9:00 AM on the page.
  t.setUTCHours(hour + 7, minute, 0, 0);
  return t;
}
const dayStr = (t) => t.toISOString().slice(0, 10);
const longDay = (t) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', month: 'long', day: 'numeric', year: 'numeric' }).format(t);

/**
 * The chat, oldest first: [days, hour, minute, who, text, attachment?].
 * Fifty messages, twenty-five each way. Eric's are in his own register.
 * An attachment names a document from DOCS below, which the build uploads
 * to the case's chat-files folder and pins to that row.
 */
export const CHAT = [
  [-20, 9, 12, 'joe', 'Hi Eric. Thanks for taking this on. Quick version: five months of headaches, a blind spot in my right eye that comes and goes, and my left ear went muffled three weeks ago. Two doctors said migraine and stress. I do not buy it.'],
  [-20, 9, 40, 'eric', 'Good. I do not buy it either, not yet. Three things, in order: what happened first, what has been tested, and who has seen you. Start with the first symptom and the date.'],
  [-20, 10, 5, 'joe', 'Headaches started around early April. Not like my old ones. Behind the eyes, worse in the morning. Then in June I had a patch missing in the right eye for about a day. It came back. Since then it has happened four times.'],
  [-20, 10, 18, 'eric', 'A blind spot that comes and goes is a retina or a blood supply question before it is a migraine question. Has anyone looked at the back of your eye with the pupil dilated, and did they do a picture of the blood vessels (fluorescein angiography)?'],
  [-20, 10, 30, 'joe', 'Eye doctor in July, dilated. Said the retina looked okay, maybe a small pale patch, told me to come back if it got worse. No dye test.'],
  [-20, 10, 41, 'eric', 'That pale patch matters. I want that note, word for word. Ask the eye clinic for the visit note and any photos. You can upload them here or on the Documents tab.'],
  [-19, 8, 2, 'joe', 'Requested. They said 5 to 7 business days. Also, the hearing thing. The ENT did a hearing test last week. Left ear is down in the low tones. He said probably a virus or fluid.'],
  [-19, 8, 30, 'eric', 'Low tone hearing loss on one side, with vision spots and headaches, is a pattern. I am not naming it yet. I want the actual hearing test (the audiogram) and the ENT note. Upload them when you have them.'],
  [-18, 17, 45, 'joe', 'Forgot to say. I went to the ER in May when the headache got bad and I was confused for a couple of hours. Here is the discharge paper.', 'er-discharge.pdf'],
  [-18, 18, 20, 'eric', 'Read it. They did a CT with no contrast and called it normal. A CT does not see what we need to see. Was there an MRI at any point?'],
  [-18, 18, 32, 'joe', 'Yes, the neurologist ordered one in July. She said it showed nonspecific white matter changes and that it could be migraine or early MS. She wants to repeat it in six months.'],
  [-18, 18, 50, 'eric', 'Six months is a long time to wait with a hearing loss and a vision loss on the board. Get me the MRI report and, if you can, the disc or a portal download of the images. The report first.'],
  [-15, 12, 10, 'joe', 'MRI report from the portal.', 'mri-report.pdf'],
  [-15, 13, 5, 'eric', 'This is the most useful thing so far. The report describes small lesions in the middle of the corpus callosum (the bridge between the two halves of the brain). That location is not typical for migraine and it is not the usual pattern for MS either. It fits a short list of rare things, and one of them is treatable.'],
  [-15, 13, 12, 'joe', 'Which one?'],
  [-15, 13, 30, 'eric', 'I am not going to guess out loud before the eye picture and the hearing test are in front of me. What I will say is this: the combination of brain, eye and ear is what matters, and nobody has looked at all three together yet. That is the whole job here.'],
  [-15, 13, 35, 'joe', 'Okay. What do I do right now?'],
  [-15, 13, 50, 'eric', 'Three things. One, call the eye clinic and ask for a fluorescein angiography. Say the words branch retinal artery occlusion and ask them to rule it out. Two, ask the neurologist\'s office for a copy of the MRI images on a disc. Three, keep a daily log here: headache 0 to 10, vision, hearing, anything odd with memory or mood.'],
  [-14, 8, 0, 'joe', 'Call is at 10 today, right? Video.'],
  [-14, 8, 5, 'eric', 'Yes. Have the ER paper and the MRI report open. We will walk the whole timeline.'],
  [-14, 11, 20, 'joe', 'That was the first time anyone let me tell the whole story. Thank you.'],
  [-14, 11, 45, 'eric', 'That is the job. Report in seven days. In the meantime the eye clinic is the priority. Did you call?'],
  [-13, 9, 30, 'joe', 'Called. The eye clinic says the dye test needs prior authorization from Basin Health and the earliest slot is in three weeks.'],
  [-13, 9, 50, 'eric', 'Three weeks is not acceptable with this picture. I will call the clinic myself and ask them to submit the authorization as urgent. Do I have your permission to speak to them on your behalf? Say yes here and I will log it.'],
  [-13, 9, 52, 'joe', 'Yes. Full permission.'],
  [-13, 14, 10, 'eric', 'Spoke with the scheduler and the authorization desk. Urgent request submitted with the MRI findings attached. They moved you to Thursday if the plan approves. I logged the call.'],
  [-12, 16, 0, 'joe', 'Basin Health called me. Denied. They said the dye test is not medically necessary for migraine.'],
  [-12, 16, 20, 'eric', 'They are reviewing a migraine diagnosis that nobody has actually established. That is the appeal: the MRI location, the hearing loss, the vision loss. Upload the denial letter when it comes. I will draft the appeal and you will sign it.'],
  [-11, 10, 5, 'joe', 'Labs from May, for whatever they are worth.', 'labs.pdf'],
  [-11, 10, 40, 'eric', 'Mostly normal, which is useful. Your ESR (a blood test for inflammation) is a little up. Nothing here points at an infection. It does not rule anything in or out on its own, but it helps the appeal, because the usual explanations are not there.'],
  [-10, 9, 15, 'joe', 'I want you to run this whole thing. I cannot keep track of it and work. Let\'s do the full service.'],
  [-10, 9, 30, 'eric', 'Done. From today I make the calls, chase the records and handle the appeal. You still see everything here. Your job is the daily log and telling me what changes.'],
  [-9, 7, 50, 'joe', 'Log: headache 6, right eye clear, left ear the same. Forgot my sister\'s number yesterday, which scared me.'],
  [-9, 8, 10, 'eric', 'Logged. The memory part is important; write it down every time. Records request went to the neurology office this morning for the MRI images and the visit notes. I also asked the ER for the full record, not the discharge paper.'],
  [-8, 18, 30, 'joe', 'Log: headache 8 this morning, better by noon. Had a patch in the right eye again for maybe twenty minutes.'],
  [-8, 18, 45, 'eric', 'If a patch lasts more than an hour, or you get a new one in the other eye, or the confusion comes back, that is an ER visit, not a message to me. Tell them possible retinal artery occlusion. Say it exactly like that.'],
  [-7, 12, 0, 'joe', 'Understood. The denial letter came. Uploaded it on the Documents tab.'],
  [-7, 12, 30, 'eric', 'Got it. Appeal drafted; it is in your Documents as a PDF. Read it, sign the last page, and I will fax it with the MRI report and the ENT note attached. Your report is also ready today.'],
  [-6, 9, 0, 'joe', 'Read the report twice. It is the clearest thing anyone has written about me. Signed the appeal.'],
  [-6, 9, 20, 'eric', 'Faxed to Basin Health at 9:10; the confirmation number is in your log. Expedited appeals are 72 hours by their own rules. I will call them at hour 73 if nothing comes.'],
  [-5, 15, 40, 'joe', 'The ENT sent the hearing test.', 'audiogram.pdf'],
  [-5, 16, 0, 'eric', 'This is the third piece. Low frequency loss on the left, the exact pattern I was hoping not to see. Brain, eye, ear. I have spoken to your neurologist\'s nurse and asked for a call back from the doctor herself this week.'],
  [-4, 8, 45, 'joe', 'Log: headache 4. Slept nine hours. Left ear ringing now too.'],
  [-4, 9, 0, 'eric', 'Ringing is expected with that hearing pattern. Logged. The neurologist\'s office called me back: she wants to see you Monday and she asked me to send everything we have. Sent.'],
  [-3, 11, 30, 'joe', 'Basin Health approved the dye test. Thursday 8am at the eye clinic.'],
  [-3, 11, 40, 'eric', 'Good. Bring nothing but yourself and a driver. The dye can make you feel warm for a minute; that is normal. I will be on the phone with the clinic afterwards for the read.'],
  [-2, 14, 0, 'joe', 'Dye test done. The doctor said there were several blocked small artery branches in the right eye and one in the left I did not even know about. She used the word Susac. Is that the thing you would not say?'],
  [-2, 14, 20, 'eric', 'Yes. Susac syndrome. Brain, eye, ear, all three, and it is treatable. This is not a diagnosis from me, it is from her, and she is the right person to make it. Monday\'s neurology visit is now about treatment, not about whether something is wrong. I will send her the eye report today.'],
  [-1, 19, 10, 'joe', 'What should I ask on Monday?'],
  [-1, 19, 40, 'eric', 'Four questions, in this order. One, does she agree with Susac syndrome. Two, when does treatment start and what comes first (steroids are usual, sometimes IVIG). Three, who is watching the eye and the ear while it starts. Four, what does a bad day look like that means the ER. I have written these on your Agenda tab. Read them to her from your phone.'],
];

/**
 * The documents, each a text PDF written at build time so its dates sit
 * against the chat. `folder` is where it lands: chat-files rides on a chat
 * row, uploads is the Documents tab, report is Eric's own shelf.
 */
export function docsFor(now) {
  const d = (days) => longDay(at(now, days));
  return [
    {
      name: 'er-discharge.pdf', folder: 'chat-files', days: -18,
      lines: [
        '# Snake River Regional Medical Center', 'Emergency Department', 'DISCHARGE SUMMARY', '',
        `Patient: Joe Bloe    DOB: ${JOE.dob}    MRN: 00-471-902    Visit: ${d(-115)}`,
        'Attending: Elena Vasquez, MD (emergency medicine)', '',
        '# Chief complaint',
        'Severe headache since the morning, worse than any before, with about two hours of confusion witnessed by his wife (repeating questions, could not name the month).', '',
        '# History',
        '46 year old man, previously well. Occasional tension headaches for years. Two months of new morning headaches behind the eyes. Denies fever, neck stiffness, weakness, or trauma. No anticoagulants. Non-smoker.', '',
        '# Examination',
        'BP 138/86, HR 84, temp 98.4 F, SpO2 98%. Alert and oriented by the time of examination. Cranial nerves intact. No focal weakness. Gait normal. Fundi not examined (pupils not dilated).', '',
        '# Investigations',
        'CT head without contrast: no acute intracranial abnormality. No hemorrhage, no mass, no midline shift.',
        'CBC, metabolic panel: within normal limits. Glucose 96.', '',
        '# Impression',
        'Migraine with aura, possible. Transient confusion resolved. Low suspicion for acute process given normal CT.', '',
        '# Disposition',
        'Discharged home. Sumatriptan 50 mg as needed given. Follow up with primary care in one week. Return for worsening headache, fever, weakness, vision change, or repeat confusion.',
      ],
    },
    {
      name: 'mri-report.pdf', folder: 'chat-files', days: -15,
      lines: [
        '# Payette Imaging Center', 'MRI BRAIN WITH AND WITHOUT CONTRAST', '',
        `Patient: Joe Bloe    DOB: ${JOE.dob}    Exam date: ${d(-60)}`,
        'Ordering: Lena Okafor, MD (neurology)    Reading radiologist: Hana Lindqvist, MD', '',
        '# Clinical indication',
        'New headaches, one episode of transient confusion, episodes of transient visual loss right eye. Evaluate for demyelinating disease.', '',
        '# Technique',
        'Multiplanar multisequence MRI of the brain before and after intravenous gadolinium.', '',
        '# Findings',
        'Multiple small T2 and FLAIR hyperintense foci are present within the central fibers of the corpus callosum, predominantly the body and splenium, several with a rounded appearance and one with central T1 hypointensity. Scattered punctate foci in the periventricular and deep white matter bilaterally, fewer than ten. No enhancement after contrast. No restricted diffusion. Ventricles and sulci normal for age. No mass, hemorrhage, or extra-axial collection. Major intracranial flow voids preserved. Internal auditory canals unremarkable on the sequences obtained.', '',
        '# Impression',
        '1. Nonspecific white matter changes, including several central callosal lesions. Differential includes demyelinating disease, migraine related changes, and small vessel ischemic change. Clinical correlation recommended.',
        '2. No enhancing lesion. No acute abnormality.',
        'Repeat imaging in six months may be considered if clinically indicated.',
      ],
    },
    {
      name: 'labs.pdf', folder: 'chat-files', days: -11,
      lines: [
        '# Owyhee Family Medicine', 'LABORATORY RESULTS', '',
        `Patient: Joe Bloe    DOB: ${JOE.dob}    Collected: ${d(-112)}    Ordering: Marcus Reyes, MD`, '',
        '# Hematology',
        'WBC 6.8 (4.0 to 10.5)    Hemoglobin 15.1 (13.5 to 17.5)    Platelets 231 (150 to 400)',
        'ESR 31 mm/hr (0 to 20)  HIGH',
        'CRP 4.1 mg/L (below 8.0)', '',
        '# Chemistry',
        'Sodium 139, Potassium 4.2, Creatinine 0.9, Glucose 94, Calcium 9.4, AST 24, ALT 27, all within limits.', '',
        '# Endocrine and nutrition',
        'TSH 1.9 (0.4 to 4.5)    Vitamin B12 512 (200 to 900)    Vitamin D 27 (30 to 100)  LOW', '',
        '# Immunology and infection',
        'ANA negative    Rheumatoid factor negative    Lyme antibody negative    HIV negative    Syphilis screen negative', '',
        'Comment: mildly elevated ESR, otherwise unremarkable. Vitamin D repletion advised.',
      ],
    },
    {
      name: 'audiogram.pdf', folder: 'chat-files', days: -5,
      lines: [
        '# Bruneau ENT and Hearing', 'AUDIOGRAM REPORT', '',
        `Patient: Joe Bloe    DOB: ${JOE.dob}    Test date: ${d(-12)}    Audiologist: R. Castellano, AuD`, '',
        '# Pure tone thresholds (dB HL)',
        'Frequency   250   500   1000  2000  4000  8000',
        'Right ear    10    10    15    15    20    25',
        'Left ear     50    45    40    25    20    25', '',
        '# Speech',
        'Speech reception threshold: right 15 dB, left 40 dB. Word recognition: right 100%, left 84%.', '',
        '# Tympanometry',
        'Type A both ears. Acoustic reflexes present on the right, absent at 500 Hz on the left.', '',
        '# Impression',
        'Left low frequency sensorineural hearing loss, moderate at 250 to 1000 Hz, rising to normal at higher frequencies. Right ear within normal limits. Asymmetry is significant. Etiology unclear on this testing.', '',
        '# Recommendation',
        'ENT review. Consider MRI of the internal auditory canals if not already imaged. Repeat audiogram in six weeks.',
      ],
    },
    {
      name: 'eye-clinic-note.pdf', folder: 'uploads', days: -16,
      lines: [
        '# High Desert Eye Clinic', 'VISIT NOTE', '',
        `Patient: Joe Bloe    DOB: ${JOE.dob}    Date: ${d(-58)}    Physician: Anika Sood, MD (ophthalmology)`, '',
        '# Reason for visit',
        'Recurrent episodes of a missing patch in the right visual field, each lasting hours, four episodes since June. Headaches. Referred by primary care.', '',
        '# Examination',
        'Visual acuity: right 20/25, left 20/20. Pupils equal and reactive, no afferent pupillary defect. Intraocular pressure 15 both eyes. Anterior segments normal.',
        'Dilated fundus examination: right eye shows a small area of retinal whitening along the inferotemporal arteriole with a faint sheathing of the vessel wall, about one disc diameter from the disc. Left eye: disc and macula normal; a possible tiny area of arteriolar wall hyperfluorescence cannot be assessed without angiography. No emboli seen.', '',
        '# Assessment',
        'Right eye: small area of retinal whitening, possible resolved branch retinal artery occlusion versus cotton wool spot. Left eye normal on examination.', '',
        '# Plan',
        'Observe. Return if episodes recur or worsen. Consider fluorescein angiography if recurrent. Patient advised on symptoms of retinal artery occlusion.',
      ],
    },
    {
      name: 'medication-list.pdf', folder: 'uploads', days: -17,
      lines: [
        '# My medication list', `Joe Bloe, written ${d(-17)}`, '',
        'Sumatriptan 50 mg, take when the headache starts. Used six times since May. Does not help much.',
        'Ibuprofen 400 mg, two or three times a week for the headaches.',
        'Vitamin D 2000 units daily, started in June after the blood test.',
        'Melatonin 3 mg some nights.', '',
        'Allergies: none known.',
        'No other regular medication. No blood thinners. Do not smoke. Two or three beers a week.',
      ],
    },
    {
      name: 'ent-note.pdf', folder: 'uploads', days: -5,
      lines: [
        '# Bruneau ENT and Hearing', 'CLINIC NOTE', '',
        `Patient: Joe Bloe    DOB: ${JOE.dob}    Date: ${d(-12)}    Physician: Tom Whitlock, MD (otolaryngology)`, '',
        '# History',
        'Three weeks of a muffled left ear with intermittent ringing. No vertigo. No ear pain or discharge. No recent flying or diving. Also reports months of headaches, under evaluation elsewhere.', '',
        '# Examination',
        'External canals clear. Tympanic membranes intact and mobile bilaterally. Weber lateralizes to the right. Rinne positive bilaterally. Cranial nerves otherwise intact.', '',
        '# Audiogram',
        'Left low frequency sensorineural hearing loss, see report.', '',
        '# Assessment',
        'Left sudden onset low frequency sensorineural hearing loss. Differential: viral labyrinthitis, endolymphatic hydrops, less likely vascular.', '',
        '# Plan',
        'Prednisone burst declined by patient pending neurology input. Recheck audiogram in six weeks. MRI of the internal auditory canals if no improvement.',
      ],
    },
    {
      name: 'denial-letter.pdf', folder: 'uploads', days: -7,
      lines: [
        '# Basin Health Plan', 'NOTICE OF ADVERSE DETERMINATION', '',
        `Date: ${d(-8)}    Member: Joe Bloe    Member ID: BHP-3391-8804    Reference: PA-2026-118842`, '',
        'Service requested: Fluorescein angiography, both eyes (CPT 92235), requested as urgent by High Desert Eye Clinic.', '',
        '# Determination',
        'The request is DENIED. Based on the information submitted, the service is not medically necessary for the diagnosis of migraine with aura (ICD-10 G43.109). Clinical guidelines do not support angiographic evaluation for migraine related visual symptoms in the absence of documented retinal vascular disease.', '',
        '# Your appeal rights',
        'You or your provider may request an internal appeal within 180 days. If your physician certifies that a delay could seriously jeopardize your health, you may request an EXPEDITED appeal, which will be decided within 72 hours of receipt. Appeals may be faxed to 208-555-0199 or mailed to the address above.',
        'You may also request the clinical criteria used in this decision free of charge.',
      ],
    },
    {
      name: 'appeal-letter.pdf', folder: 'report', days: -7,
      lines: [
        '# Expedited appeal of adverse determination PA-2026-118842', `${d(-7)}`, '',
        'To: Basin Health Plan, Appeals Department, by fax to 208-555-0199',
        'Re: Joe Bloe, member ID BHP-3391-8804, date of birth April 12, 1979', '',
        'I am writing on behalf of Joe Bloe, with his written authorization, to request an expedited appeal of the denial dated above for fluorescein angiography of both eyes.', '',
        'The denial rests on a diagnosis of migraine with aura. That diagnosis has not been established. It is one possibility raised in an emergency department visit in May, before any of the findings below existed.', '',
        '# What the record actually shows',
        `1. MRI of the brain, ${d(-60)}: multiple small lesions in the central fibers of the corpus callosum, several rounded, one with central T1 hypointensity. The radiologist lists demyelinating disease and small vessel ischemic change in the differential. Migraine does not produce central callosal lesions.`,
        `2. Dilated eye examination, ${d(-58)}: an area of retinal whitening along the inferotemporal arteriole of the right eye with sheathing of the vessel wall, recorded as a possible resolved branch retinal artery occlusion. The examining ophthalmologist recommended angiography if the episodes recurred. They have recurred, three times.`,
        `3. Audiogram, ${d(-12)}: a new moderate low frequency sensorineural hearing loss on the left, with the right ear normal.`, '',
        '# Why a delay jeopardizes his health',
        'The combination of central callosal lesions, branch retinal artery occlusions and low frequency hearing loss is the recognized triad of a rare, treatable autoimmune condition of the small arteries of the brain, retina and inner ear. Untreated it causes permanent vision loss, permanent hearing loss and cognitive injury. Fluorescein angiography is the test that establishes the retinal component and is required to start treatment. A three week delay is a three week window of untreated arterial occlusion.', '',
        '# What I am asking for',
        'Approval of fluorescein angiography of both eyes on an expedited basis, within 72 hours, under the expedited appeal provision of your notice. The MRI report, the eye clinic note and the audiogram are attached.', '',
        'Please direct any question to me at the number on file for this case. Joe Bloe has signed below.', '',
        'Eric Bleach, patient advocate, on behalf of Joe Bloe', '',
        'Signed: ____________________   Joe Bloe',
      ],
    },
    {
      name: 'case-report.pdf', folder: 'report', days: -6,
      lines: [
        '# Case report for Joe Bloe', `${d(-6)}    Prepared by Eric Bleach, patient advocate`, '',
        '# The short version',
        'Five months of new headaches, four episodes of a missing patch in the right eye, a new hearing loss in the left ear, and one episode of confusion. Two clinicians have called this migraine and stress. The tests already done say otherwise: the MRI shows lesions in the middle of the corpus callosum, the eye examination found a small blocked artery branch, and the audiogram found a low tone hearing loss on one side. Nobody has put the three together. Put together they point at a rare, treatable condition of the small arteries, and the next test (fluorescein angiography) is the one that settles it.', '',
        '# Timeline',
        'Early April: new morning headaches behind the eyes.',
        `${d(-115)}: emergency visit for a severe headache with two hours of confusion. CT normal. Called possible migraine with aura.`,
        `${d(-112)}: blood tests. ESR mildly raised at 31. Everything else normal.`,
        'June: first episode of a missing patch in the right visual field, lasting about a day. Three more since.',
        `${d(-60)}: MRI of the brain. Central corpus callosum lesions, read as nonspecific.`,
        `${d(-58)}: dilated eye examination. Retinal whitening along an artery branch in the right eye, possible resolved branch retinal artery occlusion.`,
        `${d(-12)}: audiogram. Left low frequency sensorineural hearing loss.`,
        `${d(-14)}: our video call. Full history taken.`, '',
        '# What has been tried',
        'Sumatriptan 50 mg six times, no help. Ibuprofen as needed. Vitamin D started in June.', '',
        '# Open questions',
        '1. Are there branch retinal artery occlusions in one eye or both? Answered by fluorescein angiography, approved on appeal.',
        '2. Does neurology agree that the callosal lesions plus the eye and the ear make one diagnosis? Visit booked.',
        '3. Is there any sign of infection or another autoimmune process? Screening labs say no so far.', '',
        '# Next steps, in order',
        '1. Fluorescein angiography this week. I will speak to the clinic for the read the same day.',
        '2. Neurology visit with everything sent ahead. Four questions for the visit are on the Agenda tab.',
        '3. If treatment starts, a plan for who watches the eye and the ear while it does.',
        '4. Daily log: headache 0 to 10, vision, hearing, memory.', '',
        '# What means the ER',
        'A missing patch that lasts more than an hour, a new patch in the other eye, or confusion again. Say possible retinal artery occlusion at the desk.', '',
        'This report organizes your record and the questions in it. It is not a diagnosis and it does not replace your doctors.',
      ],
    },
  ];
}

/**
 * A text PDF, written by hand: Letter pages, Helvetica, a bold line for any
 * line starting "# ", wrapped at about 95 characters, as many pages as it
 * takes. No library: a Worker has no filesystem and the shape of a text PDF
 * is small enough to write out. Returns bytes.
 */
export function textPdf(lines) {
  const W = 612;
  const H = 792;
  const margin = 54;
  const lead = 14;
  const size = 10.5;
  const perPage = Math.floor((H - 2 * margin) / lead);
  const ascii = (s) => String(s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
    .replace(/µ/g, 'u').replace(/[^\x20-\x7e]/g, '?');
  const esc = (s) => s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const wrapped = [];
  for (const raw of lines) {
    const bold = String(raw).startsWith('# ');
    const text = ascii(bold ? String(raw).slice(2) : raw);
    if (!text.trim()) { wrapped.push({ t: '', bold: false }); continue; }
    let line = '';
    for (const w of text.split(' ')) {
      if ((line ? `${line} ${w}` : w).length > 95 && line) { wrapped.push({ t: line, bold }); line = w; } else line = line ? `${line} ${w}` : w;
    }
    if (line) wrapped.push({ t: line, bold });
  }
  const pages = [];
  for (let i = 0; i < wrapped.length; i += perPage) pages.push(wrapped.slice(i, i + perPage));
  if (!pages.length) pages.push([{ t: '', bold: false }]);
  const objs = [];
  const add = (s) => { objs.push(s); return objs.length; };
  const catalog = add('');
  const pagesObj = add('');
  const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (const pg of pages) {
    let y = H - margin;
    const parts = ['BT'];
    for (const l of pg) {
      parts.push(`${l.bold ? '/F2' : '/F1'} ${size} Tf 1 0 0 1 ${margin} ${y.toFixed(1)} Tm (${esc(l.t)}) Tj`);
      y -= lead;
    }
    parts.push('ET');
    const stream = parts.join('\n');
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${pageIds.map((p) => `${p} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets = [];
  objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // Every character above is one byte in Latin-1, so string offsets are byte offsets.
  return Uint8Array.from(out, (c) => c.charCodeAt(0) & 0xff);
}

/** The milestones feed, oldest first: [days, hour, kind, label, colour, what]. */
export const MILESTONES = [
  [-13, 14, 'appointment', 'Appointment scheduled', 'blue', 'Fluorescein angiography requested as urgent with the MRI findings attached; Thursday if the plan approves.'],
  [-12, 16, 'authorization', 'Insurance authorization', 'green', 'Basin Health denied the dye test as not necessary for migraine. Expedited appeal being drafted.'],
  [-6, 9, 'authorization', 'Insurance authorization', 'green', 'Expedited appeal faxed to Basin Health, confirmation 4471902. Their own rule is 72 hours.'],
  [-4, 9, 'appointment', 'Appointment scheduled', 'blue', 'Neurology visit Monday. The MRI report, the eye note and the audiogram sent ahead.'],
  [-3, 11, 'authorization', 'Insurance authorization', 'green', 'Basin Health approved the dye test on appeal. Thursday 8am.'],
  [-2, 15, 'referral', 'Referral out', 'deep', 'Angiography report sent to neurology the same day, with a note that the ophthalmologist named Susac syndrome.'],
];

/** The work log, oldest first: [days, hour, minute, kind, clinic, phone, parties, summary]. */
export const WORK_LOG = [
  [-13, 13, 30, 'call', 'High Desert Eye Clinic', '+1 208 555 0161', 'Scheduler; prior authorization desk', 'Asked for the angiography to go in as urgent with the MRI report attached. Moved to Thursday pending the plan.'],
  [-9, 8, 5, 'investigation', 'Owyhee Neurology Associates', '+1 208 555 0172', 'Medical records', 'Records request faxed for the MRI images on disc and all visit notes. Ten business days quoted.'],
  [-9, 8, 40, 'investigation', 'Snake River Regional Medical Center', '+1 208 555 0180', 'Health information management', 'Requested the full ER record from May, not the discharge paper.'],
  [-6, 9, 10, 'appeal', 'Basin Health Plan', '+1 208 555 0199', 'Appeals fax line', 'Expedited appeal faxed with the MRI report, the eye note and the audiogram. Confirmation 4471902.'],
  [-5, 15, 0, 'call', 'Owyhee Neurology Associates', '+1 208 555 0172', 'Nurse line', 'Asked for a call back from Dr. Okafor herself this week, and said why: brain, eye and ear.'],
  [-4, 8, 50, 'call', 'Owyhee Neurology Associates', '+1 208 555 0172', 'Dr. Okafor', 'She will see him Monday. Sent everything we have. She asked for the angiography as soon as it is done.'],
  [-2, 14, 30, 'call', 'High Desert Eye Clinic', '+1 208 555 0161', 'Dr. Sood', 'Read of the angiography: several branch occlusions right, one left. She named Susac syndrome. Report to neurology today.'],
];

/**
 * The permissions on file, the shape the authority route stores them in:
 * [days, hour, kind, fields]. Two records releases, the insurance
 * representative form, and the scope of work agreement, each signed by Joe
 * (the typed name is the signature the route gates on; there is no drawn
 * one, and the card says so).
 */
export const AUTHORITY = [
  [-13, 10, 'records', {
    clinicName: 'High Desert Eye Clinic', clinicAddress: '2400 Sagebrush Ave, Nampa, ID 83686', clinicPhone: '+1 208 555 0161',
    purpose: 'Evaluation of repeated episodes of visual loss in the right eye',
    categories: ['Visit notes', 'Imaging and photographs', 'Test results'], scopes: ['discuss', 'records', 'admin'],
  }],
  [-13, 10, 'records', {
    clinicName: 'Owyhee Neurology Associates', clinicAddress: '810 Canyon Rim Blvd, Nampa, ID 83687', clinicPhone: '+1 208 555 0172',
    purpose: 'Headaches, transient confusion, MRI findings under evaluation',
    categories: ['Visit notes', 'Imaging and reports', 'Test results'], scopes: ['discuss', 'records', 'admin'],
  }],
  [-12, 17, 'representative', {
    planName: 'Basin Health Plan', memberId: 'BHP-3391-8804',
    purpose: 'Appeal of the denial of fluorescein angiography, reference PA-2026-118842', scopes: ['discuss', 'admin'],
  }],
  [-10, 9, 'scope', { contactOk: true }],
];
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
  await patchDoc(env, `caseMeta/${id}`, { clientMsgAt: lastFromJoe }, { mask: ['clientMsgAt'] }).catch(() => {});
  // The first read runs on the next firing, so the 🧬 page and the reading
  // are there when the camera is.
  await markPending(env, 'case', id, { force: true }).catch(() => {});
  return { id, existing: false, messages: rows.length, documents: docs.length, milestones: MILESTONES.length, log: WORK_LOG.length, permissions: AUTHORITY.length };
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
