// askscope.mjs - what an Advisor question reads: its memory, unless he widens it (v7.80).
//
// Eric, 2026-10-17: "When asking the advisor a question, there should be a toggle of some sort that has the advisor
// read your question against the case as of today, the past week, or all time. As well as 'search the chat' 'search
// uploads'. In as compact as possible. Possibly a press and hold that opens a wheel ... It should also store general
// memory that it's already scraped and only search things it's uncertain about. There is absolutely no reason for it
// to read the entirety of the case every time unless prompted."
//
// worker/ask-scope.js is imported and run; runQuestion's memory line is lifted and run; the rest is read at the source.
//
//   Q1 the rule: memory by default; a time searches the chat; a source alone searches all of it; the windows
//   Q2 the Worker: the question reads its window, says what it remembers, searches files only when asked
//   Q3 the panel: the chip, the wheel (tap or hold Ask), the scope sent and then back to memory, the line under it
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const f = (p) => readFileSync(join(ROOT, p), 'utf8');
const DASH = new RegExp('[\\u2013\\u2014]');
const results = [];
function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
}
const S = await import(pathToFileURL(join(ROOT, 'worker/ask-scope.js')).href);
const DAY = 86_400_000;
const NOW = Date.parse('2026-10-17T21:00:00Z'); // 2pm MST
const at = (ms) => ({ data: { text: 'x', ts: new Date(ms).toISOString() } });

// ---- Q1 ------------------------------------------------------------------------------------------------------------
{
  const c = S.cleanScope;
  const rows = [at(NOW - 20 * DAY), at(NOW - 6 * DAY), at(NOW - 3 * 3600_000), at(NOW - 60_000)];
  const read = new Date(NOW - 5 * DAY).toISOString();
  const many = Array.from({ length: 50 }, (_, i) => at(NOW - (50 - i) * 3600_000));
  const files = [{ name: 'old.pdf', at: new Date(NOW - 9 * DAY).toISOString() }, { name: 'new.pdf', at: new Date(NOW - DAY).toISOString() }, { name: 'today.jpg', at: new Date(NOW - 3600_000).toISOString() }];
  // NEGATIVE CONTROL (run 2026-10-17): cleanScope's `if (time !== 'memory' && !chat && !uploads) chat = true;` taken out made this read
  //   FAIL  Q1 memory unless widened: a time searches the chat, a source alone searches all of it; today opens at his midnight; memory reads only what came after the last read
  check('Q1 memory unless widened: a time searches the chat, a source alone searches all of it; today opens at his midnight; memory reads only what came after the last read',
    JSON.stringify(c(undefined)) === '{"time":"memory","chat":false,"uploads":false}' && JSON.stringify(c({ time: 'week' })) === '{"time":"week","chat":true,"uploads":false}'
    && JSON.stringify(c({ uploads: true })) === '{"time":"all","chat":false,"uploads":true}' && JSON.stringify(c({ time: 'nope', chat: 'yes' })) === '{"time":"memory","chat":false,"uploads":false}'
    && S.sinceMs('today', NOW) === Date.parse('2026-10-17T07:00:00Z') && S.sinceMs('week', NOW) === NOW - 7 * DAY && S.sinceMs('all', NOW) === 0 && S.sinceMs('memory', NOW) === null
    && S.windowRows(rows, c({}), read, NOW).length === 2 && S.windowRows(many, c({}), null, NOW).length === S.FIRST_LOOK
    && S.windowRows(rows, c({ time: 'today' }), read, NOW).length === 2 && S.windowRows(rows, c({ time: 'week' }), read, NOW).length === 3 && S.windowRows(rows, c({ time: 'all' }), read, NOW).length === 4
    && S.windowFiles(files, c({}), NOW).length === 0 && S.windowFiles(files, c({ time: 'week', uploads: true }), NOW).map((x) => x.name).join() === 'today.jpg,new.pdf'
    && S.scopeWords(c({})) === 'from memory' && S.scopeWords(c({ time: 'week', uploads: true, chat: true })) === 'chat and uploads, the past week'
    && !DASH.test(f('worker/ask-scope.js')),
    JSON.stringify({ week: c({ time: 'week' }), today: S.sinceMs('today', NOW) }));
}

