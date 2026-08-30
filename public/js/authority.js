// The documents Full Access runs on, and they are not interchangeable.
//
// Written 2026-08-23, PENDING ERIC'S SIGN-OFF, flagged in the PR. A NEW file,
// not an addition to waivers.js, which is frozen.
//
// THREE DOCUMENTS SINCE 2026-08-29, with different lives. Eric: "Remove
// those. I have those sent manually. All I need is scope of work agreement.
// The rest I handle." So the records authorisation and the representative
// designation are never offered for signing in the app: they exist here as
// the blank forms he sends by hand from the case page, signed however he and
// the client arrange it. The SCOPE OF WORK AGREEMENT (third, below) is the
// one document signed in the app, because it is the agreement the case runs
// on and he needs it on file the day Full-Service opens.
//
//   1. A RECORDS AUTHORISATION, one per clinic. This is what lets a provider
//      hand your records to somebody who is not you. Its required elements
//      come from 45 CFR 164.508(c): a specific description of the information,
//      who may disclose it, who may receive it, the purpose, an expiry, the
//      signature, and three statements the rule requires verbatim in substance
//      (the right to revoke and how, that treatment cannot be conditioned on
//      signing, and that re-disclosed information may no longer be protected).
//      Miss one and the form is defective, which in practice means a records
//      department rejects it and three weeks are gone.
//
//   2. An AUTHORISED REPRESENTATIVE DESIGNATION. This is what lets somebody
//      argue with your insurer for you. ERISA plans must have a procedure for
//      it (29 CFR 2560.503-1(b)(4)); Medicare uses its own appointment form.
//      A records authorisation does NOT confer it, and clients conflate the
//      two constantly, which is why they are two documents here and not one
//      with a longer title.
//
// Both are PURE FUNCTIONS returning text, following duty.js: copy this
// load-bearing gets a surface a test can pin, and a pure function is that
// surface. Do not inline them into a template.
//
// Nothing here makes the service a HIPAA covered entity, and waivers.js says
// so. Eric receives records as the patient's own authorised recipient, which
// is a different thing entirely.

/**
 * Record categories that need their own explicit permission rather than
 * riding along with "my records". Each is separately protected, and a blanket
 * tick is exactly the consent problem these rules exist to prevent. The
 * client opts into each one or it stays out of the request.
 */
export const SENSITIVE_CATEGORIES = [
  {
    id: 'mentalHealth',
    label: 'Mental health records',
    note: 'Notes and records from psychiatric or psychological care. Psychotherapy notes kept separately by a therapist need their own separate authorisation and are never included here.',
  },
  {
    id: 'substanceUse',
    label: 'Substance use treatment records',
    note: 'Federally protected under 42 CFR Part 2, with its own consent rules and its own redisclosure limits.',
  },
  {
    id: 'hiv',
    label: 'HIV and other communicable disease records',
    note: 'Most states protect these separately from the rest of your chart.',
  },
  {
    id: 'genetic',
    label: 'Genetic testing records',
    note: 'Results and reports from genetic or genomic testing.',
  },
  {
    id: 'reproductive',
    label: 'Reproductive and sexual health records',
    note: 'Including pregnancy, fertility, and related care.',
  },
];

/**
 * What the advocate is authorised to DO with this provider - the half that
 * makes the release a working instrument rather than a records slip (Eric,
 * 2026-08-25: "a beefed up release of records... so I can speak on their
 * behalf"). Grounded in 45 CFR 164.510(b): a provider may discuss a
 * patient's care with a person the patient involves in it. Each scope is
 * ticked by the client; a legacy document with no scopes stored carries the
 * full set, which is what those clients signed up to in substance.
 */
export const COMMUNICATION_SCOPES = [
  {
    id: 'discuss',
    label: 'Discuss my care with my advocate',
    note: 'Your clinicians and staff may speak with my advocate about my history, results, referrals, and treatment, and may answer his questions as they would answer mine.',
  },
  {
    id: 'records',
    label: 'Release my records to my advocate',
    note: 'You may send the records described in this authorisation directly to my advocate, by mail, fax, portal, or electronic transfer.',
  },
  {
    id: 'admin',
    label: 'Handle scheduling, referrals, and billing follow-up',
    note: 'My advocate may schedule and reschedule my appointments, follow up on my referrals and orders, and ask about billing and claim paperwork tied to my care here.',
  },
];

