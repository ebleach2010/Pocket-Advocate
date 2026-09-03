// uploads.mjs - the documents he writes himself, labelled, and the collision
// that would have eaten them.
//
// Eric, 2026-08-27: "All SOAP notes and visit f/u summaries are done through
// uploads. I simply need an upload type to separate the category. So they're
// labeled. 'Call Summaries,' for example. They get notified that I uploaded
// [file name]."
//
// He writes the document. NOTHING here generates, summarises or reads
// anything, and nothing may ever grow a path that does.
//
// THE FIRST CHECK IS THE ONE THAT MATTERS. The report input was the only
// upload path in the app with no `${Date.now()}-` prefix, so two files with
// the same name were one file and the first was silently gone. He is about to
// upload many documents called things like "Summary.pdf".
//
// AND THE CATEGORY IS A LABEL, NEVER A FOLDER. storage.rules grants a client
// read on exactly four named folders and prep-shelf.mjs pins that list by
// string equality, because a recursive wildcard once made anything dropped
// under a case instantly client-readable. This suite asserts that nothing here
// went near it.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f(import.meta.url)), '..', '..');
const read = (p) => readFileSync(j(ROOT, p), 'utf8');
const ADMINCASE = read('public/js/admin-case.js');
const CLIENT = read('public/js/case.js');
const WORKER = read('worker/index.js');
const RULES = read('storage.rules');
const CSS = read('public/css/site.css');
const DEMOSTORE = read('public/js/demo/store.js');
const DEMOAPI = read('public/js/demo/api.js');

const results = [];
const ck = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
/** Comments stripped. No build step here, so a comment is a served byte and a
 *  regex looking for the ABSENCE of something finds it in the very comment
 *  that explains why it is absent. */
const bare = (src) => src.split('\n')
  .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');
const slab = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a);
  return b < 0 ? '' : src.slice(a, b + to.length);
};

/**
 * EVERY LIFT, MEASURED, AND THE SIZES PRINTED ON EVERY RUN.
 *
 * A slab that runs past the end of what it meant to capture does not go red.
 * It swallows whatever comes next and the checks below stay green on it,
 * because the extra code is usually inert. That happened here: the
 * sendBlankForms lift ended on '\n  load();\n}', load() later moved inside an
 * `if`, and the slab quietly captured 16,234 characters instead of 5,144
 * through three commits without one check noticing.
 *
 * So "the suite is green" is not the claim worth making about a lift. "The
 * suite is green AND the lift is the size it was" is a different claim, and
 * only the second one survives a merge. The table prints unconditionally so
 * the number is in front of whoever runs this, on the run that changes it
 * rather than three commits later.
 *
 * Proved its keep on 2026-08-28: across a trial merge with the advisor branch
 * every lift here was byte-identical except handleCaseUpdate, which grew 2,145
 * characters. That growth was benign (a set-paid provenance write using only
 * already-stubbed helpers) but it was invisible to a green run.
 */
// HOW MANY LIFTS THERE SHOULD BE, in one place, read by all three checks that
// depend on the registry being populated.
//
// U28j and U28k were leaning on U28i: emptying the registry made U28i fail and
// left BOTH of them green, because a loop over nothing reports nothing wrong.
// That is the same "safe only while its neighbour survives" objection this
// file already makes about U2b, U4 and U3, reproduced in checks added while
// hunting for exactly it. Knowing the shape did not prevent writing it.
//
// One constant rather than three scattered numbers, because a merge that adds
// registrations then has ONE line to move. Deliberately below the current
// count: it guards against a registry that is not really there, and a pin on
// the exact number goes stale the moment somebody adds a lift.
const LIFT_FLOOR = 14;
const LIFTS = new Map();
/**
 * `after` is the SENTINEL: a distinctive string from whatever sits immediately
 * beyond the intended end of this lift. It is what U28j checks, and it is
 * required rather than optional so a new lift cannot skip that check in
 * silence. Adapted from the advisor branch's A30d, with one change for the
 * shape of the lifts here.
 *
 * WHY A SENTINEL AND NOT A TAIL. A30d asserts each lift ENDS the way it
 * should, which is the right rule for a regex lift like handleCaseUpdate
 * where nothing pins the end. Almost every lift here comes from slab(), and
 * slab() returns a string ending in its own `to` marker BY CONSTRUCTION, so a
 * tail assertion on one of those is tautological: it passes just as happily
 * when `to` matched the third occurrence half a file later. What catches THAT
 * is naming the thing that should lie beyond the end and insisting it is not
 * inside. Same idea as A30c, applied to all twelve at once instead of the two
 * that happened to have it written out by hand.
 */
const lifted = (name, text, after, src) => {
  LIFTS.set(name, { size: text.length, after, text, src });
  return text;
};
const liftTable = () => [...LIFTS].map(([k, v]) => `${k} ${v.size}`).join(', ');