// ---- Q2 ------------------------------------------------------------------------------------------------------------
{
  const ADV = f('worker/advisor.js'); const W = f('worker/index.js');
  const rq = (ADV.match(/export async function runQuestion[\s\S]*?\n\}/) || [''])[0];
  const mn = (ADV.match(/\nfunction memoryNote\(state, scope\) \{[\s\S]*?\n\}\n/) || [''])[0];
  let memoryNote = null;
  try { memoryNote = new Function('scopeWords', `${mn}\nreturn memoryNote;`)(S.scopeWords); } catch { /* red below */ }
  const said = memoryNote ? memoryNote({ readFiles: ['cases/k1/uploads/1760000000000-MRI report.pdf', 'inline:labs.png:2048', 'cases/k1/chat-files/1760000000001-MRI report.pdf'], analyzedThroughTs: '2026-10-16T23:00:00Z' }, S.cleanScope({})) : '';
  const wide = memoryNote ? memoryNote({}, S.cleanScope({ time: 'today', uploads: true })) : '';
  // NEGATIVE CONTROL (run 2026-10-17): the question's `${memoryNote(state?.data, scope)}` taken off the front of its message made this read
  //   FAIL  Q2 a question reads only its window, says what it already holds and what it searched, names the search that would settle what it lacks, and reads files only when asked
  check('Q2 a question reads only its window, says what it already holds and what it searched, names the search that would settle what it lacks, and reads files only when asked',
    /const scope = cleanScope\(scopeIn\);/.test(rq) && /recentMessages\(env, kind, id, scope\.chat && scope\.time !== 'today' \? MAX_SCOPED_MESSAGES : MAX_MESSAGES\)/.test(rq)
    && /const rows = windowRows\(allRows, scope, state\?\.data\.analyzedThroughTs\);\n\s+const chat = transcript\(rows\);/.test(rq)
    && /if \(scope\.uploads && !attachment\) \{/.test(rq) && /selectedMediaBlocks\(env, windowFiles\(\[\.\.\.listed, \.\.\.shared\], scope\), kind, id, \[\]\)/.test(rq)
    && /text: `\$\{memoryNote\(state\?\.data, scope\)\}<transcript>/.test(rq) && /\$\{AUTHORITY_NOTE\}\$\{MEMORY_NOTE\}/.test(rq)
    && /name the\nsearch that would settle it, in his words: Today, Past week or All time, with\nSearch chat or Search uploads\./.test(ADV)
    && /This question searches: from memory\. Your reads have covered the chat through 2026-10-16\. Files you have already read: MRI report\.pdf; labs\.png\. The transcript below holds only the messages since your last read\./.test(said)
    && /This question searches: uploads, today\. Nothing has been read on a full pass yet\./.test(wide) && !/since your last read/.test(wide)
    && /const scope = cleanScope\(body\?\.scope\);/.test(W) && /status: 'running', at: new Date\(\), scope,/.test(W)
    && /import \{ cleanScope \} from '\.\/ask-scope\.js';/.test(W),
    JSON.stringify({ said: said.slice(0, 260), wide: wide.slice(0, 120) }));
}

// ---- Q3 ------------------------------------------------------------------------------------------------------------
{
  const P = f('public/js/advisor.js'); const D = f('public/js/demo/api.js');
  const label = (P.match(/\n  function scopeLabel\(sc\) \{[\s\S]*?\n  \}\n/) || [''])[0];
  let scopeLabel = null;
  try { scopeLabel = new Function(`${label}\nreturn scopeLabel;`)(); } catch { /* red below */ }
  // NEGATIVE CONTROL (run 2026-10-17): submitAsk's `{ scope: { ...askScope } }` made `{}` made this read
  //   FAIL  Q3 the panel: a chip beside the box says what the next question searches, a tap on it or a hold on Ask opens the wheel, the choice goes with the question and then goes back to memory, and the row says what it searched
  check('Q3 the panel: a chip beside the box says what the next question searches, a tap on it or a hold on Ask opens the wheel, the choice goes with the question and then goes back to memory, and the row says what it searched',
    // After Ask in the markup, so the box's first button is still Ask; shown first by `order: -1`.
    /<button class="btn quiet" type="submit">Ask<\/button>\n\s+<button type="button" class="ask-scope" data-scope aria-haspopup="true"[^>]*>Memory<\/button>/.test(P)
    && /\.ask-scope \{ order: -1; flex: none;/.test(P)
    && /const askBtn = askForm\.querySelector\('button\[type="submit"\]'\);/.test(P)
    && /\.\.\.\(attachment \? \{ attachment \} : \{ scope: \{ \.\.\.askScope \} \}\),/.test(P)
    && /if \(out\) setScope\(\{ time: 'memory', chat: false, uploads: false \}\);/.test(P)
    && ["'Today'", "'Past week'", "'All time'", "'Search uploads'", "'Search chat'"].every((w) => P.includes(`label: ${w}`)) && /class="scope-mid[^"]*"[^>]*>Memory<\/button>/.test(P)
    && /holdTimer = setTimeout\(\(\) => \{ wheelHeld = true; openWheel\(askBtn, true, e\.pointerId\); \}, 380\);/.test(P)
    && /if \(wheelHeld\) \{ wheelHeld = false; e\.preventDefault\(\); return; \}/.test(P)
    && /\$\{scopeLine\(q\.scope\)\}/.test(P) && /data-scope-line>Searched \$\{esc\(what\)\}, \$\{esc\(when\)\}/.test(P)
    && !!scopeLabel && scopeLabel({ time: 'memory' }) === 'Memory' && scopeLabel({ time: 'week', chat: true, uploads: true }) === 'Week · chat + uploads'
    && /scope: \{ time, chat, uploads \},/.test(D)
    && !DASH.test(P.slice(P.indexOf('WHAT A QUESTION SEARCHES'), P.indexOf("askBtn.addEventListener('contextmenu'"))),
    JSON.stringify({ label: label.length }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
