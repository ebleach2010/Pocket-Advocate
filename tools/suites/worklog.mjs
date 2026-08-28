// worklog.mjs - the log of what he has been doing, and the one line of it a
// client is allowed to see.
//
// Eric, 2026-08-27: "I also do unlimited calls etc so that section should just
// be a log of what I've been doing by date, so they can see what I've been up
// to. Calls with notes for reason, appeals, investigations, attended
// appointments." Asked two questions, he chose that each entry carries a short
// line he writes, client-safe and separate from his private notes, and that
// NOTHING auto-populates: only what he logs by hand.
//
// THE CHECK THAT MATTERS IS L4. His log lives at
// cases/{id}/private/clinicCalls/items, which firestore.rules denies to every
// browser in both directions, and the record on it carries a clinic's direct
// line, who else was on the call, and twenty thousand characters of his own
// notes. The client's view is therefore a PROJECTION built in the Worker, and
// this suite lifts that function out of the shipped file and runs it against a
// record carrying all three, then asserts all three strings are absent from
// what comes back.
//
// AND IT PROVES ITSELF EVERY RUN. L5 rebuilds the same function with its
// explicit field list swapped for the spread-and-delete shape that the real
// one deliberately is not, runs the identical fixture through it, and asserts
// that version DOES leak. An absence check that cannot detect a presence is
// not a check, and this is the negative control standing inside the suite
// rather than in a comment about one.
import { readFileSync } from 'node:fs';
import { fileURLToPath as f } from 'node:url';
import { dirname as d, join as j } from 'node:path';

const ROOT = j(d(f(import.meta.url)), '..', '..');
const read = (p) => readFileSync(j(ROOT, p), 'utf8');
const WORKER = read('worker/index.js');
const CLIENT = read('public/js/case.js');
const ADMIN = read('public/js/admin-case.js');
const READY = read('public/js/readiness.js');
const DEMO = read('public/js/demo/api.js');
const RULES = read('firestore.rules');
const TIER = read('public/js/tier-terms.js');
const CSS = read('public/css/site.css');

