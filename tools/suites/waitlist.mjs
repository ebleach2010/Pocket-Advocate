// waitlist.mjs - the landing page's waitlist bubble, driven against the REAL code.
//
// Eric, 2026-10-12: "Create a small 'join the waitlist' that's in a shining
// text bubble at the top right of the screen. Have them fill out their first
// and last name, email, and phone number and desired package in a dropdown.
// Once submitted, a short message that I'll get back to them soon."
//
// Like fitcall.mjs, the Worker's handlers are lifted out of worker/index.js
// and run over an in-memory Firestore, because the risk is in which refusals
// fire, where the person is written, and whether he hears about it.
//
// Run: node waitlist.mjs
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

// ---- lift the real source ------------------------------------------------
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
  const m = SRC.match(new RegExp(`\\nconst ${name} = [^;]+;`));
  if (!m) throw new Error(`could not lift const ${name}`);
  return m[0];
}
const LIFTED = [
  konst('WAITLIST_PACKAGES'), konst('WAITLIST_IP_LIMIT'),
  sfn('str'), sfn('escHtml'), sfn('json'),
  fn('pingAdmins'), fn('waitlistThrottled'), fn('handleWaitlist'), fn('waitlistNotify'), fn('handleAdminWaitlist'),
].join('\n');

// ---- the world it runs in ------------------------------------------------
let docs, pushes, emails, adminOk;
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
const rows = (coll) => [...docs.entries()]
  .filter(([p]) => p.startsWith(`${coll}/`) && p.split('/').length === 2)
  .map(([p, d]) => ({ id: p.split('/')[1], data: clone(d) }));
const deps = {
  getDoc: async (env, path) => (docs.has(path) ? { data: clone(docs.get(path)) } : null),
  patchDoc: async (env, path, patch, opts = {}) => {
    const next = { ...(docs.get(path) || {}) };
    for (const k of opts.mask || Object.keys(patch)) next[k] = clone(patch[k]);
    docs.set(path, next);
    return true;
  },
  deleteDoc: async (env, path) => { docs.delete(path); },
  queryDocs: async (env, coll, filters, limit = 20) => rows(coll)
    .filter((r) => filters.every(([field, op, v]) => (op === 'EQUAL' ? r.data[field] === v : true)))
    .slice(0, limit),
  listDocs: async (env, coll) => rows(coll),
  notifyUser: async (env, uid, msg) => { pushes.push({ uid, ...msg }); },
  sendEmail: async (env, msg) => { emails.push(msg); return true; },
  requireAdmin: async () => (adminOk ? { uid: 'eric' } : null),
  crypto: webcrypto,
};
const W = new Function(...Object.keys(deps), `${LIFTED}
  return { handleWaitlist, handleAdminWaitlist, WAITLIST_PACKAGES, WAITLIST_IP_LIMIT };`)(...Object.values(deps));

const env = { ADMIN_EMAIL: 'eric@example.com', PUBLIC_BASE_URL: 'https://example.com' };
const req = (body, { ip = '1.2.3.4', method = 'POST' } = {}) => ({
  method, json: async () => body, headers: { get: (k) => (k === 'cf-connecting-ip' ? ip : null) },
});
function reset() {
  docs = new Map(); pushes = []; emails = []; adminOk = true;
  docs.set('users/eric', { role: 'admin' });
}
const GOOD = { first: 'Riley', last: 'Test', email: 'Riley@Example.com', phone: '+1 208 555 0100', package: 'chat', website: '' };
const join = async (body, opts) => { const r = await W.handleWaitlist(req(body, opts), env); return { status: r.status, out: await r.json() }; };
const admin = async (body, opts) => {
  const r = await W.handleAdminWaitlist(req(body, { method: body ? 'POST' : 'GET', ...opts }), env);
  return { status: r.status, out: await r.json() };
};
const list = () => rows('waitlist');

