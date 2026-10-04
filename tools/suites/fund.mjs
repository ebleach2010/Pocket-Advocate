// fund.mjs - the Community Assistance Fund's verification (Eric, 2026-10-04).
//
//   node tools/suites/fund.mjs
//
// worker/fund.js is evaluated whole with its imports replaced by fakes that
// behave like the real ones (a masked patch merges, an unmasked one replaces,
// a stale update time or an existing document fails the write), so every
// route RUNS: the applicant's save, upload, remove and submit, and the
// reviewer's queue, view, file and actions. The rules module is the real
// one, imported. The page, the demo, the gate and the lists are pinned.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const RULES = await import('../../public/js/fund-rules.js');
const SRC = f('worker/fund.js');
const W = f('worker/index.js');
const PAGE = f('public/js/fund.js');
const HTML = f('public/fund.html');
const ADMINPAGE = f('public/js/admin-fund.js');
const DEMO = f('public/js/demo/fund.js');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
const DASH = /[\u2013\u2014]/;
const HARD = [/advisor/i, /differential/i, /working diagnos/i, /dxOverride/, /workingDx/, /\bAI\b/, /artificial intelligence/i, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bOpus\b/i, /\bGPT\b/, /chatbot/i, /\bFable\b/i, /\bthe model\b/i, /\ba model\b/i];

// ---- the world ------------------------------------------------------------------
// What Firestore hands back: timestamps as ISO strings, a fresh copy each read.
const thaw = (v) => JSON.parse(JSON.stringify(v ?? null));
function world({ putFails = false } = {}) {
  const docs = new Map();
  const files = new Map();
  const pushes = [];
  const emails = [];
  let clock = 0;
  const setDoc = (path, data) => docs.set(path, { data: thaw(data), updateTime: `t${++clock}` });
  const deps = {
    getDoc: async (env, path) => (docs.has(path) ? { data: thaw(docs.get(path).data), updateTime: docs.get(path).updateTime } : null),
    patchDoc: async (env, path, data, opts = {}) => {
      const cur = docs.get(path);
      if (opts.mustNotExist && cur) return false;
      if (opts.ifUpdateTime && (!cur || cur.updateTime !== opts.ifUpdateTime)) return false;
      if (!opts.mask) { setDoc(path, data); return true; }
      const next = { ...(cur?.data || {}) };
      for (const k of opts.mask) next[k] = thaw(data[k]);
      setDoc(path, next);
      return true;
    },
    deleteDoc: async (env, path) => { docs.delete(path); },
    listDocs: async (env, coll) => [...docs.entries()].filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === 2)
      .map(([k, v]) => ({ id: k.split('/')[1], data: thaw(v.data) })),
    putFile: async (env, path, bytes, contentType) => {
      if (putFails) throw new Error('storage put: 503');
      files.set(path, { bytes: new Uint8Array(bytes), contentType });
      return { path, name: path.split('/').pop(), size: bytes.byteLength };
    },
    deleteFile: async (env, path) => { files.delete(path); },
    mediaFetch: async (env, path) => (files.has(path)
      ? { ok: true, body: files.get(path).bytes, headers: new Headers({ 'content-type': files.get(path).contentType }) }
      : { ok: false }),
    notifyUser: async (env, uid, msg) => { pushes.push({ uid, ...msg }); },
    sendEmail: async (env, msg) => { emails.push(msg); return true; },
    requireUser: async (request) => {
      const m = (request.headers.get('authorization') || '').match(/^Bearer (.+)$/);
      return m ? { uid: m[1], email: `${m[1]}@example.test` } : null;
    },
    ...RULES,
  };
  const body = SRC
    .replace(/^import [\s\S]*?from '[^']+';\n/gm, '')
    .replace(/^export (const|async function|function) /gm, '$1 ');
  const api = new Function(...Object.keys(deps), `${body}\nreturn { handleFund, minimizeFundApplication, isFundReviewer, FUND_REVIEWER_UIDS, drainFundNotices };`)(...Object.values(deps));
  setDoc('users/eric', { role: 'admin' });
  setDoc('users/ann', { role: 'client' });
  return { docs, files, pushes, emails, api, setDoc };
}
const env = { ADMIN_UID: 'eric' };
const req = (uid, path, { method = 'GET', json, bytes, type, length } = {}) => {
  const headers = new Headers();
  if (uid) headers.set('authorization', `Bearer ${uid}`);
  if (type) headers.set('content-type', type);
  if (bytes) headers.set('content-length', String(length ?? bytes.byteLength));
  const url = new URL(`https://x.test${path}`);
  return {
    url: url.href, method, headers,
    json: async () => { if (json === undefined) throw new Error('no body'); return json; },
    arrayBuffer: async () => bytes || new ArrayBuffer(0),
    _url: url,
  };
};
const call = async (w, uid, path, opts) => {
  const r = req(uid, path, opts);
  const res = await w.api.handleFund(r, env, r._url, null);
  const text = typeof res.body === 'string' || res.body == null ? null : null;
  void text;
  let out = null;
  try { out = await res.clone().json(); } catch { out = null; }
  return { status: res.status, out, res };
};
const PDF = () => new TextEncoder().encode('%PDF-1.4\n% one page\n%%EOF\n').buffer;
const PNG = () => new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0, 0, 0, 0x0D]).buffer;
const up = (w, uid, kind, bytes = PDF(), type = 'application/pdf', extra = {}) => call(w, uid, `/api/fund/upload?kind=${kind}`, { method: 'POST', bytes, type, ...extra });
// RE-PINNED 2026-10-04 (v7.24): a complete application carries the short reason they are in need
// (Eric: "a short blurb from them for why they are in need. Max 1500 characters.").
// RE-PINNED 2026-10-04 (v7.25): the payment is a check to a mailing address (Eric: "payout should
// be check only").
// RE-PINNED 2026-10-04 (v7.28): a complete application agrees its Discord username is published if
// approved (Eric: "Discord usernames are mandatory. They have to join.").
const FULL = {
  discordUsername: 'ann_d', preferredName: 'Ann', legalName: 'Ann Doe', discordMember: true, usernamePublicConsent: true, participationRequested: true,
  needStatement: 'I stopped working this spring and the copays take what is left.',
  consents: { accurate: true, noGuarantee: true, notMedical: true, reviewerView: true, formula: true },
  payment: { method: 'check', accountName: 'Ann Doe', address: { line1: '12 Pin Oak Dr', line2: '', city: 'Boise', state: 'ID', zip: '83702' } },
};
async function readyToSubmit(w, uid = 'ann', extra = {}) {
  await call(w, uid, '/api/fund/draft', { method: 'POST', json: { ...FULL, ...extra } });
  await up(w, uid, 'id');
  await up(w, uid, 'medical');
}
const app = (w, uid = 'ann') => w.docs.get(`fundApplications/${uid}`)?.data;

// ---- F1: nobody reaches anybody else's -----------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): reviewer()'s `|| !(await isFundReviewer(env, user.uid))` removed made this read
//   FAIL  F1 nobody reaches anybody else's: the application is the one the sign-in token names whatever the body says, an applicant gets the same 404 as a stranger on every reviewer route, nobody signed out gets past 401, and a reviewer can open a file only from inside that applicant's own prefix
{
  const w = world();
  await readyToSubmit(w, 'bob', { preferredName: 'Bob' });
  await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { preferredName: 'Ann', userId: 'bob', uid: 'bob', verificationStatus: 'verified' } });
  const mine = await call(w, 'ann', '/api/fund/me');
  const bobDoc = (await call(w, 'eric', '/api/admin/fund/view?uid=bob')).out.application;
  const docId = bobDoc.medicalDocuments[0].id;
  const asAnn = await Promise.all([
    call(w, 'ann', '/api/admin/fund/list'),
    call(w, 'ann', '/api/admin/fund/view?uid=bob'),
    call(w, 'ann', `/api/admin/fund/file?uid=bob&doc=${docId}`),
    call(w, 'ann', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'verify' } }),
  ]);
  const signedOut = await call(w, null, '/api/fund/me');
  // A document tampered so ann's application points at bob's file: still refused.
  w.setDoc('fundApplications/ann', { ...app(w, 'ann'), identityDocument: { id: 'a'.repeat(24), type: 'application/pdf', size: 9, path: app(w, 'bob').medicalDocuments[0].path } });
  const crossed = await call(w, 'eric', `/api/admin/fund/file?uid=ann&doc=${'a'.repeat(24)}`);
  check('F1 nobody reaches anybody else\'s: the application is the one the sign-in token names whatever the body says, an applicant gets the same 404 as a stranger on every reviewer route, nobody signed out gets past 401, and a reviewer can open a file only from inside that applicant\'s own prefix',
    mine.out.application.preferredName === 'Ann' && app(w, 'ann').userId === 'ann' && app(w, 'ann').verificationStatus === 'draft'
    && app(w, 'bob').preferredName === 'Bob' && app(w, 'bob').verificationStatus === 'draft'
    && asAnn.every((r) => r.status === 404) && signedOut.status === 401 && crossed.status === 404,
    JSON.stringify({ ann: asAnn.map((r) => r.status), signedOut: signedOut.status, crossed: crossed.status }));
}

// ---- F2: what may still change --------------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): EDITABLE widened to `new Set(['draft', 'more_info', 'submitted'])` made this read
//   FAIL  F2 a sent application is locked: once submitted, a save, an upload and a removal are each refused with 409 and change nothing; asked for more information, the applicant can change it again and send it back, and the reviewer gets an Updated push
{
  const w = world();
  await readyToSubmit(w);
  const sent = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const before = JSON.stringify(app(w));
  const locked = await Promise.all([
    call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { preferredName: 'Changed' } }),
    up(w, 'ann', 'medical'),
    call(w, 'ann', '/api/fund/remove', { method: 'POST', json: { kind: 'medical', id: app(w).medicalDocuments[0].id } }),
  ]);
  const unchanged = JSON.stringify(app(w)) === before;
  await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'request_info', reason: 'Letter is unreadable', message: 'Could you add a clearer copy of the letter?' } });
  const reopened = await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { applicantNote: 'Clearer copy added.' } });
  const again = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  check('F2 a sent application is locked: once submitted, a save, an upload and a removal are each refused with 409 and change nothing; asked for more information, the applicant can change it again and send it back, and the reviewer gets an Updated push',
    sent.status === 200 && locked.every((r) => r.status === 409) && unchanged
    && reopened.status === 200 && again.status === 200 && app(w).verificationStatus === 'submitted'
    && w.pushes.map((p) => p.title).join() === 'New fund application,Updated fund application',
    JSON.stringify({ locked: locked.map((r) => r.status), reopened: reopened.status, pushes: w.pushes.map((p) => p.title) }));
}

// ---- F3: nothing incomplete is sent ---------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): submitGaps' medical-documents line removed made this read
//   FAIL  F3 nothing incomplete is sent: each missing piece is refused with its own sentence and the step it belongs to, payment is asked for only from someone who wants distributions, and a complete one is Submitted with the time, the five consents stamped and the history written
{
  const gaps = (a, p) => RULES.submitGaps(a, p).map((g) => g.step);
  const full = { discordUsername: 'a', preferredName: 'A', legalName: 'A B', identityDocument: { id: 'x' }, medicalDocuments: [{ id: 'y' }], needStatement: 'Rent.', discordMember: true, usernamePublicConsent: true, participationRequested: true, consents: FULL.consents }; // RE-PINNED 2026-10-04 (v7.28): the username tick
  const pay = { method: 'check', accountName: 'A B', address: { line1: '1 Main St', line2: '', city: 'Boise', state: 'ID', zip: '83702' } }; // RE-PINNED 2026-10-04 (v7.25): check only
  const one = (k, v) => gaps({ ...full, [k]: v }, pay);
  const w = world();
  await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { ...FULL, legalName: '' } });
  const noLegal = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  await readyToSubmit(w);
  const ok = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const a = app(w);
  check('F3 nothing incomplete is sent: each missing piece is refused with its own sentence and the step it belongs to, payment is asked for only from someone who wants distributions, and a complete one is Submitted with the time, the five consents stamped and the history written',
    gaps(full, pay).length === 0
    && one('discordUsername', '').join() === '1' && one('legalName', '').join() === '1' && one('identityDocument', null).join() === '2'
    && one('medicalDocuments', []).join() === '3' && one('discordMember', false).join() === '4' && one('participationRequested', null).join() === '4'
    && gaps(full, null).join() === '5' && gaps({ ...full, participationRequested: false }, null).length === 0
    && one('consents', { ...FULL.consents, formula: false }).join() === '6'
    && noLegal.status === 400 && /Add your legal name\./.test(noLegal.out.error) && noLegal.out.gaps[0].step === 1
    && ok.status === 200 && a.verificationStatus === 'submitted' && !!a.submittedAt && !!a.consents.at
    && RULES.CONSENT_KEYS.every((k) => a.consents[k] === true) && a.audit.some((r) => r.act === 'submitted' && r.to === 'submitted'),
    JSON.stringify({ missingMedical: one('medicalDocuments', []), noLegal: noLegal.out }));
}

