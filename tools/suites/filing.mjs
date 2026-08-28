// filing.mjs - renaming a file after it has landed, and filing it as one of
// his document types. The long press on a file row, from both ends.
//
// Eric, 2026-08-27: "the advisor/app should take anything uploaded in the chat
// and add it to forms. I can long press and rename them."
//
// Asked whether every chat upload should file ITSELF as a form, he chose:
// "Filable, I choose." So nothing here files anything on its own. A file a
// client shares keeps saying FROM CHAT until he presses it and says what it
// is, and the whole of this feature is the ability to say so.
//
// TWO THINGS THIS SUITE EXISTS TO STOP.
//
// The first is a client reaching his filing system. Renaming and filing are a
// Worker route behind requireAdmin that answers 404 to everyone else, and NOT
// the browser's updateMetadata, which would have needed storage.rules widened
// to let a client write metadata onto a case file. A client who could do that
// could rename the report, or file their own chat upload as a filled form.
//
// The second is a file quietly leaving the record. A Storage object cannot be
// renamed - the name IS the identity - so a rename that "worked" by copying to
// a new name and deleting the old one would change the path every download URL
// and every chat attachment already points at. The bytes must not move, and
// these checks run the handler and look at what it actually did.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f(import.meta.url)), '..', '..');
const read = (p) => readFileSync(j(ROOT, p), 'utf8');
const WORKER = read('worker/index.js');
const STORAGE = read('worker/storage.js');
const ADMINCASE = read('public/js/admin-case.js');
const CLIENT = read('public/js/case.js');
const DEMOAPI = read('public/js/demo/api.js');
const RULES = read('storage.rules');

