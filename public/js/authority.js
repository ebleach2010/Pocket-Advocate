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

/**
 * THE DISCLOSING PARTY, AS A CLASS RATHER THAN AS ONE NAMED CLINIC.
 *
 * This is the whole of the sign-once change. Until now a client signed a
 * separate authorisation for every clinic, which meant that the fifth clinic
 * anybody discovered halfway through a case was a fresh signing, a fresh wait,
 * and in practice a fortnight lost. 45 CFR 164.508(c)(1)(ii) asks for "the
 * name or other specific identification of the person(s), or class of
 * persons, authorized to make the requested use or disclosure" - a CLASS is
 * on the face of the rule, and HHS FAQ 473 says so in as many words: an
 * authorisation may name a class of providers rather than list every one.
 *
 * So the class is enumerated here, as a list rather than as one long string,
 * for two reasons. A four hundred character sentence in a template literal is
 * a sentence nobody can diff, and a suite check that asserts "the document
 * names a class" is worth nothing unless it can assert WHICH members of the
 * class survived an edit. Every entry below is pinned individually.
 *
 * It is deliberately wide on the SOURCE of the information and says nothing
 * about widening what the advocate may DO with it: the communication scopes
 * above still gate that, still tick one by one, and a universal authorisation
 * with every scope unticked still authorises nothing.
 */
export const PROVIDER_CLASS_TYPES = [
  'health plan',
  'physician',
  'health-care professional',
  'hospital',
  'clinic',
  'laboratory',
  'pharmacy',
  'medical facility',
  'behavioral-health provider',
  'rehabilitation provider',
  'pharmacy benefit manager',
  'claims administrator',
  'billing entity',
];

/**
 * The class, as the sentence it appears as on the document. First person,
 * because every other sentence on these forms is ("I authorise", "my care"),
 * and a document that switches to "the patient" halfway down reads as though
 * somebody else wrote it about you.
 */
export const PROVIDER_CLASS = `any ${PROVIDER_CLASS_TYPES.join(', ')}, or other`
  + ' health-care source that has provided treatment, payment, or services to me'
  + ' or on my behalf';

/**
 * HOW LONG AN AUTHORISATION LASTS, and the fact that it always does.
 *
 * Twelve months by default, set by the client at signing, and there is no
 * option anywhere that means no expiry: 164.508(c)(1)(v) requires an
 * expiration date or event, and a records department that reads "does not
 * expire" rejects the form. The outer bound exists so that a mistyped year
 * cannot put an expiry in the next century on a document nobody re-reads.
 */
export const AUTHORITY_DEFAULT_MONTHS = 12;
export const AUTHORITY_MAX_MONTHS = 24;

/**
 * Signed date plus n calendar MONTHS, not plus 365 days.
 *
 * Calendar months because that is what the document says on its face and what
 * a client picking a date means. The two differ: 365 days from 1 March 2027
 * lands on 29 February 2028 in a leap year, a day short of the anniversary,
 * and an expiry that arrives a day early on a records request already in
 * flight is a rejected request.
 *
 * The end-of-month clamp is the case that bites. 31 January plus one month is
 * not 3 March: setMonth rolls the overflow forward, so the naive version
 * silently moved an expiry two days past where the client set it. Clamped to
 * the last day of the target month instead.
 *
 * Returns a Date, or null for an unparseable stamp - never a fabricated
 * "today", which would stamp a real expiry onto a document whose signing date
 * was never recorded.
 */
export function authorityExpiry(signedAt, months = AUTHORITY_DEFAULT_MONTHS) {
  const t = signedAt instanceof Date ? new Date(signedAt.getTime()) : new Date(signedAt);
  if (!signedAt || Number.isNaN(t.getTime())) return null;
  const n = Number(months);
  if (!Number.isFinite(n) || n <= 0) return null;
  const day = t.getUTCDate();
  const out = new Date(t.getTime());
  out.setUTCDate(1);
  out.setUTCMonth(out.getUTCMonth() + Math.round(n));
  // The last day of the month we landed in: day 0 of the NEXT month.
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate();
  out.setUTCDate(Math.min(day, lastDay));
  return out;
}

/**
 * Is this stored document past its expiry?
 *
 * THE MISSING FIELD IS THE TRAP. Documents signed before an expiry was stored
 * have no `expiresAt` at all, and the obvious `new Date(item.expiresAt) < now`
 * answers false for every one of them, which reads as "still valid, forever"
 * on exactly the records that were signed under the old wording. That is the
 * "never expires" this build exists to remove, arriving through the back door
 * as an undefined rather than as a word on the page.
 *
 * So a document with no stored expiry falls back to twelve months from its own
 * signing date, which is what its own printed text has always said. A document
 * with neither an expiry nor a signing date is treated as EXPIRED, because a
 * document that cannot say when it was signed cannot be shown to be current.
 */
