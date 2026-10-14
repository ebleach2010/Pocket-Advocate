// leads.mjs - the question box, the Leads tab, and the one-screen home.
//
// Eric, 2026-10-14: "Unlock priority chat and remove banner. Have a yellow
// shiny outline around it with an animated ease in ease out bright spot
// circling around the line. Reorient everything so everything on the main
// page fits without scrolling. Then add a hamburger menu symbol at the top
// right where tabs for every other section appears. Have a chat box icon at
// the bottom right of the screen and it opens up a window that says
// 'questions? Type them down below and I'll get back to you within two
// days.' They put their name and email and question and press send to have
// it sent to my inbox. Once sent, remind them to check their spam box in
// case my reply gets sent there. Once the admin side, any person who has
// submitted their information through any route gets added to a 'leads'
// tab. This is a simple exportable csv that goes row by row for each
// potential client." Then: "make the glowing line around the chat (which
// should be positioned at the top of the list) the same gradient and effect
// as the waitlist button is right now."
//
// The Worker's two routes and the page's CSV maker are lifted and RUN. The
// home fitting one screen is measured by drive-landing.mjs, in a browser.
//
// Run: node leads.mjs
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';

const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
const SRC = readFileSync(__j(__REPO, 'worker/index.js'), 'utf8');
const f = (p) => readFileSync(__j(__REPO, p), 'utf8');
const DASH = /[\u2013\u2014]/;

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
function fn(name) {
  const m = SRC.match(new RegExp(`\\nasync function ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
function sfn(name) {
  const m = SRC.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n\\}`));
  if (!m) throw new Error(`could not lift ${name}`);
  return m[0];
}
function konst(name) {
  const m = SRC.match(new RegExp(`\\nconst ${name} = [\\s\\S]*?;\\n`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0];
}

// ---- the world the lifted code runs in ------------------------------------
let docs, pushes, emails, adminOk, failing;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const rows = (coll) => [...docs.entries()]
  .filter(([p]) => p.startsWith(`${coll}/`) && p.split('/').length === 2)
  .map(([p, d]) => ({ id: p.split('/')[1], data: clone(d) }));
const deps = {
  getDoc: async (env, path) => (docs.has(path) ? { data: clone(docs.get(path)) } : null),
  patchDoc: async (env, path, patch, opts = {}) => {
    if (opts.mustNotExist && docs.has(path)) return false;
    docs.set(path, { ...(docs.get(path) || {}), ...clone(patch) });
    return true;
  },
  queryDocs: async (env, coll, filters) => rows(coll).filter((r) => filters.every(([k, op, v]) => op !== 'EQUAL' || r.data[k] === v)),
  listDocs: async (env, coll) => { if (failing === coll) throw new Error('refused'); return rows(coll); },
  notifyUser: async (env, uid, msg) => { pushes.push({ uid, ...msg }); },
  sendEmail: async (env, msg) => { emails.push(msg); return true; },
  requireAdmin: async () => (adminOk ? { uid: 'eric' } : null),
  crypto: webcrypto,
};
const LIFTED = [
  konst('WAITLIST_PACKAGES'), konst('QUESTION_MAX'), konst('QUESTION_IP_LIMIT'), konst('LEAD_SOURCES'),
  sfn('str'), sfn('escHtml'), sfn('json'), sfn('firstName'), sfn('leadRows'), sfn('mergeLeads'),
  fn('pingAdmins'), fn('questionThrottled'), fn('handleQuestion'), fn('handleAdminLeads'),
].join('\n');
const W = new Function(...Object.keys(deps), `${LIFTED}
  return { handleQuestion, handleAdminLeads, QUESTION_MAX };`)(...Object.values(deps));
const env = { ADMIN_EMAIL: 'eric@example.com', PUBLIC_BASE_URL: 'https://example.com' };
const req = (body, { ip = '1.2.3.4', method = 'POST' } = {}) => ({
  method, json: async () => body, headers: { get: (k) => (k === 'cf-connecting-ip' ? ip : null) },
});
function reset() {
  docs = new Map(); pushes = []; emails = []; adminOk = true; failing = '';
  docs.set('users/eric', { role: 'admin' });
}
const GOOD = { name: 'Riley Test', email: 'Riley@Example.com', question: 'Do you work with POTS?\nAnd MCAS?', website: '' };
const ask = async (body, opts) => { const r = await W.handleQuestion(req(body, opts), env); return { status: r.status, out: await r.json() }; };
const leads = async () => { const r = await W.handleAdminLeads(req(null, { method: 'GET' }), env); return { status: r.status, out: await r.json() }; };

// ---------------------------------------------------------------------------
console.log('\n--- A. the question box ---');
reset();
{
  const r = await ask(GOOD);
  const q = rows('questions');
  const e = emails[0];
  // NEGATIVE CONTROL (run 2026-10-14): `replyTo: email,` taken out of the email made this read
  //   FAIL  A1 a question lands in his inbox with every answer, the reply going straight back to them, and is kept for Leads
  check('A1 a question lands in his inbox with every answer, the reply going straight back to them, and is kept for Leads',
    r.status === 200 && r.out.ok === true && emails.length === 1 && e.to === 'eric@example.com' && e.replyTo === 'riley@example.com'
    && e.subject === 'NEW QUESTION FROM RILEY TEST' && /Name: Riley Test<br>Email: riley@example\.com/.test(e.html)
    && /Do you work with POTS\?<br>And MCAS\?/.test(e.html)
    && q.length === 1 && q[0].data.name === 'Riley Test' && q[0].data.email === 'riley@example.com' && /MCAS/.test(q[0].data.question),
    JSON.stringify({ e, q }));
  // NEGATIVE CONTROL (run 2026-10-14): the pingAdmins line in handleQuestion switched off made this read
  //   FAIL  A2 and a push to his phone that points at Leads
  check('A2 and a push to his phone that points at Leads',
    pushes.length === 1 && pushes[0].uid === 'eric' && /Riley asked a question\./.test(pushes[0].body) && pushes[0].link === '/admin-leads.html');
}
reset();
{
  await ask({ ...GOOD, name: '<b>R</b>', question: '<img src=x onerror=alert(1)>' });
  // NEGATIVE CONTROL (run 2026-10-14): escHtml taken off the question in his email made this read
  //   FAIL  A3 what they type is escaped in his email
  check('A3 what they type is escaped in his email', !/<img|<b>R/.test(emails[0]?.html || '') && /&lt;img/.test(emails[0]?.html || ''));
}
{
  const bad = [
    [{ name: ' ' }, 'Your name, please.'],
    [{ email: 'riley@' }, 'A working email address, please. My answer goes there.'],
    [{ question: 'x' }, 'Type your question, please.'],
    [{ question: 'x'.repeat(2001) }, 'Keep it under 2000 characters, please.'],
  ];
  const got = [];
  for (const [patch, msg] of bad) {
    reset();
    const r = await ask({ ...GOOD, ...patch });
    got.push(r.status === 400 && r.out.error === msg && !rows('questions').length && !emails.length && !pushes.length);
  }
  reset();
  const trap = await ask({ ...GOOD, website: 'http://spam.example' });
  got.push(trap.status === 200 && !rows('questions').length && !emails.length);
  // NEGATIVE CONTROL (run 2026-10-14): the question length check deleted made this read
  //   FAIL  A4 a missing name, a bad email, an empty or overlong question are 400s in plain words, a filled honeypot a quiet 200, and none of them is written or sent
  check('A4 a missing name, a bad email, an empty or overlong question are 400s in plain words, a filled honeypot a quiet 200, and none of them is written or sent',
    got.every(Boolean), JSON.stringify(got));
  // The page says the same things, in the same order.
  const page = f('public/js/question.js');
  const problem = new Function(`const QUESTION_MAX = 2000; ${(page.match(/export function questionProblem\([\s\S]*?\n\}/) || [''])[0].replace('export ', '')}; return questionProblem;`)();
  const same = bad.every(([patch, msg]) => problem({ ...GOOD, ...patch, name: (patch.name ?? GOOD.name).trim() }) === msg) && problem(GOOD) === '';
  // NEGATIVE CONTROL (run 2026-10-14): the page's email check deleted made this read
  //   FAIL  A5 the page refuses what the Worker refuses, in the same words, and posts to /api/question
  check('A5 the page refuses what the Worker refuses, in the same words, and posts to /api/question',
    same && /fetch\('\/api\/question'/.test(page) && /export const QUESTION_MAX = 2000;/.test(page));
}
{
  const cells = new Map();
  globalThis.caches = { default: {
    match: async (k) => (cells.has(k.url) ? new Response(cells.get(k.url)) : undefined),
    put: async (k, res) => { cells.set(k.url, await res.text()); },
  } };
  reset();
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await ask({ ...GOOD, name: '' })).status);
  delete globalThis.caches;
  // NEGATIVE CONTROL (run 2026-10-14): `n >= QUESTION_IP_LIMIT` to `n > QUESTION_IP_LIMIT` made this read
  //   FAIL  A6 the sixth try from one connection in an hour is 429, counted before the body is read, in its own bucket
  check('A6 the sixth try from one connection in an hour is 429, counted before the body is read, in its own bucket',
    codes.slice(0, 5).every((c) => c === 400) && codes[5] === 429 && [...cells.keys()].every((k) => k.startsWith('https://question-throttle.internal/'))
    && /questionThrottled\(ip\)[\s\S]*request\.json\(\)/.test(fn('handleQuestion')), codes.join());
}
{
  const email = f('worker/email.js');
  // NEGATIVE CONTROL (run 2026-10-14): the reply_to line taken out of email.js made this read
  //   FAIL  A7 sendEmail carries a Reply-To when given one, and only then
  check('A7 sendEmail carries a Reply-To when given one, and only then',
    /export async function sendEmail\(env, \{ to, subject, html, replyTo \}\)/.test(email) && /\.\.\.\(replyTo \? \{ reply_to: replyTo \} : \{\}\)/.test(email));
}

