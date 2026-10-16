// opencases.mjs - the Clients screen's +, Delete on his own cases, the
// cards by state, the menu over the case page's tabs, and the showcase kept
// current.
//
// Eric, 2026-10-15, with two screenshots: "This menu is blocked. Also, let me
// delete my own cases. Lastly, there should be an example case I can open and
// shut. Every time we add something seeable from the client side, it gets
// secretly added to this. It will be a + at the top of my 'all cases' screen
// and then a drop down that says 'showcase', 'my own case' and 'schedule a
// case from a lead'... Closed files should look like Chris's current
// aesthetic. But open ones should be highlighted in that ease in ease out
// blue/purple. Paused will be the same sort of aesthetic only yellow."
//
// The folder card is imported and RUN; the card-state rule is lifted out of
// admin.js and run on fixtures; the showcase builder is lifted and run
// against stand-ins. The rest is pinned on the source, and drive-invite.mjs
// walks it all in a browser.
//
// Run: node opencases.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const ADMIN = f('public/js/admin.js');
const HTML = f('public/admin.html');
const CASE = f('public/js/admin-case.js');
const DRAWER = f('public/js/drawer.js');
const ACSS = f('public/css/admin.css');
const LOOK = f('public/css/look.css');
const SITE = f('public/css/site.css');
const SHOW = f('worker/showcase.js');
const DEMO = f('public/js/demo/api.js');
const CLAUDE = f('CLAUDE.md');
const { folderCardHtml } = await import(pathToFileURL(j(ROOT, 'public/js/drawer.js')).href);
const mod = await import(pathToFileURL(j(ROOT, 'worker/showcase.js')).href);
const pdf = await import(pathToFileURL(j(ROOT, 'public/js/textpdf.js')).href);
const JOEMOD = await import(pathToFileURL(j(ROOT, 'public/js/preview/joe.js')).href);

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
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
/** The z-index in the rule for `sel` (read from the next 900 characters: a comment in the rule may hold a brace). */
const zOf = (css, sel) => { const i = css.indexOf(`${sel} {`); return i < 0 ? NaN : Number((css.slice(i, i + 900).match(/z-index: (\d+);/) || [])[1]); };