// MST, always. Without the zone a signature stamped near midnight UTC printed
// as one date on Eric's copy and the next day on a client's - the same
// document, two execution dates, on a record a clinic and an insurer both
// read. An unparseable or missing stamp says so rather than rendering
// "Invalid Date" onto a form somebody is about to sign.
const fmt = (d, fallback = '(not yet signed)') => {
  // A bare YYYY-MM-DD from <input type="date"> is a WALL date, not an
  // instant. new Date() parses it as UTC midnight, which this formatter then
  // walks back seven hours - so every dated range printed a day early at both
  // ends, on the face of a legal document. Noon UTC lands safely inside the
  // MST day. Full timestamps (signedAt, expiresAt) are instants and parse as
  // they always did.
  const t = d
    ? new Date(/^\d{4}-\d{2}-\d{2}$/.test(String(d).trim()) ? `${String(d).trim()}T12:00:00Z` : d)
    : null;
  if (!t || Number.isNaN(t.getTime())) return fallback;
  return t.toLocaleDateString('en-US', {
    timeZone: 'Etc/GMT+7', year: 'numeric', month: 'long', day: 'numeric',
  });
};

const RULE = '_'.repeat(46);

/**
 * A field's value, or somewhere to write it. On screen an unfilled field reads
 * "(name)", which tells you what belongs there. On a blank being filled in by
 * hand, a parenthesis is not somewhere to write, so it becomes a rule.
 */
function field(o, v, placeholder, n = 46) {
  return v || (o.blank ? '_'.repeat(n) : placeholder);
}

/**
 * The signature block, and there are two of them because there are two ways
 * these get signed.
 *
 * Signed in the app, the typed name IS the signature and the Worker stamps
 * the date, so the form says so. Printed blank and sent ahead of a case — a
 * client deciding whether to upgrade, a clinic that wants paper — none of
 * that is true yet, and a form that attests to an electronic signature nobody
 * made is a false statement on a document a records department will read.
 * So a blank gets ruled lines and no attestation.
 *
 * `who` is 'patient' or 'member', matching the document's own vocabulary.
 */
function signatureBlock(o, who) {
  if (o.blank) {
    return `SIGNATURE
Signed: ${RULE}

Print name: ${o.clientName || RULE}

Date: ______________________`;
  }
  return `SIGNATURE
Signed: ${o.signedName || '(typed full name)'}
Date: ${o.signedAt ? fmt(o.signedAt) : '(date)'}
Signed electronically by the ${who} through the Pocket Advocate case page.
The typed name above is the ${who}'s signature and the date is recorded by
the system at the moment of signing.`;
}

/**
 * The records authorisation, as the client and the clinic both read it.
 *
 * `o`: { clientName, clientDob, advocateName, clinicName, clinicAddress,
 *        fromDate, toDate, categories: [id], purpose, signedName, signedAt,
 *        expiresAt }
 * Everything is plain text; the caller escapes before rendering as HTML.
 */
export function recordsAuthorisation(o = {}) {
  const cats = SENSITIVE_CATEGORIES.filter((c) => (o.categories || []).includes(c.id));
  // Ticked scopes, or the whole set: for a legacy record with none stored,
  // and for a blank being filled in by hand, all three print (the blank with
  // boxes to tick on paper).
  const scopes = Array.isArray(o.scopes)
    ? COMMUNICATION_SCOPES.filter((s) => o.scopes.includes(s.id))
    : COMMUNICATION_SCOPES;
  const scopeMark = o.blank ? '[ ]' : '[X]';
  const range = o.fromDate || o.toDate
    ? `Records dated ${o.fromDate ? fmt(o.fromDate, '(date not recorded)') : 'the beginning of my care'} through ${o.toDate ? fmt(o.toDate, '(date not recorded)') : 'today'}.`
    : 'Records covering the whole period of my care.';
  return `AUTHORISATION FOR RELEASE OF PROTECTED HEALTH INFORMATION
AND FOR COMMUNICATION WITH MY PATIENT ADVOCATE

Patient: ${field(o, o.clientName, '(name)')}
Date of birth: ${field(o, o.clientDob, '(date of birth)', 24)}

I authorise the provider named below to release my health information to the
person named below, and to communicate with him as a person I have involved
in my care.

RELEASING PROVIDER
${field(o, o.clinicName, '(clinic)')}
${field(o, o.clinicAddress, '', 46)}

RECEIVING PERSON
${o.advocateName || 'Eric Bleach'}, patient advocate, Pocket Advocate.

WHAT I AUTHORISE MY ADVOCATE TO DO
I have involved the person named above in my care. I authorise each item
marked below, and only those:
${scopes.length
    ? scopes.map((s) => `  ${scopeMark} ${s.label}
      ${s.note}`).join('\n')
    : '  I have not authorised any of the items above.'}

WHAT MAY BE RELEASED
${range}
This includes office notes and consultation notes, laboratory and pathology
results, imaging reports and the images themselves, medication and prescription
history, procedure and operative reports, discharge summaries, referral letters,
and billing records and claim documentation for the same period.

${cats.length
    ? `I SPECIFICALLY authorise release of the following, each of which is
separately protected and none of which may be released without the specific
permission I am giving here:
${cats.map((c) => `  - ${c.label}`).join('\n')}`
    : `I have NOT authorised release of separately protected categories
(mental health, substance use treatment, HIV and communicable disease, genetic
testing, or reproductive and sexual health records). Do not release them under
this authorisation.`}

Psychotherapy notes maintained separately from the medical record are NOT
authorised by this form and require a separate authorisation.

PURPOSE
${o.purpose || 'At my own request, so that my patient advocate can review my care, speak with my providers on my behalf, and pursue insurance appeals for me.'}

MY RIGHTS, WHICH THIS FORM DOES NOT TAKE AWAY
1. I may revoke this authorisation at any time by writing to the provider named
   above and to my advocate. Revoking it stops future releases; it cannot undo a
   release already made in reliance on it.
2. The provider may not condition my treatment, payment, enrolment, or
   eligibility for benefits on whether I sign this. Signing is my choice.
3. Information released under this authorisation may be re-disclosed by the
   person receiving it and may then no longer be protected by federal privacy
   law. My advocate keeps it in my private case file and does not share it
   except as I direct.
4. I may inspect or copy the information described here, and I am entitled to a
   copy of this authorisation.

EXPIRY
This authorisation expires on ${o.expiresAt ? fmt(o.expiresAt) : 'one year from the date signed'}, or when I revoke it in writing, whichever comes first.

${signatureBlock(o, 'patient')}`;
}