// ---- F4: what a file may be -----------------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): sniff() made to answer `return true;` first made this read
//   FAIL  F4 a file is what it says it is and nothing more: a type outside the list, a body over the cap, no length and bytes that are not the declared type are each refused; a sixth medical document is refused; a file lands under the applicant's own prefix by a random id and never by its name; a new ID replaces the old one and deletes its file; and the applicant's view carries no storage path
{
  const w = world();
  const wrongType = await up(w, 'ann', 'id', PDF(), 'text/html');
  const tooBig = await up(w, 'ann', 'medical', PDF(), 'application/pdf', { length: RULES.DOC_MAX_BYTES + 1 });
  const photoBig = await up(w, 'ann', 'photo', PNG(), 'image/png', { length: RULES.PHOTO_MAX_BYTES + 1 });
  const photoPdf = await up(w, 'ann', 'photo', PDF(), 'application/pdf');
  const r0 = req('ann', '/api/fund/upload?kind=id', { method: 'POST', bytes: PDF(), type: 'application/pdf' });
  r0.headers.delete('content-length');
  const noLen = await w.api.handleFund(r0, env, r0._url, null);
  const liar = await up(w, 'ann', 'id', PNG(), 'application/pdf');
  const first = await up(w, 'ann', 'id');
  const firstPath = app(w).identityDocument.path;
  const second = await up(w, 'ann', 'id', PNG(), 'image/png');
  for (let i = 0; i < 5; i++) await up(w, 'ann', 'medical');
  const sixth = await up(w, 'ann', 'medical');
  const a = app(w);
  const view = (await call(w, 'ann', '/api/fund/me')).out.application;
  check('F4 a file is what it says it is and nothing more: a type outside the list, a body over the cap, no length and bytes that are not the declared type are each refused; a sixth medical document is refused; a file lands under the applicant\'s own prefix by a random id and never by its name; a new ID replaces the old one and deletes its file; and the applicant\'s view carries no storage path',
    wrongType.status === 415 && tooBig.status === 413 && photoBig.status === 413 && photoPdf.status === 415 && noLen.status === 411 && liar.status === 415
    && first.status === 200 && second.status === 200 && sixth.status === 409 && a.medicalDocuments.length === 5
    && /^fund\/ann\/medical\/[0-9a-f]{24}\.pdf$/.test(a.medicalDocuments[0].path) && /^fund\/ann\/id\/[0-9a-f]{24}\.png$/.test(a.identityDocument.path)
    && !w.files.has(firstPath) && w.files.has(a.identityDocument.path) && w.files.size === 6
    && !/"name"/.test(JSON.stringify(a.medicalDocuments)) && !/fund\//.test(JSON.stringify(view)) && !/"path"/.test(JSON.stringify(view)),
    JSON.stringify({ wrongType: wrongType.status, tooBig: tooBig.status, noLen: noLen.status, liar: liar.status, sixth: sixth.status, files: w.files.size }));
}

// ---- F5: a reviewer opens a file ------------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): the file route's `'cache-control': 'private, no-store'` changed to `'public, max-age=3600'` made this read
//   FAIL  F5 a reviewer opens a file through the Worker alone: the bytes come back with no caching, sandboxed, under a plain name that says only what kind of document it is, the open is written to the history, and an id the application does not hold is a 404
{
  const w = world();
  await readyToSubmit(w);
  await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const id = app(w).medicalDocuments[0].id;
  const got = await call(w, 'eric', `/api/admin/fund/file?uid=ann&doc=${id}`);
  const h = got.res.headers;
  const bytes = new Uint8Array(await got.res.arrayBuffer());
  const missing = await call(w, 'eric', `/api/admin/fund/file?uid=ann&doc=${'b'.repeat(24)}`);
  check('F5 a reviewer opens a file through the Worker alone: the bytes come back with no caching, sandboxed, under a plain name that says only what kind of document it is, the open is written to the history, and an id the application does not hold is a 404',
    got.status === 200 && h.get('cache-control') === 'private, no-store' && /sandbox/.test(h.get('content-security-policy') || '')
    && h.get('x-content-type-options') === 'nosniff' && h.get('content-disposition') === 'inline; filename="medical-document.pdf"'
    && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-' && app(w).audit.some((r) => r.act === 'opened-medical' && r.by === 'eric')
    && missing.status === 404,
    JSON.stringify({ status: got.status, cache: h.get('cache-control'), cd: h.get('content-disposition') }));
}

// ---- F6: nobody verifies themselves ---------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): handleAct's `if ((action === 'verify' || action === 'reverify') && uid === rev.uid) return ...` removed made this read
//   FAIL  F6 nobody verifies their own application: Eric's verify and reverify on his own are refused with 403 and his exact sentence and change nothing, before anything is read; a second reviewer, once listed, can verify it; and the page greys both buttons with the same sentence
{
  const w = world();
  await readyToSubmit(w, 'eric');
  await call(w, 'eric', '/api/fund/submit', { method: 'POST', json: {} });
  const before = JSON.stringify(app(w, 'eric'));
  const self = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'eric', action: 'verify' } });
  w.setDoc('fundApplications/eric', { ...app(w, 'eric'), verificationStatus: 'verified' });
  const selfRe = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'eric', action: 'reverify' } });
  w.setDoc('fundApplications/eric', JSON.parse(before));
  const stillSubmitted = app(w, 'eric').verificationStatus === 'submitted' && !app(w, 'eric').verifiedAt;
  w.api.FUND_REVIEWER_UIDS.push('zoe');
  const other = await call(w, 'zoe', '/api/admin/fund/act', { method: 'POST', json: { uid: 'eric', action: 'verify' } });
  const idx = SRC.indexOf("if ((action === 'verify' || action === 'reverify') && uid === rev.uid)");
  check('F6 nobody verifies their own application: Eric\'s verify and reverify on his own are refused with 403 and his exact sentence and change nothing, before anything is read; a second reviewer, once listed, can verify it; and the page greys both buttons with the same sentence',
    self.status === 403 && self.out.error === 'Your verification must be completed by another authorized reviewer.' && selfRe.status === 403 && stillSubmitted
    && RULES.SELF_VERIFY_REFUSAL === 'Your verification must be completed by another authorized reviewer.'
    && idx > 0 && idx < SRC.indexOf('const out = await mutate(env, `fundApplications/${uid}`', idx)
    && other.status === 200 && app(w, 'eric').verificationStatus === 'verified' && app(w, 'eric').reviewerId === 'zoe'
    && /const blocked = own && \(k === 'verify' \|\| k === 'reverify'\);/.test(ADMINPAGE) && /\$\{blocked \? ' disabled aria-describedby="fq-self"' : ''\}/.test(ADMINPAGE)
    && /const SELF_REFUSAL = 'Your verification must be completed by another authorized reviewer\.';/.test(ADMINPAGE),
    JSON.stringify({ self: self.status, selfRe: selfRe.status, other: other.status }));
}

// ---- F7: the denial says why, to the applicant ---------------------------------
// NEGATIVE CONTROL (run 2026-10-04): the reason length check changed to `reason.length < 0` made this read
//   FAIL  F7 a decline or a request for more information needs a brief internal reason, which goes only into the history; ...
// RE-PINNED 2026-10-04 (v7.24): Eric, "I approve or deny their application (if denied, I give a message
// why). Then their application approval or denial with the reason is sent to their email." The required
// text is now the message the applicant reads; a private reason may ride into the history and never
// reaches them.
// NEGATIVE CONTROL (run 2026-10-04, v7.24): the message length check changed to `message.length < 0` made this read
//   FAIL  F7 a denial or a request for more information needs the message the applicant reads, and a private reason only ever goes into the history: the applicant sees the message while it explains a denial or asks something of them, and never the private reason or the internal note
{
  const w = world();
  await readyToSubmit(w);
  await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const noMsg = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'decline', reason: 'Not a member' } });
  const noMsg2 = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'request_info', message: ' ' } });
  await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'note', note: 'Second letter looks fine.' } });
  const asked = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'request_info', reason: 'ID photo is blurry', message: 'Please add a clearer photo of your ID.' } });
  const sees = (await call(w, 'ann', '/api/fund/me')).out.application;
  await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const after = (await call(w, 'ann', '/api/fund/me')).out.application;
  const denied = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'decline', message: 'We could not confirm membership in the Discord.' } });
  const seesNo = (await call(w, 'ann', '/api/fund/me')).out.application;
  const row = app(w).audit.find((r) => r.act === 'request_info');
  const s = JSON.stringify([sees, seesNo]);
  check('F7 a denial or a request for more information needs the message the applicant reads, and a private reason only ever goes into the history: the applicant sees the message while it explains a denial or asks something of them, and never the private reason or the internal note',
    noMsg.status === 400 && /sent to the applicant/.test(noMsg.out.error) && noMsg2.status === 400 && asked.status === 200 && denied.status === 200
    && row?.reason === 'ID photo is blurry' && row?.msg === 'Please add a clearer photo of your ID.'
    && sees.verificationStatus === 'more_info' && sees.applicantMessage === 'Please add a clearer photo of your ID.' && after.applicantMessage === ''
    && seesNo.verificationStatus === 'not_verified' && seesNo.applicantMessage === 'We could not confirm membership in the Discord.'
    && !/blurry|Second letter|internalReviewerNote|reviewerId|audit|accountEmail/.test(s),
    JSON.stringify({ noMsg: noMsg.status, keys: Object.keys(sees) }));
}

// ---- F8: verifying, and six months ----------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): addMonths' last-day clamp removed (`d.setUTCDate(day);`) made this read
//   FAIL  F8 verifying stamps the date, the reviewer and a reverification six months out (August 31 lands on the last day of February), turns participation on only for someone who asked for distributions, and Mark Inactive turns it off
{
  const w = world();
  await readyToSubmit(w);
  await readyToSubmit(w, 'cy', { participationRequested: false });
  for (const u of ['ann', 'cy']) await call(w, u, '/api/fund/submit', { method: 'POST', json: {} });
  const t0 = Date.now();
  await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'verify' } });
  await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'cy', action: 'verify' } });
  const a = app(w);
  const daysOut = (new Date(a.reverificationDueAt).getTime() - t0) / 86_400_000;
  const inact = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'inactive' } });
  check('F8 verifying stamps the date, the reviewer and a reverification six months out (August 31 lands on the last day of February), turns participation on only for someone who asked for distributions, and Mark Inactive turns it off',
    RULES.addMonths(new Date('2026-08-31T12:00:00Z'), 6).toISOString().slice(0, 10) === '2027-02-28'
    && RULES.addMonths(new Date('2026-10-04T12:00:00Z'), 6).toISOString().slice(0, 10) === '2027-04-04' && RULES.REVERIFY_MONTHS === 6
    && daysOut > 180 && daysOut < 185 && a.reviewerId === 'eric' && !!a.verifiedAt && a.participationActive === true
    && app(w, 'cy').participationActive === false && app(w, 'cy').verificationStatus === 'verified'
    && inact.status === 200 && app(w).verificationStatus === 'inactive' && app(w).participationActive === false,
    JSON.stringify({ daysOut, due: a.reverificationDueAt }));
}

// ---- F9: the history ------------------------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): handleView's viewed row dropped (`const patch = {};`) made this read
//   FAIL  F9 every look and every change is in the history: opening an application writes viewed, and the first look by someone else starts the review; every row is who, what, when and the states, with nothing from a document in it; and the history keeps its newest two hundred
{
  const w = world();
  await readyToSubmit(w);
  await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  await call(w, 'eric', '/api/admin/fund/view?uid=ann');
  const a = app(w);
  const allowed = new Set(['at', 'by', 'act', 'from', 'to', 'reason', 'msg']);
  w.setDoc('fundApplications/ann', { ...a, audit: Array.from({ length: 205 }, (_, i) => ({ at: 'x', by: 'ann', act: `old${i}` })) });
  await call(w, 'eric', '/api/admin/fund/view?uid=ann');
  const capped = app(w).audit;
  check('F9 every look and every change is in the history: opening an application writes viewed, and the first look by someone else starts the review; every row is who, what, when and the states, with nothing from a document in it; and the history keeps its newest two hundred',
    a.verificationStatus === 'under_review' && a.audit.some((r) => r.act === 'viewed' && r.by === 'eric')
    && a.audit.some((r) => r.act === 'review-started' && r.from === 'submitted' && r.to === 'under_review')
    && a.audit.every((r) => Object.keys(r).every((k) => allowed.has(k)))
    && capped.length === 200 && capped[capped.length - 1].act === 'viewed' && capped[0].act === 'old6',
    JSON.stringify(a.audit.map((r) => r.act)));
}

