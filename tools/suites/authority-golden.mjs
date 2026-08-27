// authority-golden.mjs - the words on a legal document do not change.
//
// Run: node authority-golden.mjs
//
// Eric, 2026-08-26: "The forms are fucking horrendous... Format it neatly."
// The formatting was the problem; the TEXT was not. It is pinned line by line
// by authority.mjs against the 45 CFR 164.508 core elements, and it is what a
// records department reads and either accepts or rejects.
//
// So before the document builders were refactored into a model with a text
// serializer over it, their exact output was captured in
// tools/golden/authority-text.json. This suite asserts byte equality against
// that capture, in eight states, including the two blanks and the two empty
// edge cases where a missing field has to become a rule to write on.
//
// If a check here goes red, the refactor changed the legal text. That is not a
// pin to update: it is the change being wrong. The only legitimate reason to
// regenerate the golden file is a deliberate, reviewed wording change, and
// then this comment gets the reason and the date.
//
// ===========================================================================
// REGENERATED A THIRD TIME, 2026-08-27. FOUR CAPTURES, ONE LINE EACH: the
// UNFILLED DATE OF BIRTH. Reason and date recorded here as this file's own
// rule above requires.
//
// EXACTLY THESE FOUR MOVED, and every one of them is an UNSIGNED, UNEXECUTED
// fixture: no signedName, no signedAt, so each renders "Signed: (typed full
// name)" and is a form nobody has put their name to.
//
//     records-nocats    line 5
//     records-noscopes  line 5
//     records-bare      line 5
//     rep-bare          line 4
//
// each of them, and only that line:
//
//     -  Date of birth: (date of birth)
//     +  Date of birth: ________________________
//
// VERIFIED, not assumed, 2026-08-27, against both the base commit ffc6899 and
// the sign-once commit that added the five new states:
//   * thirteen keys before, thirteen after, in the same order. None added,
//     none removed, none renamed.
//   * NINE captures byte-identical, including EVERY SIGNED ONE
//     (records-signed, rep-signed, universal-signed, designation-signed,
//     narrowed-signed) and BOTH BLANKS (records-blank, rep-blank,
//     designation-blank, universal-blank).
//   * the four that moved differ by exactly one line each, with the same total
//     line count, and that line is the date of birth.
//
// NO EXECUTED DOCUMENT CHANGED. The per-clinic authorisation clients have
// already signed, including on a live case, renders byte for byte as it did.
//
// WHY, and it is a defect being fixed rather than a preference. The date of
// birth comes off the client's profile. It is never asked for on the signing
// sheet and never validated, so a client whose profile has no date of birth
// signed the universal authorisation and the patient designation and handed
// both to a clinic with a bold "(date of birth)" sitting in the field a
// records clerk uses to match the patient to the chart. It renders in the same
// weight and colour as a real value, so it looks filled in. That is the exact
// hazard ruleOr was written for in authority.js on 2026-08-27, and applied
// there to the advocate's phone, secure email and fax; the provider cover
// sheet already did it correctly. The date of birth was the field that was
// missed.
//
// A rule is somewhere to write. A placeholder is a guess that reads as a fact.
// This is the same reasoning, and the same shape of change, as the reviewed
// records-blank regeneration of 2026-08-26 recorded at the foot of this
// comment: a form with nothing in a field needs a line to write on.
// ===========================================================================
//
// REGENERATED A SECOND TIME, 2026-08-27, ADDITIVELY, for sign-once.
//
// Eric's spec 2A and 2B: one broad authorisation naming a CLASS of providers,
// signed once, plus a one-page patient designation signed in the same sitting.
// Per-clinic forms become the exception rather than the norm.
//
// THE EIGHT EXISTING CAPTURES WERE NOT REGENERATED, and that is the important
// half. Four states were ADDED (universal signed, universal blank, the patient
// designation signed and blank) plus one narrowed per-clinic copy; the
// original eight are byte-identical to their 2026-08-26 capture, and this
// suite passing is the evidence.
//
// It was expected that they would have to change. They did not, because they
// must not. The per-clinic authorisation is a legal instrument clients have
// already signed, including on a live case. Re-rendering an executed document
// under new wording means the copy in a clinic's chart and the copy on the
// client's case page stop saying the same thing, and no note in a suite header
// makes that acceptable. So the universal form is a NEW document shape reached
// by a flag, not a rewrite of the old one, and the eight untouched captures are
// how we know nothing leaked across.
//
// If the per-clinic wording is ever to change, that is a separate decision
// taken deliberately and recorded here, never a side effect of adding a
// document.
//
// REGENERATED ONCE, records-blank only, 2026-08-26. A printed blank used to
// say flatly "I have NOT authorised release of separately protected
// categories" with nothing to tick, so a client filling one in on paper could
// not authorise mental-health records however much they wanted to: the in-app
// form offered the choice and the paper form silently refused it. The blank
// now carries the same five tickable categories, unticked, with the same
// "nothing here is required" note. The other seven captures were NOT
// regenerated, which is how this suite proved the refactor changed nothing
// else: seven byte-identical, one deliberate.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync } from 'node:fs';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const GOLDEN = JSON.parse(readFileSync(__j(__REPO, 'tools/golden/authority-text.json'), 'utf8'));
const A = await import(`file://${__j(__REPO, 'public/js/authority.js')}`);

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

