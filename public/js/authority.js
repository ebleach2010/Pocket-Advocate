// The two documents Full Access runs on, and they are not interchangeable.
//
// Written 2026-08-23, PENDING ERIC'S SIGN-OFF, flagged in the PR. A NEW file,
// not an addition to waivers.js, which is frozen.
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

const fmt = (d) => new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

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
  const range = o.fromDate || o.toDate
    ? `Records dated ${o.fromDate ? fmt(o.fromDate) : 'the beginning of my care'} through ${o.toDate ? fmt(o.toDate) : 'today'}.`
    : 'Records covering the whole period of my care.';
  return `AUTHORISATION FOR RELEASE OF PROTECTED HEALTH INFORMATION

Patient: ${o.clientName || '(name)'}
Date of birth: ${o.clientDob || '(date of birth)'}

I authorise the provider named below to release my health information to the
person named below.

RELEASING PROVIDER
${o.clinicName || '(clinic)'}
${o.clinicAddress || ''}

RECEIVING PERSON
${o.advocateName || 'Eric Bleach'}, patient advocate, Pocket Advocate.

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

SIGNATURE
Signed: ${o.signedName || '(typed full name)'}
Date: ${o.signedAt ? fmt(o.signedAt) : '(date)'}
Signed electronically by the patient through the Pocket Advocate case page.
The typed name above is the patient's signature and the date is recorded by
the system at the moment of signing.`;
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

Member: ${o.clientName || '(name)'}
Date of birth: ${o.clientDob || '(date of birth)'}
Member or policy ID: ${o.memberId || '(member ID)'}
Plan: ${o.planName || '(plan or insurer)'}

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

SIGNATURE
Signed: ${o.signedName || '(typed full name)'}
Date: ${o.signedAt ? fmt(o.signedAt) : '(date)'}
Signed electronically by the member through the Pocket Advocate case page.`;
}

/** Which document a stored record is. The pair is the whole vocabulary. */
export const AUTHORITY_KINDS = {
  records: { title: 'Records authorisation', build: recordsAuthorisation },
  representative: { title: 'Insurance representative', build: representativeDesignation },
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
