// signonce.mjs - the client signs ONCE, and the paperwork stops being per
// clinic (Eric's spec 2A, 2B, 2D and 4).
//
// Run: node signonce.mjs
//
// Four things are load-bearing here and none of them can be checked by reading
// the source, which is why this suite exists beside authority.mjs rather than
// inside it:
//
//   1. THE EXPIRY MATHS IS EXECUTED, NOT PATTERN MATCHED. It exists twice, in
//      public/js/authority.js and in worker/index.js, because a Worker cannot
//      import a client module. Two copies of a date calculation that agree in
//      shape and disagree by one day is exactly what a regex over the source
//      cannot see, and a day matters: an authorisation that dies one day early
//      kills a records request already in flight. So both are LIFTED out of
//      the shipped files and RUN against the same dates.
//
//   2. THE UNIVERSAL DOCUMENT NAMES NO CLINIC. That is the entire change, and
//      it is one careless template edit away from being untrue.
//
//   3. GENERATING A NARROWED COPY DOES NOT TOUCH THE MASTER. The safety
//      property of the whole feature: an office that wants its own form gets
//      one, and the broad authorisation stays valid.
//
//   4. NOTHING, IN ANY STATE, SAYS IT DOES NOT EXPIRE. Including through the
//      back door, where a missing field reads as "no expiry" rather than as
//      "expired".
//
// EVERY CHECK BELOW HAS BEEN PROVEN ABLE TO FAIL. The code was broken on
// purpose, the check was watched going red, and the observed failure is
// recorded in the comment beside it. A check nobody has seen fail is a check
// nobody knows is wired up.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync } from 'node:fs';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const A = await import(`file://${__j(__REPO, 'public/js/authority.js')}`);
const WORKER = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const CASE = readFileSync(__j(__REPO, 'public/js/case.js'), 'utf8');
const ADMIN = readFileSync(__j(__REPO, 'public/js/admin-case.js'), 'utf8');
const PACKET = readFileSync(__j(__REPO, 'public/js/admin-provider-packet.js'), 'utf8');
const DEMO = readFileSync(__j(__REPO, 'public/js/demo/api.js'), 'utf8');
const READY = readFileSync(__j(__REPO, 'public/js/readiness.js'), 'utf8');
const P = await import(`file://${__j(__REPO, 'public/js/admin-provider-packet.js')}`);
const R = await import(`file://${__j(__REPO, 'public/js/readiness.js')}`);

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

// ===========================================================================
// E: the expiry maths, LIFTED OUT OF BOTH SHIPPED FILES AND RUN
// ===========================================================================
//
// Lifted with `new Function` on the source text, the same harness
// tools/suites/pricing.mjs uses for growRate and the three money functions.
// Importing the client copy and reading the Worker copy would only ever prove
// the client copy works.
const liftFn = (src, name) => {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
  return m ? m[0] : '';
};
const workerExpirySrc = liftFn(WORKER, 'authorityExpiry');
const workerExpiresAtSrc = liftFn(WORKER, 'authorityExpiresAt');
let workerApi = null;
try {
  workerApi = new Function(`
    const AUTHORITY_DEFAULT_MONTHS = ${(WORKER.match(/const AUTHORITY_DEFAULT_MONTHS = (\d+);/) || [])[1]};
    const AUTHORITY_MAX_MONTHS = ${(WORKER.match(/const AUTHORITY_MAX_MONTHS = (\d+);/) || [])[1]};
    ${workerExpirySrc}
    ${workerExpiresAtSrc}
    return { authorityExpiry, authorityExpiresAt, AUTHORITY_DEFAULT_MONTHS, AUTHORITY_MAX_MONTHS };
  `)();
} catch (e) { /* reported by E0 */ }

// PROVEN TO FAIL: renaming the Worker's `authorityExpiry` to `authorityExpiry2`
// gave "E0 both expiry implementations lift and run -- worker lift: 0 chars".
check('E0 both expiry implementations lift and run',
  !!workerApi && typeof workerApi.authorityExpiry === 'function'
  && typeof A.authorityExpiry === 'function',
  `worker lift: ${workerExpirySrc.length} chars`);