export function authorityExpired(item, now = Date.now()) {
  const at = item?.expiresAt
    ? new Date(item.expiresAt)
    : authorityExpiry(item?.signedAt, AUTHORITY_DEFAULT_MONTHS);
  if (!at || Number.isNaN(at.getTime())) return true;
  return at.getTime() <= now;
}

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
 * Wrap a sentence for the fixed-width text form.
 *
 * Every other paragraph in this file is hand wrapped in its template literal,
 * which is fine for prose somebody typed once. The provider class is BUILT
 * from a list, so its length changes whenever a provider type is added, and
 * hand wrapping it would mean re-wrapping thirteen entries by hand each time
 * or shipping one 380 character line into a document that is otherwise 78
 * columns wide. The HTML renderer collapses these breaks again (see `flow`),
 * so this changes the paper form only.
 */
function wrap(text, width = 78) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!line) line = word;
    else if (`${line} ${word}`.length <= width) line += ` ${word}`;
    else { out.push(line); line = word; }
  }
  if (line) out.push(line);
  return out.join('\n');
}

/**
 * A field's value, or somewhere to write it. On screen an unfilled field reads
 * "(name)", which tells you what belongs there. On a blank being filled in by
 * hand, a parenthesis is not somewhere to write, so it becomes a rule.
 */
function field(o, v, placeholder, n = 46) {
  return v || (o.blank ? '_'.repeat(n) : placeholder);
}

/**
 * A value, or ALWAYS somewhere to write. Never a placeholder.
 *
 * `field` above is right for the patient's own details: "(name)" on screen
 * tells a client which box they have not filled in yet, and they can see the
 * box. It is wrong for the advocate's contact block on the patient
 * designation, and the printed page showed why. A client signs that document
 * and hands it to a clinic, so an unset fax number printed as "(fax)" on a
 * SIGNED page, where there is no box to fill in and the reader is a records
 * clerk. A placeholder is worse than a blank there, because it looks filled
 * in and the clerk reads it as the value.
 *
 * A rule is a rule on any paper: somebody writes the number in, or Eric prints
 * his own copy from the advocate side where the stored contact block fills it.
 * What must never happen is an invented number, because a wrong fax number on
 * a page a records department reads sends somebody's chart to a stranger.
 */
