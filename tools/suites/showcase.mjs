// showcase.mjs - Joe Bloe, the case that is not a case, and Delete.
//
//   node tools/suites/showcase.mjs
//
// Eric, 2026-09-06: "Create a completely fake case for me to show off on
// YouTube. Enter a chat log of maybe 50 back and forth messages, fake name,
// address, phone number, rare disease, fake document uploads, everything to
// make it an interactable environment where I can show how the system works
// without exposing patient information... For personal cases, let me be able
// to delete it, next to the pause/close buttons. Name the guy Joe Bloe."
//
// What this holds: the man is invented and unmailable, the chat is fifty
// messages both ways in order, the documents are real PDFs, the builder
// writes the case the way a client's case is shaped and flags it, the wipe
// takes everything the case owns, the routes refuse a client's case, every
// place a client would be told or counted skips the showcase, and the page
// and the shelf carry the buttons.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const SRC = f('worker/showcase.js');
const W = f('worker/index.js');
const EMAIL = f('worker/email.js');
const CASE = f('public/js/admin-case.js');
const ADMIN = f('public/js/admin.js');
const DEMO = f('public/js/demo/api.js');
const ACSS = f('public/css/admin.css');
const mod = await import(pathToFileURL(j(ROOT, 'worker/showcase.js')).href);

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
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
const unmailable = new Function(`${lift(EMAIL, 'export function unmailable(to) {').replace(/^export /, '')}; return unmailable;`)();
const HARD = /\bAI\b|\bClaude\b|Anthropic|\bmodel\b|\badvisor\b/;

// ---- the man and the story ------------------------------------------------
{
  const { JOE, CHAT } = mod;
  const docs = mod.docsFor(new Date('2026-09-06T12:00:00Z'));
  const order = CHAT.map(([days, h, m]) => days * 1440 + h * 60 + m);
  const inOrder = order.every((v, i) => i === 0 || v > order[i - 1]);
  const joe = CHAT.filter((r) => r[3] === 'joe').length;
  const eric = CHAT.filter((r) => r[3] === 'eric').length;
  const texts = [...CHAT.map((r) => r[4]), ...docs.flatMap((x) => x.lines), ...mod.MILESTONES.map((x) => x[5]), ...mod.WORK_LOG.map((x) => x[7])];
  const attachments = CHAT.map((r) => r[5]).filter(Boolean);
  const phones = [JOE.phone, ...mod.WORK_LOG.map((x) => x[5]), ...docs.flatMap((x) => x.lines).flatMap((l) => l.match(/208-555-\d{4}|\+1 208 555 \d{4}/g) || [])];
  // NEGATIVE CONTROL (run 2026-09-06): JOE.email changed to a gmail address made this read
  //   FAIL  X1 Joe Bloe is invented and unmailable, the chat is fifty messages both ways in order with documents pinned to four of them, the documents are ten with distinct names in the right folders, and every phone is a 555 number
  check('X1 Joe Bloe is invented and unmailable, the chat is fifty messages both ways in order with documents pinned to four of them, the documents are ten with distinct names in the right folders, and every phone is a 555 number',
    JOE.name === 'Joe Bloe' && unmailable(JOE.email) && !unmailable('someone@gmail.com') && /555/.test(JOE.phone)
    && JOE.uid === 'showcase-joe-bloe' && /Nampa, ID/.test(JOE.address)
    && CHAT.length === 50 && joe === 25 && eric === 25 && inOrder
    && CHAT.every((r, i) => r[3] === (i % 2 ? 'eric' : 'joe'))
    && attachments.length === 4 && attachments.every((a) => docs.some((x) => x.name === a && x.folder === 'chat-files'))
    && docs.length === 10 && new Set(docs.map((x) => x.name)).size === 10
    && docs.every((x) => ['chat-files', 'uploads', 'report'].includes(x.folder)) && docs.filter((x) => x.folder === 'report').length === 2
    && texts.every((t) => !/[—–]/.test(t)) && texts.every((t) => !HARD.test(t))
    && phones.length >= 8 && phones.every((p) => /555/.test(p))
    && mod.MILESTONES.length === 6 && mod.WORK_LOG.length === 7
    && /Susac/.test(CHAT[47][4]),
    JSON.stringify({ n: CHAT.length, joe, eric, inOrder, attachments, docs: docs.length, phones: phones.length }));
}

