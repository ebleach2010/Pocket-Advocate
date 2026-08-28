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

// ---- L32-L44: "he is on it", said once per run of a kind -----------------
// Eric, 2026-08-27: "Current status notifications. If I log a call it should
// notify the client that I'm making calls on his behalf. But not every time.
// Only once. Then it only sends him a new notification if it switches
// categories even if I made several calls. So if I start logging calls it
// notifies 'Your advocate is making calls to clinics...' and then switches to
// 'Eric is writing insurance companies...' etc." Asked two questions, he chose
// that it notifies EVEN IF he wrote no client-safe line on the entry (it is
// about the KIND of work, not a pointer to something to go and read), and
// therefore that the empty log must not look broken.
//
// THESE ARE RUN, NOT READ. A regex can see that a notifyUser call exists; it
// cannot tell you that six entries produce three notifications, which three,
// or that a notes edit produces none. So the route itself is lifted out of the
// shipped Worker and driven with stubbed dependencies, and the assertions are
// about what came out of it.
const noticeTable = (WORKER.match(/const WORK_LOG_NOTICES = \{[\s\S]*?\n\};/) || [''])[0];
const noticeFn = (WORKER.match(/function workLogNotice\(kind, c, who\) \{[\s\S]*?\n\}/) || [''])[0];
const routeSrc = (WORKER.match(/async function handleClinicCalls\(request, env, url\) \{[\s\S]*?\n\}/) || [''])[0];
const strFn = (WORKER.match(/function str\(v, n\) \{[\s\S]*?\n\}/) || [''])[0];
const nameFn = (WORKER.match(/function firstName\(v\) \{[\s\S]*?\n\}/) || [''])[0];
// NEGATIVE CONTROL (run 2026-08-28): renaming workLogNotice in the Worker made
// this read
//   FAIL  L32 the notification lifts out of the shipped Worker, words and all  -- workLogNotice
// A lift that has lost its target goes red rather than asserting nothing, the
// same way L4 does for the projection.
ck('L32 the notification lifts out of the shipped Worker, words and all',
  !!noticeTable && !!noticeFn && !!routeSrc && !!strFn && !!nameFn,
  [!noticeTable && 'WORK_LOG_NOTICES', !noticeFn && 'workLogNotice',
    !routeSrc && 'handleClinicCalls', !strFn && 'str', !nameFn && 'firstName']
    .filter(Boolean).join(', '));

/** The route, running, with everything it touches stubbed. `ctl.boom` makes a
 *  send throw, which is how the ordering of send-then-stamp is proved. */
const harness = (caseData, adminData = { name: 'Eric Bleach', role: 'admin' }) => {
  const notified = [];
  const written = [];
  const store = new Map();
  const ctl = { boom: false };
  if (caseData) store.set('cases/c1', caseData);
  if (adminData) store.set('users/eric', adminData);
  const deps = {
    requireAdmin: async () => ({ uid: 'eric' }),
    json: (obj, code = 200) => ({ code, obj }),
    listDocs: async () => [],
    getDoc: async (env, path) => (store.has(path)
      ? { id: path.split('/').pop(), data: store.get(path) } : null),
    patchDoc: async (env, path, data) => {
      written.push({ path, data });
      store.set(path, { ...(store.get(path) || {}), ...data });
      return true;
    },
    notifyUser: async (env, uid, msg) => {
      if (ctl.boom) throw new Error('push is down');
      notified.push({ uid, ...msg });
    },
    crypto: { randomUUID: () => `entry${written.length}` },
  };
  // eslint-disable-next-line no-new-func
  const fn = new Function('deps', `
    const { requireAdmin, json, listDocs, getDoc, patchDoc, notifyUser, crypto } = deps;
    const LOG_KINDS = ${workerKinds || "['call']"};
    ${strFn}
    ${nameFn}
    ${noticeTable}
    ${noticeFn}
    ${routeSrc}
    return handleClinicCalls;
  `)(deps);
  const post = (b) => fn({ method: 'POST', json: async () => b },
    {}, new URL('https://x/api/clinic-calls'));
  return { post, notified, written, store, ctl };
};