// ---------------------------------------------------------------------------
// A. A person joins
// ---------------------------------------------------------------------------
console.log('\n--- A. joining ---');
reset();
{
  const r = await join(GOOD);
  const w = list();
  // NEGATIVE CONTROL (run 2026-10-12): `phone` dropped from the stored entry made this read
  //   FAIL  A1 a good form is one row in waitlist/ with all five answers, the email lowercased, waiting
  check('A1 a good form is one row in waitlist/ with all five answers, the email lowercased, waiting',
    r.status === 200 && r.out.ok === true && r.out.first === 'Riley' && w.length === 1
    && w[0].data.first === 'Riley' && w[0].data.last === 'Test' && w[0].data.email === 'riley@example.com'
    && w[0].data.phone === '+1 208 555 0100' && w[0].data.package === 'chat' && w[0].data.state === 'waiting'
    && !!w[0].data.createdAt && /^[0-9a-f]{32}$/.test(w[0].id), JSON.stringify(w));
  // NEGATIVE CONTROL (run 2026-10-12): the pingAdmins call switched off made this read
  //   FAIL  A2 Eric gets one push, to his admin account, naming the first name and the package and linking his waitlist
  check('A2 Eric gets one push, to his admin account, naming the first name and the package and linking his waitlist',
    pushes.length === 1 && pushes[0].uid === 'eric' && /Riley joined the waitlist: 24\/7 Priority Chat\./.test(pushes[0].body)
    && pushes[0].link === '/admin.html#waitlist', JSON.stringify(pushes));
  // NEGATIVE CONTROL (run 2026-10-12): the phone line taken out of the email made this read
  //   FAIL  A3 and one email to his address with the full name, the package, the email and the phone
  // RE-PINNED 2026-10-12 (v7.35): Eric, "When someone joins the waitlist, email me with their inputted information
  // with a all caps subject line 'NEW CLIENT ON WAITLIST FOR [service type]'". Every answer they typed, labelled.
  // NEGATIVE CONTROL (run 2026-10-12, v7.35): `.toUpperCase()` taken off the package in the subject made this read
  //   FAIL  A3 and one email to his address, subject NEW CLIENT ON WAITLIST FOR the package in capitals, with every answer they typed
  const e = emails[0];
  check('A3 and one email to his address, subject NEW CLIENT ON WAITLIST FOR the package in capitals, with every answer they typed',
    emails.length === 1 && e.to === 'eric@example.com' && e.subject === 'NEW CLIENT ON WAITLIST FOR 24/7 PRIORITY CHAT'
    && /First name: Riley<br>/.test(e.html) && /Last name: Test<br>/.test(e.html) && /Email: riley@example\.com<br>/.test(e.html)
    && /Phone: \+1 208 555 0100<br>/.test(e.html) && /Package: <strong>24\/7 Priority Chat<\/strong>/.test(e.html), JSON.stringify(emails));
  const subjects = [];
  for (const [k, name] of Object.entries(W.WAITLIST_PACKAGES)) {
    emails = [];
    await join({ ...GOOD, email: `${k}@example.com`, package: k });
    subjects.push(emails[0]?.subject === `NEW CLIENT ON WAITLIST FOR ${name.toUpperCase()}`);
  }
  // NEGATIVE CONTROL (run 2026-10-12, v7.35): the subject built from the package key instead of its name made this read
  //   FAIL  A3b each package names itself in the subject, in capitals
  check('A3b each package names itself in the subject, in capitals', subjects.length === 3 && subjects.every(Boolean));
}
reset();
{
  await join(GOOD);
  const before = list()[0].data.createdAt;
  const r = await join({ ...GOOD, email: 'RILEY@example.com', package: 'full', phone: '208-555-0199' });
  const w = list();
  // NEGATIVE CONTROL (run 2026-10-12): the read of the prior row replaced with null made this read
  //   FAIL  A4 the same email twice is still one row, updated, with its first joined date kept and an "updated" notice
  check('A4 the same email twice is still one row, updated, with its first joined date kept and an "updated" notice',
    r.status === 200 && w.length === 1 && w[0].data.package === 'full' && w[0].data.phone === '208-555-0199'
    && w[0].data.createdAt === before && /updated their waitlist entry/.test(pushes[1]?.body || '')
    && emails[1]?.subject === 'NEW CLIENT ON WAITLIST FOR FULL-SERVICE CASE MANAGEMENT' && /updated their waitlist entry/.test(emails[1]?.html || ''), JSON.stringify(w)); // RE-PINNED 2026-10-12 (v7.35): his capitals subject on an update too; the body says it is an update
}
reset();
{
  await join({ ...GOOD, first: '<b>Ri</b>' });
  // NEGATIVE CONTROL (run 2026-10-12): escHtml taken off the first name in his email made this read
  //   FAIL  A5 what a person types is escaped in his email
  check('A5 what a person types is escaped in his email', !/<b>Ri<\/b>/.test(emails[0]?.html || '') && /&lt;b&gt;Ri/.test(emails[0]?.html || ''));
}

