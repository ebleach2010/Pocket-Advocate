// The provider packet, and where each provider got to (Eric's spec 4).
//
// ADMIN ONLY, AND THE FILENAME IS THE GATE. Everything in public/ is served
// to anybody who asks for it, comments included, because there is no build
// step and no minifier between this repo and the browser. Modules matching
// `admin-*.js` are 404'd to strangers by the asset gate in worker/index.js,
// and that list is the only thing standing between a client and this file.
//
// It matters here more than usual. This module holds the status vocabulary,
// which includes REJECTED PRIVACY REVIEW and PATIENT VERBAL CONFIRMATION
// REQUIRED. A client reading those against their own oncologist would be
// reading Eric's working notes on their care.
//
// THE APP ASSEMBLES THE PACKET. IT NEVER SENDS IT. There is no mail call in
// this file and none in the route behind it. Eric prints or saves this, and he
// sends it himself by the channel he chose for that provider. Emailing a
// client's health information to a clinic is not something this product does.
//
// It builds a MODEL in the shape public/js/authority.js already defines, and
// hands it to the same window opener the signed documents use. That is
// deliberate: the cover sheet inherits the print stylesheet, the Done control,
// the no-auto-print rule and the semantic markup for free, and it introduces
// no new CSS and no new colour literals. A second stylesheet for a second kind
// of paper is how the two drift.

import {
  AUTHORITY_KINDS, authorityExpired, authorityEndsAt,
} from './authority.js';

/**
 * Where a provider is with this packet. One status each, and Eric moves it by
 * hand: none of these can be inferred from anything the app can observe,
 * because the whole exchange happens by fax, post and telephone.
 *
 * The ids are mirrored in worker/index.js (PROVIDER_STATUS_IDS), which
 * validates against them so a hand-made POST cannot store a status no screen
 * can render. A suite check keeps the two lists identical.
 *
 * `notSent` is first and is the state every provider starts in. There is
 * deliberately no "unknown": a provider Eric has not written to has not been
 * sent to, and saying so plainly is the entire point of the list.
 */
export const PROVIDER_STATUSES = [
  { id: 'notSent', label: 'NOT SENT', note: 'On the list. Nothing has gone out yet.' },
  { id: 'sent', label: 'SENT', note: 'The packet has gone to them.' },
  { id: 'received', label: 'RECEIVED', note: 'They have confirmed it arrived.' },
  { id: 'accepted', label: 'ACCEPTED / ON CHART', note: 'Accepted and scanned into the chart. He can ring them.' },
  { id: 'providerForm', label: 'PROVIDER FORM REQUIRED', note: 'They will only take their own form. Generate a narrowed one for this office.' },
  { id: 'verbal', label: 'PATIENT VERBAL CONFIRMATION REQUIRED', note: 'They want to hear it from the patient before they act on it.' },
  { id: 'rejected', label: 'REJECTED PRIVACY REVIEW', note: 'Their privacy office refused it. Ask what specifically they need.' },
  { id: 'expired', label: 'EXPIRED', note: 'The authorisation behind this packet has run out. A fresh signature is needed.' },
  { id: 'revoked', label: 'REVOKED', note: 'The patient withdrew it. Stop acting on it.' },
];

/**
 * What this packet is asking for. Printed on the cover sheet so the person
 * opening the envelope knows what to do with it without reading the
 * authorisation first, which is the difference between an action and a filing.
 */
export const PROVIDER_REQUESTS = [
  { id: 'call', label: 'A call back', line: 'Please call my advocate back at the number above.' },
  { id: 'status', label: 'A status update', line: 'Please give my advocate a status update on the matter below.' },
  { id: 'records', label: 'Records', line: 'Please send the records covered by the attached authorisation to my advocate.' },
  { id: 'referral', label: 'A referral', line: 'Please advise my advocate on the status of the referral below.' },
  { id: 'priorAuth', label: 'A prior authorisation', line: 'Please advise my advocate on the prior authorisation below.' },
  { id: 'other', label: 'Something else', line: 'Please see the request below.' },
];