console.log('\n--- A. the menu over the case page\'s tabs ---');
{
  const header = Number((LOOK.match(/\nheader\.bar \{ z-index: (\d+); \}/) || [])[1]);
  const rail = zOf(ACSS, '.case-folder .folder-groups');
  const demoBar = Number((SITE.match(/\.demo-bar[^{]*\{[^}]*?z-index: (\d+)/) || [])[1]) || 40;
  const pages = ['admin', 'admin-case', 'admin-calendar', 'admin-chats', 'case', 'book', 'index'];
  const order = pages.every((p) => {
    const h = f(`public/${p}.html`);
    const at = (css) => h.indexOf(`href="/css/${css}`);
    return /look\.css\?v=7"/.test(h) && at('look.css') > at('site.css') && at('site.css') > 0 && at('look.css') > at('admin.css');
  }) && !/header\.bar[^{]*\{[^}]*z-index/.test(f('public/css/landing.css'));
  // NEGATIVE CONTROL (run 2026-10-15): look.css's `header.bar { z-index: 20; }` taken out made this read
  //   FAIL  A1 the bar sits above the case page's sticky tab rail, so its open menu is never under it, and below the demo strip; look.css loads last and fresh on every page
  check('A1 the bar sits above the case page\'s sticky tab rail, so its open menu is never under it, and below the demo strip; look.css loads last and fresh on every page',
    header > rail && rail === 5 && header < demoBar && order, JSON.stringify({ header, rail, demoBar, order }));
}

console.log('\n--- B. Delete on his own cases ---');
{
  const mine = folderCardHtml({ id: 'c-1', name: 'Eric <B>', deletable: true });
  const theirs = folderCardHtml({ id: 'c-2', name: 'Dana' });
  // NEGATIVE CONTROL (run 2026-10-15): the card's `${deletable ? ` changed to `${false ? ` made this read
  //   FAIL  B1 a card he may delete carries a Delete control inside it, named for the case and reachable by keyboard; any other card carries none
  check('B1 a card he may delete carries a Delete control inside it, named for the case and reachable by keyboard; any other card carries none',
    /<span class="folder-del" data-del="c-1" data-del-name="Eric &lt;B&gt;" role="button" tabindex="0"\s+aria-label="Delete Eric &lt;B&gt;">Delete<\/span>/.test(mine)
    && mine.indexOf('folder-del') < mine.indexOf('</a>') && !/data-del/.test(theirs), mine.slice(-300));
  // NEGATIVE CONTROL (run 2026-10-15): wireFolderOpen's `[data-del]` early return taken out made this read
  //   FAIL  B2 a tap on Delete never opens the case; it asks in the app's own sheet, posts to the delete route, and only his own cases and the showcase carry it
  check('B2 a tap on Delete never opens the case; it asks in the app\'s own sheet, posts to the delete route, and only his own cases and the showcase carry it',
    /if \(e\.target\.closest\?\.\('\[data-del\]'\)\) \{\n\s+e\.preventDefault\(\);\n\s+return;\n\s+\}/.test(DRAWER)
    // RE-PINNED 2026-10-15 (v7.46): Eric's quiet view of a contractor's shelf is read-only, so no card in it carries Delete.
    // NEGATIVE CONTROL (run 2026-10-15, v7.46): `deletable: !asUid && ` dropped back to `deletable: ` made B2 read FAIL.
    // RE-PINNED 2026-10-16 (v7.55): `!c.sample && ` added; the sample contractor's invented clients go only with her.
    // NEGATIVE CONTROL (run 2026-10-16): `!c.sample && ` taken back out made B2 read FAIL.
    && /deletable: !asUid && !c\.sample && !!\(c\.self \|\| c\.showcase\),/.test(ADMIN)
    && /function wireShelfDelete\(listEl\) \{[\s\S]*?const yes = await ask\(\{\n\s+title: `Delete \$\{name\}\?`,[\s\S]*?danger: true,[\s\S]*?fetch\('\/api\/admin\/delete-case', \{[\s\S]*?body: JSON\.stringify\(\{ caseId: el\.dataset\.del \}\),[\s\S]*?load\(\);/.test(ADMIN)
    && /if \(\(e\.key === 'Enter' \|\| e\.key === ' '\) && e\.target\.matches\?\.\('\[data-del\]'\)\)/.test(ADMIN)
    && /import \{ ask \} from '\.\/sheet\.js';/.test(ADMIN) && /wireShelfDelete\(document\.getElementById\('list'\)\);/.test(ADMIN));
  // NEGATIVE CONTROL (run 2026-10-15): the self-del-row taken off the top of paintSelfOverview made this read
  //   FAIL  B3 on his own case Delete is the first thing on the Overview, open or closed, once, through the sheet
  const self = lift(CASE, 'function paintSelfOverview(pane, c) {');
  check('B3 on his own case Delete is the first thing on the Overview, open or closed, once, through the sheet',
    /pane\.innerHTML = `\n\s+<p class="row self-del-row"><button type="button" class="btn quiet danger tiny" data-delete-case>Delete this case<\/button><\/p>/.test(self)
    && (self.match(/data-delete-case>/g) || []).length === 1 && /const yes = await ask\(\{\n\s+title: 'Delete this case\?'/.test(CASE)
    && /\.self-del-row \{ justify-content: flex-end;/.test(ACSS));
}

console.log('\n--- C. the + ---');
{
  const menu = (HTML.match(/<div class="add-menu" id="add-menu" role="menu"[^>]*hidden>([\s\S]*?)<\/div>/) || [])[1] || '';
  const items = [...menu.matchAll(/<button type="button" role="menuitem" ([^>]+)>([^<]+)<\/button>/g)].map((m) => [m[1], m[2]]);
  // NEGATIVE CONTROL (run 2026-10-15): "Schedule a case from a lead" moved above "My own case" in admin.html made this read
  //   FAIL  C1 the + beside the heading opens his three in his order and words, then the family case, each opening its own door
  check('C1 the + beside the heading opens his three in his order and words, then the family case, each opening its own door',
    JSON.stringify(items) === JSON.stringify([['data-showcase-door', 'Showcase'], ['data-open-door="self"', 'My own case'],
      ['data-open-door="lead"', 'Schedule a case from a lead'], ['data-open-door="family"', 'Family case']])
    && /<h1>Clients<\/h1>\s*<div class="add-wrap">\s*<button type="button" class="add-btn" data-add-open aria-haspopup="menu" aria-expanded="false" aria-controls="add-menu" aria-label="Open a case">\+<\/button>/.test(HTML)
    && HTML.indexOf('data-add-open') < HTML.indexOf('id="list"') && HTML.indexOf('id="add-forms"') < HTML.indexOf('id="list"'),
    JSON.stringify(items));
  const wire = lift(ADMIN, 'function wireAddMenu() {');
  // NEGATIVE CONTROL (run 2026-10-15): `paintAddForms(cases);` moved below the no-cases early return made this read
  //   FAIL  C2 the menu closes on a choice, a tap outside or Escape; its forms are painted even before the first case exists, and the doors are gone from under the shelf
  check('C2 the menu closes on a choice, a tap outside or Escape; its forms are painted even before the first case exists, and the doors are gone from under the shelf',
    /if \(!menu\.hidden && !e\.target\.closest\?\.\('\.add-wrap'\)\) setOpen\(false\);/.test(wire)
    && /if \(e\.key === 'Escape' && !menu\.hidden\) \{ setOpen\(false\); btn\.focus\(\); \}/.test(wire)
    && /door\.addEventListener\('click', \(\) => \{ setOpen\(false\); openForm\(door\.dataset\.openDoor\); \}\);/.test(wire)
    && /fetch\('\/api\/admin\/showcase-case', \{/.test(wire)
    && /paintAddForms\(cases\);\n\s+if \(!cases\.length\) \{/.test(ADMIN)
    // RE-PINNED 2026-10-15 (v7.46): Eric, "Remove the ability to make their own case or family case for contractors":
    // a contractor's + paints the lead form alone; his paints all three, as before.
    // NEGATIVE CONTROL (run 2026-10-15, v7.46): `advocate ? leadFormHtml() : ` dropped made C2 read FAIL.
    && /addEl\.innerHTML = advocate \? leadFormHtml\(\) : person\('self', false, pullPicker\) \+ person\('family', true\) \+ leadFormHtml\(\);/.test(ADMIN)
    // RE-PINNED 2026-10-15 (v7.51): Eric, "Remove the fund queue, one day summary". The fund queue link was the last
    // thing under the shelf, so nothing is: no doors and no quiet links, straight into the quiet tools.
    // NEGATIVE CONTROL (run 2026-10-15, v7.51): `quietLinks +` put back under the shelf made C2 read FAIL.
    && !/data-open-door="/.test(ADMIN) && !/quietLinks|admin-fund/.test(ADMIN)
    && /section\('FORMER CLIENTS: CLOSED'[\s\S]*?\)\)\) \+\n\s+`<div class="cmd-quiet">`/.test(ADMIN));
}

console.log('\n--- D. the cards by state ---');
{
  const stateExpr = (ADMIN.match(/state: (c\.status === 'closed' \? 'closed' : c\.hold\?\.pausedAt \? 'paused' : 'open'),/) || [])[1] || '';
  const stateOf = stateExpr ? new Function('c', `return ${stateExpr};`) : () => '';
  const cls = (state, extra = {}) => (folderCardHtml({ id: 'x', name: 'N', state, ...extra }).match(/<a class="([^"]+)"/) || [])[1];
  const fixtures = [
    [{ status: 'confirmed' }, 'open'], [{ status: 'awaiting_report', hold: { pausedAt: '2026-10-01' } }, 'paused'],
    [{ status: 'closed', hold: { pausedAt: '2026-10-01' } }, 'closed'], [{ status: 'delivered', hold: { pausedAt: null } }, 'open'],
  ];
  // NEGATIVE CONTROL (run 2026-10-15): rowFor's state reading `c.hold?.pausedAt ? 'paused' : c.status === 'closed' ? 'closed' : 'open'` made this read
  //   FAIL  D1 every case is open, paused or closed (closed wins over a pause), and the card wears st-open or st-paused; a closed card wears neither
  check('D1 every case is open, paused or closed (closed wins over a pause), and the card wears st-open or st-paused; a closed card wears neither',
    !!stateExpr && fixtures.every(([c, want]) => stateOf(c) === want)
    && cls('open') === 'folder st-open' && cls('paused') === 'folder st-paused' && cls('closed') === 'folder' && cls('') === 'folder'
    && cls('open', { self: true }) === 'folder self st-open',
    JSON.stringify(fixtures.map(([c]) => stateOf(c))));
  const block = ACSS.slice(ACSS.indexOf('/* CASE STATE ON THE SHELF'));
  // NEGATIVE CONTROL (run 2026-10-15): st-open-glow's `3s ease-in-out infinite` changed to `3s linear infinite` made this read
  //   FAIL  D2 open is the cyan to violet rim breathing in and out, paused the same in gold, only for people who have not asked for less motion; closed has no rule at all, and his purple and the clock's green keep their own light
  check('D2 open is the cyan to violet rim breathing in and out, paused the same in gold, only for people who have not asked for less motion; closed has no rule at all, and his purple and the clock\'s green keep their own light',
    /:root \.drawer \.folder\.st-open:not\(\.working\):not\(\.self\) \{\n\s+background: linear-gradient\(135deg, #3DDCF5, #B57BFF\);/.test(block)
    && /:root \.drawer \.folder\.st-paused:not\(\.working\):not\(\.self\) \{\n\s+background: linear-gradient\(135deg, #F6D77A, #E9B949\);/.test(block)
    && /@media \(prefers-reduced-motion: no-preference\) \{\n\s+:root \.drawer \.folder\.st-open:not\(\.working\):not\(\.self\) \{ animation: st-open-glow 3s ease-in-out infinite; \}\n\s+:root \.drawer \.folder\.st-paused:not\(\.working\):not\(\.self\) \{ animation: st-paused-glow 3s ease-in-out infinite; \}/.test(block)
    && /@keyframes st-open-glow \{[\s\S]*?rgba\(61, 220, 245[\s\S]*?rgba\(181, 123, 255/.test(block) && /@keyframes st-paused-glow \{[\s\S]*?rgba\(233, 185, 73/.test(block)
    && !/st-closed/.test(ACSS + ADMIN + DRAWER)
    && !/st-(open|paused)[^{]*\{[^}]*animation/.test(block.slice(0, block.indexOf('@media (prefers-reduced-motion'))));
}

console.log('\n--- E. the showcase stays current ---');
{
  const buildSrc = lift(SHOW, 'export async function buildShowcase(env, { adminUid } = {}) {').replace(/^export /, '');
  const created = [];
  const writes = [];
  const puts = [];
  let n = 0;
  const build = new Function('deps', `
    const { queryDocs, patchDoc, batchCreate, putFile, patchObjectMeta, markPending, BUCKET, crypto, JOE, CHAT, docsFor, textPdf, MILESTONES, WORK_LOG, AUTHORITY, AGENDA, TELEHEALTH, CHECK_IN, silentWav, DAY } = deps;
    ${lift(f('public/js/preview/joe.js'), 'export function at(now, days, hour = 9, minute = 0) {').replace(/^export /, '')}
    ${lift(SHOW, 'function authorityItem(now, [days, hour, kind, fields]) {')}
    ${buildSrc}
    return buildShowcase;
  `)({
    queryDocs: async () => [], patchDoc: async (env, path, data) => { writes.push({ path, data }); return true; },
    batchCreate: async (env, rows) => { created.push(...rows); return { created: rows.length }; },
    putFile: async (env, path, bytes, type) => { puts.push({ path, type }); return { path, size: bytes.byteLength }; }, patchObjectMeta: async () => ({}), markPending: async () => {},
    BUCKET: 'b', crypto: { randomUUID: () => `u${++n}` }, JOE: mod.JOE, CHAT: mod.CHAT, docsFor: mod.docsFor, textPdf: pdf.textPdf,
    MILESTONES: mod.MILESTONES, WORK_LOG: mod.WORK_LOG, AUTHORITY: mod.AUTHORITY, AGENDA: mod.AGENDA, TELEHEALTH: mod.TELEHEALTH, CHECK_IN: mod.CHECK_IN, silentWav: JOEMOD.silentWav, DAY: 86_400_000,
  });
  const out = await build({}, { adminUid: 'eric' });
  const caseDoc = writes.find((w) => /^cases\/[^/]+$/.test(w.path))?.data || {};
  const under = (part) => created.filter((r) => r.path.includes(part));
  // Every entry on the list, and what proves the build writes it.
  const proof = {
    chat: () => under('/chat/').length === 50,
    documents: () => under('/chat/').some((r) => r.data.attachment) && out.documents >= 1,
    appointment: () => !!caseDoc.appointment?.start,
    report: () => !!caseDoc.reportDeliveredAt,
    fullService: () => caseDoc.fullAccess === true,
    milestones: () => under('/private/milestones/items/').length > 0,
    workLog: () => under('/private/clinicCalls/items/').length > 0,
    permissions: () => under('/private/authority/items/').length > 0,
    agenda: () => under('/agenda/').length === 3 && under('/agenda/').every((r) => r.data.text && ['admin', 'client'].includes(r.data.role) && r.data.done === false && r.data.doneAt === null && r.data.at)
      && under('/agenda/').some((r) => r.data.role === 'admin' && r.data.by === 'eric') && under('/agenda/').some((r) => r.data.role === 'client' && r.data.by === 'showcase-joe-bloe'),
    telehealth: () => Array.isArray(caseDoc.telehealthVisits) && caseDoc.telehealthVisits.length === 1
      && caseDoc.telehealthVisits[0].when > new Date() && caseDoc.telehealthVisits[0].confirmedAt && caseDoc.telehealthVisits[0].clinicName,
    // Added 2026-10-15 (v7.42) with the public preview: the next check-in and the call's recording.
    checkIn: () => Array.isArray(caseDoc.checkIns) && caseDoc.checkIns.some((x) => x.start > new Date()),
    recording: () => puts.some((p) => /\/recording\/[^/]+\.wav$/.test(p.path) && p.type === 'audio/wav'),
  };
  const covers = mod.SHOWCASE_COVERS || [];
  const missing = covers.filter((k) => !proof[k] || !proof[k]());
  // NEGATIVE CONTROL (run 2026-10-15): the build's agenda batchCreate taken out made this read
  //   FAIL  E1 the showcase writes every client-visible thing on its list: the chat with its documents, the call, the report, Full-Service, milestones, the log, permissions, the next-call list and a confirmed telehealth visit
  // RE-PINNED 2026-10-15 (v7.42): the list grew by the next check-in and the call's recording.
  // NEGATIVE CONTROL (run 2026-10-15, v7.42): a cover named 'nothing' added to SHOWCASE_COVERS made this read
  //   FAIL  E1 the showcase writes every client-visible thing on its list: ...
  check('E1 the showcase writes every client-visible thing on its list: the chat with its documents, the call, the report, Full-Service, milestones, the log, permissions, the next-call list and a confirmed telehealth visit',
    covers.length === Object.keys(proof).length && covers.every((k) => k in proof) && !missing.length && out.agenda === 3,
    JSON.stringify({ covers, missing, out }));
  // NEGATIVE CONTROL (run 2026-10-15): the demo sketch's telehealthVisits taken out made this read
  //   FAIL  E2 the demo's Joe Bloe carries the same next-call list and visit, the wipe takes the list with him, and the standing rule says every new client-visible feature joins him in the same push
  check('E2 the demo\'s Joe Bloe carries the same next-call list and visit, the wipe takes the list with him, and the standing rule says every new client-visible feature joins him in the same push',
    /telehealthVisits: \[\{\n\s+when: ago\(-6, 13\), clinicName: 'Owyhee Neurology Associates', provider: 'Dr\. Okafor',/.test(DEMO)
    && /store\.docs\.set\(`\$\{key\}\/agenda\/a\$\{i\}`, \{/.test(DEMO)
    && /'private\/authority\/items', 'agenda'\]\)/.test(SHOW)
    && /## The showcase stays current \(Eric, 2026-10-15\)/.test(CLAUDE) && /IN THE SAME PUSH/.test(CLAUDE) && /SHOWCASE_COVERS/.test(CLAUDE));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  for (const r of failed) console.log(`  FAILED: ${r.name}`);
  process.exit(1);
}