// ---------------------------------------------------------------------------
// B. The refusals: nothing written, nothing sent
// ---------------------------------------------------------------------------
console.log('\n--- B. refusals ---');
const bad = [
  ['first', { first: '  ' }, 'Your first name, please.'],
  ['last', { last: '' }, 'Your last name, please.'],
  ['email', { email: 'riley@' }, 'A working email address, please.'],
  ['phone', { phone: '12' }, 'A valid phone number, please.'],
  ['package', { package: 'gold' }, 'Pick the package you want.'],
  ['package from the prototype', { package: 'toString' }, 'Pick the package you want.'],
];
{
  const got = [];
  for (const [label, patch, msg] of bad) {
    reset();
    const r = await join({ ...GOOD, ...patch });
    got.push(r.status === 400 && r.out.error === msg && list().length === 0 && !pushes.length && !emails.length ? 'ok' : `${label}:${r.status}:${r.out.error}`);
  }
  // NEGATIVE CONTROL (run 2026-10-12): the package check deleted made this read
  //   FAIL  B1 each missing or wrong answer is a 400 in plain words, and nothing is written or sent
  check('B1 each missing or wrong answer is a 400 in plain words, and nothing is written or sent', got.every((g) => g === 'ok'), got.join());
}
reset();
{
  const r = await join({ ...GOOD, website: 'http://spam.example' });
  // NEGATIVE CONTROL (run 2026-10-12): the honeypot line deleted made this read
  //   FAIL  B2 a filled honeypot gets a cheerful 200 and nothing is written or sent
  check('B2 a filled honeypot gets a cheerful 200 and nothing is written or sent',
    r.status === 200 && r.out.ok === true && list().length === 0 && !pushes.length && !emails.length);
}
{
  const cells = new Map();
  globalThis.caches = { default: {
    match: async (k) => (cells.has(k.url) ? new Response(cells.get(k.url)) : undefined),
    put: async (k, res) => { cells.set(k.url, await res.text()); },
  } };
  reset();
  const codes = [];
  for (let i = 0; i < W.WAITLIST_IP_LIMIT + 1; i++) codes.push((await join({ ...GOOD, first: '' })).status);
  const other = (await join({ ...GOOD, first: '' }, { ip: '9.9.9.9' })).status;
  const fitBucket = [...cells.keys()].every((k) => k.startsWith('https://waitlist-throttle.internal/'));
  delete globalThis.caches;
  // NEGATIVE CONTROL (run 2026-10-12): `n >= WAITLIST_IP_LIMIT` to `n > WAITLIST_IP_LIMIT` made this read
  //   FAIL  B3 the sixth try from one connection in an hour is 429, another connection is not, and it is its own bucket
  check('B3 the sixth try from one connection in an hour is 429, another connection is not, and it is its own bucket',
    codes.slice(0, W.WAITLIST_IP_LIMIT).every((c) => c === 400) && codes[W.WAITLIST_IP_LIMIT] === 429 && other === 400 && fitBucket, codes.join());
  // NEGATIVE CONTROL (run 2026-10-12): the throttle moved below the body read made this read
  //   FAIL  B4 the throttle counts before the body is read
  check('B4 the throttle counts before the body is read',
    /waitlistThrottled\(ip\)[\s\S]*request\.json\(\)/.test(fn('handleWaitlist')));
}

