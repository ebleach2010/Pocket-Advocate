// oversee.mjs - Eric's three acts on a case someone else works (v7.59).
//
// Eric, 2026-10-16: "I should be able to tap on the employee and see things
// from their perspective without being able to interact with their client. I
// can still delete uploads and chats for real employees if I think they're
// dangerous, as well as hit the ⚕️ icon to send them suicide prevention
// resources with the prewritten message." His choices the same day: the crisis
// message is from him, and a removal leaves "Removed by Eric" for both sides.
//
// What this proves, by running worker/oversee.js against a fake database:
//   A. his alone; his own case refused; a bad body writes nothing
//   B. remove a message: its words and file gone, "Removed by Eric" left, and
//      only a file in this case's chat folder is ever deleted
//   C. remove a file: only this case's four shared folders, the uploads list
//      told without the name, and a chat file's message stripped with it
//   D. the crisis message: from him by name, the client and the advocate told,
//      never on a closed case
//   E. the pages: the quiet view lets this one route out and nothing else, the
//      chat and both upload lists say "Removed by Eric", and the demo mirrors it
//
// Run: node oversee.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const SRC = f('worker/oversee.js');
const CASE = f('public/js/admin-case.js');
const CHAT = f('public/js/chat.js');
const CLIENT = f('public/js/case.js');
const DEMO = f('public/js/demo/api.js');
const W = f('worker/index.js');
const DASH = new RegExp('[\\u2013\\u2014]');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

// The shipped module, with its four imports handed in.
const body = SRC.replace(/^import [^;]+;\n/gm, '').replace(/^export /gm, '');
const make = new Function('getDoc', 'patchDoc', 'listDocs', 'deleteFile', 'notifyUser', 'advocateIdOf',
  `${body}\nreturn { handleOversee, attachmentPath, REMOVED_BY };`);

const ERIC = 'eric-uid';
const ENV = { ADMIN_UID: ERIC };
function world(docs) {
  const db = new Map(Object.entries(docs).map(([k, v]) => [k, structuredClone(v)]));
  const log = { deleted: [], pushed: [], wrote: [] };
  const fakes = {
    getDoc: async (_env, p) => (db.has(p) ? { data: structuredClone(db.get(p)) } : null),
    patchDoc: async (_env, p, data, opts = {}) => {
      log.wrote.push(p);
      const was = db.get(p) || {};
      if (opts.mask) { const next = { ...was }; for (const k of opts.mask) next[k] = data[k]; db.set(p, next); } else db.set(p, { ...data });
      return true;
    },
    listDocs: async (_env, col) => [...db.entries()].filter(([k]) => k.startsWith(`${col}/`) && !k.slice(col.length + 1).includes('/'))
      .map(([k, v]) => ({ id: k.split('/').pop(), data: structuredClone(v) })),
    deleteFile: async (_env, p) => { log.deleted.push(p); return true; },
    notifyUser: async (_env, uid, msg) => { log.pushed.push({ uid, ...msg }); return true; },
    advocateIdOf: (c, env) => (typeof c?.advocateId === 'string' && c.advocateId.trim() ? c.advocateId : env.ADMIN_UID),
  };
  const m = make(fakes.getDoc, fakes.patchDoc, fakes.listDocs, fakes.deleteFile, fakes.notifyUser, fakes.advocateIdOf);
  const json = (b, status = 200) => ({ status, body: b });
  const call = (b, admin = true) => m.handleOversee({ json: async () => b }, ENV, { requireAdmin: async () => (admin ? { uid: ERIC } : null), json });
  return { db, log, call, m };
}
const ANA_CASE = {
  advocateId: 'adv-ana', clientUid: 'cl-1', clientName: 'Priya Shah', status: 'confirmed',
  lastMessage: { text: 'look at this', from: 'cl-1', role: 'client', ts: '2026-10-16T10:00:00.000Z' },
};
const seed = () => ({
  'cases/c1': ANA_CASE,
  'cases/c1/chat/m1': { from: 'cl-1', role: 'client', text: 'look at this', ts: '2026-10-16T10:00:00.000Z' },
  'cases/c1/chat/m2': { from: 'cl-1', role: 'client', text: '', ts: '2026-10-16T10:01:00.000Z',
    attachment: { name: 'x.jpg', path: 'cases/c1/chat-files/1-x.jpg', url: 'https://firebasestorage.googleapis.com/v0/b/b/o/cases%2Fc1%2Fchat-files%2F1-x.jpg?alt=media' } },
  'cases/c1/chat/m3': { from: 'cl-1', role: 'client', text: 'and this', ts: '2026-10-16T10:02:00.000Z',
    attachment: { name: 'y.jpg', path: 'cases/OTHER/chat-files/1-y.jpg' } },
  'cases/mine': { self: true, clientUid: ERIC, status: 'confirmed' },
  'cases/shut': { ...ANA_CASE, status: 'closed' },
});

