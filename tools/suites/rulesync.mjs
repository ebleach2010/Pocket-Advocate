// rulesync.mjs - the security rules the Worker carries, and how it publishes them.
//
// Eric, 2026-10-15: "Advocates must never be able to access another
// advocate's cases or data. Enforce this server-side." firestore.rules and
// storage.rules are the second lock, and he cannot deploy them from a phone,
// so the Worker publishes what it was built with (worker/rules-release.js).
// This proves it carries the files byte for byte, and runs the release
// against a stand-in Rules API: it publishes only on a change, retries a
// failure six hours later rather than every minute, and records the outcome.
// The rules themselves are RUN against the emulators in tools/rules/rules-check.mjs.
//
// Run: node rulesync.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath as f2, pathToFileURL } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const TEXT = await import(pathToFileURL(j(ROOT, 'worker/rules-text.js')).href);
const DASH = new RegExp('[\\u2013\\u2014]');

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}

// NEGATIVE CONTROL (run 2026-10-15): one rule in firestore.rules changed without re-running sync-rules.mjs made this read
//   FAIL  S1 the Worker carries both rules files byte for byte
check('S1 the Worker carries both rules files byte for byte',
  TEXT.FIRESTORE_RULES === f('firestore.rules') && TEXT.STORAGE_RULES === f('storage.rules'));

// The release, evaluated with its imports replaced by stand-ins.
const SRC = f('worker/rules-release.js');
const world = (status = null, { fail = null } = {}) => {
  const docs = new Map(status ? [['config/rulesRelease', status]] : []);
  const calls = [];
  const deps = {
    getAccessToken: async () => 'tok',
    getDoc: async (env, p) => (docs.has(p) ? { data: JSON.parse(JSON.stringify(docs.get(p))) } : null),
    patchDoc: async (env, p, data) => { docs.set(p, JSON.parse(JSON.stringify(data))); return true; },
    BUCKET: 'bucket.example.app',
    FIRESTORE_RULES: TEXT.FIRESTORE_RULES,
    STORAGE_RULES: TEXT.STORAGE_RULES,
    fetch: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (fail && url.includes(fail)) return new Response('{"error":{"code":403}}', { status: 403 });
      if (init.method === 'POST') return new Response(JSON.stringify({ name: `projects/p/rulesets/rs${calls.length}` }));
      return new Response('{}');
    },
  };
  const body = SRC.replace(/^import [\s\S]*?from '[^']+';\n/gm, '').replace(/^export (const|async function|function) /gm, '$1 ');
  const api = new Function(...Object.keys(deps), `${body}\nreturn { releaseRules, rulesTargets, RULES_RETRY_MS };`)(...Object.values(deps));
  return { api, docs, calls };
};
const env = { FIREBASE_PROJECT_ID: 'p' };
{
  const w = world();
  const out = await w.api.releaseRules(env);
  const posts = w.calls.filter((c) => c.method === 'POST');
  const patches = w.calls.filter((c) => c.method === 'PATCH');
  // NEGATIVE CONTROL (run 2026-10-15): the storage target's release taken as `firebase.storage` without the bucket made this read
  //   FAIL  S2 a first run publishes each file as its own ruleset and points each release at it: cloud.firestore, and firebase.storage for the bucket
  check('S2 a first run publishes each file as its own ruleset and points each release at it: cloud.firestore, and firebase.storage for the bucket',
    posts.length === 2 && patches.length === 2
    && posts[0].body.source.files[0].name === 'firestore.rules' && posts[0].body.source.files[0].content === TEXT.FIRESTORE_RULES
    && posts[1].body.source.files[0].name === 'storage.rules' && posts[1].body.source.files[0].content === TEXT.STORAGE_RULES
    && patches[0].url.endsWith('/projects/p/releases/cloud.firestore') && patches[0].body.release.rulesetName === 'projects/p/rulesets/rs1'
    && patches[1].url.endsWith('/projects/p/releases/firebase.storage/bucket.example.app')
    && out.firestore.ok === true && out.storage.ok === true && w.docs.get('config/rulesRelease')?.firestore?.ok === true,
    JSON.stringify(w.calls.map((c) => `${c.method} ${c.url}`)));
  const again = world(w.docs.get('config/rulesRelease'));
  await again.api.releaseRules(env);
  // NEGATIVE CONTROL (run 2026-10-15): the `prev.hash === hash && prev.ok === true` skip taken out made this read
  //   FAIL  S3 nothing changed, nothing is published: the cron's run is one read
  check('S3 nothing changed, nothing is published: the cron\'s run is one read', again.calls.length === 0, `${again.calls.length} call(s)`);
}
{
  const w = world(null, { fail: 'firebase.storage' });
  const out = await w.api.releaseRules(env, { now: 1_000_000_000_000 });
  const soon = world(w.docs.get('config/rulesRelease'));
  await soon.api.releaseRules(env, { now: 1_000_000_000_000 + 60_000 });
  const later = world(w.docs.get('config/rulesRelease'));
  await later.api.releaseRules(env, { now: 1_000_000_000_000 + 6 * 3600_000 + 1 });
  // NEGATIVE CONTROL (run 2026-10-15): the six-hour wait taken out of releaseRules made this read
  //   FAIL  S4 a refused release is recorded with its reason, waits six hours before trying again, and leaves the other service published
  check('S4 a refused release is recorded with its reason, waits six hours before trying again, and leaves the other service published',
    out.firestore.ok === true && out.storage.ok === false && /403/.test(out.storage.error)
    && soon.calls.length === 0 && later.calls.filter((c) => c.method === 'POST').length === 1 && later.calls[0].body.source.files[0].name === 'storage.rules',
    JSON.stringify({ out, soon: soon.calls.length, later: later.calls.length }));
}
{
  const W = f('worker/index.js');
  // NEGATIVE CONTROL (run 2026-10-15): the cron's release line taken out made this read
  //   FAIL  S5 the cron publishes in a minute of its own, and the diag shows the outcome without the rules
  check('S5 the cron publishes in a minute of its own, and the diag shows the outcome without the rules',
    /if \(minute % 15 === 11\) ctx\.waitUntil\(releaseRules\(env\)\.catch\(/.test(W)
    && /if \(url\.searchParams\.get\('do'\) === 'rules'\) \{\n\s*const st = await getDoc\(env, RULES_STATUS\)\.catch\(\(\) => null\);\n\s*return json\(\{ ok: true, rules: st\?\.data \|\| null \}\);/.test(W)
    && !/request\.|url\.searchParams/.test(SRC.replace(/\/\/[^\n]*/g, '')));
  // NEGATIVE CONTROL (run 2026-10-15): an em dash put in the release module's header made this read
  //   FAIL  S6 the release module and the sync script carry no dash
  // RE-PINNED 2026-10-15 (v7.44): the generated module too; the rules' own comments carry dashes, so it writes them as escapes.
  // NEGATIVE CONTROL (run 2026-10-15, v7.44): sync-rules.mjs writing plain JSON.stringify again made this read
  //   FAIL  S6 the release module, the sync script and the module it writes carry no dash
  check('S6 the release module, the sync script and the module it writes carry no dash',
    !DASH.test(SRC) && !DASH.test(f('tools/rules/sync-rules.mjs')) && !DASH.test(f('worker/rules-text.js')));
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
