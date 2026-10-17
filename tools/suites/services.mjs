// services.mjs - a contractor's own services: asked for by them, switched by him, bought once to open a case (v7.74).
//
// Eric, 2026-10-17: "Allow me to turn different tiers on and off for each contractor (including new tier types that a
// contractor wants during onboarding)." One-time or monthly: "Either, their choice". What buying a one-time one does:
// "Opens a case, no time". A monthly one: "Like Full-Service" (its months come with the next update; until then a
// monthly one is kept and switched, not sold).
//
// worker/services.js, worker/payroll.js and worker/employer.js are imported; worker/advocates.js and
// worker/staffsettings.js are evaluated whole with stand-ins for the store; the checkout, the rates and
// createCaseFromSession are lifted out of worker/index.js and RUN with Stripe, the mail and the store stood in.
//
//   S1 what a service is: well formed or dropped, and only an on, priced, one-time one can be bought
//   S2 a change is checked: a name, one-time or monthly, a price Stripe can charge, six at most; only he switches one on,
//      and one they rename or change the kind of goes back to him; their price stays theirs
//   S3 they ask from their settings: it is kept off, he is told by name once, and nobody else's record moves
//   S4 his side, their card in Employer mode: he adds, changes, switches and takes away; his own card has none; only he
//      reaches it
//   S5 the rates list what a client can buy from them right now, and nothing private
//   S6 the checkout sells only one he has turned on, at its price, with the card held, and asks for the number and forms
//   S7 the case it opens: no call time, its chat open, the service's name and price kept on it, the right ping and mail
//   S8 the shelf, the team page and payroll call the case by the service's name
//   S9 the pages: their booking page lists and sells it, their case runs on its own steps, his card and their settings
//      carry it, and the demo mirrors it
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
const SVCS = await import(pathToFileURL(join(ROOT, 'worker/services.js')).href);
const STAFF = await import(pathToFileURL(join(ROOT, 'worker/staff.js')).href);
const CHARGE = await import(pathToFileURL(join(ROOT, 'worker/charge.js')).href);
const ADDONS = await import(pathToFileURL(join(ROOT, 'worker/addons.js')).href);
const PAYROLL = await import(pathToFileURL(join(ROOT, 'worker/payroll.js')).href);
const EMPLOYER = await import(pathToFileURL(join(ROOT, 'worker/employer.js')).href);
const SETTINGS = await import(pathToFileURL(join(ROOT, 'worker/staffsettings.js')).href);
const strip = (src) => src.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export \{[^}]*\} from '[^']+';\n/gm, '')
  .replace(/^export (const|let|async function|function) /gm, '$1 ');
