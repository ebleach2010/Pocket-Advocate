// preview.mjs - "Preview a case": a whole invented case a visitor can use,
// inside their own tab, gone when they exit.
//
// Eric, 2026-10-15: "This showcase suite should exhibit every feature and be
// fully interactable. They can even chat and upload documents but they get
// deleted as soon as they exit the showcase suite. This showcase suite will
// be on the top left in the same aesthetic as the waitlist button, but it
// will say 'preview a case' or something similar. So clients can see the
// features before they commit. When they're in the showcase suite, a button
// of the same design is in the top left (make sure it's not blocking any
// interactable UI elements) that say exit. Once they tap this it brings them
// back to the landing page."
//
// The preview's store, seed and routes are imported and RUN here against a
// stand-in tab (sessionStorage, fetch, location); the switch in firebase.js
// is lifted and run; the files are scanned as the server serves them. The
// whole walk runs in a browser in drive-preview.mjs.
//
// Run: node preview.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
const HARD = [/advisor/i, /differential/i, /working diagnos/i, /dxOverride/, /workingDx/, /\bAI\b/, /artificial intelligence/i, /\bLLM\b/i,
  /language model/i, /\bClaude\b/i, /Anthropic/i, /\bOpus\b/i, /\bGPT\b/, /chatbot/i, /\bFable\b/i, /\bthe model\b/i, /\ba model\b/i];
const DASH = new RegExp('[\\u2013\\u2014]');

// ---- a stand-in tab ----------------------------------------------------------
const mem = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
const realCalls = [];
const assigned = [];
globalThis.window = { fetch: async (url) => { realCalls.push(String(url)); return new Response('{"caseCents":210000}', { status: 200 }); } };
globalThis.document = { body: null, head: { appendChild() {} }, addEventListener() {}, querySelector: () => null };
globalThis.location = { assign: (u) => assigned.push(u), pathname: '/case.html', search: '?preview=1' };

const store = await import(pathToFileURL(j(ROOT, 'public/js/preview/store.js')).href);
const seedMod = await import(pathToFileURL(j(ROOT, 'public/js/preview/seed.js')).href);
const apiMod = await import(pathToFileURL(j(ROOT, 'public/js/preview/api.js')).href);
const joe = await import(pathToFileURL(j(ROOT, 'public/js/preview/joe.js')).href);
const fb = store.mountPreview();
const { PREVIEW_UID: UID, PREVIEW_CASE: CID } = seedMod;
const call = (path, body, method = 'POST') => window.fetch(path, method === 'GET' ? {} : { method, body: JSON.stringify(body || {}) })
  .then(async (r) => ({ s: r.status, o: await r.json().catch(() => ({})) }));
const files = async (folder) => (await fb.listAll(fb.ref(fb.storage, `cases/${CID}/${folder}`))).items;