// ---------------------------------------------------------------------------
console.log('\n--- B. Leads ---');
reset();
{
  const t = (d) => new Date(`2026-10-${d}T18:00:00Z`).toISOString();
  docs.set('waitlist/a', { first: 'Riley', last: 'Test', email: 'riley@example.com', phone: '+1 208 555 0100', package: 'chat', createdAt: t('10') });
  docs.set('questions/q1', { name: 'Riley T', email: 'RILEY@example.com', question: 'POTS?', createdAt: t('12') });
  docs.set('questions/q2', { name: 'Sam Lee', email: 'sam@example.com', question: 'Do you take Canada?', createdAt: t('11') });
  docs.set('leads/l1', { name: 'Pat Old', email: 'pat@example.com', phone: '208-555-0111', note: 'Long story', createdAt: t('01') });
  docs.set('cases/c1', { clientName: 'Jo Case', clientEmail: 'jo@example.com', clientPhone: '2085550122', fullAccess: true, createdAt: t('05') });
  docs.set('cases/self', { self: true, clientName: 'Eric', clientEmail: 'eric@example.com', createdAt: t('06') });
  docs.set('cases/show', { showcase: true, clientName: 'Joe Bloe', clientEmail: 'joe@example.com', createdAt: t('07') });
  docs.set('subscriptions/u1', { email: 'sam@example.com', startedAt: t('13') });
  const r = await leads();
  const L = r.out.leads || [];
  const by = (e) => L.find((x) => x.email === e) || {};
  // NEGATIVE CONTROL (run 2026-10-14): 'questions' taken out of LEAD_SOURCES made this read
  //   FAIL  B1 every route lands: the waitlist, the question box, free calls, booked cases and chat, one row per person, newest contact first
  check('B1 every route lands: the waitlist, the question box, free calls, booked cases and chat, one row per person, newest contact first',
    r.status === 200 && L.length === 4 && L.map((x) => x.email).join() === 'sam@example.com,riley@example.com,jo@example.com,pat@example.com'
    && by('riley@example.com').cameThrough === 'Waitlist; Question' && by('sam@example.com').cameThrough === 'Question; Priority Chat'
    && by('pat@example.com').cameThrough === 'Free call' && by('jo@example.com').cameThrough === 'Booked a case',
    JSON.stringify(L.map((x) => [x.email, x.cameThrough])));
  const riley = by('riley@example.com');
  // NEGATIVE CONTROL (run 2026-10-14): the email lowercasing in leadRows taken out made this read
  //   FAIL  B2 one person is one email whatever its case: their newest name, their phone, what they want, their words, first and last contact
  check('B2 one person is one email whatever its case: their newest name, their phone, what they want, their words, first and last contact',
    riley.name === 'Riley T' && riley.phone === '+1 208 555 0100' && riley.interestedIn === '24/7 Priority Chat' && riley.notes === 'POTS?'
    && riley.firstContact === t('10') && riley.lastContact === t('12')
    && by('jo@example.com').interestedIn === 'Full-Service Case Management' && by('pat@example.com').notes === 'Long story',
    JSON.stringify(riley));
  // NEGATIVE CONTROL (run 2026-10-14): the self and showcase skip in leadRows taken out made this read
  //   FAIL  B3 his own case and the invented showcase are never leads
  check('B3 his own case and the invented showcase are never leads', !by('eric@example.com').email && !by('joe@example.com').email);
  failing = 'cases';
  const part = await leads();
  failing = '';
  // NEGATIVE CONTROL (run 2026-10-14): `else missing.push(label);` deleted made this read
  //   FAIL  B4 a source that cannot be read is named, never quietly left out of the export
  check('B4 a source that cannot be read is named, never quietly left out of the export',
    part.status === 200 && JSON.stringify(part.out.missing) === '["Booked a case"]' && part.out.leads.length === 3);
  adminOk = false;
  const stranger = await leads();
  // NEGATIVE CONTROL (run 2026-10-14): the leads route's 404 turned into a 403 made this read
  //   FAIL  B5 a stranger gets the same 404 as every admin route
  check('B5 a stranger gets the same 404 as every admin route', stranger.status === 404 && !stranger.out.leads);
}
{
  const page = f('public/js/admin-leads.js');
  const lift = (name) => new Function(`${(page.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}`)) || [''])[0].replace('export ', '')}; return ${name};`);
  const COLUMNS = new Function(`${(page.match(/export const COLUMNS = [\s\S]*?\];/) || [''])[0].replace('export ', '')}; return COLUMNS;`)();
  const cell = lift('cell')();
  const day = lift('day')();
  const toCsv = new Function('COLUMNS', 'cell', 'day', `${(page.match(/export function toCsv\([\s\S]*?\n\}/) || [''])[0].replace('export ', '')}; return toCsv;`)(COLUMNS, cell, day);
  const csv = toCsv([
    { firstContact: '2026-10-10T18:00:00.000Z', lastContact: '2026-10-12T06:30:00.000Z', name: 'Riley, "R" Test', email: 'riley@example.com', phone: '+1 208 555 0100', interestedIn: '24/7 Priority Chat', cameThrough: 'Waitlist; Question', notes: 'POTS?\nMCAS?' },
    { firstContact: null, lastContact: null, name: '=HYPERLINK("http://x")', email: 'x@example.com', phone: '', interestedIn: '', cameThrough: 'Question', notes: '@SUM(A1)' },
  ]);
  const lines = csv.split('\r\n');
  // NEGATIVE CONTROL (run 2026-10-14): the quoting in cell() taken out made this read
  //   FAIL  B6 the CSV is a header row then one row per person, quoted where it must be, dated in his time, phones intact, and nothing typed in a form runs as a formula
  check('B6 the CSV is a header row then one row per person, quoted where it must be, dated in his time, phones intact, and nothing typed in a form runs as a formula',
    lines[0] === 'First contact,Last contact,Name,Email,Phone,Interested in,Came through,Questions and notes'
    && lines[1] === '2026-10-10,2026-10-11,"Riley, ""R"" Test",riley@example.com,+1 208 555 0100,24/7 Priority Chat,Waitlist; Question,"POTS?\nMCAS?"'
    && lines[2] === ',,"\'=HYPERLINK(""http://x"")",x@example.com,,,Question,\'@SUM(A1)' && lines.length === 4 && csv.endsWith('\r\n'),
    JSON.stringify(lines));
  const html = f('public/admin-leads.html');
  // NEGATIVE CONTROL (run 2026-10-14): the Download CSV button taken off admin-leads.html made this read
  //   FAIL  B7 the Leads tab has its table, its Download CSV button and its module, and every admin page's nav carries it after Clients
  const navs = ['admin', 'admin-calendar', 'admin-chats', 'admin-availability', 'admin-dictionary', 'admin-case', 'admin-fund', 'admin-leads']
    .every((n) => /<a href="\/admin\.html"( class="active")?>Clients<\/a>\s*<a href="\/admin-leads\.html"( class="active")?>Leads<\/a>/.test(f(`public/${n}.html`)));
  check('B7 the Leads tab has its table, its Download CSV button and its module, and every admin page\'s nav carries it after Clients',
    /<button type="button" class="btn glow" id="leads-csv" disabled>Download CSV<\/button>/.test(html)
    && /<script type="module" src="\/js\/admin-leads\.js"><\/script>/.test(html) && navs
    && /fetch\('\/api\/admin\/leads'/.test(page) && /a\.download = `pocket-advocate-leads-\$\{day\(/.test(page));
  const audit = f('tools/blindness-audit.mjs');
  // NEGATIVE CONTROL (run 2026-10-14): '/js/admin-leads.js' taken out of the audit's admin list made this read
  //   FAIL  B8 the audit gates the Leads page and its module
  check('B8 the audit gates the Leads page and its module', /'\/admin-leads'/.test(audit) && /'\/js\/admin-leads\.js',/.test(audit));
}