const W = f('worker/index.js');
const afn = (name) => { const m = W.match(new RegExp(`\\nasync function ${name}\\([\\s\\S]*?\\n\\}`)); if (!m) throw new Error(`could not lift ${name}`); return m[0]; };
const line = (re) => { const m = W.match(re); if (!m) throw new Error(`could not lift ${re}`); return m[0]; };
const CONSTS = [line(/const INVITE_ID_RE = [^\n]+;/), line(/const REQUIRED_ACKS = [^\n]+;/), line(/const METHODS = [^\n]+;/),
  line(/const PHONE_RE = [^\n]+;/), line(/const FULL_ACCESS_ACK = [^\n]+;/),
  line(/const cleanPhone = \(v\) => \(typeof v === 'string'\n[^\n]+\n/), line(/const cleanAddress = \(v\) => \(typeof v === 'string'\n[^\n]+\n/)].join('\n');

const ERIC = 'eric-uid';
const ENV = { ADMIN_UID: ERIC, ADMIN_EMAIL: 'eric@x.test', PUBLIC_BASE_URL: 'https://app.test' };
const clone = (v) => JSON.parse(JSON.stringify(v));
const ACKS = { disclaimer: 1, privacy: 1, recording: 1, service: 1, phoneConsent: 1 };
const { servicesOf, serviceOf, sellable, cleanServices, newlyAsked, SERVICE_MAX } = SVCS;
const RECORDS = { id: 'sabc12345', label: 'Records review', about: 'Your records read and sorted', kind: 'once', cents: 30000, on: true, askedAt: null };

console.log('\n--- S1. what a service is ---');
{
  const rec = { services: [
    { ...RECORDS, label: ' Records   review ', about: 'Read\u0007and sorted' },
    { id: 'bad', label: 'No id', kind: 'once', cents: 100, on: true },
    { id: 'sdef67890', label: 'A', kind: 'once', cents: 100, on: true },
    { id: 'sghi11111', label: 'Monthly check-ins', kind: 'month', cents: 90000, on: true },
    { id: 'sjkl22222', label: 'Off one', kind: 'once', cents: 5000, on: false },
    { id: 'smno33333', label: 'Odd kind', kind: 'weekly', cents: 5000, on: 'yes' },
    { id: 'spqr44444', label: 'Too cheap', kind: 'once', cents: 49, on: true },
  ] };
  const list = servicesOf(rec);
  const many = servicesOf({ services: Array.from({ length: 9 }, (_, i) => ({ id: `smany0000${i}`.slice(0, 9), label: `Service ${i}`, kind: 'once', cents: 100, on: true })) });
  // NEGATIVE CONTROL (run 2026-10-17): sellable's `s.kind === 'once' &&` taken out made this read
  //   FAIL  S1 a stored service is well formed or dropped, and only one that is on, priced and one-time can be bought
  check('S1 a stored service is well formed or dropped, and only one that is on, priced and one-time can be bought',
    JSON.stringify(list.map((s) => s.id)) === '["sabc12345","sghi11111","sjkl22222","smno33333","spqr44444"]'
    && list[0].label === 'Records review' && list[0].about === 'Read and sorted'
    && list[3].kind === 'once' && list[3].on === false
    && JSON.stringify(list.filter(sellable).map((s) => s.id)) === '["sabc12345"]'
    && serviceOf(rec, 'sabc12345')?.cents === 30000 && serviceOf(rec, '../x') === null && serviceOf(rec, 'sdef67890') === null && serviceOf(null, 'sabc12345') === null
    && servicesOf({ services: 'x' }).length === 0 && servicesOf(null).length === 0 && many.length === SERVICE_MAX && SERVICE_MAX === 6
    && sellable(null) === false,
    JSON.stringify(list));
}

console.log('\n--- S2. a change is checked ---');
{
  const prev = [{ ...RECORDS, askedAt: 'T0' }];
  const his = cleanServices([{ label: 'Insurance appeal letter', kind: 'once', cents: 45000, about: 'Drafted with you', on: true }], [], { admin: true });
  const theirs = cleanServices([{ label: 'Insurance appeal letter', kind: 'once', cents: 45000, on: true }], []);
  const repriced = cleanServices([{ id: 'sabc12345', label: 'records review', kind: 'once', cents: 35000, on: false }], prev);
  const renamed = cleanServices([{ id: 'sabc12345', label: 'Records and calls', kind: 'once', cents: 30000, on: true }], prev);
  const rekinded = cleanServices([{ id: 'sabc12345', label: 'Records review', kind: 'month', cents: 30000, on: true }], prev);
  const offByHim = cleanServices([{ id: 'sabc12345', label: 'Records review', kind: 'once', cents: 30000, on: false }], prev, { admin: true });
  const madeUpId = cleanServices([{ id: 'szzz99999', label: 'New one', kind: 'once', cents: 500, on: true }], prev);
  const blank = cleanServices([{ label: '', about: '' }, { label: ' ', about: ' ' }], []);
  const refused = [
    cleanServices('x', []),
    cleanServices([{ label: '', about: 'something', kind: 'once', cents: 100 }], []),
    cleanServices([{ label: 'A', kind: 'once', cents: 100 }], []),
    cleanServices([{ label: 'Same', kind: 'once', cents: 100 }, { label: 'same', kind: 'once', cents: 200 }], []),
    cleanServices([{ label: 'No kind', cents: 100 }], []),
    cleanServices([{ label: 'Too cheap', kind: 'once', cents: 49 }], []),
    cleanServices([{ label: 'Too dear', kind: 'once', cents: 2_000_001 }], []),
    cleanServices([{ label: 'Half cents', kind: 'once', cents: 100.5 }], []),
    cleanServices(Array.from({ length: 7 }, (_, i) => ({ label: `Service ${i}`, kind: 'once', cents: 100 })), []),
  ];
  // NEGATIVE CONTROL (run 2026-10-17): cleanServices' `const on = admin ? x.on === true : same && was.on === true;` made
  // `const on = admin ? x.on === true : was?.on === true;` (a renamed one kept on) made this read
  //   FAIL  S2 a change is checked: a name, one-time or monthly, a price from $0.50 to $20,000, six at most; only he switches one on, one they rename or change the kind of goes back to him, and their price stays theirs
  check('S2 a change is checked: a name, one-time or monthly, a price from $0.50 to $20,000, six at most; only he switches one on, one they rename or change the kind of goes back to him, and their price stays theirs',
    his.value?.[0].on === true && his.value[0].askedAt === null && /^s[a-z0-9]{8}$/.test(his.value[0].id) && his.value[0].about === 'Drafted with you'
    && theirs.value?.[0].on === false && typeof theirs.value[0].askedAt === 'string'
    && repriced.value?.[0].on === true && repriced.value[0].cents === 35000 && repriced.value[0].askedAt === 'T0' && repriced.value[0].id === 'sabc12345'
    && renamed.value?.[0].on === false && renamed.value[0].askedAt !== 'T0' && renamed.value[0].id === 'sabc12345'
    && rekinded.value?.[0].on === false && rekinded.value[0].kind === 'month'
    && offByHim.value?.[0].on === false && offByHim.value[0].askedAt === 'T0'
    && madeUpId.value?.[0].on === false && madeUpId.value[0].id === 'szzz99999'
    && JSON.stringify(blank.value) === '[]'
    && refused.every((r) => !!r.error && !r.value) && /twice/.test(refused[3].error) && /Up to 6/.test(refused[8].error)
    && !refused.some((r) => DASH.test(r.error)),
    JSON.stringify({ renamed: renamed.value, repriced: repriced.value, refused: refused.map((r) => r.error || 'LET THROUGH') }));
}

// ---- their settings -----------------------------------------------------------------------------------------------
function settingsWorld() {
  const docs = new Map();
  const getDoc = async (env, p) => (docs.has(p) ? { id: p.split('/').pop(), data: clone(docs.get(p)) } : null);
  const patchDoc = async (env, p, data, opts = {}) => {
    const cur = clone(docs.get(p) || {});
    for (const path of opts.mask || []) {
      const keys = path.split('.');
      let src = data; for (const k of keys) src = src?.[k];
      let at = cur; keys.slice(0, -1).forEach((k) => { at[k] = at[k] && typeof at[k] === 'object' ? at[k] : {}; at = at[k]; });
      at[keys[keys.length - 1]] = src === undefined ? null : clone(src);
    }
    docs.set(p, opts.mask ? cur : clone(data));
    return true;
  };
  const SS = new Function('getDoc', 'patchDoc', 'advocateIdOf', 'servicesOf', 'cleanServices', 'newlyAsked',
    `${strip(f('worker/staffsettings.js'))}\nreturn { contractorSettings, mergeRates, handleStaffSettings };`)(
    getDoc, patchDoc, STAFF.advocateIdOf, servicesOf, cleanServices, newlyAsked);
  docs.set(`users/${ERIC}`, { role: 'admin' });
  docs.set(`advocates/${ERIC}`, { uid: ERIC, name: 'Eric Leach', active: true, owner: true });
  docs.set('users/ana', { role: 'advocate' });
  docs.set('advocates/ana', { uid: 'ana', name: 'Ana Rivera', active: true, owner: false, services: [RECORDS] });
  docs.set('users/ben', { role: 'advocate' });
  docs.set('advocates/ben', { uid: 'ben', name: 'Ben Cole', active: true, owner: false });
  docs.set('advocates/off', { uid: 'off', name: 'Turned Off', active: false, owner: false, services: [RECORDS] });
  docs.set('users/c1', { role: 'client' });
  return { docs, getDoc, patchDoc, SS };
}

console.log('\n--- S3. they ask from their settings ---');
{
  const w = settingsWorld();
  const told = [];
  const gates = {
    json: (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } }),
    requireStaff: async (req) => {
      const uid = req.headers.get('x-uid'); if (!uid) return null;
      const p = w.docs.get(`users/${uid}`);
      return STAFF.staffFrom(ENV, { uid }, p ? { data: p } : null, w.docs.has(`advocates/${uid}`) ? { data: w.docs.get(`advocates/${uid}`) } : null);
    },
    readRates: async () => ({ caseCents: 210000, addonCents: 32500, fullCents: 440000, subCents: 5000 }),
    officeStatus: (manual) => ({ inOffice: true, scheduled: true, manual }),
    tellEric: async (env, body, link) => { told.push({ body, link }); },
  };
  const call = async (uid, json, method = 'POST') => {
    const headers = new Headers(); if (uid) headers.set('x-uid', uid);
    const res = await w.SS.handleStaffSettings({ method, headers, json: async () => json ?? null }, ENV, gates);
    let out = null; try { out = await res.json(); } catch { out = null; }
    return { status: res.status, out };
  };
  const ask = await call('ana', { services: [{ ...RECORDS, on: false }, { label: 'Insurance appeal letter', kind: 'once', cents: 45000, about: 'Drafted with you', on: true }] });
  const afterAsk = clone(w.docs.get('advocates/ana').services);
  const again = await call('ana', { services: ask.out?.services || [] });
  const toldAfterAgain = told.length;
  const renamed = await call('ana', { services: (again.out?.services || []).map((s) => (s.id === 'sabc12345' ? { ...s, label: 'Records and calls' } : s)) });
  const bad = await call('ana', { services: [{ label: 'X', kind: 'once', cents: 100 }] });
  const read = await call('ana', null, 'GET');
  const asClient = await call('c1', { services: [] });
  const asHim = await call(ERIC, { services: [] });
  const stranger = await call('', { services: [] });
  const nothing = await call('ben', {});
  // NEGATIVE CONTROL (run 2026-10-17): the route's `{ admin: false }` made `{ admin: true }` made this read
  //   FAIL  S3 they ask from their settings: a new one is kept off and he is told by name, once; one renamed goes back to him and he is told again; nobody else's record moves
  check('S3 they ask from their settings: a new one is kept off and he is told by name, once; one renamed goes back to him and he is told again; nobody else\'s record moves',
    ask.status === 200 && afterAsk.length === 2 && afterAsk[0].on === true && afterAsk[1].on === false && afterAsk[1].label === 'Insurance appeal letter'
    && typeof afterAsk[1].askedAt === 'string' && ask.out.services.length === 2
    && told[0]?.body === 'Ana asked to offer Insurance appeal letter. Turn it on from their card in Employer mode.' && told[0].link === '/admin-employer.html'
    && again.status === 200 && toldAfterAgain === 1
    && renamed.status === 200 && w.docs.get('advocates/ana').services[0].on === false && told.length === 2 && /Ana asked to offer Records and calls\./.test(told[1].body)
    && bad.status === 400 && read.status === 200 && read.out.services.length === 2
    && asClient.status === 404 && asHim.status === 404 && stranger.status === 404 && nothing.status === 400
    && w.docs.get('advocates/ben').services === undefined && JSON.stringify(w.docs.get('advocates/off').services) === JSON.stringify([RECORDS])
    && !told.some((t) => DASH.test(t.body)),
    JSON.stringify({ ask: ask.status, afterAsk, told, again: again.status, renamed: renamed.status, bad: bad.out, asClient: asClient.status, asHim: asHim.status }));
}

