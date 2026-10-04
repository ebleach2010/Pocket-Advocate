// release.mjs - the version on every push, and what outlived PR 420.
//
//   node tools/suites/release.mjs
//
// Eric, 2026-10-04: "Delete the trading desk folder and contents in code. I
// won't be using it." trade.mjs went with the desk, and it was the one suite
// that pinned the version on every push (its T36). That pin lives here now,
// with the three things trade.mjs proved that were never about trading: a
// blank system block never reaches the wire, the PDF writer the showcase
// files with makes a real PDF, and a leftover scan marker is never judged
// as a reading. And the desk itself is held gone: no file, no route, no
// cron hook, no diagnostic, no page, no demo, and the trading terms it
// saved stay out of every glossary and off the dictionary page.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath as f2 } from 'node:url';
import { dirname as d, join as j } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
const ROOT = j(d(f2(import.meta.url)), '..', '..');
const f = (p) => readFileSync(j(ROOT, p), 'utf8');
const has = (p) => existsSync(j(ROOT, p));
const W = f('worker/index.js');
const ADV = f('worker/advisor.js');
const CL = f('public/js/changelog.js');
const pdf = await import('../../public/js/textpdf.js');
const changelog = await import('../../public/js/changelog.js');

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
function lift(src, decl) {
  const start = src.indexOf(decl);
  if (start < 0) return '';
  let depth = 0;
  let inTpl = false;
  for (let i = src.indexOf('{', start + decl.length - 1); i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '`') { inTpl = !inTpl; continue; }
    if (inTpl) continue;
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const grab = (src, re) => (src.match(re) || [''])[0];
const DASH = /[\u2013\u2014]/;
const HARD = [/advisor/i, /differential/i, /\bAI\b/, /\bLLM\b/i, /language model/i, /\bClaude\b/i, /Anthropic/i, /\bOpus\b/i, /\bFable\b/i, /\bthe model\b/i, /\ba model\b/i, /chatbot/i];

// ---- R1: the versions and the words (was trade.mjs T36) ------------------------------------
// Every push to main bumps both copies of the version and the tag, and the newest entry is
// quiet, admin-only and clean. The desk's own entries (4.6 to 7.20) stay as history, every one
// of them quiet with an empty client list, so not one ever reached a client's notes.
// NEGATIVE CONTROL (run 2026-10-04): the worker's VERSION left at '7.20' made this read
//   FAIL  R1 both versions read 7.21 with the new tag, the 7.21 entry is quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
// RE-PINNED 2026-10-04 (v7.22): both versions read 7.22 with the fund-verify tag, and the 7.22 entry
// says what was built in his words; the 7.21 entry keeps its own.
// NEGATIVE CONTROL (run 2026-10-04): `quiet: true` taken off the 6.0 entry made this read
//   FAIL  R1 both versions read 7.21 with the new tag, the 7.21 entry is quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
{
  const entry721 = (CL.match(/\{\n\s+\/\/ PR 420 DELETED \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  const entry722 = (CL.match(/\{\n\s+\/\/ THE COMMUNITY ASSISTANCE FUND'S VERIFICATION \(Eric, 2026-10-04[\s\S]*?\n  \},/) || [''])[0];
  const num = (v) => v.split('.').map(Number);
  const atLeast = (v, w) => { const [a, b] = num(v); const [c, e] = num(w); return a > c || (a === c && b >= e); };
  const since46 = changelog.CHANGELOG.filter((e) => atLeast(e.version, '4.6'));
  // NEGATIVE CONTROL (run 2026-10-04, v7.22): the 7.22 entry's `quiet: true` taken off made this read
  //   FAIL  R1 both versions read 7.22 with the new tag, the 7.22 and 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list
  check('R1 both versions read 7.22 with the new tag, the 7.22 and 7.21 entries are quiet and admin-only in his words with no dash and no blindness word, and every entry from 4.6 on is quiet with an empty client list',
    /export const VERSION = '7\.22';/.test(CL) && /const VERSION = '7\.22';/.test(W) && /const BUILD_TAG = 'v2026-10-04-fund-verify';/.test(W)
    && changelog.CHANGELOG[0].version === '7.22'
    && /version: '7\.22',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry722)
    && /Community Assistance Fund verification is built/.test(entry722) && /You cannot verify your own application\./.test(entry722)
    && !DASH.test(entry722) && !HARD.some((re) => re.test(entry722))
    && /version: '7\.21',\n\s+quiet: true,\n\s+client: \[\],\n\s+admin: \[/.test(entry721)
    && /PR 420 is gone\./.test(entry721) && /no longer show in your dictionary or on any case/.test(entry721)
    && !DASH.test(entry721) && !HARD.some((re) => re.test(entry721))
    && since46.length >= 40 && since46.every((e) => e.quiet === true && Array.isArray(e.client) && e.client.length === 0),
    JSON.stringify({ newest: changelog.CHANGELOG[0].version, loud: since46.filter((e) => !e.quiet || e.client.length).map((e) => e.version) }));
}

// ---- the engine's seams, lifted and run --------------------------------------------------
const withPolicy = lift(ADV, 'export async function withCasePolicy(env, kind, id, fn) {');
const harness = () => {
  const store = new Map();
  const deps = {
    AsyncLocalStorage,
    getDoc: async (env2, path) => (store.has(path) ? { id: path.split('/').pop(), data: store.get(path) } : null),
    statePath: (kind, id) => `${kind === 'case' ? 'cases' : 'subscriptions'}/${id}/advisor/state`,
    listDocs: async () => store.get('advisorKnowledge') || [],
  };
  const api = new Function('deps', `
    const { AsyncLocalStorage, getDoc, statePath, listDocs } = deps;
    const READ_FAILED = Symbol('read failed'); const tryGet = async (env, p) => { try { return await getDoc(env, p); } catch { return READ_FAILED; } };
    const readFailedError = (m) => new Error(m);
    ${grab(ADV, /export const LEGACY_TRADE_CATEGORIES = \[[^\]]*\];/).replace('export const', 'const')}
    ${lift(ADV, 'function withCacheBp(system) {')}
    ${grab(ADV, /const MODEL = '[^']+';/)}
    ${grab(ADV, /const SELF_MODEL = '[^']+';/)}
    ${grab(ADV, /const SELF_EFFORT = '[^']+';/)}
    ${grab(ADV, /const CASE_EFFORT = '[^']+';/)}
    ${grab(ADV, /const turnPolicy = new AsyncLocalStorage\(\);/)}
    ${withPolicy.replace('export async function', 'async function')}
    ${lift(ADV, 'function selfBlock() {')}
    ${lift(ADV, 'function todayBlock() {')}
    ${lift(ADV, 'function turnRequest({ system, messages, effort, maxTokens = 64000, tools }) {')}
    ${lift(ADV, 'async function loadKnowledge(env) {')}
    return { withCasePolicy, turnRequest, loadKnowledge, turnPolicy, MODEL, SELF_MODEL };
  `)(deps);
  return { api, store };
};

{
  const H = harness();
  // An old desk document still in the database is just his own case to the engine now.
  H.store.set('cases/desk', { self: true, trade: true, clientName: 'PR 420' });
  H.store.set('cases/mine', { self: true, clientName: 'Eric Bleach' });
  H.store.set('cases/client', { clientName: 'Jane' });
  const seen = (id) => H.api.withCasePolicy({}, 'case', id, async () => H.api.turnPolicy.getStore());
  const desk = await seen('desk');
  const mine = await seen('mine');
  const build = () => H.api.turnRequest({ system: 'SYS', messages: [], effort: 'medium', maxTokens: 1000, tools: [{ name: 'set_price' }] });
  const onMine = await H.api.withCasePolicy({}, 'case', 'mine', async () => build());
  const onClient = await H.api.withCasePolicy({}, 'case', 'client', async () => build());
  // NEGATIVE CONTROL (run 2026-10-04): `policy = { ...policy, tools: [{ type: 'web_search_20260209' }] }` added after the self branch made this read
  //   FAIL  R2 the engine has no trade policy left: an old desk document reads as his own case with his own model, no extra tools and no trade flag; his own case gets the self block and the caller's tools; a client case gets neither the block nor a policy
  check('R2 the engine has no trade policy left: an old desk document reads as his own case with his own model, no extra tools and no trade flag; his own case gets the self block and the caller\'s tools; a client case gets neither the block nor a policy',
    withPolicy.length > 200 && desk?.self === true && desk.trade === undefined && desk.model === H.api.SELF_MODEL && !desk.tools
    && mine?.self === true && !mine.tools
    && onMine.tools.length === 1 && onMine.tools[0].name === 'set_price' && onMine.system.some((b) => /HIS OWN CASE/.test(b.text))
    && onClient.tools[0].name === 'set_price' && !onClient.system.some((b) => /HIS OWN CASE/.test(b.text))
    && !/TRADE_|\.trade\b|trade:/.test(ADV.replace(/LEGACY_TRADE_CATEGORIES/g, '')),
    JSON.stringify({ desk, mine: mine?.model }));

  // ERIC, 2026-09-22: "Analysis failed: system: text content blocks must contain non-whitespace
  // text". Seven callers fall back to one space when a note has nothing to say, and the API
  // refuses a whitespace-only block. Was trade.mjs T38; nothing about it was ever the desk's.
  const blanks = () => H.api.turnRequest({ system: [{ type: 'text', text: 'SYS', cache: true }, { type: 'text', text: ' ' }, { type: 'text', text: '' }], messages: [], effort: 'medium', maxTokens: 1000 });
  const blankMine = await H.api.withCasePolicy({}, 'case', 'mine', async () => blanks());
  const blankClient = await H.api.withCasePolicy({}, 'case', 'client', async () => blanks());
  const blankNone = blanks();
  const noBlank = (t) => t.system.every((b) => b.type !== 'text' || /\S/.test(b.text));
  // NEGATIVE CONTROL (run 2026-09-22, as trade.mjs T38): the filter's test loosened to `/[\s\S]*/` (a space passes) made this read
  //   FAIL  T38 a blank system block never rides ...
  // NEGATIVE CONTROL (run 2026-10-04, moved here as R3): the same loosening made this read
  //   FAIL  R3 a blank system block never rides: a one-space block and an empty block are dropped on his own case, on a client case and outside any policy, the caller's flagged block keeps its breakpoint, the today block is still last with the trailing breakpoint, and the drop sits in turnRequest where every request is built
  check('R3 a blank system block never rides: a one-space block and an empty block are dropped on his own case, on a client case and outside any policy, the caller\'s flagged block keeps its breakpoint, the today block is still last with the trailing breakpoint, and the drop sits in turnRequest where every request is built',
    noBlank(blankMine) && noBlank(blankClient) && noBlank(blankNone)
    && blankClient.system.length === 2 && blankClient.system[0].text === 'SYS' && blankClient.system[0].cache_control?.type === 'ephemeral'
    && /^Today is /.test(blankClient.system[1].text) && blankClient.system[1].cache_control?.type === 'ephemeral'
    && blankMine.system.length === 3 && /HIS OWN CASE/.test(blankMine.system[2].text) && blankNone.system.length === 2
    && /const kept = sys\.filter\(\(b\) => b\.type !== 'text' \|\| \/\\S\/\.test\(String\(b\.text \?\? ''\)\)\);/.test(ADV)
    && /system: withCacheBp\(kept\),/.test(ADV),
    JSON.stringify({ client: blankClient.system.map((b) => b.text.slice(0, 12)), mine: blankMine.system.length }));

  // The trading terms the desk saved are still in his dictionary collection. No turn is handed
  // one: not his own case, not a client's, not a turn outside any run.
  H.store.set('advisorKnowledge', [
    { id: 'vwap', data: { term: 'VWAP', category: 'Indicator', learnedAt: null } },
    { id: 'orb', data: { term: 'Opening range', category: 'Setup', learnedAt: '2026-09-23' } },
    { id: 'ferritin', data: { term: 'Ferritin', category: 'Test or lab', learnedAt: '2026-09-01' } },
    { id: 'plain', data: { term: 'Plain', learnedAt: null } },
  ]);
  const deskTerms = await H.api.withCasePolicy({}, 'case', 'desk', async () => H.api.loadKnowledge({}));
  const mineTerms = await H.api.withCasePolicy({}, 'case', 'mine', async () => H.api.loadKnowledge({}));
  const noneTerms = await H.api.loadKnowledge({});
  const medical = (t) => t.learned.join() === 'Ferritin' && t.pending.join() === 'Plain';
  // NEGATIVE CONTROL (run 2026-10-04): loadKnowledge's filter removed (`const rows = all;`) made this read
  //   FAIL  R4 the trading terms the desk saved never reach a turn: an old desk document, his own case and a turn outside any run all get the medical half only, and the same eight categories are kept out of the panel's glossary, the dictionary page and the demo
  check('R4 the trading terms the desk saved never reach a turn: an old desk document, his own case and a turn outside any run all get the medical half only, and the same eight categories are kept out of the panel\'s glossary, the dictionary page and the demo',
    medical(deskTerms) && medical(mineTerms) && medical(noneTerms)
    && /export const LEGACY_TRADE_CATEGORIES = \['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'\];/.test(ADV)
    && /const LEGACY_TRADE_CATS = \['Setup', 'Indicator', 'Level', 'Order', 'Risk', 'Options', 'Market', 'Instrument'\];/.test(f('public/js/demo/api.js'))
    && /const terms = knowledge\.filter\(\(r\) => !LEGACY_TRADE_CATEGORIES\.includes\(String\(r\.data\.category \|\| ''\)\)\);/.test(W)
    && /\.filter\(\(r\) => !LEGACY_TRADE_CATEGORIES\.includes\(String\(r\.data\.category \|\| ''\)\)\);\n\s+return json\(\{\n\s+terms: rows\.map/.test(W)
    && /!LEGACY_TRADE_CATS\.includes\(d\.category \|\| 'General'\)/.test(f('public/js/demo/api.js')),
    JSON.stringify({ desk: deskTerms, none: noneTerms }));
}

// ---- R5: the PDF writer (was trade.mjs T40) ----------------------------------------------
// The showcase files its documents with it and the demo builds the same file in the browser.
{
  const e9 = String.fromCharCode(0xE9);
  const rq = String.fromCharCode(0x2019);
  const mid = String.fromCharCode(0xB7);
  const em = String.fromCharCode(0x2014);
  const bullet = String.fromCharCode(0x95);
  const bytes = pdf.textPdf(['Intro line.', '', '# Next steps', `- Caf${e9} ${rq}quote${rq} ${mid} and ${em} dash and an emoji ${String.fromCodePoint(0x1F4C8)} gone`,
    ...Array.from({ length: 90 }, (_, i) => `Line ${i} ` + 'word '.repeat(28))], { title: 'Call notes', footer: `Pocket Advocate ${mid} 2026-10-04 ${mid} For your records.` });
  const s = Buffer.from(bytes).toString('latin1');
  const xrefAt = Number((s.match(/startxref\n(\d+)\n/) || [])[1]);
  const entries = [...s.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((x) => Number(x[1]));
  const offsetsOk = entries.length > 0 && entries.every((off, i) => s.slice(off).startsWith(`${i + 1} 0 obj`));
  const count = Number((s.match(/\/Count (\d+)/) || [])[1]);
  const lengthsOk = [...s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)].every((m) => s.indexOf('\nendstream', m.index + m[0].length) - (m.index + m[0].length) === Number(m[1]));
  const PDFSRC = f('public/js/textpdf.js');
  // NEGATIVE CONTROL (run 2026-09-22, as trade.mjs T40): every xref offset written one byte off (`offsets.push(out.length + 1)`) made this read
  //   FAIL  T40 the PDF writer RUNS ...
  // NEGATIVE CONTROL (run 2026-10-04, moved here as R5): the same one-byte slip made this read
  //   FAIL  R5 the PDF writer RUNS: header to trailer with every object at the offset the table says and every stream as long as it claims, the title at 16 bold, a heading at 10.5 bold, a bullet glyph with the text indented, Latin-1 and the curly quote kept as WinAnsi bytes, the dash a hyphen and the emoji dropped, the footer and Page n of N on every page, and the served module carries no word from the blindness list and no dash
  check('R5 the PDF writer RUNS: header to trailer with every object at the offset the table says and every stream as long as it claims, the title at 16 bold, a heading at 10.5 bold, a bullet glyph with the text indented, Latin-1 and the curly quote kept as WinAnsi bytes, the dash a hyphen and the emoji dropped, the footer and Page n of N on every page, and the served module carries no word from the blindness list and no dash',
    s.startsWith('%PDF-1.4\n') && s.endsWith('%%EOF\n') && offsetsOk && lengthsOk && count >= 2 && (s.match(/\/Type \/Page\b/g) || []).length === count
    && /\/F2 16 Tf [^\n]*\(Call notes\) Tj/.test(s) && /\/F2 10\.5 Tf [^\n]*\(Next steps\) Tj/.test(s)
    && s.includes(`(${bullet}) Tj`) && /1 0 0 1 66 [\d.]+ Tm \(Caf/.test(s)
    && s.includes(`Caf${e9} ${String.fromCharCode(0x92)}quote${String.fromCharCode(0x92)} ${mid} and - dash and an emoji gone`)
    && !/[\x96\x97]/.test(s) && !s.includes('?')
    && (s.match(/\(Page \d+ of \d+\) Tj/g) || []).length === count && s.includes(`(Page 1 of ${count}) Tj`) && (s.match(/For your records\.\) Tj/g) || []).length === count
    && HARD.every((re) => !re.test(PDFSRC)) && !DASH.test(PDFSRC),
    `offsets ${offsetsOk}, lengths ${lengthsOk}, count ${count}, objects ${entries.length}`);
}

// ---- R6: a leftover scan marker (was trade.mjs T56) --------------------------------------
// No scan has written a marker since 2026-09-23, but one left in the queue must still never
// reach the claim that would count it as a reading that will not start.
// NEGATIVE CONTROL (run 2026-09-23, as trade.mjs T56): the drain's scan branch's deleteDoc replaced with `void 0;` made this read
//   FAIL  T56 a leftover scan marker ...
// NEGATIVE CONTROL (run 2026-10-04, moved here as R6): the poller's scan branch removed made this read
//   FAIL  R6 a leftover scan marker is never mistaken for a reading: both sweepers delete it before anything else can judge it, the drain above the draft rescue and the claim, the poller above the case poll, and neither reaches for a scan flight
{
  const drain = lift(ADV, 'export async function runQueuedAnalyses(env, deadlineAt = 0) {');
  const now2 = lift(ADV, 'export async function pollFlightsNow(env) {');
  const del = 'await deleteDoc(env, `advisorQueue/${row.id}`).catch(() => {});';
  check('R6 a leftover scan marker is never mistaken for a reading: both sweepers delete it before anything else can judge it, the drain above the draft rescue and the claim, the poller above the case poll, and neither reaches for a scan flight',
    drain.length > 500 && now2.length > 100
    && /if \(row\.data\.scan\) \{\n\s+await deleteDoc\(env, `advisorQueue\/\$\{row\.id\}`\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}/.test(drain)
    && drain.indexOf('if (row.data.scan) {') < drain.indexOf('if (row.data.draft)')
    && /if \(row\.data\.scan\) \{\n\s+await deleteDoc\(env, `advisorQueue\/\$\{row\.id\}`\)\.catch\(\(\) => \{\}\);\n\s+continue;\n\s+\}\n\s+await pollCaseFlight\(env, kind, id, \{ minAgeMs: 45_000 \}\)/.test(now2)
    && drain.includes(del) && now2.includes(del) && !/pollScanFlight|SCAN_MARKER/.test(drain + now2 + ADV),
    JSON.stringify({ drain: drain.length, now2: now2.length }));
}

// ---- R7: PR 420 is gone ------------------------------------------------------------------
// Eric, 2026-10-04: "Delete the trading desk folder and contents in code." Every file it had is
// gone, nothing imports or routes to it, the cron drains his queued reads on every firing with
// no desk gate, the diagnostics lost its two desk modes, the shelf and the folder never show an
// old desk document, the demo has no desk, and no list still names its page.
// NEGATIVE CONTROL (run 2026-10-04): `if (url.pathname.startsWith('/api/admin/trade/')) return json({ error: 'Not found' }, 404);` put back in the router made this read
//   FAIL  R7 PR 420 is gone: ...
// NEGATIVE CONTROL (run 2026-10-04): the shelf's `if (!d.data().trade)` dropped (every case pushed) made this read
//   FAIL  R7 PR 420 is gone: ...
{
  const files = ['worker/trade.js', 'worker/trade-desk.js', 'worker/desk-run.js', 'public/admin-desk.html', 'public/js/admin-desk.js',
    'public/js/admin-deskapp.js', 'public/js/admin-deskfx.js', 'public/js/trade-math.js', 'tools/suites/desk.mjs', 'tools/suites/trade.mjs',
    'tools/drives/drive-trade.mjs'];
  const cron = (W.match(/async scheduled\(event, env, ctx\) \{[\s\S]*?\n  \},\n/) || [''])[0];
  const ADMIN = f('public/js/admin.js');
  const CASE = f('public/js/admin-case.js');
  const DEMO = f('public/js/demo/api.js');
  const SEED = f('public/js/demo/seed.js');
  const CSS = f('public/css/admin.css');
  const lists = ['tools/blindness-audit.mjs', 'tools/drives/drive-nosideways.mjs', 'tools/sweeps/contrast.mjs'].map(f).join('\n');
  const left = files.filter(has);
  check('R7 PR 420 is gone: every file it had is deleted; nothing in the Worker imports, routes or diagnoses it; the cron drains his queued reads on every firing with no desk gate and still runs the clock nudges and the booking close; the shelf drops an old desk document before any shelf sees it and an old link to one lands on the shelf; the demo and its seed have no desk; the stylesheet has no desk rules; and no list names its page',
    left.length === 0
    && !/trade\.js|trade-desk\.js|desk-run\.js|handleTrade|tradeRoute|TradeError|tradePanelBlock|maybeRunDesk|peekDesk|TRADE_SAY|resolveBars|fetchBars|\/api\/admin\/trade\/|'bars-probe'|do'\) === 'desk'|tradeStanding/.test(W)
    && cron.length > 500 && /\n    await runQueuedAnalyses\(env, deadlineAt\);\n/.test(cron) && !/deskDoc|ranDesk/.test(cron)
    && /\n    ctx\.waitUntil\(runWorkClockNudges\(env\)\);\n/.test(cron) && /\n    ctx\.waitUntil\(closeBookingsAug2026\(env\)\);\n/.test(cron)
    && /snapshot\.forEach\(\(d\) => \{ if \(!d\.data\(\)\.trade\) cases\.push\(\{ id: d\.id, \.\.\.d\.data\(\) \}\); \}\);/.test(ADMIN)
    && !/admin-desk|PR 420'|data-open-trade|\/api\/admin\/trade/.test(ADMIN)
    && /if \(data\.trade\) \{\n\s+location\.replace\('\/admin\.html'\);\n\s+return;\n\s+\}/.test(CASE) && !/admin-desk/.test(CASE)
    && !/\/api\/admin\/trade\/|trade-math|DEMO_QUOTES|deskPanelBlock|trade\/settings/.test(DEMO) && !/TRADE_ID|trade\//.test(SEED)
    && !/data-desk|--trade|\.trade-|THE TRADE DESK/.test(CSS)
    && !/admin-desk|demo-case-trade/.test(lists),
    JSON.stringify({ left }));
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
