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
  //
  // THREE DATES ADDED 2026-08-27, second pass, and this is a hole being
  // closed rather than coverage being padded. NONE of the six original dates
  // was in the band where twelve calendar months and 365 days give different
  // answers, so reverting either copy to the old `signedAt + 365 days` left
  // this whole block green. Twelve months and 365 days diverge exactly when
  // the year being crossed contains a 29 February AFTER the signing date, so
  // the three added dates straddle 29 February 2028. E1b then asserts the
  // divergence itself rather than trusting the dates to be well chosen.
  //
  // PROVEN TO FAIL, 2026-08-27: replacing the Worker's authorityExpiry body
  // with `return new Date(t.getTime() + 365 * 86400000);` gave
  //   E1 the two expiry copies agree: signed so its twelve months contain a
  //       leap day -- client 2028-03-01, worker 2028-02-29
  //   E1 the two expiry copies agree: signed a year before a leap day
  //       -- client 2028-08-27, worker 2028-08-26
  //   E1 the two expiry copies agree: signed the day before a leap day
  //       -- client 2029-02-28, worker 2029-02-27
  // and left the six original dates green, which is the silent pass.
  for (const [label, signedAt] of [
    ['signed today', TODAY],
    ['signed eleven months ago', ELEVEN_MONTHS_OLD],
    ['signed thirteen months ago', THIRTEEN_MONTHS_OLD],
    ['signed on a leap day', '2028-02-29T12:00:00Z'],
    ['signed on the 31st', '2027-01-31T12:00:00Z'],
    ['signed on the last day of a year', '2026-12-31T12:00:00Z'],
    // The band where 365 days is a day short of the anniversary.
    ['signed so its twelve months contain a leap day', '2027-03-01T12:00:00Z'],
    ['signed a year before a leap day', '2027-08-27T12:00:00Z'],
    ['signed the day before a leap day', '2028-02-28T12:00:00Z'],
  ]) {
    const c = A.authorityExpiry(signedAt);
    const w = workerApi.authorityExpiry(signedAt);
    check(`E1 the two expiry copies agree: ${label}`,
      iso(c) === iso(w), `client ${iso(c)}, worker ${iso(w)}`);
  }
  // AND THE ADDED DATES REALLY DO SEPARATE THE TWO RULES. Without this, a
  // future edit could quietly pick dates that agree again and E1 would go on
  // passing on a 365-day implementation. An expiry that lands a day early
  // kills a records request already in flight.
  {
    const straddles = ['2027-03-01T12:00:00Z', '2027-08-27T12:00:00Z', '2028-02-28T12:00:00Z'];
    const same = straddles.filter((s) =>
      iso(A.authorityExpiry(s)) === iso(new Date(Date.parse(s) + 365 * 86_400_000)));
    check('E1b those dates are ones where 365 days and twelve months differ',
      same.length === 0,
      same.length ? `365 days agrees on ${same.join(', ')}` : '');
    check('E1c and twelve months is the anniversary, not 365 days',
      iso(A.authorityExpiry('2027-08-27T12:00:00Z')) === '2028-08-27'
      && iso(A.authorityExpiry('2028-02-28T12:00:00Z')) === '2029-02-28'
      && iso(A.authorityExpiry('2027-03-01T12:00:00Z')) === '2028-03-01',
      [iso(A.authorityExpiry('2027-08-27T12:00:00Z')),
        iso(A.authorityExpiry('2028-02-28T12:00:00Z')),
        iso(A.authorityExpiry('2027-03-01T12:00:00Z'))].join(', '));
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
  // The cap is real, and the exact boundary is the max-months anniversary
  // rather than a day either side of it.
  //
  // UPDATED 2026-08-27, second pass, not deleted. The cap was TWENTY-FOUR
  // months and this asserted the 2028 anniversary. It is twelve now, because
  // twelve is what the agreement promises ("It runs for twelve months unless
  // you choose a shorter time"): the extra year existed in three copies of
  // AUTHORITY_MAX_MONTHS and in the date input's `max`, and appeared on no
  // surface a client reads. The boundary is asserted at its new place, and
  // E5g below asserts the thing the number is FOR, which is that nothing can
  // be stored running longer than the promise.
  check('E5f the cap is exactly the max-months anniversary',
    iso(workerApi.authorityExpiresAt(signedAt, '2027-08-27')) === '2027-08-27'
    && iso(workerApi.authorityExpiresAt(signedAt, '2027-08-28')) === '2027-08-27'
    && workerApi.AUTHORITY_MAX_MONTHS === 12,
    `max ${workerApi.AUTHORITY_MAX_MONTHS}, 2027-08-28 -> ${iso(workerApi.authorityExpiresAt(signedAt, '2027-08-28'))}`);
  // PROVEN TO FAIL, 2026-08-27: putting AUTHORITY_MAX_MONTHS back to 24 in
  // the Worker gave
  //   E5g no date at all yields a document running past twelve months
  //       -- 2027-09-01, 2028-01-01, 2028-08-27, 2029-01-01
  //   E5f the cap is exactly the max-months anniversary -- max 24, ...
  //   E6  the Worker mirrors the client default and cap exactly
  {
    const cap = A.authorityExpiry(signedAt, 12);
    const tries = ['2027-09-01', '2028-01-01', '2028-08-27', '2029-01-01', '2126-08-27',
      '9999-12-31', '2027-08-28'];
    const over = tries.filter((d) =>
      workerApi.authorityExpiresAt(signedAt, d).getTime() > cap.getTime());
    check('E5g no date at all yields a document running past twelve months',
      over.length === 0,
      over.map((d) => iso(workerApi.authorityExpiresAt(signedAt, d))).join(', '));
  }
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
// REWRITTEN 2026-08-27, second pass. THIS CHECK WAS A PROVED SILENT PASS.
//
// It was two regexes over case.js: `await post(kind);` and
// `await post('designation');`. Commenting out the second line, so a sign-once
// sitting stored only ONE document and the client's clinics never got the page
// they keep, left this suite 16/16 green. A regex can see that a line is
// written. It cannot see that it runs.
//
// So the fact moved into authority.js as signSitting(), which the page calls,
// and this RUNS it against a spy: the sitting is executed and the documents it
// posts are recorded. Deleting the loop, reordering it, or dropping the
// designation now fails here, in this suite, with no browser involved.
//
// PROVEN TO FAIL, 2026-08-27:
//   * `AUTHORITY_SITTINGS.universal = ['universal']` gave
//       S1 one sitting stores BOTH documents, the authorisation first
//          -- universal
//   * reversing that pair gave
//       S1  -- designation,universal
//       S1c the authorisation is stored FIRST -- designation
//   * commenting out `await post(kinds[0]);` gave
//       S1 -- designation
{
  const seen = [];
  const partial = await A.signSitting('universal', async (k) => { seen.push(k); });
  check('S1 one sitting stores BOTH documents, the authorisation first',
    seen.join(',') === 'universal,designation' && partial.length === 0,
    seen.join(',') || 'nothing posted');
  // Every other kind stores exactly itself. `designation` is its own sitting
  // too, because it has three live routes of its own: the "Add the one page"
  // button, the recovery message after a half-finished sitting, and
  // ?sign=designation.
  const solo = [];
  for (const kind of ['designation', 'records', 'representative']) {
    const got = [];
    // eslint-disable-next-line no-await-in-loop
    await A.signSitting(kind, async (k) => { got.push(k); });
    if (got.join(',') !== kind) solo.push(`${kind} -> ${got.join(',') || 'nothing'}`);
  }
  check('S1b and every other kind stores exactly itself, never another document',
    solo.length === 0, solo.join('; '));
  check('S1c the authorisation is stored FIRST, so a later failure leaves it standing',
    seen[0] === 'universal', seen[0] || 'nothing');
  // An unknown kind stores NOTHING and says so. The page used to fall through
  // to the representative branch for anything it did not recognise.
  let threw = false;
  const never = [];
  try {
    await A.signSitting('nonsense', async (k) => { never.push(k); });
  } catch { threw = true; }
  check('S1d an unknown kind stores nothing at all and refuses',
    threw && never.length === 0, never.join(',') || `threw=${threw}`);
  // And the sheet is what runs it, rather than keeping its own copy.
  check('S1e the signing sheet drives the sitting from that one function',
    /const partial = await signSitting\(kind, post\);/.test(CASE)
    && !/await post\('designation'\)/.test(CASE));
}
// Both documents on screen before the signature. A preview showing only the
// authorisation would mean the designation was signed unseen, which is not
// consent.
//
// REWRITTEN 2026-08-27, second pass. THIS CHECK WAS ALSO A PROVED SILENT PASS.
//
// It asserted that two model calls appeared in case.js. Making the narrow
// preview drop `narrowedFrom` - so the client READ a form without the "narrowed
// copy, not a replacement" clause and SIGNED one with it - left both this
// 16-suite battery and the 64-check browser drive green, because the two model
// calls were still spelled correctly and both documents still rendered.
//
// The cause was that the preview options and the POST body were built
// separately. They are one object now (sittingOptions), and this RUNS it: the
// options the client's page is rendered from are the options the record is
// stored with, and the clause is asserted on the rendered document rather than
// in the source.
//
// PROVEN TO FAIL, 2026-08-27:
//   * deleting `narrowedFrom: master?.id || ''` from sittingOptions gave
//       S2b the narrow preview carries the clause saying the master survives
//           -- narrowedFrom missing from the previewed document
//   * `sittingModels: (kind, o) => sittingKinds(kind).slice(0, 1).map(...)` gave
//       S2 the sitting SHOWS every document it is about to sign
//          -- universal shows 1 of 2
{
  const o = A.sittingOptions('universal', {
    signedName: 'Dana Reyes', scopes: ['discuss'], categories: [], expiresAt: '2027-08-27',
  }, { clientName: 'Dana Reyes', clientDob: '1979-04-02' });
  const shown = A.sittingModels('universal', o).map(A.authorityText);
  check('S2 the sitting SHOWS every document it is about to sign',
    shown.length === A.sittingKinds('universal').length
    && /^UNIVERSAL AUTHORISATION/.test(shown[0] || '')
    && /^PATIENT DESIGNATION OF ADVOCATE/.test(shown[1] || ''),
    `universal shows ${shown.length} of ${A.sittingKinds('universal').length}`);
  // THE NARROW CASE, WHICH IS THE ONE THAT WENT SILENT. The clause only
  // appears when narrowedFrom is on the options, and the same object is what
  // the POST reads, so the page and the record cannot describe different
  // documents.
  const master = { id: 'MASTER1', kind: 'universal', expiresAt: '2027-08-27T12:00:00Z' };
  const no = A.sittingOptions('records', { clinicName: 'Valley Neurology', scopes: ['discuss'] }, {});
  const yes = A.sittingOptions('records', { clinicName: 'Valley Neurology', scopes: ['discuss'] }, { master });
  const previewed = A.authorityText(A.sittingModels('records', yes)[0]);
  check('S2b the narrow preview carries the clause saying the master survives',
    yes.narrowedFrom === 'MASTER1'
    && /THIS IS A NARROWED COPY, NOT A REPLACEMENT/.test(previewed),
    'narrowedFrom missing from the previewed document');
  check('S2c and a form with no master behind it does NOT claim one exists',
    no.narrowedFrom === ''
    && !/THIS IS A NARROWED COPY/.test(A.authorityText(A.sittingModels('records', no)[0])));
  check('S2d the POST sends the narrowedFrom the preview was built from',
    /narrowedFrom: shared\.narrowedFrom,/.test(CASE)
    && /const shared = optionsNow\(\);/.test(CASE));
  check('S2e and the preview is rendered from that same object',
    /preview\.innerHTML = sittingModels\(kind, optionsNow\(\)\)/.test(CASE));
}
check('S2f with the button saying it signs both',
  /isUniversal \? 'Sign both' : 'Sign'/.test(CASE));
// Sequential, so a failure of the second leaves the first standing rather than
// leaving a designation pointing at an authorisation that does not exist.
//
// UPDATED 2026-08-27, second pass, not deleted: the loop moved from case.js
// into signSitting, so both files are scanned and the property is RUN as well.
// A parallel implementation cannot guarantee the order, so a spy that records
// the order it was called in is the check, and the source ban is the belt.
{
  const order = [];
  await A.signSitting('universal', async (k) => {
    order.push(`start:${k}`);
    await new Promise((r) => { setTimeout(r, k === 'universal' ? 12 : 0); });
    order.push(`end:${k}`);
  });
  check('S3 they are posted in order, not in parallel',
    order.join(' ') === 'start:universal end:universal start:designation end:designation'
    && !/Promise\.all\(\[[\s\S]{0,120}post\(/.test(CASE)
    && !/Promise\.all/.test(readFileSync(__j(__REPO, 'public/js/authority.js'), 'utf8')),
    order.join(' '));
}
check('S4 the Worker knows all four kinds, in order, with records kept',
  /const AUTHORITY_KINDS = \['universal', 'designation', 'records', 'representative'\];/.test(WORKER));
// Every already-signed document carries kind 'records'. Renaming it would
// orphan them.
check('S4b and `records` keeps its id so signed documents are not orphaned',
  A.AUTHORITY_KINDS.records && /records: \{/.test(readFileSync(__j(__REPO, 'public/js/authority.js'), 'utf8')));
check('S5 the demo mirrors the same four kinds',
  /const kinds = \['universal', 'designation', 'records', 'representative'\];/.test(DEMO));
// UPDATED 2026-08-27, second pass, not deleted. The demo's expiry is computed
// into a local before it is stored, because a narrowed copy is clamped to its
// master's end date on the way through, so the pinned `expiresAt:
// demoExpiresAt(` became `expiresAt,`. Both halves are asserted: the value
// still comes from demoExpiresAt, and it is still what gets stored.
check('S5b and the demo stores the three new fields, so it cannot drop them',
  /universal: body\.kind === 'universal'/.test(DEMO)
  && /narrowedFrom:/.test(DEMO)
  && /let expiresAt = demoExpiresAt\(signedAt, body\.expiresAt\);/.test(DEMO)
  && /\n\s*expiresAt,\n/.test(DEMO));
// And the demo mirrors the Worker's narrowing gates, or the one route a
// browser drive can exercise is the one route with no gates on it. It had
// none of them at all, which is how "a narrowed form can be generated against
// an EXPIRED master" survived a 64-check drive.
// PROVEN TO FAIL, 2026-08-27: deleting the demo's expiry branch took S5c red
// and the drive's "the route refuses a narrowed copy of an EXPIRED master"
// with it.
check('S5c the demo mirrors the Worker\'s narrowing gates, expiry included',
  /That universal authorisation is not on this case\./.test(DEMO)
  && /That universal authorisation has been withdrawn\./.test(DEMO)
  && /That universal authorisation has expired\. Sign a fresh one first\./.test(DEMO)
  && /masterEnds && expiresAt && expiresAt\.getTime\(\) > masterEnds\.getTime\(\)/.test(DEMO));
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

// ===========================================================================
// B: the defects two reviewers reproduced in a browser, 2026-08-27
// ===========================================================================
//
// Every check in this section pins something that shipped WRONG in the first
// sign-once commit and was found by a person driving the product, not by any
// check here. Where the fact can be executed, it is executed; where the fact
// only exists on a rendered screen, the source is pinned here and the browser
// assertion that really holds it is named beside it, in
// tools/drives/drive-signonce.mjs.
{
  const DRIVE = readFileSync(__j(__REPO, 'tools/drives/drive-signonce.mjs'), 'utf8');
  const AUTH = readFileSync(__j(__REPO, 'public/js/authority.js'), 'utf8');
  const AUDIT = readFileSync(__j(__REPO, 'tools/blindness-audit.mjs'), 'utf8');
  const CSS = readFileSync(__j(__REPO, 'public/css/site.css'), 'utf8');
  const DOCWIN = readFileSync(__j(__REPO, 'public/js/authority-doc-window.js'), 'utf8');

  // ---- B1: the patient signs the document they were shown ----------------
  //
  // openAuthoritySheet branched on isUniversal / isNarrow and let EVERYTHING
  // ELSE fall through to the representative branch. `designation` was
  // "everything else". The heading read "Insurance representative", the blurb
  // was about dealing with a plan, the preview showed the APPOINTMENT OF
  // AUTHORISED REPRESENTATIVE, and Sign refused until a plan name and a member
  // ID were supplied. What was stored, and later printed into a packet a
  // clinic files, was the PATIENT DESIGNATION OF ADVOCATE.
  //
  // Three live routes reached it: the "Add the one page for your clinics"
  // button, the recovery message after a half-finished sitting, and
  // ?sign=designation.
  //
  // PROVEN TO FAIL, 2026-08-27: restoring the fall-through (`: isNarrow ? ...
  // : 'Insurance representative'` and the else branch of isRecords) gave, in
  // the drive:
  //   FAIL designation: the heading names the document it opens
  //        (Insurance representative (wanted The one page your clinics keep))
  //   FAIL designation: the preview shows that document and no other
  //        (APPOINTMENT OF AUTHORISED REPRESENTATIVE)
  //   FAIL designation: it asks for that document's fields and no others
  //        (clinic=false plan=true)
  //   FAIL the designation signs ALONE, with no insurer details demanded
  //        (nothing stored)
  // and here:
  //   FAIL B1 the sheet has a branch of its own for every kind
  check('B1 the sheet has a branch of its own for every kind, and no else',
    /const isDesig = kind === 'designation';/.test(CASE)
    && /isDesig \? 'The one page your clinics keep' : 'Insurance representative'/.test(CASE)
    && /\` : isRep \? \`/.test(CASE)
    && /isDesig \? \['signedName'\]/.test(CASE));
  // The heading, the preview and the stored kind agree for every kind, which
  // only a browser can see. Named here so a future author knows where it is.
  check('B1b and the drive asserts heading, preview and stored kind agree',
    /the heading names the document it opens/.test(DRIVE)
    && /the preview shows that document and no other/.test(DRIVE)
    && /the designation signs ALONE, with no insurer details demanded/.test(DRIVE));
  // AN UNKNOWN KIND RENDERS NOTHING. Run, not read: the sheet's own gate is
  // `if (!sittingKinds(kind).length)`, so this is the predicate it uses.
  {
    const junk = ['', null, undefined, 'nonsense', 'Designation', 'records ', '__proto__', 'constructor'];
    const opened = junk.filter((k) => A.sittingKinds(k).length);
    const modelled = junk.filter((k) => A.sittingModels(k, {}).length);
    check('B1c an unknown kind yields no document at all, never a default one',
      opened.length === 0 && modelled.length === 0,
      [...new Set([...opened, ...modelled])].map(String).join(', '));
    check('B1d and the sheet refuses out loud rather than rendering one',
      /if \(!sittingKinds\(kind\)\.length\) \{/.test(CASE)
      && /nothing has been signed/.test(CASE));
  }
  // The header comment that claimed the designation "never opened alone" is
  // gone, because it was not true: three routes open it alone.
  check('B1e and no comment still claims the designation never opens alone',
    !/designation'\s*never opened alone/.test(CASE)
    && !/never opened alone: it rides with/.test(CASE));

  // ---- B2: no packet without a live authorisation ------------------------
  //
  // The cover sheet says "within the limits of the authorisation attached to
  // this sheet" and "This authorisation is valid to ...". packetDocs was
  // [master, desig].filter(Boolean) and the only guard was length === 0, so a
  // client who withdrew the AUTHORISATION but not the designation left it at
  // length 1: Build packet stayed enabled and the sheet went out claiming an
  // authorisation the patient had revoked.
  //
  // PROVEN TO FAIL, 2026-08-27: putting `[master, desig].filter(Boolean)` back
  // gave
  //   B2 the packet is guarded on the master, not on a list length
  // and in the drive
  //   FAIL a withdrawn authorisation DISABLES Build packet, on every provider
  //        (2 of 2 still enabled)
  check('B2 the packet is guarded on the master, not on a list length',
    /const packetDocs = master \? \[master, desig\]\.filter\(Boolean\) : \[\];/.test(ADMIN)
    && !/const packetDocs = \[master, desig\]\.filter\(Boolean\);/.test(ADMIN));
  check('B2b the button is disabled and the click is refused as well',
    /data-provider-packet="\$\{esc\(p\.id\)\}"\$\{/.test(ADMIN)
    && /packetDocs\.length \? '' : ' disabled/.test(ADMIN)
    && /if \(!packetDocs\.length\) \{[\s\S]{0,200}?No live authorisation to attach/.test(ADMIN));
  check('B2c and it says which of the three ways it failed',
    /has been WITHDRAWN by the client/.test(ADMIN)
    && /has EXPIRED, so there is nothing valid to attach/.test(ADMIN)
    && /Nothing is signed yet, so a packet would carry no authorisation/.test(ADMIN));
  // THE STATUS DERIVATION, RUN. A withdrawn authorisation beside a live
  // designation is not authority to act, and reading the pair as "one of them
  // is live" is how a provider stayed on ACCEPTED after the client revoked the
  // only document that mattered.
  //
  // PROVEN TO FAIL, 2026-08-27: restoring `const live = docs.filter((d) =>
  // !d.revokedAt); if (docs.length && !live.length) return 'revoked';` gave
  //   B2d a withdrawn authorisation beside a live designation is REVOKED
  //       -- accepted
  {
    const gone = [
      { kind: 'universal', signedAt: '2026-01-01T00:00:00Z', revokedAt: '2026-06-01T00:00:00Z' },
      { kind: 'designation', signedAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' },
    ];
    const dead = [
      { kind: 'universal', signedAt: '2020-01-01T00:00:00Z', expiresAt: '2021-01-01T00:00:00Z' },
      { kind: 'designation', signedAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' },
    ];
    check('B2d a withdrawn authorisation beside a live designation is REVOKED',
      P.effectiveStatus({ status: 'accepted' }, gone) === 'revoked',
      P.effectiveStatus({ status: 'accepted' }, gone));
    check('B2e and an expired one beside a live designation is EXPIRED',
      P.effectiveStatus({ status: 'accepted' }, dead) === 'expired',
      P.effectiveStatus({ status: 'accepted' }, dead));
    // And the panel hands it the documents UNFILTERED, or the whole
    // derivation is dead code: it was being given a list that had already had
    // every withdrawn and expired document removed from it.
    check('B2f and the panel feeds it the documents themselves, not the live ones',
      /const statusDocs = items\.filter\(\(i\) => i\.kind === 'universal' \|\| i\.kind === 'designation'\);/.test(ADMIN)
      && /effectiveStatus\(p, statusDocs\)/.test(ADMIN)
      && !/effectiveStatus\(p, packetDocs\)/.test(ADMIN));
  }

  // ---- B3: twelve months, and a way back in ------------------------------
  //
  // signed() filtered on !revokedAt only, so an expired master was
  // simultaneously "signed" (which suppressed the button to sign a new one)
  // and displayed as EXPIRED. The only control left was Withdraw, behind a
  // confirm saying it cannot undo anything already sent. This lands on every
  // client at month twelve.
  //
  // PROVEN TO FAIL, 2026-08-27: restoring `const signed = (kind) =>
  // items.find((i) => i.kind === kind && !i.revokedAt)` gave
  //   B3 expiry decides whether a renewal is offered, not just withdrawal
  // and in the drive
  //   FAIL THERE IS A WAY TO SIGN A FRESH ONE (no button)
  //   FAIL the button says it is a fresh one, not a first one
  check('B3 expiry decides whether a renewal is offered, not just withdrawal',
    /const currentOf = \(kind\) => onFile\(kind\)\.find\(\(i\) => !authorityExpired\(i\)\);/.test(CASE)
    && /const lapsedOf = \(kind\) => onFile\(kind\)\.find\(\(i\) => authorityExpired\(i\)\);/.test(CASE)
    && !/const signed = \(kind\) => items\.find\(\(i\) => i\.kind === kind && !i\.revokedAt\);/.test(CASE));
  check('B3b an expired document is still LISTED as one they signed',
    /const masterRows = onFile\('universal'\);/.test(CASE)
    && /masterRows\.map\(\(m\) => `/.test(CASE));
  check('B3c and there is a control to sign a fresh one',
    /Sign a fresh authorisation/.test(CASE) && /masterLapsed \? `/.test(CASE));
  check('B3d the drive runs it with the documents actually aged out',
    /THERE IS A WAY TO SIGN A FRESH ONE/.test(DRIVE)
    && /signing a fresh one leaves the old one on file, withdrawn by nobody/.test(DRIVE));
  // The readiness checklist already excluded expired documents (S7c). With no
  // renewal control that was a checklist saying "unmet" beside a panel saying
  // "signed" and no way to close the gap, so the two now agree.
  check('B3e readiness and the panel agree about what expiry means',
    R.handsOffReadiness({ forms: { fullAccess: true } }, [
      { kind: 'universal', scopes: ['discuss'], expiresAt: '2020-01-01T00:00:00Z' },
      { kind: 'representative', expiresAt: '2099-01-01T00:00:00Z' },
    ]).ready === false);

  // ---- B4: the emailed link repaints -------------------------------------
  //
  // ?sign=universal is the link Eric puts in an email. Both documents were
  // stored and the panel behind still read "Not signed", 4 times out of 4, at
  // 390 and 320. renderProgress runs twice on every load, so the panel the
  // deep link captured was detached before anything was signed.
  //
  // PROVEN TO FAIL, 2026-08-27: putting `() => mountAuthority(auth, c)` back
  // gave, in the drive:
  //   FAIL 390px: and the panel says so WITHOUT a reload
  //        (notSigned=true signButton=true rows=0)
  //   FAIL 320px: and the panel says so WITHOUT a reload
  //        (notSigned=true signButton=true rows=0)
  // with "the emailed link stores both documents" green beside it, which is
  // exactly what the client saw.
  check('B4 the deep link repaints whichever panel is on the page',
    /function repaintAuthority\(c\) \{/.test(CASE)
    && /const host = document\.querySelector\('\[data-authority\]'\);/.test(CASE)
    && /openAuthoritySheet\(c, kind, \(\) => repaintAuthority\(c\)\)/.test(CASE)
    && !/openAuthoritySheet\(c, kind, \(\) => mountAuthority\(auth, c\)\)/.test(CASE));
  check('B4b and the drive proves it at both widths',
    /for \(const width of \[390, 320\]\)/.test(DRIVE)
    && /the panel says so WITHOUT a reload/.test(DRIVE));

  // ---- B5: the date of birth is a rule, never a placeholder --------------
  //
  // It comes off the profile, is never asked for at signing and never
  // validated, so a client with no date of birth signed both documents and
  // handed a clinic a bold "(date of birth)" in the field a records clerk
  // matches the patient on. ruleOr was written this same commit for the
  // advocate's phone, email and fax, and applied to all three; the date of
  // birth was missed.
  //
  // PROVEN TO FAIL, 2026-08-27: putting `field(o, o.clientDob, '(date of
  // birth)', 24)` back on the designation gave
  //   B5 no document prints a date of birth placeholder in any state
  //      -- designation signed
  {
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
    const bad = states.filter(([, t]) => /\(date of birth\)/.test(t));
    check('B5 no document prints a date of birth placeholder in any state',
      bad.length === 0, bad.map(([n]) => n).join(', '));
    const noRule = states.filter(([, t]) => !/Date of birth: _{10,}/.test(t));
    check('B5b every one of them offers somewhere to write it instead',
      noRule.length === 0, noRule.map(([n]) => n).join(', '));
    check('B5c and a real date of birth still prints as the date',
      /Date of birth: 1979-04-02/.test(A.advocateDesignation({ clientDob: '1979-04-02' }))
      && /Date of birth: 1979-04-02/.test(A.universalAuthorisation({ clientDob: '1979-04-02' })));
    // Nobody is ever asked for it, so the advocate is warned before a packet
    // goes out on a document with a blank in that field.
    check('B5d and the advocate is warned before a packet is built without one',
      /data-packet-nodob/.test(ADMIN) && /No date of birth on this case/.test(ADMIN));
  }

  // ---- B6: a narrowed copy cannot outlive its master ---------------------
  //
  // narrowedAuthorisationOptions returned no expiresAt and the narrow sheet
  // hard-coded twelve months, so a client who deliberately shortened the
  // master to six months got a narrowed copy running the full twelve, from a
  // sheet that told them it was "filled in from what you already gave me".
  //
  // PROVEN TO FAIL, 2026-08-27: deleting the `expiresAt` line from
  // narrowedAuthorisationOptions gave
  //   B6 a narrowed copy inherits the master's end date -- undefined
  // and in the drive
  //   FAIL the narrowed copy inherits the master's end date, not a fresh
  //        twelve months (2027-08-27 vs master 2027-02-27)
  {
    const master = {
      id: 'MASTER1', kind: 'universal', clientName: 'Dana Reyes',
      signedAt: '2026-08-27T12:00:00Z', expiresAt: '2027-02-27T12:00:00Z',
    };
    const same = A.narrowedAuthorisationOptions(master, {});
    const shorter = A.narrowedAuthorisationOptions(master, { expiresAt: '2026-12-01' });
    const longer = A.narrowedAuthorisationOptions(master, { expiresAt: '2027-12-01' });
    const iso10 = (v) => String(v || '').slice(0, 10);
    check('B6 a narrowed copy inherits the master\'s end date',
      iso10(same.expiresAt) === '2027-02-27', String(same.expiresAt));
    check('B6b an office may ask for LESS and gets it',
      iso10(shorter.expiresAt) === '2026-12-01', String(shorter.expiresAt));
    check('B6c and can never have more, however it is asked for',
      iso10(longer.expiresAt) === '2027-02-27', String(longer.expiresAt));
    // A legacy master with no stored expiry still has an end date its own
    // printed text has always implied, and that is what carries across.
    check('B6d a master with no stored expiry carries its implied twelve months',
      iso10(A.narrowedExpiry({ signedAt: '2026-08-27T12:00:00Z' })) === '2027-08-27',
      String(A.narrowedExpiry({ signedAt: '2026-08-27T12:00:00Z' })));
    check('B6e and a master with no date at all carries none, rather than an invented one',
      A.narrowedExpiry({}) === '');
    // The sheet caps its own field at that date rather than at twelve months.
    check('B6f the narrow sheet defaults and caps at the master\'s date',
      /const narrowCap = isNarrow && master/.test(CASE)
      && /value="\$\{esc\(expiryValue\)\}"/.test(CASE)
      && /max="\$\{esc\(expiryMax\)\}"/.test(CASE));
    // And the Worker clamps it, because a POST straight at the route skips
    // the sheet entirely.
    check('B6g and the Worker clamps it, so a raw POST cannot beat the sheet',
      /if \(item\.expiresAt && item\.expiresAt\.getTime\(\) > masterEnds\.getTime\(\)\)\n      item\.expiresAt = masterEnds;/.test(WORKER));
  }

  // ---- B7: no narrowing against an expired master ------------------------
  //
  // The route validated existence, kind and revocation but not expiry, so the
  // generated document told a clinic "I have already signed a universal
  // authorisation which remains in force" months after it ran out.
  //
  // PROVEN TO FAIL, 2026-08-27: removing the masterEnds branch from the Worker
  // gave B7, and removing the demo's copy of it gave, in the drive:
  //   FAIL the route refuses a narrowed copy of an EXPIRED master (200 )
  check('B7 the Worker refuses a narrowed copy of an expired master',
    /const masterEnds = authorityEndsAt\(master\.data\);/.test(WORKER)
    && /if \(!masterEnds \|\| masterEnds\.getTime\(\) <= Date\.now\(\)\)\n      return json\(\{ error: 'That universal authorisation has expired\./.test(WORKER));
  check('B7b and the Worker has its own copy of the end-date rule',
    /function authorityEndsAt\(d\) \{/.test(WORKER));
  check('B7c and the page stops offering the narrow form once the master lapses',
    /Only against a LIVE master/.test(CASE));

  // ---- B8: the copy on the cheaper client's screen -----------------------
  //
  // The standard case's panel still said "it lets a clinic send them to me
  // directly" directly above a panel saying the form covers every provider.
  // `universal` is deliberately not tier-gated, so a standard-case client is
  // offered the class-wide grant and never sees tier-terms.js at all.
  check('B8 the standard case panel describes the form it actually offers',
    !/it lets a clinic send them to me\s*\n?\s*directly/.test(CASE)
    && /it lets the clinics, hospitals, labs and pharmacies/.test(CASE));
  // And the legacy ?sign=records link stops asserting a master that is not
  // there.
  check('B8b ?sign=records with nothing signed claims no pre-fill and no master',
    /\? \(master\n/.test(CASE)
    && /This is that form, for one office only/.test(CASE));
  // The cover sheet calls the designation a designation.
  {
    const sheet = A.authorityText(P.providerPacketModel({
      patient: { name: 'Dana Reyes' }, provider: { name: 'Valley Neurology' },
      docs: [
        { id: 'a1', kind: 'universal', signedAt: '2026-08-27T12:00:00Z', expiresAt: '2027-08-27T12:00:00Z' },
        { id: 'b2', kind: 'designation', signedAt: '2026-08-27T12:00:00Z', expiresAt: '2027-08-27T12:00:00Z' },
      ],
    }));
    // Flattened first: the cover sheet's bullets are wrapped for the paper
    // form, so these sentences carry hard line breaks in the text version.
    const flat = sheet.replace(/\s+/g, ' ');
    check('B8c the cover sheet does not call the designation an authorisation',
      /This designation grants no permission of its own and is valid to August 27, 2027\./.test(flat)
      && (flat.match(/This authorisation is valid to/g) || []).length === 1,
      (flat.match(/This [a-z]+ [^.]*valid to[^.]*\./g) || []).join(' // '));
  }

  // ---- B9: the iron rule, on a file every client downloads ---------------
  //
  // authority.js opened "The two documents Full Access runs on... 1. A RECORDS
  // AUTHORISATION, one per clinic" and carried "PENDING ERIC'S SIGN-OFF,
  // flagged in the PR". CLAUDE.md records that exactly these headers were
  // stripped from three other client-served files for this reason; this one
  // was missed, and this commit grew it from two documents to four.
  {
    const head = AUTH.slice(0, AUTH.indexOf('export const SENSITIVE_CATEGORIES'));
    const banned = [
      ['a pending sign-off', /PENDING|SIGN-OFF|sign-off/i],
      ['a PR flag', /flagged in the PR|in the PR/i],
      ['legal review talk', /legal review|not been reviewed|unapproved|not approved/i],
      ['the old one-per-clinic promise', /one per clinic/i],
      ['a stale document count', /The two documents/i],
    ];
    const hits = banned.filter(([, re]) => re.test(head)).map(([n]) => n);
    check('B9 the header of a client-served file describes only what it does',
      hits.length === 0, hits.join(', '));
    check('B9b and it still says what the module is for',
      /UNIVERSAL RECORDS AUTHORISATION/.test(head)
      && /PATIENT DESIGNATION OF ADVOCATE/.test(head)
      && /45 CFR 164\.508\(c\)/.test(head));
    // Nothing anywhere on a client surface mentions a model or a vendor.
    check('B9c and no client-served authority file mentions AI',
      !/\bAI\b|artificial intelligence|language model/i.test(AUTH)
      && !/\bAI\b|artificial intelligence|language model/i.test(readFileSync(__j(__REPO, 'public/js/authority-doc-window.js'), 'utf8')));
  }

  // ---- B10: the blank forms that had no button ---------------------------
  //
  // The universal blank and the designation blank were both written and both
  // golden-tested, and neither had a button, on the panel whose own copy says
  // this is how a form reaches a client before a case exists.
  check('B10 every document can be printed blank, the universal one included',
    ['universal', 'designation', 'records', 'representative']
      .every((k) => ADMIN.includes(`data-blank="${k}"`)),
    ['universal', 'designation', 'records', 'representative']
      .filter((k) => !ADMIN.includes(`data-blank="${k}"`)).join(', '));

  // ---- B11: the audit asks about the packet module -----------------------
  //
  // The gate 404s it (P8 above proves the rule matches the name), but the
  // audit never asked for it, so nothing PROVED the gate held for this file.
  check('B11 the blindness audit asks for the packet module by name',
    /'\/js\/admin-provider-packet\.js'/.test(AUDIT)
    && AUDIT.indexOf("'/js/admin-provider-packet.js'") > AUDIT.indexOf('const ADMIN_ASSETS'));

  // ---- B12: the printed page on a narrow phone ---------------------------
  //
  // The document a clinic reads scrolled sideways at 320px, scrollWidth 338
  // against clientWidth 320, with "Date of birth" wrapped onto three lines.
  // The stylesheet was unchanged; the trigger is new content, a ruled line
  // where an unset field used to be a short placeholder.
  check('B12 the printed document stacks its meta rows on a narrow screen',
    /@media screen and \(max-width: 360px\) \{[\s\S]{0,220}?\.doc-meta \{ grid-template-columns: 1fr;/.test(DOCWIN)
    && /@media print \{/.test(DOCWIN));
  check('B12b and the in-app preview does the same',
    /@media \(max-width: 360px\) \{[\s\S]{0,200}?\.auth-doc \.doc-meta \{ grid-template-columns: 1fr;/.test(CSS));
  check('B12c and the drive measures it rather than trusting the rule',
    /320px: the printed document does not scroll sideways/.test(DRIVE));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
