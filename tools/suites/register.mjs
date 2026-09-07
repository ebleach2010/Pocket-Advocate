// register.mjs - a seasoned colleague on everything he reads.
//
//   node tools/suites/register.mjs
//
// Eric, 2026-09-07: "the advisor's language is driving me insane. Some turns
// of phrase make no sense. He needs personality, and some of his direct
// 'orders' are not advisor language. He'll say things like 'Two things: this
// and this, faxed today.' It's fucking annoying." Asked how it should sound,
// he chose a seasoned colleague: its own personality, full sentences, warm
// and dry, opinions stated as opinions, advice rather than orders.
//
// What this holds: both briefs (the client case and his own) describe that
// colleague and no longer say "short bits, never essays"; the register note
// says whole sentences, advice in the first person with its reason, never an
// order, and names the telegram as the shape never written; the bullets in
// the capped sections are whole sentences; the study's profile of how he
// writes still rides, to read him right, not to imitate him; and the version
// notes say so in words a client may read. selfcase.mjs S52, S53 and S55
// hold the note and the own-case brief in detail.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const ADV = f('worker/advisor.js');
const CL = f('public/js/changelog.js');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
const between = (src, a, b) => {
  const i = src.indexOf(a);
  if (i < 0) return '';
  const k = src.indexOf(b, i + a.length);
  return k < 0 ? '' : src.slice(i, k);
};
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
const DASH = /[—–]/;
const VOICE = between(ADV, 'const VOICE = `', 'const SELF_VOICE = `');
const SELF_VOICE = between(ADV, 'const SELF_VOICE = `', 'const voice = ()');
const registerFn = lift(ADV, 'function registerNote(style) {');
const registerRun = registerFn ? new Function(`${registerFn}; return registerNote;`)() : null;
const bare = registerRun ? registerRun({}) : '';
const voiced = registerRun ? registerRun({ voice: 'Short lines. Starts with the point. Never says "reach out".' }) : '';

// ---- R1: the two briefs -----------------------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): VOICE's `You advise; he decides.` changed to `You decide.` made this read
//   FAIL  R1 both briefs describe a seasoned colleague with opinions and their reasons who advises and never orders, in whole sentences, with the telegram named as the shape never written; neither says short bits or five short lines any more; both keep plain words and the dash ban
check('R1 both briefs describe a seasoned colleague with opinions and their reasons who advises and never orders, in whole sentences, with the telegram named as the shape never written; neither says short bits or five short lines any more; both keep plain words and the dash ban',
  !!VOICE && !!SELF_VOICE
  && /a seasoned colleague who has\ndone this work for twenty years, dry, warm, direct, with opinions and the\nreasons for them/.test(VOICE)
  && /You advise; he decides\./.test(VOICE) && /"Two things: this and\nthis, faxed today\." is exactly the shape you never write\./.test(VOICE)
  && /a blunt read still comes in whole sentences/.test(VOICE)
  && /Brief, and whole: short\nparagraphs of complete sentences, never a telegram\./.test(VOICE)
  && !/Short bits, never essays/.test(VOICE) && !/Five short lines beat twenty/.test(VOICE)
  && /The same seasoned colleague talks to him here, about him/.test(SELF_VOICE)
  && /You advise; he\ndecides\. Second person, plain, direct, and never an order or a telegram\./.test(SELF_VOICE)
  && /Whole sentences, concrete dates, plain\nwords\./.test(SELF_VOICE)
  && /Brief, and\nwhole: short paragraphs of complete sentences, never a telegram\./.test(SELF_VOICE)
  && !/Short bits/.test(SELF_VOICE) && !/Talk to him the way he talks/.test(SELF_VOICE)
  && (ADV.match(/no figures of speech, no metaphors, no clever/g) || []).length >= 2
  && /never use an em dash or en dash/.test(VOICE) && /never use an em dash or en dash/.test(SELF_VOICE)
  && !DASH.test(VOICE) && !DASH.test(SELF_VOICE));

// ---- R2: the note and the bullets --------------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the self assessment's `each one whole sentence` put back to `one line each` made this read
//   FAIL  R2 the register note runs, reads him right without imitating him, and the bullets in the capped sections of both assessments are whole sentences
check('R2 the register note runs, reads him right without imitating him, and the bullets in the capped sections of both assessments are whole sentences',
  !!registerRun && /You advise; he decides\./.test(bare)
  && /This is how he writes, from a study of his own messages\. It is here so you read him right and meet him where he is, not so you imitate him:/.test(voiced)
  && !/This is how he writes/.test(bare) && !/match it in everything you write to him/.test(voiced)
  && /Every\nbullet in every capped section is one whole sentence, 25 words or fewer\./.test(ADV)
  && (ADV.match(/"What this could be": at most 4 bullets, each one whole sentence: the possibility, then the/g) || []).length === 2
  && !/"What this could be": at most 4 bullets, one line each/.test(ADV)
  && !DASH.test(registerFn));

// ---- R3: the version notes -----------------------------------------------------
// NEGATIVE CONTROL (run 2026-09-07): the 3.3 note's "rather than an order" changed to "as an order" made this read
//   FAIL  R3 the version notes say what changed in words a client may read: whole sentences, an opinion with its reason, a suggestion rather than an order, and no dash in them
const entry = (CL.match(/version: '3\.3',[\s\S]*?\n  \},/) || [''])[0];
check('R3 the version notes say what changed in words a client may read: whole sentences, an opinion with its reason, a suggestion rather than an order, and no dash in them',
  !!entry && /whole sentences/.test(entry) && /rather than an order/.test(entry) && /seasoned colleague/.test(entry)
  && !/\badvisor\b/i.test(entry) && !DASH.test(entry));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
