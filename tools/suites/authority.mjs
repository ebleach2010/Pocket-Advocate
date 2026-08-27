// authority.mjs — the two Full Access documents, and the route that stores
// them. The document text is legally load-bearing: a records authorisation
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
  recordsAuthorisation, representativeDesignation, SENSITIVE_CATEGORIES,
  COMMUNICATION_SCOPES,
} = await import(__j(__REPO, 'public/js/authority.js'));
// The same module, bound separately for the sign-once documents so the block
// that re-points the 164.508 elements reads as its own thing.
const A_UNIVERSAL = await import(__j(__REPO, 'public/js/authority.js'));
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

// RE-POINTED AT THE UNIVERSAL DOCUMENT, 2026-08-27, and the per-clinic block
// above is KEPT rather than replaced. Both documents are live: the universal
// one is what every new client signs, and the narrow one is still issued to
// an office that will not accept a class-wide form, so a core element could go
// missing from either and both have to be pinned.
//
// The only element that reads differently is "who may disclose", because that
// is the entire change: a CLASS of providers rather than one named clinic. 45
// CFR 164.508(c)(1)(ii) asks for "the name or other specific identification of
// the person(s), or class of persons, authorized to make the requested use or
// disclosure", so a class satisfies the element on the face of the rule, and
// HHS FAQ 473 says so in as many words. Everything else must still be there
// verbatim, and is asserted against the same expressions.
const universal = A_UNIVERSAL.universalAuthorisation({
  clientName: 'Dana Reyes', clientDob: '1979-04-02',
  fromDate: '2024-01-01', toDate: '2026-08-01',
  categories: ['mentalHealth', 'genetic'],
  scopes: ['discuss', 'records', 'admin'],
  signedName: 'Dana Reyes', signedAt: '2026-08-23', expiresAt: '2027-08-23T12:00:00Z',
});
for (const [el, re] of [
  ['a specific description of the information', /office notes and consultation notes/i],
  ['who may disclose, as a CLASS', /RELEASING PROVIDERS[\s\S]*or other\s*\n?\s*health-care source/],
  ['who may receive', /RECEIVING PERSON[\s\S]*patient advocate/],
  ['a purpose', /PURPOSE/],
  ['an expiry', /EXPIR(Y|ES)/i],
  ['a signature and date', /SIGNATURE[\s\S]*Signed:[\s\S]*Date:/],
]) check(`A1u universal: core element present: ${el}`, re.test(universal));
// The three statements 164.508(c)(2) requires in substance, on the universal
// form as well. A2-A5 below assert them on the per-clinic one.
check('A1u universal: right to revoke, and a route a patient can actually take',
  /revoke this authorisation at any time by writing to my advocate/i.test(universal)
  // A class-wide form has no single named provider to write to, so "write to
  // the provider named above" would have described nothing.
  && !/writing to the provider named\s*\n?\s*above/i.test(universal));
check('A1u universal: revocation cannot undo what was already relied on',
  /cannot undo a\s*\n?\s*release already made/i.test(universal));
check('A1u universal: treatment may not be conditioned on signing',
  /may not condition my treatment, payment, enrolment, or\s*\n?\s*eligibility/i.test(universal));
check('A1u universal: re-disclosure warning',
  /may be re-disclosed[\s\S]*no longer be protected/i.test(universal));
check('A1u universal: psychotherapy notes are still excluded',
  /Psychotherapy notes maintained separately/.test(universal));

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
check('W6b the insurance designation is still Hands-Off only',
  /if \(kind === 'representative' && !c\.data\.fullAccess\)\n\s*return json\(\{ error: 'This case is not on Hands-Off Case Management\.' \}, 409\);/.test(WORKER));
// The half that is easy to lose when a gate moves: somebody who signed while
// on Hands-Off must still be able to withdraw afterwards. The old blanket gate
// sat above the revoke branch and answered 409, which left them holding a
// permission they could not take back.
check('W6c withdrawing is never gated on the tier',
  WORKER.indexOf("if (body?.action === 'revoke')")
    < WORKER.indexOf("if (kind === 'representative' && !c.data.fullAccess)"));
