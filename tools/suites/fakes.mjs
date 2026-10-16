// fakes.mjs - invented clients off his real shelf, and the two ways a case is deleted (v7.60).
//
// Eric, 2026-10-16. Asked whether Joe Bloe and the sample contractor should stay now that Demo mode does what
// they did: "Remove both". Then, with a screenshot of her invented clients on his shelf: "'Delete' for sample
// fake clients should be on the folders. For real clients it should be in settings". And, with a screenshot of
// the Clients heading: "Move the employer mode and + buttons up slightly so they're in line with 'Clients'".
//
// What this proves:
//   A. worker/retire.js, run against fakes: every showcase case wiped once, her three records gone, the flag
//      set; an isolate that has seen the flag asks nothing more, and an unreadable flag writes nothing
//   B. the cron calls it on its own minute
//   C. Settings on a client's case: the row under their name, locked until the name is typed, posting the one
//      door the Worker lets a real case through
//   D. the sample box is gone from Employer mode, and the heading row centres the buttons on "Clients"
//
// Run: node fakes.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const RET = f('worker/retire.js');
const W = f('worker/index.js');
const SET = f('public/js/admin-settings.js');
const EMP = f('public/js/admin-employer.js');
const EMPH = f('public/admin-employer.html');
const ADMH = f('public/admin.html');
const DASH = new RegExp('[\\u2013\\u2014]');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

// The shipped module, its imports handed in.
const body = RET.replace(/^import [^;]+;\n/gm, '').replace(/^export /gm, '');
const make = (fakes) => new Function('getDoc', 'patchDoc', 'queryDocs', 'batchDelete', 'wipeCase', 'SAMPLE_UID',
  `${body}\nreturn { retireSamples, RETIRE_FLAG };`)(fakes.getDoc, fakes.patchDoc, fakes.queryDocs, fakes.batchDelete, fakes.wipeCase, 'sample-contractor');
const world = ({ flag = null, cases = [], unreadable = false } = {}) => {
  const log = { reads: 0, queries: 0, wiped: [], deleted: [], wrote: [] };
  const fakes = {
    getDoc: async () => { log.reads += 1; if (unreadable) throw new Error('quota'); return flag ? { data: flag } : null; },
    patchDoc: async (_e, p, d) => { log.wrote.push([p, Object.keys(d)]); flag = { ...(flag || {}), ...d }; return true; },
    queryDocs: async (_e, col, filters) => { log.queries += 1; log.lastQuery = [col, filters]; return cases; },
    batchDelete: async (_e, paths) => { log.deleted.push(...paths); return { deleted: paths.length }; },
    wipeCase: async (_e, id, opts) => { log.wiped.push([id, opts?.adminUid]); return { docs: 1, files: 0 }; },
  };
  return { log, m: make(fakes) };
};
const ENV = { ADMIN_UID: 'eric' };

