// hardening.mjs - what four audits found, put right (v7.56).
//
// Eric, 2026-10-16: "Send out four agents to look for any errors in the UI,
// onboarding process, and functionality of new contractors once onboarded,
// and encryption/data security to be fixed and we'll call it a night."
//
//   S. security: the keyed diag's doors, an unverified address, sessions that
//      outlive a reset or a turn-off, the rules, another advocate's slot, a
//      turned-off advocate's pushes, a formula in the payroll sheet, a link
//      dressed as a file
//   O. onboarding: setup first, on the server, in the rules and in the browser
//   F. a contractor's own cases: their pushes, their name to their client
//   U. the screens: the duty draft, the saved shelf, the forms' pronouns, his
//      pages, the prices note, the folder label, the upload picker
//
// (Account creation, sessions on reset and turn-off, and a client's address
// are in advocates.mjs G18 to G20; payroll's turned-off rows in employer.mjs
// D7; the delete refusal in showcase.mjs X8.)
//
// Run: node hardening.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const W = f('worker/index.js');
const ADV = f('worker/advocates.js');
const PUSH = f('worker/push.js');
const RULES = f('firestore.rules');
const SRULES = f('storage.rules');
const CASE = f('public/js/case.js');
const ADMINCASE = f('public/js/admin-case.js');
const CHAT = f('public/js/chat.js');
const CHATP = f('public/js/chat-page.js');
const SAVED = f('public/js/saved.js');
const ACCT = f('public/js/admin-account.js');
const AUTH = f('public/js/auth.js');
const EMP = f('public/js/admin-employer.js');
const DEMO = f('public/js/demo/api.js');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
/** One top-level function's source, brace-matched from its signature. */
function lift(src, sig) {
  const i = src.indexOf(sig);
  if (i < 0) return '';
  let depth = 0;
  for (let k = src.indexOf('{', i + sig.length - 1); k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}' && --depth === 0) return src.slice(i, k + 1);
  }
  return '';
}
const STAFF = await import(pathToFileURL(join(ROOT, 'worker/staff.js')).href);
const FA = await import(pathToFileURL(join(ROOT, 'worker/firebase-auth.js')).href);
const AUTHORITY = await import(pathToFileURL(join(ROOT, 'public/js/authority.js')).href);
const ENV = { ADMIN_UID: 'eric' };
const jwt = (payload) => `x.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.y`;