// The same inputs the capture used. Kept here rather than imported so that
// editing the fixture cannot quietly make a failing check pass.
const CASES = {
  'records-signed': ['recordsAuthorisation', {
    clientName: 'Jordan Avery', clientDob: '1987-03-14', advocateName: 'Eric Bleach',
    clinicName: 'Mountain Ridge Neurology', clinicAddress: '2400 E Prince Rd, Suite 210, Tucson, AZ 85719',
    fromDate: '2023-01-01', toDate: '2026-08-26', categories: ['mental'],
    scopes: ['discuss', 'records', 'admin'],
    signedName: 'Jordan Avery', signedAt: '2026-08-26T12:00:00Z', expiresAt: '2027-08-26T12:00:00Z',
  }],
  'records-blank': ['recordsAuthorisation', { blank: true, clientName: 'Christopher Miller', clientDob: '1974-07-12' }],
  'records-nocats': ['recordsAuthorisation', { clientName: 'Dana Reyes', clinicName: 'X' }],
  'records-noscopes': ['recordsAuthorisation', { clientName: 'Dana Reyes', clinicName: 'X', scopes: [] }],
  'records-bare': ['recordsAuthorisation', {}],
  'rep-signed': ['representativeDesignation', {
    clientName: 'Jordan Avery', clientDob: '1987-03-14', advocateName: 'Eric Bleach',
    planName: 'Blue Cross of Arizona', memberId: 'XZ99001',
    signedName: 'Jordan Avery', signedAt: '2026-08-26T12:00:00Z', expiresAt: '2027-08-26T12:00:00Z',
  }],
  'rep-blank': ['representativeDesignation', { blank: true, clientName: 'Christopher Miller' }],
  'rep-bare': ['representativeDesignation', {}],
  // ---- added 2026-08-27 for sign-once ------------------------------------
  // The master. Same inputs as records-signed minus the clinic, which is the
  // whole difference: the disclosing party is a class, so there is nothing to
  // name. Its capture is what pins the class list, the revocation route and
  // the "never open ended" sentence byte for byte.
  'universal-signed': ['universalAuthorisation', {
    clientName: 'Jordan Avery', clientDob: '1987-03-14', advocateName: 'Eric Bleach',
    fromDate: '2023-01-01', toDate: '2026-08-26', categories: ['mentalHealth'],
    scopes: ['discuss', 'records', 'admin'],
    signedName: 'Jordan Avery', signedAt: '2026-08-26T12:00:00Z', expiresAt: '2027-08-26T12:00:00Z',
  }],
  'universal-blank': ['universalAuthorisation', { blank: true, clientName: 'Christopher Miller', clientDob: '1974-07-12' }],
  // The one page a front desk scans into the chart. Its capture is what pins
  // the sentence that keeps a chart clerk from filing it as an appointment of
  // a health-care agent.
  'designation-signed': ['advocateDesignation', {
    clientName: 'Jordan Avery', clientDob: '1987-03-14', advocateName: 'Eric Bleach',
    advocateBusiness: 'Pocket Advocate', advocatePhone: '520 555 0142',
    advocateEmail: 'secure@example.invalid', advocateFax: '520 555 0143',
    signedName: 'Jordan Avery', signedAt: '2026-08-26T12:00:00Z', expiresAt: '2027-08-26T12:00:00Z',
  }],
  // Blank, and with NO contact details set, which is the state that matters:
  // every unset field has to become a rule to write on rather than a
  // placeholder or a guess.
  'designation-blank': ['advocateDesignation', { blank: true, clientName: 'Christopher Miller' }],
  // The narrow per-clinic exception, and its capture is what pins the clause
  // saying the master survives it.
  'narrowed-signed': ['recordsAuthorisation', {
    clientName: 'Jordan Avery', clientDob: '1987-03-14', advocateName: 'Eric Bleach',
    clinicName: 'Mountain Ridge Neurology', clinicAddress: '2400 E Prince Rd, Suite 210, Tucson, AZ 85719',
    fromDate: '2023-01-01', toDate: '2026-08-26', categories: ['mentalHealth'],
    scopes: ['discuss', 'records'], narrowedFrom: 'MASTER1',
    signedName: 'Jordan Avery', signedAt: '2026-08-26T12:00:00Z', expiresAt: '2027-08-26T12:00:00Z',
  }],
};