function ruleOr(v, n = 26) {
  return String(v || '').trim() || '_'.repeat(n);
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
    // Hanging indent, and wrapped. Bullets used to be short labels ("Mental
    // health records") so nothing ever reached the right margin; the patient
    // designation's bullets are whole sentences, and unwrapped they ran to
    // 110 columns on a page laid out for 78. HTML is unaffected: partHtml
    // collapses the whitespace either way.
    case 'bullets': return part.items
      .map((x) => `  - ${wrap(x, 76).split('\n').join('\n    ')}`).join('\n');
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
 *        expiresAt, universal, narrowedFrom }
 *
 * TWO SHAPES OUT OF ONE SET OF WORDS, and it matters which way round the
 * default sits.
 *
 * `universal: true` is the master (Eric's spec 2A): the disclosing party is
 * the CLASS above rather than one named clinic, it is signed once, and it is
 * what goes in every provider packet. Everything else on the form is
 * unchanged, which is the point: the client is not being asked to agree to
 * anything wider than they were, only to stop re-signing it per clinic.
 *
 * Without the flag this builds exactly the per-clinic document it always
 * built, byte for byte, and that default is deliberate. A records
 * authorisation signed months ago is a legal instrument somebody has already
 * put their name to; re-rendering it under new wording because the app
 * changed would mean the copy in a clinic's chart and the copy on the case
 * page no longer say the same thing. tools/suites/authority-golden.mjs pins
 * that eight ways and is the evidence, not this comment.
 */
export function recordsAuthorisationModel(o = {}) {
  const universal = !!o.universal;
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
  // The one clause that exists only on a narrowed copy. It is the whole
  // safety property of Eric's spec 2D said out loud on the paper itself: an
  // office that will not take the universal form gets a form scoped to it,
  // and neither the office nor a later reader can mistake that for the master
  // having been cancelled. The app enforces the same thing structurally (a
  // narrowed document is a separate stored record and touches nothing), but a
  // records clerk reads the page, not the database.
  const narrowNote = o.narrowedFrom ? {
    t: 'section',
    h: 'THIS IS A NARROWED COPY, NOT A REPLACEMENT',
    body: [{
      t: 'p',
      text: `I have already signed a universal authorisation covering my providers\ngenerally. I am signing this narrower one as well, at this office's request,\nand only because this office prefers a form naming itself. It is IN ADDITION\nto the universal authorisation. It does not replace, cancel, narrow, or\nrevoke that authorisation, which remains in force until it expires or until I\nrevoke it in writing.`,
    }],
  } : null;
  return [
    {
      t: 'title',
      lines: universal
        ? ['UNIVERSAL AUTHORISATION FOR RELEASE OF PROTECTED HEALTH INFORMATION', 'AND FOR COMMUNICATION WITH MY PATIENT ADVOCATE']
        : ['AUTHORISATION FOR RELEASE OF PROTECTED HEALTH INFORMATION', 'AND FOR COMMUNICATION WITH MY PATIENT ADVOCATE'],
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
      text: universal
        ? `I authorise the providers described below to release my health information to\nthe person named below, and to communicate with him as a person I have\ninvolved in my care.`
        : `I authorise the provider named below to release my health information to the\nperson named below, and to communicate with him as a person I have involved\nin my care.`,
    },
    universal
      ? {
        t: 'section',
        h: 'RELEASING PROVIDERS',
        body: [
          { t: 'p', text: wrap(`I authorise ${PROVIDER_CLASS}.`) },
          {
            t: 'p',
            text: `I am naming a class of providers on purpose rather than listing them one by\none. Federal privacy law allows this: an authorisation may identify a class of\npersons authorised to disclose, and I intend every provider in the class above\nto be able to rely on this form as though it named them.`,
          },
          {
            t: 'p',
            text: `Any provider who prefers a form naming itself may ask for one, and I will sign\nit. Asking for one does not cancel this authorisation.`,
          },
        ],
      }
      : {
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
    narrowNote,
    {
      t: 'section',
      h: 'MY RIGHTS, WHICH THIS FORM DOES NOT TAKE AWAY',
      body: [{
        t: 'ol',
        items: [
          // A class-wide form has no single named provider to write to, so the
          // revocation route has to be one a patient can actually carry out.
          // 164.508(c)(2)(i) wants a description of HOW to revoke, and "write
          // to the provider named above" describes nothing when the form names
          // a class. Writing to the advocate is the route that always works,
          // and he is the one holding the form.
          universal
            ? `I may revoke this authorisation at any time by writing to my advocate, and by\n   writing to any provider I have given a copy to. Revoking it stops future\n   releases; it cannot undo a release already made in reliance on it.`
            : `I may revoke this authorisation at any time by writing to the provider named\n   above and to my advocate. Revoking it stops future releases; it cannot undo a\n   release already made in reliance on it.`,
          `The provider may not condition my treatment, payment, enrolment, or\n   eligibility for benefits on whether I sign this. Signing is my choice.`,
          `Information released under this authorisation may be re-disclosed by the\n   person receiving it and may then no longer be protected by federal privacy\n   law. My advocate keeps it in my private case file and does not share it\n   except as I direct.`,
          `I may inspect or copy the information described here, and I am entitled to a\n   copy of this authorisation.`,
        ],
      }],
    },
    {
      t: 'section',
      h: 'EXPIRY',
      body: universal
        ? [
          // A PRINTED BLANK GETS SOMEWHERE TO WRITE THE DATE. Without the rule
          // it read "expires on one year from the date signed" with nothing to
          // fill in, so a client completing one on paper could not choose an
          // expiry at all while the in-app form let them pick any date. That
          // is the same shape as the sensitive-category bug of 2026-08-26: the
          // screen offering a choice the paper silently refused.
          { t: 'p', text: `This authorisation expires on ${o.expiresAt ? fmt(o.expiresAt) : (o.blank ? '______________________' : 'one year from the date signed')}, or when I revoke it in writing, whichever comes first.` },
          // Said out loud because the whole point of one broad form is that it
          // gets reused for months, and the failure this invites is the one
          // where nobody ever looks at the date again.
          //
          // Worded for the form in hand. "I chose that date when I signed" is
          // simply untrue on a blank, where nobody has chosen anything yet, and
          // an untrue sentence on a legal instrument is not a small thing
          // however harmless it looks.
          {
            t: 'p',
            text: o.blank
              ? `If no date is written above, this authorisation expires one year from the\ndate signed. It is never open ended, and no provider may treat it as though\nit were.`
              : `I chose that date when I signed. This authorisation is never open ended, and\nno provider may treat it as though it were.`,
          },
        ]
        : [{ t: 'p', text: `This authorisation expires on ${o.expiresAt ? fmt(o.expiresAt) : 'one year from the date signed'}, or when I revoke it in writing, whichever comes first.` }],
    },
    signatureModel(o, 'patient'),
    // Blocks that only exist in one shape arrive as null. Filtering here
    // rather than at each renderer keeps both renderers ignorant of it.
  ].filter(Boolean);
}

/**
 * The master, by name. Same words, same builder, `universal` set - so there is
 * no second copy of the document to drift, and a caller reading
 * `universalAuthorisation(o)` does not have to know that a flag exists.
 */
export function universalAuthorisationModel(o = {}) {
  return recordsAuthorisationModel({ ...o, universal: true });
}

export function universalAuthorisation(o = {}) {
  return authorityText(universalAuthorisationModel(o));
}

/**
 * The narrow per-clinic exception, derived from the master (Eric's spec 2D).
 *
 * An office that will not accept a class-wide form, or reads it as too wide,
 * gets one scoped to itself, built from what the client already gave us rather
 * than from a second interview. Categories, communication scopes, purpose and
 * the patient's own details all carry across; the date range narrows to
 * whatever the office asked for.
 *
 * WHAT DOES NOT CARRY ACROSS IS THE SIGNATURE, and that is not an oversight.
 * The master's typed name, its signing timestamp and its drawn ink belong to
 * the master. Copying them onto a differently worded document the patient has
 * never seen would be applying somebody's signature to something they did not
 * sign, which is forgery whatever the intent, and it would be undetectable
 * afterwards because the two marks would be pixel identical. So this returns a
 * document to be SIGNED, not a signed document, and both the route and the
 * page treat it as a new signing.
 *
 * It also cannot touch the master: this reads `master` and returns a fresh
 * object. There is no code path from here to the stored record.
 */
export function narrowedAuthorisationOptions(master = {}, narrow = {}) {
  return {
    clientName: master.clientName || '',
    clientDob: master.clientDob || '',
    advocateName: master.advocateName || '',
    categories: Array.isArray(master.categories) ? [...master.categories] : [],
    scopes: Array.isArray(master.scopes) ? [...master.scopes] : undefined,
    purpose: master.purpose || '',
    clinicName: narrow.clinicName || '',
    clinicAddress: narrow.clinicAddress || '',
    clinicPhone: narrow.clinicPhone || '',
    fromDate: narrow.fromDate || '',
    toDate: narrow.toDate || '',
    // The link back, and the reason the printed page carries the clause that
    // says the master survives.
    narrowedFrom: master.id || narrow.narrowedFrom || 'the universal authorisation',
    universal: false,
  };
}

export function narrowedAuthorisationModel(master = {}, narrow = {}) {
  return recordsAuthorisationModel(narrowedAuthorisationOptions(master, narrow));
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

/**
 * THE ONE PAGE A FRONT DESK CAN ACTUALLY USE (Eric's spec 2B).
 *
 * The authorisation above is the legal instrument and it reads like one: five
 * hundred words, four numbered rights, a class of providers, a redisclosure
 * warning. A receptionist with six people queueing does not read it. What she
 * needs is one page, in plain words, that says this man is involved, put him
 * on the chart, and here is the form that backs it.
 *
 * So this is deliberately short and deliberately NOT a second authorisation.
 * It grants nothing on its own: every disclosure still rests on the
 * authorisation it travels with, and this page says so rather than implying it
 * carries its own permission.
 *
 * IT IS SIGNED IN THE SAME SITTING as the universal authorisation, which is
 * the whole "sign once" promise. Two documents, one signature session, one
 * drawn mark applied to each as it is signed.
 *
 * THE SENTENCE THAT MATTERS MOST IS THE ONE ABOUT DECISIONS. "Designation of
 * advocate" sounds close enough to "health-care agent" that a chart clerk can
 * file it as one, and the consequence of that mistake is a hospital ringing a
 * patient advocate for consent to a procedure. It is stated as its own
 * section, in the negative, before anything else about scope.
 *
 * `o`: { clientName, clientDob, advocateName, advocateBusiness, advocatePhone,
 *        advocateEmail, advocateFax, signedName, signedAt, expiresAt }
 */
export function advocateDesignationModel(o = {}) {
  const who = o.advocateName || 'Eric Bleach';
  return [
    { t: 'title', lines: ['PATIENT DESIGNATION OF ADVOCATE'] },
    {
      t: 'meta',
      rows: [
        ['Patient', field(o, o.clientName, '(name)')],
        ['Date of birth', field(o, o.clientDob, '(date of birth)', 24)],
      ],
    },
    {
      t: 'p',
      // Wrapped rather than hand broken: the advocate's name is interpolated,
      // so the first line's length is not knowable when the sentence is
      // written.
      text: wrap(`I have asked ${who}, a patient advocate with Pocket Advocate, to help me with my medical care and with my health insurance. I am giving my providers this page so that they know he is acting with my knowledge and at my request.`),
    },
    {
      t: 'section',
      h: 'THIS DOES NOT MAKE HIM MY DECISION MAKER',
      body: [
        {
          t: 'p',
          text: `My advocate is NOT my health-care decision maker. This page is not a power of\nattorney, not a health-care proxy or agent appointment, not a guardianship,\nand not an advance directive. I make my own medical decisions. If a decision\never has to be made and I cannot make it, this page gives my advocate no\nauthority to make it for me and my providers must not treat him as though it\ndid.`,
        },
        {
          t: 'p',
          text: `He is also not my attorney and does not give me legal or medical advice.`,
        },
      ],
    },
    {
      t: 'section',
      h: 'WHAT I AM ASKING MY PROVIDERS TO DO',
      body: [
        {
          t: 'bullets',
          items: [
            'Speak with my advocate about my care, my results, my referrals, and my billing, as you would speak with me.',
            'Note him in my chart as an authorised contact, and keep this page with it.',
            'Send him the records described in the authorisation that travels with this page.',
            'Include him when you schedule, reschedule, or follow up on my appointments and referrals.',
            'Let him attend or join my appointments when I ask him to.',
          ],
        },
        {
          t: 'p',
          text: `Everything above is limited by the authorisation signed with this page. Where\nthat authorisation does not reach, this page does not either: it is a notice\nof who I have involved in my care, not a permission of its own.`,
        },
      ],
    },
    {
      t: 'section',
      h: 'HOW TO REACH HIM',
      body: [{
        t: 'meta',
        rows: [
          ['Advocate', who],
          ['Business', o.advocateBusiness || 'Pocket Advocate'],
          // ALWAYS a rule when unset, never a placeholder. See ruleOr: this
          // block is read by a records clerk off a signed page, not filled in
          // by a client looking at a form.
          ['Phone', ruleOr(o.advocatePhone)],
          ['Secure email', ruleOr(o.advocateEmail, 32)],
          ['Fax', ruleOr(o.advocateFax)],
        ],
      }],
    },
    {
      t: 'section',
      h: 'HOW LONG THIS LASTS, AND TAKING IT BACK',
      body: [{
        t: 'p',
        // Wrapped: the expiry date is interpolated and its rendered length
        // changes with the month name.
        text: wrap(`This designation stays in effect until ${o.expiresAt ? fmt(o.expiresAt) : 'one year from the date signed'}, or until I withdraw it, whichever comes first. It is never open ended. I may withdraw it at any time by telling my advocate or my provider in writing, and withdrawing it does not affect my care in any way.`),
      }],
    },
    signatureModel(o, 'patient'),
  ];
}

export function advocateDesignation(o = {}) {
  return authorityText(advocateDesignationModel(o));
}

/**
 * Which document a stored record is.
 *
 * `records` stays first and stays named that, because every document already
 * signed carries that kind string and a rename would orphan them. It is now
 * the EXCEPTION rather than the norm: `universal` is what a new client signs,
 * and a `records` document is either one signed before this change or a
 * narrowed copy made for an office that insisted on its own form.
 */
export const AUTHORITY_KINDS = {
  universal: { title: 'Universal records authorisation', build: universalAuthorisation },
  designation: { title: 'Patient designation of advocate', build: advocateDesignation },
  records: { title: 'Records authorisation (one clinic)', build: recordsAuthorisation },
  representative: { title: 'Insurance representative', build: representativeDesignation },
};

/**
 * The right model for a stored document, in ONE place.
 *
 * There were two copies of `item.kind === 'records' ? A : B`, one in case.js
 * and one in admin-case.js, and each was a ternary rather than a lookup. With
 * two kinds that was merely repetitive. With four it is a bug waiting: every
 * kind that is not the one named in the test falls to the else branch, so a
 * patient designation of advocate would have printed as an appointment of
 * authorised representative, on paper, at a clinic desk, with the patient's
 * real signature under it.
 *
 * `o` is the render options, which the caller has already merged from the
 * stored item and the case. This only chooses the shape.
 */
export function authorityModelFor(item, o = {}) {
  switch (item?.kind) {
    case 'universal': return universalAuthorisationModel(o);
    case 'designation': return advocateDesignationModel(o);
    case 'representative': return representativeDesignationModel(o);
    default: return recordsAuthorisationModel(o);
  }
}

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
