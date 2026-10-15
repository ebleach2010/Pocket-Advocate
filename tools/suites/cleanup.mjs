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
  check('A2 a form from a contractor\'s case names them, on both sides and on all three forms; his name his, and nobody else\'s is told',
    named.ana.name === 'Ana Rivera' && named.off.name === null && named.eric.name === null && named.nobody.name === null && named.bad.name === null
    && /Advocate: Ana Rivera, patient advocate/.test(scope) && /Advocate: Eric Bleach, patient advocate/.test(scopeHis)
    && /if \(p === '\/api\/advocates\/name' && request\.method === 'GET'\) return publicName\(request, env, url, h\);/.test(ADV)
    && /advocateName: caseAdvocateName \|\| 'Eric Bleach',/.test(CASE) && /fetch\(`\/api\/advocates\/name\?uid=\$\{encodeURIComponent\(data\.advocateId\)\}`\)/.test(CASE)
    && /advocateName: \(await advocateNameFor\(c\.advocateId\)\) \|\| 'Eric Bleach',/.test(CLIENT) && /advocateName: advName \|\| undefined,/.test(CLIENT)
    && !/'Eric Bleach'/.test(CASE.replace(/caseAdvocateName \|\| 'Eric Bleach'/, '')),
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
    && (rec.match(/patchDoc\(/g) || []).length === 1
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

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
