// cleanup.mjs - the staff side, cleaned up for a new contractor.
//
// Eric, 2026-10-15: "I need three agents to remove redundancy, improve flow,
// and create understandable icons for each section on the admin side. It's
// confusing as fuck to a new contractor. Then come back with a plan to clean
// it up." Three audits came back; the plan ships in five pushes, and this
// suite grows a section with each one.
//
//   A. (v7.52) what was wrong today: a contractor's client told "Eric is
//      reading...", forms naming Eric on a contractor's case, a report
//      marked delivered by one file pick, the report clock restarted by every
//      recording, the Advisor line on a contractor's Uploads, the Advisor
//      opt-in's caveat, push links that opened the wrong place, and an inbox
//      one unreadable time could stop.
//   B. (v7.53) each case matches what was bought: Full-Service owes the first
//      consult and the work, never a report, and an upgrade replaces one not
//      yet delivered; the shelf groups by purchase; Priority Chat's same-day
//      promise is a reminder.
//   C. (v7.54) the doubles cut: Track retired, one Log, Saved under Notes,
//      the PDF on Uploads, one clock switch, each status said once, one-line
//      explanations.
//   D. (v7.55) one Team page (Advocates inside Employer mode) and one
//      Calendar page (Availability's tools as folds under the month).
//
// Run: node cleanup.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const W = f('worker/index.js');
const ADV = f('worker/advocates.js');
const CASE = f('public/js/admin-case.js');
const DASH = new RegExp('[\\u2013\\u2014]');
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

