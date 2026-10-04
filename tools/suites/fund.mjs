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
  const api = new Function(...Object.keys(deps), `${body}\nreturn { handleFund, minimizeFundApplication, isFundReviewer, FUND_REVIEWER_UIDS };`)(...Object.values(deps));
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
const FULL = {
  discordUsername: 'ann_d', preferredName: 'Ann', legalName: 'Ann Doe', discordMember: true, participationRequested: true,
  consents: { accurate: true, noGuarantee: true, notMedical: true, reviewerView: true, formula: true },
  payment: { method: 'venmo', handle: '@ann-d' },
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
  const full = { discordUsername: 'a', preferredName: 'A', legalName: 'A B', identityDocument: { id: 'x' }, medicalDocuments: [{ id: 'y' }], discordMember: true, participationRequested: true, consents: FULL.consents };
  const pay = { method: 'venmo', handle: '@a-b' };
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

// ---- F7: the reason is the reviewer's, the message is the applicant's ----------
// NEGATIVE CONTROL (run 2026-10-04): the reason length check changed to `reason.length < 0` made this read
//   FAIL  F7 a decline or a request for more information needs a brief internal reason, which goes only into the history; the applicant reads only the optional message, and only while it asks something of them or explains a decline; the internal note never reaches them
{
  const w = world();
  await readyToSubmit(w);
  await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const noReason = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'decline', message: 'Sorry.' } });
  const noReason2 = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'request_info', reason: ' ' } });
  await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'note', note: 'Second letter looks fine.' } });
  const asked = await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'request_info', reason: 'ID photo is blurry', message: 'Please add a clearer photo of your ID.' } });
  const sees = (await call(w, 'ann', '/api/fund/me')).out.application;
  await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  const after = (await call(w, 'ann', '/api/fund/me')).out.application;
  const row = app(w).audit.find((r) => r.act === 'request_info');
  const s = JSON.stringify(sees);
  check('F7 a decline or a request for more information needs a brief internal reason, which goes only into the history; the applicant reads only the optional message, and only while it asks something of them or explains a decline; the internal note never reaches them',
    noReason.status === 400 && noReason2.status === 400 && asked.status === 200
    && row?.reason === 'ID photo is blurry' && row?.msg === 'Please add a clearer photo of your ID.'
    && sees.verificationStatus === 'more_info' && sees.applicantMessage === 'Please add a clearer photo of your ID.'
    && !/blurry|Second letter|internalReviewerNote|reviewerId|audit|accountEmail/.test(s) && after.applicantMessage === '',
    JSON.stringify({ noReason: noReason.status, keys: Object.keys(sees) }));
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
//   FAIL  F10 nothing about an applicant leaves in a notification: the reviewer's push names no one and says nothing about the application, the applicant's email says only that there is an update and where to sign in, and the Worker module logs nothing at all
{
  const w = world();
  await readyToSubmit(w);
  await call(w, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  w.setDoc('fundApplications/ann', { ...app(w), accountEmail: 'ann@example.test' });
  await call(w, 'eric', '/api/admin/fund/act', { method: 'POST', json: { uid: 'ann', action: 'decline', reason: 'Not a member', message: 'You are not in the server.' } });
  const p = w.pushes[0];
  const e = w.emails[0];
  const all = JSON.stringify([w.pushes, w.emails]);
  check('F10 nothing about an applicant leaves in a notification: the reviewer\'s push names no one and says nothing about the application, the applicant\'s email says only that there is an update and where to sign in, and the Worker module logs nothing at all',
    w.pushes.length === 1 && p.uid === 'eric' && p.title === 'New fund application' && p.body === 'Open the fund queue to review it.' && p.link === '/admin-fund.html'
    && w.emails.length === 1 && e.to === 'ann@example.test' && e.subject === 'An update on your Community Assistance Fund application'
    && !/Ann|ann_d|Doe|Not a member|not in the server|declin|Not Verified|medical/i.test(all.replace('ann@example.test', ''))
    && !/console\.|diagLog/.test(SRC),
    all.slice(0, 300));
}

// ---- F11: payment details -------------------------------------------------------
// NEGATIVE CONTROL (run 2026-10-04): looksSensitive's Luhn line removed and the 8-digit rule raised to 20 made this read
//   FAIL  F11 payment details live apart and hold only what the method needs: they sit in fundPayments and never on the application, a card number, a routing number or a password is refused with nothing stored, a Zelle phone number is fine, a bank transfer keeps only the name on the account, and someone who wants no distributions has theirs deleted when they submit
{
  const w = world();
  await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { ...FULL, payment: { method: 'paypal', handle: 'pay.ann@example.test' } } });
  const stored = w.docs.get('fundPayments/ann')?.data;
  const onApp = JSON.stringify(app(w));
  const card = await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { payment: { method: 'paypal', handle: '4111 1111 1111 1111' } } });
  const routing = await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { payment: { method: 'other', otherMethod: 'Cash App', handle: 'routing 021000021' } } });
  const pw = await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { payment: { method: 'other', otherMethod: 'Cash App', handle: '$ann password hunter2' } } });
  const acct = await call(w, 'ann', '/api/fund/draft', { method: 'POST', json: { payment: { method: 'bank', accountName: 'Ann Doe 123456789' } } });
  const after = w.docs.get('fundPayments/ann')?.data;
  const zelle = RULES.cleanPayment({ method: 'zelle', handle: '(555) 123-4567' });
  const bank = RULES.cleanPayment({ method: 'bank', accountName: 'Ann Doe', handle: 'x', otherMethod: 'y' });
  const w2 = world();
  await readyToSubmit(w2, 'ann');
  await call(w2, 'ann', '/api/fund/draft', { method: 'POST', json: { participationRequested: false } });
  await call(w2, 'ann', '/api/fund/submit', { method: 'POST', json: {} });
  check('F11 payment details live apart and hold only what the method needs: they sit in fundPayments and never on the application, a card number, a routing number or a password is refused with nothing stored, a Zelle phone number is fine, a bank transfer keeps only the name on the account, and someone who wants no distributions has theirs deleted when they submit',
    stored?.method === 'paypal' && stored.handle === 'pay.ann@example.test' && !/paypal|pay\.ann@example\.test|"payment"/.test(onApp)
    && [card, routing, pw, acct].every((r) => r.status === 400 && r.out.error === RULES.SENSITIVE_REFUSAL)
    && after.handle === 'pay.ann@example.test'
    && zelle.payment?.handle === '(555) 123-4567' && bank.payment?.accountName === 'Ann Doe' && bank.payment.handle === '' && bank.payment.otherMethod === ''
    && app(w2).verificationStatus === 'submitted' && !w2.docs.has('fundPayments/ann'),
    JSON.stringify({ card: card.status, routing: routing.status, pw: pw.status, acct: acct.status, zelle }));
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
    && (W.match(/handleFund\(/g) || []).length === 1 && /import \{ handleFund \} from '\.\/fund\.js';/.test(W)
    && RE.test('/admin-fund.html') && RE.test('/admin-fund') && RE.test('/js/admin-fund.js') && !RE.test('/fund.html') && !RE.test('/js/fund.js')
    && /'\/fund',/.test(AUDIT) && /'\/admin-fund',/.test(AUDIT) && /'\/js\/admin-fund\.js',/.test(AUDIT) && /'\/js\/fund-rules\.js'/.test(AUDIT)
    && /'\/fund\.html\?demo=1'/.test(NOSIDE) && /'\/admin-fund\.html\?demo=admin'/.test(NOSIDE)
    && /from '\.\.\/fund-rules\.js';/.test(DEMO) && /from '\.\.\/public\/js\/fund-rules\.js';/.test(SRC)
    && self.status === 403 && selfOut.error === RULES.SELF_VERIFY_REFUSAL && asClient.status === 404 && docs.get('fundApplications/demo-admin').verificationStatus === 'submitted',
    JSON.stringify({ gate: !!gate, self: self.status, asClient: asClient.status }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
