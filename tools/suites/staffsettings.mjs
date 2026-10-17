// staffsettings.mjs - a contractor's own settings, run on stand-in stores.
//
// Eric, 2026-10-15: "Contractors have controls in settings just like me."
// His settings are the business's (one door sign, one price list, one
// Full-Service limit). A contractor gets the same three for their own clients:
// in or out of office and a response line, their own prices, and how many
// Full-Service clients they take at once. worker/staffsettings.js is evaluated
// whole with its imports replaced by stand-ins; the Worker's capacity count is
// lifted out and run; the pages' wiring is read.
//
// Run: node staffsettings.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const W = f('worker/index.js');
const STAFF = await import(pathToFileURL(j(ROOT, 'worker/staff.js')).href);
const SVCS = await import(pathToFileURL(j(ROOT, 'worker/services.js')).href);
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
/** A top-level function out of a source file, by its declaration line. */
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}

const ERIC = 'eric-uid';
const ENV = { ADMIN_UID: ERIC };
const strip = (src) => src.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function|let) /gm, '$1 ');

function world() {
  const docs = new Map();
  const writes = [];
  const clone = (v) => JSON.parse(JSON.stringify(v));
  const getDoc = async (env, p) => (docs.has(p) ? { id: p.split('/').pop(), data: clone(docs.get(p)) } : null);
  // A masked write sets exactly the dotted paths named, as Firestore does.
  const patchDoc = async (env, p, data, opts = {}) => {
    writes.push({ p, data: clone(data), mask: opts.mask || null });
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
    `${strip(f('worker/staffsettings.js'))}\nreturn { settingsFrom, offersFrom, contractorOf, contractorSettings, mergeRates, cleanSettingsChange, handleStaffSettings, STAFF_RATE_KEYS };`)(
    getDoc, patchDoc, STAFF.advocateIdOf, SVCS.servicesOf, SVCS.cleanServices, SVCS.newlyAsked);
  return { docs, writes, SS };
}
const gates = (w) => ({
  json: (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } }),
  requireStaff: async (req) => {
    const uid = req.headers.get('x-uid'); if (!uid) return null;
    const p = w.docs.get(`users/${uid}`);
    return STAFF.staffFrom(ENV, { uid }, p ? { data: p } : null, w.docs.has(`advocates/${uid}`) ? { data: w.docs.get(`advocates/${uid}`) } : null);
  },
  readRates: async () => ({ caseCents: 210000, addonCents: 32500, fullCents: 440000, subCents: 5000 }),
  officeStatus: (manual) => ({ inOffice: manual ? manual === 'in' : true, scheduled: true, manual }),
});
const call = async (w, uid, method = 'GET', json) => {
  const headers = new Headers(); if (uid) headers.set('x-uid', uid);
  const req = { method, headers, json: async () => json ?? null };
  const res = await w.SS.handleStaffSettings(req, ENV, gates(w));
  let out = null; try { out = await res.json(); } catch { out = null; }
  return { status: res.status, out };
};
const seed = (w) => {
  w.docs.set(`users/${ERIC}`, { role: 'admin' });
  w.docs.set(`advocates/${ERIC}`, { uid: ERIC, name: 'Eric', active: true, owner: true });
  w.docs.set('users/adv-a', { role: 'advocate' });
  w.docs.set('advocates/adv-a', { uid: 'adv-a', name: 'Ana Rivera', active: true, owner: false });
  w.docs.set('users/adv-b', { role: 'advocate' });
  w.docs.set('advocates/adv-b', { uid: 'adv-b', name: 'Ben Cole', active: true, owner: false, settings: { rates: { caseCents: 150000 } } });
  w.docs.set('advocates/adv-off', { uid: 'adv-off', name: 'Off', active: false, owner: false, settings: { rates: { caseCents: 99900 } } });
  w.docs.set('users/c1', { role: 'client' });
};