console.log('\n--- A. what was wrong today (v7.52) ---');
{
  // A1: whose name a status carries, run.
  const CHAT_REACTIONS = { reading: { label: 'Eric is reading…' }, seen: { label: 'Eric has seen your message' } };
  let labelFor = () => '';
  try {
    labelFor = new Function('CHAT_REACTIONS', `${lift(W, 'function statusLabelFor(reaction, uid, env, name) {')}\nreturn statusLabelFor;`)(CHAT_REACTIONS);
  } catch { /* an unliftable function reads as a failed check below */ }
  const env = { ADMIN_UID: 'eric' };
  const his = labelFor('reading', 'eric', env, 'Gg');
  const hers = labelFor('reading', 'ana', env, 'Ana');
  const nameless = labelFor('seen', 'ana', env, '');
  const react = lift(W, 'async function handleChatReact(request, env) {');
  const MA = await import(pathToFileURL(j(ROOT, 'public/js/msg-actions.js')).href);
  const before = MA.statusLabel({ label: 'Eric is reading…' });
  MA.setStatusName('Ana Rivera');
  const after = MA.statusLabel({ label: 'Eric is reading…' });
  MA.setStatusName('');
  // NEGATIVE CONTROL (run 2026-10-15, v7.52): statusLabelFor returning the label untouched made this read
  //   FAIL  A1 an advocate's status carries their own first name, stored and sent; his stay word for word, and their own sheet shows them theirs
  check('A1 an advocate\'s status carries their own first name, stored and sent; his stay word for word, and their own sheet shows them theirs',
    his === 'Eric is reading…' && hers === 'Ana is reading…' && nameless === 'Your advocate has seen your message'
    && /label: statusLabelFor\(reaction, user\.uid, env, ctx\.callerName\), kind: 'status'/.test(react)
    && /: record\.label;\n\s+await notifyUser\(env, target,/.test(react)
    && before === 'Eric is reading…' && after === 'Ana is reading…'
    && /if \(STAFF\.role === 'advocate'\) setStatusName\(STAFF\.name \|\| 'Your advocate'\);/.test(CASE)
    && /o\.textContent = `\$\{r\.emoji\} \$\{statusLabel\(r\)\}`;/.test(CASE)
    && (f('public/js/msg-actions.js').match(/<span>\$\{esc\(statusLabel\(r\)\)\}<\/span>/g) || []).length === 2,
    JSON.stringify({ his, hers, nameless, before, after }));

  // A2: whose name the forms carry, run.
  const docs = new Map([
    ['advocates/ana', { active: true, owner: false, name: ' Ana Rivera ' }],
    ['advocates/off', { active: false, owner: false, name: 'Turned Off' }],
    ['advocates/eric', { active: true, owner: true, name: 'Gg Gg' }],
  ]);
  let publicName = async () => ({});
  try {
    publicName = new Function('getDoc', 'UID_RE', `${lift(ADV, 'async function publicName(request, env, url, h) {')}\nreturn publicName;`)(
      async (e, p) => (docs.has(p) ? { data: docs.get(p) } : null), /^[\w-]{1,64}$/);
  } catch { /* read as a failed check */ }
  const h = { json: (o) => o };
  // A lookup that throws reads as a failed check, never as a crashed suite.
  const ask = (uid) => Promise.resolve().then(() => publicName({}, { ADMIN_UID: 'eric' }, new URL(`https://x.test/api/advocates/name?uid=${encodeURIComponent(uid)}`), h))
    .catch((e) => ({ threw: String(e.message || e) }));
  const named = { ana: await ask('ana'), off: await ask('off'), eric: await ask('eric'), nobody: await ask('nobody'), bad: await ask('../x') };
  const AUTH = await import(pathToFileURL(j(ROOT, 'public/js/authority.js')).href);
  const scope = AUTH.scopeOfWork({ advocateName: 'Ana Rivera', clientName: 'Jo' });
  const scopeHis = AUTH.scopeOfWork({ clientName: 'Jo' });
  const CLIENT = f('public/js/case.js');
  // NEGATIVE CONTROL (run 2026-10-15, v7.52): publicName answering for a turned-off advocate (`d?.active === true && d.owner` made `d?.owner`) made this read
  //   FAIL  A2 a form from a contractor's case names them, on both sides and on all three forms; his name his, and nobody else's is told
  // RE-PINNED 2026-10-17 (v7.67): his name on his forms is Eric Leach ("my name is Eric Leach. Not Eric Bleach").
  // NEGATIVE CONTROL (run 2026-10-17, v7.67): admin-case.js's fallback put back to the old name made A2 read FAIL.
  check('A2 a form from a contractor\'s case names them, on both sides and on all three forms; his name his, and nobody else\'s is told',
    named.ana.name === 'Ana Rivera' && named.off.name === null && named.eric.name === null && named.nobody.name === null && named.bad.name === null
    && /Advocate: Ana Rivera, patient advocate/.test(scope) && /Advocate: Eric Leach, patient advocate/.test(scopeHis)
    && /if \(p === '\/api\/advocates\/name' && request\.method === 'GET'\) return publicName\(request, env, url, h\);/.test(ADV)
    && /advocateName: caseAdvocateName \|\| 'Eric Leach',/.test(CASE) && /fetch\(`\/api\/advocates\/name\?uid=\$\{encodeURIComponent\(data\.advocateId\)\}`\)/.test(CASE)
    && /advocateName: \(await advocateNameFor\(c\.advocateId\)\) \|\| 'Eric Leach',/.test(CLIENT) && /advocateName: advName \|\| undefined,/.test(CLIENT)
    && !/'Eric Leach'/.test(CASE.replace(/caseAdvocateName \|\| 'Eric Leach'/, '')),
    JSON.stringify(named));

  // A3: the report comes after the call, and the clock starts once.
  const rec = W.slice(W.indexOf("} else if (action === 'recording-uploaded') {"), W.indexOf("} else if (action === 'summary-uploaded') {"));
  const rep = W.slice(W.indexOf("} else if (action === 'report-uploaded') {"), W.indexOf("} else if (action === 'confirm-request') {"));
  // NEGATIVE CONTROL (run 2026-10-15, v7.52): report-uploaded's `if (!doc.data.reportDueAt)` refusal taken out made this read
  //   FAIL  A3 a report is refused before the call, the clock starts once, and the page asks before anything says delivered
  check('A3 a report is refused before the call, the clock starts once, and the page asks before anything says delivered',
    /if \(!doc\.data\.reportDueAt\) return json\(\{ error: 'Mark the call done first\. The report comes after the call\.' \}, 409\);/.test(rep)
    && rep.indexOf('if (doc.data.self)') < rep.indexOf('if (!doc.data.reportDueAt)')
    && /const alreadyStarted = !!doc\.data\.reportDueAt;\n\s+if \(!alreadyStarted\) \{\n\s+const fields = \{ reportDueAt:/.test(rec)
    // RE-PINNED 2026-10-15 (v7.53): Full-Service's consult stamp is a write of its own ahead of the clock; the report
    // clock's part still writes once.
    // NEGATIVE CONTROL (run 2026-10-15, v7.53): the report-uploaded refusal taken out still made A3 read FAIL.
    && (rec.slice(rec.indexOf('const alreadyStarted')).match(/patchDoc\(/g) || []).length === 1
    && /<option value="" selected>Choose what this is<\/option>/.test(CASE) && /fileEl\.disabled = !cat\.value;/.test(CASE)
    && /const REPORT_SENT_ASK = 'This tells your client the report is delivered and closes their chat in 48 hours\. Continue\?';/.test(CASE)
    && /if \(b\.dataset\.action === 'report-uploaded' && !confirm\(REPORT_SENT_ASK\)\) return;/.test(CASE)
    && /if \(!c\.self && !c\.reportDueAt\) return fail\(409, 'Mark the call done first\. The report comes after the call\.'\);/.test(f('public/js/demo/api.js')));

  // A4: the Advisor, as a contractor meets it.
  const ACCT = f('public/js/admin-account.js');
  // NEGATIVE CONTROL (run 2026-10-15, v7.52): the caveat line taken back out of the Advisor panel made this read
  //   FAIL  A4 a contractor's Uploads names no Advisor, and their Advisor opt-in keeps its price with the caveat in his words, on its own line
  check('A4 a contractor\'s Uploads names no Advisor, and their Advisor opt-in keeps its price with the caveat in his words, on its own line',
    /Everything shared on this case, newest day first\.\$\{advocate \? '' : ' Tap 👨‍⚕️ on a file to hand it to the advisor, then press Update on the Read page\.'\}/.test(CASE)
    && /\$\{!advocate && reviewable\(r\)/.test(CASE)
    && /<p class="small" style="margin:0;"><strong>It is only an aid, not a diagnostic tool\.<\/strong>/.test(ACCT)
    && /It costs \$79 a month, taken from your earnings/.test(ACCT) && !DASH.test(ACCT));

  // A5: pushes open the right place, and the inbox survives a bad time.
  const CHATS = f('public/js/admin-chats.js');
  let lmTime = () => NaN;
  try { lmTime = new Function(`${lift(CHATS, 'function lmTime(t) {')}\nreturn lmTime;`)(); } catch { /* read below */ }
  const times = [lmTime({ lm: { ts: { seconds: 100 } } }), lmTime({ lm: { ts: 'not a time' } }), lmTime({ lm: { ts: { toDate: () => new Date(5) } } }), lmTime({})];
  // NEGATIVE CONTROL (run 2026-10-15, v7.52): lmTime's `Number.isFinite(ms) ? ms : 0` put back to `ms` made this read
  //   FAIL  A5 a message push opens on Chat, a subscriber's upload opens their thread, and one unreadable time cannot stop the inbox
  check('A5 a message push opens on Chat, a subscriber\'s upload opens their thread, and one unreadable time cannot stop the inbox',
    /adminLink = `\/admin-case\.html\?id=\$\{id\}&page=chat`;/.test(W)
    && /const link = kind === 'case' \? `\/admin-case\.html\?id=\$\{id\}` : `\/admin-chats\.html\?sub=\$\{id\}`;/.test(W)
    && !/admin-chats\.html\?id=/.test(W)
    && /if \(folder\.el\(asked\)\) folder\.show\(asked\);/.test(CASE)
    && times[0] === 100000 && times[1] === 0 && times[2] === 5 && times[3] === 0,
    JSON.stringify(times));

  // A6: a contractor's controls that did nothing, and the + pushed off the screen.
  const ADMIN = f('public/js/admin.js');
  // NEGATIVE CONTROL (run 2026-10-15, v7.52): '/admin-calendar.html' taken back out of HIS_ALONE made this read
  //   FAIL  A6 a contractor gets no dead review panel, none of his slots, no empty calendar and no one-line menu; the alerts card sits under the heading row
  check('A6 a contractor gets no dead review panel, none of his slots, no empty calendar and no one-line menu; the alerts card sits under the heading row',
    /\$\{advocate \? '' : `<details class="mgmt" data-k="review">/.test(CASE)
    && /const onlyFor = advocate \? \(asUid \|\| STAFF\.uid\) : '';/.test(CASE) && /if \(onlyFor && s\.advocateId !== onlyFor\) return;/.test(CASE)
    && /const HIS_ALONE = \[[^\]]*'\/admin-calendar\.html'\];/.test(f('public/js/admin-staffnav.js'))
    && /if \(items\.length === 1\) \{ items\[0\]\.click\(\); return; \}/.test(ADMIN)
    && /const under = h1\?\.closest\('\.clients-head'\) \|\| h1;\n\s+if \(under\) under\.after\(panel\); else mount\.prepend\(panel\);/.test(f('public/js/push.js')));
}

console.log('\n--- B. each case matches what was bought (v7.53) ---');
{
  // B1: Full-Service replaces a report not yet delivered, run, and both doors that switch it on use it.
  let replaced = () => null;
  try { replaced = new Function(`${lift(W, 'function reportReplaced(c) {')}\nreturn reportReplaced;`)(); } catch { /* read below */ }
  const due = new Date();
  const runs = {
    owed: replaced({ status: 'awaiting_report', reportDueAt: due }),
    delivered: replaced({ status: 'delivered', reportDueAt: due }),
    closed: replaced({ status: 'closed', reportDueAt: due }),
    none: replaced({ status: 'confirmed' }),
  };
  // NEGATIVE CONTROL (run 2026-10-15, v7.53): reportReplaced's `c.status !== 'delivered' &&` taken out made this read
  //   FAIL  B1 Full-Service drops a report still owed, keeps one delivered, and both doors that switch it on say so
  check('B1 Full-Service drops a report still owed, keeps one delivered, and both doors that switch it on say so',
    JSON.stringify(runs.owed) === '{"patch":{"reportDueAt":null},"mask":["reportDueAt"]}'
    && JSON.stringify(runs.delivered) === '{"patch":{},"mask":[]}' && JSON.stringify(runs.closed) === '{"patch":{},"mask":[]}'
    && JSON.stringify(runs.none) === '{"patch":{},"mask":[]}'
    && /const dropReport = reportReplaced\(c\.data\);\n\s+const okBuy = await patchDoc\(env, `cases\/\$\{caseId\}`, \{\n\s+\.\.\.dropReport\.patch,/.test(W)
    && /mask: \[\.\.\.dropReport\.mask, 'fullAccess', 'fullAccessAt', 'fullAccessRateCents'/.test(W)
    && /const dropReport = reportReplaced\(c\);\n\s+await patchDoc\(env, `cases\/\$\{caseId\}`, \{\n\s+\.\.\.dropReport\.patch,/.test(W)
    && /mask: \[\.\.\.dropReport\.mask, 'fullAccess', 'fullAccessAt', 'fullAccessOpenedAt'/.test(W),
    JSON.stringify(runs));

  // B2: the consult, not a report.
  const rec = W.slice(W.indexOf("} else if (action === 'recording-uploaded') {"), W.indexOf("} else if (action === 'summary-uploaded') {"));
  const fullPart = rec.slice(rec.indexOf('if (doc.data.fullAccess) {'), rec.indexOf('const alreadyStarted'));
  const rep = W.slice(W.indexOf("} else if (action === 'report-uploaded') {"), W.indexOf("} else if (action === 'confirm-request') {"));
  const DEMO = f('public/js/demo/api.js');
  // NEGATIVE CONTROL (run 2026-10-15, v7.53): report-uploaded's Full-Service refusal taken out made this read
  //   FAIL  B2 a Full-Service call stamps the consult done with no report clock and no report email, and a report is refused on it
  check('B2 a Full-Service call stamps the consult done with no report clock and no report email, and a report is refused on it',
    fullPart.length > 0 && /const fields = \{ consultDoneAt: now \};/.test(fullPart) && !/reportDueAt|sendEmail/.test(fullPart)
    && /return json\(\{ ok: true, consult: true \}\);/.test(fullPart)
    && rec.indexOf('if (doc.data.fullAccess) {') < rec.indexOf('const alreadyStarted')
    && /if \(doc\.data\.fullAccess\) return json\(\{ error: 'Full-Service has no written report\. File it as another type\.' \}, 409\);/.test(rep)
    && /if \(c\.fullAccess\) return fail\(409, 'Full-Service has no written report\. File it as another type\.'\);/.test(DEMO)
    && /consultDoneAt: now, \.\.\.\(c\.status === 'confirmed'/.test(DEMO));

  // B3: the shelf by what was bought, run where it can be.
  const ADMIN = f('public/js/admin.js');
  let shelfFns = {};
  try {
    shelfFns = new Function(`${lift(ADMIN, 'function toDate(v) {')}\n${lift(ADMIN, 'function badge(c) {')}\n${lift(ADMIN, 'function dueSoon(c) {')}\n${lift(ADMIN, 'function buyTag(c) {')}\nreturn { badge, dueSoon, buyTag };`)();
  } catch { /* read below */ }
  const overdue = new Date(Date.now() - 5 * 86_400_000);
  const fullCase = { fullAccess: true, status: 'awaiting_report', reportDueAt: overdue };
  const advCase = { status: 'awaiting_report', reportDueAt: overdue };
  const got = shelfFns.badge ? {
    fullBadge: shelfFns.badge(fullCase), advBadge: shelfFns.badge(advCase),
    fullSoon: shelfFns.dueSoon(fullCase), advSoon: shelfFns.dueSoon(advCase),
    tags: [shelfFns.buyTag(fullCase), shelfFns.buyTag(advCase), shelfFns.buyTag({ self: true })],
  } : {};
  // NEGATIVE CONTROL (run 2026-10-15, v7.53): badge()'s Full-Service line taken out made this read
  //   FAIL  B3 the shelf groups by what was bought: Full-Service has its own shelf and is never REPORT DUE or OVERDUE, and the call and a Priority Chat client waiting are reminders
  check('B3 the shelf groups by what was bought: Full-Service has its own shelf and is never REPORT DUE or OVERDUE, and the call and a Priority Chat client waiting are reminders',
    got.fullBadge === 'FULL-SERVICE' && got.advBadge === 'OVERDUE 5d' && got.fullSoon === false && got.advSoon === true
    && /FULL-SERVICE<\/strong> · $/.test(got.tags?.[0] || '') && /ADVOCACY CASE<\/strong> · $/.test(got.tags?.[1] || '') && got.tags?.[2] === ''
    && /const fullOpen = shelved\.filter\(\(c\) => c\.fullAccess && c\.status !== 'closed'\);/.test(ADMIN)
    && /section\('ADVOCACY CASES: REPORT PHASE', 'var\(--cyan\)', current\.map/.test(ADMIN) && /section\('FULL-SERVICE', 'var\(--gold\)', fullOpen\.map/.test(ADMIN)
    && /if \(callMissing\) loops\.push\(\{ href, name, label: `Call was \$\{dayFmt\.format\(new Date\(callAt\)\)\}: mark it done`, tone: 'warm' \}\);/.test(ADMIN)
    && /if \(!c\.fullAccess && c\.status === 'awaiting_report' && c\.reportDueAt\) \{/.test(ADMIN)
    && /if \(sub\.status !== 'active' \|\| sub\.lastMessage\?\.role !== 'client'\) continue;/.test(ADMIN)
    && /label: 'Priority Chat: reply today', tone: 'hot'/.test(ADMIN)
    && /badge: c\.self \? 'MY OWN CASE' : c\.fullAccess \? 'FULL-SERVICE' : 'ADVOCACY CASE',/.test(f('public/js/admin-chats.js')),
    JSON.stringify(got));

  // B4: the case page says what this case owes.
  // NEGATIVE CONTROL (run 2026-10-15, v7.53): the CONSULT row's branch taken out (back to the REPORT row on every case) made this read
  //   FAIL  B4 a Full-Service case page shows the consult, never a report due, and files no report; an Advocacy Case leads with the meeting link
  check('B4 a Full-Service case page shows the consult, never a report due, and files no report; an Advocacy Case leads with the meeting link',
    /if \(c\.fullAccess && c\.status !== 'delivered' && !c\.reportDeliveredAt\)\n\s+row\('CONSULT',/.test(CASE)
    // RE-PINNED 2026-10-16 (v7.54): NEXT names a report date only while it is ahead; past due is the overdue chip.
    // NEGATIVE CONTROL (run 2026-10-16, v7.54): the CONSULT row's branch taken out still made B4 read FAIL.
    && /if \(!c\.fullAccess && c\.status === 'awaiting_report' && c\.reportDueAt && toDate\(c\.reportDueAt\)\.getTime\(\) > nowMs\)\n\s+nextOf\.push/.test(CASE)
    && /c\.fullAccess && c\.status !== 'closed' \? 'FULL-SERVICE' :/.test(CASE)
    && /if \(data\.fullAccess\) cat\.querySelector\('option\[value="report"\]'\)\?\.remove\(\);/.test(CASE)
    && /<button class="btn secondary" data-action="recording-uploaded">Consult done<\/button>/.test(CASE)
    && /if \(link\) when\('Before the call'\)\?\.after\(link\);/.test(CASE) && /if \(forms\) when\('Ending it'\)\?\.before\(forms\);/.test(CASE)
    && /const callUnmarked = !c\.showcase && callAt && callAt \+ 3600_000 < Date\.now\(\)/.test(CASE));

  // B5: what the client reads, and the agreement.
  const CLIENT = f('public/js/case.js');
  const TERMS = f('public/js/tier-terms.js');
  const ABOUT = f('public/js/service-about.js');
  // NEGATIVE CONTROL (run 2026-10-15, v7.53): the agreement's old sentence ("the report still arrives as promised") put back made this read
  //   FAIL  B5 a Full-Service client reads Full-Service, not REPORT DUE, and the agreement says the work replaces the report
  check('B5 a Full-Service client reads Full-Service, not REPORT DUE, and the agreement says the work replaces the report',
    /const statusWord = \(c\) => \(c\.fullAccess && c\.status !== 'closed' \? 'FULL-SERVICE' : STATUS_LABEL\[c\.status\] \|\| c\.status\);/.test(CLIENT)
    // RE-PINNED 2026-10-17 (v7.62): the look audit, "FULL-SERVICE" read twice beside its pill; the words finish the name instead.
    // NEGATIVE CONTROL (run 2026-10-17, v7.62): kindWords back to `c.fullAccess ? 'Full-Service Case Management' : 'Advocacy Case'` made B5 read FAIL.
    && /const kindWords = pillText === 'FULL-SERVICE' \? 'Case Management' : c\.fullAccess \? 'Full-Service Case Management' : 'Advocacy Case';/.test(CLIENT)
    && /data-status-pill>\$\{pillText\}<\/span>\n\s+<span>\$\{kindWords\}<\/span>/.test(CLIENT)
    && /const stepsOf = \(c\) => \(c\?\.fullAccess && !c\.reportDeliveredAt \? FULL_STEPS : STEPS\);/.test(CLIENT)
    && !/STATUS_LABEL\[c\.status\] \|\| c\.status\}/.test(CLIENT)
    && /<strong>There is no written report with Full-Service: the work itself replaces it\.<\/strong>/.test(TERMS)
    && /Full-Service takes over from that day and replaces the report:/.test(TERMS)
    && !/report still arrives as promised/.test(TERMS) && !/the written report\. Then/.test(TERMS)
    && /'It starts from our initial consult and my record review\. No written report: the work replaces it',/.test(ABOUT)
    && !DASH.test(TERMS) && !DASH.test(ABOUT));
}

console.log('\n--- C. the doubles cut (v7.54) ---');
{
  const ADMIN = f('public/js/admin.js');
  const pageIds = [...CASE.matchAll(/\n\s+id: '([\w-]+)', title: '/g)].map((m) => m[1]);
  // NEGATIVE CONTROL (run 2026-10-16, v7.54): the Unanswered painter pointed back at folder.el('unanswered') made this read
  //   FAIL  C1 Track is retired: what is waiting on the client tops the Agenda under Mine, and About you lives in the Voice study fold on Clients
  check('C1 Track is retired: what is waiting on the client tops the Agenda under Mine, and About you lives in the Voice study fold on Clients',
    !/id: 'track'/.test(CASE) && !pageIds.includes('unanswered') && !pageIds.includes('about') && !pageIds.includes('saved') && !pageIds.includes('milestones')
    && /pages: \['notes', 'calldoc', 'drafts', 'agenda', 'personal'\]/.test(CASE)
    && /pane\.innerHTML = '<div data-waiting-host><\/div><div data-agenda-host><\/div>';/.test(CASE)
    && /paintUnanswered\(folder\?\.el\('agenda'\)\?\.querySelector\('\[data-waiting-host\]'\), d\.unanswered, d\.updatedAt\);/.test(CASE)
    && /<h3>\$\{unansweredSelf \? 'Waiting on you' : 'Waiting on them'\}<\/h3>/.test(CASE)
    && /if \(!open\.length\) \{ pane\.innerHTML = ''; return; \}/.test(CASE)
    && /return json\(\{ \.\.\.\(await voiceLoopState\(env\)\), about: await aboutYou\(env\) \}\);/.test(W)
    && /getDoc\(env, 'advisorStyle\/profile'\)/.test(lift(W, 'async function aboutYou(env) {'))
    && /\$\{aboutHtml\(voice\.about\)\}/.test(ADMIN) && /function aboutHtml\(a\) \{/.test(ADMIN)
    && /ls\.map\(\(x\) => `<li class="small">\$\{esc\(x\)\}<\/li>`\)/.test(ADMIN),
    JSON.stringify(pageIds));

  // NEGATIVE CONTROL (run 2026-10-16, v7.54): the Log page's `paintMilestones(miles);` taken out made this read
  //   FAIL  C2 the work log and the milestones are one Log, with a filter between them, under Act for him and for a contractor
  // RE-PINNED AND RENAMED 2026-10-17 (v7.65): Act is Log for him and for a contractor, the Appeals tab gone from it.
  // NEGATIVE CONTROL (run 2026-10-17, v7.65): the contractor's group label put back to 'Act' made this read
  //   FAIL  C2 the work log and the milestones are one Log, with a filter between them, its own Log tab for him and for a contractor
  check('C2 the work log and the milestones are one Log, with a filter between them, its own Log tab for him and for a contractor',
    /id: 'log', title: 'Log', icon: '🗒',/.test(CASE)
    && /paintWorkLog\(work\);\n\s+paintMilestones\(miles\);/.test(CASE)
    && /pane\._reload = \(\) => \{ work\._reload\?\.\(\); miles\._reload\?\.\(\); \};/.test(CASE)
    && /data-show="all" aria-pressed="true">Everything<\/button>/.test(CASE) && /data-show="miles" aria-pressed="false">Milestones<\/button>/.test(CASE)
    && /work\.hidden = show === 'miles';\n\s+miles\.hidden = show === 'work';/.test(CASE)
    && (CASE.match(/\{ id: 'act', label: 'Log', icon: 'i-check', pages: \['log'\] \},/g) || []).length === 2 && !/id: 'appeals'/.test(CASE)
    && /const ADVOCATE_PAGES = new Set\(\['overview', 'chat', 'files', 'notes', 'agenda', 'log'\]\);/.test(CASE)
    && /\.log-filter \.btn\.on \{/.test(f('public/css/admin.css')));

  // NEGATIVE CONTROL (run 2026-10-16, v7.54): the Chat row's Start button put back made this read
  //   FAIL  C3 Saved sits under Notes, the whole-file PDF on Uploads, and the clock has one switch, the one by the name
  check('C3 Saved sits under Notes, the whole-file PDF on Uploads, and the clock has one switch, the one by the name',
    /savedHost\.dataset\.savedHost = '';\n\s+pane\.appendChild\(savedHost\);\n\s+mountSaved\(\{ container: savedHost, kind: 'case', id: caseId, user, myRole: 'admin' \}\);/.test(CASE)
    && /pane\.prepend\(compileCardEl\(\)\);/.test(CASE)
    && !/data-work-toggle/.test(CASE.slice(CASE.indexOf("id: 'chat', title: 'Chat'"), CASE.indexOf('<div id="chat"></div>')))
    && /data-work-head/.test(CASE) && /if \(btn\) wireClockToggle\(btn\);/.test(CASE));

  // NEGATIVE CONTROL (run 2026-10-16, v7.54): the TELEHEALTH fact row put back made this read
  //   FAIL  C4 the Overview says each status once, NEXT only looks ahead, and the long explanations are one line
  check('C4 the Overview says each status once, NEXT only looks ahead, and the long explanations are one line',
    !/row\('TELEHEALTH'/.test(CASE) && !/row\('ALERT'/.test(CASE)
    && /<p class="dim small">Topics for the next call, from you and the client\.<\/p>/.test(CASE)
    && /<p class="dim small">Book or move this client at any time\.<\/p>/.test(CASE)
    && /Pausing stops this case's clocks\. Insurance appeal deadlines keep running\./.test(CASE)
    && /Uploading a recording or report does this for you\. Use these buttons only to correct it\./.test(CASE)
    && /Your record of the work\. <strong>Your client sees an entry only if you fill in the client line\.<\/strong>/.test(CASE)
    && /Wins on this case\. <strong>Your client sees every one\.<\/strong>/.test(CASE)
    && /They send it back, and you file it as a filled form\./.test(CASE));
}

console.log('\n--- D. one Team page, one Calendar page (v7.55) ---');
{
  const { readdirSync, existsSync } = await import('node:fs');
  const EMP = f('public/js/admin-employer.js');
  const ACC = f('public/js/admin-accounts.js');
  // NEGATIVE CONTROL (run 2026-10-16, v7.55): the team card's Account button taken out made this read
  //   FAIL  D1 one Team page: Employer mode adds advocates and opens each one's account, the Advocates tab is gone and its address forwards there
  check('D1 one Team page: Employer mode adds advocates and opens each one\'s account, the Advocates tab is gone and its address forwards there',
    /import \{ listAccounts, openAddAdvocate, openAccount, paintOff \} from '\.\/admin-accounts\.js';/.test(EMP)
    && /\$\{p\.owner \|\| p\.sample \? '' : '<button type="button" class="btn quiet" data-account>Account<\/button>'\}/.test(EMP)
    && /data-add-adv/.test(f('public/admin-employer.html')) && /id="team-off"/.test(f('public/admin-employer.html'))
    && ["action: 'create'", "action: 'update', commissionPct: pct", "action: 'reset-password'", "action: 'deactivate'", "action: 'activate'", 'advisorEnabled: on'].every((t) => ACC.includes(t))
    && /danger: true,/.test(ACC)
    && !/admin-advocates\.html', 'Advocates'/.test(f('public/js/admin-staffnav.js'))
    && !existsSync(j(ROOT, 'public/js/admin-advocates.js'))
    && /location\.replace\('\/admin-employer\.html'\);/.test(f('public/admin-advocates.html'))
    && /link: '\/admin-employer\.html',/.test(ADV)
    && /'\/js\/admin-accounts\.js',/.test(f('tools/blindness-audit.mjs')) && !DASH.test(ACC));

  const pages = readdirSync(j(ROOT, 'public')).filter((n) => /^admin.*\.html$/.test(n));
  const withLink = pages.filter((n) => /<a href="\/admin-availability\.html"/.test(f(`public/${n}`)));
  const CALH = f('public/admin-calendar.html');
  // NEGATIVE CONTROL (run 2026-10-16, v7.55): admin-calendar.js's mountAvailability call taken out made this read
  //   FAIL  D2 one Calendar page: opening slots, taking new cases and each day's open slots are folds under the month, Availability's address forwards, and no menu names it
  check('D2 one Calendar page: opening slots, taking new cases and each day\'s open slots are folds under the month, Availability\'s address forwards, and no menu names it',
    /import \{ mountAvailability \} from '\.\/admin-availability\.js';/.test(f('public/js/admin-calendar.js'))
    && /if \(user && STAFF\.role === 'admin'\) mountAvailability\(user\);/.test(f('public/js/admin-calendar.js'))
    && /export function mountAvailability\(signedIn\) \{/.test(f('public/js/admin-availability.js'))
    && !/hydrateNav\(\);/.test(f('public/js/admin-availability.js'))
    && ['<summary><strong>Taking new cases</strong></summary>', '<summary><strong>Open new slots</strong></summary>', '<summary><strong>Open slots, by day</strong></summary>'].every((t) => CALH.includes(t))
    && /8am to 7pm\./.test(CALH) && !/id="office"/.test(CALH)
    && /location\.replace\('\/admin-calendar\.html'\);/.test(f('public/admin-availability.html'))
    && withLink.length === 0,
    JSON.stringify(withLink));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
