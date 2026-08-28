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

// ---- U1-U4: two files with one name must BOTH survive --------------------
// Lifted and run against a Storage stand-in that behaves the way Storage
// behaves: a repeated path overwrites, without a word.
{
  const body = slab(ADMINCASE, 'async function upload(file, kind, milestoneAction',
    '  bar.hidden = true;\n}');
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
  ck('U2b and both are under the case, in the report folder',
    paths.every((p) => p.startsWith('cases/abc/report/')), paths.join(' '));
  // The display layer has to put the name back, or every file a client reads
  // grows a thirteen-digit number in front of it.
  const shown = (n) => String(n).replace(/^\d{10,}-/, '');
  // Pinned to the LINE THAT RENDERS THE NAME, not to the regex appearing
  // somewhere in the file. The first version tested for the pattern anywhere
  // in case.js and stayed green with the file list's own stripper deleted,
  // because a second copy lives in the delete confirmation. A check that
  // passes when the thing it guards is gone is worse than no check.
  const clientName = slab(CLIENT, 'const shownName =', "');");
  const adminName = slab(ADMINCASE, '<span class="fname"><span class="kind-pill ${pillClass(r)}',
    '</a></span>');
  ck('U3 and the prefix is stripped where a person reads the name',
    paths.every((p) => shown(p.split('/').pop()) === 'Summary.pdf')
    && /replace\(\/\^\\d\{10,\}-\//.test(clientName)
    && /esc\(shownName\(r\.name\)\)/.test(CLIENT)
    && /replace\(\/\^\\d\{10,\}-\//.test(adminName),
    paths.map((p) => shown(p.split('/').pop())).join(' '));
  // NEGATIVE CONTROL: dropping the customMetadata argument made this read
  //   FAIL  U4 ... -- [null,null]
  ck('U4 the category rides on the file as metadata, and is what he picked',
    [...bucket.values()].every((v) => v.meta && v.meta.paCategory === 'callsummary'),
    JSON.stringify([...bucket.values()].map((v) => v.meta)));
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
  ck('U8 the advocate side declares the categories in one place',
    adminCats.length >= 6, `${adminCats.length} found`);
  const clientCats = [...CLIENT.matchAll(/(\w+): \{ label: '([^']*)', at: (\d+) \}/g)]
    .map((m) => ({ id: m[1], label: m[2], at: Number(m[3]) }));
  // NEGATIVE CONTROL: renaming CALL SUMMARY to CALL NOTE on the client side
  // only made this read
  //   FAIL  U9 ... -- admin CALL SUMMARY|REPORT|VISIT FOLLOW-UP vs client CALL NOTE|REPORT|VISIT FOLLOW-UP
  const sorted = (a) => a.slice().sort().join('|');
  ck('U9 and the client\'s pill says exactly the same words for them',
    sorted(adminCats.map((c) => c.pill)) === sorted(clientCats.map((c) => c.label)),
    `admin ${sorted(adminCats.map((c) => c.pill))} vs client ${sorted(clientCats.map((c) => c.label))}`);
  // NEGATIVE CONTROL: a one-letter case difference on the client side made
  // this read
  //   FAIL  U9b ... -- admin callsummary|report|visitfollowup vs client callsummary|report|visitfollowUp
  ck('U9b and the same ids, so a stored label cannot land on nothing',
    sorted(adminCats.map((c) => c.id)) === sorted(clientCats.map((c) => c.id)),
    `admin ${sorted(adminCats.map((c) => c.id))} vs client ${sorted(clientCats.map((c) => c.id))}`);
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
    new Set(catRanks).size === catRanks.length,
    `${catRanks.length} categories, ${new Set(catRanks).size} distinct ranks`);
  // Every group name a category can produce has to exist in FILE_GROUPS, or
  // the file renders under a heading the page never prints and vanishes.
  const groups = (ADMINCASE.match(/const FILE_GROUPS = \[[\s\S]*?\];/) || [''])[0];
  // NEGATIVE CONTROL: dropping 'Visit follow-ups' from FILE_GROUPS made this
  // read
  //   FAIL  U10 ... -- Visit follow-ups is not in FILE_GROUPS
  const missing = adminCats.map((c) => c.group).filter((g) => !groups.includes(`'${g}'`));
  ck('U10 every category has a heading the Uploads page actually prints',
    missing.length === 0, `${missing.join(', ')} is not in FILE_GROUPS`);
  // Four tabs per group at 320px is a hard limit. These are day headings on a
  // page, not tabs, and the tab strip must not have grown.
  const strip = (ADMINCASE.match(/groups: \[[\s\S]*?\n    \],/) || [''])[0];
  // NEGATIVE CONTROL: adding two pages to the Case group made this read
  //   FAIL  U10b ... -- pages: ['overview', 'chat', 'files', 'a', 'b'] ...
  // Four per group at 320px is a hard limit; this suite touches the Uploads
  // page's HEADINGS, which are not tabs, and this is what says so.
  ck('U10b and no group in the tab strip grew a fifth page',
    (strip.match(/pages: \[[^\]]*\]/g) || [])
      .every((p) => (p.match(/'/g) || []).length / 2 <= 4),
    (strip.match(/pages: \[[^\]]*\]/g) || []).join(' '));
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
  ck('U11b with no literal colour anywhere near it',
    !pills.some((p) => /#[0-9a-f]{3,8}|rgba?\(/i.test(p)));
  // The form pair. Eric, 2026-08-27: "A 'form sent to client' should be
  // included as a category. Then once it's filled out and sent back to me
  // I'll delete the one I sent him and reupload that and categorize it as
  // 'filled forms'. All color coded." Two points in one document's life, so
  // they must not share a colour with each other, and NOT green: green is
  // what "from chat" already means in this same list, and one colour with two
  // meanings in one list is worse than no colour at all.
  const tokenOf = (name) => {
    const rule = pills.find((x) => new RegExp(`\\.kind-pill\\.${name}\\b`).test(x));
    return rule ? (rule.match(/color: (var\(--\w+\))/) || [])[1] || '' : '';
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
}

// ---- U12-U16: the client is told, by name, and nothing else moves --------
// LIFTED AND RUN. report-uploaded marks the case DELIVERED, which starts their
// 48 hours and closes the chat after it. A call summary doing that would end
// a case because he filed a note.
{
  const fn = (WORKER.match(/async function handleCaseUpdate\(request, env\) \{[\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL: renaming handleCaseUpdate made this read
  //   FAIL  U12 handleCaseUpdate lifts out of the shipped Worker
  ck('U12 handleCaseUpdate lifts out of the shipped Worker', fn.length > 0);
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
  ck('U13 filing a call summary moves NOTHING on the case',
    !out.threw && out.res?.status === 200 && out.writes.length === 0,
    out.threw || `${out.writes.length} write, status ${JSON.stringify(out.writes[0]?.fields)}`);
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
  ck('U15 an unknown document type is refused, and nothing is sent',
    !forged.threw && forged.res?.status === 400 && forged.pushes.length === 0,
    forged.threw || `status ${forged.res?.status}, ${forged.pushes.length} push`);
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
  ck('U18 no path here reads, writes or summarises a document',
    !/runAnalysis|runCallNotes|advisor/i.test(slab(WORKER,
      "} else if (action === 'summary-uploaded') {", "} else if (action === 'report-uploaded') {")));
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

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