// ---- the PDF writer -------------------------------------------------------
{
  const bytes = mod.textPdf(['# Title', 'Body line one, with (parens) and a \\ backslash.', '', ...Array.from({ length: 120 }, (_, i) => `Line ${i} ` + 'word '.repeat(30))]);
  const s = Buffer.from(bytes).toString('latin1');
  const xrefAt = Number((s.match(/startxref\n(\d+)\n/) || [])[1]);
  const table = s.slice(xrefAt);
  const entries = [...table.matchAll(/(\d{10}) 00000 n/g)].map((x) => Number(x[1]));
  const offsetsOk = entries.length > 0 && entries.every((off, i) => s.slice(off).startsWith(`${i + 1} 0 obj`));
  const count = Number((s.match(/\/Count (\d+)/) || [])[1]);
  // NEGATIVE CONTROL (run 2026-09-06): every xref offset written one byte off made this read
  //   FAIL  X2 the PDF writer makes a real PDF: header, objects at the offsets the table says, a page count that matches, bold headings, escaped text, more pages when the text runs long
  check('X2 the PDF writer makes a real PDF: header, objects at the offsets the table says, a page count that matches, bold headings, escaped text, more pages when the text runs long',
    s.startsWith('%PDF-1.4\n') && s.endsWith('%%EOF\n') && offsetsOk
    && count >= 2 && (s.match(/\/Type \/Page\b/g) || []).length === count
    && /\/F2 10\.5 Tf [^\n]*\(Title\) Tj/.test(s) && /\\\(parens\\\)/.test(s) && /\\\\ backslash/.test(s)
    && /\/BaseFont \/Helvetica-Bold/.test(s) && /\/Root 1 0 R/.test(s),
    `offsets ${offsetsOk}, count ${count}, objects ${entries.length}`);
}