// ---- F10: what leaves the Worker about an application ---------------------------
// NEGATIVE CONTROL (run 2026-10-04): the submit push's body changed to `body: \`From ${out.data.preferredName}\`` made this read
//   FAIL  F10 nothing about an applicant leaves in a notification: ...
// RE-PINNED 2026-10-04 (v7.24): the decision and the reason now go to the applicant by email, as Eric
// asked, and by push when they turned that on. Still nothing else from the application: no legal name,
// no document, no note, no private reason; and the reviewer's push still names no one.
// NEGATIVE CONTROL (run 2026-10-04, v7.24): `The reason: ${msg}` changed to `The reason: ${msg} (${app.legalName})` made this read
//   FAIL  F10 what leaves about an applicant is only what they need: the reviewer's push names no one; the decision email goes to the address they gave with the decision and the reviewer's message and nothing else from the application, approved or denied; a push goes too when they turned notifications on; and the Worker module logs nothing at all
{
  const w = world();
  await readyToSubmit(w);
  await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  w.setDoc('fundApplications/ann', { ...app(w), accountEmail: 'ann@example.test', email: 'ann.alt@example.test' });
  w.setDoc('users/ann', { role: 'client', pushSubs: [{ endpoint: 'https://push.example/x' }] });
  await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'decline', reason: 'Private: letter looked edited', message: 'We could not confirm membership in the Discord.' } });
  const p = w.pushes[0];
  const denyPush = w.pushes[1];
  const e = w.emails[0];
  const w2 = world();
  await readyToSubmit(w2);
  await call(w2, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  w2.setDoc('fundApplications/ann', { ...app(w2), accountEmail: 'ann@example.test' });
  await call(w2, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'verify' } });
  const ok = w2.emails[0];
  const all = JSON.stringify([w.pushes, w.emails, w2.emails]);
  check('F10 what leaves about an applicant is only what they need: the reviewer\'s push names no one; the decision email goes to the address they gave with the decision and the reviewer\'s message and nothing else from the application, approved or denied; a push goes too when they turned notifications on; and the Worker module logs nothing at all',
    p.uid === 'eric' && p.title === 'New fund application' && p.body === 'Open the fund queue to review it.' && p.link === '/admin-fund.html'
    && denyPush?.uid === 'ann' && /not approved/.test(denyPush.body) && !/Discord|membership/.test(denyPush.body)
    && w.emails.length === 1 && e.to === 'ann.alt@example.test' && e.subject === 'Your Community Assistance Fund application was not approved'
    && /The reason: We could not confirm membership in the Discord\./.test(e.html)
    && ok.to === 'ann@example.test' && ok.subject === 'Your Community Assistance Fund application is approved' && /verified participant/.test(ok.html) && /next reverification/.test(ok.html)
    && !/Ann Doe|ann_d|Private: letter|copays|stopped working|medical document|\.pdf/i.test(all)
    && !/console\.|diagLog/.test(SRC),
    all.slice(0, 400));
}

// ---- F11: payment details -------------------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): looksSensitive's Luhn line removed and the 8-digit rule raised to 20 made this read
//   FAIL  F11 payment details live apart and hold only what the method needs: they sit in fundPayments and never on the application, a card number, a routing number or a password is refused with nothing stored, a Zelle phone number is fine, a bank transfer keeps only the name on the account, and someone who wants no distributions has theirs deleted when they submit
// RE-PINNED 2026-10-04 (v7.25): check only (Eric: "payout should be check only"). PayPal, Venmo, Zelle,
// bank and other are refused with one sentence and nothing stored; the guard on the name and the
// address still holds; nothing but the name and the address is kept.
// NEGATIVE CONTROL (run 2026-10-04, v7.25): cleanPayment's `if (raw?.method && raw.method !== 'check') return ...` removed made this read
//   FAIL  F11 payment details live apart and are a check only: they sit in fundPayments and never on the application, PayPal, Venmo, Zelle, a bank transfer and any other method are refused with one sentence and nothing stored, a card number, a routing number, an account number or a password is refused with nothing stored, nothing but the name and the address is kept, and someone who wants no distributions has theirs deleted when they submit
{
  const w = world();
  await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: FULL });
  const stored = w.docs.get('fundPayments/ann')?.data;
  const onApp = JSON.stringify(app(w));
  const others = [];
  for (const m of ['paypal', 'venmo', 'zelle', 'bank', 'other']) others.push(await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { payment: { method: m, handle: '@ann-d', accountName: 'Ann Doe' } } }));
  const addr = FULL.payment.address;
  const bad = [];
  for (const p of [
    { accountName: 'Ann 4111 1111 1111 1111', address: addr },
    { accountName: 'Ann routing 021000021', address: addr },
    { accountName: 'Ann Doe 123456789', address: addr },
    { accountName: 'Ann Doe', address: { ...addr, line2: 'password hunter2' } },
    { accountName: 'Ann Doe', address: { ...addr, line1: '4111 1111 1111 1111' } },
  ]) bad.push(await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { payment: { method: 'check', ...p } } }));
  const after = w.docs.get('fundPayments/ann')?.data;
  const lean = RULES.cleanPayment({ method: 'check', accountName: 'Ann Doe', handle: '@x', otherMethod: 'y', email: 'a@b.test', address: { ...addr, country: 'US' } }).payment;
  const w2 = world();
  await readyToSubmit(w2, 'ann');
  await call(w2, 'ann', '/api/fund/draft', { method: 'POST', json: { participationRequested: false } });
  await call(w2, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  check('F11 payment details live apart and are a check only: they sit in fundPayments and never on the application, PayPal, Venmo, Zelle, a bank transfer and any other method are refused with one sentence and nothing stored, a card number, a routing number, an account number or a password is refused with nothing stored, nothing but the name and the address is kept, and someone who wants no distributions has theirs deleted when they submit',
    stored?.method === 'check' && stored.accountName === 'Ann Doe' && stored.address?.line1 === '12 Pin Oak Dr' && !/Pin Oak|"payment"/.test(onApp)
    && RULES.PAYMENT_METHODS.join() === 'check'
    && others.every((r) => r.status === 400 && r.out.error === RULES.CHECK_ONLY_REFUSAL && r.out.error === 'Distributions are mailed by check only.')
    && bad.every((r) => r.status === 400 && r.out.error === RULES.SENSITIVE_REFUSAL)
    && JSON.stringify(after) === JSON.stringify(stored)
    && Object.keys(lean).sort().join() === 'accountName,address,method' && Object.keys(lean.address).sort().join() === 'city,line1,line2,state,zip'
    && app(w2).verificationStatus === 'submitted' && !w2.docs.has('fundPayments/ann'),
    JSON.stringify({ others: others.map((r) => r.status), bad: bad.map((r) => r.status), lean }));
}

// ---- F12: the GoFundMe photo ----------------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): submitGaps' photo-consent line made unreachable (`if (false) gaps.push(`) made this read
//   FAIL  F12 the GoFundMe photo is optional and needs its own consent: an application with a photo and no public-use consent is not sent, the consent is stamped when given, and removing the photo takes the consent with it
{
  const w = world();
  await readyToSubmit(w);
  await up(w, 'ann', 'photo', PNG(), 'image/png');
  const held = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { photoPublicConsent: true } });
  const stamped = !!app(w).photoConsentAt;
  await call(w, 'ann', '/api/fund/remove', { method: 'POST', json: { kind: 'photo', id: app(w).photo.id } });
  const gone = app(w);
  check('F12 the GoFundMe photo is optional and needs its own consent: an application with a photo and no public-use consent is not sent, the consent is stamped when given, and removing the photo takes the consent with it',
    held.status === 400 && held.out.gaps[0].step === 4 && /GoFundMe/.test(held.out.error) && stamped
    && gone.photo === null && gone.photoPublicConsent === false && gone.photoConsentAt === null && ![...w.files.keys()].some((k) => k.includes('/photo/')),
    JSON.stringify(held.out));
}

// ---- F13: ready for deletion, and nothing deletes on its own ---------------------
// NEGATIVE CONTROL (run 2026-10-04): `audit: a.audit,` added to the minimal record made this read
//   FAIL  F13 the minimal record is ready and unreachable: it deletes every file and the payment details and leaves only who, the status, when verified, by whom, when due and a short note; no route, no cron and no other module calls it
{
  const w = world();
  await readyToSubmit(w);
  await up(w, 'ann', 'photo', PNG(), 'image/png');
  await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { photoPublicConsent: true } });
  await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'verify' } });
  const out = await w.api.minimizeFundApplication(env, 'ann', { note: 'Documents removed at the applicant\'s request.' });
  const left = app(w);
  check('F13 the minimal record is ready and unreachable: it deletes every file and the payment details and leaves only who, the status, when verified, by whom, when due and a short note; no route, no cron and no other module calls it',
    out.ok && out.files === 3 && w.files.size === 0 && !w.docs.has('fundPayments/ann')
    && Object.keys(left).sort().join() === 'minimalNote,minimizedAt,reverificationDueAt,reviewerId,userId,verificationStatus,verifiedAt'
    && left.verificationStatus === 'verified' && left.reviewerId === 'eric'
    && (SRC.match(/minimizeFundApplication/g) || []).length === 1 && !/minimizeFundApplication/.test(W),
    JSON.stringify(Object.keys(left)));
}

// ---- F14: Eric's words, word for word, and none he did not want -----------------
// NEGATIVE CONTROL (run 2026-10-04): "reasonably confirm" changed to "confirm" in the ID redaction text made this read
//   FAIL  F14 Eric's words land word for word: both redaction texts, the five statements, the Discord box, the participation question, the note's label, Submit for Verification and the six step names, with Step X of 6; and the page never says medically approved, names a dollar amount or calls verification a certification
{
  const words = [
    'You may redact information we do not need, including your address, ID number, date of birth, and other unrelated personal information. We primarily need enough information to reasonably confirm that the application belongs to a real person.',
    'You may redact diagnoses, medications, test results, account numbers, dates of birth, and unrelated medical information. We only need enough information to reasonably verify eligibility.',
    'I certify that the information I submitted is accurate to the best of my knowledge.',
    'I understand that submitting this application does not guarantee approval or future distributions.',
    'I understand that verification confirms eligibility only and does not represent a medical opinion or determination of medical severity.',
    'I consent to authorized reviewers viewing the information and documents I submitted for the limited purpose of determining eligibility.',
    'I understand that, if approved and actively participating, I will receive distributions according to the same published distribution formula used for other verified participants.',
    'I am currently a member of the associated Discord community.',
    'Would you like to participate as a recipient of community fund distributions?',
    'Submit for Verification',
  ];
  const missing = words.filter((s) => !PAGE.includes(s));
  const steps = ['Community Information', 'Identity Verification', 'Medical Eligibility', 'Participation', 'Payment Information', 'Certification and Consent'];
  check('F14 Eric\'s words land word for word: both redaction texts, the five statements, the Discord box, the participation question, the note\'s label, Submit for Verification and the six step names, with Step X of 6; and the page never says medically approved, names a dollar amount or calls verification a certification',
    missing.length === 0 && /const NOTE_LABEL = 'Anything you(\u2019|\\u2019)d like the reviewer to know about your documentation\?';/.test(PAGE)
    && steps.every((s) => PAGE.includes(`'${s}'`)) && /Step \$\{step\} of 6/.test(PAGE)
    && !/medically approved/i.test(PAGE + HTML) && !/\$\d/.test(PAGE + HTML) && !/certification(?! and Consent)|certified/i.test(PAGE.replace('Certification and Consent', ''))
    && Object.values({ draft: 'Draft', submitted: 'Submitted', under_review: 'Under Review', more_info: 'More Information Requested', verified: 'Verified', not_verified: 'Not Verified', inactive: 'Inactive' }).every((s) => PAGE.includes(`'${s}'`)),
    JSON.stringify(missing));
}

// ---- F15: the page keeps it private ---------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): the file row's label changed to `${esc(f.name || f.label)}` made this read
//   FAIL  F15 the pages keep it private: the form shows a file by what it is and never by its name or a storage address, the queue opens documents as blobs, no fund page or module carries a word from the blindness list or a dash, and the form asks for no diagnosis
{
  const mods = { 'public/js/fund.js': PAGE, 'public/fund.html': HTML, 'public/css/fund.css': f('public/css/fund.css'), 'public/js/fund-rules.js': f('public/js/fund-rules.js'), 'public/js/admin-fund.js': ADMINPAGE, 'public/admin-fund.html': f('public/admin-fund.html'), 'worker/fund.js': SRC, 'public/js/demo/fund.js': DEMO };
  const blind = Object.entries(mods).filter(([k]) => !/admin|worker/.test(k)).filter(([, s]) => HARD.some((re) => re.test(s))).map(([k]) => k);
  const dashed = Object.entries(mods).filter(([, s]) => DASH.test(s)).map(([k]) => k);
  check('F15 the pages keep it private: the form shows a file by what it is and never by its name or a storage address, the queue opens documents as blobs, no fund page or module carries a word from the blindness list or a dash, and the form asks for no diagnosis',
    /\$\{esc\(f\.label\)\}/.test(PAGE) && !/f\.name|\.path\b|storage\.googleapis|firebasestorage/.test(PAGE)
    && /file\.name\.split\('\.'\)\.pop\(\)/.test(PAGE) && (PAGE.match(/file\.name/g) || []).length === 1
    && /URL\.createObjectURL\(await res\.blob\(\)\)/.test(ADMINPAGE) && !/storage\.googleapis|firebasestorage|\.path\b/.test(ADMINPAGE)
    && blind.length === 0 && dashed.length === 0 && !/data-k="diagnosis"|'diagnosis'/i.test(PAGE) && /You never need to describe a diagnosis\./.test(PAGE),
    JSON.stringify({ blind, dashed }));
}

