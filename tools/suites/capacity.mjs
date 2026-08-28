// capacity.mjs - how many Hands-Off cases he carries at once, and the fact
// that no client is ever told the number.
//
// Eric, 2026-08-27: "remove limitations on how many hand off cases I can have.
// Or at least put that in an admin settings cog." He chose the cog: a number
// he sets, with no promise about it in any copy.
//
// The cap was already not a limit. He could override it at the approval
// prompt, and open-full bypassed it entirely with no capacity check at all.
// What it WAS is a number he could not change: FULL_MAX_OPEN_DEFAULT carried a
// comment saying "one tap on his dashboard changes it", and that tap had never
// been built. settings/fullAccess.maxOpen was read in one place and written by
// nothing, ever.
//
// LIFTED AND RUN, not pattern matched. The whole point of this change is that
// a stored ZERO means "no limit", and the old `Number(x) > 0 ? x : DEFAULT`
// would silently turn that back into two on the very next read - a control
// that looks broken the first time he uses it. Only calling the function
// catches that.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f(import.meta.url)), '..', '..');
const read = (p) => readFileSync(j(ROOT, p), 'utf8');
const WORKER = read('worker/index.js');
const SETTINGS = read('public/js/admin-settings.js');
const ADMINCASE = read('public/js/admin-case.js');
const RULES = read('firestore.rules');
const DEMOAPI = read('public/js/demo/api.js');

const results = [];
const ck = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
/** Comments stripped. There is no build step, so a comment is a served byte,
 *  and C14 went red against the very comment explaining that the number USED
 *  to live in settings/. The check was right; the source it read was not. */
const bare = (src) => src.split('\n')
  .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');
const slab = (src, from, to) => {
  const a = src.indexOf(from);
  if (a < 0) return '';
  const b = src.indexOf(to, a);
  return b < 0 ? '' : src.slice(a, b + to.length);
};