console.log('\n--- S4. his side: their card in Employer mode ---');
{
  const SRC = f('worker/advocates.js');
  const docs = new Map();
  const deps = {
    getDoc: async (env, p) => (docs.has(p) ? { id: p.split('/').pop(), data: clone(docs.get(p)), updateTime: 't' } : null),
    patchDoc: async (env, p, data, opts = {}) => {
      if (opts.mustNotExist && docs.has(p)) return null;
      const cur = opts.mask ? (docs.get(p) || {}) : {};
      docs.set(p, clone({ ...cur, ...data }));
      return true;
    },
    deleteDoc: async (env, p) => { docs.delete(p); return true; },
    queryDocs: async () => [],
    listDocs: async (env, coll) => [...docs.entries()].filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === 2).map(([k, v]) => ({ id: k.split('/')[1], data: v })),
    putFile: async () => ({}), deleteFile: async () => {}, mediaFetch: async () => ({ ok: false }),
    sendEmail: async () => true, notifyUser: async () => {},
    ...STAFF,
    addonsOf: ADDONS.addonsOf, cleanAddons: ADDONS.cleanAddons,
    servicesOf, cleanServices,
    cleanSettingsChange: SETTINGS.cleanSettingsChange, settingsFrom: SETTINGS.settingsFrom, nest: SETTINGS.nest,
    bufferHoursOf: SETTINGS.bufferHoursOf, cleanBufferHours: SETTINGS.cleanBufferHours,
    cleanPayout: PAYROLL.cleanPayout, sealPayout: PAYROLL.sealPayout, PAYOUT_METHODS: PAYROLL.PAYOUT_METHODS,
  };
  const api = new Function(...Object.keys(deps), `${strip(SRC)}\nreturn { handleAdvocates };`)(...Object.values(deps));
  const h = {
    json: (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } }),
    requireAdmin: async (req) => { const uid = req.headers.get('x-uid'); return uid === ERIC && docs.get(`users/${uid}`)?.role === 'admin' ? { uid, email: 'eric@x.test' } : null; },
    requireStaff: async (req) => { const uid = req.headers.get('x-uid'); if (!uid) return null; const p = docs.get(`users/${uid}`); return STAFF.staffFrom(ENV, { uid, authTime: Math.floor(Date.now() / 1000) + 5 }, p ? { data: p } : null, docs.has(`advocates/${uid}`) ? { data: docs.get(`advocates/${uid}`) } : null); },
    mintCustomToken: async (e, uid) => `token-for-${uid}`,
    issueDeviceToken: async (e, uid) => `device-for-${uid}`,
  };
  const call = async (uid, json) => {
    const headers = new Headers(); if (uid) headers.set('x-uid', uid);
    const url = new URL('https://app.test/api/admin/advocates');
    const res = await api.handleAdvocates({ method: 'POST', headers, url: url.href, json: async () => json }, ENV, url, h);
    let out = null; try { out = await res.json(); } catch { out = null; }
    return { status: res.status, out };
  };
  docs.set(`users/${ERIC}`, { role: 'admin' });
  docs.set(`advocates/${ERIC}`, { uid: ERIC, name: 'Eric Leach', email: 'eric@x.test', active: true, owner: true, commissionPct: 100 });
  const made = await call(ERIC, { action: 'create', name: 'Ana Rivera', email: 'ana@example.com', password: 'given-password-1',
    services: [{ label: 'Records review', kind: 'once', cents: 30000, about: 'Your records read and sorted', on: true }, { label: 'Monthly check-ins', kind: 'month', cents: 90000, on: false }] });
  const uid = made.out?.uid;
  const atCreate = clone(docs.get(`advocates/${uid}`)?.services || []);
  const got = await call(ERIC, { action: 'get', uid });
  const changed = await call(ERIC, { action: 'update', uid, services: [{ ...atCreate[0], label: 'Records and calls', on: true }, { ...atCreate[1], on: true }] });
  const afterChange = clone(docs.get(`advocates/${uid}`)?.services || []);
  const takenAway = await call(ERIC, { action: 'update', uid, services: [afterChange[0]] });
  const afterTake = clone(docs.get(`advocates/${uid}`)?.services || []);
  const badPrice = await call(ERIC, { action: 'update', uid, services: [{ label: 'Free?', kind: 'once', cents: 0 }] });
  const hisOwn = await call(ERIC, { action: 'update', uid: ERIC, services: [{ label: 'His', kind: 'once', cents: 500, on: true }] });
  docs.set(`users/${uid}`, { role: 'advocate' });
  const asThem = await call(uid, { action: 'update', uid, services: [{ ...afterTake[0], on: true, label: 'Sneaky' }] });
  const stranger = await call('', { action: 'get', uid });
  // NEGATIVE CONTROL (run 2026-10-17): the update's `&& a.owner !== true` taken out made this read
  //   FAIL  S4 on their card he adds, changes, switches and takes away their services, a bad price is refused, his own card keeps none, and only he reaches the card
  check('S4 on their card he adds, changes, switches and takes away their services, a bad price is refused, his own card keeps none, and only he reaches the card',
    made.status === 200 && atCreate.length === 2 && atCreate[0].on === true && atCreate[0].askedAt === null && atCreate[1].kind === 'month' && atCreate[1].on === false
    && got.status === 200 && got.out.services.length === 2 && got.out.services[0].label === 'Records review'
    && changed.status === 200 && afterChange[0].label === 'Records and calls' && afterChange[0].on === true && afterChange[0].id === atCreate[0].id && afterChange[1].on === true
    && takenAway.status === 200 && afterTake.length === 1 && afterTake[0].id === atCreate[0].id
    && badPrice.status === 400 && docs.get(`advocates/${uid}`).services.length === 1
    && hisOwn.status === 400 && hisOwn.out.error === 'Nothing to change.' && docs.get(`advocates/${ERIC}`).services === undefined
    && asThem.status === 404 && docs.get(`advocates/${uid}`).services[0].label === 'Records and calls' && stranger.status === 404,
    JSON.stringify({ made: made.status, atCreate, changed: changed.out, afterChange, badPrice: badPrice.out, hisOwn: hisOwn.status, asThem: asThem.status }));
}