// ---- F16: the routes, the gate, the lists and the demo --------------------------
// NEGATIVE CONTROL (run 2026-10-04): '/admin-fund' dropped from the audit's ADMIN_PAGES made this read
//   FAIL  F16 the routes, the gate, the lists and the demo: both prefixes reach handleFund and nothing else does, the queue's page and module sit behind the admin gate, the audit names the form, the queue and both modules, the drives measure both pages, and the demo answers with the same rules and refuses his own verification with the same sentence
{
  const gate = (W.match(/const ADMIN_ASSET =\n\s+(\/.*\/);/) || [])[1];
  const RE = gate ? new Function(`return ${gate}`)() : /$^/;
  const AUDIT = f('tools/blindness-audit.mjs');
  const NOSIDE = f('tools/drives/drive-nosideways.mjs');
  const { fundDemo } = await import('../../public/js/demo/fund.js');
  const docs = new Map();
  const store = { docs, files: new Map(), persist: () => {} };
  docs.set('fundApplications/demo-admin', { verificationStatus: 'submitted', preferredName: 'Eric' });
  const self = await fundDemo({ path: '/api/admin/fund/act', q: new URLSearchParams(), body: { uid: 'demo-admin', action: 'verify' }, init: { method: 'POST' }, role: 'admin', store, real: null });
  const asClient = await fundDemo({ path: '/api/admin/fund/list', q: new URLSearchParams(), body: {}, init: {}, role: 'client', store, real: null });
  const selfOut = await self.json();
  check('F16 the routes, the gate, the lists and the demo: both prefixes reach handleFund and nothing else does, the queue\'s page and module sit behind the admin gate, the audit names the form, the queue and both modules, the drives measure both pages, and the demo answers with the same rules and refuses his own verification with the same sentence',
    /if \(url\.pathname\.startsWith\('\/api\/fund\/'\) \|\| url\.pathname\.startsWith\('\/api\/admin\/fund\/'\)\)\n\s+return await handleFund\(request, env, url, ctx\);/.test(W)
    // RE-PINNED 2026-10-04 (v7.24): the cron's notice drain comes from the same module.
    && (W.match(/handleFund\(/g) || []).length === 1 && /import \{ handleFund, drainFundNotices \} from '\.\/fund\.js';/.test(W)
    && RE.test('/admin-fund.html') && RE.test('/admin-fund') && RE.test('/js/admin-fund.js') && !RE.test('/fund.html') && !RE.test('/js/fund.js')
    && /'\/fund',/.test(AUDIT) && /'\/admin-fund',/.test(AUDIT) && /'\/js\/admin-fund\.js',/.test(AUDIT) && /'\/js\/fund-rules\.js'/.test(AUDIT)
    && /'\/fund\.html\?demo=1'/.test(NOSIDE) && /'\/admin-fund\.html\?demo=admin'/.test(NOSIDE)
    && /from '\.\.\/fund-rules\.js';/.test(DEMO) && /from '\.\.\/public\/js\/fund-rules\.js';/.test(SRC)
    && self.status === 403 && selfOut.error === RULES.SELF_VERIFY_REFUSAL && asClient.status === 404 && docs.get('fundApplications/demo-admin').verificationStatus === 'submitted',
    JSON.stringify({ gate: !!gate, self: self.status, asClient: asClient.status }));
}

// ---- F17: the landing is the fund, alone (2026-10-04, v7.23) ------------------
// Eric: "take what's on the landing page and park it as PR 1; hidden from view. So this landing page
// will be simple and in isolation." His card word for word, Apply for Verification into the form,
// the ways to give, the help email and one quiet door for existing clients; nothing that sells.
// NEGATIVE CONTROL (run 2026-10-04): a `<a href="/services.html">Services</a>` added under the card made this read
//   FAIL  F17 the landing is the fund alone: his card word for word with Apply for Verification into the form, the dates said plainly, Zazzle second with its cut explained, the help email and a quiet sign-in for existing clients, and no other door, price, booking or maintenance notice; no dash, no word from the blindness list
{
  const IDX = f('public/index.html');
  const READ = IDX.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const links = [...IDX.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]).sort();
  check('F17 the landing is the fund alone: his card word for word with Apply for Verification into the form, the dates said plainly, Zazzle second with its cut explained, the help email and a quiet sign-in for existing clients, and no other door, price, booking or maintenance notice; no dash, no word from the blindness list',
    /<title>Community Assistance Fund<\/title>/.test(IDX) && /<h1>Community Assistance Fund<\/h1>/.test(IDX)
    && READ.includes('Members of our community experiencing significant illness or disability may apply to become verified participants in our community assistance fund. Verification exists to protect members and donors while requiring as little sensitive information as possible.')
    && /<a class="fund-btn fl-apply" href="\/fund\.html">Apply for Verification<\/a>/.test(IDX)
    // RE-PINNED 2026-10-04 (v7.25): Eric, "Fundraiser runs through Christmas Eve with monthly payout
    // distributions. With first payout November 1."
    && READ.includes('The fundraiser runs from now through Christmas Eve, December 24, 2026.')
    // RE-PINNED 2026-10-04 (v7.26): Eric, "Verified applicants will receive monthly payouts via Mercury Business Check on January 1st, 2027. Not monthly."
    // RE-PINNED 2026-10-04 (v7.27): his sentence word for word, "January 1st, 2027".
    && READ.includes('Verified applicants will receive payouts via Mercury Business Check on January 1st, 2027.') && !READ.includes('November') && !/each month|monthly/i.test(READ)
    // RE-PINNED 2026-10-04 (v7.26): Zazzle's cut and the help line in the words of Eric's post ("I receive
    // only a creator royalty/commission", "If you have questions or want to request a Zazzle design,
    // email me ... I'll respond within three business days.").
    && READ.includes('The full purchase price of an item does not go to the fund: Zazzle charges for producing and selling the products, and only the creator royalty is donated. If your goal is simply to maximize how much reaches recipients, donating directly through GoFundMe is better.')
    && /Questions, or want to request a Zazzle design\? Email <a href="mailto:office@pocketadvocacy\.com">office@pocketadvocacy\.com<\/a>\. You’ll get a reply within three business days\./.test(IDX)
    // RE-PINNED 2026-10-04 (v7.25): Book is parked, so the client's sign-in lands on their case.
    && /<a href="\/signin\.html\?to=%2Fcase\.html">Existing clients: sign in<\/a>/.test(IDX)
    // RE-PINNED 2026-10-04 (v7.24): Eric, "They should also be linked to the discord", so the Discord
    // invite is the one door added.
    // RE-PINNED 2026-10-04 (v7.26): the help email is also the address for a check that has not come.
    && links.join() === ['/fund.html', '/signin.html?to=%2Fcase.html', 'https://discord.gg/YZXYQFjUGa', 'https://www.zazzle.com/store/rooftop_and_reed', 'mailto:office@pocketadvocacy.com', 'mailto:office@pocketadvocacy.com'].sort().join()
    && READ.includes('Applicants must be members of our Discord community.')
    && !/\$\d|maintenance\.js|book\.html|services\.html|fit\.html|nav class="tabs"/.test(IDX) && /src="\/js\/fund-landing\.js"/.test(IDX)
    && !DASH.test(IDX) && !HARD.some((re) => re.test(IDX)) && !HARD.some((re) => re.test(f('public/js/fund-landing.js'))) && !DASH.test(f('public/js/fund-landing.js')),
    JSON.stringify(links));
}

// ---- F18: the ways to give, on the clock (2026-10-04, v7.23) ---------------------
// Eric: "Make sure it's explicit that the fundraiser will go from the moment it's live to November 2."
// And the GoFundMe button: hidden until he sends the link. RUN at fixed instants either side of the
// end of November 2 in Mountain time, against a fake page, with the link empty and with one set.
// NEGATIVE CONTROL (run 2026-10-04): FUNDRAISER_ENDS_AT moved to `Date.UTC(2026, 10, 3, 0, 0, 0)` (midnight UTC, the evening of Nov 2 in Mountain time) made this read
//   FAIL  F18 the ways to give follow the clock: at 11:59 pm Mountain on November 2 the block is untouched and no GoFundMe button is drawn while the link is empty; at midnight it reads This fundraiser ended November 2 and nothing else; with a link set, the button is drawn as the recommended way; Apply sits outside the block, so applying stays open
// RE-PINNED 2026-10-04 (v7.25): Eric, "Fundraiser runs through Christmas Eve". The end is midnight
// Mountain going into December 25, 07:00 UTC (standard time by then).
// NEGATIVE CONTROL (run 2026-10-04, v7.25): FUNDRAISER_ENDS_AT moved to `Date.UTC(2026, 11, 25, 0, 0, 0)` (midnight UTC, the evening of Dec 24 in Mountain time) made this read
//   FAIL  F18 the ways to give follow the clock: at 11:59 pm Mountain on Christmas Eve the block is untouched and no GoFundMe button is drawn while the link is empty; at midnight it reads This fundraiser ended December 24 and nothing else; with a link set, the button is drawn as the recommended way; Apply sits outside the block, so applying stays open
{
  const FL = f('public/js/fund-landing.js');
  const load = (url) => new Function(`${FL.replace(/^export /gm, '').replace(/const GOFUNDME_URL = '[^']*';/, `const GOFUNDME_URL = ${JSON.stringify(url)};`).replace(/if \(typeof document !== 'undefined'\) paintSupport\(document\);/, '')}\nreturn { paintSupport, FUNDRAISER_ENDS_AT, ENDED_LINE };`)();
  const page = () => {
    const slot = { innerHTML: '', hidden: true };
    const box = { innerHTML: 'ORIGINAL', querySelector: (q) => (q === '[data-gofundme]' ? slot : null) };
    return { root: { querySelector: (q) => (q === '[data-support]' ? box : null) }, box, slot };
  };
  const noLink = load('');
  const before = page();
  const beforeState = noLink.paintSupport(before.root, Date.parse('2026-12-25T06:59:59Z'));
  const after = page();
  const afterState = noLink.paintSupport(after.root, Date.parse('2026-12-25T07:00:00Z'));
  const withLink = load('https://www.gofundme.com/f/example');
  const linked = page();
  const linkedState = withLink.paintSupport(linked.root, Date.parse('2026-10-10T18:00:00Z'));
  const real = page();
  const realState = load('https://gofund.me/7f301549b').paintSupport(real.root, Date.parse('2026-10-10T18:00:00Z'));
  const IDX = f('public/index.html');
  const support = IDX.slice(IDX.indexOf('data-support'), IDX.indexOf('</section>', IDX.indexOf('data-support')));
  check('F18 the ways to give follow the clock: at 11:59 pm Mountain on Christmas Eve the block is untouched and no GoFundMe button is drawn while the link is empty; at midnight it reads This fundraiser ended December 24 and nothing else; with a link set, the button is drawn as the recommended way; Apply sits outside the block, so applying stays open',
    // RE-PINNED 2026-10-04 (v7.26): Eric sent the GoFundMe link with his post, so it is set; the runs
    // above still inject an empty link and a made-up one, and the real one draws its button too.
    /export const GOFUNDME_URL = 'https:\/\/gofund\.me\/7f301549b';/.test(FL) && realState === 'open' && /href="https:\/\/gofund\.me\/7f301549b"/.test(real.slot.innerHTML) && /export const ZAZZLE_URL = 'https:\/\/www\.zazzle\.com\/store\/rooftop_and_reed';/.test(FL)
    && noLink.FUNDRAISER_ENDS_AT === Date.parse('2026-12-25T07:00:00Z')
    && beforeState === 'open-no-link' && before.box.innerHTML === 'ORIGINAL' && before.slot.hidden === true && before.slot.innerHTML === ''
    && afterState === 'ended' && after.box.innerHTML === '<h2>Support the fund</h2><p>This fundraiser ended December 24.</p>'
    && linkedState === 'open' && linked.slot.hidden === false && /href="https:\/\/www\.gofundme\.com\/f\/example"/.test(linked.slot.innerHTML) && /Give on GoFundMe/.test(linked.slot.innerHTML) && /Recommended/.test(linked.slot.innerHTML)
    && /<p class="fl-give-row" data-gofundme hidden><\/p>/.test(support) && !/fund\.html/.test(support),
    JSON.stringify({ beforeState, afterState, linkedState }));
}