console.log('\n--- S. security ---');
{
  const gate = (W.match(/const diagDo = url\.searchParams\.get\('do'\) \|\| '';\n\s+if \(diagDo && diagDo !== 'rules' && !\(await requireAdmin\(request, env\)\)\)\n\s+return json\(\{ error: 'Not found' \}, 404\);/) || [''])[0];
  const run = new Function('url', 'request', 'env', 'requireAdmin', 'json', `return (async () => { ${gate} return 'through'; })();`);
  const ask = (d, admin) => run(new URL(`https://x.test/api/diag?k=k${d ? `&do=${d}` : ''}`), {}, {}, async () => (admin ? { uid: 'eric' } : null), (o, st) => st);
  const out = gate ? [await ask('wipe-terms', false), await ask('wipe-terms', true), await ask('showcase', false), await ask('rules', false), await ask('', false)] : [];
  const doors = [...W.matchAll(/url\.searchParams\.get\('do'\) === '([\w-]+)'/g)].map((m) => ({ d: m[1], at: m.index })).filter((x) => x.d !== 'rules');
  // NEGATIVE CONTROL (run 2026-10-16): the gate's `!(await requireAdmin(request, env))` made `false` made this read
  //   FAIL  S1 the keyed diag's doors that build, wipe, probe or load test need his own session, whatever key is in the address; the read-only rules line and the plain read do not, and the plain read is kept for a minute
  check('S1 the keyed diag\'s doors that build, wipe, probe or load test need his own session, whatever key is in the address; the read-only rules line and the plain read do not, and the plain read is kept for a minute',
    !!gate && JSON.stringify(out) === JSON.stringify([404, 'through', 404, 'through', 'through'])
    && doors.length >= 6 && doors.every((x) => x.at > W.indexOf(gate))
    && /const hit = await caches\.default\.match\(diagKey\)\.catch\(\(\) => null\);\n\s+if \(hit\) return hit;/.test(W)
    && /diagRes\.headers\.set\('cache-control', 'max-age=60'\);\n\s+await caches\.default\.put\(diagKey, diagRes\.clone\(\)\)/.test(W),
    JSON.stringify({ out, doors: doors.length }));
}
{
  const src = lift(W, 'async function lookupUidByEmail(env, email) {');
  const mk = (users) => new Function('getAccessToken', 'fetch', `return ${src}`)(async () => 't', async () => ({ ok: true, json: async () => ({ users }) }));
  const out = src ? [
    await mk([{ localId: 'attacker', emailVerified: false }])({}, 'v@x.test'),
    await mk([{ localId: 'real', emailVerified: true }])({}, 'v@x.test'),
    await mk([{ localId: 'gone', emailVerified: true, disabled: true }])({}, 'v@x.test'),
    await mk([])({}, 'v@x.test'),
  ] : [];
  // NEGATIVE CONTROL (run 2026-10-16): lookupUidByEmail's `u.emailVerified === true &&` taken out made this read
  //   FAIL  S2 an account someone made under another person's address, unproven, never receives that person's sign-in: only a proven, live account is matched
  check('S2 an account someone made under another person\'s address, unproven, never receives that person\'s sign-in: only a proven, live account is matched',
    JSON.stringify(out) === JSON.stringify([null, 'real', null, null]), JSON.stringify(out));
}
{
  const a = { active: true, onboardedAt: 'x', sessionsFrom: 1000 };
  const prof = { data: { role: 'advocate' } };
  const stale = STAFF.staffFrom(ENV, { uid: 'a1', authTime: 999 }, prof, { data: a });
  const freshS = STAFF.staffFrom(ENV, { uid: 'a1', authTime: 1000 }, prof, { data: a });
  const none = STAFF.staffFrom(ENV, { uid: 'a1' }, prof, { data: { active: true, onboardedAt: 'x' } });
  const getDoc = async () => ({ data: a });
  const thread = { advocateId: 'a1' };
  const wStale = await STAFF.worksThread(ENV, 'a1', prof, thread, getDoc, { uid: 'a1', authTime: 999 });
  const wFresh = await STAFF.worksThread(ENV, 'a1', prof, thread, getDoc, { uid: 'a1', authTime: 2000 });
  const decoded = [FA.authTimeOf(jwt({ auth_time: 1760000000, uid: 'a1' })), FA.authTimeOf('not-a-token'), FA.authTimeOf(jwt({ x: 1 }))];
  // NEGATIVE CONTROL (run 2026-10-16): sessionStale's `!(Number(user?.authTime) >= from)` made `false` made this read
  //   FAIL  S3 a session begun before his reset or turn-off is no one, on every route and every thread; one begun since works; the session's start is read from its token and survives every refresh
  check('S3 a session begun before his reset or turn-off is no one, on every route and every thread; one begun since works; the session\'s start is read from its token and survives every refresh',
    stale === null && freshS?.uid === 'a1' && none?.uid === 'a1' && wStale === false && wFresh === true
    && JSON.stringify(decoded) === JSON.stringify([1760000000, 0, 0])
    && /return \{ uid: user\.localId, email: user\.email \|\| null, authTime: authTimeOf\(m\[1\]\) \};/.test(f('worker/firebase-auth.js'))
    && (W.match(/worksThread\(env, user\.uid, profile, [\w.]+, getDoc, user\)/g) || []).length === 6,
    JSON.stringify({ stale, freshS: !!freshS, wStale, wFresh, decoded }));
}
{
  const fsAdv = (RULES.match(/function isAdvocate\(\) \{[\s\S]*?\n {4}\}/) || [''])[0];
  const stAdv = (SRULES.match(/function isAdvocate\(\) \{[\s\S]*?\n {4}\}/) || [''])[0];
  const ups = (SRULES.match(/match \/cases\/\{caseId\}\/uploads\/\{fileName\} \{[\s\S]*?\n {4}\}/) || [''])[0];
  const chatFiles = (SRULES.match(/match \/cases\/\{caseId\}\/chat-files\/\{fileName\} \{[\s\S]*?\n {4}\}/) || [''])[0];
  const avail = (RULES.match(/match \/availability\/\{slotId\} \{[\s\S]*?\n {4}\}/) || [''])[0];
  const vm = (RULES.match(/function validMessage\(staffSide\) \{[\s\S]*?\n {4}\}/) || [''])[0];
  const TEXT = f('worker/rules-text.js');
  // NEGATIVE CONTROL (run 2026-10-16): firestore.rules' isAdvocate auth_time line taken out made this read
  //   FAIL  S4 the rules hold the same lines: an advocate reads only once set up and only in a session begun since the last reset or turn-off; a client adds files and never overwrites or labels one; a message's file is one this app stored; only open slots are public
  check('S4 the rules hold the same lines: an advocate reads only once set up and only in a session begun since the last reset or turn-off; a client adds files and never overwrites or labels one; a message\'s file is one this app stored; only open slots are public',
    [fsAdv, stAdv].every((x) => /\.data\.get\('mustChange', false\) != true/.test(x) && /\.data\.get\('onboardedAt', null\) != null/.test(x)
      && /request\.auth\.token\.auth_time >= [\s\S]*?\.data\.get\('sessionsFrom', 0\);/.test(x))
    && /allow create: if isCaseClient\(caseId\) &&[\s\S]*?noLabels\(\);/.test(ups) && !/allow write/.test(ups)
    && /allow create: if isCaseClient\(caseId\) &&[\s\S]*?noLabels\(\);/.test(chatFiles) && /allow write: if \(isAdmin\(\) \|\| isCaseAdvocate\(caseId\)\) &&/.test(chatFiles) && !/allow write: if \(isCaseClient/.test(chatFiles)
    && /hasAny\(\['paCategory', 'paName', 'paStarred'\]\)/.test(SRULES)
    && /request\.resource\.data\.attachment\.url\.matches\('\^https:\/\/firebasestorage\[\.\]googleapis\[\.\]com\/\.\*'\)/.test(vm)
    && /allow read: if resource\.data\.state == 'open' \|\| isAdmin\(\);/.test(avail) && !/allow read: if true/.test(avail)
    // What the Worker publishes is these files (rulesync.mjs S1 pins the two equal).
    && TEXT.includes('sessionsFrom') && TEXT.includes('noLabels'),
    JSON.stringify({ fsAdv: fsAdv.length, stAdv: stAdv.length, ups: ups.length, avail }));
}
{
  const sched = lift(W, 'async function handleAdminSchedule(request, env) {');
  const guard = sched.indexOf("if (advocateIdOf(slot.data, env) !== advocateIdOf(c, env))");
  // NEGATIVE CONTROL (run 2026-10-16): the schedule route's slot-owner refusal made `if (false)` made this read
  //   FAIL  S5 a booking never takes another advocate's slot: a slot that is someone else's is refused before it is booked, whoever asks
  check('S5 a booking never takes another advocate\'s slot: a slot that is someone else\'s is refused before it is booked, whoever asks',
    guard > 0 && guard < sched.indexOf('const bookSlot = () =>') && guard < sched.indexOf("Another client is already booked at that time.")
    && /return json\(\{ error: 'That time is on another advocate\\'s calendar\. Pick another time\.' \}, 409\);/.test(sched), String(guard));
}
{
  const src = lift(PUSH, 'export async function notifyUser(env, uid, { title, body, link, max = 10 }) {').replace(/^export /, '');
  const run = async (docs) => {
    const sent = [];
    const fn = new Function('getDoc', 'patchDoc', 'sendWebPush', `${src}\nreturn notifyUser;`)(
      async (env, p) => (docs[p] ? { data: docs[p] } : null), async () => true,
      async (env, sub, m) => { sent.push({ to: sub.endpoint, ...m }); return 201; });
    await fn({ ADMIN_UID: 'eric' }, 'ana', { title: 'Pocket Advocate', body: 'Dana sent you a message', link: '/admin-case.html?id=c1' });
    return sent;
  };
  const off = await run({ 'users/ana': { role: 'advocate', pushSubs: [{ endpoint: 'ana-phone' }] }, 'advocates/ana': { active: false, name: 'Ana Rivera' }, 'users/eric': { role: 'admin', pushSubs: [{ endpoint: 'eric-phone' }] } });
  const on = await run({ 'users/ana': { role: 'advocate', pushSubs: [{ endpoint: 'ana-phone' }] }, 'advocates/ana': { active: true, name: 'Ana Rivera' }, 'users/eric': { role: 'admin', pushSubs: [{ endpoint: 'eric-phone' }] } });
  // NEGATIVE CONTROL (run 2026-10-16): notifyUser's turned-off redirect (`if (adv?.data?.active !== true) {`) made `if (false) {` made this read
  //   FAIL  S6 a turned-off advocate's phone hears nothing more; the push goes to him, saying whose client it is; an advocate who is on hears their own
  check('S6 a turned-off advocate\'s phone hears nothing more; the push goes to him, saying whose client it is; an advocate who is on hears their own',
    off.length === 1 && off[0].to === 'eric-phone' && off[0].body === 'For Ana (turned off): Dana sent you a message' && off[0].link === '/admin-case.html?id=c1'
    && on.length === 1 && on[0].to === 'ana-phone' && on[0].body === 'Dana sent you a message', JSON.stringify({ off, on }));
}
{
  // The payroll sheet's cell, run as written.
  const cellSrc = (EMP.match(/const cell = \(v\) => \{\n[\s\S]*?\n {2}\};/) || [''])[0];
  const cell = cellSrc ? new Function(`${cellSrc}\nreturn cell;`)() : () => '';
  const cells = ['=HYPERLINK("x")', '+1+1', '@SUM(A1)', '-25.00', '1260.00', 'Dana, Whitfield', 'Ana'].map(cell);
  // NEGATIVE CONTROL (run 2026-10-16): the payroll cell's formula guard (`s = \`'${s}\``) taken out made this read
  //   FAIL  S7 a name or note that starts like a formula lands in his spreadsheet as text; amounts stay numbers
  check('S7 a name or note that starts like a formula lands in his spreadsheet as text; amounts stay numbers',
    JSON.stringify(cells) === JSON.stringify([`"'=HYPERLINK(""x"")"`, `"'+1+1"`, `"'@SUM(A1)"`, '-25.00', '1260.00', '"Dana, Whitfield"', 'Ana']), JSON.stringify(cells));
}
{
  const fnSrc = lift(CHAT, 'export function safeFileUrl(url) {').replace(/^export /, '');
  const safe = fnSrc ? new Function(`${fnSrc}\nreturn safeFileUrl;`)() : () => true;
  const urls = ['https://firebasestorage.googleapis.com/v0/b/x/o/cases%2Fa.pdf', 'https://storage.googleapis.com/x/a.pdf', 'blob:http://x/1', 'data:image/png;base64,AA',
    'javascript:alert(1)', 'https://evil.test/Lab results.pdf', 'http://firebasestorage.googleapis.com/x', 'data:text/html,<b>x</b>'];
  const render = lift(CHAT, 'function renderAttachment(att, saveUid) {');
  // NEGATIVE CONTROL (run 2026-10-16): renderAttachment's `if (!safeFileUrl(att.url)) {` made `if (false) {` made this read
  //   FAIL  S8 a file in a chat opens only when this app stored it; any other link, a script, or a page shows as its name, not a link
  check('S8 a file in a chat opens only when this app stored it; any other link, a script, or a page shows as its name, not a link',
    JSON.stringify(urls.map(safe)) === JSON.stringify([true, true, true, true, false, false, false, false])
    && render.indexOf('if (!safeFileUrl(att.url)) {') > 0 && render.indexOf('if (!safeFileUrl(att.url)) {') < render.indexOf("el.href = att.url;"),
    JSON.stringify(urls.map(safe)));
}

console.log('\n--- O. onboarding ---');
{
  const ready = STAFF.staffFrom(ENV, { uid: 'a1', authTime: 5 }, { data: { role: 'advocate' } }, { data: { active: true, onboardedAt: 'x' } });
  const newOne = STAFF.staffFrom(ENV, { uid: 'a1', authTime: 5 }, { data: { role: 'advocate' } }, { data: { active: true, onboardedAt: null } });
  const reset = STAFF.staffFrom(ENV, { uid: 'a1', authTime: 5 }, { data: { role: 'advocate' } }, { data: { active: true, onboardedAt: 'x', mustChange: true } });
  const owner = STAFF.setupPending({ owner: true, onboardedAt: null });
  const setupRoutes = [
    lift(ADV, 'async function staffMe(request, env, h) {'), lift(ADV, 'async function staffHeadshot(request, env, h) {'),
    lift(f('worker/payroll.js'), 'async function staffPayout(request, env, h) {'), lift(f('worker/employer.js'), 'async function staffChat(request, env, url, h) {'),
  ];
  const taker = [...W.matchAll(/await requireStaff\(request, env, \{ setup: true \}\)/g)].length;
  // NEGATIVE CONTROL (run 2026-10-16): setupPending's `(a.mustChange === true || !a.onboardedAt)` made `false` made this read
  //   FAIL  O1 an advocate who has not chosen their own password or finished setting up opens their account page and nothing else, on the server; a reset puts them back there; he never is
  check('O1 an advocate who has not chosen their own password or finished setting up opens their account page and nothing else, on the server; a reset puts them back there; he never is',
    ready?.setup === false && newOne?.setup === true && reset?.setup === true && owner === false
    && setupRoutes.every((r) => /h\.requireStaff\(request, env, \{ setup: true \}\)/.test(r)) && taker === 0,
    JSON.stringify({ ready: ready?.setup, newOne: newOne?.setup, reset: reset?.setup, owner, taker }));
  // NEGATIVE CONTROL (run 2026-10-16): auth.js's setup redirect (`if (known === 'advocate' && STAFF.setup &&`) made `if (false &&` made this read
  //   FAIL  O2 in the browser too: a contractor still setting up is taken to their account page from any other working page, and the Worker keeps the flag their page reads
  check('O2 in the browser too: a contractor still setting up is taken to their account page from any other working page, and the Worker keeps the flag their page reads',
    /if \(snapshot\.exists\(\)\) STAFF\.setup = role === 'advocate' && snapshot\.data\(\)\.setupPending === true;/.test(AUTH)
    && /if \(known === 'advocate' && STAFF\.setup && !\/\^\\\/admin-account\/\.test\(location\.pathname\)\) \{\n\s+location\.replace\('\/admin-account\.html\?setup=1'\);/.test(AUTH)
    && /\{ role: ADVOCATE_ROLE, email, name, setupPending: true \}/.test(ADV) && /\{ setupPending: false \}, \{ mask: \['setupPending'\] \}/.test(ADV)
    && /\{ setupPending: true \}, \{ mask: \['setupPending'\] \}/.test(ADV));
}
{
  const many = STAFF.cleanProfile({ specialties: ['Primary', 'A', 'B', 'C', 'D', 'E', 'F', 'G'], tz: 'America/Chicago' });
  const badTz = STAFF.cleanProfile({ tz: 'Mars/Olympus' });
  // NEGATIVE CONTROL (run 2026-10-16): cleanProfile's `.slice(0, MAX_EXTRA_SPECIALTIES + 1)` made `.slice(0, MAX_EXTRA_SPECIALTIES)` made this read
  //   FAIL  O3 their page keeps the primary and all six others, their time zone can be chosen from the list and only from it, and setup asks how they get paid
  check('O3 their page keeps the primary and all six others, their time zone can be chosen from the list and only from it, and setup asks how they get paid',
    many.specialties.length === 7 && many.tz === 'America/Chicago' && !('tz' in badTz)
    && /\['how you get paid', !!me\.payoutSet\],/.test(ACCT) && /<label>Your time zone<select name="tz">/.test(ACCT)
    && /missing\.push\('how you get paid'\)/.test(ADV) && /payoutSet: !!payout\?\.data\?\.method,/.test(ADV),
    JSON.stringify({ n: many.specialties.length, tz: many.tz, badTz }));
  // NEGATIVE CONTROL (run 2026-10-16): render()'s `applyDraft(host, draft);` taken out made this read
  //   FAIL  O4 what they typed and did not save survives a photo upload, a password or the Advisor choice; a saved profile redraws from what was saved
  check('O4 what they typed and did not save survives a photo upload, a password or the Advisor choice; a saved profile redraws from what was saved',
    /function render\(host, admin, \{ keep = true \} = \{\}\) \{\n\s+const draft = keep \? readDraft\(host\) : null;/.test(ACCT)
    && /\n\s+applyDraft\(host, draft\);\n\s+wire\(host, admin\);\n\}/.test(ACCT)
    && /setTimeout\(\(\) => render\(host, admin, \{ keep: false \}\), 700\);/.test(ACCT)
    && /if \(out\.token\) await signInWithCustomToken\(auth, out\.token\);/.test(ACCT));
  // NEGATIVE CONTROL (run 2026-10-16): the demo's `const staff = staffBase && (!setupPending() || SETUP_PATHS.has(path));` made `const staff = staffBase;` made this read
  //   FAIL  O5 the demo keeps the same rules: setup first, the same password rule, a client's address refused, the flag set and cleared, and payout and time zone on their page
  check('O5 the demo keeps the same rules: setup first, the same password rule, a client\'s address refused, the flag set and cleared, and payout and time zone on their page',
    /const staff = staffBase && \(!setupPending\(\) \|\| SETUP_PATHS\.has\(path\)\);/.test(DEMO)
    && (DEMO.match(/passwordProblem\(body\.(password|next)\)/g) || []).length >= 4
    && /That address already belongs to a client here\./.test(DEMO) && (DEMO.match(/setupPending: /g) || []).length >= 3
    && /payoutSet: !!store\.docs\.get\(`payouts\/\$\{me\}`\)\?\.method/.test(DEMO) && /if \('tz' in body && ZONES\.includes\(body\.tz\)\) next\.tz = body\.tz;/.test(DEMO));
}

console.log('\n--- F. a contractor\'s own cases ---');
{
  const src = `${lift(W, 'async function caseRecipients(env, c) {')}\n${lift(W, 'async function pingCase(env, c, body, link) {')}`;
  const sent = [];
  const mod = new Function('advocateIdOf', 'queryDocs', 'notifyUser', `${src}\nreturn { caseRecipients, pingCase };`)(
    (c, env) => (c?.advocateId || env.ADMIN_UID), async () => [{ id: 'eric' }], async (env, uid, m) => { sent.push([uid, m.body]); });
  await mod.pingCase({ ADMIN_UID: 'eric' }, { advocateId: 'ana' }, 'Dana confirmed the case you scheduled.', '/x');
  await mod.pingCase({ ADMIN_UID: 'eric' }, {}, 'Jo signed the form.', '/y');
  const uses = (W.match(/caseRecipients\(env, /g) || []).length + (W.match(/pingCase\(env, /g) || []).length;
  // NEGATIVE CONTROL (run 2026-10-16): caseRecipients' contractor branch made `if (false)` made this read
  //   FAIL  F1 a client's confirmation, signature, purchase, telehealth request, tip or appeal date on a contractor's case reaches that contractor; his own cases reach him; refunds stay his alone
  check('F1 a client\'s confirmation, signature, purchase, telehealth request, tip or appeal date on a contractor\'s case reaches that contractor; his own cases reach him; refunds stay his alone',
    JSON.stringify(sent) === JSON.stringify([['ana', 'Dana confirmed the case you scheduled.'], ['eric', 'Jo signed the form.']])
    && uses >= 19 && /await pingCase\(env, \{ advocateId \}, `\$\{firstName\(m\.name\)\} confirmed the case you scheduled\.`/.test(W)
    && /await pingAdmins\(env, `\$\{firstName\(c\.data\.clientName\)\} paid a case link their case had already paid\. Refund it from Stripe\.`/.test(W),
    JSON.stringify({ sent, uses }));
}
{
  const src = lift(W, 'async function caseAdvocateFirst(env, c) {');
  const fn = new Function('advocateIdOf', 'getDoc', 'firstName', `return ${src}`)(
    (c, env) => (c?.advocateId || env.ADMIN_UID), async (env, p) => (p === 'advocates/ana' ? { data: { name: 'Ana Rivera' } } : null), (s) => String(s).split(' ')[0]);
  const names = [await fn({ ADMIN_UID: 'eric' }, { advocateId: 'ana' }), await fn({ ADMIN_UID: 'eric' }, {}), await fn({ ADMIN_UID: 'eric' }, { advocateId: 'gone' })];
  // NEGATIVE CONTROL (run 2026-10-16): the pause push put back to `Eric has paused your case: ${note}` made this read
  //   FAIL  F2 a contractor's client reads their own advocate's name: the pause and hours pushes, the chat header and its doing line, the paused card, the follow-up note, the printed record, the saved shelf, the chat page's face and name
  // RE-PINNED 2026-10-17 (v7.63): Eric, "Yes, 'up to 20 hours'": the hours push says all 20 hours of the month, by their name still.
  // NEGATIVE CONTROL (run 2026-10-17, v7.63): the hours push put back to `Eric has delivered all ${hours} hours of your month.` made F2 read FAIL.
  check('F2 a contractor\'s client reads their own advocate\'s name: the pause and hours pushes, the chat header and its doing line, the paused card, the follow-up note, the printed record, the saved shelf, the chat page\'s face and name',
    JSON.stringify(names) === JSON.stringify(['Ana', 'Eric', 'Your advocate'])
    && /`\$\{await caseAdvocateFirst\(env, doc\.data\)\} has paused your case: \$\{note\}`/.test(W) && /`\$\{await caseAdvocateFirst\(env, c\)\} has delivered all \$\{hours\} hours/.test(W)
    && !/Eric has paused your case|Eric has delivered the/.test(W)
    && (CASE.match(/\$\{advFirstHtml\(c\)\}/g) || []).length >= 4
    && !/Eric, your advocate|From Eric:|>Eric is \$\{|Eric will promptly/.test(CASE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))
    && /otherName: advocateFirstNow\(c\.advocateId\),/.test(CASE) && /esc\(advocateFirstNow\(c\.advocateId\)\)/.test(CASE)
    && /myRole: 'client', otherName: advocateFirstNow\(c\.advocateId\) \}\);/.test(CASE)
    && /otherAvatar: advocatePhoto\(t\.advocateId \|\| ''\),\n\s+otherName: advocateFirstNow\(t\.advocateId\),/.test(CHATP),
    JSON.stringify(names));
}

console.log('\n--- U. the screens ---');
{
  const recC = AUTHORITY.recordsAuthorisation({ clientName: 'Priya Shah', advocateName: 'Ana Rivera', scopes: ['discuss'] });
  const recE = AUTHORITY.recordsAuthorisation({ clientName: 'Jo', advocateName: 'Eric Leach', scopes: ['discuss'] });
  const scopeC = AUTHORITY.scopeOfWork({ clientName: 'Priya Shah', advocateName: 'Ana Rivera', contactOk: true });
  const scopeE = AUTHORITY.scopeOfWork({ clientName: 'Jo', contactOk: true });
  // NEGATIVE CONTROL (run 2026-10-16): the records form's `${pron(o, 'him', 'them')}` made `him` made this read
  //   FAIL  U1 a contractor's forms say them and their; his say him and his, word for word as before; and a form is printed or sent only once the name is in
  check('U1 a contractor\'s forms say them and their; his say him and his, word for word as before; and a form is printed or sent only once the name is in',
    /communicate with them as a person/.test(recC) && /answer their questions/.test(recC) && !/ with him | his questions/.test(recC)
    && /communicate with him as a person/.test(recE) && /answer his questions/.test(recE)
    && /return their calls the same way/.test(scopeC) && /return his calls the same way/.test(scopeE)
    && /async function printAuthorityDoc\(item\) \{\n[\s\S]{0,200}?await caseAdvocateNameReady;\n\s+win\.document\.write/.test(ADMINCASE)
    && /try \{\n\s+await caseAdvocateNameReady;\n\s+for \(const form of picked\) \{/.test(ADMINCASE));
  // NEGATIVE CONTROL (run 2026-10-16): the composer filter put back to `!advocate || b.icon !== '✍️'` made this read
  //   FAIL  U2 a contractor is never handed his own story as a message: the duty of care draft and the message maker are his alone
  check('U2 a contractor is never handed his own story as a message: the duty of care draft and the message maker are his alone',
    /\}\]\.filter\(\(b\) => !advocate \|\| \(b\.icon !== '✍️' && b\.icon !== '⚕️'\)\),/.test(ADMINCASE));
  // NEGATIVE CONTROL (run 2026-10-16): admin-leads.js's contractor redirect taken out made this read
  //   FAIL  U3 his Leads, Calendar and Terms send a contractor back to their own shelf; their saved shelf names each line from the reader's side
  check('U3 his Leads, Calendar and Terms send a contractor back to their own shelf; their saved shelf names each line from the reader\'s side',
    /if \(STAFF\.role !== 'admin'\) \{ location\.replace\('\/admin\.html'\); return; \}/.test(f('public/js/admin-leads.js'))
    && /if \(user && STAFF\.role !== 'admin'\) location\.replace\('\/admin\.html'\);\nelse if \(user\) init\(\);/.test(f('public/js/admin-calendar.js'))
    && /if \(user && STAFF\.role !== 'admin'\) location\.replace\('\/admin\.html'\);\nelse if \(user\) load\(\);/.test(f('public/js/admin-dictionary.js'))
    && /const whoSaid = \(role\) => \(myRole === 'admin'/.test(SAVED) && !/'Eric' : 'You'/.test(SAVED));
  // NEGATIVE CONTROL (run 2026-10-16): the prices note put back to `when your calendar opens` made this read
  //   FAIL  U4 their account page points to their prices under Settings and promises no calendar, says the Advisor costs nothing until it opens on their cases, and payroll marks anyone turned off
  check('U4 their account page points to their prices under Settings and promises no calendar, says the Advisor costs nothing until it opens on their cases, and payroll marks anyone turned off',
    /Your prices are under ⚙ Settings, the cog at the top, and live the moment you save\./.test(ACCT) && !/calendar opens|calendar come next/.test(ACCT)
    && /It is not open on contractors' cases yet, so nothing is taken from your earnings until it is\./.test(ACCT)
    && /\$\{r\.off \? ' <span class="pr-chip">TURNED OFF<\/span>' : ''\}/.test(EMP));
  // NEGATIVE CONTROL (run 2026-10-16): buyTag's style put back to `color:var(--dim)` made this read
  //   FAIL  U5 the folder's purchase label is in the folder's own ink, and the upload picker sits inside its column
  check('U5 the folder\'s purchase label is in the folder\'s own ink, and the upload picker sits inside its column',
    // RE-PINNED 2026-10-17 (v7.74): a contractor's own service is tagged by its own name, in the same ink.
    // NEGATIVE CONTROL (run 2026-10-17, v7.74): buyTag's `c.service?.label ? esc(String(c.service.label).toUpperCase()) : ` taken out made U5 read FAIL.
    /<strong style="color:var\(--manila-ink\);opacity:\.78">\$\{c\.service\?\.label \? esc\(String\(c\.service\.label\)\.toUpperCase\(\)\) : c\.fullAccess \? 'FULL-SERVICE' : 'ADVOCACY CASE'\}<\/strong> · /.test(f('public/js/admin.js'))
    && /<select id="up-cat">/.test(ADMINCASE) && !/id="up-cat" style="margin-left/.test(ADMINCASE));
}
{
  // The files here that carried no dash before; the rest are held to the added-diff scan.
  const touched = ['worker/staff.js', 'worker/firebase-auth.js', 'worker/push.js', 'worker/advocates.js', 'worker/payroll.js',
    'public/js/admin-account.js', 'tools/suites/hardening.mjs'];
  const dashed = touched.filter((p) => DASH.test(f(p)));
  check('X1 nothing touched here carries a dash', !dashed.length, dashed.join(','));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