export const statusLabel = (id) =>
  PROVIDER_STATUSES.find((s) => s.id === id)?.label || 'NOT SENT';
export const requestLabel = (id) =>
  PROVIDER_REQUESTS.find((r) => r.id === id)?.label || 'Records';

/**
 * The status a provider SHOULD be on, given the documents behind it.
 *
 * EXPIRED and REVOKED are facts about the authorisation, not opinions about
 * the provider, so they are derived rather than typed. A packet Eric marked
 * ACCEPTED six months ago is not still accepted once the authorisation under
 * it has run out, and leaving it reading ACCEPTED is how he rings a clinic on
 * a permission that ended in March.
 *
 * Derived, never written back. The stored status is what he set; this is what
 * the screen shows on top of it, so that lifting the expiry (a fresh
 * signature) restores his own status rather than having overwritten it.
 */
export function effectiveStatus(provider, docs = []) {
  // THE AUTHORISATION DECIDES, NOT THE PILE.
  //
  // A packet stands on the records authorisation. The patient designation is a
  // notice that grants nothing of its own and says so on its face, so a live
  // designation sitting beside a WITHDRAWN authorisation is not authority to
  // act, and reading the pair as "one of them is still live" is how a provider
  // stayed on ACCEPTED after the client revoked the only thing that mattered.
  //
  // A list with no authorisation in it at all (a designation on its own) falls
  // back to the whole list rather than answering about nothing.
  const auth = docs.filter((d) => d.kind !== 'designation');
  const pool = auth.length ? auth : docs;
  if (!pool.length) return provider?.status || 'notSent';
  if (pool.every((d) => d.revokedAt)) return 'revoked';
  const live = pool.filter((d) => !d.revokedAt);
  if (live.every((d) => authorityExpired(d))) return 'expired';
  return provider?.status || 'notSent';
}

/** A short, readable handle for a document id, for the cover sheet. */
const shortId = (id) => String(id || '').replace(/-/g, '').slice(0, 8).toUpperCase();

const dateText = (d) => {
  const t = d instanceof Date ? d : new Date(d);
  if (!d || Number.isNaN(t.getTime())) return '';
  return t.toLocaleDateString('en-US', {
    timeZone: 'Etc/GMT+7', year: 'numeric', month: 'long', day: 'numeric',
  });
};

/**
 * A ruled line where a value is missing, exactly as the blank forms do it.
 *
 * NEVER A PLACEHOLDER AND NEVER A GUESS. This block carries the fax number a
 * records department will send a chart to. An invented one sends somebody's
 * chart to a stranger, and "(fax)" printed on a page a clinic keeps is worse
 * than a blank because it looks filled in. So an unset field is somewhere to
 * write, and Eric fills it in by hand or sets it once in the panel.
 */
const orRule = (v, n = 30) => (String(v || '').trim() || '_'.repeat(n));

/**
 * THE COVER SHEET.
 *
 * One page, and it has to survive being read in about eight seconds by
 * somebody with a queue. Patient first, because that is what they look up.
 * Then who is asking and how to reach him. Then the one sentence that tells
 * them what to DO. Then the request. Then the documents behind it.
 *
 * `o`: {
 *   patient: { name, dob },
 *   advocate: { name, business, phone, email, fax },
 *   provider: { name, address, phone, fax },
 *   request: { kind, note },
 *   docs: [ stored authority items ],
 * }
 */