console.log('\n--- A. his alone, and nothing on a bad ask ---');
{
  const w = world(seed());
  const r1 = await w.call({ action: 'remove-message', caseId: 'c1', msgId: 'm1' }, false);
  const r2 = await w.call({ action: 'crisis', caseId: 'mine', text: 'hello' });
  const r3 = await w.call({ action: 'remove-file', caseId: '../c1', path: 'cases/c1/uploads/a' });
  const r4 = await w.call({ action: 'wipe-everything', caseId: 'c1' });
  // NEGATIVE CONTROL (run 2026-10-16): handleOversee's `if (!admin)` refusal taken out made this read
  //   FAIL  A1 anyone but him gets the same 404 a missing path gets, his own case and a bad ask are refused, and nothing is written or deleted
  check('A1 anyone but him gets the same 404 a missing path gets, his own case and a bad ask are refused, and nothing is written or deleted',
    r1.status === 404 && r2.status === 400 && r3.status === 400 && r4.status === 400
    && !w.log.wrote.length && !w.log.deleted.length && !w.log.pushed.length, JSON.stringify({ r1, r2, r3, r4, log: w.log }));
}

console.log('\n--- B. remove a message ---');
{
  const w = world(seed());
  const r = await w.call({ action: 'remove-message', caseId: 'c1', msgId: 'm2' });
  const m2 = w.db.get('cases/c1/chat/m2');
  const r3 = await w.call({ action: 'remove-message', caseId: 'c1', msgId: 'm3' });
  const m3 = w.db.get('cases/c1/chat/m3');
  // NEGATIVE CONTROL (run 2026-10-16): remove-message's `startsWith(`cases/${caseId}/chat-files/`)` guard taken out made this read
  //   FAIL  B1 a removed message keeps nothing it said or carried, reads Removed by Eric, and only this case's own chat file is deleted
  check('B1 a removed message keeps nothing it said or carried, reads Removed by Eric, and only this case\'s own chat file is deleted',
    r.status === 200 && r3.status === 200 && m2.text === '' && m2.attachment === null && m2.removed?.by === 'Eric'
    && m3.text === '' && m3.removed?.by === 'Eric'
    && JSON.stringify(w.log.deleted) === JSON.stringify(['cases/c1/chat-files/1-x.jpg']), JSON.stringify({ m2, m3, deleted: w.log.deleted }));
  const w2 = world(seed());
  await w2.call({ action: 'remove-message', caseId: 'c1', msgId: 'm1' });
  // NEGATIVE CONTROL (run 2026-10-16): fixPreview's patch taken out made this read
  //   FAIL  B2 when it was the newest message, the thread's preview line says Removed by Eric instead of the words
  check('B2 when it was the newest message, the thread\'s preview line says Removed by Eric instead of the words',
    w2.db.get('cases/c1').lastMessage.text === 'Removed by Eric', JSON.stringify(w2.db.get('cases/c1').lastMessage));
  check('B3 the file behind a message is found from its path, or from its download link when it has no path',
    w.m.attachmentPath({ path: 'cases/c1/chat-files/a' }) === 'cases/c1/chat-files/a'
    && w.m.attachmentPath({ url: 'https://firebasestorage.googleapis.com/v0/b/b/o/cases%2Fc1%2Fchat-files%2F1-x.jpg?alt=media' }) === 'cases/c1/chat-files/1-x.jpg'
    && w.m.attachmentPath(null) === '' && w.m.attachmentPath({ url: 'not a url' }) === '');
}

