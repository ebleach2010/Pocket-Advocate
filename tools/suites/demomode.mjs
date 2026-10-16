// demomode.mjs - Demo mode, his practice copy (v7.61).
//
// Eric, 2026-10-16: "There should also be a button at the top called 'demo mode' where you press it and 4 of
// these clients appear. You can do a fake update with the advisor, the chat sends basic questions back when
// asked, you can upload documents and photos, start the time, and even within there start employer mode with
// the four 'employees' who each have done a different service and have made different amounts of money." His
// choice the same day: a separate copy, his real clients hidden until Exit, nothing real touched. Then: "allow
// me to adjust each fake contractor's amount of clients and type before I run fake payroll. So from the
// payroll screen in the suite would be best I assume". And: "'Delete' for sample fake clients should be on the
// folders".
//
// What this proves, by running the shipped demo files under node:
//   A. the practice copy: four clients, each worked by one of four team members, each a different service,
//      paid in the month the payroll opens on, and their chats in their own advocate's name
//   B. the practice payroll: four different amounts, Priority Chat counted; the practice team panel replaces
//      a book with that many clients of that kind, paid inside the dates given
//   C. the chat answers back with a basic question; every practice folder deletes
//   D. the doors: the button on Clients, the strip's Exit, the data layer's live switch and its fallback, and
//      the Worker serving these files on the live site to his cookie alone
//
// Run: node demomode.mjs
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

// A browser just enough for the demo's own modules, inside Demo mode.
const mem = new Map([['pa-demo-live', '1']]);
globalThis.sessionStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.window = { fetch: async () => new Response('{}'), addEventListener() {}, location: { origin: 'http://x' } };
globalThis.location = { origin: 'http://x', hostname: '127.0.0.1', pathname: '/admin.html', search: '' };
globalThis.document = { addEventListener() {}, querySelector: () => null, createElement: () => ({}) };
const LIVEJS = await import(pathToFileURL(join(ROOT, 'public/js/demo/live.js')).href);
const { demoApi } = await import(pathToFileURL(join(ROOT, 'public/js/demo/api.js')).href);
const docs = new Map(); const files = new Map();
LIVEJS.seedLive({ set: (p, v) => docs.set(p, v), file: (p, v) => files.set(p, v) });
demoApi('admin', { docs, files, reset() {}, fire() {}, persist() {} });
const call = async (path, body, method = 'POST') => {
  const r = await window.fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
};
const now = new Date();
const day = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const LM = { start: day(new Date(now.getFullYear(), now.getMonth() - 1, 1).getFullYear(), new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth(), 1), end: (() => { const e = new Date(now.getFullYear(), now.getMonth(), 0); return day(e.getFullYear(), e.getMonth(), e.getDate()); })() };

