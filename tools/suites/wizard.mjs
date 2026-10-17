// wizard.mjs - adding an advocate page by page, and everything those pages set (v7.68).
//
// Eric, 2026-10-17: "When I add an advocate, it should go page by page through everything I asked I could toggle on
// or off, their pricing, their initial schedule, profile picture, bio, any extra tiers or add-ons and their pricing,
// their pay preferences and if ACH their routing # and account # (assuming this is encrypted enough for that info to
// be safe) etc"
//
//   W1 adding them carries every page: what they offer, prices, limit, week, reply line, words, share, add-ons, pay
//   W2 a refusal on any page leaves nothing behind: no address claimed, no record, no sign-in
//   W3 the bank numbers are sealed: only the method and the last four are in the clear, and they open only for him
//   W4 his pages open again with everything, and never a sealed detail
//   W5 a change writes only what changed; his own card takes no prices, week or pay; nobody else may ask
//   W6 only he switches what they offer: their own settings cannot
//   W7 Full-Service off is never room, at every door; Advocacy Case off sends no invitation of theirs
//   W8 their week: checked, kept on their clock, and their light follows it; a hand set in or out still wins
//   W9 his own extras: named and priced, checked, asked for, answered and paid under their own name
//   W10 the client asks for one of his extras on their case, and it is an offer that closes with sales
//   W11 the pages themselves: seven in order, four on his own card, back always open, forward only past a good page
//   W12 their own settings carry their week, and the demo answers the way the Worker does
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
const STAFF = await import(pathToFileURL(join(ROOT, 'worker/staff.js')).href);
const ADDONS = await import(pathToFileURL(join(ROOT, 'worker/addons.js')).href);
const SS = await import(pathToFileURL(join(ROOT, 'worker/staffsettings.js')).href);
const PAY = await import(pathToFileURL(join(ROOT, 'worker/payroll.js')).href);
const SCHED = await import(pathToFileURL(join(ROOT, 'worker/schedule.js')).href);
const strip = (src) => src.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function) /gm, '$1 ');

const ERIC = 'eric-uid';
const env = { ADMIN_UID: ERIC, ADMIN_EMAIL: 'eric@x.test', PUBLIC_BASE_URL: 'https://app.test', PAYOUT_KEY: 'test-payout-key' };

