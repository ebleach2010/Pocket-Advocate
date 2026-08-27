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
};

// The capture must cover every case, or a state could drift unwatched.
check('G0 the golden capture covers every state under test',
  Object.keys(CASES).every((k) => typeof GOLDEN[k] === 'string')
  && Object.keys(GOLDEN).length === Object.keys(CASES).length,
  `${Object.keys(GOLDEN).length} captured, ${Object.keys(CASES).length} tested`);

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