console.log('\n--- A. what a change may ask for ---');
{
  const { SS } = world();
  const ok = SS.cleanSettingsChange({ office: { manual: 'out', responseTime: '  Within a day\u0007 ' }, rates: { caseCents: 180000, fullCents: null }, fullCap: 3 });
  const bad = [
    SS.cleanSettingsChange({ office: { manual: 'maybe' } }),
    SS.cleanSettingsChange({ rates: { caseCents: 10 } }),
    SS.cleanSettingsChange({ rates: { caseCents: 2_000_001 } }),
    SS.cleanSettingsChange({ rates: { caseCents: 1999.5 } }),
    SS.cleanSettingsChange({ fullCap: 100 }),
    SS.cleanSettingsChange({ fullCap: '3' }),
    SS.cleanSettingsChange({}),
    // RE-PINNED 2026-10-17 (v7.73): their chat line's month is one of their prices now (Priority Chat per contractor), so the
    // "nothing else" probe is a price that is his alone, the warning line.
    SS.cleanSettingsChange({ rates: { floorCents: 100000 } }),
  ];
  const chat = SS.cleanSettingsChange({ rates: { subCents: 6500 } });
  const chatOn = SS.cleanSettingsChange({ offers: { chat: true } }, { admin: true });
  const chatTheirs = SS.cleanSettingsChange({ offers: { chat: true } });
  // NEGATIVE CONTROL (run 2026-10-15): cleanSettingsChange letting a price under 50 cents through made this read
  //   FAIL  A1 a change is checked before it is kept: in, out or the office hours; a line of text, cleaned; prices from $0.50 to $20,000 in whole cents, or cleared; a limit from 0 to 99; nothing else, and nothing at all is refused
  check('A1 a change is checked before it is kept: in, out or the office hours; a line of text, cleaned; prices from $0.50 to $20,000 in whole cents, or cleared; a limit from 0 to 99; nothing else, and nothing at all is refused',
    !ok.error && ok.patch['settings.office.manual'] === 'out' && ok.patch['settings.office.responseTime'] === 'Within a day'
    && ok.patch['settings.rates.caseCents'] === 180000 && ok.patch['settings.rates.fullCents'] === null && ok.patch['settings.fullCap'] === 3
    && JSON.stringify(ok.mask) === JSON.stringify(['settings.office.manual', 'settings.office.responseTime', 'settings.rates.caseCents', 'settings.rates.fullCents', 'settings.fullCap'])
    && bad.every((b) => !!b.error)
    // NEGATIVE CONTROL (run 2026-10-17, v7.73): 'subCents' taken out of STAFF_RATE_KEYS made A1 read FAIL.
    && chat.patch?.['settings.rates.subCents'] === 6500 && chatOn.patch?.['settings.offers.chat'] === true && !!chatTheirs.error
    && JSON.stringify(SS.offersFrom({})) === '{"case":true,"full":true,"chat":false}',
    JSON.stringify({ ok, bad: bad.map((b) => b.error || 'LET THROUGH'), chat, chatOn, chatTheirs }));
  const read = SS.settingsFrom({ settings: { office: { manual: 'sideways', responseTime: 7 }, rates: { caseCents: 40, addonCents: 30000, fullCents: '440000', subCents: 9 }, fullCap: 2.5 } });
  // NEGATIVE CONTROL (run 2026-10-15): settingsFrom keeping any positive number as a price made this read
  //   FAIL  A2 a stored record is read as strictly as a change: junk reads as unset, never as a price or a limit
  check('A2 a stored record is read as strictly as a change: junk reads as unset, never as a price or a limit',
    read.office.manual === null && read.office.responseTime === null && JSON.stringify(read.rates) === '{"addonCents":30000}' && read.fullCap === null,
    JSON.stringify(read));
}