// ---- F19: PR 1, parked (2026-10-04, v7.23) ---------------------------------------
// The landing as it stood, word for word, behind the admin gate: not indexed, without the redirect
// that would send its only reader away, linked from the Clients page, and named in the audit's
// gated pages and in the sideways drive.
// NEGATIVE CONTROL (run 2026-10-04): the admin-device redirect pasted back into admin-pr1.html made this read
//   FAIL  F19 PR 1 is the old landing, parked: word for word but for its name, the noindex and the redirect it no longer has; behind the admin gate; linked from the Clients page; named in the audit's gated pages and measured by the sideways drive
// RE-PINNED 2026-10-04 (v7.25): Eric, "I want everything but information about the fundraiser and
// applicants HIDDEN in a parked PR 1". admin-pr1.html is the hub now and the old landing moved to
// admin-pr1-landing.html; the door to PR 1 is a tab in the nav, so the Clients page button is gone.
// NEGATIVE CONTROL (run 2026-10-04, v7.25): the Book door taken out of the hub made this read
//   FAIL  F19 PR 1 is the hub and the old landing sits inside it: the hub lists every parked page and the advocacy app, noindex, on the admin sheet; the old landing is word for word at its new path but for its name, the noindex and the redirect it no longer has; both behind the admin gate; both named in the audit's gated pages and measured by the sideways drive
{
  const PR1 = f('public/admin-pr1.html');
  const LAND = f('public/admin-pr1-landing.html');
  const gate = (W.match(/const ADMIN_ASSET =\n\s+(\/.*\/);/) || [])[1];
  const RE = gate ? new Function(`return ${gate}`)() : /$^/;
  const doors = [...PR1.matchAll(/<li><a class="btn" href="([^"]+)">/g)].map((m) => m[1]);
  const want = ['/admin.html', '/admin-calendar.html', '/admin-chats.html', '/admin-availability.html', '/admin-dictionary.html',
    '/admin-pr1-landing.html', '/services.html', '/about.html', '/advocate.html', '/book.html', '/fit.html', '/faq.html', '/reviews.html', '/stats.html', '/contact.html', '/subscribe.html'];
  check('F19 PR 1 is the hub and the old landing sits inside it: the hub lists every parked page and the advocacy app, noindex, on the admin sheet; the old landing is word for word at its new path but for its name, the noindex and the redirect it no longer has; both behind the admin gate; both named in the audit\'s gated pages and measured by the sideways drive',
    /<title>PR 1 · Pocket Advocate<\/title>/.test(PR1) && /<meta name="robots" content="noindex">/.test(PR1) && /admin\.css\?v=stat130/.test(PR1)
    && PR1.includes('Parked. Everything that is not the fund. Nothing was deleted.') && want.every((d) => doors.includes(d)) && doors.length === want.length
    && /<a href="\/admin-pr1\.html" class="active">PR 1<\/a>/.test(PR1) && !DASH.test(PR1)
    && /<title>Old landing · PR 1 · Pocket Advocate<\/title>/.test(LAND) && /<meta name="robots" content="noindex">/.test(LAND) && !/pa-admin-device|location\.replace/.test(LAND)
    && /<h2>Ready when you are\.<\/h2>/.test(LAND) && /src="\/js\/maintenance\.js"/.test(LAND) && /class="land-sec hero"/.test(LAND)
    && ['/admin-pr1.html', '/admin-pr1', '/admin-pr1-landing.html', '/admin-pr1-landing'].every((p) => RE.test(p))
    && !/admin-pr1\.html|admin-fund\.html/.test(f('public/js/admin.js'))
    && /'\/admin-pr1',/.test(f('tools/blindness-audit.mjs')) && /'\/admin-pr1-landing',/.test(f('tools/blindness-audit.mjs'))
    && /'\/admin-pr1\.html\?demo=admin'/.test(f('tools/drives/drive-nosideways.mjs')) && /'\/admin-pr1-landing\.html\?demo=admin'/.test(f('tools/drives/drive-nosideways.mjs')),
    JSON.stringify({ doors: doors.length, land: LAND.length }));
}

// ---- F20: why they are in need (2026-10-04, v7.24) ----------------------------
// Eric: "The verification process requires a short blurb from them for why they are in need. Max 1500
// characters." Required to send, capped by the Worker whatever the page allows, read by the reviewer,
// and never a place a diagnosis is asked for.
// NEGATIVE CONTROL (run 2026-10-04): the cap changed to `needStatement: 20000,` in TEXT_LIMITS made this read
//   FAIL  F20 the reason they are in need is required, kept to 1500 characters by the Worker, and read by the reviewer: an application without it is held at Step 3 with its sentence, a longer one is cut at 1500, and the page asks for it in their own words with a counter and no diagnosis
{
  const w = world();
  await readyToSubmit(w, 'ann', { needStatement: '' });
  const held = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { needStatement: 'x'.repeat(1700) } });
  const capped = app(w).needStatement.length;
  await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { needStatement: 'Rent and copays.' } });
  const sent = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const rv = (await call(w, 'eric', '/api/admin/fund/view?uid=ann')).out.application;
  check('F20 the reason they are in need is required, kept to 1500 characters by the Worker, and read by the reviewer: an application without it is held at Step 3 with its sentence, a longer one is cut at 1500, and the page asks for it in their own words with a counter and no diagnosis',
    held.status === 400 && held.out.gaps[0].step === 3 && held.out.error === 'Tell us briefly why you are in need.'
    && capped === 1500 && RULES.NEED_MAX === 1500 && sent.status === 200 && rv.needStatement === 'Rent and copays.'
    && /field\('needStatement', 'In a few sentences, why are you in need\?', \{ area: true, max: NEED_MAX, hint: 'In your own words\. You never need to name a diagnosis\.' \}\)/.test(PAGE)
    && /data-count="\$\{key\}"/.test(PAGE) && /Tell us briefly why you are in need\./.test(PAGE) && /Why they are in need/.test(ADMINPAGE),
    JSON.stringify({ held: held.out, capped }));
}

// ---- F21: a check in the mail (2026-10-04, v7.24) -------------------------------
// Eric: "They may also opt for check in the mail. If so, it creates a field for their address." And: "No
// tracking number. Payout via check will come from Mercury banking and take 7-10 business days to arrive."
// NEGATIVE CONTROL (run 2026-10-04): `if (method === 'check') {` widened to `if (method === 'check' || true) {` in cleanPayment made this read
//   FAIL  F21 a check in the mail keeps the name and the mailing address and nothing it does not need: the state is two capital letters, a ZIP+4 and a street called Pin Oak are fine, a card number in the address is refused, a missing ZIP is asked for, every other method keeps no address, and the page says checks come from Mercury in 7 to 10 business days with no tracking number
// RE-PINNED 2026-10-04 (v7.25): check only, so there is no method to choose and no other method keeps
// anything; the page asks for the check's name and address straight away.
// NEGATIVE CONTROL (run 2026-10-04, v7.25): `out.address.state = out.address.state.toUpperCase();` removed from cleanPayment made this read
//   FAIL  F21 a check in the mail keeps the name and the mailing address and nothing it does not need: the state is two capital letters, a ZIP+4 and a street called Pin Oak are fine, a card number in the address is refused, a missing ZIP is asked for, every other method is refused, and the page asks for the check straight away, mailed on the 1st of each month from November 1, from Mercury in 7 to 10 business days with no tracking number
{
  const good = RULES.cleanPayment({ method: 'check', accountName: 'Ann Doe', handle: '@x', address: { line1: '12 Pin Oak Dr', line2: 'Apt 4', city: 'Boise', state: 'id', zip: '83702-1234' } });
  const noZip = RULES.paymentGap(RULES.cleanPayment({ method: 'check', accountName: 'Ann Doe', address: { line1: '12 Pin Oak Dr', city: 'Boise', state: 'ID', zip: '' } }).payment);
  const card = RULES.cleanPayment({ method: 'check', accountName: 'Ann Doe', address: { line1: '4111 1111 1111 1111', city: 'Boise', state: 'ID', zip: '83702' } });
  const venmo = RULES.cleanPayment({ method: 'venmo', handle: '@ann-d', address: { line1: '12 Pin Oak Dr' } });
  const unsaid = RULES.cleanPayment({ accountName: 'Ann Doe', address: { line1: '12 Pin Oak Dr', city: 'Boise', state: 'ID', zip: '83702' } });
  const w = world();
  await readyToSubmit(w, 'ann', { payment: { method: 'check', accountName: 'Ann Doe', address: { line1: '12 Pin Oak Dr', city: 'Boise', state: 'ID', zip: '83702' } } });
  const sent = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const mine = sent.out.application.payment;
  check('F21 a check in the mail keeps the name and the mailing address and nothing it does not need: the state is two capital letters, a ZIP+4 and a street called Pin Oak are fine, a card number in the address is refused, a missing ZIP is asked for, every other method is refused, and the page asks for the check straight away, mailed on the 1st of each month from November 1, from Mercury in 7 to 10 business days with no tracking number',
    good.payment?.address?.state === 'ID' && good.payment.address.zip === '83702-1234' && good.payment.address.line1 === '12 Pin Oak Dr' && !('handle' in good.payment) && RULES.paymentGap(good.payment) === ''
    && noZip === 'Add the five-digit ZIP code.' && card.error === RULES.SENSITIVE_REFUSAL && venmo.error === RULES.CHECK_ONLY_REFUSAL && !venmo.payment
    && unsaid.payment?.method === 'check'
    && sent.status === 200 && mine.method === 'check' && mine.address.city === 'Boise'
    && RULES.CHECK_NOTE === 'Checks are sent from Mercury and take 7 to 10 business days to arrive.'
    // RE-PINNED 2026-10-04 (v7.26): Eric, "Verified applicants will receive monthly payouts via Mercury Business Check on January 1st, 2027. Not monthly."
    // RE-PINNED 2026-10-04 (v7.27): his sentence word for word, "January 1st, 2027".
    && PAGE.includes('Verified applicants will receive payouts via Mercury Business Check on January 1st, 2027. Where should yours go?')
    && /Name to make the check out to/.test(PAGE) && !/name="method"|Check in the mail|PayPal|Venmo|Zelle/.test(PAGE)
    && /esc\(CHECK_NOTE\)/.test(PAGE) && !/tracking/i.test(PAGE + SRC + ADMINPAGE),
    JSON.stringify({ good, noZip, venmo }));
}

// ---- F22: the weekly pool and each share (2026-10-04, v7.24) ---------------------
// Eric: "I will update the amount in the donation pool weekly so each participant can see their active
// share." And: "I will not be included in the payout. I only organize." The share is equal among the
// verified who are taking part, reviewers never among them; each participant hears about it, by push if
// they turned that on and otherwise by email, a few at a time from the cron.
// NEGATIVE CONTROL (run 2026-10-04): isActiveParticipant's `&& !reviewerUids.includes(uid)` removed made this read
//   FAIL  F22 the weekly pool is shared equally by the verified who are taking part and never by a reviewer: the share is in whole cents, a participant sees the total and their share and someone not taking part does not, only a reviewer can post it, a bad total is refused, and the cron tells each participant once, by push or else by email
// RE-PINNED 2026-10-04 (v7.25): Eric, "monthly payout distributions. With first payout November 1."
// The notice says this month's pool and when the checks go out.
// NEGATIVE CONTROL (run 2026-10-04, v7.25): `next ? `Checks are mailed on ${payoutWords(next)}.` : ''` changed to `''` in drainFundNotices made this read
//   FAIL  F22 the monthly pool is shared equally by the verified who are taking part and never by a reviewer: the share is in whole cents, a participant sees the total and their share and someone not taking part does not, only a reviewer can post it, a bad total is refused, and the cron tells each participant once, by push or else by email, with the date the checks are mailed
// RE-PINNED 2026-10-04 (v7.26): Eric, "Every Friday, I'll post in Discord: Number of approved recipients,
// Net GoFundMe proceeds so far, Zazzle creator earnings being added, Combined total in the fund." He
// enters the two totals so far; their sum is the fund, and each participant's share of it is the running
// total of their payout.
// NEGATIVE CONTROL (run 2026-10-04, v7.26): `const totalCents = gofundmeCents + zazzleCents;` changed to `const totalCents = gofundmeCents;` in handlePoolSet made this read
//   FAIL  F22 the fund's totals are shared equally by the verified who are taking part and never by a reviewer: the GoFundMe and Zazzle totals add up to the combined total, the share is in whole cents, a participant sees all three, the count and their share so far and someone not taking part does not, only a reviewer can post them, a bad or missing amount is refused, and the cron tells each participant once, by push or else by email, with every figure and the date the checks are mailed
{
  const w = world();
  const verified = (uid, extra = {}) => w.setDoc(`fundApplications/${uid}`, { userId: uid, verificationStatus: 'verified', participationRequested: true, participationActive: true, preferredName: uid, accountEmail: `${uid}@example.test`, audit: [], ...extra });
  verified('ann'); verified('bob'); verified('cy', { participationRequested: false, participationActive: false }); verified('eric');
  w.setDoc('users/ann', { role: 'client', pushSubs: [{ endpoint: 'https://push.example/a' }] });
  const asAnn = await call(w, 'ann', '/api/admin/fund/pool', { method: 'POST', json: { gofundmeCents: 100, zazzleCents: 0 } });
  const bad = await call(w, 'eric', '/api/admin/fund/pool', { method: 'POST', json: { gofundmeCents: -5, zazzleCents: 0 } });
  const missing = await call(w, 'eric', '/api/admin/fund/pool', { method: 'POST', json: { gofundmeCents: 100 } });
  const oldShape = await call(w, 'eric', '/api/admin/fund/pool', { method: 'POST', json: { totalCents: 100 } });
  const posted = await call(w, 'eric', '/api/admin/fund/pool', { method: 'POST', json: { gofundmeCents: 97551, zazzleCents: 2450 } });
  const poolDoc = w.docs.get('fundPool/current').data;
  const annSees = (await call(w, 'ann', '/api/fund/me')).out.application.pool;
  const cySees = (await call(w, 'cy', '/api/fund/me')).out.application.pool;
  const told = await w.api.drainFundNotices(env);
  const again = await w.api.drainFundNotices(env);
  const annPush = w.pushes.find((x) => x.uid === 'ann');
  const bobMail = w.emails.find((x) => x.to === 'bob@example.test');
  const nextLine = RULES.nextPayout() ? `Payout date: ${RULES.payoutWords(RULES.nextPayout())}.` : ''; // RE-PINNED 2026-10-04 (v7.26): Eric, "Verified applicants will receive monthly payouts via Mercury Business Check on January 1st, 2027. Not monthly."
  check('F22 the fund\'s totals are shared equally by the verified who are taking part and never by a reviewer: the GoFundMe and Zazzle totals add up to the combined total, the share is in whole cents, a participant sees all three, the count and their share so far and someone not taking part does not, only a reviewer can post them, a bad or missing amount is refused, and the cron tells each participant once, by push or else by email, with every figure and the date the checks are mailed',
    asAnn.status === 404 && bad.status === 400 && missing.status === 400 && oldShape.status === 400 && posted.status === 200
    && poolDoc.gofundmeCents === 97551 && poolDoc.zazzleCents === 2450
    && poolDoc.activeCount === 2 && poolDoc.shareCents === 50000 && poolDoc.totalCents === 100001 && poolDoc.history.length === 1
    && posted.out.pool.gofundmeCents === 97551 && posted.out.pool.zazzleCents === 2450 && posted.out.pool.totalCents === 100001
    && annSees?.gofundmeCents === 97551 && annSees.zazzleCents === 2450 && annSees.activeCount === 2
    && posted.out.participants.map((r) => r.uid).sort().join() === 'ann,bob'
    && annSees?.totalCents === 100001 && annSees.shareCents === 50000 && cySees === undefined
    && told === 2 && again === 0 && w.docs.get('fundPool/current').data.pending.length === 0
    && annPush?.body === 'The fund is at $1,000.01. Your share so far is $500.00.' && !w.emails.some((x) => x.to === 'ann@example.test')
    && ['Net GoFundMe proceeds so far: $975.51', 'Zazzle creator earnings being added: $24.50', 'Combined total in the fund: $1,000.01', 'Approved recipients: 2', 'Your share so far: $500.00']
      .every((l) => (bobMail?.html || '').includes(l)) && (bobMail?.html || '').includes(nextLine) && !!nextLine
    && bobMail?.subject === 'Community Assistance Fund update: $1,000.01 so far'
    && /You will get another note when your check is in the mail\./.test(bobMail?.html || '')
    && !w.pushes.some((x) => x.uid === 'eric' || x.uid === 'cy'),
    JSON.stringify({ pool: { n: poolDoc.activeCount, share: poolDoc.shareCents }, told, again }));
}