// ---- the builder, lifted and run against fakes --------------------------
{
  const buildSrc = lift(SRC, 'export async function buildShowcase(env, { adminUid } = {}) {').replace(/^export /, '');
  const atSrc = lift(SRC, 'function at(now, days, hour = 9, minute = 0) {');
  const run = async ({ existing = false } = {}) => {
    const writes = [];
    const puts = [];
    const metas = [];
    const created = [];
    const pend = [];
    let n = 0;
    const api = new Function('deps', `
      const { queryDocs, patchDoc, batchCreate, putFile, patchObjectMeta, markPending, BUCKET, crypto, JOE, CHAT, docsFor, textPdf, MILESTONES, WORK_LOG, AUTHORITY, DAY } = deps;
      ${atSrc}
      ${lift(SRC, 'function authorityItem(now, [days, hour, kind, fields]) {')}
      ${buildSrc}
      return buildShowcase;
    `)({
      queryDocs: async (env, coll, filters) => (coll === 'cases' && existing ? [{ id: 'old-showcase', data: { showcase: true } }] : []),
      patchDoc: async (env, path, data, opts) => { writes.push({ path, data, opts }); return true; },
      batchCreate: async (env, entries) => { created.push(...entries); return { created: entries.length, skipped: 0 }; },
      putFile: async (env, path, bytes, contentType) => { puts.push({ path, size: bytes.byteLength, contentType }); return { name: path.split('/').pop(), path, size: bytes.byteLength, contentType }; },
      patchObjectMeta: async (env, path, custom) => { metas.push({ path, custom }); return { path, custom }; },
      markPending: async (env, kind, id, opts) => { pend.push([kind, id, opts]); },
      BUCKET: 'bucket.appspot.com',
      crypto: { randomUUID: () => `u${++n}` },
      JOE: mod.JOE, CHAT: mod.CHAT, docsFor: mod.docsFor, textPdf: mod.textPdf, MILESTONES: mod.MILESTONES, WORK_LOG: mod.WORK_LOG, AUTHORITY: mod.AUTHORITY, DAY: 86_400_000,
    });
    const out = await api({}, { adminUid: 'eric-uid' });
    return { out, writes, puts, metas, created, pend };
  };
  const built = await run();
  const caseW = built.writes.find((w) => /^cases\/[^/]+$/.test(w.path));
  const id = caseW?.path.split('/')[1];
  const chat = built.created.filter((e) => e.path.startsWith(`cases/${id}/chat/`));
  const miles = built.created.filter((e) => e.path.includes('/private/milestones/items/'));
  const log = built.created.filter((e) => e.path.includes('/private/clinicCalls/items/'));
  const perms = built.created.filter((e) => e.path.includes('/private/authority/items/'));
  const withFiles = chat.filter((e) => e.data.attachment);
  const again = await run({ existing: true });
  // NEGATIVE CONTROL (run 2026-09-06): the markPending after the build removed made this read
  //   FAIL  X3 the builder writes a client-shaped case flagged as the showcase with nobody behind it, fifty chat rows in both roles with four documents pinned, ten PDFs in the right folders with download tokens, six milestones, seven log entries, the chat dot, and the first read flagged; a second call finds the one that exists and writes nothing
  check('X3 the builder writes a client-shaped case flagged as the showcase with nobody behind it, fifty chat rows in both roles with four documents pinned, ten PDFs in the right folders with download tokens, six milestones, seven log entries, the chat dot, and the first read flagged; a second call finds the one that exists and writes nothing',
    !!buildSrc && !!atSrc && built.out.id === id && built.out.existing === false && built.out.messages === 50 && built.out.documents === 10
    && !!caseW && caseW.opts?.mustNotExist === true && caseW.data.showcase === true && caseW.data.clientUid === null
    && caseW.data.clientEmail === 'joe.bloe@example.com' && caseW.data.clientName === 'Joe Bloe' && caseW.data.clientPhone === mod.JOE.phone
    && caseW.data.status === 'delivered' && caseW.data.reportDeliveredAt && caseW.data.fullAccess === true && caseW.data.stripe === null
    && caseW.data.work.seconds === 24000 && caseW.data.chatUnlocked === true && caseW.data.appointment.method === 'video'
    && caseW.data.appointment.start < new Date() && caseW.data.lastMessage.role === 'admin' && caseW.data.lastMessage.emailed === true
    && chat.length === 50 && chat.filter((e) => e.data.role === 'client').length === 25 && chat.filter((e) => e.data.role === 'admin').length === 25
    && chat.every((e) => e.data.role === 'admin' ? e.data.from === 'eric-uid' : e.data.from === 'showcase-joe-bloe')
    && chat.every((e, i) => i === 0 || e.data.ts > chat[i - 1].data.ts)
    && withFiles.length === 4 && withFiles.every((e) => /^https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/bucket\.appspot\.com\/o\/cases%2F/.test(e.data.attachment.url)
      && /alt=media&token=u\d+$/.test(e.data.attachment.url) && e.data.attachment.path.startsWith(`cases/${id}/chat-files/`) && e.data.attachment.contentType === 'application/pdf')
    && built.puts.length === 10 && built.puts.every((p) => p.contentType === 'application/pdf' && p.size > 800)
    && built.puts.filter((p) => p.path.startsWith(`cases/${id}/chat-files/`)).length === 4
    && built.puts.filter((p) => p.path.startsWith(`cases/${id}/uploads/`)).length === 4
    && built.puts.filter((p) => p.path.startsWith(`cases/${id}/report/`)).length === 2
    && built.metas.length === 10 && built.metas.every((m) => /^u\d+$/.test(m.custom.firebaseStorageDownloadTokens))
    && miles.length === 6 && miles.every((e) => e.data.what && e.data.kindLabel && e.data.at)
    && log.length === 7 && log.every((e) => e.data.clinic && e.data.summary && /555/.test(e.data.phone))
    && perms.length === 4 && perms.every((e) => e.data.signedName === 'Joe Bloe' && e.data.signedAt && e.data.revokedAt === null && e.data.expiresAt > new Date())
    && perms.filter((e) => e.data.kind === 'records').every((e) => e.data.clinicName && e.data.scopes.length && e.data.scopes.every((s) => ['discuss', 'records', 'admin'].includes(s)))
    && perms.some((e) => e.data.kind === 'representative' && e.data.planName === 'Basin Health Plan')
    && perms.some((e) => e.data.kind === 'scope' && e.data.contactOk === true)
    && built.writes.some((w) => w.path === `caseMeta/${id}` && w.data.clientMsgAt)
    && built.pend.length === 1 && built.pend[0][1] === id && built.pend[0][2].force === true
    && again.out.existing === true && again.out.id === 'old-showcase' && again.writes.length === 0 && again.puts.length === 0,
    JSON.stringify({ out: built.out, chat: chat.length, files: withFiles.length, puts: built.puts.length, miles: miles.length, log: log.length, pend: built.pend.length, again: again.out }));
}

