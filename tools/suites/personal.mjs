// personal.mjs - Personal Uploads, driven against the REAL routes.
//
// Eric, 2026-09-03: "a 'Personal Uploads' tab that are uploads of documents
// just for me. One in the all cases page where the upload is universally
// accessible, and one for the 'Mine' tab. These uploads are ONLY visible to
// me."
//
// "Only visible to me" is three facts, and this file pins each one where it
// lives: the prefix is denied to every browser by a rule already deployed
// (storage.rules), the two routes derive the prefix from the verified caller
// and refuse everything outside it (lifted and run here), and nothing else
// in the app, client page or advisor walk, ever names the prefix (grepped
// over comment-stripped source).
//
// Run: node personal.mjs
//
// ===========================================================================
// NEGATIVE CONTROLS - what was broken on purpose, and what went red
//
//   the break                                        what went red
//   ---------------------------------------------------------------------
//   the admin gate dropped from handlePersonal       A2
//   the prefix uid read from a request header        B1
//   the slash dropped from the leaf's class          B3
//   the list run over the whole personal/ prefix     C1
//   the own-path check dropped from DELETE           C2
//   the own-path check dropped from the file route   C4
//   the role check on the cookie uid dropped         D2
//   the post-read byte cap dropped                   E1
//   a personal/ rule added to storage.rules          F1
//   the shelf imported by case.js                    F3
//   an em dash typed into the shelf's note           G4
//
// Each break was one red row, restored byte for byte, and the file read
// 25/25 again after every one (2026-09-03).
// ===========================================================================
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const strip = (s) => s
  .replace(/^[ \t]*\/\*[\s\S]*?\*\/[ \t]*$/gm, '')
  .replace(/^[ \t]*\/\/.*$/gm, '');