// ---- worker/advocates.js, whole, against a stand-in store --------------------------------
const world = () => {
  const docs = new Map();
  const mails = [];
  const deps = {
    getDoc: async (e, p) => (docs.has(p) ? { id: p.split('/').pop(), data: JSON.parse(JSON.stringify(docs.get(p))), updateTime: 't' } : null),
    patchDoc: async (e, p, data, opts = {}) => {
      if (opts.mustNotExist && docs.has(p)) return null;
      const cur = docs.get(p) || {};
      // A dotted mask writes only its own paths, as Firestore does.
      if (opts.mask && opts.mask.some((m) => m.includes('.'))) {
        const next = JSON.parse(JSON.stringify(cur));
        for (const m of opts.mask) {
          const keys = m.split('.');
          let src = data; for (const k of keys) src = src?.[k];
          let at = next; keys.slice(0, -1).forEach((k) => { at[k] = at[k] && typeof at[k] === 'object' ? at[k] : {}; at = at[k]; });
          at[keys.at(-1)] = src === undefined ? null : JSON.parse(JSON.stringify(src));
        }
        docs.set(p, next);
      } else docs.set(p, JSON.parse(JSON.stringify({ ...(opts.mask ? cur : {}), ...data })));
      return true;
    },
    deleteDoc: async (e, p) => { docs.delete(p); return true; },
    queryDocs: async (e, coll, filters) => [...docs.entries()].filter(([k, v]) => k.startsWith(`${coll}/`) && filters.every(([fld, , val]) => v[fld] === val)).map(([k, v]) => ({ id: k.split('/')[1], data: v })),
    listDocs: async (e, coll) => [...docs.entries()].filter(([k]) => k.startsWith(`${coll}/`) && k.split('/').length === 2).map(([k, v]) => ({ id: k.split('/')[1], data: v })),
    putFile: async () => ({}), deleteFile: async () => {}, mediaFetch: async () => ({ ok: false }),
    sendEmail: async (e, m) => { mails.push(m); return true; },
    notifyUser: async () => {},
    ...STAFF,
    addonsOf: ADDONS.addonsOf, cleanAddons: ADDONS.cleanAddons,
    cleanSettingsChange: SS.cleanSettingsChange, settingsFrom: SS.settingsFrom, nest: SS.nest,
    cleanPayout: PAY.cleanPayout, sealPayout: PAY.sealPayout, PAYOUT_METHODS: PAY.PAYOUT_METHODS,
  };
  const api = new Function(...Object.keys(deps), `${strip(f('worker/advocates.js'))}\nreturn { handleAdvocates, loginPath };`)(...Object.values(deps));
  docs.set(`users/${ERIC}`, { role: 'admin' });
  docs.set(`advocates/${ERIC}`, { uid: ERIC, name: 'Eric Leach', email: 'eric@x.test', active: true, owner: true, commissionPct: 100 });
  return { docs, mails, api };
};
const h = (w) => ({
  json: (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } }),
  requireAdmin: async (req) => (req.headers.get('x-uid') === ERIC ? { uid: ERIC, email: 'eric@x.test' } : null),
  requireStaff: async () => null,
  mintCustomToken: async () => 't', issueDeviceToken: async () => 'd',
});
const call = async (w, json, uid = ERIC) => {
  const headers = new Headers();
  if (uid) headers.set('x-uid', uid);
  const url = new URL('https://app.test/api/admin/advocates');
  const res = await w.api.handleAdvocates({ method: 'POST', headers, url: url.href, json: async () => json }, env, url, h(w));
  let out = null; try { out = await res.json(); } catch { out = null; }
  return { status: res.status, out };
};
const HOURS = { mon: { from: '09:00', to: '17:00' }, tue: { from: '09:00', to: '17:00' }, wed: null, thu: { from: '10:00', to: '14:30' }, fri: null, sat: null, sun: null };
const FULL = {
  action: 'create', name: 'Ana Rivera', email: 'ana@x.test', password: 'given-password-1', commissionPct: 55,
  profile: { credentials: 'RN, BCPA', bio: 'Twelve years on a neuro floor.', primarySpecialty: STAFF.SPECIALTIES[0], specialties: [STAFF.SPECIALTIES[0]], tz: 'America/New_York' },
  settings: { offers: { case: true, full: false }, rates: { caseCents: 190000, addonCents: null, fullCents: 380000 }, fullCap: 3, hours: HOURS, office: { responseTime: 'I reply within a day' } },
  addons: { attend: { on: true, cents: 40000 }, appeal: { on: false, cents: 0 }, custom: [{ on: true, label: 'Medicare paperwork', cents: 15000 }] },
  payout: { method: 'ach', fields: { name: 'Ana Rivera', routing: '021000021', account: '123456789', type: 'checking' } },
};

