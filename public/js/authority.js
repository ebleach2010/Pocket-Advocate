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
 * THE DOCUMENT MODEL, and why there is one.
 *
 * Eric, 2026-08-26: "The forms are fucking horrendous. This? Really? Format it
 * neatly." He was right, and the words were never the problem: they are pinned
 * line by line by tools/suites/authority.mjs against the 45 CFR 164.508 core
 * elements. The problem was that every surface dumped the finished string into
 * a <pre> in a 12px monospace font, so a legal instrument a records department
 * has to accept looked like a terminal log.
 *
 * You cannot fix that by running a regex over the rendered text. A pattern
 * that turns ALL-CAPS lines into headings works right up until the day it
 * silently swallows a clause, on a document nobody reads closely because it
 * has always looked the same.
 *
 * So each document is built as a STRUCTURE, with two renderers over it:
 * `authorityText` produces exactly the string these functions always produced,
 * and `authorityHtml` produces a real document. The words exist once.
 *
 * Blocks are separated by one blank line. Inside a block nothing is blank, and
 * a heading is followed immediately by its own content. That is the entire
 * layout rule, and it is the rule the old template literals already followed.
 *
 * Hard line breaks inside a paragraph are kept in that structure because the text
 * form is wrapped for a fixed-width page and must come back byte for byte.
 * The HTML renderer unwraps them, since HTML reflows on its own.
 */
const nl = (x) => String(x == null ? '' : x);

/** One block, as text. Every part knows its own indentation and markers. */
function partText(part) {
  switch (part.t) {
    case 'title': return part.lines.join('\n');
    case 'meta': return part.rows.map(([k, v]) => `${k}: ${v}`).join('\n');
    case 'p': return nl(part.text);
    case 'lines': return part.lines.map(nl).join('\n');
    case 'checks': return part.items.map((s) => `  ${part.mark} ${s.label}\n      ${s.note}`).join('\n');
    case 'bullets': return part.items.map((x) => `  - ${x}`).join('\n');
    case 'ol': return part.items.map((x, i) => `${i + 1}. ${x}`).join('\n');
    default: return '';
  }
}
function blockText(b) {
  if (b.t === 'section') return [b.h, ...b.body.map(partText)].join('\n');
  if (b.t === 'group') return b.body.map(partText).join('\n');
  return partText(b);
}

/** The document, as the string these builders have always returned. */
export function authorityText(model) {
  return model.map(blockText).join('\n\n');
}

/**
 * The document, as a document.
 *
 * Deliberately semantic: h1, h2, ol, dl. A records clerk skims for the
 * signature and the expiry, and a screen reader has to be able to do the same.
 * Values that are missing render as a ruled span rather than as nothing, so a
 * printed blank has somewhere to write and a filled form shows what is filled.
 */
const esc = (x) => String(x == null ? '' : x)
  .replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
// A paragraph is wrapped for the fixed-width text form. HTML reflows, so the
// hard breaks come out; a blank line inside one would be a new paragraph and
// there are none.
const flow = (t) => esc(nl(t).replace(/\n\s*/g, ' ').trim());
// A run of underscores is somewhere to write on paper. As HTML it is a line,
// not forty-six underscore glyphs.
//
// ANYWHERE IN THE LINE, not only alone on one. The signature block is
// "Signed: ______", "Print name: ______", "Date: ______", so a rule that only
// matched a whole line left the signature page, the one part of the document
// a person physically writes on, as rows of underscore characters.
const ruled = (v) => esc(v).replace(/_{6,}/g, '<span class="doc-rule"></span>');
const value = (v) => ruled(v);

