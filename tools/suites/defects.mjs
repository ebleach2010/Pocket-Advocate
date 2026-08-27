// defects.mjs — the defects the three-agent sweep found, pinned so they cannot
// come back. Behavioural where the logic can be lifted; source-pinned where the
// fix is a shape rather than a function. Run: node defects.mjs
// Repo-rooted: this file runs from tools/suites/ inside the repository, so
// the sources it asserts against are found relative to itself, wherever the
// repo is checked out.
import { fileURLToPath as __f } from 'node:url';
import { dirname as __d, join as __j } from 'node:path';
const __REPO = __j(__d(__f(import.meta.url)), '..', '..');
import { readFileSync, readdirSync } from 'node:fs';
const R = __REPO;
const W = readFileSync(`${R}/worker/index.js`, 'utf8');
const ADV = readFileSync(`${R}/worker/advisor.js`, 'utf8');
const f = (p) => readFileSync(`${R}/${p}`, 'utf8');
let pass = 0, fail = 0;
const ck = (n, c, d = '') => { if (c) { pass++; console.log('PASS ', n); } else { fail++; console.log('FAIL ', n, d); } };

// ---- 1. the appeal ladder can reach every rung --------------------------
const DAYS = JSON.parse(W.match(/const APPEAL_WARN_DAYS = (\[[^\]]+\]);/)[1]);
const rungFor = new Function('daysLeft', 'APPEAL_WARN_DAYS',
  `return ${W.match(/const rung = (APPEAL_WARN_DAYS[^;]+);/)[1]};`);
for (const [left, want] of [[14, 14], [4, 14], [3, 3], [0, 3], [-5, 3]]) {
  ck(`appeal ladder: ${left} days left picks the ${want}-day rung`,
     rungFor(left, DAYS) === want, String(rungFor(left, DAYS)));
}
// and the guard must let a lower rung through after a higher one has fired
const guard = (warnedAt, rung) => !(Number(warnedAt) && Number(warnedAt) <= rung);
ck('appeal ladder: the 3-day warning survives the 14-day one', guard(14, 3));
ck('appeal ladder: a rung never fires twice', !guard(3, 3));

// ---- 2. the filing deadline is a whole MST day --------------------------
const dueOf = new Function('meta', `
  ${W.match(/(\/\/ dueAt is a bare[\s\S]*?const due = [\s\S]*?;\n)/)[1]}
  return due;`);
const due = dueOf({ dueAt: '2027-01-28' });
ck('deadline: a bare date means end of day MST, not UTC midnight',
   due === Date.parse('2027-01-28T23:59:59-07:00'), new Date(due).toISOString());
ck('deadline: it is no longer a day early',
   new Date(due).toLocaleDateString('en-US', { timeZone: 'Etc/GMT+7' }) === '1/28/2027',
   new Date(due).toLocaleDateString('en-US', { timeZone: 'Etc/GMT+7' }));

// ---- 3. firstName is never empty ----------------------------------------
const firstName = new Function('v', W.match(/function firstName\(v\) \{([\s\S]*?)\n\}/)[1]);
for (const [input, label] of [[null, 'null'], ['', 'empty'], ['   ', 'blank'], [undefined, 'undefined']]) {
  const out = firstName(input);
  ck(`firstName: ${label} still yields a name`, !!out && out.trim().length > 0, JSON.stringify(out));
}
ck('firstName: a real name is untouched', firstName('Jordan Avery') === 'Jordan');
ck('firstName: an email never reaches a lock screen whole',
   firstName('jordan@example.com') === 'jordan');

// ---- 4. no Infinity, and the clause is dropped when unknown -------------
ck('nudge: awayMin is null rather than Infinity when there is no beacon',
   /const awayMin = Number\.isFinite\(seenAt\) && seenAt > 0/.test(W)
   && !/: Infinity;/.test(W));