// ---- U1-U4: two files with one name must BOTH survive --------------------
// Lifted and run against a Storage stand-in that behaves the way Storage
// behaves: a repeated path overwrites, without a word.
{
  const body = lifted('upload', slab(ADMINCASE, 'async function upload(file, kind, milestoneAction',
    '  bar.hidden = true;\n}'), 'WHAT A DOCUMENT HE UPLOADS IS', ADMINCASE);
  // NEGATIVE CONTROL (all runs 2026-08-28): renaming upload() made this read
  //   FAIL  U1 the upload path lifts out of the shipped page
  // A lift that has lost its target goes red rather than asserting nothing.
  ck('U1 the upload path lifts out of the shipped page', body.length > 0);

  const bucket = new Map();
  const make = () => new Function('__bucket', `
    const document = { getElementById: () => ({ hidden: true, value: 0, textContent: '' }) };
    const storage = {};
    const ref = (_s, path) => ({ path });
    const uploadBytesResumable = (r, file, meta) => {
      __bucket.set(r.path, { name: file.name, meta: meta && meta.customMetadata });
      return { on: (_e, _p, _f, done) => done && done() };
    };
    const api = async () => ({ ok: true });
    const load = () => {};
    const caseId = 'abc';
    const UPLOAD_CATEGORIES = ${JSON.stringify([
    { id: 'report', label: 'Report' },
    { id: 'callsummary', label: 'Call summary' },
  ])};
    ${body}
    return upload;
  `)(bucket);

  const run = async () => {
    const up = make();
    // The same file name twice, a second apart, which is how a run of call
    // summaries actually arrives.
    await up({ name: 'Summary.pdf', size: 10 }, 'report', 'summary-uploaded', 'callsummary');
    await new Promise((r) => setTimeout(r, 5));
    await up({ name: 'Summary.pdf', size: 10 }, 'report', 'summary-uploaded', 'callsummary');
  };
  // Two uploads inside the same millisecond would collide even with the
  // prefix, so this loops until the clock has actually moved rather than
  // asserting on a coin toss.
  let tries = 0;
  while (bucket.size < 2 && tries < 20) { bucket.clear(); await run(); tries += 1; }

  // NEGATIVE CONTROL (run 2026-08-28): removing the `${Date.now()}-` prefix
  // from the upload path made this read
  //   FAIL  U2 ... -- 1 file survived out of 2
  ck('U2 two files with the same name BOTH survive the upload',
    bucket.size === 2, `${bucket.size} file survived out of 2`);
  const paths = [...bucket.keys()];
  // NEGATIVE CONTROL: filing by category instead of by folder made this read
  //   FAIL  U2b ... -- cases/abc/callsummary/1787880535918-Summary.pdf ...
  // which is the exact mistake storage.rules cannot survive.
  // NEGATIVE CONTROL (run 2026-08-28): making the stand-in bucket record
  // nothing made this read PASS before the count was added, and now reads
  //   FAIL  U2b and both are under the case, in the report folder  -- 0 paths:
  // COUNT FIRST, ALWAYS. Added 2026-08-28: this read `paths.every(...)` with
  // nothing requiring paths to have anything in it, so a stand-in bucket that
  // recorded NOTHING passed it. Its neighbour U2 would have caught the empty
  // bucket, and that is exactly the objection: a check that is safe only while
  // the check next to it survives is one deletion away from going quiet.
  ck('U2b and both are under the case, in the report folder',
    paths.length === 2 && paths.every((p) => p.startsWith('cases/abc/report/')),
    `${paths.length} paths: ${paths.join(' ')}`);
  // The display layer has to put the name back, or every file a client reads
  // grows a thirteen-digit number in front of it.
  const shown = (n) => String(n).replace(/^\d{10,}-/, '');
  // Pinned to the LINE THAT RENDERS THE NAME, not to the regex appearing
  // somewhere in the file. The first version tested for the pattern anywhere
  // in case.js and stayed green with the file list's own stripper deleted,
  // because a second copy lives in the delete confirmation. A check that
  // passes when the thing it guards is gone is worse than no check.
  //
  // UPDATED 2026-08-28, not deleted, and deliberately no looser. Eric can now
  // rename a file after it has landed (his words: "I can long press and
  // rename them"), and a Storage object's name cannot be changed, so the name
  // a person reads is resolved by `readName`: the name he typed if he typed
  // one, and otherwise the object name with its upload prefix stripped. The
  // stripping moved one function outward, so the pin moves with it. BOTH
  // halves are still nailed down on both sides - the render line by the call
  // it must make, and the resolver by the strip it must contain - and no part
  // of it can be deleted without this going red.
  // MEASURED, like every other slab in this file. These four were the last
  // unmeasured ones, and U3 is the check with the best reason to be measured:
  // it has already been broken once by a legitimate refactor (the stripping
  // moved one function outward), and a slab whose target moves is exactly the
  // slab that quietly starts capturing the wrong span. The sizes print on
  // every run, so a jump is visible even on a green one.
  const clientName = lifted('shownName', slab(CLIENT, 'const shownName =', "');"),
    'A file long-pressed out of the chat', CLIENT);
  const clientRead = lifted('clientReadName', slab(CLIENT, 'const readName =', ';'),
    'A file long-pressed out of the chat', CLIENT);
  const adminRead = lifted('adminReadName', slab(ADMINCASE, 'const readName =', ';'),
    'Uploads are grouped by day', ADMINCASE);
  const adminName = lifted('adminNameRow', slab(ADMINCASE,
    '<span class="fname"><span class="kind-pill ${pillClass(r)}', '</a></span>'),
  '<span class="fmeta">', ADMINCASE);
  // NEGATIVE CONTROLS, all three run 2026-08-28 and all three observed:
  //   deleting the strip from the client's shownName ->
  //     FAIL  U3 ... -- Summary.pdf Summary.pdf | client strip yes, client render yes
  //   rendering ${readName(r)} bare in the client's row ->
  //     FAIL  U3 ... -- client render no
  //   dropping the strip from the advocate's readName ->
  //     FAIL  U3 ... -- advocate strip no
  const u3 = {
    'client strip': /replace\(\/\^\\d\{10,\}-\//.test(clientName),
    'client resolve': /shownName\(r\.name\)/.test(clientRead),
    'client render': /esc\(readName\(r\)\)/.test(CLIENT),
    'advocate strip': /replace\(\/\^\\d\{10,\}-\//.test(adminRead),
    'advocate render': /esc\(readName\(r\)\)/.test(adminName),
  };
  // U3b EXISTS BECAUSE THE SIZE LINE ALONE IS NOT A GUARD.
  //
  // Ending clientReadName's slab on '</a></span>' instead of its own ';' made
  // it capture 3,514 characters instead of 55, sixty four times its own size,
  // and every check in this file stayed GREEN. The size line showed it to a
  // human reading the output; nothing failed. A number printed beside a pass
  // is a diagnostic, and a diagnostic nobody is reading is not a check.
  //
  // So each of these four is held to its own shape rather than to a number.
  // A number would have to be edited every time the code legitimately moves,
  // which is how a pin becomes something people relax. These are all single
  // statements or one render line, so none of them may contain a second
  // declaration or closing markup: that is what over-running looks like here,
  // and it is true regardless of how long the statement gets.
  //
  // NEGATIVE CONTROL (run 2026-08-28): the same widened slab, which the size
  // line saw and nothing caught, now reads
  //   FAIL  U3b and each of those four stayed inside its own statement
  //         -- clientReadName ran on past its own end
  const strayed = Object.entries({
    shownName: clientName, clientReadName: clientRead,
    adminReadName: adminRead, adminNameRow: adminName,
  }).filter(([name, src]) => (name === 'adminNameRow'
    // The render line is markup by nature, so it is held to carrying exactly
    // one closing anchor rather than to carrying none.
    ? (src.match(/<\/a>/g) || []).length !== 1 || /\bconst\s+\w+\s*=/.test(src)
    : /<\/(a|span|div|p)>/.test(src) || (src.match(/\bconst\s+\w+\s*=/g) || []).length > 1))
    .map(([name]) => `${name} ran on past its own end`);
  ck('U3b and each of those four stayed inside its own statement',
    strayed.length === 0, strayed.join(', '));

  // COUNT FIRST, inline. `paths.every(...)` is vacuously true of an empty
  // array, so with a stand-in bucket that recorded nothing this passed while
  // asserting nothing about stripping. It was covered only because U2b above
  // asserts the same array holds two, and a check that is safe only while its
  // NEIGHBOUR survives is one deletion from going quiet. That was the exact
  // reasoning that turned up A29c and U18 tonight, so the requirement goes
  // where the check is.
  //
  // NEGATIVE CONTROL (run 2026-08-28): a stand-in bucket recording nothing ->
  //   FAIL  U3 and the prefix is stripped where a person reads the name
  //         -- 0 paths |
  ck('U3 and the prefix is stripped where a person reads the name',
    paths.length === 2
    && paths.every((p) => shown(p.split('/').pop()) === 'Summary.pdf')
    && Object.values(u3).every(Boolean),
    `${paths.length ? paths.map((p) => shown(p.split('/').pop())).join(' ') : '0 paths'} | `
      + Object.entries(u3).map(([k, v]) => `${k} ${v ? 'yes' : 'no'}`).join(', '));
  // NEGATIVE CONTROL: dropping the customMetadata argument made this read
  //   FAIL  U4 ... -- [null,null]
  // COUNT FIRST here too, and for the same reason: an empty bucket satisfied
  // `every` and this passed with no file to carry a category at all.
  // NEGATIVE CONTROL (run 2026-08-28): making the stand-in bucket record
  // nothing made this read PASS before the count was added, and now reads
  //   FAIL  U4 the category rides on the file as metadata, and is what he picked  -- 0 files: []
  ck('U4 the category rides on the file as metadata, and is what he picked',
    bucket.size === 2
    && [...bucket.values()].every((v) => v.meta && v.meta.paCategory === 'callsummary'),
    `${bucket.size} files: ${JSON.stringify([...bucket.values()].map((v) => v.meta))}`);
}

// ---- U5-U7: a label, not a folder ---------------------------------------
// This is the rule prep-shelf.mjs exists for, restated from the other side. It
// must stay green with prep-shelf.mjs untouched.
{
  const listed = (RULES.match(/folder in \[([^\]]+)\]/) || [])[1] || '';
  // NEGATIVE CONTROL: adding 'callsummary' to storage.rules made this read
  //   FAIL  U5 ... -- report,recording,uploads,chat-files,callsummary
  // and took prep-shelf.mjs P2 down with it, which is the point.
  ck('U5 no new folder was opened to a client, at all',
    listed.split(',').map((x) => x.trim().replace(/'/g, '')).join()
      === 'report,recording,uploads,chat-files', listed);
  // NEGATIVE CONTROL: reading `cat: ''` instead of the metadata made this read
  //   FAIL  U6 and the category is carried in Storage metadata instead
  ck('U6 and the category is carried in Storage metadata instead',
    /customMetadata: \{ paCategory: category \}/.test(ADMINCASE)
    && /meta\.customMetadata\?\.paCategory/.test(ADMINCASE)
    && /meta\.customMetadata\?\.paCategory/.test(CLIENT));
  // NEGATIVE CONTROL: pointing the client listing at a second metadata call
  // made this read
  //   FAIL  U7 which costs no extra request, because both listings already fetch it
  ck('U7 which costs no extra request, because both listings already fetch it',
    /getMetadata\(item\)/.test(ADMINCASE) && /getMetadata\(item\)/.test(CLIENT));
}

// ---- U8-U11: the two listings agree about what a label MEANS -------------
// The vocabulary lives in two files because one of them is served to clients
// and the other is not. Two copies drift; this is what stops them.
{
  const adminCats = [...ADMINCASE.matchAll(
    /\{ id: '(\w+)', label: '[^']*', pill: '([^']*)', group: '([^']*)', action: '([\w-]+)' \}/g)]
    .map((m) => ({ id: m[1], pill: m[2], group: m[3], action: m[4] }));
  // NEGATIVE CONTROL: deleting the two new categories made this read
  //   FAIL  U8 ... -- 1 found
  //   FAIL  U9 ... -- admin REPORT vs client CALL SUMMARY|REPORT|VISIT FOLLOW-UP
  //   FAIL  U9b ... -- admin report vs client callsummary|report|visitfollowup
  // UPDATED 2026-08-27, not deleted: was `>= 3`. Three more categories landed
  // on Eric's word (the doctor appointment summary, then the form he sends and
  // the same form back), and a floor that stayed at three would have gone
  // green with any two of them dropped on the floor.
  //
  // THE FLOOR IS SHARED, and this is the one list in this suite that comes out
  // of the SHIPPED FILES rather than out of this one. Every list starved in
  // this file until now was its own; a bad merge in admin-case.js or case.js
  // empties these instead, and that is the likelier accident.
  //
  // MEASURED on main, 2026-08-28, by reordering the keys in both declarations
  // so the extracting regexes match nothing:
  //
  //   both empty:   FAIL U8   PASS U9   PASS U9b   FAIL U9c   PASS U9d   PASS U10
  //   client only:  PASS U8   FAIL U9   FAIL U9b   FAIL U9c   PASS U9d   PASS U10
  //
  // AND THE SAME BREAKS AFTER, all three directions:
  //
  //   both empty:   FAIL U8   FAIL U9   FAIL U9b   FAIL U9c   FAIL U9d   FAIL U10
  //   client only:  PASS U8   FAIL U9   FAIL U9b   FAIL U9c   FAIL U9d   PASS U10
  //   admin only:   FAIL U8   FAIL U9   FAIL U9b   PASS U9c   PASS U9d   FAIL U10
  //
  // The passes on the one-sided runs are the point, not a gap: U8 and U10 read
  // the admin list alone and U9c and U9d read the client list alone, so each
  // one holds while ITS side is intact. A blanket floor would have hidden that.
  //
  // HOW THE FIRST ATTEMPT AT THIS MEASUREMENT LIED. The break was a shell
  // quoted python -c whose replacement template failed to compile; python
  // printed a traceback, the shell carried on, and all six checks were then
  // run against a tree nobody had touched. Six PASS lines that meant nothing,
  // which is this file's own subject arriving in the harness written to find
  // it. The break now lives in a script that counts its own matches and exits
  // non-zero if it changed no bytes, and it prints the count it applied.
  //
  // U9 and U9b compare two sorted joins and '' equals ''. U9d compares a Set
  // of nothing against a length of nothing. U10 filters an empty list and
  // finds nothing missing. All four were upheld by U8 standing beside them,
  // which is what A29c in advisor-acts.mjs warns about and what SLAB_FLOOR,
  // ACTION_FLOOR and LIFT_FLOOR were each added for.
  //
  // U10 passing the client-only break is CORRECT and not an instance: it reads
  // the admin list alone, and that list was intact.
  //
  // Each check takes the floor for the list IT reads, not a blanket one, so a
  // one-sided break still fails the checks that span both sides.
  const CAT_FLOOR = 6;
  const adminFault = () => (adminCats.length < CAT_FLOOR
    ? [`${adminCats.length} admin categories, expected at least ${CAT_FLOOR}`] : []);
  ck('U8 the advocate side declares the categories in one place',
    adminCats.length >= CAT_FLOOR, `${adminCats.length} found`);
  const clientCats = [...CLIENT.matchAll(/(\w+): \{ label: '([^']*)', at: (\d+) \}/g)]
    .map((m) => ({ id: m[1], label: m[2], at: Number(m[3]) }));
  // NEGATIVE CONTROL: renaming CALL SUMMARY to CALL NOTE on the client side
  // only made this read
  //   FAIL  U9 ... -- admin CALL SUMMARY|REPORT|VISIT FOLLOW-UP vs client CALL NOTE|REPORT|VISIT FOLLOW-UP
  const clientFault = () => (clientCats.length < CAT_FLOOR
    ? [`${clientCats.length} client categories, expected at least ${CAT_FLOOR}`] : []);
  const bothFault = () => [...adminFault(), ...clientFault()];
  const sorted = (a) => a.slice().sort().join('|');
  ck('U9 and the client\'s pill says exactly the same words for them',
    !bothFault().length
      && sorted(adminCats.map((c) => c.pill)) === sorted(clientCats.map((c) => c.label)),
    bothFault().length ? bothFault().join(', ')
      : `admin ${sorted(adminCats.map((c) => c.pill))} vs client ${sorted(clientCats.map((c) => c.label))}`);
  // NEGATIVE CONTROL: a one-letter case difference on the client side made
  // this read
  //   FAIL  U9b ... -- admin callsummary|report|visitfollowup vs client callsummary|report|visitfollowUp
  ck('U9b and the same ids, so a stored label cannot land on nothing',
    !bothFault().length
      && sorted(adminCats.map((c) => c.id)) === sorted(clientCats.map((c) => c.id)),
    bothFault().length ? bothFault().join(', ')
      : `admin ${sorted(adminCats.map((c) => c.id))} vs client ${sorted(clientCats.map((c) => c.id))}`);
  // THE OFF-BY-ONE THIS MAP INVITES EVERY TIME IT GROWS. The client's list is
  // sorted by rank: the document categories take 0 upward and everything else
  // (recording, upload, chat, saved) starts after them. Add a category without
  // pushing `order` down and the new one collides with the recording, so a
  // form sorts in among an hour of video. Lifted from the shipped file and
  // compared as numbers, because that is the only form the bug takes.
  const orderLine = (CLIENT.match(/const order = \{([^}]*)\};/) || ['', ''])[1];
  const orderVals = [...orderLine.matchAll(/(\w+): (\d+)/g)]
    .map((m) => ({ k: m[1], v: Number(m[2]) })).filter((o) => o.k !== 'report');
  const catRanks = clientCats.map((c) => c.at);
  // NEGATIVE CONTROL (run 2026-08-27): putting `order` back to recording 4
  // while the categories ran 0 to 5 made this read
  //   FAIL  U9c ... -- categories reach 5, recording sits at 4
  ck('U9c a document category never sorts in among the recordings',
    catRanks.length > 0 && orderVals.length > 0
      && Math.max(...catRanks) < Math.min(...orderVals.map((o) => o.v)),
    `categories reach ${Math.max(...catRanks)}, ${orderVals.sort((a, b) => a.v - b.v)[0]?.k} sits at ${Math.min(...orderVals.map((o) => o.v))}`);
  // NEGATIVE CONTROL (run 2026-08-27): giving two categories the same `at`
  // made this read
  //   FAIL  U9d ... -- 6 categories, 5 distinct ranks
  ck('U9d and no two categories claim the same place in the list',
    !clientFault().length && new Set(catRanks).size === catRanks.length,
    clientFault().length ? clientFault().join(', ')
      : `${catRanks.length} categories, ${new Set(catRanks).size} distinct ranks`);
  // Every group name a category can produce has to exist in FILE_GROUPS, or
  // the file renders under a heading the page never prints and vanishes.
  const groups = (ADMINCASE.match(/const FILE_GROUPS = \[[\s\S]*?\];/) || [''])[0];
  // NEGATIVE CONTROL: dropping 'Visit follow-ups' from FILE_GROUPS made this
  // read
  //   FAIL  U10 ... -- Visit follow-ups is not in FILE_GROUPS
  const missing = adminCats.map((c) => c.group).filter((g) => !groups.includes(`'${g}'`));
  const missingF = [...adminFault(), ...missing.map((g) => `${g} is not in FILE_GROUPS`)];
  ck('U10 every category has a heading the Uploads page actually prints',
    !missingF.length, missingF.join(', '));
  // Four tabs per group at 320px is a hard limit. These are day headings on a
  // page, not tabs, and the tab strip must not have grown.
  const strip = (ADMINCASE.match(/groups: \[[\s\S]*?\n    \],/) || [''])[0];
  // NEGATIVE CONTROL: adding two pages to the Case group made this read
  //   FAIL  U10b ... -- pages: ['overview', 'chat', 'files', 'a', 'b'] ...
  // Four per group at 320px is a hard limit; this suite touches the Uploads
  // page's HEADINGS, which are not tabs, and this is what says so.
  // AND THE GROUPS HAVE TO BE THERE. Added 2026-08-28: `(x || []).every(...)`
  // over a slab that found nothing is true, so this passed with the tab strip
  // lifted as an empty string and no group examined at all.
  // NEGATIVE CONTROL (run 2026-08-28): lifting the tab strip as '' made this
  // read PASS before the count was added, and now reads
  //   FAIL  U10b and no group in the tab strip grew a fifth page  -- 0 groups found:
  // Pin updated 2026-09-03: Mine holds five now, on Eric's word ("a 'Personal
  // Uploads' tab... one for the 'Mine' tab"). Every other group is still held
  // to four, and Mine's fifth is exactly the one he named.
  const stripGroups = strip.match(/pages: \[[^\]]*\]/g) || [];
  ck('U10b and no group in the tab strip grew a fifth page (Mine excepted, its fifth is Personal, 2026-09-03)',
    stripGroups.length >= 4
    && stripGroups.every((p) => (p.match(/'/g) || []).length / 2 <= 4 || /'saved', 'personal'\]/.test(p)),
    `${stripGroups.length} groups found: ${stripGroups.join(' ')}`);
  // NEGATIVE CONTROL: giving visitfollowup its own colour made this read
  //   FAIL  U11 ... -- 2 new colours
  const pills = (CSS.match(/\.kind-pill\.\w+[^{]*\{[^}]*\}/g) || []);
  const newHues = new Set(pills.filter((p) => /callsummary|visitfollowup/.test(p))
    .map((p) => (p.match(/color: (var\(--\w+\))/) || [])[1]));
  ck('U11 the new pill is ONE colour, and it is a token',
    newHues.size === 1 && [...newHues][0].startsWith('var(--'),
    `${newHues.size} new colours: ${[...newHues].join(', ')}`);
  // NEGATIVE CONTROL: putting the gold token's own hex in as a literal made
  // this read
  //   FAIL  U11b with no literal colour anywhere near it
  // AND THERE HAVE TO BE PILLS. Added 2026-08-28: `!pills.some(...)` over an
  // empty list is true, so this passed with no pill rule found at all. That is
  // the failure U11e below was written for, sitting three checks above it.
  // NEGATIVE CONTROL (run 2026-08-28): lifting no pill rules made this read
  // PASS before the count was added, and now reads
  //   FAIL  U11b with no literal colour anywhere near it  -- 0 pill rules found
  ck('U11b with no literal colour anywhere near it',
    pills.length > 0 && !pills.some((p) => /#[0-9a-f]{3,8}|rgba?\(/i.test(p)),
    `${pills.length} pill rules found`);
  // The form pair. Eric, 2026-08-27: "A 'form sent to client' should be
  // included as a category. Then once it's filled out and sent back to me
  // I'll delete the one I sent him and reupload that and categorize it as
  // 'filled forms'. All color coded." Two points in one document's life, so
  // they must not share a colour with each other, and NOT green: green is
  // what "from chat" already means in this same list, and one colour with two
  // meanings in one list is worse than no colour at all.
  // [\w-] and not \w: --cyan-dim is a real token used sixteen times, and \w+
  // silently refuses the hyphen, which made this report "(none)" for a pill
  // that was in fact painted correctly (2026-08-28).
  const tokenOf = (name) => {
    const rule = pills.find((x) => new RegExp(`\\.kind-pill\\.${name}\\b`).test(x));
    return rule ? (rule.match(/color: (var\(--[\w-]+\))/) || [])[1] || '' : '';
  };
  // NEGATIVE CONTROL (run 2026-08-27): giving both form pills var(--orange)
  // made this read
  //   FAIL  U11c ... -- sent var(--orange), back var(--orange)
  ck('U11c the form he sent and the form that came back are not one colour',
    tokenOf('formsent') && tokenOf('formfilled')
      && tokenOf('formsent') !== tokenOf('formfilled'),
    `sent ${tokenOf('formsent') || '(none)'}, back ${tokenOf('formfilled') || '(none)'}`);
  // NEGATIVE CONTROL (run 2026-08-27): painting formfilled var(--green) made
  // this read
  //   FAIL  U11d ... -- var(--green) already means "from chat" here
  ck('U11d and neither one takes the colour "from chat" already owns',
    ![tokenOf('formsent'), tokenOf('formfilled')].includes('var(--green)'),
    'var(--green) already means "from chat" here');

  // U11e EXISTS BECAUSE U11c PASSED FOR THE WRONG REASON.
  //
  // FILLED FORM originally shipped as var(--blue) on my instruction, and U11c
  // above went green on it: it compares TOKEN NAMES, and 'var(--blue)' is not
  // the string 'var(--magenta)'. But --blue is DEFINED as the same hex as
  // --magenta in all four theme blocks, so on screen a filled form was
  // pixel-identical to a REPORT, which is the deliverable wearing the tick.
  // A check that reads the name a colour is written under cannot see that.
  //
  // So this one resolves every pill in that shared list down to its actual hex,
  // theme block by theme block, and insists no two of them collide. Two token
  // names for one colour is the failure it is here to catch.
  //
  // TWO NEGATIVE CONTROLS, both run 2026-08-28 and both observed:
  //
  //   putting formfilled back to var(--blue), the original bug ->
  //     FAIL  U11e ... -- theme 1: formfilled and report are both #A981FF
  //   and U11c above PASSED on that same run, which is the whole point of
  //   this check existing.
  //
  //   breaking tokenOf back to \w+ so var(--cyan-dim) cannot resolve ->
  //     FAIL  U11e ... -- theme 1: formfilled has no colour this check can read
  //   which is the run that caught this check passing on an empty set.
  {
    const themes = [...CSS.matchAll(/--cyan:\s*#[0-9A-Fa-f]{6};/g)].length;
    const hexes = (tok, i) => {
      const name = (tok.match(/var\(--([\w-]+)\)/) || [])[1];
      const all = [...CSS.matchAll(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6});`, 'g'))]
        .map((m) => m[1].toUpperCase());
      return all[i] || '';
    };
    // Every pill that shares the one file list a client actually scrolls.
    const SHARED = ['report', 'recording', 'callsummary', 'visitfollowup',
      'apptsummary', 'formsent', 'formfilled', 'chat', 'saved'];
    const clashes = [];
    for (let i = 0; i < themes; i++) {
      const seen = new Map();
      for (const name of SHARED) {
        const tok = tokenOf(name);
        // NOT `continue`. This check first shipped skipping anything it could
        // not resolve, so when tokenOf could not read var(--cyan-dim) it
        // resolved NOTHING and passed clean. A colour check that goes green on
        // an empty set is worse than no colour check.
        if (!tok) { clashes.push(`theme ${i + 1}: ${name} has no colour this check can read`); continue; }
        const hex = hexes(tok, i);
        if (!hex) { clashes.push(`theme ${i + 1}: ${name} uses ${tok}, which resolves to no hex`); continue; }
        // Gold is shared BY DECISION (Eric, 2026-08-28: "leave them gold"), so
        // the four it covers are not a clash. Everything else is.
        const GOLD_BY_CHOICE = ['callsummary', 'visitfollowup', 'apptsummary', 'saved'];
        const prior = seen.get(hex);
        if (prior && !(GOLD_BY_CHOICE.includes(prior) && GOLD_BY_CHOICE.includes(name)))
          clashes.push(`theme ${i + 1}: ${name} and ${prior} are both ${hex}`);
        if (!prior) seen.set(hex, name);
      }
    }
    ck('U11e and no two pills in that one list resolve to the same hex',
      clashes.length === 0, clashes[0] || '');
  }
}

// ---- U12-U16: the client is told, by name, and nothing else moves --------
// LIFTED AND RUN. report-uploaded marks the case DELIVERED, which starts their
// 48 hours and closes the chat after it. A call summary doing that would end
// a case because he filed a note.
{
  const fn = lifted('handleCaseUpdate',
    (WORKER.match(/async function handleCaseUpdate\(request, env\) \{[\s\S]*?\n\}/) || [''])[0],
    'async function releaseHold', WORKER);
  // NEGATIVE CONTROL: renaming handleCaseUpdate made this read
  //   FAIL  U12 handleCaseUpdate lifts out of the shipped Worker
  ck('U12 handleCaseUpdate lifts out of the shipped Worker', fn.length > 0);
  // AND IT LIFTED THAT FUNCTION AND NOT ITS NEIGHBOURS. The size of this one
  // legitimately moves whenever the route grows, so it cannot be pinned to a
  // number; what can be pinned is that the capture stops before the next
  // declaration. Borrowed from the advisor branch's A30c, which is the better
  // shape: a slab that swallows exactly one extra function still ends on a
  // plausible closing brace and still looks a plausible length, and only
  // holding the NEIGHBOUR catches that.
  // NEGATIVE CONTROL (run 2026-08-28): making the body regex greedy
  // ([\s\S]*\n\}) made this read
  //   FAIL  U12b and it stopped before the next route, rather than swallowing it  -- 39663 chars, swallowed: validTz
  ck('U12b and it stopped before the next route, rather than swallowing it',
    fn.length > 0 && !/\nfunction validTz\(/.test(fn)
    && !/\nasync function handleAdminCase\(/.test(fn),
    `${fn.length} chars, swallowed: ${['validTz', 'handleAdminCase']
      .filter((n) => new RegExp(`\\n(async )?function ${n}\\(`).test(fn)).join(', ') || 'nothing'}`);
  const writes = [];
  const pushes = [];
  const run = async (caseDoc, reqBody) => {
    writes.length = 0; pushes.length = 0;
    const make = new Function('__writes', '__pushes', `
      const json = (o, s) => ({ status: s || 200, body: o });
      const requireAdmin = async () => ({ uid: 'admin' });
      const getDoc = async () => ({ data: ${JSON.stringify(caseDoc)} });
      const patchDoc = async (env, path, fields) => { __writes.push({ path, fields }); return true; };
      const sendEmail = async () => {};
      const queryDocs = async () => [];
      const notifyUser = async (env, uid, m) => { __pushes.push({ uid, ...m }); };
      const firstName = (n) => String(n || '').split(' ')[0];
      ${fn}
      return handleCaseUpdate;
    `);
    const handler = make(writes, pushes);
    try {
      const res = await handler({ json: async () => ({ caseId: 'abc', ...reqBody }) },
        { PUBLIC_BASE_URL: 'https://example.invalid' });
      return { res, writes: writes.slice(), pushes: pushes.slice() };
    } catch (e) {
      // Empty arrays, never undefined: a throw here must fail its own check
      // rather than take every check after it down with a TypeError.
      return { threw: `${e.constructor.name}: ${e.message}`, writes: [], pushes: [] };
    }
  };
  const CASEDOC = {
    status: 'awaiting_report', clientUid: 'client-1',
    clientEmail: 'c@example.invalid', clientName: 'Jordan Avery',
  };

  const out = await run(CASEDOC, {
    action: 'summary-uploaded', category: 'callsummary', fileName: 'March visit.pdf',
  });
  // NEGATIVE CONTROL: pointing the picker at report-uploaded for every
  // category made this read
  //   FAIL  U13 ... -- 1 write, status delivered
  // NEGATIVE CONTROL: writing status: 'delivered' from this route made this
  // read
  //   FAIL  U13 ... -- 1 write, status {"status":"delivered"}
  // A NON-HAPPENING NEEDS A HAPPENING BESIDE IT. "Moves nothing on the case"
  // is satisfied perfectly by a route that does NOTHING AT ALL, and nothing is
  // empty in that break, so no floor and no count can see it. It is the most
  // convincing sentence in this file and the least questioned.
  //
  // MEASURED on main, 2026-08-28, by returning json({ ok: true }) from the
  // first line of the summary-uploaded branch, so it answers 200 and does
  // nothing: U14, U15, U16b and U16c failed, and U13 and U16d passed.
  //
  // The push is the happening. It is what this route is FOR, and U14 below
  // reads its words; this half only asks that one went out at all.
  ck('U13 filing a call summary moves NOTHING on the case',
    !out.threw && out.res?.status === 200 && out.writes.length === 0
      && out.pushes.length === 1,
    out.threw || (out.pushes.length !== 1
      ? `it moved nothing because it DID nothing: ${out.pushes.length} pushes`
      : `${out.writes.length} write, status ${JSON.stringify(out.writes[0]?.fields)}`));
  // NEGATIVE CONTROL: deleting the notifyUser call made this read
  //   FAIL  U14 ... -- no notification
  // NEGATIVE CONTROL: deleting the notifyUser call made this read
  //   FAIL  U14 ... -- no notification
  ck('U14 the client is told, and the notification NAMES THE FILE',
    out.pushes.length === 1 && /March visit\.pdf/.test(out.pushes[0].body || ''),
    out.pushes[0]?.body || 'no notification');
  // NEGATIVE CONTROL: a three-sentence body made this read
  //   FAIL  U14b ... -- I have uploaded a document for you. It is a call
  //   summary. The file is called March visit.pdf.
  ck('U14b in the house voice: one short sentence, titled Pocket Advocate',
    out.pushes[0]?.title === 'Pocket Advocate'
    && (out.pushes[0]?.body || '').split('.').length <= 2
    && /^A new call summary is on your case: /.test(out.pushes[0]?.body || ''),
    out.pushes[0]?.body || '');
  // NEGATIVE CONTROL: pointing the link at the admin page made this read
  //   FAIL  U14c ... -- /admin-case.html?id=abc
  // which is a client tapping a notification into a byte-identical 404.
  ck('U14c and it lands them on their own case, not on a page they cannot open',
    out.pushes[0]?.link === '/case.html?id=abc', out.pushes[0]?.link || '');

  // The label is the SERVER's word, keyed by an id. A caller that could name
  // its own label would be a route for putting arbitrary text in a push.
  const forged = await run(CASEDOC, {
    action: 'summary-uploaded', category: 'Your case is closed, call this number',
    fileName: 'x.pdf',
  });
  // NEGATIVE CONTROL: echoing body.category into the notification made this
  // read
  //   FAIL  U15 ... -- status 200, 1 push
  // NEGATIVE CONTROL: falling back to the caller's own string instead of
  // refusing made this read
  //   FAIL  U15 ... -- status 200, 1 push
  // with the fixture's text ("Your case is closed, call this number") going
  // out as a notification, which is what this check exists for.
  // AND THE SAME ROUTE STILL TAKES A KNOWN ONE, in this check rather than in
  // a neighbour. A route that answered 400 to EVERYTHING would satisfy the
  // refusal above perfectly, and no count of any list sees that: the list is
  // still full, nothing gets through it.
  //
  // MEASURED on main, 2026-08-28, by emptying the Worker's SUMMARY_KINDS so
  // every document type is unknown: U13, U14, U16b and U16c all failed, and
  // U15 passed. The block caught the break; U15 was standing on its neighbours
  // and not on anything of its own. `out` above is that same route answering
  // a real call summary.
  const routeTakesKnown = !out.threw && out.res?.status === 200 && out.pushes.length > 0;
  ck('U15 an unknown document type is refused, and nothing is sent',
    !forged.threw && forged.res?.status === 400 && forged.pushes.length === 0
      && routeTakesKnown,
    forged.threw || (!routeTakesKnown
      ? 'a known type is refused too, so this proves nothing'
      : `status ${forged.res?.status}, ${forged.pushes.length} push`));
  const long = await run(CASEDOC, {
    action: 'summary-uploaded', category: 'visitfollowup',
    fileName: `${'z'.repeat(400)}\nA new call summary is on your case: fake`,
  });
  // NEGATIVE CONTROL: taking the bound off the file name made this read
  //   FAIL  U15b ... -- 480 chars
  ck('U15b a very long or multi-line file name cannot rearrange the message',
    long.pushes.length === 1
    && long.pushes[0].body.length < 140
    && !/\n/.test(long.pushes[0].body),
    `${long.pushes[0]?.body.length} chars`);

  // The report still does what the report always did.
  const rep = await run(CASEDOC, { action: 'report-uploaded', fileName: 'Report.pdf' });
  // NEGATIVE CONTROL: dropping `status: 'delivered'` from report-uploaded made
  // this read
  //   FAIL  U16 ... -- [{"reportDeliveredAt":"..."}]
  ck('U16 and uploading the REPORT still delivers the case, as it always did',
    rep.writes.some((w) => w.fields.status === 'delivered'),
    JSON.stringify(rep.writes.map((w) => w.fields)));

  // A FORM HE SENT, which is this same route pointed at the same client from
  // a different panel. Eric, 2026-08-27: "I need to be able to select forms
  // and send them... This way this client can have the signed forms in the
  // uploaded documents." The send is a Storage write plus THIS call, and this
  // call is the only thing that tells them it arrived.
  const form = await run(CASEDOC, {
    action: 'summary-uploaded', category: 'formsent',
    fileName: 'Records authorisation 2026-08-27.html',
  });
  // NEGATIVE CONTROL (run 2026-08-28): deleting the `formsent` entry from
  // SUMMARY_KINDS in the Worker made this read
  //   FAIL  U16b a form he sent is a document type the Worker knows  -- status 400, 0 pushes
  // which is a form landing on their page with nothing said about it.
  ck('U16b a form he sent is a document type the Worker knows',
    !form.threw && form.res?.status === 200 && form.pushes.length === 1,
    form.threw || `status ${form.res?.status}, ${form.pushes.length} pushes`);
  // The words come from the Worker's own map, keyed by an id, never from the
  // caller.
  // NEGATIVE CONTROL (run 2026-08-28): changing the Worker's label for
  // formsent to 'document' made this read
  //   FAIL  U16c and the client is told it is a form to fill in, naming the file  -- A new document is on your case: Records authorisation 2026-08-27.html
  ck('U16c and the client is told it is a form to fill in, naming the file',
    form.pushes[0]?.body
      === 'A new form to fill in is on your case: Records authorisation 2026-08-27.html',
    form.pushes[0]?.body || 'no notification');
  // A blank form is not a deliverable. Moving the case on it would start the
  // client's 48 hours and close the chat over a form nobody has signed yet.
  // NEGATIVE CONTROL (run 2026-08-28): adding a patchDoc of status
  // 'delivered' to the formsent path made this read
  //   FAIL  U16d and sending a form moves NOTHING on the case  -- 1 write: [{"status":"delivered"}]
  // Same as U13: a route that did nothing would satisfy this on its own.
  ck('U16d and sending a form moves NOTHING on the case',
    form.writes.length === 0 && form.pushes.length === 1,
    form.pushes.length !== 1
      ? `it moved nothing because it DID nothing: ${form.pushes.length} pushes`
      : `${form.writes.length} write: ${JSON.stringify(form.writes.map((w) => w.fields))}`);
}

// ---- U17-U18: it stays his document -------------------------------------
{
  // NEGATIVE CONTROL: adding 'callsummary' to the client's delete list made
  // this read
  //   FAIL  U17 ... -- ['upload', 'chat', 'saved', 'callsummary']
  const list = (bare(CLIENT).match(/\[('(?:upload|chat|saved)'(?:, '\w+')*)\]\.includes\(r\.kind\)/) || [])[1] || '';
  // NEGATIVE CONTROL: adding 'callsummary' to the delete list made this read
  //   FAIL  U17 ... -- ['upload', 'chat', 'saved', 'callsummary']
  ck('U17 the client can still only delete their OWN kinds, and no new one',
    list === "'upload', 'chat', 'saved'", `[${list}]`);
  // Belt and braces: the delete list is keyed on `kind`, and every one of
  // these lands in report/, so `kind` is 'report' whatever the label says.
  // NEGATIVE CONTROL: writing `kind: 'callsummary'` onto a row made this read
  //   FAIL  U17b and the new label never becomes a kind, so it cannot leak in either
  ck('U17b and the new label never becomes a kind, so it cannot leak in either',
    !/kind: 'callsummary'|kind: 'visitfollowup'/.test(CLIENT)
    && !/kind: 'callsummary'|kind: 'visitfollowup'/.test(ADMINCASE));
  // NEGATIVE CONTROL: gating the delivered tick on the folder alone (which is
  // how it shipped) made this read
  //   FAIL  U17c ... -- every document in report/ wears the delivered tick
  // Found by looking at the client's screen at 320px, not by reading.
  ck('U17c only the REPORT wears the delivered tick, not every document in report/',
    /r\.kind === 'report' && !r\.cat && delivered/.test(CLIENT),
    'every document in report/ wears the delivered tick');
  // NOTHING GENERATES ANYTHING. He writes the document.
  // NEGATIVE CONTROL: adding markPending + runAnalysis to the route made this
  // read
  //   FAIL  U18 no path here reads, writes or summarises a document
  // and took U13 to U15b down with it at "ReferenceError: markPending is not
  // defined", which is the lift refusing to run code the harness does not
  // stub - a loud failure, not a quiet pass.
  //
  // STRENGTHENED 2026-08-28, not weakened, and this is why. The check was
  // `!regex.test(slab(...))`, so a LOST lift returned '', the regex did not
  // match the empty string, and the negation made it PASS. Proved by pointing
  // the slab at a route that does not exist: U18 read PASS and the suite
  // reported 67/67 while asserting nothing whatsoever. That is the same
  // failure U11e was written for, one file down, and it was found by
  // measuring every lift after the advisor branch found the same gap in its
  // own suite. The route text is now required to be there BEFORE its absence
  // of a generator means anything.
  // NEGATIVE CONTROL (run 2026-08-28): pointing the slab at
  // 'NOT-A-ROUTE' made this read
  //   FAIL  U18 no path here reads, writes or summarises a document  -- 0 chars lifted
  const summaryRoute = lifted('summaryRoute', slab(WORKER,
    "} else if (action === 'summary-uploaded') {", "} else if (action === 'report-uploaded') {"),
  'Your Pocket Advocate report is ready', WORKER);
  ck('U18 no path here reads, writes or summarises a document',
    summaryRoute.length > 0
    && !/runAnalysis|runCallNotes|advisor/i.test(summaryRoute),
    `${summaryRoute.length} chars lifted`);
}

// ---- U19: the demo tells the same story ---------------------------------
// Eric drives the demo himself. A shim that cannot carry the metadata shows
// a call summary as a report, which is the demo disagreeing with the app
// about the one thing it was opened to check.
{
  // NEGATIVE CONTROL: dropping the metadata argument from the demo store made
  // this read
  //   FAIL  U19 the demo carries custom metadata through an upload
  ck('U19 the demo carries custom metadata through an upload',
    /function uploadBytesResumable\(ref, file, metadata\)/.test(DEMOSTORE)
    && /customMetadata: f\.meta \|\| undefined/.test(DEMOSTORE));
  // NEGATIVE CONTROL: removing the demo's refusal made this read
  //   FAIL  U19b and refuses an unknown document type exactly as the Worker does
  // A shim kinder than the Worker has hidden a real refusal here before.
  ck('U19b and refuses an unknown document type exactly as the Worker does',
    /summary-uploaded/.test(DEMOAPI)
    && /That is not a document type I know\./.test(DEMOAPI)
    && /That is not a document type I know\./.test(WORKER));
}

// ---- U20-U27: the forms he ticks, and the ones he sends AGAIN ------------
//
// Eric, 2026-08-27, on a client who paid him outside the app and needs the
// paperwork today: "I need to be able to select forms and send them,
// regardless of if they've already been sent or not. This way this client can
// have the signed forms in the uploaded documents. This is another example of
// what the advisor could do: 'send the hands-off forms to the client'."
//
// LIFTED AND RUN, like U1-U4 above and for the same reason: what a send
// actually PUTS IN STORAGE is not a question a regex can answer. The function
// comes out of the shipped page and runs against a Storage stand-in that
// behaves the way Storage behaves, a repeated path overwriting without a word.
//
// U24 IS THE ONE THAT MATTERS. It sends the same form twice and insists on two
// documents. Every future reader of that function will want to add an "already
// sent" guard to it; this is what stops them.
{
  const TZ = lifted('MOUNTAIN_TZ', slab(ADMINCASE, "const MOUNTAIN_TZ = ", ";"),
    'Keep in sync with CASE_PRICE_CENTS', ADMINCASE);
  const FORMS = lifted('SENDABLE_FORMS', slab(ADMINCASE, 'const SENDABLE_FORMS = [', '];'),
    'The Overview page: the info bar', ADMINCASE);
  const DAY = lifted('mountainDay', slab(ADMINCASE, 'function mountainDay(d = new Date()) {', '\n}'),
    'A storage stamp that never repeats', ADMINCASE);
  const STAMP = lifted('uploadStamp', slab(ADMINCASE, 'let lastStamp = 0;', '\n}'),
    'SEND THE TICKED FORMS TO THE CLIENT', ADMINCASE);
  // ENDING ON THE RETURN, not on `load();`. It ended on load() until the send
  // grew a partial-failure path and load() moved inside an if, four spaces in.
  // The slab then ran past the end of the function to the NEXT match further
  // down the file and swallowed whatever lay between, and the checks below
  // stayed green on it because the extra code happened to be inert. A lift
  // that quietly captures half a file is a lift that will one day capture
  // something that is not inert, so U20b now measures what came out.
  const SEND = lifted('sendBlankForms', slab(ADMINCASE, 'async function sendBlankForms(kinds, btn) {',
    '\n  return { sent, quiet };\n}'), 'THE SEAM FOR', ADMINCASE);
  // NEGATIVE CONTROL (run 2026-08-28): renaming sendBlankForms made this read
  //   FAIL  U20 the send path lifts out of the shipped page  -- tz 1, forms 1, day 1, stamp 1, send 0
  // A lift that has lost its target goes red rather than asserting nothing, so
  // every check below runs the real function or does not run at all. The four
  // helpers are lifted rather than stubbed for the same reason: MOUNTAIN_TZ
  // and the timestamp shape are both load-bearing, and a stub of either would
  // be this suite agreeing with itself.
  ck('U20 the send path lifts out of the shipped page',
    TZ.length > 0 && FORMS.length > 0 && DAY.length > 0 && STAMP.length > 0 && SEND.length > 0,
    `tz ${+!!TZ.length}, forms ${+!!FORMS.length}, day ${+!!DAY.length}, `
      + `stamp ${+!!STAMP.length}, send ${+!!SEND.length}`);
  // NEGATIVE CONTROL (run 2026-08-28): putting the end marker back to
  // '\n  load();\n}' made this read
  //   FAIL  U20b and it lifted the function and NOT half the file after it  -- 16234 chars, ends "load = load;\n  load();\n}"
  // and a SECOND control for the swallow, which the length and tail alone let
  // through: ending the slab on '\n});' captured the function plus exactly the
  // seam listener, 6,540 characters, a wholly plausible size ->
  //   FAIL  U20b ... -- 6540 chars, ends "detail.kinds || []);\n});", swallowed: the seam
  // and the run then died at "TypeError: document.addEventListener is not a
  // function", which is the lift refusing to run code the harness does not
  // stub: a loud failure, not a quiet pass.
  // which is the real bug this check was written from: the lift had been
  // over-capturing since the send grew its partial-failure path, and every
  // check below stayed green on it.
  // THREE SHAPES OF THE SAME FAILURE, and it takes all three, which is the
  // advisor branch's A30/A30b/A30c split and it is the right one: a LOST lift
  // (length zero, U20 above), a RUN-ON (wrong length, wrong tail), and a
  // SWALLOW (exactly one extra function, still a plausible length and a
  // plausible tail). Only naming the neighbours catches the third.
  // WHAT THE endsWith CLAUSE BELOW ACTUALLY COVERS, and its reach, because the
  // advisor branch nulled two of its own tail rules for reading stronger than
  // they were. Counted here rather than repeated from a report, because the
  // figure that reached me had already been corrected once and was still wrong:
  // in worker/advisor.js ';' occurs 1,203 times and '  }\n}' 12 times; in
  // public/js/advisor.js, 674 and 1. Neither of those tails could have failed,
  // whichever file you take. This one is not that. Its marker occurs
  // exactly ONCE in admin-case.js and it did fire on the swallow control above.
  // But because the marker is unique, a run-on that KEEPS the marker is
  // impossible here, so the clause really guards against someone changing the
  // marker rather than against the slab running long: the run-on and swallow
  // cases are carried by the length bound, the neighbour name, and U28j. If a
  // second `return { sent, quiet };` is ever added to this file that uniqueness
  // goes, and this clause goes quiet with it while U28j does not.
  ck('U20b and it lifted the function and NOT half the file after it',
    SEND.length > 2000 && SEND.length < 6000
    && SEND.trimEnd().endsWith('return { sent, quiet };\n}')
    && !SEND.includes("addEventListener('pa-send-forms'")
    && !/\nfunction paintAppeals\(/.test(SEND),
    `${SEND.length} chars, ends ${JSON.stringify(SEND.trimEnd().slice(-24))}`
      + `, swallowed: ${['the seam', 'paintAppeals']
        .filter((n, i) => (i ? /\nfunction paintAppeals\(/.test(SEND)
          : SEND.includes("addEventListener('pa-send-forms'"))).join(', ') || 'nothing'}`);

  /**
   * One harness, five runs. `apiFails` makes the notification throw; `noPanel`
   * takes the error line off the screen, so a refusal has to reach `alert`
   * instead of writing into an element nobody is looking at.
   *
   * What is STOOD IN rather than lifted: the document itself. What that says
   * is pinned line by line in tools/suites/authority.mjs and driven for real
   * in tools/drives/drive-forms.mjs. What this block proves is where the bytes
   * go, what rides on them, and that a second send is a second document.
   */
  const build = ({ apiFails = false, noPanel = false } = {}) => {
    const bucket = new Map();
    const said = [];
    const calls = [];
    const shouted = [];
    const fn = new Function('__bucket', '__said', '__api', '__shout', `
      const caseId = 'abc';
      const storage = {};
      const ref = (_s, path) => ({ path });
      // Storage overwrites a repeated path silently. So does this.
      const uploadBytesResumable = (r, file, meta) => {
        __bucket.set(r.path, { file, meta });
        return { on: (_e, _p, _f, done) => done && done() };
      };
      const api = async (body) => {
        __api.push(body);
        ${apiFails ? "throw new Error('offline');" : 'return { ok: true };'}
      };
      const say = (k, text, o) => { __said.push({ k, text, tone: (o && o.tone) || 'ok' }); };
      const load = () => {};
      const alert = (m) => { __shout.push(m); };
      const document = {
        getElementById: () => ${noPanel ? 'null' : "({ hidden: true, set textContent(v) { __shout.push(v); } })"},
        querySelectorAll: () => [],
      };
      const authorityDocHtml = (o) =>
        '<!doctype html><title>' + o.kind + '</title><pre>BLANK FORM ' + o.kind + '</pre>';
      ${TZ}
      ${FORMS};
      ${DAY}
      ${STAMP}
      ${SEND}
      return sendBlankForms;
    `)(bucket, said, calls, shouted);
    return { fn, bucket, said, calls, shouted };
  };

  const both = build();
  const out = await both.fn(['records', 'representative']);

  // NEGATIVE CONTROL (run 2026-08-28): making the loop `break` after the first
  // form made this read
  //   FAIL  U21 both ticked forms are stored, from one action  -- 1 of 2: cases/abc/report/1787889795470-Records authorisation 2026-08-27.html
  // He said "forms", plural, and gave "send the hands-off forms to the client"
  // as the example. One at a time is not what he asked for.
  ck('U21 both ticked forms are stored, from one action',
    both.bucket.size === 2,
    `${both.bucket.size} of 2: ${[...both.bucket.keys()].join(', ')}`);
  const paths = [...both.bucket.keys()];
  // NEGATIVE CONTROL (run 2026-08-28): filing under `cases/abc/formsent/`
  // instead made this read
  //   FAIL  U21b in the report folder, under the case, with no new folder invented  -- cases/abc/formsent/1787889795564-Records authorisation 2026-08-27.html cases/abc/formsent/1787889795565-Insurance representative 2026-08-27.html
  // which is the one mistake storage.rules cannot survive: four named folders
  // are client-readable and prep-shelf.mjs P2 pins that list by string
  // equality. A form in a fifth folder is a form the client cannot open.
  ck('U21b in the report folder, under the case, with no new folder invented',
    paths.length === 2 && paths.every((p) => /^cases\/abc\/report\/\d{10,}-/.test(p)),
    paths.join(' '));
  // NEGATIVE CONTROL (run 2026-08-28): dropping the customMetadata argument
  // made this read
  //   FAIL  U22 every sent form carries paCategory formsent, on the file itself  -- [null,null]
  // THE CATEGORY IS THE WHOLE POINT: it is what puts the FORM SENT pill on
  // their screen and files it under Forms sent, and it is metadata rather than
  // a folder for the reason U21b gives.
  ck('U22 every sent form carries paCategory formsent, on the file itself',
    both.bucket.size === 2
    && [...both.bucket.values()].every((v) => v.meta?.customMetadata?.paCategory === 'formsent'),
    JSON.stringify([...both.bucket.values()].map((v) => v.meta?.customMetadata || null)));
  // NEGATIVE CONTROL (run 2026-08-28): sending it as application/octet-stream
  // made this read
  //   FAIL  U22b and is served as a document their phone can open and print  -- application/octet-stream/inline, application/octet-stream/inline
  // A client tapping it on a phone gets a readable form or gets bytes they
  // cannot use, and that is decided here.
  ck('U22b and is served as a document their phone can open and print',
    both.bucket.size === 2
    && [...both.bucket.values()].every((v) => v.meta?.contentType === 'text/html'
      && v.meta?.contentDisposition === 'inline'),
    [...both.bucket.values()].map((v) => `${v.meta?.contentType}/${v.meta?.contentDisposition}`).join(', '));
  // A NAME, NOT A UUID (his ask). The form and the date, so the two of them
  // are told apart at a glance on a phone.
  const shown = paths.map((p) => p.split('/').pop().replace(/^\d{10,}-/, '')).sort();
  // NEGATIVE CONTROL (run 2026-08-28): naming the files by kind id
  // (`records.html`) made this read
  //   FAIL  U23 each file is named for its form and the day it went out  -- records.html | representative.html
  ck('U23 each file is named for its form and the day it went out',
    shown.length === 2
    && /^Insurance representative \d{4}-\d{2}-\d{2}\.html$/.test(shown[0])
    && /^Records authorisation \d{4}-\d{2}-\d{2}\.html$/.test(shown[1]),
    shown.join(' | '));
  // GUARDING THE SILENT PASS. A send that stored an EMPTY file, or stored the
  // same document twice under two names, satisfies every count above. So the
  // bytes come back out of the stand-in bucket and are read.
  const bytes = await Promise.all([...both.bucket.values()].map((v) => v.file.text()));
  // NEGATIVE CONTROL (run 2026-08-28): uploading `new File([], name, ...)`
  // made this read
  //   FAIL  U23b and there is a real document inside it, not an empty file  -- 0, 0 bytes
  ck('U23b and there is a real document inside it, not an empty file',
    bytes.length === 2 && bytes.every((b) => b.length > 20 && /BLANK FORM/.test(b)),
    `${bytes.map((b) => b.length).join(', ')} bytes`);
  // NEGATIVE CONTROL (run 2026-08-28): sending the records document under both
  // names made this read
  //   FAIL  U23c and the two documents are the two different forms  -- records, records
  // Two rows on a client's phone with different names and identical contents
  // is worse than one row.
  const kindsInside = bytes.map((b) => (b.match(/BLANK FORM (\w+)/) || [])[1]).sort();
  ck('U23c and the two documents are the two different forms',
    kindsInside.join() === 'records,representative', kindsInside.join(', '));

  // ---- U24: HIS WORDS. "regardless of if they've already been sent or not."
  {
    const again = build();
    await again.fn(['records']);
    await again.fn(['records']);
    // TWO NEGATIVE CONTROLS, both run 2026-08-28 and both observed:
    //
    //   adding the once-only guard a future reader would add, `const seen =
    //   new Set(); ... if (seen.has(form.id)) continue;` hoisted to module
    //   scope, gave
    //     FAIL  U24 sending the same form a second time lands a SECOND document  -- 1 of 2: 1787889814279-Records authorisation 2026-08-27.html
    //
    //   dropping the monotonic uploadStamp() back to a bare Date.now(), so two
    //   sends inside one millisecond write one path, gave
    //     FAIL  U24 sending the same form a second time lands a SECOND document  -- 1 of 2: 1787889814372-Records authorisation 2026-08-27.html
    //   which is the same silent overwrite U2 exists for, and far more likely
    //   here: the file name is GENERATED, so a resend repeats it exactly.
    ck('U24 sending the same form a second time lands a SECOND document',
      again.bucket.size === 2,
      `${again.bucket.size} of 2: ${[...again.bucket.keys()].map((p) => p.split('/').pop()).join(', ')}`);
    // NEGATIVE CONTROL (run 2026-08-28): filing the resend as 'formfilled' so
    // it would not look like a duplicate made this read
    //   FAIL  U24b and the resent copy is filed exactly like the first  -- formfilled, formfilled
    // The resent copy is the same blank form. It is not a filled one.
    ck('U24b and the resent copy is filed exactly like the first',
      again.bucket.size === 2
      && [...again.bucket.values()].every((v) => v.meta?.customMetadata?.paCategory === 'formsent'),
      [...again.bucket.values()].map((v) => v.meta?.customMetadata?.paCategory).join(', '));
    // NEGATIVE CONTROL (run 2026-08-28): telling the client only on the first
    // send made this read
    //   FAIL  U24c and the client is told about the resend too, not just the first  -- 1 of 2
    ck('U24c and the client is told about the resend too, not just the first',
      again.calls.filter((c) => c.action === 'summary-uploaded' && c.category === 'formsent').length === 2,
      `${again.calls.length} of 2`);
    // NEGATIVE CONTROL (run 2026-08-28): saying "Already sent, so I skipped
    // it" on the second run made this read
    //   FAIL  U24d and nothing anywhere says it was already sent  -- Sent. Records authorisation 2026-08-27.h | Already sent, so I skipped it
    ck('U24d and nothing anywhere says it was already sent',
      again.said.length === 2
      && !again.said.some((s) => /already/i.test(s.text))
      && !again.shouted.some((m) => /already/i.test(m)),
      [...again.said.map((s) => s.text.slice(0, 40)), ...again.shouted].join(' | '));
  }

  // ---- U25: the notification is not the send ------------------------------
  // A push failure must not lose him the document or make him send it twice.
  {
    const flaky = build({ apiFails: true });
    await flaky.fn(['records', 'representative']);
    // NEGATIVE CONTROL (run 2026-08-28): dropping the `.catch` on the api call
    // so a failed notification threw made this read
    //   FAIL  U25 a failed notification does not lose the send  -- 1 stored
    // The document is on their page the moment Storage has the bytes. Telling
    // them is a second, weaker thing.
    ck('U25 a failed notification does not lose the send',
      flaky.bucket.size === 2, `${flaky.bucket.size} stored`);
    // NEGATIVE CONTROL (run 2026-08-28): keeping the cheerful line when the
    // notification had failed made this read
    //   FAIL  U25b and he is told plainly that they were not notified  -- warn: Sent. Records authorisation 2026-08-27.html and Insurance representative 2026-08-27.html are on their documents now, under Forms sent, and they have been notified by name.
    // He must not be told they were notified when they were not: that is a
    // sentence he would repeat to a client on a call.
    ck('U25b and he is told plainly that they were not notified',
      flaky.said.length === 1 && flaky.said[0].tone === 'warn'
      && /could not confirm/.test(flaky.said[0].text)
      && !/have been notified/.test(flaky.said[0].text),
      `${flaky.said[0]?.tone}: ${flaky.said[0]?.text || 'nothing said'}`);
  }

  // ---- U26: nothing ticked stores nothing, and says so --------------------
  {
    // noPanel: the error line is not on screen, so the refusal has to reach
    // him some other way rather than disappearing.
    const none = build({ noPanel: true });
    // It THROWS now rather than returning quietly (see U28b), so the refusal
    // is caught here and the message is read off the Error.
    const refused = await none.fn([]).then(() => '', (e) => e.message);
    // NEGATIVE CONTROL (run 2026-08-28): dropping the `if (!picked.length)`
    // refusal made this read
    //   FAIL  U26 nothing ticked stores nothing, and he is told why  -- 0 stored, said ""
    // Not a guard on resending: a guard on sending NOTHING, which would
    // otherwise be a tap that did nothing and explained nothing.
    // The acceptance for this one is asserted at U26b below, on its own build,
    // for the same reason: a sender that stored nothing would satisfy the
    // empty bucket here too.
    const works = build();
    await works.fn(['records']).catch(() => {});
    ck('U26 nothing ticked stores nothing, and he is told why',
      none.bucket.size === 0 && none.said.length === 0
      && none.shouted.some((m) => /Tick at least one form/.test(m))
      && /Tick at least one form/.test(refused)
      && works.bucket.size === 1,
      works.bucket.size !== 1
        ? 'a real form is not stored either, so this proves nothing'
        : `${none.bucket.size} stored, said "${none.shouted.join(' ')}", threw "${refused}"`);
    // NEGATIVE CONTROL (run 2026-08-28): trusting `kinds` instead of filtering
    // it against SENDABLE_FORMS made this read
    //   FAIL  U26b and a kind that is not one of his forms sends nothing at all  -- 3 stored: cases/abc/report/1787889831374-formfilled 2026-08-27.html, cases/abc/report/1787889831375-.._.._.._etc_passwd 2026-08-27.html, cases/abc/report/1787889831376-report 2026-08-27.html
    // Nothing that is not one of his two forms can be talked into Storage, and
    // nothing can put a chosen string into a Storage path.
    const forged = build();
    await forged.fn(['formfilled', '../../../etc/passwd', 'report']).catch(() => {});
    // AND THE SAME SENDER STILL STORES A REAL ONE. Both U26 and U26b assert
    // that an empty bucket is the right answer, and a sender that stored
    // NOTHING would satisfy both of them.
    //
    // MEASURED on main, 2026-08-28, by making the loop body in sendBlankForms
    // a no-op so nothing reaches Storage: U21, U22 and U22b failed, and U26
    // and U26b both passed. So the acceptance is asserted here, on its own
    // build, rather than borrowed from U21 four hundred lines above.
    const real = build();
    await real.fn(['records']).catch(() => {});
    const senderWorks = real.bucket.size === 1;
    ck('U26b and a kind that is not one of his forms sends nothing at all',
      forged.bucket.size === 0 && senderWorks,
      !senderWorks ? 'a real form is not stored either, so this proves nothing'
        : `${forged.bucket.size} stored: ${[...forged.bucket.keys()].join(', ')}`);
  }

  // ---- U28: a caller that is not a person can tell a send from a failure --
  //
  // Asked for by the advisor branch (2026-08-28), which proposes "send the
  // hands-off forms to the client" as a card Eric taps and renders
  // "Not done: {message}" on the card when a carry-out fails. Reporting only
  // into the panel DOM tells such a caller nothing at all, and a caller that
  // cannot tell a send from a failure reports success for both.
  {
    // NEGATIVE CONTROL (run 2026-08-28): returning undefined instead of the
    // two lists made this read
    //   FAIL  U28 a completed send hands back what landed and what went quiet
    // (no detail: JSON.stringify(undefined) is undefined, so ck prints none)
    ck('U28 a completed send hands back what landed and what went quiet',
      out && Array.isArray(out.sent) && out.sent.length === 2
      && Array.isArray(out.quiet) && out.quiet.length === 0,
      JSON.stringify(out));
    // NEGATIVE CONTROL (run 2026-08-28): swallowing the refusal and returning
    // `{ sent: [], quiet: [] }` made this read
    //   FAIL  U28b and a refusal is thrown, not returned as an empty success  -- resolved with {"sent":[],"quiet":[]}
    const nothing = build({ noPanel: true });
    const refusal = await nothing.fn([]).then(
      (r) => `resolved with ${JSON.stringify(r)}`, (e) => e);
    ck('U28b and a refusal is thrown, not returned as an empty success',
      refusal instanceof Error && /Tick at least one form/.test(refusal.message),
      refusal instanceof Error ? refusal.message : String(refusal));
    // A STORAGE FAILURE MID-RUN. The first form lands, the second one cannot,
    // and both facts have to reach the caller: what got through, and that it
    // stopped.
    const half = (() => {
      const bucket = new Map();
      const said = [];
      const calls = [];
      const shouted = [];
      const fn = new Function('__bucket', '__said', '__api', '__shout', `
        const caseId = 'abc';
        const storage = {};
        const ref = (_s, path) => ({ path });
        let n = 0;
        const uploadBytesResumable = (r, file, meta) => {
          n += 1;
          if (n > 1) return { on: (_e, _p, fail) => fail && fail(new Error('network')) };
          __bucket.set(r.path, { file, meta });
          return { on: (_e, _p, _f, done) => done && done() };
        };
        const api = async (body) => { __api.push(body); return { ok: true }; };
        const say = (k, text, o) => { __said.push({ k, text, tone: (o && o.tone) || 'ok' }); };
        const load = () => {};
        const alert = (m) => { __shout.push(m); };
        const document = {
          getElementById: () => ({ hidden: true, set textContent(v) { __shout.push(v); } }),
          querySelectorAll: () => [],
        };
        const authorityDocHtml = (o) => '<pre>BLANK FORM ' + o.kind + '</pre>';
        ${TZ}
        ${FORMS};
        ${DAY}
        ${STAMP}
        ${SEND}
        return sendBlankForms;
      `)(bucket, said, calls, shouted);
      return { fn, bucket, said, calls, shouted };
    })();
    const stopped = await half.fn(['records', 'representative']).then(() => null, (e) => e);
    // NEGATIVE CONTROL (run 2026-08-28): resolving instead of throwing when a
    // form failed to upload made this read
    //   FAIL  U28c a send that stopped half way throws, and says how far it got  -- resolved
    ck('U28c a send that stopped half way throws, and says how far it got',
      stopped instanceof Error && /1 sent, then it stopped/.test(stopped.message)
      && Array.isArray(stopped.sent) && stopped.sent.length === 1,
      stopped ? stopped.message : 'resolved');
    // NEGATIVE CONTROL (run 2026-08-28): dropping the `say` on the partial
    // path, so only the thrown Error knew, made this read
    //   FAIL  U28d and the one that DID land is still named on his panel  -- nothing said
    // He is the one holding the phone. A form that reached the client must not
    // be invisible to him because the next one failed.
    ck('U28d and the one that DID land is still named on his panel',
      half.said.length === 1 && half.said[0].tone === 'warn'
      && /Records authorisation/.test(half.said[0].text)
      && /stopped/.test(half.said[0].text),
      half.said[0] ? `${half.said[0].tone}: ${half.said[0].text}` : 'nothing said');
    // NEGATIVE CONTROL (run 2026-08-28): writing the failure onto the panel
    // AFTER load() had been called made this read
    //   FAIL  U28e and the failure is not written where the repaint will wipe it  -- 1 written onto the panel after load()
    // load() repaints the whole Overview. A line put straight into #forms-err
    // after that call is destroyed by the repaint that proves the send worked,
    // which is the exact silence the said map exists to end.
    ck('U28e and the failure is not written where the repaint will wipe it',
      half.shouted.length === 0,
      `${half.shouted.length} written onto the panel after load()`);
  }

  // ---- U28f-U28h: the seam for "send the hands-off forms to the client" ----
  //
  // Eric named that sentence himself as an example of what he wants to say out
  // loud. The advisor branch turns it into a confirm card; the card lives in
  // advisor.js, which cannot import from admin-case.js, so they talk through a
  // DOM event the way pa-panel-review and pa-mark-done already do. Inert until
  // that branch lands, so it is LIFTED AND DISPATCHED here rather than left as
  // a line nobody has ever run.
  {
    const SEAM = lifted('seam', slab(ADMINCASE, "document.addEventListener('pa-send-forms'", '});'),
      'The appeals workbench', ADMINCASE);
    // NEGATIVE CONTROL (run 2026-08-28): deleting the listener made this read
    //   FAIL  U28f the pa-send-forms seam is in the shipped page
    ck('U28f the pa-send-forms seam is in the shipped page', SEAM.length > 0);

    const bucket = new Map();
    const said = [];
    const calls = [];
    const dispatch = new Function('__bucket', '__said', '__api', `
      const caseId = 'abc';
      const storage = {};
      const ref = (_s, path) => ({ path });
      const uploadBytesResumable = (r, file, meta) => {
        __bucket.set(r.path, { file, meta });
        return { on: (_e, _p, _f, done) => done && done() };
      };
      const api = async (body) => { __api.push(body); return { ok: true }; };
      const say = (k, text, o) => { __said.push({ k, text, tone: (o && o.tone) || 'ok' }); };
      const load = () => {};
      const alert = () => {};
      // A document with just enough of one to register and fire an event.
      const listeners = {};
      const document = {
        addEventListener: (name, fn) => { listeners[name] = fn; },
        getElementById: () => ({ hidden: true, textContent: '' }),
        querySelectorAll: () => [],
      };
      const authorityDocHtml = (o) => '<pre>BLANK FORM ' + o.kind + '</pre>';
      ${TZ}
      ${FORMS};
      ${DAY}
      ${STAMP}
      ${SEND}
      ${SEAM}
      // Dispatched exactly as the advisor branch dispatches it, and READ BACK
      // SYNCHRONOUSLY, because that is the part of the contract that breaks
      // silently: an await anywhere before the assignment and the caller sees
      // null on a send that is actually running.
      return (kinds) => {
        const detail = { kinds, result: null };
        listeners['pa-send-forms']({ detail });
        return detail.result;
      };
    `)(bucket, said, calls);

    const handed = dispatch(['records', 'representative']);
    // NEGATIVE CONTROL (run 2026-08-28): making the listener `async` so the
    // assignment lands a microtask late made this read
    //   FAIL  U28g and it hands the promise back before dispatch returns  -- got null
    // null is the dispatcher's own "no sender on this page" answer, arrived at
    // on a send that was in fact running, which is the confusion this whole
    // shape exists to prevent.
    ck('U28g and it hands the promise back before dispatch returns',
      handed && typeof handed.then === 'function',
      `got ${handed === null ? 'null' : typeof handed}`);
    const seamOut = await Promise.resolve(handed).catch((e) => e);
    // NEGATIVE CONTROL (run 2026-08-28): dropping the ticked kinds on the
    // floor (`sendBlankForms([])`) made this read
    //   FAIL  U28h and it really sends, both forms, filed as formsent  -- 0 stored, handed back {"sent":[],"quiet":[]}
    // A seam that fires and stores nothing is the silent pass this check is
    // here to catch; the counts are numbers for that reason.
    ck('U28h and it really sends, both forms, filed as formsent',
      bucket.size === 2
      && [...bucket.values()].every((v) => v.meta?.customMetadata?.paCategory === 'formsent')
      && seamOut?.sent?.length === 2,
      `${bucket.size} stored, handed back ${JSON.stringify(seamOut)}`);
  }

  // ---- U27: the copy stopped promising a thing that is parked -------------
  //
  // The panel told him, for a client without the tier, "and signing in the app
  // opens when they upgrade". In-app signing was PARKED the day before
  // (OFFER_AUTHORITY_SIGNING = false in public/js/case.js), so the sentence
  // was false, and false in the direction that matters: it was telling ERIC
  // something untrue about his own tool, on the panel he reaches for while a
  // client is on the phone.
  {
    const panel = lifted('formPanel',
      slab(ADMINCASE, '<details class="mgmt" data-k="auth">', '</details>'),
      'data-k="sched"', ADMINCASE);
    // NEGATIVE CONTROL (run 2026-08-28): putting the old sentence back made
    // this read
    //   FAIL  U27 the form panel no longer promises signing in the app  -- signing in the app
    ck('U27 the form panel no longer promises signing in the app',
      panel.length > 0
      && !/signing in the app|sign in the app|opens when they upgrade/i.test(panel),
      (panel.match(/signing in the app|sign in the app|opens when they upgrade/i) || [])[0]
        || 'panel not found');
    // NEGATIVE CONTROL (run 2026-08-28): deleting the "by hand" sentence made
    // this read
    //   FAIL  U27b and says what actually happens instead
    // Correcting a false line by deleting it leaves him with no answer to "so
    // how DOES this get signed".
    ck('U27b and says what actually happens instead',
      /by hand/.test(panel) && /send it back/.test(panel) && /filled form/.test(panel));
    // NEGATIVE CONTROL (run 2026-08-28): flipping OFFER_AUTHORITY_SIGNING to
    // true made this read
    //   FAIL  U27c and the client-side signing offer is still parked
    // Nothing in this change may un-park it.
    ck('U27c and the client-side signing offer is still parked',
      /const OFFER_AUTHORITY_SIGNING = false;/.test(CLIENT));
    // NEGATIVE CONTROL (run 2026-08-28): hard-coding the two rows in the
    // markup instead of mapping SENDABLE_FORMS made this read
    //   FAIL  U27d one list of forms drives the ticks, the Print buttons and the file names
    // Two lists is how a tick labelled one thing sends a file called another.
    ck('U27d one list of forms drives the ticks, the Print buttons and the file names',
      /\$\{SENDABLE_FORMS\.map\(/.test(panel)
      && /data-form-pick="\$\{f\.id\}"/.test(panel)
      && /data-blank="\$\{f\.id\}"/.test(panel)
      && /\$\{form\.label\} \$\{mountainDay\(\)\}\.html/.test(ADMINCASE));
  }
}

// ---- U28i: not one of those lifts came back empty ------------------------
//
// The blanket version of what U20 and U12 do for one slab each, and it exists
// because U18 did not have one. U18 read `!regex.test(slab(...))`, so a lost
// lift gave '' , the regex did not match it, and the negation made it PASS:
// the suite reported 67/67 while that check asserted nothing at all. Any
// future check written in that shape is covered here whether or not its
// author remembers, which is the point of doing it once for all of them
// rather than twelve times.
//
// NEGATIVE CONTROL (run 2026-08-28): pointing the U18 slab at a route that
// does not exist made this read
//   FAIL  U28i every lift this suite takes came back with something in it  -- empty: summaryRoute
// and on the same run U18 itself, before it was strengthened, read PASS.
//
// The count floor is the second half and catches the other direction, a slab
// quietly dropping out of the measured set:
// NEGATIVE CONTROL (run 2026-08-28): taking lifted() off the form panel slab
// made this read
//   FAIL  U28i every lift this suite takes came back with something in it  -- 11 lifts, expected at least 12
//
// THE FLOOR MOVED TO FOURTEEN, 2026-08-28, and the gap it closes is the reason
// to say so out loud. Two more slabs were registered when the name-resolving
// lifts were measured, but this line was left at twelve. Fourteen registered
// against a floor of twelve means TWO COULD BE DROPPED AND THIS STAYS GREEN,
// which is precisely the silent drop the floor exists to prevent, sitting
// inside the floor itself. Caught by a peer working the same merge from the
// other side, and confirmed here by removing two registrations and watching a
// green run.
//
// The floor and the registry have to move together. If that feels like a
// thing that will be forgotten again, it is, and the honest mitigation is
// that the size table prints every run.
//
// NEGATIVE CONTROL AT THE NEW LEVEL (run 2026-08-28): taking lifted() off the
// two name-resolving slabs made this read
//   FAIL  U28i every lift this suite takes came back with something in it  -- 12 lifts, expected at least 14
//
// The 11-of-12 line above is left as it was recorded rather than rewritten to
// fit the new number. An observation edited to match a later state stops being
// an observation.
//
// Note what it does NOT catch, so nobody trusts it further than it goes: a
// NEW slab added without lifted() leaves the count at fourteen and passes. The
// floor guards the fourteen that are here; adding a fifteenth is a thing a
// person still has to do on purpose.
{
  const empties = [...LIFTS].filter(([, v]) => v.size === 0).map(([k]) => k);
  ck('U28i every lift this suite takes came back with something in it',
    LIFTS.size >= LIFT_FLOOR && empties.length === 0,
    empties.length ? `empty: ${empties.join(', ')}` : `${LIFTS.size} lifts, expected at least ${LIFT_FLOOR}`);
}

// ---- U28j: and not one of them ran past where it should have stopped -----
//
// The blanket version of U12b and U20b, which name the neighbours of two
// lifts by hand. This asks the same question of all twelve, and it asks it of
// any thirteenth that goes through lifted(), because the sentinel is a
// REQUIRED argument rather than an optional one. Adapted from the advisor
// branch's A30d after it made the same generalisation on its side.
//
// The reason it is a sentinel and not a tail assertion is written out at
// `lifted` above: eleven of these twelve come from slab(), which returns a
// string ending in its own `to` marker by construction, so asserting the tail
// is asserting nothing. Naming what should lie BEYOND the end is the version
// that catches a `to` marker matching half a file too late.
//
// TWO NEGATIVE CONTROLS, both run 2026-08-28 and both observed:
//   the form panel slab run on to the NEXT panel ->
//     FAIL  U28j no lift ran past where it should have stopped  -- formPanel swallowed "data-k=\"sched\""
//     with the size line reading formPanel 7219 instead of 1796 on the same run
//   a lift registered with no sentinel at all ->
//     FAIL  U28j no lift ran past where it should have stopped  -- formPanel declares no sentinel
//
// AND ONE CONTROL THAT DID NOT REACH THIS CHECK, recorded because it says
// something about the order things fail in rather than about this check.
// Running sendBlankForms on to the seam listener does trip U20b
//     FAIL  U20b ... -- 6540 chars, ends "detail.kinds || []);\n});", swallowed: the seam
// but the run then dies at a TypeError inside the harness, because the
// swallowed listener calls document.addEventListener and the stand-in
// document does not have one. So U28j is never reached on that particular
// break. That is the lift refusing to run code the harness does not stub,
// which is a loud failure and the outcome we want; it is simply not this
// check's outcome, and claiming it here would be recording a FAIL line that
// was never printed.
{
  const bad = [];
  for (const [name, v] of LIFTS) {
    if (typeof v.after !== 'string' || !v.after) { bad.push(`${name} declares no sentinel`); continue; }
    if (v.text.includes(v.after)) bad.push(`${name} swallowed ${JSON.stringify(v.after)}`);
  }
  // Its own floor, not U28i's. See LIFT_FLOOR above for why.
  if (LIFTS.size < LIFT_FLOOR) bad.unshift(`${LIFTS.size} lifts, expected at least ${LIFT_FLOOR}`);
  ck('U28j no lift ran past where it should have stopped', bad.length === 0, bad.join('; '));

  // U28k: AND THE SENTINEL ITSELF HAS TO BE REAL.
  //
  // Raised by the advisor branch, which hit it in its own version of this and
  // was right that the same hole was open here. U28j asks whether the sentinel
  // is absent from the capture. A sentinel with a TYPO IN IT is absent too,
  // for entirely the wrong reason, and U28j passes on it: our own bug class,
  // pointed straight at our own fix for it.
  //
  // So each sentinel must be found in the source the slab came from, AT OR
  // AFTER where the capture ends. "The string exists somewhere in the file" is
  // not enough on its own: a sentinel copied from EARLIER in the file is real,
  // is absent from the capture, and still proves nothing about where the slab
  // stopped. That is the control worth keeping.
  //
  // TWO NEGATIVE CONTROLS, both run 2026-08-28 and both observed:
  //   a typo in a sentinel ->
  //     FAIL  U28k -- upload sentinel "WHAT A DOCUMENT HE UPLOADZ IS" is not
  //           in its own source
  //   a real string taken from EARLIER in the same file ->
  //     FAIL  U28k -- upload sentinel "const MOUNTAIN_TZ" is nowhere at or
  //           after the end of the lift
  //
  // The first attempt at that second control used 'const UPLOAD_CATEGORIES',
  // which PASSED, and rightly: that constant is declared after this slab, so
  // it is a perfectly good sentinel. Picking a control that does not break the
  // thing it is aimed at proves nothing about the check, and recording it as a
  // proof would have been the same mistake this check exists to catch.
  const unreal = [];
  for (const [name, v] of LIFTS) {
    if (!v.src || typeof v.after !== 'string' || !v.after) continue;  // U28j owns those
    if (v.src.indexOf(v.after) < 0) {
      unreal.push(`${name} sentinel ${JSON.stringify(v.after)} is not in its own source`);
      continue;
    }
    const start = v.src.indexOf(v.text);
    if (start < 0) { unreal.push(`${name} lift is not in the source it names`); continue; }
    // SEARCH FROM THE END OF THE LIFT, not from the top of the file.
    //
    // The first cut of this took the FIRST occurrence anywhere and failed if it
    // sat before the slab. That is over-strict, and the forms branch was right
    // to point it out: a sentinel that appears both early in the file AND after
    // the slab is a perfectly good sentinel. U28j still proves the capture does
    // not contain it, and this proves one lies beyond the end. Rejecting it
    // would have produced false failures on valid work, which is its own way of
    // teaching people to relax a check.
    if (v.src.indexOf(v.after, start + v.text.length) < 0)
      unreal.push(`${name} sentinel ${JSON.stringify(v.after)} is nowhere at or after the end of the lift`);
  }
  // Its own floor too, for the same reason.
  if (LIFTS.size < LIFT_FLOOR) unreal.unshift(`${LIFTS.size} lifts, expected at least ${LIFT_FLOOR}`);
  ck('U28k and every sentinel is real, and really lies beyond its slab',
    unreal.length === 0, unreal.join('; '));

  // NEGATIVE CONTROL (2026-08-28): dropping the source from one lifted() call
  //   FAIL  U28l every lift names the source it came from  -- handleCaseUpdate
  const sourceless = [...LIFTS].filter(([, v]) => !v.src).map(([n]) => n);
  ck('U28l every lift names the source it came from', sourceless.length === 0, sourceless.join(', '));
}

// EVERY LIFT, AND ITS SIZE, ON EVERY RUN. See `lifted` at the top: green is
// not the claim worth making about a slab, green and unchanged is.
console.log(`\nlifted: ${liftTable()}`);

// ---- the star (Eric, 2026-08-30) ------------------------------------------
//
// "I want to be able to pin uploads to the top by 'star-ing' them. They're
// priority, like forms the client needs to fill out." The pin is Storage
// metadata riding the same lane the category label uses, so every pin here
// mirrors a category pin that already exists.
{
  // Pins updated the same day (Eric, 2026-08-30, second message): the star
  // became a visible ☆ button on every row ("It's not a long press, that
  // causes issues"), and the stored value became the starring MOMENT so the
  // pinned order is the order he starred them.
  // NEGATIVE CONTROL (run 2026-08-30): dropping the starred branch from the
  // Worker's meta route made this read
  //   FAIL  the star rides the meta route: boolean in, its moment or gone in the map
  ck('the star rides the meta route: boolean in, its moment or gone in the map',
    /if \('starred' in body\) \{\n    patch\.paStarred = body\.starred === true \? String\(Date\.now\(\)\) : null;\n  \}/.test(WORKER)
    && /starred: !!out\.custom\?\.paStarred,/.test(WORKER)
    && /if \(body\.starred === true\) meta\.paStarred = String\(Date\.now\(\)\); else delete meta\.paStarred;/.test(DEMOAPI));

  // Pin updated 2026-08-30 (third message): the glyph is the ⭐ emoji, faded
  // until pinned, with no button box ("this empty star box should simply be
  // filled with"); the saved shelf gets no star because the meta route
  // refuses its paths by design; and refreshFiles carries a generation
  // stamp because two overlapping refreshes let the OLDER paint land last,
  // which is how a second pin looked refused ("It's not letting me pin
  // multiple uploads").
  // NEGATIVE CONTROL (run 2026-08-30): removing the [data-star] wiring made
  // this read
  //   FAIL  every row wears a bare tappable star, the pin holds star order, and a stale repaint never wins
  ck('every row wears a bare tappable star, the pin holds star order, and a stale repaint never wins',
    /starAt: Number\(meta\.customMetadata\?\.paStarred\) \|\| 0,/.test(ADMINCASE)
    && /r\.kind === 'saved' \? '' : `<button class="star-tap" data-star="\$\{i\}"/.test(ADMINCASE)
    && />⭐<\/button>/.test(ADMINCASE)
    && /opacity:\.35; filter:grayscale\(1\);/.test(ADMINCASE)
    && /listEl\.querySelectorAll\('\[data-star\]'\)\.forEach/.test(ADMINCASE)
    && /const gen = \+\+filesGen;/.test(ADMINCASE)
    && /if \(gen !== filesGen\) return;/.test(ADMINCASE)
    && /\.sort\(\(x, y\) => \(x\.starAt \|\| 0\) - \(y\.starAt \|\| 0\)\);/.test(ADMINCASE)
    && !/act: 'star'/.test(ADMINCASE)
    && /⭐ Priority/.test(ADMINCASE)
    && /listEl\.innerHTML = short \+ pinnedHtml \+/.test(ADMINCASE)
    && /saveFileMeta\(r, \{ starred: !r\.starred \}\)/.test(ADMINCASE));

  // NEGATIVE CONTROL (run 2026-08-30): dropping the starred term from the
  // client's sort made this read
  //   FAIL  the client's Documents put starred files first, in his star order, under a heading that says why
  ck('the client\'s Documents put starred files first, in his star order, under a heading that says why',
    /starred: !!meta\.customMetadata\?\.paStarred,/.test(CLIENT)
    && /rows\.sort\(\(a, b\) => \(b\.starred \? 1 : 0\) - \(a\.starred \? 1 : 0\)/.test(CLIENT)
    && /a\.starred && b\.starred \? \(a\.starAt \|\| 0\) - \(b\.starAt \|\| 0\) : 0/.test(CLIENT)
    && /⭐ Needs your attention first/.test(CLIENT)
    && /Everything else/.test(CLIENT));
}

// ---- the uploads search (Eric, 2026-08-30) --------------------------------
//
// "There's a search bar to search for key terms that pull up uploads."
// Typing filters the CACHED listing (never a fresh Storage list per
// keystroke), the day pager stands down while a term is in the box, and the
// pinned block rides above the results untouched.
{
  // NEGATIVE CONTROL (run 2026-08-30): rewiring the keystroke to a plain
  // refreshFiles() relist made this read
  //   FAIL  U80 the search box filters from cache and lives outside the repainted list
  ck('U80 the search box filters from cache and lives outside the repainted list',
    /id="up-search"/.test(ADMINCASE)
    && /refreshFiles\(\{ fromCache: true \}\)/.test(ADMINCASE)
    && /if \(fromCache && filesRows\) \{/.test(ADMINCASE)
    && /fileQuery = '';/.test(ADMINCASE));
  // NEGATIVE CONTROL (run 2026-08-30): running the pager while a term was in
  // the box made this read
  //   FAIL  U81 a term flattens the days, stands the pager down, and keeps the pins on top
  ck('U81 a term flattens the days, stands the pager down, and keeps the pins on top',
    /const hits = q \? rows\.filter\(\(r\) => `\$\{readName\(r\)\} \$\{label\(r\)\}`\.toLowerCase\(\)\.includes\(q\)\)/.test(ADMINCASE)
    && /listEl\.innerHTML = short \+ pinnedHtml \+ daysHtml;/.test(ADMINCASE)
    && /if \(!q\) pageByDay\('files'/.test(ADMINCASE));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