console.log('\n--- S5. the rates list what can be bought ---');
{
  const w = settingsWorld();
  w.docs.set('advocates/ana', { uid: 'ana', name: 'Ana Rivera', active: true, owner: false, services: [
    { ...RECORDS, askedAt: '2026-10-17T01:00:00.000Z' }, { id: 'sghi11111', label: 'Monthly check-ins', kind: 'month', cents: 90000, on: true },
    { id: 'sjkl22222', label: 'Waiting one', kind: 'once', cents: 5000, on: false, askedAt: 'T1' }] });
  const readRates = async () => ({ caseCents: 210000, addonCents: 32500, subCents: 5000, fullCents: 440000 });
  const rates = async (q) => {
    const h = new Function('contractorSettings', 'readRates', 'fullAccessCapacity', 'mergeRates', 'caseAddons', 'advocateIdOf', 'json',
      'CHAT_OPEN_CENTS', 'TELEHEALTH_PRICE_CENTS', 'FULL_INCLUDED_HOURS', 'getDoc', 'servicesOf', 'sellable', `${afn('handleRates')} return handleRates;`)(
      w.SS.contractorSettings, readRates, async () => ({ room: true }), w.SS.mergeRates, async () => null, STAFF.advocateIdOf,
      (o) => o, 5000, 52500, 20, w.getDoc, servicesOf, sellable);
    return h(ENV, new URL(`https://app.test/api/rates${q}`));
  };
  const ana = await rates('?advocate=ana');
  const his = await rates('');
  const off = await rates('?advocate=off');
  const junk = await rates('?advocate=../users/x');
  // NEGATIVE CONTROL (run 2026-10-17): handleRates' `.filter(sellable)` taken out made this read
  //   FAIL  S5 the rates list what a client can buy from them right now, by name, price and line, and never a switch or a request; his and a turned off contractor's list none
  check('S5 the rates list what a client can buy from them right now, by name, price and line, and never a switch or a request; his and a turned off contractor\'s list none',
    JSON.stringify(ana.services) === JSON.stringify([{ id: 'sabc12345', label: 'Records review', about: 'Your records read and sorted', kind: 'once', cents: 30000 }])
    && JSON.stringify(his.services) === '[]' && JSON.stringify(off.services) === '[]' && JSON.stringify(junk.services) === '[]'
    && !/askedAt|"on"/.test(JSON.stringify(ana)),
    JSON.stringify({ ana: ana.services, his: his.services, off: off.services }));
}

