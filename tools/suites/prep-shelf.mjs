// prep-shelf.mjs — the rule that keeps Eric's own documents off the client's
// screen.
//
// WHY A SUITE AND NOT JUST A DRIVE. The drive proves the client PAGE does not
// render a prep file. That is worth having and it is not the guarantee. The
// guarantee is storage.rules, enforced by Firebase, which no browser test in
// this repo can exercise: the demo's Storage is a Map in a tab and honours no
// rules at all. So a drive that goes green here would go green even if the
// rule were deleted.
//
// This suite reads storage.rules as text and pins the two clauses that
// actually do the work. If someone adds 'prep' to the client-readable folder
// list, or loosens the admin-only tail, this turns red before it ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f(import.meta.url)), '..', '..');
const RULES = readFileSync(j(ROOT, 'storage.rules'), 'utf8');
const ADMIN = readFileSync(j(ROOT, 'public/js/admin-case.js'), 'utf8');

const results = [];
const ck = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

// ---- the client-readable allow-list --------------------------------------
const listed = (RULES.match(/folder in \[([^\]]+)\]/) || [])[1] || '';
const folders = listed.split(',').map((x) => x.trim().replace(/^'|'$/g, '')).filter(Boolean);
ck('P1 a client may read only NAMED folders, not a wildcard', folders.length > 0, listed);
ck('P2 and the list is exactly the four they are entitled to',
  folders.join() === 'report,recording,uploads,chat-files', folders.join());
ck('P3 prep/ is NOT among them, which is the whole point',
  !folders.includes('prep'), folders.join());

// ---- everything else under a case is the admin's alone -------------------
ck('P4 the catch-all under a case is admin-read only',
  /match \/cases\/\{caseId\}\/\{allPaths=\*\*\} \{\s*allow read: if isAdmin\(\);/.test(RULES));
ck('P5 and admin-write only',
  /match \/cases\/\{caseId\}\/\{allPaths=\*\*\} \{[\s\S]{0,120}allow write: if isAdmin\(\);/.test(RULES));
ck('P6 with a deny-everything tail underneath it',
  /match \/\{allPaths=\*\*\} \{\s*allow read, write: if false;/.test(RULES));

// ---- a client may not WRITE into prep either -----------------------------
// Line-based, walking back to the nearest `match` line. The first attempt at
// this used /match ([^\s{]+) \{/, which cannot work: every path in this file
// contains {caseId} or {fileName}, so the character class stopped at the
// first brace and the match list came back EMPTY. It failed loudly rather
// than passing, which is the only reason it was caught.
const lines = RULES.split('\n');
const clientWrites = [];
lines.forEach((ln, i) => {
  if (!/allow write: if\b/.test(ln)) return;
  // the grant may span the next couple of lines
  const grant = lines.slice(i, i + 4).join(' ');
  if (!/isCaseClient/.test(grant)) return;
  for (let k = i; k >= 0; k--) {
    const m = lines[k].match(/^\s*match (\S+) \{/);
    if (m) { clientWrites.push(m[1]); break; }
  }
});
ck('P7 a client can only write into uploads/ and chat-files/, never prep/',
  clientWrites.length > 0 && clientWrites.every((p2) => /\/(uploads|chat-files)\//.test(p2)),
  clientWrites.join(' '));
// Comments stripped first. The word "prep" DOES appear in this file, in the
// comment explaining why the client-readable list is four named folders and
// not a wildcard: "one manual upload of working notes or a prep sheet into
// that prefix and it would be on their screen." That sentence is the reason
// the shelf is safe, not a hole in it, and a check that trips over it is
// checking the wrong thing.
const RULE_CODE = RULES.split('\n').filter((ln) => !/^\s*\/\//.test(ln)).join('\n');
ck('P7b no RULE names prep, so no grant can reach it',
  !/prep/.test(RULE_CODE), 'prep appears in a rule, not just a comment');

// ---- the page writes where it says it does -------------------------------
ck('P8 the shelf uploads to prep/, matching the rule it relies on',
  /const PREP_DIR = 'prep';/.test(ADMIN));
ck('P9 and it builds that path under this case, not a guessable one',
  /cases\/\$\{caseId\}\/\$\{PREP_DIR\}\//.test(ADMIN), 'upload path');

// ---- the shelf is NOT folded into the client-facing listing --------------
// listCaseFiles feeds the Uploads page, which mirrors what a client sees. If
// prep ever appears in its folder list, his private documents surface there.
//
// The match was pinned to `listCaseFiles()` with an EMPTY argument list, and
// went red on 2026-08-26 when the function correctly grew an options argument
// (`{ onProgress }`, so a slow listing can say how far along it is instead of
// looking hung). A signature it could not match made `listBody` the empty
// string, which the length guard below reported as a failure. That is the
// right outcome for a check that has lost sight of its target, and the reason
// the guard is there.
//
// The RULE is unchanged and the check is unchanged: this listing must never
// walk prep/. Only the way the body is LOCATED is looser, so the next honest
// signature change does not read as a privacy regression. It still fails
// loudly if the function is renamed or removed, and the detail now says which
// of the two things went wrong.
const listBody = (ADMIN.match(/async function listCaseFiles\b[\s\S]*?\n}/) || [''])[0];
ck('P10 the client-facing file listing never walks prep/',
  listBody.length > 0 && !/prep/.test(listBody),
  listBody.length ? 'prep found in listCaseFiles' : 'could not find listCaseFiles at all');
ck('P11 and the private listing is a separate function',
  /async function listPrep\(\)/.test(ADMIN));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
