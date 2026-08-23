// Full Access: the scope note the client acknowledges before buying the tier.
//
// Written 2026-08-23, PENDING ERIC'S SIGN-OFF, and flagged in the PR. It is a
// NEW file rather than a fourth entry in waivers.js, because that file is
// frozen (CLAUDE.md) and this copy has not been through the legal review the
// three original forms have.
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
<p>In a standard case I work <strong>beside</strong> you: I read, I explain, and I prepare you to carry it to your own doctors and your insurer. With Full Access I work <strong>inside</strong> the case. I speak to your clinics and your insurance company myself, either with you on the line or alone once you have authorised it, and I write and file your insurance appeals.</p>
<h3>What is included</h3>
<p>Everything in a standard Advocacy Case, plus:</p>
<p>• Gathering records from up to <strong>five</strong> clinics or providers under your signed authorisation.<br>
• Up to <strong>three</strong> three-way calls with your clinics, about 45 minutes each, with you on the call.<br>
• Up to <strong>two</strong> insurance appeals: a first-level internal appeal, and one escalation after it if the first is denied.<br>
• An active window of <strong>90 days</strong>, starting the day your authorisation is signed.</p>
<p>Past those limits I am glad to keep going, but it becomes a separate agreement rather than something you have already bought. I would rather tell you that now than discover it with you later.</p>
<h3>What I need from you before anything starts</h3>
<p>Two separate documents, because they do two different legal jobs and neither one covers the other:</p>
<p>• A <strong>records authorisation</strong> for each clinic, letting them release your records to me.<br>
• An <strong>authorised representative designation</strong>, letting me deal with your insurer on your behalf.</p>
<p>Both are signed on your case page and either can be withdrawn in writing at any time. Until they are signed I cannot begin, and the 90 days does not start.</p>
<h3>What Full Access is NOT</h3>
<p>• <strong>Not legal representation.</strong> I am a patient advocate, not an attorney. Insurance appeals are an administrative process, not litigation, and if your situation needs a lawyer I will say so plainly rather than take it on.<br>
• <strong>Not medical care.</strong> Everything in the standard disclaimer still applies without exception: no diagnosis, no treatment, no prescriptions, no doctor-patient relationship.<br>
• <strong>Not a promised outcome.</strong> No one can guarantee an insurer will overturn a denial or a clinic will release records quickly. I can promise the work, the deadlines, and honesty about how it is going.</p>
<h3>Timelines, honestly</h3>
<p>Records requests can take up to 30 days by law and often use most of it. Specialist referrals commonly run 4 to 12 weeks. Insurers generally answer an internal appeal in 30 to 60 days, faster only when the case is genuinely urgent. Full Access does not make any of those clocks run faster; it means somebody who knows them is running yours.</p>
<h3>Payment and refunds</h3>
<p>The Full Access fee is charged once, at the price shown when you buy it, and you can spread it over time at checkout if that is what makes it possible. If I cannot get the authority to act, because the authorisation is never signed or your insurer details never arrive, and no records request has gone out, the fee refunds down to the price of a standard Advocacy Case, which is the work I will have done. Once records requests are out, the standard non-refundable terms apply.</p>
<h3>Your privacy, unchanged</h3>
<p>Records I obtain on your behalf live in your case file under exactly the same protections as anything you upload yourself: your advocate and you, nobody else. This does not make me a HIPAA covered entity, and it does not change the data handling you already agreed to.</p>`,
};

/**
 * The one-line plain-English summary shown on the closed accordion, matching
 * AGREEMENT_PLAIN in book.js. It lives here beside the copy it describes so
 * the two cannot drift.
 */
export const FULL_ACCESS_PLAIN = 'What I do, what I need from you, and where it stops.';
