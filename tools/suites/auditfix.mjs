// auditfix.mjs - the three audits after Demo mode, their errors fixed (v7.62).
//
// Eric, 2026-10-16, after Demo mode shipped: "send three agents to look for errors in the suite, errors in UI,
// and a third glance at overall aesthetic vs what would best sell". Their errors, fixed; the look's taste calls
// are his to make and are not here.
//
// What this proves:
//   A. the real site: payroll names a Full-Service charge for what it is; a Full-Service header stays so after a
//      filing; one alerts card a page and none in a quiet view; the notes toolbar docks under the group row; a
//      photo that will not load becomes initials; the first-run card scrolls; the payroll's lines fit a phone;
//      the Chats inbox says who wrote the last word; signing out leaves Demo mode; the services card, the
//      preview's Exit and the tour's Chat step; Settings' Done stays in reach
//   B. Demo mode: Priya and Jordan read their own cases, a case with no read gets a first one, private notes
//      are kept, Dana's follow-up and Priya's call are on the calendar, every thread says its last word, a
//      Priority Chat subscriber asks a chat's questions, no practice name is on two books, and the practice
//      payroll names Jordan's first month
//
// Run: node auditfix.mjs
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
const strip = (src) => src.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function|let) /gm, '$1 ');

console.log('\n--- A. the real site ---');
{
  // The Worker's own caseLines, its two helpers handed in.
  const PAY = new Function('getDoc', 'patchDoc', 'deleteDoc', 'listDocs', 'batchCreate', 'batchDelete', 'stripeGet', 'caseBookingCents', 'advocateIdOf', 'DEFAULT_COMMISSION_PCT',
    `${strip(f('worker/payroll.js'))}\nreturn { caseLines };`)(null, null, null, null, null, null, null, (c) => Number(c.caseRateCents) || 0, (c) => c.advocateId || 'eric', 60);
  const at = '2026-09-10T18:00:00Z';
  const lines = PAY.caseLines([
    { id: 'full', data: { advocateId: 'ana', clientName: 'Jordan', fullAccess: true, caseRateCents: 350000, createdAt: at } },
    { id: 'case', data: { advocateId: 'ana', clientName: 'Priya', caseRateCents: 210000, createdAt: at } },
  ], new Date('2026-09-01T07:00:00Z').getTime(), new Date('2026-10-01T07:00:00Z').getTime(), {});
  // NEGATIVE CONTROL (run 2026-10-17): payroll.js's booking label put back to `label: KIND_LABEL.booking` made this read
  //   FAIL  A1 payroll names a Full-Service case's first charge Full-Service month, and an Advocacy Case its own
  check('A1 payroll names a Full-Service case\'s first charge Full-Service month, and an Advocacy Case its own',
    lines.length === 2 && lines.find((l) => l.caseId === 'full')?.label === 'Full-Service month' && lines.find((l) => l.caseId === 'case')?.label === 'Advocacy Case',
    JSON.stringify(lines.map((l) => [l.caseId, l.label])));

  const CASE = f('public/js/admin-case.js');
  const refresh = (CASE.match(/function refreshHeader\(\) \{[\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17): refreshHeader's pill put back to `c.self ? 'MY OWN CASE' : (c.status || '?')...` made this read
  //   FAIL  A2 the header's refresh after a filing keeps the first draw's rule: Full-Service stays FULL-SERVICE
  check('A2 the header\'s refresh after a filing keeps the first draw\'s rule: Full-Service stays FULL-SERVICE',
    /pill\.textContent = c\.self \? 'MY OWN CASE' : c\.fullAccess && c\.status !== 'closed' \? 'FULL-SERVICE' : /.test(refresh)
    && /c\.fullAccess && c\.status !== 'closed' \? 'FULL-SERVICE' :/.test(CASE.slice(CASE.indexOf('data-status>'), CASE.indexOf('data-status>') + 200)));

  const PUSH = f('public/js/push.js');
  const ADM = f('public/js/admin.js');
  // NEGATIVE CONTROL (run 2026-10-17): push.js's `if (mount.querySelector('.push-prompt')) return;` taken out made this read
  //   FAIL  A3 one alerts card a page however often Clients reloads, and none in a team member's quiet view
  check('A3 one alerts card a page however often Clients reloads, and none in a team member\'s quiet view',
    /if \(!mount \|\| localStorage\.getItem\(DISMISS_KEY\)\) return;\n[\s\S]{0,200}if \(mount\.querySelector\('\.push-prompt'\)\) return;/.test(PUSH)
    && /if \(mount && !mount\.querySelector\('\.push-prompt'\)\) \{/.test(PUSH)
    && /if \(!asUid\) initPushPrompt\(user, document\.querySelector\('main'\)\)/.test(ADM));

  const ACSS = f('public/css/admin.css');
  const tool = (ACSS.match(/\n\.notes-toolbar \{[\s\S]*?\n\}/) || [''])[0];
  const grp = (ACSS.match(/\n\.case-folder \.folder-groups \{[\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17): the toolbar's top put back to `calc(3rem + 3.3rem)` made this read
  //   FAIL  A4 the notes toolbar docks under the group row, by the same sum the row docks by, at every width
  check('A4 the notes toolbar docks under the group row, by the same sum the row docks by, at every width',
    /top: calc\(var\(--demo-bar-h, 0px\) \+ var\(--bar-h, 3rem\) \+ var\(--adm-grp-h\)\);/.test(tool)
    && /top: calc\(var\(--demo-bar-h, 0px\) \+ var\(--bar-h, 3rem\)\);/.test(grp)
    && !/\.notes-toolbar \{[^}]*top:[^}]*3\.1rem/.test(ACSS) && /admin\.css\?v=stat139/.test(f('public/admin-case.html')));

  const EMP = f('public/js/admin-employer.js');
  // NEGATIVE CONTROL (run 2026-10-17): the team photo's capturing listener put on 'errorx' instead of 'error' made this read
  //   FAIL  A5 a team photo that will not load becomes that person's initials
  check('A5 a team photo that will not load becomes that person\'s initials',
    /data-init="\$\{esc\(init\)\}"/.test(EMP)
    && /document\.addEventListener\('error', \(e\) => \{\n\s+const img = e\.target;\n\s+if \(!img\?\.matches\?\.\('img\.tm-photo'\)\) return;[\s\S]{0,260}img\.replaceWith\(s\);\n\}, true\);/.test(EMP));

  const ONB = f('public/js/onboarding.js');
  // NEGATIVE CONTROL (run 2026-10-17): onboarding.js's `overlay.style.overflowY = 'auto';` taken out made this read
  //   FAIL  A6 the first-run card scrolls on a short screen, its top and its buttons in reach, and still centres where there is room
  check('A6 the first-run card scrolls on a short screen, its top and its buttons in reach, and still centres where there is room',
    /overlay\.style\.overflowY = 'auto';\n\s+overlay\.style\.alignItems = 'flex-start';/.test(ONB) && /<div class="intro-card" style="margin:auto 0;">/.test(ONB));

  const EMPH = f('public/admin-employer.html');
  const phone = EMPH.slice(EMPH.indexOf('@media (max-width: 760px)'), EMPH.indexOf('@media (max-width: 380px)'));
  // NEGATIVE CONTROL (run 2026-10-17): the phone's `.pr-lines tr { display: grid; ...}` put to `display: block` made this read
  //   FAIL  A7 on a phone each payroll line is a small card, the sale and their pay in their own columns, and the tabs stay one line each
  check('A7 on a phone each payroll line is a small card, the sale and their pay in their own columns, and the tabs stay one line each',
    /\.pr-lines tr \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto auto; grid-template-areas: "who amt pay" "what amt pay" "day amt pay";/.test(phone)
    && /\.pr-lines tr\.pr-adj td:nth-child\(4\) \{ grid-area: pay; \}/.test(phone)
    && /<tr class="pr-adj">/.test(EMP) && /\.emp-tabs button \{[^}]*white-space: nowrap;/.test(EMPH));

  const CHATS = f('public/js/admin-chats.js');
  const by = new Function('esc', 'user', 'STAFF', 'names', `${(CHATS.match(/const byLine = \(lm\) => \{[\s\S]*?\n\s{2}\};/) || ['const byLine = () => \'\';'])[0]}\nreturn byLine;`);
  const asEric = by((s) => s, { uid: 'eric' }, { role: 'admin' }, new Map([['ana', 'Ana']]));
  const asAna = by((s) => s, { uid: 'ana' }, { role: 'advocate' }, new Map());
  const said = [asEric({ role: 'admin', from: 'eric' }), asEric({ role: 'admin', from: 'ana' }), asEric({ role: 'client', from: 'c' }), asAna({ role: 'admin', from: 'ana' }), asAna({ role: 'admin', from: 'eric' })];
  // NEGATIVE CONTROL (run 2026-10-17): byLine answering 'You: ' for every word from the advocate's side made this read
  //   FAIL  A8 the Chats inbox says You only for his own word, a team member's first name for theirs, and a subscriber's name
  check('A8 the Chats inbox says You only for his own word, a team member\'s first name for theirs, and a subscriber\'s name',
    JSON.stringify(said) === JSON.stringify(['You: ', 'Ana: ', '', 'You: ', 'Eric: ']) && /who: s\.name \|\| s\.email \|\| d\.id,/.test(CHATS),
    JSON.stringify(said));

  const AUTH = f('public/js/auth.js');
  // NEGATIVE CONTROL (run 2026-10-17): auth.js's `sessionStorage.removeItem('pa-demo-live')` taken out made this read
  //   FAIL  A9 signing out leaves Demo mode, before the sign out itself
  check('A9 signing out leaves Demo mode, before the sign out itself',
    /try \{ sessionStorage\.removeItem\('pa-demo-live'\); \} catch \{[^}]*\}\n\s+try \{ await fetch\('\/api\/admin\/session', \{ method: 'DELETE' \}\); \} catch \{[^}]*\}\n\s+await signOut\(auth\);\n\s+location\.href = '\/';/.test(AUTH));

  const WARM = f('public/css/warm.css');
  const SERV = f('public/services.html');
  const BAR = f('public/js/preview/bar.js');
  const TOUR = f('public/js/preview/tour.js');
  const W = ':root:not([data-scheme="contrast"]):not([data-look="cool"])';
  // NEGATIVE CONTROL (run 2026-10-17): warm.css's `.pack#chat` override put on a selector that matches nothing made this read
  //   FAIL  A10 the warm look's services card and the preview's Exit are warm, and each card's title and price share a row
  check('A10 the warm look\'s services card and the preview\'s Exit are warm, and each card\'s title and price share a row',
    WARM.includes(`${W} .pack#chat { background: linear-gradient(var(--sur-base), var(--sur-base)) padding-box, var(--warm-pop) border-box;`)
    && WARM.includes(`${W} .pack#chat .pack-cta {`) && /\/css\/warm\.css\?v=5/.test(SERV) /* RE-PINNED 2026-10-17 (v7.64): ?v=4, the sheet ends in the color wheel's block; the `.pack#chat` control re-run and read FAIL. RE-PINNED 2026-10-17 (v7.66): ?v=5, the wheel's block is gone and the buttons are raised; the `.pack#chat` control re-run and read FAIL. */
    && /<style>\.pack > :is\(\.eyebrow, \.pa-off-badge, \.pack-cta\) \{ grid-column: 1 \/ -1; \}<\/style>/.test(SERV)
    && BAR.includes(`${W.replace('):not([data-look="cool"])', ')').replace(':root:not([data-scheme="contrast"])', ':root:not([data-look="cool"]):not([data-scheme="contrast"])')} .pv-exit {`)
    && /animation-name: pv-glow-warm;/.test(BAR));
  // NEGATIVE CONTROL (run 2026-10-17): the tour's Chat step without `top: true` made this read
  //   FAIL  A11 the tour's Chat step sits at the top, so the box it asks for stays on screen
  check('A11 the tour\'s Chat step sits at the top, so the box it asks for stays on screen',
    /\{ tab: 'chat', at: '\[data-chat\]', top: true, title: 'Chat',/.test(TOUR) && /\.pv-tour\.top \.pv-tour-card \{ top: calc\(var\(--pv-hb, 64px\) \+ 8px\); bottom: auto; \}/.test(TOUR)
    && /root\.classList\.toggle\('top', !!\(target && step\.top\)\);/.test(TOUR));

  const SET = f('public/js/settings.js');
  // NEGATIVE CONTROL (run 2026-10-17): the Settings header row's `position:sticky; top:0;` taken out made this read
  //   FAIL  A12 Settings keeps Done at the top as the sheet scrolls, and the test says how many devices as a number
  check('A12 Settings keeps Done at the top as the sheet scrolls, and the test says how many devices as a number',
    /<div class="row" style="position:sticky; top:0; z-index:2;[^"]*background:inherit;[^"]*"><h3 style="margin:0;">Settings<\/h3><button class="btn quiet" data-close>Done<\/button><\/div>/.test(SET)
    && /const n = Number\(out\.devices\) \|\| 0;/.test(SET));

  const CLIENT = f('public/js/case.js');
  // NEGATIVE CONTROL (run 2026-10-17): the eyebrow's flex row taken out (`<p class="eyebrow">`) made this read
  //   FAIL  A13 the client's case card keeps its pill and its kind apart at 320, and the next-call box wraps instead of cutting its words
  check('A13 the client\'s case card keeps its pill and its kind apart at 320, and the next-call box wraps instead of cutting its words',
    /<p class="eyebrow" style="display:flex;flex-wrap:wrap;align-items:center;gap:\.4rem \.6rem;">/.test(CLIENT)
    && /<form data-agenda-form style="display:flex; flex-wrap:wrap; gap:\.4rem; margin-top:\.5rem;">/.test(CLIENT)
    && /placeholder="Add something for the call…" style="flex:1 1 13rem; min-width:0;"/.test(CLIENT));

  const CPG = f('public/js/chat-page.js');
  const CPH = f('public/chat.html');
  // NEGATIVE CONTROL (run 2026-10-17): chat.html's `max-height: var(--fit-h, 45vh)` rule taken out made this read
  //   FAIL  A14 the client's chat page sizes the conversation to what is left of the screen, so the message box shows
  check('A14 the client\'s chat page sizes the conversation to what is left of the screen, so the message box shows',
    /body\.chat-page \.chat-root:not\(\.chat-full\) \.chat-log \{ max-height: var\(--fit-h, 45vh\); \}/.test(CPH)
    && /const room = window\.innerHeight - top - \(form \? form\.offsetHeight : 0\) - 16;\n\s+root\.style\.setProperty\('--fit-h', `\$\{Math\.max\(180, Math\.round\(room\)\)\}px`\);/.test(CPG)
    && /for \(const ms of \[0, 400, 1200\]\) setTimeout\(fitChat, ms\);/.test(CPG) && /window\.addEventListener\('resize', \(\) => fitChat\(\)\);/.test(CPG));

  // NEGATIVE CONTROL (run 2026-10-17): admin.js's Priority Chat link without its `&as=` made this read
  //   FAIL  A15 from a team member's shelf a Priority Chat opens in their read-only view, never a box he can write in
  check('A15 from a team member\'s shelf a Priority Chat opens in their read-only view, never a box he can write in',
    /href: `\/admin-chats\.html\?sub=\$\{encodeURIComponent\(sub\.id\)\}\$\{asUid \? `&as=\$\{encodeURIComponent\(asUid\)\}` : ''\}`/.test(ADM)
    && /const asUid = STAFF\.role === 'admin' \? \(new URLSearchParams\(location\.search\)\.get\('as'\) \|\| ''\)/.test(CHATS)
    && /disabled: !!asUid,/.test(CHATS) && /viewAs: asUid \|\| '',/.test(CHATS));
}

console.log('\n--- B. Demo mode ---');
{
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
  let persisted = 0;
  LIVEJS.seedLive({ set: (p, v) => docs.set(p, v), file: (p, v) => files.set(p, v) });
  demoApi('admin', { docs, files, reset() {}, fire() {}, persist() { persisted += 1; } });
  const call = async (path, body, method = 'POST') => {
    const r = await window.fetch(path, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json().catch(() => ({})) };
  };
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const read = (id) => docs.get(`cases/${id}/advisor/state`) || {};
  // NEGATIVE CONTROL (run 2026-10-17): live.js's Jordan advisor state override taken out made this read
  //   FAIL  B1 Priya and Jordan each read their own case: her racing heart, his denied scan, nobody's joint pain
  check('B1 Priya and Jordan each read their own case: her racing heart, his denied scan, nobody\'s joint pain',
    /racing heart/i.test(read('demo-case-ana').analysis || '') && read('demo-case-ana').differential?.length === 3
    && /MRI/.test(read('demo-case-full').analysis || '') && !/joint/i.test(read('demo-case-full').analysis || '') && !/arthritis/i.test(JSON.stringify(read('demo-case-full').differential || [])),
    JSON.stringify({ priya: (read('demo-case-ana').analysis || '').slice(0, 60), jordan: (read('demo-case-full').analysis || '').slice(0, 60) }));

  docs.set('cases/demo-new', { clientName: 'Hana Sato', clientUid: 'demo-new-client', status: 'confirmed', advocateId: 'demo-advocate' });
  const up = await call('/api/advisor', { id: 'demo-new', action: 'analyze' });
  await wait(4300);
  const fresh = read('demo-new');
  // NEGATIVE CONTROL (run 2026-10-17): api.js's analyze leaving out `...(state.analysis ? {} : firstRead(...))` made this read
  //   FAIL  B2 Update on a case with no read settles on a first read in that client's name, and keeps it
  check('B2 Update on a case with no read settles on a first read in that client\'s name, and keeps it',
    up.status === 200 && fresh.status === 'idle' && /^## Right now\nHana's file is new/.test(fresh.analysis || '') && fresh.workingDx === 'New case, first read'
    && !DASH.test(fresh.analysis || ''), JSON.stringify({ status: fresh.status, a: (fresh.analysis || '').slice(0, 40) }));

  const p0 = persisted;
  const note = await call('/api/advisor', { id: 'demo-case-ana', action: 'note', html: '<p>Bring the echo</p>' });
  // NEGATIVE CONTROL (run 2026-10-17): the note branch's `store.persist?.();` taken out made this read
  //   FAIL  B3 a private note is kept, not only held in memory until the next reload
  check('B3 a private note is kept, not only held in memory until the next reload',
    note.status === 200 && persisted > p0 && docs.get('cases/demo-case-ana/private/notes/doc')?.html === '<p>Bring the echo</p>');

  const dana = docs.get('cases/demo-case')?.followUp || {};
  const slots = [...docs.entries()].filter(([k, v]) => k.startsWith('availability/') && v.state === 'booked').map(([, v]) => v.caseId);
  // NEGATIVE CONTROL (run 2026-10-17): live.js's Dana follow-up put back under `at:` made this read
  //   FAIL  B4 Dana's follow-up is under start, two days ahead, and it and Priya's call are booked on the calendar
  check('B4 Dana\'s follow-up is under start, two days ahead, and it and Priya\'s call are booked on the calendar',
    dana.start instanceof Date && Math.abs(dana.start - Date.now() - 2 * 86_400_000) < 60_000 && !('at' in dana)
    && slots.includes('demo-case') && slots.includes('demo-case-ana'), JSON.stringify({ dana, slots }));

  const threads = [...docs.entries()].filter(([k]) => /^cases\/[^/]+$/.test(k) && k !== 'cases/demo-new')
    .filter(([k]) => [...docs.keys()].some((x) => x.startsWith(`${k}/chat/`)));
  // NEGATIVE CONTROL (run 2026-10-17): live.js's lastMessage pass skipping every case (`if (true) continue;`) made this read
  //   FAIL  B5 every case with a conversation carries its last word, so Chats never says No messages yet over a thread
  check('B5 every case with a conversation carries its last word, so Chats never says No messages yet over a thread',
    threads.length === 4 && threads.every(([, c]) => c.lastMessage?.text), JSON.stringify(threads.map(([k, c]) => [k, !!c.lastMessage])));

  await call('/api/notify', { kind: 'sub', id: 'demo-client-sam' });
  await wait(2700);
  const asked = [...docs.entries()].filter(([k, m]) => k.startsWith('subscriptions/demo-client-sam/chat/') && m.demoAsked).map(([, m]) => m.text);
  // NEGATIVE CONTROL (run 2026-10-17): the answer-back's list fixed to LIVE_QUESTIONS made this read
  //   FAIL  B6 a Priority Chat subscriber asks back a chat's question, never one about a call
  check('B6 a Priority Chat subscriber asks back a chat\'s question, never one about a call',
    asked.length === 1 && LIVEJS.LIVE_CHAT_QUESTIONS.includes(asked[0]) && !LIVEJS.LIVE_CHAT_QUESTIONS.some((q) => /\bcall\b/i.test(q)), JSON.stringify(asked));

  const set = await call('/api/demo/practice', { start: '2026-03-01', end: '2026-03-31', people: ['demo-advocate', 'demo-marcus', 'demo-grace', 'demo-luis'].map((uid) => ({ uid, clients: 12, kind: 'case' })) });
  const names = [...docs.entries()].filter(([k, v]) => /^cases\/practice-/.test(k) && /^cases\/[^/]+$/.test(k)).map(([, v]) => v.clientName);
  // NEGATIVE CONTROL (run 2026-10-17): every team member's practice names drawn from the first surnames (`LASTS[0]`) made this read
  //   FAIL  B7 twelve practice clients each for all four, and no name on two books
  check('B7 twelve practice clients each for all four, and no name on two books',
    set.status === 200 && names.length === 48 && new Set(names).size === 48, `${names.length} names, ${new Set(names).size} distinct`);

  // Start again from the seed for the payroll, so Jordan's first month is on it.
  const docs2 = new Map(); const files2 = new Map();
  LIVEJS.seedLive({ set: (p, v) => docs2.set(p, v), file: (p, v) => files2.set(p, v) });
  demoApi('admin', { docs: docs2, files: files2, reset() {}, fire() {}, persist() {} });
  const now = new Date();
  const s = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const e = new Date(now.getFullYear(), now.getMonth(), 0);
  const ymd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const run = await call('/api/admin/payroll', { action: 'generate', start: ymd(s), end: ymd(e), preset: 'month', includeAll: true });
  const marcus = (run.body.run?.rows || []).find((r) => r.uid === 'demo-marcus');
  const test = await call('/api/push/test', {});
  // NEGATIVE CONTROL (run 2026-10-17): api.js's demo payroll booking label put back to 'Advocacy Case' made this read
  //   FAIL  B8 the practice payroll names Jordan's first charge Full-Service month, and the test notification answers a count
  check('B8 the practice payroll names Jordan\'s first charge Full-Service month, and the test notification answers a count',
    run.status === 200 && (marcus?.lines || []).filter((l) => l.caseId === 'demo-case-full' && l.kind === 'booking').every((l) => l.label === 'Full-Service month')
    && (marcus?.lines || []).some((l) => l.kind === 'booking') && test.body.devices === 1,
    JSON.stringify((marcus?.lines || []).map((l) => [l.kind, l.label])));

  await call('/api/advisor', { id: 'demo-case-sam', action: 'draft' });
  const draft = docs2.get('cases/demo-case-sam/advisor/state')?.draftPending || '';
  // NEGATIVE CONTROL (run 2026-10-17): the draft's own-words branch taken out (Dana's text for every case) made this read
  //   FAIL  B9 a prepared reply on another case speaks to that client, never of Dana's discharge summary
  check('B9 a prepared reply on another case speaks to that client, never of Dana\'s discharge summary',
    /^Thanks for sending that through, Sam\./.test(draft) && !/discharge summary/.test(draft), draft.slice(0, 80));
  check('B10 no dash in the demo copy', !DASH.test(f('public/js/demo/live.js') + f('public/js/demo/api.js')));
}

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