console.log('\n--- S6. the checkout ---');
{
  const w = settingsWorld();
  w.docs.set('advocates/ana', { uid: 'ana', name: 'Ana Rivera', active: true, owner: false, services: [RECORDS,
    { id: 'sghi11111', label: 'Monthly check-ins', kind: 'month', cents: 90000, on: true }, { id: 'sjkl22222', label: 'Waiting one', kind: 'once', cents: 5000, on: false }] });
  w.docs.set(`advocates/${ERIC}`, { uid: ERIC, name: 'Eric Leach', active: true, owner: true, services: [RECORDS] });
  const run = async (body, { user = { uid: 'c1', email: 'c@x.test' }, adult = { name: 'Dana Reyes', dob: '1980-02-02', email: 'dana@x.test' } } = {}) => {
    const stripe = [];
    const h = new Function('requireUser', 'requireAdultProfile', 'json', 'contractorSettings', 'getDoc', 'serviceOf', 'sellable', 'HOLD_MINUTES',
      'stripePost', 'firstName', 'HOLD_INTENT', 'HOLD_META', 'validTz', `${CONSTS}\n${afn('handleServiceCheckout')} return handleServiceCheckout;`)(
      async () => user, async () => adult, (o, st = 200) => ({ status: st, body: o }), w.SS.contractorSettings, w.getDoc, serviceOf, sellable, 30,
      async (env, path, b) => { stripe.push({ path, b }); return { url: 'https://stripe.test/s' }; },
      (v) => String(v || '').trim().split(/\s+/)[0] || 'A client', CHARGE.HOLD_INTENT, CHARGE.HOLD_META, (tz) => (typeof tz === 'string' ? tz : null));
    const res = await h({ json: async () => body }, ENV);
    return { res, s: stripe[0] || null };
  };
  const good = { advocate: 'ana', service: 'sabc12345', quotedCents: 30000, method: 'phone', phone: '208-555-0100', address: '1 Main St', acks: ACKS, tz: 'America/Boise' };
  const ok = await run(good);
  const m = ok.s?.b?.metadata || {};
  const li = ok.s?.b?.line_items?.[0]?.price_data || {};
  const refused = {
    signedOut: await run(good, { user: null }),
    minor: await run(good, { adult: { error: 'Pocket Advocate serves adults.', code: 403 } }),
    his: await run({ ...good, advocate: ERIC }),
    off: await run({ ...good, advocate: 'off' }),
    junk: await run({ ...good, advocate: '../users/x' }),
    monthly: await run({ ...good, service: 'sghi11111', quotedCents: 90000 }),
    waiting: await run({ ...good, service: 'sjkl22222', quotedCents: 5000 }),
    unknown: await run({ ...good, service: 'szzz99999' }),
    otherAdvocates: await run({ ...good, advocate: 'ben' }),
    phone: await run({ ...good, phone: '12' }),
    forms: await run({ ...good, acks: { ...ACKS, privacy: undefined } }),
    moved: await run({ ...good, quotedCents: 25000 }),
  };
  // NEGATIVE CONTROL (run 2026-10-17): handleServiceCheckout's `if (!sellable(svc)) return notOffered();` made `if (!svc) return notOffered();` made this read
  //   FAIL  S6 the checkout sells only a service he has turned on, at its price, holding the card, with whose and which on the session; it asks for the number and the forms, and a moved price is shown, not charged
  check('S6 the checkout sells only a service he has turned on, at its price, holding the card, with whose and which on the session; it asks for the number and the forms, and a moved price is shown, not charged',
    ok.res.status === 200 && ok.s?.path === '/checkout/sessions' && li.unit_amount === 30000 && li.product_data?.name === 'Records review'
    && li.product_data.description === 'With Ana, your advocate' && ok.s.b.payment_intent_data?.capture_method === 'manual' && m.hold === '1'
    && m.advocateId === 'ana' && m.serviceId === 'sabc12345' && m.serviceLabel === 'Records review' && m.uid === 'c1' && m.kind === undefined
    && !m.slotId && !m.requestedStart && m.phone === '208-555-0100' && JSON.parse(m.acks).privacy === 1
    && /\/book\.html\?advocate=ana&service=sabc12345&canceled=1$/.test(ok.s.b.cancel_url)
    && refused.signedOut.res.status === 401 && refused.minor.res.status === 403
    && ['his', 'off', 'junk', 'monthly', 'waiting', 'unknown', 'otherAdvocates'].every((k) => refused[k].res.status === 404 && refused[k].res.body.error === 'That service is not offered right now.')
    && refused.phone.res.status === 400 && refused.forms.res.status === 400
    && refused.moved.res.status === 409 && refused.moved.res.body.priceCents === 30000
    && Object.values(refused).every((r) => !r.s),
    JSON.stringify({ ok: ok.res, m, refused: Object.fromEntries(Object.entries(refused).map(([k, r]) => [k, r.res.status])) }));
}