console.log('\n--- A. the practice copy ---');
{
  const cases = [...docs.entries()].filter(([k]) => /^cases\/[^/]+$/.test(k)).map(([k, v]) => ({ id: k.split('/')[1], ...v }));
  const team = LIVEJS.LIVE_TEAM.map((t) => ({ ...t, rec: docs.get(`advocates/${t.uid}`), pay: docs.get(`payouts/${t.uid}`) }));
  const byAdv = Object.fromEntries(cases.map((c) => [c.advocateId, c.clientName]));
  // NEGATIVE CONTROL (run 2026-10-16): live.js's `hand(id, 'demo-marcus', 'Marcus')` for Jordan's case taken out made this read
  //   FAIL  A1 four clients, each worked by one of four team members, every member set up with a share and a way to be paid
  check('A1 four clients, each worked by one of four team members, every member set up with a share and a way to be paid',
    cases.length === 4 && JSON.stringify(byAdv) === JSON.stringify({ 'demo-grace': 'Dana Whitfield', 'demo-marcus': 'Jordan Avery', 'demo-advocate': 'Priya Shah', 'demo-luis': 'Sam Okafor' })
    && team.every((t) => t.rec?.active === true && t.rec?.onboardedAt && Number(t.rec.commissionPct) === t.pct && t.pay?.method)
    && new Set(team.map((t) => t.pct)).size === 4, JSON.stringify({ byAdv, n: cases.length }));
  const chats = [...docs.entries()].filter(([k]) => /^cases\/[^/]+\/chat\//.test(k));
  const sideOk = chats.every(([k, m]) => {
    const c = cases.find((x) => x.id === k.split('/')[1]);
    return m.role === 'admin' ? m.from === c.advocateId : m.from === c.clientUid;
  });
  // NEGATIVE CONTROL (run 2026-10-16): live.js's `from: m.role === 'admin' ? uid : m.from` made `from: m.from` made this read
  //   FAIL  A2 every practice chat is between the client and their own advocate, and nobody in it is called Eric
  check('A2 every practice chat is between the client and their own advocate, and nobody in it is called Eric',
    chats.length >= 20 && sideOk && !chats.some(([, m]) => /\bEric\b/.test(m.text || '')), `${chats.length} lines`);
  const inLastMonth = (v) => { const t = new Date(v); return t.getMonth() === new Date(now.getFullYear(), now.getMonth() - 1, 1).getMonth(); };
  const money = cases.flatMap((c) => [c.charge?.capturedAt, ...(c.extraPayments || []).map((p) => p.at)]).filter(Boolean);
  // NEGATIVE CONTROL (run 2026-10-16): live.js's lastMonth(day) answering this month made this read
  //   FAIL  A3 every booking and extra payment lands in last month, where the payroll opens, and Sam pays Priority Chat
  check('A3 every booking and extra payment lands in last month, where the payroll opens, and Sam pays Priority Chat',
    money.length === 7 && money.every(inLastMonth) && docs.get('subscriptions/demo-client-sam')?.advocateId === 'demo-luis'
    && inLastMonth(docs.get('subscriptions/demo-client-sam').demoInvoices[0].at), JSON.stringify(money.map((m) => new Date(m).toISOString().slice(0, 10))));
  // NEGATIVE CONTROL (run 2026-10-16): live.js's Sam read written as `analysis: ''` made this read
  //   FAIL  A4 each client has something to read and something to update: uploads on every case, a read on Sam's
  check('A4 each client has something to read and something to update: uploads on every case, a read on Sam\'s',
    ['demo-case', 'demo-case-ana', 'demo-case-sam'].every((id) => [...files.keys()].some((k) => k.startsWith(`cases/${id}/uploads/`)))
    && !!docs.get('cases/demo-case-sam/advisor/state')?.analysis);
}

console.log('\n--- B. the practice payroll, and the practice team ---');
{
  const run = await call('/api/admin/payroll', { action: 'generate', ...LM, preset: 'month', includeAll: true });
  const rows = Object.fromEntries((run.body.run?.rows || []).map((r) => [r.uid, r]));
  const labels = (uid) => (rows[uid]?.lines || []).map((l) => l.label);
  // NEGATIVE CONTROL (run 2026-10-16): api.js's Priority Chat invoice loop taken out of the payroll made this read
  //   FAIL  B1 last month's payroll pays all four, four different amounts, each for their own service, Priority Chat included
  check('B1 last month\'s payroll pays all four, four different amounts, each for their own service, Priority Chat included',
    run.status === 200 && ['demo-advocate', 'demo-marcus', 'demo-grace', 'demo-luis'].every((u) => rows[u]?.totalCents > 0)
    && new Set(['demo-advocate', 'demo-marcus', 'demo-grace', 'demo-luis'].map((u) => rows[u].totalCents)).size === 4
    && labels('demo-marcus').includes('Full-Service month') && labels('demo-grace').includes('Follow-up call') && labels('demo-grace').includes('Tip')
    && labels('demo-luis').includes('Priority Chat month'),
    JSON.stringify(Object.fromEntries(Object.entries(rows).map(([u, r]) => [u, [r.totalCents, (r.lines || []).map((l) => l.label)]]))));
  const before = await call('/api/demo/practice', null, 'GET');
  const people = before.body.people || [];
  // NEGATIVE CONTROL (run 2026-10-16): the practice route answering `kind: 'other'` made this read
  //   FAIL  B2 the practice team panel lists the four, with their share, how many clients and what kind
  check('B2 the practice team panel lists the four, with their share, how many clients and what kind',
    people.length === 4 && people.every((p) => p.name && Number.isFinite(p.pct) && Number.isFinite(p.clients) && ['case', 'full', 'followup', 'chat'].includes(p.kind)),
    JSON.stringify(people));
  const set = await call('/api/demo/practice', { start: '2026-03-01', end: '2026-03-31', people: [
    { uid: 'demo-advocate', clients: 3, kind: 'full' }, { uid: 'demo-luis', clients: 5, kind: 'chat' },
    { uid: 'demo-grace', clients: 2, kind: 'followup' }, { uid: 'demo-marcus', clients: 0, kind: 'case' },
  ] });
  const mar = await call('/api/admin/payroll', { action: 'generate', start: '2026-03-01', end: '2026-03-31', preset: 'custom', includeAll: true });
  const m = Object.fromEntries((mar.body.run?.rows || []).map((r) => [r.uid, r]));
  const rates = { caseCents: 210000, addonCents: 32500, subCents: 5000, fullCents: 440000 };
  const anaCases = [...docs.entries()].filter(([k, v]) => /^cases\/[^/]+$/.test(k) && v.advocateId === 'demo-advocate');
  // NEGATIVE CONTROL (run 2026-10-16): the practice route's old-book sweep taken out (their old cases kept) made this read
  //   FAIL  B3 setting the team replaces each book with that many clients of that kind, paid inside the dates, and the payroll for those dates pays exactly that
  check('B3 setting the team replaces each book with that many clients of that kind, paid inside the dates, and the payroll for those dates pays exactly that',
    set.status === 200 && set.body.clients === 10 && anaCases.length === 3 && anaCases.every(([, v]) => v.fullAccess === true)
    && m['demo-advocate']?.commissionCents === Math.round(3 * rates.fullCents * 0.6)
    && m['demo-luis']?.commissionCents === 5 * Math.round(rates.subCents * 0.65)
    && m['demo-grace']?.commissionCents === 2 * Math.round(rates.addonCents * 0.55) && (m['demo-grace']?.lines || []).every((l) => l.label === 'Follow-up call')
    && (!m['demo-marcus'] || m['demo-marcus'].totalCents === 0) && !docs.has('cases/demo-case-ana'),
    JSON.stringify({ set: set.body, ana: anaCases.length, rows: Object.fromEntries(Object.entries(m).map(([u, r]) => [u, r.commissionCents])) }));
  const bad = await call('/api/demo/practice', { start: '2026-03-31', end: '2026-03-01', people: [] });
  const again = await call('/api/demo/practice', null, 'GET');
  // NEGATIVE CONTROL (run 2026-10-16): the practice route's `|| e < s` taken out made this read
  //   FAIL  B4 dates backwards are refused, and the panel remembers what he set
  check('B4 dates backwards are refused, and the panel remembers what he set',
    bad.status === 400 && JSON.stringify((again.body.people || []).map((p) => [p.uid, p.clients, p.kind])) === JSON.stringify([['demo-advocate', 3, 'full'], ['demo-marcus', 0, 'case'], ['demo-grace', 2, 'followup'], ['demo-luis', 5, 'chat']]),
    JSON.stringify(again.body));
}

console.log('\n--- C. the chat answers back, and every practice folder deletes ---');
{
  // One of the practice team's set clients (Sam's case went with Luis's old book in B3).
  const id = 'practice-advocate-1';
  const before = [...docs.keys()].filter((k) => k.startsWith(`cases/${id}/chat/`)).length;
  docs.set(`cases/${id}/chat/zz-mine`, { from: 'demo-admin', role: 'admin', text: 'How are the mornings this week?', ts: new Date() });
  await call('/api/notify', { kind: 'case', id });
  await new Promise((r) => setTimeout(r, 2800));
  const after = [...docs.entries()].filter(([k]) => k.startsWith(`cases/${id}/chat/`)).map(([, v]) => v);
  const answer = after.find((m) => m.demoAsked);
  // NEGATIVE CONTROL (run 2026-10-16): the notify branch's `&& LIVE` made `&& false` made this read
  //   FAIL  C1 a message he sends gets a basic question back from the client a moment later
  check('C1 a message he sends gets a basic question back from the client a moment later',
    after.length === before + 2 && !!answer && answer.role === 'client' && answer.from === docs.get(`cases/${id}`).clientUid
    && LIVEJS.LIVE_QUESTIONS.includes(answer.text) && /\?$/.test(answer.text), JSON.stringify(answer));
  const del = await call('/api/admin/delete-case', { caseId: id });
  // NEGATIVE CONTROL (run 2026-10-16): the demo delete's `const fake = LIVE || ` taken out made this read
  //   FAIL  C2 a practice client, with a client on it like any real case, deletes from its folder in Demo mode
  check('C2 a practice client, with a client on it like any real case, deletes from its folder in Demo mode',
    del.status === 200 && !docs.has(`cases/${id}`), JSON.stringify(del));
}

console.log('\n--- D. the doors ---');
{
  const ADMIN = f('public/js/admin.js');
  const FB = f('public/js/firebase.js');
  const BAN = f('public/js/demo/banner.js');
  const STORE = f('public/js/demo/store.js');
  const EMP = f('public/js/admin-employer.js');
  const W = f('worker/index.js');
  // NEGATIVE CONTROL (run 2026-10-16): the Demo mode button's `sessionStorage.setItem('pa-demo-live', '1')` taken out made this read
  //   FAIL  D1 Clients carries Demo mode for him, which sets this tab's switch and reloads; inside it every folder deletes
  check('D1 Clients carries Demo mode for him, which sets this tab\'s switch and reloads; inside it every folder deletes',
    /function mountDemoDoor\(head\) \{[\s\S]*?data-demo-mode>Demo mode<\/button>[\s\S]*?sessionStorage\.setItem\('pa-demo-live', '1'\);[\s\S]*?location\.reload\(\);/.test(ADMIN)
    && /mountDemoDoor\(head\);/.test(ADMIN) && /deletable: !asUid && \(DEMO_LIVE \|\| \(!c\.clientUid && !!\(c\.self \|\| c\.showcase\)\)\),/.test(ADMIN));
  // NEGATIVE CONTROL (run 2026-10-16): the strip's Exit leaving the switch on (removeItem taken out) made this read
  //   FAIL  D2 the strip says Demo mode, starts over, and Exit turns the switch off and goes back to his real clients
  check('D2 the strip says Demo mode, starts over, and Exit turns the switch off and goes back to his real clients',
    /bar\.innerHTML = LIVE \? `[\s\S]*?<strong>Demo mode\.<\/strong>[\s\S]*?data-demo-reset>Start over[\s\S]*?data-demo-exit>Exit/.test(BAN)
    && /\[data-demo-exit\]'\)\?\.addEventListener\('click', \(\) => \{\n\s+try \{ sessionStorage\.removeItem\('pa-demo-live'\);/.test(BAN)
    && /const KEY = LIVE \? 'pa-demo-live-store' : 'pa-demo-store';/.test(STORE) && /const SEED = LIVE \? seedLive : seed;/.test(STORE));
  // NEGATIVE CONTROL (run 2026-10-16): firebase.js's live-site branch answering 'admin' on every page made this read
  //   FAIL  D3 on the live site the copy opens only on his working pages with the switch on, and a copy that will not load falls back to the real app with the switch off
  check('D3 on the live site the copy opens only on his working pages with the switch on, and a copy that will not load falls back to the real app with the switch off',
    /return \/\^\\\/admin\/\.test\(location\.pathname\) && sessionStorage\.getItem\('pa-demo-live'\) === '1' \? 'admin' : '';/.test(FB)
    && /\.catch\(async \(err\) => \{[\s\S]*?sessionStorage\.removeItem\('pa-demo-live'\);[\s\S]*?return import\('\.\/firebase-real\.js'\);/.test(FB));
  const gate = (W.match(/if \(DEMO_ASSET\.test\(assetPath\) && !demo\) \{[\s\S]*?\n    \}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-16): the gate's `=== env.ADMIN_UID` taken out (any staff cookie) made this read
  //   FAIL  D4 the Worker serves these files on the live site to his signed cookie alone, private and never cached; to anyone else the same miss
  check('D4 the Worker serves these files on the live site to his signed cookie alone, private and never cached; to anyone else the same miss',
    /PROD_HOST\.test\(url\.hostname\) && !!env\.ADMIN_UID\n\s+&& \(await adminCookieUid\(request, env\)\.catch\(\(\) => null\)\) === env\.ADMIN_UID;/.test(gate)
    && /if \(!his\) return notFound\(env, request, url\);/.test(gate) && /'private, no-store'/.test(gate));
  // NEGATIVE CONTROL (run 2026-10-16): the practice panel's div taken out of admin-employer.html made this read
  //   FAIL  D5 the payroll screen mounts the practice team only inside Demo mode
  check('D5 the payroll screen mounts the practice team only inside Demo mode',
    /if \(sessionStorage\.getItem\('pa-demo-live'\) === '1'\) \{\n\s+import\('\.\/demo\/practice\.js'\)/.test(EMP)
    && /<div class="panel" id="practice" hidden><\/div>/.test(f('public/admin-employer.html')));
  // NEGATIVE CONTROL (run 2026-10-16): a long dash put in live.js's first question made this read
  //   FAIL  D6 no dash in anything a person reads in the copy
  check('D6 no dash in anything a person reads in the copy', !DASH.test(f('public/js/demo/live.js') + f('public/js/demo/practice.js') + BAN));
}

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);