ck('nudge: the body omits the closed-for clause it cannot fill',
   /awayMin === null \? '' : ` and the app has been closed for/.test(W));
// Same behaviour, new shape: the ternary became an if/else on 2026-08-25 when
// the ladder gained its hourly repeat.
ck('nudge: an unknown absence starts at the first rung, not the loudest',
   /if \(awayMin === null\) \{\n\s*rung = WORK_NUDGE_MINUTES\[0\];/.test(W));
ck('nudge: past the fixed rungs it keeps asking, by the hour, for ever',
   /const hourly = Math\.floor\(awayMin \/ WORK_NUDGE_REPEAT_MINUTES\) \* WORK_NUDGE_REPEAT_MINUTES;/.test(W)
   && /rung = Math\.max\(fixed, hourly\);/.test(W),
   'a ladder that gave up at 30 minutes is how ten hours banked themselves');
ck('nudge: and nothing in the beacon stops a clock any more',
   !/const seconds = await stopWorkClock\(env, id, w\);/.test(W)
   && /NOTHING IS STOPPED HERE ANY MORE/.test(W));
ck('clock: a banked total can be corrected, which it never could before',
   /if \(body\?\.setSeconds !== undefined\)/.test(W)
   && /correction: \{ from: seconds, to: next, at: new Date\(\) \}/.test(W));

// ---- 5. the upgrade payment is not counted twice ------------------------
ck("paid sums: Eric's chart excludes the settled tier row",
   /kind !== 'tip' && x\.kind !== 'fullaccess'/.test(f('public/js/admin-case.js')));
ck('paid sums: the advisor economics note excludes it too',
   /else if \(p\?\.kind !== 'fullaccess'\) paidCents \+= cents;/.test(ADV));

// ---- 5b. the tip jar is gone, everywhere -------------------------------
const CASEJS = f('public/js/case.js');
ck('tip jar: nothing on the client case page asks for one',
   !/data-tip|tipJarHtml|TIP_QUOTE|sendTip|totalPaidCents/.test(CASEJS));
ck('tip jar: the update flow no longer ends on a copy of it',
   !/jarSrc|data-tip-jar/.test(f('public/js/changelog.js')));
ck('tip jar: the switch is gone from the dashboard',
   !/tip-jar-on|tipToggle|settings', 'tipJar/.test(f('public/js/admin.js')));
ck('tip jar: the route is closed rather than left live',
   /\/api\/tip' && request\.method === 'POST'\)\n\s*return json\(\{ error: 'Not found' \}, 404\);/.test(W)
   && !/async function handleTip/.test(W));
ck('tip jar: the ledger still reconciles tips already received',
   /kind === 'tip'/.test(W));

// ---- 6. economicsNote cannot emit 1h 60m --------------------------------
const spentOf = new Function('econ', 'hours', `
  return ${ADV.match(/const spent = hours >= 1\n([\s\S]*?);\n/)[0].replace(/^\s*const spent = /, '').replace(/;\n$/, '')};`);
for (const secs of [7170, 3599, 3600, 7199]) {
  const out = spentOf({ seconds: secs }, secs / 3600);
  ck(`economics: ${secs}s never renders 60m`, !/\b60m\b/.test(out), out);
}

// ---- 7. ceilings quote the constants in force ---------------------------
ck('ceilings: every ping interpolates its own constant, none are typed',
   /CASE_CAP_CENTS \/ 100/.test(W) && /ADDON_CAP_CENTS \/ 100/.test(W)
   && /SUB_CAP_CENTS \/ 100/.test(W) && /FULL_CAP_CENTS \/ 100/.test(W)
   && !/its \$1,000 ceiling/.test(W) && !/its \$500 ceiling/.test(W));

// ---- 8. the work clock ---------------------------------------------------
const AC = f('public/js/admin-case.js');
// Renamed live() -> liveClockSeconds() when the three-switch refactor hoisted
// it to module level (2026-08-25); same body, same assertions.
const liveOf = new Function('clock', 'now',
  `const Date = { now: () => now };
   ${AC.match(/const liveClockSeconds = \(\) => Math\.max\(0, clock\.seconds[\s\S]*?: 0\)\);\n/)[0]}
   return liveClockSeconds();`);
ck('clock: a phone behind the server never renders a negative',
   liveOf({ seconds: 0, startedAt: 1000 }, 995) === 0, String(liveOf({ seconds: 0, startedAt: 1000 }, 995)));
ck('clock: one stretch banks at most twelve hours on his screen too',
   liveOf({ seconds: 0, startedAt: 0 + 1 }, 1 + 64 * 3600 * 1000) === 12 * 3600);
ck('clock: nothing may start on a closed case',
   /doc\.data\.status === 'closed' && body\?\.on === true/.test(W));
ck('clock: a closed case gets no badge on the shelf',
   /clock: c\.status === 'closed' \? null : \{/.test(f('public/js/admin.js')));
ck('clock: the shelf badge always carries a word',
   /: \(started \? '0m' : 'Start'\)/.test(f('public/js/admin.js')));
ck('clock: the badge carries the state its ticker reads',
   /data-started="\$\{Number\(clock\.startedAt\) \|\| 0\}"/.test(f('public/js/drawer.js'))
   && /data-banked="\$\{Number\(clock\.banked\) \|\| 0\}"/.test(f('public/js/drawer.js')));
ck('clock: the shelf tap no longer depends on listener order',
   !/\[data-clock\]'\)\) \{\n\s*e\.preventDefault\(\);\n\s*e\.stopPropagation\(\);/.test(f('public/js/drawer.js')));
// These two used to pin the auto-start machinery (suppressAuto, autoClockOn
// racing load()). The defects they guarded - "re-entering the chart undid
// every stop", the ask card racing render - are now impossible or covered
// differently: nothing starts a clock but a tap (Eric, 2026-08-25: "All
// clocks in/clock out buttons are manual. Nothing automatic."), so the
// checks now pin the ABSENCE of the machinery and the ask card's survival.
ck('clock: a hand stop cannot be undone, because nothing auto-starts',
   !/suppressAuto|autoSuppressed/.test(AC) && !/postWork\(\{ on: true, auto: true \}\)/.test(AC));
ck('clock: the "still working?" ask runs after the case loads, not racing it',
   /if \(!autoClockTried\) \{/.test(AC) && /askIfStillWorking\(\);\n  \}/.test(AC));
ck('clock: the "still working?" card outlives the render it used to sit in',
   /const el = document\.querySelector\('main'\) \|\| document\.body;/.test(AC));

// ---- 9. purchases are not stolen or dead --------------------------------
const CJ = f('public/js/case.js');
ck('purchase: a poll repaint leaves an in-progress pane alone',
   /if \(progress && !busyInside\(progress\)\)/.test(CJ) && /function busyInside\(pane\)/.test(CJ));
// The quote handshake left this path on 2026-08-26, because the path stopped
// being a checkout: asking is free, and the Worker records the rate quoted at
// the moment of ASKING so an approval days later charges that number rather
// than whatever the live rate has climbed to. Stronger than the handshake it
// replaces, so the check follows it rather than being deleted.
ck('purchase: asking for the tier is free and quotes the first month honestly',
   /function upgradeQuoteCents\(c\)/.test(CJ)
   && /Math\.round\(upgradeQuoteCents\(c\) \/ 100\)/.test(CJ)
   && /Asking costs nothing\s*\n?\s*and takes no card/.test(CJ)
   && !/quotedCents: upgradeQuoteCents\(c\)/.test(CJ));
ck('purchase: only an approval produces a payable link',
   /req\?\.state === 'approved' && c\.pendingFullAccess\?\.url/.test(CJ));
ck('purchase: a pending ask says plainly that nothing was charged',
   /Nothing has been charged/.test(CJ) && /data-withdraw-upgrade/.test(CJ));
ck('purchase: the card repaints when the live price lands',
   /ratesReady\.then\(\(\) => \{/.test(CJ));
const BK = f('public/js/book.js');
ck('booking: both early returns strip the controls they cannot wire',
   (BK.match(/\n {4}stripUnwiredStep1\(el/g) || []).length === 2
   && /function stripUnwiredStep1\(el/.test(BK));
ck('booking: a failed calendar read says what to do next',
   /Reload the page and it usually comes back/.test(BK));

// ---- 10. legal records carry one date -----------------------------------
const AU = f('public/js/authority.js');
ck('authority: dates are MST, so one signature is one date',
   /timeZone: 'Etc\/GMT\+7', year: 'numeric'/.test(AU));
ck('authority: a missing stamp says so instead of "Invalid Date"',
   /fallback = '\(not yet signed\)'/.test(AU) && /return fallback;/.test(AU));
ck('authority: a bad date in a RANGE does not borrow signature-block wording',
   /'\(date not recorded\)'/.test(AU));

// ---- 11. the scope note only claims what the code counts ----------------
const TT = f('public/js/tier-terms.js');
for (const gone of ['90 days', 'up to <strong>five</strong>', 'three three-way']) {
  ck(`scope note: "${gone}" is gone`, !TT.includes(gone));
}
// The window went MONTHLY on 2026-08-26, so the promise is thirty days per
// month taken rather than a flat sixty. Both halves are still enforced: the
// window by fullAccessWindowEnd, the letters by appealsUsed.
ck('scope note: it promises a month at a time and two letters, both enforced',
   /<strong>30 days per month you take<\/strong>/.test(TT)
   && /<strong>Two insurance appeal letters<\/strong>/.test(TT));
ck('scope note: it says asking is free and the answer is his',
   /Asking costs nothing and I do not take a card/.test(TT)
   && /I carry two of these at once/.test(TT));
ck('scope note: it says continuing never costs more',
   /one more month at the same price/.test(TT)
   && /It never costs more for continuing/.test(TT));
ck('scope note: it says nothing is charged before he approves',
   /Nothing is charged unless and until I approve your request/.test(TT));
ck('scope note: it says the second letter outlives the window',
   /second appeal letter does not expire with the window/.test(TT));
// The start MOVED (Eric, 2026-08-25: "the clock starts upon booking") and
// the sentence moved with it, checklist wording included.
ck('scope note: it says the clock runs regardless of the checklist',
   /the month runs from the day it starts, whether or not the checklist is done/.test(TT));

// ---- 12. chat reactions: the record shape and who may touch what ---------
// (Audit, 2026-08-25.) The stored reaction is a RECORD ({ id, kind, ... }),
// never a bare id. The first clear-own-status carve-out ran Object.hasOwn
// over the record itself, which coerces to "[object Object]" and matches
// nothing - dead code that let a status be set but never taken down.
ck('react: no hasOwn over the reaction record (the dead-carve-out shape)',
   !/Object\.hasOwn\(CHAT_REACTIONS, msg\.data\.reaction \?\?/.test(W));
// EXPECTATION UPDATED 2026-08-26, not relaxed. This pinned the single-line
// form of the carve-out. The same carve-out was written independently on main
// (where its absence was refusing Eric his own status dropdown) as two named
// conditions, and the merge kept that form because the names are what make it
// readable. The behaviour is identical, so the check now pins all three parts
// instead of one line - dropping ANY of them turns this red, which is stricter
// than what it replaced.
ck('react: the admin may clear anything on his own bubble, status included',
   /const ownMessage = msg\.data\.from === user\.uid;/.test(W)
   && /const adminStatus = ctx\.isAdmin && \(isStatus \|\| reaction === null\);/.test(W)
   && /if \(ownMessage && !adminStatus\)/.test(W));
ck('react: a status note is protected from the client, wherever it hangs',
   /msg\.data\.reaction\?\.kind === 'status' && !ctx\.isAdmin/.test(W));
const CHJ = f('public/js/chat.js');
ck('react: the client menu withholds rows the Worker would refuse',
   /myRole === 'admin' \|\| data\.reaction\?\.kind !== 'status'/.test(CHJ));
ck('react: the ▾ targets the newest COMMITTED message, not a local echo',
   /const committed = ordered\.filter\(\(m\) => m\.data\(\)\.ts\);/.test(CHJ));
const DAPI = f('public/js/demo/api.js');
ck('react: the demo writes the record shape the pages render',
   /kind: 'status', by: myUid/.test(DAPI) && /kind: 'emoji', by: myUid/.test(DAPI)
   && !/reaction: body\.reaction \|\| null/.test(DAPI));

// ---- 13. the clock is manual, nothing automatic --------------------------
// (Eric, 2026-08-25: "All clocks in/clock out buttons are manual. Nothing
// automatic." clock.mjs drives the behaviour; these pin the source.)
ck('clock: the Worker answers an auto start with the truth and no write',
   /if \(on && auto\)\n\s*return json\(\{/.test(W));
const ACJ = f('public/js/admin-case.js');
ck('clock: nothing in the chart auto-starts a clock any more',
   !/autoClockOn|auto: true/.test(ACJ));
ck('clock: the header switch above the tabs exists on open cases',
   /data-work-head/.test(ACJ) && /startHeadClock/.test(ACJ));
ck('clock: all switches share one painter set, so no two can disagree',
   /const clockPaints = new Set\(\)/.test(ACJ) && /clockPaints\.add\(paint\)/.test(ACJ));

// ---- 14. a stylesheet may not overrule the `hidden` attribute -------------
// Found where two rewrites met: the design system gave `.stack` a display, the
// booking flow had `<div class="stack" hidden>`, and a class selector outranks
// the UA rule that makes `hidden` work. Rendered, the whole second half of
// booking step 1 was on the page. `hidden` is used 146 times across case.js,
// book.js and admin-case.js, so this is not one element's problem.
//
// The check is per PAGE, not per stylesheet, because that is the unit the
// browser resolves the cascade in. A guard sitting in a sheet the admin pages
// never load protects nothing there - which is how the first version of this
// fix was wrong, and admin-case.js is the heaviest user of `hidden` in the
// repo. So: read each page's own <link> tags, and if anything it loads sets a
// class display, something it loads must also carry the absolute guard.
{
  // Strip comments first: the guard's own explanation quotes `display:grid`,
  // and a prose mention is not a rule.
  const bare = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
  const displayers = (css) => {
    const out = [];
    for (const m of bare(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sel = m[1].trim();
      const disp = (m[2].match(/(?:^|;)\s*display\s*:\s*([a-z-]+)/) || [])[1];
      if (!disp || disp === 'none') continue;
      if (!/(^|[\s,>+~])\.[a-zA-Z]/.test(sel)) continue;   // class-carrying selector
      if (/\[hidden\]/.test(sel)) continue;                 // already exempts itself
      out.push(sel.split('\n')[0].trim());
    }
    return out;
  };
  // The selector must be BARE `[hidden]`. `.fpage[hidden] { display:none
  // !important }` matched a looser pattern and made this check pass for the
  // wrong reason: a per-element patch is exactly the thing being replaced.
  const guards = (css) => /(^|\})\s*\[hidden\]\s*\{[^}]*display\s*:\s*none\s*!important/m.test(bare(css));

  const pages = readdirSync(`${R}/public`).filter((n) => n.endsWith('.html')).sort();
  for (const page of pages) {
    const html = f(`public/${page}`);
    const sheets = [...html.matchAll(/href="\/css\/([^"?]+)/g)].map((m) => m[1]);
    let risky = [], guarded = false;
    for (const s of sheets) {
      const css = f(`public/css/${s}`);
      risky = risky.concat(displayers(css));
      if (guards(css)) guarded = true;
    }
    ck(`hidden: nothing ${page} loads can un-hide an element`,
       risky.length === 0 || guarded,
       `sheets=${sheets.join('+') || 'none'} ${risky.length} class rules set a display; guard ${guarded ? 'present' : 'MISSING'} (e.g. ${risky[0]})`);
  }
}

