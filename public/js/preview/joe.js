// Joe Bloe, a case that is not a case: the story behind both the showcase on
// Eric's side (worker/showcase.js builds it into the database) and the public
// "Preview a case" (js/preview/seed.js builds it into a visitor's own tab).
//
// Eric, 2026-09-06: "Create a completely fake case for me to show off on
// YouTube. Enter a chat log of maybe 50 back and forth messages, fake name,
// address, phone number, rare disease, fake document uploads, everything to
// make it an interactable environment where I can show how the system works
// without exposing patient information... Name the guy Joe Bloe."
// And 2026-10-15: "Every time we add something seeable from the client side,
// it gets secretly added to this." One story, so a new piece lands in both.
//
// Everything here is invented: the man, his address, his phone, his doctors,
// his clinics, his insurer, his results. The illness is Susac syndrome: rare,
// autoimmune, the small arteries of the brain, the retina and the inner ear,
// usually first called migraine, stress or early MS.
//
// Served to anyone, so nothing in it may name a tool, a reading or anything
// else a client is not meant to see.

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
export function at(now, days, hour = 9, minute = 0) {
  // The day is the MST day (2026-10-16). Taking the UTC date first put
  // "today" a day ahead between midnight and 7am UTC, so the preview's newest
  // messages and files sat in the future and a reply sorted above them.
  const t = new Date(now.getTime() - 7 * 3600_000 + days * DAY);
  // The app prints every time on the fixed MST clock (UTC minus seven, no
  // daylight saving), so a 9 here reads as 9:00 AM on the page.
  t.setUTCHours(hour + 7, minute, 0, 0);
  return t;
}
const dayStr = (t) => t.toISOString().slice(0, 10);
const longDay = (t) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', month: 'long', day: 'numeric', year: 'numeric' }).format(t);

/**
 * The chat, oldest first: [days, hour, minute, who, text, attachment?].
 * Fifty messages, twenty-five each way. Eric's are warm and plain (his word,
 * 2026-10-16: "more friendly and softer toned").
 * An attachment names a document from DOCS below, which the build uploads
 * to the case's chat-files folder and pins to that row.
 */