/**
 * The insurer-side designation. Deliberately separate: a records release does
 * not let anyone appeal on your behalf, and an appeal authority does not let
 * anyone collect your records.
 *
 * `o`: { clientName, clientDob, memberId, planName, advocateName, signedName,
 *        signedAt, expiresAt }
 */
export function representativeDesignation(o = {}) {
  return `APPOINTMENT OF AUTHORISED REPRESENTATIVE

Member: ${field(o, o.clientName, '(name)')}
Date of birth: ${field(o, o.clientDob, '(date of birth)', 24)}
Member or policy ID: ${field(o, o.memberId, '(member ID)', 32)}
Plan: ${field(o, o.planName, '(plan or insurer)')}

I appoint ${o.advocateName || 'Eric Bleach'}, patient advocate, Pocket Advocate,
as my authorised representative in connection with claims and appeals under my
health plan.

WHAT THIS ALLOWS
My representative may, on my behalf: request and receive claim and benefit
information including denial notices and their reasons; request the plan
documents, medical policies, and clinical criteria used to decide my claim, and
the credentials of the reviewer who decided it; file and pursue internal
appeals at every level; request an external review by an independent review
organisation; and communicate with the plan in writing, by telephone, and
through its portal about my claims.

WHAT THIS DOES NOT ALLOW
This does not let my representative make medical decisions for me, and it is
not a power of attorney, a healthcare proxy, or an appointment of legal
counsel. My representative is a patient advocate, not an attorney, and does not
provide legal representation.

DURATION
This appointment stays in effect until ${o.expiresAt ? fmt(o.expiresAt) : 'one year from the date signed'}, or until I revoke it in writing, whichever comes first. I may revoke it at any time by writing to my plan and to my representative.

${signatureBlock(o, 'member')}`;
}

/**
 * The scope of work agreement: what the case runs on. Signed in the app the
 * day Full-Service opens, by the client, with the same typed name and drawn
 * signature the other documents use.
 *
 * EVERY SENTENCE HERE IS ALREADY IN FULL_ACCESS_TERMS (public/js/tier-terms.js,
 * Eric's words as of v2.43). This document is that scope note restated as a
 * signature-grade summary; it makes no promise the scope note does not make.
 * When Eric edits one of them through the copy deck, check the other, because
 * they describe one engagement and must not drift apart in substance.
 *
 * `o`: { clientName, signedName, signedAt, contactOk } and `blank` for a
 * paper copy.
 *
 * CONTACT is the one section not lifted from the scope note, added on
 * Eric's word (2026-08-29: "a tick box saying that he agrees I can contact
 * him via phone by text or phone call. He can return my calls, but
 * non-urgent messages should be used in the app chat portal"). The box
 * prints as the client left it: [X] only when they actually ticked it,
 * never assumed, and the Worker refuses to store a scope signature without
 * the tick.
 */