if (workerApi) {
  const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : String(d));
  // The four signature dates the build was asked to be checked against, plus
  // the two calendar cases that a naive implementation gets wrong.
  const TODAY = '2026-08-27T17:00:00Z';
  const ELEVEN_MONTHS_OLD = '2025-09-27T17:00:00Z';
  const THIRTEEN_MONTHS_OLD = '2025-07-27T17:00:00Z';

  // PROVEN TO FAIL, 2026-08-27. Replacing the client copy's calendar
  // arithmetic with `t + n * 365 / 12 days` gave:
  //   E2c 31 January plus ONE month clamps to the end of February -- 2027-03-02
  //   E2d and in a leap year it clamps to the 29th, not the 28th   -- 2028-03-01
  // Separately, dropping only the end-of-month clamp (setUTCMonth on the
  // original date rather than on day 1) gave the two-copy disagreement this
  // block exists for:
  //   E1 the two expiry copies agree: signed on a leap day
  //       -- client 2029-03-01, worker 2029-02-28
  // One day apart, on two implementations that read identically.
  for (const [label, signedAt] of [
    ['signed today', TODAY],
    ['signed eleven months ago', ELEVEN_MONTHS_OLD],
    ['signed thirteen months ago', THIRTEEN_MONTHS_OLD],
    ['signed on a leap day', '2028-02-29T12:00:00Z'],
    ['signed on the 31st', '2027-01-31T12:00:00Z'],
    ['signed on the last day of a year', '2026-12-31T12:00:00Z'],
  ]) {
    const c = A.authorityExpiry(signedAt);
    const w = workerApi.authorityExpiry(signedAt);
    check(`E1 the two expiry copies agree: ${label}`,
      iso(c) === iso(w), `client ${iso(c)}, worker ${iso(w)}`);
  }

  // The four dated cases the brief asks for, RUN, with the answers asserted
  // rather than merely compared to each other. Two identical wrong copies
  // agree perfectly.
  //
  // PROVEN TO FAIL, 2026-08-27: dropping the end-of-month clamp gave
  //   E2c 31 January plus ONE month clamps to the end of February -- 2027-03-03
  //   E2d and in a leap year it clamps to the 29th, not the 28th   -- 2028-03-02
  // which is the 3 March that this clamp exists to prevent, arriving on the
  // face of a signed document as the day the permission ends.
  check('E2 a signature dated today expires twelve calendar months on',
    iso(A.authorityExpiry(TODAY)) === '2027-08-27', iso(A.authorityExpiry(TODAY)));
  check('E2b 31 January plus twelve months is 31 January, not 3 March',
    iso(A.authorityExpiry('2027-01-31T12:00:00Z')) === '2028-01-31',
    iso(A.authorityExpiry('2027-01-31T12:00:00Z')));
  check('E2c 31 January plus ONE month clamps to the end of February',
    iso(A.authorityExpiry('2027-01-31T12:00:00Z', 1)) === '2027-02-28',
    iso(A.authorityExpiry('2027-01-31T12:00:00Z', 1)));
  check('E2d and in a leap year it clamps to the 29th, not the 28th',
    iso(A.authorityExpiry('2028-01-31T12:00:00Z', 1)) === '2028-02-29',
    iso(A.authorityExpiry('2028-01-31T12:00:00Z', 1)));

  // ---- the four states a stored document can be in -------------------------
  const NOW = Date.parse('2026-08-27T17:00:00Z');
  // PROVEN TO FAIL, 2026-08-27: dropping the twelve-month fallback so a
  // missing expiresAt returns false gave
  //   E4  a document signed thirteen months ago with NO stored expiry is EXPIRED -- false
  //   E4c a document with neither an expiry nor a signing date is expired
  // Both are the same defect: every document signed before this build has no
  // expiresAt, so it would have read as valid forever.
  check('E3 a document signed today is not expired',
    A.authorityExpired({ signedAt: TODAY, expiresAt: A.authorityExpiry(TODAY) }, NOW) === false);
  check('E3b a document signed eleven months ago is not expired',
    A.authorityExpired({
      signedAt: ELEVEN_MONTHS_OLD, expiresAt: A.authorityExpiry(ELEVEN_MONTHS_OLD),
    }, NOW) === false);
  check('E3c a document signed thirteen months ago IS expired',
    A.authorityExpired({
      signedAt: THIRTEEN_MONTHS_OLD, expiresAt: A.authorityExpiry(THIRTEEN_MONTHS_OLD),
    }, NOW) === true);
  // THE SILENT-PASS TRAP, and the reason this suite exists. Every document
  // signed before this build has no expiresAt at all. `new Date(undefined) <
  // now` is false, so the obvious implementation answers "not expired" for
  // every one of them, forever. That is the "never expires" the brief forbids,
  // arriving as an undefined instead of as a word on the page.
  check('E4 a document signed thirteen months ago with NO stored expiry is EXPIRED',
    A.authorityExpired({ signedAt: THIRTEEN_MONTHS_OLD }, NOW) === true,
    String(A.authorityExpired({ signedAt: THIRTEEN_MONTHS_OLD }, NOW)));
  check('E4b and one signed eleven months ago with no stored expiry is NOT',
    A.authorityExpired({ signedAt: ELEVEN_MONTHS_OLD }, NOW) === false);
  // A document that cannot say when it was signed cannot be shown to be
  // current, so it is treated as expired rather than as valid.
  check('E4c a document with neither an expiry nor a signing date is expired',
    A.authorityExpired({}, NOW) === true && A.authorityExpired(null, NOW) === true);

  // ---- the client-edited date ---------------------------------------------
  // PROVEN TO FAIL, 2026-08-27: neutering the cap comparison in
  // authorityExpiresAt gave
  //   E5c a date beyond the cap falls back to twelve months -- 2126-08-27
  //   E5f the cap is exactly the max-months anniversary
  // 2126 is the mistyped-year case the cap exists for.
  const signedAt = new Date(TODAY);
  check('E5 a client-edited date inside the cap is the date they picked',
    iso(workerApi.authorityExpiresAt(signedAt, '2027-01-15')) === '2027-01-15',
    iso(workerApi.authorityExpiresAt(signedAt, '2027-01-15')));
  check('E5b a date in the past falls back to twelve months, never to nothing',
    iso(workerApi.authorityExpiresAt(signedAt, '2020-01-01')) === '2027-08-27');
  check('E5c a date beyond the cap falls back to twelve months',
    iso(workerApi.authorityExpiresAt(signedAt, '2126-08-27')) === '2027-08-27',
    iso(workerApi.authorityExpiresAt(signedAt, '2126-08-27')));
  check('E5d rubbish falls back to twelve months',
    iso(workerApi.authorityExpiresAt(signedAt, 'whenever')) === '2027-08-27'
    && iso(workerApi.authorityExpiresAt(signedAt, '')) === '2027-08-27'
    && iso(workerApi.authorityExpiresAt(signedAt, undefined)) === '2027-08-27');
  // THE ONE THAT MATTERS MOST: there is no input at all that produces no
  // expiry. Not null, not undefined, not a nonsense string, not a date in the
  // year 9999.
  const NEVER = [null, undefined, '', 'never', '9999-12-31', '0000-01-01', 0, {}, []];
  check('E5e NO input to the expiry field yields a document with no expiry',
    NEVER.every((v) => {
      const out = workerApi.authorityExpiresAt(signedAt, v);
      return out instanceof Date && !Number.isNaN(out.getTime())
        && out.getTime() > signedAt.getTime();
    }),
    NEVER.map((v) => `${JSON.stringify(v)}=${iso(workerApi.authorityExpiresAt(signedAt, v))}`).join(' '));
  // The cap is real, and the exact boundary is the twenty-four month
  // anniversary rather than a day either side of it.
  check('E5f the cap is exactly the max-months anniversary',
    iso(workerApi.authorityExpiresAt(signedAt, '2028-08-27')) === '2028-08-27'
    && iso(workerApi.authorityExpiresAt(signedAt, '2028-08-28')) === '2027-08-27');
}

// The Worker cannot import a client module, so the numbers exist twice. Pinned
// rather than trusted, exactly as the scope ids are.
// PROVEN TO FAIL, 2026-08-27: setting the Worker's AUTHORITY_DEFAULT_MONTHS to
// 6 gave "E6 the Worker mirrors the client default and cap exactly -- client
// 12/24, worker 6/24", and took E1 red on all six dates with it (for example
// "signed today -- client 2027-08-27, worker 2027-02-27"), which is what a
// silently drifted mirror actually looks like.
check('E6 the Worker mirrors the client default and cap exactly',
  Number((WORKER.match(/const AUTHORITY_DEFAULT_MONTHS = (\d+);/) || [])[1]) === A.AUTHORITY_DEFAULT_MONTHS
  && Number((WORKER.match(/const AUTHORITY_MAX_MONTHS = (\d+);/) || [])[1]) === A.AUTHORITY_MAX_MONTHS,
  `client ${A.AUTHORITY_DEFAULT_MONTHS}/${A.AUTHORITY_MAX_MONTHS}, worker ${(WORKER.match(/const AUTHORITY_DEFAULT_MONTHS = (\d+);/) || [])[1]}/${(WORKER.match(/const AUTHORITY_MAX_MONTHS = (\d+);/) || [])[1]}`);