console.log('\n--- A. once, and only the invented ---');
{
  const w = world({ cases: [{ id: 'joe', data: { showcase: true } }, { id: 'maya-dana', data: { showcase: true, sample: true } }, { id: 'odd', data: { showcase: 'yes' } }] });
  const first = await w.m.retireSamples(ENV);
  const again = await w.m.retireSamples(ENV);
  // NEGATIVE CONTROL (run 2026-10-16): retire.js's `if (r.data?.showcase !== true) continue;` taken out made this read
  //   FAIL  A1 every case that truly says showcase is wiped as him, her three records go, the flag is set, and the next call asks nothing
  check('A1 every case that truly says showcase is wiped as him, her three records go, the flag is set, and the next call asks nothing',
    first.wiped === 2 && JSON.stringify(w.log.wiped) === JSON.stringify([['joe', 'eric'], ['maya-dana', 'eric']])
    && JSON.stringify(w.log.lastQuery) === JSON.stringify(['cases', [['showcase', 'EQUAL', true]]])
    && JSON.stringify(w.log.deleted) === JSON.stringify(['advocates/sample-contractor', 'staffChats/sample-contractor', 'payouts/sample-contractor'])
    && JSON.stringify(w.log.wrote) === JSON.stringify([['config/once', ['samplesRetired']]])
    && again.skipped === 'settled' && w.log.reads === 1 && w.log.queries === 1, JSON.stringify({ first, again, log: w.log }));
  const done = world({ flag: { samplesRetired: '2026-10-16T00:00:00Z' }, cases: [{ id: 'x', data: { showcase: true } }] });
  const r = await done.m.retireSamples(ENV);
  const blind = world({ unreadable: true, cases: [{ id: 'x', data: { showcase: true } }] });
  const b = await blind.m.retireSamples(ENV);
  // NEGATIVE CONTROL (run 2026-10-16): retire.js's `if (once === undefined) return` made `if (false) return` made this read
  //   FAIL  A2 a flag already set wipes nothing, and a flag it cannot read wipes and writes nothing until it can
  check('A2 a flag already set wipes nothing, and a flag it cannot read wipes and writes nothing until it can',
    r.skipped === 'done' && !done.log.wiped.length && !done.log.queries
    && b.skipped === 'unreadable' && !blind.log.wiped.length && !blind.log.wrote.length && !blind.log.queries,
    JSON.stringify({ r, b, done: done.log, blind: blind.log }));
}

console.log('\n--- B. the cron ---');
// NEGATIVE CONTROL (run 2026-10-16): the cron's retireSamples line taken out made this read
//   FAIL  B1 the cron runs it on its own minute, and the Worker imports it
check('B1 the cron runs it on its own minute, and the Worker imports it',
  /if \(minute % 15 === 13\) ctx\.waitUntil\(retireSamples\(env\)\.catch\(/.test(W) && /import \{ retireSamples \} from '\.\/retire\.js';/.test(W));

console.log('\n--- C. a real client\'s case, from Settings ---');
{
  const row = (SET.match(/\$\{c && c\.name \? `\n[\s\S]*?` : ''\}/) || [''])[0];
  const wire = (SET.match(/function wireDeleteCase\(overlay, user\) \{[\s\S]*?\n\}/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-16): the Delete button's `disabled` taken off in admin-settings.js made this read
  //   FAIL  C1 on a client's case only, under their name, the button locked until the name is typed, then the one door the Worker opens for a real case
  check('C1 on a client\'s case only, under their name, the button locked until the name is typed, then the one door the Worker opens for a real case',
    /<h4[^>]*>Delete \$\{esc\(c\.name\)\}'s case<\/h4>/.test(row) && /<button class="btn danger" data-del-case disabled/.test(row)
    && /Their account stays, and nothing\s+is refunded\./.test(row)
    && /go\.disabled = norm\(box\.value\) !== norm\(c\.name\);/.test(wire)
    && /body: JSON\.stringify\(\{ caseId: c\.id, confirmName: box\.value, real: true \}\)/.test(wire)
    && /location\.href = '\/admin\.html';/.test(wire) && /wireDeleteCase\(overlay, user\);/.test(SET)
    && !DASH.test(row + wire));
}

console.log('\n--- D. the sample box, and the heading ---');
// NEGATIVE CONTROL (run 2026-10-16): the paintSample call put back in admin-employer.js made this read
//   FAIL  D1 Employer mode has no box to add or remove a sample contractor
check('D1 Employer mode has no box to add or remove a sample contractor',
  !/paintSample|data-sample=|sample-create|sample-remove/.test(EMP) && !/emp-sample/.test(EMPH));
// NEGATIVE CONTROL (run 2026-10-16): the heading's `margin: 0` taken out of admin.html made this read
//   FAIL  D2 the Clients heading carries no margin of its own, so Employer mode and the + centre on its letters
check('D2 the Clients heading carries no margin of its own, so Employer mode and the + centre on its letters',
  /\.clients-head h1 \{ margin: 0; \}/.test(ADMH) && /\.clients-head \{ margin-bottom: \.55rem; \}/.test(ADMH));

const fails = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - fails}/${results.length} passed`);
if (fails) process.exit(1);