export function scopeOfWork(o = {}) {
  const contactMark = o.blank || !o.contactOk ? '[ ]' : '[X]';
  return `SCOPE OF WORK AGREEMENT
HANDS-OFF CASE MANAGEMENT

Client: ${field(o, o.clientName, '(name)')}
Advocate: Eric Bleach, patient advocate, Pocket Advocate.

This is the agreement your case runs on. It says what I do, what I need
from you, and where the work stops.

THE WORK
I work inside your case, not beside it. Once you have authorised it in
writing, I speak to your clinics and your insurance company myself, and I
do the legwork: the records I chase, the referrals I follow up, the calls
I make, and the insurance appeals I write. A service month is up to 20-22
hours of comprehensive advocacy, with priority access throughout; the
calls and the appeals draw from those hours rather than being counted one
by one, and casework beyond them is billed at $175 to $225 an hour,
agreed with you in advance.

We check in at least twice a month through your window, by phone or
video, so the case runs on a rhythm instead of going quiet. The check-ins
are part of the service, not an option: a case I cannot reach you about
is a case I cannot run. Everything I do is logged on your case page as I
do it, so you can see where the case stands without having to ask.

WHAT I NEED FROM YOU
Before I can act for you I need your permission in writing. I bring you
each document as the case needs it and walk you through it, so you are
never handed paperwork you did not expect. Any permission you give me can
be withdrawn in writing at any time, and I stop using it straight away.

Your month runs from the day it starts, whether or not that paperwork is
settled. How fast we get it done is up to you: get it done early and you
get all of it.

CONTACT
${contactMark} My advocate may contact me about my case by phone, as a phone
call or a text message, and I can return his calls the same way.
Anything that is not urgent goes through my case chat instead, so the
whole case stays in one place.

THE MONTH
This is billed a month at a time, an active window of 30 days per month
you take. At the end of each month you decide whether to carry on, at the
same price, as many times as you need. When your last paid month ends the
case wraps up, not at any particular call and never by surprise, because
we will have spoken at least twice a month on the way there. An insurance
appeal in flight does not expire with the window: whenever a denial
arrives on an appeal I filed for you, I write the escalation.

WHAT THIS IS NOT
Not legal representation. I am a patient advocate, not an attorney, and
if your situation needs a lawyer I will say so plainly.
Not medical care. No diagnosis, no treatment, no prescriptions, and no
doctor-patient relationship.
Not a promised outcome. No one can guarantee an insurer will overturn a
denial or a clinic will move quickly. What I promise is the work, the
deadlines, honesty about how it is going, and acceleration: while I am
working for you the case moves faster than it would without me, and you
come out knowing more about running your own case than you went in with.

MONEY
You are charged one month at a time, at the price we agreed. Refunds are
not automatic, and nothing in this document triggers one by itself. If
something goes genuinely wrong, you tell me and we settle it together:
any refund is agreed between you and me, person to person, on what
actually happened. A check-in you miss or decline is never a refund
basis.

YOUR PRIVACY
Records I obtain on your behalf live in your case file under the same
protections as anything you upload yourself: your advocate and you,
nobody else.

${signatureBlock(o, 'client')}`;
}

/** Which document a stored record is. This map is the whole vocabulary. */
export const AUTHORITY_KINDS = {
  records: { title: 'Records authorisation', build: recordsAuthorisation },
  representative: { title: 'Insurance representative', build: representativeDesignation },
  scope: { title: 'Scope of work agreement', build: scopeOfWork },
};

/**
 * The appeal deadlines that actually decide cases. A missed filing window is
 * not a setback, it is the end of the claim, and no amount of being right
 * afterwards reopens it. Days from the adverse determination unless noted.
 *
 * Sources are the governing rules, not folklore: ERISA internal appeals get
 * at least 180 days (29 CFR 2560.503-1(h)); external review runs 4 months
 * from the final internal denial; Medicare Advantage reconsideration is 60
 * days; Original Medicare redetermination is 120 days from the MSN; Medicaid
 * fair hearings are state-set and commonly 90.
 *
 * These are FLOORS. A specific plan can allow longer and none may allow less,
 * so the tracker warns early and the copy tells him to check the denial
 * letter rather than trusting this table.
 */
export const APPEAL_DEADLINES = [
  { id: 'commercial-internal', label: 'Commercial or employer plan, internal appeal', days: 180 },
  { id: 'commercial-external', label: 'External review (after the final internal denial)', days: 120 },
  { id: 'ma-reconsideration', label: 'Medicare Advantage, reconsideration', days: 60 },
  { id: 'medicare-redetermination', label: 'Original Medicare, redetermination', days: 120 },
  { id: 'medicaid-hearing', label: 'Medicaid, state fair hearing', days: 90 },
  { id: 'urgent', label: 'Urgent or expedited (pre-service, care is waiting)', days: 3 },
];

/** The date a filing is due, from the denial date and the track. */
export function appealDueAt(deniedAt, trackId) {
  const track = APPEAL_DEADLINES.find((t) => t.id === trackId);
  if (!deniedAt || !track) return null;
  const d = new Date(deniedAt);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(d.getTime() + track.days * 86_400_000);
}