console.log('\n--- B. the route: theirs, and nobody else\'s ---');
{
  const w = world();
  seed(w);
  const before = JSON.stringify(w.docs.get('advocates/adv-b'));
  const set = await call(w, 'adv-a', 'POST', { office: { manual: 'in', responseTime: 'Same day' }, rates: { caseCents: 175000 }, fullCap: 2, uid: 'adv-b' });
  const again = await call(w, 'adv-a');
  const his = await call(w, ERIC);
  const client = await call(w, 'c1');
  const nobody = await call(w, '');
  const wrote = w.writes.map((x) => x.p);
  // NEGATIVE CONTROL (run 2026-10-15): the route writing `advocates/${body.uid || staff.uid}` made this read
  //   FAIL  B1 a contractor changes their own record and reads it back; a uid in the body changes nothing of anyone else's; he, a client and a stranger get the 404
  check('B1 a contractor changes their own record and reads it back; a uid in the body changes nothing of anyone else\'s; he, a client and a stranger get the 404',
    set.status === 200 && set.out?.office?.manual === 'in' && set.out?.office?.responseTime === 'Same day' && set.out?.rates?.caseCents === 175000 && set.out?.fullCap === 2
    && again.out?.rates?.caseCents === 175000 && set.out?.standard?.caseCents === 210000
    && wrote.every((p) => p === 'advocates/adv-a') && JSON.stringify(w.docs.get('advocates/adv-b')) === before
    && w.docs.get('advocates/adv-a')?.name === 'Ana Rivera'
    && his.status === 404 && client.status === 404 && nobody.status === 404,
    JSON.stringify({ set, wrote, his: his.status, client: client.status, nobody: nobody.status }));
  // NEGATIVE CONTROL (run 2026-10-15): the write sent without its mask made this read
  //   FAIL  B2 a change is a masked write of only what was asked: clearing one price leaves the others, and the rest of their record is untouched
  await call(w, 'adv-a', 'POST', { rates: { caseCents: null } });
  const last = w.writes[w.writes.length - 1];
  check('B2 a change is a masked write of only what was asked: clearing one price leaves the others, and the rest of their record is untouched',
    JSON.stringify(last.mask) === JSON.stringify(['settings.rates.caseCents', 'settings.updatedAt'])
    && w.docs.get('advocates/adv-a')?.settings?.office?.responseTime === 'Same day' && w.docs.get('advocates/adv-a')?.settings?.fullCap === 2
    && w.docs.get('advocates/adv-a')?.settings?.rates?.caseCents === null && w.docs.get('advocates/adv-a')?.active === true,
    JSON.stringify(last));
}

console.log('\n--- C. whose settings a case reads ---');
{
  const w = world();
  seed(w);
  const S = w.SS;
  const got = {
    his: await S.contractorSettings(ENV, ERIC),
    none: await S.contractorSettings(ENV, ''),
    off: await S.contractorSettings(ENV, 'adv-off'),
    ghost: await S.contractorSettings(ENV, 'nobody-here'),
    bad: await S.contractorSettings(ENV, '../users/x'),
    ben: await S.contractorSettings(ENV, 'adv-b'),
  };
  const whose = [S.contractorOf({}, ENV), S.contractorOf({ advocateId: ERIC }, ENV), S.contractorOf({ advocateId: 'adv-b' }, ENV)];
  // RE-PINNED 2026-10-17 (v7.73): their chat line's month lays over his too; his warning line never does.
  // NEGATIVE CONTROL (run 2026-10-17, v7.73): mergeRates laying every key over his made C1 read FAIL.
  const merged = S.mergeRates({ caseCents: 210000, addonCents: 32500, fullCents: 440000, subCents: 5000, floorCents: 7500 }, { rates: { caseCents: 150000, subCents: 6500, floorCents: 1 } });
  // NEGATIVE CONTROL (run 2026-10-15): contractorSettings answering for a turned-off record made this read
  //   FAIL  C1 a case with no advocate, or his, reads his settings; an active contractor's reads theirs; a turned-off, unknown or malformed one reads his; only their three prices lay over his
  check('C1 a case with no advocate, or his, reads his settings; an active contractor\'s reads theirs; a turned-off, unknown or malformed one reads his; only their four prices lay over his',
    got.his === null && got.none === null && got.off === null && got.ghost === null && got.bad === null && got.ben?.rates.caseCents === 150000
    && JSON.stringify(whose) === JSON.stringify(['', '', 'adv-b'])
    && merged.caseCents === 150000 && merged.subCents === 6500 && merged.addonCents === 32500 && merged.floorCents === 7500,
    JSON.stringify({ got, whose, merged }));
}