// ---- 15. no em dash, no en dash, in anything anybody reads ---------------
// Eric's rule, and it kept being broken because it kept being checked wrong.
// A scan for the literal codepoints missed `&mdash;` and `&ndash;`, which
// render as exactly the character the rule forbids: three sat in the pricing
// copy on the services page for a week. So the check unescapes first.
//
// Scope, stated honestly: the visible text of the static pages. Scripts,
// styles and HTML comments are stripped, because a code comment is not
// something anybody reads on a screen. That does mean copy built inside a JS
// module is NOT covered here - grep those by codepoint when they change.
{
  const DASH = /[—–]/;
  const ENT = {
    '&mdash;': '—', '&ndash;': '–',
    '&#8212;': '—', '&#8211;': '–',
    '&#x2014;': '—', '&#x2013;': '–',
  };
  const visible = (html) => html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/&(?:mdash|ndash|#8212|#8211|#x2014|#x2013);/gi, (m) => ENT[m.toLowerCase()]);
  for (const page of readdirSync(`${R}/public`).filter((n) => n.endsWith('.html')).sort()) {
    const bad = visible(f(`public/${page}`)).split('\n')
      .map((l, i) => [i + 1, l]).filter(([, l]) => DASH.test(l));
    ck(`dashes: ${page} has no em or en dash where it shows`,
       bad.length === 0,
       bad.length ? `line ${bad[0][0]}: ${bad[0][1].trim().slice(0, 80)}` : '');
  }
}

// ---- 16. the case workspace groups are HIS, and do not move -------------
// Asked and answered on 2026-08-26: leave them as Track and Mine. Nothing
// pinned them before, which is exactly how a pass renamed them to Before and
// After and moved six pages with them. The names are what he says out loud
// ("under mine"), so they are a fact about him and not a design opinion.
//
// `calldoc` is pinned to `mine` on purpose. A page in no group renders no tab
// at all, which is how the call document first shipped invisible, and he then
// failed to find it twice more.
{
  const AC = f('public/js/admin-case.js');
  const block = (AC.match(/groups: \[([\s\S]*?)\n    \],/) || [])[1] || '';
  const labels = [...block.matchAll(/label: '([^']+)'/g)].map((m) => m[1]);
  const ids = [...block.matchAll(/id: '([^']+)'/g)].map((m) => m[1]);
  ck('groups: the five names are Case, Advisor, Track, Mine and Act',
     labels.join('|') === 'Case|Advisor|Track|Mine|Act', labels.join('|'));
  ck('groups: their ids match, so nothing renamed only the visible half',
     ids.join('|') === 'case|read|track|mine|act', ids.join('|'));
  const mine = (block.match(/id: 'mine'[^}]*pages: \[([^\]]+)\]/) || [])[1] || '';
  ck('groups: the call document is in Mine, so it renders a tab at all',
     /'calldoc'/.test(mine), mine.trim());
}