console.log('\n--- A. the case they walk ---');
{
  const mine = await fb.getDocs(fb.query(fb.collection(fb.db, 'cases'), fb.where('clientUid', '==', UID)));
  const c = mine.docs[0]?.data() || {};
  const chat = (await fb.getDocs(fb.query(fb.collection(fb.db, 'cases', CID, 'chat'), fb.orderBy('ts', 'asc')))).docs.map((x) => x.data());
  const [report, uploads, chatFiles, recording] = await Promise.all(['report', 'uploads', 'chat-files', 'recording'].map(files));
  const opened = await fb.getDownloadURL(uploads[0]);
  const now = Date.now();
  // Each entry on the showcase's list, and what proves the preview carries it.
  const log = await call(`/api/case-log?caseId=${CID}`, null, 'GET');
  const proof = {
    chat: () => chat.length === 50 && chat.some((m) => m.role === 'admin') && chat.some((m) => m.role === 'client'),
    documents: () => chat.filter((m) => m.attachment).length === 4 && chat.filter((m) => m.attachment).every((m) => /^data:application\/pdf;base64,/.test(m.attachment.url)),
    appointment: () => c.appointment?.start?.toDate() < new Date() && c.appointment.method === 'video',
    report: () => !!c.reportDeliveredAt && report.some((r) => /case-report\.pdf$/.test(r.name)),
    fullService: () => c.fullAccess === true && !!c.fullAccessAt,
    milestones: () => log.o.milestones?.length === 6,
    workLog: () => log.o.items?.length === 7,
    permissions: () => true,
    agenda: () => true,
    telehealth: () => c.telehealthVisits?.[0]?.when.toDate() > new Date(),
    checkIn: () => c.checkIns?.[0]?.start.toDate() > new Date(),
    recording: () => recording.length === 1 && /\.wav$/.test(recording[0].name),
  };
  const missing = joe.SHOWCASE_COVERS.filter((k) => !proof[k] || !proof[k]());
  // NEGATIVE CONTROL (run 2026-10-15): the seed's recording file taken out made this read
  //   FAIL  A1 the preview is Joe Bloe's whole case as its client sees it, every entry on the showcase's list included, with a case he is working on right now
  check('A1 the preview is Joe Bloe\'s whole case as its client sees it, every entry on the showcase\'s list included, with a case he is working on right now',
    mine.size === 1 && c.clientName === 'Joe Bloe' && c.status === 'delivered' && !missing.length
    && c.work?.startedAt && c.work.doing === 'reading your angiography report' && now - c.work.startedAt.toDate().getTime() < 3600_000
    && report.length === 2 && uploads.length === 4 && chatFiles.length === 4 && /^data:application\/pdf;base64,/.test(opened),
    JSON.stringify({ missing, size: mine.size, report: report.length, uploads: uploads.length, chatFiles: chatFiles.length }));
  const items = log.o.items || [];
  // NEGATIVE CONTROL (run 2026-10-15): the seed's caseLog rows written with `phone: clinic phone` made this read
  //   FAIL  A2 his log reaches the visitor as the client's four fields only: never a phone, the parties or his notes
  check('A2 his log reaches the visitor as the client\'s four fields only: never a phone, the parties or his notes',
    items.length === 7 && items.every((x) => JSON.stringify(Object.keys(x).sort()) === JSON.stringify(['at', 'id', 'kind', 'summary', 'who']))
    // The log's own rows hold nothing else, and the parties he wrote down are nowhere in the tab. (A clinic's
    // number does sit on the records release the client signed: that is theirs, typed by them.)
    && Object.keys(JSON.parse(mem.get(store.STORE_KEY) || '{"docs":[]}').docs.find(([k]) => k.includes('/caseLog/'))?.[1] || {}).sort().join() === 'at,kind,summary,who'
    && [...mem.values()].every((v) => !/Scheduler; prior authorization desk|Appeals fax line|Health information management/.test(v)),
    JSON.stringify(items[0]));
}

console.log('\n--- B. everything works, and nothing leaves ---');
{
  const shop = await Promise.all(['/api/checkout', '/api/extend', '/api/upgrade', '/api/followup', '/api/chat-unlock', '/api/subscribe', '/api/portal']
    .map((p) => call(p, { caseId: CID })));
  const admin = await call('/api/admin/delete-case', { caseId: CID });
  const review = await call('/api/review', { caseId: CID, stars: 5 });
  const before = realCalls.length;
  await window.fetch('/api/rates');
  const passed = realCalls.length === before + 1 && realCalls[realCalls.length - 1] === '/api/rates';
  const postRates = await call('/api/rates', {});
  // NEGATIVE CONTROL (run 2026-10-15): '/api/extend' taken out of the preview's SHOP list made this read
  //   FAIL  B1 every purchase is refused in plain words, every advocate route is not there, a review is a real client's, and only public reads go to the server
  check('B1 every purchase is refused in plain words, every advocate route is not there, a review is a real client\'s, and only public reads go to the server',
    shop.every((r) => r.s === 409 && r.o.error === apiMod.NOT_HERE) && admin.s === 404 && review.s === 409
    && passed && postRates.s === 200 && realCalls.length === before + 1 && !DASH.test(apiMod.NOT_HERE + apiMod.FIRST_REPLY),
    JSON.stringify({ shop: shop.map((r) => r.s), admin: admin.s, review: review.s, passed, real: realCalls }));

  const add = await call('/api/agenda', { id: CID, action: 'add', text: 'Ask about the infusions' });
  const theirs = (await call(`/api/agenda?id=${CID}`, null, 'GET')).o.items;
  const hisItem = theirs.find((x) => x.role === 'admin');
  const noRemove = await call('/api/agenda', { id: CID, action: 'remove', itemId: hisItem.id });
  const remove = await call('/api/agenda', { id: CID, action: 'remove', itemId: add.o.item.id });
  const ink = 'data:image/png;base64,iVBORw0KGgo=';
  const wrongName = await call('/api/authority', { caseId: CID, kind: 'records', signedName: 'Pat Smith', clinicName: 'X', scopes: ['records'], signatureImage: ink });
  const signed = await call('/api/authority', { caseId: CID, kind: 'records', signedName: 'Joe Bloe', clinicName: 'Valley Imaging', scopes: ['records'], signatureImage: ink });
  const listed = (await call(`/api/authority?caseId=${CID}`, null, 'GET')).o.items;
  const badDelete = await call('/api/file/delete', { path: `cases/${CID}/report/x.pdf` });
  // NEGATIVE CONTROL (run 2026-10-15): the agenda's `it.role !== 'client'` refusal taken out made this read
  //   FAIL  B2 the next-call list takes and drops their own items but not his, a permission signs only in the case's name, and only their own files can be deleted
  check('B2 the next-call list takes and drops their own items but not his, a permission signs only in the case\'s name, and only their own files can be deleted',
    add.s === 200 && theirs.length === 4 && noRemove.s === 403 && remove.s === 200
    && wrongName.s === 400 && signed.s === 200 && listed.length === 5 && listed.every((x) => !('signatureImage' in x)) && listed.some((x) => x.hasSignature)
    && badDelete.s === 403,
    JSON.stringify({ theirs: theirs.length, noRemove: noRemove.s, wrongName: wrongName.o.error, signed: signed.s, listed: listed.length, badDelete: badDelete.s }));

  const msgs = () => fb.getDocs(fb.collection(fb.db, 'cases', CID, 'chat')).then((s) => s.docs.map((x) => x.data()));
  await fb.addDoc(fb.collection(fb.db, 'cases', CID, 'chat'), { from: UID, role: 'client', text: 'Hello', ts: fb.serverTimestamp() });
  await call('/api/notify', { kind: 'case', id: CID });
  await call('/api/notify', { kind: 'case', id: CID });
  await new Promise((r) => setTimeout(r, 2600));
  const after = await msgs();
  const replies = after.filter((m) => m.text === apiMod.FIRST_REPLY);
  // NEGATIVE CONTROL (run 2026-10-15): the `!meta.replied` guard taken out of /api/notify made this read
  //   FAIL  B3 their message lands, and the first one gets a single answer saying nobody reads it here; a second does not
  check('B3 their message lands, and the first one gets a single answer saying nobody reads it here; a second does not',
    after.some((m) => m.text === 'Hello' && m.role === 'client') && replies.length === 1 && replies[0].role === 'admin',
    `${replies.length} replies`);
}