// ---- the wipe, lifted and run against fakes --------------------------------
{
  const wipeSrc = lift(SRC, 'export async function wipeCase(env, id, { adminUid } = {}) {').replace(/^export /, '');
  const run = async () => {
    const deleted = [];
    const gone = [];
    const patched = [];
    const api = new Function('deps', `
      const { getDoc, patchDoc, batchDelete, listDocs, listFiles, deleteFile } = deps;
      ${wipeSrc}
      return wipeCase;
    `)({
      listDocs: async (env, path) => (
        path === 'cases/x/chat' ? [{ id: 'm1' }, { id: 'm2' }]
          : path === 'cases/x/advisor/state/qa' ? [{ id: 'q1' }]
            : path === 'cases/x/private/milestones/items' ? [{ id: 'mi1' }]
              : path === 'cases/x/private/clinicCalls/items' ? [{ id: 'c1' }]
                : path === 'cases/x/private/authority/items' ? [{ id: 'au1' }]
                : path === 'cases/x/agenda' ? [{ id: 'a1' }]
                  : path === 'advisorQueue' ? [{ id: 'case_x', data: { kind: 'case', id: 'x' } }, { id: 'handover_case_x', data: { id: 'x', handover: true } }, { id: 'case_other', data: { id: 'other' } }]
                    : []),
      batchDelete: async (env, paths) => { deleted.push(...paths); return { deleted: paths.length }; },
      listFiles: async (env, prefix) => (prefix === 'cases/x/' ? [{ path: 'cases/x/uploads/1-a.pdf' }, { path: 'cases/x/chat-files/2-b.pdf' }] : []),
      deleteFile: async (env, path) => { gone.push(path); },
      getDoc: async (env, path) => (path === 'users/eric' ? { data: { selfCaseId: 'x' } } : null),
      patchDoc: async (env, path, data, opts) => { patched.push({ path, data, opts }); return true; },
    });
    const out = await api({}, 'x', { adminUid: 'eric' });
    return { out, deleted, gone, patched };
  };
  const r = await run();
  const want = ['cases/x/chat/m1', 'cases/x/chat/m2', 'cases/x/advisor/state/qa/q1', 'cases/x/private/milestones/items/mi1', 'cases/x/private/clinicCalls/items/c1', 'cases/x/private/authority/items/au1', 'cases/x/agenda/a1',
    'cases/x/advisor/state', 'cases/x/private/notes', 'cases/x/private/milestones', 'cases/x/private/clinicCalls', 'cases/x/private/authority', 'caseMeta/x',
    'advisorQueue/case_x', 'advisorQueue/handover_case_x', 'cases/x'];
  // NEGATIVE CONTROL (run 2026-09-06): the queue rows waiting on the case left out of the wipe made this read
  //   FAIL  X4 the wipe takes everything the case owns: its chat, its reading and questions, its notes, milestones, log, authority and agenda, its meta, every queue row waiting on it, every file in its folders, the document last, and the pointer to it on his profile
  check('X4 the wipe takes everything the case owns: its chat, its reading and questions, its notes, milestones, log, authority and agenda, its meta, every queue row waiting on it, every file in its folders, the document last, and the pointer to it on his profile',
    !!wipeSrc && want.every((p) => r.deleted.includes(p)) && !r.deleted.includes('advisorQueue/case_other')
    && r.deleted[r.deleted.length - 1] === 'cases/x'
    && r.gone.length === 2 && r.gone.includes('cases/x/uploads/1-a.pdf')
    && r.patched.some((p) => p.path === 'users/eric' && p.data.selfCaseId === null && p.opts?.mask?.join() === 'selfCaseId')
    && r.out.docs === want.length && r.out.files === 2,
    JSON.stringify({ deleted: r.deleted, gone: r.gone, out: r.out }));
}