// ---------------------------------------------------------------------------
// C. His list
// ---------------------------------------------------------------------------
console.log('\n--- C. his list ---');
reset();
{
  await join(GOOD);
  await join({ ...GOOD, first: 'Sam', email: 'sam@example.com', package: 'case' });
  adminOk = false;
  const stranger = await admin();
  const strangerPost = await admin({ id: list()[0].id, action: 'remove' });
  adminOk = true;
  // NEGATIVE CONTROL (run 2026-10-12): the admin route's 404 turned into a 403 made this read
  //   FAIL  C1 a stranger gets the same 404 as every admin route, reading or writing, and nothing changes
  check('C1 a stranger gets the same 404 as every admin route, reading or writing, and nothing changes',
    stranger.status === 404 && strangerPost.status === 404 && list().length === 2);
  const got = await admin();
  // NEGATIVE CONTROL (run 2026-10-12): the GET list made to drop its first row made this read
  //   FAIL  C2 he sees everyone on it
  check('C2 he sees everyone on it', got.status === 200 && got.out.people.length === 2
    && got.out.people.every((p) => p.first && p.email && p.phone && p.package));
  const id = got.out.people.find((p) => p.first === 'Sam').id;
  const c = await admin({ id, action: 'contacted' });
  const afterC = docs.get(`waitlist/${id}`);
  const back = await admin({ id, action: 'waiting' });
  const afterW = docs.get(`waitlist/${id}`);
  const rm = await admin({ id, action: 'remove' });
  const badAct = await admin({ id: list()[0].id, action: 'wipe' });
  const badId = await admin({ id: '../users/eric', action: 'remove' });
  // NEGATIVE CONTROL (run 2026-10-12): the remove branch's deleteDoc line deleted made this read
  //   FAIL  C3 Contacted and Not yet flip the mark, Remove takes the row off, and a bad action or id changes nothing
  check('C3 Contacted and Not yet flip the mark, Remove takes the row off, and a bad action or id changes nothing',
    c.status === 200 && afterC.state === 'contacted' && back.status === 200 && afterW.state === 'waiting'
    && rm.status === 200 && !docs.has(`waitlist/${id}`) && badAct.status === 400 && badId.status === 400
    && list().length === 1 && docs.has('users/eric'));
}