// ---- C1-C8: the count and the ceiling, run ------------------------------
{
  const fn = (WORKER.match(/async function fullAccessCapacity\(env\) \{[\s\S]*?\n\}/) || [''])[0];
  const line = (WORKER.match(/const capacityLine = \(cap\) => \([\s\S]*?\);/) || [''])[0];
  // NEGATIVE CONTROL (all runs 2026-08-28): renaming fullAccessCapacity made
  // this read
  //   FAIL  C1 the capacity read lifts out of the shipped Worker
  // Also fires if capacityLine goes: renaming it read
  //   FAIL  C1 the capacity read lifts out of the shipped Worker
  ck('C1 the capacity read lifts out of the shipped Worker', fn.length > 0 && line.length > 0);

  // The store, as Firestore would answer it. `queried` records what the
  // Worker actually ASKED for, which is the half a JS-side filter hides.
  const queried = [];
  // THE DEFAULT COMES FROM THE WORKER, not from a number written here. A stub
  // that hard-codes 2 goes green with FULL_MAX_OPEN_DEFAULT changed to 4,
  // which is a suite agreeing with itself rather than with the shipped file.
  const DEFAULT = Number((WORKER.match(/const FULL_MAX_OPEN_DEFAULT = (\d+);/) || [])[1]);
  // NEGATIVE CONTROL: making the constant non-numeric read
  //   FAIL  C1b ... -- NaN
  // and took C3, C3b, C5 and C8 with it, loudly, rather than quietly
  // comparing everything against NaN and passing.
  ck('C1b the default he starts from is readable from the Worker',
    Number.isInteger(DEFAULT) && DEFAULT > 0, String(DEFAULT));
  const build = (cases, cfg, { refuseFiltered = false, dead = false } = {}) => new Function(
    '__cases', '__cfg', '__queried', '__refuse', '__dead', `
    const FULL_MAX_OPEN_DEFAULT = ${DEFAULT};
    const FULL_CAP_PATH = 'config/fullAccess';
    const queryDocs = async (env, coll, filters, limit) => {
      __queried.push({ filters: filters.map((x) => x.join(' ')), limit });
      if (__dead) throw new Error('firestore down');
      if (__refuse && filters.length > 1) throw new Error('needs a composite index');
      const wantsOpen = filters.some((x) => x[0] === 'status');
      const rows = __cases.filter((c) => c.fullAccess === true)
        .filter((c) => (wantsOpen ? c.status !== 'closed' : true))
        .slice(0, limit);
      return rows.map((c, i) => ({ id: 'c' + i, data: c }));
    };
    const getDoc = async () => (__cfg === null ? null : { data: __cfg });
    ${fn}
    return fullAccessCapacity;
  `)(cases, cfg, queried, refuseFiltered, dead);

  const open = (n) => Array.from({ length: n }, () => ({ fullAccess: true, status: 'forms' }));
  const closed = (n) => Array.from({ length: n }, () => ({ fullAccess: true, status: 'closed' }));

  // NEGATIVE CONTROL: putting `Number(cfg?.data.maxOpen) > 0 ? ... : DEFAULT`
  // back made this read
  //   FAIL  C2 ... -- max 2, room true
  const unlimited = await build(open(7), { maxOpen: 0, setByHand: true })();
  ck('C2 a stored ZERO means NO LIMIT, and does not revert to two',
    unlimited.max === 0 && unlimited.room === true && unlimited.open === 7,
    `max ${unlimited.max}, room ${unlimited.room}`);

  // NEGATIVE CONTROL: changing FULL_MAX_OPEN_DEFAULT to 4 in the Worker moved
  // this check with it, which is the point: it asserts they AGREE, not that
  // the number is 2.
  const unset = await build(open(1), null)();
  ck('C3 nothing stored falls back to the default he starts from',
    unset.max === DEFAULT && unset.room === true, `max ${unset.max}, default ${DEFAULT}`);
  // Written by an earlier deploy without setByHand: not his choice, so ignored.
  // NEGATIVE CONTROL: dropping the setByHand test made this read
  //   FAIL  C3b ... -- max 9
  const stray = await build(open(1), { maxOpen: 9 })();
  ck('C3b a value with no setByHand on it is not treated as his decision',
    stray.max === DEFAULT, `max ${stray.max}`);

  const one = await build(open(1), { maxOpen: 1, setByHand: true })();
  // NEGATIVE CONTROL: `room: true` regardless of the cap read
  //   FAIL  C4 ... -- 1 of 1, room true
  //   FAIL  C6 ... -- 3 open of 2, room true
  //   FAIL  C7 ... -- 3 open, room true
  ck('C4 a cap of one is full at one', one.max === 1 && one.room === false,
    `${one.open} of ${one.max}, room ${one.room}`);
  const three = await build(open(2), { maxOpen: 3, setByHand: true })();
  ck('C4b and a cap of three still has room at two',
    three.max === 3 && three.room === true, `${three.open} of ${three.max}`);

  // NEGATIVE CONTROL: dropping the Number.isInteger guard made this read
  //   FAIL  C5 ... -- max NaN, room false
  //
  // AND THIS FOUND A REAL ONE. With `Number(cfg.data.maxOpen)` on the read
  // side it read
  //   FAIL  C5 junk (null) ... -- max 0, room true
  //   FAIL  C5 junk (true) ... -- max 1, room false
  // because Number(null) is 0 and 0 means NO LIMIT. A null in that field would
  // have taken his cap off without a word. The read is a typeof test now, the
  // same as the route's.
  for (const junk of ['banana', -1, 1.5, 500, null, true, '2']) {
    const bad = await build(open(1), { maxOpen: junk, setByHand: true })();
    ck(`C5 junk (${JSON.stringify(junk)}) falls back to the default, never to NaN`,
      bad.max === DEFAULT && bad.room === true, `max ${bad.max}, room ${bad.room}`);
  }

  // THE PAGING BUG. Fifty tier cases sold, forty-nine of them finished.
  queried.length = 0;
  const history = await build([...closed(49), ...open(3)], { maxOpen: 2, setByHand: true })();
  // NEGATIVE CONTROL: putting the query back to a bare fullAccess filter at
  // limit 50 made this read
  //   FAIL  C6 ... -- 0 open of 2, room true
  // which is the cap failing silently open on the fifty-first tier case he
  // ever sells.
  ck('C6 closed cases are filtered SERVER-SIDE, so a long history cannot hide his load',
    history.open === 3 && history.room === false,
    `${history.open} open of ${history.max}, room ${history.room}`);
  // NEGATIVE CONTROL: same break as C6 read
  //   FAIL  C6b ... -- [{"filters":["fullAccess EQUAL true"],"limit":50}]
  ck('C6b and the filter really is in the query, not applied afterwards',
    queried.some((q) => q.filters.some((s) => /^status /.test(s)) && q.limit >= 200),
    JSON.stringify(queried));

  // Firestore can refuse equality-plus-inequality without a composite index.
  // The old code answered a refusal with [], which reads as all the room in
  // the world.
  queried.length = 0;
  const noIndex = await build([...closed(49), ...open(3)], { maxOpen: 2, setByHand: true },
    { refuseFiltered: true })();
  // NEGATIVE CONTROL: making the catch return [] made this read
  //   FAIL  C7 ... -- 0 open, room true
  ck('C7 a refused index falls back to a real count, never to an empty list',
    noIndex.open === 3 && noIndex.room === false && noIndex.counted === true,
    `${noIndex.open} open, room ${noIndex.room}`);
  // NEGATIVE CONTROL: returning [] on a refusal read
  //   FAIL  C7 ... -- 0 open, room true
  //   FAIL  C7b ... -- [{"filters":["fullAccess EQUAL true","status NOT_EQUAL closed"],"limit":200}]
  ck('C7b and it retried without the filter rather than giving up',
    queried.length === 2 && queried[1].filters.length === 1, JSON.stringify(queried));

  // If Firestore is unreachable it still reports room, the way it always has:
  // refusing a client on a number nobody could read is worse, and he is asked
  // at the approval prompt either way. `counted` says the number is not real.
  const blind = await build(open(9), null, { dead: true })();
  // NEGATIVE CONTROL: hard-coding `counted: true` read
  //   FAIL  C8 ... -- {"open":0,"max":2,"room":true,"counted":true}
  ck('C8 an unreachable database says so instead of pretending to have counted',
    blind.counted === false && blind.room === true, JSON.stringify(blind));

  // The phrase, both branches, with the count kept in each.
  const say = new Function(`${line}\nreturn capacityLine;`)();
  // NEGATIVE CONTROL: dropping the count from the unlimited branch made this
  // read
  //   FAIL  C8b ... -- No limit set.
  // and took away the one place he passively learns his load.
  ck('C8b the phrase keeps the COUNT even when there is no cap',
    say({ open: 4, max: 0 }) === '4 open, no limit set.'
    && say({ open: 1, max: 2 }) === '1 of 2 open.',
    `${say({ open: 4, max: 0 })} | ${say({ open: 1, max: 2 })}`);
  // NEGATIVE CONTROL: putting `${cap.open}/${cap.max} open.` back into the
  // push, or the bare `of ${out.max}` back into the approval prompt, read
  //   FAIL  C8c ... -- a bare open/max template is still in the source
  ck('C8c and nothing anywhere can now print "of undefined"',
    !/\$\{cap\.open\}\/\$\{cap\.max\}/.test(WORKER)
    && /const carrying = out\.max/.test(ADMINCASE),
    'a bare open/max template is still in the source');
}