console.log('\n--- D. the Worker: each advocate\'s own limit, prices and door sign ---');
{
  const capSrc = lift(W, 'async function fullAccessCapacity(env, contractor = \'\') {');
  const run = async (contractor, { rows, cfg = null, own = null }) => new Function('queryDocs', 'getDoc', 'contractorOf', 'contractorSettings', 'FULL_CAP_PATH', 'FULL_MAX_OPEN_DEFAULT',
    `${capSrc}\nreturn fullAccessCapacity;`)(
    async () => rows, async () => cfg, (data, env) => world().SS.contractorOf(data, env), async () => own, 'config/fullAccess', 2)(ENV, contractor);
  const rows = [
    { id: 'e1', data: { fullAccess: true, status: 'confirmed' } },
    { id: 'e2', data: { fullAccess: true, status: 'confirmed', advocateId: ERIC } },
    { id: 'e3', data: { fullAccess: true, status: 'confirmed', self: true } },
    { id: 'b1', data: { fullAccess: true, status: 'confirmed', advocateId: 'adv-b' } },
    { id: 'b2', data: { fullAccess: true, status: 'confirmed', advocateId: 'adv-b' } },
    { id: 'b3', data: { fullAccess: true, status: 'confirmed', advocateId: 'adv-b' } },
  ];
  const his = await run('', { rows, cfg: { data: { maxOpen: 3, setByHand: true } } });
  const ben = await run('adv-b', { rows, own: { fullCap: 3 } });
  const benFree = await run('adv-b', { rows, own: { fullCap: null } });
  // NEGATIVE CONTROL (run 2026-10-15): fullAccessCapacity's `&& whose(r)` taken off the first query made this read
  //   FAIL  D1 his limit counts his Full-Service clients and a contractor's counts theirs, against their own number; theirs unset is no limit
  check('D1 his limit counts his Full-Service clients and a contractor\'s counts theirs, against their own number; theirs unset is no limit',
    !!capSrc && his.open === 2 && his.max === 3 && his.room === true && ben.open === 3 && ben.max === 3 && ben.room === false
    && benFree.max === 0 && benFree.room === true,
    JSON.stringify({ his, ben, benFree }));
  const ratchets = (W.match(/await raiseRates\(env\)/g) || []).length;
  // NEGATIVE CONTROL (run 2026-10-15): createCaseFromSession's `raiseRatesFor(env, { advocateId })` put back to `raiseRates(env)` made this read
  //   FAIL  D2 a contractor's sale is priced on their own list and never climbs his: booking, the upgrade request, its approval, and every ratchet ask whose case it is
  check('D2 a contractor\'s sale is priced on their own list and never climbs his: booking, the upgrade request, its approval, and every ratchet ask whose case it is',
    /const rateAtBooking = await ratesForCase\(env, \{ advocateId \}\);/.test(W)
    && /const live = await ratesForCase\(env, c\.data\);\n\s+const req = \{\n\s+state: 'pending',/.test(W)
    && /upgradeCents\(c\.data, \(await ratesForCase\(env, c\.data\)\)\.fullCents\)/.test(W)
    // RE-PINNED 2026-10-17 (v7.65): a third ask on the case's own advocate's limit, accepting a Full-Service month booked from chat.
    // NEGATIVE CONTROL (run 2026-10-17, v7.65): that ask's contractorOf(c.data, env) made '' made D2 read FAIL.
    && (W.match(/fullAccessCapacity\(env, contractorOf\(c\.data, env\)\)/g) || []).length === 3
    && ratchets === 1 && /async function raiseRatesFor\(env, data\) \{\n\s+if \(contractorOf\(data, env\)\) return;\n\s+await raiseRates\(env\);/.test(W)
    && (W.match(/raiseRatesFor\(env, /g) || []).length === 5,
    `bare ratchets: ${ratchets}`);
  // NEGATIVE CONTROL (run 2026-10-15): handleAvailability reading readOfficeHours whatever the address says made this read
  //   FAIL  D3 /api/availability and /api/rates take ?advocate=: a contractor's door sign and prices for their clients, his for anything else, the same two keys on the door sign
  check('D3 /api/availability and /api/rates take ?advocate=: a contractor\'s door sign and prices for their clients, his for anything else, the same two keys on the door sign',
    /return await handleAvailability\(env, url\);/.test(W) && /return await handleRates\(env, url\);/.test(W)
    && /const \{ manual, responseTime \} = own \? own\.office : await readOfficeHours\(env\);/.test(W)
    && /const r = own \? mergeRates\(base, own\) : base;/.test(W)
    && /return json\(\{\n\s+inOffice: state\.inOffice,\n\s+responseTime,\n\s+\}\);/.test(lift(W, 'async function handleAvailability(env, url) {'))
    // RE-PINNED 2026-10-17 (v7.74): the route also hands it the way to tell him when they ask for a service of their own.
    // NEGATIVE CONTROL (run 2026-10-17, v7.74): `, tellEric: pingAdmins` taken out of the route made D3 read FAIL.
    && /if \(url\.pathname === '\/api\/staff\/settings'\)\n\s+return await handleStaffSettings\(request, env, \{ requireStaff, json, readRates, officeStatus, tellEric: pingAdmins \}\);/.test(W)
    && W.indexOf("url.pathname === '/api/staff/settings'") < W.indexOf("url.pathname.startsWith('/api/staff/') || url.pathname.startsWith('/api/advocates/')"));
  // NEGATIVE CONTROL (run 2026-10-15): the upgrade request's ping put back on every admin made this read
  //   FAIL  D4 a Full-Service request pings the case's own advocate, not every admin
  check('D4 a Full-Service request pings the case\'s own advocate, not every admin',
    /await notifyUser\(env, advocateIdOf\(c\.data, env\), \{\n\s+title: 'Pocket Advocate',[\s\S]{0,400}?is asking for Full-Service\./.test(W)
    && !/queryDocs\(env, 'users', \[\['role', 'EQUAL', 'admin'\]\], 5\)[\s\S]{0,300}?is asking for Full-Service/.test(W));
}

console.log('\n--- E. the pages ---');
{
  // office.js run in a stand-in browser: the address it asks, and an answer for an advocate it has moved off dropped.
  const asked = [];
  let release = null;
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  globalThis.fetch = (url) => { asked.push(url); return new Promise((res) => { release = (body) => res({ ok: true, json: async () => body }); }); };
  const OFFICE = await import(pathToFileURL(j(ROOT, 'public/js/office.js')).href + `?t=${Date.now()}`);
  OFFICE.officeFor('adv-b');
  const first = release;
  OFFICE.officeFor('');
  const second = release;
  first({ inOffice: false, responseTime: 'Theirs' });
  await new Promise((r) => setTimeout(r, 10));
  const afterStale = OFFICE.officeNow();
  second({ inOffice: true, responseTime: null });
  await new Promise((r) => setTimeout(r, 10));
  const afterHis = OFFICE.officeNow();
  OFFICE.officeFor('../x');
  // NEGATIVE CONTROL (run 2026-10-15): readOffice applying an answer for an advocate the page had moved off made this read
  //   FAIL  E1 a client's door sign asks for their case's advocate, his when there is none, and an answer about someone the page moved off is dropped
  check('E1 a client\'s door sign asks for their case\'s advocate, his when there is none, and an answer about someone the page moved off is dropped',
    asked[0] === '/api/availability?advocate=adv-b' && asked[1] === '/api/availability' && afterStale === null && afterHis?.inOffice === true
    && asked.length === 2,
    JSON.stringify({ asked, afterStale, afterHis }));
  const CASE = f('public/js/case.js');
  const CHATP = f('public/js/chat-page.js');
  const SET = f('public/js/settings.js');
  const AUTH = f('public/js/auth.js');
  const ADM = f('public/js/admin.js');
  const INV = f('public/js/admin-invites.js');
  // NEGATIVE CONTROL (run 2026-10-15): renderAddons' `readCaseRates(c.advocateId);` taken out made this read
  //   FAIL  E2 their client's page reads their prices and door sign, the chat tab follows the open thread, and their invitations start at their own price
  check('E2 their client\'s page reads their prices and door sign, the chat tab follows the open thread, and their invitations start at their own price',
    /function renderAddons\(el, c\) \{\n\s+readCaseRates\(c\.advocateId\);/.test(CASE) && /officeFor\(c\.advocateId\);\n\s+el\.innerHTML = `\n\s+<h2 class="case-sec-h">Chat<\/h2>/.test(CASE)
    && /fetch\(`\/api\/rates\$\{who \? `\?advocate=\$\{encodeURIComponent\(who\)\}` : ''\}`\)/.test(CASE) && /if \(who !== ratesWho\) return;/.test(CASE)
    && !/^const ratesReady = fetch\('\/api\/rates'\)/m.test(CASE)
    // RE-PINNED 2026-10-16 (v7.56): the open thread also asks its advocate's first name (for the header and the
    // search) before it reads their door sign; the door sign still follows the thread.
    // NEGATIVE CONTROL (run 2026-10-16, v7.56): open()'s `officeFor(t.advocateId || '')` made `officeFor('')` made E2 read FAIL.
    && /advocateId: c\.advocateId \|\| '',/.test(CHATP) && /const t = threads\.find\(\(x\) => x\.key === current\);\n\s+advocateFirstName\(t\.advocateId\)[^\n]*\n\s+officeFor\(t\.advocateId \|\| ''\);/.test(CHATP)
    && /ratesPath: advocate \? `\/api\/rates\?advocate=\$\{encodeURIComponent\(user\.uid\)\}` : '\/api\/rates',/.test(ADM) && /fetch\(ratesPath\)/.test(INV));
  // NEGATIVE CONTROL (run 2026-10-15): settings.js giving the contractor rows to everyone who is not him made this read
  //   FAIL  E3 the cog gives a contractor their own rows and only them: he keeps his, a client gets neither
  check('E3 the cog gives a contractor their own rows and only them: he keeps his, a client gets neither',
    /\$\{isAdmin \? '<div data-admin-rows><\/div>' : isContractor \? '<div data-staff-rows><\/div>' : ''\}/.test(SET)
    && /import\('\.\/admin-staffsettings\.js'\)/.test(SET) && /m\.initSettings\(user, admin, role === 'advocate'\)/.test(AUTH)
    && /fetch\('\/api\/staff\/settings', \{/.test(f('public/js/admin-staffsettings.js')));
  const DEMO = f('public/js/demo/api.js');
  // NEGATIVE CONTROL (run 2026-10-15): the demo's /api/staff/settings route taken out made this read
  //   FAIL  E4 the demo mirrors it: Ana's settings save and read back, and her client's door sign and prices follow them
  check('E4 the demo mirrors it: Ana\'s settings save and read back, and her client\'s door sign and prices follow them',
    // RE-PINNED 2026-10-16 (v7.56, caught at v7.57): the demo refuses an advocate still setting up here too, as the
    // Worker's requireStaff does.
    // NEGATIVE CONTROL (run 2026-10-16, v7.57): the demo route's `|| !staff` taken out made E4 read FAIL.
    /if \(path === '\/api\/staff\/settings'\) \{\n\s+\/\/ Setup first, as the Worker's requireStaff \(2026-10-16\)\.\n\s+if \(role !== 'advocate' \|\| !staff\) return fail\(404, 'Not found'\);/.test(DEMO)
    && /const own = demoContractor\(q\.get\('advocate'\)\);/.test(DEMO) && /const own = path === '\/api\/availability' \? demoContractor\(q\.get\('advocate'\)\) : null;/.test(DEMO));
  // NEGATIVE CONTROL (run 2026-10-15): an em dash put in staffsettings.js made this read
  //   FAIL  E5 the new files carry no dash
  check('E5 the new files carry no dash', !DASH.test(f('worker/staffsettings.js')) && !DASH.test(f('public/js/admin-staffsettings.js')));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