// ---- 17. the scheduling blocks are for clients, not for him -------------
// Eric, 2026-08-26: "Let me reschedule sessions without the scheduling blocks
// stopping me... reschedule for an hour later on the same day."
//
// Three rules compounded into one wall, and none of them was reachable from a
// browser test, which is why they are pinned here:
//
//   cleanupStaleSlots ran every 15 minutes and deleted every OPEN slot inside
//   the 72h lead window, including ones he had opened himself, so a slot for
//   3pm today was gone before he could use it;
//   handleCreateSlots refused outright to open a slot inside that window;
//   so the reschedule dropdown, which lists open slots, had nothing sooner
//   than three days out.
//
// The lead window, the horizon and business hours are CLIENT self-service
// rules. The client picker filters the lead window itself, so none of this can
// put an odd-hour opening in front of a client.
{
  const sweep = (W.match(/async function cleanupStaleSlots[\s\S]*?\n}/) || [''])[0];
  ck('schedule: the sweep leaves a slot he opened himself alone',
     sweep.length > 0 && /if \(s\.data\.adminCreated\) return false;/.test(sweep),
     sweep.length ? 'adminCreated not exempted' : 'cleanupStaleSlots not found');
  ck('schedule: but a slot whose time has gone is still swept, whoever made it',
     /if \(at < Date\.now\(\)\) return true;/.test(sweep));
  const create = (W.match(/async function handleCreateSlots[\s\S]*?\n}/) || [''])[0];
  ck('schedule: he can open a slot inside the lead window',
     create.length > 0
     && !/if \(start\.getTime\(\) < Date\.now\(\) \+ LEAD_TIME_HOURS \* 3600_000\) \{ invalid\+\+; continue; \}/.test(create)
     && /const soon = start\.getTime\(\) < Date\.now\(\) \+ LEAD_TIME_HOURS \* 3600_000;/.test(create),
     create.length ? 'the lead-window skip is still there' : 'handleCreateSlots not found');
  ck('schedule: and one he opens inside it is marked his, so the sweep spares it',
     /\.\.\.\(soon \? \{ adminCreated: true \} : \{\}\)/.test(create));
  ck('schedule: the past is still refused',
     /if \(start\.getTime\(\) < Date\.now\(\)\) \{ invalid\+\+; continue; \}/.test(create));
  // The one-tap path, which is what he actually asked for.
  // Anchored on the SOURCE list, not on rendered markup: the buttons are built
  // from a map, so `data-nudge="60"` never appears in the file and a check for
  // it failed while the feature worked. drive-nudge.mjs asserts the rendered
  // labels; this asserts the four shifts are still declared.
  ck('schedule: the panel offers one-tap shifts off the current appointment',
     /\['\+1 hour', 60\], \['\+2 hours', 120\], \['\+1 day', 1440\], \['\+1 week', 10080\]/.test(AC)
     && /data-nudge="\$\{mins\}"/.test(AC));
  ck('schedule: a missed call is measured from now, not from the time that passed',
     /const past = from\.getTime\(\) < Date\.now\(\);/.test(AC)
     && /const base = past \? new Date\(\) : from;/.test(AC));
  // The confirmation has to outlive the repaint. This panel has already
  // shipped a save that confirmed and then deleted its own confirmation.
  ck('schedule: the confirmation survives the repaint that follows it',
     /say\('sched', msg/.test(AC) && /\$\{saidHtml\('sched'\)\}/.test(AC));
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