// ---- F23: money marked sent (2026-10-04, v7.24) ----------------------------------
// Eric: they are told "any marks that they've been sent their money with an ID #", and checks come from
// Mercury in 7 to 10 business days. Only a verified participant who is taking part can be paid, never a
// reviewer, and never without the ID number.
// NEGATIVE CONTROL (run 2026-10-04): handlePayout's `if (ref.length < 2) return ...` removed made this read
//   FAIL  F23 money is marked sent with its ID number and the participant is told: the payout is on their status with the amount, the method and the ID and never who marked it, it is in the history, a check says Mercury and 7 to 10 business days, and a reviewer, someone not taking part or a mark with no ID is refused
// RE-PINNED 2026-10-04 (v7.25): check only, so every payout is a check with its check number, and
// someone without a mailing address on file (an old Venmo record) cannot be marked paid.
// NEGATIVE CONTROL (run 2026-10-04, v7.25): handlePayout's `if (pay?.method !== 'check') return ...` removed made this read
//   FAIL  F23 a check is marked mailed with its check number and the participant is told: the payout is on their status with the amount and the check number and never who marked it, it is in the history, the notice says Mercury and 7 to 10 business days, and a reviewer, someone not taking part, someone with no mailing address or a mark with no check number is refused
{
  const w = world();
  const verified = (uid, extra = {}) => w.setDoc(`fundApplications/${uid}`, { userId: uid, verificationStatus: 'verified', participationRequested: true, participationActive: true, accountEmail: `${uid}@example.test`, audit: [], ...extra });
  verified('ann'); verified('bob'); verified('cy', { participationActive: false }); verified('eric'); verified('dee');
  w.setDoc('fundPayments/ann', { method: 'check', accountName: 'Ann Doe', address: { line1: '12 Pin Oak Dr', line2: '', city: 'Boise', state: 'ID', zip: '83702' } });
  w.setDoc('fundPayments/dee', { method: 'venmo', handle: '@dee' });
  w.setDoc('fundPayments/bob', { method: 'check', accountName: 'Bob B', address: { line1: '1 Main St', line2: '', city: 'Boise', state: 'ID', zip: '83702' } });
  w.setDoc('users/ann', { role: 'client', pushSubs: [{ endpoint: 'https://push.example/a' }] });
  const paid = await call(w, 'eric', '/api/admin/fund/payout', { method: 'POST', json: { uid: 'ann', amountCents: 50000, ref: '1042' } });
  const checkPaid = await call(w, 'eric', '/api/admin/fund/payout', { method: 'POST', json: { uid: 'bob', amountCents: 50000, ref: '2001' } });
  const refused = await Promise.all([
    call(w, 'eric', '/api/admin/fund/payout', { method: 'POST', json: { uid: 'eric', amountCents: 100, ref: 'X1' } }),
    call(w, 'eric', '/api/admin/fund/payout', { method: 'POST', json: { uid: 'cy', amountCents: 100, ref: 'X1' } }),
    call(w, 'eric', '/api/admin/fund/payout', { method: 'POST', json: { uid: 'ann', amountCents: 100, ref: '' } }),
    call(w, 'ann', '/api/admin/fund/payout', { method: 'POST', json: { uid: 'ann', amountCents: 100, ref: 'X1' } }),
    call(w, 'eric', '/api/admin/fund/payout', { method: 'POST', json: { uid: 'dee', amountCents: 100, ref: 'X1' } }),
  ]);
  const annSees = (await call(w, 'ann', '/api/fund/me')).out.application.payouts;
  const bobMail = w.emails.find((x) => x.to === 'bob@example.test');
  check('F23 a check is marked mailed with its check number and the participant is told: the payout is on their status with the amount and the check number and never who marked it, it is in the history, the notice says Mercury and 7 to 10 business days, and a reviewer, someone not taking part, someone with no mailing address or a mark with no check number is refused',
    paid.status === 200 && checkPaid.status === 200 && refused.map((r) => r.status).join() === '403,409,400,404,409'
    && refused[4].out.error === 'There is no mailing address on file for them yet.' && refused[2].out.error === 'Add the check number.'
    && annSees.length === 1 && annSees[0].amountCents === 50000 && annSees[0].method === 'check' && annSees[0].ref === '1042' && !('by' in annSees[0])
    && app(w).audit.some((r) => r.act === 'payout-sent' && r.msg === '$500.00 check mailed, Check #1042')
    && w.pushes.some((x) => x.uid === 'ann' && x.body === 'Your $500.00 check was mailed. Check #1042. Allow 7 to 10 business days.')
    && bobMail?.subject === 'Your Community Assistance Fund check is in the mail' && /Checks are sent from Mercury and take 7 to 10 business days to arrive\./.test(bobMail.html) && /Check #2001/.test(bobMail.html) && !/ID #/.test(bobMail.html),
    JSON.stringify({ refused: refused.map((r) => r.status), annSees }));
}

// ---- F24: the cron tells them, and spends nothing (2026-10-04, v7.24) -------------
// The week's notices ride the per-minute firing, a few at a time, each claimed under the document's update
// time before anyone is told, so two firings never tell anyone twice. No model anywhere in it.
// NEGATIVE CONTROL (run 2026-10-04): the claim's `ifUpdateTime: doc.updateTime` dropped made this read
//   FAIL  F24 the cron drains the week's notices a few at a time and claims each batch before telling anyone, and nothing in it calls a paid model
{
  const cron = (W.match(/async scheduled\(event, env, ctx\) \{[\s\S]*?\n  \},\n/) || [''])[0];
  const drain = (SRC.match(/export async function drainFundNotices\(env\) \{[\s\S]*?\n\}\n/) || [''])[0];
  check('F24 the cron drains the week\'s notices a few at a time and claims each batch before telling anyone, and nothing in it calls a paid model',
    /\n    ctx\.waitUntil\(drainFundNotices\(env\)\.catch\(\(\) => 0\)\);\n/.test(cron)
    && /const NOTICES_PER_RUN = [1-9];/.test(SRC) && /\{ mask: \['pending'\], ifUpdateTime: doc\.updateTime \}/.test(drain)
    && drain.indexOf('ifUpdateTime') < drain.indexOf('fundNotify(') && !/runAnalysis|runQuestion|client\(env\)|messages\.create|ANTHROPIC/.test(SRC),
    `${drain.length} chars`);
}