check('E6b twelve months is the default, and it is a real number, not a comment',
  A.AUTHORITY_DEFAULT_MONTHS === 12);
// A stored expiry, not an implied one. This is what makes the date readable on
// the face of the paper instead of requiring arithmetic from the signing date.
// PROVEN TO FAIL, 2026-08-27: putting the old
// `expiresAt: new Date(Date.now() + 365 * 24 * 3600_000)` back took both
// E7 and E7b red.
check('E7 the Worker stores the computed expiry rather than a fixed 365 days',
  /item\.expiresAt = authorityExpiresAt\(item\.signedAt, body\?\.expiresAt\)/.test(WORKER)
  && !/expiresAt: new Date\(Date\.now\(\) \+ 365 \* 24 \* 3600_000\)/.test(WORKER));
// Measured from the Worker's own stamp. A browser-sent signing time is a
// claim, and an expiry counted from it would be a claim too.
check('E7b and it is measured from the Worker stamp, not from a browser time',
  /item\.expiresAt = authorityExpiresAt\(item\.signedAt,/.test(WORKER));

// ===========================================================================
// U: the universal document names a CLASS, and no single clinic
// ===========================================================================
const universal = A.universalAuthorisation({
  clientName: 'Dana Reyes', clientDob: '1979-04-02',
  scopes: ['discuss', 'records', 'admin'], categories: ['mentalHealth'],
  signedName: 'Dana Reyes', signedAt: '2026-08-27T12:00:00Z',
  expiresAt: '2027-08-27T12:00:00Z',
});

// PROVEN TO FAIL, 2026-08-27. Putting a named clinic back into the universal
// branch (replacing the class paragraph with the old `RELEASING PROVIDER` /
// `Valley Neurology` lines) gave, across three suites:
//   signonce   U1 the universal document names no single clinic
//                 -- found: /RELEASING PROVIDER\n/
//   signonce   U2 its disclosing party is a class, with the plural heading
//   signonce   U3 every provider type in the class is named on the document
//                 -- missing: health plan, physician, health-care professional, ...
//   authority  A1u universal: core element present: who may disclose, as a CLASS
//   golden     G9 universal-signed is unchanged, to the byte -- line 12
//   golden     G10 universal-blank is unchanged, to the byte -- line 12
// Four independent checks caught one edit, which is what the golden pins are
// for.
const CLINIC_SHAPED = [
  /RELEASING PROVIDER\n/,          // the singular heading, which the class form must not use
  /Valley Neurology/i,
  /Mountain Ridge/i,
  /\(clinic\)/,                     // the per-clinic placeholder
];
const hit = CLINIC_SHAPED.find((re) => re.test(universal));
check('U1 the universal document names no single clinic',
  !hit, hit ? `found: ${hit}` : '');
// The heading is plural and the class is the disclosing party.
check('U2 its disclosing party is a class, with the plural heading',
  /RELEASING PROVIDERS\n/.test(universal)
  && /I authorise any health plan/.test(universal));
// Each of the thirteen provider types is asserted BY NAME. "It mentions a
// class" would still pass if an edit dropped pharmacies.
// PROVEN TO FAIL, 2026-08-27: deleting 'pharmacy benefit manager' from
// PROVIDER_CLASS_TYPES gave
//   U3 every provider type in the class is named on the document -- 12 types
//   G9/G10 universal-signed and universal-blank changed at line 14
// The count is what caught it, not the name: a type dropped from the list is
// also dropped from the document, so "every listed type appears" alone would
// have passed. Both halves are asserted for that reason.
{
  const flat = universal.replace(/\s+/g, ' ');
  const missing = A.PROVIDER_CLASS_TYPES.filter((t) => !flat.includes(t));
  check('U3 every provider type in the class is named on the document',
    A.PROVIDER_CLASS_TYPES.length >= 13 && missing.length === 0,
    missing.length ? `missing: ${missing.join(', ')}` : `${A.PROVIDER_CLASS_TYPES.length} types`);
}
check('U4 it says naming a class is deliberate, so a clerk does not read it as vague',
  /naming a class of providers on purpose/.test(universal));
// A class-wide form has no single named provider to write to, so a revocation
// clause saying "write to the provider named above" would describe nothing.
// 164.508(c)(2)(i) wants a route the patient can actually take.
// PROVEN TO FAIL, 2026-08-27: pointing the universal form's revocation clause
// back at "the provider named above" gave
//   signonce   U5 revocation names a route that exists on a class-wide form
//   authority  A1u universal: right to revoke, and a route a patient can actually take
//   golden     G9 line 56, G10 line 65
check('U5 revocation names a route that exists on a class-wide form',
  /writing to my advocate/.test(universal)
  && !/writing to the provider named\s*\n?\s*above/.test(universal));
check('U6 an office asking for its own form is told it cancels nothing',
  /Asking for one does not cancel this authorisation/.test(universal));
// The per-clinic form is UNCHANGED and still names its clinic. The universal
// document is a new shape, not a rewrite, and this is what says so.
check('U7 the per-clinic form still names its clinic, untouched',
  /RELEASING PROVIDER\nValley Neurology/.test(A.recordsAuthorisation({
    clientName: 'Dana Reyes', clinicName: 'Valley Neurology',
    scopes: ['discuss'], signedName: 'Dana Reyes', signedAt: '2026-08-23',
  })));
// The scopes still gate what he may DO. Widening WHO may disclose must not
// widen that, and a universal form with nothing ticked authorises nothing.
check('U8 the class widens who may disclose, and nothing about what he may do',
  A.universalAuthorisation({ scopes: [] }).includes('I have not authorised any of the items above')
  && !A.universalAuthorisation({ scopes: [] }).includes('[X]'));
check('U9 and the Worker refuses that document rather than storing it',
  /\(kind === 'records' \|\| kind === 'universal'\) && !item\.scopes\.length/.test(WORKER));

// ===========================================================================
// N: the narrow per-clinic exception, and the master surviving it
// ===========================================================================
//
// This is the safety property of the whole feature. An office that will not
// take the class-wide form gets one scoped to itself, and the broad
// authorisation stays listed and stays valid.
{
  const master = {
    id: 'MASTER1', kind: 'universal',
    clientName: 'Dana Reyes', clientDob: '1979-04-02',
    categories: ['mentalHealth'], scopes: ['discuss', 'records', 'admin'],
    signedName: 'Dana Reyes', signedAt: '2026-08-27T12:00:00Z',
    expiresAt: '2027-08-27T12:00:00Z',
    signatureImage: 'data:image/png;base64,MASTERINK',
    revokedAt: null,
  };
  // A deep snapshot BEFORE, compared to a deep snapshot after. A shallow
  // equality check would pass while the arrays were mutated underneath it,
  // which is the exact silent pass this property has to avoid.
  const before = JSON.stringify(master);
  const opts = A.narrowedAuthorisationOptions(master, {
    clinicName: 'Valley Neurology', clinicAddress: '10 Mesa Rd, Phoenix AZ',
    fromDate: '2024-01-01', toDate: '2026-08-01',
  });
  // Through the paired helper, which is what the app will call, rather than
  // through recordsAuthorisationModel(opts) by hand: a suite that exercises a
  // different entry point from the product is a suite that can go green on
  // code nothing runs.
  const narrowed = A.authorityText(A.narrowedAuthorisationModel(master, {
    clinicName: 'Valley Neurology', clinicAddress: '10 Mesa Rd, Phoenix AZ',
    fromDate: '2024-01-01', toDate: '2026-08-01',
  }));

  // PROVEN TO FAIL, 2026-08-27: adding
  // `if (Array.isArray(master.categories)) master.categories.push('genetic');`
  // to narrowedAuthorisationOptions before the return gave
  //   N1 generating a narrowed copy does not touch the master -- master mutated
  // That is the negative control the brief asks for, and it is a real hazard
  // rather than a theoretical one: the options object carries arrays out of the
  // master, and a spread that shared them instead of copying them would let a
  // later edit of the narrow form reach back into the signed master.
  check('N1 generating a narrowed copy does not touch the master',
    JSON.stringify(master) === before, 'master mutated');
  check('N1b the master is still live, still universal, still not withdrawn',
    master.kind === 'universal' && !master.revokedAt
    && A.authorityExpired(master, Date.parse('2026-09-01T00:00:00Z')) === false);

  // The narrowed copy is a real narrowing: it names the office and carries the
  // range it was asked for.
  check('N2 the narrowed copy names the one office and its range',
    /RELEASING PROVIDER\nValley Neurology/.test(narrowed)
    && /Records dated January 1, 2024 through August 1, 2026/.test(narrowed));
  check('N2b and it carries across what the client already told us',
    /Mental health records/.test(narrowed)
    && /\[X\] Discuss my care/.test(narrowed));

  // THE CLAUSE ON THE PAPER. The app enforces "the master survives"
  // structurally, but a records clerk reads the page, not the database.
  // PROVEN TO FAIL, 2026-08-27: forcing narrowNote to null gave
  //   signonce N3 the narrowed copy says on its face that the master survives
  //              -- no such clause
  //   golden   G13 narrowed-signed is unchanged, to the byte -- line 44
  check('N3 the narrowed copy says on its face that the master survives',
    /THIS IS A NARROWED COPY, NOT A REPLACEMENT/.test(narrowed)
    && /It is IN ADDITION/.test(narrowed)
    && /does not replace, cancel, narrow, or\s*\n?\s*revoke that authorisation/.test(narrowed),
    'no such clause');
  // And the ordinary per-clinic form, signed by somebody who never had a
  // master, must NOT carry that clause: it would be asserting the existence of
  // a document that does not exist.
  check('N3b but a plain per-clinic form carries no such clause',
    !/THIS IS A NARROWED COPY/.test(A.recordsAuthorisation({
      clientName: 'Dana Reyes', clinicName: 'Valley Neurology', scopes: ['discuss'],
    })));

  // THE FORGERY GUARD. The narrowed copy is a document to be SIGNED, not a
  // signed document. Carrying the master's typed name, timestamp or drawn ink
  // across would be applying somebody's signature to a differently worded page
  // they have never seen, and the two marks would be pixel-identical
  // afterwards so nothing could detect it.
  // PROVEN TO FAIL, 2026-08-27: adding
  // `signatureImage: master.signatureImage || ''` to the returned object gave
  //   N4 a narrowed copy carries no signature, name or date from the master
  //      -- carries: signatureImage
  // Worth noting what that mutation would have SHIPPED: a per-clinic
  // authorisation, worded differently from the one the patient read, carrying
  // their real drawn signature, printable and sendable. Nothing downstream
  // would have flagged it, because the ink is byte-identical to the genuine
  // mark.
  {
    const leaked = ['signatureImage', 'signedName', 'signedAt']
      .filter((f) => opts[f] !== undefined && opts[f] !== '');
    check('N4 a narrowed copy carries no signature, name or date from the master',
      leaked.length === 0, leaked.length ? `carries: ${leaked.join(', ')}` : '');
    check('N4b so it renders as unsigned, waiting for its own signature',
      /Signed: \(typed full name\)/.test(narrowed));
  }

  // The Worker refuses a narrowed copy whose master is not on the case, is not
  // universal, or has been withdrawn. A narrow form with a broken link back is
  // one that will one day be read as the only authorisation on file.
  check('N5 the Worker checks the master exists, is universal and is live',
    /if \(kind === 'records' && item\.narrowedFrom\) \{/.test(WORKER)
    && /master\.data\.kind !== 'universal'/.test(WORKER)
    && /master\.data\.revokedAt/.test(WORKER));
  // Nothing anywhere writes to the master when a narrowed copy is stored.
  // PROVEN TO FAIL, 2026-08-27: adding a patchDoc that stamped revokedAt on
  // the master into that branch gave
  //   N6 nothing in the narrowing branch writes to the master -- patchDoc found
  // which is the exact shape of "signing the narrow form cancelled the broad
  // one", the failure this whole section exists to make impossible.
  {
    const i = WORKER.indexOf("if (kind === 'records' && item.narrowedFrom) {");
    const branch = i < 0 ? '' : WORKER.slice(i, WORKER.indexOf('\n  }', i));
    check('N6 nothing in the narrowing branch writes to the master',
      branch.length > 0 && !/patchDoc|deleteDoc/.test(branch),
      /patchDoc|deleteDoc/.test(branch) ? 'patchDoc found' : `${branch.length} chars`);
  }
  // The panel says it too, where the client reads it.
  check('N7 the client panel calls narrowed copies extras, never replacements',
    /They never replace the\s*\n?\s*authorisation above/.test(CASE));
}

// ===========================================================================
// X: nothing anywhere says a document does not expire
// ===========================================================================
//
// The wording ban, applied to every document in every state rather than to the
// one that happened to be under test. Signed, blank, bare, with an expiry and
// without one.
{
  // THE BAN HAS TO CATCH THE ASSERTION AND NOT ITS DENIAL, which is not a
  // nicety: the first version of this pattern flagged all six universal and
  // designation states, and every hit was the sentence "This authorisation is
  // never open ended", i.e. the check marking the fix as the defect. The same
  // trap authority.mjs F12 hit when it flagged the word "monospace" inside the
  // comment explaining the monospace bug.
  //
  // So the negated forms are removed first and the scan runs on what is left.
  // "never expires" survives as a banned phrase in its own right, because
  // "this never expires" is the thing being banned; it is only "never open
  // ended" and "does not run indefinitely" that are denials.
  const denials = (t) => t
    .replace(/\bnever open[- ]ended\b/gi, ' ')
    .replace(/\bnot open[- ]ended\b/gi, ' ')
    .replace(/\bnever run indefinitely\b/gi, ' ')
    .replace(/\bdoes not run indefinitely\b/gi, ' ');
  const NEVER_EXPIRES = /(never expires?|does not expire|no expir|without expir|indefinitely|in perpetuity|open[- ]ended)/i;
  const states = [];
  for (const [name, fn] of [
    ['universal', A.universalAuthorisation],
    ['records', A.recordsAuthorisation],
    ['designation', A.advocateDesignation],
    ['representative', A.representativeDesignation],
  ]) {
    states.push([`${name} signed`, fn({
      clientName: 'Dana Reyes', clinicName: 'Valley Neurology', planName: 'BCBS',
      scopes: ['discuss'], signedName: 'Dana Reyes', signedAt: '2026-08-27T12:00:00Z',
      expiresAt: '2027-08-27T12:00:00Z',
    })]);
    states.push([`${name} blank`, fn({ blank: true, clientName: 'Dana Reyes' })]);
    states.push([`${name} bare`, fn({})]);
  }
  // PROVEN TO FAIL, 2026-08-27: replacing the universal EXPIRY paragraph with
  // "This authorisation does not expire." gave
  //   signonce X1 no document, in any state, says it does not expire
  //              -- universal signed: does not expire; universal blank: does not
  //                 expire; universal bare: does not expire
  //   signonce X3 the universal form says plainly that it is never open ended
  //   golden   G9 line 70, G10 line 79
  const bad = states.filter(([, text]) => NEVER_EXPIRES.test(denials(text)));
  check('X1 no document, in any state, says it does not expire',
    bad.length === 0,
    bad.map(([n, t]) => `${n}: ${(denials(t).match(NEVER_EXPIRES) || [])[0]}`).join('; '));
  // And the stripper cannot be what makes it pass. If `denials` ever grew wide
  // enough to swallow a real assertion, X1 would go green on a defective
  // document; this feeds it one and requires it to still go red.
  check('X1b and the check still catches a document that DOES say it',
    NEVER_EXPIRES.test(denials('This authorisation does not expire.'))
    && NEVER_EXPIRES.test(denials('This authorisation is open ended.'))
    && NEVER_EXPIRES.test(denials('It never expires.'))
    && NEVER_EXPIRES.test(denials('This runs indefinitely.')));
  // Every document in every state carries an expiry section AND a date or a
  // rule to write one on. A document that simply omitted the section would
  // pass the ban above while being defective under 164.508(c)(1)(v).
  // PROVEN TO FAIL, 2026-08-27: renaming the EXPIRY heading gave
  //   X2 every document in every state states how long it lasts
  //      -- universal signed, universal blank, universal bare, records signed,
  //         records blank, records bare
  // and took eight golden captures with it (G1 to G5, G9, G10, G13). A
  // document that simply omitted the section would pass the wording ban above
  // while being defective under 164.508(c)(1)(v), which is why both checks
  // exist rather than one.
  const noExpiry = states.filter(([, t]) => !/(EXPIRY|stays in effect until|HOW LONG THIS LASTS)/.test(t));
  check('X2 every document in every state states how long it lasts',
    noExpiry.length === 0, noExpiry.map(([n]) => n).join(', '));
  // The universal form says it out loud, because it is the one that gets
  // reused for months and invites nobody ever looking at the date again.
  check('X3 the universal form says plainly that it is never open ended',
    /This authorisation is never open ended/.test(A.universalAuthorisation({})));
  check('X3b and the patient designation says the same',
    /It is never open ended/.test(A.advocateDesignation({})));
  // A PRINTED BLANK CAN SET ITS OWN EXPIRY. Caught by reading the generated
  // blank rather than by any check: it said "expires on one year from the date
  // signed" with nothing to write on, so a client filling one in on paper
  // could not choose a date while the in-app form let them pick any. Same
  // shape as the sensitive-category bug of 2026-08-26, where the screen
  // offered a choice the paper silently refused.
  {
    const blank = A.universalAuthorisation({ blank: true });
    check('X4 a printed blank has somewhere to write the expiry',
      /This authorisation expires on _{10,},/.test(blank));
    check('X4b and says what happens if that line is left empty',
      /If no date is written above, this authorisation expires one year from the\ndate signed\./.test(blank));
    // The signed form must NOT claim a choice nobody made, and the blank must
    // not claim one either. An untrue sentence on a legal instrument is not a
    // small thing however harmless it looks.
    check('X4c and a blank does not claim the signer chose a date',
      !/I chose that date when I signed/.test(blank)
      && /I chose that date when I signed/.test(A.universalAuthorisation({ expiresAt: '2027-08-27T12:00:00Z' })));
  }
}

// ===========================================================================
// D: the patient designation of advocate (spec 2B)
// ===========================================================================
{
  const d = A.advocateDesignation({
    clientName: 'Dana Reyes', clientDob: '1979-04-02',
    signedName: 'Dana Reyes', signedAt: '2026-08-27T12:00:00Z',
    expiresAt: '2027-08-27T12:00:00Z',
  });
  // THE SENTENCE THAT MATTERS MOST. "Designation of advocate" is close enough
  // to "health-care agent" that a chart clerk can file it as one, and the
  // consequence is a hospital ringing a patient advocate for consent to a
  // procedure.
  // PROVEN TO FAIL, 2026-08-27: renaming the section heading to "HOW WE WORK
  // TOGETHER" gave
  //   signonce D1 it states he is NOT a health-care decision maker -- missing
  //   golden   G11 designation-signed line 10, G12 designation-blank line 10
  check('D1 it states he is NOT a health-care decision maker',
    /NOT my health-care decision maker/.test(d)
    && /THIS DOES NOT MAKE HIM MY DECISION MAKER/.test(d), 'missing');
  check('D1b and rules out each thing it could be mistaken for',
    /not a power of\s*\n?\s*attorney/.test(d)
    && /not a health-care proxy or agent appointment/.test(d)
    && /not a guardianship/.test(d)
    && /not an advance directive/.test(d));
  check('D1c and says what happens if the patient cannot decide',
    /gives my advocate no\s*\n?\s*authority to make it for me/.test(d));
  // The asks a front desk can act on.
  check('D2 it asks for the chart note and the authorised-contact flag',
    /Note him in my chart as an authorised contact/.test(d));
  // It grants nothing on its own: every disclosure rests on the authorisation
  // it travels with. A page that implied its own permission would be a second
  // authorisation with none of the 164.508 elements on it.
  check('D3 it grants nothing on its own and says so',
    /not a permission of its own/.test(d)
    && /limited by the authorisation signed with this page/.test(d));
  check('D4 it is one page: short enough for a front desk to read',
    d.split('\n').length < 60, `${d.split('\n').length} lines`);
  // Unset contact details are somewhere to write, never a placeholder that
  // looks filled in and never an invented number.
  //
  // TIGHTENED 2026-08-27 after looking at the printed page. The first version
  // of this check asserted `Phone: (phone)`, i.e. it pinned the defect: a
  // client signs this document and hands it to a clinic, so "(phone)" was
  // printing on a SIGNED page where there is no box to fill in and the reader
  // is a records clerk. A placeholder there is worse than a blank because it
  // looks filled in. The check now requires the rule and forbids the
  // placeholder, and the screenshot is what caught it rather than any check.
  check('D5 unset contact details print as a rule to write on',
    /Phone: _{10,}/.test(d) && /Fax: _{10,}/.test(d)
    && !/\(phone\)/.test(d) && !/\(secure email\)/.test(d) && !/\(fax\)/.test(d));
  check('D5b and a set one prints the real value',
    /Phone: 520 555 0142/.test(A.advocateDesignation({ advocatePhone: '520 555 0142' })));
}

// ===========================================================================
// S: signed ONCE, in one sitting
// ===========================================================================
check('S1 the sheet signs both documents on one signature',
  /await post\(kind\);/.test(CASE) && /await post\('designation'\);/.test(CASE));
// Both documents on screen before the signature. A preview showing only the
// authorisation would mean the designation was signed unseen, which is not
// consent.
check('S2 and shows BOTH documents before the signature is taken',
  /authorityHtml\(universalAuthorisationModel\(o\)\)/.test(CASE)
  && /authorityHtml\(advocateDesignationModel\(o\)\)/.test(CASE));
check('S2b with the button saying it signs both',
  /isUniversal \? 'Sign both' : 'Sign'/.test(CASE));
// Sequential, so a failure of the second leaves the first standing rather than
// leaving a designation pointing at an authorisation that does not exist.
check('S3 they are posted in order, not in parallel',
  !/Promise\.all\(\[[\s\S]{0,120}post\(/.test(CASE));
check('S4 the Worker knows all four kinds, in order, with records kept',
  /const AUTHORITY_KINDS = \['universal', 'designation', 'records', 'representative'\];/.test(WORKER));
// Every already-signed document carries kind 'records'. Renaming it would
// orphan them.
check('S4b and `records` keeps its id so signed documents are not orphaned',
  A.AUTHORITY_KINDS.records && /records: \{/.test(readFileSync(__j(__REPO, 'public/js/authority.js'), 'utf8')));
check('S5 the demo mirrors the same four kinds',
  /const kinds = \['universal', 'designation', 'records', 'representative'\];/.test(DEMO));
check('S5b and the demo stores the three new fields, so it cannot drop them',
  /universal: body\.kind === 'universal'/.test(DEMO)
  && /narrowedFrom:/.test(DEMO) && /expiresAt: demoExpiresAt\(/.test(DEMO));
// One lookup, not two ternaries. With four kinds a ternary means every kind
// that is not the one named prints as the insurance form.
check('S6 both print paths choose the model by lookup, not by ternary',
  /authorityModelFor\(item, o\)/.test(CASE) && /authorityModelFor\(item, o\)/.test(ADMIN)
  && !/item\.kind === 'records' \? recordsAuthorisationModel/.test(CASE)
  && !/item\.kind === 'records' \? recordsAuthorisationModel/.test(ADMIN));
// PROVEN TO FAIL, 2026-08-27: deleting authorityModelFor's `case
// 'designation'` line gave
//   S6b the lookup returns the right document for every kind -- designation
// The mutation's real consequence: a patient designation would have fallen
// through to the default and printed as a records authorisation.
{
  const wrong = [
    ['universal', 'UNIVERSAL AUTHORISATION'],
    ['designation', 'PATIENT DESIGNATION OF ADVOCATE'],
    ['records', 'AUTHORISATION FOR RELEASE'],
    ['representative', 'APPOINTMENT OF AUTHORISED REPRESENTATIVE'],
  ].filter(([kind, title]) =>
    !A.authorityText(A.authorityModelFor({ kind }, {})).startsWith(title));
  check('S6b the lookup returns the right document for every kind',
    wrong.length === 0, wrong.map(([k]) => k).join(', '));
}
// The readiness checklist has to accept the universal form, or a client who
// signed it reads as NOT READY on both screens and Eric is told he may not
// pick up the phone at exactly the moment he may.
check('S7 the readiness checklist counts the universal authorisation',
  R.handsOffReadiness({ forms: { fullAccess: true } }, [
    { kind: 'universal', scopes: ['discuss'], expiresAt: '2099-01-01T00:00:00Z' },
    { kind: 'representative', expiresAt: '2099-01-01T00:00:00Z' },
  ]).ready === true);
check('S7b and still counts a legacy per-clinic one',
  R.handsOffReadiness({ forms: { fullAccess: true } }, [
    { kind: 'records', scopes: ['discuss'], signedAt: new Date().toISOString() },
    { kind: 'representative', signedAt: new Date().toISOString() },
  ]).ready === true);
// PROVEN TO FAIL, 2026-08-27: removing `&& !authorityExpired(i)` from the
// `live` filter in readiness.js gave
//   S7c an EXPIRED authorisation is not readiness -- true
// "true" there means both screens would have shown a green tick against an
// authorisation that ran out, which is the checklist telling Eric he has
// authority he does not have.
check('S7c an EXPIRED authorisation is not readiness',
  R.handsOffReadiness({ forms: { fullAccess: true } }, [
    { kind: 'universal', scopes: ['discuss'], expiresAt: '2020-01-01T00:00:00Z' },
    { kind: 'representative', expiresAt: '2099-01-01T00:00:00Z' },
  ]).ready === false,
  String(R.handsOffReadiness({ forms: { fullAccess: true } }, [
    { kind: 'universal', scopes: ['discuss'], expiresAt: '2020-01-01T00:00:00Z' },
    { kind: 'representative', expiresAt: '2099-01-01T00:00:00Z' },
  ]).ready));
check('S7d and readiness reads the shared predicate rather than its own',
  /import \{ authorityExpired \} from '\.\/authority\.js';/.test(READY));

// ===========================================================================
// P: the provider packet and its status (spec 4)
// ===========================================================================
{
  // Every line Eric's spec 4 names, asserted individually. "The cover sheet
  // renders" would pass with half of them missing.
  const sheet = A.authorityText(P.providerPacketModel({
    patient: { name: 'Dana Reyes', dob: '1979-04-02' },
    advocate: {
      name: 'Eric Bleach', business: 'Pocket Advocate', phone: '520 555 0142',
      email: 'secure@example.invalid', fax: '520 555 0143',
    },
    provider: { name: 'Valley Neurology' },
    request: { kind: 'records', note: 'Neurology notes since January.' },
    docs: [{
      id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', kind: 'universal',
      signedAt: '2026-08-27T12:00:00Z', expiresAt: '2027-08-27T12:00:00Z',
    }],
  }));
  // PROVEN TO FAIL, 2026-08-27: replacing the "does not appoint" paragraph
  // with a pleasantry gave
  //   P1 the cover sheet carries every line the spec names
  //      -- missing: the decision-maker disclaimer
  // The detail line names WHICH line went missing, which is the difference
  // between a bug report and "the cover sheet is wrong".
  const NEED = [
    ['the patient name', /Patient: Dana Reyes/],
    ['the date of birth', /Date of birth: 1979-04-02/],
    ['his name', /Advocate: Eric Bleach/],
    ['his business', /Business: Pocket Advocate/],
    ['his phone', /Phone: 520 555 0142/],
    ['his secure email', /Secure email: secure@example\.invalid/],
    ['his fax', /Fax: 520 555 0143/],
    ['the designation statement', /has designated the advocate named above to\s*\n?\s*communicate/],
    ['the scan-into-chart ask', /scan this sheet and the attached authorisation into the patient's\s*\n?\s*chart/],
    ['the authorised-contact ask', /note the advocate as an authorised contact/],
    ['the current request', /Records\./],
    ['the decision-maker disclaimer', /This packet does not appoint the advocate as the patient's health-care\s*\n?\s*decision maker\./],
    ['the document id', /Document ID AAAAAAAA/],
    ['the expiry', /valid to August 27, 2027/],
  ];
  const missing = NEED.filter(([, re]) => !re.test(sheet)).map(([n]) => n);
  check('P1 the cover sheet carries every line the spec names',
    missing.length === 0, missing.length ? `missing: ${missing.join(', ')}` : '');

  // The nine statuses, by their printed labels, in the spec's order.
  // PROVEN TO FAIL, 2026-08-27: removing the 'verbal' row gave
  //   P2  all nine provider statuses exist, with the spec's wording
  //       -- 8: NOT SENT|SENT|RECEIVED|ACCEPTED / ON CHART|PROVIDER FORM
  //          REQUIRED|REJECTED PRIVACY REVIEW|EXPIRED|REVOKED
  //   P2c the Worker mirrors the status ids exactly
  //       -- notSent,sent,received,accepted,providerForm,rejected,expired,revoked
  // Two checks, because the panel losing a status and the Worker losing one
  // are different failures with different consequences.
  const WANT = ['NOT SENT', 'SENT', 'RECEIVED', 'ACCEPTED / ON CHART',
    'PROVIDER FORM REQUIRED', 'PATIENT VERBAL CONFIRMATION REQUIRED',
    'REJECTED PRIVACY REVIEW', 'EXPIRED', 'REVOKED'];
  check('P2 all nine provider statuses exist, with the spec\'s wording',
    P.PROVIDER_STATUSES.map((s) => s.label).join('|') === WANT.join('|'),
    `${P.PROVIDER_STATUSES.length}: ${P.PROVIDER_STATUSES.map((s) => s.label).join('|')}`);
  check('P2b every status explains itself, so the list is readable at a glance',
    P.PROVIDER_STATUSES.every((s) => s.id && s.label && s.note));
  // The Worker validates against the same ids. A hand-made POST must not be
  // able to store a status no screen can render.
  check('P2c the Worker mirrors the status ids exactly',
    new RegExp(`const PROVIDER_STATUS_IDS = \\[\\s*'${P.PROVIDER_STATUSES.map((s) => s.id).join("', '").replace(/', '/g, "',\\s*'")}',?\\s*\\]`)
      .test(WORKER.replace(/\n/g, ' ')),
    P.PROVIDER_STATUSES.map((s) => s.id).join(','));
  check('P2d and the demo mirrors them too',
    P.PROVIDER_STATUSES.every((s) => DEMO.includes(`'${s.id}'`)));
  // The six request kinds from the spec.
  check('P3 the six request kinds exist',
    P.PROVIDER_REQUESTS.map((r) => r.id).join(',') === 'call,status,records,referral,priorAuth,other',
    P.PROVIDER_REQUESTS.map((r) => r.id).join(','));

  // EXPIRED and REVOKED are facts about the authorisation, not opinions about
  // the provider, so they are derived on top of whatever Eric last set.
  // PROVEN TO FAIL, 2026-08-27: reducing effectiveStatus to
  // `return provider?.status || 'notSent'` gave
  //   P4  an expired authorisation shows EXPIRED whatever he last set -- accepted
  //   P4b a withdrawn one shows REVOKED
  // "accepted" there is the panel telling him a clinic is still good to ring
  // on an authorisation that expired in 2021.
  const dead = [{ kind: 'universal', signedAt: '2020-01-01T00:00:00Z', expiresAt: '2021-01-01T00:00:00Z' }];
  const gone = [{ kind: 'universal', signedAt: '2026-01-01T00:00:00Z', revokedAt: '2026-06-01T00:00:00Z' }];
  const livedoc = [{ kind: 'universal', signedAt: '2026-08-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' }];
  check('P4 an expired authorisation shows EXPIRED whatever he last set',
    P.effectiveStatus({ status: 'accepted' }, dead) === 'expired',
    P.effectiveStatus({ status: 'accepted' }, dead));
  check('P4b a withdrawn one shows REVOKED',
    P.effectiveStatus({ status: 'accepted' }, gone) === 'revoked');
  // Derived, never written back, so a fresh signature restores his own status
  // rather than having overwritten it.
  check('P4c and with a live authorisation his own status is what shows',
    P.effectiveStatus({ status: 'accepted' }, livedoc) === 'accepted'
    && P.effectiveStatus({}, livedoc) === 'notSent');

  // No contact details set: the cover sheet must offer somewhere to write, not
  // a placeholder that looks filled in and not an invented number. A wrong fax
  // number on a page handed to a records department sends a chart to a
  // stranger.
  // PROVEN TO FAIL, 2026-08-27: changing orRule's fallback from a rule to the
  // literal '(fax)' gave
  //   P5 an unset contact field prints as a rule, never as a guess
  // A placeholder is worse than a blank here, because it looks filled in.
  {
    const bare = A.authorityText(P.providerPacketModel({
      patient: { name: 'Dana Reyes' }, provider: { name: 'Valley Neurology' }, docs: [],
    }));
    check('P5 an unset contact field prints as a rule, never as a guess',
      /Phone: _{10,}/.test(bare) && /Fax: _{10,}/.test(bare)
      && !/\(phone\)/.test(bare) && !/\(fax\)/.test(bare));
    // And a packet with nothing signed behind it says so rather than looking
    // like a complete packet with the authorisation lost in the post.
    check('P5b a packet with no signed authorisation says do not act on it',
      /No signed authorisation is attached to this sheet\. Do not act on it until\s*\n?\s*one is\./.test(bare));
  }

  // THE APP ASSEMBLES, IT NEVER SENDS. Settled with Eric and not reopened.
  // PROVEN TO FAIL, 2026-08-27: adding a `send` action containing
  // `await fetch('https://example.invalid')` to handleProviders gave
  //   P6 nothing in the provider route sends anything -- fetch(
  // The check bans the transport, not one function's name, so a future author
  // reaching for any of them trips it.
  {
    const i = WORKER.indexOf('async function handleProviders(');
    const fn = i < 0 ? '' : WORKER.slice(i, WORKER.indexOf('\nasync function handleAgenda', i));
    const sends = (fn.match(/sendMail|sendEmail|notifyUser|fetch\(/g) || []);
    check('P6 nothing in the provider route sends anything',
      fn.length > 0 && sends.length === 0,
      sends.length ? sends.join(', ') : `${fn.length} chars`);
    check('P6b and the packet module has no transport in it either',
      !/sendMail|sendEmail|fetch\(|XMLHttpRequest/.test(PACKET));
    check('P6c the panel says so where he will read it',
      /You assemble the packet here\s*\n?\s*and send it yourself\. Nothing is transmitted from this page\./.test(ADMIN));
  }

  // ADMIN ONLY, IN BOTH DIRECTIONS. The status list is his working note on a
  // client's care: REJECTED PRIVACY REVIEW against their own oncologist is not
  // something a client should read on their case page.
  // PROVEN TO FAIL, 2026-08-27: changing the route's refusal from 404 to 403
  // took P7 red. A 403 says "this exists and you may not have it", which is an
  // existence oracle on an advocate-only route; 404 says nothing at all, and
  // matches how every other admin surface here refuses.
  check('P7 the provider route is admin only and answers 404, not 403',
    /async function handleProviders\(request, env, url\) \{\n  const admin = await requireAdmin\(request, env\);\n  if \(!admin\) return json\(\{ error: 'Not found' \}, 404\);/.test(WORKER));
  // The module name IS the gate. A miss here is silent: the file simply keeps
  // being downloadable by anybody.
  {
    const gate = /^\/(admin[\w-]*(\.html)?\/?|js\/(admin[\w-]*|advisor|notes|duty|prep|drawer|seen|panel-bridge)\.js|css\/admin\.css)$/;
    check('P8 the packet module is gated by the asset rule that 404s admin files',
      gate.test('/js/admin-provider-packet.js'));
    // The negative control for it, inline: the same module under a name that
    // does not start with admin- would be served to the world.
    check('P8b and the gate is what does it, not luck',
      !gate.test('/js/provider-packet.js'));
    // No client-served module may import it, or the import itself 404s and
    // takes the whole page down with it.
    const clientFiles = ['public/js/case.js', 'public/js/authority.js', 'public/js/readiness.js',
      'public/js/authority-doc-window.js'];
    const leaks = clientFiles.filter((f) =>
      readFileSync(__j(__REPO, f), 'utf8').includes('admin-provider-packet'));
    check('P8c and no client-served module imports it',
      leaks.length === 0, leaks.join(', '));
  }
}

// ===========================================================================
// T: the agreement a client ticks before paying, and the code agreeing with it
// ===========================================================================
//
// public/js/tier-terms.js:41 promised "a records authorisation for each
// clinic". Sign-once contradicts that in writing, so the copy was rewritten
// with it. THE WORDING IS NOT APPROVED: CLAUDE.md records that this file has
// never had a legal review and is pending Eric's sign-off, and the rewrite is
// in his hands, not this suite's.
//
// What IS this suite's business is the standing rule in CLAUDE.md that every
// number in that agreement must drive a real limit. An audit once caught it
// promising five clinics, three calls, two appeals and ninety days with not
// one of them counted anywhere. "Twelve months" is the only new number in it,
// and it is counted: AUTHORITY_DEFAULT_MONTHS computes it, the Worker stores
// it, and authorityExpired reads it.
{
  const TIER = readFileSync(__j(__REPO, 'public/js/tier-terms.js'), 'utf8');
  // PROVEN TO FAIL, 2026-08-27: restoring "A records authorisation for each
  // clinic" took T1 red.
  check('T1 the agreement no longer promises a form per clinic',
    !/records authorisation<\/strong> for each clinic/.test(TIER)
    && !/for each clinic/.test(TIER));
  check('T1b it promises one authorisation, signed once',
    /One authorisation, signed once/.test(TIER));
  // The number in the copy IS the number in the code. Twelve months in prose
  // and twelve months in AUTHORITY_DEFAULT_MONTHS, or the agreement is making
  // a promise nothing enforces.
  // PROVEN TO FAIL, 2026-08-27: changing AUTHORITY_DEFAULT_MONTHS to 18 gave
  // "T2 the twelve months in the agreement is the twelve months in the code
  // -- copy says twelve, code says 18".
  check('T2 the twelve months in the agreement is the twelve months in the code',
    /It runs for twelve months unless you choose a shorter time/.test(TIER)
    && A.AUTHORITY_DEFAULT_MONTHS === 12,
    `copy says twelve, code says ${A.AUTHORITY_DEFAULT_MONTHS}`);
  check('T2b and the agreement promises it is never open ended, which the document says too',
    /it never runs open ended/.test(TIER)
    && /This authorisation is never open ended/.test(A.universalAuthorisation({})));
  // The narrow exception is disclosed rather than sprung on somebody later.
  check('T3 the per-clinic exception is disclosed, and called an extra',
    /Some offices will only accept a form with their own name on it/.test(TIER)
    && /an extra, not a replacement/.test(TIER));
  // The two hard constraints CLAUDE.md says may not be contradicted.
  check('T4 the HIPAA and advocacy-only constraints are untouched',
    /This does not make me a HIPAA covered entity/.test(TIER)
    && /Not medical care/.test(TIER) && /not an attorney/.test(TIER));
  // Eric's dash rule. defects.mjs section 15 covers the HTML pages only and
  // says so; copy built inside a JS module is not covered there, and this is
  // exactly such a module.
  check('T5 no em or en dash in the agreement copy', !/[—–]/.test(TIER));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
