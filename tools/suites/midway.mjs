// midway.mjs - the two-week effort report (Eric, 2026-08-30): "a CSV of the
// log and chat with your analysis of milestones, things accomplished, amount
// of hours I've put in, your analysis of work done on my part, and how it
// compares to a typical advocate."
//
// THE CHECK THAT MATTERS IS M1. The log CSV a client receives is built from
// the same records that carry his private notes, a clinic's direct line and
// who was on the call, and this suite runs the shipped builder against a
// record carrying all three and asserts all three are absent - then rebuilds
// the leaking version and proves the assertion can catch it.
//
// Run: node tools/suites/midway.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f(import.meta.url)), '..', '..');
const read = (p) => readFileSync(j(ROOT, p), 'utf8');
const WORKER = read('worker/index.js');
const ADV = read('worker/advisor.js');
const STOR = read('worker/storage.js');
const ADMIN = read('public/js/admin-case.js');
const DEMOAPI = read('public/js/demo/api.js');

const results = [];
const ck = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};

// ---- M1-M2: the CSVs, lifted and RUN --------------------------------------
const NOTES = 'She admitted the fax never went. Escalating Tuesday.';
const PHONE = '602-555-0184';
const PARTIES = 'me, the client, Marcy the records clerk';
const LOG_FIXTURE = [
  { at: '2026-08-28T13:17:00.000Z', kind: 'call', kindLabel: '', clinic: 'Valley Neurology', summary: 'Called your neurology office and chased the notes.', notes: NOTES, phone: PHONE, parties: PARTIES },
  { at: '2026-08-29T13:00:00.000Z', kind: 'em', kindLabel: 'Email', clinic: 'Their insurer', summary: 'Line "two", with quotes.', notes: NOTES, phone: PHONE, parties: PARTIES },
  { at: '2026-08-29T14:00:00.000Z', kind: 'call', clinic: 'Private only', summary: '', notes: NOTES, phone: PHONE, parties: PARTIES },
];
const logSrc = (WORKER.match(/function midwayLogCsv\(items\) \{[\s\S]*?\n\}/) || [''])[0];
let midwayLogCsv = null;
try { midwayLogCsv = new Function(`${logSrc}; return midwayLogCsv;`)(); } catch { /* red below */ }
const logCsv = midwayLogCsv ? midwayLogCsv(LOG_FIXTURE) : '';
// NEGATIVE CONTROL (run 2026-08-30): rebuilding the builder with the
// spread-all-fields shape and running the same fixture made the notes and
// the phone appear in the output, and this check read
//   FAIL  M1 the client's log CSV carries client lines only, and the private fields never appear
ck('M1 the client\'s log CSV carries client lines only, and the private fields never appear',
  !!midwayLogCsv
  && logCsv.startsWith('"Date","Type","What was done"')
  && logCsv.includes('"2026-08-28","call","Called your neurology office and chased the notes."')
  && logCsv.includes('"Email"')
  && logCsv.includes('"Line ""two"", with quotes."')
  && !logCsv.includes(NOTES) && !logCsv.includes(PHONE) && !logCsv.includes(PARTIES)
  && !logCsv.includes('Private only')
  && logCsv.split('\r\n').length === 3);
// And the leaking version, rebuilt and RUN, so the absence check above is
// proven able to see a presence.
const leaky = new Function(`
  function midwayLogCsv(items) {
    const cell = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const lines = [['Date', 'Type', 'What was done'].map(cell).join(',')];
    for (const it of items) lines.push(Object.values(it).map(cell).join(','));
    return lines.join('\\r\\n');
  }
  return midwayLogCsv;`)();
ck('M1b the negative control leaks on the same fixture, so M1 can catch a leak',
  leaky(LOG_FIXTURE).includes(NOTES) && leaky(LOG_FIXTURE).includes(PHONE));

const chatSrc = (WORKER.match(/function midwayChatCsv\(rows, clientName, advocate\) \{[\s\S]*?\n\}/) || [''])[0];
let midwayChatCsv = null;
try { midwayChatCsv = new Function(`${chatSrc}; return midwayChatCsv;`)(); } catch { /* red below */ }
const chatCsv = midwayChatCsv ? midwayChatCsv([
  { role: 'client', text: 'Any news?', ts: '2026-08-28T15:00:00.000Z' },
  { role: 'admin', text: 'Filed it this morning.', ts: '2026-08-28T16:00:00.000Z' },
  { role: 'client', attachment: { name: 'denial.pdf' }, ts: '2026-08-28T17:00:00.000Z' },
], 'Christopher', 'Eric') : '';
// NEGATIVE CONTROL (run 2026-08-30): renaming midwayChatCsv made this read
//   FAIL  M2 the chat CSV names both sides and marks shared files
ck('M2 the chat CSV names both sides and marks shared files',
  !!midwayChatCsv
  && chatCsv.includes('"Christopher","Any news?"')
  && chatCsv.includes('"Eric","Filed it this morning."')
  && chatCsv.includes('"[shared a file: denial.pdf]"'));