// ---- F25: the Discord, the Home Screen and the queue's new tools (2026-10-04, v7.24) ----
// Eric: "They should also be linked to the discord" and "They must be a discord member"; "There should
// still be instructions for how to add to Home Screen, and they will receive notifications".
// NEGATIVE CONTROL (run 2026-10-04): the Android line taken out of the notification card made this read
//   FAIL  F25 the pages carry the rest: the Discord invite beside the member box, the Home Screen steps for iPhone and Android with the button that turns notifications on and the email fallback said plainly, the share and what was sent on the status page, and the queue's pool total and Mark sent with a required ID
// RE-PINNED 2026-10-04 (v7.25): monthly and check only; the payout reads "Check #" where it read "ID #".
// NEGATIVE CONTROL (run 2026-10-04, v7.25): the status page's `${nextLine}` taken out of the share card made this read
//   FAIL  F25 the pages carry the rest: the Discord invite beside the member box, the Home Screen steps for iPhone and Android with the button that turns notifications on and the email fallback said plainly, this month's share, the next check date and each check mailed with its number on the status page, and the queue's monthly pool total and Mark mailed with a required check number
// RE-PINNED 2026-10-04 (v7.26): the status card is "The fund so far" with the three totals, the count and
// their share so far; the queue takes the GoFundMe and Zazzle totals.
// NEGATIVE CONTROL (run 2026-10-04, v7.26): the status card's Zazzle row taken out made this read
//   FAIL  F25 the pages carry the rest: the Discord invite beside the member box, the Home Screen steps for iPhone and Android with the button that turns notifications on and the email fallback said plainly, the fund so far with their share so far, the next check date and each check mailed with its number on the status page, and the queue's two totals and Mark mailed with a required check number
{
  check('F25 the pages carry the rest: the Discord invite beside the member box, the Home Screen steps for iPhone and Android with the button that turns notifications on and the email fallback said plainly, the fund so far with their share so far, the next check date and each check mailed with its number on the status page, and the queue\'s two totals and Mark mailed with a required check number',
    RULES.DISCORD_INVITE === 'https://discord.gg/YZXYQFjUGa' && /Not a member yet\? <a href="\$\{DISCORD_INVITE\}" target="_blank" rel="noopener">Join the Discord<\/a>/.test(PAGE)
    && /<strong>iPhone:<\/strong> open this page in Safari/.test(PAGE) && /<strong>Android:<\/strong> open this page in Chrome/.test(PAGE)
    && /import \{ enablePush, pushSupported, pushInstalled \} from '\.\/push\.js';/.test(PAGE) && /the fund's totals and your share so far each Friday, and a note when your check is mailed, with its check number/.test(PAGE) && /Without notifications, the same updates come to your email\./.test(PAGE)
    && /<dt>Your share so far<\/dt><dd>\$\{dollars\(pl\.shareCents\)\}<\/dd>/.test(PAGE) && /<dt>Net GoFundMe proceeds so far<\/dt>/.test(PAGE)
    && /<dt>Zazzle creator earnings being added<\/dt>/.test(PAGE) && /<dt>Combined total in the fund<\/dt>/.test(PAGE) && /<dt>Approved recipients<\/dt>/.test(PAGE)
    && /\$\{nextLine\}/.test(PAGE) && /<h2>The fund so far<\/h2>/.test(PAGE) && !/This week|This month/.test(PAGE)
    && /<dt>Payout date<\/dt><dd>\$\{esc\(payoutWords\(next\)\)\}<\/dd>/.test(PAGE) && /check mailed \$\{dateWords\(x\.at\)\}/.test(PAGE) && /Check #\$\{esc\(x\.ref\)\}/.test(PAGE) && !/ID #/.test(PAGE)
    && /'\/api\/admin\/fund\/pool', \{ method: 'POST', body: \{ gofundmeCents: g, zazzleCents: z \} \}/.test(ADMINPAGE)
    && /'\/api\/admin\/fund\/payout', \{ method: 'POST', body: \{ uid: li\.dataset\.uid, amountCents: cents, ref \} \}/.test(ADMINPAGE)
    && /if \(ref\.length < 2\) \{ said\.textContent = 'Add the check number\.'/.test(ADMINPAGE)
    && /Net GoFundMe proceeds so far, in dollars/.test(ADMINPAGE) && /Zazzle creator earnings being added, in dollars/.test(ADMINPAGE) && /placeholder="Check #"/.test(ADMINPAGE) && !/ID #|This week|This month/.test(ADMINPAGE)
    && !HARD.some((re) => re.test(f('public/js/push.js'))),
    'pins');
}

// ---- F26: his home is the fund (2026-10-04, v7.25) -------------------------------
// Eric: "I want everything but information about the fundraiser and applicants HIDDEN in a parked
// PR 1." Signing in takes him to the Fund queue, his device's landing goes there too, the queue's nav
// is the Fund and PR 1 and nothing else, and every parked admin page carries both so he can always get
// home. The client's own pages link to nothing that is parked.
// NEGATIVE CONTROL (run 2026-10-04): the password door's `location.href = '/admin-fund.html';` put back to '/admin.html' made this read
//   FAIL  F26 his home is the fund: both admin doors on the sign-in page go to the Fund queue, sign-in otherwise defaults to the fund page, his device's landing goes to the queue, the queue's nav is the Fund and PR 1 alone, every parked admin page leads with both, the queue keeps his alerts registered, and the client's own pages link to nothing parked
{
  const SIGNIN = f('public/signin.html');
  const AF = f('public/admin-fund.html');
  const tabs = (html) => [...(html.match(/<nav class="tabs">([\s\S]*?)<\/nav>/) || ['', ''])[1].matchAll(/<a href="([^"]+)"/g)].map((m) => m[1]);
  const parkedAdmin = ['admin', 'admin-case', 'admin-calendar', 'admin-chats', 'admin-availability', 'admin-dictionary'];
  const PARKED = /href="\/(about|advocate|book|contact|faq|fit|reviews|services|stats|subscribe)(\.html)?["#?]/;
  const clientPages = ['signin', 'case', 'chat', 'subscription', 'return', 'fund', 'index'];
  check('F26 his home is the fund: both admin doors on the sign-in page go to the Fund queue, sign-in otherwise defaults to the fund page, his device\'s landing goes to the queue, the queue\'s nav is the Fund and PR 1 alone, every parked admin page leads with both, the queue keeps his alerts registered, and the client\'s own pages link to nothing parked',
    (SIGNIN.match(/location\.href = '\/admin-fund\.html';/g) || []).length === 2 && !/location\.href = '\/admin\.html'/.test(SIGNIN)
    && /const returnTo = params\.get\('to'\) \|\| '\/fund\.html';/.test(SIGNIN)
    && /location\.replace\('\/signin\.html\?to=%2Fadmin-fund\.html'\);/.test(f('public/index.html'))
    && tabs(AF).join() === '/admin-fund.html,/admin-pr1.html' && /<a href="\/admin-fund\.html" class="active">🤝 Fund<\/a>/.test(AF)
    && parkedAdmin.every((n) => tabs(f(`public/${n}.html`)).slice(0, 2).join() === '/admin-fund.html,/admin-pr1.html')
    && /initPushPrompt\(user, null\)/.test(ADMINPAGE)
    && clientPages.every((n) => !PARKED.test(f(`public/${n}.html`))),
    JSON.stringify({ fundTabs: tabs(AF), adminTabs: tabs(f('public/admin.html')) }));
}

// ---- F27: the old public pages are hidden (2026-10-04, v7.25) ----------------------
// Eric chose "Hide them too": anyone who opens Services, About, Book, the FAQ and the rest is sent to
// the fund page; he still opens them from PR 1. The gate's regex is lifted out of the Worker and RUN,
// and so is the gate itself, against a stranger, against him, and against the admin demo.
// NEGATIVE CONTROL (run 2026-10-04): `|services` taken out of PARKED_PUBLIC made this read
//   FAIL  F27 the old public pages are hidden: all ten in both spellings are behind the gate and the client's own pages, the fund and the admin pages are not; the gate sits before the admin gate, sends a stranger to the fund page with a 302 and serves him the page privately; the three inline redirects are gone; the audit lists all ten as parked and none as a client page
{
  const lit = (W.match(/const PARKED_PUBLIC = (\/.*\/);/) || [])[1];
  const RE = lit ? new Function(`return ${lit}`)() : /$^/;
  const TEN = ['about', 'advocate', 'book', 'contact', 'faq', 'fit', 'reviews', 'services', 'stats', 'subscribe'];
  const inside = TEN.flatMap((n) => [`/${n}`, `/${n}.html`, `/${n}/`]);
  const outside = ['/', '/index.html', '/fund', '/fund.html', '/case', '/case.html', '/chat.html', '/signin', '/signin.html', '/subscription.html', '/return.html',
    '/admin-fund', '/admin-pr1.html', '/admin-pr1-landing.html', '/js/book.js', '/css/site.css', '/booking', '/servicesx.html'];
  const at = W.indexOf('    if (PARKED_PUBLIC.test(assetPath)) {');
  const block = at > 0 ? W.slice(at, W.indexOf('\n    }\n', at) + 6) : '';
  const gateRun = new Function('assetPath', 'demo', 'request', 'env', 'url', 'adminCookieUid', 'demoCookie', 'PARKED_PUBLIC',
    `return (async () => { ${block} return null; })();`);
  const env2 = { ASSETS: { fetch: async () => new Response('<h1>Services</h1>', { headers: { 'cache-control': 'public, max-age=3600' } }) } };
  const u = new URL('https://thepocketadvocates.com/services.html');
  const stranger = await gateRun('/services.html', '', {}, env2, u, async () => null, () => 'pa_demo=x', RE);
  const him = await gateRun('/services.html', '', {}, env2, u, async () => 'eric', () => 'pa_demo=x', RE);
  const demoAdmin = await gateRun('/services.html', 'admin', {}, env2, new URL('http://127.0.0.1:9377/services.html?demo=admin'), async () => null, () => 'pa_demo=admin', RE);
  const AUDIT = f('tools/blindness-audit.mjs');
  const parkedList = (AUDIT.match(/const PARKED_PAGES = \[([\s\S]*?)\];/) || [])[1] || '';
  const clientList = (AUDIT.match(/const CLIENT_PAGES = \[([\s\S]*?)\];/) || [])[1] || '';
  check('F27 the old public pages are hidden: all ten in both spellings are behind the gate and the client\'s own pages, the fund and the admin pages are not; the gate sits before the admin gate, sends a stranger to the fund page with a 302 and serves him the page privately; the three inline redirects are gone; the audit lists all ten as parked and none as a client page',
    inside.every((p) => RE.test(p)) && !outside.some((p) => RE.test(p))
    && at > 0 && at < W.indexOf('    if (ADMIN_ASSET.test(assetPath)) {\n      const isPage') && at > W.indexOf('if ((ADMIN_ASSET.test(assetPath) || DEMO_ASSET.test(assetPath)) && demo) {')
    && stranger?.status === 302 && stranger.headers.get('location') === 'https://thepocketadvocates.com/'
    && him?.status === 200 && him.headers.get('cache-control') === 'private, no-store' && him.headers.get('vary') === 'Cookie'
    && demoAdmin?.status === 200 && /pa_demo=admin/.test(demoAdmin.headers.get('set-cookie') || '')
    && ['contact', 'faq', 'services'].every((n) => !/pa-admin-device|location\.replace/.test(f(`public/${n}.html`)))
    && TEN.every((n) => parkedList.includes(`'/${n}'`) && !clientList.includes(`'/${n}'`)),
    JSON.stringify({ lit: !!lit, stranger: stranger?.status, him: him?.status, demoAdmin: demoAdmin?.status }));
}

// ---- F28: sure alerts for applications (2026-10-04, v7.25) -------------------------
// Eric: "be sure I receive notifications for applications." Every submit and resubmit pushes to his
// devices and emails pocketadvocate.eric@gmail.com as the backup, neither with a name or a detail;
// the test button proves both arrive and says how many devices have alerts on; only a reviewer can
// press it.
// NEGATIVE CONTROL (run 2026-10-04): alertReviewer's `if (env.ADMIN_EMAIL) {` changed to `if (false) {` made this read
//   FAIL  F28 sure alerts: a submit and a resubmit each push to him and email his address, with no name or detail in either; the test alert is a reviewer's alone, reaches every device he turned alerts on for and his email, and says how many devices; the queue's card turns alerts on for the device and sends the test, and the demo answers it
{
  const envA = { ADMIN_UID: 'eric', ADMIN_EMAIL: 'eric.alerts@example.test' };
  const callA = async (w, e, uid, path, opts) => {
    const r = req(uid, path, opts);
    const res = await w.api.handleFund(r, e, r._url, null);
    let out = null;
    try { out = await res.clone().json(); } catch { out = null; }
    return { status: res.status, out };
  };
  const w = world();
  for (const [p, opts] of [['/api/fund/draft', { method: 'POST', json: { ...FULL, applicantNote: 'Ann from Boise' } }]]) await callA(w, envA, 'ann', p, opts);
  await up(w, 'ann', 'id');
  await up(w, 'ann', 'medical');
  const sent = await callA(w, envA, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const first = { pushes: w.pushes.filter((x) => x.uid === 'eric'), mails: w.emails.filter((x) => x.to === envA.ADMIN_EMAIL) };
  await callA(w, envA, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'request_info', message: 'Please add a clearer ID.' } });
  await callA(w, envA, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const second = { pushes: w.pushes.filter((x) => x.uid === 'eric'), mails: w.emails.filter((x) => x.to === envA.ADMIN_EMAIL) };
  const leaked = JSON.stringify([...second.pushes, ...second.mails]);
  const asAnn = await callA(w, envA, 'ann', '/api/admin/fund/test-alert', { method: 'POST', json: {} });
  w.setDoc('users/eric', { role: 'admin', pushSubs: [{ endpoint: 'https://push.example/e1' }, { endpoint: 'https://push.example/e2' }] });
  const test = await callA(w, envA, 'eric', '/api/admin/fund/test-alert', { method: 'POST', json: {} });
  const testMail = w.emails.filter((x) => x.to === envA.ADMIN_EMAIL).slice(-1)[0];
  const noMail = await callA(w, { ADMIN_UID: 'eric' }, 'eric', '/api/admin/fund/test-alert', { method: 'POST', json: {} });
  const DEMO_T = /path === '\/api\/admin\/fund\/test-alert'/.test(DEMO);
  check('F28 sure alerts: a submit and a resubmit each push to him and email his address, with no name or detail in either; the test alert is a reviewer\'s alone, reaches every device he turned alerts on for and his email, and says how many devices; the queue\'s card turns alerts on for the device and sends the test, and the demo answers it',
    sent.status === 200 && first.pushes.length === 1 && first.mails.length === 1
    && first.pushes[0].title === 'New fund application' && first.pushes[0].link === '/admin-fund.html'
    && first.mails[0].subject === 'New Community Assistance Fund application' && first.mails[0].html.includes('A new application is waiting in your Fund queue.') && first.mails[0].html.includes('https://thepocketadvocates.com/admin-fund.html')
    && second.pushes.length === 2 && second.pushes[1].title === 'Updated fund application' && second.mails.length === 2 && second.mails[1].subject === 'Updated Community Assistance Fund application'
    && !/Ann|ann_d|Doe|Boise|Pin Oak|copays|ID\./.test(leaked)
    && asAnn.status === 404 && test.status === 200 && test.out.devices === 2 && test.out.emailed === true
    && w.pushes.slice(-2)[0]?.title === 'Test alert' && testMail?.subject === 'Test alert: Community Assistance Fund'
    && noMail.out.emailed === false && noMail.out.devices === 2
    && /p === '\/api\/admin\/fund\/test-alert' && request\.method === 'POST'/.test(SRC) && /env\.ADMIN_EMAIL/.test(SRC)
    && /"ADMIN_EMAIL": "pocketadvocate\.eric@gmail\.com"/.test(f('wrangler.jsonc'))
    && /enablePush\(user\)/.test(ADMINPAGE) && /'\/api\/admin\/fund\/test-alert'/.test(ADMINPAGE) && /Send me a test alert/.test(ADMINPAGE)
    && /Turn on alerts on this device/.test(ADMINPAGE) && /Home Screen icon/.test(ADMINPAGE) && /initPushPrompt\(user, null\)/.test(ADMINPAGE)
    && DEMO_T && !DASH.test(ADMINPAGE),
    JSON.stringify({ first: [first.pushes.length, first.mails.length], second: [second.pushes.length, second.mails.length], asAnn: asAnn.status, test: test.out, noMail: noMail.out }));
}

// ---- F29: the payout dates (2026-10-04, v7.25) --------------------------------------
// Eric: "monthly payout distributions. With first payout November 1." Christmas Eve ends the
// fundraiser, so the last check goes out January 1. RUN at fixed instants: early October, either side
// of midnight Mountain going into November 1, early December and early January.
// NEGATIVE CONTROL (run 2026-10-04): the first payout's `at` moved to `Date.UTC(2026, 10, 1, 0)` (midnight UTC, the evening of Oct 31 in Mountain time) made this read
//   FAIL  F29 the checks go out on the 1st of November, December and January: the next check is November 1 until midnight Mountain begins it, then December 1, then January 1, then none; the words read like a date, and the landing and the status page say the same
// RE-PINNED 2026-10-04 (v7.26): Eric, "Verified applicants will receive monthly payouts via Mercury Business Check on January 1st, 2027. Not monthly."
// One date. RUN at early October, early November, either side of midnight Mountain going into
// January 1 (07:00 UTC), and early January.
// NEGATIVE CONTROL (run 2026-10-04, v7.26): the November 1 payout put back first in PAYOUTS made this read
//   FAIL  F29 the payout is one check, on January 1, 2027: it is the payout date from now until midnight Mountain begins that day, and none after; the words read like a date, and the landing and the status page say the same
{
  const at = (iso) => RULES.nextPayout(Date.parse(iso))?.date || null;
  check('F29 the payout is one check, on January 1, 2027: it is the payout date from now until midnight Mountain begins that day, and none after; the words read like a date, and the landing and the status page say the same',
    RULES.PAYOUTS.map((p) => p.date).join() === '2027-01-01'
    && at('2026-10-04T18:00:00Z') === '2027-01-01' && at('2026-11-02T12:00:00Z') === '2027-01-01' && at('2027-01-01T06:59:59Z') === '2027-01-01'
    && at('2027-01-01T07:00:00Z') === null && at('2027-01-02T12:00:00Z') === null
    && RULES.payoutWords(RULES.PAYOUTS[0]) === 'January 1, 2027' && RULES.payoutWords(null) === ''
    && RULES.chaseLine(RULES.PAYOUTS[0].at) === 'If you do not receive your check by January 10, please email office@pocketadvocacy.com.'
    // RE-PINNED 2026-10-04 (v7.27): his sentence word for word, "January 1st, 2027".
    && f('public/index.html').includes('on January 1st, 2027.') && /const next = nextPayout\(\);/.test(PAGE) && /import \{[^}]*nextPayout, payoutWords[^}]*\} from '\.\/fund-rules\.js';/.test(PAGE)
    && !/November|each month|monthly/i.test(PAGE.replace(/^\s*\/\/.*$/gm, '')),
    JSON.stringify(['2026-10-04T18:00:00Z', '2026-11-02T12:00:00Z', '2027-01-01T06:59:59Z', '2027-01-01T07:00:00Z', '2027-01-02T12:00:00Z'].map(at)));
}