// ---- C9-C13: the route ---------------------------------------------------
// Modelled line for line on handleBookingClosure, and run rather than read.
{
  const fn = (WORKER.match(/async function handleFullCapacity\(request, env\) \{[\s\S]*?\n\}/) || [''])[0];
  const cap = (WORKER.match(/async function fullAccessCapacity\(env\) \{[\s\S]*?\n\}/) || [''])[0];
  const line = (WORKER.match(/const capacityLine = \(cap\) => \([\s\S]*?\);/) || [''])[0];
  // NEGATIVE CONTROL: renaming handleFullCapacity read
  //   FAIL  C9 the route lifts out of the shipped Worker
  ck('C9 the route lifts out of the shipped Worker', fn.length > 0);

  const writes = [];
  const run = async (method, body, { admin = true } = {}) => {
    writes.length = 0;
    const store = { doc: null };
    const make = new Function('__writes', '__store', '__admin', `
      const FULL_MAX_OPEN_DEFAULT = 2;
      const FULL_CAP_PATH = 'config/fullAccess';
      const json = (o, s) => ({ status: s || 200, body: o });
      const requireAdmin = async () => (__admin ? { uid: 'admin' } : null);
      const queryDocs = async () => [];
      const getDoc = async () => (__store.doc ? { data: __store.doc } : null);
      const patchDoc = async (env, path, fields, opts) => {
        __writes.push({ path, fields, mask: opts && opts.mask });
        __store.doc = { ...(__store.doc || {}), ...fields };
        return true;
      };
      ${line}
      ${cap}
      ${fn}
      return handleFullCapacity;
    `);
    const handler = make(writes, store, admin);
    try {
      const res = await handler({ method, json: async () => body }, {});
      return { res, writes: writes.slice(), store };
    } catch (e) {
      return { threw: `${e.constructor.name}: ${e.message}`, writes: [] };
    }
  };

  // NEGATIVE CONTROL: returning 403 instead of 404 made this read
  //   FAIL  C10 ... -- status 403
  const stranger = await run('GET', {}, { admin: false });
  // NEGATIVE CONTROL: returning 403 read
  //   FAIL  C10 ... -- status 403
  // 403 tells a stranger the route exists, which is the whole thing the admin
  // half is hidden to prevent.
  ck('C10 a stranger gets 404, not 403, like every other admin route here',
    stranger.res?.status === 404 && stranger.res?.body?.error === 'Not found',
    stranger.threw || `status ${stranger.res?.status}`);

  const set = await run('POST', { maxOpen: 5 });
  // NEGATIVE CONTROL: `room: true` regardless of the cap made C4, C6 and C7
  // all go red at once
  //   FAIL  C4 ... -- 1 of 1, room true
  // NEGATIVE CONTROL: writing to settings/fullAccess made this read
  //   FAIL  C11 ... -- settings/fullAccess
  // NEGATIVE CONTROL: writing to settings/fullAccess read
  //   FAIL  C11 ... -- settings/fullAccess
  ck('C11 it writes to config/, which is NOT world-readable',
    set.writes[0]?.path === 'config/fullAccess', set.writes[0]?.path || 'no write');
  // NEGATIVE CONTROL: same break as C11 read
  //   FAIL  C11b ... -- {"path":"settings/fullAccess","fields":{"maxOpen":5},"mask":["maxOpen"]}
  ck('C11b masked, and stamped as his own decision',
    set.writes[0]?.fields.maxOpen === 5
    && set.writes[0]?.fields.setByHand === true
    && (set.writes[0]?.mask || []).join() === 'maxOpen,setByHand',
    JSON.stringify(set.writes[0]));
  // NEGATIVE CONTROL: answering with a literal object instead of re-reading
  // read
  //   FAIL  C11c ... -- {"open":0,"max":99,"room":true,"counted":true,"message":"ok"}
  ck('C11c and it reads the state back before answering, rather than echoing',
    set.res?.body?.max === 5 && set.res?.body?.message === '0 of 5 open.',
    JSON.stringify(set.res?.body));

  const off = await run('POST', { maxOpen: 0 });
  // NEGATIVE CONTROL: the old `> 0 ? x : DEFAULT` read on the way back read
  //   FAIL  C12 ... -- {"open":0,"max":2,...,"message":"0 of 2 open."}
  // A control that stores "no limit" and answers "2" is a control he will
  // press once and never trust again.
  ck('C12 no limit is storable, and comes back as no limit',
    off.writes[0]?.fields.maxOpen === 0 && off.res?.body?.max === 0
    && off.res?.body?.room === true, JSON.stringify(off.res?.body));

  // NEGATIVE CONTROL: using Number(body?.maxOpen) instead of a typeof test
  // made this read
  //   FAIL  C13 (null) ... -- status 200, 1 write
  // because Number(null) is 0, and 0 means no limit: a body with the field
  // missing would have quietly taken his cap off.
  for (const junk of [undefined, null, 'lots', -1, 1.5, 100, true, '3']) {
    const bad = await run('POST', { maxOpen: junk });
    ck(`C13 junk (${JSON.stringify(junk)}) is refused in plain English, and nothing is written`,
      bad.res?.status === 400 && bad.writes.length === 0
      && /Pick a whole number from 1 to 99, or no limit\./.test(bad.res?.body?.error || ''),
      bad.threw || `status ${bad.res?.status}, ${bad.writes.length} write`);
  }
}

