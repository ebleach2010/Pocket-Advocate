// chatsend.mjs - a message that went through never reads as failed, and one that did not is written down (v7.79).
//
// Eric, 2026-10-17: "My client is having issues sending me messages. Not sure if that's still an issue but he's not
// responding." The client's send wrote the message, then the thread's preview line; a refused second write threw, so
// a message that had landed read "Couldn't send" and was typed again or given up on. And a real failure left no trace.
//
// public/js/chat.js is read at the source; worker/index.js handleChatTrouble is lifted and RUN.
//
//   M1 the message, then the pointer: only the message's own failure reaches the sender
//   M2 the trouble report: anyone signed in, short words only, never the words or the thread, a ring of thirty
//   M3 the flight recorder shows the failures and whether each open case's chat takes messages
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
const CHAT = f('public/js/chat.js');
const W = f('worker/index.js');

// ---- M1 ------------------------------------------------------------------------------------------------------------
{
  const send = (CHAT.match(/\n  async function send\(\{ text = '', attachment = null \}\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  const report = (CHAT.match(/\n  function reportTrouble\(step, err\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  // NEGATIVE CONTROL (run 2026-10-17): the pointer's `} catch (err) {\n      reportTrouble('pointer', err);\n    }` made a bare `} finally {}` (a refused pointer throws to the sender again) made this read
  //   FAIL  M1 a message that landed never reads as failed: the pointer's refusal is written down, only the message's own failure reaches the sender, and the report carries no words
  check('M1 a message that landed never reads as failed: the pointer\'s refusal is written down, only the message\'s own failure reaches the sender, and the report carries no words',
    /try \{\n\s+await addDoc\(messagesRef, message\);\n\s+\} catch \(err\) \{\n\s+reportTrouble\('send', err\);[\s\S]{0,120}throw err;\n\s+\}/.test(send)
    && /try \{\n\s+await updateDoc\(parentRef, \{[\s\S]*?\}\);\n\s+\} catch \(err\) \{\n\s+reportTrouble\('pointer', err\);\n\s+\}\n\s+nudgeOtherSide\(\);/.test(send)
    && /body: JSON\.stringify\(\{ kind: [^}]*, step, code: String\(err\?\.code \|\| err\?\.name \|\| 'error'\)\.slice\(0, 40\), online: navigator\.onLine !== false \}\)/.test(report)
    && !/text/.test(report.replace(/content-type/g, ''))
    && /if \(!err\?\.reported\) reportTrouble\('upload', err\);/.test(CHAT)
    && /errEl\.textContent = `Couldn't send: \$\{troubleWords\(err\)\}`;/.test(CHAT)
    && /'there is no connection right now\. Try again in a moment\.'/.test(CHAT) && /'this chat is not taking messages right now\. Reload the page and try again\.'/.test(CHAT),
    JSON.stringify({ send: send.length, report: report.length }));
}

// ---- M2 ------------------------------------------------------------------------------------------------------------
{
  const fn = (W.match(/\nasync function handleChatTrouble\(request, env\) \{[\s\S]*?\n\}\n/) || [''])[0];
  const READ_FAILED = Symbol('read-failed');
  const docs = new Map([['diag/sends', { runs: Array.from({ length: 30 }, (_, i) => ({ ev: 'send-fail', i })) }]]);
  const json = (o, st = 200) => new Response(JSON.stringify(o), { status: st, headers: { 'content-type': 'application/json' } });
  let run = null;
  try {
    run = new Function('requireUser', 'json', 'tryGet', 'patchDoc', 'READ_FAILED', `${fn}\nreturn handleChatTrouble;`)(
      async (r) => (r.headers.get('authorization') === 'Bearer ok' ? { uid: 'dana' } : null), json,
      async (env, p) => (docs.has(p) ? { data: JSON.parse(JSON.stringify(docs.get(p))) } : null),
      async (env, p, d) => { docs.set(p, { ...(docs.get(p) || {}), ...JSON.parse(JSON.stringify(d)) }); return true; },
      READ_FAILED);
  } catch { /* red below */ }
  const post = (auth, body) => run(new Request('https://x/api/chat-trouble', { method: 'POST', headers: { authorization: auth, 'content-type': 'application/json' }, body: JSON.stringify(body) }), {});
  const out = run ? await post('Bearer no', { step: 'send' }) : { status: 0 };
  const sent = run ? await post('Bearer ok', { kind: 'case', step: 'pointer', code: 'permission-denied<script>', online: true, text: 'my words', caseId: 'abc' }) : { status: 0 };
  const odd = run ? await post('Bearer ok', { kind: 'nope', step: 'drop', code: 'x'.repeat(90) }) : { status: 0 };
  const ring = docs.get('diag/sends').runs;
  // NEGATIVE CONTROL (run 2026-10-17): handleChatTrouble's `[entry, ...runs].slice(0, 30)` made `[entry, ...runs]` made this read
  //   FAIL  M2 a failure is written down for anyone signed in and nobody else, in short words, never the words or the thread, in a ring of thirty
  check('M2 a failure is written down for anyone signed in and nobody else, in short words, never the words or the thread, in a ring of thirty',
    !!run && out.status === 404 && sent.status === 200 && odd.status === 200 && ring.length === 30
    && ring[1].ev === 'send-fail' && ring[1].kind === 'case' && ring[1].step === 'pointer' && ring[1].code === 'permission-deniedscript' && ring[1].online === true
    && Object.keys(ring[1]).sort().join() === 'at,code,ev,kind,online,step'
    && ring[0].kind === 'case' && ring[0].step === 'other' && ring[0].code.length === 40 && ring[0].online === false
    && /if \(url\.pathname === '\/api\/chat-trouble' && request\.method === 'POST'\)\n\s+return await handleChatTrouble\(request, env\);/.test(W)
    && !DASH.test(fn),
    JSON.stringify({ out: out.status, sent: sent.status, first: ring[0], second: ring[1], n: ring.length }));
}

// ---- M3 ------------------------------------------------------------------------------------------------------------
{
  // NEGATIVE CONTROL (run 2026-10-17): the diag's `sends: sends?.data.runs || [],` taken out made this read
  //   FAIL  M3 the flight recorder shows the failures, and whether each open case's chat takes messages by the page's own rule, with no ids and no words
  check('M3 the flight recorder shows the failures, and whether each open case\'s chat takes messages by the page\'s own rule, with no ids and no words',
    /getDoc\(env, 'diag\/sends'\)\.catch\(\(\) => null\),\n\s+\]\);/.test(W) && /sends: sends\?\.data\.runs \|\| \[\],/.test(W)
    && /chat: c\.data\.hold\?\.pausedAt \? 'paused'\n\s+: \(!c\.data\.chatUnlocked && c\.data\.appointment\?\.start && new Date\(c\.data\.appointment\.start\)\.getTime\(\) - Date\.now\(\) > 7 \* 86_400_000\) \? 'locked' : 'open',/.test(W)
    && /lastMsgRole: c\.data\.lastMessage\?\.role === 'admin' \? 'staff' : c\.data\.lastMessage \? 'client' : null,/.test(W)
    && /lastMsgAgeS: age\(c\.data\.lastMessage\?\.ts\),/.test(W)
    // The page's own rule, so the two cannot drift: case.js locks on the same week.
    && /const chatLocked = !closed && !paused && !c\.chatUnlocked && !justOpened\n\s+&& startMs && \(startMs - Date\.now\(\) > 7 \* 86_400_000\);/.test(f('public/js/case.js')));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