const results = [];
const ck = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond || !detail ? '' : `  -- ${detail}`}`);
};
/** Comments stripped. No build step here, so a comment is a served byte and a
 *  regex looking for the ABSENCE of something finds it in the very comment
 *  that explains why it is absent. */
const bare = (src) => src.split('\n')
  .filter((ln) => !/^\s*(\/\/|\*|\/\*)/.test(ln)).join('\n');

// ---- L1-L3: one record, four words, three copies of the list -------------
const workerKinds = (WORKER.match(/const LOG_KINDS = (\[[^\]]*\]);/) || [])[1] || '';
// NEGATIVE CONTROL (run 2026-08-27): renaming the Worker's LOG_KINDS made this
// read
//   FAIL  L1 the Worker names the four things he does  -- (not found)
ck('L1 the Worker names the four things he does',
  workerKinds.replace(/['\s]/g, '') === "[call,appeal,investigation,appointment]",
  workerKinds || '(not found)');
const adminIds = [...(ADMIN.match(/const LOG_KINDS = \[[\s\S]*?\n\];/) || [''])[0]
  .matchAll(/\{ id: '(\w+)', label: '[^']*', pill: '([^']*)' \}/g)]
  .map((m) => ({ id: m[1], pill: m[2] }));
const clientPills = (CLIENT.match(/const LOG_PILLS = \{[\s\S]*?\};/) || [''])[0];
const clientIds = [...clientPills.matchAll(/(\w+): '([^']*)'/g)].map((m) => ({ id: m[1], pill: m[2] }));
const sorted = (a) => a.slice().sort().join('|');
// NEGATIVE CONTROL (run 2026-08-27): dropping 'investigation' from the admin
// list made this read
//   FAIL  L2 ... -- worker call,appeal,investigation,appointment vs advocate appeal|appointment|call
ck('L2 and his own form offers exactly those four, no more and no fewer',
  sorted(adminIds.map((x) => x.id))
    === sorted(workerKinds.replace(/[[\]'\s]/g, '').split(',')),
  `worker ${workerKinds.replace(/[[\]'\s]/g, '')} vs advocate ${sorted(adminIds.map((x) => x.id))}`);
// The client's pill words and the advocate's must be the same words: a stored
// kind that lands on nothing renders a pill with no text in it.
// NEGATIVE CONTROL (run 2026-08-27): renaming the client's APPEAL pill to
// APPEALS made this read
//   FAIL  L3 ... -- advocate APPEAL|APPOINTMENT|CALL|INVESTIGATION vs client APPEALS|APPOINTMENT|CALL|INVESTIGATION
ck('L3 and the client\'s pill says exactly the same word for each of them',
  sorted(adminIds.map((x) => x.pill)) === sorted(clientIds.map((x) => x.pill))
    && sorted(adminIds.map((x) => x.id)) === sorted(clientIds.map((x) => x.id)),
  `advocate ${sorted(adminIds.map((x) => x.pill))} vs client ${sorted(clientIds.map((x) => x.pill))}`);

// ---- L4-L8: the projection, LIFTED AND RUN -------------------------------
// The record as it actually is: his notes, the clinic's direct line, and who
// else was on the call, all of which the private subtree exists to hold.
const PHONE = '602-555-0184';
const PARTIES = 'me, the client, Marcy the records clerk';
const NOTES = 'She admitted the fax never went. Escalating to the practice manager Tuesday.';
const FIXTURE = [
  {
    id: 'a1',
    data: {
      clinic: 'Valley Neurology', phone: PHONE, parties: PARTIES,
      kind: 'call', summary: 'Called your neurology office and chased the notes.',
      notes: NOTES, notesAt: '2026-08-20T18:00:00.000Z',
      at: '2026-08-20T17:00:00.000Z', createdAt: '2026-08-20T17:00:00.000Z',
    },
  },
  {
    id: 'a2',
    data: {
      clinic: 'Blue Cross AZ', phone: '602-555-0001', parties: 'me alone',
      kind: 'appeal', summary: 'Filed your first-level appeal.',
      notes: 'Cited the plan medical policy by number.', notesAt: null,
      at: '2026-08-22T16:00:00.000Z', createdAt: '2026-08-22T16:00:00.000Z',
    },
  },
  {
    // The entry he has written no client line on. This is the privacy valve.
    id: 'a3',
    data: {
      clinic: 'Dr Okafor, private', phone: '602-555-0999', parties: 'me alone',
      kind: 'investigation', summary: '   ',
      notes: 'He will not put the referral in writing. Do not tell them yet.',
      at: '2026-08-25T15:00:00.000Z', createdAt: '2026-08-25T15:00:00.000Z',
    },
  },
];

const src = (WORKER.match(/function caseLogProjection\(rows\) \{[\s\S]*?\n\}/) || [''])[0];
// NEGATIVE CONTROL (run 2026-08-27): renaming caseLogProjection made this read
//   FAIL  L4 the projection lifts out of the shipped Worker
// A lift that has lost its target goes red rather than asserting nothing.
ck('L4 the projection lifts out of the shipped Worker', src.length > 0);

const build = (body) => new Function(`
  const LOG_KINDS = ${workerKinds || "['call']"};
  ${body}
  return caseLogProjection;
`)();

let out = [];
let threw = '';
try { out = build(src)(FIXTURE); } catch (e) { threw = `${e.constructor.name}: ${e.message}`; }
const shipped = JSON.stringify(out);
// NEGATIVE CONTROL (run 2026-08-27): changing the projection to
// `out.push({ id: r.id, ...d })` made this read
//   FAIL  L5 ... -- leaked: phone, parties, notes
// which is the exact mistake a spread-and-delete invites.
ck('L5 no phone, no parties and no notes reach the client, at all',
  !threw && ![PHONE, PARTIES, NOTES, '602-555-0001', '602-555-0999', 'Do not tell them yet']
    .some((x) => shipped.includes(x)),
  threw || `leaked: ${['phone', 'parties', 'notes'].filter((k) => shipped.includes(
    k === 'phone' ? PHONE : k === 'parties' ? PARTIES : NOTES)).join(', ') || shipped.slice(0, 120)}`);
// AND THE FIELD NAMES TOO. A key called `phone` holding an empty string still
// tells a reader of the response that this record has one.
// NEGATIVE CONTROL (run 2026-08-27): the spread version made this read
//   FAIL  L5b ... -- notes, notesAt, parties, phone
const keys = [...new Set(out.flatMap((o) => Object.keys(o)))].sort();
ck('L5b and not even the field NAMES for them come back',
  !threw && !keys.some((k) => ['phone', 'parties', 'notes', 'notesAt'].includes(k)),
  keys.join(', '));
ck('L5c the four fields it does carry are the four it is meant to',
  !threw && keys.join(',') === 'at,id,kind,summary,who', keys.join(','));

// THE NEGATIVE CONTROL, STANDING INSIDE THE SUITE. The same fixture through a
// projection built the way the real one deliberately is not. If this one does
// NOT leak, the assertion above proves nothing and this suite says so.
const leaky = src
  .replace(/out\.push\(\{[\s\S]*?\}\);/, 'out.push({ id: String((r && r.id) || \'\'), ...d });');
let leakedOut = '';
try { leakedOut = JSON.stringify(build(leaky)(FIXTURE)); } catch (e) { leakedOut = ''; }
ck('L6 and the assertion above is capable of catching a leak, proved every run',
  leakedOut.includes(PHONE) && leakedOut.includes(PARTIES) && leakedOut.includes(NOTES),
  leakedOut ? 'the spread version did NOT leak, so L5 is not testing anything' : 'the control build threw');

// NEGATIVE CONTROL (run 2026-08-27): deleting the `if (!summary) continue;`
// line made this read
//   FAIL  L7 ... -- 3 rows reached the client
ck('L7 an entry with no client line does not reach the client at all',
  !threw && out.length === 2 && !shipped.includes('Dr Okafor'),
  threw || `${out.length} rows reached the client`);
// NEGATIVE CONTROL (run 2026-08-27): sorting ascending made this read
//   FAIL  L8 ... -- Called your neurology office and chased the notes.
ck('L8 and what is left is newest first, which is the top of a phone screen',
  !threw && out[0]?.summary === 'Filed your first-level appeal.',
  threw || out[0]?.summary || '(nothing)');
// A word he never wrote cannot appear on a pill. The kind is validated on the
// way in and again here, so a record from before the field existed still
// renders as what it always was.
const legacy = build(src)([{ id: 'x', data: { clinic: 'X', summary: 'y', at: null, createdAt: '2026-01-01T00:00:00.000Z' } },
  { id: 'z', data: { clinic: 'X', summary: 'y', kind: '<script>', at: null, createdAt: '2026-01-01T00:00:00.000Z' } }]);
// NEGATIVE CONTROL (run 2026-08-27): passing d.kind straight through made this
// read
//   FAIL  L9 ... -- ,<script>
ck('L9 a missing or unknown kind becomes the one this record always held',
  legacy.every((r) => r.kind === 'call'), legacy.map((r) => r.kind).join(','));

// ---- L10-L13: the route, and the wall it stands on -----------------------
// NEGATIVE CONTROL (run 2026-08-27): deleting the private-subtree deny made
// this read
//   FAIL  L10 the record itself is still denied to every browser, his included
// PINNED INSIDE THE CASE BLOCK, and this took two tries to get right, both of
// which are the reason the comment is here. The first draft looked for the
// clause anywhere in the file and stayed green with the rule deleted, because
// "allow read, write: if false" is also the deny-everything tail. The second
// pinned the clause but not its parent, and stayed green too: there is a
// SECOND `match /private/{document=**}` under /subscriptions, so deleting the
// case one left the subscription one satisfying the regex. Both were silent
// passes on the single most important rule in this suite. So the case block is
// sliced out first and the clause is looked for only in there.
const caseRules = RULES.slice(RULES.indexOf('match /cases/{caseId}'),
  RULES.indexOf('match /subscriptions/{uid}'));
ck('L10 the record itself is still denied to every browser, his included',
  caseRules.length > 100
  && /match \/private\/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/.test(caseRules),
  caseRules.length > 100 ? 'the case block no longer denies its private subtree'
    : 'could not slice the case block out of firestore.rules');
// NEGATIVE CONTROL (run 2026-08-27): removing the threadContext lines from
// handleCaseLog made this read
//   FAIL  L11 the client route checks membership before it reads anything
const routeFn = (WORKER.match(/async function handleCaseLog\([\s\S]*?\n\}/) || [''])[0];
ck('L11 the client route checks membership before it reads anything',
  routeFn.length > 0
  && routeFn.indexOf("threadContext(env, user, 'case', id)") > 0
  && routeFn.indexOf("threadContext(env, user, 'case', id)") < routeFn.indexOf('listDocs'),
  routeFn ? 'membership check is not ahead of the read' : 'could not find handleCaseLog');
// NEGATIVE CONTROL (run 2026-08-27): dropping the method guard from the route
// table made this read
//   FAIL  L12 ... -- nothing a client sends can write to his log
ck('L12 and it is read only, so nothing a client sends can write to his log',
  /'\/api\/case-log' && request\.method === 'GET'/.test(WORKER)
  && !/handleCaseLog[\s\S]{0,400}patchDoc/.test(WORKER),
  'nothing a client sends can write to his log');
// NEGATIVE CONTROL (run 2026-08-27): pointing the client at /api/clinic-calls
// made this read
//   FAIL  L13 ... -- the client page asks for the admin route
ck('L13 the client page asks for the projection, never the admin route',
  /\/api\/case-log\?caseId=/.test(CLIENT) && !/\/api\/clinic-calls/.test(bare(CLIENT)),
  'the client page asks for the admin route');
// NEGATIVE CONTROL (run 2026-08-27): dropping requireAdmin from
// handleClinicCalls made this read
//   FAIL  L13b the record route is still his alone
ck('L13b the record route is still his alone',
  /async function handleClinicCalls\(request, env, url\) \{\n  const admin = await requireAdmin\(request, env\);/.test(WORKER));

// ---- L14-L16: nothing auto-populates, and he chooses per entry ------------
// Eric, asked directly: "only what I log by hand". No check-in, attended
// appointment or upload may write a row here on its own.
// NEGATIVE CONTROL (run 2026-08-27): adding a patchDoc into the clinicCalls
// collection from the check-in route made this read
//   FAIL  L14 ... -- 3 writers
const writers = [...WORKER.matchAll(/private\/clinicCalls\/items/g)].length;
const collDecls = [...bare(WORKER).matchAll(/`cases\/\$\{id\}\/private\/clinicCalls\/items`/g)].length;
ck('L14 exactly two places in the Worker touch the log: his route and the projection',
  writers === 2 && collDecls === 2, `${writers} writers`);
// NEGATIVE CONTROL (run 2026-08-27): deleting the summary field from the add
// action made this read
//   FAIL  L15 the client line is written by hand, on the entry, by him
ck('L15 the client line is written by hand, on the entry, by him',
  /kind, summary: str\(body\?\.summary, 400\),/.test(WORKER)
  && /data-call-summary=/.test(ADMIN) && /data-c="summary"/.test(ADMIN));
// A save that did not send a summary must not blank a line already on a
// client's page.
// NEGATIVE CONTROL (run 2026-08-27): always pushing 'summary' onto the mask
// made this read
//   FAIL  L15b a save that says nothing about the line cannot erase it
ck('L15b a save that says nothing about the line cannot erase it',
  /if \(body && typeof body\.summary === 'string'\) \{\n\s*fields\.summary = str\(body\.summary, 400\);\n\s*mask\.push\('summary'\);/.test(WORKER));
// HIS SCREEN SAYS WHICH IS WHICH. The valve is only usable if he can see, at a
// glance, which entries his client is reading.
// NEGATIVE CONTROL (run 2026-08-27): removing the badge from the summary row
// made this read
//   FAIL  L16 his own list marks every entry the client can see
ck('L16 his own list marks every entry the client can see',
  /👁 Shown to your client/.test(ADMIN) && /🔒 Private, not shown/.test(ADMIN)
  && /const seen = !!String\(i\.summary \|\| ''\)\.trim\(\);/.test(ADMIN));
// AND THE BADGE GETS ITS OWN LINE. Inline it was clipped to "🔒 Pr" at 320px,
// which is worse than no badge: half a word beside an entry is a guess about
// what his client is reading. Found in a screenshot, pinned here.
// NEGATIVE CONTROL (run 2026-08-27): taking display:block off made this read
//   FAIL  L16b and it gets a line of its own, because at 320px it did not fit on that one
ck('L16b and it gets a line of its own, because at 320px it did not fit on that one',
  /class="log-seen\$\{seen \? ' is-on' : ''\}"/.test(ADMIN)
  && /\.log-seen \{\n\s*flex: 0 0 100%;/.test(CSS));

// ---- L17-L18: unlimited means uncounted ----------------------------------
// The panel used to say "Three are included" and "N of 3 used", against an
// agreement that promises "as many calls as the case needs. I do not count
// them and you will never be told you have used them up".
// NEGATIVE CONTROL (run 2026-08-27): putting the sentence back made this read
//   FAIL  L17 his own panel no longer counts what he promised not to count
// BOTH SIDES OF THIS READ THE STRIPPED SOURCE. The first draft tested the raw
// file and went red on its own explanation: the comment above the panel quotes
// the sentence it removed. A comment is a served byte here, which is why the
// stripper exists, and this is the trap it exists for pointed the other way.
ck('L17 his own panel no longer counts what he promised not to count',
  !/Three are included/.test(bare(ADMIN)) && !/of 3 used/.test(bare(ADMIN)));
ck('L18 and the agreement still says he does not count them',
  /as many as the case needs/.test(TIER)
  && /I do not count them and you will never be told you have used them up/.test(TIER));

// ---- L19-L23: the records release, parked, and the promise kept ----------
// Eric, 2026-08-27: "Remove the release of records and park that."
//
// The offer goes. The WITHDRAWAL does not, and cannot: data-auth-revoke is the
// only revoke control anywhere on the client side, the Worker refuses to let
// the advocate revoke for them, and the agreement promises in writing that
// either document can be withdrawn at any time.
// NEGATIVE CONTROL (run 2026-08-27): setting the flag back to true made this
// read
//   FAIL  L19 the signing offer is parked
ck('L19 the signing offer is parked',
  /const OFFER_AUTHORITY_SIGNING = false;/.test(CLIENT));
// The flag has to actually gate the buttons, not merely exist beside them.
// NEGATIVE CONTROL (run 2026-08-27): rendering the buttons unconditionally
// made this read
//   FAIL  L20 ... -- an add button renders with the flag off
ck('L20 and nothing renders a Sign button while it is off',
  /\$\{OFFER_AUTHORITY_SIGNING \? `\n\s*<p><button class="btn ghost" data-auth-add="records">/.test(CLIENT)
  && (bare(CLIENT).match(/data-auth-add="/g) || []).length === 2,
  'an add button renders with the flag off');
// NEGATIVE CONTROL (run 2026-08-27): deleting the Withdraw button from the
// permissions list made this read
//   FAIL  L21 ... -- a client who has already signed cannot withdraw
ck('L21 a client who has already signed can still read it back and withdraw it',
  /data-auth-revoke="\$\{esc\(r\.id\)\}"/.test(CLIENT)
  && /data-auth-view="\$\{esc\(r\.id\)\}"/.test(CLIENT)
  && /action: 'revoke'/.test(CLIENT),
  'a client who has already signed cannot withdraw');
// NEGATIVE CONTROL (run 2026-08-27): letting the advocate revoke made this
// read
//   FAIL  L21b and the advocate still cannot do it for them
ck('L21b and the advocate still cannot do it for them',
  /Only the client can revoke this/.test(WORKER)
  && /Revocation is the client's right and is not negotiable/.test(WORKER));
// NEGATIVE CONTROL (run 2026-08-27): dropping the promise from tier-terms.js
// made this read
//   FAIL  L22 and the agreement's written promise is still true
ck('L22 and the agreement\'s written promise is still true',
  /[Ee]ither one can be withdrawn in writing at any time/.test(TIER));
// A client who signed nothing gets no box at all, not an empty one.
// NEGATIVE CONTROL (run 2026-08-27): removing the early return made this read
//   FAIL  L23 a client who has signed nothing sees no permissions box
ck('L23 a client who has signed nothing sees no permissions box',
  /if \(!items\.length && !OFFER_AUTHORITY_SIGNING\) \{ host\.innerHTML = ''; return; \}/.test(CLIENT));

// ---- L24-L26: readiness, and the two sides agreeing ----------------------
// Two of the three rows were derived from the signed documents. With signing
// parked they could never be ticked again, which would have pinned his own
// card at "Not ready yet" on every case he opens.
// NEGATIVE CONTROL (run 2026-08-27): putting the two document rows back made
// this read
//   FAIL  L24 ... -- readiness still asks for something nothing can satisfy
ck('L24 readiness asks only for what the app can still see',
  !/authorityItems/.test(READY) && !/kind === 'records'/.test(READY)
  && /id: 'scope'/.test(READY),
  'readiness still asks for something nothing can satisfy');
// NEGATIVE CONTROL (run 2026-08-27): calling it with the old two-argument
// signature on one side only made this read
//   FAIL  L25 ... -- client handsOffReadiness(c) vs advocate handsOffReadiness(data, items)
const clientCall = (CLIENT.match(/handsOffReadiness\([^)]*\)/) || ['(none)'])[0];
const adminCall = (ADMIN.match(/handsOffReadiness\([^)]*\)/) || ['(none)'])[0];
ck('L25 and both sides call the same helper the same way',
  clientCall === 'handsOffReadiness(c)' && adminCall === 'handsOffReadiness(data)',
  `client ${clientCall} vs advocate ${adminCall}`);
// The safety property the old checklist carried has to land somewhere. It is
// his card, and it no longer depends on a tick box.
// NEGATIVE CONTROL (run 2026-08-27): deleting the warning made this read
//   FAIL  L26 ... -- nothing tells him not to pick up the phone
ck('L26 his card still tells him not to phone anyone without permission',
  /Do not phone a clinic or\n\s*their plan on their behalf until you have it in writing/.test(ADMIN)
  && /const noPermission = live\.length === 0;/.test(ADMIN),
  'nothing tells him not to pick up the phone');
// NEGATIVE CONTROL (run 2026-08-27): leaving the old headline in place made
// this read
//   FAIL  L26b the card no longer claims authority it cannot see
ck('L26b the card no longer claims authority it cannot see',
  !/Ready: authority to act/.test(ADMIN));

// ---- L27-L29: where it appears, and the width it appears at --------------
// NEGATIVE CONTROL (run 2026-08-27): removing the mount made this read
//   FAIL  L27 the log is on the client's page, on every case
ck('L27 the log is on the client\'s page, on every case',
  /<div data-worklog><\/div>/.test(CLIENT)
  && /if \(log\) mountCaseLog\(log, c\);/.test(CLIENT)
  && !/fullAccess[\s\S]{0,40}mountCaseLog/.test(CLIENT));
// The advocate's half has to be on every case too, or he has a log he cannot
// write on a case whose client can read it. 'Act' only exists on Hands-Off.
// NEGATIVE CONTROL (run 2026-08-27): moving 'log' back under Act made this
// read
//   FAIL  L28 ... -- log is behind a tier gate the client's half is not
const strip = (ADMIN.match(/groups: \[[\s\S]*?\n    \],/) || [''])[0];
ck('L28 and his half of it is on every case as well',
  /pages: \['overview', 'chat', 'files', 'log'\]/.test(strip)
  && !/'act'[\s\S]{0,60}'log'/.test(strip),
  'log is behind a tier gate the client\'s half is not');
// FOUR TABS PER GROUP AT 320px IS A HARD LIMIT, and he has photographed the
// defect. Moving a page in must not have pushed a group to five.
// NEGATIVE CONTROL (run 2026-08-27): adding 'log' to the Case group WITHOUT
// taking 'calls' out of Act left Act at two and Case at four, so this stayed
// green; adding a fifth page to Case made it read
//   FAIL  L28b ... -- pages: ['overview', 'chat', 'files', 'log', 'x']
// AND THE CHART STILL OPENS WHERE IT ALWAYS DID. The tab strip renders in the
// page DEFINITIONS array's order, not in the order a group lists its pages, so
// the first of a group's pages to appear in that array is the tab the group
// opens on. The first pass defined the work log at the top of the array, which
// silently made it the landing page of the whole chart. Nothing in this suite
// caught it; two unrelated browser drives did, by measuring controls on
// Overview that were suddenly not on screen (drive-charge: "it is a 44px
// target (0px)"). This is that hole closed.
// NEGATIVE CONTROL (run 2026-08-27): moving the definition back above
// 'overview' made this read
//   FAIL  L28c ... -- overview at 11408, log at 10993
const defAt = (id) => ADMIN.indexOf(`id: '${id}', title:`);
ck('L28c and the chart still opens on Overview, not on the log',
  defAt('overview') > 0 && defAt('log') > defAt('overview') && defAt('log') > defAt('files'),
  `overview at ${defAt('overview')}, log at ${defAt('log')}`);
ck('L28b and no group grew a fifth page doing it',
  (strip.match(/pages: \[[^\]]*\]/g) || [])
    .every((p) => (p.match(/'/g) || []).length / 2 <= 4),
  (strip.match(/pages: \[[^\]]*\]/g) || []).join(' '));
// It follows the file list's grammar rather than inventing one, and its pills
// take one token colour instead of four new hues.
// NEGATIVE CONTROL (run 2026-08-27): giving each kind its own colour made this
// read
//   FAIL  L29 ... -- 4 colours
const logPill = (CSS.match(/\.kind-pill\.call,[\s\S]*?\}/) || [''])[0];
const hues = new Set([...logPill.matchAll(/color: (var\(--\w+\))/g)].map((m) => m[1]));
ck('L29 the log pills are one token colour, not four new hues',
  hues.size === 1 && [...hues][0].startsWith('var(--')
  && !/#[0-9a-f]{3,8}|rgba?\(/i.test(logPill),
  `${hues.size} colours: ${[...hues].join(', ')}`);

// ---- L30-L31: the demo tells the same story ------------------------------
// Eric drives the demo himself. A shim that shipped the whole record would put
// a clinic's direct line on the demo client's own page.
// NEGATIVE CONTROL (run 2026-08-27): making the demo spread the record made
// this read
//   FAIL  L30 ... -- the demo ships fields the Worker does not
const demoLog = (DEMO.match(/if \(path === '\/api\/case-log'\) \{[\s\S]*?\n    \}/) || [''])[0];
ck('L30 the demo builds the same four fields, by name',
  demoLog.length > 0 && !/\.\.\.v/.test(demoLog)
  && ['id:', 'at:', 'kind:', 'who:', 'summary'].every((k) => demoLog.includes(k))
  && !/phone|parties|notes/.test(demoLog.replace(/\/\/[^\n]*/g, '')),
  'the demo ships fields the Worker does not');
// NEGATIVE CONTROL (run 2026-08-27): removing the demo's summary filter made
// this read
//   FAIL  L31 and drops an entry with no client line, exactly as the Worker does
ck('L31 and drops an entry with no client line, exactly as the Worker does',
  /if \(!summary\) continue;/.test(demoLog));

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