console.log('\n--- S7. the case it opens ---');
{
  const make = async (metadata, { held = { state: 'held' }, amount = 30000 } = {}) => {
    const store = new Map([['advocates/ana', { uid: 'ana', name: 'Ana Rivera', active: true, owner: false, services: [{ ...RECORDS, label: 'Records review (renamed later)' }] }]]);
    const log = [];
    const deps = {
      queryDocs: async () => [],
      getDoc: async (env, p) => (store.has(p) ? { id: p.split('/').pop(), data: clone(store.get(p)) } : null),
      patchDoc: async (env, p, data, opts = {}) => { log.push(['patch', p]); if (opts.mustNotExist && store.has(p)) return null; store.set(p, { ...(store.get(p) || {}), ...clone(data) }); return true; },
      resolveClientEmail: async (env, uid, e) => e || 'dana@x.test',
      safeJson: (s) => { try { return JSON.parse(s); } catch { return null; } },
      advocateIdOf: STAFF.advocateIdOf,
      ratesForCase: async () => ({ caseCents: 210000, addonCents: 32500, fullCents: 440000 }),
      serviceOf,
      heldChargeOf: (session, h) => ({ ...h, authorizedCents: session.amount_total }),
      pingAdmins: async (env, body) => { log.push(['admins', body]); },
      pingCase: async (env, c, body) => { log.push(['ping', body, c?.advocateId || '']); },
      firstName: (v) => String(v || '').trim().split(/\s+/)[0] || 'A client',
      raiseRatesFor: async () => { log.push(['raise']); },
      endChatForStepUp: async () => {},
      stripePost: async () => ({}),
      escHtml: (s) => String(s),
      sendEmail: async (env, mail) => { log.push(['mail', mail.to, mail.subject, mail.html]); return true; },
      caseRecipients: async () => [],
      notifyUser: async () => {},
      CHARGE_COPY: CHARGE.CHARGE_COPY,
      whenHtml: () => '<p>WHEN</p>',
      homeScreenTips: () => '',
      console: { warn() {}, error() {} },
    };
    const create = new Function(...Object.keys(deps), `${CONSTS}\n${afn('createCaseFromSession')}\nreturn createCaseFromSession;`)(...Object.values(deps));
    await create(ENV, { id: 'cs_svc', amount_total: amount, payment_intent: 'pi_svc', metadata }, { held });
    const caseKey = [...store.keys()].find((k) => k.startsWith('cases/'));
    return { c: caseKey ? store.get(caseKey) : null, log, store };
  };
  const meta = { ...CHARGE.HOLD_META, uid: 'c1', email: 'dana@x.test', name: 'Dana Reyes', dob: '1980-02-02', method: 'phone', phone: '208-555-0100',
    acks: JSON.stringify(ACKS), advocateId: 'ana', serviceId: 'sabc12345', serviceLabel: 'Records review' };
  const bought = await make(meta);
  const mail = bought.log.find((e) => e[0] === 'mail');
  const ping = bought.log.find((e) => e[0] === 'ping');
  const noLabel = await make({ ...meta, serviceLabel: '' });
  const noUid = await make({ ...meta, uid: '' });
  const nothing = await make({ ...meta, serviceId: '' });
  const aCase = await make({ ...meta, serviceId: '', serviceLabel: '', requestedStart: new Date(Date.now() + 5 * 86_400_000).toISOString() });
  // NEGATIVE CONTROL (run 2026-10-17): the case's `appointment: service ? null : {` made `appointment: {` made this read
  //   FAIL  S7 the case it opens has no call time, its chat open, the name and price as sold kept on it, the hold waiting on its advocate, a ping and a mail that name the service; a case still books a time
  check('S7 the case it opens has no call time, its chat open, the name and price as sold kept on it, the hold waiting on its advocate, a ping and a mail that name the service; a case still books a time',
    bought.c?.appointment === null && bought.c.chatUnlocked === true && bought.c.advocateId === 'ana' && bought.c.status === 'confirmed'
    && JSON.stringify(bought.c.service) === JSON.stringify({ id: 'sabc12345', label: 'Records review', kind: 'once', cents: 30000 })
    && bought.c.caseRateCents === 30000 && bought.c.charge?.state === 'held' && bought.c.fullAccess === false && bought.c.reportDueAt === null
    && ping?.[1] === 'Dana asked for Records review. Their card is held, not charged: approve or decline it.' && ping[2] === 'ana'
    && !bought.log.some((e) => e[0] === 'raise')
    && mail?.[1] === 'dana@x.test' && mail[2] === 'Your Pocket Advocate case is in' && /<strong>Records review<\/strong>, with Ana\. There is no call time to pick: you plan the next step together in your case chat\./.test(mail[3])
    && !/Meeting method|WHEN|before the call/.test(mail[3]) && !DASH.test(mail[3])
    && noLabel.c?.service?.label === 'Records review (renamed later)'
    && noUid.c === null && nothing.c === null
    && aCase.c?.appointment?.requested === true && aCase.c.service === undefined && aCase.c.chatUnlocked === undefined && aCase.c.caseRateCents === 210000
    && /booked a case\./.test(aCase.log.find((e) => e[0] === 'ping')?.[1] || '') && /WHEN/.test(aCase.log.find((e) => e[0] === 'mail' && e[1] === 'dana@x.test')?.[3] || ''),
    JSON.stringify({ c: bought.c && { appointment: bought.c.appointment, service: bought.c.service, rate: bought.c.caseRateCents }, ping, mail: mail?.[3]?.slice(0, 300) }));
}