// ---------------------------------------------------------------------------
// D. The wiring: router, demo, bubble, sheet, dashboard, audit
// ---------------------------------------------------------------------------
console.log('\n--- D. the wiring ---');
{
  // NEGATIVE CONTROL (run 2026-10-12): the /api/waitlist route line deleted made this read
  //   FAIL  D1 the router sends POST /api/waitlist and /api/admin/waitlist to their handlers, and the header lists both
  check('D1 the router sends POST /api/waitlist and /api/admin/waitlist to their handlers, and the header lists both',
    /url\.pathname === '\/api\/waitlist' && request\.method === 'POST'\)\n\s+return await handleWaitlist\(request, env\);/.test(SRC)
    && /url\.pathname === '\/api\/admin\/waitlist'\)\n\s+return await handleAdminWaitlist\(request, env\);/.test(SRC)
    && /\/\/   POST   \/api\/waitlist /.test(SRC) && /\/\/   GET\/POST \/api\/admin\/waitlist /.test(SRC));
  const demo = f('public/js/demo/api.js');
  // NEGATIVE CONTROL (run 2026-10-12): the demo's package check deleted made this read
  //   FAIL  D2 the demo mirrors both routes with the same refusals in the same words
  check('D2 the demo mirrors both routes with the same refusals in the same words',
    /path === '\/api\/waitlist' && init\.method === 'POST'/.test(demo) && /path === '\/api\/admin\/waitlist'/.test(demo)
    && bad.slice(0, 5).every(([, , msg]) => demo.includes(`'${msg}'`))
    && /\['chat', 'case', 'full'\]\.includes\(body\?\.package\)/.test(demo));
}
{
  const html = f('public/index.html');
  const main = html.slice(html.indexOf('<main>'));
  const sel = (html.match(/<select name="package"[\s\S]*?<\/select>/) || [''])[0];
  const opts = [...sel.matchAll(/<option value="(\w*)"[^>]*>([^<]+)<\/option>/g)].map((m) => [m[1], m[2]]);
  // NEGATIVE CONTROL (run 2026-10-12): an empty div put ahead of the bubble row made this read
  //   FAIL  D3 the bubble is the first thing in main, ahead of his notice, and opens the sheet
  // RE-PINNED 2026-10-14 (v7.36): Eric, "Reorient everything so everything on the main page fits without scrolling."
  // The bubble keeps the top right, now on the hero's first row beside the eyebrow; its sheet leads main.
  // NEGATIVE CONTROL (run 2026-10-14, v7.36): the bubble moved below the h1 made this read
  //   FAIL  D3 the bubble sits at the top right of the hero, on its first row, and opens the sheet that leads main
  const heroTop = (main.match(/<div class="hero-top">([\s\S]*?)<\/div>/) || ['', ''])[1];
  check('D3 the bubble sits at the top right of the hero, on its first row, and opens the sheet that leads main',
    /^<main>\s*<!--[\s\S]*?-->\s*<dialog class="wl-sheet" id="waitlist"/.test(main)
    && /^\s*<p class="hero-eyebrow eyebrow">[^<]+<\/p>\s*<button type="button" class="wl-bubble" data-waitlist-open aria-haspopup="dialog">[\s\S]*?Join the waitlist<\/button>\s*$/.test(heroTop)
    && main.indexOf('class="hero-top"') < main.indexOf('<h1>'));
  // NEGATIVE CONTROL (run 2026-10-12): the Full-Service option deleted made this read
  //   FAIL  D4 the sheet asks for first name, last name, email, phone and a package from a dropdown of the three, named as the cards name them
  const cards = [...html.matchAll(/<h3><span class="opt-ic">[\s\S]*?<\/span>([^<]+)<\/h3>/g)].map((m) => m[1]);
  check('D4 the sheet asks for first name, last name, email, phone and a package from a dropdown of the three, named as the cards name them',
    ['first', 'last', 'email', 'phone'].every((n) => new RegExp(`<input name="${n}"[^>]*required`).test(html))
    && /<input name="email" type="email"/.test(html) && /<input name="phone" type="tel"/.test(html)
    && opts.length === 4 && opts[0][0] === '' && JSON.stringify(opts.slice(1).map((o) => o[1])) === JSON.stringify(cards)
    && JSON.stringify(opts.slice(1).map((o) => o[0])) === JSON.stringify(Object.keys(W.WAITLIST_PACKAGES))
    && JSON.stringify(Object.values(W.WAITLIST_PACKAGES)) === JSON.stringify(cards), JSON.stringify({ opts, cards }));
  // NEGATIVE CONTROL (run 2026-10-12): "I'll get back to you soon." changed to "We will be in touch." made this read
  //   FAIL  D5 once sent, the sheet says thank you by first name and that he will get back to them soon
  check('D5 once sent, the sheet says thank you by first name and that he will get back to them soon',
    /<div class="wl-done" role="status" hidden>\s*<p class="wl-done-h">Thank you, <span data-wl-first><\/span>\.<\/p>\s*<p>You're on the waitlist\. I'll get back to you soon\.<\/p>/.test(html)
    && /<script type="module" src="\/js\/waitlist\.js\?v=2"><\/script>/.test(html)); // RE-PINNED 2026-10-12 (v7.35): v=2, it opens itself on /#waitlist
}
{
  const js = f('public/js/waitlist.js');
  // waitlist.js touches the page when it loads, so its rule is lifted rather than imported.
  const lifted = new Function(`${(js.match(/export function waitlistProblem\([\s\S]*?\n\}/) || [''])[0].replace('export ', '')}; return waitlistProblem;`)();
  // The page trims every field before it asks, as the Worker's str() does.
  const trim = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v.trim() : v]));
  const same = bad.map(([, patch, msg]) => lifted(trim({ ...GOOD, ...patch })) === msg).every(Boolean) && lifted(GOOD) === '';
  // NEGATIVE CONTROL (run 2026-10-12): the page's phone check deleted made this read
  //   FAIL  D6 the page refuses exactly what the Worker refuses, in the same words, and posts to /api/waitlist
  check('D6 the page refuses exactly what the Worker refuses, in the same words, and posts to /api/waitlist',
    same && /fetch\('\/api\/waitlist'/.test(js) && /form\.hidden = true;\s*done\.hidden = false;/.test(js),
    JSON.stringify(bad.map(([, patch]) => lifted(trim({ ...GOOD, ...patch })))));
}
{
  const css = f('public/css/landing.css');
  // RE-PINNED 2026-10-14 (v7.36): the waitlist's own block ends where the v7.36 rules begin.
  const block = css.slice(css.indexOf('/* ---- the waitlist'), css.indexOf('/* ==== v7.36'));
  const rowRule = css.slice(css.indexOf('/* ==== v7.36'), css.indexOf('/* ==== v7.37'));
  // NEGATIVE CONTROL (run 2026-10-12): the shine animation moved out of the reduced-motion guard made this read
  //   FAIL  D7 the bubble is a bubble with a tail, at the right, and it shines only for people who have not asked for less motion
  // RE-PINNED 2026-10-14 (v7.36): "at the right" is now the hero row's last column, an auto-width one after the eyebrow's.
  // NEGATIVE CONTROL (run 2026-10-14, v7.36): `grid-template-columns: minmax(0, 1fr) auto;` on .hero-top turned to `auto minmax(0, 1fr)` made this read
  //   FAIL  D7 the bubble is a bubble with a tail, at the right, and it shines only for people who have not asked for less motion
  check('D7 the bubble is a bubble with a tail, at the right, and it shines only for people who have not asked for less motion',
    /body\.landing \.hero-top \{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\) auto;/.test(rowRule)
    && /\.wl-bubble \{[\s\S]*?border-radius: 20px 20px 4px 20px;/.test(block) && /\.wl-bubble::after \{[\s\S]*?clip-path/.test(block)
    && /@keyframes wl-shine/.test(block)
    && (block.match(/animation:/g) || []).length === 3
    && /@media \(prefers-reduced-motion: no-preference\) \{\n(  body\.landing [^\n]*animation:[^\n]*\n){3}\}/.test(block)
    && /landing\.css\?v=b8/.test(f('public/index.html'))); // RE-PINNED 2026-10-15 (v7.40): b8. // RE-PINNED 2026-10-15 (v7.38): b7. // RE-PINNED 2026-10-15 (v7.37): b6
}
{
  const a = f('public/js/admin.js');
  const ah = f('public/admin.html');
  const aw = f('public/js/admin-waitlist.js');
  const audit = f('tools/blindness-audit.mjs');
  // NEGATIVE CONTROL (run 2026-10-12): '/js/admin-waitlist.js' taken out of the audit's admin list made this read
  //   FAIL  D8 his Clients page mounts the list from the admin route, and the audit gates its module
  check('D8 his Clients page mounts the list from the admin route, and the audit gates its module',
    /import \{ mountWaitlist \} from '\.\/admin-waitlist\.js';/.test(a)
    && /mountWaitlist\(document\.getElementById\('waitlist'\), \{ getToken: \(\) => user\.getIdToken\(\) \}\);/.test(a)
    && /<div id="waitlist"><\/div>/.test(ah) && /fetch\('\/api\/admin\/waitlist'/.test(aw)
    && /'\/js\/admin-waitlist\.js',/.test(audit));
  // NEGATIVE CONTROL (run 2026-10-12): an em dash typed into the thank-you line made this read (and D5)
  //   FAIL  D9 no dash anywhere a person reads it
  const html = f('public/index.html');
  const sheet = html.slice(html.indexOf('<div class="wl-row">'), html.indexOf('</dialog>'));
  check('D9 no dash anywhere a person reads it',
    !DASH.test(sheet) && !DASH.test(f('public/js/waitlist.js')) && !DASH.test(aw) && !DASH.test(fn('handleWaitlist') + fn('waitlistNotify')));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
