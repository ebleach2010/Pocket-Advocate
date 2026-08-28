// authority.mjs — the Full Access documents (three since 2026-08-29: the
// records authorisation, the representative designation, and the scope of
// work agreement), and the route that stores them.
// The document text is legally load-bearing: a records authorisation
// missing one of the 45 CFR 164.508(c) elements is defective, which in
// practice means a records department rejects it and weeks are lost. So the
// elements are pinned here, the way duty.js's copy is pinned.
// Run: node authority.mjs
// Repo-rooted: this file runs from tools/suites/ inside the repository, so
// the sources it asserts against are found relative to itself, wherever the
// repo is checked out.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync } from 'node:fs';

const {
  recordsAuthorisation, representativeDesignation, scopeOfWork, AUTHORITY_KINDS,
  SENSITIVE_CATEGORIES, COMMUNICATION_SCOPES,
} = await import(__j(__REPO, 'public/js/authority.js'));
const { FULL_ACCESS_TERMS } = await import(__j(__REPO, 'public/js/tier-terms.js'));
const WORKER = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const CASE = readFileSync(__j(__REPO, 'public/js/case.js'), 'utf8');
const ADMIN = readFileSync(__j(__REPO, 'public/js/admin-case.js'), 'utf8');
const DEMO = readFileSync(__j(__REPO, 'public/js/demo/api.js'), 'utf8');
const AUTH = readFileSync(__j(__REPO, 'public/js/authority.js'), 'utf8');
const W = WORKER;

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

const full = recordsAuthorisation({
  clientName: 'Dana Reyes', clientDob: '1979-04-02',
  clinicName: 'Valley Neurology', clinicAddress: '10 Mesa Rd, Phoenix AZ',
  fromDate: '2024-01-01', toDate: '2026-08-01',
  categories: ['mentalHealth', 'genetic'],
  signedName: 'Dana Reyes', signedAt: '2026-08-23',
});

// ---- 45 CFR 164.508(c) core elements --------------------------------------
for (const [el, re] of [
  ['a specific description of the information', /office notes and consultation notes/i],
  ['who may disclose', /RELEASING PROVIDER[\s\S]*Valley Neurology/],
  ['who may receive', /RECEIVING PERSON[\s\S]*patient advocate/],
  ['a purpose', /PURPOSE/],
  ['an expiry', /EXPIR(Y|ES)/i],
  ['a signature and date', /SIGNATURE[\s\S]*Signed:[\s\S]*Date:/],
]) check(`A1 core element present: ${el}`, re.test(full));

// ---- the three required statements -----------------------------------------
check('A2 right to revoke, and how',
  /revoke this authorisation at any time by writing/i.test(full));
check('A3 revocation cannot undo what was already relied on',
  /cannot undo a\s*\n?\s*release already made/i.test(full));
check('A4 treatment may not be conditioned on signing',
  /may not condition my treatment, payment, enrolment, or\s*\n?\s*eligibility/i.test(full));
check('A5 re-disclosure warning',
  /may be re-disclosed[\s\S]*no longer be protected/i.test(full));

// ---- sensitive categories are opt-in, never bundled -------------------------
check('A6 ticked categories are named specifically',
  /I SPECIFICALLY authorise/.test(full)
  && /Mental health records/.test(full) && /Genetic testing records/.test(full));
check('A7 unticked categories are named as NOT authorised',
  /Substance use/.test(full) === false || !/  - Substance use/.test(full));

const none = recordsAuthorisation({ clientName: 'Dana Reyes', clinicName: 'X' });
check('A8 with nothing ticked the form says so explicitly, rather than staying silent',
  /I have NOT authorised release of separately protected categories/.test(none));
check('A9 psychotherapy notes are excluded in both forms',
  /Psychotherapy notes maintained separately/.test(full)
  && /Psychotherapy notes maintained separately/.test(none));
