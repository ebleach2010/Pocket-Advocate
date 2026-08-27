// Hands-Off Case Management: the scope note the client acknowledges before
// buying the tier. Rendered by the booking flow and by the case page.
//
// It sits beside public/js/waivers.js rather than inside it, because that
// file is frozen by the repo's standing instructions.
//
// This file is downloaded by every client, so it holds the document and
// nothing else. Open questions about the wording live in the repo's own
// instructions file, never here - a client reading the source of an
// agreement they are about to sign should find the agreement, not a note
// about it.

/**
 * The scope note, in the shape the booking flow already renders:
 * { id, title, body } with body as an HTML string, exactly like WAIVERS.
 * The `.agreement` markup and its scroll-to-enable gate are reused as they
 * stand, so this inherits the whole look and the whole proof-of-exposure
 * behaviour for free.
 */
export const FULL_ACCESS_TERMS = {
  id: 'fullAccess',
  title: 'Hands-Off Case Management: what it covers',
  body: `
<h3>What is different about Hands-Off Case Management</h3>
<p>In a standard case I work <strong>beside</strong> you: I read, I explain, and I prepare you to carry it to your own doctors and your insurer. With Hands-Off Case Management I work <strong>inside</strong> the case. <strong>I do the legwork.</strong> I speak to your clinics and your insurance company myself, either with you on the line or alone once you have authorised it, and I write your insurance appeals.</p>
<h3>What is included</h3>
<p>Everything in a standard Advocacy Case, at no separate charge, which is our initial case overview call, my review of your records, and the written report. Then:</p>
<p>• <strong>Check-in calls, at least twice a month</strong> through the window, by phone or video, so the case runs on a rhythm instead of going quiet. The check-ins are part of the service, not an option: you do not get to go without checking in, because a case I cannot reach you about is a case I cannot run. A check-in you miss or decline is never a basis for a refund. If something moves between check-ins, I add extra ones at my discretion, at no charge.<br>
• Calls to your clinics and your insurer on your behalf, <strong>as many as the case needs</strong>. I do not count them and you will never be told you have used them up.<br>
• <strong>Two insurance appeal letters</strong>: a first-level internal appeal, and one escalation after it if the first is denied.<br>
• <strong>Telehealth appointment advocacy, included</strong>: I can join a telehealth visit with one of your own providers by video and advocate live. I confirm each one, and I never record your provider's visit.<br>
• An active window of <strong>30 days per month you take</strong>, starting the day your first month begins.</p>
<h3>How the months work, and the two appeals</h3>
<p>This is billed <strong>a month at a time</strong>. I ask you to plan for about two months, because that is what most of these honestly take, but you are not locked into anything: at the end of each month you decide whether to carry on, and the price never changes for continuing.</p>
<p>You do not simply buy this. You <strong>ask</strong>, and I answer personally, because I carry two of these at once and I would rather turn you down than take your money and do it badly. Asking costs nothing and I do not take a card to do it. If I say no, nothing is charged and you will be told why.</p>
<p>The window governs the <strong>coordination</strong>: the check-ins, the calls I make for you, the records I chase, the first appeal I file. When your last paid month ends, the case wraps up - not at any particular call, and never by surprise, because we will have spoken at least twice a month on the way there.</p>
<p>The <strong>second appeal letter does not expire with the window</strong>, and it cannot, because it does not exist until your insurer denies the first one. They generally take 30 to 60 days to answer, which can be past your last paid month. Whenever that denial arrives, I write the escalation. That obligation outlives the window and I am not going to pretend otherwise in order to make the paperwork tidier.</p>
<p>Carrying on is <strong>one more month at the same price</strong>, from the Case Enhancements tab on your case page, as many times as you need it. It never costs more for continuing. You will be told the price before anything is charged, and you are never obliged to take it.</p>
<h3>Your readiness checklist, and the clock</h3>
<p>Before I can act for you, your case page asks you to complete a short checklist: two separate permissions, because they do two different legal jobs and neither one covers the other:</p>
<p>• <strong>One authorisation, signed once.</strong> It covers the clinics, hospitals, labs, pharmacies, insurers and billing offices involved in your care, so a new doctor part way through does not mean a new form. It lets them release your records to me and lets me speak with them about your care. It runs for twelve months unless you choose a shorter time when you sign it, and it never runs open ended. Signed with it is a one page notice your clinics keep in your chart saying you have involved me. That page does not make me your health-care decision maker, and it says so on its face.<br>
• An <strong>authorised representative designation</strong>, letting me deal with your insurer on your behalf.</p>
<p>Some offices will only accept a form with their own name on it. When that happens I prepare one for you from what you have already given me, and you sign that too. It is an extra, not a replacement: your main authorisation stays in force either way.</p>
<p>Both are signed on your case page and either can be withdrawn in writing at any time. Until the checklist is done I cannot phone anyone on your behalf, and I want to be straight with you about the consequence: <strong>the month runs from the day it starts, whether or not the checklist is done.</strong> How fast you finish your part is up to you. Finish it early and you get all of it.</p>
<h3>What Hands-Off Case Management is NOT</h3>
<p>• <strong>Not legal representation.</strong> I am a patient advocate, not an attorney. Insurance appeals are an administrative process, not litigation, and if your situation needs a lawyer I will say so plainly rather than take it on.<br>
• <strong>Not medical care.</strong> Everything in the standard disclaimer still applies without exception: no diagnosis, no treatment, no prescriptions, no doctor-patient relationship.<br>
• <strong>Not a promised outcome.</strong> No one can guarantee an insurer will overturn a denial or a clinic will release records quickly. I can promise the work, the deadlines, and honesty about how it is going.</p>
<h3>Timelines, honestly</h3>
<p>Records requests can take up to 30 days by law and often use most of it. Specialist referrals commonly run 4 to 12 weeks. Insurers generally answer an internal appeal in 30 to 60 days, faster only when the case is genuinely urgent. Hands-Off Case Management does not make any of those clocks run faster; it means somebody who knows them is running yours.</p>
<h3>Payment and refunds</h3>
<p>You are charged <strong>one month at a time</strong>, at the price you were quoted when you asked - not whatever the rate has moved to while your request sat with me. Your Advocacy Case fee comes off your first month, so you never pay twice for the same work. Nothing is charged unless and until I approve your request.</p>
<p>If I cannot get the authority to act, because the authorisation is never signed or your insurer details never arrive, and no records request has gone out, the first month refunds down to the price of a standard Advocacy Case, which is the work I will have done. Once records requests are out, the standard non-refundable terms apply. A check-in you miss or decline is never a refund basis. Each further month is charged only if you ask for it.</p>
<h3>Your privacy, unchanged</h3>
<p>Records I obtain on your behalf live in your case file under exactly the same protections as anything you upload yourself: your advocate and you, nobody else. This does not make me a HIPAA covered entity, and it does not change the data handling you already agreed to.</p>`,
};

/**
 * The one-line plain-English summary shown on the closed accordion, matching
 * AGREEMENT_PLAIN in book.js. It lives here beside the copy it describes so
 * the two cannot drift.
 */
export const FULL_ACCESS_PLAIN = 'What I do, what I need from you, and where it stops.';