export const CHAT = [
  [-20, 9, 12, 'joe', "Hi Eric. Thank you so much for taking this on. The short version: five months of headaches, a blind spot in my right eye that comes and goes, and my left ear went muffled three weeks ago. Two doctors said migraine and stress, and I'm not sure that's the whole story."],
  [-20, 9, 40, 'eric', "Thank you for reaching out, Joe. I'm really glad you did, and I don't think we should settle for that answer yet either. Let's take it one step at a time: what happened first, what has been tested, and who has seen you. Could you start with the very first symptom and roughly when it began?"],
  [-20, 10, 5, 'joe', 'Headaches started around early April. Not like my old ones. Behind the eyes, worse in the morning. Then in June I had a patch missing in the right eye for about a day. It came back. Since then it has happened four times.'],
  [-20, 10, 18, 'eric', "Thank you, that's really helpful. A blind spot that comes and goes is worth looking at closely, the back of the eye and its blood supply, before anyone settles on migraine. Has anyone looked at the back of your eye with the pupil dilated, and did they take a picture of the blood vessels (a fluorescein angiography)?"],
  [-20, 10, 30, 'joe', 'Eye doctor in July, dilated. Said the retina looked okay, maybe a small pale patch, told me to come back if it got worse. No dye test.'],
  [-20, 10, 41, 'eric', "That pale patch could matter, so I'd love to see their note. Would you ask the eye clinic for the visit note and any photos? You can upload them right here or on the Documents tab, whichever is easiest."],
  [-19, 8, 2, 'joe', 'Requested. They said 5 to 7 business days. Also, the hearing thing. The ENT did a hearing test last week. Left ear is down in the low tones. He said probably a virus or fluid.'],
  [-19, 8, 30, 'eric', "Thank you for chasing that. Losing low tones in one ear, alongside the vision spots and the headaches, is a pattern I want to look at carefully. I won't put a name on it yet. When you can, could you send me the hearing test itself (the audiogram) and the ENT's note?"],
  [-18, 17, 45, 'joe', 'I forgot to mention, I went to the ER in May when the headache got bad and I was confused for a couple of hours. Here is the discharge paper.', 'er-discharge.pdf'],
  [-18, 18, 20, 'eric', "Thank you for sending this, and I'm sorry that day was so frightening. They did a CT without contrast and called it normal, but a CT can't show what we need to see here. Did you have an MRI at any point?"],
  [-18, 18, 32, 'joe', 'Yes, the neurologist ordered one in July. She said it showed nonspecific white matter changes and that it could be migraine or early MS. She wants to repeat it in six months.'],
  [-18, 18, 50, 'eric', 'Six months feels like a long time to wait while your hearing and vision are changing. If you can, please get me the MRI report, and the images too if the portal lets you download them. The report is the most important part.'],
  [-15, 12, 10, 'joe', "Here's the MRI report from the portal.", 'mri-report.pdf'],
  [-15, 13, 5, 'eric', "Thank you, this is the most helpful thing so far. The report describes small spots in the middle of the corpus callosum (the bridge between the two halves of the brain). That spot isn't typical for migraine, and it isn't the usual pattern for MS either. It fits a short list of rare conditions, and one of them is very treatable."],
  [-15, 13, 12, 'joe', 'Which one?'],
  [-15, 13, 30, 'eric', "I'd rather not guess out loud until I've seen the eye pictures and the hearing test. What I can tell you is that the brain, the eye and the ear together are what matters, and nobody has looked at all three side by side yet. That's exactly what I'm here to do."],
  [-15, 13, 35, 'joe', 'Okay. What should I do right now?'],
  [-15, 13, 50, 'eric', "Here are three small steps. First, call the eye clinic and ask about a fluorescein angiography; you can ask them to rule out a branch retinal artery occlusion. Second, ask the neurologist's office for a copy of your MRI images on a disc. Third, keep a short daily log here: headache from 0 to 10, vision, hearing, and anything odd with memory or mood. It doesn't need to be perfect."],
  [-14, 8, 0, 'joe', 'Our call is at 10 today, right? Video.'],
  [-14, 8, 5, 'eric', "Yes, and I'm looking forward to it. If you can, have the ER paper and the MRI report open, and we'll walk through your whole timeline together."],
  [-14, 11, 20, 'joe', 'That was the first time anyone let me tell the whole story. Thank you.'],
  [-14, 11, 45, 'eric', 'Thank you for trusting me with it. Your report will be ready in two weeks. In the meantime, the eye clinic is the most important next step. Were you able to call them?'],
  [-13, 9, 30, 'joe', 'Called. The eye clinic says the dye test needs prior authorization from Basin Health and the earliest slot is in three weeks.'],
  [-13, 9, 50, 'eric', "Three weeks is too long with everything you're going through. I'd be glad to call the clinic myself and ask them to send the authorization as urgent. Is it okay with you if I speak with them on your behalf? Just say yes here and I'll note it."],
  [-13, 9, 52, 'joe', 'Yes. Full permission.'],
  [-13, 14, 10, 'eric', "I spoke with the scheduler and the authorization team. The urgent request went in with your MRI findings attached, and they've moved you to Thursday if your plan approves it. I've logged the call so you can see it."],
  [-12, 16, 0, 'joe', 'Basin Health called me. Denied. They said the dye test is not medically necessary for migraine.'],
  [-12, 16, 20, 'eric', "I'm sorry, I know that's discouraging. They're judging it as migraine, a diagnosis nobody has actually confirmed, and that's the heart of our appeal: the MRI location, the hearing loss and the vision loss. When the denial letter arrives, please upload it, and I'll draft the appeal for you to sign."],
  [-11, 10, 5, 'joe', "Here are my labs from May, for whatever they're worth.", 'labs.pdf'],
  [-11, 10, 40, 'eric', "Thank you. They're mostly normal, which is actually useful. Your ESR (a blood test for inflammation) is a little high. Nothing here points to an infection. On its own it doesn't prove anything, but it helps the appeal, because the usual explanations aren't there."],
  [-10, 9, 15, 'joe', "I'd like you to run this whole thing. I can't keep track of it and work. Let's do the full service."],
  [-10, 9, 30, 'eric', "Of course. From today I'll make the calls, chase the records and handle the appeal, and you'll still see everything here. All I'll ask of you is the daily log and letting me know when anything changes."],
  [-9, 7, 50, 'joe', "Log: headache 6, right eye clear, left ear the same. Forgot my sister's number yesterday, which scared me."],
  [-9, 8, 10, 'eric', "Thank you for telling me, and I'm sorry, that must have been scary. Please keep writing those moments down whenever they happen. This morning I asked the neurology office for your MRI images and visit notes, and the ER for your full record, not just the discharge paper."],
  [-8, 18, 30, 'joe', 'Log: headache 8 this morning, better by noon. Had a patch in the right eye again for maybe twenty minutes.'],
  [-8, 18, 45, 'eric', 'Thank you for logging it. Please keep one thing in mind: if a patch lasts more than an hour, if one appears in the other eye, or if the confusion comes back, go to the ER rather than messaging me first. Tell them possible retinal artery occlusion, in exactly those words.'],
  [-7, 12, 0, 'joe', 'Understood. The denial letter came. I uploaded it on the Documents tab.'],
  [-7, 12, 30, 'eric', "Got it, thank you. I've drafted the appeal, and it's in your Documents as a PDF. Have a read, sign the last page, and I'll fax it with your MRI report and the ENT note attached. Your report is ready today, too."],
  [-6, 9, 0, 'joe', "I read the report twice. It's the clearest thing anyone has written about me. Signed the appeal."],
  [-6, 9, 20, 'eric', "That means a lot, thank you. I faxed the appeal to Basin Health at 9:10, and the confirmation number is in your log. Expedited appeals get an answer within 72 hours by their own rules, and I'll call them myself if we haven't heard by then."],
  [-5, 15, 40, 'joe', 'The ENT sent the hearing test.', 'audiogram.pdf'],
  [-5, 16, 0, 'eric', "Thank you. This is the third piece: weaker hearing in the low tones on the left, the pattern I'd hoped not to see. Brain, eye and ear together. I've spoken with your neurologist's nurse and asked the doctor herself to call back this week."],
  [-4, 8, 45, 'joe', 'Log: headache 4. Slept nine hours. Left ear ringing now too.'],
  [-4, 9, 0, 'eric', "I'm glad you got some real sleep. Ringing is common with that kind of hearing change, and I've noted it. Good news: your neurologist's office called back, she'd like to see you Monday, and she asked me to send everything we have. It's sent."],
  [-3, 11, 30, 'joe', 'Basin Health approved the dye test. Thursday 8am at the eye clinic.'],
  [-3, 11, 40, 'eric', "That's wonderful news. Just bring yourself and someone to drive you home. The dye can make you feel warm for a moment, which is completely normal. I'll call the clinic afterwards to hear what they found."],
  [-2, 14, 0, 'joe', 'Dye test done. The doctor said there were several blocked small artery branches in the right eye and one in the left I did not even know about. She used the word Susac. Is that the thing you would not say?'],
  [-2, 14, 20, 'eric', "Yes. Susac syndrome. It affects the brain, the eye and the ear, and the good news is that it's treatable. This diagnosis is hers, not mine, and she's the right person to make it. Monday's visit is now about treatment rather than whether something is wrong. I'll send her the eye report today."],
  [-1, 19, 10, 'joe', 'What should I ask on Monday?'],
  [-1, 19, 40, 'eric', "Here are four questions, in this order. One, does she agree it's Susac syndrome. Two, when can treatment start and what comes first (steroids are usual, sometimes IVIG). Three, who will watch your eyes and ears while it starts. Four, what would a bad day look like that means going to the ER. I've put these on your Agenda tab so you can read them from your phone. You've done so well getting here."],
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
        '1. Nonspecific white matter changes, including several central callosal lesions. Possible causes include demyelinating disease, migraine related changes, and small vessel ischemic change. Clinical correlation recommended.',
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
        'Left sudden onset low frequency sensorineural hearing loss. Possible causes: viral labyrinthitis, endolymphatic hydrops, less likely vascular.', '',
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
        `1. MRI of the brain, ${d(-60)}: multiple small lesions in the central fibers of the corpus callosum, several rounded, one with central T1 hypointensity. The radiologist lists demyelinating disease and small vessel ischemic change among the possible causes. Migraine does not produce central callosal lesions.`,
        `2. Dilated eye examination, ${d(-58)}: an area of retinal whitening along the inferotemporal arteriole of the right eye with sheathing of the vessel wall, recorded as a possible resolved branch retinal artery occlusion. The examining ophthalmologist recommended angiography if the episodes recurred. They have recurred, three times.`,
        `3. Audiogram, ${d(-12)}: a new moderate low frequency sensorineural hearing loss on the left, with the right ear normal.`, '',
        '# Why a delay jeopardizes his health',
        'The combination of central callosal lesions, branch retinal artery occlusions and low frequency hearing loss is the recognized triad of a rare, treatable autoimmune condition of the small arteries of the brain, retina and inner ear. Untreated it causes permanent vision loss, permanent hearing loss and cognitive injury. Fluorescein angiography is the test that establishes the retinal component and is required to start treatment. A three week delay is a three week window of untreated arterial occlusion.', '',
        '# What I am asking for',
        'Approval of fluorescein angiography of both eyes on an expedited basis, within 72 hours, under the expedited appeal provision of your notice. The MRI report, the eye clinic note and the audiogram are attached.', '',
        'Please direct any question to me at the number on file for this case. Joe Bloe has signed below.', '',
        'Eric Leach, patient advocate, on behalf of Joe Bloe', '',
        'Signed: ____________________   Joe Bloe',
      ],
    },
    {
      name: 'case-report.pdf', folder: 'report', days: -6,
      lines: [
        '# Case report for Joe Bloe', `${d(-6)}    Prepared by Eric Leach, patient advocate`, '',
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
/**
 * "For our next call", the list he and the client both add to, in the shape
 * /api/agenda writes: [days, hour, who, text]. Two of Joe's and one of his.
 */
export const AGENDA = [
  [-3, 18, 'joe', 'How long does the first round of treatment last, and what do the infusions involve?'],
  [-2, 16, 'eric', 'Go through the angiography report line by line: which branches, which eye, and what it changes.'],
  [-1, 20, 'joe', 'A hearing test again before treatment starts, so there is a baseline?'],
];

/** A telehealth visit he is attending, confirmed, six days out: what the client sees under their visits. */
export const TELEHEALTH = { days: 6, hour: 13, minute: 30, clinicName: 'Owyhee Neurology Associates', provider: 'Dr. Okafor' };

/** The next Full-Service check-in, three days out: the line that names it. */
export const CHECK_IN = { days: 3, hour: 11, minute: 0 };

/**
 * What the showcase carries, one entry per thing a client can see on their
 * case (Eric, 2026-10-15: "Every time we add something seeable from the
 * client side, it gets secretly added to this."). tools/suites/opencases.mjs
 * reads this list and checks the build writes every entry.
 */
export const SHOWCASE_COVERS = [
  'chat', 'documents', 'appointment', 'report', 'fullService', 'milestones', 'workLog', 'permissions',
  'agenda', 'telehealth', 'checkIn', 'recording',
];


/** A short silent recording, so the recording row on a case has something to play. */
export function silentWav(seconds = 2) {
  const rate = 8000;
  const n = rate * seconds;
  const buf = new Uint8Array(44 + n);
  const v = new DataView(buf.buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i); };
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
  str(36, 'data'); v.setUint32(40, n, true);
  buf.fill(128, 44);
  return buf;
}