check('A10 every sensitive category carries its own explanation',
  SENSITIVE_CATEGORIES.length >= 5 && SENSITIVE_CATEGORIES.every((c) => c.id && c.label && c.note));
check('A11 Part 2 and its redisclosure limits are named on the substance-use row',
  /42 CFR Part 2/.test(SENSITIVE_CATEGORIES.find((c) => c.id === 'substanceUse').note));

// ---- the representative designation is a DIFFERENT document ----------------
const rep = representativeDesignation({
  clientName: 'Dana Reyes', memberId: 'XYZ123', planName: 'Blue Cross AZ',
  signedName: 'Dana Reyes', signedAt: '2026-08-23',
});
check('R1 it grants appeal authority, which a records release does not',
  /file and pursue internal\s*\n?\s*appeals/i.test(rep) && /external review/i.test(rep));
check('R2 it asks for the plan documents and the reviewer credentials',
  /medical policies, and clinical criteria/i.test(rep) && /credentials of the reviewer/i.test(rep));
check('R3 it disclaims legal representation and medical decisions',
  /not an attorney/i.test(rep) && /does not let my representative make medical decisions/i.test(rep)
  && /not a power of attorney/i.test(rep));
check('R4 it is revocable and time limited',
  /revoke it at any time/i.test(rep) && /stays in effect until/i.test(rep));
check('R5 the two documents are not the same text',
  !/RELEASING PROVIDER/.test(rep) && !/file and pursue internal/.test(full));

// ---- the route -------------------------------------------------------------
check('W1 records live under the case private subtree, which no browser can read',
  /cases\/\$\{id\}\/private\/authority\/items/.test(WORKER));
check('W2 the advocate can never sign for the client',
  /if \(ctx\.isAdmin\) return json\(\{ error: 'Only the client can sign this\.' \}, 403\)/.test(WORKER));
check('W3 the advocate can never revoke for the client either',
  /Only the client can revoke this/.test(WORKER));
check('W4 the signing time is stamped by the Worker, never taken from the browser',
  /signedAt: new Date\(\),/.test(WORKER) && /a client-sent timestamp is/.test(WORKER));
check('W5 signing requires the name on the case',
  /Sign with the same name that is on this case/.test(WORKER));
// W6 said "only a Full Access case can hold authorisations" and pinned the one
// blanket gate that made it true. Eric changed the rule on 2026-08-26: the
// records release is what gets a clinic to send records and lets him ring and
// ask for the rest, which is the standard case, and gating it hid the form
// from exactly the clients who needed it. The gate is per DOCUMENT now, so
// this pins the new rule and its two halves rather than being deleted.
check('W6a a records release can be signed on any case',
  !/if \(!c\?\.data\.fullAccess\)\n\s*return json/.test(WORKER)
  && /THE TIER GATE IS PER DOCUMENT/.test(WORKER));
// W6b grew a second kind on 2026-08-29: the scope of work agreement is the
// Hands-Off engagement itself (Eric: "All I need is scope of work
// agreement"), so it shares the designation's gate. The pinned source moved
// from `kind === 'representative'` to the two-kind form; updated, not
// deleted.
check('W6b the insurance designation and the scope agreement are Hands-Off only',
  /if \(\(kind === 'representative' \|\| kind === 'scope'\) && !c\.data\.fullAccess\)\n\s*return json\(\{ error: 'This case is not on Hands-Off Case Management\.' \}, 409\);/.test(WORKER));
