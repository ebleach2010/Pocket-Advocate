// dictionary.mjs - the dictionary whole, the door that says so, and a draft
// that lands in the demo.
//
//   node tools/suites/dictionary.mjs
//
// Eric, 2026-09-06: "Since his implementation some things have broken.
// Drafting has stopped working. Tapping on a term does not bring me to it in
// the dictionary."
//
// What was wrong with the term: the reading paints every [[term]] it wrote,
// but the dictionary page read ONE page of three hundred terms by slug, so
// once the dictionary grew past that (a fifty-message rare-disease read
// logs a lot of words) every term past the three hundredth was simply not
// on the page he was sent to, and the page landed at the top, silently.
// What this holds: every dictionary read walks every page; the page says
// "not yet" with the word he tapped when it holds no such term; the doors
// (painted mark, Key terms link) and the page normalise a term the same
// way; the demo serves the same terms to the dictionary and lands a draft
// so both doors can be driven; and the keyed diag carries the draft state
// and the dictionary's size, so "drafting stopped" is readable from outside.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const W = f('worker/index.js');
const DICT = f('public/js/admin-dictionary.js');
const P = f('public/js/advisor.js');
const DEMO = f('public/js/demo/api.js');
const DRIVE = f('tools/drives/drive-terms.mjs');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