// ---- F30: the fund's totals, the running share and what is owed (2026-10-04, v7.26) ----
// Eric: "I also need to input Net GoFundMe proceeds so far, Zazzle creator earnings being added,
// Combined total in the fund", and "you will get notifications of all updates, including a running
// total of your payout." RUN: two Friday posts with a check mailed between them. Each participant's
// share so far, what has been mailed and what is still owed follow; the queue's Friday post for
// Discord is lifted and RUN, and the approved usernames are one tap to copy.
// NEGATIVE CONTROL (run 2026-10-04): sentAndOwed's `Math.max(0, (Number(shareCents) || 0) - sentCents)` changed to `(Number(shareCents) || 0)` made this read
//   FAIL  F30 the running share: two Friday posts add the GoFundMe and Zazzle totals, each participant's share so far, what was mailed and what is still owed follow each post, the participant sees what was sent to them, an old single total reads as GoFundMe alone, and the queue copies the Friday post and the approved Discord usernames
{
  const w = world();
  const verified = (uid, extra = {}) => w.setDoc(`fundApplications/${uid}`, { userId: uid, verificationStatus: 'verified', participationRequested: true, participationActive: true, preferredName: uid, discordUsername: `${uid}_d`, accountEmail: `${uid}@example.test`, audit: [], ...extra });
  verified('ann'); verified('bob');
  for (const u of ['ann', 'bob']) w.setDoc(`fundPayments/${u}`, { method: 'check', accountName: u, address: { line1: '1 Main St', line2: '', city: 'Boise', state: 'ID', zip: '83702' } });
  await call(w, 'eric', '/api/admin/fund/pool', { method: 'POST', json: { gofundmeCents: 100000, zazzleCents: 0 } });
  await call(w, 'eric', '/api/admin/fund/payout', { method: 'POST', json: { uid: 'ann', amountCents: 30000, ref: '1001' } });
  const after1 = (await call(w, 'eric', '/api/admin/fund/pool')).out;
  const second = (await call(w, 'eric', '/api/admin/fund/pool', { method: 'POST', json: { gofundmeCents: 150000, zazzleCents: 10000 } })).out;
  const row = (o, u) => o.participants.find((r) => r.uid === u);
  const annSees = (await call(w, 'ann', '/api/fund/me')).out.application.pool;
  const legacy = RULES.fundTotals({ totalCents: 500 });
  const lift = (src, head) => { const i = src.indexOf(head); return i < 0 ? '' : src.slice(i, src.indexOf('\n}\n', i) + 2); };
  const discordPost = new Function('dollars', 'longDay', `${lift(ADMINPAGE, 'function discordPost(p) {')}\nreturn discordPost;`)(RULES.dollars, () => 'October 9, 2026');
  const post = discordPost({ updatedAt: 'x', activeCount: 2, gofundmeCents: 150000, zazzleCents: 10000, totalCents: 160000 });
  check('F30 the running share: two Friday posts add the GoFundMe and Zazzle totals, each participant\'s share so far, what was mailed and what is still owed follow each post, the participant sees what was sent to them, an old single total reads as GoFundMe alone, and the queue copies the Friday post and the approved Discord usernames',
    row(after1, 'ann').sentCents === 30000 && row(after1, 'ann').owedCents === 20000 && row(after1, 'bob').owedCents === 50000 && row(after1, 'ann').discordUsername === 'ann_d'
    && second.pool.totalCents === 160000 && second.pool.shareCents === 80000 && row(second, 'ann').owedCents === 50000 && row(second, 'bob').owedCents === 80000
    && annSees?.shareCents === 80000 && annSees.sentCents === 30000 && annSees.totalCents === 160000
    && legacy.gofundmeCents === 500 && legacy.zazzleCents === 0 && legacy.totalCents === 500
    && RULES.sentAndOwed([{ amountCents: 90000 }], 80000).owedCents === 0
    && post === 'Community Assistance Fund update, October 9, 2026\nApproved recipients: 2\nNet GoFundMe proceeds so far: $1,500.00\nZazzle creator earnings being added: $100.00\nCombined total in the fund: $1,600.00'
    && /Copy the Friday post for Discord/.test(ADMINPAGE) && /Copy the approved Discord usernames/.test(ADMINPAGE) && /navigator\.clipboard\.writeText\(text\)/.test(ADMINPAGE)
    && /value="\$\{p \? money\(r\.owedCents\) : ''\}"/.test(ADMINPAGE) && /Paid up so far\./.test(ADMINPAGE) && /Still owed \$\{dollars\(r\.owedCents\)\}/.test(ADMINPAGE)
    && /Both are totals so far, not one week's\. Post every Friday\./.test(ADMINPAGE) && /id="fq-combined"/.test(ADMINPAGE)
    && /path === '\/api\/admin\/fund\/pool' && method === 'POST'/.test(DEMO) && /gofundmeCents, zazzleCents, totalCents/.test(DEMO) && /sentAndOwed\(a\.payouts, p\?\.shareCents\)/.test(DEMO),
    JSON.stringify({ a1: row(after1, 'ann'), a2: row(second, 'ann'), annSees, post }));
}

// ---- F31: what Eric's post says, on the pages (2026-10-04, v7.26) ----------------------
// His Reddit post, sent "in case there's anything here you haven't added": one shared fund divided
// equally, the organizer takes nothing, January 10 for a check that has not come, what is
// never made public, the optional photo, the Home Screen running total, the Friday figures, the
// usernames published before payout, sharing, and a reply within three business days.
// NEGATIVE CONTROL (run 2026-10-04): chaseLine's `parts.day <= 5 ? parts.month : (parts.month % 12) + 1` changed to `parts.month` made this read
//   FAIL  F31 what his post says is on the pages: the landing says how it works and what is published every Friday and before payout, the form says what stays private, that a photo is optional and that usernames are published, both pages promise a reply in three business days, and a check that has not come by the 10th is chased, in the check email too
{
  const IDX = f('public/index.html');
  const READ = IDX.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '');
  const w = world();
  w.setDoc('fundApplications/bob', { userId: 'bob', verificationStatus: 'verified', participationRequested: true, participationActive: true, accountEmail: 'bob@example.test', audit: [] });
  w.setDoc('fundPayments/bob', { method: 'check', accountName: 'Bob B', address: { line1: '1 Main St', line2: '', city: 'Boise', state: 'ID', zip: '83702' } });
  await call(w, 'eric', '/api/admin/fund/payout', { method: 'POST', json: { uid: 'bob', amountCents: 50000, ref: '2001' } });
  const mail = w.emails.find((x) => x.to === 'bob@example.test');
  const chase = (iso) => RULES.chaseLine(Date.parse(iso));
  check('F31 what his post says is on the pages: the landing says how it works and what is published every Friday and before payout, the form says what stays private, that a photo is optional and that usernames are published, both pages promise a reply in three business days, and a check that has not come by the 10th is chased, in the check email too',
    ['One shared fund, divided equally among verified recipients.',
      'All net proceeds from the GoFundMe plus any Zazzle creator earnings contributed during the fundraiser will be split equally among every approved participant. The organizer will not receive any portion of the payout.',
      'If you do not receive your check by January 10, please email office@pocketadvocacy.com.', // RE-PINNED 2026-10-04 (v7.26): Eric, "Verified applicants will receive monthly payouts via Mercury Business Check on January 1st, 2027. Not monthly."
      'Your diagnosis, legal name and medical documents will not be made public.',
      'Photos will only be posted with your consent. Not submitting one will not affect approval or your share.',
      'including a running total of your payout.',
      'Every Friday, these are posted in the Discord:', 'Number of approved recipients', 'Net GoFundMe proceeds so far', 'Zazzle creator earnings being added', 'Combined total in the fund',
      'Before payout, the Discord usernames of every approved recipient are published in both text and video, along with the final amount raised and the equal payout amount. No medical information or legal names are published.',
      'Please feel free to share the GoFundMe, the Discord, this page or the store with friends and family.',
    ].every((l) => READ.includes(l))
    && PAGE.includes('Your diagnosis, legal name and medical documents will not be made public.')
    && PAGE.includes('Photos are completely optional and will only be posted with your consent. Not submitting one will not affect approval or your share.')
    // RE-PINNED 2026-10-04 (v7.28): the notice became a required tick on Step 4 (Eric: "Discord usernames
    // are mandatory. They have to join."), held by F32.
    && PAGE.includes('I understand that if I am approved, my Discord username will be published in text and video before payout.') && PAGE.includes('No medical information or legal names are published.')
    && /You’ll get a reply within three business days\./.test(HTML) && /You’ll get a reply within three business days\./.test(IDX)
    && chase('2026-11-01T06:00:00Z') === 'If you do not receive your check by November 10, please email office@pocketadvocacy.com.'
    && /by November 10,/.test(chase('2026-10-31T20:00:00Z')) && /by January 10,/.test(chase('2026-12-28T12:00:00Z')) && chase('nope') === ''
    && /If you do not receive your check by \w+ 10, please email office@pocketadvocacy\.com\./.test(mail?.html || '')
    && /chaseLine\(next\.at\)/.test(PAGE) && !DASH.test(IDX) && !DASH.test(PAGE) && !HARD.some((re) => re.test(READ)),
    JSON.stringify({ mail: !!mail, nov: chase('2026-11-01T06:00:00Z') }));
}

// ---- F32: the Discord username is mandatory (2026-10-04, v7.28) -------------------------
// Eric: "Discord usernames are mandatory. They have to join." The username is asked for by name (not a
// display name) with the invite beside it, membership is confirmed on Step 4, and agreeing that the
// username is published before payout is a required tick there, enforced by the Worker, stamped with
// its time and shown to the reviewer. RUN: an application missing only the tick is refused at Step 4.
// NEGATIVE CONTROL (run 2026-10-04): submitGaps' usernamePublicConsent line removed made this read
//   FAIL  F32 the Discord username is mandatory: asked for by name with the invite beside it, membership confirmed, and the published-username tick required by the Worker at Step 4, stamped when given, cleared when taken back, and shown to the reviewer
{
  const w = world();
  await readyToSubmit(w, 'ann', { usernamePublicConsent: false });
  const held = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const unstamped = app(w).usernameConsentAt ?? null;
  await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { usernamePublicConsent: true } });
  const stamped = app(w).usernameConsentAt;
  const ok = await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const sentStatus = app(w).verificationStatus;
  const seen = (await call(w, 'eric', '/api/admin/fund/view?uid=ann')).out?.application;
  const w2 = world();
  await call(w2, 'ann', '/api/fund/draft', { method: 'POST', json: { usernamePublicConsent: true } });
  await call(w2, 'ann', '/api/fund/draft', { method: 'POST', json: { usernamePublicConsent: false } });
  const gaps = (a) => RULES.submitGaps(a, null).map((g) => g.why);
  check('F32 the Discord username is mandatory: asked for by name with the invite beside it, membership confirmed, and the published-username tick required by the Worker at Step 4, stamped when given, cleared when taken back, and shown to the reviewer',
    held.status === 400 && held.out.gaps.length === 1 && held.out.gaps[0].step === 4 && held.out.error === 'Tick the box that says your Discord username will be published if you are approved.'
    && unstamped === null && !!stamped && ok.status === 200 && sentStatus === 'submitted'
    && seen?.usernamePublicConsent === true && !!seen.usernameConsentAt
    && app(w2).usernamePublicConsent === false && app(w2).usernameConsentAt === null
    && gaps({}).includes('Add your Discord username.') && gaps({}).includes('Confirm that you are a member of the Discord community.')
    && /field\('discordUsername', 'Discord username', \{ max: 64, hint: 'Required\. Your Discord username, not a display name\.' \}\)/.test(PAGE)
    && /You must be a member of our Discord community\. Not a member yet\? <a href="\$\{DISCORD_INVITE\}"/.test(PAGE)
    && /check\('usernamePublicConsent', 'I understand that if I am approved, my Discord username will be published in text and video before payout\.', form\.usernamePublicConsent\)/.test(PAGE)
    && /if \(!form\.usernamePublicConsent\) return \['Tick the box that says your Discord username will be published if you are approved\.'\];/.test(PAGE)
    && /usernamePublicConsent: form\.usernamePublicConsent/.test(PAGE) && !/display name\./.test(PAGE.replace(/not a display name\./, ''))
    && /<dt>Username may be published<\/dt>/.test(ADMINPAGE)
    && f('public/index.html').includes('Applicants must be members of our Discord community. A Discord username is required.'),
    JSON.stringify({ held: held.status, stamped: !!stamped, ok: ok.status, status: sentStatus, seen: [seen?.usernamePublicConsent, seen?.usernameConsentAt], w2: [app(w2).usernamePublicConsent, app(w2).usernameConsentAt], unstamped }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