function partHtml(part) {
  switch (part.t) {
    case 'title': return `<h1>${part.lines.map(esc).join('<br>')}</h1>`;
    case 'meta': return `<dl class="doc-meta">${part.rows
      .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${value(v)}</dd>`).join('')}</dl>`;
    case 'p': return `<p>${flow(part.text)}</p>`;
    case 'lines': return part.lines
      .filter((l) => String(l).trim() !== '')
      .map((l) => `<p class="doc-line">${ruled(String(l).trim())}</p>`).join('');
    case 'checks': return `<ul class="doc-checks">${part.items.map((s) => `
      <li><span class="doc-box${part.mark === '[X]' ? ' is-on' : ''}" aria-hidden="true"></span>
        <span class="doc-check-body"><strong>${esc(s.label)}</strong>
        <span class="doc-note">${flow(s.note)}</span></span>
        <span class="doc-sr">${part.mark === '[X]' ? 'Authorised' : 'Not marked'}</span></li>`).join('')}</ul>`;
    case 'bullets': return `<ul class="doc-bullets">${part.items
      .map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`;
    case 'ol': return `<ol class="doc-rights">${part.items
      .map((x) => `<li>${flow(x)}</li>`).join('')}</ol>`;
    default: return '';
  }
}
function blockHtml(b) {
  if (b.t === 'section') {
    const cls = b.sig ? ' class="doc-sig"' : '';
    return `<section${cls}><h2>${esc(b.h)}</h2>${b.body.map(partHtml).join('')}</section>`;
  }
  if (b.t === 'group') return `<section>${b.body.map(partHtml).join('')}</section>`;
  return partHtml(b);
}

/** The whole document as HTML. The caller supplies the page around it. */
export function authorityHtml(model) {
  return model.map(blockHtml).join('\n');
}

/**
 * The signature block, and there are two of them because there are two ways
 * these get signed. See signatureBlock above for the reasoning; this is the
 * same thing as a structured block.
 */
function signatureModel(o, who) {
  if (o.blank) {
    return {
      t: 'section',
      h: 'SIGNATURE',
      sig: true,
      body: [{
        t: 'lines',
        lines: [`Signed: ${RULE}`, '', `Print name: ${o.clientName || RULE}`, '', 'Date: ______________________'],
      }],
    };
  }
  return {
    t: 'section',
    h: 'SIGNATURE',
    sig: true,
    body: [
      { t: 'lines', lines: [`Signed: ${o.signedName || '(typed full name)'}`, `Date: ${o.signedAt ? fmt(o.signedAt) : '(date)'}`] },
      {
        t: 'p',
        text: `Signed electronically by the ${who} through the Pocket Advocate case page.\nThe typed name above is the ${who}'s signature and the date is recorded by\nthe system at the moment of signing.`,
      },
    ],
  };
}

/**
 * The records authorisation, as the client and the clinic both read it.
 *
 * `o`: { clientName, clientDob, advocateName, clinicName, clinicAddress,
 *        fromDate, toDate, categories: [id], purpose, signedName, signedAt,
 *        expiresAt }
 */
export function recordsAuthorisationModel(o = {}) {
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
  // A BLANK CAN NOW GRANT THEM TOO (Eric, 2026-08-26: "make sure it covers all
  // bases"). A printed blank said only "I have NOT authorised release of
  // separately protected categories", with nothing to tick, so a client
  // filling one in on paper could not authorise mental-health records however
  // much they wanted to: the in-app form offered the choice and the paper form
  // silently refused it.
  const catBlock = cats.length
    ? {
      t: 'group',
      body: [
        {
          t: 'p',
          text: `I SPECIFICALLY authorise release of the following, each of which is\nseparately protected and none of which may be released without the specific\npermission I am giving here:`,
        },
        { t: 'bullets', items: cats.map((c) => c.label) },
      ],
    }
    : o.blank
      ? {
        t: 'group',
        body: [
          {
            t: 'p',
            text: `Each of the following is separately protected and is NOT released unless I\nmark it here. Nothing in this list is required, and leaving one unmarked\nnever affects the rest of this authorisation.`,
          },
          { t: 'checks', mark: '[ ]', items: SENSITIVE_CATEGORIES },
        ],
      }
      : {
        t: 'p',
        text: `I have NOT authorised release of separately protected categories\n(mental health, substance use treatment, HIV and communicable disease, genetic\ntesting, or reproductive and sexual health records). Do not release them under\nthis authorisation.`,
      };
  return [
    {
      t: 'title',
      lines: ['AUTHORISATION FOR RELEASE OF PROTECTED HEALTH INFORMATION', 'AND FOR COMMUNICATION WITH MY PATIENT ADVOCATE'],
    },
    {
      t: 'meta',
      rows: [
        ['Patient', field(o, o.clientName, '(name)')],
        ['Date of birth', field(o, o.clientDob, '(date of birth)', 24)],
      ],
    },
    {
      t: 'p',
      text: `I authorise the provider named below to release my health information to the\nperson named below, and to communicate with him as a person I have involved\nin my care.`,
    },
    {
      t: 'section',
      h: 'RELEASING PROVIDER',
      body: [{ t: 'lines', lines: [field(o, o.clinicName, '(clinic)'), field(o, o.clinicAddress, '', 46)] }],
    },
    {
      t: 'section',
      h: 'RECEIVING PERSON',
      body: [{ t: 'p', text: `${o.advocateName || 'Eric Bleach'}, patient advocate, Pocket Advocate.` }],
    },
    {
      t: 'section',
      h: 'WHAT I AUTHORISE MY ADVOCATE TO DO',
      body: [
        { t: 'p', text: `I have involved the person named above in my care. I authorise each item\nmarked below, and only those:` },
        scopes.length
          ? { t: 'checks', mark: scopeMark, items: scopes }
          : { t: 'lines', lines: ['  I have not authorised any of the items above.'] },
      ],
    },
    {
      t: 'section',
      h: 'WHAT MAY BE RELEASED',
      body: [
        { t: 'p', text: range },
        { t: 'p', text: `This includes office notes and consultation notes, laboratory and pathology\nresults, imaging reports and the images themselves, medication and prescription\nhistory, procedure and operative reports, discharge summaries, referral letters,\nand billing records and claim documentation for the same period.` },
      ],
    },
    catBlock,
    {
      t: 'p',
      text: `Psychotherapy notes maintained separately from the medical record are NOT\nauthorised by this form and require a separate authorisation.`,
    },
    {
      t: 'section',
      h: 'PURPOSE',
      body: [{ t: 'p', text: o.purpose || 'At my own request, so that my patient advocate can review my care, speak with my providers on my behalf, and pursue insurance appeals for me.' }],
    },
    {
      t: 'section',
      h: 'MY RIGHTS, WHICH THIS FORM DOES NOT TAKE AWAY',
      body: [{
        t: 'ol',
        items: [
          `I may revoke this authorisation at any time by writing to the provider named\n   above and to my advocate. Revoking it stops future releases; it cannot undo a\n   release already made in reliance on it.`,
          `The provider may not condition my treatment, payment, enrolment, or\n   eligibility for benefits on whether I sign this. Signing is my choice.`,
          `Information released under this authorisation may be re-disclosed by the\n   person receiving it and may then no longer be protected by federal privacy\n   law. My advocate keeps it in my private case file and does not share it\n   except as I direct.`,
          `I may inspect or copy the information described here, and I am entitled to a\n   copy of this authorisation.`,
        ],
      }],
    },
    {
      t: 'section',
      h: 'EXPIRY',
      body: [{ t: 'p', text: `This authorisation expires on ${o.expiresAt ? fmt(o.expiresAt) : 'one year from the date signed'}, or when I revoke it in writing, whichever comes first.` }],
    },
    signatureModel(o, 'patient'),
  ];
}