console.log('\n--- C. remove a file ---');
{
  const w = world(seed());
  const bad = [];
  for (const path of ['cases/OTHER/uploads/a.pdf', 'profiles/cl-1/saved/a.pdf', 'cases/c1/prep/notes.pdf', 'cases/c1/uploads/../../x', 'cases/c1/uploads/sub/a.pdf']) {
    bad.push((await w.call({ action: 'remove-file', caseId: 'c1', path })).status);
  }
  // NEGATIVE CONTROL (run 2026-10-16): remove-file's `m[1] !== caseId` taken out made this read
  //   FAIL  C1 only a file in this case's four shared folders can go: another case's, the client's own shelf, his private prep and a climb out are refused and nothing is deleted
  check('C1 only a file in this case\'s four shared folders can go: another case\'s, the client\'s own shelf, his private prep and a climb out are refused and nothing is deleted',
    bad.every((s) => s === 400) && !w.log.deleted.length, JSON.stringify({ bad, deleted: w.log.deleted }));
  const r = await w.call({ action: 'remove-file', caseId: 'c1', path: 'cases/c1/uploads/1700000000000-scary name.pdf' });
  const c = w.db.get('cases/c1');
  // NEGATIVE CONTROL (run 2026-10-16): the removedFiles entry carrying `name: path` made this read
  //   FAIL  C2 the file is deleted and the case says one was removed by Eric, without its name
  check('C2 the file is deleted and the case says one was removed by Eric, without its name',
    r.status === 200 && w.log.deleted.includes('cases/c1/uploads/1700000000000-scary name.pdf')
    && c.removedFiles?.length === 1 && c.removedFiles[0].by === 'Eric' && c.removedFiles[0].kind === 'uploads'
    && !JSON.stringify(c.removedFiles).includes('scary'), JSON.stringify(c.removedFiles));
  await w.call({ action: 'remove-file', caseId: 'c1', path: 'cases/c1/chat-files/1-x.jpg' });
  // NEGATIVE CONTROL (run 2026-10-16): remove-file's chat-files sweep taken out made this read
  //   FAIL  C3 a chat file removed from the list takes its message with it, and nothing else in the thread
  check('C3 a chat file removed from the list takes its message with it, and nothing else in the thread',
    w.db.get('cases/c1/chat/m2').removed?.by === 'Eric' && w.db.get('cases/c1/chat/m2').attachment === null
    && !w.db.get('cases/c1/chat/m1').removed && !w.db.get('cases/c1/chat/m3').removed);
}

console.log('\n--- D. the crisis message ---');
{
  const w = world(seed());
  const text = "Based on what you said, I'm obligated to send you this.\n\n- 988 Suicide & Crisis Lifeline: call or text 988";
  const r = await w.call({ action: 'crisis', caseId: 'c1', text });
  const sent = [...w.db.entries()].find(([k, v]) => k.startsWith('cases/c1/chat/eric-') && v.byName);
  // NEGATIVE CONTROL (run 2026-10-16): the crisis message written with `from: c.advocateId` made this read
  //   FAIL  D1 it lands in the case's chat from him, by name, with his exact words, and becomes the thread's preview
  check('D1 it lands in the case\'s chat from him, by name, with his exact words, and becomes the thread\'s preview',
    r.status === 200 && !!sent && sent[1].from === ERIC && sent[1].role === 'admin' && sent[1].byName === 'Eric' && sent[1].text === text
    && w.db.get('cases/c1').lastMessage.text === text.slice(0, 120), JSON.stringify({ r, sent }));
  // NEGATIVE CONTROL (run 2026-10-16): the advocate's push taken out made this read
  //   FAIL  D2 the client is told Eric wrote, and the advocate is told he wrote to their client, never quoting it
  check('D2 the client is told Eric wrote, and the advocate is told he wrote to their client, never quoting it',
    w.log.pushed.length === 2 && w.log.pushed[0].uid === 'cl-1' && w.log.pushed[0].body === 'Eric sent you a message.'
    && w.log.pushed[1].uid === 'adv-ana' && w.log.pushed[1].body === 'Eric sent Priya a message on your case.'
    && !w.log.pushed.some((p) => /988|obligated/.test(p.body)), JSON.stringify(w.log.pushed));
  const shut = await w.call({ action: 'crisis', caseId: 'shut', text });
  const empty = await w.call({ action: 'crisis', caseId: 'c1', text: '   ' });
  check('D3 a closed case and an empty message are refused', shut.status === 409 && empty.status === 400, JSON.stringify({ shut, empty }));
}