console.log('\n--- S8. the shelf, the team page and payroll name it ---');
{
  const ADMIN = f('public/js/admin.js');
  const c = { advocateId: 'ana', clientName: 'Dana Reyes', service: { id: 'sabc12345', label: 'Records review', kind: 'once', cents: 30000 },
    charge: { state: 'captured', capturedCents: 30000, capturedAt: '2026-10-10T12:00:00.000Z' }, createdAt: '2026-10-09T12:00:00.000Z' };
  const lines = PAYROLL.caseLines([{ id: 'k1', data: c }], new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'), ENV);
  const plain = PAYROLL.caseLines([{ id: 'k2', data: { ...c, service: undefined } }], new Date('2026-10-01T00:00:00Z'), new Date('2026-11-01T00:00:00Z'), ENV);
  // NEGATIVE CONTROL (run 2026-10-17): payroll's `c.service?.label ? String(c.service.label) : ` taken out made this read
  //   FAIL  S8 the shelf files their service under OWN SERVICES with its hold, the team page and payroll call it by its name, and a case still reads as one
  check('S8 the shelf files their service under OWN SERVICES with its hold, the team page and payroll call it by its name, and a case still reads as one',
    EMPLOYER.caseKind(c) === 'Records review' && EMPLOYER.caseKind({ fullAccess: true }) === 'Full-Service' && EMPLOYER.caseKind({}) === 'Advocacy Case'
    && lines[0]?.kind === 'booking' && lines[0].label === 'Records review' && lines[0].cents === 30000 && plain[0]?.label !== 'Records review'
    && /section\('OWN SERVICES', 'var\(--violet\)', svcOpen\.map\(\(c\) => rowFor\(c,\n\s+`\$\{chargeTag\(c\)\}<strong style="color:var\(--manila-strong\)">\$\{esc\(c\.service\.label\)\}<\/strong>/.test(ADMIN)
    && /const svcOpen = shelved\.filter\(\(c\) => c\.service && !c\.fullAccess && c\.status !== 'closed'\);/.test(ADMIN)
    && /const future = shelved\.filter\(\(c\) => !fullOpen\.includes\(c\) && !svcOpen\.includes\(c\) &&/.test(ADMIN),
    JSON.stringify({ kind: EMPLOYER.caseKind(c), lines, plain }));
}

console.log('\n--- S9. the pages ---');
{
  const BOOK = f('public/js/book.js');
  const CASE = f('public/js/case.js');
  const WIZ = f('public/js/admin-wizard.js');
  const SSET = f('public/js/admin-staffsettings.js');
  const DEMO = f('public/js/demo/api.js');
  const SV = f('worker/services.js');
  const fn = (src, decl) => (src.match(new RegExp(`\\n( *)(async )?function ${decl}\\([\\s\\S]*?\\n\\1\\}`)) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17): renderPayment's `if (state.service) return renderServicePayment();` taken out made this read
  //   FAIL  S9 the pages: their booking page lists each one and sells it on its own step with no time, their case runs on its own steps, his card and their settings carry them, and the demo mirrors the Worker
  check('S9 the pages: their booking page lists each one and sells it on its own step with no time, their case runs on its own steps, his card and their settings carry them, and the demo mirrors the Worker',
    /return ADVOCATE && \/\^s\[a-z0-9\]\{8\}\$\/\.test\(v\) \? v : '';/.test(BOOK)
    && /href="\/book\.html\?advocate=\$\{encodeURIComponent\(ADVOCATE\)\}&service=\$\{encodeURIComponent\(x\.id\)\}" data-adv-service=/.test(fn(BOOK, 'addServiceList'))
    && /if \(SERVICE\) \{\n\s+if \(await showService\(el\)\) wireStep1\(el\);\n\s+return;\n\s+\}/.test(BOOK)
    && /There is no call time to pick: once \$\{esc\(first\)\} takes it on, you plan the next step together in your case chat\./.test(fn(BOOK, 'showService'))
    && /function renderPayment\(\) \{\n\s+if \(state\.service\) return renderServicePayment\(\);/.test(BOOK)
    && /fetch\('\/api\/service-checkout', \{/.test(fn(BOOK, 'renderServicePayment')) && /advocate: ADVOCATE, service: svc\.id, quotedCents: svc\.cents,/.test(BOOK)
    && /The price is now \$\$\{money\(svc\.cents\)\}\. Tap Pay again to go ahead\./.test(BOOK)
    && /const SERVICE_STEPS = \[/.test(CASE) && /\['confirmed', 'Taken on\. Plan the next step together in your case chat'\],/.test(CASE)
    && /data-services/.test(WIZ) && /data-s-on/.test(fn(WIZ, 'serviceRow')) && /\.\.\.\(owner \? \{\} : \{ tz: st\.tz, commissionPct: st\.commissionPct, settings, payout, services \}\)/.test(WIZ)
    && /data-svc-save disabled[^>]*>Save and send to Eric<\/button>/.test(SSET) && /and again after you change its name or kind\./.test(SSET)
    && /if \(!svc \|\| !svc\.on \|\| svc\.kind !== 'once' \|\| svc\.cents < 50\) return fail\(404, 'That service is not offered right now\.'\);/.test(DEMO)
    && /status: 'confirmed', createdAt: now, appointment: null,\n\s+service: \{ id: svc\.id, label: svc\.label, kind: 'once', cents: svc\.cents \}, chatUnlocked: true,/.test(DEMO)
    && /const same = !!was && String\(was\.label \|\| ''\)\.toLowerCase\(\) === name\.toLowerCase\(\) && was\.kind === x\.kind;/.test(DEMO)
    && ![fn(BOOK, 'showService'), fn(BOOK, 'addServiceList'), fn(BOOK, 'renderServicePayment'), fn(SSET, 'serviceRow'), fn(WIZ, 'serviceRow'), SV].some((x) => DASH.test(x))
    && [fn(BOOK, 'showService'), fn(BOOK, 'addServiceList'), fn(BOOK, 'renderServicePayment'), fn(SSET, 'serviceRow'), fn(WIZ, 'serviceRow')].every(Boolean));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