const code = (p) => strip(f(p));
const CODE = strip(SRC);

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
function fn(name) {
  const m = SRC.match(new RegExp(`\\nasync function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
function sfn(name) {
  const m = SRC.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
function konst(name) {
  const m = SRC.match(new RegExp(`\\nconst ${name} =[^;]+;`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0];
}
const LIFTED = [
  konst('PERSONAL_MAX_BYTES'), konst('PERSONAL_SCOPES'), konst('ADMIN_ASSET'),
  sfn('personalPrefix'), sfn('personalLeaf'), sfn('ownPersonalPath'), sfn('json'),
  fn('handlePersonal'), fn('handlePersonalFile'),
].join('\n');

// ---- the world ------------------------------------------------------------
let who, cookieUid, profiles, store, puts, dels, fetched;
const deps = {
  requireAdmin: async () => who,
  adminCookieUid: async () => cookieUid,
  getDoc: async (env, path) => (profiles[path] ? { data: profiles[path] } : null),
  listFiles: async (env, prefix) => [...store.entries()]
    .filter(([p]) => p.startsWith(prefix) && p.slice(prefix.length).indexOf('/') < 0)
    .map(([p, o]) => ({ name: p.split('/').pop().replace(/^\d{10,}-/, ''), path: p, contentType: o.type, size: o.size, at: o.at }))
    .sort((a, b) => a.at - b.at),
  putFile: async (env, path, bytes, contentType) => {
    puts.push({ path, size: bytes.byteLength, contentType });
    store.set(path, { type: contentType, size: bytes.byteLength, at: Date.now() });
    return { name: path.split('/').pop().replace(/^\d{10,}-/, ''), path, contentType, size: bytes.byteLength, at: Date.now() };
  },
  deleteFile: async (env, path) => { dels.push(path); store.delete(path); },
  mediaFetch: async (env, path) => {
    fetched.push(path);
    const o = store.get(path);
    return o ? new Response('bytes', { status: 200, headers: { 'content-type': o.type } }) : new Response('', { status: 404 });
  },
  notFound: async () => new Response('nope', { status: 404 }),
};
const build = new Function(...Object.keys(deps),
  `${LIFTED}
   return { handlePersonal, handlePersonalFile, personalPrefix, personalLeaf, ownPersonalPath,
            PERSONAL_MAX_BYTES, PERSONAL_SCOPES, ADMIN_ASSET };`);
const W = build(...Object.values(deps));
const env = { ADMIN_UID: 'eric' };
const reset = () => {
  who = { uid: 'eric' }; cookieUid = null; puts = []; dels = []; fetched = [];
  profiles = { 'users/eric': { role: 'admin' }, 'users/mallory': { role: 'client' } };
  store = new Map([
    ['personal/eric/all/1700000000000-tax.pdf', { type: 'application/pdf', size: 10, at: 1 }],
    ['personal/eric/all/1700000000001-notes.txt', { type: 'text/plain', size: 10, at: 2 }],
    ['personal/eric/case/abc/1700000000002-plan.pdf', { type: 'application/pdf', size: 10, at: 3 }],
    ['personal/mallory/all/1700000000003-hers.pdf', { type: 'application/pdf', size: 10, at: 4 }],
    ['cases/abc/uploads/1700000000004-client.pdf', { type: 'application/pdf', size: 10, at: 5 }],
  ]);
};
const req = (method, { path = '/api/admin/personal', headers = {}, body, bytes } = {}) => {
  const url = new URL(`https://example.com${path}`);
  return [{
    method,
    headers: new Headers(headers),
    json: async () => body,
    arrayBuffer: async () => bytes || new ArrayBuffer(0),
  }, env, url];
};
const call = async (method, opts) => {
  const r = await W.handlePersonal(...req(method, opts));
  return { status: r.status, out: await r.json().catch(() => ({})) };
};
const file = async (path, headers = {}) => W.handlePersonalFile(...req('GET', { path: `/api/admin/personal/file?path=${encodeURIComponent(path)}`, headers }));
const CLIMB = ['..', '..'].join('/');

// ---------------------------------------------------------------------------
console.log('\n--- A. who gets in ---');
reset();
check('A1 the cap is 50 MB and the scopes are the two shelves',
  W.PERSONAL_MAX_BYTES === 50 * 1024 * 1024 && W.PERSONAL_SCOPES.join() === 'all,case');
who = null;
{
  const g = await call('GET', { path: '/api/admin/personal?scope=all' });
  const p = await call('POST', { headers: { 'x-pa-scope': 'all', 'x-pa-name': 'x' }, bytes: new Uint8Array([1]).buffer });
  const d = await call('DELETE', { body: { path: 'personal/eric/all/1700000000000-tax.pdf' } });
  const fr = await file('personal/eric/all/1700000000000-tax.pdf');
  // NEGATIVE CONTROL (run 2026-09-03): `if (!admin) return json(..., 404)` deleted from handlePersonal made this read
  //   FAIL  A2 a stranger, and a signed-in client, get 404 on every verb and on the file route, with nothing touched
  check('A2 a stranger, and a signed-in client, get 404 on every verb and on the file route, with nothing touched',
    g.status === 404 && p.status === 404 && d.status === 404 && fr.status === 404
    && puts.length === 0 && dels.length === 0 && fetched.length === 0 && store.size === 5);
}
reset();
{
  const rx = new RegExp(W.ADMIN_ASSET.source);
  check('A3 the module is an admin asset: the gate 404s it to anyone without the cookie',
    rx.test('/js/admin-personal.js') && !rx.test('/js/case.js'));
}

// ---------------------------------------------------------------------------
console.log('\n--- B. the prefix is the caller\'s, always ---');
reset();
{
  const r = await call('POST', {
    headers: { 'x-pa-scope': 'all', 'x-pa-name': encodeURIComponent('Tax 2025.pdf'), 'content-type': 'application/pdf', 'x-pa-uid': 'mallory', 'x-pa-case': `${CLIMB}/mallory` },
    bytes: new Uint8Array([1, 2, 3]).buffer,
  });
  // NEGATIVE CONTROL (run 2026-09-03): the prefix read from `request.headers.get('x-pa-uid') || uid` made this read
  //   FAIL  B1 an upload lands under the verified uid; a header naming another uid is ignored
  check('B1 an upload lands under the verified uid; a header naming another uid is ignored',
    r.status === 200 && puts.length === 1 && /^personal\/eric\/all\/\d{13}-Tax 2025\.pdf$/.test(puts[0].path)
    && puts[0].contentType === 'application/pdf' && r.out.file.name === 'Tax 2025.pdf', puts[0]?.path);
}
reset();
{
  const bad = await call('POST', { headers: { 'x-pa-scope': 'case', 'x-pa-case': `${CLIMB}/mallory`, 'x-pa-name': 'x' }, bytes: new Uint8Array([1]).buffer });
  const bad2 = await call('POST', { headers: { 'x-pa-scope': 'shared', 'x-pa-name': 'x' }, bytes: new Uint8Array([1]).buffer });
  const good = await call('POST', { headers: { 'x-pa-scope': 'case', 'x-pa-case': 'abc', 'x-pa-name': 'plan.pdf' }, bytes: new Uint8Array([1]).buffer });
  check('B2 a case shelf needs a clean case id, and there is no third scope',
    bad.status === 400 && bad2.status === 400 && good.status === 200 && /^personal\/eric\/case\/abc\/\d{13}-plan\.pdf$/.test(puts[0]?.path || '')
    && puts.length === 1);
}
{
  const leaf = W.personalLeaf(`${CLIMB}/etc/passwd .pdf`);
  // NEGATIVE CONTROL (run 2026-09-03): the slash dropped from the leaf's character class made this read
  //   FAIL  B3 a file name cannot carry a path: slashes and control characters become spaces, leading dots go
  check('B3 a file name cannot carry a path: slashes and control characters become spaces, leading dots go',
    /^\d{13}-etc passwd \.pdf$/.test(leaf) && !leaf.includes('/') && !leaf.includes('..')
    && !W.personalLeaf('a..b.pdf').includes('..'), leaf);
  check('B4 ownPersonalPath admits the caller\'s two shelves and nothing else',
    W.ownPersonalPath('eric', 'personal/eric/all/1-x.pdf') && W.ownPersonalPath('eric', 'personal/eric/case/abc/1-x.pdf')
    && !W.ownPersonalPath('eric', 'personal/mallory/all/1-x.pdf') && !W.ownPersonalPath('eric', `personal/eric/all/${CLIMB}/mallory/all/1-x.pdf`)
    && !W.ownPersonalPath('eric', 'personal/eric/all//1-x.pdf') && !W.ownPersonalPath('eric', 'cases/abc/uploads/1-x.pdf')
    && !W.ownPersonalPath('eric', 'personal/eric/case/abc') && !W.ownPersonalPath('eric', 'personal/eric/case/a b/1-x.pdf')
    && !W.ownPersonalPath('eric', 'personal/eric/shared/1-x.pdf'));
}

// ---------------------------------------------------------------------------
console.log('\n--- C. list, delete, read: inside the prefix only ---');
reset();
{
  const all = await call('GET', { path: '/api/admin/personal?scope=all' });
  const one = await call('GET', { path: '/api/admin/personal?scope=case&caseId=abc' });
  const bad = await call('GET', { path: `/api/admin/personal?scope=case&caseId=${encodeURIComponent(CLIMB + '/mallory')}` });
  // NEGATIVE CONTROL (run 2026-09-03): listing `personal/` instead of the prefix made this read
  //   FAIL  C1 the list is the caller's shelf, newest first, and never another person's or a case folder
  check('C1 the list is the caller\'s shelf, newest first, and never another person\'s or a case folder',
    all.status === 200 && all.out.files.map((x) => x.name).join() === 'notes.txt,tax.pdf'
    && one.out.files.map((x) => x.path).join() === 'personal/eric/case/abc/1700000000002-plan.pdf'
    && bad.status === 400
    && all.out.files.every((x) => !('url' in x)), JSON.stringify(all.out));
}
reset();
{
  const own = await call('DELETE', { body: { path: 'personal/eric/all/1700000000000-tax.pdf' } });
  const hers = await call('DELETE', { body: { path: 'personal/mallory/all/1700000000003-hers.pdf' } });
  const cse = await call('DELETE', { body: { path: 'cases/abc/uploads/1700000000004-client.pdf' } });
  const climb = await call('DELETE', { body: { path: `personal/eric/all/${CLIMB}/cases/abc/uploads/x` } });
  // NEGATIVE CONTROL (run 2026-09-03): the ownPersonalPath check dropped from DELETE made this read
  //   FAIL  C2 delete takes the caller's own file and refuses another person's, a case folder, and a climb
  check('C2 delete takes the caller\'s own file and refuses another person\'s, a case folder, and a climb',
    own.status === 200 && hers.status === 400 && cse.status === 400 && climb.status === 400
    && dels.join() === 'personal/eric/all/1700000000000-tax.pdf' && store.size === 4);
}
reset();
{
  const pdf = await file('personal/eric/all/1700000000000-tax.pdf');
  const txt = await file('personal/eric/all/1700000000001-notes.txt');
  store.set('personal/eric/all/1700000000005-page.html', { type: 'text/html', size: 5, at: 6 });
  const html = await file('personal/eric/all/1700000000005-page.html');
  const hers = await file('personal/mallory/all/1700000000003-hers.pdf');
  const missing = await file('personal/eric/all/1700000000009-gone.pdf');
  check('C3 a pdf opens inline, text opens inline, anything else downloads, all under a sandbox and nosniff, never cached',
    pdf.status === 200 && pdf.headers.get('content-disposition') === 'inline; filename="tax.pdf"'
    && pdf.headers.get('content-type') === 'application/pdf'
    && txt.headers.get('content-disposition') === 'inline; filename="notes.txt"'
    && html.headers.get('content-disposition') === 'attachment; filename="page.html"'
    && html.headers.get('content-type') === 'application/octet-stream'
    && [pdf, txt, html].every((r) => r.headers.get('content-security-policy') === "sandbox; default-src 'none'"
      && r.headers.get('x-content-type-options') === 'nosniff' && r.headers.get('cache-control') === 'private, no-store'));
  // NEGATIVE CONTROL (run 2026-09-03): the ownPersonalPath check dropped from the file route made this read
  //   FAIL  C4 another person's file and a path outside the prefix are refused before any byte is fetched
  check('C4 another person\'s file and a path outside the prefix are refused before any byte is fetched',
    hers.status === 400 && missing.status === 404 && !fetched.includes('personal/mallory/all/1700000000003-hers.pdf'));
}

// ---------------------------------------------------------------------------
console.log('\n--- D. the cookie door on the file route ---');
reset();
who = null; cookieUid = 'eric';
{
  const r = await file('personal/eric/all/1700000000000-tax.pdf');
  check('D1 with no bearer token, the admin cookie opens the file, and only when its uid has the admin role',
    r.status === 200);
}
reset();
who = null; cookieUid = 'mallory';
{
  const r = await file('personal/mallory/all/1700000000003-hers.pdf');
  // NEGATIVE CONTROL (run 2026-09-03): the role check on the cookie uid dropped made this read
  //   FAIL  D2 a cookie for a uid that is not an admin opens nothing
  check('D2 a cookie for a uid that is not an admin opens nothing', r.status === 404 && fetched.length === 0);
}
reset();
who = null; cookieUid = null;
check('D3 no token and no cookie is the site\'s own 404', (await file('personal/eric/all/1700000000000-tax.pdf')).status === 404);
check('D4 the cookie is never taken on the list, upload or delete routes',
  !/adminCookieUid/.test(fn('handlePersonal')) && /adminCookieUid/.test(fn('handlePersonalFile')));

// ---------------------------------------------------------------------------
console.log('\n--- E. size ---');
reset();
{
  const big = await call('POST', { headers: { 'x-pa-scope': 'all', 'x-pa-name': 'x', 'content-length': String(51 * 1024 * 1024) }, bytes: new Uint8Array([1]).buffer });
  const empty = await call('POST', { headers: { 'x-pa-scope': 'all', 'x-pa-name': 'x' }, bytes: new ArrayBuffer(0) });
  const lied = await call('POST', { headers: { 'x-pa-scope': 'all', 'x-pa-name': 'x', 'content-length': '1' }, bytes: new ArrayBuffer(50 * 1024 * 1024 + 1) });
  // NEGATIVE CONTROL (run 2026-09-03): the post-read byteLength check dropped made this read
  //   FAIL  E1 over 50 MB is refused on the declared length and again on the bytes; empty is refused
  check('E1 over 50 MB is refused on the declared length and again on the bytes; empty is refused',
    big.status === 413 && empty.status === 400 && lied.status === 413 && puts.length === 0);
}

// ---------------------------------------------------------------------------
console.log('\n--- F. nothing else can see it ---');
{
  const rules = f('storage.rules');
  const tail = rules.slice(rules.lastIndexOf('match /{allPaths=**}'));
  // NEGATIVE CONTROL (run 2026-09-03): `match /personal/{uid}/{allPaths=**} { allow read: if isAdmin(); }` added made this read
  //   FAIL  F1 storage.rules name no personal/ path, so the deny tail is the only rule that reaches it
  check('F1 storage.rules name no personal/ path, so the deny tail is the only rule that reaches it',
    !/personal/.test(rules) && /allow read, write: if false;/.test(tail));
  check('F2 the Worker\'s storage helper is the only writer, and the advisor\'s walks name case folders only',
    /export async function putFile/.test(code('worker/storage.js'))
    && /INTAKE_FOLDERS = \['uploads', 'chat-files'\]/.test(code('worker/storage.js'))
    && /\[\.\.\.INTAKE_FOLDERS, 'report', 'recording'\]/.test(code('worker/storage.js'))
    && !/personal\//.test(code('worker/advisor.js'))
    && !/personal\//.test(fn('handleFileMeta')) && !/personal\//.test(fn('handleFileDelete')));
  // changelog.js is served to everyone and carries the admin lines of every
  // version in source, which is how it has always shipped; its one line names
  // the feature and nothing about any file. Every other client module is held
  // to the prefix, the route and the shelf's name.
  const clientJs = readdirSync(__j(__REPO, 'public/js')).filter((n) => n.endsWith('.js') && !/^admin/.test(n) && !/^(advisor|notes|duty|prep|drawer|seen|panel-bridge|changelog)\.js$/.test(n));
  // NEGATIVE CONTROL (run 2026-09-03): `import { mountPersonal } from './admin-personal.js'` added to case.js made this read
  //   FAIL  F3 no client module names the prefix, the route, or the shelf
  check('F3 no client module names the prefix, the route, or the shelf',
    clientJs.every((n) => { const t = code(`public/js/${n}`); return !/personal\/|admin-personal|api\/admin\/personal|Personal Uploads/.test(t); })
    && readdirSync(__j(__REPO, 'public')).filter((n) => n.endsWith('.html') && !/^admin/.test(n))
      .every((n) => !/Personal Uploads|admin-personal|api\/admin\/personal|personal\//.test(f(`public/${n}`))));
  check('F4 the audit lists the module, and the demo keeps the shelf admin-only under its own prefix',
    /'\/js\/admin-personal\.js'/.test(code('tools/blindness-audit.mjs'))
    && /path === '\/api\/admin\/personal'\) \{\s*if \(role !== 'admin'\) return fail\(404/.test(code('public/js/demo/api.js'))
    && /personal\/\$\{uid\}\/all\//.test(code('public/js/demo/api.js')));
}

// ---------------------------------------------------------------------------
console.log('\n--- G. the two places, and the words ---');
{
  const mod = code('public/js/admin-personal.js');
  check('G1 the module talks to the Worker only: no Firebase, no case folder, the file link on the cookie route',
    /fetch\(`\/api\/admin\/personal/.test(mod) && !/firebase|uploadBytes|\bref\(storage|getDownloadURL|cases\//.test(mod)
    && /\/api\/admin\/personal\/file\?path=/.test(mod) && /MAX_BYTES = 50 \* 1024 \* 1024/.test(mod)
    && /confirm\(/.test(mod));
  check('G2 the Clients page mounts the shelf with scope all, folded; the case page has a Personal tab under Mine, open',
    /id="personal"/.test(f('public/admin.html'))
    && /mountPersonal\(document\.getElementById\('personal'\), \{ getToken: \(\) => user\.getIdToken\(\), scope: 'all' \}\)/.test(code('public/js/admin.js'))
    && /pages: \['notes', 'calldoc', 'drafts', 'saved', 'personal'\]/.test(code('public/js/admin-case.js'))
    && /id: 'personal', title: 'Personal', icon: '🤫'/.test(code('public/js/admin-case.js'))
    && /scope: 'case', caseId, open: true/.test(code('public/js/admin-case.js')));
  check('G3 the routes are registered and requireAdmin is the first thing each does',
    /url\.pathname === '\/api\/admin\/personal'\)\s*return await handlePersonal\(request, env, url\)/.test(CODE)
    && /url\.pathname === '\/api\/admin\/personal\/file' && request\.method === 'GET'\)\s*return await handlePersonalFile/.test(CODE)
    && /async function handlePersonal\(request, env, url\) \{\n  const admin = await requireAdmin\(request, env\);/.test(SRC)
    && /async function handlePersonalFile\(request, env, url\) \{\n  const admin = await requireAdmin\(request, env\);/.test(SRC));
  const region = SRC.slice(SRC.indexOf('PERSONAL UPLOADS (Eric'), SRC.indexOf('// DELETE /api/admin/slots/:id'));
  const css = f('public/css/admin.css'); const cssBlock = css.slice(css.indexOf('Personal Uploads (Eric'));
  // NEGATIVE CONTROL (run 2026-09-03): an em dash typed into the shelf's note made this read
  //   FAIL  G4 not one em or en dash in anything new
  check('G4 not one em or en dash in anything new',
    ![f('public/js/admin-personal.js'), region, cssBlock, code('public/js/changelog.js').split('\n').find((l) => /Personal Uploads:/.test(l)) || ''].some((s) => /[–—]/.test(s)));
  check('G5 the version moved in both places, with the shelf on the admin lines and never on a client line',
    /const VERSION = '2\.78';/.test(SRC) && /BUILD_TAG = 'v2026-09-03-personal-uploads'/.test(SRC)
    && /version: '2\.78',[\s\S]{0,400}admin: \[\s*'Personal Uploads:/.test(f('public/js/changelog.js'))
    && !/client: \[[^\]]*Personal Uploads/.test(f('public/js/changelog.js')));
}

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