console.log('\n--- E. the pages ---');
{
  // NEGATIVE CONTROL (run 2026-10-16): the quiet view's `!/...api\/admin\/oversee$/.test(url)` exception taken out made this read
  //   FAIL  E1 the quiet view lets exactly the oversee route out, and still answers every other write with its one line
  // RE-PINNED 2026-10-17 (v7.62): the demo audit, the line popped up on opening and on tab switches: it answers
  // his own tap only, the write still refused either way.
  // NEGATIVE CONTROL (run 2026-10-17, v7.62): the oversee exception taken out again made E1 read FAIL.
  check('E1 the quiet view lets exactly the oversee route out, and still answers every other write with its one line',
    /if \(method !== 'GET' && \/\^\(\\\/\|https\?:\\\/\\\/\[\^\/\]\+\\\/\)api\\\/\/\.test\(url\) && !\/\^\(\\\/\|https\?:\\\/\\\/\[\^\/\]\+\\\/\)api\\\/admin\\\/oversee\$\/\.test\(url\)\) \{\n\s+if \(Date\.now\(\) - lastAct\.t < 3000 && !lastAct\.nav\) say\(LINE\);/.test(CASE)
    && /messageTools: asUid \? removeMessageTool : null,/.test(CASE) && /\$\{asUid && r\.kind !== 'saved'/.test(CASE)
    && /data-quiet-duty/.test(CASE) && /action: 'crisis', caseId, text/.test(CASE));
  // NEGATIVE CONTROL (run 2026-10-16): chat.js's removed branch writing `data.text` into the bubble made this read
  //   FAIL  E2 a removed message reads Removed by Eric and shows nothing it said; his message carries his name and not their photo
  const removedBranch = (CHAT.match(/if \(data\.removed\) \{[\s\S]*?continue;\n\s+\}/) || [''])[0];
  check('E2 a removed message reads Removed by Eric and shows nothing it said; his message carries his name and not their photo',
    /gone\.textContent = `Removed by \$\{data\.removed\.by \|\| 'Eric'\}`;/.test(removedBranch) && !/data\.text|attachment/.test(removedBranch)
    && /by\.textContent = data\.byName;/.test(CHAT) && /if \(otherAvatar && !mine && !isQ && !data\.byName\)/.test(CHAT));
  // NEGATIVE CONTROL (run 2026-10-16): case.js's insertAdjacentHTML of removedLi taken out made this read
  //   FAIL  E3 both upload lists, his and the client's, say a file was removed by Eric, never its name
  check('E3 both upload lists, his and the client\'s, say a file was removed by Eric, never its name',
    /\.join\(''\);\n\s+listEl\.insertAdjacentHTML\('beforeend', removedLi\(c\.removedFiles\)\);/.test(CLIENT) && /Removed by Eric: \$\{items\.length === 1/.test(CLIENT)
    && /listEl\.innerHTML = short \+ pinnedHtml \+ daysHtml;\n\s+listEl\.insertAdjacentHTML\('beforeend', removedNote\(data\?\.removedFiles\)\);/.test(CASE) && /Removed by Eric: \$\{items\.length === 1/.test(CASE)
    && !/\.name/.test((CLIENT.match(/function removedLi[\s\S]*?\n\}/) || [''])[0]));
  check('E4 the route is wired his alone, and the demo mirrors all three acts with the same refusals',
    /url\.pathname === '\/api\/admin\/oversee' && request\.method === 'POST'\)\n\s+return await handleOversee\(request, env, \{ requireAdmin, json \}\);/.test(W)
    && /if \(path === '\/api\/admin\/oversee'\) \{\n\s+if \(role !== 'admin'\) return fail\(404, 'Not found'\);/.test(DEMO)
    && /body\.action === 'remove-message'/.test(DEMO) && /body\.action === 'remove-file'/.test(DEMO) && /body\.action === 'crisis'/.test(DEMO)
    && /byName: 'Eric'/.test(DEMO));
  const added = [SRC, removedBranch].join('\n');
  check('E5 no dash where a person reads', !DASH.test(added));
}

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