// ---- M3: the sweep, lifted and RUN ----------------------------------------
// heldMs rides inside midwayDueAt since 2026-09-01 (a paused month pushes
// the day-14 mark the way it pushes the window's end), so it lifts beside it.
const heldSrc = (WORKER.match(/function heldMs\(c\) \{[\s\S]*?\n\}/) || [''])[0];
const dueSrc = `${heldSrc}\n` + (WORKER.match(/function midwayDueAt\(c\) \{[\s\S]*?\n\}/) || [''])[0];
const sweepSrc = (WORKER.match(/async function sweepMidwayReports\(env, ctx\) \{[\s\S]*?\n\}/) || [''])[0];
ck('M3a the due mark and the sweep lift out of the shipped Worker',
  dueSrc.length > 0 && sweepSrc.length > 0);
const DAY = 86_400_000;
const runSweep = async (metaByCase, nowMs, cases) => {
  const patched = [];
  const ran = [];
  const deps = {
    queryDocs: async (_e, coll) => (coll === 'cases' ? cases : []),
    getDoc: async (_e, path) => {
      const id = path.split('/')[1];
      return metaByCase[id] ? { data: metaByCase[id] } : null;
    },
    patchDoc: async (_e, path, fields) => { patched.push({ path, fields }); },
    notifyUser: async () => {},
    runMidwayReport: async (_e, id) => { ran.push(id); },
    console,
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('deps', 'nowMs', `
    const { queryDocs, getDoc, patchDoc, notifyUser, runMidwayReport, console } = deps;
    Date.now = () => nowMs;
    ${dueSrc}
    ${sweepSrc}
    return sweepMidwayReports({}, { waitUntil: (p) => p });`);
  // Date.now stays stubbed until the ASYNC sweep has actually finished
  // reading it: restoring it right after the call handed the sweep the real
  // clock past its first await, which mis-aimed the whole window test.
  const realNow = Date.now;
  try {
    await fn(deps, nowMs);
    await new Promise((r) => setTimeout(r, 20));
  } finally {
    Date.now = realNow;
  }
  return { patched, ran };
};
const T0 = Date.parse('2026-08-01T00:00:00Z');
const NOW = T0 + 16 * DAY;
const CASES = [
  { id: 'due', data: { fullAccess: true, clientUid: 'u1', clientName: 'C', fullAccessAt: new Date(T0).toISOString(), status: 'open' } },
  { id: 'early', data: { fullAccess: true, clientUid: 'u2', fullAccessAt: new Date(T0 + 10 * DAY).toISOString(), status: 'open' } },
  { id: 'stale', data: { fullAccess: true, clientUid: 'u3', fullAccessAt: new Date(T0 - 30 * DAY).toISOString(), status: 'open' } },
  { id: 'closed', data: { fullAccess: true, clientUid: 'u4', fullAccessAt: new Date(T0).toISOString(), status: 'closed' } },
];
const fresh = await runSweep({}, NOW, CASES);
const already = await runSweep({
  due: { midwayReport: { generatedAt: '2026-08-15T00:00:00Z' } },
}, NOW, CASES);
const running = await runSweep({
  due: { midwayReport: { startedAt: new Date(NOW - 5 * 60_000).toISOString() } },
}, NOW, CASES);
// NEGATIVE CONTROL (run 2026-08-30): widening the window test to `now >= due`
// alone made the 'stale' case fire and this read
//   FAIL  M3 the sweep fires exactly once, in the window, on open Hands-Off cases only
ck('M3 the sweep fires exactly once, in the window, on open Hands-Off cases only',
  fresh.ran.length === 1 && fresh.ran[0] === 'due'
  && fresh.patched.some((p) => p.path === 'caseMeta/due' && p.fields.midwayReport?.startedAt)
  && already.ran.length === 0 && running.ran.length === 0,
  `fresh ran ${JSON.stringify(fresh.ran)}, already ${already.ran.length}, running ${running.ran.length}`);

// ---- M4-M8: pins ----------------------------------------------------------
// NEGATIVE CONTROL (run 2026-08-30): deleting the client-lines fence comment
// and filter from runMidwayReport made this read
//   FAIL  M4 the narrative is fenced to what the client already sees, and says the honest scale line
ck('M4 the narrative is fenced to what the client already sees, and says the honest scale line',
  /CLIENT LINES ONLY/.test(ADV)
  && /filter\(\(r\) => String\(r\.data\.summary \|\| ''\)\.trim\(\)\)/.test(ADV)
  && /2 to 5 hours\s+a week into an active case/.test(ADV)
  && /No em or en dashes/.test(ADV)
  && /never to be referenced or hinted at/.test(ADV)
  && /caseMeta\/\$\{caseId\}/.test(ADV));

// NEGATIVE CONTROL (run 2026-08-30): making the send path fall back to the
// stored draft when body.text is empty made this read
//   FAIL  M5 send delivers HIS text word for word, uploads both CSVs, and stamps sentAt once
ck('M5 send delivers HIS text word for word, uploads both CSVs, and stamps sentAt once',
  /const text = String\(body\.text \|\| ''\)\.replace\(\/\\r\\n\/g, '\\n'\)\.trim\(\)\.slice\(0, 2400\);/.test(WORKER)
  && /if \(!text\) return json\(\{ error: 'The message is empty\.' \}, 400\);/.test(WORKER)
  && /if \(mr\.sentAt\) return json\(\{ error: 'Already sent\.' \}, 409\);/.test(WORKER)
  && /two-week-work-log\.csv/.test(WORKER)
  && /two-week-chat\.csv/.test(WORKER)
  && /Your two-week report is in/.test(WORKER)
  && /midwayReport: \{ generatedAt: mr\.generatedAt \|\| now, draft: text, sentAt: now \}/.test(WORKER));

// NEGATIVE CONTROL (run 2026-08-30): renaming uploadFile in storage.js made
// this read
//   FAIL  M6 the Worker can write a file, multipart with its metadata, on the write scope
ck('M6 the Worker can write a file, multipart with its metadata, on the write scope',
  /export async function uploadFile\(env, path, bytes, contentType, customMetadata = null\)/.test(STOR)
  && /uploadType=multipart/.test(STOR)
  && /devstorage\.read_write/.test(STOR));

// NEGATIVE CONTROL (run 2026-08-30): dropping paintMidwayCard from
// refreshOverview made this read
//   FAIL  M7 the ready card sits on the Overview, his edits are the message, Send posts them
ck('M7 the ready card sits on the Overview, his edits are the message, Send posts them',
  /paintAuthorityStatus\(pane\);\n  paintMidwayCard\(pane\);/.test(ADMIN)
  && /data-midway-text/.test(ADMIN)
  && /action: 'send', text/.test(ADMIN)
  && /The two-week report is ready/.test(ADMIN));

// NEGATIVE CONTROL (run 2026-08-30): removing the demo's already-sent guard
// made this read
//   FAIL  M8 the demo mirrors the route: a ready draft, a real send, and no second send
ck('M8 the demo mirrors the route: a ready draft, a real send, and no second send',
  /\/api\/admin\/midway/.test(DEMOAPI)
  && /if \(mr\?\.sentAt\) return fail\(409, 'Already sent\.'\);/.test(DEMOAPI)
  && /sentAt: now\.toISOString\(\)/.test(DEMOAPI));

// ---- the milestones feed in the report (Eric, 2026-08-30) -----------------
//
// "Will be part of the biweekly analysis on progress." The report fetches
// the feed he marks achievements on and is told to build its progress
// section on it, fleshed out only from the log and the chat.
// NEGATIVE CONTROL (run 2026-08-30): pointing the fetch at a collection that
// is not the feed made this read
//   FAIL  M9 the report reads the milestones feed and builds its spine from it
ck('M9 the report reads the milestones feed and builds its spine from it',
  /private\/milestones\/items/.test(ADV)
  && /<milestones>/.test(ADV)
  && /the spine of this, each entry a marked/.test(ADV)
  && /\(none marked yet\)/.test(ADV));

// ---- the pause pushes the mark (Eric, 2026-09-01) -------------------------
// NEGATIVE CONTROL (run 2026-09-01): dropping heldMs from the mark made
// this read
//   FAIL  M10 a paused month pushes the day-14 mark exactly as it pushes the window
ck('M10 a paused month pushes the day-14 mark exactly as it pushes the window',
  /start \+ 14 \* 86_400_000 \+ heldMs\(c\)/.test(WORKER));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