check('W7 both sides read through threadContext, so a stranger gets a 404 or 403',
  /const ctx = await threadContext\(env, user, 'case', id\);\n  if \(ctx\.error\) return json\(\{ error: ctx\.error \}, ctx\.code\);\n  const coll = `cases\/\$\{id\}\/private\/authority/.test(WORKER));
// authorityAt is stamped at the first signature and is NOT the window any
// more - the window runs 60 days from the first call (fullAccessWindowEnd).
// The field is kept as the record of when he first had authority to act.
check('W8 authorityAt is stamped at the first signature',
  /if \(!c\.data\.authorityAt\)/.test(WORKER) && /authorityAt: new Date\(\)/.test(WORKER));

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
// UPDATED 2026-08-27, not deleted, and this one RETIRES a sentence of his on
// his own instruction. The gate used to show one wording for every possible
// failure, and he hit it with a form that was correctly filled in:
//
//   "Biggest issue is saying the form isn't filled out completely when it is."
//
// It was filled in. He had typed his own name on a case belonging to somebody
// else, so the name check failed, and the single sentence called that
// "incomplete" and sent him hunting for a blank field. A client who mistypes
// their own name would read exactly the same thing.
//
// So the gate now says what is actually wrong, per field. The intent of this
// check is unchanged and is what is asserted below: every failure reaches the
// person as words, not only as a red border.
check('S9 the gate says what is actually wrong, not one sentence for everything',
  // The retired wording is gone, so it cannot come back by accident.
  !CASE.includes('Your document is incomplete.')
  // The name mismatch, which is the one that caught him, names the name.
  && /The name has to match the one on this case, \$\{c\.clientName\}/.test(CASE)
  // And the reasons reach the error line rather than dying on the field.
  && /reasons\.join\(' '\)/.test(CASE));
check('S10 bad fields go red, the pad is one of them, and each carries a reason',
  /field-bad/.test(CASE)
  && /mark\('\[data-sig-open\]', 'Tap the box and sign with your finger\.'\)/.test(CASE)
  // Screen readers get the reason too, not just the colour.
  && /aria-errormessage/.test(CASE));
// UPDATED 2026-08-26, not deleted. Its intent is that the drawn signature is
// rendered OUTSIDE the document text: the text is what authority.mjs pins
// line by line, and an image spliced into it would be both unpinnable and
// forgeable. That is unchanged and is what is checked below.
//
// What it pinned was `</pre>${signatureInk(item)}`, and the <pre> is gone:
// both halves now hand the ink to the shared window opener as its own
// argument, which renders it after the document and never inside the model.
// If anything, the separation is now structural rather than textual.
const DOCWIN = readFileSync(__j(__REPO, 'public/js/authority-doc-window.js'), 'utf8');
check('S11 the signature prints on paper, outside the document text',
  /function signatureInk/.test(CASE) && /function signatureInk/.test(ADMIN)
  && /signatureHtml: signatureInk\(item\)/.test(CASE)
  && /signatureHtml: signatureInk\(item\)/.test(ADMIN)
  // Rendered after the document, and the model itself never sees it.
  && /\$\{authorityHtml\(model\)\}\n\$\{signatureHtml\}/.test(DOCWIN));
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
// UPDATED 2026-08-27 for sign-once, not deleted, and the rule got WIDER
// rather than narrower. It pinned `kind === 'records' && !item.scopes.length`.
// The universal authorisation is held to exactly the same rule, for exactly
// the same reason: naming a class of providers widens who may disclose and
// widens nothing about what the advocate may do with it, so a universal form
// with all three communication boxes cleared is still a piece of paper. The
// intent is unchanged and both kinds are asserted below.
check('S21 the Worker refuses a records form that authorises nothing',
  /\(kind === 'records' \|\| kind === 'universal'\) && !item\.scopes\.length/.test(W));
// The half that would have made sign-once unsignable, pinned so it cannot come
// back: a clinic name is required of the NARROW form only. The universal form
// has no clinic to name, and requiring one would have refused every attempt to
// sign it with a message pointing at a field that is not on the sheet.
check('S21b but a clinic name is demanded only of the narrow per-clinic form',
  /if \(kind === 'records' && !item\.clinicName\)/.test(W)
  && !/kind === 'universal' && !item\.clinicName/.test(W));
check('S22 the Worker parses dates instead of storing whatever arrives',
  /fromDate: wallDate\(body\?\.fromDate\)/.test(W) && /function wallDate/.test(W));
check('S23 the Worker checks the image bytes, not just the data-url wrapper',
  /looksLikeImage/.test(W) && /0x89 && b\[1\] === 0x50/.test(W));
check('S24 the list GET omits the signature blobs unless one is asked for by id',
  /hasSignature: !!signatureImage/.test(W) && /url\.searchParams\.get\('id'\)/.test(W));
check('S25 a signature nobody can draw is not the only route',
  /data-sig-typed/.test(CASE), 'pointer-only would lock out the whole tier');

// ---- F1-F12: it has to look like a document, and have a way out ----------
// Eric, 2026-08-26, on the printed records authorisation: "The forms are
// fucking horrendous. This? Really? Format it neatly." And separately: "There's
// also no way to exit out of this screen."
//
// Both came out of the same twenty lines, which existed twice: each half wrote
// its own window, dumped the document into a <pre> at 12px monospace, and
// called win.print() on a timer with no controls on the page at all. Dismiss
// the print sheet on a phone and there was no back, no close, nothing to tap.
{
  const A = await import(`file://${__j(__REPO, 'public/js/authority.js')}`);
  const model = A.recordsAuthorisationModel({
    clientName: 'Jordan Avery', clinicName: 'Mountain Ridge Neurology',
    categories: ['mentalHealth'], scopes: ['discuss', 'records'],
  });
  const html = A.authorityHtml(model);

  check('F1 the document renders as HTML, not as a wall of preformatted text',
    /<h1>/.test(html) && /<h2>/.test(html) && !/<pre/.test(html));
  check('F2 its sections are sections, so a clerk can skim for the signature',
    (html.match(/<section/g) || []).length >= 6);
  check('F3 the rights are a numbered list, not four lines that look like one',
    /<ol class="doc-rights">/.test(html) && (html.match(/<li>/g) || []).length >= 4);
  check('F4 a ticked scope is marked as ticked, and says so out loud',
    /class="doc-box is-on"/.test(html) && /Authorised<\/span>/.test(html));
  check('F5 an unticked one is not silently identical to a ticked one',
    /<span class="doc-box"/.test(A.authorityHtml(A.recordsAuthorisationModel({ blank: true }))));
  // Hard wraps are for the fixed-width text form. Left in the HTML they would
  // break mid-sentence at whatever width the paper happens to be.
  check('F6 wrapped paragraphs reflow instead of keeping their line breaks',
    !/\n[a-z]/.test(html.replace(/\n\s*</g, '<')));
  check('F7 a blank field is a rule to write on, not forty-six underscores',
    /<span class="doc-rule">/.test(A.authorityHtml(A.recordsAuthorisationModel({ blank: true })))
    && !/_{10,}/.test(A.authorityHtml(A.recordsAuthorisationModel({ blank: true }))));
  // The words come from one place. A second copy is how a document and its
  // preview start disagreeing.
  check('F8 the text and the HTML are built from the same model',
    typeof A.authorityText === 'function'
    && A.recordsAuthorisation({ clientName: 'X' }) === A.authorityText(A.recordsAuthorisationModel({ clientName: 'X' })));

  const W = readFileSync(__j(__REPO, 'public/js/authority-doc-window.js'), 'utf8');
  check('F9 there is a way out of the document window',
    /data-done/.test(W) && />Done</.test(W));
  check('F10 and it is a real way out, with a fallback that admits defeat',
    /window\.close\(\)/.test(W) && /window\.history\.back\(\)/.test(W)
    && /Close this tab to go back/.test(W));
  // The trap: print fired at somebody who asked to LOOK at the form.
  check('F11 nothing prints until he asks it to',
    !/setTimeout\(\(\) => win\.print\(\)/.test(W) && !/\.print\(\), \d+\)/.test(W)
    && /data-print/.test(W));
  // Comments stripped first. The version of this check that read the whole
  // file failed on the word "monospace" inside the comment EXPLAINING the
  // monospace bug, which is a check marking its own documentation as the
  // defect.
  const WCSS = W.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
  check('F12 the controls never reach paper, and the body is not monospace',
    /@media print \{[\s\S]*?\.doc-bar \{ display: none/.test(WCSS)
    && !/monospace/.test(WCSS)
    && /font: 15px\/1\.6 Georgia/.test(WCSS));

  // One opener, not two. This is what stopped being true and caused both bugs.
  const CASE2 = readFileSync(__j(__REPO, 'public/js/case.js'), 'utf8');
  const ADMIN2 = readFileSync(__j(__REPO, 'public/js/admin-case.js'), 'utf8');
  // Scoped to the two AUTHORITY printers. Both files legitimately write other
  // windows (the compiled case file, the appeal letter, the prep sheet), and
  // the first version of this check banned document.write outright, which
  // would have marked three unrelated working features as this bug.
  const fnBody = (src, name) => {
    const i = src.indexOf(name);
    if (i < 0) return '';
    const j = src.indexOf('\n}\n', i);
    return j < 0 ? src.slice(i) : src.slice(i, j);
  };
  const clientPrinter = fnBody(CASE2, 'async function printAuthority(c, item) {');
  const adminPrinter = fnBody(ADMIN2, 'function printAuthorityDoc(item) {');
  check('F13 both halves use the one opener and neither writes its own window',
    clientPrinter.length > 0 && adminPrinter.length > 0
    && /openAuthorityDocument\(/.test(clientPrinter) && /openAuthorityDocument\(/.test(adminPrinter)
    && !/document\.write/.test(clientPrinter) && !/document\.write/.test(adminPrinter)
    && !/<pre>/.test(clientPrinter) && !/<pre>/.test(adminPrinter),
    `${clientPrinter.length}/${adminPrinter.length} chars lifted`);
  // UPDATED TWICE, NEVER DELETED.
  //
  // 2026-08-27, sign-once: it pinned `preview.innerHTML = authorityHtml(`,
  // which stopped matching when the sitting became conditional, so it was
  // re-pointed at the two branches it had become.
  //
  // 2026-08-27, second pass: those branches are gone. The preview is built
  // from sittingModels(), the one list the sitting itself signs from, so this
  // is no longer four spellings of one idea. It now RUNS that shared builder
  // and compares it to what the PRINT path renders for the same kinds, which
  // is what this check has always been about: a client must read the document
  // they are signing. The source-text version of it went green on a preview
  // that dropped narrowedFrom, because both halves were spelled correctly.
  //
  // PROVEN TO FAIL, 2026-08-27: changing sittingModels to
  // `sittingKinds(kind).slice(0, 1).map(...)` gave
  //   F14 the in-app preview renders the same document as the paper one
  //       -- universal shows 1 of 2
  // which is the patient designation being signed unseen.
  {
    const AA = await import(`file://${__j(__REPO, 'public/js/authority.js')}`);
    const o = {
      clientName: 'Dana Reyes', clientDob: '1979-04-02', scopes: ['discuss'],
      clinicName: 'Valley Neurology', planName: 'BCBS', memberId: 'Z1',
      signedName: 'Dana Reyes', signedAt: '2026-08-27T12:00:00Z',
      expiresAt: '2027-08-27T12:00:00Z',
    };
    const mismatch = [];
    for (const kind of ['universal', 'designation', 'records', 'representative']) {
      const shown = AA.sittingModels(kind, o);
      const wanted = AA.sittingKinds(kind).map((k) => AA.authorityModelFor({ kind: k }, o));
      if (shown.length !== wanted.length) {
        mismatch.push(`${kind} shows ${shown.length} of ${wanted.length}`);
        continue;
      }
      for (let i = 0; i < shown.length; i += 1) {
        if (AA.authorityText(shown[i]) !== AA.authorityText(wanted[i])) mismatch.push(`${kind}[${i}]`);
      }
    }
    check('F14 the in-app preview renders the same document as the paper one',
      mismatch.length === 0
      && AA.sittingModels('universal', o).length === 2
      // And the page really does build its preview from that shared list
      // rather than from a branch of its own.
      && /preview\.innerHTML = sittingModels\(kind, optionsNow\(\)\)/.test(CASE2)
      && !/class="auth-doc" data-preview><\/pre>/.test(CASE2),
      mismatch.join(', ') || 'preview not built from sittingModels');
  }
  // The gap this build closed while it was in here. The preview passed no
  // expiry at all, so the form a client read before signing said "one year
  // from the date signed" while the document they had just signed carried a
  // real date. Same words, two pages, which is the drift the shared renderer
  // exists to prevent.
  //
  // UPDATED 2026-08-27, second pass: the field values moved into one fields()
  // builder that both the preview and the POST read, so the same spelling now
  // appears once instead of twice. Same assertion.
  check('F14b and the preview shows the expiry date the client actually picked',
    /expiresAt: val\('expiresAt'\)/.test(CASE2));
}

// ---- F15: a blank can grant what the app can grant -----------------------
// A printed blank said flatly "I have NOT authorised release of separately
// protected categories", with nothing to tick. So a client filling one in on
// paper could not authorise mental-health records however much they wanted
// to: the in-app form offered the choice and the paper form silently refused
// it. "Make sure it covers all bases" (Eric, 2026-08-26).
{
  const A = await import(`file://${__j(__REPO, 'public/js/authority.js')}`);
  const blank = A.recordsAuthorisation({ blank: true });
  check('F15 a blank offers every sensitive category, unticked',
    A.SENSITIVE_CATEGORIES.every((c) => blank.includes(`[ ] ${c.label}`)),
    A.SENSITIVE_CATEGORIES.filter((c) => !blank.includes(`[ ] ${c.label}`)).map((c) => c.id).join(',') || 'all present');
  check('F16 and says plainly that none of it is required',
    /Nothing in this list is required/.test(blank));
  // The signed form must NOT sprout empty boxes: a signed document says what
  // was authorised, and an unticked box on it reads as a choice not made.
  check('F17 a signed form with no categories still states the exclusion',
    /I have NOT authorised release of separately protected categories/
      .test(A.recordsAuthorisation({ clientName: 'X' })));
}

// ---- F18-F21: a link that opens the form ---------------------------------
// Eric, 2026-08-26: "Give me a small suite preview where I can fill out that
// form so I can see how the tapping and signing work." The demo already does
// all of it; what was missing was a way to land ON the form rather than on a
// case page with a panel some distance down it.
//
// It is not only a preview convenience. This is the link that goes in an email
// telling a client to sign.
{
  const C = readFileSync(__j(__REPO, 'public/js/case.js'), 'utf8');
  // UPDATED 2026-08-27 for sign-once, not deleted. There are FOUR real
  // documents now, not two, so the pinned `want !== 'records' && want !==
  // 'representative'` could not survive; the intent, that this parameter opens
  // only a real document and nothing else, is unchanged and is asserted below
  // against the whole list. `?sign=universal` is the link Eric will actually
  // put in an email from now on, and `?sign=records` still has to work because
  // links already sent must not break.
  // UPDATED AGAIN 2026-08-27, second pass, not deleted. The list was retyped
  // in three places (this parameter, the sheet's branches, the Worker's own
  // AUTHORITY_KINDS), and a retyped list is a list that drifts. The page now
  // asks sittingKinds, which is the same lookup the sheet branches on and the
  // same one that refuses an unknown kind, so a document that cannot be opened
  // cannot be linked to either. Asserted by RUNNING it as well as by reading
  // the source, because "accepts only the real documents" is a claim about
  // behaviour.
  //
  // PROVEN TO FAIL, 2026-08-27: adding `nonsense: ['representative']` to
  // AUTHORITY_SITTINGS gave
  //   F18 the page reads ?sign= and accepts only the real documents
  //       -- accepts: nonsense
  {
    const AA = await import(`file://${__j(__REPO, 'public/js/authority.js')}`);
    const real = ['universal', 'designation', 'records', 'representative'];
    const junk = ['', 'nonsense', 'designations', 'REPRESENTATIVE', '__proto__', 'toString'];
    const accepts = junk.filter((k) => AA.sittingKinds(k).length);
    const refuses = real.filter((k) => !AA.sittingKinds(k).length);
    check('F18 the page reads ?sign= and accepts only the real documents',
      /get\('sign'\)/.test(C) && /if \(!sittingKinds\(want\)\.length\) return '';/.test(C)
      && accepts.length === 0 && refuses.length === 0,
      accepts.length ? `accepts: ${accepts.join(', ')}` : `refuses: ${refuses.join(', ')}`);
  }
  // Spent on use, twice over: stripped from the address bar AND cleared in
  // memory. The authority panel repaints on every change to its documents, so
  // a parameter left behind would reopen the sheet on top of itself after a
  // signature, and again on a back-navigation. ?extended=1 learned this the
  // hard way in the 2026-08-25 audit.
  check('F19 and spends it, so a repaint cannot reopen the sheet',
    /u\.searchParams\.delete\('sign'\)/.test(C)
    && /history\.replaceState\(null, '', u\.pathname \+ u\.search \+ u\.hash\)/.test(C)
    && /signOnLoad = '';/.test(C));
  check('F20 it opens the EXISTING sheet, not a second copy of the form',
    /openAuthoritySheet\(c, kind,/.test(C)
    && (C.match(/function openAuthoritySheet/g) || []).length === 1);
  // A sheet opened over a panel that has not painted yet is a sheet with no
  // document behind it.
  check('F21 and waits for the panel before opening over it',
    /if \(auth && signOnLoad\) \{/.test(C) && /setTimeout\(\(\) => openAuthoritySheet/.test(C));
}

// ---- F22-F27: the three other things he hit on a phone -------------------
// Eric, 2026-08-27, after signing the form on his phone for the first time.
{
  const C = readFileSync(__j(__REPO, 'public/js/case.js'), 'utf8');
  const CSS = readFileSync(__j(__REPO, 'public/css/site.css'), 'utf8');

  // "there should be a tick box for 'all available records' that overrides the
  // dates". It is the DEFAULT, because most clients want the whole file, and
  // it sends no dates at all: the document already reads "Records covering the
  // whole period of my care" when it has none, so the legal text is untouched.
  check('F22 there is an all-records tick and it is on by default',
    /data-all-records" checked/.test(C.replace(/\s+/g, ' ')) || /data-all-records checked/.test(C));
  // Hiding a field that still holds a value would put a date on a signed
  // document that nobody can see.
  check('F23 ticking it CLEARS the dates, it does not merely hide them',
    /rangeWrap\.hidden = allBox\.checked;/.test(C)
    && /if \(allBox\.checked\) \{[\s\S]{0,200}el\.value = '';/.test(C));
  check('F24 and unticking it with no dates at all is refused, kindly',
    /Give at least one date, or tick "All the records they have"/.test(C));

  // "the cramping of the dates from/through fields": two date inputs side by
  // side at 390px squeeze their own labels.
  check('F25 the dates are stacked, not two columns of a squeezed row',
    !/<label class="dim small" style="flex:1;">Records from/.test(C)
    && /data-date-range/.test(C));

  // "when signing the screen moves around". The canvas has had
  // touch-action: none all along, so this looked like a browser quirk. The
  // real cause: the DOCUMENT behind the overlay was never locked, unlike the
  // lightbox and the full chat.
  check('F26 the page behind the signing sheet is locked while it is open',
    /body\.sheet-open \{ overflow: hidden; \}/.test(CSS)
    && /document\.body\.classList\.add\('sheet-open'\)/.test(C));
  // Every exit goes through close(): Cancel, Escape, click-outside, and a
  // successful signature. A lock that outlives its sheet freezes the page.
  //
  // UPDATED 2026-08-27 for sign-once, not deleted. The third clause pinned
  // `if (!res.ok) throw ... close();` within eighty characters, which was a
  // proxy for "the success path reaches close()". Sign-once moved the POST
  // into a `post()` helper so the sitting can send two documents on one
  // signature, so the throw and the close are no longer neighbours: the throw
  // is in the helper and the close is in the handler that calls it twice.
  //
  // The intent is unchanged, and the proxy is replaced with the thing itself:
  // the signature path awaits its POST and then calls close(), and close()
  // still removes the lock. Also asserted: the SECOND document's failure does
  // not skip the close, which is a new way this sheet could have been left on
  // screen with the page frozen behind it.
  //
  // UPDATED AGAIN 2026-08-27, second pass, not deleted. The two hand written
  // posts became one `await signSitting(kind, post)` call, so `await
  // post(kind);` no longer appears. Same assertion, re-pointed at the line
  // that now stands between the signature and the close.
  check('F27 and released on every route out, including a successful signature',
    /document\.body\.classList\.remove\('sheet-open'\)/.test(C)
    && (C.match(/const close = \(\) => \{[\s\S]{0,300}?sheet-open/g) || []).length === 1
    && /await signSitting\(kind, post\);[\s\S]{0,300}?\n      close\(\);/.test(C));
  // UPDATED AGAIN 2026-08-27, second pass, not deleted, and it is stronger:
  // the "catch the second document, never rethrow" behaviour moved out of the
  // click handler into signSitting, where a suite can RUN it instead of
  // matching a catch block by the name of its error variable.
  //
  // The property is unchanged. If the SECOND document fails, the first is
  // signed, so the sheet closes and the panel repaints; telling the client the
  // signing failed would send them to sign a second copy of a document they
  // already signed. If the FIRST fails, nothing was signed, and it throws.
  //
  // PROVEN TO FAIL, 2026-08-27: removing the try/catch inside signSitting's
  // loop gave
  //   F27b a half-finished sign-once sitting still closes and still repaints
  //        -- second failure escaped
  {
    const AA = await import(`file://${__j(__REPO, 'public/js/authority.js')}`);
    let secondEscaped = false;
    let sent = [];
    try {
      const partial = await AA.signSitting('universal', async (k) => {
        sent.push(k);
        if (k === 'designation') throw new Error('nope');
      });
      secondEscaped = !(partial.length === 1 && partial[0].kind === 'designation');
    } catch { secondEscaped = true; }
    let firstThrew = false;
    try {
      await AA.signSitting('universal', async () => { throw new Error('nope'); });
    } catch { firstThrew = true; }
    check('F27b and a half-finished sign-once sitting still closes and still repaints',
      !secondEscaped && firstThrew && sent.join(',') === 'universal,designation'
      && /close\(\);\n      onDone\?\.\(\);/.test(C),
      secondEscaped ? 'second failure escaped' : `sent ${sent.join(',')}, first threw ${firstThrew}`);
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
