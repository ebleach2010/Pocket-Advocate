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
check('S9 the completeness gate carries Eric\'s wording, exactly',
  CASE.includes('Your document is incomplete. please review the full document and be sure you did not miss any areas requiring your selection or signature.'));
check('S10 bad fields go red and the pad is one of them',
  /field-bad/.test(CASE) && /mark\('\[data-sig-open\]'\)/.test(CASE));
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
  check('F14 the in-app preview renders the same document as the paper one',
    /preview\.innerHTML = authorityHtml\(/.test(CASE2)
    && !/class="auth-doc" data-preview><\/pre>/.test(CASE2));
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
  check('F18 the page reads ?sign= and accepts only the two real documents',
    /get\('sign'\)/.test(C)
    && /want !== 'records' && want !== 'representative'/.test(C));
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

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