// The capture must cover every case, or a state could drift unwatched.
check('G0 the golden capture covers every state under test',
  Object.keys(CASES).every((k) => typeof GOLDEN[k] === 'string')
  && Object.keys(GOLDEN).length === Object.keys(CASES).length,
  `${Object.keys(GOLDEN).length} captured, ${Object.keys(CASES).length} tested`);
// THE FOUR CAPTURES REGENERATED ON 2026-08-27 ARE UNSIGNED FIXTURES, and this
// keeps the note at the top of this file honest. If a future edit ever needs a
// SIGNED capture regenerated, this goes red first and that decision has to be
// taken and recorded on its own terms rather than riding on the date-of-birth
// note.
//
// PROVEN TO FAIL, 2026-08-27: adding signedName and signedAt to the
// records-bare fixture gave
//   G0b the captures regenerated for the date of birth are unsigned fixtures
//       -- records-bare
{
  const REGENERATED_2026_08_27 = ['records-nocats', 'records-noscopes', 'records-bare', 'rep-bare'];
  const executed = REGENERATED_2026_08_27.filter((k) => {
    const arg = CASES[k]?.[1] || {};
    return !!(arg.signedName || arg.signedAt)
      || !/Signed: \(typed full name\)/.test(GOLDEN[k] || '');
  });
  check('G0b the captures regenerated for the date of birth are unsigned fixtures',
    executed.length === 0, executed.join(', '));
  // And the line that moved is the only thing that reads as unfilled on them:
  // a rule to write on, never a parenthetical that looks like a value.
  const stillPlaceholder = REGENERATED_2026_08_27
    .filter((k) => /\(date of birth\)/.test(GOLDEN[k] || '')
      || !/Date of birth: _{10,}/.test(GOLDEN[k] || ''));
  check('G0c and each of them now carries a rule where the date of birth goes',
    stillPlaceholder.length === 0, stillPlaceholder.join(', '));
}

let n = 0;
for (const [key, [fn, arg]] of Object.entries(CASES)) {
  n += 1;
  const got = A[fn](arg);
  const want = GOLDEN[key];
  if (got === want) { check(`G${n} ${key} is unchanged, to the byte`, true); continue; }
  // Say WHERE it diverged. "not equal" on a 3,000 character legal document is
  // not a bug report.
  const g = String(got).split('\n');
  const w = String(want || '').split('\n');
  let i = 0;
  while (i < g.length && i < w.length && g[i] === w[i]) i += 1;
  check(`G${n} ${key} is unchanged, to the byte`, false,
    `line ${i + 1}\n    was:  ${JSON.stringify(w[i])}\n    now:  ${JSON.stringify(g[i])}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