export function recordsAuthorisation(o = {}) {
  return authorityText(recordsAuthorisationModel(o));
}

/**
 * The insurer-side designation. Deliberately separate: a records release does
 * not let anyone appeal on your behalf, and an appeal authority does not let
 * anyone collect your records.
 *
 * `o`: { clientName, clientDob, memberId, planName, advocateName, signedName,
 *        signedAt, expiresAt }
 */
export function representativeDesignationModel(o = {}) {
  return [
    { t: 'title', lines: ['APPOINTMENT OF AUTHORISED REPRESENTATIVE'] },
    {
      t: 'meta',
      rows: [
        ['Member', field(o, o.clientName, '(name)')],
        ['Date of birth', field(o, o.clientDob, '(date of birth)', 24)],
        ['Member or policy ID', field(o, o.memberId, '(member ID)', 32)],
        ['Plan', field(o, o.planName, '(plan or insurer)')],
      ],
    },
    {
      t: 'p',
      text: `I appoint ${o.advocateName || 'Eric Bleach'}, patient advocate, Pocket Advocate,\nas my authorised representative in connection with claims and appeals under my\nhealth plan.`,
    },
    {
      t: 'section',
      h: 'WHAT THIS ALLOWS',
      body: [{ t: 'p', text: `My representative may, on my behalf: request and receive claim and benefit\ninformation including denial notices and their reasons; request the plan\ndocuments, medical policies, and clinical criteria used to decide my claim, and\nthe credentials of the reviewer who decided it; file and pursue internal\nappeals at every level; request an external review by an independent review\norganisation; and communicate with the plan in writing, by telephone, and\nthrough its portal about my claims.` }],
    },
    {
      t: 'section',
      h: 'WHAT THIS DOES NOT ALLOW',
      body: [{ t: 'p', text: `This does not let my representative make medical decisions for me, and it is\nnot a power of attorney, a healthcare proxy, or an appointment of legal\ncounsel. My representative is a patient advocate, not an attorney, and does not\nprovide legal representation.` }],
    },
    {
      t: 'section',
      h: 'DURATION',
      body: [{ t: 'p', text: `This appointment stays in effect until ${o.expiresAt ? fmt(o.expiresAt) : 'one year from the date signed'}, or until I revoke it in writing, whichever comes first. I may revoke it at any time by writing to my plan and to my representative.` }],
    },
    signatureModel(o, 'member'),
  ];
}

export function representativeDesignation(o = {}) {
  return authorityText(representativeDesignationModel(o));
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