// ---- the reads ------------------------------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the dictionary route's `all: true` removed made this read
//   FAIL  K1 every dictionary read walks every page: the dictionary route, the panel's glossary and the diag count all ask for all pages, and no first-page-only read of the dictionary is left in the Worker
check('K1 every dictionary read walks every page: the dictionary route, the panel\'s glossary and the diag count all ask for all pages, and no first-page-only read of the dictionary is left in the Worker',
  (W.match(/listDocs\(env, 'advisorKnowledge', \{ pageSize: 300, all: true \}\)/g) || []).length === 3
  && !/listDocs\(env, 'advisorKnowledge', \{ pageSize: \d+ \}\)/.test(W)
  && /const rows = await listDocs\(env, 'advisorKnowledge', \{ pageSize: 300, all: true \}\)\.catch\(\(\) => \[\]\);\n  return json\(\{\n    terms: rows\.map/.test(W)
  && /listDocs\(env, 'advisorKnowledge', \{ pageSize: 300, all: true \}\)\.catch\(\(\) => \[\]\),\n    getDoc\(env, `\$\{parent\}\/\$\{id\}\/private\/notes`\)/.test(W),
  String((W.match(/listDocs\(env, 'advisorKnowledge'[^\n]*/g) || []).join(' | ')));

// ---- the page and its doors -----------------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the page's `el.prepend(note);` changed to `el.append(note);` made this read
//   FAIL  K2 the dictionary page lands lit on the term it was sent to, says "not in your dictionary yet" with the word at the top when it holds no such term, and the painted mark, the Key terms link and the page normalise a term the same way
check('K2 the dictionary page lands lit on the term it was sent to, says "not in your dictionary yet" with the word at the top when it holds no such term, and the painted mark, the Key terms link and the page normalise a term the same way',
  /hit\.classList\.add\('dict-hit'\);\n\s+hit\.scrollIntoView\(\{ block: 'center' \}\);/.test(DICT)
  && /\} else \{\n[\s\S]{0,700}?note\.setAttribute\('data-dict-missing', ''\);\n\s+note\.textContent = `"\$\{want\}" is not in your dictionary yet\. Terms arrive a little after the reading that first used them\.`;\n\s+el\.prepend\(note\);\n\s+\}/.test(DICT)
  && /const m = e\.target\.closest\?\.\('mark\.tm\[data-tm\]'\);\n\s+if \(m\) location\.href = `\/admin-dictionary\.html#k=\$\{encodeURIComponent\(m\.dataset\.tm\)\}`;/.test(P)
  && /<a class="term-jump" href="\/admin-dictionary\.html#k=\$\{encodeURIComponent\(termKey\(g\.term\)\)\}">/.test(P)
  && (P.match(/\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\+\/g, ' '\)\.trim\(\)/g) || []).length >= 2
  && /const norm = \(s\) => String\(s\)\.toLowerCase\(\)\.replace\(\/\[\^a-z0-9\]\+\/g, ' '\)\.trim\(\);/.test(DICT)
  // The new line a person reads carries no dash (the file's older comments are not this push's).
  && !/[—–]/.test((DICT.match(/is not in your dictionary yet[^\n]*/) || [''])[0]));

// ---- the demo, so both doors can be driven --------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the demo's draft landing `typeof state.draftPending === 'string'` changed to `=== 'number'` made this read
//   FAIL  K3 the demo serves the dictionary page the same terms the reading paints and flips a tick, answers Prepare a response by marking the run and landing the draft on the next poll a few seconds later, refuses his own case the way the Worker does, and the drive walks both doors
check('K3 the demo serves the dictionary page the same terms the reading paints and flips a tick, answers Prepare a response by marking the run and landing the draft on the next poll a few seconds later, refuses his own case the way the Worker does, and the drive walks both doors',
  /if \(path === '\/api\/advisor\/dictionary'\) \{\n\s+if \(init\.method === 'POST'\) \{[\s\S]{0,500}?\.filter\(\(\[p\]\) => p\.startsWith\('advisorKnowledge\/'\)\)/.test(DEMO)
  && !/if \(path === '\/api\/advisor\/dictionary'\) return ok\(\{ terms: \[\] \}\);/.test(DEMO)
  && /if \(body\.action === 'draft'\) \{\n\s+const c = store\.docs\.get\(`cases\/\$\{cid\}`\) \|\| \{\};\n\s+if \(c\.self\) return fail\(409, 'Your own case has nobody to write to\.'\);/.test(DEMO)
  && /draftStatus: 'running', draftError: null, draftStartedAt: new Date\(\), draftProgressAt: new Date\(\),\n\s+draftPending: rough/.test(DEMO)
  && /if \(state\.draftStatus === 'running' && typeof state\.draftPending === 'string'\n\s+&& Date\.now\(\) - new Date\(state\.draftQueuedAt \|\| 0\)\.getTime\(\) > 2500\) \{\n\s+state = \{\n\s+\.\.\.state,\n\s+draft: state\.draftPending, draftStatus: 'ready', draftError: null, draftAt: new Date\(\),/.test(DEMO)
  && /if \(onOwnCase\(\)\) return json\(\{ error: 'Your own case has nobody to write to\.' \}, 409\);/.test(W)
  && /await page\.click\('mark\.tm\[data-tm\]'\);/.test(DRIVE) && /\.gloss-item\.dict-hit/.test(DRIVE)
  && /#k=no%20such%20term/.test(DRIVE) && /#pa-prep \[data-go\]/.test(DRIVE)
  && /title="Make what I typed a full message"/.test(DRIVE) && /nobody to write to/.test(DRIVE));

// ---- the diag, so "drafting stopped" is readable from outside --------------
// NEGATIVE CONTROL (run 2026-09-07): the diag's `draftAgeS: age(d.draftStartedAt),` removed made this read
//   FAIL  K4 the keyed diag carries the draft state per case (status, age, error), the dictionary's size, and which rows are his own case or the showcase, with no id and no term
check('K4 the keyed diag carries the draft state per case (status, age, error), the dictionary\'s size, and which rows are his own case or the showcase, with no id and no term',
  /draftStatus: d\.draftStatus \|\| null,\n\s+draftAgeS: age\(d\.draftStartedAt\),\n\s+draftError: d\.draftError \? String\(d\.draftError\)\.slice\(0, 140\) : null,\n\s+\}\);/.test(W)
  && /knowledgeCount: knowledgeRows\.length,/.test(W)
  // Re-pinned 2026-09-07 (charge on approval): the hold's state rides
  // between the two flags and the status, a word and no id.
  && /self: !!c\.data\.self, showcase: !!c\.data\.showcase,\n[\s\S]{0,300}?charge: c\.data\.charge\?\.state \|\| null,\n\s+status: d\.status \|\| null, stage: d\.stage \|\| null,/.test(W)
  && !/states\.push\(\{[\s\S]{0,1600}?\bid: c\.id/.test(W));

// ---- the draft that died on arrival ---------------------------------------
// What the diag then showed (2026-09-07): two cases with draftStatus 'error'
// and "voice2 is not a function". The draft writer builds its system block
// from voice(), the shared block that picks the register by case, inside a
// function that already held a local `voice`, the thread's sample of his
// messages; the local shadowed the function and every draft failed the
// moment it started. The local is hisVoice now, and this scans every
// function in the file for the same shadow: a body that calls voice() must
// not bind a local named voice.
{
  const ADV = f('worker/advisor.js');
  // Code only: comments talk about `const voice` and `voice()` in words, and
  // the one legitimate top-level definition of voice() is not a shadow.
  const code = ADV
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/[^\n]*/gm, '$1')
    .replace(/const voice = \(\) => \(turnPolicy\.getStore\(\)\?\.self \? SELF_VOICE : VOICE\);/, '');
  const heads = [...code.matchAll(/^(?:export )?(?:async )?function \w+\(/gm)].map((m) => m.index);
  const shadowed = [];
  for (let i = 0; i < heads.length; i++) {
    const body = code.slice(heads[i], heads[i + 1] ?? code.length);
    if (/\bvoice\(\)/.test(body) && /\b(?:const|let|var) voice\b/.test(body))
      shadowed.push(body.slice(0, body.indexOf('(')));
  }
  // NEGATIVE CONTROL (run 2026-09-07): runDraft's `const hisVoice = myVoice(rows);` changed back to `const voice = myVoice(rows);` made this read
  //   FAIL  K5 the draft writer reads the thread's sample of his messages as hisVoice and builds its system block from the shared voice() block, and no function in the file that calls voice() binds a local named voice
  check('K5 the draft writer reads the thread\'s sample of his messages as hisVoice and builds its system block from the shared voice() block, and no function in the file that calls voice() binds a local named voice',
    /const hisVoice = myVoice\(rows\);/.test(ADV)
    && /const elsewhere = \(!turnPolicy\.getStore\(\)\?\.self && hisVoice\.length < 2500\)/.test(ADV)
    && /<his_voice>\\n\$\{hisVoice \|\| '\(nothing in this thread yet/.test(ADV)
    && /const voice = \(\) => \(turnPolicy\.getStore\(\)\?\.self \? SELF_VOICE : VOICE\);/.test(ADV)
    && heads.length > 50 && shadowed.length === 0,
    shadowed.length ? `shadowed in: ${shadowed.join(', ')}` : `${heads.length} functions scanned`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
