// How the service runs: no guarantees, when Eric can stop, and what happens
// to a case if his own life gets in the way.
//
// A NEW module rather than a fourth entry in waivers.js, which is frozen by
// the repo's standing instructions. These clauses are additive - they do not
// contradict anything in the three original forms - so they can stand beside
// them without either document having to be reopened.
//
// One thing here is deliberately NOT stated, and it matters: waivers.js still
// says "If I reschedule your discussion more than once, you are entitled to a
// full refund on request", and Eric has asked for that to go. Removing it
// means editing the frozen, reviewed document, and it cannot be done by
// writing a contradicting sentence in a second file - a client who ticks both
// would have been handed a refund right in one and had it taken away in the
// other. It is flagged for him rather than fudged here.
//
// Written 2026-08-24, PENDING ERIC'S SIGN-OFF, and flagged in the PR.

/**
 * The scope note, in the shape the booking flow already renders:
 * { id, title, body } with body as an HTML string, exactly like WAIVERS and
 * FULL_ACCESS_TERMS. It inherits the `.agreement` markup, the scroll-to-end
 * gate and the acknowledgment record for free.
 */
export const SERVICE_TERMS = {
  id: 'service',
  title: 'How this works, and what I do not promise',
  body: `
<h3>No guarantees</h3>
<p>I cannot promise you an outcome, and I will not. Not that a denial gets overturned, not that a referral comes through, not that a clinic returns a call, not that anything I find changes what your doctors decide. Those are other people's decisions and other people's systems, and anyone who tells you they can guarantee a result there is selling you something.</p>
<p><strong>Guarantees of any sort are not part of this agreement.</strong> What I owe you is the work of this agreement, fulfilled to the best of my ability: I will read what you give me properly, tell you the truth about what I see, meet the deadlines that are mine to meet, and say so plainly when something is not going your way. You are paying for effort and judgement, carefully applied. You are not paying for a result, and you are not buying insurance against a bad one.</p>
<h3>I may close a case</h3>
<p>I reserve the right to end a case at my discretion, for any reason. In practice that means things like: the work turns out to need a lawyer or a clinician rather than an advocate, I cannot get the access I need to be useful, the relationship stops being a workable one, or my own circumstances change.</p>
<p>If I close your case, <strong>the reason is written into your case</strong>, where both of us can see it, in the same words I would say to your face.</p>
<p>And <strong>everything in it stays yours</strong>. Your file, your report, your documents, our whole message history: all of it remains on your case page to read and download, and none of it is deleted or hidden.</p>
<p><strong>You can still leave a review</strong>, and I would rather you did. A closed case is exactly the situation where somebody's honest account is worth the most, and a service that only collects feedback from the people it kept happy is not collecting feedback at all.</p>
<h3>If I have to pause</h3>
<p>I am one person. My health, my family, or something else may occasionally make me unable to work for a stretch, and I would rather say that now than go quiet on you later.</p>
<p>If that happens I can put your case on hold. Your page will say so plainly, and <strong>every deadline on your case stops with it</strong>: the report date, your follow-up window, and any coordination window you have bought. When I pick it back up, all of that time is put back, so a pause costs you nothing and you resume exactly where you were.</p>
<p>Your page, your files and your chat stay open the whole time. You can message me whenever you like and I will read it when I am back.</p>
<p><strong>One clock does not pause, and I want you to see it here rather than find out later.</strong> If your insurer or a government programme has given you a deadline to appeal or to respond, that clock belongs to them and it keeps running whatever I do. If one of those is close while your case is on hold, tell me, and it comes before everything else.</p>
<h3>Scheduling</h3>
<p>Occasionally I will need to move a call. I will give you as much notice as I have and we will find another time. Booking is done in good faith on both sides.</p>`,
};

/**
 * The one-line plain-English summary shown on the closed accordion, matching
 * AGREEMENT_PLAIN in book.js. It lives here beside the copy it describes so
 * the two cannot drift.
 */
export const SERVICE_TERMS_PLAIN = 'What I promise, what I do not, and what happens if I have to stop.';