console.log('\n--- adding them ---');
const w = world();
const made = await call(w, FULL);
const uid = made.out?.uid;
const rec = w.docs.get(`advocates/${uid}`) || {};
const pay = w.docs.get(`payouts/${uid}`) || {};
{
  // NEGATIVE CONTROL (run 2026-10-17): the create's `...(extra.settings ? { settings: ... } : {})` taken out made this read
  //   FAIL  W1 adding them carries every page: what they offer, prices, limit, week, reply line, words, share, add-ons, pay
  check('W1 adding them carries every page: what they offer, prices, limit, week, reply line, words, share, add-ons, pay',
    made.status === 200 && rec.settings?.offers?.case === true && rec.settings.offers.full === false
    && rec.settings.rates.caseCents === 190000 && rec.settings.rates.fullCents === 380000 && rec.settings.rates.addonCents === null
    && rec.settings.fullCap === 3 && JSON.stringify(rec.settings.hours) === JSON.stringify(HOURS) && rec.settings.office.responseTime === 'I reply within a day'
    && rec.credentials === 'RN, BCPA' && rec.bio === 'Twelve years on a neuro floor.' && rec.primarySpecialty === STAFF.SPECIALTIES[0] && rec.tz === 'America/New_York'
    && rec.commissionPct === 55 && rec.addons.attend.on && rec.addons.attend.cents === 40000 && !rec.addons.appeal.on
    && rec.addons.custom.length === 1 && rec.addons.custom[0].label === 'Medicare paperwork' && /^x[a-z0-9]{8}$/.test(rec.addons.custom[0].id)
    && pay.method === 'ach' && pay.hint === 'Checking ending 6789' && pay.setBy === ERIC && made.out.payout?.hint === 'Checking ending 6789'
    && rec.mustChange === true && w.docs.get(`users/${uid}`)?.setupPending === true,
    JSON.stringify({ status: made.status, out: made.out, settings: rec.settings }));

  const bads = [
    { ...FULL, email: 'b1@x.test', settings: { ...FULL.settings, rates: { caseCents: 10 } } },
    { ...FULL, email: 'b2@x.test', settings: { ...FULL.settings, hours: { mon: { from: '17:00', to: '09:00' } } } },
    { ...FULL, email: 'b3@x.test', payout: { method: 'ach', fields: { name: 'Ana', routing: '02100002', account: '1234' } } },
    { ...FULL, email: 'b4@x.test', commissionPct: 101 },
    { ...FULL, email: 'b5@x.test', addons: { ...FULL.addons, custom: [{ on: true, label: '', cents: 100 }] } },
    { ...FULL, email: 'b6@x.test', settings: { ...FULL.settings, fullCap: 120 } },
  ];
  const outs = [];
  for (const b of bads) outs.push(await call(w, b));
  const left = [...w.docs.keys()].filter((k) => /^staffSecrets\//.test(k)).length;
  const madeOnly = [...w.docs.keys()].filter((k) => /^advocates\//.test(k)).length;
  // NEGATIVE CONTROL (run 2026-10-17): cleanSetup's payout refusal (`if (got.error) return { error: got.error };`) made `return out;` made this read
  //   FAIL  W2 a refusal on any page leaves nothing behind: no address claimed, no record, no sign-in
  check('W2 a refusal on any page leaves nothing behind: no address claimed, no record, no sign-in',
    outs.every((o) => o.status === 400 && o.out?.error) && left === 1 && madeOnly === 2
    && /a price from \$0\.50/i.test(outs[0].out.error) && /ends after it starts/.test(outs[1].out.error) && /9 digit routing/.test(outs[2].out.error),
    JSON.stringify({ statuses: outs.map((o) => o.status), errors: outs.map((o) => o.out?.error), left, madeOnly }));

  const everywhere = JSON.stringify([...w.docs.entries()]) + JSON.stringify(w.mails) + JSON.stringify(made.out);
  const opened = await PAY.openPayout(env, pay.sealed);
  // Sealed with a fresh nonce every time, so the same numbers never read the same twice; and a tampered copy opens to nothing.
  const twice = [await PAY.sealPayout(env, opened || {}), await PAY.sealPayout(env, opened || {})];
  const [iv, ct] = String(pay.sealed).split('.');
  const tampered = await PAY.openPayout(env, `${iv}.${ct.slice(0, -4)}AAAA`);
  // NEGATIVE CONTROL (run 2026-10-17): writePayout storing `details: got.details` beside the sealed copy made this read
  //   FAIL  W3 the bank numbers are sealed: only the method and the last four are in the clear, and they open only for him
  check('W3 the bank numbers are sealed: only the method and the last four are in the clear, and they open only for him',
    !everywhere.includes('021000021') && !everywhere.includes('123456789') && typeof pay.sealed === 'string' && pay.sealed.split('.').length === 2
    && opened?.routing === '021000021' && opened?.account === '123456789' && opened?.name === 'Ana Rivera'
    && twice[0] !== twice[1] && tampered === null
    && Object.keys(pay).sort().join() === 'hint,method,sealed,setBy,updatedAt',
    JSON.stringify({ keys: Object.keys(pay), opened: !!opened, tampered }));
}

console.log('\n--- opening them again ---');
{
  const got = await call(w, { action: 'get', uid });
  const text = JSON.stringify(got.out || {});
  // NEGATIVE CONTROL (run 2026-10-17): the get's payout answering `...p.data` made this read
  //   FAIL  W4 his pages open again with everything, and never a sealed detail
  check('W4 his pages open again with everything, and never a sealed detail',
    got.status === 200 && got.out.settings?.offers?.full === false && got.out.settings.rates.caseCents === 190000 && got.out.settings.fullCap === 3
    && JSON.stringify(got.out.settings.hours) === JSON.stringify(HOURS) && got.out.addons?.custom?.[0]?.label === 'Medicare paperwork'
    && got.out.payout?.method === 'ach' && got.out.payout.hint === 'Checking ending 6789' && got.out.advocate?.credentials === 'RN, BCPA'
    && !/sealed|021000021|123456789/.test(text) && Array.isArray(got.out.zones) && got.out.methods?.ach,
    text.slice(0, 300));

  // Their own hand on the door sign, set before his change: it must survive.
  const r0 = w.docs.get(`advocates/${uid}`);
  w.docs.set(`advocates/${uid}`, { ...r0, settings: { ...r0.settings, office: { ...r0.settings.office, manual: 'out' } } });
  const changed = await call(w, { action: 'update', uid, settings: { offers: { full: true }, rates: { fullCents: 400000 } }, payout: { method: 'zelle', fields: { name: 'Ana', handle: 'ana@zelle.test' } } });
  const r1 = w.docs.get(`advocates/${uid}`);
  const p1 = w.docs.get(`payouts/${uid}`);
  const ownSettings = await call(w, { action: 'update', uid: ERIC, settings: { fullCap: 2 } });
  const ownPay = await call(w, { action: 'update', uid: ERIC, payout: { method: 'zelle', fields: { name: 'E', handle: 'e@x.test' } } });
  const notHim = await call(w, { action: 'update', uid, settings: { fullCap: 9 } }, 'adv-b');
  const payOnly = await call(w, { action: 'update', uid, payout: { method: 'check', fields: { name: 'Ana Rivera', address: '12 Elm St, Boise ID 83702' } } });
  // NEGATIVE CONTROL (run 2026-10-17): cleanSetup's owner guard (`if (owner) return { error: 'Your own prices and hours are in your settings.' };`) taken out made this read
  //   FAIL  W5 a change writes only what changed; his own card takes no prices, week or pay; nobody else may ask
  check('W5 a change writes only what changed; his own card takes no prices, week or pay; nobody else may ask',
    changed.status === 200 && r1.settings.offers.full === true && r1.settings.offers.case === true && r1.settings.rates.fullCents === 400000
    && r1.settings.rates.caseCents === 190000 && r1.settings.office.manual === 'out' && r1.settings.fullCap === 3
    && p1.method === 'zelle' && /^Zelle to an…st$/.test(p1.hint) && ownSettings.status === 400 && ownPay.status === 400 && notHim.status === 404
    && payOnly.status === 200 && w.docs.get(`payouts/${uid}`).method === 'check',
    JSON.stringify({ changed: changed.status, settings: r1.settings, hint: p1.hint, ownSettings: ownSettings.status, ownPay: ownPay.status, notHim: notHim.status, payOnly: payOnly.status }));
}

console.log('\n--- what they offer ---');
{
  const theirs = SS.cleanSettingsChange({ offers: { full: false } });
  const his = SS.cleanSettingsChange({ offers: { full: false } }, { admin: true });
  const SSRC = f('worker/staffsettings.js');
  // NEGATIVE CONTROL (run 2026-10-17): cleanSettingsChange's `if (!admin) return { error: 'What you offer is set by Eric.' };` taken out made this read
  //   FAIL  W6 only he switches what they offer: their own settings cannot
  check('W6 only he switches what they offer: their own settings cannot',
    /set by Eric/.test(theirs.error || '') && his.patch?.['settings.offers.full'] === false && his.mask.join() === 'settings.offers.full'
    && /const got = cleanSettingsChange\(body\);/.test(SSRC) && SS.offersFrom(undefined).case === true && SS.offersFrom({ full: false }).full === false);

  const W = f('worker/index.js');
  const cap = (W.match(/async function fullAccessCapacity\(env, contractor = ''\) \{[\s\S]*?\n\}/) || [''])[0];
  const run = new Function('queryDocs', 'contractorOf', 'contractorSettings', 'getDoc', 'FULL_CAP_PATH', 'FULL_MAX_OPEN_DEFAULT', `${cap}\nreturn fullAccessCapacity;`)(
    async () => [], () => 'ana', async (e, u) => (u === 'ana' ? { fullCap: 0, offers: { full: false, case: true } } : null), async () => null, 'config/fullAccess', 2);
  const off = await run({}, 'ana');
  const invite = (W.match(/async function handleLeadInvite\(request, env\) \{[\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17): fullAccessCapacity's `if (own?.offers?.full === false) return` line taken out made this read
  //   FAIL  W7 Full-Service off is never room, at every door; Advocacy Case off sends no invitation of theirs
  check('W7 Full-Service off is never room, at every door; Advocacy Case off sends no invitation of theirs',
    off.room === false && off.off === true
    && /if \(!staff\.isAdmin && \(await contractorSettings\(env, staff\.uid\)\.catch\(\(\) => null\)\)\?\.offers\?\.case === false\)\n\s+return json\(\{ error: 'Advocacy Cases are turned off for you\. Ask Eric to turn them on\.' \}, 409\);/.test(invite)
    && invite.indexOf('offers?.case === false') < invite.indexOf("patchDoc(env, `invites/${id}`"),
    JSON.stringify(off));
}

console.log('\n--- their week ---');
{
  const ok = SS.cleanHours(HOURS);
  const bad = [SS.cleanHours({ mon: { from: '9:00', to: '17:00' } }), SS.cleanHours({ mon: { from: '17:00', to: '17:00' } }), SS.cleanHours('weekdays')];
  const kept = SS.hoursFrom({ mon: { from: '08:00', to: '12:00' }, tue: { from: 'x', to: 'y' } });
  // Monday 2026-10-19: 13:30 UTC is 09:30 in New York and 07:30 in Boise.
  const mon = new Date('2026-10-19T13:30:00Z');
  const ny = SCHED.openByHours(HOURS, 'America/New_York', mon);
  const boise = SCHED.openByHours(HOURS, 'America/Boise', mon);
  const atEnd = SCHED.openByHours(HOURS, 'America/New_York', new Date('2026-10-19T21:00:00Z'));
  const atStart = SCHED.openByHours(HOURS, 'America/New_York', new Date('2026-10-19T13:00:00Z'));
  const dayOff = SCHED.openByHours(HOURS, 'America/New_York', new Date('2026-10-21T15:00:00Z'));
  const badZone = SCHED.openByHours(HOURS, 'Mars/Olympus', mon);
  const follows = SCHED.officeStatus(null, mon, { hours: HOURS, tz: 'America/New_York' });
  const handOut = SCHED.officeStatus('out', mon, { hours: HOURS, tz: 'America/New_York' });
  const W = f('worker/index.js');
  // NEGATIVE CONTROL (run 2026-10-17): openByHours's `at < mins(span.to)` made `at <= mins(span.to)` made this read
  //   FAIL  W8 their week: checked, kept on their clock, and their light follows it; a hand set in or out still wins
  check('W8 their week: checked, kept on their clock, and their light follows it; a hand set in or out still wins',
    !ok.error && bad.every((b) => b.error) && SS.cleanHours(null).value === null && kept.mon.to === '12:00' && kept.tue === null && SS.hoursFrom({}) === null
    && ny === true && boise === false && atEnd === false && atStart === true && dayOff === false && typeof badZone === 'boolean'
    && follows.inOffice === true && handOut.inOffice === false
    && /const state = officeStatus\(manual, new Date\(\), own\?\.hours \? \{ hours: own\.hours, tz: own\.tz \} : null\);/.test(W),
    JSON.stringify({ ny, boise, atEnd, atStart, dayOff, follows: follows.inOffice, handOut: handOut.inOffice }));
}

console.log('\n--- his own extras ---');
{
  const six = Array.from({ length: 7 }, (_, i) => ({ on: true, label: `Extra ${i + 1}`, cents: 1000 }));
  const errs = [
    ADDONS.cleanAddons({ custom: six }), ADDONS.cleanAddons({ custom: [{ on: true, label: 'A', cents: 1000 }] }),
    ADDONS.cleanAddons({ custom: [{ on: true, label: 'Forms', cents: 49 }] }), ADDONS.cleanAddons({ custom: [{ on: true, label: 'Forms', cents: 100 }, { on: false, label: 'forms', cents: 0 }] }),
  ];
  const kept = ADDONS.cleanAddons({ custom: [{ id: 'xabcdefgh', on: true, label: '  Medicare   paperwork ', cents: 15000 }, { on: false, label: '', cents: 0 }] });
  const read = ADDONS.addonsOf({ addons: { custom: [{ id: 'xabcdefgh', label: 'Forms', on: true, cents: 100 }, { id: 'bad id', label: 'Nope', on: true, cents: 1 }] } });

  const SRC = strip(f('worker/addons.js'));
  const docs = new Map();
  const calls = { stripe: [], pings: [], pushes: [] };
  const mod = new Function('getDoc', 'patchDoc', `${SRC}\nreturn { handleAddonRequest, handleAddonDecision, confirmAddonPurchase };`)(
    async (e, p) => (docs.has(p) ? { data: docs.get(p), updateTime: 't' } : null),
    async (e, p, fields) => { docs.set(p, { ...(docs.get(p) || {}), ...fields }); return true; });
  const req = (body) => ({ json: async () => body });
  const json = (o, s = 200) => ({ status: s, body: o });
  const hU = { requireUser: async () => ({ uid: 'kim' }), json, pingCase: async (e, c, t) => calls.pings.push(t), advocateIdOf: (c) => c.advocateId || ERIC };
  const hS = { requireStaff: async () => ({ uid: 'ana', isAdmin: false }), staffSees: () => true, json, notifyUser: async (e, u, m) => calls.pushes.push(m), stripePost: async (e, p, b) => { calls.stripe.push(b); return { id: 'cs_x', url: 'https://pay.test/x' }; }, confirm: async () => {}, baseUrl: 'https://app.test' };
  docs.set('advocates/ana', { active: true, addons: { attend: { on: false, cents: 0 }, appeal: { on: false, cents: 0 }, custom: [{ id: 'xabcdefgh', label: 'Medicare paperwork', on: true, cents: 15000 }, { id: 'xoffoffof', label: 'Off one', on: false, cents: 100 }] } });
  docs.set('cases/c1', { clientUid: 'kim', clientName: 'Kim Lee', fullAccess: true, status: 'confirmed', advocateId: 'ana' });
  const unknown = await mod.handleAddonRequest(req({ caseId: 'c1', kind: 'xzzzzzzzz' }), env, hU);
  const off = await mod.handleAddonRequest(req({ caseId: 'c1', kind: 'xoffoffof' }), env, hU);
  const asked = await mod.handleAddonRequest(req({ caseId: 'c1', kind: 'xabcdefgh', note: 'The yearly forms' }), env, hU);
  const pend = docs.get('cases/c1').addonRequest;
  const yes = await mod.handleAddonDecision(req({ caseId: 'c1', decision: 'approve' }), env, hS);
  await mod.confirmAddonPurchase(env, { id: 'cs_x', amount_total: 15000, metadata: { kind: 'addon', caseId: 'c1', addon: 'xabcdefgh', label: 'Medicare paperwork' } }, { pingCase: async () => {} });
  const paid = docs.get('cases/c1');
  // NEGATIVE CONTROL (run 2026-10-17): the request's `label: offered.label,` taken out made this read
  //   FAIL  W9 his own extras: named and priced, checked, asked for, answered and paid under their own name
  check('W9 his own extras: named and priced, checked, asked for, answered and paid under their own name',
    errs.every((e) => e.error) && !kept.error && kept.value.custom.length === 1 && kept.value.custom[0].id === 'xabcdefgh' && kept.value.custom[0].label === 'Medicare paperwork'
    && read.custom.length === 1 && read.custom[0].label === 'Forms'
    && unknown.status === 400 && off.status === 409 && asked.status === 200 && asked.body.cents === 15000
    && pend.label === 'Medicare paperwork' && pend.kind === 'xabcdefgh' && calls.pings.some((t) => /asking for Medicare paperwork\./.test(t))
    && yes.status === 200 && calls.stripe[0]?.line_items?.[0]?.price_data?.product_data?.name === 'Medicare paperwork' && calls.stripe[0]?.metadata?.label === 'Medicare paperwork'
    && calls.pushes.some((m) => /said yes to Medicare paperwork\./.test(m.body))
    && paid.addonsBought?.[0]?.label === 'Medicare paperwork' && paid.addonsBought[0].kind === 'xabcdefgh' && paid.extraPayments?.[0]?.label === 'Medicare paperwork',
    JSON.stringify({ errs: errs.map((e) => e.error), unknown: unknown.status, off: off.status, asked: asked.body, pend, stripe: calls.stripe[0]?.line_items?.[0]?.price_data?.product_data }));
}

console.log('\n--- the client\'s side ---');
{
  const CASE = f('public/js/case.js');
  const card = (CASE.match(/function customCard\(c, id\) \{[\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17): customCard's `if (c.status === 'closed' || !offer?.on) return` line taken out made this read
  //   FAIL  W10 the client asks for one of his extras on their case, and it is an offer that closes with sales
  check('W10 the client asks for one of his extras on their case, and it is an offer that closes with sales',
    ['approved', 'pending', 'declined', 'offer', 'done'].every((s) => card.includes(`data-custom-state="${s}"`))
    && /if \(!c\.fullAccess\) return '';/.test(card) && /if \(c\.status === 'closed' \|\| !offer\?\.on\) return done/.test(card)
    && /<h3>\$\{esc\(name\)\}<\/h3>/.test(card) && /const out = await post\(\{ kind: id, note:/.test(CASE)
    && /\[data-request-custom\],\[data-custom-again\]'/.test(CASE) && /<div data-customs><\/div>/.test(CASE)
    && /if \(c\.fullAccess\) for \(const x of \(caseAddonsNow\?\.custom \|\| \[\]\)\) if \(x\.on\) add\(x\.id\);/.test(CASE)
    && /esc\(c\.addonRequest\.label \|\| 'An enhancement'\)/.test(f('public/js/admin-case.js')),
    'card shape');
}

console.log('\n--- the pages ---');
{
  const WIZ = f('public/js/admin-wizard.js');
  const ids = [...WIZ.matchAll(/\{ id: '(\w+)', title: '([^']+)' \}/g)].map((m) => m[1]);
  // NEGATIVE CONTROL (run 2026-10-17): go()'s `if (problem && i > at)` made `if (problem)` (no way back past a bad page) made this read
  //   FAIL  W11 the pages themselves: seven in order, four on his own card, back always open, forward only past a good page, the bank note said plainly
  check('W11 the pages themselves: seven in order, four on his own card, back always open, forward only past a good page, the bank note said plainly',
    ids.join() === 'who,offer,addons,hours,profile,pay,review' && /const OWNER_STEPS = \['who', 'addons', 'profile', 'review'\];/.test(WIZ)
    && /if \(problem && i > at\) \{ err\(problem\); return; \}/.test(WIZ)
    && /Bank details are encrypted before they are stored\. Only you see the full numbers; everyone else sees the last four\./.test(WIZ)
    && /'They will add it when they sign in'/.test(WIZ) && /routing\.length !== 9/.test(WIZ)
    && /action: 'create', name: st\.name, email: st\.email, password: st\.password, commissionPct: st\.commissionPct,/.test(WIZ)
    && /if \(st\.photo\) \{\n\s+try \{ await api\(user, `\/api\/admin\/advocates\/headshot\?uid=\$\{encodeURIComponent\(id\)\}`, \{ raw: st\.photo \}\); \}/.test(WIZ)
    && f('tools/blindness-audit.mjs').includes("'/js/admin-wizard.js'") && !DASH.test(WIZ),
    JSON.stringify(ids));

  const MINE = f('public/js/admin-staffsettings.js');
  const DEMO = f('public/js/demo/api.js');
  // NEGATIVE CONTROL (run 2026-10-17): the demo's `if (body.offers !== undefined) return fail(400, 'What you offer is set by Eric.');` taken out made this read
  //   FAIL  W12 their own settings carry their week, and the demo answers the way the Worker does
  check('W12 their own settings carry their week, and the demo answers the way the Worker does',
    /data-ssh-day="\$\{d\}"/.test(MINE) && /paint\(await call\(user, \{ hours: Object\.values\(hours\)\.some\(Boolean\) \? hours : null \}\)\);/.test(MINE)
    && /if \(body\.offers !== undefined\) return fail\(400, 'What you offer is set by Eric\.'\);/.test(DEMO)
    && /if \(action === 'get'\) \{/.test(DEMO) && /const demoPayout = \(m, fl = \{\}\) => \{/.test(DEMO) && /label: mine \? mine\.label : 'Writing an insurance appeal'/.test(DEMO)
    && !DASH.test(MINE));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