// ---- C14-C16: where the number lives, and who can read it ---------------
{
  // NEGATIVE CONTROL: pointing FULL_CAP_PATH at settings/fullAccess made this
  // read
  //   FAIL  C14 ... -- config/fullAccess
  // NEGATIVE CONTROL: pointing FULL_CAP_PATH at settings/fullAccess read
  //   FAIL  C14 ... -- settings/fullAccess is still read
  ck('C14 the number is stored under config/, never settings/',
    /const FULL_CAP_PATH = 'config\/fullAccess';/.test(WORKER)
    && !/settings\/fullAccess/.test(bare(WORKER)), 'settings/fullAccess is still read');
  // The reason: everything under settings/ is world-readable by rule.
  // NEGATIVE CONTROL: closing settings/ to the world read
  //   FAIL  C14b and settings/ really is the world-readable one, which is why
  // This check is not asking for settings/ to stay open. It records WHY the
  // number is not stored there, so a future reader does not "tidy" it back.
  ck('C14b and settings/ really is the world-readable one, which is why',
    /match \/settings\/\{doc\} \{[\s\S]{0,300}?allow read: if true;/.test(RULES));
  // NEGATIVE CONTROL: adding `match /config/{doc} { allow read: if true; }`
  // read
  //   FAIL  C14c while config/ has no read grant at all, so it falls to the deny tail
  ck('C14c while config/ has no read grant at all, so it falls to the deny tail',
    !/match \/config\//.test(RULES)
    && /match \/\{document=\*\*\} \{\s*allow read, write: if false;/.test(RULES));
  // /api/rates is client-served. It may say whether he is open, never how full.
  const rates = slab(WORKER, 'async function handleRates(env) {', '\n}');
  // NEGATIVE CONTROL: adding `fullOpenCount: cap.open` to handleRates made
  // this read
  //   FAIL  C15 ... -- the client endpoint publishes a count
  // NEGATIVE CONTROL: adding fullOpenCount to handleRates read
  //   FAIL  C15 ... -- the client endpoint publishes a count
  ck('C15 the client endpoint still publishes a bare boolean, never the counts',
    /fullOpen: cap\.room !== false/.test(rates)
    && !/cap\.open/.test(rates) && !/cap\.max/.test(rates),
    'the client endpoint publishes a count');
}

// ---- C16: NO CLIENT-READ FILE NAMES A NUMBER OF CONCURRENT CASES --------
// The whole reason the copy had to change: four client-read places promised
// "two at a time", and the moment he can set the number they become false.
// This scans what a client can actually download.
{
  const CLIENT_FILES = [];
  for (const n of readdirSync(j(ROOT, 'public/js'))) {
    if (!n.endsWith('.js') || /^admin[\w-]*\.js$/.test(n)) continue;
    if (['advisor.js', 'notes.js', 'duty.js', 'prep.js', 'drawer.js', 'seen.js',
      'panel-bridge.js'].includes(n)) continue;   // gated by the same asset rule
    CLIENT_FILES.push(`public/js/${n}`);
  }
  for (const n of readdirSync(j(ROOT, 'public'))) {
    if (n.endsWith('.html') && !/^admin/.test(n)) CLIENT_FILES.push(`public/${n}`);
  }
  // Words AND digits, either order, near a phrase about carrying several at
  // once. Deliberately wide: a check that only knew the exact old sentence
  // would go green on any rewording of it.
  const NUM = '(one|two|three|four|five|six|1|2|3|4|5|6)';
  const PATTERNS = [
    new RegExp(`(carry|take|handle|take on|run)\\s+${NUM}\\b[^.]{0,60}?(at (a|one) time|at once|concurrent|simultaneous)`, 'i'),
    new RegExp(`${NUM}\\s+(of these|hands.off|cases)\\b[^.]{0,40}?(at (a|one) time|at once)`, 'i'),
    new RegExp(`(a maximum of|no more than|only)\\s+${NUM}\\b[^.]{0,40}?(client|case|at (a|one) time|at once)`, 'i'),
  ];
  const hits = [];
  for (const rel of CLIENT_FILES) {
    const src = read(rel);
    for (const re of PATTERNS) {
      const m = src.match(re);
      if (m) hits.push(`${rel}: ${m[0].slice(0, 90)}`);
    }
  }
  // NEGATIVE CONTROL: putting "I carry two of these at a time" back into
  // service-about.js made this read
  //   FAIL  C16 ... -- public/js/service-about.js: carry two of these at a time
  ck('C16 no client-read file names a number of cases he carries at once',
    hits.length === 0, hits.slice(0, 4).join('  |  '));
  // And the four that used to are still SAYING there is a limit. Silence
  // would be its own problem: the whole reason he answers personally is that
  // he cannot take everyone.
  // NEGATIVE CONTROL: putting "I carry two of these at a time" back into
  // service-about.js read
  //   FAIL  C16b public/js/service-about.js still says there IS a limit, without naming it
  for (const [rel, phrase] of [
    ['public/js/tier-terms.js', 'I only take on a limited number of these at once'],
    ['public/js/case.js', 'I only carry a limited'],
    ['public/services.html', 'I take a limited number of these at a time'],
    ['public/js/service-about.js', 'I carry a limited number of these at a time'],
  ]) {
    ck(`C16b ${rel} still says there IS a limit, without naming it`,
      read(rel).includes(phrase), phrase);
  }
}

// ---- C17-C18: the control, and the demo ---------------------------------
{
  // NEGATIVE CONTROL: swapping the presets for <input type="number"> read
  //   FAIL  C17 the cog carries preset buttons, not a text field on a phone
  ck('C17 the cog carries preset buttons, not a text field on a phone',
    /data-cap-picks/.test(SETTINGS)
    && /\[1, 2, 3, 5\]\.map/.test(SETTINGS)
    && /data-cap="0"[^>]*>No limit</.test(SETTINGS)
    && !/type="number"[^>]*data-cap/.test(SETTINGS));
  // NEGATIVE CONTROL: rendering them enabled made this read
  //   FAIL  C17b the buttons render DISABLED until the server has answered
  // NEGATIVE CONTROL: rendering them enabled read
  //   FAIL  C17b the buttons render DISABLED until the server has answered
  ck('C17b the buttons render DISABLED until the server has answered',
    /data-cap="\$\{n\}" disabled/.test(SETTINGS)
    && /data-cap="0" disabled/.test(SETTINGS));
  // NEGATIVE CONTROL: painting an assumed state instead of asking read
  //   FAIL  C17c it reads the state back before painting, like wireClosure does
  ck('C17c it reads the state back before painting, like wireClosure does',
    /paint\(await call\(\)\);/.test(SETTINGS)
    && /Could not read your limit/.test(SETTINGS));
  // NEGATIVE CONTROL: re-enabling the buttons without repainting read
  //   FAIL  C17d and a failed write puts the row back rather than lying
  ck('C17d and a failed write puts the row back rather than lying',
    /paint\(confirmed\);\s*\/\/ put the row back/.test(SETTINGS)
    && /Not changed: \$\{err\.message\}/.test(SETTINGS));
  // NEGATIVE CONTROL: shortening the line to "No limit." / "Limit 3." read
  //   FAIL  C17e the control says his current load either way
  ck('C17e the control says his current load either way',
    /No limit\. You are carrying \$\{state\.open\} right now\./.test(SETTINGS)
    && /\$\{state\.open\} of \$\{state\.max\} open right now\./.test(SETTINGS));
  // It lives behind the asset gate, like everything else of his.
  // NEGATIVE CONTROL: putting the route's path into settings.js, even inside
  // a comment, read
  //   FAIL  C17f and it ships in an admin-named file, so no client is served it
  ck('C17f and it ships in an admin-named file, so no client is served it',
    !/full-capacity/.test(read('public/js/settings.js'))
    && /full-capacity/.test(SETTINGS));
  // NEGATIVE CONTROL: renaming the demo's path read
  //   FAIL  C18 the demo mirrors the route, so he can drive it himself
  ck('C18 the demo mirrors the route, so he can drive it himself',
    /\/api\/admin\/full-capacity/.test(DEMOAPI)
    && /config\/fullAccess/.test(DEMOAPI)
    && /Pick a whole number from 1 to 99, or no limit\./.test(DEMOAPI));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
