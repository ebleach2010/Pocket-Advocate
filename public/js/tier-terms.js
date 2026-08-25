// Full Access: the scope note the client acknowledges before buying the tier.
//
// Written 2026-08-23, PENDING ERIC'S SIGN-OFF, and flagged in the PR. It is a
// NEW file rather than a fourth entry in waivers.js, because that file is
// frozen by the repo's standing instructions, and this copy has not been
// through the legal review the three original forms have.
//
// Two hard constraints on the wording, both from the frozen file it sits
// beside, and neither may be contradicted here:
//
//   1. waivers.js states "This service is not a HIPAA covered entity." That
//      stays true under Full Access. Eric receives records as the client's
//      own authorised recipient, not as a provider, a plan, a clearinghouse,
//      or anyone's business associate. Nothing below implies otherwise.
//   2. The disclaimer's framing is advocacy only: never diagnosis, treatment
//      plan, or medical advice. Full Access widens what Eric DOES, never what
//      he claims to be.
//
// Every number in here drives a real limit in the code. If one changes, both
// change together, or the document is lying.
//
// That claim used to be false, and an audit caught it: the previous version
// promised five clinics, three calls, two appeals and ninety days, and NOT
// ONE of those was counted anywhere. The rewrite removes every number the
// code does not enforce and keeps two that it does:
//
//   60 days  -> fullAccessWindowEnd() in worker/index.js, which gates
//               check-in scheduling and the automatic closure.
//   2 appeal -> appealsUsed() in worker/index.js, checked before a letter is
//   letters     written. Filed letters are what count; redrafting is free.
//
// "Every two weeks" is enforced as a FLAG, not an automation, and the copy
// says "runs on a rhythm" rather than promising a machine: Eric schedules
// each check-in himself, and his dashboard marks any tier case that has
// gone 14 days without one (CHECKIN_DAYS in worker/index.js, checkInDue in
// admin.js). "As many calls as the case needs" is deliberately uncounted,
// which is why it is phrased as a promise rather than an allowance.

/**
 * The scope note, in the shape the booking flow already renders:
 * { id, title, body } with body as an HTML string, exactly like WAIVERS.
 * The `.agreement` markup and its scroll-to-enable gate are reused as they
 * stand, so this inherits the whole look and the whole proof-of-exposure
 * behaviour for free.
 */
export const FULL_ACCESS_TERMS = {
  id: 'fullAccess',
  title: 'Full Access: what it covers',
  body: `
<h3>What is different about Full Access</h3>
<p>In a standard case I work <strong>beside</strong> you: I read, I explain, and I prepare you to carry it to your own doctors and your insurer. With Full Access I work <strong>inside</strong> the case. I speak to your clinics and your insurance company myself, either with you on the line or alone once you have authorised it, and I write your insurance appeals.</p>
<h3>What is included</h3>
<p>Everything in a standard Advocacy Case, at no separate charge, which is our initial case overview call, my review of your records, and the written report. Then:</p>
<p>• <strong>A check-in call with you every two weeks</strong> through the window, so the case runs on a rhythm instead of going quiet. If something moves between check-ins, I can add extra ones at my discretion, at no charge.<br>
• Calls to your clinics and your insurer on your behalf, <strong>as many as the case needs</strong>. I do not count them and you will never be told you have used them up.<br>
• <strong>Two insurance appeal letters</strong>: a first-level internal appeal, and one escalation after it if the first is denied.<br>
• <strong>Telehealth appointment advocacy, included</strong>: I can join a telehealth visit with one of your own providers by video and advocate live. I confirm each one, and I never record your provider's visit.<br>
• An active window of <strong>60 days</strong>, starting on the day of our first call.</p>
<h3>About that 60 days, and the two appeals</h3>
<p>The window governs the <strong>coordination</strong>: the check-ins, the calls I make for you, the records I chase, the first appeal I file. When the window ends, the case wraps up - not at any particular call, and never by surprise, because we will have spoken every two weeks on the way there.</p>
<p>The <strong>second appeal letter does not expire with the window</strong>, and it cannot, because it does not exist until your insurer denies the first one. They generally take 30 to 60 days to answer, which can be past the window itself. Whenever that denial arrives, I write the escalation. That obligation outlives the 60 days and I am not going to pretend otherwise in order to make the paperwork tidier.</p>
<p>If you want more coordination time than 60 days, another month is available, and so is another two. You will be told the price before anything is charged, and you are never obliged to take it.</p>
<h3>What I need from you before anything starts</h3>
<p>Two separate documents, because they do two different legal jobs and neither one covers the other:</p>
<p>• A <strong>records authorisation</strong> for each clinic, letting them release your records to me.<br>
• An <strong>authorised representative designation</strong>, letting me deal with your insurer on your behalf.</p>
<p>Both are signed on your case page and either can be withdrawn in writing at any time. Until they are signed I cannot phone anyone on your behalf, and I want to be straight with you about the consequence: <strong>the 60 days runs from our first call whether or not you have signed.</strong> The clock is not a punishment, it is just the only date we both already know. Sign early and you get all of it.</p>
<h3>What Full Access is NOT</h3>
<p>• <strong>Not legal representation.</strong> I am a patient advocate, not an attorney. Insurance appeals are an administrative process, not litigation, and if your situation needs a lawyer I will say so plainly rather than take it on.<br>
• <strong>Not medical care.</strong> Everything in the standard disclaimer still applies without exception: no diagnosis, no treatment, no prescriptions, no doctor-patient relationship.<br>
• <strong>Not a promised outcome.</strong> No one can guarantee an insurer will overturn a denial or a clinic will release records quickly. I can promise the work, the deadlines, and honesty about how it is going.</p>
<h3>Timelines, honestly</h3>
<p>Records requests can take up to 30 days by law and often use most of it. Specialist referrals commonly run 4 to 12 weeks. Insurers generally answer an internal appeal in 30 to 60 days, faster only when the case is genuinely urgent. Full Access does not make any of those clocks run faster; it means somebody who knows them is running yours.</p>
<h3>Payment and refunds</h3>
<p>The Full Access fee is charged once, at the price shown when you buy it, and you can spread it over time at checkout if that is what makes it possible. If I cannot get the authority to act, because the authorisation is never signed or your insurer details never arrive, and no records request has gone out, the fee refunds down to the price of a standard Advocacy Case, which is the work I will have done. Once records requests are out, the standard non-refundable terms apply. Extensions are charged separately, only if you ask for one.</p>
<h3>Your privacy, unchanged</h3>
<p>Records I obtain on your behalf live in your case file under exactly the same protections as anything you upload yourself: your advocate and you, nobody else. This does not make me a HIPAA covered entity, and it does not change the data handling you already agreed to.</p>`,
};

/**
 * The one-line plain-English summary shown on the closed accordion, matching
 * AGREEMENT_PLAIN in book.js. It lives here beside the copy it describes so
 * the two cannot drift.
 */
export const FULL_ACCESS_PLAIN = 'What I do, what I need from you, and where it stops.';