export function providerPacketModel(o = {}) {
  const patient = o.patient || {};
  const adv = o.advocate || {};
  const provider = o.provider || {};
  const request = o.request || {};
  const docs = Array.isArray(o.docs) ? o.docs : [];
  const req = PROVIDER_REQUESTS.find((r) => r.id === request.kind) || PROVIDER_REQUESTS[2];

  return [
    { t: 'title', lines: ['PATIENT ADVOCATE COVER SHEET'] },
    {
      t: 'meta',
      rows: [
        ['Patient', orRule(patient.name, 34)],
        ['Date of birth', orRule(patient.dob, 20)],
        ['To', orRule(provider.name, 34)],
        ['Date', dateText(new Date())],
      ],
    },
    {
      t: 'section',
      h: 'WHO IS WRITING TO YOU',
      body: [{
        t: 'meta',
        rows: [
          ['Advocate', orRule(adv.name || 'Eric Bleach', 30)],
          ['Business', orRule(adv.business || 'Pocket Advocate', 30)],
          ['Phone', orRule(adv.phone, 26)],
          ['Secure email', orRule(adv.email, 32)],
          ['Fax', orRule(adv.fax, 26)],
        ],
      }],
    },
    {
      t: 'section',
      h: 'WHAT THE PATIENT HAS ASKED YOU TO DO',
      body: [
        {
          t: 'p',
          text: `The patient named above has designated the advocate named above to\ncommunicate with your office about their care and their payment, within the\nlimits of the authorisation attached to this sheet.`,
        },
        {
          t: 'p',
          text: `Please scan this sheet and the attached authorisation into the patient's\nchart, and note the advocate as an authorised contact on the record, so that\nyour staff can speak with him without the patient having to re-authorise it\neach time.`,
        },
        // The sentence that keeps a chart clerk from filing this as an agent
        // appointment. Verbatim from Eric's spec 4, and it is the reason this
        // is a section of its own rather than a line in a paragraph.
        {
          t: 'p',
          text: `This packet does not appoint the advocate as the patient's health-care\ndecision maker.`,
        },
      ],
    },
    {
      t: 'section',
      h: 'WHAT IS BEING ASKED FOR TODAY',
      body: [
        { t: 'lines', lines: [`${req.label}.`] },
        { t: 'p', text: req.line },
        ...(String(request.note || '').trim()
          ? [{ t: 'p', text: String(request.note).trim() }] : []),
      ],
    },
    {
      t: 'section',
      h: 'THE DOCUMENTS ATTACHED TO THIS SHEET',
      body: docs.length
        ? [{
          t: 'bullets',
          items: docs.map((d) => {
            const title = AUTHORITY_KINDS[d.kind]?.title || 'Document';
            const when = dateText(authorityEndsAt(d));
            // Say EXPIRED on the page rather than printing a date in the past
            // and letting the reader work it out. A packet that goes out on a
            // dead authorisation is the failure this whole build is about.
            const life = d.revokedAt ? 'WITHDRAWN by the patient'
              : authorityExpired(d) ? `EXPIRED on ${when || 'an unrecorded date'}`
                : when ? `valid to ${when}` : 'expiry not recorded';
            // CALL EACH DOCUMENT WHAT IT IS. Every line said "This
            // authorisation is valid to ...", including the line for the
            // patient designation, whose own page says in terms that it is
            // "not a permission of its own". Two pages in one envelope
            // contradicting each other is how a clerk decides the designation
            // is the permission and files it as one.
            const noun = d.kind === 'designation'
              ? 'This designation grants no permission of its own and is'
              : 'This authorisation is';
            return `${title}. Document ID ${shortId(d.id)}. Signed ${dateText(d.signedAt) || 'not recorded'}. ${noun} ${life}.`;
          }),
        }]
        : [{
          t: 'p',
          text: `No signed authorisation is attached to this sheet. Do not act on it until\none is.`,
        }],
    },
    {
      t: 'section',
      h: 'IF YOU CANNOT ACCEPT THE ATTACHED AUTHORISATION',
      body: [{
        t: 'p',
        text: `Please tell the advocate what your office needs instead, on the number or\nfax above. If your office requires its own release form, say so and one\nnaming your office will be prepared for the patient to sign. The patient's\nexisting authorisation stays in force either way.`,
      }],
    },
  ];
}