const results = [];
const ck = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
/** Comments stripped: no build step, so a comment is a served byte and a
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

// =========================================================================
// F1-F11: the route, LIFTED AND RUN against a Storage stand-in
// =========================================================================
// The stand-in records every call it is given, so these assert what came out
// rather than what the source looks like. A handler that refused everything
// would satisfy half of them, which is what F11 is for.
{
  const body = slab(WORKER, 'async function handleFileMeta(request, env) {', '\n}');
  const cats = slab(WORKER, 'const FILING_CATEGORIES = [', '];');
  // NEGATIVE CONTROL (run 2026-08-28): renaming handleFileMeta made this read
  //   FAIL  F1 the filing route lifts out of the shipped Worker  -- 0 chars of handler, 112 of list
  // A lift that has lost its target goes red rather than asserting nothing.
  ck('F1 the filing route lifts out of the shipped Worker',
    body.length > 0 && cats.length > 0,
    `${body.length} chars of handler, ${cats.length} of list`);

  const calls = [];
  const make = (isAdmin) => new Function('__calls', `
    const json = (o, s) => ({ status: s || 200, body: o });
    const requireAdmin = async () => (${isAdmin} ? { uid: 'admin' } : null);
    const threadContext = async (env, user, kind, id) => ({
      clientUid: 'client-1', isAdmin: true,
      parent: kind === 'case' ? 'cases' : 'subscriptions',
    });
    const patchObjectMeta = async (env, path, custom) => {
      __calls.push({ fn: 'patch', path, custom });
      const out = {};
      for (const [k, v] of Object.entries(custom)) if (v !== null) out[k] = v;
      return { path, custom: out };
    };
    const deleteFile = async (env, path) => { __calls.push({ fn: 'delete', path }); };
    const objectMeta = async () => null;
    ${cats}
    ${body}
    return handleFileMeta;
  `)(calls);

  const run = async (reqBody, { isAdmin = true } = {}) => {
    calls.length = 0;
    const handler = make(isAdmin);
    try {
      const res = await handler({ json: async () => reqBody }, {});
      return { res, calls: calls.slice() };
    } catch (e) {
      // Empty array, never undefined: a throw must fail its own check rather
      // than take every check after it down with a TypeError.
      return { threw: `${e.constructor.name}: ${e.message}`, calls: [] };
    }
  };

  const CHATFILE = 'cases/abc/chat-files/1787880535918-IMG_4127.HEIC';

  // ---- the client cannot reach it at all -------------------------------
  const asClient = await run({ kind: 'case', id: 'abc', path: CHATFILE, name: 'Mine now' },
    { isAdmin: false });
  // NEGATIVE CONTROL (run 2026-08-28): dropping the `if (!admin)` guard made
  // this read
  //   FAIL  F2 ... -- status 200, 1 storage call
  // which is a client renaming a file in Eric's case record.
  ck('F2 a caller who is not Eric gets nowhere, and nothing is written',
    !asClient.threw && asClient.res?.status === 404 && asClient.calls.length === 0,
    asClient.threw || `status ${asClient.res?.status}, ${asClient.calls.length} storage call`);
  // NEGATIVE CONTROL (run 2026-08-28): answering 403 'Admin only' made this read
  //   FAIL  F3 ... -- 403 Admin only
  // A refusal that admits the route exists is an existence oracle, which is
  // the thing every admin route in this Worker is shaped to avoid.
  ck('F3 and the refusal is the same 404 a path that is not there gets',
    asClient.res?.status === 404 && asClient.res?.body?.error === 'Not found',
    `${asClient.res?.status} ${asClient.res?.body?.error}`);

  // ---- the rename ------------------------------------------------------
  const renamed = await run({
    kind: 'case', id: 'abc', path: CHATFILE, name: '  Signed  records   release  ',
  });
  // NEGATIVE CONTROL (run 2026-08-28): dropping the whitespace flattening
  // from the typed name made this read
  //   FAIL  F4 ... -- [{"fn":"patch","path":"cases/abc/chat-files/...","custom":{"paName":"  Signed  records   release  "}}]
  ck('F4 Eric renaming a file writes the name he typed onto that same file',
    renamed.res?.status === 200
    && renamed.calls.length === 1
    && renamed.calls[0].fn === 'patch'
    && renamed.calls[0].custom.paName === 'Signed records release',
    renamed.threw || JSON.stringify(renamed.calls));
  // THE BYTES DO NOT MOVE. This is the whole reason the display name exists.
  // NEGATIVE CONTROL (run 2026-08-28): making the handler also call
  // deleteFile after the patch (the copy-and-delete shape a "real" rename
  // would take) made this read
  //   FAIL  F5 ... -- patch,delete
  ck('F5 and NOTHING else happens to it: no copy, no delete, same path',
    renamed.calls.every((c) => c.fn === 'patch')
    && renamed.calls.every((c) => c.path === CHATFILE),
    renamed.calls.map((c) => c.fn).join(','));
  // A rename must not clear the category, and a filing must not clear the
  // name. Only the field asked for is in the patch; everything else in that
  // metadata map is left alone, INCLUDING firebaseStorageDownloadTokens,
  // which every existing download URL depends on.
  // NEGATIVE CONTROL (run 2026-08-28): sending
  // `{ paName: name || null, paCategory: category || null }` unconditionally
  // made this read
  //   FAIL  F6 ... -- paName,paCategory
  // and that is the run where a rename silently unfiled a filled form.
  ck('F6 and only the field he changed is in the write',
    Object.keys(renamed.calls[0]?.custom || {}).join(',') === 'paName',
    Object.keys(renamed.calls[0]?.custom || {}).join(','));

  // ---- the filing ------------------------------------------------------
  const filed = await run({
    kind: 'case', id: 'abc', path: CHATFILE, category: 'formfilled',
  });
  // NEGATIVE CONTROL (run 2026-08-28): filing by moving the object into a
  // `cases/abc/formfilled/` prefix made this read
  //   FAIL  F7 ... -- [{"fn":"patch","path":"cases/abc/formfilled/1787880535918-IMG_4127.HEIC","custom":{"paCategory":"formfilled"}}]
  // which is the exact mistake storage.rules cannot survive: it grants a
  // client read on four named folders and that is not one of them.
  ck('F7 filing a chat upload labels it and LEAVES IT IN chat-files',
    filed.res?.status === 200
    && filed.calls.length === 1
    && filed.calls[0].custom.paCategory === 'formfilled'
    && filed.calls[0].path === CHATFILE,
    filed.threw || JSON.stringify(filed.calls));

  const forged = await run({
    kind: 'case', id: 'abc', path: CHATFILE,
    category: 'Your case is closed, call this number',
  });
  // NEGATIVE CONTROL (run 2026-08-28): taking the caller's category on trust
  // made this read
  //   FAIL  F8 ... -- status 200, 1 write
  // with the fixture's own sentence stored on the file as its label, which
  // both listings render as a filing pill.
  ck('F8 a document type he never named is refused, and nothing is written',
    forged.res?.status === 400 && forged.calls.length === 0,
    forged.threw || `status ${forged.res?.status}, ${forged.calls.length} write`);

  const shelf = await run({
    kind: 'case', id: 'abc', path: 'profiles/client-1/saved/1787880535918-note.pdf',
    category: 'formfilled',
  });
  // NEGATIVE CONTROL (run 2026-08-28): adding profiles/ to the route's own
  // folder list made this read
  //   FAIL  F9 ... -- status 200, 1 write
  ck('F9 the client\'s own saved shelf is not his to file or rename',
    shelf.res?.status === 400 && shelf.calls.length === 0,
    shelf.threw || `status ${shelf.res?.status}, ${shelf.calls.length} write`);

  const cleared = await run({ kind: 'case', id: 'abc', path: CHATFILE, name: '   ' });
  // NEGATIVE CONTROL (run 2026-08-28): storing '' instead of null made this
  // read
  //   FAIL  F10 ... -- {"paName":""}
  // and an empty string is a real value in a metadata map: the file would
  // then read as having no name at all rather than falling back to the one
  // it was uploaded with.
  ck('F10 clearing the name removes the key, so the uploaded name comes back',
    cleared.res?.status === 200 && cleared.calls[0]?.custom.paName === null,
    JSON.stringify(cleared.calls[0]?.custom));

  const nothing = await run({ kind: 'case', id: 'abc', path: CHATFILE });
  // NEGATIVE CONTROL (run 2026-08-28): dropping the nothing-to-change guard
  // made this read
  //   FAIL  F10b asking for no change at all writes nothing  -- status 200, 1 write
  // An empty patch is a request to Google that says nothing and costs a round
  // trip, sent every time a sheet is dismissed the wrong way.
  ck('F10b asking for no change at all writes nothing',
    nothing.res?.status === 400 && nothing.calls.length === 0,
    `status ${nothing.res?.status}, ${nothing.calls.length} write`);

  // THE SILENT PASS GUARD. Every check above is satisfied by a handler that
  // refuses everything, and a route that refuses everything is exactly what a
  // careless edit produces. This one fails unless both kinds of write have
  // actually gone through to Storage in this run.
  // NEGATIVE CONTROL (run 2026-08-28): making the handler return 400 before
  // the patch on every request made this read
  //   FAIL  F11 ... -- names written 0, categories written 0
  // and F2, F3, F8, F9, F10b all stayed green on that same run, which is why
  // this check exists.
  const wroteName = renamed.calls.filter((c) => c.custom?.paName === 'Signed records release').length;
  const wroteCat = filed.calls.filter((c) => c.custom?.paCategory === 'formfilled').length;
  ck('F11 SOMETHING actually gets through: this is not a route that refuses everything',
    wroteName === 1 && wroteCat === 1,
    `names written ${wroteName}, categories written ${wroteCat}`);
}

// =========================================================================
// F12-F13: one vocabulary, three copies
// =========================================================================
{
  // Out of the UPLOAD_CATEGORIES slab specifically. Matching the object shape
  // across the whole file picked up four unrelated lists that happen to be
  // written the same way, and reported them as document types he can file
  // under (2026-08-28).
  const adminIds = [...slab(ADMINCASE, 'const UPLOAD_CATEGORIES = [', '];')
    .matchAll(/\{ id: '(\w+)',/g)].map((m) => m[1]);
  const listOf = (src) => {
    const raw = slab(src, 'const FILING_CATEGORIES = [', '];');
    return [...raw.matchAll(/'(\w+)'/g)].map((m) => m[1]);
  };
  const workerIds = listOf(WORKER);
  const demoIds = listOf(DEMOAPI);
  const same = (a, b) => a.length > 0 && a.slice().sort().join('|') === b.slice().sort().join('|');
  // NEGATIVE CONTROL (run 2026-08-28): dropping 'formfilled' from the
  // Worker's list made this read
  //   FAIL  F12 ... -- picks from report,callsummary,visitfollowup,apptsummary,formsent,formfilled; server takes report,callsummary,visitfollowup,apptsummary,formsent
  // A category he can pick and the server will not take is a long press that
  // ends in "That is not a document type I know."
  ck('F12 the list he picks from is the list the server will accept',
    same(adminIds, workerIds),
    `picks from ${adminIds.join(',')}; server takes ${workerIds.join(',')}`);
  // NEGATIVE CONTROL (run 2026-08-28): adding 'soapnote' to the demo's list
  // made this read
  //   FAIL  F13 ... -- demo takes report,callsummary,visitfollowup,apptsummary,formsent,formfilled,soapnote
  // A shim kinder than the Worker has hidden a real refusal here before.
  ck('F13 and the demo takes exactly the same six, no more',
    same(demoIds, workerIds), `demo takes ${demoIds.join(',')}`);
  // NEGATIVE CONTROL (run 2026-08-28): removing the demo's role check made
  // this read
  //   FAIL  F13b and it refuses everyone but Eric, exactly as the Worker does
  ck('F13b and it refuses everyone but Eric, exactly as the Worker does',
    /if \(path === '\/api\/file\/meta'\) \{\s*\n\s*if \(role !== 'admin'\) return fail\(404, 'Not found'\);/
      .test(DEMOAPI));
}

// =========================================================================
// F14-F17: a filed file cannot leave the record
// =========================================================================
// A file a client shared is theirs to take back, right up until Eric files it
// as a document. A filled form is precisely the file this list would let them
// remove, and the one nobody can afford to lose.
{
  const body = slab(WORKER, 'async function handleFileDelete(request, env) {', '\n}');
  // NEGATIVE CONTROL (run 2026-08-28): renaming handleFileDelete made this read
  //   FAIL  F14 the delete route lifts out of the shipped Worker
  ck('F14 the delete route lifts out of the shipped Worker', body.length > 0);

  const calls = [];
  const make = (isAdmin, meta, chatRows) => new Function('__calls', `
    const json = (o, s) => ({ status: s || 200, body: o });
    const requireUser = async () => ({ uid: ${isAdmin ? "'admin'" : "'client-1'"} });
    const threadContext = async (env, user, kind, id) => ({
      clientUid: 'client-1', isAdmin: ${isAdmin}, parent: 'cases',
    });
    const listDocs = async () => (${JSON.stringify(chatRows)});
    const objectMeta = async () => (${JSON.stringify(meta)});
    const deleteFile = async (env, path) => { __calls.push(path); };
    ${body}
    return handleFileDelete;
  `)(calls);

  const run = async (path, { isAdmin = false, meta = null, chatRows = [] } = {}) => {
    calls.length = 0;
    try {
      const res = await make(isAdmin, meta, chatRows)(
        { json: async () => ({ kind: 'case', id: 'abc', path }) }, {});
      return { res, deleted: calls.slice() };
    } catch (e) {
      return { threw: `${e.constructor.name}: ${e.message}`, deleted: [] };
    }
  };

  const CHATFILE = 'cases/abc/chat-files/1787880535918-intake.pdf';
  // The message that proves they shared it themselves, which is what the
  // route requires before a client may remove a chat file at all.
  const THEIRS = [{ data: { from: 'client-1', attachment: { path: CHATFILE } } }];

  const filed = await run(CHATFILE, {
    chatRows: THEIRS, meta: { custom: { paCategory: 'formfilled' } },
  });
  // NEGATIVE CONTROL (run 2026-08-28): removing the objectMeta check from the
  // client branch made this read
  //   FAIL  F15 ... -- status 200, deleted cases/abc/chat-files/1787880535918-intake.pdf
  // which is a client taking their own signed form back out of the case file.
  ck('F15 a client cannot delete a file Eric has FILED, even one they shared',
    filed.res?.status === 403 && filed.deleted.length === 0,
    filed.threw || `status ${filed.res?.status}, deleted ${filed.deleted.join(',')}`);

  const unfiled = await run(CHATFILE, { chatRows: THEIRS, meta: { custom: {} } });
  // THE SILENT PASS GUARD for F15: a route that refused every client delete
  // would satisfy it, and would also take away something Eric explicitly gave
  // them (2026-08-22: "They should too, so long as they themselves uploaded
  // it").
  // NEGATIVE CONTROL (run 2026-08-28): refusing on the PRESENCE of metadata
  // rather than on a category made this read
  //   FAIL  F16 ... -- status 403, deleted
  ck('F16 and their own UNFILED chat upload is still theirs to remove',
    unfiled.res?.status === 200 && unfiled.deleted[0] === CHATFILE,
    unfiled.threw || `status ${unfiled.res?.status}, deleted ${unfiled.deleted.join(',')}`);

  const his = await run(CHATFILE, {
    isAdmin: true, meta: { custom: { paCategory: 'formfilled' } },
  });
  // NEGATIVE CONTROL (run 2026-08-28): sending his own deletes down the
  // client branch made this read
  //   FAIL  F17 ... -- status 403
  // Eric, 2026-08-22: "I get authority on both."
  ck('F17 Eric still deletes anything on the case, filed or not',
    his.res?.status === 200 && his.deleted[0] === CHATFILE,
    his.threw || `status ${his.res?.status}`);
}

// =========================================================================
// F18: the offer is not even made on the client's side
// =========================================================================
{
  // NEGATIVE CONTROL (run 2026-08-28): dropping `|| r.cat` from the guard
  // made this read
  //   FAIL  F18 ... -- if (!r?.path || !['upload', 'chat', 'saved'].includes(r.kind)) return;
  const guard = (bare(CLIENT).match(/if \(!r\?\.path \|\| ![^\n]*includes\(r\.kind\)[^\n]*return;/) || [''])[0];
  ck('F18 the client is not even OFFERED the long press on a filed file',
    /\|\| r\.cat\) return;/.test(guard), guard);
  // Belt and braces: uploads.mjs U17 pins the three kinds. This pins that the
  // lock is on the raw category and not on the labels this page happens to
  // know, so a label it has never heard of still locks the row.
  // NEGATIVE CONTROL (run 2026-08-28): writing `|| filedCat(r)) return;`
  // made this read
  //   FAIL  F18b and it locks on the raw label, not only the ones this page knows
  ck('F18b and it locks on the raw label, not only the ones this page knows',
    /\|\| r\.cat\) return;/.test(guard) && !/\|\| filedCat\(r\)\) return;/.test(guard));
}

// =========================================================================
// F19-F23: what the two listings actually render
// =========================================================================
// LIFTED AND RUN. Both row builders come out of the shipped files with their
// real escaper, their real name resolver and their real category gate, and
// are handed rows to draw.
{
  const escSrc = slab(CLIENT, 'function esc(s) {', '\n}');
  const sizeSrc = slab(CLIENT, 'function prettySize(bytes) {', '\n}');
  // Everything from the name resolver down to the finished markup: the dedupe,
  // the category map, the sort, the pill and the name.
  const listing = slab(CLIENT, '  const shownName = (n) =>', "</li>`).join('');");
  // NEGATIVE CONTROL (run 2026-08-28): renaming shownName made this read
  //   FAIL  F19 the client's file list lifts out of the shipped page  -- 0 chars
  ck("F19 the client's file list lifts out of the shipped page",
    listing.length > 0 && escSrc.length > 0, `${listing.length} chars`);

  // A throw inside a lift must fail its own check rather than take every check
  // after it down with it. Renaming a helper in the shipped page is exactly
  // the edit that produces one, and the run that finds it should still print
  // the other thirty lines.
  const safely = (fn) => (...a) => {
    try { return fn(...a); } catch (e) { return `LIFT THREW: ${e.message}`; }
  };
  const drawClient = safely(new Function('__rows', '__status', `
    ${escSrc}
    ${sizeSrc}
    const c = { status: __status };
    const rows = __rows;
    const listEl = { innerHTML: '' };
    ${listing}
    return listEl.innerHTML;
  `));

  // What actually landed inside the file-name link, on one line. The whole row
  // truncated at 130 characters cut off before the name every time, which is
  // a detail message that cannot diagnose the check it belongs to.
  const inLink = (html) => (String(html).replace(/\s+/g, ' ')
    .match(/rel="noopener">.{0,70}/) || ['(no link)'])[0];

  const ROW = (over) => ({
    kind: 'chat', name: '1787880535918-IMG_4127.HEIC', url: 'blob:x',
    ts: new Date('2026-08-27T10:00:00Z'), size: 2048,
    path: 'cases/abc/chat-files/1787880535918-IMG_4127.HEIC', cat: '', display: '',
    ...over,
  });

  // A DISPLAY NAME IS TEXT. It is his words, read back out of Storage, and it
  // reaches a page that builds its rows as a template string.
  const NASTY = '<img src=x onerror="alert(1)">';
  const nastyOut = drawClient([ROW({ display: NASTY })], 'delivered');
  // NEGATIVE CONTROL (run 2026-08-28): rendering `${readName(r)}` without the
  // escaper made this read
  //   FAIL  F20 ... -- rel="noopener"><img src=x onerror="alert(1)"></a></span> <span class="fmeta">Aug 27 ·
  ck('F20 a display name with markup in it is TEXT on the client\'s list',
    !/<img/.test(nastyOut) && nastyOut.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'),
    inLink(nastyOut));

  // THE GATE, WIDENED. A chat upload he has filed shows the filing, on the
  // page the client reads.
  const filedOut = drawClient([ROW({ cat: 'formfilled', display: 'Signed intake form' })], 'delivered');
  // NEGATIVE CONTROL (run 2026-08-28): putting the gate back to
  // `r.kind === 'report' && CATS[r.cat]` made this read
  //   FAIL  F21 ... -- pill FROM CHAT, class kind-pill chat
  // which is the state this whole build starts from: the label was written
  // and nothing on either screen changed.
  const pillOf = (html) => ({
    text: (html.match(/class="kind-pill [^"]*">([^<]*)</) || [])[1] || '',
    cls: (html.match(/class="(kind-pill [^"]*)"/) || [])[1] || '',
  });
  ck('F21 a filed chat upload wears its own pill on the client\'s list',
    pillOf(filedOut).text === 'FILLED FORM' && /formfilled/.test(pillOf(filedOut).cls),
    `pill ${pillOf(filedOut).text}, class ${pillOf(filedOut).cls}`);
  // NEGATIVE CONTROL (run 2026-08-28): making the client's readName ignore
  // the display name made this read
  //   FAIL  F21b ... -- rel="noopener">IMG_4127.HEIC</a></span> <span class="fmeta">Aug 27 · 2 KB</span> </li
  ck('F21b and the name he typed is the name they read',
    /">Signed intake form<\/a>/.test(filedOut),
    inLink(filedOut));

  // THE REGRESSION GUARD ON THAT WIDENING. Nothing unlabelled may change.
  const plainOut = drawClient([ROW()], 'delivered');
  // NEGATIVE CONTROL (run 2026-08-28): changing the unlabelled chat pill from
  // FROM CHAT to CHAT made this read
  //   FAIL  F22 ... -- pill CHAT, name IMG_4127.HEIC
  //
  // The first control tried here was making filedCat fall back to the kind,
  // and it is recorded because of what it did instead: 'chat' is not a key in
  // CATS, so the template threw and the suite DIED mid-run with a TypeError
  // rather than printing a red line. That is a loud failure, not a quiet
  // pass, but it is not a negative control - it proves nothing about this
  // check. It is also why both lifts are wrapped in safely() above.
  ck('F22 a file nobody has touched reads exactly as it always did',
    pillOf(plainOut).text === 'FROM CHAT'
    && /">IMG_4127\.HEIC<\/a>/.test(plainOut),
    `pill ${pillOf(plainOut).text}, name ${(plainOut.match(/<a [^>]*>([^<]*)</) || [])[1]}`);
  // The delivered tick is the ONE thing that stays keyed on the report folder
  // alone: it says "this is the deliverable you have been waiting for", and a
  // filed document is not that. uploads.mjs U17c pins the source line; this
  // runs it.
  const reportOut = drawClient([ROW({ kind: 'report', name: '1787880535918-Report.pdf', cat: '' })], 'delivered');
  const summaryOut = drawClient([ROW({ kind: 'report', name: '1787880535918-March.pdf', cat: 'callsummary' })], 'delivered');
  // NEGATIVE CONTROL (run 2026-08-28): dropping `!r.cat` from the tick made
  // this read
  //   FAIL  F23 ... -- report tick true, filed tick true
  ck('F23 and only the report itself still wears the delivered tick',
    /delivered-tick/.test(reportOut) && !/delivered-tick/.test(summaryOut),
    `report tick ${/delivered-tick/.test(reportOut)}, filed tick ${/delivered-tick/.test(summaryOut)}`);

  // ---- the advocate's own list ----------------------------------------
  const aEsc = slab(ADMINCASE, 'function esc(s) {', '\n}');
  const aCats = slab(ADMINCASE, 'const UPLOAD_CATEGORIES = [', '];');
  const aCatOf = slab(ADMINCASE, 'const categoryOf = (id) =>', ';');
  const aFileable = slab(ADMINCASE, 'const FILEABLE_KINDS = new Set(', ';');
  const aFiled = slab(ADMINCASE, 'const filedCat = (r) =>', ';');
  const aRead = slab(ADMINCASE, 'const readName = (r) =>', ';');
  const aGroup = slab(ADMINCASE, 'function fileGroup(r) {', '\n}');
  const aLabel = slab(ADMINCASE, '  const label = (r) =>', 'const pillClass = (r) => filedCat(r) || r.kind;');
  const aRow = slab(ADMINCASE, '  const row = (r) => {', '\n  };');
  // NEGATIVE CONTROL (run 2026-08-28): renaming readName made this read
  //   FAIL  F24 the advocate's file row lifts out of the shipped page  -- row 789, name 0, group 875
  // and F25 to F27 read "LIFT THREW: readName is not defined" on that same
  // run rather than taking the process down, which is what safely() is for.
  ck("F24 the advocate's file row lifts out of the shipped page",
    aRow.length > 0 && aRead.length > 0 && aGroup.length > 0 && aLabel.length > 0,
    `row ${aRow.length}, name ${aRead.length}, group ${aGroup.length}`);

  const drawAdmin = safely(new Function('__r', `
    ${aEsc}
    ${aCats}
    ${aCatOf}
    ${aFileable}
    ${aFiled}
    ${aRead}
    ${aGroup}
    const rows = [__r];
    const prettySize = () => '2 KB';
    const time = { format: () => '10:00 AM' };
    const thumbable = () => false;
    const reviewable = () => false;
    ${aLabel}
    ${aRow}
    return { html: row(__r), group: fileGroup(__r) };
  `));

  const aNasty = drawAdmin(ROW({ display: NASTY })) || {};
  // NEGATIVE CONTROL (run 2026-08-28): rendering `${readName(r)}` bare in the
  // advocate's row made this read
  //   FAIL  F25 ... -- rel="noopener"><img src=x onerror="alert(1)"></a></span> <span class="fmeta">10:00 AM
  ck('F25 and text on the advocate\'s list too, never markup',
    !/<img/.test(aNasty.html || '') && String(aNasty.html || '').includes('&lt;img'),
    inLink(aNasty.html || aNasty));

  const aFiledRow = drawAdmin(ROW({ cat: 'formfilled', display: 'Signed intake form' })) || {};
  // NEGATIVE CONTROL (run 2026-08-28): putting fileGroup back to
  // `if (r.kind === 'report') return categoryOf(r.cat)?.group || 'Reports';`
  // with no category branch made this read
  //   FAIL  F26 ... -- group Images, pill FILLED FORM
  // A filed form landing under Images is the file he went looking for, filed
  // under the heading he would never open.
  ck('F26 a filed chat upload lands under its own heading, wearing its own pill',
    aFiledRow.group === 'Filled forms'
    && /kind-pill formfilled">FILLED FORM</.test(aFiledRow.html || ''),
    `group ${aFiledRow.group}, pill ${(String(aFiledRow.html || '').match(/kind-pill [^"]*">([^<]*)/) || [])[1]}`);
  // NEGATIVE CONTROL (run 2026-08-28): making the advocate's readName ignore
  // the display name made this read
  //   FAIL  F26b ... -- rel="noopener">IMG_4127.HEIC</a></span> <span class="fmeta">10:00 AM · 2 KB</span> </
  ck('F26b and it reads under the name he gave it',
    />Signed intake form</.test(aFiledRow.html || ''),
    inLink(aFiledRow.html || aFiledRow));

  const aPlain = drawAdmin(ROW()) || {};
  // NEGATIVE CONTROL (run 2026-08-28): making readName prefer the object name
  // made this read
  //   FAIL  F27 ... -- group Images, name 1787880535918-IMG_4127.HEIC
  ck('F27 and an untouched file is grouped and named exactly as before',
    aPlain.group === 'Images' && />IMG_4127\.HEIC</.test(aPlain.html || ''),
    `group ${aPlain.group}, name ${(String(aPlain.html || '').match(/<a [^>]*>([^<]*)</) || [])[1]}`);
}

// =========================================================================
// F28-F31: nothing was opened up to get here
// =========================================================================
{
  const folders = (RULES.match(/folder in \[([^\]]+)\]/) || [])[1] || '';
  // Restated from prep-shelf.mjs P2 and uploads.mjs U5, from this side. This
  // build must leave that list exactly as it found it.
  // NEGATIVE CONTROL (run 2026-08-28): adding 'filed' to storage.rules made
  // this read
  //   FAIL  F28 ... -- 'report', 'recording', 'uploads', 'chat-files', 'filed'
  ck('F28 not one folder was opened to a client to make this work',
    folders.split(',').map((x) => x.trim().replace(/'/g, '')).join()
      === 'report,recording,uploads,chat-files', folders);
  // The route's own reach is that same list and nothing else.
  const routeFolders = (slab(WORKER, 'async function handleFileMeta(request, env) {', '\n}')
    .match(/const inThread = \[([^\]]+)\]/) || [])[1] || '';
  // NEGATIVE CONTROL (run 2026-08-28): adding 'prep/' to the route's list
  // made this read
  //   FAIL  F29 ... -- 'report/', 'recording/', 'uploads/', 'chat-files/', 'prep/'
  // and prep/ is his private shelf, which is the one folder in a case a
  // client may never see.
  ck('F29 and the route reaches those four folders, in the case, and no others',
    routeFolders.replace(/['\s/]/g, '') === 'report,recording,uploads,chat-files',
    routeFolders);
  // A CLIENT NEVER WRITES METADATA. The browser SDK's updateMetadata would
  // need storage.rules widened to allow it, which is why this is a Worker
  // route at all.
  // NEGATIVE CONTROL (run 2026-08-28): putting an updateMetadata function
  // into the client's own case page made this read
  //   FAIL  F30 no page a client can load knows how to write file metadata
  ck('F30 no page a client can load knows how to write file metadata',
    !/updateMetadata/.test(CLIENT) && !/updateMetadata/.test(read('public/js/chat.js'))
    && !/updateMetadata/.test(read('public/js/firebase-real.js')));
  // And the write itself is a PATCH of the metadata map alone. An update, or
  // a patch that sent contentType with it, would drop
  // firebaseStorageDownloadTokens and break every download URL already handed
  // out - and would clear the contentDisposition that makes a sent form open
  // in a phone browser instead of downloading.
  const patchFn = slab(STORAGE, 'export async function patchObjectMeta', '\n}');
  // NEGATIVE CONTROL (run 2026-08-28): changing the method to PUT and the
  // body to a whole object representation made this read
  //   FAIL  F31 ... -- method PUT, body { name: path, metadata: custom, contentType: 'application/octet-stream' }
  ck('F31 the write is a PATCH of the metadata map and nothing else',
    /method: 'PATCH'/.test(patchFn)
    && /JSON\.stringify\(\{ metadata: custom \}\)/.test(patchFn),
    `method ${(patchFn.match(/method: '(\w+)'/) || [])[1]}, `
      + `body ${(patchFn.match(/JSON\.stringify\(([^)]*)\)/) || [])[1]}`);
  // NEGATIVE CONTROL (run 2026-08-28): adding a copy-then-delete fallback to
  // storage.js made this read
  //   FAIL  F32 and nothing anywhere renames a file by copying it somewhere else
  ck('F32 and nothing anywhere renames a file by copying it somewhere else',
    !/rewriteTo|copyTo|\/copyTo\/|\/rewriteTo\//.test(STORAGE));
}

// =========================================================================
// F33-F35: the writer, LIFTED AND RUN against a stand-in that behaves like GCS
// =========================================================================
// THE FORM THE CLIENT HAS TO BE ABLE TO OPEN. A blank authority form is
// written into report/ with THREE things set at once: contentType 'text/html',
// contentDisposition 'inline', and customMetadata.paCategory 'formsent'. The
// contentDisposition is the whole delivery mechanism - it is what makes the
// form OPEN on a phone instead of arriving as a download nobody can read - and
// it is an object field sitting right beside the metadata map this feature
// writes into.
//
// So a rename is pointed at exactly that object. On the GCS JSON API a PATCH
// merges what you send and leaves the rest; a full object representation
// REPLACES it, and the two fields nobody sent revert to defaults. A renamed
// form would then download instead of opening, silently. Reading the source
// for the word PATCH is not enough, so this runs the writer.
{
  const fn = slab(STORAGE, 'export async function patchObjectMeta', '\n}');
  // NEGATIVE CONTROL (run 2026-08-28): renaming patchObjectMeta made this read
  //   FAIL  F33 the metadata writer lifts out of the shipped Worker  -- 0 chars
  ck('F33 the metadata writer lifts out of the shipped Worker', fn.length > 0,
    `${fn.length} chars`);

  // A stand-in with the semantics that matter, and the ones that bite:
  // PATCH merges (and a null key deletes), a full representation replaces.
  const FORM = 'cases/abc/report/1787890000000-Records authorisation 2026-08-27.html';
  const fresh = () => ({
    name: FORM,
    contentType: 'text/html',
    contentDisposition: 'inline',
    metadata: {
      paCategory: 'formsent',
      // Firebase keeps the download token in the SAME map. Replacing the map
      // drops it, and every download URL already handed out stops working.
      firebaseStorageDownloadTokens: 'tok-123',
    },
  });
  let OBJ = fresh();
  // Built inside a try, for the same reason the two row lifts are wrapped in
  // safely() above: a lift that has lost its target must fail its own check
  // and let the rest of the run print, not take the process down.
  const build = (src) => new Function('__obj', `
    const getAccessToken = async () => 'token';
    const GCS = 'https://storage.googleapis.com/storage/v1/b';
    const BUCKET = 'bucket';
    const fetch = async (url, init) => {
      const sent = JSON.parse(init.body);
      const o = __obj();
      if (init.method === 'PATCH') {
        for (const [k, v] of Object.entries(sent)) if (k !== 'metadata') o[k] = v;
        if (sent.metadata) {
          for (const [k, v] of Object.entries(sent.metadata)) {
            if (v === null) delete o.metadata[k]; else o.metadata[k] = v;
          }
        }
      } else {
        for (const k of Object.keys(o)) if (k !== 'name') delete o[k];
        Object.assign(o, sent);
        if (!o.metadata) o.metadata = {};
      }
      return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(o)) };
    };
    ${src}
    return patchObjectMeta;
  `)(() => OBJ);
  let writer;
  try { writer = build(fn.replace('export async function', 'async function')); }
  catch (e) { writer = async () => { throw new Error(`writer did not lift: ${e.message}`); }; }

  OBJ = fresh();
  let threw = '';
  try { await writer({}, FORM, { paName: 'Signed records release' }); }
  catch (e) { threw = `${e.constructor.name}: ${e.message}`; }
  // NEGATIVE CONTROL (run 2026-08-28): sending a full object representation
  // with PUT, the shape objects.update takes, made this read
  //   FAIL  F34 ... -- type application/octet-stream, disposition undefined, cat undefined, token undefined
  // Every one of those four is a real thing lost: the form downloads instead
  // of opening, it stops being a filed form, and its download URL dies.
  ck('F34 a rename leaves the sent form openable, filed, and downloadable',
    !threw
    && OBJ.contentType === 'text/html'
    && OBJ.contentDisposition === 'inline'
    && OBJ.metadata.paCategory === 'formsent'
    && OBJ.metadata.firebaseStorageDownloadTokens === 'tok-123'
    && OBJ.metadata.paName === 'Signed records release',
    threw || `type ${OBJ.contentType}, disposition ${OBJ.contentDisposition}, `
      + `cat ${OBJ.metadata.paCategory}, token ${OBJ.metadata.firebaseStorageDownloadTokens}`);

  // AND THE OTHER DIRECTION: filing the form he got back must not strip the
  // name he gave it on the way past.
  await writer({}, FORM, { paCategory: 'formfilled' });
  // NEGATIVE CONTROL (run 2026-08-28): rebuilding the whole metadata map on
  // every write, so each call sends both keys and nulls the one it was not
  // given, made this read
  //   FAIL  F34b ... -- {"name":"cases/abc/report/...html","contentType":"text/html","contentDisposition":"inline","metadata":{"firebaseStorageDownloadTokens":"tok-123","paCategory":"formfilled"}}
  // The name is simply gone from a file that was renamed a moment earlier,
  // and F34 on the same run read `cat undefined`.
  ck('F34b and refiling it keeps the name, the type and the token',
    OBJ.metadata.paCategory === 'formfilled'
    && OBJ.metadata.paName === 'Signed records release'
    && OBJ.contentDisposition === 'inline'
    && OBJ.metadata.firebaseStorageDownloadTokens === 'tok-123',
    JSON.stringify(OBJ));

  // THE TWO HALVES WIRED TOGETHER, which is the only place the real bug can
  // live: the route decides which keys to send, the writer decides how. Either
  // one alone can look right.
  const routeSrc = slab(WORKER, 'async function handleFileMeta(request, env) {', '\n}');
  const catsSrc = slab(WORKER, 'const FILING_CATEGORIES = [', '];');
  OBJ = fresh();
  const wired = new Function('__writer', `
    const json = (o, s) => ({ status: s || 200, body: o });
    const requireAdmin = async () => ({ uid: 'admin' });
    const threadContext = async (env, user, kind, id) => ({
      clientUid: 'client-1', isAdmin: true, parent: 'cases',
    });
    const patchObjectMeta = __writer;
    const deleteFile = async () => {};
    const objectMeta = async () => null;
    ${catsSrc}
    ${routeSrc}
    return handleFileMeta;
  `)((env, path, custom) => writer(env, path, custom));
  const res = await wired({
    json: async () => ({ kind: 'case', id: 'abc', path: FORM, name: 'Signed release' }),
  }, {});
  // NEGATIVE CONTROL (run 2026-08-28): making the route send both keys on
  // every request, so a rename carries `paCategory: null`, made this read
  //   FAIL  F35 ... -- status 200, cat undefined, disposition inline
  // A rename that quietly unfiles the form it renamed is the failure this
  // whole pair exists to catch, and neither half looks wrong on its own.
  ck('F35 end to end, the sheet renaming a sent form does not unfile it',
    res?.status === 200
    && OBJ.metadata.paCategory === 'formsent'
    && OBJ.metadata.paName === 'Signed release'
    && OBJ.contentDisposition === 'inline',
    `status ${res?.status}, cat ${OBJ.metadata.paCategory}, `
      + `disposition ${OBJ.contentDisposition}`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