// The line he types on the entry. It is stored, it reaches his client's work
// log through the projection, and it must never reach a lock screen.
const TYPED = 'Chased Marcy about the fax that never went. Do not repeat this.';
const OPEN_CASE = { clientUid: 'client1', clientName: 'Dana Reyes', status: 'open' };
const H = harness({ ...OPEN_CASE });
const SEQUENCE = ['call', 'call', 'call', 'appeal', 'appeal', 'call'];
const replies = [];
for (const kind of SEQUENCE) {
  // eslint-disable-next-line no-await-in-loop
  replies.push(await H.post({
    caseId: 'c1', action: 'add', kind, clinic: 'Valley Neurology', summary: TYPED,
  }));
}
const said = H.notified.map((n) => n.body);
// NEGATIVE CONTROL (run 2026-08-28): neutering the run test in workLogNotice
// (`if (c.logKindTold === kind)` to `if (false)`) made this read
//   FAIL  L33 six entries, three runs, three notifications and not one more  --
//   6 sent: Eric is making calls to clinics on your case. | Eric is making
//   calls to clinics on your case. | Eric is making calls to clinics on your
//   case. | Eric is writing insurance companies about your case. | Eric is
//   writing insurance companies about your case. | Eric is making calls to
//   clinics on your case.
// which is the "every time" he explicitly did not ask for.
ck('L33 six entries, three runs, three notifications and not one more',
  said.length === 3, `${said.length} sent: ${said.join(' | ')}`);
// AND WHICH THREE. Three of anything is not the property; the property is that
// the third one is a CALL again, because returning to a category he used
// earlier is a switch and does say so a second time.
// NEGATIVE CONTROL (run 2026-08-28): remembering every kind ever announced
// (stamping an accumulated string and testing it with `includes`, instead of
// one last-told kind) made this read
//   FAIL  L34 and going back to calls after the appeals says so again  -- Eric
//   is making calls to clinics on your case. | Eric is writing insurance
//   companies about your case.
ck('L34 and going back to calls after the appeals says so again',
  said.join(' | ') === [
    'Eric is making calls to clinics on your case.',
    'Eric is writing insurance companies about your case.',
    'Eric is making calls to clinics on your case.',
  ].join(' | '), said.join(' | ') || '(silence)');
// NEGATIVE CONTROL (run 2026-08-28): pointing the link at /admin-case.html and
// the title at 'Work log' made this read
//   FAIL  L35 all three go to the client, in the house title, at their own
//   work log  -- uid client1 | title Work log | link /admin-case.html?id=c1
ck('L35 all three go to the client, in the house title, at their own work log',
  H.notified.every((n) => n.uid === 'client1' && n.title === 'Pocket Advocate'
    && n.link === '/case.html?id=c1'),
  H.notified.map((n) => `uid ${n.uid} | title ${n.title} | link ${n.link}`)[0] || '(silence)');
// THE LINE HE TYPED HAS NO PATH INTO A LOCK SCREEN. He asked for the entry to
// notify even when he writes no client line at all, so the words are keyed by
// kind in the Worker; this is that promise, run.
// NEGATIVE CONTROL (run 2026-08-28): appending `${str(body?.summary, 400)}` to
// the notification body made this read
//   FAIL  L36 and not one of them carries the line he typed, or who he called
//   -- Eric is making calls to clinics on your case. Chased Marcy about the
//   fax that never went. Do not repeat this.
ck('L36 and not one of them carries the line he typed, or who he called',
  !said.some((b) => b.includes(TYPED) || b.includes('Marcy') || b.includes('Valley Neurology')),
  said.find((b) => b.includes(TYPED) || b.includes('Marcy') || b.includes('Valley Neurology')) || '');
// AND THE ENTRY LANDS FIRST. Saving what he typed is the job; the status line
// is a courtesy on top of it, and it must never be able to get in front.
// NEGATIVE CONTROL (run 2026-08-28): moving the notify block above the entry
// write made this read
//   FAIL  L37 all six entries were saved, and each one before a word was sent
//   -- 6 entries, 6 ok, first write cases/c1
const entryWrites = H.written.filter((w) => w.path.includes('/private/clinicCalls/items/'));
ck('L37 all six entries were saved, and each one before a word was sent',
  entryWrites.length === 6 && replies.every((r) => r.obj.ok === true)
  && H.written[0].path.includes('/private/clinicCalls/items/'),
  `${entryWrites.length} entries, ${replies.filter((r) => r.obj.ok).length} ok, first write ${H.written[0]?.path}`);

// THE NEGATIVE, RUN. An edit is not new work: he rewrites what he wrote about
// a call he already logged, and nobody's phone lights up for it.
const before = H.notified.length;
const noteReply = await H.post({
  caseId: 'c1', action: 'notes', id: 'entry0', notes: 'private', summary: 'a new line',
});
// NEGATIVE CONTROL (run 2026-08-28): copying the notify block from the add
// branch into the notes branch made this read
//   FAIL  L38 editing an entry's notes tells the client nothing at all  -- 4 sent, was 3
ck('L38 editing an entry\'s notes tells the client nothing at all',
  H.notified.length === before && noteReply.obj.ok === true,
  `${H.notified.length} sent, was ${before}`);