// ---------------------------------------------------------------------------
console.log('\n--- C. the home ---');
{
  const idx = f('public/index.html');
  const css = f('public/css/landing.css');
  const ask = (idx.match(/<dialog class="wl-sheet ask-sheet" id="ask"[\s\S]*?<\/dialog>/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-14): "within two days" changed to "soon" in the sheet made this read
  //   FAIL  C1 a chat icon at the bottom right opens his words, asks for name, email and question, and after Send reminds them about spam
  check('C1 a chat icon at the bottom right opens his words, asks for name, email and question, and after Send reminds them about spam',
    /<button type="button" class="ask-fab" data-ask-open aria-haspopup="dialog" aria-label="[^"]+"><svg class="ico" aria-hidden="true"><use href="\/img\/icons\.svg#i-chat"\/><\/svg><\/button>/.test(idx)
    && /<h2 id="ask-title">Questions\?<\/h2>/.test(ask) && /<p class="ask-lede">Type them down below and I'll get back to you within two days\.<\/p>/.test(ask)
    && ['name', 'email'].every((n) => new RegExp(`<input name="${n}"[^>]*required`).test(ask)) && /<textarea name="question" maxlength="2000" required>/.test(ask)
    && /<button type="submit" class="btn glow wl-go">Send<\/button>/.test(ask)
    && /Please check your spam folder too, in case my reply gets sent there\./.test(ask)
    && /\.ask-fab \{\s*position: fixed;\s*right: max\(16px, env\(safe-area-inset-right\)\);\s*bottom: max\(16px, env\(safe-area-inset-bottom\)\);/.test(css)
    && /<script type="module" src="\/js\/question\.js\?v=1"><\/script>/.test(idx) && !DASH.test(ask));
  const menu = (idx.match(/<nav class="tabs">([\s\S]*?)<\/nav>/) || ['', ''])[1];
  const anchors = [...menu.matchAll(/<a href="#([\w-]+)">/g)].map((m) => m[1]);
  // NEGATIVE CONTROL (run 2026-10-14): data-always-menu taken off the landing's bar made this read
  //   FAIL  C2 the landing's bar always shows the menu button, and the menu opens every other section, each a section that exists
  check('C2 the landing\'s bar always shows the menu button, and the menu opens every other section, each a section that exists',
    /<div class="bar-inner" data-always-menu>/.test(idx) && /barInner\.hasAttribute\('data-always-menu'\) \|\|/.test(f('public/js/nav-menu.js'))
    && anchors.join() === 'needs,how,who,proof,faq,closing,more'
    && anchors.every((id) => new RegExp(`<(section|footer) class="[^"]*" id="${id}"`).test(idx)));
  // NEGATIVE CONTROL (run 2026-10-14): the `display: none` on the other sections deleted made this read
  //   FAIL  C3 off the home, every other section is hidden until the menu names it, then it is a screen of its own with a way back
  check('C3 off the home, every other section is hidden until the menu names it, then it is a screen of its own with a way back',
    /body\.landing main > \.land-sec\.ruled,\s*body\.landing \.site-foot \{ display: none; \}/.test(css)
    && /body\.landing main > \.land-sec\.ruled:target,\s*body\.landing \.site-foot:target \{\s*position: fixed;/.test(css)
    && /panel-back/.test(f('public/js/landing-tabs.js')) && /<script type="module" src="\/js\/landing-tabs\.js\?v=1"><\/script>/.test(idx));
  // NEGATIVE CONTROL (run 2026-10-14): the ring's gradient set to gold (#E9B949) made this read
  //   FAIL  C4 the chat card is first and ringed in the waitlist bubble's own gradient, a bright spot easing round it on the bubble's beat, still for anyone who asked for less motion
  const bubble = (css.match(/body\.landing \.wl-bubble \{[\s\S]*?\n\}/) || [''])[0];
  const grad = (bubble.match(/background: (linear-gradient\([^;]+\));/) || [])[1];
  check('C4 the chat card is first and ringed in the waitlist bubble\'s own gradient, a bright spot easing round it on the bubble\'s beat, still for anyone who asked for less motion',
    !!grad && css.includes(`conic-gradient(from var(--pa-ring), transparent 0deg 300deg, rgba(255, 255, 255, .55) 322deg, #FFFFFF 338deg, rgba(255, 255, 255, .55) 350deg, transparent 360deg),\n    ${grad};`)
    && /@property --pa-ring \{/.test(css) && /@keyframes pa-ring \{ to \{ --pa-ring: 360deg; \} \}/.test(css)
    && /@media \(prefers-reduced-motion: no-preference\) \{\s*body\.landing \.opt-gold::before,\s*body\.landing \.opt-gold::after \{ animation: pa-ring 3\.6s ease-in-out infinite; \}/.test(css)
    && /body\.landing \.wl-bubble::before \{ animation: wl-shine 3\.6s ease-in-out infinite; \}/.test(css)
    && idx.indexOf('opt-gold') < idx.indexOf('Advocacy Case</h3>'));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
