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
  ck('U16d and sending a form moves NOTHING on the case',
    form.writes.length === 0,
    `${form.writes.length} write: ${JSON.stringify(form.writes.map((w) => w.fields))}`);
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
  const TZ = slab(ADMINCASE, "const MOUNTAIN_TZ = ", ";");
  const FORMS = slab(ADMINCASE, 'const SENDABLE_FORMS = [', '];');
  const DAY = slab(ADMINCASE, 'function mountainDay(d = new Date()) {', '\n}');
  const STAMP = slab(ADMINCASE, 'let lastStamp = 0;', '\n}');
  const SEND = slab(ADMINCASE, 'async function sendBlankForms(kinds, btn) {', '\n  load();\n}');
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
    ck('U26 nothing ticked stores nothing, and he is told why',
      none.bucket.size === 0 && none.said.length === 0
      && none.shouted.some((m) => /Tick at least one form/.test(m))
      && /Tick at least one form/.test(refused),
      `${none.bucket.size} stored, said "${none.shouted.join(' ')}", threw "${refused}"`);
    // NEGATIVE CONTROL (run 2026-08-28): trusting `kinds` instead of filtering
    // it against SENDABLE_FORMS made this read
    //   FAIL  U26b and a kind that is not one of his forms sends nothing at all  -- 3 stored: cases/abc/report/1787889831374-formfilled 2026-08-27.html, cases/abc/report/1787889831375-.._.._.._etc_passwd 2026-08-27.html, cases/abc/report/1787889831376-report 2026-08-27.html
    // Nothing that is not one of his two forms can be talked into Storage, and
    // nothing can put a chosen string into a Storage path.
    const forged = build();
    await forged.fn(['formfilled', '../../../etc/passwd', 'report']).catch(() => {});
    ck('U26b and a kind that is not one of his forms sends nothing at all',
      forged.bucket.size === 0,
      `${forged.bucket.size} stored: ${[...forged.bucket.keys()].join(', ')}`);
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

  // ---- U27: the copy stopped promising a thing that is parked -------------
  //
  // The panel told him, for a client without the tier, "and signing in the app
  // opens when they upgrade". In-app signing was PARKED the day before
  // (OFFER_AUTHORITY_SIGNING = false in public/js/case.js), so the sentence
  // was false, and false in the direction that matters: it was telling ERIC
  // something untrue about his own tool, on the panel he reaches for while a
  // client is on the phone.
  {
    const panel = slab(ADMINCASE, '<details class="mgmt" data-k="auth">', '</details>');
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

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