console.log('\n--- C. Exit ---');
{
  const kept = mem.has(store.STORE_KEY);
  store.wipePreview();
  const cases = await fb.getDocs(fb.collection(fb.db, 'cases'));
  // NEGATIVE CONTROL (run 2026-10-15): wipePreview's `docs.clear();` taken out made this read
  //   FAIL  C1 Exit wipes the case, the files and both keys; signing out of it is the same, and goes home
  await fb.signOut();
  check('C1 Exit wipes the case, the files and both keys; signing out of it is the same, and goes home',
    kept && cases.size === 0 && !mem.has(store.STORE_KEY) && !mem.has(store.FLAG_KEY) && assigned.includes('/')
    && (await fb.listAll(fb.ref(fb.storage, `cases/${CID}/uploads`))).items.length === 0,
    JSON.stringify({ kept, cases: cases.size, keys: [...mem.keys()], assigned }));
}

console.log('\n--- D. the switch, the door and Exit ---');
{
  const FB = f('public/js/firebase.js');
  const iife = (FB.match(/const PREVIEW = (\(\(\) => \{[\s\S]*?\}\)\(\));/) || [])[1] || '';
  const run = (path, search, stored = {}, broken = false) => {
    const m = new Map(Object.entries(stored));
    const ss = broken ? { getItem() { throw new Error('blocked'); } } : { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k) };
    // eslint-disable-next-line no-new-func
    const on = new Function('location', 'sessionStorage', 'URLSearchParams', `return ${iife};`)({ pathname: path, search }, ss, URLSearchParams);
    return [on, Object.fromEntries(m)];
  };
  const [enter, kept] = run('/case.html', '?preview=1');
  const [stays] = run('/chat.html', '', { 'pa-preview': '1' });
  const [adminNo] = run('/admin.html', '?preview=1');
  const [off, cleared] = run('/case.html', '?preview=0', { 'pa-preview': '1', 'pa-preview-store': '{}' });
  const [blocked] = run('/case.html', '?preview=1', {}, true);
  const [plain] = run('/case.html', '');
  // NEGATIVE CONTROL (run 2026-10-15): firebase.js's `/^\/admin/` refusal taken out made this read
  //   FAIL  D1 a tab enters the preview from its link and stays in it page to page, never on an advocate page, never without storage, and leaves on ?preview=0; the real app is the default and the preview is chosen before the demo
  check('D1 a tab enters the preview from its link and stays in it page to page, never on an advocate page, never without storage, and leaves on ?preview=0; the real app is the default and the preview is chosen before the demo',
    !!iife && enter && kept['pa-preview'] === '1' && stays && !adminNo && !off && !('pa-preview' in cleared) && !('pa-preview-store' in cleared) && !blocked && !plain
    && /const impl = PREVIEW\n\s+\? await import\('\.\/preview\/store\.js'\)\.then\(\(m\) => m\.mountPreview\(\)\)\n\s+: DEMO\n/.test(FB),
    JSON.stringify({ enter, stays, adminNo, off, blocked, plain }));
  const IDX = f('public/index.html');
  const CSS = f('public/css/landing.css');
  // NEGATIVE CONTROL (run 2026-10-15): the home's inline script that clears the preview taken out made this read
  //   FAIL  D2 the home's top left is Preview a case, the waitlist bubble's twin with its tail on the left, and arriving home ends any preview
  check('D2 the home\'s top left is Preview a case, the waitlist bubble\'s twin with its tail on the left, and arriving home ends any preview',
    /<div class="hero-top">\s*<a class="wl-bubble pv-bubble" href="\/case\.html\?preview=1"><span class="wl-spark" aria-hidden="true">&#10022;<\/span>Preview a case<\/a>/.test(IDX)
    && /body\.landing \.pv-bubble \{ justify-self: start; border-radius: 20px 20px 20px 4px; text-decoration: none; \}/.test(CSS)
    && /body\.landing \.pv-bubble::after \{ right: auto; left: -7px;/.test(CSS)
    && /try \{ sessionStorage\.removeItem\('pa-preview'\); sessionStorage\.removeItem\('pa-preview-store'\); \}/.test(IDX)
    && IDX.indexOf("sessionStorage.removeItem('pa-preview')") < IDX.indexOf('<script type="module" src="/js/waitlist.js'));
  const BAR = f('public/js/preview/bar.js');
  // NEGATIVE CONTROL (run 2026-10-15): the strip's `position: sticky; top: 0;` changed to `position: fixed; top: 0;` made this read
  //   FAIL  D3 Exit is the first thing in a strip of its own at the top, in the same bubble, the header docking under it so it covers nothing, and it wipes before it goes home
  check('D3 Exit is the first thing in a strip of its own at the top, in the same bubble, the header docking under it so it covers nothing, and it wipes before it goes home',
    /\.pv-strip \{\n\s+position: sticky; top: 0; z-index: 40;/.test(BAR)
    && /<button type="button" class="pv-exit" data-preview-exit>Exit<\/button>\n\s+<span class="pv-what">/.test(BAR)
    && /border-radius: 20px 20px 20px 4px;/.test(BAR) && /linear-gradient\(110deg, #3DDCF5 0%, #9BEBFA 48%, #B9A6FF 100%\)/.test(BAR)
    && /document\.body\.classList\.add\('has-demo-bar'\);/.test(BAR) && /--demo-bar-h/.test(BAR)
    && /wipe\(\);\n\s+location\.assign\('\/'\);/.test(BAR) && !DASH.test(BAR));
}

console.log('\n--- E. what anyone can download ---');
{
  const W = f('worker/index.js');
  const ADMIN_ASSET = new Function(`${(W.match(/const ADMIN_ASSET =\n\s+\/[^\n]+\/;/) || [''])[0]} return ADMIN_ASSET;`)();
  const DEMO_ASSET = new Function(`${(W.match(/const DEMO_ASSET = [^\n]+;/) || [''])[0]} return DEMO_ASSET;`)();
  const names = readdirSync(j(ROOT, 'public/js/preview')).filter((n) => n.endsWith('.js'));
  const hits = names.flatMap((n) => HARD.filter((re) => re.test(f(`public/js/preview/${n}`))).map((re) => `${n} ${re}`));
  // NEGATIVE CONTROL (run 2026-10-15): the MRI report's "Possible causes include" put back to "Differential includes" made this read
  //   FAIL  E1 every preview file is served to anyone and carries no word a client must not read, and the story behind the showcase lives there once
  check('E1 every preview file is served to anyone and carries no word a client must not read, and the story behind the showcase lives there once',
    names.length === 5 && !hits.length && names.every((n) => !ADMIN_ASSET.test(`/js/preview/${n}`) && !DEMO_ASSET.test(`/js/preview/${n}`))
    && /from '\.\.\/public\/js\/preview\/joe\.js';/.test(f('worker/showcase.js')) && !/export const CHAT = \[/.test(f('worker/showcase.js')),
    hits.join(', ') || names.join(','));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const r of failed) console.log(`  FAILED: ${r.name}`);
  process.exit(1);
}
process.exit(0);
