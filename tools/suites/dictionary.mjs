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
const DASH = /[—–]/;
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  let inTpl = false;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '`') { inTpl = !inTpl; continue; }
    if (inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

// ---- the reads ------------------------------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the dictionary route's `all: true` removed made this read
//   FAIL  K1 every dictionary read walks every page: the dictionary route, the panel's glossary and the diag count all ask for all pages, and no first-page-only read of the dictionary is left in the Worker
check('K1 every dictionary read walks every page: the dictionary route, the panel\'s glossary and the diag count all ask for all pages, and no first-page-only read of the dictionary is left in the Worker',
  // Re-pinned 2026-09-07: the wipe door is the fourth whole-dictionary read.
  // Re-pinned 2026-09-09: the panel's glossary read is HELD FOR A MINUTE per
  // isolate now, after the database began refusing reads over quota and one
  // open panel turned out to be re-reading the whole dictionary several times
  // a minute. It still walks every page when it does read; what changed is
  // how often, not how much.
  (W.match(/listDocs\(env, 'advisorKnowledge', \{ pageSize: 300, all: true \}\)/g) || []).length === 4
  && !/listDocs\(env, 'advisorKnowledge', \{ pageSize: \d+ \}\)/.test(W)
  && /const rows = await listDocs\(env, 'advisorKnowledge', \{ pageSize: 300, all: true \}\)\.catch\(\(\) => \[\]\);\n  return json\(\{\n    terms: rows\.map/.test(W)
  && /slowRead\('knowledge', \(\) => listDocs\(env, 'advisorKnowledge', \{ pageSize: 300, all: true \}\)\.catch\(\(\) => \[\]\)\),\n    getDoc\(env, `\$\{parent\}\/\$\{id\}\/private\/notes`\)/.test(W)
  && /const SLOW_TTL_MS = 60_000;/.test(W) && /const QA_PAGE = 5;/.test(W),
  String((W.match(/listDocs\(env, 'advisorKnowledge'[^\n]*/g) || []).join(' | ')));

// ---- the page and its doors -----------------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the page's `el.prepend(note);` changed to `el.append(note);` made this read
//   FAIL  K2 the dictionary page lands lit on the term it was sent to, says "not in your dictionary yet" with the word at the top when it holds no such term, and the painted mark, the Key terms link and the page normalise a term the same way
check('K2 the dictionary page lands lit on the term it was sent to, says "not in your dictionary yet" with the word at the top when it holds no such term, and the painted mark, the Key terms link and the page normalise a term the same way',
  /hit\.classList\.add\('dict-hit'\);\n\s+hit\.scrollIntoView\(\{ block: 'center' \}\);/.test(DICT)
  // Re-pinned 2026-09-07 (only what came up): the line says how a term gets
  // in, since the reading's own words no longer put one there.
  && /\} else \{\n[\s\S]{0,700}?note\.setAttribute\('data-dict-missing', ''\);\n\s+note\.textContent = `"\$\{want\}" is not in your dictionary\. A term is added when it comes up in your chat, in a question you ask or the answer you get, or in a document, a little after the reading that met it there\.`;\n\s+el\.prepend\(note\);\n\s+\}/.test(DICT)
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

// ---- only what came up (Eric, 2026-09-07) -----------------------------------
// "We have by no means spoken about all of those, either with the advisor or
// client. It seems to just be pulling related terms, not ones always
// discussed." A term lands only when a person wrote it (the chat, his
// questions, the answers he got) or a read document carries it by name.
{
  const ADV = f('worker/advisor.js');
  const W2 = f('worker/index.js');
  const CFG = f('wrangler.jsonc');
  const parts = ['function normText(s) {', 'function personMaterial(rows = [], qa = [], extra = []) {',
    'function termMentioned(term, material) {', 'function termCameUp(term, from, material, docNames) {',
    'function sectionMatch(text, name) {',
    'async function harvestKeyTerms(env, text, { material = null, docNames = [] } = {}) {']
    .map((d) => lift(ADV, d));
  // termSlug is an arrow, lifted by its shape rather than by braces.
  parts.push((ADV.match(/const termSlug = \(term\) =>[\s\S]*?\.slice\(0, 60\);/) || [''])[0]);
  const made = [];
  const fakes = {
    patchDoc: async (env, path, data, opts) => { made.push({ path, data, opts }); return true; },
    getDoc: async () => null,
  };
  const built = new Function('patchDoc', 'getDoc', `${parts.join('\n')}\nreturn { harvestKeyTerms, personMaterial, termMentioned, termCameUp };`);
  const lib = parts.every(Boolean) ? built(fakes.patchDoc, fakes.getDoc) : null;
  const text = ['## Right now', 'blah', '## Key terms',
    '- Myasthenia gravis [Condition]: a muscle weakness disease | Mechanism: x | Treatment: y | Outlook: z | From: chat',
    '- Ferritin [Test or lab]: iron in storage | From: document labs-march.pdf',
    '- Sarcoidosis [Condition]: granulomas | Mechanism: a | Treatment: b | Outlook: c | From: answer',
    '- Paresthesia [Symptom]: pins and needles',
    '## Working line', 'x'].join('\n');
  const rows = [
    { data: { role: 'client', text: 'My neurologist mentioned Myasthenia Gravis last week.' } },
    { data: { role: 'question', from: 'reading', text: 'Do you have sarcoidosis?' } },
  ];
  const qa = [{ data: { question: 'what about the ferritin?', answer: 'Low, and worth a recheck.' } }];
  let out = null; let legacy = null; let names = []; let legacyNames = [];
  if (lib) {
    const material = lib.personMaterial(rows, qa);
    out = await lib.harvestKeyTerms({}, text, { material, docNames: ['cases/x/uploads/labs-march.pdf'] });
    names = made.map((x) => x.path);
    made.length = 0;
    legacy = await lib.harvestKeyTerms({}, text);
    legacyNames = made.map((x) => x.path);
  }
  const tm = lib ? [
    lib.termMentioned('MRI', 'he had an mri on tuesday'),
    lib.termMentioned('Migraine', 'his migraines started in march'),
    lib.termMentioned('Magnetic resonance imaging (MRI)', 'an mri yesterday'),
    !lib.termMentioned('ANA', 'banana bread for breakfast'),
    !lib.termMentioned('Sarcoidosis', 'nothing here'),
    lib.termCameUp('Ferritin', 'document labs-march.pdf', '', ['cases/x/uploads/labs-march.pdf']),
    !lib.termCameUp('Ferritin', 'document labs-march.pdf', '', ['cases/x/uploads/mri.pdf']),
    !lib.termCameUp('Ferritin', 'answer', '', ['cases/x/uploads/labs-march.pdf']),
  ] : [];
  // NEGATIVE CONTROL (run 2026-09-07): the harvester's `if (material !== null && !termCameUp(...)) continue;` changed to `if (false) continue;` made this read
  //   FAIL  K6 the harvester keeps a term the client or Eric wrote, a term his question or the answer holds, and a term the reading says came from a document that was actually read by that name; it drops a term only the reading spoke (its own question in the chat included) and a term with no From, strips the section either way, and a caller with no material keeps the old open behaviour; whole words only, plurals and a parenthesised acronym allowed
  check('K6 the harvester keeps a term the client or Eric wrote, a term his question or the answer holds, and a term the reading says came from a document that was actually read by that name; it drops a term only the reading spoke (its own question in the chat included) and a term with no From, strips the section either way, and a caller with no material keeps the old open behaviour; whole words only, plurals and a parenthesised acronym allowed',
    !!lib && names.length === 2 && names.includes('advisorKnowledge/myasthenia-gravis') && names.includes('advisorKnowledge/ferritin')
    && !/Key terms/.test(out) && /## Working line/.test(out)
    && legacyNames.length === 4 && legacyNames.includes('advisorKnowledge/sarcoidosis') && legacyNames.includes('advisorKnowledge/paresthesia') && !/Key terms/.test(legacy)
    && tm.length === 8 && tm.every(Boolean)
    && /material: personMaterial\(rows, qaRows\),\n\s+docNames: \[\.\.\.\(m\.included \|\| \[\]\), \.\.\.alreadyRead\],/.test(ADV)
    && /material: personMaterial\(rows, qa, \[question, answer\]\),\n\s+docNames: attachment\?\.name \? \[attachment\.name\] : \[\],/.test(ADV)
    && /loadQa\(env, kind, id, \{ full: true \}\)\.catch\(\(\) => \[\]\),\n\s+\]\);\n\s+const p = state\?\.data \|\| \{\};/.test(ADV),
    JSON.stringify({ names, legacyNames, tm }));

  // The doors and the words: the three prompts say only what came up and
  // ask where, the wipe door empties the dictionary whole, the panel paints
  // only terms the dictionary holds, and the page says how a term gets in.
  const block = (W2.match(/if \(url\.searchParams\.get\('do'\) === 'wipe-terms'\) \{[\s\S]*?return json\(\{ ok: true, total: rows\.length, deleted \}\);\n\s+\}/) || [''])[0];
  const calls = { list: 0, del: [] };
  let wiped = null;
  if (block) {
    const run = new Function('url', 'env', 'listDocs', 'batchDelete', 'json', `return (async () => { ${block} return null; })();`);
    wiped = await run(new URL('https://x.test/api/diag?k=x&do=wipe-terms'), {},
      async () => { calls.list++; return [{ id: 'a' }, { id: 'b' }, { id: 'c' }]; },
      async (env, paths) => { calls.del.push(...paths); return { deleted: paths.length }; },
      (o, s = 200) => ({ o, s })).catch((e) => ({ err: String(e) }));
  }
  // NEGATIVE CONTROL (run 2026-09-07): the panel's `if (!inBook.has(k)) terms.delete(k);` changed to `if (inBook.has(k))` made this read
  //   FAIL  K7 both readings and the answer ask only for a term that came up and where it came up, the wipe door lists every term and deletes each one, the panel paints only terms the dictionary holds and redraws when it grows, and the dictionary page says how a term gets in
  check('K7 both readings and the answer ask only for a term that came up and where it came up, the wipe door lists every term and deletes each one, the panel paints only terms the dictionary holds and redraws when it grows, and the dictionary page says how a term gets in',
    (ADV.match(/ONLY A TERM THAT CAME UP IN THE CASE/g) || []).length === 2
    && /AND that came up in the case: in the chat, in his question, in this\nanswer, or in a document\. Never one you only thought of\./.test(ADV)
    && (ADV.match(/\| From: chat/g) || []).length >= 3 && (ADV.match(/A line with no From is dropped unread\./g) || []).length === 2
    && !!block && wiped?.s === 200 && wiped.o.total === 3 && wiped.o.deleted === 3 && calls.list === 1
    && JSON.stringify(calls.del) === JSON.stringify(['advisorKnowledge/a', 'advisorKnowledge/b', 'advisorKnowledge/c'])
    && /const inBook = new Set\(glossary\.map\(\(g\) => termKey\(g\.term\)\)\);\n\s+for \(const k of \[\.\.\.terms\.keys\(\)\]\) if \(!inBook\.has\(k\)\) terms\.delete\(k\);/.test(P)
    && /const key = `\$\{pagesKey\}\|\$\{pageIdx\}\|\$\{pages\.length\}\|\$\{learned\.size\}\|\$\{glossary\.length\}`;/.test(P)
    && /is not in your dictionary\. A term is added when it comes up in your chat/.test(DICT),
    JSON.stringify({ wiped, calls }));

  // The cut stream and the stale failure (Eric, 2026-09-07: "The server
  // answered with something this page could not read"; "I get Draft failed:
  // voice2 is not a function still").
  // Re-pinned 2026-09-07 (v3.4): the CPU limit line was withdrawn, the two
  // builds that carried it never deployed; the config must carry no limits.
  // Re-pinned 2026-09-07 (v3.5): qaLast also says whether the newest question
  // is on the batch and how long since anyone polled it (askflight.mjs).
  // NEGATIVE CONTROL (run 2026-09-07): the panel's `return { ok: true, cut: true };` changed to `return null;` made this read
  //   FAIL  K8 an answer records its start, its end and its failure on the flight recorder, the diag carries the newest question's state, the Worker config carries no limits block, a stale failure from the fixed bug is cleared once on the next read, a draft failure repaints for a day and no longer, and a stream cut short with a 200 is treated as work still going rather than an answer that failed
  check('K8 an answer records its start, its end and its failure on the flight recorder, the diag carries the newest question\'s state, the Worker config carries no limits block, a stale failure from the fixed bug is cleared once on the next read, a draft failure repaints for a day and no longer, and a stream cut short with a 200 is treated as work still going rather than an answer that failed',
    /await diagLog\(env, \{ ev: 'ask-start', kind, self \}\)\.catch\(\(\) => \{\}\);\n\s+try \{/.test(ADV)
    && /await diagLog\(env, \{ ev: 'ask-end', ok: true, kind, ms: Date\.now\(\) - t0 \}\)/.test(ADV)
    && /await diagLog\(env, \{ ev: 'ask-end', ok: false, kind, ms: Date\.now\(\) - t0, err: String\(err\.message \|\| err\)\.slice\(0, 140\) \}\)/.test(ADV)
    && /qaLast: q \? \{ status: q\.status \|\| null, ageS: age\(q\.at\), error: q\.status === 'error' \? String\(q\.answer \|\| ''\)\.slice\(0, 140\) : null,\n(?:\s+\/\/[^\n]*\n)*\s+batch: !!q\.batch\?\.batchId, beatAgeS: age\(q\.progressAt\) \} : null,/.test(W2)
    && !/"limits"\s*:/.test(CFG) && /No "limits" block here/.test(CFG)
    && /if \(state\?\.data\.draftStatus === 'error' && \/is not a function\/\.test\(String\(state\.data\.draftError \|\| ''\)\)\) \{\n\s+await patchDoc\(env, `\$\{parent\}\/\$\{id\}\/advisor\/state`, \{ draftStatus: null, draftError: null \},\n\s+\{ mask: \['draftStatus', 'draftError'\] \}\)\.catch\(\(\) => \{\}\);/.test(W2)
    && /const dFresh = dFailedAt && Date\.now\(\) - toDate\(dFailedAt\)\.getTime\(\) < 24 \* 3600_000;\n\s+if \(d\.draftStatus === 'error' && d\.draftError && dFresh\) \{/.test(P)
    && /if \(res\.ok\) \{\n\s+showErr\('The connection was cut while the server was still working\. That does not stop it: '\n[^\n]*\n\s+setTimeout\(refresh, 2000\);\n\s+return \{ ok: true, cut: true \};\n\s+\}\n\s+throw new Error\(`The server refused that \(\$\{res\.status\}\)\.`\);/.test(P)
    && !DASH.test((P.match(/The connection was cut while the server was still working[^\n]*\n[^\n]*/) || [''])[0]));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