// And the kind stays unwritable there, because a kind that could be edited
// would be a run switch with nothing sent behind it.
// READ STRIPPED, the same trap L17 documents: the comment standing over that
// branch explains why the kind is not editable there, so the raw slice
// contains the word this check is looking for the absence of.
// NEGATIVE CONTROL (run 2026-08-28): adding kind to the notes mask made this
// read
//   FAIL  L38b and the notes save still cannot change an entry's kind  -- the notes branch touches kind or notifies
const notesBranch = bare((routeSrc.match(/if \(body\?\.action === 'notes'\) \{[\s\S]*?\n  \}/) || [''])[0]);
ck('L38b and the notes save still cannot change an entry\'s kind',
  notesBranch.length > 0 && !/kind/.test(notesBranch) && !/notifyUser/.test(notesBranch),
  notesBranch ? 'the notes branch touches kind or notifies' : 'could not slice the notes branch');

// NOBODY TO TELL, AND A CASE THAT IS OVER. Both are silence, and both still
// save the entry.
const noClient = harness({ status: 'open' });
await noClient.post({ caseId: 'c1', action: 'add', kind: 'call', clinic: 'X' });
const closed = harness({ clientUid: 'client1', status: 'closed' });
await closed.post({ caseId: 'c1', action: 'add', kind: 'call', clinic: 'X' });
// NEGATIVE CONTROL (run 2026-08-28): reducing the guard in workLogNotice to
// `if (!c) return null;` made this read
//   FAIL  L39 a case with nobody on it and a closed case are both told nothing
//   -- no client 1 sent, closed case 1 sent
ck('L39 a case with nobody on it and a closed case are both told nothing',
  noClient.notified.length === 0 && closed.notified.length === 0
  && noClient.written.length === 1 && closed.written.length === 1,
  `no client ${noClient.notified.length} sent, closed case ${closed.notified.length} sent`);