// The half that is easy to lose when a gate moves: somebody who signed while
// on Hands-Off must still be able to withdraw afterwards. The old blanket gate
// sat above the revoke branch and answered 409, which left them holding a
// permission they could not take back. Anchor updated 2026-08-29 with the
// gate's new two-kind source, and both anchors are required to exist first:
// indexOf on a missing needle is -1, which sits "before" everything and
// passed this check over a file that contained neither line.
{
  const revokeAt = WORKER.indexOf("if (body?.action === 'revoke')");
  const gateAt = WORKER.indexOf("if ((kind === 'representative' || kind === 'scope') && !c.data.fullAccess)");
  check('W6c withdrawing is never gated on the tier',
    revokeAt >= 0 && gateAt >= 0 && revokeAt < gateAt);
}
// The one thing revoke refuses (2026-08-29): the scope of work agreement is
// the contract the case runs on, not a permission, and one tap cannot
// un-agree a contract. The refusal has to come BEFORE the revokedAt write.
// NEGATIVE CONTROL (run 2026-08-29): rewording the refusal so its anchor
// phrase vanished made this read
//   FAIL  W6d the scope agreement cannot be revoked by one tap
{
  const refuseAt = WORKER.indexOf('the agreement your case runs on, not a permission');
  const writeAt = WORKER.indexOf('{ revokedAt: new Date() }');
  check('W6d the scope agreement cannot be revoked by one tap',
    refuseAt >= 0 && writeAt >= 0 && refuseAt < writeAt
    && /const target = await getDoc\(env, `\$\{coll\}\/\$\{itemId\}`\);/.test(WORKER));
}
check('W7 both sides read through threadContext, so a stranger gets a 404 or 403',
  /const ctx = await threadContext\(env, user, 'case', id\);\n  if \(ctx\.error\) return json\(\{ error: ctx\.error \}, ctx\.code\);\n  const coll = `cases\/\$\{id\}\/private\/authority/.test(WORKER));
// authorityAt is stamped at the first signature and is NOT the window any
// more - the window runs 60 days from the first call (fullAccessWindowEnd).
// The field is kept as the record of when he first had authority to act.
check('W8 authorityAt is stamped at the first signature',
  /if \(!c\.data\.authorityAt\)/.test(WORKER) && /authorityAt: new Date\(\)/.test(WORKER));
// The scope signature stamps its own field (2026-08-29). scopeSignedAt is
// what the readiness checklist reads, because handsOffReadiness sees only
// the case doc, never the private items. And it must NOT stamp authorityAt:
// agreeing the engagement is not authority to phone anyone.
// NEGATIVE CONTROL (run 2026-08-29): renaming the stamped field made this
// read
//   FAIL  W8b a scope signature stamps scopeSignedAt on the case
check('W8b a scope signature stamps scopeSignedAt on the case',
  /\{ scopeSignedAt: new Date\(\) \}, \{ mask: \['scopeSignedAt'\] \}/.test(WORKER)
  && /kind === 'scope'/.test(WORKER));
// NEGATIVE CONTROL (run 2026-08-29): adding 'appeal' to the Worker list made
// this read
//   FAIL  W9 the Worker and the module agree on the document kinds
check('W9 the Worker and the module agree on the document kinds',
  /const AUTHORITY_KINDS = \['records', 'representative', 'scope'\];/.test(WORKER)
  && Object.keys(AUTHORITY_KINDS).join(',') === 'records,representative,scope');

// ---- the beefed-up release: what he may DO, and the drawn signature ----
// (Eric, 2026-08-25: "Essentially a beefed up release of records" so he can
// speak on their behalf, with tick boxes, a finger signature, and a gate
// that refuses an incomplete document.)
const scoped = recordsAuthorisation({
  clientName: 'Dana Reyes', clinicName: 'Valley Neurology',
  scopes: ['discuss', 'records'], signedName: 'Dana Reyes', signedAt: '2026-08-23',
});
check('S1 the scopes list is real and each row explains itself',
  COMMUNICATION_SCOPES.length >= 3
  && COMMUNICATION_SCOPES.every((x) => x.id && x.label && x.note));
check('S2 the document says what the advocate may do, not just what may be sent',
  /WHAT I AUTHORISE MY ADVOCATE TO DO/.test(scoped)
  && /Discuss my care with my advocate/.test(scoped));
check('S3 only the ticked scopes print',
  /\[X\] Discuss my care/.test(scoped)
  && !/\[X\] Handle scheduling/.test(scoped));
check('S4 a legacy document with no scopes stored still prints the full set',
  (() => {
    const legacy = recordsAuthorisation({ clientName: 'Dana Reyes', clinicName: 'X' });
    return COMMUNICATION_SCOPES.every((x) => legacy.includes(x.label));
  })());
check('S5 a blank prints empty boxes to tick by hand, not ticked ones',
  /\[ \] Discuss my care/.test(recordsAuthorisation({ blank: true })));
check('S6 the Worker mirrors the scope ids exactly, and says why it must',
  /const AUTHORITY_SCOPE_IDS = \['discuss', 'records', 'admin'\];/.test(WORKER)
  && /cannot import a client module/.test(WORKER)
  && COMMUNICATION_SCOPES.map((x) => x.id).join(',') === 'discuss,records,admin');
check('S7 the signature is validated as an image, not trusted as a string',
  /\^data:image\\\/\(png\|jpe\?g\);base64,\[A-Za-z0-9\+\/=\]\+\$/.test(WORKER)
  && /AUTHORITY_SIG_MAX/.test(WORKER));
check('S8 the Worker refuses an unsigned document, whatever the page did',
  /Sign the document with your finger before sending it\./.test(WORKER)
  && /Sign the document with your finger before sending it\./.test(DEMO));
check('S9 the completeness gate carries Eric\'s wording, exactly',
  CASE.includes('Your document is incomplete. please review the full document and be sure you did not miss any areas requiring your selection or signature.'));
check('S10 bad fields go red and the pad is one of them',
  /field-bad/.test(CASE) && /mark\('\[data-sig-open\]'\)/.test(CASE));
check('S11 the signature prints on paper, outside the document text',
  /function signatureInk/.test(CASE) && /function signatureInk/.test(ADMIN)
  && /<\/pre>\$\{signatureInk\(item\)\}/.test(CASE)
  && /<\/pre>\$\{signatureInk\(item\)\}/.test(ADMIN));
check('S12 and it is re-checked before it is ever written into a document',
  (CASE.match(/data:image\\\/\(png\|jpe\?g\);base64/g) || []).length >= 1
  && (ADMIN.match(/data:image\\\/\(png\|jpe\?g\);base64/g) || []).length >= 1);
// Was: "the demo stores both new fields". Strengthened on 2026-08-25 - the
// demo used to store whatever scopes array arrived and refuse a missing
// signature FIRST, so the same bad POST got a different answer depending on
// which side you were driving. It now mirrors the Worker's filter, its
// signature shape check, and its refusal ORDER.
check('S13 the demo stores both new fields, so it cannot silently drop them',
  /scopes,/.test(DEMO) && /signatureImage: body\.signatureImage/.test(DEMO));
check('S14 the demo filters scopes against the same allowlist the Worker has',
  /\['discuss', 'records', 'admin'\]\.includes\(x\)/.test(DEMO));
check('S15 the demo validates the signature shape, not just its presence',
  /data:image\\\/\(png\|jpe\?g\);base64/.test(DEMO));
check('S16 the demo refuses in the Worker order: kind, name, subject, then signature',
  DEMO.indexOf("fail(400, 'Type your full name to sign.')")
    < DEMO.indexOf("fail(400, 'Name the clinic this authorisation is for.')")
  && DEMO.indexOf("fail(400, 'Name the clinic this authorisation is for.')")
    < DEMO.indexOf("Sign the document with your finger"));
check('S17 a withdrawn authorisation in the demo survives a reload',
  /revokedAt: new Date\(\) \}\);\n\s*store\.persist\?\.\(\)/.test(DEMO));
// The two document-correctness bugs the 2026-08-25 audit found.
check('S18 a bare YYYY-MM-DD is read as a wall date, not as UTC midnight',
  /T12:00:00Z/.test(AUTH),
  'new Date("2024-01-01") is UTC midnight; rendering in Etc/GMT+7 walked it back a day');
check('S19 unticking every scope prints as unticked, not as all three',
  recordsAuthorisation({ scopes: [] }).includes('I have not authorised any of the items above')
  && !recordsAuthorisation({ scopes: [] }).includes('[X]'));
check('S20 a document with no scopes field at all is still the legacy full set',
  (recordsAuthorisation({}).match(/\[X\]/g) || []).length === 3);
check('S21 the Worker refuses a records form that authorises nothing',
  /kind === 'records' && !item\.scopes\.length/.test(W));
check('S22 the Worker parses dates instead of storing whatever arrives',
  /fromDate: wallDate\(body\?\.fromDate\)/.test(W) && /function wallDate/.test(W));
check('S23 the Worker checks the image bytes, not just the data-url wrapper',
  /looksLikeImage/.test(W) && /0x89 && b\[1\] === 0x50/.test(W));
check('S24 the list GET omits the signature blobs unless one is asked for by id',
  /hasSignature: !!signatureImage/.test(W) && /url\.searchParams\.get\('id'\)/.test(W));
check('S25 a signature nobody can draw is not the only route',
  /data-sig-typed/.test(CASE), 'pointer-only would lock out the whole tier');

// ---- S26-S30: the stored document, LIFTED AND RUN ------------------------
//
// The ONE place a client's own typed text lands inside a document that is
// stored as text/html and served contentDisposition: inline. The name comes
// from them at booking. authorityDocHtml escapes it, and until now nothing in
// this repo ran that escape against anything needing escaping.
//
// This file pinned the form TEXT as source and never called the builder.
// uploads.mjs stubbed it in all three of its harnesses. drive-forms.mjs opens
// the real stored document, with the demo's client name, "Jordan Avery": no
// ampersand, no angle bracket, nothing to escape.
//
// MEASURED on main, 2026-08-28, by deleting the escape from the builder that
// sendBlankForms stores: a raw <script> reached the stored document and all
// TWENTY suites stayed green.
//
// THE ESCAPE APPEARS TWICE in admin-case.js, the stored path and the print
// path. The first attempt at that measurement replaced one occurrence of a
// string that was there twice, refused itself, and reported "20/20 green" over
// a tree it had not modified. The break script counts its sites now.
{
  const src = (ADMIN.match(/function authorityDocHtml\(item\) \{[\s\S]*?\n\}/) || [''])[0];
  check('S26 the stored document builder lifts out of the shipped page',
    src.length > 0, `${src.length} chars`);

  const HOSTILE = 'Jordan <script>alert(1)</script> & Avery';
  let doc = '';
  if (src) {
    try {
      const fn = new Function('data', 'recordsAuthorisation', 'representativeDesignation',
        'authorityDocTitle', 'signatureInk', `${src}\n return authorityDocHtml;`)(
        { clientName: HOSTILE, clientDob: '1990-01-01' },
        recordsAuthorisation, representativeDesignation,
        () => 'Records authorisation', () => '');
      doc = fn({ kind: 'records', blank: false });
    } catch (e) { doc = ''; }
  }

  // THE ABSOLUTE BEFORE THE RELATIVE, and it is the whole reason this block
  // is ordered like this: "no raw script tag" is satisfied perfectly by an
  // empty document. So first prove the name got in at all.
  // NEGATIVE CONTROL (2026-08-28): stubbing recordsAuthorisation to return ''
  //   FAIL  S27 the client's own name reaches the document  -- 0 chars
  check("S27 the client's own name reaches the document",
    doc.length > 500 && doc.includes('Jordan') && doc.includes('Avery'),
    `${doc.length} chars`);

  // NEGATIVE CONTROL (2026-08-28): deleting the .replace from the builder
  //   FAIL  S28 and every angle bracket in it is escaped  -- raw <script> present
  check('S28 and every angle bracket in it is escaped, so their name cannot be markup',
    doc.length > 500 && !/<script>alert/.test(doc) && /&lt;script&gt;alert/.test(doc),
    /<script>alert/.test(doc) ? 'raw <script> present in the stored document'
      : 'the escaped form is missing too');

  // The ampersand matters on its own: escaping < and > while leaving & turns
  // a name containing "&amp;" into a bracket on the way back out.
  // NEGATIVE CONTROL (2026-08-28): dropping & from the character class
  //   FAIL  S29 ... -- the bare ampersand survived
  check('S29 and the bare ampersand with it, not just the brackets',
    /&amp; Avery/.test(doc), 'the bare ampersand survived unescaped');

  // BOTH BUILDERS, because there are two and only one is covered above. The
  // print path writes into a window rather than Storage, but it is the same
  // client-supplied name in the same shape of document.
  // NEGATIVE CONTROL (2026-08-28): removing either one
  //   FAIL  S30 ... -- 1 of 2 document builders escape
  const escapes = (ADMIN.match(/text\.replace\(\/\[&<>\]\/g/g) || []).length;
  check('S30 and both document builders escape, the stored one and the printed one',
    escapes === 2, `${escapes} of 2 document builders escape`);
}

// ---- S31-S34: the scope of work agreement (Eric, 2026-08-29) --------------
// "Remove those. I have those sent manually. All I need is scope of work
// agreement. The rest I handle." The third document: signed in the app when
// Hands-Off opens by hand, run here the same way the other two are.
const sow = scopeOfWork({
  clientName: 'Dana Reyes', signedName: 'Dana Reyes', signedAt: '2026-08-29',
});
// NEGATIVE CONTROL (run 2026-08-29): renaming the MONEY heading in the
// builder made this read
//   FAIL  S31 the agreement covers the work, the limits and the money
check('S31 the agreement covers the work, the limits and the money',
  /SCOPE OF WORK AGREEMENT/.test(sow) && /THE WORK/.test(sow)
  && /WHAT THIS IS NOT/.test(sow) && /MONEY/.test(sow)
  && /Dana Reyes/.test(sow) && /Signed electronically by the client/.test(sow));
// The agreement is the scope note restated for a signature. It must not
// promise anything FULL_ACCESS_TERMS does not: these phrases are the
// substance both must carry, word for word, so an edit to one shows up here
// until the other catches up.
// NEGATIVE CONTROL (run 2026-08-29): changing "person to person" in the
// builder alone made this read
//   FAIL  S32 its promises are the scope note's promises
// Whitespace-normalised on both sides: the agreement is plain text wrapped
// at a fixed column, so a phrase can span a line break and still be the
// phrase.
check("S32 its promises are the scope note's promises, word for word where it counts",
  (() => {
    const flatSow = sow.replace(/\s+/g, ' ');
    const flatTier = FULL_ACCESS_TERMS.body.replace(/\s+/g, ' ');
    return ['at least twice a month', 'Refunds are not automatic', 'not an attorney', 'person to person']
      .every((p) => flatSow.includes(p) && flatTier.includes(p));
  })());
// Same rule the other two blanks follow: ruled lines, no attestation nobody
// made.
// NEGATIVE CONTROL (run 2026-08-29): forcing signatureBlock's signed branch
// for blanks made this read
//   FAIL  S33 a blank prints ruled lines and no attestation
check('S33 a blank prints ruled lines and no attestation',
  (() => {
    const b = scopeOfWork({ blank: true });
    return b.includes('Signed: _') && !b.includes('Signed electronically');
  })());
// The stored-document builder, lifted and run against the NEW kind with the
// same hostile name S26-S30 use. The scope agreement is stored and printed
// by the same two builders, and the client's name lands in it the same way.
// NEGATIVE CONTROL (run 2026-08-29): dropping & from the escape set in both
// builders made this read
//   FAIL  S34 the scope agreement escapes the client name like the other two  -- 4012 chars
// (S29 and S30 went red with it, as they should: one escape set, three
// documents.)
{
  const src = (ADMIN.match(/function authorityDocHtml\(item\) \{[\s\S]*?\n\}/) || [''])[0];
  const HOSTILE = 'Jordan <script>alert(1)</script> & Avery';
  let sdoc = '';
  if (src) {
    try {
      const fn = new Function('data', 'recordsAuthorisation', 'representativeDesignation',
        'scopeOfWork', 'authorityDocTitle', 'signatureInk', `${src}\n return authorityDocHtml;`)(
        { clientName: HOSTILE, clientDob: '1990-01-01' },
        recordsAuthorisation, representativeDesignation, scopeOfWork,
        () => 'Scope of work agreement', () => '');
      sdoc = fn({ kind: 'scope', blank: false });
    } catch { sdoc = ''; }
  }
  check('S34 the scope agreement escapes the client name like the other two',
    sdoc.length > 500 && sdoc.includes('Jordan')
    && !/<script>alert/.test(sdoc) && /&lt;script&gt;alert/.test(sdoc)
    && /&amp; Avery/.test(sdoc),
    `${sdoc.length} chars`);
}

// ---- S35: the contact tick (Eric, 2026-08-29) -----------------------------
// "a tick box saying that he agrees I can contact him via phone by text or
// phone call. He can return my calls, but non-urgent messages should be
// used in the app chat portal." The box prints as the client left it, the
// Worker refuses a scope signature without it, and the sheet's copy never
// arrives pre-ticked: a consent that arrives ticked is not one the client
// gave.
// NEGATIVE CONTROL (run 2026-08-29): hardcoding contactMark to '[X]' made
// this read
//   FAIL  S35 the agreement prints the contact box as the client left it
check('S35 the agreement prints the contact box as the client left it',
  (() => {
    const ticked = scopeOfWork({ clientName: 'D', contactOk: true }).replace(/\s+/g, ' ');
    const un = scopeOfWork({ clientName: 'D' }).replace(/\s+/g, ' ');
    const blank = scopeOfWork({ blank: true }).replace(/\s+/g, ' ');
    return /CONTACT \[X\] My advocate may contact me/.test(ticked)
      && /phone call or a text message/.test(ticked)
      && /not urgent goes through my case chat/.test(ticked)
      && /CONTACT \[ \] My advocate may contact me/.test(un)
      && /CONTACT \[ \]/.test(blank);
  })());
// NEGATIVE CONTROL (run 2026-08-29): deleting the Worker gate made this read
//   FAIL  S35b the Worker refuses a scope signature without the tick
check('S35b the Worker refuses a scope signature without the tick',
  /if \(kind === 'scope' && !item\.contactOk\)/.test(WORKER)
  && /Tick the box that lets me phone and text you about your case\./.test(WORKER)
  && /contactOk: body\?\.contactOk === true,/.test(WORKER));
// NEGATIVE CONTROL (run 2026-08-29): pre-ticking the sheet's box made this
// read
//   FAIL  S35c the sheet box arrives unticked and gates in red
check('S35c the sheet box arrives unticked and gates in red',
  /<input type="checkbox" data-contact>/.test(CASE)
  && !/data-contact checked/.test(CASE)
  && /if \(isScope && !overlay\.querySelector\('\[data-contact\]:checked'\)\)\n\s*mark\('\[data-contact\]'\);/.test(CASE)
  && /contactOk: !!overlay\.querySelector\('\[data-contact\]:checked'\)/.test(CASE));
// NEGATIVE CONTROL (run 2026-08-29): dropping the demo gate made this read
//   FAIL  S35d and the demo refuses it the same way
check('S35d and the demo refuses it the same way',
  /body\.kind === 'scope' && body\.contactOk !== true/.test(DEMO)
  && /contactOk: body\.contactOk === true,/.test(DEMO));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