// ---- the routes, the diag door, and every place a client would be told or counted ----
{
  const delSrc = lift(W, 'async function handleDeleteCase(request, env) {');
  const run = async (caseData, { admin = true } = {}) => {
    const wiped = [];
    const api = new Function('deps', `
      const { requireAdmin, json, getDoc, wipeCase } = deps;
      ${delSrc}
      return handleDeleteCase;
    `)({
      requireAdmin: async () => (admin ? { uid: 'eric' } : null),
      json: (obj, code = 200) => ({ code, obj }),
      getDoc: async () => (caseData ? { data: caseData } : null),
      wipeCase: async (env, id, opts) => { wiped.push([id, opts]); return { docs: 3, files: 1 }; },
    });
    const out = await api({ json: async () => ({ caseId: 'x' }) }, {});
    return { out, wiped };
  };
  const client = await run({ clientUid: 'someone', status: 'confirmed' });
  const plain = await run({ clientUid: null, status: 'confirmed' });
  const own = await run({ self: true, clientUid: null });
  const show = await run({ showcase: true, clientUid: null });
  const stranger = await run({ showcase: true }, { admin: false });
  const missing = await run(null);
  // NEGATIVE CONTROL (run 2026-09-06): the delete route's refusal changed to `if (false)` made this read
  //   FAIL  X5 delete refuses a client's case and any case with a uid on it, takes his own and the showcase whole, answers a stranger with the site's 404, and the showcase can be built from the keyed diag door and the admin route; every place a client would be told, counted or billed skips the showcase; example addresses are never mailed
  check('X5 delete refuses a client\'s case and any case with a uid on it, takes his own and the showcase whole, answers a stranger with the site\'s 404, and the showcase can be built from the keyed diag door and the admin route; every place a client would be told, counted or billed skips the showcase; example addresses are never mailed',
    !!delSrc && client.out.code === 409 && /closed, never deleted/.test(client.out.obj.error) && client.wiped.length === 0
    && plain.out.code === 409 && plain.wiped.length === 0
    && own.out.code === 200 && own.wiped.length === 1 && own.wiped[0][1].adminUid === 'eric'
    && show.out.code === 200 && show.out.obj.docs === 3 && show.wiped.length === 1
    && stranger.out.code === 404 && stranger.wiped.length === 0 && missing.out.obj.gone === true
    && /url\.pathname === '\/api\/admin\/delete-case' && request\.method === 'POST'/.test(W)
    && /url\.pathname === '\/api\/admin\/showcase-case' && request\.method === 'POST'/.test(W)
    && /if \(url\.searchParams\.get\('do'\) === 'showcase'\) \{\n\s+const out = await buildShowcase\(env, \{ adminUid: env\.ADMIN_UID \|\| '' \}\);/.test(W)
    && W.indexOf("url.searchParams.get('k') !== 'b6e6f406dc540d5459188b00716ab631'") < W.indexOf("url.searchParams.get('do') === 'showcase'")
    && /import \{ buildShowcase, wipeCase \} from '\.\/showcase\.js';/.test(W)
    && /^\/\/   POST   \/api\/admin\/showcase-case/m.test(W) && /^\/\/   POST   \/api\/admin\/delete-case/m.test(W)
    && /if \(row\.data\.self \|\| row\.data\.showcase\) continue;/.test(W)
    && /if \(row\.data\.self \|\| row\.data\.showcase\) \{/.test(W)
    && (W.match(/if \(c\.self \|\| c\.showcase\) continue;/g) || []).length === 2
    && /if \(c\.chatOpenNotified \|\| c\.chatUnlocked \|\| c\.self \|\| c\.showcase\) continue;/.test(W)
    && /if \(unmailable\(to\)\) return false;/.test(EMAIL),
    JSON.stringify({ client: client.out, plain: plain.out.code, own: own.out.code, show: show.out, stranger: stranger.out.code }));
}

// ---- the page, the shelf, the demo ---------------------------------------
// NEGATIVE CONTROL (run 2026-09-06): the pause-or-close card's `${c.showcase || c.self ?` gate changed to `${true ?` made this read
//   FAIL  X6 Delete sits beside pause and close on a case with nobody behind it and on his own case's card, both confirm and post to the delete route, the shelf builds the showcase from one door and marks its row, and the demo mirrors both routes
check('X6 Delete sits beside pause and close on a case with nobody behind it and on his own case\'s card, both confirm and post to the delete route, the shelf builds the showcase from one door and marks its row, and the demo mirrors both routes',
  /\$\{c\.showcase \|\| c\.self \? `\n\s+<hr[^\n]*\n\s+<p class="dim small"[^\n]*\$\{c\.showcase\n\s+\? 'This is the showcase case/.test(CASE)
  && /<button class="btn quiet danger" data-delete-case>Delete this case<\/button>/.test(CASE)
  && /<button type="button" class="btn quiet danger" data-delete-case>Delete it<\/button>/.test(CASE)
  && /async function deleteCase\(btn\) \{\n\s+if \(!confirm\('Delete this case, whole\?/.test(CASE)
  && /fetch\('\/api\/admin\/delete-case', \{/.test(CASE) && /location\.href = '\/admin\.html';/.test(CASE)
  && (CASE.match(/\[data-delete-case\]'\)\?\.addEventListener\('click', \(e\) => deleteCase\(e\.currentTarget\)\);/g) || []).length === 2
  && /data-showcase-door>Build the showcase case \(Joe Bloe\)<\/button>/.test(ADMIN)
  && /cases\.some\(\(c\) => c\.showcase\) \? '' :/.test(ADMIN)
  && /fetch\('\/api\/admin\/showcase-case', \{/.test(ADMIN)
  && /SHOWCASE, nobody behind it/.test(ADMIN)
  && /path === '\/api\/admin\/showcase-case'/.test(DEMO) && /path === '\/api\/admin\/delete-case'/.test(DEMO)
  && /clientName: 'Joe Bloe'/.test(DEMO) && /closed, never deleted/.test(DEMO)
  && /^\.btn\.danger \{/m.test(ACSS)
  && !/[—–]/.test(SRC));

// ---- the way out (Eric, 2026-09-06: "Get rid of Joe bloe") ----------------
// The keyed diag door that wipes every showcase case, lifted whole and run
// against fakes: it asks for the cases flagged showcase and nothing else,
// wipes each one as the admin, and answers with what it wiped.
{
  const block = (W.match(/if \(url\.searchParams\.get\('do'\) === 'unshowcase'\) \{[\s\S]*?return json\(\{ ok: true, wiped \}\);\n\s+\}/) || [''])[0];
  const calls = { query: [], wipe: [] };
  let out = null;
  if (block) {
    const run = new Function('url', 'env', 'queryDocs', 'wipeCase', 'json', `return (async () => { ${block} return null; })();`);
    out = await run(
      new URL('https://x.test/api/diag?k=b6e6f406dc540d5459188b00716ab631&do=unshowcase'),
      { ADMIN_UID: 'eric' },
      async (...a) => { calls.query.push(a); return [{ id: 'joe', data: { showcase: true } }]; },
      async (...a) => { calls.wipe.push(a); return { docs: 3, files: 10 }; },
      (o, s = 200) => ({ o, s }),
    ).catch((e) => ({ err: String(e) }));
  }
  // NEGATIVE CONTROL (run 2026-09-07): the query's `[['showcase', 'EQUAL', true]]` changed to `[['self', 'EQUAL', true]]` made this read
  //   FAIL  X7 the keyed diag's unshowcase door asks for the cases flagged showcase and nothing else, wipes each one whole as the admin, answers with what it wiped, and sits behind the key like the showcase door
  check('X7 the keyed diag\'s unshowcase door asks for the cases flagged showcase and nothing else, wipes each one whole as the admin, answers with what it wiped, and sits behind the key like the showcase door',
    !!block && out?.s === 200 && out?.o?.ok === true
    && calls.query.length === 1 && calls.query[0][1] === 'cases' && JSON.stringify(calls.query[0][2]) === JSON.stringify([['showcase', 'EQUAL', true]])
    && calls.wipe.length === 1 && calls.wipe[0][1] === 'joe' && calls.wipe[0][2]?.adminUid === 'eric'
    && out.o.wiped.length === 1 && out.o.wiped[0].id === 'joe' && out.o.wiped[0].docs === 3
    && W.indexOf("url.searchParams.get('k') !== 'b6e6f406dc540d5459188b00716ab631'") < W.indexOf("url.searchParams.get('do') === 'unshowcase'"),
    JSON.stringify({ out, calls }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