// THE GUARD AGAINST A FUNCTION THAT NEVER SPEAKS. Everything above would also
// pass if the decision were "say nothing, always", so this drives all four
// kinds from a fresh case and demands four different sentences.
// eslint-disable-next-line no-new-func
const lifted = new Function(`${noticeTable}\n${noticeFn}\nreturn { WORK_LOG_NOTICES, workLogNotice };`)();
const eachKind = workerKinds.replace(/[[\]'\s]/g, '').split(',')
  .map((k) => lifted.workLogNotice(k, { ...OPEN_CASE }, 'Your advocate'));
// NEGATIVE CONTROL (run 2026-08-28): making workLogNotice `return null;` on its
// first line made this read
//   FAIL  L40 every one of the four kinds actually says something, and says it
//   once  --  ,  ,  ,
ck('L40 every one of the four kinds actually says something, and says it once',
  eachKind.length === 4 && eachKind.every((b) => typeof b === 'string' && b.length > 10)
  && new Set(eachKind).size === 4,
  eachKind.join(' , '));
// HIS TWO EXAMPLES, BOTH OF THEM, from the one house way of naming him. The
// call site passes `firstName(profile?.data.name) || 'Your advocate'`, the
// same expression the "sent you a message" notification uses.
// NEGATIVE CONTROL (run 2026-08-28): changing the call tail to "is phoning
// around" made this read
//   FAIL  L40b and the words are his own, both ways he can be named  -- Your
//   advocate is phoning around.
ck('L40b and the words are his own, both ways he can be named',
  lifted.workLogNotice('call', { ...OPEN_CASE }, 'Your advocate')
    === 'Your advocate is making calls to clinics on your case.'
  && lifted.workLogNotice('appeal', { ...OPEN_CASE }, 'Eric')
    === 'Eric is writing insurance companies about your case.',
  lifted.workLogNotice('call', { ...OPEN_CASE }, 'Your advocate') || '(silence)');
// NEGATIVE CONTROL (run 2026-08-28): dropping 'investigation' from the notice
// table made this read
//   FAIL  L40c the table covers exactly the four kinds this record holds  --
//   notices appeal|appointment|call vs kinds
//   appeal|appointment|call|investigation
ck('L40c the table covers exactly the four kinds this record holds',
  sorted(Object.keys(lifted.WORK_LOG_NOTICES))
    === sorted(workerKinds.replace(/[[\]'\s]/g, '').split(',')),
  `notices ${sorted(Object.keys(lifted.WORK_LOG_NOTICES))} vs kinds ${sorted(workerKinds.replace(/[[\]'\s]/g, '').split(','))}`);

// THE ORDERING, PROVED BY BREAKING THE SEND. Stamp-then-send would leave the
// case saying the client had been told when nothing went out, and every later
// entry of that kind would be swallowed in silence. Send-then-stamp fails the
// other way: it can repeat itself, which is visible.
const boom = harness({ ...OPEN_CASE });
boom.ctl.boom = true;
// Wrapped, because L42 below exists to catch the route letting a dead phone
// escape. Without this the suite would die here instead of reporting it.
let boomThrew = '';
try { await boom.post({ caseId: 'c1', action: 'add', kind: 'call', clinic: 'X' }); }
catch (e) { boomThrew = ` (and the route threw: ${e.message})`; }
const stampedAfterThrow = boom.store.get('cases/c1').logKindTold;
boom.ctl.boom = false;
await boom.post({ caseId: 'c1', action: 'add', kind: 'call', clinic: 'X' });
// NEGATIVE CONTROL (run 2026-08-28): moving the stamp ahead of the send (an
// unconditional patchDoc before notifyUser) made this read
//   FAIL  L41 a send that throws leaves the stored kind alone, so the next one
//   says it  -- stamped call after the send threw, then 0 sent
ck('L41 a send that throws leaves the stored kind alone, so the next one says it',
  stampedAfterThrow === undefined && boom.notified.length === 1,
  `stamped ${stampedAfterThrow} after the send threw, then ${boom.notified.length} sent${boomThrew}`);
// NEGATIVE CONTROL (run 2026-08-28): taking the `.catch(() => {})` off the
// notify chain made this read
//   FAIL  L42 and a phone that cannot be reached never fails his save  -- the
//   route threw: Error: push is down
let saveSurvived = '';
try {
  const b2 = harness({ ...OPEN_CASE });
  b2.ctl.boom = true;
  const r = await b2.post({ caseId: 'c1', action: 'add', kind: 'appeal', clinic: 'X' });
  saveSurvived = r.obj.ok === true && b2.written.length === 1 ? 'ok' : 'the entry was not saved';
} catch (e) { saveSurvived = `the route threw: ${e}`; }
ck('L42 and a phone that cannot be reached never fails his save',
  saveSurvived === 'ok', saveSurvived);
// NOTHING GOES TO HIM. This is a client-facing status; his own phone already
// buzzes for everything else on this case.
// NEGATIVE CONTROL (run 2026-08-28): adding an admin fan-out to the add branch
// made this read
//   FAIL  L43 exactly one send lives in the add branch, and it is aimed at the
//   client  -- 2 sends in the add branch
const addBranch = (routeSrc.match(/if \(body\?\.action === 'add'\) \{[\s\S]*?\n  \}/) || [''])[0];
ck('L43 exactly one send lives in the add branch, and it is aimed at the client',
  (addBranch.match(/notifyUser\(/g) || []).length === 1
  && /notifyUser\(env, c\.data\.clientUid, \{/.test(addBranch)
  && !/role', 'EQUAL', 'admin/.test(addBranch),
  `${(addBranch.match(/notifyUser\(/g) || []).length} sends in the add branch`);

// THE EMPTY LOG. A client can now be told he is making calls and open the app
// to a log with nothing in it, because he logs a call when he writes it up.
// An empty box would read as broken; this says what the panel is.
// NEGATIVE CONTROL (run 2026-08-28): deleting the else branch of the items
// ternary made this read
//   FAIL  L44 the empty work log says what it is for, in his voice
ck('L44 the empty work log says what it is for, in his voice',
  /This is where I write down the work I do on your\n\s*case, by date\./.test(CLIENT));
// No em or en dash in anything a client reads. defects.mjs scans the static
// pages and says in its own comment that copy built inside a JS module is NOT
// covered, so the new copy is pinned here by codepoint.
// NEGATIVE CONTROL (run 2026-08-28): putting an em dash in the call notice
// made this read
//   FAIL  L44b no em or en dash in the new client copy  -- call: 'is making calls to clinics — on your case.',
const dashLines = [...noticeTable.split('\n'),
  ...(CLIENT.match(/<p class="dim small">This is where I write[\s\S]*?<\/p>/) || [''])[0].split('\n')]
  .filter((ln) => /[—–]/.test(ln));
ck('L44b no em or en dash in the new client copy',
  dashLines.length === 0, dashLines[0]?.trim() || '');


const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const x of failed) console.log(`  FAILED: ${x.name}`); process.exit(1); }
